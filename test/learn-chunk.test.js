// test/learn-chunk.test.js — the corpus wire format.
//
// The load-bearing properties here are all ones a "it produced a file" check would
// miss: that only graduated cards travel, that replay is IDEMPOTENT, that a damaged
// file loses only the damaged lines, and that a foreign file is refused outright.

const { loadModule, describe, test, ok, eq, rejects } = require('./harness');

function scheduler() {
  return loadModule('learn-scheduler.js', { window: {} }).LearnScheduler;
}

// A fake corpus: enough of LearnStore for chunk.js, recording every call so the
// negative assertions have something to look at.
function setup(seed = {}) {
  const calls = { merge: [], review: [], evict: 0 };
  const items = (seed.items || []).slice();
  const sources = (seed.sources || []).slice();
  const reviews = (seed.reviews || []).slice();
  const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
  const LearnScheduler = scheduler();

  const LearnStore = {
    allItems: () => Promise.resolve(items.slice()),
    allSources: () => Promise.resolve(sources.slice()),
    allReviews: () => Promise.resolve(reviews.slice()),
    mergeBatch: (incoming, srcs) => {
      calls.merge.push({ items: incoming.length, sources: (srcs || []).length });
      let added = 0;
      for (const inc of incoming) {
        const i = items.findIndex((x) => x.id === inc.id);
        if (i >= 0) items[i] = LearnModel.mergeItem(items[i], inc);
        else { items.push(inc); added++; }
      }
      for (const s of srcs || []) if (!sources.some((x) => x.id === s.id)) sources.push(s);
      return Promise.resolve(added);          // NEW here, not offered
    },
    recordReview: (itemId, grade, at) => {
      calls.review.push({ itemId, grade, at });
      reviews.push({ itemId, grade, at });
      return Promise.resolve();
    },
    evictIfNeeded: () => { calls.evict++; return Promise.resolve(0); },
    tombstones: () => Promise.resolve(new Set(seed.tombs || [])),
    hasEverEvicted: () => Promise.resolve(!!seed.everEvicted),
  };

  const ctx = loadModule('learn/chunk.js', {
    window: {}, LearnStore, LearnModel, LearnScheduler,
    TextEncoder, TextDecoder, Response, Date,
    // CompressionStream deliberately absent by default — chunk.js must work without
    // it (and this also keeps the tests synchronous-ish and deterministic).
  });
  return { C: ctx.LearnChunk, items, sources, reviews, calls };
}

const T0 = 1700000000000;
function card(id, over) {
  return Object.assign({
    id, text: 'Sentence ' + id, tr: '译文 ' + id, lang: 'en', sourceId: 'src1',
    state: 'learning', starred: false, createdAt: T0, lastSeenAt: T0, seenCount: 1,
    sched: { s: 3, d: 5, lastReviewAt: T0, dueAt: T0, reps: 1, lapses: 0 },
  }, over);
}

// §8.5 lever 1 was REVERSED on 2026-08-07: the candidate pool travels. These tests
// are the reversal, kept pointed at the deadlock rather than at the mechanism — a
// card only enters the deck by being REVIEWED, so if candidates stayed home, someone
// who wants to study in the host app would upload nothing, receive nothing, and never
// get a first card, while the extension cheerfully reported 「同步成功 · 上传 0 张」.
describe('LearnChunk — the candidate pool travels (§8.5 lever 1, reversed)', () => {
  test('a candidate (never reviewed, never starred) IS exported', () => {
    const { C } = setup();
    const b = C.build([card('a', { state: 'candidate', sched: null })], [], [], T0);
    eq(b.cards.length, 1, '候选卡不上行 = App 永远拿不到第一张卡');
    eq(b.header.counts.cards, 1);
  });

  test('a corpus of NOTHING BUT candidates still produces a non-empty bundle', () => {
    // The exact shape of the deadlock. Under lever 1 this bundle was empty and the
    // push reported success, so nothing anywhere could tell the two apart.
    const { C } = setup();
    const items = ['a', 'b', 'c'].map((id) => card(id, { state: 'candidate', sched: null }));
    const b = C.build(items, [{ id: 'src1', url: 'u', title: 't' }], [], T0);
    eq(b.cards.length, 3);
    eq(b.sources.length, 1, 'and their source rides along, or the cards lose provenance');
  });

  test('cards that entered the deck still travel too', () => {
    const { C } = setup();
    const items = [card('a'), card('b', { sched: { s: 400, d: 5, lastReviewAt: T0 } }),
      card('c', { state: 'candidate', sched: null, starred: true })];
    eq(C.build(items, [], [], T0).cards.length, 3);
  });

  test('only sources actually referenced are carried (lever 2)', () => {
    const { C } = setup();
    const b = C.build(
      [card('a', { sourceId: 'src1' })],
      [{ id: 'src1', url: 'u1' }, { id: 'src2', url: 'u2' }],
      [], T0);
    eq(b.sources.length, 1);
    eq(b.sources[0].id, 'src1');
  });

  test('a review whose card is not in the bundle is left out of it', () => {
    // Keeps a chunk self-consistent. Note this is a property of `build` alone —
    // `LearnSync.push` batches the corpus, so a review is only ever "left out" of the
    // batch it does not belong to, and one whose card is in NO batch (an evicted card
    // still has its reviews) is carried explicitly in the final chunk. See
    // learn-sync.test.js; dropping it there would be permanent data loss.
    const { C } = setup();
    const b = C.build(
      [card('a')],
      [], [{ itemId: 'a', grade: 2, at: T0 }, { itemId: 'gone', grade: 2, at: T0 }], T0);
    eq(b.reviews.length, 1);
    eq(b.reviews[0].itemId, 'a');
  });
});

