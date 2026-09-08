// app/listen.js — 「对话 · 实时听译」(learning-design §9.6 / interaction-spec 同名一节) — App-only.
//
// 线下听外语：对方说 → 手机上看中文；按住「我说」说中文 → 松手译成外语，放大给对方看并朗读。
// 双显与扩展的直播字幕同型：上卡是**当下**（逐词原文 + 边说边译的临时译文），下面是
// **整句定稿历史**（原文 + 整句译文，可加星）。定稿句对进复习，来源「对话」（默认开）。
//
// 分工（与 driving.js / learn-driving.js 相同）：
//   · app/listen-core.js —— 纯逻辑：归属、门、语料形状、静音、计时、边说边译策略。
//   · 这个文件 —— IO：麦克风（原生桥）、socket（WsTranscribe）、翻译、TTS、界面、语料写入、
//     锁屏卡片、停止态。
//
// 麦克风为什么走原生桥（PR-L0，2026-09-07 真机三轮）：WebKit 在 App 不可见时一律静音页内的
// getUserMedia —— 锁屏期间采集帧恒为 0，页内音频保活只能保住 JS。所以 PCM 由 Swift 的
// AVAudioEngine tap 采、重采样、经 mtAudio 桥送进来（NativeAudio.micStart）；socket、翻译、
// 界面留在这里，与扩展共用同一份 ws-transcribe.js。没有桥的宿主（Chrome 里的 test:app、
// 扩展页）退回页内 getUserMedia —— 那里没有锁屏问题，能力语义。
//
// 音频只发往用户配置的转写端点（§2.4 规则 5 / §10 Gate E）；不保存任何录音，只保留文字。
'use strict';

