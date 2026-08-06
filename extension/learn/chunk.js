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

  // Only graduated cards travel — lever 1 in §8.5. The candidate pool is a product
  // of what you read on THIS device and has no business following you around.
  function isGraduated(item) {
    if (!item) return false;
    if (item.starred) return true;
    const st = LearnScheduler.stateFor(item);
    return st === 'learning' || st === 'known';
  }

  // Source rows are shared by every card from the same page (lever 2): a URL + title
  // is ~160 B, nearly half a card, and an article yields ~30 cards.
  function build(items, sources, reviews, now) {
    const cards = items.filter(isGraduated);
    const needed = new Set(cards.map((c) => c.sourceId).filter(Boolean));
    const srcs = (sources || []).filter((s) => needed.has(s.id));
    const cardIds = new Set(cards.map((c) => c.id));
    const revs = (reviews || []).filter((r) => cardIds.has(r.itemId));
    return {
      header: {
        format: FORMAT,
        enc: ENC_NONE,
        createdAt: now,
        counts: { cards: cards.length, sources: srcs.length, reviews: revs.length },
      },
      cards, sources: srcs, reviews: revs,
    };
  }

  function toJsonl(bundle) {
    const lines = [JSON.stringify(bundle.header)];
    for (const s of bundle.sources) lines.push(JSON.stringify({ t: 's', v: s }));
    for (const c of bundle.cards) lines.push(JSON.stringify({ t: 'c', v: c }));
    for (const r of bundle.reviews) lines.push(JSON.stringify({ t: 'r', v: r }));
    return lines.join('\n') + '\n';
  }

  // A truncated or hand-edited file must not take the whole import down: skip the
  // bad line, keep the rest, and report how many were skipped so the UI can say so
  // rather than silently importing less than the user expected.
  function fromJsonl(text) {
    const out = { header: null, cards: [], sources: [], reviews: [], skipped: 0 };
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

  async function replay(bundle) {
    const stats = { cards: 0, sources: 0, reviews: 0 };
    if (bundle.cards.length || bundle.sources.length) {
      // `cards` is what was NEW here, not what the bundle contained — the surfaces
      // render it as "received", and a re-read of our own chunk receives nothing.
      stats.cards = await LearnStore.mergeBatch(bundle.cards, bundle.sources);
      stats.merged = bundle.cards.length;
      stats.sources = bundle.sources.length;
    }
    // Reviews are an append-only log keyed by (itemId, at), so re-importing must not
    // duplicate them. Dedupe against what is already stored.
    if (bundle.reviews.length) {
      const seen = new Set((await LearnStore.allReviews()).map((r) => r.itemId + '|' + r.at));
      const fresh = bundle.reviews.filter((r) => !seen.has(r.itemId + '|' + r.at));
      for (const r of fresh) await LearnStore.recordReview(r.itemId, r.grade, r.at);
      stats.reviews = fresh.length;
    }
    await LearnStore.evictIfNeeded();
    return stats;
  }

  // ─── Public: export / import a file ──────────────────────────────────────

  async function exportBytes(now) {
    const [items, sources, reviews] = await Promise.all([
      LearnStore.allItems(), LearnStore.allSources(), LearnStore.allReviews(),
    ]);
    const bundle = build(items, sources, reviews, now || Date.now());
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
    isGraduated, build, toJsonl, fromJsonl,
    deflate, inflate, hasCompression, replay,
    exportBytes, importBytes, fileName,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnChunk;
