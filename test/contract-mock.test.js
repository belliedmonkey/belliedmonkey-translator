// test/contract-mock.test.js — P0 E5: contract v0 + mock are coherent and runnable.
//
// The public repo must be able to prove the hosted-gateway *contract* without the
// implementation (which moved to the private hosted repo). This starts the public mock
// and exercises the CONTRACT-v0 §0 axioms: 401 without a token, balance shape, relay
// 200/401, BYOK keys rejected and never echoed, idempotent consume, legacy aliases.
//
// It also reads contracts/hosted-gateway.v0.yaml and asserts the endpoints the mock
// implements are actually in the contract — a mock for a path nobody published is drift.

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CONTRACT = path.join(ROOT, 'contracts', 'hosted-gateway.v0.yaml');
const { createServer, MODELS } = require(path.join(ROOT, 'mocks', 'hosted-gateway', 'server.js'));

const TOKEN = 'Bearer bmg_test_contract';
const jsonHeaders = { Authorization: TOKEN, 'Content-Type': 'application/json' };

function withServer(fn) {
  return async () => {
    const { server, state } = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try { await fn(base, state); } finally { await new Promise((r) => server.close(r)); }
  };
}

describe('contract v0 — mock conformance (E5)', () => {
  test('contract file exists and lists every path the mock serves', () => {
    const src = fs.readFileSync(CONTRACT, 'utf8');
    for (const p of ['/v0/grant/balance', '/v0/grant/consume', '/v0/relay', '/v0/models',
      '/v0/telemetry/ingest', '/v0/account/delete',
      '/functions/v1/bt-relay/chat/completions', '/functions/v1/bt-relay/audio/speech',
      '/functions/v1/bt-relay/balance']) {
      ok(src.includes(p + ':'), `contract is missing ${p}`);
    }
    ok(/securitySchemes:[\s\S]*bearerAuth:/.test(src), 'contract has no bearerAuth scheme');
    ok(/BYOK/.test(src), 'contract does not state the BYOK axiom');
    ok(!/sk-[A-Za-z0-9]{20,}/.test(src), 'contract contains something that looks like a real key');
  });

  test('balance: 401 without a token, 200 with one', withServer(async (base) => {
    const no = await fetch(`${base}/v0/grant/balance`);
    eq(no.status, 401);
    const yes = await fetch(`${base}/v0/grant/balance`, { headers: { Authorization: TOKEN } });
    eq(yes.status, 200);
    const body = await yes.json();
    for (const k of ['remaining', 'unit', 'resets_at', 'product']) ok(k in body, `balance missing ${k}`);
    eq(body.unit, 'usd');
  }));

  test('relay: 401 without a token, 200 with one, model pinned', withServer(async (base) => {
    const no = await fetch(`${base}/v0/relay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    eq(no.status, 401);
    const yes = await fetch(`${base}/v0/relay`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ model: MODELS[0], messages: [{ role: 'user', content: 'hi' }] }),
    });
    eq(yes.status, 200);
    const text = await yes.text();
    ok(!/sk-[A-Za-z0-9_-]{12,}/.test(text), 'relay response leaks a key-shaped string');
    ok(!/upstream_api_key/.test(text), 'relay response leaks upstream key metadata');
    const bad = await fetch(`${base}/v0/relay`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ model: 'not-entitled/model' }),
    });
    eq(bad.status, 403, 'an unpinned model must be refused, not silently forwarded');
  }));

  test('BYOK key in the body is rejected with 400 and never echoed', withServer(async (base) => {
    const key = 'sk-test-NOT-A-REAL-KEY-123456';
    const r = await fetch(`${base}/v0/relay`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ model: MODELS[0], upstream_api_key: key }),
    });
    eq(r.status, 400);
    const text = await r.text();
    ok(!text.includes(key), 'the mock echoed the BYOK key back');
    eq(JSON.parse(text).error, 'byok_key_rejected');
  }));

  test('grant consume is idempotent on Idempotency-Key', withServer(async (base) => {
    const body = JSON.stringify({ amount: 0.01 });
    const a = await fetch(`${base}/v0/grant/consume`, {
      method: 'POST', headers: { ...jsonHeaders, 'Idempotency-Key': 'idem-contract-0001' }, body,
    });
    eq(a.status, 200);
    const first = await a.json();
    const b = await fetch(`${base}/v0/grant/consume`, {
      method: 'POST', headers: { ...jsonHeaders, 'Idempotency-Key': 'idem-contract-0001' }, body,
    });
    eq(b.status, 200);
    const second = await b.json();
    eq(second.remaining, first.remaining, 'a replayed idempotency key must not charge twice');
    eq(second.replayed, true);
    const noKey = await fetch(`${base}/v0/grant/consume`, { method: 'POST', headers: jsonHeaders, body });
    eq(noKey.status, 400, 'consume without Idempotency-Key must be refused');
  }));

  test('legacy bt-relay aliases answer during the v0 window', withServer(async (base) => {
    const b = await fetch(`${base}/functions/v1/bt-relay/balance`, { headers: { Authorization: TOKEN } });
    eq(b.status, 200);
    const c = await fetch(`${base}/functions/v1/bt-relay/chat/completions`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ model: MODELS[0], messages: [{ role: 'user', content: 'hi' }] }),
    });
    eq(c.status, 200);
  }));

  test('the mock never needs a network or a real credential', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mocks', 'hosted-gateway', 'server.js'), 'utf8');
    ok(!/service_role|GRANT_KEK|sk-or-/i.test(src), 'mock mentions a real credential family');
    ok(!/https?:\/\/(?!(127\.0\.0\.1|mock\.local))/.test(src.replace(/https:\/\/hosted\.invalid/g, '')),
      'mock should not call a real host');
  });
});
