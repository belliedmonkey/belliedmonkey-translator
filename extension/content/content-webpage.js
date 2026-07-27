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
  function makeEngine() {
    return TranslationCore.createEngine({
      translate: (text) => TranslationAPI.translate(
        text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
        settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || '', settings.apiModel || ''),
      // viewport priority + lazy: only translate units in/near the viewport.
      selectActive: (us) => us.filter((u) => u.node.isConnected && inViewport(u.node)),
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
  function tsToSeconds(ts) { const p = ts.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
  function buildRichText(text, el) {
    el.textContent = '';
    text.split(/(https?:\/\/[^\s]+)/g).forEach((part) => {
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement('a');
        a.href = part; a.target = '_blank'; a.rel = 'noopener'; a.textContent = part; a.style.color = '#3ea6ff';
        el.appendChild(a); return;
      }
      let last = 0; const re = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g; let m;
      while ((m = re.exec(part))) {
        if (m.index > last) el.appendChild(document.createTextNode(part.slice(last, m.index)));
        const ts = m[0]; const a = document.createElement('a');
        a.textContent = ts; a.style.cssText = 'color:#3ea6ff;cursor:pointer;';
        a.addEventListener('click', (e) => { e.preventDefault(); const v = document.querySelector('video'); if (v) v.currentTime = tsToSeconds(ts); });
        el.appendChild(a); last = m.index + ts.length;
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
  function transStyle(node) { return `color:${settings.textColor || '#0a7a3c'};margin:2px 0;display:block;white-space:pre-wrap;` + fontCss(node); }
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
    const s = placeBefore(node) ? node.previousElementSibling : node.nextElementSibling;
    return (s && s.classList && s.classList.contains(CLASS)) ? s : null;
  }
  function anchor(node, el) {
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
  function restoreOriginal(node) { if (node.hasAttribute('data-mt-hidden')) { node.style.display = ''; node.removeAttribute('data-mt-hidden'); } }

  function renderUnit(u, st) {
    const node = u.node;
    if (st.state === 'pending') {
      restoreOriginal(node);
      const d = ensureSibling(node); d.onclick = null;
      d.style.cssText = 'color:#888;margin:2px 0;font-size:.9em;font-style:italic;display:block;white-space:pre-wrap;' + flowFixCss(node) + layoutCss(node);
      d.textContent = TranslationCore.MSG.loading;
      return;
    }
    if (st.state === 'error') {
      restoreOriginal(node);
      const d = ensureSibling(node);
      d.style.cssText = 'color:#c0392b;margin:2px 0;font-size:.9em;cursor:pointer;display:block;' + flowFixCss(node) + layoutCss(node);
      d.textContent = TranslationCore.MSG.error;
      d.onclick = () => { engine.retry(u); u._shownKey = ''; };
      return;
    }
    if (st.translation) {
      const pairs = pairForInterleave(node, u.text, st.translation);
      if (pairs) {
        renderInterleaved(node, pairs); // single blob → interleave
      } else {
        restoreOriginal(node);
        const d = ensureSibling(node); d.onclick = null;
        d.style.cssText = transStyle(node) + flowFixCss(node) + layoutCss(node);
        buildRichText(st.translation, d);
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
  function pairForInterleave(node, orig, trans) {
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
    holder.style.cssText = 'display:block;margin:2px 0;' + fontCss(node) + flowFixCss(node) + layoutCss(node);
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
      const t = document.createElement('div'); t.style.cssText = transStyle(node); buildRichText(p.t, t); holder.appendChild(t);
    }
    node.setAttribute('data-mt-hidden', '1');
    node.style.display = 'none';
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
    recollect(document.body);
    installDomObserver();
    installViewportListeners();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 350);
    tick();
  }

  function disable() {
    active = false;
    removeDomObserver();
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
      if (node.hasAttribute('data-mt-hidden')) { node.style.display = ''; node.removeAttribute('data-mt-hidden'); }
      undoFlowFix(node.parentElement); // undo the flex-row wrap fix (see flowFixCss)
    }
    document.querySelectorAll('.' + CLASS).forEach((e) => e.remove());
    document.querySelectorAll('[' + PROCESSED + ']').forEach((e) => e.removeAttribute(PROCESSED));
    document.querySelectorAll('[data-mt-hidden]').forEach((e) => { e.style.display = ''; e.removeAttribute('data-mt-hidden'); });
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
