// src/app/device-bridge-host.js — BEL-151: what the App must do that the device
// client cannot.
//
// agent/device-bridge.js carries the four POSTs and the local credential, and it
// takes getAccessToken / store / fetch as options on purpose. This module is the
// App half of that contract, and it invents no transport of its own:
//
//   · getAccessToken ← **MCP OAuth access** (src/app/mcp-oauth-client.js), never
//     LearnAuth/GoTrue. An empty token means no request goes out, and the user is
//     told the honest thing (sign in, or allow this device again) — never a fake
//     "paired".
//   · store ← this install's chrome.storage.local, read once into a synchronous
//     cache (the device client needs a sync get/set) and written through. One
//     device_id per install; the device_cred is cleared on 401/403 by the client.
//     MCP refresh tokens are NOT here: they live in the system Keychain under their
//     own service (mcp-oauth-client.js), a separate slot from device_cred.
//   · pair() ← the Settings entry. It asks agent/session.requestPairing, so the
//     existing needsConfirm gate is the one that runs, and the confirm card is the
//     copy-locked one (agent/copy.js ACTIONS.pair_device). Cancelling sends
//     nothing. The PKCE exchange is injected as the register port, so it can only
//     run after that gate has passed and before the device POST.
//   · boot() ← the foreground lifecycle: one heartbeat on launch / return to
//     foreground, plus the client's own 2–5 minute interval while paired.
//   · agentBridge() ← the same client for shell-model's agent host, so an
//     inbound open_setup's short-lived bootstrap also has an MCP Bearer path.
//
// LearnAuth is still the login / userId gate and the cross-account check. It is
// never a bearer for the device endpoints.
//
// It does not claim listening works, does not open the microphone, and does not
// make a machine-local companion a truth source.
//
// Every side effect is injectable: createHost({ bridge, auth, oauth, keychain,
// store, storage, fetch, now, appVersion, flavor, ui, timers }).

import Bridge from '../../agent/device-bridge.js';
import { ACTIONS, MESSAGES, failureRow } from '../../agent/copy.js';
import { requestPairing } from '../../agent/session.js';
import { hasGrant } from '../../agent/grants-model.js';
import { pairingUi } from './agent-face.js';
import { createClient as createOAuthClient, META_KEYS as OAUTH_META } from './mcp-oauth-client.js';
import Registry from '../lib/registry.js';


export const PAIR_ACTION = 'pair_device';
export const PAIR_BUTTON_ID = 'pair-device-btn';
export const PAIR_STATUS_ID = 'pair-device-status';
export const PAIR_HINT_ID = 'pair-device-hint';
// The copy lock, not a new sentence: the same name and honest touch line the
// confirm card shows. A Chinese literal here would fail test/no-hardcoded-copy.
export const PAIR_LABEL = ACTIONS[PAIR_ACTION].name;
export const PAIR_HINT = ACTIONS[PAIR_ACTION].touches[0];

// The client's own keys plus one host key: which account asked for this pairing.
// A device_cred belongs to the session that registered it, and a second account
// signing in on the same Mac must not keep beating with it. The MCP OAuth meta keys
// (client_id / expiry / owner — no token values) share the same preload so the OAuth
// client's synchronous meta surface works from the first call.
const CRED_USER_KEY = 'device_cred_user';
const STORED_KEYS = Object.values(Bridge.KEYS)
  .concat([CRED_USER_KEY], Object.values(OAUTH_META));

function statusText(state) {
  if (state === 'paired') return MESSAGES.paired;
  if (state === 'reconnect') return MESSAGES.reconnect;
  if (state === 'signed_out' || state === 'unauthorized') return failureRow('need_login').line;
  if (state === 'network') return MESSAGES.network;
  return '';
}

