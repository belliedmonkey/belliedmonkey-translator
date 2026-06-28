// content-youtube.js — YouTube bilingual subtitles
//
// Strategy: PRELOAD + translate-ahead. yt-hook.js (world:MAIN) captures
// YouTube's own /api/timedtext response and posts the full transcript here. We
// parse it into timed cues, batch-translate them in the background, and display
// the pre-translated line by matching the video's currentTime — so there is no
// per-caption translation lag (a slow LLM like DeepSeek no longer matters; the
// work is done ahead of playback). If no transcript is captured (e.g. captions
// off, or the hook is unavailable), we fall back to live DOM translation.

var YouTubeTranslator = (() => {
  const DUAL_CLASS = 'mt-yt-dual';
  const CAPTION_CONTAINER = '.ytp-caption-window-container';
  const CAPTION_WINDOW = '.caption-window';
  const CAPTION_SEGMENT = '.ytp-caption-segment';
  const CC_BUTTON = '.ytp-subtitles-button';

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastUrl = '';

  // preload state
  let cues = [];                // [{start, end, text, zh}] sorted by start (ms)
  let transcriptVideoId = '';   // which video the cues belong to
  let preloadGen = 0;           // bumped on new transcript / video → cancels stale pre-translation
  let lastShownZh = '';

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
    let parsed;
    try { parsed = parseJson3(body); } catch (_) { return; }
    if (!parsed.length) return;
    cues = parsed;
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
      out.push({ start, end, text, zh: '' });
    }
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i < out.length; i++) {
      if (!out[i].end || out[i].end <= out[i].start) {
        out[i].end = i + 1 < out.length ? out[i + 1].start : out[i].start + 4000;
      }
    }
    return out;
  }

  // Background batch translation, in playback order, filling cue.zh as it goes.
  async function preTranslate(gen) {
    const CHUNK = 20;
    for (let i = 0; i < cues.length; i += CHUNK) {
      if (!active || gen !== preloadGen) return;
      const chunk = cues.slice(i, i + CHUNK).filter((c) => !c.zh);
      if (!chunk.length) continue;
      try {
        const zhs = await TranslationAPI.translateBatch(
          chunk.map((c) => c.text),
          settings.targetLang || 'zh-CN',
          settings.provider || 'google',
          settings.apiKey || '',
          settings.apiBaseUrl || ''
        );
        if (gen !== preloadGen) return;
        chunk.forEach((c, j) => { if (zhs[j] && zhs[j] !== c.text) c.zh = zhs[j]; });
      } catch (e) {
        // keep going — later chunks may still succeed
      }
    }
  }

  function activeCue(tMs) {
    for (let i = cues.length - 1; i >= 0; i--) {
      if (cues[i].start <= tMs) return tMs < cues[i].end ? cues[i] : null;
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

  // YouTube's .caption-window has overflow:hidden + fixed height (rollup clip).
  // Un-clip it and lift it above the control bar so our appended line shows and
  // stays put when the controls toggle.
  function injectCaptionStyle() {
    if (document.getElementById('mt-yt-style')) return;
    const st = document.createElement('style');
    st.id = 'mt-yt-style';
    st.textContent =
      '.caption-window{overflow:visible!important;height:auto!important;max-height:none!important;bottom:11%!important;}' +
      '.ytp-caption-window-container{overflow:visible!important;}';
    (document.head || document.documentElement).appendChild(st);
  }
  function removeCaptionStyle() {
    document.getElementById('mt-yt-style')?.remove();
  }

  function ensureCaptionsOn() {
    const cc = document.querySelector(CC_BUTTON);
    if (cc && cc.getAttribute('aria-pressed') === 'false') cc.click();
  }

  // ─── Live fallback (used when no transcript was captured) ─────────────
  function currentCaptionText() {
    const segs = document.querySelectorAll(CAPTION_SEGMENT);
    if (!segs.length) return '';
    return Array.from(segs).map((s) => s.textContent).join(' ').replace(/\s+/g, ' ').trim();
  }

  async function liveRefresh() {
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
      lastTranslated = zh;
      renderDualLine(zh);
    } catch (e) {
      console.warn('[MT] YouTube live translate failed:', e.message);
    }
  }

  // ─── Display loop ─────────────────────────────────────────────────────
  function tick() {
    if (!active) return;

    // SPA navigation: YouTube swaps the video without a full reload.
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastShownZh = ''; lastText = ''; lastTranslated = '';
      removeDualLine();
      ensureCaptionsOn(); // make the new video fetch its timedtext → hook captures it
    }

    const haveTranscript = cues.length && transcriptVideoId === currentVideoId();
    if (haveTranscript) {
      const v = document.querySelector('video');
      if (!v) return;
      const cue = activeCue(v.currentTime * 1000);
      if (cue && cue.zh) {
        if (cue.zh !== lastShownZh || !document.querySelector(`.${DUAL_CLASS}`)) {
          renderDualLine(cue.zh);
          lastShownZh = cue.zh;
        }
      } else if (lastShownZh) {
        removeDualLine();
        lastShownZh = '';
      }
    } else {
      liveRefresh(); // fallback: translate the live DOM caption
    }
  }

  function startLoop() {
    if (pollTimer) clearInterval(pollTimer);
    lastUrl = location.href;
    pollTimer = setInterval(tick, 250);
  }

  // ─── Public API ───────────────────────────────────────────────────────
  function enable(cfg) {
    settings = cfg;
    active = true;
    injectCaptionStyle();
    ensureCaptionsOn();
    if (cues.length && transcriptVideoId === currentVideoId()) preTranslate(++preloadGen);
    startLoop();
  }

  function disable() {
    active = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    removeDualLine();
    removeCaptionStyle();
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
      // re-translate the transcript with the new engine/lang
      cues.forEach((c) => { c.zh = ''; });
      removeDualLine();
      lastShownZh = '';
      if (cues.length && transcriptVideoId === currentVideoId()) preTranslate(++preloadGen);
    }
  }

  return { init, enable, disable, updateSettings };
})();
