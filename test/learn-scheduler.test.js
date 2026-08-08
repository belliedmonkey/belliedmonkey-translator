// test/learn-scheduler.test.js — the Ebbinghaus scheduler.
//
// `now` is injected everywhere, so every interval assertion here is exact rather
// than timing-dependent. The deck's most important property is what it WITHHOLDS
// (mature cards, new cards past the daily cap) — asserted directly, because a deck
// that ignores both still looks perfectly reasonable.

const { loadModule, describe, test, ok, eq } = require('./harness');

function load() {
  const ctx = loadModule('learn-scheduler.js', { window: {} });
  return ctx.LearnScheduler;
}
const DAY = 86400000;
const T0 = 1700000000000;

function card(over) {
  return Object.assign({ id: Math.random().toString(36).slice(2), sourceId: 's1', state: 'learning', salience: 0.5 }, over);
}

describe('LearnScheduler — the forgetting curve', () => {
  test('R(s) = 0.9 by definition — stability IS the 90%-recall interval', () => {
    const S = load();
    const sched = { s: 10, d: 5, lastReviewAt: T0, reps: 1, lapses: 0 };
    const R = S.retrievability(sched, T0 + 10 * DAY);
    eq(Math.round(R * 1000) / 1000, 0.9);
  });

  test('R decays monotonically and equals 1 at the moment of review', () => {
    const S = load();
    const sched = { s: 5, d: 5, lastReviewAt: T0 };
    eq(S.retrievability(sched, T0), 1);
    const a = S.retrievability(sched, T0 + DAY);
    const b = S.retrievability(sched, T0 + 3 * DAY);
    ok(a > b && b > 0, `expected monotone decay, got ${a} then ${b}`);
  });

  test('a never-reviewed card is treated as fully forgotten so it sorts first', () => {
    const S = load();
    eq(S.retrievability(null, T0), 0);
    eq(S.retrievability({ s: 0, lastReviewAt: T0 }, T0), 0);
  });

  test('at the default 0.90 target the next due date is exactly one stability away', () => {
    const S = load();
    const sched = { s: 4, d: 5, lastReviewAt: T0 };
    eq(S.nextDue(sched), T0 + 4 * DAY);
  });

  test('a stricter retention target pulls the review EARLIER, a looser one pushes it later', () => {
    const S = load();
    const sched = { s: 10, d: 5, lastReviewAt: T0 };
    ok(S.nextDue(sched, { targetR: 0.95 }) < S.nextDue(sched));
    ok(S.nextDue(sched, { targetR: 0.85 }) > S.nextDue(sched));
  });
});

describe('LearnScheduler — grading', () => {
  test('the first answer sets the initial stability from production S0', () => {
    const S = load();
    for (let g = 0; g <= 3; g++) {
      eq(S.applyReview(null, g, T0).s, S.DEFAULTS.S0[g], `grade ${g}`);
    }
  });

  test('"again" shrinks stability and counts a lapse; the others grow it', () => {
    const S = load();
    const prev = { s: 10, d: 5, lastReviewAt: T0 - 10 * DAY, reps: 3, lapses: 0 };
    const again = S.applyReview(prev, 0, T0);
    ok(again.s < prev.s, 'again must shrink stability');
    eq(again.lapses, 1);
    for (const g of [1, 2, 3]) {
      ok(S.applyReview(prev, g, T0).s > prev.s, `grade ${g} must grow stability`);
    }
  });

  test('a harder card grows more slowly than an easier one, same answer', () => {
    const S = load();
    const easy = { s: 10, d: 2, lastReviewAt: T0 - 10 * DAY, reps: 3, lapses: 0 };
    const hard = { s: 10, d: 9, lastReviewAt: T0 - 10 * DAY, reps: 3, lapses: 0 };
    ok(S.applyReview(easy, 2, T0).s > S.applyReview(hard, 2, T0).s);
  });

  test('answering correctly LATE earns more than answering on time', () => {
    const S = load();
    const base = { s: 10, d: 5, reps: 3, lapses: 0 };
    const onTime = S.applyReview(Object.assign({}, base, { lastReviewAt: T0 - 10 * DAY }), 2, T0);
    const late = S.applyReview(Object.assign({}, base, { lastReviewAt: T0 - 40 * DAY }), 2, T0);
    ok(late.s > onTime.s, `late ${late.s} should exceed on-time ${onTime.s}`);
  });

  test('stability is clamped at both ends and difficulty stays in [1,10]', () => {
    const S = load();
    const tiny = S.applyReview({ s: S.DEFAULTS.S_MIN, d: 10, lastReviewAt: T0 }, 0, T0);
    ok(tiny.s >= S.DEFAULTS.S_MIN, 'never below S_MIN');
    let sched = { s: 300, d: 1, lastReviewAt: T0 - 300 * DAY, reps: 9, lapses: 0 };
    for (let i = 0; i < 5; i++) sched = S.applyReview(sched, 3, T0 + i);
    ok(sched.s <= S.DEFAULTS.S_MAX, `never above S_MAX, got ${sched.s}`);
    ok(sched.d >= 1 && sched.d <= 10, `difficulty in range, got ${sched.d}`);
  });

  test('a well-known card reports state "known"', () => {
    const S = load();
    eq(S.stateFor({ sched: { s: S.DEFAULTS.KNOWN_S + 1, lastReviewAt: T0 } }), 'known');
    eq(S.stateFor({ sched: { s: 3, lastReviewAt: T0 } }), 'learning');
    eq(S.stateFor({ state: 'candidate' }), 'candidate');
    eq(S.stateFor({ state: 'muted', sched: { s: 3, lastReviewAt: T0 } }), 'muted');
  });
});

