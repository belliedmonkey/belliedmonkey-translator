// app/chrome-shim.js — the ONLY host shim the app needs.
//
// The review surface is one implementation (learning-design §9): the app loads
// `review.js`, `i18n.js`, `page-settings.js` and `drain.js` **unmodified**, the same
// bytes the extension ships. Those four reach for `chrome.storage.local` and
// `chrome.i18n`, which do not exist outside an extension — so rather than forking
// them (four files that would then drift), the app supplies the two APIs they use.
//
// Deliberately NOT a general-purpose polyfill. It implements exactly what those files
// call and nothing else, because a shim that pretends to be more than it is invites
// code to depend on behaviour that was never really there.
//
// Must be FIRST in the bundle — the modules below it read `chrome` at load time.

(() => {
  if (typeof window.chrome !== 'undefined' && window.chrome.storage) return;

  // ─── storage.local, backed by localStorage ────────────────────────────────
  // Verified available on the app's file:// origin (verification-spec, Stage 2 spike).
  // The callback shape is the important part: `page-settings.js` inspects
  // `chrome.runtime.lastError` and `drain.js` passes key arrays, so a Promise-only
  // shim would silently do nothing in both.
  const PREFIX = 'mt:';
  const readAll = () => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) {
        try { out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch (_) {}
      }
    }
    return out;
  };

  // ─── App-side defaults that must exist BEFORE the first read ─────────────
  // `review.js` reads settings ONCE, at bundle load, from its own top-level boot —
  // and this shim is the only code that runs before it. `AppSettings.ensureDefaults`
  // is async and loses that race, which is how the app shipped with `ttsMode`
  // permanently 'off': the listen tier and the ▶ button gate on it, and nothing
  // app-side ever set it. Seeding here is synchronous, so the first launch after
  // install already has speech. 'assist' (show text, tap to play), not 'audio-first' —
  // hiding every card's text behind audio is a choice the user makes, not a default.
  if (localStorage.getItem(PREFIX + 'ttsMode') == null) {
    try { localStorage.setItem(PREFIX + 'ttsMode', JSON.stringify('assist')); } catch (_) {}
  }

  const storage = {
    get(query, cb) {
      const all = readAll();
      let out;
      if (query == null) out = all;
      else if (typeof query === 'string') out = ({ [query]: all[query] });
      else if (Array.isArray(query)) { out = {}; for (const k of query) if (k in all) out[k] = all[k]; }
      else { out = {}; for (const k of Object.keys(query)) out[k] = (k in all) ? all[k] : query[k]; }
      // Asynchronous on purpose. The real API is, and callers written against a
      // synchronous fake break the moment they meet the real one.
      setTimeout(() => cb && cb(out), 0);
    },
    set(items, cb) {
      for (const [k, v] of Object.entries(items || {})) {
        try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (_) {}
      }
      setTimeout(() => cb && cb(), 0);
    },
    remove(keys, cb) {
      for (const k of [].concat(keys || [])) localStorage.removeItem(PREFIX + k);
      setTimeout(() => cb && cb(), 0);
    },
  };

  window.chrome = Object.assign(window.chrome || {}, {
    storage: { local: storage },
    runtime: {
      // Always undefined: nothing here can produce an extension-messaging error, and
      // `page-settings.js` reads it on every get.
      lastError: undefined,
      getURL: (p) => p,
      // The review page's 「设置」 link. Stage 4 gives the app its own settings; until
      // then this must not throw and must not open a browser window pointing at an
      // extension URL that does not exist here.
      openOptionsPage: () => { throw new Error('app has no options page yet'); },
    },
    i18n: {
      // `i18n.js` consults the bundled MT_I18N_MESSAGES table FIRST and only falls
      // through to chrome.i18n, so returning '' here is not a loss — it just makes the
      // bundled table authoritative, which on a single-locale app shell is correct.
      getMessage: () => '',
      getUILanguage: () => navigator.language || 'zh-CN',
    },
  });
})();
