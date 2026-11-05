// src/app/mcp-oauth-client.js — BEL-151 MCP OAuth public client (PKCE).
//
// The device bridge (agent/device-bridge.js) talks to the MCP host, and the only
// bearer it accepts is an **MCP OAuth access token** — never the LearnAuth/GoTrue
// session token. This module is the only place that obtains one:
//
//   · DCR: a public client (`token_endpoint_auth_method=none`) registered once per
//     flavor, with the App's own scheme as the redirect. The client_id is not a
//     secret, so it persists in the App's storage; it is not a credential.
//   · PKCE S256: verifier + state live only on this side. The browser sheet (or a
//     system browser) never sees them, so a code that leaks is useless without the
//     verifier that stays here.
//   · `connect()` is the only door that runs authorization_code. The device host
//     calls it from inside the register port, i.e. after requestPairing's confirm
//     gate has passed and before the device POST. Nothing here runs at startup,
//     from a deep link, or from a heartbeat.
//   · The refresh token goes to the SYSTEM Keychain under its own service
//     (`mt.mcp.oauth`), not to chrome.storage/localStorage and not into the
//     mtVault slot. `device_cred` stays in the App's storage (`device_*`); the two
//     credentials have different lifetimes and never share a slot.
//   · A 401 is not a reason to mint a new grant silently: the host invalidates the
//     access token, stops the heartbeat, and says 需重新允许连接此设备. Obtaining a
//     new grant always goes through a fresh pairing confirm.
//
// Frozen endpoints (growth FREEZE, 2026-10-31): intl https://mcp.belliedmonkey.cc ·
// china https://mcp.belliedmonkey.com · /authorize · /oauth/token ·
// /oauth/register · scopes mcp:read|mcp:write|offline_access · PKCE S256 ·
// token_endpoint_auth_method none. The base URL is imported from
// agent/device-bridge.js — one registry, not a second copy.
//
// Every edge is injectable so tests and probes run against a mock OAuth server and
// a memory Keychain:
//   createClient({ flavor, fetch, keychain, meta, openAuth, now, crypto })

import Bridge from '../../agent/device-bridge.js';
import { schemeForFlavor } from '../../agent/contract.js';
import NativeBridge from '../lib/native-bridge.js';

export const MCP_PATHS = Object.freeze({
  authorize: '/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
});

// The App already owns both schemes (Info.plist urlTypeXml in
// scripts/sync-app-assets.js). The path is what distinguishes this callback from
// sign-in / agent deep links.
export const REDIRECT_HOST = 'oauth';
export const REDIRECT_PATH = '/mcp/callback';
export const SCOPES = 'mcp:read mcp:write offline_access';

// One Keychain service for both platforms. **Not** mt.vault: that slot is iOS-only
// (system translation extension) and belongs to the engine key. Two credentials,
// two services; wiping one can never wipe the other.
export const KEYCHAIN = Object.freeze({
  service: 'mt.mcp.oauth',
  refresh: 'mcp_refresh',
  access: 'mcp_access',
});

// Non-secret bookkeeping. No token value ever goes into `meta`.
export const META_KEYS = Object.freeze({
  clientId: 'mcp_oauth_client_id',
  clientFlavor: 'mcp_oauth_client_flavor',
  redirect: 'mcp_oauth_redirect',
  expires: 'mcp_oauth_expires_at',
  account: 'mcp_oauth_account',
  obtained: 'mcp_oauth_obtained_at',
  // One in-flight authorization transaction: state + PKCE verifier + the client
  // and redirect they were issued for. Both are one-time secrets, never tokens,
  // and the row expires in PENDING_TTL_MS. Persisting it is what lets a callback
  // that arrives after an app relaunch (or after the native sheet already
  // returned) still finish the code→token exchange instead of being dropped.
  pending: 'mcp_oauth_pending',
});

const REFRESH_SKEW_MS = 60 * 1000;
const KEYCHAIN_TIMEOUT_MS = 4000;
// The user has ten minutes to finish consent; the verifier is useless after that.
const PENDING_TTL_MS = 10 * 60 * 1000;
// A native auth sheet that never returns must not leave the pairing button
// pending forever. This is a backstop, not the happy path.
const AUTH_WAIT_MS = 5 * 60 * 1000;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function b64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

