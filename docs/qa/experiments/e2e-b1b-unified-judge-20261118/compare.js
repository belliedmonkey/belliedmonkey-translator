'use strict';
// B1b: compare the published B1 verdicts (condition B judged with the extra
// "what the system heard" block) against the unified re-judge.
// Emits out/compare.json and prints a markdown table.
//
// Usage: node compare.js

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const B1 = path.join(HERE, '..', 'e2e-b1-text-mt-20261114');
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const JUDGES = ['judge-a', 'judge-b'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const nm = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '_');

function load(dir) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const r = readJson(path.join(dir, f));
    if (!r.verdict) continue;
    out.set(r.pairId + '|' + r.judgeId, r);
  }
  return out;
}

const oldJ = load(path.join(B1, 'out', 'judge'));
const newJ = load(path.join(HERE, 'out', 'judge-unified'));

function rates(map, cond) {
  const per = {};
  for (const d of DIMS) per[d] = { pass: 0, total: 0 };
  let all = 0, verdicts = 0;
  for (const r of map.values()) {
    if (r.condition !== cond) continue;
    verdicts++;
    let ok = true;
    for (const d of DIMS) {
      per[d].total++;
      if (r.verdict.dimensions[d].pass) per[d].pass++; else ok = false;
    }
    if (ok) all++;
  }
  return { per, all, verdicts };
}

const oldB = rates(oldJ, 'B');
const newB = rates(newJ, 'B');
const newA = rates(newJ, 'A');

// Pair-level: both judges all-pass.
function pairLevel(map, cond) {
  const by = new Map();
  for (const r of map.values()) {
    if (r.condition !== cond) continue;
    if (!by.has(r.pairId)) by.set(r.pairId, {});
    by.get(r.pairId)[r.judgeId] = r.verdict;
  }
  let pairs = 0, both = 0, any = 0, none = 0;
  const failing = [];
  for (const [pid, v] of by) {
    if (!v['judge-a'] || !v['judge-b']) continue;
    pairs++;
    const a = DIMS.every((d) => v['judge-a'].dimensions[d].pass);
    const b = DIMS.every((d) => v['judge-b'].dimensions[d].pass);
    if (a && b) both++; else { failing.push(pid); if (a || b) any++; else none++; }
  }
  return { pairs, both, anyOne: any, neither: none, failing: failing.sort() };
}

const plOldB = pairLevel(oldJ, 'B');
const plNewB = pairLevel(newJ, 'B');
const plNewA = pairLevel(newJ, 'A');

// Item-level: does the B pair pass where the A pair passes?
const items = [...new Set([...newJ.values()].map((r) => r.itemId))].sort();
const itemRows = [];
for (const id of items) {
  const recs = {
    A: [newJ.get(id + '|A|judge-a'), newJ.get(id + '|A|judge-b')],
    B: [newJ.get(id + '|B|judge-a'), newJ.get(id + '|B|judge-b')],
  };
  const passes = (cond) => {
    const rs = recs[cond].filter((r) => r && r.verdict);
    if (!rs.length) return null;
    if (rs.some((r) => DIMS.some((d) => !r.verdict.dimensions[d].pass))) return false;
    return rs.length === 2 ? true : null;
  };
  const ap = passes('A'), bp = passes('B');
  itemRows.push({ itemId: id, aPass: ap, bPass: bp, aThenBFail: ap === true && bp === false, unscorable: ap === null || bp === null });
}

