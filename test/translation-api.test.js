// test/translation-api.test.js — regression for the multi-provider transport.
// Exercises the public API (translate / translateBatch) with a stubbed fetch +
// chrome.storage, asserting each provider's request shape, caching, and retry/fallback.
const { describe, test, ok, eq, deepEq, match, rejects } = require('./harness');
const { loadModule } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
// The transports resolve their endpoint through this shared pure module; it is a
// dependency, not a stub, so the real one is injected rather than faked.
const WireFormat = require('../extension/content/wire-format.js');

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
  const ctx = loadModule('translation-api.js', { fetch, chrome, AbortController, URLSearchParams, window, WireFormat });
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

  test('custom base URL replaces the default endpoint outright — nothing appended', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })]);
    await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://proxy.example');
    eq(fetch.calls[0].url, 'https://proxy.example');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The endpoint is used exactly as stored, and the ADDRESS chooses the wire shape
// (domain-design §7). Before this, one host serving both Chat Completions and
// Responses was unreachable: the registry appended one path and the user had no say.
describe('TranslationAPI — the address is the request, and it picks the shape', () => {
  test('the endpoint is requested verbatim — nothing appended, not even a path', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })]);
    await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://proxy.example/weird/route');
    eq(fetch.calls[0].url, 'https://proxy.example/weird/route');
  });

  test('the endpoint keeps its trailing slash — verbatim means verbatim', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })]);
    await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://proxy.example/v1/chat/completions/');
    eq(fetch.calls[0].url, 'https://proxy.example/v1/chat/completions/');
  });

  test('一个「看起来是 base」的地址也逐字发出去 —— 这里曾经是拼接的入口 (#151)', async () => {
    // 真机那一条：用户填 `…/api/openai/v1`，1.5.2 补成 `…/api/openai/v1/v1/chat/completions`
    // 然后 404。拼接分支删掉之后，填什么就请求什么，对不对由服务端说了算。
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })]);
    await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://aispace.example/api/openai/v1');
    eq(fetch.calls[0].url, 'https://aispace.example/api/openai/v1');
  });

  test('/v1/responses selects the Responses shape on a chat-compat entry', async () => {
    const { API, fetch } = loadAPI([okJson({ output_text: '你好' })]);
    eq(await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://api.openai.com/v1/responses', ''), '你好');
    const b = bodyOf(fetch.calls[0]);
    ok(b.input === 'hello', 'Responses 用 input，不是 messages');
    ok(!('messages' in b), 'Chat Completions 的 messages 不该出现');
    ok(typeof b.instructions === 'string' && b.instructions.length > 0, 'system prompt 走顶层 instructions');
    eq(b.max_output_tokens, 2000);
    ok(!('max_tokens' in b), 'Responses 拒收 max_tokens —— 名字和含义都变了');
    eq(fetch.calls[0].opts.headers['Authorization'], 'Bearer KEY');
  });

  test('Responses extraction walks output[] — a reasoning item must not be read as the answer', async () => {
    // output[0] 是 {type:'reasoning'}，正是推理模型的真实形状；取 [0] 会得到空。
    const { API } = loadAPI([okJson({
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: '你好' }] },
      ],
    })]);
    eq(await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://api.openai.com/v1/responses', ''), '你好');
  });

  test('/v1/messages on a chat-compat entry selects the Messages shape', async () => {
    // 形状由地址声明，不由我们对这个 id 的猜测声明。
    const { API, fetch } = loadAPI([okJson({ content: [{ text: '你好' }] })]);
    eq(await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://proxy.example/v1/messages', '', true), '你好');
    eq(fetch.calls[0].opts.headers['x-api-key'], 'KEY');
    eq(fetch.calls[0].opts.headers['anthropic-version'], '2023-06-01');
  });

  test('an unrecognised path falls back to the registry type — unknown endpoints behave as today', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: 'x' } }] })]);
    await API.translate('hello', 'zh-CN', 'openai', 'KEY', 'https://proxy.example/api/llm', '', true);
    const b = bodyOf(fetch.calls[0]);
    ok(Array.isArray(b.messages), '认不出后缀时必须回落到注册表说的 chat-compat');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A failure that never reached a status code used to arrive at the settings page as
