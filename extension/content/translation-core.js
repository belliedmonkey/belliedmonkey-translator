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
  // MAX_DETECT_WAITS: how many ticks a unit may wait on the optional browser language
  // detector before it is translated anyway. Ticks are ~350ms, so 3 is ~1s. This is a
  // safety net, not a tuning knob — without it a detector that never answers would pin
  // units at 'pending' ("⏳ 翻译中…") forever.
  // STALL_MS：单元停在 'pending' 的**绝对上限**。引擎不能假设注入的 translate() 一定
  // 会 settle —— 这一族已经咬过两次（storage 回调带 undefined；storage 回调根本不来），
  // 两次的症状都是整页永远「翻译中…」。传输层每修一个洞，都还会有下一个洞；而只要
  // 有一个 promise 不落地，`.then/.catch/.finally` 一个都不会跑，重试逻辑也就永远
  // 不会被触发。所以最终的保证只能长在这里：**超过上限一律进 error 态，把重试交还
  // 给用户**。取 120 秒是为了绝不误伤真慢的请求：传输层默认 20 秒超时 × 3 次重试
  // 加退避，最坏也就 ~90 秒。
  // HOLD_MS: how long a sentence stays "active" past its end (docs/domain-design.md
  // §2.4). 0 = today's behaviour for every fetched transcript; the live ASR source sets
  // it because a sentence can only close after it was spoken, so its pair would
  // otherwise never be on screen while its own time range is.
  const WINDOW = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 3, RETRY_GAP_MS: 800, GRACE_MS: 700, MAX_DETECT_WAITS: 3, STALL_MS: 120000, HOLD_MS: 0 };
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
  // (Already-target-language text is now caught BEFORE the request instead — see
  // isAlreadyTargetLanguage; this stays the success test, not a language test.)
  function isTranslated(input, output) {
    return typeof output === 'string' && output.trim().length > 0;
  }

  // ─── "Is this text already in the target language?" ───────────────────
  // Answering yes means we never send the request at all (pump()), so the unit shows
  // NOTHING — no duplicate, no placeholder, no error. That makes a wrong yes a silent
  // non-translation, so the predicate is deliberately narrow and biased toward "no".
  //
  // Script can only tell you SAME SCRIPT, never same language. So this is enabled only
  // for zh / ja / ko targets, the one family where the mapping is clean. With a Latin
  // target, English and French are the same script and indistinguishable this way — it
  // returns false there and behaviour is unchanged. See docs/interaction-spec.md.
  const SCRIPT_OF_TARGET = [
    // order matters: ja before zh, because Japanese text also contains Han.
    { test: /^ja\b/i, has: /[\p{Script=Hiragana}\p{Script=Katakana}]/u },
    { test: /^ko\b/i, has: /\p{Script=Hangul}/u },
    { test: /^zh\b/i, has: /\p{Script=Han}/u, notAlso: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u },
  ];
  // Anything that is Latin for mechanical reasons rather than linguistic ones. Left in,
  // a single @handle or t.co link makes a pure-Chinese tweet look bilingual.
  const NON_LINGUISTIC = /https?:\/\/\S+|\bwww\.\S+|[@#][\w一-鿿]+|\b[\w.+-]+@[\w.-]+\.\w+\b/gu;
  const FOREIGN_RUN = /\p{Letter}+/gu;

  function isAlreadyTargetLanguage(text, targetLang) {
    if (typeof text !== 'string' || !text.trim() || !targetLang) return false;
    const rule = SCRIPT_OF_TARGET.find((r) => r.test.test(targetLang));
    if (!rule) return false;                        // Latin (and everything else): never skip
    const body = text.replace(NON_LINGUISTIC, ' ');
    if (!rule.has.test(body)) return false;         // no target script at all → translate
    if (rule.notAlso && rule.notAlso.test(body)) return false; // zh target, kana/Hangul present → not Chinese
    // Count letters NOT in the target script. Digits, punctuation, whitespace and emoji
    // are not letters, so they never count either way.
    let foreign = 0;
    for (const run of body.match(FOREIGN_RUN) || []) {
      if (!rule.has.test(run)) foreign += run.length;
    }
    // A few foreign words are enough to make the paragraph worth translating — that is
    // the "at least some words are in another language" half of the rule.
    return foreign < FOREIGN_LETTER_FLOOR;
  }
  const FOREIGN_LETTER_FLOOR = 8;

  // Can script alone decide this target? True exactly when isAlreadyTargetLanguage can
  // return true — i.e. zh / ja / ko. The engine uses this to route: script-decidable
  // targets are answered by the line above and NEVER by a browser detector.
  //
  // The detector buys nothing here and costs consistency. Measured: it reports 繁體中文
  // as plain `zh`, the same answer it gives 简体中文 — exactly the blind spot the script
  // rule already has (both are Han without kana). So routing zh/ja/ko through it would
  // not fix a single case, and would make the most-used path behave differently on
  // Safari than on Chrome. See docs/interaction-spec.md and docs/domain-design.md §5.3.
  //
  // (The zh-Hant/zh-Hans blind spot itself is a real, PRE-EXISTING limitation — a
  // Traditional paragraph under a zh-CN target is skipped today — and is out of scope
  // here precisely because the detector cannot fix it either.)
  function isScriptDecidableTarget(targetLang) {
    return !!targetLang && SCRIPT_OF_TARGET.some((r) => r.test.test(targetLang));
  }

  // ─── The browser-detector gate (docs/interaction-spec.md) ─────────────
  // A skip is a SILENT non-translation, so a detector's answer is only trusted when
  // all three hold. isReliable is the load-bearing one; the length floor exists to
  // feed it (measured: "Bonjour." → Norwegian at 100% with isReliable false, and a
  // 48-letter English sentence still self-reports unreliable). When tuning, raise
  // DETECT_MIN_LETTERS — never lower the other two.
  const DETECT_MIN_PERCENTAGE = 90;
  const DETECT_MIN_LETTERS = 60;

  // Letters that carry language, i.e. after dropping URLs / @handles / #tags / emails,
  // and counting only letters (digits, punctuation, spaces and emoji never count).
  function linguisticLetterCount(text) {
    if (typeof text !== 'string' || !text) return 0;
    let n = 0;
    for (const run of text.replace(NON_LINGUISTIC, ' ').match(FOREIGN_RUN) || []) n += run.length;
    return n;
  }

  // Compare only the base subtag: the detector says `en`, settings say `en-US`.
  function baseSubtag(tag) {
    return String(tag || '').toLowerCase().split(/[-_]/)[0];
  }

  // Cheap checks first. The letter count is the only O(n) test here (a regex
  // replace plus a match over the whole unit), and on a page actually worth
  // translating the common answer is "detected language != target" — so the
  // O(1) subtag compare goes above it and the scan is usually never run.
  function detectorSaysTargetLanguage(det, text, targetLang) {
    if (!det || !targetLang) return false;
    if (det.isReliable !== true) return false;
    if ((det.percentage | 0) < DETECT_MIN_PERCENTAGE) return false;
    const a = baseSubtag(det.lang);
    if (!a || a !== baseSubtag(targetLang)) return false;
    return linguisticLetterCount(text) >= DETECT_MIN_LETTERS;
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
  // Streaming twin of mergeSentences (docs/domain-design.md §2.4 tier B): the same
  // three closing rules, but over a buffer that grows. push() returns only sentences
  // that CLOSED — on a terminal, on MAX_LEN, or because the next cue starts after a
  // silence gap; the open tail is kept back until flush(). The tail never reaches the
  // Engine, so no unit is ever replaced and no translation is ever thrown away.
  function createCueMerger(opt) {
    const o = opt || MERGE;
    let cur = null;
    function push(cues) {
      const out = [];
      for (const c of cues || []) {
        if (!c || !c.text) continue;
        if (cur && c.start - cur.end > o.GAP_MS) { out.push(cur); cur = null; }
        if (!cur) cur = { start: c.start, end: c.end, text: c.text };
        else { cur.text = joinCue(cur.text, c.text); cur.end = c.end; }
        if (endsSentence(cur.text) || cur.text.length > o.MAX_LEN) { out.push(cur); cur = null; }
      }
      return out;
    }
    function flush() { const t = cur; cur = null; return t ? [t] : []; }
    return { push, flush, get open() { return cur; } };
  }

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
  // units: [{text, ...payload}]. The engine adds `tr` (the translation) plus private
  // `_`-prefixed state — see reset() for the authoritative set, so this list cannot
  // go stale the next time a field is added. The caller injects:
  //   translate(text) → Promise<string>
  //   selectActive(units) → units[]   (the scheduler: which units to translate now —
  //                                     time-window for subtitles, viewport for pages)
  //   targetLang        string OR a getter — see "read late" below
  //   detect(text)      OPTIONAL browser language detector, three-state and SYNCHRONOUS:
  //                     {lang,percentage,isReliable} | undefined (in flight) | null
  //                     (never). Supplied by the adapter where the browser has one
  //                     (docs/domain-design.md §5.3) — the engine never probes for it.
  // Rendering stays in the adapter. This is the shared core for BOTH the webpage
  // path and the subtitle path (see docs/domain-design.md).
  function createEngine(cfg) {
    const translate = cfg.translate;
    const selectActive = cfg.selectActive || ((u) => u);
    // MERGE, not replace: an adapter's override lists only the knobs it cares about,
    // so a replacement silently leaves every other tunable undefined — and an
    // undefined threshold fails open (`n <= undefined` is false), disabling the
    // feature it guards without a single test going red.
    const win = Object.assign({}, WINDOW, cfg.window);
    const detect = typeof cfg.detect === 'function' ? cfg.detect : null;
    // Settings are read LATE, per tick — never captured here. The subtitle harness
    // builds its engine before init/enable/updateSettings have assigned `settings`, so
    // capturing froze the same-language check to DEFAULT_TARGET_LANG for the whole
    // session and subtitles ignored the user's chosen target entirely. `translate` was
    // already a late-reading closure; `targetLang` now matches it. See
    // docs/domain-design.md §4.
    const targetLangOf = typeof cfg.targetLang === 'function'
      ? () => cfg.targetLang() || ''
      : () => cfg.targetLang || '';
    let units = [];

    function setUnits(list) { units = list || []; }
    // Sorted insert (by start). The subtitle activeAt() scans backwards and returns on
    // the first `start <= t`, so order is load-bearing — an appended unit that landed
    // out of place would shadow its neighbours. Fresh objects only: a unit carries
    // engine-private `_` state once pumped.
    function appendUnits(list) {
      for (const u of list || []) {
        if (!u) continue;
        let i = units.length;
        while (i > 0 && units[i - 1].start > u.start) i--;
        units.splice(i, 0, u);
      }
    }
    // Merge, never replace — same reason as the constructor's Object.assign.
    function setWindow(partial) { Object.assign(win, partial || {}); }

    function pump() {
      if (!units.length) return;
      const active = selectActive(units) || [];
      const targetLang = targetLangOf();
      // Loop-invariant for this tick — hoisted so the script-family regexes aren't
      // re-run once per unit per 350ms tick.
      const useDetector = !!detect && !!targetLang && !isScriptDecidableTarget(targetLang);
      let started = 0;
      for (let i = 0; i < active.length && started < win.MAX_PER_TICK; i++) {
        const it = active[i];
        if (it.tr || it._done || it._err || it._fetching) continue;
        // Already in the target language → don't spend a request on it, and let it
        // settle into the same "nothing to show" state an empty response produces, so
        // the renderer draws no sibling at all. Covers the webpage AND subtitle paths,
        // which share this engine.
        //
        // Layer 1 — script. Works on every surface, and is the ONLY layer consulted for
        // the targets it can decide (zh/ja/ko), so the most-used path is identical on
        // every browser by construction.
        if (isAlreadyTargetLanguage(it.text, targetLang)) { it._done = true; continue; }
        // Layer 2 — the injected browser detector, for the targets script cannot decide
        // (English vs French are the same script). Absent on Safari, where this whole
        // branch short-circuits and behaviour is exactly layer 1 alone.
        //
        // The length floor is checked HERE, before asking. It depends only on the text,
        // so a unit under it can never be skipped no matter what the detector says —
        // asking anyway would spend an IPC, a cache entry and a reaper timer, and stall
        // the unit for MAX_DETECT_WAITS ticks, all to discard the answer. That waste
        // lands hardest on subtitles, where merged cues are capped at MERGE.MAX_LEN and
        // many are sub-floor by construction. Memoized: it.text never changes.
        if (useDetector) {
          if (it._letters == null) it._letters = linguisticLetterCount(it.text);
          if (it._letters >= DETECT_MIN_LETTERS) {
            // A throwing detector must not take the tick loop down with it — pump()
            // drives rendering for the whole page, so an exception here would stall
            // every unit, not just this one. Treat it as "no answer" and translate.
            let det = null;
            try { det = detect(it.text); } catch (_) { det = null; }
            if (det === undefined) {
              // In flight. Wait a tick rather than translating — but only briefly.
              // stateOf() reports 'pending' while !_done, so a detector that never
              // answers would pin the unit at "⏳ 翻译中…" forever. Bounded wait, then
              // translate: erring toward translating is the standing rule.
              //
              // The wait counts against MAX_PER_TICK: a first ask is an IPC, and
              // without this a viewport full of units would fire an unbounded burst
              // of detector calls inside one 350ms handler and start no translations.
              if ((it._detectWaits = (it._detectWaits || 0) + 1) <= win.MAX_DETECT_WAITS) { started++; continue; }
            } else if (detectorSaysTargetLanguage(det, it.text, targetLang)) {
              it._done = true;
              continue;
            }
          }
        }
        it._fetching = true;
        started++;
        // 看门狗：和 translate() 赛跑。它先落地就照常走；它不落地，我们自己落地。
        // 卡死**不进重试计数** —— 重试是为「可能自己好起来」的瞬时失败准备的，而一个
        // 不落地的 promise 再等 3 个 120 秒只是让用户多等 6 分钟。直接给可点的重试。
        let stallTimer = null;
        const stall = new Promise((_, reject) => {
          stallTimer = setTimeout(() => { const e = new Error('translate stalled'); e.stalled = true; reject(e); }, win.STALL_MS);
        });
        Promise.race([translate(it.text), stall]).then((t) => {
          if (isTranslated(it.text, t)) { it.tr = t; it._tries = 0; if (cfg.onOk) { try { cfg.onOk(); } catch (_) {} } return; }
          // 空正文是失败，不是「这段没东西可翻」——两者必须分开（2026-08-13 真机）。
          // 请求发出**之前**判定不用翻（同语言跳过）才可以静默终结；请求发出**之后**
          // 拿回空正文，说明这一段确实需要译文而我们没拿到。此前这里写的是
          // `it._done = true`（注释还写着「nothing to show, don't retry」），于是渲染器
          // 走「nothing to translate → 删掉兄弟节点」，段落永久空白、无提示、无重试
          // ——用户看到的是「漏译」，且没有任何补救入口。
          //
          // 不自动重试是刻意的：一个持续返回空正文的模型（典型是思考型模型烧光
          // 预算，解析路径 2026-08-08 已为同一形状加过 empty_output）自动重试只会
          // 烧配额。所以直接进 error 态，把重试交给用户点一下。
          it._err = true;
          it._tries = 0;
          if (cfg.onFail) { try { cfg.onFail({ code: 'reasoning_starved' }); } catch (_) {} }
        }).catch((e) => {
          if (e && e.stalled) { it._err = true; it._tries = 0; if (cfg.onFail) { try { cfg.onFail({ code: 'timeout' }); } catch (_) {} } return; }  // 卡死 → 直接可重试
          it._tries = (it._tries || 0) + 1;
          if (it._tries >= win.MAX_RETRIES) { it._err = true; if (cfg.onFail) { try { cfg.onFail(e); } catch (_) {} } } // exhausted → error UI
        }).finally(() => {
          clearTimeout(stallTimer);
          setTimeout(() => { it._fetching = false; }, win.RETRY_GAP_MS);
        });
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
        it._detectWaits = 0;
      });
    }

    return { setUnits, appendUnits, setWindow, pump, stateOf, retry, reset, get units() { return units; } };
  }

  // ─── Subtitle engine: createEngine specialized with a time-window scheduler ──
  // items: [{start, end, text}]. Keeps the existing YouTube-adapter API
  // (setItems/activeAt/stateOf(it,tMs)/items) so content-youtube is unaffected.
  function createSubtitleEngine(cfg) {
    const getCurrentTime = cfg.getCurrentTime;     // () => ms
    // MERGE, not replace: an adapter's override lists only the knobs it cares about,
    // so a replacement silently leaves every other tunable undefined — and an
    // undefined threshold fails open (`n <= undefined` is false), disabling the
    // feature it guards without a single test going red.
    const win = Object.assign({}, WINDOW, cfg.window);
    const engine = createEngine({
      translate: cfg.translate,
      window: win,
      targetLang: cfg.targetLang,   // string or getter — passed through, read late
      detect: cfg.detect,
      onOk: cfg.onOk, onFail: cfg.onFail,   // 用量事件的两个钩子（docs/telemetry-design.md §3），可缺省
      // sliding window: only sentences from now to +AHEAD_MS
      selectActive: (units) => {
        const tMs = getCurrentTime();
        return units.filter((u) => !(u.end < tMs || u.start > tMs + win.AHEAD_MS));
      },
    });

    // A sentence is active from its start until its end + HOLD_MS, but never past the
    // next sentence's start (the next one takes over). HOLD_MS = 0 ⇒ exactly `end`.
    function activeAt(tMs) {
      const items = engine.units;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].start <= tMs) {
          let until = items[i].end + (win.HOLD_MS || 0);
          const next = items[i + 1];
          if (next && next.start < until) until = Math.max(items[i].end, next.start);
          return tMs < until ? items[i] : null;
        }
      }
      return null;
    }
    // Both copies must move: createEngine merged its own `win` from ours.
    function setWindow(partial) { Object.assign(win, partial || {}); engine.setWindow(partial); }
    // Subtitle stateOf adds the anti-flicker GRACE (only show "pending" once we are
    // genuinely behind playback) on top of the generic state.
    function stateOf(it, tMs) {
      if (it.tr) return { state: '', translation: it.tr };
      if (it._err) return { state: 'error', translation: '' };
      if (!it._done && tMs - it.start > win.GRACE_MS) return { state: 'pending', translation: '' };
      return { state: '', translation: '' };
    }
    return {
      setItems: engine.setUnits, appendItems: engine.appendUnits, setWindow, pump: engine.pump, activeAt, stateOf,
      retry: engine.retry, reset: engine.reset, get items() { return engine.units; },
      get window() { return win; },
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
    isTranslated, isAlreadyTargetLanguage, isScriptDecidableTarget, detectorSaysTargetLanguage,
    looksLikeCode, endsSentence, joinCue, wordBreakIndex,
    mergeSentences, createCueMerger, createPager, createEngine, createSubtitleEngine, isMobileLayout,
  };
})();
