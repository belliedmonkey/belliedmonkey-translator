// test/translation-api.test.js — regression for the multi-provider transport.
// Exercises the public API (translate / translateBatch) with a stubbed fetch +
// chrome.storage, asserting each provider's request shape, caching, and retry/fallback.
const { describe, test, ok, eq, deepEq, match, rejects } = require('./harness');
const { loadModule } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');

// The transport reads the provider registry off `window.MT_PROVIDERS`, which the
// build generates per flavor into providers.gen.js. Load that real (global-flavor)
// registry into a shared `window` so tests exercise the exact production config,
// then hand the same object to translation-api.js. `flavor` overrides
// window.MT_FLAVOR (e.g. 'china') to exercise the no-Google-fallback branch.
function loadRegistry() {
  const window = {};
  loadModule('providers.gen.js', { window });
  return window;
}

function loadAPI(program, chromeOpts = {}, flavor) {
  const chrome = makeChrome(chromeOpts);
  const fetch = makeFetch(program);
  const window = loadRegistry();
  if (flavor) window.MT_FLAVOR = flavor;
  const ctx = loadModule('translation-api.js', { fetch, chrome, AbortController, URLSearchParams, window });
  return { API: ctx.TranslationAPI, fetch, chrome };
}

const okJson = (json, headers) => ({ status: 200, json, headers });
const errJson = (status) => ({ status, json: { error: { message: 'nope' } }, headers: { 'retry-after': '0' } });
const bodyOf = (call) => JSON.parse(call.opts.body);

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationAPI — guards & Google', () => {
  test('text shorter than 2 chars is returned unchanged, no network', async () => {
    const { API, fetch } = loadAPI([]);
    eq(await API.translate('a', 'zh-CN', 'google', '', ''), 'a');
    eq(await API.translate('', 'zh-CN', 'google', '', ''), '');
    eq(fetch.calls.length, 0);
  });

  test('Google: single endpoint, nested-array parse', async () => {
    const { API, fetch } = loadAPI([okJson([[['你好', 'hello', null, null]]])]);
    eq(await API.translate('hello', 'zh-CN', 'google', '', ''), '你好');
    match(fetch.calls[0].url, /translate_a\/single/);
    match(fetch.calls[0].url, /[?&]tl=zh-CN/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationAPI — OpenAI-compatible providers', () => {
  // URLs/models mirror the global-flavor registry (build/providers.config.js):
  // GLM's global endpoint is Z.ai; DeepSeek's default model is deepseek-v4-flash.
  const cases = [
    { provider: 'openai',   url: 'https://api.openai.com/v1/chat/completions',            model: 'gpt-4o-mini' },
    { provider: 'deepseek', url: 'https://api.deepseek.com/v1/chat/completions',          model: 'deepseek-v4-flash' },
    { provider: 'glm',      url: 'https://api.z.ai/api/paas/v4/chat/completions',         model: 'glm-4-flash' },
  ];
  for (const c of cases) {
    test(`${c.provider}: url ${c.url}, model ${c.model}, Bearer auth`, async () => {
      const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'こんにちは' } }] })]);
      eq(await API.translate('hello', 'ja', c.provider, 'KEY123', ''), 'こんにちは');
      const call = fetch.calls[0];
      eq(call.url, c.url);
      eq(call.opts.headers.Authorization, 'Bearer KEY123');
      const b = bodyOf(call);
      eq(b.model, c.model);
      eq(b.messages[1].content, 'hello', 'user message is the source text');
      match(b.messages[0].content, /日本語/, 'system prompt names the target language');
    });
  }

  test('custom base URL overrides the default host', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })]);
    await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://proxy.example');
    eq(fetch.calls[0].url, 'https://proxy.example/v1/chat/completions');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationAPI — Claude', () => {
  test('messages endpoint, x-api-key header, haiku model, content parse', async () => {
    const { API, fetch } = loadAPI([okJson({ content: [{ text: '你好' }] })]);
    eq(await API.translate('hello', 'zh-CN', 'claude', 'SK', ''), '你好');
    const call = fetch.calls[0];
    eq(call.url, 'https://api.anthropic.com/v1/messages');
    eq(call.opts.headers['x-api-key'], 'SK');
    eq(call.opts.headers['anthropic-version'], '2023-06-01');
    const b = bodyOf(call);
    match(b.model, /^claude-haiku-4-5/);
    eq(b.messages[0].content, 'hello');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationAPI — cache', () => {
  test('second identical call hits the in-memory cache (one fetch)', async () => {
    const { API, fetch } = loadAPI([okJson([[['你好', 'hello']]])]);
    await API.translate('hello', 'zh-CN', 'google', '', '');
    await API.translate('hello', 'zh-CN', 'google', '', '');
    eq(fetch.calls.length, 1);
  });

  test('result is persisted to chrome.storage under tr:{provider}:{lang}:{text}', async () => {
    const { API, chrome } = loadAPI([okJson([[['你好', 'hello']]])]);
    await API.translate('hello', 'zh-CN', 'google', '', '');
    ok('tr:google:zh-CN:hello' in chrome._store, 'cache key format');
    eq(chrome._store['tr:google:zh-CN:hello'].v, '你好');
  });

  test('a fresh storage entry short-circuits the network', async () => {
    const store = { 'tr:openai:ja:hello': { v: 'CACHED', ts: Date.now() } };
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })], { store });
    eq(await API.translate('hello', 'ja', 'openai', 'KEY', ''), 'CACHED');
    eq(fetch.calls.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationAPI — a storage callback that hands back undefined (Safari iOS)', () => {
  // The bug this pins cost an afternoon of matrix time and looked like a network
  // problem the whole way. `chrome.storage.local.get` on Safari iOS invokes its
  // callback with NO value. The cache read then did `res[key]`, which threw INSIDE
  // the callback — where the surrounding try/catch (wrapping only the synchronous
  // `get()` call) could not see it. `resolve` was never reached, so the promise
  // never settled, and `translate()` awaits that read BEFORE it fetches.
  //
  // The visible symptom had none of the shape of its cause: every paragraph sat at
  // 「翻译中…」 forever — no request on the wire, no 20s AbortController timeout
  // (nothing had been fetched), no error state, and removing an unrelated fallback
  // changed nothing because the retry loop was never reached either.
  function apiWithBlindStorage(program) {
    const fetch = makeFetch(program);
    const chrome = {
      storage: {
        local: {
          // Exactly Safari's shape: the callback fires ASYNCHRONOUSLY, with nothing.
          // The async part is load-bearing and was nearly got wrong here: a
          // SYNCHRONOUS stub lets the callback's throw unwind through `get()` into
          // the enclosing try/catch, which resolves the promise and hides the bug —
          // a green test proving nothing. Real callbacks land on a later turn, where
          // nothing is left to catch them.
          get: (_keys, cb) => setTimeout(() => cb(undefined), 0),
          set: () => {},
          remove: (_k, cb) => cb && cb(),
        },
      },
    };
    const window = loadRegistry();   // same registry as loadAPI, or we'd hit the
                                     // google branch instead of the code under test
    const ctx = loadModule('translation-api.js', { fetch, chrome, AbortController, URLSearchParams, window });
    return { API: ctx.TranslationAPI, fetch };
  }

  test('translate() still COMPLETES — a throwing callback must not strand the promise', async () => {
    const { API, fetch } = apiWithBlindStorage([okJson({ choices: [{ message: { content: '译文' } }] })]);
    const out = await Promise.race([
      API.translate('hello', 'zh-CN', 'deepseek', 'KEY', ''),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG: promise never settled')), 15000)),
    ]);
    eq(out, '译文');
    eq(fetch.calls.length, 1, 'the request must actually reach the network');
  });

  test('and a real failure still surfaces rather than hanging', async () => {
    const { API } = apiWithBlindStorage([errJson(401), errJson(401), errJson(401)]);
    await Promise.race([
      rejects(API.translate('hello', 'zh-CN', 'deepseek', '', '')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 15000)),
    ]);
  });
});

