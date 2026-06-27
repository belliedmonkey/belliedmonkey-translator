// content-main.js — Entry point; orchestrates all content scripts

(async () => {
  // Read settings directly from storage (never ask service worker — Safari iOS bug)
  const settings = await new Promise(resolve => {
    chrome.storage.local.get(null, (s) => resolve(s || {}));
  });

  const cfg = {
    enabled: settings.enabled || false,
    targetLang: settings.targetLang || 'zh-CN',
    provider: settings.provider || 'google',
    apiKey: settings.apiKey || '',
    apiBaseUrl: settings.apiBaseUrl || '',
    textColor: settings.textColor || '#0a7a3c',
    fontSize: settings.fontSize || '0.9em',
    showFab: settings.showFab !== false
  };

  const isYouTube = /youtube\.com/.test(location.hostname);

  // ─── Floating action button ────────────────────────────────────────────

  if (cfg.showFab) {
    FloatingButton.create(cfg.enabled, async (enabled) => {
      cfg.enabled = enabled;
      chrome.storage.local.set({ enabled });

      if (isYouTube) {
        if (enabled) YouTubeTranslator.enable(cfg);
        else YouTubeTranslator.disable();
      } else {
        if (enabled) await WebpageTranslator.enable(cfg);
        else WebpageTranslator.disable();
      }
    });
  }

  // ─── Initialize appropriate translator ────────────────────────────────

  if (isYouTube) {
    YouTubeTranslator.init(cfg);
    // Also inject XHR interceptor for YouTube subtitle URL detection
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/content-injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (_) {}
  } else {
    WebpageTranslator.init(cfg);
  }

  // ─── Listen for settings changes from popup ────────────────────────────

  chrome.storage.onChanged.addListener((changes) => {
    let changed = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in cfg) { cfg[key] = newValue; changed = true; }
    }
    if (!changed) return;

    FloatingButton.setEnabled(cfg.enabled);

    if (isYouTube) {
      if (cfg.enabled) YouTubeTranslator.enable(cfg);
      else YouTubeTranslator.disable();
    } else {
      if (cfg.enabled) WebpageTranslator.enable(cfg);
      else WebpageTranslator.disable();
    }
  });

  // ─── Listen for direct messages from popup ─────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'translatePage') {
      cfg.enabled = true;
      chrome.storage.local.set({ enabled: true });
      FloatingButton.setEnabled(true);
      if (isYouTube) YouTubeTranslator.enable(cfg);
      else WebpageTranslator.enable(cfg);
      sendResponse({ ok: true });
    }

    if (msg.action === 'disablePage') {
      cfg.enabled = false;
      chrome.storage.local.set({ enabled: false });
      FloatingButton.setEnabled(false);
      if (isYouTube) YouTubeTranslator.disable();
      else WebpageTranslator.disable();
      sendResponse({ ok: true });
    }

    if (msg.action === 'getPageStatus') {
      sendResponse({ enabled: cfg.enabled, isYouTube });
    }
  });
})();
