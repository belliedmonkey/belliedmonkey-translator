// app/grok-stt.js — 泰语 demo 的云端流式转写会话（docs/thai-grok-stt-demo-spec.md 步 1、
// docs/thai-grok-stt-step2b-spec.md 步 2b）。
//
// 句柄形状对齐 NativeSpeech.sttOpen / WsTranscribe 的旧 open：
//   const s = GrokStt.open({ locale, apiKey, onEvent });
//   s.sendPcm(int16 | arrayBuffer | bytes); s.close(); s.cut?.();
// 事件：ready / partial / final / error / close，payload 里一律带 locale。
//
// 两条路（步 2b）：
//   · App（window.webkit.messageHandlers.mtSpeech 存在）⇒ 原生鉴权桥：JS 把 URL 拼好，
//     原生用 URLSessionWebSocketTask 带 Authorization: Bearer 连；PCM 走 base64。
//   · Node / 浏览器（无 mtSpeech）⇒ 步 1 的 WebSocket 路径原样保留（Node headers，浏览器退回无头）。
//
// 纪律：
//   · key 只进原生 open 消息 / WebSocket 的 Authorization 头；绝不写日志、绝不进 reason / 异常文本。
//     原生桥这一路 key 只在 open 消息里出现一次，JS 不保留副本。
//   · 没有 key 不抛未捕获 —— 异步 onEvent('error', { reason: 'no-key' })，句柄为空操作，且不建原生会话。
//   · 服务端 transcript.created 到之前只缓冲 PCM；到了才按 FRAME_BYTES 整帧发出（帧逻辑仍在 JS）。
//   · 已进 build/app-bundle.js 的 MODULES（App 包），但只走 Debug 开关 thaiGrokStt 的 th 路由；
//     默认关，Release 路径不启用，也不带 key。
var GrokStt = (() => {
  const WS_URL_BASE = 'wss://api.x.ai/v1/stt';
  const MODEL = 'grok-voice-transcribe-2.0';
  // 16 kHz s16le 单声道 × 100 ms = 16000 × 2 × 0.1 = 3200 字节
  const FRAME_BYTES = 3200;
  const SAMPLE_RATE = 16000;
  const ENCODING = 'pcm';
  const DEFAULT_LOCALE = 'th-TH';

  // 原生桥会话表：req → 会话（GrokStt._fromNative 按 req 分派）。步 2b 多会话用。
  const sessions = Object.create(null);
  let sessionSeq = 0;
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

  // PCM 帧 → base64（原生桥的消息体是 JSON，只能传字符串）。手写编码器，不依赖 btoa / Buffer：
  // 两个宿主都要能跑，测试也不需要额外垫片。
  function bytesToBase64(u8) {
    let out = '';
    for (let i = 0; i < u8.length; i += 3) {
      const b0 = u8[i];
      const b1 = i + 1 < u8.length ? u8[i + 1] : 0;
      const b2 = i + 2 < u8.length ? u8[i + 2] : 0;
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < u8.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      out += i + 2 < u8.length ? B64[b2 & 63] : '=';
    }
    return out;
  }

  // App 内才有 mtSpeech；扩展页 / Chrome 门禁 / Node 都没有，于是走步 1 的旧路径。
  function nativeBridge() {
    try {
      const w = (typeof window !== 'undefined') ? window : null;
      return !!(w && w.webkit && w.webkit.messageHandlers && w.webkit.messageHandlers.mtSpeech
        && typeof w.webkit.messageHandlers.mtSpeech.postMessage === 'function');
    } catch (_) { return false; }
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

  // App 原生桥（步 2b）：JS 只负责拼 URL、按帧发 PCM、映射事件；鉴权头与 WebSocket 在原生。
  // 原生回 `grok-stt-event { req, kind, … }`，由 NativeSpeech._fromNative 转给 GrokStt._fromNative。
  function openNative(o, key, locale, url) {
    const onEvent = (typeof o.onEvent === 'function') ? o.onEvent : function () {};
    const req = 'grok-' + (++sessionSeq).toString(36) + '-' + Date.now().toString(36);
    let closed = false;
    let ready = false;
    let closeFired = false;
    const chunks = [];
    let buffered = 0;

    function post(msg) {
      try { window.webkit.messageHandlers.mtSpeech.postMessage(msg); return true; } catch (_) { return false; }
    }
    function fire(kind, payload) {
      if (closed && kind !== 'close') return;
      try { onEvent(kind, payload); } catch (_) {}
    }
    function shutdown(reason) {
      if (closed) return;
      closed = true;
      delete sessions[req];
      if (closeFired) return;
      closeFired = true;
      fire('close', { reason: reason || 'closed' });
    }
    // 与步 1 同一条帧逻辑：整帧才发，不足一帧留到下一块；不同之处只是出口从 sock.send 换成原生消息。
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
        if (!post({ type: 'grok-stt-pcm', req: req, pcm: bytesToBase64(frame) })) {
          fire('error', { reason: 'ws' });
          shutdown('socket');
          return;
        }
      }
    }
    function handleFromNative(msg) {
      if (closed) return;
      const kind = String(msg.kind || '');
      if (kind === 'ready') {
        if (ready) return;
        ready = true;
        fire('ready', {});
        flushFrames();
        return;
      }
      if (kind === 'partial' || kind === 'final') {
        const payload = {
          locale: msg.locale ? String(msg.locale) : locale,
          text: String(msg.text == null ? '' : msg.text),
        };
        if (typeof msg.conf === 'number') payload.conf = msg.conf;
        if (typeof msg.t0 === 'number') payload.t0 = msg.t0;
        if (typeof msg.t1 === 'number') payload.t1 = msg.t1;
        if (kind === 'final') {
          payload.speech_final = msg.speech_final !== false;
          fire('final', payload);
        } else {
          payload.speech_final = !!msg.speech_final;
          fire('partial', payload);
        }
        return;
      }
      if (kind === 'error') { fire('error', { reason: msg.reason || 'server' }); return; }
      if (kind === 'close') shutdown(msg.reason || 'closed');
    }
    const sess = {
      sendPcm(pcm) {
        if (closed) return;
        const bytes = toBytes(pcm);
        if (!bytes || !bytes.length) return;
        chunks.push(bytes.slice());   // 复制：送进来的缓冲下一拍可能被覆写
        buffered += bytes.length;
        flushFrames();
      },
      cut() {
        if (closed) return;
        post({ type: 'grok-stt-cut', req: req });
      },
      close() {
        if (closed) return;
        post({ type: 'grok-stt-close', req: req });
        shutdown('client');
      },
      _fromNative: handleFromNative,
    };
    sessions[req] = sess;
    // key 只在 open 这一条消息里出现一次；JS 不保留副本（原生负责会话内存与关闭清理）。
    if (!post({ type: 'grok-stt-open', req: req, url: url, apiKey: key, locale: locale })) {
      delete sessions[req];
      setTimeout(function () {
        fire('error', { reason: 'ws' });
        shutdown('socket');
      }, 0);
    }
    return sess;
  }

  // 原生事件入口（由 native-speech.js 的 _fromNative 转发，或测试直接调用）。
  function _fromNative(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type && msg.type !== 'grok-stt-event') return;
    const req = msg.req ? String(msg.req) : '';
    if (!req) return;
    const sess = sessions[req];
    if (sess && typeof sess._fromNative === 'function') sess._fromNative(msg);
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

    // URL / model / sample_rate / encoding / language 一律 JS 拼好；原生桥不复制业务常量。
    const url = WS_URL_BASE +
      '?model=' + encodeURIComponent(MODEL) +
      '&sample_rate=' + SAMPLE_RATE +
      '&encoding=' + ENCODING +
      '&interim_results=true' +
      '&language=' + encodeURIComponent(language);

    // 步 2b：App 内优先走原生鉴权桥（WKWebView 的 WebSocket 不能自定义 Authorization 头）。
    // 无桥时下面的步 1 路径逐字不变（Node 带 headers；浏览器退回不带头）。
    if (nativeBridge()) return openNative(o, key, locale, url);

    const WS = o.WebSocket ||
      ((typeof globalThis !== 'undefined' && globalThis.WebSocket) ? globalThis.WebSocket : null);
    if (!WS) {
      setTimeout(function () { emitError('ws'); }, 0);
      return inertHandle();
    }

    // 优先带 Authorization 头（Node ws / Undici）。浏览器不能自定义头，构造会失败，
    // 退回不带头的建连 —— 真机鉴权由上面的原生桥承担。
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

  return { open: open, _fromNative: _fromNative, WS_URL_BASE: WS_URL_BASE, FRAME_BYTES: FRAME_BYTES, MODEL: MODEL };
})();

try { window.GrokStt = GrokStt; } catch (_) {}
if (typeof module !== 'undefined' && module.exports) module.exports = GrokStt;
