// test/learn-merge.test.js — what `mergeItem` must guarantee for SYNC, as opposed
// to for a re-encounter on the same device.
//
// All three cases here were found on 2026-08-06 by running the real loop across two
// real devices against the real backend (docs/verification-spec.md, sync E2E row),
// and all three were invisible to every existing gate: the unit tests never merged
// the same chunk twice, and never merged an item that carried a schedule.
//
// The distinction the old code missed: merging a NEW OBSERVATION accumulates
// evidence (you read the paragraph twice, that is twice the dwell), while merging a
// COPY OF THE SAME FACT from another device must not. Sync replays copies — of other
// devices' chunks and, routinely, of its own — so an accumulating merge inflates
// every accumulator without bound. The compaction path states the requirement out
// loud ("Idempotent replay is what makes that a non-event rather than a corruption")
// and the merge did not meet it.

const { describe, test, eq, ok } = require('./harness');
const LearnModel = require('../extension/content/learn-model.js');

const base = (over) => Object.assign({
  id: 'a1', text: 'hello', tr: '你好', kind: 'sentence',
  createdAt: 1000, lastSeenAt: 2000, seenCount: 2, dwellMs: 5000,
  salience: 0.7, state: 'learning', starred: false, sched: null,
}, over || {});

describe('mergeItem — 同设备再遇（累加）', () => {
  test('dwell 与次数累加，这是同一段文字被读了两次', () => {
    const r = LearnModel.mergeItem(base(), base({ seenCount: 1, dwellMs: 3000, lastSeenAt: 4000 }));
    eq(r.dwellMs, 8000);
    eq(r.seenCount, 3);
    eq(r.lastSeenAt, 4000);
  });
});

describe('mergeItem — 同步重放（幂等）', () => {
  const SYNC = { accumulate: false };

  test('重放同一份内容不改变任何累加量', () => {
    const stored = base();
    const r = LearnModel.mergeItem(stored, base(), SYNC);
    eq(r.dwellMs, 5000, 'dwellMs 被重放放大了');
    eq(r.seenCount, 2, 'seenCount 被重放放大了');
  });

  test('重放十次仍与重放一次相同 —— 这才叫幂等', () => {
    let acc = base();
    for (let i = 0; i < 10; i++) acc = LearnModel.mergeItem(acc, base(), SYNC);
    eq(acc.dwellMs, 5000);
    eq(acc.seenCount, 2);
  });

  test('对方设备读得更久时取较大值，不是相加', () => {
    const r = LearnModel.mergeItem(base(), base({ dwellMs: 9000, seenCount: 5 }), SYNC);
    eq(r.dwellMs, 9000);
    eq(r.seenCount, 5);
  });
});

describe('mergeItem — 复习进度必须能跨设备传播', () => {
  test('对方的排程更新时覆盖本地的旧排程', () => {
    const mine = base({ sched: { s: 1.5, d: 5, lastReviewAt: 1000 } });
    const theirs = base({ sched: { s: 3.2, d: 9, lastReviewAt: 9000 }, state: 'review' });
    const r = LearnModel.mergeItem(mine, theirs, { accumulate: false });
    eq(r.sched.lastReviewAt, 9000, '对方更新的复习进度被丢弃了');
    eq(r.sched.s, 3.2);
  });

  test('本地排程更新时不被对方的旧排程回退', () => {
    const mine = base({ sched: { s: 3.2, d: 9, lastReviewAt: 9000 } });
    const theirs = base({ sched: { s: 1.5, d: 5, lastReviewAt: 1000 } });
    const r = LearnModel.mergeItem(mine, theirs, { accumulate: false });
    eq(r.sched.lastReviewAt, 9000, '同步把本地的复习进度回退了');
  });

  test('采集路径的 incoming 没有排程，绝不能把本地排程抹掉', () => {
    const mine = base({ sched: { s: 3.2, d: 9, lastReviewAt: 9000 } });
    const r = LearnModel.mergeItem(mine, base({ sched: null }));
    ok(r.sched, '再遇一次就把复习进度清空了');
    eq(r.sched.lastReviewAt, 9000);
  });
});

describe('mergeItem — 不变的部分', () => {
  test('文本、译文、锚点仍然不可变', () => {
    const r = LearnModel.mergeItem(base(), base({ text: 'other', tr: '别的' }), { accumulate: false });
    eq(r.text, 'hello');
    eq(r.tr, '你好');
  });
  test('星标是或运算，两条路径都一样', () => {
    eq(LearnModel.mergeItem(base(), base({ starred: true }), { accumulate: false }).starred, true);
    eq(LearnModel.mergeItem(base({ starred: true }), base(), {}).starred, true);
  });
});
