// test/learn-tts.test.js — speech synthesis for the learning layer.
//
// The two things that matter most here are both invisible in the audio:
//   · a voice that does not speak the card's language must be REFUSED, with a
//     reason — silently reading a Japanese sentence in an English voice is worse
//     than not playing at all;
//   · the second play of a sentence must issue NO network request, because
//     synthesis costs the user money. Only a call count can see that.

const { loadModule, describe, test, ok, eq } = require('./harness');

const REGISTRY = require('../build/tts.config.js');
const WireFormat = require('../extension/content/wire-format.js');

function voice(name, lang, extra) {
  return Object.assign({ name, lang, voiceURI: name + '|' + lang, default: false }, extra || {});
}

// Minimal fakes: the module only ever calls store.getAudio / store.putAudio, and
// fetch. Both record calls so the negative assertions have something to look at.
function setup(opts = {}) {
  const calls = { fetch: [], put: [], get: [] };
  const cache = new Map();
  const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;

  const fetchStub = (url, init) => {
    calls.fetch.push({ url, init });
    if (opts.fetchImpl) return opts.fetchImpl(url, init);
    // A REJECTION, not a status: WebKit's CORS rejection never produces a status at
    // all, and that difference is exactly what the `network` naming exists to capture.
    if (opts.fetchThrows) return Promise.reject(new TypeError('Load failed'));
    if (opts.fetchStatus && opts.fetchStatus !== 200) {
      return Promise.resolve({ ok: false, status: opts.fetchStatus });
    }
    // Bytes + content type — the shape the module now stores. A Blob would be a
    // regression: WebKit dangles IndexedDB blob handles across app updates.
    return Promise.resolve({ ok: true, status: 200,
      headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
      arrayBuffer: () => Promise.resolve(new Uint8Array([73, 68, 51, 4]).buffer) });
  };

  const LearnStore = {
    getAudio: (k) => { calls.get.push(k); return Promise.resolve(cache.get(k) || null); },
    putAudio: (k, payload, meta) => {
      calls.put.push({ k, payload, meta });
      cache.set(k, { buf: payload.buf, type: payload.type });
      return Promise.resolve();
    },
  };

  const ctx = loadModule(['content/request-shape.js', 'learn/tts.js'], {
    window: { MT_TTS_ENGINES: REGISTRY.map((e) => Object.assign({}, e)) },
    LearnModel, LearnStore, WireFormat,
    // The vm sandbox inherits no globals, so the abort path only exists here if it is
    // handed in — and without it the timeout test would silently exercise nothing.
    AbortController,
    fetch: fetchStub,
    speechSynthesis: opts.speechSynthesis,
    SpeechSynthesisUtterance: opts.SpeechSynthesisUtterance,
    Uint8Array, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Audio: opts.Audio,
  });
  // The shipped budget is 20s; a unit test must not sit through it. Patched AFTER load
  // because tts.js reads RequestShape.timeoutMs() at CALL time, not at load time.
  if (opts.timeoutMs) ctx.RequestShape.timeoutMs = () => opts.timeoutMs;
  return { TTS: ctx.LearnTTS, calls, cache, LearnModel };
}

// `late` models the real platform behaviour: getVoices() is empty at first and the
// list only shows up when `voiceschanged` fires. Call `.arrive()` to simulate that.
function fakeSpeech(voices, late, silent) {
  const spoken = [];
  const listeners = [];
  let current = late ? [] : voices;
  return {
    spoken,
    arrive() {
      current = voices;
      for (const [type, fn] of listeners.slice()) if (type === 'voiceschanged') fn();
    },
    api: {
      getVoices: () => current,
      // A real platform dispatches `start` when audio actually begins; `silent`
      // models iOS ignoring speak() without a user gesture (no throw, no error,
      // no sound) — the case that used to be reported as success.
      speak: (u) => { spoken.push(u); if (!silent && u.__on && u.__on.start) u.__on.start(); },
      cancel() {},
      addEventListener: (type, fn) => listeners.push([type, fn]),
    },
    Utterance: function (text) {
      this.text = text;
      this.__on = {};
      this.addEventListener = (type, fn) => { this.__on[type] = fn; };
    },
  };
}

