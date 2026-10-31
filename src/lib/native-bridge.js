// lib/native-bridge.js — the window-level callbacks Swift calls INTO the page.
//
// The ABI (test/build-scripts.test.js cross-checks the Swift side): the host
// evaluates `window.show(...)`, `window.__mtAppleResult(r)`, `window
// .__mtWebAuthResult(r)`, `window.__mtDeepLink(u)` and expects plain functions
// with exactly those names and arities. Signatures never change here.
//
// The adapter objects (AppQuick/AppQuickHost/NativeSpeech/NativeAudio/AppVault
// with their _fromNative/onNative methods) are NOT this file's business — those
// are self-contained modules that outlive the React migration untouched
// (domain-design §10.7).
//
// What changes with React: a view component's lifetime no longer matches the
// page's. A component that assigned window.show directly would clobber the next
// component's handler and leak on unmount. So installBridgeGlobals() hangs ONE
// stable dispatcher per ABI name, components subscribe with onNative() and
// unsubscribe on unmount.
//
// Cold-start ordering: Swift can fire before any view has subscribed. Two
// mechanisms catch those early events (PR9 — this replaced app.js's hand-rolled
// per-callback pending replays, one of which (deeplink) had been dropped on the
// floor by the PR6a move):
//   · open-url-bridge.swift stashes __mtDeepLinkPending etc.; install() replays
//     whichever pending slot exists, then clears it.
//   · dispatch() with zero subscribers HOLDS the args (latest call wins) and
//     onNative() replays a held event to its new subscriber exactly once.
// So call/subscribe ordering across install never drops an event — an event is
// delivered either live or as one replay, never both, never zero.
//
// Migration coexistence: before PR6a, app.js attached these names itself. Do not
// call installBridgeGlobals() on a page where the old implementations are alive —
// install is for the page whose old top-level IIFE is gone, and it overwrites
// unconditionally (idempotent only against itself, via the __mtBridge mark).

const NativeBridge = (() => {
  const g = () => (typeof window !== 'undefined' ? window : globalThis);

  // Plain object literal — same discipline as the PROTOCOL tables the Swift
  // side is regex-checked against: no indirection for the names that cross the
  // bridge. `pending` is the window property an early native call is stashed in.
  const ABIS = [
    { global: 'show',             event: 'show',            pending: null },
    { global: '__mtAppleResult',  event: 'apple-result',    pending: '__mtApplePending' },
    { global: '__mtWebAuthResult', event: 'webauth-result', pending: '__mtWebAuthPending' },
    { global: '__mtDeepLink',     event: 'deeplink',        pending: '__mtDeepLinkPending' },
  ];

  const handlers = new Map();   // event -> Set<fn>
  const held = new Map();       // event -> args that arrived before any subscriber (latest call wins)

  function dispatch(event, args) {
    const fns = handlers.get(event);
    if (!fns || fns.size === 0) { held.set(event, args); return; }
    held.delete(event);   // live delivery supersedes anything held — the newest call is the state
    for (const fn of [...fns]) {
      try { fn.apply(null, args); }
      catch (e) { try { console.error('[native-bridge] handler for ' + event + ' threw', e); } catch (_) {} }
    }
  }

  function onNative(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    // An event that arrived before anyone listened is replayed to this
    // subscription exactly once — through dispatch, so the error isolation is
    // the same code path. (Subscribers added later get nothing: the event was
    // already consumed.)
    if (held.has(event)) {
      const args = held.get(event);
      held.delete(event);
      dispatch(event, args);
    }
    return () => { const s = handlers.get(event); if (s) s.delete(fn); };
  }

  function attach(ab) {
    const w = g();
    if (w[ab.global] && w[ab.global].__mtBridge) return;   // ours already
    w[ab.global] = function () { dispatch(ab.event, Array.prototype.slice.call(arguments)); };
    w[ab.global].__mtBridge = true;
    if (ab.pending && w[ab.pending] != null) {
      const held = w[ab.pending];
      try { w[ab.pending] = null; } catch (_) {}
      dispatch(ab.event, [held]);
    }
  }

  // Attach every ABI name. Idempotent: a second call is a no-op.
  function installBridgeGlobals() { for (const ab of ABIS) attach(ab); }

  // Test/introspection surface: which window names this module owns.
  function abiNames() { return ABIS.map((ab) => ab.global); }

  return { installBridgeGlobals, onNative, dispatch, abiNames };
})();

export default NativeBridge;
