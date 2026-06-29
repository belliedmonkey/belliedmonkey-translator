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

  const SKIP_ROLES = new Set(['button', 'menu', 'menuitem', 'menubar', 'tab', 'tablist', 'toolbar', 'navigation']);
  // Class/id hints for non-content chrome (soft skip: not a unit, but still descend).
  const SKIP_CLASS_PATTERNS = /\b(nav|menu|btn|button|toolbar|breadcrumb|pagination|ad|advertisement|banner|cookie|social|share|comment-form|captcha)\b/i;

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
    if (!el.closest('pre')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 && r.height < 4) return false;
    }
    return true;
  }

  function isInline(el) {
    if (!(el instanceof Element)) return false;
    if (INLINE_TAGS.has(el.tagName.toLowerCase())) return true;
    const cs = computed(el);
    return !!(cs && /^inline/.test(cs.display));
  }

  function isBlock(el) {
    if (!(el instanceof Element)) return false;
    if (isInline(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) return true;
    const cs = computed(el);
    return !!(cs && /^(block|flex|grid|list-item|table|flow-root)/.test(cs.display));
  }

  // Hard skip: reject this element AND its subtree from the walk entirely.
  function hardSkip(el) {
    const tag = el.tagName.toLowerCase();
    if (EXCLUDE_TAGS.has(tag)) return true;
    // Never re-collect our OWN injected translation (else a sibling translation
    // div gets translated again → an endless cascade of translated translations).
    if (el.classList && el.classList.contains(TRANSLATION_CLASS)) return true;
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

  function isInsideSkipZone(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const tag = parent.tagName.toLowerCase();
      // Semantic non-content regions only (NOT className — layout wrappers like
      // "main-content-and-sidebar" legitimately wrap the whole article).
      if (['nav', 'header', 'footer', 'aside'].includes(tag)) return true;
      if (EXCLUDE_TAGS.has(tag)) return true;
      if (parent.isContentEditable) return true;
      const role = parent.getAttribute('role');
      if (role && SKIP_ROLES.has(role)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  // A leaf block has no visible block-level element child (so it holds its own
  // text); otherwise we descend into it. Uses computed display so custom-element
  // containers (display:block) are descended, inline ones merged.
  function hasBlockChild(el) {
    for (const child of el.children) {
      if (EXCLUDE_TAGS.has(child.tagName.toLowerCase())) continue;
      if (!isVisible(child)) continue;
      if (isBlock(child)) return true;
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

  // Non-translatable text: pure symbols/numbers, a bare URL/email/@/#, or code.
  function isUntranslatable(text) {
    if (/^[\d\s\W]+$/.test(text)) return true;
    if (/^https?:\/\/\S+$/.test(text)) return true;
    if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(text)) return true;
    if (/^[@#]\S+$/.test(text)) return true;
    if (typeof TranslationCore !== 'undefined' && TranslationCore.looksLikeCode(text)) return true;
    return false;
  }

  // ─── Collect translatable leaf-block units ────────────────────────────
  function collectUnits(root = document.body) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) { return hardSkip(el) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let el;
    while ((el = walker.nextNode())) {
      if (!isBlock(el)) continue;
      if (hasBlockChild(el)) continue;     // container → descend, don't collect
      if (softSkip(el)) continue;
      if (isInsideSkipZone(el)) continue;
      const text = getTextContent(el);
      if (text.length < 10) continue;
      if (isUntranslatable(text)) continue;
      el.setAttribute(TRANSLATABLE_ATTR, '1');
      nodes.push(el);
    }
    return nodes;
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
