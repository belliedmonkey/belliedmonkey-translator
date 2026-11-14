// test/ocr-listen-deadline.test.js — OCR / listenPass cancellation and body deadline.
//
// Real product path: translation-api.js + request-shape.js + engine-state.js loaded in
// the browser's file order. Network is 100% local:
//   · proxyFetch is a chrome.runtime.sendMessage stub (ping says "worker is dead", so
//     apiFetch takes the direct route — the Safari-after-lock shape);
//   · fetch is a local function; endpoints are http://127.0.0.1:9/... (discard port)
//     and are never dialled.
// No socket, no token, no .env, no keychain. Production product requests = 0.
//
// The three defects this pins down (mechanism reproduction, not an incident verdict):
//   A. ocr()/listenPass() ignored opts.signal → queued work was still sent after abort;
//   B. directFetch cleared its timer at response headers → a hung body held a slot forever;
//   C. a timeout/abort never released the slot because the promise never settled.
//
// The 110 s transport budget / 120 s watchdog are NOT changed here. 109 s succeeds,
// 110 s is the boundary, and a 115 s sixth leg is an intentional cut (see RESULT.md).

const { describe, test, ok, eq, tick, loadModule } = require('./harness');

const ENDPOINT = 'http://127.0.0.1:9/v1/chat/completions';
const FAKE_KEY = 'sk-test_ocr_listen_only';

function abortErr() { const e = new Error('aborted by test'); e.name = 'AbortError'; return e; }
function bodyAbortErr() { const e = new Error('body aborted by test'); e.name = 'AbortError'; return e; }
function chatBody(text) { return JSON.stringify({ choices: [{ message: { content: text } }] }); }

function response(text) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
    text: async () => chatBody(text), json: async () => JSON.parse(chatBody(text)) };
}
// Headers arrive now; the body never ends until the request is aborted.
function bodyHang(signal) {
  const never = () => new Promise((_, reject) => {
    if (!signal) return;
    const onAbort = () => reject(bodyAbortErr());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: never, json: never };
}
// Headers arrive now; the body arrives in `ms` unless aborted first.
function delayedBody(signal, ms, text) {
  const body = () => new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => { if (timer) clearTimeout(timer); reject(bodyAbortErr()); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(chatBody(text)); }, ms);
  });
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: body, json: async () => JSON.parse(await body()) };
}
function hangNoResponse(signal) {
  return new Promise((_, reject) => {
    if (!signal) return;                       // no signal ⇒ never settles (a true hang)
    const onAbort = () => reject(abortErr());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function makeWorld(plan) {
  const store = { reqConcurrency: 5, reqTimeoutSec: 5 };
  const state = { fetchCalls: [], proxyCalls: [] };
  const chrome = {
    i18n: { getUILanguage: () => 'en-US', getMessage: () => '' },
    storage: {
      local: {
        get: (keys, cb) => { const out = Object.assign({}, store); if (cb) setTimeout(() => cb(out), 0); return Promise.resolve(out); },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) setTimeout(cb, 0); return Promise.resolve(); },
        remove: (keys, cb) => { if (cb) setTimeout(cb, 0); return Promise.resolve(); },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + (p || ''),
      // ping: worker unreachable, so apiFetch tries direct first (Safari after lock).
      sendMessage: (msg) => {
        if (msg && msg.action === 'ping') return Promise.resolve({ ok: false });
        if (msg && msg.action === 'cancelProxyFetch') return Promise.resolve({ ok: true });
        if (msg && msg.action === 'proxyFetch') { state.proxyCalls.push(msg); return new Promise(() => {}); }
        return Promise.resolve(undefined);
      },
    },
  };
  const sandbox = {
    window: {}, chrome, AbortController, URL, TextEncoder, TextDecoder,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    performance: { now: () => Date.now() },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }), body: { appendChild() {} }, documentElement: { appendChild() {} } },
    fetch: (url, opts) => {
      const call = { url: String(url), signal: opts && opts.signal };
      state.fetchCalls.push(call);
      try { return Promise.resolve(plan(call, state.fetchCalls.length)); } catch (e) { return Promise.reject(e); }
    },
  };
  const ctx = loadModule([
    'content/i18n-messages.js', 'content/providers.gen.js', 'content/translation-core.js',
    'content/engine-state.js', 'content/wire-format.js', 'content/request-shape.js',
    'content/translation-api.js',
  ], sandbox);
  return { api: ctx.TranslationAPI, state };
}

