'use strict';
// B2 chain: audio -> product SpeechAnalyzer -> product translation -> checks.
//
// The ASR stage is the reviewed-36 runner's SpeechAnalyzer backend (macOS,
// on-device). Its hypotheses are copied into input/ from the run directory; this
// script never invokes the ASR itself, so the record stays reproducible without
// the runner.
//
// Modes:
//   node chain.js --translate            translate the 36 SA hypotheses (product prompt/model)
//   node chain.js --compare              compare with the frozen B1 B translations
//   node chain.js --check                deterministic entity/number check over B and A
//
// Secrets are read in memory only and never written or printed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const B1 = path.join(HERE, '..', 'e2e-b1-text-mt-20261114');
const REPO = '/Users/belliedmonkey/OpenBot/Agents/agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc/work/repo';
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const CHAT_MODEL = 'qwen3.7-plus';
const CHAT_URL = 'https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions';
const { checkPair } = require('../../checks/entity-check.js');
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/qa/checks/glossary-reviewed-36.json'), 'utf8')).terms;

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
const LANG_NAME = { en: 'English', 'zh-CN': '简体中文' };

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function log(m) { process.stdout.write(new Date().toISOString() + ' ' + m + '\n'); }

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

function productReasoningFragment() {
  const src = fs.readFileSync(path.join(REPO, 'extension/content/providers.gen.js'), 'utf8');
  const m = src.match(/window\.MT_MODEL_PARAMS = (\[[\s\S]*?\]);/);
  if (!m) throw new Error('MT_MODEL_PARAMS missing');
  const row = JSON.parse(m[1]).filter((r) => r.id === 'qwencloud')[0];
  if (!row || !row.reasoning || row.reasoning.enable_thinking !== false) {
    throw new Error('qwencloud reasoning fragment changed');
  }
  return row.reasoning;
}

function targetFor(id) { return id.indexOf('en_us') !== -1 ? 'zh-CN' : 'en'; }

async function postJson(url, key, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, ok: res.ok, json, text };
}

function hypotheses() {
  const h = readJson(path.join(HERE, 'input', 'hypotheses.json'));
  if (!Array.isArray(h) || h.length !== 36) throw new Error('expected 36 hypotheses');
  return h;
}

async function translate() {
  const keys = loadKeys();
  if (!keys.key_chat_qwencloud_global) throw new Error('qwencloud key missing');
  const reasoning = productReasoningFragment();
  const dir = path.join(HERE, 'out', 'translation');
  fs.mkdirSync(dir, { recursive: true });
  const hs = hypotheses();
  const results = [];
  for (const row of hs) {
    const id = row.id;
    const targetLang = targetFor(id);
    const name = id.replace(/[^A-Za-z0-9._-]+/g, '_') + '_B.json';
    const p = path.join(dir, name);
    if (fs.existsSync(p)) { results.push(readJson(p)); continue; }
    const system = SYSTEM_TEMPLATE.replace('{NAME}', LANG_NAME[targetLang]);
    const body = Object.assign({
      model: CHAT_MODEL, temperature: 0,
      messages: [{ role: 'system', content: system }, { role: 'user', content: row.hypothesis }],
    }, reasoning);
    const t0 = Date.now();
    let rec = null;
    for (let attempt = 0; attempt < 4 && !rec; attempt++) {
      let r;
      try { r = await postJson(CHAT_URL, keys.key_chat_qwencloud_global, body); }
      catch (_) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
      const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      rec = {
        schema: 'belliedmonkey.e2e-b2.chain-translation.v1',
        itemId: id, condition: 'B', targetLang, sourceKind: 'sa_hypothesis',
        source: row.hypothesis, translation: typeof content === 'string' ? content.trim() : null,
        ok: r.ok && typeof content === 'string', httpStatus: r.status,
        systemPromptSha256: sha(system), model: CHAT_MODEL, reasoning,
        latencyMs: Date.now() - t0,
        usage: (r.json && r.json.usage) || null,
        error: r.ok ? null : String(r.text).slice(0, 160),
      };
      if (!rec.ok) await new Promise((s) => setTimeout(s, 2000 * (attempt + 1)));
    }
    writeJson(p, rec);
    results.push(rec);
    log('translate ' + id + ' ok=' + rec.ok + ' ' + rec.latencyMs + 'ms');
  }
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  writeJson(path.join(HERE, 'out', 'translation-summary.json'), {
    schema: 'belliedmonkey.e2e-b2.chain-translation-summary.v1',
    n: results.length, ok: results.filter((r) => r.ok).length,
    latencyMs: { min: lat[0], p50: lat[Math.floor(lat.length / 2)], p90: lat[Math.floor(lat.length * 0.9)], max: lat[lat.length - 1] },
    promptSha256: sha(SYSTEM_TEMPLATE),
  });
  log('translated ' + results.length);
}

