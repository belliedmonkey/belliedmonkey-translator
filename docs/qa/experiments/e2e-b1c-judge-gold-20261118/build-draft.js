'use strict';
// B1c: emit a DRAFT set of labels for the 50-case sheet.
//
// This is a third reviewer, not human gold. It exists so a person can correct
// 50 rows instead of authoring them, at the cost of anchoring. The scorer reads
// this file to report how many cells the human accepted unchanged, so a
// draft-derived gold can never be mistaken for independent human labelling.
//
// Judging basis: authoritative source + candidate translation only. The ASR
// text was not consulted; correctness of the source itself was not assumed.
// Standard: a dimension fails when a careful professional reviewer would
// require a fix before publication.
//
// Usage: node build-draft.js

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const ALL_P = 'PPPPPPP';

// [caseId, 7-char signature, confidence, evidence for each failing dim, note]
const ROWS = [
  ['B1-B-ascend/00004', 'FPPFFPP', 'high', {
    meaning: '原文「呃what\'s the呃」只剩填充词，译文「I am so」没有对应命题',
    omission: '「what\'s the」这一疑问内容被整段丢弃',
    hallucination: '「I am so」原文没有',
  }, ''],
  ['B1-B-ascend/00009', 'FPPFFPP', 'high', {
    meaning: '「我专业是 ISM」变成「love is that ISM」，专业这一命题消失',
    omission: '「no我专业是」被丢弃',
    hallucination: '「love」原文没有',
  }, ''],
  ['B1-B-ascend/00028', 'FFPFFPP', 'high', {
    meaning: '「ok福建」变成「OK, attachment」',
    entities_numbers: '「福建」是地名，译成「attachment」，地名消失',
    omission: '「福建」整词被替换',
    hallucination: '「attachment」原文没有',
  }, ''],
  ['B1-B-ascend/00055', ALL_P, 'high', {}, ''],
  ['B1-B-ascend/00066', ALL_P, 'high', {}, ''],
  ['B1-B-ascend/00068', 'FPPFFFF', 'high', {
    meaning: '「computer languages」变成「all language」',
    omission: '「computer」这一限定消失',
    hallucination: '「Maybe usually」原文没有',
    terminology: '「computer languages」是术语，译成「all language」',
    fluency: '「Maybe usually all language」不成句',
  }, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1668', 'PFPPPPP', 'medium', {
    entities_numbers: '原文括注品牌名「(Wild Card)」，译文改成「Universal Card」，品牌消失',
  }, '品牌名改写；意义仍可读，只判实体'],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1669', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1670', 'FPPPFPP', 'high', {
    meaning: '「它们与地下深穴的情况很相似」变成「conditions involving rising snow underground」',
    hallucination: '「rising snow」原文没有',
  }, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1671', ALL_P, 'high', {}, '「2005 财年」简化成「Since 2005」，不影响命题'],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1672', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1673', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1674', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1675', 'FFPFFFP', 'high', {
    meaning: '「除去表示您的 Sie 之外」变成「except for the letter C representing you」',
    entities_numbers: '引号内的德语词「Sie」被替换成「C」',
    omission: '对「Sie」（尊称您）的说明整段丢失',
    hallucination: '「the letter C」原文没有',
    terminology: '语法对象「Sie」被误作字母 C',
  }, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1676', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1677', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1678', 'FPPPPPP', 'medium', {
    meaning: '论文标题《总统的演讲》被读成「his presidential address」，暗示萨克斯本人发表总统演说，事实关系改变',
  }, '标题被当作事件；命题主干仍在，只判意义'],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1679', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1680', 'FPPPPPP', 'medium', {
    meaning: '原文只说「拉力」是人类大力士的五倍，译文把游泳、跳远一并说成五倍，扩大了命题范围',
  }, '范围扩大；数字本身没错，只判意义'],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1681', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/cmn_hans_cn/1682', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1668', 'PFPPPPP', 'medium', {
    entities_numbers: '品牌「Wild Card」译成「野生卡」，读者无法识别该卡',
  }, '品牌名直译；意义仍可读，只判实体'],
  ['B1-B-fleurs-public-candidates/en_us/1669', 'PPPPPFP', 'medium', {
    terminology: '「Police superintendent」译成「警察总监」，把警司级抬成总监级',
  }, '警衔误译；只判术语'],
  ['B1-B-fleurs-public-candidates/en_us/1670', 'PFPPPPP', 'medium', {
    entities_numbers: '「Glen Cushing」译成「格伦·卡辛」，通行译名是「库欣」，指向另一个人名',
  }, '人名音译偏差；只判实体'],
  ['B1-B-fleurs-public-candidates/en_us/1671', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1672', ALL_P, 'high', {}, '开头多一个「好的」，不构成命题增删'],
  ['B1-B-fleurs-public-candidates/en_us/1673', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1674', ALL_P, 'high', {}, '「several minutes」泛化成「更长时间」，不算缺陷'],
  ['B1-B-fleurs-public-candidates/en_us/1675', 'FPPFFFF', 'high', {
    meaning: '「All nouns, alongside the word Sie for you」变成「所有与你世界安全相关的名词」',
    omission: '「Sie」与「for you」消失',
    hallucination: '「世界安全」原文没有',
    terminology: '语法对象「nouns / Sie」被换成「与你世界安全相关的名词」',
    fluency: '「所有与你世界安全相关的名词」语义不通',
  }, ''],
  ['B1-B-fleurs-public-candidates/en_us/1676', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1677', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1678', 'FPPPPPP', 'medium', {
    meaning: '论文标题 The President\'s Speech 被当作说话主体：「总统的演讲表明」；原文是萨克斯在论文中指出',
  }, '标题被当作事件；只判意义'],
  ['B1-B-fleurs-public-candidates/en_us/1679', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1680', 'FPPPPPP', 'medium', {
    meaning: '「leap great distances」（跳远）译成「能长途跋涉」（长途行走），动作改变',
  }, '动作误译；只判意义'],
  ['B1-B-fleurs-public-candidates/en_us/1681', ALL_P, 'high', {}, ''],
  ['B1-B-fleurs-public-candidates/en_us/1682', 'FFPPFPP', 'high', {
    meaning: '「无人知晓作者是谁」变成「无人知晓 Serenhu Roi 的情况」',
    entities_numbers: '「Serenhu Roi」是原文没有的人名',
    hallucination: '凭空出现人名 Serenhu Roi',
  }, ''],
  ['B1-A-ascend/00066', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/cmn_hans_cn/1669', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/cmn_hans_cn/1672', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/cmn_hans_cn/1675', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/cmn_hans_cn/1677', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/cmn_hans_cn/1679', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/en_us/1673', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/en_us/1677', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/en_us/1678', ALL_P, 'high', {}, ''],
  ['B1-A-fleurs-public-candidates/en_us/1679', ALL_P, 'high', {}, ''],
  ['HS-zh_92816176', 'PFPPPPP', 'medium', {
    entities_numbers: '原文「威廉一世」，译文「William III」：数字与世系变了。按史实 1694 年在位的是威廉三世，疑似原文有误、译者自行更正，但译文确实不忠于原文',
  }, '注意：这不是「译者写错」，是「原文与译文不一致」；如果按史实优先，这一格可改 P，改判会直接改变 judge-a 的评价'],
  ['HS-en_1385458475', ALL_P, 'high', {}, ''],
  ['HS-en_1385049036', ALL_P, 'high', {}, ''],
  ['HS-en_1378366143', ALL_P, 'high', {}, ''],
];

