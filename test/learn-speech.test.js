// test/learn-speech.test.js — 语音输入 (§9.4).
//
// The load-bearing properties: the capability gate (no engine / no mic API ⇒ the
// speak form does not exist), the multipart request shape ('und' must never be
// asserted as a language — every Safari capture is 'und'), the mic tracks being
// released on EVERY path, and named error codes end to end.

const { loadModule, describe, test, ok, eq } = require('./harness');
const WireFormat = require('../extension/content/wire-format.js');

const ENGINES = [
  { id: 'local', type: 'transcribe-compat', label: 'L', defaultEndpoint: null,
    placeholder: 'http://127.0.0.1:18790/v1/audio/transcriptions', defaultModel: '',
    needsKey: false, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: true },
  { id: 'cloud', type: 'transcribe-compat', label: 'C',
    defaultEndpoint: 'https://stt.example/v1/audio/transcriptions',
    placeholder: null, defaultModel: 'whisper-1',
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false },
];

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, getTracks: () => tracks };
}

class FakeRecorder {
  constructor(stream, opts) {
    this.state = 'recording';
    this.opts = opts || {};
    this.ondataavailable = null;
    this.onstop = null;
  }
  static isTypeSupported(m) { return m === 'audio/mp4'; }
  start() {}
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(['abc']) });
    if (this.onstop) this.onstop();
  }
}

function setup(over) {
  over = over || {};
  const calls = { fetch: [] };
  const fetchImpl = over.fetch || (async (url, init) => {
    calls.fetch.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ text: 'hello world' }) };
  });
  const stream = fakeStream();
  const sandbox = {
    window: { MT_STT_ENGINES: over.engines || ENGINES },
    navigator: over.noMic ? {} : {
      mediaDevices: {
        getUserMedia: over.denyMic
          ? () => Promise.reject(new Error('NotAllowedError'))
          : () => Promise.resolve(stream),
      },
    },
    MediaRecorder: over.noRecorder ? undefined : FakeRecorder,
    FormData, Blob, fetch: fetchImpl, console, WireFormat,
  };
  const ctx = loadModule(['content/request-shape.js', 'learn/speech-input.js'], sandbox);
  return { S: ctx.LearnSpeech, calls, stream };
}

describe('LearnSpeech — the capability gate (§9.4)', () => {
  test('no engine configured ⇒ not capable — the speak form does not exist', () => {
    const { S } = setup();
    S.configure({ engineId: '' });
    eq(S.capable(), false);
    eq(S.engineReady().reason, 'no_engine');
  });

  test('requiresBaseUrl without a base ⇒ no_base; keyed engine without a key ⇒ no_key', () => {
    const { S } = setup();
    S.configure({ engineId: 'local', baseUrl: '' });
    eq(S.engineReady().reason, 'no_base');
    S.configure({ engineId: 'local', baseUrl: 'http://127.0.0.1:9000' });
    eq(S.engineReady().ok, true);
    S.configure({ engineId: 'cloud', baseUrl: '', apiKey: '' });
    eq(S.engineReady().reason, 'no_key', 'defaultBase 顶上了 base，但 key 仍缺');
    S.configure({ engineId: 'cloud', apiKey: 'k' });
    eq(S.capable(), true);
  });

  test('no microphone API on the host ⇒ not capable, even with a perfect engine', () => {
    const a = setup({ noMic: true });
    a.S.configure({ engineId: 'cloud', apiKey: 'k' });
    eq(a.S.capable(), false);
    const b = setup({ noRecorder: true });
    b.S.configure({ engineId: 'cloud', apiKey: 'k' });
    eq(b.S.capable(), false);
  });
});

describe('LearnSpeech — recording releases the microphone on every path', () => {
  test('stop() resolves the blob with the container extension and stops the tracks', async () => {
    const { S, stream } = setup();
    S.configure({ engineId: 'cloud', apiKey: 'k' });
    const rec = await S.startRecording();
    const out = await rec.stop();
    ok(out.blob && out.blob.size > 0, '没有拿到录音数据');
    eq(out.ext, 'm4a', 'mp4 容器要配 m4a 扩展名（whisper 端点按文件名判格式）');
    ok(stream.tracks.every((t) => t.stopped), '停止后麦克风轨道没有释放');
  });

  test('cancel() releases the mic without producing anything', async () => {
    const { S, stream } = setup();
    S.configure({ engineId: 'cloud', apiKey: 'k' });
    const rec = await S.startRecording();
    rec.cancel();
    ok(stream.tracks.every((t) => t.stopped), 'cancel 后麦克风轨道没有释放');
  });

  test('a denied microphone throws mic_denied — a named code, not a raw DOMException', async () => {
    const { S } = setup({ denyMic: true });
    S.configure({ engineId: 'cloud', apiKey: 'k' });
    try { await S.startRecording(); ok(false, '应当抛错'); }
    catch (e) { eq(e.code, 'mic_denied'); }
  });
});

