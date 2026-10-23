// test/grok-stt.test.js — Grok STT 会话骨架（docs/thai-grok-stt-demo-spec.md 步 1）的纯逻辑门。
//
// 全部用假 WebSocket：不建真连接、不读真 key、不发网络请求。锁住的是：
//   · 无 key ⇒ 异步 error reason=no-key，句柄空操作，且不抛未捕获；
//   · 建连 URL / Authorization 头 / locale 基码 / language 覆盖；
//   · transcript.created 之前只缓冲，之后 sendPcm 才按 3200 字节整帧发 binary；
//   · partial / final / done 的事件映射与毫秒时间戳；
//   · close 先发 audio.done，close 事件只发一次；
//   · 假 key 绝不出现在 error.reason、抛错文本或日志通道里。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, tick, loadModule } = require('./harness');

// 与 test/asr-subtitles.test.js 的 FakeWS 同形，但第二参数按「选项对象」记录 headers：
// 正式实现走 new WS(url, { headers: { Authorization } })，浏览器退回 new WS(url)。
function makeFakeWS() {
  class FakeWS {
    constructor(url, optsOrProtocols) {
      this.url = String(url);
      this.opts = optsOrProtocols;
      this.headers = (optsOrProtocols && optsOrProtocols.headers) || null;
      this.sent = [];
      this.readyState = 0;
      FakeWS.instances.push(this);
    }
    send(data) { this.sent.push(data); }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: 1000, reason: '' });
    }
    _open() { this.readyState = 1; if (this.onopen) this.onopen(); }
    _msg(obj) { if (this.onmessage) this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
    _error() { if (this.onerror) this.onerror({}); }
  }
  FakeWS.instances = [];
  return FakeWS;
}

function load(FakeWS, sandbox) {
  const win = {};
  const ctx = loadModule('../app/grok-stt.js', Object.assign({
    window: win,
    console: { log() {}, warn() {}, error() {} },
    WebSocket: FakeWS,
    process: { env: {} },          // 绝不让宿主的真 XAI_API_KEY 漏进测试
  }, sandbox || {}));
  return { GS: ctx.window.GrokStt, ctx, win };
}

// 步 2b：App 假桥。原生一半（native-speech.js）与 grok-stt.js 装进同一个 vm 上下文 ——
// 这正是浏览器的真实关系：mtSpeech 的消息由 NativeSpeech._fromNative 转给 GrokStt。
function loadWithBridge(sandbox) {
  const posted = [];
  const win = {
    webkit: { messageHandlers: { mtSpeech: { postMessage(m) { posted.push(m); } } } },
  };
  const ctx = loadModule(['../app/native-speech.js', '../app/grok-stt.js'], Object.assign({
    window: win,
    console: { log() {}, warn() {}, error() {} },
    WebSocket: class { constructor() { throw new Error('native bridge must not construct a WebSocket'); } },
    process: { env: {} },          // 桥这一路也不需要宿主环境变量
  }, sandbox || {}));
  return { GS: ctx.GrokStt, NS: ctx.NativeSpeech, ctx, win, posted };
}

const tagOf = (v) => Object.prototype.toString.call(v);
const sentJson = (ws) => ws.sent.filter((s) => typeof s === 'string').map((s) => JSON.parse(s));
const lastSocket = (FakeWS) => FakeWS.instances[FakeWS.instances.length - 1];

