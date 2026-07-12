// translation-core.js — platform-agnostic translation engine.
//
// Pure logic + DOM measurement only. No platform selectors, no provider
// knowledge, no network. A caller (YouTube / a future audio or generic-video
// adapter) injects `getCurrentTime()` and `translate(text)` and gets back
// per-item translation STATE to render. Everything here is language-agnostic:
// it works for any target language, not just Chinese.

var TranslationCore = (() => {
  // ─── Constants ────────────────────────────────────────────────────────
  const DEFAULT_TARGET_LANG = 'zh-CN';
  const WINDOW = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 3, RETRY_GAP_MS: 800, GRACE_MS: 700 };
  const MERGE = { GAP_MS: 1200, MAX_LEN: 160 };

  // i18n: read a localized UI string with a Chinese fallback so a missing key never
  // blanks the UI. Shared by all adapters.
  //
  // The UI language defaults to the OS/browser locale but is user-overridable via the
  // `uiLang` setting. chrome.i18n.getMessage is locked to the browser locale and can't
  // be switched at runtime, so we consult the bundled `MT_I18N_MESSAGES` table (from
  // _locales/, loaded as a content script before this file) keyed by the effective
  // locale, then fall back to chrome.i18n, then the literal fallback.
  let _uiLang = 'auto'; // hydrated from storage below; 'auto' = follow the OS

  function normalizeLocale(tag) {
    const T = (typeof window !== 'undefined' && window.MT_I18N_MESSAGES) || {};
    if (!tag) return '';
    const s = String(tag).replace(/-/g, '_');
    if (T[s]) return s;                                   // exact, e.g. zh_CN
    const base = s.split('_')[0];
    if (base === 'zh') return T.zh_CN ? 'zh_CN' : (T.zh_TW ? 'zh_TW' : '');
    if (T[base]) return base;                             // en_US → en
    for (const k of Object.keys(T)) if (k.split('_')[0] === base) return k;
    return '';
  }

  function effectiveLocale() {
    if (_uiLang && _uiLang !== 'auto') { const n = normalizeLocale(_uiLang); if (n) return n; }
    try { const u = chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage(); const n = normalizeLocale(u); if (n) return n; } catch (_) {}
    return 'zh_CN';
  }

  function i18n(key, fallback) {
    try {
      const T = (typeof window !== 'undefined' && window.MT_I18N_MESSAGES);
      if (T) { const loc = effectiveLocale(); const m = T[loc] && T[loc][key]; if (m) return m; }
      const cm = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage(key));
      if (cm) return cm;
    } catch (_) {}
    return fallback;
  }

  // Hydrate the UI-language preference and keep it live (MSG getters re-read per use).
  try {
    chrome.storage.local.get('uiLang', (s) => { if (s && s.uiLang) _uiLang = s.uiLang; });
    chrome.storage.onChanged.addListener((ch) => { if (ch.uiLang) _uiLang = ch.uiLang.newValue || 'auto'; });
  } catch (_) {}

  // UI-chrome strings (getters so they reflect the active locale).
  const MSG = {
    get loading() { return i18n('msg_loading', '⏳ 翻译中…'); },
    get preparing() { return i18n('msg_preparing', '⏳ 译文准备中…'); },
    get error() { return i18n('msg_translate_failed_retry', '⚠️ 翻译失败,点此重试'); },
  };

  // ─── Language helpers (script-aware; work for every target language) ───
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const SENT_END = /[\p{Sentence_Terminal}…]["'’”)\]]?\s*$/u;

  // Success = produced non-empty output. Identical output is NOT a failure (a
  // number, a proper noun, or already-target-language text is legitimately
  // unchanged) — so we never reject a translation just because it equals input.
  function isTranslated(input, output) {
    return typeof output === 'string' && output.trim().length > 0;
  }

  function endsSentence(s) { return SENT_END.test(s); }

  // Join two cue fragments: no separator when both sides are CJK (no inter-word
  // spaces); a single space otherwise. Collapses runs of horizontal whitespace
  // but never forces a space into a no-space script.
  function joinCue(a, b) {
    if (!a) return (b || '').replace(/[^\S\n]{2,}/g, ' ').trim();
    if (!b) return a;
    const sep = CJK.test(a.slice(-1)) && CJK.test(b.slice(0, 1)) ? '' : ' ';
    return (a + sep + b).replace(/[^\S\n]{2,}/g, ' ').trim();
  }

  // Pick a break index near `cut`: prefer a whitespace boundary when one is
  // reasonably close (spaced scripts); otherwise break exactly at `cut` (CJK and
  // other no-space scripts can break at any grapheme).
  function wordBreakIndex(text, cut) {
    const sp = text.lastIndexOf(' ', cut);
    return sp > cut * 0.6 ? sp : cut;
  }

  // Heuristic: does this text look like source code / a data blob (not prose)?
  // Catches e.g. reddit's inline `SML.load([["id",332],…],'en-US/','auto')` so it
  // never gets translated. Language-agnostic (does not look at the target lang).
  function looksLikeCode(text) {
    if (!text) return false;
    const t = text.trim();
    if (/[\w$]\s*\.\s*\w+\s*\(\s*\[\[/.test(t)) return true;   // ident.method([[ …
    if (/\[\[\s*"[^"]*"\s*,\s*-?\d/.test(t)) return true;       // [["abc", 123] tuple arrays
    if (/\bfunction\s*\(|=>\s*\{|;\s*[\w$]+\s*\.\s*\w+\s*\(/.test(t)) return true; // JS fragments
    const punct = (t.match(/[\[\]{}();"'`<>=]/g) || []).length; // bracket/quote density
    if (t.length > 40 && punct / t.length > 0.2) return true;
    return false;
  }

  // ─── Cue merge: [{start,end,text}] → merged sentences ─────────────────
  function mergeSentences(cues, opt) {
    const o = opt || MERGE;
    const out = [];
    let cur = null;
    for (const c of cues) {
      if (cur && c.start - cur.end > o.GAP_MS) { out.push(cur); cur = null; }
      if (!cur) cur = { start: c.start, end: c.end, text: c.text };
      else { cur.text = joinCue(cur.text, c.text); cur.end = c.end; }
      if (endsSentence(cur.text) || cur.text.length > o.MAX_LEN) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  }

  // ─── Measure-based text pager (factory; owns a hidden measurer div) ────
  function createPager(opts) {
    const measurerId = (opts && opts.measurerId) || 'mt-core-meas';
    function measurer() {
      let m = document.getElementById(measurerId);
      if (!m) {
        m = document.createElement('div');
        m.id = measurerId;
        m.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
        m.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;' +
          'white-space:pre-wrap;overflow-wrap:anywhere;padding:0 10px;box-sizing:border-box;';
        (document.body || document.documentElement).appendChild(m);
      }
      return m;
    }
    function pageize(text, maxLines, fp, width) {
      if (!text) return [''];
      const m = measurer();
      m.style.fontSize = fp + 'px';
      m.style.lineHeight = '1.3';
      m.style.width = width + 'px';
      // Reference height of ONE real line in THIS element's font. The page's font is
      // inherited (e.g. Substack's serif "Spectral"), and a serif line box can be
      // several px taller than font-size×line-height — a hardcoded fp*1.3 threshold
      // then mis-measures EVERY line as "too tall", collapsing pages to 1 char each.
      // Measuring an actual single line makes paging font-independent.
      m.textContent = 'Mg';
      const lh = m.scrollHeight || (fp * 1.3);
      const tol = Math.round(lh * 0.3);
      const fits = (str) => { m.textContent = str; return m.scrollHeight <= lh * maxLines + tol; };
      if (fits(text)) return [text];
      m.textContent = text;
      const fullLines = Math.max(1, Math.round(m.scrollHeight / lh));
      const N = Math.max(1, Math.ceil(fullLines / maxLines));
      const target = Math.ceil(text.trim().length / N);
      const pages = [];
      let rest = text.trim();
      while (rest) {
        if (fits(rest)) { pages.push(rest); break; }
        let lo = 1, hi = rest.length, fitMax = 1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (fits(rest.slice(0, mid))) { fitMax = mid; lo = mid + 1; } else hi = mid - 1; }
        const cut = Math.min(fitMax, Math.max(target, Math.ceil(fitMax * 0.5)));
        const bp = wordBreakIndex(rest, cut);
        pages.push(rest.slice(0, bp).trim());
        rest = rest.slice(bp).trim();
        if (pages.length > 30) { pages.push(rest); break; }
      }
      return pages.length ? pages : [text];
    }
    function destroy() { document.getElementById(measurerId)?.remove(); }
    return { pageize, destroy };
  }

  // ─── Generic translation engine: per-unit state machine + retry ───────
  // units: [{text, ...payload}]. The engine adds state: tr (translation),
  // _fetching, _done, _err, _tries. The caller injects:
  //   translate(text) → Promise<string>
  //   selectActive(units) → units[]   (the scheduler: which units to translate now —
  //                                     time-window for subtitles, viewport for pages)
  // Rendering stays in the adapter. This is the shared core for BOTH the webpage
  // path and the subtitle path (see docs/domain-design.md).
  function createEngine(cfg) {
    const translate = cfg.translate;
    const selectActive = cfg.selectActive || ((u) => u);
    const win = cfg.window || WINDOW;
    let units = [];

    function setUnits(list) { units = list || []; }

    function pump() {
      if (!units.length) return;
      const active = selectActive(units) || [];
      let started = 0;
      for (let i = 0; i < active.length && started < win.MAX_PER_TICK; i++) {
        const it = active[i];
        if (it.tr || it._done || it._err || it._fetching) continue;
        it._fetching = true;
        started++;
        translate(it.text).then((t) => {
          if (isTranslated(it.text, t)) it.tr = t;
          else it._done = true; // empty output → nothing to show, don't retry
          it._tries = 0;
        }).catch(() => {
          it._tries = (it._tries || 0) + 1;
          if (it._tries >= win.MAX_RETRIES) it._err = true; // exhausted → error UI
        }).finally(() => { setTimeout(() => { it._fetching = false; }, win.RETRY_GAP_MS); });
      }
    }

    // Default display state: '' ready/nothing, 'pending' translating, 'error' gave up.
    function stateOf(it) {
      if (it.tr) return { state: '', translation: it.tr };
      if (it._err) return { state: 'error', translation: '' };
      if (!it._done) return { state: 'pending', translation: '' };
      return { state: '', translation: '' };
    }

    function retry(it) { if (it) { it._err = false; it._tries = 0; } }
    function reset() {
      units.forEach((it) => {
        it.tr = ''; it._fetching = false; it._done = false; it._err = false; it._tries = 0; it._pg = null;
      });
    }

    return { setUnits, pump, stateOf, retry, reset, get units() { return units; } };
  }

  // ─── Subtitle engine: createEngine specialized with a time-window scheduler ──
  // items: [{start, end, text}]. Keeps the existing YouTube-adapter API
  // (setItems/activeAt/stateOf(it,tMs)/items) so content-youtube is unaffected.
  function createSubtitleEngine(cfg) {
    const getCurrentTime = cfg.getCurrentTime;     // () => ms
    const win = cfg.window || WINDOW;
    const engine = createEngine({
      translate: cfg.translate,
      window: win,
      // sliding window: only sentences from now to +AHEAD_MS
      selectActive: (units) => {
        const tMs = getCurrentTime();
        return units.filter((u) => !(u.end < tMs || u.start > tMs + win.AHEAD_MS));
      },
    });

    function activeAt(tMs) {
      const items = engine.units;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].start <= tMs) return tMs < items[i].end ? items[i] : null;
      }
      return null;
    }
    // Subtitle stateOf adds the anti-flicker GRACE (only show "pending" once we are
    // genuinely behind playback) on top of the generic state.
    function stateOf(it, tMs) {
      if (it.tr) return { state: '', translation: it.tr };
      if (it._err) return { state: 'error', translation: '' };
      if (!it._done && tMs - it.start > win.GRACE_MS) return { state: 'pending', translation: '' };
      return { state: '', translation: '' };
    }
    return {
      setItems: engine.setUnits, pump: engine.pump, activeAt, stateOf,
      retry: engine.retry, reset: engine.reset, get items() { return engine.units; },
    };
  }

  // ─── Device layout (control-adapter signal) ────────────────────────────
  // "Mobile" = a touch device (phone / iPad) or a mobile UA. This is the SINGLE
  // source of truth used by the control adapters (content-main routing +
  // content-youtube button gating) to decide whether the page FAB drives everything
  // and NO separate in-player 译 button is shown. It is deliberately NOT keyed off the
  // m.youtube.com host, so a phone on the desktop-layout www.youtube.com is still
  // treated as mobile — otherwise the 译 button and the FAB collide as two near-
  // identical green circles.
  function isMobileLayout() {
    try {
      return (navigator.maxTouchPoints || 0) > 0
        || /iPhone|iPod|iPad|Android/i.test(navigator.userAgent || '');
    } catch (_) { return false; }
  }

  return {
    DEFAULT_TARGET_LANG, WINDOW, MERGE, MSG, t: i18n,
    isTranslated, looksLikeCode, endsSentence, joinCue, wordBreakIndex,
    mergeSentences, createPager, createEngine, createSubtitleEngine, isMobileLayout,
  };
})();
