// learn/page-settings.js — reading settings from an EXTENSION PAGE.
//
// Content scripts read `chrome.storage.local` fine on every platform we ship to.
// Extension pages on Safari iOS do not: verified 2026-08-05 on iPhone 17 Pro /
// iOS 26.5, where the options page and the popup both came back with nothing while
// the content script on the same device, at the same moment, read the same keys and
// translated with the configured provider. The user-visible result was that every
// setting appeared to revert — you would re-enter your API key on every visit.
//
// The mechanism is NOT isolated (that needs a Web Inspector session). Two candidates
// remain: the array form `get([...])` behaving differently there, or the callback
// arriving with nothing at all. So this helper does not bet on either — it tries the
// normal read, and only if the result contains none of the keys we asked for does it
// fall back to a full read and filter. Where the array form works, this is exactly
// one call and nothing changes.
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
