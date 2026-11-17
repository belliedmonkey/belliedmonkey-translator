// test/bel294-contract.test.js — BEL-294 客户端的五条可验证契约。
//
//   295 build：公共信封有就写、没有就**整键省略**（不写 0）；值来自原生 caps。
//   296 op_id：translate_start/ok/fail 与 engine_test 各一次操作一个；扣费没有。
//   298 丢键保事件：多一个未知/非法键时事件仍发出、那个键被剔除并记本机 rech。
//   298 status=0：不写进 translate_fail；缺席看得出来。
//   298 cancelled：在封闭码表里，且客户端 shape 收得下。
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');
const cfg = require('../build/telemetry.config.js');
const fs = require('fs');
const path = require('path');

function load({ nativeAudio, appCaps } = {}) {
  const store = {};
  const ls = {};
  const window = {
    MT_VERSION: '9.9.9',
    MT_FLAVOR: 'global',
    MT_TELEMETRY: {
      url: 'https://x.test/functions/v1/bt-ingest',
      spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
    },
    MT_PROVIDERS: [],
  };
  if (appCaps !== undefined) window.MT_APP_CAPS = appCaps;
  const sandbox = {
    window, URL,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; },
    },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', platform: 'iPhone', language: 'zh-CN' },
    crypto: require('crypto').webcrypto,
    fetch: async () => ({ ok: true }),
    chrome: { i18n: { getUILanguage: () => 'zh-CN' }, storage: { local: {
      get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
      set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
      remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
    } } },
  };
  if (nativeAudio) sandbox.NativeAudio = nativeAudio;
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, ls };
}
const q = (store, T) => store[T.KEYS.queue] || [];

describe('BEL-295 · build 在公共信封里，可缺且省略', () => {
  test('注册表：COMMON.build 是 int；扩展侧没有它的发送点', () => {
    eq(cfg.COMMON.build, 'int');
    const gen = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/bt-ingest/events.gen.json'), 'utf8'));
    eq(gen.common.build, 'int');
  });
  test('原生 caps().build ⇒ 信封带 build（整数）', () => {
    const { T } = load({ nativeAudio: { caps: () => ({ build: 232 }) } });
    const env = T._envelope('11111111-2222-4333-8444-555555555555', { name: 'heartbeat', props: {}, ts: '2026-11-17T12:00Z' });
    eq(env.build, 232);
  });
  test('documentStart 注入的 MT_APP_CAPS 也能读到（没有 NativeAudio 时）', () => {
    const { T } = load({ appCaps: { build: 233 } });
    const env = T._envelope('11111111-2222-4333-8444-555555555555', { name: 'heartbeat', props: {}, ts: '2026-11-17T12:00Z' });
    eq(env.build, 233);
  });
  test('拿不到 / 非法 ⇒ 整个键省略，不写 0 / 字符串冒充', () => {
    for (const opts of [{}, { appCaps: {} }, { appCaps: { build: 0 / 0 } }, { appCaps: { build: '232' } }, { appCaps: { build: -1 } }]) {
      const { T } = load(opts);
      const env = T._envelope('11111111-2222-4333-8444-555555555555', { name: 'heartbeat', props: {}, ts: '2026-11-17T12:00Z' });
      ok(!Object.prototype.hasOwnProperty.call(env, 'build'), JSON.stringify(opts) + ' 不该带 build');
    }
  });
});

