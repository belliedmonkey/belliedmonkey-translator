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

describe('LearnChunk — only graduated cards travel', () => {
  test('a candidate (never reviewed, never starred) is NOT exported', () => {
    const { C } = setup();
    eq(C.isGraduated(card('a', { state: 'candidate', sched: null })), false);
  });

  test('learning, known and starred cards ARE exported', () => {
    const { C } = setup();
    eq(C.isGraduated(card('a')), true);
    eq(C.isGraduated(card('b', { sched: { s: 400, d: 5, lastReviewAt: T0 } })), true);
    eq(C.isGraduated(card('c', { state: 'candidate', sched: null, starred: true })), true);
  });

  test('build() drops the candidate pool — that is lever 1, worth ~10×', () => {
    const { C } = setup();
    const items = [card('a'), card('b', { state: 'candidate', sched: null }), card('c')];
    const b = C.build(items, [{ id: 'src1', url: 'u', title: 't' }], [], T0);
    eq(b.cards.length, 2);
    eq(b.header.counts.cards, 2);
    ok(!b.cards.some((c) => c.id === 'b'), 'the candidate must not be in the bundle');
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

  test('reviews for cards that did not travel do not travel either', () => {
    const { C } = setup();
    const b = C.build(
      [card('a'), card('b', { state: 'candidate', sched: null })],
      [], [{ itemId: 'a', grade: 2, at: T0 }, { itemId: 'b', grade: 2, at: T0 }], T0);
    eq(b.reviews.length, 1);
    eq(b.reviews[0].itemId, 'a');
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
