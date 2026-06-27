// content-youtube.js — YouTube dual subtitle overlay

var YouTubeTranslator = (() => {
  const DUAL_CLASS = 'mt-yt-dual';
  const CAPTION_CONTAINER = '.ytp-caption-window-container';
  const CAPTION_SEGMENT = '.ytp-caption-segment';

  let settings = {};
  let active = false;
  let captionObserver = null;
  let bodyObserver = null;
  let lastText = '';

  // ─── Inject dual subtitle under caption segment ────────────────────────

  async function processCaption(segEl) {
    // Collect original text (exclude our own injected spans)
    const original = Array.from(segEl.childNodes)
      .filter(n => !(n instanceof Element && n.classList.contains(DUAL_CLASS)))
      .map(n => n.textContent)
      .join('')
      .trim();

    if (!original || original.length < 2 || original === lastText) return;
    if (segEl.querySelector(`.${DUAL_CLASS}`)) {
      // Already has dual — check if original changed
      const existingDual = segEl.querySelector(`.${DUAL_CLASS}`);
      if (existingDual.dataset.src === original) return;
      existingDual.remove();
    }

    lastText = original;

    try {
      const translated = await TranslationAPI.translate(
        original,
        settings.targetLang || 'zh-CN',
        settings.provider || 'google',
        settings.apiKey || '',
        settings.apiBaseUrl || ''
      );

      if (!translated || translated === original) return;

      const span = document.createElement('span');
      span.className = DUAL_CLASS;
      span.dataset.src = original;
      span.textContent = translated;
      span.style.cssText = `
        display: block !important;
        color: ${settings.textColor || '#ffd54f'};
        font-size: ${settings.fontSize || '0.95em'};
        margin-top: 3px;
        text-shadow: 1px 1px 3px rgba(0,0,0,0.9), -1px -1px 3px rgba(0,0,0,0.9);
        line-height: 1.4;
        font-weight: normal;
      `;
      segEl.appendChild(span);
    } catch (e) {
      console.warn('[MT] YouTube subtitle translate failed:', e.message);
    }
  }

  // ─── Observe caption container ────────────────────────────────────────

  function observeCaptionContainer(container) {
    if (captionObserver) captionObserver.disconnect();

    captionObserver = new MutationObserver(() => {
      if (!active) return;
      const segs = container.querySelectorAll(CAPTION_SEGMENT);
      segs.forEach(processCaption);
    });

    captionObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Process any existing captions immediately
    container.querySelectorAll(CAPTION_SEGMENT).forEach(processCaption);
  }

  // ─── Wait for YouTube player to mount ─────────────────────────────────

  function waitForCaptionContainer() {
    const existing = document.querySelector(CAPTION_CONTAINER);
    if (existing) { observeCaptionContainer(existing); return; }

    if (bodyObserver) bodyObserver.disconnect();
    bodyObserver = new MutationObserver(() => {
      const container = document.querySelector(CAPTION_CONTAINER);
      if (container) {
        bodyObserver.disconnect();
        bodyObserver = null;
        observeCaptionContainer(container);
      }
    });
    bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ─── Handle YouTube SPA navigation ────────────────────────────────────

  function watchNavigation() {
    // YouTube dispatches 'yt-navigate-finish' on SPA page changes
    document.addEventListener('yt-navigate-finish', () => {
      if (!active) return;
      lastText = '';
      // Small delay to let YouTube rebuild DOM
      setTimeout(waitForCaptionContainer, 1000);
    });

    // Fallback: watch URL changes
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (!active) return;
        lastText = '';
        setTimeout(waitForCaptionContainer, 1000);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  // ─── Remove dual subtitles ────────────────────────────────────────────

  function removeDualSubtitles() {
    document.querySelectorAll(`.${DUAL_CLASS}`).forEach(el => el.remove());
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
    waitForCaptionContainer();
  }

  function disable() {
    active = false;
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    removeDualSubtitles();
    lastText = '';
  }

  function updateSettings(cfg) {
    settings = cfg;
    if (active) {
      removeDualSubtitles();
      waitForCaptionContainer();
    }
  }

  return { init, enable, disable, updateSettings };
})();
