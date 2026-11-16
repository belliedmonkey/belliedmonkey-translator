// test/bel277-telemetry-sw.test.js — BEL-277：内容脚本遥测经 SW 代发。
//
// 两条边界在这里钉死：
//  ① 网页内容脚本（http/https）不走直接 fetch，只发 {action:'telemetrySend', url, init}；
//     扩展页 / App 保持直连。SW 不可用 / 非 2xx / 超时 ⇒ false，flush 把批次放回队列。
//  ② SW 只放行本 build 的 ingest 端点（origin+pathname 逐字相等）、body ≤64KB；
//     其他 URL 一律拒绝。被 SW 拒绝的批次同样留在队列，不静默丢。
const { loadModule, describe, test, ok, eq, deepEq, tick } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const INGEST = 'https://ingest.test/functions/v1/bt-ingest';
const TEL = {
  url: INGEST,
  spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
};

function contentSandbox(opts = {}) {
  const store = {};
  const sent = [];
  const warnings = [];
  const fetched = [];
  const sandbox = {
    window: { MT_VERSION: '9.9.9', MT_FLAVOR: 'global', MT_TELEMETRY: opts.telemetry || TEL },
    location: { protocol: 'https:' },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1.15', platform: 'iPhone', language: 'zh-CN' },
    crypto: require('crypto').webcrypto,
    console: Object.assign({}, console, { warn: (...a) => warnings.push(a) }),
    fetch: async (url, init) => { fetched.push({ url, init }); return { ok: true }; },
    chrome: {
      i18n: { getUILanguage: () => 'zh-CN' },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
        remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
      } },
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          sent.push(msg);
          if (opts.sendMessage) return opts.sendMessage(msg, cb);
          cb && cb({ ok: true });
          return undefined;
        },
      },
    },
  };
  if (opts.store) Object.assign(store, opts.store);
  if (opts.setTimeout) sandbox.setTimeout = opts.setTimeout;
  if (opts.clearTimeout) sandbox.clearTimeout = opts.clearTimeout;
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, sent, warnings, fetched };
}

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
    if (opts.ingestError) throw opts.ingestError;
    return opts.ingestResponse || { ok: true, status: 200 };
  };
  loadModule('./background.js', {
    chrome, fetch: fetchImpl, AbortController, URL, setTimeout, clearTimeout, console,
  });
  eq(listeners.length >= 1, true, 'background 没有注册 onMessage 监听器');
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

