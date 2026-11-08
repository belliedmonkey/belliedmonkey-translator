// test/telemetry-session.test.js — BEL-223 / 225 / 226 的 App 侧发送点。
//
// 这些事件全部收在 src/app/telemetry-session.js 一处（launch_id 也只有一个生成点）。
// 这里用 vm 把它当普通 ESM 跑：chrome.storage / MTTelemetry / LearnAuth / fetch 都是
// 桩，断言的是「发了什么、带没带 token、同一启动是不是同一个 launch_id」。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc, loadModule } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const ROOT = path.join(__dirname, '..');
const MOD = 'src/app/telemetry-session.js';
const INSTALL = '11111111-1111-4111-8111-111111111111';
const SETUP = '22222222-2222-4222-8222-222222222222';
const TEL_SPEC = {
  url: 'https://ingest.test/functions/v1/bt-ingest',
  spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
};

function store() { return Object.create(null); }

// chrome.storage.local 的回调桩（与产品同一套 API 形状）。
function chromeOf(s) {
  const local = {
    get(keys, cb) {
      const out = {};
      const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
      for (const k of list) if (k in s) out[k] = s[k];
      cb && cb(out);
    },
    set(obj, cb) { Object.assign(s, obj); cb && cb(); },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete s[k];
      cb && cb();
    },
  };
  return { storage: { local } };
}

function load(opts) {
  const o = opts || {};
  const s = o.store || store();
  const events = [];
  const sandbox = {
    console: { debug() {}, log: console.log, error: console.error },
    window: o.window || {},
    chrome: chromeOf(s),
    fetch: o.fetch || (async () => ({ ok: true, status: 200 })),
    MTTelemetry: o.telemetry || {
      enabled: async () => true,
      track(name, props) { events.push({ name, props }); },
      installId: async () => ({ id: INSTALL }),
    },
  };
  // LearnAuth 默认：已确认未登录。
  sandbox.LearnAuth = o.learnAuth || {
    currentStable: async () => null,
    lastLoadError: () => '',
  };
  if (o.backend) sandbox.window.MT_BACKEND = o.backend;
  if (o.flavor) sandbox.window.MT_FLAVOR = o.flavor;
  if (o.telemetrySpec) sandbox.window.MT_TELEMETRY = o.telemetrySpec;
  const ctx = loadSrc(MOD, 'TelemetrySession', sandbox);
  return { TS: ctx.TelemetrySession, events, store: s, sandbox };
}

