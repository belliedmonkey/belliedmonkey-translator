// test/bel270b-client-mapping.test.js — BEL-270 option B (client-only).
//
// The product backed out the option-A contract: no new enum values, no `reason`
// parsing. The deployed relay's already-known named errors still have to land in
// the DEPLOYED translate_fail enum:
//
//   model_not_allowed / grant_unavailable / credit_exhausted → itself
//   grant_revoked / grant_invalid                          → auth
//   grant_misconfigured                                    → grant_unavailable
//   busy (429)                                              → http + status 429
//   unknown 4xx / a relay 400                               → http
//
// The assertions here are deliberately inverted: the strongest ones say what the
// event must NOT contain (response body, reason, serverMessage, prompt, token) and
// that every emitted code is inside events.gen.json.
const { describe, test, ok, eq, deepEq, match, rejects, loadModule, tick } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const fs = require('fs');
const path = require('path');
const WireFormat = require('../extension/content/wire-format.js');

const ROOT = path.join(__dirname, '..');
const cfg = require('../build/telemetry.config.js');
const gen = require('../supabase/functions/bt-ingest/events.gen.json');

// The exact pre-option-A enum. events.gen.json must be byte-for-byte back to this
// list; there is no new contract and BEL-278 owns any future contract move.
const PRE_A_ENUM = ['timeout', 'network', 'http', 'reasoning_starved', 'no_base',
  'unknown_provider', 'credit_exhausted', 'grant_unavailable', 'model_not_allowed',
  'auth', 'stalled'];

const EVENT_KEYS = ['provider', 'kind', 'code', 'status', 'route', 'ms'];
const FORBIDDEN_KEYS = ['err_detail', 'reason', 'response', 'body', 'serverMessage',
  'raw', 'text', 'prompt', 'translation', 'token'];

function loadRegistry() {
  const window = {};
  loadModule('providers.gen.js', { window });
  return window;
}

function load(program) {
  const chrome = makeChrome({});
  const fetch = makeFetch(program);
  const window = loadRegistry();
  const ctx = loadModule(['translation-core.js', 'engine-state.js', 'request-shape.js', 'translation-api.js'], {
    fetch, chrome, AbortController, URLSearchParams, window, WireFormat,
  });
  return { API: ctx.TranslationAPI, TC: ctx.TranslationCore, fetch, chrome };
}

const relay = (status, body, headers) => ({
  status,
  json: body,
  text: typeof body === 'string' ? body : JSON.stringify(body),
  headers: headers || {},
});
const okJson = (json) => ({ status: 200, json, headers: {} });

function assertOnlyEventKeys(event, label) {
  for (const k of Object.keys(event)) {
    ok(EVENT_KEYS.indexOf(k) >= 0, (label || 'event') + ' 带了表外属性 ' + k);
  }
  for (const k of FORBIDDEN_KEYS) {
    ok(!(k in event), (label || 'event') + ' 带了禁止属性 ' + k);
  }
}

describe('BEL-270B 枚举：回到 A 之前的注册表，没有新契约', () => {
  test('cfg / events.gen 的 translate_fail.code 就是 pre-A 那 11 个值', () => {
    deepEq(cfg.EVENTS.translate_fail.code, PRE_A_ENUM);
    deepEq(gen.events.translate_fail.code, PRE_A_ENUM);
    deepEq(gen.events.translate_fail.code, cfg.EVENTS.translate_fail.code,
      'events.gen.json 必须由 scripts/gen-telemetry.js 生成，不能手改');
  });

  test('没有 relay_bad_*，也没有 reason / 响应正文属性', () => {
    for (const list of [cfg.EVENTS.translate_fail.code, gen.events.translate_fail.code]) {
      for (const c of list) ok(c.indexOf('relay_bad_') !== 0, '残留 A 的码 ' + c);
    }
    for (const schema of [cfg.EVENTS.translate_fail, gen.events.translate_fail]) {
      for (const k of ['reason', 'err_detail', 'response', 'body', 'serverMessage', 'text']) {
        ok(!(k in schema), 'translate_fail 多了属性 ' + k);
      }
      deepEq(Object.keys(schema).sort(), EVENT_KEYS.slice().sort());
    }
  });

  test('代码里不再有 A 的 reason→新码 映射', () => {
    const src = fs.readFileSync(path.join(ROOT, 'extension/content/translation-api.js'), 'utf8');
    ok(!/relay_bad_/.test(src), 'translation-api.js 还留着 relay_bad_*');
    ok(!/RELAY_BAD_REASONS|relayBadCode/.test(src), 'translation-api.js 还在解析 reason');
  });

  test('每个映射目标都在部署枚举里', () => {
    const { API } = load([]);
    for (const code of Object.keys(API.RELAY_FAIL_CODES).map((k) => API.RELAY_FAIL_CODES[k])) {
      ok(gen.events.translate_fail.code.indexOf(code) >= 0, '映射到了表外的码 ' + code);
    }
  });
});

