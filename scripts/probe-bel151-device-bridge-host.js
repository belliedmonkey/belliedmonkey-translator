// scripts/probe-bel151-device-bridge-host.js — BEL-151 host-wiring probes.
//
//   node scripts/probe-bel151-device-bridge-host.js --out <gap dir> [--evidence <dir>] [--dom]
//
// Writes four JSON receipts consumed by the order's gap/ folder:
//   probe-settings-entry.json · probe-bearer-register.json · probe-no-token.json ·
//   probe-heartbeat-lifecycle.json
//
// The first three are model-level: the REAL src/app/device-bridge-host.js (bundled
// by esbuild exactly as the page bundles it) against the REAL pairing gate, with
// only the edges faked (auth, store, fetch, confirm/show). --dom adds a real
// Chrome run against dist-app/: the entry exists, says the copy-locked line, is
// visible on this Mac, and a screenshot lands in the evidence dir.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadSrc } = require('../test/harness');
const copy = require('../agent/copy');
const bridge = require('../agent/device-bridge');

const ROOT = path.join(__dirname, '..');
const Host = loadSrc('src/app/device-bridge-host.js', 'DeviceBridgeHost', { URLSearchParams }).DeviceBridgeHost;

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
const OUT = path.resolve(arg('out', path.join(ROOT, '.local/bel151-probe')));
const EVIDENCE = path.resolve(arg('evidence', path.join(OUT, '..', 'evidence')));
const WITH_DOM = process.argv.includes('--dom');
const AT = new Date().toISOString();

