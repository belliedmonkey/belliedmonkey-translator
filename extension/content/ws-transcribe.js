// ws-transcribe.js — the live-transcription transport (docs/domain-design.md §2.4 tier B,
// §7 "live-transcription sockets are the second carve-out").
//
// ONE WebSocket client; the vendor differences are message adapters keyed by the
// registry's `liveType`. Every adapter turns its wire into the same events:
//   { kind: 'partial', text }                — the sentence being spoken (display only)
//   { kind: 'final',   text }                — a sentence closed on a terminal
//   { kind: 'error',   message }             — the server's own sentence, ≤ 1 line
//   { kind: 'close',   code, reason }        — never silent (§2.4 rule 4)
// The caller (asr-source.js) stamps times from the media clock; the socket never
// sees the page.
//
// Why the key rides the handshake (§7): a browser WebSocket cannot send headers.
//   ws-realtime → subprotocol `<registry liveKeyProtocol><key>` (the vendor's documented
//                 browser path; the prefix is a STORED registry value, not restated here)
//   ws-bidi     → `?key=` on the URL (the vendor's documented path)
// The key is never logged and never appears in an error message: adapters strip it
// before quoting a URL. Names are protocol shapes, never vendors — this file ships in
// every flavor and the compliance gate scans it line by line.
//
// Measured shapes (scripts/asr-probe.js, 2026-09-06):
//   ws-realtime: ?intent=transcription; session.update{type:'transcription', audio.input:{format:
//     {type:'audio/pcm',rate:24000}, transcription:{model}, turn_detection:null}}; the model
//     streams WORD-LEVEL deltas WITH punctuation; `completed` only on commit. Sending the
//     retired `…-beta.realtime-v1` subprotocol selects the Beta shape → 400.
//   ws-bidi: setup{model:'models/<liveModel>', generationConfig:{responseModalities:['TEXT']},
//     inputAudioTranscription:{…}}; realtimeInput.audio{data,mimeType:'audio/pcm;rate=16000'};
//     serverContent.interimInputTranscription / inputTranscription (utterance-level, no
//     timestamps); a session lasts 10 minutes → reconnect at 9:30 replaying a 2 s ring buffer.
'use strict';

