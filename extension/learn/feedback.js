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
// （2026-09-25 起评分相关的几个计数也都只在本机；唯一上报的是 rate_prompt / review_nudge 的枚举。）
//
// 依赖：AppLink（商店条目按 flavor 分，那里是唯一登记处）。
var MTFeedback = (() => {
  const MAIL = 'belliedmonkey@gmail.com';
  // 「社区在哪儿」的唯一登记处 —— **按 flavor 分**，因为 Discord 在中国大陆打不开。
  //
  // 2026-09-06 立过一条门槛：实时群等 bt_daily 连续 4 周周活 ≥ 50 或 Discussions 累计
  // ≥ 20 个参与者再开。2026-09-20 对账后开了，依据是两条分支各自的实测：
  //   · Discussions 那条永远到不了 —— 唯一那个帖子 15 天 0 条回复，参与者 ≈ 0。
  //   · 周活那条只差时长不差人数 —— 09-07 那周 173、09-14 那周 230，是门槛的 3.5–4.6 倍；
  //     「连续 4 周」凑不齐只因为遥测 09-05 才开始收。门槛要挡的是「人还不够就开实时群」，
  //     230 周活已经远远越过那个意思。
  //
  // **发的是我们自己域名下的 /discord，不是 discord.gg/<code>。** 两个原因：
  //   1. 这个地址会被烤进 App Store 的二进制，改不动；而 Discord 的邀请码是会过期的
  //      （「设置此链接为永不过期」那个勾在 2026-09 的客户端上**是坏的** —— 界面显示
  //      「永不过期」，API 回读 expires_at 仍是 30 天后，五条路都试过）。换码只要改
  //      belliedmonkey-cc 的 vercel.json 一行 + 部署，不用重新发版过审。
  //   2. 顺带能量到点击（Vercel Web Analytics，2026-09-20 起）。
  //   跳转用 307 不是 308：308 会被浏览器永久缓存，而这个目标**一定会换**。
  //
  // 中国版留在 Discussions：Discord 大陆打不开，给他们一个白屏比不给更糟。微信/QQ 群
  // 建好之后换掉这一行即可（.local/TODO.md 里记着）。
  //
  // 改这里就够了：四个面的「讨论」按钮（popup / 设置页 / 引导页 / 宿主 App）都读它。
  const COMMUNITY_URL_GLOBAL = 'https://belliedmonkey.cc/discord';
  const COMMUNITY_URL_CHINA = 'https://github.com/belliedmonkey/belliedmonkey-translator/discussions';
  // Chrome Web Store 条目 id。options.js 的「未打包安装」提示也读它 —— 同一个 id 只写一处。
  const CWS_ID = 'ilnmffeejeohomjelipejdldhkjeoinf';
  // AMO 的 slug 是中文名（大肚猴翻译），URL 里必须是编码后的形式。
  const AMO_SLUG = '%E5%A4%A7%E8%82%9A%E7%8C%B4%E7%BF%BB%E8%AF%91';
  // 评分弹窗的本机冷却。系统自己会节流（Apple：每 365 天最多 3 次），这里再加一层
  // 是为了不在每次刷完牌堆时都去敲系统 —— 那是「想被评分」的形状，不是「值得评分」的。
  const RATING_KEY = 'mtRatingAskedAt';
  const RATING_COOLDOWN_MS = 90 * 24 * 3600 * 1000;
  const RATING_MIN_DONE = 3;
  // 浏览器侧的成功会话计数（第八期 C，2026-09-10）。评分为 0 的真因是唯一触发点在
  // App 里「刷完一轮复习」，5 天里一次都没发生；而「翻成功一页」每天都在发生。
  // 第 RATING_MIN_DONE 次成功会话之后，译文末尾出一行「觉得好用？给个评分」。
  // 独立 UI 状态键，不进 SETTINGS_KEYS（同 optDetailMode 先例）。
  const OK_SESSIONS_KEY = 'mtOkSessions';
  // ── 2026-09-25 评分画布（design/rating-moments，telemetry-design §3.12）两轮裁定 ──
  // 「真在用」= 成功 ≥3 次、且出现在 ≥2 个不同的本地日。第一天连刷三页的人还在试，
  // 问他「好不好」最好的结果是被 ×，最坏的是一颗星。日期集合只存本机、不上报。
  const OK_DAYS_KEY = 'mtOkDays';
  const MIN_DAYS = 2;
  const DAYS_KEEP = 30;
  // 译文末尾那一行（两种：Safari 的「回 App」、Chrome / Firefox 的「去评分」）的节奏：
  // 每个本地日至多一次、最多出现在 ROW_MAX_DAYS 个不同日子；第 5 个日子挂过后自动进
  // 90 天冷却，点或 × 立刻进冷却。旧口径是「不理它就每页都出」—— 09-25 回读最多一台 98 次。
  const ROW_DAYS_KEY = 'mtRowDays';
  const ROW_MAX_DAYS = 5;
  // App 侧的收获时刻计数（同一个「≥3 次、≥2 个日子」门槛），与浏览器侧分开存 ——
  // 两个宿主本来就是两个存储（§3.12 ⑤：冷却不打通，规约改成实话）。
  const VALUE_COUNT_KEY = 'mtValueCount';
  const VALUE_DAYS_KEY = 'mtValueDays';
  // 内容脚本里任何 storage promise 都要有截止时间（request-shape.js 的先例）：Safari 上
  // 后台死掉时回调永远不来，没有截止的 await 会把调用方挂死。
  const STORAGE_DEADLINE_MS = 3000;

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

  function communityUrl() {
    return flavor() === 'china' ? COMMUNITY_URL_CHINA : COMMUNITY_URL_GLOBAL;
  }
  function discussUrl() { return communityUrl(); }

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
      const timer = setTimeout(() => resolve(undefined), STORAGE_DEADLINE_MS);
      try { chrome.storage.local.get([key], (r) => { clearTimeout(timer); resolve((r || {})[key]); }); }
      catch (_) { clearTimeout(timer); resolve(undefined); }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), STORAGE_DEADLINE_MS);
      try { chrome.storage.local.set(obj, () => { clearTimeout(timer); resolve(); }); }
      catch (_) { clearTimeout(timer); resolve(); }
    });
  }

  // 本地日期（不是 UTC）：「跨两天」按用户自己的一天算，东八区晚上九点和第二天早上八点是两天。
  function localDay(now) {
    const d = new Date(Number(now) || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 往日期集合里加今天（去重、只留最近 DAYS_KEEP 个），返回新的集合。
  function addDay(days, now) {
    const today = localDay(now);
    const list = Array.isArray(days) ? days.filter((x) => typeof x === 'string') : [];
    if (!list.includes(today)) list.push(today);
    return list.slice(-DAYS_KEEP);
  }
  // 「真在用」的判据 —— 浏览器侧与 App 侧同一条，只写在这里。
  function qualifies(n, days) {
    return Number(n) >= RATING_MIN_DONE && Array.isArray(days) && days.length >= MIN_DAYS;
  }

  // 浏览器侧：记一次成功会话（一个页面会话里至少一段译文落地 / 一次字幕会话出过译文），
  // 同时记下今天。返回累计次数。只计数，不决定要不要问 —— 那是 rowToOffer 的事。
  async function noteOkSession(now) {
    // 两个键并行读：每个 storage 调用都有 3 s 截止，串行读会把最坏情况拉长到 9 s。
    const [prev, prevDays] = await Promise.all([storageGet(OK_SESSIONS_KEY), storageGet(OK_DAYS_KEY)]);
    const n = (Number(prev) || 0) + 1;
    await storageSet({ [OK_SESSIONS_KEY]: n, [OK_DAYS_KEY]: addDay(prevDays, now) });
    return n;
  }

  // 这个宿主上，译文末尾那一行是哪一种（2026-09-25 三轮裁定后，**两种都是「去复习」，没有一种再要评分**）：
  //   'app'  —— Safari：「今天读过的句子，去 App 里复习 →」。**不再要评分**：苹果审核指南 5.6.1
  //             禁止自定义评分提示，Safari 扩展是 App 的一部分；iOS 上唯一的一键打星是 App 里的
  //             requestReview（由 noteValueMoment 在收获时刻调）。**只给已登录、且开了学习的人** ——
  //             学习层默认是关的（不开就没有句子），没登录句子过不去；两者缺一，都是把人送进一个
  //             必然空着的复习屏（review.js renderGoApp 同一条规矩）。
  //   'review' —— Chrome / Firefox：「今天读过的句子，去复习 →」，打开**扩展自己的复习页**
  //             （learn/review.html）。不需要登录、Windows 上也有；只要开了学习就有句子可复习。
  //             第三轮裁定（09-25）：原先这里照旧去商店要评分，理由只有「5.6.1 管不到」—— 那只说明
  //             **可以**问，不说明**应该**问：同样 0 点击，Chrome / Firefox 商店的评分对量几乎没有影响，
  //             而把真在用的人带进复习对哪个浏览器都成立。评分只留在常驻链接里（设置页 / 弹窗）。
  //   null   —— 宿主 App 里（content-webpage 本来就不进 App 包），或上面的条件不满足。
  // ctx = { userId, learnEnabled }（content-main 给 WebpageTranslator 的 cfg 里都有）。
  function rowKind(ctx) {
    const c = ctx || {};
    const h = host();
    if (h === 'app') return null;
    if (h === 'safari') return (c.userId && c.learnEnabled === true && typeof AppLink !== 'undefined') ? 'app' : null;
    return c.learnEnabled === true ? 'review' : null;
  }

  // 这一页要不要挂那一行、挂哪一种。四道闸：真在用 · 这个宿主有行可挂 · 不在 90 天冷却里 ·
  // 今天还没挂过（每个本地日至多一次）。
  async function rowToOffer(ctx, now) {
    const kind = rowKind(ctx);
    if (!kind) return null;
    const [n0, days, last0, shown] = await Promise.all([
      storageGet(OK_SESSIONS_KEY), storageGet(OK_DAYS_KEY), storageGet(RATING_KEY), storageGet(ROW_DAYS_KEY)]);
    if (!qualifies(Number(n0) || 0, days)) return null;
    const t = Number(now) || Date.now();
    const last = Number(last0) || 0;
    if (last && t - last < RATING_COOLDOWN_MS) return null;
    if (Array.isArray(shown) && shown.includes(localDay(t))) return null;
    return kind;
  }

  // 那一行真的挂上了：记下今天；第 ROW_MAX_DAYS 个日子挂过之后自动进 90 天冷却，
  // 不用等用户点 ×（旧口径的问题正是「不理它就一直出」）。
  async function noteRowShown(now) {
    const t = Number(now) || Date.now();
    const days = addDay(await storageGet(ROW_DAYS_KEY), t);
    if (days.length >= ROW_MAX_DAYS) return markRatingAsked(t);
    return storageSet({ [ROW_DAYS_KEY]: days });
  }

  // 点了或关了：进 90 天冷却，并清掉日子计数（冷却期满之后重新从 0 数）。
  // 名字与存储键沿用旧的「评分」叫法（mtRatingAskedAt）：改键会让老用户的冷却状态丢失。
  // 在扩展里它现在是「去复习那一行」的冷却；在 App 里是系统评分请求的冷却 —— 两个存储，互不相干。
  function markRatingAsked(now) {
    return storageSet({ [RATING_KEY]: Number(now) || Date.now(), [ROW_DAYS_KEY]: [] });
  }

  // App 侧：一个收获时刻（从 Safari 那一行进来做完一组复习 / 听译或实时字幕结束且留下了句子 /
  // Mac 快速翻译成功 / 系统翻译收件箱进了卡）。记一次；够「真在用」、且不在冷却里，就向系统
  // 请求一次评分。返回 true = 这次真的向系统提了请求（系统仍可能不弹，Apple 每 365 天最多 3 次）。
  //
  // **只能从事件回调里调**，不能从一个「给我们评分」按钮里调 —— 请求可能被系统静默丢掉，
  // 按钮就成了一个点了没反应的按钮（Apple 的文档与 5.6.1 都这么要求）。`kind` 只是给读代码的人看的，
  // 不上报。
  async function noteValueMoment(kind, now) {
    if (host() !== 'app') return false;
    const t = Number(now) || Date.now();
    const [c0, d0, last0] = await Promise.all([storageGet(VALUE_COUNT_KEY), storageGet(VALUE_DAYS_KEY), storageGet(RATING_KEY)]);
    const n = (Number(c0) || 0) + 1;
    const days = addDay(d0, t);
    await storageSet({ [VALUE_COUNT_KEY]: n, [VALUE_DAYS_KEY]: days });
    if (!qualifies(n, days)) return false;
    const last = Number(last0) || 0;
    if (last && t - last < RATING_COOLDOWN_MS) return false;
    await storageSet({ [RATING_KEY]: t });
    try { window.webkit.messageHandlers.controller.postMessage('request-review'); } catch (_) { return false; }
    // `requested`，不是 `shown`：requestReview 不回调，我们不知道它弹没弹（telemetry-design §3.12）。
    try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('rate_prompt', { action: 'requested' }); } catch (_) {}
    return true;
  }

  return {
    host, device, version, mailtoUrl, rateUrl, discussUrl, communityUrl, open,
    noteOkSession, rowKind, rowToOffer, noteRowShown, markRatingAsked, noteValueMoment,
    localDay, qualifies,
    CWS_ID, RATING_KEY, RATING_COOLDOWN_MS, RATING_MIN_DONE, OK_SESSIONS_KEY,
    OK_DAYS_KEY, MIN_DAYS, ROW_DAYS_KEY, ROW_MAX_DAYS, VALUE_COUNT_KEY, VALUE_DAYS_KEY,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MTFeedback;