describe('BEL-270B 400：泛化 http + 400，不解析 reason，不停整页', () => {
  test('bad_request + reason + message → code=http, status=400, UI 有字', async () => {
    const { API, TC, fetch } = load([relay(400, {
      error: 'bad_request',
      reason: 'json_syntax',
      message: 'bad request: messages must be a JSON array',
    })]);
    const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(e.code, 'http');
    eq(e.status, 400, 'status 必须仍是 400');
    eq(e.retryable, false, '400 不可重试');
    ok(e.serverMessage && e.serverMessage.length > 0, 'UI 没有服务端原话');
    ok(e.serverMessage.length <= 200, 'serverMessage 超过 200 字：' + e.serverMessage.length);
    ok(!('reason' in e), '错误对象上不该另挂 reason');
    eq(fetch.calls.length, 1, '同一段不得在 API 层重发');

    const event = TC.failProps(e, 'deepseek', 'page');
    assertOnlyEventKeys(event, '400 event');
    eq(event.code, 'http');
    eq(event.status, 400);
    const blob = JSON.stringify(event).toLowerCase();
    for (const needle of ['json_syntax', 'messages must be a json array', 'bad_request', 'reason']) {
      ok(blob.indexOf(needle) < 0, '事件里出现了响应正文片段：' + needle);
    }
  });

  test('400 纯文本 / 缺 reason / reason 不是字符串 全部 http', async () => {
    const bodies = [
      'bad request',
      { error: 'bad_request' },
      { error: 'bad_request', reason: 42 },
      { error: 'bad_request', reason: 'something_new' },
    ];
    for (const body of bodies) {
      const { API } = load([relay(400, body)]);
      const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
      eq(e.code, 'http', JSON.stringify(body));
      eq(e.status, 400);
      eq(e.retryable, false);
    }
  });

  test('一段 400 只让这一段 error：下一段照常翻，引擎不停机', async () => {
    const { API, TC, fetch } = load((url, opts, i) => (i === 0
      ? relay(400, { error: 'bad_request', reason: 'input_invalid' })
      : okJson({ choices: [{ message: { content: '第二段译文' } }] })));
    const engine = TC.createEngine({
      translate: (text) => API.translate(text, 'zh-CN', 'deepseek', 'KEY', ''),
      targetLang: 'fr',
      window: { AHEAD_MS: 0, MAX_PER_TICK: 1, MAX_RETRIES: 1, RETRY_GRACE_MS: 0, GRACE_MS: 0 },
    });
    const units = [{ text: '第一段文字' }, { text: '第二段文字' }];
    engine.setUnits(units);
    engine.pump();
    await tick(20);
    eq(engine.stateOf(units[0]).state, 'error');
    eq(fetch.calls.length, 1);
    engine.pump();
    await tick(20);
    eq(engine.stateOf(units[1]).translation, '第二段译文');
    eq(engine.halted, false, '一段 400 不能停整页');
    eq(fetch.calls.length, 2);
  });
});

