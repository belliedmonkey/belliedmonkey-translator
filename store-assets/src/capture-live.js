#!/usr/bin/env node
// store-assets/src/capture-live.js —— 在真实站点上实拍「翻译发生时」的两屏（文章双语 / 视频双字幕），
// 按设备档位拍：手机档拍手机看到的（m.wikipedia / m.youtube，402×874@3x），平板档拍平板
// 看到的（桌面站点，1032×1376@2x）。桌面档（f1/f2）是真 Safari 手拍的，不走这里。
//
// 为什么要分档：2026-09-06 用户指出手机商店图里塞了一个 Mac 窗口——上下大片空白、正文
// 一个字都看不清。规范写在 ../README.md「一条硬规矩」。
//
//   node store-assets/src/capture-live.js phone article   # → src/assets/phone-article.png
//   node store-assets/src/capture-live.js phone video     # → src/assets/phone-video.png
//   node store-assets/src/capture-live.js tablet article|video
//
// 需要 dist/（node build.js）与 .local/keys.md 里的引擎槽位（不回显、不入图）。
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '../..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const { slot } = require(path.join(ROOT, 'scripts/lib/asc-client.js'));
const [tier, what] = process.argv.slice(2);
const OUT = process.argv[4] || path.join(__dirname, 'assets', `${tier}-${what}.png`);
const TIERS = {
  phone: { metrics: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    article: 'https://en.m.wikipedia.org/wiki/Tea', video: 'https://m.youtube.com/watch?v=jrDv0OdMt5s' },
  tablet: { metrics: { width: 1032, height: 1376, deviceScaleFactor: 2, mobile: true },
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    article: 'https://en.wikipedia.org/wiki/Tea', video: 'https://www.youtube.com/watch?v=jrDv0OdMt5s' },
};
const T = TIERS[tier];
if (process.env.CAPTURE_UA === 'android') T.ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
if (!T || !['article', 'video'].includes(what)) { console.error('用法: capture-live.js phone|tablet article|video [out.png]'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required', '--mute-audio']);
  const cdp = await CDP.connect(chrome.port);
  setTimeout(() => { console.log('timeout'); process.exit(1); }, 150000).unref();
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
  await cdp.send('Emulation.setDeviceMetricsOverride', T.metrics, sessionId);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: T.ua, acceptLanguage: 'en-US,en;q=0.9,zh-CN;q=0.8' }, sessionId);
  if (process.env.CAPTURE_WARM) { await cdp.send('Page.navigate', { url: new URL(T[what]).origin + '/' }, sessionId); await sleep(4000); }
  await cdp.send('Page.navigate', { url: T[what] }, sessionId);
  await sleep(5000);
  const ev = (expr) => cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId).then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; });
  console.log('url', await ev('location.href'), 'fab?', await ev(`!!document.getElementById('mt-fab')`));
  if (what === 'video') {
    // 关掉「以后再说」类弹层 / 同意页会让它更稳，但 m.youtube 一般直接给播放器。
    await ev(`(()=>{const v=document.querySelector('video'); if(v){v.muted=true; v.play().catch(()=>{});} return !!v;})()`);
    await sleep(1500);
  }
  await ev(`(()=>{const f=document.getElementById('mt-fab'); if(f){f.click(); return 'tapped';} return 'no-fab';})()`).then((r) => console.log('fab', r));
  const deadline = Date.now() + 90000;
  let state = '';
  while (Date.now() < deadline) {
    await sleep(1000);
    state = await ev(what === 'article'
      ? `(()=>{const t=[...document.querySelectorAll('.mt-translation')].map(x=>x.innerText.trim()); return JSON.stringify({total:t.length, pending:t.filter(x=>/翻译中|⏳/.test(x)).length, err:t.filter(x=>/失败/.test(x)).length});})()`
      : `(()=>{const o=document.querySelector('.mt-yt-orig'), tr=document.querySelector('.mt-yt-trans'); const v=document.querySelector('video'); return JSON.stringify({orig:o?o.textContent.trim().slice(0,40):null, trans:tr?tr.textContent.trim().slice(0,40):null, t:v?Math.round(v.currentTime):null, paused:v?v.paused:null, notice:!!document.querySelector('#mt-yt-overlay')});})()`);
    const s = JSON.parse(state);
    if (what === 'article' && s.total >= 6 && s.pending === 0) break;
    if (what === 'video' && s.orig && s.trans && s.t > 8) break;
  }
  console.log('state', state);
  if (what === 'article') { await ev(`window.scrollTo(0, ${tier === 'phone' ? 0 : 60})`); await sleep(400); }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
  console.log('wrote', OUT);
  chrome.cleanup(); process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
