// store/settings-store.js — the one settings store, riding the chrome.storage bus.
//
// The bus differs by host but speaks one protocol: the extension has the real
// chrome.storage.local + onChanged; the app has app/chrome-shim.js over
// localStorage with an asynchronous, value-diffing onChanged of the same shape.
// This store is the page's SINGLE subscriber to that bus. Before it, every page
// subscribed (or didn't) on its own, which is how the app shipped the "config TTS
// and return — podcast entry still missing until relaunch" class of bug
// (chrome-shim.js header, 2026-09-06): a page that read once at load had nobody
// left to tell it that anything changed.
//
// Read truthfulness (domain-design §9.1 law 2): init() goes through
// PageSettings.read, whose {ok:false} means the read FAILED — never "no settings
// yet". A failed init keeps values empty, sets status:'error', and hands the
// reason up; it must not be painted over with defaults. The user's provider and
// key silently reverting to the free channel is the incident this exists to keep
// impossible (extension/learn/page-settings.js, 2026-08-05).
//
// set() is optimistic: the in-memory snapshot takes the value and subscribers are
// notified BEFORE the write resolves, so a control paints instantly. Our own
// onChanged echo is then swallowed via pendingEcho — comparing by JSON because
// real storage round-trips objects into fresh references, so `===` would
// misclassify every object-valued key's echo as an external write. A failed write
// rolls the snapshot back — unless an external write landed meanwhile, in which
// case the external value wins (the pending guard makes this a one-line check).
//
// React binds through store/hooks.js (useSyncExternalStore); command-page
// consumers can use subscribe()/get() directly. No file in src/store imports
// React.
//
// src/ is ESM at source level, bundled to IIFE for pages (build/run-esbuild.js).
// PageSettings is NOT imported: it stays a standalone script section (the app
// loads it unmodified — chrome-shim.js header), resolved as a page global at
// runtime; init() reports its absence as a read failure.

import SETTINGS_SCHEMA from './schema.js';

const SettingsStore = (() => {
  let values = Object.freeze({});   // only keys actually present in storage
  let status = 'loading';           // 'loading' | 'ok' | 'error'
  let error = null;                 // init failure reason (ok:false passthrough)
  let snapshot = freeze();
  let inited = false;

  const subscribers = new Set();    // fn(changes: {key: {old, new}})

  function freeze() { return Object.freeze({ values, status, error }); }
  function publish(changes) {
    snapshot = freeze();
    for (const fn of [...subscribers]) {
      try { fn(changes); }
      catch (e) { try { console.error('[settings-store] subscriber threw', e); } catch (_) {} }
    }
  }

  const pending = new Map();        // key -> JSON of the value WE wrote, awaiting its echo
  const j = (v) => JSON.stringify(v);

  // ── init ──────────────────────────────────────────────────────────────────
  // Full read at boot. `keys` narrows to a surface's list (SETTINGS_SCHEMA.
  // keysFor(...)); omitted = every key in the schema. Never throws.
  async function init(keys) {
    const want = (keys && keys.length ? keys : SETTINGS_SCHEMA.KEYS).slice();
    if (typeof PageSettings === 'undefined') {
      // The host forgot page-settings.js. Same silence this store exists to
      // prevent — surface it as a read failure instead of painting defaults.
      status = 'error';
      error = 'PageSettings is not loaded on this page (page-settings.js missing)';
      inited = true;
      publish({});
      return { ok: false, error };
    }
    const r = await PageSettings.read(want);
    if (!r.ok) {
      status = 'error';
      error = r.error || 'settings read failed';
    } else {
      status = 'ok';
      error = null;
      values = Object.freeze(Object.assign({}, r.data));
    }
    inited = true;
    publish({});
    return { ok: r.ok, error: r.ok ? null : error };
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  // Effective value: storage value, else the schema default. Before init(),
  // defaults still flow — a page paints its initial frame without waiting for
  // the async read, exactly like today's pages do.
  function get(key) {
    const v = values[key];
    return v === undefined ? SETTINGS_SCHEMA.defaultFor(key) : v;
  }
  function getSnapshot() { return snapshot; }
  function isReady() { return inited; }

  // ── writes ────────────────────────────────────────────────────────────────
  // Optimistic set of one key. Resolves {ok, error} from the actual write.
  function set(key, value) {
    if (!(key in SETTINGS_SCHEMA.spec)) {
      return Promise.resolve({ ok: false, error: `unknown settings key: ${key}` });
    }
    const old = get(key);
    const hadKey = key in values;
    const next = Object.assign({}, values, { [key]: value });
    values = Object.freeze(next);
    pending.set(key, j(value));
    publish({ [key]: { old, new: value } });
    return PageSettings.write({ [key]: value }).then((r) => {
      if (r.ok) return { ok: true, error: null };
      // Roll back only if nobody has written this key since us.
      if (pending.get(key) === j(value)) {
        pending.delete(key);
        const now = get(key);
        // Restore the exact prior shape: a key that was never in storage must
        // not stay in the snapshot just because its rollback value happens to
        // equal the schema default.
        const rolled = Object.assign({}, values);
        if (hadKey) rolled[key] = old; else delete rolled[key];
        values = Object.freeze(rolled);
        publish({ [key]: { old: now, new: get(key) } });
      }
      return { ok: false, error: r.error || 'settings write failed' };
    });
  }

  // ── the one bus subscription ──────────────────────────────────────────────
  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes) return;
    const out = {};
    for (const key of Object.keys(changes)) {
      if (!(key in SETTINGS_SCHEMA.spec)) continue;   // not ours: grant flows, caches…
      const incoming = changes[key].newValue;
      if (pending.has(key)) {
        if (pending.get(key) === j(incoming)) { pending.delete(key); continue; } // our echo
        pending.delete(key);                        // stale echo of an older write — yield
      }
      const old = get(key);
      const next = Object.assign({}, values);
      if (incoming === undefined) delete next[key]; else next[key] = incoming;
      values = Object.freeze(next);
      out[key] = { old, new: get(key) };
    }
    if (Object.keys(out).length) publish(out);
  }
  function bindStorage() {
    try { chrome.storage.onChanged.addListener(onStorageChanged); }
    catch (e) { console.error('[settings-store] cannot subscribe to storage.onChanged', e); }
  }

  // ── subscriptions ─────────────────────────────────────────────────────────
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }
  function subscribeKey(key, fn) {
    return subscribe((changes) => { if (changes && changes[key]) fn(get(key), changes[key]); });
  }

  bindStorage();
  return { init, get, getSnapshot, isReady, set, subscribe, subscribeKey };
})();

export default SettingsStore;
