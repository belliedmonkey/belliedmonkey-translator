'use strict';
// Hard-set translation run: Wikipedia paragraphs (CC BY-SA 4.0, pinned revisions),
// product system prompt, product pinned chat model with the product's reasoning
// fragment, two independent judges on the same seven dimensions as B1.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = '/Users/belliedmonkey/qa/e2e-b1-text-mt-20261114';
const REPO = '/Users/belliedmonkey/OpenBot/Agents/agent-58a6cf7f-25c3-42a8-a363-d86cd56f66fc/work/repo';
const PROMPT_SRC = path.join(REPO, 'extension/content/translation-api.js');
const PROVIDERS_GEN = path.join(REPO, 'extension/content/providers.gen.js');
const KEYS = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const SOURCES = path.join(ROOT, 'hardset/sources.json');

const CHAT_MODEL = 'qwen3.7-plus';
const CHAT_URL = 'https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions';
const JUDGE_MODELS = { 'judge-a': 'openai/gpt-4.1-mini', 'judge-b': 'qwen/qwen3-235b-a22b-2507' };
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const DIMS = ['meaning', 'entities_numbers', 'negation', 'omission', 'hallucination', 'terminology', 'fluency'];
const LANG_NAME = { en: 'English', 'zh-CN': '简体中文' };

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
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function log(m) {
  const line = new Date().toISOString() + ' ' + m + '\n';
  fs.mkdirSync(path.join(ROOT, 'hardset/ledger'), { recursive: true });
  fs.appendFileSync(path.join(ROOT, 'hardset/ledger/progress.log'), line);
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
function assertPrompt() {
  const src = fs.readFileSync(PROMPT_SRC, 'utf8');
  if (!src.includes("Translate the user's text into ${name}.")) throw new Error('prompt drifted');
}
function reasoningFragment() {
  const src = fs.readFileSync(PROVIDERS_GEN, 'utf8');
  const m = src.match(/window\.MT_MODEL_PARAMS = (\[[\s\S]*?\]);/);
  if (!m) throw new Error('MT_MODEL_PARAMS missing');
  const row = JSON.parse(m[1]).filter((r) => r.id === 'qwencloud')[0];
  if (!row || !row.reasoning || row.reasoning.enable_thinking !== false) throw new Error('qwencloud reasoning changed');
  return row.reasoning;
}
function systemFor(t) { return SYSTEM_TEMPLATE.replace('{NAME}', LANG_NAME[t] || t); }

async function post(url, key, body) {
  let res;
  for (let a = 0; a < 6; a++) {
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    } catch (e) { await new Promise((s) => setTimeout(s, 3000 * (a + 1))); continue; }
    if (res.status === 429 || res.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (a + 1))); continue; }
    break;
  }
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  return { status: res.status, ok: res.ok, json: j, text };
}

function judgePrompt(row) {
  return [
    'You are a bilingual translation reviewer. Judge whether the candidate translation delivers the meaning of the SOURCE.',
    'Answer only with JSON, no prose.',
    '',
    'SOURCE (' + (row.targetLang === 'en' ? 'Chinese' : 'English') + '):',
    row.source,
    '',
    'CANDIDATE TRANSLATION (' + row.targetLang + '):',
    row.translation,
    '',
    'Return exactly this JSON shape:',
    '{"schema":"belliedmonkey.llm-judge.mt.v1","dimensions":{'
      + DIMS.map((d) => '"' + d + '":{"pass":true,"note":"short"}').join(',')
      + '},"findings":[{"dimension":"meaning","sourceQuote":"...","targetQuote":"...","reason":"..."}]}',
    '',
    'Rules:',
    '- meaning: the full message survives; no added or dropped proposition.',
    '- entities_numbers: names, places, brands and numbers are preserved or correctly rendered.',
    '- negation: polarity is preserved.',
    '- omission: nothing material is left out.',
    '- hallucination: nothing is invented.',
    '- terminology: domain terms are translated consistently and sensibly.',
    '- fluency: the target reads naturally to a native reader.',
    '- A dimension passes only when you find no real defect in it. Formatting-only differences pass.',
    '- findings: at most 3, each quoting the exact source and target span. Empty array if all pass.',
    '- Do not judge style preference and do not compare against any reference translation.',
  ].join('\n');
}

