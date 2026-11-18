'use strict';
// Judge every t0 translation sample of the 6 probe items (no new translation spend).
// Purpose: how often does the item-level verdict flip across translation samples?

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const OUT = path.join(__dirname, '..', 'out');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const EXPECTED_SKELETON = '2fa67bbeecf7198bdb9096d4361b400588511f6794ae243a5c3a9cbf6ca56e50';

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function log(m) { process.stdout.write(new Date().toISOString() + ' ' + m + '\n'); }
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

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
  return { verdict: { dimensions: clean }, code: 'parsed' };
}

async function callJudge(key, model, prompt) {
  const body = { model, temperature: 0, messages: [{ role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' }, { role: 'user', content: prompt }] };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(OPENROUTER, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (_) {}
      const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      const parsed = parseVerdict(content);
      if (parsed.verdict) return { parsed, usage: (json && json.usage) || null, usd: (json && Number.isFinite(json.usage && json.usage.cost)) ? json.usage.cost : null };
      await sleep(1500);
    } catch (_) { await sleep(1500); }
  }
  return { parsed: { verdict: null, code: 'transport' }, usage: null, usd: null };
}

async function main() {
  const mine = sha(judgePromptText('en', '{gold}', '{candidate}'));
  if (mine !== EXPECTED_SKELETON) throw new Error('prompt drift: ' + mine);
  const keys = loadKeys();
  const gold = new Map();
  const inp = readJson(path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113/records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json'));
  for (const it of (inp.items || inp)) gold.set(it.id, it.reference);

  const calls = fs.existsSync(path.join(OUT, 'calls'))
    ? fs.readdirSync(path.join(OUT, 'calls')).map((f) => readJson(path.join(OUT, 'calls', f)))
    : fs.readFileSync(path.join(OUT, 'seed-calls.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const t0 = calls.filter((r) => r.ok && r.condition === 't0');
  const byItem = new Map();
  for (const c of t0) { if (!byItem.has(c.itemId)) byItem.set(c.itemId, []); byItem.get(c.itemId).push(c); }

  const outDir = path.join(OUT, 'sample-judge');
  fs.mkdirSync(outDir, { recursive: true });
  const records = [];
  let spent = 0;
  for (const [itemId, samples] of byItem) {
    const targetLang = itemId.indexOf('en_us') !== -1 ? 'zh-CN' : 'en';
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si];
      const prompt = judgePromptText(targetLang, gold.get(itemId), s.output);
      for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
        const name = itemId.replace(/[^A-Za-z0-9._-]+/g, '_') + '_s' + si + '_' + judgeId + '.json';
        const p = path.join(outDir, name);
        if (fs.existsSync(p)) { const r = readJson(p); records.push(r); spent += r.providerUsd || 0; continue; }
        const got = await callJudge(keys.key_chat_custom_chat, model, prompt);
        if (got.usd) spent += got.usd;
        const rec = {
          schema: 'belliedmonkey.seed-probe.sample-judge.v1', promptSkeletonSha256: mine,
          itemId, sampleIndex: si, translationSha256: s.outputSha256, judgeId, model,
          ok: !!got.parsed.verdict, parseCode: got.parsed.code, verdict: got.parsed.verdict,
          usage: got.usage, providerUsd: got.usd,
        };
        writeJson(p, rec);
        records.push(rec);
        log(itemId.split('/').slice(-2).join('/') + ' s' + si + ' ' + judgeId + ' ok=' + rec.ok + ' usd=' + rec.providerUsd);
      }
    }
  }

  // Per item: sample-level both-judge pass, then majority thresholds.
  const grid = new Map();
  for (const r of records) {
    if (!r.verdict) continue;
    const k = r.itemId + '|' + r.sampleIndex;
    if (!grid.has(k)) grid.set(k, {});
    grid.get(k)[r.judgeId] = r.verdict;
  }
  const rows = [];
  for (const [itemId, samples] of byItem) {
    const passes = [];
    for (let si = 0; si < samples.length; si++) {
      const v = grid.get(itemId + '|' + si);
      if (!v || !v['judge-a'] || !v['judge-b']) { passes.push(null); continue; }
      passes.push(DIMS.every((d) => v['judge-a'].dimensions[d].pass) && DIMS.every((d) => v['judge-b'].dimensions[d].pass));
    }
    const judged = passes.filter((x) => x !== null);
    const passN = judged.filter(Boolean).length;
    rows.push({
      itemId, samplesJudged: judged.length,
      perSamplePass: passes,
      passCount: passN, failCount: judged.length - passN,
      samplePassRate: judged.length ? passN / judged.length : null,
      majority3: judged.length >= 3 ? (passN / judged.length > 0.5) : null,
      unanimous: judged.length ? (passN === judged.length || passN === 0) : null,
    });
  }
  fs.writeFileSync(path.join(OUT, 'sample-judge-calls.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeJson(path.join(OUT, 'sample-judge-summary.json'), {
    schema: 'belliedmonkey.seed-probe.sample-judge-summary.v1',
    promptSkeletonSha256: mine, judges: JUDGE_MODELS,
    items: rows, calls: records.length, providerUsd: Math.round(spent * 1e8) / 1e8,
  });
  for (const r of rows) log(r.itemId.split('/').slice(-2).join('/') + ' pass ' + r.passCount + '/' + r.samplesJudged + ' plural=' + JSON.stringify(r.perSamplePass));
  log('done calls=' + records.length + ' usd=' + spent.toFixed(8));
}

main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
