// asr-source.js — the §2.4 subtitle source: 「AI 转写字幕」(docs/domain-design.md §2.4).
//
// Started ONLY from the user's tap (the offer inside `字幕不可用`, or the popup action).
// Two tiers, tried in order, every outcome visible in the overlay:
//   A. file  — the media has a fetchable http(s) URL: fetch the bytes, transcribe them
//              (in ≤ CHUNK_BYTES slices so the first subtitles arrive early), push the
//              timed cues. Complete transcript per slice — §2.1 rule 1 holds.
//   B. live  — no fetchable URL (blob:/MSE) or the CDN refuses cross-origin reads:
//              capture the element's audio in-page, stream PCM over WsTranscribe, push
//              whole sentences as they close. The one written exception to "complete
//              transcript up front" (§2.4 rule 3).
//   C. neither — ctx.fail(<why>): the notice names the reason and re-offers.
//
// Capture is the capability, never the floor (§5.3 second instance):
//   · Chrome/Firefox: HTMLMediaElement.captureStream() — REFUSES cross-origin data
//     loaded without `crossorigin` (measured 2026-09-06: it throws, it does not mute).
//   · Safari: no captureStream; Web Audio createMediaElementSource() reroutes the
//     element's audio through the graph and outputs SILENCE for cross-origin media.
//   So for an http(s) source both paths first probe CORS with a ranged GET, reload the
//   element with crossOrigin='anonymous' at the same position, then attach.
//   blob:/MSE sources are same-origin and attach directly.
//   Silence guard: RMS ≈ 0 for 3 s while playing & unmuted ⇒ stop, say so.
//
// Audio goes only to the endpoint the user configured (§2.4 rule 5). Nothing here
// touches our backend, IndexedDB, or the sync chunk.
'use strict';

