// learn/page-settings.js — reading settings from an EXTENSION PAGE, and knowing
// when that read FAILED as opposed to came back empty.
//
// Found with Safari Web Inspector against the simulator's options page, 2026-08-05,
// after two wrong guesses. The two forms of the same call disagree:
//
//   callback form:  cb(undefined)          ← fires, hands back nothing, says nothing
//   promise form:   rejects with
//     "Invalid call to browser.storage.local.get().
//      Failed to create extension storage directory."
//
// So the storage layer was BROKEN, and the callback form reported that as an empty
// result. Our code then did the only thing it could with an empty result: painted
// defaults. The user saw their provider and API key silently revert to the free
// channel — indistinguishable, from the outside, from never having saved them.
//
// That silence is the part that is ours to fix. Prefer the promise form because it is
// the only one that tells the truth; fall back to the callback form (with a
// `lastError` check) for anything that does not return a thenable. Report failure as
// failure — domain-design §9.1 law 2: a surface the user opened deliberately does not
// get to fail quietly.
//
// The storage-directory failure itself turned out to be that simulator's own state:
// after `simctl erase` and a clean setup, settings read back correctly. So this file
// does not exist to work around a platform defect — it exists so that the NEXT
// storage failure, wherever it comes from, cannot masquerade as an empty profile and
// get silently painted over with defaults.

var PageSettings = (() => {
  // Returns {ok, data, error}. `ok:false` means the read FAILED — which is not the
  // same as `{}`, and the caller must not treat it as "no settings yet".
  function rawGet(query) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      try {
        const maybe = chrome.storage.local.get(query, (v) => {
          const le = (chrome.runtime && chrome.runtime.lastError) || null;
          if (le) done({ ok: false, data: {}, error: le.message || String(le) });
          else if (v === undefined || v === null) {
            // The shape Safari hands back when the layer is broken. Without the
            // promise form there is no message to show, so say what we know.
            done({ ok: false, data: {}, error: 'storage returned nothing' });
          } else done({ ok: true, data: v, error: null });
        });
        // Safari (and MV3 Chrome) also return a promise. It is the only path that
        // carries the real reason, so let it win when it settles.
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(
            (v) => done({ ok: true, data: v || {}, error: null }),
            (e) => done({ ok: false, data: {}, error: (e && e.message) || String(e) })
          );
        }
      } catch (e) {
        done({ ok: false, data: {}, error: (e && e.message) || String(e) });
      }
    });
  }

  // `keys` is the explicit list the caller needs. Never throws, always settles.
  async function read(keys) {
    const r = await rawGet(keys);
    if (!r.ok) return r;
    const out = {};
    for (const k of keys) if (k in r.data) out[k] = r.data[k];
    return { ok: true, data: out, error: null };
  }

  // Writes with the same truthfulness contract as rawGet: {ok, error}, promise
  // form preferred (it carries the real reason), lastError checked on the
  // callback path, never throws. A write that silently failed is how a session
  // "saves" and then is gone next launch — same incident class as the read side.
  function mutate(run) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      try {
        const maybe = run(() => {
          const le = (chrome.runtime && chrome.runtime.lastError) || null;
          if (le) done({ ok: false, error: le.message || String(le) });
          else done({ ok: true, error: null });
        });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(
            () => done({ ok: true, error: null }),
            (e) => done({ ok: false, error: (e && e.message) || String(e) })
          );
        }
      } catch (e) {
        done({ ok: false, error: (e && e.message) || String(e) });
      }
    });
  }

  function write(items) {
    return mutate((cb) => chrome.storage.local.set(items, cb));
  }

  function removeKeys(keys) {
    return mutate((cb) => chrome.storage.local.remove(keys, cb));
  }

  return { read, rawGet, write, removeKeys };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PageSettings;
