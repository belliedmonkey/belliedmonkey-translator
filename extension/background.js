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
  textColor: '#0a7a3c',
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
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (existing) => {
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (existing[k] === undefined) toSet[k] = v;
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
      chrome.action.setBadgeBackgroundColor({ color: '#0a7a3c' });
    } catch (_) { /* onboarding is best-effort */ }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.local.get(null, (s) => sendResponse({ settings: s }));
    return true;
  }

  if (msg.action === 'setEnabled') {
    chrome.storage.local.set({ enabled: msg.value }, () => {
      if (sender.tab?.id) {
        chrome.action.setBadgeText({ text: msg.value ? 'ON' : '', tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#0a7a3c', tabId: sender.tab.id });
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
      const cacheKeys = Object.keys(items).filter(k => k.startsWith('tr:'));
      chrome.storage.local.remove(cacheKeys, () => sendResponse({ cleared: cacheKeys.length }));
    });
    return true;
  }
});
