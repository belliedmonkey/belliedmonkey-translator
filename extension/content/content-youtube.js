// content-youtube.js — YouTube dual subtitle overlay

var YouTubeTranslator = (() => {
  const DUAL_CLASS = 'mt-yt-dual';
  // A stable root that lives for the whole player session — survives the
  // pre-roll ad ending and YouTube rebuilding the caption window per cue.
  const PLAYER_ROOT = '#movie_player, .html5-video-player';
  const CAPTION_CONTAINER = '.ytp-caption-window-container'; // full-size wrapper
  const CAPTION_WINDOW = '.caption-window';                  // the actual positioned caption box
  const CAPTION_SEGMENT = '.ytp-caption-segment';

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastText = '';
  let lastTranslated = '';
  let lastUrl = '';

  // ─── Bilingual line ───────────────────────────────────────────────────
  // The translation is appended as a real line INSIDE YouTube's caption box
  // (`.caption-window`), in normal document flow. It sits under the original
  // text and follows it automatically when YouTube moves the captions (mouse
  // over → controls show) or the window resizes — no coordinate math, so it
  // never jitters.

  function currentCaptionText() {
    const segs = document.querySelectorAll(CAPTION_SEGMENT);
    if (!segs.length) return '';
    return Array.from(segs)
      .map(s => s.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function renderDualLine(translated) {
    const win = document.querySelector(CAPTION_WINDOW) ||
                document.querySelector(CAPTION_CONTAINER);
    if (!win) return;
    // Drop any dual line stranded outside the current caption box.
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach(el => {
      if (el.parentElement !== win) el.remove();
    });
    let line = Array.from(win.children).find(
      c => c.classList && c.classList.contains(DUAL_CLASS)
    );
    if (!line) {
      line = document.createElement('div');
      line.className = DUAL_CLASS;
      win.appendChild(line); // after the original text → renders on the line below
    }
    const seg = document.querySelector(CAPTION_SEGMENT);
    line.style.cssText = `
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      color: ${settings.ytTextColor || '#ffffff'};
      font-size: ${seg ? getComputedStyle(seg).fontSize : '1em'};
      line-height: 1.3;
      margin-top: 2px;
      background: rgba(8, 8, 8, 0.75);
      padding: 1px 6px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.85);
      white-space: pre-wrap;
      pointer-events: none;
    `;
    line.textContent = translated;
  }

  function removeDualLine() {
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach(el => el.remove());
  }

  async function refreshCaption() {
    if (!active) return;
    const text = currentCaptionText();
    if (!text || text.length < 2) { removeDualLine(); lastText = ''; return; }

    // Same caption as before: only re-assert if YouTube wiped our line
    // (avoid redundant writes every poll tick).
    if (text === lastText) {
      if (lastTranslated && !document.querySelector(`.${DUAL_CLASS}`)) renderDualLine(lastTranslated);
      return;
    }

    lastText = text;
    try {
      const translated = await TranslationAPI.translate(
        text,
        settings.targetLang || 'zh-CN',
        settings.provider || 'google',
        settings.apiKey || '',
        settings.apiBaseUrl || ''
      );
      if (!translated || translated === text) return;
      // Don't drop just because the live caption changed: rollup captions
      // (YouTube mobile, ytp-rollup-mode) change every frame, which would
      // discard every translation. Only skip if a NEWER caption was already
      // requested while we were translating (out-of-order completion).
      if (text !== lastText) return;
      lastTranslated = translated;
      renderDualLine(translated);
    } catch (e) {
      console.warn('[MT] YouTube subtitle translate failed:', e.message);
    }
  }

  // ─── Caption watching (robust to ads / late mount / player rebuild) ───

  function scanCaptions() {
    if (!active) return;
    // SPA navigation (YouTube swaps the video without a full reload): reset.
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastText = '';
      lastTranslated = '';
      removeDualLine();
    }
    refreshCaption();
  }

  function startCaptionWatch() {
    // Poll-only. Streaming captions are best handled by polling. A
    // MutationObserver on the player subtree caused a feedback loop — our own
    // renderDualLine writes re-triggered it — which froze heavy YouTube pages
    // (and produced no output). Polling every 500ms is responsive and safe.
    if (pollTimer) clearInterval(pollTimer);
    lastUrl = location.href;
    pollTimer = setInterval(scanCaptions, 500);
  }

  // ─── Handle YouTube SPA navigation ────────────────────────────────────

  // ─── Remove dual subtitles ────────────────────────────────────────────

  function removeDualSubtitles() {
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach(el => el.remove());
    lastTranslated = '';
  }

  // ─── Public API ───────────────────────────────────────────────────────

  function init(cfg) {
    settings = cfg;
    if (cfg.enabled) enable(cfg);
  }

  // YouTube's .caption-window has overflow:hidden and a fixed height (it clips
  // to the visible caption lines for the rollup animation). Our translation line
  // is appended inside it, so without this it gets clipped and never shows.
  function injectCaptionStyle() {
    if (document.getElementById('mt-yt-style')) return;
    const st = document.createElement('style');
    st.id = 'mt-yt-style';
    st.textContent = '.caption-window, .ytp-caption-window-container { overflow: visible !important; }';
    (document.head || document.documentElement).appendChild(st);
  }

  function enable(cfg) {
    settings = cfg;
    active = true;
    injectCaptionStyle();
    startCaptionWatch();
  }

  function disable() {
    active = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    removeDualSubtitles();
    lastText = '';
    lastTranslated = '';
  }

  function updateSettings(cfg) {
    settings = cfg;
    if (active) {
      removeDualSubtitles();
      startCaptionWatch();
    }
  }

  return { init, enable, disable, updateSettings };
})();
