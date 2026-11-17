// test/bel284-engine-test-telemetry.test.js — BEL-284：engine_test 的失败切片。
//
// 起因：`engine_test` 只记 {slot,result,code}。401/403 在传输层已经具名成 auth，
// 但 code 白名单里没有它，track() 会把它压成 other —— 「key 被服务商拒绝」和
// 「没归类的失败」在表上同一行。404 与 429 也只能共用一个 http。
//
// 这个文件钉四件事：
//   1. 注册表：五个新码 + http（int）+ route（direct|proxy）+ provider（id），
//      生成物 events.gen.json 同步；四个失败字段都可缺。
//   2. EngineTest.track()：失败时写 code/http/route/provider，越界或非法值**不写**；
//      成功时保持 {slot,result}，一个失败字段都不带。
//   3. 六种失败**各自可辨**：401 auth / 403 auth / network / 404 http / 429 http /
//      timeout —— (code,http,route) 组合两两不同。错误对象由真实 TranslationAPI
//      产生（status 与路由分类不是测试里手写的），再喂给 EngineTest 的发送口。
//   4. 隐私红线：只发这四个字段，key / 完整 URL / serverMessage / host 都不出现。

const { describe, test, ok, eq, deepEq, rejects, loadModule, tick } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');
const cfg = require('../build/telemetry.config.js');
const gen = require('../supabase/functions/bt-ingest/events.gen.json');

const CFG = {
  provider: 'deepseek',
  apiKey: 'KEY',
  baseUrl: 'https://api.deepseek.com/v1/chat/completions',
};
const NEW_CODES = ['auth', 'model_not_allowed', 'credit_exhausted', 'grant_unavailable', 'stalled'];

// ── 用真实 TranslationAPI 生成错误（status / auth / route 都走生产分类）──────────
function loadAPIWith(fetch) {
  const chrome = makeChrome({});
  const window = {};
  loadModule('providers.gen.js', { window });
  const ctx = loadModule(['translation-core.js', 'engine-state.js', 'request-shape.js', 'translation-api.js'], {
    fetch, chrome, AbortController, URLSearchParams, window, WireFormat,
  });
  return { API: ctx.TranslationAPI, fetch };
}

function loadAPI(program) {
  // makeFetch takes an ordered ARRAY (or a sync handler fn); a single response object
  // would be indexed as `program[0]` and come back undefined. Async handlers that
  // *return rejected promises* are not supported there — use loadAPIWith for those.
  return loadAPIWith(makeFetch(typeof program === 'function' ? program : [program]));
}

function apiErrorWith(fetch) {
  const { API } = loadAPIWith(fetch);
  return rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', '', null, { noCache: true }));
}

function apiError(program) {
  const { API } = loadAPI(program);
  return rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', '', null, { noCache: true }));
}

// 把真实错误对象交给 EngineTest 的导出处（fake TranslationAPI 原样抛出），
// 用同步 stub 捕获 MTTelemetry.track 的 props —— 要断言的是发送口，不是队列。
function loadET(err, extra = {}) {
  const seen = [];
  const sandbox = Object.assign({
    window: {},
    WireFormat,
    TranslationAPI: { translate: async () => { throw err; } },
    MTTelemetry: { track: (name, props) => seen.push({ name, props }) },
  }, extra);
  return { ET: loadModule('learn/engine-test.js', sandbox).EngineTest, seen };
}

async function propsFor(err, extra) {
  const { ET, seen } = loadET(err, extra);
  await rejects(() => ET.translation(CFG));
  eq(seen.length, 1, '一次失败应当只发一条 engine_test');
  eq(seen[0].name, 'engine_test');
  return seen[0].props;
}

const body = (error, status, headers) => ({ status, json: { error }, headers: headers || {} });
const keys = (o) => Object.keys(o).sort().join(',');

describe('BEL-284 — 注册表与生成物', () => {
  test('五个新码在注册表与 events.gen.json 里，other 仍留作兜底', () => {
    for (const code of NEW_CODES) {
      ok(cfg.EVENTS.engine_test.code.indexOf(code) >= 0, 'telemetry.config 缺 ' + code);
      ok(gen.events.engine_test.code.indexOf(code) >= 0, 'events.gen.json 缺 ' + code);
    }
    ok(cfg.EVENTS.engine_test.code.indexOf('other') >= 0, 'other 兜底被删了');
    deepEq(gen.events.engine_test.code, cfg.EVENTS.engine_test.code);
  });

  test('http 是 int、route 是 direct|proxy、provider 复用 engine_set 的 id 规则', () => {
    eq(cfg.EVENTS.engine_test.http, 'int');
    eq(gen.events.engine_test.http, 'int');
    deepEq(cfg.EVENTS.engine_test.route, ['direct', 'proxy']);
    deepEq(gen.events.engine_test.route, ['direct', 'proxy']);
    eq(cfg.EVENTS.engine_test.provider, cfg.EVENTS.engine_set.provider);
    eq(gen.events.engine_test.provider, gen.events.engine_set.provider);
    eq(cfg.EVENTS.engine_test.provider, 'id');
  });

  test('四个失败字段都不是必填 —— 事件只登记允许的键，没有 required 概念', () => {
    const props = cfg.EVENTS.engine_test;
    for (const k of ['http', 'route', 'provider']) ok(k in props, '注册表缺 ' + k);
    // 成功行只有两个键，仍能过客户端 shape（见下面的成功形状测试）。
    eq(keys({ slot: 'chat', result: 'ok' }), 'result,slot');
  });
});

