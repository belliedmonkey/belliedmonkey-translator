// content-main.js — Entry point; orchestrates all content scripts

(async () => {
  // Re-entry guard: Safari can inject the content scripts into the same frame
  // more than once. Without this, two translator instances race and every
  // paragraph gets translated (and appended) twice. Bail on the second run.
  if (window.__mtMainLoaded) return;
  window.__mtMainLoaded = true;

  // Read settings directly from storage (never ask service worker — Safari iOS bug).
  // EXPLICIT KEYS, never get(null): the same bucket also holds the unbounded `tr:`
  // translation cache and the `lq:` learning outbox, and pulling the whole bucket on
  // every page load would drag both along. (docs/learning-design.md §7.)
  const SETTINGS_KEYS = [
    'enabled', 'targetLang', 'uiLang', 'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    'textColor', 'ytTextColor', 'fontSize', 'showFab',
    'learnEnabled', 'learnDailyNew', 'learnRules',
  ];
  // 走 RequestShape.storageGet：它带截止时间。一个不落地的存储回调会把整个内容脚本
  // 钉在这一行 —— 页面上什么都不会发生，也没有任何报错可查（2026-08-29 真机实测的
  // 「翻译中…」永不结束就是同一族）。超时 = 空设置 = 和原来的 `s || {}` 同一个方向。
  const settings = await RequestShape.storageGet(SETTINGS_KEYS, {});

  // 存着的引擎 id 本次构建不认识 ⇒ **就地改正存储**，不只是运行时兜一下。
  //
  // 只兜运行时会留下一个更坏的状态：设置页的 <select> 里没有那一项，浏览器强制显示
  // 成第一项，而存储原样不动 —— 界面写着 A、实际用的是 B，两边永远对不上。
  // 2026-08-22 真机就是这个形状（中国版存着 'google'，设置页显示 DeepSeek）。
  // 也是升级路径的自愈：从默认还是 'google' 的旧版升上来的用户，第一次开页面就被改正。
  if (settings.provider !== undefined) {
    const fixed = TranslationAPI.resolveProvider(settings.provider);
    if (fixed !== settings.provider) {
      settings.provider = fixed;
      try { chrome.storage.local.set({ provider: fixed }); } catch (_) {}
    }
  }

  const cfg = {
    // Always start OFF on page load. Translation begins only after the user
    // turns it on (FAB for page text, in-player 译 button for video subtitles).
    enabled: false,
    targetLang: settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
    // 默认引擎来自注册表，不再硬写（见 translation-api.js 的 defaultProvider）。
    provider: TranslationAPI.resolveProvider(settings.provider),
    apiKey: settings.apiKey || '',
    apiBaseUrl: settings.apiBaseUrl || '',
    apiModel: settings.apiModel || '',
    textColor: settings.textColor || window.MT_PALETTE.textColor,
    ytTextColor: settings.ytTextColor || window.MT_PALETTE.ytTextColor,
    fontSize: settings.fontSize || '1.0',
    showFab: settings.showFab !== false,
    ytSubEnabled: false, // video subtitles also start off until the 译 button is turned on
    // Learning layer. OFF until the user turns it on once — capture never starts by
    // itself on upgrade (interaction-spec 「复习 / Review」 → Capture).
    learnEnabled: settings.learnEnabled === true,
    // User-authored governance (learning-design §4.1/§8.9): source blocklist +
    // learning-language whitelist. Missing/unreadable ⇒ null ⇒ no filtering
    // (fail-open, §7.4.5 — a genuinely broken read also loses learnEnabled, which
    // fails capture closed anyway).
    learnRules: settings.learnRules || null,
  };

  // ─── 自家官网：留一个可被页面读到的标记 ─────────────────────────────────
  // iOS 上 App **查不到扩展有没有启用**（getStateOfSafariExtension 是 macOS-only），
  // 所以「我到底设置成功了没」这个问题，在 iOS 上唯一能回答的地方就是一个被扩展
  // 注入过的网页。官网的启用教程页据此亮绿灯。
  //
  // ⚠️ 只在自家域名注入。在 <all_urls> 上都设的话，等于让**任何网站**都能探测出
  // 用户装了这个扩展 —— 对一个把「不追踪」写进 README 的产品，那是自己给自己
  // 造了一个指纹面。这个判断是安全边界，不是优化。
  const MT_SITES = /^(www\.)?belliedmonkey\.(cc|com)$/;
  if (MT_SITES.test(location.hostname)) {
    try {
      const el = document.documentElement;
      el.dataset.mtExtension = (chrome.runtime.getManifest() || {}).version || '1';
      // 属性可能在页面自己的水合里被抹掉，事件让页面无论何时监听都收得到。
      document.dispatchEvent(new CustomEvent('mt-extension-ready', {
        detail: { version: el.dataset.mtExtension },
      }));
    } catch (_) { /* 探测标记失败绝不能影响翻译本身 */ }
  }

  const isYouTube = /(youtube\.com|youtube-nocookie\.com)/.test(location.hostname);
  // x.com / twitter.com: a SITE adapter (DOM/text dimension) that marks
  // non-content chrome as data-mt-skip-region so the generic webpage path doesn't
  // clutter the feed with sidebar/nav/footer translations. Tweet text itself still
  // flows through the normal WebpageTranslator path — no special text routing.
  const isTwitter = /(^|\.)(x\.com|twitter\.com)$/.test(location.hostname);
  // Mobile YouTube (m.youtube.com) has no player control bar for the in-player 译
  // button, so the FAB drives BOTH subtitles and page text there.
  // Mobile = m.youtube.com OR any touch device (incl. a phone/iPad on the desktop-layout
  // www.youtube.com). On mobile the FAB drives BOTH page text and video subtitles, and
  // content-youtube suppresses its in-player 译 button — one button, no collision.
  const isMobileYouTube = isYouTube && (/m\.youtube\.com/.test(location.hostname) || TranslationCore.isMobileLayout());
  // Twitter/X in-tweet video subtitles: desktop shows content-twitter's own 译 floating
  // button; on a touch device the page FAB drives it (mirrors isMobileYouTube). Same
  // single TranslationCore.isMobileLayout() signal so the two never disagree.
  const isMobileTwitter = isTwitter && TranslationCore.isMobileLayout();
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
  // Gate symmetry with the feature itself (hasMedia/mediaEl support audio AND
  // video): an <audio> always engages; a VIDEO-only page (Substack video posts —
  // no <audio> companion) engages only when a timed-transcript source is
  // discoverable, so decorative/hero videos never surface subtitle UI or a
  // 字幕不可用 notice.
  const drivesPodcast = () => !isYouTube && !isTextOnlyPodcast && (
    isPodcastHost || !!document.querySelector('audio')
    || (!!document.querySelector('video') && PodcastTranslator.hasTranscriptHint()));

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
      if (isMobileTwitter) {
        if (enabled) TwitterTranslator.enable(cfg);
        else TwitterTranslator.disable();
      }
    });
  }

  // ─── Learning layer (记忆层) ───────────────────────────────────────────
  // A SINK hanging off the renderer: it reads what is already displayed and can
  // never influence anything upstream (domain-design §9.1). Everything below is
  // wrapped so that a broken learning layer degrades to "no capture", never to
  // degraded translation.
  function syncCollector() {
    try {
      // The blocklist gates whether the sink RUNS AT ALL for this page — user
      // governance, not shipped site knowledge (domain-design §9.1 law 3 carve-out).
      // It never touches the translation path. The popup's 本站 section is the
      // law-2 visibility surface for a page blocked here.
      const blocked = typeof LearnRules !== 'undefined'
        && LearnRules.isBlocked(location.href, cfg.learnRules);
      if (cfg.learnEnabled && !blocked) {
        LearnCollector.enable({
          targetLang: cfg.targetLang,
          // The detector is INJECTED here, never probed for inside the collector
          // (domain-design §5.3.2). Absent on every Safari → items are stored with
          // lang 'und' rather than dropped.
          detect: (typeof LangDetect !== 'undefined' && LangDetect.available())
            ? LangDetect.detect : null,
          // Whitelist inputs for the flush gate (learning-design §4.1). The
          // registry is generated (langs.gen.js) and injected like the detector.
          rules: cfg.learnRules,
          langRegistry: (typeof window !== 'undefined' && window.MT_LANGS) || null,
        });
      } else {
        // A site blocked MID-SESSION (rule added from the popup) must not flush
        // its backlog on the way out — the user just said "not from here".
        LearnCollector.disable(blocked ? { discard: true } : undefined);
      }
    } catch (_) {}
  }
  syncCollector();

  // Webpage text everywhere (YouTube too — title / description / comments)
  WebpageTranslator.init(cfg);

  // x.com chrome marking (runs regardless of translation on/off; idempotent with
  // the module's own self-start). Keeps sidebar/nav/footer out of the webpage path.
  if (isTwitter) TwitterSite.init();

  // Twitter/X in-tweet video subtitles: independent, controlled by content-twitter's
  // own 译 button on desktop (mobile: the FAB above drives it). Dormant until enabled.
  if (isTwitter) TwitterTranslator.init(cfg);

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
      if (isMobileTwitter) { if (cfg.enabled) TwitterTranslator.enable(cfg); else TwitterTranslator.disable(); }
    } else if ('learnEnabled' in changes || 'learnDailyNew' in changes || 'learnRules' in changes) {
      // A learning-settings change must NOT re-translate the page: capture is a
      // sink, so toggling it has no bearing on what is displayed.
      syncCollector();
    } else {
      // provider / language / color change → re-translate what's active
      WebpageTranslator.updateSettings(cfg);
      try { LearnCollector.updateSettings({ targetLang: cfg.targetLang }); } catch (_) {}
      if (isYouTube) YouTubeTranslator.updateSettings(cfg);
      if (!isYouTube) PodcastTranslator.updateSettings(cfg);
      if (isTwitter) TwitterTranslator.updateSettings(cfg);
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
      if (isMobileTwitter) TwitterTranslator.enable(cfg);
      sendResponse({ ok: true });
    }

    if (msg.action === 'disablePage') {
      cfg.enabled = false;
      chrome.storage.local.set({ enabled: false });
      FloatingButton.setEnabled(false);
      WebpageTranslator.disable();
      if (isMobileYouTube) YouTubeTranslator.disable();
      if (drivesPodcast()) PodcastTranslator.disable();
      if (isMobileTwitter) TwitterTranslator.disable();
      sendResponse({ ok: true });
    }

    if (msg.action === 'getPageStatus') {
      // `url` feeds the popup's 本站 section. From here rather than chrome.tabs
      // so the popup shows the SAME url the capture gate judged — and it works
      // identically on Safari, where tabs.query quirks are not worth relying on.
      sendResponse({ enabled: cfg.enabled, isYouTube, url: location.href });
    }
  });
})();
