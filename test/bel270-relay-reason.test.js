// test/bel270-relay-reason.test.js — BEL-270：中继 400 的 reason → translate_fail.code。
//
// 中继保持 `error: 'bad_request'` 原样，只加机器可读的 `reason`。这一组钉四件事：
//   ① 四个 reason 各映射到自己的码；未知/缺失 reason 仍走既有 http + status 400；
//   ② 400（映射或 http）不可重试 —— 同一段只发一次请求；
//   ③ 某一段 400 不让整页/整份文档/整条字幕停泵，后面的段继续翻；
//   ④ 四个码真的在 build/telemetry.config.js 与 events.gen.json 白名单里；事件属性
//      没有新增 reason / err_msg（服务端会整条拒收表外属性）。
const { describe, test, ok, eq, deepEq, rejects, loadModule, tick } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');

const ROOT = require('path').join(__dirname, '..');
const cfg = require('../build/telemetry.config.js');
const gen = require('../supabase/functions/bt-ingest/events.gen.json');

const CASES = [
  ['json_syntax', 'relay_bad_json'],
  ['messages_json', 'relay_bad_messages'],
  ['audio_decode', 'relay_bad_audio'],
  ['input_invalid', 'relay_bad_input'],
];

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

const relay400 = (reason) => ({
  status: 400,
  json: reason === undefined ? { error: 'bad_request' } : { error: 'bad_request', reason },
  headers: {},
});
const okJson = (json) => ({ status: 200, json, headers: {} });

describe('BEL-270 注册表：四个 code 在 config 与 events.gen 里', () => {
  test('枚举值齐全，生成物与注册表一致（只加这四个值）', () => {
    for (const [, code] of CASES) {
      ok(cfg.EVENTS.translate_fail.code.indexOf(code) >= 0, 'telemetry.config 缺 ' + code);
      ok(gen.events.translate_fail.code.indexOf(code) >= 0, 'events.gen 缺 ' + code);
    }
    deepEq(gen.events.translate_fail.code, cfg.EVENTS.translate_fail.code,
      'events.gen.json 必须由 scripts/gen-telemetry.js 生成，不能手改');
    // 既有的码一个都没少。
    for (const old of ['timeout', 'network', 'http', 'reasoning_starved', 'no_base', 'unknown_provider',
      'credit_exhausted', 'grant_unavailable', 'model_not_allowed', 'auth', 'stalled']) {
      ok(cfg.EVENTS.translate_fail.code.indexOf(old) >= 0, '旧的码被删了：' + old);
    }
  });

  test('translate_fail 没有新增 reason / err_msg 属性（表外属性会被 bt-ingest 整条拒）', () => {
    ok(!('reason' in gen.events.translate_fail), 'translate_fail 多了 reason 属性');
    ok(!('err_msg' in gen.events.translate_fail), 'translate_fail 多了 err_msg 属性');
    ok(!('reason' in cfg.EVENTS.translate_fail), 'telemetry.config 多了 reason 属性');
    ok(!('err_msg' in cfg.EVENTS.translate_fail), 'telemetry.config 多了 err_msg 属性');
  });
});

describe('BEL-270 客户端：reason → code', () => {
  for (const [reason, code] of CASES) {
    test(`${reason} → ${code}，400 不可重试，同一段只发一次`, async () => {
      const { API, fetch } = load([relay400(reason)]);
      const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
      eq(e.code, code);
      eq(e.status, 400, 'status 必须仍是 400');
      eq(e.retryable, false, '映射后的 400 仍然不可重试');
      eq(fetch.calls.length, 1, '同一段不得重发（实际发了 ' + fetch.calls.length + ' 次）');
      ok(!('reason' in e), '错误对象上不该另挂 reason 文本');
    });
  }

  test('未知 reason → http + 400，不可重试', async () => {
    const { API, fetch } = load([relay400('something_new')]);
    const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(e.code, 'http');
    eq(e.status, 400);
    eq(e.retryable, false);
    eq(fetch.calls.length, 1);
    ok(!('reason' in e));
  });

  test('缺失 reason（旧中继 JSON）→ http + 400', async () => {
    const { API } = load([relay400(undefined)]);
    const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(e.code, 'http');
    eq(e.status, 400);
    eq(e.retryable, false);
  });

  test('400 纯文本（无 JSON reason）→ http + 400（回归）', async () => {
    const { API } = load([{ status: 400, text: 'bad request', json: {}, headers: {} }]);
    const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(e.code, 'http');
    eq(e.status, 400);
    eq(e.retryable, false);
  });

  test('reason 不是字符串 → http + 400，不猜', async () => {
    const { API } = load([{ status: 400, json: { error: 'bad_request', reason: 42 }, headers: {} }]);
    const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
    eq(e.code, 'http');
    eq(e.status, 400);
  });

  test('第 1 段 400 不停第 2 段：第 2 段照常翻，第 1 段只请求一次', async () => {
    const { API, TC, fetch } = load((url, opts, i) => (i === 0
      ? relay400('json_syntax')
      : okJson({ choices: [{ message: { content: '第二段译文' } }] })));
    const engine = TC.createEngine({
      translate: (text) => API.translate(text, 'zh-CN', 'deepseek', 'KEY', ''),
      targetLang: 'fr',
      window: { AHEAD_MS: 0, MAX_PER_TICK: 1, MAX_RETRIES: 1, RETRY_GAP_MS: 0, GRACE_MS: 0 },
    });
    const units = [{ text: '第一段文字' }, { text: '第二段文字' }];
    engine.setUnits(units);
    engine.pump();
    await tick(20);
    eq(engine.stateOf(units[0]).state, 'error', '第 1 段应当进 error 态');
    eq(fetch.calls.length, 1, '第 1 段 400 不得重发');
    engine.pump();
    await tick(20);
    eq(engine.stateOf(units[1]).state, '', '第 2 段必须继续翻译');
    eq(engine.stateOf(units[1]).translation, '第二段译文');
    eq(fetch.calls.length, 2, '两段各一次请求');
    eq(engine.halted, false, '一段 400 不能把整页停掉');
  });
});
