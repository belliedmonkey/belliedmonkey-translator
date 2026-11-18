'use strict';
// Tests for docs/qa/checks/repro-aggregate.js — the repeated-sample contract
// that keeps a rerun from looking like a regression.

const { describe, test, ok, eq, deepEq } = require('./harness');
const {
  DIMS, judgeSample, aggregateItem, aggregateRun, wilson, requiredSamples,
} = require('../docs/qa/checks/repro-aggregate.js');

function verdict(failedDims) {
  const dimensions = {};
  for (const d of DIMS) dimensions[d] = { pass: !(failedDims || []).includes(d), note: '' };
  return { dimensions };
}
const pass = () => verdict([]);
const failOn = (dims) => verdict(dims);
const sample = (a, b) => ({ 'judge-a': a, 'judge-b': b });
const allPass = () => [sample(pass(), pass()), sample(pass(), pass()), sample(pass(), pass())];

describe('qa repro aggregate', () => {

test('repro: a sample needs both judges and all seven dimensions', () => {
  eq(judgeSample(sample(pass(), pass())).pass, true);
  eq(judgeSample(sample(pass(), failOn(['meaning']))).pass, false);
  eq(judgeSample(sample(pass(), failOn(['entities_numbers']))).failed['judge-b'].join(','), 'entities_numbers');
  // one judge only is not a sample
  eq(judgeSample({ 'judge-a': pass() }).complete, false);
  eq(judgeSample({ 'judge-a': pass() }).pass, null);
  // a dimension missing from a verdict is a parse failure, not a pass
  const broken = pass();
  delete broken.dimensions.fluency;
  eq(judgeSample(sample(broken, pass())).complete, false);
});

test('repro: majority needs strictly more than half', () => {
  const two = aggregateItem([sample(pass(), pass()), sample(pass(), pass()), sample(pass(), failOn(['meaning']))]);
  eq(two.passRate, 0.666667);
  eq(two.majority, true);
  eq(two.unstable, true);
  const one = aggregateItem([sample(pass(), pass()), sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning']))]);
  eq(one.majority, false);
  eq(one.passRate, 0.333333);
});

test('repro: unfinished calls are excluded, not counted as failures', () => {
  const a = aggregateItem([sample(pass(), pass()), null, sample(pass(), pass())]);
  eq(a.judged, 2);
  eq(a.passRate, 1);
  eq(a.samples, 3);
  const b = aggregateItem([sample(pass(), pass()), { 'judge-a': pass() }, null]);
  eq(b.judged, 1);
  eq(b.passRate, 1);
  const c = aggregateItem([null, null]);
  eq(c.judged, 0);
  eq(c.passRate, null);
  eq(c.majority, null);
});

test('repro: unstable is a flag, not a verdict', () => {
  eq(aggregateItem(allPass()).unstable, false);
  eq(aggregateItem(allPass()).unanimous, true);
  const split = aggregateItem([sample(pass(), pass()), sample(pass(), pass()), sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning']))]);
  eq(split.passCount, 2);
  eq(split.unstable, true);
  eq(split.unanimous, false);
});

test('repro: failed dimensions merge per judge across samples', () => {
  const it = aggregateItem([
    sample(pass(), failOn(['meaning', 'omission'])),
    sample(failOn(['hallucination']), failOn(['meaning'])),
  ]);
  deepEq(it.failedDims['judge-a'], ['hallucination']);
  deepEq(it.failedDims['judge-b'], ['meaning', 'omission']);
});

test('repro: minJudged gates a thin item', () => {
  const it = aggregateItem([sample(pass(), pass())], { minJudged: 3 });
  eq(it.enoughSamples, false);
  eq(aggregateItem(allPass(), { minJudged: 3 }).enoughSamples, true);
});

test('repro: Wilson interval brackets the observed rate', () => {
  const w = wilson(3, 6);
  ok(w.low < 0.5 && w.high > 0.5);
  ok(w.low >= 0 && w.high <= 1);
  const fixed = wilson(6, 6);
  eq(fixed.high, 1);
  ok(fixed.low > 0.5);
  eq(wilson(0, 0), null);
});

test('repro: run score is the mean of item rates, and SE shrinks with repeats', () => {
  const items = [
    aggregateItem(allPass()),
    aggregateItem([sample(pass(), pass()), sample(pass(), failOn(['meaning']))]),
    aggregateItem([sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning']))]),
  ];
  const r = aggregateRun(items);
  eq(r.items, 3);
  eq(r.score, round6((1 + 0.5 + 0) / 3));
  ok(r.se > 0);
  ok(r.ci95.low < r.score && r.ci95.high > r.score);

  // same three items, same p, more samples: narrower band
  const more = [
    aggregateItem(new Array(6).fill(sample(pass(), pass()))),
    aggregateItem([sample(pass(), pass()), sample(pass(), pass()), sample(pass(), pass()), sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning'])), sample(pass(), failOn(['meaning']))]),
    aggregateItem(new Array(6).fill(sample(pass(), failOn(['meaning'])))),
  ];
  const r2 = aggregateRun(more);
  eq(r2.score, r.score);
  ok(r2.se < r.se);
});

test('repro: unstable items are surfaced by id', () => {
  const items = [
    Object.assign(aggregateItem([sample(pass(), pass()), sample(pass(), failOn(['meaning']))]), { itemId: 'a' }),
    Object.assign(aggregateItem(allPass()), { itemId: 'b' }),
  ];
  deepEq(aggregateRun(items).unstableItems, ['a']);
  eq(aggregateRun([]).score, null);
});

test('repro: sample count needed for a 36-item score target', () => {
  // 1 of 6 items near the threshold, p=0.5: 1 point needs 12 repeats, 2 points 3.
  eq(requiredSamples(36, 1 / 6, 0.01), 12);
  eq(requiredSamples(36, 1 / 6, 0.02), 3);
  ok(requiredSamples(36, 1 / 6, 0.005) > 12);
  eq(requiredSamples(36, 0, 0.01), 1);
});

});

function round6(v) { return Math.round(v * 1e6) / 1e6; }
