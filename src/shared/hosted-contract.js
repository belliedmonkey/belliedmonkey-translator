// shared/hosted-contract.js — the client half of contracts/hosted-gateway.v0.1.yaml.
//
// This module is deliberately dependency-free and storage-free: it is the *only* place
// the public client knows the v0.1 path names, the product enum, and the two safety
// rules that matter at the selection boundary:
//
//   1. BYOK is the default. A configured own key wins unless the user explicitly
//      prefers the subscription path.
//   2. A quota error never silently reroutes a request. The client falls back to the
//      local BYOK path; the server is not asked to switch modes.
//
// The hosted implementation lives in the private `*-hosted` repository. In this tree the
// call points are exercised against mocks/hosted-gateway/ only. If the real v0.1 contract
// is not present, this module is the "stub position" the order asks for — it does not
// invent a server and it does not touch the denylist.

export const CONTRACT_VERSION = '0.1';

export const PRODUCTS = ['free', 'monthly', 'yearly'];

export const PATHS = {
  plans: '/v0/billing/plans',
  checkout: '/v0/billing/checkout',
  portal: '/v0/billing/portal',
  balance: '/v0/grant/balance',
  consume: '/v0/grant/consume',
  relay: '/v0/relay',
  sync: '/v0/sync',
  models: '/v0/models',
};

// The public mock. It is the only base this module ever hardcodes; a real base is
// injected at build time and never committed.
export const MOCK_BASE = 'http://127.0.0.1:8787';

const KEY_FIELD = /(^|_)(api_?key|upstream_api_?key|service_role|grant_kek)($|_)/i;
const KEY_SHAPE = /sk-[A-Za-z0-9_-]{12,}|bmg_[A-Za-z0-9_-]{12,}/;

function baseOf(base) {
  return String(base == null ? '' : base).replace(/\/+$/, '');
}

export function pathFor(base, key) {
  return baseOf(base) + (PATHS[key] || '');
}

export function syncPath(base, collection) {
  const name = String(collection == null ? '' : collection).trim();
  if (!/^[a-z][a-z0-9_-]{1,40}$/i.test(name)) throw new Error('bad sync collection');
  return pathFor(base, 'sync') + '/' + name;
}

export function productOf(balance) {
  const p = String((balance && balance.product) || '').trim();
  return PRODUCTS.includes(p) ? p : 'free';
}

export function isSubscription(product) {
  return product === 'monthly' || product === 'yearly';
}

export function isMockBase(base) {
  return baseOf(base) === MOCK_BASE;
}

// The selection rule. `prefer` is the user's explicit choice (`byok` | `subscription`);
// unset means "auto", and auto is BYOK-first because the own-key path is the default.
export function chooseRoute(input) {
  const o = input || {};
  const own = !!o.hasOwnKey;
  const product = productOf({ product: o.product });
  const remaining = Number(o.remaining);
  const hasQuota = Number.isFinite(remaining) && remaining > 0;
  if (o.prefer === 'byok') return own ? 'byok' : 'none';
  if (o.prefer === 'subscription') {
    if (!o.signedIn) return own ? 'byok' : 'none';
    return hasQuota ? 'subscription' : (own ? 'byok' : 'none');
  }
  if (own) return 'byok';
  if (o.signedIn && isSubscription(product) && hasQuota) return 'subscription';
  return 'none';
}

// A 402/429 must offer the local exit, never a forced subscription. The caller uses this
// to decide which action to show; it never asks the server to change route.
export function fallbackAfterQuota(input) {
  return (input && input.hasOwnKey) ? 'byok' : 'none';
}

function assertNoKeyMaterial(body, where) {
  const text = JSON.stringify(body == null ? null : body);
  if (KEY_SHAPE.test(text)) throw new Error(where + ' contains key-shaped material');
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (KEY_FIELD.test(k)) throw new Error(where + ' contains forbidden field ' + k);
      walk(x);
    }
  };
  walk(body);
}

export function validateBalance(body) {
  if (!body || typeof body !== 'object') throw new Error('balance: not an object');
  assertNoKeyMaterial(body, 'balance');
  const remaining = Number(body.remaining);
  if (!Number.isFinite(remaining)) throw new Error('balance: remaining is not a number');
  return {
    product: productOf(body),
    remaining,
    unit: String(body.unit || 'usd'),
    resets_at: body.resets_at == null ? null : String(body.resets_at),
  };
}

export function validateError(body) {
  if (!body || typeof body !== 'object') return { code: 'unknown', fallback: 'byok' };
  assertNoKeyMaterial(body, 'error');
  const code = String(body.error || body.code || 'unknown');
  const fallback = body.fallback === 'byok' ? 'byok' : (code === 'insufficient_balance' ? 'byok' : '');
  return { code, fallback };
}

export function isHostedBearer(headers) {
  const h = headers || {};
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() !== 'authorization') continue;
    const v = String(h[k] == null ? '' : h[k]).trim();
    if (/^bearer\s+bmg_/i.test(v)) return true;
  }
  return false;
}

export default {
  CONTRACT_VERSION, PRODUCTS, PATHS, MOCK_BASE,
  pathFor, syncPath, productOf, isSubscription, isMockBase,
  chooseRoute, fallbackAfterQuota, validateBalance, validateError, isHostedBearer,
};
