'use strict';
// speech-fullscreen-firefox.js <host> <port> <扩展内部 uuid> [--yt-only]
// Firefox 行的两张分面表：speechSynthesis 真播放（start/end 事件）+ YouTube 全屏双语字幕。不重装扩展（重装会关掉它的页面）。
// uuid 从 firefox.js 的输出 / 临时配置目录的 prefs.js 里拿。最近一次实跑：2026-09-18 虚拟机 Firefox 156（语音 ✅、全屏机制 ✅）。
// 注意：这份脚本写于「广告会把取字幕次数耗光」（#325）查明之前，YouTube 段不点「跳过广告」—— 撞上长广告就多等。
const fs = require('fs'), path = require('path');
const [host, port, uuid] = process.argv.slice(2);
const { rawWs } = require('./lib/raw-ws.js');
const OUT = path.join(__dirname, '..', '..', '.local', 'win'); fs.mkdirSync(OUT, { recursive: true }); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { label: 'firefox-more', when: new Date().toISOString(), notes: [], problems: [] };
const step = (m) => { process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`); log.notes.push(m); };
let bye = async () => {};
process.on('SIGTERM', async () => { await bye(); process.exit(143); });
setTimeout(async () => { step('WATCHDOG'); fs.writeFileSync(path.join(OUT, 'firefox-more.json'), JSON.stringify({ ...log, fatal: 'watchdog' }, null, 2)); await bye(); process.exit(2); }, 230000).unref();
(async () => {
  const ws = await rawWs(host, port, '/session', '127.0.0.1:9222'); let id = 0; const P = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { const { resolve, reject } = P.get(m.id); P.delete(m.id); m.type === 'error' ? reject(new Error(`BiDi ${m.error}: ${m.message}`)) : resolve(m.result); } });
  let lastIn = Date.now(); ws.addEventListener('message', () => { lastIn = Date.now(); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const my = ++id; P.set(my, { resolve, reject }); ws.send(JSON.stringify({ id: my, method, params })); setTimeout(() => { if (P.has(my)) { P.delete(my); process.stderr.write(`[timeout] #${my} ${method}\n`); reject(new Error('timeout ' + method)); } }, 45000); });
  setInterval(() => process.stderr.write(`[hb] pending=${[...P.keys()].join(',')} lastIn=${((Date.now() - lastIn) / 1000).toFixed(0)}s ago\n`), 10000).unref();
  await send('session.new', { capabilities: {} }); bye = async () => { try { await Promise.race([send('session.end', {}), sleep(3000)]); } catch (_) {} try { ws.close(); } catch (_) {} }; step('session 已建');
  const evalIn = async (context, expression) => { const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' }); if (r.type === 'exception') throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails)); return r.result; };
  const val = (r) => r && (r.type === 'string' || r.type === 'number' || r.type === 'boolean') ? r.value : r && r.type === 'array' ? r.value.map(val) : r && r.type === 'object' ? Object.fromEntries(r.value.map(([k, v]) => [typeof k === 'string' ? k : k.value, val(v)])) : r && r.type === 'null' ? null : r;
  const tree = async () => { const { contexts } = await send('browsingContext.getTree', {}); const flat = []; const walk = (cs) => cs.forEach((c) => { flat.push(c); walk(c.children || []); }); walk(contexts); return flat; };
  // ── 扩展页（已开着就用，否则让网页自导航过去）
  let extCtx = (await tree()).find((c) => (c.url || '').startsWith(`moz-extension://${uuid}/options`)); extCtx = extCtx && extCtx.context;
  if (!extCtx) { const { context } = await send('browsingContext.create', { type: 'tab' }); await send('browsingContext.navigate', { context, url: 'http://192.168.2.1:8765/page.html', wait: 'complete' }); await evalIn(context, `location.href = 'moz-extension://${uuid}/options/options.html'; true`); await sleep(3000); extCtx = context; }
  step('扩展页 ' + extCtx);
  // ── 语音：按语言挑真实存在的声音，speak，等 start/end
  for (const [lang, text] of (process.argv.includes('--yt-only') ? [] : [['zh-CN', '你好，这是 Windows 上的试听。'], ['en-US', 'This is what your review cards will sound like.']])) {
    const r = val(await evalIn(extCtx, `new Promise((res) => { const vs = speechSynthesis.getVoices(); const v = vs.find(x => x.lang.replace('_','-').toLowerCase().startsWith(${JSON.stringify(lang.toLowerCase().slice(0,2))})); const u = new SpeechSynthesisUtterance(${JSON.stringify(text)}); if (v) u.voice = v; u.lang = ${JSON.stringify(lang)}; const t0 = performance.now(); const out = { voice: v ? v.name : null, start: null, end: null, error: null }; u.onstart = () => { out.start = Math.round(performance.now() - t0); }; u.onend = () => { out.end = Math.round(performance.now() - t0); res(JSON.stringify(out)); }; u.onerror = (e) => { out.error = e.error; res(JSON.stringify(out)); }; speechSynthesis.cancel(); speechSynthesis.speak(u); setTimeout(() => res(JSON.stringify({ ...out, timeout: true })), 12000); })`));
    log['tts_' + lang] = JSON.parse(r); step(`tts ${lang}: ${r}`);
  }
  // ── YouTube 全屏（登录后的 profile）
  const { context: yt } = await send('browsingContext.create', { type: 'tab' });
  try {
    await send('browsingContext.navigate', { context: yt, url: 'https://www.youtube.com/watch?v=aircAruvnKk', wait: 'none' }); await sleep(6000);
    step('youtube 已导航');
    const trustedClick = async (selector) => { const r = await send('script.evaluate', { expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: 'center' }); return el; })()`, target: { context: yt }, awaitPromise: false, resultOwnership: 'root' }); if (!(r.result && r.result.sharedId)) return false; await send('input.performActions', { context: yt, actions: [{ type: 'pointer', id: 'm', actions: [{ type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: r.result.sharedId } } }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] }); return true; };
    const state = async () => JSON.parse(val(await evalIn(yt, "(() => { const v = document.querySelector('video'); const tr = document.querySelector('.mt-yt-trans'); const or = document.querySelector('.mt-yt-orig'); const fe = document.fullscreenElement; const o = document.getElementById('mt-yt-overlay'); const rc = o ? o.getBoundingClientRect() : null; return JSON.stringify({ t: v ? Math.round(v.currentTime) : null, paused: v ? v.paused : null, ad: !!document.querySelector('.ad-showing'), overlay: !!o, orig: or ? or.textContent.trim().slice(0, 50) : null, trans: tr ? tr.textContent.trim().slice(0, 50) : null, fullscreen: !!fe, overlayInside: !!(fe && o && fe.contains(o)), visible: !!(rc && rc.width > 0 && rc.height > 0 && rc.bottom <= innerHeight + 1) }); })()")));
    // 播放：只在暂停时点播放键，点完回读，不盲切
    const ensurePlaying = async () => { for (let i = 0; i < 4; i++) { const st = await state(); if (st.paused === false) return st; await trustedClick('.ytp-play-button'); await sleep(2000); } return await state(); };
    let st = await ensurePlaying(); step('播放 ' + JSON.stringify(st));
    let ytBtn = false; for (let i = 0; i < 20 && !ytBtn; i++) { ytBtn = val(await evalIn(yt, "(() => { const b = document.getElementById('mt-yt-btn'); if (!b) return false; b.click(); return true; })()")); if (!ytBtn) await sleep(1000); }
    await sleep(600);
    const rowTxt = val(await evalIn(yt, "(() => { const r = document.querySelector('#mt-yt-menu > div'); if (!r) return null; const t = r.textContent.trim(); r.click(); return t; })()"));
    step('译按钮 ' + (ytBtn ? '已点' : '没出现') + '，菜单第一行 ' + JSON.stringify(rowTxt)); log.ytBtn = ytBtn; log.ytMenuRow = rowTxt;
    // 等真字幕：不是占位符、不是不可用
    const isReal = (x) => x && x.trans && !/加载中|不可用|转写引擎|准备中/.test(x.trans);
    let ov = null; const t0w = Date.now();
    for (let i = 0; i < 150 && !ov; i++) { st = await state(); if (i % 10 === 0) step('yt ' + JSON.stringify(st)); if (isReal(st)) ov = st; else { if (st.paused && i % 5 === 4) await ensurePlaying(); await sleep(1000); } }
    log.ytBefore = st; log.subtitleWaitMs = Date.now() - t0w;
    if (!ov) { log.problems.push('YouTube 上 150 s 内没出现真字幕（最后：' + (st.trans || '无') + '）'); try { const shot = await send('browsingContext.captureScreenshot', { context: yt }); fs.writeFileSync(path.join(OUT, 'firefox-yt-fail.png'), Buffer.from(shot.data, 'base64')); } catch (_) {} }
    else {
      step('字幕来了 ' + JSON.stringify(ov));
      await trustedClick('.ytp-fullscreen-button'); await sleep(2500);
      const fs1 = await state(); await ensurePlaying(); await sleep(8000); const fs2 = await state();
      try { const shot = await send('browsingContext.captureScreenshot', { context: yt }); fs.writeFileSync(path.join(OUT, 'firefox-yt-fullscreen.png'), Buffer.from(shot.data, 'base64')); } catch (_) {}
      await send('input.performActions', { context: yt, actions: [{ type: 'key', id: 'k', actions: [{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }] }] }); await sleep(2000);
      const fs3 = await state();
      log.ytFullscreen = { enter: fs1, later: fs2, exit: fs3 };
      if (!fs1.fullscreen) log.problems.push('点全屏按钮没进全屏'); else if (!fs1.overlayInside) log.problems.push('全屏后叠层不在全屏元素里'); else if (!fs1.visible) log.problems.push('全屏后叠层不可见'); else if (fs2.t === fs1.t) log.problems.push('全屏里视频没在走'); else if (fs2.trans === fs1.trans) log.problems.push('全屏 8 s 译文没变');
      if (fs3.fullscreen) log.problems.push('Esc 没退出全屏'); else if (!fs3.overlay) log.problems.push('退出全屏后叠层没了');
    }
  } catch (e) { log.problems.push('YouTube: ' + e.message.slice(0, 200)); }
  try { await send('browsingContext.close', { context: yt }); } catch (_) {}
  if (process.argv.includes('--yt-only')) { try { const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'firefox-more.json'), 'utf8')); for (const k of Object.keys(prev)) if (/^tts_/.test(k)) log[k] = prev[k]; } catch (_) {} }
  fs.writeFileSync(path.join(OUT, 'firefox-more.json'), JSON.stringify(log, null, 2)); console.log(JSON.stringify(log, null, 1)); await bye();
})().catch(async (e) => { console.error('FAILED', e.message); fs.writeFileSync(path.join(OUT, 'firefox-more.json'), JSON.stringify({ ...log, fatal: e.message }, null, 2)); await bye(); process.exit(1); });
