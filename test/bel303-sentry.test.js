// test/bel303-sentry.test.js — BEL-303 P0 JS crash + P1 intl edge acceptance.
//
// Eight checks from arch RESULT §5, kept executable:
//   1. sentry.io host is red in the China gate; bare `sentry` / `.invalid` are not
//   2. China artifact block has no DSN / sentry.io; planting one fails the gate
//   3. src/lib/crash.js source has no /sentry\.io/ literal
//   4. forged sender.id never forwards
//   5. business codes (402 / no_base / timeout / credit_exhausted / http /
//      translate_fail) and unknown reasons never capture
//   6. unknown keys + illegal enums still ingest (hosted test), Sentry gets nothing
//   7. beforeSend fixture has no plaintext / token / query / Authorization / IP / raw URL
//   8. empty DSN ⇒ init does zero network
//
// Tests 6's ingest side lives in the hosted repo (tests/sentry-unexpected.test.js);
// this file asserts the client-side half that makes it impossible for the crash path
// to be invoked for those responses.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq, loadModule } = require('./harness');
const G = require('../build/china-gate.js');

const deepKeys = (o, keys) => { const got = Object.keys(o).sort(); const want = keys.slice().sort(); eq(JSON.stringify(got), JSON.stringify(want), 'payload 键面不对：' + JSON.stringify(got)); };
const ROOT = path.join(__dirname, '..');
const CRASH_SRC = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'crash.js'), 'utf8');

function loadCrash(opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const captured = [];
  const inits = [];
  const listeners = {};
  let network = 0;
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    crypto: require('crypto').webcrypto,
    location: { protocol: opts.protocol || 'file:' },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    chrome: {
      storage: {
        local: {
          get: (keys, cb) => {
            const out = {};
            for (const k of (Array.isArray(keys) ? keys : [keys])) out[k] = store[k];
            cb(out);
          },
          set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
          remove: (keys, cb) => { for (const k of keys) delete store[k]; if (cb) cb(); },
        },
      },
    },
    Sentry: {
      init: (cfg) => { inits.push(cfg); if (opts.networkOnInit) network += 1; },
      captureEvent: (event) => { captured.push(event); return 'evt'; },
      captureException: () => 'evt',
    },
  };
  if (opts.mtHost !== undefined) sandbox.MT_HOST = opts.mtHost;
  if (opts.mtTelemetry) sandbox.MTTelemetry = opts.mtTelemetry;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(opts.source || CRASH_SRC, ctx, { filename: 'src/lib/crash.js' });
  if (opts.autoInit) ctx.MTCrash.init({ host: opts.host || 'app' });
  return { M: ctx.MTCrash, store, captured, inits, listeners, network: () => network };
}


function loadForward(opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const listeners = {};
  const sent = [];
  const fetched = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    location: { protocol: 'https:' },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fetch: (...a) => { fetched.push(a); return Promise.resolve({ ok: true }); },
    chrome: {
      storage: { local: {
        get: (keys, cb) => { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) o[k] = store[k]; cb(o); },
        set: (o, cb) => { Object.assign(store, o); if (cb) cb(); },
      } },
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          sent.push(msg);
          if (opts.throwSend) throw new Error('SW undefined');
          if (opts.failSend) { cb && cb({ ok: false }); return undefined; }
          cb && cb({ ok: true });
          return undefined;
        },
      },
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'crash-forward.js'), 'utf8'), ctx, { filename: 'src/lib/crash-forward.js' });
  return { F: ctx.MTCrashForward, store, listeners, sent, fetched };
}

