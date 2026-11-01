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
import { ACTIONS, DISCONNECT as DISCONNECT_COPY, MESSAGES, failureRow } from '../../agent/copy.js';
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
// ACCEPT-U1/U4: the connected-state label, hint and its own confirm sheet. All
// four states (connected / pending / reconnect / unpaired) read from this lock.
export const DISCONNECT = DISCONNECT_COPY;

// The client's own keys plus one host key: which account asked for this pairing.
// A device_cred belongs to the session that registered it, and a second account
// signing in on the same Mac must not keep beating with it. The MCP OAuth meta keys
// (client_id / expiry / owner — no token values) share the same preload so the OAuth
// client's synchronous meta surface works from the first call.
const CRED_USER_KEY = 'device_cred_user';
// D.8 / T5: "re-allow this device" is a state, not a toast. A 401 removes the
// credential immediately, and the App may be relaunched before the user opens
// Settings — so the fact has to survive the process, or the next launch paints
// "unpaired" over a pairing the cloud already refused. This key is a reason
// marker, not a credential (one byte, no token, no account).
const RECONNECT_KEY = 'device_reconnect';
const STORED_KEYS = Object.values(Bridge.KEYS)
  .concat([CRED_USER_KEY, RECONNECT_KEY], Object.values(OAUTH_META));

