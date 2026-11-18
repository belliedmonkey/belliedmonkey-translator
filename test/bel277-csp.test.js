// test/bel277-csp.test.js — BEL-277 的 CSP fixture：`connect-src 'none'` 下
// 遥测仍然报得出去、菜单仍然开得出。
//
// 这是 vm 里的 fixture 而不是真浏览器（真站点 E2E 的步骤见 RESULT.md）：
//   · fetch 被模拟成浏览器在 connect-src 'none' 下的行为（同步抛 TypeError）；
//   · 内容脚本的判定按 location.protocol=https: 进入 SW 路径；
//   · SW sendMessage 成功 ⇒ 事件送达，direct fetch 0 次。
//   · 菜单：静态宿主是扩展注入的 DOM，不受页面 connect-src 影响；这里用同一
//     份 esbuild 产物画一次，再验证静态宿主缺失时的 DOM 回退。
const { loadModule, loadSrc, describe, test, ok, eq } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const INGEST = 'https://ingest.test/functions/v1/bt-ingest';

function cspSandbox() {
  const store = {};
  const sent = [];
  let direct = 0;
  const sandbox = {
    window: {
      MT_VERSION: '9.9.9', MT_FLAVOR: 'global',
      MT_TELEMETRY: { url: INGEST, spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS } },
    },
    location: { protocol: 'https:' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'Mac', language: 'en' },
    crypto: require('crypto').webcrypto,
    fetch: () => {
      direct += 1;
      // Chrome/WebKit 在 connect-src 'none' 下的形状：fetch 直接 reject。
      throw new TypeError("Refused to connect to '" + INGEST + "' because it violates the Content Security Policy directive: \"connect-src 'none'\".");
    },
    chrome: {
      i18n: { getUILanguage: () => 'en' },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
        remove: (keys, cb) => { for (const k of keys) delete store[k]; cb && cb(); },
      } },
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          // BEL-304：每页一次的 telemetryPing 不是批次，不记进 sent。
          if (msg.action !== 'telemetryPing') sent.push(msg);
          cb && cb({ ok: true });
        },
      },
    },
  };
  const ctx = loadModule(['learn/telemetry.js'], sandbox);
  return { T: ctx.MTTelemetry, store, sent, directCount: () => direct };
}

function makeDom() {
  const byId = {};
  function el(tag) {
    const node = {
      tagName: String(tag).toUpperCase(), id: '', children: [], style: {}, _attrs: {}, _listeners: {}, textContent: '',
      setAttribute(n, v) { node._attrs[n] = String(v); if (n === 'id') { node.id = String(v); byId[node.id] = node; } },
      appendChild(c) { node.children.push(c); return c; },
      remove() { if (node.id) delete byId[node.id]; },
      addEventListener(t, fn) { (node._listeners[t] = node._listeners[t] || []).push(fn); },
      removeEventListener() {},
      contains(t) { return t === node || node.children.some((c) => c.contains && c.contains(t)); },
      getBoundingClientRect() { return { top: 120, right: 120, bottom: 160, left: 80, width: 40, height: 40 }; },
    };
    let id = '';
    Object.defineProperty(node, 'id', {
      get() { return id; },
      set(v) { id = String(v); if (id) byId[id] = node; },
    });
    return node;
  }
  const body = el('body');
  return {
    document: {
      body, createElement: (t) => el(t), getElementById: (id) => byId[id] || null,
      addEventListener() {}, removeEventListener() {},
    },
    byId,
  };
}

const ROWS = [
  { kind: 'row', label: '字幕关', checked: true, onClick() {} },
  { kind: 'sep' },
  { kind: 'head', label: '字幕显示类型' },
  { kind: 'row', label: '双语字幕', onClick() {} },
];

describe('BEL-277 CSP fixture — connect-src none', () => {
  test('内容脚本在 connect-src none 下仍经 SW 上报，直接 fetch 0 次', async () => {
    const { T, store, sent, directCount } = cspSandbox();
    eq(await T.track('heartbeat'), true);
    eq(await T.flush(), true, 'CSP 下 flush 失败 —— 队列会一直涨');
    eq(directCount(), 0, 'CSP 下仍然尝试了 direct fetch');
    eq(sent.length, 1);
    eq(sent[0].action, 'telemetrySend');
    eq(JSON.parse(sent[0].init.body)[0].name, 'heartbeat');
    eq(store[T.KEYS.queue].length, 0);
  });

  test('同一 fixture 下静态菜单宿主照常开/关（菜单是扩展 DOM，不受页面 connect-src 管）', () => {
    const { document } = makeDom();
    const ctx = loadSrc('src/content/sub-menu.jsx', 'MTSubMenuBundle', {
      document, window: { innerWidth: 1200, innerHeight: 800, MT_PALETTE: {} },
    });
    const host = ctx.MTSubMenuBundle;
    const btn = document.createElement('button'); btn.id = 'b';
    host.open({ id: 'm', btn, rows: ROWS, closeMenu: () => host.close() });
    ok(document.getElementById('m'), 'CSP fixture 下菜单没开出来');
    eq(document.getElementById('m').children.length, 4);
    host.close();
    eq(document.getElementById('m'), null);
  });

  test('同一 fixture 下静态宿主缺失 ⇒ DOM 回退菜单仍然开', () => {
    const { document } = makeDom();
    const ctx = loadModule('content/subtitle-adapter.js', {
      document, window: { innerWidth: 1200, innerHeight: 800, MT_PALETTE: {} },
      TranslationCore: { createPager: () => ({ setWindow() {}, reset() {}, appendItems() {}, pump() {} }), WINDOW: {} },
    });
    const btn = document.createElement('button'); btn.id = 'b';
    eq(ctx.SubtitleAdapter._openMenu({ id: 'm', btn, rows: ROWS, closeMenu() {} }), 'fallback');
    ok(document.getElementById('m'), 'CSP fixture 下回退菜单没开出来');
  });
});
