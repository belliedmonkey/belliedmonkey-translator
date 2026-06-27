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
  let captionObserver = null;
  let captionRoot = null;
  let bodyObserver = null;
  let pollTimer = null;
  let lastText = '';
  let lastTranslated = '';

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

    // Same caption as before: just make sure our line is still present
    // (YouTube may have rebuilt the caption box and wiped it).
    if (text === lastText) { if (lastTranslated) renderDualLine(lastTranslated); return; }

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
      // Caption may have advanced while we were translating — drop stale result.
      if (currentCaptionText() !== text) return;
      lastTranslated = translated;
      renderDualLine(translated);
    } catch (e) {
      console.warn('[MT] YouTube subtitle translate failed:', e.message);
    }
  }

  // ─── Caption watching (robust to ads / late mount / player rebuild) ───

  function scanCaptions() {
    if (!active) return;
    refreshCaption();
  }

  // Attach the caption observer to the (stable) player root. Cheap no-op when
  // already attached to the same root.
  function attachCaptionObserver() {
    const root = document.querySelector(PLAYER_ROOT) || document.body;
    if (captionObserver && captionRoot === root) { scanCaptions(); return; }
    if (captionObserver) captionObserver.disconnect();
    captionRoot = root;
    captionObserver = new MutationObserver(() => { if (active) scanCaptions(); });
    captionObserver.observe(root, { childList: true, subtree: true, characterData: true });
    scanCaptions();
  }

  function startCaptionWatch() {
    attachCaptionObserver();

    // The player may mount late (pre-roll ad / slow load) or get swapped out.
    // Keep watching the document and re-attach whenever the player root changes.
    if (bodyObserver) bodyObserver.disconnect();
    bodyObserver = new MutationObserver(() => {
      if (!active) return;
      const root = document.querySelector(PLAYER_ROOT);
      if (root && root !== captionRoot) attachCaptionObserver();
    });
    bodyObserver.observe(document.documentElement, { childList: true, subtree: true });

    // Polling fallback: catches captions that appeared before the observer
    // attached, and any mutations the observer misses.
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(scanCaptions, 1000);
  }

  // ─── Handle YouTube SPA navigation ────────────────────────────────────

  function watchNavigation() {
    // YouTube dispatches 'yt-navigate-finish' on SPA page changes
    document.addEventListener('yt-navigate-finish', () => {
      if (!active) return;
      lastText = '';
      // Small delay to let YouTube rebuild DOM
      setTimeout(startCaptionWatch, 1000);
    });

    // Fallback: watch URL changes
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (!active) return;
        lastText = '';
        setTimeout(startCaptionWatch, 1000);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  // ─── Remove dual subtitles ────────────────────────────────────────────

  function removeDualSubtitles() {
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach(el => el.remove());
    lastTranslated = '';
  }

  // ─── Public API ───────────────────────────────────────────────────────

  function init(cfg) {
    settings = cfg;
    watchNavigation();
    if (cfg.enabled) enable(cfg);
  }

  function enable(cfg) {
    settings = cfg;
    active = true;
    startCaptionWatch();
  }

  function disable() {
    active = false;
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    captionRoot = null;
    removeDualSubtitles();
    lastText = '';
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
