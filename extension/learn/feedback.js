// learn/feedback.js —— 「反馈 / 评分 / 讨论区」三个出口的**唯一**实现。
//
// 2026-09-05 盘点：30 天 202 次下载、75 个同步账号，而产品里没有一个 mailto、
// 没有一个 GitHub 链接、App Store 两个条目 0 条评论。用户想说话没地方说，想夸也
// 没地方夸。这个文件给四个面（popup / 设置页 / 引导页 / 宿主 App）同一组地址，
// 免得每个面各抄一份邮箱和商店 id 然后各自漂。
//
// 边界（AGENTS.md 规则 4，零遥测）：这里**没有任何东西自动发出去**。mailto 的主题里
// 带版本号和平台，是为了让用户不必描述「我用的是哪一版」—— 它写在用户自己的邮件里，
// 用户看得见、可以删；评分弹窗由系统节流，我们只在本机记一个「上次问过」的时间。
//
// 依赖：AppLink（商店条目按 flavor 分，那里是唯一登记处）。
var MTFeedback = (() => {
  const MAIL = 'belliedmonkey@gmail.com';
  const DISCUSS_URL = 'https://github.com/belliedmonkey/belliedmonkey-translator/discussions';
  // Chrome Web Store 条目 id。options.js 的「未打包安装」提示也读它 —— 同一个 id 只写一处。
  const CWS_ID = 'ilnmffeejeohomjelipejdldhkjeoinf';
  // AMO 的 slug 是中文名（大肚猴翻译），URL 里必须是编码后的形式。
  const AMO_SLUG = '%E5%A4%A7%E8%82%9A%E7%8C%B4%E7%BF%BB%E8%AF%91';
  // 评分弹窗的本机冷却。系统自己会节流（Apple：每 365 天最多 3 次），这里再加一层
  // 是为了不在每次刷完牌堆时都去敲系统 —— 那是「想被评分」的形状，不是「值得评分」的。
  const RATING_KEY = 'mtRatingAskedAt';
  const RATING_COOLDOWN_MS = 90 * 24 * 3600 * 1000;
  const RATING_MIN_DONE = 3;

  function flavor() {
    return (typeof window !== 'undefined' && window.MT_FLAVOR === 'china') ? 'china' : 'global';
  }

  // 'app' | 'safari' | 'firefox' | 'chrome'。宿主 App 先判：WKWebView 的 UA 在 macOS 上
  // 也带 Safari 字样，靠 UA 分不出来；它有而浏览器没有的是原生桥。
  function host() {
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.controller) return 'app';
    } catch (_) {}
    try {
      if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) return 'firefox';
    } catch (_) {}
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Firefox/i.test(ua)) return 'firefox';
    if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg\//i.test(ua)) return 'safari';
    return 'chrome';
  }

  function device() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const p = (typeof navigator !== 'undefined' && navigator.platform) || '';
    const s = ua + ' ' + p;
    if (/iPad/i.test(s)) return 'iPad';
    if (/iPhone|iPod/i.test(s)) return 'iPhone';
    if (/Mac/i.test(s)) return 'Mac';
    if (/Android/i.test(s)) return 'Android';
    if (/Windows/i.test(s)) return 'Windows';
    if (/Linux/i.test(s)) return 'Linux';
    return '';
  }

  function version() {
    try { return chrome.runtime.getManifest().version || ''; } catch (_) { return ''; }
  }

  // 主题是产品名 + 版本 + 宿主 + 设备 + 来自哪个面。不翻译：它是给我们看的路标，
  // 而且用户可以整个删掉。正文留空 —— 预填的正文会让人觉得被代笔。
  function mailtoUrl(surface) {
    const h = host();
    const label = { app: 'App', safari: 'Safari', firefox: 'Firefox', chrome: 'Chrome' }[h] || h;
    const parts = ['BelliedMonkey Translator'];
    const v = version(); if (v) parts.push('v' + v);
    parts.push(label);
    const d = device(); if (d) parts.push(d);
    if (surface) parts.push(String(surface));
    return 'mailto:' + MAIL + '?subject=' + encodeURIComponent(parts.join(' · '));
  }

  // 商店评分页。这台设备装的是哪个面，就去哪个商店；中国版没有浏览器商店条目，
  // 那两个宿主上返回 null —— 调用方据此**藏掉**那一行，而不是指向一个不存在的页。
  function rateUrl() {
    const h = host();
    if (h === 'app' || h === 'safari') return AppLink.storeUrl() + '?action=write-review';
    if (flavor() === 'china') return null;
    if (h === 'firefox') return 'https://addons.mozilla.org/firefox/addon/' + AMO_SLUG + '/reviews/';
    return 'https://chromewebstore.google.com/detail/' + CWS_ID + '/reviews';
  }

  function discussUrl() { return DISCUSS_URL; }

  // 打开一个出口。宿主 App 里 window.open 是哑的（转换器模板没实现 createWebViewWith），
  // 走原生桥在系统里打开 —— 原生那侧是白名单（我们的两个站、App Store、我们自己的
  // 邮箱），见 scripts/sync-app-assets.js 的 MT_OPEN_URL。浏览器里 window.open 必须
  // **同步**发生在点击里（test/user-gesture.test.js），所以这里不 await 任何东西。
  function open(url) {
    if (!url) return false;
    if (host() === 'app') {
      try { window.webkit.messageHandlers.controller.postMessage('open-url:' + url); return true; } catch (_) {}
    }
    try { return !!window.open(url, '_blank', 'noopener'); } catch (_) { return false; }
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get([key], (r) => resolve((r || {})[key])); } catch (_) { resolve(undefined); }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); } catch (_) { resolve(); }
    });
  }

  // 成功时刻之后才问：一轮复习刷完、且这一轮真做了几张。只有宿主 App 有系统评分
  // 弹窗（SKStoreReviewController）；浏览器扩展没有对应物，那里的出口是设置页里的
  // 一行链接。返回 true 表示这次真的向系统提了请求（系统仍可能不弹）。
  async function maybeRequestRating(doneThisRun, now) {
    if (host() !== 'app') return false;
    if (!(Number(doneThisRun) >= RATING_MIN_DONE)) return false;
    const t = Number(now) || Date.now();
    const last = Number(await storageGet(RATING_KEY)) || 0;
    if (last && t - last < RATING_COOLDOWN_MS) return false;
    await storageSet({ [RATING_KEY]: t });
    try { window.webkit.messageHandlers.controller.postMessage('request-review'); } catch (_) { return false; }
    return true;
  }

  return {
    host, device, version, mailtoUrl, rateUrl, discussUrl, open, maybeRequestRating,
    CWS_ID, RATING_KEY, RATING_COOLDOWN_MS, RATING_MIN_DONE,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MTFeedback;
