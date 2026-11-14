// test/stall-deadline.test.js — 120 s stall 最小修复的红→绿回归。
//
// 真实产品路径：加载 extension/content/translation-core.js + translation-api.js
// （以及它们依赖的 request-shape / wire-format / engine-state / providers.gen）。
// 网络全程是桩：
//   · proxyFetch 的 sendMessage 永不应答（模拟“ping 通但后台不回答”）；
//   · directFetch 是一个只在 AbortSignal 上失败的 blackhole（模拟连接被挂住）；
//   · 不建 socket、不读凭证、不发任何真实请求。
//
// 三条断言对应已被隔离复现的三条机制：
//   A. 传输总预算（STALL_MS - STALL_RESERVE_MS）必须在 watchdog 之前收口；
//   B. 排队等待不算执行时间，尚未发出的单元不会在 watchdog 处 stall；
//   C. watchdog 取消会 abort 在飞传输并释放并发槽，不再继续发过期任务。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, tick, loadModule } = require('./harness');

const ROOT = path.join(__dirname, '..');
const ENDPOINT = 'http://127.0.0.1:9/functions/v1/bt-relay/chat/completions';
const FAKE_KEY = 'sk-test_stall_deadline_only';

function abortErr() {
  const e = new Error('aborted by test');
  e.name = 'AbortError';
  e.code = 'aborted';
  return e;
}

