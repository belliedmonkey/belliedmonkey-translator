// agent/device-bridge.js — BEL-151 device session client.
//
// The App tells the cloud that this Mac is reachable by the signed-in assistant.
// Pairing is a local, user-visible confirm (agent/confirm.js); this module only
// carries the four POSTs and the local credential. It never reads the page,
// opens the microphone, or turns on live subtitles. No machine-local sidecar is
// a truth source here, and "bootstrap" is short-lived — never a pair.
//
// Pure Node, no runtime deps. Every side effect is injectable so the probes and
// tests run against a mock fetch and an in-memory store:
//   createClient({ flavor, baseUrl, fetch, getAccessToken, getAppVersion,
//                  store, now, paths, setTimeout, clearTimeout })
//
// No Node I/O lives here on purpose: this module is also bundled into the App
// (src/app/device-bridge-host.js), whose page has no `fs`. The caller always
// supplies a store, and the Node/CLI default (a 0600 JSON file under
// ~/.belliedmonkey) lives in agent/device-bridge-store.js.
'use strict';

const PLATFORM = 'mac';
const DEFAULT_TTL_SEC = 900; // growth freeze: 900s (15 min) without a heartbeat
const BOOTSTRAP_TTL_SEC = 300; // short-lived after open_setup only
const HEARTBEAT_MIN_MS = 2 * 60 * 1000;
const HEARTBEAT_MAX_MS = 5 * 60 * 1000;
const HEARTBEAT_DEFAULT_MS = 3 * 60 * 1000;

// base 以增长冻结为准：intl → mcp.cc · china → mcp.com. Never www hosts.
const BASES = Object.freeze({
  intl: 'https://mcp.belliedmonkey.cc',
  global: 'https://mcp.belliedmonkey.cc',
  china: 'https://mcp.belliedmonkey.com',
});

const PATHS = Object.freeze({
  register: '/api/mcp/device-sessions/register',
  heartbeat: '/api/mcp/device-sessions/heartbeat',
  bootstrap: '/api/mcp/device-sessions/bootstrap',
  revoke: '/api/mcp/device-sessions/revoke',
});

const KEYS = Object.freeze({
  deviceId: 'device_id',
  cred: 'device_cred',
  credTtl: 'device_cred_ttl_sec',
  credAt: 'device_cred_saved_at',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function baseUrlForFlavor(flavor) {
  return flavor === 'china' ? BASES.china : BASES.intl;
}

function newDeviceId() {
  // Web Crypto first (same call in the App and Node ≥20), then a plain v4 so a
  // page without a secure-context `randomUUID` still gets a stable, well-formed
  // id. The id is not a credential — see KEYS below.
  const web = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
  if (web && typeof web.randomUUID === 'function') {
    try { return web.randomUUID(); } catch (_) { /* fall through */ }
  }
  const bytes = new Uint8Array(16);
  if (web && typeof web.getRandomValues === 'function') web.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
    + hex.slice(16, 20) + '-' + hex.slice(20);
}

// One store shape for the injected storage. A store is either browser-like
// (getItem/setItem/removeItem) or the tiny (get/set/remove) shape the App host
// can back with its own storage without importing Node I/O.
function apiOf(store) {
  if (!store) throw new Error('device-bridge: store required');
  if (typeof store.getItem === 'function' && typeof store.setItem === 'function') {
    return {
      get: (key) => store.getItem(key),
      set: (key, value) => store.setItem(key, value),
      remove: (key) => {
        if (typeof store.removeItem === 'function') store.removeItem(key);
        else store.setItem(key, null);
      },
    };
  }
  if (typeof store.get === 'function' && typeof store.set === 'function') {
    return {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
      remove: (key) => {
        if (typeof store.remove === 'function') store.remove(key);
        else store.set(key, null);
      },
    };
  }
  throw new Error('device-bridge: store needs getItem/setItem or get/set');
}

function memoryStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    dump() { return Object.assign({}, data); },
  };
}

// Stable per-install id. A malformed or missing value is replaced once and
// written back; the id itself is not a credential and survives clearLocalCred().
function getOrCreateDeviceId(store) {
  const api = apiOf(store);
  const found = api.get(KEYS.deviceId);
  if (typeof found === 'string' && UUID_RE.test(found)) return found;
  const id = newDeviceId();
  api.set(KEYS.deviceId, id);
  return id;
}