function randomB64(byteCount, cryptoObj) {
  const bytes = new Uint8Array(byteCount);
  cryptoObj.getRandomValues(bytes);
  return b64url(bytes);
}

// RFC 7636 S256. Exported so a test can pin the known vector.
export async function pkceChallenge(verifier, cryptoObj) {
  const c = cryptoObj || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (!c || !c.subtle) throw new Error('mcp-oauth: crypto.subtle unavailable');
  const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(String(verifier)));
  return b64url(new Uint8Array(digest));
}

// `belliedmonkey://oauth/mcp/callback?...` parses with host=oauth and
// pathname=/mcp/callback (a custom scheme is not a file path). Deep links that are
// not this callback return null and stay with their owner.
export function callbackFromUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { return null; }
  // Only the two schemes this product registers may deliver a code. A page or a
  // stale handler must not be able to hand us `evil://oauth/mcp/callback`.
  const proto = u.protocol;
  if (proto !== 'belliedmonkey:' && proto !== 'belliedmonkeycn:') return null;
  if (u.host !== REDIRECT_HOST || u.pathname !== REDIRECT_PATH) return null;
  const q = u.searchParams;
  return {
    code: q.get('code') || '',
    state: q.get('state') || '',
    error: q.get('error') || '',
  };
}

function memoryMeta(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => Object.assign({}, data),
  };
}

function unavailableKeychain() {
  return {
    persistent: false,
    available: () => false,
    get: async () => null,
    set: async () => false,
    clear: async () => false,
  };
}

// Native half: app/native/mcp-oauth-bridge.swift (channel mtMcpOAuth, both
// platforms). A shell that does not have the channel keeps working for this run —
// tokens stay in memory — but the refresh token is NOT written anywhere else, and
// `persistent:false` is reported so a receipt never claims persistence.
export function nativeKeychain(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  let handlers = null;
  try { handlers = w && w.webkit && w.webkit.messageHandlers; } catch (_) { handlers = null; }
  const port = handlers && handlers.mtMcpOAuth;
  if (!port) return unavailableKeychain();

  const waiters = new Map();
  let seq = 0;
  // Last get() transport error. A native timeout and a "not found" both resolve
  // to null (see get below), but they are different facts for the host: a timeout
  // is network-ish and must not be read as "the grant is gone" (BEL-191).
  let lastError = '';

  function install() {
    if (!w) return;
    if (typeof w.__mtMcpOAuth === 'function' && w.__mtMcpOAuth.__mtMcpOAuth) return;
    const fn = (msg) => {
      const id = msg && msg.id;
      const waiter = waiters.get(id);
      if (!waiter) return;
      waiters.delete(id);
      waiter(msg);
    };
    fn.__mtMcpOAuth = true;
    w.__mtMcpOAuth = fn;
    // A reply that arrived before this dispatcher existed is replayed once. The
    // request id decides whether it belongs to a live waiter.
    const pending = w.__mtMcpOAuthPending;
    if (pending) { try { w.__mtMcpOAuthPending = null; } catch (_) {} fn(pending); }
  }

  function call(op, account, value) {
    install();
    return new Promise((resolve) => {
      const id = 'mcpo_' + (++seq);
      const timer = setTimeout(() => {
        if (!waiters.has(id)) return;
        waiters.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, KEYCHAIN_TIMEOUT_MS);
      waiters.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg || { ok: false, error: 'no_reply' });
      });
      const payload = { id, op, account };
      if (value !== undefined) payload.value = value;
      try { port.postMessage(payload); }
      catch (_) {
        clearTimeout(timer);
        waiters.delete(id);
        resolve({ ok: false, error: 'post_failed' });
      }
    });
  }

  return {
    persistent: true,
    available: () => true,
    // Exposed as a function so callers cannot accidentally freeze a stale error.
    lastError: () => lastError,
    async get(account) {
      const r = await call('get', account);
      if (!r || !r.ok) {
        lastError = String((r && r.error) || 'no_reply');
        return null;
      }
      lastError = '';
      return r.found && typeof r.value === 'string' ? r.value : null;
    },
    async set(account, value) {
      const r = await call('set', account, String(value));
      return !!(r && r.ok);
    },
    async clear(account) {
      const r = await call('clear', account);
      return !!(r && r.ok);
    },
  };
}

