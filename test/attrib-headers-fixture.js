// test/attrib-headers-fixture.js — BEL-267 shared fixture (NOT a *.test.js file).
//
// Call-site tests need to assert the headers that really go on the request, not a
// hand-written stub that happens to return the keys the test expects. So this loads
// the REAL extension/learn/telemetry.js into a fake browser and hands that instance
// to translation-api / tts / speech-input / notes. The call-site fake fetch then
// captures the exact header object that would have been sent.
//
// It also carries a small MIRROR of the relay's attribution rules. The mirror is
// deliberately a copy, not an import: the relay lives in another repo/deployment,
// and the point is to answer "would the relay read these headers the way we think?"
// with an independent second implementation. If the relay changes, this mirror has
// to change with it (see functions/bt-relay/index.ts: attributionOf,
// grantEventProps, emitGrantEvent).
const crypto = require('crypto');
const { loadModule, ok, eq } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const INSTALL_ID = '11111111-1111-4111-8111-111111111111';
const VERSION = '1.23.4';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1';

function makeTelemetry(over = {}) {
  const store = Object.assign({ 'tm:id': INSTALL_ID, 'tm:on': true }, over.store || {});
  const relayCalls = [];
  // Optional window: the Mac quick panel is a SECOND WKWebView and telemetry must
  // resolve host() from the SAME window the panel posts through. That window carries
  // mtQuick (not controller), so host() is 'app' even though its UA is not Safari.
  const win = over.window || {};
  win.MT_VERSION = VERSION;
  win.MT_FLAVOR = 'global';
  win.MT_TELEMETRY = over.telemetry === undefined ? {
    url: 'https://x.test/functions/v1/bt-ingest',
    spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
  } : over.telemetry;
  const sandbox = {
    window: win,
    navigator: over.navigator || { userAgent: UA, platform: 'iPhone', language: 'zh-CN' },
    crypto: crypto.webcrypto,
    fetch: async () => ({ ok: true }),
    chrome: {
      i18n: { getUILanguage: () => 'zh-CN' },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
        remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
      } },
    },
  };
  const T = loadModule('learn/telemetry.js', sandbox).MTTelemetry;
  const realRelayHeaders = T.relayHeaders;
  // Record the argv as well as the result: the surface requirement is about what the
  // call site *passes*, which a headers-only assertion can hide (a hardcoded 'doc'
  // in telemetry.js would look identical).
  T.relayHeaders = async (url, surface) => {
    relayCalls.push({ url, surface });
    return realRelayHeaders(url, surface);
  };
  return {
    T,
    store,
    relayCalls,
    headers: {
      'x-mt-install-id': INSTALL_ID,
      'x-mt-v': VERSION,
      'x-mt-host': over.host || 'safari',
      'x-mt-flavor': 'global',
      'x-mt-device': 'iPhone',
      'x-mt-ui': 'zh',
    },
  };
}

// Assert the six attribution headers the relay's attributionOf() reads, plus the
// surface header only when the call site knows a real enum value.
function expectAttribution(headers, expected, surface) {
  eq(headers['x-mt-install-id'], expected['x-mt-install-id'], 'x-mt-install-id');
  eq(headers['x-mt-v'], expected['x-mt-v'], 'x-mt-v');
  eq(headers['x-mt-host'], expected['x-mt-host'], 'x-mt-host');
  eq(headers['x-mt-flavor'], expected['x-mt-flavor'], 'x-mt-flavor');
  eq(headers['x-mt-device'], expected['x-mt-device'], 'x-mt-device');
  eq(headers['x-mt-ui'], expected['x-mt-ui'], 'x-mt-ui');
  if (surface) {
    eq(headers['x-mt-surface'], surface, 'x-mt-surface');
  } else {
    ok(!Object.prototype.hasOwnProperty.call(headers || {}, 'x-mt-surface'),
      'surface 未提供/非法时绝不能带 x-mt-surface，实际带了 ' + headers['x-mt-surface']);
  }
}

// ── MIRROR of the relay's attribution rules (bt-relay/index.ts) ─────────────
// Keep this small and literal. It is a second reading of the same contract, not a
// re-export: attributionOf() reads the x-mt-* headers; emitGrantEvent() falls back
// to v='0.0.0' when v is not semver and to host='' when host is outside
// EVENT_HOSTS; grantEventProps() omits surface entirely unless it is one of
// SURFACES. Those three rules are what the client patch must satisfy.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SURFACES = new Set(['listen', 'live_caption', 'quick', 'doc', 'web_caption']);
const EVENT_HOSTS = new Set(['safari', 'chrome', 'firefox', 'app']);
const SEMVER_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LANG_RE = /^[a-z]{2,3}$/;

function firstString(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

function attributionOf(headers) {
  const src = headers || {};
  const h = (n) => firstString(src[n], src[n.toLowerCase()], src[n.toUpperCase()]);
  const rawInstall = h('x-mt-install-id');
  return {
    installId: UUID_RE.test(rawInstall) ? rawInstall.toLowerCase() : null,
    host: h('x-mt-host'),
    surface: h('x-mt-surface'),
    flavor: h('x-mt-flavor'),
    v: h('x-mt-v'),
    device: h('x-mt-device'),
    ui: h('x-mt-ui'),
  };
}

function eventFlavor(a) {
  if (a.flavor === 'global' || a.flavor === 'china') return a.flavor;
  // The test environment never has LEDGER_URL / MT_FLAVOR, so the relay's last
  // fallback in this mirror is 'global'.
  return 'global';
}

function grantEventProps(a, kind) {
  const props = { kind };
  if (SURFACES.has(a.surface)) props.surface = a.surface;
  return props;
}

function deriveGrantEvent(headers, kind) {
  const a = attributionOf(headers);
  return {
    install_id: a.installId,
    v: SEMVER_RE.test(a.v) ? a.v : '0.0.0',
    flavor: eventFlavor(a),
    host: EVENT_HOSTS.has(a.host) ? a.host : '',
    device: a.device.slice(0, 64),
    ui: LANG_RE.test(a.ui) ? a.ui : '',
    name: 'grant_debited',
    props: grantEventProps(a, kind || 'chat'),
  };
}

module.exports = {
  INSTALL_ID, VERSION, makeTelemetry, expectAttribution, deriveGrantEvent,
  attributionOf, SURFACES, EVENT_HOSTS,
};
