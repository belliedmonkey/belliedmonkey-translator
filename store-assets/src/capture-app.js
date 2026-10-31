#!/usr/bin/env node
// store-assets/src/capture-app.js —— 拍商店图里 App 自己的两屏：「对话 · 实时听译」与「实时字幕」（1.11.0 起的主打）。
//
//   国际版（dist-app）       → assets/{en,zh}-{phone,tablet,desk}-{listen,subs}.png
//   中国版（dist-app-china） → ../../screenshots-cn/src/assets/cn-{phone,tablet,desk}-{listen,subs}.png
//
// 实拍纪律同 capture.js：真 Chrome 打开**出货的 App 包**（Base.lproj/Main.html 布局），走真实界面流程。
// 缺的只有环境，全部照 scripts/verify-listen.js 的做法补：
//   · 原生音频桥 —— 按 app/native-audio.js 协议回话的假桥（mic-state granted、每 100 ms 一帧 PCM）；
//   · 转写端点 —— 本机 ws-realtime 假端点，/say 让它逐词吐出一句；
//   · 翻译端点 —— 本机假 chat，按原文查下面这张写好的对照表回译文。
// 句子与译文是写好的（同 capture.js 的 SEED 语料），界面、排版、归属判断、翻译方向都是产品自己跑出来的。
// Mac 悬浮字幕条与 iPhone 画中画是原生窗口，这里拍不到 —— 那两张走真机（见 ../README.md）。
//
//   node build.js && node build.js --flavor china
//   node store-assets/src/capture-app.js                              # 全部
//   node store-assets/src/capture-app.js --flavor global --lang en --tier desk --shot listen
'use strict';
const path = require('path'), fs = require('fs'), http = require('http'), crypto = require('crypto');
const ROOT = path.join(__dirname, '../..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const argv = process.argv.slice(2);
const pick = (flag, all) => { const i = argv.indexOf(flag); return i < 0 ? all : argv[i + 1].split(','); };
const FLAVORS = pick('--flavor', ['global', 'china']);
const LANGS = pick('--lang', ['en', 'zh']);
const TIERS = pick('--tier', ['phone', 'tablet', 'desk']);
const SHOTS = pick('--shot', ['listen', 'subs']);
const METRICS = {   // 与 capture.js 同一套档位
  phone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
  tablet: { width: 1032, height: 1376, deviceScaleFactor: 2, mobile: true },
  desk: { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 语料：对话是一段商务洽谈（双方各说各的语言），字幕是一段外语视频的独白 ──
// 每条只放**一句**：App 按句末标点切句，一条里有两句会被拆成两行，而对照表按整句查（试拍时踩到过）。
const PAIRS = [
  ['Thanks for coming, did you find the office easily?', '谢谢你过来，办公室好找吗？'],
  ['Could we start with the delivery schedule?', '我们先从交货时间谈起好吗？'],
  ['We can ship the first batch next Tuesday.', '我们下周二可以发出第一批货。'],
  ['Does the quoted price include shipping?', '报价包含运费吗？'],
  ['It covers freight and insurance but not customs duties.', '包含运费和保险，但不含关税。'],
  // 平板两栏：右栏要够高才不留半屏空白，所以多备几句（仍然一行一句，否则会被拆成两行）
  ['Could you send us a revised quote by Friday?', '您能在周五前把修改后的报价发给我们吗？'],
  ['Sure, and we can offer five percent off for larger orders.', '没问题，大批量订单我们可以优惠百分之五。'],
  ['What are your usual payment terms?', '你们通常的付款条件是什么？'],
  ['We usually ask for thirty percent in advance.', '我们一般要求预付百分之三十。'],
];
const MONO = [
  ['The best way to learn a language is to use it every day.', '学语言最好的办法，是每天都用它。'],
  ['Even ten minutes of listening can make a real difference.', '哪怕每天只听十分钟，也会有明显的变化。'],
  ['Try to notice whole phrases instead of single words.', '试着留意整句话，而不只是单个的词。'],
  ['Mistakes are simply part of how you improve.', '犯错本来就是进步的一部分。'],
  ['Reading aloud helps you remember new expressions.', '大声朗读能帮你记住新的表达。'],
  ['Pick topics you actually care about.', '挑你真正感兴趣的话题。'],
  ['Short daily sessions beat long weekly ones.', '每天短短练一会儿，胜过每周练很久。'],
  ['Review what you learned before going to bed.', '睡前把学过的内容复习一遍。'],
  ['Real conversations teach what textbooks cannot.', '真实的对话，能教会课本教不了的东西。'],
  ['Over time, understanding starts to feel natural.', '慢慢地，听懂会变成一件自然的事。'],
];
const DICT = new Map();
for (const [en, zh] of [...PAIRS, ...MONO]) { DICT.set(en, zh); DICT.set(zh, en); }
// 语种安排：中文商店图 = 我说中文、对方说英文、视频是英文；英文商店图反过来（给英语用户看的是「我说英文」）。
const PLAN = {
  zh: { ui: 'zh-CN', my: 'zh', other: 'en', video: 'en', talk: PAIRS.map((p, i) => p[i % 2 ? 1 : 0]), subs: MONO.map((p) => p[0]) },
  en: { ui: 'en', my: 'en', other: 'zh', video: 'zh', talk: PAIRS.map((p, i) => p[i % 2 ? 0 : 1]), subs: MONO.map((p) => p[1]) },
};

// ── 假端点：App 包静态 + /v1/chat/completions + ws /live + /say ──
function serve(src) {
  let sockets = [];
  const stats = { wsOpened: 0, wsFrames: 0, chat: 0 };
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/v1/chat/completions' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        stats.chat++;
        let user = '';
        try { user = (JSON.parse(body).messages.find((x) => x.role === 'user') || {}).content || ''; } catch (_) {}
        // 半句（上卡的临时译文）按整句译文截同样比例：否则查不到就原样回声，上卡两行一模一样
        const t = String(user).trim();
        const whole = [...DICT.keys()].find((k) => k !== t && k.startsWith(t));
        const tr = DICT.get(t) || (whole ? [...DICT.get(whole)].slice(0, Math.ceil([...DICT.get(whole)].length * [...t].length / [...whole].length)).join('') : t);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: tr } }] }));
      });
      return;
    }
    if (u === '/say' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const text = String(body);
        // 英文按词吐，中文按两个字一段吐（真转写端点就是这样一截一截给半句的）
        const parts = /\s/.test(text) ? text.split(' ').map((w, i) => (i ? ' ' : '') + w) : text.match(/.{1,2}/gu);
        for (const send of sockets) {
          let i = 0;
          const t = setInterval(() => { if (i >= parts.length) { clearInterval(t); return; } send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'x', delta: parts[i++] }); }, 45);
        }
        res.writeHead(200); res.end('ok');
      });
      return;
    }
    const rel = u === '/' ? '/Base.lproj/Main.html' : u;
    const name = path.basename(rel);
    const okFile = (name === 'Main.html' && rel.startsWith('/Base.lproj/')) || ((name === 'Script.js' || name === 'Style.css') && !rel.startsWith('/Base.lproj/'));
    if (!okFile) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(name)] || 'text/plain' });
    res.end(fs.readFileSync(path.join(src, name)));
  });
  srv.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/live')) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
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
          else if (m.type === 'input_audio_buffer.append') stats.wsFrames++;
        }
      }
    });
    socket.on('close', () => { sockets = sockets.filter((s) => s !== send); });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, stats })));
}

