#!/usr/bin/env node
// scripts/record-review-gif.js —— 重录 README 里「复习」那张动图的帧（手机 / Mac 两种视口）。
//
// 与 store-assets/src/capture.js 同一套底子：真 Chrome 打开 dist/ 的复习页（http，
// file:// 下 IndexedDB 被拒），种一个像真库的语料（62 张、几张到期），然后走真实用户
// 流程：统计页 → 开始复习 → 答题/显示译文 → 打分 → 下一张 → 再打分。每 100 ms 一帧，
// 10 秒。语音合成打桩，不发任何请求。
//
//   node scripts/record-review-gif.js phone /tmp/rev/phone   # 402×874 @2x
//   node scripts/record-review-gif.js mac   /tmp/rev/mac     # 1100×800 @1x
//   （拼 GIF 的 ffmpeg 参数见 scripts/record-hero-gif.js 文件头）
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const MODE = process.argv[2], OUT = process.argv[3];
if (!['phone', 'mac'].includes(MODE) || !OUT) { console.error('用法: node scripts/record-review-gif.js phone|mac <输出目录>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const SHIM = fs.readFileSync(path.join(ROOT, 'app/chrome-shim.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
// 与 store-assets/src/capture.js 的 SEED 同形（那份是商店图的真相，这里不另造一套语料）。
const PAIRS = Object.fromEntries([...fs.readFileSync(path.join(ROOT, 'store-assets/src/capture.js'), 'utf8').matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]));
const SEED = fs.readFileSync(path.join(ROOT, 'store-assets/src/capture.js'), 'utf8').match(/const SEED = `([\s\S]*?)`;\n/)[1];
(async () => {
  const dist = path.join(ROOT, 'dist');
  const srv = http.createServer((q, r) => {
    const f = path.join(dist, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
  }).listen(0); await new Promise((r) => srv.on('listening', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const chrome = await launchChrome(['--lang=en-US']);   // README 面向英文读者：界面英文，语料仍是 EN→ZH
  const cdp = await CDP.connect(chrome.port);
  setTimeout(() => { console.log('timeout'); process.exit(1); }, 120000).unref();
  const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
  const vp = MODE === 'phone' ? { width: 402, height: 874, deviceScaleFactor: 2, mobile: true } : { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false };
  await cdp.send('Emulation.setDeviceMetricsOverride', vp, sessionId);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    ${SHIM}
    (() => {
      const voices = [{ name: 'Ting-Ting', lang: 'zh-CN', voiceURI: 'zh', default: true, localService: true }, { name: 'Samantha', lang: 'en-US', voiceURI: 'en', default: false, localService: true }];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => voices, addEventListener: () => {}, cancel: () => {}, resume: () => {},
        speak: (u) => { setTimeout(() => u.dispatchEvent && u.dispatchEvent(new Event('start')), 0); setTimeout(() => u.dispatchEvent && u.dispatchEvent(new Event('end')), 40); },
      } });
      class U extends EventTarget { constructor(t) { super(); this.text = t; } }
      window.SpeechSynthesisUtterance = U;
    })();
    try { localStorage.setItem('mt:learnEnabled', 'true'); localStorage.setItem('mt:uiLang', JSON.stringify('en')); localStorage.setItem('mt:ttsVoice', JSON.stringify('en')); localStorage.setItem('mt:ttsEngine', JSON.stringify('browser')); localStorage.setItem('mt:provider', JSON.stringify('google')); localStorage.setItem('mt:ttsMode', JSON.stringify('assist')); } catch (_) {}
  ` }, sessionId);
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  await cdp.send('Page.navigate', { url: BASE + '/learn/review.html' }, sessionId);
  await sleep(1800);
  console.log(await ev(SEED));
  await cdp.send('Page.reload', {}, sessionId);
  await sleep(2200);
  const dismiss = `(() => { const b = [...document.querySelectorAll('button')].find((x) => /知道了|Got it/i.test(x.textContent)); if (b) b.click(); return !!b; })()`;
  await ev(dismiss); await sleep(500); await ev(`window.scrollTo(0, 0)`);
  let n = 0;
  const shot = async () => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId); fs.writeFileSync(path.join(OUT, `f${String(n++).padStart(3, '0')}.png`), Buffer.from(data, 'base64')); };
  const start = Date.now();
  const at = (ms) => new Promise((r) => setTimeout(r, Math.max(0, start + ms - Date.now())));
  // 时间轴：0–1.2s 统计页 · 1.2s 开始 · 2.6s 答对/显示译文 · 4.6s 打「记得」· 6.4s 下一张显示译文 · 8.4s 打分 · 10s 完
  const answer = `(() => { const r = document.getElementById('reveal'); if (r && !r.hidden && r.offsetParent) { r.click(); return 'reveal'; }
    const pairs = ${JSON.stringify(PAIRS)}; const orig = (document.getElementById('orig') || {}).textContent || '';
    const want = Object.entries(pairs).find(([k]) => orig.trim().startsWith(k.slice(0, 30)));
    const opt = [...document.querySelectorAll('.ex-option')].find((x) => want && x.textContent.trim() === want[1] && x.offsetParent);
    if (opt) { opt.click(); return 'answered:' + want[0].slice(0, 20); } return 'none:' + orig.slice(0, 20); })()`;
  const reveal2 = `(() => { const r = document.getElementById('reveal'); if (r && !r.hidden && r.offsetParent) { r.click(); return 'reveal'; } return 'none'; })()`;
  const grade = `(() => { const g = document.querySelector('#grades .g2:not([disabled])'); if (g && g.offsetParent) { g.click(); return 'graded'; } return 'none'; })()`;
  const steps = [[1200, `LearnReview.start().then(() => 'started')`], [2200, dismiss], [2600, answer], [3400, reveal2], [4600, grade], [6400, answer], [7200, reveal2], [8400, grade]];
  let si = 0;
  for (let ms = 0; ms <= 10000; ms += 100) {
    await at(ms);
    while (si < steps.length && ms >= steps[si][0]) { const r = await ev(steps[si][1]).catch((e) => 'err:' + e.message); console.log(steps[si][0], r); si++; await ev(`(() => { const g = document.getElementById('grades'); const c = document.getElementById('card'); if (g && !g.hidden && c) c.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0); })()`); }
    await shot();
  }
  console.log('frames', n);
  srv.close(); process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
