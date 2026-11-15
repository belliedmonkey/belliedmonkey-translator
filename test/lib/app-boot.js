// test/lib/app-boot.js — a headless boot of the REAL App shell (`bootShell()`).
//
// BEL-269's skip path used to be asserted by feeding a fake `persist` into
// skipPacksToHome or by grepping the source for `writePacksDone(...)`. Both stay
// green when the actual `chrome.storage.local.set` is deleted (2026-11-15
// quality mutation). This helper exists so a test can do what the user does:
// boot the shell with a storage shim, land on the pack screen, click
// `#packs-skip`, and then boot again from the bytes that click left behind.
//
// It stubs only the browser/API boundary the App normally gets from the host
// (DOM, chrome.storage, native speech/TTS, LearnAuth). The first-run decision,
// the skip handler, the storage writes and the banner are the production code.
// "Real boot" here means `bootShell()` itself — not a re-implementation.

const { loadSrc } = require('../harness');
const { makeChrome } = require('../stubs');

// AppShell renders these sections with `hidden` in the markup. Every other
// looked-up element is visible by default, like the real document.
const HIDDEN_BY_DEFAULT = new Set([
  'signed-out', 'signed-in', 'firstrun-packs', 'packs-pending', 'packs-skip',
]);

function makeElement(id) {
  const listeners = {};
  const el = {
    id,
    hidden: HIDDEN_BY_DEFAULT.has(id),
    textContent: '', value: '', disabled: false, checked: false,
    className: '', innerHTML: '', placeholder: '', title: '', type: '', href: '', src: '',
    style: {}, dataset: {}, children: [], parentNode: null, childNodes: [],
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((x) => x !== fn);
    },
    click() {
      for (const fn of (listeners.click || [])) {
        fn({ preventDefault() {}, stopPropagation() {}, target: el });
      }
    },
    dispatch(type, ev) {
      for (const fn of (listeners[type] || [])) {
        fn(ev || { preventDefault() {}, stopPropagation() {}, target: el });
      }
    },
    setAttribute(k, v) { el[k] = v; },
    getAttribute(k) { return el[k] == null ? '' : el[k]; },
    removeAttribute(k) { delete el[k]; },
    appendChild(c) { el.children.push(c); el.childNodes.push(c); return c; },
    removeChild(c) {
      el.children = el.children.filter((x) => x !== c);
      el.childNodes = el.childNodes.filter((x) => x !== c);
      return c;
    },
    append() {}, prepend() {}, insertAdjacentHTML() {}, replaceWith() {},
    after() {}, before() {}, remove() {}, focus() {}, blur() {}, scrollIntoView() {},
    querySelector() { return makeElement(id + '-q'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    cloneNode() { return makeElement(id + '-clone'); },
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
    },
    offsetWidth: 0, offsetHeight: 0,
  };
  return el;
}

/**
 * Boot one fresh App shell against a storage shim.
 *
 * opts.store     — initial chrome.storage.local contents (kept by reference;
 *                  the returned `store` is the same object the App writes).
 * opts.ready     — initial probe answer for the three pack kinds. Exposed as
 *                  `probe.ready` so a test can change it between repaints.
 * opts.session   — session returned by LearnAuth (default: a signed-in user).
 *
 * Returns { shell, store, probe, boot, el, screen, waitFor, waitForScreen }.
 * `boot()` calls the production `bootShell()`; bootShell's own boot IIFE is
 * async, so callers await `waitForScreen()` before asserting.
 */