describe('LearnTTS — engine registry', () => {
  test('engines come from the build-time registry, not a hardcoded list', () => {
    const { TTS } = setup();
    eq(TTS.engines().length, REGISTRY.length);
    eq(TTS.engines()[0].id, REGISTRY[0].id);
  });

  test('the default engine is the on-device one, and it is listed first (本地优先)', () => {
    const { TTS } = setup();
    eq(TTS.DEFAULTS.engineId, 'browser');
    eq(REGISTRY[0].id, 'browser', 'the zero-config offline engine must lead the list');
    eq(REGISTRY[0].type, 'browser');
  });

  test('the browser engine can NEVER return audio — that is an API fact, not a setting', () => {
    const browser = REGISTRY.find((e) => e.id === 'browser');
    eq(browser.returnsAudio, false);
    // 其余每个引擎都必须说一种**我们真的实现了**的语音形状，而且它必须落在语音
    // 家族里 —— 后者才是关键：DashScope 的朗读与转写是同一个 URL，只有家族能分开
    // 它们。原先这里钉的是 `type === 'speech-compat'`，那在只有一种形状时成立；
    // 现在钉「实现了 + 同家族」，既挡住乱写的 type，也不会在加第三种形状时假红。
    const WF = require('../extension/content/wire-format.js');
    const SPEECH_FORMATS = ['speech-compat', 'speech-dashscope', 'speech-audio-chat'];
    for (const e of REGISTRY.filter((x) => x.id !== 'browser')) {
      ok(SPEECH_FORMATS.includes(e.type), `${e.id} 的 type ${e.type} 不是已实现的语音形状`);
      // 家族封闭：拿它自己的默认端点去判，结果必须仍在语音形状集合里。
      const fmt = WF.formatFor(e.defaultEndpoint || 'https://x.example/v1/audio/speech', e.type);
      ok(SPEECH_FORMATS.includes(fmt),
        `${e.id} 的端点被判成了 ${fmt} —— 语音引擎绝不该跑到别的家族去`);
      eq(e.returnsAudio, true);
    }
  });

  test('an unknown engine id falls back to the on-device engine rather than breaking', () => {
    const { TTS } = setup();
    TTS.configure({ engineId: 'nope' });
    eq(TTS.engine().id, 'browser');
  });
});

describe('LearnTTS — voice selection is language-aware', () => {
  const voices = [
    voice('Alex', 'en-US', { default: true }),
    voice('Samantha', 'en-GB'),
    voice('Kyoko', 'ja-JP'),
  ];

  test("the user's chosen voice wins WHEN it speaks the card's language", () => {
    const { TTS } = setup();
    eq(TTS.pickVoice(voices, 'en', 'Samantha|en-GB').name, 'Samantha');
  });

  test("…and is IGNORED when it does not — a Japanese card is never read in English", () => {
    const { TTS } = setup();
    eq(TTS.pickVoice(voices, 'ja', 'Samantha|en-GB').name, 'Kyoko');
  });

  test('with no preference, a default-flagged voice for that language is preferred', () => {
    const { TTS } = setup();
    eq(TTS.pickVoice(voices, 'en', '').name, 'Alex');
  });

  test('no voice for the language → null, so the caller can SAY why', () => {
    const { TTS } = setup();
    eq(TTS.pickVoice(voices, 'ko', ''), null);
    eq(TTS.pickVoice([], 'en', ''), null);
  });

  test('region subtags do not prevent a match (en vs en-GB vs en_US)', () => {
    const { TTS } = setup();
    eq(TTS.baseLang('en_US'), 'en');
    eq(TTS.baseLang('zh-Hans-CN'), 'zh');
    ok(TTS.pickVoice(voices, 'en-AU', '') !== null);
  });

  test("an undetected language ('und') falls back rather than refusing outright", () => {
    const { TTS } = setup();
    eq(TTS.pickVoice(voices, 'und', 'Kyoko|ja-JP').name, 'Kyoko');
  });
});

