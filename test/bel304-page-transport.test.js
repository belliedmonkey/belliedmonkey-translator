// test/bel304-page-transport.test.js — BEL-304 A 案：探针只当快速跳过；SW 失败
// 即整页降级 + 本批直连重发（复用同一 batch id）。
//
// 真机事实（14 Pro / 234，2026-11-18）：App 与扩展页事件到达，Safari 内容脚本
// 0 行；`telemetryPing` 能通（消息到后台），但 SW 的 `telemetrySend` 没落地。
// 探头只证明「消息到后台」，不证明「后台发得出去」。所以这里的边界：
//  ① probe 失败 ⇒ 本页直接直连；probe 成功 ⇒ 本页**第一批**仍走 SW。
//  ② SW 失败（throw / lastError / {ok:false} / 15s 超时）⇒ 立即 pageTransport='direct'
//     并把这一批直连重发一次；同一 batch id / `x-mt-batch`。直连也失败才 flush false、
//     批次回队列；后续 flush 不再探测、不再发 telemetrySend。
//  ③ `x-mt-batch` 只在 global 加（SW / 网页直连 / 扩展页 / App 一致）；china 不加，
//     保持 text/plain 简单请求。`_b` 只在队列项与请求头，不进 body。
//  ④ Safari 内容页 schedule 10s（其余 60s）；init 不再挂 pagehide /
//     visibilitychange（236 二分：它可能在 App 的 WKWebView / 扩展页挂死 init）。
const { loadModule, describe, test, ok, eq, deepEq, tick } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const INGEST = 'https://ingest.test/functions/v1/bt-ingest';
const TEL = {
  url: INGEST,
  spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
};
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

// 网页内容脚本的 vm sandbox。默认：探针回 {ok:true}、telemetrySend 回 {ok:true}、
// 直连 fetch 成功。每个 test 只覆盖它关心的那一条。
function pageSandbox(opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const sent = [];
  const fetched = [];
  const warnings = [];
  const listeners = { window: {}, document: {} };
  const runtime = { lastError: null, sendMessage: null };
  runtime.sendMessage = (msg, cb) => {
    sent.push(msg);
    if (opts.onMessage) return opts.onMessage(msg, cb, runtime);
    cb && cb({ ok: true });
    return undefined;
  };
  const win = {
    MT_VERSION: '9.9.9',
    MT_FLAVOR: opts.flavor || 'global',
    MT_TELEMETRY: opts.telemetry || TEL,
    addEventListener: (t, fn) => { (listeners.window[t] = listeners.window[t] || []).push(fn); },
  };
  if (opts.webkit) win.webkit = opts.webkit;
  const doc = {
    hidden: false,
    addEventListener: (t, fn) => { (listeners.document[t] = listeners.document[t] || []).push(fn); },
  };
  // BEL-304 237：storage 行为可替换 —— 默认是正常回调式；超时测试传一个
  // 永不回调的 get，无 storage 测试传 storage:false。
  const local = {
    get: opts.get || ((keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]])))),
    set: opts.set || ((obj, cb) => { Object.assign(store, obj); cb && cb(); }),
    remove: opts.remove || ((keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); }),
  };
  const sandbox = {
    window: win,
    navigator: { userAgent: opts.ua || CHROME_UA, platform: 'Mac', language: 'en' },
    crypto: require('crypto').webcrypto,
    console: Object.assign({}, console, { warn: (...a) => warnings.push(a) }),
    fetch: opts.fetch || (async (url, init) => { fetched.push({ url, init }); return { ok: true, status: 200 }; }),
  };
  if (opts.chrome !== false) {
    sandbox.chrome = { i18n: { getUILanguage: () => 'en' }, runtime };
    if (opts.storage !== false) sandbox.chrome.storage = { local };
  }
  // browser-only / Promise 风格：Safari 内容脚本的真实形状。runtime 可由测试
  // 传入（用来观察 sendMessage 走了哪一边），默认接同一个 sent 数组。
  if (opts.browser) {
    const bRuntime = opts.browserRuntime || {
      lastError: null,
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage: (msg, cb) => {
        sent.push(msg);
        const resp = { ok: true };
        if (cb) { cb(resp); return undefined; }
        return Promise.resolve(resp);
      },
    };
    const bLocal = opts.browserStorage || {
      get: (keys) => Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      remove: (keys) => { for (const k of keys) delete store[k]; return Promise.resolve(); },
    };
    sandbox.browser = {
      runtime: bRuntime,
      i18n: { getUILanguage: () => 'en' },
      storage: { local: bLocal },
    };
  }
  // App 的 WKWebView 里没有 DOM，也可能没有 document；扩展页同样没有 http(s)
  // location（inWebPage() === false）。这两类宿主是 235 回归的现场。
  if (opts.document !== false) sandbox.document = doc;
  if (opts.protocol) sandbox.location = { protocol: opts.protocol };
  else if (opts.webPage !== false) sandbox.location = { protocol: 'https:' };
  if (opts.setTimeout) sandbox.setTimeout = opts.setTimeout;
  if (opts.clearTimeout) sandbox.clearTimeout = opts.clearTimeout;
  if (opts.Date) sandbox.Date = opts.Date;
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, sent, fetched, warnings, runtime, listeners, win, doc };
}

