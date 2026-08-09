// learn/chunk.js — the corpus wire format (记忆层).
// See docs/learning-design.md §8.4 (format) and §8.2 (export is a core constraint).
//
// ONE format, three consumers: export to a file, import from a file, and — when V3
// sync lands — the body of a `learn_chunks` row. Sync is a transport change, not a
// format change, which is the whole reason this module exists on its own.
//
// A chunk is a gzip/deflate-raw'd JSONL blob: one JSON object per line, plus a
// header line. JSONL rather than one big JSON array because it appends cleanly and
// a truncated file still yields every complete line before the break.
//
// EXTENSION PAGES ONLY (it reads the corpus through LearnStore).

var LearnChunk = (() => {
  const FORMAT = 'mt-learn/1';

  // ─── The encryption envelope, declared before there is any encryption ─────
  //
  // `enc` says how the RECORD LINES are wrapped. Only 'none' is readable by this
  // build. The field exists now, while it costs ten lines, because it cannot be
  // added later without a format break — and because of what happens without it:
  // an old client handed an encrypted chunk would find lines it cannot JSON.parse
  // and report them as unreadable, dressing up "you need to update" as "your data
  // is damaged". Those two need different words and different actions.
  //
  // Consequence, and the reason this works: THE HEADER LINE IS ALWAYS PLAINTEXT.
  // Whatever encryption arrives later encrypts the records, never the header — a
  // reader that cannot decrypt must still be able to say why.
  const ENC_NONE = 'none';
  const READABLE_ENC = [ENC_NONE];

  // A file written before this field existed is plaintext by definition.
  function encOf(header) { return (header && header.enc) || ENC_NONE; }
  function canRead(header) { return READABLE_ENC.indexOf(encOf(header)) >= 0; }

  // EVERY item travels, candidates included. §8.5's lever 1 used to filter to cards
  // that had entered the deck, on the reasoning that the candidate pool "is a product
  // of what you read on THIS device". That reasoning assumed the deck and the corpus
  // live on the same device; with the host app they do not (§7.2), and the filter
  // becomes a deadlock — **a card only enters the deck by being reviewed**, so someone
  // who wants to study in the app uploads nothing, receives nothing, and never gets a
  // first card. The extension would meanwhile report 「同步成功 · 上传 0 张」.
  //
  // This is also what makes §8.2's 「一键导出全部」 true: `exportBytes` goes through
  // this same `build`, so while the filter was here the export silently omitted the
  // entire candidate pool.

  // Source rows are shared by every card from the same page (lever 2): a URL + title
  // is ~160 B, nearly half a card, and an article yields ~30 cards.
  //
  // `dels` (§7.4) is the user-delete ledger, `[{id, at}]` — CONCRETE ids, never a
  // pattern: a pattern replayed on another device would delete matches the user
  // never saw. `rules` (§8.9) is the whole learnRules object or null. Both are
  // additive row kinds (`d` / `g`); an old client counts them as `skipped`.
  function build(items, sources, reviews, now, dels, rules) {
    const cards = (items || []).filter(Boolean);
    const needed = new Set(cards.map((c) => c.sourceId).filter(Boolean));
    const srcs = (sources || []).filter((s) => needed.has(s.id));
    const cardIds = new Set(cards.map((c) => c.id));
    const revs = (reviews || []).filter((r) => cardIds.has(r.itemId));
    const dl = (dels || []).filter((d) => d && d.id);
    return {
      header: {
        format: FORMAT,
        enc: ENC_NONE,
        createdAt: now,
        counts: { cards: cards.length, sources: srcs.length, reviews: revs.length, dels: dl.length },
      },
      cards, sources: srcs, reviews: revs, dels: dl, rules: rules || null,
    };
  }

  function toJsonl(bundle) {
    const lines = [JSON.stringify(bundle.header)];
    for (const s of bundle.sources) lines.push(JSON.stringify({ t: 's', v: s }));
    for (const c of bundle.cards) lines.push(JSON.stringify({ t: 'c', v: c }));
    for (const r of bundle.reviews) lines.push(JSON.stringify({ t: 'r', v: r }));
    // Ledger entries grouped by timestamp: deletes happen in user-action batches,
    // so this is usually one row of many ids — and gzip'd JSONL makes even the
    // full 20k-entry ledger a few tens of KB.
    if (bundle.dels && bundle.dels.length) {
      const byAt = new Map();
      for (const d of bundle.dels) {
        const at = d.at || 0;
        if (!byAt.has(at)) byAt.set(at, []);
        byAt.get(at).push(d.id);
      }
      for (const [at, ids] of byAt) lines.push(JSON.stringify({ t: 'd', v: { ids, at } }));
    }
    if (bundle.rules) lines.push(JSON.stringify({ t: 'g', v: bundle.rules }));
    return lines.join('\n') + '\n';
  }

  // A truncated or hand-edited file must not take the whole import down: skip the
  // bad line, keep the rest, and report how many were skipped so the UI can say so
  // rather than silently importing less than the user expected.
  function fromJsonl(text) {
    const out = { header: null, cards: [], sources: [], reviews: [], dels: [], rules: null, skipped: 0 };
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (_) { out.skipped++; continue; }
      if (!out.header) {
        if (obj && obj.format) { out.header = obj; continue; }
        out.skipped++; continue;               // no header ⇒ not our file
      }
      if (!obj || !obj.t || !obj.v) { out.skipped++; continue; }
      if (obj.t === 'c') out.cards.push(obj.v);
      else if (obj.t === 's') out.sources.push(obj.v);
      else if (obj.t === 'r') out.reviews.push(obj.v);
      else if (obj.t === 'd') {
        for (const id of obj.v.ids || []) out.dels.push({ id, at: obj.v.at || 0 });
      } else if (obj.t === 'g') {
        // Several `g` rows in one chunk (a compaction snapshot) → newest wins,
        // same LWW as replay applies against local state (§8.9).
        if (!out.rules || (obj.v.updatedAt || 0) > (out.rules.updatedAt || 0)) out.rules = obj.v;
      }
      else out.skipped++;
    }
    return out;
  }

  // ─── Compression: the platform's own, never a library ────────────────────
  // §8.5 lever 3. `CompressionStream` is in every browser we ship to; adding a
  // dependency for it would break the zero-dependency rule for nothing.

  function hasCompression() {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
  }

  async function deflate(text) {
    const bytes = new TextEncoder().encode(text);
    if (!hasCompression()) return bytes;
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  async function inflate(bytes) {
    if (!hasCompression()) return new TextDecoder().decode(bytes);
    try {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter();
      w.write(bytes); w.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      return new TextDecoder().decode(buf);
    } catch (_) {
      // An uncompressed file is a legitimate input: a user may have unzipped it, or
      // it may have been written on a platform without CompressionStream.
      return new TextDecoder().decode(bytes);
    }
  }

  // ─── Replay ──────────────────────────────────────────────────────────────
  // MUST be idempotent: applying the same bundle twice yields the same local state.
  // That is what makes an interrupted import or a re-run sync safe (§8.4), and it
  // falls out of `mergeItem` treating text/tr/anchor as immutable.

  // `opts.fromServer` distinguishes a sync pull from a file import. Both replay a
  // copy (hence never accumulate), but only the sync path may watermark the result
  // as "the server already has this" — an imported file has to be uploadable.
  async function replay(bundle, opts) {
    const fromServer = !!(opts && opts.fromServer);
    const stats = { cards: 0, sources: 0, reviews: 0 };

    // §7.4 — user deletes apply FIRST, and on BOTH paths (sync pull AND file
    // import — a delete is the user's intent and travels with the corpus, unlike
    // eviction tombstones). `applyDels` holds the per-item resolution rule
    // (`touchedAt(item) <= at`) and the ledger upsert; replaying the same rows
    // twice is a no-op by construction.
    if (bundle.dels && bundle.dels.length) {
      stats.deleted = await LearnStore.applyDels(bundle.dels);
    }

    // §7.3 — the server is the ARCHIVE, this device keeps a WORKING SET. Material
    // this device evicted under storage pressure must not come straight back down,
    // or the user's cleanup visibly does nothing and the corpus thrashes at the cap.
    //
    // ONLY on the sync path. A file import is the user asking for this material, and
    // capture re-admits anything they read again — the tombstone is about what the
    // SERVER may push here, never about what the user may put here.
    if (fromServer && bundle.cards.length) {
      const tombs = await LearnStore.tombstones();
      if (tombs.size) {
        const kept = bundle.cards.filter((c) => !tombs.has(c.id));
        stats.declined = bundle.cards.length - kept.length;
        bundle = Object.assign({}, bundle, { cards: kept });
      }
    }

    // §7.4 — the delete ledger suppresses incoming COPIES on both paths (an old
    // export re-imported must not undo a delete; LWW would make that surprising).
    // Unlike tombs, the comparison is time-based: a card genuinely re-touched
    // AFTER the delete (re-read or reviewed on another device) wins and
    // re-admits — "a new observation re-admits; a copy of an old fact does not".
    if (bundle.cards.length) {
      const ledger = await LearnStore.userDels();
      if (ledger.size) {
        const kept = bundle.cards.filter((c) => {
          const delAt = ledger.get(c.id);
          return !(delAt !== undefined && delAt >= LearnModel.touchedAt(c));
        });
        if (kept.length !== bundle.cards.length) {
          stats.declined = (stats.declined || 0) + (bundle.cards.length - kept.length);
          bundle = Object.assign({}, bundle, { cards: kept });
        }
      }
    }

    if (bundle.cards.length || bundle.sources.length) {
      // `cards` is what was NEW here, not what the bundle contained — the surfaces
      // render it as "received", and a re-read of our own chunk receives nothing.
      // `accumulate: false` — a chunk holds encounters that were already counted
      // wherever they happened. Replay copies them; it does not witness them again.
      stats.cards = await LearnStore.mergeBatch(bundle.cards, bundle.sources,
        { accumulate: false, markSynced: fromServer });
      stats.merged = bundle.cards.length;
      stats.sources = bundle.sources.length;
    }
    // Reviews are an append-only log keyed by (itemId, at), so re-importing must not
    // duplicate them. Dedupe against what is already stored.
    if (bundle.reviews.length) {
      const seen = new Set((await LearnStore.allReviews()).map((r) => r.itemId + '|' + r.at));
      const fresh = bundle.reviews.filter((r) => !seen.has(r.itemId + '|' + r.at));
      // `mode` / `practice` travel WITH the row (§5.2 / §5.3): a replay that strips
      // them would turn practice reps into apparent scheduled reviews on the other
      // device's statistics — same history, different story.
      for (const r of fresh) {
        await LearnStore.recordReview(r.itemId, r.grade, r.at,
          { viaSync: fromServer, mode: r.mode, practice: r.practice });
      }
      stats.reviews = fresh.length;
    }
    // §8.9 — governance rules: LWW over the WHOLE set against local state, on
    // both paths (an old export's `g` row loses to newer local rules and is
    // harmless). Adoption is visible to every surface through the normal
    // storage.onChanged plumbing — including the collector's blocklist gate.
    if (bundle.rules) {
      const adopted = await applyRules(bundle.rules);
      if (adopted) stats.rules = 1;
    }
    await LearnStore.evictIfNeeded();
    return stats;
  }

  // ─── learnRules storage seam (§8.9) ──────────────────────────────────────
  // The rules live in `chrome.storage.local` (the collector must read them, and
  // content scripts have nothing else — learning-design §7). Guarded so the vm
  // suite, which has no chrome at all, exercises replay without a rules store.

  function readRules() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['learnRules'], (r) => resolve((r && r.learnRules) || null));
      } catch (_) { resolve(null); }
    });
  }

  function applyRules(incoming) {
    if (!incoming || typeof incoming !== 'object') return Promise.resolve(false);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return Promise.resolve(false);
    }
    return readRules().then((local) => {
      if (local && (local.updatedAt || 0) >= (incoming.updatedAt || 0)) return false;
      return new Promise((resolve) => {
        try { chrome.storage.local.set({ learnRules: incoming }, () => resolve(true)); }
        catch (_) { resolve(false); }
      });
    });
  }

  // ─── Public: export / import a file ──────────────────────────────────────

  async function exportBytes(now) {
    const [items, sources, reviews, dels, rules] = await Promise.all([
      LearnStore.allItems(), LearnStore.allSources(), LearnStore.allReviews(),
      // Intent travels with the corpus (§7.4/§8.9): the export carries the delete
      // ledger and the current rules, so restoring from a file cannot silently
      // resurrect what the user removed. Older stores without the APIs export
      // without them — the format tolerates absence.
      LearnStore.allDels ? LearnStore.allDels() : Promise.resolve([]),
      readRules(),
    ]);
    const bundle = build(items, sources, reviews, now || Date.now(), dels, rules);
    return { bytes: await deflate(toJsonl(bundle)), header: bundle.header };
  }

  async function importBytes(bytes) {
    const text = await inflate(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const bundle = fromJsonl(text);
    if (!bundle.header || bundle.header.format !== FORMAT) {
      const e = new Error('not a ' + FORMAT + ' file');
      e.code = 'bad_format';
      throw e;
    }
    // Ours, well-formed, and not readable by this build. Distinct from bad_format
    // on purpose: nothing is wrong with this file, and telling the user to check
    // their export would send them looking for a fault that does not exist.
    if (!canRead(bundle.header)) {
      const e = new Error('chunk uses enc=' + encOf(bundle.header) + ', unsupported by this version');
      e.code = 'enc_unsupported';
      e.enc = encOf(bundle.header);
      throw e;
    }
    const stats = await replay(bundle);
    stats.skipped = bundle.skipped;
    return stats;
  }

  function fileName(now) {
    const d = new Date(now || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `belliedmonkey-learn-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.mtlearn`;
  }

  return {
    FORMAT, ENC_NONE, encOf, canRead,
    build, toJsonl, fromJsonl,
    deflate, inflate, hasCompression, replay,
    readRules, applyRules,
    exportBytes, importBytes, fileName,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnChunk;
