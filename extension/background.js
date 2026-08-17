// background.js — Minimal service worker (state management only)
// IMPORTANT: Translation API calls are NOT routed through here due to a Safari iOS bug
// where the service worker becomes permanently undefined after device lock.
// All translation fetches happen directly in content scripts (translation-api.js).

const DEFAULT_SETTINGS = {
  enabled: false,
  targetLang: 'zh-CN',
  uiLang: 'auto',        // UI-chrome language; 'auto' = follow the OS/browser locale
  provider: 'google',
  apiKey: '',
  apiBaseUrl: '',
  textColor: '#56633f',
  fontSize: '1.0',       // translation font size as a scale relative to the original
  showFab: true,
  bilingualMode: 'below'
};

// Service worker lifecycle (Chrome/Safari only — Firefox uses background scripts)
if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', () => self.skipWaiting?.());
  self.addEventListener('activate', (e) => e.waitUntil?.(self.clients?.claim()));
}

// ─── Frozen endpoint snapshot, 2026-08 (#147) ──────────────────────────────
//
// This is HISTORY, not configuration. Before the zero-concatenation change, every
// stored base URL was consumed as `base + path`, where `path` came from the registry.
// That makes "which URL did the old code request" exactly computable, so the migration
// below needs no guess about what a stored value meant.
//
// Three rules: never read this from the registry (the registry now holds complete
// endpoints); never change an existing value; never add an entry created afterwards
// (a new entry has no "before").
//
// It is a LITERAL COPY of WireFormat.LEGACY_PATHS. This service worker is declared
// `"type": "module"`, so `importScripts` is unavailable, and wire-format.js is a
// classic IIFE that assigns to `window` — it can be neither imported nor imported-from.
// background.js already keeps literals for exactly this reason (build.js grants it a
// palette exemption; test/background.test.js:17 records that an MV3 worker cannot
// <script>-load a .gen.js). test/base-url-migration.test.js pins the two copies equal.
const LEGACY_ENDPOINTS_2026_08 = {
  chat: {
    openai: '/v1/chat/completions',
    claude: '/v1/messages',
    deepseek: '/v1/chat/completions',
    glm: '/api/paas/v4/chat/completions',
    qwen: '/v1/chat/completions',
    kimi: '/v1/chat/completions',
    custom_chat: '/v1/chat/completions',
    custom_msg: '/v1/messages',
  },
  tts: { local: '/v1/audio/speech', openai_speech: '/v1/audio/speech' },
  stt: { local: '/v1/audio/transcriptions', openai_transcribe: '/v1/audio/transcriptions' },
};
// Trailing-slash policy AS IT WAS per capability: translation and notes concatenated
// directly, speech and transcription trimmed first. Reproducing the difference is the
// point — that `//` is what those users are running today, and "fixing" it here would
// change behaviour on no evidence.
const LEGACY_STRIPS_SLASH_2026_08 = { chat: false, tts: true, stt: true };

// Which stored address pairs with which stored engine id. Identical in both hosts:
// the app's 解析引擎 writes the same `provider` + `apiBaseUrl` pair the extension's
// translator uses (app/settings.js) — the two mean different features but the same
// keys, so the migration never has to know which host it is running in.
const ENDPOINT_KEY_PAIRS = [
  ['apiBaseUrl', 'provider', 'chat'],
  ['notesBaseUrl', 'notesProvider', 'chat'],
  ['ttsBaseUrl', 'ttsEngine', 'tts'],
  ['sttBaseUrl', 'sttEngine', 'stt'],
];