describe('grok-stt: constants and URL', () => {
  test('exports the exact constants the spec names', () => {
    const { GS } = load(makeFakeWS());
    eq(GS.WS_URL_BASE, 'wss://api.x.ai/v1/stt');
    eq(GS.MODEL, 'grok-voice-transcribe-2.0');
    eq(GS.FRAME_BYTES, 3200);
  });

  test('locale defaults to th-TH, language is its base code, opts.language overrides', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);

    GS.open({ apiKey: 'k1', WebSocket: FakeWS, onEvent() {} });
    eq(lastSocket(FakeWS).url,
      'wss://api.x.ai/v1/stt?model=grok-voice-transcribe-2.0&sample_rate=16000&encoding=pcm&interim_results=true&language=th');

    FakeWS.instances.length = 0;
    GS.open({ apiKey: 'k2', locale: 'en-US', WebSocket: FakeWS, onEvent() {} });
    ok(lastSocket(FakeWS).url.indexOf('language=en') > 0, lastSocket(FakeWS).url);

    FakeWS.instances.length = 0;
    GS.open({ apiKey: 'k3', locale: 'th-TH', language: 'th-x-test', WebSocket: FakeWS, onEvent() {} });
    ok(lastSocket(FakeWS).url.indexOf('language=th-x-test') > 0, lastSocket(FakeWS).url);
  });

  test('Authorization is sent as a header; a browser-style constructor that rejects headers falls back to new WS(url)', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    GS.open({ apiKey: 'sk-header', WebSocket: FakeWS, onEvent() {} });
    eq(lastSocket(FakeWS).headers.Authorization, 'Bearer sk-header');

    class NoHeaderWS extends FakeWS {
      constructor(url, optsOrProtocols) {
        if (optsOrProtocols !== undefined) throw new Error('custom headers unsupported');
        super(url);
      }
    }
    FakeWS.instances.length = 0;
    const fallback = load(NoHeaderWS);
    fallback.GS.open({ apiKey: 'sk-fallback', WebSocket: NoHeaderWS, onEvent() {} });
    eq(FakeWS.instances.length, 1, 'the one-argument constructor succeeded');
    eq(lastSocket(FakeWS).headers, null);
    ok(lastSocket(FakeWS).url.indexOf('sample_rate=16000') > 0);
  });

  test('key resolution: opts.apiKey, then getApiKey(), then process.env.XAI_API_KEY', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    let asked = 0;
    GS.open({ getApiKey: () => { asked++; return 'sk-getter'; }, WebSocket: FakeWS, onEvent() {} });
    eq(asked, 1);
    eq(lastSocket(FakeWS).headers.Authorization, 'Bearer sk-getter');

    FakeWS.instances.length = 0;
    const env = load(FakeWS, { process: { env: { XAI_API_KEY: 'sk-env' } } });
    env.GS.open({ WebSocket: FakeWS, onEvent() {} });
    eq(lastSocket(FakeWS).headers.Authorization, 'Bearer sk-env');
  });
});

describe('grok-stt: no key', () => {
  test('★ no key ⇒ asynchronous error reason=no-key, no socket, and sendPcm/close are safe no-ops', async () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const events = [];
    let handle = null;
    // open 本身不许抛
    handle = GS.open({ onEvent: (k, p) => events.push({ k, p }) });
    eq(FakeWS.instances.length, 0, 'no connection is attempted without a key');
    eq(events.length, 0, 'the failure is asynchronous (setTimeout 0)');
    await tick(5);
    eq(events.length, 1);
    eq(events[0].k, 'error');
    eq(events[0].p.reason, 'no-key');
    // 空操作且不抛
    handle.sendPcm(new Uint8Array(6400));
    handle.sendPcm(new Int16Array(1600));
    handle.cut();
    handle.close();
    eq(FakeWS.instances.length, 0);
  });

  test('an onEvent callback that throws never escapes open/sendPcm/close', async () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    let calls = 0;
    const handle = GS.open({
      apiKey: 'k', WebSocket: FakeWS,
      onEvent() { calls++; throw new Error('listener boom'); },
    });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'transcript.created' });
    ws._msg({ type: 'transcript.partial', text: 'x', is_final: false });
    handle.close();
    eq(calls, 3, 'ready, partial and close each reached the listener exactly once');
  });
});