describe('LearnTTS — availability is checked BEFORE offering a button', () => {
  test('missing base URL on a self-hosted engine reports no_base', async () => {
    const { TTS } = setup();
    TTS.configure({ engineId: 'local', baseUrl: '' });
    eq((await TTS.available('en')).reason, 'no_base');
  });

  test('missing key on a keyed engine reports no_key', async () => {
    const { TTS } = setup();
    TTS.configure({ engineId: 'openai_speech', apiKey: '' });
    eq((await TTS.available('en')).reason, 'no_key');
  });

  test('no platform speech at all reports unsupported, never a silent false', async () => {
    const { TTS } = setup();               // no speechSynthesis in the sandbox
    TTS.configure({ engineId: 'browser' });
    const r = await TTS.available('en');
    eq(r.ok, false);
    eq(r.reason, 'unsupported');
  });

  test('a language the system cannot speak reports no_voice', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    eq((await TTS.available('ja')).reason, 'no_voice');
    eq((await TTS.available('en')).ok, true);
  });

  // 'und' is every Safari-captured card (no detector there — domain-design §5.3),
  // which on the phone means MOST cards. The reason code must be distinct: the
  // no_voice wording ("no voice for this language") sends the user hunting iOS
  // settings for an English voice their phone obviously has, when the actual fix
  // is one tap away in OUR settings.
  test('an unknown-language card without a chosen voice reports no_voice_und, not no_voice', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US'), voice('Kyoko', 'ja-JP')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    eq((await TTS.available('und')).reason, 'no_voice_und', 'und 卡要指路到语音设置');
    eq((await TTS.available('')).reason, 'no_voice_und', '空 lang 与 und 同类');
    // speak() has its own copy of this decision (available() is advisory; speak()
    // is what the ▶ tap actually runs) — a mutant that broke only speak()'s
    // reason survived the available()-only assertions.
    const r = await TTS.speak('Hello there', 'und');
    eq(r.ok, false);
    eq(r.reason, 'no_voice_und', 'speak 的 und 报错也要指路，不许退回 no_voice');
  });

  test('an unknown-language card WITH a chosen voice plays with it', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US'), voice('Kyoko', 'ja-JP')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', voice: 'Alex|en-US' });
    eq((await TTS.available('und')).ok, true, '选了语音的 und 卡必须可播');
    const r = await TTS.speak('Hello there', 'und');
    eq(r.ok, true);
    eq(sp.spoken[0].voice.name, 'Alex', 'und 卡用的是用户选的那个语音');
  });
});

describe('LearnTTS — speak (browser engine)', () => {
  test('speaks with a voice matching the card language', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US'), voice('Kyoko', 'ja-JP')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', rate: 1.15 });
    const r = await TTS.speak('Hello there', 'en');
    eq(r.ok, true);
    eq(sp.spoken.length, 1);
    eq(sp.spoken[0].voice.name, 'Alex');
    eq(sp.spoken[0].rate, 1.15);
  });

  test('refuses rather than speaking the wrong language, and says why', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    const r = await TTS.speak('こんにちは', 'ja');
    eq(r.ok, false);
    eq(r.reason, 'no_voice');
    eq(sp.spoken.length, 0, 'nothing may be spoken when no voice matches');
  });

  test('empty text is never spoken', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    eq((await TTS.speak('   ', 'en')).ok, false);
    eq(sp.spoken.length, 0);
  });
});

describe('LearnTTS — cache key', () => {
  test('is stable for the same text + engine + voice + language', () => {
    const a = setup(); a.TTS.configure({ engineId: 'local', model: 'm', voice: 'v' });
    const b = setup(); b.TTS.configure({ engineId: 'local', model: 'm', voice: 'v' });
    eq(a.TTS.cacheKey('Hello world', 'en'), b.TTS.cacheKey('Hello   world', 'en'));
  });

  test('changes when anything that changes the AUDIO changes', () => {
    const { TTS } = setup();
    TTS.configure({ engineId: 'local', model: 'm1', voice: 'v1' });
    const base = TTS.cacheKey('Hello', 'en');
    TTS.configure({ engineId: 'local', model: 'm2', voice: 'v1' });
    ok(TTS.cacheKey('Hello', 'en') !== base, 'model must affect the key');
    TTS.configure({ engineId: 'local', model: 'm1', voice: 'v2' });
    ok(TTS.cacheKey('Hello', 'en') !== base, 'voice must affect the key');
    TTS.configure({ engineId: 'openai_speech', model: 'm1', voice: 'v1' });
    ok(TTS.cacheKey('Hello', 'en') !== base, 'engine must affect the key');
    TTS.configure({ engineId: 'local', model: 'm1', voice: 'v1' });
    ok(TTS.cacheKey('Hello', 'ja') !== base, 'language must affect the key');
    ok(TTS.cacheKey('Goodbye', 'en') !== base, 'text must affect the key');
  });
});

