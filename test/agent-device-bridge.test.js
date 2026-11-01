// test/agent-device-bridge.test.js — BEL-151 device bridge + pair_device gate.
//
// The cloud is a mock fetch. Nothing here touches the network, a real device,
// or a localhost companion: these are model-level checks for the confirm gate,
// the four POST bodies, and the 401 clear/stop rule.
'use strict';

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const contract = require('../agent/contract');
const copy = require('../agent/copy');
const confirm = require('../agent/confirm');
const run = require('../agent/run');
const session = require('../agent/session');
const bridge = require('../agent/device-bridge');

const URL_OPEN = 'belliedmonkey://agent/v1/open_setup?step=install_app&source=mcp';
const READY = { login: true, network: true };

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function recorder(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return { calls, fetch };
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

function clientWith(handler, extra) {
  const rec = recorder(handler);
  const store = bridge.memoryStore();
  const client = bridge.createClient(Object.assign({
    flavor: 'intl',
    fetch: rec.fetch,
    getAccessToken: async () => 'oauth-token',
    getAppVersion: () => '1.22.3',
    store,
  }, extra || {}));
  return { rec, store, client };
}

describe('BEL-151 pair_device confirm gate', () => {
  test('pair_device needs a confirm but is not one of the five SENSITIVE tools', () => {
    eq(confirm.needsConfirm('pair_device', { device: {}, assistants: {} }, ''), true);
    eq(confirm.needsConfirm('pair_device', { device: { pair_device: true }, assistants: {} }, ''), false);
    eq(contract.isSensitive('pair_device'), false);
    eq(contract.SENSITIVE.has('pair_device'), false);
    eq(contract.SENSITIVE.size, 5);
    // Copy lock: the card says what pairing actually tells the assistant.
    eq(copy.ACTIONS.pair_device.name, '连接此设备到助手');
    eq(copy.ACTIONS.pair_device.short, '连接设备');
    eq(copy.MESSAGES.paired, '已连接此设备');
    const card = confirm.buildConfirmCard('pair_device', {});
    eq(card.title, '确认调用');
    eq(card.actionLabel, '连接此设备到助手');
    ok(card.touches.includes('将把本机可达状态告知已连接的助手'));
    eq(card.deviceAllow, '本机始终允许（连接设备）');
    eq(card.primary, '允许这一次');
    eq(card.cancel, '取消');
    ok(!JSON.stringify(card).includes('听译已通'));
    ok(!JSON.stringify(card.touches).includes('麦克风'));
    ok(!confirm.needsConfirm('ready.check', { device: {}, assistants: {} }, ''));
  });

  test('decline and cancel return cancelled with zero register HTTP', async () => {
    for (const decision of [{ allow: false }, null]) {
      const { rec, client } = clientWith(() => response(200, {
        ok: true, device_cred: 'should-never-be-used', ttl_sec: 900,
      }));
      let cards = 0;
      const out = await session.requestPairing({
        scheme: 'belliedmonkey',
        readiness: READY,
        deviceBridge: client,
      }, {
        confirm(card) {
          cards++;
          eq(card.actionLabel, '连接此设备到助手');
          return decision;
        },
        show() {},
      });
      eq(cards, 1);
      eq(out.code, 'cancelled');
      eq(out.message, '已取消');
      eq(rec.calls.length, 0);
    }
  });

  test('allow registers on the mock with confirm:true and platform:mac, then heartbeats', async () => {
    const { rec, store, client } = clientWith((url) => {
      if (url.endsWith('/register')) {
        return response(200, { ok: true, device_cred: 'dc-1', ttl_sec: 900 });
      }
      return response(200, { ok: true, ttl_sec: 900, last_seen: '2026-10-31T07:00:00Z' });
    });
    const out = await session.requestPairing({
      scheme: 'belliedmonkey',
      readiness: READY,
      deviceBridge: client,
    }, {
      confirm() { return { allow: true }; },
      show() {},
    });
    eq(out.code, 'ok');
    eq(out.message, '已连接此设备');
    eq(rec.calls.length, 1);

    const reg = rec.calls[0];
    eq(reg.url, 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/register');
    eq(reg.init.method, 'POST');
    eq(reg.init.headers.Authorization, 'Bearer oauth-token');
    const body = bodyOf(reg);
    eq(body.platform, 'mac');
    eq(body.app_version, '1.22.3');
    eq(body.confirm, true);
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.device_id));
    ok(!('oauth_sub' in body));
    eq(store.getItem('device_cred'), 'dc-1');

    const beat = await client.heartbeat();
    eq(beat.ok, true);
    eq(rec.calls.length, 2);
    const hb = rec.calls[1];
    eq(hb.url, 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/heartbeat');
    const hbody = bodyOf(hb);
    eq(hbody.device_id, body.device_id);
    eq(hbody.device_cred, 'dc-1');
  });

  test('register without confirm:true refuses locally and sends nothing', async () => {
    const { rec, store, client } = clientWith(() => response(200, {
      ok: true, device_cred: 'dc-x', ttl_sec: 900,
    }));
    const missing = await client.register({});
    eq(missing.ok, false);
    eq(missing.code, 'confirm_required');
    eq(missing.sent, false);
    const falsey = await client.register({ confirm: 'yes' });
    eq(falsey.code, 'confirm_required');
    eq(rec.calls.length, 0);
    eq(store.getItem('device_cred'), null);

    // A direct runAgentAction without a decision is denied before the port.
    const direct = await run.runAgentAction('pair_device', {
      scheme: 'belliedmonkey',
      readiness: READY,
      deviceBridge: client,
    });
    eq(direct.receipt.code, 'untrusted_denied');
    eq(rec.calls.length, 0);
  });
  test('ports.pairDevice sees confirm:true, and device failures stay inside §6', async () => {
    let seen = null;
    const okOut = await session.requestPairing({
      scheme: 'belliedmonkey',
      readiness: READY,
      ports: {
        pairDevice(req) {
          seen = req;
          return { ok: true };
        },
      },
    }, {
      confirm() { return { allow: true }; },
      show() {},
    });
    eq(okOut.code, 'ok');
    eq(okOut.message, '已连接此设备');
    eq(seen.action, 'pair_device');
    eq(seen.confirm, true);

    const denied = await session.requestPairing({
      scheme: 'belliedmonkey',
      readiness: READY,
      ports: { pairDevice() { return { ok: false, code: 'unauthorized' }; } },
    }, {
      confirm() { return { allow: true }; },
      show() {},
    });
    eq(denied.code, 'need_login');
    ok(contract.CODE_SET.has(denied.code));
  });
});

describe('BEL-151 device bridge client', () => {
  test('baseUrlForFlavor: intl/global → mcp.cc, china → mcp.com, opts.baseUrl wins', async () => {
    ok(bridge.baseUrlForFlavor('intl').includes('mcp.belliedmonkey.cc'));
    ok(bridge.baseUrlForFlavor('global').includes('mcp.belliedmonkey.cc'));
    ok(bridge.baseUrlForFlavor('china').includes('mcp.belliedmonkey.com'));
    ok(!bridge.baseUrlForFlavor('china').includes('www.'));
    ok(!bridge.baseUrlForFlavor('intl').includes('www.'));

    const { rec, client } = clientWith(() => response(200, { ok: true, ttl_sec: 300 }), {
      baseUrl: 'https://staging.example.test/',
    });
    eq(client.baseUrl, 'https://staging.example.test');
    const out = await client.bootstrap({ source: 'open_setup' });
    eq(out.ok, true);
    eq(rec.calls[0].url, 'https://staging.example.test/api/mcp/device-sessions/bootstrap');
  });

  test('paths are configurable', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }), {
      baseUrl: 'https://staging.example.test',
      paths: { bootstrap: '/v2/device/boot' },
    });
    await client.bootstrap({ source: 'open_setup' });
    eq(rec.calls[0].url, 'https://staging.example.test/v2/device/boot');
    eq(client.paths.register, '/api/mcp/device-sessions/register');
  });

  test('getOrCreateDeviceId is stable and stored per install', () => {
    const store = bridge.memoryStore();
    const first = bridge.getOrCreateDeviceId(store);
    const second = bridge.getOrCreateDeviceId(store);
    eq(first, second);
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(first));
    eq(store.getItem('device_id'), first);
    // A corrupt stored id is replaced once, not used as a device identity.
    const bad = bridge.memoryStore({ device_id: 'not-a-uuid' });
    const fixed = bridge.getOrCreateDeviceId(bad);
    ok(fixed !== 'not-a-uuid');
    eq(bridge.getOrCreateDeviceId(bad), fixed);
  });

  test('bootstrap is short-lived: request body is honest, the cred is never stored as paired', async () => {
    const { rec, store, client } = clientWith(() => response(200, {
      ok: true, device_cred: 'short-lived', ttl_sec: 300, kind: 'bootstrap',
    }));
    const out = await client.bootstrap({ source: 'open_setup' });
    eq(out.ok, true);
    eq(out.paired, false);
    eq(out.kind, 'bootstrap');
    eq(out.bootstrap_cred, 'short-lived');
    eq(store.getItem('device_cred'), null);
    eq(client.hasCred(), false);
    const body = bodyOf(rec.calls[0]);
    eq(body.source, 'open_setup');
    eq(body.platform, 'mac');
    eq(body.ttl_sec, 300);

    const refused = await client.bootstrap({ source: 'manual' });
    eq(refused.code, 'bad_request');
    eq(rec.calls.length, 1);
  });

  test('heartbeat 401 clears the local cred and stops the timer; the next tick sends nothing', async () => {
    const timers = [];
    let cleared = 0;
    const { rec, store, client } = clientWith((url) => {
      if (url.endsWith('/register')) {
        return response(200, { ok: true, device_cred: 'dc-1', ttl_sec: 900 });
      }
      return response(401, { ok: false, code: 'unauthorized' });
    }, {
      setTimeout(fn) { timers.push(fn); return 7; },
      clearTimeout(id) { if (id === 7) cleared++; },
    });
    await client.register({ confirm: true });
    eq(client.hasCred(), true);
    client.startHeartbeat({ intervalMs: 50 });
    eq(client.isHeartbeatRunning(), true);
    eq(timers.length, 1);

    const beat = await client.heartbeat();
    eq(beat.ok, false);
    eq(beat.code, 'unauthorized');
    eq(store.getItem('device_cred'), null);
    eq(client.hasCred(), false);
    eq(client.isHeartbeatRunning(), false);
    eq(cleared, 1);

    const before = rec.calls.length;
    const again = await client.heartbeat();
    eq(again.code, 'not_paired');
    eq(rec.calls.length, before);
  });

  test('revoke clears locally even when the cloud call fails', async () => {
    const paired = bridge.memoryStore({
      device_cred: 'dc-2',
      device_id: '11111111-1111-4111-8111-111111111111',
    });
    const rec = recorder(() => response(500, { ok: false }));
    const client = bridge.createClient({
      baseUrl: 'https://staging.example.test',
      fetch: rec.fetch,
      getAccessToken: () => 't',
      store: paired,
    });
    eq(client.hasCred(), true);
    const out = await client.revoke();
    eq(out.ok, true);
    eq(out.revoked, true);
    eq(out.cloud, false);
    eq(paired.getItem('device_cred'), null);
    eq(rec.calls.length, 1);
    eq(bodyOf(rec.calls[0]).device_cred, 'dc-2');

    // Revoking an unpaired client is idempotent and sends no request.
    const empty = bridge.memoryStore();
    const rec2 = recorder(() => response(200, { ok: true }));
    const bare = bridge.createClient({
      baseUrl: 'https://staging.example.test',
      fetch: rec2.fetch,
      getAccessToken: () => 't',
      store: empty,
    });
    const twice = await bare.revoke();
    eq(twice.ok, true);
    eq(twice.revoked, false);
    eq(rec2.calls.length, 0);
  });

  test('revoke can use the host-captured Bearer so a refresh never races the clear', async () => {
    const paired = bridge.memoryStore({
      device_cred: 'dc-3',
      device_id: '11111111-1111-4111-8111-111111111111',
    });
    let tokenReads = 0;
    const rec = recorder(() => response(200, { ok: true, revoked: true }));
    const client = bridge.createClient({
      baseUrl: 'https://staging.example.test',
      fetch: rec.fetch,
      getAccessToken: () => { tokenReads += 1; return 'fresh-token'; },
      store: paired,
    });
    const out = await client.revoke({ token: 'captured-token' });
    eq(out.cloud, true);
    eq(out.attempted, true);
    eq(tokenReads, 0, 'revoke asked for a token instead of using the captured one');
    eq(rec.calls.length, 1);
    eq(rec.calls[0].init.headers.Authorization, 'Bearer captured-token');
    eq(bodyOf(rec.calls[0]).device_cred, 'dc-3');
    eq(paired.getItem('device_cred'), null);
  });

  test('device bridge has no localhost companion and no listening claim', () => {
    const src = fs.readFileSync(path.join(ROOT, 'agent/device-bridge.js'), 'utf8');
    ok(!/localhost|127\.0\.0\.1|\[::1\]/i.test(src));
    ok(!src.includes('听译已通'));
    ok(!src.includes('完整 D3'));
    ok(src.includes('mcp.belliedmonkey.cc'));
    ok(src.includes('mcp.belliedmonkey.com'));
  });
});

