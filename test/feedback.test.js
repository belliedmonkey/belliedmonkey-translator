// test/feedback.test.js — 反馈 / 评分出口（MTFeedback）。
//
// 三件事值得钉住：
//   ① 评分链接跟宿主走，且**没有商店条目的宿主返回 null** —— 调用方据此藏行。中国版
//      在 Chrome/Firefox 上没有条目，指向一个不存在的页比没有这一行更糟。
//   ② mailto 的主题是给我们看的路标：版本、宿主、设备、来自哪个面。它不翻译，也
//      **不带任何用户数据** —— 零遥测（AGENTS.md 规则 4）的边界就在这一行。
//   ③ 评分弹窗只在宿主 App 里、只在真做了几张之后、且本机冷却期内不重复。系统还会
//      再节流一层，但那层我们看不见，所以这层必须自己守住。
const { loadModule, describe, test, ok, eq } = require('./harness');

function load({ flavor = 'global', ua = '', platform = '', app = false, firefox = false, store = {} } = {}) {
  const window = { MT_FLAVOR: flavor };
  if (app) window.webkit = { messageHandlers: { controller: { postMessage(m) { (window.__sent = window.__sent || []).push(m); } } } };
  const sandbox = {
    window,
    navigator: { userAgent: ua, platform },
    chrome: {
      runtime: { getManifest: () => ({ version: '9.9.9' }) },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
      } },
    },
  };
  if (firefox) sandbox.browser = { runtime: { getBrowserInfo() {} } };
  const ctx = loadModule(['learn/app-link.js', 'learn/feedback.js'], sandbox);
  return { F: ctx.MTFeedback, window, store };
}

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0';

describe('MTFeedback.host — 宿主判定', () => {
  test('原生桥在场 ⇒ app，哪怕 UA 长得像 Safari', () => {
    eq(load({ app: true, ua: SAFARI_IPHONE }).F.host(), 'app');
  });
  test('Safari 的 UA 带 Safari 不带 Chrome', () => eq(load({ ua: SAFARI_IPHONE }).F.host(), 'safari'));
  test('Chrome 的 UA 同时带 Safari 与 Chrome ⇒ chrome', () => eq(load({ ua: CHROME_MAC }).F.host(), 'chrome'));
  test('Firefox 靠 browser.runtime.getBrowserInfo 判，不靠 UA', () => eq(load({ ua: CHROME_MAC, firefox: true }).F.host(), 'firefox'));
});

describe('MTFeedback.rateUrl — 评分链接跟宿主走', () => {
  test('Safari / App ⇒ 本 flavor 的 App Store 条目 + write-review', () => {
    ok(load({ ua: SAFARI_IPHONE }).F.rateUrl() === 'https://apps.apple.com/app/id6787190032?action=write-review');
    ok(load({ app: true, flavor: 'china' }).F.rateUrl() === 'https://apps.apple.com/app/id6789718038?action=write-review');
  });
  test('Chrome ⇒ Chrome Web Store 的评论页', () => {
    ok(/chromewebstore\.google\.com\/detail\/[a-z]{32}\/reviews$/.test(load({ ua: CHROME_MAC }).F.rateUrl()));
  });
  test('Firefox ⇒ AMO 的评论页', () => {
    ok(/addons\.mozilla\.org\/firefox\/addon\/.+\/reviews\/$/.test(load({ ua: FIREFOX, firefox: true }).F.rateUrl()));
  });
  test('中国版在 Chrome / Firefox 上没有条目 ⇒ null（调用方据此藏行）', () => {
    eq(load({ ua: CHROME_MAC, flavor: 'china' }).F.rateUrl(), null);
    eq(load({ ua: FIREFOX, firefox: true, flavor: 'china' }).F.rateUrl(), null);
  });
});

describe('MTFeedback.mailtoUrl — 主题是路标，不是数据', () => {
  test('版本 · 宿主 · 设备 · 面，且只有这些', () => {
    const u = load({ ua: SAFARI_IPHONE }).F.mailtoUrl('popup');
    ok(u.startsWith('mailto:belliedmonkey@gmail.com?subject='));
    eq(decodeURIComponent(u.split('subject=')[1]), 'BelliedMonkey Translator · v9.9.9 · Safari · iPhone · popup');
  });
  test('没有 body 参数 —— 预填的正文会让人觉得被代笔', () => {
    ok(!/body=/.test(load({ ua: CHROME_MAC }).F.mailtoUrl('settings')));
  });
  test('取不到版本时不写 v，其它照旧', () => {
    const { F } = load({ ua: CHROME_MAC });
    const ctx = loadModule(['learn/app-link.js', 'learn/feedback.js'], { window: {}, navigator: { userAgent: CHROME_MAC }, chrome: {} });
    eq(decodeURIComponent(ctx.MTFeedback.mailtoUrl('x').split('subject=')[1]), 'BelliedMonkey Translator · Chrome · Mac · x');
    ok(F);
  });
});

