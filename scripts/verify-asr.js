#!/usr/bin/env node
// scripts/verify-asr.js — 「AI 转写字幕」(docs/domain-design.md §2.4) 装进真 Chrome 后到底
// 出不出字幕。npm run test:asr。Node ≥22（内置 WebSocket 客户端；服务端这里手写 RFC 6455）。
//
// 两个场景，各一页，都在本机 HTTP 服务上，STT 端点也是本机假的 —— 这道门验的是**链路**
// （点入口 → 取音频/抓音频 → 发给端点 → cue → 叠层显示 → 翻译行），不验厂商。厂商由
// scripts/asr-probe.js 验。
//   A. 文件一档：<audio src="/tone.wav">（同源，可取）→ POST /v1/audio/transcriptions
//      （假 whisper，回 verbose_json 的 segments）→ 播放中叠层出现原文 + 译文。
//      判据里有一条「没发出的请求」：整段只上传**一次**。
//   B. 流式一档：<audio src="blob:…">（无直链）→ captureStream → PCM → ws://…/live
//      （假 ws-realtime 服务端，收到 ≥ 20 帧非空 append 后回逐词 delta）→ 叠层出现整句。
//      判据：服务端真的收到了 PCM（抓流有声，静音守卫没触发），叠层出现那句。
//
// 判据必须是回读：叠层 textContent、假端点的请求计数。「没报错」不算。
// 改前红：main 上没有入口按钮，A/B 都在「等入口」处超时 —— 这就是 verification-spec §3.2
// 要求的红。
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 20 秒 440Hz 的 WAV（有声，静音守卫不会触发）────────────────────────
function toneWav(seconds = 40, rate = 16000) {
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}

// ─── 假端点 + 页面 ──────────────────────────────────────────────────────
const stats = { uploads: 0, chatCalls: 0, wsFrames: 0, wsAudioBytes: 0, wsOpened: 0 };
// 覆盖整段 40 秒：点入口时播放头已经走了十几秒（等 字幕不可用 落定要 6×2.5s），只盖开头的
// cue 会让 activeAt 一直是 null —— 第一版就是这么红的，红得对：叠层没东西就是没东西。
const CUES = [];
for (let i = 0; i < 8; i++) CUES.push({ start: i * 5 + 0.3, end: i * 5 + 4.8, text: `Sentence number ${i + 1} from the fake transcriber.` });
const PAGE_FILE = `<!doctype html><meta charset=utf-8><title>asr file tier</title>
<h1>Podcast page</h1><p>Some show notes text for the page path.</p>
<audio id="a" src="/tone.wav" controls preload="auto" loop></audio>`;
const PAGE_BLOB = `<!doctype html><meta charset=utf-8><title>asr live tier</title>
<h1>Video-ish page</h1><p>A page whose media has no fetchable URL.</p>
<audio id="a" controls preload="auto" loop></audio>
<script>
fetch('/tone.wav').then(r => r.blob()).then(b => { const a = document.getElementById('a'); a.src = URL.createObjectURL(b); a.dataset.ready = '1'; });
</script>`;