const UUID = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  console.log('  → ' + file);
  return file;
}

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
function recorder(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return answer(calls[calls.length - 1], calls.length);
  };
  return { calls, fetch };
}
function baseOptions(extra) {
  return Object.assign({
    auth: { current: async () => ({ userId: 'u1', accessToken: 'probe-token' }), token: async () => 'probe-token' },
    flavor: () => 'global',
    appVersion: () => '1.22.3',
    now: () => 1700000000000,
  }, extra || {});
}
function headlessUi(decision) {
  const cards = [];
  const shown = [];
  return {
    cards, shown,
    ui: {
      confirm: async (card) => { cards.push(card); return decision || { allow: true }; },
      show: async (receipt) => { shown.push(receipt); },
    },
  };
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── probe 1: the Settings entry (static + copy + optional real DOM) ─────────
async function probeSettingsEntry() {
  const view = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src/app/device-bridge-host.js'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
  const report = {
    probe: 'probe-settings-entry',
    at: AT,
    order: 'order-rd-bel151-device-bridge-host-wire',
    require: 'user-reachable Settings entry that triggers the pairing confirm',
    static: {
      view: 'src/app/settings-view.jsx',
      hasButton: view.includes('id="pair-device-btn"'),
      hasHint: view.includes('id="pair-device-hint"'),
      hasStatus: view.includes('id="pair-device-status"'),
      labelFromCopy: view.includes('{PAIR_LABEL}') && !view.includes(copy.ACTIONS.pair_device.name),
      hintFromCopy: view.includes('{PAIR_HINT}') && !view.includes(copy.ACTIONS.pair_device.touches[0]),
      macGated: view.includes('hidden={!listenModel.isMacHost()}'),
      callsPair: /deviceBridgeHost\.pair\(/.test(view),
      lifecycleBooted: /deviceBridgeHost\.boot\(\)/.test(shell),
      openSetupInjected: /deviceBridge: deviceBridgeHost\.agentBridge\(\)/.test(shell),
      noLocalhostCompanion: !/localhost|127\.0\.0\.1|\[::1\]/i.test(hostSrc),
      noFrozenBaseCopied: !/mcp\.belliedmonkey/.test(hostSrc),
    },
    copyLock: {
      action: 'pair_device',
      label: Host.PAIR_LABEL,
      hint: Host.PAIR_HINT,
      expectedLabel: copy.ACTIONS.pair_device.name,
      expectedHint: copy.ACTIONS.pair_device.touches[0],
      labelMatches: Host.PAIR_LABEL === copy.ACTIONS.pair_device.name,
      hintMatches: Host.PAIR_HINT === copy.ACTIONS.pair_device.touches[0],
    },
    dom: null,
    screenshot: null,
    result: 'FAIL',
  };
  if (WITH_DOM) report.dom = await domProbe(report);
  const s = report.static;
  const staticOk = Object.keys(s).filter((k) => k !== 'view').every((k) => s[k] === true);
  const domOk = !WITH_DOM || (report.dom && report.dom.ok === true);
  report.result = staticOk && report.copyLock.labelMatches && report.copyLock.hintMatches && domOk
    ? 'PASS' : 'FAIL';
  write('probe-settings-entry.json', report);
  return report;
}

// Real bundle, real Chrome. Served in the SHIPPED layout (/Base.lproj/Main.html +
// /Script.js at the root) — a flat serve would pass against a page nobody ships.
async function domProbe() {
  const SRC = path.join(ROOT, 'dist-app');
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) return { ok: false, error: 'dist-app missing ' + f + ' — run node build.js' };
  }
  const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
  const missed = [];
  const srv = http.createServer((req, res) => {
    const rel = req.url === '/' ? '/Base.lproj/Main.html' : req.url;
    const name = path.basename(rel);
    const inBase = rel.startsWith('/Base.lproj/');
    const ok = (name === 'Main.html' && inBase) || ((name === 'Script.js' || name === 'Style.css') && !inBase);
    if (!ok) { if (name !== 'favicon.ico') missed.push(rel); res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'text/plain' });
    res.end(fs.readFileSync(path.join(SRC, name)));
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/Base.lproj/Main.html';

  const { launchChrome } = require('../test/layout/chrome');
  const { CDP } = require('../test/layout/cdp');
  const chrome = await launchChrome();
  try {
    const cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const problems = [];
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => problems.push(
      'EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });
    cdp.listeners.push({ event: 'Log.entryAdded', fn: (p) => {
      if (p.entry.level === 'error' && !/favicon\.ico/.test(p.entry.url || '')) problems.push('ERROR ' + p.entry.text);
    } });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(2500);

    const expression = `(async () => {
      const gear = document.getElementById('gear');
      if (gear) gear.click();
      await new Promise((r) => setTimeout(r, 500));
      const b = document.getElementById('pair-device-btn');
      const hint = document.getElementById('pair-device-hint');
      const st = document.getElementById('pair-device-status');
      const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
      if (b) { try { b.scrollIntoView({ block: 'center' }); } catch (_) {} }
      await new Promise((r) => setTimeout(r, 350));
      const mac = /^Mac/.test(navigator.platform || '') && !(navigator.maxTouchPoints > 0);
      return JSON.stringify({
        mac,
        platform: navigator.platform || '',
        maxTouchPoints: navigator.maxTouchPoints || 0,
        settingsShown: !document.getElementById('app-settings').hidden,
        button: { exists: !!b, text: b ? b.textContent : '', visible: vis(b), inAccount: !!(b && b.closest('#g-account')) },
        hint: { exists: !!hint, text: hint ? hint.textContent : '', visible: vis(hint) },
        status: { exists: !!st, text: st ? st.textContent : '', visible: vis(st) },
        expectedLabel: ${JSON.stringify(copy.ACTIONS.pair_device.name)},
        expectedHint: ${JSON.stringify(copy.ACTIONS.pair_device.touches[0])},
      });
    })()`;
    const ev = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    const dom = JSON.parse(ev.result.value);
    dom.missedRequests = missed;
    dom.problems = problems;

    fs.mkdirSync(EVIDENCE, { recursive: true });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const shotPath = path.join(EVIDENCE, 'settings-pair-device.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    dom.screenshot = shotPath;

    dom.ok = !!(dom.settingsShown && dom.mac
      && dom.button.exists && dom.button.visible && dom.button.inAccount
      && dom.button.text === dom.expectedLabel
      && dom.hint.exists && dom.hint.visible && dom.hint.text === dom.expectedHint
      && dom.status.exists)
      && problems.length === 0;
    return dom;
  } finally {
    try { chrome.cleanup(); } catch (_) {}
    srv.close();
  }
}

// ── probe 2: Bearer on register ─────────────────────────────────────────────
async function probeBearerRegister() {
  const cases = [];
  for (const [flavor, expectBase] of [['global', 'https://mcp.belliedmonkey.cc'], ['china', 'https://mcp.belliedmonkey.com']]) {
    const store = bridge.memoryStore();
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'probe-dc', ttl_sec: 900 }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: ui.ui, flavor: () => flavor }));
    const receipt = await host.pair();
    const call = rec.calls[0] || null;
    const body = call ? JSON.parse(call.init.body) : {};
    const auth = call ? String(call.init.headers.Authorization || '') : '';
    cases.push({
      flavor,
      url: call ? call.url : '',
      expectedUrl: expectBase + '/api/mcp/device-sessions/register',
      method: call ? call.init.method : '',
      // Never write the token itself into evidence — only that it was a Bearer.
      authorization: auth.startsWith('Bearer ') ? 'Bearer <session access token>' : auth,
      bearerPresent: /^Bearer \S+$/.test(auth),
      body: {
        confirm: body.confirm,
        platform: body.platform,
        app_version: body.app_version,
        device_id_is_uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.device_id || '')),
        device_id: body.device_id,
      },
      confirmCard: ui.cards[0] ? {
        title: ui.cards[0].title,
        actionLabel: ui.cards[0].actionLabel,
        primary: ui.cards[0].primary,
      } : null,
      receipt: { ok: receipt.ok, code: receipt.code, message: receipt.message },
      credentialSaved: store.getItem('device_cred') === 'probe-dc',
      credOwner: store.getItem('device_cred_user') || '',
      status: host.status().state,
      heartbeatRunning: host.isHeartbeatRunning(),
    });
  }
  const ok = cases.every((c) => c.url === c.expectedUrl && c.method === 'POST' && c.bearerPresent
    && c.body.confirm === true && c.body.platform === 'mac' && c.body.device_id_is_uuid
    && c.receipt.ok === true && c.credentialSaved && c.status === 'paired' && c.heartbeatRunning);
  write('probe-bearer-register.json', {
    probe: 'probe-bearer-register',
    at: AT,
    require: 'host injects the same-account OAuth Bearer into register',
    cases,
    result: ok ? 'PASS' : 'FAIL',
  });
  return ok;
}