describe('MTFeedback.open — 宿主 App 走原生桥，浏览器走 window.open', () => {
  test('App：发 open-url: 前缀的消息，不碰 window.open', () => {
    const { F, window } = load({ app: true });
    let opened = 0; window.open = () => { opened++; return {}; };
    eq(F.open('mailto:belliedmonkey@gmail.com'), true);
    eq(window.__sent[0], 'open-url:mailto:belliedmonkey@gmail.com');
    eq(opened, 0);
  });
  test('空地址 ⇒ false，什么都不做', () => eq(load({ app: true }).F.open(null), false));
});

// 2026-09-25 评分画布两轮裁定（telemetry-design §3.12，design/rating-moments）：
//   · 「真在用」= 成功 ≥3 次、且出现在 ≥2 个不同本地日（浏览器侧与 App 侧同一条）
//   · 译文末尾那一行：Safari 是「回 App 复习」（只给已登录且开了学习的人），Chrome / Firefox 是「去扩展复习页」
//     （开了学习即可）—— 第三轮起没有一种再要评分；
//     每本地日至多一次、最多 5 个日子，第 5 个日子后自动冷却；点或 × 立刻 90 天冷却
//   · App 在收获时刻调系统评分，门槛同上，只发 requested
const DAY = 24 * 3600 * 1000;
const T0 = new Date(2026, 8, 20, 10, 0, 0).getTime();   // 本地时间 2026-09-20 10:00

describe('MTFeedback 成功会话：次数 + 不同的本地日', () => {
  test('noteOkSession 累加次数，并按本地日去重记日子', async () => {
    const { F, store } = load({ ua: CHROME_MAC });
    eq(await F.noteOkSession(T0), 1);
    eq(await F.noteOkSession(T0 + 3600 * 1000), 2);          // 同一天
    eq(await F.noteOkSession(T0 + DAY), 3);                   // 第二天
    eq(store[F.OK_SESSIONS_KEY], 3);
    eq(JSON.stringify(store[F.OK_DAYS_KEY]), JSON.stringify([F.localDay(T0), F.localDay(T0 + DAY)]));
  });
  test('qualifies：≥3 次且 ≥2 个日子 —— 第一天连刷三页不算', () => {
    const { F } = load({ ua: CHROME_MAC });
    eq(F.qualifies(3, ['2026-09-20']), false);
    eq(F.qualifies(2, ['2026-09-20', '2026-09-21']), false);
    eq(F.qualifies(3, ['2026-09-20', '2026-09-21']), true);
  });
});

describe('MTFeedback.rowKind —— 哪个宿主挂哪一种行', () => {
  test('Safari：已登录且开了学习 ⇒ 回 App；缺一样 ⇒ 不挂（不把人送进空屏）', () => {
    const { F } = load({ ua: SAFARI_IPHONE });
    eq(F.rowKind({ userId: 'u1', learnEnabled: true }), 'app');
    eq(F.rowKind({ userId: '', learnEnabled: true }), null);
    eq(F.rowKind({ userId: 'u1', learnEnabled: false }), null);
  });
  test('Chrome / Firefox ⇒ 去扩展复习页，只要开了学习（不需要登录）；没开学习 ⇒ 不挂', () => {
    eq(load({ ua: CHROME_MAC }).F.rowKind({ learnEnabled: true }), 'review');
    eq(load({ ua: FIREFOX, firefox: true }).F.rowKind({ learnEnabled: true }), 'review');
    eq(load({ ua: CHROME_MAC }).F.rowKind({}), null);
    eq(load({ ua: CHROME_MAC }).F.rowKind({ userId: 'u1', learnEnabled: false }), null);
  });
  test('中国版 Chrome / Firefox 也一样（复习页在扩展里，不依赖商店条目）', () => {
    eq(load({ flavor: 'china', ua: CHROME_MAC }).F.rowKind({ learnEnabled: true }), 'review');
    eq(load({ flavor: 'china', ua: FIREFOX, firefox: true }).F.rowKind({ learnEnabled: true }), 'review');
  });
  test('中国版 Safari 照样有「回 App」（它有 App）', () => {
    eq(load({ flavor: 'china', ua: SAFARI_IPHONE }).F.rowKind({ userId: 'u1', learnEnabled: true }), 'app');
  });
  test('宿主 App 里没有这一行', () => eq(load({ app: true }).F.rowKind({ userId: 'u1', learnEnabled: true }), null));
});

