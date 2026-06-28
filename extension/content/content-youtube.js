// content-youtube.js — YouTube bilingual subtitles
//
// Strategy: PRELOAD + translate-ahead. yt-hook.js (world:MAIN) captures
// YouTube's own /api/timedtext response and posts the full transcript here. We
// parse it into cues, MERGE cues into sentences (better context → fluent
// translation), batch-translate the sentences ahead of playback, and display
// the pre-translated line by matching video.currentTime to the active sentence
// — no per-caption translation lag. An in-player control button offers display
// modes (bilingual / translation-only / original-only), .srt download, and
// settings. Falls back to live DOM translation if no transcript is captured.

var YouTubeTranslator = (() => {
  const DUAL_CLASS = 'mt-yt-dual';
  const CAPTION_CONTAINER = '.ytp-caption-window-container';
  const CAPTION_WINDOW = '.caption-window';
  const CAPTION_SEGMENT = '.ytp-caption-segment';
  const CC_BUTTON = '.ytp-subtitles-button';
  const RIGHT_CONTROLS = '.ytp-right-controls';
  const BTN_ID = 'mt-yt-btn';
  const MENU_ID = 'mt-yt-menu';

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastUrl = '';

  // preload state
  let sentences = [];           // [{start, end, text, zh}] sorted by start (ms)
  let transcriptVideoId = '';
  let preloadGen = 0;
  let lastShownZh = '';

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

  // Merge consecutive cues into sentences: break on sentence-ending punctuation
  // or a long pause. Translating a whole sentence gives the engine context, so
  // the output reads naturally instead of choppy fragment-by-fragment.
  function mergeSentences(cues) {
    const SENT_END = /[.!?。！？…]["')\]]?$/;
    const GAP = 1200; // ms silence → sentence boundary
    const MAX_LEN = 220; // safety: don't let a punctuation-less run grow forever
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

  // Background batch translation, in playback order, filling sentence.zh.
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
      } catch (e) {
        // keep going — later chunks may still succeed
      }
    }
  }

  function activeSentence(tMs) {
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (sentences[i].start <= tMs) return tMs < sentences[i].end ? sentences[i] : null;
    }
    return null;
  }

  // ─── Bilingual line (visual) ──────────────────────────────────────────
  function renderDualLine(translated) {
    const win = document.querySelector(CAPTION_WINDOW) || document.querySelector(CAPTION_CONTAINER);
    if (!win) return;
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach((el) => {
      if (el.parentElement !== win) el.remove();
    });
    let line = Array.from(win.children).find(
      (c) => c.classList && c.classList.contains(DUAL_CLASS)
    );
    if (!line) {
      line = document.createElement('div');
      line.className = DUAL_CLASS;
      win.appendChild(line);
    }
    const seg = document.querySelector(CAPTION_SEGMENT);
    line.style.cssText = `
      display: block;
      width: fit-content;
      max-width: 88vw;
      box-sizing: border-box;
      text-align: left;
      color: ${settings.ytTextColor || '#ffffff'};
      font-size: ${seg ? getComputedStyle(seg).fontSize : '1em'};
      line-height: 1.3;
      margin: 2px auto 0 0;
      background: rgba(8, 8, 8, 0.75);
      padding: 1px 8px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.85);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      pointer-events: none;
    `;
    line.textContent = translated;
  }

  function removeDualLine() {
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach((el) => el.remove());
  }

  function injectCaptionStyle() {
    if (document.getElementById('mt-yt-style')) return;
    const st = document.createElement('style');
    st.id = 'mt-yt-style';
    st.textContent =
      '.caption-window{overflow:visible!important;height:auto!important;max-height:none!important;bottom:11%!important;}' +
      '.ytp-caption-window-container{overflow:visible!important;}' +
      // translation-only mode: hide YouTube's own caption text, keep our line
      `body.mt-yt-only-trans .caption-window ${CAPTION_SEGMENT}{display:none!important;}`;
    (document.head || document.documentElement).appendChild(st);
  }
  function removeCaptionStyle() {
    document.getElementById('mt-yt-style')?.remove();
  }

  function ensureCaptionsOn() {
    const cc = document.querySelector(CC_BUTTON);
    if (cc && cc.getAttribute('aria-pressed') === 'false') cc.click();
  }

  function applyModeClass() {
    document.body.classList.toggle('mt-yt-only-trans', displayMode === 'trans');
  }

  // ─── Live fallback (used when no transcript was captured) ─────────────
  function currentCaptionText() {
    const segs = document.querySelectorAll(CAPTION_SEGMENT);
    if (!segs.length) return '';
    return Array.from(segs).map((s) => s.textContent).join(' ').replace(/\s+/g, ' ').trim();
  }

  async function liveRefresh() {
    if (displayMode === 'orig') { if (lastShownZh) { removeDualLine(); lastShownZh = ''; } return; }
    const text = currentCaptionText();
    if (!text || text.length < 2) {
      if (lastShownZh) { removeDualLine(); lastShownZh = ''; }
      lastText = '';
      return;
    }
    if (text === lastText) {
      if (lastTranslated && !document.querySelector(`.${DUAL_CLASS}`)) renderDualLine(lastTranslated);
      return;
    }
    lastText = text;
    try {
      const zh = await TranslationAPI.translate(
        text, settings.targetLang || 'zh-CN', settings.provider || 'google',
        settings.apiKey || '', settings.apiBaseUrl || ''
      );
      if (!zh || zh === text || text !== lastText) return;
      lastTranslated = zh; lastShownZh = zh;
      renderDualLine(zh);
    } catch (e) {
      console.warn('[MT] YouTube live translate failed:', e.message);
    }
  }

  // ─── Display loop ─────────────────────────────────────────────────────
  function tick() {
    if (!active) return;
    ensureControlButton();

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastShownZh = ''; lastText = ''; lastTranslated = '';
      removeDualLine();
      ensureCaptionsOn();
    }

    const haveTranscript = sentences.length && transcriptVideoId === currentVideoId();
    if (haveTranscript) {
      if (displayMode === 'orig') { if (lastShownZh) { removeDualLine(); lastShownZh = ''; } return; }
      const v = document.querySelector('video');
      if (!v) return;
      const s = activeSentence(v.currentTime * 1000);
      if (s && s.zh) {
        if (s.zh !== lastShownZh || !document.querySelector(`.${DUAL_CLASS}`)) {
          renderDualLine(s.zh);
          lastShownZh = s.zh;
        }
      } else if (lastShownZh) {
        removeDualLine();
        lastShownZh = '';
      }
    } else {
      liveRefresh();
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
      const tick = document.createElement('span');
      tick.textContent = opts.checked ? '✓' : '';
      tick.style.cssText = 'width:12px;display:inline-block;color:#4caf50;';
      const t = document.createElement('span');
      t.textContent = label;
      t.style.flex = '1';
      r.appendChild(tick); r.appendChild(t);
      if (opts.onClick) r.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
      return r;
    };
    const sep = () => {
      const s = document.createElement('div');
      s.style.cssText = 'height:1px;background:rgba(255,255,255,.12);margin:5px 0;';
      return s;
    };

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
    // close on outside click
    setTimeout(() => {
      const off = (e) => {
        if (!menu.contains(e.target) && e.target.id !== BTN_ID) { closeMenu(); document.removeEventListener('click', off); }
      };
      document.addEventListener('click', off);
    }, 0);
  }

  function setMode(mode) {
    displayMode = mode;
    applyModeClass();
    removeDualLine();
    lastShownZh = '';
    closeMenu();
    tick();
  }

  // ─── .srt export ──────────────────────────────────────────────────────
  function msToSrt(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const z = ms % 1000;
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(z, 3)}`;
  }

  function downloadSrt() {
    if (!sentences.length) { alert('字幕还没准备好,等翻译加载后再试'); return; }
    let srt = '';
    sentences.forEach((s, i) => {
      const body = displayMode === 'orig' ? s.text
        : displayMode === 'trans' ? (s.zh || s.text)
        : s.text + (s.zh ? '\n' + s.zh : ''); // bilingual
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

  function removeControlUI() {
    document.getElementById(BTN_ID)?.remove();
    closeMenu();
  }

  // ─── Public API ───────────────────────────────────────────────────────
  function enable(cfg) {
    settings = cfg;
    active = true;
    injectCaptionStyle();
    applyModeClass();
    ensureCaptionsOn();
    if (sentences.length && transcriptVideoId === currentVideoId()) preTranslate(++preloadGen);
    startLoop();
  }

  function disable() {
    active = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    removeDualLine();
    removeCaptionStyle();
    removeControlUI();
    document.body.classList.remove('mt-yt-only-trans');
    lastShownZh = ''; lastText = ''; lastTranslated = '';
  }

  function init(cfg) {
    settings = cfg;
    if (cfg.enabled) enable(cfg);
  }

  function updateSettings(cfg) {
    const wasActive = active;
    settings = cfg;
    if (wasActive) {
      sentences.forEach((s) => { s.zh = ''; });
      removeDualLine();
      lastShownZh = '';
      if (sentences.length && transcriptVideoId === currentVideoId()) preTranslate(++preloadGen);
    }
  }

  return { init, enable, disable, updateSettings };
})();
