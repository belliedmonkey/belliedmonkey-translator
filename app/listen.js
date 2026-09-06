// app/listen.js — 「对话 · 实时听译」(learning-design §9.6, in review) — App-only.
//
// PR-L0 SPIKE (2026-09-06): this file is the seed of the mode and, for now, a
// measurement page. It answers three questions that only a device can answer:
//   (a) can this WKWebView (file:// origin) open the realtime transcription socket,
//   (b) does the microphone deliver audible PCM (the Simulator delivers 0 bytes),
//   (c) with the native session switched to record mode, do finals keep arriving
//       for 60 s after the screen locks.
// It is reachable only through a hidden gesture (5 taps on the header name within
// 2 s) and writes NOTHING to the corpus. Every result is painted on screen and kept in
// an in-memory log the run can read back.
//
// What is reused, not re-invented:
//   · WsTranscribe (extension/content/ws-transcribe.js) — the same socket adapters the
//     extension's live tier ships; the registry's liveEndpoint/liveType/liveKeyProtocol
//     (build/stt.config.js) decide the wire.
//   · TranslationAPI.translate — the App's one translation door (app/translate-fill.js
//     is the precedent); provider group via LearnNotes.resolveConfig.
//   · NativeAudio — the mtAudio bridge; a new 'record-mode' message asks the host for a
//     recording-capable audio session (.playAndRecord) so capture survives a lock.
// Audio goes only to the endpoint the user configured (§2.4 rule 5 / §9.4).
'use strict';

