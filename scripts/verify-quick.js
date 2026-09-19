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

const stats = { calls: [], mode: 'ok', delayMs: 0, other: [] };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/v1/chat/completions') {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(); return; }
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let user = '', sys = '';
        try { const j = JSON.parse(body); user = (j.messages.find((x) => x.role === 'user') || {}).content || ''; sys = (j.messages.find((x) => x.role === 'system') || {}).content || ''; } catch (_) {}
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
    need(/没有认出/.test(f3.msg) && f3.acts.join() === '重新框选', 'F: 零产出 ⇒ 一句话 +「重新框选」，实际 ' + JSON.stringify(f3));
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
  } catch (e) { problems.push('脚本中断：' + (e && e.message || e)); }
  finally { try { cdp && cdp.close(); } catch (_) {} chrome.cleanup(); srv.close(); }

  if (problems.length) { console.log('\n✗ 快速翻译面板页有问题：\n  - ' + problems.join('\n  - ')); process.exit(1); }
  console.log('\n✓ 快速翻译面板页：#quick 只起面板、译文上屏、三个陷阱 0 请求、取消 / 逐段 / 截图 / 输入 / 失败两态 / 写回「译成」/ 采集关 / 未配置 全部读回；三态 × 深浅两色对比度 ≥ 4.5:1；主页面中继：进复习库过门、遥测代发');
  process.exit(0);
}
main();
