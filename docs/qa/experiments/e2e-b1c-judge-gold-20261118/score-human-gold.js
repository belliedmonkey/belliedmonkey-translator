'use strict';
// B1c: score the judges against the filled human-gold sheet.
//
// Reads  gold/human-gold.csv   (P / F / ? per dimension, must be complete)
// Reads  ../e2e-b1b-unified-judge-20261118/out/judge-unified/*.json   (B1 cases)
// Reads  ../e2e-b1b-unified-judge-20261118/out/judge-hardset/*.json   (hard-set cases)
//
// Emits  out/human-gold-score.json and a markdown summary on stdout.
//
// Metrics, each with a 95% Wilson interval:
//   cell level  — every (case, dimension) pair: TPR = P(judge F | human F)
//   pair level  — case passes only if all seven dimensions pass on both sides
// `?` human cells are dropped from cell level and make the pair-level case unscorable.
//
// Usage: node score-human-gold.js [--md]

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const B1B = path.join(HERE, '..', 'e2e-b1b-unified-judge-20261118');
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const JUDGES = ['judge-a', 'judge-b'];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }

// RFC 4180-ish parser: enough for quoted multi-line cells.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (ch === '\r') continue;
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function wilson(k, n, z) {
  if (!n) return { p: null, lo: null, hi: null, n: 0 };
  z = z || 1.959963984540054;
  const p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  return {
    p: Math.round(p * 1e4) / 1e4,
    lo: Math.round(Math.max(0, centre - half) * 1e4) / 1e4,
    hi: Math.round(Math.min(1, centre + half) * 1e4) / 1e4,
    n,
  };
}

