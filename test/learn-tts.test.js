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
    if (opts.fetchStatus && opts.fetchStatus !== 200) {
      return Promise.resolve({ ok: false, status: opts.fetchStatus });
    }
    return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 1234 }) });
  };

  const LearnStore = {
    getAudio: (k) => { calls.get.push(k); return Promise.resolve(cache.get(k) || null); },
    putAudio: (k, blob, meta) => { calls.put.push({ k, blob, meta }); cache.set(k, { blob }); return Promise.resolve(); },
  };

  const ctx = loadModule('learn/tts.js', {
    window: { MT_TTS_ENGINES: REGISTRY.map((e) => Object.assign({}, e)) },
    LearnModel, LearnStore,
    fetch: fetchStub,
    speechSynthesis: opts.speechSynthesis,
    SpeechSynthesisUtterance: opts.SpeechSynthesisUtterance,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Audio: opts.Audio,
  });
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
    // Every other engine speaks the one request format we support.
    for (const e of REGISTRY.filter((x) => x.id !== 'browser')) {
      eq(e.type, 'speech-compat', `${e.id} must use the shared request format`);
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
  const cfg = { engineId: 'local', baseUrl: 'http://127.0.0.1:8880/', model: 'kokoro', voice: 'af' };

  test('request goes to the registry path with the registry-shaped body', async () => {
    const { TTS, calls } = setup();
    TTS.configure(cfg);
    await TTS.getAudio('Hello world', 'en');
    eq(calls.fetch.length, 1);
    const local = REGISTRY.find((e) => e.id === 'local');
    // Path comes from the production registry — not a literal repeated in the test.
    eq(calls.fetch[0].url, 'http://127.0.0.1:8880' + local.path);
    const body = JSON.parse(calls.fetch[0].init.body);
    eq(body.model, 'kokoro');
    eq(body.voice, 'af');
    eq(body.input, 'Hello world');
  });

  test('a trailing slash on the base URL does not produce a doubled path', async () => {
    const { TTS, calls } = setup();
    TTS.configure(Object.assign({}, cfg, { baseUrl: 'http://127.0.0.1:8880///' }));
    await TTS.getAudio('Hi there', 'en');
    ok(!calls.fetch[0].url.includes('//v1'), `doubled slash in ${calls.fetch[0].url}`);
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
    TTS.configure({ engineId: 'browser' });
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
});
