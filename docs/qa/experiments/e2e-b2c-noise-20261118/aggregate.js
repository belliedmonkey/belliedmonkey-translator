'use strict';
// Recompute every summary in this record from the archived per-call JSONL.
// No network, no secrets. Run: node aggregate.js

const fs = require('fs');
const path = require('path');
const { aggregateItem, aggregateRun, wilson, DIMS } = require('../../checks/repro-aggregate.js');

const OUT = path.join(__dirname, 'out');
const readJsonl = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const round8 = (v) => Math.round(v * 1e8) / 1e8;

function seedStats(calls) {
  const groups = new Map();
  for (const r of calls) {
    const k = r.itemId + '|' + r.condition;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rows = [];
  for (const [k, rs] of [...groups.entries()].sort()) {
    const ok = rs.filter((r) => r.ok);
    const shas = [...new Set(ok.map((r) => r.outputSha256))];
    rows.push({
      itemId: k.split('|')[0], condition: k.split('|')[1],
      calls: rs.length, ok: ok.length,
      distinctOutputs: shas.length,
      outputs: shas.length === 1 ? 1 : shas.length,
      parseFails: rs.filter((r) => !r.ok).length,
    });
  }
  return rows;
}

function judgeStats(calls) {
  const groups = new Map();
  for (const r of calls) {
    const k = r.itemId + '|' + r.judgeId;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rows = [];
  for (const [k, rs] of [...groups.entries()].sort()) {
    const ok = rs.filter((r) => r.ok && r.verdict);
    const pass = ok.filter((r) => DIMS.every((d) => r.verdict.dimensions[d].pass));
    const failSets = [...new Set(ok.map((r) => DIMS.filter((d) => !r.verdict.dimensions[d].pass).join(',') || '(all pass)'))];
    rows.push({
      itemId: k.split('|')[0], judgeId: k.split('|')[1],
      calls: rs.length, judged: ok.length,
      itemPass: pass.length, itemFail: ok.length - pass.length,
      distinctDimFailSets: failSets.length, failSets,
      parseFails: rs.filter((r) => !r.ok).length,
    });
  }
  return rows;
}

function sampleItems(calls) {
  const grid = new Map();
  for (const r of calls) {
    if (!r.ok || !r.verdict) continue;
    const k = r.itemId + '|' + r.sampleIndex;
    if (!grid.has(k)) grid.set(k, {});
    grid.get(k)[r.judgeId] = r.verdict;
  }
  const itemIds = [...new Set(calls.map((r) => r.itemId))].sort();
  const maxIndex = Math.max(...calls.map((r) => r.sampleIndex)) + 1;
  return itemIds.map((itemId) => {
    const samples = [];
    for (let i = 0; i < maxIndex; i++) samples.push(grid.get(itemId + '|' + i) || null);
    return Object.assign({ itemId }, aggregateItem(samples));
  });
}

const seedCalls = readJsonl(path.join(OUT, 'seed-calls.jsonl'));
const judgeCalls = readJsonl(path.join(OUT, 'judge-calls.jsonl'));
const sampleCalls = readJsonl(path.join(OUT, 'sample-judge-calls.jsonl'));

const items = sampleItems(sampleCalls);
const run = aggregateRun(items);

const spend = {
  judgeRepeatProbeUsd: round8(judgeCalls.reduce((s, r) => s + (r.providerUsd || 0), 0)),
  sampleJudgeUsd: round8(sampleCalls.reduce((s, r) => s + (r.providerUsd || 0), 0)),
};
spend.totalUsd = round8(spend.judgeRepeatProbeUsd + spend.sampleJudgeUsd);

const seedTokens = seedCalls.reduce((acc, r) => {
  const u = r.usage || {};
  acc.prompt += u.prompt_tokens || 0;
  acc.completion += u.completion_tokens || 0;
  return acc;
}, { prompt: 0, completion: 0 });

const summary = {
  schema: 'belliedmonkey.e2e-b2c.noise.v1',
  measuredAt: '2026-11-18',
  endpoint: 'qwencloud compatible-mode chat/completions',
  model: 'qwen3.7-plus',
  seedProbe: {
    calls: seedCalls.length,
    conditions: [...new Set(seedCalls.map((r) => r.condition))],
    tokens: seedTokens,
    seedAccepted: seedCalls.filter((r) => r.seed !== null).every((r) => r.httpStatus === 200),
    systemFingerprintPresent: seedCalls.some((r) => !!r.systemFingerprint),
    rows: seedStats(seedCalls),
  },
  judgeRepeatProbe: { calls: judgeCalls.length, rows: judgeStats(judgeCalls) },
  sampleVerdicts: {
    calls: sampleCalls.length, items,
    itemPassRates: items.map((it) => ({ itemId: it.itemId, passCount: it.passCount, judged: it.judged, passRate: it.passRate, unstable: it.unstable, ci95: it.ci95 })),
    run,
  },
  spend,
  wilsonCheck: { threeOfSix: wilson(3, 6) },
};

fs.writeFileSync(path.join(OUT, 'repro-summary.json'), JSON.stringify(summary, null, 2) + '\n');

const pct = (v) => (v * 100).toFixed(1) + '%';
console.log('seed probe: ' + seedCalls.length + ' calls, seed accepted=' + summary.seedProbe.seedAccepted +
  ', fingerprint=' + summary.seedProbe.systemFingerprintPresent);
for (const r of summary.seedProbe.rows) console.log('  ' + r.condition.padEnd(7) + ' ' + r.itemId.split('/').slice(-1)[0].padEnd(6) + ' distinct=' + r.distinctOutputs + '/' + r.ok);
console.log('judge repeat: ' + judgeCalls.length + ' calls, item-level flips=' +
  summary.judgeRepeatProbe.rows.filter((r) => r.itemPass > 0 && r.itemFail > 0).length);
for (const r of summary.judgeRepeatProbe.rows) console.log('  ' + r.judgeId + ' ' + r.itemId.split('/').slice(-1)[0].padEnd(6) + ' pass=' + r.itemPass + ' fail=' + r.itemFail + ' dimSets=' + r.distinctDimFailSets);
console.log('sample verdicts: ' + sampleCalls.length + ' calls');
for (const it of items) console.log('  ' + it.itemId.split('/').slice(-1)[0].padEnd(6) + ' ' + it.passCount + '/' + it.judged + ' rate=' + pct(it.passRate || 0) + (it.unstable ? ' UNSTABLE' : ''));
console.log('run score=' + pct(run.score) + ' se=' + pct(run.se) + ' ci=[' + pct(run.ci95.low) + ',' + pct(run.ci95.high) + ']');
console.log('spend total=' + spend.totalUsd + ' USD');