describe('grok-stt: session event mapping', () => {
  test('★ created ⇒ ready; interim ⇒ partial; is_final ⇒ final with th-TH and ms timing', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const events = [];
    GS.open({ apiKey: 'sk-live', WebSocket: FakeWS, onEvent: (k, p) => events.push({ k, p }) });
    const ws = lastSocket(FakeWS);
    ws._open();

    ws._msg({ type: 'transcript.created' });
    eq(events.length, 1);
    eq(events[0].k, 'ready');
    deepEq(events[0].p, {});

    ws._msg({ type: 'transcript.partial', text: 'สวัสดี', is_final: false });
    eq(events.length, 2);
    eq(events[1].k, 'partial');
    eq(events[1].p.locale, 'th-TH');
    eq(events[1].p.text, 'สวัสดี');
    eq(events[1].p.speech_final, false);

    ws._msg({ type: 'transcript.partial', text: 'สวัสดีครับ', is_final: true, speech_final: true, start: 1.25, duration: 0.5, conf: 0.91 });
    eq(events.length, 3);
    eq(events[2].k, 'final');
    eq(events[2].p.locale, 'th-TH', 'the default locale is reported on every event');
    eq(events[2].p.text, 'สวัสดีครับ');
    eq(events[2].p.speech_final, true);
    eq(events[2].p.conf, 0.91);
    eq(events[2].p.t0, 1250);
    eq(events[2].p.t1, 1750);

    // is_final with speech_final false is still a final, but the flag stays false
    ws._msg({ type: 'transcript.partial', text: 'กลางประโยค', is_final: true, speech_final: false });
    eq(events.length, 4);
    eq(events[3].k, 'final');
    eq(events[3].p.speech_final, false);
  });

  test('transcript.done emits one last final (if not already emitted) and then closes', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const events = [];
    GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent: (k, p) => events.push({ k, p }) });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'transcript.created' });
    ws._msg({ type: 'transcript.partial', text: 'A', is_final: true });
    ws._msg({ type: 'transcript.done', text: 'B' });
    deepEq(events.filter((e) => e.k === 'final').map((e) => e.p.text), ['A', 'B']);
    const doneFinal = events.filter((e) => e.k === 'final')[1];
    eq(doneFinal.p.locale, 'th-TH');
    eq(doneFinal.p.speech_final, true);
    eq(events.filter((e) => e.k === 'close').length, 1);
    eq(events[events.length - 1].k, 'close');
    eq(events[events.length - 1].p.reason, 'done');
  });

  test('transcript.done does not re-emit a text already sent as a final', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const events = [];
    GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent: (k, p) => events.push({ k, p }) });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'transcript.created' });
    ws._msg({ type: 'transcript.partial', text: 'A', is_final: true });
    ws._msg({ type: 'transcript.done', text: 'A' });
    eq(events.filter((e) => e.k === 'final').length, 1);
    eq(events.filter((e) => e.k === 'close').length, 1);
  });

  test('a server error maps to reason=server; a socket error maps to reason=ws', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const events = [];
    GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent: (k, p) => events.push({ k, p }) });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'error', reason: 'bad key sk-test-SECRET', message: 'sk-test-SECRET' });
    ws._error();
    const reasons = events.filter((e) => e.k === 'error').map((e) => e.p.reason);
    deepEq(reasons, ['server', 'ws']);
  });
});

