#!/usr/bin/env node
// scripts/asr-probe.js — 「AI 转写字幕」预研探针：一家转写 API 到底够不够快、够不够准。
//
//   node scripts/asr-probe.js fetch-refs                  # 参照语料 → .local/asr/（gitignored）
//   node scripts/asr-probe.js words <ref>                 # whisper-1 词级时间戳 → 计时参照
//   node scripts/asr-probe.js file  <whisper|gemini|meta> <ref> [--model m]
//   node scripts/asr-probe.js live  <gemini|meta|openai> <ref> [--minutes N]
//   node scripts/asr-probe.js rescore                     # 用当前参照文本重算已存结果
//   node scripts/asr-probe.js report                      # 汇总 .local/asr/results 对照判据
//   node scripts/asr-probe.js ledger                      # build/perf-ledger.config.js 行草稿
//
// 为什么先有这个再有产品代码：用户裁定「转写速度或效果不行就放弃」。判据（计划文件 §6）
// 只能靠打真端点得到，而且要用**有参照文本的公有领域录音**，否则「效果」没有分母。
//
// 只读工具，不动注册表。结果 JSON 落在 .local/asr/results/，原始回包一并保存 —— 它们
// 就是 PR2 里 request-shape 分支的 fixture 来源。
//
// 依赖：Node ≥22（内置 WebSocket / fetch）；live 与 fetch-refs 用 ffmpeg 解码（探针独有的
// 依赖，产品代码不会有）。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.local', 'asr');
const RESULTS = path.join(DIR, 'results');
const KEYS_FILE = path.join(ROOT, '.local', 'keys.md');

const WireFormat = require(path.join(ROOT, 'extension/content/wire-format.js'));
function loadRequestShape() {
  const ctx = {
    window: { WireFormat }, WireFormat, console, setTimeout, clearTimeout,
    atob: (b64) => Buffer.from(b64, 'base64').toString('latin1'), FormData, Blob,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'extension/content/request-shape.js'), 'utf8'), ctx);
  return ctx.window.RequestShape;
}
function slot(name) {
  if (!fs.existsSync(KEYS_FILE)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS_FILE, 'utf8'));
  return m ? m[1] : null;
}

// ─── 参照语料 ────────────────────────────────────────────────────────────────
// 全部公有领域：LibriVox 录音 + Gutenberg / 维基文库文本。英文一篇故事按 29:50 与 12:00
// 截两段（Gemini 开时间戳的上限是 30 分钟）；中文两章整段。WER/CER 用「前缀对齐」计算，
// 所以截断的音频对着整篇文本也能算。
const REFS = {
  'en-30': { lang: 'en', src: 'adventureholmes_05_doyle.mp3', cutS: 1790, text: 'gutenberg-1661-v' },
  'en-12': { lang: 'en', src: 'adventureholmes_05_doyle.mp3', cutS: 720, text: 'gutenberg-1661-v' },
  'zh-20': { lang: 'zh', src: 'chaohuasishe_01_lu.mp3', cutS: 0, text: 'wikisource:狗·猫·鼠' },
  'zh-12': { lang: 'zh', src: 'chaohuasishe_02_lu.mp3', cutS: 0, text: 'wikisource:阿長與《山海經》' },
};
const AUDIO_SRC = {
  'adventureholmes_05_doyle.mp3': 'https://archive.org/download/adventures_holmes/adventureholmes_05_doyle.mp3',
  'chaohuasishe_01_lu.mp3': 'https://archive.org/download/chao_hua_si_she_jl_librivox/chaohuasishe_01_lu.mp3',
  'chaohuasishe_02_lu.mp3': 'https://archive.org/download/chao_hua_si_she_jl_librivox/chaohuasishe_02_lu.mp3',
};

