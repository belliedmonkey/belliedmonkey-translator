// test/background.test.js — the service worker's onInstalled settings pass.
//
// Two behaviors share one listener and must not step on each other:
//   1. fill-in: keys the user has never had get the shipped defaults;
//   2. rebrand migration (2026-08, design/handoff.md): install WROTE the old
//      defaults into storage, so "still on the default" is only detectable by
//      VALUE — exactly the old default migrates, any user-chosen colour is
//      untouched, and the pass is idempotent across repeated 'update' events.
// A regression here silently repaints (or fails to repaint) translations for
// every existing user on their next extension update.
const { describe, test, eq, ok } = require('./harness');
const { makeChrome } = require('./stubs');
const { loadModule } = require('./harness');
// The palette registry is the single source of truth — asserting against it
// (not restated literals) is what actually PINS background.js's hardcoded
// colours to the registry: if the registry recolours and background.js lags,
// these tests go red. (background.js keeps literals by design — an MV3 service
// worker can't <script>-load palette.gen.js.)
const { runtime: PALETTE, migration: LEGACY } = require('../build/palette.config.js');

function load(store = {}) {
  const chrome = makeChrome({ store });
  // background.js needs the event surfaces the content-script stub doesn't carry.
  const installed = [];
  const badges = [];
  chrome.runtime.onInstalled = { addListener: (fn) => installed.push(fn) };
  chrome.runtime.onMessage = { addListener: () => {} };
  chrome.action = {
    setBadgeText: () => {},
    setBadgeBackgroundColor: (o) => badges.push(o.color),
  };
  loadModule('./background.js', { chrome });
  eq(installed.length, 1, 'background registers exactly one onInstalled listener');
  return { fire: (details) => installed[0](details), store: chrome._store, badges };
}

describe('background — onInstalled defaults + rebrand migration', () => {
  test('fresh install → new-brand defaults written, terracotta badge', () => {
    const { fire, store, badges } = load({});
    fire({ reason: 'install' });
    eq(store.textColor, PALETTE.textColor, 'shipped default matches the palette registry');
    eq(store.enabled, false);
    eq(badges[0], PALETTE.brand, 'onboarding dot uses the registry brand colour');
  });

  test('update with OLD defaults stored → both colours migrate', () => {
    const { fire, store } = load({
      enabled: true, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: LEGACY.legacyTextColor, ytTextColor: LEGACY.legacyYtTextColor,
    });
    fire({ reason: 'update' });
    eq(store.textColor, PALETTE.textColor, 'old default green migrates to the registry default');
    eq(store.ytTextColor, PALETTE.ytTextColor, 'old default white migrates to the registry default');
    eq(store.enabled, true, 'unrelated settings untouched');
  });

  test('update with USER-CHOSEN colours → untouched', () => {
    const { fire, store } = load({
      enabled: false, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: '#ff0000', ytTextColor: '#123456',
    });
    fire({ reason: 'update' });
    eq(store.textColor, '#ff0000', 'a deliberate colour choice is never migrated');
    eq(store.ytTextColor, '#123456');
  });

  test('migration is idempotent — second update event changes nothing', () => {
    const { fire, store } = load({
      enabled: false, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: LEGACY.legacyTextColor, ytTextColor: LEGACY.legacyYtTextColor,
    });
    fire({ reason: 'update' });
    const after = JSON.stringify(store);
    fire({ reason: 'update' });
    eq(JSON.stringify(store), after, 'repeated update events are a no-op');
    eq(store.textColor, PALETTE.textColor);
    eq(store.colorMigrated2026, true, 'one-shot marker recorded');
  });

  test('user who picks plain WHITE subtitles AFTER the rebrand keeps them', () => {
    // The one-shot marker is what protects this: white matches the old default
    // by value, but a post-migration deliberate choice must never be rewritten.
    const { fire, store } = load({
      enabled: false, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: PALETTE.textColor, ytTextColor: '#ffffff', colorMigrated2026: true,
    });
    fire({ reason: 'update' });
    eq(store.ytTextColor, '#ffffff', 'chosen white survives every later update');
  });

  test('update with only textColor on the old default → no phantom ytTextColor is written', () => {
    // ytTextColor was never in DEFAULT_SETTINGS, so a pre-rebrand user without it
    // simply has no key. The migration must not invent one from nothing…
    const { fire, store } = load({
      enabled: false, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: LEGACY.legacyTextColor,
    });
    fire({ reason: 'update' });
    eq(store.textColor, PALETTE.textColor);
    ok(!('ytTextColor' in store), 'no phantom ytTextColor is written for users who never had one');
  });
});