describe('BEL-151 open_setup bootstrap hook', () => {
  test('open_setup allow calls bootstrap; decline opens and boots nothing', async () => {
    const opened = [];
    const boots = [];
    const ctx = {
      hostConnected: true,
      readiness: READY,
      ports: {
        openSetup(req) { opened.push(req.step); return { ok: true }; },
        deviceBootstrap(req) { boots.push(req); return { ok: true }; },
      },
    };
    const declined = await session.handleAgentUrl(URL_OPEN, ctx, {
      confirm() { return { allow: false }; },
      show() {},
    });
    eq(declined.code, 'cancelled');
    eq(opened.length, 0);
    eq(boots.length, 0);

    const accepted = await session.handleAgentUrl(URL_OPEN, ctx, {
      confirm() { return { allow: true }; },
      show() {},
    });
    eq(accepted.code, 'ok');
    eq(accepted.message, '已打开设置');
    deepEq(opened, ['install_app']);
    deepEq(boots, [{ source: 'open_setup' }]);
  });

  test('open_setup falls back to an injected deviceBridge and never pairs from bootstrap', async () => {
    const { rec, store, client } = clientWith(() => response(200, {
      ok: true, device_cred: 'short-lived', ttl_sec: 300, kind: 'bootstrap',
    }));
    const opened = [];
    const out = await session.handleAgentUrl(URL_OPEN, {
      hostConnected: true,
      readiness: READY,
      ports: { openSetup(req) { opened.push(req.step); return { ok: true }; } },
      deviceBridge: client,
    }, {
      confirm() { return { allow: true }; },
      show() {},
    });
    eq(out.code, 'ok');
    deepEq(opened, ['install_app']);
    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/bootstrap');
    eq(bodyOf(rec.calls[0]).source, 'open_setup');
    eq(store.getItem('device_cred'), null);
    eq(client.hasCred(), false);
  });

  test('a failed open_setup never reaches bootstrap', async () => {
    const boots = [];
    const out = await session.handleAgentUrl(URL_OPEN, {
      hostConnected: true,
      readiness: READY,
      ports: {
        openSetup() { return { ok: false, code: 'need_app' }; },
        deviceBootstrap(req) { boots.push(req); return { ok: true }; },
      },
    }, {
      confirm() { return { allow: true }; },
      show() {},
    });
    eq(out.code, 'need_app');
    eq(boots.length, 0);
  });
});

