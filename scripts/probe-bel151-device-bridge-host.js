// scripts/probe-bel151-device-bridge-host.js — BEL-151 host + MCP OAuth probes.
//
//   node scripts/probe-bel151-device-bridge-host.js --out <gap dir> [--evidence <dir>] [--dom]
//
// Writes six JSON receipts consumed by the order's gap/ folder:
//   probe-settings-entry.json      the Mac Settings entry, copy lock, real DOM
//   probe-mcp-exchange.json        confirm → DCR → PKCE → register, MCP Bearer, slots
//   probe-gotrue-wrong-path.json   LearnAuth token present but never used as Bearer
//   probe-cancel-zero-http.json    cancel the confirm ⇒ zero HTTP, zero Keychain writes
//   probe-refresh-reuse.json       second pair reuses the same-account access token
//   probe-401-fallout.json         401 ⇒ clear access + device_cred, stop, honest copy
//
// Model-level probes run the REAL src/app/device-bridge-host.js and the REAL
// src/app/mcp-oauth-client.js (bundled by esbuild exactly as the page bundles them)
// against the REAL pairing gate. Only the edges are faked: LearnAuth, the Keychain,
// the OAuth/device HTTP server, and the authorization sheet. --dom adds a real
// Chrome run against dist-app/ and a screenshot.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadSrc } = require('../test/harness');
const { stripComments } = require('../test/lib/strip-comments');
const copy = require('../agent/copy');
const bridge = require('../agent/device-bridge');

const ROOT = path.join(__dirname, '..');
const VmGlobals = { URLSearchParams, TextEncoder, crypto: globalThis.crypto };
const Host = loadSrc('src/app/device-bridge-host.js', 'DeviceBridgeHost', VmGlobals).DeviceBridgeHost;
const McpOAuth = loadSrc('src/app/mcp-oauth-client.js', 'McpOAuth', VmGlobals).McpOAuth;

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
const INTL = 'https://mcp.belliedmonkey.cc';
const LEARN_AUTH_TOKEN = 'probe-gotrue-session-token';

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  console.log('  → ' + file);
  return file;
}

function json(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function memoryKeychain() {
  const data = new Map();
  return {
    persistent: true,
    available: () => true,
    async get(account) { return data.has(account) ? data.get(account) : null; },
    async set(account, value) { data.set(account, String(value)); return true; },
    async clear(account) { data.delete(account); return true; },
    keys: () => [...data.keys()].sort(),
  };
}

function memoryMeta() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => Object.assign({}, data),
  };
}

