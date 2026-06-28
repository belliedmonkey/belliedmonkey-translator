// content-main.js — Entry point; orchestrates all content scripts

(async () => {
  // Re-entry guard: Safari can inject the content scripts into the same frame
  // more than once. Without this, two translator instances race and every
  // paragraph gets translated (and appended) twice. Bail on the second run.
  if (window.__mtMainLoaded) return;
  window.__mtMainLoaded = true;

  // Read settings directly from storage (never ask service worker — Safari iOS bug)
  const settings = await new Promise(resolve => {
    chrome.storage.local.get(null, (s) => resolve(s || {}));
  });

  const cfg = {
    // Always start OFF on page load. Translation begins only after the user
    // turns it on (FAB for page text, in-player 译 button for video subtitles).
    enabled: false,
    targetLang: settings.targetLang || 'zh-CN',
    provider: settings.provider || 'google',
    apiKey: settings.apiKey || '',
    apiBaseUrl: settings.apiBaseUrl || '',
    textColor: settings.textColor || '#0a7a3c',
    ytTextColor: settings.ytTextColor || '#ffffff',
    fontSize: settings.fontSize || '0.9em',
    showFab: settings.showFab !== false,
    ytSubEnabled: false // video subtitles also start off until the 译 button is turned on
  };

  const isYouTube = /youtube\.com/.test(location.hostname);

  // ─── Two independent controls ──────────────────────────────────────────
  // FAB → webpage text translation (on every site, incl. YouTube title /
  //       description / comments).
  // In-player 译 button (YouTubeTranslator) → video subtitles, self-controlled.

  if (cfg.showFab) {
    FloatingButton.create(cfg.enabled, async (enabled) => {
      cfg.enabled = enabled;
      chrome.storage.local.set({ enabled });
      if (enabled) await WebpageTranslator.enable(cfg);
      else WebpageTranslator.disable();
    });
  }

  // Webpage text everywhere (YouTube too — title / description / comments)
  WebpageTranslator.init(cfg);

  // YouTube video subtitles: independent, controlled by the in-player 译 button.
  // The /api/timedtext interceptor lives in content/yt-hook.js (world:"MAIN").
  if (isYouTube) YouTubeTranslator.init(cfg);

  // ─── Listen for settings changes from popup ────────────────────────────

  chrome.storage.onChanged.addListener((changes) => {
    let changed = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in cfg) { cfg[key] = newValue; changed = true; }
    }
    if (!changed) return;

    FloatingButton.setEnabled(cfg.enabled);

    if ('enabled' in changes) {
      if (cfg.enabled) WebpageTranslator.enable(cfg);
      else WebpageTranslator.disable();
    } else {
      // provider / language / color change → re-translate what's active
      WebpageTranslator.updateSettings(cfg);
      if (isYouTube) YouTubeTranslator.updateSettings(cfg);
    }
  });

  // ─── Listen for direct messages from popup ─────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'translatePage') {
      cfg.enabled = true;
      chrome.storage.local.set({ enabled: true });
      FloatingButton.setEnabled(true);
      WebpageTranslator.enable(cfg);
      sendResponse({ ok: true });
    }

    if (msg.action === 'disablePage') {
      cfg.enabled = false;
      chrome.storage.local.set({ enabled: false });
      FloatingButton.setEnabled(false);
      WebpageTranslator.disable();
      sendResponse({ ok: true });
    }

    if (msg.action === 'getPageStatus') {
      sendResponse({ enabled: cfg.enabled, isYouTube });
    }
  });
})();
