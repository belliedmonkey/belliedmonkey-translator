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
  let overlay = null;

  // ─── Bilingual overlay ────────────────────────────────────────────────
  // The translation lives in our OWN element, not inside YouTube's
  // `.ytp-caption-segment` — YouTube re-renders that node every frame and
  // would wipe anything we append into it.

  function currentCaptionText() {
    const segs = document.querySelectorAll(CAPTION_SEGMENT);
    if (!segs.length) return '';
    return Array.from(segs)
      .map(s => s.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    const player = document.querySelector('#movie_player') || document.body;
    overlay = document.createElement('div');
    overlay.className = DUAL_CLASS;
    overlay.style.cssText = `
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      bottom: 12%;
      max-width: 92%;
      width: max-content;
      text-align: center;
      z-index: 60;
      pointer-events: none;
      color: ${settings.ytTextColor || '#ffffff'};
      background: rgba(8, 8, 8, 0.75);
      padding: 1px 8px;
      border-radius: 2px;
      line-height: 1.3;
      font-weight: 400;
      white-space: pre-wrap;
      display: none;
    `;
    player.appendChild(overlay);
    return overlay;
  }

  function positionOverlay(el) {
    // Anchor to the REAL caption box (`.caption-window`), not the full-size
    // `.ytp-caption-window-container` wrapper — the wrapper spans the whole
    // player, which previously pushed the translation to the very top.
    const player = document.querySelector('#movie_player');
    const win = document.querySelector(CAPTION_WINDOW) ||
                document.querySelector(CAPTION_CONTAINER);
    const seg = document.querySelector(CAPTION_SEGMENT);
    const anchor = win || seg;
    if (player && anchor) {
      const ar = anchor.getBoundingClientRect();
      const pr = player.getBoundingClientRect();
      if (ar.width && pr.height) {
        // Match the original caption's font size.
        if (seg) {
          const fs = getComputedStyle(seg).fontSize;
          if (fs) el.style.fontSize = fs;
        }
        // Directly below the original line, horizontally centered on it.
        el.style.top = (ar.bottom - pr.top + 2) + 'px';
        el.style.left = (ar.left - pr.left + ar.width / 2) + 'px';
        el.style.transform = 'translateX(-50%)';
        el.style.bottom = 'auto';
        return;
      }
    }
    el.style.top = 'auto';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.bottom = '12%';
  }

  function hideOverlay() {
    if (overlay) { overlay.style.display = 'none'; overlay.textContent = ''; }
  }

  async function refreshCaption() {
    if (!active) return;
    const text = currentCaptionText();
    if (!text || text.length < 2) { hideOverlay(); lastText = ''; return; }
    if (text === lastText) return; // unchanged caption line

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
      const el = ensureOverlay();
      el.textContent = translated;
      el.style.display = 'block';
      positionOverlay(el);
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
    overlay = null;
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