describe('LearnTTS — speech-compat transport & cache', () => {
  const cfg = { engineId: 'local', baseUrl: 'http://127.0.0.1:8880/v1/audio/speech', model: 'kokoro', voice: 'af' };

  test('request goes to the registry path with the registry-shaped body', async () => {
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    await TTS.getAudio('Hello world', 'en');
    eq(calls.fetch.length, 1);
    // The address is what the user stored — VERBATIM, with nothing appended. It is a
    // literal here on purpose: the point of the assertion is that no registry value
    // reaches the URL at all any more, so deriving the expectation from the registry
    // would defeat it. (The old form was `base + local.path`; `path` no longer exists.)
    eq(calls.fetch[0].url, 'http://127.0.0.1:8880/v1/audio/speech');
    const body = JSON.parse(calls.fetch[0].init.body);
    eq(body.model, 'kokoro');
    eq(body.voice, 'af');
    eq(body.input, 'Hello world');
  });

  test('尾斜杠原样保留 —— 我们既不补路径，也不替用户裁字符', async () => {
    // 这条以前叫「尾斜杠不会拼出双斜杠」，因为当年我们真的会拼。现在没有可拼的东西了，
    // 剩下的唯一问题是我们会不会自作主张去改用户敲进去的字符 —— 答案必须是不会。
    const { TTS, calls } = setup();
    TTS.configure(Object.assign({}, cfg, { baseUrl: 'http://127.0.0.1:8880/v1/audio/speech/' }));
    await TTS.getAudio('Hi there', 'en');
    eq(calls.fetch[0].url, 'http://127.0.0.1:8880/v1/audio/speech/');
  });

  // Same story as speech-input.js #130 and notes.js: a self-hosted speech server that
  // omits CORS headers makes WebKit throw a bare TypeError before any status exists,
  // which reads exactly like an unreachable host. Named here so the settings page can
  // name the two fixable causes, and carrying the URL so it can show which address.
  test('a bare fetch rejection is named `network` and carries the URL', async () => {
    const { TTS } = setup({ fetchThrows: true });
    TTS.configure(cfg);
    let e = null;
    try { await TTS.getAudio('Hello world', 'en'); } catch (err) { e = err; }
    eq(e && e.code, 'network');
    eq(e && e.url, 'http://127.0.0.1:8880/v1/audio/speech');
  });

  test('no Authorization header when the engine needs no key', async () => {
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    await TTS.getAudio('Hello world', 'en');
    eq('Authorization' in calls.fetch[0].init.headers, false);
  });

  test('THE SECOND PLAY ISSUES NO REQUEST — this is the whole point of the cache', async () => {
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    const first = await TTS.getAudio('Hello world', 'en');
    eq(first.cached, false);
    eq(calls.fetch.length, 1);

    const second = await TTS.getAudio('Hello world', 'en');
    eq(second.cached, true);
    eq(calls.fetch.length, 1, 'a cache hit must cost the user nothing');
    eq(calls.put.length, 1, 'and must not rewrite the cache either');
  });

  // §9.5 开卡并行预热. Three things have to hold or the warm-up is worse than nothing:
  // it must fill the SAME cache entry the player will look for, it must not fire at
  // all on an engine that produces no bytes, and it must SHARE the request with a
  // speak that overlaps it — otherwise the user pays twice for one clip.
  test('prefetch fills the cache, and the play that follows issues no request', async () => {
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    const r = await TTS.prefetch('Hello world', 'en');
    eq(r.ok, true);
    eq(r.cached, false);
    eq(calls.fetch.length, 1);

    const played = await TTS.getAudio('Hello world', 'en');
    eq(played.cached, true, '预热填的必须是播放要找的那个键');
    eq(calls.fetch.length, 1, '预热之后再播放，一个请求都不该有');
  });

  test('prefetch on the on-device engine is not_cacheable AND issues no request', async () => {
    // The Web Speech API exposes no audio data (§9.1) — that is a property of the
    // API. Saying so by name is what lets the preload surface tell the user it
    // produces no audio cache, instead of showing a bar that can never move.
    const { TTS, calls } = setup();
    TTS.configure({ engineId: 'browser' });
    const r = await TTS.prefetch('Hello world', 'en');
    eq(r.ok, false);
    eq(r.reason, 'not_cacheable');
    eq(calls.fetch.length, 0, '不产生缓存的引擎绝不能因为预热而发请求');
  });

  test('a speak overlapping an in-flight prefetch shares it — one request, not two', async () => {
    // This is the load-bearing one. Warm-up and playback race by construction: the
    // player opens a card and starts the first segment in the same tick the warm-up
    // fires. Without in-flight de-duplication both miss the (still empty) cache and
    // the warm-up turns into a second bill.
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    const warm = TTS.prefetch('Hello world', 'en');
    const play = TTS.getAudio('Hello world', 'en');
    await Promise.all([warm, play]);
    eq(calls.fetch.length, 1, '并发的预热与播放必须共用同一个请求');
    eq(calls.put.length, 1, '也只写一次缓存');
  });

  // 2026-08-23, iPhone 15 Pro 实证。这条 fetch 从前是**无界**的：出发前预载跑到 18/20
  // 就再也不动，「停止」按下去变灰却停不下来 —— 工人卡在一个永远不会 settle 的 await
  // 里，根本走不到下一次 shouldStop()。挂起的请求没有报告人，看起来只是「有点慢」。
  test('一个永不回应的端点在预算用尽时被中止，而不是永远挂着', async () => {
    let abortedWith = null;
    const { TTS } = setup({ timeoutMs: 40, fetchImpl: (url, init) => new Promise((_, reject) => {
      // 永不 resolve —— 只有 AbortController 能把它结束掉。
      if (init && init.signal) {
        init.signal.addEventListener('abort', () => {
          abortedWith = 'abort';
          const e = new Error('The operation was aborted.');
          e.name = 'AbortError';
          reject(e);
        });
      }
    }) });
    TTS.configure(cfg);
    // 自带看门狗：少了它，这条用例在回归时的表现是**挂住**而不是变红，而仓库自己的判词
    // 是「a check that hangs is indistinguishable from one that is still working」
    // （verification-spec §3.1.2 的 idb 检查器踩过同一个坑）。
    const r = await Promise.race([
      TTS.prefetch('Hello world', 'en'),
      new Promise((res) => setTimeout(() => res({ ok: false, reason: '__hung__' }), 2000)),
    ]);
    eq(r.reason !== '__hung__', true,
      'prefetch 2 秒还没落定 —— 这条 fetch 又变回无界的了（真机上表现为预载卡在 18/20，'
      + '「停止」变灰却停不下来）');
    eq(abortedWith, 'abort', '端点没回应，但我们也没中止它');
    eq(r.ok, false);
    eq(r.reason, 'timeout', '「没回应」和「连不上」是两种故障，账单上要分得开');
  });

  test('prefetch names a missing endpoint instead of fetching a blank URL', async () => {
    const { TTS, calls } = setup();
    TTS.configure({ engineId: 'local', baseUrl: '' });
    const r = await TTS.prefetch('Hello world', 'en');
    eq(r.ok, false);
    eq(r.reason, 'no_base');
    eq(calls.fetch.length, 0);
  });

  test('a failed prefetch is not remembered as failed — the next call retries', async () => {
    const { TTS, calls } = setup({ fetchThrows: true });
    TTS.configure(cfg);
    const a = await TTS.prefetch('Hello world', 'en');
    eq(a.ok, false);
    eq(a.reason, 'network');
    const b = await TTS.prefetch('Hello world', 'en');
    eq(b.ok, false);
    eq(calls.fetch.length, 2, 'in-flight 表必须在失败后清干净，否则一次断网钉死这段音频');
  });

  test('a LEGACY blob-handle record is a MISS — refetched, replaced with bytes', async () => {
    // 真机定案 2026-08-09：WebKit 把 IndexedDB 里的 Blob 存成文件句柄，App 更新
    // 搬容器后句柄悬空 —— 元数据健在、字节读不出，播放报 NotSupportedError。
    // 旧格式记录必须按未命中处理，而不是把尸体端给播放器。
    const { TTS, calls, cache } = setup();
    TTS.configure(cfg);
    const key = TTS.cacheKey('Hello world', 'en');
    cache.set(key, { blob: { size: 126720, type: 'audio/mpeg' } });   // 旧格式：句柄
    const got = await TTS.getAudio('Hello world', 'en');
    eq(got.cached, false, '旧 blob 记录不能算命中');
    eq(calls.fetch.length, 1, '必须重新合成');
    ok(cache.get(key).buf instanceof ArrayBuffer, '替换成字节内联的新格式');
  });

  test('changing the voice re-synthesizes rather than serving the old audio', async () => {
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    await TTS.getAudio('Hello world', 'en');
    TTS.configure(Object.assign({}, cfg, { voice: 'different' }));
    await TTS.getAudio('Hello world', 'en');
    eq(calls.fetch.length, 2);
  });

  test('an HTTP failure surfaces as a coded reason, never as a silent no-op', async () => {
    const { TTS } = setup({ fetchStatus: 500 });
    TTS.configure(cfg);
    const r = await TTS.speak('Hello world', 'en');
    eq(r.ok, false);
    eq(r.reason, 'http');
    eq(r.status, 500);
  });

  test('a missing base URL surfaces as no_base without a request', async () => {
    const { TTS, calls } = setup();
    TTS.configure({ engineId: 'local', baseUrl: '' });
    const r = await TTS.speak('Hello world', 'en');
    eq(r.reason, 'no_base');
    eq(calls.fetch.length, 0);
  });
});

