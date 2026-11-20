// test/attrib-surfaces.test.js — BEL-267 follow-up: the three call paths that know
// a real relay surface must put it on the wire as `x-mt-surface` (the relay's
// grant_debited attribution reads it), while page and tts keep omitting it.
//
// Each surface is driven through the REAL call path — the subtitle backends'
// spec.translate wrapper, the doc page host's deps.translate wrapper, and the Mac
// quick panel's run() through AppQuick._fromNative — with the REAL translation-api
// and a fake fetch at the bottom. The header asserted here is the one fetch actually
// received, not a hand-written stub.
const fs = require('fs');
const path = require('path');
const { loadModule, loadSrc, describe, test, ok, eq } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');
const TTS_REGISTRY = require('../build/tts.config.js');
const HandoffCore = require('../app/quick-core.js');
const {
  makeTelemetry, expectAttribution, deriveGrantEvent, INSTALL_ID, VERSION,
} = require('./attrib-headers-fixture');

const ROOT = path.join(__dirname, '..');
const RELAY = 'https://backend.example/functions/v1/bt-relay';
const CHAT_URL = RELAY + '/chat/completions';

// ── the REAL translation-api, loaded with the REAL provider registry ─────────
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

function fakeElement() {
  return {
    hidden: false, value: '', style: {}, scrollHeight: 20, options: [],
    focus() {}, classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect: () => ({ height: 42 }),
    querySelector: () => ({ textContent: '' }), addEventListener() {},
  };
}

// ── subtitle backends: the REAL file, its spec.translate captured at mount ───
function loadCaptionBackend(file, fx) {
  const { API, fetch } = loadTranslationAPI(fx);
  const win = {};
  win.self = win;
  win.top = win;
  win.addEventListener = () => {};
  let spec = null;
  const document = {
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => fakeElement(), addEventListener() {}, head: null, documentElement: null,
  };
  const sandbox = {
    window: win, document,
    location: { hash: '', hostname: 'www.youtube.com', pathname: '/watch', href: 'https://www.youtube.com/watch?v=abc', search: '?v=abc' },
    performance: { setResourceTimingBufferSize() {}, getEntriesByType() { return []; } },
    PerformanceObserver: class { observe() {} },
    SubtitleAdapter: {
      playbackLatch: () => () => true,
      createSubtitleUI: (s) => {
        spec = s;
        return { settings: {}, init() {}, enable() {}, disable() {}, updateSettings() {}, engine: { items: [] } };
      },
    },
    TranslationCore: { DEFAULT_TARGET_LANG: 'zh-CN', t: (k, fb) => fb, isMobileLayout: () => false },
    AsrSource: { offerFor: () => null, startFrom: () => {} },
    TranslationAPI: API, MT_PALETTE: { roundBtnCss: () => '' },
    URL, URLSearchParams, MTTelemetry: fx.T,
  };
  loadModule(file, sandbox);
  ok(spec && typeof spec.translate === 'function', file + ': spec.translate must be supplied');
  return { translate: spec.translate, fetch };
}

// ── doc: the REAL extension page host, DocView.mount captured ────────────────
async function loadDocPageHost(fx) {
  const { API, fetch } = loadTranslationAPI(fx);
  let deps = null;
  const DocView = { mount: (_container, d) => { deps = d; return { openDoc() {}, showList() {} }; } };
  const $ = () => ({
    hidden: false, querySelector: () => ({ textContent: '' }), addEventListener() {},
  });
  const sandbox = {
    document: { getElementById: $ },
    window: { MT_LANGS: [], open() {} },
    location: { hash: '' },
    chrome: makeChrome(),
    PageI18n: { t: (k, fb) => fb, applyI18n() {} },
    PageSettings: { read: async () => ({ data: {} }) },
    DocView,
    DocReader: { openImage: async () => ({ imageOf: () => '' }) },
    DocStore: { remove: async () => {}, allItems: async () => [] },
    TranslationAPI: API,
    TranslationCore: { DEFAULT_TARGET_LANG: 'zh-CN' },
    EngineState: { resolve: (p) => p, visionOf: () => true },
    LearnAuth: { current: async () => null, bindCorpus: async () => {} },
    LearnGrant: { activeIn: () => false },
    LearnRules: { langAllowed: () => true },
    LearnModel: { shouldCapture: () => true, makeItem: () => ({}) },
    LearnStore: { mergeBatch: async () => {} },
    LearnDialog: { confirm: async () => true },
    PdfJsLoader: { load: async () => ({}) },
    MTTelemetry: fx.T,
  };
  loadModule('learn/docs-page.js', sandbox);
  // boot() is async; let its awaited auth/settings stubs settle into DocView.mount.
  for (let i = 0; i < 50 && !deps; i++) await new Promise((r) => setTimeout(r, 5));
  ok(deps && typeof deps.translate === 'function', 'docs-page must mount DocView with deps.translate');
  return { translate: deps.translate, fetch };
}

