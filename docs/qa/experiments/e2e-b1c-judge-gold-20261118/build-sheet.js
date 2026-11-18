'use strict';
// B1c: build the human-gold worksheet used to measure the judges' TPR/TNR.
//
// Sampling (deterministic, no dependence on judge output):
//   - all 36 condition-B pairs (the hard condition),
//   - 10 condition-A pairs: the 4 whose translation is byte-identical to B
//     (the framing-probe cases) plus 6 picked by a seeded hash,
//   - 4 hard-set pairs: the known 货币政策 case plus 3 seeded picks.
// Total 50 cases, each judged on the same seven dimensions.
//
// Blinding rule: the worksheet shows exactly what the judge saw -- authoritative
// source + candidate translation. The ASR hypothesis is NOT shown, because a
// human who reads it may excuse defects the judge could not see either.
//
// Usage: node build-sheet.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const B1 = path.join(ROOT, 'e2e-b1-text-mt-20261114');
const REPO = '/Users/belliedmonkey/OpenBot/Agents/agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc/work/repo';
const EXP = path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113');
const INPUT = path.join(EXP, 'records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json');
const SEED = 'b1c-gold-v1';

const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function rank(id) { return sha(SEED + '|' + id); }
function pick(list, n) { return list.slice().sort((a, b) => (rank(a.id) < rank(b.id) ? -1 : 1)).slice(0, n); }

const gold = new Map();
for (const it of (readJson(INPUT).items || readJson(INPUT))) gold.set(it.id, it.reference);

const b1 = fs.readdirSync(path.join(B1, 'out', 'translation'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(path.join(B1, 'out', 'translation', f)));

const byPair = new Map(b1.map((r) => [r.pairId, r]));
const items = [...new Set(b1.map((r) => r.itemId))].sort();
if (items.length !== 36) throw new Error('expected 36 items, got ' + items.length);

const identical = items.filter((id) => byPair.get(id + '|A').translation === byPair.get(id + '|B').translation);
const aCandidates = items.filter((id) => !identical.includes(id)).map((id) => ({ id }));
const aPicked = identical.concat(pick(aCandidates, 6).map((x) => x.id));

const cases = [];
for (const id of items) {
  const r = byPair.get(id + '|B');
  cases.push({
    caseId: 'B1-B-' + id,
    set: 'b1', condition: 'B', itemId: id, targetLang: r.targetLang,
    source: gold.get(id), translation: r.translation,
    note: identical.includes(id) ? 'A/B translation byte-identical' : '',
  });
}
for (const id of aPicked.sort()) {
  const r = byPair.get(id + '|A');
  cases.push({
    caseId: 'B1-A-' + id,
    set: 'b1', condition: 'A', itemId: id, targetLang: r.targetLang,
    source: gold.get(id), translation: r.translation,
    note: identical.includes(id) ? 'A/B translation byte-identical' : '',
  });
}

const hsSrc = readJson(path.join(B1, 'hardset', 'sources.json')).items;
const hsTrans = fs.readdirSync(path.join(B1, 'hardset', 'out', 'translation'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(path.join(B1, 'hardset', 'out', 'translation', f)));
const hsById = new Map(hsTrans.map((r) => [r.lang + '_' + r.revid, r]));
const known = 'zh_92816176'; // 货币政策: 威廉一世 rendered as "William III" -- a real defect
const hsRest = hsTrans.filter((r) => r.lang + '_' + r.revid !== known).map((r) => ({ id: r.lang + '_' + r.revid }));
const hsPicked = [known].concat(pick(hsRest, 3).map((x) => x.id));
for (const key of hsPicked) {
  const r = hsById.get(key);
  if (!r || !r.ok) throw new Error('hard-set translation unusable: ' + key);
  const src = hsSrc.filter((x) => x.lang + '_' + x.revid === key)[0];
  if (!src) throw new Error('hard-set source missing: ' + key);
  cases.push({
    caseId: 'HS-' + key,
    set: 'hardset', condition: 'H', itemId: key, targetLang: r.targetLang,
    source: src.source, translation: r.translation,
    note: key === known ? 'known real defect: 威廉一世 -> "William III"' : src.title,
  });
}

if (cases.length !== 50) throw new Error('expected 50 cases, got ' + cases.length);

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const header = ['case_id', 'set', 'condition', 'item_id', 'target_lang', 'note', 'authoritative_source', 'candidate_translation']
  .concat(DIMS.map((d) => 'd_' + d)).concat(['human_note']);
const lines = [header.join(',')];
for (const c of cases) {
  const row = [c.caseId, c.set, c.condition, c.itemId, c.targetLang, c.note, c.source, c.translation]
    .map(csvCell).concat(DIMS.map(() => '')).concat(['']);
  lines.push(row.join(','));
}
fs.mkdirSync(path.join(__dirname, 'gold'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'gold', 'human-gold.csv'), lines.join('\n') + '\n');

// Human-readable companion, same order and case ids.
const md = [];
md.push('# Judge gold worksheet — 50 cases');
md.push('');
md.push('Fill `human-gold.csv`, not this file. Order and `case_id` are identical.');
md.push('');
md.push('## How to fill');
md.push('');
md.push('- Each `d_*` column takes exactly one of: `P` (pass — no real defect), `F` (fail — a real defect in that dimension), `?` (cannot decide from the text shown).');
md.push('- `human_note` is optional; use it when a call is arguable.');
md.push('- **Blinding rule:** you see what the judge saw — authoritative source and candidate translation only. Do not look up the audio or the ASR text; a reviewer who knows the input was noisy will excuse defects.');
md.push('- Judge meaning first, then the six narrower dimensions. `fluency` is about the target reading naturally, not about being faithful.');
md.push('- Numbers in `note` are context only. `known real defect` marks a case already confirmed by hand.');
md.push('');
const sets = [['b1', 'B1 items'], ['hardset', 'Hard set (Wikipedia, CC BY-SA 4.0)']];
for (const [key, title] of sets) {
  md.push('## ' + title);
  md.push('');
  for (const c of cases.filter((x) => x.set === key)) {
    md.push('### ' + c.caseId + (c.note ? ' — ' + c.note : ''));
    md.push('');
    md.push('| | |');
    md.push('|---|---|');
    md.push('| target | ' + c.targetLang + ' |');
    md.push('| source | ' + c.source.replace(/\|/g, '\\|') + ' |');
    md.push('| translation | ' + c.translation.replace(/\|/g, '\\|').replace(/\n/g, ' / ') + ' |');
    md.push('');
    md.push('labels: ' + DIMS.map((d) => '`' + d + '`').join(' · '));
    md.push('');
  }
}
fs.writeFileSync(path.join(__dirname, 'gold', 'human-gold-worksheet.md'), md.join('\n'));

const manifest = {
  schema: 'belliedmonkey.e2e-b1c.gold-sheet.v1',
  seed: SEED,
  cases: cases.length,
  bySet: { b1B: items.length, b1A: aPicked.length, hardset: hsPicked.length },
  identicalPairs: identical,
  aPicked: aPicked.sort(),
  hardsetPicked: hsPicked,
  dims: DIMS,
  blinding: 'worksheet shows authoritative source + candidate translation only; ASR hypothesis withheld',
  csv: 'gold/human-gold.csv',
  worksheet: 'gold/human-gold-worksheet.md',
};
fs.writeFileSync(path.join(__dirname, 'gold', 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
