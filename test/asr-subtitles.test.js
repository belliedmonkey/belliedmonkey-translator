// test/asr-subtitles.test.js — 「AI 转写字幕」(docs/domain-design.md §2.4) 的纯逻辑门。
//
// 四层各锁一半：
//   · 核心：appendUnits 保序 / HOLD_MS=0 逐字节不变 / createCueMerger 只吐闭合句、尾句只吐一次
//   · harness：'streaming' 锁住重试闸；push→appendItems；开口尾句**不会**触发翻译请求
//     （verification-spec §3.1.1 #2：没发出的请求只有调用计数看得见）；键变化/关闭/停止都
//     调 onAbort；缺省窗口等于生产窗口（#1）
//   · 传输：wire-format 后缀行与 wss 主机；request-shape 两家体形状 + 用**真实回包**录下的
//     fixture 跑 extractCues；ws-transcribe 两个切句器与两个适配器（假 WebSocket）
//   · asr-source：重切句、重采样、媒体地址
const { describe, test, eq, ok, deepEq, loadModule } = require('./harness');
const { makeChrome } = require('./stubs');
const fs = require('fs');
const path = require('path');

const MSGS = {};
function loadCore() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  const ctx = loadModule('translation-core.js', { window: { MT_I18N_MESSAGES: MSGS }, chrome, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } }, navigator: {} });
  return ctx.TranslationCore;
}
const FAST = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 3, RETRY_GAP_MS: 5, GRACE_MS: 0 };

describe('§2.4 core: appendUnits / HOLD_MS / createCueMerger', () => {
  const TC = loadCore();

  test('appendUnits keeps units sorted by start so activeAt stays correct', () => {
    const eng = TC.createSubtitleEngine({ getCurrentTime: () => 0, translate: async (x) => x, window: FAST });
    eng.setItems([{ start: 0, end: 1000, text: 'a' }, { start: 5000, end: 6000, text: 'c' }]);
    eng.appendItems([{ start: 2000, end: 3000, text: 'b' }]);
    eng.appendItems([{ start: 8000, end: 9000, text: 'd' }, { start: 100, end: 900, text: 'a2' }]);
    deepEq(eng.items.map((u) => u.text), ['a', 'a2', 'b', 'c', 'd']);
    eq(eng.activeAt(2500).text, 'b');
    eq(eng.activeAt(8500).text, 'd');
  });

  test('HOLD_MS = 0 (the production default) is byte-identical to the old activeAt', () => {
    const eng = TC.createSubtitleEngine({ getCurrentTime: () => 0, translate: async (x) => x, window: FAST });
    eq(TC.WINDOW.HOLD_MS, 0, 'production default is 0');
    eng.setItems([{ start: 0, end: 1000, text: 'a' }, { start: 5000, end: 6000, text: 'c' }]);
    eq(eng.activeAt(999).text, 'a');
    eq(eng.activeAt(1000), null, 'exactly `end` is no longer active');
    eq(eng.activeAt(3000), null);
  });

  test('HOLD_MS keeps a sentence active past its end, but never past the next start', () => {
    const eng = TC.createSubtitleEngine({ getCurrentTime: () => 0, translate: async (x) => x, window: FAST });
    eng.setItems([{ start: 0, end: 1000, text: 'a' }, { start: 5000, end: 6000, text: 'c' }]);
    eng.setWindow({ HOLD_MS: 6000 });
    eq(eng.activeAt(3000).text, 'a', 'held after its end');
    eq(eng.activeAt(4999).text, 'a');
    eq(eng.activeAt(5000).text, 'c', 'the next sentence takes over at its start');
    eq(eng.activeAt(11000).text, 'c', 'the last one is held for the full HOLD_MS');
    eq(eng.activeAt(12001), null);
    eng.setWindow({ HOLD_MS: 0 });
    eq(eng.activeAt(3000), null, 'setWindow moves both copies');
  });

  test('setWindow merges (an override never leaves other knobs undefined)', () => {
    const eng = TC.createSubtitleEngine({ getCurrentTime: () => 0, translate: async (x) => x, window: FAST });
    eng.setWindow({ GRACE_MS: 4000 });
    eq(eng.window.GRACE_MS, 4000);
    eq(eng.window.AHEAD_MS, 60000, 'untouched knob survives');
  });

  test('createCueMerger closes on terminal / MAX_LEN / gap and keeps the open tail back', () => {
    const m = TC.createCueMerger();
    deepEq(m.push([{ start: 0, end: 500, text: 'Hello' }]), [], 'no terminal yet — nothing closes');
    ok(m.open && m.open.text === 'Hello', 'the tail is held, not lost');
    const out = m.push([{ start: 600, end: 1000, text: 'world.' }, { start: 1100, end: 1500, text: 'Again' }]);
    eq(out.length, 1); eq(out[0].text, 'Hello world.'); eq(out[0].start, 0); eq(out[0].end, 1000);
    // silence gap closes without a terminal
    const out2 = m.push([{ start: 4000, end: 4500, text: 'later' }]);
    eq(out2.length, 1); eq(out2[0].text, 'Again');
    // MAX_LEN closes
    const long = 'x'.repeat(170);
    const out3 = m.push([{ start: 4600, end: 4700, text: long }]);
    eq(out3.length, 1); ok(out3[0].text.length > 160);
  });

  test('flush returns the tail exactly once, and an empty tail returns []', () => {
    const m = TC.createCueMerger();
    m.push([{ start: 0, end: 500, text: 'open tail' }]);
    deepEq(m.flush().map((c) => c.text), ['open tail']);
    deepEq(m.flush(), []);
  });

  test('CJK cues join without a space', () => {
    const m = TC.createCueMerger();
    const out = m.push([{ start: 0, end: 500, text: '我们那里' }, { start: 500, end: 900, text: '没有姓长的。' }]);
    eq(out[0].text, '我们那里没有姓长的。');
  });
});