var WsTranscribe = (() => {
  const CONNECT_TIMEOUT_MS = 8000;
  const IDLE_TIMEOUT_MS = 60000;      // no server frame for this long while we are sending ⇒ dead socket
  // A sentence ends at a CJK terminal (no space follows in CJK text), or at a Latin
  // terminal that is followed by whitespace / end — so "michael.com" and "3.5" never cut.
  const SENTENCE_RE = /[\s\S]*?(?:[。！？]+["'”’)\]]*|[.!?…]+["'”’)\]]*(?=\s|$))|[\s\S]+$/g;
  function splitSentences(text) {
    return (String(text || '').match(SENTENCE_RE) || []).map((x) => x.trim()).filter(Boolean);
  }
  // Complete sentences = every match except a trailing one that lacks a terminal.
  function completeSentences(text) {
    const parts = splitSentences(text);
    if (parts.length && !/(?:[。！？.!?…]+["'”’)\]]*)$/.test(parts[parts.length - 1])) return { done: parts.slice(0, -1), tail: parts[parts.length - 1] };
    return { done: parts, tail: '' };
  }
  const BIDI_RECONNECT_MS = 570000;   // 9:30 — before the 10-minute session cap
  const RING_MS = 2000;

  function stripKey(url) { return String(url || '').replace(/([?&]key=)[^&]*/i, '$1…'); }

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // A tiny sentence cutter for word-delta streams: emits a final as soon as the buffer
  // holds a terminal, keeps the rest as the open partial. Same closing intent as
  // TranslationCore.createCueMerger; that one works on cues, this one on characters.
  function sentenceCutter(emit) {
    let pending = '';
    return {
      add(delta) {
        pending += delta || '';
        const { done, tail } = completeSentences(pending);
        for (const s of done) emit({ kind: 'final', text: s });
        pending = tail;
        if (pending.trim()) emit({ kind: 'partial', text: pending.trim() });
      },
      flush() { const t = pending.trim(); pending = ''; if (t) emit({ kind: 'final', text: t }); },
    };
  }

  // For CUMULATIVE interim hypotheses (ws-bidi: each interim is the whole utterance so
  // far, occasionally revising earlier words; a final arrives only when the speaker
  // pauses — on continuous speech every ~35 s, ~100 words). Subtitles cannot wait for
  // that, so sentences are cut from the interim as soon as they are no longer the tail
  // (text follows the terminal ⇒ the model has moved on ⇒ revisions are rare). Already
  // emitted sentences are never re-emitted; the final only flushes what is left.
  function interimCutter(emit) {
    let emitted = 0;   // sentences already emitted for the current utterance
    let head = '';     // the current utterance's opening characters — a text that does not
                       // start with them is a NEW utterance (measured: the vendor's final for
                       // utterance N can arrive AFTER the first interim of N+1, so an
                       // activity-start event is not a safe reset point; the text is)
    const recent = []; // last few emitted sentences — a revised final never re-emits one
    const split = splitSentences;
    const sameUtterance = (text) => !head || String(text).slice(0, 12) === head;
    const say = (s) => { if (recent.indexOf(s) >= 0) return; recent.push(s); if (recent.length > 6) recent.shift(); emit({ kind: 'final', text: s }); };
    return {
      interim(text) {
        if (!sameUtterance(text)) { emitted = 0; }
        head = String(text).slice(0, 12);
        const parts = split(text);
        const stable = parts.length - 1; // the tail may still change
        for (let i = emitted; i < stable; i++) say(parts[i]);
        if (stable > emitted) emitted = stable;
        if (parts.length > emitted) emit({ kind: 'partial', text: parts.slice(emitted).join(' ') });
      },
      final(text) {
        if (!sameUtterance(text)) emitted = 0;
        const parts = split(text);
        for (let i = emitted; i < parts.length; i++) say(parts[i]);
        emitted = 0; head = '';
      },
      reset() { /* utterance boundaries are detected from the text itself */ },
    };
  }

  function openSocket(url, protocols, onOpen, onMessage, onClose, onError) {
    const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    ws.onopen = onOpen;
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') { onMessage(ev.data); return; }
      // Blob frames (ws-bidi sends some): read then hand over — order is preserved by
      // chaining on a promise so a fast text frame can't overtake a slow blob.
      readQueue = readQueue.then(() => ev.data.text()).then(onMessage).catch(() => {});
    };
    let readQueue = Promise.resolve();
    ws.onclose = onClose;
    ws.onerror = onError;
    return ws;
  }

  // ─── ws-realtime ─────────────────────────────────────────────────────
  function openRealtime(o, emit) {
    if (!o.keyProtocol) throw new Error('ws-realtime needs the registry liveKeyProtocol');
    const cutter = sentenceCutter(emit);
    let ws = null, closed = false, lastFrame = Date.now(), ready = false;
    const timer = setTimeout(() => { if (!ready) fail('connect timeout'); }, CONNECT_TIMEOUT_MS);
    const idle = setInterval(() => { if (ready && Date.now() - lastFrame > IDLE_TIMEOUT_MS) fail('idle'); }, 5000);
    function fail(message) { if (closed) return; emit({ kind: 'error', message }); close(); }
    function close() {
      if (closed) return; closed = true; clearTimeout(timer); clearInterval(idle);
      try { ws && ws.close(); } catch (_) {}
    }
    ws = openSocket(o.url, ['realtime', o.keyProtocol + o.apiKey],
      () => {
        ws.send(JSON.stringify({ type: 'session.update', session: {
          type: 'transcription',
          audio: { input: {
            format: { type: 'audio/pcm', rate: o.rate },
            transcription: Object.assign({ model: o.model }, o.langs && o.langs.length ? { languages: o.langs } : {}),
            turn_detection: null,
          } },
        } }));
      },
      (txt) => {
        lastFrame = Date.now();
        let m; try { m = JSON.parse(txt); } catch (_) { return; }
        const type = m.type || '';
        if (type === 'session.updated' || type === 'transcription_session.updated') { ready = true; clearTimeout(timer); emit({ kind: 'ready' }); }
        else if (type === 'conversation.item.input_audio_transcription.delta') cutter.add(m.delta);
        else if (type === 'conversation.item.input_audio_transcription.completed') cutter.flush();
        else if (type === 'error') fail(String((m.error && m.error.message) || 'server error').slice(0, 200));
      },
      (ev) => { cutter.flush(); if (!closed) { closed = true; clearTimeout(timer); clearInterval(idle); emit({ kind: 'close', code: ev.code, reason: ev.reason || '' }); } },
      () => fail('socket error'));
    return {
      sendPcm(int16) {
        if (closed || !ready || ws.readyState !== 1) return false;
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64(new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)) }));
        return true;
      },
      close() { try { if (ready && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch (_) {} close(); },
    };
  }

  // ─── ws-bidi ─────────────────────────────────────────────────────────
  function openBidi(o, emit) {
    const url = o.url + (o.url.indexOf('?') < 0 ? '?' : '&') + 'key=' + encodeURIComponent(o.apiKey);
    const setup = { setup: {
      model: 'models/' + o.model,
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription: Object.assign({ mode: 'SMART' }, o.langs && o.langs.length ? { languageCodes: o.langs } : {}),
    } };
    let ws = null, closed = false, ready = false, lastFrame = Date.now(), openedAt = 0;
    const cutter = interimCutter(emit);
    const ring = []; let ringBytes = 0; const ringCap = (o.rate * 2 * RING_MS) / 1000;
    let timer = null;
    const idle = setInterval(() => {
      if (!ready || closed) return;
      if (Date.now() - lastFrame > IDLE_TIMEOUT_MS) { fail('idle'); return; }
      if (Date.now() - openedAt > BIDI_RECONNECT_MS) reconnect();
    }, 2000);
    function fail(message) { if (closed) return; emit({ kind: 'error', message }); close(); }
    function close() {
      if (closed) return; closed = true; clearTimeout(timer); clearInterval(idle);
      try { ws && ws.close(); } catch (_) {}
    }
    function connect(isReconnect) {
      ready = false;
      clearTimeout(timer);
      timer = setTimeout(() => { if (!ready) fail('connect timeout'); }, CONNECT_TIMEOUT_MS);
      const sock = openSocket(url, null,
        () => { sock.send(JSON.stringify(setup)); },
        (txt) => {
          lastFrame = Date.now();
          let m; try { m = JSON.parse(txt); } catch (_) { return; }
          if (m.setupComplete) {
            ready = true; openedAt = Date.now(); clearTimeout(timer);
            if (isReconnect) { // replay the last 2 s so the seam loses no words
              if (ring.length) sock.send(JSON.stringify({ realtimeInput: { audio: { data: b64(concat(ring)), mimeType: 'audio/pcm;rate=' + o.rate } } }));
            } else emit({ kind: 'ready' });
            return;
          }
          const sc = m.serverContent || {};
          if (sc.interimInputTranscription && sc.interimInputTranscription.text) cutter.interim(sc.interimInputTranscription.text);
          if (sc.inputTranscription && sc.inputTranscription.text) cutter.final(sc.inputTranscription.text);
          if (m.voiceActivity && m.voiceActivity.type === 'ACTIVITY_START') cutter.reset();
          if (m.error) fail(String(m.error.message || JSON.stringify(m.error)).slice(0, 200));
        },
        (ev) => { if (sock !== ws) return; if (!closed) { closed = true; clearTimeout(timer); clearInterval(idle); emit({ kind: 'close', code: ev.code, reason: ev.reason || '' }); } },
        () => { if (sock === ws) fail('socket error'); });
      return sock;
    }
    function reconnect() {
      const old = ws;
      ws = connect(true);
      try { old.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (_) {}
      setTimeout(() => { try { old.onclose = null; old.close(); } catch (_) {} }, 3000);
    }
    function concat(chunks) {
      let n = 0; for (const c of chunks) n += c.length;
      const out = new Uint8Array(n); let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    }
    ws = connect(false);
    return {
      sendPcm(int16) {
        if (closed || !ready || ws.readyState !== 1) return false;
        const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
        ring.push(bytes.slice()); ringBytes += bytes.length;
        while (ringBytes > ringCap && ring.length > 1) ringBytes -= ring.shift().length;
        ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(bytes), mimeType: 'audio/pcm;rate=' + o.rate } } }));
        return true;
      },
      close() { try { if (ready && ws.readyState === 1) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (_) {} close(); },
    };
  }

  const ADAPTERS = { 'ws-realtime': openRealtime, 'ws-bidi': openBidi };

  // open({ url, type, apiKey, keyProtocol, model, rate, langs, onEvent }) → { sendPcm(Int16Array), close() }
  // Throws synchronously for an unknown type or a missing WebSocket — a caller must
  // know before it starts capturing.
  function open(o) {
    const fn = ADAPTERS[o.type];
    if (!fn) throw new Error('unknown live type ' + o.type);
    if (typeof WebSocket === 'undefined') throw new Error('no WebSocket');
    const emit = (ev) => { try { o.onEvent(ev); } catch (_) {} };
    return fn(o, emit);
  }

  return { open, sentenceCutter, interimCutter, splitSentences, completeSentences, stripKey, TYPES: Object.keys(ADAPTERS), RING_MS, BIDI_RECONNECT_MS };
})();

if (typeof window !== 'undefined') window.WsTranscribe = WsTranscribe;
if (typeof module !== 'undefined' && module.exports) module.exports = WsTranscribe;