describe('LearnTTS — done：播放收尾信号（交互规范「IO 在途，控件不可用」的依据）', () => {
  // 调用方靠 done 决定何时恢复 ▶ 按钮：ended / error / stop() 三条路都必须落定，
  // 否则按钮永远禁用 —— 比可以重复点击更糟。
  function fakeAudio() {
    const created = [];
    function Audio(src) {
      this.src = src; this.__on = {};
      this.addEventListener = (t2, fn) => { this.__on[t2] = fn; };
      this.play = () => Promise.resolve();
      this.pause = () => {};
      created.push(this);
    }
    return { Audio, created };
  }

  test('speak() ok carries `done`, and it resolves exactly when playback ends', async () => {
    const { Audio, created } = fakeAudio();
    const { TTS } = setup({ Audio });
    TTS.configure({ engineId: 'local', baseUrl: 'https://tts.example' });
    const r = await TTS.speak('Hello world', 'en');
    eq(r.ok, true);
    let finished = false;
    r.done.then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    eq(finished, false, '播放没结束，done 不能先到 —— 按钮会提前解锁');
    created[0].__on.ended();
    await Promise.resolve(); await Promise.resolve();
    eq(finished, true, 'ended 之后 done 必须落定 —— 否则按钮永远禁用');
  });

  test('stop() resolves a pending done — interruption must never hang the caller', async () => {
    const { Audio } = fakeAudio();
    const { TTS } = setup({ Audio });
    TTS.configure({ engineId: 'local', baseUrl: 'https://tts.example' });
    const r = await TTS.speak('Hello world', 'en');
    eq(r.ok, true);
    let finished = false;
    r.done.then(() => { finished = true; });
    TTS.stop();
    await Promise.resolve(); await Promise.resolve();
    eq(finished, true, '被打断的播放必须落定，不能吊死等 ended');
  });

  test('the browser engine also reports done (utterance end)', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    const r = await TTS.speak('Hello', 'en');
    eq(r.ok, true);
    let finished = false;
    r.done.then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    eq(finished, false, '还在读，done 不能先到');
    if (sp.spoken[0].__on && sp.spoken[0].__on.end) sp.spoken[0].__on.end();
    await Promise.resolve(); await Promise.resolve();
    eq(finished, true, '读完（end 事件）后 done 必须落定');
  });
});