// the raw string "Load failed" — WebKit's text for a CORS rejection, which is also
// what it says for an unreachable host (learning-design §9.4, measured 2026-08-13).
// speech-input.js has named this since #130; this transport did not. The URL rides
// along because "which address did we call" is the fact that separates a wrong
// endpoint from an unreachable one, and no error text can supply it.
describe('TranslationAPI — failures are named, and carry the URL', () => {
  test('a bare fetch rejection is named `network`, not surfaced as its raw message', async () => {
    const { API } = loadAPI(() => { throw new TypeError('Load failed'); });
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.code, 'network');
    eq(e.url, 'https://api.deepseek.com/v1/chat/completions');
  });

  test('an HTTP failure carries code `http` and the URL, so 404 gets the named hint', async () => {
    const { API } = loadAPI([errJson(404)]);
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.code, 'http');
    eq(e.status, 404);
    eq(e.url, 'https://api.deepseek.com/v1/chat/completions');
  });

  // 服务端那句话是用户唯一能拿去搜的东西。以前它被 `resp.json()` 吞掉（非 JSON 的
  // 错误体直接变成 {}），于是一个点名了字段的 400 在界面上只剩「服务端拒绝了这次请求」。
  test('服务端原话被原样带出来，JSON 与非 JSON 都要', async () => {
    const { API } = loadAPI([{ status: 400, text: JSON.stringify({
      error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model." } }) }]);
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    match(e.serverMessage, /max_tokens/);

    // 网关回 HTML/纯文本时也不能丢 —— 「upstream connect error」正是要看的那句。
    const g = loadAPI([{ status: 502, text: '<html><body>upstream connect error</body></html>' }]);
    const e2 = await rejects(g.API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    match(e2.serverMessage, /upstream connect error/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 「同一个地址、同一把 key，别的客户端能用，我们 400」= 地址和 key 都对，是请求体多了
// 东西。不去猜是哪个字段，照服务端点名的那个让掉再试 (#151).
describe('TranslationAPI — 请求体协商', () => {
  const okBody = { choices: [{ message: { content: '你好' } }] };
  const reject = (msg) => ({ status: 400, text: JSON.stringify({ error: { message: msg } }) });

  test("点名 max_tokens 且给了新名字 ⇒ 改名重发，预算不丢", async () => {
    const { API, fetch } = loadAPI([
      reject("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."),
      okJson(okBody)]);
    eq(await API.translate('hello', 'zh-CN', 'deepseek', 'K', ''), '你好');
    eq(fetch.calls.length, 2);
    const b = bodyOf(fetch.calls[1]);
    ok(!('max_tokens' in b), 'max_tokens 该让掉');
    eq(b.max_completion_tokens, 2000, '预算改名保留，不是整个丢掉');
  });

  test('点名 temperature ⇒ 去掉再发，其余字段不动', async () => {
    const { API, fetch } = loadAPI([
      reject("Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported."),
      okJson(okBody)]);
    eq(await API.translate('hello', 'zh-CN', 'deepseek', 'K', ''), '你好');
    const b = bodyOf(fetch.calls[1]);
    ok(!('temperature' in b));
    eq(b.max_tokens, 2000, '没被点名的字段不该受牵连');
    eq(b.messages.length, 2);
  });

  test("点名 system 角色 ⇒ 换成 developer，内容一字不改", async () => {
    const { API, fetch } = loadAPI([
      reject("Invalid value: 'system'. Supported values are: 'developer', 'user' and 'assistant'."),
      okJson(okBody)]);
    eq(await API.translate('hello', 'zh-CN', 'deepseek', 'K', ''), '你好');
    const before = bodyOf(fetch.calls[0]).messages[0];
    const after = bodyOf(fetch.calls[1]).messages[0];
    eq(after.role, 'developer');
    eq(after.content, before.content, 'system prompt 内容必须原样');
  });

  test('只收流式的网关 ⇒ 带 stream 重发，整包收完再解 SSE', async () => {
    const sse = ['data: {"choices":[{"delta":{"content":"你"}}]}',
                 'data: {"choices":[{"delta":{"content":"好"}}]}',
                 'data: [DONE]', ''].join('\n');
    const { API, fetch } = loadAPI([reject('This endpoint only supports stream mode'),
      { status: 200, text: sse }]);
    eq(await API.translate('hello', 'zh-CN', 'deepseek', 'K', ''), '你好');
    eq(bodyOf(fetch.calls[1]).stream, true);
  });

  test('最多让两步，且每一步必须真的改动了什么 —— 不能变成磨掉真错误的重试循环', async () => {
    // 服务端反复点名同一个已经让掉的字段：第二次 relax 返回 null ⇒ 立刻抛出。
    const { API, fetch } = loadAPI([reject("'temperature' unsupported"), reject("'temperature' unsupported")]);
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.status, 400);
    eq(fetch.calls.length, 2, '没得让了就停，不该再发第三次');
  });

  test('服务端没点名任何我们发的字段 ⇒ 不协商，原样报错', async () => {
    const { API, fetch } = loadAPI([reject('insufficient balance')]);
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.status, 400);
    match(e.serverMessage, /insufficient balance/);
    eq(fetch.calls.length, 1, '看不懂的 400 不该被当成可协商');
  });

  test('401 / 404 / 429 一律不协商 —— 那些不是请求体的毛病', async () => {
    // 断言的是「请求体没被动过」而不是调用次数：429 该被外层退避重试（那是可重试的），
    // 但每一次都必须原样重发，不能因为响应体里恰好出现了 temperature 就去改请求。
    for (const status of [401, 404, 429]) {
      const { API, fetch } = loadAPI([{ status,
        text: JSON.stringify({ error: { message: "'temperature' unsupported" } }),
        headers: { 'retry-after': '0' } }]);
      const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
      eq(e.status, status);
      for (const c of fetch.calls) {
        eq(bodyOf(c).temperature, 0.3, status + ' 不该触发协商');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 缓存键只按引擎 id 记，会把同一个 id 的两套配置当成同一个东西 —— `custom_chat` 下
// 换端点/换模型，12 小时内拿到的是旧配置的译文，界面上毫无迹象 (#151).
describe('TranslationAPI — 缓存键包含端点与模型', () => {
  const ok = (t) => okJson({ choices: [{ message: { content: t } }] });

  test('换端点 ⇒ 不吃旧缓存，真的再打一次', async () => {
    const { API, fetch } = loadAPI([ok('第一版'), ok('第二版')]);
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', 'https://a.example/v1/chat/completions'), '第一版');
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', 'https://b.example/v1/chat/completions'), '第二版');
    eq(fetch.calls.length, 2, '换了端点还命中缓存 —— 那是在拿 A 的译文冒充 B 的');
  });

  test('换模型 ⇒ 同样不吃旧缓存', async () => {
    const { API, fetch } = loadAPI([ok('小模型'), ok('大模型')]);
    const url = 'https://a.example/v1/chat/completions';
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'small'), '小模型');
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'large'), '大模型');
    eq(fetch.calls.length, 2);
  });

  test('同配置重复调用仍然吃缓存 —— 省钱的初衷没被牺牲', async () => {
    const { API, fetch } = loadAPI([ok('你好')]);
    const url = 'https://a.example/v1/chat/completions';
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'm'), '你好');
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'm'), '你好');
    eq(fetch.calls.length, 1);
  });

  test('noCache 读写都绕开 —— 「测试连接」必须真的连一次', async () => {
    const { API, fetch } = loadAPI([ok('第一次'), ok('第二次'), ok('第三次')]);
    const url = 'https://a.example/v1/chat/completions';
    await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'm', { noCache: true });
    await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'm', { noCache: true });
    eq(fetch.calls.length, 2, 'noCache 仍然读了缓存');
    // 也不能写：否则自检跑一遍就把后续的正常翻译污染成自检那句。
    eq(await API.translate('hello', 'zh-CN', 'custom_chat', 'K', url, 'm'), '第三次');
    eq(fetch.calls.length, 3, 'noCache 把结果写进了缓存');
  });

  test('Google 批量与单条共用同一套键 —— 否则两边各刷各的', async () => {
    const { API, fetch } = loadAPI([okJson([['你好']]), ok('不该用到')]);
    deepEq(await API.translateBatch(['hello there'], 'zh-CN', 'google', '', ''), ['你好']);
    eq(await API.translate('hello there', 'zh-CN', 'google', '', ''), '你好');
    eq(fetch.calls.length, 1, '批量写的条目单条读没命中 —— 键格式对不上');
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

  test('result is persisted under tr:{provider}:{endpoint}:{model}:{lang}:{text}', async () => {
    // 端点与模型进键，是为了让「换端点/换模型」不吃旧译文（见「缓存键包含端点与模型」）。
    // google 两者恒空，所以键里是两段空。
    const { API, chrome } = loadAPI([okJson([[['你好', 'hello']]])]);
    await API.translate('hello', 'zh-CN', 'google', '', '');
    ok('tr:google:::zh-CN:hello' in chrome._store, 'cache key format');
    eq(chrome._store['tr:google:::zh-CN:hello'].v, '你好');
  });

  test('a fresh storage entry short-circuits the network', async () => {
    const store = { 'tr:openai:::ja:hello': { v: 'CACHED', ts: Date.now() } };
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
    const ctx = loadModule('translation-api.js', { fetch, chrome, AbortController, URLSearchParams, window, WireFormat });
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
    const { API, fetch } = loadAPI([errJson(401), okJson([[['谷歌', 'hello']]])]);
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', '', ''));
    eq(e.status, 401);
    // 一次就够。401 是**永久**失败：同一把空 key 重发两遍还是空的，而整页每段各撞三次
    // 只会把用户的报错延后十几秒。可重试的定义见 isRetryable。
    eq(fetch.calls.length, 1, 'key 不对是永久失败，不该退避重试；更不该有第 4 次 Google');
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
    eq(chrome._store['tr:google:::zh-CN:alpha'].v, '甲');
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
    // 探针（action:'ping'）也走同一条消息通道，按 action 过滤才问得准。
    const fetches = proxied.filter((m) => m.action === 'proxyFetch');
    eq(fetches.length, 1);
    match(fetches[0].url, /translate\.googleapis\.com/);
  });

  // 选路不再按浏览器猜（#154 曾按 IS_SAFARI 分流），改为**问一次后台在不在**。
  // 后台答不上来 ⇒ 直连优先，这一条覆盖「worker 已死」的所有成因，包括 iOS 锁屏。
  test('后台不可达 ⇒ 直连优先，且不为每段白等一次超时', async () => {
    const { API, fetch, chrome } = loadAPI([okJson([[['你好', 'hello']]])]);  // 无 onMessage = 探针答不上来
    eq(await API.translate('hello there', 'zh-CN', 'google', '', ''), '你好');
    eq(fetch.calls.length, 1, '直连一次成功');
    eq(chrome.runtime._sent.filter((m) => m.action === 'proxyFetch').length, 0,
      '探针已经说了后台不可达，就不该再往后台发真请求');
  });

  test('a proxied HTTP error keeps status and retry-after, same shape as direct', async () => {
    const { API } = loadAPI([], ffOpts(() => ({
      ok: false, status: 429, statusText: 'Too Many Requests',
      retryAfter: 0, text: JSON.stringify({ error: { message: 'slow down' } }),
    })));
    await rejects(() => API.translate('hello there', 'zh-CN', 'deepseek', 'k', ''), /429/);
  });

  // 2026-08-19 真机：内容脚本的 fetch 以**网页**的身份发出（Origin = en.wikipedia.org），
  // 企业网关的 OPTIONS 预检回 403 ⇒ 浏览器连 POST 都不发。后台带 host_permissions，
  // 不受 CORS 约束也不发预检 —— 所以非 Safari 一律**首选后台**：一次请求，无预检 (#153)。
  const okBody = JSON.stringify({ choices: [{ message: { content: '你好' } }] });
  const proxyOk = () => ({ ok: true, status: 200, text: okBody });

  test('后台可达 ⇒ 第一次就走后台，一次请求，不先撞一次注定失败的预检', async () => {
    const proxied = [];
    const { API, fetch } = loadAPI([], {
      onMessage: (m) => { proxied.push(m); return m.action === 'ping' ? { ok: true } : proxyOk(); },
    });
    eq(await API.translate('hello', 'zh-CN', 'deepseek', 'K', ''), '你好');
    eq(fetch.calls.length, 0, '不该有直连 —— 那正是「慢一倍」的来源');
    const fetches = proxied.filter((m) => m.action === 'proxyFetch');
    eq(fetches.length, 1, '真请求只发了一次（探针不算，它是本地 IPC）');
    eq(fetches[0].url, 'https://api.deepseek.com/v1/chat/completions');
  });

  test('后台不可用 ⇒ 回退直连（公共 API 仍然能用，后台不是单点）', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })],
      { onMessage: () => ({ error: 'background unreachable' }) });
    eq(await API.translate('hello', 'zh-CN', 'deepseek', 'K', ''), '你好');
    eq(fetch.calls.length, 1, '回退到直连并成功');
  });

  // 这一条盯的是 1.5.5 的真机症状：「前面几段成功，后面全挂」。旧实现记过「这个 origin
  // 两条路都不通」，于是 MV3 worker 在并发下偶尔来不及响应的那一次失败，把整个 origin
  // 永久钉成 direct-only。记忆只许记成功。
  test('失败永远不改变路线 —— 后台仍会被继续尝试', async () => {
    // 1.5.5 真机症状：「前面几段成功，后面全挂」。那一版记过「这个 origin 两条路都不通」
    // 并据此**跳过**后台，于是 MV3 worker 在并发下偶尔来不及响应的一次失败，就把整个
    // origin 永久钉死。现在没有「跳过」这条分支了 —— 失败模式是由构造消除的，不是靠
    // 断言挡住的，所以这里钉的是那个构造：**每次请求都仍然会去试首选的那条路**。
    let nth = 0;
    const { API } = loadAPI(
      () => { throw new TypeError('Load failed'); },      // 直连恒被 CORS 挡（严格端点）
      { onMessage: () => { nth += 1; return nth === 1 ? { error: 'worker waking up' } : proxyOk(); } });
    eq(await API.translate('alpha alpha', 'zh-CN', 'deepseek', 'K', ''), '你好',
      '第一段：后台第一次没起来，外层重试时该再走一次后台');
    const afterFirst = nth;
    eq(await API.translate('beta beta', 'zh-CN', 'deepseek', 'K', ''), '你好');
    ok(nth > afterFirst, '第二段完全没有再尝试后台 —— 说明失败被记成了路线');
  });

  test('timeout 不换路 —— 请求确实出去了，再发一遍只是把等待翻倍', async () => {
    const proxied = [];
    // 后台不可达 ⇒ 直连优先；直连 abort 之后不该改走后台。
    const { API } = loadAPI(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
      { onMessage: (m) => { proxied.push(m); return m.action === 'ping' ? null : proxyOk(); } });
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.code, 'timeout');
    eq(proxied.filter((m) => m.action === 'proxyFetch').length, 0, 'timeout 换路了');
  });

  // 「哪个版本、走了哪条路、服务端说了什么」——2026-08-19 为这三个问题来回了三轮，
  // 全靠版本号和时间戳倒推。诊断出参让一张截图就能回答后两个 (#156)。
  test('diag 出参报告真正请求的地址与走的通路（成功时）', async () => {
    const diag = {};
    const { API } = loadAPI([], {
      onMessage: (m) => (m.action === 'ping' ? { ok: true } : proxyOk()),
    });
    await API.translate('hello', 'zh-CN', 'deepseek', 'K', '', '', { noCache: true, diag });
    eq(diag.url, 'https://api.deepseek.com/v1/chat/completions', '成功时也要报地址 —— 以前只有失败才看得见');
    eq(diag.route, 'proxy');
  });

  test('后台不可达时 diag 报 direct —— 两条路的失败长得一样，必须说出来', async () => {
    const diag = {};
    const { API } = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })]);  // 无 onMessage = 探针失败
    await API.translate('hello', 'zh-CN', 'deepseek', 'K', '', '', { noCache: true, diag });
    eq(diag.route, 'direct');
  });

  test('HTTP 错误也带上通路 —— 「403 但没有预检」和「403 且有预检」是两回事', async () => {
    const { API } = loadAPI([], {
      onMessage: (m) => (m.action === 'ping' ? { ok: true }
        : { ok: false, status: 403, statusText: 'Forbidden', text: JSON.stringify({ error: { message: 'origin not allowed' } }) }),
    });
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.status, 403);
    eq(e.route, 'proxy', '走后台还被 403 ⇒ 网关按来源挡的，不是跨域问题');
    match(e.serverMessage, /origin not allowed/);
  });

  test('探针会自愈 —— 后台一次不灵之后，下一次请求重新问，而不是就此不再用它', async () => {
    // 这是「记住失败」那个 bug 的一般形式：任何把暂时状态记成永久判断的地方都会把
    // 整页搞坏。探针的缓存在 proxy 传输级失败时作废，所以 worker 只是正在唤醒的话，
    // 下一段就能重新用上后台。
    let ping = 0, fetches = 0;
    const { API } = loadAPI(
      () => { throw new TypeError('Load failed'); },        // 直连恒被 CORS 挡
      { onMessage: (m) => {
          if (m.action === 'ping') { ping += 1; return { ok: true }; }
          fetches += 1;
          return fetches === 1 ? { error: 'worker waking up' } : proxyOk();
        } });
    eq(await API.translate('alpha alpha', 'zh-CN', 'deepseek', 'K', ''), '你好');
    ok(ping >= 2, `后台失败后没有重新探测（ping=${ping}）—— 缓存被钉死了`);
  });

  test('两条路都不通 ⇒ 报第一条的错，并标记已替用户试过另一条', async () => {
    const { API } = loadAPI(() => { throw new TypeError('Load failed'); },
      { onMessage: () => ({ error: 'background unreachable' }) });
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.code, 'network');
    eq(e.viaProxy, true);
    eq(e.url, 'https://api.deepseek.com/v1/chat/completions');
  });

  test('a failing proxy surfaces the error and does NOT fall back to the blocked path', async () => {
    // 有回退的话，能不能翻译就又取决于页面有没有 CSP —— 正是这条改动要消灭的不确定性。
    const { API, fetch } = loadAPI([okJson([[['不该用到', 'x']]])],
      ffOpts(() => ({ error: 'background unreachable' })));
    await rejects(() => API.translate('hello there', 'zh-CN', 'google', '', ''), /unreachable/);
    eq(fetch.calls.length, 0, '静默回退到已知被拦的路径 —— #74 已经否决过这种做法');
  });
});