// 页面加载前注入：假桥（caps 按档位：桌面 = Mac 系统声音；手机 / 平板 = iPhone 麦克风听外放）、转写引擎登记、预置设置
function preload({ base, port, plan, tier }) {
  const mac = tier === 'desk';
  const caps = mac ? { sources: ['mic', 'system'], system: 'ok', broadcast: 'unsupported' } : { sources: ['mic'], system: 'unsupported', broadcast: 'unsupported' };
  const engine = { id: 'cap_live', type: 'transcribe-compat', label: 'cap', needsKey: false, supportsKey: false, supportsBaseUrl: true, supportsModel: false, requiresEndpoint: false,
    defaultEndpoint: base + '/v1/audio/transcriptions', placeholder: null, defaultModel: 'x',
    liveEndpoint: `ws://127.0.0.1:${port}/live`, liveType: 'ws-realtime', liveModel: 'live', liveRate: 16000, liveKeyProtocol: 'cap-key.', uploadEndpoint: null };
  const set = {
    sttEngine: 'cap_live', sttApiKey: 'k', provider: 'custom_chat', apiKey: 'x', apiBaseUrl: base + '/v1/chat/completions', apiModel: 'm',
    uiLang: plan.ui, listenMyLang: plan.my, listenOtherLang: plan.other, subtitleVideoLang: plan.video,
    listenAutoSpeak: false, listenCapture: false, subtitleCapture: false,
    extBannerDoneAt: Date.now(), extObSeen: true,   // 「扩展还没启用」横幅：真用户点过「我已打开」就不再出现
    onboardSeen: true,                               // 首启引导卡：真用户走过一次就不再出现（试拍时它压在对话页上面）
  };
  return `
    (() => { let v; Object.defineProperty(window, 'MT_STT_ENGINES', { configurable: true, get() { return v; },
      set(x) { v = x; if (Array.isArray(x) && !x.some((e) => e.id === 'cap_live')) x.push(${JSON.stringify(engine)}); } }); })();
    try { for (const [k, val] of Object.entries(${JSON.stringify(set)})) localStorage.setItem('mt:' + k, JSON.stringify(val)); } catch (_) {}
    (() => {
      const st = { timer: 0, caps: ${JSON.stringify(caps)} };
      window.__capBridge = st;
      const emit = (m) => window.NativeAudio && window.NativeAudio._fromNative(m);
      const pcm = () => { const n = 1600, b = new Uint8Array(n * 2); for (let i = 0; i < n; i++) { const s = Math.round(8000 * Math.sin(i / 3)); b[2 * i] = s & 255; b[2 * i + 1] = (s >> 8) & 255; } let r = ''; for (let i = 0; i < b.length; i++) r += String.fromCharCode(b[i]); return btoa(r); };
      window.webkit = { messageHandlers: { mtAudio: { postMessage(msg) {
        if (msg.type === 'caps-probe') setTimeout(() => emit(Object.assign({ type: 'audio-caps' }, st.caps)), 0);
        else if (msg.type === 'session-start') setTimeout(() => emit({ type: 'session-ready', platform: ${JSON.stringify(mac ? 'macos' : 'ios')}, suspends: ${mac ? 'false' : 'true'} }), 0);
        else if (msg.type === 'mic-start') { setTimeout(() => emit({ type: 'mic-state', state: 'granted', source: msg.source || 'mic' }), 0); clearInterval(st.timer); st.timer = setInterval(() => emit({ type: 'mic-pcm', b64: pcm() }), 100); }
        else if (msg.type === 'mic-stop') { clearInterval(st.timer); st.timer = 0; setTimeout(() => emit({ type: 'mic-state', state: 'ended' }), 0); }
      } } } };
    })();`;
}

