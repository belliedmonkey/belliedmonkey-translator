#!/usr/bin/env node
// mocks/hosted-gateway/server.js — public mock of contracts/hosted-gateway.v0.1.yaml.
//
// Zero dependencies. This is the ONLY hosted-gateway implementation in the public repo:
// the real gateway (relay / grant / ledger / billing / sync / ingest / account deletion)
// lives in the private `*-hosted` repository. CI and local development hit this mock.
//
// Security discipline mirrored from the real relay:
//   · never log or echo request bodies (they may contain user text),
//   · reject a BYOK provider key in the body with 400 before "forwarding",
//   · responses carry no upstream credentials or payment secrets.
//
// The mock intentionally completes a checkout instantly (sets product/balance) so the
// balance path is testable without a payment processor. The real gateway waits for a
// signed webhook from its hosted billing rail; webhook handling is not public.
//
// Run:    node mocks/hosted-gateway/server.js [--port 8787]
// Test:   node mocks/hosted-gateway/selftest.mjs
'use strict';

const http = require('http');

const TOKEN_PREFIX = 'bmg_test_';
const UPSTREAM_KEY_FIELDS = [
  'upstream_api_key', 'provider_api_key', 'api_key', 'openai_api_key',
  'anthropic_api_key', 'authorization', 'x-api-key',
];
const MODELS = ['deepseek/deepseek-v4-flash'];
const LEGACY_RELAY = /^\/functions\/v1\/bt-relay\/(chat\/completions|audio\/speech|audio\/transcriptions)$/;
const SYNC_COLLECTIONS = ['settings', 'session-meta'];
const PLAN_ALLOWANCE = { monthly: 5, yearly: 60 };
const PLANS = {
  free: { id: 'free', available: true, status: 'available', currency: 'usd', amount: 0, interval: 'none' },
  monthly: { id: 'monthly', available: true, status: 'available', currency: 'usd', amount: 9.99, interval: 'month' },
  yearly: { id: 'yearly', available: true, status: 'available', currency: 'usd', amount: 79.99, interval: 'year' },
  enterprise: {
    id: 'enterprise', available: false, status: 'coming_soon', currency: 'usd',
    amount: 0, interval: 'seat', label: 'Enterprise — 即将推出 / Coming soon',
    grayscale: true, cta: null,
  },
};
const PLAN_LIST = [PLANS.free, PLANS.monthly, PLANS.yearly, PLANS.enterprise];

function json(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key, if-match, apikey',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'X-Mock': 'hosted-gateway-v0.1',
    ...extraHeaders,
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
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') return /(^|\s)sk-[A-Za-z0-9_-]{12,}/.test(value);
  if (Array.isArray(value)) return value.some((v) => carriesByokKey(v, depth + 1));
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (UPSTREAM_KEY_FIELDS.includes(k.toLowerCase())) return true;
      if (carriesByokKey(v, depth + 1)) return true;
    }
  }
  return false;
}

function etag(v) { return `"v${v}"`; }