function judgeRecord(set, caseId, pairId, judgeId) {
  let p;
  if (set === 'b1') {
    p = path.join(B1B, 'out', 'judge-unified', (pairId + '_' + judgeId).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json');
  } else {
    p = path.join(B1B, 'out', 'judge-hardset', (caseId.replace(/^HS-/, '') + '_' + judgeId) + '.json');
  }
  if (!fs.existsSync(p)) throw new Error('missing judge record: ' + p);
  return readJson(p); // verdict may be null if the judge failed to produce a usable one
}

function main() {
  const ARGS = process.argv.slice(2);
  const draftMode = ARGS.includes('--draft');
  const csvPath = process.env.GOLD_CSV || path.join(HERE, 'gold', draftMode ? 'human-gold-draft.csv' : 'human-gold.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error('no sheet at ' + csvPath + (draftMode ? '' : ' — fill gold/human-gold.csv first, or preview with --draft'));
  }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const head = rows[0];
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const need of ['case_id', 'set', 'condition', 'item_id', 'target_lang'].concat(DIMS.map((d) => 'd_' + d))) {
    if (!(need in idx)) throw new Error('csv column missing: ' + need);
  }
  const cases = [];
  for (const r of rows.slice(1)) {
    const c = {
      caseId: r[idx.case_id], set: r[idx.set], condition: r[idx.condition],
      itemId: r[idx.item_id], targetLang: r[idx.target_lang],
      human: {}, note: r[idx.human_note] || '',
    };
    const missing = [];
    const bad = [];
    for (const d of DIMS) {
      const v = (r[idx['d_' + d]] || '').trim().toUpperCase();
      if (!v) missing.push(d);
      else if (!['P', 'F', '?'].includes(v)) bad.push(d + '=' + v);
      else c.human[d] = v;
    }
    if (missing.length) throw new Error(c.caseId + ': unfilled dimensions: ' + missing.join(','));
    if (bad.length) throw new Error(c.caseId + ': bad labels: ' + bad.join(','));
    c.pairId = c.set === 'b1' ? c.itemId + '|' + c.condition : null;
    cases.push(c);
  }

  const out = { schema: 'belliedmonkey.e2e-b1c.gold-score.v1', mode: draftMode ? 'draft' : 'gold', cases: cases.length, judges: {}, pairLevel: {}, perDimension: {}, perSet: {}, disagreements: [] };

  // Provenance: how much of a filled gold sheet is the draft, unchanged.
  const draftPath = path.join(HERE, 'gold', 'draft-labels.json');
  if (fs.existsSync(draftPath)) {
    const draft = readJson(draftPath);
    const byId = new Map(draft.cases.map((c) => [c.caseId, c]));
    let same = 0, changed = 0;
    const changedCells = [];
    for (const c of cases) {
      const d = byId.get(c.caseId);
      if (!d) continue;
      for (const dim of DIMS) {
        const dv = d.dims[dim];
        if (c.human[dim] === '?') continue;
        if (c.human[dim] === dv) same++;
        else { changed++; changedCells.push({ caseId: c.caseId, dim, draft: dv, human: c.human[dim] }); }
      }
    }
    out.goldProvenance = { draftCells: same + changed, acceptedUnchanged: same, humanOverridden: changed, overrides: changedCells };
  }

  // Cell level.
  for (const j of JUDGES) {
    let tp = 0, fp = 0, tn = 0, fn = 0, abstain = 0;
    const rowsJ = [];
    let recAbstain = 0;
      for (const c of cases) {
        const rec = judgeRecord(c.set, c.caseId, c.pairId, j);
        if (!rec.verdict) { recAbstain++; abstain += DIMS.filter((d) => c.human[d] !== '?').length; continue; }
        for (const d of DIMS) {
        const h = c.human[d];
        if (h === '?') { abstain++; continue; }
        const g = rec.verdict.dimensions[d].pass === false ? 'F' : 'P';
        let cell;
        if (h === 'F' && g === 'F') { tp++; cell = 'TP'; }
        else if (h === 'F' && g === 'P') { fn++; cell = 'FN'; }
        else if (h === 'P' && g === 'F') { fp++; cell = 'FP'; }
        else { tn++; cell = 'TN'; }
        rowsJ.push({ caseId: c.caseId, set: c.set, condition: c.condition, dim: d, human: h, judge: g, cell });
      }
    }
    out.judges[j] = {
      model: readJson(path.join(B1B, 'out', 'judge-unified', (cases[0].pairId + '_' + j).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json')).model,
      recordsAbstained: recAbstain,
      cells: { tp, fp, tn, fn, abstain, scored: tp + fp + tn + fn },
      tpr: wilson(tp, tp + fn),
      tnr: wilson(tn, tn + fp),
      cells_detail: rowsJ,
    };
  }

  // Pair level: human pass = all P; unscorable if any '?'.
  for (const j of JUDGES) {
    let tp = 0, fp = 0, tn = 0, fn = 0, skipped = 0;
    for (const c of cases) {
      const hs = DIMS.map((d) => c.human[d]);
      if (hs.includes('?')) { skipped++; continue; }
      const h = hs.includes('F') ? 'F' : 'P';
      const rec = judgeRecord(c.set, c.caseId, c.pairId, j);
      if (!rec.verdict) { skipped++; continue; }
      const g = DIMS.every((d) => rec.verdict.dimensions[d].pass !== false) ? 'P' : 'F';
      if (h === 'F' && g === 'F') tp++;
      else if (h === 'F' && g === 'P') fn++;
      else if (h === 'P' && g === 'F') fp++;
      else tn++;
    }
    out.pairLevel[j] = { tp, fp, tn, fn, skipped, tpr: wilson(tp, tp + fn), tnr: wilson(tn, tn + fp) };
  }

  // Per dimension, and per set, cell level, pooled over judges.
  for (const d of DIMS) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const j of JUDGES) for (const r of out.judges[j].cells_detail) {
      if (r.dim !== d) continue;
      if (r.cell === 'TP') tp++; else if (r.cell === 'FP') fp++; else if (r.cell === 'TN') tn++; else fn++;
    }
    out.perDimension[d] = { tp, fp, tn, fn, tpr: wilson(tp, tp + fn), tnr: wilson(tn, tn + fp) };
  }
  for (const set of ['b1', 'hardset']) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const j of JUDGES) for (const r of out.judges[j].cells_detail) {
      if (r.set !== set) continue;
      if (r.cell === 'TP') tp++; else if (r.cell === 'FP') fp++; else if (r.cell === 'TN') tn++; else fn++;
    }
    out.perSet[set] = { tp, fp, tn, fn, tpr: wilson(tp, tp + fn), tnr: wilson(tn, tn + fp) };
  }

  // Where the judges part ways with the human.
  for (const j of JUDGES) {
    for (const r of out.judges[j].cells_detail) {
      if (r.cell === 'TP' || r.cell === 'TN') continue;
      out.disagreements.push(Object.assign({ judge: j }, r));
    }
  }

  // Draft mode is a preview, never a result: print only, write nothing.
  if (!draftMode) writeJson(process.env.GOLD_OUT || path.join(HERE, 'out', 'human-gold-score.json'), out);
  printMd(out);
}

