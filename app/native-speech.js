// app/native-speech.js — 设备内置转写 / 设备内置朗读的 JS 一半（learning-design §9.6.1）。
// 原生一半是 app/native/speech-bridge.swift（通道 mtSpeech）。只在宿主 App 里存在；
// 扩展页与 Chrome 门禁里没有桥，`available()` 为 false，一切本机路的入口都从它这儿灰掉。
//
// 与 native-audio.js 同一套纪律：能力由桥探测（`probe()`），绝不嗅 UA；协议两组字符串
// 导出给契约测试和 .swift 的 case 对表；回调各自 try/catch。
// 注释里不写厂商名与端点 —— 中国版合规门扫的是整段 JS 文本，注释也算。
var NativeSpeech = (() => {
  const CHANNEL = 'mtSpeech';

  const PROTOCOL = {
    toNative: ['stt-probe', 'stt-assets', 'stt-start', 'stt-stop', 'tts-probe', 'tts-assets', 'tts-speak', 'tts-stop', 'lid-probe', 'lid-assets', 'vad-probe', 'vad-assets'],
    fromNative: ['stt-state', 'assets-progress', 'stt-partial', 'stt-final', 'tts-state', 'tts-start', 'tts-end', 'tts-failed', 'lid-state', 'lid-result', 'lid-live', 'vad-state'],
  };

  // 最近一次探测的结论（`probeResult()` 同步可读，给 liveCapable 这类纯判断用）。
  // 形状：{ ok, reason, assets, locales }；reason ∈ os | locale | no-bridge | pending
  let sttProbe = { ok: false, reason: 'no-bridge', assets: 'missing', locales: [] };
  let sttSupported = [];   // 原生报的本机识别器支持的 locale（BCP-47）；空 = 还没探过 / 老壳不报
  let ttsProbe = { ok: false, reason: 'no-bridge', langs: [] };
  // 一次 stt-start 之后的事件接收者；`sttOpen` 返回的句柄关掉时清空。
  let sttSession = null;
  // 朗读：一次一句（JS 侧的 speakQueue 已经串行），id 对得上才回调。
  let speakJob = null;
  let ttsProbed = false;      // 桥答过一次 tts-state（含 system 字段）
  let lastModels = [];        // 上次 tts-probe 的模型清单：systemVoice() 重探时沿用，别把 Piper 的状态探没了
  const progressListeners = [];
  // 等待中的探测 Promise —— 是一串不是一个：入口刷新与设置变更会并发探两次，只留最后一个
  // 会让第一个 await 永远不落定（2026-09-12 门禁里就是这么挂住的）。
  let sttWaiters = [], ttsWaiters = [];
  // 语种识别（LID，§9.6.1.3）：模型 = 探/装一处；`lidLast` = 最近一条判词（listen-model 据此归属）。
  let lidProbe = { ok: false, reason: 'no-bridge' };
  let lidWaiters = [];
  let lidLast = null;         // { lang, ms, at, kind: 'final'|'live' }
  const lidListeners = [];
  // 语音活动检测（VAD，2026-10-07）：难音频上 LID 的判词会乱跳，先让 silero VAD 判「是不是人说话」，
  // 只有话音才累计进 LID。**装不上不影响听译**（原生退回能量门）。
  let vadProbe = { ok: false, reason: 'no-bridge' };
  let vadWaiters = [];
  let sttStopsPending = 0;   // 自己发出去、还没收到「ended」回执的 stt-stop 数（见 _fromNative 里的注释）
  const wake = (list, v) => { const ws = list.splice(0); for (const w of ws) { try { w(v); } catch (_) {} } };

  function post(msg) {
    try { window.webkit.messageHandlers[CHANNEL].postMessage(msg); return true; } catch (_) { return false; }
  }
  function available() {
    try { return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[CHANNEL]); } catch (_) { return false; }
  }

  function _fromNative(msg) {
    if (!msg || typeof msg !== 'object') return;
    const t = msg.type;
    if (t === 'stt-state') {
      // 「ended」是 stt-stop 的回执，原生总晚一拍才到（postMessage 与 evaluateJavaScript 各排一次队）。
      // closeSocket() 紧接 openSocket()（改语言重连 / 结束后立刻再开）时，回执落在**新**会话开好之后 ——
      // 2026-09-14 起 test:listen F 段偶发失败就是它把刚开的会话当成「结束」杀掉了。所以自己叫停的每一路
      // 记一笔待收回执，回执到了只销账，不碰当前会话；只有没人等的「ended」（原生自己停了）才算当前会话结束。
      if (msg.state === 'ended' && sttStopsPending > 0) { sttStopsPending--; return; }
      // 本机识别器支持的 locale 清单（2026-09-17）：对话的语言下拉只列它支持的，由设备当场报出、不写死
      if (Array.isArray(msg.supported)) sttSupported = msg.supported.map(String);
      if (msg.state === 'unsupported') sttProbe = { ok: false, reason: msg.reason || 'os', assets: 'missing', locales: sttProbe.locales };
      else if (msg.state === 'ready' && msg.assets) sttProbe = { ok: true, reason: '', assets: msg.assets, locales: sttProbe.locales };
      // 诊断（§0.4.1）：单点记录（stt-state ready 只有一条）——engines = 每门语言选了哪台
      // 识别器（st/dt），转写质量「混对被拖回旧引擎」的量化数据。原 per-waiter 记法重复，已撤。
      if (msg.state === 'ready') {
        try { DiagLog.push('probe', { kind: 'stt', ok: sttProbe.ok, reason: sttProbe.reason || '', assets: sttProbe.assets || '', engines: Array.isArray(msg.engines) ? msg.engines.join('|') : '' }); } catch (_) {}
      }
      if (msg.state === 'unsupported' || msg.assets) wake(sttWaiters, sttProbe);
      if (sttSession) {
        if (msg.state === 'ready' && !msg.assets) sttSession.fire('ready', {});
        else if (msg.state === 'failed') sttSession.fire('error', { reason: msg.reason || 'failed' });
        else if (msg.state === 'ended') { const s = sttSession; sttSession = null; s.fire('close', {}); }
        else if (msg.state === 'unsupported') sttSession.fire('error', { reason: msg.reason || 'os' });
      }
      return;
    }
    if (t === 'assets-progress') {
      for (const fn of progressListeners) { try { fn(msg); } catch (_) {} }
      return;
    }
    if (t === 'lid-state') {
      lidProbe = { ok: msg.state === 'ready', reason: msg.state === 'ready' ? '' : String(msg.reason || msg.state || 'assets') };
      wake(lidWaiters, lidProbe);
      return;
    }
    if (t === 'vad-state') {
      vadProbe = { ok: msg.state === 'ready', reason: msg.state === 'ready' ? '' : String(msg.reason || msg.state || 'assets') };
      wake(vadWaiters, vadProbe);
      return;
    }
    if (t === 'lid-result' || t === 'lid-live') {
      lidLast = { lang: String(msg.lang || ''), ms: (typeof msg.ms === 'number') ? msg.ms : 0, at: Date.now(), kind: t === 'lid-live' ? 'live' : 'final' };
      // 诊断（§0.4.1）：判词只记语言与时长 —— 零内容。
      try { DiagLog.push('lid', { lang: lidLast.lang, ms: lidLast.ms, kind: lidLast.kind }); } catch (_) {}
      for (const fn of lidListeners) { try { fn(lidLast); } catch (_) {} }
      return;
    }
    if (t === 'url-probe') {
      const r = urlProbes.get(msg.id);
      if (r) { urlProbes.delete(msg.id); r(!!msg.ok); }
      return;
    }
    if (t === 'stt-partial' || t === 'stt-final') {
      if (t === 'stt-final') {
        // 诊断（§0.4.1，2026-10-06 转写质量量化）：哪路出了定稿、多长、置信度 —— 零内容
        try { DiagLog.push('stt_final', { locale: String(msg.locale || ''), chars: String(msg.text || '').length, conf: (typeof msg.conf === 'number') ? msg.conf : undefined }); } catch (_) {}
      }
      if (sttSession) sttSession.fire(t === 'stt-final' ? 'final' : 'partial', msg);
      return;
    }
    if (t === 'tts-state') {
      ttsProbe = { ok: msg.state === 'ready', reason: msg.state === 'ready' ? '' : (msg.reason || msg.state), langs: Array.isArray(msg.langs) ? msg.langs : [],
        system: !!msg.system, systemLangs: Array.isArray(msg.systemLangs) ? msg.systemLangs.map((l) => String(l).toLowerCase()) : [] };
      ttsProbed = true;
      try { DiagLog.push('probe', { kind: 'tts', ok: ttsProbe.ok, reason: ttsProbe.reason, assets: ttsProbe.assets, langs: (ttsProbe.langs || []).length }); } catch (_) {}
      wake(ttsWaiters, ttsProbe);
      return;
    }
    if (t === 'tts-start' || t === 'tts-end' || t === 'tts-failed') {
      const job = speakJob;
      if (!job || job.id !== msg.id) return;
      if (t === 'tts-start') job.started(true);
      else if (t === 'tts-end') { speakJob = null; job.started(true); job.done(); }
      else {
        speakJob = null;
        // 诊断（§0.4.1）：#567 那类 reason:"load" 此前只进 WebKit 控制台 —— 真机上一个字节都回不来
        try { DiagLog.push('tts_engine', { phase: 'failed', fail_reason: String(msg.reason || 'failed') }); } catch (_) {}
        job.started(false); job.fail(msg.reason || 'failed');
      }
    }
  }

  // §0.4.1 诊断录音（2026-10-06）：JS 武装/收尾原生采集（默认关；文本 sidecar 只随音频包走）。
  function diagAudio(on, session, url, sidecar) {
    const body = { type: 'diag-audio', on: on ? 1 : 0 };
    if (on) { body.session = session || ''; body.url = url || ''; } else { body.sidecar = sidecar || ''; }
    return post(body);
  }

  // ── 转写 ─────────────────────────────────────────────────────────────────
  /** 探本机转写：{ ok, reason, assets, locales }。桥不在 ⇒ 立即 no-bridge。 */
  function probe(locales) {
    const ls = Array.isArray(locales) ? locales.slice() : [];
    if (!available()) { sttProbe = { ok: false, reason: 'no-bridge', assets: 'missing', locales: ls }; return Promise.resolve(sttProbe); }
    sttProbe = { ok: false, reason: 'pending', assets: 'missing', locales: ls };
    return new Promise((resolve) => {
      sttWaiters.push(resolve);
      if (!post({ type: 'stt-probe', locales: ls })) { sttProbe = { ok: false, reason: 'no-bridge', assets: 'missing', locales: ls }; wake(sttWaiters, sttProbe); }
    });
  }
  function probeResult() { return sttProbe; }
  // ── 地址可用性探测（learning-design §9.6.1.1）：原生发 Range 0-0 的 GET，5 s 超时；2xx 算可用。
  //    ModelSources 用它决定「缓存的地址还能不能用」；桥不在 / 没回应 ⇒ false（当作不可用，交给下一级）。
  const urlProbes = new Map(); let probeSeq = 0;
  function probeUrl(url) {
    if (!available()) return Promise.resolve(false);
    const id = 'p' + (++probeSeq);
    return new Promise((resolve) => {
      urlProbes.set(id, resolve);
      if (!post({ type: 'url-probe', id, url: String(url) })) { urlProbes.delete(id); resolve(false); return; }
      setTimeout(() => { if (urlProbes.delete(id)) resolve(false); }, 6000);
    });
  }
  /** 本机识别器支持的 locale 清单（探过之后才有；空数组 = 不知道，调用方别据此过滤）。 */
  function supportedLocales() { return sttSupported.slice(); }

  /**
   * 下载缺的资产。kind: 'stt'（系统识别器的语言包）| 'tts'（离线朗读模型）。
   * onProgress 收原生的 assets-progress 原样 { kind, locale, fraction, state, reason? }。
   * 结束：stt ⇒ 再探一次拿最终态；tts ⇒ tts-state。失败 reject({ reason })。
   */
  function ensureAssets(kind, spec, onProgress) {
    if (!available()) return Promise.reject({ reason: 'no-bridge' });
    return new Promise((resolve, reject) => {
      let failed = false;
      let failReason = '';
      const fn = (m) => {
        if (m.kind !== kind) return;
        try { onProgress && onProgress(m); } catch (_) {}
        if (m.state === 'failed') { failed = true; failReason = String(m.reason || 'download'); }
      };
      progressListeners.push(fn);
      const finish = (r) => {
        const i = progressListeners.indexOf(fn); if (i >= 0) progressListeners.splice(i, 1);
        // 原生报了 failed 就把它的 reason 带出去（以前丢成 'download'，屏上只剩一句「没动静」✗）
        if (failed || !r.ok) reject({ reason: failed ? (failReason || 'download') : (r.reason || 'failed') }); else resolve(r);
      };
      if (kind === 'stt') { sttWaiters.push(finish); post({ type: 'stt-assets', locales: spec }); }
      else { ttsWaiters.push(finish); post({ type: 'tts-assets', models: spec }); }
    });
  }

  // ── 语种识别（LID，§9.6.1.3）───────────────────────────────────────────────
  // 听译里「谁在说哪门语言」由端上模型判（sherpa-onnx SLID）——不再用手写文字系/置信度规则。
  // 模型 = sherpa-onnx-whisper-tiny（一个 zip 两个 onnx），走与 TTS 同一条下载/校验通道。
  /** 探 LID 模型装没装。{ ok, reason }。桥不在 ⇒ 立即 no-bridge。 */
  function lidProbeRun(model) {
    if (!available()) { lidProbe = { ok: false, reason: 'no-bridge' }; return Promise.resolve(lidProbe); }
    return new Promise((resolve) => {
      lidWaiters.push(resolve);
      if (!post({ type: 'lid-probe', models: [model] })) { lidProbe = { ok: false, reason: 'no-bridge' }; wake(lidWaiters, lidProbe); }
    });
  }
  /** 下 LID 模型（缺才下）。onProgress 收 assets-progress 原样 { kind:'lid', fraction, state, reason? }。 */
  function ensureLid(model, onProgress) {
    if (!available()) return Promise.reject({ reason: 'no-bridge' });
    return new Promise((resolve, reject) => {
      let failed = false, failReason = '';
      const fn = (m) => {
        if (m.kind !== 'lid') return;
        try { onProgress && onProgress(m); } catch (_) {}
        if (m.state === 'failed') { failed = true; failReason = String(m.reason || 'download'); }
      };
      progressListeners.push(fn);
      const finish = (r) => {
        const i = progressListeners.indexOf(fn); if (i >= 0) progressListeners.splice(i, 1);
        if (failed || !r.ok) reject({ reason: failed ? (failReason || 'download') : (r.reason || 'failed') }); else resolve(r);
      };
      lidWaiters.push(finish);
      if (!post({ type: 'lid-assets', models: [model] })) { const i = progressListeners.indexOf(fn); if (i >= 0) progressListeners.splice(i, 1); reject({ reason: 'no-bridge' }); }
    });
  }
  /** 订阅每一条判词（final = 一句定稿时判的；live = 边说边判的）。返回退订函数。 */
  function onLid(fn) {
    lidListeners.push(fn);
    return () => { const i = lidListeners.indexOf(fn); if (i >= 0) lidListeners.splice(i, 1); };
  }
  /** 最近一条判词 { lang, ms, at, kind } | null。 */
  function lidLatest() { return lidLast; }

  // ── 语音活动检测（VAD，2026-10-07）───────────────────────────────────────────
  /** 探 VAD 装没装。{ ok, reason }。 */
  function vadProbeRun(model) {
    if (!available()) { vadProbe = { ok: false, reason: 'no-bridge' }; return Promise.resolve(vadProbe); }
    return new Promise((resolve) => {
      vadWaiters.push(resolve);
      if (!post({ type: 'vad-probe', models: [model] })) { vadProbe = { ok: false, reason: 'no-bridge' }; wake(vadWaiters, vadProbe); }
    });
  }
  /** 下 VAD 模型（644KB，缺才下）。**失败不该拦住听译** —— 调用方 catch 后照常走。 */
  function ensureVad(model, onProgress) {
    if (!available()) return Promise.reject({ reason: 'no-bridge' });
    return new Promise((resolve, reject) => {
      let failed = false, failReason = '';
      const fn = (m) => {
        if (m.kind !== 'vad') return;
        try { onProgress && onProgress(m); } catch (_) {}
        if (m.state === 'failed') { failed = true; failReason = String(m.reason || 'download'); }
      };
      progressListeners.push(fn);
      const finish = (r) => {
        const i = progressListeners.indexOf(fn); if (i >= 0) progressListeners.splice(i, 1);
        if (failed || !r.ok) reject({ reason: failed ? (failReason || 'download') : (r.reason || 'failed') }); else resolve(r);
      };
      vadWaiters.push(finish);
      if (!post({ type: 'vad-assets', models: [model] })) { const i = progressListeners.indexOf(fn); if (i >= 0) progressListeners.splice(i, 1); reject({ reason: 'no-bridge' }); }
    });
  }
  /** 最近一次 VAD 探测结论。 */
  function vadResult() { return vadProbe; }

  /**
   * 开一路本机转写。与 WsTranscribe.open 同一个返回形状：{ sendPcm(){}, close() }，
   * 事件 ready / partial / final / error / close 走 onEvent(kind, payload)。
   * 本机路不吃 JS 送的 PCM（音频留在原生），sendPcm 是空操作 —— 保留它只是为了让
   * listen.js 对两条路一视同仁。
   */
  function sttOpen(o) {
    const onEvent = (o && o.onEvent) || (() => {});
    const session = {
      closed: false,
      fire(kind, payload) { if (this.closed && kind !== 'close') return; try { onEvent(kind, payload); } catch (_) {} },
    };
    if (sttSession) { const s = sttSession; sttSession = null; s.closed = true; }   // 原生的 stt-start 静默停掉在跑的那一路（不回 ended，那是 stt-stop 的回执）
    sttSession = session;
    const body = { type: 'stt-start', locales: (o && o.locales) || [] };
    if (o && o.vadMs) body.vadMs = o.vadMs;
    if (o && o.vadLevel) body.vadLevel = o.vadLevel;
    if (!post(body)) { sttSession = null; setTimeout(() => session.fire('error', { reason: 'no-bridge' }), 0); }
    return {
      sendPcm() {},
      close() {
        if (session.closed) return;
        session.closed = true;
        if (sttSession === session) { sttSession = null; if (post({ type: 'stt-stop' })) sttStopsPending++; }
      },
    };
  }

  // ── 朗读 ─────────────────────────────────────────────────────────────────
  /** 探本机朗读：models 是清单（见 listen.js 的 DEVICE_TTS_MODELS）。结论 { ok, reason, langs }。 */
  function ttsProbeRun(models) {
    if (!available()) { ttsProbe = { ok: false, reason: 'no-bridge', langs: [], system: false, systemLangs: [] }; return Promise.resolve(ttsProbe); }
    lastModels = models || lastModels;
    return new Promise((resolve) => {
      ttsWaiters.push(resolve);
      if (!post({ type: 'tts-probe', models: lastModels })) { ttsProbe = { ok: false, reason: 'no-bridge', langs: [], system: false, systemLangs: [] }; wake(ttsWaiters, ttsProbe); }
    });
  }
  function ttsLangs() { return ttsProbe.langs.slice(); }
  /**
   * 系统语音的原生后端能不能读这个语言（小写基础语言，如 'zh'）。没探过就先探一次（沿用上次的模型清单，
   * 不会把 Piper 的 langs 冲掉）；桥不答 ⇒ 1.5 s 后当不能，由调用方走 WebKit。老桥（没有 system 字段）恒 false。
   */
  function systemVoice(lang) {
    if (!available()) return Promise.resolve(false);
    const has = () => !!(ttsProbe.system && (!lang || ttsProbe.systemLangs.indexOf(String(lang).toLowerCase()) >= 0));
    if (ttsProbed) return Promise.resolve(has());
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 1500);
      ttsProbeRun(lastModels).then(() => { clearTimeout(timer); resolve(has()); });
    });
  }

  /**
   * 念一句。返回 { started: Promise<bool>, done: Promise<void> }：started 在首块出声（或失败）时落定，
   * done 在最后一块播完时落定；失败时 done reject({ reason })。lang 不在 ttsLangs() 里由调用方先回落。
   */
  function speak(o) {
    const id = (o && o.id) || ('tts-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    let started, done, fail;
    const startedP = new Promise((r) => { started = r; });
    const doneP = new Promise((r, j) => { done = r; fail = j; });
    doneP.catch(() => {});
    if (speakJob) { const j = speakJob; speakJob = null; j.started(false); j.fail('superseded'); }
    speakJob = { id, started, done, fail };
    if (!available() || !post({ type: 'tts-speak', id, text: String((o && o.text) || ''), lang: String((o && o.lang) || ''), rate: (o && o.rate) || 1,
      backend: String((o && o.backend) || ''), voice: String((o && o.voice) || '') })) {
      speakJob = null; started(false); fail('no-bridge');
    }
    return { id, started: startedP, done: doneP };
  }
  function stop() {
    if (speakJob) { const j = speakJob; speakJob = null; j.started(false); j.fail('stopped'); }
    post({ type: 'tts-stop' });
  }

  return { CHANNEL, PROTOCOL, available, probe, probeResult, probeUrl, supportedLocales, ensureAssets, sttOpen, ttsProbe: ttsProbeRun, ttsLangs, systemVoice, speak, stop, _fromNative, diagAudio,
    lidProbe: lidProbeRun, ensureLid, onLid, lidLatest, vadProbe: vadProbeRun, ensureVad, vadResult };
})();
