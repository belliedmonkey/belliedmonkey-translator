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
    'enabled', 'targetLang', 'uiLang', 'provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'engineChosen',
    'textColor', 'ytTextColor', 'fontSize', 'showFab',
    'learnEnabled', 'learnDailyNew', 'learnRules',
    // 跨面交接用的**不透明 id**（learning-design §8.4.1.1，2026-09-02 用户裁定）。
    // ⚠️ 这里加进来的是 `learnUserId`，**不是** `learnAuth` —— 后者装着 access /
    // refresh token，永不进任何一份键列表。两边比一下 id 相不相等，是发现「扩展登 A、
    // App 登 B」的唯一办法，而在这之前没有任何一侧发现得了。
    'learnUserId',
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
    // 「用户主动点选过引擎」——出厂默认不算。悬浮球的判据要读它，见 engine-state.js。
    engineChosen: !!settings.engineChosen,
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
    // 空串与 undefined 都表示「扩展这边没登录」。交接链接据此决定带不带 uid ——
    // **不带**和**带空串**必须能分开：前者是「没登录」，后者会让 App 以为
    // 「登录了但 id 读不出来」。
    learnUserId: String(settings.learnUserId || '').trim(),
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

    // ── 试翻页上的「下一步：登录并同步到 App」──────────────────────────────
    //
    // 页面只发一个**空容器**（scripts/gen-try-pages.js 生成的 #mt-next-review），
    // 文案与按钮全由这里填。三个理由：
    //   1. 文案跟随用户在**扩展里**选的界面语言（11 份），不是站点的 8 份；
    //   2. 没装扩展时它不可能出现 —— 空容器里什么都没有；
    //   3. 它要读 learnEnabled 才能说对话，而那是扩展这边的状态。
    //
    // ⚠️ **不读、也不许读 learnAuth**（learning-design §8.4.1：内容脚本只读显式键
    // 列表，learnAuth 永不加入任何一份）。所以这个块**不知道用户登没登录**，它也不
    // 假装知道 —— 它把人送到复习页，登录状态由那一页自己讲。
    //
    // 为什么主行动是复习页而不是设置页：复习页**打开就是一次强制同步**
    // （review.js 的 ENTRY），一步同时完成「看到你的卡」和「把它们推上去」。
    // 而在这之前，全仓只有复习页和设置页两个入口级触发点 —— 只翻译、不开那两页的人，
    // 服务器上永远是空的，App 里就永远没卡。
    //
    // 同步没编进这个构建时**整块不出现**。这一块说的是「登录之后卡片才到 App」，
    // 而中国版扩展的登录入口是被整节 remove 掉的（options.js 的 !MT_BACKEND.enabled
    // 分支）—— 对那个构建，这句话是死路。判据按**值**不按 flavor 名：
    // window.MT_SYNC_ENABLED 由 build.js 从 backend.config.js 的 enabled 读出来发进
    // providers.gen.js（内容脚本不加载 backend.config.js —— 那个文件带着后端地址与
    // anon key，而内容脚本注入到每一个页面）。
    try {
      if (window.MT_SYNC_ENABLED) paintSiteHandoff(cfg.learnEnabled);
    } catch (_) {}
    try { upgradeSetupNext(); } catch (_) {}
  }

  // 官网启用页的「下一步：配一个翻译引擎」。
  //
  // 站点上那个按钮链的是 /guide.html —— 一篇讲怎么配的**文章**。可对一个已经装好、
  // 站在这一页的人，正确的下一步不是再读一篇文章，是**直接进配置**。
  // 站点自己链不过去（网页写不出 chrome-extension:// 的地址），而这一块本来就只在
  // 检测到扩展时才显示，所以装了扩展的人一定有内容脚本在场，接管永远成立。
  //
  // 没装扩展的人看到的仍然是原来那篇指南 —— 对他那是对的，他还没有配置页可进。
  function upgradeSetupNext() {
    const box = document.getElementById('mt-next');
    if (!box) return;                       // 不是启用页
    const a = box.querySelector('a[href]');
    if (!a || a.dataset.mtUpgraded) return;
    a.dataset.mtUpgraded = '1';
    // ⚠️ **先摘 data-i18n，再写字。** 站点的 i18n.js 会把每个带该属性的元素的
    // textContent 按它的字典写回去 —— 只写字不摘属性的话，地址换了而话没换，
    // 「打开配置指南」指向一个引导页，那是骗人的。（setup.html 里为同一个陷阱
    // 写过一段注释；2026-09-02 这道门禁第一次跑就抓到了它。）
    a.removeAttribute('data-i18n');
    a.removeAttribute('data-i18n-html');
    a.textContent = TranslationCore.t('site_setup_next_engine', '去配置翻译引擎 →');
    // 直接改 href 而不是挂 click：长按/新标签打开这些浏览器自带的动作也跟着对。
    // onboard/onboard.html 在 web_accessible_resources 里（test/web-accessible.test.js
    // 静态守着），否则浏览器会拒绝这次导航，Safari 报「网址无效」。
    a.href = chrome.runtime.getURL('onboard/onboard.html');
    a.removeAttribute('target');
  }

  function paintSiteHandoff(learnOn) {
    const box = document.getElementById('mt-next-review');
    if (!box || box.childElementCount) return;      // 容器不在，或已经填过
    const T = (k, fb) => TranslationCore.t(k, fb);
    const mk = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    // 排版借站点自己的 CSS 变量，**不写死任何十六进制** —— build.js 的调色板门禁会
    // 拦下注册表不认识的颜色，而页面注入的样式正是它盯着的那一类。
    box.style.cssText = 'margin-top:28px;padding-top:22px;border-top:1px solid var(--line)';
    box.appendChild(mk('h2', null, T('site_next_title', '译文出来了。下一步：让它们到手机上')));
    box.appendChild(mk('p', 'sub', learnOn
      // 采集开着：卡已经在攒了，缺的只是同步。
      ? T('site_next_body', '你停下来读完的句子已经存成复习卡，就在这台设备上。登录之后它们才会同步到手机 App —— 不登录也能一直用，只是 App 那边会是空的。')
      // 采集关着：先说清楚没有卡这件事，否则下面那个按钮把人送到一个空页面。
      : T('site_next_body_off', '「采集学习材料」还没打开，所以现在还不会产生复习卡。先在扩展设置里打开它，读过的句子才会存下来。')));
    const cta = mk('button', 'btn btn-primary', learnOn
      ? T('site_next_cta', '打开复习页')
      : T('site_next_cta_off', '去打开采集'));
    cta.type = 'button';
    // <button> 自带 UA 边框/背景/字体，会跟站点的 .btn 打架。
    cta.style.cssText = 'border:0;cursor:pointer;font:inherit';
    cta.addEventListener('click', () => {
      // 导航到扩展页：两个目标都在 web_accessible_resources 且 matches 是 <all_urls>，
      // 否则浏览器会拒绝这次导航（Safari 报「网址无效」，#67）。
      // test/web-accessible.test.js 静态守着这一条。
      // 两个字面量各自直接写在 getURL 里，**不要**写成 getURL(cond ? a : b) ——
      // test/web-accessible.test.js 是静态扫 getURL('…') 的字面量，三元写法会让这两个
      // 目标从那道门禁的视野里消失，而它守的正是「导航到没列进清单的扩展页会被拒绝」。
      const url = learnOn
        ? chrome.runtime.getURL('learn/review.html')
        : chrome.runtime.getURL('options/options.html');
      try { window.open(url, '_blank'); } catch (_) { location.href = url; }
    });
    box.appendChild(cta);
    if (learnOn) {
      const a = mk('a', null, T('site_next_signin', '直接去登录 →'));
      a.href = chrome.runtime.getURL('options/options.html') + '#sync';
      a.target = '_blank';
      a.style.cssText = 'display:inline-block;margin-left:16px';
      box.appendChild(a);
    }
    box.hidden = false;
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

  // 点悬浮球时如果翻译还没配好，就把人送去配，而不是让他看着一次失败。
  //
  // 这条判据只在**打开**的那一下生效：关闭不需要 key。送去的是扩展自己的引导页而不是
  // 设置页 —— 引导页第 2 屏有「一键配置」，那是最短的一条路；设置页要先找到那张卡。
  //
  // 从内容脚本开新标签必须发生在用户手势里（Safari 的弹窗拦截），点击回调正是手势。
  // 判据只有一份：content/engine-state.js。判不了就别拦 —— 翻译失败还有具名提示，
  // 被拦住则什么都不会发生。
  const needsSetup = () => { try { return EngineState.needsSetup(cfg); } catch (_) { return false; } };
  function openOnboarding() {
    try { window.open(chrome.runtime.getURL('onboard/onboard.html'), '_blank'); } catch (_) {}
  }

  if (cfg.showFab) {
    FloatingButton.create(cfg.enabled, async (enabled) => {
      if (enabled && needsSetup()) {
        // 不要把按钮留在「已打开」的样子 —— 那是在说一件没发生的事。
        FloatingButton.setEnabled(false);
        cfg.enabled = false;
        openOnboarding();
        return;
      }
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