describe('BEL-277 SW — 内容脚本路由与队列保留', () => {
  test('http(s) 内容脚本：SW 成功 ⇒ 只发 runtime 消息，不直接 fetch', async () => {
    const { T, store, sent, fetched } = contentSandbox();
    eq(await T.track('heartbeat'), true);
    eq(await T.flush(), true);
    eq(fetched.length, 0, '内容脚本直接 fetch 了 —— 页面 CSP 会把它拦掉');
    eq(sent.length, 1);
    eq(sent[0].action, 'telemetrySend');
    eq(sent[0].url, INGEST);
    eq(sent[0].init.method, 'POST');
    eq(sent[0].init.headers['content-type'], 'text/plain');
    const body = JSON.parse(sent[0].init.body);
    eq(Array.isArray(body) && body.length, 1);
    eq(body[0].name, 'heartbeat');
    eq(store[T.KEYS.queue].length, 0, '成功之后队列没清');
  });

  test('SW 非 2xx ⇒ flush false，批次放回队列（不静默丢）', async () => {
    const { T, store } = contentSandbox({
      sendMessage: (msg, cb) => { cb({ ok: false, status: 500 }); },
    });
    await T.track('heartbeat');
    eq(await T.flush(), false);
    eq(store[T.KEYS.queue].length, 1, '失败批次没回队列');
  });

  test('SW 不可用（sendMessage 抛）⇒ 队列保留', async () => {
    const { T, store } = contentSandbox({
      sendMessage: () => { throw new Error('Could not establish connection.'); },
    });
    await T.track('heartbeat');
    eq(await T.flush(), false);
    eq(store[T.KEYS.queue].length, 1);
  });

  test('SW 超时 ⇒ 队列保留（timeout 兜底，不悬着）', async () => {
    const timers = [];
    const realSet = setTimeout, realClear = clearTimeout;
    const { T, store } = contentSandbox({
      sendMessage: () => undefined,   // 永不回调
      setTimeout: (fn, ms) => {
        if (ms === 15000) { timers.push(fn); return 999; }   // SW_TIMEOUT_MS
        return realSet(fn, ms);
      },
      clearTimeout: (id) => { if (id !== 999) realClear(id); },
    });
    await T.track('heartbeat');
    const f = T.flush();
    await tick(0);
    eq(timers.length, 1, '没有安排 SW 超时');
    timers[0]();
    eq(await f, false);
    eq(store[T.KEYS.queue].length, 1);
  });

  test('扩展页（chrome-extension://）保持直连 fetch', async () => {
    // 无 location 的 context 走扩展页 / App 分支（内容页才有 http(s) protocol）。
    const store = {};
    const direct = [];
    const ctx = loadModule(['learn/telemetry.js'], {
      window: { MT_VERSION: '9.9.9', MT_FLAVOR: 'global', MT_TELEMETRY: TEL },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1.15', platform: 'iPhone', language: 'zh-CN' },
      crypto: require('crypto').webcrypto,
      fetch: async (url, init) => { direct.push({ url, init }); return { ok: true }; },
      chrome: {
        i18n: { getUILanguage: () => 'en' },
        storage: { local: {
          get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
          set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
          remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
        } },
        runtime: { lastError: null, sendMessage: () => { throw new Error('extension page must not use SW'); } },
      },
    });
    await ctx.MTTelemetry.track('heartbeat');
    eq(await ctx.MTTelemetry.flush(), true);
    eq(direct.length, 1, '扩展页直连 fetch 丢了');
    eq(direct[0].url, INGEST);
  });

  test('队列 >200：丢最旧、计数进 storage（不是事件）、console.warn 不静默', async () => {
    const old = Array.from({ length: 200 }, () => ({ name: 'heartbeat', props: {}, ts: '2026-01-01T00:00:00Z' }));
    const { T, store, warnings } = contentSandbox({ store: { 'tm:last': Date.now(), 'tm:queue': old } });
    eq(await T.track('heartbeat'), true);
    eq(store[T.KEYS.queue].length, T.QUEUE_CAP);
    eq(store.mtTelemetryDropped, 1, 'mtTelemetryDropped 没累加');
    eq(warnings.length, 1);
    eq(warnings[0][0], '[mt] telemetry dropped');
    eq(warnings[0][1], 1);
    eq(qNames(store, T).includes('heartbeat'), true);
  });

  test('正常页 payload 回归：信封字段/事件 props 与直连路径同一形状', async () => {
    const sw = contentSandbox();
    await sw.T.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 12 });
    await sw.T.flush();
    const viaSw = JSON.parse(sw.sent[0].init.body)[0];

    const store = {};
    const direct = [];
    const ctx = loadModule(['learn/telemetry.js'], {
      window: { MT_VERSION: '9.9.9', MT_FLAVOR: 'global', MT_TELEMETRY: TEL },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1.15', platform: 'iPhone', language: 'zh-CN' },
      crypto: require('crypto').webcrypto,
      fetch: async (url, init) => { direct.push({ url, init }); return { ok: true }; },
      chrome: {
        i18n: { getUILanguage: () => 'en' },
        storage: { local: {
          get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
          set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
          remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
        } },
        runtime: { lastError: null, sendMessage: () => { throw new Error('extension page must not use SW'); } },
      },
    });
    await ctx.MTTelemetry.track('translate_ok', { provider: 'deepseek', kind: 'page', ms: 12 });
    await ctx.MTTelemetry.flush();
    const viaDirect = JSON.parse(direct[0].init.body)[0];

    eq(Object.keys(viaSw).sort().join(','), Object.keys(viaDirect).sort().join(','));
    eq(viaSw.name, viaDirect.name);
    deepEq(viaSw.props, viaDirect.props);
    eq(viaSw.host, viaDirect.host);
    eq(viaSw.device, viaDirect.device);
    eq(viaSw.v, viaDirect.v);
    ok(/^[0-9a-f-]{36}$/.test(viaSw.install_id));
  });
});

