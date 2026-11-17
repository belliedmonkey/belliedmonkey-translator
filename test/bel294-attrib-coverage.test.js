// test/bel294-attrib-coverage.test.js — BEL-294 归因覆盖补齐（客户端半边）。
//
// 覆盖三条可验证的契约，全部是「读了代码就能重跑」的判据：
//   ① BEL-295：信封上的 build / reg —— 有就写、没有就**省略这个键**（不写 0 占位）；
//      events.gen.json 与注册表一致；已提交的 providers.gen.js 不要再是旧事件表。
//   ② BEL-296：op_id 进了注册表（translate_ok/fail、engine_test、grant_debited/debit_fail），
//      同一次操作的开始与终态能有同一个 id。
//   ③ BEL-298：翻译取消有独立 code（不再压成 timeout）；未知键只丢键、不丢整条事件，
//      被丢的键记在本机环里。
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');
const fs = require('fs');
const path = require('path');
const cfg = require('../build/telemetry.config.js');

const ROOT = path.join(__dirname, '..');

function load({ build, reg } = {}) {
  const store = {};
  const ls = {};
  const sends = [];
  const tel = { url: 'https://x.test/functions/v1/bt-ingest', spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS } };
  const window = { MT_VERSION: '9.9.9', MT_FLAVOR: 'global', MT_TELEMETRY: tel, MT_PROVIDERS: [] };
  if (build !== undefined) window.MT_BUILD = build;
  if (reg !== undefined) window.MT_REG = reg;
  const sandbox = {
    window, URL,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; },
    },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', platform: 'iPhone', language: 'zh-CN' },
    crypto: require('crypto').webcrypto,
    fetch: async (url, init) => { sends.push({ url, body: JSON.parse(init.body) }); return { ok: true }; },
    chrome: { i18n: { getUILanguage: () => 'zh-CN' }, storage: { local: {
      get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
      set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
      remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
    } } },
  };
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, sends, ls };
}

describe('BEL-295 · 信封上的 build / reg', () => {
  test('注册表里 build 是 int、reg 是 id —— 服务端白名单认得这两个类型', () => {
    eq(cfg.COMMON.build, 'int');
    eq(cfg.COMMON.reg, 'id');
  });

  test('给了 build / reg ⇒ 信封带这两个键', () => {
    const { T } = load({ build: 232, reg: 'a1b2c3d4' });
    const env = T._envelope('00000000-0000-4000-8000-000000000000', { name: 'heartbeat', props: {}, ts: '2026-11-17T12:00Z' });
    eq(env.build, 232);
    eq(env.reg, 'a1b2c3d4');
  });

  test('没给 ⇒ 整个键省略，不写 0 / unknown 冒充已归因', () => {
    const { T } = load();
    const env = T._envelope('00000000-0000-4000-8000-000000000000', { name: 'heartbeat', props: {}, ts: '2026-11-17T12:00Z' });
    ok(!Object.prototype.hasOwnProperty.call(env, 'build'), 'build 不该以占位值出现');
    ok(!Object.prototype.hasOwnProperty.call(env, 'reg'), 'reg 不该以占位值出现');
  });

  test('events.gen.json 与注册表逐字一致（服务端读的是它）', () => {
    const gen = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/bt-ingest/events.gen.json'), 'utf8'));
    deepEq(gen.events, cfg.EVENTS, 'events.gen.json 与 build/telemetry.config.js 漂移了：跑 node scripts/gen-telemetry.js');
    deepEq(gen.common, cfg.COMMON, 'events.gen.json 的 common 与注册表漂移');
  });
});

describe('BEL-296 · op_id 贯穿一次操作', () => {
  const need = ['translate_ok', 'translate_fail', 'engine_test', 'grant_debited', 'grant_debit_fail'];
  test('五个事件都登记了 op_id（可缺，但键合法）', () => {
    for (const name of need) {
      ok(Object.prototype.hasOwnProperty.call(cfg.EVENTS[name], 'op_id'), name + ' 缺 op_id');
      eq(cfg.EVENTS[name].op_id, 'id', name + '.op_id 规则应为 id');
    }
  });

  test('同一个 op_id 能同时进 translate_ok 与 translate_fail', () => {
    const { T } = load();
    const okEv = T._shape('translate_ok', { provider: 'google', kind: 'page', ms: 419, surface: 'quick', op_id: 'abc123def456' });
    const failEv = T._shape('translate_fail', { provider: 'google', kind: 'page', code: 'timeout', op_id: 'abc123def456' });
    ok(okEv && failEv, '两条都该被接受');
    eq(okEv.props.op_id, failEv.props.op_id);
  });
});

describe('BEL-298 · 取消与未知键', () => {
  test('翻译取消有独立 code=cancelled（不再压成 timeout）', () => {
    ok(cfg.EVENTS.translate_fail.code.indexOf('cancelled') >= 0, 'translate_fail.code 缺 cancelled');
  });

  test('带未知键只丢那个键，已校验的 reason/code/op_id 仍然入队', () => {
    const { T, store, ls } = load();
    const ev = T._shape('translate_fail', {
      provider: 'google', kind: 'page', code: 'cancelled', op_id: 'abc123', some_new_key: 'x',
    });
    ok(ev, '整条事件不该因为一个未知键被丢掉');
    eq(ev.props.code, 'cancelled');
    eq(ev.props.op_id, 'abc123');
    ok(!Object.prototype.hasOwnProperty.call(ev.props, 'some_new_key'), '未知键不该随事件出去');
    const rech = JSON.parse(ls['mt:tm:rech'] || '[]');
    ok(rech.length >= 1 && rech[rech.length - 1].k.indexOf('some_new_key') >= 0, '被拒键应记在本机环里');
  });

  test('值非法的已知键同样只丢键', () => {
    const { T } = load();
    const ev = T._shape('translate_fail', { provider: 'https://x.test', kind: 'page', code: 'cancelled' });
    ok(ev, '值非法不该拖掉整条');
    ok(!Object.prototype.hasOwnProperty.call(ev.props, 'provider'));
    eq(ev.props.code, 'cancelled');
  });
});