describe('BEL-296 · op_id 只给翻译三态与 engine_test', () => {
  test('注册表：translate_start/ok/fail 与 engine_test 有 op_id；grant 两条没有', () => {
    for (const name of ['translate_start', 'translate_ok', 'translate_fail', 'engine_test']) {
      eq(cfg.EVENTS[name].op_id, 'id', name + '.op_id');
    }
    for (const name of ['grant_debited', 'grant_debit_fail']) {
      ok(!Object.prototype.hasOwnProperty.call(cfg.EVENTS[name], 'op_id'), name + ' 不能有 op_id');
    }
  });
  test('start→ok 同一个 op_id；两次操作不同', async () => {
    const { T, store } = load();
    await T.track('translate_start', { engine: 'deepseek', kind: 'page' });
    await T.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 12 });
    await T.track('translate_start', { engine: 'deepseek', kind: 'page' });
    await T.track('translate_fail', { provider: 'deepseek', kind: 'page', code: 'timeout' });
    const rows = q(store, T);
    eq(rows.length, 4);
    const a = rows[0].props.op_id, b = rows[1].props.op_id, c = rows[2].props.op_id, d = rows[3].props.op_id;
    ok(/^[0-9a-f]{16}$/.test(a), 'op_id 必须是 16 hex：' + a);
    eq(a, b, 'start 与 ok 必须同一个 op_id');
    eq(c, d, 'start 与 fail 必须同一个 op_id');
    ok(a !== c, '两次操作必须不同');
  });
  test('没有 start 的终态（doc/quick）每次一个，不借用别的 kind 的 start', async () => {
    const { T, store } = load();
    await T.track('translate_start', { engine: 'deepseek', kind: 'page' });
    await T.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 5 });
    await T.track('translate_ok', { provider: 'deepseek', kind: 'doc' });
    await T.track('translate_ok', { provider: 'deepseek', kind: 'doc' });
    const rows = q(store, T);
    eq(rows.length, 4);
    ok(rows[1].props.op_id !== rows[2].props.op_id, 'doc 不能借用 page 的 op_id');
    ok(rows[2].props.op_id !== rows[3].props.op_id, '两次无 start 的 doc 操作必须不同');
  });

  test('engine_test 每次测试一个 op_id；扣费事件即使传了 op_id 也被剔除', async () => {
    const { T, store } = load();
    await T.track('engine_test', { slot: 'chat', result: 'ok' });
    await T.track('engine_test', { slot: 'chat', result: 'fail', code: 'auth' });
    await T.track('grant_debited', { surface: 'listen', kind: 'chat', op_id: 'deadbeefdeadbeef' });
    const rows = q(store, T);
    eq(rows.length, 3);
    ok(/^[0-9a-f]{16}$/.test(rows[0].props.op_id));
    ok(/^[0-9a-f]{16}$/.test(rows[1].props.op_id));
    ok(rows[0].props.op_id !== rows[1].props.op_id, '两次测试必须不同');
    ok(!Object.prototype.hasOwnProperty.call(rows[2].props, 'op_id'), '扣费事件不能有 op_id');
  });
});

describe('BEL-298 · 丢键保事件 / status=0 / cancelled', () => {
  test('多一个未知键 ⇒ 事件仍入队，未知键被剔除', async () => {
    const { T, store, ls } = load();
    eq(await T.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 12, url: 'https://secret.example/a' }), true);
    const rows = q(store, T);
    eq(rows.length, 1, '事件不能被整条丢掉');
    eq(rows[0].name, 'translate_ok');
    ok(!Object.prototype.hasOwnProperty.call(rows[0].props, 'url'), '未知键必须被剔除');
    const rech = JSON.parse(ls[T.REJ_KEY] || '[]');
    ok(rech.length === 1 && rech[0].k.indexOf('url') >= 0, '被丢键应进本机 rech 环');
    ok(!/secret\.example/.test(JSON.stringify(rech)), 'rech 只记键名，不记值');
  });
  test('一个非法值也只丢那个键，其余字段保留', async () => {
    const { T } = load();
    const e = T._shape('translate_ok', { provider: 'https://bad', kind: 'page', ms: 12 });
    ok(e, '事件仍应保留');
    ok(!Object.prototype.hasOwnProperty.call(e.props, 'provider'));
    eq(e.props.kind, 'page'); eq(e.props.ms, 12);
  });
  test('status=0 不写进 translate_fail；正的 status 照写', () => {
    const { T } = load();
    const zero = T._shape('translate_fail', { provider: 'deepseek', kind: 'page', code: 'timeout', status: 0 });
    ok(zero); ok(!Object.prototype.hasOwnProperty.call(zero.props, 'status'));
    const http = T._shape('translate_fail', { provider: 'deepseek', kind: 'page', code: 'http', status: 500 });
    eq(http.props.status, 500);
  });
  test('cancelled 在封闭码表里，且能被 shape 收下', () => {
    ok(cfg.EVENTS.translate_fail.code.indexOf('cancelled') >= 0);
    const { T } = load();
    const e = T._shape('translate_fail', { provider: 'deepseek', kind: 'doc', code: 'cancelled' });
    ok(e); eq(e.props.code, 'cancelled');
  });
});