// ── probe 3: no token ⇒ no request, honest receipt ──────────────────────────
async function probeNoToken() {
  const cases = [];
  const scenarios = [
    ['signed_out', { current: async () => null, token: async () => '' }],
    ['session_without_token', { current: async () => ({ userId: 'u1' }), token: async () => '' }],
  ];
  for (const [name, auth] of scenarios) {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({ store: bridge.memoryStore(), fetch: rec.fetch, ui: ui.ui, auth }));
    const receipt = await host.pair();
    cases.push({
      case: name,
      httpCalls: rec.calls.length,
      receipt: { ok: receipt.ok, code: receipt.code, message: receipt.message },
      cardShown: ui.shown[0] ? { code: ui.shown[0].code, message: ui.shown[0].message } : null,
      confirmShown: ui.cards.length > 0,
      status: host.status().state,
      statusText: host.status().text,
      heartbeatRunning: host.isHeartbeatRunning(),
    });
  }
  const ok = cases.every((c) => c.httpCalls === 0 && c.receipt.code === 'need_login'
    && c.status === 'signed_out' && c.statusText === copy.FAILURES.need_login.line
    && c.heartbeatRunning === false && c.cardShown && c.cardShown.code === 'need_login');
  write('probe-no-token.json', {
    probe: 'probe-no-token',
    at: AT,
    require: 'no Bearer ⇒ nothing is sent and the user is told to sign in (never a fake pair)',
    cases,
    result: ok ? 'PASS' : 'FAIL',
  });
  return ok;
}

