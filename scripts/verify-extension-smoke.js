#!/usr/bin/env node
// scripts/verify-extension-smoke.js — 「装进浏览器之后，它真的能翻一段吗」。
//
// 为什么这个门必须存在（2026-08-19/20，一天之内栽了三次）：
//   · 1.5.4 的回退发出去是**空转** —— 调用方开了、接收方还锁着，而所有门禁全绿。
//   · 1.5.5 的路线记忆被一次偶发失败毒化，整页后半段全挂 —— 门禁同样全绿。
//   · 1.5.8 被报「完全不可用」时，我手上没有任何一条能回答「装上去到底行不行」的证据。
//
// 已有的门各自只看一层：npm test 看模块，test:layout 用 google 通道看渲染，
// test:app 看宿主页起不起得来。**没有一条**覆盖「真实安装 × 用户那种自定义端点 ×
// 端到端出译文」。这一条补的就是它。
//
// 判据是端到端的、并且**说得出走的哪条路**：
//   1. 扩展装得上，service worker 起得来，三个扩展页面都渲染出内容且无运行期错误；
//   2. 配一个 custom_chat 的本地端点，打开网页点翻译，页面上真的出现译文；
//   3. 报告这次走的是直连还是扩展后台 —— 两条路的失败长得一样，不说出来就查不动。
//
//   node scripts/verify-extension-smoke.js [dist 目录]

