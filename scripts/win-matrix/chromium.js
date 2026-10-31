'use strict';
// win-run.js <host> <port> <windows dist path> <label>
// 验收矩阵第 8 行首跑：从 Mac 经 CDP 驱动虚拟机里的 Chrome/Edge，装 dist、种 DeepSeek、翻一页、回读。
const http = require('http'), fs = require('fs'), path = require('path');
const [host, port, DIST, label] = process.argv.slice(2);
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.local', 'win'); fs.mkdirSync(OUT, { recursive: true });
// 测试页由 Mac 上的 http.server 提供；地址随 Mac 在哪个网段变（虚拟机 vmnet8 是 192.168.2.1，局域网台式机是 Mac 的 LAN 地址）。
const PAGE = process.env.MT_WIN_PAGE || 'http://192.168.2.1:8765/page.html';
const keys = {}; for (const l of fs.readFileSync(path.join(ROOT, '.local/keys.md'), 'utf8').split('\n')) { const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l); if (m && m[2].trim()) keys[m[1]] = m[2].trim(); }
if (!keys.apiKey || keys.provider !== 'deepseek') throw new Error('keys.md 里翻译引擎不是 deepseek 或没 key');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpJson(p) { return new Promise((res, rej) => http.get({ host, port, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('bad json: ' + d.slice(0, 100))); } }); }).on('error', rej)); }
class CDP { constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error('CDP ' + m.error.message)) : resolve(m.result); } else if (m.method) for (const l of this.listeners) if (l.event === m.method) l.fn(m.params, m.sessionId); }); }
  send(method, params = {}, sessionId) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000); }); }
  on(event, fn) { const l = { event, fn }; this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; } }