// 真 MTTelemetry（extension/learn/telemetry.js）+ 本模块，共用同一个 storage / fetch 桩。
// 这样测的是产品里真正那道 enabled() 闸，而不是假 telemetry 的 track() 记录。
function loadReal(opts) {
  const o = opts || {};
  const s = o.store || store();
  const fetches = [];
  const window = {
    MT_VERSION: '1.23.3',
    MT_FLAVOR: o.flavor || 'global',
    MT_TELEMETRY: TEL_SPEC,
  };
  if (o.backend) window.MT_BACKEND = o.backend;
  const chrome = chromeOf(s);
  chrome.i18n = { getUILanguage: () => 'en' };
  const sandbox = {
    console: { debug() {}, log: console.log, error: console.error },
    window,
    chrome,
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      language: 'en',
    },
    crypto: require('crypto').webcrypto,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true, status: 200 }; },
    LearnAuth: o.learnAuth || { currentStable: async () => null, lastLoadError: () => '' },
  };
  const telCtx = loadModule(['learn/telemetry.js'], sandbox);
  const T = telCtx.MTTelemetry;
  let trackCalls = 0;
  const origTrack = T.track;
  T.track = function countedTrack(name, props, now) {
    trackCalls += 1;
    return origTrack.call(T, name, props, now);
  };
  sandbox.MTTelemetry = T;
  const ctx = loadSrc(MOD, 'TelemetrySession', sandbox);
  return { TS: ctx.TelemetrySession, T, store: s, fetches, trackCalls: () => trackCalls };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('BEL-225 app_open', () => {
  test('一次冷启一条；launch_id 同启动一致；登录墙前的未登录也能发', async () => {
    const { TS, events } = load();
    eq(TS.launchId(), TS.launchId(), '同一次启动的 launch_id 必须一致');
    await TS.appOpen();
    await TS.appOpen();          // 第二次是同一个冷启（bootShell + main.jsx 各一次）
    eq(events.length, 1, '一次冷启只能有一条 app_open');
    eq(events[0].name, 'app_open');
    eq(events[0].props.launch_id, TS.launchId());
    eq(events[0].props.surface, 'listen', '没有上次面时按首页默认面 listen');
    eq(events[0].props.auth_state, 'signed_out');
    ok(!('entry_kind' in events[0].props), 'entry_kind 没约定 ⇒ 不带');
  });

  test('会话已读出 ⇒ signed_in；读失败 ⇒ unknown（不是 signed_out）', async () => {
    const a = load({ learnAuth: { currentStable: async () => ({ userId: 'u' }), lastLoadError: () => '' } });
    await a.TS.appOpen();
    eq(a.events[0].props.auth_state, 'signed_in');

    const b = load({ learnAuth: { currentStable: async () => null, lastLoadError: () => 'storage read failed' } });
    await b.TS.appOpen();
    eq(b.events[0].props.auth_state, 'unknown');
  });

  test('surface 规则：上次面优先（doc），同一个面落盘给下一次冷启', async () => {
    const s = store();
    s['tm:lastSurface'] = 'doc';
    const a = load({ store: s });
    await a.TS.appOpen();
    eq(a.events[0].props.surface, 'doc');

    const b = load();
    b.TS.enter('live_caption');
    eq(b.TS.currentSurfaceSync(), 'live_caption');
    // enter 的落盘是异步回调；等一拍再重开模块模拟下一次冷启。
    await new Promise((r) => setTimeout(r, 0));
    eq(b.store['tm:lastSurface'], 'live_caption');
    const c = load({ store: b.store });
    await c.TS.appOpen();
    eq(c.events[0].props.surface, 'live_caption');

    // quick 是独立面板的冷启，不是主 App 的「上次面」。
    const qs = store();
    qs['tm:lastSurface'] = 'quick';
    const q = load({ store: qs });
    await q.TS.appOpen();
    eq(q.events[0].props.surface, 'listen', '主 App 冷启不继承 quick 面板的 surface');
  });

  test('App 没有 web_caption 这个面：enter 不接受它', () => {
    const { TS } = load();
    eq(TS.enter('web_caption'), 'listen');
    eq(TS.currentSurfaceSync(), 'listen');
  });

  test('app_open 的调用点在 shell-model 的登录墙判定之前', () => {
    const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    const appOpen = shell.indexOf('TelemetrySession.appOpen()');
    // 登录按钮的成功路径里也有 show(session)；冷启的登录墙判定是 boot IIFE 里最后一次。
    const gate = shell.lastIndexOf('await show(session)');
    ok(appOpen >= 0, 'shell-model 里找不到 appOpen()');
    ok(gate >= 0, 'shell-model 里找不到登录墙的 show(session)');
    ok(appOpen < gate, 'app_open 必须在登录墙判定之前');
  });
});

