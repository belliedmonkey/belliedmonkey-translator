#!/usr/bin/env node
// scripts/verify-listen.js — 「对话 · 实时听译」与「实时字幕」（learning-design §9.6 / §9.8）真 Chrome 端到端。
// npm run test:listen。Node ≥22。
//
// 为什么要它：模拟器的麦克风是 0 字节、cua 的按住手势到不了 WKWebView 的 pointerdown、
// 真机被 iPhone 镜像占着麦克风 —— 三条路都验不了「听 → 定稿 → 修正 + 译 → 进语料 → 小结」
// 这条链。真 Chrome 里注入两个按出货协议回话的假原生桥（mtAudio 采集、mtSpeech 本机识别 /
// 朗读）+ 本机假翻译端点，CDP 发真指针事件，链路上每一步都能读回。
//
// 2026-09-17 起转写只有本机路（learning-design §9.6 门控修订）：这里原来还有一个 RFC 6455
// 假流式端点喂云端路的转写，随云端实时档一起删了。假翻译端点必须是真 localhost 服务器
// （不是 CDP mock），断言看**请求**与**语料**，不只看界面。翻译不花钱、不上网。
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));

const SRC = path.join(ROOT, 'dist-app');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => { console.log('\n✗ 超时（150s），没有结论'); process.exit(2); }, 150000).unref();

// ─── 假端点：dist-app 静态 + /v1/chat/completions ─────────────────────────────
const stats = { chatCalls: 0, chatTexts: [], chatDirs: [], passCalls: 0, fail401: false };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/v1/chat/completions' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        stats.chatCalls++;
        // T 段：端点整个拒绝（企业网关 / 过期 key 的形状）—— 看 translate_fail 发不发、发几条。
        if (stats.fail401) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); return; }
        let user = '', sys = '';
        try {
          const j = JSON.parse(body);
          user = (j.messages.find((x) => x.role === 'user') || {}).content || '';
          sys = (j.messages.find((x) => x.role === 'system') || {}).content || '';
        } catch (_) {}
        stats.chatTexts.push(String(user));
        // 提示词把目标语言明文写进 system（"…into English."），抓出来就知道这次翻译往哪个方向
        // —— ↔ 改边那条断言唯一的判据。
        stats.chatDirs.push(((sys.match(/into ([^.]+)\./) || [])[1] || '?').trim());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 本机路的「修正 + 翻译」一次调用（§9.6.1）：system 是 correction stage，回 T:/X: 两行。
        // 假修正只认一个错：「几搂」→「几楼」——够断言 raw / text / tr 三者的关系。
        if (/correction stage/.test(sys)) {
          stats.passCalls++;
          const sent = (String(user).split('Transcript sentence:\n')[1] || '').trim();
          const fixed = sent.replace('几搂', '几楼');
          res.end(JSON.stringify({ choices: [{ message: { content: 'T: ' + fixed + '\nX: 译：' + fixed } }] }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ message: { content: '译：' + String(user).slice(0, 60) } }] }));
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

// 两个假原生桥。页面 reload 之后要重装（M 段），所以抽成函数。
const FAKE_BRIDGES = `(() => {
  // mtAudio（app/native-audio.js 的协议）：msgs 记收到的每条消息；caps 给了才回 caps-probe（没给 = 老原生壳）。
  // 假麦克风每 100 ms 发一次电平（本机路 deliver:'level'，PCM 留在原生侧）。
  // zero:true ⇒ 假麦克风照常按时发帧，但**电平恒零**：模拟采集链路死掉（#420 那次
  // ScreenCaptureKit 就是这样 —— 报告成功、样本全零），与「环境安静」是两回事。
  const st = { timer: 0, started: 0, stopped: 0, msgs: [], caps: null, zero: false };
  window.__fakeBridge = st;
  const emitA = (m) => window.NativeAudio && window.NativeAudio._fromNative(m);
  const zeroPcm = () => { const n = 1600; let s = ''; for (let i = 0; i < n * 2; i++) s += String.fromCharCode(0); return btoa(s); };
  const pcm = () => { const n = 1600, b = new Uint8Array(n * 2); for (let i = 0; i < n; i++) { const v = Math.round(8000 * Math.sin(i / 3)); b[2 * i] = v & 255; b[2 * i + 1] = (v >> 8) & 255; } let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  window.webkit = { messageHandlers: { mtAudio: { postMessage(msg) {
    st.msgs.push(msg);
    if (msg.type === 'caps-probe') { if (st.caps) setTimeout(() => emitA(Object.assign({ type: 'audio-caps' }, st.caps)), 0); }
    else if (msg.type === 'session-start') setTimeout(() => emitA({ type: 'session-ready', platform: 'macos', suspends: false }), 0);
    else if (msg.type === 'mic-start') { st.started++; st.deliver = msg.deliver || 'pcm'; setTimeout(() => emitA(st.holdGrant ? { type: 'mic-state', state: 'waiting', reason: 'waiting-permission', source: msg.source || 'mic' } : { type: 'mic-state', state: 'granted' }), 0); clearInterval(st.timer);
      st.timer = setInterval(() => emitA(st.deliver === 'level' ? { type: 'mic-level', rms: st.zero ? 0 : 0.2 } : { type: 'mic-pcm', b64: st.zero ? zeroPcm() : pcm() }), 100); }
    else if (msg.type === 'mic-stop') { st.stopped++; clearInterval(st.timer); st.timer = 0; setTimeout(() => emitA({ type: 'mic-state', state: 'ended' }), 0); }
  } } } };
  // mtSpeech（app/native-speech.js 的协议）：本机识别 + 本机朗读。os:'old' ⇒ stt-probe 回 unsupported/os。
  const fs = { os: 'new', started: 0, stopped: 0, lastLocales: null, assets: 'installed' };
  window.__fakeSpeech = fs;
  const emit = (m) => window.NativeSpeech && window.NativeSpeech._fromNative(m);
  fs.say = (locale, text, conf) => { emit({ type: 'stt-partial', locale, text, conf }); emit({ type: 'stt-final', locale, text, conf, alts: [], t0: 0, t1: 1000 }); };
  window.webkit.messageHandlers.mtSpeech = { postMessage(msg) {
    if (msg.type === 'stt-probe') {
      if (fs.os === 'old') { setTimeout(() => emit({ type: 'stt-state', state: 'unsupported', reason: 'os' }), 0); return; }
      setTimeout(() => { for (const l of msg.locales) emit({ type: 'assets-progress', kind: 'stt', locale: l, fraction: fs.assets === 'installed' ? 1 : 0, state: fs.assets }); emit({ type: 'stt-state', state: 'ready', assets: fs.assets, supported: ['zh-CN', 'zh-TW', 'yue-CN', 'en-US', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR', 'it-IT'] }); }, 0);
    } else if (msg.type === 'stt-assets') {
      setTimeout(() => { for (const l of msg.locales) { emit({ type: 'assets-progress', kind: 'stt', locale: l, fraction: 0.5, state: 'downloading' }); emit({ type: 'assets-progress', kind: 'stt', locale: l, fraction: 1, state: 'installed' }); } fs.assets = 'installed'; emit({ type: 'stt-state', state: 'ready', assets: 'installed' }); }, 50);
    } else if (msg.type === 'stt-start') { fs.started++; fs.lastLocales = msg.locales; setTimeout(() => emit({ type: 'stt-state', state: 'ready' }), 0); }
    else if (msg.type === 'stt-stop') { fs.stopped++; setTimeout(() => emit({ type: 'stt-state', state: 'ended' }), 0); }
    else if (msg.type === 'tts-probe') { fs.ttsModels = msg.models; setTimeout(() => emit({ type: 'tts-state', state: fs.ttsReady ? 'ready' : 'assets', langs: fs.ttsReady ? ['zh', 'en'] : [] }), 0); }
    else if (msg.type === 'tts-assets') { fs.ttsDownloads = (fs.ttsDownloads || 0) + 1; (fs.assetsUrls = fs.assetsUrls || []).push(msg.models.map((m) => m.files[0].url)); fs.lastAssetsSha = msg.models.map((m) => m.files[0].sha256);
      if (fs.ttsFailNext > 0) { fs.ttsFailNext--; setTimeout(() => { emit({ type: 'assets-progress', kind: 'tts', locale: 'zh', fraction: 0, state: 'failed', reason: 'fake' }); emit({ type: 'tts-state', state: 'failed', reason: 'download', langs: [] }); }, 50); }
      else setTimeout(() => { emit({ type: 'assets-progress', kind: 'tts', locale: 'zh', fraction: 0.5, state: 'downloading' }); fs.ttsReady = true; emit({ type: 'tts-state', state: 'ready', langs: ['zh', 'en'] }); }, 50); }
    else if (msg.type === 'url-probe') { (fs.probed = fs.probed || []).push(msg.url); setTimeout(() => emit({ type: 'url-probe', id: msg.id, ok: fs.probeOk !== false, status: fs.probeOk !== false ? 206 : 0 }), 0); }
    else if (msg.type === 'tts-speak') { (fs.spoken = fs.spoken || []).push({ id: msg.id, text: msg.text, lang: msg.lang }); setTimeout(() => { emit({ type: 'tts-start', id: msg.id }); emit({ type: 'tts-end', id: msg.id }); }, 30); }
    else if (msg.type === 'tts-stop') { fs.ttsStops = (fs.ttsStops || 0) + 1; }
  } };
  // §9.6.1.1：离线模型下载地址由后端表决定 —— 这里接一个假后端（默认 srv / 备用 alt），ModelSources 只吃它，不碰真 Supabase
  window.__fakeSources = { fail: false, asked: 0, rows: [ { path: 'piper-zh.zip', url: 'https://srv.example/piper-zh.zip', url_alt: 'https://alt.example/piper-zh.zip', sha256: 'EVIL' }, { path: 'piper-en.zip', url: 'https://srv.example/piper-en.zip', url_alt: 'https://alt.example/piper-en.zip' } ] };
  if (window.ModelSources) ModelSources.configure({ backend: { url: 'https://fake-backend.example', anonKey: 'k' }, fetch: async (u) => { __fakeSources.asked++; __fakeSources.lastUrl = u; if (__fakeSources.fail) throw new Error('net'); return { ok: true, json: async () => __fakeSources.rows }; } });
  return 'ok';
})()`;

