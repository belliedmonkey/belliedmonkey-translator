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
    // 裁定 A（2026-09-07）：门没过时入口**灰掉 + 一句原因**，不是消失
    const before = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const b = document.getElementById('app-listen-entry2'); const n = document.getElementById('app-listen-need-live2'); return { hidden: b.hidden, disabled: b.disabled, need: n ? !n.hidden : null }; })())`));
    need(before.hidden === false && before.disabled === true && before.need === true, 'A: 未配引擎时入口本该可见但灰掉、原因句可见，实际 ' + JSON.stringify(before));
    await evalIn(cdp, sessionId, `(async () => {
      window.MT_STT_ENGINES.push({ id: 'e2e_live', type: 'transcribe-compat', label: 'e2e', needsKey: false, supportsKey: false, supportsBaseUrl: true, supportsModel: false, requiresEndpoint: false,
        defaultEndpoint: ${JSON.stringify(base + '/v1/audio/transcriptions')}, placeholder: null, defaultModel: 'x',
        liveEndpoint: ${JSON.stringify('ws://127.0.0.1:' + srv.address().port + '/live')}, liveType: 'ws-realtime', liveModel: 'live', liveRate: 16000, liveKeyProtocol: 'e2e-key.', uploadEndpoint: null });
      await new Promise((r) => chrome.storage.local.set({ sttEngine: 'e2e_live', sttApiKey: 'k', provider: 'custom_chat', apiKey: 'x', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', uiLang: 'zh-CN', listenOtherLang: 'en' }, r));
      await AppListen.refreshEntry();
      return 'ok';
    })()`);
    const after = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('app-listen-entry2').hidden, disabled: document.getElementById('app-listen-entry2').disabled, need: !document.getElementById('app-listen-need-live2').hidden })`));
    need(after.hidden === false && after.disabled === false && after.need === false, 'A: 配好实时引擎后入口本该可用、原因句藏起，实际 ' + JSON.stringify(after));

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

    // ── B2. 准备中 → 听：granted 之后才是 listening；空历史有引导句 ──
    const phaseB = await evalIn(cdp, sessionId, `AppListen._debug().phase`);
    need(phaseB === 'listening', 'B: 定稿出现时应已是 listening，实际 ' + phaseB);

    // ── W. macOS 宽屏（≥ 720px）：左右两栏 —— 历史在「当下」卡右边、不在下边；「复制全文」随定稿出现 ──
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(300);
    const wide = JSON.parse(await evalIn(cdp, sessionId, `(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const n = r('app-listen-now'), h = r('app-listen-history-wrap'); const cp = document.getElementById('app-listen-copy'); return JSON.stringify({ nowRight: n.right, histLeft: h.left, nowTop: n.top, histTop: h.top, copyHidden: cp.hidden, copyText: cp.textContent }); })()`));
    need(wide.histLeft >= wide.nowRight - 1 && Math.abs(wide.histTop - wide.nowTop) < 4, 'W: 900px 宽时历史应在当下卡右侧同一行，实际 ' + JSON.stringify(wide));
    need(wide.copyHidden === false && wide.copyText.length > 0, 'W: 有定稿时「复制全文」应可见，实际 ' + JSON.stringify(wide));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(300);
    const narrow = JSON.parse(await evalIn(cdp, sessionId, `(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const n = r('app-listen-now'), h = r('app-listen-history-wrap'); return JSON.stringify({ nowBottom: n.bottom, histTop: h.top }); })()`));
    need(narrow.histTop >= narrow.nowBottom - 1, 'W: 390px 宽时历史应回到当下卡下方，实际 ' + JSON.stringify(narrow));
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);

    // ── C. 按住「我说」：真指针按住 → 期间到的句子归我 → 松手**留在本页**，历史加行 + 译成对方语言 ──
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
    const meRow0 = await waitFor(async () => {
      const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((AppListen._debug().rows || []).filter((x) => x.who === 'me').map((x) => ({ text: x.text, tr: x.tr })))`));
      return (r.length === 1 && r[0].tr) ? r : null;
    }, 8000, '松手后历史里出现带译文的「我」行');
    need(meRow0[0].text === '我要去机场' && meRow0[0].tr === '译：我要去机场', 'C: 「我」行文本/译文不对：' + JSON.stringify(meRow0));
    const stateC = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, flipHidden: document.getElementById('app-listen-flip').hidden })`));
    need(stateC.phase === 'listening', 'C: 松手后应留在本页回到 listening，实际 ' + stateC.phase);
    need(stateC.flipHidden === true, 'C: 松手后不该自动弹出展示卡（裁定：给对方看 = 点历史行）');
    const domC = await evalIn(cdp, sessionId, `document.getElementById('app-listen-history').textContent`);
    need(domC.includes('我：我要去机场') && domC.includes('给对方看'), 'C: 「我」行该带「我：」前缀与「给对方看」');
    need(!domC.includes('朗读') , 'C: 没有 TTS 引擎时「朗读」不该出现（能力语义）');
    // 点历史行 → 展示卡（外语大字 + 中文小字），底下照常在听；点关闭
    await evalIn(cdp, sessionId, `(document.querySelector('#app-listen-history .listen-row.me .listen-body').click(), 'ok')`);
    const show = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('app-listen-flip').hidden, text: document.getElementById('app-listen-flip-text').textContent, sub: document.getElementById('app-listen-flip-sub').textContent, again: document.getElementById('app-listen-flip-again').hidden, phase: AppListen._debug().phase })`));
    need(!show.hidden && show.text === '译：我要去机场' && show.sub === '我要去机场', 'C: 展示卡该是外语大字 + 中文小字，实际 ' + JSON.stringify(show));
    need(show.again === true, 'C: 没有 TTS 引擎时展示卡上不该有「朗读」');
    need(show.phase === 'listening', 'C: 展示时底下该照常在听，实际 ' + show.phase);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-flip-back').click(), 'ok')`);
    const closed = await evalIn(cdp, sessionId, `document.getElementById('app-listen-flip').hidden`);
    need(closed === true, 'C: 「关闭」后展示卡该收起');
    // 暂停态下也能按住我说（它自己起麦克风）
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-toggle').click(), 'ok')`);
    const paused = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, spk: document.getElementById('app-listen-speak').disabled, tog: document.getElementById('app-listen-toggle').textContent })`));
    need(paused.phase === 'paused' && paused.spk === false, 'C: 暂停态下「按住 · 我说」该可用，实际 ' + JSON.stringify(paused));
    // 历史长了，按钮位置变了：重新量一次再按
    const box2 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(document.getElementById('app-listen-speak').getBoundingClientRect())`));
    const cx2 = Math.round(box2.x + box2.width / 2), cy2 = Math.round(box2.y + box2.height / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx2, y: cy2 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx2, y: cy2, button: 'left', clickCount: 1 }, sessionId);
    await sleep(400);
    const held2 = await evalIn(cdp, sessionId, `AppListen._debug().phase`);
    need(held2 === 'speaking', 'C: 暂停态下按住应进入 speaking，实际 ' + held2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx2, y: cy2, button: 'left', clickCount: 1 }, sessionId);
    const back = await waitFor(async () => { const p = await evalIn(cdp, sessionId, `AppListen._debug().phase`); return p === 'listening' ? p : null; }, 8000, '松手后回到 listening');
    need(back === 'listening', 'C: 松手后应回到 listening，实际 ' + back);

    // ── C2. 「返回」在会话中先确认（页内对话框，不是 window.confirm —— App 里那个恒为 false）──
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    const dlg = await waitFor(async () => JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ mask: !!document.querySelector('.ld-mask'), msg: (document.querySelector('.ld-msg') || {}).textContent || '', ok: (document.querySelector('.ld-ok') || {}).textContent || '' })`)), 3000, '返回时出现页内确认框');
    need(dlg.mask && dlg.msg.includes('还在听') && dlg.ok === '结束并离开', 'C2: 确认框文案不对：' + JSON.stringify(dlg));
    await evalIn(cdp, sessionId, `(document.querySelector('.ld-cancel').click(), 'ok')`);
    await sleep(200);
    const stay = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ mask: !!document.querySelector('.ld-mask'), hidden: document.getElementById('app-listen').hidden, phase: AppListen._debug().phase })`));
    need(!stay.mask && stay.hidden === false && stay.phase === 'listening', 'C2: 取消后该留在页面上继续听，实际 ' + JSON.stringify(stay));

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
    const endedUi = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ actions: document.getElementById('app-listen-actions').hidden, now: document.getElementById('app-listen-now').hidden, rows: document.querySelectorAll('#app-listen-history .listen-row').length })`));
    need(endedUi.actions === true && endedUi.now === true && endedUi.rows === 2, 'E: 结束后两个大按钮与上卡该收起、历史留着，实际 ' + JSON.stringify(endedUi));
    // 结束后返回不再确认，直接回首页
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(300);
    const home = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ mask: !!document.querySelector('.ld-mask'), listenHidden: document.getElementById('app-listen').hidden, outShown: !document.getElementById('signed-out').hidden })`));
    need(!home.mask && home.listenHidden && home.outShown, 'E: 结束后「返回」该直接回首页，实际 ' + JSON.stringify(home));
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
  console.log('\n✓ 对话 · 实时听译端到端：入口门控 / 听 / 按住我说（留在本页）/ 点行放大 / 暂停态按住 / 语料 conv / 加星 / 结束小结 全部通过');
  process.exit(0);
})();