describe('TranslationAPI — retry & fallback', () => {
  test('a failing provider REJECTS — it never reaches for Google behind your back', async () => {
    // The old behaviour was a 4th call to translate_a/single after 3 provider
    // failures. It made a broken key look like a working one (the user sees a
    // translation and never learns their engine was never used), and it defeated
    // verification-spec §0, which bans verifying on that endpoint — a ban the
    // product itself was violating. A 4th call here is the regression.
    const { API, fetch } = loadAPI([errJson(500), errJson(500), errJson(500),
                                    okJson([[['谷歌', 'hello']]])]);
    await rejects(API.translate('hello', 'zh-CN', 'openai', 'KEY', ''));
    eq(fetch.calls.length, 3, 'exactly the 3 provider retries — no 4th Google attempt');
  });

  test('an EMPTY key fails visibly instead of quietly producing Google output', async () => {
    // The shape that hid a misconfiguration in the field: nothing validates the key
    // up front, so an empty one is a normal 401 — which must surface, not reroute.
    const { API, fetch } = loadAPI([errJson(401), errJson(401), errJson(401),
                                    okJson([[['谷歌', 'hello']]])]);
    await rejects(API.translate('hello', 'zh-CN', 'deepseek', '', ''));
    eq(fetch.calls.length, 3);
  });

  test('Google failing on all retries rejects (no fallback loop)', async () => {
    const { API } = loadAPI([errJson(500), errJson(500), errJson(500)]);
    await rejects(API.translate('hello', 'zh-CN', 'google', '', ''));
  });

  test('the no-fallback rule is universal — it was never a China-only concern', async () => {
    // This used to be flavor-gated: China surfaced the error, everyone else got a
    // silent Google translation. The distribution split is gone (domain-design §7)
    // and so is the split behaviour — the honest one is now the only one.
    const { API, fetch } = loadAPI([errJson(500), errJson(500), errJson(500)]);
    await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(fetch.calls.length, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationAPI — translateBatch', () => {
  test('empty input → empty output', async () => {
    const { API, fetch } = loadAPI([]);
    deepEq(await API.translateBatch([], 'zh-CN', 'google', '', ''), []);
    eq(fetch.calls.length, 0);
  });

  test('Google batch uses the batch endpoint and caches each item', async () => {
    const { API, fetch, chrome } = loadAPI([okJson(['甲', '乙'])]);
    deepEq(await API.translateBatch(['alpha', 'beta'], 'zh-CN', 'google', '', ''), ['甲', '乙']);
    match(fetch.calls[0].url, /translate_a\/t/);
    eq(chrome._store['tr:google:zh-CN:alpha'].v, '甲');
  });

  test('non-Google batch fans out to per-item translate', async () => {
    // Echo the user content so each item gets a distinct result.
    const program = (url, opts) => okJson({ choices: [{ message: { content: 'T:' + JSON.parse(opts.body).messages[1].content } }] });
    const { API } = loadAPI(program);
    deepEq(await API.translateBatch(['xx', 'yy'], 'ja', 'openai', 'KEY', ''), ['T:xx', 'T:yy']);
  });
});

// ─── domain-design §5.4: Firefox routes through the background ────────────────
// Firefox applies the HOST PAGE's CSP to a content script's fetch; Chrome and WebKit
// do not. Measured 2026-08-06 on one Mac: en.wikipedia.org (CSP allows googleapis /
// openai / anthropic but not api.deepseek.com) — Safari translated 26/26 paragraphs,
// Firefox failed every one. On a CSP-free page the same Firefox worked. So on Firefox
// whether translation works depends on which site the reader happens to be on.
//
// The exception is confined to apiFetch(), the one function every provider funnels
// through, so provider adapters / retry / error shape cannot drift per browser.

describe('TranslationAPI — Firefox CSP workaround (§5.4)', () => {
  const ffOpts = (onMessage) => ({ extensionOrigin: 'moz-extension://uuid/', onMessage });

  test('on Firefox the request goes through the background, not the page', async () => {
    const proxied = [];
    const { API, fetch, chrome } = loadAPI([], ffOpts((msg) => {
      proxied.push(msg);
      return { ok: true, status: 200, text: JSON.stringify([[['你好', 'hello']]]) };
    }));
    eq(await API.translate('hello there', 'zh-CN', 'google', '', ''), '你好');
    eq(fetch.calls.length, 0, '内容脚本仍然直接 fetch —— 正是被 CSP 拦掉的那条路');
    eq(proxied.length, 1);
    eq(proxied[0].action, 'proxyFetch');
    match(proxied[0].url, /translate\.googleapis\.com/);
  });

  test('everywhere else the direct fetch is untouched', async () => {
    const { API, fetch, chrome } = loadAPI([okJson([[['你好', 'hello']]])]);
    eq(await API.translate('hello there', 'zh-CN', 'google', '', ''), '你好');
    eq(fetch.calls.length, 1);
    eq(chrome.runtime._sent.length, 0, '非 Firefox 不该绕道 background');
  });

  test('a proxied HTTP error keeps status and retry-after, same shape as direct', async () => {
    const { API } = loadAPI([], ffOpts(() => ({
      ok: false, status: 429, statusText: 'Too Many Requests',
      retryAfter: 0, text: JSON.stringify({ error: { message: 'slow down' } }),
    })));
    await rejects(() => API.translate('hello there', 'zh-CN', 'deepseek', 'k', ''), /429/);
  });

  test('a failing proxy surfaces the error and does NOT fall back to the blocked path', async () => {
    // 有回退的话，能不能翻译就又取决于页面有没有 CSP —— 正是这条改动要消灭的不确定性。
    const { API, fetch } = loadAPI([okJson([[['不该用到', 'x']]])],
      ffOpts(() => ({ error: 'background unreachable' })));
    await rejects(() => API.translate('hello there', 'zh-CN', 'google', '', ''), /unreachable/);
    eq(fetch.calls.length, 0, '静默回退到已知被拦的路径 —— #74 已经否决过这种做法');
  });
});