// chrome.storage.local is asynchronous and the device client is not, so the read
// happens once at boot into a synchronous cache and every write goes through.
// A missing storage area is not fatal: the feature works for this run and the
// status says nothing about persistence (there is no copy for that, and claiming
// "saved" without storage would be the lie).
function storageStore(area) {
  const cache = new Map();
  let readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve) => {
      if (!area || typeof area.get !== 'function') { resolve(false); return; }
      try {
        area.get(STORED_KEYS, (values) => {
          const v = values || {};
          for (const k of STORED_KEYS) if (v[k] != null && v[k] !== '') cache.set(k, String(v[k]));
          resolve(true);
        });
      } catch (_) { resolve(false); }
    });
    return readyPromise;
  }
  return {
    persistent: !!area && typeof area.get === 'function',
    ready,
    getItem: (key) => (cache.has(key) ? cache.get(key) : null),
    setItem(key, value) {
      cache.set(key, String(value));
      try { area.set({ [key]: String(value) }, () => {}); } catch (_) {}
    },
    removeItem(key) {
      cache.delete(key);
      try { area.remove([key], () => {}); } catch (_) {}
    },
  };
}

function injectedStore(raw) {
  return {
    persistent: true,
    ready: () => Promise.resolve(true),
    getItem: (key) => raw.getItem(key),
    setItem: (key, value) => raw.setItem(key, value),
    removeItem: (key) => raw.removeItem(key),
  };
}

function noop() {}