describe('MTFeedback.rowToOffer / noteRowShown / markRatingAsked —— 节奏与冷却', () => {
  const LEARN = { learnEnabled: true };
  const qualified = () => ({ mtOkSessions: 3, mtOkDays: ['2026-09-18', '2026-09-19'] });
  test('没到「真在用」⇒ 不挂', async () => {
    const { F } = load({ ua: CHROME_MAC, store: { mtOkSessions: 5, mtOkDays: ['2026-09-20'] } });
    eq(await F.rowToOffer(LEARN, T0), null);
  });
  test('到了 ⇒ Chrome 挂「去扩展复习页」', async () => {
    eq(await load({ ua: CHROME_MAC, store: qualified() }).F.rowToOffer(LEARN, T0), 'review');
  });
  test('每个本地日至多一次：今天挂过了 ⇒ 今天不再挂，明天再挂', async () => {
    const { F } = load({ ua: CHROME_MAC, store: qualified() });
    await F.noteRowShown(T0);
    eq(await F.rowToOffer(LEARN, T0 + 3600 * 1000), null);
    eq(await F.rowToOffer(LEARN, T0 + DAY), 'review');
  });
  test('第 5 个日子挂过之后自动进 90 天冷却，并清掉日子计数', async () => {
    const { F, store } = load({ ua: CHROME_MAC, store: qualified() });
    for (let d = 0; d < F.ROW_MAX_DAYS - 1; d++) await F.noteRowShown(T0 + d * DAY);
    eq(store[F.RATING_KEY], undefined);
    const fifth = T0 + (F.ROW_MAX_DAYS - 1) * DAY;
    await F.noteRowShown(fifth);
    eq(store[F.RATING_KEY], fifth);
    eq(JSON.stringify(store[F.ROW_DAYS_KEY]), '[]');
    eq(await F.rowToOffer(LEARN, fifth + DAY), null);
    eq(await F.rowToOffer(LEARN, fifth + F.RATING_COOLDOWN_MS + DAY), 'review');
  });
  test('点了或关了 ⇒ 立刻冷却 90 天，过了再挂', async () => {
    const { F, store } = load({ ua: CHROME_MAC, store: qualified() });
    await F.markRatingAsked(T0);
    eq(store[F.RATING_KEY], T0);
    eq(await F.rowToOffer(LEARN, T0 + F.RATING_COOLDOWN_MS - 1), null);
    eq(await F.rowToOffer(LEARN, T0 + F.RATING_COOLDOWN_MS + 1), 'review');
  });
  test('Safari 已登录且开了学习 ⇒ 挂「回 App」', async () => {
    eq(await load({ ua: SAFARI_IPHONE, store: qualified() }).F.rowToOffer({ userId: 'u1', learnEnabled: true }, T0), 'app');
  });
  test('storage 永不回调时 7 s 内落定（内容脚本里 Safari 后台死掉的形状）', async () => {
    const ctx = loadModule(['learn/app-link.js', 'learn/feedback.js'], {
      window: { MT_FLAVOR: 'global' }, navigator: { userAgent: CHROME_MAC, platform: '' },
      chrome: { runtime: { getManifest: () => ({ version: '1' }) }, storage: { local: { get: () => {}, set: () => {} } } },
    });
    const t0 = Date.now();
    eq(await ctx.MTFeedback.noteOkSession(), 1);      // 读不到 ⇒ 当 0，+1
    ok(Date.now() - t0 < 7000, '并行读 3 s + 写 3 s，不能挂死');
  });
});

describe('MTFeedback.noteValueMoment —— App 在收获时刻请求系统评分', () => {
  test('浏览器里永远 false，不碰存储', async () => {
    const { F, store } = load({ ua: SAFARI_IPHONE });
    eq(await F.noteValueMoment('review', T0), false);
    eq(store[F.VALUE_COUNT_KEY], undefined);
  });
  test('同一天三次不够（要跨 ≥2 天）', async () => {
    const { F, window } = load({ app: true });
    for (let k = 0; k < 3; k++) eq(await F.noteValueMoment('listen', T0 + k * 60000), false);
    eq((window.__sent || []).length, 0);
  });
  test('≥3 次且跨 ≥2 天 ⇒ 向系统提一次，记下时间', async () => {
    const { F, window, store } = load({ app: true });
    await F.noteValueMoment('review', T0);
    await F.noteValueMoment('review', T0 + 60000);
    eq(await F.noteValueMoment('quick', T0 + DAY), true);
    eq(window.__sent[0], 'request-review');
    eq(store[F.RATING_KEY], T0 + DAY);
  });
  test('冷却期内不再提；过了冷却期再提', async () => {
    const { F, window } = load({ app: true, store: { mtValueCount: 5, mtValueDays: ['2026-09-18', '2026-09-19'], mtRatingAskedAt: T0 } });
    eq(await F.noteValueMoment('systrans', T0 + F.RATING_COOLDOWN_MS - 1), false);
    eq((window.__sent || []).length, 0);
    eq(await F.noteValueMoment('systrans', T0 + F.RATING_COOLDOWN_MS + 1), true);
    eq(window.__sent.length, 1);
  });
  test('发出请求时记 rate_prompt{requested}（不是 shown —— 系统弹没弹我们不知道）', async () => {
    const tracked = [];
    const store = { mtValueCount: 5, mtValueDays: ['2026-09-18', '2026-09-19'] };
    const window = { MT_FLAVOR: 'global', webkit: { messageHandlers: { controller: { postMessage() {} } } } };
    const ctx = loadModule(['learn/app-link.js', 'learn/feedback.js'], {
      window, navigator: { userAgent: '', platform: '' },
      MTTelemetry: { track: (name, props) => tracked.push([name, props.action]) },
      chrome: { runtime: { getManifest: () => ({ version: '1' }) }, storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); } } } },
    });
    eq(await ctx.MTFeedback.noteValueMoment('review', T0), true);
    eq(JSON.stringify(tracked), JSON.stringify([['rate_prompt', 'requested']]));
  });
});
