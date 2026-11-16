// test/bel277-submenu.test.js — BEL-277：静态 IIFE 菜单 + 纯 DOM 回退。
//
// 两件事必须真的发生（不是「源码里有这个词」）：
//   ① src/content/sub-menu.jsx 编译成 IIFE global 后，open() 在文档里画出行、
//      勾选态、点外关闭/close() 摘干净；
//   ② adapter 的 _openMenu：全局 host 在 ⇒ 用它；全局缺失 / host.open 抛错 ⇒
//      纯 DOM 回退菜单仍然开出（菜单不能因静态条目失败而不开）。
const { loadSrc, loadModule, describe, test, ok, eq, tick } = require('./harness');

function makeDom() {
  const byId = {};
  function el(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '',
      children: [],
      style: {},
      _attrs: {},
      _listeners: {},
      textContent: '',
      _removed: false,
      setAttribute(name, value) {
        node._attrs[name] = String(value);
        if (name === 'id') { node.id = String(value); byId[node.id] = node; }
      },
      appendChild(child) { node.children.push(child); return child; },
      remove() { node._removed = true; if (node.id) delete byId[node.id]; },
      addEventListener(type, fn) { (node._listeners[type] = node._listeners[type] || []).push(fn); },
      removeEventListener() {},
      contains(target) {
        if (target === node) return true;
        return node.children.some((c) => c.contains && c.contains(target));
      },
      getBoundingClientRect() { return { top: 120, right: 120, bottom: 160, left: 80, width: 40, height: 40 }; },
      click() { for (const fn of node._listeners.click || []) fn({ stopPropagation() {}, target: node }); },
    };
    let id = '';
    Object.defineProperty(node, 'id', {
      get() { return id; },
      set(v) { id = String(v); if (id) byId[id] = node; },
    });
    return node;
  }
  const body = el('body');
  const document = {
    body,
    createElement: (tag) => el(tag),
    getElementById: (id) => byId[id] || null,
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, body, byId };
}

const ROWS = [
  { kind: 'row', label: '字幕关', checked: true, onClick() {} },
  { kind: 'sep' },
  { kind: 'head', label: '字幕显示类型' },
  { kind: 'row', label: '双语字幕', checked: false, onClick() {} },
];

describe('BEL-277 — 静态 IIFE 菜单宿主', () => {
  test('open() 画出行/分隔/标题，勾选态来自传入的行数据', async () => {
    const { document, body } = makeDom();
    const ctx = loadSrc('src/content/sub-menu.jsx', 'MTSubMenuBundle', {
      document,
      window: { innerWidth: 1200, innerHeight: 800, MT_PALETTE: {} },
    });
    const host = ctx.MTSubMenuBundle;
    ok(host && typeof host.open === 'function', 'IIFE 产物没有导出 open host');
    const btn = document.createElement('button'); btn.id = 'probe-btn';
    host.open({ id: 'probe-menu', btn, rows: ROWS, closeMenu: () => host.close() });
    const menu = document.getElementById('probe-menu');
    ok(menu, 'open() 之后没有菜单容器');
    eq(menu._attrs.translate, 'no');
    eq(menu.children.length, 4, '行数不对：' + menu.children.length);
    eq(menu.children[0].children.length, 2);
    eq(menu.children[0].children[0].textContent, '✓');
    eq(menu.children[0].children[1].textContent, '字幕关');
    eq(menu.children[3].children[0].textContent, '');
    host.close();
    eq(document.getElementById('probe-menu'), null, 'close() 之后菜单还在');
  });

  test('行点击调用传入的 onClick；closeMenu 由调用方决定', async () => {
    const { document } = makeDom();
    const ctx = loadSrc('src/content/sub-menu.jsx', 'MTSubMenuBundle', {
      document,
      window: { innerWidth: 1200, innerHeight: 800, MT_PALETTE: {} },
    });
    const host = ctx.MTSubMenuBundle;
    const btn = document.createElement('button'); btn.id = 'probe-btn';
    let hit = 0;
    host.open({ id: 'probe-menu', btn, rows: [{ kind: 'row', label: 'x', onClick: () => { hit += 1; } }], closeMenu: () => host.close() });
    document.getElementById('probe-menu').children[0].click();
    eq(hit, 1);
    host.close();
  });
});

describe('BEL-277 — adapter 菜单：静态 host 优先，失败走 DOM 回退', () => {
  function loadAdapter(extraWindow = {}) {
    const { document } = makeDom();
    const warnings = [];
    const window = Object.assign({ innerWidth: 1200, innerHeight: 800, MT_PALETTE: {} }, extraWindow);
    const ctx = loadModule('content/subtitle-adapter.js', {
      document, window,
      console: Object.assign({}, console, { warn: (...a) => warnings.push(a) }),
      TranslationCore: { createPager: () => ({ setWindow() {}, reset() {}, appendItems() {}, pump() {} }), WINDOW: {} },
    });
    return { A: ctx.SubtitleAdapter, document, window, warnings };
  }

  test('全局 host 在 ⇒ 用 host，不画回退 DOM', () => {
    const { A, document, window } = loadAdapter();
    let opened = null;
    window.MTSubMenuBundle = {
      open(opts) { opened = opts; },
      close() {},
    };
    const btn = document.createElement('button'); btn.id = 'b';
    eq(A._openMenu({ id: 'm', btn, rows: ROWS, closeMenu() {} }), 'bundle');
    eq(opened.id, 'm');
    eq(document.getElementById('m'), null, 'host 成功时不该再画回退菜单');
  });

  test('全局 host 缺失 ⇒ 回退菜单真的开出（行数/勾号/关闭）', () => {
    const { A, document } = loadAdapter();
    const btn = document.createElement('button'); btn.id = 'b';
    let closed = 0;
    eq(A._openMenu({ id: 'm', btn, rows: ROWS, closeMenu: () => { closed += 1; } }), 'fallback');
    const menu = document.getElementById('m');
    ok(menu, '回退菜单没开出来');
    eq(menu.children.length, 4);
    eq(menu.children[0].children[0].textContent, '✓');
  });

  test('host.open 抛错 ⇒ console.warn + 回退菜单，不把菜单丢掉', () => {
    const { A, document, window, warnings } = loadAdapter();
    window.MTSubMenuBundle = { open() { throw new Error('boom'); }, close() {} };
    const btn = document.createElement('button'); btn.id = 'b';
    eq(A._openMenu({ id: 'm', btn, rows: ROWS, closeMenu() {} }), 'fallback');
    ok(document.getElementById('m'), 'host 抛错后回退菜单没开出来');
    eq(warnings.length, 1);
    ok(/DOM fallback/.test(String(warnings[0][0])));
  });

  test('_openFallbackMenu 的行点击/勾选/分隔与静态宿主同构', () => {
    const { A, document } = loadAdapter();
    const btn = document.createElement('button'); btn.id = 'b';
    let hit = 0;
    A._openFallbackMenu({
      id: 'm', btn,
      rows: [{ kind: 'row', label: '行甲', checked: true, onClick: () => { hit += 1; } }, { kind: 'sep' }, { kind: 'head', label: '标题' }],
      closeMenu() {},
    });
    const menu = document.getElementById('m');
    eq(menu.children.length, 3);
    menu.children[0].click();
    eq(hit, 1);
    eq(menu.children[0].children[0].textContent, '✓');
    eq(menu.children[1].style.cssText.includes('height:1px'), true);
    eq(menu.children[2].textContent, '标题');
  });
});
