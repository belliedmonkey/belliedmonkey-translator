// learn/sync.js — the corpus, across devices. See docs/learning-design.md §8.
//
// Speaks PostgREST and NOTHING ELSE about the backend: it asks `LearnAuth` for a
// token and never learns where it came from (§8.4.1). The wire format is `LearnChunk`
// unchanged — a synced chunk and an exported file are the same bytes, which is why
// sync could be added without touching the format, and why "export" is not a second
// implementation that can drift from this one.
//
// The whole design rests on two properties that are already tested elsewhere:
//   · the log is APPEND-ONLY (the database has no UPDATE policy — §8.4)
//   · replay is IDEMPOTENT (LearnChunk.replay dedupes)
// Together they make every failure mode here recoverable by retrying: a push that
// lands twice, a pull that runs on partly-applied state, two devices pushing at once.
// There is no lock anywhere in this file, and that is the reason.
//
// EXTENSION PAGES ONLY.

var LearnSync = (() => {
  const CURSOR = 'syncCursor';         // highest `seq` already replayed locally
  const PUSHED = 'syncPushedAt';       // ms; everything touched before this is up there
  const PAGE = 200;                    // rows per pull request
  const COMPACT_AT = 40;               // chunks before a snapshot replaces them

  function rest(path) { return MT_BACKEND.url + '/rest/v1/' + path; }

  async function headers(extra) {
    const t = await LearnAuth.token();
    if (!t) { const e = new Error('not signed in'); e.code = 'signed_out'; throw e; }
    return Object.assign({
      apikey: MT_BACKEND.anonKey,
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json',
    }, extra || {});
  }

  async function call(url, init) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (netErr) {
      const e = new Error(String(netErr && netErr.message || netErr));
      e.code = 'offline';                 // retryable; not the user's problem to fix
      throw e;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      const msg = (json && (json.message || json.hint || json.error)) || ('HTTP ' + res.status);
      const e = new Error(msg);
      e.status = res.status;
      // The quota trigger raises SQLSTATE 53100. Recognising it by code rather than by
      // matching the message means a reworded message cannot turn a full account into
      // an unexplained failure.
      e.code = (json && json.code === '53100') || /quota exceeded/i.test(msg)
        ? 'quota' : 'http_' + res.status;
      throw e;
    }
    return json;
  }

  // ─── Push ────────────────────────────────────────────────────────────────

  // A card is due for upload when anything about it moved since the last successful
  // push. `lastSeenAt` is included even though re-reading a page changes no learning
  // state: re-uploading a card costs a few bytes and replay discards it, whereas
  // MISSING an update is silent divergence between devices. Cheap-and-redundant beats
  // clever-and-lossy every time here.
  function touchedAt(item) {
    const sched = item.sched || {};
    return Math.max(item.createdAt || 0, item.lastSeenAt || 0, sched.lastReviewAt || 0);
  }

  async function push(now) {
    const at = now || Date.now();
    const since = (await LearnStore.getMeta(PUSHED, 0)) || 0;
    const [items, sources, reviews] = await Promise.all([
      LearnStore.allItems(), LearnStore.allSources(), LearnStore.allReviews(),
    ]);

    const fresh = items.filter((it) => touchedAt(it) > since);
    const revs = reviews.filter((r) => (r.at || 0) > since);
    const bundle = LearnChunk.build(fresh, sources, revs, at);
    if (!bundle.cards.length && !bundle.reviews.length) {
      await LearnStore.setMeta(PUSHED, at);
      return { pushed: 0, bytes: 0 };
    }

    const blob = await LearnChunk.deflate(LearnChunk.toJsonl(bundle));
    await insert('bundle', blob, 0);
    await LearnStore.setMeta(PUSHED, at);
    return { pushed: bundle.cards.length, reviews: bundle.reviews.length, bytes: blob.length };
  }

  // PostgREST has no bytea literal in JSON, so the blob travels as a `\x…` hex string,
  // which Postgres casts on the way in. It is ~2× on the wire; the alternative is a
  // base64 column, i.e. ~1.33× stored FOREVER instead of 2× for one request.
  function toHex(bytes) {
    let s = '\\x';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }
  function fromHex(hex) {
    const s = String(hex || '').replace(/^\\x/, '');
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  async function insert(kind, blob, generation) {
    try {
      return await call(rest(MT_BACKEND.table), {
        method: 'POST',
        headers: await headers({ Prefer: 'return=representation' }),
        body: JSON.stringify({ kind, blob: toHex(blob), generation: generation || 0 }),
      });
    } catch (e) {
      // §7.1 / AGENTS.md rule 7: a full account stops uploading and SAYS SO. It must
      // never look like success, and it must never silently drop what it could not
      // send — the local corpus keeps everything, and `PUSHED` is deliberately not
      // advanced, so the same material is retried once space exists.
      if (e.code === 'quota') { try { await LearnStore.bumpPressure('quotaBlocked', 1); } catch (_) {} }
      throw e;
    }
  }

  // ─── Pull ────────────────────────────────────────────────────────────────

  async function pull() {
    let cursor = (await LearnStore.getMeta(CURSOR, 0)) || 0;
    const stats = { chunks: 0, cards: 0, reviews: 0, skipped: 0 };

    for (;;) {
      const rows = await call(
        rest(MT_BACKEND.table) + '?select=seq,blob&seq=gt.' + cursor +
        '&order=seq.asc&limit=' + PAGE,
        { method: 'GET', headers: await headers() });
      if (!rows || !rows.length) break;

      for (const row of rows) {
        const text = await LearnChunk.inflate(fromHex(row.blob));
        const bundle = LearnChunk.fromJsonl(text);
        // A chunk we cannot read is skipped, counted, and the cursor still advances
        // past it. Stopping instead would wedge sync permanently on one bad row.
        if (bundle.header && bundle.header.format === LearnChunk.FORMAT) {
          const s = await LearnChunk.replay(bundle);
          stats.cards += s.cards; stats.reviews += s.reviews; stats.chunks++;
        } else {
          stats.skipped++;
        }
        cursor = row.seq;
        // Persisted per row, not per page: an interrupted pull resumes where it
        // stopped instead of replaying the whole page (harmless, but slow).
        await LearnStore.setMeta(CURSOR, cursor);
      }
      if (rows.length < PAGE) break;
    }
    return stats;
  }

  // ─── Compaction ──────────────────────────────────────────────────────────
  // The log grows with every push; a snapshot at a higher `seq` supersedes everything
  // below it, because a snapshot is COMPLETE. A device with an old cursor pulling
  // `seq > cursor` therefore still receives the whole corpus in one row.
  //
  // No lock: if two devices compact at once, both snapshots land and both are
  // complete, so the result is one redundant row that the next compaction sweeps.
  // Idempotent replay is what makes that a non-event rather than a corruption.

  async function compact(now) {
    const at = now || Date.now();
    const rows = await call(
      rest(MT_BACKEND.table) + '?select=seq,generation&order=seq.desc&limit=1000',
      { method: 'GET', headers: await headers() });
    if (!rows || rows.length < COMPACT_AT) return { compacted: 0 };

    const highWater = Math.max.apply(null, rows.map((r) => r.seq));
    const gen = Math.max.apply(null, rows.map((r) => r.generation || 0)) + 1;

    const [items, sources, reviews] = await Promise.all([
      LearnStore.allItems(), LearnStore.allSources(), LearnStore.allReviews(),
    ]);
    const snapshot = LearnChunk.build(items, sources, reviews, at);
    await insert('bundle', await LearnChunk.deflate(LearnChunk.toJsonl(snapshot)), gen);

    // Delete strictly BELOW the snapshot's own row and only what existed when we
    // read: a concurrent push must not be swept before anyone has pulled it.
    await call(rest(MT_BACKEND.table) + '?seq=lte.' + highWater,
      { method: 'DELETE', headers: await headers() });
    return { compacted: rows.length, generation: gen, cards: snapshot.cards.length };
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  // Pull before push so that a review recorded on another device is folded in before
  // this device uploads its own view of the same card.
  async function sync(now) {
    const pulled = await pull();
    const pushed = await push(now);
    return { pulled, pushed };
  }

  async function usage() {
    const rows = await call(MT_BACKEND.url + '/rest/v1/rpc/bt_usage',
      { method: 'POST', headers: await headers(), body: '{}' });
    const r = (rows && rows[0]) || {};
    return {
      bytes: Number(r.bytes || 0),
      chunks: Number(r.chunks || 0),
      quota: Number(r.quota || MT_BACKEND.quotaBytes),
    };
  }

  // Turning sync off leaves the local corpus untouched — §8's "not syncing is the
  // default state, not a degraded one". Only the pointers go.
  async function forget() {
    await LearnStore.setMeta(CURSOR, 0);
    await LearnStore.setMeta(PUSHED, 0);
  }

  return { push, pull, sync, compact, usage, forget, toHex, fromHex, touchedAt, COMPACT_AT };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnSync;
