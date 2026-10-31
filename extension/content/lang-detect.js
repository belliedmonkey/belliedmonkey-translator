// lang-detect.js — OPTIONAL browser-native language detection (LangDetect).
//
// The BROWSER-CAPABILITY axis (docs/domain-design.md §5.3): Chrome, Edge and Firefox
// ship a language detector as `chrome.i18n.detectLanguage`; no Safari does — and
// Safari iOS is the product's floor. So this whole module is an *optimisation*. When
// it is unavailable the engine falls back to the script-based
// `isAlreadyTargetLanguage()` and behaves exactly as it did before this file existed.
// It must never become the only way something works.
//
// Two shapes matter to the caller:
//
//   • It is INJECTED into the engine, never probed by it. `TranslationCore` does not
//     know this file exists; the adapter passes `detect` in. (§5.3 rule 2.)
//   • `detect()` is SYNCHRONOUS and three-state. The engine's `pump()` is a sync
//     function on a 350ms interval whose MAX_PER_TICK throttle depends on counting
//     synchronously; an `await` in that loop would break it. So the async work is
//     hidden here behind a cache, and callers get:
//         {lang, percentage, isReliable}  a known answer
//         undefined                       in flight — ask again next tick
//         null                            no answer will ever come (absent/latched off)
//
// Verified in a real content script (Chrome, CDP): chrome.i18n exposes
// ["detectLanguage","getAcceptLanguages","getMessage","getUILanguage"], and both the
// promise and callback forms return {isReliable, languages:[{language, percentage}]}.

var LangDetect = (() => {
  'use strict';

  // Same cap as the translation cache in translation-api.js. Entries are page text,
  // so an SPA that never reloads would otherwise grow this without bound.
  const MAX_CACHE = 1000;
  // If a detection neither resolves nor rejects, its cache slot would stay "in flight"
  // forever and leak. The engine already survives that (it gives up waiting after
  // MAX_DETECT_WAITS ticks and translates the unit), but the entry still has to be
  // reaped or the Map fills with zombies.
  const INFLIGHT_TIMEOUT_MS = 5000;

  const cache = new Map();      // text → {lang, percentage, isReliable} | null
  const inflight = new Set();   // text currently being detected
  const timers = new Map();     // text → reaper timer id, cleared when an answer lands
  let latch = null;             // null = not probed yet, true = usable, false = off for good

  // One-shot capability probe. Anything unexpected means "no detector" — we never
  // half-trust an implementation.
  function available() {
    if (latch === null) {
      try {
        latch = typeof chrome !== 'undefined' && !!chrome.i18n
          && typeof chrome.i18n.detectLanguage === 'function';
      } catch (_) { latch = false; }
    }
    return latch;
  }

  // Latch off permanently. Called on ANY failure — a throw, a rejection, a
  // lastError, a result we can't read. Degradation is total, not per-call: a browser
  // that fails once is not going to succeed on unit #40, and retrying per unit would
  // turn a broken API into a per-tick error storm. (§5.3 rule 3.)
  function disable() {
    latch = false;
    cache.clear();
    inflight.clear();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  // {isReliable, languages:[{language, percentage}]} → the winning language, flattened.
  // Returns null for anything we don't recognise, which the caller treats as "no answer"
  // rather than as a match.
  function flatten(result) {
    if (!result || !Array.isArray(result.languages) || !result.languages.length) return null;
    let top = null;
    for (const l of result.languages) {
      if (!l || typeof l.language !== 'string' || !l.language) continue;
      if (!top || (l.percentage | 0) > (top.percentage | 0)) top = l;
    }
    if (!top) return null;
    // 'und' is the detector saying "I don't know" — never let it match a target.
    if (top.language === 'und') return null;
    return {
      lang: top.language,
      percentage: top.percentage | 0,
      // Note: isReliable is the detector's own confidence and is the load-bearing
      // gate downstream. `percentage` is a SHARE of the text, not a confidence —
      // measured: "Bonjour." returns Norwegian at 100% with isReliable false.
      isReliable: result.isReliable === true,
    };
  }

  function remember(text, value) {
    if (!inflight.delete(text)) return;   // already reaped or latched off — drop it
    const t = timers.get(text);
    // Cancel the reaper the moment a real answer lands. Left armed, every detection
    // holds its paragraph string alive for the full timeout, so on a scrolling page
    // the retained-string peak tracks detection RATE rather than MAX_CACHE.
    if (t !== undefined) { clearTimeout(t); timers.delete(text); }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value); // FIFO evict
    cache.set(text, value);
  }

  // Kick off one detection. Passes a callback AND handles a returned promise, because
  // the two engines genuinely differ — both measured in a real content script:
  //   Chrome  : returns a Promise; the callback form ALSO fires.
  //   Firefox : callback ONLY — returns undefined, no thenable.
  // So a promise-only implementation would never resolve on Firefox, and a
  // callback-only one would be relying on undocumented Chrome behaviour. Both firing
  // is harmless: `remember` is idempotent via the inflight check.
  function start(text) {
    inflight.add(text);
    let ret;
    try {
      ret = chrome.i18n.detectLanguage(text, (r) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) { disable(); return; }
        } catch (_) { disable(); return; }
        remember(text, flatten(r));
      });
    } catch (_) {
      disable();
      return;
    }
    if (ret && typeof ret.then === 'function') {
      ret.then((r) => remember(text, flatten(r)), () => disable());
    }
    timers.set(text, setTimeout(() => remember(text, null), INFLIGHT_TIMEOUT_MS));
  }

  // Synchronous three-state accessor — see the header comment.
  function detect(text) {
    if (!available()) return null;
    if (typeof text !== 'string' || !text) return null;
    if (cache.has(text)) return cache.get(text);
    if (!inflight.has(text)) {
      start(text);
      // start() may have latched off synchronously (the call threw). Report that as
      // "never" right now — returning undefined would tell the caller to wait for an
      // answer that is never coming.
      if (!available()) return null;
    }
    return undefined;
  }

  return {
    available,
    detect,
    // The single thing an adapter should call: the detector if this browser has a
    // working one, otherwise null. Keeps the capability rule spelled once instead of
    // once per adapter, so adding a second capability shape is a one-line change.
    detectorOrNull() { return available() ? detect : null; },
  };
})();

if (typeof window !== 'undefined') window.LangDetect = LangDetect;