var AppListen = (() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => PageI18n.t(k, fb);
  // macOS 宿主：有物理键盘、没有触屏 —— 「按住」的提示要把空格说出来（interaction-spec「macOS」）。
  const isMacHost = () => { try { return /^Mac/.test(navigator.platform || '') && !(navigator.maxTouchPoints > 0); } catch (_) { return false; } };
  const C = ListenCore;
  const PROCESSOR_FRAMES = 4096;
  const SOURCE_LABEL = () => t('listen_source_label', '对话');

  // 页内保活（PR-L0 第三轮实证）：一段不可闻的 WAV 循环播放（8 kHz、0.5 s、全零样本 ——
  // WebKit 只看「有没有元素在播」，不看幅度），WebContent 进程在锁屏后就不会被挂起
  // （计时器 2 s 节流但全程活着）。只在会挂起进程的宿主上放。
  // PR-L2 真机若证明原生录音本身已足以保住 WebContent，这一段就删掉（§9.6）。
  const KEEP_ALIVE_WAV = (() => {
    const rate = 8000, n = rate / 2, data = n * 2;
    const b = new Uint8Array(44 + data);
    const w32 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
    const w16 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
    const tag = (o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); w32(4, 36 + data); tag(8, 'WAVE'); tag(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1);
    w32(24, rate); w32(28, rate * 2); w16(32, 2); w16(34, 16); tag(36, 'data'); w32(40, data);
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return 'data:audio/wav;base64,' + btoa(s);
  })();
  let keepAlive = null;

  // ── 会话状态 ──────────────────────────────────────────────────────────────
  // phase: 'idle' | 'preparing' | 'listening' | 'paused' | 'halted' | 'ended'
  // （2026-09-08 去掉了 'speaking'：不再有「按住我说」，双方自由说话、归属按语言判）
  // 放大展示（给对方看）不是 phase：它是历史行上的一个叠层，底下照常在听（showRid）。
  let phase = 'idle';
  let pauseReason = '';     // 'user' | 'silence' | 'denied' | 'socket' | 'socket-retry' | 'locked' | 'failed'
  let showRid = 0;          // 放大展示中的历史行（0 = 没有）
  let socketRetried = false; // socket 断开后自动重连过一次了吗（成功 ready 时清零）
  let session = null;
  let cfg = null;
  let sock = null;
  let inc = null;           // 边说边译（ListenCore.makeIncremental）
  let partial = '', partialTr = '';
  let clockTimer = 0;
  let cameFrom = 'signed-in';
  let gen = 0;              // 会话代际：旧会话的异步回调按它作废
  let speakingRid = 0;      // 正在朗读哪一行（0 = 没在读）
  // 页内麦克风（无桥宿主的退路）
  let audioCtx = null, stream = null, proc = null, srcNode = null;

  const now = () => Date.now();

  // ── 设置 ──────────────────────────────────────────────────────────────────
  const READ_KEYS = ['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel',
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    'uiLang', 'learnRules', 'listenCapture', 'listenOtherLang', 'listenMyLang', 'listenAutoSpeak'];
  function readCfg() {
    return new Promise((resolve) => {
      chrome.storage.local.get(READ_KEYS, (s) => {
        s = s || {};
        const eng = (window.MT_STT_ENGINES || []).find((e) => e.id === s.sttEngine) || null;
        const tr = LearnNotes.resolveConfig(s);
        const rules = s.learnRules && typeof s.learnRules === 'object' ? s.learnRules : {};
        const B = C.baseCode;
        const otherLang = B(s.listenOtherLang) || 'en';
        // 「我的语言」没选过就跟着界面语言走，界面语言也没选就跟系统。只在读取时回落，
        // 不往存储播种默认值 —— 播种了，用户以后改界面语言这一项就不会跟着动。
        const myLang = B(s.listenMyLang) || B(s.uiLang !== 'auto' ? s.uiLang : '')
          || B(navigator.language) || 'zh';
        resolve({
          eng, sttKey: s.sttApiKey || '', tr,
          // targetLang 从此是 myLang 的别名（原来直接读 uiLang）。留着这个名字是因为
          // draftFor 与端到端测试都在读它 —— 不在同一步里既改语义又改名字。
          targetLang: myLang,
          myLang,
          autoSpeak: s.listenAutoSpeak !== false,
          captureOn: s.listenCapture !== false,
          otherLang,
          lang: otherLang,   // 对方说的语言 = 「对方的语言」选择（进语料时的 lang）
          langs: Array.isArray(rules.langs) && rules.langs.length ? rules.langs : null,
          registry: window.MT_LANGS || [],
          label: SOURCE_LABEL(),
        });
      });
    });
  }
  function liveCapable(c) { return !!(c && c.eng && c.eng.liveEndpoint && c.eng.liveType && (c.sttKey || !c.eng.needsKey)); }

  // ── 首页入口（门控与播客模式同规矩：门不过入口不存在，留一条去设置的路）──────
  // 入口在登录前后两个首页上都有（对话不依赖账号：语料写本机，§9.6），同一门控。
  const ENTRY_SUFFIXES = ['', '2'];
  async function refreshEntry() {
    let ok = false;
    try { ok = liveCapable(await readCfg()); } catch (_) { ok = false; }
    // 门没过：入口**灰掉 + 一句原因**（用户 09-07 裁定 A），而不是消失 —— 灰掉更容易被发现，
    // 也回答了「这个按钮为什么不能用」。播客模式仍按它自己的规矩（门不过不存在）。
    for (const sfx of ENTRY_SUFFIXES) {
      const btn = $('app-listen-entry' + sfx); if (btn) { btn.hidden = false; btn.disabled = !ok; }
      const hint = $('app-listen-entry-hint' + sfx);
      if (hint) { hint.hidden = false; hint.textContent = t('listen_entry_short', '对方说，你看中文；按住说中文，译给对方'); }
      const priv = $('modes-privacy' + sfx); if (priv) { priv.hidden = !ok; priv.textContent = t('listen_entry_privacy', '音频只发往你配置的转写端点。'); }
      const need = $('app-listen-need-live' + sfx); if (need) need.hidden = ok;
    }
  }

  // ── 翻译 ──────────────────────────────────────────────────────────────────
  async function translate(text, toLang) {
    if (!cfg || !cfg.tr || !cfg.tr.provider || !cfg.tr.apiKey) return '';
    try {
      return await TranslationAPI.translate(text, toLang, TranslationAPI.resolveProvider(cfg.tr.provider), cfg.tr.apiKey, cfg.tr.baseUrl || '', cfg.tr.model || '');
    } catch (_) { return ''; }
  }
  // 方向的唯一来源：我说的译成对方的语言，对方说的译成我的语言。改边（↔）之后同一行
  // 会换一个方向重译，所以它必须**按 row.who 现算**，不能记在行上。
  function targetLangFor(row) { return row.who === 'me' ? cfg.otherLang : cfg.myLang; }

  // 一行的译文：失败要留下「译文失败 · 重试」，不是永远的 ⏳（silent-failures-need-visible-exit）
  async function translateRow(row, toLang) {
    const myGen = gen;
    row.trErr = false; row.trBusy = true; renderHistory();
    const tr = await translate(row.text, toLang == null ? targetLangFor(row) : toLang);
    if (myGen !== gen) return;
    row.trBusy = false; row.tr = tr || ''; row.trErr = !tr;
    renderHistory(); paintNowPlaying(); if (showRid === row.rid) renderShow();
    if (row.tr) maybeWrite(row);
  }

  // 归属判断的注入点。生产里就是 LearnRules.dominantScript（已在 App 包里）；
  // 拿不到它时 sideOf 恒返回空，归属全走粘性兜底 —— 不抛，也不假装判得准。
  const routeDeps = {
    dominantScript: (text) => (typeof LearnRules !== 'undefined' && LearnRules.dominantScript
      ? LearnRules.dominantScript(text) : null),
  };

  // ── 语料写入（§9.6：定稿译文首次进历史时写一次；星绕过门）────────────────────
  const deps = {
    langAllowed: (lang, text, langs, registry) => (typeof LearnRules !== 'undefined' ? LearnRules.langAllowed(lang, text, langs, registry) : true),
    shouldCapture: (draft) => (typeof LearnModel !== 'undefined' && LearnModel.shouldCapture ? LearnModel.shouldCapture(draft) : true),
  };
  async function maybeWrite(row) {
    if (!session || !C.shouldWrite(row, session, cfg, deps)) return;
    if (typeof LearnStore === 'undefined' || typeof LearnModel === 'undefined') return;
    row.written = true;   // 先标再写：写失败下一次不会重试，但也不会把同一句写两遍
    try {
      const draft = C.draftFor(row, session, cfg);
      const item = LearnModel.makeItem(draft, now());
      await LearnStore.mergeBatch([item], [C.sourceFor(session, cfg.label)]);
    } catch (_) { row.written = false; }
    renderHistory();
  }
  async function toggleStar(row) {
    row.starred = !row.starred;
    renderHistory();
    if (!row.starred) return;   // 取消星不删卡：卡已经是用户的了（同复习页的规则）
    if (row.written) {
      // 已写过：再合并一次，mergeItem 的 starred 是 OR，state 随之升为 learning
      try {
        const item = LearnModel.makeItem(C.draftFor(row, session, cfg), now());
        await LearnStore.mergeBatch([item], [C.sourceFor(session, cfg.label)], { accumulate: false });
      } catch (_) {}
      return;
    }
    await maybeWrite(row);
  }

  // ── socket ────────────────────────────────────────────────────────────────
  function openSocket() {
    const myGen = gen;
    const e = cfg.eng;
    sock = WsTranscribe.open({
      url: e.liveEndpoint, type: e.liveType, apiKey: cfg.sttKey, keyProtocol: e.liveKeyProtocol || '',
      model: e.liveModel || e.defaultModel, rate: e.liveRate || 24000, params: e.liveParams || null, langs: [],
      onEvent: (ev) => {
        if (myGen !== gen) return;
        // 我们自己关的 socket（暂停/结束）会把开口尾句 flush 成一个 final —— 那时 sock 已置空，丢掉
        if (!sock && (ev.kind === 'partial' || ev.kind === 'final')) return;
        if (ev.kind === 'ready') { socketRetried = false; }
        else if (ev.kind === 'partial') onPartial(ev.text);
        else if (ev.kind === 'final') onFinal(ev.text);
        else if (ev.kind === 'error') socketLost(ev.message || '');
        else if (ev.kind === 'close') { if (phase !== 'ended' && phase !== 'halted' && phase !== 'paused' && phase !== 'idle') socketLost(ev.reason || ''); }
      },
    });
  }
  function closeSocket() { const s = sock; sock = null; try { if (s) s.close(); } catch (_) {} }
  // socket 断了：先自动重连一次（2 s），期间主按钮「重连中…」、我说灰；再断才停在具名态。
  function socketLost(why) {
    if (!socketRetried && (phase === 'listening' || phase === 'preparing')) {
      socketRetried = true;
      halt('socket-retry', why);
      setTimeout(() => { if (phase === 'halted' && pauseReason === 'socket-retry') resume(); }, 2000);
      return;
    }
    halt('socket', why);
  }

  function onPartial(text) {
    partial = text || '';
    if (inc) inc.onPartial(partial);
    renderNow();
  }
  function onFinal(text) {
    const row = C.addFinal(session, text, now(), cfg, routeDeps);
    if (!row) return;
    partial = ''; partialTr = '';
    // 两边的定稿走同一条路，只是目标语言相反（targetLangFor）。2026-09-08 之前
    // 「我说的」在这里直接 return，等松手时整段处理 —— 那条路随按住一起没了。
    const reuse = inc ? inc.close(row.text) : '';
    renderNow(); renderHistory();
    if (reuse) { row.tr = reuse; renderHistory(); paintNowPlaying(); maybeWrite(row); }
    else translateRow(row);
  }

  // ── 麦克风：原生桥优先，页内 getUserMedia 是无桥宿主的退路 ────────────────────
  function bridged() { return typeof NativeAudio !== 'undefined' && NativeAudio.available(); }
  let pcmFrames = 0, pcmSent = 0;
  function onPcm(int16) {
    pcmFrames++;
    if (!session || !sock) return;
    if (phase !== 'listening') return;
    if (sock.sendPcm(int16) !== false) pcmSent++;
    if (phase === 'listening' && C.silenceCheck(session, C.rmsOf(int16), now())) pause('silence');
  }
  function onMicState(state, reason) {
    if (state === 'denied') halt('denied', '');
    else if (state === 'failed') halt('failed', reason);
    else if (state === 'interrupted') {
      // 刚起就被打断（3 s 内）多半是别的音频会话（页内保活/朗读走 WebKit 自己的会话）在
      // 抢，不是真的来电：带退避再试三次（0.8 / 1.6 / 3.2 s），**期间胶囊仍是「准备中」、
      // 不闪红字**；都不行才停在具名态等用户。
      if (now() - startedAt < 3000 && earlyRetries < 3) {
        const wait = 800 * Math.pow(2, earlyRetries); earlyRetries++;
        micStop(); closeSocket();
        phase = 'preparing'; paint();
        setTimeout(() => { if (phase === 'preparing') beginPipeline(); }, wait);
        return;
      }
      halt('locked', '');
    }
    else if (state === 'granted') {
      earlyRetries = 0;
      if (session) session.lastVoiceAt = now();   // 静音计时从麦克风真正开始出帧算起，不从点按算起
      if (phase === 'preparing') { phase = 'listening'; note(''); paint(); }
    }
  }
  async function micStart() {
    const rate = (cfg.eng && cfg.eng.liveRate) || 24000;
    if (bridged()) { NativeAudio.micStart(rate, { onPcm, onState: onMicState }); return true; }
    // 退路：页内采集（Chrome / 无桥）。AudioContext 必须在手势里建 —— start() 由点击触发。
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { halt(e && e.name === 'NotAllowedError' ? 'denied' : 'failed', e && e.message); return false; }
    const resample = makeResampler(audioCtx.sampleRate, rate);
    srcNode = audioCtx.createMediaStreamSource(stream);
    proc = audioCtx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
    proc.onaudioprocess = (e) => { const pcm = resample(e.inputBuffer.getChannelData(0)); if (pcm.length) onPcm(pcm); };
    srcNode.connect(proc);
    const mute = audioCtx.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(audioCtx.destination);
    proc._mute = mute;
    return true;
  }
  function micStop() {
    if (bridged()) NativeAudio.micStop();
    try { if (proc) { proc.disconnect(); if (proc._mute) proc._mute.disconnect(); } } catch (_) {}
    try { if (srcNode) srcNode.disconnect(); } catch (_) {}
    try { if (stream) stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    proc = null; srcNode = null; stream = null;
  }
  function makeResampler(fromRate, toRate) {
    const ratio = fromRate / toRate;
    let carry = new Float32Array(0);
    return (f32) => {
      const input = carry.length ? concatF32(carry, f32) : f32;
      const n = Math.floor(input.length / ratio);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
        let s = 0; for (let j = a; j < b; j++) s += input[j];
        const v = s / (b - a);
        out[i] = v < 0 ? Math.max(-32768, Math.round(v * 32768)) : Math.min(32767, Math.round(v * 32767));
      }
      carry = input.subarray(Math.floor(n * ratio));
      return out;
    };
  }
  function concatF32(a, b) { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

  // 返回 promise：**必须在启动麦克风之前放起来**。WebKit 一开始播页内媒体就会把音频会话
  // 类别改回 .playback，正在启动的录音引擎会被当场打断（2026-09-07 真机：第一次进入与
  // 结束后重开都是「起了半秒就断」，8 s 后重试才成功 —— 那时保活已在播，不再冲突）。
  async function keepAliveOn() {
    if (!bridged() || !NativeAudio.suspends()) return;
    try {
      if (!keepAlive) { keepAlive = new Audio(KEEP_ALIVE_WAV); keepAlive.loop = true; }
      await keepAlive.play();
      await new Promise((r) => setTimeout(r, 250));   // 让 WebKit 把类别动完
    } catch (_) {}
  }
  function keepAliveOff() { try { if (keepAlive) keepAlive.pause(); } catch (_) {} }

  // ── 会话生命周期 ──────────────────────────────────────────────────────────
  async function start() {
    if (phase !== 'idle' && phase !== 'ended') return;
    gen++;
    cfg = await readCfg();
    if (!liveCapable(cfg)) { note(t('listen_need_live', '「对话 · 实时听译」需要一个带实时接口的转写引擎'), true); return; }
    session = C.newSession(now(), Math.random());
    // 边说边译的方向也按半句的语言实时判：我说中文时译成外语，对方说外语时译成中文。
    // 判不出就按「对方」走 —— 与 attributeByLang 的兜底同向，免得半句和定稿打架。
    inc = C.makeIncremental((text) => translate(text,
      C.sideOf(text, cfg, routeDeps) === 'me' ? cfg.otherLang : cfg.myLang));
    inc.result((text, tr) => { if (text === partial) { partialTr = tr; renderNow(); } });
    partial = ''; partialTr = '';
    if (bridged()) { NativeAudio.recordMode(true); NativeAudio.sessionStart(); }
    $('app-listen-summary').hidden = true;
    $('app-listen-history-wrap').hidden = false;
    renderHistory();
    if (!clockTimer) clockTimer = setInterval(paintClock, 1000);
    await beginPipeline();
  }
  // 起管线：麦克风 + socket。暂停/中断之后「开始听」也走这里（同一场会话继续）。
  async function beginPipeline() {
    phase = 'preparing';
    pauseReason = '';
    note('');
    C.resume(session, now());
    openSocket();
    paint();
    startedAt = now();
    await keepAliveOn();
    if (phase !== 'preparing') return;   // 等保活的这一拍里被停掉了
    const ok = await micStart();
    if (!ok) return;
    // 桥的路：granted 事件把 preparing 切成 listening；页内的路：这里就切
    if (!bridged() && phase === 'preparing') phase = 'listening';
    paint();
  }
  let startedAt = 0, earlyRetries = 0;
  // 暂停：不再发 PCM，麦克风与 socket 都停（暂停期间不该产生任何计费）。
  function pause(reason) {
    if (phase !== 'listening') return;
    phase = 'paused'; pauseReason = reason || 'user';
    C.pause(session, now());
    micStop(); closeSocket();
    if (inc) inc.reset();
    partial = ''; partialTr = '';
    if (reason === 'silence') note(t('listen_stop_silence', '听不到声音（30 秒静音）— 已暂停以免计费。'), false);
    paint();
  }
  // 具名停止：与暂停同一形状，但原因来自外部（拒绝、连接断、被打断、启动失败）。
  function halt(reason, why) {
    if (phase === 'ended' || phase === 'idle') return;
    phase = 'halted'; pauseReason = reason;
    C.pause(session, now());
    micStop(); closeSocket();
    if (inc) inc.reset();
    partial = ''; partialTr = '';
    const why1 = String(why || '').replace(/\s+/g, ' ').slice(0, 80);
    const msg = reason === 'denied' ? t('listen_stop_denied', '麦克风被拒绝 — 去「设置 › 隐私 › 麦克风」允许大肚猴翻译。')
      : reason === 'socket' ? t('listen_stop_socket', '转写连接中断：{why} — 已听的句子还在。').replace('{why}', why1)
      : reason === 'socket-retry' ? t('listen_stop_socket_retry', '转写连接中断：{why} — 正在重连…').replace('{why}', why1)
      : reason === 'locked' ? t('listen_stop_locked', '录音被系统停止了（来电或其它 App 占用麦克风）— 挂断后会自动继续，或点「开始听」。')
      : t('listen_stop_failed', '麦克风启动失败：{why} — 再点一次「开始听」。').replace('{why}', why1);
    note(msg, true);
    paint();
  }
  async function resume() {
    if (phase !== 'paused' && phase !== 'halted') return;
    await beginPipeline();
  }
  function resumeByUser() { earlyRetries = 0; return resume(); }
  function toggle() {
    if (phase === 'listening') pause('user');
    else if (phase === 'paused' || phase === 'halted') resumeByUser();
    else if (phase === 'idle' || phase === 'ended') start();
  }
  function end() {
    if (!session || phase === 'ended') return;
    C.pause(session, now());
    phase = 'ended';
    micStop(); closeSocket(); keepAliveOff();
    if (inc) inc.reset();
    if (bridged()) { NativeAudio.sessionStop(); NativeAudio.recordMode(false); }
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    closeShow();
    renderSummary();
    paint();
  }
  // 返回 = 结束会话（语料已逐句写了，不丢）；还在听时先确认一下（用户 09-07 裁定 B）。
  // 页内确认（LearnDialog）：App 的 WKWebView 没有原生确认框，window.confirm 恒为 false。
  async function leave() {
    if (session && phase !== 'ended' && phase !== 'idle') {
      if (!(await LearnDialog.confirm(t('listen_leave_confirm', '还在听。离开会结束这次对话，已听的句子保留。'), { ok: t('listen_leave_ok', '结束并离开') }))) return;
      end();
    }
    gen++;
    if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
    session = null; phase = 'idle';
    $('app-listen').hidden = true;
    $(cameFrom).hidden = false;
  }
  function open() {
    cameFrom = $('signed-in').hidden ? 'signed-out' : 'signed-in';
    $(cameFrom).hidden = true;
    $('app-listen').hidden = false;
    $('app-listen-summary').hidden = true;
    note('');
    renderHistory(); renderNow();
    start();
  }

  // ── 我说（按住说话）────────────────────────────────────────────────────────
  // ── ↔ 改边（归属判错时用户点一下）──────────────────────────────────────────
  //
  // 一次点击要做完五件事，顺序是硬的：**先按旧方向算出已写进语料的那张卡，再翻转** ——
  // 反过来就算不出它的 id 了（语料里「学的永远是外语那一面」，改边会让两面互换）。
  async function flipRow(row) {
    if (!row || !session) return;
    const before = C.flipWho(row);          // 翻转并钉住，交回旧方向的快照

    // ① 回收旧卡。走 deleteItems 而不是绕过账本：它写删除账本，会同步到别的设备。
    if (row.written && typeof LearnStore !== 'undefined' && typeof LearnModel !== 'undefined') {
      row.written = false;                  // 新方向的卡等译文到了再按正常的门写一次
      try {
        const old = C.draftFor(Object.assign({}, row, before), session, cfg);
        const n = await LearnStore.deleteItems([LearnModel.itemId(old.lang, old.text)], now());
        // deleteItems 返回**真删掉的条数**。0 = 那张卡被「用户已经复习过」的保护挡下了
        // （也可能它早被淘汰了，但那时这句提示无害）。如实说一声，不假装删干净了。
        if (!n) note(t('listen_flip_kept_card',
          '改边了 · 之前那张卡你已经复习过，留在「来源 › 对话」里'), false);
      } catch (_) { /* 删不掉不该挡住改边本身 */ }
    }

    // ② 正在朗读这一行就停掉 —— 那句译文已经不对了。
    if (speakingRid === row.rid) { speakingRid = 0; if (typeof LearnTTS !== 'undefined') LearnTTS.stop(); }

    // ③ 按新方向重译。**不自动重读**：用户翻历史点 ↔ 时突然大声念一句是最吓人的副作用，
    //    而且改边这个动作本身说明前一次朗读已经发生过了，再读一遍没有新信息。
    row.tr = ''; row.trErr = false;
    renderHistory();
    if (showRid === row.rid) renderShow();
    translateRow(row);
  }

  // ── 放大给对方看（历史行叠层，底下照常在听）────────────────────────────────
  function ttsReady() { return typeof LearnTTS !== 'undefined' && !!(LearnTTS.engine && LearnTTS.engine()); }
  function foreignOf(row) { return row.who === 'me' ? row.tr : row.text; }
  function nativeOf(row) { return row.who === 'me' ? row.text : row.tr; }
  function openShow(row) {
    if (!row) return;
    showRid = row.rid;
    renderShow();
  }
  function renderShow() {
    const box = $('app-listen-flip');
    const row = session && session.rows.find((r) => r.rid === showRid);
    if (!row) { box.hidden = true; showRid = 0; return; }
    const big = foreignOf(row), small = nativeOf(row);
    $('app-listen-flip-text').textContent = big || (row.trErr ? t('listen_tr_failed', '译文失败 · 重试') : t('listen_pending', '⏳ 译文准备中…'));
    $('app-listen-flip-sub').textContent = small || '';
    $('app-listen-flip-again').hidden = !(ttsReady() && big);
    box.hidden = false;
  }
  function closeShow() {
    showRid = 0;
    $('app-listen-flip').hidden = true;
    $('app-listen-flip-speaking').hidden = true;
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
  }
  let speakOutGen = 0;
  async function speakOut(text) {
    if (!ttsReady() || !text) return null;
    const my = ++speakOutGen;
    const mark = $('app-listen-flip-speaking');
    let r = null;
    try { mark.hidden = false; r = await LearnTTS.speak(text, cfg.otherLang); }
    catch (_) { r = null; }
    if (my === speakOutGen) mark.hidden = true;
    return r;
  }

  // ── 锁屏卡片（复用 §9.5 的 Now Playing 通道）────────────────────────────────
  function paintNowPlaying() {
    if (!bridged() || !session) return;
    const last = session.rows.length ? session.rows[session.rows.length - 1] : null;
    const listening = phase === 'listening';
    NativeAudio.playingState(listening);
    NativeAudio.nowPlaying({
      title: last ? last.text : t('listen_np_title', '对话 · 实时听译中'),
      subtitle: last ? (last.tr || t('listen_pending', '⏳ 译文准备中…')) : '',
      album: t('listen_np_album', '对话 · 实时听译中 · {t} · {n} 句')
        .replace('{t}', C.fmtClock(C.listenedMs(session, now()))).replace('{n}', String(session.rows.length)),
    });
  }
  function onNative(msg) {
    if (!msg || $('app-listen').hidden || !session) return;
    if (msg.type === 'remote') {
      if (msg.command === 'pause') { if (phase === 'listening') pause('user'); }
      else if (msg.command === 'play') { if (phase === 'paused' || phase === 'halted') resumeByUser(); }
      else if (msg.command === 'toggle') toggle();
    } else if (msg.type === 'interrupt' && msg.phase === 'begin') {
      if (phase === 'listening') halt('locked', '');
    } else if (msg.type === 'interrupt' && msg.phase === 'end') {
      // 中断结束且系统说可以继续（来电挂断、别的 App 放开麦克风）⇒ 自动续听 ——
      // 与播客模式 §9.5 的「.shouldResume 才自动续播」同一条规则；没有它就等用户点。
      if (msg.resume && phase === 'halted' && pauseReason === 'locked') resume();
    }
  }

  // ── 界面 ──────────────────────────────────────────────────────────────────
  function note(msg, isErr) {
    const el = $('app-listen-note'); if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }
  function paintClock() {
    if (!session) return;
    const ms = C.listenedMs(session, now());
    const pill = $('app-listen-pill');
    const listening = phase === 'listening';
    pill.textContent = phase === 'preparing' ? t('listen_pill_preparing', '准备中')
      : listening ? t('listen_pill_listening', '听译中 · {t}').replace('{t}', C.fmtClock(ms))
      : phase === 'ended' ? t('listen_pill_ended', '已结束 · {t}').replace('{t}', C.fmtClock(ms))
      : t('listen_pill_paused', '已暂停 · {t}').replace('{t}', C.fmtClock(ms));
    pill.classList.toggle('live', listening);
    $('app-listen-cost').textContent = t('listen_cost_line', '已听 {t} · 音频只发往你配置的转写端点').replace('{t}', C.fmtClock(ms));
    if (listening && (Math.floor(ms / 1000) % 5 === 0)) paintNowPlaying();
  }
  function paint() {
    const active = phase === 'listening';
    const ended = phase === 'ended';
    // 表 1（画布「状态与转移」）：每个状态下每个控件的样子。灰 = 45% 透明 + 文案不变，
    // 且屏上一定有原因（胶囊或红字行）。
    const tog = $('app-listen-toggle');
    tog.textContent = phase === 'listening' ? t('listen_toggle_pause', '● 正在听 · 暂停')
      : phase === 'preparing' ? t('listen_toggle_preparing', '准备中…')
      : (phase === 'halted' && pauseReason === 'socket-retry') ? t('listen_toggle_reconnecting', '重连中…')
      : t('listen_toggle_start', '开始听');
    tog.disabled = phase === 'preparing' || (phase === 'halted' && pauseReason === 'socket-retry');
    // 结束后两个按钮不出现（要说话就「再来一段」）；小结卡替换上卡，历史留着
    const grid = $('app-listen-actions'); if (grid) grid.hidden = ended;
    const nowCard = $('app-listen-now'); if (nowCard) nowCard.hidden = ended;
    $('app-listen-end').hidden = !session || ended;
    // 双向，所以是 ⇄ 而不是 → ：两边都可能说话，没有固定的「从」和「到」。
    $('app-listen-lang').textContent = t('listen_lang_pair', '{a} ⇄ {b}')
      .replace('{a}', langLabel(cfg && cfg.myLang)).replace('{b}', langLabel(cfg && cfg.otherLang));
    // 上卡的归属**按半句实时判**：句子还没定稿就先给出归属，判错了用户当场看得见，
    // 而不是等整句出来才发现。判不出就说「正在说…」，不假装知道。
    const side = partial ? C.sideOf(partial, cfg, routeDeps) : '';
    $('app-listen-now-label').textContent = side === 'me' ? t('listen_now_me', '我正在说')
      : side === 'them' ? t('listen_now_them', '对方正在说')
        : t('listen_now_any', '正在说…');
    $('app-listen-live').hidden = !active;
    paintClock();
    paintNowPlaying();
    renderNow();
  }
  function langLabel(code) {
    const c = String(code || '');
    const base = c.split('-')[0].toLowerCase();
    const e = (window.MT_LANGS || []).find((l) => l.code === base || l.code === c);
    return e ? (e.labelKey ? t(e.labelKey, e.label) : e.label) : c;
  }
  function renderNow() {
    const p = $('app-listen-partial'), q = $('app-listen-partial-tr');
    if (!p) return;
    p.textContent = partial || '';
    q.textContent = partial && partialTr ? partialTr + '…' : '';
  }
  function renderHistory() {
    const list = $('app-listen-history'); if (!list) return;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 12;
    list.textContent = '';
    const rows = session ? session.rows : [];
    if (!rows.length) {
      // 刚开始、还没有一句定稿：一句引导，不是空白
      const e = document.createElement('div'); e.className = 'listen-empty';
      e.textContent = t('listen_history_empty', '双方随便说，每句定稿后会出现在这里；判错了点 ↔ 改边');
      list.appendChild(e);
    }
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 'listen-row' + (r.who === 'me' ? ' me' : '');
      // 归属标。判不出、靠粘性或兜底得来的标虚线 —— 用户一眼看得出哪几行是猜的。
      const who = document.createElement('span');
      who.className = 'listen-who' + (r.guessed && !r.pinned ? ' guessed' : '');
      who.textContent = r.who === 'me' ? t('listen_who_me', '我') : t('listen_who_them', '对方');
      if (r.guessed && !r.pinned) who.title = t('listen_who_guessed', '按语言猜的 · 点 ↔ 改');
      row.appendChild(who);
      const body = document.createElement('div'); body.className = 'listen-body';
      body.setAttribute('role', 'button');
      const o = document.createElement('div'); o.className = 'listen-orig';
      o.textContent = r.text;
      body.appendChild(o);
      if (r.trErr) {
        // 翻译失败要留下出口，不是永远的 ⏳
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'listen-tr-retry';
        retry.textContent = t('listen_tr_failed', '译文失败 · 重试');
        retry.addEventListener('click', (e) => { e.stopPropagation(); translateRow(r); });
        body.appendChild(retry);
      } else {
        const tr = document.createElement('div'); tr.className = 'listen-tr' + (r.tr ? '' : ' pending');
        tr.textContent = r.tr || t('listen_pending', '⏳ 译文准备中…');
        body.appendChild(tr);
      }
      if (r.tr) {
        // 两边的行都给「朗读」与「给对方看」：洽谈里我可能要把对方那句的中文放大给
        // 自己看，也可能要把我这句的外语再读一遍给对方听。
        const acts = document.createElement('div'); acts.className = 'listen-row-acts';
        if (ttsReady()) {
          const rd = document.createElement('button'); rd.type = 'button';
          rd.className = 'listen-act' + (speakingRid === r.rid ? ' on' : '');
          rd.textContent = speakingRid === r.rid ? t('listen_reading', '朗读中') : t('listen_read_aloud', '朗读');
          rd.addEventListener('click', (e) => { e.stopPropagation(); speakOut(r.tr, targetLangFor(r), { rid: r.rid }); });
          acts.appendChild(rd);
        }
        const sh = document.createElement('button'); sh.type = 'button'; sh.className = 'listen-act';
        sh.textContent = t('listen_show_other', '给对方看');
        sh.addEventListener('click', (e) => { e.stopPropagation(); openShow(r); });
        acts.appendChild(sh);
        body.appendChild(acts);
      }
      body.addEventListener('click', () => { openShow(r); });
      // ↔ 改边。无障碍名说的是**结果**（改成谁说的），不是符号本身。
      const swap = document.createElement('button'); swap.type = 'button'; swap.className = 'listen-swap';
      swap.textContent = '↔';
      swap.setAttribute('aria-label', r.who === 'me'
        ? t('listen_swap_to_them', '改成对方说的') : t('listen_swap_to_me', '改成我说的'));
      swap.addEventListener('click', (e) => { e.stopPropagation(); flipRow(r); });
      const star = document.createElement('button'); star.type = 'button'; star.className = 'listen-star' + (r.starred ? ' on' : '');
      star.textContent = r.starred ? '★' : '☆';
      star.setAttribute('aria-label', t('listen_star', '加星'));
      star.addEventListener('click', (e) => { e.stopPropagation(); toggleStar(r); });
      row.appendChild(body); row.appendChild(swap); row.appendChild(star);
      list.appendChild(row);
    }
    $('app-listen-history-title').textContent = t('listen_history', '整句定稿') + (rows.length ? ' · ' + rows.length : '');
    const cp = $('app-listen-copy'); if (cp) { cp.hidden = !rows.length; if (!cp.dataset.flash) cp.textContent = t('listen_copy_all', '复制全文'); }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  function renderSummary() {
    const s = C.summary(session, now());
    $('app-listen-summary-body').textContent = t('listen_summary_body', '时长 {t} · 对方说了 {them} 句 · 我说了 {me} 句 · 进复习（来源「对话」）{n} 句 · 含 {s} 句加星')
      .replace('{t}', C.fmtClock(s.seconds * 1000)).replace('{them}', String(s.them)).replace('{me}', String(s.me))
      .replace('{n}', String(s.written)).replace('{s}', String(s.starred));
    $('app-listen-summary').hidden = false;
  }

  // ── 接线 ──────────────────────────────────────────────────────────────────
  function wire() {
    for (const sfx of ENTRY_SUFFIXES) {
      const entry = $('app-listen-entry' + sfx);
      if (entry) { const title = entry.querySelector('.mode-title'); (title || entry).textContent = t('listen_entry', '对话 · 实时听译'); entry.addEventListener('click', open); }
      const why = $('app-listen-need-live-why' + sfx); if (why) why.textContent = t('listen_need_live', '「对话 · 实时听译」需要一个带实时接口的转写引擎');
      const go = $('app-listen-need-live-go' + sfx); if (go) go.textContent = t('listen_need_live_go', '去设置里选择 →');
    }
    refreshEntry();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area && area !== 'local') return;
        if (['sttEngine', 'sttApiKey', 'sttBaseUrl'].some((k) => k in (changes || {}))) refreshEntry();
      });
    } catch (_) {}

    $('app-listen-back').textContent = t('app_listen_back', '‹ 返回');
    $('app-listen-title').textContent = t('listen_title', '对话');
    $('app-listen-history-title').textContent = t('listen_history', '整句定稿');
    $('app-listen-end').textContent = t('listen_end', '结束');
    $('app-listen-copy').textContent = t('listen_copy_all', '复制全文');
    const mn = $('app-listen-mac-note'); mn.textContent = t('listen_mac_use', '线上会议、视频通话也能用：让对方的声音从扬声器放出来即可。'); mn.hidden = !isMacHost();
    $('app-listen-flip-hint').textContent = t('listen_flip_hint', '给对方看 · 点任意处返回');
    $('app-listen-flip-speaking').textContent = t('listen_flip_speaking', '朗读中');
    $('app-listen-flip-again').textContent = t('listen_read_aloud', '朗读');
    $('app-listen-flip-back').textContent = t('listen_close', '关闭');
    $('app-listen-summary-title').textContent = t('listen_summary_title', '这次对话');
    $('app-listen-summary-note').textContent = t('listen_summary_note', '录音已丢弃；只保留文字。进复习的句子可在「来源 › 对话」里管理或整段删除。');
    $('app-listen-summary-home').textContent = t('listen_summary_home', '回到首页');
    $('app-listen-summary-again').textContent = t('listen_summary_again', '再来一段');
    $('app-listen-my-label').textContent = t('listen_lang_me_label', '我');
    $('app-listen-other-label').textContent = t('listen_lang_other_label', '对方');
    $('app-listen-autospeak-label').textContent = t('listen_autospeak_label', '自动朗读译文');

    // 语言对：两个下拉从语言注册表列，与设置页那两个是同一份设置（listenMyLang /
    // listenOtherLang）。选重了不是拒绝而是对调 —— 判据在 ListenCore.langPatch。
    const selMy = $('app-listen-my'), selOther = $('app-listen-other');
    for (const sel of [selMy, selOther]) {
      sel.textContent = '';
      for (const l of (window.MT_LANGS || [])) {
        const o = document.createElement('option'); o.value = l.code;
        o.textContent = l.labelKey ? t(l.labelKey, l.label) : l.label;
        sel.appendChild(o);
      }
    }
    function paintLangs(s) {
      const B = C.baseCode;
      selOther.value = B(s.listenOtherLang) || 'en';
      selMy.value = B(s.listenMyLang) || B(s.uiLang !== 'auto' ? s.uiLang : '')
        || B(navigator.language) || 'zh';
      $('app-listen-autospeak').checked = s.listenAutoSpeak !== false;
    }
    chrome.storage.local.get(['listenOtherLang', 'listenMyLang', 'listenAutoSpeak', 'uiLang'], (s) => paintLangs(s || {}));
    for (const [which, sel] of [['my', selMy], ['other', selOther]]) {
      sel.addEventListener('change', () => {
        const prev = which === 'my'
          ? { myLang: (cfg && cfg.myLang) || '', otherLang: selOther.value }
          : { myLang: selMy.value, otherLang: (cfg && cfg.otherLang) || '' };
        const p = C.langPatch(which, sel.value, prev);
        const swapped = p.swapped; delete p.swapped;
        chrome.storage.local.set(p);
        if (p.listenMyLang !== undefined) selMy.value = C.baseCode(p.listenMyLang);
        if (p.listenOtherLang !== undefined) selOther.value = C.baseCode(p.listenOtherLang);
        if (cfg) {
          cfg.myLang = selMy.value; cfg.targetLang = selMy.value;
          cfg.otherLang = selOther.value; cfg.lang = selOther.value;
        }
        // 语言不下发给转写端（langs 恒为空数组，厂商自动检测），所以改语言**不重连**，
        // 只影响翻译方向与归属判断。已定稿的行不动 —— 要改用行尾的 ↔。
        if (swapped) note(t('listen_lang_swapped', '两边不能是同一种语言 — 已对调'), false);
        if (session) paint();
      });
    }
    $('app-listen-autospeak').addEventListener('change', () => {
      const on = $('app-listen-autospeak').checked;
      chrome.storage.local.set({ listenAutoSpeak: on });
      if (cfg) cfg.autoSpeak = on;
    });

    $('app-listen-back').addEventListener('click', leave);
    $('app-listen-toggle').addEventListener('click', toggle);
    $('app-listen-end').addEventListener('click', end);
    $('app-listen-copy').addEventListener('click', async () => {
      const cp = $('app-listen-copy');
      const text = ListenCore.transcriptText(session, t('listen_me_prefix', '我：'));
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
        // 无剪贴板 API 的宿主：退到选区复制
        try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (_2) { ok = false; }
      }
      cp.dataset.flash = '1';
      cp.textContent = ok ? t('listen_copied', '已复制') : t('listen_copy_failed', '复制失败');
      setTimeout(() => { delete cp.dataset.flash; cp.textContent = t('listen_copy_all', '复制全文'); }, 1500);
    });
    $('app-listen-summary-home').addEventListener('click', leave);
    $('app-listen-summary-again').addEventListener('click', () => { phase = 'idle'; start(); });

    // 按住说话：pointer 三件套 + 键盘（macOS：按住空格）

    const flip = $('app-listen-flip');
    flip.addEventListener('click', (e) => { if (e.target.closest('button')) return; closeShow(); });
    $('app-listen-flip-back').addEventListener('click', closeShow);
    $('app-listen-flip-again').addEventListener('click', () => {
      const row = session && session.rows.find((r) => r.rid === showRid);
      if (row) speakOut(foreignOf(row));
    });

    if (bridged()) NativeAudio.onEvent(onNative);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && session) paint(); });
  }

  return { wire, open, leave, start, pause, resume, end, refreshEntry,
    _debug: () => ({ phase, pauseReason, showRid, rows: session ? session.rows.slice() : [], partial, partialTr, id: session && session.id,
      pcmFrames, pcmSent, sock: !!sock, bridged: bridged(), ctx: audioCtx ? audioCtx.state : null, track: stream && stream.getAudioTracks()[0] ? stream.getAudioTracks()[0].readyState : null }) };
})();
