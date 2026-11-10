// test/http-shim.test.js — the page half of the native HTTP bridge (1.23.4 C5).
//
// The shim is injected at document start, so the two things that can silently break
// are exactly the two things this file pins:
//   · it takes over ONLY the allowlisted host+method, and falls back to the original
//     fetch for everything else (a wildcard here would turn the App into a proxy);
//   · an AbortSignal must send `{id, cancel:true}` and reject with AbortError, not
//     merely race a Promise (the Swift task has to be cancelled too).
//
// The allowlist JSON is substituted by scripts/sync-app-assets.js at sync time; the
// test substitutes it directly so the shim's logic is exercised without a build.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq } = require('./harness');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'native', 'http-shim.js'), 'utf8');

const GLOBAL_ALLOW = [
  { host: 'maas.qwencloudapi.com', methods: ['POST'] },
  { re: '^dashscope-result-[a-z0-9-]+\\.oss-[a-z0-9-]+\\.aliyuncs\\.com$', methods: ['GET'] },
];
const CHINA_ALLOW = [
  { re: '^dashscope-result-[a-z0-9-]+\\.oss-[a-z0-9-]+\\.aliyuncs\\.com$', methods: ['GET'] },
];
const MAAS = 'https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions';
const OSS = 'https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com/a.wav';

function load(allow, opts) {
  const o = opts || {};
  const calls = { native: [], messages: [] };
  const handler = {
    postMessage(m) { calls.messages.push(m); },
  };
  const win = {
    fetch: (input, init) => { calls.native.push({ input, init }); return Promise.resolve('native'); },
    location: { href: 'file:///app/Main.html' },
    webkit: { messageHandlers: o.noHandler ? {} : { mtHttp: handler } },
  };
  const ctx = {
    window: win, URL, Response, Headers, DOMException,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder, ArrayBuffer, Uint8Array, Blob, Promise, console, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  const src = SRC.split('__MT_HTTP_ALLOW_JSON__').join(JSON.stringify(allow || GLOBAL_ALLOW));
  vm.runInContext(src, ctx);
  return { win, calls, ctx };
}

describe('http-shim — only the allowlisted host/method uses the bridge', () => {
  test('a non-allowlisted URL calls the original fetch untouched', async () => {
    const { win, calls } = load();
    const r = await win.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: 'x' });
    eq(r, 'native');
    eq(calls.native.length, 1);
    eq(calls.messages.length, 0, '不允许的主机被桥接走了 —— 那就成了全量代理');
  });

  test('★ global: maas POST goes over the message channel with a base64 body', async () => {
    const { win, calls } = load();
    const p = win.fetch(MAAS, {
      method: 'POST',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      body: '{"model":"qwen3.7-plus"}',
    });
    await Promise.resolve();
    eq(calls.messages.length, 1);
    const m = calls.messages[0];
    eq(m.url, MAAS);
    eq(m.method, 'POST');
    eq(m.headers.Authorization, 'Bearer k');
    eq(Buffer.from(m.bodyBase64, 'base64').toString(), '{"model":"qwen3.7-plus"}');
    win.__mtHttpResolve(m.id, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
    });
    const resp = await p;
    eq(resp.status, 200);
    eq(resp.ok, true);
    eq(JSON.stringify(await resp.json()), '{"ok":true}');
  });

  test('304/204 responses carry no body (Response rejects a body on null-body statuses)', async () => {
    const { win, calls } = load();
    const p = win.fetch(MAAS, { method: 'POST' });
    await Promise.resolve();
    win.__mtHttpResolve(calls.messages[0].id, { status: 304, headers: {}, bodyBase64: '' });
    const resp = await p;
    eq(resp.status, 304);
    eq(resp.body, null);
  });

  test('maas GET does not use the bridge (the native side only permits POST)', async () => {
    const { win, calls } = load();
    const r = await win.fetch(MAAS, { method: 'GET' });
    eq(r, 'native');
    eq(calls.messages.length, 0);
  });

  test('★ china: no maas, but the OSS GET still goes over the bridge', async () => {
    const c = load(CHINA_ALLOW);
    eq(await c.win.fetch(MAAS, { method: 'POST' }), 'native');
    eq(c.calls.messages.length, 0, '中国版 allowlist 里出现了 maas');
    const p = c.win.fetch(OSS, { method: 'GET' });
    await Promise.resolve();
    eq(c.calls.messages.length, 1);
    eq(c.calls.messages[0].method, 'GET');
    c.win.__mtHttpResolve(c.calls.messages[0].id, {
      status: 200, headers: {}, bodyBase64: Buffer.from([1, 2, 3]).toString('base64'),
    });
    const resp = await p;
    eq(Array.from(new Uint8Array(await resp.arrayBuffer())).join(','), '1,2,3');
  });

  test('OSS hosts outside the pinned shape are rejected — no *.aliyuncs.com wildcard', async () => {
    const { win, calls } = load();
    eq(await win.fetch('https://evil.oss-example.aliyuncs.com/a.wav', { method: 'GET' }), 'native');
    eq(await win.fetch('https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com.evil.test/a', { method: 'GET' }), 'native');
    eq(calls.messages.length, 0);
  });
});

