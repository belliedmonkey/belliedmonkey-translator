// test/agent-elicit-callback.test.js — BEL-151 GAP-2 App slice.
//
// The Worker owns pending_confirm. The App's only job is: carry pending_id from
// the action deep link into the confirm sheet, POST the user's allow/deny with
// the existing device_cred, clear the local pending row on disconnect / revoke /
// 401, and never turn a missing pending id into a fake cloud success.
//
// Everything below is model-level: a mock Worker (fetch), a memory store, and the
// real agent/session + agent/device-bridge modules. No real network, no mic.
'use strict';

const { describe, test, ok, deepEq, eq } = require('./harness');
const bridge = require('../agent/device-bridge');
const session = require('../agent/session');
const parse = require('../agent/parse');

const UUID = '11111111-1111-4111-8111-111111111111';
const CONFIRM = 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/confirm';
const PENDING = 'pnd_0123456789abcdef';
const READY = {
  login: true,
  network: true,
  packs: true,
  os: true,
  mic: true,
  engine: true,
};

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function recorder(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return handler(calls[calls.length - 1], calls.length);
  };
  return { calls, fetch };
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

function clientWith(handler, extra) {
  const rec = recorder(handler || (() => response(200, { ok: true })));
  const store = bridge.memoryStore(Object.assign({
    device_id: UUID,
    device_cred: 'dc-app-test',
  }, (extra && extra.seed) || {}));
  const client = bridge.createClient(Object.assign({
    flavor: 'intl',
    fetch: rec.fetch,
    getAccessToken: async () => 'mcp-access-token',
    getAppVersion: () => '1.23.1',
    store,
    now: () => 1700000000000,
  }, extra && extra.options ? extra.options : {}));
  return { rec, store, client };
}

function deepLink(pending) {
  const q = new URLSearchParams({ source: 'mcp', video_lang: 'en', my_lang: 'zh' });
  if (pending) q.set('pending_id', pending);
  return 'belliedmonkey://agent/v1/start_live_subtitles?' + q.toString();
}

function runWith(client, decision, extra) {
  const ports = [];
  const shown = [];
  const cards = [];
  return session.handleAgentUrl(deepLink(extra && extra.pending === false ? '' : PENDING), {
    scheme: 'belliedmonkey',
    readiness: Object.assign({}, READY, (extra && extra.readiness) || {}),
    grants: (extra && extra.grants) || { device: {}, assistants: {} },
    deviceBridge: client,
    ports: {
      enterSubtitle(req) { ports.push(req); return { ok: true }; },
    },
  }, {
    confirm(card) { cards.push(card); return decision; },
    show(receipt) { shown.push(receipt); },
  }).then((receipt) => ({ receipt, ports, shown, cards }));
}

describe('BEL-151 GAP-2: pending_id rides the action deep link', () => {
  test('pending_id is parsed as an opaque transport token, malformed values drop', () => {
    eq(parse.pendingIdOf('pnd_0123456789abcdef'), 'pnd_0123456789abcdef');
    eq(parse.pendingIdOf('  pnd-1:a.b_c  '), 'pnd-1:a.b_c');
    eq(parse.pendingIdOf(''), '');
    eq(parse.pendingIdOf(null), '');
    eq(parse.pendingIdOf('bad id'), '');
    eq(parse.pendingIdOf('x'.repeat(257)), '');
    eq(parse.pendingIdOf('p\n1'), '');
  });
});

