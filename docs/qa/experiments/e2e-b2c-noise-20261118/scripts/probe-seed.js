'use strict';
// Seed / sampling controllability probe for the product translation stage.
// Same system prompt, same model, same endpoint as chain.js --translate.
// Nothing is written outside ./out; secrets stay in memory.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const OUT = path.join(__dirname, '..', 'out');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const B2 = path.join(REPO, 'docs/qa/experiments/e2e-b2-chain-20261118');
const B1 = path.join(REPO, 'docs/qa/experiments/e2e-b1-text-mt-20261114');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const CHAT_MODEL = 'qwen3.7-plus';
const CHAT_URL = 'https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions';
const EXPECTED_PROMPT_SHA = '75e06b87f485d0f505680a9763ad57103c8777cb28efc2777119aca2488a558b';

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

function productReasoningFragment() {
  const src = fs.readFileSync(path.join(REPO, 'extension/content/providers.gen.js'), 'utf8');
  const m = src.match(/window\.MT_MODEL_PARAMS = (\[[\s\S]*?\]);/);
  const row = JSON.parse(m[1]).filter((r) => r.id === 'qwencloud')[0];
  if (!row.reasoning || row.reasoning.enable_thinking !== false) throw new Error('reasoning fragment changed');
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

// Samples: 4 known to drift between two runs, 2 known stable.
const ITEMS = [
  { id: 'fleurs-public-candidates/cmn_hans_cn/1671', drift: true },
  { id: 'fleurs-public-candidates/en_us/1673', drift: true },
  { id: 'fleurs-public-candidates/en_us/1681', drift: true },
  { id: 'ascend/00004', drift: true },
  { id: 'fleurs-public-candidates/cmn_hans_cn/1679', drift: false },
  { id: 'fleurs-public-candidates/en_us/1682', drift: false },
];

const CONDITIONS = [
  { name: 't0', temp: 0, repeats: 6 },
  { name: 'seed42', temp: 0, seed: 42, repeats: 6 },
  { name: 'seed7', temp: 0, seed: 7, repeats: 4 },
  { name: 't1', temp: 1, repeats: 4 },
];

async function main() {
  const promptSha = sha(SYSTEM_TEMPLATE);
  if (promptSha !== EXPECTED_PROMPT_SHA) throw new Error('system prompt drift: ' + promptSha);
  const keys = loadKeys();
  if (!keys.key_chat_qwencloud_global) throw new Error('qwencloud key missing');
  const reasoning = productReasoningFragment();

  const hyp = new Map();
  for (const row of readJson(path.join(B2, 'input', 'hypotheses.json'))) hyp.set(row.id, row.hypothesis);
  const text = new Map();
  for (const f of fs.readdirSync(path.join(B1, 'out', 'translation'))) {
    const r = readJson(path.join(B1, 'out', 'translation', f));
    if (r.condition === 'B') text.set(r.itemId, r.source);
  }

  const outDir = path.join(OUT, 'calls');
  fs.mkdirSync(outDir, { recursive: true });
  const records = [];
  let n = 0;
  for (const item of ITEMS) {
    const source = hyp.get(item.id) || text.get(item.id);
    if (!source) throw new Error('no source for ' + item.id);
    const targetLang = targetFor(item.id);
    const system = SYSTEM_TEMPLATE.replace('{NAME}', LANG_NAME[targetLang]);
    for (const c of CONDITIONS) {
      for (let i = 0; i < c.repeats; i++) {
        n++;
        const body = Object.assign({
          model: CHAT_MODEL, temperature: c.temp,
          messages: [{ role: 'system', content: system }, { role: 'user', content: source }],
        }, reasoning);
        if (c.seed !== undefined) body.seed = c.seed;
        const t0 = Date.now();
        let r = null, err = null;
        for (let attempt = 0; attempt < 3 && !r; attempt++) {
          try {
            const got = await postJson(CHAT_URL, keys.key_chat_qwencloud_global, body);
            if (got.ok || got.status === 400) r = got;
            else { err = 'http ' + got.status + ' ' + String(got.text).slice(0, 120); await sleep(1500 * (attempt + 1)); }
          } catch (e) { err = String(e.message); await sleep(1500 * (attempt + 1)); }
        }
        const choice = r && r.json && r.json.choices && r.json.choices[0];
        const content = choice && choice.message && choice.message.content;
        const rec = {
          schema: 'belliedmonkey.seed-probe.call.v1',
          itemId: item.id, knownDrift: item.drift, condition: c.name,
          temperature: c.temp, seed: c.seed === undefined ? null : c.seed, repeat: i,
          httpStatus: r ? r.status : null,
          ok: !!(r && r.ok && typeof content === 'string'),
          output: typeof content === 'string' ? content.trim() : null,
          outputSha256: typeof content === 'string' ? sha(content.trim()) : null,
          finishReason: (choice && choice.finish_reason) || null,
          systemFingerprint: (r && r.json && r.json.system_fingerprint) || null,
          responseTopKeys: r && r.json ? Object.keys(r.json).sort() : [],
          usage: (r && r.json && r.json.usage) || null,
          error: r && !r.ok ? String(r.text).slice(0, 200) : err,
          latencyMs: Date.now() - t0,
        };
        records.push(rec);
        writeJson(path.join(outDir, String(n).padStart(3, '0') + '.json'), rec);
        log(c.name + ' #' + i + ' ' + item.id + ' ok=' + rec.ok + ' ' + rec.latencyMs + 'ms sha=' + (rec.outputSha256 || '-').slice(0, 8));
      }
    }
  }

  // Summary: distinct outputs per (item, condition) and whether seed call errored.
  const groups = new Map();
  for (const r of records) {
    const k = r.itemId + '|' + r.condition;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const summary = [];
  for (const [k, rs] of groups) {
    const oks = rs.filter((r) => r.ok);
    const shas = [...new Set(oks.map((r) => r.outputSha256))];
    summary.push({
      key: k, itemId: k.split('|')[0], condition: k.split('|')[1],
      calls: rs.length, ok: oks.length, distinctOutputs: shas.length,
      shas, errSample: rs.find((r) => !r.ok) ? (rs.find((r) => !r.ok).error || '').slice(0, 120) : null,
    });
  }
  const totalPrompt = records.reduce((s, r) => s + ((r.usage && r.usage.prompt_tokens) || 0), 0);
  const totalCompletion = records.reduce((s, r) => s + ((r.usage && r.usage.completion_tokens) || 0), 0);
  fs.writeFileSync(path.join(OUT, 'seed-calls.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeJson(path.join(OUT, 'probe-summary.json'), {
    schema: 'belliedmonkey.seed-probe.summary.v1',
    model: CHAT_MODEL, endpoint: CHAT_URL,
    promptSha256: promptSha, reasoning,
    items: ITEMS, conditions: CONDITIONS,
    calls: records.length,
    tokens: { prompt: totalPrompt, completion: totalCompletion },
    results: summary,
  });
  log('done calls=' + records.length + ' promptTok=' + totalPrompt + ' completionTok=' + totalCompletion);
}

main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
