'use strict';
// win-ff.js <host> <port> <windows dist-firefox path> —— Firefox 行：WebDriver BiDi 装临时扩展、翻一页、回读。
const fs = require('fs'), path = require('path');
const [host, port, DIST] = process.argv.slice(2);
const ROOT = path.join(__dirname, '..', '..'); const OUT = path.join(ROOT, '.local', 'win'); fs.mkdirSync(OUT, { recursive: true });
const keys = {}; for (const l of fs.readFileSync(path.join(ROOT, '.local/keys.md'), 'utf8').split('\n')) { const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l); if (m && m[2].trim()) keys[m[1]] = m[2].trim(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rawWs(host, port, pathname, hostHeader) {
  const net = require('net'), crypto = require('crypto');
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host);
    const key = crypto.randomBytes(16).toString('base64');
    const listeners = { message: [], error: [], close: [] };
    const api = { addEventListener: (ev, fn) => listeners[ev].push(fn), send: (text) => sock.write(frame(text)), close: () => sock.end() };
    let buf = Buffer.alloc(0), upgraded = false;
    sock.on('error', (e) => { if (!upgraded) reject(e); else listeners.error.forEach((f) => f(e)); });
    sock.on('connect', () => sock.write(`GET ${pathname} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; const head = buf.slice(0, i).toString(); buf = buf.slice(i + 4); if (!/^HTTP\/1\.1 101/.test(head)) { reject(new Error('handshake: ' + head.split('\r\n')[0])); sock.destroy(); return; } upgraded = true; resolve(api); }
      for (;;) {
        if (buf.length < 2) return; const fin = buf[0] & 0x80, op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return; const payload = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (op === 8) { listeners.close.forEach((f) => f()); sock.end(); return; }
        if (op === 9) { sock.write(frame(payload, 0xA)); continue; }
        if (op === 1 || op === 0) { api._frag = (api._frag || '') + payload.toString('utf8'); if (fin) { const data = api._frag; api._frag = ''; listeners.message.forEach((f) => f({ data })); } }
      }
    });
    function frame(data, op = 1) { const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'); const mask = crypto.randomBytes(4); const n = payload.length; const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.concat([Buffer.from([0x80 | op, 0x80 | 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; })()]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]); const masked = Buffer.alloc(n); for (let i = 0; i < n; i++) masked[i] = payload[i] ^ mask[i & 3]; return Buffer.concat([head, mask, masked]); }
  });
}

const log = { label: 'firefox', host, when: new Date().toISOString(), problems: [], notes: [] };
const step = (m) => { process.stderr.write(`[${new Date().toISOString().slice(11,19)}] ${m}\n`); log.notes.push(m); };
let bye = async () => {};
setTimeout(async () => { process.stderr.write('WATCHDOG 240s\n'); fs.writeFileSync(path.join(OUT, 'firefox.json'), JSON.stringify({ ...log, fatal: 'watchdog' }, null, 2)); await bye(); process.exit(2); }, 240000).unref();
(async () => {
  // Firefox 的远程代理只认 Host 为回环地址的握手（09-18 实测：Host 127.0.0.1:9222 → 101，其余全 400），
  // Node 自带的 WebSocket 不让改 Host，所以这里手写最小 RFC 6455 客户端。
  // 上一次被杀掉的进程留下的会话要等 portproxy 那半边断开 Firefox 才释放（09-18 撞到「Maximum number of active sessions」）：重连重试。
  let ws, send, sess;
  for (let attempt = 1; ; attempt++) {
    step(`ws 握手（第 ${attempt} 次）…`); ws = await rawWs(host, port, '/session', '127.0.0.1:9222');
    let id = 0; const P = new Map(); const events = []; const w = ws;
    w.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { const { resolve, reject } = P.get(m.id); P.delete(m.id); m.type === 'error' ? reject(new Error(`BiDi ${m.error}: ${m.message}`)) : resolve(m.result); } else if (m.type === 'event') events.push(m); });
    send = (method, params = {}) => new Promise((resolve, reject) => { P.set(++id, { resolve, reject }); w.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (P.has(id)) { P.delete(id); reject(new Error('timeout ' + method)); } }, 30000); });
    try { sess = await send('session.new', { capabilities: {} }); step('session 已建'); const w2 = ws, s2 = send; bye = async () => { try { await Promise.race([s2('session.end', {}), sleep(3000)]); } catch (_) {} try { w2.close(); } catch (_) {} }; break; }
    catch (e) { if (attempt >= 12 || !/Maximum number of active sessions/.test(e.message)) throw e; step('会话被占，5 秒后重试: ' + e.message.slice(0, 60)); ws.close(); await sleep(5000); }
  } log.browser = `${sess.capabilities.browserName} ${sess.capabilities.browserVersion}`; log.platform = sess.capabilities.platformName;
  step('install…'); const inst = await send('webExtension.install', { extensionData: { type: 'path', path: DIST } }); log.addonId = inst.extension; log.notes.push('webExtension.install 成功 ' + inst.extension);
  const evalIn = async (context, expression) => { const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' }); if (r.type === 'exception') throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails)); return r.result; };
  const val = (r) => r && (r.type === 'string' || r.type === 'number' || r.type === 'boolean') ? r.value : r && r.type === 'array' ? r.value.map(val) : r && r.type === 'object' ? Object.fromEntries(r.value.map(([k, v]) => [typeof k === 'string' ? k : k.value, val(v)])) : r && r.type === 'null' ? null : r;
  // 内部 UUID：about:debugging 上有；BiDi 不让评估特权页时退回读 prefs.js
  const { context: c0 } = await send('browsingContext.create', { type: 'tab' });
  let uuid = null;
  try { await send('browsingContext.navigate', { context: c0, url: 'about:debugging#/runtime/this-firefox', wait: 'complete' }); await sleep(2500);
    const txt = val(await evalIn(c0, 'document.body.innerText')); const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(txt); if (m) uuid = m[1]; log.notes.push('about:debugging 可读，uuid ' + (uuid ? '拿到' : '没匹配到'));
  } catch (e) { log.notes.push('about:debugging 不可评估: ' + e.message.slice(0, 100)); }
  if (!uuid) {
    // about:debugging 被 BiDi 拒绝（09-18 实测「Navigation … is not allowed」）：改读临时配置目录的 prefs.js
    // 临时配置目录跟着 -profile $env:TEMP\mt-ff 走；用户目录从 dist 路径推（C:\Users\<user>\…）。
    const userDir = (/^([A-Za-z]:\\Users\\[^\\]+)/.exec(DIST) || [])[1];
    const PREFS = process.argv[5] || ('file:///' + (userDir || 'C:\\Users\\<user>').replace(/\\/g, '/') + '/AppData/Local/Temp/mt-ff/prefs.js');
    try { await send('browsingContext.navigate', { context: c0, url: PREFS, wait: 'complete' }); await sleep(800);
      const txt = val(await evalIn(c0, 'document.body.innerText'));
      const m = /"extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"/.exec(txt);
      if (m) { const map = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')); uuid = map[inst.extension] || null; }
      log.notes.push('prefs.js ' + (m ? '有 uuids 表，' + (uuid ? '拿到 uuid' : '但没有本扩展的条目') : '还没写入 uuids（' + txt.length + ' 字符）'));
    } catch (e) { log.notes.push('prefs.js 不可读: ' + e.message.slice(0, 120)); }
  }
  if (uuid) {
    // BiDi 不让导航到 moz-extension://（09-18 实测「not allowed in this context」）；但扩展首次装上会自己开引导页，
    // 那个上下文已经存在，在里面执行脚本是允许的 —— 种配置、读语音都走它。
    let extCtx = null;
    for (let i = 0; i < 20 && !extCtx; i++) {
      const { contexts } = await send('browsingContext.getTree', {});
      const flat = []; const walk = (cs) => cs.forEach((c) => { flat.push(c); walk(c.children || []); }); walk(contexts);
      const mine = flat.filter((c) => (c.url || '').startsWith(`moz-extension://${uuid}/`)); const hit = mine.find((c) => /options\.html/.test(c.url)) || mine[0]; if (hit) { extCtx = hit.context; try { await send('browsingContext.activate', { context: extCtx }); } catch (_) {} await sleep(1500); } else await sleep(500);
    }
    if (!extCtx) {
      // 重装会关掉扩展自己的页面，引导页也只在首装出现。options.html 对 <all_urls> 是 web_accessible，
      // 所以让一个普通网页自己导航过去（页面发起的导航不受 BiDi 的 moz-extension 禁令约束）。
      try {
        await send('browsingContext.navigate', { context: c0, url: 'http://192.168.2.1:8765/page.html', wait: 'complete' });
        await evalIn(c0, `location.href = 'moz-extension://${uuid}/options/options.html'; true`); await sleep(3000);
        const { contexts } = await send('browsingContext.getTree', {}); const me = contexts.find((c) => c.context === c0);
        if (me && me.url.startsWith(`moz-extension://${uuid}/`)) { extCtx = c0; step('网页自导航到设置页成功'); } else step('自导航后 c0 仍是 ' + (me && me.url));
      } catch (e) { step('自导航失败: ' + e.message.slice(0, 120)); }
    }
    if (!extCtx) log.problems.push('扩展没有开着的页面，种不进配置');
    else try {
      step('在扩展页里执行…');
      log.extPage = val(await evalIn(extCtx, 'location.pathname'));
      log.optionsText = val(await evalIn(extCtx, 'document.body.innerText.trim().length'));
      log.voices = val(await evalIn(extCtx, `new Promise(r => { const go = () => { const v = speechSynthesis.getVoices(); if (v.length) r(v.map(x => x.name + ' | ' + x.lang + ' | ' + x.localService)); }; go(); speechSynthesis.onvoiceschanged = go; setTimeout(() => r(speechSynthesis.getVoices().map(x => x.name + ' | ' + x.lang + ' | ' + x.localService)), 4000); })`));
      await evalIn(extCtx, `browser.storage.local.set(${JSON.stringify({ provider: 'deepseek', apiKey: keys.apiKey, targetLang: 'zh-CN', enabled: true, showFab: true })}).then(() => true)`); step('storage 已种 deepseek（经扩展页）');
      const shot = await send('browsingContext.captureScreenshot', { context: extCtx }); fs.writeFileSync(path.join(OUT, 'firefox-extpage.png'), Buffer.from(shot.data, 'base64'));
    } catch (e) { log.problems.push('扩展页执行失败: ' + e.message.slice(0, 160)); }
  } else log.problems.push('拿不到扩展内部 UUID，没能种 DeepSeek 配置');
  // 网页
  const { context: c1 } = await send('browsingContext.create', { type: 'tab' });
  await send('browsingContext.navigate', { context: c1, url: 'http://192.168.2.1:8765/page.html', wait: 'complete' }); await sleep(2500);
  log.fab = val(await evalIn(c1, "(() => { const f = document.querySelector('#mt-fab'); return f ? f.title + ' @' + Math.round(f.getBoundingClientRect().x) + ',' + Math.round(f.getBoundingClientRect().y) : null; })()"));
  if (!log.fab) log.problems.push('#mt-fab 缺席');
  log.scrollbarPx = val(await evalIn(c1, 'window.innerWidth - document.documentElement.clientWidth'));
  await evalIn(c1, "document.querySelector('#mt-fab') && document.querySelector('#mt-fab').click(); true");
  step('点 FAB，等译文…'); const t0 = Date.now(); let got = [];
  for (let i = 0; i < 120; i++) { got = val(await evalIn(c1, "Array.from(document.querySelectorAll('.mt-translation')).map(n => n.innerText)")); if (got.length >= 3 && got.every((t) => /\p{Script=Han}/u.test(t) && !/翻译中/.test(t))) break; await sleep(500); }
  log.translations = got; log.translateMs = Date.now() - t0;
  if (!(got.length >= 3 && got.every((t) => /\p{Script=Han}/u.test(t) && !/翻译中/.test(t)))) log.problems.push('页面上没有出现中文译文（或仍是占位符）');
  log.transFont = val(await evalIn(c1, "(() => { const t = document.querySelector('.mt-translation'); return t ? getComputedStyle(t).fontFamily : null; })()"));
  const shot = await send('browsingContext.captureScreenshot', { context: c1 }); fs.writeFileSync(path.join(OUT, 'firefox-page.png'), Buffer.from(shot.data, 'base64'));
  fs.writeFileSync(path.join(OUT, 'firefox.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log, voices: (log.voices || []).length + ' voices' }, null, 1));
  await send('session.end', {}); ws.close();
})().catch(async (e) => { console.error('FAILED', e.message); fs.writeFileSync(path.join(OUT, 'firefox.json'), JSON.stringify({ ...log, fatal: e.message }, null, 2)); await bye(); process.exit(1); });
process.on('SIGTERM', async () => { await bye(); process.exit(143); });
