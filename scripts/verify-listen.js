#!/usr/bin/env node
// scripts/verify-listen.js — 「对话 · 实时听译」（learning-design §9.6）真 Chrome 端到端。
// npm run test:listen。Node ≥22。
//
// 为什么要它：模拟器的麦克风是 0 字节、cua 的按住手势到不了 WKWebView 的 pointerdown、
// 真机被 iPhone 镜像占着麦克风 —— 三条路都验不了「按住我说 → 松手翻面 → 进语料 → 小结」
// 这条链。真 Chrome 用假麦克风（--use-fake-device-for-media-stream）+ 本机假流式端点 +
// 本机假翻译端点，CDP 发真指针事件，链路上每一步都能读回。
//
// 与 test:asr 同一纪律：假端点必须是真 localhost 服务器（不是 CDP mock），断言看**请求**
// 与**语料**，不只看界面。翻译不花钱、不上网。
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));

const SRC = path.join(ROOT, 'dist-app');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => { console.log('\n✗ 超时（90s），没有结论'); process.exit(2); }, 90000).unref();

// ─── 假端点：dist-app 静态 + /v1/chat/completions + ws /live + /say 控制口 ───────
const stats = { chatCalls: 0, chatTexts: [], wsOpened: 0, wsFrames: 0, wsAudioBytes: 0 };
let sockets = [];
function serve() {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/v1/chat/completions' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        stats.chatCalls++;
        let user = ''; try { const j = JSON.parse(body); user = (j.messages.find((x) => x.role === 'user') || {}).content || ''; } catch (_) {}
        stats.chatTexts.push(String(user));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '译：' + String(user).slice(0, 60) } }] }));
      });
      return;
    }
    // 控制口：让假转写端点立刻「听到」一句 —— 测试由此决定哪句在按住期间到达
    if (u === '/say' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const words = String(body).split(' ').map((w, i) => (i ? ' ' : '') + w);
        for (const send of sockets) {
          let i = 0;
          const t = setInterval(() => { if (i >= words.length) { clearInterval(t); return; } send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'x', delta: words[i++] }); }, 40);
        }
        res.writeHead(200); res.end('ok');
      });
      return;
    }
    // dist-app：出货的包布局（Main.html 在 Base.lproj/，Script.js 在根）
    const rel = u === '/' ? '/Base.lproj/Main.html' : u;
    const name = path.basename(rel);
    const okFile = (name === 'Main.html' && rel.startsWith('/Base.lproj/')) || ((name === 'Script.js' || name === 'Style.css') && !rel.startsWith('/Base.lproj/'));
    if (!okFile) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'text/plain' });
    res.end(fs.readFileSync(path.join(SRC, name)));
  });
  // ws-realtime 形状的假端点（RFC 6455 最小实现，同 verify-asr.js）
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
      else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(payload.length, 2); }
      try { socket.write(Buffer.concat([head, payload])); } catch (_) {}
    };
    sockets.push(send);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 0x80, maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const data = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(off + maskLen + len);
        if (op === 8) { sockets = sockets.filter((s) => s !== send); socket.end(); return; }
        if (op === 1 && fin) {
          let m; try { m = JSON.parse(data.toString('utf8')); } catch (_) { continue; }
          if (m.type === 'session.update') send({ type: 'session.updated', session: m.session });
          else if (m.type === 'input_audio_buffer.append') { stats.wsFrames++; stats.wsAudioBytes += Math.floor((m.audio || '').length * 3 / 4); }
        }
      }
    });
    socket.on('close', () => { sockets = sockets.filter((s) => s !== send); });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function evalIn(cdp, sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error('evaluate: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
  return r.result ? r.result.value : undefined;
}
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`超时 ${ms}ms：${label}`); await sleep(200); }
}
function say(base, text) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + '/say', { method: 'POST' }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.end(text);
  });
}

