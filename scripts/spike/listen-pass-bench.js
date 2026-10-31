#!/usr/bin/env node
// 「修正 + 翻译」一次调用（T:/X: 契约，app/listen-core.js buildListenPrompt）的候选基准：
// 拿真实的本机识别 finals（.local/asr/results/*.json），逐句打每个候选端点，量往返、标签合规率、
// 修正后 CER/WER；专用 MT（qwen-mt / Google 免费）只量翻译腿（它们不吃 system 提示，做不了修正）。
//
//   node scripts/spike/listen-pass-bench.js [--max 12] [--only deepseek,openrouter] [--out .local/spike/lab/pass-bench.json]
//
// key 从 .local/keys.md 读、不回显。候选表在下面 CANDIDATES；模型名以 build/perf-ledger.config.js 里量过的为准。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'app', 'listen-core.js'));
const R = require(path.join(ROOT, 'extension', 'content', 'learn-rules.js'));
const DEPS = { dominantScript: R.dominantScript };
const KEYS = fs.readFileSync(path.join(ROOT, '.local/keys.md'), 'utf8');
const slot = (n) => (KEYS.match(new RegExp('^' + n + '\\s*=\\s*(\\S+)', 'm')) || [])[1] || '';
const opt = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MAX = +opt('--max', 12), ONLY = (opt('--only', '') || '').split(',').filter(Boolean), OUT = opt('--out', path.join(ROOT, '.local/spike/lab/pass-bench.json'));

// { id, kind: 'llm'|'mt', url, key, model, extra }
const CANDIDATES = [
  { id: 'deepseek/v4-flash', kind: 'llm', url: 'https://api.deepseek.com/v1/chat/completions', key: 'key_chat_deepseek', model: 'deepseek-v4-flash', extra: { thinking: { type: 'disabled' } } },
  { id: 'openrouter/gemini-3.1-flash-lite', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'google/gemini-3.1-flash-lite' },
  { id: 'openrouter/gpt-5-nano', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'openai/gpt-5-nano', extra: { reasoning: { effort: 'low' } } },
  { id: 'openrouter/gpt-oss-120b', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'openai/gpt-oss-120b' },
  { id: 'openrouter/qwen3.7-flash', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'qwen/qwen3.7-flash' },
  { id: 'openrouter/glm-4.7-flash', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'z-ai/glm-4.7-flash' },
  { id: 'openrouter/seed-1.6-flash', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'bytedance-seed/seed-1.6-flash' },
  { id: 'openrouter/mistral-small', kind: 'llm', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'key_openrouter_grant', model: 'mistralai/mistral-small-2603' },
  { id: 'dashscope/qwen3.8-flash', kind: 'llm', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key: 'key_chat_qwen_china', model: 'qwen3.8-flash', extra: { enable_thinking: false } },
  { id: 'dashscope/qwen-plus', kind: 'llm', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key: 'key_chat_qwen_china', model: 'qwen-plus', extra: { enable_thinking: false } },
  { id: 'glm/glm-4-flash', kind: 'llm', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: 'key_chat_glm_china', model: 'glm-4-flash', extra: { thinking: { type: 'disabled' } } },
  { id: 'kimi/moonshot-v1-8k', kind: 'llm', url: 'https://api.moonshot.cn/v1/chat/completions', key: 'key_chat_kimi_china', model: 'moonshot-v1-8k', extra: { thinking: { type: 'disabled' } } },
  { id: 'ark/doubao-seed-2-1-turbo', kind: 'llm', url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', key: 'key_chat_ark', model: 'doubao-seed-2-1-turbo-260628', extra: { thinking: { type: 'disabled' } } },
  { id: 'gemini/3.6-flash', kind: 'llm', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: 'key_chat_gemini', model: 'gemini-3.6-flash' },
  { id: 'gemini/3.1-flash-lite', kind: 'llm', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: 'key_chat_gemini', model: 'gemini-3.1-flash-lite' },
  { id: 'minimax/M2', kind: 'llm', url: 'https://api.minimax.io/v1/chat/completions', key: 'key_chat_minimax', model: 'MiniMax-M2' },
  // 专用 MT：只量翻译腿
  { id: 'dashscope/qwen-mt-turbo (MT)', kind: 'mt', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key: 'key_chat_qwen_china', model: 'qwen-mt-turbo' },
  { id: 'google-free (MT)', kind: 'mt-google', url: '', key: '', model: '' },
];

const CORPORA = [
  { id: 'zh-12', lang: 'zh', file: '.local/asr/results/live-device-zh-12-3min.json', ref: '.local/asr/zh-12.txt' },
  { id: 'conv-zh', lang: 'zh', file: '.local/asr/results/live-device-conv-zh-vad300.json', ref: '.local/spike/conv/ref.txt' },
  { id: 'en-12', lang: 'en', file: '.local/asr/results/live-device-en-12-3min.json', ref: '.local/asr/en-12.txt' },
];
const LANG_NAME = { zh: 'Simplified Chinese', en: 'English' };
const MT_LANG = { zh: 'Chinese', en: 'English' };   // dashscope translation_options 的值
const GOOGLE_TL = { zh: 'zh-CN', en: 'en' };

function tokens(text, lang) {
  const s = String(text || '').normalize('NFKC');
  if (lang === 'zh') return [...s.replace(/[\s\p{P}\p{S}A-Za-z]+/gu, '')];
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, ' ').replace(/(^|\s)'+|'+(\s|$)/g, ' ').split(/\s+/).filter(Boolean);
}
function prefixErr(hyp, refT) {
  const n = hyp.length, m = refT.length;
  let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) { cur[0] = i; for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (hyp[i - 1] === refT[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  let best = Infinity, bj = 0; for (let j = 0; j <= m; j++) if (prev[j] < best) { best = prev[j]; bj = j; }
  return best / Math.max(bj, 1);
}
function loadCorpus(c) {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, c.file), 'utf8'));
  const refAll = fs.readFileSync(path.join(ROOT, c.ref), 'utf8');
  const ref = c.ref.endsWith('ref.txt') ? refAll.split('\n').filter((l) => c.lang === 'zh' ? /[一-鿿]/.test(l) : l && !/[一-鿿]/.test(l)).join(c.lang === 'zh' ? '' : ' ') : refAll;
  const finals = r.finals.filter((f) => !f.locale || f.locale.startsWith(c.lang));
  const joined = finals.map((f) => f.text).join(c.lang === 'zh' ? '' : ' ').replace(/\s+/g, ' ').trim();
  let sents = joined.split(/(?<=[。！？.!?])\s*/).map((s) => s.trim()).filter((s) => s && /[\p{L}\p{N}]/u.test(s));
  if (c.lang === 'en') { const i = sents.findIndex((s) => /when i glance/i.test(s)); if (i > 0) sents = sents.slice(i); }   // 去 LibriVox 片头
  const alts = finals.flatMap((f) => f.alts || []).filter(Boolean);
  return { sents: sents.slice(0, MAX), refT: tokens(ref, c.lang), alts };
}