describe('grok-stt: PCM framing', () => {
  test('★ PCM is buffered until transcript.created; then exactly 3200-byte binary frames', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const handle = GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent() {} });
    const ws = lastSocket(FakeWS);
    ws._open();

    ws._msg({ type: 'transcript.created' });
    eq(ws.sent.length, 0);

    // 不足一帧不发
    handle.sendPcm(new Uint8Array(3199));
    eq(ws.sent.length, 0);

    // 补 1 字节即成整帧，且是 binary（不是 string / Blob）
    handle.sendPcm(new Uint8Array(1));
    eq(ws.sent.length, 1);
    eq(tagOf(ws.sent[0]), '[object Uint8Array]');
    eq(ws.sent[0].byteLength, 3200);

    // 一次送两帧多
    handle.sendPcm(new Uint8Array(6400));
    eq(ws.sent.length, 3);
    for (const f of ws.sent) { eq(tagOf(f), '[object Uint8Array]'); eq(f.byteLength, 3200); }

    // Int16Array 与 ArrayBuffer 都收；1600 个 sample = 3200 字节
    handle.sendPcm(new Int16Array(1600));
    eq(ws.sent.length, 4);
    handle.sendPcm(new ArrayBuffer(3200));
    eq(ws.sent.length, 5);
    eq(ws.sent[4].byteLength, 3200);
  });

  test('frames are byte-exact and the leftover of a partial frame is kept', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const handle = GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent() {} });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'transcript.created' });

    const first = new Uint8Array(3200); first.fill(0xAA); first[3199] = 0xBB;
    handle.sendPcm(first);
    eq(ws.sent.length, 1);
    eq(ws.sent[0][0], 0xAA);
    eq(ws.sent[0][3199], 0xBB);

    // 700 字节先留着，不单独成帧
    const tail = new Uint8Array(700); tail.fill(0xCC);
    handle.sendPcm(tail);
    eq(ws.sent.length, 1);
    handle.sendPcm(new Uint8Array(2500));
    eq(ws.sent.length, 2);
    eq(ws.sent[1][699], 0xCC, 'the leftover bytes lead the next frame');
    eq(ws.sent[1][700], 0x00);
  });

  test('PCM sent before created is buffered and flushed on ready (whole frames only)', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const handle = GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent() {} });
    const ws = lastSocket(FakeWS);
    ws._open();
    handle.sendPcm(new Uint8Array(3200));
    eq(ws.sent.length, 0, 'nothing may be sent before transcript.created');
    ws._msg({ type: 'transcript.created' });
    eq(ws.sent.length, 1);
    eq(ws.sent[0].byteLength, 3200);
  });
});

describe('grok-stt: close / cut', () => {
  test('★ close() sends audio.done, closes the socket and fires close exactly once', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const events = [];
    const handle = GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent: (k, p) => events.push({ k, p }) });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'transcript.created' });

    handle.close();
    deepEq(sentJson(ws), [{ type: 'audio.done' }]);
    eq(ws.readyState, 3);
    eq(events.filter((e) => e.k === 'close').length, 1);
    eq(events[events.length - 1].p.reason, 'client');
    // 再关一次不再发、不再触发事件
    handle.close();
    eq(sentJson(ws).length, 1);
    eq(events.filter((e) => e.k === 'close').length, 1);
  });

  test('cut() sends finalize while open', () => {
    const FakeWS = makeFakeWS();
    const { GS } = load(FakeWS);
    const handle = GS.open({ apiKey: 'k', WebSocket: FakeWS, onEvent() {} });
    const ws = lastSocket(FakeWS);
    ws._open();
    ws._msg({ type: 'transcript.created' });
    handle.cut();
    deepEq(sentJson(ws), [{ type: 'finalize' }]);
  });
});