describe('BEL-223 auth_ok', () => {
  test('调用形状：Bearer 会话 + install_id/method/host/flavor/provider；正文无 user_id', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    const { TS, events } = load({ fetch, backend: { url: 'https://bt.test' }, flavor: 'china' });
    const got = await TS.noteAuthOk({ provider: 'google', userId: 'user-1', accessToken: 'access-token-xyz' });
    eq(got, true);
    eq(calls.length, 1);
    eq(calls[0].url, 'https://bt.test/functions/v1/bt-auth-ok');
    eq(calls[0].init.method, 'POST');
    eq(calls[0].init.headers.Authorization, 'Bearer access-token-xyz');
    eq(calls[0].init.headers['x-mt-install-id'], INSTALL);
    eq(calls[0].init.headers['x-mt-method'], 'signup');
    eq(calls[0].init.headers['x-mt-host'], 'app');
    eq(calls[0].init.headers['x-mt-flavor'], 'china');
    eq(calls[0].init.headers['x-mt-provider'], 'google');
    const body = JSON.parse(calls[0].init.body);
    deepEq(Object.keys(body).sort(), ['flavor', 'host', 'install_id', 'method', 'provider'].sort());
    eq(body.install_id, INSTALL);
    eq(body.method, 'signup');
    eq(body.host, 'app');
    eq(body.flavor, 'china');
    eq(body.provider, 'google');
    ok(!/user_id|email|token|access-token-xyz/.test(calls[0].init.body), '正文不能出现 user_id/邮箱/令牌');

    eq(events.length, 1);
    eq(events[0].name, 'auth_ok');
    eq(events[0].props.surface, 'listen');
    eq(events[0].props.provider, 'google');
    eq(events[0].props.method, 'signup');
  });

  test('同一账号第二次登录 ⇒ signin（本机口径）；不同账号 ⇒ signup', async () => {
    const { TS, events } = load();
    await TS.noteAuthOk({ provider: 'email', userId: 'u1', accessToken: 't' });
    await TS.noteAuthOk({ provider: 'email', userId: 'u1', accessToken: 't' });
    await TS.noteAuthOk({ provider: 'email', userId: 'u2', accessToken: 't' });
    deepEq(events.map((e) => e.props.method), ['signup', 'signin', 'signup']);
  });

  test('第一方窄口失败不阻塞：返回 false、不抛、匿名事件照发、debug 不含令牌', async () => {
    const logs = [];
    const fetch = async () => { const e = new Error('network down'); e.name = 'TypeError'; throw e; };
    const { TS, events, sandbox } = load({ fetch, backend: { url: 'https://bt.test' } });
    sandbox.console.debug = (...args) => logs.push(args.join(' '));
    const got = await TS.noteAuthOk({ provider: 'apple', userId: 'u', accessToken: 'secret-token' });
    eq(got, false, '窄口失败只返回 false');
    eq(events.length, 1, '匿名 auth_ok 不受窄口失败影响');
    eq(events[0].props.provider, 'apple');
    ok(!logs.join(' ').includes('secret-token'), 'debug 日志不能出现令牌');
  });

  test('没有会话令牌时不发请求（也绝不把 token 写进事件）', async () => {
    let called = 0;
    const { TS, events } = load({ fetch: async () => { called++; return { ok: true }; } });
    eq(await TS.noteAuthOk({ provider: 'apple', userId: 'u' }), false);
    eq(called, 0);
    eq(events.length, 1);
    ok(!('accessToken' in events[0].props) && !('userId' in events[0].props));
  });
});

describe('BEL-223 live_gate / grant_claim_fail / launch_id', () => {
  test('live_gate 两态都用字符串枚举，不是 JSON 布尔', () => {
    const { TS, events } = load();
    TS.liveGate('listen', true);
    TS.liveGate('live_caption', false);
    TS.liveGate('live_caption', 'true');
    deepEq(events.map((e) => e.name), ['live_gate', 'live_gate', 'live_gate']);
    deepEq(events.map((e) => e.props.ok), ['true', 'false', 'true']);
    deepEq(events.map((e) => e.props.surface), ['listen', 'live_caption', 'live_caption']);
    ok(events.every((e) => typeof e.props.ok === 'string'), 'ok 必须是字符串');
  });

  test('grant_claim_fail 的 code 归一化到注册表七值', () => {
    const { TS } = load();
    const cases = {
      exhausted: 'exhausted', unavailable: 'unavailable', misconfigured: 'misconfigured',
      revoked: 'revoked', invalid: 'invalid', model: 'model', busy: 'busy',
      grant_unavailable: 'unavailable', grant_misconfigured: 'misconfigured',
      offline: 'unavailable', signed_out: 'revoked', model_not_allowed: 'model',
      rate_limited: 'busy', 'weird raw text!': 'unavailable',
    };
    for (const [raw, want] of Object.entries(cases)) eq(TS.grantClaimCode(raw), want, raw);
  });

  test('grant_claim_fail 事件带当前 surface 与归一化 code', () => {
    const { TS, events } = load();
    TS.enter('doc');
    TS.grantClaimFail('grant_unavailable');
    eq(events[0].name, 'grant_claim_fail');
    eq(events[0].props.surface, 'doc');
    eq(events[0].props.code, 'unavailable');
  });

  test('launch_id 在发送口注入：asr_entry / engine_test / mic_permission / asr_start 共用一个 id', () => {
    const seen = [];
    const telemetry = {
      track(name, props) { seen.push({ name, props }); },
      installId: async () => ({ id: INSTALL }),
    };
    const spec = {
      spec: { events: {
        asr_entry: { launch_id: 'uuid' },
        engine_test: { launch_id: 'uuid' },
        mic_permission: { launch_id: 'uuid' },
        asr_start: { launch_id: 'uuid' },
        other: { foo: 'id' },
      } },
    };
    const { TS } = load({ telemetry, telemetrySpec: spec });
    TS.installLaunchId();
    telemetry.track('asr_entry', { surface: 'app_home' });
    telemetry.track('engine_test', { slot: 'chat' });
    telemetry.track('mic_permission', { kind: 'mic' });
    telemetry.track('asr_start', {});
    telemetry.track('other', { foo: 'bar' });
    const ids = seen.map((e) => e.props.launch_id);
    eq(ids.length, 5);
    ok(ids.slice(0, 4).every((x) => x === TS.launchId()), '四个事件必须是同一个 launch_id');
    ok(seen[4].props.launch_id === undefined, '注册表没有 launch_id 的事件不许被塞');
    ok(seen[0].props.surface === 'app_home', '已有 surface 照旧');
  });
});