describe('BEL-284 — 六种失败各自可辨（真实 TranslationAPI 错误）', () => {
  const cases = [
    ['401 real key', () => apiError(body('invalid_api_key', 401)),
      { code: 'auth', http: 401, route: 'direct' }],
    ['403 forbidden', () => apiError(body('forbidden', 403)),
      { code: 'auth', http: 403, route: 'direct' }],
    ['CORS / network', () => apiErrorWith(() => { throw new TypeError('Load failed'); }),
      { code: 'network', route: 'direct' }],
    ['404 not found', () => apiError(body('not_found', 404)),
      { code: 'http', http: 404, route: 'direct' }],
    // 现有语义：中继的 busy(429) 映射成 http+429；credit_exhausted 是 402 那一族。
    ['429 rate limited', () => apiError(body('rate_limited', 429, { 'retry-after': '0' })),
      { code: 'http', http: 429, route: 'direct' }],
    // 真实传输层把 AbortError 具名成 timeout，且**不带** status。
    ['timeout', () => apiErrorWith(() => { const e = new Error('aborted'); e.name = 'AbortError'; return Promise.reject(e); }),
      { code: 'timeout', route: 'direct' }],
  ];

  test('六个组合两两不同（code,http,route）', async () => {
    const seen = new Set();
    for (const [name, make] of cases) {
      const err = await make();
      const props = await propsFor(err);
      const combo = [props.code, props.http === undefined ? '-' : props.http, props.route].join('|');
      ok(!seen.has(combo), name + ' 与前面的失败组合相同：' + combo);
      seen.add(combo);
    }
    eq(seen.size, cases.length);
  });

  for (const [name, make, expected] of cases) {
    test(`${name} → ${JSON.stringify(expected)}`, async () => {
      const err = await make();
      const props = await propsFor(err);
      eq(props.code, expected.code, 'code');
      eq(props.http, expected.http, 'http');
      eq(props.route, expected.route, 'route');
      eq(props.provider, 'deepseek', 'provider 来自本次 cfg');
      eq(props.slot, 'chat');
      eq(props.result, 'fail');
      process.stdout.write(`  BEL-284 actual ${name}: ${JSON.stringify(props)}\n`);
    });
  }

  test('新码里的 402 credit_exhausted / 403 model_not_allowed / 503 grant_unavailable 各自直通', async () => {
    for (const [error, status, code] of [
      ['credit_exhausted', 402, 'credit_exhausted'],
      ['model_not_allowed', 403, 'model_not_allowed'],
      ['grant_unavailable', 503, 'grant_unavailable'],
    ]) {
      const props = await propsFor(await apiError(body(error, status)));
      eq(props.code, code, error);
      eq(props.http, status, error + ' status');
      eq(props.route, 'direct', error + ' route');
    }
  });

  test('stalled（单单元 120 s 不落地）无 http 也保留自己的码', async () => {
    const err = Object.assign(new Error('stalled'), { code: 'stalled', route: 'proxy' });
    const props = await propsFor(err);
    eq(props.code, 'stalled');
    eq(props.http, undefined);
    eq(props.route, 'proxy');
  });
});

describe('BEL-284 — 白名单外的 code 仍兜底 other', () => {
  test('未知 code → other，但 http/route 仍保留（它们是独立的失败切片）', async () => {
    const err = Object.assign(new Error('weird'), {
      code: 'totally_new_code', status: 418, route: 'direct',
    });
    const props = await propsFor(err);
    eq(props.code, 'other');
    eq(props.http, 418);
    eq(props.route, 'direct');
  });

  test('完全没有 code 的错也落 other，不丢这条失败', async () => {
    const props = await propsFor(new TypeError('Load failed'));
    eq(props.code, 'other');
    eq(props.http, undefined);
    eq(props.route, undefined);
  });
});

