'use strict';
// Offline ASR failure analysis for the B1 B condition.
// Joins: frozen gold transcript, product SA hypothesis, and the B1 judge verdicts.
// No network, no model calls, no cost.

const fs = require('fs');
const path = require('path');

const REPO = '/Users/belliedmonkey/OpenBot/Agents/agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc/work/repo';
const EXP = path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113');
const B1 = path.join(REPO, 'docs/qa/experiments/e2e-b1-text-mt-20261114');
const INPUT = path.join(EXP, 'records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json');
const HYP = path.join(EXP, 'records/01-sa-official-aef9aa8f/sa-smoke-aef9aa8f-r1/hypotheses.json');
const OUT = '/Users/belliedmonkey/qa/e2e-b1-text-mt-20261114/analysis';

const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Normalize for edit distance: keep letters/digits, drop punctuation and case.
function norm(s, lang) {
  let t = String(s || '').toLowerCase();
  if (lang === 'zh') return t.replace(/[^\u4e00-\u9fff0-9a-z]/g, '');
  return t.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s, lang) {
  if (lang === 'zh') return Array.from(norm(s, lang));
  const n = norm(s, lang);
  return n ? n.split(' ') : [];
}

// Levenshtein with backtrace counting S/D/I.
function align(ref, hyp) {
  const n = ref.length, m = hyp.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  let i = n, j = m, S = 0, D = 0, I = 0;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) { S++; ops.push({ op: 'S', ref: ref[i - 1], hyp: hyp[j - 1] }); }
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      D++; ops.push({ op: 'D', ref: ref[i - 1] }); i--;
    } else {
      I++; ops.push({ op: 'I', hyp: hyp[j - 1] }); j--;
    }
  }
  return { S, D, I, ops: ops.reverse() };
}

function lang(id) {
  if (id.indexOf('en_us') !== -1) return 'en';
  if (id.indexOf('ascend') !== -1) return 'mixed';
  return 'zh';
}

function main() {
  const items = (readJson(INPUT).items || readJson(INPUT));
  const hyps = new Map(readJson(HYP).map((r) => [r.id, r.hypothesis]));
  const verdicts = {};
  for (const f of fs.readdirSync(path.join(B1, 'out/judge'))) {
    const j = readJson(path.join(B1, 'out/judge', f));
    if (!j.verdict) continue;
    verdicts[j.pairId] = verdicts[j.pairId] || {};
    verdicts[j.pairId][j.judgeId] = j.verdict;
  }

  const rows = [];
  for (const it of items) {
    const l = lang(it.id);
    const refLang = l === 'en' ? 'en' : 'zh';
    const ref = tokens(it.reference, refLang);
    const hyp = tokens(hyps.get(it.id), refLang);
    const a = align(ref, hyp);
    const edits = a.S + a.D + a.I;
    const rate = ref.length ? edits / ref.length : null;
    const vb = verdicts[it.id + '|B'] || {};
    const va = verdicts[it.id + '|A'] || {};
    const strictFail = (v) => !v || Object.keys(v).length === 0 || !DIMS.every((d) => v.dimensions[d].pass);
    const failedDims = [];
    for (const d of DIMS) {
      const anyFail = Object.values(vb).some((v) => !v.dimensions[d].pass);
      if (anyFail) failedDims.push(d);
    }
    rows.push({
      itemId: it.id, lang: l,
      refTokens: ref.length, S: a.S, D: a.D, I: a.I, edits, errorRate: rate,
      meaningPassB: Object.values(vb).every((v) => v.dimensions.meaning.pass),
      failedDims,
      A_allPass: !strictFail(Object.values(va)[0]) && Object.values(va).every((v) => DIMS.every((d) => v.dimensions[d].pass)),
      worstOps: a.ops.filter((o) => o.op !== 'S').slice(0, 4).concat(a.ops.filter((o) => o.op === 'S').slice(0, 4)),
      findings: Object.values(vb).flatMap((v) => v.findings || []).slice(0, 2),
    });
  }

  // Bands
  const bands = [
    { name: '0 错', test: (r) => r.edits === 0 },
    { name: '1–10%', test: (r) => r.edits > 0 && r.errorRate <= 0.10 },
    { name: '10–25%', test: (r) => r.errorRate > 0.10 && r.errorRate <= 0.25 },
    { name: '>25%', test: (r) => r.errorRate > 0.25 },
  ];
  const summary = bands.map((b) => {
    const sel = rows.filter(b.test);
    const pass = sel.filter((r) => r.meaningPassB).length;
    return { band: b.name, items: sel.length, meaningPass: pass, rate: sel.length ? pass / sel.length : null };
  });

  const byLang = {};
  for (const l of ['en', 'zh', 'mixed']) {
    const sel = rows.filter((r) => r.lang === l);
    const edits = sel.reduce((a, r) => a + r.edits, 0);
    const refs = sel.reduce((a, r) => a + r.refTokens, 0);
    byLang[l] = {
      items: sel.length, edits, refTokens: refs, rate: refs ? edits / refs : null,
      meaningPass: sel.filter((r) => r.meaningPassB).length,
      S: sel.reduce((a, r) => a + r.S, 0), D: sel.reduce((a, r) => a + r.D, 0), I: sel.reduce((a, r) => a + r.I, 0),
    };
  }

  const dimCount = {};
  for (const r of rows) for (const d of r.failedDims) dimCount[d] = (dimCount[d] || 0) + 1;

  const result = {
    generatedAt: new Date().toISOString(),
    schema: 'belliedmonkey.e2e-b1.asr-error-analysis.v1',
    note: 'Offline join of frozen gold transcript, frozen SA hypothesis and B1 B-condition verdicts. No new calls.',
    totals: {
      items: rows.length,
      edits: rows.reduce((a, r) => a + r.edits, 0),
      refTokens: rows.reduce((a, r) => a + r.refTokens, 0),
      meaningPassB: rows.filter((r) => r.meaningPassB).length,
      A_allPass: rows.filter((r) => r.A_allPass).length,
    },
    byBand: summary, byLang, failedDimCount: dimCount,
    rows,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'asr-error-analysis.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ bands: summary, byLang, dimCount, totals: result.totals }, null, 2));
}

main();