'use strict';
const http = require('http');
const path = require('path');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const MARK = '【译文到达】';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>smoke</title></head>
<body><p id="p1">Spaced repetition is an evidence-based learning technique.</p>
<p id="p2">The forgetting curve describes how memory fades over time.</p></body></html>`;

// 端点**故意不带** Access-Control-Allow-Origin：这正是用户那个企业网关的形状。
// 直连会被浏览器挡在预检那一步，只有走扩展后台才通得过 —— 于是这个 fixture 同时
// 验证了「后台优先」这条路是真的活着，而不是只在单测里活着。
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') { res.writeHead(403); res.end('nope'); return; }
      if (req.url.startsWith('/v1/chat/completions')) {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(body); } catch (_) {}
          // 带 temperature 就拒 —— 而且**照企业网关的形状层层包裹**（真机 2026-08-20
          // 拿到的就是三层）。这样这条冒烟同时验了两件事：请求体协商真的会让掉被点名
          // 的字段，以及 serverSays 能从这么深的嵌套里把字段名读出来。手写一个平坦的
          // 错误体测不到后者，而后者正是差点让协商静默失效的地方。
          if ('temperature' in parsed) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ object: 'response', error: {
              code: 'MPE-001',
              message: JSON.stringify({ error: { type: 'llm_call_failed', treace_id: 'x'.repeat(30),
                message: JSON.stringify({ error: {
                  message: "Unsupported parameter: 'temperature' is not supported with this model.",
                  type: 'invalid_request_error', param: 'temperature', code: null } }) } }),
            } }));
            return;
          }
          const text = ((parsed.messages || []).slice(-1)[0] || {}).content || '';
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: MARK + text.slice(0, 12) } }] }));
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalIn(cdp, sessionId, expression, contextId) {
  const r = await cdp.send('Runtime.evaluate',
    Object.assign({ expression, returnByValue: true, awaitPromise: true },
      contextId ? { contextId } : {}), sessionId);
  if (r.exceptionDetails) {
    throw new Error(`eval failed: ${r.exceptionDetails.text} ${(r.exceptionDetails.exception || {}).description || ''}`);
  }
  return r.result ? r.result.value : undefined;
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  const problems = [];
  const notes = [];

  try {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');
    // 装的到底是哪个版本 —— 一天下来「你测的是哪版」问了三次，让产物自己说。
    // 同时对照 package.json:两者不一致 = dist/ 是旧的,这条冒烟就在验一个过期的包。
    const distManifest = JSON.parse(require('fs').readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
    const pkgVersion = require(path.join(__dirname, '..', 'package.json')).version;
    notes.push(`扩展 id ${extId}`);
    notes.push(`装入版本 ${distManifest.version}（package.json 是 ${pkgVersion}，来源 ${DIST}）`);
    if (distManifest.version !== pkgVersion) {
      problems.push(`dist/ 是 ${distManifest.version}、package.json 是 ${pkgVersion} —— 这次冒烟验的是一个过期的包，先 node build.js`);
    }

    // ── 1. service worker 起得来吗（background.js 加载期是否炸掉）────────────
    let swSession = null;
    for (let i = 0; i < 60 && !swSession; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
      if (sw) ({ sessionId: swSession } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true }));
      else await sleep(150);
    }
    if (!swSession) { problems.push('service worker 未启动'); }
    notes.push(`service worker ${swSession ? '已启动' : '未启动'}`);

    // ── 2. 三个扩展页面渲染 + 运行期错误 ────────────────────────────────────
    for (const p of ['options/options.html', 'popup/popup.html', 'learn/review.html']) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const errs = [];
      const off1 = cdp.on('Runtime.exceptionThrown', (ev, sid) => {
        if (sid === sessionId) errs.push(`EXCEPTION ${(ev.exceptionDetails || {}).text || ''}`);
      });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/${p}` }, sessionId);
      await sleep(2000);
      const len = await evalIn(cdp, sessionId, 'document.body ? document.body.innerText.trim().length : -1');
      if (!(len > 60)) problems.push(`${p} 几乎是空白页（可见文本 ${len}）—— 加载期就炸了`);
      for (const e of errs) problems.push(`${p}: ${e}`);
      notes.push(`${p} 可见文本 ${len} 字符`);
      off1();
      await cdp.send('Target.closeTarget', { targetId });
    }

    // ── 3. 配置成用户那种形状：custom_chat + 自填完整端点 ────────────────────
    if (swSession) {
      await evalIn(cdp, swSession, `new Promise(r => chrome.storage.local.set(${JSON.stringify({
        provider: 'custom_chat', apiKey: 'smoke-key',
        apiBaseUrl: `${base}/v1/chat/completions`, apiModel: 'smoke-model',
        targetLang: 'zh-CN', enabled: true, showFab: true,
      })}, () => r(1)))`);
    }

    // ── 4. 打开网页，点翻译，看页面上有没有真的出现译文 ──────────────────────
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const isolated = new Set();
    const offCtx = cdp.on('Runtime.executionContextCreated', (p, sid) => {
      if (sid === sessionId && p.context.auxData && p.context.auxData.type === 'isolated') isolated.add(p.context.id);
    });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `${base}/page.html` }, sessionId);

    let ctxId = null;
    for (let i = 0; i < 80 && !ctxId; i++) {
      for (const id of [...isolated].reverse()) {
        try {
          if (await evalIn(cdp, sessionId, "typeof WebpageTranslator === 'object'", id)) { ctxId = id; break; }
        } catch (_) { /* stale */ }
      }
      if (!ctxId) await sleep(150);
    }
    if (!ctxId) {
      problems.push('内容脚本从未就绪 —— WebpageTranslator 没出现（IIFE 在加载期炸了？）');
    } else {
      await evalIn(cdp, sessionId, `WebpageTranslator.enable(${JSON.stringify({
        provider: 'custom_chat', apiKey: 'smoke-key',
        apiBaseUrl: `${base}/v1/chat/completions`, apiModel: 'smoke-model',
        targetLang: 'zh-CN',
      })}); true`, ctxId);

      let got = '';
      for (let i = 0; i < 100; i++) {
        got = await evalIn(cdp, sessionId,
          `Array.from(document.querySelectorAll('.mt-translation')).map(n => n.innerText).join(' | ')`, ctxId);
        if (got && got.includes(MARK)) break;
        await sleep(200);
      }
      if (got && got.includes(MARK)) notes.push(`页面译文: ${got.slice(0, 80)}`);
      else problems.push(`页面上没有出现译文（.mt-translation = ${JSON.stringify(got)}）`);

      // 走的哪条路 —— 端点故意不给 CORS 头，通得过就只可能是后台。
      const diag = await evalIn(cdp, sessionId,
        `(async () => { const d = {}; try { await TranslationAPI.translate('Hello there.', 'zh-CN', 'custom_chat',
           'smoke-key', ${JSON.stringify(`${base}/v1/chat/completions`)}, 'smoke-model', { noCache: true, diag: d }); }
           catch (e) { d.error = String(e && e.message || e); } return JSON.stringify(d); })()`, ctxId);
      notes.push(`诊断: ${diag}`);
      const d = JSON.parse(diag || '{}');
      if (d.route !== 'proxy') {
        problems.push(`通路是 ${JSON.stringify(d.route)}，期望 proxy —— 端点没有 CORS 头，直连本就该被挡`);
      }
    }
    offCtx();
  } finally {
    try { await cdp.close(); } catch (_) {}
    chrome.cleanup();
    srv.close();
  }

  console.log(notes.join('\n'));
  console.log('');
  if (problems.length) {
    console.log('✗ 安装冒烟失败:');
    for (const p of problems) console.log('   ' + p);
    process.exit(1);
  }
  console.log('✓ 真实安装 → 严格 CORS 端点 → 请求体协商 → 页面出译文，全通（通路：扩展后台）');
})().catch((e) => { console.error('smoke failed:', (e && e.stack) || e); process.exit(1); });
