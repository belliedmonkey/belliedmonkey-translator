#!/usr/bin/env node
// scripts/verify-quick.js — macOS「快速翻译」面板页真 Chrome 端到端（npm run test:quick；Node ≥22）。
//
// 面板是**同一份** Main.html 以 #quick 加载出来的第二个 WKWebView（docs/learning-design.md §9.9）。这条门看的是
// 出货的包布局（dist-app：Main.html 在 Base.lproj/、Script.js 在根）在 #quick 下的真实行为：
//   · 主壳一件事都没启动 —— 不开学习库（IndexedDB 0 次）、不发任何请求、<main> 不显示
//   · 假 mtQuick 桥交来文字 ⇒ 页面上真的出现译文；端点收到的目标语言对；出站消息的形状对
//   · 零权限路径的三个陷阱：隐藏标记 ⇒ **端点 0 请求**；空；和上次一样 ⇒ 显示上次的、0 请求
//   · 上一句还在翻时再触发 ⇒ 迟到的结果不上屏、不进复习库
//   · 失败两态的出口不同：401 ⇒「打开设置」；网络类 ⇒「重试」
// 判据是**端点收到了什么、桥收到了什么**，不只是页面画了什么 —— 「密码被发出去了」在界面上看不出来。
// 原生那一半（面板、热键、剪贴板、截图）由真机配方验（verification-spec 矩阵第 10 行）。
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const { installSweep, sweepBoth, setScheme } = require(path.join(ROOT, 'scripts/lib/sweep.js'));

const SRC = path.join(ROOT, 'dist-app');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('\n✗ 超时（120s），没有结论'); process.exit(2); }, 120000).unref();

const stats = { calls: [], images: 0, mode: 'ok', delayMs: 0, other: [] };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/v1/chat/completions') {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(); return; }
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let user = '', sys = '';
        try { const j = JSON.parse(body); user = (j.messages.find((x) => x.role === 'user') || {}).content || ''; sys = (j.messages.find((x) => x.role === 'system') || {}).content || ''; } catch (_) {}
        // 识图请求（截图翻译的「用我的识图引擎再试」）：带图片的那一条单独数 —— 「截图被发出去了」在界面上看不出来。
        if (/image_url|data:image\//.test(body)) {
          stats.images++;
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'Text the cloud engine read.' } }] })); return;
        }
        stats.calls.push({ user: String(user), dir: ((sys.match(/into ([^.]+)\./) || [])[1] || '?').trim() });
        if (stats.mode === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); return; }
        if (stats.mode === '503') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"down"}}'); return; }
        const send = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '译：' + String(user).slice(0, 40) } }] })); };
        if (stats.delayMs) setTimeout(send, stats.delayMs); else send();
      });
      return;
    }
    const rel = u;
    const name = path.basename(rel);
    const okFile = (name === 'Main.html' && rel.startsWith('/Base.lproj/')) || ((name === 'Script.js' || name === 'Style.css') && !rel.startsWith('/Base.lproj/'));
    if (!okFile) { stats.other.push(req.method + ' ' + u); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'text/plain' });
    res.end(fs.readFileSync(path.join(SRC, name)));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function evalIn(cdp, sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error('页面里抛了：' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(fn, ms, label) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`超时 ${ms}ms：${label}`); await sleep(100); }
}

// document-start：假 mtQuick 桥（记下每条出站消息）+ 两个探针（IndexedDB 打开次数、fetch 的去向）。
const PRELUDE = `(() => {
  window.__out = []; window.__idb = 0; window.__idbWho = []; window.__fetched = [];
  window.webkit = { messageHandlers: { mtQuick: { postMessage: (m) => { __out.push(JSON.parse(JSON.stringify(m))); } } } };
  window.__tmInit = 0;
  Object.defineProperty(window, 'MTTelemetry', { configurable: true, get() { return undefined; }, set(v) {
    const init = v.init; v.init = function () { __tmInit++; return init.apply(this, arguments); };
    Object.defineProperty(window, 'MTTelemetry', { value: v, writable: true, configurable: true }); } });
  const open = indexedDB.open.bind(indexedDB); indexedDB.open = function () { __idb++; __idbWho.push(String(arguments[0]) + ' ← ' + String(new Error().stack).split('\\n').slice(2, 12).join(' | ')); return open.apply(null, arguments); };
  const f = window.fetch.bind(window); window.fetch = function (u) { __fetched.push(String(u && u.url || u)); return f.apply(null, arguments); };
})()`;