async function outcome(p) {
  return Promise.race([p.then((ok) => ({ ok }), (err) => ({ err: (err && err.code) || (err && err.message), name: err && err.name, aborted: !!err && !!err.aborted })), tick(1200).then(() => ({ pending: true }))]);
}

describe('OCR / listenPass cancellation and body deadline', () => {
  test('queued OCR aborted: no 6th fetch, no stale result', async () => {
    let n = 0;
    const w = makeWorld((call) => { n++; return n <= 5 ? hangNoResponse(call.signal) : response('STALE-OCR-RESULT'); });
    for (let i = 0; i < 5; i++) {
      // timeoutMs is per attempt: the five blockers end by themselves, the queued one
      // must be removed by its caller before a 6th slot ever frees.
      w.api.ocr('data:image/png;base64,AA' + i, 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { timeoutMs: 250 }).catch(() => {});
    }
    await tick(30);
    const ac = new AbortController();
    const q = outcome(w.api.ocr('data:image/png;base64,QUEUED', 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { signal: ac.signal }));
    ac.abort();
    const r = await q;
    await tick(350);
    eq(r.err, 'aborted', 'queued ocr() must reject as aborted');
    eq(r.aborted, true, 'aborted must be a named terminal state');
    eq(w.state.fetchCalls.length, 5, 'an aborted queued OCR must never send a 6th fetch (stale result must not exist)');
  });

  test('queued listenPass aborted: no 6th fetch, no stale result', async () => {
    let n = 0;
    const w = makeWorld((call) => { n++; return n <= 5 ? hangNoResponse(call.signal) : response('STALE-LISTEN-RESULT'); });
    for (let i = 0; i < 5; i++) w.api.ocr('data:image/png;base64,AB' + i, 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { timeoutMs: 250 }).catch(() => {});
    await tick(30);
    const ac = new AbortController();
    const q = outcome(w.api.listenPass({ system: 'S', user: 'U' }, 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { signal: ac.signal }));
    ac.abort();
    const r = await q;
    await tick(350);
    eq(r.err, 'aborted', 'queued listenPass() must reject as aborted');
    eq(w.state.fetchCalls.length, 5, 'an aborted queued listenPass must never send a 6th fetch');
  });

  test('listenPass body-hang honours timeoutMs and frees the slot', async () => {
    let n = 0;
    const w = makeWorld((call) => { n++; return n === 1 ? bodyHang(call.signal) : response('NEXT-OK'); });
    const t0 = Date.now();
    const r = await outcome(w.api.listenPass({ system: 'S', user: 'U' }, 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { timeoutMs: 200 }));
    const ms = Date.now() - t0;
    eq(r.err, 'timeout', 'a stalled response body must end as timeout, not stay pending');
    ok(ms < 1000, `body timeout must fire promptly (took ${ms} ms)`);
    // The slot must be free for the next request (finally on the promise chain).
    const next = await outcome(w.api.translate('after body timeout unique', 'zh-CN', 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { budgetMs: 5000 }));
    eq(next.ok, 'NEXT-OK', 'the slot must be released after a body timeout');
  });

  test('in-flight OCR body: abort is terminal and a late body is ignored', async () => {
    const w = makeWorld((call) => delayedBody(call.signal, 400, 'LATE-OCR-RESULT'));
    const ac = new AbortController();
    const p = outcome(w.api.ocr('data:image/png;base64,LATE', 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { signal: ac.signal, deadline: Date.now() + 5000 }));
    await tick(50);
    ac.abort();
    const first = await p;
    await tick(500);                              // let the late body land
    const still = await Promise.race([p, tick(10).then(() => first)]);
    eq(first.err, 'aborted', 'abort after headers must reject the OCR as aborted');
    eq(still.err, 'aborted', 'the single terminal state must not be overwritten by a late body');
    ok(JSON.stringify(still).indexOf('LATE-OCR-RESULT') < 0, 'a late body must not be delivered');
  });

  test('normal OCR and listenPass still succeed', async () => {
    const w = makeWorld(() => response('NORMAL-TEXT'));
    eq(await w.api.ocr('data:image/png;base64,AA', 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini'), 'NORMAL-TEXT');
    eq(await w.api.listenPass({ system: 'S', user: 'U' }, 'openai', FAKE_KEY, ENDPOINT, 'gpt-4o-mini', { timeoutMs: 1000 }), 'NORMAL-TEXT');
  });
});