async function fetchText(spec) {
  if (spec === 'gutenberg-1661-v') {
    const r = await fetch('https://www.gutenberg.org/cache/epub/1661/pg1661.txt');
    const all = await r.text();
    const a = all.indexOf('\nV. THE FIVE ORANGE PIPS');
    const b = all.indexOf('\nVI. THE MAN WITH THE TWISTED LIP');
    if (a < 0 || b < 0) throw new Error('Gutenberg 1661 里找不到第五篇的边界');
    return all.slice(a, b).replace(/^\s*V\. THE FIVE ORANGE PIPS\s*/, '');
  }
  if (spec.startsWith('wikisource:')) {
    const page = spec.slice('wikisource:'.length);
    const u = 'https://zh.wikisource.org/w/api.php?action=parse&prop=text&variant=zh-cn&format=json&page=' + encodeURIComponent(page);
    const d = await (await fetch(u)).json();
    if (!d.parse) throw new Error('维基文库：' + JSON.stringify(d.error || d).slice(0, 200));
    let t = d.parse.text['*'].replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
    // 只取正文段落；注释、导航、脚注都不是朗读者会念的
    const ps = [...t.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    const strip = (h) => h.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    // 维基文库的正文是繁体，而朗读者念的是普通话、转写引擎吐的是简体；API 的 variant=zh-cn
    // 对这些页面不生效（实测原样返回）。用 OpenCC 的字表做繁→简（字级，足够算 CER）。
    return t2s(ps.map(strip).filter(Boolean).join('\n'));
  }
  throw new Error('未知文本来源 ' + spec);
}

let T2S = null;
function t2s(text) {
  if (!T2S) {
    const dict = path.join(DIR, 'TSCharacters.txt');
    if (!fs.existsSync(dict)) {
      // OpenCC 的繁→简字表（Apache-2.0）；只在生成参照文本时用一次
      const b = execFileSync('curl', ['-sL', '--max-time', '30', 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt']);
      fs.writeFileSync(dict, b);
    }
    T2S = new Map();
    for (const l of fs.readFileSync(dict, 'utf8').split('\n')) { const [t, s] = l.split('\t'); if (t && s) T2S.set(t, s.split(' ')[0]); }
  }
  return [...text].map((c) => T2S.get(c) || c).join('');
}
function sh(cmd, args) { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
function ffmpeg(args) { sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }

async function fetchRefs() {
  fs.mkdirSync(RESULTS, { recursive: true });
  for (const [name, url] of Object.entries(AUDIO_SRC)) {
    const p = path.join(DIR, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 1e6) { console.log('已有', name); continue; }
    console.log('下载', name);
    const r = await fetch(url);
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
  for (const [id, ref] of Object.entries(REFS)) {
    const base = path.join(DIR, id);
    if (!fs.existsSync(base + '.txt')) {
      console.log('文本', id, ref.text);
      fs.writeFileSync(base + '.txt', await fetchText(ref.text));
    }
    // 上传用：16k 单声道 48kbps —— 30 分钟 ≈ 10.7MB，四家的上限都进得去，且四家收到的字节一致
    if (!fs.existsSync(base + '.mp3')) {
      console.log('转码', id);
      const cut = ref.cutS ? ['-t', String(ref.cutS)] : [];
      ffmpeg(['-i', path.join(DIR, ref.src), ...cut, '-ac', '1', '-ar', '16000', '-b:a', '48k', base + '.mp3']);
    }
    // 流式用：原始 16k PCM16
    if (!fs.existsSync(base + '.pcm')) {
      ffmpeg(['-i', base + '.mp3', '-f', 's16le', '-ac', '1', '-ar', '16000', base + '.pcm']);
    }
    const secs = fs.statSync(base + '.pcm').size / 32000;
    console.log(`  ${id}: ${(secs / 60).toFixed(1)} 分钟, 文本 ${fs.readFileSync(base + '.txt', 'utf8').length} 字符`);
  }
}

// ─── 文本归一化与对齐 ────────────────────────────────────────────────────────
// 英文：NFKC、小写、去标点（保留词内撇号）、按空白分词。中文：去掉一切空白与标点，按字。
function tokens(text, lang) {
  const s = String(text || '').normalize('NFKC');
  if (lang === 'zh') return [...s.replace(/[\s\p{P}\p{S}]+/gu, '')];
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/(^|\s)'+|'+(\s|$)/g, ' ').split(/\s+/).filter(Boolean);
}
// 前缀对齐的编辑距离：hyp 对 ref 的**某个前缀**取最小距离（音频可能只是全文的开头一截）。
// 返回 { dist, refLen, wer, hypToRef }：hypToRef[i] = hyp 第 i 个 token 对上的 ref 下标（替换/匹配），
// 插入的 token 继承前一个。回溯表按字节存，5000×9000 也只有 45MB。
function alignPrefix(hyp, ref) {
  const n = hyp.length, m = ref.length;
  const W = m + 1;
  let prev = new Uint32Array(W), cur = new Uint32Array(W);
  const back = new Uint8Array((n + 1) * W); // 0 diag, 1 up(del hyp / insertion), 2 left(ref skipped)
  for (let j = 0; j <= m; j++) { prev[j] = j; back[j] = 2; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; back[i * W] = 1;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (hyp[i - 1] === ref[j - 1] ? 0 : 1);
      const up = prev[j] + 1, left = cur[j - 1] + 1;
      let best = sub, b = 0;
      if (up < best) { best = up; b = 1; }
      if (left < best) { best = left; b = 2; }
      cur[j] = best; back[i * W + j] = b;
    }
    [prev, cur] = [cur, prev];
  }
  // 取最小的前缀 —— 并列时取更长的前缀（假设整段都被念了）
  let bj = 0, bd = Infinity;
  for (let j = 0; j <= m; j++) if (prev[j] <= bd) { bd = prev[j]; bj = j; }
  const hypToRef = new Int32Array(n).fill(-1);
  let i = n, j = bj;
  while (i > 0) {
    const b = back[i * W + j];
    if (b === 0) { hypToRef[i - 1] = j - 1; i--; j--; }
    else if (b === 1) { hypToRef[i - 1] = Math.max(0, j - 1); i--; }
    else { j--; }
  }
  return { dist: bd, refLen: bj, rate: bj ? bd / bj : 1, hypToRef };
}
// 参照文本的句末 token 下标（英文：句末标点前的词；中文：句号等前的字）
function sentenceEnds(text, lang) {
  const ends = [];
  const s = String(text).normalize('NFKC');
  let count = 0;
  if (lang === 'zh') {
    for (const ch of s) {
      if (/[\s\p{P}\p{S}]/u.test(ch)) { if (/[。！？…；]/.test(ch) && count) ends.push(count - 1); }
      else count++;
    }
  } else {
    for (const w of s.split(/\s+/)) {
      const t = tokens(w, 'en');
      if (!t.length) continue;
      count += t.length;
      if (/[.!?…]["'”’)\]]*$/.test(w)) ends.push(count - 1);
    }
  }
  return [...new Set(ends)];
}
const pct = (x) => (x * 100).toFixed(1) + '%';
const p90 = (arr) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : null; };

// ─── 各家：文件式 ────────────────────────────────────────────────────────────
// 返回 { ms, cues:[{start,end,text}], words?:[{w,start,end}], text, raw, cost? }。
// 这里的 gemini/meta 请求体是 PR2 要搬进 request-shape.js 的原型；whisper 走的就是产品现有的
// transcribe-compat 形状（RequestShape.build），只追加 verbose_json 两个字段。
function stt(id) { return require(path.join(ROOT, 'build/stt.config.js')).find((e) => e.id === id); }

async function fileWhisper(mp3, lang, model) {
  const RS = loadRequestShape();
  const eng = stt('openai_transcribe');
  const url = eng.defaultEndpoint;
  const key = slot('sttApiKey') || slot('key_stt_openai_transcribe');
  if (!key) throw new Error('.local/keys.md 里没有 sttApiKey');
  const fmt = WireFormat.formatFor(url, eng.type);
  const req = RS.build(fmt, { url, apiKey: key, model: model || eng.defaultModel,
    file: new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), filename: 'audio.mp3', language: lang });
  req.body.append('response_format', 'verbose_json');
  req.body.append('timestamp_granularities[]', 'segment');
  req.body.append('timestamp_granularities[]', 'word');
  const t0 = Date.now();
  const resp = await fetch(url, { method: 'POST', headers: req.headers, body: req.body });
  const ms = Date.now() - t0;
  const d = await resp.json();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${JSON.stringify(d).slice(0, 300)}`);
  const cues = (d.segments || []).map((s) => ({ start: Math.round(s.start * 1000), end: Math.round(s.end * 1000), text: String(s.text || '').trim() })).filter((c) => c.text);
  const words = (d.words || []).map((w) => ({ w: w.word, start: Math.round(w.start * 1000), end: Math.round(w.end * 1000) }));
  return { ms, cues, words, text: d.text || '', raw: d };
}

async function fileGemini(mp3, lang, model) {
  const key = slot('key_stt_gemini');
  if (!key) throw new Error('.local/keys.md 里 key_stt_gemini 是空的');
  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const buf = fs.readFileSync(mp3);
  const body = {
    model: model || 'gemini-3.5-transcribe',
    input: [{ type: 'audio', data: buf.toString('base64'), mime_type: 'audio/mp3' }],
    generation_config: { transcription_config: {
      language_codes: lang === 'zh' ? ['cmn-Hans-CN'] : ['en-US'],
      mode: 'smart', timestamp_granularities: ['word'],
    } },
  };
  const t0 = Date.now();
  const resp = await fetch(url, { method: 'POST', body: JSON.stringify(body),
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' } });
  const ms = Date.now() - t0;
  const d = await resp.json();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${JSON.stringify(d).slice(0, 400)}`);
  // 词级标注：steps[].content[].annotations[] type word_info {text, speaker, start_offset, end_offset}
  const words = [];
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.type === 'word_info' && x.text != null) {
      words.push({ w: x.text, speaker: x.speaker, start: offMs(x.start_offset), end: offMs(x.end_offset) });
    }
    Object.values(x).forEach(walk);
  };
  walk(d.steps); walk(d.output);
  const text = d.output_text || (Array.isArray(d.output) ? d.output.map((o) => o.text || '').join('') : '');
  return { ms, cues: wordsToCues(words, lang), words, text, raw: d, usage: d.usage };
}
// Gemini 的 offset 形如 "12.345s" 或 {seconds, nanos}
function offMs(o) {
  if (o == null) return 0;
  if (typeof o === 'number') return Math.round(o * 1000);
  if (typeof o === 'string') return Math.round(parseFloat(o) * 1000);
  return Math.round((o.seconds || 0) * 1000 + (o.nanos || 0) / 1e6);
}
// 词 → cue：说话人切换 / 间隔 > 700ms / 句末标点 / ≥ 14 词 就切 —— PR2 extractCues 的原型
function wordsToCues(words, lang) {
  const out = []; let cur = null;
  const join = (a, b) => lang === 'zh' ? a + b : (a ? a + ' ' + b : b);
  for (const w of words) {
    const gap = cur ? w.start - cur.end : 0;
    if (cur && (gap > 700 || (w.speaker != null && w.speaker !== cur.speaker) || cur.n >= 14 || /[.!?。！？]["'”’)\]]?$/.test(cur.text))) { out.push(cur); cur = null; }
    if (!cur) cur = { start: w.start, end: w.end, text: w.w, speaker: w.speaker, n: 1 };
    else { cur.text = join(cur.text, w.w); cur.end = w.end; cur.n++; }
  }
  if (cur) out.push(cur);
  return out.map(({ start, end, text }) => ({ start, end, text: text.trim() }));
}

async function fileMeta(mp3, lang, model) {
  const key = slot('key_stt_meta');
  if (!key) throw new Error('.local/keys.md 里 key_stt_meta 是空的');
  const url = 'https://api.meta.ai/v1/asr/transcribe';
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model', model || 'muse-voice-transcribe-1.0');
  const t0 = Date.now();
  const resp = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  const ms = Date.now() - t0;
  const txt = await resp.text();
  let d; try { d = JSON.parse(txt); } catch (_) { throw new Error(`HTTP ${resp.status} non-JSON: ${txt.slice(0, 300)}`); }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${txt.slice(0, 400)}`);
  // 回包形状未见过文档 —— 尽量宽地找 turns[]/segments[]，原始回包一定保存
  const turns = d.turns || d.segments || (d.result && (d.result.turns || d.result.segments)) || [];
  const cues = turns.map((t) => ({ start: offMs(t.start ?? t.start_time ?? t.startMs / 1000), end: offMs(t.end ?? t.end_time ?? t.endMs / 1000), text: String(t.text || t.transcript || '').trim() })).filter((c) => c.text);
  const text = d.text || d.transcript || cues.map((c) => c.text).join(lang === 'zh' ? '' : ' ');
  return { ms, cues, words: [], text, raw: d };
}

// ─── 各家：流式 ──────────────────────────────────────────────────────────────
// 按墙钟以 1× 速度推 100ms 一块的 PCM，记录每个 final 的到达时刻；后面用 words.json 把
// final 的最后一个词对回音频时间，滞后 = 到达墙钟 − (开始墙钟 + 音频时间)。
// 返回 { finals:[{text, arrivalMs, startMs?, endMs?}], seams, closes, errors }。
function ring(seconds) { // 最近 N 秒 PCM，重连时重放
  const cap = seconds * 32000; const chunks = []; let size = 0;
  return { push(b) { chunks.push(b); size += b.length; while (size > cap && chunks.length > 1) size -= chunks.shift().length; }, all() { return Buffer.concat(chunks); } };
}

async function liveGemini(pcm, lang, minutes, model) {
  const key = slot('key_stt_gemini');
  if (!key) throw new Error('.local/keys.md 里 key_stt_gemini 是空的');
  const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(key);
  const setup = { setup: { model: 'models/' + (model || 'gemini-3.5-transcribe-live'),
    generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { languageCodes: lang === 'zh' ? ['cmn-Hans-CN'] : ['en-US'], mode: 'SMART' } } };
  const out = { finals: [], interims: 0, seams: 0, closes: [], errors: [], raw: [] };
  const buf = ring(2);
  let ws = null, sock = 0;
  const t0 = Date.now();
  const open = () => new Promise((resolve, reject) => {
    const w = new WebSocket(url);
    const id = ++sock;
    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
    w.onopen = () => { w.send(JSON.stringify(setup)); };
    w.onmessage = async (ev) => {
      const txt = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8');
      let m; try { m = JSON.parse(txt); } catch (_) { return; }
      if (out.raw.length < 40) out.raw.push(m);
      if (m.setupComplete) { clearTimeout(timer); resolve(w); return; }
      const sc = m.serverContent || {};
      if (sc.interimInputTranscription) out.interims++;
      if (sc.inputTranscription && sc.inputTranscription.text) {
        out.finals.push({ text: sc.inputTranscription.text, arrivalMs: Date.now() - t0, sock: id });
      }
      if (m.error) out.errors.push(JSON.stringify(m.error).slice(0, 200));
    };
    w.onerror = (e) => { out.errors.push('ws error ' + (e.message || '')); };
    w.onclose = (e) => { out.closes.push({ code: e.code, reason: e.reason, atMs: Date.now() - t0, sock: id }); };
    ws = w;
  });
  await open();
  const total = Math.min(pcm.length, minutes * 60 * 32000);
  const CH = 3200; // 100ms
  let sent = 0, nextReconnect = 570 * 1000; // 9:30 预重连
  for (let off = 0; off < total; off += CH) {
    const chunk = pcm.subarray(off, Math.min(total, off + CH));
    buf.push(chunk);
    const due = t0 + (off / 32000) * 1000;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (Date.now() - t0 >= nextReconnect) {
      out.seams++; nextReconnect += 570 * 1000;
      const old = ws;
      try { await open(); } catch (e) { out.errors.push('reconnect failed: ' + e.message); break; }
      try { old.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (_) {}
      setTimeout(() => { try { old.close(); } catch (_) {} }, 3000);
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: buf.all().toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    }
    if (ws.readyState !== 1) { out.errors.push('socket not open at ' + off); break; }
    ws.send(JSON.stringify({ realtimeInput: { audio: { data: Buffer.from(chunk).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    sent = off + chunk.length;
  }
  try { ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (_) {}
  await new Promise((r) => setTimeout(r, 4000));
  try { ws.close(); } catch (_) {}
  out.sentMs = (sent / 32000) * 1000;
  return out;
}

async function liveMeta(pcm, lang, minutes, model) {
  const key = slot('key_stt_meta');
  if (!key) throw new Error('.local/keys.md 里 key_stt_meta 是空的');
  // Node 22 的 WebSocket 是 undici 实现，接受 { headers } 初始化项；浏览器里没有这条路，
  // 所以 PR3 得看 Meta 有没有 query/子协议鉴权 —— 这里只求先打通。
  const url = 'wss://api.meta.ai/v1/asr/realtime';
  const out = { finals: [], interims: 0, seams: 0, closes: [], errors: [], raw: [] };
  const t0 = Date.now();
  const ws = await new Promise((resolve, reject) => {
    let w;
    try { w = new WebSocket(url, { headers: { Authorization: 'Bearer ' + key } }); }
    catch (e) { reject(e); return; }
    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
    w.onopen = () => {
      clearTimeout(timer);
      w.send(JSON.stringify({ type: 'config', model: model || 'muse-voice-transcribe-1.0', mode: 'ENDPOINTING',
        sample_rate: 16000, encoding: 'pcm_s16le', languageBias: lang === 'zh' ? 'zh' : 'en' }));
      resolve(w);
    };
    w.onmessage = async (ev) => {
      const txt = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8');
      let m; try { m = JSON.parse(txt); } catch (_) { return; }
      if (out.raw.length < 60) out.raw.push(m);
      const type = m.type || m.event || '';
      if (/partial/i.test(type)) out.interims++;
      if (m.final === true || /final|speechComplete/i.test(type)) {
        const text = m.text || m.transcript || (m.turn && m.turn.text) || '';
        if (text) out.finals.push({ text, arrivalMs: Date.now() - t0, startMs: m.start != null ? offMs(m.start) : undefined, endMs: m.end != null ? offMs(m.end) : undefined, speaker: m.speaker });
      }
      if (m.error) out.errors.push(JSON.stringify(m.error).slice(0, 200));
    };
    w.onerror = (e) => { out.errors.push('ws error ' + (e.message || '')); reject(new Error('ws error')); };
    w.onclose = (e) => { out.closes.push({ code: e.code, reason: e.reason, atMs: Date.now() - t0 }); };
  });
  const total = Math.min(pcm.length, minutes * 60 * 32000);
  const CH = 3200;
  let sent = 0;
  for (let off = 0; off < total; off += CH) {
    const chunk = pcm.subarray(off, Math.min(total, off + CH));
    const due = t0 + (off / 32000) * 1000;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (ws.readyState !== 1) { out.errors.push('socket not open at ' + off); break; }
    ws.send(chunk);
    sent = off + chunk.length;
  }
  try { ws.send(JSON.stringify({ type: 'end' })); } catch (_) {}
  await new Promise((r) => setTimeout(r, 4000));
  try { ws.close(); } catch (_) {}
  out.sentMs = (sent / 32000) * 1000;
  return out;
}

// OpenAI Realtime（转写会话）。浏览器里没有请求头可用，官方给的是子协议鉴权
// `openai-insecure-api-key.<key>` —— 我们是用户自带 key，这条路正合适；Node 里同样走子协议，
// 让探针与产品打的是同一条路。会话形状按 2026-09 文档：type=transcription，pcm 24k。
async function liveOpenai(pcm, lang, minutes, model) {
  const key = slot('sttApiKey') || slot('key_stt_openai_transcribe');
  if (!key) throw new Error('.local/keys.md 里没有 sttApiKey');
  const rate = 24000;
  // 16k → 24k：线性插值（探针够用；产品里抓到的是 AudioContext 采样率，重采样方向相同）
  const src16 = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const out24 = new Int16Array(Math.floor(src16.length * 1.5));
  for (let i = 0; i < out24.length; i++) { const x = i / 1.5; const a = Math.floor(x); const b = Math.min(src16.length - 1, a + 1); out24[i] = Math.round(src16[a] + (src16[b] - src16[a]) * (x - a)); }
  const pcm24 = Buffer.from(out24.buffer);
  const url = 'wss://api.openai.com/v1/realtime?intent=transcription';
  const out = { finals: [], interims: 0, seams: 0, closes: [], errors: [], raw: [] };
  const t0 = Date.now();
  const items = new Map(); // item_id → { startMs } 来自 speech_started
  let pending = '';
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(url, ['realtime', 'openai-insecure-api-key.' + key]);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
    w.onopen = () => {
      w.send(JSON.stringify({ type: 'session.update', session: {
        type: 'transcription',
        audio: { input: {
          format: { type: 'audio/pcm', rate },
          transcription: { model: model || 'gpt-live-transcribe', ...(lang ? { languages: [lang] } : {}) },
          turn_detection: null,
        } },
      } }));
    };
    w.onmessage = async (ev) => {
      const txt = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8');
      let m; try { m = JSON.parse(txt); } catch (_) { return; }
      if (out.raw.length < 60) out.raw.push(m);
      const type = m.type || '';
      if (type === 'session.updated' || type === 'transcription_session.updated') { clearTimeout(timer); resolve(w); }
      else if (type === 'session.created' || type === 'transcription_session.created') { /* wait for updated */ }
      else if (type === 'input_audio_buffer.speech_started') items.set(m.item_id, { startMs: m.audio_start_ms });
      else if (type === 'input_audio_buffer.speech_stopped') { const it = items.get(m.item_id) || {}; it.endMs = m.audio_end_ms; items.set(m.item_id, it); }
      // gpt-live-transcribe 关掉 turn_detection 后是**逐词 delta 流**，带标点；completed 只在 commit 时来一次。
      // 字幕用的就是这条流：按句末标点在到达时切句 —— 与产品里 createCueMerger 的闭合规则同一个。
      else if (type === 'conversation.item.input_audio_transcription.delta') {
        out.interims++;
        pending += m.delta || '';
        const mm = /^([\s\S]*?[.!?。！？…]["'”’)\]]?)(\s|$)/.exec(pending);
        if (mm) { out.finals.push({ text: mm[1].trim(), arrivalMs: Date.now() - t0, item: m.item_id }); pending = pending.slice(mm[0].length); }
      }
      else if (type === 'conversation.item.input_audio_transcription.completed') {
        if (pending.trim()) { out.finals.push({ text: pending.trim(), arrivalMs: Date.now() - t0, item: m.item_id }); pending = ''; }
        out.completedAt = Date.now() - t0;
      }
      else if (type === 'error') { out.errors.push(JSON.stringify(m.error || m).slice(0, 300)); clearTimeout(timer); reject(new Error('server error: ' + JSON.stringify(m.error || m).slice(0, 300))); }
    };
    w.onerror = (e) => { out.errors.push('ws error ' + (e.message || '')); clearTimeout(timer); reject(new Error('ws error ' + (e.message || ''))); };
    w.onclose = (e) => { out.closes.push({ code: e.code, reason: e.reason, atMs: Date.now() - t0 }); };
  });
  const total = Math.min(pcm24.length, minutes * 60 * rate * 2);
  const CH = rate * 2 / 10; // 100ms
  let sent = 0;
  for (let off = 0; off < total; off += CH) {
    const chunk = pcm24.subarray(off, Math.min(total, off + CH));
    const due = t0 + (off / (rate * 2)) * 1000;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (ws.readyState !== 1) { out.errors.push('socket not open at ' + off); break; }
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(chunk).toString('base64') }));
    sent = off + chunk.length;
  }
  try { ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch (_) {}
  await new Promise((r) => setTimeout(r, 5000));
  try { ws.close(); } catch (_) {}
  out.sentMs = (sent / (rate * 2)) * 1000;
  return out;
}

// ─── 评分 ────────────────────────────────────────────────────────────────────
function loadRef(id) {
  const ref = REFS[id];
  if (!ref) throw new Error('未知语料 ' + id + '；可选 ' + Object.keys(REFS).join(', '));
  const base = path.join(DIR, id);
  if (!fs.existsSync(base + '.txt')) throw new Error('先跑 fetch-refs');
  return { ...ref, id, base, text: fs.readFileSync(base + '.txt', 'utf8'), mp3: base + '.mp3', pcm: base + '.pcm',
    secs: fs.statSync(base + '.pcm').size / 32000 };
}
// words.json：whisper-1 的词时间戳，作为**独立于被测厂商**的计时参照
function loadWords(id) {
  const p = path.join(DIR, id + '.words.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
// ref token 下标 → 音频时间（ms）：把参照词序列对上 ref，再把时间投影过去
function refTimes(ref, words) {
  const rt = tokens(ref.text, ref.lang);
  const wt = []; const wIdx = [];
  words.forEach((w, i) => { for (const t of tokens(w.w, ref.lang)) { wt.push(t); wIdx.push(i); } });
  const al = alignPrefix(wt, rt);
  const times = new Float64Array(rt.length).fill(NaN);
  for (let i = 0; i < wt.length; i++) { const j = al.hypToRef[i]; if (j >= 0) times[j] = words[wIdx[i]].end; }
  // 没对上的位置用前后插值
  let last = NaN;
  for (let j = 0; j < times.length; j++) { if (isNaN(times[j])) times[j] = last; else last = times[j]; }
  return times;
}
// 产品里 extractCues 会做的事的原型：把一条 cue 在句末标点处切开，时间按字符比例插值。
// whisper 的 segment、Meta 的 turn 都不按句子切，这一步之后的边界才是叠层会用的边界。
function refineCues(cues, lang) {
  const out = [];
  for (const c of cues) {
    const parts = c.text.match(/[^.!?。！？…]+[.!?。！？…]+["'”’)\]]*|[^.!?。！？…]+$/g) || [c.text];
    const total = parts.reduce((a, p) => a + p.length, 0) || 1;
    let t = c.start;
    for (const p of parts) {
      const dur = (c.end - c.start) * (p.length / total);
      const txt = p.trim(); if (!txt) { t += dur; continue; }
      out.push({ start: Math.round(t), end: Math.round(t + dur), text: txt });
      t += dur;
    }
  }
  return out;
}
function scoreCues(ref, cues, words) {
  const raw = scoreCuesRaw(ref, cues, words);
  const fine = scoreCuesRaw(ref, refineCues(cues, ref.lang), words);
  return { ...raw, refined: { cues: fine.cues, boundaryHit: fine.boundaryHit, cuesEndWithTerminal: fine.cuesEndWithTerminal, meanCueS: fine.meanCueS } };
}
function scoreCuesRaw(ref, cues, words) {
  const rt = tokens(ref.text, ref.lang);
  const ht = []; const cueOf = [];
  cues.forEach((c, i) => { for (const t of tokens(c.text, ref.lang)) { ht.push(t); cueOf.push(i); } });
  const al = alignPrefix(ht, rt);
  const res = { tokens: ht.length, refTokens: al.refLen, errRate: al.rate, cues: cues.length };
  // 句界：参照句末 token 对上的 hyp token 是不是某条 cue 的最后一个 token（允许差 1 个）
  const ends = sentenceEnds(ref.text, ref.lang).filter((j) => j < al.refLen);
  const refToHyp = new Int32Array(rt.length).fill(-1);
  for (let i = ht.length - 1; i >= 0; i--) if (al.hypToRef[i] >= 0) refToHyp[al.hypToRef[i]] = i;
  let hit = 0;
  for (const j of ends) {
    const i = refToHyp[j]; if (i < 0) continue;
    const isEnd = (k) => k >= 0 && k < ht.length && (k === ht.length - 1 || cueOf[k] !== cueOf[k + 1]);
    if (isEnd(i) || isEnd(i - 1) || isEnd(i + 1)) hit++;
  }
  res.sentenceEnds = ends.length; res.boundaryHit = ends.length ? hit / ends.length : 0;
  res.cuesEndWithTerminal = cues.length ? cues.filter((c) => /[.!?。！？…]["'”’)\]]?$/.test(c.text.trim())).length / cues.length : 0;
  // 时间轴健全：有序、无负长、平均时长
  let sorted = true; for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].start) sorted = false;
  res.sorted = sorted;
  res.meanCueS = cues.length ? cues.reduce((a, c) => a + (c.end - c.start), 0) / cues.length / 1000 : 0;
  // 时间戳准确度（有 words.json 时）：cue 末 token 的参照时间 vs cue.end
  if (words) {
    const times = refTimes(ref, words);
    const diffs = [];
    cues.forEach((c, i) => { let k = ht.length - 1; for (let x = ht.length - 1; x >= 0; x--) if (cueOf[x] === i) { k = x; break; }
      const j = al.hypToRef[k]; if (j >= 0 && !isNaN(times[j])) diffs.push(Math.abs(c.end - times[j])); });
    res.timestampAbsErrP90Ms = p90(diffs);
  }
  return res;
}
function scoreLive(ref, live, words) {
  const rt = tokens(ref.text, ref.lang);
  const ht = []; const finOf = [];
  live.finals.forEach((f, i) => { for (const t of tokens(f.text, ref.lang)) { ht.push(t); finOf.push(i); } });
  const al = alignPrefix(ht, rt);
  const res = { finals: live.finals.length, interims: live.interims, tokens: ht.length, refTokens: al.refLen, errRate: al.rate,
    seams: live.seams, closes: live.closes, errors: live.errors.slice(0, 5), sentMinutes: (live.sentMs / 60000).toFixed(1) };
  res.finalsEndWithTerminal = live.finals.length ? live.finals.filter((f) => /[.!?。！？…]["'”’)\]]?$/.test(f.text.trim())).length / live.finals.length : 0;
  res.meanFinalTokens = live.finals.length ? ht.length / live.finals.length : 0;
  // 覆盖：送了 sentMs 的音频，对上的参照应当到相应位置；丢句 = 参照里连续 ≥ 8 个 token 没被任何 final 对上
  const covered = new Uint8Array(rt.length);
  for (let i = 0; i < ht.length; i++) if (al.hypToRef[i] >= 0) covered[al.hypToRef[i]] = 1;
  let gaps = 0, run = 0;
  for (let j = 0; j < al.refLen; j++) { if (covered[j]) { if (run >= 8) gaps++; run = 0; } else run++; }
  if (run >= 8) gaps++;
  res.uncoveredRuns8 = gaps;
  if (words) {
    const times = refTimes(ref, words);
    const lags = [];
    live.finals.forEach((f, i) => {
      let k = -1; for (let x = ht.length - 1; x >= 0; x--) if (finOf[x] === i) { k = x; break; }
      if (k < 0) return;
      const j = al.hypToRef[k]; if (j < 0 || isNaN(times[j])) return;
      lags.push(f.arrivalMs - times[j]);
    });
    res.lagSamples = lags.length;
    res.lagP50Ms = lags.length ? [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] : null;
    res.lagP90Ms = p90(lags);
    res.lagMaxMs = lags.length ? Math.max(...lags) : null;
  }
  return res;
}

// ─── 命令 ────────────────────────────────────────────────────────────────────
function saveResult(name, obj) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const p = path.join(RESULTS, name + '.json');
  fs.writeFileSync(p, JSON.stringify(obj, null, 1));
  return p;
}
const THRESH = { fileMs30: 90000, lagP90: 2500, werEn: 0.08, cerZh: 0.12, boundary: 0.8, terminal: 0.7 };

async function cmdWords(id) {
  const ref = loadRef(id);
  console.log(`whisper-1 词级时间戳：${id}（${(ref.secs / 60).toFixed(1)} 分钟）`);
  const r = await fileWhisper(ref.mp3, ref.lang);
  fs.writeFileSync(path.join(DIR, id + '.words.json'), JSON.stringify(r.words));
  const sc = scoreCues(ref, r.cues, null);
  console.log(`  ${r.ms}ms, ${r.words.length} 词, ${r.cues.length} 段, 错误率 ${pct(sc.errRate)}（参照 ${sc.refTokens} token）`);
  saveResult(`file-whisper-${id}`, { vendor: 'whisper', model: 'whisper-1', ref: id, ms: r.ms, score: sc, cues: r.cues, rawSample: r.raw && { text: r.text, segments: (r.raw.segments || []).slice(0, 3), words: (r.raw.words || []).slice(0, 5) } });
}
async function cmdFile(vendor, id, opts) {
  const ref = loadRef(id);
  const fn = { whisper: fileWhisper, gemini: fileGemini, meta: fileMeta }[vendor];
  if (!fn) throw new Error('vendor 可选 whisper|gemini|meta');
  console.log(`文件式 ${vendor} × ${id}（${(ref.secs / 60).toFixed(1)} 分钟，${(fs.statSync(ref.mp3).size / 1048576).toFixed(1)}MB）`);
  let r;
  try { r = await fn(ref.mp3, ref.lang, opts.model); }
  catch (e) {
    console.log('  ✗ ' + e.message);
    saveResult(`file-${vendor}${opts.model ? '-' + opts.model.replace(/[^\w.-]+/g, '_') : ''}-${id}`, { vendor, model: opts.model || null, ref: id, error: e.message, date: new Date().toISOString() });
    return;
  }
  const sc = scoreCues(ref, r.cues, vendor === 'whisper' ? null : loadWords(id));
  const thr = ref.lang === 'zh' ? THRESH.cerZh : THRESH.werEn;
  console.log(`  墙钟 ${r.ms}ms${ref.secs > 1500 ? (r.ms <= THRESH.fileMs30 ? ' ✓' : ' ✗(>90s)') : ''}`);
  console.log(`  ${ref.lang === 'zh' ? 'CER' : 'WER'} ${pct(sc.errRate)} ${sc.errRate <= thr ? '✓' : '✗'}（hyp ${sc.tokens} / ref ${sc.refTokens} token）`);
  console.log(`  cue ${sc.cues} 条，平均 ${sc.meanCueS.toFixed(1)}s，有序 ${sc.sorted}；原始句界命中 ${pct(sc.boundaryHit)}，以句末标点收尾 ${pct(sc.cuesEndWithTerminal)}`);
  console.log(`  按句末标点重切后 ${sc.refined.cues} 条，平均 ${sc.refined.meanCueS.toFixed(1)}s，句界命中 ${pct(sc.refined.boundaryHit)} ${sc.refined.boundaryHit >= THRESH.boundary ? '✓' : '✗'}`);
  if (sc.timestampAbsErrP90Ms != null) console.log(`  时间戳 vs whisper 参照 p90 误差 ${sc.timestampAbsErrP90Ms}ms`);
  if (r.usage) console.log('  usage ' + JSON.stringify(r.usage).slice(0, 200));
  const p = saveResult(`file-${vendor}${opts.model ? '-' + opts.model.replace(/[^\w.-]+/g, '_') : ''}-${id}`, { vendor, model: opts.model || null, ref: id, date: new Date().toISOString(), ms: r.ms, score: sc, cues: r.cues, text: r.text, usage: r.usage, raw: r.raw });
  console.log('  → ' + path.relative(ROOT, p));
}
async function cmdLive(vendor, id, opts) {
  const ref = loadRef(id);
  const fn = { gemini: liveGemini, meta: liveMeta, openai: liveOpenai }[vendor];
  if (!fn) throw new Error('vendor 可选 gemini|meta|openai');
  const minutes = opts.minutes || Math.min(12, ref.secs / 60);
  const words = loadWords(id);
  if (!words) console.log('  （没有 words.json，先跑 `words ' + id + '` 才能算滞后）');
  console.log(`流式 ${vendor} × ${id}，推 ${minutes} 分钟（墙钟同长，请等待）`);
  const pcm = fs.readFileSync(ref.pcm);
  let live;
  try { live = await fn(pcm, ref.lang, minutes, opts.model); }
  catch (e) {
    console.log('  ✗ ' + e.message);
    saveResult(`live-${vendor}-${id}`, { vendor, ref: id, error: e.message, date: new Date().toISOString() });
    return;
  }
  const sc = scoreLive(ref, live, words);
  const thr = ref.lang === 'zh' ? THRESH.cerZh : THRESH.werEn;
  console.log(`  final ${sc.finals} 条（interim ${sc.interims}），平均 ${sc.meanFinalTokens.toFixed(1)} token，以句末标点收尾 ${pct(sc.finalsEndWithTerminal)} ${sc.finalsEndWithTerminal >= THRESH.terminal ? '✓' : '✗'}`);
  console.log(`  ${ref.lang === 'zh' ? 'CER' : 'WER'} ${pct(sc.errRate)} ${sc.errRate <= thr ? '✓' : '✗'}；未覆盖段(≥8 token) ${sc.uncoveredRuns8}；接缝 ${sc.seams}；关闭 ${JSON.stringify(sc.closes)}`);
  if (sc.lagP90Ms != null) console.log(`  滞后 p50 ${sc.lagP50Ms}ms / p90 ${sc.lagP90Ms}ms / max ${sc.lagMaxMs}ms（${sc.lagSamples} 样本）${sc.lagP90Ms <= THRESH.lagP90 ? ' ✓' : ' ✗(>2.5s)'}`);
  if (sc.errors.length) console.log('  错误：' + sc.errors.join(' | '));
  const p = saveResult(`live-${vendor}-${id}`, { vendor, model: opts.model || null, ref: id, date: new Date().toISOString(), minutes, score: sc, finals: live.finals, rawSample: live.raw });
  console.log('  → ' + path.relative(ROOT, p));
}
function cmdReport() {
  if (!fs.existsSync(RESULTS)) { console.log('还没有结果'); return; }
  console.log('| 结果 | 墙钟/滞后p90 | 错误率 | 句界/收尾 | 备注 |\n|---|---|---|---|---|');
  for (const f of fs.readdirSync(RESULTS).sort().filter((x) => /^(file|live)-.*\.json$/.test(x))) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
    if (r.error) { console.log(`| ${f} | — | — | — | ✗ ${r.error.slice(0, 80)} |`); continue; }
    const s = r.score;
    const lang = (REFS[r.ref] || {}).lang;
    const thr = lang === 'zh' ? THRESH.cerZh : THRESH.werEn;
    // 句界「可用」二选一：重切后命中 ≥ 80%，或 cue 以句末标点收尾 ≥ 70%（中文原文的「；」「。」常被
    // 引擎念成逗号 —— 那是标点风格差异，cue 本身仍是整句）
    if (f.startsWith('file-')) {
      const okB = s.refined.boundaryHit >= THRESH.boundary || s.refined.cuesEndWithTerminal >= THRESH.terminal;
      console.log(`| ${f} | ${r.ms}ms | ${pct(s.errRate)} ${s.errRate <= thr ? '✓' : '✗'} | 命中 ${pct(s.refined.boundaryHit)} / 收尾 ${pct(s.refined.cuesEndWithTerminal)} ${okB ? '✓' : '✗'} | ${s.cues}→${s.refined.cues} cue，均 ${s.refined.meanCueS.toFixed(1)}s |`);
    }
    else console.log(`| ${f} | ${s.lagP90Ms != null ? s.lagP90Ms + 'ms' : '?'} | ${pct(s.errRate)} ${s.errRate <= thr ? '✓' : '✗'} | ${pct(s.finalsEndWithTerminal)} | ${s.finals} final, 接缝 ${s.seams}, 未覆盖 ${s.uncoveredRuns8} |`);
  }
}
function cmdLedger() {
  const HOST = { whisper: 'api.openai.com', openai: 'api.openai.com', gemini: 'generativelanguage.googleapis.com', meta: 'api.meta.ai' };
  const MODEL = { whisper: 'whisper-1', openai: 'gpt-live-transcribe', gemini: 'gemini-3.5-transcribe', meta: 'muse-voice-transcribe-1.0' };
  const by = {};
  for (const f of (fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS) : []).filter((x) => /^(file|live)-.*\.json$/.test(x))) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
    const key = r.vendor + (f.startsWith('live-') ? '-live' : '');
    (by[key] = by[key] || []).push({ f, r });
  }
  for (const [key, rows] of Object.entries(by)) {
    const vendor = key.replace(/-live$/, ''); const live = /-live$/.test(key);
    const model = live && vendor === 'gemini' ? 'gemini-3.5-transcribe-live' : MODEL[vendor];
    const ok = rows.filter((x) => !x.r.error);
    const date = (rows[0].r.date || new Date().toISOString()).slice(0, 10);
    if (!ok.length) {
      console.log(`  { host: '${HOST[vendor]}', model: '${model}', date: '${date}',\n    verdict: 'unreachable', why: '转写探针（scripts/asr-probe.js）：${rows.map((x) => x.r.error).join(' / ').replace(/'/g, '"').slice(0, 200)}' },`);
      continue;
    }
    const ms = Math.round(ok.reduce((a, x) => a + (x.r.ms || x.r.score.lagP90Ms || 0), 0) / ok.length);
    const chars = Math.round(ok.reduce((a, x) => a + (x.r.text ? x.r.text.length : (x.r.finals || []).reduce((s, f2) => s + f2.text.length, 0)), 0) / ok.length);
    const why = ok.map((x) => `${x.r.ref}: ${live ? '滞后p90 ' + x.r.score.lagP90Ms + 'ms' : x.r.ms + 'ms'} 错误率 ${pct(x.r.score.errRate)}`).join('；');
    console.log(`  { host: '${HOST[vendor]}', model: '${model}', date: '${date}',\n    baseline: { ms: ${ms}, thinkTokens: null, outChars: ${chars}, finish: 'stop' },\n    verdict: 'reachable',\n    why: '转写探针（scripts/asr-probe.js，公有领域参照语料）：${why}。**参数层面没扫过** —— 转写这条路没有可调参数。' },`);
  }
}

