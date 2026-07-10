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
describe('TranslationAPI — retry & fallback', () => {
  test('a failing non-google provider falls back to Google', async () => {
    // 3 OpenAI failures (retry-after:0 → fast), then a Google success.
    const program = [errJson(500), errJson(500), errJson(500), okJson([[['谷歌', 'hello']]])];
    const { API, fetch } = loadAPI(program);
    eq(await API.translate('hello', 'zh-CN', 'openai', 'KEY', ''), '谷歌');
    eq(fetch.calls.length, 4);
    match(fetch.calls[3].url, /translate_a\/single/, 'final attempt is Google');
  });

  test('Google failing on all retries rejects (no fallback loop)', async () => {
    const { API } = loadAPI([errJson(500), errJson(500), errJson(500)]);
    await rejects(API.translate('hello', 'zh-CN', 'google', '', ''));
  });

  test('China flavor: a failing provider rejects (no Google fallback — Google is blocked in China)', async () => {
    // 3 failures and NO Google success programmed: the china build must surface
    // the error rather than silently reaching for translate.googleapis.com.
    const { API, fetch } = loadAPI([errJson(500), errJson(500), errJson(500)], {}, 'china');
    await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(fetch.calls.length, 3, 'exactly the 3 provider retries, no 4th Google attempt');
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
