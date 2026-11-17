// test/bel290-perm-denied.test.js — BEL-290：popup 的 perm_denied 三条件。
//
// 判据在 src/pages/popup-perm.js（真代码），发送点在 popup.jsx（SEAMS 只认那一处）。
// 这里覆盖：http(s) + contains 明确 false ⇒ true；contains true ⇒ false；非 http(s)
// ⇒ false；permissions API 缺失 / 抛错 / contains 非布尔 ⇒ false（fail-closed）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const P = loadSrc('src/pages/popup-perm.js', 'PopupPerm').PopupPerm;

function deps(opts) {
  const o = opts || {};
  return {
    tabs: o.tabs || { query: async () => [{ id: 1, url: o.url === undefined ? 'https://example.com/a' : o.url }] },
    permissions: Object.prototype.hasOwnProperty.call(o, 'permissions')
      ? o.permissions
      : { contains: async () => (Object.prototype.hasOwnProperty.call(o, 'contains') ? o.contains : false) },
  };
}

describe('BEL-290 · shouldNotePermDenied', () => {
  test('http(s) + contains 明确 false ⇒ true（这一条才发）', async () => {
    eq(await P.shouldNotePermDenied(deps({ url: 'https://example.com/a', contains: false })), true);
    eq(await P.shouldNotePermDenied(deps({ url: 'http://example.com/a', contains: false })), true);
  });

  test('contains true ⇒ false（那次失败不是权限问题）', async () => {
    eq(await P.shouldNotePermDenied(deps({ contains: true })), false);
  });

  test('非 http(s) / 非法 URL ⇒ false（chrome://、file://、about:blank 都没有站点权限）', async () => {
    for (const url of ['chrome://extensions/', 'file:///tmp/a.html', 'about:blank', 'not a url', '']) {
      eq(await P.shouldNotePermDenied(deps({ url, contains: false })), false, url);
    }
  });

  test('permissions API 缺失 / contains 抛错 ⇒ false（fail-closed）', async () => {
    eq(await P.shouldNotePermDenied(deps({ permissions: undefined })), false);
    eq(await P.shouldNotePermDenied(deps({ permissions: {} })), false);
    eq(await P.shouldNotePermDenied(deps({ permissions: { contains: async () => { throw new Error('nope'); } } })), false);
  });

  test('contains 返回非布尔（undefined / null / 1）⇒ false —— 只要「明确 false」', async () => {
    for (const v of [undefined, null, 1, 'false']) {
      eq(await P.shouldNotePermDenied(deps({ contains: v })), false, String(v));
    }
  });

  test('tabs.query 抛错 / 没 tab ⇒ false', async () => {
    eq(await P.shouldNotePermDenied({ tabs: { query: async () => { throw new Error('x'); } }, permissions: { contains: async () => false } }), false);
    eq(await P.shouldNotePermDenied({ tabs: { query: async () => [] }, permissions: { contains: async () => false } }), false);
  });
});

describe('BEL-290 · popup.jsx 的接线', () => {
  const src = read('src/pages/popup.jsx');
  test('onTranslate 的两个 sendToPage 返回 null 分支都先判权限，再发零 props 事件', () => {
    const body = src.slice(src.indexOf('async function onTranslate()'), src.indexOf('function onAppRowClick'));
    eq((body.match(/if \(r == null\) \{/g) || []).length, 2, 'onTranslate 应有 translate / disable 两个 null 分支');
    eq((body.match(/await notePermDenied\(\);/g) || []).length, 2, '两个 null 分支都要判权限');
    ok(/MTTelemetry\.track\('perm_denied', \{\}\)/.test(src), 'perm_denied 必须零 props 从 popup.jsx 发出');
    ok(/shouldNotePermDenied\(\{/.test(src), '判据没有走共享 helper');
  });
});
