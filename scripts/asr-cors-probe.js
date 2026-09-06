#!/usr/bin/env node
// scripts/asr-cors-probe.js — 「AI 转写字幕」预研：真实播客页里，页面音频到底抓不抓得到。
//
//   node scripts/asr-cors-probe.js                 # 内置页面清单
//   node scripts/asr-cors-probe.js .local/asr/pages.txt   # 一行一个 URL
//
// 对每个页面回答四个问题（全部在页面自己的源里执行，和内容脚本同一处境）：
//   1. 媒体元素的 currentSrc 是不是可取的 http(s) 直链，`fetch(src,{mode:'cors'})` 通不通
//      —— 通了才有「文件式」（整段下载→转写）这条底线路线；
//   2. `captureStream()` 抓 3 秒算 RMS —— 跨域无 CORS 头的媒体会给一条**静音轨**，这就是
//      流式路线的天花板；
//   3. 从这个页面源向两家 REST 转写端点真 POST 一小段音频 —— 期望拿到可读的 4xx（CORS 放行）
//      而不是 TypeError（CORS 拦截）；没 key 也能测：401/403 本身就是「浏览器打得到」的证据；
//   4. `new WebSocket(liveUrl)` 开不开得了（WebSocket 没有 CORS，这里只看握手）。
//
// 用 test/layout 的真 Chrome + CDP；不装扩展 —— 这些问题与扩展无关，是浏览器与站点的事。
'use strict';

