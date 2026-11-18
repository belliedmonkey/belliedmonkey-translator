// test/bel304-page-transport.test.js — BEL-304：每页探一次后台；SW 或直连二选一；
// 批次幂等头 x-mt-batch。
//
// 真机取证（iPhone 14 Pro / 1.23.4(233)）：Safari 扩展翻成功，但东京 bt_events 的
// translate_* 0 行 —— iOS 锁屏后 SW 永久不可用，旧代码在 inWebPage() 时无条件
// sendViaRuntime()，静默失败。这里的边界：
//  ① 内容脚本每页只探一次（400ms）：成功 ⇒ 本页所有批次走 SW；失败（throw /
//     lastError / 超时）⇒ 本页所有批次直连。不按批重新判断。
//  ② 直连失败不是丢弃：放回队列 + 本机 mtTelemetryDirectFail 计数 + console.warn。
//  ③ 每批一个 16hex batch id，只进 `x-mt-batch` 头；队列项内部 `_b` 不进 body；
//     同一批重发复用同一个 id。
//  ④ 上线顺序的临时门：页面直连（探测失败）**不带** `x-mt-batch` —— 线上 ingest 的
//     CORS 只放行 content-type，带自定义头会先发预检、整批被挡；SW 代发与扩展页 /
//     App 直连不受页面 CORS 管，照常带。hosted #11 部署后打开。
const { loadModule, describe, test, ok, eq, deepEq, tick } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const INGEST = 'https://ingest.test/functions/v1/bt-ingest';
const TEL = {
  url: INGEST,
  spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
};
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// 网页内容脚本的 vm sandbox。默认：探针回 {ok:true}、telemetrySend 回 {ok:true}、
// 直连 fetch 成功。每个 test 只覆盖它关心的那一条。
function pageSandbox(opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const sent = [];
  const fetched = [];
  const warnings = [];
  const runtime = { lastError: null, sendMessage: null };
  runtime.sendMessage = (msg, cb) => {
    sent.push(msg);
    if (opts.onMessage) return opts.onMessage(msg, cb, runtime);
    cb && cb({ ok: true });
    return undefined;
  };
  const sandbox = {
    window: { MT_VERSION: '9.9.9', MT_FLAVOR: 'global', MT_TELEMETRY: opts.telemetry || TEL },
    navigator: { userAgent: CHROME_UA, platform: 'Mac', language: 'en' },
    crypto: require('crypto').webcrypto,
    console: Object.assign({}, console, { warn: (...a) => warnings.push(a) }),
    fetch: opts.fetch || (async (url, init) => { fetched.push({ url, init }); return { ok: true, status: 200 }; }),
    chrome: {
      i18n: { getUILanguage: () => 'en' },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
        remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
      } },
      runtime,
    },
  };
  // 扩展页 / App 没有 http(s) 的 location（inWebPage() === false）。
  if (opts.webPage !== false) sandbox.location = { protocol: 'https:' };
  if (opts.setTimeout) sandbox.setTimeout = opts.setTimeout;
  if (opts.clearTimeout) sandbox.clearTimeout = opts.clearTimeout;
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, sent, fetched, warnings, runtime };
}

const sends = (sent) => sent.filter((m) => m && m.action === 'telemetrySend');
const pingCount = (sent) => sent.filter((m) => m && m.action === 'telemetryPing').length;
const hasAuth = (h) => Object.keys(h || {}).some((k) => /^authorization$/i.test(k));
const directFailWarnings = (warnings) => warnings.filter((w) => w[0] === '[mt] telemetry direct failed');
// tm:last 是 5 秒软锁；测试里两次 flush 之间把它拨老，等价于等过了窗口。
function ageLock(store, T) { store[T.KEYS.last] = Date.now() - 6000; }