// One mock MCP host + device cloud. The token it hands out is deliberately not
// shaped like a GoTrue JWT so "which token went out" is unambiguous in the receipt.
function mockCloud(options) {
  const o = options || {};
  const clock = { value: 1700000000000 };
  const calls = [];
  const order = [];
  let tokenMode = 'ok';
  const fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init: init || {} });
    if (u.endsWith('/oauth/register')) {
      order.push('oauth-register');
      return o.dcr || json(201, { client_id: 'probe-client-id' });
    }
    if (u.endsWith('/oauth/token')) {
      order.push('oauth-token');
      if (tokenMode === 'invalid_grant') return json(400, { error: 'invalid_grant' });
      if (tokenMode === 'network') throw new Error('offline');
      const refresh = o.refreshToken === true;
      return json(200, {
        access_token: refresh ? 'probe-mcp-access-2' : 'probe-mcp-access',
        refresh_token: refresh ? 'probe-mcp-refresh-2' : 'probe-mcp-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }
    if (u.endsWith('/api/mcp/device-sessions/register')) {
      order.push('device-register');
      return o.register || json(200, { ok: true, device_cred: 'probe-device-cred', ttl_sec: 900 });
    }
    if (u.endsWith('/api/mcp/device-sessions/heartbeat')) {
      order.push('device-heartbeat');
      return o.heartbeat || json(200, { ok: true, ttl_sec: 900 });
    }
    if (u.endsWith('/api/mcp/device-sessions/bootstrap')) {
      order.push('device-bootstrap');
      return json(200, { ok: true, device_cred: 'probe-bootstrap-cred', ttl_sec: 300, kind: 'bootstrap' });
    }
    if (u.endsWith('/api/mcp/device-sessions/revoke')) {
      order.push('device-revoke');
      return json(200, { ok: true });
    }
    return json(404, {});
  };
  return { calls, order, fetch, clock, setTokenMode: (m) => { tokenMode = m; } };
}

function buildApp(cloud, extra) {
  const o = extra || {};
  const keychain = o.keychain || memoryKeychain();
  const meta = o.meta || memoryMeta();
  const oauth = o.oauth || McpOAuth.createClient({
    flavor: () => o.flavor || 'global',
    fetch: cloud.fetch,
    keychain,
    meta,
    now: () => cloud.clock.value,
    crypto: globalThis.crypto,
    openAuth: o.openAuth === undefined
      ? async ({ url, state }) => { cloud.order.push('authorize-sheet'); cloud.authUrl = url; return { code: 'probe-code', state }; }
      : o.openAuth,
  });
  const ui = {
    cards: [],
    shown: [],
    confirm: async (card) => {
      ui.cards.push(card);
      cloud.order.push('confirm');
      return o.decision || { allow: true };
    },
    show: async (receipt) => { ui.shown.push(receipt); },
  };
  const host = Host.createHost({
    auth: o.auth || {
      current: async () => ({ userId: 'u1', accessToken: LEARN_AUTH_TOKEN }),
      token: async () => LEARN_AUTH_TOKEN,
    },
    oauth,
    keychain,
    store: o.store || bridge.memoryStore(),
    fetch: cloud.fetch,
    ui,
    flavor: () => o.flavor || 'global',
    appVersion: () => '1.22.3',
    now: () => cloud.clock.value,
  });
  return { keychain, meta, oauth, ui, host };
}

function authzLines(calls) {
  return calls.map((c) => String((c.init && c.init.headers && c.init.headers.Authorization) || ''));
}

// ── probe 1: the Settings entry (static + copy + optional real DOM) ─────────
async function probeSettingsEntry() {
  const view = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src/app/device-bridge-host.js'), 'utf8');
  const oauthSrc = fs.readFileSync(path.join(ROOT, 'src/app/mcp-oauth-client.js'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
  const report = {
    probe: 'probe-settings-entry',
    at: AT,
    order: 'order-rd-bel151-device-bridge-mcp-exchange',
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
      oauthHasNoBaseLiteral: !/mcp\.belliedmonkey/.test(stripComments(oauthSrc)),
      hostHasNoLearnAuthBearer: !/auth\.token\(\)/.test(hostSrc),
      reconnectCopyFromLock: hostSrc.includes('MESSAGES.reconnect'),
    },
    copyLock: {
      action: 'pair_device',
      label: Host.PAIR_LABEL,
      hint: Host.PAIR_HINT,
      expectedLabel: copy.ACTIONS.pair_device.name,
      expectedHint: copy.ACTIONS.pair_device.touches[0],
      labelMatches: Host.PAIR_LABEL === copy.ACTIONS.pair_device.name,
      hintMatches: Host.PAIR_HINT === copy.ACTIONS.pair_device.touches[0],
      reconnect: copy.MESSAGES.reconnect,
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

// ── probe 2: the exchange path (confirm → DCR → PKCE → register) ────────────
async function probeMcpExchange() {
  const cloud = mockCloud();
  const app = buildApp(cloud);
  const receipt = await app.host.pair();
  const reg = cloud.calls.find((c) => c.url === BASE + '/register') || null;
  const regBody = reg ? JSON.parse(reg.init.body) : {};
  const authz = authzLines(cloud.calls);
  const metaJson = JSON.stringify(app.meta.dump());
  const report = {
    probe: 'probe-mcp-exchange',
    at: AT,
    order: 'order-rd-bel151-device-bridge-mcp-exchange',
    require: 'after Confirm allow and before register: authorization_code + PKCE S256; Bearer = MCP access',
    exchangePath: [
      'pair() → agent/session.requestPairing (copy-locked confirm)',
      'only after allow: oauth.connect({account})',
      '  DCR POST /oauth/register (public client, token_endpoint_auth_method=none)',
      '  PKCE S256 verifier/state, authorize URL → ASWebAuthenticationSession (existing mtAppleSignIn bridge)',
      '  callback code+state → POST /oauth/token (authorization_code + code_verifier)',
      '  refresh token → system Keychain service mt.mcp.oauth (account mcp_refresh)',
      'then (and only then) the register port runs device-bridge.register({confirm:true})',
    ],
    orderObserved: cloud.order,
    orderOk: cloud.order.join(' > ') === 'confirm > oauth-register > authorize-sheet > oauth-token > device-register',
    register: reg ? {
      url: reg.url,
      method: reg.init.method,
      authorization: authz[cloud.calls.indexOf(reg)].startsWith('Bearer ')
        ? 'Bearer <MCP OAuth access token>' : authz[cloud.calls.indexOf(reg)],
      bearerIsMcp: authz[cloud.calls.indexOf(reg)] === 'Bearer probe-mcp-access',
      bearerIsLearnAuth: authz[cloud.calls.indexOf(reg)] === 'Bearer ' + LEARN_AUTH_TOKEN,
      body: {
        confirm: regBody.confirm, platform: regBody.platform,
        app_version: regBody.app_version,
        device_id_is_uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(regBody.device_id || '')),
      },
    } : null,
    slots: {
      device_cred_in_store: app.host.hasCred(),
      device_cred_value_saved: false,     // never echo the credential value
      keychain_accounts: app.keychain.keys(),
      keychain_has_refresh: app.keychain.keys().includes('mcp_refresh'),
      meta_account: app.meta.getItem('mcp_oauth_account'),
      meta_has_token_value: metaJson.includes('probe-mcp-refresh') || metaJson.includes('probe-mcp-access'),
      store_has_token_value: JSON.stringify({ cred: app.host.hasCred() }).includes('probe-mcp-refresh'),
    },
    receipt: { ok: receipt.ok, code: receipt.code, message: receipt.message },
    status: { state: app.host.status().state, text: app.host.status().text },
    heartbeatRunning: app.host.isHeartbeatRunning(),
    gotrueTokenOnWire: authz.some((h) => h.includes(LEARN_AUTH_TOKEN)),
    result: 'FAIL',
  };
  report.slots.device_cred_value_saved = app.host.hasCred();
  const ok = report.orderOk && report.register && report.register.bearerIsMcp
    && !report.register.bearerIsLearnAuth && report.register.body.confirm === true
    && report.register.body.platform === 'mac' && report.register.body.device_id_is_uuid
    && report.slots.keychain_has_refresh && report.slots.meta_account === 'u1'
    && !report.slots.meta_has_token_value && !report.gotrueTokenOnWire
    && report.receipt.ok === true && report.status.state === 'paired'
    && report.heartbeatRunning === true;
  report.result = ok ? 'PASS' : 'FAIL';
  write('probe-mcp-exchange.json', report);
  return ok;
}

// ── probe 3: GoTrue-only is the wrong path, and sends nothing ───────────────
async function probeGotrueWrongPath() {
  const cloud = mockCloud();
  // A real MCP client in a shell without the auth bridge: it cannot obtain an MCP
  // grant. The LearnAuth session still exists — the point is that it is not a
  // substitute and no device request goes out.
  const app = buildApp(cloud, { openAuth: null });
  const receipt = await app.host.pair();
  const authz = authzLines(cloud.calls);
  const report = {
    probe: 'probe-gotrue-wrong-path',
    at: AT,
    require: 'LearnAuth/GoTrue Bearer must never be presented to the device endpoints as a successful exchange',
    learnAuthSessionPresent: true,
    learnAuthTokenSent: authz.some((h) => h.includes(LEARN_AUTH_TOKEN)),
    deviceHttpCalls: cloud.calls.filter((c) => c.url.startsWith(BASE)).length,
    oauthCalls: cloud.calls.filter((c) => c.url.includes('/oauth/')).length,
    receipt: { ok: receipt.ok, code: receipt.code, message: receipt.message },
    status: { state: app.host.status().state, text: app.host.status().text },
    verdict: 'no device request; the missing MCP grant is reported as a dependency, not as a pair',
    result: 'FAIL',
  };
  const ok = !report.learnAuthTokenSent && report.deviceHttpCalls === 0
    && report.receipt.ok !== true && report.status.state !== 'paired';
  report.result = ok ? 'PASS' : 'FAIL';
  write('probe-gotrue-wrong-path.json', report);
  return ok;
}

// ── probe 4: cancel ⇒ zero HTTP, zero secrets ───────────────────────────────
async function probeCancelZeroHttp() {
  const cloud = mockCloud();
  const app = buildApp(cloud, { decision: { allow: false } });
  const receipt = await app.host.pair();
  const report = {
    probe: 'probe-cancel-zero-http',
    at: AT,
    require: 'cancelling the confirm must not start DCR, PKCE exchange, or register',
    httpCalls: cloud.calls.length,
    urls: cloud.calls.map((c) => c.url),
    keychainAccounts: app.keychain.keys(),
    confirmCards: app.ui.cards.length,
    receipt: { ok: receipt.ok, code: receipt.code, message: receipt.message },
    status: { state: app.host.status().state, text: app.host.status().text },
    result: 'FAIL',
  };
  const ok = report.httpCalls === 0 && report.keychainAccounts.length === 0
    && report.receipt.code === 'cancelled';
  report.result = ok ? 'PASS' : 'FAIL';
  write('probe-cancel-zero-http.json', report);
  return ok;
}

// ── probe 5: the second pair reuses the same-account access token ───────────
async function probeRefreshReuse() {
  const cloud = mockCloud();
  const app = buildApp(cloud);
  await app.host.pair();
  const afterFirst = cloud.calls.length;
  const out = await app.host.pair();
  const second = cloud.calls.slice(afterFirst);
  const report = {
    probe: 'probe-refresh-reuse',
    at: AT,
    require: 'a same-account unexpired MCP access token skips consent, but still requires this pairing click',
    firstPairCalls: cloud.calls.slice(0, afterFirst).map((c) => c.url.replace(INTL, '')),
    secondPairCalls: second.map((c) => c.url.replace(INTL, '')),
    secondPairReceipt: { ok: out.ok, code: out.code, message: out.message },
    confirmCardsFirst: 1,
    sameAccessReused: second.length === 1 && second[0].url === BASE + '/register',
    result: 'FAIL',
  };
  report.result = report.sameAccessReused && out.ok === true ? 'PASS' : 'FAIL';
  write('probe-refresh-reuse.json', report);
  return report.result === 'PASS';
}

// ── probe 6: 401 / revoke fallout (T6) ─────────────────────────────────────
async function probe401Fallout() {
  const report = {
    probe: 'probe-401-fallout',
    at: AT,
    require: '401/refresh failure: clear MCP access + device_cred, stop heartbeat, honest reconnect copy, never fake paired',
    device401: null,
    refreshInvalidGrant: null,
    result: 'FAIL',
  };

  // A. the device endpoint refuses the session (401). device-bridge.js clears
  // device_cred and stops; the host drops the MCP access token and keeps the
  // refresh token for the one explicit retry after the next pairing confirm.
  {
    const cloud = mockCloud({ heartbeat: json(401, { ok: false, code: 'unauthorized' }) });
    const app = buildApp(cloud);
    await app.host.pair();
    const out = await app.host.onForeground();
    report.device401 = {
      heartbeatCode: out && out.code,
      deviceCredCleared: !app.host.hasCred(),
      heartbeatStopped: app.host.isHeartbeatRunning() === false,
      keychainAfter: app.keychain.keys(),
      mcpAccessCleared: !app.keychain.keys().includes('mcp_access'),
      refreshKeptForExplicitRetry: app.keychain.keys().includes('mcp_refresh'),
      status: { state: app.host.status().state, text: app.host.status().text },
      honestCopy: app.host.status().text === copy.MESSAGES.reconnect,
      saysPaired: app.host.status().state === 'paired',
    };
  }

  // B. the access token expired and the refresh token is refused for good. Both
  // Keychain slots and the owner go; device_cred goes with them.
  {
    const cloud = mockCloud();
    const app = buildApp(cloud);
    await app.host.pair();
    cloud.setTokenMode('invalid_grant');
    cloud.clock.value += 3600 * 1000;
    const out = await app.host.onForeground();
    report.refreshInvalidGrant = {
      heartbeatCode: out && out.code,
      deviceCredCleared: !app.host.hasCred(),
      heartbeatStopped: app.host.isHeartbeatRunning() === false,
      keychainAfter: app.keychain.keys(),
      mcpAccessCleared: !app.keychain.keys().includes('mcp_access'),
      mcpRefreshCleared: !app.keychain.keys().includes('mcp_refresh'),
      metaAccountCleared: app.meta.getItem('mcp_oauth_account') === null,
      status: { state: app.host.status().state, text: app.host.status().text },
      honestCopy: app.host.status().text === copy.MESSAGES.reconnect,
      saysPaired: app.host.status().state === 'paired',
    };
  }

  const a = report.device401;
  const b = report.refreshInvalidGrant;
  const okBoth = a.deviceCredCleared && a.heartbeatStopped && a.mcpAccessCleared
    && a.refreshKeptForExplicitRetry && a.honestCopy && !a.saysPaired
    && b.deviceCredCleared && b.heartbeatStopped && b.mcpAccessCleared
    && b.mcpRefreshCleared && b.metaAccountCleared && b.honestCopy && !b.saysPaired;
  report.result = okBoth ? 'PASS' : 'FAIL';
  write('probe-401-fallout.json', report);
  return okBoth;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('[BEL-151 MCP OAuth probes] out=' + OUT + (WITH_DOM ? ' (with DOM)' : ''));
  const results = {};
  results.settings = (await probeSettingsEntry()).result;
  results.exchange = (await probeMcpExchange()) ? 'PASS' : 'FAIL';
  results.gotrueWrongPath = (await probeGotrueWrongPath()) ? 'PASS' : 'FAIL';
  results.cancel = (await probeCancelZeroHttp()) ? 'PASS' : 'FAIL';
  results.reuse = (await probeRefreshReuse()) ? 'PASS' : 'FAIL';
  results.fallout = (await probe401Fallout()) ? 'PASS' : 'FAIL';
  const failed = Object.keys(results).filter((k) => results[k] !== 'PASS');
  console.log('\n' + JSON.stringify(results));
  console.log(failed.length ? 'RESULT: FAIL (' + failed.join(', ') + ')' : 'RESULT: PASS');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('probe failed:', e && e.stack || e);
  process.exit(2);
});