function bootApp(opts = {}) {
  const store = opts.store || {};
  const session = opts.session === undefined
    ? { userId: 'u-bel269', accessToken: 'test-token' }
    : opts.session;
  const probe = { ready: opts.ready === true };

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeElement(id));
    return els.get(id);
  };

  const chrome = makeChrome({ store, uiLanguage: 'zh-CN' });

  const window = {
    addEventListener() {}, removeEventListener() {},
    MT_BACKEND: { enabled: true, providers: ['apple', 'google'] },
    MT_TTS_ENGINES: [],
    MT_LANGS: [{ code: 'zh', label: '中文' }, { code: 'en', label: 'English' }],
    MT_FLAVOR: 'global',
    MT_I18N_MESSAGES: {},
    MT_TELEMETRY: null,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: 'https://app.test/', search: '' },
  };

  const document = {
    getElementById: getEl,
    querySelector: (s) => getEl(s),
    querySelectorAll: () => [],
    createElement: (tag) => makeElement('new-' + tag),
    addEventListener() {}, removeEventListener() {},
    body: makeElement('body'),
    documentElement: makeElement('html'),
    head: makeElement('head'),
    hidden: false,
    visibilityState: 'visible',
  };
  window.document = document;

  const LearnGrant = {
    enabled: () => false,
    active: () => false,
    activeIn: () => false,
    migrateOwners: () => ({}),
    clearForAccountSwitch: () => ({ writes: {}, marks: {} }),
    clear: async () => {},
  };

  const sandbox = {
    window, document,
    navigator: {
      platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test',
    },
    chrome,
    localStorage: window.localStorage,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    btoa: (x) => Buffer.from(x, 'binary').toString('base64'),
    atob: (x) => Buffer.from(x, 'base64').toString('binary'),
    LearnAuth: {
      currentStable: async () => session,
      current: async () => session,
      bindCorpus: async () => {},
      lastLoadError: () => false,
      displayName: () => 'Tester',
      signOut: async () => {},
    },
    LearnSync: {
      autoSync: async () => null,
      sync: async () => ({ pulled: 0, pushed: 0 }),
    },
    LearnTTS: {
      config: {},
      configure() {},
      deviceStatus: async () => (probe.ready
        ? { ready: true, langs: ['zh', 'en'] }
        : { ready: false, langs: [] }),
      reason: () => 'test',
      ensureDeviceReady: async () => ({ ok: true }),
    },
    NativeSpeech: {
      // The three kinds are probed through these two surfaces: ASR assets,
      // TTS device status and the lid/vad base components.
      probe: async () => (probe.ready
        ? { ok: true, assets: 'installed' }
        : { ok: false, assets: 'missing' }),
      quota: () => ({ max: 5, reserved: [] }),
      lidProbe: async () => ({ ok: probe.ready }),
      vadProbe: async () => ({ ok: probe.ready }),
      onNetwork: () => () => {},
    },
    NativeAudio: {
      available: () => true,
      audioCaps: () => ({ system: 'ok' }),
      capsProbe: async () => ({ system: 'ok' }),
      onEvent() {}, onTick() {},
    },
    AppDriving: { wire() {}, paintStatic() {}, refreshEntry() {}, start() {}, stop() {} },
    AppListen: { wire() {}, open() {}, accountChanged() {}, refreshEntry() {} },
    AppDocs: { wire() {} },
    LearnDialog: { confirm: async () => true },
    LearnGrant,
    LearnStore: {
      stats: async () => ({ total: 0, by: {} }),
      allItems: async () => [],
      getMeta: async () => 0,
    },
    LearnScheduler: { dueCount: () => 0, DEFAULTS: {} },
    EngineState: { needsSetup: () => false, byId: () => null },
    DiagLog: { push() {} },
    console, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };

  const shell = loadSrc('src/app/shell-model.js', 'ShellModel', sandbox).ShellModel;

  const el = (id) => getEl(id);
  const screen = () => {
    // The pack screen can sit above home while the manager is open, so it wins.
    if (el('firstrun-packs').hidden === false) return 'packs';
    if (el('signed-in').hidden === false) return 'home';
    if (el('signed-out').hidden === false) return 'login';
    return '';
  };
  const waitFor = async (pred, ms = 800) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 5));
    }
    return !!pred();
  };
  const waitForScreen = (name, ms = 800) => waitFor(() => screen() === name, ms);

  return {
    shell, chrome, store, probe, els, el, screen, waitFor, waitForScreen,
    boot: () => shell.bootShell(),
  };
}

module.exports = { bootApp };