// §7.3 — the server is the ARCHIVE, this device keeps a WORKING SET. The whole point
// is that the boundary runs between "the server may push this here" and "the user may
// put this here", NOT between "keep" and "delete". Every test below is aimed at that
// line, because getting it wrong in either direction is silent: filter too much and
// the user's own import quietly loses cards; filter too little and their cleanup
// visibly does nothing.
describe('LearnChunk — eviction tombstones filter the PULL only (§7.3)', () => {
  const bundle = (cards) => ({ header: {}, cards, sources: [], reviews: [] });

  test('a pulled chunk does not hand back what this device evicted', async () => {
    const { C, items } = setup({ tombs: ['gone'] });
    const s = await C.replay(bundle([card('kept'), card('gone')]), { fromServer: true });
    eq(s.cards, 1, '被淘汰的卡又回来了 = 用户清理完立刻又满');
    eq(s.declined, 1, '拒收了多少要报出来，不能静默');
    eq(items.map((i) => i.id).join(','), 'kept');
  });

  test('a FILE IMPORT ignores tombstones entirely', async () => {
    // Importing is the user asking for this material by name. Filtering it would be
    // the tombstone overriding an explicit instruction — the exact inversion §7.3
    // exists to prevent.
    const { C, items } = setup({ tombs: ['gone'] });
    const s = await C.replay(bundle([card('kept'), card('gone')]));
    eq(s.cards, 2, '导入是用户点名要这些内容，墓碑不该拦');
    eq(items.length, 2);
  });

  test('a review for a tombstoned card is still recorded', async () => {
    // 13 bytes, and it is the user's actual history. Dropping it would lose review
    // data because of a storage decision on one device.
    const { C, calls } = setup({ tombs: ['gone'] });
    const b = bundle([card('gone')]);
    b.reviews = [{ itemId: 'gone', grade: 3, at: T0 }];
    const s = await C.replay(b, { fromServer: true });
    eq(s.cards, 0);
    eq(s.reviews, 1, '排程历史不该因为另一台设备存满而消失');
    eq(calls.review.length, 1);
  });

  test('with no tombstones nothing is declined and nothing is copied', async () => {
    // Guards the guard: if `tombstones()` ever returned a non-empty set by accident,
    // every test above would still pass while sync quietly dropped real cards.
    const { C, items } = setup();
    const s = await C.replay(bundle([card('a'), card('b')]), { fromServer: true });
    eq(s.cards, 2);
    eq(s.declined, undefined, '没有拒收就不该报拒收');
    eq(items.length, 2);
  });
});

