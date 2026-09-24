// test/telemetry.test.js — 匿名用量事件的客户端（docs/telemetry-design.md §8）。
//
//   ① 事件名 / 属性键不在白名单 ⇒ 不入队（服务端也会拒，但「拒了没人看见」不算守住）
//   ② 属性值含 http / @ / 超过 64 字符 ⇒ 不入队 —— 没人能把 URL、邮箱、原文塞进来
//   ③ 关掉开关 ⇒ track 是空操作，队列与 install id 一并清掉；发出的最后一条是 telemetry_off
//   ④ heartbeat 同一天只入队一次；installed 只在 id 首次生成时
//   ⑤ 中国版（MT_TELEMETRY = null）⇒ 一切都是空操作，什么都不发
const { loadModule, describe, test, ok, eq } = require('./harness');
const cfg = require('../build/telemetry.config.js');

function load({ china = false, sends = [] } = {}) {
  const store = {};
  const window = { MT_VERSION: '9.9.9', MT_TELEMETRY: china ? null : { url: 'https://x.test/functions/v1/bt-ingest', spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS } } };
  const sandbox = {
    window,
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', language: 'zh-CN' },
    crypto: require('crypto').webcrypto,
    fetch: async (url, init) => { sends.push({ url, body: JSON.parse(init.body) }); return { ok: true }; },
    chrome: { i18n: { getUILanguage: () => 'zh-CN' }, storage: { local: {
      get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
      set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
      remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
    } } },
  };
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, sends };
}
const q = (store, T) => store[T.KEYS.queue] || [];

describe('MTTelemetry — 白名单在客户端就守住', () => {
  test('① 表外事件名不入队', async () => {
    const { T, store } = load();
    eq(await T.track('page_view'), false); eq(q(store, T).length, 0);
  });
  test('① 表外属性键不入队 —— 整条，不是剔掉那个键', async () => {
    const { T, store } = load();
    eq(await T.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 12, url: 'x' }), false);
    eq(q(store, T).length, 0);
  });
  test('② 值里有 http / @ / 超长 ⇒ 不入队', async () => {
    const { T, store } = load();
    eq(await T.track('engine_set', { provider: 'me@x.com' }), false);
    eq(await T.track('translate_fail', { provider: 'a', code: 'http', status: 401, route: 'direct', ms: 1, }), true);
    eq(q(store, T).length, 1);
    eq(T._shape('translate_ok', { provider: 'x'.repeat(65), kind: 'page', ms: 1 }), null);
    eq(T._shape('translate_ok', { provider: 'https', kind: 'page', ms: 1 }), null);
  });
  test('合法事件入队，信封里只有白名单字段，ts 取整到分钟', async () => {
    const { T, store } = load();
    eq(await T.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 1234 }, Date.UTC(2026, 8, 5, 12, 34, 56)), true);
    const e = q(store, T)[0];
    eq(e.ts, '2026-09-05T12:34:00Z');
    const env = T._envelope('11111111-2222-4333-8444-555555555555', e);
    eq(Object.keys(env).sort().join(','), 'device,flavor,host,install_id,name,props,ts,ui,v');
    eq(env.host, 'safari'); eq(env.device, 'iPhone'); eq(env.ui, 'zh'); eq(env.v, '9.9.9'); eq(env.flavor, 'global');
  });
});

