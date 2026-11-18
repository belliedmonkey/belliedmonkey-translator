'use strict';
// B1b: re-judge the frozen B1 translations with ONE prompt for both conditions.
//
// Why: the B1 round gave condition B an extra "WHAT THE SYSTEM HEARD" block and
// told the judge that inherited ASR errors count against it. A swap probe showed
// the same translation flips verdict when only that block changes, so the
// published B numbers are an upper bound on the ASR cost, not the cost itself.
//
// This script re-judges every (pair, judge) cell with the A-style prompt only:
// authoritative source + candidate translation, no channel hint of any kind.
// Translations are NOT re-run; they are read from the frozen B1 record.
//
// Modes:
//   node rejudge.js --dry            print prompts/sha/count, no network
//   node rejudge.js --run --cap=0.09 run, stop before exceeding cap USD
//   node rejudge.js --check          recompute report from records on disk
//
// Secrets are read into memory only and never written or printed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const B1 = path.join(ROOT, 'e2e-b1-text-mt-20261114');
const REPO = '/Users/belliedmonkey/OpenBot/Agents/agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc/work/repo';
const EXP = path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113');
const INPUT = path.join(EXP, 'records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';

const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const PROMPT_VERSION = 'unified-v1';

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function log(m) {
  const line = new Date().toISOString() + ' ' + m;
  process.stdout.write(line + '\n');
  fs.mkdirSync(path.join(__dirname, 'ledger'), { recursive: true });
  fs.appendFileSync(path.join(__dirname, 'ledger', 'progress.log'), line + '\n');
}

function loadKeys() {
  const out = {};
  for (const ln of fs.readFileSync(KEYS, 'utf8').split(/\r?\n/)) {
    const m = ln.trim().replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_.-]{1,80})\s*[=:]\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function loadTranslations() {
  const dir = path.join(B1, 'out', 'translation');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const rows = files.map((f) => readJson(path.join(dir, f)));
  if (rows.length !== 72) throw new Error('expected 72 frozen translations, found ' + rows.length);
  for (const r of rows) {
    if (!r.ok || !r.translation) throw new Error('frozen translation not usable: ' + r.pairId);
    if (!r.reasoning || r.reasoning.enable_thinking !== false) throw new Error('frozen translation not product-口径: ' + r.pairId);
  }
  return rows;
}

const GOLD = new Map();
function loadGold() {
  const input = readJson(INPUT);
  for (const it of (input.items || input)) GOLD.set(it.id, it.reference);
  return GOLD;
}

// One prompt for every pair, in both conditions. No channel hint, no ASR text,
// no sentence about inherited errors.
function judgePromptText(targetLang, gold, translation) {
  const parts = [
    'You are a bilingual translation reviewer. Judge whether the candidate translation delivers the meaning of the AUTHORITATIVE SOURCE.',
    'Answer only with JSON, no prose.',
    '',
    'AUTHORITATIVE SOURCE (' + (targetLang === 'en' ? 'Chinese' : 'English') + '):',
    gold,
    '',
    'CANDIDATE TRANSLATION (' + targetLang + '):',
    translation,
    '',
    'Return exactly this JSON shape:',
    '{"schema":"belliedmonkey.llm-judge.mt.v1","dimensions":{'
      + DIMS.map((d) => '"' + d + '":{"pass":true,"note":"short"}').join(',')
      + '},"findings":[{"dimension":"meaning","sourceQuote":"...","targetQuote":"...","reason":"..."}]}',
    '',
    'Rules:',
    '- meaning: the authoritative message survives; no added or dropped proposition.',
    '- entities_numbers: names, places, brands and numbers from the authoritative source are preserved or correctly rendered.',
    '- negation: polarity of the authoritative source is preserved.',
    '- omission: nothing material from the authoritative source is left out.',
    '- hallucination: nothing is invented that the authoritative source does not support.',
    '- terminology: domain terms are translated consistently and sensibly.',
    '- fluency: the target reads naturally to a native reader.',
    '- A dimension passes only when you find no real defect in it. Formatting-only differences pass.',
    '- findings: at most 3, each quoting the exact source and target span. Empty array if all pass.',
    '- Do not judge style preference and do not compare against any reference translation.',
  ];
  return parts.join('\n');
}

function judgePrompt(row) {
  const gold = GOLD.get(row.itemId);
  if (!gold) throw new Error('no gold reference for ' + row.itemId);
  return judgePromptText(row.targetLang, gold, row.translation);
}

function promptSkeletonSha() {
  return sha(judgePromptText('en', '{gold}', '{candidate}'));
}

async function postJson(url, key, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, ok: res.ok, json, text };
}