async function callLLM(cand, prompt) {
  const body = Object.assign({ model: cand.model, temperature: 0, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }, cand.extra || {});
  const t0 = Date.now();
  const res = await fetch(cand.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + slot(cand.key) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const ms = Date.now() - t0;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ms, error: res.status + ' ' + JSON.stringify(j).slice(0, 120) };
  return { ms, text: String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim() };
}
async function callMT(cand, text, lang) {
  const t0 = Date.now();
  if (cand.kind === 'mt-google') {
    const tl = GOOGLE_TL[lang === 'zh' ? 'en' : 'zh'];
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(20000) });
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, error: String(res.status) };
    const j = await res.json(); return { ms, text: (j[0] || []).map((c) => c[0]).join('') };
  }
  const body = { model: cand.model, messages: [{ role: 'user', content: text }], translation_options: { source_lang: 'auto', target_lang: MT_LANG[lang === 'zh' ? 'en' : 'zh'] } };
  const res = await fetch(cand.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + slot(cand.key) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const ms = Date.now() - t0;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ms, error: res.status + ' ' + JSON.stringify(j).slice(0, 120) };
  return { ms, text: String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim() };
}
const pct = (xs, q) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] : null);

(async () => {
  const corpora = CORPORA.map((c) => Object.assign({}, c, loadCorpus(c)));
  const results = [];
  for (const cand of CANDIDATES) {
    if (ONLY.length && !ONLY.some((o) => cand.id.startsWith(o))) continue;
    if (cand.key && !slot(cand.key)) { console.log(`  – ${cand.id}: 没有 ${cand.key}，跳过`); results.push({ id: cand.id, skipped: 'no-key' }); continue; }
    const row = { id: cand.id, kind: cand.kind, model: cand.model, host: cand.url ? new URL(cand.url).host : 'translate.googleapis.com', corpora: {}, lat: [], errors: 0, calls: 0 };
    for (const c of corpora) {
      const cr = { n: 0, tagged: 0, changed: 0, gateRejected: 0, rawErr: null, corErr: null, samples: [] };
      const out = []; const ctx = [];
      cr.rawErr = prefixErr(tokens(c.sents.join(c.lang === 'zh' ? '' : ' '), c.lang), c.refT);
      for (const s of c.sents) {
        let r;
        try {
          if (cand.kind === 'llm') {
            const prompt = C.buildListenPrompt({ text: s, alts: c.alts.slice(0, 12), who: 'them', srcName: LANG_NAME[c.lang], dstName: LANG_NAME[c.lang === 'zh' ? 'en' : 'zh'], context: ctx.slice(-6).map((t) => ({ who: 'them', text: t.text, tr: t.tr })) });
            r = await callLLM(cand, prompt);
          } else r = await callMT(cand, s, c.lang);
        } catch (e) { r = { ms: 30000, error: String(e && e.message || e) }; }
        row.calls++; cr.n++;
        if (r.error) { row.errors++; out.push(s); ctx.push({ text: s, tr: '' }); if (cr.samples.length < 2) cr.samples.push({ s, error: r.error }); continue; }
        row.lat.push(r.ms);
        if (cand.kind === 'llm') {
          const p = C.parseListenReply(r.text, s);
          if (p.tagged) cr.tagged++;
          let T = p.text;
          if (p.tagged && !C.acceptCorrection(s, p.text, DEPS)) { cr.gateRejected++; T = s; }
          if (T !== s) cr.changed++;
          out.push(T); ctx.push({ text: T, tr: p.tr });
          if (cr.samples.length < 3) cr.samples.push({ s: s.slice(0, 40), T: T.slice(0, 40), X: (p.tr || '').slice(0, 50), ms: r.ms });
        } else { out.push(s); if (cr.samples.length < 3) cr.samples.push({ s: s.slice(0, 40), X: (r.text || '').slice(0, 50), ms: r.ms }); }
      }
      cr.corErr = cand.kind === 'llm' ? prefixErr(tokens(out.join(c.lang === 'zh' ? '' : ' '), c.lang), c.refT) : null;
      row.corpora[c.id] = cr;
      const l = row.lat.slice(-cr.n);
      console.log(`${cand.id.padEnd(36)} ${c.id.padEnd(8)} n=${cr.n} err=${row.errors} p50=${pct(l, 0.5)}ms p90=${pct(l, 0.9)}ms tagged=${cr.tagged}/${cr.n} changed=${cr.changed} gate✗=${cr.gateRejected} raw=${(cr.rawErr * 100).toFixed(1)}% → ${cr.corErr == null ? '—' : (cr.corErr * 100).toFixed(1) + '%'}`);
    }
    row.p50 = pct(row.lat, 0.5); row.p90 = pct(row.lat, 0.9); row.max = row.lat.length ? Math.max(...row.lat) : null;
    results.push(row);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), max: MAX, results }, null, 1));
  console.log('\n汇总（往返 ms，全部语料）：');
  for (const r of results.filter((x) => !x.skipped)) {
    const tag = Object.values(r.corpora).reduce((a, c) => a + c.tagged, 0), n = Object.values(r.corpora).reduce((a, c) => a + c.n, 0);
    const cer = (id) => r.corpora[id] && r.corpora[id].corErr != null ? (r.corpora[id].corErr * 100).toFixed(1) + '%' : '—';
    console.log(`  ${r.id.padEnd(36)} p50 ${String(r.p50).padStart(5)} p90 ${String(r.p90).padStart(5)} max ${String(r.max).padStart(6)}  err ${r.errors}/${r.calls}  合规 ${r.kind === 'llm' ? Math.round(tag / Math.max(n, 1) * 100) + '%' : '—'}  修正后 zh-12 ${cer('zh-12')} · conv-zh ${cer('conv-zh')} · en-12 ${cer('en-12')}`);
  }
  console.log('→ ' + path.relative(ROOT, OUT));
})();
