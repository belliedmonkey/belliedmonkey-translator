// test/agent-device-bridge-host.test.js — BEL-151 host wiring (App side).
//
// agent/device-bridge.js is the transport; agent/session.js is the confirm gate;
// src/app/mcp-oauth-client.js is the MCP OAuth public client. This file tests the
// piece that joins them: the App's Settings entry, the MCP access Bearer the host
// must supply (never a LearnAuth/GoTrue token), the exchange timing (confirm →
// PKCE exchange → register), the honest no-grant path, 401 clearing both slots, and
// the foreground heartbeat lifecycle.
//
// It runs the REAL host module (bundled the way the page bundles it) against the
// REAL pairing gate, with only the edges injected: a fake LearnAuth, a fake OAuth
// client, a memory store, a recording fetch, and a headless confirm/show UI.
const fs = require('fs');
const path = require('path');
const { describe, test, loadSrc, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const copy = require('../agent/copy');
const bridge = require('../agent/device-bridge');
const Host = loadSrc('src/app/device-bridge-host.js', 'DeviceBridgeHost', {
  // The vm context carries the globals the page always has; fixFor() builds the
  // need_login fix link with URLSearchParams.
  URLSearchParams,
}).DeviceBridgeHost;

const UUID = '11111111-1111-4111-8111-111111111111';
const REGISTER = 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/register';
const HEARTBEAT = 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/heartbeat';
const BOOTSTRAP = 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/bootstrap';
const REVOKE = 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/revoke';

const MCP_TOKEN = 'mcp-access-1';
const GOTRUE_TOKEN = 'gotrue-session-token';   // must never become a Bearer here

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

// The OAuth edge, faked. Every method records its call so a test can prove the
// order (confirm → connect → register) and that a cancelled confirm never reached
// the exchange at all.
function oauthStub(extra) {
  const calls = [];
  let lastError = '';
  const stub = {
    calls,
    state: () => ({ hasAccess: lastError === '', hasRefresh: lastError !== 'invalid_grant', lastError, owner: 'u1', keychain: true }),
    async hasGrant() { calls.push(['hasGrant']); return true; },
    async connect(args) {
      calls.push(['connect', (args && args.account) || '']);
      return { ok: true, token: MCP_TOKEN, skipped: 'access' };
    },
    async accessToken(args) {
      calls.push(['accessToken', (args && args.account) || '']);
      return MCP_TOKEN;
    },
    async invalidateAccess(args) {
      calls.push(['invalidateAccess', (args && args.reason) || '']);
      lastError = (args && args.reason) || 'unauthorized';
      return { ok: true };
    },
    async clearTokens() {
      calls.push(['clearTokens']);
      lastError = 'invalid_grant';
      return { ok: true };
    },
  };
  return Object.assign(stub, extra || {});
}

function baseOptions(extra) {
  return Object.assign({
    auth: {
      current: async () => ({ userId: 'u1', accessToken: GOTRUE_TOKEN }),
      token: async () => GOTRUE_TOKEN,
    },
    oauth: oauthStub(),
    flavor: () => 'global',
    appVersion: () => '1.22.3',
    now: () => 1700000000000,
  }, extra || {});
}

function headlessUi(decision) {
  const cards = [];
  const shown = [];
  return {
    cards,
    shown,
    ui: {
      confirm: async (card) => { cards.push(card); return decision || { allow: true }; },
      show: async (receipt) => { shown.push(receipt); },
    },
  };
}

function pairedStore(extra) {
  return bridge.memoryStore(Object.assign({
    device_id: UUID,
    device_cred: 'dc-old',
    device_cred_user: 'u1',
  }, extra || {}));
}

describe('BEL-151 host: the Settings entry is reachable and copy-locked', () => {
  const view = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src/app/device-bridge-host.js'), 'utf8');

  test('the entry exists in the settings JSX and is wired to the host', () => {
    ok(view.includes('id="pair-device-btn"'), 'settings JSX has no #pair-device-btn');
    ok(view.includes('id="pair-device-hint"'), 'settings JSX has no #pair-device-hint');
    ok(view.includes('id="pair-device-status"'), 'settings JSX has no #pair-device-status');
    ok(/deviceBridgeHost\.pair\(/.test(view), 'the button does not call deviceBridgeHost.pair');
    ok(/deviceBridgeHost\.onStatus\(/.test(view), 'the status line does not subscribe to the host');
  });

  test('Mac P0 only — the entry hides where device-bridge cannot pair', () => {
    ok(view.includes('hidden={!listenModel.isMacHost()}'), 'entry is not gated to the Mac host');
  });

  test('label and hint come from the copy lock, not from a second sentence', () => {
    eq(Host.PAIR_LABEL, copy.ACTIONS.pair_device.name);
    eq(Host.PAIR_HINT, copy.ACTIONS.pair_device.touches[0]);
    ok(view.includes('{PAIR_LABEL}'), 'the button does not render PAIR_LABEL');
    ok(view.includes('{PAIR_HINT}'), 'the hint does not render PAIR_HINT');
    ok(!view.includes(copy.ACTIONS.pair_device.name), 'the locked name is retyped in the view');
    ok(!view.includes(copy.ACTIONS.pair_device.touches[0]), 'the locked touch line is retyped in the view');
  });

  test('connected state has its own copy lock and its own confirm sheet', () => {
    eq(Host.DISCONNECT.label, '断开此设备');
    eq(Host.DISCONNECT.hint, '断开后，已连接的助手将无法再访问本机可达状态；可随时重新连接。');
    eq(Host.DISCONNECT.confirmTitle, '断开此设备？');
    eq(Host.DISCONNECT.confirmBody, '助手将无法再调用本机工具。');
    eq(Host.DISCONNECT.confirmOk, '断开');
    eq(Host.DISCONNECT.confirmCancel, '取消');
    ok(view.includes('DISCONNECT.confirmTitle'), 'the disconnect sheet does not use the locked title');
    ok(view.includes('DISCONNECT.confirmBody'), 'the disconnect sheet does not use the locked body');
    ok(view.includes('deviceBridgeHost.disconnect()'), 'the view never calls the disconnect host');
    ok(view.includes("btn.dataset.state = connected ? 'connected'"), 'the view has no connected state marker');
    ok(view.includes("pending ? 'pending'"), 'the view has no pending state marker');
  });

  test('the host adds no transport: frozen device bases stay in agent/device-bridge.js', () => {
    ok(!/mcp\.belliedmonkey/.test(hostSrc), 'host hardcodes a base URL instead of passing the flavor');
    ok(!/localhost|127\.0\.0\.1|\[::1\]/i.test(hostSrc), 'host grew a localhost companion');
  });

  test('the lifecycle is mounted next to quietSync, and open_setup gets the same client', () => {
    ok(/deviceBridgeHost\.boot\(\)/.test(shell), 'shell-model never boots the device host');
    ok(/deviceBridge: deviceBridgeHost\.agentBridge\(\)/.test(shell),
      'agentHost has no deviceBridge, so open_setup would never bootstrap');
  });

  test('no "listening works" / D3 claim leaked into the wiring', () => {
    const all = view + shell + hostSrc;
    ok(!all.includes('听译已通'));
    ok(!all.includes('完整 D3'));
  });
});

describe('BEL-151 host: MCP Bearer register', () => {
  test('pair() sends the MCP access token and stores the device credential', async () => {
    const store = bridge.memoryStore();
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 }));
    const ui = headlessUi();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: ui.ui, oauth }));

    const out = await host.pair();
    eq(out.code, 'ok');
    eq(out.message, copy.MESSAGES.paired);
    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, REGISTER);
    eq(rec.calls[0].init.method, 'POST');
    eq(rec.calls[0].init.headers.Authorization, 'Bearer ' + MCP_TOKEN);
    const body = JSON.parse(rec.calls[0].init.body);
    eq(body.confirm, true);
    eq(body.platform, 'mac');
    eq(body.app_version, '1.22.3');
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.device_id),
      'register body has no device id: ' + body.device_id);

    eq(store.getItem('device_cred'), 'dc-9');
    eq(store.getItem('device_cred_user'), 'u1');
    eq(host.status().state, 'paired');
    eq(host.status().text, copy.MESSAGES.paired);
    eq(host.isHeartbeatRunning(), true);

    // The gate the user saw is the copy-locked pair_device card, not a second UI.
    eq(ui.cards.length, 1);
    eq(ui.cards[0].title, copy.TITLE);
    eq(ui.cards[0].actionLabel, copy.ACTIONS.pair_device.name);
    eq(ui.cards[0].primary, copy.ALLOW_ONCE);
    ok(ui.shown.length === 1 && ui.shown[0].ok === true, 'success receipt was not shown');
  });

  test('the exchange runs after the confirm and before the device POST', async () => {
    const order = [];
    const store = bridge.memoryStore();
    const rec = recorder(() => {
      order.push('device-register');
      return fakeResponse(200, { ok: true, device_cred: 'dc-order', ttl_sec: 900 });
    });
    const oauth = oauthStub({
      async connect(args) {
        order.push('pkce-exchange');
        oauth.calls.push(['connect', (args && args.account) || '']);
        return { ok: true, token: MCP_TOKEN, skipped: 'consent' };
      },
    });
    const host = Host.createHost(baseOptions({
      store,
      fetch: rec.fetch,
      oauth,
      ui: {
        confirm: async () => { order.push('confirm'); return { allow: true }; },
        show: async () => {},
      },
    }));
    const out = await host.pair();
    eq(out.code, 'ok');
    eq(order.join(' > '), 'confirm > pkce-exchange > device-register');
  });

  test('the Bearer is never the LearnAuth/GoTrue token', async () => {
    const store = bridge.memoryStore();
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-mcp', ttl_sec: 900 }));
    const oauth = oauthStub({
      async connect() { return { ok: true, token: 'mcp-only-token', skipped: 'access' }; },
      async accessToken() { return 'mcp-only-token'; },
    });
    const auth = {
      current: async () => ({ userId: 'u1', accessToken: GOTRUE_TOKEN }),
      token: async () => GOTRUE_TOKEN,
    };
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth, auth, ui: headlessUi().ui }));
    eq((await host.pair()).code, 'ok');
    const authz = rec.calls.map((c) => String(c.init.headers.Authorization || ''));
    eq(authz.length, 1);
    eq(authz[0], 'Bearer mcp-only-token');
    for (const line of authz) ok(!line.includes(GOTRUE_TOKEN), 'a GoTrue token became the device Bearer');
    ok(!JSON.stringify(rec.calls).includes(GOTRUE_TOKEN), 'the GoTrue token appears in the device request');
  });

  test('china flavor posts to mcp.belliedmonkey.com, same frozen path', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-cn', ttl_sec: 900 }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(), fetch: rec.fetch, ui: ui.ui, flavor: () => 'china',
    }));
    eq((await host.pair()).code, 'ok');
    eq(rec.calls[0].url, 'https://mcp.belliedmonkey.com/api/mcp/device-sessions/register');
  });

  test('a grant from the confirm card is remembered, so the next pair asks once', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-1', ttl_sec: 900 }));
    const cards = [];
    const store = bridge.memoryStore();
    const host = Host.createHost(baseOptions({
      store,
      fetch: rec.fetch,
      oauth: oauthStub(),
      ui: {
        confirm: async (card) => {
          cards.push(card);
          return { allow: true, device: true };   // 本机始终允许（连接设备）
        },
        show: async () => {},
      },
    }));
    eq((await host.pair()).code, 'ok');
    eq((await host.pair()).code, 'ok');
    eq(cards.length, 1, 'the remembered grant did not skip the second confirm');
    eq(rec.calls.length, 2);
  });

  test('a remembered grant still confirms when a new browser consent would be needed', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-1', ttl_sec: 900 }));
    const cards = [];
    const oauth = oauthStub({ async hasGrant() { return false; } });
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(),
      fetch: rec.fetch,
      oauth,
      ui: {
        confirm: async (card) => { cards.push(card); return { allow: true, device: true }; },
        show: async () => {},
      },
    }));
    eq((await host.pair()).code, 'ok');
    eq((await host.pair()).code, 'ok');
    eq(cards.length, 2, 'a new consent was started behind a remembered grant without a card');
  });
});