var AppListen = (() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => PageI18n.t(k, fb);
  const PROCESSOR_FRAMES = 4096;
  const SILENCE_RMS = 1e-4;

  // spike: looping inaudible audio (-60 dBFS noise) — does audible-ish playback keep the WebContent process alive under lock?
  const KEEP_ALIVE_WAV = 'data:audio/wav;base64,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';
  let keepAlive = null;
  let audioCtx = null, stream = null, proc = null, srcNode = null, sock = null;
  let running = false, ticker = null;
  const stats = { frames: 0, bytes: 0, rms: 0, peak: 0, finals: 0, partials: 0, socket: 'idle', started: 0, lastFinalAt: 0, hidden: 0, hiddenAt: 0, finalsWhileHidden: 0, framesWhileHidden: 0, peakWhileHidden: 0, lastFrameAt: 0, ticksWhileHidden: 0, lastTickAt: 0 };
  const log = [];
  const finals = [];

  function note(msg) {
    const line = new Date().toISOString().slice(11, 19) + ' ' + msg;
    log.push(line); if (log.length > 200) log.shift();
    const el = $('app-listen-log'); if (el) { el.textContent = log.slice(-12).join('\n'); }
  }
  function paint() {
    const s = $('app-listen-stats'); if (!s) return;
    const secs = stats.started ? Math.round((Date.now() - stats.started) / 1000) : 0;
    s.textContent = [
      `socket: ${stats.socket}`,
      `mic: ${stream ? 'on' : 'off'} · frames ${stats.frames} · ${(stats.bytes / 1024).toFixed(0)} KB · rms ${stats.rms.toFixed(4)} · peak ${stats.peak.toFixed(3)}`,
      `finals ${stats.finals} · partials ${stats.partials} · ${secs}s · hidden ${stats.hidden}× · finals while hidden ${stats.finalsWhileHidden}`,
      `while hidden: frames ${stats.framesWhileHidden} · peak ${stats.peakWhileHidden.toFixed(3)} · js ticks ${stats.ticksWhileHidden} · last frame ${stats.lastFrameAt ? Math.round((Date.now() - stats.lastFrameAt) / 1000) + 's ago' : '—'}`,
    ].join('\n');
  }

  // ── settings ─────────────────────────────────────────────────────────
  function readCfg() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel', 'provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel', 'uiLang'], (s) => {
        const eng = (window.MT_STT_ENGINES || []).find((e) => e.id === s.sttEngine) || null;
        const tr = LearnNotes.resolveConfig(s);
        resolve({ eng, sttKey: s.sttApiKey || '', tr, targetLang: s.uiLang || (navigator.language || 'zh-CN') });
      });
    });
  }
  function liveCapable(eng) { return !!(eng && eng.liveEndpoint && eng.liveType); }

  // ── PCM: Float32 @ ctx rate → Int16 @ target rate (same decimation as asr-source) ──
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

  // ── translation of finals (spike: one request per final, no debounce) ──
  async function translateFinal(text, cfg) {
    if (!cfg.tr || !cfg.tr.provider || !cfg.tr.apiKey) return '';
    try {
      return await TranslationAPI.translate(text, cfg.targetLang, TranslationAPI.resolveProvider(cfg.tr.provider), cfg.tr.apiKey, cfg.tr.baseUrl || '', cfg.tr.model || '');
    } catch (e) { note('translate failed: ' + (e && e.message)); return ''; }
  }

  // ── network probe (spike only): is each host reachable from this WKWebView? ──
  // Hosts come from the registries (no literals — the China gate greps shipped JS).
  function hostOf(u) { try { return new URL(u).host; } catch (_) { return ''; } }
  function probeHttp(label, url) {
    const t0 = Date.now(); const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
    return fetch(url, { method: 'GET', signal: ac.signal, cache: 'no-store' })
      .then((r) => note(`net ${label} https: HTTP ${r.status} in ${Date.now() - t0}ms`))
      .catch((e) => note(`net ${label} https: ${e && e.name} ${e && e.message} after ${Date.now() - t0}ms`))
      .then(() => clearTimeout(tm));
  }
  function probeWs(label, url) {
    return new Promise((resolve) => {
      const t0 = Date.now(); let done = false;
      const fin = (msg) => { if (done) return; done = true; note(`net ${label} wss: ${msg} after ${Date.now() - t0}ms`); resolve(); };
      let ws; try { ws = new WebSocket(url); } catch (e) { fin('threw ' + e.message); return; }
      ws.onopen = () => { fin('open'); try { ws.close(); } catch (_) {} };
      ws.onerror = () => fin('error');
      ws.onclose = (ev) => fin('close ' + ev.code);
      setTimeout(() => { fin('timeout'); try { ws.close(); } catch (_) {} }, 8000);
    });
  }
  async function netProbe(cfg) {
    const prov = (window.MT_PROVIDERS || []).find((x) => x.id === (cfg.tr && cfg.tr.provider)) || null;
    const stt = hostOf(cfg.eng.liveEndpoint), tr = hostOf((cfg.tr && cfg.tr.baseUrl) || (prov && prov.defaultEndpoint) || '');
    note('net probe: stt ' + stt + ' · tr ' + tr);
    await Promise.all([
      stt && probeHttp('stt', 'https://' + stt + '/'), stt && probeWs('stt', 'wss://' + stt + '/'),
      tr && probeHttp('tr', 'https://' + tr + '/'), tr && probeWs('tr', 'wss://' + tr + '/'),
    ].filter(Boolean));
  }

  // ── start / stop ──────────────────────────────────────────────────────
  async function start() {
    if (running) return;
    const cfg = await readCfg();
    if (!liveCapable(cfg.eng)) { note('no live-capable transcription engine (need liveEndpoint) — pick OpenAI Transcribe in settings'); paint(); return; }
    if (!cfg.sttKey && cfg.eng.needsKey) { note('no transcription key'); return; }
    running = true; stats.started = Date.now(); stats.frames = 0; stats.bytes = 0; stats.finals = 0; stats.partials = 0; stats.hidden = 0; stats.finalsWhileHidden = 0; stats.framesWhileHidden = 0; stats.peakWhileHidden = 0; stats.ticksWhileHidden = 0;
    // (c) ask the host for a recording-capable session BEFORE getUserMedia
    if (typeof NativeAudio !== 'undefined' && NativeAudio.available()) {
      NativeAudio.recordMode($('app-listen-bg') ? $('app-listen-bg').checked : true);
      NativeAudio.sessionStart();
      note('native: record-mode requested');
    } else note('native bridge absent (browser / Simulator without bridge)');
    // AudioContext must be created inside the tap — this runs from the click handler
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') await audioCtx.resume(); }
    catch (e) { note('AudioContext failed: ' + e.message); stop(); return; }
    note('AudioContext ' + audioCtx.state + ' @ ' + audioCtx.sampleRate + ' Hz');
    try { keepAlive = new Audio(KEEP_ALIVE_WAV); keepAlive.loop = true; await keepAlive.play(); note('keep-alive audio playing (looping, inaudible)'); }
    catch (e) { note('keep-alive audio failed: ' + e.message); }
    // (b) microphone
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { note('getUserMedia failed: ' + (e && (e.name + ' ' + e.message))); stop(); return; }
    const track = stream.getAudioTracks()[0];
    note('mic track: ' + (track ? track.label + ' ' + track.readyState : 'none'));
    // (a0) reachability first, so a socket timeout below can be read against it
    await netProbe(cfg);
    if (!running) return;
    // (a) socket
    const rate = cfg.eng.liveRate || 24000;
    stats.socket = 'connecting'; paint();
    try {
      sock = WsTranscribe.open({
        url: cfg.eng.liveEndpoint, type: cfg.eng.liveType, apiKey: cfg.sttKey, keyProtocol: cfg.eng.liveKeyProtocol || '',
        model: cfg.eng.liveModel || cfg.eng.defaultModel, rate, params: cfg.eng.liveParams || null, langs: [],
        onEvent: (ev) => {
          if (ev.kind === 'ready') { stats.socket = 'ready'; note('socket ready'); }
          else if (ev.kind === 'partial') { stats.partials++; const p = $('app-listen-partial'); if (p) p.textContent = ev.text; }
          else if (ev.kind === 'final') {
            stats.finals++; stats.lastFinalAt = Date.now();
            if (document.hidden) stats.finalsWhileHidden++;
            const row = { text: ev.text, tr: '', at: Date.now() };
            finals.push(row); if (finals.length > 30) finals.shift();
            renderFinals();
            translateFinal(ev.text, cfg).then((tr) => { row.tr = tr; renderFinals(); });
            const p = $('app-listen-partial'); if (p) p.textContent = '';
          }
          // spike: a dead socket must not end the capture — (b)/(c) are readable without it
          else if (ev.kind === 'error') { stats.socket = 'error: ' + ev.message; note('socket error: ' + ev.message + ' — capture continues mic-only'); sock = null; }
          else if (ev.kind === 'close') { stats.socket = 'closed ' + ev.code; note('socket closed ' + ev.code + ' ' + ev.reason + ' — capture continues mic-only'); sock = null; }
          paint();
        },
      });
    } catch (e) { note('socket open threw: ' + e.message); stop(); return; }
    // capture → resample → send
    const resample = makeResampler(audioCtx.sampleRate, rate);
    srcNode = audioCtx.createMediaStreamSource(stream);
    proc = audioCtx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
    proc.onaudioprocess = (e) => {
      if (!running) return;
      const f32 = e.inputBuffer.getChannelData(0);
      let s = 0, peak = 0; for (let i = 0; i < f32.length; i++) { s += f32[i] * f32[i]; const a = Math.abs(f32[i]); if (a > peak) peak = a; }
      stats.rms = Math.sqrt(s / f32.length); stats.peak = peak;
      const pcm = resample(f32);
      if (pcm.length) { stats.frames++; stats.bytes += pcm.byteLength; stats.lastFrameAt = Date.now(); if (sock) sock.sendPcm(pcm); }
      if (document.hidden) { stats.framesWhileHidden++; if (peak > stats.peakWhileHidden) stats.peakWhileHidden = peak; }
      if (stats.frames % 25 === 0) paint();
    };
    srcNode.connect(proc);
    const mute = audioCtx.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(audioCtx.destination);
    proc._mute = mute;
    document.addEventListener('visibilitychange', onVis);
    // does JS run at all while locked? (decides native-capture-only vs whole pipeline native)
    ticker = setInterval(() => { if (document.hidden) { stats.ticksWhileHidden++; stats.lastTickAt = Date.now(); } }, 1000);
    paint();
    $('app-listen-start').disabled = true; $('app-listen-stop').disabled = false;
  }
  function onVis() {
    if (document.hidden) { stats.hidden++; stats.hiddenAt = Date.now(); note('page hidden (lock/background) — watching for finals'); }
    else note('page visible again; hidden for ' + Math.round((Date.now() - stats.hiddenAt) / 1000) + 's · frames while hidden ' + stats.framesWhileHidden + ' · peak while hidden ' + stats.peakWhileHidden.toFixed(3) + ' · js ticks while hidden ' + stats.ticksWhileHidden + ' · finals while hidden ' + stats.finalsWhileHidden);
    paint();
  }
  function stop() {
    running = false;
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (keepAlive) { try { keepAlive.pause(); } catch (_) {} keepAlive = null; }
    document.removeEventListener('visibilitychange', onVis);
    try { if (proc) { proc.disconnect(); if (proc._mute) proc._mute.disconnect(); } } catch (_) {}
    try { if (srcNode) srcNode.disconnect(); } catch (_) {}
    try { if (stream) stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    try { if (sock) sock.close(); } catch (_) {}
    proc = null; srcNode = null; stream = null; sock = null;
    if (typeof NativeAudio !== 'undefined' && NativeAudio.available()) { NativeAudio.recordMode(false); NativeAudio.sessionStop(); }
    if (stats.socket === 'ready' || stats.socket === 'connecting') stats.socket = 'idle';
    note('stopped');
    paint();
    const b1 = $('app-listen-start'), b2 = $('app-listen-stop');
    if (b1) b1.disabled = false; if (b2) b2.disabled = true;
  }
  function renderFinals() {
    const el = $('app-listen-finals'); if (!el) return;
    el.textContent = '';
    for (const r of finals.slice(-8).reverse()) {
      const row = document.createElement('div'); row.className = 'listen-row';
      const o = document.createElement('div'); o.textContent = r.text;
      const tr = document.createElement('div'); tr.className = 'listen-tr'; tr.textContent = r.tr || '…';
      row.appendChild(o); row.appendChild(tr); el.appendChild(row);
    }
  }

  // ── view ──────────────────────────────────────────────────────────────
  let cameFrom = 'signed-in';
  function open() {
    cameFrom = $('signed-in').hidden ? 'signed-out' : 'signed-in';
    $(cameFrom).hidden = true; $('app-listen').hidden = false;
    readCfg().then((cfg) => {
      note(liveCapable(cfg.eng) ? `engine ${cfg.eng.id} → ${cfg.eng.liveType} @ ${cfg.eng.liveRate || 24000} Hz` : 'engine has no live tier; pick OpenAI Transcribe in settings');
      note('translate via ' + (cfg.tr && cfg.tr.provider ? cfg.tr.provider : 'none') + ' → ' + cfg.targetLang);
      paint();
    });
  }
  function close() { if (running) stop(); $('app-listen').hidden = true; $(cameFrom).hidden = false; }

  // Hidden entry for the spike: 5 taps on the header name within 2 s.
  function wire() {
    let taps = [];
    const gesture = () => {
      const now = Date.now(); taps = taps.filter((x) => now - x < 2000); taps.push(now);
      if (taps.length >= 5) { taps = []; open(); }
    };
    // signed-in header name, and the signed-out title — the spike must be reachable
    // without an account (登录只是为了同步)
    for (const el of [$('who'), document.querySelector('#signed-out h1')]) if (el) el.addEventListener('click', gesture);
    // An instrumented build (verification-spec §1.1) seeds `listenSpike`; only then does a
    // visible link exist — the multi-tap gesture does not survive iPhone Mirroring's
    // click delivery (measured 2026-09-07: it selects the title text instead).
    try {
      chrome.storage.local.get('listenSpike', (r) => {
        if (!r || !r.listenSpike) return;
        for (const id of ['app-listen-open', 'app-listen-open2']) { const b = $(id); if (b) { b.hidden = false; b.textContent = t('app_listen_spike_title', '实时听译 · 可行性探针'); b.addEventListener('click', open); } }
      });
    } catch (_) {}
    $('app-listen-back').addEventListener('click', close);
    $('app-listen-start').addEventListener('click', () => { start(); });
    $('app-listen-stop').addEventListener('click', () => { stop(); });
    $('app-listen-back').textContent = t('app_listen_back', '返回');
    $('app-listen-title').textContent = t('app_listen_spike_title', '实时听译 · 可行性探针');
    $('app-listen-start').textContent = t('app_listen_start', '开始听');
    $('app-listen-stop').textContent = t('app_listen_stop', '停止');
    $('app-listen-bg-label').textContent = t('app_listen_bg', '锁屏也继续（录音会话）');
  }

  return { wire, open, close, start, stop, _stats: stats, _log: log, _finals: finals };
})();
