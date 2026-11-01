#!/usr/bin/env node
// mocks/hosted-gateway/selftest.mjs — ACCEPT-C-1 gate for contract v0.1 + mock.
//
// Starts the public mock on an ephemeral port and exercises every v0.1 addition:
// billing plans/checkout/portal, balance product, idempotent consume, BYOK-400,
// 402 fallback copy, sync GET/PUT with ETag/conflict, account export/delete.
// Zero dependencies; no network beyond 127.0.0.1.
//
// Run: node mocks/hosted-gateway/selftest.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createServer, MODELS } = require('./server.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT = path.join(ROOT, 'contracts', 'hosted-gateway.v0.1.yaml');

const TOKEN = 'Bearer bmg_test_contract';
const H = { Authorization: TOKEN, 'Content-Type': 'application/json' };
let pass = 0;
const failures = [];

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

const src = fs.readFileSync(CONTRACT, 'utf8');
const { server, state } = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const j = (r) => r.json();

await check('contract v0.1 lists C-1 paths', () => {
  for (const p of [
    '/v0/billing/checkout:', '/v0/billing/portal:', '/v0/billing/plans:',
    '/v0/grant/balance:', '/v0/grant/consume:', '/v0/relay:',
    '/v0/sync/{collection}:', '/v0/account/delete:', '/v0/account/export:',
  ]) ok(src.includes(p), `missing ${p}`);
  ok(src.includes('version: 0.1.0'), 'wrong contract version');
  ok(/product: \{ type: string, enum: \[free, monthly, yearly\] \}/.test(src), 'balance product enum drift');
  ok(!/stripe_secret|sk_live_|sk_test_/.test(src), 'contract contains payment secret material');
  ok(!src.includes('/webhook'), 'webhook must not be in the public contract');
});

await check('plans: enterprise is a grayscale placeholder, not purchasable', async () => {
  const r = await fetch(`${base}/v0/billing/plans`);
  eq(r.status, 200);
  const b = await j(r);
  const ent = b.plans.find((p) => p.id === 'enterprise');
  eq(ent.available, false);
  eq(ent.status, 'coming_soon');
  eq(ent.grayscale, true);
  eq(ent.cta, null);
  eq(b.enterprise_api, false);
  const buy = await fetch(`${base}/v0/billing/checkout`, {
    method: 'POST', headers: H, body: JSON.stringify({ product: 'enterprise' }),
  });
  eq(buy.status, 400);
});

await check('checkout monthly + yearly, portal, balance product', async () => {
  const m = await fetch(`${base}/v0/billing/checkout`, {
    method: 'POST', headers: H, body: JSON.stringify({ product: 'monthly', flavor: 'global' }),
  });
  eq(m.status, 200);
  const mb = await j(m);
  eq(mb.product, 'monthly');
  eq(mb.mode, 'subscription');
  eq(mb.flavor, 'global');
  ok(/^http:\/\/mock\.local\//.test(mb.url), 'checkout URL must be mock-hosted');
  ok(!/secret|sk_/.test(JSON.stringify(mb)), 'checkout response leaked a secret');

  const bal = await j(await fetch(`${base}/v0/grant/balance`, { headers: { Authorization: TOKEN } }));
  eq(bal.product, 'monthly');
  eq(bal.unit, 'usd');
  ok(bal.remaining > 0, 'monthly balance must be visible');

  const p = await fetch(`${base}/v0/billing/portal`, { headers: { Authorization: TOKEN } });
  eq(p.status, 200);
  const pb = await j(p);
  ok(/^http:\/\/mock\.local\/portal\//.test(pb.url), 'portal URL must be mock-hosted');

  const y = await fetch(`${base}/v0/billing/checkout`, {
    method: 'POST', headers: H, body: JSON.stringify({ product: 'yearly', flavor: 'china' }),
  });
  eq(y.status, 200);
  const yb = await j(y);
  eq(yb.product, 'yearly');
  eq(yb.flavor, 'china');
  const bal2 = await j(await fetch(`${base}/v0/grant/balance`, { headers: { Authorization: TOKEN } }));
  eq(bal2.product, 'yearly');
  ok(bal2.remaining > bal.remaining, 'yearly allowance should be larger than monthly');
});

await check('consume is idempotent and 402 carries BYOK fallback copy', async () => {
  const body = JSON.stringify({ amount: 0.01, unit: 'usd' });
  const a = await j(await fetch(`${base}/v0/grant/consume`, {
    method: 'POST', headers: { ...H, 'Idempotency-Key': 'idem-c1-0001' }, body,
  }));
  const b = await j(await fetch(`${base}/v0/grant/consume`, {
    method: 'POST', headers: { ...H, 'Idempotency-Key': 'idem-c1-0001' }, body,
  }));
  eq(b.remaining, a.remaining);
  eq(b.replayed, true);
  eq(a.replayed, false);
  const noKey = await fetch(`${base}/v0/grant/consume`, { method: 'POST', headers: H, body });
  eq(noKey.status, 400);
  const big = await fetch(`${base}/v0/grant/consume`, {
    method: 'POST', headers: { ...H, 'Idempotency-Key': 'idem-c1-big' },
    body: JSON.stringify({ amount: 999999 }),
  });
  eq(big.status, 402);
  const bb = await j(big);
  eq(bb.fallback, 'byok');
  ok(/BYOK/.test(bb.message), '402 copy must mention BYOK');
});

await check('relay rejects a BYOK key with 400 and never echoes it', async () => {
  const key = 'sk-test-NOT-A-REAL-KEY-123456';
  const r = await fetch(`${base}/v0/relay`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ model: MODELS[0], upstream_api_key: key }),
  });
  eq(r.status, 400);
  const text = await r.text();
  ok(!text.includes(key), 'mock echoed the BYOK key');
  eq(JSON.parse(text).error, 'byok_key_rejected');
  const auth = await fetch(`${base}/v0/relay`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ model: MODELS[0], authorization: 'Bearer sk-test-NOT-A-REAL-KEY-123456' }),
  });
  eq(auth.status, 400);
  const good = await fetch(`${base}/v0/relay`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ model: MODELS[0], input: { text: 'hi' } }),
  });
  eq(good.status, 200);
  const gt = await good.text();
  ok(!/sk-[A-Za-z0-9_-]{12,}/.test(gt), 'relay response leaks a key-shaped string');
  ok(!/upstream_api_key|api_key/.test(gt), 'relay response leaks key metadata');
});

