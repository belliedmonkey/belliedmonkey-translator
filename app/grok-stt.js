// app/grok-stt.js — 泰语 demo 的云端流式转写会话骨架（docs/thai-grok-stt-demo-spec.md 步 1）。
//
// 句柄形状对齐 NativeSpeech.sttOpen / WsTranscribe 的旧 open：
//   const s = GrokStt.open({ locale, apiKey, onEvent });
//   s.sendPcm(int16 | arrayBuffer | bytes); s.close(); s.cut?.();
// 事件：ready / partial / final / error / close，payload 里一律带 locale。
//
// 纪律：
//   · key 只进 WebSocket 的 Authorization 头；绝不写日志、绝不进 reason / 异常文本。
//   · 没有 key 不抛未捕获 —— 异步 onEvent('error', { reason: 'no-key' })，句柄为空操作。
//   · 服务端 transcript.created 到之前只缓冲 PCM；到了才按 FRAME_BYTES 整帧发出。
//   · 已进 build/app-bundle.js 的 MODULES（App 包），但只走 Debug 开关 thaiGrokStt 的 th 路由；
//     默认关，Release 路径不启用，也不带 key（步 1 只落骨架；步 2 接 listen 路由）。
var GrokStt = (() => {
  const WS_URL_BASE = 'wss://api.x.ai/v1/stt';
  const MODEL = 'grok-voice-transcribe-2.0';
  // 16 kHz s16le 单声道 × 100 ms = 16000 × 2 × 0.1 = 3200 字节
  const FRAME_BYTES = 3200;
  const SAMPLE_RATE = 16000;
  const ENCODING = 'pcm';
  const DEFAULT_LOCALE = 'th-TH';

  function baseLanguage(locale) {
    return String(locale || '').split(/[-_]/)[0].toLowerCase();
  }

  // 只认 opts.apiKey / opts.getApiKey() / process.env.XAI_API_KEY 三个来源。
  // getApiKey 抛错按「没有 key」处理 —— 错误文本里可能有凭证，绝不外传。
  function resolveKey(o) {
    try {
      if (o.apiKey) return String(o.apiKey);
      if (typeof o.getApiKey === 'function') {
        const k = o.getApiKey();
        if (k) return String(k);
      }
      if (typeof process !== 'undefined' && process && process.env && process.env.XAI_API_KEY) {
        return String(process.env.XAI_API_KEY);
      }
    } catch (_) {}
    return '';
  }

  // Int16Array / ArrayBuffer / Uint8Array（含 Node Buffer 这类 view）。跨 realm 也成立：
  // ArrayBuffer.isView 认内部槽，Object.prototype.toString 认 ArrayBuffer 标签。
  function toBytes(pcm) {
    try {
      if (pcm == null) return null;
      if (ArrayBuffer.isView(pcm)) return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      if (Object.prototype.toString.call(pcm) === '[object ArrayBuffer]') return new Uint8Array(pcm);
    } catch (_) {}
    return null;
  }

  function bytesToText(u8) {
    try { if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u8); } catch (_) {}
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  function parseMessage(data) {
    let text = data;
    if (typeof text !== 'string') {
      if (ArrayBuffer.isView(text)) text = bytesToText(new Uint8Array(text.buffer, text.byteOffset, text.byteLength));
      else if (Object.prototype.toString.call(text) === '[object ArrayBuffer]') text = bytesToText(new Uint8Array(text));
      else return null;
    }
    try {
      const msg = JSON.parse(text);
      return (msg && typeof msg === 'object') ? msg : null;
    } catch (_) { return null; }
  }

  function confidenceOf(msg) {
    if (typeof msg.conf === 'number') return msg.conf;
    if (typeof msg.confidence === 'number') return msg.confidence;
    return undefined;
  }

  // t0 / t1 用毫秒；服务端只给 start/duration 时才算，缺一个就少一个。
  function addTiming(payload, msg) {
    const start = msg.start;
    if (typeof start === 'number' && isFinite(start)) payload.t0 = start * 1000;
    if (typeof start === 'number' && typeof msg.duration === 'number' && isFinite(start) && isFinite(msg.duration)) {
      payload.t1 = (start + msg.duration) * 1000;
    }
  }

  function inertHandle() {
    return { sendPcm() {}, close() {}, cut() {} };
  }

  /**
   * 开一路 Grok STT。opts: { locale, apiKey, getApiKey, onEvent, WebSocket, language }
   * 返回 { sendPcm, close, cut }。任何 onEvent 回调抛错都吞在内部，不向外抛。
   */
  function open(opts) {
    const o = opts || {};
    const onEvent = (typeof o.onEvent === 'function') ? o.onEvent : function () {};
    const locale = o.locale ? String(o.locale) : DEFAULT_LOCALE;
    const language = o.language ? String(o.language) : baseLanguage(locale);
    const key = resolveKey(o);

    let closed = false;
    let ready = false;
    let closeFired = false;
    let sock = null;
    const chunks = [];
    let buffered = 0;
    const emittedFinals = Object.create(null);

    function fire(kind, payload) {
      if (closed && kind !== 'close') return;
      try { onEvent(kind, payload); } catch (_) {}
    }

    function shutdown(reason) {
      if (closed) return;
      closed = true;
      const ws = sock;
      sock = null;
      closeFired = true;
      if (ws) { try { ws.close(); } catch (_) {} }
      fire('close', { reason: reason || 'closed' });
    }

    function emitError(reason) { fire('error', { reason: reason }); }

    // 整帧发出；不足一帧留在 chunks 里等下一块。帧必须复制，调用方的 PCM 缓冲会复用。
    function flushFrames() {
      while (!closed && ready && buffered >= FRAME_BYTES) {
        const frame = new Uint8Array(FRAME_BYTES);
        let off = 0;
        while (off < FRAME_BYTES) {
          const head = chunks[0];
          const take = Math.min(head.length, FRAME_BYTES - off);
          frame.set(head.subarray(0, take), off);
          off += take;
          if (take === head.length) chunks.shift();
          else chunks[0] = head.subarray(take);
          buffered -= take;
        }
        try {
          if (sock && typeof sock.send === 'function') sock.send(frame);
        } catch (_) {
          emitError('ws');
          break;
        }
      }
    }

    function sendPcm(pcm) {
      if (closed) return;
      const bytes = toBytes(pcm);
      if (!bytes || !bytes.length) return;
      chunks.push(bytes.slice());   // 复制：送进来的缓冲下一拍可能被覆写
      buffered += bytes.length;
      flushFrames();
    }

    function close() {
      if (closed) return;
      if (sock && (ready || sock.readyState === 1)) {
        try { sock.send(JSON.stringify({ type: 'audio.done' })); } catch (_) {}
      }
      shutdown('client');
    }

    // PTT：立刻收口这一句。
    function cut() {
      if (closed || !sock) return;
      try { sock.send(JSON.stringify({ type: 'finalize' })); } catch (_) {}
    }

    function handleMessage(ev) {
      if (closed) return;
      const msg = parseMessage(ev && ev.data);
      if (!msg) return;
      const type = String(msg.type || '');

      if (type === 'transcript.created') {
        if (ready) return;
        ready = true;
        fire('ready', {});
        flushFrames();
        return;
      }

      if (type === 'transcript.partial') {
        const text = String(msg.text == null ? '' : msg.text);
        const payload = { locale: locale, text: text };
        const conf = confidenceOf(msg);
        if (conf !== undefined) payload.conf = conf;
        addTiming(payload, msg);
        if (msg.is_final) {
          payload.speech_final = !!msg.speech_final;
          if (text) emittedFinals[text] = true;
          fire('final', payload);
        } else {
          payload.speech_final = false;
          fire('partial', payload);
        }
        return;
      }

      if (type === 'transcript.done') {
        const text = String(msg.text == null ? '' : msg.text);
        if (text && !emittedFinals[text]) {
          emittedFinals[text] = true;
          const payload = { locale: locale, text: text, speech_final: true };
          const conf = confidenceOf(msg);
          if (conf !== undefined) payload.conf = conf;
          addTiming(payload, msg);
          fire('final', payload);
        }
        shutdown('done');
        return;
      }

      if (type === 'error') { emitError('server'); }
    }

    function handleClose() { shutdown('socket'); }

    if (!key) {
      setTimeout(function () { emitError('no-key'); }, 0);
      return inertHandle();
    }

    const WS = o.WebSocket ||
      ((typeof globalThis !== 'undefined' && globalThis.WebSocket) ? globalThis.WebSocket : null);
    if (!WS) {
      setTimeout(function () { emitError('ws'); }, 0);
      return inertHandle();
    }

    const url = WS_URL_BASE +
      '?model=' + encodeURIComponent(MODEL) +
      '&sample_rate=' + SAMPLE_RATE +
      '&encoding=' + ENCODING +
      '&interim_results=true' +
      '&language=' + encodeURIComponent(language);

    // 优先带 Authorization 头（Node ws / Undici）。浏览器不能自定义头，构造会失败，
    // 退回不带头的建连 —— 真机鉴权后续步再接 ephemeral/native。
    let ws = null;
    try {
      ws = new WS(url, { headers: { Authorization: 'Bearer ' + key } });
    } catch (_) {
      try { ws = new WS(url); } catch (_) { ws = null; }
    }
    if (!ws) {
      setTimeout(function () { emitError('ws'); }, 0);
      return inertHandle();
    }

    sock = ws;
    ws.onmessage = handleMessage;
    ws.onerror = function () { emitError('ws'); };
    ws.onclose = handleClose;

    return { sendPcm: sendPcm, close: close, cut: cut };
  }

  return { open: open, WS_URL_BASE: WS_URL_BASE, FRAME_BYTES: FRAME_BYTES, MODEL: MODEL };
})();

try { window.GrokStt = GrokStt; } catch (_) {}
if (typeof module !== 'undefined' && module.exports) module.exports = GrokStt;
