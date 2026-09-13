#!/usr/bin/env node
// 给真机对话页导出的行打分：同一段语料（conv.wav）在不同转写引擎下，修正前 / 修正后的 zh CER 与 en WER，
// 以及每行时延（lat.pass / lat.ttsStart 的 p50/p90）。输入是 `AppListen._debug().rows` 的 JSON 导出。
//
//   node scripts/spike/score-rows.js <rows.json> [ref.txt=.local/spike/conv/ref.txt]
//   node scripts/spike/score-rows.js a.json b.json c.json   # 多份并排（同一 ref）
//
// 打分与 listen-pass-bench.js 同一套：按文字系统分成 zh / en 两路，各自拼成一整段，对参考文本做
// 「最优前缀」编辑距离（跑到一半停下的会话也能打分，不因参考文本更长而虚高）。
// zh 按字符（去标点、去空白、去拉丁字母）；en 按小写单词。
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.filter((a) => a.endsWith('.json'));
const refFile = args.find((a) => a.endsWith('.txt')) || '.local/spike/conv/ref.txt';
if (!files.length) { console.error('usage: score-rows.js <rows.json>… [ref.txt]'); process.exit(1); }

function tokens(text, lang) {
  const s = String(text || '').normalize('NFKC');
  if (lang === 'zh') return [...s.replace(/[\s\p{P}\p{S}A-Za-z]+/gu, '')];
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, ' ').replace(/(^|\s)'+|'+(\s|$)/g, ' ').split(/\s+/).filter(Boolean);
}
function prefixErr(hyp, refT) {
  const n = hyp.length, m = refT.length;
  if (!n) return null;
  let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) { cur[0] = i; for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (hyp[i - 1] === refT[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  let best = Infinity, bj = 0; for (let j = 0; j <= m; j++) if (prev[j] < best) { best = prev[j]; bj = j; }
  return best / Math.max(bj, 1);
}
const isZh = (s) => /[一-鿿]/.test(String(s || ''));
const pct = (xs, q) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] : null);
const fmt = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');

const refLines = fs.readFileSync(refFile, 'utf8').split('\n').filter(Boolean);
const REF = {
  zh: tokens(refLines.filter(isZh).join(''), 'zh'),
  en: tokens(refLines.filter((l) => !isZh(l)).join(' '), 'en'),
};

function score(rows) {
  const out = { n: rows.length };
  for (const lang of ['zh', 'en']) {
    const rs = rows.filter((r) => (lang === 'zh') === isZh(r.raw || r.text));
    const join = (f) => rs.map((r) => r[f] || (f === 'raw' ? r.text : '')).join(lang === 'zh' ? '' : ' ');
    out[lang] = {
      rows: rs.length,
      raw: prefixErr(tokens(join('raw'), lang), REF[lang]),
      corrected: prefixErr(tokens(join('text'), lang), REF[lang]),
      changed: rs.filter((r) => r.raw && r.raw !== r.text).length,
    };
  }
  const pass = rows.map((r) => r.lat && r.lat.pass).filter((x) => x != null);
  const tts = rows.map((r) => r.lat && r.lat.ttsStart).filter((x) => x != null);
  out.lat = { pass: { n: pass.length, p50: pct(pass, 0.5), p90: pct(pass, 0.9) }, ttsStart: { n: tts.length, p50: pct(tts, 0.5), p90: pct(tts, 0.9) } };
  out.engines = [...new Set(rows.map((r) => r.lat && r.lat.engine).filter(Boolean))];
  out.ttsEngines = [...new Set(rows.map((r) => r.lat && r.lat.ttsEngine).filter(Boolean))];
  return out;
}

const table = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rows = Array.isArray(j) ? j : (j.rows || []);
  const s = score(rows);
  table.push(Object.assign({ file: path.basename(f) }, s));
  console.log(`${path.basename(f)}  rows=${s.n}  stt=${s.engines.join('/') || '?'}  tts=${s.ttsEngines.join('/') || '—'}`);
  console.log(`  zh  n=${s.zh.rows}  CER 修正前 ${fmt(s.zh.raw)} → 修正后 ${fmt(s.zh.corrected)}  改动 ${s.zh.changed}/${s.zh.rows}`);
  console.log(`  en  n=${s.en.rows}  WER 修正前 ${fmt(s.en.raw)} → 修正后 ${fmt(s.en.corrected)}  改动 ${s.en.changed}/${s.en.rows}`);
  console.log(`  lat pass p50 ${s.lat.pass.p50 ?? '—'} p90 ${s.lat.pass.p90 ?? '—'} (n=${s.lat.pass.n})  ttsStart p50 ${s.lat.ttsStart.p50 ?? '—'} p90 ${s.lat.ttsStart.p90 ?? '—'} (n=${s.lat.ttsStart.n})`);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(table, null, 2));
