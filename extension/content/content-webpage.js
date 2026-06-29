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
        settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || ''),
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
    units = units.filter((u) => u.node.isConnected);
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

  function transStyle() { return `color:${settings.textColor || '#0a7a3c'};margin:2px 0;font-size:${settings.fontSize || '0.95em'};line-height:1.4;display:block;white-space:pre-wrap;`; }

  // ─── Sibling renderer ─────────────────────────────────────────────────
  function siblingOf(node) { const s = node.nextElementSibling; return (s && s.classList && s.classList.contains(CLASS)) ? s : null; }
  function ensureSibling(node) {
    let d = siblingOf(node);
    if (d && d.dataset.interleave === '1') { d.remove(); d = null; } // was an interleave holder
    if (!d) { d = document.createElement('div'); d.className = CLASS; node.insertAdjacentElement('afterend', d); }
    return d;
  }
  function restoreOriginal(node) { if (node.hasAttribute('data-mt-hidden')) { node.style.display = ''; node.removeAttribute('data-mt-hidden'); } }

  function renderUnit(u, st) {
    const node = u.node;
    if (st.state === 'pending') {
      restoreOriginal(node);
      const d = ensureSibling(node); d.onclick = null;
      d.style.cssText = 'color:#888;margin:2px 0;font-size:.9em;font-style:italic;display:block;white-space:pre-wrap;';
      d.textContent = TranslationCore.MSG.loading;
      return;
    }
    if (st.state === 'error') {
      restoreOriginal(node);
      const d = ensureSibling(node);
      d.style.cssText = 'color:#c0392b;margin:2px 0;font-size:.9em;cursor:pointer;display:block;';
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
        d.style.cssText = transStyle();
        buildRichText(st.translation, d);
      }
      return;
    }
    // nothing to translate → no sibling
    restoreOriginal(node);
    const d = siblingOf(node); if (d) d.remove();
  }

  // Single-blob text with internal paragraphs: hide the original, draw our own
  // holder with each original paragraph followed by its translation (interleave).
  function renderInterleaved(node, oParas, tParas) {
    let holder = siblingOf(node);
    if (holder && holder.dataset.interleave !== '1') { holder.remove(); holder = null; }
    if (!holder) { holder = document.createElement('div'); holder.className = CLASS; holder.dataset.interleave = '1'; node.insertAdjacentElement('afterend', holder); }
    holder.style.cssText = 'display:block;margin:2px 0;';
    holder.textContent = '';
    for (let i = 0; i < oParas.length; i++) {
      const o = document.createElement('div'); o.style.cssText = 'white-space:pre-wrap;line-height:1.4;margin-top:6px;'; buildRichText(oParas[i], o); holder.appendChild(o);
      const t = document.createElement('div'); t.style.cssText = transStyle(); buildRichText(tParas[i], t); holder.appendChild(t);
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
    settings = cfg; active = true;
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
    document.querySelectorAll('.' + CLASS).forEach((e) => e.remove());
    document.querySelectorAll('[' + PROCESSED + ']').forEach((e) => e.removeAttribute(PROCESSED));
    document.querySelectorAll('[data-mt-hidden]').forEach((e) => { e.style.display = ''; e.removeAttribute('data-mt-hidden'); });
    document.querySelectorAll('[' + DOMProcessor.TRANSLATABLE_ATTR + ']').forEach((e) => e.removeAttribute(DOMProcessor.TRANSLATABLE_ATTR));
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
