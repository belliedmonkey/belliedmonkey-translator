// learn/store.js — the learning corpus. EXTENSION PAGES ONLY.
//
// This must never be loaded into a content script. A content script's `indexedDB`
// belongs to the HOST PAGE's origin, so the corpus would scatter across every site
// the user visits AND be readable by the page's own scripts. Here, on a
// chrome-extension:// page, it is the extension's own private database.
// See docs/learning-design.md §7.

var LearnStore = (() => {
  const DB_NAME = 'mt-learn';
  // v2 adds the `audio` store. The upgrade path only ever ADDS (every create is
  // guarded by `contains`), so bumping the version never touches existing data.
  const DB_VERSION = 2;
  const MAX_ITEMS = 20000;
  const MAX_AUDIO_BYTES = 200 * 1024 * 1024;   // 200 MB, LRU-evicted

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
        // Synthesized speech, keyed by LearnTTS.cacheKey. Only 'speech-compat'
        // engines land here — the browser engine cannot return audio data at all.
        if (!db.objectStoreNames.contains('audio')) {
          const a = db.createObjectStore('audio', { keyPath: 'k' });
          a.createIndex('at', 'at');       // LRU
          a.createIndex('bytes', 'bytes');
        }
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

  // ─── Audio cache ─────────────────────────────────────────────────────────
  // Synthesis costs the user money or CPU and a card is replayed many times, so a
  // cache is not an optimization here — it is what makes a paid engine usable.

  function getAudio(k) {
    let out = null;
    return tx(['audio'], 'readonly', (s) => {
      const r = s.audio.get(k);
      r.onsuccess = () => { out = r.result || null; };
    }).then(() => {
      if (out) touchAudio(k).catch(() => {});   // LRU bookkeeping, never blocking
      return out;
    }).catch(() => null);
  }

  function touchAudio(k) {
    return tx(['audio'], 'readwrite', (s) => {
      const r = s.audio.get(k);
      r.onsuccess = () => { if (r.result) s.audio.put(Object.assign(r.result, { at: Date.now() })); };
    });
  }

  function putAudio(k, blob, meta) {
    const rec = Object.assign({ k, blob, bytes: blob.size || 0, at: Date.now() }, meta || {});
    return tx(['audio'], 'readwrite', (s) => { s.audio.put(rec); })
      .then(() => evictAudioIfNeeded());
  }

  // Least-recently-PLAYED goes first. Sorting by `at` (updated on every cache hit)
  // rather than by creation time is what keeps the sentences you actually review
  // resident while one-off synthesis ages out.
  function evictAudioIfNeeded(limitBytes) {
    const cap = limitBytes || MAX_AUDIO_BYTES;
    let recs = [];
    return tx(['audio'], 'readonly', (s) => {
      const r = s.audio.getAll();
      r.onsuccess = () => { recs = r.result || []; };
    }).then(() => {
      let total = recs.reduce((n, r) => n + (r.bytes || 0), 0);
      if (total <= cap) return 0;
      recs.sort((a, b) => (a.at || 0) - (b.at || 0));
      const doomed = [];
      for (const r of recs) {
        if (total <= cap) break;
        doomed.push(r.k);
        total -= (r.bytes || 0);
      }
      if (!doomed.length) return 0;
      return tx(['audio'], 'readwrite', (s) => { for (const k of doomed) s.audio.delete(k); })
        .then(() => doomed.length);
    });
  }

  function audioStats() {
    let recs = [];
    return tx(['audio'], 'readonly', (s) => {
      const r = s.audio.getAll();
      r.onsuccess = () => { recs = r.result || []; };
    }).then(() => ({
      count: recs.length,
      bytes: recs.reduce((n, r) => n + (r.bytes || 0), 0),
    })).catch(() => ({ count: 0, bytes: 0 }));
  }

  function clearAudio() { return tx(['audio'], 'readwrite', (s) => { s.audio.clear(); }); }

  function clearAll() {
    return tx(['items', 'sources', 'reviews', 'meta', 'audio'], 'readwrite', (s) => {
      s.items.clear(); s.sources.clear(); s.reviews.clear(); s.meta.clear(); s.audio.clear();
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
    MAX_ITEMS, MAX_AUDIO_BYTES,
    open, allItems, allSources, putItem, mergeBatch, recordReview,
    getMeta, setMeta, evictIfNeeded, clearAll, stats,
    getAudio, putAudio, evictAudioIfNeeded, audioStats, clearAudio,
  };
})();