const fs = require('fs');
const path = require('path');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DEFAULT_PAGES = [
  // 各家托管商的公开单集页（<audio> 直链的典型形态）
  'https://share.transistor.fm/s/0d5a8a83',
  'https://www.buzzsprout.com/1121972/episodes/15726470',
  'https://www.xiaoyuzhoufm.com/episode/6613ac3f5c1b8d6a3b0b1b2c',
  'https://www.lennysnewsletter.com/p/how-to-build-a-great-product-team',
  'https://player.captivate.fm/episode/8d6f6f3c-2f0a-4e6e-9a0f-0b1b9a9a9a9a',
];
const REST = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  meta: 'https://api.meta.ai/v1/asr/transcribe',
};
// OpenAI Realtime 的浏览器鉴权走子协议（没有请求头可用）。有真 key 时（.local/keys.md 的 sttApiKey）
// 用真 key 握手 —— 假 key 会在 upgrade 阶段被 401 拒掉，那证明不了「浏览器打得到」。
function keyFromLocal(name) {
  try {
    const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(path.join(__dirname, '..', '.local', 'keys.md'), 'utf8'));
    return m ? m[1] : null;
  } catch (_) { return null; }
}
const OPENAI_KEY = keyFromLocal('sttApiKey');
const WS = {
  gemini: { url: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=probe' },
  meta: { url: 'wss://api.meta.ai/v1/asr/realtime' },
  ...(OPENAI_KEY ? { openai: { url: 'wss://api.openai.com/v1/realtime?intent=transcription', protocols: ['realtime', 'openai-insecure-api-key.' + OPENAI_KEY] } } : {}),
};

// 页面里跑的探针。返回一个纯 JSON 结果；所有等待都有上限，静默失败不算成功。
const PAGE_SCRIPT = `(async () => {
  const out = { url: location.href, media: null };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms, label) => Promise.race([p, wait(ms).then(() => { throw new Error(label + ' timeout'); })]);
  const els = Array.from(document.querySelectorAll('audio, video'));
  const el = els.find((e) => e.currentSrc) || els[0] || null;
  if (!el) { out.media = 'none'; }
  else {
    const src = el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src) || '';
    out.media = { tag: el.tagName, src: src.slice(0, 140), scheme: (src.split(':')[0] || ''), readyState: el.readyState, duration: el.duration, crossOrigin: el.crossOrigin };
    // 1. 直链 CORS
    if (/^https?:/.test(src)) {
      try {
        const r = await withTimeout(fetch(src, { mode: 'cors', method: 'HEAD' }), 8000, 'HEAD');
        out.headCors = { ok: r.ok, status: r.status, type: r.type, acao: r.headers.get('access-control-allow-origin'), len: r.headers.get('content-length'), ctype: r.headers.get('content-type') };
      } catch (e) { out.headCors = { error: String(e && e.message || e) }; }
      try {
        const r = await withTimeout(fetch(src, { mode: 'cors', headers: { Range: 'bytes=0-65535' } }), 8000, 'GET');
        const b = await withTimeout(r.arrayBuffer(), 8000, 'GET body');
        out.getCors = { ok: r.ok, status: r.status, bytes: b.byteLength };
      } catch (e) { out.getCors = { error: String(e && e.message || e) }; }
    }
    // 2. captureStream 静音判定（要先播放；可能被自动播放策略拒绝 —— 那也是事实）
    try {
      el.muted = true; // 别在无人值守时出声；muted 不影响 captureStream 的样本
      await withTimeout(el.play(), 5000, 'play');
      await wait(500);
      if (typeof el.captureStream !== 'function') out.capture = { error: 'no captureStream' };
      else {
        const ms = el.captureStream();
        const tracks = ms.getAudioTracks();
        if (!tracks.length) out.capture = { error: 'no audio track', muted: null };
        else {
          const ac = new AudioContext();
          const srcNode = ac.createMediaStreamSource(new MediaStream([tracks[0]]));
          const an = ac.createAnalyser(); an.fftSize = 2048;
          srcNode.connect(an);
          const buf = new Float32Array(an.fftSize);
          let peak = 0, sum = 0, n = 0;
          const t0 = Date.now();
          while (Date.now() - t0 < 3000) {
            an.getFloatTimeDomainData(buf);
            let s = 0; for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; peak = Math.max(peak, Math.abs(buf[i])); }
            sum += Math.sqrt(s / buf.length); n++;
            await wait(100);
          }
          out.capture = { trackMuted: tracks[0].muted, rms: +(sum / n).toFixed(5), peak: +peak.toFixed(4), silent: peak < 1e-3, paused: el.paused, currentTime: el.currentTime };
          try { ac.close(); } catch (_) {}
        }
      }
      el.pause();
    } catch (e) { out.capture = { error: String(e && e.message || e) }; }
  }
  // 3. 两家 REST 从页面源打过去
  const tone = (() => { const rate = 16000, n = rate * 0.3; const b = new ArrayBuffer(44 + n * 2); const v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(6000 * Math.sin(2 * Math.PI * 440 * i / rate)), true); return b; })();
  out.rest = {};
  for (const [name, url] of Object.entries(${JSON.stringify(REST)})) {
    try {
      let r;
      if (name === 'gemini') {
        r = await withTimeout(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'probe' },
          body: JSON.stringify({ model: 'gemini-3.5-transcribe', input: [{ type: 'audio', data: btoa(String.fromCharCode(...new Uint8Array(tone.slice(0, 4000)))), mime_type: 'audio/wav' }] }) }), 10000, name);
      } else {
        const fd = new FormData(); fd.append('file', new Blob([tone], { type: 'audio/wav' }), 'probe.wav'); fd.append('model', 'muse-voice-transcribe-1.0');
        r = await withTimeout(fetch(url, { method: 'POST', headers: { Authorization: 'Bearer probe' }, body: fd }), 10000, name);
      }
      const txt = await r.text();
      out.rest[name] = { status: r.status, corsReadable: true, acao: r.headers.get('access-control-allow-origin'), body: txt.slice(0, 120) };
    } catch (e) { out.rest[name] = { corsReadable: false, error: String(e && e.message || e) }; }
  }
  // 4. WebSocket 握手
  out.ws = {};
  for (const [name, spec] of Object.entries(${JSON.stringify(WS)})) {
    out.ws[name] = await new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const w = spec.protocols ? new WebSocket(spec.url, spec.protocols) : new WebSocket(spec.url);
        w.onopen = () => { fin({ open: true }); try { w.close(); } catch (_) {} };
        w.onerror = () => fin({ open: false, error: 'error event (握手失败或被拒)' });
        w.onclose = (e) => fin({ open: false, code: e.code, reason: e.reason });
        setTimeout(() => { fin({ open: false, error: 'timeout' }); try { w.close(); } catch (_) {} }, 8000);
      } catch (e) { fin({ open: false, error: String(e && e.message || e) }); }
    });
  }
  return out;
})()`;

async function probePage(cdp, url) {
  // `media:<url>`：不进任何站点，在一个 https 空页里自己挂一个 <audio src>，只测托管 CDN 的
  // CORS 与 captureStream。页面源用 example.com（真实的跨域源，about:blank 的 null 源会让 CORS 结论失真）。
  const mediaOnly = url.startsWith('media:');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const onPage = (m, p = {}) => cdp.send(m, p, sessionId);
  await onPage('Page.enable');
  await onPage('Runtime.enable');
  await onPage('Page.navigate', { url: mediaOnly ? 'https://example.com/' : url });
  if (mediaOnly) {
    await new Promise((r) => setTimeout(r, 1500));
    await onPage('Runtime.evaluate', { expression: `(() => { const a = document.createElement('audio'); a.src = ${JSON.stringify(url.slice(6))}; a.preload = 'auto'; document.body.appendChild(a); return a.src; })()` });
    await new Promise((r) => setTimeout(r, 2500));
    const res = await onPage('Runtime.evaluate', { expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true, timeout: 90000 });
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    if (res.exceptionDetails) return { url, error: (res.exceptionDetails.exception && res.exceptionDetails.exception.description) || 'evaluate failed' };
    return { ...res.result.value, url };
  }
  // 等待 load 事件，上限 25 秒；站点慢也要有个结论
  await Promise.race([
    new Promise((r) => { const off = cdp.on('Page.loadEventFired', (_, sid) => { if (sid === sessionId) { off(); r(); } }); }),
    new Promise((r) => setTimeout(r, 25000)),
  ]);
  await new Promise((r) => setTimeout(r, 2500)); // 让播放器把 <audio> 挂出来
  const res = await onPage('Runtime.evaluate', { expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true, timeout: 90000 });
  await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  if (res.exceptionDetails) return { url, error: (res.exceptionDetails.exception && res.exceptionDetails.exception.description) || 'evaluate failed' };
  return res.result.value;
}

function summarize(r) {
  if (r.error) return `✗ 页面脚本失败：${String(r.error).slice(0, 100)}`;
  const m = r.media;
  if (m === 'none' || !m) return '— 页面上没有 <audio>/<video>';
  const lines = [`${m.tag} src=${m.scheme}: ${m.src}`];
  if (r.headCors) lines.push(`  直链 HEAD(cors): ${r.headCors.error ? '✗ ' + r.headCors.error : `${r.headCors.status} acao=${r.headCors.acao} len=${r.headCors.len}`}`);
  if (r.getCors) lines.push(`  直链 GET(cors, Range): ${r.getCors.error ? '✗ ' + r.getCors.error : `${r.getCors.status} ${r.getCors.bytes}B`}`);
  if (r.capture) lines.push(`  captureStream: ${r.capture.error ? '✗ ' + r.capture.error : `${r.capture.silent ? '✗ 静音' : '✓ 有声'} rms=${r.capture.rms} peak=${r.capture.peak} trackMuted=${r.capture.trackMuted}`}`);
  for (const [k, v] of Object.entries(r.rest || {})) lines.push(`  REST ${k}: ${v.corsReadable ? `✓ CORS 放行，HTTP ${v.status} acao=${v.acao} ${JSON.stringify(v.body).slice(0, 90)}` : '✗ ' + v.error}`);
  for (const [k, v] of Object.entries(r.ws || {})) lines.push(`  WS ${k}: ${v.open ? '✓ 握手成功' : `✗ ${v.error || ''} code=${v.code || ''} ${v.reason || ''}`}`);
  return lines.join('\n');
}

(async () => {
  const listFile = process.argv[2];
  const pages = listFile ? fs.readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : DEFAULT_PAGES;
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const results = [];
  try {
    const cdp = await CDP.connect(chrome.port);
    for (const url of pages) {
      process.stdout.write(`\n■ ${url}\n`);
      let r;
      try { r = await probePage(cdp, url); } catch (e) { r = { url, error: e.message }; }
      results.push(r);
      console.log(summarize(r));
    }
    cdp.close();
  } finally { await chrome.cleanup(); }
  const outDir = path.join(__dirname, '..', '.local', 'asr', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, 'cors-probe.json');
  fs.writeFileSync(p, JSON.stringify({ date: new Date().toISOString(), results }, null, 1));
  console.log('\n→ ' + path.relative(process.cwd(), p));
})().catch((e) => { console.error('✗ ' + (e.stack || e.message)); process.exit(1); });