describe('BEL-151 host: no grant means no request, and an honest card', () => {
  test('signed out: no confirm, no fetch, no exchange, need_login', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const ui = headlessUi();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(),
      fetch: rec.fetch,
      ui: ui.ui,
      oauth,
      auth: { current: async () => null, token: async () => '' },
    }));
    const out = await host.pair();
    eq(out.code, 'need_login');
    eq(rec.calls.length, 0, 'a signed-out pair sent HTTP');
    eq(ui.cards.length, 0, 'a signed-out pair asked for confirmation first');
    eq(oauth.calls.length, 0, 'a signed-out pair touched the OAuth client');
    eq(ui.shown.length, 1);
    eq(ui.shown[0].code, 'need_login');
    eq(host.status().state, 'signed_out');
    eq(host.status().text, copy.FAILURES.need_login.line);
    eq(host.isHeartbeatRunning(), false);
  });

  test('cancelling the confirm runs no exchange and sends nothing', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-x' }));
    const store = bridge.memoryStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({
      store,
      fetch: rec.fetch,
      oauth,
      ui: { confirm: async () => ({ allow: false }), show: async () => {} },
    }));
    const out = await host.pair();
    eq(out.code, 'cancelled');
    eq(rec.calls.length, 0);
    eq(oauth.calls.length, 0, 'the OAuth client ran even though the user cancelled');
    eq(store.getItem('device_cred'), null);
    eq(host.status().state, 'unpaired');
  });

  test('signed in but the grant is missing: no register HTTP, honest reconnect', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 }));
    const ui = headlessUi();
    const oauth = oauthStub({
      async connect() { return { ok: false, code: 'need_login', sent: false }; },
      async accessToken() { return ''; },
    });
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(), fetch: rec.fetch, ui: ui.ui, oauth,
    }));
    const out = await host.pair();
    eq(out.code, 'need_login');
    eq(rec.calls.length, 0, 'register went out without an MCP access token');
    eq(ui.shown.length, 1);
    eq(ui.shown[0].code, 'need_login');
    eq(host.status().state, 'reconnect');
    eq(host.status().text, copy.MESSAGES.reconnect);
    eq(host.isHeartbeatRunning(), false);
  });

  test('a transient OAuth failure is named as network, not as "sign in again"', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const ui = headlessUi();
    const oauth = oauthStub({
      async connect() { return { ok: false, code: 'network_unavailable', sent: false }; },
    });
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(), fetch: rec.fetch, ui: ui.ui, oauth,
    }));
    const out = await host.pair();
    eq(out.code, 'network_unavailable');
    eq(rec.calls.length, 0);
    eq(host.status().state, 'network');
    eq(host.status().text, copy.MESSAGES.network);
  });
});

