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
// Cold-start ordering: Swift can fire before the page has attached (that is why
// open-url-bridge.swift stashes __mtDeepLinkPending, and why app.js replays
// __mtApplePending / __mtWebAuthPending right after attaching — "冷启动时结果可能
// 先到，所以两边都兜"). install() replays whichever pending slot exists, then
// clears it.
//
// Migration coexistence: before PR6a, app.js attaches these names itself. Do not
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

  function dispatch(event, args) {
    const fns = handlers.get(event);
    if (!fns) return;
    for (const fn of [...fns]) {
      try { fn.apply(null, args); }
      catch (e) { try { console.error('[native-bridge] handler for ' + event + ' threw', e); } catch (_) {} }
    }
  }

  function onNative(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
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
