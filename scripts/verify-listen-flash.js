#!/usr/bin/env node
// scripts/verify-listen-flash.js — 听译半句「错语言闪现」的音频层回归（Mac，§0.4 音频层）。
//
// 为什么在 Mac 上做：半句闪现是**识别器行为**，只有真音频 + 真识别器能复现（假桥注入复现不了）。
// 判据两条，缺一不可：
//   · 机器判据：播放期间每 200ms 采一次屏上那半句（"_debug().partial"），按文字系分类 —— 说中文
//     的用例里**不许出现泰文**，说泰语的用例里**不许出现汉字**；
//   · 人判据（规范要求）：cap 录屏，抽出「现在」卡的逐帧条，肉眼/逐帧复核。
//
// 用例（用户 2026-10-07 指定）：长句 · 连续多句 · 不同声音交替 · 多声重叠。
//
// 用法： node scripts/verify-listen-flash.js [--skip-build]
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, '.local', 'mac-debug-dd', 'Build', 'Products', 'Debug', 'BelliedMonkey Translator.app');
const OUT = path.join(ROOT, '.local', 'listen-flash');
const AUD = path.join(OUT, 'audio');
const BIN = '/opt/homebrew/bin';
const AFPLAY = fs.existsSync('/usr/bin/afplay') ? '/usr/bin/afplay' : `${BIN}/afplay`;   // 系统自带，不在 brew 里
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c, o) => execSync(c, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }, o || {}));

let BASE = null;
async function ping(b) { try { const r = await (await fetch(b + '/ping')).json(); return !!(r && r.bridge === 'mt-test'); } catch (_) { return false; } }
async function findBase() { for (let p = 8790; p <= 8799; p++) { const b = `http://127.0.0.1:${p}`; if (await ping(b)) return b; } return null; }
const ev = async (js) => { const r = await (await fetch(`${BASE}/eval`, { method: 'POST', body: js })).json(); if (!r.ok) throw new Error(r.error || '?'); return r.result; };
const live = async () => ev(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`);

function makeClips() {
  fs.mkdirSync(AUD, { recursive: true });
  const zh1 = path.join(AUD, 'zh-long.aiff');
  const zh2 = path.join(AUD, 'zh-long-b.aiff');
  const th1 = path.join(AUD, 'th-long.aiff');
  const mix = path.join(AUD, 'mix-overlap.aiff');
  const ZH = '今天下午三点我们去机场接人，你准备好了吗？如果路上堵车的话我们可能要晚到一会儿，你到了就先在咖啡厅等我们，我们到了再给你打电话。';
  const ZH2 = '这批货的订金周五之前到账，我们下周二就能发第一批，运费里已经含了保险，关税要你们自己处理。';
  const TH = 'สวัสดีครับวันนี้เราจะไปสนามบินตอนบ่ายสามโมงนะครับ อยากจะถามว่ารถติดไหมครับ';
  if (!fs.existsSync(zh1)) sh(`say -v Tingting -o ${JSON.stringify(zh1)} ${JSON.stringify(ZH)}`);
  if (!fs.existsSync(zh2)) sh(`say -v Sinji -o ${JSON.stringify(zh2)} ${JSON.stringify(ZH2)}`);
  if (!fs.existsSync(th1)) sh(`say -v Kanya -o ${JSON.stringify(th1)} ${JSON.stringify(TH)}`);
  if (!fs.existsSync(mix)) sh(`ffmpeg -y -loglevel error -i ${JSON.stringify(zh1)} -i ${JSON.stringify(th1)} -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest" ${JSON.stringify(mix)}`);
  return { zh1, zh2, th1, mix };
}