describe('grok-stt: native bridge (step 2b)', () => {
  const URL_TH = 'wss://api.x.ai/v1/stt?model=grok-voice-transcribe-2.0&sample_rate=16000&encoding=pcm&interim_results=true&language=th';

  test('★ App 有 mtSpeech ⇒ 只发原生 open（url/key/locale），绝不建 WebSocket', () => {
    const { GS, posted } = loadWithBridge();
    const events = [];
    GS.open({ getApiKey: () => 'sk-native-SECRET', locale: 'th-TH', onEvent: (k, p) => events.push({ k, p }) });
    eq(posted.length, 1, 'bridge path must post exactly one message up front');
    const open = posted[0];
    eq(open.type, 'grok-stt-open');
    ok(open.req, 'every native session needs a req id');
    eq(open.url, URL_TH);
    eq(open.apiKey, 'sk-native-SECRET');
    eq(open.locale, 'th-TH');
    eq(events.length, 0, 'no event before the server says created');
  });

  test('★ 原生事件按 req 映射：created⇒ready、partial/final、error、close；PCM 走 base64 整帧', () => {
    const { GS, NS, posted } = loadWithBridge();
    const events = [];
    const handle = GS.open({ getApiKey: () => 'sk-native-SECRET', locale: 'th-TH', onEvent: (k, p) => events.push({ k, p }) });
    const req = posted[0].req;

    // PCM 在 created 之前只缓冲，不到 3200 字节也不发。
    handle.sendPcm(new Uint8Array(3199));
    eq(posted.filter((m) => m.type === 'grok-stt-pcm').length, 0);
    NS._fromNative({ type: 'grok-stt-event', req, kind: 'ready' });
    deepEq(events.map((e) => e.k), ['ready']);
    eq(posted.filter((m) => m.type === 'grok-stt-pcm').length, 0, 'still short of a whole frame');
    handle.sendPcm(new Uint8Array(1).fill(0xCD));
    let pcm = posted.filter((m) => m.type === 'grok-stt-pcm');
    eq(pcm.length, 1, 'one whole frame goes out after ready');
    eq(pcm[0].req, req);
    let bytes = Buffer.from(pcm[0].pcm, 'base64');
    eq(bytes.length, 3200);
    eq(bytes[3199], 0xCD, 'the pre-ready bytes lead and the new byte closes the frame');

    // 再一整帧：base64 解回来必须逐字节相同。
    const frame = new Uint8Array(3200); frame.fill(0xAB);
    handle.sendPcm(frame);
    pcm = posted.filter((m) => m.type === 'grok-stt-pcm');
    eq(pcm.length, 2);
    bytes = Buffer.from(pcm[1].pcm, 'base64');
    eq(bytes.length, 3200);
    eq(bytes[0], 0xAB);
    eq(bytes[3199], 0xAB);

    // 不足一帧的尾巴与下一块拼成下一帧。
    handle.sendPcm(new Uint8Array(100).fill(0x11));
    eq(posted.filter((m) => m.type === 'grok-stt-pcm').length, 2);
    handle.sendPcm(new Uint8Array(3100).fill(0x22));
    pcm = posted.filter((m) => m.type === 'grok-stt-pcm');
    eq(pcm.length, 3);
    bytes = Buffer.from(pcm[2].pcm, 'base64');
    eq(bytes.length, 3200);
    eq(bytes[0], 0x11);
    eq(bytes[99], 0x11);
    eq(bytes[100], 0x22);

    NS._fromNative({ type: 'grok-stt-event', req, kind: 'partial', text: 'สวัสดี', speech_final: false, locale: 'th-TH' });
    NS._fromNative({ type: 'grok-stt-event', req, kind: 'final', text: 'สวัสดีครับ', speech_final: true, conf: 0.91, t0: 1250, t1: 1750 });
    NS._fromNative({ type: 'grok-stt-event', req, kind: 'error', reason: 'server' });
    deepEq(events.map((e) => e.k), ['ready', 'partial', 'final', 'error']);
    eq(events[1].p.locale, 'th-TH');
    eq(events[1].p.text, 'สวัสดี');
    eq(events[1].p.speech_final, false);
    eq(events[2].p.text, 'สวัสดีครับ');
    eq(events[2].p.speech_final, true);
    eq(events[2].p.conf, 0.91);
    eq(events[2].p.t0, 1250);
    eq(events[2].p.t1, 1750);
    eq(events[3].p.reason, 'server');

    handle.cut();
    deepEq(posted.filter((m) => m.type === 'grok-stt-cut').map((m) => m.req), [req]);
    handle.close();
    deepEq(posted.filter((m) => m.type === 'grok-stt-close').map((m) => m.req), [req]);
    eq(events[events.length - 1].k, 'close');
    eq(events[events.length - 1].p.reason, 'client');

    // key 只在 open 消息里出现一次；PCM / cut / close / 所有事件回执里都没有。
    const tail = JSON.stringify(posted.slice(1));
    eq(tail.indexOf('sk-native-SECRET'), -1, 'key leaked into a native bridge message');
    eq(JSON.stringify(events).indexOf('sk-native-SECRET'), -1, 'key leaked into an event payload');
  });

  test('★ 多会话按 req 区分；close 后该 req 不再收事件', () => {
    const { GS, NS, posted } = loadWithBridge();
    const a = [], b = [];
    const ha = GS.open({ apiKey: 'ka', onEvent: (k, p) => a.push({ k, p }) });
    const hb = GS.open({ apiKey: 'kb', onEvent: (k, p) => b.push({ k, p }) });
    eq(posted.length, 2);
    const reqA = posted[0].req, reqB = posted[1].req;
    ok(reqA && reqB && reqA !== reqB, 'two sessions must get distinct req ids');
    NS._fromNative({ type: 'grok-stt-event', req: reqA, kind: 'partial', text: 'one' });
    NS._fromNative({ type: 'grok-stt-event', req: reqB, kind: 'partial', text: 'two' });
    eq(a.length, 1); eq(a[0].p.text, 'one');
    eq(b.length, 1); eq(b[0].p.text, 'two');
    hb.close();
    eq(b.length, 2); eq(b[1].k, 'close');
    NS._fromNative({ type: 'grok-stt-event', req: reqB, kind: 'final', text: 'late' });
    eq(b.length, 2, 'a closed session must ignore later native events');
    NS._fromNative({ type: 'grok-stt-event', req: reqA, kind: 'close', reason: 'done' });
    eq(a[a.length - 1].k, 'close');
    eq(a[a.length - 1].p.reason, 'done');
    ha.close();
  });

  test('★ 无 mtSpeech ⇒ 步 1 的 WebSocket 路径逐字不变（Authorization 头仍在）', () => {
    const FakeWS = makeFakeWS();
    const { GS, win } = load(FakeWS);
    GS.open({ apiKey: 'sk-ws', WebSocket: FakeWS, onEvent() {} });
    eq(win.webkit, undefined);
    eq(FakeWS.instances.length, 1, 'no bridge ⇒ the old WebSocket constructor still runs');
    eq(lastSocket(FakeWS).headers.Authorization, 'Bearer sk-ws');
    eq(lastSocket(FakeWS).url, URL_TH);
  });
});

