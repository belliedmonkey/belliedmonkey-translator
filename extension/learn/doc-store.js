// learn/doc-store.js — 文档翻译的本机存储（learning-design §9.7「文档本体：独立存储」）。
//
// **独立** IndexedDB `mt-docs`，不是 LearnStore 的新 store：每次 bump DB_VERSION 都是对全体
// 用户语料的风险，而这里存的是缓存（文档字节、页文本、OCR 结果、译文），可能几十 MB，
// 且**永不同步**。删除语义单独定义：删一份文档 = docs 行 + 它的全部 pages 行；
// 「清除本机全部数据」要多调一次 wipe()。
//
//   docs   { id, title, kind, pages, size, bytes?, addedAt, openedAt, lastPage, captured: { total, byPage } }
//   pages  { k: id + '\0' + n, docId, n, paras, tr, ocr, provider, base, model, at }
'use strict';

var DocStore = (() => {
  const DB_NAME = 'mt-docs', DB_VERSION = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' }).createIndex('openedAt', 'openedAt');
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'k' }).createIndex('docId', 'docId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  function tx(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const s = {}; for (const n of stores) s[n] = t.objectStore(n);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && typeof out.then === 'function' ? undefined : out);
      t.onerror = () => reject(t.error || new Error('tx failed'));
      t.onabort = () => reject(t.error || new Error('tx aborted'));
    }));
  }
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const key = (id, n) => id + '\0' + n;

  function list() {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(['docs'], 'readonly'); const r = t.objectStore('docs').getAll();
      r.onsuccess = () => resolve((r.result || []).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)));
      r.onerror = () => reject(r.error);
    }));
  }
  function get(id) { return open().then((db) => req(db.transaction(['docs'], 'readonly').objectStore('docs').get(id))); }
  function put(doc) { return tx(['docs'], 'readwrite', (s) => { s.docs.put(doc); }); }
  function touch(id, patch) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(['docs'], 'readwrite'); const st = t.objectStore('docs');
      const r = st.get(id);
      r.onsuccess = () => { const d = r.result; if (d) st.put(Object.assign(d, patch || {}, { openedAt: Date.now() })); };
      t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
    }));
  }
  function remove(id) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(['docs', 'pages'], 'readwrite');
      t.objectStore('docs').delete(id);
      const idx = t.objectStore('pages').index('docId');
      const cur = idx.openKeyCursor(IDBKeyRange.only(id));
      cur.onsuccess = () => { const c = cur.result; if (c) { t.objectStore('pages').delete(c.primaryKey); c.continue(); } };
      t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
    }));
  }
  function getPage(id, n) { return open().then((db) => req(db.transaction(['pages'], 'readonly').objectStore('pages').get(key(id, n)))); }
  function putPage(id, n, rec) { return tx(['pages'], 'readwrite', (s) => { s.pages.put(Object.assign({}, rec, { k: key(id, n), docId: id, n, at: Date.now() })); }); }
  function wipe() {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(['docs', 'pages'], 'readwrite');
      t.objectStore('docs').clear(); t.objectStore('pages').clear();
      t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
    }));
  }
  // 本机最多 MAX_DOCS 份：超出的最久没打开的先删（LRU）。返回删掉的 id。
  async function evict(max) {
    const all = await list();
    const over = all.slice(max || DocCore.CAPS.MAX_DOCS);
    for (const d of over) await remove(d.id);
    return over.map((d) => d.id);
  }
  return { DB_NAME, DB_VERSION, open, list, get, put, touch, remove, getPage, putPage, wipe, evict };
})();

if (typeof window !== 'undefined') window.DocStore = DocStore;
if (typeof module !== 'undefined' && module.exports) module.exports = DocStore;
