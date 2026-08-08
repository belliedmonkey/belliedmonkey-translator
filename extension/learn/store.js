// learn/store.js — the learning corpus. EXTENSION PAGES ONLY.
//
// This must never be loaded into a content script. A content script's `indexedDB`
// belongs to the HOST PAGE's origin, so the corpus would scatter across every site
// the user visits AND be readable by the page's own scripts. Here, on a
// chrome-extension:// page, it is the extension's own private database.
// See docs/learning-design.md §7.

var LearnStore = (() => {
  const DB_NAME = 'mt-learn';
  // v2 adds the `audio` store; v3 adds `tombs` (§7.3); v4 adds `notes` (§9.2).
  // The upgrade path only ever ADDS (every create is guarded by `contains`), so
  // bumping the version never touches existing data. EVERY bump: npm run test:idb.
  const DB_VERSION = 4;
  const MAX_ITEMS = 20000;
  const MAX_TOMBS = 20000;   // same order as the corpus; oldest forgotten past this
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
        // Ids this device evicted. §7.3: the server is the ARCHIVE and each device
        // keeps a WORKING SET, so a pull must not hand back what local pressure just
        // let go of. These are PER-DEVICE and never sync — eviction is a fact about
        // this device's storage, not about what the corpus should contain.
        if (!db.objectStoreNames.contains('tombs')) {
          const t = db.createObjectStore('tombs', { keyPath: 'id' });
          t.createIndex('at', 'at');       // oldest forgotten first
        }
        // §9.2 sentence notes — the LLM-generated 生词/短语/语法 cache, keyed by
        // card id. Device-local and NEVER synced: it is a regenerable derivative, and
        // keeping it out of the chunk format is what keeps §8.5's cost model intact.
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
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
  function allReviews() { return getAllFrom('reviews'); }

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
  // Returns how many items were NEW to this device, not how many were offered.
  // The difference is the whole meaning of the number the sync UI shows: a device
  // re-reading its own upload merges the full batch and adds nothing, and reporting
  // the batch size there tells the user cards arrived from somewhere when none did.
  // Counted in a closure, not returned from `fn` — see the `tx()` note above.
  // `opts` is handed straight to LearnModel.mergeItem. Callers replaying a chunk
  // (sync pull, file import) MUST pass `{accumulate: false}`: those items are copies
  // of encounters already counted, not new ones.
  function mergeBatch(items, sources, opts) {
    if (!items.length && !(sources || []).length) return Promise.resolve(0);
    let added = 0;
    return tx(['items', 'sources'], 'readwrite', (s) => {
      for (const src of sources || []) if (src && src.id) s.sources.put(src);
      for (const inc of items) {
        const r = s.items.get(inc.id);
        r.onsuccess = () => {
          const prev = r.result;
          if (!prev) added++;
          const merged = prev ? LearnModel.mergeItem(prev, inc, opts) : inc;
          // Watermark: this state came from the server, so push must not send it
          // back. Only a LOCAL change (a review, a re-read) lifts touchedAt above
          // it again. Not set on file import — an imported corpus does belong on
          // the server, and stamping it would silently keep it off.
          if (opts && opts.markSynced) merged.syncedAt = LearnModel.touchedAt(merged);
          s.items.put(merged);
        };
      }
    }).then(() => added);
  }

  // `opts.viaSync` marks a review that arrived from the server rather than one the
  // user just gave. Same reason as `syncedAt` on items: without it the review log
  // bounces back up on the next push.
  // `opts.mode` (§5.2: which exercise form was graded) and `opts.practice` (§5.3: a
  // free-practice rep, logged but never schedule-advancing) travel on the row itself
  // — the log is history, and history stripped of its circumstances stops being one.
  function recordReview(itemId, grade, at, opts) {
    const row = { itemId, grade, at };
    if (opts && opts.viaSync) row.viaSync = 1;
    if (opts && opts.practice) row.practice = 1;
    if (opts && opts.mode) row.mode = opts.mode;
    return tx(['reviews'], 'readwrite', (s) => { s.reviews.add(row); });
  }

  // ─── Storage pressure ────────────────────────────────────────────────────
  // Law 2 (domain-design §9.1) lets us drop material; it does NOT let the user find
  // out months later. Anything discarded is counted here so the review page and
  // settings can report it — see learning-design.md §7.1.

  function bumpPressure(field, n, now) {
    if (!n) return Promise.resolve();
    return getMeta('pressure', null).then((p) => {
      const next = Object.assign({ evicted: 0, dropped: 0, quotaBlocked: 0, at: 0 }, p || {});
      next[field] = (next[field] || 0) + n;
      next.at = now || Date.now();
      return setMeta('pressure', next);
    }).catch(() => {});
  }

  // What the surfaces render. `atCap` is the live condition; the counters are what
  // has already been lost since the user last acted on it.
  function pressure() {
    return Promise.all([allItems(), getMeta('pressure', null)]).then(([items, p]) => {
      const rec = Object.assign({ evicted: 0, dropped: 0, quotaBlocked: 0, at: 0 }, p || {});
      const known = items.filter((it) => LearnScheduler.stateFor(it) === 'known' && !it.starred).length;
      return {
        total: items.length,
        cap: MAX_ITEMS,
        atCap: items.length >= MAX_ITEMS,
        nearCap: items.length >= Math.floor(MAX_ITEMS * 0.95),
        evicted: rec.evicted || 0,
        dropped: rec.dropped || 0,
        // Uploads the server refused for lack of room. Nothing was lost — it is all
        // still local — but the user is the only one who can make room, so they have
        // to be told (§7.1).
        quotaBlocked: rec.quotaBlocked || 0,
        at: rec.at || 0,
        reclaimable: known,
      };
    }).catch(() => null);
  }

  function clearPressure() { return setMeta('pressure', { evicted: 0, dropped: 0, quotaBlocked: 0, at: 0 }); }

  // The TARGETED cleanup. 'known' cards are the ones the scheduler itself concluded
  // you no longer need, so this frees space without throwing away a single card you
  // are actively learning — unlike clearAll(), which is the nuclear option.
  function clearKnown() {
    return allItems().then((items) => {
      const doomed = items.filter((it) => !it.starred && LearnScheduler.stateFor(it) === 'known');
      if (!doomed.length) return 0;
      return tx(['items'], 'readwrite', (s) => { for (const d of doomed) s.items.delete(d.id); })
        .then(() => clearPressure())
        .then(() => doomed.length);
    });
  }

  // ─── What gets dropped: pure, and exported so it can be tested ───────────
  //
  // These two decide what this device forgets. Everything around them is IndexedDB
  // plumbing, which the zero-dep suite cannot reach — so the decisions live out here
  // where they can be asserted on directly, and the untestable part is reduced to
  // "call the pure function, then write the result".

  // Evict 'known' first, then lowest salience, then oldest — never a starred card
  // and never one the user is actively learning.
  function doomedFor(items, cap) {
    if (items.length <= cap) return [];
    const overflow = items.length - cap;
    const rank = (it) => (it.state === 'known' ? 0 : it.state === 'candidate' ? 1 : 2);
    return items
      .filter((it) => !it.starred)
      .sort((a, b) => rank(a) - rank(b)
        || (a.salience || 0) - (b.salience || 0)
        || (a.createdAt || 0) - (b.createdAt || 0))
      .slice(0, overflow);
  }

  // Oldest tombstones are forgotten first (§7.3): the worst case is that a card
  // evicted long ago returns once, i.e. exactly the behaviour we had before
  // tombstones existed.
  function staleTombs(rows, cap) {
    if (rows.length <= cap) return [];
    return rows.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, rows.length - cap);
  }

  // Bounded corpus.
  function evictIfNeeded(limit, now) {
    const cap = limit || MAX_ITEMS;
    return allItems().then((items) => {
      if (items.length <= cap) return 0;
      const doomed = doomedFor(items, cap);
      if (!doomed.length) return 0;
      const at = now || Date.now();
      return tx(['items', 'tombs'], 'readwrite', (s) => {
        for (const d of doomed) { s.items.delete(d.id); s.tombs.put({ id: d.id, at }); }
      })
        // `everEvicted` is a separate, never-cleared flag rather than a read of
        // `tombs` or of the pressure counter, because both of those are erasable:
        // tombstones age out (below) and `clearPressure` is a user action. What it
        // gates — whether this device may ever write a compaction snapshot (§7.3) —
        // must not become true again just because the evidence was tidied away.
        .then(() => setMeta('everEvicted', 1))
        .then(() => trimTombs())
        .then(() => bumpPressure('evicted', doomed.length))
        .then(() => doomed.length);
    });
  }

  // ─── Eviction tombstones (§7.3) ──────────────────────────────────────────
  //
  // The rule they implement: **eviction is local pressure, not the user deleting
  // something.** So it must never propagate — no tombstone kind in the chunk format,
  // no snapshot that omits what one device dropped. It only stops the SYNC PULL from
  // handing the material straight back, which is what otherwise makes the user's
  // cleanup look like it did nothing (「清理完又满了」).
  //
  // Capture is deliberately NOT filtered: if the user reads the sentence again, the
  // Collector captures it and the drain re-admits it, tombstone and all. That keeps
  // law 1's direction of travel intact and mirrors §8.4.2's split between "a new
  // observation" and "a copy of the same fact".

  function tombstones() {
    return getAllFrom('tombs').then((rows) => new Set(rows.map((r) => r.id)))
      .catch(() => new Set());   // a broken tomb store must never block a sync
  }

  function hasEverEvicted() { return getMeta('everEvicted', 0).then((v) => !!v); }

  // Bounded like everything else here. On overflow the OLDEST are forgotten, so the
  // worst case is that a long-ago-evicted card returns once — i.e. it degrades to the
  // behaviour we had before tombstones existed, which is the right direction for a
  // bound to fail in.
  function trimTombs(limit) {
    const cap = limit || MAX_TOMBS;
    return getAllFrom('tombs').then((rows) => {
      const doomed = staleTombs(rows, cap);
      if (!doomed.length) return 0;
      return tx(['tombs'], 'readwrite', (s) => { for (const d of doomed) s.tombs.delete(d.id); })
        .then(() => doomed.length);
    });
  }

  // ─── Sentence-note cache (§9.2) ──────────────────────────────────────────
  // One generation per card per prompt version: the answer face renders from
  // here on every revisit. LearnNotes owns the version gate (`v` on the
  // record); a bump — only ever for a prompt that produced wrong output —
  // makes the next click regenerate. Otherwise charged exactly once.

  function getNote(id) {
    let out = null;
    return tx(['notes'], 'readonly', (s) => {
      const r = s.notes.get(id);
      r.onsuccess = () => { out = r.result || null; };
    }).then(() => out).catch(() => null);
  }

  function putNote(id, data, meta) {
    const rec = Object.assign({ id, data, at: Date.now() }, meta || {});
    return tx(['notes'], 'readwrite', (s) => { s.notes.put(rec); });
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
    // Wipes `meta` too, which resets the pressure counters — correct, since after
    // this there is nothing left to be under pressure about. That also clears
    // `everEvicted`, and tombstones go with it: an empty corpus has not evicted
    // anything, and keeping the tombstones would make a fresh re-sync silently
    // refuse to restore the very cards the user just asked to start over with.
    return tx(['items', 'sources', 'reviews', 'meta', 'audio', 'tombs'], 'readwrite', (s) => {
      s.items.clear(); s.sources.clear(); s.reviews.clear();
      s.meta.clear(); s.audio.clear(); s.tombs.clear();
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
    MAX_ITEMS, MAX_AUDIO_BYTES, MAX_TOMBS,
    open, allItems, allSources, allReviews, putItem, mergeBatch, recordReview,
    getMeta, setMeta, evictIfNeeded, clearAll, stats,
    tombstones, hasEverEvicted, trimTombs,
    getNote, putNote,
    doomedFor, staleTombs,          // pure — exported for the suite, see above
    pressure, bumpPressure, clearPressure, clearKnown,
    getAudio, putAudio, evictAudioIfNeeded, audioStats, clearAudio,
  };
})();
