// content-youtube.js — YouTube bilingual video subtitles.
//
// Thin backend over SubtitleAdapter.createSubtitleUI (see docs/domain-design.md §2.1).
// Supplies only the YouTube-specific parts: the source (the pot-bearing /api/timedtext
// transcript — captured opportunistically via the world:MAIN hook on Chrome, else
// re-fetched from a Resource-Timing-observed URL cross-platform), auto-enabling CC so
// YouTube mints that pot, ad-gating, the player-anchored overlay, and hiding YouTube's
// own caption rendering. All overlay/tick/menu/SRT live in subtitle-adapter.js.
// Fetch the COMPLETE transcript up front; NO word-by-word fallback.

var YouTubeTranslator = (() => {
  const CAPTION_SEGMENT = '.ytp-caption-segment';
  const CC_BUTTON = '.ytp-subtitles-button';
  const RIGHT_CONTROLS = '.ytp-right-controls';
  const PLAYER = '#movie_player, .html5-video-player';
  const IS_EMBED = window.top !== window.self;

  let ccTried = false;
  let subActiveSince = 0;
  let ttObservedUrl = '';
  let ttFetchedUrl = '';
  let ccForceToggled = false;
  let hookCues = null, hookVideoId = ''; // world:MAIN hook (Chrome) delivers cues async

  // ─── Video id helpers ─────────────────────────────────────────────────
  function currentVideoId() { try { return new URLSearchParams(location.search).get('v') || ''; } catch (_) { return ''; } }
  function videoIdFromUrl(u) { try { return new URL(u, location.href).searchParams.get('v') || ''; } catch (_) { return ''; } }

  // ─── Transcript capture ───────────────────────────────────────────────
  // OPPORTUNISTIC (Chrome): yt-hook.js (world:MAIN) posts YouTube's own /api/timedtext
  // BODY. Safari has no world:MAIN → the Resource Timing path below is the source.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__mtYtHook !== true || d.type !== 'timedtext') return;
    let cues; try { cues = parseJson3(d.body); } catch (_) { return; }
    if (!cues.length) return;
    hookCues = cues; hookVideoId = videoIdFromUrl(d.url) || currentVideoId();
  });

  // CROSS-PLATFORM: read YouTube's OWN pot-bearing /api/timedtext URL from the Resource
  // Timing API and re-fetch it. The buffer evicts, so a document_start observer records
  // URLs early (window.__mtTimedTextUrls); an in-file observer covers document_idle on.
  try {
    performance.setResourceTimingBufferSize(5000);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name && e.name.indexOf('/api/timedtext') !== -1) ttObservedUrl = e.name;
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}

  function normalizeTimedTextUrl(u) {
    try {
      const url = new URL(u, location.href);
      url.searchParams.set('fmt', 'json3');
      url.searchParams.delete('tlang'); // want the ORIGINAL track, not YouTube's translation
      return url.toString();
    } catch (_) { return u; }
  }
  function forceCcRefetch() {
    if (!document.querySelector(CAPTION_SEGMENT)) return;
    const btn = document.querySelector(CC_BUTTON) || document.querySelector('.ytmClosedCaptioningButtonButton');
    if (!btn) return;
    try { btn.click(); setTimeout(() => { try { btn.click(); } catch (_) {} }, 400); } catch (_) {}
  }
  function timedTextUrlForCurrentVideo() {
    const vid = currentVideoId();
    const matchesVid = (u) => { try { return !vid || new URL(u).searchParams.get('v') === vid; } catch (_) { return true; } };
    const early = window.__mtTimedTextUrls || [];
    for (let i = early.length - 1; i >= 0; i--) { if (matchesVid(early[i])) return early[i]; }
    if (ttObservedUrl && matchesVid(ttObservedUrl)) return ttObservedUrl;
    let entries; try { entries = performance.getEntriesByType('resource'); } catch (_) { entries = []; }
    let best = '';
    for (const e of entries) { if (!e.name || e.name.indexOf('/api/timedtext') === -1) continue; if (!matchesVid(e.name)) continue; best = e.name; }
    return best;
  }
  function parseJson3(body) {
    const data = JSON.parse(body);
    const events = data.events || [];
    const out = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/[^\S\n]+/g, ' ').trim();
      if (!text) continue;
      const start = ev.tStartMs || 0;
      const end = ev.dDurationMs ? start + ev.dDurationMs : 0;
      out.push({ start, end, text });
    }
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i < out.length; i++) {
      if (!out[i].end || out[i].end <= out[i].start) out[i].end = i + 1 < out.length ? out[i + 1].start : out[i].start + 4000;
    }
    return out;
  }

  // Returns cues[] (ready) | null (retry). Never 'unavailable' — the harness caps
  // attempts (maxAttempts:8) → 字幕不可用, matching the old TT_MAX_ATTEMPTS/timeout.
  async function acquire() {
    const vid = currentVideoId();
    if (hookCues && hookVideoId === vid && hookCues.length) { const c = hookCues; hookCues = null; return c; } // Chrome hook
    const best = timedTextUrlForCurrentVideo();
    if (!best) {
      // Nothing seen yet — after a grace, force a fresh fetch (CC-on-at-load whose
      // request was evicted before we could observe it).
      if (!ccForceToggled && (Date.now() - subActiveSince) > 3000) { ccForceToggled = true; forceCcRefetch(); }
      return null;
    }
    const url = normalizeTimedTextUrl(best);
    if (url === ttFetchedUrl) return null; // already (re)fetched this exact URL
    ttFetchedUrl = url;
    const body = await fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
    let cues; try { cues = parseJson3(body); } catch (_) { cues = []; }
    if (!cues.length) { ttFetchedUrl = ''; return null; } // empty (pot?) — let a fresh URL retry
    return cues;
  }

  // Reveal player controls so the (mobile) CC button mounts (a non-pausing off-center tap).
  function surfacePlayerControls() {
    const p = document.querySelector(PLAYER);
    if (!p) return;
    const r = p.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height * 0.3);
    const target = document.elementFromPoint(x, y) || p;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    try { p.dispatchEvent(new MouseEvent('mousemove', base)); } catch (_) {}
    try {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, radiusX: 1, radiusY: 1 });
      const te = (type, touches) => new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: [t] });
      target.dispatchEvent(te('touchstart', [t]));
      target.dispatchEvent(te('touchend', []));
    } catch (_) {
      try {
        target.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch', isPrimary: true }, base)));
        target.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch', isPrimary: true }, base)));
        target.dispatchEvent(new MouseEvent('click', base));
      } catch (_) {}
    }
  }
  // Turn YouTube's own CC on so it fetches /api/timedtext (minting a pot). One-shot.
  function ensureCaptionsOn() {
    if (ccTried) return;
    if ((ui && ui.engine.items.length) || document.querySelector(CAPTION_SEGMENT)) { ccTried = true; return; }
    const cc = document.querySelector(CC_BUTTON);
    if (cc) { if (cc.getAttribute('aria-pressed') === 'false') cc.click(); ccTried = true; return; }
    let mcc = document.querySelector('.ytmClosedCaptioningButtonButton');
    if (!mcc) { surfacePlayerControls(); mcc = document.querySelector('.ytmClosedCaptioningButtonButton'); }
    if (mcc) { if (mcc.getAttribute('aria-pressed') !== 'true') mcc.click(); ccTried = true; }
  }

  function injectCaptionStyle() {
    if (document.getElementById('mt-yt-style')) return;
    const st = document.createElement('style');
    st.id = 'mt-yt-style';
    st.textContent = '.ytp-caption-window-container{opacity:0!important;pointer-events:none!important;}';
    (document.head || document.documentElement).appendChild(st);
  }
  function removeCaptionStyle() { document.getElementById('mt-yt-style')?.remove(); }

  // ─── Overlay anchor: inside the player, absolute, above the control bar ─
  function placeOverlay(ov) {
    const player = document.querySelector(PLAYER);
    if (!player) return false;
    if (ov.parentElement !== player) player.appendChild(ov);
    ov.style.cssText = 'position:absolute;left:50%;bottom:11%;transform:translateX(-50%);' +
      'width:max-content;max-width:82%;z-index:25;pointer-events:none;' +
      'display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;';
    return true;
  }
  function fontPx() { const v = document.querySelector('video'); const h = (v && v.clientHeight) || 400; return Math.max(16, Math.min(40, Math.round(h * 0.042))); }
  function textWidth() { const p = document.querySelector(PLAYER); return Math.max(200, Math.round((p ? p.clientWidth : 800) * 0.82) - 24); }

  function floatingBtnCss(bottomPx) {
    return `position:fixed;right:18px;bottom:${bottomPx}px;width:40px;height:40px;border-radius:50%;` +
      window.MT_PALETTE.roundBtnCss(15) +
      'box-shadow:0 1px 6px rgba(0,0,0,.5);z-index:2147483000;';
  }
  function adShowing() {
    const pl = document.querySelector(PLAYER);
    return (pl && (pl.classList.contains('ad-showing') || pl.classList.contains('ad-interrupting'))) ||
      !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ad-showing, .ad-interrupting');
  }

  const T = TranslationCore.t;
  const ui = SubtitleAdapter.createSubtitleUI({
    telemetrySite: 'youtube',
    ids: { overlay: 'mt-yt-overlay', orig: 'mt-yt-orig', trans: 'mt-yt-trans', btn: 'mt-yt-btn', menu: 'mt-yt-menu', meas: 'mt-yt-meas' },
    maxAttempts: 8,
    hasMedia: () => !!document.querySelector(PLAYER),
    mediaKey: currentVideoId,
    getCurrentTime: () => (document.querySelector('video')?.currentTime || 0) * 1000,
    // Notices show while acquiring even if paused (YouTube behavior) → isPlaying omitted (default true).
    acquire,
    placeOverlay,
    fontPx,
    textWidth,
    onTick: (active) => { if (active) ensureCaptionsOn(); }, // per-tick until CC is on
    onMediaKeyChange: () => { ccTried = false; ttFetchedUrl = ''; ccForceToggled = false; subActiveSince = Date.now(); hookCues = null; },
    onActiveChange: (on) => {
      if (on) { injectCaptionStyle(); ccTried = false; ttFetchedUrl = ''; ccForceToggled = false; subActiveSince = Date.now(); }
      else removeCaptionStyle();
    },
    beforeRender: () => (adShowing() ? 'clear' : undefined), // during an ad, currentTime is the ad timeline
    // §2.4: YouTube is MSE, so only the live tier can serve a caption-less video.
    unavailableAction: AsrSource.offerFor(() => document.querySelector('video'), () => ui, () => ui.settings),
    syncNative: (active) => { if (!active) removeCaptionStyle(); }, // belt: restore if turned off
    showButton: () => IS_EMBED || (!!document.querySelector(RIGHT_CONTROLS) && !TranslationCore.isMobileLayout()),
    buttonCss: () => floatingBtnCss(IS_EMBED ? 10 : 150),
    srtName: () => document.title.replace(/ - YouTube$/, ''),
    translate: (text, s) => TranslationAPI.translate(
      text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
    labels: {
      btnTitle: T('yt_btn_title', '大肚猴翻译 · 视频字幕'),
      subOn: T('yt_sub_on', '开启视频字幕翻译'),
      subOff: T('yt_sub_off', '关闭视频字幕翻译'),
    },
  });

  function init(cfg) {
    // Don't run in a youtube sub-iframe that can't host a player (e.g. RotateCookiesPage).
    if (IS_EMBED && !/\/embed\//.test(location.pathname)) return;
    ui.init(cfg);
  }
  function startAsr() { return AsrSource.start(document.querySelector('video'), ui, ui.settings); }
  return { init, enable: ui.enable, disable: ui.disable, updateSettings: ui.updateSettings, startAsr };
})();