function qNames(store, T) {
  return (store[T.KEYS.queue] || []).map((e) => e.name);
}

describe('BEL-277 SW — background 端点白名单 / 体限 / 失败', () => {
  const body = JSON.stringify([{ name: 'heartbeat' }]);

  test('命中本 build ingest ⇒ fetch 发出，返回 ok:true', async () => {
    const { listeners, calls } = backgroundLoader();
    const r = await sendBackground(listeners, { action: 'telemetrySend', url: INGEST, init: { method: 'POST', body } });
    deepEq(r, { ok: true, status: 200 });
    eq(calls.length, 1);
    eq(calls[0].url, INGEST);
    eq(calls[0].init.body, body);
  });

  test('其他 host 拒绝（不 fetch）', async () => {
    const { listeners, calls } = backgroundLoader();
    const r = await sendBackground(listeners, { action: 'telemetrySend', url: 'https://evil.test/functions/v1/bt-ingest', init: { method: 'POST', body } });
    eq(r.ok, false);
    eq(r.error, 'url_not_allowed');
    eq(calls.length, 0, '被拒绝的 URL 仍然被 fetch 了');
  });

  test('同 host 的其他 path / query / http 拒绝', async () => {
    const { listeners, calls } = backgroundLoader();
    for (const u of [
      'https://ingest.test/functions/v1/bt-ingest/evil',
      'https://ingest.test/functions/v1/bt-ingest?x=1',
      'https://ingest.test/functions/v1/whatever',
      'http://ingest.test/functions/v1/bt-ingest',
    ]) {
      const r = await sendBackground(listeners, { action: 'telemetrySend', url: u, init: { method: 'POST', body } });
      eq(r.ok, false, u);
    }
    eq(calls.length, 0);
  });

  test('body >64KB 拒绝；恰好 64KB 放行', async () => {
    const { listeners, calls } = backgroundLoader();
    const tooBig = 'x'.repeat(64 * 1024 + 1);
    const r1 = await sendBackground(listeners, { action: 'telemetrySend', url: INGEST, init: { method: 'POST', body: tooBig } });
    eq(r1.ok, false);
    eq(r1.error, 'body_too_large');
    eq(calls.length, 0);
    const okBody = 'x'.repeat(64 * 1024);
    const r2 = await sendBackground(listeners, { action: 'telemetrySend', url: INGEST, init: { method: 'POST', body: okBody } });
    eq(r2.ok, true);
    eq(calls.length, 1);
  });

  test('ingest 非 2xx ⇒ {ok:false,status}（内容脚本据此回队列）', async () => {
    const { listeners } = backgroundLoader({ ingestResponse: { ok: false, status: 503 } });
    const r = await sendBackground(listeners, { action: 'telemetrySend', url: INGEST, init: { method: 'POST', body } });
    eq(r.ok, false);
    eq(r.status, 503);
  });

  test('端点清单读取失败 ⇒ fail closed（全拒绝）', async () => {
    const { listeners, calls } = backgroundLoader({ allowlistError: true });
    const r = await sendBackground(listeners, { action: 'telemetrySend', url: INGEST, init: { method: 'POST', body } });
    eq(r.ok, false);
    eq(r.error, 'url_not_allowed');
    eq(calls.length, 0);
  });

  test('非 telemetrySend 消息不占回话权（不影响 getSettings / proxyFetch）', async () => {
    const { listeners } = backgroundLoader();
    const telemetry = listeners[listeners.length - 1];
    eq(telemetry({ action: 'getSettings' }, {}, () => {}), undefined,
      'telemetry 监听器对别的消息返回 true —— 会吞掉后面的回话');
    eq(telemetry({ action: 'proxyFetch', url: 'https://x.test/', init: {} }, {}, () => {}), undefined);
  });
});