function main() {
  if (ROWS.length !== 50) throw new Error('expected 50 rows, got ' + ROWS.length);
  const cases = [];
  for (const [caseId, sig, confidence, evidence, note] of ROWS) {
    if (sig.length !== DIMS.length) throw new Error(caseId + ': signature must be 7 chars');
    const dims = {};
    DIMS.forEach((d, i) => { dims[d] = sig[i] === 'P' ? 'P' : 'F'; });
    for (const d of DIMS) {
      if (dims[d] === 'F' && !evidence[d]) throw new Error(caseId + ': missing evidence for ' + d);
      if (dims[d] === 'P' && evidence[d]) throw new Error(caseId + ': evidence for passing dim ' + d);
    }
    cases.push({ caseId, dims, confidence, evidence, note: note || '' });
  }
  const out = {
    schema: 'belliedmonkey.e2e-b1c.draft.v1',
    role: 'LLM third reviewer — NOT human gold',
    by: 'agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc',
    basis: 'authoritative source + candidate translation only; ASR text and existing judge verdicts not consulted',
    standard: 'a dimension fails when a careful professional reviewer would require a fix before publication',
    cases,
  };
  fs.mkdirSync(path.join(HERE, 'gold'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'gold', 'draft-labels.json'), JSON.stringify(out, null, 2) + '\n');

  // A copy of the sheet with the draft filled in. The human edits this and
  // saves it as human-gold.csv; the scorer diffs it against draft-labels.json.
  const rows = parseCsv(fs.readFileSync(path.join(HERE, 'gold', 'human-gold.csv'), 'utf8'));
  const head = rows[0];
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const byId = new Map(cases.map((c) => [c.caseId, c]));
  const seen = new Set();
  const outRows = [head.concat(['draft_confidence'])];
  for (const r of rows.slice(1)) {
    const c = byId.get(r[idx.case_id]);
    if (!c) throw new Error('draft has no row for csv case ' + r[idx.case_id]);
    seen.add(c.caseId);
    const cells = r.slice();
    for (const d of DIMS) cells[idx['d_' + d]] = c.dims[d];
    cells[idx.human_note] = c.note;
    cells.push(c.confidence);
    outRows.push(cells);
  }
  for (const c of cases) if (!seen.has(c.caseId)) throw new Error('csv has no row for draft case ' + c.caseId);
  fs.writeFileSync(path.join(HERE, 'gold', 'human-gold-draft.csv'), outRows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

  const fCells = cases.reduce((a, c) => a + DIMS.filter((d) => c.dims[d] === 'F').length, 0);
  const fCases = cases.filter((c) => DIMS.some((d) => c.dims[d] === 'F')).length;
  console.log('draft cases=' + cases.length + ' pass=' + (cases.length - fCases) + ' fail=' + fCases +
    ' failingCells=' + fCells + ' medium=' + cases.filter((c) => c.confidence === 'medium').length);
}

// RFC 4180-ish parser: cells may contain commas, quotes and newlines.
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

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

main();
