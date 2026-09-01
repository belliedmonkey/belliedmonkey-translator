// learn/store.js — the learning corpus. EXTENSION PAGES ONLY.
//
// This must never be loaded into a content script. A content script's `indexedDB`
// belongs to the HOST PAGE's origin, so the corpus would scatter across every site
// the user visits AND be readable by the page's own scripts. Here, on a
// chrome-extension:// page, it is the extension's own private database.
// See docs/learning-design.md §7.

var LearnStore = (() => {
  const DB_NAME = 'mt-learn';   // the PRIMARY corpus — see useDb() below
  // v2 adds the `audio` store; v3 adds `tombs` (§7.3); v4 adds `notes` (§9.2);
  // v5 adds `dels` (§7.4 user-delete ledger).
  // The upgrade path only ever ADDS (every create is guarded by `contains`), so
  // bumping the version never touches existing data. EVERY bump: npm run test:idb.
  const DB_VERSION = 5;
  const MAX_ITEMS = 20000;
  const MAX_TOMBS = 20000;   // same order as the corpus; oldest forgotten past this
  const MAX_DELS = 20000;    // §7.4: oldest deletes forgotten first — a very stale
                             // device may then re-introduce those cards once, the
                             // same failure direction as tombs
  const MAX_AUDIO_BYTES = 200 * 1024 * 1024;   // 200 MB, LRU-evicted

  // ─── Per-account databases ───────────────────────────────────────────────
  // One device used to mean one corpus: DB_NAME was a constant, so whoever signed
  // in saw whatever the previous person had left behind. Worse than the wrong
  // numbers on screen: sync PUSHED that corpus into the new account, because the
  // `syncedAt` guard is only stamped on the PULL path and locally captured cards
  // are therefore immune to it.
  //
  // The primary database keeps its name AND its bytes. It belongs to the first
  // account that signs in, and every device that exists today is in exactly that
  // state — so upgrading moves nothing, copies nothing, and reads byte-for-byte
  // the same. Only a DIFFERENT account gets a database of its own, which is why a
  // single-account device never pays for any of this.
  let dbName = DB_NAME;

  function dbNameFor(userId) { return userId ? DB_NAME + '-' + userId : DB_NAME; }
  function currentDbName() { return dbName; }

  // Switching MUST close the live handle first: an open connection blocks the
  // other database's upgrade transaction (a silent hang, not an error), and every
  // read issued after this point has to land in the new corpus rather than the
  // one we just left.
  async function useDb(name) {
    const next = name || DB_NAME;
    if (next === dbName) return dbName;
    const prev = dbp;
    dbp = null;
    dbName = next;
    if (prev) { try { (await prev).close(); } catch (_) { /* already closed / rejected */ } }
    return dbName;
  }

  // 关掉当前句柄，不改 dbName。「清除本机全部数据」必须先调它：
  // deleteDatabase 撞上一个还开着的连接会发 blocked 事件然后**一直挂着** ——
  // 不是错误，是永远不落定。于是清除流程会顺利走完、报「已清除」，而库还在。
  // useDb() 上面那段注释为同一个原因存在；这里把它单独拿出来，是因为清除不换库。
  async function closeDb() {
    const prev = dbp; dbp = null;
    if (prev) { try { (await prev).close(); } catch (_) { /* 已关或本来就失败 */ } }
  }

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    // Memoize SUCCESS only. A rejected open used to stay cached for the whole
    // page session, so one transient IndexedDB failure — first launch after an
    // update, mid-`onupgradeneeded`, is the classic moment — made every later
    // call fail instantly and the app paint "signed out / empty" until relaunch.
    // Clearing the memo on rejection (only if it is still ours) lets the next
    // call retry. (The callback runs asynchronously, so `wrapped` is initialized
    // by the time it fires.)
    const wrapped = openOnce().catch((err) => {
      if (dbp === wrapped) dbp = null;
      throw err;
    });
    dbp = wrapped;
    return dbp;
  }

  function openOnce() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);
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
        // §7.4 user-delete ledger. The OPPOSITE of `tombs` in every consequence:
        // a user delete is account-level intent, so this ledger SYNCS (`d` rows),
        // applies on file import too, and never touches `everEvicted` — after a
        // user delete, "local minus deleted" IS the intended archive.
        if (!db.objectStoreNames.contains('dels')) {
          const d = db.createObjectStore('dels', { keyPath: 'id' });
          d.createIndex('at', 'at');       // oldest forgotten first
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
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
          // Watermark: what the SERVER knows — touchedAt(inc), never touchedAt of
          // the merged record. Stamping the merged state was a real bug: pulling
          // your OWN older chunk while holding a newer local review stamped the
          // watermark up to the local state, and the freshly-graded card never
          // uploaded again (the review ROW travels, but rows don't move the other
          // device's sched — found by verify-sync-consistency's 王冠断言,
          // 2026-08-09). Max with the previous stamp so an earlier pull of newer
          // server state is not regressed. Not set on file import — an imported
          // corpus does belong on the server, and stamping it would keep it off.
          if (opts && opts.markSynced) {
            merged.syncedAt = Math.max(merged.syncedAt || 0, LearnModel.touchedAt(inc));
          }
          s.items.put(merged);
        };
      }
    }).then(() => added);
  }

  // `opts.viaSync` marks a review that arrived from the server rather than one the
  // user just gave. Same reason as `syncedAt` on items: without it the review log
  // bounces back up on the next push.
  // `opts.mode` (§5.2: which exercise form was graded), `opts.practice` (§5.3: a
  // free-practice rep, logged but never schedule-advancing) and `opts.extra` (§5.4:
  // the same-card second exercise — badge-refreshing, never schedule-advancing on a
  // pass) travel on the row itself — the log is history, and history stripped of
  // its circumstances stops being one.
  function recordReview(itemId, grade, at, opts) {
    const row = { itemId, grade, at };
    if (opts && opts.viaSync) row.viaSync = 1;
    if (opts && opts.practice) row.practice = 1;
    if (opts && opts.extra) row.extra = 1;
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

  // §4.2: heal pre-rule long cards — split an alignable multi-sentence dom item
  // into per-sentence children and retire the parent through the deletion ledger
  // (so the split propagates to every synced device exactly like a user delete).
  // EXPLICIT user action only, never run on upgrade: it rewrites collected
  // material, and §3 law 2 says that must be visible. Children are inserted
  // BEFORE the parent is deleted — a crash between the two leaves duplicates,
  // which the content-addressed ids make harmless; the other order loses data.
  // The DECISION half is pure and exported (same doctrine as doomedFor below):
  // which items split, into what children, and how many multi-sentence items were
  // left whole because their translation would not align.
  function childrenFor(it, pairs) {
    return pairs.map((p) => Object.assign({}, it, {
      id: LearnModel.itemId(it.lang, p.text),
      text: p.text, tr: p.tr,
      // they were genuinely reviewed as part of the paragraph — the
      // schedule/skills they earned carry over per child
      sched: it.sched ? Object.assign({}, it.sched) : it.sched,
      skills: it.skills ? Object.assign({}, it.skills) : it.skills,
      anchor: Object.assign({}, it.anchor,
        { quote: LearnModel.normText(p.text).slice(0, 120) }),
    }));
  }

  function splitPlanFor(items) {
    const parents = [];
    const children = [];
    let skipped = 0;
    for (const it of items || []) {
      if (!it || !it.anchor || it.anchor.k !== 'dom') continue;  // media cues stay whole
      const pairs = LearnModel.splitPair(it.text, it.tr, it.lang, it.targetLang);
      if (pairs.length < 2) {
        // multi-sentence but unalignable → left whole, and counted (§3 law 2:
        // the surface says how many it could not split, not nothing).
        if (LearnModel.splitSentences(it.text, it.lang).length > 1) skipped++;
        continue;
      }
      parents.push(it);
      children.push.apply(children, childrenFor(it, pairs));
    }
    return { parents, children, skipped };
  }

  // §4.2c: the items the structural reconciler refused that an external
  // adjudicator could still align — multi-sentence on BOTH sides (a grouping
  // needs ≥2 groups per side), dom-anchored, under the splitter's input cap.
  // Pure and exported so the candidate decision can be asserted on directly.
  function llmCandidatesFor(items) {
    const out = [];
    for (const it of items || []) {
      if (!it || !it.anchor || it.anchor.k !== 'dom') continue;
      if ((it.text || '').length > LearnModel.MAX_SPLIT_INPUT
        || (it.tr || '').length > LearnModel.MAX_SPLIT_INPUT) continue;
      if (LearnModel.splitPair(it.text, it.tr, it.lang, it.targetLang).length > 1) continue;
      if (LearnModel.splitSentences(it.text, it.lang).length < 2) continue;
      if (LearnModel.splitSentences(it.tr, it.targetLang).length < 2) continue;
      out.push(it);
    }
    return out;
  }

  // §4.2d: the re-translation fallback's candidates — the SOURCE side splits
  // reliably even when the translation side is restructured or truncated, so
  // the only requirements are a splittable source and a structural refusal.
  // (Superset of llmCandidatesFor: no tr-side sentence-count requirement — a
  // truncated translation is exactly what re-translation rescues.)
  function retranslateCandidatesFor(items) {
    const out = [];
    for (const it of items || []) {
      if (!it || !it.anchor || it.anchor.k !== 'dom') continue;
      if ((it.text || '').length > LearnModel.MAX_SPLIT_INPUT
        || (it.tr || '').length > LearnModel.MAX_SPLIT_INPUT) continue;
      if (LearnModel.splitPair(it.text, it.tr, it.lang, it.targetLang).length > 1) continue;
      if (LearnModel.splitSentences(it.text, it.lang).length < 2) continue;
      out.push(it);
    }
    return out;
  }

  // §4.2c: apply ONE adjudicated split — same child construction and the same
  // insert-children-then-retire-parent order as splitLongItems (a crash between
  // the two leaves harmless content-addressed duplicates; the other order loses
  // data). The pairs come from LearnModel.alignByGroups, already verified.
  function applySplit(it, pairs, now) {
    const kids = childrenFor(it, pairs);
    return mergeBatch(kids, [])
      .then(() => deleteItems([it.id], now || Date.now()))
      .then(() => kids.length);
  }

  function splitLongItems(now) {
    const t = now || Date.now();
    return allItems().then((items) => {
      const plan = splitPlanFor(items);
      if (!plan.parents.length) return { parents: 0, children: 0, skipped: plan.skipped };
      return mergeBatch(plan.children, [])
        .then(() => deleteItems(plan.parents.map((p) => p.id), t))
        .then(() => ({ parents: plan.parents.length, children: plan.children.length, skipped: plan.skipped }));
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

  // ─── User-delete ledger (§7.4) ───────────────────────────────────────────
  //
  // The rule: **a user delete is account intent, eviction is device pressure.**
  // This path deletes the item AND its local review rows (the privacy meaning of
  // "remove this source", and what keeps `introducedToday`'s account-level budget
  // honest), writes the ledger, and touches NEITHER `tombs` NOR `everEvicted` NOR
  // the pressure counters — none of those are about the user wanting less.

  // Core: apply delete entries [{id, at}]. An item dies only if nothing about it
  // moved after the delete (`touchedAt(item) <= at` — §7.4's resolution rule,
  // which is what makes replaying the same `d` row twice a no-op and lets a card
  // genuinely re-touched elsewhere survive). The ledger is upserted with max(at)
  // regardless, so pull suppression works even for items this device never had.
  function applyDels(entries) {
    const rows = (entries || []).filter((e) => e && e.id);
    if (!rows.length) return Promise.resolve(0);
    let deleted = 0;
    return tx(['items', 'reviews', 'dels'], 'readwrite', (s) => {
      for (const e of rows) {
        const at = e.at || 0;
        const gi = s.items.get(e.id);
        gi.onsuccess = () => {
          const it = gi.result;
          if (it && LearnModel.touchedAt(it) <= at) {
            deleted++;
            s.items.delete(e.id);
            const rk = s.reviews.index('itemId').getAllKeys(e.id);
            rk.onsuccess = () => { for (const seq of rk.result || []) s.reviews.delete(seq); };
          }
        };
        const gd = s.dels.get(e.id);
        gd.onsuccess = () => {
          const prev = gd.result;
          s.dels.put({ id: e.id, at: Math.max((prev && prev.at) || 0, at) });
        };
      }
    }).then(() => trimDels()).then(() => deleted);
  }

  // The UI entry point: delete these ids NOW (来源管理 / review-card actions).
  function deleteItems(ids, at) {
    const t = at || Date.now();
    return applyDels((ids || []).map((id) => ({ id, at: t })));
  }

  // After a source-scoped delete, drop source rows nothing references any more.
  // NOT part of the delete tx: a leftover source row is harmless (161 bytes), a
  // source deleted while an item still points at it breaks attribution.
  function deleteSourcesIfOrphan(sourceIds) {
    const cand = (sourceIds || []).filter(Boolean);
    if (!cand.length) return Promise.resolve(0);
    return allItems().then((items) => {
      const referenced = new Set(items.map((it) => it.sourceId).filter(Boolean));
      const doomed = cand.filter((id) => !referenced.has(id));
      if (!doomed.length) return 0;
      return tx(['sources'], 'readwrite', (s) => { for (const id of doomed) s.sources.delete(id); })
        .then(() => doomed.length);
    });
  }

  function userDels() {
    return getAllFrom('dels')
      .then((rows) => new Map(rows.map((r) => [r.id, r.at || 0])))
      .catch(() => new Map());   // a broken ledger must never block a sync
  }

  function allDels() { return getAllFrom('dels').catch(() => []); }

  // Same shape as staleTombs, same failure direction (§7.4.5).
  function staleDels(rows, cap) {
    if (rows.length <= cap) return [];
    return rows.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, rows.length - cap);
  }

  function trimDels(limit) {
    const cap = limit || MAX_DELS;
    return getAllFrom('dels').then((rows) => {
      const doomed = staleDels(rows, cap);
      if (!doomed.length) return 0;
      return tx(['dels'], 'readwrite', (s) => { for (const d of doomed) s.dels.delete(d.id); })
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

  // `payload` is { buf: ArrayBuffer, type: string } — BYTES, never a Blob.
  // WebKit stores an IndexedDB Blob as a file-backed HANDLE, and an app
  // update/reinstall moves the container: the record survives, the handle
  // dangles — metadata intact, bytes unreadable (真机定案 2026-08-09: a
  // "healthy" cached audio/mpeg blob that refused both play() and FileReader).
  // ArrayBuffers are structured-cloned INTO the record and survive anything.
  function putAudio(k, payload, meta) {
    const rec = Object.assign(
      { k, buf: payload.buf, type: payload.type || '', bytes: (payload.buf && payload.buf.byteLength) || 0, at: Date.now() },
      meta || {});
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
    // `dels` goes too, for the same reason: a wiped device re-converges from the
    // log's `d` rows on the next pull (§7.4) — it does not need a local copy.
    return tx(['items', 'sources', 'reviews', 'meta', 'audio', 'tombs', 'dels'], 'readwrite', (s) => {
      s.items.clear(); s.sources.clear(); s.reviews.clear();
      s.meta.clear(); s.audio.clear(); s.tombs.clear(); s.dels.clear();
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
    MAX_ITEMS, MAX_AUDIO_BYTES, MAX_TOMBS, MAX_DELS, DB_NAME,
    dbNameFor, currentDbName, useDb, closeDb,
    open, allItems, allSources, allReviews, putItem, mergeBatch, recordReview,
    getMeta, setMeta, evictIfNeeded, clearAll, stats,
    tombstones, hasEverEvicted, trimTombs,
    applyDels, deleteItems, deleteSourcesIfOrphan, userDels, allDels, trimDels,
    splitLongItems, splitPlanFor, llmCandidatesFor, retranslateCandidatesFor, applySplit,
    getNote, putNote,
    doomedFor, staleTombs, staleDels,   // pure — exported for the suite, see above
    pressure, bumpPressure, clearPressure, clearKnown,
    getAudio, putAudio, evictAudioIfNeeded, audioStats, clearAudio,
  };
})();