async function restartApp() {
  try { sh(`osascript -e 'quit app id "com.belliedmonkeytranslator"'`, { stdio: 'ignore' }); } catch (_) {}
  await sleep(3000);
  sh(`open ${JSON.stringify(APP)}`);
  for (let i = 0; i < 30; i++) { await sleep(1500); BASE = await findBase(); if (BASE) return; }
  throw new Error('App 没起来（/ping 不通）');
}
async function enterListen() {
  await ev(`chrome.storage.local.set({onboardSeen:true,listenMyLang:"zh",listenOtherLang:"th",listenAutoSpeak:false},()=>{}); true`);
  for (let a = 1; a <= 5; a++) {
    await ev('location.reload()'); await sleep(9000);
    try {
      await ev('document.getElementById("app-listen-entry").click(), true'); await sleep(2500);
      if (!(await live())) { await ev('document.getElementById("app-listen-toggle").click(), true'); }
      // 首次进场要把 LID 模型下下来（~60MB，§9.6.1.3）⇒ 等「live」最多 120 s
      for (let i = 0; i < 80; i++) { if (await live()) { await ev('__mtTest.ka(1), true'); return; } await sleep(1500); }
    } catch (_) {}
  }
  throw new Error('进不了听译');
}
const script = (t) => [...(t.match(/[\u0E00-\u0E7F]/g) || [])].length > 0 ? 'th' : /[\u4E00-\u9FFF]/.test(t) ? 'zh' : '';

