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
  const OWNER = 'corpusOwner';         // which account this corpus belongs to (§account switch)
  const PAGE = 200;                    // rows per pull request
  const COMPACT_AT = 40;               // chunks before a snapshot replaces them
  const PUSH_BATCH = 200;              // cards per chunk — §8.5 lever 3, §8.4's rule

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
  // Lives in LearnModel so that `mergeBatch`, which stamps `syncedAt`, and this,
  // which reads it, can never drift apart.
  const touchedAt = (item) => LearnModel.touchedAt(item);

  // ─── Owner gate ──────────────────────────────────────────────────────────
  // A corpus belongs to an account, and this is the only place that fact is
  // enforced. It lives in the data layer rather than in the UI because there are
  // already SIX push triggers (options ×4, review ×4, the app's doSync/quietSync,
  // settings ×2) and `visibilitychange`/`online` fire them without a user doing
  // anything. The proof that a UI-level rule leaks is in the repo's own history:
  // the app's sign-out path was written to call `forget()` and never did.
  //
  // Five rows, all total:
  //   no stamp + no identity  → allow, do NOT claim   (today's behaviour; the
  //                             China extension, whose sync is off, is always here)
  //   no stamp + identity     → claim, then allow     (every existing device, once)
  //   stamp    + no identity  → refuse `owner_unknown`
  //   stamp    == identity    → allow
  //   stamp    != identity    → refuse `owner_mismatch`
  //
  // Row 3 is fail-CLOSED. `git log -S userId` shows the field has been in the
  // session since sync's first commit, so the row is unreachable in practice —
  // which is exactly why choosing the strict direction costs nothing. (Contrast
  // §7.4.5's `userDels`, which is fail-open: that is a ledger that can be damaged,
  // this is an identity. Opposite directions, on purpose.)
  function ownerErr(code) { const e = new Error(code); e.code = code; return e; }

  async function ownerGate() {
    const [stamp, me] = await Promise.all([
      LearnStore.getMeta(OWNER, null),
      (async () => { try { return await LearnAuth.userId(); } catch (_) { return null; } })(),
    ]);
    const owner = stamp && stamp.userId;
    if (!owner) {
      // Claiming on first successful gate rather than on sign-in: a half-finished
      // sign-in must not put a permanent label on a corpus.
      if (me) {
        const claimed = { userId: me, at: Date.now() };
        await LearnStore.setMeta(OWNER, claimed);
        return claimed;
      }
      return null;
    }
    if (!me) throw ownerErr('owner_unknown');
    if (owner !== me) throw ownerErr('owner_mismatch');
    return stamp;
  }

  async function push(now) {
    const at = now || Date.now();
    // Before `since`, and before the first read of local material: there must be
    // no path where `fresh` has already been computed and something later decides
    // whether to send it.
    const claim = await ownerGate();
    const since = (await LearnStore.getMeta(PUSHED, 0)) || 0;
    const [items, sources, reviews, delsAll, rules] = await Promise.all([
      LearnStore.allItems(), LearnStore.allSources(), LearnStore.allReviews(),
      LearnStore.allDels(), LearnChunk.readRules(),
    ]);

    // `> syncedAt` is what stops the echo: an item whose newest timestamp is exactly
    // the one we received from the server has not moved HERE, so sending it back
    // would only duplicate it. Only a local review or re-read lifts touchedAt past
    // the watermark. Same idea for reviews, which carry `viaSync` instead.
    const fresh = items.filter((it) => {
      const t = touchedAt(it);
      return t > since && t > (it.syncedAt || 0);
    });
    const revs = reviews.filter((r) => (r.at || 0) > since && !r.viaSync);
    // §7.4 / §8.9 — deletes and rules ride the same watermark. Unlike items there
    // is no `syncedAt` twin, so intent that ARRIVED by pull can echo back up on
    // the next push — once, until PUSHED passes its timestamp. Deliberate:
    // replay is idempotent and a `d` row is bytes; cheap-and-redundant beats
    // clever-and-lossy here exactly as it does for `lastSeenAt` above.
    const delsDue = delsAll.filter((d) => (d.at || 0) > since);
    // §8.9's rules live in chrome.storage, which does NOT partition along with the
    // corpus. On the PRIMARY corpus that is still right — those rules and that
    // corpus have belonged to the same person since the device was set up. On a
    // per-account corpus it is not: the rules sitting on the device were written by
    // whoever used it before, and `block` is the list of sites that person chose to
    // hide, which is a privacy surface rather than merely stale data. A secondary
    // corpus therefore only uploads rules edited after it was claimed.
    const mine = LearnStore.currentDbName() === LearnStore.DB_NAME
      || (rules && (rules.updatedAt || 0) > ((claim && claim.at) || 0));
    const rulesDue = mine && rules && (rules.updatedAt || 0) > since ? rules : null;
    if (!fresh.length && !revs.length && !delsDue.length && !rulesDue) {
      await LearnStore.setMeta(PUSHED, at);
      return { pushed: 0, reviews: 0, bytes: 0, chunks: 0, dels: 0, rules: 0 };
    }

    // ─── Batched, because the first push after signing in is the whole corpus ──
    //
    // §8.5 lever 3 has always described chunks as "~200 cards packed together", but
    // this built ONE bundle and did ONE insert. That was harmless while only cards
    // that had entered the deck travelled; since the candidate pool travels too
    // (§8.5), a user who has been capturing for three months pushes ~20,000 items the
    // first time they sign in — ~1.7 MB compressed, and PostgREST carries bytea as a
    // `\x` hex literal, so a ~3.4 MB request body.
    //
    // `PUSHED` stays all-or-nothing: any failure leaves it untouched and the whole
    // push is retried, which idempotent replay makes safe. Advancing it per batch
    // looks tempting and is a trap — `revs` is selected by `at > since`, and a review
    // can be older than the card that carries it (a later re-read lifts `lastSeenAt`),
    // so a partly-advanced watermark would step over reviews whose card had not been
    // sent yet.
    const batches = [];
    for (let i = 0; i < fresh.length; i += PUSH_BATCH) batches.push(fresh.slice(i, i + PUSH_BATCH));
    if (!batches.length) batches.push([]);

    // `build()` keeps a chunk self-consistent by dropping reviews whose card is not in
    // it. Across batches that is exactly right — a review rides with its own card —
    // EXCEPT for a review whose card is in no batch at all: it would be dropped while
    // `PUSHED` advanced past it, i.e. lost silently and permanently.
    //
    // This is reachable, not hypothetical: `evictIfNeeded` deletes items and leaves
    // their reviews behind (`store.js`), so any evicted card's reviews are orphans
    // from that moment on. They ride in the final chunk.
    const freshIds = new Set(fresh.map((it) => it.id));
    const orphans = revs.filter((r) => !freshIds.has(r.itemId));

    const out = { pushed: 0, reviews: 0, bytes: 0, chunks: 0, dels: delsDue.length, rules: rulesDue ? 1 : 0 };
    for (let i = 0; i < batches.length; i++) {
      const last = i === batches.length - 1;
      // Deletes and rules ride the FINAL chunk, like orphan reviews — one place,
      // after every card they could refer to.
      const bundle = LearnChunk.build(batches[i], sources, revs, at,
        last ? delsDue : [], last ? rulesDue : null);
      if (last && orphans.length) {
        bundle.reviews = bundle.reviews.concat(orphans);
        bundle.header.counts.reviews = bundle.reviews.length;
      }
      if (!bundle.cards.length && !bundle.reviews.length && !bundle.dels.length && !bundle.rules) continue;
      const blob = await LearnChunk.deflate(LearnChunk.toJsonl(bundle));
      await insert('bundle', blob, 0);
      out.pushed += bundle.cards.length;
      out.reviews += bundle.reviews.length;
      out.bytes += blob.length;
      out.chunks++;
    }
    await LearnStore.setMeta(PUSHED, at);
    return out;
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
    // Gating only push is not enough: pulling B's cards into A's corpus makes the
    // counts lie, and §7.1 law 2 says a corpus that lost or mixed anything has to
    // say so rather than quietly look plausible.
    await ownerGate();
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
        const ours = !!(bundle.header && bundle.header.format === LearnChunk.FORMAT);

        // Two failures that look alike and must be handled OPPOSITELY.
        //
        // Ours but written by a NEWER client (an encryption envelope this build
        // cannot open): the row is perfectly good, we simply cannot read it yet.
        // Stop here and DO NOT advance the cursor — skipping would step over it
        // permanently, so upgrading later would silently never recover that
        // material. A stalled sync is recoverable; a skipped chunk is not.
        if (ours && !LearnChunk.canRead(bundle.header)) {
          stats.needsUpgrade = LearnChunk.encOf(bundle.header);
          return stats;
        }
        // Not ours / unparseable: there is nothing to recover by waiting, and
        // stopping would wedge sync forever on one bad row. Skip, count, advance.
        if (ours) {
          const s = await LearnChunk.replay(bundle, { fromServer: true });
          stats.cards += s.cards; stats.reviews += s.reviews; stats.chunks++;
          if (s.deleted) stats.deleted = (stats.deleted || 0) + s.deleted;
          if (s.rules) stats.rules = 1;
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
    // The only function that uploads AND deletes (POST the whole corpus, then
    // DELETE everything at or below the high-water mark). Run under a mismatch it
    // would hand A's corpus to B and erase B's history in the same breath.
    await ownerGate();
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
    // ─── Two preconditions, both about COMPLETENESS ──────────────────────────
    //
    // Compaction's licence to delete rests entirely on the snapshot being complete
    // (§8.4: it supersedes everything below it *because* it is). Anything that makes
    // this device's corpus a subset of the archive therefore disqualifies it, and
    // getting this wrong is not churn — it is permanent loss of material the user
    // never asked to delete, on every device at once.

    // **Never compact from an empty corpus.** A snapshot of nothing supersedes
    // nothing; writing one would erase the account's entire history on behalf of the
    // device that knows the least — one that simply has not pulled yet.
    if (!items.length) return { compacted: 0, skipped: 'empty-corpus' };

    // **Never compact from a device that has ever evicted** (§7.3). Eviction is local
    // storage pressure, and a device under it holds a working set, not the archive.
    // Note `everEvicted` is a latch, not a count: tombstones age out and the pressure
    // counters are user-clearable, so neither can be asked this question.
    if (await LearnStore.hasEverEvicted()) return { compacted: 0, skipped: 'ever-evicted' };

    // Batched for the same reason a push is (§8.4) — this is the WHOLE corpus, up to
    // the 20,000-item cap. Splitting it does not weaken the property compaction rests
    // on: "a snapshot supersedes everything below it because it is complete" is about
    // the SET of rows above the deletion point, not about there being exactly one. All
    // parts are written BEFORE anything is deleted, so a failure part-way leaves
    // redundant rows — which the next compaction sweeps — and never a gap.
    // §7.4/§8.9 — every snapshot ENDS with the full delete ledger and the current
    // rules. This is how a user delete becomes permanent server-side (the deleted
    // cards simply are not in the snapshot) while still healing any device whose
    // cursor was behind the swept `d` rows — including an old client that skipped
    // them before updating. The ledger rides the FINAL part so it replays after
    // every card in the snapshot.
    const [delsAll, rules] = await Promise.all([LearnStore.allDels(), LearnChunk.readRules()]);
    let cards = 0;
    for (let i = 0; i < items.length; i += PUSH_BATCH) {
      const last = i + PUSH_BATCH >= items.length;
      const part = LearnChunk.build(items.slice(i, i + PUSH_BATCH), sources, reviews, at,
        last ? delsAll : [], last ? rules : null);
      await insert('bundle', await LearnChunk.deflate(LearnChunk.toJsonl(part)), gen);
      cards += part.cards.length;
    }

    // Delete strictly BELOW the snapshot's own rows and only what existed when we
    // read: a concurrent push must not be swept before anyone has pulled it.
    await call(rest(MT_BACKEND.table) + '?seq=lte.' + highWater,
      { method: 'DELETE', headers: await headers() });
    return { compacted: rows.length, generation: gen, cards };
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  // Status channel (interaction-spec「多设备同步一致性」): the review header keeps a
  // persistent line fed by these events. States: 'running' | 'done'{pulled,pushed}
  // | 'offline' | 'error'{code} | 'signed_out'. Listeners must never break a sync.
  const statusListeners = [];
  function onStatus(fn) {
    if (typeof fn === 'function') statusListeners.push(fn);
    return () => {
      const i = statusListeners.indexOf(fn);
      if (i >= 0) statusListeners.splice(i, 1);
    };
  }
  function emit(state, extra) {
    const ev = Object.assign({ state, at: Date.now() }, extra || {});
    for (const fn of statusListeners.slice()) { try { fn(ev); } catch (_) {} }
  }

  // The one timestamp every surface's 「同步完成 · {time}」 reads. Stamped by BOTH
  // the manual and the auto path — a success is a success regardless of who asked.
  const LAST_OK = 'lastSyncOkAt';

  // Pull before push so that a review recorded on another device is folded in before
  // this device uploads its own view of the same card.
  async function sync(now) {
    emit('running');
    try {
      const pulled = await pull();
      // Do not push on top of material we could not read. Our push would land at a
      // higher `seq` than the chunk we stalled on, and a later compaction — ours or
      // another device's — could then sweep it away before we ever caught up.
      if (pulled.needsUpgrade) { emit('error', { code: 'enc_unsupported' }); return { pulled, pushed: null }; }
      const pushed = await push(now);
      await LearnStore.setMeta(LAST_OK, now || Date.now());
      emit('done', { pulled, pushed });
      return { pulled, pushed };
    } catch (e) {
      emit(e && e.code === 'offline' ? 'offline' : 'error', { code: e && e.code });
      throw e;
    }
  }

  // ─── Auto-sync (§8.8) — the page-open heartbeat ──────────────────────────
  // Silent BY CONTRACT, not by sloppiness: the user did not initiate this run, so
  // its failure may not interrupt them (§8.8 rule 1) — every error path resolves to
  // null. The manual button keeps the loud path. Quota visibility is §8.3's job
  // (insert() bumps the pressure counter before this swallows the error).
  //
  // `inflight` dedupes concurrent triggers — two surfaces opening at once, or the
  // app's launch sync racing review.js's boot sync — into ONE run whose result both
  // callers see. The throttle stamp is written only after a SUCCESSFUL sync, so an
  // offline attempt costs one failed request per page open and retries next open.
  const AUTO_AT = 'autoSyncAt';
  const AUTO_MIN_MS = 10 * 60 * 1000;
  let inflight = null;

  // `opts.force` — an ENTRY sync (app launch/foreground, review page open): the
  // user just arrived, so the throttle yields (interaction-spec「多设备同步一致性」:
  // 每次进入即同步). Passive surfaces (options page) stay throttled. A successful
  // forced run still stamps AUTO_AT so the passive throttle keeps its meaning.
  function autoSync(now, opts) {
    opts = opts || {};
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        // Yield one microtask BEFORE any return path. Without this, a path with
        // no await (the offline pre-check) runs the whole body — including the
        // finally that clears `inflight` — synchronously DURING the assignment's
        // right-hand side, and the assignment then parks the already-settled
        // promise in `inflight` forever: every later autoSync returns the corpse
        // and sync goes silent until the page reloads. Found by
        // verify-sync-consistency's offline-recovery step (2026-08-09).
        await Promise.resolve();
        const at = now || Date.now();
        // navigator.onLine === false is definitive ("definitely offline"); true
        // proves nothing — the fetch-throw → code 'offline' path stays the real
        // detector. This pre-check just makes the offline state instant and free.
        // `opts.online` skips it: a sync triggered BY the 'online' event carries
        // the platform's own "we are connected" assertion, and the flag can lag
        // behind reality (observed stuck-false after emulated offline).
        if (!opts.online && typeof navigator !== 'undefined' && navigator.onLine === false) {
          emit('offline');
          return null;
        }
        // Token failure kinds are NOT interchangeable (§8.4.1 判死收紧): a thrown
        // refresh (offline / 5xx / body-less 4xx) leaves the session alive and
        // must render as offline/error — the old blanket `catch(() => null)`
        // painted 「未登录」 over every network hiccup.
        let t;
        try { t = await LearnAuth.token(); }
        catch (e) {
          if (e && e.code === 'offline') emit('offline');
          else emit('error', { code: (e && e.code) || 'token' });
          return null;
        }
        if (!t) { emit('signed_out'); return null; }   // signed out ⇒ nothing to do
        const last = (await LearnStore.getMeta(AUTO_AT, 0)) || 0;
        if (!opts.force && at - last < AUTO_MIN_MS) return null;   // heartbeat, not a drumroll
        const r = await sync(at);
        await LearnStore.setMeta(AUTO_AT, at);
        return r;
      } catch (_) {
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
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

  return { push, pull, sync, autoSync, compact, usage, forget, onStatus, toHex, fromHex, touchedAt, ownerGate, OWNER, COMPACT_AT, AUTO_MIN_MS, LAST_OK };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnSync;
