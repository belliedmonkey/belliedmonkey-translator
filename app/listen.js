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
  // phase: 'idle' | 'listening' | 'speaking' | 'showing' | 'paused' | 'halted' | 'ended'
  let phase = 'idle';
  let pauseReason = '';     // 'user' | 'silence' | 'denied' | 'socket' | 'locked' | 'failed'
  let session = null;
  let cfg = null;
  let sock = null;
  let inc = null;           // 边说边译（ListenCore.makeIncremental）
  let partial = '', partialTr = '';
  let clockTimer = 0;
  let cameFrom = 'signed-in';
  let gen = 0;              // 会话代际：旧会话的异步回调按它作废
  let holdRowsFrom = 0;     // 这一次按住开始时的 seq，松手时把之后的「我」行合并
  let speakGen = 0;
  // 页内麦克风（无桥宿主的退路）
  let audioCtx = null, stream = null, proc = null, srcNode = null;

  const now = () => Date.now();

  // ── 设置 ──────────────────────────────────────────────────────────────────
  const READ_KEYS = ['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel',
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    'uiLang', 'learnRules', 'listenCapture', 'listenOtherLang'];
  function readCfg() {
    return new Promise((resolve) => {
      chrome.storage.local.get(READ_KEYS, (s) => {
        s = s || {};
        const eng = (window.MT_STT_ENGINES || []).find((e) => e.id === s.sttEngine) || null;
        const tr = LearnNotes.resolveConfig(s);
        const rules = s.learnRules && typeof s.learnRules === 'object' ? s.learnRules : {};
        const otherLang = s.listenOtherLang || 'en';
        resolve({
          eng, sttKey: s.sttApiKey || '', tr,
          targetLang: s.uiLang || (navigator.language || 'zh-CN'),
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
  async function refreshEntry() {
    const btn = $('app-listen-entry');
    if (!btn) return;
    try {
      const c = await readCfg();
      const ok = liveCapable(c);
      btn.hidden = !ok;
      const hint = $('app-listen-entry-hint');
      if (hint) { hint.hidden = !ok; hint.textContent = t('listen_entry_hint', '线下听外语：对方说，你看中文；按住说中文，译成外语给对方。音频只发往你配置的转写端点。'); }
      const need = $('app-listen-need-live');
      if (need) need.hidden = ok;
    } catch (_) { btn.hidden = true; }
  }

  // ── 翻译 ──────────────────────────────────────────────────────────────────
  async function translate(text, toLang) {
    if (!cfg || !cfg.tr || !cfg.tr.provider || !cfg.tr.apiKey) return '';
    try {
      return await TranslationAPI.translate(text, toLang, TranslationAPI.resolveProvider(cfg.tr.provider), cfg.tr.apiKey, cfg.tr.baseUrl || '', cfg.tr.model || '');
    } catch (_) { return ''; }
  }

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
        if (ev.kind === 'partial') onPartial(ev.text);
        else if (ev.kind === 'final') onFinal(ev.text);
        else if (ev.kind === 'error') halt('socket', ev.message || '');
        else if (ev.kind === 'close') { if (phase !== 'ended' && phase !== 'halted' && phase !== 'paused') halt('socket', ev.reason || ''); }
      },
    });
  }
  function closeSocket() { const s = sock; sock = null; try { if (s) s.close(); } catch (_) {} }

  function onPartial(text) {
    partial = text || '';
    if (phase === 'speaking') { renderNow(); return; }
    if (inc) inc.onPartial(partial);
    renderNow();
  }
  function onFinal(text) {
    const row = C.addFinal(session, text, now());
    if (!row) return;
    partial = ''; partialTr = '';
    if (row.who === 'me') { renderNow(); renderHistory(); return; }   // 我说的：松手时整段处理
    const reuse = inc ? inc.close(row.text) : '';
    renderNow(); renderHistory();
    const finish = (tr) => { row.tr = tr || ''; renderHistory(); paintNowPlaying(); if (row.tr) maybeWrite(row); };
    if (reuse) finish(reuse);
    else { const myGen = gen; translate(row.text, cfg.targetLang).then((tr) => { if (myGen === gen) finish(tr); }); }
  }

  // ── 麦克风：原生桥优先，页内 getUserMedia 是无桥宿主的退路 ────────────────────
  function bridged() { return typeof NativeAudio !== 'undefined' && NativeAudio.available(); }
  function onPcm(int16) {
    if (!session || !sock) return;
    if (phase !== 'listening' && phase !== 'speaking') return;
    sock.sendPcm(int16);
    if (phase === 'listening' && C.silenceCheck(session, C.rmsOf(int16), now())) pause('silence');
  }
  function onMicState(state, reason) {
    if (state === 'denied') halt('denied', '');
    else if (state === 'failed') halt('failed', reason);
    else if (state === 'interrupted') halt('locked', '');
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

  function keepAliveOn() {
    if (!bridged() || !NativeAudio.suspends()) return;
    try { if (!keepAlive) { keepAlive = new Audio(KEEP_ALIVE_WAV); keepAlive.loop = true; } keepAlive.play().catch(() => {}); } catch (_) {}
  }
  function keepAliveOff() { try { if (keepAlive) keepAlive.pause(); } catch (_) {} }

  // ── 会话生命周期 ──────────────────────────────────────────────────────────
  async function start() {
    if (phase !== 'idle' && phase !== 'ended') return;
    gen++;
    cfg = await readCfg();
    if (!liveCapable(cfg)) { note(t('listen_need_live', '「对话 · 实时听译」需要一个带实时接口的转写引擎'), true); return; }
    session = C.newSession(now(), Math.random());
    inc = C.makeIncremental((text) => translate(text, cfg.targetLang));
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
    phase = 'listening'; pauseReason = '';
    note('');
    C.resume(session, now());
    openSocket();
    paint();
    const ok = await micStart();
    if (!ok) return;
    keepAliveOn();
    paint();
  }
  // 暂停：不再发 PCM，麦克风与 socket 都停（暂停期间不该产生任何计费）。
  function pause(reason) {
    if (phase !== 'listening' && phase !== 'speaking') return;
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
    if (phase === 'showing') { speakGen++; $('app-listen-flip').hidden = true; }
    phase = 'halted'; pauseReason = reason;
    C.pause(session, now());
    session.speaking = false;
    micStop(); closeSocket();
    if (inc) inc.reset();
    partial = ''; partialTr = '';
    const why1 = String(why || '').replace(/\s+/g, ' ').slice(0, 80);
    const msg = reason === 'denied' ? t('listen_stop_denied', '麦克风被拒绝 — 去「设置 › 隐私 › 麦克风」允许大肚猴翻译。')
      : reason === 'socket' ? t('listen_stop_socket', '转写连接中断：{why} — 已听的句子还在。').replace('{why}', why1)
      : reason === 'locked' ? t('listen_stop_locked', '录音被系统停止了 — 点「开始听」继续。')
      : t('listen_stop_failed', '麦克风启动失败：{why}').replace('{why}', why1);
    note(msg, true);
    paint();
  }
  async function resume() {
    if (phase !== 'paused' && phase !== 'halted') return;
    await beginPipeline();
  }
  function toggle() {
    if (phase === 'listening') pause('user');
    else if (phase === 'paused' || phase === 'halted') resume();
    else if (phase === 'idle' || phase === 'ended') start();
  }
  function end() {
    if (!session || phase === 'ended') return;
    speakGen++;
    C.pause(session, now());
    phase = 'ended';
    session.speaking = false;
    micStop(); closeSocket(); keepAliveOff();
    if (inc) inc.reset();
    if (bridged()) { NativeAudio.sessionStop(); NativeAudio.recordMode(false); }
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    $('app-listen-flip').hidden = true;
    renderSummary();
    paint();
  }
  function leave() {
    if (session && phase !== 'ended') end();
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
  function speakBegin() {
    if (phase !== 'listening') return;
    phase = 'speaking';
    holdRowsFrom = session.seq;
    C.holdStart(session, now());
    if (inc) inc.reset();
    partial = ''; partialTr = '';
    paint();
  }
  async function speakEnd() {
    if (phase !== 'speaking') return;
    const open = partial;
    C.holdEnd(session, now());
    phase = 'showing';
    paint();
    const myGen = ++speakGen;
    // 等端点检测把最后一句闭合（松手后的尾巴，HOLD_TAIL_MS），再合并成一段
    await new Promise((r) => setTimeout(r, C.HOLD_TAIL_MS));
    if (myGen !== speakGen || phase !== 'showing') return;
    const mine = session.rows.filter((r) => r.who === 'me' && r.rid > holdRowsFrom);
    let text = mine.map((r) => r.text).join(' ').trim();
    if (!text && open) text = open.trim();
    // 合并：留第一行，文本换成整段；其余行拿掉
    let row = mine[0];
    if (!row && text) { session.speaking = true; row = C.addFinal(session, text, now()); session.speaking = false; }
    for (const r of mine.slice(1)) { const i = session.rows.indexOf(r); if (i >= 0) session.rows.splice(i, 1); }
    if (!row) { phase = 'listening'; paint(); return; }
    row.text = text;
    partial = ''; partialTr = '';
    renderHistory();
    showFlip(row, '');
    const tr = await translate(text, cfg.otherLang);
    if (myGen !== speakGen) return;
    row.tr = tr;
    renderHistory();
    showFlip(row, tr);
    if (tr) { maybeWrite(row); speakOut(tr); }
  }
  function showFlip(row, tr) {
    $('app-listen-flip-text').textContent = tr || t('listen_pending', '⏳ 译文准备中…');
    $('app-listen-flip-sub').textContent = row.text;
    $('app-listen-flip').hidden = false;
    $('app-listen-flip').dataset.rid = String(row.rid);
  }
  async function speakOut(text) {
    if (typeof LearnTTS === 'undefined') return null;
    const mark = $('app-listen-flip-speaking');
    let r = null;
    try { mark.hidden = false; r = await LearnTTS.speak(text, cfg.otherLang); }
    catch (_) { r = null; }
    // 没有 TTS 引擎 / 没音色：只显示不朗读，不道歉（能力语义）
    mark.hidden = true;
    return r;
  }
  function flipBack() {
    if (phase !== 'showing') return;
    speakGen++;
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    $('app-listen-flip').hidden = true;
    phase = 'listening';
    session.speaking = false;
    paint();
  }

  // ── 锁屏卡片（复用 §9.5 的 Now Playing 通道）────────────────────────────────
  function paintNowPlaying() {
    if (!bridged() || !session) return;
    const last = session.rows.length ? session.rows[session.rows.length - 1] : null;
    const listening = phase === 'listening' || phase === 'speaking';
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
      else if (msg.command === 'play') { if (phase === 'paused' || phase === 'halted') resume(); }
      else if (msg.command === 'toggle') toggle();
    } else if (msg.type === 'interrupt' && msg.phase === 'begin') {
      if (phase === 'listening' || phase === 'speaking') halt('locked', '');
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
    pill.textContent = (phase === 'speaking' || phase === 'showing') ? t('listen_pill_speaking', '我在说 · 对方的声音暂不听')
      : listening ? t('listen_pill_listening', '听译中 · {t}').replace('{t}', C.fmtClock(ms))
      : phase === 'ended' ? t('listen_pill_ended', '已结束 · {t}').replace('{t}', C.fmtClock(ms))
      : t('listen_pill_paused', '已暂停 · {t}').replace('{t}', C.fmtClock(ms));
    pill.classList.toggle('live', listening);
    $('app-listen-cost').textContent = t('listen_cost_line', '已听 {t} · 音频只发往你配置的转写端点').replace('{t}', C.fmtClock(ms));
    if (listening && (Math.floor(ms / 1000) % 5 === 0)) paintNowPlaying();
  }
  function paint() {
    const active = phase === 'listening' || phase === 'speaking' || phase === 'showing';
    const tog = $('app-listen-toggle');
    tog.textContent = phase === 'listening' ? t('listen_toggle_pause', '● 正在听 · 暂停')
      : (phase === 'paused' || phase === 'halted' || phase === 'ended' || phase === 'idle') ? t('listen_toggle_start', '开始听')
      : t('listen_toggle_pause', '● 正在听 · 暂停');
    tog.disabled = phase === 'speaking' || phase === 'showing';
    const spk = $('app-listen-speak');
    spk.textContent = phase === 'speaking' ? t('listen_speak_release', '松手 · 译给对方') : t('listen_speak_hold', '按住 · 我说');
    spk.disabled = !(phase === 'listening' || phase === 'speaking');
    spk.classList.toggle('holding', phase === 'speaking');
    $('app-listen-end').hidden = !session || phase === 'ended';
    $('app-listen-lang').textContent = (phase === 'speaking' || phase === 'showing')
      ? t('listen_lang_me', '中文 → {to}').replace('{to}', langLabel(cfg && cfg.otherLang))
      : t('listen_lang_auto', '{from} → {to}').replace('{from}', langLabel(cfg && cfg.otherLang)).replace('{to}', langLabel(cfg && cfg.targetLang));
    $('app-listen-now-label').textContent = (phase === 'speaking') ? t('listen_now_me', '我正在说（松手即译）') : t('listen_now_them', '对方正在说');
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
    q.textContent = (phase === 'speaking') ? '' : (partial && partialTr ? partialTr + '…' : '');
  }
  function renderHistory() {
    const list = $('app-listen-history'); if (!list) return;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 12;
    list.textContent = '';
    const rows = session ? session.rows : [];
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 'listen-row' + (r.who === 'me' ? ' me' : '');
      const body = document.createElement('div'); body.className = 'listen-body';
      const o = document.createElement('div'); o.className = 'listen-orig';
      o.textContent = (r.who === 'me' ? t('listen_me_prefix', '我：') : '') + r.text;
      const tr = document.createElement('div'); tr.className = 'listen-tr' + (r.tr ? '' : ' pending');
      tr.textContent = r.tr || t('listen_pending', '⏳ 译文准备中…');
      body.appendChild(o); body.appendChild(tr);
      const star = document.createElement('button'); star.type = 'button'; star.className = 'listen-star' + (r.starred ? ' on' : '');
      star.textContent = r.starred ? '★' : '☆';
      star.setAttribute('aria-label', t('listen_star', '加星'));
      star.addEventListener('click', () => { toggleStar(r); });
      row.appendChild(body); row.appendChild(star);
      list.appendChild(row);
    }
    $('app-listen-history-title').textContent = t('listen_history', '整句定稿') + (rows.length ? ' · ' + rows.length : '');
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
    const entry = $('app-listen-entry');
    if (entry) {
      entry.textContent = t('listen_entry', '🎙 对话 · 实时听译');
      entry.addEventListener('click', open);
    }
    const why = $('app-listen-need-live-why'); if (why) why.textContent = t('listen_need_live', '「对话 · 实时听译」需要一个带实时接口的转写引擎');
    const go = $('app-listen-need-live-go'); if (go) go.textContent = t('listen_need_live_go', '去设置里选择 →');
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
    $('app-listen-flip-hint').textContent = t('listen_flip_hint', '给对方看 · 点任意处返回');
    $('app-listen-flip-speaking').textContent = t('listen_flip_speaking', '朗读中');
    $('app-listen-flip-again').textContent = t('listen_flip_again', '再读一遍');
    $('app-listen-flip-back').textContent = t('listen_flip_back', '继续听对方');
    $('app-listen-summary-title').textContent = t('listen_summary_title', '这次对话');
    $('app-listen-summary-note').textContent = t('listen_summary_note', '录音已丢弃；只保留文字。进复习的句子可在「来源 › 对话」里管理或整段删除。');
    $('app-listen-summary-home').textContent = t('listen_summary_home', '回到首页');
    $('app-listen-summary-again').textContent = t('listen_summary_again', '再来一段');
    $('app-listen-other-label').textContent = t('listen_other_lang_label', '对方的语言');

    // 对方的语言：从语言注册表列，记住选择（listenOtherLang）。用于「我说」的目标语言，
    // 与对方句子进语料时的 lang。
    const sel = $('app-listen-other');
    sel.textContent = '';
    for (const l of (window.MT_LANGS || [])) {
      const o = document.createElement('option'); o.value = l.code; o.textContent = l.labelKey ? t(l.labelKey, l.label) : l.label;
      sel.appendChild(o);
    }
    chrome.storage.local.get(['listenOtherLang'], (s) => { sel.value = (s && s.listenOtherLang) || 'en'; if (!sel.value) sel.value = 'en'; });
    sel.addEventListener('change', () => { chrome.storage.local.set({ listenOtherLang: sel.value }); if (cfg) { cfg.otherLang = sel.value; cfg.lang = sel.value; } if (session) paint(); });

    $('app-listen-back').addEventListener('click', leave);
    $('app-listen-toggle').addEventListener('click', toggle);
    $('app-listen-end').addEventListener('click', end);
    $('app-listen-summary-home').addEventListener('click', leave);
    $('app-listen-summary-again').addEventListener('click', () => { phase = 'idle'; start(); });

    // 按住说话：pointer 三件套 + 键盘（macOS：按住空格）
    const spk = $('app-listen-speak');
    spk.addEventListener('pointerdown', (e) => { e.preventDefault(); try { spk.setPointerCapture(e.pointerId); } catch (_) {} speakBegin(); });
    spk.addEventListener('pointerup', () => { speakEnd(); });
    spk.addEventListener('pointercancel', () => { speakEnd(); });
    spk.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || $('app-listen').hidden) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      e.preventDefault(); speakBegin();
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' && !$('app-listen').hidden) speakEnd(); });

    const flip = $('app-listen-flip');
    flip.addEventListener('click', (e) => { if (e.target.closest('button')) return; flipBack(); });
    $('app-listen-flip-back').addEventListener('click', flipBack);
    $('app-listen-flip-again').addEventListener('click', () => {
      const rid = Number(flip.dataset.rid || 0);
      const row = session && session.rows.find((r) => r.rid === rid);
      if (row && row.tr) speakOut(row.tr);
    });

    if (bridged()) NativeAudio.onEvent(onNative);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && session) paint(); });
  }

  return { wire, open, leave, start, pause, resume, end, refreshEntry,
    _debug: () => ({ phase, pauseReason, rows: session ? session.rows.slice() : [], partial, partialTr, id: session && session.id }) };
})();
