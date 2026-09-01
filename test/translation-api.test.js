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
  const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'],
    { fetch, chrome, AbortController, URLSearchParams, window, WireFormat });
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

  // 2026-08-22 真机：中国版的默认 `provider: 'google'` 在它自己的注册表里不存在，
  // 于是旧代码的 `if (!p || p.type === 'google')` 把它静默送去了 translateGoogle ——
  // 一份没填任何 Key 的中国版真的翻出了 38 段，输出与直接打 Google 逐字相同，而设置页
  // 因为下拉里没有 google 这一项，显示的是 DeepSeek。界面与运行时不一致 + 静默兜底。
  test('未知引擎 id 具名报错，绝不静默落到 Google', async () => {
    const { API, fetch } = loadAPI([okJson([[['你好', 'hello', null, null]]])]);
    await rejects(() => API.translate('hello world', 'zh-CN', 'no-such-engine', 'K', ''),
      /unknown provider/);
    eq(fetch.calls.length, 0, '一个请求都不该发出去——尤其不该发给 Google');
  });

  // 2026-08-22 真机：守卫生效了，但失败要 **70 秒** 才显示出来。unknown_provider 走了
  // isRetryable 的「没有 status ⇒ 当瞬时错误」兜底，每段白白重试 3 次（34 段 × 3 次
  // ÷ 并发 5 × 3.4 秒 ≈ 69 秒）。引擎 id 不认识，重试一万次还是不认识。
  test('未知引擎不可重试 —— 失败要立刻可见，不是一分钟后', async () => {
    const { API, fetch } = loadAPI([]);
    const t0 = Date.now();
    await rejects(() => API.translate('hello world', 'zh-CN', 'no-such-engine', 'K', ''),
      /unknown provider/);
    const ms = Date.now() - t0;
    ok(ms < 500, `应当立刻失败，实测 ${ms}ms —— 退避重试回来了`);
    eq(fetch.calls.length, 0);
  });

  // 默认引擎只有一个来源：注册表第一条。它曾被硬写成 'google' 抄在六个地方
  // （background.js 的 DEFAULT_SETTINGS + content-main + 四个内容适配器），
  // 而 google 的 flavors 是 ['global'] —— 中国版里那个 id 根本不存在。
  // 注意：**不能**拿真实的 global 注册表来测这条。它的第一条恰好就是 google，于是
  // 「取注册表第一条」和「硬写 'google'」返回同一个值，测试永远绿——写完第一版就是
  // 这样，掰断源码它照样过。所以这里注入一份构造的注册表：只有它能分辨两种实现。
  function loadAPIWithRegistry(providers) {
    const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'], {
      fetch: makeFetch([]), chrome: makeChrome({}), AbortController, URLSearchParams,
      window: { MT_PROVIDERS: providers }, WireFormat,
    });
    return ctx.TranslationAPI;
  }

  test('defaultProvider 取自注册表第一条，不是硬写的字面量', () => {
    const API = loadAPIWithRegistry([
      { id: 'first_engine', type: 'chat-compat', flavors: ['global'] },
      { id: 'google', type: 'google', flavors: ['global'] },
    ]);
    eq(API.defaultProvider(), 'first_engine', '硬写 google 会在这里露馅');
  });

  test('注册表为空 ⇒ 默认是空串，不是凭空造一个 id', () => {
    eq(loadAPIWithRegistry([]).defaultProvider(), '');
  });

  test('resolveProvider：认识的原样返回，不认识的回落到默认', () => {
    const { API } = loadAPI([]);
    eq(API.resolveProvider('deepseek'), 'deepseek');
    eq(API.resolveProvider('no-such-engine'), API.defaultProvider());
    eq(API.resolveProvider(undefined), API.defaultProvider());
    eq(API.resolveProvider(''), API.defaultProvider());
  });

  // translateBatch 曾有一条 `provider === 'google'` 的分支直接调 translateGoogleBatch，
  // **绕过 callProvider** —— 未知引擎守卫管不到它。整个扩展没有任何调用方，已删除。
  test('translateBatch 已删除 —— 绕过 callProvider 的旁路不能悄悄回来', () => {
    const { API } = loadAPI([]);
    eq(typeof API.translateBatch, 'undefined');
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
// 「同一个地址、同一把 key，别的客户端能用，我们 400」= 请求体多了东西 (#151)。
// 1.5.3–1.5.9 的答案是**试探性协商**：发一个乐观的体，被拒了从服务端报错里抠出字段名
// 再让掉重发。它今天差点静默失效 —— 那条真实 400 是三层嵌套，字段名排在第 100 个字符，
// 而截断上限是 300；网关的 trace id 再长一点，协商会**既不报错也不触发**。
//
// 现在改成查表：`build/model-params.config.js` 记我们知道的，表外一律最小必要集。
// 下面钉的是同一件事的两面 —— 知道的要发对，不知道的要少说话。
describe('TranslationAPI — 请求体：查表 + 最小必要兜底', () => {
  // 整组里最要紧的一条：那个企业网关（自家域名，表里没有）现在从一开始就不会收到
  // temperature，于是 2026-08-20 那个 400 根本不会发生。
  test('表外的 host ⇒ body 只有 model 与 messages，一个可选字段都不发', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })]);
    await API.translate('hello', 'zh-CN', 'custom_chat', 'K',
      'https://idealab.example-corp.com/v1/chat/completions');
    const body = bodyOf(fetch.calls[0]);
    deepEq(Object.keys(body).sort(), ['messages', 'model']);
    eq(body.messages[0].role, 'system', '角色名无表时用协议默认值');
  });

  test('表说不收 ⇒ 用户在高级面板设了值也不发，且预算要改名', async () => {
    // 「表赢」的机器判据。用户设了 0.9，表（openai-reasoning）说 false ⇒ 不发。
    const { API, fetch } = loadAPI(
      [okJson({ choices: [{ message: { content: '你好' } }] })],
      { store: { reqTemperature: 0.9, reqMaxTokens: 1234 } });
    await API.translate('hello', 'zh-CN', 'custom_chat', 'K',
      'https://api.openai.com/v1/chat/completions', 'gpt-5.6-sol');
    const body = bodyOf(fetch.calls[0]);
    ok(!('temperature' in body), '表说不收就是不收，用户设了也不发');
    ok(!('max_tokens' in body), '这一族的预算不叫 max_tokens');
    eq(body.max_completion_tokens, 1234);
    eq(body.messages[0].role, 'developer');
  });

  test('同一个 host 上前缀更长者赢 —— gpt-4o 仍走经典行', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })]);
    await API.translate('hello', 'zh-CN', 'custom_chat', 'K',
      'https://api.openai.com/v1/chat/completions', 'gpt-4o');
    const body = bodyOf(fetch.calls[0]);
    eq(body.temperature, 0.3);
    eq(body.max_tokens, 2000);
    eq(body.messages[0].role, 'system');
  });

  test('表说收但用户没设 ⇒ 发我们的默认值；设了 ⇒ 发用户的', async () => {
    const a = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })]);
    await a.API.translate('hello', 'zh-CN', 'deepseek', 'K', '');
    eq(bodyOf(a.fetch.calls[0]).temperature, 0.3);

    const b = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })],
      { store: { reqTemperature: 1.1 } });
    await b.API.translate('hello', 'zh-CN', 'deepseek', 'K', '');
    eq(bodyOf(b.fetch.calls[0]).temperature, 1.1);
  });

  test('高级参数会被钳制 —— 0 抬到 0.01，因为至少一家拒收 0', async () => {
    const { API, fetch } = loadAPI([okJson({ choices: [{ message: { content: '你好' } }] })],
      { store: { reqTemperature: 0 } });
    await API.translate('hello', 'zh-CN', 'deepseek', 'K', '');
    eq(bodyOf(fetch.calls[0]).temperature, 0.01);
  });

  test('messages-compat 无表也照发 max_tokens —— 协议必填，压不掉', async () => {
    // 一张观测表不能推翻一条协议契约。这是「最小必要」唯一的例外，所以要钉住。
    const { API, fetch } = loadAPI([okJson({ content: [{ text: '你好' }] })]);
    await API.translate('hello', 'zh-CN', 'custom_chat', 'K',
      'https://gateway.example-corp.com/v1/messages');
    const body = bodyOf(fetch.calls[0]);
    eq(body.max_tokens, 2000, '这条链路上 max_tokens 是必填');
    ok(!('temperature' in body), '但可选的仍然不发');
    ok(typeof body.system === 'string', 'system 走顶层，不是一条 message');
  });

  test('400 就是 400 —— 不猜是哪个字段，只发一次，把服务端原话交出去', async () => {
    // 协商删除后的行为契约：一次请求、一次失败、原话可见。用户看得见的失败，好过
    // 一个取决于对方错误信息长什么样的赌局。
    const { API, fetch } = loadAPI([{ status: 400,
      text: JSON.stringify({ error: { message: "Unsupported parameter: 'temperature'" } }) }]);
    const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
    eq(e.status, 400);
    match(e.serverMessage, /temperature/);
    eq(fetch.calls.length, 1, '400 不重发');
  });

  test('serverSays 仍会逐层剥壳 —— 它是「服务端原话」这一行的唯一来源', async () => {
    // 2026-08-20 真机（idealab 网关）原样拿到的 400 正文，三层嵌套，一个字符没改。
    // 协商没了，但把这堆转义反斜杠变成人能读的一句话，用户仍然需要。
    const REAL_NESTED_400 = JSON.stringify({
      object: 'response',
      error: {
        message: JSON.stringify({
          error: {
            type: 'llm_call_failed',
            message: '{\n  "error": {\n    "message": "Unsupported parameter: \'temperature\' is not supported with this model.",\n    "type": "invalid_request_error",\n    "param": "temperature",\n    "code": null\n  }\n}\n',
            treace_id: '0b522d6217871977087566606e0ca6',
          },
        }),
        code: 'MPE-001',
      },
    });
    const { API } = loadAPI([]);
    const said = API.serverSays(REAL_NESTED_400);
    match(said, /Unsupported parameter: 'temperature' is not supported with this model\./);
    ok(said.length < 120, '要剥到人能读的一句，而不是 296 字符的壳：' + said.length);
  });

  test('401 / 404 / 429 一律原样重发 —— 那些不是请求体的毛病', async () => {
    for (const status of [401, 404, 429]) {
      const { API, fetch } = loadAPI([{ status,
        text: JSON.stringify({ error: { message: "'temperature' unsupported" } }),
        headers: { 'retry-after': '0' } }]);
      const e = await rejects(API.translate('hello', 'zh-CN', 'deepseek', 'K', ''));
      eq(e.status, status);
      for (const c of fetch.calls) {
        eq(bodyOf(c).temperature, 0.3, status + ' 不该改动请求体');
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

  // 「Google 批量与单条共用同一套键」这条随 translateBatch 一起删除（2026-08-22）：
  // 批量入口没有任何调用方，而它绕过 callProvider。键格式那条不变量仍由 cacheKey()
  // 的其余用例守着。
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
    const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'],
    { fetch, chrome, AbortController, URLSearchParams, window, WireFormat });
    return { API: ctx.TranslationAPI, fetch };
  }

  // ── 孪生兄弟：回调**根本不来** ────────────────────────────────────────────
  // 上面那条钉的是「回调带着 undefined 进来」。2026-08-29 真机（全新 iPhone 14 Pro /
  // iOS 26.5，刚给扩展授完权）复现的是另一半：回调**一次都没有被调用**。
  //
  // 这一半更难查，因为内层 try 救不了它 —— try 只有在回调执行时才有意义。而
  // translate() 的第一行就是 `await RequestShape.ready()`，所以一个不落地的存储读
  // 会把整页钉死：没有请求上线、没有 20 秒 AbortController 超时（根本没走到 fetch）、
  // 没有错误态、控制台干净。用户看到的只有永远的「翻译中…」。
  //
  // Safari iOS 上这不是假想：同一个环境里 background service worker 锁屏后会永久变成
  // undefined，扩展存储走的是原生 App 进程的同一套桥。桥不通时回调不会报错，它只是不来。
  function apiWithDeadStorage(program) {
    const fetch = makeFetch(program);
    const chrome = {
      storage: {
        local: {
          get: () => { /* 回调永远不来 —— 这正是真机上发生的事 */ },
          set: () => {},
          remove: (_k, cb) => cb && cb(),
        },
      },
    };
    const window = loadRegistry();
    const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'],
    { fetch, chrome, AbortController, URLSearchParams, window, WireFormat });
    return { API: ctx.TranslationAPI, fetch, RS: ctx.RequestShape };
  }

  test('回调永不到来时，translate() 仍然落地并真的发出请求', async () => {
    const { API, fetch, RS } = apiWithDeadStorage([okJson({ choices: [{ message: { content: '译文' } }] })]);
    // 判据不是「没报错」，而是**请求真的上了线**：卡在存储读上时 fetch.calls 会是 0。
    const out = await Promise.race([
      API.translate('hello', 'zh-CN', 'deepseek', 'KEY', ''),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG: 存储回调不来就把整页钉死了')),
        RS.STORAGE_TIMEOUT_MS + 5000)),
    ]);
    eq(out, '译文');
    eq(fetch.calls.length, 1, '超时之后必须照常发请求，而不是静默放弃');
  });

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

// translateBatch 的三条用例随函数一起删除（2026-08-22）：它没有任何调用方，而它的
// `provider === 'google'` 分支直接调 translateGoogleBatch，绕过 callProvider —— 未知
// 引擎守卫管不到它。「已删除」本身由上面那条 typeof 断言守着。

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