var AsrSource = (() => {
  const CHUNK_BYTES = 6 * 1024 * 1024;     // ≈ 6 min at 128 kbps: first subtitles in ~20 s
  const MAX_BYTES = 120 * 1024 * 1024;      // ≈ 2 h at 128 kbps — beyond this, say so
  const INLINE_LIMIT = 18 * 1024 * 1024;    // Gemini inline base64 ceiling (docs: ~20 MB)
  const SILENCE_MS = 3000;
  const SILENCE_RMS = 1e-4;
  const PROCESSOR_FRAMES = 4096;
  const MIN_DURATION_S = 30;                // the offer only for media at least this long
  const STT_KEYS = ['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel'];

  const T = (k, fb) => (typeof TranslationCore !== 'undefined' ? TranslationCore.t(k, fb) : fb);

  // ─── Settings / engine ─────────────────────────────────────────────
  function engineById(id) {
    const list = (typeof window !== 'undefined' && window.MT_STT_ENGINES) || [];
    return list.find((e) => e.id === id) || null;
  }
  async function readSttConfig() {
    const s = await RequestShape.storageGet(STT_KEYS);
    const eng = engineById(s.sttEngine);
    if (!eng) return { ok: false, reason: 'no_engine' };
    if (eng.requiresEndpoint && !s.sttBaseUrl) return { ok: false, reason: 'no_base' };
    if (eng.needsKey && !s.sttApiKey) return { ok: false, reason: 'no_key' };
    return { ok: true, eng, apiKey: s.sttApiKey || '', baseUrl: s.sttBaseUrl || '', model: s.sttModel || eng.defaultModel || '' };
  }
  // §2.4 rule 6: a change to the transcription settings stops every running session,
  // visibly. Sessions register here; the storage listener below fans out.
  const sessions = new Set();
  function stopAllForSettings() {
    for (const s of Array.from(sessions)) { try { s.fail(T('asr_err_settings', '转写引擎已更改，已停止转写')); } catch (_) {} }
    sessions.clear();
  }
  // Synchronous "is an engine configured" for the offer label: read once, cached, refreshed
  // whenever storage changes. The offer must not await storage on every tick.
  let cached = null;
  function primeConfig() {
    readSttConfig().then((c) => { cached = c; }).catch(() => { cached = { ok: false, reason: 'no_engine' }; });
  }
  try { chrome.storage.onChanged.addListener((ch) => { if (STT_KEYS.some((k) => k in ch)) { primeConfig(); stopAllForSettings(); } }); } catch (_) {}
  primeConfig();

  // ─── Media URL ─────────────────────────────────────────────────────
  function mediaUrl(el) {
    const src = (el && (el.currentSrc || el.src)) || (el && el.querySelector && (el.querySelector('source') || {}).src) || '';
    return /^https?:/i.test(src) ? src : '';
  }
  function fetchWithTimeout(url, init, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    const onAbort = () => ctl.abort();
    if (init && init.signal) init.signal.addEventListener('abort', onAbort, { once: true });
    return fetch(url, Object.assign({}, init, { signal: ctl.signal })).finally(() => { clearTimeout(timer); });
  }
  // Can this origin read the media bytes? A ranged GET, not HEAD (archive.org HEAD stalls).
  async function corsReadable(url, signal) {
    try {
      const r = await fetchWithTimeout(url, { mode: 'cors', headers: { Range: 'bytes=0-1023' }, signal }, 8000);
      return r.ok || r.status === 206;
    } catch (_) { return false; }
  }

  // ─── Tier A: file ──────────────────────────────────────────────────
  async function fileTier({ url, cfg, ctx, signal, language }) {
    ctx.mode('file');
    ctx.notice(T('asr_status_file', '⏳ 正在转写整段音频…'));
    const endpoint = WireFormat.resolveEndpoint(cfg.baseUrl, cfg.eng);
    const fmt = WireFormat.formatFor(endpoint, cfg.eng.type);
    const enc = RequestShape.audioEncoding(fmt);
    const r = await fetchWithTimeout(url, { mode: 'cors', signal }, 60000);
    if (!r.ok) throw named('media', 'HTTP ' + r.status);
    const len = +(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw named('toolarge', Math.round(len / 1048576) + 'MB');
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw named('toolarge', Math.round(buf.length / 1048576) + 'MB');
    const mime = (r.headers.get('content-type') || '').split(';')[0] || guessMime(url);
    const ext = extOf(mime, url);
    if (fmt === 'transcribe-gemini' && buf.length > INLINE_LIMIT && false) { /* Files API path: reserved (uploadEndpoint) */ }

    // Slice on byte boundaries. MP3/AAC frames resync at the next header, so a slice
    // transcribes fine; the slice's time offset comes from the previous response's
    // reported duration (or its last cue end), which keeps drift to a frame or two.
    let offsetMs = 0, total = 0, gotAny = false;
    for (let at = 0; at < buf.length; at += CHUNK_BYTES) {
      if (signal.aborted) return;
      const slice = buf.subarray(at, Math.min(buf.length, at + CHUNK_BYTES));
      const o = { url: endpoint, apiKey: cfg.apiKey, model: cfg.model, language, wantCues: true,
        filename: 'audio.' + ext, audioMime: mime, audioFormat: ext };
      if (enc === 'blob') o.file = new Blob([slice], { type: mime });
      else if (enc === 'base64') o.audioBase64 = b64(slice);
      else o.audioDataUri = 'data:' + mime + ';base64,' + b64(slice);
      const req = RequestShape.build(fmt, o);
      if (req.error) throw named('media', req.error);
      const resp = await fetchWithTimeout(endpoint, { method: 'POST', headers: req.headers, body: req.body, signal }, Math.max(RequestShape.timeoutMs(), 60000 + 4000 * Math.ceil(slice.length / 1048576)));
      const text = await resp.text();
      let d = null; try { d = JSON.parse(text); } catch (_) {}
      if (!resp.ok) throw named('http', 'HTTP ' + resp.status + ' ' + serverSays(d, text));
      const cues = req.extractCues ? req.extractCues(d) : [];
      if (!cues.length) {
        // A text-only answer (an engine without timestamps) is NOT a subtitle source —
        // never regress to translating a plain transcript per line (§2.1 rule 3).
        throw named('nocues', cfg.eng.label || cfg.eng.id);
      }
      const shifted = splitAtTerminals(cues).map((c) => ({ start: c.start + offsetMs, end: c.end + offsetMs, text: c.text }));
      ctx.push(shifted); gotAny = true;
      const dur = req.durationOf ? req.durationOf(d) : null;
      offsetMs += dur || shifted[shifted.length - 1].end - offsetMs;
      total += slice.length;
      ctx.notice(T('asr_status_file', '⏳ 正在转写整段音频…') + ' ' + Math.round((total / buf.length) * 100) + '%');
    }
    if (gotAny) { ctx.notice(''); ctx.done(); }
  }

  // Cut a cue at sentence terminals with proportional timing — the same rule the
  // probe measured (boundary hit 36 % → 95 % on whisper segments).
  function splitAtTerminals(cues) {
    const out = [];
    const splitter = (typeof WsTranscribe !== 'undefined' && WsTranscribe.splitSentences) || ((t) => [t]);
    for (const c of cues) {
      const parts = splitter(String(c.text));
      if (!parts.length) parts.push(String(c.text));
      const total = parts.reduce((a, p) => a + p.length, 0) || 1;
      let t = c.start;
      for (const p of parts) {
        const dur = (c.end - c.start) * (p.length / total);
        const txt = p.trim();
        if (txt) out.push({ start: Math.round(t), end: Math.round(t + dur), text: txt });
        t += dur;
      }
    }
    return out;
  }

  // ─── Tier B: live ──────────────────────────────────────────────────
  let audioCtx = null;
  const elementSources = new WeakMap(); // createMediaElementSource is once-per-element
  // Must run INSIDE the tap handler on iOS: an AudioContext created outside a gesture
  // stays suspended forever, silently.
  function prepareAudioContext() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (_) { audioCtx = null; }
    return audioCtx;
  }

  async function attachCapture(el, url, signal) {
    const ac = prepareAudioContext();
    if (!ac) throw named('media', 'no AudioContext');
    let sourceNode;
    if (typeof el.captureStream === 'function' || typeof el.mozCaptureStream === 'function') {
      // Chrome / Firefox. A cross-origin http(s) source must be reloaded with
      // crossorigin, or captureStream throws "Cannot capture from element with cross-origin data".
      if (url && !el.crossOrigin) {
        if (!(await corsReadable(url, signal))) throw named('cors', url);
        await reloadWithCors(el, url);
      }
      const stream = (el.captureStream || el.mozCaptureStream).call(el);
      const tracks = stream.getAudioTracks();
      if (!tracks.length) throw named('media', 'no audio track');
      sourceNode = ac.createMediaStreamSource(new MediaStream([tracks[0]]));
    } else {
      // Safari: the element's audio is REROUTED through the graph — keep it audible by
      // wiring the node to the destination, and never attach to a source that would
      // output silence (cross-origin without CORS).
      if (url && !el.crossOrigin) {
        if (!(await corsReadable(url, signal))) throw named('cors', url);
        await reloadWithCors(el, url);
      }
      sourceNode = elementSources.get(el);
      if (!sourceNode) { sourceNode = ac.createMediaElementSource(el); elementSources.set(el, sourceNode); sourceNode.connect(ac.destination); }
    }
    return { ac, sourceNode };
  }
  function reloadWithCors(el, url) {
    return new Promise((resolve) => {
      const t = el.currentTime, wasPaused = el.paused;
      el.crossOrigin = 'anonymous';
      const done = () => { el.removeEventListener('loadedmetadata', done); try { el.currentTime = t; } catch (_) {} if (!wasPaused) el.play().catch(() => {}); resolve(); };
      el.addEventListener('loadedmetadata', done);
      setTimeout(done, 8000); // never wait forever on a stalled reload
      el.src = url; el.load();
    });
  }

  // Float32 @ ac.sampleRate → Int16 @ rate, averaging over the decimation window.
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
      const used = Math.floor(n * ratio);
      carry = input.subarray(used);
      return out;
    };
  }
  function concatF32(a, b) { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

  async function liveTier({ el, url, cfg, ctx, signal, language }) {
    const eng = cfg.eng;
    if (!eng.liveEndpoint || !eng.liveType) throw named('nolive', eng.label || eng.id);
    ctx.mode('live');
    const { ac, sourceNode } = await attachCapture(el, url, signal);
    const rate = eng.liveRate || 16000;
    const resample = makeResampler(ac.sampleRate, rate);
    ctx.notice(T('asr_status_live', '● 实时转写中'));

    let sentenceStart = null; // media clock when the current sentence began (first partial)
    let stopped = false;
    const sock = WsTranscribe.open({
      url: eng.liveEndpoint, type: eng.liveType, apiKey: cfg.apiKey, keyProtocol: eng.liveKeyProtocol || '', model: eng.liveModel || cfg.model, rate,
      langs: language ? [language] : [],
      onEvent: (ev) => {
        if (stopped) return;
        const now = Math.round(el.currentTime * 1000);
        if (ev.kind === 'partial') { if (sentenceStart == null) sentenceStart = now; }
        else if (ev.kind === 'final') {
          const start = sentenceStart == null ? Math.max(0, now - 2000) : sentenceStart;
          sentenceStart = null;
          ctx.push([{ start, end: Math.max(start + 1, now), text: ev.text }]);
        }
        else if (ev.kind === 'error') stop(T('asr_err_ws', '转写连接中断') + (ev.message ? '：' + String(ev.message).slice(0, 80) : ''));
        else if (ev.kind === 'close') { if (!stopped) stop(T('asr_err_ws', '转写连接中断')); }
      },
    });

    const proc = ac.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
    let silentSince = 0;
    proc.onaudioprocess = (e) => {
      if (stopped) return;
      const f32 = e.inputBuffer.getChannelData(0);
      if (el.paused) return; // paused media: send nothing, pay nothing
      let s = 0; for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i];
      const rms = Math.sqrt(s / f32.length);
      const audible = !el.muted && el.volume > 0;
      if (rms < SILENCE_RMS && audible) {
        if (!silentSince) silentSince = Date.now();
        else if (Date.now() - silentSince > SILENCE_MS) { stop(T('asr_err_silent', '捕获不到声音，已停止转写')); return; }
      } else silentSince = 0;
      const pcm = resample(f32);
      if (pcm.length) sock.sendPcm(pcm);
    };
    sourceNode.connect(proc);
    // ScriptProcessorNode needs a sink to run; a zero-gain node keeps the captured
    // signal out of the speakers on the captureStream path (the element still plays).
    const mute = ac.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(ac.destination);

    function stop(msg) {
      if (stopped) return; stopped = true;
      try { sourceNode.disconnect(proc); } catch (_) {}
      try { proc.disconnect(); mute.disconnect(); } catch (_) {}
      try { sock.close(); } catch (_) {}
      if (msg) ctx.fail(msg); else ctx.done();
    }
    signal.addEventListener('abort', () => stop(null), { once: true });
    ctx.onAbort(() => stop(null));
  }

  // ─── Session ───────────────────────────────────────────────────────
  function named(code, detail) { const e = new Error(detail || code); e.code = code; return e; }
  function serverSays(d, text) {
    const m = d && ((d.error && (d.error.message || d.error)) || d.message);
    return String(m || text || '').replace(/\s+/g, ' ').slice(0, 120);
  }
  function failMessage(e) {
    const c = e && e.code;
    if (c === 'cors' || c === 'media') return T('asr_err_media', '无法读取该音频');
    if (c === 'silent') return T('asr_err_silent', '捕获不到声音，已停止转写');
    if (c === 'toolarge') return T('asr_err_toolarge', '音频太大，无法整段转写') + '（' + e.message + '）';
    if (c === 'nocues') return T('asr_err_nocues', '该转写引擎不返回时间戳，无法做字幕') + '（' + e.message + '）';
    if (c === 'nolive') return T('asr_err_nolive', '该转写引擎没有实时接口，此媒体无法转写');
    if (c === 'http') return T('asr_err_ws', '转写连接中断') + '：' + String(e.message).slice(0, 100);
    if (e && e.name === 'AbortError') return '';
    return T('asr_err_ws', '转写连接中断') + (e && e.message ? '：' + String(e.message).slice(0, 80) : '');
  }
  function guessMime(url) {
    const u = String(url).split('?')[0].toLowerCase();
    if (/\.m4a$|\.mp4$|\.aac$/.test(u)) return 'audio/mp4';
    if (/\.wav$/.test(u)) return 'audio/wav';
    if (/\.ogg$|\.oga$|\.opus$/.test(u)) return 'audio/ogg';
    if (/\.flac$/.test(u)) return 'audio/flac';
    if (/\.webm$/.test(u)) return 'audio/webm';
    return 'audio/mpeg';
  }
  function extOf(mime, url) {
    const m = String(mime).toLowerCase();
    if (/mp4|m4a|aac/.test(m)) return 'm4a';
    if (/wav/.test(m)) return 'wav';
    if (/ogg|opus/.test(m)) return 'ogg';
    if (/flac/.test(m)) return 'flac';
    if (/webm/.test(m)) return 'webm';
    if (/mpeg|mp3/.test(m)) return 'mp3';
    return extOf(guessMime(url), '');
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // The acquire the harness runs (via ui.acquireVia). Returns 'streaming' and feeds ctx.
  function startSession({ el, ctx, settings }) {
    const ctl = new AbortController();
    const signal = ctl.signal;
    const session = { fail: (msg) => { ctl.abort(); ctx.fail(msg); } };
    sessions.add(session);
    signal.addEventListener('abort', () => sessions.delete(session), { once: true });
    ctx.onAbort(() => ctl.abort());
    const language = ''; // auto-detect; the media's language is not the target language
    (async () => {
      const cfg = await readSttConfig();
      if (!cfg.ok) { ctx.fail(T('asr_needs_engine', '先在设置里选择转写引擎')); return; }
      const url = mediaUrl(el);
      try {
        if (url && await corsReadable(url, signal)) { await fileTier({ url, cfg, ctx, signal, language }); return; }
      } catch (e) {
        if (signal.aborted) return;
        // A file-tier failure that is about the ENGINE (no timestamps, http error) is final;
        // one about the MEDIA falls through to capture.
        if (e.code === 'nocues' || e.code === 'http' || e.code === 'toolarge') { ctx.fail(failMessage(e)); return; }
      }
      try { await liveTier({ el, url, cfg, ctx, signal, language }); }
      catch (e) { if (!signal.aborted) ctx.fail(failMessage(e)); }
    })();
    return 'streaming';
  }

  // ─── The offer (shared by every subtitle backend) ─────────────────
  // offerFor(getEl, ui, getSettings) → () => {label, onClick} | null, for spec.unavailableAction.
  function offerFor(getEl, getUi, getSettings) {
    return () => {
      const el = getEl();
      const ui = getUi();
      if (!el || !ui || !(el.duration >= MIN_DURATION_S)) return null;
      if (ui.streaming) return null;
      const c = cached;
      if (!c || !c.ok) {
        return { label: T('asr_needs_engine', '先在设置里选择转写引擎'), onClick: () => {
          try { window.open(chrome.runtime.getURL('options/options.html') + '#stt', '_blank'); } catch (_) {}
        } };
      }
      return { label: T('asr_offer', '🎙 AI 转写字幕'), onClick: () => start(el, ui, getSettings()) };
    };
  }
  function start(el, ui, settings) {
    if (!el || !ui) return false;
    prepareAudioContext(); // inside the gesture
    ui.acquireVia((ctx) => startSession({ el, ctx, settings }));
    return true;
  }

  function eligible(el) { return !!el && el.duration >= MIN_DURATION_S; }

  return { startSession, offerFor, start, eligible, prepareAudioContext, splitAtTerminals, makeResampler, mediaUrl, MIN_DURATION_S, CHUNK_BYTES };
})();

if (typeof window !== 'undefined') window.AsrSource = AsrSource;
if (typeof module !== 'undefined' && module.exports) module.exports = AsrSource;