// ── probe 4: heartbeat lifecycle (foreground / interval / 401) ──────────────
async function probeHeartbeatLifecycle() {
  const paired = () => bridge.memoryStore({ device_id: UUID, device_cred: 'dc-old', device_cred_user: 'u1' });
  const report = {
    probe: 'probe-heartbeat-lifecycle',
    at: AT,
    require: 'paired: foreground heartbeats once + 2–5 min interval; 401 clears cred and stops',
    interval: null,
    foreground: null,
    stopOn401: null,
    result: 'FAIL',
  };

  const rec = recorder(() => fakeResponse(200, { ok: true, ttl_sec: 900 }));
  const host = Host.createHost(baseOptions({ store: paired(), fetch: rec.fetch }));
  const doc = {
    visibilityState: 'hidden',
    handlers: {},
    addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
  };
  const boot = host.boot(doc);
  const launchedWithoutBeat = rec.calls.length === 0;
  doc.visibilityState = 'visible';
  await doc.handlers.visibilitychange[0]();
  const first = rec.calls[0] || null;
  const firstBody = first ? JSON.parse(first.init.body) : {};
  doc.visibilityState = 'hidden';
  await doc.handlers.visibilitychange[0]();
  const hiddenDidNotBeat = rec.calls.length === 1;
  doc.visibilityState = 'visible';
  await doc.handlers.visibilitychange[0]();
  report.foreground = {
    bootInstalled: boot.installed,
    launchedWithoutBeat,
    beatUrl: first ? first.url : '',
    beatBody: { device_id: firstBody.device_id || '', device_cred: firstBody.device_cred || '' },
    hiddenDidNotBeat,
    beatsAfterSecondForeground: rec.calls.length,
    intervalRunning: host.isHeartbeatRunning(),
    status: host.status().state,
  };

  await host.ensureClient();
  report.interval = {
    requestedMin: host.startHeartbeat({ intervalMs: 1000 }).interval_ms,
    requestedMax: host.startHeartbeat({ intervalMs: 60 * 60 * 1000 }).interval_ms,
    modelMin: bridge.HEARTBEAT_MIN_MS,
    modelMax: bridge.HEARTBEAT_MAX_MS,
  };

  let mode = 'ok';
  const rec401 = recorder(() => (mode === 'ok'
    ? fakeResponse(200, { ok: true, device_cred: 'dc-401', ttl_sec: 900 })
    : fakeResponse(401, { ok: false, code: 'unauthorized' })));
  const store401 = bridge.memoryStore();
  const host401 = Host.createHost(baseOptions({ store: store401, fetch: rec401.fetch, ui: headlessUi().ui }));
  await host401.pair();
  mode = '401';
  const out = await host401.onForeground();
  report.stopOn401 = {
    heartbeatCode: out && out.code,
    credCleared: store401.getItem('device_cred') === null,
    ownerCleared: store401.getItem('device_cred_user') === null,
    loopStopped: host401.isHeartbeatRunning() === false,
    status: host401.status().state,
  };

  const ok = report.foreground.bootInstalled && report.foreground.launchedWithoutBeat
    && report.foreground.beatUrl === BASE + '/heartbeat'
    && report.foreground.beatBody.device_cred === 'dc-old'
    && report.foreground.hiddenDidNotBeat
    && report.foreground.beatsAfterSecondForeground === 2
    && report.foreground.intervalRunning
    && report.interval.requestedMin === bridge.HEARTBEAT_MIN_MS
    && report.interval.requestedMax === bridge.HEARTBEAT_MAX_MS
    && report.stopOn401.heartbeatCode === 'unauthorized'
    && report.stopOn401.credCleared && report.stopOn401.ownerCleared
    && report.stopOn401.loopStopped && report.stopOn401.status === 'signed_out';
  report.result = ok ? 'PASS' : 'FAIL';
  write('probe-heartbeat-lifecycle.json', report);
  return ok;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('[BEL-151 host probes] out=' + OUT + (WITH_DOM ? ' (with DOM)' : ''));
  const results = {};
  results.settings = (await probeSettingsEntry()).result;
  results.bearer = (await probeBearerRegister()) ? 'PASS' : 'FAIL';
  results.noToken = (await probeNoToken()) ? 'PASS' : 'FAIL';
  results.lifecycle = (await probeHeartbeatLifecycle()) ? 'PASS' : 'FAIL';
  const failed = Object.keys(results).filter((k) => results[k] !== 'PASS');
  console.log('\n' + JSON.stringify(results));
  console.log(failed.length ? 'RESULT: FAIL (' + failed.join(', ') + ')' : 'RESULT: PASS');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('probe failed:', e && e.stack || e);
  process.exit(2);
});
