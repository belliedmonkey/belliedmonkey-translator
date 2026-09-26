// store/view-store.js — view routing as a single value plus a back stack.
//
// Today's app shell toggles a `.hidden` class on a dozen sections, each module
// flipping its own — which shipped the "two home screens visible at once" bug and
// needs manual repaint choreography on every switch. A single `current` value
// makes that structurally impossible: there is nothing to be out of sync with.
//
// The initial view is the host's decision (PR6a feeds the #quick fork in here as
// the initial value — the fork becomes data instead of a second page-load path).
// `back()` pops cameFrom; with an empty stack it returns false and the view does
// not change — "go back" must never strand the user on a blank screen.
//
// What this is NOT: a router. No URLs, no history API — the app runs on file://
// inside one WKWebView, and the extension pages have no URL space to speak of.
// PR2 ships the mechanism and its tests; no page binds to it until PR6a.

const ViewStore = (() => {
  let current = null;
  let stack = [];            // cameFrom, newest last
  let snapshot = freeze();
  const subscribers = new Set();

  function freeze() { return Object.freeze({ current, depth: stack.length }); }
  function publish() {
    snapshot = freeze();
    for (const fn of [...subscribers]) {
      try { fn(current); }
      catch (e) { try { console.error('[view-store] subscriber threw', e); } catch (_) {} }
    }
  }

  // Hosts call this once at boot, before first paint. A re-boot on a live store
  // is a caller bug; refuse it rather than silently rebuilding the stack.
  function boot(initial) {
    if (current !== null) throw new Error('ViewStore.boot called twice');
    current = String(initial || '');
    publish();
  }

  // Navigate to a view, remembering where we came from. `replace` moves without
  // growing the stack (re-render of the same view, or replacing a transient one).
  function navigate(view, opts) {
    const next = String(view || '');
    if (next === current) return false;
    if (opts && opts.replace) {
      if (stack.length) stack[stack.length - 1] = current;
      else stack.push(current);
    } else {
      stack.push(current);
    }
    current = next;
    publish();
    return true;
  }

  // Pop the back stack. Returns false (and changes nothing) when there is
  // nowhere to go back to.
  function back() {
    if (!stack.length) return false;
    current = stack.pop();
    publish();
    return true;
  }

  function getSnapshot() { return snapshot; }
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return { boot, navigate, back, getSnapshot, subscribe };
})();

export default ViewStore;
