'use strict';
// B1b, hard-set part: re-judge the four hard-set cases that appear in the human
// gold sheet, with the SAME unified prompt as the B1 re-judge.
//
// The prompt text is duplicated here on purpose, with an assertion that the
// derived skeleton sha matches the one recorded by rejudge.js. Any drift fails
// loudly instead of silently producing a different instrument.
//
// Usage: node rejudge-hardset.js --run

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const B1 = path.join(HERE, '..', 'e2e-b1-text-mt-20261114');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const PICK = readJson(path.join(HERE, '..', 'e2e-b1c-judge-gold-20261118', 'gold', 'MANIFEST.json')).hardsetPicked;

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function log(m) { const l = new Date().toISOString() + ' ' + m; console.log(l); fs.appendFileSync(path.join(HERE, 'ledger', 'hardset.log'), l + '\n'); }

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

function assertSameInstrument() {
  const rep = readJson(path.join(HERE, 'out', 'unified-report.json'));
  const mine = sha(judgePromptText('en', '{gold}', '{candidate}'));
  if (mine !== rep.promptSkeletonSha256) {
    throw new Error('prompt drift: hardset ' + mine + ' vs b1 ' + rep.promptSkeletonSha256);
  }
  return mine;
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

async function post(url, key, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  const instrument = assertSameInstrument();
  const keys = loadKeys();
  if (!keys.key_chat_custom_chat) throw new Error('openrouter key missing');
  const src = readJson(path.join(B1, 'hardset', 'sources.json')).items;
  const tr = fs.readdirSync(path.join(B1, 'hardset', 'out', 'translation'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(B1, 'hardset', 'out', 'translation', f)));
  const byKey = new Map(tr.map((r) => [r.lang + '_' + r.revid, r]));
  const dir = path.join(HERE, 'out', 'judge-hardset');
  fs.mkdirSync(dir, { recursive: true });
  let spent = 0;
  for (const key of PICK) {
    const t = byKey.get(key);
    if (!t || !t.ok) throw new Error('hard-set translation unusable: ' + key);
    const s = src.filter((x) => x.lang + '_' + x.revid === key)[0];
    if (!s) throw new Error('hard-set source missing: ' + key);
    for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
      const p = path.join(dir, key + '_' + judgeId + '.json');
      if (fs.existsSync(p)) { const r = readJson(p); spent += r.providerUsd || 0; continue; }
      const body = {
        model, temperature: 0,
        messages: [
          { role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' },
          { role: 'user', content: judgePromptText(t.targetLang, s.source, t.translation) },
        ],
      };
      const r = await post(OPENROUTER, keys.key_chat_custom_chat, body);
      const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      const parsed = parseVerdict(content);
      const usd = (r.json && Number.isFinite(r.json.usage && r.json.usage.cost)) ? r.json.usage.cost : null;
      if (usd) spent += usd;
      writeJson(p, {
        schema: 'belliedmonkey.e2e-b1b.judge-record.v1',
        promptVersion: 'unified-v1',
        promptSkeletonSha256: instrument,
        set: 'hardset', itemId: key, judgeId, model,
        promptSha256: sha(judgePromptText(t.targetLang, s.source, t.translation)),
        httpStatus: r.status, ok: !!parsed.verdict, parseCode: parsed.code, verdict: parsed.verdict,
        finishReason: (r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason) || null,
        usage: (r.json && r.json.usage) || null, providerUsd: usd,
      });
      log('hardset ' + key + ' ' + judgeId + ' ok=' + !!parsed.verdict + ' ' + parsed.code + ' usd=' + usd);
    }
  }
  writeJson(path.join(HERE, 'out', 'hardset-report.json'), { schema: 'belliedmonkey.e2e-b1b.hardset.v1', instrument, picked: PICK, providerUsd: Math.round(spent * 1e8) / 1e8 });
  log('HARDSET done usd=' + spent.toFixed(8));
}

main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