function parseVerdict(content) {
  if (typeof content !== 'string') return { verdict: null, code: 'no-content' };
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return { verdict: null, code: 'bad-json' };
  let d;
  try { d = JSON.parse(m[0]); } catch (_) { return { verdict: null, code: 'bad-json' }; }
  if (!d || d.schema !== 'belliedmonkey.llm-judge.mt.v1' || !d.dimensions) return { verdict: null, code: 'bad-schema' };
  const clean = {};
  for (const dim of DIMS) {
    const v = d.dimensions[dim];
    if (!v || typeof v.pass !== 'boolean') return { verdict: null, code: 'missing-dim:' + dim };
    clean[dim] = { pass: v.pass, note: typeof v.note === 'string' ? v.note.slice(0, 200) : '' };
  }
  return {
    verdict: { dimensions: clean, findings: Array.isArray(d.findings) ? d.findings.slice(0, 3) : [] },
    code: 'parsed',
  };
}

async function run(rows, capUsd) {
  const keys = loadKeys();
  const key = keys.key_chat_custom_chat;
  if (!key) throw new Error('key_chat_custom_chat missing');
  const dir = path.join(__dirname, 'out', 'judge-unified');
  fs.mkdirSync(dir, { recursive: true });
  let spent = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const r = readJson(path.join(dir, f));
    if (Number.isFinite(r.providerUsd)) spent += r.providerUsd;
  }
  log('resume: ' + fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length + ' records on disk, spent so far ' + spent.toFixed(8));

  const results = [];
  for (const row of rows) {
    for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
      const name = (row.pairId + '_' + judgeId).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
      const p = path.join(dir, name);
      if (fs.existsSync(p)) { results.push(readJson(p)); continue; }
      if (spent >= capUsd) {
        log('CAP REACHED at ' + spent.toFixed(8) + ' USD, stopping before ' + row.pairId + ' ' + judgeId);
        return { results, spent, capped: true };
      }
      const prompt = judgePrompt(row);
      const body = {
        model, temperature: 0,
        messages: [
          { role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' },
          { role: 'user', content: prompt },
        ],
      };
      let rec = null;
      for (let attempt = 0; attempt < 3 && !rec; attempt++) {
        let r;
        try {
          r = await postJson(OPENROUTER, key, body);
        } catch (err) {
          await new Promise((s) => setTimeout(s, 2500 * (attempt + 1)));
          continue;
        }
        const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
        const parsed = parseVerdict(content);
        const usd = (r.json && Number.isFinite(r.json.usage && r.json.usage.cost)) ? r.json.usage.cost : null;
        rec = {
          schema: 'belliedmonkey.e2e-b1b.judge-record.v1',
          promptVersion: PROMPT_VERSION,
          pairId: row.pairId, itemId: row.itemId, condition: row.condition, judgeId, model,
          promptSha256: sha(prompt),
          httpStatus: r.status,
          ok: !!parsed.verdict, parseCode: parsed.code, verdict: parsed.verdict,
          finishReason: (r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason) || null,
          usage: (r.json && r.json.usage) || null,
          providerUsd: usd,
        };
        if (usd) spent += usd;
        if (!rec.ok && attempt < 2) await new Promise((s) => setTimeout(s, 2000 * (attempt + 1)));
      }
      writeJson(p, rec);
      results.push(rec);
      log('judge ' + row.pairId + ' ' + judgeId + ' ok=' + rec.ok + ' ' + rec.parseCode + ' usd=' + (rec.providerUsd == null ? '?' : rec.providerUsd));
    }
  }
  return { results, spent, capped: false };
}