function pathsWith(overrides) {
  const out = Object.assign({}, PATHS, overrides || {});
  for (const key of Object.keys(PATHS)) {
    if (typeof out[key] !== 'string' || out[key].charAt(0) !== '/') {
      throw new Error('device-bridge: path ' + key + ' must start with /');
    }
  }
  return Object.freeze(out);
}

async function tokenOf(getter) {
  let token = null;
  try { token = await getter(); } catch (_) { token = null; }
  if (token && typeof token === 'object') token = token.access_token || token.token || '';
  return typeof token === 'string' ? token : '';
}

function createClient(options) {
  const opts = options || {};
  const baseUrl = String(opts.baseUrl || baseUrlForFlavor(opts.flavor)).replace(/\/+$/, '');
  const paths = pathsWith(opts.paths);
  const store = apiOf(opts.store);
  const doFetch = opts.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  const getAccessToken = opts.getAccessToken || (() => '');
  const getAppVersion = opts.getAppVersion || (() => '');
  const now = opts.now || (() => Date.now());
  const timers = {
    setTimeout: opts.setTimeout || setTimeout,
    clearTimeout: opts.clearTimeout || clearTimeout,
  };

  let deviceId = null;
  let timer = null;
  let running = false;

  function ensureDeviceId() {
    if (!deviceId) deviceId = getOrCreateDeviceId(store);
    return deviceId;
  }

  function cred() {
    const value = store.get(KEYS.cred);
    return typeof value === 'string' && value ? value : '';
  }

  function saveCred(value, ttlSec) {
    store.set(KEYS.cred, value);
    if (ttlSec) store.set(KEYS.credTtl, String(ttlSec));
    store.set(KEYS.credAt, String(now()));
  }

  function clearLocalCred() {
    store.remove(KEYS.cred);
    store.remove(KEYS.credTtl);
    store.remove(KEYS.credAt);
    return true;
  }

  function stopHeartbeat() {
    running = false;
    if (timer != null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    return true;
  }

  // 401/403 means the OAuth grant is gone or belongs to another account. The
  // local device credential is worthless from that moment on.
  function forgetAndStop() {
    clearLocalCred();
    stopHeartbeat();
  }

  async function post(route, body) {
    const token = await tokenOf(getAccessToken);
    if (!token) return { ok: false, code: 'need_login', status: 0 };
    if (typeof doFetch !== 'function') return { ok: false, code: 'network_unavailable', status: 0 };
    let res;
    try {
      res = await doFetch(baseUrl + paths[route], {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body || {}),
      });
    } catch (_) {
      return { ok: false, code: 'network_unavailable', status: 0 };
    }
    const status = Number(res && res.status) || 0;
    let data = null;
    try {
      data = res && typeof res.json === 'function' ? await res.json() : null;
    } catch (_) {
      data = null;
    }
    if (status === 401 || status === 403) {
      forgetAndStop();
      return { ok: false, code: 'unauthorized', status };
    }
    if (status === 400) return { ok: false, code: 'bad_request', status };
    if (!(status >= 200 && status < 300) || (res && res.ok === false)) {
      return { ok: false, code: 'server_error', status };
    }
    if (data && data.ok === false) {
      if (data.code === 'unauthorized') {
        forgetAndStop();
        return { ok: false, code: 'unauthorized', status };
      }
      return { ok: false, code: 'server_error', status };
    }
    return { ok: true, data: data || {}, status };
  }

  async function register(callOptions) {
    const call = callOptions || {};
    // The local confirm is the gate. A caller that forgets it gets no request.
    if (call.confirm !== true) return { ok: false, code: 'confirm_required', sent: false };
    const device_id = ensureDeviceId();
    let app_version = '';
    try { app_version = String(await getAppVersion() || ''); } catch (_) { app_version = ''; }
    const body = { device_id, platform: PLATFORM, confirm: true };
    if (app_version) body.app_version = app_version;
    const out = await post('register', body);
    if (!out.ok) return out;
    const data = out.data || {};
    const device_cred = typeof data.device_cred === 'string' ? data.device_cred : '';
    if (data.ok !== true || !device_cred) {
      return { ok: false, code: 'bad_response', status: out.status };
    }
    const ttl_sec = Number(data.ttl_sec) > 0 ? Number(data.ttl_sec) : DEFAULT_TTL_SEC;
    saveCred(device_cred, ttl_sec);
    return { ok: true, device_id, device_cred, ttl_sec, status: out.status };
  }

  async function heartbeat() {
    const device_id = ensureDeviceId();
    const device_cred = cred();
    if (!device_cred) return { ok: false, code: 'not_paired', sent: false };
    const out = await post('heartbeat', { device_id, device_cred });
    if (!out.ok) return out;
    const data = out.data || {};
    const ttl_sec = Number(data.ttl_sec) > 0 ? Number(data.ttl_sec) : 0;
    if (ttl_sec) store.set(KEYS.credTtl, String(ttl_sec));
    return { ok: true, ttl_sec, last_seen: data.last_seen || '', status: out.status };
  }

  // Short-lived "I am here" after open_setup. The cloud may hand back a
  // bootstrap credential; it is never stored as the paired device_cred and it
  // never makes hasCred() true.
  async function bootstrap(callOptions) {
    const call = callOptions || {};
    if (call.source !== 'open_setup') return { ok: false, code: 'bad_request', sent: false };
    const device_id = ensureDeviceId();
    const out = await post('bootstrap', {
      device_id,
      platform: PLATFORM,
      source: 'open_setup',
      ttl_sec: BOOTSTRAP_TTL_SEC,
    });
    if (!out.ok) return out;
    const data = out.data || {};
    const ttl_sec = Number(data.ttl_sec) > 0 ? Number(data.ttl_sec) : BOOTSTRAP_TTL_SEC;
    const result = {
      ok: true,
      paired: false,
      kind: 'bootstrap',
      ttl_sec,
      expires_at: new Date(now() + ttl_sec * 1000).toISOString(),
      status: out.status,
    };
    if (typeof data.device_cred === 'string' && data.device_cred) {
      result.bootstrap_cred = data.device_cred;
    }
    return result;
  }

  async function revoke() {
    const device_id = ensureDeviceId();
    const device_cred = cred();
    clearLocalCred();
    stopHeartbeat();
    if (!device_cred) return { ok: true, revoked: false, cloud: false, status: 0 };
    const out = await post('revoke', { device_id, device_cred });
    return {
      ok: true,
      revoked: true,
      cloud: !!(out && out.ok),
      status: out ? out.status : 0,
    };
  }

  function schedule(intervalMs) {
    timer = timers.setTimeout(async () => {
      timer = null;
      if (!running) return;
      try { await heartbeat(); } catch (_) { /* a failed tick never crashes the App */ }
      if (running) schedule(intervalMs);
    }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // Clamped to the contract's 2–5 min window. A 401/403 inside the tick stops
  // the loop and clears the credential; the next tick is never scheduled.
  function startHeartbeat(callOptions) {
    const call = callOptions || {};
    let intervalMs = Number(call.intervalMs) > 0 ? Math.round(Number(call.intervalMs)) : HEARTBEAT_DEFAULT_MS;
    if (intervalMs < HEARTBEAT_MIN_MS) intervalMs = HEARTBEAT_MIN_MS;
    if (intervalMs > HEARTBEAT_MAX_MS) intervalMs = HEARTBEAT_MAX_MS;
    stopHeartbeat();
    running = true;
    schedule(intervalMs);
    return { ok: true, interval_ms: intervalMs };
  }

  return {
    platform: PLATFORM,
    baseUrl,
    paths,
    getDeviceId: ensureDeviceId,
    hasCred: () => !!cred(),
    isHeartbeatRunning: () => running,
    register,
    heartbeat,
    bootstrap,
    revoke,
    clearLocalCred,
    startHeartbeat,
    stopHeartbeat,
  };
}

module.exports = {
  PLATFORM,
  DEFAULT_TTL_SEC,
  BOOTSTRAP_TTL_SEC,
  HEARTBEAT_MIN_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_DEFAULT_MS,
  BASES,
  PATHS,
  KEYS,
  baseUrlForFlavor,
  getOrCreateDeviceId,
  createClient,
  memoryStore,
};