(async () => {
  const JOBS = [];
  for (const flavor of FLAVORS) {
    const src = path.join(ROOT, flavor === 'china' ? 'dist-app-china' : 'dist-app');
    if (!fs.existsSync(path.join(src, 'Main.html'))) throw new Error(`${path.relative(ROOT, src)} 不存在 —— 先 node build.js${flavor === 'china' ? ' --flavor china' : ''}`);
    for (const lang of flavor === 'china' ? ['zh'] : LANGS) for (const tier of TIERS) for (const shot of SHOTS) JOBS.push({ flavor, src, lang, tier, shot });
  }
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const cdp = await CDP.connect(chrome.port);
  setTimeout(() => { console.log('timeout'); process.exit(1); }, 900000).unref();
  const servers = {};
  let fails = 0;
  for (const job of JOBS) {
    const { flavor, src, lang, tier, shot } = job;
    if (!servers[flavor]) servers[flavor] = await serve(src);
    const { srv, stats } = servers[flavor];
    const port = srv.address().port, base = `http://127.0.0.1:${port}`;
    const plan = PLAN[lang];
    const outDir = flavor === 'china' ? path.join(ROOT, 'screenshots-cn/src/assets') : path.join(__dirname, 'assets');
    const name = `${flavor === 'china' ? 'cn' : lang}-${tier}-${shot}.png`;
    // 每张图一个新标签页：预置脚本按档位与语种各不相同，不能叠在同一个页上
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result && r.result.value;
    };
    const waitFor = async (fn, ms, label) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('超时：' + label); await sleep(200); } };
    const say = (text) => new Promise((resolve, reject) => { const q = http.request(base + '/say', { method: 'POST' }, (r) => { r.resume(); r.on('end', resolve); }); q.on('error', reject); q.end(text); });
    try {
      await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride', METRICS[tier], sessionId);
      // 真机上滚动条只在滚的那一下出现；截图里常驻一根灰条是穿帮
      await cdp.send('Emulation.setScrollbarsHidden', { hidden: true }, sessionId);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: preload({ base, port, plan, tier }) }, sessionId);
      await cdp.send('Page.navigate', { url: base + '/Base.lproj/Main.html' }, sessionId);
      await sleep(2500);
      await ev(`(async () => { await AppListen.refreshEntry(); return 'ok'; })()`); await sleep(500);
      const opened = stats.wsOpened;
      const entry = shot === 'listen' ? 'app-listen-entry2' : 'app-subs-entry2';
      const ent = await ev(`(() => { const b = document.getElementById(${JSON.stringify(entry)}); return b ? { hidden: b.hidden, disabled: b.disabled } : null; })()`);
      if (!ent || ent.hidden || ent.disabled) throw new Error(`入口不可用 ${entry} ${JSON.stringify(ent)}`);
      await ev(`(document.getElementById(${JSON.stringify(entry)}).click(), 'ok')`); await sleep(800);
      // 对话入口点下去即开始；字幕入口停在准备态，要按「开始」
      if (shot === 'subs') await ev(`(async () => { await AppListen.start(); return 'ok'; })()`);
      await waitFor(() => stats.wsOpened > opened && stats.wsFrames > 5, 15000, 'socket 打开且收到 PCM');
      // 手机单栏一屏只放得下三行：多了定稿列表自己往下滚，首行被切掉半截。
      // 最后一句只喂前半截、不等它定稿就拍 —— 上卡是「当下」，空着就是一张没在工作的截图。
      const full = shot === 'listen' ? plan.talk : plan.subs;
      // 定稿行数按档位定，都是「不溢出定稿列表」的最多行数 —— 溢出了列表自己滚到最新，首行被切掉半截。
      // 对话行带「给对方看」链接、比字幕行高。手机单栏：两行 / 三行；桌面：四行 / 三行；
      // 平板两栏的右栏最高，行少了下半屏全是空白：七行 / 九行。最后一句都只喂半截当「当下」。
      const n = tier === 'phone' ? (shot === 'listen' ? 2 : 3)
        : tier === 'desk' ? (shot === 'listen' ? 4 : 3)
          : Math.min(full.length - 1, shot === 'listen' ? 7 : 9);
      const lines = full.slice(0, n);
      for (let i = 0; i < lines.length; i++) {
        await say(lines[i]);
        // 等**这一句**整句定稿并带上对照表里的译文，再喂下一句 —— 只数行数的话，半句先定稿会让下一句提前开始，两句粘成一行
        const head = [...lines[i]].slice(0, 10).join('');
        await waitFor(async () => JSON.parse(await ev(`JSON.stringify((AppListen._debug().rows || []).some((x) => String(x.text || '').includes(${JSON.stringify(head)}) && x.tr && x.tr !== x.text))`)), 20000, `第 ${i + 1} 句定稿带译文`);
        await sleep(1500);
      }
      await sleep(1200);
      if (full[n]) {
        const next = full[n];
        const half = /\s/.test(next)
          ? next.split(' ').slice(0, Math.ceil(next.split(' ').length * 0.6)).join(' ')
          : [...next].slice(0, Math.ceil([...next].length * 0.6)).join('');
        await say(half);
        await waitFor(async () => String(await ev(`(document.getElementById('app-listen-partial') || {}).textContent || ''`)).length >= [...half].length - 2, 8000, '半句出现在上卡');
        await sleep(900);
      }
      // 手机 / 平板是单栏：把定稿列表滚进首屏（真用户往下看就是这一屏）；桌面两栏整页都在首屏
      // 上面留的边不超过与上一个可见元素的间距：留多了，截图顶上会露出半行被切开的字
      if (tier !== 'desk') await ev(`(() => {
        const h = document.getElementById('app-listen-now'); if (!h) return 'ok';
        let p = h.previousElementSibling; while (p && !p.getClientRects().length) p = p.previousElementSibling;
        const top = h.getBoundingClientRect().top + window.scrollY;
        const gap = p ? top - (p.getBoundingClientRect().bottom + window.scrollY) : 12;
        window.scrollTo(0, top - Math.max(0, Math.min(12, gap - 1)));
        return 'ok';
      })()`);
      await sleep(500);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'));
      const rows = JSON.parse(await ev(`JSON.stringify((AppListen._debug().rows || []).map((x) => (x.who || '') + ':' + String(x.tr || '').slice(0, 14)))`));
      console.log('captured', path.relative(ROOT, path.join(outDir, name)), rows.join(' | '));
      await ev(`(() => { try { AppListen.end(); } catch (_) {} return 'ok'; })()`).catch(() => {});
    } catch (e) {
      fails++; console.error('✗', name, e.message);
    } finally {
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }
  for (const s of Object.values(servers)) s.srv.close();
  chrome.cleanup();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