describe('BEL-284 — http / route / provider 的闸门', () => {
  test('http 只写 100–599 的整数：越界、0、小数、字符串都不写', async () => {
    for (const status of [0, 99, 600, 1000, 200.5, '500', null, undefined]) {
      const props = await propsFor(Object.assign(new Error('x'), { code: 'http', status }));
      eq(props.http, undefined, '写了非法 http：' + String(status));
    }
    for (const status of [100, 401, 599]) {
      const props = await propsFor(Object.assign(new Error('x'), { code: 'http', status }));
      eq(props.http, status);
    }
  });

  test('route 只写 direct / proxy：空串、未知、非字符串都不写（不写空串）', async () => {
    for (const route of ['', 'Direct', 'relay', null, 1]) {
      const props = await propsFor(Object.assign(new Error('x'), { code: 'network', route }));
      eq(props.route, undefined, '写了非法 route：' + String(route));
    }
    for (const route of ['direct', 'proxy']) {
      const props = await propsFor(Object.assign(new Error('x'), { code: 'network', route }));
      eq(props.route, route);
    }
  });

  test('provider 按 id 规则：合法值写，非法/缺失不写', async () => {
    const seen = [];
    const ET = loadModule('learn/engine-test.js', {
      window: {}, WireFormat,
      TranslationAPI: { translate: async () => { throw Object.assign(new Error('x'), { code: 'network' }); } },
      MTTelemetry: { track: (n, p) => seen.push(p) },
    }).EngineTest;
    for (const provider of ['', 'DeepSeek', 'bad provider', 'x'.repeat(33), null]) {
      await rejects(() => ET.translation({ provider, apiKey: 'KEY', baseUrl: CFG.baseUrl }));
      eq(seen[seen.length - 1].provider, undefined, '写了非法 provider：' + String(provider));
    }
    await rejects(() => ET.translation({ provider: 'custom_chat', apiKey: 'KEY', baseUrl: CFG.baseUrl }));
    eq(seen[seen.length - 1].provider, 'custom_chat');
  });

  test('notes 槽的 provider 来自 resolveConfig 之后的 cfg（可以跟随翻译组）', async () => {
    const seen = [];
    const LearnNotes = {
      resolveConfig: () => ({ baseUrl: 'https://notes.example/v1/chat/completions', provider: 'zhipu', apiKey: 'KEY' }),
      configure: () => {},
      test: async () => { throw Object.assign(new Error('no'), { code: 'auth', status: 401, route: 'proxy' }); },
    };
    const ET = loadModule('learn/engine-test.js', {
      window: {}, WireFormat, LearnNotes,
      MTTelemetry: { track: (n, p) => seen.push(p) },
    }).EngineTest;
    await rejects(() => ET.notes({}));
    eq(seen[0].provider, 'zhipu');
    eq(seen[0].slot, 'notes');
  });
});

describe('BEL-284 — 成功不写失败字段', () => {
  test('成功形状仍是 {slot,result}，没有 code/http/route/provider', async () => {
    const seen = [];
    const ET = loadModule('learn/engine-test.js', {
      window: {}, WireFormat,
      TranslationAPI: { translate: async () => '你好' },
      MTTelemetry: { track: (n, p) => seen.push({ n, p }) },
    }).EngineTest;
    await ET.translation(CFG);
    eq(seen.length, 1);
    eq(keys(seen[0].p), 'result,slot');
    deepEq(seen[0].p, { slot: 'chat', result: 'ok' });
  });
});

describe('BEL-284 — 隐私红线：只发这四个字段', () => {
  test('401 的错误对象带着 key/URL/serverMessage，事件里一个都没有', async () => {
    const err = await apiError(body('Incorrect API key provided: sk-SECRET', 401));
    ok(/sk-SECRET/.test(err.serverMessage || ''), '前置：真实错误确实带服务端原话');
    ok(/api\.deepseek\.com/.test(err.url || ''), '前置：真实错误确实带完整 URL');
    const props = await propsFor(err);
    eq(keys(props), 'code,http,provider,result,route,slot');
    const json = JSON.stringify(props);
    for (const forbidden of ['sk-SECRET', 'Incorrect API key', 'api.deepseek.com', 'serverMessage', 'https://']) {
      ok(json.indexOf(forbidden) < 0, '事件里出现了 ' + forbidden + '：' + json);
    }
  });
});

describe('BEL-284 — 客户端白名单真的收下新字段（MTTelemetry shape）', () => {
  test('EngineTest 发出的 props 能过真 shape 并进入队列', async () => {
    const store = {};
    const window = {
      MT_VERSION: '1.23.4',
      MT_FLAVOR: 'global',
      MT_TELEMETRY: {
        url: 'https://x.test/functions/v1/bt-ingest',
        spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
      },
    };
    const chrome = makeChrome({ store });
    const ctx = loadModule(['learn/telemetry.js', 'learn/engine-test.js'], {
      window, chrome, WireFormat,
      crypto: require('crypto').webcrypto,
      navigator: { userAgent: 'Mozilla/5.0', language: 'en' },
      fetch: async () => ({ ok: true }),
      TranslationAPI: {
        translate: async () => {
          throw Object.assign(new Error('HTTP 401'), {
            code: 'auth', status: 401, route: 'direct',
            serverMessage: 'Incorrect API key provided: sk-SECRET',
            url: 'https://api.deepseek.com/v1/chat/completions',
          });
        },
      },
    });
    await rejects(() => ctx.EngineTest.translation(CFG));
    await tick(50);
    const queue = store['tm:queue'] || [];
    eq(queue.length, 1, '事件没有入队（白名单拒了？）');
    eq(queue[0].name, 'engine_test');
    deepEq(queue[0].props, {
      slot: 'chat', result: 'fail', code: 'auth', http: 401, route: 'direct', provider: 'deepseek',
    });
    ok(!JSON.stringify(queue[0]).includes('sk-SECRET'));
  });
});