describe('LearnTTS — voices that arrive LATE', () => {
  test('a verdict given before voices load is revisited when they arrive', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')], true);   // empty at first
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });

    const seen = [];
    TTS.onVoicesChanged((v) => seen.push(v.length));

    // Cold: the platform has published nothing, so the honest answer is "unsupported"
    // — and a UI that stopped here would show a dead ▶ button forever.
    const cold = await TTS.available('en', 1);
    eq(cold.ok, false);
    eq(cold.reason, 'unsupported');

    sp.arrive();
    eq(seen.length, 1, 'subscribers MUST be told, or nothing ever re-decides');
    eq(seen[0], 1);

    const warm = await TTS.available('en');
    eq(warm.ok, true, 'the same question must now get the right answer');
  });

  test('an empty first probe is not cached as "no voices"', async () => {
    const sp = fakeSpeech([voice('Kyoko', 'ja-JP')], true);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    eq((await TTS.loadVoices(1)).length, 0);
    sp.arrive();
    eq((await TTS.loadVoices(1)).length, 1, 'a later call must re-probe, not serve an empty cache');
  });

  test('unsubscribing actually stops the callbacks', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')], true);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    let n = 0;
    const off = TTS.onVoicesChanged(() => { n++; });
    sp.arrive();
    eq(n, 1);
    off();
    sp.arrive();
    eq(n, 1, 'a leaked subscriber outlives the page it belonged to');
  });
});

describe('LearnTTS — silence is not success', () => {
  test('a platform that ignores speak() (no throw, no sound) reports blocked', async () => {
    // This is iOS without a user gesture. The old code returned ok:true because
    // speak() had not thrown, so the card said "playing…" over silence.
    const sp = fakeSpeech([voice('Alex', 'en-US')], false, true);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    // startTimeoutMs is configurable so a test does not sit through the real
    // 4s cold-voice allowance; the default stays large for actual devices.
    TTS.configure({ engineId: 'browser', startTimeoutMs: 100 });
    const r = await TTS.speak('Hello there', 'en');
    eq(r.ok, false);
    eq(r.reason, 'blocked');
    eq(sp.spoken.length, 1, 'we did attempt it — the failure is that nothing started');
  });

  test('a platform that really starts speaking reports ok', async () => {
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    eq((await TTS.speak('Hello there', 'en')).ok, true);
  });

  test('the cold-voice allowance defaults to seconds, not 1500ms', () => {
    const { TTS } = setup();
    ok(TTS.DEFAULTS.startTimeoutMs >= 3000,
      '真机冷启动语音超过 1.5s 才 start；超时后我们会 cancel，太短 = 把慢判成死');
  });
});

