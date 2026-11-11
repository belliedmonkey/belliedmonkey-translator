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
  const window = o.window || {};
  // 默认给一份规格：本组测的是事件正文/返回值，不是「spec 未到」。要测等 spec 的
  // 三条新用例显式传 telemetrySpec:null，再按需要把 window.MT_TELEMETRY 补上。
  if (!('MT_TELEMETRY' in window) && o.telemetrySpec !== null) {
    window.MT_TELEMETRY = o.telemetrySpec || TEL_SPEC;
  }
  const sandbox = {
    console: { debug() {}, log: console.log, error: console.error },
    window,
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
  };
  if (o.telemetrySpec !== null) window.MT_TELEMETRY = o.telemetrySpec || TEL_SPEC;
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
  return { TS: ctx.TelemetrySession, T, store: s, fetches, sandbox, trackCalls: () => trackCalls };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
// 等到条件成立或超时；返回是否等到。用于「spec 延迟就位」这类真实计时用例。
async function waitUntil(fn, ms) {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

describe('BEL-225 app_open', () => {
  test('一次冷启一条；launch_id 同启动一致；登录墙前的未登录也能发', async () => {
    const { TS, events } = load();
    eq(TS.launchId(), TS.launchId(), '同一次启动的 launch_id 必须一致');
    await TS.appOpen();
    await TS.appOpen();          // 第二次是同一个冷启（bootShell + main.jsx 各一次）
    eq(events.length, 1, '一次冷启只能有一条 app_open');
    eq(events[0].name, 'app_open');
    eq(events[0].props.launch_id, TS.launchId());
    ok(/^[0-9a-f]{32}$/.test(events[0].props.launch_id), 'launch_id 必须是 32 位小写十六进制');
    eq(events[0].props.surface, 'listen', '没有上次面时按首页默认面 listen');
    eq(events[0].props.auth_state, 'signed_out');
    ok(!('entry_kind' in events[0].props), 'entry_kind 没约定 ⇒ 不带');
  });

  test('launch_id 是 32-hex；同一次启动内两条带 launch_id 的事件相同', async () => {
    // 用注册表真规格，让发送口注入走 installLaunchId() 那一步（asr_entry / engine_test 等）。
    const { TS, events, sandbox } = load({ telemetrySpec: TEL_SPEC });
    TS.installLaunchId();
    await TS.appOpen();
    sandbox.MTTelemetry.track('asr_entry', { surface: 'app_home', result: 'started' });
    eq(events.length, 2, 'app_open 与 asr_entry 都应入队');
    deepEq(events.map((e) => e.name), ['app_open', 'asr_entry']);
    ok(/^[0-9a-f]{32}$/.test(events[0].props.launch_id), 'app_open.launch_id 必须是 32-hex');
    eq(events[1].props.launch_id, events[0].props.launch_id, '同一次启动内两条事件必须同一个 launch_id');
    eq(events[1].props.launch_id, TS.launchId());
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
        asr_entry: { launch_id: 'id' },
        engine_test: { launch_id: 'id' },
        mic_permission: { launch_id: 'id' },
        asr_start: { launch_id: 'id' },
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
    ok(/^[0-9a-f]{32}$/.test(sid), 'setup_id 必须是 32 位小写十六进制');
  });

  test('setup_id 是 32-hex；packs_ready / pack_download_start 跨两次「启动」不变', async () => {
    const s = store();
    const a = load({ store: s });
    // 先由 packs_ready 生成 setup_id，再让 pack_download_start 共用它。
    await a.TS.packsReady({ base: { required: 1, ready: 1 } });
    eq(a.events.length, 1);
    const sid = a.events[0].props.setup_id;
    ok(/^[0-9a-f]{32}$/.test(sid), 'packs_ready.setup_id 必须是 32-hex');
    await a.TS.packStart('listen');
    eq(a.events[1].props.setup_id, sid, 'pack_download_start 必须与 packs_ready 用同一个 setup_id');

    // 模拟第二次启动：新模块实例、同一份存储（不调 _resetForTest，模块常量会重新求值）。
    const b = load({ store: s });
    await b.TS.packStart('listen');
    await b.TS.packsReady({ asr: { required: 1, ready: 1 } });
    deepEq(b.events.map((e) => e.name), ['pack_download_start', 'packs_ready']);
    eq(b.events[0].props.setup_id, sid, '跨启动 pack_download_start 的 setup_id 不能变');
    eq(b.events[1].props.setup_id, sid, '跨启动 packs_ready 的 setup_id 不能变');
  });

  test('旧 uuid 的 tm:setupId 迁移成 32-hex 并写回；之后跨启动保持稳定', async () => {
    const s = store();
    s['tm:setupId'] = SETUP;                  // 旧版本落盘的带连字符 uuid
    const want = SETUP.replace(/-/g, '');
    const a = load({ store: s });
    eq(await a.TS.setupId(), want, '旧 uuid 去连字符 = 同一个标识的 32-hex');
    eq(s['tm:setupId'], want, '迁移结果必须一次性写回，不能每次启动都换');

    const b = load({ store: s });
    eq(await b.TS.setupId(), want, '下一次启动读到的是迁移后的值');
    await b.TS.packStart('listen');
    eq(b.events[0].props.setup_id, want);
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

  test('真 shape() 不再丢事件：app_open / pack_download_start / packs_ready 全部入队', async () => {
    // 这条用 extension/learn/telemetry.js 的**真** shape()/okValue()（只读、不改扩展）：
    // 旧规则 'uuid' 不在客户端 okValue 的白名单里，带连字符的 36 字符值也过不了 id 规则，整条不入队；这里钉住 'id' + 32-hex 能过。
    const s = store();
    const a = loadReal({ store: s });
    await a.TS.appOpen();
    await a.TS.packStart('listen');
    await a.TS.packsReady({ base: { required: 1, ready: 1 } });
    await settle();
    const q = s['tm:queue'] || [];
    deepEq(q.map((e) => e.name).sort(), ['app_open', 'pack_download_start', 'packs_ready'].sort());
    for (const e of q) {
      if (e.name === 'app_open') ok(/^[0-9a-f]{32}$/.test(e.props.launch_id), 'app_open.launch_id 必须过 shape()');
      else ok(/^[0-9a-f]{32}$/.test(e.props.setup_id), e.name + '.setup_id 必须过 shape()');
    }
  });
});

// BEL-227 防御：track() 入口等 spec 就位（最多 200ms，10ms 一查）。
// spec 缺失时 MTTelemetry 的 shape() 会把整条事件判 null —— 这里证明后到的 spec
// 也能接住，同时不把「等不到」变成抛错/入队，也不绕过 opt-out。
describe('spec 等就位：track() 入口的 200ms 缓冲', () => {
  test('spec 立即就位 → 事件仍同步入队（与改动前一致）', () => {
    const { TS, events } = load();
    TS.liveGate('listen', true);
    eq(events.length, 1, 'spec 在时不许被缓冲改成异步');
    eq(events[0].name, 'live_gate');
    deepEq(events[0].props, { surface: 'listen', ok: 'true' });
  });

  test('spec 延迟 50ms 就位 → 200ms 内入队', async () => {
    const { TS, events, sandbox } = load({ telemetrySpec: null });
    const t0 = Date.now();
    TS.liveGate('listen', true);
    eq(events.length, 0, 'spec 未到不能提前入队');
    await new Promise((r) => setTimeout(r, 50));
    eq(events.length, 0, '50ms 时 spec 尚未就位');
    sandbox.window.MT_TELEMETRY = TEL_SPEC;
    const got = await waitUntil(() => events.length === 1, 140);
    const dt = Date.now() - t0;
    ok(got, 'spec 就位后 200ms 内必须入队');
    ok(dt <= 200, '从调用到入队必须 ≤200ms，实际 ' + dt + 'ms');
    eq(events[0].name, 'live_gate');
    deepEq(events[0].props, { surface: 'listen', ok: 'true' }, '不改事件名/属性');
  });

  test('spec 始终缺失 → 200ms 后放弃：不入队、不抛错', async () => {
    const { TS, events } = load({ telemetrySpec: null });
    const t0 = Date.now();
    const ret = TS._track('live_gate', { surface: 'listen', ok: 'true' });
    ok(ret && typeof ret.then === 'function', 'spec 未到时 track() 返回可等待的 Promise');
    eq(await ret, false, '等不到 spec 时 track() 返回 false');
    const dt = Date.now() - t0;
    ok(dt >= 190, '至少要等满 200ms 的窗口，实际 ' + dt + 'ms');
    ok(dt < 1000, '不能无限等，实际 ' + dt + 'ms');
    eq(events.length, 0, 'spec 始终缺失不能入队');
  });

  test('spec 延迟期间 opt-out 仍生效：enabled=false 时不入队', async () => {
    const s = store();
    s['tm:on'] = false;
    const a = loadReal({ store: s, telemetrySpec: null });
    const p = a.TS._track('live_gate', { surface: 'listen', ok: 'true' });
    setTimeout(() => { a.sandbox.window.MT_TELEMETRY = TEL_SPEC; }, 50);
    eq(await p, false, '开关关着时 track() 返回 false');
    await settle();
    eq((s['tm:queue'] || []).length, 0, '关掉时即使 spec 后到也不能入队');
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

// 2026-11-08（BEL-222/225/226 后续；BEL-228 校验器补全）：launch_id / setup_id 是 32-hex `id`，
// **不是** uuid —— app_open.launch_id、pack_download_*.setup_id、packs_ready.setup_id 都走 `id`
// 规则，能过 shape()。本块只测 `_okValue` 新增的 uuid/iso/semver/lang 四条规则，不测任何
// 不存在的 uuid 事件；这里用**真的** MTTelemetry（loadReal），不再让假 telemetry 遮住 shape。
describe('okValue — uuid/iso/semver/lang 与服务端 bt-ingest 同规则', () => {
  const UUID = '11111111-1111-4111-8111-111111111111';

  test('uuid 逐字照抄服务端正则（版本 1–8、variant 8/9/a/b、大小写不敏感）', () => {
    const { T } = loadReal();
    eq(T._okValue('uuid', UUID), true);
    eq(T._okValue('uuid', UUID.toUpperCase()), true, '服务端 /i，大小写都收');
    eq(T._okValue('uuid', '11111111-1111-0111-8111-111111111111'), false, '版本位 0 服务端不收');
    eq(T._okValue('uuid', '11111111-1111-4111-7111-111111111111'), false, 'variant 位 7 服务端不收');
    eq(T._okValue('uuid', '00000000-0000-0000-0000-000000000000'), false, 'nil uuid 不是合法 v4');
  });

  test('iso / semver / lang 与服务端同规则（iso 不含 ±7 天窗口）', () => {
    const { T } = loadReal();
    eq(T._okValue('iso', '2026-11-08T12:00:00Z'), true);
    eq(T._okValue('iso', '2026-11-08T12:00:00+08:00'), true);
    eq(T._okValue('iso', 'not-a-date'), false);
    eq(T._okValue('semver', '1.23.3'), true);
    eq(T._okValue('semver', '1.23'), false);
    eq(T._okValue('semver', '1.2.3.4'), false);
    eq(T._okValue('lang', 'zh'), true);
    eq(T._okValue('lang', ''), true, '服务端显式允许空串（ui 可能为空）');
    eq(T._okValue('lang', 'zh-CN'), false);
  });

  test('app_open 带合法 launch_id ⇒ 入队，且出现在后端请求体', async () => {
    const a = loadReal();
    await a.TS.appOpen();
    await settle();
    const q = a.store['tm:queue'] || [];
    eq(q.length, 1, 'app_open 必须入队，不能被 shape() 丢掉');
    eq(q[0].name, 'app_open');
    eq(q[0].props.launch_id, a.TS.launchId());

    eq(await a.T.flush(), true);
    eq(a.fetches.length, 1);
    const body = JSON.parse(a.fetches[0].init.body);
    eq(body.length, 1);
    eq(body[0].name, 'app_open');
    eq(body[0].props.launch_id, a.TS.launchId(), '请求体里必须能看到该 launch_id');
    ok(a.T._okValue(cfg.COMMON.install_id, body[0].install_id), '信封 install_id 也过 uuid');
  });

  test('pack_download_start / packs_ready 带 setup_id ⇒ 同样入队并出现在请求体', async () => {
    const a = loadReal();
    const sid = await a.TS.packStart('listen');
    await settle();
    await a.TS.packsReady({
      base: { required: 1, ready: 1 }, asr: { required: 2, ready: 2 },
      tts: { required: 1, ready: 1 }, all: { required: 4, ready: 4 },
    });
    await settle();

    const q = a.store['tm:queue'] || [];
    eq(q.length, 5, '1 条 pack_download_start + 4 条 packs_ready');
    eq(q[0].name, 'pack_download_start');
    eq(q[0].props.setup_id, sid);
    ok(q.slice(1).every((e) => e.name === 'packs_ready' && e.props.setup_id === sid),
      'packs_ready 每条都要带同一个 setup_id');

    eq(await a.T.flush(), true);
    const body = JSON.parse(a.fetches[0].init.body);
    eq(body.length, 5);
    eq(body[0].name, 'pack_download_start');
    eq(body[0].props.setup_id, sid);
    deepEq(body.slice(1).map((e) => e.name), ['packs_ready', 'packs_ready', 'packs_ready', 'packs_ready']);
    ok(body.slice(1).every((e) => e.props.setup_id === sid), '请求体里的 setup_id 不能被改写');
  });

  test('非法 uuid 被 _okValue 拒；http、@ 护栏没有放宽', async () => {
    const a = loadReal();
    eq(a.T._okValue('uuid', 'x'), false, 'x 不是 uuid');
    for (const bad of ['http://example.com/a', 'a@b']) {
      eq(a.T._shape('app_open', { launch_id: bad }), null, bad + ' 不该过 shape()');
      eq(await a.T.track('app_open', { launch_id: bad }), false, bad + ' 不该入队');
    }
    eq((a.store['tm:queue'] || []).length, 0);
  });

  test('COMMON 的 ts / v / ui 仍能过；它们不走 shape()，由 envelope 生成后由服务端校验', async () => {
    // shape() 只遍历 props；COMMON 的 ts/v/ui 是 envelope() 在 flush 时加的。
    // 这里两头都钉：① 客户端 okValue 认得这三种规则；② 真发出去的值确实合法。
    const a = loadReal();
    const { T } = a;
    eq(T._okValue(cfg.COMMON.ts, '2026-11-08T12:00:00Z'), true);
    eq(T._okValue(cfg.COMMON.v, '1.23.3'), true);
    eq(T._okValue(cfg.COMMON.ui, 'en'), true);

    await a.TS.appOpen();
    await settle();
    eq(await a.T.flush(), true);
    const env = JSON.parse(a.fetches[0].init.body)[0];
    for (const k of ['ts', 'v', 'ui']) eq(T._okValue(cfg.COMMON[k], env[k]), true, k + '=' + env[k]);
  });
});