describe('BEL-151 GAP-2: allow / deny callback', () => {
  test('allow POSTs pending_id + decision:allow + device_cred to the configured path', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true, state: 'resumed' }));
    const out = await runWith(client, { allow: true });

    eq(rec.calls.length, 1);
    const call = rec.calls[0];
    eq(call.url, CONFIRM);
    eq(call.init.method, 'POST');
    eq(call.init.headers.Authorization, 'Bearer mcp-access-token');
    const body = bodyOf(call);
    eq(body.pending_id, PENDING);
    eq(body.decision, 'allow');
    eq(body.device_id, UUID);
    eq(body.device_cred, 'dc-app-test');
    eq(out.receipt.code, 'ok');
    eq(out.receipt.message, '已打开实时双语字幕。点「开始」后才会使用麦克风。');
    eq(out.ports.length, 1, 'allow still opens the local subtitle surface');
    eq(out.ports[0].action, 'start_live_subtitles');
    deepEq(await client.pendingIds(), []);
  });

  test('deny POSTs decision:deny, opens nothing, and clears the local pending', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true, state: 'cancelled' }));
    const out = await runWith(client, { allow: false });

    eq(rec.calls.length, 1);
    eq(rec.calls[0].url, CONFIRM);
    eq(bodyOf(rec.calls[0]).decision, 'deny');
    eq(bodyOf(rec.calls[0]).pending_id, PENDING);
    eq(out.receipt.code, 'cancelled');
    eq(out.ports.length, 0, 'deny never opens the subtitle surface');
    deepEq(await client.pendingIds(), []);
  });

  test('a local gate still sends deny for the Worker pending before showing the gate', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }));
    const out = await runWith(client, { allow: true }, { readiness: { packs: false } });

    eq(rec.calls.length, 1);
    eq(bodyOf(rec.calls[0]).decision, 'deny');
    eq(out.receipt.code, 'need_packs');
    eq(out.ports.length, 0);
    deepEq(await client.pendingIds(), []);
  });

  test('allow callback failure is a §6 failure receipt, never openedSubtitles', async () => {
    const { rec, client } = clientWith(() => response(503, { ok: false }));
    const out = await runWith(client, { allow: true });

    eq(rec.calls.length, 1);
    eq(out.receipt.code, 'network_unavailable');
    eq(out.receipt.ok, false);
    ok(!String(out.receipt.message).includes('已打开实时双语字幕'));
    eq(out.ports.length, 0, 'no local surface when the decision never reached the Worker');
    deepEq(await client.pendingIds(), []);
  });

  test('a remembered device grant does not auto-answer a Worker pending', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }));
    const out = await runWith(client, { allow: true }, {
      grants: { device: { start_live_subtitles: true }, assistants: {} },
    });
    eq(out.cards.length, 1, 'the pending still needs a fresh on-device decision');
    eq(rec.calls.length, 1);
    eq(bodyOf(rec.calls[0]).decision, 'allow');
    eq(out.receipt.code, 'ok');
  });

  test('an unsupported action carrying a pending still closes it with deny', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }));
    const shown = [];
    const receipt = await session.handleAgentUrl(
      'belliedmonkey://agent/v1/not_a_tool?source=mcp&pending_id=' + PENDING,
      { scheme: 'belliedmonkey', readiness: READY, deviceBridge: client },
      { confirm() { return { allow: true }; }, show(r) { shown.push(r); } });
    eq(receipt.code, 'unsupported_action');
    eq(rec.calls.length, 1);
    eq(bodyOf(rec.calls[0]).decision, 'deny');
    eq(shown.length, 1);
  });

  test('no pending_id keeps the existing local-surface path and sends no callback', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }));
    const out = await runWith(client, { allow: true }, { pending: false });

    eq(rec.calls.length, 0);
    eq(out.receipt.code, 'ok');
    eq(out.ports.length, 1);
  });
});

describe('BEL-151 GAP-2: local pending is cleared by disconnect / revoke / 401', () => {
  test('an invalid pending_id is bad_request and sends nothing', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }));
    const out = await client.confirm({ pending_id: 'bad id', decision: 'allow' });
    eq(out.code, 'bad_request');
    eq(rec.calls.length, 0);
  });

  test('no device_cred = not_paired, no HTTP, local pending cleared', async () => {
    const { rec, client } = clientWith(() => response(200, { ok: true }), {
      seed: { device_cred: null },
    });
    client.rememberPending({ pending_id: PENDING, action: 'start_live_subtitles' });
    deepEq(await client.pendingIds(), [PENDING]);
    const out = await client.confirm({ pending_id: PENDING, decision: 'allow' });
    eq(out.ok, false);
    eq(out.code, 'not_paired');
    eq(rec.calls.length, 0);
    deepEq(await client.pendingIds(), []);
  });

  test('401 clears device_cred and every local pending row', async () => {
    const { store, client } = clientWith(() => response(401, { ok: false, error: 'unauthorized' }));
    client.rememberPending({ pending_id: 'p_a' });
    client.rememberPending({ pending_id: 'p_b' });
    eq((await client.pendingIds()).length, 2);

    const out = await client.confirm({ pending_id: 'p_a', decision: 'allow' });
    eq(out.code, 'unauthorized');
    eq(store.getItem('device_cred'), null);
    deepEq(await client.pendingIds(), []);
  });

  test('revoke / disconnect clears the local pending before the cloud answers', async () => {
    const { client } = clientWith(() => response(200, { ok: true, revoked: true }));
    client.rememberPending({ pending_id: PENDING });
    deepEq(await client.pendingIds(), [PENDING]);
    const out = await client.revoke();
    eq(out.revoked, true);
    deepEq(await client.pendingIds(), []);
    eq(client.hasCred(), false);
  });

  test('clearLocalCred clears pending even when no HTTP ever runs', async () => {
    const { client } = clientWith(() => response(200, { ok: true }));
    client.rememberPending({ pending_id: PENDING });
    client.clearLocalCred();
    deepEq(await client.pendingIds(), []);
  });

  test('the frozen confirm path is the default for intl and china, still overridable', async () => {
    eq(bridge.PATHS.confirm, '/api/mcp/device-sessions/confirm');

    const intl = clientWith(() => response(200, { ok: true }));
    eq((await intl.client.confirm({ pending_id: PENDING, decision: 'deny' })).ok, true);
    eq(intl.rec.calls[0].url,
      'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/confirm');

    const china = clientWith(() => response(200, { ok: true }), {
      options: { flavor: 'china' },
    });
    eq((await china.client.confirm({ pending_id: PENDING, decision: 'deny' })).ok, true);
    eq(china.rec.calls[0].url,
      'https://mcp.belliedmonkey.com/api/mcp/device-sessions/confirm');

    const override = clientWith(() => response(200, { ok: true }), {
      options: { paths: { confirm: '/api/mcp/device-sessions/confirm-alt' } },
    });
    eq((await override.client.confirm({ pending_id: PENDING, decision: 'deny' })).ok, true);
    eq(override.rec.calls[0].url,
      'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/confirm-alt');
  });
});
