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
  test('flush：先清队列再发，一批 ≤ 50，信封带同一个 install_id', async () => {
    const { T, store, sends } = load();
    for (let i = 0; i < 12; i += 1) await T.track('heartbeat');   // 第 10 条触发 flush
    await new Promise((r) => setTimeout(r, 10));
    ok(sends.length >= 1);
    const ids = new Set(sends.flatMap((s) => s.body.map((e) => e.install_id)));
    eq(ids.size, 1);
    ok(sends.every((s) => s.body.length <= 50));
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