function compare() {
  const dir = path.join(HERE, 'out', 'translation');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const same = [], diff = [];
  for (const f of files) {
    const r = readJson(path.join(dir, f));
    const oldName = r.itemId.replace(/[^A-Za-z0-9._-]+/g, '_') + '_B.json';
    const oldPath = path.join(B1, 'out', 'translation', oldName);
    if (!fs.existsSync(oldPath)) { diff.push({ itemId: r.itemId, reason: 'no frozen translation' }); continue; }
    const o = readJson(oldPath);
    if (o.translation === r.translation) same.push(r.itemId);
    else diff.push({ itemId: r.itemId, reason: 'text differs', frozen: o.translation, fresh: r.translation });
  }
  writeJson(path.join(HERE, 'out', 'compare-frozen.json'), {
    schema: 'belliedmonkey.e2e-b2.compare.v1',
    n: files.length, identical: same.length, differing: diff.length, diffs: diff,
  });
  log('identical ' + same.length + '/' + files.length + ' differ ' + diff.length);
}

function check() {
  const gold = new Map();
  const inp = readJson(path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113/records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json'));
  for (const it of (inp.items || inp)) gold.set(it.id, it.reference);
  const dir = path.join(HERE, 'out', 'translation');
  // Check against the authoritative source, the same text the judges see.
  const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f)))
    .filter((r) => r.translation)
    .map((r) => ({ itemId: r.itemId, condition: 'B', source: gold.get(r.itemId), translation: r.translation, targetLang: r.targetLang }));
  for (const r of fs.readdirSync(path.join(B1, 'out', 'translation')).filter((f) => f.endsWith('.json'))) {
    const t = readJson(path.join(B1, 'out', 'translation', r));
    if (!t.pairId.endsWith('|A')) continue;
    rows.push({ itemId: t.itemId, condition: 'A', source: t.source, translation: t.translation, targetLang: t.targetLang });
  }
  const results = rows.map((r) => Object.assign({ itemId: r.itemId, condition: r.condition }, checkPair({
    source: r.source, translation: r.translation, targetLang: r.targetLang, glossary: GLOSSARY,
  })));
  const byStatus = { ok: 0, warn: 0, fail: 0 };
  for (const r of results) byStatus[r.status]++;
  writeJson(path.join(HERE, 'out', 'entity-check.json'), {
    schema: 'belliedmonkey.e2e-b2.entity-check.v1',
    glossary: 'docs/qa/checks/glossary-reviewed-36.json',
    n: results.length, byStatus, results,
  });
  log('entity check ' + JSON.stringify(byStatus));
  for (const r of results.filter((x) => x.status !== 'ok')) {
    log((r.status === 'fail' ? 'FAIL ' : 'WARN ') + r.condition + ' ' + r.itemId +
      ' numbers=' + JSON.stringify(r.missingNumbers) + ' terms=' + JSON.stringify(r.missingTerms));
  }
}

const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const B1B_REPORT = path.join(HERE, '..', 'e2e-b1b-unified-judge-20261118', 'out', 'unified-report.json');

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
  return { verdict: { dimensions: clean, findings: Array.isArray(d.findings) ? d.findings.slice(0, 3) : [] }, code: 'parsed' };
}