describe('LearnChunk — the encryption envelope (declared before there is any)', () => {
  test('every bundle declares enc, so a reader never has to guess', () => {
    const { C } = setup();
    eq(C.build([card('a')], [], [], T0).header.enc, C.ENC_NONE);
  });

  test('a file written BEFORE the field existed is still readable', async () => {
    // Not hypothetical: files were exported by real users before `enc` was added.
    const { C, items } = setup();
    const b = C.build([card('a')], [], [], T0);
    delete b.header.enc;
    await C.importBytes(new TextEncoder().encode(C.toJsonl(b)));
    eq(items.length, 1, 'a missing envelope means plaintext, not "unknown"');
  });

  test('an UNREADABLE-BECAUSE-NEWER chunk is refused with its OWN code', async () => {
    // The whole point of the field. Without it the ciphertext lines would come back
    // as `skipped`, and "update the extension" would be reported as "your data is
    // damaged" — a different problem, sending the user somewhere useless.
    const { C, items } = setup();
    const b = C.build([card('a')], [], [], T0);
    b.header.enc = 'age-x25519';
    await rejects(
      C.importBytes(new TextEncoder().encode(C.toJsonl(b))),
      (e) => e.code === 'enc_unsupported' && e.enc === 'age-x25519');
    eq(items.length, 0, 'nothing may be written from a chunk we cannot read');
  });

  test('unreadable-because-newer is NOT the same as bad_format', async () => {
    const { C } = setup();
    const mine = C.build([card('a')], [], [], T0);
    mine.header.enc = 'whatever';
    await rejects(C.importBytes(new TextEncoder().encode(C.toJsonl(mine))),
      (e) => e.code === 'enc_unsupported');
    await rejects(C.importBytes(new TextEncoder().encode('{"format":"someone-else/9"}\n')),
      (e) => e.code === 'bad_format');
  });
});

describe('LearnChunk — JSONL round trip', () => {
  test('encode → decode preserves every record', () => {
    const { C } = setup();
    const b = C.build([card('a'), card('b')], [{ id: 'src1', url: 'u', title: 't' }],
      [{ itemId: 'a', grade: 2, at: T0 }], T0);
    const back = C.fromJsonl(C.toJsonl(b));
    eq(back.header.format, C.FORMAT);
    eq(back.cards.length, 2);
    eq(back.sources.length, 1);
    eq(back.reviews.length, 1);
    eq(back.skipped, 0);
    eq(back.cards[0].text, 'Sentence a');
  });

  test('a TRUNCATED file yields every complete line before the break', () => {
    const { C } = setup();
    const jsonl = C.toJsonl(C.build([card('a'), card('b'), card('c')], [], [], T0));
    // Chop mid-way through the last line, as an interrupted transfer would.
    const cut = jsonl.slice(0, jsonl.length - 25);
    const back = C.fromJsonl(cut);
    ok(back.cards.length >= 2, `expected the intact lines to survive, got ${back.cards.length}`);
  });

  test('garbage lines are skipped and COUNTED, not silently dropped', () => {
    const { C } = setup();
    const jsonl = C.toJsonl(C.build([card('a')], [], [], T0));
    const damaged = jsonl.trimEnd() + '\n{not json}\n{"t":"?","v":1}\n';
    const back = C.fromJsonl(damaged);
    eq(back.cards.length, 1);
    eq(back.skipped, 2, 'the user must be able to be told how much was unreadable');
  });

  test('a file with no header is not mistaken for ours', () => {
    const { C } = setup();
    const back = C.fromJsonl('{"hello":"world"}\n{"t":"c","v":{"id":"x"}}\n');
    eq(back.header, null);
    eq(back.cards.length, 0);
  });
});

