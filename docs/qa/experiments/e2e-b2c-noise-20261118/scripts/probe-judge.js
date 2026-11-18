'use strict';
// Judge-noise probe: same frozen translation, same prompt, repeated calls.
// Answers: does a second judge call on the *same* verdict object flip?

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const OUT = path.join(__dirname, '..', 'out');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const B2 = path.join(REPO, 'docs/qa/experiments/e2e-b2-chain-20261118');
const B1B = path.join(REPO, 'docs/qa/experiments/e2e-b1b-unified-judge-20261118');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const EXPECTED_SKELETON = '2fa67bbeecf7198bdb9096d4361b400588511f6794ae243a5c3a9cbf6ca56e50';
const REPEATS = 4;

const ITEMS = [
  { id: 'fleurs-public-candidates/cmn_hans_cn/1671', kind: 'both-pass' },
  { id: 'fleurs-public-candidates/en_us/1672', kind: 'both-pass' },
  { id: 'ascend/00055', kind: 'both-pass' },
  { id: 'fleurs-public-candidates/en_us/1680', kind: 'both-fail' },
  { id: 'ascend/00028', kind: 'both-fail' },
  { id: 'fleurs-public-candidates/cmn_hans_cn/1668', kind: 'split' },
];

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

async function main() {
  const mine = sha(judgePromptText('en', '{gold}', '{candidate}'));
  if (mine !== EXPECTED_SKELETON) throw new Error('prompt drift: ' + mine);
  const keys = loadKeys();
  if (!keys.key_chat_custom_chat) throw new Error('openrouter key missing');
  const gold = new Map();
  const inp = readJson(path.join(REPO, 'docs/qa/experiments/sa-sv-36-llm-judge-20261113/records/07-v2-official-partial/evidence/llm-judge-v2-real-20261114-0015/input/input-asr-36.json'));
  for (const it of (inp.items || inp)) gold.set(it.id, it.reference);
  const trs = new Map();
  for (const f of fs.readdirSync(path.join(B2, 'out', 'translation'))) {
    const r = readJson(path.join(B2, 'out', 'translation', f));
    if (r.translation) trs.set(r.itemId, r);
  }

  const outDir = path.join(OUT, 'judge-calls');
  fs.mkdirSync(outDir, { recursive: true });
  const records = [];
  let n = 0, spent = 0;
  for (const item of ITEMS) {
    const t = trs.get(item.id);
    if (!t) throw new Error('no translation for ' + item.id);
    const prompt = judgePromptText(t.targetLang, gold.get(item.id), t.translation);
    for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
      for (let i = 0; i < REPEATS; i++) {
        n++;
        const body = { model, temperature: 0, messages: [{ role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' }, { role: 'user', content: prompt }] };
        let rec = null;
        for (let attempt = 0; attempt < 3 && !rec; attempt++) {
          try {
            const res = await fetch(OPENROUTER, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + keys.key_chat_custom_chat }, body: JSON.stringify(body) });
            const text = await res.text();
            let json = null; try { json = JSON.parse(text); } catch (_) {}
            const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
            const parsed = parseVerdict(content);
            const usd = (json && Number.isFinite(json.usage && json.usage.cost)) ? json.usage.cost : null;
            if (usd) spent += usd;
            rec = {
              schema: 'belliedmonkey.seed-probe.judge-call.v1', itemLabel: item.kind,
              promptSkeletonSha256: mine, itemId: item.id, judgeId, model, repeat: i,
              httpStatus: res.status, ok: !!parsed.verdict, parseCode: parsed.code,
              verdict: parsed.verdict, usage: (json && json.usage) || null, providerUsd: usd,
            };
            if (!rec.ok && attempt < 2) { rec = null; await sleep(1500); }
          } catch (e) { await sleep(1500); }
        }
        if (!rec) rec = { schema: 'belliedmonkey.seed-probe.judge-call.v1', itemId: item.id, judgeId, model, repeat: i, ok: false, parseCode: 'transport', verdict: null };
        records.push(rec);
        writeJson(path.join(outDir, String(n).padStart(3, '0') + '.json'), rec);
        log(judgeId + ' #' + i + ' ' + item.id + ' ok=' + rec.ok + ' usd=' + rec.providerUsd);
      }
    }
  }

  // Flip stats: per (item, judge) how many distinct signatures and their pass/fail split.
  const groups = new Map();
  for (const r of records) {
    const k = r.itemId + '|' + r.judgeId;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const results = [];
  for (const [k, rs] of groups) {
    const oks = rs.filter((r) => r.ok);
    const sigs = oks.map((r) => DIMS.map((d) => (r.verdict.dimensions[d].pass ? '1' : '0')).join(''));
    const itemPass = oks.map((r) => DIMS.every((d) => r.verdict.dimensions[d].pass));
    results.push({
      key: k, itemId: k.split('|')[0], judgeId: k.split('|')[1],
      calls: rs.length, ok: oks.length,
      distinctSignatures: [...new Set(sigs)].length,
      distinctDimFailSets: [...new Set(oks.map((r) => DIMS.filter((d) => !r.verdict.dimensions[d].pass).join(',') || '(all pass)'))],
      itemPassCount: itemPass.filter(Boolean).length,
      itemFailCount: itemPass.filter((x) => !x).length,
      parseFails: rs.filter((r) => !r.ok).length,
    });
  }
  fs.writeFileSync(path.join(OUT, 'judge-calls.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeJson(path.join(OUT, 'judge-probe-summary.json'), {
    schema: 'belliedmonkey.seed-probe.judge-summary.v1',
    promptSkeletonSha256: mine, judges: JUDGE_MODELS, repeats: REPEATS, items: ITEMS,
    calls: records.length, providerUsd: Math.round(spent * 1e8) / 1e8, results,
  });
  log('done calls=' + records.length + ' usd=' + spent.toFixed(8));
}

main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
