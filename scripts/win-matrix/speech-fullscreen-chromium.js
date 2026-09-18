'use strict';
// speech-fullscreen-chromium.js <host> <port> <label> [--tts-only]
// Chrome / Edge 行的两张分面表：speechSynthesis 真播放（Chrome 系没用户激活会静默丢 speak() ⇒ 先发一次 CDP 真点击）
// + YouTube 带真字幕的全屏（叠层在 document.fullscreenElement 里、可见、译文逐句前进、退出后还在）。
// 前提：扩展已装（同一次浏览器会话里先跑过 chromium.js，<label>.json 里有 extId）。
const http = require('http'), fs = require('fs'), path = require('path');
const [host, port, label] = process.argv.slice(2);
const OUT = path.join(__dirname, '..', '..', '.local', 'win'); fs.mkdirSync(OUT, { recursive: true }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { label: label + '-more', when: new Date().toISOString(), notes: [], problems: [] };
const step = (m) => { process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`); log.notes.push(m); };
function httpJson(p) { return new Promise((res, rej) => http.get({ host, port, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('bad json')); } }); }).on('error', rej)); }
class CDP { constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error('CDP ' + m.error.message)) : resolve(m.result); } else if (m.method) for (const l of this.listeners) if (l.event === m.method) l.fn(m.params, m.sessionId); }); }
  send(method, params = {}, sessionId) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000); }); }
  on(event, fn) { const l = { event, fn }; this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; } }
async function evalIn(cdp, sid, expression, contextId) { const r = await cdp.send('Runtime.evaluate', Object.assign({ expression, returnByValue: true, awaitPromise: true }, contextId ? { contextId } : {}), sid); if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text)); return r.result ? r.result.value : undefined; }
setTimeout(() => { step('WATCHDOG'); fs.writeFileSync(path.join(OUT, `${label}-more.json`), JSON.stringify({ ...log, fatal: 'watchdog' }, null, 2)); process.exit(2); }, 230000).unref();
(async () => {
  const ver = await httpJson('/json/version'); log.browser = ver.Browser;
  const ws = new WebSocket(ver.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${host}:${port}`)); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws failed')), { once: true }); });
  const cdp = new CDP(ws);
  let extId = null; for (let i = 0; i < 20 && !extId; i++) { const { targetInfos } = await cdp.send('Target.getTargets'); const t = targetInfos.find((t) => t.type === 'service_worker' && /^chrome-extension:\/\//.test(t.url) && /background\.js$/.test(t.url)); if (t) extId = t.url.split('/')[2]; else await sleep(500); }
  // MV3 的 worker 空闲 30 s 就退出，找不到就用 chromium.js 记下的 id（同一次浏览器会话里 id 不变）
  if (!extId) { try { extId = JSON.parse(fs.readFileSync(path.join(OUT, `${label}.json`), 'utf8')).extId; } catch (_) {} }
  if (!extId) throw new Error('没找到扩展 —— 先跑 chromium.js 装扩展'); log.extId = extId; step('扩展 ' + extId);
  const click = async (sid, x, y) => { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sid); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sid); };
  const clickSel = async (sid, sel, ctx) => { const r = await evalIn(sid ? cdp : cdp, sid, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null; return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`, ctx); if (!r) return false; const { x, y } = JSON.parse(r); await click(sid, x, y); return true; };
  // ── 语音：设置页，先真点一下拿用户激活，再 speak
  { const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options/options.html` }, sessionId); await sleep(2500);
    await click(sessionId, 200, 200); await sleep(300);
    for (const [lang, text] of [['zh-CN', '你好，这是 Windows 上的试听。'], ['en-US', 'This is what your review cards will sound like.']]) {
      const r = await evalIn(cdp, sessionId, `new Promise((res) => { const vs = speechSynthesis.getVoices(); const v = vs.find(x => x.lang.replace('_','-').toLowerCase().startsWith(${JSON.stringify(lang.toLowerCase().slice(0, 2))})); const u = new SpeechSynthesisUtterance(${JSON.stringify(text)}); if (v) u.voice = v; u.lang = ${JSON.stringify(lang)}; const t0 = performance.now(); const out = { voice: v ? v.name : null, local: v ? v.localService : null, start: null, end: null, error: null }; u.onstart = () => { out.start = Math.round(performance.now() - t0); }; u.onend = () => { out.end = Math.round(performance.now() - t0); res(JSON.stringify(out)); }; u.onerror = (e) => { out.error = e.error; res(JSON.stringify(out)); }; speechSynthesis.cancel(); speechSynthesis.speak(u); setTimeout(() => res(JSON.stringify({ ...out, timeout: true, speaking: speechSynthesis.speaking, pending: speechSynthesis.pending })), 30000); })`);
      log['tts_' + lang] = JSON.parse(r); step(`tts ${lang}: ${r}`);
    }
    await cdp.send('Target.closeTarget', { targetId }); }
  if (process.argv.includes('--tts-only')) { fs.writeFileSync(path.join(OUT, `${label}-more.json`), JSON.stringify(log, null, 2)); console.log(JSON.stringify(log, null, 1)); ws.close(); return; }
  // ── YouTube 全屏机制（叠层进不进全屏元素；字幕本身在虚拟机上拿不到，见 §2.H）
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }); const { sessionId: yt } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const iso = new Set(); cdp.on('Runtime.executionContextCreated', (p, sid) => { if (sid === yt && p.context.auxData && p.context.auxData.type === 'isolated') iso.add(p.context.id); });
  await cdp.send('Page.enable', {}, yt); await cdp.send('Runtime.enable', {}, yt);
  try {
    for (let k = 0; k < 3; k++) { try { await cdp.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=aircAruvnKk' }, yt); break; } catch (e) { step('navigate 重试: ' + e.message); } } await sleep(7000); step('youtube 已导航');
    const state = async () => JSON.parse(await evalIn(cdp, yt, "(() => { const v = document.querySelector('video'); const tr = document.querySelector('.mt-yt-trans'); const fe = document.fullscreenElement; const o = document.getElementById('mt-yt-overlay'); const rc = o ? o.getBoundingClientRect() : null; return JSON.stringify({ t: v ? Math.round(v.currentTime) : null, paused: v ? v.paused : null, overlay: !!o, trans: tr ? tr.textContent.trim().slice(0, 50) : null, fullscreen: !!fe, overlayInside: !!(fe && o && fe.contains(o)), visible: !!(rc && rc.width > 0 && rc.height > 0 && rc.bottom <= innerHeight + 1), title: document.title.slice(0, 30) }); })()"));
    const ensurePlaying = async () => { for (let i = 0; i < 4; i++) { const st = await state(); if (st.paused === false) return st; await clickSel(yt, '.ytp-play-button'); await sleep(2000); } return await state(); };
    step('播放 ' + JSON.stringify(await ensurePlaying()));
    let ytBtn = false; for (let i = 0; i < 20 && !ytBtn; i++) { ytBtn = await evalIn(cdp, yt, "(() => { const b = document.getElementById('mt-yt-btn'); if (!b) return false; b.click(); return true; })()"); if (!ytBtn) await sleep(1000); }
    await sleep(600); const rowTxt = await evalIn(cdp, yt, "(() => { const r = document.querySelector('#mt-yt-menu > div'); if (!r) return null; const t = r.textContent.trim(); r.click(); return t; })()");
    step('译按钮 ' + (ytBtn ? '已点' : '没出现') + '，菜单第一行 ' + JSON.stringify(rowTxt)); log.ytBtn = ytBtn; log.ytMenuRow = rowTxt;
    // 等真字幕：不是「字幕加载中」「字幕不可用」「准备中」
    const isReal = (x) => x && x.trans && !/加载中|不可用|转写引擎|准备中/.test(x.trans);
    let st = null; const t0w = Date.now(); const seen = [];
    for (let i = 0; i < 120; i++) { st = await state(); if (st.trans && seen[seen.length - 1] !== st.trans) seen.push(st.trans); if (i % 10 === 0) step('yt ' + JSON.stringify(st)); if (isReal(st)) break; if (await clickSel(yt, '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button')) step('点了「跳过广告」'); if (st.paused && i % 5 === 4) await ensurePlaying(); await sleep(1000); }
    log.ytBefore = st; log.subtitleWaitMs = Date.now() - t0w; log.subtitleSeen = seen.slice(0, 8); step('叠层 ' + JSON.stringify(st));
    if (!isReal(st)) log.problems.push('120 s 内没出现真字幕（最后：' + (st.trans || '无') + '）');
    else {
      await ensurePlaying();
      // 控制条会自动隐藏：先把鼠标移到播放器上让它露出来，再点全屏键；没进就退回按 f
      const hov = JSON.parse(await evalIn(cdp, yt, "(() => { const v = document.querySelector('video'); const b = v.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()"));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hov.x, y: hov.y }, yt); await sleep(300); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hov.x + 5, y: hov.y + 5 }, yt); await sleep(600);
      await clickSel(yt, '.ytp-fullscreen-button'); await sleep(2500);
      let fs1 = await state();
      if (!fs1.fullscreen) { step('全屏键没进，改按 f'); await click(yt, hov.x, hov.y); await sleep(300); for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'f', code: 'KeyF', text: type === 'keyDown' ? 'f' : undefined, windowsVirtualKeyCode: 70 }, yt); await sleep(2500); fs1 = await state(); } await ensurePlaying(); await sleep(8000); const fs2 = await state();
      try { const shot = await cdp.send('Page.captureScreenshot', {}, yt); fs.writeFileSync(path.join(OUT, `${label}-yt-fullscreen.png`), Buffer.from(shot.data, 'base64')); } catch (_) {}
      // CDP 发的 Esc 只到页面，浏览器级的「退出全屏」不吃（09-18 实测）⇒ 走 DOM API 退出，再看叠层还在不在
      await evalIn(cdp, yt, 'document.exitFullscreen().then(() => true, () => false)'); await sleep(2000);
      const fs3 = await state(); log.ytFullscreen = { enter: fs1, later: fs2, exit: fs3 };
      if (!fs1.fullscreen) log.problems.push('点全屏按钮没进全屏'); else if (!fs1.overlayInside) log.problems.push('全屏后叠层不在全屏元素里'); else if (!fs1.visible) log.problems.push('全屏后叠层不可见'); else if (fs2.t === fs1.t) log.problems.push('全屏里视频没在走');
      if (fs3.fullscreen) log.problems.push('exitFullscreen() 之后仍在全屏'); else if (!fs3.overlay) log.problems.push('退出全屏后叠层没了');
    }
  } catch (e) { log.problems.push('YouTube: ' + e.message.slice(0, 200)); }
  try { await cdp.send('Target.closeTarget', { targetId }); } catch (_) {}
  fs.writeFileSync(path.join(OUT, `${label}-more.json`), JSON.stringify(log, null, 2)); console.log(JSON.stringify(log, null, 1)); ws.close();
})().catch((e) => { console.error('FAILED', e.message); fs.writeFileSync(path.join(OUT, `${label}-more.json`), JSON.stringify({ ...log, fatal: e.message }, null, 2)); process.exit(1); });