// The authorization page opens in the system auth sheet (ASWebAuthenticationSession)
// through the bridge the app already ships for Google sign-in. URL + PKCE are
// computed here; only `code` and `state` come back. The deeplink listener is a
// second door for the same callback: if the system hands the custom scheme to the
// App instead of the sheet, MTDeepLink -> NativeBridge delivers the same URL.
//
// Returns null when this shell has no bridge at all: the caller then reports a
// dependency instead of pretending the user cancelled.
export function nativeOpenAuth(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  let handlers = null;
  try { handlers = w && w.webkit && w.webkit.messageHandlers; } catch (_) { handlers = null; }
  if (!handlers || !handlers.mtAppleSignIn) return null;
  return ({ url, scheme, state: expected }) => new Promise((resolve) => {
    let done = false;
    let offWa = () => {};
    let offDeep = () => {};
    const finish = (r) => {
      if (done) return;
      done = true;
      offWa();
      offDeep();
      resolve(r || { error: 'no_callback' });
    };
    // A late redirect from an EARLIER attempt must not settle this one. Before
    // this check, a stale `state` did exactly that: the current connect() saw a
    // mismatched state and reported unsupported_action for a flow nobody had
    // cancelled. Ignore anything that is not the state we just asked for.
    const ours = (r) => {
      if (!r) return false;
      if (r.error === 'canceled' || r.error === 'access_denied') return true;
      return !!r.state && (!expected || r.state === expected);
    };
    offWa = NativeBridge.onNative('webauth-result', (r) => { if (ours(r)) finish(r); });
    offDeep = NativeBridge.onNative('deeplink', (raw) => {
      const cb = callbackFromUrl(raw);
      if (cb && ours(cb)) finish(cb);
    });
    try { handlers.mtAppleSignIn.postMessage({ url, scheme }); }
    catch (_) { finish({ error: 'post_failed' }); }
  });
}

function ok(res) {
  if (!res) return false;
  if (typeof res.ok === 'boolean') return res.ok;
  return Number(res.status) >= 200 && Number(res.status) < 300;
}

function isDenied(res) {
  const status = Number(res && res.status);
  return status === 400 || status === 401 || status === 403;
}