// BEL-304 237 的假时钟：只替换 setTimeout / clearTimeout / Date.now，
// 不动最终决定 flush 时机的真实模块逻辑。advance 会按时间顺序跑完到期回调，
// 并在每个回调后让 microtask 链推进，避免漏掉「超时后才挂上」的下一笔定时器。
function makeClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  return {
    get now() { return now; },
    Date: FakeDate,
    setTimeout(fn, ms) { const id = seq++; timers.set(id, { fn, at: now + (Number(ms) || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      now += Math.max(0, Number(ms) || 0);
      for (;;) {
        let due = null;
        for (const [id, t] of timers) {
          if (t.at > now) continue;
          if (!due || t.at < due.t.at || (t.at === due.t.at && id < due.id)) due = { id, t };
        }
        if (!due) break;
        timers.delete(due.id);
        try { due.t.fn(); } catch (_) {}
        await new Promise((r) => setImmediate(r));
      }
      await new Promise((r) => setImmediate(r));
    },
  };
}

const sends = (sent) => sent.filter((m) => m && m.action === 'telemetrySend');
const pingCount = (sent) => sent.filter((m) => m && m.action === 'telemetryPing').length;
const hasAuth = (h) => Object.keys(h || {}).some((k) => /^authorization$/i.test(k));
const hasBatch = (h) => Object.keys(h || {}).some((k) => /^x-mt-batch$/i.test(k));
const batchOf = (h) => (h || {})['x-mt-batch'];
const directFailWarnings = (warnings) => warnings.filter((w) => w[0] === '[mt] telemetry direct failed');
const downgradeWarnings = (warnings) => warnings.filter((w) => w[0] === '[mt] telemetry sw failed, page downgraded');
// tm:last 是 5 秒软锁；测试里两次 flush 之间把它拨老，等价于等过了窗口。
function ageLock(store, T) { store[T.KEYS.last] = Date.now() - 6000; }
// init() 会记 installed/heartbeat；不需要时先种上 id 与今天的 day。
function seedInit(store) {
  store['tm:id'] = '11111111-1111-4111-8111-111111111111';
  store['tm:day'] = new Date().toISOString().slice(0, 10);
}

// probe 成功、批次结果由 handler 决定。
function probeOkThen(handler) {
  return (msg, cb) => {
    if (msg.action === 'telemetryPing') return cb && cb({ ok: true });
    return handler(msg, cb);
  };
}

describe('BEL-304 A — probe 只是快速跳过，SW 失败整页降级', () => {
  test('① probe 成功 + SW {ok:true} ⇒ 只走 SW，直连 0 次，每页只 probe 一次', async () => {
    const { T, store, sent, fetched } = pageSandbox();
    await T.init();
    await T.track('heartbeat');
    eq(await T.flush(), true);
    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(pingCount(sent), 1, '每页只该探测一次');
    eq(sends(sent).length, 2, '两次 flush 都该走 SW');
    eq(fetched.length, 0, 'SW 成功后仍然直连了');
    eq(store[T.KEYS.queue].length, 0);
  });

  test('② probe 成功 + SW {ok:false} ⇒ 同一次 flush 内直连重发 1 次；同一 x-mt-batch；队列清空；第二次不再 telemetrySend', async () => {
    const { T, store, sent, fetched, warnings } = pageSandbox({
      onMessage: probeOkThen((msg, cb) => cb && cb({ ok: false, status: 500 })),
    });
    await T.track('heartbeat');
    eq(await T.flush(), true, 'SW 失败后直连重发成功，flush 应为 true');
    eq(sends(sent).length, 1, 'SW 只该尝试一次');
    eq(fetched.length, 1, 'SW 失败后应当直连重发一次');
    const swBatch = batchOf(sends(sent)[0].init.headers);
    ok(/^[0-9a-f]{16}$/.test(swBatch), 'SW 路径的 x-mt-batch 不是 16hex');
    eq(batchOf(fetched[0].init.headers), swBatch, '直连重发换了 batch id —— 服务端去重失效');
    eq(store[T.KEYS.queue].length, 0, '重发成功后队列没清');
    eq(store[T.KEYS.directFail], undefined, 'SW 失败被误记成直连失败（直连还没试）');
    eq(store.mtTelemetryDropped, undefined, 'SW 失败被误记成 dropped');
    eq(downgradeWarnings(warnings).length, 1, 'SW 失败降级没有 warn');
    eq(directFailWarnings(warnings).length, 0);

    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(sends(sent).length, 1, '已降级后第二次 flush 仍发了 telemetrySend');
    eq(pingCount(sent), 1, '已降级后第二次 flush 又探测了');
    eq(fetched.length, 2, '第二次 flush 应当直接直连');
  });

  test('③ probe 成功 + SW 15s 超时 ⇒ 同一次 flush 内直连重发 1 次（fake timer）', async () => {
    const timers = [];
    const realSet = setTimeout, realClear = clearTimeout;
    let swCalls = 0;
    const { T, store, sent, fetched } = pageSandbox({
      onMessage: (msg, cb) => {
        if (msg.action === 'telemetryPing') return cb && cb({ ok: true });
        swCalls += 1;
        // 回调整体不触发（Safari 的第二种失败形态）—— 只能靠 SW_TIMEOUT_MS。
      },
      setTimeout: (fn, ms) => {
        if (ms === 15000) { timers.push(fn); return 9001; }   // SW_TIMEOUT_MS
        return realSet(fn, ms);
      },
      clearTimeout: (id) => { if (id !== 9001) realClear(id); },
    });
    eq(T.SW_TIMEOUT_MS, 15000);
    await T.track('heartbeat');
    const f = T.flush();
    await tick(0);
    eq(fetched.length, 0, 'SW 还在等，flush 就抢跑直连了');
    eq(timers.length, 1, '没有安排 15s SW 超时');
    timers[0]();
    eq(await f, true, '超时后应当直连重发成功');
    eq(swCalls, 1);
    eq(fetched.length, 1);
    eq(store[T.KEYS.queue].length, 0);
    eq(store[T.KEYS.directFail], undefined, 'SW 超时被误记成直连失败');
    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(swCalls, 1, '降级后还发 telemetrySend');
    eq(fetched.length, 2);
  });

  test('④ probe 失败 ⇒ 直接直连，telemetrySend 0 次；记 mtTelemetryDirectFail + warn', async () => {
    const { T, store, sent, fetched, warnings } = pageSandbox({
      onMessage: () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    });
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(pingCount(sent), 1);
    eq(sends(sent).length, 0, '探测失败后仍向 SW 发批次');
    eq(fetched.length, 1, '探测失败应当直连');
    eq(store[T.KEYS.directFail], 1, '探针失败没有记 mtTelemetryDirectFail');
    eq(warnings.some((w) => w[0] === '[mt] telemetry ping failed'), true, '探针失败没有 warn');
  });

  test('⑤ probe 失败 + 直连也失败 ⇒ flush false、队列保留、不增加 dropped；下次复用同一 batch id', async () => {
    let calls = 0;
    const { T, store, sent, fetched } = pageSandbox({
      onMessage: () => { throw new Error('no receiver'); },
      fetch: async (url, init) => {
        fetched.push({ url, init });
        calls += 1;
        if (calls === 1) throw new TypeError("Refused to connect ... connect-src 'none'");
        return { ok: true, status: 200 };
      },
    });
    await T.track('heartbeat');
    eq(await T.flush(), false);
    eq(store[T.KEYS.queue].length, 1, '直连失败后队列丢了');
    eq(store.mtTelemetryDropped, undefined, '直连失败被误记成 dropped');
    eq(store[T.KEYS.directFail], 2, '探针失败 + 直连失败应各记一次');
    const firstBatch = batchOf(fetched[0].init.headers);
    ok(/^[0-9a-f]{16}$/.test(firstBatch), '直连批次没有 16hex x-mt-batch');
    eq(store[T.KEYS.queue][0]._b, firstBatch, '队列项与请求头的 batch id 不一致');

    ageLock(store, T);
    eq(await T.flush(), true, '下一次 flush 应当重试成功');
    eq(sends(sent).length, 0, '探针失败的页面不该再发 telemetrySend');
    eq(batchOf(fetched[1].init.headers), firstBatch, '重发同一批换了 batch id');
    eq(store[T.KEYS.queue].length, 0);
  });

  test('⑥ SW 失败 + 直连也失败 ⇒ 队列保留；下次 flush 直接直连且复用同一 batch id', async () => {
    let fetches = 0;
    const { T, store, sent, fetched, warnings } = pageSandbox({
      onMessage: probeOkThen((msg, cb) => cb && cb({ ok: false, status: 503 })),
      fetch: async (url, init) => {
        fetched.push({ url, init });
        fetches += 1;
        if (fetches === 1) throw new TypeError('network down');
        return { ok: true, status: 200 };
      },
    });
    await T.track('heartbeat');
    eq(await T.flush(), false);
    eq(store[T.KEYS.queue].length, 1, '两路都失败后队列丢了');
    eq(store.mtTelemetryDropped, undefined);
    eq(store[T.KEYS.directFail], 1, '这一次只该记直连失败（SW 失败不计）');
    eq(downgradeWarnings(warnings).length, 1);
    const firstBatch = batchOf(fetched[0].init.headers);

    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(sends(sent).length, 1, '降级后仍发了 telemetrySend');
    eq(fetched.length, 2);
    eq(batchOf(fetched[1].init.headers), firstBatch, '失败批次重发换了 batch id');
    eq(store[T.KEYS.queue].length, 0);
  });

  test('⑦ global 网页直连带 16hex x-mt-batch；china 网页直连不带', async () => {
    const global = pageSandbox({ onMessage: () => { throw new Error('no receiver'); } });
    await global.T.track('heartbeat');
    eq(await global.T.flush(), true);
    eq(global.fetched.length, 1);
    ok(/^[0-9a-f]{16}$/.test(batchOf(global.fetched[0].init.headers)), 'global 网页直连丢了 x-mt-batch');
    eq(JSON.parse(global.fetched[0].init.body)[0].flavor, 'global');

    const china = pageSandbox({
      flavor: 'china',
      onMessage: () => { throw new Error('no receiver'); },
    });
    await china.T.track('heartbeat');
    eq(await china.T.flush(), true);
    eq(china.fetched.length, 1);
    eq(hasBatch(china.fetched[0].init.headers), false, 'china 网页直连带 x-mt-batch 会触发预检');
    eq(china.fetched[0].init.headers['content-type'], 'text/plain');
    eq(JSON.parse(china.fetched[0].init.body)[0].flavor, 'china');
  });

  test('⑧ global 扩展页直连带批次头；china 扩展页不带', async () => {
    const global = pageSandbox({ webPage: false });
    await global.T.track('heartbeat');
    eq(await global.T.flush(), true);
    eq(global.sent.length, 0, '扩展页不该发 telemetryPing');
    okayBatch(global.fetched[0]);
    const china = pageSandbox({ webPage: false, flavor: 'china' });
    await china.T.track('heartbeat');
    eq(await china.T.flush(), true);
    eq(china.sent.length, 0);
    eq(china.fetched.length, 1);
    eq(hasBatch(china.fetched[0].init.headers), false, 'china 扩展页不该带 x-mt-batch');
    eq(china.fetched[0].init.headers['content-type'], 'text/plain');

    function okayBatch(item) {
      eq(item.url, INGEST);
      ok(/^[0-9a-f]{16}$/.test(batchOf(item.init.headers)), 'global 扩展页直连丢了 x-mt-batch');
      eq(item.init.keepalive, true);
    }
  });

  test('⑨ body 顶层与单条事件都没有 _b（SW 与直连两条路）', async () => {
    const sw = pageSandbox();
    await sw.T.track('heartbeat');
    eq(await sw.T.flush(), true);
    assertNoB(JSON.parse(sends(sw.sent)[0].init.body), 'SW');

    const direct = pageSandbox({ webPage: false });
    await direct.T.track('heartbeat');
    eq(await direct.T.flush(), true);
    assertNoB(JSON.parse(direct.fetched[0].init.body), 'direct');

    function assertNoB(body, label) {
      eq(Array.isArray(body), true, label + ' body 不是数组');
      ok(!Object.prototype.hasOwnProperty.call(body, '_b'), label + ' body 顶层漏了 _b');
      for (const e of body) ok(!Object.prototype.hasOwnProperty.call(e, '_b'), label + ' 单条事件漏了 _b');
    }
  });

  test('⑩ Safari 内容页 schedule 用 10s；Chrome 用 60s（fake setTimeout）', async () => {
    const safariDelays = [];
    const safari = pageSandbox({
      ua: SAFARI_UA,
      setTimeout: (fn, ms) => { safariDelays.push(ms); return safariDelays.length; },
      clearTimeout: () => {},
    });
    eq(safari.T.FLUSH_MS_SAFARI, 10 * 1000);
    eq(safari.T.FLUSH_MS, 60 * 1000);
    await safari.T.track('heartbeat');
    ok(safariDelays.includes(10 * 1000), 'Safari 内容页没有用 10s 定时器：' + JSON.stringify(safariDelays));
    ok(!safariDelays.includes(60 * 1000), 'Safari 内容页仍用了 60s');

    const chromeDelays = [];
    const chrome = pageSandbox({
      setTimeout: (fn, ms) => { chromeDelays.push(ms); return chromeDelays.length; },
      clearTimeout: () => {},
    });
    await chrome.T.track('heartbeat');
    ok(chromeDelays.includes(60 * 1000), 'Chrome 没有用 60s：' + JSON.stringify(chromeDelays));
    ok(!chromeDelays.includes(10 * 1000), 'Chrome 误用了 Safari 的 10s');
  });

  test('⑪ china：SW 成功与 SW 失败降级后的直连都不带 x-mt-batch', async () => {
    const sw = pageSandbox({ flavor: 'china' });
    await sw.T.track('heartbeat');
    eq(await sw.T.flush(), true);
    eq(sends(sw.sent).length, 1);
    eq(hasBatch(sends(sw.sent)[0].init.headers), false, 'china SW 批次带了 x-mt-batch');
    eq(sw.fetched.length, 0);

    const down = pageSandbox({
      flavor: 'china',
      onMessage: probeOkThen((msg, cb) => cb && cb({ ok: false })),
    });
    await down.T.track('heartbeat');
    eq(await down.T.flush(), true);
    eq(sends(down.sent).length, 1);
    eq(hasBatch(sends(down.sent)[0].init.headers), false, 'china SW 失败批次带了 x-mt-batch');
    eq(down.fetched.length, 1);
    eq(hasBatch(down.fetched[0].init.headers), false, 'china 降级直连带 x-mt-batch 会触发预检');
  });

  test('⑫ 回归：keepalive / text/plain / 无 Authorization（SW、网页直连、扩展页直连）', async () => {
    const sw = pageSandbox();
    await sw.T.track('heartbeat');
    eq(await sw.T.flush(), true);
    assertTransport(sends(sw.sent)[0].init, 'SW');

    const web = pageSandbox({ onMessage: () => { throw new Error('no receiver'); } });
    await web.T.track('heartbeat');
    eq(await web.T.flush(), true);
    assertTransport(web.fetched[0].init, 'web direct');

    const ext = pageSandbox({ webPage: false });
    await ext.T.track('heartbeat');
    eq(await ext.T.flush(), true);
    assertTransport(ext.fetched[0].init, 'extension direct');

    function assertTransport(init, label) {
      eq(init.method, 'POST', label);
      eq(init.keepalive, true, label);
      eq(init.headers['content-type'], 'text/plain', label);
      eq(hasAuth(init.headers), false, label + ' 带了 Authorization');
    }
  });
});

describe('BEL-304 236 — init 回到 234 形状：不挂页面退出；App / 扩展页沙箱能发', () => {
  test('⑬ init() 不再注册 pagehide / visibilitychange', async () => {
    const sb = pageSandbox({ ua: SAFARI_UA, onMessage: () => { throw new Error('no receiver'); } });
    seedInit(sb.store);
    await sb.T.init();
    await tick(0);
    eq(sb.listeners.window.pagehide, undefined, 'init 仍注册了 pagehide —— 235 回归的嫌疑代码没拿掉');
    eq(sb.listeners.document.visibilitychange, undefined, 'init 仍注册了 visibilitychange');
  });

  test('⑭ App 沙箱（window.webkit + file://，无 document）init 不抛；app_open 直连发出', async () => {
    const sb = pageSandbox({
      webPage: false,
      protocol: 'file:',
      document: false,
      ua: SAFARI_UA,
      webkit: { messageHandlers: { controller: { postMessage() {} } } },
    });
    seedInit(sb.store);
    await sb.T.init();                        // 235 的 init 可能在这里挂死；抛/挂都算失败
    eq(sb.T.host(), 'app');
    eq(await sb.T.track('app_open', { surface: 'app_home', auth_state: 'signed_in' }), true);
    eq(await sb.T.flush(), true);
    eq(sb.sent.length, 0, 'App 不该探测 SW / 发 telemetryPing');
    eq(sb.fetched.length, 1, 'App 的 app_open 没有直连发出');
    eq(sb.fetched[0].url, INGEST);
    const body = JSON.parse(sb.fetched[0].init.body);
    eq(body.length, 1);
    eq(body[0].name, 'app_open');
    eq(body[0].host, 'app');
    eq(body[0].install_id, sb.store['tm:id']);
    eq(body[0].props.surface, 'app_home');
    eq(sb.fetched[0].init.keepalive, true);
    eq(sb.fetched[0].init.headers['content-type'], 'text/plain');
    eq(hasAuth(sb.fetched[0].init.headers), false);
    eq(sb.store[sb.T.KEYS.queue].length, 0);
  });

  test('⑮ 扩展页沙箱（无 document / 无 webkit）init 不抛；track + flush 直连发出', async () => {
    const sb = pageSandbox({ webPage: false, document: false });
    seedInit(sb.store);
    await sb.T.init();
    eq(sb.T.host(), 'chrome');
    eq(await sb.T.track('heartbeat'), true);
    eq(await sb.T.flush(), true);
    eq(sb.sent.length, 0, '扩展页不该探测 SW');
    eq(sb.fetched.length, 1, '扩展页的 heartbeat 没有直连发出');
    eq(JSON.parse(sb.fetched[0].init.body)[0].name, 'heartbeat');
    eq(sb.store[sb.T.KEYS.queue].length, 0);
  });
});

describe('BEL-304 237 — Safari 存储桥：API 兜底 + 1.5s 超时 + 内存队列', () => {
  test('⑱ chrome.storage.local.get 永不回调 ⇒ 1500ms 后按内存继续；track + flush 仍发出，install_id 稳定', async () => {
    const clock = makeClock();
    let getCalls = 0;
    const sb = pageSandbox({
      ua: SAFARI_UA,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      Date: clock.Date,
      // Safari 的失败形态：回调根本不执行（不是抛异常，也没有 lastError）。
      get: () => { getCalls += 1; },
      onMessage: probeOkThen((msg, cb) => cb && cb({ ok: true })),
    });
    eq(sb.T.STORAGE_TIMEOUT_MS, 1500, '存储超时常量不是 1500ms');

    const trackP = sb.T.track('translate_start', { kind: 'page', engine: 'google', locale_pair: 'en-zh' });
    await tick(0);              // trackChain 先进到 sget，超时定时器才挂得上
    await clock.advance(1500);
    eq(await trackP, true, '存储桥超时后 translate_start 没进队列');
    // 第一次 get 超时后本页转入内存模式：后续读不再逐笔等 1.5s，
    // 否则 Safari 内容页的 10s flush 会被几次超时拖过 15s。
    eq(getCalls, 1, '超时后仍在逐笔调用 storage.get');

    const id1 = (await sb.T.installId()).id;
    const id2 = (await sb.T.installId()).id;
    eq(id1, id2, '存储桥不回话时 install_id 每次都新生成');
    eq(await sb.T.flush(), true, '内存队列的 flush 没有发出');
    eq(sends(sb.sent).length, 1, '应当只走一次 SW 发送');
    eq(sb.fetched.length, 0, 'SW 成功后仍直连');
    const body = JSON.parse(sends(sb.sent)[0].init.body);
    eq(Array.isArray(body), true);
    eq(body.length, 1, '内存队列丢了当前批');
    eq(body[0].name, 'translate_start');
    eq(body[0].install_id, id1, 'body 里的 install_id 与内存 id 不一致');
    ok(/^[0-9a-f]{16}$/.test(body[0].props.op_id), 'translate_start 没有 op_id');
    eq(sb.store[sb.T.KEYS.queue].length, 0, 'flush 后磁盘队列没清空');
  });

  test('⑲ 只有 browser（storage.get 返回 Promise）⇒ init/track/flush 正常', async () => {
    const bsent = [];
    const browserRuntime = {
      lastError: null,
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage: (msg, cb) => {
        bsent.push(msg);
        const resp = { ok: true };
        if (cb) { cb(resp); return undefined; }
        return Promise.resolve(resp);
      },
    };
    const sb = pageSandbox({ chrome: false, browser: true, browserRuntime });
    await sb.T.init({ flushNow: false });
    ok(sb.store[sb.T.KEYS.id], 'browser-only 的 init 没有生成 install_id');
    ok(sb.store[sb.T.KEYS.day], 'browser-only 的 init 没有写 tm:day');
    eq(sb.store[sb.T.KEYS.queue].length, 2, 'init 后应有 installed + heartbeat');
    eq(await sb.T.flush(), true, 'browser-only 的 flush 没发出');
    const sendsOnly = bsent.filter((m) => m && m.action === 'telemetrySend');
    eq(sendsOnly.length, 1, 'browser.runtime 没收到 telemetrySend');
    const body = JSON.parse(sendsOnly[0].init.body);
    eq(body.length, 2);
    deepEq(body.map((e) => e.name).sort(), ['heartbeat', 'installed']);
    for (const e of body) eq(e.install_id, sb.store[sb.T.KEYS.id]);
    eq(sb.store[sb.T.KEYS.queue].length, 0);
  });

  test('⑳ chrome 和 browser 都没有 storage ⇒ 内存队列仍 flush 一次（不崩、不丢当前批）', async () => {
    const sb = pageSandbox({ storage: false });
    eq(await sb.T.track('heartbeat'), true, '没有 storage 时 track 直接失败');
    eq(await sb.T.flush(), true, '没有 storage 时内存队列 flush 失败');
    eq(sends(sb.sent).length, 1, '没有 storage 时没有发出任何批次');
    const body = JSON.parse(sends(sb.sent)[0].init.body);
    eq(body.length, 1, '没有 storage 时当前批丢了');
    eq(body[0].name, 'heartbeat');
    ok(body[0].install_id, '没有 storage 时 install_id 为空');
    // 队列只在内存里：磁盘键从未被写出来（也没有 storage 可写）。
    eq(sb.store[sb.T.KEYS.queue], undefined, '没有 storage 却写了磁盘队列');
  });

  test('㉑ storage 正常 ⇒ 仍先持久化入队，flush 成功后清空', async () => {
    const sb = pageSandbox();
    eq(await sb.T.track('heartbeat'), true);
    ok(Array.isArray(sb.store[sb.T.KEYS.queue]), '正常 storage 没有持久化队列');
    eq(sb.store[sb.T.KEYS.queue].length, 1);
    eq(sb.store[sb.T.KEYS.queue][0].name, 'heartbeat');
    eq(await sb.T.flush(), true);
    eq(sb.store[sb.T.KEYS.queue].length, 0, 'flush 成功后队列没清空');
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sb.store[sb.T.KEYS.id]),
      '正常 storage 没有持久化 install_id');
  });

  test('㉒ 存储超时后 tm:on=false 的内存值仍尊重（用户关了就不发）', async () => {
    const clock = makeClock();
    let getMode = 'ok';
    let storeRef = null;
    let hungGets = 0;
    const sb = pageSandbox({
      ua: SAFARI_UA,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      Date: clock.Date,
      get: (keys, cb) => {
        if (getMode === 'hang') { hungGets += 1; return; }
        cb && cb(Object.fromEntries(keys.map((k) => [k, storeRef[k]])));
      },
      onMessage: probeOkThen((msg, cb) => cb && cb({ ok: true })),
    });
    storeRef = sb.store;

    // 先在正常存储上关掉遥测：sset 把 false 写进 MEM + storage。
    eq(await sb.T.setEnabled(false), false);
    eq(sb.store[sb.T.KEYS.on], false);
    // 把磁盘值拨回 true，模拟「存储里的旧值」；读取随后挂死，唯一能用的
    // 是 MEM 里的 false。
    sb.store[sb.T.KEYS.on] = true;
    getMode = 'hang';

    const p = sb.T.track('heartbeat');
    await tick(0);
    await clock.advance(1500);
    eq(await p, false, '关闭遥测后仍入队了');
    eq(hungGets, 1, '关闭状态没有走内存兜底（可能读到了磁盘的旧 true）');
    eq(await sb.T.flush(), false, '关闭遥测后 flush 仍试图发送');
    eq(sb.sent.length, 0, '关闭遥测后发了 telemetryPing / telemetrySend');
    eq(sb.fetched.length, 0, '关闭遥测后仍直连');
    eq(sb.store[sb.T.KEYS.queue], undefined, '关闭遥测后仍写了队列');
  });
});

