'use strict';
// B1 text-translation baseline. Two conditions on the same 36 frozen items:
//   A = gold transcript as source, B = product SA hypothesis as source.
// Translation uses the product's own system prompt and the product's pinned chat model.
// Judging is two independent models with a translation rubric. No retries.
// Secrets are read in memory only and never written or printed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const REPO = '/Users/belliedmonkey/OpenBot/Agents/agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc/work/repo';
const EXP = path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113');
const INPUT = path.join(EXP, 'records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json');
const HYP = path.join(EXP, 'records/01-sa-official-aef9aa8f/sa-smoke-aef9aa8f-r1/hypotheses.json');
const PROMPT_SRC = path.join(REPO, 'extension/content/translation-api.js');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';

const CHAT_MODEL = 'qwen3.7-plus';
const CHAT_URL = 'https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions';
const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];

const SYSTEM_TEMPLATE = [
  "You are a professional translator. Translate the user's text into {NAME}.",
  'Rules:',
  '1. Output ONLY the translation — no explanations, notes, or extra content.',
  '2. Preserve the original formatting and line breaks.',
  '3. Keep code, URLs, and well-known brand / product / company names unchanged, but',
  '   DO translate ordinary words, place names, and loanwords (including katakana) —',
  '   never leave foreign-script text untranslated.',
  '4. Make the translation natural and fluent in the target language.',
].join('\n');

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function log(m) {
  const line = new Date().toISOString() + ' ' + m + '\n';
  fs.mkdirSync(path.join(ROOT, 'ledger'), { recursive: true });
  fs.appendFileSync(path.join(ROOT, 'ledger', 'progress.log'), line);
  process.stdout.write(line);
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

function assertPromptMatchesRepo() {
  const src = fs.readFileSync(PROMPT_SRC, 'utf8');
  for (const line of SYSTEM_TEMPLATE.split('\n')) {
    const needle = line.replace('{NAME}', '${name}');
    const probe = line.includes('{NAME}') ? 'Translate the user\'s text into ${name}.' : line;
    if (!src.includes(probe)) throw new Error('prompt line not found in repo: ' + line.slice(0, 40));
  }
  if (!src.includes('function buildSystemPrompt(targetLang)')) throw new Error('buildSystemPrompt missing');
}

const LANG_NAME = { en: 'English', 'zh-CN': '简体中文' };

function systemPromptFor(targetLang) {
  return SYSTEM_TEMPLATE.replace('{NAME}', LANG_NAME[targetLang] || targetLang);
}

function targetFor(itemId) {
  if (itemId.indexOf('en_us') !== -1) return 'zh-CN';
  return 'en';
}

function buildInputs() {
  const input = readJson(INPUT);
  const items = input.items || input;
  const hyps = new Map(readJson(HYP).map((r) => [r.id, r.hypothesis]));
  const rows = [];
  for (const it of items) {
    const target = targetFor(it.id);
    rows.push({ pairId: it.id + '|A', itemId: it.id, condition: 'A', source: it.reference, sourceKind: 'reference', targetLang: target });
    const h = hyps.get(it.id);
    if (typeof h !== 'string' || !h.trim()) throw new Error('missing hypothesis for ' + it.id);
    rows.push({ pairId: it.id + '|B', itemId: it.id, condition: 'B', source: h, sourceKind: 'sa_hypothesis', targetLang: target });
  }
  return rows;
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

async function translate(rows, keys) {
  const dir = path.join(ROOT, 'out', 'translation');
  fs.mkdirSync(dir, { recursive: true });
  const done = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  const out = [];
  for (const row of rows) {
    const name = row.pairId.replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
    if (done.has(name)) { out.push(readJson(path.join(dir, name))); continue; }
    const body = {
      model: CHAT_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPromptFor(row.targetLang) },
        { role: 'user', content: row.source },
      ],
    };
    let rec = null;
    for (let attempt = 0; attempt < 5 && !rec; attempt++) {
      let r;
      try {
        r = await postJson(CHAT_URL, keys.key_chat_qwencloud_global, body);
      } catch (err) {
        await new Promise((s) => setTimeout(s, 3000 * (attempt + 1)));
        continue;
      }
      const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      rec = {
        pairId: row.pairId, itemId: row.itemId, condition: row.condition, sourceKind: row.sourceKind,
        targetLang: row.targetLang, source: row.source, systemPromptSha256: sha(systemPromptFor(row.targetLang)),
        model: CHAT_MODEL, httpStatus: r.status, ok: r.ok && typeof content === 'string',
        translation: typeof content === 'string' ? content.trim() : null,
        finishReason: r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason || null,
        usage: r.json && r.json.usage || null,
        error: r.ok ? null : String(r.text).slice(0, 200),
      };
      if (!rec.ok) await new Promise((s) => setTimeout(s, 3000 * (attempt + 1)));
    }
    writeJson(path.join(dir, name), rec);
    out.push(rec);
    log('translate ' + row.pairId + ' ok=' + rec.ok);
  }
  return out;
}