export function createClient(options) {
  const o = options || {};
  const flavorOf = typeof o.flavor === 'function' ? o.flavor
    : () => (o.flavor === 'china' ? 'china' : 'global');
  const doFetch = o.fetch || ((...args) => {
    if (typeof fetch != 'function') return Promise.reject(new Error('no fetch'));
    return fetch(...args);
  });
  const keychain = o.keychain || nativeKeychain();
  const meta = o.meta || memoryMeta();
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const cryptoObj = o.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  const openAuth = o.openAuth === undefined ? nativeOpenAuth() : o.openAuth;

  let access = null;       // { token, expiresAt, account } — process-local short cache
  let refresh = null;      // cached refresh token (the Keychain stays the truth)
  let refreshing = null;   // single-flight
  let lastError = '';
  let lastDetail = '';
  // One persisted authorization transaction and the in-process waiters that
  // connect() installed. A callback may arrive while a pair is waiting (the
  // waiter hands it the code and connect() keeps its confirm→exchange→register
  // order), or after a relaunch (no waiter; handleCallback exchanges directly).
  let pendingAuth = null;
  const authWaiters = new Set();
  const authWaitMs = Number(o.authWaitMs) > 0 ? Number(o.authWaitMs) : AUTH_WAIT_MS;

  function flavor() { return flavorOf() === 'china' ? 'china' : 'global'; }
  function baseUrl() {
    return String(Bridge.baseUrlForFlavor(flavor())).replace(/\/+$/, '');
  }
  function scheme() { return schemeForFlavor(flavor()); }
  function redirectUri() { return scheme() + '://' + REDIRECT_HOST + REDIRECT_PATH; }

  function dcrBody() {
    return {
      client_name: 'belliedmonkey-app ' + flavor(),
      redirect_uris: [redirectUri()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPES,
    };
  }

  function authorizeUrl(clientId, challenge, state) {
    const u = new URL(baseUrl() + MCP_PATHS.authorize);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirectUri());
    u.searchParams.set('scope', SCOPES);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  function owner() { return meta.getItem(META_KEYS.account) || ''; }

  // ── one in-flight authorization transaction ─────────────────────────────
  // The row contains state + verifier + client/redirect/account. It is written
  // before the browser opens and removed as soon as an exchange claims it, so a
  // replayed callback cannot redeem the same code twice. No token ever lives here.
  function readPending() {
    if (pendingAuth) {
      if (Number(pendingAuth.expiresAt) > now()) return pendingAuth;
      pendingAuth = null;
      meta.removeItem(META_KEYS.pending);
      return null;
    }
    const raw = meta.getItem(META_KEYS.pending);
    if (!raw) return null;
    let p = null;
    try { p = JSON.parse(String(raw)); } catch (_) { p = null; }
    if (!p || typeof p !== 'object' || !p.state || !p.verifier || !p.clientId || !p.account) {
      meta.removeItem(META_KEYS.pending);
      return null;
    }
    if (!(Number(p.expiresAt) > now())) {
      meta.removeItem(META_KEYS.pending);
      return null;
    }
    pendingAuth = p;
    return p;
  }

  function writePending(p) {
    pendingAuth = p;
    meta.setItem(META_KEYS.pending, JSON.stringify(p));
  }

  function dropPending(state) {
    // A callback for a newer attempt must not delete the transaction the newer
    // attempt is still waiting on.
    if (state && pendingAuth && pendingAuth.state !== state) return false;
    pendingAuth = null;
    meta.removeItem(META_KEYS.pending);
    return true;
  }

  // Claim the transaction BEFORE the network call. If the native sheet and the
  // app-level deeplink both deliver the same URL, the second one sees no pending
  // row and cannot exchange the single-use code a second time.
  async function completeAuthorization(p, cb) {
    if (!p || !cb) return { ok: false, code: 'bad_request', detail: 'oauth_no_pending' };
    if (!cb.code) return { ok: false, code: 'bad_request', detail: 'oauth_no_code' };
    if (!cb.state || cb.state !== p.state) {
      lastDetail = 'oauth_state';
      return { ok: false, code: 'unsupported_action', detail: lastDetail };
    }
    if (pendingAuth && pendingAuth.state === p.state) dropPending(p.state);
    const ex = await postForm({
      grant_type: 'authorization_code',
      code: String(cb.code),
      client_id: p.clientId,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri || redirectUri(),
    });
    if (!ex.ok) {
      if (ex.code === 'denied') {
        lastDetail = 'exchange:' + (ex.error || 'denied');
        return { ok: false, code: 'unsupported_action', detail: lastDetail };
      }
      lastDetail = ex.detail || '';
      return { ok: false, code: 'network_unavailable', detail: lastDetail };
    }
    await saveTokens(ex.tokens, p.account);
    lastError = '';
    return { ok: true, account: p.account, token: access ? access.token : '' };
  }

  // The one callback entry point. It is safe to call for ANY deeplink: a URL that
  // is not our redirect returns handled:false and stays with its owner.
  async function handleCallback(raw) {
    const cb = callbackFromUrl(raw);
    if (!cb) return { ok: false, handled: false, code: 'not_oauth_callback' };
    const p = readPending();
    if (!p) return { ok: false, handled: true, code: 'oauth_no_pending' };
    const waiterFor = (state) => Array.from(authWaiters).find((w) => w.state === state) || null;

    // A callback that names a DIFFERENT state belongs to an earlier attempt.
    // It must neither delete nor settle the live transaction.
    if (cb.state && cb.state !== p.state) {
      lastDetail = 'oauth_state';
      return { ok: false, handled: true, code: 'unsupported_action', detail: lastDetail };
    }

    if (cb.error) {
      // A provider refusal / cancel is definitive for the transaction it names.
      // Settle a live connect() too, or its pairing button would stay pending
      // until the 5-minute backstop.
      const w = waiterFor(p.state);
      if (w) w.resolve(cb);
      if (cb.error === 'access_denied') dropPending(p.state);
      return {
        ok: false,
        handled: true,
        code: cb.error === 'access_denied' ? 'cancelled' : 'unsupported_action',
        detail: 'authorize:' + String(cb.error),
      };
    }
    if (!cb.code) {
      const w = waiterFor(p.state);
      if (w) w.resolve({ error: 'no_code' });
      return { ok: false, handled: true, code: 'bad_request', detail: 'oauth_no_code' };
    }
    // A live connect() owns the exchange so the confirm→exchange→register order
    // never inverts. Hand it the code and let its own promise settle.
    const waiter = waiterFor(p.state);
    if (waiter) {
      waiter.resolve(cb);
      return { ok: true, handled: true, delegated: true, account: p.account };
    }
    // No waiter: this process was relaunched (or the sheet already returned).
    // The persisted transaction is enough to finish the exchange here.
    const out = await completeAuthorization(p, cb);
    return Object.assign({ handled: true }, out);
  }

  function accessUsable(account) {
    if (!access || !account) return null;
    if (access.account !== account) return null;
    if (now() >= access.expiresAt) return null;
    return access.token;
  }

  async function readRefresh() {
    if (refresh) return refresh;
    if (!keychain.available()) return '';
    const stored = await keychain.get(KEYCHAIN.refresh);
    refresh = typeof stored === 'string' && stored ? stored : '';
    return refresh;
  }

  async function saveTokens(tokens, account) {
    const ttlSec = Number(tokens.expires_in) > 0 ? Number(tokens.expires_in) : 3600;
    const expiresAt = now() + ttlSec * 1000 - REFRESH_SKEW_MS;
    access = { token: tokens.access_token, expiresAt, account };
    lastError = '';
    lastDetail = '';
    meta.setItem(META_KEYS.expires, String(expiresAt));
    meta.setItem(META_KEYS.account, String(account));
    meta.setItem(META_KEYS.obtained, String(now()));
    try { await keychain.set(KEYCHAIN.access, tokens.access_token); } catch (_) {}
    if (tokens.refresh_token) {
      refresh = tokens.refresh_token;
      try { await keychain.set(KEYCHAIN.refresh, tokens.refresh_token); } catch (_) {}
    }
  }

  function clearAccess() {
    access = null;
    meta.removeItem(META_KEYS.expires);
    try { return keychain.clear(KEYCHAIN.access); } catch (_) { return Promise.resolve(false); }
  }

  async function clearTokens() {
    access = null;
    refresh = null;
    dropPending();
    meta.removeItem(META_KEYS.expires);
    meta.removeItem(META_KEYS.account);
    meta.removeItem(META_KEYS.obtained);
    try { await keychain.clear(KEYCHAIN.access); } catch (_) {}
    try { await keychain.clear(KEYCHAIN.refresh); } catch (_) {}
  }

  async function parseJson(res) {
    try { return res && typeof res.json === 'function' ? await res.json() : null; }
    catch (_) { return null; }
  }

  async function postForm(fields) {
    if (typeof doFetch != 'function') return { ok: false, code: 'network_unavailable', detail: 'no_fetch' };
    let res;
    try {
      res = await doFetch(baseUrl() + MCP_PATHS.token, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(fields).toString(),
      });
    } catch (_) {
      return { ok: false, code: 'network_unavailable', detail: 'network' };
    }
    const data = await parseJson(res);
    if (!ok(res)) {
      if (isDenied(res)) {
        const err = String((data && (data.error || data.error_code)) || 'denied');
        return { ok: false, code: 'denied', error: err, status: Number(res && res.status) || 0 };
      }
      return { ok: false, code: 'network_unavailable', detail: 'http_' + (Number(res && res.status) || 0) };
    }
    if (!data || typeof data.access_token !== 'string' || !data.access_token) {
      return { ok: false, code: 'network_unavailable', detail: 'bad_response' };
    }
    return { ok: true, tokens: data };
  }

  async function ensureClientId() {
    const saved = meta.getItem(META_KEYS.clientId) || '';
    const savedFlavor = meta.getItem(META_KEYS.clientFlavor) || '';
    if (saved && savedFlavor === flavor()) return saved;

    let res;
    try {
      res = await doFetch(baseUrl() + MCP_PATHS.register, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(dcrBody()),
      });
    } catch (_) {
      lastDetail = 'client_registration:network';
      return '';
    }
    const data = await parseJson(res);
    if (!ok(res)) {
      lastDetail = 'client_registration:http_' + (Number(res && res.status) || 0);
      return '';
    }
    const id = data && (data.client_id || data.clientId);
    if (typeof id !== 'string' || !id) {
      lastDetail = 'client_registration:no_client_id';
      return '';
    }
    meta.setItem(META_KEYS.clientId, id);
    meta.setItem(META_KEYS.clientFlavor, flavor());
    meta.setItem(META_KEYS.redirect, redirectUri());
    return id;
  }

  async function refreshOnce(account) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const token = await readRefresh();
      if (!token) {
        // A native Keychain read that timed out is network-ish, not "no grant".
        // The host keeps the device pair either way, but it can only say
        // 需重连/网络 correctly if the two are distinguishable here.
        let keychainError = '';
        try {
          if (keychain && typeof keychain.lastError === 'function') keychainError = String(keychain.lastError() || '');
        } catch (_) { keychainError = ''; }
        lastError = keychainError === 'timeout' ? 'timeout' : 'no_refresh';
        return { ok: false, code: lastError };
      }
      const clientId = meta.getItem(META_KEYS.clientId) || '';
      if (!clientId) {
        lastError = 'no_client';
        return { ok: false, code: 'client_registration' };
      }
      const out = await postForm({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: clientId,
      });
      if (!out.ok) {
        if (out.code === 'denied') {
          // A definitive rejection: the grant is dead. Clearing the refresh token is
          // the honest move — keeping a token we know the server refused would make
          // the next launch retry a request that can only fail.
          lastError = 'invalid_grant';
          lastDetail = out.error || '';
          await clearTokens();
          return { ok: false, code: 'invalid_grant' };
        }
        lastError = 'network';
        lastDetail = out.detail || '';
        return { ok: false, code: 'network_unavailable' };
      }
      await saveTokens(out.tokens, account);
      return { ok: true, token: access.token };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  // Cheap "could this pairing skip the browser?" probe for the host. It reads the
  // Keychain (refresh) but never exposes a token, and it never opens a sheet.
  async function hasGrant(call) {
    const account = String((call && call.account) || '');
    if (!account) return false;
    const holder = owner();
    if (holder && holder !== account) return false;
    if (accessUsable(account)) return true;
    return !!(await readRefresh());
  }

  async function accessToken(call) {
    const account = String((call && call.account) || '');
    if (!account) return '';
    const holder = owner();
    if (holder && holder !== account) return '';   // never send another account's grant

    const cached = accessUsable(account);
    if (cached) return cached;

    // Cold start: the access token may still be valid in its own Keychain slot.
    if (!access && keychain.available()) {
      const stored = await keychain.get(KEYCHAIN.access);
      const expiresAt = Number(meta.getItem(META_KEYS.expires) || 0);
      if (stored && expiresAt > now() && (!holder || holder === account)) {
        access = { token: stored, expiresAt, account };
        return stored;
      }
    }

    const out = await refreshOnce(account);
    if (out.ok) return out.token;
    return '';
  }

  async function connect(call) {
    const account = String((call && call.account) || '');
    if (!account) return { ok: false, code: 'need_login' };

    const holder = owner();
    if (holder && holder !== account) {
      // The stored grant belongs to a different signed-in account. Never reuse it.
      await clearTokens();
    }

    const cached = accessUsable(account);
    if (cached) return { ok: true, token: cached, skipped: 'access' };

    if (await readRefresh()) {
      const r = await refreshOnce(account);
      if (r.ok) return { ok: true, token: r.token, skipped: 'refresh' };
      if (r.code === 'network_unavailable') return { ok: false, code: 'network_unavailable' };
      // invalid_grant has already cleared both slots; fall through to a fresh consent.
    }

    if (!openAuth) {
      lastDetail = 'no_auth_channel';
      return { ok: false, code: 'unsupported_action', detail: lastDetail, dependency: true };
    }
    if (!cryptoObj || !cryptoObj.subtle) {
      lastDetail = 'no_crypto';
      return { ok: false, code: 'unsupported_action', detail: lastDetail, dependency: true };
    }

    const clientId = await ensureClientId();
    if (!clientId) {
      return { ok: false, code: 'unsupported_action', detail: lastDetail || 'client_registration', dependency: true };
    }

    const verifier = randomB64(64, cryptoObj);
    const state = randomB64(24, cryptoObj);
    const challenge = await pkceChallenge(verifier, cryptoObj);
    const url = authorizeUrl(clientId, challenge, state);

    // Persist BEFORE the browser opens. Everything the callback needs (state,
    // verifier, client, redirect, account) survives a relaunch; the exchange can
    // then be finished by handleCallback even when this promise is gone.
    const transaction = {
      state,
      verifier,
      clientId,
      account,
      redirectUri: redirectUri(),
      flavor: flavor(),
      expiresAt: now() + PENDING_TTL_MS,
    };
    writePending(transaction);

    // One settle point for BOTH transports: the native sheet result and the
    // app-level deeplink handed over by handleCallback. Whichever arrives first
    // wins; the loser cannot redeem the code again.
    let settle;
    const callback = new Promise((resolve) => { settle = resolve; });
    const waiter = { state, resolve: (r) => settle(r) };
    authWaiters.add(waiter);
    let timer = null;
    const finishWait = () => {
      if (timer != null) { try { clearTimeout(timer); } catch (_) {} }
      authWaiters.delete(waiter);
    };
    timer = setTimeout(() => settle({ error: 'timeout' }), authWaitMs);
    try {
      Promise.resolve(openAuth({ url, scheme: scheme(), state, redirectUri: redirectUri() }))
        .then((r) => settle(r || { error: 'no_callback' }))
        .catch((e) => settle({ error: 'auth_sheet_error', detail: String((e && e.message) || e) }));
    } catch (e) {
      settle({ error: 'auth_sheet_error', detail: String((e && e.message) || e) });
    }

    let cb;
    try { cb = await callback; }
    finally { finishWait(); }
    if (!cb) cb = { error: 'no_callback' };

    if (cb.error === 'timeout') {
      dropPending(state);
      lastDetail = 'auth_timeout';
      return { ok: false, code: 'network_unavailable', detail: lastDetail };
    }
    if (cb.error === 'canceled' || cb.error === 'access_denied') {
      lastError = 'cancelled';
      // A provider refusal is final. A plain cancel leaves the transaction in
      // place for the app-level handler: the macOS browser handoff can report
      // canceled while the custom-scheme redirect is still arriving.
      if (cb.error === 'access_denied') dropPending(state);
      return { ok: false, code: 'cancelled' };
    }
    if (cb.error) {
      // no_callback / auth_sheet_error. Keep the transaction: handleCallback may
      // still complete it from the deeplink (and then resume the device register).
      lastDetail = 'authorize:' + String(cb.error);
      return { ok: false, code: 'network_unavailable', detail: lastDetail };
    }
    if (!cb.code) {
      lastDetail = 'authorize:no_code';
      return { ok: false, code: 'network_unavailable', detail: lastDetail };
    }
    if (!cb.state || cb.state !== state) {
      lastDetail = 'oauth_state';
      return { ok: false, code: 'unsupported_action', detail: lastDetail };
    }

    const out = await completeAuthorization(transaction, cb);
    if (out.ok) out.skipped = 'consent';
    return out;
  }

  async function invalidateAccess(call) {
    lastError = (call && call.reason) || 'unauthorized';
    await clearAccess();
    return { ok: true };
  }

  function state() {
    return {
      hasAccess: !!(access && now() < access.expiresAt),
      hasRefresh: !!refresh,
      owner: owner(),
      clientId: meta.getItem(META_KEYS.clientId) || '',
      lastError,
      detail: lastDetail,
      keychain: !!keychain.available(),
    };
  }

  return {
    // constants / pure-ish helpers for probes
    baseUrl,
    scheme,
    redirectUri,
    dcrBody,
    // protocol
    connect,
    handleCallback,
    accessToken,
    hasGrant,
    refreshOnce,
    invalidateAccess,
    clearTokens,
    state,
    // test surface
    _keys: { KEYCHAIN, META_KEYS },
    _meta: meta,
    _pending: () => readPending(),
  };
}

export default { createClient, nativeKeychain, nativeOpenAuth, pkceChallenge, callbackFromUrl };
