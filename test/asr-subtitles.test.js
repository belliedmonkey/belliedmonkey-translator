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

  test('a live sentence whose end is already behind the playhead is still translated while held (HOLD_MS)', () => {
    let now = 10000; const calls = [];
    const eng = TC.createSubtitleEngine({ getCurrentTime: () => now, translate: async (x) => { calls.push(x); return x; }, window: FAST });
    eng.setWindow({ HOLD_MS: 6000 });
    eng.appendItems([{ start: 7000, end: 9500, text: 'spoken already' }]); // arrived at 9.5 s, playhead at 10 s
    eng.pump();
    deepEq(calls, ['spoken already']);
    // and with HOLD_MS = 0 (fetched transcripts) the old rule stands: a past unit is not sent
    const calls2 = [];
    const eng2 = TC.createSubtitleEngine({ getCurrentTime: () => now, translate: async (x) => { calls2.push(x); return x; }, window: FAST });
    eng2.appendItems([{ start: 7000, end: 9500, text: 'past' }]);
    eng2.pump();
    deepEq(calls2, []);
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
    const e = { tag, id: '', className: '', style: {}, _text: '', hidden: false, _listeners: {},
      // 真 DOM 语义：给 textContent 赋值会清掉全部子节点。offer 提前后，通知行会先带一个
      // 按钮、再因 msg 变化重建 —— 桩不清子节点就会数出两个按钮。
      get textContent() { return e._text; },
      set textContent(v) { e._text = String(v == null ? '' : v); kids.length = 0; },
      setAttribute(n, v) { if (n === 'id') { e.id = v; byId[v] = e; } },
      getAttribute() { return null; },
      appendChild(c) { if (c.parentElement && c.parentElement !== e) { const k = c.parentElement.children; const i = k.indexOf(c); if (i >= 0) k.splice(i, 1); } if (!kids.includes(c)) kids.push(c); c.parentElement = e; if (c.id) byId[c.id] = c; return c; },
      querySelector(sel) { const cls = sel.replace(/^\./, ''); return kids.find((k) => k.className === cls) || null; },
      addEventListener(n, fn) { e._listeners[n] = fn; },
      setPointerCapture() {}, releasePointerCapture() {},
      removeEventListener() {},
      remove() { if (e.id) delete byId[e.id]; if (e.parentElement) { const k = e.parentElement.children; const i = k.indexOf(e); if (i >= 0) k.splice(i, 1); e.parentElement = null; } },
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
  const window = { MT_I18N_MESSAGES: MSGS, MT_PALETTE: Object.assign({}, P.runtime), innerWidth: 1400, innerHeight: 900 };
  if (opts.storeInto) chrome.storage.local.set = (obj) => { Object.assign(opts.storeInto, obj); };
  new Function('window', P.roundBtnCssJs())(window);
  const timers = { intervals: 0, cleared: 0 };
  const ctx = loadModule(['translation-core.js', 'subtitle-adapter.js'], {
    window, chrome, document, navigator: {}, LearnCollector: opts.collector || { noteSubtitle() {} },
    setInterval: () => { timers.intervals++; return 1; }, clearInterval: () => { timers.cleared++; },
    setTimeout: (fn) => { if (opts.timersOut) opts.timersOut.push(fn); return 0; }, clearTimeout: () => {},
    // opts.clock = { t }：可拨的时钟（重试间隔 RESOLVE_RETRY_MS 是按 Date.now() 算的，测试里不真等）
    ...(opts.clock ? { Date: Object.assign(function FakeDate(...a) { return a.length ? new Date(...a) : new Date(opts.clock.t); }, { now: () => opts.clock.t, parse: Date.parse, UTC: Date.UTC }) } : {}),
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









  // 2026-09-16：实时档下掉后 mode() 只剩一种窗口。这条断言保留的是它**原本**的价值 ——
  // 「生产窗口从 core 读，never restated here」，以及媒体切换后窗口仍然正确。
  test('mode() 只应用生产窗口 —— 实时档下掉后没有第二种窗口', async () => {
    let ctxRef = null, key = 'm1';
    const { ui, TC } = loadHarness({ spec: { mediaKey: () => key, acquire: async (ctx) => { ctxRef = ctx; return 'streaming'; } } });
    ui.init({}); ui.enable(); ui.tick(); await flush();
    ctxRef.mode();
    eq(ui.engine.window.HOLD_MS, 0);
    eq(ui.engine.window.GRACE_MS, TC.WINDOW.GRACE_MS, 'grace 读自 core，不在适配器里重述');
    key = 'm2'; ui.tick(); await flush();
    eq(ui.engine.window.HOLD_MS, 0, '媒体切换后仍是生产窗口');
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

  // 2026-09-11（第九期）：offer 从第一次 acquire 失败起就出现在「⏳ 字幕加载中…」那一行里，
  // 不再等 6–8 次重试（≈ 15–20 s）。YouTube 传 offerAfterAttempts:2（前 3 s 有 grace）。
  test('★ the offer appears inside the loading notice after the FIRST failed acquire (podcast), after the 2nd with offerAfterAttempts:2', async () => {
    for (const [after, expectAt] of [[undefined, 1], [2, 2]]) {
      const { ui, document } = loadHarness({ spec: Object.assign({ acquire: async () => null, unavailableAction: () => ({ label: 'OFFER', onClick() {} }) }, after ? { offerAfterAttempts: after } : {}) });
      ui.init({}); ui.enable();
      // 第 1 拍：acquire 起飞并落定为 null（attempts=1）；第 2 拍渲染
      ui.tick(); await flush(); ui.tick(); await flush();
      const zh = () => document.getElementById('ov').querySelector('.t');
      const hasBtn = () => zh().children.length === 1 && zh().children[0].textContent === 'OFFER';
      if (expectAt === 1) ok(hasBtn(), 'podcast: offer after the first failed acquire; got ' + zh().children.length + ' buttons');
      else ok(!hasBtn(), 'offerAfterAttempts:2 — not yet after one attempt');
      ok(/字幕加载中|loading/i.test(zh().textContent), 'still the loading line: ' + zh().textContent);
    }
  });

  // 全回归 09-15 O3（macOS Safari 真机）：早出的 offer 只在两次 acquire 之间（!inFlight）渲染 ——
  // 2.7 s 有、下一次 acquire 起飞后没了、16.7 s 落定又出，一闪一闪，人去点时它可能刚好不在。
  // 规约（interaction-spec §Offer）是「从第一次 acquire 失败起就出现在 ⏳ 字幕加载中… 那一行里」。
  test('★ once shown, the early offer STAYS while the next acquire is in flight — no flicker (O3)', async () => {
    for (const [after, failsBefore] of [[undefined, 1], [2, 2]]) {
      const clock = { t: 1e12 };
      let calls = 0;
      const pending = new Promise(() => {});
      const { ui, document } = loadHarness({ clock, spec: Object.assign({
        acquire: () => { calls++; return calls <= failsBefore ? Promise.resolve(null) : pending; },
        unavailableAction: () => ({ label: 'OFFER', onClick() {} }),
      }, after ? { offerAfterAttempts: after } : {}) });
      ui.init({}); ui.enable();
      const zh = () => (document.getElementById('ov') || { querySelector: () => null }).querySelector('.t');
      const hasBtn = () => !!zh() && zh().children.length === 1 && zh().children[0].textContent === 'OFFER';
      const tag = after ? 'offerAfterAttempts:2' : 'podcast';
      for (let i = 0; i < failsBefore; i++) { if (i) clock.t += 2600; ui.tick(); await flush(); }
      ui.tick(); await flush();
      ok(hasBtn(), `${tag}: offer shown after ${failsBefore} failed acquire(s)`);
      clock.t += 2600; ui.tick(); await flush();
      eq(calls, failsBefore + 1, `${tag}: the next acquire did start (and is still in flight)`);
      ok(hasBtn(), `${tag}: offer must stay while the next acquire is in flight; got ${zh() ? zh().children.length : 'no notice'} buttons`);
      ok(/字幕加载中|loading/i.test(zh().textContent), `${tag}: still the loading line: ` + zh().textContent);
    }
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

  test('acquireVia while subtitles are OFF (popup entry) still runs the ASR acquire, not the normal one', async () => {
    let base = 0, asr = 0;
    const { ui } = loadHarness({ spec: { mediaKey: () => 'v1', acquire: async () => { base++; return 'unavailable'; } } });
    ui.init({});
    ui.acquireVia(async () => { asr++; return 'streaming'; });
    await flush(); ui.tick(); await flush();
    eq(asr, 1, 'the ASR acquire ran');
    eq(base, 0, 'the normal acquire did not');
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
    eq(WF.formatFor('wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=abc', 'ws-duplex'), 'ws-duplex');
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
  test('sentenceCutter: run-on speech closes at a clause boundary past CLAUSE_CHARS, never mid-word', () => {
    const { W } = loadWs();
    const ev = []; const c = W.sentenceCutter((e) => ev.push(e));
    const words = 'so what we are going to do today is walk through the whole pipeline, and then after that we will look at the numbers, and finally';
    for (const w of words.split(' ')) c.add(' ' + w);
    const finals = ev.filter((e) => e.kind === 'final').map((e) => e.text);
    ok(finals.length >= 1, 'a clause closed: ' + JSON.stringify(finals));
    ok(finals.every((f) => /[,;:]$/.test(f)), 'closed at clause punctuation: ' + JSON.stringify(finals));
    ok(finals.every((f) => f.length >= 20));
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
    const s = W.open({ url: 'wss://x/v1/realtime?intent=transcription', type: 'ws-realtime', apiKey: 'SECRET', keyProtocol: 'vendor-insecure-api-key.', model: 'live', rate: 24000, langs: ['en'], params: { delay: 'minimal' }, onEvent: (e) => ev.push(e) });
    const ws = sockets[0];
    deepEq(ws.protocols, ['realtime', 'vendor-insecure-api-key.SECRET']);
    ws._open();
    const upd = JSON.parse(ws.sent[0]);
    eq(upd.type, 'session.update'); eq(upd.session.type, 'transcription');
    eq(upd.session.audio.input.format.rate, 24000); eq(upd.session.audio.input.turn_detection, null);
    deepEq(upd.session.audio.input.transcription.languages, ['en']);
    eq(upd.session.audio.input.transcription.delay, 'minimal', 'registry liveParams ride into the session config');
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
  test('ws-duplex: key as ?api_key=, run-task on open, binary audio, partial/final from sentence_end, task-failed → error', () => {
    const { W, sockets } = loadWs();
    const ev = [];
    const s = W.open({ url: 'wss://d/api-ws/v1/inference', type: 'ws-duplex', apiKey: 'SECRET', model: 'flash-streaming', rate: 16000, langs: [], onEvent: (e) => ev.push(e) });
    const ws = sockets[0];
    ok(ws.url.indexOf('?api_key=SECRET') > 0, ws.url);
    ok(ws.protocols == null, 'no subprotocol');
    ws._open();
    const rt = JSON.parse(ws.sent[0]);
    eq(rt.header.action, 'run-task'); eq(rt.header.streaming, 'duplex'); ok(/^[0-9a-f]{32}$/.test(rt.header.task_id), rt.header.task_id);
    eq(rt.payload.model, 'flash-streaming'); eq(rt.payload.parameters.format, 'pcm'); eq(rt.payload.parameters.sample_rate, 16000);
    eq(s.sendPcm(new Int16Array(4)), false, 'not ready before task-started');
    ws._msg({ header: { event: 'task-started', task_id: rt.header.task_id }, payload: {} });
    eq(ev[0].kind, 'ready');
    ok(s.sendPcm(new Int16Array(4)));
    ok(ArrayBuffer.isView(ws.sent[1]) && ws.sent[1].byteLength === 8, 'audio goes as a binary frame (not a JSON string)');
    ws._msg({ header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'this is', sentence_end: false } } } });
    deepEq(ev.filter((e) => e.kind === 'partial').map((e) => e.text), ['this is']);
    // cumulative partial already holds a closed sentence ⇒ released before the vendor closes the chunk
    ws._msg({ header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'this is one. and', sentence_end: false } } } });
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['this is one.']);
    ws._msg({ header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'this is one. and two.', sentence_end: true, begin_time: 100, end_time: 2400 } } } });
    deepEq(ev.filter((e) => e.kind === 'final').map((e) => e.text), ['this is one.', 'and two.'], 'no re-emit of the released sentence');
    s.close();
    const fin = JSON.parse(ws.sent[2]);
    eq(fin.header.action, 'finish-task'); eq(fin.header.task_id, rt.header.task_id);
    eq(W.stripKey('wss://d/x?api_key=SECRET'), 'wss://d/x?api_key=…');
  });
  test('ws-duplex: task-failed surfaces the server sentence, never silent', () => {
    const { W, sockets } = loadWs();
    const ev = [];
    W.open({ url: 'wss://d/api-ws/v1/inference', type: 'ws-duplex', apiKey: 'k', model: 'm', rate: 16000, onEvent: (e) => ev.push(e) });
    sockets[0]._open();
    sockets[0]._msg({ header: { event: 'task-failed', error_code: 'InvalidParameter', error_message: 'bad format' } });
    deepEq(ev.filter((e) => e.kind === 'error').map((e) => e.message), ['bad format']);
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
  // 2026-09-07 macOS Safari 26.5 实测：真实手势、AudioContext running、视频在放且有声，
  // createMediaElementSource 对 blob:（MSE）源的输出 RMS 恒为 0。原先要等静音守卫 3 秒后说
  // 「捕获不到声音」—— 用户明明听得见，那句话在怪错人。现在开 socket 之前就具名停下。
  test('★ Safari + blob:(MSE) source → named "mse" failure before any AudioContext / socket', async () => {
    let code = null;
    try { await A.attachCapture({ currentSrc: 'blob:https://www.youtube.com/abc', src: '' }, null, null); } catch (e) { code = e.code; }
    eq(code, 'mse');
    let code2 = null;
    try { await A.attachCapture({ currentSrc: 'https://cdn.example/x.mp3', src: '' }, null, null); } catch (e) { code2 = e.code; }
    ok(code2 !== 'mse', 'an http(s) source must not be judged as MSE');
    // 原生 HLS（iOS Safari 的 <video src=.m3u8>）：清单不是音频，文件档拿它去转写只会得到
    // 「无法读取该音频」（2026-09-07 iOS 17.2 模拟器实测）；Safari 上同样具名停下。
    eq(A.mediaUrl({ currentSrc: 'https://cdn.example/live/master.m3u8?x=1' }), '', 'a manifest URL is not a tier-A media URL');
    eq(A.mediaUrl({ currentSrc: 'https://cdn.example/ep.mp3?x=1' }), 'https://cdn.example/ep.mp3?x=1');
    let code3 = null;
    try { await A.attachCapture({ currentSrc: 'https://cdn.example/live/master.m3u8', src: '' }, null, null); } catch (e) { code3 = e.code; }
    eq(code3, 'mse');
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
  test('★ startFrom: no element ⇒ {ok:false, reason:no_media}; no engine ⇒ no_engine; both tracked as asr_entry', () => {
    const tracked = [];
    global.MTTelemetry = { track: (n, p) => tracked.push([n, p]) };
    try {
      deepEq(A.startFrom('popup', null, {}, {}), { ok: false, reason: 'no_media' });
      // 测试环境里 RequestShape 缺席 ⇒ primeConfig 落到 {ok:false} ⇒ 没配引擎
      const r = A.startFrom('popup', { duration: 100 }, { streaming: false, acquireVia() {} }, {});
      eq(r.ok, false); eq(r.reason, 'no_engine');
      deepEq(tracked.map((x) => x[1].result), ['no_media', 'no_engine']);
      ok(tracked.every((x) => x[0] === 'asr_entry' && x[1].surface === 'popup'));
    } finally { delete global.MTTelemetry; }
  });
  test('eligible: only media at least MIN_DURATION_S long', () => {
    ok(!A.eligible({ duration: 10 })); ok(A.eligible({ duration: A.MIN_DURATION_S })); ok(!A.eligible({ duration: NaN }));
  });
});