async function main() {
  assertPrompt();
  const keys = loadKeys();
  const frag = reasoningFragment();
  const set = readJson(SOURCES);
  const tdir = path.join(ROOT, 'hardset/out/translation');
  const jdir = path.join(ROOT, 'hardset/out/judge');
  fs.mkdirSync(tdir, { recursive: true });
  fs.mkdirSync(jdir, { recursive: true });

  const rows = [];
  for (const it of set.items) {
    const target = it.lang === 'en' ? 'zh-CN' : 'en';
    const name = (it.lang + '_' + (it.revid || it.title)).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
    const tp = path.join(tdir, name);
    let rec;
    if (fs.existsSync(tp)) rec = readJson(tp);
    else {
      const r = await post(CHAT_URL, keys.key_chat_qwencloud_global, Object.assign({
        model: CHAT_MODEL, temperature: 0,
        messages: [{ role: 'system', content: systemFor(target) }, { role: 'user', content: it.source }],
      }, frag));
      const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      rec = {
        key: it.lang + '|' + it.title, lang: it.lang, title: it.title, revid: it.revid, url: it.url,
        license: it.license, targetLang: target, source: it.source,
        systemPromptSha256: sha(systemFor(target)), model: CHAT_MODEL, reasoning: frag,
        httpStatus: r.status, ok: r.ok && typeof content === 'string',
        translation: typeof content === 'string' ? content.trim() : null,
        usage: (r.json && r.json.usage) || null,
        finishReason: (r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason) || null,
      };
      writeJson(tp, rec);
      log('translate ' + rec.key + ' ok=' + rec.ok);
      await new Promise((s) => setTimeout(s, 800));
    }
    rows.push(rec);
  }

  for (const row of rows) {
    if (!row.translation) continue;
    for (const [judgeId, model] of Object.entries(JUDGE_MODELS)) {
      const name = (row.lang + '_' + (row.revid || 'x') + '_' + judgeId).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
      const jp = path.join(jdir, name);
      if (fs.existsSync(jp)) { row['v_' + judgeId] = readJson(jp); continue; }
      const r = await post(OPENROUTER, keys.key_chat_custom_chat, {
        model, temperature: 0,
        messages: [
          { role: 'system', content: 'You are a strict bilingual QA reviewer. Output JSON only.' },
          { role: 'user', content: judgePrompt(row) },
        ],
      });
      const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      let verdict = null, parseCode = 'bad-json';
      if (typeof content === 'string') {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const d = JSON.parse(m[0]);
            if (d && d.schema === 'belliedmonkey.llm-judge.mt.v1' && d.dimensions) {
              const clean = {}; let all = true;
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
      const out = {
        key: row.key, lang: row.lang, title: row.title, judgeId, model,
        httpStatus: r.status, ok: !!verdict, parseCode, verdict,
        providerUsd: (r.json && r.json.usage && Number.isFinite(r.json.usage.cost)) ? r.json.usage.cost : null,
      };
      writeJson(jp, out);
      log('judge ' + row.key + ' ' + judgeId + ' ' + parseCode);
      await new Promise((s) => setTimeout(s, 600));
    }
  }

  // Report
  const js = fs.readdirSync(jdir).map((f) => readJson(path.join(jdir, f)));
  const per = {}; const allpass = {};
  for (const l of ['en', 'zh', 'all']) { per[l] = {}; for (const d of DIMS) per[l][d] = { pass: 0, total: 0 }; allpass[l] = { pass: 0, total: 0 }; }
  const pairs = {};
  for (const j of js) {
    if (!j.verdict) continue;
    const l = j.lang;
    let all = true;
    for (const d of DIMS) {
      for (const k of [l, 'all']) {
        per[k][d].total += 1;
        if (j.verdict.dimensions[d].pass) per[k][d].pass += 1; else all = false;
      }
    }
    for (const k of [l, 'all']) { allpass[k].total += 1; if (all) allpass[k].pass += 1; }
    pairs[j.key] = pairs[j.key] || {};
    pairs[j.key][j.judgeId] = j.verdict;
  }
  const agree = Object.values(pairs).filter((v) => v['judge-a'] && v['judge-b']
    && DIMS.every((d) => v['judge-a'].dimensions[d].pass === v['judge-b'].dimensions[d].pass)).length;
  const usd = js.reduce((a, j) => a + (j.providerUsd || 0), 0);
  const tok = rows.reduce((a, r) => {
    const u = r.usage || {};
    a.prompt += u.prompt_tokens || 0; a.completion += u.completion_tokens || 0;
    a.reasoning += (u.completion_tokens_details || {}).reasoning_tokens || 0;
    return a;
  }, { prompt: 0, completion: 0, reasoning: 0 });

  const rep = {
    schema: 'belliedmonkey.e2e-b1.hardset-report.v1',
    items: rows.length, translated: rows.filter((r) => r.ok).length,
    judgeCalls: js.length, judgeParsed: js.filter((j) => j.ok).length,
    agree, pairsCompared: Object.keys(pairs).length,
    perDimension: per, allDimensionsPass: allpass,
    judgeUsd: Math.round(usd * 1e8) / 1e8, translationTokens: tok,
    promptTemplateSha256OfEnglish: sha(systemFor('en')),
    model: CHAT_MODEL, reasoningFragment: frag,
  };
  writeJson(path.join(ROOT, 'hardset/ledger/report.json'), rep);
  console.log(JSON.stringify({
    items: rep.items, translated: rep.translated, parsed: rep.judgeParsed,
    agree: rep.agree, of: rep.pairsCompared, usd: rep.judgeUsd, tokens: rep.translationTokens,
    allPass: rep.allDimensionsPass,
    meaning: rep.perDimension.all.meaning,
    entities: rep.perDimension.all.entities_numbers,
  }, null, 2));
}

main().catch((e) => { log('crash: ' + e.message); process.exit(2); });
