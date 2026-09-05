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
  // **这里曾经同步播种 `ttsMode: 'assist'`，2026-09-04 去掉了。**
  //
  // 去掉的理由：语音不再默认可用（`LearnTTS.DEFAULTS.engineId` 已改为 ''），
  // 而 'assist' 的意思是「显示原文，可点播放」—— 在没有引擎的情况下那就是一个
  // **点了必然失败的播放键**，仓库里有前科。默认回到 'off'，与扩展一致。
  //
  // ⚠️ **但那段注释记的竞态仍然成立，别把它一起丢掉**：`review.js` 在 bundle
  // 加载时**只读一次**设置，而 `AppSettings.ensureDefaults` 是异步的、会输掉这场
  // 竞速。所以将来若又需要给 App 一个**非默认**的初始值，它必须播种在**这里**
  // （同步、在 review.js 之前），而不是 ensureDefaults 里。

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