function serve() {
  const wav = toneWav();
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/file.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE_FILE); return; }
    if (u === '/blob.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE_BLOB); return; }
    if (u === '/tone.wav') {
      // Range 支持：探针用 bytes=0-1023 试 CORS；Chrome 播放也会带 Range
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const s = +m[1], e = m[2] ? Math.min(+m[2], wav.length - 1) : wav.length - 1;
        res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Range': `bytes ${s}-${e}/${wav.length}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
        res.end(wav.subarray(s, e + 1)); return;
      }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Accept-Ranges': 'bytes' }); res.end(wav); return;
    }
    if (u === '/v1/audio/transcriptions' && req.method === 'POST') {
      let n = 0; req.on('data', (c) => { n += c.length; });
      req.on('end', () => {
        stats.uploads++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: CUES.map((c) => c.text).join(' '), duration: 40, segments: CUES.map((c, i) => ({ id: i, start: c.start, end: c.end, text: c.text })) }));
      });
      return;
    }
    if (u === '/v1/chat/completions' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        stats.chatCalls++;
        let user = ''; try { const j = JSON.parse(body); user = (j.messages.find((x) => x.role === 'user') || {}).content || ''; } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '译：' + String(user).slice(0, 40) } }] }));
      });
      return;
    }
    res.writeHead(404); res.end('nope');
  });
  // ── 假的 ws-realtime 服务端（RFC 6455 最小实现：文本帧收发，不分片）──
  srv.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/live')) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const proto = String(req.headers['sec-websocket-protocol'] || '').split(',')[0].trim();
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` + (proto ? `Sec-WebSocket-Protocol: ${proto}\r\n` : '') + '\r\n');
    stats.wsOpened++;
    const send = (obj) => {
      const payload = Buffer.from(JSON.stringify(obj));
      let head;
      if (payload.length < 126) head = Buffer.from([0x81, payload.length]);
      else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(payload.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
      socket.write(Buffer.concat([head, payload]));
    };
    let buf = Buffer.alloc(0), scripted = false, frames = 0;
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 0x80;
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const data = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(off + maskLen + len);
        if (op === 8) { socket.end(); return; }
        if (op === 1 && fin) {
          let m; try { m = JSON.parse(data.toString('utf8')); } catch (_) { continue; }
          if (m.type === 'session.update') send({ type: 'session.updated', session: m.session });
          else if (m.type === 'input_audio_buffer.append') {
            stats.wsFrames++; frames++;
            stats.wsAudioBytes += Math.floor((m.audio || '').length * 3 / 4);
            // 收到足够多的真 PCM 之后才「听懂」—— 这样叠层出现整句就证明抓流真的送到了这里
            if (!scripted && frames >= 20) {
              scripted = true;
              const words = ['Hello', ' from', ' the', ' live', ' fake.', ' Second', ' sentence', ' here.'];
              let i = 0;
              const t = setInterval(() => {
                if (i >= words.length) { clearInterval(t); return; }
                send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: words[i++] });
              }, 150);
            }
          }
        }
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

// ─── CDP helpers ───────────────────────────────────────────────────────
async function evalIn(cdp, sessionId, expression, contextId) {
  const r = await cdp.send('Runtime.evaluate', Object.assign({ expression, returnByValue: true, awaitPromise: true }, contextId ? { contextId } : {}), sessionId);
  if (r.exceptionDetails) throw new Error('evaluate: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
  return r.result ? r.result.value : undefined;
}
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`超时 ${ms}ms：${label}`);
    await sleep(250);
  }
}

// ─── --real <url>：真站点 + 真引擎（.local/keys.md）—— 矩阵里「macOS Chrome 文件一档」那一行 ──
// 不是门禁（要 key、要网、要花钱），是 verification-spec §0 全矩阵的执行体之一：把结果
// 连同叠层文字一起打印，人读回。翻译用 DeepSeek（verify-with-deepseek-not-google）。
function keySlot(name) {
  try {
    const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(path.join(ROOT, '.local', 'keys.md'), 'utf8'));
    return m ? m[1] : null;
  } catch (_) { return null; }
}
async function realRun(url) {
  const deepseek = keySlot('key_chat_deepseek') || keySlot('apiKey');
  const stt = keySlot('sttApiKey');
  if (!deepseek || !stt) { console.error('✗ .local/keys.md 里缺 key_chat_deepseek 或 sttApiKey'); process.exit(1); }
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const cdp = await CDP.connect(chrome.port);
  try {
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    let swSession = null;
    for (let i = 0; i < 60 && !swSession; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
      if (sw) ({ sessionId: swSession } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true }));
      else await sleep(150);
    }
    await cdp.send('Runtime.enable', {}, swSession);
    await evalIn(cdp, swSession, `chrome.storage.local.set(${JSON.stringify({ enabled: false, provider: 'deepseek', apiKey: deepseek, apiBaseUrl: '', apiModel: '', targetLang: 'zh-CN', sttEngine: 'openai_transcribe', sttApiKey: stt, sttBaseUrl: '', sttModel: '', engineChosen: true, extObSeen: true })})`);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const contexts = []; const errs = [];
    cdp.on('Runtime.executionContextCreated', (ev, sid) => { if (sid === sessionId) contexts.push(ev.context); });
    cdp.on('Runtime.exceptionThrown', (ev, sid) => { if (sid === sessionId) errs.push((((ev.exceptionDetails || {}).exception || {}).description || '').slice(0, 160)); });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(6000);
    const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated');
    if (!iso) throw new Error('没有内容脚本的隔离世界');
    const media = await evalIn(cdp, sessionId, `(() => { const m = document.querySelector('audio, video'); if (!m) return null; m.muted = true; m.play().catch(() => {}); return { src: (m.currentSrc || m.src || '').slice(0, 100), duration: m.duration }; })()`);
    console.log('  媒体', JSON.stringify(media));
    if (!media) throw new Error('页面上没有媒体元素');
    await evalIn(cdp, sessionId, `PodcastTranslator.enable({ provider: 'deepseek', apiKey: ${JSON.stringify(deepseek)}, apiBaseUrl: '', apiModel: '', targetLang: 'zh-CN' }); 'ok'`, iso.id);
    await waitFor(() => evalIn(cdp, sessionId, `!!document.querySelector('#mt-pod-overlay .mt-pod-trans-action')`), 40000, '转写入口按钮');
    const t0 = Date.now();
    await evalIn(cdp, sessionId, `document.querySelector('#mt-pod-overlay .mt-pod-trans-action').click(); 'clicked'`);
    const seen = new Set();
    let firstAt = 0;
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      const st = await evalIn(cdp, sessionId, `(() => { const o = document.querySelector('#mt-pod-overlay .mt-pod-orig'), t = document.querySelector('#mt-pod-overlay .mt-pod-trans'); const m = document.querySelector('audio, video'); return { orig: o ? o.textContent : '', trans: t ? t.textContent : '', t: m ? m.currentTime : 0 }; })()`);
      if (st.orig && !seen.has(st.orig)) { seen.add(st.orig); if (!firstAt) firstAt = Date.now() - t0; console.log(`  [${st.t.toFixed(1)}s] ${st.orig} ⟶ ${st.trans}`); }
      else if (!st.orig && st.trans && i % 10 === 0) console.log(`  提示「${st.trans}」`);
      if (seen.size >= 6) break;
    }
    console.log(`  首条字幕出现耗时 ${firstAt ? (firstAt / 1000).toFixed(1) + 's' : '（没出现）'}；不同句子 ${seen.size} 条；页面异常 ${errs.length ? errs.slice(0, 2).join(' | ') : '无'}`);
    if (!seen.size) { console.log('✗ 真站点没有出现字幕'); process.exitCode = 1; }
    else console.log('✓ 真站点 + 真引擎：字幕出现');
  } finally { try { cdp.close(); } catch (_) {} chrome.cleanup(); }
}

// ─── --live <url>：真直播 + 真引擎 —— 流式一档在真站点上的样子（叠层流式 + 历史面板）──
// 同 --real 不是门禁。每 5 秒截一张图到 .local/asr/results/live-<ts>-N.png 当时间证据
// （verification-spec：时间相关的判断要有录像；这里是逐帧截图）。
async function liveRun(url, seconds) {
  const deepseek = keySlot('key_chat_deepseek') || keySlot('apiKey');
  const stt = keySlot('sttApiKey');
  if (!deepseek || !stt) { console.error('✗ .local/keys.md 里缺 key_chat_deepseek 或 sttApiKey'); process.exit(1); }
  const outDir = path.join(ROOT, '.local', 'asr', 'results'); fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required', '--window-size=1400,900']);
  const cdp = await CDP.connect(chrome.port);
  try {
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    let swSession = null;
    for (let i = 0; i < 60 && !swSession; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
      if (sw) ({ sessionId: swSession } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true }));
      else await sleep(150);
    }
    await cdp.send('Runtime.enable', {}, swSession);
    await evalIn(cdp, swSession, `chrome.storage.local.set(${JSON.stringify({ enabled: false, provider: 'deepseek', apiKey: deepseek, apiBaseUrl: '', apiModel: '', targetLang: 'zh-CN', sttEngine: 'openai_transcribe', sttApiKey: stt, sttBaseUrl: '', sttModel: '', engineChosen: true, extObSeen: true })})`);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const contexts = []; const errs = [];
    cdp.on('Runtime.executionContextCreated', (ev, sid) => { if (sid === sessionId) contexts.push(ev.context); });
    cdp.on('Runtime.exceptionThrown', (ev, sid) => { if (sid === sessionId) errs.push((((ev.exceptionDetails || {}).exception || {}).description || '').slice(0, 160)); });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(9000);
    const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated');
    if (!iso) throw new Error('没有内容脚本的隔离世界');
    const media = await evalIn(cdp, sessionId, `(() => { const m = document.querySelector('video'); if (!m) return null; m.muted = true; m.play().catch(() => {}); return { src: (m.currentSrc || m.src || '').slice(0, 60), duration: m.duration, paused: m.paused }; })()`);
    console.log('  媒体', JSON.stringify(media));
    const isYt = /youtube\.com/.test(url);
    const started = await evalIn(cdp, sessionId, `(() => { try { return ${isYt ? 'YouTubeTranslator' : 'PodcastTranslator'}.startAsr(); } catch (e) { return 'ERR ' + e.message; } })()`, iso.id);
    console.log('  startAsr →', started);
    const t0 = Date.now();
    const seen = new Set(); let shots = 0, lastPartial = '';
    const ovSel = isYt ? '#mt-yt-overlay .mt-yt-orig' : '#mt-pod-overlay .mt-pod-orig';
    const trSel = isYt ? '#mt-yt-overlay .mt-yt-trans' : '#mt-pod-overlay .mt-pod-trans';
    const hist = isYt ? '#mt-yt-history' : '#mt-pod-history';
    while (Date.now() - t0 < seconds * 1000) {
      await sleep(1000);
      const st = await evalIn(cdp, sessionId, `(() => { const o = document.querySelector(${JSON.stringify(ovSel)}), t = document.querySelector(${JSON.stringify(trSel)}); const rows = [...document.querySelectorAll(${JSON.stringify(hist + ' .' + hist.slice(1) + '-row')})].map(r => [...r.children].map(c => c.textContent).join(' ⟶ ')); return { orig: o ? o.textContent : '', trans: t ? t.textContent : '', rows }; })()`);
      if (st.orig && st.orig !== lastPartial) { lastPartial = st.orig; }
      for (const r of st.rows) if (!seen.has(r)) { seen.add(r); console.log(`  [+${((Date.now() - t0) / 1000).toFixed(0)}s] 面板: ${r.slice(0, 140)}`); }
      if ((Date.now() - t0) / 1000 >= shots * 5) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(path.join(outDir, `live-${stamp}-${String(shots).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'));
        shots++;
        console.log(`  [+${((Date.now() - t0) / 1000).toFixed(0)}s] 叠层: 「${st.orig.slice(0, 80)}」 / 「${st.trans.slice(0, 60)}」`);
      }
    }
    console.log(`  ${seconds}s：面板定稿 ${seen.size} 句，截图 ${shots} 张 → ${path.relative(ROOT, outDir)}/live-${stamp}-*.png；页面异常 ${errs.length ? errs.slice(0, 2).join(' | ') : '无'}`);
    if (!seen.size) { console.log('✗ 直播上没有出现定稿句'); process.exitCode = 1; } else console.log('✓ 真直播 + 真引擎：双显出现');
  } finally { try { cdp.close(); } catch (_) {} chrome.cleanup(); }
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) { console.error('✗ 没有 dist/，先 node build.js'); process.exit(1); }
  const li = process.argv.indexOf('--live');
  if (li > 0) { await liveRun(process.argv[li + 1], +(process.argv[li + 2]) || 60); return; }
  const ri = process.argv.indexOf('--real');
  if (ri > 0) { await realRun(process.argv[ri + 1]); return; }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const cdp = await CDP.connect(chrome.port);
  const problems = [];
  const notes = [];
  try {
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');
    // 种设置：翻译走本机假 chat 端点；转写引擎 = local（transcribe-compat，用户自填地址）。
    // 流式一档的 liveEndpoint 不可由用户覆盖（§7 v1），所以在扩展的隔离世界里给注册表
    // 追加一个测试引擎条目 —— 不改产品代码，改的是这台机器上的注册表副本。
    let swSession = null;
    for (let i = 0; i < 60 && !swSession; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
      if (sw) ({ sessionId: swSession } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true }));
      else await sleep(150);
    }
    if (!swSession) throw new Error('service worker 未启动');
    await cdp.send('Runtime.enable', {}, swSession);
    await evalIn(cdp, swSession, `chrome.storage.local.set(${JSON.stringify({
      enabled: false, provider: 'custom_chat', apiKey: 'k', apiBaseUrl: base + '/v1/chat/completions', apiModel: 'm', targetLang: 'zh-CN',
      sttEngine: 'local', sttApiKey: '', sttBaseUrl: base + '/v1/audio/transcriptions', sttModel: 'whisper-1',
      engineChosen: true, extObSeen: true,
    })})`);
    notes.push(`扩展 ${extId}，假端点 ${base}`);

    async function openPage(url) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const contexts = [];
      cdp.on('Runtime.executionContextCreated', (ev, sid) => { if (sid === sessionId) contexts.push(ev.context); });
      const errs = [];
      cdp.on('Runtime.exceptionThrown', (ev, sid) => { if (sid === sessionId) { const d = ev.exceptionDetails || {}; errs.push(((d.exception || {}).description || d.text || '').slice(0, 200)); } });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Page.navigate', { url }, sessionId);
      await sleep(2500);
      const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && /belliedmonkey|translator|mt/i.test(c.name || '')) || contexts.find((c) => c.auxData && c.auxData.type === 'isolated');
      return { targetId, sessionId, isoId: iso ? iso.id : null, errs };
    }

    // ── A. 文件一档 ─────────────────────────────────────────────────────
    {
      const pg = await openPage(base + '/file.html');
      if (!pg.isoId) throw new Error('找不到内容脚本的隔离世界（扩展没注入？）');
      await evalIn(cdp, pg.sessionId, `document.getElementById('a').play().catch(() => {})`);
      // 打开字幕（FAB 驱动播客路径；这里直接调后端，与 FAB 同一入口）
      await evalIn(cdp, pg.sessionId, `PodcastTranslator.enable({ provider: 'custom_chat', apiKey: 'k', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', targetLang: 'zh-CN' }); 'ok'`, pg.isoId);
      // 入口按钮出现在 字幕不可用 里（无字幕来源，重试 6 次 × 2.5s 后落定；这里等它）
      await waitFor(() => evalIn(cdp, pg.sessionId, `!!document.querySelector('#mt-pod-overlay .mt-pod-trans-action')`), 30000, '字幕不可用 里的转写入口按钮');
      const label = await evalIn(cdp, pg.sessionId, `document.querySelector('#mt-pod-overlay .mt-pod-trans-action').textContent`);
      notes.push(`A: 入口按钮「${label}」`);
      const uploadsBefore = stats.uploads;
      await evalIn(cdp, pg.sessionId, `document.querySelector('#mt-pod-overlay .mt-pod-trans-action').click(); 'clicked'`);
      let orig;
      try {
        orig = await waitFor(() => evalIn(cdp, pg.sessionId, `(document.querySelector('#mt-pod-overlay .mt-pod-orig') || {}).textContent || ''`), 30000, 'A: 叠层出现原文');
      } catch (e) {
        const notice = await evalIn(cdp, pg.sessionId, `(document.querySelector('#mt-pod-overlay .mt-pod-trans') || {}).textContent || ''`);
        const t = await evalIn(cdp, pg.sessionId, `document.getElementById('a').currentTime`);
        throw new Error(`${e.message}；叠层提示「${notice}」；上传 ${stats.uploads - uploadsBefore} 次；currentTime ${t}；页面异常 ${pg.errs.slice(0, 2).join(' | ')}`);
      }
      const trans = await waitFor(() => evalIn(cdp, pg.sessionId, `((document.querySelector('#mt-pod-overlay .mt-pod-trans') || {}).textContent || '').startsWith('译：') && (document.querySelector('#mt-pod-overlay .mt-pod-trans') || {}).textContent`), 20000, 'A: 叠层出现译文');
      notes.push(`A: 原文「${orig}」 译文「${trans}」`);
      if (!CUES.some((c) => orig.indexOf(c.text.split(' ')[0]) >= 0)) problems.push(`A: 叠层原文不是假端点回的 cue：「${orig}」`);
      if (stats.uploads - uploadsBefore !== 1) problems.push(`A: 整段应只上传一次，实际 ${stats.uploads - uploadsBefore} 次`);
      if (pg.errs.length) problems.push('A: 页面异常 ' + pg.errs.slice(0, 2).join(' | '));
      await cdp.send('Target.closeTarget', { targetId: pg.targetId });
    }

    // ── B. 流式一档 ─────────────────────────────────────────────────────
    {
      const pg = await openPage(base + '/blob.html');
      await waitFor(() => evalIn(cdp, pg.sessionId, `document.getElementById('a').dataset.ready === '1'`), 10000, 'blob 音频就绪');
      await evalIn(cdp, pg.sessionId, `document.getElementById('a').play().catch(() => {})`);
      // 注册表副本里加一个带 liveEndpoint 的测试引擎，并切到它
      await evalIn(cdp, pg.sessionId, `window.MT_STT_ENGINES.push({ id: 'e2e_live', type: 'transcribe-compat', label: 'e2e', needsKey: false, supportsKey: false, supportsBaseUrl: true, supportsModel: false, requiresEndpoint: false, defaultEndpoint: ${JSON.stringify(base + '/v1/audio/transcriptions')}, placeholder: null, defaultModel: 'x', liveEndpoint: ${JSON.stringify('ws://127.0.0.1:' + srv.address().port + '/live')}, liveType: 'ws-realtime', liveModel: 'live', liveRate: 16000, liveKeyProtocol: 'e2e-key.', uploadEndpoint: null }); 'ok'`, pg.isoId);
      await evalIn(cdp, swSession, `chrome.storage.local.set({ sttEngine: 'e2e_live', sttBaseUrl: '' })`);
      await sleep(600);
      await evalIn(cdp, pg.sessionId, `PodcastTranslator.enable({ provider: 'custom_chat', apiKey: 'k', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', targetLang: 'zh-CN' }); 'ok'`, pg.isoId);
      await waitFor(() => evalIn(cdp, pg.sessionId, `!!document.querySelector('#mt-pod-overlay .mt-pod-trans-action')`), 30000, 'B: 转写入口按钮');
      await evalIn(cdp, pg.sessionId, `document.querySelector('#mt-pod-overlay .mt-pod-trans-action').click(); 'clicked'`);
      let orig;
      try {
        // 双显：叠层放流式 partial，整句定稿在历史面板里 —— 判据读面板的行
        orig = await waitFor(() => evalIn(cdp, pg.sessionId, `(() => { const rows = document.querySelectorAll('#mt-pod-history .mt-pod-history-orig'); return rows.length ? rows[rows.length - 1].textContent : ''; })()`), 40000, 'B: 历史面板出现定稿整句');
      } catch (e) {
        const notice = await evalIn(cdp, pg.sessionId, `(document.querySelector('#mt-pod-overlay .mt-pod-trans') || {}).textContent || ''`);
        throw new Error(`${e.message}；叠层提示「${notice}」；ws 握手 ${stats.wsOpened} 帧 ${stats.wsFrames}；页面异常 ${pg.errs.slice(0, 2).join(' | ')}`);
      }
      const overlayNow = await evalIn(cdp, pg.sessionId, `(document.querySelector('#mt-pod-overlay .mt-pod-orig') || {}).textContent || ''`);
      const rowCount = await evalIn(cdp, pg.sessionId, `document.querySelectorAll('#mt-pod-history .mt-pod-history-row').length`);
      notes.push(`B: 面板定稿「${orig}」（${rowCount} 行）；叠层此刻「${overlayNow}」；服务端收到 ${stats.wsFrames} 帧 / ${stats.wsAudioBytes} 字节 PCM，握手 ${stats.wsOpened} 次`);
      if (orig.indexOf('Hello from the live fake.') < 0 && orig.indexOf('Second sentence here.') < 0) problems.push(`B: 面板定稿不是流式回的句子：「${orig}」`);
      if (rowCount < 1) problems.push('B: 历史面板没有行');
      if (stats.wsFrames < 20 || stats.wsAudioBytes < 20 * 1000) problems.push(`B: 抓流没有真正把 PCM 送到端点（${stats.wsFrames} 帧 / ${stats.wsAudioBytes} 字节）`);
      const notice = await evalIn(cdp, pg.sessionId, `(document.querySelector('#mt-pod-overlay .mt-pod-trans') || {}).textContent || ''`);
      if (/捕获不到声音|No sound/.test(notice)) problems.push('B: 静音守卫误触发（抓到的是静音）');
      if (pg.errs.length) problems.push('B: 页面异常 ' + pg.errs.slice(0, 2).join(' | '));
      await cdp.send('Target.closeTarget', { targetId: pg.targetId });
    }
  } catch (e) {
    problems.push(e.message);
  } finally {
    try { cdp.close(); } catch (_) {}
    chrome.cleanup();
    srv.close();
  }
  for (const n of notes) console.log('  ' + n);
  if (problems.length) { for (const p of problems) console.log('✗ ' + p); process.exit(1); }
  console.log('✓ test:asr — 文件一档与流式一档都在真 Chrome 里出了字幕');
})().catch((e) => { console.error('✗ ' + (e.stack || e.message)); process.exit(1); });
