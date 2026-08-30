// test/dashscope-asr.test.js — 通义千问语音转写这条形状的门禁。
//
// 为什么它需要一份自己的判据：这是**第五种**传输形状，也是第一种不走 OpenAI 兼容
// 协议的。它的两个特点都能安静地坏掉：
//
//   · 地址判定靠后缀 `/multimodal-generation/generation`。判错了不会报错 ——
//     会用 multipart 去打一个只收 JSON 的端点，服务端答 400，用户看到的是
//     「转写失败」，而真因是分派错了。
//   · 音频以 data URI 内联。厂商示例写的是 `{YOUR_AUDIO_URL}`，照文档实现会得出
//     「录音必须先上传到公网」的结论；实测（2026-08-30，真 key）它收 base64，
//     返回 200 与正确转写。这条判据把那次实测钉住，免得有人照文档「修」回去。
const { describe, test, ok, eq } = require('./harness');
const WF = require('../extension/content/wire-format.js');
const STT = require('../build/stt.config.js');

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

describe('通义千问语音转写 — 形状判定', () => {
  test('DashScope 的多模态端点判成 transcribe-dashscope', () => {
    eq(WF.formatFor(ENDPOINT, 'transcribe-dashscope'), 'transcribe-dashscope');
    // 后缀取最后两段，所以版本段怎么变都不影响
    eq(WF.formatFor('https://x.example/api/v9/services/aigc/multimodal-generation/generation',
      'transcribe-compat'), 'transcribe-dashscope');
  });

  test('家族封闭：它只可能在转写家族里出现', () => {
    // 转写引擎遇到一个对话形状的地址，**留在转写家族**（回落到注册表 type），
    // 绝不会变成 chat-compat —— 那正是「厂商永不参与分派」这条的机械保证。
    eq(WF.formatFor('https://x.example/v1/chat/completions', 'transcribe-dashscope'), 'transcribe-dashscope');
    // 反过来：多模态后缀在对话家族里不生效（那不是它的家族）
    eq(WF.formatFor(ENDPOINT, 'chat-compat'), 'chat-compat');
  });

  test('OpenAI 那条转写路不受影响', () => {
    eq(WF.formatFor('https://x.example/v1/audio/transcriptions', 'transcribe-dashscope'), 'transcribe-compat');
  });
});

