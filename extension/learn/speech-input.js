// learn/speech-input.js — 语音输入 (§9.4): record the user's own voice at their
// explicit tap, transcribe it via the USER'S OWN transcribe-compat endpoint, and
// DISCARD the recording. See docs/learning-design.md §9.4 and §10 Gate C.
//
// Privacy contract, enforced by construction: the blob exists only between stop()
// and the transcription response — it never touches IndexedDB, never enters the
// sync chunk, and goes only to the endpoint the user configured. The browser's own
// SpeechRecognition (recordings to vendor servers) is permanently rejected (§12)
// and is not used anywhere in this file.
//
// Capability semantics (§5.2/§5.4): no engine configured, or no microphone API on
// this host ⇒ `capable()` is false ⇒ the 说 exercise DOES NOT EXIST — never a
// disabled button with an apology.
//
// EXTENSION PAGES ONLY (and the app's WKWebView) — same hosts as tts.js.

var LearnSpeech = (() => {
  let cfg = { engineId: '', baseUrl: '', apiKey: '', model: '' };

  function configure(c) { cfg = Object.assign({}, cfg, c || {}); }

  function engineInfo() {
    const list = (typeof window !== 'undefined' && window.MT_STT_ENGINES) || [];
    return list.find((e) => e.id === cfg.engineId) || null;
  }

  // Engine-side readiness, with a named reason — same shape as LearnTTS.available.
  function engineReady() {
    const e = engineInfo();
    if (!e) return { ok: false, reason: 'no_engine' };
    if (!(cfg.baseUrl || e.defaultEndpoint)) return { ok: false, reason: 'no_base' };
    if (e.needsKey && !cfg.apiKey) return { ok: false, reason: 'no_key' };
    return { ok: true };
  }

  function micPresent() {
    return !!(typeof navigator !== 'undefined' && navigator.mediaDevices
      && navigator.mediaDevices.getUserMedia
      && typeof MediaRecorder !== 'undefined');
  }

  function capable() { return engineReady().ok && micPresent(); }

  // Container preference: Safari records mp4/aac, Chrome webm/opus. The FILENAME
  // extension must match the container — a mismatch is where whisper-compatible
  // servers typically reject the upload.
  const MIMES = [
    { mime: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
  ];
  function pickMime() {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
        for (const m of MIMES) if (MediaRecorder.isTypeSupported(m.mime)) return m;
      }
    } catch (_) {}
    return { mime: '', ext: 'webm' };
  }

  // Start recording. Returns { stop(): Promise<{blob, ext}>, cancel() }. The mic
  // tracks are ALWAYS stopped, on every path — a stuck recording indicator is a
  // trust bug, not a cosmetic one.
  async function startRecording() {
    if (!micPresent()) { const e = new Error('no microphone API'); e.code = 'no_mic'; throw e; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const e = new Error('microphone denied'); e.code = 'mic_denied'; throw e;
    }
    const release = () => {
      try { stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} }); } catch (_) {}
    };
    const m = pickMime();
    let rec;
    try {
      rec = m.mime ? new MediaRecorder(stream, { mimeType: m.mime }) : new MediaRecorder(stream);
    } catch (err) {
      release();
      const e = new Error('recorder unsupported'); e.code = 'unsupported'; throw e;
    }
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise((resolve) => { rec.onstop = () => resolve(); });
    rec.start();
    return {
      stop() {
        try { if (rec.state !== 'inactive') rec.stop(); } catch (_) {}
        return stopped.then(() => {
          release();
          const type = m.mime || (chunks[0] && chunks[0].type) || 'audio/webm';
          return { blob: new Blob(chunks, { type }), ext: m.ext };
        });
      },
      cancel() {
        try { if (rec.state !== 'inactive') rec.stop(); } catch (_) {}
        release();
      },
    };
  }

  // Multipart POST to the user's endpoint; the blob is not referenced after the
  // response settles. `language` is sent only when the card's language is known —
  // 'und' (every Safari capture) must not be asserted as a language.
  async function transcribe(blob, ext, lang) {
    const { resp, extract } = await postAudio(blob, ext, lang);
    return readTranscript(resp, extract);
  }

  // 传输本身。transcribe 与 test 共用它 —— 「测试」若自己另写一遍请求，
  // 测的就不是真正要跑的那条路了。
  async function postAudio(blob, ext, lang) {
    const ready = engineReady();
    if (!ready.ok) { const e = new Error(ready.reason); e.code = ready.reason; throw e; }
    const eng = engineInfo();
    // Used EXACTLY as stored — no path appended, no trailing slash trimmed. The trim
    // that used to live here has moved into wire-format.js's legacy branch, where it
    // belongs: it was never a correction, it was a reproduction of what the old code
    // did to this user's saved value, and reproducing it is how a device whose
    // one-time migration never ran keeps working.
    const url = WireFormat.resolveEndpoint(cfg.baseUrl, eng);
    // multipart 体同样由 RequestShape 一处构造。这条路本来就是「条件发送」的范例
    // （model / language 缺了就不发），改过来是为了让四条传输只有一个地方知道
    // 「不要手写 Content-Type，boundary 只有浏览器自己知道」。
    const l = String(lang || '').split('-')[0].toLowerCase();
    const fmt = WireFormat.formatFor(url, eng && eng.type);
    // 有的转写形状收的是 JSON 里的 data URI，不是 multipart。要不要编由 RequestShape
    // 回答 —— 这里只问「这条路要不要」，不认识具体有哪几种形状。
    // 只在需要时才编：base64 会把体积撑大三分之一，而多数路径根本用不上。
    const audioDataUri = RequestShape.wantsAudioDataUri(fmt) ? await blobToDataUri(blob) : '';
    const req = RequestShape.build(fmt, {
      url, apiKey: cfg.apiKey,
      model: cfg.model || eng.defaultModel,
      file: blob, filename: 'speech.' + (ext || 'webm'),
      audioDataUri, audioFormat: ext || 'wav',
      language: (l && l !== 'und') ? l : '',
    });
    if (req.error) { const e = new Error(req.error); e.code = req.error; throw e; }
    const fd = req.body;
    const headers = req.headers;
    // A cross-origin POST to a SELF-HOSTED endpoint is the normal case here (the
    // review page's origin is never the transcription server's). If that server
    // omits `Access-Control-Allow-Origin`, WebKit rejects the response before any
    // status is visible to us — `fetch` throws a bare TypeError ("Load failed"),
    // which is indistinguishable from "host unreachable" unless we name it.
    // Measured 2026-08-13 on the iOS simulator: the server received and processed
    // the upload, and the page still saw only a TypeError. So: name it, and point
    // at the two causes a user can actually act on (reachability, CORS).
    // `url` rides on the error so the settings page can echo the address it actually
    // requested — with a user-supplied endpoint, "which URL did we call" is the fact
    // that separates a wrong address from an unreachable one, and no error text can
    // supply it.
    let resp;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: fd });
    } catch (err) {
      const e = new Error('cannot reach the transcription endpoint');
      e.code = 'network';
      e.url = url;
      throw e;
    }
    if (!resp.ok) {
      const e = new Error('HTTP ' + resp.status);
      e.code = 'http'; e.status = resp.status; e.url = url;
      throw e;
    }
    return { resp, extract: req.extract };
  }

  // Blob → `data:<mime>;base64,…`。录音本身的生命周期不变：它仍然只活在 stop()
  // 与响应落定之间，编出来的串同理。
  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('cannot read the recording'));
      r.readAsDataURL(blob);
    });
  }

  async function readTranscript(resp, extract) {
    // Whisper-compatible servers answer {text} as JSON; some answer text/plain.
    let text = '';
    const raw = await resp.text();
    try {
      const d = JSON.parse(raw);
      // 形状自带的取值函数优先 —— 它知道自己的回包长什么样。没有就按
      // Whisper 兼容那两种键找。
      text = extract ? extract(d) : ((d && (d.text != null ? d.text : d.transcript)) || '');
    } catch (_) {
      text = raw;
    }
    text = String(text == null ? '' : text).trim();
    if (!text) { const e = new Error('empty transcript'); e.code = 'empty_transcript'; throw e; }
    return text;
  }

  // 连通性自检（设置页的「测试」按钮）。走的是 postAudio —— 同一段传输、同一组
  // 失败码，所以它通过就代表说题的上传这一段真的能通。
  //
  // 不要求真的听出东西：**HTTP 200 就算通过**，哪怕转写为空。测试要回答的是
  // 「地址对不对、key 对不对、跨域放不放行」，把「有没有听清」混进来只会让一次
  // 成功的连通显示成失败。
  //
  // 用一段 0.6 秒的轻音而不是静音：静音文件被一些端点判为无效输入，那种拒绝
  // 会被误读成 key 有问题。
  async function test() {
    const t0 = Date.now();
    const { resp, extract } = await postAudio(toneWav(600), 'wav', '');
    let sample = '';
    try { sample = await readTranscript(resp, extract); } catch (e) { sample = ''; }   // 空转写照样算通
    return { ok: true, ms: Date.now() - t0, sample: String(sample).slice(0, 40) };
  }

  function toneWav(ms) {
    const rate = 16000;
    const n = Math.floor((rate * ms) / 1000);
    const buf = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buf);
    const put = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    put(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); put(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    put(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      view.setInt16(44 + i * 2, Math.round(3000 * Math.sin((i * 2 * Math.PI * 440) / rate)), true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function engines() {
    return (typeof window !== 'undefined' && window.MT_STT_ENGINES) || [];
  }

  return { configure, engineReady, micPresent, capable, startRecording, transcribe, test, engines };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnSpeech;
