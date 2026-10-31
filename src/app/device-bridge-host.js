// src/app/device-bridge-host.js — BEL-151: what the App must do that the device
// client cannot.
//
// agent/device-bridge.js carries the four POSTs and the local credential, and it
// takes getAccessToken / store / fetch as options on purpose. This module is the
// App half of that contract, and it invents no transport of its own:
//
//   · getAccessToken ← the signed-in LearnAuth session (refresh included). Empty
//     token means no request goes out, and the user is told to sign in — never a
//     silent no-op and never a fake "paired".
//   · store ← this install's chrome.storage.local, read once into a synchronous
//     cache (the device client needs a sync get/set) and written through. One
//     device_id per install; the device_cred is cleared on 401/403 by the client.
//   · pair() ← the Settings entry. It asks agent/session.requestPairing, so the
//     existing needsConfirm gate is the one that runs, and the confirm card is the
//     copy-locked one (agent/copy.js ACTIONS.pair_device). Cancelling sends
//     nothing.
//   · boot() ← the foreground lifecycle: one heartbeat on launch / return to
//     foreground, plus the client's own 2–5 minute interval while paired.
//   · agentBridge() ← the same client for shell-model's agent host, so an
//     inbound open_setup's short-lived bootstrap also has a Bearer path.
//
// It does not claim listening works, does not open the microphone, and does not
// make a machine-local companion a truth source.
//
// Every side effect is injectable: createHost({ bridge, auth, store, storage,
// fetch, now, appVersion, flavor, ui, timers }).

import Bridge from '../../agent/device-bridge.js';
import { ACTIONS, MESSAGES, failureRow } from '../../agent/copy.js';
import { requestPairing } from '../../agent/session.js';
import { pairingUi } from './agent-face.js';
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
// signing in on the same Mac must not keep beating with it.
const CRED_USER_KEY = 'device_cred_user';
const STORED_KEYS = Object.values(Bridge.KEYS).concat([CRED_USER_KEY]);

function statusText(state) {
  if (state === 'paired') return MESSAGES.paired;
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
  let bootedDoc = null;
  let grants = { device: {}, assistants: {} };
  let lastTokenThrew = false;
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

  async function getAccessToken() {
    lastTokenThrew = false;
    if (!auth) return '';
    const session = await auth.current().catch(() => null);
    if (!session) return '';
    try {
      const token = typeof auth.token === 'function' ? await auth.token() : session.accessToken;
      return token ? String(token) : '';
    } catch (_) {
      lastTokenThrew = true;
      return '';
    }
  }

  // A refresh rejected for good kills the LearnAuth session itself; a transient
  // failure leaves it alone. Only the second one is a network story.
  async function primeToken() {
    if (!auth) return { ok: false, signedOut: true };
    try {
      await (typeof auth.token === 'function' ? auth.token() : Promise.resolve(''));
      return { ok: true, signedOut: false };
    } catch (_) {
      const still = await auth.current().catch(() => null);
      return { ok: false, signedOut: !(still && still.userId) };
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
  // clear locally; the cloud's 900 s TTL is the backstop.
  function noteSessionFallout(session) {
    if (!session || !session.userId) { clearLocalCred(); stopHeartbeat(); return 'signed_out'; }
    const owner = store.getItem(CRED_USER_KEY);
    if (hasCred() && owner && owner !== session.userId) {
      clearLocalCred();
      stopHeartbeat();
      return 'switched';
    }
    return '';
  }

  async function noteSession(session) {
    await store.ready();
    const why = noteSessionFallout(session);
    if (why === 'signed_out') return setStatus({ state: 'signed_out', code: 'need_login' });
    if (why === 'switched') return setStatus({ state: 'unpaired', code: '' });
    return refreshStatus();
  }

  // ── pairing (Settings entry) ────────────────────────────────────────────
  async function pair(pairOptions) {
    const o = pairOptions || {};
    await store.ready();
    const session = await currentSession();
    let login = !!(session && session.userId);
    let tokenOk = true;
    if (login) {
      const primed = await primeToken();
      tokenOk = primed.ok;
      if (primed.signedOut) login = false;
    }
    const ui = o.ui || defaultUi || pairingUi(o.onSignIn);

    if (!login) setStatus({ state: 'signed_out', code: 'need_login' });
    else if (!tokenOk) setStatus({ state: 'network', code: 'network_unavailable' });
    else setStatus(hasCred() ? { state: 'paired', code: 'ok' } : { state: 'unpaired', code: '' });

    let bridgeClient = null;
    if (login) bridgeClient = await ensureClient();

    const ctx = {
      readiness: async () => ({ login, network: networkUp() && tokenOk }),
      grants,
      persistGrants(next) {
        grants = {
          device: (next && next.device) || {},
          assistants: (next && next.assistants) || {},
        };
      },
      deviceBridge: bridgeClient || undefined,
      hostConnected: true,
      ports: {},
    };

    const receipt = await requestPairing(ctx, ui);
    await finishPair(receipt, session);
    return receipt;
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
      setStatus({ state: lastTokenThrew ? 'network' : 'signed_out', code: 'need_login' });
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
      setStatus({ state: 'unpaired', code: '' });
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
      // host's own "which account paired this" key goes with it.
      store.removeItem(CRED_USER_KEY);
      setStatus({ state: 'signed_out', code: 'need_login' });
    } else if (out && out.code === 'need_login') {
      setStatus({ state: lastTokenThrew ? 'network' : 'signed_out', code: 'need_login' });
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
  function agentBridge() {
    const withClient = (fn) => ensureClient().then(fn);
    return {
      register: (o) => withClient((c) => c.register(o)),
      heartbeat: () => withClient((c) => c.heartbeat()),
      bootstrap: (o) => withClient((c) => c.bootstrap(o)),
      revoke: () => withClient((c) => c.revoke()),
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