describe('BEL-151 host: heartbeat lifecycle', () => {
  test('launch beats even when WKWebView reports hidden, then every foreground entry', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, ttl_sec: 900 }));
    const store = pairedStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch }));
    const doc = {
      visibilityState: 'hidden',
      handlers: {},
      addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
    };
    eq(host.boot(doc).installed, true);
    // The launch beat runs unconditionally: WKWebView can report hidden while the
    // window is occluded/not yet key, and does not always fire visibilitychange when
    // it appears. Gating this was why an App restart never discovered a revoke.
    await new Promise((r) => setTimeout(r, 20));
    eq(rec.calls.length, 1, 'a hidden launch skipped the launch beat');
    eq(rec.calls[0].url, HEARTBEAT);
    eq(rec.calls[0].init.headers.Authorization, 'Bearer ' + MCP_TOKEN);
    const body = JSON.parse(rec.calls[0].init.body);
    eq(body.device_id, UUID);
    eq(body.device_cred, 'dc-old');
    eq(host.isHeartbeatRunning(), true);
    eq(host.status().state, 'paired');

    doc.visibilityState = 'visible';
    await doc.handlers.visibilitychange[0]();
    eq(rec.calls.length, 2, 'returning to the foreground did not beat');

    doc.visibilityState = 'hidden';
    await doc.handlers.visibilitychange[0]();
    eq(rec.calls.length, 2, 'going hidden sent a heartbeat');

    doc.visibilityState = 'visible';
    await doc.handlers.visibilitychange[0]();
    eq(rec.calls.length, 3, 'returning to the foreground did not beat again');
  });

  test('the interval is clamped into the contract window', async () => {
    const host = Host.createHost(baseOptions({ store: pairedStore(), fetch: recorder(() => fakeResponse(200, { ok: true })).fetch }));
    await host.ensureClient();
    eq(host.startHeartbeat({ intervalMs: 1000 }).interval_ms, bridge.HEARTBEAT_MIN_MS);
    eq(host.startHeartbeat({ intervalMs: 60 * 60 * 1000 }).interval_ms, bridge.HEARTBEAT_MAX_MS);
    host.stopHeartbeat();
  });

  test('signed out or unpaired: foreground sends nothing', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const signedOut = Host.createHost(baseOptions({
      store: pairedStore(), fetch: rec.fetch,
      auth: { current: async () => null, token: async () => '' },
    }));
    eq((await signedOut.onForeground()).code, 'need_login');
    eq(rec.calls.length, 0);
    eq(signedOut.isHeartbeatRunning(), false);

    const unpaired = Host.createHost(baseOptions({
      store: bridge.memoryStore({ device_id: UUID }), fetch: rec.fetch,
    }));
    eq((await unpaired.onForeground()).code, 'not_paired');
    eq(rec.calls.length, 0);
  });

  test('401 clears the device credential, the MCP access token, and the loop', async () => {
    let phase = 'pair';
    const rec = recorder(() => (phase === 'pair'
      ? fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 })
      : fakeResponse(401, { ok: false, code: 'unauthorized' })));
    const store = bridge.memoryStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: headlessUi().ui, oauth }));

    eq((await host.pair()).code, 'ok');
    eq(host.isHeartbeatRunning(), true);
    phase = 'beat';

    const out = await host.onForeground();
    eq(out.code, 'unauthorized');
    eq(store.getItem('device_cred'), null);
    eq(store.getItem('device_cred_user'), null);
    eq(host.isHeartbeatRunning(), false);
    eq(host.status().state, 'reconnect');
    eq(host.status().text, copy.MESSAGES.reconnect);
    ok(oauth.calls.some((c) => c[0] === 'invalidateAccess'), 'MCP access token was not invalidated');

    // A later foreground must not repaint a signed-out/unpaired lie over that.
    const again = await host.onForeground();
    eq(again.code, 'not_paired');
    eq(host.status().state, 'reconnect');
    eq(host.status().text, copy.MESSAGES.reconnect);
  });

  test('a 401 on agentBridge().heartbeat gets the same D.8 fallout', async () => {
    // The background interval and the agent host both call agentBridge().heartbeat().
    // Before onUnauthorized, that path cleared device_cred inside the client and then
    // forgot about it: no Keychain clear, no status, no copy — an invisible revoke.
    const rec = recorder(() => fakeResponse(401, { ok: false, code: 'unauthorized' }));
    const store = pairedStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    const out = await host.agentBridge().heartbeat();
    eq(out.code, 'unauthorized');
    eq(store.getItem('device_cred'), null);
    eq(store.getItem('device_cred_user'), null);
    eq(store.getItem('device_reconnect'), '1');
    eq(host.isHeartbeatRunning(), false);
    eq(host.status().state, 'reconnect');
    eq(host.status().text, copy.MESSAGES.reconnect);
    eq(host.status().paired, false);
    ok(oauth.calls.some((c) => c[0] === 'invalidateAccess'), 'MCP access token was not invalidated');
  });

  test('the re-allow state survives a relaunch and the relaunch sends no heartbeat', async () => {
    const store = pairedStore();
    const oauth = oauthStub();
    const dead = recorder(() => fakeResponse(401, { ok: false, code: 'unauthorized' }));
    const first = Host.createHost(baseOptions({ store, fetch: dead.fetch, oauth }));
    eq((await first.onForeground()).code, 'unauthorized');
    eq(store.getItem('device_reconnect'), '1');

    // A fresh App process over the same storage: no credential, but the reason must
    // not be erased into "unpaired" — the user still has to allow this device again.
    const live = recorder(() => fakeResponse(200, { ok: true, ttl_sec: 900 }));
    const second = Host.createHost(baseOptions({ store, fetch: live.fetch }));
    const out = await second.onForeground();
    eq(out.code, 'not_paired');
    eq(live.calls.length, 0, 'an unpaired relaunch sent a heartbeat');
    eq(second.status().state, 'reconnect');
    eq(second.status().text, copy.MESSAGES.reconnect);
    eq(second.status().paired, false);
  });

  test('an MCP refresh network failure keeps the credential and says network', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, ttl_sec: 900 }));
    const store = pairedStore();
    const oauth = oauthStub({
      async accessToken() { return ''; },
      state: () => ({ hasAccess: false, hasRefresh: true, lastError: 'network' }),
    });
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    const out = await host.onForeground();
    eq(out.code, 'need_login');
    eq(rec.calls.length, 0, 'a heartbeat went out with an empty Bearer');
    eq(store.getItem('device_cred'), 'dc-old');
    eq(host.status().state, 'network');
    eq(host.status().text, copy.MESSAGES.network);
  });

  test('a dead MCP grant clears device_cred and says re-allow the device', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, ttl_sec: 900 }));
    const store = pairedStore();
    const oauth = oauthStub({
      async accessToken() { return ''; },
      state: () => ({ hasAccess: false, hasRefresh: false, lastError: 'invalid_grant' }),
    });
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    const out = await host.onForeground();
    eq(out.code, 'need_login');
    eq(rec.calls.length, 0);
    eq(store.getItem('device_cred'), null, 'device_cred survived a dead MCP grant');
    eq(host.status().state, 'reconnect');
    eq(host.status().text, copy.MESSAGES.reconnect);
    eq(host.isHeartbeatRunning(), false);
  });

  test('a network failure keeps the credential and the interval, and says network', async () => {
    let fail = false;
    const rec = recorder(() => {
      if (fail) throw new Error('offline');
      return fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 });
    });
    const store = bridge.memoryStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: headlessUi().ui }));
    eq((await host.pair()).code, 'ok');
    fail = true;
    const out = await host.onForeground();
    eq(out.code, 'network_unavailable');
    eq(store.getItem('device_cred'), 'dc-9');
    eq(host.isHeartbeatRunning(), true);
    eq(host.status().state, 'network');
    eq(host.status().text, copy.MESSAGES.network);
  });

  test('signing out clears the pair and the MCP grant; a different account cannot reuse it', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 }));
    const store = bridge.memoryStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: headlessUi().ui, oauth }));
    eq((await host.pair()).code, 'ok');

    await host.noteSession(null);
    eq(store.getItem('device_cred'), null);
    eq(host.isHeartbeatRunning(), false);
    eq(host.status().state, 'signed_out');
    ok(oauth.calls.some((c) => c[0] === 'clearTokens'), 'sign-out left the MCP grant behind');

    // Pair again as u1, then a different account appears in the same store.
    eq((await host.pair()).code, 'ok');
    await host.noteSession({ userId: 'u2' });
    eq(store.getItem('device_cred'), null);
    eq(host.status().state, 'unpaired');
  });
});

