// tw-media-observer.js — isolated-world content script, run_at document_start.
//
// Twitter/X in-tweet video is HLS (video.twimg.com/amplify_video/<id>/pl/<hash>.m3u8).
// Its subtitle track lives in the HLS MASTER playlist (#EXT-X-MEDIA:TYPE=SUBTITLES).
// See docs/domain-design.md §2.3. Unlike YouTube's /api/timedtext, these URLs are NOT
// pot-locked, so content-twitter.js can re-fetch them directly from the isolated world
// (no world:MAIN needed — Safari iOS safe). But we still must DISCOVER the master URL,
// and the Resource Timing buffer evicts old entries on a heavy SPA feed, so — exactly
// like yt-timedtext-observer.js — we register a PerformanceObserver at document_start
// and record every video.twimg.com .m3u8 onto window.__mtTwHlsUrls. content-twitter.js
// (same isolated world) reads that list, picks the master for the active <video>, and
// walks master → SUBTITLES sub-playlist → .vtt segments.
(() => {
  if (window.__mtTwMediaObs) return;
  window.__mtTwMediaObs = true;
  window.__mtTwHlsUrls = window.__mtTwHlsUrls || [];
  try { performance.setResourceTimingBufferSize(8000); } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name && /video\.twimg\.com\/amplify_video\/[^?]*\.m3u8/.test(e.name)) {
          window.__mtTwHlsUrls.push(e.name);
          if (window.__mtTwHlsUrls.length > 80) window.__mtTwHlsUrls.shift();
        }
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}
})();