describe('BEL-304 每页一次探测：SW / 直连二选一', () => {
  test('探测成功 ⇒ 两次 flush 都走 SW，direct fetch 0 次，ping 只 1 次', async () => {
    const { T, store, sent, fetched } = pageSandbox();
    await T.init();
    eq(await T.track('heartbeat'), true);
    eq(await T.flush(), true);
    ageLock(store, T);
    eq(await T.track('heartbeat'), true);
    eq(await T.flush(), true);
    eq(pingCount(sent), 1, '每页只该探测一次');
    eq(sends(sent).length, 2, '两次 flush 都该走 SW');
    eq(fetched.length, 0, '探测成功后仍然直连了');
    eq(store[T.KEYS.queue].length, 0);
  });

  test('探测失败（sendMessage 抛）⇒ 两次 flush 都直连，SW 批次 0 次', async () => {
    const { T, store, sent, fetched } = pageSandbox({
      onMessage: () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    });
    await T.track('heartbeat');
    eq(await T.flush(), true);
    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(pingCount(sent), 1);
    eq(sends(sent).length, 0, '探测失败后仍向 SW 发批次');
    eq(fetched.length, 2, '两次都该直连');
  });

  test('探测失败（lastError）⇒ 本页所有批次直连', async () => {
    const { T, store, sent, fetched } = pageSandbox({
      onMessage: (msg, cb, runtime) => {
        if (msg.action === 'telemetryPing') {
          runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          cb && cb(undefined);
          runtime.lastError = null;
          return;
        }
        cb && cb({ ok: true });
      },
    });
    await T.track('heartbeat');
    eq(await T.flush(), true);
    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(pingCount(sent), 1);
    eq(sends(sent).length, 0);
    eq(fetched.length, 2);
  });

  test('探测失败（400ms 无回）⇒ 本页所有批次直连', async () => {
    const pending = [];
    const realSet = setTimeout, realClear = clearTimeout;
    const { T, store, sent, fetched } = pageSandbox({
      onMessage: (msg, cb) => {
        if (msg.action === 'telemetryPing') return;    // 永不回调（Safari 的第二形态）
        cb && cb({ ok: true });
      },
      setTimeout: (fn, ms) => {
        if (ms === 400) { pending.push(fn); return 4001; }   // PING_TIMEOUT_MS
        return realSet(fn, ms);
      },
      clearTimeout: (id) => { if (id !== 4001) realClear(id); },
    });
    eq(T.PING_TIMEOUT_MS, 400);
    await T.init();
    eq(pending.length, 1, '没有安排 400ms 探测超时');
    await T.track('heartbeat');
    const f1 = T.flush();
    await tick(0);
    eq(fetched.length, 0, '探测还没回，flush 就抢跑了');
    pending[0]();
    eq(await f1, true);
    ageLock(store, T);
    await T.track('heartbeat');
    eq(await T.flush(), true);
    eq(pingCount(sent), 1);
    eq(sends(sent).length, 0);
    eq(fetched.length, 2);
  });

  test('探测成功但某批 SW 返回 false ⇒ 该批回队列，不直连（无重复）', async () => {
    let calls = 0;
    const { T, store, sent, fetched, warnings } = pageSandbox({
      onMessage: (msg, cb) => {
        if (msg.action === 'telemetryPing') return cb && cb({ ok: true });
        calls += 1;
        cb && cb({ ok: false, status: 500 });
      },
    });
    await T.track('heartbeat');
    eq(await T.flush(), false);
    eq(sends(sent).length, 1, '该批只该尝试一次 SW');
    eq(fetched.length, 0, 'SW 失败后不得直连 —— 那会发两遍');
    eq(store[T.KEYS.queue].length, 1, '失败批次没回队列');
    eq(store[T.KEYS.directFail], undefined, 'SW 失败不该记直连失败');
    eq(store.mtTelemetryDropped, undefined, 'SW 失败不该记 dropped');
    eq(directFailWarnings(warnings).length, 0);
    eq(calls, 1);
  });

  test('直连失败（fetch 抛 / 非 2xx）⇒ flush false、队列保留、不增加 dropped', async () => {
    const thrown = pageSandbox({
      onMessage: () => { throw new Error('no receiver'); },
      fetch: async () => { throw new TypeError("Refused to connect ... connect-src 'none'"); },
    });
    await thrown.T.track('heartbeat');
    eq(await thrown.T.flush(), false);
    eq(thrown.store[thrown.T.KEYS.queue].length, 1, '直连抛错后队列丢了');
    eq(thrown.store.mtTelemetryDropped, undefined, '直连失败被误记成 dropped');
    eq(thrown.store.mtTelemetryDirectFail, 1, '直连失败没有本机计数');
    eq(directFailWarnings(thrown.warnings).length, 1);

    const non2xx = pageSandbox({
      onMessage: () => { throw new Error('no receiver'); },
      fetch: async () => ({ ok: false, status: 503 }),
    });
    await non2xx.T.track('heartbeat');
    eq(await non2xx.T.flush(), false);
    eq(non2xx.store[non2xx.T.KEYS.queue].length, 1);
    eq(non2xx.store.mtTelemetryDropped, undefined);
    eq(non2xx.store.mtTelemetryDirectFail, 1);
    eq(directFailWarnings(non2xx.warnings).length, 1);
  });

  test('x-mt-batch 是 16hex、只在 header、body 无 _b；重发同一批复用同一个 id', async () => {
    let calls = 0;
    const { T, store, sent } = pageSandbox({
      onMessage: (msg, cb) => {
        if (msg.action === 'telemetryPing') return cb && cb({ ok: true });
        calls += 1;
        cb && cb(calls === 1 ? { ok: false, status: 500 } : { ok: true });
      },
    });
    await T.track('heartbeat');
    eq(await T.flush(), false);
    const q = store[T.KEYS.queue];
    eq(q.length, 1);
    ok(/^[0-9a-f]{16}$/.test(q[0]._b), '队列项内部没有 16hex _b');

    const first = sends(sent)[0].init;
    const batch1 = first.headers['x-mt-batch'];
    ok(/^[0-9a-f]{16}$/.test(batch1), 'x-mt-batch 不是 16hex');
    eq(batch1, q[0]._b, 'header 与队列里的批次 id 不一致');
    const body1 = JSON.parse(first.body);
    eq(Array.isArray(body1), true);
    eq(body1.length, 1);
    ok(!Object.prototype.hasOwnProperty.call(body1[0], '_b'), 'body 里漏了 _b');
    ok(!Object.keys(body1[0]).includes('_b'));
    // 也不允许把 _b 提升成 body 顶层键（body 是数组，这里顺带守住形状）。
    ok(!Object.prototype.hasOwnProperty.call(body1, '_b'));

    // 失败后**又入队一条新事件**：老批次仍在队首，重发必须沿用同一个 batch id，
    // 新事件排在后面拿到更大的 seq（服务端按 (batch_id, batch_seq) 去重旧行）。
    eq(await T.track('heartbeat'), true);
    eq(store[T.KEYS.queue].length, 2);
    ageLock(store, T);
    eq(await T.flush(), true, '同一批重发应当成功');
    const second = sends(sent)[1].init;
    eq(second.headers['x-mt-batch'], batch1, '重发同一批换了 batch id —— 服务端去重失效');
    const body2 = JSON.parse(second.body);
    eq(body2.length, 2);
    eq(body2[0].name, 'heartbeat');
    eq(body2[1].name, 'heartbeat');
    ok(!Object.prototype.hasOwnProperty.call(body2[0], '_b'));
    ok(!Object.prototype.hasOwnProperty.call(body2[1], '_b'));
  });

  test('SW 路径 init：keepalive / text/plain / 无 Authorization / 带 16hex x-mt-batch', async () => {
    const sw = pageSandbox();
    await sw.T.track('heartbeat');
    eq(await sw.T.flush(), true);
    eq(sw.fetched.length, 0, '探测成功应走 SW，不该直连');
    const swInit = sends(sw.sent)[0].init;
    eq(swInit.keepalive, true);
    eq(swInit.headers['content-type'], 'text/plain');
    eq(hasAuth(swInit.headers), false);
    ok(/^[0-9a-f]{16}$/.test(swInit.headers['x-mt-batch']), 'SW 路径丢了 x-mt-batch');
  });

  test('网页直连 init：不带 x-mt-batch（简单请求，不触发预检）', async () => {
    const direct = pageSandbox({
      onMessage: () => { throw new Error('no receiver'); },
    });
    await direct.T.track('heartbeat');
    eq(await direct.T.flush(), true);
    eq(direct.fetched.length, 1, '探测失败应当直连');
    const directInit = direct.fetched[0].init;
    eq(directInit.keepalive, true);
    eq(directInit.headers['content-type'], 'text/plain');
    eq(hasAuth(directInit.headers), false);
    eq(Object.prototype.hasOwnProperty.call(directInit.headers, 'x-mt-batch'), false,
      '网页直连带 x-mt-batch 会先发 OPTIONS 预检，线上 CORS 未放行');
    eq(Object.keys(directInit.headers).some((k) => /^x-mt-batch$/i.test(k)), false);
    const body = JSON.parse(directInit.body);
    eq(Array.isArray(body), true);
    ok(!Object.prototype.hasOwnProperty.call(body, '_b'), 'body 顶层漏了 _b');
    ok(!Object.prototype.hasOwnProperty.call(body[0], '_b'), 'body 里漏了 _b');
  });

  test('扩展页（非 http(s)）不探测、直接直连且仍带 x-mt-batch（回归）', async () => {
    const { T, sent, fetched } = pageSandbox({ webPage: false });
    eq(await T.track('heartbeat'), true);
    eq(await T.flush(), true);
    eq(sent.length, 0, '扩展页不该发 telemetryPing');
    eq(fetched.length, 1, '扩展页应当直连');
    eq(fetched[0].url, INGEST);
    ok(/^[0-9a-f]{16}$/.test(fetched[0].init.headers['x-mt-batch']),
      '扩展页不受页面 CORS 管，仍应带批次头');
    eq(fetched[0].init.headers['content-type'], 'text/plain');
    eq(fetched[0].init.keepalive, true);
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
  test('后台 telemetryPing 立即回 {ok:true}，不发起 fetch', async () => {
    const { listeners, calls } = backgroundLoader();
    deepEq(await sendBackground(listeners, { action: 'telemetryPing' }), { ok: true });
    eq(calls.length, 0, '探测不该触发任何网络请求');
  });

  test('SW 白名单 / 64KB 体限 / 拒收不变；x-mt-batch 头原样转发', async () => {
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