function makeWorld(opts) {
  const o = opts || {};
  const prefs = Object.assign({
    reqConcurrency: 5,
    reqTimeoutSec: 1,
  }, o.prefs || {});
  const state = {
    dead: false,
    mode: 'blackhole',
    proxyCalls: [],
    fetchCalls: [],
    pendingProxy: [],
    pendingFetch: [],
  };
  const store = Object.assign({}, prefs);

  function norm(keys) {
    let out = {};
    if (keys == null) out = Object.assign({}, store);
    else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
    else if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
    else Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
    return out;
  }

  const chrome = {
    i18n: { getUILanguage: () => 'en-US', getMessage: () => '' },
    storage: {
      local: {
        get: (keys, cb) => { const out = norm(keys); setTimeout(() => { if (cb) cb(out); }, 0); return Promise.resolve(out); },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) setTimeout(cb, 0); return Promise.resolve(); },
        remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; }); if (cb) setTimeout(cb, 0); return Promise.resolve(); },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + (p || ''),
      sendMessage: (msg) => {
        if (msg && msg.action === 'ping') return Promise.resolve({ ok: true });
        if (msg && msg.action === 'cancelProxyFetch') {
          for (const e of state.pendingProxy.slice()) {
            if (e.requestId === msg.requestId) {
              const i = state.pendingProxy.indexOf(e);
              if (i >= 0) state.pendingProxy.splice(i, 1);
              e.reject(abortErr());
            }
          }
          return Promise.resolve({ ok: true });
        }
        if (msg && msg.action === 'proxyFetch') {
          state.proxyCalls.push(msg);
          if (state.dead) return Promise.reject(abortErr());
          if (state.mode === 'ok') {
            return Promise.resolve({
              ok: true, status: 200, statusText: 'OK', retryAfterHeader: null,
              text: JSON.stringify({ choices: [{ message: { content: '译文' } }] }),
            });
          }
          if (state.mode === 'busy') {
            return Promise.resolve({
              ok: false, status: 429, statusText: 'Too Many Requests', retryAfterHeader: null,
              text: JSON.stringify({ error: 'busy' }),
            });
          }
          return new Promise((resolve, reject) => {
            state.pendingProxy.push({ requestId: msg.requestId, resolve, reject });
          });
        }
        return Promise.resolve(undefined);
      },
    },
  };

  const sandbox = {
    window: {},
    chrome,
    AbortController,
    URL,
    TextEncoder,
    TextDecoder,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    performance: { now: () => Date.now() },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
    },
    fetch: async (url, fopts) => {
      const fo = fopts || {};
      const rec = { url: String(url), at: Date.now(), signal: fo.signal };
      state.fetchCalls.push(rec);
      if (state.dead) throw abortErr();
      if (state.mode === 'ok') {
        return {
          ok: true, status: 200, statusText: 'OK',
          text: async () => JSON.stringify({ choices: [{ message: { content: '译文' } }] }),
          json: async () => ({ choices: [{ message: { content: '译文' } }] }),
          headers: { get: () => null },
        };
      }
      return await new Promise((resolve, reject) => {
        let onAbort = null;
        const finish = (err) => {
          const i = state.pendingFetch.indexOf(rec);
          if (i >= 0) state.pendingFetch.splice(i, 1);
          if (onAbort && fo.signal) fo.signal.removeEventListener('abort', onAbort);
          reject(err);
        };
        rec.abort = () => finish(abortErr());
        state.pendingFetch.push(rec);
        if (fo.signal) {
          onAbort = () => finish(abortErr());
          if (fo.signal.aborted) return onAbort();
          fo.signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    },
  };

  const ctx = loadModule([
    'content/i18n-messages.js',
    'content/providers.gen.js',
    'content/translation-core.js',
    'content/engine-state.js',
    'content/wire-format.js',
    'content/request-shape.js',
    'content/translation-api.js',
  ], sandbox);

  function kill() {
    state.dead = true;
    for (const e of state.pendingProxy.splice(0)) {
      try { e.reject(abortErr()); } catch (_) {}
    }
    for (const rec of state.pendingFetch.splice(0)) {
      try { rec.abort(); } catch (_) {}
    }
  }

  return { ctx, state, kill, store };
}

function engineWindow(over) {
  return Object.assign({
    AHEAD_MS: 0, MAX_PER_TICK: 5, MAX_RETRIES: 3, RETRY_GAP_MS: 100, GRACE_MS: 0,
    STALL_MS: 3000, STALL_RESERVE_MS: 300,
  }, over || {});
}

function taskWrapper(api, tasks) {
  const fn = async (text, ctl) => {
    const t = { text, started: Date.now(), ended: 0 };
    tasks.push(t);
    try {
      return await api.translate(text, 'zh-CN', 'deepseek', FAKE_KEY,
        ENDPOINT, 'deepseek-chat', ctl);
    } finally {
      t.ended = Date.now();
    }
  };
  fn.__mtDeadlineAware = true;
  return fn;
}

function unitText(tag, i) {
  return `${tag}-${String(i).padStart(2, '0')}: the quick brown fox jumps over the lazy dog, sentence ${i}.`;
}

describe('stall / deadline / queue cancellation', () => {
  test('A: transport deadline settles before the 120 s-style watchdog', async () => {
    const w = makeWorld({ prefs: { reqTimeoutSec: 1, reqConcurrency: 5 } });
    const api = w.ctx.TranslationAPI;
    const fails = [];
    const tasks = [];
    const engine = w.ctx.TranslationCore.createEngine({
      translate: taskWrapper(api, tasks),
      targetLang: 'zh-CN',
      selectActive: (us) => us,
      detect: null,
      window: engineWindow(),
      onFail: (e) => fails.push(e),
    });
    const units = [{ text: unitText('UNIT', 1) }];
    engine.setUnits(units);
    const timer = setInterval(() => engine.pump(), 50);
    engine.pump();
    try {
      await tick(3400);
    } finally {
      clearInterval(timer);
    }
    ok(fails.length === 1, `expected exactly one engine failure, got ${fails.length}: ${JSON.stringify(fails)}`);
    ok(!fails[0].stalled, 'engine watchdog must not fire before the transport deadline');
    eq(fails[0].code, 'timeout', 'deadline exhaustion is a timeout, not a stall');
    ok(Number.isInteger(fails[0].ms), 'deadline failure must carry ms (apiFetch measures it)');
    ok(fails[0].route === 'proxy' || fails[0].route === 'direct', 'deadline failure must carry route');
    ok(tasks.length === 1 && tasks[0].ended > 0, 'in-flight transport task must settle');
    const dur = tasks[0].ended - tasks[0].started;
    ok(dur < 2900, `transport must settle before the 3000 ms watchdog (took ${dur} ms)`);

    // 槽必须已释放：下一次调用应能立刻开始并成功，而不是排在死任务后面。
    w.state.mode = 'ok';
    const next = api.translate('SECOND: after the deadline', 'zh-CN', 'deepseek', FAKE_KEY, ENDPOINT, 'deepseek-chat', { noCache: true });
    const started = await Promise.race([next.then(() => true, () => true), tick(500).then(() => false)]);
    ok(started, 'concurrency slot must be released after the deadline failure');
    w.kill();
    await tick(50);
  });

  test('B: queued units are not stalled by time spent in the queue', async () => {
    const w = makeWorld({ prefs: { reqTimeoutSec: 1, reqConcurrency: 5 } });
    const api = w.ctx.TranslationAPI;
    const blockerTasks = [];
    const blockers = [];
    for (let i = 1; i <= 5; i++) {
      const t = { started: Date.now(), ended: 0 };
      blockerTasks.push(t);
      blockers.push(api.translate(unitText('BLOCK', i), 'zh-CN', 'deepseek', FAKE_KEY, ENDPOINT, 'deepseek-chat',
        { budgetMs: 2700 }).then(() => {}, () => {}).finally(() => { t.ended = Date.now(); }));
    }
    await tick(100);
    const fails = [];
    const unitTasks = [];
    const engine = w.ctx.TranslationCore.createEngine({
      translate: taskWrapper(api, unitTasks),
      targetLang: 'zh-CN',
      selectActive: (us) => us,
      detect: null,
      window: engineWindow(),
      onFail: (e) => fails.push(e),
    });
    const units = Array.from({ length: 10 }, (_, i) => ({ text: unitText('UNIT', i + 1) }));
    engine.setUnits(units);
    const timer = setInterval(() => engine.pump(), 50);
    engine.pump();
    try {
      await tick(3300);
    } finally {
      clearInterval(timer);
    }
    ok(fails.every((f) => !f.stalled), `no queued unit may stall: ${JSON.stringify(fails)}`);
    ok(fails.length === 0, `no unit should fail while queued/running: ${JSON.stringify(fails)}`);
    ok(blockerTasks.every((t) => t.ended > 0), '5 blockers must release their slots by their deadline');
    ok(blockerTasks.every((t) => t.ended - t.started < 2900), 'blockers must end before the watchdog');
    const unitCalls = w.state.proxyCalls.filter((m) => /UNIT-/.test(JSON.stringify(m.init && m.init.body || '')));
    ok(unitCalls.length >= 5, `queued units must actually start after slots free (got ${unitCalls.length})`);
    ok(units.every((u) => !u._err), `units must not be marked errored while waiting/running: ${JSON.stringify(units.map((u) => !!u._err))}`);
    w.kill();
    await tick(50);
  });

  test('C: engine stall aborts the in-flight transport and frees the slot', async () => {
    const w = makeWorld({ prefs: { reqTimeoutSec: 5, reqConcurrency: 5 } });
    const api = w.ctx.TranslationAPI;
    const fails = [];
    const tasks = [];
    const raw = taskWrapper(api, tasks);
    // 这条用例故意让传输预算大于 watchdog：验证 watchdog 自己的取消路径，
    // 而不是让传输 deadline 先收口。
    const translate = (text, ctl) => { if (ctl) ctl.budgetMs = 60000; return raw(text, ctl); };
    translate.__mtDeadlineAware = true;
    const engine = w.ctx.TranslationCore.createEngine({
      translate,
      targetLang: 'zh-CN',
      selectActive: (us) => us,
      detect: null,
      window: engineWindow({ STALL_MS: 1000, STALL_RESERVE_MS: 100 }),
      onFail: (e) => fails.push(e),
    });
    const units = [{ text: unitText('UNIT', 1) }];
    engine.setUnits(units);
    const timer = setInterval(() => engine.pump(), 50);
    engine.pump();
    try {
      await tick(1800);
    } finally {
      clearInterval(timer);
    }
    ok(fails.length === 1 && fails[0].code === 'stalled', `watchdog must report a stall once: ${JSON.stringify(fails)}`);
    ok(tasks.length === 1 && tasks[0].ended > 0, 'stalled transport must be aborted, not left in flight');
    ok(tasks[0].ended - tasks[0].started < 1600, 'abort must land promptly after the watchdog');
    ok(w.state.fetchCalls.length === 0, `abort must stop the proxy→direct fallback (direct attempts: ${w.state.fetchCalls.length})`);

    w.state.mode = 'ok';
    const next = api.translate('SECOND: after the stall', 'zh-CN', 'deepseek', FAKE_KEY, ENDPOINT, 'deepseek-chat', { noCache: true });
    const started = await Promise.race([next.then(() => true, () => true), tick(500).then(() => false)]);
    ok(started, 'slot must be released after the stalled transport is aborted');
    w.kill();
    await tick(50);
  });

  test('D: background proxyFetch honors cancelProxyFetch', async () => {
    let listener = null;
    let aborted = false;
    const chrome = {
      runtime: {
        getURL: (p) => 'chrome-extension://test/' + (p || ''),
        onMessage: { addListener: (fn) => { if (!listener) listener = fn; } },
        onInstalled: { addListener() {} },
      },
      storage: { local: { get: (k, cb) => { if (cb) cb({}); }, set: (o, cb) => { if (cb) cb(); }, remove: (k, cb) => { if (cb) cb(); } }, onChanged: { addListener() {} } },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    };
    const fetchStub = (url, fopts) => new Promise((resolve, reject) => {
      const sig = fopts && fopts.signal;
      const onAbort = () => { aborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
      if (sig) { if (sig.aborted) return onAbort(); sig.addEventListener('abort', onAbort, { once: true }); }
    });
    loadModule('../extension/background.js', { chrome, fetch: fetchStub, AbortController, URL });
    ok(typeof listener === 'function', 'background onMessage listener must register');
    const done = new Promise((resolve) => {
      listener({ action: 'proxyFetch', requestId: 'r1', url: 'https://example.invalid/v1/chat/completions', init: { method: 'POST', headers: {}, body: '{}' } }, {}, resolve);
    });
    await tick(20);
    listener({ action: 'cancelProxyFetch', requestId: 'r1' }, {}, () => {});
    await tick(20);
    ok(aborted, 'cancelProxyFetch must abort the background fetch');
    await Promise.race([done, tick(50)]);
  });

  test('F: 429 {"error":"busy"} stays retryable=false at transport, engine retries only 3x', async () => {
    const w = makeWorld({ prefs: { reqTimeoutSec: 1, reqConcurrency: 5 } });
    const api = w.ctx.TranslationAPI;
    w.state.mode = 'busy';
    const direct = await api.translate('BUSY-01: direct transport call', 'zh-CN', 'deepseek', FAKE_KEY,
      ENDPOINT, 'deepseek-chat', { noCache: true }).then(() => null, (e) => e);
    ok(direct && direct.code === 'busy', `expected code=busy, got ${JSON.stringify(direct && { code: direct.code, status: direct.status })}`);
    eq(direct.retryable, false, 'busy must stay retryable=false');
    eq(w.state.proxyCalls.length, 1, 'transport must not retry busy');
    eq(w.state.fetchCalls.length, 0, 'busy must not fall back to direct');

    const fails = [];
    const tasks = [];
    const engine = w.ctx.TranslationCore.createEngine({
      translate: taskWrapper(api, tasks),
      targetLang: 'zh-CN',
      selectActive: (us) => us,
      detect: null,
      window: engineWindow(),
      onFail: (e) => fails.push(e),
    });
    engine.setUnits([{ text: unitText('BUSY', 1) }]);
    const timer = setInterval(() => engine.pump(), 50);
    engine.pump();
    try {
      await tick(1200);
    } finally {
      clearInterval(timer);
    }
    eq(tasks.length, 3, 'engine may retry a busy unit at most 3x');
    eq(w.state.proxyCalls.length, 4, '3 engine attempts × 1 transport attempt = 3 client requests (plus the direct probe)');
    ok(fails.length === 1 && fails[0].status === 429, `final engine failure must be http/429: ${JSON.stringify(fails)}`);
    w.kill();
    await tick(50);
  });

  test('E: every product adapter opts into the execution-start watchdog', () => {
    for (const f of ['content-webpage.js', 'subtitle-adapter.js', 'content-youtube.js', 'content-twitter.js', 'content-podcast.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'extension', 'content', f), 'utf8');
      ok(src.includes('__mtDeadlineAware'), `${f} must declare __mtDeadlineAware`);
      ok(src.includes('ctl'), `${f} must forward the engine control object`);
    }
  });
});
