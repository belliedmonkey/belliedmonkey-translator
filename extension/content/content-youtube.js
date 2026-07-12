// content-youtube.js — YouTube bilingual subtitles
//
// Strategy: PRELOAD + translate-ahead, rendered in our OWN overlay.
// 1. yt-hook.js (world:MAIN) captures YouTube's /api/timedtext response and
//    posts the full transcript here.
// 2. We parse it into cues, MERGE cues into sentences (context → fluent
//    translation), and batch-translate the sentences ahead of playback.
// 3. We HIDE YouTube's own caption rendering and draw our own fixed, centered
//    overlay showing the current sentence's ORIGINAL line + TRANSLATION, matched
//    by video.currentTime. This means: the English shows as a whole sentence
//    (not word-by-word rollup), it doesn't jump when the controls/cursor toggle
//    (it's our element at a fixed position), and it's centered with a capped
//    width so it never covers too much of the frame.
// Falls back to translating the live caption text if no transcript is captured.

var YouTubeTranslator = (() => {
  const CAPTION_SEGMENT = '.ytp-caption-segment';
  const CC_BUTTON = '.ytp-subtitles-button';
  const RIGHT_CONTROLS = '.ytp-right-controls';
  const PLAYER = '#movie_player, .html5-video-player';
  const BTN_ID = 'mt-yt-btn';
  const MENU_ID = 'mt-yt-menu';
  const OVERLAY_ID = 'mt-yt-overlay';
  const ORIG_CLASS = 'mt-yt-orig';
  const TRANS_CLASS = 'mt-yt-trans';
  const IS_EMBED = window.top !== window.self; // embedded player inside an iframe

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastUrl = '';
  let ccTried = false; // one-shot guard: don't re-toggle CC every tick

  // preload state — the generic engine (TranslationCore) owns per-sentence
  // translation state (tr / pending / error) + the sliding-window preload.
  const pager = TranslationCore.createPager({ measurerId: 'mt-yt-meas' });
  const engine = TranslationCore.createSubtitleEngine({
    getCurrentTime: () => (document.querySelector('video')?.currentTime || 0) * 1000,
    translate: (text) => TranslationAPI.translate(
      text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || '', settings.apiModel || ''),
  });
  let transcriptVideoId = '';
  let lastShownKey = '';

  // display: 'both' | 'trans' | 'orig'
  let displayMode = 'both';

  // transcript acquisition state (see domain-design §2.1 — one-shot full
  // transcript, NO per-caption / word-by-word translation).
  let transcriptStatus = '';   // '' | 'loading' | 'ready' | 'unavailable'
  let ttFetchedUrl = '';       // the /api/timedtext URL we last re-fetched (dedupe)
  let ttAttempts = 0;          // re-fetch attempts for the current video (capped)
  let subActiveSince = 0;      // when subtitles were turned on (for the unavailable timeout)
  const TT_MAX_ATTEMPTS = 8;   // stop re-fetching after this many empty/failed tries
  const TT_UNAVAILABLE_MS = 14000; // no transcript this long after enabling → notice

  // ─── Video id helpers ─────────────────────────────────────────────────
  function currentVideoId() {
    try { return new URLSearchParams(location.search).get('v') || ''; } catch (_) { return ''; }
  }
  function videoIdFromUrl(u) {
    try { return new URL(u, location.href).searchParams.get('v') || ''; } catch (_) { return ''; }
  }

  // ─── Transcript capture ───────────────────────────────────────────────
  // OPPORTUNISTIC (Chrome): yt-hook.js runs in world:MAIN, hooks fetch/XHR, and
  // posts us YouTube's own /api/timedtext BODY directly. Safari does NOT support
  // world:MAIN, so this never fires there — the Resource Timing path below is the
  // cross-platform source.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__mtYtHook !== true || d.type !== 'timedtext') return;
    handleTimedText(d.url, d.body);
  });

  function handleTimedText(url, body) {
    let cues;
    try { cues = parseJson3(body); } catch (_) { return; }
    if (!cues.length) return;
    // The engine merges cues into sentences and drives the sliding-window
    // translate-ahead from the display loop (engine.pump in tick).
    engine.setItems(TranslationCore.mergeSentences(cues));
    transcriptVideoId = videoIdFromUrl(url) || currentVideoId();
    transcriptStatus = 'ready';
  }

  // CROSS-PLATFORM (incl. Safari): a direct fetch of the caption-track baseUrl is
  // pot-blocked (HTTP 200, empty body). So once captions are on, YouTube's OWN
  // /api/timedtext request — carrying a valid pot/signature — appears in the
  // Resource Timing API. We read that exact URL (readable from the isolated
  // content script) and re-fetch it ourselves for the full json3 transcript.
  //
  // The Resource Timing BUFFER evicts old entries (default 250) — on a heavy page
  // like YouTube the timedtext request (fetched during initial load when CC was
  // already on) can rotate out before a one-shot scan runs. So we ALSO register a
  // PerformanceObserver at load that records the URL the moment it happens (immune
  // to eviction). If neither sees it, we toggle CC off→on to force a fresh fetch.
  let ttObservedUrl = '';      // latest /api/timedtext URL seen by the observer
  let ccForceToggled = false;  // one-shot: forced a CC off→on to refetch this video
  try {
    performance.setResourceTimingBufferSize(5000);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name && e.name.indexOf('/api/timedtext') !== -1) ttObservedUrl = e.name;
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}

  function normalizeTimedTextUrl(u) {
    try {
      const url = new URL(u, location.href);
      url.searchParams.set('fmt', 'json3'); // we parse json3
      url.searchParams.delete('tlang');     // want the ORIGINAL track, not YouTube's translation
      return url.toString();
    } catch (_) { return u; }
  }

  // Force YouTube to (re)fetch /api/timedtext so the observer catches the URL.
  // Only safe when captions are confirmed ON (segments present) — then off→on
  // ends ON. (If CC were off, a blind off→on would end OFF.)
  function forceCcRefetch() {
    if (!document.querySelector(CAPTION_SEGMENT)) return;
    const btn = document.querySelector(CC_BUTTON) || document.querySelector('.ytmClosedCaptioningButtonButton');
    if (!btn) return;
    try { btn.click(); setTimeout(() => { try { btn.click(); } catch (_) {} }, 400); } catch (_) {}
  }

  function timedTextUrlForCurrentVideo() {
    const vid = currentVideoId();
    const matchesVid = (u) => { try { return !vid || new URL(u).searchParams.get('v') === vid; } catch (_) { return true; } };
    // 1) the document_start observer's list (most reliable — registered before
    //    YouTube fetches, so never lost to buffer eviction). Newest match wins.
    const early = window.__mtTimedTextUrls || [];
    for (let i = early.length - 1; i >= 0; i--) { if (matchesVid(early[i])) return early[i]; }
    // 2) our in-file observer (document_idle)
    if (ttObservedUrl && matchesVid(ttObservedUrl)) return ttObservedUrl;
    // 3) one-shot buffer scan (last matching request = active track)
    let entries; try { entries = performance.getEntriesByType('resource'); } catch (_) { entries = []; }
    let best = '';
    for (const e of entries) {
      if (!e.name || e.name.indexOf('/api/timedtext') === -1) continue;
      if (!matchesVid(e.name)) continue;
      best = e.name;
    }
    return best;
  }

  function captureTranscript() {
    if (engine.items.length && transcriptVideoId === currentVideoId()) return;
    if (ttAttempts >= TT_MAX_ATTEMPTS) return;
    const vid = currentVideoId();
    const best = timedTextUrlForCurrentVideo();
    if (!best) {
      // Nothing seen yet — after a short grace, force a fresh fetch (handles CC
      // already-on-at-load whose request was evicted before we could observe it).
      if (!ccForceToggled && (Date.now() - subActiveSince) > 3000) { ccForceToggled = true; forceCcRefetch(); }
      return;
    }
    const url = normalizeTimedTextUrl(best);
    if (url === ttFetchedUrl) return; // already (re)fetched this exact URL
    ttFetchedUrl = url;
    ttAttempts++;
    transcriptStatus = transcriptStatus === 'ready' ? 'ready' : 'loading';
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((body) => {
        let cues;
        try { cues = parseJson3(body); } catch (_) { cues = []; }
        if (!cues.length) { ttFetchedUrl = ''; return; } // empty (pot?) — let a fresh URL retry
        engine.setItems(TranslationCore.mergeSentences(cues));
        transcriptVideoId = vid;
        transcriptStatus = 'ready';
      })
      .catch(() => { ttFetchedUrl = ''; });
  }

  function parseJson3(body) {
    const data = JSON.parse(body);
    const events = data.events || [];
    const out = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      // Collapse horizontal whitespace only (keep \n; never force a space into a
      // no-space script — the engine's joinCue handles cross-cue CJK spacing).
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/[^\S\n]+/g, ' ').trim();
      if (!text) continue;
      const start = ev.tStartMs || 0;
      const end = ev.dDurationMs ? start + ev.dDurationMs : 0;
      out.push({ start, end, text });
    }
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i < out.length; i++) {
      if (!out[i].end || out[i].end <= out[i].start) {
        out[i].end = i + 1 < out.length ? out[i + 1].start : out[i].start + 4000;
      }
    }
    return out;
  }

  // ─── Our own subtitle overlay (centered, fixed position) ───────────────
  function ensureOverlay() {
    const player = document.querySelector(PLAYER);
    if (!player) return null;
    let ov = document.getElementById(OVERLAY_ID);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = OVERLAY_ID;
      ov.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
      // Fixed to the player, centered, above the control bar. Because it's OUR
      // element at a constant bottom %, it does not jump when the controls show.
      ov.style.cssText =
        'position:absolute;left:50%;bottom:11%;transform:translateX(-50%);' +
        'width:max-content;max-width:82%;z-index:25;pointer-events:none;' +
        'display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;';
      const en = document.createElement('div'); en.className = ORIG_CLASS;
      const zh = document.createElement('div'); zh.className = TRANS_CLASS;
      ov.appendChild(en); ov.appendChild(zh);
      player.appendChild(ov);
    } else if (ov.parentElement !== player) {
      player.appendChild(ov);
    }
    return ov;
  }

  function lineCss(fontPx, color) {
    return 'display:inline-block;max-width:100%;box-sizing:border-box;' +
      `color:${color};font-size:${fontPx}px;line-height:1.3;` +
      'padding:2px 10px;background:rgba(8,8,8,0.78);border-radius:3px;' +
      'text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;' +
      'text-shadow:1px 1px 2px rgba(0,0,0,0.85);';
  }

  function fontPx() {
    const v = document.querySelector('video');
    const h = (v && v.clientHeight) || 400;
    return Math.max(16, Math.min(40, Math.round(h * 0.042)));
  }

  // ─── 1-line paging (the measure-based pager lives in TranslationCore) ──
  // Cache pages on the sentence; recompute when width / font / translation change.
  function pagesFor(s, fp, width) {
    if (!s._pg || s._pg.w !== width || s._pg.fp !== fp || s._pg.trText !== (s.tr || '')) {
      s._pg = {
        w: width, fp, trText: s.tr || '',
        en: pager.pageize(s.text, 1, fp, width),
        zh: s.tr ? pager.pageize(s.tr, 1, Math.round(fp * 0.95), width) : null,
      };
    }
    return s._pg;
  }

  function overlayTextWidth() {
    const player = document.querySelector(PLAYER);
    return Math.max(200, Math.round((player ? player.clientWidth : 800) * 0.82) - 24);
  }

  // state: '' (nothing) | 'pending' (translating, behind playback) | 'error'.
  // `sentence` is passed for the error case so the retry button can reset it.
  function renderOverlay(en, zh, state, sentence) {
    const ov = ensureOverlay();
    if (!ov) return;
    const enEl = ov.querySelector('.' + ORIG_CLASS);
    const zhEl = ov.querySelector('.' + TRANS_CLASS);
    const fp = fontPx();
    if (displayMode === 'trans' || !en) {
      enEl.style.display = 'none'; enEl.textContent = '';
    } else {
      enEl.style.cssText = lineCss(fp, '#fff');
      enEl.textContent = en;
    }
    zhEl.onclick = null;
    if (displayMode === 'orig') {
      zhEl.style.display = 'none'; zhEl.textContent = '';
    } else if (zh) {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.95), settings.ytTextColor || '#fff');
      zhEl.textContent = zh;
    } else if (state === 'error') {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.8), '#ffb3b3') + 'pointer-events:auto;cursor:pointer;';
      zhEl.textContent = TranslationCore.MSG.error;
      zhEl.onclick = () => { engine.retry(sentence); lastShownKey = ''; };
    } else if (state === 'pending') {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.82), '#d6d6d6') + 'opacity:.85;font-style:italic;';
      zhEl.textContent = TranslationCore.MSG.preparing;
    } else {
      zhEl.style.display = 'none'; zhEl.textContent = '';
    }
  }

  function clearOverlay() {
    const ov = document.getElementById(OVERLAY_ID);
    if (ov) { ov.querySelector('.' + ORIG_CLASS).textContent = ''; ov.querySelector('.' + TRANS_CLASS).textContent = ''; }
    lastShownKey = '';
  }
  function removeOverlay() { document.getElementById(OVERLAY_ID)?.remove(); document.getElementById('mt-yt-meas')?.remove(); }

  // Hide YouTube's own caption rendering (we draw our own). opacity:0 keeps the
  // nodes updating + readable (for the live fallback) while invisible.
  function injectCaptionStyle() {
    if (document.getElementById('mt-yt-style')) return;
    const st = document.createElement('style');
    st.id = 'mt-yt-style';
    st.textContent = '.ytp-caption-window-container{opacity:0!important;pointer-events:none!important;}';
    (document.head || document.documentElement).appendChild(st);
  }
  function removeCaptionStyle() { document.getElementById('mt-yt-style')?.remove(); }

  // Reveal the player controls so the (mobile) CC button mounts. On the mobile ytm
  // player a single tap on the video toggles the CONTROLS CHROME (it does NOT
  // play/pause — that's a separate center button), so a synthetic tap at an
  // off-center point (30% from the top, away from the center play button) surfaces
  // the controls without pausing. Desktop also reveals on mousemove. We only do
  // this while looking to enable CC (controls not up yet).
  function surfacePlayerControls() {
    const p = document.querySelector(PLAYER);
    if (!p) return;
    const r = p.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height * 0.3);
    const target = document.elementFromPoint(x, y) || p;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    // desktop hover reveal
    try { p.dispatchEvent(new MouseEvent('mousemove', base)); } catch (_) {}
    // mobile touch tap reveal
    try {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, radiusX: 1, radiusY: 1 });
      const te = (type, touches) => new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: [t] });
      target.dispatchEvent(te('touchstart', [t]));
      target.dispatchEvent(te('touchend', []));
    } catch (_) {
      // Fallback for engines without constructable TouchEvent: pointer tap.
      try {
        target.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch', isPrimary: true }, base)));
        target.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch', isPrimary: true }, base)));
        target.dispatchEvent(new MouseEvent('click', base));
      } catch (_) {}
    }
  }

  // Turn YouTube's own CC on so it fetches /api/timedtext (which mints a valid
  // pot we capture via the Resource Timing observer). Cross-platform: desktop uses
  // `.ytp-subtitles-button` (in the DOM even when controls are hidden); mobile
  // m.youtube.com uses `.ytmClosedCaptioningButtonButton`, which only mounts while
  // controls are visible — so we surface the controls first. We click once
  // (ccTried guard) only when no captions are active yet, never toggling a user's
  // CC back off.
  function ensureCaptionsOn() {
    if (ccTried) return;
    // Already have captions? Nothing to do (and mark tried so we don't fight it).
    if (engine.items.length || document.querySelector(CAPTION_SEGMENT)) { ccTried = true; return; }
    const cc = document.querySelector(CC_BUTTON);
    if (cc) {
      if (cc.getAttribute('aria-pressed') === 'false') cc.click();
      ccTried = true;
      return;
    }
    let mcc = document.querySelector('.ytmClosedCaptioningButtonButton');
    if (!mcc) { surfacePlayerControls(); mcc = document.querySelector('.ytmClosedCaptioningButtonButton'); }
    if (mcc) {
      // Mobile button exposes no aria-pressed; click once to turn captions on.
      if (mcc.getAttribute('aria-pressed') !== 'true') mcc.click();
      ccTried = true;
    }
    // else: controls not up yet — leave ccTried false so the next tick retries.
  }

  // ─── Acquisition notice (NO word-by-word fallback — see domain-design §2.1) ──
  // While the one-shot transcript is being acquired we show a single dimmed line;
  // if it truly can't be obtained we say so. We never translate the rolling live
  // caption DOM word-by-word.
  function renderNotice(msg) {
    const ov = ensureOverlay();
    if (!ov) return;
    const enEl = ov.querySelector('.' + ORIG_CLASS);
    const zhEl = ov.querySelector('.' + TRANS_CLASS);
    enEl.style.display = 'none'; enEl.textContent = '';
    zhEl.onclick = null;
    zhEl.style.cssText = lineCss(Math.round(fontPx() * 0.82), '#d6d6d6') + 'opacity:.85;font-style:italic;';
    zhEl.textContent = msg;
  }

  // ─── Display loop ─────────────────────────────────────────────────────
  function tick() {
    ensureControlButton(); // always present on watch pages, even when subtitles are off
    if (!active) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }
    ensureOverlay();
    ensureCaptionsOn(); // make YouTube fetch captions once (so it mints a pot)

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ccTried = false;            // new video → ensure CC again
      ttFetchedUrl = ''; ttAttempts = 0; transcriptStatus = ''; ccForceToggled = false;
      subActiveSince = Date.now();
      clearOverlay();
    }

    // During an ad the player's currentTime is the AD timeline — don't map it onto
    // the main-video transcript (it would show a mismatched subtitle over the ad).
    const pl = document.querySelector(PLAYER);
    const adShowing = (pl && (pl.classList.contains('ad-showing') || pl.classList.contains('ad-interrupting'))) ||
      !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ad-showing, .ad-interrupting');
    if (adShowing) { if (lastShownKey) clearOverlay(); return; }

    const haveTranscript = engine.items.length && transcriptVideoId === currentVideoId();
    if (haveTranscript) {
      const v = document.querySelector('video');
      if (!v) return;
      const tMs = v.currentTime * 1000;
      engine.pump(); // keep a window of upcoming sentences translated
      const s = engine.activeAt(tMs);
      if (!s) { if (lastShownKey) clearOverlay(); return; }
      const fp = fontPx();
      const width = overlayTextWidth();
      const frac = Math.min(0.999, Math.max(0, (tMs - s.start) / Math.max(1, s.end - s.start)));
      const pg = pagesFor(s, fp, width);
      const en = pg.en[Math.min(pg.en.length - 1, Math.floor(frac * pg.en.length))];
      // The engine decides the state (translation ready / pending+behind / error);
      // the adapter only pages the translation for the current time fraction.
      const st = engine.stateOf(s, tMs);
      let zh = null;
      if (st.translation && pg.zh) zh = pg.zh[Math.min(pg.zh.length - 1, Math.floor(frac * pg.zh.length))];
      const key = s.start + '|' + en + '|' + (zh || st.state);
      if (key !== lastShownKey) { renderOverlay(en, zh, st.state, s); lastShownKey = key; }
    } else {
      // No transcript yet — try to capture YouTube's own pot-bearing timedtext URL
      // and re-fetch the full transcript. Show a notice, never word-by-word.
      captureTranscript();
      lastShownKey = '';
      const waited = Date.now() - subActiveSince;
      if (transcriptStatus !== 'ready' && (ttAttempts >= TT_MAX_ATTEMPTS || waited > TT_UNAVAILABLE_MS)) {
        renderNotice(TranslationCore.t('yt_subtitle_unavailable', '字幕不可用'));
      } else {
        renderNotice(TranslationCore.t('yt_subtitle_loading', '⏳ 字幕加载中…'));
      }
    }
  }

  function startLoop() {
    if (pollTimer) clearInterval(pollTimer);
    lastUrl = location.href;
    pollTimer = setInterval(tick, 250);
  }

  // ─── In-player control button + menu ──────────────────────────────────
  function makeTranslateBtn() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
    btn.title = TranslationCore.t('yt_btn_title', '大肚猴翻译 · 视频字幕');
    btn.textContent = '译';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn); });
    return btn;
  }

  // The in-player 译 button is ALWAYS an always-visible green circular floating button,
  // identical across youtube.com (desktop + touch) and third-party embeds — one widget,
  // one code path. On youtube.com it sits above the page FAB (bottom:150px); in an embed
  // there is no page FAB so it sits at the corner (bottom:10px).
  function floatingBtnCss(bottomPx) {
    return `position:fixed;right:18px;bottom:${bottomPx}px;width:40px;height:40px;border-radius:50%;border:none;` +
      'cursor:pointer;background:rgba(10,122,60,.92);color:#fff;font-size:15px;font-weight:700;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.5);z-index:2147483000;';
  }

  function ensureControlButton() {
    if (document.getElementById(BTN_ID)) return;
    const hasBar = !!document.querySelector(RIGHT_CONTROLS); // desktop-layout player
    // No separate in-player 译 button on mobile — the page FAB drives the video
    // subtitles. This covers both m.youtube.com (no control bar) AND a phone/iPad on the
    // desktop-layout www.youtube.com (which HAS the control bar but is still a touch
    // device). Same TranslationCore.isMobileLayout() signal that content-main uses to
    // route the FAB, so the two never disagree (two-button collision). Embeds still get it.
    if (!IS_EMBED && (!hasBar || TranslationCore.isMobileLayout())) return;
    if (!document.querySelector(PLAYER)) return;
    const btn = makeTranslateBtn();
    btn.style.cssText = floatingBtnCss(IS_EMBED ? 10 : 150);
    document.body.appendChild(btn);
  }

  function closeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function toggleMenu(btn) {
    if (document.getElementById(MENU_ID)) { closeMenu(); return; }
    const floating = getComputedStyle(btn).position === 'fixed'; // mobile floating button
    const player = btn.closest('.html5-video-player') || document.querySelector('#movie_player');
    if (!floating && !player) return;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
    // Anchor the menu just above the floating button wherever it sits (embed bottom:10,
    // youtube.com bottom:150), computed from the button's actual rect.
    let posCss;
    if (floating) {
      const r = btn.getBoundingClientRect();
      const right = Math.max(10, Math.round(window.innerWidth - r.right));
      const bottom = Math.max(10, Math.round(window.innerHeight - r.top + 8));
      posCss = `position:fixed;right:${right}px;bottom:${bottom}px;max-height:calc(100vh - 72px);overflow-y:auto;`;
    } else {
      posCss = 'position:absolute;right:12px;bottom:60px;';
    }
    menu.style.cssText = posCss +
      'z-index:2147483000;min-width:210px;background:rgba(28,28,28,.97);border-radius:10px;' +
      'padding:6px 0;font-size:14px;color:#eee;box-shadow:0 2px 12px rgba(0,0,0,.5);';

    const row = (label, opts = {}) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;white-space:nowrap;';
      r.addEventListener('mouseenter', () => (r.style.background = 'rgba(255,255,255,.1)'));
      r.addEventListener('mouseleave', () => (r.style.background = 'none'));
      const tk = document.createElement('span');
      tk.textContent = opts.checked ? '✓' : '';
      tk.style.cssText = 'width:12px;display:inline-block;color:#4caf50;';
      const t = document.createElement('span'); t.textContent = label; t.style.flex = '1';
      r.appendChild(tk); r.appendChild(t);
      if (opts.onClick) r.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
      return r;
    };
    const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:rgba(255,255,255,.12);margin:5px 0;'; return s; };

    // Video subtitle on/off (this button controls the VIDEO; the page FAB
    // controls the rest of the page — title / description / comments).
    const T = TranslationCore.t;
    menu.appendChild(row(active ? T('yt_sub_off', '关闭视频字幕翻译') : T('yt_sub_on', '开启视频字幕翻译'), { checked: active, onClick: () => setSubActive(!active) }));
    menu.appendChild(sep());

    const head = document.createElement('div');
    head.textContent = T('yt_display_type', '字幕显示类型');
    head.style.cssText = 'padding:6px 16px 2px;font-size:11px;color:#9a9a9a;';
    menu.appendChild(head);
    menu.appendChild(row(T('yt_mode_both', '双语字幕'), { checked: displayMode === 'both', onClick: () => setMode('both') }));
    menu.appendChild(row(T('yt_mode_trans', '仅译文'), { checked: displayMode === 'trans', onClick: () => setMode('trans') }));
    menu.appendChild(row(T('yt_mode_orig', '仅原文'), { checked: displayMode === 'orig', onClick: () => setMode('orig') }));
    menu.appendChild(sep());
    menu.appendChild(row(T('yt_download_srt', '下载字幕 (.srt)'), { onClick: () => { downloadSrt(); closeMenu(); } }));
    menu.appendChild(row(T('settings', '设置'), { onClick: () => { openSettings(); closeMenu(); } }));

    (floating ? document.body : player).appendChild(menu);
    setTimeout(() => {
      const off = (e) => {
        if (!menu.contains(e.target) && e.target.id !== BTN_ID) { closeMenu(); document.removeEventListener('click', off); }
      };
      document.addEventListener('click', off);
    }, 0);
  }

  function setMode(mode) {
    displayMode = mode;
    clearOverlay();
    closeMenu();
    tick();
  }

  // ─── .srt export ──────────────────────────────────────────────────────
  function msToSrt(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000),
          s = Math.floor((ms % 60000) / 1000), z = ms % 1000;
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(z, 3)}`;
  }

  function downloadSrt() {
    const items = engine.items;
    if (!items.length) { alert(TranslationCore.t('yt_subtitle_not_ready', '字幕还没准备好,等翻译加载后再试')); return; }
    let srt = '';
    items.forEach((s, i) => {
      const body = displayMode === 'orig' ? s.text
        : displayMode === 'trans' ? (s.tr || s.text)
        : s.text + (s.tr ? '\n' + s.tr : '');
      srt += `${i + 1}\n${msToSrt(s.start)} --> ${msToSrt(s.end)}\n${body}\n\n`;
    });
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.setAttribute('translate', 'no'); // own UI — keeps the SPA observer quiet
    a.href = URL.createObjectURL(blob);
    a.download = (document.title.replace(/ - YouTube$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'subtitle') + '.srt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function openSettings() {
    try {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open(chrome.runtime.getURL('options/options.html'), '_blank');
    } catch (_) {
      window.open(chrome.runtime.getURL('options/options.html'), '_blank');
    }
  }

  function removeControlUI() { document.getElementById(BTN_ID)?.remove(); closeMenu(); }

  // ─── Public API ───────────────────────────────────────────────────────
  // Video subtitles are controlled here (by the in-player 译 button), independent
  // of the page FAB (which controls webpage text). Default ON, persisted as
  // `ytSubEnabled`.
  function applySubtitleState() {
    if (active) {
      injectCaptionStyle();
      // We auto-enable YouTube's CC (ensureCaptionsOn) so YouTube fetches
      // /api/timedtext and mints a valid pot; we then capture that URL from the
      // Resource Timing API and re-fetch the full transcript. Translation is
      // driven by engine.pump() (60s translate-ahead) in the display loop.
    } else {
      removeCaptionStyle();
      clearOverlay();
    }
  }

  function setSubActive(on) {
    active = on; // session-only; subtitles always start off on a fresh page load
    if (on) {
      ccTried = false; // re-try enabling CC each time we turn subtitles on
      ttFetchedUrl = ''; ttAttempts = 0; transcriptStatus = ''; ccForceToggled = false;
      subActiveSince = Date.now();
    }
    applySubtitleState();
    closeMenu();
    tick();
  }

  function init(cfg) {
    settings = cfg;
    active = false; // subtitles start OFF; user enables via the 译 button menu
    // Don't poll in a youtube sub-iframe that can't host a player (e.g.
    // youtube.com's RotateCookiesPage). Real embed players have /embed/ in the
    // path; the top frame may SPA-navigate to a watch page, so always run there.
    if (IS_EMBED && !/\/embed\//.test(location.pathname)) return;
    startLoop();    // keeps the 译 button present + drives the display loop
  }

  // thin wrappers kept for API compatibility
  function enable(cfg) { if (cfg) settings = cfg; setSubActive(true); }
  function disable() { setSubActive(false); }

  function updateSettings(cfg) {
    settings = cfg;
    engine.reset(); // clear translations/state → engine.pump re-translates with the new engine
    clearOverlay();
  }

  return { init, enable, disable, updateSettings };
})();