await check('sync: PUT/GET settings + session-meta, ETag, 409 conflict, BYOK-400', async () => {
  const missing = await fetch(`${base}/v0/sync/settings`, { headers: { Authorization: TOKEN } });
  eq(missing.status, 404);

  const put1 = await fetch(`${base}/v0/sync/settings`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ data: { theme: 'dark', lang: 'zh-CN' } }),
  });
  eq(put1.status, 200);
  const e1 = put1.headers.get('etag');
  eq(e1, '"v1"');
  const row1 = await j(put1);
  eq(row1.version, 1);

  const get1 = await fetch(`${base}/v0/sync/settings`, { headers: { Authorization: TOKEN } });
  eq(get1.status, 200);
  eq(get1.headers.get('etag'), e1);
  eq((await j(get1)).data.theme, 'dark');

  const conflict = await fetch(`${base}/v0/sync/settings`, {
    method: 'PUT', headers: { ...H, 'If-Match': '"v0"' },
    body: JSON.stringify({ data: { theme: 'light' } }),
  });
  eq(conflict.status, 409);
  eq(conflict.headers.get('etag'), e1);

  const put2 = await fetch(`${base}/v0/sync/settings`, {
    method: 'PUT', headers: { ...H, 'If-Match': e1 },
    body: JSON.stringify({ data: { theme: 'light' } }),
  });
  eq(put2.status, 200);
  eq(put2.headers.get('etag'), '"v2"');

  const meta = await fetch(`${base}/v0/sync/session-meta`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ data: { lastSession: 's-42', scroll: { page: 3 } } }),
  });
  eq(meta.status, 200);
  eq((await j(meta)).collection, 'session-meta');

  const leak = await fetch(`${base}/v0/sync/settings`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ data: { api_key: 'sk-test-NOT-A-REAL-KEY-123456' } }),
  });
  eq(leak.status, 400);
  const lt = await leak.text();
  ok(!lt.includes('sk-test-NOT-A-REAL-KEY-123456'), 'sync error echoed the key');
  eq(JSON.parse(lt).error, 'byok_key_rejected');

  const bad = await fetch(`${base}/v0/sync/api_key`, {
    method: 'PUT', headers: H, body: JSON.stringify({ data: { a: 1 } }),
  });
  eq(bad.status, 400);
});

await check('account export/delete stay hosted and carry no secrets', async () => {
  const exp = await fetch(`${base}/v0/account/export`, { headers: { Authorization: TOKEN } });
  eq(exp.status, 200);
  eq(exp.headers.get('content-disposition'), 'attachment; filename="hosted-export.json"');
  const ex = await j(exp);
  ok(ex.user_id && ex.entitlement && Array.isArray(ex.ledger) && ex.sync, 'export shape incomplete');
  ok(!/sk-|secret|upstream_api_key/i.test(JSON.stringify(ex)), 'export leaked secret material');

  const del = await fetch(`${base}/v0/account/delete`, { method: 'POST', headers: H });
  eq(del.status, 200);
  const db = await j(del);
  ok(db.deleted && typeof db.sync === 'number', 'delete response incomplete');
  const after = await j(await fetch(`${base}/v0/grant/balance`, { headers: { Authorization: TOKEN } }));
  eq(after.product, 'free');
});

await new Promise((r) => server.close(r));
console.log(`\nC-1 MOCK GATE: ${failures.length ? 'FAIL' : 'PASS'} (${pass} passed, ${failures.length} failed)`);
if (failures.length) {
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