describe('MTTelemetry — 开关与心跳', () => {
  test('③ 关掉：发唯一一条 telemetry_off，清 id / 队列，之后 track 空操作', async () => {
    const { T, store, sends } = load();
    await T.track('heartbeat');
    const { id } = await T.installId();
    ok(id && store[T.KEYS.id] === id);
    eq(await T.setEnabled(false), false);
    eq(sends.length, 1); eq(sends[0].body.length, 1); eq(sends[0].body[0].name, 'telemetry_off'); eq(sends[0].body[0].install_id, id);
    eq(store[T.KEYS.id], undefined); eq(store[T.KEYS.queue], undefined);
    eq(await T.track('heartbeat'), false); eq(await T.enabled(), false);
    // 重新打开：新 id，与旧 id 无关
    await T.setEnabled(true);
    const again = await T.installId(); ok(again.id !== id && again.fresh);
  });
  test('④ heartbeat 一天一次；installed 只在首次生成 id 时', async () => {
    const { T, store } = load();
    await T.init(); await T.init(); await T.init();
    const names = q(store, T).map((e) => e.name);
    eq(names.join(','), 'installed,heartbeat');
  });
  // #387（2026-09-22）：App 面 259 台装机里 257 台 installed 重复，256 台重复在**同一分钟、同一批**。
  // 根因是同一页面里两个模块各调一次 init（App 包里 app.js 与 review.js），两次并发都读到「没有 id」。
  // 上一条测试是**顺序**调三次，所以永远是绿的 —— 线上的 bug 恰恰是并发。
  test('④b 同一页面并发 init：installed / heartbeat 各只一条，且只生成一个 id', async () => {
    const { T, store } = load();
    await Promise.all([T.init(), T.init(), T.init()]);
    const names = q(store, T).map((e) => e.name);
    eq(names.join(','), 'installed,heartbeat', '并发 init 记了多条：' + names.join(','));
    const a = await T.installId(), b = await T.installId();
    eq(a.id, b.id); eq(a.fresh, false);
  });
  test('④c 并发 once：同一个事件只进队一次', async () => {
    const { T, store } = load();
    await Promise.all([T.once('sync_on'), T.once('sync_on'), T.once('sync_on')]);
    eq(q(store, T).filter((e) => e.name === 'sync_on').length, 1);
  });
  // #387 后半（2026-09-22 发 1.15.0 前模拟器回读）：init 单飞之后 installed 在队列里只有一条了，
  // 表里却仍**成对**出现 —— 整批在 20–50ms 内被 POST 两次。app.js 与 review.js 各调一次
  // init({flushNow})，两个 flush 并发，都在对方清队列之前读到同一批；tm:last 那把 5 秒软锁
  // 挡的是两个页面，挡不住同一页面里的两次调用。
  test('④d 同一页面并发 flush：同一批只发一次', async () => {
    const { T, sends } = load();
    await T.init();
    await Promise.all([T.init({ flushNow: true }), T.init({ flushNow: true }), T.flush()]);
    await new Promise((r) => setTimeout(r, 10));
    const names = sends.flatMap((s) => s.body.map((e) => e.name));
    eq(names.filter((n) => n === 'installed').length, 1, '并发 flush 把同一批发了多遍：' + names.join(','));
    eq(sends.length, 1);
  });
  test('flush：先清队列再发，一批 ≤ 50，信封带同一个 install_id', async () => {
    const { T, store, sends } = load();
    for (let i = 0; i < 12; i += 1) await T.track('heartbeat');   // 第 10 条触发 flush
    await new Promise((r) => setTimeout(r, 10));
    ok(sends.length >= 1);
    const ids = new Set(sends.flatMap((s) => s.body.map((e) => e.install_id)));
    eq(ids.size, 1);
    ok(sends.every((s) => s.body.length <= 50));
  });
  test('自动化浏览器（navigator.webdriver）⇒ 空操作 —— 门禁不许往表里写', async () => {
    const { T, sends } = load();
    // 注入 webdriver 标记后再 init：与真实门禁（headless Chrome）同一形状
    const ctx = loadModule(['learn/telemetry.js'], { window: { MT_TELEMETRY: { url: 'https://x.test/i', spec: { events: cfg.EVENTS } } },
      navigator: { userAgent: 'x', webdriver: true }, crypto: require('crypto').webcrypto, fetch: async () => { sends.push(1); return { ok: true }; },
      chrome: { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() } }, i18n: { getUILanguage: () => 'en' } } });
    eq(await ctx.MTTelemetry.enabled(), false);
    eq(await ctx.MTTelemetry.track('heartbeat'), false);
    await ctx.MTTelemetry.init({ flushNow: true });
    eq(sends.length, 0); ok(T);
  });
  test('⑤ 中国版：MT_TELEMETRY 为 null ⇒ 全部空操作，什么都不发', async () => {
    const { T, store, sends } = load({ china: true });
    eq(await T.enabled(), false);
    eq(await T.track('heartbeat'), false);
    await T.init({ flushNow: true });
    eq(await T.flush(), false);
    eq(sends.length, 0); eq(Object.keys(store).length, 0);
  });
});