describe('LearnTTS — iOS 卡死解法：cancel 后让位，speak 前 resume', () => {
  // 真机事故形状：进卡时的无手势自动播放把 iOS 合成器卡在 paused 态，之后每次
  // 手点 ▶ 都排进队列但永远不 start（超时 → cancel → 报 blocked）。手势里的
  // resume() 是唯一的解卡途径；其它平台上它是 no-op。
  //
  // 计时探针：给 fake 的 cancel/speak 打时间戳。settleMs 用 120（可配置正是为了
  // 测试不用坐等真实的 250ms），断言下限用 100 留出计时器精度余量。
  function timedSpeech(active) {
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const t = { canceledAt: 0, spokeAt: 0, cancels: 0 };
    const origSpeak = sp.api.speak;
    if (active === 'speaking') sp.api.speaking = true;
    if (active === 'pending') sp.api.pending = true;
    sp.api.cancel = () => { t.canceledAt = Date.now(); t.cancels++; };
    sp.api.speak = (u) => { t.spokeAt = Date.now(); origSpeak(u); };
    return { sp, t };
  }

  test('speak() calls resume() before speak() — a paused synthesizer never starts otherwise', async () => {
    const order = [];
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const origSpeak = sp.api.speak;
    sp.api.resume = () => order.push('resume');
    sp.api.cancel = () => order.push('cancel');
    sp.api.speak = (u) => { order.push('speak'); origSpeak(u); };
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser' });
    eq((await TTS.speak('Hello', 'en')).ok, true);
    ok(order.indexOf('resume') >= 0, '没有 resume —— iOS 上被 pause 卡住的队列永远不会 start');
    ok(order.indexOf('resume') < order.indexOf('speak'), 'resume 必须发生在 speak 之前');
  });

  test('an interrupted synthesizer gets a settle beat between cancel() and speak()', async () => {
    const { sp, t } = timedSpeech('speaking');
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', settleMs: 120 });
    eq((await TTS.speak('Hello', 'en')).ok, true);
    ok(t.spokeAt - t.canceledAt >= 100,
      'cancel 打断了真播放后立刻 speak 会被 iOS 静默吞掉（间隔 ' + (t.spokeAt - t.canceledAt) + 'ms）');
  });

  test('a PENDING (queued, never started) synthesizer also gets the settle beat', async () => {
    // 正是 iOS 卡死的形状：无手势 speak 排了队但从未 start —— speaking=false、
    // pending=true。只看 speaking 会漏掉它。
    const { sp, t } = timedSpeech('pending');
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', settleMs: 120 });
    eq((await TTS.speak('Hello', 'en')).ok, true);
    ok(t.spokeAt - t.canceledAt >= 100, 'pending 队列同样要让位（间隔 ' + (t.spokeAt - t.canceledAt) + 'ms）');
  });

  test('an interrupt from a PREVIOUS stop() (card change) still earns the settle beat', async () => {
    // 复习页在换卡时先调 stop() 再 speak() —— 打断发生在 speak() 之外。只在
    // speak() 里探测 speaking 的实现会错过这条最常见的路径。
    const { sp, t } = timedSpeech('speaking');
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', settleMs: 120 });
    TTS.stop();                                  // 外部打断：此刻 speaking=true
    sp.api.speaking = false;                     // cancel 之后自然归 false
    const stoppedAt = Date.now();
    eq((await TTS.speak('Hello', 'en')).ok, true);
    ok(t.spokeAt - stoppedAt >= 100,
      '换卡的 stop() 也是打断 —— 紧随其后的 speak 必须让位（间隔 ' + (t.spokeAt - stoppedAt) + 'ms）');
  });

  test('an idle synthesizer speaks immediately — no settle tax on the common path', async () => {
    const { sp, t } = timedSpeech(null);
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    // settleMs 拉到 5s：若空闲路径误走让位，这条测试会明显超时级地变慢。
    TTS.configure({ engineId: 'browser', settleMs: 5000 });
    const before = Date.now();
    eq((await TTS.speak('Hello', 'en')).ok, true);
    ok(Date.now() - before < 1000, '空闲时不该白等 settleMs（耗时 ' + (Date.now() - before) + 'ms）');
    ok(t.spokeAt > 0, 'speak 必须真的发生');
  });

  test('a voice that starts SLOWLY but within the allowance plays — and is not cancel()ed', async () => {
    // 真机冷启动语音 start 迟到但没死：超时前 start = 成功，且成功路径绝不 cancel
    // （cancel 正是把慢判成死的那一刀）。
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const cancels = [];
    sp.api.cancel = () => cancels.push(1);
    sp.api.speak = (u) => { setTimeout(() => { if (u.__on && u.__on.start) u.__on.start(); }, 50); };
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', startTimeoutMs: 500 });
    eq((await TTS.speak('Hello', 'en')).ok, true, '慢启动 ≠ 死 —— 超时前 start 必须算成功');
    // speak() 入口的例行 stop() 恰好 cancel 一次；start 之后不得再有第二次 ——
    // 那第二刀正是把慢启动判成死的凶手。
    eq(cancels.length, 1, '成功路径在 start 之后不许 cancel（共 ' + cancels.length + ' 次）');
    // 超时计时器晚些醒来也不能补刀。
    await new Promise((r) => setTimeout(r, 550));
    eq(cancels.length, 1, '超时计时器在成功之后醒来仍然补了一刀 cancel');
  });

  test('a stale timed-out speak() must NOT cancel the next card\'s live speech', async () => {
    // T1 竞态：卡 A 的 speak 被拦（永不 start），用户换卡，卡 B 的 speak 成功；
    // 几秒后 A 的超时才醒来 —— 它绝不能对着 B 正在播的音喊 cancel。
    const sp = fakeSpeech([voice('Alex', 'en-US')]);
    const cancels = [];
    let calls = 0;
    sp.api.cancel = () => cancels.push(Date.now());
    sp.api.speak = (u) => {
      calls++;
      // 第一次 speak 静默（blocked）；第二次立刻 start（B 正常播放）。
      if (calls >= 2 && u.__on && u.__on.start) u.__on.start();
    };
    const { TTS } = setup({ speechSynthesis: sp.api, SpeechSynthesisUtterance: sp.Utterance });
    TTS.configure({ engineId: 'browser', startTimeoutMs: 300, settleMs: 0 });
    const p1 = TTS.speak('card A', 'en');            // 会卡到超时
    await new Promise((r) => setTimeout(r, 30));
    const r2 = await TTS.speak('card B', 'en');      // 接管，立即成功
    eq(r2.ok, true);
    const cancelsAfterB = cancels.length;
    const r1 = await p1;                             // A 的超时此后才醒来
    eq(r1.ok, false);
    eq(r1.reason, 'superseded', '被接管的调用要自报 superseded，而不是 blocked');
    eq(cancels.length, cancelsAfterB,
      'A 的超时对着 B 的现场播放喊了 cancel —— 正是「显示播放中却没声」的最坏结局');
  });
});

