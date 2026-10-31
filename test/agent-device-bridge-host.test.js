// test/agent-device-bridge-host.test.js — BEL-151 host wiring (App side).
//
// agent/device-bridge.js is the transport; agent/session.js is the confirm gate.
// This file tests the piece that was missing: the App's own Settings entry, the
// OAuth Bearer the host must supply, the honest no-token path, 401 clearing the
// local credential, and the foreground heartbeat lifecycle.
//
// It runs the REAL host module (bundled the way the page bundles it) against the
// REAL pairing gate, with only the edges injected: a fake LearnAuth, a memory
// store, a recording fetch, and a headless confirm/show UI.
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
    auth: {
      current: async () => ({ userId: 'u1', accessToken: 'tok-1' }),
      token: async () => 'tok-1',
    },
    flavor: () => 'global',
    appVersion: () => '1.22.3',
    now: () => 1700000000000,
  }, extra || {});
}

function headlessUi() {
  const cards = [];
  const shown = [];
  return {
    cards,
    shown,
    ui: {
      confirm: async (card) => { cards.push(card); return { allow: true }; },
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

  test('the host adds no transport: frozen bases stay in agent/device-bridge.js', () => {
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

describe('BEL-151 host: Bearer register', () => {
  test('pair() sends the session access token as a Bearer and stores the credential', async () => {
    const store = bridge.memoryStore();
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: ui.ui }));

    const out = await host.pair();
    eq(out.code, 'ok');
    eq(out.message, copy.MESSAGES.paired);
    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, REGISTER);
    eq(rec.calls[0].init.method, 'POST');
    eq(rec.calls[0].init.headers.Authorization, 'Bearer tok-1');
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
});

describe('BEL-151 host: no token means no request, and an honest card', () => {
  test('signed out: no confirm, no fetch, need_login', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(),
      fetch: rec.fetch,
      ui: ui.ui,
      auth: { current: async () => null, token: async () => '' },
    }));
    const out = await host.pair();
    eq(out.code, 'need_login');
    eq(rec.calls.length, 0, 'a signed-out pair sent HTTP');
    eq(ui.cards.length, 0, 'a signed-out pair asked for confirmation first');
    eq(ui.shown.length, 1);
    eq(ui.shown[0].code, 'need_login');
    eq(host.status().state, 'signed_out');
    eq(host.status().text, copy.FAILURES.need_login.line);
    eq(host.isHeartbeatRunning(), false);
  });

  test('session present but token empty: still no fetch, and the receipt is need_login', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(),
      fetch: rec.fetch,
      ui: ui.ui,
      auth: { current: async () => ({ userId: 'u1' }), token: async () => '' },
    }));
    const out = await host.pair();
    eq(out.code, 'need_login');
    eq(rec.calls.length, 0, 'register went out with an empty Bearer');
    eq(ui.shown.length, 1);
    eq(ui.shown[0].code, 'need_login');
    eq(host.status().state, 'signed_out');
  });

  test('a transient token failure is named as network, not as "sign in"', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true }));
    const ui = headlessUi();
    const host = Host.createHost(baseOptions({
      store: bridge.memoryStore(),
      fetch: rec.fetch,
      ui: ui.ui,
      auth: {
        current: async () => ({ userId: 'u1', accessToken: 'stale' }),
        token: async () => { const e = new Error('offline'); e.code = 'offline'; throw e; },
      },
    }));
    const out = await host.pair();
    eq(out.code, 'network_unavailable');
    eq(rec.calls.length, 0);
    eq(host.status().state, 'network');
  });

  test('cancelling the confirm sends nothing and changes no credential', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-x' }));
    const store = bridge.memoryStore();
    const host = Host.createHost(baseOptions({
      store,
      fetch: rec.fetch,
      ui: { confirm: async () => ({ allow: false }), show: async () => {} },
    }));
    const out = await host.pair();
    eq(out.code, 'cancelled');
    eq(rec.calls.length, 0);
    eq(store.getItem('device_cred'), null);
    eq(host.status().state, 'unpaired');
  });
});

describe('BEL-151 host: heartbeat lifecycle', () => {
  test('foreground beats once, keeps a 2–5 min interval, and hidden does not beat', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, ttl_sec: 900 }));
    const store = pairedStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch }));
    const doc = {
      visibilityState: 'hidden',
      handlers: {},
      addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
    };
    eq(host.boot(doc).installed, true);
    eq(rec.calls.length, 0, 'a hidden launch sent a heartbeat');

    doc.visibilityState = 'visible';
    await doc.handlers.visibilitychange[0]();
    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, HEARTBEAT);
    eq(rec.calls[0].init.headers.Authorization, 'Bearer tok-1');
    const body = JSON.parse(rec.calls[0].init.body);
    eq(body.device_id, UUID);
    eq(body.device_cred, 'dc-old');
    eq(host.isHeartbeatRunning(), true);
    eq(host.status().state, 'paired');

    doc.visibilityState = 'hidden';
    await doc.handlers.visibilitychange[0]();
    eq(rec.calls.length, 1, 'going hidden sent a heartbeat');

    doc.visibilityState = 'visible';
    await doc.handlers.visibilitychange[0]();
    eq(rec.calls.length, 2, 'returning to the foreground did not beat');
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

  test('401 clears the credential and stops the loop', async () => {
    let phase = 'pair';
    const rec = recorder(() => (phase === 'pair'
      ? fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 })
      : fakeResponse(401, { ok: false, code: 'unauthorized' })));
    const store = bridge.memoryStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: headlessUi().ui }));

    eq((await host.pair()).code, 'ok');
    eq(host.isHeartbeatRunning(), true);
    phase = 'beat';

    const out = await host.onForeground();
    eq(out.code, 'unauthorized');
    eq(store.getItem('device_cred'), null);
    eq(store.getItem('device_cred_user'), null);
    eq(host.isHeartbeatRunning(), false);
    eq(host.status().state, 'signed_out');
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

  test('signing out clears the pair; a different account cannot reuse it', async () => {
    const rec = recorder(() => fakeResponse(200, { ok: true, device_cred: 'dc-9', ttl_sec: 900 }));
    const store = bridge.memoryStore();
    const host = Host.createHost(baseOptions({ store, fetch: rec.fetch, ui: headlessUi().ui }));
    eq((await host.pair()).code, 'ok');

    await host.noteSession(null);
    eq(store.getItem('device_cred'), null);
    eq(host.isHeartbeatRunning(), false);
    eq(host.status().state, 'signed_out');

    // Pair again as u1, then a different account appears in the same store.
    eq((await host.pair()).code, 'ok');
    await host.noteSession({ userId: 'u2' });
    eq(store.getItem('device_cred'), null);
    eq(host.status().state, 'unpaired');
  });
});

describe('BEL-151 host: bootstrap stays short-lived', () => {
  test('agentBridge().bootstrap carries the Bearer and never becomes the pair', async () => {
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
    eq(rec.calls[0].init.headers.Authorization, 'Bearer tok-1');
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
});
