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

  // preload state — the generic engine (TranslationCore) owns per-sentence
  // translation state (tr / pending / error) + the sliding-window preload.
  const pager = TranslationCore.createPager({ measurerId: 'mt-yt-meas' });
  const engine = TranslationCore.createSubtitleEngine({
    getCurrentTime: () => (document.querySelector('video')?.currentTime || 0) * 1000,
    translate: (text) => TranslationAPI.translate(
      text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || ''),
  });
  let transcriptVideoId = '';
  let lastShownKey = '';

  // display: 'both' | 'trans' | 'orig'
  let displayMode = 'both';

  // live-fallback state
  let lastText = '';
  let lastTranslated = '';

  // ─── Video id helpers ─────────────────────────────────────────────────
  function currentVideoId() {
    try { return new URLSearchParams(location.search).get('v') || ''; } catch (_) { return ''; }
  }
  function videoIdFromUrl(u) {
    try { return new URL(u, location.href).searchParams.get('v') || ''; } catch (_) { return ''; }
  }

  // ─── Transcript capture (from world:MAIN yt-hook.js) ──────────────────
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

  function ensureCaptionsOn() {
    const cc = document.querySelector(CC_BUTTON);
    if (cc && cc.getAttribute('aria-pressed') === 'false') cc.click();
  }

  // ─── Live fallback (no transcript captured) ───────────────────────────
  function currentCaptionText() {
    const segs = document.querySelectorAll(CAPTION_SEGMENT);
    if (!segs.length) return '';
    return Array.from(segs).map((s) => s.textContent).join(' ').replace(/[^\S\n]+/g, ' ').trim();
  }

  function liveFallback() {
    const text = currentCaptionText();
    if (!text || text.length < 2) { clearOverlay(); lastText = ''; return; }
    const fp = fontPx();
    const width = overlayTextWidth();
    const enPages = pager.pageize(text, 1, fp, width);
    const en = enPages[enPages.length - 1]; // newest 2 lines of the rolling caption
    if (text !== lastText) {
      lastText = text; lastTranslated = '';
      TranslationAPI.translate(
        text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG, settings.provider || 'google',
        settings.apiKey || '', settings.apiBaseUrl || ''
      ).then((zh) => { if (text === lastText && TranslationCore.isTranslated(text, zh)) lastTranslated = zh; }).catch(() => {});
    }
    let zh = null, state = '';
    if (lastTranslated) { const zp = pager.pageize(lastTranslated, 1, Math.round(fp * 0.95), width); zh = zp[zp.length - 1]; }
    else { state = 'pending'; }
    renderOverlay(en, zh, state);
  }

  // ─── Display loop ─────────────────────────────────────────────────────
  function tick() {
    ensureControlButton(); // always present on watch pages, even when subtitles are off
    if (!active) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }
    ensureOverlay();

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastText = ''; lastTranslated = '';
      clearOverlay();
    }

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
      liveFallback();
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
    btn.title = TranslationCore.t('yt_btn_title', '大肚猴翻译 · 视频字幕');
    btn.textContent = '译';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn); });
    return btn;
  }

  function ensureControlButton() {
    if (document.getElementById(BTN_ID)) return;
    const bar = document.querySelector(RIGHT_CONTROLS);
    if (bar) { // desktop / control bar present: a real button in the bar
      const btn = makeTranslateBtn();
      btn.className = 'ytp-button';
      btn.style.cssText =
        'position:relative;width:48px;height:100%;vertical-align:top;border:none;background:none;' +
        'cursor:pointer;font-size:15px;font-weight:700;color:#fff;opacity:.9;';
      bar.insertBefore(btn, bar.firstChild);
      return;
    }
    // No control bar. In an EMBED (no page FAB) use a small floating button.
    // On mobile m.youtube.com (top frame) the page FAB drives subtitles → no button.
    if (!IS_EMBED || !document.querySelector(PLAYER)) return;
    const btn = makeTranslateBtn();
    btn.style.cssText =
      'position:fixed;right:10px;bottom:10px;width:40px;height:40px;border-radius:50%;border:none;' +
      'cursor:pointer;background:rgba(10,122,60,.92);color:#fff;font-size:15px;font-weight:700;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.5);z-index:2147483000;';
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
    menu.style.cssText =
      (floating
        ? 'position:fixed;right:10px;bottom:58px;max-height:calc(100vh - 72px);overflow-y:auto;'
        : 'position:absolute;right:12px;bottom:60px;') +
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
      // (We do NOT auto-enable YouTube's CC. The transcript is captured whenever
      // YouTube itself fetches /api/timedtext — i.e. when captions are on.)
      // Translation is driven by engine.pump() in the display loop.
    } else {
      removeCaptionStyle();
      clearOverlay();
    }
  }

  function setSubActive(on) {
    active = on; // session-only; subtitles always start off on a fresh page load
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