function pct(w) { return w.p == null ? 'n/a' : (w.p * 100).toFixed(1) + '%'; }
function ci(w) { return w.p == null ? '' : ' [' + (w.lo * 100).toFixed(1) + ', ' + (w.hi * 100).toFixed(1) + '] n=' + w.n; }

function printMd(out) {
  const L = [];
  if (out.mode === 'draft') {
    L.push('# DRAFT ONLY — judge vs a model-written draft, not vs human gold');
    L.push('');
    L.push('These numbers exist so the draft can be sanity-checked. They are **not** TPR/TNR and must not be cited as acceptance evidence. Fill `gold/human-gold.csv` and run without `--draft` for the real figures.');
  } else {
    L.push('# Judge calibration against human gold');
  }
  L.push('');
  L.push('`' + out.cases + '` cases. `TPR` = catches a real defect; `TNR` = clears a clean translation. 95% Wilson interval.');
  if (out.goldProvenance) {
    const p = out.goldProvenance;
    L.push('');
    L.push('> Provenance: ' + p.acceptedUnchanged + ' of ' + p.draftCells + ' cells match the model-written draft unchanged, ' +
      p.humanOverridden + ' were overridden by the human. ' +
      (p.humanOverridden / Math.max(1, p.draftCells) < 0.2
        ? '**Under 20% overridden — treat this gold as draft-derived and say so wherever the numbers are used.**'
        : 'Human review changed a substantial share of cells.'));
  }
  L.push('');
  L.push('## Pair level (all seven dimensions)');
  L.push('');
  L.push('| judge | TP | FP | TN | FN | TPR | TNR |');
  L.push('|---|---|---|---|---|---|---|');
  for (const j of JUDGES) {
    const v = out.pairLevel[j];
    L.push('| ' + j + ' | ' + v.tp + ' | ' + v.fp + ' | ' + v.tn + ' | ' + v.fn + ' | ' + pct(v.tpr) + ci(v.tpr) + ' | ' + pct(v.tnr) + ci(v.tnr) + ' |');
  }
  L.push('');
  L.push('## Cell level (case × dimension)');
  L.push('');
  L.push('| judge | TP | FP | TN | FN | abstain | TPR | TNR |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const j of JUDGES) {
    const v = out.judges[j];
    L.push('| ' + j + ' | ' + v.cells.tp + ' | ' + v.cells.fp + ' | ' + v.cells.tn + ' | ' + v.cells.fn + ' | ' + v.cells.abstain + ' | ' + pct(v.tpr) + ci(v.tpr) + ' | ' + pct(v.tnr) + ci(v.tnr) + ' |');
  }
  L.push('');
  L.push('## Per dimension (both judges pooled)');
  L.push('');
  L.push('| dimension | TP | FP | TN | FN | TPR | TNR |');
  L.push('|---|---|---|---|---|---|---|');
  for (const d of DIMS) {
    const v = out.perDimension[d];
    L.push('| ' + d + ' | ' + v.tp + ' | ' + v.fp + ' | ' + v.tn + ' | ' + v.fn + ' | ' + pct(v.tpr) + ci(v.tpr) + ' | ' + pct(v.tnr) + ci(v.tnr) + ' |');
  }
  L.push('');
  L.push('## Per set (both judges pooled, cell level)');
  L.push('');
  L.push('| set | TP | FP | TN | FN | TPR | TNR |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of ['b1', 'hardset']) {
    const v = out.perSet[s];
    L.push('| ' + s + ' | ' + v.tp + ' | ' + v.fp + ' | ' + v.tn + ' | ' + v.fn + ' | ' + pct(v.tpr) + ci(v.tpr) + ' | ' + pct(v.tnr) + ci(v.tnr) + ' |');
  }
  L.push('');
  L.push('## Every false negative and false positive');
  L.push('');
  L.push('| judge | case | set | dim | human | judge | cell |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of out.disagreements) {
    L.push('| ' + r.judge + ' | ' + r.caseId + ' | ' + r.set + ' | ' + r.dim + ' | ' + r.human + ' | ' + r.judge + ' | ' + r.cell + ' |');
  }
  console.log(L.join('\n'));
}

main();
