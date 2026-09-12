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
    toNative: ['stt-probe', 'stt-assets', 'stt-start', 'stt-stop', 'tts-probe', 'tts-assets', 'tts-speak', 'tts-stop'],
    fromNative: ['stt-state', 'assets-progress', 'stt-partial', 'stt-final', 'tts-state', 'tts-start', 'tts-end', 'tts-failed'],
  };

  // 最近一次探测的结论（`probeResult()` 同步可读，给 liveCapable 这类纯判断用）。
  // 形状：{ ok, reason, assets, locales }；reason ∈ os | locale | no-bridge | pending
  let sttProbe = { ok: false, reason: 'no-bridge', assets: 'missing', locales: [] };
  let ttsProbe = { ok: false, reason: 'no-bridge', langs: [] };
  // 一次 stt-start 之后的事件接收者；`sttOpen` 返回的句柄关掉时清空。
  let sttSession = null;
  // 朗读：一次一句（JS 侧的 speakQueue 已经串行），id 对得上才回调。
  let speakJob = null;
  const progressListeners = [];
  // 等待中的探测 Promise —— 是一串不是一个：入口刷新与设置变更会并发探两次，只留最后一个
  // 会让第一个 await 永远不落定（2026-09-12 门禁里就是这么挂住的）。
  let sttWaiters = [], ttsWaiters = [];
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
      if (msg.state === 'unsupported') sttProbe = { ok: false, reason: msg.reason || 'os', assets: 'missing', locales: sttProbe.locales };
      else if (msg.state === 'ready' && msg.assets) sttProbe = { ok: true, reason: '', assets: msg.assets, locales: sttProbe.locales };
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
    if (t === 'stt-partial' || t === 'stt-final') {
      if (sttSession) sttSession.fire(t === 'stt-final' ? 'final' : 'partial', msg);
      return;
    }
    if (t === 'tts-state') {
      ttsProbe = { ok: msg.state === 'ready', reason: msg.state === 'ready' ? '' : (msg.reason || msg.state), langs: Array.isArray(msg.langs) ? msg.langs : [] };
      wake(ttsWaiters, ttsProbe);
      return;
    }
    if (t === 'tts-start' || t === 'tts-end' || t === 'tts-failed') {
      const job = speakJob;
      if (!job || job.id !== msg.id) return;
      if (t === 'tts-start') job.started(true);
      else if (t === 'tts-end') { speakJob = null; job.started(true); job.done(); }
      else { speakJob = null; job.started(false); job.fail(msg.reason || 'failed'); }
    }
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

  /**
   * 下载缺的资产。kind: 'stt'（系统识别器的语言包）| 'tts'（离线朗读模型）。
   * onProgress 收原生的 assets-progress 原样 { kind, locale, fraction, state, reason? }。
   * 结束：stt ⇒ 再探一次拿最终态；tts ⇒ tts-state。失败 reject({ reason })。
   */
  function ensureAssets(kind, spec, onProgress) {
    if (!available()) return Promise.reject({ reason: 'no-bridge' });
    return new Promise((resolve, reject) => {
      let failed = false;
      const fn = (m) => {
        if (m.kind !== kind) return;
        try { onProgress && onProgress(m); } catch (_) {}
        if (m.state === 'failed') { failed = true; }
      };
      progressListeners.push(fn);
      const finish = (r) => {
        const i = progressListeners.indexOf(fn); if (i >= 0) progressListeners.splice(i, 1);
        if (failed || !r.ok) reject({ reason: failed ? 'download' : (r.reason || 'failed') }); else resolve(r);
      };
      if (kind === 'stt') { sttWaiters.push(finish); post({ type: 'stt-assets', locales: spec }); }
      else { ttsWaiters.push(finish); post({ type: 'tts-assets', models: spec }); }
    });
  }

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
    if (sttSession) { const s = sttSession; sttSession = null; s.closed = true; }
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
        if (sttSession === session) { sttSession = null; post({ type: 'stt-stop' }); }
      },
    };
  }

  // ── 朗读 ─────────────────────────────────────────────────────────────────
  /** 探本机朗读：models 是清单（见 listen.js 的 DEVICE_TTS_MODELS）。结论 { ok, reason, langs }。 */
  function ttsProbeRun(models) {
    if (!available()) { ttsProbe = { ok: false, reason: 'no-bridge', langs: [] }; return Promise.resolve(ttsProbe); }
    return new Promise((resolve) => {
      ttsWaiters.push(resolve);
      if (!post({ type: 'tts-probe', models: models || [] })) { ttsProbe = { ok: false, reason: 'no-bridge', langs: [] }; wake(ttsWaiters, ttsProbe); }
    });
  }
  function ttsLangs() { return ttsProbe.langs.slice(); }

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
    if (!available() || !post({ type: 'tts-speak', id, text: String((o && o.text) || ''), lang: String((o && o.lang) || ''), rate: (o && o.rate) || 1 })) {
      speakJob = null; started(false); fail('no-bridge');
    }
    return { id, started: startedP, done: doneP };
  }
  function stop() {
    if (speakJob) { const j = speakJob; speakJob = null; j.started(false); j.fail('stopped'); }
    post({ type: 'tts-stop' });
  }

  return { CHANNEL, PROTOCOL, available, probe, probeResult, ensureAssets, sttOpen, ttsProbe: ttsProbeRun, ttsLangs, speak, stop, _fromNative };
})();