describe('BEL-151 host: explicit disconnect (ACCEPT-U2)', () => {
  test('connected → best-effort revoke with the captured Bearer, clear both slots, unpaired', async () => {
    let atFetch = null;
    const rec = recorder(() => {
      atFetch = { heartbeat: host.isHeartbeatRunning(), cred: store.getItem('device_cred') };
      return fakeResponse(200, { ok: true, revoked: true });
    });
    const store = pairedStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    await host.noteSession({ userId: 'u1' });
    eq(host.status().state, 'paired');
    await host.ensureClient();
    host.startHeartbeat();
    eq(host.isHeartbeatRunning(), true);

    const out = await host.disconnect();
    eq(out.ok, true);
    eq(out.state, 'unpaired');
    eq(out.revoke.attempted, true);
    eq(out.revoke.ok, true);
    eq(out.revoke.status, 200);

    // The heartbeat was already stopped and device_cred already dropped when the
    // revoke hit the wire; the UI does not wait for the cloud receipt.
    eq(atFetch.heartbeat, false);
    eq(atFetch.cred, null);
    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, REVOKE);
    eq(rec.calls[0].init.headers.Authorization, 'Bearer ' + MCP_TOKEN);
    const body = JSON.parse(rec.calls[0].init.body);
    eq(body.device_id, UUID);
    eq(body.device_cred, 'dc-old');

    eq(store.getItem('device_cred'), null);
    eq(store.getItem('device_cred_user'), null);
    eq(store.getItem('device_reconnect'), null);
    eq(host.hasCred(), false);
    eq(host.isHeartbeatRunning(), false);
    eq(host.status().state, 'unpaired');
    eq(host.status().paired, false);
    ok(oauth.calls.some((c) => c[0] === 'clearTokens'), 'mcp_access/mcp_refresh were not cleared');
  });

  test('the UI flips to unpaired before a slow revoke answers', async () => {
    let release = null;
    const rec = recorder(() => new Promise((r) => { release = () => r(fakeResponse(200, { ok: true })); }));
    const store = pairedStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth: oauthStub() }));
    await host.noteSession({ userId: 'u1' });
    await host.ensureClient();
    host.startHeartbeat();

    const pending = host.disconnect();
    for (let i = 0; i < 20 && !release; i++) await new Promise((r) => setTimeout(r, 5));
    ok(!!release, 'disconnect never reached the revoke POST');
    eq(host.status().state, 'unpaired');
    eq(host.isHeartbeatRunning(), false);
    eq(store.getItem('device_cred'), null);
    release();
    const out = await pending;
    eq(out.revoke.ok, true);
  });

  test('revoke 401 still clears both slots and never flips to reconnect', async () => {
    const rec = recorder(() => fakeResponse(401, { ok: false, code: 'unauthorized' }));
    const store = pairedStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    await host.noteSession({ userId: 'u1' });

    const out = await host.disconnect();
    eq(out.revoke.attempted, true);
    eq(out.revoke.ok, false);
    eq(out.revoke.status, 401);
    eq(out.revoke.code, 'unauthorized');
    eq(store.getItem('device_cred'), null);
    eq(store.getItem('device_reconnect'), null, 'a 401 during disconnect persisted reconnect');
    eq(host.status().state, 'unpaired');
    ok(oauth.calls.some((c) => c[0] === 'clearTokens'), 'mcp_access/mcp_refresh were not cleared');
    ok(!oauth.calls.some((c) => c[0] === 'invalidateAccess'),
      'disconnect cleared only the access token instead of both slots');
  });

  test('revoke network failure still clears both slots and stays unpaired', async () => {
    const rec = recorder(() => { throw new Error('offline'); });
    const store = pairedStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    await host.noteSession({ userId: 'u1' });

    const out = await host.disconnect();
    eq(out.revoke.attempted, true);
    eq(out.revoke.ok, false);
    eq(out.revoke.status, 0);
    eq(out.revoke.code, 'network_unavailable');
    eq(store.getItem('device_cred'), null);
    eq(host.status().state, 'unpaired');
    ok(oauth.calls.some((c) => c[0] === 'clearTokens'));
  });

  test('no MCP Bearer: no revoke request, but the local pair and both slots still go', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const store = pairedStore();
    const oauth = oauthStub({ async accessToken() { return ''; } });
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, oauth }));
    await host.noteSession({ userId: 'u1' });

    const out = await host.disconnect();
    eq(rec.calls.length, 0, 'revoke went out without a Bearer');
    eq(out.revoke.attempted, false);
    eq(out.revoke.code, 'no_bearer');
    eq(store.getItem('device_cred'), null);
    eq(host.status().state, 'unpaired');
    ok(oauth.calls.some((c) => c[0] === 'clearTokens'));
  });

  test('a hung revoke times out with the UI already unpaired and the slots cleared', async () => {
    const rec = recorder(() => new Promise(() => {}));
    const store = pairedStore();
    const oauth = oauthStub();
    const host = Host.createHost(baseOptions({
      store, fetch: rec.fetch, oauth, disconnectTimeoutMs: 25,
    }));
    await host.noteSession({ userId: 'u1' });
    await host.ensureClient();
    host.startHeartbeat();
    const out = await host.disconnect();
    eq(out.state, 'unpaired');
    eq(out.revoke.attempted, true);
    eq(out.revoke.ok, false);
    eq(out.revoke.code, 'timeout');
    eq(out.revoke.timed_out, true);
    eq(host.status().state, 'unpaired');
    eq(host.isHeartbeatRunning(), false);
    eq(store.getItem('device_cred'), null);
    ok(oauth.calls.some((c) => c[0] === 'clearTokens'));
  });

  test('pairing is pending while the confirm is open and cancel restores the prior state', async () => {
    let release = null;
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-9' }));
    const ui = {
      confirm: () => new Promise((resolve) => { release = resolve; }),
      show: async () => {},
    };
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore({ device_id: UUID }), fetch: rec.fetch, oauth: oauthStub(), ui,
    }));
    const pending = host.pair();
    for (let i = 0; i < 20 && typeof release !== 'function'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    ok(typeof release === 'function', 'pair() never reached the confirm card');
    eq(host.status().state, 'pending');
    eq(host.status().text, copy.DISCONNECT.pending);
    release({ allow: false });
    const out = await pending;
    eq(out.code, 'cancelled');
    eq(rec.calls.length, 0);
    eq(host.status().state, 'unpaired');
    eq(host.status().text, '');
  });
});