async function recordCase(name, clips, expectNo, restart, opts) {
  const o = opts || {};
  if (restart) await restartApp();
  await enterListen();
  // 采样屏上半句（机器判据）
  await ev('window.__s=[]; window.__si=setInterval(()=>{ const p=(window.AppListen&&AppListen._debug()||{}).partial||""; if(p) window.__s.push(p); }, 200); "ok"');
  // §9.6.1.3：LID 判词也采一份 —— 归属的判据就是它，回归里要能看到「这一场判成了什么语言」。
  await ev('window.__lid=[]; window.__li=setInterval(()=>{ const d=(window.AppListen&&AppListen._debug()||{}); if(d.lid) window.__lid.push(d.lid); }, 200); "ok"');
  const WID = sh(`exec 2>/dev/null; cap record windows --json`).trim();
  const id = (() => { try { const w = JSON.parse(WID); const ws = Array.isArray(w) ? w : w.windows; return ws.find((x) => x.bundleIdentifier === 'com.belliedmonkeytranslator').id; } catch (_) { return ''; } })();
  sh(`osascript -e 'tell application "System Events" to set frontmost of (first process whose bundle identifier is "com.belliedmonkeytranslator") to true'`);
  await sleep(1000);
  const capDir = path.join(OUT, `${name}.cap`);
  const mp4 = path.join(OUT, `${name}.mp4`);
  try { fs.rmSync(capDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(mp4); } catch (_) {}
  const total = clips.reduce((n, c) => n + 20, 0) + 6;
  const bg = require('child_process').spawn(path.join(process.env.HOME, '.cap/bin/cap'),
    ['record', 'start', '--window', String(id), '--duration', String(total), '--fps', '15', '--path', capDir, '--json'], { stdio: 'ignore' });
  await sleep(2000);
  for (const c of clips) { try { execFileSync(AFPLAY, [c]); } catch (e) { console.log('  ! 播放失败：' + (e.message || '')); } await sleep(3); }
  await new Promise((res) => bg.on('exit', res));   // 等 cap 自己按 --duration 收尾（await bg 不会等）
  await ev('clearInterval(window.__si); clearInterval(window.__li); "ok"');
  const samples = JSON.parse(await ev('JSON.stringify(window.__s)'));
  const lids = JSON.parse(await ev('JSON.stringify([...new Set(window.__lid)])'));
  const rows = JSON.parse(await ev('JSON.stringify((AppListen._debug().rows||[]).map(r=>r.who+":"+(r.text||"").slice(0,24)))'));
  sh(`${path.join(process.env.HOME, '.cap/bin/cap')} export ${JSON.stringify(capDir)} --output ${JSON.stringify(mp4)} --json`, { stdio: 'ignore' });
  const strip = path.join(OUT, `${name}-nowcard.png`);
  if (fs.existsSync(mp4)) sh(`${BIN}/ffmpeg -y -loglevel error -i ${JSON.stringify(mp4)} -vf "fps=2,crop=620:210:40:275,scale=430:-1,tile=4x10" -frames:v 1 ${JSON.stringify(strip)}`);
  const bad = expectNo ? samples.map(script).filter((s) => s && s === expectNo) : [];
  console.log(`\n[${name}] 音频 ${clips.length} 段 · 采样 ${samples.length} 条 · 错语言样本 ${bad.length}`);
  console.log(`  LID 判到的语言（§9.6.1.3）: ${JSON.stringify(lids)}`);
  console.log(`  rows: ${JSON.stringify(rows)}`);
  console.log(`  屏上半句（去重前 20）: ${JSON.stringify([...new Set(samples)].slice(0, 20))}`);
  console.log(`  帧条: ${fs.existsSync(strip) ? strip : '（无）'}`);
  // 采样为 0 ⇒ App 没真听到音频（麦克风/前置/预热没到位）⇒ 这一例**无效**，判失败，不许假绿。
  if (samples.length === 0 && !o.rowsMayBeEmpty) { console.log('  ✗ 一条半句样本都没有 —— 这一例无效（App 没听到音频）'); return false; }
  // 两路同时出声（多声重叠）：LID 判成哪一门都可能（它只有一个输入），这一例不判语言，
  // 只要求「真的听到了、有半句上屏」。仍然记下 LID 判词，供人复核。
  if (!expectNo && !o.wantScripts) { console.log('  ✓ 有半句上屏（多声重叠不判语言；LID 判词见上）'); return true; }
  // 不同声音/语言交替：判据=**行的文字系集合**里两门语言都出现过（LID 逐句换判，两门都要落到行上）
  if (o.wantScripts) {
    const got = [...new Set(rows.map((r) => script(String(r).replace(/^[^:]*:/, ''))))].filter(Boolean).sort();
    const miss = o.wantScripts.filter((s) => !got.includes(s));
    console.log(miss.length === 0 ? `  ✓ 两门语言都出了行（${got.join('+')}）` : `  ✗ 缺 ${miss.join('+')} 的行（只有 ${got.join('+') || '空'}）`);
    return miss.length === 0;
  }
  console.log(bad.length === 0 ? `  ✓ 没有出现「${expectNo === 'th' ? '泰文' : '汉字'}」半句` : `  ✗ 出现了 ${bad.length} 条错语言半句`);
  return bad.length === 0;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  process.env.PATH = `${process.env.HOME}/.cap/bin:${process.env.PATH}`;
  const c = makeClips();
  try { sh(`bash ${path.join(ROOT, 'scripts/ensure-screen-awake.sh')}`, { stdio: 'ignore' }); } catch (_) {}
  const results = [];
  results.push(await recordCase('zh-long', [c.zh1], 'th', true));
  results.push(await recordCase('zh-multi', [c.zh1, c.zh2, c.zh1], 'th', true));
  results.push(await recordCase('th-long', [c.th1], 'zh', true));
  // 不同语言交替（用户 2026-10-07 指定的用例）：同一场里中文 → 泰语 → 中文。LID 应当**逐句**换判，
  // 两门语言的行都要落到历史上、且互不冒充。判据 = 行的文字系集合里 zh 与 th 都出现过。
  // （半句采样在这一例不判：LID 每一句都要重新听够，前面几秒本来就没有预览。）
  results.push(await recordCase('zh-th-zh', [c.zh1, c.th1, c.zh1], '', true, { wantScripts: ['zh', 'th'] }));
  results.push(await recordCase('mix-overlap', [c.mix], '', true));
  const n = results.filter(Boolean).length;
  console.log(`\n=== ${n}/${results.length} 通过 ===`);
  process.exit(n === results.length ? 0 : 1);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
