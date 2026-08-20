// learn/tts.js — speech synthesis for the learning layer (记忆层).
// Engine registry: build/tts.config.js → content/tts.gen.js (window.MT_TTS_ENGINES).
// Interaction rules: docs/interaction-spec.md 「复习 / Review」→ 语音.
//
// Two engine formats, and the difference between them is load-bearing:
//
//   'browser'        the platform's own speechSynthesis. Free, offline, zero config,
//                    and the DEFAULT. It only *speaks* — the Web Speech API exposes
//                    no way to obtain the audio data — so nothing from this engine
//                    can be cached or, later, uploaded. That is a permanent property
//                    of the API, not a gap to fill in.
//   'speech-compat'  the /v1/audio/speech request shape, which is what self-hosted and
//                    hosted TTS servers alike implement. Returns bytes, so results are
//                    cached locally (synthesis costs the user money or CPU, and a
//                    card is replayed many times).
//
// EXTENSION PAGES ONLY — it touches the audio cache in IndexedDB (see learn/store.js
// for why that cannot live in a content script).

var LearnTTS = (() => {
  const DEFAULTS = {
    engineId: 'browser',
    baseUrl: '', apiKey: '', model: '', voice: '',
    // 「这个地址是按新语义（原样使用）存的」的戳；缺席 ⇒ 走 wire-format 的 legacy 分支。
    rate: 1, pitch: 1,
    format: 'mp3',
    // How long to wait for the utterance's `start` before calling it blocked.
    // 1500ms proved too short on a real iPhone: a cold device voice can take
    // longer to fire `start`, and on timeout we cancel() — which turned a slow
    // start into permanent silence. A blocked autoplay just surfaces its message
    // a beat later; a real voice that needed 3s still plays.
    startTimeoutMs: 4000,
    // How long the synthesizer gets to settle after a cancel() interrupted live
    // (or queued) speech. iOS silently swallows a speak() issued right on the
    // heels of such a cancel — including a cancel from a PREVIOUS call (the
    // review page calls stop() on every card change), which is why the marker
    // lives in stop() and not in speak().
    settleMs: 250,
  };

  let cfg = Object.assign({}, DEFAULTS);
  let current = null;          // the live HTMLAudioElement, if any
  // Generation counter: bumped by every stop() (and thus every speak(), which
  // stops first). Async work re-checks it at each resume point — a speak() whose
  // epoch is stale belongs to a card the user has already left, and above all its
  // start-timeout must NOT fire cancel() into the CURRENT card's live playback.
  // (Observed shape: card A's blocked speak times out seconds later and silences
  // card B mid-sentence, after B already reported ok.)
  let epoch = 0;
  // When a cancel() actually interrupted live or queued speech — set by stop()
  // itself so an interrupt from a previous call (card change) still counts.
  let lastInterruptAt = 0;
  // Resolver for the in-flight playback's `done` promise (see speak()). stop()
  // fires it so a caller waiting for "playback finished" can never hang on a
  // playback that was interrupted instead of ending.
  let currentDone = null;
  let voicesCache = null;
  const voiceSubs = [];
  let voiceHookInstalled = false;

  function engines() {
    return (typeof window !== 'undefined' && window.MT_TTS_ENGINES) || [];
  }
  function engineById(id) { return engines().find((e) => e.id === id) || null; }
  function engine() { return engineById(cfg.engineId) || engineById('browser'); }

  function configure(next) {
    cfg = Object.assign({}, DEFAULTS, next || {});
    return cfg;
  }

  // ─── Voices (browser engine) ─────────────────────────────────────────────
  // getVoices() is empty until the platform has loaded them, and only announces it
  // via `voiceschanged`. Reading it once at startup returns [] on every Safari and
  // on a cold Chrome profile — the classic way this feature "works on my machine".
  function loadVoices(timeoutMs) {
    if (voicesCache && voicesCache.length) return Promise.resolve(voicesCache);
    if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
    const now = speechSynthesis.getVoices() || [];
    if (now.length) { voicesCache = now; return Promise.resolve(now); }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        voicesCache = speechSynthesis.getVoices() || [];
        resolve(voicesCache);
      };
      try { speechSynthesis.addEventListener('voiceschanged', finish, { once: true }); } catch (_) {}
      setTimeout(finish, timeoutMs || 1500);
    });
  }

  // Voices arriving late is not just a "wait for them" problem — it is a
  // "re-decide" problem. Anything that asked BEFORE they landed was told the engine
  // is unsupported, and without this it would never be told otherwise: the review
  // page would sit there with a disabled ▶ and "this browser has no built-in
  // speech", on a machine with 199 voices. (Observed exactly that.)
  function onVoicesChanged(cb) {
    if (typeof cb === 'function') voiceSubs.push(cb);
    installVoiceHook();
    return () => {
      const i = voiceSubs.indexOf(cb);
      if (i >= 0) voiceSubs.splice(i, 1);
    };
  }

  function installVoiceHook() {
    if (voiceHookInstalled || typeof speechSynthesis === 'undefined') return;
    voiceHookInstalled = true;
    try {
      speechSynthesis.addEventListener('voiceschanged', () => {
        voicesCache = speechSynthesis.getVoices() || [];
        for (const cb of voiceSubs.slice()) { try { cb(voicesCache); } catch (_) {} }
      });
    } catch (_) { voiceHookInstalled = false; }
  }

  function baseLang(tag) { return String(tag || '').replace('_', '-').split('-')[0].toLowerCase(); }

  // 'und' is a real population, not an edge case: the browser-native detector is
  // absent on EVERY Safari (domain-design §5.3), so every card captured there has
  // lang 'und'. For those, the ONLY sane voice is one the user explicitly chose —
  // and the failure message must say that, not claim the system lacks a language
  // nobody named ("no voice for this language" for an unknown language sent a user
  // hunting iOS settings for an English voice their phone obviously has).
  function undLang(tag) { const b = baseLang(tag); return !b || b === 'und'; }

  // Language-aware, not a single global voice: a Japanese card read by an English
  // voice is worse than no audio. Preference order —
  //   1. the user's chosen voice, IF it speaks this card's language
  //   2. any system voice for this language (a default-flagged one first)
  //   3. nothing — and the caller must SAY so rather than fail silently
  function pickVoice(voices, lang, preferredURI) {
    const want = baseLang(lang);
    if (!want || want === 'und') {
      const pref0 = voices.find((v) => v.voiceURI === preferredURI);
      return pref0 || null;
    }
    const matches = voices.filter((v) => baseLang(v.lang) === want);
    if (!matches.length) return null;
    const preferred = matches.find((v) => v.voiceURI === preferredURI);
    if (preferred) return preferred;
    return matches.find((v) => v.default) || matches[0];
  }

  // ─── Cache key ───────────────────────────────────────────────────────────
  // Identical across devices by construction, and identical to the key a future
  // opt-in upload would use — which is what makes a local → server → synthesize
  // fallback fall out for free instead of needing a migration.
  function cacheKey(text, lang) {
    const e = engine();
    return LearnModel.hash16([
      e ? e.id : '', cfg.model || '', cfg.voice || '', baseLang(lang),
      LearnModel.normText(text),
    ].join('\u0000'));
  }

  // ─── speech-compat transport ─────────────────────────────────────────────
  async function fetchAudio(text, lang) {
    const e = engine();
    // Used EXACTLY as stored — no path appended, no trailing slash trimmed. The trim
    // that used to live here is now part of the legacy branch in wire-format.js, which
    // is where it belongs: it was never a correction, it was a reproduction of what the
    // old code did to that user's saved value.
    const url = WireFormat.resolveEndpoint(cfg.baseUrl, e);
    if (!url) { const err = new Error('missing endpoint URL'); err.code = 'no_base'; throw err; }
    // 请求体由 RequestShape 一处构造（content/request-shape.js），与翻译/解析/转写同源。
    // 语音这条路的形状由地址后缀 /audio/speech 判定，与注册表 type 无关 —— 同一个自建
    // 服务可以同时提供多种形状，用哪种只有用户的地址说了算。
    const req = RequestShape.build(WireFormat.formatFor(url, e && e.type), {
      url, apiKey: cfg.apiKey,
      model: cfg.model || e.defaultModel,
      input: text,
      voice: cfg.voice || (e.voices && e.voices[0]) || 'alloy',
      format: cfg.format,
    });
    const init = { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) };
    // A self-hosted speech endpoint that omits `Access-Control-Allow-Origin` makes
    // WebKit kill the fetch before any status is visible — a bare TypeError ("Load
    // failed") that reads exactly like "host unreachable" (measured 2026-08-13,
    // learning-design §9.4). Named here for the same reason speech-input.js names it,
    // and carrying the URL so the settings page can echo what it actually requested.
    let resp;
    try {
      resp = await fetch(url, init);
    } catch (netErr) {
      const err = new Error(String((netErr && netErr.message) || netErr));
      err.code = 'network';
      err.url = url;
      throw err;
    }
    if (!resp.ok) {
      const err = new Error('speech ' + resp.status);
      err.status = resp.status;
      err.code = 'http';
      err.url = url;
      throw err;
    }
    // Bytes + declared type, never a Blob: Blobs round-tripped through WebKit's
    // IndexedDB are file-backed handles that dangle after an app update moves
    // the container (see LearnStore.putAudio). ArrayBuffers carry their bytes.
    const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
    return { buf: await resp.arrayBuffer(), type: String(ct).split(';')[0] || 'audio/mpeg' };
  }

  // Returns { buf, type, cached } — `cached` exists so a test can assert the SECOND
  // play issues no request at all, which is the whole point of the cache and is
  // invisible in the audio itself.
  async function getAudio(text, lang) {
    const key = cacheKey(text, lang);
    const hit = await LearnStore.getAudio(key);
    // Only byte-inline records count. A legacy record holds a Blob HANDLE that
    // may be a corpse (dangling after any app update) — refetch and replace it
    // rather than serve bytes nobody can read.
    if (hit && hit.buf && hit.buf.byteLength) {
      return { buf: hit.buf, type: hit.type || 'audio/mpeg', cached: true, key };
    }
    const got = await fetchAudio(text, lang);
    try { await LearnStore.putAudio(key, got, { lang, engineId: engine().id }); } catch (_) {}
    return { buf: got.buf, type: got.type, cached: false, key };
  }

  // Chunked to keep the argument list finite; a speech clip is ~100-500KB, so the
  // base64 copy is noise.
  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  // ─── Public: speak / stop ────────────────────────────────────────────────

  function stop() {
    epoch++;
    try {
      if (typeof speechSynthesis !== 'undefined') {
        if (speechSynthesis.speaking || speechSynthesis.pending) lastInterruptAt = Date.now();
        speechSynthesis.cancel();
      }
    } catch (_) {}
    if (current) {
      try { current.pause(); } catch (_) {}
      current = null;
    }
    if (currentDone) { const r = currentDone; currentDone = null; r(); }
  }

  // Resolves { ok: true, done } when playback STARTED, or { ok: false, reason }
  // when it could not — never a silent no-op. `reason` is a code the caller turns
  // into a localized line: 'no_voice' | 'unsupported' | 'no_base' | 'http' |
  // 'blocked'. `done` resolves when the playback FINISHES (ended, errored, or
  // interrupted by stop()) — the caller keeps its control disabled until then
  // (interaction-spec: IO 在途，控件不可用).
  // Resolves { ok: false, reason: 'superseded' } when another speak()/stop()
  // took over while this one was in flight — the caller should show NOTHING for
  // it (the newer call owns the UI).
  async function speak(text, lang) {
    stop();   // records the interrupt (if any) and bumps the epoch
    const myEpoch = epoch;
    const stale = () => epoch !== myEpoch;
    const clean = LearnModel.normText(text);
    if (!clean) return { ok: false, reason: 'empty' };
    const e = engine();
    if (!e) return { ok: false, reason: 'unsupported' };

    if (e.type === 'browser') {
      if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
        return { ok: false, reason: 'unsupported' };
      }
      const voices = await loadVoices();
      if (stale()) return { ok: false, reason: 'superseded' };
      const v = pickVoice(voices, lang, cfg.voice);
      if (!v) return { ok: false, reason: undLang(lang) ? 'no_voice_und' : 'no_voice' };
      // iOS silently drops a speak() issued right after a cancel() that
      // interrupted real speech — whether OUR stop() above did the interrupting
      // or a previous call's stop() did (card change). Give it a settle beat.
      const settleMs = cfg.settleMs != null ? cfg.settleMs : DEFAULTS.settleMs;
      const sinceInterrupt = Date.now() - lastInterruptAt;
      if (sinceInterrupt < settleMs) {
        await new Promise((r) => setTimeout(r, settleMs - sinceInterrupt));
        if (stale()) return { ok: false, reason: 'superseded' };
      }
      // A gesture-less speak() attempt (the autoplay on card entry) can leave
      // iOS's synthesizer wedged `paused` — everything queued after that waits
      // forever and `start` never fires, which is exactly a ▶ tap that stays
      // silent. resume() inside this (gesture-driven) call unsticks it, and is
      // a no-op on every other platform.
      try { speechSynthesis.resume(); } catch (_) {}
      const u = new SpeechSynthesisUtterance(clean);
      u.voice = v;
      u.lang = v.lang;
      u.rate = cfg.rate || 1;
      u.pitch = cfg.pitch || 1;
      // Wait for `start`, do NOT just check that speak() didn't throw.
      //
      // iOS silently IGNORES speak() when there was no user gesture: no exception,
      // no error event, no sound. Reporting success off a non-throwing call meant
      // claiming "playing…" while nothing came out — the single worst outcome for a
      // feature whose entire signal is audio the user may not be able to verify.
      // `start` is the only evidence that audio actually began.
      const started = await new Promise((resolve) => {
        let settled = false;
        const done = (v2) => { if (!settled) { settled = true; resolve(v2); } };
        try {
          u.addEventListener('start', () => done(true), { once: true });
          u.addEventListener('error', () => done(false), { once: true });
        } catch (_) { /* older impls: fall through to the timeout */ }
        try { speechSynthesis.speak(u); } catch (_) { done(false); }
        setTimeout(() => done(false), cfg.startTimeoutMs || DEFAULTS.startTimeoutMs);
      });
      if (!started) {
        // Only cancel if this call still owns the synthesizer. A stale timeout
        // firing cancel() would silence the NEXT card's live speech (observed:
        // "playing…" over silence — the worst outcome this module documents).
        if (stale()) return { ok: false, reason: 'superseded' };
        try { speechSynthesis.cancel(); } catch (_) {}
        return { ok: false, reason: 'blocked' };
      }
      const done = new Promise((resolve) => {
        currentDone = resolve;
        try {
          u.addEventListener('end', resolve, { once: true });
          u.addEventListener('error', resolve, { once: true });
        } catch (_) { resolve(); }
      });
      return { ok: true, engine: 'browser', voice: v.voiceURI, done };
    }

    let got;
    try {
      got = await getAudio(clean, lang);
    } catch (err) {
      return { ok: false, reason: err.code || 'http', status: err.status };
    }
    if (stale()) return { ok: false, reason: 'superseded' };
    // data: URL from the raw bytes — never URL.createObjectURL: blob-URL media
    // is refused by the app's WKWebView (NotSupportedError), and a Blob restored
    // from IndexedDB may be a dangling file handle anyway. Inline base64 decodes
    // in every host we ship to.
    const url = 'data:' + (got.type || 'audio/mpeg') + ';base64,' + bufToBase64(got.buf);
    const audio = new Audio(url);
    audio.playbackRate = cfg.rate || 1;
    current = audio;
    let doneResolve;
    const done = new Promise((resolve) => { doneResolve = resolve; });
    audio.addEventListener('ended', () => {
      if (current === audio) current = null;
      doneResolve();
    }, { once: true });
    audio.addEventListener('error', () => doneResolve(), { once: true });
    try {
      await audio.play();
    } catch (err) {
      // Autoplay policy, almost always. The caller keeps a visible ▶ button, so a
      // blocked autoplay is recoverable rather than a dead end.
      // DBG-TEMP: name the real rejection + what we tried to play
      return { ok: false, reason: 'blocked', cached: got.cached,
        detail: String(err && err.name) + ' ' + String(err && err.message).slice(0, 100)
          + ' | ' + (got.type || '?') + ' ' + (got.buf ? got.buf.byteLength : 0) + 'B'
          + (got.cached ? ' cached' : ' fresh') };
    }
    currentDone = doneResolve;
    return { ok: true, engine: e.id, cached: got.cached, done };
  }

  // Is speech usable at all right now, without trying to play anything? Used to
  // decide whether to render the ▶ control — an engine that cannot possibly work
  // should not present a button that always fails.
  async function available(lang, waitMs) {
    const e = engine();
    if (!e) return { ok: false, reason: 'unsupported' };
    if (e.type === 'browser') {
      if (typeof speechSynthesis === 'undefined') return { ok: false, reason: 'unsupported' };
      const voices = await loadVoices(waitMs);
      if (!voices.length) return { ok: false, reason: 'unsupported' };
      if (!pickVoice(voices, lang, cfg.voice)) {
        return { ok: false, reason: undLang(lang) ? 'no_voice_und' : 'no_voice' };
      }
      return { ok: true };
    }
    if (e.requiresEndpoint && !cfg.baseUrl) return { ok: false, reason: 'no_base' };
    if (e.needsKey && !cfg.apiKey) return { ok: false, reason: 'no_key' };
    return { ok: true };
  }

  return {
    DEFAULTS,
    configure, engines, engineById, engine,
    loadVoices, onVoicesChanged, pickVoice, baseLang, undLang, cacheKey,
    getAudio, speak, stop, available,
    get config() { return cfg; },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnTTS;