describe('BEL-151 host: bootstrap stays short-lived', () => {
  test('agentBridge().bootstrap carries the MCP Bearer and never becomes the pair', async () => {
    const rec = recorder(() => fakeResponse(200, {
      ok: true, device_cred: 'short-lived', ttl_sec: 300, kind: 'bootstrap',
    }));
    const store = bridge.memoryStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch }));

    const out = await host.agentBridge().bootstrap({ source: 'open_setup' });
    eq(out.ok, true);
    eq(out.paired, false);
    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, BOOTSTRAP);
    eq(rec.calls[0].init.headers.Authorization, 'Bearer ' + MCP_TOKEN);
    const body = JSON.parse(rec.calls[0].init.body);
    eq(body.source, 'open_setup');
    eq(body.platform, 'mac');
    eq(body.ttl_sec, 300);
    eq(store.getItem('device_cred'), null, 'bootstrap credential was stored as the pair');
    eq(host.isHeartbeatRunning(), false);
  });

  test('bootstrap from anywhere but open_setup sends nothing', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const host = Host.createHost(baseOptions({ store: bridge.memoryStore(), fetch: rec.fetch }));
    const out = await host.agentBridge().bootstrap({ source: 'user' });
    eq(out.code, 'bad_request');
    eq(rec.calls.length, 0);
  });

  test('there is no agentBridge().register door around the confirm gate', async () => {
    const host = Host.createHost(baseOptions({ store: bridge.memoryStore() }));
    eq(typeof host.agentBridge().register, 'undefined');
  });
});
