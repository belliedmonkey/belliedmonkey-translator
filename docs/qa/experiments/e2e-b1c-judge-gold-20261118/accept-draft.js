'use strict';
// B1c: accept the draft as the working gold.
//
// Writes the draft labels into gold/human-gold.csv (the canonical sheet) and
// records the acceptance in gold/ACCEPTANCE.md. The scorer compares the sheet
// with draft-labels.json, so the result is reported as draft-derived with 0
// overrides -- never as independent human labelling.
//
// Usage: node accept-draft.js --by="<who accepted>"

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (ch === '\r') continue;
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function main() {
  const byArg = process.argv.slice(2).filter((a) => a.startsWith('--by='))[0];
  const by = byArg ? byArg.split('=')[1] : 'user';
  const draft = readJson(path.join(HERE, 'gold', 'draft-labels.json'));
  const rows = parseCsv(fs.readFileSync(path.join(HERE, 'gold', 'human-gold.csv'), 'utf8'));
  const head = rows[0];
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const byId = new Map(draft.cases.map((c) => [c.caseId, c]));

  const out = [head];
  let filled = 0;
  for (const r of rows.slice(1)) {
    const c = byId.get(r[idx.case_id]);
    if (!c) throw new Error('no draft row for ' + r[idx.case_id]);
    const cells = r.slice();
    for (const d of DIMS) { cells[idx['d_' + d]] = c.dims[d]; filled++; }
    cells[idx.human_note] = c.note;
    out.push(cells);
  }
  const csvPath = path.join(HERE, 'gold', 'human-gold.csv');
  fs.writeFileSync(csvPath, out.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

  const fCells = draft.cases.reduce((a, c) => a + DIMS.filter((d) => c.dims[d] === 'F').length, 0);
  const fCases = draft.cases.filter((c) => DIMS.some((d) => c.dims[d] === 'F')).length;
  const md = [
    '# 金标接受记录',
    '',
    '日期：2026-11-18',
    '接受人：' + by,
    '方式：**接受草案，未逐条修改**',
    '',
    '## 记录',
    '',
    '- `gold/human-gold.csv` 由 `accept-draft.js` 从 `gold/draft-labels.json` 写入，' + filled + ' 个格子全部填满',
    '- 与草案逐格相同：**改动 0 格**，打分器据此输出 `draft-derived`',
    '- 判定分布：' + (draft.cases.length - fCases) + ' 条全过、' + fCases + ' 条至少一项不过、' + fCells + ' 个不合格格子',
    '',
    '## 这意味着什么',
    '',
    '这份金标是**草案派生**的，不是独立人工金标。它衡量的是「评委与这份草案的一致度」，不是「评委与真值的一致度」。',
    '',
    '已知局限：',
    '',
    '1. 锚定偏差没有测：接受者未逐条独立判断，无法估计「不看草案会怎么判」',
    '2. 没有第二人复核：39 个不合格格子的维度归属只经过一个评审',
    '3. 维度边界本身有争议：同一个错误算 `meaning` 还是 `hallucination`，草案取「主维度」口径，评委会拆成多个维度',
    '',
    '## 什么时候能升级成真金标',
    '',
    '- 至少一名人工独立复核，改动或明确确认每一格；或',
    '- 第二个独立评审 + 分歧仲裁，且两名评审都未看过草案',
    '',
    '在此之前，引用这些 TPR/TNR 时必须同时写 `draft-derived`。',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(HERE, 'gold', 'ACCEPTANCE.md'), md);
  console.log('accepted: cases=' + draft.cases.length + ' cells=' + filled + ' failCases=' + fCases + ' failCells=' + fCells);
}

main();