function loadBackground() {
  const listeners = [];
  const reports = [];
  const flushes = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    AbortController,
    chrome: {
      runtime: {
        id: 'ext-test-id',
        lastError: null,
        getURL: (p) => 'chrome-extension://ext-test-id/' + (p || ''),
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
      storage: { local: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    },
    fetch: async () => ({ ok: true, json: async () => ({ ingest: [] }) }),
    MTCrash: {
      init: () => true,
      flushRing: () => { flushes.push(1); return Promise.resolve(0); },
      report: (payload, source) => { reports.push({ payload, source }); return Promise.resolve(true); },
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  return { listeners, reports, flushes };
}

function sendBackground(listeners, msg, sender) {
  return new Promise((resolve) => {
    for (const fn of listeners) {
      let answered = false;
      const ret = fn(msg, sender, (r) => { answered = true; resolve(r); });
      if (ret === true || answered) return;
    }
    resolve(undefined);
  });
}

describe('BEL-303（1）China gate：US_INGEST sentry.io host', () => {
  const scan = (text) => G.scan([{ name: 'x.js', text }]);
  test('任何路径的 sentry.io 主机都红', () => {
    for (const p of ['/1', '/api/1/envelope/', '/anything?x=1']) {
      ok(scan(`u = "https://o.ingest.us.sentry.io${p}"`).length === 1, `sentry.io 漏了：${p}`);
      ok(scan(`u = "https://x.sentry.io${p}"`).length === 1, `子域 sentry.io 漏了：${p}`);
    }
  });
  test('裸词 sentry / .invalid 占位 不红', () => {
    ok(scan('const sentry = 1;').length === 0, '裸词 sentry 被误拦');
    ok(scan('u = "https://public@crash.invalid/1";').length === 0, '.invalid 占位被误拦');
  });
  test('sentry.io.evil.com 不是 sentry.io 主机', () => {
    ok(scan('u = "https://sentry.io.evil.com/1";').length === 0);
  });
});

describe('BEL-303（2）CN 产物：无 DSN / 无 sentry.io / 放一行即红', () => {
  const sentryInject = require('../build/sentry-inject.js');
  test('CN block 不含 sentry.io 或公钥形状', () => {
    const block = sentryInject.scriptBlock(ROOT, 'china');
    ok(!/sentry\.io/i.test(block), 'CN crash block 里出现 sentry.io');
    ok(!/https:\/\/[0-9a-f]{16,}@/i.test(block), 'CN crash block 里出现 DSN 形状');
    ok(G.scan([{ name: 'dist-china/content-main.js', text: block }]).length === 0, 'CN block 绊了公开门');
  });
  test('人为放一行 sentry.io 必须让 complianceGateChina 的 scan 失败', () => {
    const planted = 'window.MT_TELEMETRY = "https://o.ingest.us.sentry.io/1";';
    ok(G.scan([{ name: 'dist-china/planted.js', text: planted }]).length === 1, '放进去的 sentry.io 没红');
  });
});

describe('BEL-303（3）crash.js 源码只留 .invalid', () => {
  test('源码不匹配 /sentry\\.io/', () => {
    ok(!/sentry\.io/i.test(CRASH_SRC), 'crash.js 源码里出现 sentry.io 字面量');
  });
  test('源码有 .invalid 占位', () => {
    ok(/crash\.invalid/.test(CRASH_SRC), 'crash.js 丢了 .invalid 占位');
  });
});

describe('BEL-303（4）伪造 sender.id 不转发', () => {
  test('sender.id !== chrome.runtime.id ⇒ dropped，capture 0', async () => {
    const bg = loadBackground();
    const r = await sendBackground(bg.listeners, { action: 'crashReport', payload: { message: 'boom' } }, { id: 'evil-page' });
    eq(r && r.dropped, 'foreign_sender');
    eq(bg.reports.length, 0);
  });
  test('本扩展 sender.id ⇒ 转发给 MTCrash', async () => {
    const bg = loadBackground();
    const r = await sendBackground(bg.listeners, { action: 'crashReport', payload: { message: 'boom' } }, { id: 'ext-test-id' });
    eq(r && r.ok, true);
    eq(bg.reports.length, 1);
    eq(bg.reports[0].payload.message, 'boom');
  });
  test('SW 不用 new Error(payload.message)', () => {
    const bgSrc = fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8');
    ok(!/new\s+Error\s*\(\s*payload\.message/.test(bgSrc), 'background.js 又 new Error(payload.message) 了');
  });
});

describe('BEL-303（5）业务失败 / 未知 reason 不 capture', () => {
  test('业务码与未知 reason 都判为 translate_fail 路径', () => {
    const { M } = loadCrash({ protocol: 'https:' });
    for (const reason of ['402', 'no_base', 'timeout', 'credit_exhausted', 'http', 'translate_fail', 'unknown_reason']) {
      ok(M._isBusinessFailure({ reason }), `未拦住 reason=${reason}`);
    }
    ok(!M._isBusinessFailure({ reason: 'error', message: 'TypeError: x is undefined' }), '真实崩溃被误判成业务失败');
    ok(!M._isBusinessFailure({ code: 'TypeError', message: 'boom' }), 'error name 被当成业务 reason');
  });
  test('content 四键 payload（code=TypeError）仍 capture', async () => {
    const { M, captured } = loadCrash({ protocol: 'file:', autoInit: true });
    await M.report({ message: 'content boom', stack: 'Error: boom\n at f (https://x/y:1:2)', code: 'TypeError', filename: 'https://x/y?q=1' }, 'extension');
    eq(captured.length, 1);
    eq(captured[0].tags.stackless, undefined);
    eq(captured[0].extra.code, 'TypeError');
  });
  test('report 业务码时不调 captureEvent', async () => {
    const { M, captured } = loadCrash({ protocol: 'file:' });
    M._reset();
    M.init({ dsn: 'https://abc@example.test/1', host: 'app' });
    eq(await M.report({ reason: '402', message: 'credit exhausted' }), false);
    eq(captured.length, 0);
  });
});

describe('BEL-303（7）beforeSend 递归 scrub', () => {
  test('fixture：无原文 / token / query / Authorization / IP / 未脱敏 URL', () => {
    const { M } = loadCrash({ protocol: 'https:' });
    const fixture = {
      message: 'uncaught TypeError while rendering a paragraph',
      request: {
        url: 'https://api.example.com/x?token=SECRET_TOKEN&q=用户原文',
        headers: { Authorization: 'Bearer SECRET_TOKEN' },
        data: '用户原文',
        query_string: 'token=SECRET_TOKEN',
      },
      user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
      exception: {
        values: [{
          type: 'Error',
          value: 'render failed https://api.example.com/p?token=SECRET_TOKEN',
          stacktrace: {
            frames: [{
              filename: 'https://cdn.example.com/app.js?token=SECRET_TOKEN',
              abs_path: 'https://cdn.example.com/app.js?token=SECRET_TOKEN',
              url: 'https://cdn.example.com/app.js?token=SECRET_TOKEN',
              query: 'token=SECRET_TOKEN',
              vars: { Authorization: 'Bearer SECRET_TOKEN' },
            }],
          },
        }],
      },
      extra: {
        text: '用户原文', rem: '用户原文', raw: '用户原文',
        token: 'SECRET_TOKEN',
        url: 'https://api.example.com/x?token=SECRET_TOKEN&q=用户原文',
        ip: '1.2.3.4',
        seg: { text: '用户原文', rem: '用户原文', raw: '用户原文', reason: 'ok' },
        nested: { authorization: 'Bearer SECRET_TOKEN' },
      },
      contexts: {
        device: { name: 'iPhone' },
        trace: { data: { url: 'https://api.example.com/x?q=用户原文' } },
      },
      breadcrumbs: {
        values: [
          { category: 'console', message: '用户原文' },
          { category: 'fetch', data: { url: 'https://api.example.com/x?q=用户原文' } },
          { category: 'custom', message: 'custom breadcrumb', data: { text: '用户原文', url: 'https://api.example.com/x?q=用户原文' } },
        ],
      },
      tags: { install_id: 'iid-123', user_id: 'u1', custom: 'drop' },
    };
    const out = M._beforeSend(fixture);
    const js = JSON.stringify(out);
    ok(!js.includes('用户原文'), '原文仍在 event JSON 里');
    ok(!js.includes('SECRET_TOKEN'), 'token 仍在 event JSON 里');
    ok(!js.includes('1.2.3.4'), 'IP 仍在 event JSON 里');
    ok(!js.includes('?token=') && !js.includes('?q='), 'query 仍在 event JSON 里');
    ok(!js.includes('Authorization'), 'Authorization 键仍在 event JSON 里');
    ok(!Object.prototype.hasOwnProperty.call(out, 'request'), 'request 整段没删');
    ok(!Object.prototype.hasOwnProperty.call(out, 'user'), 'user 没删');
    ok(!/cdn\.example\.com\/app\.js\?/i.test(js), 'frame url 的 query 没去掉');
    eq(out.tags.install_id, 'iid-123');
    ok(!('user_id' in out.tags), 'user_id 不应成为 tag');
    // console/fetch breadcrumbs dropped; custom kept and scrubbed
    eq(out.breadcrumbs.values.length, 1);
    eq(out.breadcrumbs.values[0].category, 'custom');
  });
});

describe('BEL-303（8）空 DSN ⇒ init 零网络', () => {
  test('CN 注入后的 crash block：Sentry.init 0、fetch 0', () => {
    const sentryInject = require('../build/sentry-inject.js');
    const cn = sentryInject.scriptBlock(ROOT, 'china');
    const { M, inits, network } = loadCrash({ source: cn, protocol: 'file:', mtHost: 'app', networkOnInit: true });
    eq(M.init({ host: 'app' }), false);
    eq(inits.length, 0);
    eq(network(), 0);
  });
  test('空 DSN 显式 init 也返回 false', () => {
    const { M, inits, network } = loadCrash({ protocol: 'https:', networkOnInit: true });
    M._reset();
    eq(M.init({ dsn: '', host: 'app', Sentry: { init: () => { inits.push(1); } } }), false);
    eq(inits.length, 0);
    eq(network(), 0);
  });
});

describe('BEL-303 ACCEPT：Safari masked / stackless 仍上报', () => {
  test('masked URL 与无栈都打 tag，不上报前丢', async () => {
    const { M, captured } = loadCrash({ protocol: 'file:', autoInit: true });
    await M.report({ reason: 'unhandledrejection', message: 'masked boom', stack: 'Error: x\n at foo (webkit-masked-url://hidden/)' }, 'extension');
    await M.report({ reason: 'unhandledrejection', message: 'no stack boom', stack: '' }, 'extension');
    eq(captured.length, 2);
    eq(captured[0].tags.masked, '1');
    eq(captured[0].tags.stackless, '1');
    eq(captured[1].tags.stackless, '1');
  });
});

describe('BEL-303 rate limit：≤5/session、≤20/day', () => {
  test('第 6 条同一 session 不再 capture', async () => {
    const { M, captured } = loadCrash({ protocol: 'file:', autoInit: true });
    for (let i = 0; i < 6; i += 1) {
      await M.report({ reason: 'error', message: 'boom ' + i }, 'extension');
    }
    eq(captured.length, 5);
  });
});


// ─── BEL-294/BEL-295 helper carry（dist 的唯一来源）───────────────────────────
describe('BEL-295 helper：buildNo 读原生 CFBundleVersion，不写 0', () => {
  const telemetrySandbox = (appCaps) => ({
    window: { MT_VERSION: '1.23.5', MT_FLAVOR: 'global', MT_APP_CAPS: appCaps },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1.15', platform: 'iPhone', language: 'zh-CN' },
    crypto: require('crypto').webcrypto,
  });
  test('window.MT_APP_CAPS.build 进入 envelope；非法值整键省略', () => {
    const okCtx = loadModule(['learn/telemetry.js'], telemetrySandbox({ build: 232 }));
    eq(okCtx.MTTelemetry.buildNo(), 232);
    const env = okCtx.MTTelemetry._envelope('11111111-1111-4111-8111-111111111111', { ts: '2026-11-19T00:00:00Z', name: 'heartbeat', props: {} });
    eq(env.build, 232);
    const badCtx = loadModule(['learn/telemetry.js'], telemetrySandbox({ build: '232' }));
    eq(badCtx.MTTelemetry.buildNo(), undefined);
    const env2 = badCtx.MTTelemetry._envelope('11111111-1111-4111-8111-111111111111', { ts: '2026-11-19T00:00:00Z', name: 'heartbeat', props: {} });
    eq(Object.prototype.hasOwnProperty.call(env2, 'build'), false);
  });
  test('crash 的 dist 通过 setBuildNo 复用同一个函数（无第二套）', () => {
    const { M } = loadCrash({ protocol: 'file:', autoInit: true });
    let called = 0;
    M.setBuildNo(() => { called += 1; return 777; });
    const ev = M._beforeSend({ message: 'x', tags: {} });
    eq(ev.dist, '777');
    ok(called >= 1);
  });
});


// ─── ACCEPT：iOS Safari SW 不可用 ⇒ chrome.storage.local 环形 ────────────────
describe('BEL-303 content forward：SW 失败写 200 条环，不直连', () => {
  test('sendMessage 抛 ⇒ 环形收到 4 键 payload，fetch 0', async () => {
    const f = loadForward({ throwSend: true });
    eq(f.F.install(), true);
    eq(typeof f.listeners.error?.[0], 'function');
    f.listeners.error[0]({ message: 'boom', filename: 'https://x/y?q=1', error: { name: 'TypeError', stack: 'Error: boom\n at f (https://x/y?q=1:1:2)' } });
    await new Promise((r) => setTimeout(r, 20));
    const ring = f.store[f.F.RING_KEY] || [];
    eq(ring.length, 1, 'SW 失败后没有写环形');
    deepKeys(ring[0], ['message', 'stack', 'code', 'filename']);
    eq(ring[0].code, 'TypeError');
    eq(f.fetched.length, 0, 'content 直连了网络');
  });
});
