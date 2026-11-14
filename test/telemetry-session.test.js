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
  if (o.navigator) sandbox.navigator = o.navigator;
  if (o.AppQuick) sandbox.AppQuick = o.AppQuick;
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
  const signedIn = { currentStable: async () => ({ userId: 'u' }), lastLoadError: () => '' };

  test('一次冷启一条；launch_id 同启动一致；登录墙前的未登录记 login', async () => {
    const { TS, events } = load();
    eq(TS.launchId(), TS.launchId(), '同一次启动的 launch_id 必须一致');
    await TS.appOpen();
    await TS.appOpen();          // 第二次是同一个冷启（bootShell + main.jsx 各一次）
    eq(events.length, 1, '一次冷启只能有一条 app_open');
    eq(events[0].name, 'app_open');
    eq(events[0].props.launch_id, TS.launchId());
    ok(/^[0-9a-f]{32}$/.test(events[0].props.launch_id), 'launch_id 必须是 32 位小写十六进制');
    eq(events[0].props.surface, 'login', 'signed_out 面对登录墙 ⇒ login');
    eq(events[0].props.auth_state, 'signed_out');
    ok(!('entry_kind' in events[0].props), 'entry_kind 没约定 ⇒ 不带');
  });

  test('launch_id 是 32-hex；同一次启动内两条带 launch_id 的事件相同', async () => {
    // 用注册表真规格，让发送口注入走 installLaunchId() 那一步（asr_entry / engine_test 等）。
    const { TS, events, sandbox } = load({ telemetrySpec: TEL_SPEC });
    TS.installLaunchId();
    await TS.appOpen();
    sandbox.MTTelemetry.track('asr_entry', { surface: 'listen', result: 'started' });
    eq(events.length, 2, 'app_open 与 asr_entry 都应入队');
    deepEq(events.map((e) => e.name), ['app_open', 'asr_entry']);
    ok(/^[0-9a-f]{32}$/.test(events[0].props.launch_id), 'app_open.launch_id 必须是 32-hex');
    eq(events[1].props.launch_id, events[0].props.launch_id, '同一次启动内两条事件必须同一个 launch_id');
    eq(events[1].props.launch_id, TS.launchId());
  });

  test('已登录：包屏已完成 ⇒ app_home；首启未完成/没探过包 ⇒ packs', async () => {
    const done = store();
    done['listenPacksDone'] = 1;
    const a = load({ store: done, learnAuth: signedIn });
    await a.TS.appOpen();
    eq(a.events[0].props.auth_state, 'signed_in');
    eq(a.events[0].props.surface, 'app_home', 'packsDone ⇒ app_home');

    // 全新登录：没写过 listenPacksDone、也没有探包快照 ⇒ 首启包屏。
    const first = load({ learnAuth: signedIn });
    await first.TS.appOpen();
    eq(first.events[0].props.surface, 'packs', 'signed_in + 首启包屏未完成 ⇒ packs');

    // 上次探包快照里还有缺包 ⇒ 仍是 packs。
    const waiting = store();
    waiting['tm:packsReady'] = { setup_id: 'setup', kinds: { base: true, asr: false, tts: true, all: false } };
    const b = load({ store: waiting, learnAuth: signedIn });
    await b.TS.appOpen();
    eq(b.events[0].props.surface, 'packs', '快照显示缺包 ⇒ packs');

    // 快照全齐但 packsDone 还没写（升级老用户）⇒ 已就绪，落 app_home。
    const ready = store();
    ready['tm:packsReady'] = { setup_id: 'setup', kinds: { base: true, asr: true, tts: true, all: true } };
    const c = load({ store: ready, learnAuth: signedIn });
    await c.TS.appOpen();
    eq(c.events[0].props.surface, 'app_home', '快照全齐 ⇒ app_home');
  });

  test('unknown ⇒ 不带 surface（不猜）', async () => {
    const b = load({ learnAuth: { currentStable: async () => null, lastLoadError: () => 'storage read failed' } });
    await b.TS.appOpen();
    eq(b.events[0].props.auth_state, 'unknown');
    ok(!('surface' in b.events[0].props), 'unknown 不许带 surface');
  });

  test('quick 面板不属这三屏 ⇒ 不带 surface；app_open 不再发功能面', async () => {
    const qs = store();
    qs['tm:lastSurface'] = 'quick';
    const q = load({ store: qs, learnAuth: signedIn });
    q.TS.enter('quick');
    await q.TS.appOpen();
    ok(!('surface' in q.events[0].props), 'quick 冷启不带 surface');

    // 上次功能面是 doc，但未登录 ⇒ 仍是 login（不再继承 tm:lastSurface）。
    const s = store();
    s['tm:lastSurface'] = 'doc';
    const a = load({ store: s });
    await a.TS.appOpen();
    eq(a.events[0].props.surface, 'login', 'app_open.surface 不再取功能面');
  });

  test('只打开/刷新会话不发 auth_ok，也不写第一方窄口', async () => {
    const s = store();
    const a = loadReal({ store: s });
    await a.TS.appOpen();
    await settle();
    eq(a.fetches.length, 0, 'app_open 不许 POST bt-auth-ok');
    deepEq((s['tm:queue'] || []).map((e) => e.name), ['app_open'], '只有 app_open 入队');
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
    eq(events[0].props.surface, 'login');
    eq(events[0].props.provider, 'google');
    ok(/^[0-9a-f]{32}$/.test(events[0].props.launch_id), 'auth_ok 必须带同一次启动的 launch_id');
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
  test('live_gate：探测成功也记 result=ok；字符串布尔 + ticket 全属性', () => {
    const { TS, events } = load();
    TS.liveGate({
      surface: 'listen', ok: true, bridgeState: 'ok', probeReason: '',
      result: 'ok', osVersion: 'iOS 26.0.1', osMeetsMin: true, probeLocale: 'zh-CN',
      firstRefresh: true, reusedPriorState: false,
    });
    eq(events.length, 1);
    eq(events[0].name, 'live_gate');
    const p = events[0].props;
    eq(p.surface, 'listen');
    eq(p.ok, 'true');
    eq(p.result, 'ok');
    eq(p.window, 'main');
    eq(p.os_version, 'ios_26_0_1', 'os_version 走 id 型：小写、点换成下划线');
    eq(p.os_meets_min, 'true');
    eq(p.probe_locale, 'zh-cn', 'probe_locale 走 id 型');
    eq(p.reason_copy_class, 'other', '成功时没有灰态文案');
    eq(p.first_refresh, 'true');
    eq(p.reused_prior_state, 'false');
    ok(/^[0-9a-f]{32}$/.test(p.launch_id), 'live_gate 必须带同一次启动的 launch_id');
    deepEq(Object.keys(p).sort(), ['first_refresh', 'launch_id', 'ok', 'os_meets_min',
      'os_version', 'probe_locale', 'reason_copy_class', 'result', 'reused_prior_state',
      'surface', 'window'].sort());
  });

  test('live_gate：先桥后探针的 result 映射（每种失败各一条）', () => {
    const cases = [
      [{ bridgeState: 'script_missing' }, 'script_missing', 'need_os'],
      [{ bridgeState: 'channel_missing' }, 'channel_missing', 'need_os'],
      [{ bridgeState: 'ok', probeReason: 'locale' }, 'locale_unsupported', 'switch_locale'],
      [{ bridgeState: 'ok', probeReason: 'timeout' }, 'probe_timeout', 'other'],
      [{ bridgeState: 'ok', probeReason: 'os' }, 'os_below_min', 'need_os'],
    ];
    for (const [input, want, copy] of cases) {
      const { TS, events } = load();
      TS.liveGate(Object.assign({ surface: 'listen', ok: false, firstRefresh: true }, input));
      eq(events[0].props.result, want, JSON.stringify(input));
      eq(events[0].props.ok, 'false', JSON.stringify(input));
      eq(events[0].props.reason_copy_class, copy, JSON.stringify(input));
    }
  });

  test('live_gate：iOS ≥26 而原生只报 os ⇒ no_transcriber（UA 只读主版本）', () => {
    const { TS, events } = load({
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)' },
    });
    TS.liveGate({ surface: 'listen', ok: false, bridgeState: 'ok', probeReason: 'os', firstRefresh: true });
    eq(events[0].props.result, 'no_transcriber');
    eq(events[0].props.os_version, 'ios_26_1');
    eq(events[0].props.os_meets_min, 'true', 'no_transcriber 的前提是系统够新');
  });

  test('live_gate：复用上次结论 / 第二次刷新 都记成字符串布尔', () => {
    const { TS, events } = load();
    TS.liveGate({ surface: 'live_caption', ok: true, result: 'ok', firstRefresh: false, reusedPriorState: true });
    eq(events[0].props.first_refresh, 'false');
    eq(events[0].props.reused_prior_state, 'true');
    eq(events[0].props.surface, 'live_caption');
  });

  test('live_gate：Mac 快译第二窗不走首页闸，一条都不发', () => {
    const a = load({ AppQuick: { isQuickMode: () => true } });
    a.TS.liveGate({ surface: 'quick', ok: true, result: 'ok', firstRefresh: true });
    eq(a.events.length, 0);
    eq(a.TS.windowKind(), 'quick');
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

  test('grant_claim_fail 的真实 reason / copy_class / path（旧 code 同发）', () => {
    const cases = [
      [{ code: 'offline' }, 'silent', 'network', 'retryable'],
      [{ code: 'busy' }, 'silent', 'busy', 'retryable'],
      [{ code: 'server', status: 503 }, 'manual', 'server', 'retryable'],
      [{ code: 'signed_out' }, 'manual', 'revoked', 'revoked'],
      [{ code: 'grant_revoked', status: 401 }, 'silent', 'revoked', 'revoked'],
      [{ code: 'grant_unavailable', status: 503 }, 'silent', 'server', 'retryable'],
      [{ code: 'grant_misconfigured' }, 'silent', 'server', 'retryable'],
      [{ code: 'exhausted' }, 'silent', 'other', 'retryable'],
    ];
    for (const [err, path, reason, copy] of cases) {
      const { TS, events } = load();
      TS.grantClaimFail(err, path);
      eq(events[0].props.reason, reason, JSON.stringify(err));
      eq(events[0].props.copy_class, copy, JSON.stringify(err));
      eq(events[0].props.path, path, JSON.stringify(err));
      eq(events[0].props.surface, 'listen');
      ok(typeof events[0].props.code === 'string' && events[0].props.code, '旧 code 必须同发');
    }
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

// BEL-226 的新形状：一套完整所需资源（base 拆成 lid+vad；asr 按语言；tts 按共享包）。
function packState(over) {
  const base = {
    items: [
      { id: 'lid', kind: 'lid' },
      { id: 'vad', kind: 'vad' },
      { id: 'asr_zh', kind: 'asr', locale: 'zh' },
      { id: 'tts_zh_en', kind: 'tts', locale: 'zh-en' },
    ],
    surface: 'first_run_packs',
    base: { required: 1, ready: 1 },
    asr: { required: 1, ready: 1 },
    tts: { required: 1, ready: 1 },
    all: { required: 3, ready: 3 },
  };
  return Object.assign(base, over || {});
}
const PACK_UNITS = [
  { pack_kind: 'lid', pack_id: 'lid', source: 'other' },
  { pack_kind: 'vad', pack_id: 'vad', source: 'other' },
  { pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', source: 'system' },
  { pack_kind: 'tts', pack_id: 'tts_zh_en', locale: 'zh-en', source: 'modelscope' },
];

describe('BEL-226 pack_download_* / packs_ready', () => {
  test('每个下载单元 start → ok：同一个 download_id / setup_id / launch_id，旧字段仍在', async () => {
    const a = load();
    for (const u of PACK_UNITS) {
      const tok = await a.TS.packStart(Object.assign({ surface: 'first_run_packs' }, u));
      ok(tok && /^[0-9a-f]{32}$/.test(tok.download_id), 'download_id 必须是 32-hex');
      await a.TS.packOk(tok);
    }
    deepEq(a.events.map((e) => e.name).filter((n) => n === 'pack_download_start').length, 4);
    deepEq(a.events.map((e) => e.name).filter((n) => n === 'pack_download_ok').length, 4);
    const sid = a.events[0].props.setup_id;
    ok(/^[0-9a-f]{32}$/.test(sid), 'setup_id 必须是 32-hex');
    for (let i = 0; i < 4; i++) {
      const st = a.events[i * 2].props;
      const okp = a.events[i * 2 + 1].props;
      eq(st.pack_kind, PACK_UNITS[i].pack_kind);
      eq(st.pack_id, PACK_UNITS[i].pack_id);
      eq(st.download_id, okp.download_id, 'ok 必须与 start 共用 download_id');
      eq(okp.setup_id, sid);
      eq(st.launch_id, okp.launch_id);
      ok(/^[0-9a-f]{32}$/.test(st.launch_id), 'launch_id 必须是 32-hex');
      eq(st.attempt, 1);
      eq(st.surface, 'first_run_packs');
      eq(st.source, PACK_UNITS[i].source);
      if (PACK_UNITS[i].locale) eq(st.locale, PACK_UNITS[i].locale);
      ok(!/Users|secret|https?:\/\//.test(JSON.stringify(st)), '事件里不许出现路径/URL');
    }
  });

  test('setup_id 跨启动不变；packs_ready 与 pack_download_start 共用它', async () => {
    const s = store();
    const a = load({ store: s });
    await a.TS.packStart({ pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', surface: 'first_run_packs', source: 'system' });
    const sid = a.events[0].props.setup_id;
    await a.TS.packsReady(packState());
    eq(a.events[1].props.setup_id, sid);

    const b = load({ store: s });
    eq(await b.TS.setupId(), sid);
    await b.TS.packStart({ pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', surface: 'first_run_packs', source: 'system' });
    eq(b.events[0].props.setup_id, sid, '跨启动的 pack_download_start 不能换 setup_id');
    ok(sid !== INSTALL, 'setup_id 必须与 install_id 独立');
  });

  test('attempt：同一 setup 内按 pack_id 递增，跨启动继续；不同 pack 各自从 1 开始', async () => {
    const s = store();
    const a = load({ store: s });
    const t1 = await a.TS.packStart({ pack_kind: 'tts', pack_id: 'tts_th', surface: 'first_run_packs', source: 'other' });
    const t2 = await a.TS.packStart({ pack_kind: 'tts', pack_id: 'tts_th', surface: 'first_run_packs', source: 'other' });
    const t3 = await a.TS.packStart({ pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', surface: 'first_run_packs', source: 'system' });
    eq(t1.attempt, 1);
    eq(t2.attempt, 2);
    eq(t3.attempt, 1);
    const b = load({ store: s });
    const t4 = await b.TS.packStart({ pack_kind: 'tts', pack_id: 'tts_th', surface: 'first_run_packs', source: 'other' });
    eq(t4.attempt, 3, '上次断在第 2 次，这次打开必须接着数第 3 次');
  });

  test('失败 reason 六值归一；旧 code 照发；原始报错/路径不落事件', async () => {
    const cases = [
      [{ reason: 'offline' }, 'network'],
      [{ reason: 'sha' }, 'hash'],
      [{ reason: 'timeout' }, 'timeout'],
      [{ reason: 'disk' }, 'disk'],
      [{ reason: 'no-bridge' }, 'unsupported'],
      [{ reason: 'load' }, 'other'],
    ];
    for (const [err, want] of cases) eq(load().TS.packFailReason(err), want, JSON.stringify(err));

    const { TS, events } = load();
    const tok = await TS.packStart({ pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', surface: 'first_run_packs', source: 'system' });
    await TS.packFail(tok, { reason: 'offline' }, '/Users/me/secret file.zip: boom');
    eq(events[1].name, 'pack_download_fail');
    eq(events[1].props.reason, 'network');
    eq(events[1].props.code, 'network', '旧 code 只接受原样 id 型；长文/路径不许洗白后落库');
    ok(/^[a-z0-9_-]{1,32}$/.test(events[1].props.code), '旧 code 必须是 id 型');
    eq(events[1].props.download_id, events[0].props.download_id, 'fail 与 start 共用 download_id');
    ok(!/Users|secret|zip|boom|https?:\/\//.test(JSON.stringify(events[1].props)));
    eq(events.length, 2, '失败只发一条 fail（不再补一条整批的）');
  });

  test('packs_ready 只在整套齐时发一次；重复探/跨启动不发；再变齐可再发', async () => {
    const s = store();
    const ready = packState();
    const notReady = packState({ asr: { required: 1, ready: 0 }, all: { required: 3, ready: 2 } });
    const a = load({ store: s });
    await a.TS.packsReady(notReady);
    eq(a.events.length, 0, '未齐不是一条 packs_ready');
    await a.TS.packsReady(ready);
    eq(a.events.length, 1, '整套齐只发一条（不是 base/asr/tts/all 四条）');
    const p = a.events[0].props;
    eq(p.ready_kind, 'preexisting', '一个都没新下 ⇒ preexisting');
    eq(p.surface, 'first_run_packs');
    ok(/^[0-9a-f]{32}$/.test(p.selection_id), 'selection_id 必须 32-hex');
    ok(/^[0-9a-f]{32}$/.test(p.launch_id));
    eq(p.asr_required, 1); eq(p.asr_ready, 1);
    eq(p.tts_required, 1); eq(p.tts_ready, 1);
    eq(p.base_ready, 'true');
    eq(p.required_count, 3); eq(p.ready_count, 3);
    eq(p.required, 3); eq(p.ready, 3);
    await a.TS.packsReady(ready);
    eq(a.events.length, 1, '重复探到「齐」不得重复发');

    await a.TS.packsReady(notReady);
    eq(a.events.length, 1, '变不齐只更新状态，不发事件');
    await a.TS.packsReady(ready);
    eq(a.events.length, 2, '再变齐可再记一轮');

    const b = load({ store: s });
    await b.TS.packsReady(ready);
    eq(b.events.length, 0, '跨启动仍齐不得再发');
  });

  test('selection_id 随所需集合变化而换新；新集合齐了可再发一条', async () => {
    const a = load();
    await a.TS.packsReady(packState());
    const sel1 = a.events[0].props.selection_id;
    const changed = packState({
      items: [
        { id: 'lid', kind: 'lid' }, { id: 'vad', kind: 'vad' },
        { id: 'asr_th', kind: 'asr', locale: 'th' },
        { id: 'tts_th', kind: 'tts', locale: 'th' },
      ],
    });
    await a.TS.packsReady(changed);
    eq(a.events.length, 2, '换了一套所需资源并已齐 ⇒ 新 selection 应再记一条');
    ok(a.events[1].props.selection_id !== sel1, '所需集合变了 selection_id 必须换新');
  });

  test('ready_kind 三分：downloaded / preexisting / mixed', async () => {
    for (const [label, dbg, want] of [['preexisting', 0, 'preexisting'], ['mixed', 1, 'mixed'], ['downloaded', 4, 'downloaded']]) {
      const a = load();
      for (let i = 0; i < dbg; i++) {
        const u = PACK_UNITS[i];
        const tok = await a.TS.packStart(Object.assign({ surface: 'first_run_packs' }, u));
        await a.TS.packOk(tok);
      }
      await a.TS.packsReady(packState());
      const ev = a.events.filter((e) => e.name === 'packs_ready');
      eq(ev.length, 1, label + '：应发一条 packs_ready');
      eq(ev[0].props.ready_kind, want, label + '：ready_kind 判错');
    }
  });

  test('ASR 不支持：只发 fail{unsupported}，不发 start / ok（不当下载成功）', async () => {
    const a = load();
    await a.TS.packUnsupported({ pack_kind: 'asr', pack_id: 'asr_xx', locale: 'xx', surface: 'first_run_packs', source: 'system' });
    deepEq(a.events.map((e) => e.name), ['pack_download_fail']);
    eq(a.events[0].props.reason, 'unsupported');
    eq(a.events[0].props.pack_kind, 'asr');
    ok(/^[0-9a-f]{32}$/.test(a.events[0].props.download_id));
  });

  test('真 shape() 不再丢事件：新字段（pack_kind/pack_id/locale/download_id/source/attempt/selection_id）全部入队', async () => {
    const s = store();
    const a = loadReal({ store: s });
    await a.TS.appOpen();
    const tok = await a.TS.packStart({
      pack_kind: 'tts', pack_id: 'tts_zh_en', locale: 'zh-en', surface: 'first_run_packs', source: 'modelscope',
    });
    await a.TS.packOk(tok);
    await a.TS.packsReady(packState());
    await settle();
    const q = s['tm:queue'] || [];
    deepEq(q.map((e) => e.name).sort(), ['app_open', 'pack_download_ok', 'pack_download_start', 'packs_ready'].sort());
    for (const e of q) {
      if (e.name === 'packs_ready') ok(/^[0-9a-f]{32}$/.test(e.props.selection_id), 'selection_id 必须过 shape()');
      if (e.name.indexOf('pack_download') === 0) {
        ok(/^[0-9a-f]{32}$/.test(e.props.download_id), e.name + '.download_id 必须过 id 规则');
        ok(/^[a-z0-9_-]{1,32}$/.test(e.props.pack_id), e.name + '.pack_id 必须过 id 规则');
        ok(e.props.locale === undefined || /^[a-z0-9_-]{1,32}$/.test(e.props.locale), e.name + '.locale 必须过 id 规则');
      }
    }
  });

  test('shell-model 接线：每个下载单元 start→ok、ASR 不支持另记 fail、ok 不在 onProg 里', () => {
    const model = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    // base 拆成 VAD / LID 两个真实下载单元。
    ok(/pack_kind:\s*'vad'[\s\S]{0,120}NativeSpeech\.ensureVad\(vad, onProg\)/.test(model),
      'VAD 下载没有自己的 pack_download_start/ok');
    ok(/pack_kind:\s*'lid'[\s\S]{0,450}ModelSources\.run\(\[lid\]/.test(model),
      'LID 下载没有自己的 pack_download_start/ok');
    // 朗读按共享包 / 泰语两个单元逐次 ensureDeviceReady。
    ok(/pack_id:\s*'tts_zh_en'/.test(model) && /pack_id:\s*'tts_th'/.test(model),
      '朗读包没有按 tts_zh_en / tts_th 两个显式共享 id 发事件');
    ok(/pack_kind:\s*'asr'[\s\S]{0,600}NativeSpeech\.ensureAssets\('stt'/.test(model),
      'ASR 下载没有自己的 pack_download_start/ok');
    ok(/packAsrUnsupported[\s\S]{0,300}packUnsupported\(\{/.test(model),
      'ASR 系统不支持时没有另记 fail{unsupported}');
    ok(/function packReadinessCounts[\s\S]{0,900}packAsrUnsupported[\s\S]{0,120}\?\s*0/.test(model),
      'packs_ready 把 ASR 不支持算成了 ready —— 不得标成下载成功');
    // ok 只能在 await 下载之后发；onProg 里不许出现 packOk（进度 100% 不算成功）。
    const onProg = model.slice(model.indexOf('const onProg = (m) => {'), model.indexOf('const r = await LearnTTS.ensureDeviceReady'));
    ok(!/packOk\(/.test(onProg), 'onProg 里发了 pack_download_ok —— 进度不是安装/校验通过');
  });
});

// BEL-227 防御：track() 入口等 spec 就位（最多 200ms，10ms 一查）。
// spec 缺失时 MTTelemetry 的 shape() 会把整条事件判 null —— 这里证明后到的 spec
// 也能接住，同时不把「等不到」变成抛错/入队，也不绕过 opt-out。
describe('spec 等就位：track() 入口的 200ms 缓冲', () => {
  test('spec 立即就位 → 事件仍同步入队（与改动前一致）', () => {
    const { TS, events } = load();
    TS.liveGate({ surface: 'listen', ok: true, result: 'ok', firstRefresh: true });
    eq(events.length, 1, 'spec 在时不许被缓冲改成异步');
    eq(events[0].name, 'live_gate');
    eq(events[0].props.surface, 'listen');
    eq(events[0].props.ok, 'true');
    eq(events[0].props.result, 'ok');
  });

  test('spec 延迟 50ms 就位 → 200ms 内入队', async () => {
    const { TS, events, sandbox } = load({ telemetrySpec: null });
    const t0 = Date.now();
    TS.liveGate({ surface: 'listen', ok: true, result: 'ok', firstRefresh: true });
    eq(events.length, 0, 'spec 未到不能提前入队');
    await new Promise((r) => setTimeout(r, 50));
    eq(events.length, 0, '50ms 时 spec 尚未就位');
    sandbox.window.MT_TELEMETRY = TEL_SPEC;
    const got = await waitUntil(() => events.length === 1, 140);
    const dt = Date.now() - t0;
    ok(got, 'spec 就位后 200ms 内必须入队');
    ok(dt <= 200, '从调用到入队必须 ≤200ms，实际 ' + dt + 'ms');
    eq(events[0].name, 'live_gate');
    eq(events[0].props.surface, 'listen');
    eq(events[0].props.ok, 'true');
    eq(events[0].props.result, 'ok', '不改事件名/结果');
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
    a.TS.liveGate({ surface: 'listen', ok: true, result: 'ok', firstRefresh: true });
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
