// test/attrib-no-surface.test.js — BEL-267 follow-up: the two call sites that
// legitimately know no surface must still carry the full attribution, and the
// missing surface must not break the charge-attribution path.
//
// ONE test, two REAL call sites, a real MTTelemetry instance and the real
// fake-fetch boundary. No product code is stubbed: the headers asserted here are
// the ones the fake fetch actually received.
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');
const TTS_REGISTRY = require('../build/tts.config.js');
const {
  makeTelemetry, expectAttribution, deriveGrantEvent, INSTALL_ID, VERSION,
} = require('./attrib-headers-fixture');

const RELAY = 'https://backend.example/functions/v1/bt-relay';

// ── translation-api: the REAL module, loaded with the REAL provider registry ──
function loadTranslationAPI(fx) {
  const window = {};
  loadModule('providers.gen.js', { window });
  const chrome = makeChrome();
  const fetch = makeFetch([{
    status: 200,
    json: { choices: [{ message: { content: '你好' } }] },
  }]);
  const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'], {
    fetch, chrome, AbortController, URLSearchParams, window, WireFormat, MTTelemetry: fx.T,
  });
  return { API: ctx.TranslationAPI, fetch };
}

// ── tts: the REAL module, loaded with the REAL speech registry ───────────────
function loadTTS(fx) {
  const cache = new Map();
  const calls = [];
  const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
  const fetchStub = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
      arrayBuffer: () => Promise.resolve(new Uint8Array([73, 68, 51, 4]).buffer),
    });
  };
  const LearnStore = {
    getAudio: (k) => Promise.resolve(cache.get(k) || null),
    putAudio: (k, payload) => {
      cache.set(k, { buf: payload.buf, type: payload.type });
      return Promise.resolve();
    },
  };
  const ctx = loadModule(['content/request-shape.js', 'learn/tts.js'], {
    window: { MT_TTS_ENGINES: TTS_REGISTRY.map((e) => Object.assign({}, e)) },
    LearnModel,
    LearnStore,
    WireFormat,
    LearnRules: loadModule('learn-rules.js', { window: {} }).LearnRules,
    MTTelemetry: fx.T,
    AbortController,
    fetch: fetchStub,
    Uint8Array,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  });
  return { TTS: ctx.LearnTTS, calls };
}

function assertNoSurfaceAttribution(headers, kind, fx, label) {
  // 1) No surface does NOT mean no attribution: v / host / install id are still
  // on the wire (plus the rest of the relay's attribution header set).
  eq(headers['x-mt-install-id'], INSTALL_ID, label + ': x-mt-install-id must be present');
  eq(headers['x-mt-v'], VERSION, label + ': x-mt-v must be present');
  eq(headers['x-mt-host'], 'safari', label + ': x-mt-host must be present');
  expectAttribution(headers, fx.headers);
  // 2) The surface header itself is absent — not empty, not 'page'.
  ok(!Object.prototype.hasOwnProperty.call(headers, 'x-mt-surface'),
    label + ': x-mt-surface must be absent when the call site knows no surface');

  // 3) Same headers through the relay's attribution mirror: the charge attribution
  // path still produces full attribution for the event.
  const ev = deriveGrantEvent(headers, kind);
  eq(ev.name, 'grant_debited', label + ': event name');
  eq(ev.install_id, INSTALL_ID, label + ': event install_id');
  eq(ev.v, VERSION, label + ': event v');
  eq(ev.host, 'safari', label + ': event host');
  eq(ev.props.kind, kind, label + ': event props.kind');
  ok(!Object.prototype.hasOwnProperty.call(ev.props, 'surface'),
    label + ': event props.surface must be absent');
  // 4) cost_usd is billing, NOT telemetry. The relay's bt_grant_charge() writes
  // cost_usd (with user_id / install_id / kind / model / ms) to bt_grant_usage;
  // grant_debited only carries attribution (kind, plus v/host on the event).
  // Assert that explicitly so "just put the amount on the event" cannot slip in.
  ok(!Object.prototype.hasOwnProperty.call(ev, 'cost_usd'),
    label + ': cost_usd must NOT be on the event (it lives in bt_grant_usage)');
  ok(!Object.prototype.hasOwnProperty.call(ev.props, 'cost_usd'),
    label + ': cost_usd must NOT be in event props (it lives in bt_grant_usage)');
}

describe('BEL-267 — no-surface call sites keep attribution', () => {
  test('translation-api default and tts without cfg.surface still send v/host/install-id; x-mt-surface absent; event keeps kind/v/host and never cost_usd', async () => {
    const fx = makeTelemetry();

    // translation-api default: no `opts.surface` at all (page translation).
    const { API, fetch } = loadTranslationAPI(fx);
    eq(await API.translate('hello', 'zh-CN', 'openai', 'KEY', RELAY + '/chat/completions'), '你好');
    assertNoSurfaceAttribution(fetch.calls[0].opts.headers, 'chat', fx, 'translation-api default');

    // tts default: no `cfg.surface` at all (no caller supplies one today).
    const { TTS, calls } = loadTTS(fx);
    TTS.configure({
      engineId: 'local', baseUrl: RELAY + '/audio/speech', model: 'kokoro', voice: 'af',
    });
    await TTS.getAudio('hello', 'en');
    assertNoSurfaceAttribution(calls[0].init.headers, 'tts', fx, 'tts default');

    // Both call sites passed an empty surface to relayHeaders(): the omission is
    // the call site's decision, not a bug in the header builder.
    deepEq(fx.relayCalls.map((c) => c.surface), ['', '']);
  });
});