describe('LearnScheduler — the deck WITHHOLDS things', () => {
  test('a mature, well-retained card does NOT appear', () => {
    const S = load();
    const mature = card({ id: 'm', sched: { s: 300, d: 3, lastReviewAt: T0 - DAY } });
    const deck = S.buildDeck([mature], T0, null, 0);
    eq(deck.length, 0, 'a card at ~99% recall is not work worth doing');
  });

  test('a card not yet due does NOT appear — the schedule is not fabricated', () => {
    const S = load();
    const fresh = card({ id: 'f', sched: { s: 10, d: 5, lastReviewAt: T0 - DAY } });
    eq(S.buildDeck([fresh], T0, null, 0).length, 0);
    // …and it does appear once it actually comes due.
    eq(S.buildDeck([fresh], T0 + 11 * DAY, null, 0).length, 1);
  });

  test('the daily new-card cap is enforced, and is NOT bypassed by backfill', () => {
    const S = load();
    const items = [];
    for (let i = 0; i < 50; i++) items.push(card({ id: 'c' + i, state: 'candidate', sched: null, sourceId: 's' + i }));
    const deck = S.buildDeck(items, T0, { dailyNew: 3, deckSize: 20 }, 0);
    eq(deck.length, 3, 'a deck of nothing-but-new must stop at the daily cap');
  });

  test('cards already introduced today count against the cap', () => {
    const S = load();
    const items = [];
    for (let i = 0; i < 50; i++) items.push(card({ id: 'c' + i, state: 'candidate', sched: null, sourceId: 's' + i }));
    eq(S.buildDeck(items, T0, { dailyNew: 5, deckSize: 20 }, 5).length, 0);
    eq(S.buildDeck(items, T0, { dailyNew: 5, deckSize: 20 }, 4).length, 1);
  });

  test('a muted card never appears', () => {
    const S = load();
    const muted = card({ id: 'x', state: 'muted', sched: { s: 1, d: 5, lastReviewAt: T0 - 30 * DAY } });
    eq(S.buildDeck([muted], T0, null, 0).length, 0);
  });

  test('config is MERGED over production DEFAULTS — a partial override keeps the rest', () => {
    const S = load();
    const items = [];
    for (let i = 0; i < 40; i++) {
      items.push(card({ id: 'd' + i, sched: { s: 1, d: 5, lastReviewAt: T0 - 30 * DAY }, sourceId: 's' + i }));
    }
    // Only deckSize is supplied; dailyNew/targetR/MIX must still come from DEFAULTS.
    eq(S.buildDeck(items, T0, { deckSize: 7 }, 0).length, 7);
  });
});

