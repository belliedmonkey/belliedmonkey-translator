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
    units = units.filter((u) => {
      if (u.node.isConnected) return true;
      // Node was removed by an SPA re-render — delete its now-orphaned translation so it
      // doesn't pile up at the container end (the "中英文分开" clustering bug).
      const t = u.node.__mtTrans;
      if (t && t.remove) t.remove();
      return false;
    });
    const fresh = DOMProcessor.collectUnits(root || document.body)
      .filter((n) => !known.has(n))
      .map((n) => {
        known.add(n);
        n.setAttribute(PROCESSED, '1'); // future walks prune this subtree (perf)
        return { node: n, text: DOMProcessor.getTextContent(n) };
      });
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
    return `font-family:${cs.fontFamily};font-size:${px.toFixed(1)}px;font-weight:${cs.fontWeight};font-style:${cs.fontStyle};line-height:${lh};${ls}`;
  }
  function transStyle(node) { return `color:${settings.textColor || '#0a7a3c'};margin:2px 0;display:block;white-space:pre-wrap;` + fontCss(node); }

  // A sibling translation injected into a flex/grid row becomes a flex/grid ITEM
  // placed inline next to the original (mobile YouTube metadata "4946次点赞 ·
  // 29万次观看 · 1年前", header, comment counts) — it overlaps and spills off the
  // row. Force it onto its own full-width line: in flex, flex-basis:100% + make the
  // row wrap (record nowrap→wrap for clean revert); in grid, span every column.
  function flowFixCss(node) {
    const p = node.parentElement;
    if (!p) return '';
    let cs; try { cs = getComputedStyle(p); } catch (_) { return ''; }
    const disp = cs.display;
    if (disp === 'flex' || disp === 'inline-flex') {
      if (cs.flexWrap === 'nowrap' && !p.hasAttribute('data-mt-flow-fix')) {
        p.style.flexWrap = 'wrap';
        p.setAttribute('data-mt-flow-fix', '1');
      }
      return 'flex-basis:100%;width:100%;';
    }
    if (disp === 'grid' || disp === 'inline-grid') return 'grid-column:1 / -1;';
    return '';
  }

  // ─── Sibling renderer ─────────────────────────────────────────────────
  function siblingOf(node) { const s = node.nextElementSibling; return (s && s.classList && s.classList.contains(CLASS)) ? s : null; }
  // Anchor ONE translation div immediately after `node`. SPA frameworks (React on
  // Substack, etc.) re-render their container and DISPLACE our injected sibling to the
  // end of the container — so we track the translation on the node itself
  // (`node.__mtTrans`) rather than trusting `nextElementSibling`. That lets us reuse it
  // (never create a duplicate) and always re-anchor it right after the node. Without this
  // the translations pile up at the container end and the page reads as "英文一块 / 中文
  // 一块" instead of interleaved.
  function ensureSibling(node) {
    let d = node.__mtTrans;
    if (d && !d.isConnected) d = null;                                // was removed
    if (d && d.dataset.interleave === '1') { d.remove(); d = null; }  // was an interleave holder
    if (!d) {
      d = siblingOf(node);                                            // adopt an adjacent one if present
      if (d && d.dataset.interleave === '1') { d.remove(); d = null; }
      if (!d) { d = document.createElement('div'); d.className = CLASS; }
      node.__mtTrans = d;
    }
    if (node.nextElementSibling !== d) node.insertAdjacentElement('afterend', d); // (re)anchor
    return d;
  }
  function restoreOriginal(node) { if (node.hasAttribute('data-mt-hidden')) { node.style.display = ''; node.removeAttribute('data-mt-hidden'); } }

  function renderUnit(u, st) {
    const node = u.node;
    if (st.state === 'pending') {
      restoreOriginal(node);
      const d = ensureSibling(node); d.onclick = null;
      d.style.cssText = 'color:#888;margin:2px 0;font-size:.9em;font-style:italic;display:block;white-space:pre-wrap;' + flowFixCss(node);
      d.textContent = TranslationCore.MSG.loading;
      return;
    }
    if (st.state === 'error') {
      restoreOriginal(node);
      const d = ensureSibling(node);
      d.style.cssText = 'color:#c0392b;margin:2px 0;font-size:.9em;cursor:pointer;display:block;' + flowFixCss(node);
      d.textContent = TranslationCore.MSG.error;
      d.onclick = () => { engine.retry(u); u._shownKey = ''; };
      return;
    }
    if (st.translation) {
      const oParas = u.text.split(/\n{2,}/);
      const tParas = st.translation.split(/\n{2,}/);
      if (oParas.length > 1 && oParas.length === tParas.length) {
        renderInterleaved(node, oParas, tParas); // single-blob multi-paragraph (e.g. YT description)
      } else {
        restoreOriginal(node);
        const d = ensureSibling(node); d.onclick = null;
        d.style.cssText = transStyle(node) + flowFixCss(node);
        buildRichText(st.translation, d);
      }
      return;
    }
    // nothing to translate → no sibling
    restoreOriginal(node);
    if (node.__mtTrans) { node.__mtTrans.remove(); node.__mtTrans = null; }
    else { const d = siblingOf(node); if (d) d.remove(); }
  }

  // Single-blob text with internal paragraphs: hide the original, draw our own
  // holder with each original paragraph followed by its translation (interleave).
  function renderInterleaved(node, oParas, tParas) {
    let holder = node.__mtTrans;
    if (holder && !holder.isConnected) holder = null;
    if (holder && holder.dataset.interleave !== '1') { holder.remove(); holder = null; } // was a plain sibling
    if (!holder) {
      holder = siblingOf(node);
      if (holder && holder.dataset.interleave !== '1') { holder.remove(); holder = null; }
      if (!holder) { holder = document.createElement('div'); holder.className = CLASS; holder.dataset.interleave = '1'; }
      node.__mtTrans = holder;
    }
    if (node.nextElementSibling !== holder) node.insertAdjacentElement('afterend', holder); // (re)anchor
    // Copy the original's font onto the holder so the re-rendered original rows match
    // the source; translation rows additionally take the distinct color via transStyle.
    holder.style.cssText = 'display:block;margin:2px 0;' + fontCss(node) + flowFixCss(node);
    holder.textContent = '';
    for (let i = 0; i < oParas.length; i++) {
      const o = document.createElement('div'); o.style.cssText = 'white-space:pre-wrap;margin-top:6px;'; buildRichText(oParas[i], o); holder.appendChild(o);
      const t = document.createElement('div'); t.style.cssText = transStyle(node); buildRichText(tParas[i], t); holder.appendChild(t);
    }
    node.setAttribute('data-mt-hidden', '1');
    node.style.display = 'none';
  }

  // ─── Display loop ─────────────────────────────────────────────────────
  function tick() {
    if (!active || !engine) return;
    tickCount++;
    if (tickCount % 3 === 1) recollect(document.body); // SPA poll ~every 3rd tick
    engine.pump();
    for (const u of engine.units) {
      if (!u.node.isConnected) continue;
      // SPA re-anchor: frameworks (React on Substack, etc.) re-render the container and
      // displace our translation away from its origin — it drifts to the container end and
      // the page reads as "英文一块/中文一块". Keep it glued right after the node every tick,
      // even when this unit's render state hasn't changed.
      const t = u.node.__mtTrans;
      if (t && t.isConnected && u.node.nextElementSibling !== t) u.node.insertAdjacentElement('afterend', t);
      const near = inViewport(u.node);
      const st = engine.stateOf(u);
      const key = st.state + '|' + (st.translation ? 'T' : '');
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
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 350);
    tick();
  }

  function disable() {
    active = false;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    // Per-unit cleanup first — reaches translations injected inside shadow roots
    // (document.querySelectorAll cannot cross shadow boundaries).
    for (const u of units) {
      const node = u.node;
      if (!node || !node.removeAttribute) continue;
      const sib = node.__mtTrans || siblingOf(node); if (sib) sib.remove();
      node.__mtTrans = null;
      node.removeAttribute(PROCESSED);
      node.removeAttribute(DOMProcessor.TRANSLATABLE_ATTR);
      if (node.hasAttribute('data-mt-hidden')) { node.style.display = ''; node.removeAttribute('data-mt-hidden'); }
      const p = node.parentElement; // undo the flex-row wrap fix (see flowFixCss)
      if (p && p.hasAttribute('data-mt-flow-fix')) { p.style.flexWrap = ''; p.removeAttribute('data-mt-flow-fix'); }
    }
    document.querySelectorAll('.' + CLASS).forEach((e) => e.remove());
    document.querySelectorAll('[' + PROCESSED + ']').forEach((e) => e.removeAttribute(PROCESSED));
    document.querySelectorAll('[data-mt-hidden]').forEach((e) => { e.style.display = ''; e.removeAttribute('data-mt-hidden'); });
    document.querySelectorAll('[' + DOMProcessor.TRANSLATABLE_ATTR + ']').forEach((e) => e.removeAttribute(DOMProcessor.TRANSLATABLE_ATTR));
    document.querySelectorAll('[data-mt-flow-fix]').forEach((e) => { e.style.flexWrap = ''; e.removeAttribute('data-mt-flow-fix'); });
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
