// content-webpage.js — bilingual translation for ALL DOM
//
// Per docs/domain-design.md: every rendered page (normal sites AND YouTube's
// title / description / comments) is the same pipeline —
//   DomSegmenter.collectUnits → TranslationCore engine (state machine + retry,
//   viewport scheduler) → sibling renderer (loading / translation / error+retry).
// No per-site selectors (no YT_TARGETS). YouTube page-text specials (clickable
// URLs, seekable timestamps, single-blob interleave) are GENERAL renderer
// features here, not site rules.

var WebpageTranslator = (() => {
  let settings = {};
  let active = false;
  let units = [];                 // [{ node, text, tr?, _state… }]
  let known = new WeakSet();      // nodes already turned into units (dedupe)
  let engine = null;
  let tickTimer = null;
  let tickCount = 0;
  let domObs = null;              // SPA re-render fix-up (see installDomObserver)

  const CLASS = DOMProcessor.TRANSLATION_CLASS;
  const PROCESSED = DOMProcessor.PROCESSED_ATTR;

  // ─── Engine: per-unit state machine + retry, viewport scheduler ───────
  // The capability probe lives HERE, in the adapter — never inside TranslationCore
  // (docs/domain-design.md §5.3 rule 2). LangDetect is also absent entirely from the
  // pure-logic test harness, hence the typeof guard as well as the availability check.
  function langDetector() {
    return typeof LangDetect !== 'undefined' ? LangDetect.detectorOrNull() : null;
  }

  function makeEngine() {
    return TranslationCore.createEngine({
      translate: (text) => TranslationAPI.translate(
        text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
        TranslationAPI.resolveProvider(settings.provider), settings.apiKey || '', settings.apiBaseUrl || '', settings.apiModel || ''),
      // Text already in the target language never reaches the provider (engine skips it
      // before the request) and therefore renders no sibling at all. Read late (getter,
      // not value) per docs/domain-design.md §4 — the engine must never hold a stale copy.
      targetLang: () => settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      // Optional browser-native detector (docs/domain-design.md §5.3): extends that skip
      // to targets script cannot decide, on the browsers that have one. Absent on every
      // Safari, where the engine falls back to the script check alone.
      detect: langDetector(),
      // viewport priority + lazy: only translate units in/near the viewport.
      selectActive: (us) => us.filter((u) => u.node.isConnected && inViewport(u.node)),
      // Merged over the core WINDOW defaults — list only what differs here.
      window: { AHEAD_MS: 0, MAX_PER_TICK: 5, MAX_RETRIES: 3, RETRY_GAP_MS: 800, GRACE_MS: 0 },
    });
  }

  function inViewport(node) {
    const r = node.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return false;
    return r.top < window.innerHeight * 1.5 && r.bottom > -200;
  }

  // Re-collect translatable units (prune detached, append new, dedupe). Acts as
  // the SPA poll too — picks up lazily-loaded comments and YouTube re-renders.
  function recollect(root) {
    // A mere click/selection makes SPA frameworks (React on Substack) re-render the
    // article and REPLACE paragraph nodes with fresh, identical ones. The naive
    // response — drop the old node's translation, then re-translate + re-insert for the
    // new node — flickers the page (remove→re-add) and briefly shifts layout, even
    // though the text never changed. So when a detached node's translation is still
    // usable, stash it by text and let an identical re-rendered node ADOPT it: the same
    // div just re-anchors under the new node — no removal, no re-translate, no flash.
    const orphans = new Map(); // text -> { div, tr }
    const kept = [];
    for (const u of units) {
      if (u.node.isConnected) { kept.push(u); continue; }
      const div = u.node.__mtTrans;
      const reusable = div && div.isConnected && div.dataset.interleave !== '1'
        && !u.node.hasAttribute('data-mt-hidden') && u.tr;
      if (reusable && !orphans.has(u.text)) orphans.set(u.text, { div, tr: u.tr });
      else if (div && div.remove) div.remove(); // real removal / dup / interleave → prune now
      // An interleaved original pruned here is DETACHED but may be the very node
      // a time-sliced SPA re-inserts a task later — without this it would come
      // back display:none, invisible to collectUnits forever (silent content
      // loss). Attribute/style writes are fine on detached nodes.
      restoreOriginal(u.node);
      // A time-sliced SPA (React 18, virtualized feeds) can detach a node in one
      // task and re-insert the SAME node a task later. Without this cleanup the
      // returning node is blocked forever (known + data-mt-processed) and its
      // translation is permanently lost; with it, the next poll re-collects it
      // (cache-first, so the re-translate is cheap).
      known.delete(u.node);
      u.node.__mtTrans = null;
      if (u.node.removeAttribute) u.node.removeAttribute(PROCESSED);
    }
    units = kept;
    const fresh = DOMProcessor.collectUnits(root || document.body)
      .filter((n) => !known.has(n))
      .map((n) => {
        known.add(n);
        n.setAttribute(PROCESSED, '1'); // future walks prune this subtree (perf)
        const u = { node: n, text: DOMProcessor.getTextContent(n) };
        const orphan = orphans.get(u.text);
        if (orphan) {                            // identical re-render → adopt, don't recreate
          orphans.delete(u.text);
          n.__mtTrans = orphan.div;
          u.tr = orphan.tr;                      // seed engine state: stateOf()=done, pump() skips
          n.__mtPlaceBefore = computePlacement(n); // one style read per ADOPTED node, not per unit
          anchor(n, orphan.div);
        }
        return u;
      });
    // Any stash not re-adopted was a genuine removal → drop its now-stale translation.
    for (const o of orphans.values()) if (o.div && o.div.remove) o.div.remove();
    if (fresh.length) units = units.concat(fresh);
    if (engine) engine.setUnits(units);
  }

  // ─── Rich text: clickable URLs + seekable timestamps (Trusted-Types safe) ──
  // Timestamp→seek anchors are a YOUTUBE-ONLY feature (descriptions/comments):
  // the click handler scrubs the page's first <video>, and on any other site
  // that is someone ELSE's media element — a hero video, an inline ad — which a
  // translation must never touch (interaction-spec: 翻译文字插入后不要影响网页
  // 原有内容的交互动作). Anchored host regex — an unanchored /youtube\.com/
  // would also match "notyoutube.com.evil.example".
  const SEEKABLE_HOST = /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
  function tsToSeconds(ts) { const p = ts.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
  function buildRichText(text, el) {
    el.textContent = '';
    text.split(/(https?:\/\/[^\s]+)/g).forEach((part) => {
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement('a');
        a.href = part; a.target = '_blank'; a.rel = 'noopener'; a.textContent = part; a.style.color = '#3ea6ff';
        el.appendChild(a); return;
      }
      let last = 0;
      if (SEEKABLE_HOST) {
        const re = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g; let m;
        while ((m = re.exec(part))) {
          if (m.index > last) el.appendChild(document.createTextNode(part.slice(last, m.index)));
          const ts = m[0]; const a = document.createElement('a');
          a.textContent = ts; a.style.cssText = 'color:#3ea6ff;cursor:pointer;';
          a.addEventListener('click', (e) => { e.preventDefault(); const v = document.querySelector('video'); if (v) v.currentTime = tsToSeconds(ts); });
          el.appendChild(a); last = m.index + ts.length;
        }
      }
      if (last < part.length) el.appendChild(document.createTextNode(part.slice(last)));
    });
  }

  // The translation should match the ORIGINAL element's font exactly (family / size /
  // weight / style / line-height / letter-spacing) so a bold heading gets a bold
  // heading translation, body text gets body text, etc. Only the COLOR stays distinct
  // (settings.textColor) so the bilingual pair is still tellable apart. `fontSize` is a
  // relative SCALE (1.0 = identical to the original); legacy unit values fall back to 1.
  function parseScale(v) {
    if (typeof v === 'string' && /(em|px|%)/.test(v)) return 1.0; // legacy '0.9em'/'14px'
    const n = parseFloat(v);
    return (isFinite(n) && n > 0) ? n : 1.0;
  }
  function fontCss(node) {
    let cs = null; try { cs = node && getComputedStyle(node); } catch (_) { cs = null; }
    if (!cs) return 'font-size:1em;line-height:1.4;';
    const px = (parseFloat(cs.fontSize) || 16) * parseScale(settings.fontSize);
    const lh = (cs.lineHeight && cs.lineHeight !== 'normal') ? cs.lineHeight : '1.4';
    const ls = (cs.letterSpacing && cs.letterSpacing !== 'normal') ? `letter-spacing:${cs.letterSpacing};` : '';
    // text-align is NOT inherited by a sibling of the styled node (e.g. a centered
    // hero <h1 style="text-align:center">) — copy it so the translation aligns.
    const ta = (cs.textAlign && cs.textAlign !== 'start') ? `text-align:${cs.textAlign};` : '';
    return `font-family:${cs.fontFamily};font-size:${px.toFixed(1)}px;font-weight:${cs.fontWeight};font-style:${cs.fontStyle};line-height:${lh};${ls}${ta}`;
  }
  function transStyle(node) { return `color:${settings.textColor || window.MT_PALETTE.textColor};margin:2px 0;display:block;white-space:pre-wrap;` + fontCss(node); }
  // Whitespace-insensitive comparison, used to recognise "the response is the original
  // text back again". Strict equality only — never a similarity guess.
  //
  // Whitespace TOUCHING a CJK character is dropped too, because it is typography, not
  // language: providers add and remove the space around an embedded Latin word freely
  // (Google handed back "我会创建一个 Obsidian 文档" as "我会创建一个Obsidian文档"), and
  // without this the echoed line reads as a translation and gets drawn twice — caught on
  // macOS Safari. A space BETWEEN two Latin words is untouched, and a real translation
  // still differs by far more than spacing, so nothing genuine can be suppressed.
  const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
  const SPACE_BEFORE_CJK = new RegExp(`\\s+(?=[${CJK}])`, 'gu');
  const SPACE_AFTER_CJK = new RegExp(`([${CJK}])\\s+`, 'gu');   // capture, not lookbehind (older WebKit)
  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ')
      .replace(SPACE_BEFORE_CJK, '').replace(SPACE_AFTER_CJK, '$1').trim();
  }
  // The original element's OWN text color, for the interleave path's re-drawn
  // original rows (see renderInterleaved).
  function origColorOf(node) {
    let cs = null; try { cs = node && getComputedStyle(node); } catch (_) { cs = null; }
    return (cs && cs.color) ? `color:${cs.color};` : '';
  }

  // A sibling translation injected into a flex/grid row becomes a flex/grid ITEM
  // placed inline next to the original (mobile YouTube metadata "4946次点赞 ·
  // 29万次观看 · 1年前", header, comment counts) — it overlaps and spills off the
  // row. Force it onto its own full-width line: in flex, flex-basis:100% + make the
  // row wrap (record nowrap→wrap for clean revert); in grid, span every column.
  // Revert the flex-wrap mutation, restoring any inline value the page had itself.
  function undoFlowFix(p) {
    if (!p || !p.hasAttribute || !p.hasAttribute('data-mt-flow-fix')) return;
    const prev = p.getAttribute('data-mt-flow-fix');
    p.style.flexWrap = (prev && prev !== '1') ? prev : '';
    p.removeAttribute('data-mt-flow-fix');
  }

  // A unit laid out as part of a CSS TABLE cannot take a sibling: the browser wraps
  // anything placed next to it in an ANONYMOUS table box, which both displaces the
  // translation and distorts the table's intrinsic sizing. Such units take the
  // translation INSIDE themselves instead.
  //
  // Two display values, found a fortnight apart, same mechanism:
  //   · `table-cell`   — issue #59, en.wikipedia.org infobox: the translations became
  //     a whole extra COLUMN and the prose column beside it collapsed to ~115px.
  //   · `table-caption` — found on iPad Safari 2026-08-06 and root-caused with Web
  //     Inspector: Wikipedia's `<figure>` is `display:table` and its `<figcaption>` is
  //     the table's caption, so the block sibling landed in the figure's anonymous box
  //     and was drawn ON TOP of the caption text. This predicate tested only
  //     `table-cell`, so captions fell through.
  //
  // Listing the table display values is the point: this is generic layout knowledge,
  // not site knowledge. Any page whose figure or table is a CSS table hits it.
  const TABLE_DISPLAYS = ['table-cell', 'table-caption'];
  function isCell(node) {
    let cs; try { cs = getComputedStyle(node); } catch (_) { return false; }
    return !!cs && TABLE_DISPLAYS.indexOf(cs.display) >= 0;
  }

  function flowFixCss(node) {
    const p = node.parentElement;
    if (!p) return '';
    let cs; try { cs = getComputedStyle(p); } catch (_) { return ''; }
    const disp = cs.display;
    if (disp === 'flex' || disp === 'inline-flex') {
      // Column-direction flex already stacks new items vertically — no fix needed.
      // Forcing wrap + flex-basis:100% there is actively harmful: basis means HEIGHT
      // in a column, so the translation fills the column and WRAPS INTO A NEW COLUMN
      // beside the original (Anthropic QuoteCarousel cards: a squeezed right-side strip).
      if ((cs.flexDirection || 'row').startsWith('column')) {
        // A responsive flip (row → column media query) can leave our earlier wrap
        // mutation stranded on the parent — revert it here rather than waiting for disable().
        undoFlowFix(p);
        return '';
      }
      if (cs.flexWrap === 'nowrap' && !p.hasAttribute('data-mt-flow-fix')) {
        // Record the page's own inline flex-wrap (usually none) so revert can
        // RESTORE it instead of erasing it. '1' = "no prior inline value".
        p.setAttribute('data-mt-flow-fix', p.style.flexWrap || '1');
        p.style.flexWrap = 'wrap';
      }
      return 'flex-basis:100%;width:100%;';
    }
    if (disp === 'grid' || disp === 'inline-grid') return 'grid-column:1 / -1;';
    return '';
  }

  // A block original that is NARROWER than its parent's content box (max-width +
  // margin:auto reading columns — Anthropic, Medium-style articles) does not pass
  // that constraint to a sibling: the translation would span the full container
  // width, flush left. Mirror the original's horizontal geometry: cap max-width to
  // the original's used width (responsive: it can still shrink), and reproduce
  // centering with auto margins (or the left offset for a non-centered indent).
  function layoutCss(node) {
    const p = node.parentElement;
    if (!p) return '';
    let cs, pcs;
    try { cs = getComputedStyle(node); pcs = getComputedStyle(p); } catch (_) { return ''; }
    // A ROW-flex/grid ITEM's narrowness comes from track/line distribution, not
    // from the node's own layout constraint — mirroring it would clamp the
    // translation that flowFixCss just forced onto its own full-width row. Those
    // are flowFixCss's domain. COLUMN-flex items stack like blocks, but with
    // align-items:center/start they do NOT stretch — mirror those like blocks so
    // the translation matches a centered/fixed-width item instead of shrink-wrapping.
    if (pcs.display.includes('grid')) return '';
    if (pcs.display.includes('flex') && !(pcs.flexDirection || 'row').startsWith('column')) return '';
    if (cs.display.startsWith('inline') && cs.display !== 'inline-block') return ''; // inline width is not a layout constraint
    // A COLD bail (no cached mirror yet) must not freeze an empty mirror forever:
    // viewport-priority translation often fires exactly while an entrance scale
    // animation is mid-flight. Flag the node so tick() re-renders it for a few
    // ticks until the geometry is measurable; give up after ~8 (permanent transform).
    const bailCold = () => {
      if (!node.__mtLayoutCss && node.__mtLayoutCold !== -1) {
        node.__mtLayoutCold = (node.__mtLayoutCold || 0) + 1;
        if (node.__mtLayoutCold > 8) node.__mtLayoutCold = -1; // terminal: -1 = given up, stops the retry loop
      }
      return node.__mtLayoutCss || '';
    };
    const nr = node.getBoundingClientRect();
    // Node hidden (interleave re-render sets display:none) — reuse the geometry
    // captured while it was still visible instead of dropping the constraint.
    if (nr.width < 1) return bailCold();
    // A transformed ancestor (entrance scale animation, pinch-zoom wrapper) makes
    // getBoundingClientRect return VISUAL px while our emitted margins apply in
    // LOCAL px — the mirror would be off by the scale factor. Detect and bail.
    if (node.offsetWidth && Math.abs(nr.width - node.offsetWidth) > 2) return bailCold();
    node.__mtLayoutCold = 0; // measurable — any retry loop ends here
    const pr = p.getBoundingClientRect();
    const contentL = pr.left + (parseFloat(pcs.paddingLeft) || 0) + (parseFloat(pcs.borderLeftWidth) || 0);
    const contentR = pr.right - (parseFloat(pcs.paddingRight) || 0) - (parseFloat(pcs.borderRightWidth) || 0);
    const gapL = nr.left - contentL, gapR = contentR - nr.right;
    if (gapL + gapR < 4) { node.__mtLayoutCss = ''; return ''; } // fills the row — nothing to mirror (and refresh the cache)
    // Cap to the original's USED width. Never copy cs.maxWidth verbatim: the common
    // responsive pattern `width:600px; max-width:100%` computes to maxWidth '100%',
    // which on the sibling resolves to the FULL parent — reintroducing the very
    // flush-edge regression this mirror exists to fix. Ch/em caps would mis-scale
    // against the translation's own (user-scaled) font too.
    const mw = `${nr.width.toFixed(1)}px`;
    // Mirror the INLINE-START gap with a logical margin: a physical margin-left is
    // discarded by the over-constrained rule in RTL containing blocks (CSS2.1 §10.3.3),
    // snapping the translation to the wrong edge on Arabic reading columns.
    const rtl = (pcs.direction === 'rtl');
    const gapStart = rtl ? gapR : gapL;
    // A block sibling FILLS its container, so a max-width cap suffices; a column-flex
    // item SHRINK-WRAPS its content, so it additionally needs an explicit width to
    // match the original instead of collapsing to its text width.
    const w = pcs.display.includes('flex') ? `width:${mw};max-width:${mw};` : `max-width:${mw};`;
    let out;
    if (gapStart > 1 && Math.abs(gapL - gapR) < 2) out = `${w}margin-left:auto;margin-right:auto;`;
    else if (gapStart > 1) out = `${w}margin-inline-start:${gapStart.toFixed(1)}px;`;
    else out = w;
    node.__mtLayoutCss = out;
    return out;
  }

  // Geometry CSS for the translation. Inside a cell the translation is a CHILD, so
  // it already inherits the cell's box — there is no sibling to constrain, and both
  // mirrors would be measured against the wrong parent (the <tr>).
  //
  // What it needs instead is to contribute NOTHING to the table's intrinsic width.
  // An auto-width table is sized shrink-to-fit from its cells' MAX-CONTENT, so a
  // translation that is merely wrapped (`overflow-wrap`) still widens the column —
  // measured at +78px on fixture 30, which pushes the prose beside a floated table
  // around exactly like the extra-column bug did. `width:0` makes the contribution a
  // definite zero; `min-width:100%` then fills the cell back out at used-value time.
  // `overflow-wrap:anywhere` stays as the belt to `width:0`'s braces, so a single long
  // unbreakable token can't overflow the cell it is now painted inside.
  function placementCss(node) {
    if (isCell(node)) return 'width:0;min-width:100%;overflow-wrap:anywhere;';
    return flowFixCss(node) + layoutCss(node);
  }

  // ─── Placement: visual order, not DOM order ───────────────────────────
  // The one universal rule of the bilingual pair is "original above, translation
  // below" (interaction-spec). A flex container can REVERSE the visual order of
  // its children, and then a translation inserted after its original in the DOM
  // paints ABOVE it — the pair reads backwards:
  //   • flex-direction:column-reverse — the MAIN axis stacks items bottom-to-top.
  //   • flex-wrap:wrap-reverse in a row — the LINES stack bottom-to-top, and the
  //     translation already gets its own line from flowFixCss.
  // (A plain row-reverse is NOT affected: only the main axis is mirrored, and the
  // translation's own line still comes after on the downward cross axis.)
  // In those containers we anchor the translation BEFORE the original instead, so
  // it still renders below it.
  function computePlacement(node) {
    const p = node.parentElement;
    if (!p) return false;
    let cs; try { cs = getComputedStyle(p); } catch (_) { return false; }
    if (cs.display !== 'flex' && cs.display !== 'inline-flex') return false;
    const dir = cs.flexDirection || 'row';
    if (dir === 'column-reverse') return true;
    return dir.startsWith('row') && cs.flexWrap === 'wrap-reverse';
  }
  // Read the CACHED decision. reanchorAll runs every tick AND inside the
  // pre-paint observer microtask, so it must never force a style recalc; the flag
  // is (re)computed at render time, where computed styles are read anyway.
  function placeBefore(node) { return node.__mtPlaceBefore === true; }

  // ─── Sibling renderer ─────────────────────────────────────────────────
  function adjacentTrans(node) {
    if (isCell(node)) {
      const c = node.lastElementChild;
      return (c && c.classList && c.classList.contains(CLASS)) ? c : null;
    }
    const s = placeBefore(node) ? node.previousElementSibling : node.nextElementSibling;
    return (s && s.classList && s.classList.contains(CLASS)) ? s : null;
  }
  function anchor(node, el) {
    // A cell holds its translation as its LAST CHILD — see isCell. Re-appending an
    // element that is already last is a no-op in the DOM, but guard anyway so an SPA
    // re-render doesn't churn.
    if (isCell(node)) { if (node.lastElementChild !== el) node.appendChild(el); return; }
    const before = placeBefore(node);
    if ((before ? node.previousElementSibling : node.nextElementSibling) !== el) {
      node.insertAdjacentElement(before ? 'beforebegin' : 'afterend', el);
    }
  }
  // Anchor ONE translation div immediately after `node`. SPA frameworks (React on
  // Substack, etc.) re-render their container and DISPLACE our injected sibling to the
  // end of the container — so we track the translation on the node itself
  // (`node.__mtTrans`) rather than trusting `nextElementSibling`. That lets us reuse it
  // (never create a duplicate) and always re-anchor it right after the node. Without this
  // the translations pile up at the container end and the page reads as "英文一块 / 中文
  // 一块" instead of interleaved.
  function ensureSibling(node) {
    node.__mtPlaceBefore = computePlacement(node);                    // refresh before adopting/anchoring
    let d = node.__mtTrans;
    if (d && !d.isConnected) d = null;                                // was removed
    if (d && d.dataset.interleave === '1') { d.remove(); d = null; }  // was an interleave holder
    if (!d) {
      d = adjacentTrans(node);                                        // adopt an adjacent one if present
      if (d && d.dataset.interleave === '1') { d.remove(); d = null; }
      if (!d) { d = document.createElement('div'); d.className = CLASS; }
      node.__mtTrans = d;
    }
    anchor(node, d);
    return d;
  }
  // Hide/restore the original for the interleave path. The attribute VALUE
  // carries the page's own prior inline `display` ('1' = none), mirroring the
  // data-mt-flow-fix pattern — so restore puts back exactly what the page had,
  // never a blanket ''. The hasAttribute guard in hideOriginal matters: a
  // re-render hides an already-hidden node and must not clobber the recorded
  // value with 'none'.
  function hideOriginal(node) {
    if (!node.hasAttribute('data-mt-hidden')) {
      node.setAttribute('data-mt-hidden', node.style.display || '1');
      // Expando twin: the attribute is page-writable — a framework that
      // reconciles attributes can strip it mid-session, which would turn
      // restoreOriginal into a no-op and leave the original display:none
      // forever. The JS property survives attribute stripping.
      node.__mtPrevDisplay = node.style.display || '1';
    }
    node.style.display = 'none';
  }
  function restoreOriginal(node) {
    const prev = node.hasAttribute('data-mt-hidden')
      ? node.getAttribute('data-mt-hidden')
      : node.__mtPrevDisplay; // attribute stripped by the page — expando fallback
    if (prev == null) return;
    node.style.display = (prev && prev !== '1') ? prev : '';
    node.removeAttribute('data-mt-hidden');
    delete node.__mtPrevDisplay;
  }

  // Long-press (or right-click) a translation to save that sentence to the learning
  // corpus, bypassing the dwell/salience gate. Deliberately NOT a plain click:
  // interaction-spec requires that clicking body text produce no perceptible action,
  // and a tap-to-save would break that on every SPA re-render.
  const STAR_HOLD_MS = 550;
  function attachStarGesture(d, node) {
    if (d.__mtStarWired) return;
    d.__mtStarWired = true;
    let timer = null;
    const confirm = () => {
      let ok = false;
      try { ok = LearnCollector.star(node); } catch (_) {}
      if (!ok) return;
      // Confirmation lands on the sibling itself — never a page-level toast.
      const prev = d.style.outline;
      d.style.outline = '2px solid currentColor';
      setTimeout(() => { d.style.outline = prev; }, 450);
    };
    const start = () => { clearTimeout(timer); timer = setTimeout(confirm, STAR_HOLD_MS); };
    const cancel = () => { clearTimeout(timer); timer = null; };
    d.addEventListener('pointerdown', start);
    d.addEventListener('pointerup', cancel);
    d.addEventListener('pointerleave', cancel);
    d.addEventListener('pointercancel', cancel);
    // typeof guard: this runs inside the PAGE's contextmenu dispatch — if
    // learn-collector failed to load, a bare reference would throw mid-dispatch
    // (the try around attachStarGesture only guards the wiring, not invocation).
    d.addEventListener('contextmenu', (e) => { if (typeof LearnCollector !== 'undefined' && LearnCollector.isOn) { e.preventDefault(); confirm(); } });
  }

  function renderUnit(u, st) {
    const node = u.node;
    if (st.state === 'pending') {
      restoreOriginal(node);
      const d = ensureSibling(node); d.onclick = null;
      d.style.cssText = 'color:#888;margin:2px 0;font-size:.9em;font-style:italic;display:block;white-space:pre-wrap;' + placementCss(node);
      d.textContent = TranslationCore.MSG.loading;
      return;
    }
    if (st.state === 'error') {
      restoreOriginal(node);
      const d = ensureSibling(node);
      d.style.cssText = 'color:#c0392b;margin:2px 0;font-size:.9em;cursor:pointer;display:block;' + placementCss(node);
      d.textContent = TranslationCore.MSG.error;
      d.onclick = () => { engine.retry(u); u._shownKey = ''; };
      return;
    }
    // Backstop for the targets the engine cannot pre-skip (Latin ones — script can't
    // separate English from French): a response identical to the original is not a
    // translation, so draw nothing and fall through to the no-sibling branch. Strict
    // equality after whitespace normalisation only — never a similarity guess, which
    // could suppress a real translation.
    const sameAsOriginal = st.translation && norm(st.translation) === norm(u.text);
    if (st.translation && !sameAsOriginal) {
      // Learning layer: a SINK, never a source (domain-design §9.1). This is the
      // one line that feeds it, placed here — after the same-language backstop —
      // so only genuine translations are ever captured. It must not be able to
      // affect anything below it, hence the try/catch: if capture throws, the
      // renderer carries on byte-for-byte as if the learning layer did not exist.
      try { LearnCollector.observe(node, u.text, st.translation); } catch (_) {}

      const pairs = pairForInterleave(node, u.text, st.translation);
      if (pairs) {
        renderInterleaved(node, pairs); // single blob → interleave
      } else {
        restoreOriginal(node);
        const d = ensureSibling(node); d.onclick = null;
        d.style.cssText = transStyle(node) + placementCss(node);
        buildRichText(st.translation, d);
        try { attachStarGesture(d, node); } catch (_) {}
      }
      return;
    }
    // nothing to translate → no sibling
    restoreOriginal(node);
    if (node.__mtTrans) { node.__mtTrans.remove(); node.__mtTrans = null; }
    else { const d = adjacentTrans(node); if (d) d.remove(); }
  }

  // Decide how to slice a single-blob unit for the interleave renderer, or return
  // null to keep the plain one-sibling rendering.
  //
  // Blank-line paragraphs come first — the original YouTube-description case. But
  // "paragraph" cannot mean *only* that: LINE-STRUCTURED text (a chapter list, lyrics,
  // a poem, a plain-text bullet list) separates entries with a SINGLE newline, so the
  // whole block used to count as one paragraph and rendered as N originals followed by
  // N translations — precisely what interaction-spec forbids ("never a whole block of
  // originals followed by a whole block of translations"). So fall back to pairing
  // line by line.
  //
  // Either way we pair ONLY when both sides yield the same count. A mis-pair would
  // attach a translation to the wrong original, which is worse than the whole-block
  // rendering we fall back to — fewer interleaves is acceptable, mis-pairing is not.
  // Blank lines are dropped on both sides before counting so they can't skew it.
  // Interaction rule (interaction-spec): the interleave redraw is PLAIN TEXT with
  // the source hidden — anything interactive or non-text inside the original
  // (links, buttons, media, code) would become unreachable, and EXCLUDE_TAGS
  // content (whose text never enters u.text) would vanish outright. Bail to the
  // plain sibling rendering for those blobs: the original stays visible and fully
  // clickable — fewer interleaves is the accepted price. Bare `a` (not `a[href]`):
  // an href-less anchor is almost always JS-wired. Residual blind spot, accepted:
  // an addEventListener-wired plain <span> carries no attribute signature and
  // cannot be detected.
  const INTERLEAVE_UNSAFE =
    'a,button,input,select,textarea,label,summary,details,' +
    '[onclick],[onmousedown],[onmouseup],[onpointerdown],[ontouchstart],[onkeydown],' +
    '[tabindex],[contenteditable],' +
    '[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],' +
    '[role="option"],[role="switch"],[role="slider"],[role="menuitemcheckbox"],[role="radio"],' +
    'img,svg,picture,video,audio,canvas,iframe,embed,object,' +
    'code,pre,kbd,samp,var,math';
  // Custom elements are invisible to the selector (their interactivity lives in
  // shadow DOM, which matches()/querySelector() never cross) — a Lit/Stencil
  // widget inside a blob would be content-vanished by the plain-text redraw.
  // A dash in the tag name IS the custom-element signature; an attached
  // shadowRoot catches built-ins upgraded via attachShadow.
  function interleaveUnsafe(node) {
    if (node.matches(INTERLEAVE_UNSAFE) || node.querySelector(INTERLEAVE_UNSAFE)) return true;
    if (node.tagName.indexOf('-') >= 0 || node.shadowRoot) return true;
    for (const el of node.querySelectorAll('*')) {
      if (el.tagName.indexOf('-') >= 0 || el.shadowRoot) return true;
    }
    return false;
  }
  function pairForInterleave(node, orig, trans) {
    // The interleave path HIDES the original and draws its own holder. A cell holds
    // its translation as a CHILD (see isCell), so hiding the cell would hide the
    // holder with it — the pair would vanish entirely. Cells keep the plain
    // one-child rendering; a table cell carrying a multi-paragraph blob is rare
    // enough that this is a cheaper guarantee than making interleave cell-aware.
    if (isCell(node)) return null;
    if (interleaveUnsafe(node)) return null;
    const paras = (s) => s.split(/\n{2,}/).filter((x) => x.trim());
    const lines = (s) => s.split('\n').filter((x) => x.trim());
    // Line-wise slicing is valid ONLY where the newlines are real. In normal HTML a
    // newline between inline elements is source formatting and renders as a SPACE —
    // but getTextContent keeps it, so splitting on it would shred an ordinary
    // paragraph into fake lines (caught by fixture 24, whose spans sit on separate
    // source lines). Only white-space:pre* renders a newline as a line break, which is
    // what a chapter list / lyrics / a tweet body uses.
    const pre = preservesNewlines(node);
    const same = (a, b) => a.length > 1 && a.length === b.length;

    const op = paras(orig), tp = paras(trans);
    let pairs = null;
    if (same(op, tp)) pairs = op.map((o, i) => ({ o, t: tp[i], tight: false }));
    else if (pre) {
      const ol = lines(orig), tl = lines(trans);
      if (same(ol, tl)) pairs = ol.map((o, i) => ({ o, t: tl[i], tight: true }));
    }
    if (!pairs) return null;

    // A blank-line paragraph can ITSELF be line-structured — the motivating case is a
    // tweet whose second paragraph is a 30-line chapter list. Pairing only at
    // paragraph level would render those 30 originals above 30 translations, the exact
    // shape the spec forbids. So expand every paragraph that is line-structured on
    // both sides; leave the rest alone.
    if (pre) {
      const out = [];
      for (const p of pairs) {
        const ol = lines(p.o), tl = lines(p.t);
        if (same(ol, tl)) ol.forEach((o, i) => out.push({ o, t: tl[i], tight: true }));
        else out.push(p);
      }
      pairs = out;
    }
    return pairs;
  }
  function preservesNewlines(node) {
    let cs = null; try { cs = node && getComputedStyle(node); } catch (_) { cs = null; }
    return !!(cs && /^(pre|pre-wrap|pre-line|break-spaces)$/.test(cs.whiteSpace));
  }

  // Single-blob text: hide the original, draw our own holder with each original slice
  // immediately followed by its translation (interleave). `pairs` comes from
  // pairForInterleave; each carries `tight` = this slice is a LINE of a
  // line-structured block, not a blank-line paragraph, so it must not be pushed apart
  // by paragraph spacing (a chapter list would otherwise be stretched).
  function renderInterleaved(node, pairs) {
    node.__mtPlaceBefore = computePlacement(node);
    let holder = node.__mtTrans;
    if (holder && !holder.isConnected) holder = null;
    if (holder && holder.dataset.interleave !== '1') { holder.remove(); holder = null; } // was a plain sibling
    if (!holder) {
      holder = adjacentTrans(node);
      if (holder && holder.dataset.interleave !== '1') { holder.remove(); holder = null; }
      if (!holder) { holder = document.createElement('div'); holder.className = CLASS; holder.dataset.interleave = '1'; }
      node.__mtTrans = holder;
    }
    anchor(node, holder);
    // Copy the original's font onto the holder so the re-rendered original rows match
    // the source; translation rows additionally take the distinct color via transStyle.
    holder.style.cssText = 'display:block;margin:2px 0;' + fontCss(node) + placementCss(node);
    holder.textContent = '';
    // …and re-assert the original's own COLOR on the original rows. The holder is a
    // `.mt-translation` element, and bilingual.css colors that class with the
    // translation color — which the re-drawn originals would otherwise inherit,
    // rendering the whole block in one solid green. Color is the ONE property the
    // bilingual pair keeps distinct (interaction-spec), so losing it is the one thing
    // this path must not do. Reading it works even on a re-render, when the source is
    // already display:none: `color` is a computed, inherited value either way.
    const origColor = origColorOf(node);
    for (const p of pairs) {
      const o = document.createElement('div');
      o.style.cssText = 'white-space:pre-wrap;' + (p.tight ? 'margin-top:2px;' : 'margin-top:6px;') + origColor;
      buildRichText(p.o, o); holder.appendChild(o);
      // The skip decision is per UNIT but display is per SLICE: a paragraph that
      // legitimately needs translating (it quotes foreign words) can still contain an
      // individual line that comes back unchanged. Draw the original alone for those —
      // same rule as the whole-unit backstop, applied at the granularity the user sees.
      if (norm(p.t) === norm(p.o)) continue;
      const t = document.createElement('div'); t.style.cssText = transStyle(node); buildRichText(p.t, t); holder.appendChild(t);
    }
    hideOriginal(node);
  }

  // ─── SPA re-render fix-up (paint-safe) ─────────────────────────────────
  // A click on a Substack article makes React re-render the article — and (verified
  // live with in-page instrumentation) it MOVES the existing nodes (remove+insert of
  // the SAME objects), it does not replace them. A moved paragraph gets re-inserted
  // relative to React's own children, leaving our sibling translation div ORDER-
  // DISPLACED (e.g. the div ends up before its paragraph). Units stay connected, so
  // orphan adoption has nothing to do; the repair that matters is the cheap
  // RE-ANCHOR pass (fix `nextElementSibling` ordering). Waiting for the next tick
  // (350ms cadence) let the displaced order PAINT — the visible "click flash"
  // (content below the click shifted for ~140-300ms, then snapped back).
  //
  // A MutationObserver callback runs at the microtask checkpoint of the SAME task
  // that mutated — BEFORE the browser paints — so re-anchoring here means the
  // displaced state never reaches the screen. Adoption for genuinely REPLACED
  // nodes stays on the ~1s recollect poll — NEVER in the observer: a full-DOM
  // walk on attacker/feed-controlled mutation cadence is a freeze vector.
  //
  // Loop safety (the YouTube "Poll, don't observe" freeze gotcha — AGENTS.md): this
  // observer never drives the display (tick still does), watches childList ONLY
  // (our style/attribute writes are invisible to it), and IGNORES mutation batches
  // where every added/removed Element is our own (mt-translation divs / mt-* ids) —
  // so our own div moves can never re-trigger it. The ~1s poll remains the backstop.
  function isOwnEl(n) {
    return n.nodeType === 1 && (
      (n.classList && (n.classList.contains(CLASS) || n.classList.contains('mt-translate-chip'))) ||
      (n.id && n.id.indexOf('mt-') === 0) ||
      (n.getAttribute && n.getAttribute('translate') === 'no')); // every own-UI root carries this (hardSkip contract)
  }
  // A record is ours when its TARGET lives inside our UI too — our own renders
  // (rich-text <a> children inside a translation div, interleave rows, overlay
  // line swaps) add classless elements whose parent is ours; without this check
  // they'd mark the batch "real" and self-trigger reanchor+recollect churn.
  function isOwnRecord(r) {
    const t = r.target;
    if (!t || t.nodeType !== 1) return false;
    return isOwnEl(t) || !!(t.closest && t.closest('.' + CLASS + ',[id^="mt-"]'));
  }
  // Keep every connected unit's translation glued right after its node (same rule
  // tick applies; shared here so the observer can run it pre-paint).
  function reanchorAll() {
    for (const u of units) {
      if (!u.node.isConnected) continue;
      const t = u.node.__mtTrans;
      if (t && t.isConnected) anchor(u.node, t); // reads the cached side — no style recalc
    }
  }
  // ─── Selection preservation across SPA re-renders ──────────────────────
  // The same re-render that displaces our divs MOVES the page's own paragraph
  // nodes (remove+insert of the same objects) — and a move that contains a
  // selection endpoint DESTROYS the user's live selection. Verified on
  // lennysnewsletter.com (2026-08-12): selecting text triggers a React commit
  // that performs ZERO paragraph mutations without our siblings and hundreds
  // with them; the user-visible symptom is 「高亮闪一下就没」. reanchorAll repairs
  // the visual order pre-paint; this repairs the selection in the SAME
  // microtask. React re-inserts the same node objects, so the snapshot's
  // endpoints are still connected and setBaseAndExtent restores the identical
  // range before the collapsed state can paint.
  //
  // Guards (each one is load-bearing):
  //   • restore runs ONLY in the mutation-observer microtask — a page script
  //     calling removeAllRanges() produces no childList batch, so a deliberate
  //     programmatic deselect is never fought;
  //   • a user gesture (pointerdown/keydown) AFTER the snapshot means the user
  //     deselected on purpose — never restore over that;
  //   • bounded per gesture (MAX_SEL_RESTORES) — a page whose re-render keeps
  //     re-killing the restored selection wins after that, the FAB-remount
  //     philosophy (issue #30). Convergence on real pages comes from their
  //     render being memoized on the selection: re-asserting the same range is
  //     a state bailout, not another commit.
  const MAX_SEL_RESTORES = 8;
  // The two suppression windows the quiet-collapse drop depends on. A collapse
  // within BATCH_ADJACENT_MS of a real childList batch is (or is about to be)
  // the SPA kill — keep the snapshot so the microtask repair can use it. A
  // collapse within GESTURE_RECENT_MS of a pointer/key/input gesture is the
  // user deselecting. Outside both windows the page cleared the selection
  // programmatically on purpose — drop the snapshot. 200ms covers task-queue
  // lag between a mutation and its selectionchange event; 800ms covers the
  // gesture→collapse gap of a slow tap. Fixture 36's quiet-clear case pins this.
  const BATCH_ADJACENT_MS = 200;
  const GESTURE_RECENT_MS = 800;
  let selSnap = null;        // { a, aOff, f, fOff, at, dc }
  let selRestores = 0;
  let lastGestureAt = 0;
  let lastRealBatchAt = 0;   // set by onDomMutations on every REAL batch
  // Predicates shared by restore and snapshot-overwrite decisions. A damaged
  // selection either keeps a snapshot endpoint (partial kill) or has an
  // endpoint clamped onto an ancestor of one (whole-container storm).
  function atSnapEndpoint(n, o) {
    return (n === selSnap.a && o === selSnap.aOff) || (n === selSnap.f && o === selSnap.fOff);
  }
  function clampedOntoSnap(n) {
    return !!(n && n.nodeType === 1 && (n.contains(selSnap.a) || n.contains(selSnap.f)));
  }
  function matchesSnap(s) {
    return !!(selSnap && s.rangeCount && !s.isCollapsed
      && atSnapEndpoint(s.anchorNode, s.anchorOffset) && atSnapEndpoint(s.focusNode, s.focusOffset));
  }
  function onUserGesture() { lastGestureAt = Date.now(); selRestores = 0; }
  // Keys are gestures only when they change the selection. Ctrl+C, PageDown,
  // arrow-scrolling all fire keydown while the selection stays exactly the
  // snapshot — disarming there would kill the repair precisely when the user
  // is USING the selection (copying it). A key that genuinely deselects still
  // lands in the quiet-collapse drop in onSelectionChange.
  function onKeyGesture() {
    if (matchesSnap(document.getSelection())) return;
    onUserGesture();
  }
  // Editors (input/textarea/contenteditable) manage their own selection — the
  // keeper must never snapshot there, or a stale restore moves the user's caret
  // (IME, dictation, async framework commits). isContentEditable handles both
  // inheritance and ="false"; element-node endpoints matter because an
  // input-internal selection can surface the <input> itself as the boundary.
  function inEditor(n) {
    const el = n ? (n.nodeType === 1 ? n : n.parentElement) : null;
    return !!el && (el.isContentEditable || !!(el.closest && el.closest('input,textarea')));
  }
  function onSelectionChange() {
    const s = document.getSelection();
    if (!s) return;
    if (s.rangeCount === 0 || s.isCollapsed) {
      // A collapse right after a real mutation batch is the SPA kill — already
      // repaired pre-paint by the time this (task-queued) event fires, or about
      // to be on the next batch. A collapse with NO recent batch and NO recent
      // gesture is the page or the user deselecting on purpose: drop the
      // snapshot so a later unrelated batch can never resurrect a selection
      // that was deliberately cleared.
      if (Date.now() - lastRealBatchAt > BATCH_ADJACENT_MS && Date.now() - lastGestureAt > GESTURE_RECENT_MS) selSnap = null;
      return;
    }
    if (inEditor(s.anchorNode) || inEditor(s.focusNode)) { selSnap = null; return; }
    // A batch storm heavier than the per-frame fix-up cap can land a kill that
    // never got repaired — the damaged selection then arrives HERE and must not
    // overwrite the good snapshot (later batches would "repair" to the damaged
    // state). Only batch-adjacent damage-shaped selections are refused; a user
    // extending a selection (shares the anchor) on a quiet page still updates.
    if (selSnap && Date.now() - lastRealBatchAt < BATCH_ADJACENT_MS && !matchesSnap(s)
        && (atSnapEndpoint(s.anchorNode, s.anchorOffset) || atSnapEndpoint(s.focusNode, s.focusOffset)
          || clampedOntoSnap(s.anchorNode) || clampedOntoSnap(s.focusNode))) {
      return;
    }
    selSnap = { a: s.anchorNode, aOff: s.anchorOffset, f: s.focusNode, fOff: s.focusOffset, at: Date.now(), dc: 0 };
  }
  function restoreSelection() {
    if (!selSnap || selRestores >= MAX_SEL_RESTORES) return;
    if (lastGestureAt > selSnap.at) return;                   // deliberate deselect
    const s = document.getSelection();
    if (!s) return;
    // A node move damages the selection three ways: full collapse, a PARTIAL
    // kill (Chrome's range fix-up slides ONE endpoint to a neighbour — half the
    // highlight silently gone), or a CLAMP (both endpoints re-anchored onto an
    // ancestor when every containing node moved — fixture 33's whole-article
    // storm produces exactly this). Identical-to-snapshot means intact. A
    // non-collapsed selection that is NOT damage-shaped — shares no snapshot
    // endpoint and no endpoint is an ancestor of one — is the PAGE's own
    // programmatic selection made in the same task as its DOM work (a "copy
    // code" button, select-all in a viewer): never stomp it, and DROP the
    // snapshot so a later batch cannot resurrect the stale range either.
    if (s.rangeCount && !s.isCollapsed) {
      if (matchesSnap(s)) return;
      const damage = atSnapEndpoint(s.anchorNode, s.anchorOffset) || atSnapEndpoint(s.focusNode, s.focusOffset)
        || clampedOntoSnap(s.anchorNode) || clampedOntoSnap(s.focusNode);
      if (!damage) { selSnap = null; return; }
    }
    const { a, f, aOff, fOff } = selSnap;
    // Endpoints disconnected NOW — KEEP the snapshot briefly: a time-sliced SPA
    // (React 18) can detach a node in one task and re-insert the SAME node a
    // task later (see recollect), so the next batch may find them reconnected
    // and still repair. But BOUNDED — content genuinely replaced never
    // reconnects, and an unbounded snapshot pins the whole detached subtree in
    // memory: after 20 disconnected batches or 60s of age, drop it.
    if (!a || !f || !a.isConnected || !f.isConnected) {
      selSnap.dc = (selSnap.dc || 0) + 1;
      if (selSnap.dc > 20 || Date.now() - selSnap.at > 60000) selSnap = null;
      return;
    }
    // The page may have MOVED the endpoints inside an editor since the snapshot
    // (click-to-edit conversion adopting the text nodes) — restoring there would
    // stomp the editor framework's caret.
    if (inEditor(a) || inEditor(f)) { selSnap = null; return; }
    selRestores++;
    try { s.setBaseAndExtent(a, aOff, f, fOff); } catch (_) { /* offsets stale — content changed */ }
  }
  function installSelectionKeeper() {
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onUserGesture, true);
    document.addEventListener('keydown', onKeyGesture, true);
    // IME composition, dictation and context-menu paste produce NO keydown —
    // they must still count as user gestures or a stale restore fights them.
    document.addEventListener('beforeinput', onUserGesture, true);
    document.addEventListener('compositionstart', onUserGesture, true);
  }
  function removeSelectionKeeper() {
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('pointerdown', onUserGesture, true);
    document.removeEventListener('keydown', onKeyGesture, true);
    document.removeEventListener('beforeinput', onUserGesture, true);
    document.removeEventListener('compositionstart', onUserGesture, true);
    selSnap = null; selRestores = 0;
  }

  let obsScheduled = false;
  let obsFixupsThisFrame = 0;
  let obsFrameReset = false;
  function onDomMutations(records) {
    if (!active) return;
    let real = false;
    for (const r of records) {
      if (isOwnRecord(r)) continue; // mutations INSIDE our UI (rich-text <a>, overlay swaps)
      for (const n of r.addedNodes) if (!real && !isOwnEl(n) && n.nodeType === 1) real = true;
      for (const n of r.removedNodes) if (!real && !isOwnEl(n) && n.nodeType === 1) real = true;
      if (real) break;
    }
    if (!real) return;
    lastRealBatchAt = Date.now(); // selection keeper: batch-adjacency signal
    // Coalesce all callbacks of the current task into ONE trailing fix-up via
    // queueMicrotask — still ahead of the paint. ONLY the cheap O(units)
    // re-anchor runs here: no DOM walk, no computed styles, so a mutation-chatty
    // (or hostile) page can at worst make us loop over our own divs once per
    // task — never force a full-document recollect (that stays on the ~1s poll,
    // which also owns orphan adoption for genuinely REPLACED nodes; the verified
    // zero-flash repro needed only the re-anchor: React MOVES nodes, it doesn't
    // replace them).
    if (obsScheduled) return;
    obsScheduled = true;
    queueMicrotask(() => {
      obsScheduled = false;
      if (!active) return;
      // Circuit breaker: a page-side MutationObserver that re-displaces our divs
      // in response to our re-anchor would ping-pong with us entirely in
      // microtasks — never yielding to paint (the AGENTS.md observer-freeze
      // class). Cap fix-ups per frame; past the cap, the 350ms tick backstops.
      if (obsFixupsThisFrame >= 8) return;
      obsFixupsThisFrame++;
      if (!obsFrameReset) {
        obsFrameReset = true;
        requestAnimationFrame(() => { obsFrameReset = false; obsFixupsThisFrame = 0; });
      }
      reanchorAll(); // the anti-flash repair — bounded, loop-proof
      restoreSelection(); // the anti-selection-kill repair — same paint, same bounds
    });
  }
  function installDomObserver() {
    if (domObs) return;
    domObs = new MutationObserver(onDomMutations);
    domObs.observe(document.body, { childList: true, subtree: true });
  }
  function removeDomObserver() { if (domObs) { domObs.disconnect(); domObs = null; } }

  // ─── Viewport-change invalidation (issue #28) ─────────────────────────
  // layoutCss / flowFixCss freeze VIEWPORT-TIME pixel geometry into inline styles
  // (a px max-width cap, a px inline-start indent, flex-basis:100% + the parent's
  // wrap mutation), and tick() only re-renders a unit when its state key changes.
  // So a rotation, a window resize or a media-query breakpoint leaves every
  // settled translation mirroring the OLD viewport — a stale cap that squeezes
  // the text, and, when a row flips to a column, a stranded wrap fix that only an
  // unrelated re-render would revert.
  //
  // The repair is deliberately not a second layout path: we just DROP the frozen
  // state and re-arm the render key, so the next tick walks the exact same
  // renderUnit → flowFixCss/layoutCss code as a first render (which re-measures
  // and, in a column, calls undoFlowFix). Debounced because a rotation fires
  // `resize` many times and each intermediate size is meaningless.
  let resizeTimer = null;
  function invalidateGeometry() {
    for (const u of units) {
      const node = u.node;
      if (!node.isConnected) continue;
      if (node.hasAttribute('data-mt-hidden')) {
        // The interleave path hides its original, so it measures 0×0 and layoutCss
        // would fall back to the pre-resize cache — the stale mirror survives the
        // resize. Restore display, re-measure, hide again, all synchronously in
        // this task: the browser cannot paint in between, so nothing flashes.
        const prev = node.style.display;
        node.style.display = '';
        node.__mtLayoutCold = 0;
        layoutCss(node);                 // refreshes node.__mtLayoutCss for the read path
        node.style.display = prev;
      } else {
        node.__mtLayoutCold = 0;         // a node that gave up (-1) mid-animation gets a fresh chance
      }
      u._shownKey = '';                  // next tick re-renders → re-measures + re-runs the flow fix
    }
  }
  function onViewportChange() {
    if (!active) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; if (active) invalidateGeometry(); }, 200);
  }
  function installViewportListeners() {
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
  }
  function removeViewportListeners() {
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
  }

  // ─── Display loop ─────────────────────────────────────────────────────
  function tick() {
    if (!active || !engine) return;
    tickCount++;
    if (tickCount % 3 === 1) recollect(document.body); // SPA poll ~every 3rd tick
    engine.pump();
    reanchorAll(); // SPA re-anchor backstop (the observer already fixed order pre-paint)
    restoreSelection(); // backstop for kills the capped observer microtask missed (>8 batches/frame)
    for (const u of engine.units) {
      if (!u.node.isConnected) continue;
      const near = inViewport(u.node);
      const st = engine.stateOf(u);
      // __mtLayoutCold: layoutCss bailed with no cached mirror (mid-animation /
      // hidden) — vary the key each tick so the unit re-renders until it measures.
      const key = st.state + '|' + (st.translation ? 'T' : '') + (u.node.__mtLayoutCold > 0 ? '|c' + tickCount : '');
      if (u._shownKey === key) continue;
      if (!u._rendered && !near) continue; // don't render far-offscreen untranslated
      renderUnit(u, st);
      u._shownKey = key; u._rendered = true;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────
  function enable(cfg) {
    settings = cfg;
    if (active) return; // idempotent: ignore a double-enable (message + storage.onChanged
                        // both fire on the first translate; the 2nd must not wipe the engine)
    active = true;
    engine = makeEngine();
    units = []; known = new WeakSet();
    // Self-heal orphaned hide markers: a content-script reload (extension
    // update, dev reload) loses all in-memory state while data-mt-hidden +
    // display:none persist in the DOM — the fresh collector would then skip
    // those invisible originals forever. Also neutralizes any marker a page
    // PRE-SET to poison the record-restore round-trip (an invalid recorded
    // value is a no-op CSSOM write). Runs before recollect so healed nodes are
    // collectable again.
    document.querySelectorAll('[data-mt-hidden]').forEach(restoreOriginal);
    recollect(document.body);
    installDomObserver();
    installSelectionKeeper();
    installViewportListeners();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 350);
    tick();
  }

  function disable() {
    active = false;
    removeDomObserver();
    removeSelectionKeeper();
    removeViewportListeners();
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    // Per-unit cleanup first — reaches translations injected inside shadow roots
    // (document.querySelectorAll cannot cross shadow boundaries).
    for (const u of units) {
      const node = u.node;
      if (!node || !node.removeAttribute) continue;
      const sib = node.__mtTrans || adjacentTrans(node); if (sib) sib.remove();
      node.__mtTrans = null;
      node.removeAttribute(PROCESSED);
      node.removeAttribute(DOMProcessor.TRANSLATABLE_ATTR);
      restoreOriginal(node); // puts back the page's own prior inline display
      undoFlowFix(node.parentElement); // undo the flex-row wrap fix (see flowFixCss)
    }
    document.querySelectorAll('.' + CLASS).forEach((e) => e.remove());
    document.querySelectorAll('[' + PROCESSED + ']').forEach((e) => e.removeAttribute(PROCESSED));
    document.querySelectorAll('[data-mt-hidden]').forEach(restoreOriginal);
    document.querySelectorAll('[' + DOMProcessor.TRANSLATABLE_ATTR + ']').forEach((e) => e.removeAttribute(DOMProcessor.TRANSLATABLE_ATTR));
    document.querySelectorAll('[data-mt-flow-fix]').forEach(undoFlowFix);
    units = [];
    engine = null;
  }

  function updateSettings(cfg) {
    settings = cfg;
    if (active) { disable(); enable(cfg); } // re-translate with new engine (cache-first)
  }

  function init(cfg) { settings = cfg; if (cfg.enabled) enable(cfg); }

  return { init, enable, disable, updateSettings };
})();