// ─── harness ──────────────────────────────────────────────────────────
function makeDom() {
  const byId = {};
  function el(tag) {
    const kids = [];
    const e = { tag, id: '', className: '', style: {}, textContent: '', hidden: false, _listeners: {},
      setAttribute(n, v) { if (n === 'id') { e.id = v; byId[v] = e; } },
      getAttribute() { return null; },
      appendChild(c) { kids.push(c); if (c.id) byId[c.id] = c; return c; },
      querySelector(sel) { const cls = sel.replace(/^\./, ''); return kids.find((k) => k.className === cls) || null; },
      addEventListener(n, fn) { e._listeners[n] = fn; },
      removeEventListener() {},
      remove() { if (e.id) delete byId[e.id]; },
      getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
      get children() { return kids; },
    };
    Object.defineProperty(e, 'id', { get() { return e._id || ''; }, set(v) { e._id = v; byId[v] = e; } });
    return e;
  }
  const body = el('body');
  return { body, byId, getElementById: (id) => byId[id] || null, createElement: (t) => el(t), addEventListener() {}, removeEventListener() {} };
}
function loadHarness(opts = {}) {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  const document = makeDom();
  // MT_PALETTE exactly as the build emits it: the registry values plus the roundBtnCss
  // function the build appends (build.js writes both into palette.gen.js).
  const P = require('../build/palette.config.js');
  const window = { MT_I18N_MESSAGES: MSGS, MT_PALETTE: Object.assign({}, P.runtime), innerWidth: 800, innerHeight: 600 };
  new Function('window', P.roundBtnCssJs())(window);
  const timers = { intervals: 0, cleared: 0 };
  const ctx = loadModule(['translation-core.js', 'subtitle-adapter.js'], {
    window, chrome, document, navigator: {},
    setInterval: () => { timers.intervals++; return 1; }, clearInterval: () => { timers.cleared++; },
    setTimeout: (fn) => { return 0; }, clearTimeout: () => {},
  });
  const calls = [];
  const spec = Object.assign({
    ids: { overlay: 'ov', orig: 'o', trans: 't', btn: 'b', menu: 'm', meas: 'meas' },
    hasMedia: () => true, mediaKey: () => 'm1', getCurrentTime: () => opts.now ? opts.now() : 0,
    isPlaying: () => true, showButton: () => false, menuToggle: false,
    acquire: async () => null, placeOverlay: () => true, fontPx: () => 16, textWidth: () => 300,
    translate: async (x) => { calls.push(x); return 'T:' + x; },
    labels: { btnTitle: '', subOn: '', subOff: '' },
  }, opts.spec || {});
  const ui = ctx.SubtitleAdapter.createSubtitleUI(spec);
  return { ui, spec, calls, document, timers, TC: ctx.TranslationCore };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('§2.4 harness: streaming acquire', () => {
  test("'streaming' latches the retry gate: acquire runs once, never again for this media", async () => {
    let n = 0, ctxRef = null;
    const { ui } = loadHarness({ spec: { acquire: async (ctx) => { n++; ctxRef = ctx; return 'streaming'; } } });
    ui.init({}); ui.enable();
    for (let i = 0; i < 5; i++) { ui.tick(); await flush(); }
    eq(n, 1, 'acquire called exactly once');
    ok(ctxRef && typeof ctxRef.push === 'function' && typeof ctxRef.fail === 'function', 'ctx handed over');
  });

  test('push → only CLOSED sentences reach the engine; the open tail sends NO translation request', async () => {
    let ctxRef = null;
    const { ui, calls } = loadHarness({ spec: { acquire: async (ctx) => { ctxRef = ctx; return 'streaming'; } } });
    ui.init({}); ui.enable(); ui.tick(); await flush();
    ctxRef.push([{ start: 0, end: 500, text: 'Hello' }]);
    ui.tick(); await flush(); ui.tick(); await flush();
    eq(ui.engine.items.length, 0, 'open tail is not an engine unit');
    eq(calls.length, 0, 'no request for an open tail (§3.1.1 #2)');
    ctxRef.push([{ start: 600, end: 1000, text: 'world.' }]);
    ui.tick(); await flush(); ui.tick(); await flush();
    eq(ui.engine.items.length, 1);
    eq(ui.engine.items[0].text, 'Hello world.');
    eq(calls.length, 1, 'exactly one request for the one closed sentence');
    // done() flushes the tail once
    ctxRef.push([{ start: 1100, end: 1400, text: 'tail' }]);
    ctxRef.done();
    eq(ui.engine.items.length, 2);
    eq(ui.engine.items[1].text, 'tail');
  });

  test('mode("live") applies the live window; media-key change restores the production window', async () => {
    let ctxRef = null, key = 'm1';
    const { ui, TC } = loadHarness({ spec: { mediaKey: () => key, acquire: async (ctx) => { ctxRef = ctx; return 'streaming'; } } });
    ui.init({}); ui.enable(); ui.tick(); await flush();
    ctxRef.mode('live');
    eq(ui.engine.window.HOLD_MS, 6000); eq(ui.engine.window.GRACE_MS, 4000);
    key = 'm2'; ui.tick(); await flush();
    eq(ui.engine.window.HOLD_MS, 0); eq(ui.engine.window.GRACE_MS, TC.WINDOW.GRACE_MS, 'back to the production grace, read from the core');
  });

  test('onAbort fires on media change, on disable, and on stopAsr — and never twice', async () => {
    const aborts = [];
    let key = 'm1';
    const acquire = async (ctx) => { ctx.onAbort((why) => aborts.push(why)); return 'streaming'; };
    const { ui } = loadHarness({ spec: { mediaKey: () => key, acquire } });
    ui.init({}); ui.enable(); ui.tick(); await flush();
    key = 'm2'; ui.tick(); await flush();
    deepEq(aborts, ['media']);
    // the new media is acquired afresh (a fresh session registers a fresh hook)
    ui.tick(); await flush();
    ui.disable();
    deepEq(aborts, ['media', 'off']);
    ui.enable(); ui.tick(); await flush();
    ui.stopAsr();
    deepEq(aborts, ['media', 'off', 'user']);
    ui.disable();
    deepEq(aborts, ['media', 'off', 'user'], 'an already-aborted session is not aborted again');
  });

  test('fail(msg) ends in unavailable with the message as the notice, and the offer is rendered', async () => {
    let ctxRef = null;
    const { ui, document } = loadHarness({ spec: { acquire: async (ctx) => { ctxRef = ctx; return 'streaming'; }, unavailableAction: () => ({ label: 'OFFER', onClick() {} }) } });
    ui.init({}); ui.enable(); ui.tick(); await flush();
    ctxRef.fail('捕获不到声音');
    ui.tick(); await flush();
    const ov = document.getElementById('ov');
    const zh = ov.querySelector('.t');
    ok(zh.textContent.indexOf('捕获不到声音') === 0, 'notice shows the stop reason: ' + zh.textContent);
    ok(zh.children.length === 1 && zh.children[0].textContent === 'OFFER', 'offer button inside the notice');
  });

  test('acquireVia replaces acquire for the current media only; a media change clears it', async () => {
    let base = 0, asr = 0, key = 'm1';
    const { ui } = loadHarness({ spec: { mediaKey: () => key, acquire: async () => { base++; return 'unavailable'; } } });
    ui.init({}); ui.enable(); ui.tick(); await flush();
    eq(base, 1);
    ui.acquireVia(async (ctx) => { asr++; return 'streaming'; });
    ui.tick(); await flush();
    eq(asr, 1); eq(base, 1, 'spec.acquire not re-run');
    key = 'm2'; ui.tick(); await flush(); ui.tick(); await flush();
    eq(asr, 1, 'the ASR acquire does not follow the next media (no automatic restart of a paid session)');
    eq(base, 2, 'the normal acquire runs for the new media');
  });

  test('a spec without unavailableAction renders the plain notice (three existing backends unchanged)', async () => {
    const { ui, document } = loadHarness({ spec: { acquire: async () => 'unavailable' } });
    ui.init({}); ui.enable(); ui.tick(); await flush(); ui.tick(); await flush();
    const zh = document.getElementById('ov').querySelector('.t');
    eq(zh.children.length, 0);
    ok(zh.textContent.length > 0);
  });
});

// ─── wire-format ──────────────────────────────────────────────────────
describe('§2.4 wire-format: transcribe-gemini and the live family', () => {
  const WF = require('../extension/content/wire-format.js');
  test('suffix rows', () => {
    eq(WF.formatFor('https://generativelanguage.googleapis.com/v1beta/interactions', 'transcribe-gemini'), 'transcribe-gemini');
    eq(WF.formatFor('https://generativelanguage.googleapis.com/v1beta/interactions', 'transcribe-compat'), 'transcribe-gemini', 'the URL outranks the registry type within the family');
    eq(WF.formatFor('wss://api.example.com/v1/realtime?intent=transcription', 'ws-realtime'), 'ws-realtime');
    eq(WF.formatFor('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=abc', 'ws-bidi'), 'ws-bidi');
    eq(WF.formatFor('wss://gateway.example/v1/realtime', 'ws-bidi'), 'ws-realtime', 'suffix picks the variant within the live family');
  });
  test('family closure: an /interactions address under a CHAT engine stays chat', () => {
    eq(WF.formatFor('https://x.example/v1beta/interactions', 'chat-compat'), 'chat-compat');
  });
  test('wss:// is an absolute address with a host', () => {
    ok(WF.isAbsolute('wss://api.example.com/v1/realtime'));
    eq(WF.hostOf('wss://user:pw@api.example.com:443/v1/realtime?key=SECRET'), 'api.example.com');
    ok(WF.hasPath('wss://api.example.com/v1/realtime'));
  });
});

// ─── request-shape ────────────────────────────────────────────────────
function loadRS() {
  const vm = require('vm');
  const WireFormat = require('../extension/content/wire-format.js');
  const ctx = { window: { WireFormat }, WireFormat, console, setTimeout, clearTimeout, FormData, Blob,
    atob: (b) => Buffer.from(b, 'base64').toString('latin1') };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension/content/request-shape.js'), 'utf8'), ctx);
  return ctx.window.RequestShape;
}
describe('§2.4 request-shape: bodies and cue extraction', () => {
  const RS = loadRS();
  const gemini = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/asr/gemini-words.json'), 'utf8'));
  const whisper = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/asr/whisper-verbose.json'), 'utf8'));

  test('transcribe-gemini: JSON, key header, verbatim mode + word timestamps, inline base64', () => {
    const r = RS.build('transcribe-gemini', { url: 'u', apiKey: 'K', model: 'm', audioBase64: 'AAAA', audioMime: 'audio/mp3' });
    eq(r.headers['x-goog-api-key'], 'K');
    const b = JSON.parse(r.body);
    eq(b.model, 'm'); eq(b.input[0].data, 'AAAA'); eq(b.input[0].mime_type, 'audio/mp3');
    deepEq(b.generation_config.transcription_config.timestamp_granularities, ['word']);
    eq(b.generation_config.transcription_config.mode.type, 'verbatim');
    ok(!('language_codes' in b.generation_config.transcription_config), 'no language ⇒ auto-detect');
  });
  test('transcribe-gemini without audio is a named build error, not a request', () => {
    eq(RS.build('transcribe-gemini', { url: 'u', apiKey: 'K', model: 'm' }).error, 'no_audio');
  });
  test('transcribe-gemini: extractCues on a REAL recorded reply → sorted ms cues with text', () => {
    const r = RS.build('transcribe-gemini', { url: 'u', apiKey: 'K', model: 'm', audioBase64: 'x' });
    const cues = r.extractCues(gemini);
    ok(cues.length >= 2, 'got cues: ' + cues.length);
    for (let i = 1; i < cues.length; i++) ok(cues[i].start >= cues[i - 1].start, 'sorted');
    ok(cues.every((c) => c.end >= c.start && c.text.length > 0));
    ok(Number.isInteger(cues[0].start), 'milliseconds, integer');
    ok(typeof r.durationOf(gemini) === 'number');
  });
  test('transcribe-compat: wantCues adds verbose_json + segment granularity; extractCues reads segments[]', () => {
    const r = RS.build('transcribe-compat', { url: 'u', apiKey: 'K', model: 'm', file: new Blob(['a']), filename: 'a.mp3', wantCues: true });
    const keys = [...r.body.keys()];
    ok(keys.includes('response_format') && keys.includes('timestamp_granularities[]'));
    const cues = r.extractCues(whisper);
    eq(cues.length, whisper.segments.length);
    eq(cues[0].start, Math.round(whisper.segments[0].start * 1000));
    eq(r.durationOf(whisper), 30500);
  });
  test('transcribe-compat WITHOUT wantCues is byte-identical to before (说题 path untouched)', () => {
    const r = RS.build('transcribe-compat', { url: 'u', apiKey: 'K', model: 'm', file: new Blob(['a']), filename: 'a.mp3' });
    deepEq([...r.body.keys()], ['file', 'model']);
    eq(r.extractCues, null);
  });
  test('audioEncoding keeps wantsAudioDataUri as its alias', () => {
    eq(RS.audioEncoding('transcribe-dashscope'), 'dataUri'); ok(RS.wantsAudioDataUri('transcribe-dashscope'));
    eq(RS.audioEncoding('transcribe-gemini'), 'base64');
    eq(RS.audioEncoding('transcribe-compat'), 'blob');
  });
});

// ─── ws-transcribe ────────────────────────────────────────────────────
function loadWs() {
  const vm = require('vm');
  const sockets = [];
  class FakeWS {
    constructor(url, protocols) { this.url = url; this.protocols = protocols; this.sent = []; this.readyState = 0; sockets.push(this); }
    send(s) { this.sent.push(s); }
    close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
    _open() { this.readyState = 1; this.onopen && this.onopen(); }
    _msg(obj) { this.onmessage && this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  }
  const ctx = { window: {}, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, WebSocket: FakeWS,
    btoa: (s) => Buffer.from(s, 'latin1').toString('base64') };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension/content/ws-transcribe.js'), 'utf8'), ctx);
  return { W: ctx.window.WsTranscribe, sockets };
}
describe('§2.4 ws-transcribe: cutters and adapters', () => {
  test('sentenceCutter: finals close on terminals, the rest is a partial, flush empties once', () => {
    const { W } = loadWs();
    const ev = []; const c = W.sentenceCutter((e) => ev.push(e));
    c.add(' This'); c.add(' is'); c.add(' one.'); c.add(' Two');
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['This is one.']);
    eq(ev[ev.length - 1].kind, 'partial'); eq(ev[ev.length - 1].text, 'Two');
    c.flush(); c.flush();
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['This is one.', 'Two']);
  });
  test('interimCutter: cumulative interims emit a sentence once it is no longer the tail; final flushes the rest; never re-emits', () => {
    const { W } = loadWs();
    const ev = []; const c = W.interimCutter((e) => ev.push(e));
    c.interim('This is a'); c.interim('This is a recording. All'); c.interim('This is a recording. All rec are.');
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['This is a recording.']);
    c.interim('This is a recording. All rec are. For'); c.final('This is a recording. All rec are. For more.');
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['This is a recording.', 'All rec are.', 'For more.']);
    c.interim('Next one.'); c.final('Next one.');
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text).slice(-1), ['Next one.']);
  });
  test('interimCutter: a final that arrives AFTER the next utterance began does not re-emit (measured Gemini ordering)', () => {
    const { W } = loadWs();
    const ev = []; const c = W.interimCutter((e) => ev.push(e));
    c.interim('First sentence here. Second'); c.interim('First sentence here. Second one.');
    c.interim('Third utterance starts');            // new utterance began…
    c.final('First sentence here. Second one.');    // …then the previous final lands late
    c.interim('Third utterance starts now. And');
    const finals = ev.filter((e) => e.kind === 'final').map((e) => e.text);
    deepEq(finals, ['First sentence here.', 'Second one.', 'Third utterance starts now.']);
  });
  test('ws-realtime: key rides the subprotocol, session.update on open, deltas → finals, error → error event', () => {
    const { W, sockets } = loadWs();
    const ev = [];
    const s = W.open({ url: 'wss://x/v1/realtime?intent=transcription', type: 'ws-realtime', apiKey: 'SECRET', keyProtocol: 'vendor-insecure-api-key.', model: 'live', rate: 24000, langs: ['en'], onEvent: (e) => ev.push(e) });
    const ws = sockets[0];
    deepEq(ws.protocols, ['realtime', 'vendor-insecure-api-key.SECRET']);
    ws._open();
    const upd = JSON.parse(ws.sent[0]);
    eq(upd.type, 'session.update'); eq(upd.session.type, 'transcription');
    eq(upd.session.audio.input.format.rate, 24000); eq(upd.session.audio.input.turn_detection, null);
    deepEq(upd.session.audio.input.transcription.languages, ['en']);
    eq(s.sendPcm(new Int16Array(4)), false, 'not ready before session.updated');
    ws._msg({ type: 'session.updated' });
    ok(s.sendPcm(new Int16Array(4)));
    eq(JSON.parse(ws.sent[1]).type, 'input_audio_buffer.append');
    ws._msg({ type: 'conversation.item.input_audio_transcription.delta', delta: ' Hello' });
    ws._msg({ type: 'conversation.item.input_audio_transcription.delta', delta: ' there.' });
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['Hello there.']);
    ws._msg({ type: 'error', error: { message: 'quota' } });
    eq(ev[ev.length - 1].kind, 'error'); eq(ev[ev.length - 1].message, 'quota');
  });
  test('ws-realtime without the registry key protocol refuses to open (never a silent bad handshake)', () => {
    const { W } = loadWs();
    let threw = false;
    try { W.open({ url: 'wss://x/v1/realtime', type: 'ws-realtime', apiKey: 'k', model: 'm', rate: 24000, onEvent() {} }); } catch (_) { threw = true; }
    ok(threw);
  });
  test('ws-bidi: key on the URL, setup on open, interim/final → sentences, audio as realtimeInput', () => {
    const { W, sockets } = loadWs();
    const ev = [];
    const s = W.open({ url: 'wss://g/ws/x.BidiGenerateContent', type: 'ws-bidi', apiKey: 'SECRET', model: 'live', rate: 16000, langs: [], onEvent: (e) => ev.push(e) });
    const ws = sockets[0];
    ok(ws.url.indexOf('?key=SECRET') > 0);
    ws._open();
    eq(JSON.parse(ws.sent[0]).setup.model, 'models/live');
    ws._msg({ setupComplete: {} });
    ok(s.sendPcm(new Int16Array(4)));
    const a = JSON.parse(ws.sent[1]);
    eq(a.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
    ws._msg({ serverContent: { interimInputTranscription: { text: 'One. Two' } } });
    ws._msg({ serverContent: { inputTranscription: { text: 'One. Two.' } } });
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['One.', 'Two.']);
  });
  test('unknown live type throws synchronously', () => {
    const { W } = loadWs();
    let threw = false; try { W.open({ type: 'ws-nope', onEvent() {} }); } catch (_) { threw = true; }
    ok(threw);
  });
});

