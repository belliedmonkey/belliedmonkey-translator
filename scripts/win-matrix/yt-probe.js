'use strict';
// yt-probe.js <host> <port> —— 只读：附着到**已经开着**的 YouTube 播放页，不导航、不点击，读字幕相关状态。
// 读什么、为什么：广告状态（广告期间正片字幕本来就不存在）· 当前视频 id 的 timedtext 响应体大小（按 v= 过滤，
// 否则会读到广告自己的空字幕请求）· 原生字幕元素在不在（别用肉眼：开着译时扩展把它 opacity:0 藏了）· 叠层文案。
const http = require('http'); const [host, port] = process.argv.slice(2);
http.get({ host, port, path: '/json/version' }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => {
  const ws = new WebSocket(JSON.parse(d).webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${host}:${port}`)); let id = 0; const P = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { P.get(m.id)(m.result || m.error); P.delete(m.id); } };
  const send = (method, params = {}, sessionId) => new Promise((res) => { P.set(++id, res); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); setTimeout(() => res({ timeout: true }), 15000); });
  ws.onopen = async () => {
    const { targetInfos } = await send('Target.getTargets'); const t = targetInfos.find((t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url));
    if (!t) { console.log('没有开着的 YouTube 播放页；现有页面：' + targetInfos.filter((x) => x.type === 'page').map((x) => x.url.slice(0, 60)).join(' | ')); ws.close(); return; }
    const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ url: location.href.slice(0, 60), v: (() => { const v = document.querySelector('video'); return v ? { t: Math.round(v.currentTime), paused: v.paused } : null; })(), ad: (() => { const p = document.querySelector('#movie_player'); return !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))); })(), videoId: new URL(location.href).searchParams.get('v'), cc: (document.querySelector('.ytp-subtitles-button') || { getAttribute: () => 'no-btn' }).getAttribute('aria-pressed'), tracks: ((((window.ytInitialPlayerResponse || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []).length, nativeSegments: [...document.querySelectorAll('.ytp-caption-segment')].map(e => e.textContent.trim()).slice(0, 3), nativeContainerOpacity: (() => { const c = document.querySelector('.ytp-caption-window-container'); return c ? getComputedStyle(c).opacity : 'no-container'; })(), mtStyleInjected: !!document.getElementById('mt-yt-style'), timedtext: performance.getEntriesByType('resource').filter(e => /timedtext/.test(e.name)).map(e => ({ sameVideo: (e.name.match(/[?&]v=([^&]+)/) || [])[1] === new URL(location.href).searchParams.get('v'), pot: /[?&]pot=/.test(e.name), fmt: (e.name.match(/[?&]fmt=([^&]+)/) || [])[1] || null, status: e.responseStatus || null, body: Math.round(e.encodedBodySize || 0), decoded: Math.round(e.decodedBodySize || 0), initiator: e.initiatorType })).slice(-6), overlay: { orig: ((document.querySelector('.mt-yt-orig') || {}).textContent || '').trim().slice(0, 60), trans: ((document.querySelector('.mt-yt-trans') || {}).textContent || '').trim().slice(0, 60) } })` }, sessionId);
    console.log(r.result ? r.result.value : JSON.stringify(r)); await send('Target.detachFromTarget', { sessionId }); ws.close();
  };
}); }).on('error', (e) => console.log('连不上台式机 Chrome：' + e.message));