function judgePrompt(row, gold) {
  const parts = [
    'You are a bilingual translation reviewer. Judge whether the candidate translation delivers the meaning of the AUTHORITATIVE SOURCE.',
    'Answer only with JSON, no prose.',
    '',
    'AUTHORITATIVE SOURCE (' + (row.targetLang === 'en' ? 'Chinese' : 'English') + '):',
    gold,
    '',
  ];
  if (row.condition === 'B') {
    parts.push('WHAT THE SYSTEM HEARD (automatic speech recognition output, may contain recognition errors):');
    parts.push(row.source);
    parts.push('');
    parts.push('The candidate was produced from the text above, so recognition errors it inherited count against it.');
    parts.push('');
  }
  parts.push('CANDIDATE TRANSLATION (' + row.targetLang + '):');
  parts.push(row.translation);
  parts.push('');
  parts.push('Return exactly this JSON shape:');
  parts.push('{"schema":"belliedmonkey.llm-judge.mt.v1","dimensions":{'
    + DIMS.map((d) => '"' + d + '":{"pass":true,"note":"short"}').join(',')
    + '},"findings":[{"dimension":"meaning","sourceQuote":"...","targetQuote":"...","reason":"..."}]}');
  parts.push('');
  parts.push('Rules:');
  parts.push('- meaning: the authoritative message survives; no added or dropped proposition.');
  parts.push('- entities_numbers: names, places, brands and numbers from the authoritative source are preserved or correctly rendered.');
  parts.push('- negation: polarity of the authoritative source is preserved.');
  parts.push('- omission: nothing material from the authoritative source is left out.');
  parts.push('- hallucination: nothing is invented that the authoritative source does not support.');
  parts.push('- terminology: domain terms are translated consistently and sensibly.');
  parts.push('- fluency: the target reads naturally to a native reader.');
  parts.push('- A dimension passes only when you find no real defect in it. Formatting-only differences pass.');
  parts.push('- findings: at most 3, each quoting the exact source and target span. Empty array if all pass.');
  parts.push('- Do not judge style preference and do not compare against any reference translation.');
  return parts.join('\n');
}

const GOLD = new Map();
function goldOf(itemId) {
  if (!GOLD.size) {
    const input = readJson(INPUT);
    for (const it of (input.items || input)) GOLD.set(it.id, it.reference);
  }
  return GOLD.get(itemId) || '';
}

async function judge(rows, keys) {
  const dir = path.join(ROOT, 'out', 'judge-v2');
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const row of rows) {
    if (!row.translation) continue;
    for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
      const name = (row.pairId + '_' + judgeId).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
      const p = path.join(dir, name);
      if (fs.existsSync(p)) { results.push(readJson(p)); continue; }
      const body = {
        model, temperature: 0,
        messages: [
          { role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' },
          { role: 'user', content: judgePrompt(row, goldOf(row.itemId)) },
        ],
      };
      let rec = null;
      for (let attempt = 0; attempt < 5 && !rec; attempt++) {
        let r;
        try {
          r = await postJson(OPENROUTER, keys.key_chat_custom_chat, body);
        } catch (err) {
          await new Promise((s) => setTimeout(s, 3000 * (attempt + 1)));
          continue;
        }
        const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
        let verdict = null;
        let parseCode = 'bad-json';
        if (typeof content === 'string') {
          const m = content.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              const d = JSON.parse(m[0]);
              if (d && d.schema === 'belliedmonkey.llm-judge.mt.v1' && d.dimensions) {
                const clean = {};
                let all = true;
                for (const dim of DIMS) {
                  const v = d.dimensions[dim];
                  if (!v || typeof v.pass !== 'boolean') { all = false; break; }
                  clean[dim] = { pass: v.pass, note: typeof v.note === 'string' ? v.note.slice(0, 200) : '' };
                }
                if (all) { verdict = { dimensions: clean, findings: Array.isArray(d.findings) ? d.findings.slice(0, 3) : [] }; parseCode = 'parsed'; }
              }
            } catch (_) {}
          }
        }
        const usage = r.json && r.json.usage || null;
        rec = {
          pairId: row.pairId, itemId: row.itemId, condition: row.condition, judgeId, model,
          httpStatus: r.status, ok: !!verdict, parseCode, verdict,
          finishReason: r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason || null,
          usage, providerUsd: (r.json && Number.isFinite(r.json.usage && r.json.usage.cost)) ? r.json.usage.cost : null,
        };
        if (!rec.ok) await new Promise((s) => setTimeout(s, 2500 * (attempt + 1)));
      }
      writeJson(p, rec);
      results.push(rec);
      log('judge ' + row.pairId + ' ' + judgeId + ' ok=' + rec.ok + ' ' + rec.parseCode);
    }
  }
  return results;
}

