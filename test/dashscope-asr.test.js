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
