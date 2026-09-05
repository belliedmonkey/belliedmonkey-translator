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

describe('MTFeedback.maybeRequestRating — 只在 App 里、只在成功之后、且有冷却', () => {
  test('浏览器扩展里永远 false，不碰存储', async () => {
    const { F, store } = load({ ua: SAFARI_IPHONE });
    eq(await F.maybeRequestRating(10), false);
    eq(store[F.RATING_KEY], undefined);
  });
  test('App 里做的张数不够 ⇒ false', async () => {
    const { F, window } = load({ app: true });
    eq(await F.maybeRequestRating(F.RATING_MIN_DONE - 1), false);
    eq((window.__sent || []).length, 0);
  });
  test('App 里够张数 ⇒ 向系统提一次，并记下时间', async () => {
    const { F, window, store } = load({ app: true });
    eq(await F.maybeRequestRating(F.RATING_MIN_DONE, 1000), true);
    eq(window.__sent[0], 'request-review');
    eq(store[F.RATING_KEY], 1000);
  });
  test('冷却期内第二次不提；过了冷却期再提', async () => {
    const { F, window } = load({ app: true, store: { mtRatingAskedAt: 1000 } });
    eq(await F.maybeRequestRating(10, 1000 + F.RATING_COOLDOWN_MS - 1), false);
    eq((window.__sent || []).length, 0);
    eq(await F.maybeRequestRating(10, 1000 + F.RATING_COOLDOWN_MS + 1), true);
    eq(window.__sent.length, 1);
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