function createServer(opts = {}) {
  const state = {
    remaining: typeof opts.balance === 'number' ? opts.balance : 0.2,
    unit: opts.unit || 'usd',
    product: opts.product || 'free',
    customer: opts.customer || null,
    subscription: opts.subscription || null,
    idempotency: new Map(),
    sync: new Map(),
    ledger: [],
    requests: 0,
    sessionSeq: 0,
  };

  function balance() {
    return {
      remaining: Number(state.remaining.toFixed(6)),
      unit: state.unit,
      resets_at: null,
      product: state.product,
    };
  }

  function consume(amount, key, kind) {
    if (state.idempotency.has(key)) {
      const prev = state.idempotency.get(key);
      return { status: 200, body: { consumed: prev.consumed, remaining: prev.remaining, replayed: true } };
    }
    if (amount > state.remaining) {
      return {
        status: 402,
        body: {
          error: 'credit_exhausted',
          fallback: 'byok',
          message: '额度已用完。可在设置中改用自带 API Key（BYOK），请求会直连供应商。',
        },
      };
    }
    state.remaining -= amount;
    const out = { consumed: amount, remaining: Number(state.remaining.toFixed(6)), replayed: false };
    state.idempotency.set(key, out);
    state.ledger.push({ kind, amount, remaining: out.remaining, at: new Date().toISOString() });
    return { status: 200, body: out };
  }

  async function handler(req, res) {
    state.requests += 1;
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const url = new URL(req.url, 'http://mock.local');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/healthz') return json(res, 200, { ok: true, contract: 'v0.1' });

    // Public pricing page. Enterprise is a grayscale placeholder, not a purchasable SKU.
    if (req.method === 'GET' && p === '/v0/billing/plans') {
      return json(res, 200, { plans: PLAN_LIST, enterprise_api: false });
    }

    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && (p === '/v0/grant/balance' || p === '/functions/v1/bt-relay/balance')) {
      return json(res, 200, balance());
    }

    if (req.method === 'GET' && p === '/v0/models') return json(res, 200, { models: MODELS });

    // ── billing ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && p === '/v0/billing/checkout') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad_json' }); }
      const product = String(body?.product || '');
      if (product === 'enterprise') return json(res, 400, { error: 'enterprise_not_available' });
      if (!['monthly', 'yearly'].includes(product)) return json(res, 400, { error: 'bad_product' });
      state.sessionSeq += 1;
      const id = `cs_mock_${String(state.sessionSeq).padStart(4, '0')}`;
      // Mock completes the sandbox purchase immediately; the real rail waits for webhook.
      state.customer = state.customer || 'cus_mock_contract';
      state.subscription = `sub_mock_${product}`;
      state.product = product;
      state.remaining = PLAN_ALLOWANCE[product];
      return json(res, 200, {
        id,
        url: `http://mock.local/checkout/${id}?product=${product}`,
        product,
        mode: 'subscription',
        flavor: body?.flavor === 'china' ? 'china' : 'global',
        mock_completed: true,
      });
    }

    if (req.method === 'GET' && p === '/v0/billing/portal') {
      if (!state.customer) return json(res, 409, { error: 'no_billing_account' });
      return json(res, 200, { url: `http://mock.local/portal/${state.customer}` });
    }

    // ── consume ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && p === '/v0/grant/consume') {
      const key = String(req.headers['idempotency-key'] || '');
      if (key.length < 8) return json(res, 400, { error: 'idempotency_key_required' });
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad_json' }); }
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'bad_amount' });
      const out = consume(amount, key, 'consume');
      return json(res, out.status, out.body);
    }

    // ── sync ───────────────────────────────────────────────────────────────
    const syncMatch = /^\/v0\/sync\/([^/]+)$/.exec(p);
    if (syncMatch && ['GET', 'PUT'].includes(req.method)) {
      const collection = decodeURIComponent(syncMatch[1]);
      if (!SYNC_COLLECTIONS.includes(collection)) return json(res, 400, { error: 'bad_collection' });
      const key = `${tokenOf(req)}:${collection}`;
      if (req.method === 'GET') {
        const row = state.sync.get(key);
        if (!row) return json(res, 404, { error: 'not_found' });
        return json(res, 200, row, { ETag: etag(row.version) });
      }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad_json' }); }
      if (!body || typeof body.data !== 'object' || Array.isArray(body.data)) {
        return json(res, 400, { error: 'bad_data' });
      }
      if (carriesByokKey(body.data)) {
        return json(res, 400, {
          error: 'byok_key_rejected',
          detail: 'BYOK keys must never be uploaded; they stay on the device',
        });
      }
      const prev = state.sync.get(key) || { version: 0 };
      const ifMatch = req.headers['if-match'];
      if (ifMatch && ifMatch !== etag(prev.version)) {
        return json(res, 409, prev, { ETag: etag(prev.version) });
      }
      const row = {
        collection,
        data: body.data,
        version: prev.version + 1,
        updated_at: new Date().toISOString(),
      };
      state.sync.set(key, row);
      return json(res, 200, row, { ETag: etag(row.version) });
    }

    // ── relay ──────────────────────────────────────────────────────────────
    const isRelay = (req.method === 'POST' && p === '/v0/relay') || (req.method === 'POST' && LEGACY_RELAY.test(p));
    if (isRelay) {
      if (state.remaining <= 0) {
        return json(res, 402, {
          error: 'credit_exhausted',
          fallback: 'byok',
          message: '额度已用完。可在设置中改用自带 API Key（BYOK），请求会直连供应商。',
        });
      }
      const raw = await readBody(req);
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad_json' }); }
      if (body && typeof body === 'object' && carriesByokKey(body)) {
        // Do not echo the key, and do not "forward" anything.
        return json(res, 400, {
          error: 'byok_key_rejected',
          detail: 'BYOK requests must go directly to the provider',
        });
      }
      if (!body || typeof body.model !== 'string' || !MODELS.includes(body.model)) {
        return json(res, 403, { error: 'model_not_allowed', model: MODELS[0] });
      }
      if (/audio\/speech$/.test(p)) {
        const audio = Buffer.from('ID3mock-audio');
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'X-Mock': 'hosted-gateway-v0.1' });
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

    // ── account ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && p === '/v0/account/delete') {
      const syncCount = [...state.sync.keys()].filter((k) => k.startsWith(tokenOf(req) + ':')).length;
      state.remaining = 0;
      state.product = 'free';
      state.sync.clear();
      state.ledger.length = 0;
      return json(res, 200, { deleted: 'mock-user', grant: false, sync: syncCount, entitlement: false, mock: true });
    }

    if (req.method === 'GET' && p === '/v0/account/export') {
      return json(res, 200, {
        exported_at: new Date().toISOString(),
        user_id: 'mock-user',
        entitlement: { product: state.product, remaining: state.remaining, unit: state.unit },
        ledger: state.ledger.slice(),
        sync: Object.fromEntries([...state.sync.entries()].filter(([k]) => k.startsWith(tokenOf(req) + ':'))),
        billing: { customer_id: state.customer },
      }, { 'Content-Disposition': 'attachment; filename="hosted-export.json"' });
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
    console.log(`hosted-gateway mock v0.1 listening=http://127.0.0.1:${p}`);
    console.log(`try: GET http://127.0.0.1:${p}/v0/grant/balance with the test bearer token (see README)`);
  });
}

if (require.main === module) main();

module.exports = { createServer, carriesByokKey, MODELS, TOKEN_PREFIX, PLANS, SYNC_COLLECTIONS };