// Consistency: pairs whose A and B translations are byte-identical must get the
// same verdict set under a unified prompt.
const tr = new Map();
for (const f of fs.readdirSync(path.join(B1, 'out', 'translation')).filter((x) => x.endsWith('.json'))) {
  const r = readJson(path.join(B1, 'out', 'translation', f));
  tr.set(r.pairId, r);
}
const identical = [];
for (const id of items) {
  const a = tr.get(id + '|A'), b = tr.get(id + '|B');
  if (!a || !b || a.translation !== b.translation) continue;
  const rows = [
    { cond: 'A', rec: newJ.get(id + '|A|judge-a'), recB: newJ.get(id + '|A|judge-b') },
    { cond: 'B', rec: newJ.get(id + '|B|judge-a'), recB: newJ.get(id + '|B|judge-b') },
  ];
  const sig = rows.map((r) => JUDGES.map((j) => {
    const rec = newJ.get(id + '|' + r.cond + '|' + j);
    if (!rec || !rec.verdict) return 'NA';
    return DIMS.map((d) => (rec.verdict.dimensions[d].pass ? 'P' : 'F')).join('');
  }).join('/'));
  identical.push({ itemId: id, aSignature: sig[0], bSignature: sig[1], same: sig[0] === sig[1] });
}

// Pairs that flipped between the old framed judgement and the unified one.
const flips = [];
for (const id of items) {
  for (const j of JUDGES) {
    const o = oldJ.get(id + '|B|' + j), n = newJ.get(id + '|B|' + j);
    if (!o || !n) continue;
    const oa = DIMS.every((d) => o.verdict.dimensions[d].pass);
    const na = DIMS.every((d) => n.verdict.dimensions[d].pass);
    if (oa !== na) flips.push({ itemId: id, judge: j, old: oa ? 'pass' : 'fail', now: na ? 'pass' : 'fail', dimsChanged: DIMS.filter((d) => o.verdict.dimensions[d].pass !== n.verdict.dimensions[d].pass) });
  }
}

const out = {
  schema: 'belliedmonkey.e2e-b1b.compare.v1',
  oldB, newB, newA,
  pairLevel: { oldB: plOldB, newB: plNewB, newA: plNewA },
  items: { total: itemRows.length, aPass: itemRows.filter((x) => x.aPass === true).length, bPass: itemRows.filter((x) => x.bPass === true).length, aThenBFail: itemRows.filter((x) => x.aThenBFail).length, unscorable: itemRows.filter((x) => x.unscorable).length },
  identicalTranslationPairs: identical,
  flips,
  hardset: fs.existsSync(path.join(HERE, 'out', 'judge-hardset'))
    ? fs.readdirSync(path.join(HERE, 'out', 'judge-hardset')).filter((f) => f.endsWith('.json')).map((f) => {
      const r = readJson(path.join(HERE, 'out', 'judge-hardset', f));
      return { itemId: r.itemId, judgeId: r.judgeId, allPass: DIMS.every((d) => r.verdict.dimensions[d].pass), failing: DIMS.filter((d) => !r.verdict.dimensions[d].pass) };
    })
    : [],
};
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'compare.json'), JSON.stringify(out, null, 2) + '\n');

const pc = (a, b) => (100 * a / b).toFixed(1);
console.log('dimension        old B (framed)   new B (unified)   new A');
for (const d of DIMS) {
  console.log(d.padEnd(17), (pc(oldB.per[d].pass, oldB.per[d].total) + '%').padStart(8), (pc(newB.per[d].pass, newB.per[d].total) + '%').padStart(14), (pc(newA.per[d].pass, newA.per[d].total) + '%').padStart(10));
}
console.log('\npair level (both judges all-pass)');
console.log('old B', plOldB.both + '/' + plOldB.pairs, '| new B', plNewB.both + '/' + plNewB.pairs, '| new A', plNewA.both + '/' + plNewA.pairs);
console.log('items A pass', out.items.aPass + '/' + out.items.total, '| B pass', out.items.bPass + '/' + out.items.total, '| A passes but B fails', out.items.aThenBFail);
console.log('identical-translation pairs consistent:', identical.filter((x) => x.same).length + '/' + identical.length);
console.log('verdict flips old->new (B):', flips.length);
for (const f of flips) console.log('  ', f.itemId, f.judge, f.old, '->', f.now, f.dimsChanged.join(','));