function backgroundLoader(opts = {}) {
  const listeners = [];
  const calls = [];
  const chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://abcdef/' + (p || ''),
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    storage: { local: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  };
  const fetchImpl = async (url, init) => {
    if (/telemetry-endpoints\.json$/.test(String(url))) {
      if (opts.allowlistError) throw new Error('allowlist unavailable');
      return { ok: true, json: async () => ({ ingest: opts.ingest || [INGEST] }) };
    }
    calls.push({ url, init });
    return opts.ingestResponse || { ok: true, status: 200 };
  };
  loadModule('./background.js', {
    chrome, fetch: fetchImpl, AbortController, URL, setTimeout, clearTimeout, console,
  });
  return { listeners, calls };
}

function sendBackground(listeners, msg) {
  return new Promise((resolve) => {
    for (const fn of listeners) {
      let answered = false;
      const ret = fn(msg, {}, (r) => { answered = true; resolve(r); });
      if (ret === true || answered) return;
    }
    resolve(undefined);
  });
}

describe('BEL-304 后台 telemetryPing / SW 既有边界不变', () => {
  test('⑯ 后台 telemetryPing 立即回 {ok:true}，不发起 fetch', async () => {
    const { listeners, calls } = backgroundLoader();
    deepEq(await sendBackground(listeners, { action: 'telemetryPing' }), { ok: true });
    eq(calls.length, 0, '探测不该触发任何网络请求');
  });

  test('⑰ SW 白名单 / 64KB 体限 / 拒收不变；x-mt-batch 头原样转发', async () => {
    const { listeners, calls } = backgroundLoader();
    const body = JSON.stringify([{ name: 'heartbeat' }]);

    const evil = await sendBackground(listeners, {
      action: 'telemetrySend', url: 'https://evil.test/functions/v1/bt-ingest',
      init: { method: 'POST', body },
    });
    eq(evil.ok, false);
    eq(evil.error, 'url_not_allowed');
    eq(calls.length, 0, '被拒绝的 URL 仍然被 fetch 了');

    const tooBig = await sendBackground(listeners, {
      action: 'telemetrySend', url: INGEST,
      init: { method: 'POST', body: 'x'.repeat(64 * 1024 + 1) },
    });
    eq(tooBig.ok, false);
    eq(tooBig.error, 'body_too_large');
    eq(calls.length, 0);

    const okRes = await sendBackground(listeners, {
      action: 'telemetrySend', url: INGEST,
      init: { method: 'POST', body, headers: { 'content-type': 'text/plain', 'x-mt-batch': '0123456789abcdef' } },
    });
    deepEq(okRes, { ok: true, status: 200 });
    eq(calls.length, 1);
    eq(calls[0].init.headers['x-mt-batch'], '0123456789abcdef', 'SW 转发丢了 x-mt-batch');
    eq(calls[0].init.headers['content-type'], 'text/plain');
  });
});
