// learn/store.js — the learning corpus. EXTENSION PAGES ONLY.
//
// This must never be loaded into a content script. A content script's `indexedDB`
// belongs to the HOST PAGE's origin, so the corpus would scatter across every site
// the user visits AND be readable by the page's own scripts. Here, on a
// chrome-extension:// page, it is the extension's own private database.
// See docs/learning-design.md §7.

var LearnStore = (() => {
  const DB_NAME = 'mt-learn';
  const DB_VERSION = 1;
  const MAX_ITEMS = 20000;

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) {
          const s = db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('state', 'state');
          s.createIndex('lang', 'lang');
          s.createIndex('createdAt', 'createdAt');
          s.createIndex('salience', 'salience');
        }
        if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('reviews')) {
          const r = db.createObjectStore('reviews', { keyPath: 'seq', autoIncrement: true });
          r.createIndex('itemId', 'itemId');
          r.createIndex('at', 'at');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  // Settles on the TRANSACTION's own lifecycle and nothing else.
  //
  // `fn` must not return a promise. An earlier version resolved with whatever `fn`
  // returned, which meant the caller waited on the transaction AND on an inner
  // promise — and an inner promise that never settles (a request whose handlers
  // neither fire) hangs forever, with no timeout and no error. That produced a
  // review page that froze after the first grade, intermittently. Results are
  // captured into a closure variable by the caller instead.
  function tx(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      fn(stores.reduce((acc, n) => (acc[n] = t.objectStore(n), acc), {}), t);
    }));
  }

  function getAllFrom(storeName) {
    let out = [];
    return tx([storeName], 'readonly', (s) => {
      const r = s[storeName].getAll();
      r.onsuccess = () => { out = r.result || []; };
    }).then(() => out);
  }

  function allItems() { return getAllFrom('items'); }
  function allSources() { return getAllFrom('sources'); }

  function putItem(item) { return tx(['items'], 'readwrite', (s) => { s.items.put(item); }); }

  function getMeta(k, dflt) {
    let val = dflt;
    return tx(['meta'], 'readonly', (s) => {
      const r = s.meta.get(k);
      r.onsuccess = () => { val = r.result ? r.result.v : dflt; };
    }).then(() => val);
  }
  function setMeta(k, v) { return tx(['meta'], 'readwrite', (s) => { s.meta.put({ k, v }); }); }

  // Merge a batch of captured items. Text/tr/anchor are immutable; only
  // evidence-of-use accumulates (learning-design.md §4).
  function mergeBatch(items, sources) {
    if (!items.length && !(sources || []).length) return Promise.resolve(0);
    return tx(['items', 'sources'], 'readwrite', (s) => {
      for (const src of sources || []) if (src && src.id) s.sources.put(src);
      for (const inc of items) {
        const r = s.items.get(inc.id);
        r.onsuccess = () => {
          const prev = r.result;
          s.items.put(prev ? LearnModel.mergeItem(prev, inc) : inc);
        };
      }
    }).then(() => items.length);
  }

  function recordReview(itemId, grade, at) {
    return tx(['reviews'], 'readwrite', (s) => { s.reviews.add({ itemId, grade, at }); });
  }

  // Bounded corpus. Evict 'known' first, then lowest salience, then oldest —
  // never a card the user is actively learning.
  function evictIfNeeded(limit) {
    const cap = limit || MAX_ITEMS;
    return allItems().then((items) => {
      if (items.length <= cap) return 0;
      const overflow = items.length - cap;
      const rank = (it) => (it.state === 'known' ? 0 : it.state === 'candidate' ? 1 : 2);
      const doomed = items
        .filter((it) => !it.starred)
        .sort((a, b) => rank(a) - rank(b)
          || (a.salience || 0) - (b.salience || 0)
          || (a.createdAt || 0) - (b.createdAt || 0))
        .slice(0, overflow);
      if (!doomed.length) return 0;
      return tx(['items'], 'readwrite', (s) => { for (const d of doomed) s.items.delete(d.id); })
        .then(() => doomed.length);
    });
  }

  function clearAll() {
    return tx(['items', 'sources', 'reviews', 'meta'], 'readwrite', (s) => {
      s.items.clear(); s.sources.clear(); s.reviews.clear(); s.meta.clear();
    });
  }

  function stats() {
    return Promise.all([allItems(), allSources()]).then(([items, sources]) => {
      const by = { candidate: 0, learning: 0, known: 0, muted: 0 };
      for (const it of items) {
        const st = LearnScheduler.stateFor(it);
        by[st] = (by[st] || 0) + 1;
      }
      const bytes = items.reduce((n, it) => n + (it.text || '').length + (it.tr || '').length, 0);
      return { total: items.length, by, sources: sources.length, approxChars: bytes };
    });
  }

  return {
    MAX_ITEMS,
    open, allItems, allSources, putItem, mergeBatch, recordReview,
    getMeta, setMeta, evictIfNeeded, clearAll, stats,
  };
})();
