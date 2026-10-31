#!/usr/bin/env node
// mocks/hosted-gateway/server.js — public mock of contracts/hosted-gateway.v0.yaml.
//
// Zero dependencies. This is the ONLY hosted-gateway implementation in the public repo:
// the real gateway (relay / grant / ledger / ingest / account deletion) lives in the
// private `*-hosted` repository. CI and local development hit this mock.
//
// Security discipline mirrored from the real relay:
//   · never log or echo request bodies (they may contain user text),
//   · reject a BYOK provider key in the body with 400 before "forwarding",
//   · responses carry no upstream credentials.
//
// Run:    node mocks/hosted-gateway/server.js [--port 8787]
// Test:   npm test  (test/contract-mock.test.js)
'use strict';

const http = require('http');

const TOKEN_PREFIX = 'bmg_test_';
const UPSTREAM_KEY_FIELDS = ['upstream_api_key', 'provider_api_key', 'api_key', 'openai_api_key', 'anthropic_api_key'];
const MODELS = ['deepseek/deepseek-v4-flash'];
const LEGACY_RELAY = /^\/functions\/v1\/bt-relay\/(chat\/completions|audio\/speech|audio\/transcriptions)$/;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Mock': 'hosted-gateway-v0',
  });
  res.end(text);
}

function tokenOf(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function authorized(req) {
  return tokenOf(req).startsWith(TOKEN_PREFIX);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(raw));
    req.on('error', () => resolve(''));
  });
}

// A request must not carry a user provider key: BYOK never transits the hosted gateway.
function carriesByokKey(value, depth = 0) {
  if (depth > 6 || value == null) return false;
  if (typeof value === 'string') return /^sk-[A-Za-z0-9_-]{12,}/.test(value);
  if (Array.isArray(value)) return value.some((v) => carriesByokKey(v, depth + 1));
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (UPSTREAM_KEY_FIELDS.includes(k.toLowerCase())) return true;
      if (carriesByokKey(v, depth + 1)) return true;
    }
  }
  return false;
}

function createServer(opts = {}) {
  const state = {
    remaining: typeof opts.balance === 'number' ? opts.balance : 0.2,
    unit: opts.unit || 'usd',
    product: opts.product || 'free',
    idempotency: new Map(),
    requests: 0,
  };

  function balance() {
    return { remaining: Number(state.remaining.toFixed(6)), unit: state.unit, resets_at: null, product: state.product };
  }

  async function handler(req, res) {
    state.requests += 1;
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const url = new URL(req.url, 'http://mock.local');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/healthz') return json(res, 200, { ok: true });

    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && (p === '/v0/grant/balance' || p === '/functions/v1/bt-relay/balance')) {
      return json(res, 200, balance());
    }

    if (req.method === 'GET' && p === '/v0/models') return json(res, 200, { models: MODELS });

    if (req.method === 'POST' && p === '/v0/grant/consume') {
      const key = String(req.headers['idempotency-key'] || '');
      if (key.length < 8) return json(res, 400, { error: 'idempotency_key_required' });
      if (state.idempotency.has(key)) {
        const prev = state.idempotency.get(key);
        return json(res, 200, { consumed: prev.consumed, remaining: prev.remaining, replayed: true });
      }
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad_json' }); }
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'bad_amount' });
      if (amount > state.remaining) return json(res, 429, { error: 'credit_exhausted' });
      state.remaining -= amount;
      const out = { consumed: amount, remaining: Number(state.remaining.toFixed(6)), replayed: false };
      state.idempotency.set(key, out);
      return json(res, 200, out);
    }

    const isRelay = (req.method === 'POST' && p === '/v0/relay') || (req.method === 'POST' && LEGACY_RELAY.test(p));
    if (isRelay) {
      const raw = await readBody(req);
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad_json' }); }
      if (body && typeof body === 'object' && carriesByokKey(body)) {
        // Do not echo the key, and do not "forward" anything.
        return json(res, 400, { error: 'byok_key_rejected', detail: 'BYOK requests must go directly to the provider' });
      }
      if (!body || typeof body.model !== 'string' || !MODELS.includes(body.model)) {
        return json(res, 403, { error: 'model_not_allowed', model: MODELS[0] });
      }
      if (/audio\/speech$/.test(p)) {
        const audio = Buffer.from('ID3mock-audio');
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'X-Mock': 'hosted-gateway-v0' });
        return res.end(audio);
      }
      return json(res, 200, {
        id: 'mock-completion',
        object: 'chat.completion',
        model: MODELS[0],
        choices: [{ index: 0, message: { role: 'assistant', content: 'mock' }, finish_reason: 'stop' }],
        usage: { total_tokens: 1, cost: 0.0005 },
      });
    }

    if (req.method === 'POST' && p === '/v0/telemetry/ingest') {
      await readBody(req);
      return json(res, 200, { accepted: 0, rejected: [], mock: true });
    }

    if (req.method === 'POST' && p === '/v0/account/delete') {
      return json(res, 200, { deleted: 'mock-user', grant: false, mock: true });
    }

    return json(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'mock_error' });
    });
  });
  return { server, state };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--port');
  const port = i >= 0 ? Number(args[i + 1]) : Number(process.env.PORT || 8787);
  const { server } = createServer();
  server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    console.log(`hosted-gateway mock listening=http://127.0.0.1:${p}`);
    console.log(`try: GET http://127.0.0.1:${p}/v0/grant/balance with the test bearer token (see README)`);
  });
}

if (require.main === module) main();

module.exports = { createServer, carriesByokKey, MODELS, TOKEN_PREFIX };