// grant_exhausted（telemetry-design §3.4）：09-08 进注册表，到 09-19 全仓库零发送点、线上 0 行。
// 它挂在模块内部 —— credit_exhausted 从网页 / 字幕 / 文档 / App 听译四条路上来，四条路都经过 track()。
describe('MTTelemetry — grant_exhausted 由 translate_fail{credit_exhausted} 带出，每装机一次', () => {
  const drain = () => new Promise((r) => setTimeout(r, 20));
  test('第一次 credit_exhausted ⇒ 多一条 grant_exhausted；第二次不再发', async () => {
    const { T, store } = load();
    const fail = (code) => T.track('translate_fail', { provider: 'grant', code, status: 402, route: 'direct', ms: 1 });
    eq(await fail('credit_exhausted'), true); await drain();
    eq(await fail('credit_exhausted'), true); await drain();
    const names = q(store, T).map((e) => e.name);
    eq(names.filter((n) => n === 'translate_fail').length, 2);
    eq(names.filter((n) => n === 'grant_exhausted').length, 1);
  });
  test('别的失败码不带出 grant_exhausted —— 池子空了（grant_unavailable）不是「你用完了」', async () => {
    const { T, store } = load();
    await T.track('translate_fail', { provider: 'grant', code: 'grant_unavailable', status: 503, route: 'direct', ms: 1 });
    await T.track('translate_fail', { provider: 'openai', code: 'auth', status: 401, route: 'direct', ms: 1 }); await drain();
    eq(q(store, T).filter((e) => e.name === 'grant_exhausted').length, 0);
  });
});

// dwell（telemetry-design §3.9 提案 A，2026-09-24）：引导停留时长的**桶**。
// 两件事在这里守：① 桶边界；② **算不出来时吐空串**，让调用方整个不带这个键 ——
// 带空串进去会被 shape() 判成非法值，把整条 onboarding_done 丢掉（为一个诊断属性
// 丢掉主事件是本末倒置）。
describe('MTTelemetry — dwell 分桶（§3.9）', () => {
  const at = (T, secs) => T.dwell(1_000_000, 1_000_000 + secs * 1000);
  test('边界：<3 → 0-2；<10 → 3-9；<30 → 10-29；其余 30+', () => {
    const { T } = load();
    eq(at(T, 0), '0-2'); eq(at(T, 2.9), '0-2');
    eq(at(T, 3), '3-9'); eq(at(T, 9.9), '3-9');
    eq(at(T, 10), '10-29'); eq(at(T, 29.9), '10-29');
    eq(at(T, 30), '30+'); eq(at(T, 600), '30+');
  });
  test('算不出来就吐空串：没记开始时间 / 时钟倒流', () => {
    const { T } = load();
    eq(T.dwell(0), ''); eq(T.dwell(undefined), ''); eq(T.dwell(NaN), '');
    eq(at(T, -5), '');
  });
  test('吐出来的四个值都进得了白名单；桶外的值（如秒数）整条事件被判掉', () => {
    const { T } = load();
    for (const d of ['0-2', '3-9', '10-29', '30+']) {
      ok(T._shape('onboarding_done', { surface: 'app', result: 'skipped', step: 'welcome', dwell: d }), d);
    }
    eq(T._shape('onboarding_done', { surface: 'app', result: 'skipped', step: 'welcome', dwell: '7' }), null);
    eq(T._shape('onboarding_done', { surface: 'app', result: 'skipped', step: 'welcome', dwell: '' }), null);
    // 不带这个键是合法的 —— app_resume 那条就永远不带。
    ok(T._shape('onboarding_done', { surface: 'app_resume', result: 'shown', step: 'welcome' }));
  });
});