describe('通义千问语音转写 — 注册表条目', () => {
  const e = STT.find((x) => x.id === 'qwen_asr');

  test('条目存在，且只登记 china（intl 那侧没验过）', () => {
    ok(e, 'stt.config.js 里没有 qwen_asr');
    eq(e.flavors.join(), 'china');
  });

  test('端点写全（我们不拼接任何东西）且模型名有默认值', () => {
    eq(e.defaultEndpoint, ENDPOINT);
    ok(/\/multimodal-generation\/generation$/.test(e.defaultEndpoint),
      '端点后缀变了，wire-format 的判定规则会跟着失效');
    ok(e.defaultModel, '没有默认模型 —— 用户不填就打不通');
  });

  test('要 Key，也允许填 Key', () => {
    ok(e.needsKey, '这个端点没有 key 一定 401');
    ok(e.supportsKey, 'needsKey 却不 supportsKey ⇒ 设置页会把输入框藏起来');
  });

  test('它的默认端点必须与 wire-format 的判定自洽', () => {
    // 这一条是两份文件之间的锁：改了任一边而没改另一边，这里红。
    eq(WF.formatFor(e.defaultEndpoint, e.type), 'transcribe-dashscope');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const vm = require('vm');
function loadRequestShape() {
  const fs = require('fs');
  // 真实的扩展页（options / review / content script / App 的 WKWebView）都有 atob。
  // 不给的话判据跑在一个我们并不出货的宿主上，红了也说明不了问题 —— 第一版就是
  // 这样红的，错误还是一句没有 code 的裸 ReferenceError。
  const ctx = {
    window: { WireFormat: WF }, WireFormat: WF, console, setTimeout, clearTimeout,
    atob: (b64) => Buffer.from(b64, 'base64').toString('latin1'),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'extension/content/request-shape.js'), 'utf8'), ctx);
  return ctx.window.RequestShape;
}
const TTS = require('../build/tts.config.js');

describe('通义千问语音合成 — 同一地址，靠家族分开', () => {
  const e = TTS.find((x) => x.id === 'qwen_tts');

  test('条目存在，型号是 HTTP 能用的那个', () => {
    ok(e, 'tts.config.js 里没有 qwen_tts');
    // 厂商页主推的 qwen-audio-3.0-tts-flash 是 WebSocket 专属，在这个 HTTP 端点上
    // 答「url error」。钉住型号，免得有人照那一页「修」成主推型号而整条路失效。
    eq(e.defaultModel, 'qwen-tts');
    eq(e.flavors.join(), 'china');
  });

  test('音色表与服务端报的一致（它自己列出了允许值）', () => {
    // 给一个不存在的音色，服务端回：
    //   Input should be 'Cherry', 'Serena', 'Ethan' or 'Chelsie'
    eq(e.voices.join(','), 'Cherry,Serena,Ethan,Chelsie');
  });

  test('同一个 URL：朗读引擎判成语音，转写引擎判成转写', () => {
    eq(WF.formatFor(e.defaultEndpoint, e.type), 'speech-dashscope');
    eq(WF.formatFor(e.defaultEndpoint, 'transcribe-dashscope'), 'transcribe-dashscope');
  });

  test('回包里的音频地址必须被升成 https —— 否则安全上下文里取不到', () => {
    const RS = loadRequestShape();
    const req = RS.build('speech-dashscope', { url: e.defaultEndpoint, apiKey: 'k', model: e.defaultModel, input: '你好', voice: 'Cherry' });
    ok(typeof req.audioUrlFrom === 'function', 'speech-dashscope 必须声明第二步');
    const got = req.audioUrlFrom({ output: { audio: { url: 'http://x.oss.example/a.wav' } } });
    eq(got, 'https://x.oss.example/a.wav',
      '服务端回的是 http://，扩展页是安全上下文 —— 不升级会被混合内容策略静默挡掉，'
      + '而这一条在 Node 里测不出来（那边没有该策略）');
    eq(req.audioUrlFrom({ output: {} }), '', '拿不到地址时要回空串，让调用方报 empty_audio');
  });
});

describe('会出声的对话模型 — 与专用 TTS 的差别要被判据看住', () => {
  const e = TTS.find((x) => x.id === 'openrouter_audio');

  test('条目存在，只发国际版（地址与型号名都带品牌）', () => {
    ok(e, 'tts.config.js 里没有 openrouter_audio');
    eq(e.flavors.join(), 'global');
  });

  test('请求体必须 stream:true 且 format 为 pcm16', () => {
    const RS = loadRequestShape();
    const req = RS.build('speech-audio-chat', { url: e.defaultEndpoint, apiKey: 'k', model: e.defaultModel, input: '你好', voice: 'alloy' });
    // 不加 stream 会被上游拒：「Audio output requires stream: true」
    eq(req.body.stream, true);
    // 流式下只接受 pcm16：「does not support 'wav' when stream=true」
    eq(req.body.audio.format, 'pcm16');
    ok(req.body.modalities.includes('audio'), '没声明 audio 模态就不会有声音');
    ok(typeof req.parseAudioStream === 'function', '这条路必须自带流解析');
  });

  test('裸 PCM 要被补成 WAV —— pcm16 没有容器，直接播是噪声', () => {
    const RS = loadRequestShape();
    const req = RS.build('speech-audio-chat', { url: e.defaultEndpoint, apiKey: 'k', model: e.defaultModel, input: 'hello world', voice: 'alloy' });
    const pcm = Buffer.alloc(4800, 1).toString('base64');       // 0.1s @24kHz
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { audio: { data: pcm, transcript: 'hello world' } } }] }) + '\ndata: [DONE]\n';
    const got = req.parseAudioStream(sse);
    const b = Buffer.from(got.buf);
    eq(b.slice(0, 4).toString('latin1'), 'RIFF');
    eq(b.slice(8, 12).toString('latin1'), 'WAVE');
    eq(b.readUInt32LE(24), 24000, '采样率必须是 24000 —— 写错会让语速明显不对');
    eq(got.type, 'audio/wav');
  });

  test('它没照着念要报出来 —— 专用 TTS 不会有这个问题，对话模型会', () => {
    const RS = loadRequestShape();
    const req = RS.build('speech-audio-chat', { url: e.defaultEndpoint, apiKey: 'k', model: e.defaultModel,
      input: '请把这一整段很长的原文一字不差地念出来，它有很多很多字', voice: 'alloy' });
    const pcm = Buffer.alloc(2400, 1).toString('base64');
    // 模型答了句别的（拒绝/评论），而不是念原文
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { audio: { data: pcm, transcript: '好的' } } }] }) + '\n';
    let code = '';
    try { req.parseAudioStream(sse); } catch (err) { code = err.code; }
    eq(code, 'spoken_mismatch', '念的内容与原文量级不符时必须失败，而不是播一句不相干的话');
  });

  test('一片音频都没有时报 empty_audio，而不是产出一个空 WAV', () => {
    const RS = loadRequestShape();
    const req = RS.build('speech-audio-chat', { url: e.defaultEndpoint, apiKey: 'k', model: e.defaultModel, input: 'x', voice: 'alloy' });
    let code = '';
    try { req.parseAudioStream('data: {"choices":[{"delta":{"content":"hi"}}]}\n'); } catch (err) { code = err.code; }
    eq(code, 'empty_audio');
  });
});