export function createHost(options) {
  const opts = options || {};
  const bridge = opts.bridge || Bridge;
  const auth = opts.auth || null;
  const doFetch = opts.fetch;
  const now = opts.now || (() => Date.now());
  const appVersion = opts.appVersion || (() => '');
  const flavorOf = opts.flavor || (() => 'global');
  const timers = opts.timers || { setTimeout, clearTimeout };
  const defaultUi = opts.ui || null;

  const store = opts.store ? injectedStore(opts.store)
    : storageStore(opts.storage || (typeof chrome !== 'undefined' && chrome.storage
      ? chrome.storage.local : null));

  let client = null;
  let oauth = null;
  let bootedDoc = null;
  let grants = { device: {}, assistants: {} };
  let status = { state: 'unknown', code: '', at: 0 };
  const subscribers = new Set();

  // ── session / token ─────────────────────────────────────────────────────
  async function currentSession() {
    if (!auth) return null;
    try {
      if (typeof auth.currentStable === 'function') return await auth.currentStable();
      return await auth.current();
    } catch (_) { return null; }
  }

  // The MCP OAuth client is created once and shares the App's storage for its
  // non-secret meta (client_id / expiry / owner). Tokens themselves are in the
  // Keychain slot owned by mcp-oauth-client.js.
  function ensureOauth() {
    if (oauth) return oauth;
    if (opts.oauth) { oauth = opts.oauth; return oauth; }
    oauth = createOAuthClient({
      flavor: flavorOf,
      fetch: doFetch,
      keychain: opts.keychain,
      meta: store,
      openAuth: opts.openAuth,
      now,
      crypto: opts.crypto,
    });
    return oauth;
  }

  // **MCP OAuth access only.** LearnAuth is the login/userId gate, never a bearer
  // for the device endpoints (a GoTrue token is not an MCP grant and the cloud
  // rejects it). An empty string means the caller sends nothing.
  async function getAccessToken() {
    const session = await currentSession();
    if (!session || !session.userId) return '';
    try {
      const token = await ensureOauth().accessToken({ account: String(session.userId) });
      return token ? String(token) : '';
    } catch (_) {
      return '';
    }
  }

  function networkUp() {
    try { return typeof navigator === 'undefined' || navigator.onLine !== false; }
    catch (_) { return true; }
  }

  // ── status ──────────────────────────────────────────────────────────────
  function statusNow() {
    return Object.freeze(Object.assign({}, status, {
      text: statusText(status.state),
      paired: store.getItem(Bridge.KEYS.cred) != null,
      persistent: store.persistent,
    }));
  }
  function setStatus(patch) {
    status = Object.assign({}, status, patch || {}, { at: now() });
    const snapshot = statusNow();
    for (const fn of [...subscribers]) {
      try { fn(snapshot); } catch (_) {}
    }
    return snapshot;
  }
  function onStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  async function refreshStatus() {
    const session = await currentSession();
    if (!session || !session.userId) return setStatus({ state: 'signed_out', code: 'need_login' });
    if (hasCred()) return setStatus({ state: 'paired', code: 'ok' });
    return setStatus({ state: 'unpaired', code: '' });
  }

  // ── the client ──────────────────────────────────────────────────────────
  async function ensureClient() {
    await store.ready();
    if (!client) {
      client = bridge.createClient({
        flavor: flavorOf(),
        fetch: doFetch,
        getAccessToken,
        getAppVersion: () => String(appVersion() || ''),
        store,
        now,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      });
    }
    return client;
  }

  function hasCred() { return store.getItem(Bridge.KEYS.cred) != null; }

  function clearLocalCred() {
    if (client) client.clearLocalCred();
    else {
      store.removeItem(Bridge.KEYS.cred);
      store.removeItem(Bridge.KEYS.credTtl);
      store.removeItem(Bridge.KEYS.credAt);
    }
    store.removeItem(CRED_USER_KEY);
  }

  function startHeartbeat(callOptions) {
    if (!client) return null;
    return client.startHeartbeat(callOptions);
  }

  function stopHeartbeat() {
    if (!client) return false;
    return client.stopHeartbeat();
  }

  function isHeartbeatRunning() {
    return !!(client && client.isHeartbeatRunning());
  }

  // Signed out (or a different account on the same Mac): the old credential is
  // worthless. We cannot call revoke — that needs the token we just lost — so
  // clear locally; the cloud's 900 s TTL is the backstop. The MCP refresh token
  // goes with it: it belongs to the account that is no longer here.
  async function noteSessionFallout(session) {
    if (!session || !session.userId) {
      clearLocalCred();
      stopHeartbeat();
      try { await ensureOauth().clearTokens(); } catch (_) {}
      return 'signed_out';
    }
    const owner = store.getItem(CRED_USER_KEY);
    if (hasCred() && owner && owner !== session.userId) {
      clearLocalCred();
      stopHeartbeat();
      try { await ensureOauth().clearTokens(); } catch (_) {}
      return 'switched';
    }
    return '';
  }

  async function noteSession(session) {
    await store.ready();
    const why = await noteSessionFallout(session);
    if (why === 'signed_out') return setStatus({ state: 'signed_out', code: 'need_login' });
    if (why === 'switched') return setStatus({ state: 'unpaired', code: '' });
    return refreshStatus();
  }

  // ── pairing (Settings entry) ────────────────────────────────────────────
  async function pair(pairOptions) {
    const o = pairOptions || {};
    await store.ready();
    const session = await currentSession();
    const login = !!(session && session.userId);
    const ui = o.ui || defaultUi || pairingUi(o.onSignIn);

    if (!login) setStatus({ state: 'signed_out', code: 'need_login' });
    else setStatus(hasCred() ? { state: 'paired', code: 'ok' } : { state: 'unpaired', code: '' });

    let bridgeClient = null;
    if (login) bridgeClient = await ensureClient();

    // A remembered 「本机始终允许」 may skip the card. That is fine when an MCP grant
    // already exists (nothing new is being minted), but if this pairing would have
    // to open a browser consent, the user must see the copy-locked card again —
    // "no new long-lived grant without a confirm, this time".
    let ctxGrants = grants;
    if (login && hasGrant(grants, 'pair_device', '')) {
      let usable = false;
      try { usable = await ensureOauth().hasGrant({ account: String(session.userId) }); } catch (_) { usable = false; }
      if (!usable) ctxGrants = { device: {}, assistants: {} };
    }

    const ctx = {
      readiness: async () => ({ login, network: networkUp() }),
      grants: ctxGrants,
      persistGrants(next) {
        grants = {
          device: (next && next.device) || {},
          assistants: (next && next.assistants) || {},
        };
      },
      // The register port is the ONLY place the PKCE exchange runs. runAgentAction
      // calls it after preconditions + the confirm gate (or a remembered device
      // grant) and before any device POST. Cancelling the card never reaches it.
      deviceBridge: bridgeClient ? pairingBridge(bridgeClient, session) : undefined,
      hostConnected: true,
      ports: {},
    };

    const receipt = await requestPairing(ctx, ui);
    await finishPair(receipt, session);
    return receipt;
  }

  function pairingBridge(bridgeClient, session) {
    const account = session && session.userId ? String(session.userId) : '';
    return {
      async register(callOptions) {
        if (!account) return { ok: false, code: 'need_login', sent: false };
        const prepared = await ensureOauth().connect({ account });
        if (!prepared || prepared.ok !== true) {
          return {
            ok: false,
            code: (prepared && prepared.code) || 'network_unavailable',
            sent: false,
            detail: (prepared && prepared.detail) || '',
          };
        }
        const out = await bridgeClient.register(callOptions);
        if (out && out.code === 'unauthorized') {
          // The cloud refused the grant. Drop the access token (the refresh token
          // stays for one explicit retry after the next pairing confirm) and stop
          // the loop; the status says what the user must do, not "signed out".
          store.removeItem(CRED_USER_KEY);
          stopHeartbeat();
          try { await ensureOauth().invalidateAccess({ reason: 'unauthorized' }); } catch (_) {}
        }
        return out;
      },
      bootstrap: (callOptions) => bridgeClient.bootstrap(callOptions),
    };
  }

  async function finishPair(receipt, session) {
    if (!receipt) return;
    const code = receipt.code;
    if (receipt.ok) {
      if (session && session.userId) store.setItem(CRED_USER_KEY, session.userId);
      startHeartbeat();
      setStatus({ state: 'paired', code: 'ok' });
      return;
    }
    if (code === 'cancelled') return;          // user said no: nothing changed
    if (code === 'need_login') {
      if (session && session.userId) {
        // Signed in, but the device grant is gone: re-allowing the device is the
        // honest next step ("sign in" would send them to a screen that changes
        // nothing). The local device_cred is worthless without the MCP grant.
        clearLocalCred();
        stopHeartbeat();
        try { await ensureOauth().invalidateAccess({ reason: 'unauthorized' }); } catch (_) {}
        setStatus({ state: 'reconnect', code: 'need_reconnect' });
      } else {
        setStatus({ state: 'signed_out', code: 'need_login' });
      }
      return;
    }
    if (code === 'network_unavailable') { setStatus({ state: 'network', code }); return; }
    setStatus({ state: 'error', code: code || '' });
  }

  // ── heartbeat lifecycle ─────────────────────────────────────────────────
  async function onForeground() {
    await store.ready();
    const session = await currentSession();
    if (!session || !session.userId) {
      stopHeartbeat();
      setStatus({ state: 'signed_out', code: 'need_login' });
      return { ok: false, code: 'need_login', sent: false };
    }
    if (!hasCred()) {
      stopHeartbeat();
      // After a 401 the credential is gone but "unpaired" would erase the honest
      // "re-allow this device" state on the next foreground. Keep that state until
      // the user pairs again (a fresh launch has no lastError and stays unpaired).
      let mcp = {};
      try { mcp = ensureOauth().state() || {}; } catch (_) {}
      if (session.userId && (mcp.lastError === 'unauthorized' || mcp.lastError === 'invalid_grant')) {
        setStatus({ state: 'reconnect', code: 'need_reconnect' });
      } else {
        setStatus({ state: 'unpaired', code: '' });
      }
      return { ok: false, code: 'not_paired', sent: false };
    }
    const owner = store.getItem(CRED_USER_KEY);
    if (owner && owner !== session.userId) {
      clearLocalCred();
      stopHeartbeat();
      setStatus({ state: 'unpaired', code: '' });
      return { ok: false, code: 'not_paired', sent: false };
    }

    const c = await ensureClient();
    // Keep the interval alive across a failed beat: a network blip must not turn
    // into "the App stopped telling the cloud it is here". 401/403 inside the
    // tick clears the credential and stops the loop (device-bridge.js).
    startHeartbeat();
    const out = await c.heartbeat();
    if (out && out.ok) setStatus({ state: 'paired', code: 'ok' });
    else if (out && out.code === 'unauthorized') {
      // device-bridge.js already cleared device_cred and stopped the loop; the
      // host's own "which account paired this" key goes with it. The MCP ACCESS
      // token is dead too (T6): drop it, keep the refresh token for the one explicit
      // retry after the next pairing confirm, and say re-allow the device.
      store.removeItem(CRED_USER_KEY);
      try { await ensureOauth().invalidateAccess({ reason: 'unauthorized' }); } catch (_) {}
      stopHeartbeat();
      setStatus({ state: 'reconnect', code: 'need_reconnect' });
    } else if (out && out.code === 'need_login') {
      // Paired locally but no usable MCP access token. A transient refresh failure
      // is a network story; anything else means the grant must be allowed again.
      let mcp = {};
      try { mcp = ensureOauth().state() || {}; } catch (_) {}
      if (mcp.lastError === 'network') {
        setStatus({ state: 'network', code: 'network_unavailable' });
      } else if (session && session.userId) {
        // T6: no usable MCP grant means the local pair cannot beat anymore. Clear
        // device_cred as well, so the status cannot be mistaken for "paired".
        clearLocalCred();
        stopHeartbeat();
        setStatus({ state: 'reconnect', code: 'need_reconnect' });
      } else {
        setStatus({ state: 'signed_out', code: 'need_login' });
      }
    } else if (out && (out.code === 'network_unavailable' || out.code === 'server_error')) {
      setStatus({ state: 'network', code: 'network_unavailable' });
    } else if (out && out.code === 'not_paired') setStatus({ state: 'unpaired', code: '' });
    return out;
  }

  function boot(docRef) {
    const doc = docRef || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.addEventListener !== 'function') return { installed: false };
    if (bootedDoc === doc) return { installed: false };
    bootedDoc = doc;

    const onVisibility = () => {
      if (doc.visibilityState !== 'visible') return Promise.resolve(null);
      return onForeground().catch(noop);
    };
    doc.addEventListener('visibilitychange', onVisibility);
    if (auth && typeof auth.onChange === 'function') {
      try { auth.onChange((session) => { noteSession(session).catch(noop); }); } catch (_) {}
    }
    // Launch counts as an entry. A signed-out or unpaired launch is a quiet
    // no-op — it must not paint an error on a page the user never opened.
    if (doc.visibilityState === 'visible') onForeground().catch(noop);
    return { installed: true };
  }

  // The same client, exposed as the object agent/session.js expects. Every call
  // resolves the client lazily, so it can be handed out before storage is ready.
  // `register` is NOT here: pairing goes through pair()/pairingBridge so the OAuth
  // exchange can never be reached without the local confirm gate.
  function agentBridge() {
    const withClient = (fn) => ensureClient().then(fn);
    return {
      bootstrap: (o) => withClient((c) => c.bootstrap(o)),
      heartbeat: () => withClient((c) => c.heartbeat()),
      // T6: revoke ends the device session, so the MCP access token that was used
      // for it goes too. The refresh token stays in its Keychain slot — the next
      // pairing confirm may still find the same account and skip a browser consent.
      revoke: () => withClient(async (c) => {
        const out = await c.revoke();
        try { await ensureOauth().invalidateAccess({ reason: 'revoked' }); } catch (_) {}
        return out;
      }),
      hasCred,
      isHeartbeatRunning,
      startHeartbeat: (o) => withClient((c) => c.startHeartbeat(o)),
      stopHeartbeat,
      clearLocalCred,
    };
  }

  return {
    // test / probe surface
    ensureClient,
    agentBridge,
    onStatus,
    status: statusNow,
    // settings entry
    pair,
    // lifecycle
    boot,
    onForeground,
    noteSession,
    startHeartbeat,
    stopHeartbeat,
    isHeartbeatRunning,
    hasCred,
    clearLocalCred,
    pairedSession: () => store.getItem(CRED_USER_KEY),
  };
}

// One host for the page. Created lazily so importing this module can never touch
// LearnAuth / chrome / document at load time (the #quick panel and the vm tests
// both import it).
let singleton = null;

function defaultHost() {
  if (singleton) return singleton;
  const A = typeof LearnAuth !== 'undefined' ? LearnAuth : null;
  singleton = createHost({
    auth: A ? {
      current: () => A.current(),
      currentStable: () => A.currentStable(),
      token: () => A.token(),
      onChange: (fn) => A.onChange(fn),
    } : null,
    storage: (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null,
    appVersion: () => Registry.version(),
    flavor: () => Registry.flavor(),
  });
  return singleton;
}

export const deviceBridgeHost = {
  boot: (doc) => defaultHost().boot(doc),
  pair: (o) => defaultHost().pair(o),
  onForeground: () => defaultHost().onForeground(),
  onStatus: (fn) => defaultHost().onStatus(fn),
  status: () => defaultHost().status(),
  agentBridge: () => defaultHost().agentBridge(),
  noteSession: (s) => defaultHost().noteSession(s),
  isHeartbeatRunning: () => defaultHost().isHeartbeatRunning(),
  hasCred: () => defaultHost().hasCred(),
  clearLocalCred: () => defaultHost().clearLocalCred(),
};