describe('LearnTTS.sniffAudioType — 服务器说的类型不可信', () => {
  const { TTS } = setup();
  const bytes = (...s) => new Uint8Array(s.concat(new Array(20).fill(0)));
  const ascii = (str) => bytes.apply(null, Array.from(str).map((c) => c.charCodeAt(0)));

  test('认出容器就用容器的类型，压过声明值', () => {
    // 2026-08-30 实测：deepgram/aura-2 声明 audio/pcm;rate=24000，body 是 RIFF。
    // 照声明存会让播放拼出 data:audio/pcm;base64,… —— 浏览器不认，**一声不响地不出声**。
    eq(TTS.sniffAudioType(ascii('RIFF').buffer, 'audio/pcm;rate=24000;channels=1'), 'audio/wav');
    eq(TTS.sniffAudioType(ascii('OggS').buffer, 'application/octet-stream'), 'audio/ogg');
    eq(TTS.sniffAudioType(ascii('fLaC').buffer, ''), 'audio/flac');
    eq(TTS.sniffAudioType(ascii('ID3x').buffer, 'audio/pcm'), 'audio/mpeg');
    eq(TTS.sniffAudioType(bytes(0xff, 0xfb).buffer, 'audio/pcm'), 'audio/mpeg', '裸 MP3 帧头');
  });

  test('认不出容器才回落到声明值，且剥掉参数', () => {
    eq(TTS.sniffAudioType(bytes(1, 2, 3, 4).buffer, 'audio/mpeg;rate=24000'), 'audio/mpeg');
    eq(TTS.sniffAudioType(bytes(1, 2, 3, 4).buffer, ''), 'audio/mpeg', '两边都没有时给一个能播的默认值');
  });

  test('不做反向覆盖：声明值永远不能压过嗅探结果', () => {
    // 我们看得见的字节比服务器说的话可靠。这条写下来是因为「相信声明值」正是本次的 bug。
    eq(TTS.sniffAudioType(ascii('RIFF').buffer, 'audio/mpeg'), 'audio/wav');
  });
});
