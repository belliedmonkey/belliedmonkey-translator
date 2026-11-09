#!/usr/bin/env node
// test/bel233-centering-headless.js — BEL-233 r3 · 「一键配好」文字中心 = 按钮中心。
//
// 这是 `test/run.js` 之外的**真实排版**探针（run.js 仍是零依赖、不启浏览器）。它用
// 产品自己的 app/style.css 和同一层 DOM（pane 16 → 卡 16 → 按钮 100%），在 390 宽、
// deviceScaleFactor=2 下量 getBoundingClientRect：
//   · 按钮内容宽必须是 326（390 − 2×16 − 2×16）；
//   · 文字 Range 的中心与按钮中心偏差 ≤ 0.5pt。
//
//   node test/bel233-centering-headless.js
//
// 需要 Node >= 22（内置 WebSocket）与 Chrome/Edge；找不到浏览器时硬失败，不静默跳过。

'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));

if (typeof WebSocket === 'undefined') {
  console.error('✗ 需要 Node >= 22（内置 WebSocket）');
  process.exit(1);
}

const CSS = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8');
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  :root { --bg:#f5ead8; --card-bg:#fff; --text:#201e1d; --text-secondary:#6a6255;
    --border:#dcd3c4; --accent:#ac6231; --accent-deep:#8c491a; --link:#8c491a;
    --accent-track:#ffe1d0; --field:#fff; --mono: ui-monospace, monospace; }
  html.quick-mode, html.quick-mode body { background: transparent; }
</style>
<link rel="stylesheet" href="/Style.css">
</head><body>
<section id="app-settings">
  <div class="sec settings-pane" id="sec-engines">
    <section class="quick-only" id="quick-setup-card">
      <h3 id="quick-setup-title">用一把 key 配好全部</h3>
      <div id="quick-setup"><div class="qs-wrap">
        <button id="qs-apply" type="button">一键配好</button>
      </div></div>
    </section>
  </div>
</section>
</body></html>`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/Base.lproj/Main.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(HTML);
    }
    if (req.url === '/Style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(CSS);
    }
    res.writeHead(404); res.end();
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  const chrome = await launchChrome();
  let cdp;
  try {
    cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: false }, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await wait(500);
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const b = document.getElementById('qs-apply');
        if (!b) return { error: 'no #qs-apply' };
        const br = b.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(b);
        const tr = range.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return {
          viewport: innerWidth,
          text: b.textContent,
          button: { x: br.x, w: br.width, cx: br.x + br.width / 2, h: br.height },
          textBox: { x: tr.x, w: tr.width, cx: tr.x + tr.width / 2 },
          diff: (tr.x + tr.width / 2) - (br.x + br.width / 2),
          display: cs.display, justify: cs.justifyContent, align: cs.alignItems,
          textAlign: cs.textAlign, padding: cs.padding, width: cs.width,
        };
      })()`,
      returnByValue: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    const m = r.result.value;
    if (m.error) throw new Error(m.error);
    const problems = [];
    if (m.viewport !== 390) problems.push('viewport 不是 390：' + m.viewport);
    if (Math.abs(m.button.w - 326) > 1) problems.push('按钮内容宽不是 326：' + m.button.w);
    if (Math.abs(m.button.x - 32) > 1) problems.push('按钮左缘不是 32：' + m.button.x);
    if (Math.abs(m.diff) > 0.5) problems.push('文字中心偏差 > 0.5pt：' + m.diff);
    if (m.display !== 'flex') problems.push('按钮不是 flex：' + m.display);
    if (m.justify !== 'center') problems.push('justify-content 不是 center：' + m.justify);
    if (m.textAlign !== 'center') problems.push('text-align 不是 center：' + m.textAlign);
    console.log(JSON.stringify(m, null, 2));
    if (problems.length) {
      console.error('✗ ' + problems.join('；'));
      process.exitCode = 1;
    } else {
      console.log('✓ 390 宽：按钮 326pt，文字「' + m.text + '」中心与按钮中心偏差 '
        + m.diff.toFixed(3) + 'pt（≤ 0.5）');
    }
  } finally {
    try { chrome.cleanup(); } catch (_) {}
    srv.close();
  }
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
