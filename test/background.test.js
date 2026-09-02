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

// 2026-08-19: §5.5 的回退在 Chrome 上整整一版没有生效——调用方开了，**接收方**还锁在
// `if (IS_FIREFOX)` 里，于是内容脚本发出的 proxyFetch 没人接。单测当时是绿的，因为
// stub 的 onMessage 是个黑洞，等于假装总有接收方。这个 helper 记录真实注册情况，
// 让「处理器有没有注册」变成可断言的事。
function loadWithListeners(extensionOrigin) {
  const listeners = [];
  const chrome = makeChrome({ store: {}, extensionOrigin });
  chrome.runtime.onInstalled = { addListener: () => {} };
  chrome.runtime.onMessage = { addListener: (fn) => listeners.push(fn) };
  chrome.action = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, onClicked: { addListener: () => {} } };
  chrome.tabs = { onUpdated: { addListener: () => {} }, onActivated: { addListener: () => {} }, query: () => {}, sendMessage: () => {} };
  loadModule('./background.js', { chrome, fetch: async () => ({ ok: true, status: 200, statusText: '', headers: { get: () => null }, text: async () => '{}' }), AbortController, setTimeout, clearTimeout });
  return listeners;
}

// 判据不是「注册了几个」，而是「proxyFetch 这条消息有人接」——直接问行为。
function handlesProxyFetch(listeners) {
  return listeners.some((fn) => {
    let answered = false;
    const r = fn({ action: 'proxyFetch', url: 'https://x.example/v1/chat/completions', init: {} },
      {}, () => { answered = true; });
    return r === true || answered;   // 返回 true = 会异步回话
  });
}

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

  // 采集默认开着，**只对全新安装**（2026-09-02 用户裁定）。
  //
  // 这三条一起才守得住。只守第一条的话，把它加进 DEFAULT_SETTINGS 也能过 —— 而那样
  // 老用户会在一次更新之后被悄悄打开一个采集数据的功能，他们没有在任何地方同意过。
  test('全新安装 → 采集默认开着', () => {
    const { fire, store } = load({});
    fire({ reason: 'install' });
    eq(store.learnEnabled, true, '新装应当种下 learnEnabled: true');
  });

  test('更新（从没碰过这个开关）→ 不许替他打开', () => {
    const { fire, store } = load({
      enabled: true, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: '#56633f',
    });
    fire({ reason: 'update' });
    eq(store.learnEnabled, undefined,
      '老用户从没碰过这个开关 —— 一次更新把采集悄悄打开，同样是「界面不说」');
  });

  test('更新（特意关掉过）→ 保持关着', () => {
    const { fire, store } = load({
      enabled: true, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
      apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
      textColor: '#56633f', learnEnabled: false,
    });
    fire({ reason: 'update' });
    eq(store.learnEnabled, false, '明确关掉过的，永远不许被默认值改回来');
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

describe('background — proxyFetch 处理器在每个浏览器上都注册（§5.4 + §5.5）', () => {
  test('Chrome 上也接 proxyFetch —— 这一条正是 2026-08-19 那次漏掉的', () => {
    ok(handlesProxyFetch(loadWithListeners('chrome-extension://abcdef/')),
      'Chrome 上没人接 proxyFetch ——§5.5 的回退会静默失效，' +
      '而设置页自检照样通过（扩展页面不受 CORS 约束），最难查的那种形状');
  });

  test('Firefox 上照旧接（§5.4 的唯一通路，不能被这次改动碰坏）', () => {
    ok(handlesProxyFetch(loadWithListeners('moz-extension://uuid/')));
  });

  test('不认识的消息不占用回话权 —— 否则会挡住后面那个 onMessage 监听器', () => {
    const listeners = loadWithListeners('chrome-extension://abcdef/');
    const proxy = listeners.find((fn) => fn({ action: 'proxyFetch', url: 'https://x.example/', init: {} }, {}, () => {}) === true);
    ok(proxy, '找不到 proxyFetch 监听器');
    eq(proxy({ action: 'getSettings' }, {}, () => {}), undefined,
      'proxyFetch 监听器对别的消息返回了 true —— 会让 getSettings 一类的回话被吞');
  });
});
