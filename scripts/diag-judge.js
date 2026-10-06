#!/usr/bin/env node
// scripts/diag-judge.js — 听译质量的离线裁判（§0.3 实验室方法论 + §0.4.1 诊断录音）。
//
// 「转写对不对」不能靠肉眼看几行猜。拿录音回放，用本机一个**独立的、更强的** ASR
// （whisper large-v3-turbo）当参考，和管线自己的定稿逐字比。这是判分，不是产品代码。
//
// 用法：
//   node scripts/diag-judge.js <目录>                 # 目录里要有 mic.caf + sidecar.json
//   node scripts/diag-judge.js --pull <sessionId>     # 从中国服务器 tar 回来再判
//   node scripts/diag-judge.js <目录> --lang zh       # 强制参考语种（默认自动检测）
//   node scripts/diag-judge.js <目录> --model large-v3-turbo
//
// 输出：
//   · 参考（whisper）检测到的语种、整段文本、分句数；
//   · 管线定稿行数、按 locale 的分布、**伪行**（locale 与参考语种不符 = 「说 A 转成 B」）；
//   · 与参考的 CER（汉字/泰文按字）或 WER（拉丁按词）；
//   · 断句指标：超长行（整段当一行）的条数与最长行。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SSH_KEY = `${process.env.HOME}/.ssh/tencent_bt.key`;
const SSH_HOST = 'root@49.233.0.7';
const WHISPER = process.env.WHISPER_BIN || '/opt/homebrew/bin/whisper';
const REMOTE_AUDIO_DIR = '/data/diag-audio';

function parseArgs(argv) {
  const o = { dir: '', pull: '', lang: '', model: 'large-v3-turbo', longChars: 40 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pull') o.pull = argv[++i] || '';
    else if (a === '--lang') o.lang = argv[++i] || '';
    else if (a === '--model') o.model = argv[++i] || o.model;
    else if (a === '--long') o.longChars = Number(argv[++i]) || o.longChars;
    else if (!o.dir && !a.startsWith('--')) o.dir = a;
  }
  return o;
}

// 从服务器把某个会话的录制目录 tar 回来（目录名 = 听译会话 id，sidecar 里也是它）。
function pull(session) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(session)) throw new Error('session 名不合法');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-judge-'));
  const tar = execFileSync('ssh', ['-i', SSH_KEY, '-o', 'IdentitiesOnly=yes', SSH_HOST,
    `cd ${REMOTE_AUDIO_DIR} && tar cz ${session}`], { maxBuffer: 1 << 30, timeout: 120000 });
  const tgz = path.join(tmp, 'a.tgz');
  fs.writeFileSync(tgz, tar);
  execFileSync('tar', ['xzf', tgz, '-C', tmp]);
  return path.join(tmp, session);
}

function toWav(caf, outDir) {
  const wav = path.join(outDir, 'mic.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', caf, '-ar', '16000', '-ac', '1', wav]);
  return wav;
}

function runWhisper(wav, model, lang) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-whisper-'));
  const args = ['--model', model, '--output_format', 'json', '--output_dir', outDir, '--fp16', 'False'];
  if (lang) args.push('--language', lang);
  args.push(wav);
  execFileSync(WHISPER, args, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 1800000, maxBuffer: 1 << 28 });
  const j = JSON.parse(fs.readFileSync(path.join(outDir, path.basename(wav, '.wav') + '.json'), 'utf8'));
  return { language: j.language || '', text: (j.text || '').trim(), segments: (j.segments || []).map((s) => ({ t0: s.start, t1: s.end, text: String(s.text || '').trim() })) };
}