describe('http-shim — native callback arity (Swift → shim seam)', () => {
  // The seam that hung on the real intl Mac build (BEL-238 C5): http-bridge.swift
  // evaluates `window.__mtHttpResolve(<json>);` — ONE object — while the shim took
  // `(id, payload)`. The old shim keyed pending by "[object Object]", so the fetch
  // never settled and the caller aborted after 10s. Feed the exact JSON text here.
  test('★ Swift JSON one-object callback finishes(id, payload); id is never "[object Object]"', async () => {
    const { win, calls, ctx } = load();
    const p = win.fetch(MAAS, { method: 'POST', body: '{"model":"qwen3.7-plus"}' });
    await Promise.resolve();
    eq(calls.messages.length, 1);
    const id = calls.messages[0].id;
    ok(id && id !== '[object Object]');

    // Byte-for-byte the shape Swift serialises: one JSON object, one argument.
    const json = JSON.stringify({
      id: id,
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
    });
    vm.runInContext('window.__mtHttpResolve(' + json + ');', ctx);

    const result = await Promise.race([
      p.then(async (r) => ({ status: r.status, text: await r.text() })),
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'one-object callback did not finish the pending fetch — pending is still keyed by "[object Object]"',
      )), 200)),
    ]);
    eq(result.status, 200);
    eq(result.text, '{"ok":true}');
  });

  test('legacy two-argument callers (id, payload) remain supported', async () => {
    const { win, calls } = load();
    const p = win.fetch(MAAS, { method: 'POST' });
    await Promise.resolve();
    win.__mtHttpResolve(calls.messages[0].id, {
      status: 200, headers: {}, bodyBase64: Buffer.from('two-arg').toString('base64'),
    });
    const resp = await p;
    eq(resp.status, 200);
    eq(await resp.text(), 'two-arg');
  });
});

describe('http-shim — abort and kill switches', () => {
  test('★ AbortSignal sends cancel and rejects with AbortError', async () => {
    const { win, calls } = load();
    const ac = new AbortController();
    const p = win.fetch(MAAS, { method: 'POST', signal: ac.signal });
    await Promise.resolve();
    await Promise.resolve();
    eq(calls.messages.length, 1);
    ac.abort();
    const err = await p.then(() => null, (e) => e);
    ok(err && err.name === 'AbortError', 'abort 应抛 AbortError，实际 ' + (err && err.name));
    eq(calls.messages[1].cancel, true, '没有给 Swift 发 cancel —— URLSessionTask 会继续跑');
    eq(calls.messages[1].id, calls.messages[0].id);
  });

  test('__MT_HTTP_OFF disables the bridge at runtime', async () => {
    const { win, calls } = load();
    win.__MT_HTTP_OFF = true;
    eq(await win.fetch(MAAS, { method: 'POST' }), 'native');
    eq(calls.messages.length, 0);
  });

  test('MTHttpBridge.enabled = false disables the bridge at runtime', async () => {
    const { win, calls } = load();
    win.MTHttpBridge.enabled = false;
    eq(await win.fetch(MAAS, { method: 'POST' }), 'native');
    eq(calls.messages.length, 0);
  });

  test('no message handler on the host ⇒ original fetch (a browser page without the App)', async () => {
    const { win, calls } = load(GLOBAL_ALLOW, { noHandler: true });
    eq(await win.fetch(MAAS, { method: 'POST' }), 'native');
    eq(calls.messages.length, 0);
  });
});