describe('grok-stt: key hygiene', () => {
  const SECRET = 'sk-test-SECRET';

  test('★ the fake key never enters an error.reason, a thrown string, or any event payload', async () => {
    const events = [];
    const thrown = [];

    const FakeWS = makeFakeWS();
    try {
      const { GS } = load(FakeWS);
      const handle = GS.open({ apiKey: SECRET, WebSocket: FakeWS, onEvent: (k, p) => events.push({ k, p }) });
      const ws = lastSocket(FakeWS);
      eq(ws.headers.Authorization, 'Bearer ' + SECRET, 'the key goes to the auth header and nowhere else');
      ws._open();
      ws._msg({ type: 'error', reason: 'bad key ' + SECRET, message: 'unauthorized ' + SECRET });
      ws._error();
      handle.sendPcm(new Uint8Array(3200));
      handle.close();
    } catch (e) {
      thrown.push(String((e && e.message) || e));
    }

    // 连构造都失败时（错误文本里带 key），也只能异步报 reason=ws，不能抛
    const BoomWS = class {
      constructor() { throw new Error('connect failed for ' + SECRET); }
    };
    try {
      const { GS } = load(BoomWS);
      GS.open({ apiKey: SECRET, onEvent: (k, p) => events.push({ k, p }) });
      await tick(5);
    } catch (e) {
      thrown.push(String((e && e.message) || e));
    }

    deepEq(thrown, []);
    const blob = JSON.stringify(events);
    eq(blob.indexOf(SECRET), -1, 'the key leaked into an event payload: ' + blob);
    ok(events.some((e) => e.k === 'error' && e.p.reason === 'server'));
    ok(events.some((e) => e.k === 'error' && e.p.reason === 'ws'));
  });

  test('the source has no console/DiagLog channel a key could leak through', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/grok-stt.js'), 'utf8');
    ok(!/\bconsole\s*\./.test(src), 'no console.* in the session module');
    ok(!/\bDiagLog\b/.test(src), 'no DiagLog in the session module');
    ok(src.indexOf(SECRET) === -1);
    ok(!/new Error\([^)]*\bkey\b/i.test(src), 'no error message is built from the key');
  });
});