function statusText(state) {
  if (state === 'paired') return MESSAGES.paired;
  if (state === 'pending') return DISCONNECT.pending;
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
  // ACCEPT-U2: a revoke that answers 401 must not repaint the reconnect state in
  // the middle of an explicit disconnect. The user asked to unpair; unpair wins.
  let disconnecting = false;
  let disconnectEpoch = 0;
  const disconnectTimeoutMs = Number(opts.disconnectTimeoutMs) > 0
    ? Number(opts.disconnectTimeoutMs) : 8000;
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
    const has = store.getItem(Bridge.KEYS.cred) != null;
    // A credential that vanished under a "paired" state (the device client clears
    // it synchronously on 401, before the host callback runs) must never print
    // 已连接此设备. The state is repaired by unauthorizedFallout; this only makes
    // the in-between instant honest.
    const state = status.state === 'paired' && !has ? 'unpaired' : status.state;
    return Object.freeze(Object.assign({}, status, {
      state,
      text: statusText(state),
      paired: has,
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
    // A 401 leaves a reason marker behind. It outranks "unpaired" across a relaunch:
    // the credential is gone, but the user's next step is still "allow this device
    // again", not "pair a device you never paired".
    if (store.getItem(RECONNECT_KEY) === '1') return setStatus({ state: 'reconnect', code: 'need_reconnect' });
    let mcp = {};
    try { mcp = ensureOauth().state() || {}; } catch (_) {}
    if (mcp.lastError === 'unauthorized' || mcp.lastError === 'invalid_grant') {
      return setStatus({ state: 'reconnect', code: 'need_reconnect' });
    }
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
        // Every device POST goes through the same 401 branch in the client, so
        // the App's fallout cannot depend on which call site noticed it.
        onUnauthorized: () => unauthorizedFallout(),
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
    store.removeItem(RECONNECT_KEY);
  }

  // The one D.8 fallout. Any 401/403 — foreground beat, the client's own interval,
  // agentBridge heartbeat/bootstrap, register — lands here: the device credential
  // goes, the loop stops, the MCP **access** token leaves the Keychain, and the
  // status says 需重新允许连接此设备. Idempotent, because a 401 and the next
  // foreground can both fire.
  async function unauthorizedFallout() {
    // During an explicit disconnect the local teardown is already the user's
    // intent. A 401 from the best-effort revoke is not a "re-allow this device"
    // event: keep the final state unpaired instead of flipping to reconnect.
    if (disconnecting) {
      stopHeartbeat();
      clearLocalCred();
      return;
    }
    stopHeartbeat();
    clearLocalCred();
    try { await ensureOauth().invalidateAccess({ reason: 'unauthorized' }); } catch (_) {}
    store.setItem(RECONNECT_KEY, '1');
    setStatus({ state: 'reconnect', code: 'need_reconnect' });
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
    // A new pairing intent ends any late-disconnect suppression window.
    disconnectEpoch += 1;
    disconnecting = false;
    const session = await currentSession();
    const login = !!(session && session.userId);
    const ui = o.ui || defaultUi || pairingUi(o.onSignIn);

    if (!login) setStatus({ state: 'signed_out', code: 'need_login' });
    // ACCEPT-U1: while the authorize/exchange/register flow is in front of the user
    // the entry is pending. The view disables the button and shows 正在连接…; there
    // is no disconnect control on the same screen until the flow settles.
    else setStatus({ state: 'pending', code: 'pairing' });

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

    let receipt;
    try {
      receipt = await requestPairing(ctx, ui);
    } catch (e) {
      // A thrown gate must not strand the button in pending. Restore the state the
      // local credentials support (paired / reconnect / unpaired).
      await refreshStatus();
      throw e;
    }
    // Cancel is not a state change: no HTTP, no token, no credential. Restore the
    // pre-click state explicitly because pair() painted pending before the card.
    if (receipt && receipt.code === 'cancelled') {
      await refreshStatus();
      return receipt;
    }
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
          // The cloud refused the grant. unauthorizedFallout also stops the loop and
          // drops the access token (the refresh token stays for one explicit retry
          // after the next pairing confirm); the status says re-allow, not "signed out".
          await unauthorizedFallout();
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
      store.removeItem(RECONNECT_KEY);
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
        await unauthorizedFallout();
      } else {
        setStatus({ state: 'signed_out', code: 'need_login' });
      }
      return;
    }
    if (code === 'network_unavailable') { setStatus({ state: 'network', code }); return; }
    setStatus({ state: 'error', code: code || '' });
  }

  // ── disconnect (Settings connected state) ───────────────────────────────
  // ACCEPT-U2 order is load-bearing:
  //   1. stop the heartbeat immediately;
  //   2. if an MCP Bearer still exists, fire the frozen best-effort revoke;
  //   3. whether it returns 200, 401 or a network error, clear device_cred and
  //      both Keychain slots (mcp_access + mcp_refresh);
  //   4. flip the UI to unpaired now, without waiting for the cloud receipt.
  // No account sign-out, no cloud-corpus delete, no assistant-side connector
  // removal. The revoke response is recorded for evidence but never gates the UI.
  async function disconnect() {
    await store.ready();
    const epoch = ++disconnectEpoch;
    disconnecting = true;
    const hadCred = hasCred();
    // 1. local heartbeat stop is not allowed to wait for anything.
    stopHeartbeat();

    // 2. capture the Bearer before the Keychain is cleared. A refresh here is the
    // last legitimate cloud read; if it fails there is no Bearer to revoke with.
    let token = '';
    if (hadCred) {
      try { token = await getAccessToken(); } catch (_) { token = ''; }
    }

    let revokePromise = null;
    if (hadCred && token) {
      const c = await ensureClient();
      // revoke() clears device_cred and stops the loop synchronously, then POSTs
      // with the captured Bearer. Do not await it before the local/UI teardown.
      revokePromise = c.revoke({ token }).catch((e) => ({
        ok: true, revoked: true, cloud: false, status: 0,
        code: 'network_unavailable', error: String((e && e.message) || e || ''),
      }));
    } else {
      clearLocalCred();
    }

    // 3. always clear the MCP grant, even if revoke failed or never happened.
    try { await ensureOauth().clearTokens(); } catch (_) {}
    clearLocalCred();
    store.removeItem(RECONNECT_KEY);

    // 4. unpaired is the user's explicit choice; a 401 revoke must not flip it.
    setStatus({ state: 'unpaired', code: '' });

    const fallback = {
      ok: true, revoked: false, cloud: false, status: 0,
      code: hadCred ? 'no_bearer' : 'not_paired', attempted: false,
    };
    const settled = revokePromise || Promise.resolve(fallback);
    // A hung cloud call must not keep the Settings click busy forever. The UI has
    // already flipped; the timeout only bounds the receipt we return.
    let timeoutId = null;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), disconnectTimeoutMs);
    });
    const revoke = await Promise.race([settled, timeout]);
    if (timeoutId != null) clearTimeout(timeoutId);

    if (revoke == null) {
      // Still in flight: keep the 401 guard until it settles, then enforce the
      // user's unpaired intent one final time. A later pairing bumps the epoch and
      // owns the state from then on.
      settled.then(() => {
        if (epoch !== disconnectEpoch) return;
        disconnecting = false;
        setStatus({ state: 'unpaired', code: '' });
      }, () => {});
      return {
        ok: true,
        state: 'unpaired',
        had_cred: hadCred,
        bearer: !!token,
        revoke: { attempted: true, ok: false, code: 'timeout', status: 0, timed_out: true },
      };
    }

    if (epoch === disconnectEpoch) disconnecting = false;
    // A late status callback (e.g. the revoke's own 401 fallout) must not win.
    setStatus({ state: 'unpaired', code: '' });

    return {
      ok: true,
      state: 'unpaired',
      had_cred: hadCred,
      bearer: !!token,
      revoke: {
        attempted: revoke.attempted === true,
        ok: revoke.cloud === true,
        code: revoke.code || (revoke.cloud === true ? 'ok' : 'failed'),
        status: Number(revoke.status) || 0,
        timed_out: false,
      },
    };
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
      if (store.getItem(RECONNECT_KEY) === '1'
        || (session.userId && (mcp.lastError === 'unauthorized' || mcp.lastError === 'invalid_grant'))) {
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
    if (out && out.ok) {
      store.removeItem(RECONNECT_KEY);
      setStatus({ state: 'paired', code: 'ok' });
    } else if (out && out.code === 'unauthorized') {
      // The client's 401 branch already called unauthorizedFallout through
      // onUnauthorized; call it again so a future client without the hook (or a
      // host built without it) still lands in the same state. It is idempotent.
      await unauthorizedFallout();
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
        await unauthorizedFallout();
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
    // Launch counts as an entry — unconditionally. WKWebView can report the page
    // hidden while the window is occluded/not yet key, and it does not always emit
    // a visibilitychange when the window later appears. Gating the launch beat on
    // visibility was therefore a silent dead end: the App never sent its first
    // heartbeat after a restart, so it could never discover a revoked session.
    // A signed-out or unpaired launch is still a quiet no-op (no request).
    onForeground().catch(noop);
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
        // A revoke ends the session on purpose: same state as a 401, and it must
        // not keep claiming 已连接此设备.
        clearLocalCred();
        store.setItem(RECONNECT_KEY, '1');
        setStatus({ state: 'reconnect', code: 'need_reconnect' });
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
    disconnect,
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
  disconnect: () => defaultHost().disconnect(),
  onForeground: () => defaultHost().onForeground(),
  onStatus: (fn) => defaultHost().onStatus(fn),
  status: () => defaultHost().status(),
  agentBridge: () => defaultHost().agentBridge(),
  noteSession: (s) => defaultHost().noteSession(s),
  isHeartbeatRunning: () => defaultHost().isHeartbeatRunning(),
  hasCred: () => defaultHost().hasCred(),
  clearLocalCred: () => defaultHost().clearLocalCred(),
};
