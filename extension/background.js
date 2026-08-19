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

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get([...Object.keys(DEFAULT_SETTINGS), 'ytTextColor', 'colorMigrated2026'], (existing) => {
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

    // The 2026-08 endpoint migration (#147) deliberately does NOT live here. It is not
    // part of correctness — wire-format.js's legacy branch already keeps a device that
    // never migrated requesting exactly what it requested before — so it has no race to
    // win, and it needs the flavor-filtered frozen table that ships in providers.gen.js,
    // which a `type: module` service worker cannot load. It runs on the settings pages
    // instead, where both facts are comfortable.

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

// ─── Proxy a transport fetch on request (domain-design §5.4 + §5.5) ─────────
//
// Two different callers need this, on two different browsers:
//   · Firefox (§5.4) applies the HOST PAGE's CSP to a content script's fetch, so a
//     provider the visited site does not allowlist cannot be reached from there at all.
//     Firefox therefore uses this path for EVERY request.
//   · Everywhere else (§5.5) a content script's fetch goes out AS THE PAGE, so an
//     endpoint that validates `Origin` refuses the OPTIONS preflight and the request
//     never leaves the browser. Those callers use this path only AFTER a direct fetch
//     has already failed.
//
// ⚠️ **This listener is registered unconditionally, and that is load-bearing.** It was
// once gated behind `IS_FIREFOX` on the theory that a Firefox-only handler made the
// Safari rule ("translation never depends on the background") true by construction.
// That was the wrong place to enforce it: 2026-08-19, §5.5's caller-side fallback
// shipped for Chrome and did nothing, because the message it sent had no listener —
// the settings page passed its self-check (an extension page is CORS-exempt) while
// every paragraph on a real page still failed. The invariant lives on the CALLER side,
// where `apiFetch` always tries direct first; registering a handler nobody calls costs
// nothing and creates no dependency.
const PROXY_TIMEOUT_MS = 20000;   // matches REQUEST_TIMEOUT_MS in translation-api.js
{
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 「在吗」探针。内容脚本用它在**发第一个请求之前**判断后台是否可达，从而选路
    // （domain-design §5.5）。为什么需要它：proxyFetch 的等待上限必须覆盖整个往返
    // （后台替调用方打完 API 才回话，20 秒量级），所以那个超时没法用来判断「worker
    // 是不是死了」——真死了的话每段都要干等 20 秒。探针是纯本地 IPC，毫秒级。
    if (msg && msg.action === 'ping') { sendResponse({ ok: true }); return; }
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