// ── quick: the REAL Mac panel model, driven through its native entry point ───
function loadQuickPanel(fx, win) {
  const { API, fetch } = loadTranslationAPI(fx);
  const posted = [];
  // A caller may pass the same window telemetry was loaded with (the quick-panel
  // test does): it already carries the mtQuick bridge, so keep it rather than
  // replacing it with a fixture-only stub.
  win = win || {
    HandoffCore,
    location: { hash: '#quick' },
    webkit: { messageHandlers: { mtQuick: { postMessage: (m) => posted.push(m) } } },
  };
  const ctx = loadSrc('src/app/quick-model.js', 'AppQuick', {
    window: win,
    document: { getElementById: () => fakeElement(), documentElement: { classList: { add() {} } }, addEventListener() {} },
    chrome: makeChrome(),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    navigator: { language: 'en-US' },
    LearnNotes: { resolveConfig: () => ({ provider: 'openai', apiKey: 'KEY', baseUrl: CHAT_URL, model: '' }) },
    EngineState: { needsSetup: () => false, entry: () => ({}), visionOf: () => true },
    LearnGrant: { active: () => false },
    AppTargetLang: { resolve: () => 'zh-CN' },
    TranslationCore: { DEFAULT_TARGET_LANG: 'zh-CN', isAlreadyTargetLanguage: () => false },
    TranslationAPI: API,
    URL,
  });
  return { api: ctx.AppQuick, fetch, posted };
}

const SETTINGS = { targetLang: 'zh-CN', provider: 'openai', apiKey: 'KEY', apiBaseUrl: CHAT_URL, apiModel: '' };

function assertSurfaceHeaders(headers, surface, fx, label, kind) {
  eq(headers['x-mt-surface'], surface, label + ': x-mt-surface must be ' + surface);
  expectAttribution(headers, fx.headers, surface);
  const ev = deriveGrantEvent(headers, kind);
  eq(ev.name, 'grant_debited', label + ': event name');
  eq(ev.props.surface, surface, label + ': grant_debited props.surface must be ' + surface);
}

function assertStillNoSurface(headers, fx, label, kind) {
  eq(headers['x-mt-v'], VERSION, label + ': x-mt-v must be present');
  eq(headers['x-mt-host'], 'safari', label + ': x-mt-host must be present');
  ok(!Object.prototype.hasOwnProperty.call(headers, 'x-mt-surface'),
    label + ': x-mt-surface must stay absent');
  expectAttribution(headers, fx.headers);
  const ev = deriveGrantEvent(headers, kind);
  eq(ev.name, 'grant_debited', label + ': event name');
  ok(!Object.prototype.hasOwnProperty.call(ev.props, 'surface'),
    label + ': grant_debited props.surface must stay absent');
  eq(ev.install_id, INSTALL_ID, label + ': event install_id');
}