(async () => {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') opts.model = argv[++i];
    else if (argv[i] === '--minutes') opts.minutes = +argv[++i];
  }
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--model' && argv[i - 1] !== '--minutes');
  const [cmd, a, b] = pos;
  try {
    if (cmd === 'fetch-refs') await fetchRefs();
    else if (cmd === 'words') await cmdWords(a);
    else if (cmd === 'file') await cmdFile(a, b, opts);
    else if (cmd === 'live') await cmdLive(a, b, opts);
    else if (cmd === 'rescore') {
      for (const f of fs.readdirSync(RESULTS).filter((x) => x.endsWith('.json') && !x.startsWith('cors'))) {
        const pth = path.join(RESULTS, f); const r = JSON.parse(fs.readFileSync(pth, 'utf8'));
        if (r.error || !REFS[r.ref]) continue;
        const ref = loadRef(r.ref);
        r.score = f.startsWith('live-') ? scoreLive(ref, { finals: r.finals, interims: r.score.interims, seams: r.score.seams, closes: r.score.closes, errors: r.score.errors, sentMs: +r.score.sentMinutes * 60000 }, loadWords(r.ref))
          : scoreCues(ref, r.cues, r.vendor === 'whisper' ? null : loadWords(r.ref));
        fs.writeFileSync(pth, JSON.stringify(r, null, 1));
        console.log(`${f}: 错误率 ${pct(r.score.errRate)}`);
      }
    }
    else if (cmd === 'report') cmdReport();
    else if (cmd === 'ledger') cmdLedger();
    else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(cmd ? 1 : 0); }
  } catch (e) { console.error('✗ ' + (e.stack || e.message)); process.exit(1); }
})();