// Returns the complete endpoint the OLD code would have requested, or null when there
// is nothing to do. Pure, and exported for the test that pins it against the app's copy.
function migrateEndpoint(stored, entryId, cap) {
  if (typeof stored !== 'string' || !stored.trim()) return null;   // empty = follow the default
  const table = LEGACY_ENDPOINTS_2026_08[cap];
  const path = table && table[entryId];
  if (!path) return null;                       // unknown/absent id, or an entry with no path
  const s = stored.trim();
  if (s.endsWith(path)) return null;            // already migrated — idempotent
  const base = LEGACY_STRIPS_SLASH_2026_08[cap] ? s.replace(/\/+$/, '') : s;
  return base + path;
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get([...Object.keys(DEFAULT_SETTINGS), 'ytTextColor', 'colorMigrated2026',
    'notesBaseUrl', 'ttsBaseUrl', 'sttBaseUrl',
    'notesProvider', 'ttsEngine', 'sttEngine', 'endpointMigrated2026'], (existing) => {
    const have = existing || {};          // Safari hands callbacks undefined
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (have[k] === undefined) toSet[k] = v;
    }
    // 2026-08 rebrand (design/handoff.md): install wrote the old defaults into
    // storage, so "still on the default" is only detectable by value. ONE-SHOT,
    // gated by a marker — a value match alone would also rewrite a user who
    // deliberately picks plain white subtitles AFTER the rebrand, forever.
    // `existing` (not `have`) in the guard: when Safari hands the callback
    // undefined, we never SAW real values — spending the one-shot marker on a
    // failed read would strand that user on the old colours permanently.
    if (existing && !have.colorMigrated2026) {
      if (have.textColor === '#0a7a3c') toSet.textColor = '#56633f';
      if (have.ytTextColor === '#ffffff') toSet.ytTextColor = '#ccdbb2';
      toSet.colorMigrated2026 = true;
    }

    // Endpoints become verbatim (#147). Same two hard lessons as the colour migration
    // above: a one-shot MARKER rather than a value match, and `existing` (not `have`)
    // in the guard — when Safari hands the callback undefined we never SAW the values,
    // and spending the one-shot marker on a failed read would strand that install.
    //
    // Only NON-EMPTY values are touched. Empty means "follow the registry default", and
    // freezing today's default host into storage would both break the debugging recipe
    // in verification-spec §1 (point defaultEndpoint at a local logger, leave the field
    // blank) and permanently pin users to an endpoint we may later change.
    //
    // The backup keys are cheap insurance for the one irreversible write in this
    // change, and they go in the SAME set() as the values: two writes could be
    // interrupted between them, leaving a value changed with no way back.
    if (existing && !have.endpointMigrated2026) {
      for (const [urlKey, idKey, cap] of ENDPOINT_KEY_PAIRS) {
        const next = migrateEndpoint(have[urlKey], have[idKey], cap);
        if (!next) continue;
        toSet[urlKey] = next;
        toSet[urlKey + 'PreVerbatim'] = have[urlKey];
        toSet[urlKey + 'Verbatim'] = true;
      }
      toSet.endpointMigrated2026 = true;
    }

    if (Object.keys(toSet).length > 0) chrome.storage.local.set(toSet);
  });

  // First run only: put a dot on the toolbar icon so the user looks at the popup
  // once. The default provider needs no key and works immediately, which is exactly
  // the trap — it is not a stable endpoint, so a user who never opens settings meets
  // its flakiness first and reads it as "broken". The popup carries the explanation
  // (see the setup note there); this is only what makes them open it.
  //
  // A DOT, not "!": the shipped default is a WORKING configuration, and a permanent
  // error badge on something that works is crying wolf. It clears the first time the
  // popup opens.
  //
  // This deliberately replaces an earlier attempt that called openOptionsPage() here.
  // That hijacks a tab at install time, and it is not a harmless one: it hung the
  // layout suite indefinitely, because loading the extension over CDP fires
  // onInstalled and the surprise tab derailed the harness. A side effect our own
  // automation cannot survive is the wrong mechanism, not a harness bug to paper over.
  //
  // Never on 'update', and wrapped — chrome.action is not guaranteed on every Safari
  // surface, and failing to show onboarding must never break the install.
  if (details && details.reason === 'install') {
    try {
      chrome.action.setBadgeText({ text: '•' });
      chrome.action.setBadgeBackgroundColor({ color: '#c67139' });
    } catch (_) { /* onboarding is best-effort */ }
  }
});

// ─── Firefox only: proxy the translation fetch (domain-design §5.4) ─────────
//
// The Safari rule stands everywhere else — translation NEVER goes through the
// background, because Safari iOS's service worker is permanently `undefined` after
// device lock. Firefox is the one exception: it applies the HOST PAGE's CSP to a
// content script's fetch, so a provider the visited site does not allowlist simply
// cannot be reached from there. This listener is registered ONLY on Firefox, so the
// Safari rule holds by construction rather than by everyone remembering it.
const IS_FIREFOX = (() => {
  try { return chrome.runtime.getURL('').indexOf('moz-extension://') === 0; } catch (_) { return false; }
})();

if (IS_FIREFOX) {
  const PROXY_TIMEOUT_MS = 20000;   // matches REQUEST_TIMEOUT_MS in translation-api.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== 'proxyFetch') return;
    (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
      try {
        const r = await fetch(msg.url, Object.assign({}, msg.init, { signal: ctrl.signal }));
        // The body always travels as text; the caller parses. A non-2xx body is sent
        // too — that is where provider error messages live.
        sendResponse({
          ok: r.ok, status: r.status, statusText: r.statusText,
          retryAfterHeader: r.headers.get('retry-after'),
          text: await r.text(),
        });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      } finally {
        clearTimeout(timer);
      }
    })();
    return true;
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.local.get(null, (s) => sendResponse({ settings: s }));
    return true;
  }

  if (msg.action === 'setEnabled') {
    chrome.storage.local.set({ enabled: msg.value }, () => {
      if (sender.tab?.id) {
        chrome.action.setBadgeText({ text: msg.value ? 'ON' : '', tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#c67139', tabId: sender.tab.id });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'saveSettings') {
    chrome.storage.local.set(msg.settings, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'clearCache') {
    chrome.storage.local.get(null, (items) => {
      const cacheKeys = Object.keys(items || {}).filter(k => k.startsWith('tr:'));
      chrome.storage.local.remove(cacheKeys, () => sendResponse({ cleared: cacheKeys.length }));
    });
    return true;
  }
});

// For test/base-url-migration.test.js only. `module` is undefined in a service worker,
// so this is inert at runtime — the same guard every pure module in this repo carries.
// The test pins this frozen table byte-for-byte against WireFormat.LEGACY_PATHS and
// runs both implementations over one shared case table: what has to stay true is that
// the two HOSTS behave identically, and only a test can hold that.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEGACY_ENDPOINTS_2026_08, LEGACY_STRIPS_SLASH_2026_08, ENDPOINT_KEY_PAIRS, migrateEndpoint };
}
