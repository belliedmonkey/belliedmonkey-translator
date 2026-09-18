'use strict';
// yt-subtitles.js <host> <port>   [NOSKIP=1 不点跳过，让长广告自己播完]
// Chrome / Edge 上「YouTube 字幕到底拿不拿得到」的判据脚本。它处理广告：有「跳过」就用可信点击点掉，记下广告结束的
// 时刻，再量之后多少毫秒出真字幕（不是「字幕加载中 / 不可用 / 译文准备中」）。
// 为什么必须处理广告：2026-09-18 一整天把「拿不到字幕」归因成未登录 / 服务端拦截 / 出口节点，真因只是自动化里没人点
// 跳过、广告把 8 次取字幕耗光（#325）。不带广告状态的读数不可信。
const http = require('http'); const [host, port] = process.argv.slice(2); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
http.get({ host, port, path: '/json/version' }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => {
  const ws = new WebSocket(JSON.parse(d).webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${host}:${port}`)); let id = 0; const P = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { P.get(m.id)(m.result || m.error); P.delete(m.id); } };
  const send = (method, params = {}, sessionId) => new Promise((res) => { P.set(++id, res); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); setTimeout(() => res({ timeout: true }), 25000); });
  ws.onopen = async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId); await send('Page.navigate', { url: 'https://www.youtube.com/watch?v=aircAruvnKk' }, sessionId); await sleep(7000);
    const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId); return r.result ? r.result.value : JSON.stringify(r).slice(0, 200); };
    const probe = `JSON.stringify({ t: (() => { const v = document.querySelector('video'); return v ? [Math.round(v.currentTime), v.paused] : null; })(), playerAd: (() => { const p = document.querySelector('#movie_player'); return p ? [p.classList.contains('ad-showing'), p.classList.contains('ad-interrupting')] : null; })(), sel: ['.ytp-ad-player-overlay', '.ytp-ad-player-overlay-layout', '.ad-showing', '.ad-interrupting'].map(s => { const e = document.querySelector(s); return e ? (e.id || e.tagName) + ':' + (e.getClientRects().length ? 'vis' : 'hidden') : null; }), active: !!document.getElementById('mt-yt-style'), btn: !!document.getElementById('mt-yt-btn'), overlay: !!document.getElementById('mt-yt-overlay'), trans: ((document.querySelector('.mt-yt-trans') || {}).textContent || '').slice(0, 40), orig: ((document.querySelector('.mt-yt-orig') || {}).textContent || '').slice(0, 40) })`;
    console.log('before:', await ev(probe));
    for (let k = 0; k < 25; k++) { if (await ev("!!document.getElementById('mt-yt-btn')")) break; await sleep(1000); }
    console.log('btn click:', await ev("(() => { const b = document.getElementById('mt-yt-btn'); if (!b) return 'no btn'; b.click(); return 'ok'; })()")); await sleep(600);
    console.log('menu row:', await ev("(() => { const r = document.querySelector('#mt-yt-menu > div'); if (!r) return null; const t = r.textContent.trim(); r.click(); return t; })()"));
    const t0 = Date.now(); const el = () => ((Date.now() - t0) / 1000).toFixed(0) + 's'; let adEndedAt = null, firstSubAt = null, skips = 0, last = '';
    const trusted = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, sessionId); };
    for (let i = 0; i < 170; i++) {
      await sleep(1000);
      const st = JSON.parse(await ev(probe)); const ad = !!(st.playerAd && (st.playerAd[0] || st.playerAd[1]));
      if (ad && !process.env.NOSKIP) { const b = await ev("(() => { const b = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button, button[id^=skip-button]'); if (!b || !b.getClientRects().length) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()"); if (b) { const { x, y } = JSON.parse(b); await trusted(x, y); skips++; console.log(el(), '点了「跳过广告」'); } }
      if (!ad && adEndedAt === null) { adEndedAt = Date.now(); console.log(el(), '广告结束', JSON.stringify(st)); }
      const real = st.orig || (st.trans && !/加载中|不可用|转写引擎|准备中/.test(st.trans));
      const line = JSON.stringify({ ad, overlay: st.overlay, orig: st.orig, trans: st.trans }); if (line !== last && (i % 5 === 0 || !ad)) { console.log(el(), line); last = line; }
      if (adEndedAt !== null && st.paused) await ev("document.querySelector('.ytp-play-button') && document.querySelector('video').paused && document.querySelector('.ytp-play-button').click(); true");
      if (real && adEndedAt !== null) { firstSubAt = Date.now(); console.log(el(), '真字幕：', st.orig, '|', st.trans); break; }
      if (adEndedAt !== null && Date.now() - adEndedAt > 45000) { console.log(el(), '广告结束 45 s 仍无真字幕：', JSON.stringify(st)); break; }
    }
    console.log(JSON.stringify({ skips, adSeconds: adEndedAt ? Math.round((adEndedAt - t0) / 1000) : null, subtitleAfterAdMs: firstSubAt && adEndedAt ? firstSubAt - adEndedAt : null }));
    await send('Target.closeTarget', { targetId }); ws.close();
  };
}); });