async function main() {
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) { console.error(`✗ dist-app/${f} 不存在 —— 先跑 node build.js`); process.exit(1); }
  }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launchChrome(['--window-size=420,520']);
  const problems = [];
  const need = (c, msg) => { if (!c) problems.push(msg); else process.stdout.write('.'); };
  let cdp, sessionId;
  try {
    cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    sessionId = (await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
    await cdp.send('Runtime.enable', {}, sessionId);
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => problems.push('EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });
    await cdp.send('Page.enable', {}, sessionId);
    const E = (x) => evalIn(cdp, sessionId, x);
    const show = (m) => E(`(AppQuick._fromNative(${JSON.stringify(Object.assign({ type: 'quick-show' }, m))}), 'ok')`);
    const dom = async () => JSON.parse(await E(`JSON.stringify({
      tag: document.getElementById('qk-tag').textContent, src: document.getElementById('qk-src').value, srcHidden: document.getElementById('qk-src').hidden,
      tr: [...document.querySelectorAll('#qk-out .qk-tr')].map((x) => x.textContent), sk: document.querySelectorAll('#qk-out .qk-sk').length,
      err: (document.querySelector('#qk-out .qk-err') || {}).textContent || '', msg: [...document.querySelectorAll('#qk-out .qk-note')].map((x) => x.textContent).join('|'),
      note: document.getElementById('qk-note').hidden ? '' : document.getElementById('qk-note').textContent,
      acts: [...document.querySelectorAll('#qk-actions button')].map((x) => x.textContent), state: document.getElementById('qk-state').textContent,
      lang: document.getElementById('qk-lang').value, langHidden: document.getElementById('qk-lang').hidden, from: document.getElementById('qk-from').textContent,
      copyHidden: document.getElementById('qk-copy').hidden })`));
    const out = async (type) => JSON.parse(await E(`JSON.stringify(__out.filter((m) => m.type === ${JSON.stringify(type)}))`));
    const settled = () => until(async () => { const d = await dom(); return (d.sk === 0 && (d.tr.length || d.err || d.msg)) ? d : null; }, 8000, '面板落定');

    // ── 0. 先在主页面（不带 #quick）把引擎配好：同源 ⇒ 面板页读到的就是这一份 ──
    await cdp.send('Page.navigate', { url: base + '/Base.lproj/Main.html?seed' }, sessionId);
    await sleep(1500);
    await E(`(async () => { await new Promise((r) => chrome.storage.local.set({ provider: 'custom_chat', apiKey: 'x', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', uiLang: 'zh-CN', targetLang: 'zh-CN', learnEnabled: true }, r)); return 'ok'; })()`);

    // ── A. #quick 冷启动：主壳一件事都没做 ──
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE }, sessionId);
    stats.calls.length = 0; stats.other.length = 0;
    await cdp.send('Page.navigate', { url: base + '/Base.lproj/Main.html#quick' }, sessionId);
    await until(() => E(`typeof __out !== 'undefined' && __out.some((m) => m.type === 'quick-ready')`), 8000, 'A: quick-ready');
    await sleep(1200);   // 主壳若启动了，同步 / 心跳 / 开库都发生在这一秒里
    const a = JSON.parse(await E(`JSON.stringify({ idb: __idb, who: __idbWho, tmInit: __tmInit, tmSeen: typeof MTTelemetry !== 'undefined', fetched: __fetched, quickMode: document.documentElement.classList.contains('quick-mode'),
      appShown: getComputedStyle(document.getElementById('app')).display, rootShown: getComputedStyle(document.getElementById('quick-root')).display,
      opts: [...document.getElementById('qk-lang').options].map((o) => o.value), resize: __out.filter((m) => m.type === 'quick-resize').length })`));
    need(a.quickMode && a.appShown === 'none' && a.rootShown !== 'none', 'A: #quick 下该只显示面板，实际 ' + JSON.stringify(a));
    need(a.idb === 0, `A: 面板页不该打开学习库（第二个打开者会握着过期的库名），实际 indexedDB.open ${a.idb} 次：${JSON.stringify(a.who)}`);
    need(a.tmSeen && a.tmInit === 0, `A: 面板页不该初始化遥测（心跳与补发归主页面），实际 init ${a.tmInit} 次（探针装上了吗：${a.tmSeen}）`);
    need(a.fetched.length === 0 && stats.other.length === 0, 'A: 面板页启动时不该发任何请求，实际 ' + JSON.stringify(a.fetched.concat(stats.other)));
    need(a.opts.length >= 10 && a.opts.indexOf('') < 0 && a.opts.indexOf('zh-CN') >= 0, 'A: 目标语言选项该从「译成」克隆、去掉「跟随界面语言」，实际 ' + JSON.stringify(a.opts));
    need(a.resize >= 1, 'A: 启动后该报一次高度（quick-resize）');

    // ── A2. 面板跟随「界面语言」──────────────────────────────────────────────
    // 面板是**独立的一次页面加载**，有它自己的 PageI18n —— 主壳或设置页调过
    // setUiLang 不算数。2026-09-25 真机实测：界面语言设成 English，面板的标题、
    // 「复制译文」、那句隐私说明**全是中文**，因为这条启动路径没人调 setUiLang。
    //
    // 判据用**日语**：跑测试的 Chrome 是英文，拿 'en' 当期望会在「根本没读 uiLang」
    // 时照样绿（系统回落恰好也给英文）；'ja' 既不是系统语言也不是回落值（zh_CN）。
    //
    // ⚠️ 重开这一页必须用 **Page.reload**。`Page.navigate` 到**同一个 URL 同一个
    // hash** 不会重新加载文档，面板根本不会再启动一次 —— 于是量到的是上一次启动的
    // 结果，门禁会对着修好的代码报红（09-25 就这么误判了一轮）。
    {
      await E(`new Promise((r) => chrome.storage.local.set({ uiLang: 'ja' }, r))`);
      need(JSON.parse(await E(`new Promise((r) => chrome.storage.local.get(['uiLang'], (v) => r(JSON.stringify(v || {}))))`)).uiLang === 'ja',
        'A2: 种子没落盘，后面量的就不是这件事');   // 只信回读
      await cdp.send('Page.reload', {}, sessionId);
      await until(() => E(`typeof __out !== 'undefined' && __out.some((m) => m.type === 'quick-ready')`), 8000, 'A2: quick-ready');
      await sleep(900);   // applyStoredUiLang 是异步读存储，重画落在 quick-ready 之后
      const ja = JSON.parse(await E(`JSON.stringify({
        copy: document.getElementById('qk-copy').getAttribute('aria-label') || '',
        ph: document.getElementById('qk-src').placeholder || '',
        loc: (typeof PageI18n !== 'undefined' ? PageI18n.effectiveLocale() : '-') })`));
      need(ja.loc === 'ja', `A2: 面板该按 uiLang 解出 ja，实际「${ja.loc}」—— 这条启动路径没调 setUiLang`);
      need(ja.copy === '訳文をコピー', `A2: 面板的「复制译文」该跟着变日文，实际「${ja.copy}」`);
      need(ja.ph === '翻訳するテキストを入力またはペースト', `A2: 占位文案也该跟着变，实际「${ja.ph}」`);
      // 还原：后面几段都按中文界面断言（「选中文字」「已存入复习库」）
      await E(`new Promise((r) => chrome.storage.local.set({ uiLang: 'zh-CN' }, r))`);
      stats.calls.length = 0; stats.other.length = 0;
      await cdp.send('Page.reload', {}, sessionId);
      await until(() => E(`typeof __out !== 'undefined' && __out.some((m) => m.type === 'quick-ready')`), 8000, 'A2: 还原后 quick-ready');
      await sleep(700);
    }

    // ── B. 交来选中文字 ⇒ 译文上屏、方向对、出站消息形状对 ──
    await show({ via: 'select', origin: 'selection', text: 'The committee postponed the vote.' });
    const b = await settled();
    need(b.tr.length === 1 && b.tr[0] === '译：The committee postponed the vote.', 'B: 译文该上屏，实际 ' + JSON.stringify(b));
    need(b.src === 'The committee postponed the vote.' && b.tag === '选中文字', 'B: 原文与来源标签，实际 ' + JSON.stringify([b.src, b.tag]));
    need(stats.calls.length === 1 && /Chinese|中文/i.test(stats.calls[0].dir), 'B: 端点该恰好收到 1 次、译成中文，实际 ' + JSON.stringify(stats.calls));
    need(b.state === '已存入复习库' && !b.copyHidden, 'B: 底栏该说已存入、复制钮可用，实际 ' + JSON.stringify([b.state, b.copyHidden]));
    const capB = await out('quick-capture'); const resB = await out('quick-result');
    need(capB.length === 1 && capB[0].v === 1 && capB[0].via === 'select' && capB[0].text === b.src && capB[0].tr === b.tr[0] && capB[0].trLang === 'zh-CN' && Number.isFinite(capB[0].ts)
      && Object.keys(capB[0]).sort().join() === 'lang,text,tr,trLang,ts,type,v,via', 'B: quick-capture 该恰好 1 条、只有约定的字段，实际 ' + JSON.stringify(capB));
    need(resB.length === 1 && resB[0].ok === true && resB[0].provider === 'custom_chat' && Number.isInteger(resB[0].ms), 'B: quick-result 该是 {ok, provider, ms:int}，实际 ' + JSON.stringify(resB));
    await E(`(document.getElementById('qk-copy').click(), 'ok')`);
    need((await out('quick-copy'))[0] && (await out('quick-copy'))[0].text === b.tr[0], 'B: 复制该把译文交给原生（页面自己写不了系统剪贴板）');
    // 图标钮只有一个 SVG，没有文字 —— 对比度清扫量不到它（没有自有文字），所以单独量几何与描边色。
    const icons = JSON.parse(await E(`JSON.stringify(['qk-pin', 'qk-close', 'qk-copy'].map((id) => { const b = document.getElementById(id), g = b.querySelector('svg'), r = g.getBoundingClientRect(), p = getComputedStyle(g.querySelector('path, rect'));
      return { id, w: Math.round(r.width), h: Math.round(r.height), bw: Math.round(b.getBoundingClientRect().width), stroke: p.stroke, sw: p.strokeWidth, fill: p.fill }; }))`));
    need(icons.every((i) => i.w >= 14 && i.h >= 14 && i.bw >= 28 && i.stroke !== 'none' && parseFloat(i.sw) >= 1.5), 'B: 三个图标钮该看得见（SVG ≥ 14px、有描边），实际 ' + JSON.stringify(icons));
    await installSweep(cdp, sessionId);
    const surf2 = async (label) => { for (const x of await sweepBoth(cdp, sessionId, '#g-quick')) problems.push(`可读性 · ${label} ${x}`); };
    const surf = async (label) => { for (const x of await sweepBoth(cdp, sessionId, '#quick-root')) problems.push(`可读性 · ${label} ${x}`); 
      // MT_SHOTS=<目录>：顺手留两色截图给人看（门禁本身不看图）
      if (process.env.MT_SHOTS) for (const scheme of ['light', 'dark']) {
        await setScheme(cdp, sessionId, scheme);
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(path.join(process.env.MT_SHOTS, `quick-${label}-${scheme}.png`), Buffer.from(r.data, 'base64'));
      }
      await setScheme(cdp, sessionId, 'light');
    };
    await surf('译文态');

    // ── C. 三个陷阱 ──
    let n = stats.calls.length;
    await show({ via: 'select', origin: 'clipboard', text: 'hunter2-Secret!', concealed: true });
    await sleep(600); const c1 = await dom();
    need(stats.calls.length === n, 'C1: 带隐藏标记的剪贴板**一次请求都不该发**，实际多了 ' + (stats.calls.length - n));
    need(/隐藏/.test(c1.msg) && c1.srcHidden && !/hunter2/.test(JSON.stringify(c1)), 'C1: 该只说一句原因、页面上不出现那段文字，实际 ' + JSON.stringify(c1));
    await show({ via: 'select', origin: 'clipboard', text: '   ' });
    await sleep(300); const c2 = await dom();
    need(stats.calls.length === n && /⌘C/.test(c2.msg), 'C2: 空剪贴板 ⇒ 0 请求 + 指引，实际 ' + JSON.stringify(c2));
    await show({ via: 'select', origin: 'clipboard', text: 'The committee postponed the vote.' });
    await sleep(600); const c3 = await dom();
    need(stats.calls.length === n && c3.tr[0] === b.tr[0] && /⌘C/.test(c3.note), 'C3: 和上次一样 ⇒ 显示上次的结果、0 请求、提示忘了 ⌘C，实际 ' + JSON.stringify(c3) + ' 请求 +' + (stats.calls.length - n));
    need((await out('quick-capture')).length === 1, 'C: 三个陷阱都不该再交一条进复习库');
    // 我们自己刚复制出去的译文（原生按 changeCount 认出来，报 own）⇒ 不再翻一遍；系统没让读 ⇒ 说原因
    await show({ via: 'select', origin: 'clipboard', text: b.tr[0], own: true }); await sleep(500); const c4 = await dom();
    need(stats.calls.length === n && c4.src === b.src && c4.tr[0] === b.tr[0], 'C4: 剪贴板里是我们自己的译文 ⇒ 0 请求、显示上次那一对，实际 ' + JSON.stringify(c4));
    await show({ via: 'select', origin: 'clipboard', blocked: true }); await sleep(300); const c5 = await dom();
    need(stats.calls.length === n && /粘贴自其他 App/.test(c5.msg), 'C5: 系统没让读剪贴板 ⇒ 0 请求 + 说去哪里允许，实际 ' + JSON.stringify(c5.msg));

    // ── D. 原文已是目标语言 ⇒ 反向 + 写明原因；符号 ⇒ 没有可翻译的文字 ──
    await show({ via: 'select', origin: 'selection', text: '委员会推迟了表决。' });
    const d = await settled();
    need((await out('quick-result')).length === 1, 'D: 同一个面板会话里第二次成功不该再报一条 quick-result（每会话一条），实际 ' + (await out('quick-result')).length);
    need(/English/i.test(stats.calls[stats.calls.length - 1].dir) && d.lang === 'en' && /简体中文|中文/.test(d.from), 'D: 该反向译成英文并写明「原文已是…」，实际 ' + JSON.stringify([stats.calls[stats.calls.length - 1], d.lang, d.from]));
    n = stats.calls.length;
    await show({ via: 'select', origin: 'selection', text: ' 12 → 34 ' }); await sleep(400);
    need(stats.calls.length === n && /没有可翻译/.test((await dom()).msg), 'D: 只有数字符号 ⇒ 0 请求 + 一句话');

    // ── E. 上一句还在翻时再触发 ⇒ 迟到的不上屏、不进库 ──
    const capBefore = (await out('quick-capture')).length;
    stats.delayMs = 900;
    await show({ via: 'select', origin: 'selection', text: 'First slow sentence.' });
    await sleep(150); stats.delayMs = 0;
    await show({ via: 'select', origin: 'selection', text: 'Second quick sentence.' });
    const e1 = await settled(); await sleep(1200); const e2 = await dom();
    need(e1.tr[0] === '译：Second quick sentence.' && e2.tr.length === 1 && e2.tr[0] === e1.tr[0] && e2.src === 'Second quick sentence.', 'E: 迟到的上一句不该盖掉新的，实际 ' + JSON.stringify(e2));
    const capE = (await out('quick-capture')).slice(capBefore);
    need(capE.length === 1 && capE[0].text === 'Second quick sentence.', 'E: 被取消的那句不该进复习库，实际 ' + JSON.stringify(capE.map((x) => x.text)));

    // ── F. 长文逐段；截图行框；输入翻译 ──
    await show({ via: 'select', origin: 'selection', text: 'Paragraph one.\n\nParagraph two.' });
    const f1 = await settled();
    need(f1.tr.length === 2 && f1.tr[1] === '译：Paragraph two.', 'F: 两段该各出一条译文，实际 ' + JSON.stringify(f1.tr));
    await E(`(AppQuick._fromNative({ type: 'quick-ocr', lines: [{ text: 'world', box: { x: .5, y: .101, w: .3, h: .04 } }, { text: 'Hello', box: { x: .1, y: .1, w: .3, h: .04 } }] }), 'ok')`);
    const f2 = await settled();
    need(f2.src === 'Hello world' && f2.tag === '截图' && f2.tr[0] === '译：Hello world', 'F: 行框该按阅读顺序拼好再翻，实际 ' + JSON.stringify(f2));
    need((await out('quick-capture')).pop().via === 'shot', 'F: 截图来的句子 via 该是 shot');
    await E(`(AppQuick._fromNative({ type: 'quick-ocr', lines: [] }), 'ok')`); await sleep(300);
    const f3 = await dom();
    need(/没有认出/.test(f3.msg) && f3.acts[0] === '重新框选', 'F: 零产出 ⇒ 一句话 + 主按钮「重新框选」，实际 ' + JSON.stringify(f3));
    await E(`(document.querySelector('#qk-actions button').click(), 'ok')`);
    need((await out('quick-reselect')).length === 1, 'F: 「重新框选」该交给原生');
    await show({ via: 'input', origin: 'typed' }); await sleep(300);
    need(await E(`document.activeElement === document.getElementById('qk-src')`), 'F: 输入翻译该把焦点放进输入框');
    n = stats.calls.length;
    await E(`(() => { const el = document.getElementById('qk-src'); el.value = 'Typed text here.'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })); return 'ok'; })()`);
    await sleep(300); need(stats.calls.length === n, 'F: ⇧回车是换行，不该发请求');
    await E(`(document.getElementById('qk-src').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 'ok')`);
    const f4 = await settled();
    need(f4.tr[0] === '译：Typed text here.' && (await out('quick-capture')).pop().via === 'input', 'F: 回车该翻译、via 是 input，实际 ' + JSON.stringify(f4.tr));

    // 右键「服务」交来的（M-4）：来源标签是「服务」，进复习库时 via 是 service（与划词并成一组，由 AppHandoff 定）
    await show({ via: 'service', origin: 'service', text: 'Handed over by the Services menu.' });
    const f5 = await settled();
    need(f5.tag === '服务' && f5.tr[0] === '译：Handed over by the Services menu.' && (await out('quick-capture')).pop().via === 'service', 'F: 服务来的句子该有「服务」标签、via 是 service，实际 ' + JSON.stringify([f5.tag, f5.tr]));
    n = stats.calls.length;
    await show({ via: 'service', origin: 'service', text: '' }); await sleep(300);
    need(stats.calls.length === n && /没有可翻译/.test((await dom()).msg), 'F: 服务交来空文字 ⇒ 0 请求 + 一句话');

    // ── 截图翻译（M-6）：识别中 / 第一次 / 权限 / 「点了才发图」──
    await show({ via: 'shot', origin: 'screen', busy: true, first: true, fresh: true }); await sleep(300); const q1 = await dom();
    need(q1.tag === '截图' && /正在本机识别/.test(q1.msg) && /大约 20 秒/.test(q1.msg) && q1.srcHidden, 'F: 识别中 + 这台 Mac 上第一次的那一行，实际 ' + JSON.stringify(q1.msg));
    await show({ via: 'shot', origin: 'screen', busy: true, first: false }); await sleep(200);
    need(!/20 秒/.test((await dom()).msg), 'F: 不是第一次就不该有那一行');
    await E(`new Promise((r) => chrome.storage.local.remove(['quickShotAsked'], () => r('ok')))`);
    const permBefore = (await out('quick-request-perm')).length;
    await show({ via: 'shot', origin: 'screen', perm: 'screen', appName: 'BelliedMonkey Translator CN', second: true }); await sleep(400); const q2 = await dom();
    need(/屏幕录制/.test(q2.msg) && /识别完即丢弃/.test(q2.msg) && q2.acts.join() === '继续' && (await out('quick-request-perm')).length === permBefore, 'F: 没有录屏权限 ⇒ 系统弹窗之前我们自己的话先到，此时还没去问系统，实际 ' + JSON.stringify(q2));
    await E(`(document.querySelector('#qk-actions button').click(), 'ok')`); await sleep(400); const q3 = await dom();
    need((await out('quick-request-perm')).slice(-1)[0].which === 'screen' && /「BelliedMonkey Translator CN」/.test(q3.msg) && /重新打开 App 才生效/.test(q3.msg) && q3.acts.join() === '现在重开,打开系统设置',
      'F: 「继续」⇒ 调系统的请求接口 + 「还差一步」（原样说出系统列表里的名字）+ 两个出口，实际 ' + JSON.stringify(q3));
    need(/系统还会再弹一次确认/.test(q3.msg) && !/系统还会再弹/.test(q2.msg), 'F: 会有第二道系统框的系统上（second）⇒「还差一步」里预告它；我们自己那句说明里不提，实际 ' + JSON.stringify(q3.msg));
    await E(`([...document.querySelectorAll('#qk-actions button')].forEach((b) => b.click()), 'ok')`);
    need((await out('quick-relaunch')).length === 1 && (await out('quick-open-privacy')).slice(-1)[0].which === 'screen', 'F: 两个按钮各交给原生一条');
    await show({ via: 'shot', origin: 'screen', perm: 'screen', appName: 'X' }); await sleep(300);
    need(!/系统还会再弹/.test((await dom()).msg), 'F: 不会有第二道的系统上（macOS 14）不该预告一件不会发生的事');
    need((await dom()).acts.join() === '现在重开,打开系统设置', 'F: 说过一次之后再触发 ⇒ 直接是「还差一步」那一态（入口不因为被拒而消失）');
    await surf('截图 · 等重开');
    // 本机没认出 + 引擎支持识图 ⇒ 多一个次级按钮，旁边写明发给谁；**点之前端点一张图都没收到**
    const imgBefore = stats.images;
    await E(`(AppQuick._fromNative({ type: 'quick-ocr', lines: [] }), 'ok')`); await sleep(500); const q4 = await dom();
    need(q4.acts.join() === '重新框选,用我的识图引擎再试' && /会把这张截图发给你配置的引擎/.test(q4.note) && stats.images === imgBefore, 'F: 零产出 ⇒ 次级按钮 + 写明发给谁，且此刻 0 张图，实际 ' + JSON.stringify([q4.acts, q4.note, stats.images]));
    await surf('截图 · 没认出');
    await E(`(document.querySelectorAll('#qk-actions button')[1].click(), 'ok')`); await sleep(300);
    need((await out('quick-ocr-cloud')).length === 1 && stats.images === imgBefore && /正在用你的引擎识别/.test((await dom()).msg), 'F: 点了 ⇒ 向原生要截图；原生交来之前仍是 0 张图');
    await E(`(AppQuick._fromNative({ type: 'quick-image', dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }), 'ok')`);
    const q5 = await until(async () => { const d = await dom(); return d.tr.length ? d : null; }, 8000, 'F: 云端识图后的译文');
    need(stats.images === imgBefore + 1 && q5.src === 'Text the cloud engine read.' && q5.tr[0] === '译：Text the cloud engine read.' && q5.tag === '截图', 'F: 图恰好发 1 次、识出的原文进输入框、再照常翻译，实际 ' + JSON.stringify([stats.images - imgBefore, q5.src, q5.tr]));
    await E(`(AppQuick._fromNative({ type: 'quick-image', dataUri: '' }), 'ok')`); await sleep(300);
    need(/已经丢弃了/.test((await dom()).msg) && stats.images === imgBefore + 1, 'F: 截图已丢弃 ⇒ 说一句 + 重新框选，不发请求');
    // 免费额度在用 ⇒ 不给那个按钮（额度不发图，同文档翻译的裁定）
    await E(`new Promise((r) => chrome.storage.local.get(['apiKey'], (v) => chrome.storage.local.set({ grantTail: String(v.apiKey || '').slice(-4) || 'x' }, () => r('ok'))))`);
    const onGrant = await E(`new Promise((r) => chrome.storage.local.get(null, (s) => r(!!(typeof LearnGrant !== 'undefined' && LearnGrant.active && LearnGrant.active(s)))))`);
    if (onGrant) {
      await E(`(AppQuick._fromNative({ type: 'quick-ocr', lines: [] }), 'ok')`); await sleep(500);
      need((await dom()).acts.join() === '重新框选', 'F: 免费额度在用 ⇒ 只有「重新框选」');
    } else process.stdout.write('(额度态造不出来，跳过这一条)');
    await E(`new Promise((r) => chrome.storage.local.remove(['grantTail'], () => r('ok')))`);

    // 增强取词交来的（M-5）：读的也是通用剪贴板 ⇒ 隐藏标记与「系统不让读」同样成立；没取到 ⇒ **不翻旧剪贴板**
    n = stats.calls.length;
    await show({ via: 'select', origin: 'selection', concealed: true }); await sleep(300); const s1 = await dom();
    need(stats.calls.length === n && /隐藏/.test(s1.msg) && s1.srcHidden && s1.tag === '选中文字', 'F: 取词取到带隐藏标记的内容 ⇒ 0 请求 + 只说原因，实际 ' + JSON.stringify(s1));
    await show({ via: 'select', origin: 'selection', blocked: true }); await sleep(300); const s2 = await dom();
    need(stats.calls.length === n && /粘贴自其他 App/.test(s2.msg), 'F: 取词时系统不让读剪贴板 ⇒ 0 请求 + 说去哪里允许，实际 ' + JSON.stringify(s2.msg));
    await show({ via: 'select', origin: 'selection', text: '' }); await sleep(300); const s3 = await dom();
    need(stats.calls.length === n && /没有取到选中的文字/.test(s3.msg) && s3.acts.join() === '改用截图翻译', 'F: 没取到 ⇒ 0 请求（绝不退回去翻旧剪贴板）+ 改用截图，实际 ' + JSON.stringify(s3));
    await E(`new Promise((r) => chrome.storage.local.set({ quickEnhancedLost: true }, () => r('ok')))`);
    await show({ via: 'select', origin: 'clipboard', text: 'The permission was revoked meanwhile.' });
    const s4 = await settled(); await sleep(200); const s4b = await dom();
    need(/权限被关掉了/.test(s4b.note) && s4.tr.length === 1, 'F: 增强取词的权限没了 ⇒ 照翻剪贴板 + 说一句，实际 ' + JSON.stringify(s4b.note));
    need((await E(`new Promise((r) => chrome.storage.local.get(['quickEnhancedLost'], (v) => r(String(v.quickEnhancedLost))))`)) === 'undefined', 'F: 那一句只说一次（标记该清掉）');
    await show({ via: 'select', origin: 'clipboard', text: 'Second time there is no notice.' });
    await settled(); await sleep(200);
    need(!/权限被关掉了/.test((await dom()).note), 'F: 第二次不该再说');

    // ── G. 失败两态的出口不同 ──
    const resBefore = (await out('quick-result')).length;
    stats.mode = '401';
    await show({ via: 'select', origin: 'selection', text: 'Rejected sentence.', fresh: true });   // fresh = 新的面板会话
    const g1 = await settled();
    need(/key/i.test(g1.err) && g1.acts.join() === '打开设置' && g1.state === '', 'G: 401 ⇒ 说 key 被拒 + 只给「打开设置」，实际 ' + JSON.stringify(g1));
    await surf('失败态');
    stats.mode = '503';
    await show({ via: 'select', origin: 'selection', text: 'Server is down.' });
    const g2 = await settled();
    need(g2.err && g2.acts.join() === '重试', 'G: 5xx ⇒ 只给「重试」，实际 ' + JSON.stringify(g2));
    stats.mode = 'ok';
    await E(`(document.querySelector('#qk-actions button').click(), 'ok')`);
    const g3 = await settled();
    need(g3.tr[0] === '译：Server is down.' && !g3.err, 'G: 重试成功后错误该消失、译文上屏，实际 ' + JSON.stringify(g3));
    const resG = (await out('quick-result')).slice(resBefore);
    need(resG.length === 3 && resG[0].ok === false && resG[0].code === 'auth' && resG[1].ok === false && resG[2].ok === true, 'G: quick-result 该是 失败(auth) / 失败 / 成功，实际 ' + JSON.stringify(resG));

    // ── H. 改目标语言 ⇒ 写回「译成」并立刻重翻；采集关 ⇒ 不交、底栏照实说；未配置 ⇒ 打开设置 ──
    await E(`(() => { const s = document.getElementById('qk-lang'); s.value = 'ja'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
    await until(async () => /Japanese|日本語/i.test(stats.calls[stats.calls.length - 1].dir), 5000, 'H: 改语言后重翻');
    need(await E(`new Promise((r) => chrome.storage.local.get(['targetLang'], (v) => r(v.targetLang)))`) === 'ja', 'H: 面板里改目标语言该写回「译成」');
    await E(`new Promise((r) => chrome.storage.local.set({ quickCapture: false, targetLang: 'zh-CN' }, () => r('ok')))`);
    const capH = (await out('quick-capture')).length;
    await show({ via: 'select', origin: 'selection', text: 'Capture is off now.' });
    const h1 = await settled();
    need(h1.tr.length === 1 && /采集已关/.test(h1.state) && (await out('quick-capture')).length === capH, 'H: 采集关 ⇒ 照翻、不交、底栏说未存入，实际 ' + JSON.stringify(h1.state));
    await E(`new Promise((r) => chrome.storage.local.remove(['apiKey', 'provider', 'apiBaseUrl', 'apiModel'], () => r('ok')))`);
    n = stats.calls.length;
    await show({ via: 'select', origin: 'selection', text: 'No engine yet.' }); await sleep(500);
    const h2 = await dom();
    need(stats.calls.length === n && h2.acts.join() === '打开设置' && /引擎/.test(h2.msg), 'H: 未配置 ⇒ 0 请求 + 「打开设置」，实际 ' + JSON.stringify(h2));
    need(await E(`getComputedStyle(document.querySelector('.qk-foot')).display`) === 'none', 'H: 底栏两样都没有时该整条不占地方（真机上量到过面板底下空一截）');
    await surf('未配置态');
    await E(`(document.querySelector('#qk-actions button').click(), 'ok')`);
    need((await out('quick-open-settings')).length === 1, 'H: 「打开设置」该交给原生去聚焦主窗口');

    // ── I. Esc / 关闭 / 钉住 ⇒ 交给原生；协议表是闭集 ──
    await E(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), document.getElementById('qk-pin').click(), 'ok')`);
    need((await out('quick-close')).length === 1 && (await out('quick-pin'))[0].on === true, 'I: Esc ⇒ quick-close；钉住 ⇒ quick-pin {on:true}');
    const stray = JSON.parse(await E(`JSON.stringify([...new Set(__out.map((m) => m.type))].filter((t) => AppQuick.PROTOCOL.toNative.indexOf(t) < 0))`));
    need(stray.length === 0, 'I: 出站消息该全在协议表里，多出 ' + JSON.stringify(stray));
    need(await E(`__idb`) === 0, 'I: 全程都不该打开学习库');

    // ── K. 真机上量出来的三件事（2026-09-19，macOS 27）──
    // K1 面板刚弹出时窗口只有 120 高；原文框的上限若按「窗口高度的百分比」算，两行的原文只露出一行。
    await E(`new Promise((r) => chrome.storage.local.set({ provider: 'custom_chat', apiKey: 'x', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', quickCapture: true }, () => r('ok')))`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 120, deviceScaleFactor: 2, mobile: false }, sessionId);
    await show({ via: 'select', origin: 'clipboard', fresh: true, text: 'Quarterly earnings beat expectations for the third time in a row this year.' });
    await settled();
    const k1 = JSON.parse(await E(`(() => { const el = document.getElementById('qk-src'); return JSON.stringify({ client: el.clientHeight, scroll: el.scrollHeight, win: innerHeight }); })()`));
    need(k1.scroll > 40 && k1.client >= k1.scroll - 2, 'K1: 窗口还很矮时，两行的原文也该整段露出来（上限不能跟着窗口高度走），实际 ' + JSON.stringify(k1));
    const lastResize = (await out('quick-resize')).pop();
    need(lastResize && lastResize.h > 150, 'K1: 报给原生的高度该是内容的高度、不受当前窗口高度限制，实际 ' + JSON.stringify(lastResize));
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    // K2 钉住时，焦点在面板里按 Esc 也不关（点图钉会让面板成为键盘窗口，随后的 Esc 进的是页面）
    const closeBefore = (await out('quick-close')).length;
    await E(`(() => { const b = document.getElementById('qk-pin'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return 'ok'; })()`);
    need((await out('quick-close')).length === closeBefore, 'K2: 钉住时 Esc 不该关面板');
    // K3 原生在收起时把钉住清掉了；新的面板会话（fresh）开始时页面这一侧也得清，不然图钉一出来就是按下的
    await show({ via: 'select', origin: 'clipboard', fresh: true, text: 'A brand new panel session.' });
    await settled();
    need(await E(`document.getElementById('qk-pin').getAttribute('aria-pressed')`) === 'false', 'K3: 新会话开始时图钉该是没按下的');
    await E(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), 'ok')`);
    need((await out('quick-close')).length === closeBefore + 1, 'K3: 没钉住时 Esc 照常关');

    // ── J. 主页面这一头：中继来的两条消息真的落地（进复习库的唯一写入者 + 遥测代发）──
    await cdp.send('Page.navigate', { url: base + '/Base.lproj/Main.html?main' }, sessionId);
    await until(() => E(`typeof AppQuickHost !== 'undefined' && typeof LearnStore !== 'undefined' && typeof AppHandoff !== 'undefined'`), 8000, 'J: 主页面就绪');
    await sleep(1200);
    await E(`(async () => { window.__tm = []; MTTelemetry.track = (n, p) => { __tm.push({ n, p: p || {} }); return Promise.resolve(true); };
      await new Promise((r) => chrome.storage.local.set({ learnEnabled: true, quickCapture: true }, r)); return 'ok'; })()`);
    const rec = { type: 'quick-capture', v: 1, text: 'The relay delivers this sentence.', tr: '中继把这一句送到了。', lang: 'und', trLang: 'zh-CN', ts: Date.now(), via: 'select' };
    const j1 = JSON.parse(await E(`(async () => { const r = await AppQuickHost._fromNative(${JSON.stringify(rec)}); const all = await LearnStore.allItems();
      const it = all.find((x) => x.text === ${JSON.stringify(rec.text)}); return JSON.stringify({ r, it: it && { tr: it.tr, anchor: it.anchor, sourceId: it.sourceId } }); })()`));
    need(j1.r && j1.r.written === 1 && j1.it && j1.it.tr === rec.tr && j1.it.anchor.k === 'handoff' && j1.it.anchor.via === 'select' && /^handoff:select:\d{4}-\d{2}$/.test(j1.it.sourceId),
      'J: 中继来的句子该经 AppHandoff 进复习库（锚点 handoff / via select），实际 ' + JSON.stringify(j1));
    const j2 = JSON.parse(await E(`(async () => { await new Promise((r) => chrome.storage.local.set({ quickCapture: false }, r));
      const r = await AppQuickHost._fromNative(${JSON.stringify(Object.assign({}, rec, { text: 'Capture switch is off.' }))}); return JSON.stringify(r); })()`));
    need(j2 && j2.written === 0 && j2.skipped['capture-off'] === 1, 'J: 采集关着时，就算面板页交来了也不该写（门在写入者这一头），实际 ' + JSON.stringify(j2));
    await E(`(AppQuickHost._fromNative({ type: 'quick-result', ok: true, provider: 'custom_chat', ms: 321 }), AppQuickHost._fromNative({ type: 'quick-result', ok: false, code: 'auth', provider: 'custom_chat', status: 401, route: 'direct', ms: 9 }), 'ok')`);
    const tm = JSON.parse(await E(`JSON.stringify(__tm.filter((e) => /^translate_/.test(e.n)))`));
    need(tm.length === 2 && tm[0].n === 'translate_ok' && tm[0].p.kind === 'quick' && tm[0].p.ms === 321 && tm[1].n === 'translate_fail' && tm[1].p.code === 'auth' && tm[1].p.status === 401 && !('kind' in tm[1].p),
      'J: quick-result 该由主页面代发 translate_ok{kind:quick} / translate_fail，实际 ' + JSON.stringify(tm));

    // ── L. 主页面 · 设置里的「增强取词」（M-5）。假桥记下出站消息；「重开」用重新报一次能力来模拟 ──
    const hostOut = async (type) => JSON.parse(await E(`JSON.stringify(__out.filter((m) => m.type === ${JSON.stringify(type)}))`));
    const enh = async () => JSON.parse(await E(`JSON.stringify({ rowHidden: document.getElementById('quick-enhanced-row').hidden, on: document.getElementById('quick-enhanced').checked,
      state: document.getElementById('quick-enhanced-state').hidden ? '' : document.getElementById('quick-enhanced-state').textContent,
      relaunch: !document.getElementById('quick-enhanced-actions').hidden && !document.getElementById('quick-enhanced-relaunch').hidden,
      privacy: !document.getElementById('quick-enhanced-actions').hidden, dialog: (document.querySelector('.ld-ok') || {}).textContent || '' })`));
    await E(`(async () => { await new Promise((r) => chrome.storage.local.remove(['quickEnhanced', 'quickEnhancedNote', 'quickEnhancedLost'], r)); document.getElementById('gear').click(); await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true }); return 'ok'; })()`);
    await sleep(400);
    need((await enh()).rowHidden === true, 'L: 原生不报 postEvent（老原生壳）⇒ 增强取词那一行整个不出现');
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: false, appName: 'BelliedMonkey Translator CN' }); return 'ok'; })()`); await sleep(400);
    const l0 = await enh();
    need(!l0.rowHidden && l0.on === false && l0.state === '', 'L: 默认是关的、旁边没有多余的话，实际 ' + JSON.stringify(l0));
    const askedBefore = (await hostOut('quick-request-perm')).length;
    await E(`(document.getElementById('quick-enhanced').click(), 'ok')`); await sleep(400);
    const l1 = await enh();
    need(l1.dialog === '继续' && (await hostOut('quick-request-perm')).length === askedBefore, 'L: 点开关 ⇒ 先出我们自己的说明，此时还没去问系统，实际 ' + JSON.stringify(l1));
    need(/会做/.test(await E(`document.querySelector('.ld-ok').closest('[role=dialog], .ld-box, div').parentElement.textContent`)), 'L: 说明里该有「会做 / 不会做」');
    await E(`(document.querySelector('.ld-cancel').click(), 'ok')`); await sleep(400);
    const l2 = await enh();
    need(l2.on === false && l2.state === '' && (await hostOut('quick-request-perm')).length === askedBefore, 'L: 「先不开」⇒ 开关回到关、什么都没问，实际 ' + JSON.stringify(l2));
    await E(`(document.getElementById('quick-enhanced').click(), 'ok')`); await sleep(300);
    await E(`(document.querySelector('.ld-ok').click(), 'ok')`); await sleep(500);
    const l3 = await enh();
    need((await hostOut('quick-request-perm')).length === askedBefore + 1 && l3.on === false && /重新打开 App 才生效/.test(l3.state) && l3.relaunch && l3.privacy,
      'L: 「继续」⇒ 调系统请求接口；**开关仍是关**（还没生效）+ 一句话 +「现在重开」「打开系统设置」，实际 ' + JSON.stringify(l3));
    need(/「BelliedMonkey Translator CN」/.test(l3.state) && !/\{app\}/.test(l3.state), 'L: 指引里该原样说出系统列表里显示的那个名字（包名，由原生报），实际 ' + l3.state);
    need((await hostOut('quick-config')).pop().enhanced === true, 'L: 原生要知道用户想开（重开后权限一到直接生效）');
    await E(`(document.getElementById('quick-enhanced-relaunch').click(), document.getElementById('quick-enhanced-privacy').click(), 'ok')`);
    need((await hostOut('quick-relaunch')).length === 1 && (await hostOut('quick-open-privacy'))[0].which === 'postEvent', 'L: 两个按钮各交给原生一条');
    await installSweep(cdp, sessionId);      // 换过页面了，清扫函数要重装
    await surf2('增强取词 · 等重开');
    // 重开，权限到了
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: true }); return 'ok'; })()`); await sleep(500);
    const l4 = await enh();
    need(l4.on === true && l4.state === '' && !l4.privacy, 'L: 重开后权限在 ⇒ 开关是开的、那句话与按钮都收掉，实际 ' + JSON.stringify(l4));
    // 后来被用户在系统设置里撤销
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: false }); return 'ok'; })()`); await sleep(500);
    const l5 = await enh();
    need(l5.on === false && /系统没有给权限/.test(l5.state) && l5.privacy && !l5.relaunch, 'L: 权限没了 ⇒ 开关弹回 + 一句话 +「打开系统设置」（没有「现在重开」），实际 ' + JSON.stringify(l5));
    need((await hostOut('quick-config')).pop().enhanced === false && (await E(`new Promise((r) => chrome.storage.local.get(['quickEnhancedLost'], (v) => r(v.quickEnhancedLost)))`)) === true, 'L: 意图弹回 + 给面板留一次性的那一句');
    await surf2('增强取词 · 被拒');
    // 真机实测的顺序：重开发生在授权之前（上面那一步已经弹回并写着「系统没有给权限」）；用户随后授权、再重开
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: true }); return 'ok'; })()`); await sleep(500);
    const l6 = await enh();
    need(l6.on === true && l6.state === '' && (await hostOut('quick-config')).pop().enhanced === true, 'L: 先重开、后授权、再重开 ⇒ 兑现原来的意图，不再挂着「系统没有给权限」，实际 ' + JSON.stringify(l6));
    // 用户自己关掉的 ⇒ 权限在也不替他打开
    await E(`(document.getElementById('quick-enhanced').click(), 'ok')`); await sleep(400);
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: true }); return 'ok'; })()`); await sleep(400);
    need((await enh()).on === false, 'L: 用户自己关掉的，重开后权限在也不该替他打开');

    // ── M. 主页面 · 设置里的快捷键录制控件与 M-7 的其余几行 ──
    const key = (code, mods) => E(`(document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ code: ${JSON.stringify(code)}, key: ${JSON.stringify(code === 'Escape' ? 'Escape' : 'x')}, bubbles: true, cancelable: true }, ${JSON.stringify(mods || {})}))), 'ok')`);
    const hkRow = async (id) => JSON.parse(await E(`(() => { const r = document.querySelector('[data-hk="${id}"]'); if (!r) return 'null'; return JSON.stringify({ hidden: !r.checkVisibility(),
      keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent).join(''), empty: !!r.querySelector('.hk-empty'), live: !!r.querySelector('.hk-live'), why: (r.querySelector('.hk-why') || {}).textContent || '', btns: [...r.querySelectorAll('button')].map((b) => b.textContent) }); })()`));
    const clickIn = (id, text) => E(`([...document.querySelectorAll('[data-hk="${id}"] button')].find((b) => b.textContent === ${JSON.stringify(text)}).click(), 'ok')`);
    const stored = async () => JSON.parse(await E(`new Promise((r) => chrome.storage.local.get(['quickHotkeys'], (v) => r(JSON.stringify(v.quickHotkeys === undefined ? 'unset' : v.quickHotkeys))))`));
    await E(`(async () => { await new Promise((r) => chrome.storage.local.remove(['quickHotkeys', 'quickCapture'], r)); document.getElementById('quick-more').open = false;
      await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: false, sck: true, screen: false, loginItem: 'off', appName: 'X' }); return 'ok'; })()`);
    await sleep(500);
    const m0 = { t: await hkRow('translate'), s: await hkRow('shot'), i: await hkRow('input') };
    need(m0.t.keys === '⌃⌥T' && m0.s.keys === '⌃⌥S' && m0.t.btns.join() === '改,清除' && m0.i.hidden === true, 'M: 默认 ⌃⌥T / ⌃⌥S；「输入翻译」那一行收在「更多选项」里、默认不露，实际 ' + JSON.stringify(m0));
    need(await E(`document.querySelectorAll('#g-quick .adv-only, #g-quick .quick-only').length`) === 0, 'M: 这一块不许跟全局的「快速 / 详细」档位（那两档只管「引擎与密钥」一节）');
    await E(`(document.querySelector('#quick-more > summary').click(), 'ok')`); await sleep(400);
    const m1 = await hkRow('input');
    need(m1.hidden === false && m1.empty && m1.btns.join() === '录制', 'M: 展开「更多选项」⇒「输入翻译」出现，空态 +「录制」，实际 ' + JSON.stringify(m1));
    // 录制中：全局快捷键放开；Esc = 取消，不是把 Esc 设成快捷键
    await clickIn('input', '录制'); await sleep(300);
    need((await hkRow('input')).live && (await hostOut('quick-hotkeys')).pop().paused === true, 'M: 录制中 ⇒ 一句「按下想用的组合…」且原生收到 paused:true');
    await key('Escape'); await sleep(300);
    need((await hkRow('input')).empty && (await stored()) === 'unset' && (await hostOut('quick-hotkeys')).pop().paused === false, 'M: Esc ⇒ 取消、什么都没存、全局快捷键恢复');
    // 被拒绝的组合不保存，并说怎么改
    await clickIn('input', '录制'); await key('KeyD', { altKey: true }); await sleep(300);
    const m2 = await hkRow('input');
    need(m2.empty && /带 ⌃ 或 ⌘/.test(m2.why) && (await stored()) === 'unset', 'M: 只有 ⌥ 的组合 ⇒ 不保存 + 说怎么改，实际 ' + JSON.stringify(m2));
    await clickIn('input', '录制'); await key('KeyS', { ctrlKey: true, altKey: true }); await sleep(300);
    need(/「截图翻译」/.test((await hkRow('input')).why) && (await stored()) === 'unset', 'M: 和另一个功能撞了 ⇒ 不保存 + 说出是哪一个');
    await clickIn('input', '录制'); await key('ControlLeft', { ctrlKey: true }); await sleep(150);
    need((await hkRow('input')).live, 'M: 只按了修饰键 ⇒ 继续等');
    await key('KeyI', { ctrlKey: true, altKey: true }); await sleep(400);
    const m3 = await hkRow('input');
    need(m3.keys === '⌃⌥I' && m3.why === '' && JSON.stringify(await stored()) === JSON.stringify({ input: { code: 'KeyI', modifiers: 6144 } }), 'M: 合法组合 ⇒ 已设 + 落盘只有 {code, modifiers}，实际 ' + JSON.stringify([m3, await stored()]));
    need(JSON.stringify((await hostOut('quick-hotkeys')).pop().input) === JSON.stringify({ keyCode: 34, modifiers: 6144, char: 'i' }), 'M: 新的一组推给了原生（键码 34 = I）');
    // 原生回报「别的 App 占了」⇒ 已设 + 一句冲突
    await E(`(AppQuickHost._fromNative({ type: 'quick-hotkeys-result', failed: ['shot'] }), 'ok')`); await sleep(300);
    const m4 = await hkRow('shot');
    need(m4.keys === '⌃⌥S' && /别的 App 已经占了/.test(m4.why), 'M: 原生没注册上 ⇒ 这一行说冲突（值留着，由用户决定改不改），实际 ' + JSON.stringify(m4));
    await surf2('快捷键 · 已设 / 冲突');
    await E(`(AppQuickHost._fromNative({ type: 'quick-hotkeys-result', failed: [] }), 'ok')`);
    // 清除 ⇒ 空态并存 null；恢复默认 ⇒ 三个回到默认
    await clickIn('translate', '清除'); await sleep(400);
    need((await hkRow('translate')).empty && (await stored()).translate === null && (await hostOut('quick-hotkeys')).pop().translate === null, 'M: 清除 ⇒ 空态、存 null、原生收到 null');
    await E(`(document.getElementById('quick-hotkeys-reset').click(), 'ok')`); await sleep(500);
    need((await hkRow('translate')).keys === '⌃⌥T' && (await hkRow('input')).empty && (await stored()) === 'unset', 'M: 恢复默认 ⇒ ⌃⌥T 回来、输入翻译回到空');
    // 存入复习库 / 屏幕录制状态 / 登录时启动 / 服务菜单直达
    await E(`(document.getElementById('quick-capture').click(), 'ok')`); await sleep(300);
    need(await E(`new Promise((r) => chrome.storage.local.get(['quickCapture'], (v) => r(v.quickCapture)))`) === false, 'M: 「存入复习库」默认开，拨掉 ⇒ quickCapture:false');
    const m5 = JSON.parse(await E(`JSON.stringify({ screen: document.getElementById('quick-screen-state').textContent, go: !document.getElementById('quick-screen-privacy').hidden,
      loginRow: !document.getElementById('quick-login-row').hidden, login: document.getElementById('quick-login').checked })`));
    need(/还没有允许/.test(m5.screen) && m5.go && m5.loginRow && m5.login === false, 'M: 录屏未允许 ⇒ 一句话 + 出口；登录时启动默认关，实际 ' + JSON.stringify(m5));
    await E(`(document.getElementById('quick-login').click(), document.getElementById('quick-services-go').click(), document.getElementById('quick-screen-privacy').click(), 'ok')`);
    need((await hostOut('quick-login-item')).pop().on === true && (await hostOut('quick-open-privacy')).slice(-2).map((x) => x.which).join() === 'services,screen', 'M: 登录项与两个直达各交给原生一条');
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: false, sck: true, screen: true, loginItem: 'approval', appName: 'X' }); return 'ok'; })()`); await sleep(400);
    const m6 = JSON.parse(await E(`JSON.stringify({ screen: document.getElementById('quick-screen-state').textContent, go: !document.getElementById('quick-screen-privacy').hidden, login: document.getElementById('quick-login').checked,
      ap: !document.getElementById('quick-login-approval').hidden })`));
    need(/已允许/.test(m6.screen) && !m6.go && m6.login && m6.ap, 'M: 界面跟着原生的回执走：录屏已允许 ✓；登录项要去系统设置批准一次，实际 ' + JSON.stringify(m6));
    await surf2('快速翻译块 · 更多选项展开');
    // macOS 低于 14：截图那一行整个不出现，一句原因
    await E(`(async () => { await AppQuickHost._fromNative({ type: 'quick-caps', resident: true, panel: true, postEvent: false, sck: false, screen: false, loginItem: 'unsupported', appName: 'X' }); return 'ok'; })()`); await sleep(400);
    need((await hkRow('shot')) === null && /需要 macOS 14/.test(await E(`document.getElementById('quick-screen-state').textContent`)) && await E(`document.getElementById('quick-login-row').hidden`), 'M: macOS 低于 14 ⇒ 截图的快捷键行不出现 + 一句原因；登录项不支持 ⇒ 那一行不出现');
  } catch (e) { problems.push('脚本中断：' + (e && e.message || e)); }
  finally { try { cdp && cdp.close(); } catch (_) {} chrome.cleanup(); srv.close(); }

  if (problems.length) { console.log('\n✗ 快速翻译面板页有问题：\n  - ' + problems.join('\n  - ')); process.exit(1); }
  console.log('\n✓ 快速翻译面板页：#quick 只起面板、译文上屏、三个陷阱 0 请求、取消 / 逐段 / 截图 / 输入 / 失败两态 / 写回「译成」/ 采集关 / 未配置 全部读回；三态 × 深浅两色对比度 ≥ 4.5:1；主页面中继：进复习库过门、遥测代发；增强取词：说明先到、等重开、重开后生效、被撤销弹回；截图：权限先说话、识别中、点了才发图；设置块：快捷键五态、录制时放开、清除 / 恢复默认、登录项与录屏状态跟着回执走');
  process.exit(0);
}
main();
