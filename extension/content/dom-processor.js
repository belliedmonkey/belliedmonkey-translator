// dom-processor.js — general DOM segmenter (DomSegmenter).
//
// Turns ANY rendered DOM (normal pages + YouTube title/description/comments) into
// translatable paragraph units, using only STANDARD HTML semantics — no per-site
// selectors. See docs/domain-design.md. Robustness (vs a naive textContent grab):
//   • computed-style visibility (getComputedStyle + size) — not just inline style
//   • visibility-aware DEEP text extraction — hidden / script / custom-element
//     subtrees never leak in (this is why reddit's inline `SML.load([[…]])` is
//     not translated)
//   • standard attributes (translate="no", .notranslate, aria-hidden, contenteditable)
//   • text heuristics (URL / email / @ / # / pure-symbol / looksLikeCode)
//   • block/inline classification by computed `display` (custom elements classed
//     by CSS, not tag name)

var DOMProcessor = (() => {
  // Never translated, never descended into.
  const EXCLUDE_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'path', 'math', 'canvas',
    'img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed',
    'map', 'area', 'code', 'pre', 'kbd', 'samp', 'var', 'textarea', 'input',
    'select', 'option', 'button', 'meta', 'link', 'br', 'hr', 'slot'
  ]);

  // Phrasing (inline) tags — merged into a paragraph unit, never a block boundary.
  const INLINE_TAGS = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'data', 'dfn', 'em', 'i', 'mark',
    'q', 'rp', 'rt', 'ruby', 's', 'small', 'span', 'strong', 'sub', 'sup',
    'time', 'u', 'wbr', 'del', 'ins', 'label', 'font'
  ]);

  // Fast-path block tags (fallback when computed style is unavailable).
  const BLOCK_TAGS = new Set([
    'p', 'div', 'article', 'section', 'blockquote', 'li', 'td', 'th',
    'dd', 'dt', 'figcaption', 'summary', 'aside', 'main',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'address', 'legend', 'caption'
  ]);

  // Control roles only — NOT 'navigation' (a nav region can hold translatable
  // labels/links; SPAs like reddit also put content in nav/aside).
  const SKIP_ROLES = new Set(['button', 'menu', 'menuitem', 'menubar', 'tab', 'tablist', 'toolbar']);
  // Only the clearest non-content chrome (consent banners / captcha). We do NOT
  // skip nav/menu/ad/social classes — that wrongly dropped nav links (whose text
  // sits in an inline <span>) and the user wants broad coverage (ads already
  // translate). Controls are still handled by SKIP_ROLES + <button> exclusion.
  const SKIP_CLASS_PATTERNS = /\b(captcha|cookie-consent|cookie-banner|gdpr)\b/i;

  const TRANSLATION_CLASS = 'mt-translation';
  const PROCESSED_ATTR = 'data-mt-processed';
  const TRANSLATABLE_ATTR = 'data-mt-translatable';

  function computed(el) { try { return getComputedStyle(el); } catch (_) { return null; } }

  // Visible = not display:none / visibility:hidden / opacity:0, and not collapsed
  // to <4px (catches CSS-hidden code and zero-size UI). <pre> is exempt from size.
  function isVisible(el) {
    if (!(el instanceof Element)) return true;
    const cs = computed(el);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.opacity === '0')) return false;
    // display:contents generates NO box (getBoundingClientRect → 0×0) but its
    // children DO render — so skip the size check, or we'd wrongly prune the whole
    // subtree (this is exactly what hid reddit's left nav, wrapped in display:contents).
    if (cs && cs.display === 'contents') return true;
    if (!el.closest('pre')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 && r.height < 4) return false;
    }
    return true;
  }

  // Classify by COMPUTED display first (so a custom element or an <a>/<span>
  // styled display:flex/block is treated as a block, and a <div> styled
  // display:inline as inline). Tag tables are only a fallback when no computed
  // style is available (detached nodes).
  // Only `display:inline` (pure inline text flow) is inline. inline-block /
  // inline-flex / inline-grid generate a BOX (nav items, buttons, badges) and
  // must each be their OWN unit — otherwise a horizontal nav menu collapses into
  // one concatenated blob that never translates cleanly.
  function isInline(el) {
    if (!(el instanceof Element)) return false;
    const cs = computed(el);
    if (cs && cs.display) return cs.display === 'inline' || cs.display === 'contents';
    return INLINE_TAGS.has(el.tagName.toLowerCase());
  }

  function isBlock(el) {
    if (!(el instanceof Element)) return false;
    const cs = computed(el);
    if (cs && cs.display) {
      const d = cs.display;
      if (d === 'none' || d === 'contents' || d === 'inline') return false;
      return true; // block / flex / grid / list-item / table / inline-block / inline-flex / …
    }
    return BLOCK_TAGS.has(el.tagName.toLowerCase());
  }

  // Video-player regions (captions/controls + our subtitle overlay) are owned by
  // the subtitle path — recomputed once per collect pass.
  let playerRegions = [];
  function computePlayerRegions() {
    playerRegions = Array.from(document.querySelectorAll('video'))
      .map((v) => v.closest('[class*="player" i],[id*="player" i]') || v.parentElement)
      .filter(Boolean);
    const ov = document.getElementById('mt-yt-overlay');
    if (ov) playerRegions.push(ov);
    const pov = document.getElementById('mt-pod-overlay'); // parity with the yt overlay:
    if (pov) playerRegions.push(pov);                      // belt for translate=no (subtitle path owns it)
  }
  function inPlayerRegion(el) {
    for (let i = 0; i < playerRegions.length; i++) if (playerRegions[i].contains(el)) return true;
    return false;
  }

  // Hard skip: reject this element AND its subtree from the walk entirely.
  function hardSkip(el) {
    const tag = el.tagName.toLowerCase();
    if (EXCLUDE_TAGS.has(tag)) return true;
    // Never re-collect our OWN injected translation (else a sibling translation
    // div gets translated again → an endless cascade of translated translations).
    if (el.classList && el.classList.contains(TRANSLATION_CLASS)) return true;
    // Video captions/controls + our subtitle overlay are the subtitle path's job.
    if (inPlayerRegion(el)) return true;
    if (el.hasAttribute(PROCESSED_ATTR)) return true;
    if (el.getAttribute('translate') === 'no') return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.isContentEditable) return true;
    if (!isVisible(el)) return true;
    return false;
  }

  // Soft skip: don't make THIS element a unit, but keep descending into it.
  function softSkip(el) {
    const role = el.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    const cls = el.className;
    if (typeof cls === 'string' && SKIP_CLASS_PATTERNS.test(cls)) return true;
    return false;
  }

  // Skip by CONTENT, not by semantic region: do NOT blanket-skip
  // nav/header/footer/aside — SPAs (reddit) put real content (sidebar
  // descriptions, rules, nav labels) there, and we want to translate it. Only
  // skip when an ancestor is a control region (role) or contenteditable. (Hidden
  // / excluded subtrees are already pruned by hardSkip in the walker.)
  function isInsideSkipZone(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.isContentEditable) return true;
      const role = parent.getAttribute('role');
      if (role && SKIP_ROLES.has(role)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function isContents(el) { const cs = computed(el); return !!(cs && cs.display === 'contents'); }

  // A leaf block has no visible block-level element child (so it holds its own
  // text); otherwise we descend into it. Uses computed display so custom-element
  // containers (display:block) are descended, inline ones merged.
  // `display:contents` generates NO box (neither block nor inline for layout) but
  // its children DO render as blocks — so it must be treated as TRANSPARENT and
  // recursed into. Otherwise a container whose only child is a display:contents
  // wrapper (Substack's `.single-post` → `div.pencraft[display:contents]` → the
  // real paragraphs) is mis-seen as a leaf and its ENTIRE subtree is collected as
  // one giant multi-thousand-px unit (see docs/domain-design.md §3).
  function hasBlockChild(el) {
    for (const child of el.children) {
      if (EXCLUDE_TAGS.has(child.tagName.toLowerCase())) continue;
      if (child.classList && child.classList.contains(TRANSLATION_CLASS)) continue;
      if (!isVisible(child)) continue;
      if (isBlock(child)) return true;
      if (isContents(child) && hasBlockChild(child)) return true; // see-through wrapper
    }
    return false;
  }

  // Visibility-aware DEEP text extraction: skip excluded tags, our own injected
  // translation, and any non-rendered subtree. Collapses horizontal whitespace
  // only (keeps newlines; never forces a space into a no-space script).
  function collectText(el, out) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) { out.push(node.textContent); continue; }
      if (!(node instanceof Element)) continue;
      if (node.classList && node.classList.contains(TRANSLATION_CLASS)) continue;
      if (EXCLUDE_TAGS.has(node.tagName.toLowerCase())) continue;
      if (!isVisible(node)) continue;
      collectText(node, out);
    }
  }
  function getTextContent(el) {
    const out = [];
    collectText(el, out);
    return out.join('').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Minimum length to bother translating — SCRIPT-AWARE. CJK / Hangul / Thai are
  // space-less and information-dense: an 8-char run is a full phrase
  // ("シャンパン最新情報"), so a low floor. Latin/Cyrillic need more chars to be
  // meaningful (avoid translating "Home"/"News"). A fixed char count is biased
  // against CJK — this is why short Japanese nav labels were being skipped.
  function minLen(text) {
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(text) ? 2 : 10;
  }

  // Non-translatable text: pure symbols/numbers, a bare URL/email/@/#, or code.
  function isUntranslatable(text) {
    // Unicode-aware "no letters at all" check. (Must use \p{L}, NOT [\W] — JS \w
    // is ASCII-only, so [\W] would wrongly flag ALL non-Latin scripts — Japanese,
    // Chinese, Korean, Arabic — as pure symbols and skip them.)
    if (!/\p{L}/u.test(text)) return true;
    if (/^https?:\/\/\S+$/.test(text)) return true;
    if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(text)) return true;
    if (/^[@#]\S+$/.test(text)) return true;
    if (typeof TranslationCore !== 'undefined' && TranslationCore.looksLikeCode(text)) return true;
    return false;
  }

  // ─── Collect translatable leaf-block units ────────────────────────────
  function collectUnits(root = document.body) {
    const nodes = [];
    computePlayerRegions();
    walkRoot(root, nodes);
    return nodes;
  }

  // Walk one tree (document or a shadowRoot). Recurses into every OPEN shadow
  // root — web components (reddit's <shreddit-*> nav / sidebar / description) keep
  // their content in shadow DOM, which a plain document.body walk never enters.
  function walkRoot(root, nodes) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) { return hardSkip(el) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let el;
    while ((el = walker.nextNode())) {
      if (el.shadowRoot && el.shadowRoot.mode === 'open') walkRoot(el.shadowRoot, nodes);
      if (!isBlock(el)) continue;
      if (hasBlockChild(el)) continue;     // container → descend, don't collect
      if (softSkip(el)) continue;
      if (isInsideSkipZone(el)) continue;
      const text = getTextContent(el);
      if (text.length < minLen(text)) continue;
      if (isUntranslatable(text)) continue;
      el.setAttribute(TRANSLATABLE_ATTR, '1');
      nodes.push(el);
    }
  }

  function markProcessed(el, translatedText) {
    // Idempotent: if a translation child already exists, don't add another.
    if (el.querySelector(`:scope > .${TRANSLATION_CLASS}`)) {
      el.setAttribute(PROCESSED_ATTR, '1');
      return;
    }
    el.setAttribute(PROCESSED_ATTR, '1');
    const div = document.createElement('div');
    div.className = TRANSLATION_CLASS;
    div.textContent = translatedText;
    el.appendChild(div);
  }

  function removeTranslations(root = document.body) {
    root.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => el.remove());
    root.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));
  }

  function isAlreadyTranslated(el) { return el.hasAttribute(PROCESSED_ATTR); }

  return {
    collectUnits,
    collectParagraphs: collectUnits, // backward-compatible alias
    markProcessed,
    removeTranslations,
    isAlreadyTranslated,
    getTextContent,
    isVisible,
    isInline,
    isBlock,
    TRANSLATION_CLASS,
    PROCESSED_ATTR,
    TRANSLATABLE_ATTR
  };
})();