function report(rows, trans, judges) {
  const per = {};
  for (const cond of ['A', 'B']) {
    per[cond] = { items: 0, translated: 0, judged: 0, dims: {}, allPass: 0, verdicts: 0 };
    for (const d of DIMS) per[cond].dims[d] = { pass: 0, total: 0 };
  }
  const byPair = new Map();
  for (const j of judges) {
    if (!j.verdict) continue;
    const k = j.condition;
    per[k].verdicts += 1;
    let allPass = true;
    for (const d of DIMS) {
      per[k].dims[d].total += 1;
      if (j.verdict.dimensions[d].pass) per[k].dims[d].pass += 1;
      else allPass = false;
    }
    if (allPass) per[k].allPass += 1;
    if (!byPair.has(j.pairId)) byPair.set(j.pairId, {});
    byPair.get(j.pairId)[j.judgeId] = j.verdict;
  }
  for (const row of rows) {
    per[row.condition].items += 1;
    if (row.translation) per[row.condition].translated += 1;
  }
  let agree = 0, disagree = 0, bothFail = 0;
  for (const [, v] of byPair) {
    if (!v['judge-a'] || !v['judge-b']) continue;
    let same = true;
    for (const d of DIMS) if (v['judge-a'].dimensions[d].pass !== v['judge-b'].dimensions[d].pass) same = false;
    if (same) agree += 1; else { disagree += 1; if (!DIMS.every((d) => v['judge-a'].dimensions[d].pass) && !DIMS.every((d) => v['judge-b'].dimensions[d].pass)) bothFail += 1; }
  }
  const usage = judges.filter((j) => j.providerUsd != null);
  const judgeUsd = usage.reduce((a, j) => a + j.providerUsd, 0);
  return {
    perCondition: per, judgesPaired: agree + disagree, agree, disagree, bothJudgesFailedItem: bothFail,
    judgeCalls: judges.length, judgeParsed: judges.filter((j) => j.ok).length,
    judgeProviderUsd: Math.round(judgeUsd * 1e8) / 1e8,
    translations: trans.length, translated: trans.filter((t) => t.ok).length,
    promptSha256: sha(systemPromptFor('en')),
  };
}

async function main() {
  const cmd = process.argv[2] || 'all';
  assertPromptMatchesRepo();
  const keys = loadKeys();
  if (!keys.key_chat_qwencloud_global) throw new Error('missing qwencloud key');
  if (!keys.key_chat_custom_chat) throw new Error('missing openrouter key');
  let rows = buildInputs();
  const LIMIT = Number(process.env.LIMIT || 0);
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);
  writeJson(path.join(ROOT, 'input', 'b1-rows.json'), rows.map((r) => ({
    pairId: r.pairId, itemId: r.itemId, condition: r.condition, sourceKind: r.sourceKind, targetLang: r.targetLang,
  })));
  log('rows=' + rows.length + ' promptSha=' + sha(systemPromptFor('en')));

  let trans = [];
  if (cmd === 'translate' || cmd === 'all') {
    trans = await translate(rows, keys);
    writeJson(path.join(ROOT, 'ledger', 'translation-summary.json'), {
      rows: rows.length, ok: trans.filter((t) => t.ok).length,
      failed: trans.filter((t) => !t.ok).map((t) => t.pairId),
      model: CHAT_MODEL,
    });
  } else {
    const dir = path.join(ROOT, 'out', 'translation');
    trans = fs.readdirSync(dir).map((f) => readJson(path.join(dir, f)));
    trans.sort((a, b) => a.pairId.localeCompare(b.pairId));
  }

  if (cmd === 'judge' || cmd === 'all') {
    const judges = await judge(rows.map((r) => trans.find((t) => t.pairId === r.pairId) || r), keys);
    const rep = report(rows, trans, judges);
    writeJson(path.join(ROOT, 'ledger', 'b1-report.json'), rep);
    log('report ' + JSON.stringify({ agree: rep.agree, disagree: rep.disagree, parsed: rep.judgeParsed, usd: rep.judgeProviderUsd }));
  }
}

main().catch((e) => { log('crash: ' + e.message); process.exit(2); });
