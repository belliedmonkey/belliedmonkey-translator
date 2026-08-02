// test/learn-model.test.js — the salience gate and the content-addressed id.
//
// Most of this module's value is NEGATIVE: what it refuses to capture. A gate that
// accepts everything produces byte-identical *code paths* to one that works — only
// a direct assertion sees the difference (verification-spec §3.1.1 blind spot 2).

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

function load() {
  const ctx = loadModule('learn-model.js', { window: {} });
  return ctx.LearnModel;
}

const LATIN = 'The quick brown fox jumps over the lazy dog and keeps running.'; // 61 chars
const CJK = '这是一段足够长的中文句子，用来测试密集文字的长度区间。';

describe('LearnModel — id & normalization', () => {
  test('id is content-addressed: same text+lang → same id, across whitespace noise', () => {
    const M = load();
    eq(M.itemId('en', 'Hello   world'), M.itemId('en', ' Hello world '));
    eq(M.itemId('en', 'Hello\nworld'), M.itemId('en', 'Hello world'));
  });

  test('id separates by language — the same string in two languages is two items', () => {
    const M = load();
    ok(M.itemId('en', 'chat') !== M.itemId('fr', 'chat'));
  });

  test('id is 16 hex chars and stable across loads (it is a storage key)', () => {
    const a = load().itemId('en', LATIN);
    const b = load().itemId('en', LATIN);
    eq(a, b);
    ok(/^[0-9a-f]{16}$/.test(a), `expected 16 hex chars, got ${a}`);
  });

  test('the id never depends on crypto.subtle (absent on http pages in a content script)', () => {
    // Loading with NO crypto in the sandbox at all must still work.
    const ctx = loadModule('learn-model.js', { window: {} });
    eq(typeof ctx.crypto, 'undefined');
    ok(/^[0-9a-f]{16}$/.test(ctx.LearnModel.itemId('en', 'x')));
  });
});

describe('LearnModel — length band is script-aware', () => {
  test('a dense-script sentence scores 1 at a length that would be too short in Latin', () => {
    const M = load();
    const short = '这是一个中文短句子。'; // 10 chars — inside the dense band, below the Latin floor
    eq(M.isDense(short), true);
    eq(M.lengthScore(short), 1);
    eq(M.lengthScore('Ten chars.') < 1, true, 'the same length in Latin must NOT score 1');
  });

  test('both bands score 1 for a normal sentence of their own script', () => {
    const M = load();
    eq(M.lengthScore(LATIN), 1);
    eq(M.lengthScore(CJK), 1);
  });

  test('very long text tapers but never hits zero', () => {
    const M = load();
    const huge = LATIN.repeat(20);
    const s = M.lengthScore(huge);
    ok(s > 0 && s < 0.2, `expected a small positive taper, got ${s}`);
  });
});

describe('LearnModel — the gate (what it REFUSES)', () => {
  const draft = (over) => Object.assign({ text: LATIN, tr: '译文足够长的一句话。', dwellMs: 6000, seenCount: 1 }, over);

  test('a segment scrolled straight past is NOT captured', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 200 })), false);
    eq(M.shouldCapture(draft({ dwellMs: 2499 })), false, 'just under the dwell floor is still out');
  });

  test('a dwelled segment IS captured', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 2500 })), true);
  });

  test('an empty translation is never captured, however long it was on screen', () => {
    const M = load();
    eq(M.shouldCapture(draft({ tr: '' })), false);
    eq(M.shouldCapture(draft({ tr: '   ' })), false);
  });

  test('a too-short segment is rejected even at the dwell floor', () => {
    const M = load();
    eq(M.shouldCapture(draft({ text: 'Hi there.', dwellMs: 2500 })), false);
  });

  test('starring bypasses the gate entirely — including zero dwell', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 0, starred: true })), true);
    eq(M.salience(draft({ dwellMs: 0, starred: true })), 1);
  });

  test('a subtitle the playhead crossed is captured with zero dwell', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 0 })), false);
    eq(M.shouldCapture(draft({ dwellMs: 0, playedThrough: true })), true);
  });

  test('config is MERGED over production DEFAULTS — a partial override cannot blank a field', () => {
    const M = load();
    // Only the threshold is supplied. Every other field (weights, bands, dwell
    // floor) must still come from DEFAULTS rather than reading undefined.
    eq(M.shouldCapture(draft({ dwellMs: 2500 }), { SALIENCE_MIN: 0.99 }), false);
    eq(M.shouldCapture(draft({ dwellMs: 6000 }), { SALIENCE_MIN: 0.01 }), true);
  });

  test('the production DEFAULTS are the ones asserted above, not a test-local copy', () => {
    const M = load();
    eq(M.DEFAULTS.DWELL_MIN_MS, 2500);
    eq(M.DEFAULTS.SALIENCE_MIN, 0.45);
    const w = M.DEFAULTS.W;
    eq(Math.round((w.dwell + w.length + w.repeat) * 100) / 100, 1, 'weights must sum to 1');
  });
});

describe('LearnModel — item shape & merge', () => {
  test('makeItem uses the INJECTED clock, never an ambient one', () => {
    const M = load();
    const it = M.makeItem({ text: LATIN, tr: '译文', lang: 'en' }, 12345);
    eq(it.createdAt, 12345);
    eq(it.lastSeenAt, 12345);
  });

  test('a re-encounter accumulates evidence but never rewrites the content', () => {
    const M = load();
    const a = M.makeItem({ text: LATIN, tr: '第一版译文', lang: 'en', dwellMs: 3000 }, 1000);
    const b = M.makeItem({ text: LATIN, tr: '第二版译文', lang: 'en', dwellMs: 4000 }, 2000);
    const m = M.mergeItem(a, b);
    eq(m.id, a.id);
    eq(m.tr, '第一版译文', 'tr is immutable after creation — sync conflict-freedom depends on it');
    eq(m.dwellMs, 7000);
    eq(m.seenCount, 2);
    eq(m.lastSeenAt, 2000);
  });

  test('starring on a later encounter promotes a candidate to learning', () => {
    const M = load();
    const a = M.makeItem({ text: LATIN, tr: '译文', lang: 'en' }, 1);
    eq(a.state, 'candidate');
    const m = M.mergeItem(a, Object.assign({}, a, { starred: true }));
    eq(m.starred, true);
    eq(m.state, 'learning');
  });
});

describe('LearnModel — outbox contract', () => {
  test('outbox keys are prefixed and bounded (the settings readers filter on this)', () => {
    const M = load();
    eq(M.OUTBOX_PREFIX, 'lq:');
    ok(M.OUTBOX_INDEX.startsWith(M.OUTBOX_PREFIX));
    ok(M.MAX_OUTBOX_SESSIONS > 0 && M.MAX_OUTBOX_SESSIONS <= 100);
  });
});
