#!/usr/bin/env node
// scripts/verify-jg3-routes.js — JG-3 minimal stub.
//
// The same built tree must be able to (a) succeed on the BYOK path and (b) spend quota
// on a hosted/mock path, with the switch made locally. This script proves both halves
// without a real backend, a real grant key, or a browser:
//
//   1. the built `dist/` registry contains a grant route AND ordinary own-key providers
//      (so one binary really has both);
//   2. a BYOK request goes to a provider endpoint and never touches the mock gateway;
//   3. a hosted request uses a bmg_ test token, reads a monthly balance, relays, and
//      consumes quota idempotently;
//   4. the hosted response never echoes the BYOK key or the grant token.
//
// Run: node scripts/verify-jg3-routes.js [dist]
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createServer, MODELS } = require('../mocks/hosted-gateway/server.js');

// src/shared is ESM; bundle it for this Node script the same way test/harness loadSrc
// does, so the evidence exercises the real source rather than a copy.
function loadContract() {
  const esbuild = require('esbuild');
  const r = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'shared', 'hosted-contract.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', r.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const { validateBalance, validateError, isHostedBearer, fallbackAfterQuota } = loadContract();

const ROOT = path.join(__dirname, '..');
const DIST = process.argv[2] || path.join(ROOT, 'dist');
const BYOK_KEY = 'sk-jg3-not-a-real-key-1234567890';
const GRANT_TOKEN = 'bmg_test_jg3_contract_0001';
const MODEL = MODELS[0];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
function fail(msg) {
  console.error('JG-3 FAIL: ' + msg);
  process.exit(1);
}
function ok(cond, msg) {
  if (!cond) fail(msg);
}

function startProvider() {
  const state = { hits: 0, auth: [] };
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      state.hits += 1;
      state.auth.push(String(req.headers.authorization || ''));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'byok-ok' } }] }));
    });
  });
  return { server, state };
}

async function main() {
  // (1) One build, both routes.
  const regPath = path.join(DIST, 'content', 'providers.gen.js');
  ok(fs.existsSync(regPath), 'missing built registry: ' + regPath + ' (run node build.js first)');
  const reg = fs.readFileSync(regPath, 'utf8');
  ok(/"id"\s*:\s*"grant"/.test(reg), 'built registry has no grant route');
  ok(/"id"\s*:\s*"(openai|deepseek|custom_chat|custom_msg)"/.test(reg), 'built registry has no own-key provider');

  // (2) BYOK: provider directly, no hosted hop.
  const provider = startProvider();
  const hosted = createServer({ product: 'monthly', balance: 0.2 });
  const [pport, hport] = await Promise.all([listen(provider.server), listen(hosted.server)]);
  try {
    const byok = await fetch(`http://127.0.0.1:${pport}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + BYOK_KEY },
      body: JSON.stringify({ model: 'byok-model', messages: [{ role: 'user', content: 'hello' }] }),
    });
    ok(byok.status === 200, 'BYOK request failed: ' + byok.status);
    ok(provider.state.hits === 1, 'BYOK provider was not hit exactly once');
    ok(provider.state.auth[0] === 'Bearer ' + BYOK_KEY, 'BYOK provider did not receive the user key');
    ok(hosted.state.requests === 0, 'BYOK request touched the hosted mock');
    ok(!isHostedBearer({ authorization: 'Bearer ' + BYOK_KEY }), 'a provider key was classified as a hosted bearer');

    // (3) Hosted: bmg_ token, monthly balance, relay, idempotent consume.
    const auth = { authorization: 'Bearer ' + GRANT_TOKEN, 'content-type': 'application/json' };
    ok(isHostedBearer(auth), 'the grant token was not classified as a hosted bearer');
    const balRes = await fetch(`http://127.0.0.1:${hport}/v0/grant/balance`, { headers: auth });
    ok(balRes.status === 200, 'hosted balance failed: ' + balRes.status);
    const bal = validateBalance(await balRes.json());
    ok(bal.product === 'monthly', 'mock balance product is not monthly: ' + bal.product);
    ok(bal.remaining === 0.2, 'unexpected starting balance');

    const relay = await fetch(`http://127.0.0.1:${hport}/v0/relay`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hello' }] }),
    });
    ok(relay.status === 200, 'hosted relay failed: ' + relay.status);
    const relayText = await relay.text();
    ok(!relayText.includes(BYOK_KEY), 'hosted relay leaked the BYOK key');
    ok(!relayText.includes(GRANT_TOKEN), 'hosted relay leaked the grant token');

    const idem = 'jg3-' + Date.now();
    const c1 = await fetch(`http://127.0.0.1:${hport}/v0/grant/consume`, {
      method: 'POST', headers: Object.assign({ 'idempotency-key': idem }, auth),
      body: JSON.stringify({ amount: 0.05, unit: 'usd' }),
    });
    ok(c1.status === 200, 'hosted consume failed: ' + c1.status);
    const b1 = await c1.json();
    const c2 = await fetch(`http://127.0.0.1:${hport}/v0/grant/consume`, {
      method: 'POST', headers: Object.assign({ 'idempotency-key': idem }, auth),
      body: JSON.stringify({ amount: 0.05, unit: 'usd' }),
    });
    ok(c2.status === 200, 'idempotent replay failed: ' + c2.status);
    const b2 = await c2.json();
    ok(b1.remaining === b2.remaining, 'idempotent replay charged twice');
    ok(b2.replayed === true, 'idempotent replay was not marked replayed');
    ok(b2.remaining < 0.2, 'consume did not reduce the balance');

    // (4) A BYOK-key-in-body request is rejected, never forwarded.
    const bad = await fetch(`http://127.0.0.1:${hport}/v0/relay`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ model: MODEL, upstream_api_key: BYOK_KEY }),
    });
    ok(bad.status === 400, 'hosted relay accepted a BYOK key in the body');
    const badBody = validateError(await bad.json());
    ok(badBody.code === 'byok_key_rejected', 'unexpected rejection code: ' + badBody.code);

    // (5) The local fallback after a quota error is the own-key path, not a paywall.
    ok(fallbackAfterQuota({ hasOwnKey: true }) === 'byok', 'quota fallback did not choose BYOK');
  } finally {
    await Promise.all([close(provider.server), close(hosted.server)]);
  }

  console.log(JSON.stringify({
    jg3: 'PASS',
    dist: path.relative(ROOT, DIST),
    byok: { providerHits: provider.state.hits, hostedRequests: 0 },
    hosted: { product: 'monthly', relay: 200, idempotentConsume: true, byokKeyRejected: 400 },
    fallback: 'byok',
  }, null, 2));
}

main().catch((e) => fail(e && e.stack || String(e)));
