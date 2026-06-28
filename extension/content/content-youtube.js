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

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastUrl = '';

  // preload state
  let sentences = [];           // [{start, end, text, zh}] sorted by start (ms)
  let transcriptVideoId = '';
  let preloadGen = 0;
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
    sentences = mergeSentences(cues);
    transcriptVideoId = videoIdFromUrl(url) || currentVideoId();
    const gen = ++preloadGen;
    if (active) preTranslate(gen);
  }

  function parseJson3(body) {
    const data = JSON.parse(body);
    const events = data.events || [];
    const out = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
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

  // Merge cues into sentences: break on sentence-ending punctuation or a long
  // pause. Cap length so a punctuation-less run still breaks (keeps lines short
  // enough not to cover the frame).
  function mergeSentences(cues) {
    const SENT_END = /[.!?。！？…]["')\]]?$/;
    const GAP = 1200;     // ms silence → sentence boundary
    const MAX_LEN = 160;  // chars → force a break
    const out = [];
    let cur = null;
    for (const c of cues) {
      if (cur && c.start - cur.end > GAP) { out.push(cur); cur = null; }
      if (!cur) cur = { start: c.start, end: c.end, text: c.text, zh: '' };
      else { cur.text = (cur.text + ' ' + c.text).replace(/\s+/g, ' ').trim(); cur.end = c.end; }
      if (SENT_END.test(cur.text) || cur.text.length > MAX_LEN) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  }

  async function preTranslate(gen) {
    const CHUNK = 10;
    for (let i = 0; i < sentences.length; i += CHUNK) {
      if (!active || gen !== preloadGen) return;
      const chunk = sentences.slice(i, i + CHUNK).filter((s) => !s.zh);
      if (!chunk.length) continue;
      try {
        const zhs = await TranslationAPI.translateBatch(
          chunk.map((s) => s.text),
          settings.targetLang || 'zh-CN',
          settings.provider || 'google',
          settings.apiKey || '',
          settings.apiBaseUrl || ''
        );
        if (gen !== preloadGen) return;
        chunk.forEach((s, j) => { if (zhs[j] && zhs[j] !== s.text) s.zh = zhs[j]; });
      } catch (e) { /* keep going */ }
    }
  }

  function activeSentence(tMs) {
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (sentences[i].start <= tMs) return tMs < sentences[i].end ? sentences[i] : null;
    }
    return null;
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

  // ─── 2-line paging (measure the real wrapped height) ──────────────────
  // A long sentence is split into pages that each fit within maxLines at the
  // current width, so we never show 3+ lines. Pages are shown in sequence over
  // the sentence's time span. Measurement makes this work on any screen size.
  function measurer() {
    let m = document.getElementById('mt-yt-meas');
    if (!m) {
      m = document.createElement('div');
      m.id = 'mt-yt-meas';
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
    // Even paging: figure out how many pages we need, then aim for equal-length
    // pages (capped by what fits) so we don't leave a tiny trailing scrap.
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
      let cut = Math.min(fitMax, Math.max(target, Math.ceil(fitMax * 0.5)));
      let bp = cut;
      const sp = rest.lastIndexOf(' ', cut); // prefer a word boundary if reasonably close
      if (sp > cut * 0.6) bp = sp;
      pages.push(rest.slice(0, bp).trim());
      rest = rest.slice(bp).trim();
      if (pages.length > 30) { pages.push(rest); break; }
    }
    return pages.length ? pages : [text];
  }

  // Cache pages on the sentence; recompute when width / font / translation change.
  function pagesFor(s, fp, width) {
    if (!s._pg || s._pg.w !== width || s._pg.fp !== fp || s._pg.zhText !== (s.zh || '')) {
      s._pg = {
        w: width, fp, zhText: s.zh || '',
        en: pageize(s.text, 1, fp, width),
        zh: s.zh ? pageize(s.zh, 1, Math.round(fp * 0.95), width) : null,
      };
    }
    return s._pg;
  }

  function overlayTextWidth() {
    const player = document.querySelector(PLAYER);
    return Math.max(200, Math.round((player ? player.clientWidth : 800) * 0.82) - 24);
  }

  function renderOverlay(en, zh, pending) {
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
    if (displayMode === 'orig' || (!zh && !pending)) {
      zhEl.style.display = 'none'; zhEl.textContent = '';
    } else if (pending) {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.82), '#d6d6d6') + 'opacity:.85;font-style:italic;';
      zhEl.textContent = zh;
    } else {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.95), settings.ytTextColor || '#fff');
      zhEl.textContent = zh;
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
    return Array.from(segs).map((s) => s.textContent).join(' ').replace(/\s+/g, ' ').trim();
  }

  function liveFallback() {
    const text = currentCaptionText();
    if (!text || text.length < 2) { clearOverlay(); lastText = ''; return; }
    const fp = fontPx();
    const width = overlayTextWidth();
    const enPages = pageize(text, 1, fp, width);
    const en = enPages[enPages.length - 1]; // newest 2 lines of the rolling caption
    if (text !== lastText) {
      lastText = text; lastTranslated = '';
      TranslationAPI.translate(
        text, settings.targetLang || 'zh-CN', settings.provider || 'google',
        settings.apiKey || '', settings.apiBaseUrl || ''
      ).then((zh) => { if (text === lastText && zh && zh !== text) lastTranslated = zh; }).catch(() => {});
    }
    let zh, pending = false;
    if (lastTranslated) { const zp = pageize(lastTranslated, 1, Math.round(fp * 0.95), width); zh = zp[zp.length - 1]; }
    else { zh = '⏳ 译文准备中…'; pending = true; }
    renderOverlay(en, zh, pending);
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
      ensureCaptionsOn();
    }

    const haveTranscript = sentences.length && transcriptVideoId === currentVideoId();
    if (haveTranscript) {
      const v = document.querySelector('video');
      if (!v) return;
      const tMs = v.currentTime * 1000;
      const s = activeSentence(tMs);
      if (!s) { if (lastShownKey) clearOverlay(); return; }
      const fp = fontPx();
      const width = overlayTextWidth();
      const frac = Math.min(0.999, Math.max(0, (tMs - s.start) / Math.max(1, s.end - s.start)));
      const pg = pagesFor(s, fp, width);
      const en = pg.en[Math.min(pg.en.length - 1, Math.floor(frac * pg.en.length))];
      let zh, pending = false;
      if (s.zh && pg.zh) zh = pg.zh[Math.min(pg.zh.length - 1, Math.floor(frac * pg.zh.length))];
      else { zh = '⏳ 译文准备中…'; pending = true; }
      const key = s.start + '|' + en + '|' + zh;
      if (key !== lastShownKey) { renderOverlay(en, zh, pending); lastShownKey = key; }
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
  function ensureControlButton() {
    const bar = document.querySelector(RIGHT_CONTROLS);
    if (!bar || document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'ytp-button';
    btn.title = '大肚猴翻译';
    btn.style.cssText =
      'position:relative;width:48px;height:100%;vertical-align:top;border:none;background:none;' +
      'cursor:pointer;font-size:15px;font-weight:700;color:#fff;opacity:.9;';
    btn.textContent = '译';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn); });
    bar.insertBefore(btn, bar.firstChild);
  }

  function closeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function toggleMenu(btn) {
    if (document.getElementById(MENU_ID)) { closeMenu(); return; }
    const player = btn.closest('.html5-video-player') || document.querySelector('#movie_player');
    if (!player) return;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.style.cssText =
      'position:absolute;right:12px;bottom:60px;z-index:9999;min-width:200px;' +
      'background:rgba(28,28,28,.95);border-radius:10px;padding:6px 0;' +
      'font-size:13px;color:#eee;box-shadow:0 2px 12px rgba(0,0,0,.5);';

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
    menu.appendChild(row(active ? '关闭视频字幕翻译' : '开启视频字幕翻译', { checked: active, onClick: () => setSubActive(!active) }));
    menu.appendChild(sep());

    const head = document.createElement('div');
    head.textContent = '字幕显示类型';
    head.style.cssText = 'padding:6px 16px 2px;font-size:11px;color:#9a9a9a;';
    menu.appendChild(head);
    menu.appendChild(row('双语字幕', { checked: displayMode === 'both', onClick: () => setMode('both') }));
    menu.appendChild(row('仅译文', { checked: displayMode === 'trans', onClick: () => setMode('trans') }));
    menu.appendChild(row('仅原文', { checked: displayMode === 'orig', onClick: () => setMode('orig') }));
    menu.appendChild(sep());
    menu.appendChild(row('下载字幕 (.srt)', { onClick: () => { downloadSrt(); closeMenu(); } }));
    menu.appendChild(row('设置', { onClick: () => { openSettings(); closeMenu(); } }));

    player.appendChild(menu);
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
    if (!sentences.length) { alert('字幕还没准备好,等翻译加载后再试'); return; }
    let srt = '';
    sentences.forEach((s, i) => {
      const body = displayMode === 'orig' ? s.text
        : displayMode === 'trans' ? (s.zh || s.text)
        : s.text + (s.zh ? '\n' + s.zh : '');
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
      ensureCaptionsOn();
      if (sentences.length && transcriptVideoId === currentVideoId()) preTranslate(++preloadGen);
    } else {
      removeCaptionStyle();
      clearOverlay();
    }
  }

  function setSubActive(on) {
    active = on;
    try { chrome.storage.local.set({ ytSubEnabled: on }); } catch (_) {}
    applySubtitleState();
    closeMenu();
    tick();
  }

  function init(cfg) {
    settings = cfg;
    active = cfg.ytSubEnabled !== false; // subtitles on by default
    startLoop();                         // always running → keeps the 译 button present
    applySubtitleState();
  }

  // thin wrappers kept for API compatibility
  function enable(cfg) { if (cfg) settings = cfg; setSubActive(true); }
  function disable() { setSubActive(false); }

  function updateSettings(cfg) {
    settings = cfg;
    sentences.forEach((s) => { s.zh = ''; s._pg = null; });
    clearOverlay();
    if (active && sentences.length && transcriptVideoId === currentVideoId()) preTranslate(++preloadGen);
  }

  return { init, enable, disable, updateSettings };
})();