const DIMS_L = DIMS;
function report(rows, judges) {
  const byPair = new Map();
  for (const j of judges) {
    if (!j.verdict) continue;
    if (!byPair.has(j.pairId)) byPair.set(j.pairId, {});
    byPair.get(j.pairId)[j.judgeId] = j.verdict;
  }
  const per = {};
  for (const cond of ['A', 'B']) {
    per[cond] = { verdicts: 0, allPass: 0, dims: {} };
    for (const d of DIMS) per[cond].dims[d] = { pass: 0, total: 0 };
  }
  for (const j of judges) {
    if (!j.verdict) continue;
    const c = j.condition;
    per[c].verdicts += 1;
    let all = true;
    for (const d of DIMS) {
      per[c].dims[d].total += 1;
      if (j.verdict.dimensions[d].pass) per[c].dims[d].pass += 1;
      else all = false;
    }
    if (all) per[c].allPass += 1;
  }
  // Pair level: a pair passes only if both judges pass every dimension.
  const pairLevel = {};
  for (const cond of ['A', 'B']) pairLevel[cond] = { pairs: 0, bothJudgesAllPass: 0, anyJudgeAllPass: 0, eitherJudgeFails: 0 };
  for (const row of rows) {
    const v = byPair.get(row.pairId);
    if (!v || !v['judge-a'] || !v['judge-b']) continue;
    pairLevel[row.condition].pairs += 1;
    const a = DIMS.every((d) => v['judge-a'].dimensions[d].pass);
    const b = DIMS.every((d) => v['judge-b'].dimensions[d].pass);
    if (a && b) pairLevel[row.condition].bothJudgesAllPass += 1;
    if (a || b) pairLevel[row.condition].anyJudgeAllPass += 1;
    if (!a || !b) pairLevel[row.condition].eitherJudgeFails += 1;
  }
  let agree = 0, disagree = 0;
  for (const row of rows) {
    const v = byPair.get(row.pairId);
    if (!v || !v['judge-a'] || !v['judge-b']) continue;
    const same = DIMS.every((d) => v['judge-a'].dimensions[d].pass === v['judge-b'].dimensions[d].pass);
    if (same) agree += 1; else disagree += 1;
  }
  const usd = judges.reduce((a, j) => a + (Number.isFinite(j.providerUsd) ? j.providerUsd : 0), 0);
  return {
    schema: 'belliedmonkey.e2e-b1b.report.v1',
    promptVersion: PROMPT_VERSION,
    promptSkeletonSha256: promptSkeletonSha(),
    perCondition: per,
    pairLevel,
    judgeAgreement: { pairs: agree + disagree, agree, disagree },
    calls: judges.length,
    parsed: judges.filter((j) => j.ok).length,
    providerUsd: Math.round(usd * 1e8) / 1e8,
  };
}

function check() {
  const rows = loadTranslations();
  loadGold();
  const dir = path.join(__dirname, 'out', 'judge-unified');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const judges = files.map((f) => readJson(path.join(dir, f)));
  const rep = report(rows, judges);
  writeJson(path.join(__dirname, 'out', 'unified-report.json'), rep);
  return { rep, rows, judges };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const runFlag = args.includes('--run');
  const checkFlag = args.includes('--check');
  const capArg = args.filter((a) => a.startsWith('--cap='))[0];
  const cap = capArg ? Number(capArg.split('=')[1]) : 0.09;

  const rows = loadTranslations();
  loadGold();
  if (dry) {
    const prompts = rows.map((r) => judgePrompt(r));
    const shas = new Set(prompts.map((p) => sha(p)));
    const guard = prompts.filter((p) => /system heard|automatic speech recognition|inherited/i.test(p));
    log('DRY rows=' + rows.length + ' judges=' + Object.keys(JUDGE_MODELS).length +
        ' calls=' + rows.length * Object.keys(JUDGE_MODELS).length +
        ' prompts=' + prompts.length + ' uniquePromptSha=' + shas.size +
        ' channelHintsInPrompt=' + guard.length);
    if (guard.length) throw new Error('prompt still contains a channel hint');
    for (const p of prompts.slice(0, 1)) console.log('\n--- sample prompt ---\n' + p);
    return;
  }
  if (checkFlag) {
    const { rep } = check();
    log('CHECK calls=' + rep.calls + ' parsed=' + rep.parsed + ' usd=' + rep.providerUsd);
    console.log(JSON.stringify(rep, null, 2));
    return;
  }
  if (runFlag) {
    const { results, spent, capped } = await run(rows, cap);
    const rep = report(rows, results);
    writeJson(path.join(__dirname, 'out', 'unified-report.json'), rep);
    log('RUN done calls=' + rep.calls + ' parsed=' + rep.parsed + ' usd=' + rep.providerUsd +
        ' capped=' + capped + ' spent=' + spent.toFixed(8));
    console.log(JSON.stringify(rep.perCondition, null, 2));
    return;
  }
  console.log('usage: node rejudge.js --dry | --run [--cap=0.09] | --check');
}

main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