describe('LearnScheduler — deck ordering', () => {
  test('the most-forgotten card comes first', () => {
    const S = load();
    const items = [
      card({ id: 'recent', sched: { s: 10, d: 5, lastReviewAt: T0 - 11 * DAY }, sourceId: 'a' }),
      card({ id: 'ancient', sched: { s: 2, d: 5, lastReviewAt: T0 - 90 * DAY }, sourceId: 'b' }),
    ];
    eq(S.buildDeck(items, T0, null, 0)[0].id, 'ancient');
  });

  test('a session is never one page read back to itself', () => {
    const S = load();
    const items = [];
    for (let i = 0; i < 8; i++) {
      items.push(card({ id: 'a' + i, sourceId: 'same', sched: { s: 1, d: 5, lastReviewAt: T0 - 30 * DAY } }));
    }
    for (let i = 0; i < 8; i++) {
      items.push(card({ id: 'b' + i, sourceId: 'other', sched: { s: 1, d: 5, lastReviewAt: T0 - 30 * DAY } }));
    }
    const deck = S.buildDeck(items, T0, null, 0);
    let run = 1, worst = 1;
    for (let i = 1; i < deck.length; i++) {
      run = deck[i].sourceId === deck[i - 1].sourceId ? run + 1 : 1;
      worst = Math.max(worst, run);
    }
    ok(worst <= S.DEFAULTS.MAX_PER_SOURCE_RUN, `longest same-source run was ${worst}`);
  });

  test('a single source cannot be interleaved — and cards are kept, not dropped', () => {
    const S = load();
    const cards = [];
    for (let i = 0; i < 7; i++) cards.push({ id: 'z' + i, sourceId: 'only' });
    const out = S.spreadBySource(cards, 3);
    eq(out.length, 7, 'interleaving is impossible here; dropping cards would be worse');
  });

  test('no card is dropped or duplicated by the interleave', () => {
    const S = load();
    const cards = [];
    for (let i = 0; i < 9; i++) cards.push({ id: 'x' + i, sourceId: i < 6 ? 'p' : 'q' });
    const out = S.spreadBySource(cards, 3);
    eq(out.length, cards.length);
    eq(new Set(out.map((c) => c.id)).size, cards.length);
  });
});

describe('LearnScheduler — dueCount', () => {
  test('counts only cards actually waiting', () => {
    const S = load();
    const items = [
      card({ id: '1', sched: { s: 1, d: 5, lastReviewAt: T0 - 30 * DAY } }),   // overdue
      card({ id: '2', sched: { s: 30, d: 5, lastReviewAt: T0 - DAY } }),       // not yet
      card({ id: '3', state: 'candidate', sched: null }),                      // not a review
      card({ id: '4', sched: { s: 400, d: 5, lastReviewAt: T0 - 30 * DAY } }), // known
    ];
    eq(S.dueCount(items, T0), 1);
  });
});

// ─── §5.1 — the grade buttons preview their own consequence ──────────────────
// The property that matters is NOT "the numbers look reasonable" — it is that the
// preview and the press are THE SAME computation. A preview that runs its own
// arithmetic drifts the first time applyReview is tuned, and then the buttons
// promise intervals the scheduler no longer grants.

describe('LearnScheduler — previewIntervals (§5.1)', () => {
  test('each preview equals exactly what pressing that grade would grant', () => {
    const S = load();
    for (const sched of [
      null,                                                    // fresh card
      { s: 3, d: 5, lastReviewAt: T0 - 2 * DAY },              // young
      { s: 120, d: 3, lastReviewAt: T0 - 100 * DAY },          // mature, overdue
    ]) {
      // Once with defaults, once with a custom config — the second pins the cfg
      // PASSTHROUGH: a preview that quietly ignores cfg matches applyReview under
      // defaults and lies the moment the user changes a setting.
      for (const cfg of [undefined, { S0: [1, 2, 3, 4], FACTOR: [0.5, 1.3, 2.0, 5.0] }]) {
        const iv = S.previewIntervals(sched, T0, cfg);
        for (let g = 0; g <= 3; g++) {
          const pressed = S.applyReview(sched, g, T0, cfg);
          eq(iv[g], Math.max(0, pressed.dueAt - T0),
            '档位 ' + g + ' 的预览与实际按下不一致 —— 按钮在撒谎');
        }
      }
    }
  });

  test('a better grade never promises a shorter interval', () => {
    const S = load();
    const iv = S.previewIntervals({ s: 5, d: 5, lastReviewAt: T0 - 4 * DAY }, T0);
    ok(iv[0] < iv[1] && iv[1] < iv[2] && iv[2] < iv[3],
      '间隔必须随档位单调上升: ' + iv.join(','));
  });

  test('config is merged over DEFAULTS, same contract as the rest of the module', () => {
    // verification-spec §3.1.1 blind spot 1: pass a deliberately PARTIAL config and
    // assert the defaults still participate.
    const S = load();
    const full = S.previewIntervals(null, T0);
    const partial = S.previewIntervals(null, T0, { deckSize: 5 });   // unrelated key
    eq(full.join(','), partial.join(','), '无关的局部配置改变了预览 —— 合并逻辑坏了');
  });
});
