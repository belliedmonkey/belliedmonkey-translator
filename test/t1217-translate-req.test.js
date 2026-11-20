// t1217u — per-request slow-translation telemetry (`translate_req`).
// Counts/enums/ms only: no text, prompt, response body, think content, token values or key.
const { describe, test, ok, eq } = require('./harness');
const { loadModule } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');

function loadAPI(program, events) {
  const window = {};
  loadModule('providers.gen.js', { window });
  const MTTelemetry = { track: (name, props) => events.push({ name, props: Object.assign({}, props) }) };
  const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'], {
    fetch: makeFetch(program), chrome: makeChrome({}), AbortController, URLSearchParams,
    window, WireFormat, MTTelemetry,
  });
  return ctx.TranslationAPI;
}

const chatOK = {
  status: 200,
  json: { choices: [{ message: { content: '你好' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
};

describe('t1217u — translate_req covers size / timing / tokens / thinking', () => {
  test('success: counts, provider usage, timing segments, think=unknown, no ttft', async () => {
    const events = [];
    const API = loadAPI([chatOK], events);
    const text = 'hello world';
    const out = await API.translate(text, 'zh-CN', 'deepseek', 'K',
      'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat',
      { telemetry: true, kind: 'page' });
    eq(out, '你好');
    const ev = events.find((e) => e.name === 'translate_req');
    ok(ev, 'translate_req must be emitted');
    const p = ev.props;
    eq(p.kind, 'page');
    eq(p.chars, text.length);
    eq(p.units, 1);
    eq(p.est_tokens, Math.ceil(text.length / 4));
    eq(p.in_tok, 10);
    eq(p.out_tok, 2);
    eq(p.tok_src, 'provider');
    eq(p.think, 'unknown');
    eq(p.stream, 'none');
    eq(p.result, 'ok');
    eq(p.attempt, 1);
    ok(Number.isInteger(p.queue_ms) && p.queue_ms >= 0, 'queue_ms');
    ok(Number.isInteger(p.net_ms) && p.net_ms >= 0, 'net_ms');
    ok(Number.isInteger(p.recv_ms) && p.recv_ms >= 0, 'recv_ms');
    ok(Number.isInteger(p.total_ms) && p.total_ms >= 0, 'total_ms');
    eq(Object.prototype.hasOwnProperty.call(p, 'ttft_ms'), false, 'non-streaming must omit ttft_ms');
    eq(Object.prototype.hasOwnProperty.call(p, 'think_ms'), false, 'must not invent think_ms');
  });

  test('final 400 failure: size + code + status + timing, one event', async () => {
    const events = [];
    const API = loadAPI([{ status: 400, json: { error: { message: 'bad shape' } } }], events);
    let threw = false;
    try {
      await API.translate('hello world', 'zh-CN', 'deepseek', 'K',
        'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat',
        { telemetry: true, kind: 'page' });
    } catch (_) { threw = true; }
    ok(threw, '400 must reject');
    const evs = events.filter((e) => e.name === 'translate_req');
    eq(evs.length, 1, 'one final-failure event');
    const p = evs[0].props;
    eq(p.kind, 'page');
    eq(p.result, 'fail');
    eq(p.code, 'http');
    eq(p.status, 400);
    eq(p.chars, 'hello world'.length);
    eq(p.tok_src, 'estimate');
    eq(p.think, 'unknown');
    ok(Number.isInteger(p.total_ms), 'total_ms on fail');
  });

  test('no opts.telemetry: no per-request event (translate-fill / engine-test stay out)', async () => {
    const events = [];
    const API = loadAPI([chatOK], events);
    await API.translate('hello world', 'zh-CN', 'deepseek', 'K',
      'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat');
    eq(events.filter((e) => e.name === 'translate_req').length, 0);
  });
});