describe('BEL-270B 具名中继错误：只落到部署枚举里', () => {
  const CASES = [
    ['credit_exhausted', 402, 'credit_exhausted'],
    ['grant_unavailable', 503, 'grant_unavailable'],
    ['model_not_allowed', 403, 'model_not_allowed'],
    ['grant_misconfigured', 503, 'grant_unavailable'],
    ['grant_revoked', 403, 'auth'],
    ['grant_invalid', 401, 'auth'],
    ['busy', 429, 'http'],
    ['internal', 500, 'http'],
  ];

  for (const [name, status, code] of CASES) {
    test(name + ' (' + status + ') → ' + code, async () => {
      const { API, TC, fetch } = load([relay(status, {
        error: name,
        message: 'relay said: ' + name + ' token sk-live-SECRET123456',
      })]);
      const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
      eq(e.code, code);
      eq(e.status, status);
      ok(gen.events.translate_fail.code.indexOf(e.code) >= 0, '发出了表外的码 ' + e.code);
      // Known relay names are non-retryable. An unknown 5xx keeps the old retry
      // path; an unknown 4xx is non-retryable by status (asserted in the next test).
      if (status === 500) ok(fetch.calls.length >= 1); else eq(fetch.calls.length, 1);
      ok(e.serverMessage.length <= 200);
      ok(e.serverMessage.indexOf('sk-live-SECRET') < 0, 'UI 里漏出了 token：' + e.serverMessage);

      const event = TC.failProps(e, 'deepseek', 'page');
      assertOnlyEventKeys(event, name + ' event');
      eq(event.code, code);
      eq(event.status, status);
      const blob = JSON.stringify(event);
      ok(blob.indexOf('relay said') < 0, '事件里出现了响应正文');
      ok(blob.indexOf('SECRET') < 0, '事件里出现了 token');
      ok(blob.indexOf('reason') < 0);
    });
  }

  test('未知 4xx 具名错误也归 http，不会原样发出去', async () => {
    for (const [name, status] of [['teapot', 418], ['invalid_request', 422], ['nope', 400]]) {
      const { API, TC } = load([relay(status, { error: name })]);
      const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
      eq(e.code, 'http', name);
      const event = TC.failProps(e, 'deepseek', 'page');
      eq(event.code, 'http');
      ok(gen.events.translate_fail.code.indexOf(event.code) >= 0);
    }
  });
});

describe('BEL-270B 事件是白名单，负向断言优先', () => {
  test('failProps 只挑白名单字段；正文 / reason / serverMessage 一概不进', () => {
    const { TC } = load([]);
    const err = {
      code: 'http', status: 400, route: 'direct', ms: 12,
      reason: 'json_syntax', response: '{"secret":"RESPONSE_TEXT"}',
      body: 'BODY_TEXT', err_detail: 'DETAIL_TEXT', serverMessage: 'SERVER_TEXT',
      prompt: 'PROMPT_TEXT', translation: 'TRANSLATION_TEXT', token: 'TOKEN_TEXT',
      url: 'https://relay.example/secret', raw: 'RAW_TEXT',
    };
    const event = TC.failProps(err, 'deepseek', 'page');
    deepEq(Object.keys(event).sort(), ['code', 'kind', 'ms', 'provider', 'route', 'status']);
    assertOnlyEventKeys(event, 'failProps');
    const blob = JSON.stringify(event);
    for (const secret of ['RESPONSE_TEXT', 'BODY_TEXT', 'DETAIL_TEXT', 'SERVER_TEXT',
      'PROMPT_TEXT', 'TRANSLATION_TEXT', 'TOKEN_TEXT', 'RAW_TEXT', 'json_syntax',
      'relay.example']) {
      ok(blob.indexOf(secret) < 0, '事件泄露了 ' + secret + '：' + blob);
    }
  });

  test('未知 code 被夹回枚举，事件不会因为表外码被整条丢掉', () => {
    const { TC } = load([]);
    eq(TC.failProps({ code: 'brand_new_code', status: 400 }, 'x', 'page').code, 'http');
    eq(TC.failProps({ code: 'brand_new_code' }, 'x', 'page').code, 'network');
    ok(TC.FAIL_CODES.indexOf(TC.failProps({ code: 'stalled' }, 'x', 'page').code) >= 0);
  });
});

describe('BEL-270B serverMessage 只给 UI：200 字上限，去掉 URL / 邮箱 / token', () => {
  test('safeServerMessage 截断并脱敏', () => {
    const { API } = load([]);
    const raw = 'relay rejected https://relay.example/path?key=abc mail me@example.com '
      + 'token sk-live-ABCDEFGH12345678 ' + 'x'.repeat(300);
    const out = API.safeServerMessage(raw);
    ok(out.length <= 200, '超过 200 字：' + out.length);
    ok(out.indexOf('https://') < 0, out);
    ok(out.indexOf('me@example.com') < 0, out);
    ok(out.indexOf('sk-live-ABCDEFGH12345678') < 0, out);
    match(out, /relay rejected/);
    eq(API.safeServerMessage(''), '');
    eq(API.safeServerMessage(null), '');
  });
});