const base = (c) => String(c || '').split(/[-_]/)[0].toLowerCase();
const strip = (s) => String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '');
// 汉字/泰文等无空格文字按「字」比；拉丁按「词」比。
const CJK = /[\p{Script=Han}\p{Script=Thai}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function tokens(text) {
  const t = String(text || '');
  if (CJK.test(t)) return [...strip(t)];
  return t.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
}
function levenshtein(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[m];
}
const errRate = (ref, hyp) => { const R = tokens(ref), H = tokens(hyp); return R.length ? levenshtein(R, H) / R.length : null; };
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');

function main() {
  const o = parseArgs(process.argv.slice(2));
  let dir = o.dir;
  if (o.pull) dir = pull(o.pull);
  if (!dir || !fs.existsSync(dir)) { console.error('用法: node scripts/diag-judge.js <目录> [--lang zh] [--model large-v3-turbo] | --pull <sessionId>'); process.exit(1); }

  const scPath = path.join(dir, 'sidecar.json');
  if (!fs.existsSync(scPath)) { console.error('✗ 没有 sidecar.json（诊断录音默认关；须在 设置 › 诊断日志 打开后录一场）'); process.exit(1); }
  const sidecar = JSON.parse(fs.readFileSync(scPath, 'utf8')) || [];
  const cafs = fs.readdirSync(dir).filter((f) => f.endsWith('.caf'));
  if (!cafs.length) { console.error('✗ 没有 .caf 音频'); process.exit(1); }

  console.log(`目录: ${dir}`);
  console.log(`音频: ${cafs.join(', ')}   sidecar 条数: ${sidecar.length}`);

  const stt = sidecar.filter((e) => e && e.k === 'stt' && e.text);
  const byLoc = {};
  for (const e of stt) { const b = base(e.loc); byLoc[b] = (byLoc[b] || 0) + 1; }
  console.log(`管线定稿行: ${stt.length}   按 locale: ${Object.entries(byLoc).map(([k, v]) => `${k}=${v}`).join(' ') || '（无）'}`);

  // 参考：所有 .caf 拼一起交给 whisper
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-judge-'));
  const wavs = cafs.map((f) => toWav(path.join(dir, f), work));
  console.log(`\n跑参考转写（whisper ${o.model}${o.lang ? ' --language ' + o.lang : ' 自动检测语种'}）…`);
  const refAll = { language: '', text: '', segments: [] };
  for (const w of wavs) {
    const r = runWhisper(w, o.model, o.lang);
    refAll.language = refAll.language || r.language;
    refAll.text += (refAll.text ? ' ' : '') + r.text;
    refAll.segments = refAll.segments.concat(r.segments);
  }
  console.log(`参考语种: ${refAll.language || '?'}   分句数: ${refAll.segments.length}`);

  const pipeAll = stt.map((e) => e.text).join('');
  const cer = errRate(refAll.text, pipeAll);
  const kind = CJK.test(refAll.text) ? 'CER' : 'WER';
  console.log(`\n与参考比（整段 ${kind}）: ${pct(cer)}`);

  // 伪行：locale 与参考语种不符 —— 「说 A 转成 B」的直接读数
  const refLang = base(o.lang || refAll.language);
  if (refLang && Object.keys(byLoc).length > 1) {
    const spurious = stt.filter((e) => base(e.loc) !== refLang);
    console.log(`参考语种 ${refLang} ⇒ 疑似伪行（locale 不符）: ${spurious.length}/${stt.length}`);
    for (const e of spurious.slice(0, 8)) console.log(`   [${base(e.loc)}] ${String(e.text).slice(0, 50)}`);
  }

  // 断句：整段没切开的超长行
  const longs = stt.filter((e) => tokens(e.text).length >= o.longChars).map((e) => ({ loc: base(e.loc), n: tokens(e.text).length, text: String(e.text).slice(0, 60) }));
  console.log(`\n断句：超长行(≥${o.longChars} 字/词) ${longs.length} 条；最长 ${stt.reduce((m, e) => Math.max(m, tokens(e.text).length), 0)}`);
  for (const l of longs.slice(0, 5)) console.log(`   [${l.loc}] ${l.n} 字: ${l.text}…`);

  // 参考 vs 管线前若干行对照（人工扫一眼）
  console.log('\n── 参考分句（前 12）──');
  for (const s of refAll.segments.slice(0, 12)) console.log(`  ${s.t0.toFixed(1)}-${s.t1.toFixed(1)}s  ${s.text.slice(0, 70)}`);
  console.log('── 管线定稿（前 12）──');
  for (const e of stt.slice(0, 12)) console.log(`  [${base(e.loc)}] ${String(e.text).slice(0, 70)}`);
}
try { main(); } catch (e) { console.error('✗', e.message.split('\n')[0]); process.exit(1); }