describe('BEL-267 — real relay surfaces reach the wire', () => {
  test('web_caption: every subtitle backend wrapper passes surface=web_caption', async () => {
    for (const file of ['content-youtube.js', 'content-podcast.js', 'content-twitter.js']) {
      const fx = makeTelemetry();
      const { translate, fetch } = loadCaptionBackend(file, fx);
      eq(await translate('hello', SETTINGS), '你好', file + ': translated text');
      eq(fetch.calls.length, 1, file + ': one relay request');
      assertSurfaceHeaders(fetch.calls[0].opts.headers, 'web_caption', fx, file, 'chat');
      eq(fx.relayCalls[0].surface, 'web_caption', file + ': relayHeaders argv surface');
    }
  });

  test('doc: the doc page host passes surface=doc', async () => {
    const fx = makeTelemetry();
    const { translate, fetch } = await loadDocPageHost(fx);
    eq(await translate('hello', SETTINGS), '你好', 'doc: translated text');
    eq(fetch.calls.length, 1, 'doc: one relay request');
    assertSurfaceHeaders(fetch.calls[0].opts.headers, 'doc', fx, 'doc page host', 'chat');
    eq(fx.relayCalls[0].surface, 'doc', 'doc: relayHeaders argv surface');
  });

  test('doc: the App host (docs-model) mirrors the same doc call-site argument', () => {
    // The App host mounts the same shared DocView but its mount is DOM/React heavy;
    // the extension host above is exercised end-to-end. This locks the App wrapper's
    // argument so the two hosts cannot drift.
    const src = fs.readFileSync(path.join(ROOT, 'src', 'app', 'docs-model.js'), 'utf8');
    const m = /TranslationAPI\.translate\([\s\S]{0,500}?\{ surface: 'doc'[^}]*\}\)/.exec(src);
    ok(m, "docs-model must pass { surface: 'doc' } to TranslationAPI.translate");
  });

  test('quick: the Mac quick panel sends surface=quick and host=app', async () => {
    // The quick panel is a SECOND WKWebView: it registers only mtQuick, no controller
    // (app/native/quick-panel.swift). Load telemetry against the SAME window the panel
    // posts through; otherwise host() sees no native bridge and x-mt-host falls back
    // to the UA branch — 'chrome' in production (BEL-279).
    const posted = [];
    const win = {
      HandoffCore,
      location: { hash: '#quick' },
      webkit: { messageHandlers: { mtQuick: { postMessage: (m) => posted.push(m) } } },
    };
    const fx = makeTelemetry({ window: win, host: 'app' });
    const { api, fetch } = loadQuickPanel(fx, win);
    api.boot();
    eq(posted.filter((m) => m && m.type === 'quick-ready').length, 1,
      'quick: the mtQuick bridge on the shared window is live');
    api._fromNative({ type: 'quick-show', origin: 'selection', text: 'hello' });
    for (let i = 0; i < 200 && fetch.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    eq(fetch.calls.length, 1, 'quick: one relay request');
    const headers = fetch.calls[0].opts.headers;
    // The assertion is on the header fetch actually received, not on host() directly.
    eq(headers['x-mt-host'], 'app', 'quick: x-mt-host must be app on the real request');
    assertSurfaceHeaders(headers, 'quick', fx, 'Mac quick panel', 'chat');
    eq(deriveGrantEvent(headers, 'chat').host, 'app', 'quick: grant_debited host must be app');
    eq(fx.relayCalls[0].surface, 'quick', 'quick: relayHeaders argv surface');
  });

  test('page and tts still omit x-mt-surface while v/host stay present', async () => {
    // page: content-webpage's own engine cfg.translate, no opts at all.
    const pageFx = makeTelemetry();
    const pageApi = loadTranslationAPI(pageFx);
    let pageCfg = null;
    const noop = () => {};
    const pageDocument = {
      body: {}, documentElement: {},
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
      addEventListener: noop, removeEventListener: noop, getSelection: () => null,
    };
    const WebpageTranslator = loadModule('content-webpage.js', {
      DOMProcessor: {
        TRANSLATION_CLASS: 'mt-tr', TRANSLATABLE_ATTR: 'data-mt-tr', PROCESSED_ATTR: 'data-mt',
        collectUnits: () => [],
      },
      TranslationCore: {
        DEFAULT_TARGET_LANG: 'zh-CN',
        createEngine: (cfg) => {
          pageCfg = cfg;
          return {
            units: [], items: [], stateOf: () => ({}), setUnits() {}, setItems() {}, pump() {},
            activeAt: () => null, retry() {}, reset() {},
          };
        },
      },
      TranslationAPI: pageApi.API,
      document: pageDocument,
      location: { hostname: 'example.com', href: 'https://example.com/', pathname: '/', search: '' },
      window: { addEventListener: noop, removeEventListener: noop, innerWidth: 800, innerHeight: 600 },
      MutationObserver: class { observe() {} disconnect() {} },
      setInterval: () => 0, clearInterval: noop,
    }).WebpageTranslator;
    WebpageTranslator.enable({
      provider: 'openai', apiKey: 'KEY', apiBaseUrl: CHAT_URL, apiModel: '', targetLang: 'zh-CN',
    });
    ok(pageCfg && typeof pageCfg.translate === 'function', 'content-webpage: engine cfg.translate');
    eq(await pageCfg.translate('hello'), '你好', 'page: translated text');
    eq(pageApi.fetch.calls.length, 1, 'page: one relay request');
    assertStillNoSurface(pageApi.fetch.calls[0].opts.headers, pageFx, 'content-webpage', 'chat');
    eq(pageFx.relayCalls[0].surface, '', 'page: relayHeaders argv stays empty');

    // tts: the real module, no cfg.surface supplied.
    const ttsFx = makeTelemetry();
    const cache = new Map();
    const calls = [];
    const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
    const fetchStub = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
        arrayBuffer: () => Promise.resolve(new Uint8Array([73, 68, 51, 4]).buffer),
      });
    };
    const TTS = loadModule(['content/request-shape.js', 'learn/tts.js'], {
      window: { MT_TTS_ENGINES: TTS_REGISTRY.map((e) => Object.assign({}, e)) },
      LearnModel,
      LearnStore: {
        getAudio: (k) => Promise.resolve(cache.get(k) || null),
        putAudio: (k, payload) => { cache.set(k, { buf: payload.buf, type: payload.type }); return Promise.resolve(); },
      },
      WireFormat,
      LearnRules: loadModule('learn-rules.js', { window: {} }).LearnRules,
      MTTelemetry: ttsFx.T,
      AbortController,
      fetch: fetchStub,
      Uint8Array,
      btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    }).LearnTTS;
    TTS.configure({ engineId: 'local', baseUrl: RELAY + '/audio/speech', model: 'kokoro', voice: 'af' });
    await TTS.getAudio('hello', 'en');
    eq(calls.length, 1, 'tts: one relay request');
    assertStillNoSurface(calls[0].init.headers, ttsFx, 'tts', 'tts');
    eq(ttsFx.relayCalls[0].surface, '', 'tts: relayHeaders argv stays empty');
  });
});
