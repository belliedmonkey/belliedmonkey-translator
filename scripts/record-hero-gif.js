#!/usr/bin/env node
// scripts/record-hero-gif.js —— 重录 README 首图（docs/media/hero-bilingual.gif）。
//
// 真 Chrome 装 dist/，种 .local/keys.md 里的引擎（默认 deepseek），开维基百科 Tea 条目，
// 收起右侧 Appearance 面板（它挤着悬浮球），1.5 s 点悬浮球，10 s 内每 100 ms 截一帧，
// 7–9.5 s 下滑 520 px。译文一条都没落地就退出 2 —— 别拿一张没翻的图当首图。
//
//   node scripts/record-hero-gif.js /tmp/frames
//   cd /tmp/frames && { for i in $(seq 0 70); do printf "file 'f%03d.png'\nduration 0.1\n" $i; done; \
//     for i in 75 80 85 90 95 100; do printf "file 'f%03d.png'\nduration 0.45\n" $i; done; \
//     printf "file 'f100.png'\nduration 1.2\nfile 'f100.png'\n"; } > list.txt
//   ffmpeg -y -f concat -safe 0 -i list.txt -vf "scale=720:-1:flags=lanczos,split[s0][s1];\
//     [s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=none:diff_mode=rectangle" \
//     -loop 0 docs/media/hero-bilingual.gif
//
// 64 色 + 不抖动是刻意的：文字页抖动只会让体积翻三倍（2.5 MB → 0.7 MB）而看不出差别。
// 下滑那段按 0.45 s 一帧保留 6 帧，而不是每帧都留 —— 滚动帧每个像素都在变，最吃体积。
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2];
if (!OUT) { console.error('用法: node scripts/record-hero-gif.js <输出目录>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const { slot } = require(path.join(ROOT, 'scripts/lib/asc-client.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  setTimeout(() => { console.log('timeout'); process.exit(1); }, 120000).unref();
  const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'dist') });
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) { const { targetInfos } = await cdp.send('Target.getTargets'); sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId)); if (!sw) await sleep(150); }
  const swAtt = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, swAtt.sessionId);
  const cfg = { provider: slot('provider') || 'deepseek', apiKey: slot('apiKey') || '', apiBaseUrl: slot('apiBaseUrl') || '', apiModel: slot('apiModel') || '',
    targetLang: 'zh-CN', enabled: false, showFab: true, engineChosen: 1, extObSeen: 1, learnEnabled: false };
  await cdp.send('Runtime.evaluate', { expression: `new Promise(r => chrome.storage.local.set(${JSON.stringify(cfg)}, () => r(1)))`, awaitPromise: true }, swAtt.sessionId);
  console.log('seeded provider', cfg.provider, 'key?', !!cfg.apiKey);
  const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url: 'https://en.wikipedia.org/wiki/Tea' }, sessionId);
  await sleep(4500);
  const ev = (expr) => cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId).then((r) => r.result.value);
  // 收起右侧「Appearance」面板：它挤着悬浮球，而悬浮球是这段动图的主角。
  await ev(`(()=>{const b=document.querySelector('#vector-appearance-pinned-container .vector-pinnable-header-unpin-button, .vector-appearance-pinned-container button'); if(b) b.click(); return !!b;})()`);
  await sleep(600);
  await ev(`window.scrollTo(0, 60)`);
  await sleep(500);
  let n = 0;
  const shot = async () => { const png = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId); fs.writeFileSync(path.join(OUT, `f${String(n++).padStart(3, '0')}.png`), Buffer.from(png.data, 'base64')); };
  const start = Date.now();
  const at = (ms) => new Promise((r) => setTimeout(r, Math.max(0, start + ms - Date.now())));
  // 0–1.5s: idle; 1.5s: tap the FAB; 1.5–7s: translations land; 7–10s: scroll
  let clicked = false, scrolled = 0;
  for (let ms = 0; ms <= 10000; ms += 100) {
    await at(ms);
    if (!clicked && ms >= 1500) { await ev(`(document.getElementById('mt-fab') || {}).click && document.getElementById('mt-fab').click()`); clicked = true; }
    if (ms >= 7000 && ms <= 9500) { scrolled = Math.round(60 + (ms - 7000) / 2500 * 520); await ev(`window.scrollTo({top:${scrolled}})`); }
    await shot();
  }
  const count = await ev(`document.querySelectorAll('.mt-translation').length`);
  console.log('frames', n, 'translations', count, 'fab', await ev(`!!document.getElementById('mt-fab')`));
  process.exit(count > 0 ? 0 : 2);
})().catch((e) => { console.error(e); process.exit(1); });
