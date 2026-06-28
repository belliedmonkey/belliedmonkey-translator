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
  // UI-chrome strings. (Step F wires these to chrome.i18n; kept as constants for
  // now so behavior is identical. Centralized so i18n touches one place.)
  const MSG = {
    loading: '⏳ 翻译中…',
    preparing: '⏳ 译文准备中…',
    error: '⚠️ 翻译失败,点此重试',
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
      const lh = fp * 1.3;
      const fits = (str) => { m.textContent = str; return m.scrollHeight <= lh * maxLines + 2; };
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

  // ─── Subtitle engine: state machine + sliding-window preload + grace ───
  // items: [{start, end, text}]. The engine adds state: tr (translation),
  // _fetching, _done, _err, _tries. Rendering/paging stays in the adapter.
  function createSubtitleEngine(cfg) {
    const getCurrentTime = cfg.getCurrentTime;     // () => ms
    const translate = cfg.translate;               // (text) => Promise<string>
    const win = cfg.window || WINDOW;
    let items = [];

    function setItems(list) { items = list || []; }

    // One tick of the sliding-window preloader.
    function pump() {
      if (!items.length) return;
      const tMs = getCurrentTime();
      let started = 0;
      for (let i = 0; i < items.length && started < win.MAX_PER_TICK; i++) {
        const it = items[i];
        if (it.tr || it._done || it._err || it._fetching) continue;
        if (it.end < tMs || it.start > tMs + win.AHEAD_MS) continue; // outside window
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

    function activeAt(tMs) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].start <= tMs) return tMs < items[i].end ? items[i] : null;
      }
      return null;
    }

    // The display state for an item at time tMs.
    // '' = ready/nothing, 'pending' = translating & behind, 'error' = gave up.
    function stateOf(it, tMs) {
      if (it.tr) return { state: '', translation: it.tr };
      if (it._err) return { state: 'error', translation: '' };
      if (!it._done && tMs - it.start > win.GRACE_MS) return { state: 'pending', translation: '' };
      return { state: '', translation: '' };
    }

    function retry(it) { if (it) { it._err = false; it._tries = 0; } }
    function reset() {
      items.forEach((it) => {
        it.tr = ''; it._fetching = false; it._done = false; it._err = false; it._tries = 0; it._pg = null;
      });
    }

    return { setItems, pump, activeAt, stateOf, retry, reset, get items() { return items; } };
  }

  return {
    DEFAULT_TARGET_LANG, WINDOW, MERGE, MSG,
    isTranslated, endsSentence, joinCue, wordBreakIndex,
    mergeSentences, createPager, createSubtitleEngine,
  };
})();
