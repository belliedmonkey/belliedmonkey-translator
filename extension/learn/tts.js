// learn/tts.js — speech synthesis for the learning layer (记忆层).
// Engine registry: build/tts.config.js → content/tts.gen.js (window.MT_TTS_ENGINES).
// Interaction rules: docs/interaction-spec.md 「复习 / Review」→ 语音.
//
// Two engine formats, and the difference between them is load-bearing:
//
//   'browser'        the platform's own speechSynthesis. Free, offline, zero config —
//                    but **no longer the default** (2026-09-04, 用户裁定): 语音是这个
//                    产品的核心体验，而系统自带的效果撑不起它，没人应该在没做过选择的
//                    情况下听到它。保留为**显式可选**（AGENTS.md 原则 2：不付费不登录
//                    的人也要有完整产品 —— 免费这条路不许被砍，只是不再默认走）。
//                    It only *speaks* — the Web Speech API exposes
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
    // '' = **未配置**，与 sttEngine 同一套语义（不发明第二种空值）。
    // 语音要用户填了引擎/端点才有 —— 见文件头。
    engineId: '',
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
  // **没有回落。** 曾经这里是 `|| engineById('browser')`，那让「未配置」静默变成
  // 「用系统语音」—— 正是 2026-09-04 要根除的行为。未配置就返回 null，由 available()
  // 说出原因、由界面给出去配置的路。
  function engine() { return engineById(cfg.engineId) || null; }

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
  // 语言未知时，用**文本的主导脚本**猜一个。
  //
  // 为什么非猜不可：Safari 上没有 chrome.i18n.detectLanguage（domain-design §5.3），
  // 所以在 Safari 里采集的每一张卡的 lang 都是 'und' —— 也就是 iOS 上的**全部**素材。
  // 而原来的规则是「und 且没显式选过音色 ⇒ 返回 null」，于是播客模式在 iOS 上
  // 一张都播不了：4 张卡、4 张跳过、一轮瞬间结束（2026-09-02 真机实测）。
  //
  // 脚本比盲选默认音色准得多：日文假名、汉字、谚文、西里尔、阿拉伯…… 各自只对应
  // 一门主要语言。拉丁字母是唯一真正含糊的一支，那里退回 en —— 我们的用户读的外文
  // 绝大多数是英文，而「英文文本用英文音色念」即使猜错也仍然读得出来。
  // 「日文卡用英文音色念比不念更糟」那条判断仍然成立：它针对的是**已知**的语言，
  // 这里处理的是未知。
  const SCRIPT_VOICE = { Kana: 'ja', Han: 'zh', Hangul: 'ko', Cyrillic: 'ru',
    Arabic: 'ar', Devanagari: 'hi', Thai: 'th', Greek: 'el', Hebrew: 'he', Latin: 'en' };
  function scriptLang(text) {
    if (typeof LearnRules === 'undefined' || !LearnRules.dominantScript) return '';
    try { return SCRIPT_VOICE[LearnRules.dominantScript(text)] || ''; } catch (_) { return ''; }
  }

  function pickVoice(voices, lang, preferredURI, text) {
    let want = baseLang(lang);
    if ((!want || want === 'und') && text) {
      // 显式选过的音色仍然最优先 —— 它是用户的决定，不是我们的推断。
      const pref0 = voices.find((v) => v.voiceURI === preferredURI);
      if (pref0) return pref0;
      want = scriptLang(text);
    }
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

  // 声明的 Content-Type **不可信**，实测：deepgram/aura-2 回
  // `audio/pcm;rate=24000;channels=1`，而 body 的头四个字节是 `RIFF` —— 那是一个
  // 完整的 WAV 容器。照声明存进 IndexedDB，播放时会拼出 `data:audio/pcm;base64,…`，
  // 浏览器不认这个类型，于是**一声不响地不出声**：请求成功、缓存写入成功、播放
  // 静默失败，一路上没有任何地方会报错。
  //
  // 所以嗅探优先：认出容器就用容器的类型，认不出才回落到声明值。
  // 反过来不做（不用声明值覆盖嗅探结果）—— 我们能看见的字节比服务器说的话可靠。
  function sniffAudioType(bytes, declared) {
    const b = new Uint8Array(bytes);
    const tag = (n) => String.fromCharCode.apply(null, Array.prototype.slice.call(b, 0, n));
    if (b.length >= 4) {
      const four = tag(4);
      if (four === 'RIFF') return 'audio/wav';
      if (four === 'OggS') return 'audio/ogg';
      if (four === 'fLaC') return 'audio/flac';
      if (four.slice(0, 3) === 'ID3') return 'audio/mpeg';
      if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';   // 裸 MP3 帧头
    }
    return String(declared || '').split(';')[0] || 'audio/mpeg';
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
    // BOUNDED, like the other three transports (translation-api.js:191 does the same
    // with the same budget). This one was unbounded until 2026-08-23, and a real iPhone
    // showed what that costs: two clips of a 20-card 出发前预载 never settled, the
    // counter froze at 18/20 forever, and 停止 went grey WITHOUT stopping — the workers
    // were parked inside a fetch that could never return, so they never reached the
    // next `shouldStop()`. A hung request has no reporter; it just looks like the
    // feature is slow. §9.5's 「⏸ 停止 在任何时候都可用」 cannot hold on top of an
    // unbounded await, so the bound belongs HERE rather than in the caller.
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const budget = (typeof RequestShape !== 'undefined' && RequestShape.timeoutMs)
      ? RequestShape.timeoutMs() : 20000;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), budget) : null;
    if (ctrl) init.signal = ctrl.signal;
    let resp;
    try {
      resp = await fetch(url, init);
    } catch (netErr) {
      const aborted = !!(ctrl && ctrl.signal && ctrl.signal.aborted);
      const err = new Error(aborted
        ? ('speech request exceeded ' + budget + 'ms')
        : String((netErr && netErr.message) || netErr));
      // Distinct from `network`: "it never answered" and "it refused the connection"
      // are different faults, and the preload tally prints the raw code.
      err.code = aborted ? 'timeout' : 'network';
      err.url = url;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
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
    // 有的形状把音频拆在一条 SSE 流里（带音频输出的对话模型）。整段读完再拆 ——
    // 上层要的是完整字节（缓存、离线预载），边收边播只会把两件事搅在一起。
    if (req.parseAudioStream) {
      const got = req.parseAudioStream(await resp.text());
      return { buf: got.buf, type: got.type };
    }

    // 有的形状回的是一个音频 URL 而不是字节（DashScope）。多取一次 —— 这一步放在
    // 这里而不是调用方，是为了让「拿到 { buf, type }」对上层始终是同一件事：缓存、
    // 预载、data: URL 播放那一整条路一个字都不用改。
    if (req.audioUrlFrom) {
      let mediaUrl = '';
      try { mediaUrl = req.audioUrlFrom(JSON.parse(await resp.text())); } catch (_) { mediaUrl = ''; }
      if (!mediaUrl) {
        const err = new Error('speech response carried no audio URL');
        err.code = 'empty_audio'; err.url = url;
        throw err;
      }
      // 同样有截止时间：一个取不回来的音频与一个挂住的请求，对预载是同一种伤害。
      const c2 = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t2 = c2 ? setTimeout(() => c2.abort(), budget) : null;
      let media;
      try {
        media = await fetch(mediaUrl, c2 ? { signal: c2.signal } : undefined);
      } catch (netErr) {
        const err = new Error('cannot fetch the generated audio');
        err.code = (c2 && c2.signal && c2.signal.aborted) ? 'timeout' : 'network';
        err.url = mediaUrl;
        throw err;
      } finally { if (t2) clearTimeout(t2); }
      if (!media.ok) {
        const err = new Error('audio ' + media.status);
        err.status = media.status; err.code = 'http'; err.url = mediaUrl;
        throw err;
      }
      const mct = (media.headers && media.headers.get && media.headers.get('content-type')) || '';
      const mbuf = await media.arrayBuffer();
      return { buf: mbuf, type: sniffAudioType(mbuf, mct) };
    }
    const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
    const abuf = await resp.arrayBuffer();
    return { buf: abuf, type: sniffAudioType(abuf, ct) };
  }

  // Returns { buf, type, cached } — `cached` exists so a test can assert the SECOND
  // play issues no request at all, which is the whole point of the cache and is
  // invisible in the audio itself.
  //
  // In-flight de-duplication by cache key, and it is NOT an optimisation. §9.5 warms a
  // card's segments in parallel at card open while the player walks the same segments
  // a moment later; without this the two paths each miss the (still empty) cache and
  // the user pays twice for one clip, which makes the warm-up worse than useless.
  // Same discipline as notes.js's `inflight` map, keyed by cache key rather than card
  // id because audio is keyed by engine+voice+text, not by card.
  const inflight = new Map();

  function getAudio(text, lang) {
    const key = cacheKey(text, lang);
    const live = inflight.get(key);
    if (live) return live;
    const p = (async () => {
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
    })();
    inflight.set(key, p);
    // Settle either way before dropping the entry, so a failure is retried next time
    // instead of being remembered as a permanent one.
    p.then(() => inflight.delete(key), () => inflight.delete(key));
    return p;
  }

  // Is an endpoint engine configured well enough to be asked for bytes? One helper so
  // `available()` (renders the ▶ control) and `prefetch()` (fills the cache) can never
  // disagree about what "configured" means.
  function readiness(e) {
    if (e.requiresEndpoint && !cfg.baseUrl) return { ok: false, reason: 'no_base' };
    if (e.needsKey && !cfg.apiKey) return { ok: false, reason: 'no_key' };
    return { ok: true };
  }

  // 连通性自检：合成一次，**不播放、不入缓存**。
  //
  // 「配好了吗」与「这台设备放得出声吗」是两个问题。设置页那个「试听一句」回答后者
  // （走 speak()，会撞上自动播放策略、编解码、系统音量），把两者混在一起测，一次被
  // 浏览器拦下的自动播放会显示成「你的 key 不对」。
  //
  // 走 fetchAudio 而不是 getAudio 是刻意的：绕开 LearnStore / LearnModel，于是这个
  // 函数在**只加载了 wire-format + request-shape 的页面**上也能跑 —— 扩展的引导页
  // 正是那种页面，而让引导页测得比设置页少，就是我们自己造的一个沉默失败。
  //
  // 不入缓存也是刻意的：这句测试文本和任何一张卡的正文都不同，缓存它只占空间。
  async function test() {
    const e = engine();
    if (!e) { const err = new Error('no engine'); err.code = 'no_engine'; throw err; }
    // browser 引擎没有字节可取（Web Speech 不暴露音频数据）。一键配置永远选不到它
    // （needsKey:false ⇒ 不成组），但别给未来的调用方留一个会抛的分支。
    if (!e.returnsAudio) return { ok: true, ms: 0, browser: true };
    const gate = readiness(e);
    if (!gate.ok) { const err = new Error(gate.reason); err.code = gate.reason; throw err; }
    const t0 = Date.now();
    const got = await fetchAudio('This is a connectivity check.', 'en');
    const bytes = got && got.buf ? got.buf.byteLength : 0;
    if (!bytes) { const err = new Error('empty_audio'); err.code = 'empty_audio'; throw err; }
    return { ok: true, ms: Date.now() - t0, bytes };
  }

  // Synthesize into the cache WITHOUT playing (§9.5: 开卡并行预热 / 出发前预载).
  //
  // Deliberately not "speak but muted": speak() bumps the epoch and would cancel the
  // utterance actually playing. This only fills the cache, so it is safe to fire while
  // audio is running, and safe to fire many at once.
  //
  // A `browser` engine has no bytes to cache — the Web Speech API exposes no audio
  // data (§9.1), which is a property of the API, not a gap. Saying so by name matters:
  // the preload surface has to tell the user it produces no audio cache rather than
  // show a progress bar that can never move. No request is issued in that case.
  async function prefetch(text, lang) {
    const clean = LearnModel.normText(text);
    if (!clean) return { ok: false, reason: 'empty' };
    const e = engine();
    if (!e) return { ok: false, reason: 'unsupported' };
    if (!e.returnsAudio) return { ok: false, reason: 'not_cacheable' };
    const gate = readiness(e);
    if (!gate.ok) return gate;
    try {
      const got = await getAudio(clean, lang);
      return { ok: true, engine: e.id, cached: got.cached, bytes: got.buf ? got.buf.byteLength : 0 };
    } catch (err) {
      return { ok: false, reason: (err && err.code) || 'http', status: err && err.status };
    }
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
    // 与 available() 同一条口径：「没配过」有出路，「这平台做不到」没有。
    // 试听按钮读的是 speak() 的 reason，所以这里少分一次，界面就少说一句人话。
    if (!cfg.engineId) return { ok: false, reason: 'not_configured' };
    const e = engine();
    if (!e) return { ok: false, reason: 'unsupported' };

    if (e.type === 'browser') {
      if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
        return { ok: false, reason: 'unsupported' };
      }
      const voices = await loadVoices();
      if (stale()) return { ok: false, reason: 'superseded' };
      const v = pickVoice(voices, lang, cfg.voice, clean);
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
      //
      // `detail` 是**给控制台的**，不是给界面的。它一度被 review.js 原样渲染到手机上
      // （见那边的注释）。留着它有价值 —— 「blocked」这个码本身分不出是自动播放策略
      // 还是解码失败 —— 但消费者必须自己决定放哪儿，这里只负责把事实说全。
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
  // text 可选：给了它，语言未知时就能按脚本挑音色（见 pickVoice）。
  // 不给的话行为与从前逐字相同 —— 调用方问的是「这个已知语言能不能读」。
  async function available(lang, waitMs, text) {
    // 「没配过」与「这个平台做不到」是两件事：前者的出路是去设置页，后者没有出路。
    // 合成一个 reason 会让界面只能说一句帮不上忙的话。
    if (!cfg.engineId) return { ok: false, reason: 'not_configured' };
    const e = engine();
    if (!e) return { ok: false, reason: 'unsupported' };
    if (e.type === 'browser') {
      if (typeof speechSynthesis === 'undefined') return { ok: false, reason: 'unsupported' };
      const voices = await loadVoices(waitMs);
      if (!voices.length) return { ok: false, reason: 'unsupported' };
      if (!pickVoice(voices, lang, cfg.voice, text)) {
        return { ok: false, reason: undLang(lang) ? 'no_voice_und' : 'no_voice' };
      }
      return { ok: true };
    }
    return readiness(e);
  }

  // ─── reason → 人话 ────────────────────────────────────────────────────────
  // 这张表此前有**三份**：review.js（完整）、options.js（缺 not_configured）、
  // 而 App 的试听按钮**一份都没有**，直接把 `not_configured` 这种机器码印在屏幕上。
  // 同一次失败在三个面上说三种话，其中一种还不是话。
  //
  // 放在这里而不是某个 UI 文件里：reason 是这个模块产的，谁产它谁说它是什么意思
  // （`EngineTest.reason` 已经是这个形状）。`t` 由调用方传入 —— 这个文件在扩展页、
  // 宿主 App 两个宿主里跑，i18n 的取法不一样，而文案的**内容**必须一样。
  function reason(code, t) {
    switch (code) {
      case 'no_voice': return t('tts_no_voice', '系统里没有这门语言的语音');
      case 'no_voice_und': return t('tts_no_voice_und', '这张卡的语言未知 —— 在设置里选一个朗读语音后即可朗读');
      // 「没配过」与「这平台做不到」分开说 —— 前者有出路，后者没有。
      case 'not_configured': return t('tts_not_configured', '还没配语音引擎 —— 到「设置 › 语音」里选一个');
      case 'unsupported': return t('tts_unsupported', '这个浏览器不提供内置语音');
      case 'no_base': return t('tts_no_base', '还没填语音端点地址');
      case 'no_key': return t('tts_no_key', '还没填语音 API Key');
      case 'blocked': return t('tts_blocked', '浏览器拦下了自动播放，点一下播放');
      case 'http': return t('tts_http', '语音服务返回了错误');
      // 这三条是 1.6.5 加的失败码，此前一直落到下面那句「暂时读不出来」。
      // 补上不是锦上添花：删掉屏幕上的原始异常之后，不具名它们等于把这些失败
      // 变得比清理前更没信息 —— 那是把清理做成回归。
      case 'timeout': return t('tts_timeout', '语音服务超时了 —— 检查网络，或换一个语音端点');
      case 'network': return t('tts_network', '连不上语音服务 —— 检查网络和端点地址');
      case 'empty': return t('tts_empty', '这张卡没有可朗读的文字');
      default: return t('tts_failed', '这句暂时读不出来');
    }
  }

  return {
    DEFAULTS, sniffAudioType,
    configure, engines, engineById, engine,
    loadVoices, onVoicesChanged, pickVoice, scriptLang, baseLang, undLang, cacheKey,
    getAudio, prefetch, speak, stop, available, test, reason,
    get config() { return cfg; },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnTTS;
