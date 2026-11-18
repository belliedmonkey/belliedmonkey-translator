'use strict';
// Aggregation for repeated-sample translation runs.
//
// Why this exists: on 2026-11-18 the translation endpoint was measured with 6
// repeats per item at temperature 0 and with an explicit `seed`. It returned 2
// to 5 distinct outputs per item in every condition; `seed` is accepted (HTTP
// 200) but not honoured, and the response carries no `system_fingerprint`. The
// judges, by contrast, were stable at item level across 4 repeats on the same
// text (12 of 12 item/judge cells). So run-to-run noise lives in the
// translation, not in the verdict.
//
// The consequence: a single sample is one draw. Near a judge threshold the
// same item passes in one run and fails in the next. This module turns N
// samples into one reported number plus an explicit stability flag, instead of
// pretending the draw is the truth.
//
// Contract:
//   - a sample counts only when both judges returned a complete verdict
//   - a sample passes only when every dimension passed for both judges
//   - an item's score is its sample pass rate, not a binary vote
//   - an item with 0 < passCount < judged is `unstable` and must be reported
//   - a run's score is the unweighted mean of item pass rates
//
// No dependencies, no network. Pure functions so the test suite pins them.

const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];

function round6(v) { return Math.round(v * 1e6) / 1e6; }

// One sample: { 'judge-a': {dimensions}, 'judge-b': {dimensions} }.
// Returns { complete, pass, failed } where failed maps judge -> failed dims.
function judgeSample(judges, dims) {
  const list = dims || DIMS;
  const failed = {};
  let complete = true;
  for (const [judgeId, verdict] of Object.entries(judges || {})) {
    const d = verdict && verdict.dimensions;
    if (!d) { complete = false; continue; }
    const missing = list.filter((dim) => !d[dim] || typeof d[dim].pass !== 'boolean');
    if (missing.length) { complete = false; continue; }
    const bad = list.filter((dim) => !d[dim].pass);
    if (bad.length) failed[judgeId] = bad;
  }
  // Both judges are required; one verdict alone cannot decide a sample.
  const haveBoth = !!(judges && judges['judge-a'] && judges['judge-b']);
  if (!haveBoth) complete = false;
  return { complete, pass: complete ? Object.keys(failed).length === 0 : null, failed };
}

// Accept either a raw judges map or an already-judged sample.
function normalizeSample(s) {
  if (s && typeof s.complete === 'boolean' && 'pass' in s) return s;
  return judgeSample(s);
}

// samples: array of raw judges maps or judgeSample() results (null for a failed call).
function aggregateItem(samples, opts) {
  const minJudged = (opts && opts.minJudged) || 1;
  const judged = (samples || []).map(normalizeSample).filter((s) => s && s.complete);
  const passCount = judged.filter((s) => s.pass).length;
  const n = judged.length;
  const passRate = n ? round6(passCount / n) : null;
  return {
    samples: (samples || []).length,
    judged: n,
    passCount,
    failCount: n - passCount,
    passRate,
    enoughSamples: n >= minJudged,
    // Unstable means the draw decides the verdict: some samples pass, some fail.
    unstable: n > 0 && passCount > 0 && passCount < n,
    unanimous: n > 0 && (passCount === n || passCount === 0),
    majority: n ? passCount / n > 0.5 : null,
    ci95: n ? wilson(passCount, n) : null,
    failedDims: mergeFailedDims(judged),
  };
}

function mergeFailedDims(judged) {
  const out = {};
  for (const s of judged) {
    for (const [judgeId, dims] of Object.entries(s.failed || {})) {
      if (!out[judgeId]) out[judgeId] = new Set();
      for (const d of dims) out[judgeId].add(d);
    }
  }
  const res = {};
  for (const [judgeId, set] of Object.entries(out)) res[judgeId] = [...set].sort();
  return res;
}

// Wilson score interval, 95%.
function wilson(k, n, z) {
  if (!n) return null;
  const zz = z === undefined ? 1.959963984540054 : z;
  const p = k / n;
  const denom = 1 + (zz * zz) / n;
  const centre = p + (zz * zz) / (2 * n);
  const margin = zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n));
  return {
    low: round6(Math.max(0, (centre - margin) / denom)),
    high: round6(Math.min(1, (centre + margin) / denom)),
  };
}

// items: array of aggregateItem() results.
// score: unweighted mean of item pass rates over items with at least one judged
// sample. se: standard error of that mean under the per-item binomial model —
// it is the expected run-to-run spread, which is exactly what a comparison
// against another system has to beat.
function aggregateRun(items) {
  const usable = (items || []).filter((it) => it && typeof it.passRate === 'number');
  const nItems = usable.length;
  if (!nItems) {
    return { items: 0, score: null, se: null, ci95: null, unstableItems: [], unanimousItems: 0 };
  }
  const score = usable.reduce((s, it) => s + it.passRate, 0) / nItems;
  const variance = usable.reduce((s, it) => {
    const p = it.passRate;
    return s + (p * (1 - p)) / Math.max(1, it.judged);
  }, 0) / (nItems * nItems);
  const se = Math.sqrt(variance);
  return {
    items: nItems,
    score: round6(score),
    se: round6(se),
    ci95: { low: round6(Math.max(0, score - 1.959963984540054 * se)), high: round6(Math.min(1, score + 1.959963984540054 * se)) },
    unstableItems: usable.filter((it) => it.unstable).map((it) => it.itemId).filter(Boolean),
    unanimousItems: usable.filter((it) => it.unanimous).length,
  };
}

// Minimum repeats to push the expected run-to-run SE of a 36-item score under a
// target. `unstableShare` is the share of items sitting near the threshold
// (measured: 1 of 6 probe items, i.e. about 0.17).
function requiredSamples(nItems, unstableShare, targetSe, perItemVariance) {
  const p = 0.5;
  const v = perItemVariance === undefined ? p * (1 - p) : perItemVariance;
  const n = Math.ceil((unstableShare * nItems * v) / (nItems * nItems * targetSe * targetSe));
  return Math.max(1, n);
}

module.exports = {
  DIMS, judgeSample, aggregateItem, aggregateRun, wilson, requiredSamples,
};