describe('BEL-151 regression: the existing confirm surface', () => {
  test('open_setup still confirms, SENSITIVE is still the five tools, open_setup stays out', () => {
    eq(confirm.needsConfirm('open_setup', { device: {}, assistants: {} }, ''), true);
    eq(contract.SENSITIVE.has('open_setup'), false);
    deepEq(Array.from(contract.SENSITIVE).sort(), [
      'capture_to_study',
      'explain_or_drill',
      'start_live_subtitles',
      'translate_page',
      'translate_video_captions',
    ]);
    for (const name of ['start_live_subtitles', 'translate_page', 'translate_video_captions',
      'capture_to_study', 'explain_or_drill']) {
      eq(confirm.needsConfirm(name, { device: {}, assistants: {} }, ''), true);
    }
  });
});

describe('BEL-151 regression: WKWebView timer receivers', () => {
  test('startHeartbeat calls setTimeout with the Window receiver', () => {
    // Safari/WKWebView throws "Can only call Window.setTimeout on instances of
    // Window" when the timer is invoked as a method of another object. The client
    // used to call timers.setTimeout(...) that way, so the App's first heartbeat
    // threw before fetch — the D.8 401 could never arrive.
    const receivers = [];
    function windowSetTimeout(fn, ms) {
      receivers.push(this);
      if (this !== globalThis) throw new Error('Can only call Window.setTimeout on instances of Window');
      return setTimeout(fn, ms);
    }
    function windowClearTimeout(id) {
      if (this !== globalThis) throw new Error('Can only call Window.clearTimeout on instances of Window');
      return clearTimeout(id);
    }
    const client = bridge.createClient({
      store: bridge.memoryStore({ device_cred: 'dc-old' }),
      getAccessToken: () => 'mcp-access',
      fetch: async () => response(200, { ok: true, ttl_sec: 900 }),
      setTimeout: windowSetTimeout,
      clearTimeout: windowClearTimeout,
    });
    const out = client.startHeartbeat({ intervalMs: 120000 });
    eq(out.ok, true);
    eq(receivers.length, 1);
    eq(receivers[0], globalThis);
    client.stopHeartbeat();
  });
});
