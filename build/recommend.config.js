// build/recommend.config.js — 「这件事用哪个模型」的推荐单，按优先级分轴。
//
// ── 它与另外两张表的分工 ──────────────────────────────────────────────────
//
//   build/perf-ledger.config.js    **证据**：打过什么、结果如何、哪天打的
//   build/model-params.config.js   **结论**：这个端点这个模型该发哪些字段
//   build/recommend.config.js      **建议**：同一件事有多个能用的模型时，选哪个
//
// 前两张是「能不能用」和「怎么用对」，这一张是「用哪个更好」。三张分开，是因为
// 它们过期的速度不一样：证据永不过期（带日期），结论随厂商改协议而变，而建议随
// 新模型出现而变得最快。混在一起，最快过期的那一份会把另外两份也拖下水。
//
// ── 每一条推荐都必须有据 ──────────────────────────────────────────────────
//
// test/recommend.test.js 会拦：
//   · 推荐的 (host, model) 必须在台账里，且不是 unreachable —— 我们不推荐一个
//     自己都没打通过的东西
//   · basis 声明这条建议**基于什么**，而它决定了需要什么证据：
//       'latency'  必须能在台账或探针记录里找到耗时
//       'cost'     必须有实测单次成本
//       'default'  必须真的是注册表里的 defaultModel
//       'judgment' 允许没有测量，但 why 里必须自己说清「这是判断不是测量」
//
// ── 关于「效果优先」这一轴 ────────────────────────────────────────────────
//
// **我们没有做过翻译质量评测。** 没有评测集、没有人工打分、没有 A/B。所以
// quality 轴上的每一条 basis 都是 'judgment'，why 里必须写明依据是厂商定位或
// 模型规模，而不是我们的测量。把厂商定位包装成「实测最佳」是这份文件最该防的事 ——
// 其余三轴的价值恰恰来自它们是量出来的。
//
// 要把 quality 变成可测的，需要的东西写在 docs/verification-spec.md 的待办里：
// 一个固定的评测集（同一批段落 × 多语言）+ 一个可复现的判分方式。
'use strict';

const AXES = {
  fast: '速度优先 —— 按实测墙钟时间选（同一段 870 字正文，每项两遍）',
  cheap: '便宜优先 —— 按实测单次成本选',
  default: '默认 —— 注册表里出货的那个，兼顾速度、稳定与「不用配就能用」',
  quality: '效果优先 —— **未做质量评测**，依据是厂商定位/模型规模，不是我们的测量',
};

const PICKS = [
  // ─────────────────────────────── OpenRouter（国际版）
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'chat', axis: 'default',
    model: 'google/gemini-3.7-flash', basis: 'default',
    why: '注册表的 defaultModel。选它而不是更便宜的 flash-lite，是因为 model-params 里有为它准备的降档行（openrouter-thinking）—— 换一个没有对应行的模型，用户会安静地拿到最慢那一档。实测降档后 2.9–3.3 秒 / 思考 0。',
  },
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'chat', axis: 'cheap',
    model: 'google/gemini-3.1-flash-lite', basis: 'cost',
    why: '能力探针实测单次 $0.0000065、573ms —— 目录里最便宜的可用文本模型之一。**注意它不在 openrouter-thinking 行的前缀里**，所以不发降档参数；探针那次没观察到它思考，但没做过长正文的参数实测。',
  },
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'chat', axis: 'quality',
    model: 'openai/gpt-5-mini', basis: 'judgment',
    why: '**这是判断不是测量** —— 我们没有质量评测。依据是它在台账里有完整的参数实测（reasoning:{effort:low}，基线 9146ms/704tok → 4255ms/192tok），且属于厂商的推理系列。想要更强就换更大的型号，代价是更慢更贵。',
  },
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'transcribe', axis: 'default',
    model: 'openai/gpt-4o-mini-transcribe', basis: 'default',
    why: '注册表的 defaultModel。实测（系统语音念「The quick brown fox…」）逐字转对，600–730ms、单次 $0.000035。',
  },
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'transcribe', axis: 'cheap',
    model: 'openai/whisper-large-v3', basis: 'cost',
    why: '单次 $0.0000064，比默认便宜 5 倍。**代价看得见**：同一段音频它把 The 听成了 a（返回 " a quick brown."），而默认那个逐字转对。转写要喂给「说」这一档评分，错一个词就是错一分 —— 便宜在这里不一定划算。',
  },
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'speech', axis: 'default',
    model: 'deepgram/aura-2', basis: 'default',
    why: '注册表的 defaultModel，走已有的 speech-compat 形状。真宿主实测 1.8–2.6 秒、浏览器解码出 2.5–2.7 秒音频。90 个音色带语种后缀（en/es/nl/it/de/ja/fr）。**没有中文音色** —— 读中文要用下面那条或设备内置语音。',
  },
  {
    platform: 'openrouter', host: 'openrouter.ai', capability: 'speech', axis: 'quality',
    model: 'openai/gpt-audio-mini', basis: 'judgment',
    why: '**判断不是测量**。它是「带音频输出的对话模型」而不是专用 TTS：能念任何语言（含中文，aura-2 做不到），但也可能不照着念 —— 传输层为此加了 transcript 核对。真宿主实测 1.4 秒 / 290KB / 解码 6.05 秒。',
  },

  // ─────────────────────────────── 千问AI平台（中国版）
  {
    platform: 'qianwen', host: 'dashscope.aliyuncs.com', capability: 'chat', axis: 'default',
    model: 'qwen-plus', basis: 'default',
    why: '注册表的 defaultModel。能力探针实测 368ms / 33 出参 tok，本来就不思考。',
  },
  {
    platform: 'qianwen', host: 'dashscope.aliyuncs.com', capability: 'chat', axis: 'fast',
    model: 'qwen-mt-turbo', basis: 'latency',
    why: '实测 268ms / 37 tok，这批里最快。翻译专用模型：它**不收 system 消息**（用普通对话形状打过去会被拒「Role must be in [user, assistant]」），所以只有走 wire-format 的模型级形状覆写才用得上 —— 那条覆写就是为它存在的。',
  },
  {
    platform: 'qianwen', host: 'dashscope.aliyuncs.com', capability: 'chat', axis: 'quality',
    model: 'qwen3.8-max', basis: 'judgment',
    why: '**判断不是测量**。依据是厂商把它定位为旗舰。实测 1.9–2.0 秒 / 131 tok（短句），长正文没单独测参数 —— 但它落在 dashscope 通行行里，会收到 enable_thinking:false。',
  },
  {
    platform: 'qianwen', host: 'dashscope.aliyuncs.com', capability: 'transcribe', axis: 'default',
    model: 'qwen-audio-3.0-asr-flash', basis: 'default',
    why: '注册表的 defaultModel，也是这个平台上唯一实测通的转写模型。真宿主实测 351–488ms，wav 与 m4a（iOS Safari 实际产出的容器）都逐字转对。',
  },
  {
    platform: 'qianwen', host: 'dashscope.aliyuncs.com', capability: 'speech', axis: 'default',
    model: 'qwen-tts', basis: 'default',
    why: '注册表的 defaultModel。真宿主实测 2.0 秒 / 149KB / 浏览器解码 3.1 秒。**不要换成厂商主推的 qwen-audio-3.0-tts-flash** —— 那个是 WebSocket 专属，在这个 HTTP 端点上答「url error」。',
  },
];

module.exports = { AXES, PICKS };