(async () => {
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) { console.error(`✗ dist-app/${f} 不存在 —— 先跑 node build.js`); process.exit(1); }
  }
  // dist-app 是**构建产物**。只检查它存在是不够的：2026-09-08 实测，删掉了一个按钮却
  // 没重新构建，这个脚本照旧跑旧包、照旧打印「全部通过」—— 一个宣称验证了某功能的测试，
  // 在那个功能被删掉之后仍然是绿的。产物比源文件旧 ⇒ 当场停，不给绿。
  {
    const built = fs.statSync(path.join(SRC, 'Main.html')).mtimeMs;
    const srcs = ['app/index.html', 'app/listen.js', 'app/listen-core.js', 'app/settings.js',
      'app/app.js', 'app/style.css', 'app/native-audio.js', 'app/native-speech.js', 'extension/content/learn-rules.js', 'extension/learn/tts.js',
      'extension/learn/sources-view.js', 'extension/learn/review.js'];
    const stale = srcs.filter((f) => {
      const q = path.join(ROOT, f);
      return fs.existsSync(q) && fs.statSync(q).mtimeMs > built;
    });
    if (stale.length) {
      console.error('✗ dist-app 比源文件旧，跑下去只会验到旧代码 —— 先跑 node build.js\n  比它新的：' + stale.join(' '));
      process.exit(1);
    }
  }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const problems = [];
  const need = (c, msg) => { if (!c) problems.push(msg); };
  let cdp, sessionId;
  // 假识别器「听到」一句：两路识别器各自吐 partial + final（locale 决定归属，§9.6.1）
  const say = (locale, text, conf = 0.95) => evalIn(cdp, sessionId, `(__fakeSpeech.say(${JSON.stringify(locale)}, ${JSON.stringify(text)}, ${conf}), 'ok')`);
  const rowsOf = async () => JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((AppListen._debug().rows || []).map((x) => ({ who: x.who, guessed: x.guessed, pinned: x.pinned, text: x.text, raw: x.raw, tr: x.tr, temp: !!x.trTemp, err: !!x.trErr })))`));
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

    // ── 0. 两个假原生桥 + 翻译端点配置（转写引擎**不配**：对话不再看它）──
    await evalIn(cdp, sessionId, FAKE_BRIDGES);
    // 遥测探针（telemetry-design §3.4）：自动化里 MTTelemetry 是空操作（navigator.webdriver），
    // 所以这里看的是**调用有没有走到**，不是队列。白名单那一半由 T 段拿注册表核。
    await evalIn(cdp, sessionId, `(() => { window.__tm = []; MTTelemetry.track = (n, p) => { __tm.push({ n, p: p || {} }); return Promise.resolve(true); }; return 'ok'; })()`);
    await evalIn(cdp, sessionId, `(async () => {
      await new Promise((r) => chrome.storage.local.set({ sttEngine: '', sttApiKey: '', provider: 'custom_chat', apiKey: 'x', apiBaseUrl: ${JSON.stringify(base + '/v1/chat/completions')}, apiModel: 'm', uiLang: 'zh-CN', listenOtherLang: 'en' }, r));
      await AppListen.refreshEntry();
      return 'ok';
    })()`);

    // ── A. 门控只看本机识别器（2026-09-17）：没配任何转写引擎也可用；旧系统 ⇒ 灰 + 具名，且没有「去设置」──
    const a1 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const b = document.getElementById('app-listen-entry2'); const n = document.getElementById('app-listen-need-live2'); const p = document.getElementById('modes-privacy2'); return { hidden: b.hidden, disabled: b.disabled, need: n ? !n.hidden : null, priv: p.textContent, privHidden: p.hidden }; })())`));
    need(a1.hidden === false && a1.disabled === false && a1.need === false, 'A: 桥探到 ready、没配转写引擎 ⇒ 入口该可用，实际 ' + JSON.stringify(a1));
    need(!a1.privHidden && /不发往任何服务器|设备上识别/.test(a1.priv), 'A: 隐私句该是本机版，实际 ' + JSON.stringify(a1.priv));
    await evalIn(cdp, sessionId, `(async () => { await new Promise((r) => chrome.storage.local.set({ sttEngine: 'openai_transcribe', sttApiKey: 'k' }, r)); await AppListen.refreshEntry(); return 'ok'; })()`);
    const a2 = await evalIn(cdp, sessionId, `document.getElementById('app-listen-entry2').disabled`);
    need(a2 === false, 'A: 说题的转写槽配成什么都不影响对话入口（两个槽从此无关）');
    await evalIn(cdp, sessionId, `(async () => { __fakeSpeech.os = 'old'; await AppListen.refreshEntry(); return 'ok'; })()`);
    const a3 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const b = document.getElementById('app-listen-entry2'); const n = document.getElementById('app-listen-need-live2'); const w = document.getElementById('app-listen-need-live-why2'); const g = document.getElementById('app-listen-need-live-go2'); return { disabled: b.disabled, needShown: n && !n.hidden, why: w && w.textContent, goHidden: g ? g.hidden : null }; })())`));
    need(a3.disabled === true && a3.needShown === true && /iOS 26/.test(a3.why || ''), 'A: 旧系统该灰掉入口并说「需要 iOS 26 / macOS 26」，实际 ' + JSON.stringify(a3));
    need(a3.goHidden === true, 'A: 系统版本不是配置问题，不该有「去设置里选择」按钮，实际 ' + JSON.stringify(a3));
    need(!/云端/.test(a3.why || ''), 'A: 不许再指人去「选一个云端实时引擎」—— 没有那条路了');
    await evalIn(cdp, sessionId, `(async () => { __fakeSpeech.os = 'new'; await AppListen.refreshEntry(); return 'ok'; })()`);
    need((await evalIn(cdp, sessionId, `document.getElementById('app-listen-entry2').disabled`)) === false, 'A: 系统恢复后入口该重新可用');

    // ── B. 开始听：麦克风只要电平、识别器起两路（zh-CN + en-US）、定稿 + 译文进历史 ──
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-entry2').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'B: 进入 listening');
    const b0 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ deliver: __fakeBridge.deliver, started: __fakeSpeech.started, locales: __fakeSpeech.lastLocales, cost: document.getElementById('app-listen-cost').textContent })`));
    need(b0.deliver === 'level', 'B: mic-start 该带 deliver:level（PCM 留在原生），实际 ' + JSON.stringify(b0));
    need(b0.started === 1 && JSON.stringify(b0.locales) === JSON.stringify(['zh-CN', 'en-US']), 'B: 该按我方/对方各开一路（zh-CN, en-US），实际 ' + JSON.stringify(b0));
    need(/不离开设备/.test(b0.cost), 'B: 费用行该说「音频不离开设备」，实际 ' + b0.cost);
    await say('en-US', 'Does this bus go to the airport?');
    const rowB = await waitFor(async () => { const rows = await rowsOf(); return rows.find((x) => x.text === 'Does this bus go to the airport?' && x.tr && !x.temp) || null; }, 10000, '定稿句带译文进历史');
    need(rowB.who === 'them', 'B: en 路的句子该归对方，实际 ' + rowB.who);
    need(rowB.tr === '译：Does this bus go to the airport?', 'B: 译文该来自假端点的 X: 行，实际 ' + rowB.tr);
    need(stats.chatCalls >= 1 && stats.passCalls >= 1, 'B: 翻译端点没收到「修正 + 翻译」请求');
    const domB = await evalIn(cdp, sessionId, `document.getElementById('app-listen-history').textContent`);
    need(domB.includes('Does this bus go to the airport?') && domB.includes('译：'), 'B: 历史 DOM 里没有原文 + 译文');
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

    // ── C. 归属按识别器 locale 判 + ↔ 改边（**全程不按任何键**）──────────────────
    await say('zh-CN', '我要去机场，末班车几点？', 0.93);
    const rows2 = await waitFor(async () => { const r = await rowsOf(); return (r.length === 2 && r[1].tr && !r[1].temp) ? r : null; }, 8000, '第二句（中文）定稿并带译文');
    need(rows2[0].who === 'them' && rows2[1].who === 'me', 'C: en 路该归对方、zh 路该归我，实际 ' + JSON.stringify(rows2.map((x) => x.who)));
    need(rows2[0].guessed === false && rows2[1].guessed === false, 'C: 归属来自 locale，不该标成「猜的」，实际 ' + JSON.stringify(rows2.map((x) => x.guessed)));
    need(rows2[1].text === '我要去机场，末班车几点？' && rows2[1].tr === '译：我要去机场，末班车几点？', 'C: 我说的那行文本/译文不对：' + JSON.stringify(rows2[1]));
    // 方向：对方那句译成我的语言，我这句译成对方的语言 —— 两次调用的方向必须相反
    const dirs = stats.chatDirs.slice(0, 2);
    need(dirs.length === 2 && dirs[0] !== dirs[1] && dirs[0] !== '?' && dirs[1] !== '?', 'C: 两句的翻译方向该相反，实际 ' + JSON.stringify(stats.chatDirs));
    const domC = await evalIn(cdp, sessionId, `document.getElementById('app-listen-history').textContent`);
    need(domC.includes('对方') && domC.includes('我'), 'C: 每行该有归属标，实际 ' + domC.slice(0, 120));
    const swapN = await evalIn(cdp, sessionId, `document.querySelectorAll('#app-listen-history .listen-swap').length`);
    need(swapN === 2, 'C: 每行该有一个 ↔，实际 ' + swapN);
    const shN = await evalIn(cdp, sessionId, `[...document.querySelectorAll('#app-listen-history .listen-act')].filter((b) => b.textContent === '给对方看').length`);
    need(shN === 2, 'C: 两边的行都该有「给对方看」，实际 ' + shN);
    need(!domC.includes('朗读'), 'C: 没有 TTS 引擎时「朗读」不该出现（能力语义）');
    // ↔ 改边：我说的那行改成对方说的 ⇒ 重译方向反过来（等**新方向的翻译真的发出去了**，不是「有译文」）
    const dirsBefore = stats.chatDirs.length;
    await evalIn(cdp, sessionId, `(document.querySelectorAll('#app-listen-history .listen-swap')[1].click(), 'ok')`);
    const flipped = await waitFor(async () => { if (stats.chatDirs.length <= dirsBefore) return null; const r = await rowsOf(); return (r[1].who === 'them' && r[1].tr) ? r : null; }, 8000, '改边后按新方向重译完成');
    need(flipped[1].pinned === true && flipped[1].guessed === false, 'C: 改边后该被钉住，实际 ' + JSON.stringify(flipped[1]));
    need(stats.chatDirs[stats.chatDirs.length - 1] === dirs[0], 'C: 改边后该按对方那句的方向重译（译成我的语言），实际 ' + JSON.stringify(stats.chatDirs));
    await evalIn(cdp, sessionId, `(document.querySelectorAll('#app-listen-history .listen-swap')[1].click(), 'ok')`);
    const backToMe = await waitFor(async () => { const r = await rowsOf(); return (r[1].who === 'me' && r[1].tr === '译：我要去机场，末班车几点？') ? r : null; }, 8000, '改回「我说的」并重译');
    need(!!backToMe, 'C: ↔ 该能来回改');

    // ── C2. 「返回」在会话中先确认（页内对话框，不是 window.confirm —— App 里那个恒为 false）──
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    const dlg = await waitFor(async () => JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ mask: !!document.querySelector('.ld-mask'), msg: (document.querySelector('.ld-msg') || {}).textContent || '', ok: (document.querySelector('.ld-ok') || {}).textContent || '' })`)), 3000, '返回时出现页内确认框');
    need(dlg.mask && dlg.msg.includes('还在听') && dlg.ok === '结束并离开', 'C2: 确认框文案不对：' + JSON.stringify(dlg));
    await evalIn(cdp, sessionId, `(document.querySelector('.ld-cancel').click(), 'ok')`);
    await sleep(200);
    const stay = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ mask: !!document.querySelector('.ld-mask'), hidden: document.getElementById('app-listen').hidden, phase: AppListen._debug().phase })`));
    need(!stay.mask && stay.hidden === false && stay.phase === 'listening', 'C2: 取消后该留在页面上继续听，实际 ' + JSON.stringify(stay));
    // ── C3. 「这次不留记录」在会话中灰掉时屏上必须有原因 ──
    const eph = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const cb = document.getElementById('app-listen-ephemeral'); const why = document.getElementById('app-listen-ephemeral-why'); return { disabled: cb.disabled, checked: cb.checked, whyVisible: !!(why && !why.hidden && why.getClientRects().length), why: why ? why.textContent : null }; })())`));
    need(eph.disabled && !eph.checked && eph.whyVisible && /结束再重开|先结束/.test(eph.why || ''), 'C3: 「这次不留记录」会话中灰掉却没有原因行，实际 ' + JSON.stringify(eph));

    // ── D. 语料：定稿译文到达 ⇒ 写一次，来源 conv、锚点 conv；加星 ⇒ starred ──
    const items = JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allItems().then((a) => JSON.stringify(a.map((x) => ({ text: x.text, tr: x.tr, sourceId: x.sourceId, anchor: x.anchor, starred: x.starred, lang: x.lang }))))`));
    const them = items.find((x) => x.text === 'Does this bus go to the airport?');
    const me = items.find((x) => x.text === '译：我要去机场，末班车几点？');
    need(!!them, 'D: 对方说的句子没进语料');
    need(!!me, 'D: 我说的句子（外语面 = 译文）没进语料');
    if (them) {
      need(them.sourceId.startsWith('conv:'), 'D: 来源该是 conv:<id>，实际 ' + them.sourceId);
      need(them.anchor && them.anchor.k === 'conv' && them.anchor.who === 'them', 'D: 锚点该是 k:conv/who:them，实际 ' + JSON.stringify(them.anchor));
      need(them.lang === 'en', 'D: 对方句子的 lang 该是「对方的语言」en，实际 ' + them.lang);
    }
    if (me) need(me.anchor && me.anchor.who === 'me' && me.tr === '我要去机场，末班车几点？', 'D: 我说的卡该 who:me、tr=中文');
    const srcs = JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allSources().then((a) => JSON.stringify(a.filter((s) => String(s.url).startsWith('conv://'))))`));
    need(srcs.length === 1 && /对话 · \d{4}-\d{2}-\d{2}/.test(srcs[0].title), 'D: 该有一条 conv:// 来源且标题带日期，实际 ' + JSON.stringify(srcs));
    await evalIn(cdp, sessionId, `(document.querySelector('#app-listen-history .listen-star').click(), 'ok')`);
    const starred = await waitFor(async () => JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allItems().then((a) => JSON.stringify(a.some((x) => x.text === 'Does this bus go to the airport?' && x.starred)))`)), 5000, '加星写进语料');
    need(starred === true, 'D: 加星没写进语料');

    // ── E. 结束：小结数字与历史一致；识别器停了；再开始是新会话 ──
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-end').click(), 'ok')`);
    const sum = await evalIn(cdp, sessionId, `document.getElementById('app-listen-summary-body').textContent`);
    need(/对方说了 1 句/.test(sum) && /我说了 1 句/.test(sum) && /2 句 · 含 1 句加星/.test(sum), 'E: 小结数字不对：' + sum);
    const endedUi = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ actions: document.getElementById('app-listen-actions').hidden, now: document.getElementById('app-listen-now').hidden, rows: document.querySelectorAll('#app-listen-history .listen-row').length })`));
    need(endedUi.actions === true && endedUi.now === true && endedUi.rows === 2, 'E: 结束后两个大按钮与上卡该收起、历史留着，实际 ' + JSON.stringify(endedUi));
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(300);
    const home = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ mask: !!document.querySelector('.ld-mask'), listenHidden: document.getElementById('app-listen').hidden, outShown: !document.getElementById('signed-out').hidden })`));
    need(!home.mask && home.listenHidden && home.outShown, 'E: 结束后「返回」该直接回首页，实际 ' + JSON.stringify(home));
    await sleep(500);
    const e1 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ started: __fakeSpeech.started, stopped: __fakeSpeech.stopped, mStarted: __fakeBridge.started, mStopped: __fakeBridge.stopped, timer: __fakeBridge.timer })`));
    need(e1.stopped >= e1.started, 'E: 结束后识别器该收到 stt-stop，实际 ' + JSON.stringify(e1));
    need(e1.mStarted >= 1 && e1.mStopped >= e1.mStarted && !e1.timer, 'E: 结束后原生桥该收到 mic-stop，实际 ' + JSON.stringify(e1));
    need((await evalIn(cdp, sessionId, `!document.getElementById('app-listen-summary').hidden`)) === true, 'E: 结束态该显示小结');

    // ── T. 用量事件真的走得到（telemetry-design §3.3 裁定 1、§3.4）──────────────────
    // 09-16 裁定「App 听译出译文 ⇒ translate_ok{kind:'subtitle'}」只进了文档没进代码：1.12.x 有
    // 7 台开始了听译、0 条译文事件，而每一道门禁都是绿的。静态门禁（npm test 的 seams）证明
    // 「有调用」，这一段证明「走得到」，并钉住**每会话一次**（上面那一场定稿了两句）。
    const TM = require('../build/telemetry.config.js').EVENTS;
    const tmOf = async (name) => JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__tm)`)).filter((e) => e.n === name);
    const inList = (ev) => Object.keys(ev.p).every((k) => k in TM[ev.n] && (!Array.isArray(TM[ev.n][k]) || TM[ev.n][k].includes(ev.p[k])));
    const okEv = await tmOf('translate_ok');
    need(okEv.length === 1, 'T: 一场听译（两句定稿）该恰好 1 条 translate_ok，实际 ' + JSON.stringify(okEv));
    need(okEv[0] && okEv[0].p.kind === 'subtitle' && okEv[0].p.provider === 'custom_chat' && Number.isInteger(okEv[0].p.ms) && inList(okEv[0]), 'T: translate_ok 该是 {provider, kind:subtitle, ms:int} 且全在白名单里，实际 ' + JSON.stringify(okEv[0]));
    need((await tmOf('translate_fail')).length === 0, 'T: 译文都成功的一场不该有 translate_fail');
    // 失败的一场：端点 401，连说两句 ⇒ 两行都落「译文失败 · 重试」，而 translate_fail **只发 1 条**
    // （每会话每个 code 一条 —— 网页侧一段一条，5 天里 308 条 401 来自同一台机器，§3.1）。
    stats.fail401 = true;
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-entry2').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'T: 进入 listening');
    await say('en-US', 'Where is the ticket office?');
    await waitFor(async () => (await rowsOf()).find((x) => x.text === 'Where is the ticket office?' && x.err) || null, 20000, 'T: 第一句落「译文失败」');
    await say('en-US', 'Is there a later train?');
    await waitFor(async () => (await rowsOf()).find((x) => x.text === 'Is there a later train?' && x.err) || null, 20000, 'T: 第二句落「译文失败」');
    const failEv = await tmOf('translate_fail');
    need(failEv.length === 1, 'T: 同一场两句同码失败该恰好 1 条 translate_fail，实际 ' + JSON.stringify(failEv));
    need(failEv[0] && failEv[0].p.provider === 'custom_chat' && failEv[0].p.status === 401 && inList(failEv[0]), 'T: translate_fail 该带 provider / code（白名单内）/ status:401，实际 ' + JSON.stringify(failEv[0]));
    need((await tmOf('translate_ok')).length === 1, 'T: 失败的一场不该多出 translate_ok');
    stats.fail401 = false;
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-end').click(), 'ok')`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(800);

    // ── F. 自动朗读 + 回声闸：自己读出去的话被录回来，必须**整句丢掉** ──────────
    await evalIn(cdp, sessionId, `(() => {
      window.__tts = [];
      window.__origTts = { speak: LearnTTS.speak, stop: LearnTTS.stop, engine: LearnTTS.engine };   // G6 要复原
      window.LearnTTS.engine = () => ({ id: 'e2e_tts' });
      window.LearnTTS.speak = (text, lang) => { window.__tts.push({ text, lang }); return Promise.resolve({ ok: true, done: Promise.resolve() }); };
      window.LearnTTS.stop = () => {};
      return 'ok';
    })()`);
    await evalIn(cdp, sessionId, `new Promise((r) => chrome.storage.local.set({ listenAutoSpeak: true }, r))`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-entry2').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'F: 新会话进入 listening');
    await sleep(100);   // 让上一会话的 ended 回执先到（2026-09-18 起它只销账、不再误杀新会话 —— 这一拍只是让读数稳定）
    await say('en-US', 'Please confirm the price.');
    const spoke = await waitFor(async () => { const a2 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(window.__tts)`)); return a2.length ? a2 : null; }, 8000, 'F: 译文自动朗读');
    need(spoke[0].lang === 'zh' && spoke[0].text === '译：Please confirm the price.', 'F: 对方那句该把译文读给我听（语言 = 我的语言），实际 ' + JSON.stringify(spoke[0]));
    // 把刚读出去的那句原样喂回识别器 —— 这就是回声（文字系以拉丁为主 ⇒ 落在 en 路上）
    const beforeEcho = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ rows: AppListen._debug().rows.length, dropped: AppListen._debug().echoDropped })`));
    const callsBefore = stats.chatCalls;
    await say('en-US', spoke[0].text, 0.9);
    await sleep(2000);
    const afterEcho = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ rows: AppListen._debug().rows.length, dropped: AppListen._debug().echoDropped, tts: window.__tts.length })`));
    need(afterEcho.dropped > beforeEcho.dropped, 'F: 自己朗读的内容回来了却没被回声闸丢掉 —— 这会无限循环。实际 ' + JSON.stringify(afterEcho));
    need(afterEcho.rows === beforeEcho.rows, 'F: 回声不该进历史，实际 ' + JSON.stringify(afterEcho));
    need(stats.chatCalls === callsBefore, 'F: 回声不该触发翻译（那是白花的钱）');
    need(afterEcho.tts === spoke.length, 'F: 回声不该被再读一遍 —— 那就是环的第二跳');
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-end').click(), 'ok')`);
    await sleep(400);

    // ── G. 两路 final 的收法（§9.6.1）：zh 路吐的英文垃圾、en 路吐的低置信拼音都要丢；修正稿替换原文；改语言重连 ──
    if (process.env.TRACE) console.log('  …G');
    await evalIn(cdp, sessionId, `(async () => { LearnTTS.speak = __origTts.speak; LearnTTS.stop = __origTts.stop; LearnTTS.engine = __origTts.engine; await new Promise((r) => chrome.storage.local.set({ listenAutoSpeak: false }, r)); return 'ok'; })()`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-entry2').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'G: 进入 listening');
    const callsG = stats.chatCalls;
    await evalIn(cdp, sessionId, `(() => { const f = __fakeSpeech;
      f.say('zh-CN', 'Where is the mee ting room', 0.88);     // zh 路对英文音频：文字系不对 ⇒ 丢
      f.say('en-US', 'Where is the meeting room?', 0.96);     // 真的
      f.say('en-US', 'Hui, Yi, Shi', 0.2);                    // en 路对中文音频：低置信拼音 ⇒ 丢
      f.say('zh-CN', '会议室在几搂？', 0.93);                   // 真的（带一个同音错字，留给远程修正）
      return 'ok'; })()`);
    const rowsG = await waitFor(async () => { const r = await rowsOf(); return r.length >= 2 && r.every((x) => x.tr && !x.temp) ? r : null; }, 8000, 'G: 两句定稿 + 修正 + 译文');
    need(rowsG.length === 2, 'G: 该只有两行（两条垃圾被丢），实际 ' + JSON.stringify(rowsG));
    need(rowsG[0].who === 'them' && rowsG[0].text === 'Where is the meeting room?' && rowsG[0].guessed === false, 'G: en 路的句子归对方且不是猜的，实际 ' + JSON.stringify(rowsG[0]));
    need(rowsG[1].who === 'me' && rowsG[1].raw === '会议室在几搂？' && rowsG[1].text === '会议室在几楼？' && rowsG[1].tr === '译：会议室在几楼？' && rowsG[1].guessed === false,
      'G: zh 路的句子该先存原文、再换成修正稿、译文来自同一次调用，实际 ' + JSON.stringify(rowsG[1]));
    need(stats.chatCalls >= callsG + 2, 'G: 两句都该走「修正 + 翻译」一次调用，实际 chatCalls ' + (stats.chatCalls - callsG));
    const rawUi = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const b = [...document.querySelectorAll('#app-listen-history .listen-raw-toggle')]; if (!b.length) return { toggles: 0 }; b[0].click(); const rw = document.querySelector('#app-listen-history .listen-raw'); return { toggles: b.length, raw: rw && rw.textContent }; })())`));
    need(rawUi.toggles === 1 && rawUi.raw === '会议室在几搂？', 'G: 修正过的那一行该有「识别原文」可点展开，实际 ' + JSON.stringify(rawUi));
    // 改语言 ⇒ 重连（一路一个 locale）
    await evalIn(cdp, sessionId, `(() => { const s = document.getElementById('app-listen-other'); s.value = 'ja'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    const g4 = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ started: __fakeSpeech.started, stopped: __fakeSpeech.stopped, locales: __fakeSpeech.lastLocales, mic: __fakeBridge.stopped })`)); return r.started >= 3 ? r : null; }, 5000, 'G: 改语言后重连');
    need(JSON.stringify(g4.locales) === JSON.stringify(['zh-CN', 'ja-JP']) && g4.stopped >= 1, 'G: 重连后该是 zh-CN + ja-JP，实际 ' + JSON.stringify(g4));
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-end').click(), 'ok')`);
    await sleep(400);
    await evalIn(cdp, sessionId, `new Promise((r) => chrome.storage.local.set({ listenOtherLang: 'en' }, r))`);

    // ── G6. 设备内置朗读：模型缺失 ⇒ 先进 downloading 下载；定稿译文经原生朗读；清单按 flavor 解开成字符串地址 ──
    if (process.env.TRACE) console.log('  …G6');
    await evalIn(cdp, sessionId, `(async () => {
      LearnTTS.configure({ engineId: 'device', rate: 1 });
      __fakeSpeech.ttsReady = false;
      await new Promise((r) => chrome.storage.local.set({ ttsEngine: 'device', listenAutoSpeak: true, listenOtherLang: 'en' }, r));
      await AppListen.refreshEntry();
      return 'ok';
    })()`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-entry2').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'G6: 下载完模型后进入 listening');
    const g6a = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ dl: __fakeSpeech.ttsDownloads, models: (__fakeSpeech.ttsModels || []).map((m) => [m.lang, typeof m.files[0].url]) })`));
    need(g6a.dl === 1 && JSON.stringify(g6a.models) === JSON.stringify([['zh', 'string'], ['en', 'string']]), 'G6: 该先下载一次模型，清单按 flavor 解成字符串地址，实际 ' + JSON.stringify(g6a));
    await say('en-US', 'Delivery takes forty five days.', 0.97);
    const g6b = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__fakeSpeech.spoken || [])`)); return r.length ? r : null; }, 8000, 'G6: 译文经原生朗读');
    need(g6b[0].lang === 'zh' && g6b[0].text === '译：Delivery takes forty five days.', 'G6: 该把译文按我的语言（zh）交给原生朗读，实际 ' + JSON.stringify(g6b[0]));
    const g6lat = await waitFor(async () => {
      const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ rows: (AppListen._debug().rows || []).map((x) => x.lat || null), sum: AppListen._debug().lat })`));
      return r.rows.length && r.rows.every((l) => l && l.ttsStart != null) ? r : null;
    }, 8000, 'G6: 每行都带 lat 埋点（含 ttsStart）');
    need(g6lat.rows.every((l) => typeof l.final === 'number' && typeof l.pass === 'number' && l.pass >= 0 && l.engine === 'device' && l.ttsEngine === 'device' && typeof l.ttsStart === 'number'),
      'G6: lat 该有 final/pass/engine/ttsStart/ttsEngine，实际 ' + JSON.stringify(g6lat.rows));
    need(g6lat.sum && g6lat.sum.pass && g6lat.sum.pass.n === g6lat.rows.length && typeof g6lat.sum.pass.p50 === 'number' && g6lat.sum.ttsEngines && g6lat.sum.ttsEngines.device === g6lat.rows.length,
      'G6: _debug().lat 该汇总出 pass p50 与朗读引擎计数，实际 ' + JSON.stringify(g6lat.sum));
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-end').click(), 'ok')`);
    await sleep(300);
    await evalIn(cdp, sessionId, `(async () => { await new Promise((r) => chrome.storage.local.set({ ttsEngine: '', listenAutoSpeak: false }, r)); LearnTTS.configure({ engineId: '' }); await AppListen.refreshEntry(); return 'ok'; })()`);

    // ── S. 设置页（learning-design §9.1.1，2026-09-17）：离线模型行五态 / 试听两态 / 识别语言包行 / 语言下拉只列本机支持的 ──
    if (process.env.TRACE) console.log('  …S');
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(300);
    // 朗读引擎下拉是启动时按「桥在不在」填的（本机条目只在桥在时出现）；假桥是页面起来之后才装的，所以重填一次
    await evalIn(cdp, sessionId, `(async () => { __fakeSpeech.ttsReady = false; __fakeSpeech.ttsDownloads = 0; __fakeSpeech.assetsUrls = []; __fakeSpeech.probed = []; __fakeSources.asked = 0; localStorage.removeItem('mt:deviceModelSources'); AppSettings.paintStatic(); document.getElementById('gear').click(); return 'ok'; })()`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `!document.getElementById('app-settings').hidden`)) || null, 5000, 'S: 设置页打开');
    await evalIn(cdp, sessionId, `(document.getElementById('mode-detail').click(), 'ok')`);
    await sleep(200);
    // S1. 语言下拉只列本机识别器支持的语种（探过桥之后）：ar / ru 不在，en / ja 在；会话内的下拉同规则
    const s1 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ settings: [...document.getElementById('listen-other-lang').options].map((o) => o.value), session: [...document.getElementById('app-listen-other').options].map((o) => o.value) })`));
    for (const [name, list] of Object.entries(s1)) {
      need(list.includes('en') && list.includes('ja') && !list.includes('ar') && !list.includes('ru'), 'S1: ' + name + ' 的语言下拉该只列本机支持的（有 en/ja、无 ar/ru），实际 ' + JSON.stringify(list));
    }
    // S2. 识别语言包行：语言包已装 ⇒ 「已就绪」无按钮；缺 ⇒ 「未下载」+ 下载按钮 ⇒ 点了进度 ⇒ 已就绪
    const s2a = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('listen-pack-row').hidden, text: document.getElementById('listen-pack-state').textContent, dl: document.getElementById('listen-pack-dl').hidden })`)); return /已就绪/.test(r.text) ? r : null; }, 5000, 'S2: 语言包行说「已就绪」');
    need(s2a.hidden === false && s2a.dl === true && /zh-CN/.test(s2a.text) && /en-US/.test(s2a.text), 'S2: 已装时该列出 locale、不给下载按钮，实际 ' + JSON.stringify(s2a));
    await evalIn(cdp, sessionId, `(() => { __fakeSpeech.assets = 'missing'; const s = document.getElementById('listen-other-lang'); s.value = 'ja'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    const s2b = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ text: document.getElementById('listen-pack-state').textContent, dl: document.getElementById('listen-pack-dl').hidden, dlText: document.getElementById('listen-pack-dl').textContent })`)); return /未下载/.test(r.text) ? r : null; }, 5000, 'S2: 换语言后语言包行说「未下载」');
    need(s2b.dl === false && s2b.dlText === '下载' && /ja-JP/.test(s2b.text), 'S2: 缺包时该给「下载」按钮并列出新 locale，实际 ' + JSON.stringify(s2b));
    await evalIn(cdp, sessionId, `(document.getElementById('listen-pack-dl').click(), 'ok')`);
    const s2c = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ text: document.getElementById('listen-pack-state').textContent, dl: document.getElementById('listen-pack-dl').hidden, prog: document.getElementById('listen-pack-progress').hidden })`)); return /已就绪/.test(r.text) ? r : null; }, 5000, 'S2: 下载后语言包行回到「已就绪」');
    need(s2c.dl === true && s2c.prog === true, 'S2: 下载完该收起按钮与进度条，实际 ' + JSON.stringify(s2c));
    await evalIn(cdp, sessionId, `(() => { const s = document.getElementById('listen-other-lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    // S3. 离线模型行：选设备内置朗读 ⇒ 行出现「未下载 · 129 MB」+ 「下载」，试听按钮写「下载并试听（129 MB）」
    await evalIn(cdp, sessionId, `(() => { const s = document.getElementById('tts-engine'); s.value = 'device'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    const s3a = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('tts-offline-row').hidden, text: document.getElementById('tts-offline-state').textContent, dl: document.getElementById('tts-offline-dl').hidden, dlText: document.getElementById('tts-offline-dl').textContent, test: document.getElementById('btn-tts-test').textContent })`)); return /未下载/.test(r.text) ? r : null; }, 5000, 'S3: 离线模型行说「未下载」');
    need(s3a.hidden === false && /129 MB/.test(s3a.text) && /zh/.test(s3a.text) && /en/.test(s3a.text) && /自动下载/.test(s3a.text), 'S3: 未下载态该带大小、语言与「首次朗读也会自动下载」，实际 ' + JSON.stringify(s3a));
    need(s3a.dl === false && s3a.dlText === '下载', 'S3: 该有「下载」按钮，实际 ' + JSON.stringify(s3a));
    need(/下载并试听（129 MB）/.test(s3a.test), 'S3: 模型未装时试听按钮该写「下载并试听（129 MB）」，实际 ' + JSON.stringify(s3a.test));
    // S4. 点「下载」⇒ 进度 ⇒ 已安装；试听按钮回到「试听一句」；恰好下载了一次
    await evalIn(cdp, sessionId, `(document.getElementById('tts-offline-dl').click(), 'ok')`);
    const s4 = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ text: document.getElementById('tts-offline-state').textContent, dl: document.getElementById('tts-offline-dl').hidden, prog: document.getElementById('tts-offline-progress').hidden, test: document.getElementById('btn-tts-test').textContent, n: __fakeSpeech.ttsDownloads })`)); return /已安装/.test(r.text) ? r : null; }, 8000, 'S4: 下载后离线模型行说「已安装」');
    need(s4.dl === true && s4.prog === true && s4.test === '试听一句' && s4.n === 1, 'S4: 已安装态该收起按钮与进度条、试听按钮回「试听一句」、恰好下载一次，实际 ' + JSON.stringify(s4));
    // S4b. 地址来源（§9.6.1.1）：没缓存 ⇒ 先问了服务器一次，原生收到的是服务器的默认地址，而 sha256 仍是清单里的；默认地址落进缓存、备用没有
    const s4b = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ asked: __fakeSources.asked, url: __fakeSources.lastUrl, urls: __fakeSpeech.assetsUrls, sha: __fakeSpeech.lastAssetsSha, cache: JSON.parse(localStorage.getItem('mt:deviceModelSources') || 'null'), builtinSha: mtDeviceTtsModelsFor(window.MT_FLAVOR || 'global').map((m) => m.files[0].sha256) })`));
    need(s4b.asked === 1 && /bt_model_sources\?select=path,url,url_alt&kind=eq\.tts&flavor=eq\./.test(s4b.url || ''), 'S4b: 没缓存该先问服务器一次（表 bt_model_sources），实际 ' + JSON.stringify({ asked: s4b.asked, url: s4b.url }));
    need(JSON.stringify(s4b.urls[s4b.urls.length - 1]) === JSON.stringify(['https://srv.example/piper-zh.zip', 'https://srv.example/piper-en.zip']), 'S4b: 原生收到的该是服务器的默认地址，实际 ' + JSON.stringify(s4b.urls));
    need(JSON.stringify(s4b.sha) === JSON.stringify(s4b.builtinSha), 'S4b: sha256 该仍是清单里的（服务器给的 EVIL 被忽略），实际 ' + JSON.stringify(s4b.sha));
    need(s4b.cache && Object.values(s4b.cache)[0] && Object.values(s4b.cache)[0]['piper-zh.zip'] === 'https://srv.example/piper-zh.zip' && !JSON.stringify(s4b.cache).includes('alt.example'), 'S4b: 默认地址该落缓存、备用不落，实际 ' + JSON.stringify(s4b.cache));
    // S4c. 有缓存 ⇒ 先探；探不通 ⇒ 重问；新默认下载失败 ⇒ 用备用；进度行中途说过「换一个重试」；最后仍「已安装」
    await evalIn(cdp, sessionId, `(() => { __fakeSpeech.ttsReady = false; __fakeSpeech.ttsDownloads = 0; __fakeSpeech.assetsUrls = []; __fakeSpeech.probed = []; __fakeSpeech.probeOk = false; __fakeSpeech.ttsFailNext = 1; __fakeSources.asked = 0; window.__sawFallback = false; for (const r of __fakeSources.rows) r.url = r.url.replace('srv.example', 'srv2.example');
      const st = document.getElementById('tts-offline-state'); new MutationObserver(() => { if (/换一个重试/.test(st.textContent)) window.__sawFallback = true; }).observe(st, { childList: true, characterData: true, subtree: true });
      const s = document.getElementById('tts-engine'); s.value = ''; s.dispatchEvent(new Event('change')); s.value = 'device'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `document.getElementById('tts-offline-dl').hidden === false`)) || null, 5000, 'S4c: 重新出现「下载」按钮');
    await evalIn(cdp, sessionId, `(document.getElementById('tts-offline-dl').click(), 'ok')`);
    const s4c = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ text: document.getElementById('tts-offline-state').textContent, n: __fakeSpeech.ttsDownloads, urls: __fakeSpeech.assetsUrls, probed: __fakeSpeech.probed, asked: __fakeSources.asked, saw: window.__sawFallback })`)); return /已安装/.test(r.text) ? r : null; }, 8000, 'S4c: 换备用地址后仍到「已安装」');
    need(s4c.probed && s4c.probed.some((u) => u.startsWith('https://srv.example/')), 'S4c: 有缓存该先探缓存的地址，实际 ' + JSON.stringify(s4c.probed));
    need(s4c.asked === 1, 'S4c: 探不通该重新问服务器一次，实际 ' + s4c.asked);
    need(s4c.n === 2 && JSON.stringify(s4c.urls.map((u) => u[0])) === JSON.stringify(['https://srv2.example/piper-zh.zip', 'https://alt.example/piper-zh.zip']), 'S4c: 缓存探不通 ⇒ 重问拿到新默认（srv2）先试、失败后用当次备用（alt），实际 ' + JSON.stringify(s4c.urls));
    need(s4c.saw === true, 'S4c: 换地址时进度行该说过「地址不可用，换一个重试…」');
    const s4cache = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(JSON.parse(localStorage.getItem('mt:deviceModelSources') || 'null'))`));
    need(s4cache && JSON.stringify(s4cache).includes('srv2.example') && !JSON.stringify(s4cache).includes('alt.example'), 'S4c: 重问后缓存该更新成新默认（srv2），备用仍不落缓存，实际 ' + JSON.stringify(s4cache));
    // S4d. 服务器连不上且无缓存 ⇒ 用清单内置默认值，不出失败态
    await evalIn(cdp, sessionId, `(() => { __fakeSpeech.ttsReady = false; __fakeSpeech.ttsDownloads = 0; __fakeSpeech.assetsUrls = []; __fakeSpeech.probeOk = true; __fakeSources.fail = true; localStorage.removeItem('mt:deviceModelSources');
      const s = document.getElementById('tts-engine'); s.value = ''; s.dispatchEvent(new Event('change')); s.value = 'device'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `document.getElementById('tts-offline-dl').hidden === false`)) || null, 5000, 'S4d: 重新出现「下载」按钮');
    await evalIn(cdp, sessionId, `(document.getElementById('tts-offline-dl').click(), 'ok')`);
    const s4d = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ text: document.getElementById('tts-offline-state').textContent, urls: __fakeSpeech.assetsUrls, builtin: mtDeviceTtsModelsFor(window.MT_FLAVOR || 'global').map((m) => m.files[0].url) })`)); return /已安装|失败/.test(r.text) ? r : null; }, 8000, 'S4d: 服务器不可达时仍到「已安装」');
    need(/已安装/.test(s4d.text) && JSON.stringify(s4d.urls[0]) === JSON.stringify(s4d.builtin), 'S4d: 服务器连不上该用清单内置地址且不出失败态，实际 ' + JSON.stringify(s4d));
    await evalIn(cdp, sessionId, `(__fakeSources.fail = false, 'ok')`);
    // S5. 试听：模型已装 ⇒ 直接原生念（不再下载）
    await evalIn(cdp, sessionId, `(__fakeSpeech.spoken = [], document.getElementById('btn-tts-test').click(), 'ok')`);
    const s5 = await waitFor(async () => { const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ spoken: (__fakeSpeech.spoken || []).length, n: __fakeSpeech.ttsDownloads, note: document.getElementById('test-tts-note').textContent })`)); return r.spoken >= 1 && /播放中/.test(r.note) ? r : null; }, 8000, 'S5: 试听经原生朗读且结果行「播放中」');
    need(s5.n === 1 && /播放中/.test(s5.note), 'S5: 已装时试听不该再下载，结果行「播放中」，实际 ' + JSON.stringify(s5));
    // 收尾：朗读引擎清空，回首页
    await evalIn(cdp, sessionId, `(() => { const s = document.getElementById('tts-engine'); s.value = ''; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
    await sleep(300);
    const s6 = await evalIn(cdp, sessionId, `document.getElementById('tts-offline-row').hidden`);
    need(s6 === true, 'S: 换成别的引擎后离线模型行该收起');
    await evalIn(cdp, sessionId, `(async () => { LearnTTS.configure({ engineId: '' }); document.getElementById('settings-back').click(); window.scrollTo(0, 0); return 'ok'; })()`);
    await sleep(400);

    // ── H. 实时字幕（learning-design §9.8）：老壳隐藏 / 系统版本灰态 / 准备态不开麦 / 单向 / 字幕条消息 / 语料 mode / 字幕条「结束」──
    if (process.env.TRACE) console.log('  …H');
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(300);
    const h0 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('app-subs-entry2').hidden, reason: AppListen._debug().subsReason, probes: __fakeBridge.msgs.filter((m) => m.type === 'caps-probe').length })`));
    need(h0.hidden === true && h0.reason === 'hidden' && h0.probes >= 1, 'H0: 原生不回 caps-probe（老壳）时「实时字幕」整行该不显示，实际 ' + JSON.stringify(h0));
    await evalIn(cdp, sessionId, `(async () => { NativeAudio._fromNative({ type: 'audio-caps', sources: ['mic'], system: 'os', broadcast: 'unsupported' }); await AppListen.refreshEntry(); return 'ok'; })()`);
    const h1 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const b = document.getElementById('app-subs-entry2'); const n = document.getElementById('app-subs-need2'); const w = document.getElementById('app-subs-need-why2'); const g = document.getElementById('app-subs-need-go2'); return { hidden: b.hidden, disabled: b.disabled, needShown: !!n && !n.hidden, why: w && w.textContent, goHidden: g ? g.hidden : null }; })())`));
    need(h1.hidden === false && h1.disabled === true && h1.needShown && /macOS 14\.4/.test(h1.why || '') && h1.goHidden === true,
      'H1: system:os 时入口该灰、说「需要 macOS 14.4」、不给去设置，实际 ' + JSON.stringify(h1));
    await evalIn(cdp, sessionId, `(async () => { __fakeBridge.caps = { sources: ['mic', 'system'], system: 'ok', broadcast: 'unsupported' }; NativeAudio._fromNative(Object.assign({ type: 'audio-caps' }, __fakeBridge.caps)); await AppListen.refreshEntry(); return 'ok'; })()`);
    const h2 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ hidden: document.getElementById('app-subs-entry2').hidden, disabled: document.getElementById('app-subs-entry2').disabled, needShown: !document.getElementById('app-subs-need2').hidden })`));
    need(h2.hidden === false && h2.disabled === false && h2.needShown === false, 'H2: system:ok 时入口该可用、原因句藏起，实际 ' + JSON.stringify(h2));
    // H2b. 两个入口因同一个原因灰掉（旧系统）⇒ 首页只说一次：对话那行在、字幕那行藏起，两个入口都灰
    await evalIn(cdp, sessionId, `(async () => { __fakeSpeech.os = 'old'; await AppListen.refreshEntry(); return 'ok'; })()`);
    const h2b = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const v = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
      return { listenNeed: v('app-listen-need-live2'), subsNeed: v('app-subs-need2'), listenWhy: document.getElementById('app-listen-need-live-why2').textContent,
        listenDisabled: document.getElementById('app-listen-entry2').disabled, subsDisabled: document.getElementById('app-subs-entry2').disabled, subsReason: AppListen._debug().subsReason, subsGo: document.getElementById('app-subs-need-go2').hidden }; })())`));
    need(h2b.listenNeed === true && h2b.subsNeed === false && /iOS 26/.test(h2b.listenWhy || '') && h2b.listenDisabled === true && h2b.subsDisabled === true && h2b.subsReason === 'device-os' && h2b.subsGo === true,
      'H2b: 两个入口同因灰掉时原因句该只出一次（对话行在、字幕行藏），两个入口都灰、没有去设置，实际 ' + JSON.stringify(h2b));
    await evalIn(cdp, sessionId, `(async () => { __fakeSpeech.os = 'new'; await AppListen.refreshEntry(); return 'ok'; })()`);
    // H3. 点入口 ⇒ 停在准备态：准备区 + 隐私句（Mac 版），桥**没收到**新的 mic-start；自动朗读开着也不出声
    await evalIn(cdp, sessionId, `(async () => {
      window.__tts = [];
      LearnTTS.engine = () => ({ id: 'e2e_tts' });
      LearnTTS.speak = (text, lang) => { window.__tts.push({ text, lang }); return Promise.resolve({ ok: true, done: Promise.resolve() }); };
      LearnTTS.stop = () => {};
      await new Promise((r) => chrome.storage.local.set({ listenAutoSpeak: true, subtitleVideoLang: 'en', subtitleCapture: true }, r));
      return 'ok';
    })()`);
    const startedBeforeH = await evalIn(cdp, sessionId, `__fakeBridge.started`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-subs-entry2').click(), 'ok')`);
    await sleep(600);
    const h3 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((() => { const d = AppListen._debug(); const pr = document.getElementById('app-subs-privacy'); return { mode: d.mode, phase: d.phase, listenHidden: document.getElementById('app-listen').hidden, prep: !document.getElementById('app-subs-prep').hidden, privHidden: pr.hidden, priv: pr.textContent, started: __fakeBridge.started, title: document.getElementById('app-listen-title').textContent, toggle: document.getElementById('app-listen-toggle').textContent }; })())`));
    need(h3.mode === 'subtitle' && h3.phase === 'idle' && h3.listenHidden === false && h3.prep && !h3.privHidden && /这台 Mac/.test(h3.priv)
      && h3.started === startedBeforeH && h3.title === '实时字幕' && h3.toggle === '开始',
      'H3: 点入口该停在准备态（不开麦）、标题「实时字幕」、按钮「开始」、Mac 隐私句可见，实际 ' + JSON.stringify(h3));
    // H4. 点「开始」⇒ 字幕档会话 + 系统声音来源 + 字幕条配置；先过一次「等系统授权」
    const msgMark = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(__fakeBridge.holdGrant = true, 'ok')`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-toggle').click(), 'ok')`);
    const h4a = await waitFor(async () => {
      const r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${msgMark}).filter((m) => m.type === 'subtitle-state').map((m) => m.state) })`));
      return r.states.includes('waiting-permission') ? r : null;
    }, 8000, 'H4a: 等授权时字幕条收到 waiting-permission');
    need(h4a.phase === 'preparing' && /等待系统授权/.test(h4a.note), 'H4a: 等授权时该停在准备中、页面说在等授权，实际 ' + JSON.stringify(h4a));
    await evalIn(cdp, sessionId, `(__fakeBridge.holdGrant = false, NativeAudio._fromNative({ type: 'mic-state', state: 'granted', source: 'system' }), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H4: 授权后字幕模式进入 listening');
    const h4 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__fakeBridge.msgs.slice(${msgMark}).filter((m) => m.type !== 'mic-pcm').map((m) => ({ type: m.type, on: m.on, profile: m.profile, source: m.source, hasLabels: !!(m.labels && m.labels.state && m.labels.controls) })))`));
    const rm = h4.find((m) => m.type === 'record-mode'), ms = h4.find((m) => m.type === 'mic-start'), sc = h4.find((m) => m.type === 'subtitle-config');
    need(rm && rm.on === true && rm.profile === 'subtitle', 'H4: record-mode 该带 profile:subtitle，实际 ' + JSON.stringify(rm));
    need(ms && ms.source === 'system', 'H4: mic-start 该带 source:system（收到过 system:ok），实际 ' + JSON.stringify(ms));
    need(sc && sc.hasLabels, 'H4: 该发 subtitle-config 且带 state / controls 文案（原生零文案），实际 ' + JSON.stringify(sc));
    need(JSON.stringify(await evalIn(cdp, sessionId, `JSON.stringify(__fakeSpeech.lastLocales)`)) === JSON.stringify(JSON.stringify(['en-US'])), 'H4: 字幕档只开「视频的语言」一路识别器（en-US）');
    // H4b. 全零帧：原生报 silent ⇒ 仍在听、不中断提示；没听到过声音就到静音门 ⇒ 暂停句指向权限；恢复后 sound ⇒ 撤掉
    const markB = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'mic-state', state: 'silent', reason: 'zero-frames', source: 'system' }), 'ok')`);
    await sleep(300);
    const h4b1 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markB}).filter((m) => m.type === 'subtitle-state').map((m) => m.state), labelSilent: !!((__fakeBridge.msgs.filter((m) => m.type === 'subtitle-config').pop() || {}).labels || {}).state && !!__fakeBridge.msgs.filter((m) => m.type === 'subtitle-config').pop().labels.state.silent })`));
    need(h4b1.phase === 'listening' && /还没听到系统声音/.test(h4b1.note) && h4b1.states.includes('silent') && h4b1.labelSilent,
      'H4b: mic-state silent ⇒ 仍在听、页面出不中断提示、条收到 subtitle-state silent、labels.state 有 silent，实际 ' + JSON.stringify(h4b1));
    const markP = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(AppListen.pause('silence'), 'ok')`);
    await sleep(200);
    const h4b2 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markP}).filter((m) => m.type === 'subtitle-state').map((m) => m.state), labelPerm: !!(((__fakeBridge.msgs.filter((m) => m.type === 'subtitle-config').pop() || {}).labels || {}).state || {})['silence-permission'] })`));
    need(h4b2.phase === 'paused' && /系统录音权限/.test(h4b2.note), 'H4b: 收到过 silent、从没 sound 就到静音门 ⇒ 暂停句该指向权限，实际 ' + JSON.stringify(h4b2));
    need(h4b2.states.includes('silence-permission') && !h4b2.states.includes('silence') && h4b2.labelPerm,
      'H4b(O2): 同一条件下条该收到 subtitle-state silence-permission（不是 silence），labels.state 有 silence-permission，实际 ' + JSON.stringify(h4b2));
    await evalIn(cdp, sessionId, `(AppListen.resume(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H4b: 继续后回到 listening');
    const markB2 = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'mic-state', state: 'sound', source: 'system' }), 'ok')`);
    await sleep(300);
    const h4b3 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markB2}).filter((m) => m.type === 'subtitle-state').map((m) => m.state) })`));
    need(h4b3.phase === 'listening' && !/还没听到系统声音/.test(h4b3.note) && h4b3.states.includes('listening'),
      'H4b: mic-state sound ⇒ 提示撤掉、条收到 subtitle-state listening，实际 ' + JSON.stringify(h4b3));
    const markP2 = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(AppListen.pause('silence'), 'ok')`);
    await sleep(200);
    const h4b4 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markP2}).filter((m) => m.type === 'subtitle-state').map((m) => m.state) })`));
    need(h4b4.phase === 'paused' && h4b4.states.includes('silence') && !h4b4.states.includes('silence-permission') && !/系统录音权限/.test(h4b4.note),
      'H4b(O2): 听到过声音再到静音门 ⇒ 条上照旧 silence、暂停句不提权限，实际 ' + JSON.stringify(h4b4));
    await evalIn(cdp, sessionId, `(AppListen.resume(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H4b(O2): 继续后回到 listening');
    // H4c（#424）. **原生一声不吭**的那一种：既没报 silent 也没报 sound，样本恒零。
    // 这正是最常见的顺序（先在 App 里开始，再去浏览器点播放）—— 原生那条判据只在开始后
    // 3 秒量一次，量的时候什么都没播，于是它永远不报 silent，用户要等到 30 秒静音门，
    // 然后收到一句指错方向的「没有声音」（#420 当天就是这样）。
    // 判据是「收到的样本是不是全零」，所以这里**什么都不发**，只等时间过去。
    // 真等 ~9 秒而不是把时钟改快：改快了测的是那个假时钟，不是「听了 8 秒还没声音」。
    await evalIn(cdp, sessionId, `(AppListen.end(), 'ok')`);
    await sleep(400);
    await evalIn(cdp, sessionId, `(__fakeBridge.zero = true, 'ok')`);   // 采集链路「死了」：照常发帧，电平恒零
    await evalIn(cdp, sessionId, `(document.getElementById('app-subs-entry2').click(), 'ok')`);
    await sleep(400);
    const markD = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-toggle').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H4c: 新一场字幕会话进入 listening');
    await sleep(9500);
    const h4c1 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markD}).filter((m) => m.type === 'subtitle-state').map((m) => m.state) })`));
    need(h4c1.phase === 'listening' && /还没听到系统声音/.test(h4c1.note) && h4c1.states.includes('silent'),
      'H4c(#424): 听了 8 秒一个非零样本都没有 ⇒ 该出不中断提示并把条切到 silent（原生没报过 silent），实际 ' + JSON.stringify(h4c1));
    const markD2 = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(AppListen.pause('silence'), 'ok')`);
    await sleep(200);
    const h4c2 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markD2}).filter((m) => m.type === 'subtitle-state').map((m) => m.state) })`));
    need(h4c2.phase === 'paused' && /系统录音权限/.test(h4c2.note) && h4c2.states.includes('silence-permission') && !h4c2.states.includes('silence'),
      'H4c(#424): 从没拿到过真样本就到静音门 ⇒ 暂停句与条都该指向权限（而不是「没有声音」），实际 ' + JSON.stringify(h4c2));
    await evalIn(cdp, sessionId, `(AppListen.resume(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H4c: 继续后回到 listening');
    // 声音终于来了（原生报 sound）⇒ 那句话撤掉、条回到 listening
    const markD3 = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'mic-state', state: 'sound', source: 'system' }), 'ok')`);
    await sleep(1400);
    const h4c3 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ note: (document.getElementById('app-listen-note') || {}).textContent || '', states: __fakeBridge.msgs.slice(${markD3}).filter((m) => m.type === 'subtitle-state').map((m) => m.state) })`));
    need(!/还没听到系统声音/.test(h4c3.note) && h4c3.states.includes('listening'),
      'H4c(#424): 声音来了之后那句提示该撤掉、条回到 listening，实际 ' + JSON.stringify(h4c3));
    await evalIn(cdp, sessionId, `(__fakeBridge.zero = false, 'ok')`);
    // H5. 单向：每一句都归对方；没有 ↔ / 给对方看 / 朗读；自动朗读不出声
    const showMark = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await say('en-US', 'The keynote starts in five minutes.');
    await waitFor(async () => JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify((AppListen._debug().rows || []).some((x) => x.text === 'The keynote starts in five minutes.' && x.tr))`)) || null, 8000, 'H5: 第一句定稿带译文');
    await say('en-US', 'Please welcome the demo team.');
    const rowsH = await waitFor(async () => { const r = await rowsOf(); return r.length === 2 && r.every((x) => x.tr && !x.temp) ? r : null; }, 8000, 'H5: 两句定稿带译文');
    need(rowsH.every((x) => x.who === 'them'), 'H5: 字幕模式单向，两句都该归对方，实际 ' + JSON.stringify(rowsH));
    const domH = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ swap: document.querySelectorAll('#app-listen-history .listen-swap').length, acts: document.querySelectorAll('#app-listen-history .listen-act').length, text: document.getElementById('app-listen-history').textContent, tts: window.__tts.length })`));
    need(domH.swap === 0 && domH.acts === 0 && !domH.text.includes('对方'), 'H5: 字幕历史不该有 ↔ / 给对方看 / 归属标，实际 ' + JSON.stringify(domH));
    need(domH.tts === 0, 'H5: 字幕模式不朗读（设置里开着自动朗读也不），实际读了 ' + domH.tts + ' 次');
    // H6. 字幕条消息：先有半句，再有带译文的定稿
    const shows = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__fakeBridge.msgs.slice(${showMark}).filter((m) => m.type === 'subtitle-show'))`));
    need(shows.some((m) => m.partial === true && m.orig), 'H6: 字幕条该收到过半句（partial:true），实际 ' + shows.length + ' 条');
    need(shows.some((m) => m.partial === false && m.orig === 'The keynote starts in five minutes.' && m.tr === '译：The keynote starts in five minutes.'),
      'H6: 字幕条该收到带译文的定稿，实际 ' + JSON.stringify(shows.filter((m) => !m.partial)));
    // H7. 语料：锚点 k:conv + mode:subtitle，来源标题「实时字幕 · 日期」
    const itemsH = await waitFor(async () => {
      const a = JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allItems().then((a) => JSON.stringify(a.filter((x) => x.text === 'The keynote starts in five minutes.').map((x) => ({ anchor: x.anchor, sourceId: x.sourceId }))))`));
      return a.length ? a : null;
    }, 5000, 'H7: 字幕句进语料');
    need(itemsH[0].anchor && itemsH[0].anchor.k === 'conv' && itemsH[0].anchor.mode === 'subtitle' && itemsH[0].anchor.who === 'them',
      'H7: 字幕句锚点该是 k:conv / mode:subtitle / who:them，实际 ' + JSON.stringify(itemsH[0]));
    const srcH = JSON.parse(await evalIn(cdp, sessionId, `LearnStore.allSources().then((a) => JSON.stringify(a.filter((s) => s.id === ${JSON.stringify(itemsH[0].sourceId)}).map((s) => s.title)))`));
    need(srcH.length === 1 && /^实时字幕 · \d{4}-\d{2}-\d{2}/.test(srcH[0]), 'H7: 来源标题该是「实时字幕 · 日期」，实际 ' + JSON.stringify(srcH));
    // H7b. 字幕条 A+ ⇒ 页面落盘 subtitleFontScale、恰好重发一条 subtitle-config
    const fontMark = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'remote', command: 'font-up' }), 'ok')`);
    await sleep(300);
    const h7b = JSON.parse(await evalIn(cdp, sessionId, `new Promise((r) => chrome.storage.local.get(['subtitleFontScale'], (s) => r(JSON.stringify({ stored: (s || {}).subtitleFontScale, cfgs: __fakeBridge.msgs.slice(${fontMark}).filter((m) => m.type === 'subtitle-config').map((m) => m.fontScale) }))))`));
    need(h7b.stored === 1.2 && JSON.stringify(h7b.cfgs) === '[1.2]', 'H7b: A+ 该把字号存成 1.2 并恰好重发一条 subtitle-config，实际 ' + JSON.stringify(h7b));
    // H8. 字幕条上的「结束」⇒ 会话结束、字幕条收起、小结「这次字幕」
    const endMark = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'remote', command: 'end' }), 'ok')`);
    await sleep(400);
    const h8 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, msgs: __fakeBridge.msgs.slice(${endMark}).map((m) => m.type), sumShown: !document.getElementById('app-listen-summary').hidden, sumTitle: document.getElementById('app-listen-summary-title').textContent, sumBody: document.getElementById('app-listen-summary-body').textContent })`));
    need(h8.phase === 'ended' && h8.msgs.includes('subtitle-hide') && h8.msgs.includes('mic-stop'), 'H8: remote end 该结束会话、发 subtitle-hide 与 mic-stop，实际 ' + JSON.stringify(h8));
    need(h8.sumShown && h8.sumTitle === '这次字幕' && /共 2 句/.test(h8.sumBody), 'H8: 小结该是「这次字幕 · 共 2 句」，实际 ' + JSON.stringify(h8));
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(300);

    // ── H9. iPhone 一期（原生报 system:'unsupported'）：麦克风听外放 + 画中画小窗 ──
    if (process.env.TRACE) console.log('  …H9');
    await evalIn(cdp, sessionId, `(async () => { __fakeBridge.caps = { sources: ['mic'], system: 'unsupported', broadcast: 'unsupported' }; NativeAudio._fromNative(Object.assign({ type: 'audio-caps' }, __fakeBridge.caps)); await AppListen.refreshEntry(); AppListen.open('subtitle'); return 'ok'; })()`);
    await sleep(500);
    const h9a = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ pip: !document.getElementById('app-subs-pip').hidden, partialHidden: document.getElementById('app-listen-partial').hidden, priv: document.getElementById('app-subs-privacy').textContent, tip: document.getElementById('app-subs-tip').textContent, note: document.getElementById('app-subs-pip-note').textContent })`));
    need(/字幕小窗的预览/.test(h9a.note), 'H9: 开始前预览占位块上该有一句说明（不是一块黑），实际 ' + JSON.stringify(h9a.note));
    const ar9 = await evalIn(cdp, sessionId, `(function(){ var r=document.getElementById('app-subs-pip').getBoundingClientRect(); return r.height ? r.width / r.height : 0; })()`);
    need(Math.abs(ar9 - 0.8) < 0.03, 'H9: 小窗预览占位块该是 4:5（与画中画同一帧），实际宽高比 ' + ar9);
    need(h9a.pip && h9a.partialHidden && /iPhone/.test(h9a.priv) && /画中画/.test(h9a.tip), 'H9: iPhone 准备页该显示小窗预览占位、iPhone 隐私句与画中画提示，实际 ' + JSON.stringify(h9a));
    const mark9 = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-toggle').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H9: iPhone 字幕模式进入 listening');
    await sleep(400);
    const m9 = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__fakeBridge.msgs.slice(${mark9}).map((m) => ({ type: m.type, profile: m.profile, source: m.source, hasRect: 'rect' in m, rect: m.rect })))`));
    const rm9 = m9.find((m) => m.type === 'record-mode'), ms9 = m9.find((m) => m.type === 'mic-start'), fl9 = m9.find((m) => m.type === 'subtitle-float');
    need(rm9 && rm9.profile === 'subtitle', 'H9: record-mode 该带 profile:subtitle，实际 ' + JSON.stringify(rm9));
    need(ms9 && ms9.source === undefined, 'H9: iPhone 的 mic-start 不带 source（麦克风，老壳逐字节不变），实际 ' + JSON.stringify(ms9));
    need(fl9 && fl9.hasRect && fl9.rect && fl9.rect.w > 0 && fl9.rect.h > 0, 'H9: 该把小窗预览占位的矩形发给原生，实际 ' + JSON.stringify(fl9));
    const floatVis = `JSON.stringify((() => { const b = document.getElementById('app-subs-float'); return { hidden: b.hidden, text: b.textContent }; })())`;
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'subtitle-window', state: 'closed', reason: 'not-active' }), 'ok')`);
    const h9c = JSON.parse(await evalIn(cdp, sessionId, floatVis));
    const ph9c = await evalIn(cdp, sessionId, `AppListen._debug().phase`);
    need(h9c.hidden === false && h9c.text === '浮出字幕窗', 'H9: 小窗没浮出来（带 reason）时该出「浮出字幕窗」，实际 ' + JSON.stringify(h9c));
    need(ph9c === 'listening', 'H9: 带 reason 的 closed 不该暂停，实际 phase ' + ph9c);
    const mark9b = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-subs-float').click(), 'ok')`);
    const fl9b = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__fakeBridge.msgs.slice(${mark9b}).filter((m) => m.type === 'subtitle-float').map((m) => ('rect' in m)))`));
    need(JSON.stringify(fl9b) === '[false]', 'H9: 点「浮出字幕窗」该发一条不带 rect 的 subtitle-float，实际 ' + JSON.stringify(fl9b));
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'subtitle-window', state: 'floating' }), 'ok')`);
    const h9f = JSON.parse(await evalIn(cdp, sessionId, floatVis));
    need(h9f.hidden === true, 'H9: 小窗浮出后按钮该藏起，实际 ' + JSON.stringify(h9f));
    const markX = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'subtitle-window', state: 'closed' }), 'ok')`);
    await sleep(400);
    const h9x = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, pauseReason: AppListen._debug().pauseReason, toggle: document.getElementById('app-listen-toggle').textContent, summaryHidden: document.getElementById('app-listen-summary').hidden, float: document.getElementById('app-subs-float').hidden, rows: AppListen._debug().rows.length, msgs: __fakeBridge.msgs.slice(${markX}).map((m) => ({ type: m.type, hasRect: 'rect' in m, rect: m.rect })) })`));
    need(h9x.phase === 'paused' && h9x.pauseReason === 'user', 'H9: ✕ 关掉小窗该按用户暂停处理，实际 ' + JSON.stringify(h9x));
    need(h9x.msgs.some((m) => m.type === 'mic-stop'), 'H9: ✕ 暂停该发 mic-stop，实际 ' + JSON.stringify(h9x.msgs));
    need(h9x.msgs.some((m) => m.type === 'subtitle-float' && m.hasRect && m.rect === null), 'H9: ✕ 暂停该发 subtitle-float {rect:null} 收起预览，实际 ' + JSON.stringify(h9x.msgs));
    need(h9x.toggle === '继续' && h9x.summaryHidden === true && h9x.float === true, 'H9: ✕ 暂停后主按钮该是「继续」、不出小结、不出「浮出字幕窗」，实际 ' + JSON.stringify(h9x));
    const markR = await evalIn(cdp, sessionId, `__fakeBridge.msgs.length`);
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-toggle').click(), 'ok')`);
    await waitFor(async () => (await evalIn(cdp, sessionId, `AppListen._debug().phase`)) === 'listening' || null, 10000, 'H9: 点「继续」该回到 listening');
    await sleep(400);
    const h9r = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify(__fakeBridge.msgs.slice(${markR}).map((m) => ({ type: m.type, hasRect: 'rect' in m, w: m.rect && m.rect.w })))`));
    need(h9r.some((m) => m.type === 'mic-start'), 'H9: 点「继续」该重新 mic-start，实际 ' + JSON.stringify(h9r));
    need(h9r.some((m) => m.type === 'subtitle-float' && m.hasRect && m.w > 0), 'H9: 点「继续」该重发预览矩形，实际 ' + JSON.stringify(h9r));
    await evalIn(cdp, sessionId, `(NativeAudio._fromNative({ type: 'subtitle-window', state: 'closed' }), NativeAudio._fromNative({ type: 'remote', command: 'end' }), 'ok')`);
    await sleep(300);
    const h9e = JSON.parse(await evalIn(cdp, sessionId, `JSON.stringify({ phase: AppListen._debug().phase, hide: __fakeBridge.msgs.slice(${mark9b}).some((m) => m.type === 'subtitle-hide'), float: document.getElementById('app-subs-float').hidden })`));
    const note9 = await evalIn(cdp, sessionId, `document.getElementById('app-subs-pip-note').textContent`);
    need(/已结束/.test(note9), 'H9: 结束后预览占位块上该写「已结束」，实际 ' + JSON.stringify(note9));
    need(h9e.phase === 'ended' && h9e.hide && h9e.float === true, 'H9: 结束后该发 subtitle-hide、「浮出字幕窗」藏起，实际 ' + JSON.stringify(h9e));
    await evalIn(cdp, sessionId, `(document.getElementById('app-listen-back').click(), 'ok')`);
    await sleep(300);

    // ── T2. App 里领免费额度：grant_claimed + engine_set 真的走得到（telemetry-design §3.4）──
    // 09-19 查实：grant_claimed 只挂在扩展设置页的按钮 handler 里，App 的领取路径没有；
    // 且 App 领取直接 set(plan.writes)、不经 applyQuickSetup ⇒ engine_set 也不记。
    // 这一段只换掉**网络与登录**两样（claimUrl 的 fetch、LearnAuth.token），其余全是出货的代码：
    // 卡由 LearnGrant.render 画、按钮真点、claim() 真跑 —— grant_claimed 就记在 claim() 里。
    if (process.env.TRACE) console.log('  …T2');
    const t2 = JSON.parse(await evalIn(cdp, sessionId, `(async () => {
      if (typeof LearnGrant === 'undefined' || !LearnGrant.enabled()) return JSON.stringify({ skip: true });
      const $ = (id) => document.getElementById(id);
      const keep = await new Promise((r) => chrome.storage.local.get(null, (s) => r(s || {})));
      const claimUrl = window.MT_GRANT.claimUrl, realFetch = window.fetch, realToken = LearnAuth.token;
      let calls = 0;
      window.fetch = (u, o) => String(u) === claimUrl
        ? (calls++, Promise.resolve(new Response(JSON.stringify({ token: 'bmg_verifylistenverifylistenverifylisten0001', limit_usd: 0.2, spent_usd: 0, reused: false }), { status: 200, headers: { 'content-type': 'application/json' } })))
        : realFetch(u, o);
      LearnAuth.token = async () => 'fake-session-jwt';
      await new Promise((r) => chrome.storage.local.remove(['apiKey', 'provider', 'apiBaseUrl', 'apiModel', 'grant', 'grantTail', 'grantBalance', 'engineChosen'], r));
      __tm.length = 0;
      $('signed-out').hidden = true; $('app-listen').hidden = true; $('app-settings').hidden = false;
      await AppSettings.paint({ user: { id: 'u-test' } }, () => {});
      const btn = document.querySelector('#grant-box button.gr-action');
      const label = btn ? btn.textContent : null;
      if (btn) btn.click();
      for (let i = 0; i < 40 && !__tm.some((e) => e.n === 'engine_set'); i++) await new Promise((r) => setTimeout(r, 100));
      const got = await new Promise((r) => chrome.storage.local.get(['provider', 'grantTail'], (s) => r(s || {})));
      const out = { label, calls, tm: __tm.slice(), provider: got.provider, tail: got.grantTail };
      // 复原：后面的 M 段与任何重跑都不该看见这一幕留下的配置
      window.fetch = realFetch; LearnAuth.token = realToken;
      // 垫片没有 clear()：先删掉这一幕新写的键，再把原值写回
      const after = await new Promise((r) => chrome.storage.local.get(null, (s) => r(s || {})));
      await new Promise((r) => chrome.storage.local.remove(Object.keys(after).filter((k) => !(k in keep)), r));
      await new Promise((r) => chrome.storage.local.set(keep, r));
      $('app-settings').hidden = true; $('signed-out').hidden = false;
      return JSON.stringify(out);
    })()`));
    if (t2.skip) console.log('  （这个构建没有代领额度，T2 跳过）');
    else {
      need(!!t2.label && t2.calls === 1, 'T2: 额度卡该有「领取」按钮且点下去发出 1 次领取请求，实际 ' + JSON.stringify({ label: t2.label, calls: t2.calls }));
      need(t2.provider === 'grant' && !!t2.tail, 'T2: 领取后主引擎该是 grant 且记下尾号，实际 ' + JSON.stringify({ provider: t2.provider, tail: t2.tail }));
      const gc = t2.tm.filter((e) => e.n === 'grant_claimed'), es = t2.tm.filter((e) => e.n === 'engine_set');
      need(gc.length === 1, 'T2: App 里领取成功该恰好 1 条 grant_claimed，实际 ' + JSON.stringify(t2.tm));
      need(es.length === 1 && es[0].p.provider === 'grant', 'T2: 领到额度 = 引擎配好了，该有 1 条 engine_set{provider:grant}，实际 ' + JSON.stringify(es));
    }

    // ── M. 启动迁移（2026-09-17）：老装机存着 sttEngine:'device' ⇒ 四键清空；云端条目不动 ──
    if (process.env.TRACE) console.log('  …M');
    const reloadWith = async (seed) => {
      await evalIn(cdp, sessionId, `new Promise((r) => chrome.storage.local.set(${JSON.stringify(seed)}, r))`);
      await cdp.send('Page.reload', {}, sessionId);
      await sleep(2500);
      await evalIn(cdp, sessionId, FAKE_BRIDGES);
      return JSON.parse(await evalIn(cdp, sessionId, `new Promise((r) => chrome.storage.local.get(['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel'], (s) => r(JSON.stringify(s || {}))))`));
    };
    const m1 = await reloadWith({ sttEngine: 'device', sttApiKey: 'stale', sttBaseUrl: 'http://x', sttModel: 'm' });
    need(m1.sttEngine === '' && m1.sttApiKey === '' && m1.sttBaseUrl === '' && m1.sttModel === '', 'M: 存着 device 的四元组该在启动时清空，实际 ' + JSON.stringify(m1));
    const m2 = await reloadWith({ sttEngine: 'openai_transcribe', sttApiKey: 'k', sttBaseUrl: '', sttModel: '' });
    need(m2.sttEngine === 'openai_transcribe' && m2.sttApiKey === 'k', 'M: 云端条目的配置该原样保留，实际 ' + JSON.stringify(m2));
    const m3 = await evalIn(cdp, sessionId, `(async () => { await AppListen.refreshEntry(); return document.getElementById('app-listen-entry2').disabled; })()`);
    need(m3 === false, 'M: 迁移后入口照旧只看桥，应可用');
  } catch (e) {
    problems.push('THROW ' + (e && e.stack));
    try { problems.push('STATE ' + await evalIn(cdp, sessionId, `JSON.stringify({ d: AppListen._debug(), note: (document.getElementById('app-listen-note') || {}).textContent, pill: (document.getElementById('app-listen-pill') || {}).textContent })`)); } catch (_) {}
    try { problems.push('TTS ' + await evalIn(cdp, sessionId, `(async () => { const r = await LearnTTS.speak('测试一句', 'zh'); return JSON.stringify({ engine: LearnTTS.engine(), avail: NativeSpeech.available(), langs: NativeSpeech.ttsLangs(), spoken: __fakeSpeech.spoken, stops: __fakeSpeech.ttsStops, speakResult: r }); })()`)); } catch (e2) { problems.push('TTS-ERR ' + e2); }
  }
  finally { try { cdp && cdp.close(); } catch (_) {} chrome.cleanup(); srv.close(); }

  console.log(`  假端点：翻译请求 ${stats.chatCalls} 次（其中修正 + 翻译 ${stats.passCalls} 次）`);
  if (problems.length) { console.log('\n✗ 对话 · 实时听译端到端有问题：\n  - ' + problems.join('\n  - ')); process.exit(1); }
  console.log('\n✓ 对话 · 实时听译端到端：门控只看本机识别器（旧系统灰 + 具名、无「去设置」）/ 听 / 归属按 locale / ↔ 改边并反向重译 / 语料 conv / 加星 / 结束小结 / 自动朗读与回声闸 / 两路 final 收法与修正稿 / 改语言重连 / 设备内置朗读下载 / 实时字幕（老壳隐藏、系统版本灰态、准备态不开麦、单向、字幕条消息、语料 mode、字幕条结束、iPhone 画中画）/ 启动迁移 全部通过');
  process.exit(0);
})();