describe('BEL-226 pack_download_* / packs_ready', () => {
  test('start / ok / fail 三态共用同一个 setup_id；setup_id 跨启动持久化', async () => {
    const s = store();
    const a = load({ store: s });
    const sid = await a.TS.packStart('listen');
    await a.TS.packOk('live_caption');
    await a.TS.packFail('doc', 'timeout');
    deepEq(a.events.map((e) => e.name), ['pack_download_start', 'pack_download_ok', 'pack_download_fail']);
    eq(a.events[0].props.setup_id, sid);
    eq(a.events[1].props.setup_id, sid);
    eq(a.events[2].props.setup_id, sid);
    eq(a.events[0].props.surface, 'listen');
    eq(a.events[1].props.surface, 'live_caption');
    eq(a.events[2].props.surface, 'doc');
    eq(a.events[2].props.code, 'timeout');
    ok(!('path' in a.events[2].props) && !('file' in a.events[2].props));

    // 模拟下一次冷启：新模块实例、同一份存储 ⇒ 同一个 setup_id（不是 install_id）。
    const b = load({ store: s });
    eq(await b.TS.setupId(), sid);
    await b.TS.packStart('listen');
    eq(b.events[0].props.setup_id, sid);
    ok(sid !== INSTALL, 'setup_id 必须与 install_id 独立');
  });

  test('fail 的 code 只发 id 型；长文/路径不落事件', async () => {
    const { TS, events } = load();
    await TS.packFail('listen', '/Users/me/secret file.zip: boom');
    eq(events[0].props.code, 'download');
    ok(!/Users|secret|zip|boom/.test(JSON.stringify(events[0].props)));
  });

  test('packs_ready 按过渡去重：未齐不发、齐发一次、重复探不发、再变齐可再发', async () => {
    const s = store();
    const ready = { base: { required: 1, ready: 1 }, asr: { required: 2, ready: 2 }, tts: { required: 1, ready: 1 }, all: { required: 4, ready: 4 } };
    const notReady = { base: { required: 1, ready: 0 }, asr: { required: 2, ready: 1 }, tts: { required: 1, ready: 0 }, all: { required: 4, ready: 1 } };
    const a = load({ store: s });
    await a.TS.packsReady(notReady);
    eq(a.events.length, 0, '未齐不是一条 packs_ready');
    await a.TS.packsReady(ready);
    deepEq(a.events.map((e) => e.props.ready_kind), ['base', 'asr', 'tts', 'all']);
    deepEq(a.events.map((e) => e.props.required), [1, 2, 1, 4]);
    deepEq(a.events.map((e) => e.props.ready), [1, 2, 1, 4]);
    const sid = a.events[0].props.setup_id;
    ok(a.events.every((e) => e.props.setup_id === sid), '四个 kind 共用同一个 setup_id');
    const n = a.events.length;
    await a.TS.packsReady(ready);
    await a.TS.packsReady(ready);
    eq(a.events.length, n, '重复探到「齐」不得重复发');

    // 齐 → 不齐（不发）→ 齐（可再发）。
    await a.TS.packsReady(notReady);
    eq(a.events.length, n, '变不齐只更新状态，不发事件');
    await a.TS.packsReady(ready);
    eq(a.events.length, n * 2, '再变齐可再记一轮');

    // 跨冷启：存储里已经记住「齐」，新实例重复探不发。
    const b = load({ store: s });
    await b.TS.packsReady(ready);
    eq(b.events.length, 0, '跨启动仍齐不得再发');
  });

  test('packs_ready 的 required 0 不算一次过渡（不刮空计数）', async () => {
    const { TS, events } = load();
    await TS.packsReady({ base: { required: 0, ready: 0 }, asr: { required: 0, ready: 0 }, tts: { required: 0, ready: 0 }, all: { required: 0, ready: 0 } });
    eq(events.length, 0);
  });
});