async function judge() {
  const keys = loadKeys();
  if (!keys.key_chat_custom_chat) throw new Error('openrouter key missing');
  // Same instrument as B1b: fail loudly if the prompt skeleton moved.
  const expected = readJson(B1B_REPORT).promptSkeletonSha256;
  const mine = sha(judgePromptText('en', '{gold}', '{candidate}'));
  if (mine !== expected) throw new Error('prompt drift: ' + mine + ' vs ' + expected);
  const gold = new Map();
  const inp = readJson(path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113/records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json'));
  for (const it of (inp.items || inp)) gold.set(it.id, it.reference);
  const dir = path.join(HERE, 'out', 'judge');
  fs.mkdirSync(dir, { recursive: true });
  const trs = fs.readdirSync(path.join(HERE, 'out', 'translation')).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(HERE, 'out', 'translation', f))).filter((r) => r.translation);
  let spent = 0;
  const results = [];
  for (const t of trs) {
    for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
      const name = t.itemId.replace(/[^A-Za-z0-9._-]+/g, '_') + '_B_' + judgeId + '.json';
      const p = path.join(dir, name);
      if (fs.existsSync(p)) { const r = readJson(p); results.push(r); spent += r.providerUsd || 0; continue; }
      const prompt = judgePromptText(t.targetLang, gold.get(t.itemId), t.translation);
      const body = { model, temperature: 0, messages: [{ role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' }, { role: 'user', content: prompt }] };
      let rec = null;
      for (let attempt = 0; attempt < 3 && !rec; attempt++) {
        let r;
        try { r = await postJson(OPENROUTER, keys.key_chat_custom_chat, body); }
        catch (_) { await new Promise((s) => setTimeout(s, 2000)); continue; }
        const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
        const parsed = parseVerdict(content);
        const usd = (r.json && Number.isFinite(r.json.usage && r.json.usage.cost)) ? r.json.usage.cost : null;
        if (usd) spent += usd;
        rec = {
          schema: 'belliedmonkey.e2e-b2.chain-judge.v1', promptVersion: 'unified-v1',
          promptSkeletonSha256: mine, itemId: t.itemId, condition: 'B', judgeId, model,
          promptSha256: sha(prompt), httpStatus: r.status, ok: !!parsed.verdict, parseCode: parsed.code,
          verdict: parsed.verdict, usage: (r.json && r.json.usage) || null, providerUsd: usd,
        };
        if (!rec.ok && attempt < 2) await new Promise((s) => setTimeout(s, 1500));
      }
      writeJson(p, rec);
      results.push(rec);
      log('judge ' + t.itemId + ' ' + judgeId + ' ok=' + rec.ok + ' usd=' + rec.providerUsd);
    }
  }
  const by = new Map();
  for (const r of results) if (r.verdict) { if (!by.has(r.itemId)) by.set(r.itemId, {}); by.get(r.itemId)[r.judgeId] = r.verdict; }
  let both = 0, fail = 0, pairs = 0;
  for (const [, v] of by) {
    if (!v['judge-a'] || !v['judge-b']) continue;
    pairs++;
    const ok = DIMS.every((d) => v['judge-a'].dimensions[d].pass) && DIMS.every((d) => v['judge-b'].dimensions[d].pass);
    if (ok) both++; else fail++;
  }
  writeJson(path.join(HERE, 'out', 'judge-summary.json'), {
    schema: 'belliedmonkey.e2e-b2.judge-summary.v1', calls: results.length,
    parsed: results.filter((r) => r.ok).length, pairs, bothPass: both, anyFail: fail,
    providerUsd: Math.round(spent * 1e8) / 1e8,
  });
  log('judge done pairs=' + pairs + ' bothPass=' + both + ' usd=' + spent.toFixed(8));
}

const mode = (process.argv[2] || '').replace(/^--/, '');
if (mode === 'translate') translate().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
else if (mode === 'compare') compare();
else if (mode === 'check') check();
else if (mode === 'judge') judge().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
else console.log('usage: node chain.js --translate | --compare | --check');