(async () => {
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) { console.error(`✗ dist-app/${f} 不存在 —— 先跑 node build.js`); process.exit(1); }
  }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const problems = [];
  const need = (c, msg) => { if (!c) problems.push(msg); };
  let cdp, sessionId;
  try {
    cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    sessionId = (await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
    await cdp.send('Runtime.enable', {}, sessionId);
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => problems.push('EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: base + '/Base.lproj/Main.html' }, sessionId);
    await sleep(2000);

    // ── 0. 假原生桥：按 app/native-audio.js 的协议回话（mic-pcm / mic-state / session-ready）──
    // 出货的采集就是这条路（原生 tap → 桥 → JS）；页内 getUserMedia 只是无桥宿主的退路，
    // 而且假麦克风在这台机器的 Chrome 里挂着不落定。假桥每 100 ms 送 1600 个 16 kHz 的
    // 正弦样本（有声，静音守卫不会触发），mic-stop 就停。
    await evalIn(cdp, sessionId, `(() => {
      const st = { timer: 0, started: 0, stopped: 0 };
      window.__fakeBridge = st;
      const emit = (m) => window.NativeAudio && window.NativeAudio._fromNative(m);
      const pcm = () => { const n = 1600, b = new Uint8Array(n * 2); for (let i = 0; i < n; i++) { const v = Math.round(8000 * Math.sin(i / 3)); b[2 * i] = v & 255; b[2 * i + 1] = (v >> 8) & 255; } let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
      window.webkit = { messageHandlers: { mtAudio: { postMessage(msg) {
        if (msg.type === 'session-start') setTimeout(() => emit({ type: 'session-ready', platform: 'macos', suspends: false }), 0);
        else if (msg.type === 'mic-start') { st.started++; setTimeout(() => emit({ type: 'mic-state', state: 'granted' }), 0); clearInterval(st.timer); st.timer = setInterval(() => emit({ type: 'mic-pcm', b64: pcm() }), 100); }
        else if (msg.type === 'mic-stop') { st.stopped++; clearInterval(st.timer); st.timer = 0; setTimeout(() => emit({ type: 'mic-state', state: 'ended' }), 0); }
      } } } };
      return 'ok';
    })()`);

    // ── A. 门控：没配转写引擎时入口不存在；配好实时引擎 + 翻译端点后出现 ──
    const before = await evalIn(cdp, sessionId, `(() => { const b = document.getElementById('app-listen-entry2'); return b ? b.hidden : null; })()`);
    need(before === true, 'A: 未配引擎时入口本该不存在（hidden），实际 ' + before);
    await evalIn(cdp, sessionId, `(async () => {
      window.MT_STT_ENGINES.push({ id: 'e2e_live', type: 'transcribe-compat', label: 'e2e', needsKey: false, supportsKey: false, supportsBaseUrl: true, supportsModel: false, requiresEndpoint: false,
        defaultEndpoint: ${JSON.stringify(base + '/v1/audio/transcriptions')}, placeholder: null, defaultModel: 'x',
        liveEndpoint: ${JSON.stringify('ws://127.0.0.1:' + srv.address().port + '/live')}, liveType: 'ws-realtime', liveModel: 'live', liveRate: 16000, liveKeyProtocol: 'e2e-key.', uploadEndpoint: null });
      await new Promise((r) => chrome.storage.local.set({ sttEngine: 'e2e_live', sttApiKey: 'k', provider: 'custom_chat', apiKey: 'x', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', uiLang: 'zh-CN', listenOtherLang: 'en' }, r));
      await AppListen.refreshEntry();
      return 'ok';
    })()`);
    const after = await evalIn(cdp, sessionId, `document.getElementById('app-listen-entry2').hidden`);
    need(after === false, 'A: 配好实时引擎后入口本该出现');

    // ── B. 开始听：socket 真开、PCM 真到、定稿 + 译文进历史 ──
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-entry2').click(), 'ok')`);
    await waitFor(() => stats.wsOpened >= 1 && stats.wsFrames >= 10, 15000, 'socket 打开且收到 ≥10 帧 PCM');
    await say(base, 'Does this bus go to the airport?');
    const rowB = await waitFor(async () => {
      const r = await evalIn(cdp, sessionId, `JSON.stringify((AppListen._debug().rows || []).map((x) => ({ who: x.who, text: x.text, tr: x.tr })))`);
      const rows = JSON.parse(r); const hit = rows.find((x) => x.text === 'Does this bus go to the airport?' && x.tr);
      return hit || null;
    }, 10000, '定稿句带译文进历史');
    need(rowB.who === 'them', 'B: 没按住时的句子该归对方，实际 ' + rowB.who);
    need(rowB.tr === '译：Does this bus go to the airport?', 'B: 译文该来自假翻译端点，实际 ' + rowB.tr);
    need(stats.chatCalls >= 1, 'B: 翻译端点没收到请求');
    const domB = await evalIn(cdp, sessionId, `document.getElementById('app-listen-history').textContent`);
    need(domB.includes('Does this bus go to the airport?') && domB.includes('译：'), 'B: 历史 DOM 里没有原文 + 译文');

    // ── C. 按住「我说」：真指针按住 → 期间到的句子归我 → 松手翻面 + 译成对方语言 ──
    const box = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(document.getElementById('app-listen-speak').getBoundingClientRect())`));
    const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 }, sessionId);
    await sleep(300);
    const holding = await evalIn(cdp, sessionId, `AppListen._debug().phase`);
    need(holding === 'speaking', 'C: 按住后应进入 speaking，实际 ' + holding);
    await say(base, '我要去机场');
    await sleep(700);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 }, sessionId);
    const flip = await waitFor(async () => {
      const r = await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('app-listen-flip').hidden, text: document.getElementById('app-listen-flip-text').textContent, sub: document.getElementById('app-listen-flip-sub').textContent, phase: AppListen._debug().phase })`);
      const o = JSON.parse(r); return (!o.hidden && o.text.startsWith('译：')) ? o : null;
    }, 8000, '松手后翻面卡出现且带译文');
    need(flip.sub === '我要去机场', 'C: 翻面卡小字该是我说的中文，实际 ' + flip.sub);
    need(flip.text === '译：我要去机场', 'C: 翻面卡大字该是译文，实际 ' + flip.text);
    const meRow = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((AppListen._debug().rows || []).filter((x) => x.who === 'me').map((x) => ({ text: x.text, tr: x.tr })))`));
    need(meRow.length === 1 && meRow[0].text === '我要去机场' && meRow[0].tr === '译：我要去机场', 'C: 历史里该有恰好一行「我」，实际 ' + JSON.stringify(meRow));
    const domC = await evalIn(cdp, sessionId, `document.getElementById('app-listen-history').textContent`);
    need(domC.includes('我：我要去机场'), 'C: 历史 DOM 里「我」行该带「我：」前缀');
    // 翻面卡点任意处返回听
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-flip-back').click(), 'ok')`);
    const back = await evalIn(cdp, sessionId, `AppListen._debug().phase`);
    need(back === 'listening', 'C: 「继续听对方」后应回到 listening，实际 ' + back);

    // ── D. 语料：定稿译文到达 ⇒ 写一次，来源 conv、锚点 conv；加星 ⇒ starred ──
    const items = JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allItems().then((a) => JSON.stringify(a.map((x) => ({ text: x.text, tr: x.tr, sourceId: x.sourceId, anchor: x.anchor, starred: x.starred, lang: x.lang }))))`));
    const them = items.find((x) => x.text === 'Does this bus go to the airport?');
    const me = items.find((x) => x.text === '译：我要去机场');
    need(!!them, 'D: 对方说的句子没进语料');
    need(!!me, 'D: 我说的句子（外语面 = 译文）没进语料');
    if (them) {
      need(them.sourceId.startsWith('conv:'), 'D: 来源该是 conv:<id>，实际 ' + them.sourceId);
      need(them.anchor && them.anchor.k === 'conv' && them.anchor.who === 'them', 'D: 锚点该是 k:conv/who:them，实际 ' + JSON.stringify(them.anchor));
      need(them.lang === 'en', 'D: 对方句子的 lang 该是「对方的语言」en，实际 ' + them.lang);
    }
    if (me) need(me.anchor && me.anchor.who === 'me' && me.tr === '我要去机场', 'D: 我说的卡该 who:me、tr=中文');
    const srcs = JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allSources().then((a) => JSON.stringify(a.filter((s) => String(s.url).startsWith('conv://'))))`));
    need(srcs.length === 1 && /对话 · \d{4}-\d{2}-\d{2}/.test(srcs[0].title), 'D: 该有一条 conv:// 来源且标题带日期，实际 ' + JSON.stringify(srcs));
    // 加星：点第一行的 ☆ → 语料里 starred
    await evalIn(cdp, sessionId, `(document.querySelector('#app-listen-history .listen-star').click(), 'ok')`);
    const starred = await waitFor(async () => JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allItems().then((a) => JSON.stringify(a.some((x) => x.text === 'Does this bus go to the airport?' && x.starred)))`)), 5000, '加星写进语料');
    need(starred === true, 'D: 加星没写进语料');

    // ── E. 结束：小结数字与历史一致；socket 关了；再开始是新会话 ──
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-end').click(), 'ok')`);
    const sum = await evalIn(cdp, sessionId, `document.getElementById('app-listen-summary-body').textContent`);
    need(/对方说了 1 句/.test(sum) && /我说了 1 句/.test(sum) && /2 句 · 含 1 句加星/.test(sum), 'E: 小结数字不对：' + sum);
    await sleep(500);
    need(sockets.length === 0, 'E: 结束后 socket 该关闭，实际还开着 ' + sockets.length);
    const summaryShown = await evalIn(cdp, sessionId, `!document.getElementById('app-listen-summary').hidden`);
    need(summaryShown === true, 'E: 结束态该显示小结');
    const fb = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ started: __fakeBridge.started, stopped: __fakeBridge.stopped, timer: __fakeBridge.timer })`));
    need(fb.started >= 1 && fb.stopped >= fb.started && !fb.timer, 'E: 结束后原生桥该收到 mic-stop（started ' + fb.started + ' / stopped ' + fb.stopped + '）');
  } catch (e) {
    problems.push('THROW ' + (e && e.stack));
    // 失败时把页面状态一并读回，别让人猜
    try { problems.push('STATE ' + await evalIn(cdp, sessionId, `JSON.stringify({ d: AppListen._debug(), note: (document.getElementById('app-listen-note') || {}).textContent, pill: (document.getElementById('app-listen-pill') || {}).textContent })`)); } catch (_) {}
  }
  finally { try { cdp && cdp.close(); } catch (_) {} chrome.cleanup(); srv.close(); }

  console.log(`  假端点：socket ${stats.wsOpened} 次 · PCM ${stats.wsFrames} 帧 / ${(stats.wsAudioBytes / 1024).toFixed(0)} KB · 翻译请求 ${stats.chatCalls} 次`);
  if (problems.length) { console.log('\n✗ 对话 · 实时听译端到端有问题：\n  - ' + problems.join('\n  - ')); process.exit(1); }
  console.log('\n✓ 对话 · 实时听译端到端：入口门控 / 听 / 按住我说 → 翻面 / 语料 conv / 加星 / 结束小结 全部通过');
  process.exit(0);
})();