// BEL-222 的 opt-out 闸（2026-11-08）：用户关掉遥测后，新事件与第一方 bt-auth-ok
// 必须一起停。这里用**真的** MTTelemetry（extension/learn/telemetry.js）跑，不再用
// 记录调用的假体 —— 假体不会执行 enabled()，测不出开关。
describe('opt-out 闸：新事件与 bt-auth-ok 受同一个开关约束', () => {
  test('关掉开关 → 冷启：track 0 次、fetch 0 次、队列为空', async () => {
    const s = store();
    s['tm:on'] = false;
    const a = loadReal({ store: s });
    await a.TS.appOpen();
    await settle();
    eq(a.trackCalls(), 0, '关掉时连 track() 都不该调');
    eq(a.fetches.length, 0, '关掉时不能有任何网络请求');
    eq((s['tm:queue'] || []).length, 0, '关掉时队列里不能多出 app_open');
  });

  test('关掉开关 → 登录成功：auth_ok 与 bt-auth-ok POST 都是 0 次', async () => {
    const s = store();
    s['tm:on'] = false;
    const a = loadReal({ store: s, backend: { url: 'https://bt.test' } });
    eq(await a.TS.noteAuthOk({ provider: 'google', userId: 'u1', accessToken: 'token-xyz' }), false);
    await settle();
    eq(a.trackCalls(), 0, '关掉时不能发 auth_ok');
    eq(a.fetches.length, 0, '关掉时不能 POST bt-auth-ok');
    eq((s['tm:queue'] || []).length, 0);
    ok(!s['tm:authSeen'], '关掉时连 method 判定都不该写 storage');
  });

  test('开关在调用当时读取：同一实例先开后关，第二次不再发', async () => {
    const s = store();
    const a = loadReal({ store: s, backend: { url: 'https://bt.test' } });
    eq(await a.TS.noteAuthOk({ provider: 'email', userId: 'u1', accessToken: 'token-xyz' }), true);
    await settle();
    eq(a.fetches.length, 1);
    eq(a.trackCalls(), 1);

    s['tm:on'] = false;                       // 设置页这一刻改掉；模块不能缓存旧状态
    eq(await a.TS.noteAuthOk({ provider: 'email', userId: 'u1', accessToken: 'token-xyz' }), false);
    await settle();
    eq(a.fetches.length, 1, '关掉后的第二次登录不许再 POST');
    eq(a.trackCalls(), 1, '关掉后的第二次登录不许再发 auth_ok');
  });

  test('打开开关 → auth_ok 入队、bt-auth-ok POST 都发生', async () => {
    const s = store();
    const a = loadReal({ store: s, backend: { url: 'https://bt.test' } });
    eq(await a.TS.noteAuthOk({ provider: 'google', userId: 'u1', accessToken: 'token-xyz' }), true);
    await settle();
    eq(a.trackCalls(), 1, '打开时 auth_ok 走一次 track()');
    deepEq((s['tm:queue'] || []).map((e) => e.name), ['auth_ok']);
    eq(a.fetches.length, 1);
    eq(a.fetches[0].url, 'https://bt.test/functions/v1/bt-auth-ok');
  });

  test('关掉后队列里已有的事件不再 flush（发送前复查 enabled）', async () => {
    const s = store();
    const a = loadReal({ store: s });
    eq(await a.T.track('heartbeat'), true);
    eq((s['tm:queue'] || []).length, 1);

    s['tm:on'] = false;                       // 队列还在，但开关已关
    eq(await a.T.flush(), false);
    eq(a.fetches.length, 0, '关掉后旧队列也不许发');
    eq((s['tm:queue'] || []).length, 1, '不发也不该丢队列');
  });

  test('关掉开关：七个新事件全部不入队、不发请求', async () => {
    const s = store();
    s['tm:on'] = false;
    const a = loadReal({ store: s });
    await a.TS.appOpen();
    a.TS.liveGate('listen', true);
    a.TS.grantClaimFail('unavailable');
    await a.TS.packStart('listen');
    await a.TS.packOk('live_caption');
    await a.TS.packFail('doc', 'timeout');
    await a.TS.packsReady({ base: { required: 1, ready: 1 }, asr: { required: 1, ready: 1 }, tts: { required: 1, ready: 1 }, all: { required: 3, ready: 3 } });
    await settle();
    eq((s['tm:queue'] || []).length, 0, '关掉时任何新事件都不能入队');
    eq(a.fetches.length, 0, '关掉时不能发任何请求');
  });
});