async function evalIn(cdp, sid, expression, contextId) { const r = await cdp.send('Runtime.evaluate', Object.assign({ expression, returnByValue: true, awaitPromise: true }, contextId ? { contextId } : {}), sid); if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text)); return r.result ? r.result.value : undefined; }
(async () => {
  const log = { label, host, when: new Date().toISOString(), problems: [], notes: [] };
  const ver = await httpJson('/json/version'); log.browser = ver.Browser; log.ua = ver['User-Agent'];
  const wsUrl = ver.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${host}:${port}`);
  const ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', (e) => rej(new Error('ws failed ' + (e.message || ''))), { once: true }); });
  const cdp = new CDP(ws);
  let extId = null;
  try { const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST }); extId = loaded.id; log.notes.push('经 Extensions.loadUnpacked 装入'); }
  catch (e) {
    // Edge 145 回「Method not available」（09-18 实测）：退回到 --load-extension 预装，这里只找它。
    log.notes.push('loadUnpacked 不可用：' + e.message + ' —— 改找 --load-extension 装入的扩展');
    for (let i = 0; i < 40 && !extId; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const t = targetInfos.find((t) => t.type === 'service_worker' && /^(chrome-)?extension:\/\//.test(t.url || '') && /background\.js$/.test(t.url));
      if (t) extId = t.url.split('/')[2]; else await sleep(250);
    }
    if (!extId) throw new Error('浏览器里没有找到扩展的 service worker —— --load-extension 没装上？');
  }
  log.extId = extId;
  // 重复 loadUnpacked 会重载扩展：刚匹配到的 SW 可能正在退场（09-18 撞到 "chrome is not defined"），每次重新找、失败重试。
  let seeded = false; let swSession = null; const net = [];
  cdp.on('Network.requestWillBeSent', (p, sid) => { if (!/192\.168\.2\.1:8765|chrome-extension/.test(p.request.url)) net.push(`${Date.now()} ${sid === swSession ? 'SW' : 'PG'} → ${p.request.url}`); });
  cdp.on('Network.responseReceived', (p, sid) => { if (!/192\.168\.2\.1:8765|chrome-extension/.test(p.response.url)) net.push(`${Date.now()} ${sid === swSession ? 'SW' : 'PG'} ← ${p.response.status} ${p.response.url}`); });
  cdp.on('Network.loadingFailed', (p, sid) => net.push(`${Date.now()} ${sid === swSession ? 'SW' : 'PG'} ✗ ${p.errorText} ${p.blockedReason || ''}`));
  for (let attempt = 0; attempt < 6 && !seeded; attempt++) {
    await sleep(800);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const t = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
    if (!t) continue;
    try {
      const { sessionId: sw } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      swSession = sw; await cdp.send('Network.enable', {}, sw);
      log.version = await evalIn(cdp, sw, 'chrome.runtime.getManifest().version');
      await evalIn(cdp, sw, `new Promise(r => chrome.storage.local.set(${JSON.stringify({ provider: 'deepseek', apiKey: keys.apiKey, targetLang: 'zh-CN', enabled: true, showFab: true })}, () => r(1)))`);
      seeded = true; log.notes.push(`storage 已种 deepseek（第 ${attempt + 1} 次）`);
    } catch (e) { log.notes.push(`SW 第 ${attempt + 1} 次: ${e.message.slice(0, 80)}`); }
  }
  if (!seeded) log.problems.push('service worker 未启动 / 种不进配置');
  // 扩展页：设置页渲染 + 语音清单（Windows 专属读数）
  { const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }); const errs = [];
    cdp.on('Runtime.exceptionThrown', (ev, sid) => { if (sid === sessionId) errs.push((ev.exceptionDetails.exception || {}).description || ev.exceptionDetails.text); });
    await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options/options.html` }, sessionId); await sleep(2500);
    log.optionsText = await evalIn(cdp, sessionId, 'document.body.innerText.trim().length');
    log.voices = JSON.parse(await evalIn(cdp, sessionId, `new Promise(r => { const go = () => { const v = speechSynthesis.getVoices(); if (v.length) r(JSON.stringify(v.map(x => [x.name, x.lang, x.localService]))); }; go(); speechSynthesis.onvoiceschanged = go; setTimeout(() => r(JSON.stringify(speechSynthesis.getVoices().map(x => [x.name, x.lang, x.localService]))), 4000); })`));
    log.optionsErrors = errs; await cdp.send('Page.captureScreenshot', {}, sessionId).then((r) => fs.writeFileSync(path.join(OUT, `${label}-options.png`), Buffer.from(r.data, 'base64')));
    await cdp.send('Target.closeTarget', { targetId }); }
  // 网页：FAB + 译文
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const iso = new Set(); cdp.on('Runtime.executionContextCreated', (p, sid) => { if (sid === sessionId && p.context.auxData && p.context.auxData.type === 'isolated') iso.add(p.context.id); });
  await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url: PAGE }, sessionId);
  let ctx = null; for (let i = 0; i < 80 && !ctx; i++) { for (const id of [...iso].reverse()) { try { if (await evalIn(cdp, sessionId, "typeof WebpageTranslator === 'object'", id)) { ctx = id; break; } } catch (_) {} } if (!ctx) await sleep(150); }
  if (!ctx) log.problems.push('内容脚本未就绪'); else {
    await sleep(1500);
    log.fab = await evalIn(cdp, sessionId, "(() => { const f = document.querySelector('#mt-fab'); return f ? { title: f.title, rect: f.getBoundingClientRect().toJSON() } : null; })()", ctx);
    if (!log.fab) log.problems.push('#mt-fab 缺席');
    log.detectLanguage = await evalIn(cdp, sessionId, "typeof chrome !== 'undefined' && !!(chrome.i18n && chrome.i18n.detectLanguage)", ctx);
    log.scrollbarPx = await evalIn(cdp, sessionId, 'window.innerWidth - document.documentElement.clientWidth', ctx);
    await evalIn(cdp, sessionId, "document.querySelector('#mt-fab') && document.querySelector('#mt-fab').click(); true", ctx);
    const t0 = Date.now(); log.clickAt = t0; let got = []; for (let i = 0; i < 450; i++) { got = await evalIn(cdp, sessionId, "Array.from(document.querySelectorAll('.mt-translation')).map(n => n.innerText)", ctx); if (got.length >= 3 && got.every((t) => /\p{Script=Han}/u.test(t) && !/翻译中/.test(t))) break; await sleep(200); }
    log.translations = got; log.translateMs = Date.now() - t0; log.net = net; if (!(got.length >= 3 && got.every((t) => /\p{Script=Han}/u.test(t) && !/翻译中/.test(t)))) log.problems.push('页面上没有出现中文译文（或仍是占位符）');
    log.transFont = await evalIn(cdp, sessionId, "(() => { const t = document.querySelector('.mt-translation'); return t ? getComputedStyle(t).fontFamily : null; })()", ctx);
    await cdp.send('Page.captureScreenshot', {}, sessionId).then((r) => fs.writeFileSync(path.join(OUT, `${label}-page.png`), Buffer.from(r.data, 'base64')));
  }
  await cdp.send('Target.closeTarget', { targetId });
  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log, voices: (log.voices || []).length + ' voices', ua: undefined }, null, 1));
  ws.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