describe('LearnChunk — import', () => {
  const bytesOf = (C, bundle) => new TextEncoder().encode(C.toJsonl(bundle));

  test('a foreign file is REFUSED with a code, not half-imported', async () => {
    const { C, items } = setup();
    await rejects(C.importBytes(new TextEncoder().encode('{"format":"someone-else/9"}\n')));
    eq(items.length, 0, 'nothing may be written when the format is not ours');
  });

  test('importing merges into the corpus rather than replacing it', async () => {
    const { C, items } = setup({ items: [card('existing')] });
    const bundle = C.build([card('incoming')], [{ id: 'src1', url: 'u' }], [], T0);
    const stats = await C.importBytes(bytesOf(C, bundle));
    eq(stats.cards, 1);
    eq(items.length, 2, 'the local corpus is added to, never overwritten');
  });

  test('IMPORTING THE SAME FILE TWICE CHANGES NOTHING — replay is idempotent', async () => {
    const { C, items, reviews } = setup();
    const bundle = C.build([card('a'), card('b')],
      [{ id: 'src1', url: 'u' }], [{ itemId: 'a', grade: 2, at: T0 }], T0);
    const bytes = bytesOf(C, bundle);

    const first = await C.importBytes(bytes);
    eq(first.cards, 2);
    eq(items.length, 2);
    eq(reviews.length, 1);

    const second = await C.importBytes(bytes);
    eq(items.length, 2, 'a re-import must not duplicate cards');
    eq(second.reviews, 0, 'a re-import must not re-append reviews');
    eq(reviews.length, 1, 'the review log is append-only — duplicates would corrupt the schedule');
  });

  test('a re-import reports 0 received — the number means NEW, not replayed', async () => {
    // Found by driving the real UI: a device that pulls back its own upload showed
    // "received 8", which a user reads as "8 arrived from another device" when none
    // did. Idempotent replay was already correct; the COUNT was the lie.
    const { C } = setup();
    const bundle = C.build([card('a'), card('b')], [{ id: 'src1', url: 'u' }], [], T0);
    const bytes = new TextEncoder().encode(C.toJsonl(bundle));
    eq((await C.importBytes(bytes)).cards, 2);
    eq((await C.importBytes(bytes)).cards, 0, 'nothing was new the second time');
  });

  test('re-import does not rewrite text — immutability is what makes sync conflict-free', async () => {
    const { C, items } = setup();
    const bundle = C.build([card('a', { tr: '第一版译文' })], [], [], T0);
    await C.importBytes(bytesOf(C, bundle));
    const tampered = C.build([card('a', { tr: '第二版译文' })], [], [], T0);
    await C.importBytes(bytesOf(C, tampered));
    eq(items[0].tr, '第一版译文');
  });

  test('eviction runs after an import, so a big file cannot blow past the cap', async () => {
    const { C, calls } = setup();
    await C.importBytes(bytesOf(C, C.build([card('a')], [], [], T0)));
    eq(calls.evict, 1);
  });
});

describe('LearnChunk — compression is optional, never a dependency', () => {
  // ─── The EXPORT half, through the function the button actually calls ──────
  //
  // Every test above builds its bytes by hand (`build` + `toJsonl`), so
  // `exportBytes` — the entry point `options.js` calls — had zero coverage while
  // `importBytes` had fourteen tests. That is §3.1.1 blind spot 1 exactly: asserting
  // on a payload the test assembled rather than the one production assembles. The
  // composition it performs (three store reads → build → deflate) is small, and small
  // is precisely where an untested seam survives unnoticed.

  test('exportBytes reads the store and produces an importable file', async () => {
    const src = setup({
      items: [card('a'), card('b')],
      sources: [{ id: 'src1', url: 'u', title: 't' }],
      reviews: [{ itemId: 'a', grade: 3, at: T0 }],
    });
    const { bytes, header } = await src.C.exportBytes(T0);
    eq(header.counts.cards, 2);
    eq(header.counts.sources, 1);
    eq(header.counts.reviews, 1);

    // Into a DIFFERENT store — a round trip that ends where it started proves
    // nothing about a file leaving one device and landing on another.
    const dst = setup();
    const stats = await dst.C.importBytes(bytes);
    eq(stats.cards, 2);
    eq(dst.items.map((i) => i.id).sort().join(','), 'a,b');
    eq(dst.sources.length, 1);
    eq(dst.reviews.length, 1);
  });

  test('a corpus of ONLY candidates exports non-empty (§8.2)', async () => {
    // The one that was actually broken. While `build` filtered to cards that had
    // entered the deck, a user with hundreds of candidates and none reviewed got
    // 「还没有可导出的卡片」 from a full corpus — options.js branches on
    // `header.counts.cards`, so a zero there is not a small inaccuracy, it is the
    // export refusing to run. 「一键导出全部」 has to mean all of it.
    const src = setup({
      items: ['a', 'b', 'c'].map((id) => card(id, { state: 'candidate', sched: null })),
      sources: [{ id: 'src1', url: 'u', title: 't' }],
    });
    const { header } = await src.C.exportBytes(T0);
    eq(header.counts.cards, 3, '候选池不进导出 = 用户点导出会被告知「没有内容」');
  });

  test('with no CompressionStream, export/import still round-trips', async () => {
    const { C, items } = setup();
    eq(C.hasCompression(), false);
    const bundle = C.build([card('a')], [], [], T0);
    const bytes = await C.deflate(C.toJsonl(bundle));
    const text = await C.inflate(bytes);
    eq(C.fromJsonl(text).cards.length, 1);
    await C.importBytes(bytes);
    eq(items.length, 1);
  });

  test('the file name is stable and carries the date, not a random id', () => {
    const { C } = setup();
    const n = C.fileName(Date.UTC(2026, 7, 4, 12));
    ok(/^belliedmonkey-learn-2026080\d\.mtlearn$/.test(n), n);
  });
});
