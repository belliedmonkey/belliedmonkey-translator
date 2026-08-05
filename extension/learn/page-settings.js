// learn/page-settings.js — reading settings from an EXTENSION PAGE.
//
// Content scripts read `chrome.storage.local` fine on every platform we ship to.
// Extension pages on Safari iOS do not: verified 2026-08-05 on iPhone 17 Pro /
// iOS 26.5, where the options page and the popup both came back with nothing while
// the content script on the same device, at the same moment, read the same keys and
// translated with the configured provider. The user-visible result was that every
// setting appeared to revert — you would re-enter your API key on every visit.
//
// ⚠️ THIS DOES NOT FIX THE SAFARI iOS SYMPTOM. Verified on device 2026-08-05: with
// this helper in place, reopening the settings page STILL shows the default provider
// instead of the saved one. So the cause is not the array form of `get()` — the
// full-bucket fallback comes back empty too. An extension page on that platform
// appears unable to read `chrome.storage.local` at all, while a content script on the
// same device reads the same keys successfully and writes from this same page do
// persist (the content script sees them).
//
// The file is kept anyway, for what it does do: it makes every extension-page read
// defensive (no throw, no hang, never `undefined`) and puts the retry in one place
// for when the real cause is known. It is NOT a fix, and the comment says so, because
// a helper named like a solution is how a known-open bug gets closed by accident.
//
// Real cause: still open. Next step is a Safari Web Inspector session against the
// options page — nothing short of the console distinguishes "read returned empty"
// from "read never returned".
//
// The full read is the fallback and never the default, deliberately: the same bucket
// holds the unbounded `tr:` translation cache and the `lq:` learning outbox
// (learning-design.md §7), so reading everything is expensive and gets more expensive
// the longer someone uses the product.

var PageSettings = (() => {
  function rawGet(query) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(query, (res) => {
          try { resolve(res || {}); } catch (_) { resolve({}); }
        });
      } catch (_) { resolve({}); }
    });
  }

  // `keys` is the explicit list the caller needs. Returns an object with whatever of
  // those keys exists — never undefined, never a rejected promise.
  async function read(keys) {
    const first = await rawGet(keys);
    if (Object.keys(first).some((k) => keys.indexOf(k) >= 0)) return first;

    // Nothing came back. Either the profile really is empty (a first run — in which
    // case the fallback is one wasted read on a nearly empty bucket) or this platform
    // did not honour the array form.
    const all = await rawGet(null);
    const out = {};
    for (const k of keys) if (k in all) out[k] = all[k];
    return out;
  }

  return { read, rawGet };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PageSettings;
