// yt-timedtext-observer.js — isolated-world content script, run_at document_start.
//
// Why it exists: on Safari iOS the world:MAIN hook (yt-hook.js) can't run, and a
// direct fetch of the caption-track baseUrl is pot-blocked. The only way to get a
// usable transcript URL is to read YouTube's OWN /api/timedtext request (which
// carries a valid pot) from the Resource Timing API. But that buffer EVICTS old
// entries (default ~250) — on a heavy YouTube load the timedtext request (fired
// during player init when CC is already on) rotates out before content-youtube.js
// loads at document_idle. So we register a PerformanceObserver as EARLY as possible
// (document_start, before YouTube fetches anything) and record every /api/timedtext
// URL onto window.__mtTimedTextUrls. content-youtube.js (same isolated world) reads
// that list and re-fetches the full json3 transcript itself.
(() => {
  if (window.__mtTimedTextObs) return;
  window.__mtTimedTextObs = true;
  window.__mtTimedTextUrls = window.__mtTimedTextUrls || [];
  try { performance.setResourceTimingBufferSize(8000); } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name && e.name.indexOf('/api/timedtext') !== -1) {
          window.__mtTimedTextUrls.push(e.name);
          if (window.__mtTimedTextUrls.length > 50) window.__mtTimedTextUrls.shift();
        }
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}
})();