describe('LearnSpeech — transcribe: the multipart shape and named failures', () => {
  const blob = () => new Blob(['x'], { type: 'audio/mp4' });

  test('posts multipart to base+path with Bearer auth; language only when known', async () => {
    const { S, calls } = setup();
    S.configure({ engineId: 'cloud', apiKey: 'sk-1' });
    await S.transcribe(blob(), 'm4a', 'en-US');
    eq(calls.fetch.length, 1);
    eq(calls.fetch[0].url, 'https://stt.example/v1/audio/transcriptions');
    eq(calls.fetch[0].init.headers['Authorization'], 'Bearer sk-1');
    const fd = calls.fetch[0].init.body;
    eq(fd.get('language'), 'en', 'BCP-47 要折到主语言子标签');
    eq(fd.get('model'), 'whisper-1', '模型默认值来自注册表');
    ok(fd.get('file'), 'multipart 里没有 file 字段');
  });

  test("'und' (every Safari capture) must NOT be asserted as a language", async () => {
    const { S, calls } = setup();
    S.configure({ engineId: 'cloud', apiKey: 'k' });
    await S.transcribe(blob(), 'm4a', 'und');
    eq(calls.fetch[0].init.body.get('language'), null);
    await S.transcribe(blob(), 'm4a', '');
    eq(calls.fetch[1].init.body.get('language'), null);
  });

  test('JSON {text}, plain-text and JSON-in-text/plain responses all parse', async () => {
    const mk = (payload) => setup({ fetch: async () => ({ ok: true, status: 200, text: async () => payload }) });
    const a = mk(JSON.stringify({ text: ' hi there ' }));
    a.S.configure({ engineId: 'cloud', apiKey: 'k' });
    eq(await a.S.transcribe(blob(), 'm4a', 'en'), 'hi there');
    const b = mk('raw transcript line');
    b.S.configure({ engineId: 'cloud', apiKey: 'k' });
    eq(await b.S.transcribe(blob(), 'm4a', 'en'), 'raw transcript line');
  });

  test('a CORS/network rejection is named `network`, not swallowed as a generic error', async () => {
    // WebKit rejects a cross-origin response that lacks Access-Control-Allow-Origin
    // BEFORE any status is readable — fetch throws a bare TypeError. Measured on the
    // iOS simulator 2026-08-13: the server had already processed the upload. Without
    // this mapping the UI can only say 「转写失败」, which points at nothing.
    const { S } = setup({ fetch: async () => { throw new TypeError('Load failed'); } });
    S.configure({ engineId: 'cloud', apiKey: 'k' });
    try { await S.transcribe(new Blob(['x']), 'm4a', 'en'); ok(false, '应当抛错'); }
    catch (e) { eq(e.code, 'network'); }
  });

  test('尾斜杠原样保留 —— 地址是用户的陈述，我们不裁也不补', async () => {
    const { S, calls } = setup();
    S.configure({ engineId: 'local', baseUrl: 'http://127.0.0.1:18790/v1/audio/transcriptions/' });
    await S.transcribe(new Blob(['x']), 'm4a', 'en');
    eq(calls.fetch[0].url, 'http://127.0.0.1:18790/v1/audio/transcriptions/');
  });

  test('failures carry their names: no_base / no_key before any network, http / empty after', async () => {
    const a = setup();
    a.S.configure({ engineId: 'local', baseUrl: '' });
    try { await a.S.transcribe(blob(), 'm4a', 'en'); ok(false); } catch (e) { eq(e.code, 'no_base'); }
    eq(a.calls.fetch.length, 0, '配置不全就不许发请求');
    const b = setup({ fetch: async () => ({ ok: false, status: 401, text: async () => '' }) });
    b.S.configure({ engineId: 'cloud', apiKey: 'bad' });
    try { await b.S.transcribe(blob(), 'm4a', 'en'); ok(false); }
    catch (e) { eq(e.code, 'http'); eq(e.status, 401, '状态码要随错误存活（学 rejects 的教训）'); }
    const c = setup({ fetch: async () => ({ ok: true, status: 200, text: async () => '  ' }) });
    c.S.configure({ engineId: 'cloud', apiKey: 'k' });
    try { await c.S.transcribe(blob(), 'm4a', 'en'); ok(false); }
    catch (e) { eq(e.code, 'empty_transcript'); }
  });
});
