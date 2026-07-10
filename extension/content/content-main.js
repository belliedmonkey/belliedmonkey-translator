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
    targetLang: settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
    provider: settings.provider || 'google',
    apiKey: settings.apiKey || '',
    apiBaseUrl: settings.apiBaseUrl || '',
    apiModel: settings.apiModel || '',
    textColor: settings.textColor || '#0a7a3c',
    ytTextColor: settings.ytTextColor || '#ffffff',
    fontSize: settings.fontSize || '1.0',
    showFab: settings.showFab !== false,
    ytSubEnabled: false // video subtitles also start off until the 译 button is turned on
  };

  const isYouTube = /(youtube\.com|youtube-nocookie\.com)/.test(location.hostname);
  // Mobile YouTube (m.youtube.com) has no player control bar for the in-player 译
  // button, so the FAB drives BOTH subtitles and page text there.
  // Mobile = m.youtube.com OR any touch device (incl. a phone/iPad on the desktop-layout
  // www.youtube.com). On mobile the FAB drives BOTH page text and video subtitles, and
  // content-youtube suppresses its in-player 译 button — one button, no collision.
  const isMobileYouTube = isYouTube && (/m\.youtube\.com/.test(location.hostname) || TranslationCore.isMobileLayout());
  // Embedded player on another site (youtube.com/embed or youtube-nocookie.com/embed
  // inside an iframe): translate ONLY the video subtitles — no FAB, no page text.
  const isEmbed = window.top !== window.self;

  // Podcast hosts (audio subtitles). Generic audio pages are handled too — the FAB
  // drives PodcastTranslator whenever the page has a media element (it stays fully
  // dormant otherwise). Never on YouTube (that has its own subtitle path).
  const isPodcastHost = /(open\.spotify\.com|podcasts\.apple\.com|xiaoyuzhoufm\.com)/.test(location.hostname);
  // Hosts with NO obtainable timed transcript at all → TEXT-ONLY: the FAB translates
  // the page text, and we do NOT drive the subtitle overlay (so no intrusive 字幕不可用
  // bar). Apple Podcasts web / 小宇宙 expose no timed transcript. (Spotify is NOT here —
  // its synced "Read along" transcript is scraped by PodcastTranslator.resolveSpotifyDom.)
  const isTextOnlyPodcast = /(podcasts\.apple\.com|xiaoyuzhoufm\.com)/.test(location.hostname);
  const drivesPodcast = () => !isYouTube && !isTextOnlyPodcast && (isPodcastHost || !!document.querySelector('audio'));

  if (isEmbed) {
    if (isYouTube) YouTubeTranslator.init(cfg);
    return;
  }

  // ─── Controls ──────────────────────────────────────────────────────────
  // Desktop: FAB → page text; in-player 译 button → video subtitles (separate).
  // Mobile YouTube: FAB → both (no in-player button).

  if (cfg.showFab) {
    FloatingButton.create(cfg.enabled, async (enabled) => {
      cfg.enabled = enabled;
      chrome.storage.local.set({ enabled });
      if (enabled) await WebpageTranslator.enable(cfg);
      else WebpageTranslator.disable();
      if (isMobileYouTube) {
        if (enabled) YouTubeTranslator.enable(cfg);
        else YouTubeTranslator.disable();
      }
      if (drivesPodcast()) {
        if (enabled) PodcastTranslator.enable(cfg);
        else PodcastTranslator.disable();
      }
    });
  }

  // Webpage text everywhere (YouTube too — title / description / comments)
  WebpageTranslator.init(cfg);

  // YouTube video subtitles: independent, controlled by the in-player 译 button.
  // The /api/timedtext interceptor lives in content/yt-hook.js (world:"MAIN").
  if (isYouTube) YouTubeTranslator.init(cfg);

  // Podcast audio subtitles (non-YouTube): dormant until the FAB turns it on and
  // the page has a media element + a timed transcript.
  if (!isYouTube) PodcastTranslator.init(cfg);

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
      if (drivesPodcast()) { if (cfg.enabled) PodcastTranslator.enable(cfg); else PodcastTranslator.disable(); }
    } else {
      // provider / language / color change → re-translate what's active
      WebpageTranslator.updateSettings(cfg);
      if (isYouTube) YouTubeTranslator.updateSettings(cfg);
      if (!isYouTube) PodcastTranslator.updateSettings(cfg);
    }
  });

  // ─── Listen for direct messages from popup ─────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'translatePage') {
      cfg.enabled = true;
      chrome.storage.local.set({ enabled: true });
      FloatingButton.setEnabled(true);
      WebpageTranslator.enable(cfg);
      if (isMobileYouTube) YouTubeTranslator.enable(cfg);
      if (drivesPodcast()) PodcastTranslator.enable(cfg);
      sendResponse({ ok: true });
    }

    if (msg.action === 'disablePage') {
      cfg.enabled = false;
      chrome.storage.local.set({ enabled: false });
      FloatingButton.setEnabled(false);
      WebpageTranslator.disable();
      if (isMobileYouTube) YouTubeTranslator.disable();
      if (drivesPodcast()) PodcastTranslator.disable();
      sendResponse({ ok: true });
    }

    if (msg.action === 'getPageStatus') {
      sendResponse({ enabled: cfg.enabled, isYouTube });
    }
  });
})();
