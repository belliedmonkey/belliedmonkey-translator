// store-assets/src/capture-docs.js — 拍「文档翻译」阅读器的译好状态（1.10.0 新功能，出 {en,zh}-{phone,tablet,desk}-docs.png）。
//
// 为什么不走真 pdf.js + 真引擎：capture 在 http 下服务 dist/，pdfjs-loader 的 chrome.runtime.getURL
// 在 shim 里返回相对路径，import 会解错路径；而真翻译要 API key，商店图里也不该出现像密钥的东西。
// 所以给 mt-docs 种一个 **txt 源**的文档（openText 不需要 pdf.js）+ 页缓存（paras + 译文 + 匹配的引擎三元组），
// 阅读器直接渲染译好状态。阅读器 UI 与 PDF 完全一样（标题 + 页码 + 逐段原文/译文），是文档翻译的忠实呈现。
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '../..');
const OUT = path.join(__dirname, 'assets');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const SHIM = fs.readFileSync(path.join(ROOT, 'app/chrome-shim.js'), 'utf8');
const pick = (flag, all) => { const i = process.argv.indexOf(flag); return i >= 0 ? [process.argv[i + 1]] : all; };
const LANGS = pick('--lang', ['en', 'zh']);
const TIERS = pick('--tier', ['phone', 'tablet', 'desk']);
const METRICS = {
  phone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
  tablet: { width: 1032, height: 1376, deviceScaleFactor: 2, mobile: true },
  desk: { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false },
};
const UI_LANG = { en: 'en', zh: 'zh-CN' };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 演示文档：一篇中性的产品/科技短文，EN 原文 + ZH 译文（与产品做的事一致：EN→ZH 对照）。无任何 PII。
const TITLE = 'Spatial Computing 2025.pdf';
const PAIRS = [
  ['Spatial computing blends the digital and the physical: instead of looking at a screen, you look through it, and the interface settles into the room around you.',
   '空间计算把数字与现实融为一体：你不再盯着屏幕，而是透过它去看，界面就落在你周围的房间里。'],
  ['The shift matters because attention is the scarcest resource in software. A window competes with everything else on the desktop; an object placed on your real desk does not.',
   '这一转变之所以重要，是因为注意力是软件里最稀缺的资源。一个窗口要和桌面上其他一切争夺注意力，而放在你真实书桌上的一个物件不必如此。'],
  ['Early headsets were judged on resolution and field of view. The next round will be judged on something quieter: whether the device disappears, and the work stays.',
   '早期头显比的是分辨率和视场角。下一轮比的是更安静的东西：设备能不能隐去，而工作留下。'],
  ['For teams, the promise is a shared canvas that is neither a video call nor a document, but a place — one you can walk around, point at, and leave things in.',
   '对团队而言，它承诺的是一块共享画布：既不是视频通话，也不是文档，而是一个地方——你可以在里面走动、指点，把东西留在那儿。'],
  ['None of this replaces reading. It changes where reading happens: fewer tabs, more surfaces, and text that follows you instead of the other way around.',
   '这一切都不会取代阅读。它改变的是阅读发生的地方：更少的标签页，更多的表面，文字跟着你走，而不是你追着文字走。'],
];
const SOURCE_TEXT = PAIRS.map((p) => p[0]).join('\n\n');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'learn/docs.html'))) throw new Error('dist/ 不完整，先 node build.js');
  const srv = http.createServer((q, r) => {
    const f = path.join(dist, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
  }).listen(0); await new Promise((r) => srv.on('listening', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  setTimeout(() => { console.log('timeout'); process.exit(1); }, 300000).unref();
  const t0 = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t0.targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    ${SHIM}
    try {
      localStorage.setItem('mt:provider', JSON.stringify('google'));   // 免费通道，商店图不出密钥
      localStorage.setItem('mt:apiBaseUrl', JSON.stringify(''));
      localStorage.setItem('mt:apiModel', JSON.stringify(''));
      localStorage.setItem('mt:targetLang', JSON.stringify('zh-CN'));
      localStorage.setItem('mt:learnEnabled', 'true');
      localStorage.setItem('mt:docCapture', 'true');
    } catch (_) {}
  ` }, sessionId);
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const go = async (url) => { await cdp.send('Page.navigate', { url }, sessionId); await sleep(1800); };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('captured', name);
  };

  await go(BASE + '/learn/docs.html');
  // 种文档：txt 源 + 页缓存（paras + 译文 + 匹配当前设置的引擎三元组）。DocCore.paginate 决定页数。
  const seed = await ev(`(async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode(${JSON.stringify(SOURCE_TEXT)});
    await DocStore.wipe();
    const triple = [EngineState.resolve('google'), '', ''].join('|');
    const paras = ${JSON.stringify(PAIRS.map((p) => ({ text: p[0] })))};
    const tr = ${JSON.stringify(PAIRS.map((p) => p[1]))};
    // openText 会把 bytes 分页；先算页数，把第 1 页缓存种成「已译」。
    const reader = DocReader.openText(bytes);
    const id = DocCore.docId(bytes, ${JSON.stringify(TITLE)});
    await DocStore.put({ id, title: ${JSON.stringify(TITLE)}, kind: 'txt', pages: reader.pages, size: bytes.length, bytes, addedAt: Date.now(), openedAt: Date.now(), lastPage: 1, captured: { total: 0, byPage: {} }, lang: 'en' });
    // 每一页都种成已译，翻页也是译好的
    for (let n = 1; n <= reader.pages; n++) {
      const pageParas = await reader.textOf(n);
      const pageTr = pageParas.map((pp) => { const hit = paras.findIndex((x) => x.text === pp.text); return hit >= 0 ? tr[hit] : ''; });
      await DocStore.putPage(id, n, { paras: pageParas, tr: pageTr, triple });
    }
    return { id, pages: reader.pages };
  })()`);
  console.log('seeded', JSON.stringify(seed));

  for (const lang of LANGS) {
    await ev(`localStorage.setItem('mt:uiLang', JSON.stringify(${JSON.stringify(UI_LANG[lang])}))`);
    for (const tier of TIERS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', METRICS[tier], sessionId);
      await go(BASE + '/learn/docs.html'); await sleep(800);
      // 从列表点进那份文档
      const opened = await ev(`(() => { const row = document.querySelector('#docv-list .docv-row .title'); if (!row) return 'no-row'; row.click(); return 'opened'; })()`);
      // 等第 1 页逐段译文渲染出来（非 pending）
      let ok = false;
      for (let i = 0; i < 30 && !ok; i++) { await sleep(400); ok = await ev(`(() => { const tr = [...document.querySelectorAll('#docv-page .docv-unit .tr')]; return tr.length > 0 && tr.every((x) => !x.classList.contains('pending')); })()`); }
      await ev('window.scrollTo(0, 0)'); await sleep(300);
      const info = await ev(`(() => { const tr = [...document.querySelectorAll('#docv-page .docv-unit .tr')]; return JSON.stringify({ opened: ${JSON.stringify(opened)}, pos: (document.getElementById('docv-pos')||{}).textContent, units: tr.length, head: (tr[0]||{}).textContent.slice(0,20) }); })()`);
      console.log(' ', lang, tier, info);
      await shot(`${lang}-${tier}-docs.png`);
    }
  }
  srv.close(); chrome.cleanup(); process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