// ─── asr-source pure parts ────────────────────────────────────────────
describe('§2.4 asr-source: pure helpers', () => {
  global.WsTranscribe = require('../extension/content/ws-transcribe.js');
  const A = require('../extension/content/asr-source.js');
  test('splitSentences: a Latin terminal cuts only before whitespace/end; CJK terminals always cut', () => {
    const W = global.WsTranscribe;
    deepEq(W.splitSentences('See michael.com. Enjoy 3.5 today. Bye'), ['See michael.com.', 'Enjoy 3.5 today.', 'Bye']);
    deepEq(W.splitSentences('你好。再见！还有'), ['你好。', '再见！', '还有']);
    deepEq(W.completeSentences('One. Two').done, ['One.']);
    eq(W.completeSentences('One. Two').tail, 'Two');
    eq(W.completeSentences('One. Two.').tail, '');
  });
  test('splitAtTerminals cuts a multi-sentence cue with proportional timing', () => {
    const out = A.splitAtTerminals([{ start: 0, end: 1000, text: 'One two. Three four five.' }]);
    eq(out.length, 2);
    eq(out[0].text, 'One two.'); eq(out[1].text, 'Three four five.');
    eq(out[0].start, 0); eq(out[1].end, 1000);
    ok(out[0].end > 0 && out[0].end < 1000 && out[1].start === out[0].end);
  });
  test('splitAtTerminals leaves a single sentence alone', () => {
    deepEq(A.splitAtTerminals([{ start: 5, end: 9, text: 'Just one.' }]), [{ start: 5, end: 9, text: 'Just one.' }]);
  });
  test('makeResampler 48k → 16k yields one third of the frames, carries the remainder', () => {
    const rs = A.makeResampler(48000, 16000);
    const a = rs(new Float32Array(4000).fill(0.5));
    eq(a.length, 1333);
    ok(a[0] > 16000 && a[0] < 16400, 'level preserved: ' + a[0]);
    const b = rs(new Float32Array(2).fill(0.5));
    eq(a.length + b.length, 1334, 'carry-over frames are not dropped');
  });
  test('mediaUrl accepts http(s) only (blob:/MSE ⇒ live tier)', () => {
    eq(A.mediaUrl({ currentSrc: 'https://cdn.example/a.mp3' }), 'https://cdn.example/a.mp3');
    eq(A.mediaUrl({ currentSrc: 'blob:https://x/uuid' }), '');
    eq(A.mediaUrl(null), '');
  });
  test('eligible: only media at least MIN_DURATION_S long', () => {
    ok(!A.eligible({ duration: 10 })); ok(A.eligible({ duration: A.MIN_DURATION_S })); ok(!A.eligible({ duration: NaN }));
  });
});
