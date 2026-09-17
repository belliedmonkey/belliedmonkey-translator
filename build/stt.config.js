// build/stt.config.js — SINGLE SOURCE OF TRUTH for speech-input (transcription)
// engines. See docs/learning-design.md §9.4.
//
// Consumed at BUILD time by build.js, which writes extension/content/stt.gen.js
// (`window.MT_STT_ENGINES`). The runtime (learn/speech-input.js, options.js,
// app/settings.js) reads only that generated file — never this one.
//
// A THIRD registry, deliberately (same reasoning as build/tts.config.js): speech
// INPUT is a different capability from speech output and from translation, and
// folding it into either would grow their entries fields they never use. The three
// rules carry over unchanged:
//   · transport is keyed by request FORMAT, never by vendor
//   · the registry is the only place an engine, model or endpoint is written down
//   · region/flavor never enters at runtime
//
// There is NO zero-config CLOUD engine here and there never will be one: the browser's
// own SpeechRecognition ships recordings to its vendor's servers, which the
// no-telemetry promise cannot absorb (learning-design §12 — permanently rejected).
// An empty `sttEngine` therefore means the 说 exercise DOES NOT EXIST (§5.4
// capability semantics), which is the correct default.
// *(2026-09-12 → 09-17:)* for five days this registry carried a `device` entry (the host
// app's on-device recogniser) and two entries carried `live*` fields (cloud streaming
// sockets). Both are gone: live transcription is fixed to the device recogniser and is
// reached through the native bridge, not chosen here (domain-design §2.4 / §7 2026-09-17
// amendments; learning-design §9.4). This registry answers exactly one question again —
// where does a WHOLE recording go — and the registry gate asserts no entry carries a
// `live*` field or a `device-transcribe` type.
//
// One format covers the whole space:
//   type 'transcribe-compat' — the OpenAI /v1/audio/transcriptions multipart shape
//   (file + model [+ language] → {text}), which is also what self-hosted whisper
//   servers implement. One format therefore covers both "my own machine" and
//   "a cloud key" — exactly what 本地优先 needs.

// 免费额度的中继（learning-design §8.10）。地址由 backend.config.js 的 url + relayPath
// 拼出来 —— **主机名在这个仓库里只写一处**，换后端只改那一个字段。
const MT_BACKEND = require('../extension/learn/backend.config.js');
const RELAY = MT_BACKEND.url + MT_BACKEND.grant.relayPath;

module.exports = [
  {
    // Any server implementing the /v1/audio/transcriptions request shape on the
    // user's own machine or LAN. Brand-free by design — the user supplies the
    // complete endpoint URL, and the placeholder below is what tells them its shape.
    // The example port matches scripts/dev-whisper-server.js, so the in-repo bridge
    // is a copy-paste away rather than a number to look up.
    id: 'local', type: 'transcribe-compat', flavors: ['global', 'china'],
    // needsKey=false 是「不强制」，supportsKey=true 是「可以填」—— 两件事。
    // 设置页原先只看 needsKey，于是把「不强制」当成了「不支持」，直接把输入框藏了。
    // 后果：这个条目的定义是「任何实现该请求形状的服务器」，其中云端的那一半**全部
    // 需要鉴权**，而界面上没有地方填 —— 传输层其实一直会带上 Authorization
    // （request-shape.js 那两处 `o.apiKey ? {...} : {}`），只是没人能把值交给它。
    needsKey: false, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: true,
    defaultEndpoint: null, placeholder: 'http://127.0.0.1:18790/v1/audio/transcriptions',
    defaultModel: '',
    labelKey: 'stt_engine_local', label: '本地 / 自建转写端点',
    hintKey: 'stt_hint',
  },
  {
    // 通义千问的语音转写。**不是** OpenAI 那条路：dashscope 的
    // /compatible-mode/v1/audio/transcriptions 实测 404（带 key 也一样），
    // 语音能力挂在自家的多模态生成端点上，请求体是 input.messages + parameters。
    //
    // 厂商示例里 `input_audio.data` 写的是 `{YOUR_AUDIO_URL}`，照着读会得出
    // 「录音必须先传到公网某处」的结论 —— 那会让这条路在浏览器扩展里根本不可行。
    // 实测 2026-08-30（真 key）：它同样收 `data:audio/wav;base64,…`，返回 200 与
    // 正确转写。这一条只能靠打一次得到，读文档得到的是相反的答案。
    //
    // 只登记 china：手上的 key 是境内的，dashscope-intl 那侧没有验过。
    // 用一个没验过的地址去覆盖另一门语言的用户，正是台账要防的事。
    id: 'qwen_asr', type: 'transcribe-dashscope', flavors: ['china'],
    needsKey: true, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    placeholder: null,
    defaultModel: 'qwen-audio-3.0-asr-flash',
    labelKey: null, label: '通义千问 · 语音转写',
    hintKey: 'stt_hint',
  },
  {
    // 聚合网关的转写。走**已有的** transcribe-compat 形状（multipart /audio/transcriptions），
    // 不需要新传输。
    //
    // ⚠️ 这条路上可用的模型**不在网关的公开目录里**：/models 有 396 个模型，这里能用的
    // 一个都不在，而目录里的对话模型在这条路上一律被拒。是 scripts/capability-probe.js
    // 用「打一个不存在的模型名，看服务端怎么答」摸出来的。
    //
    // defaultModel 选 gpt-4o-mini-transcribe：实测（2026-08-30，系统语音念
    // 「The quick brown fox…」）它与 gpt-4o-transcribe 都逐字转对，而 whisper-large-v3
    // 虽然便宜十倍却把 The 听成了 a。转写喂给「说」这一档评分，错一个词就是错一分。
    id: 'openrouter_transcribe', type: 'transcribe-compat', flavors: ['global'],
    needsKey: true, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://openrouter.ai/api/v1/audio/transcriptions', placeholder: null,
    defaultModel: 'openai/gpt-4o-mini-transcribe',
    labelKey: null, label: 'OpenRouter · transcription',
    hintKey: 'stt_hint',
  },
  {
    // GLOBAL ONLY: label and defaultEndpoint carry a brand the China bundle may not
    // ship; `flavors` keeps it out and the compliance gate enforces that.
    id: 'openai_transcribe', type: 'transcribe-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://api.openai.com/v1/audio/transcriptions', placeholder: null,
    defaultModel: 'whisper-1',
    labelKey: null, label: 'OpenAI Transcribe',
    hintKey: 'stt_hint',
  },
  {
    // GLOBAL ONLY（Gemini 在中国大陆不开放）。文件一档走 Interactions 接口：JSON 内联
    // base64 + 词级时间戳（mode 必须是 verbatim —— 实测 smart 与时间戳互斥，服务端原话
    // "Transcription mode SMART is incompatible with timestamps"）。实测 2026-09-06：英文
    // 29.8 分钟 69.4s / WER 2.9%，时间戳与 whisper 参照 p90 差 220ms；中文 19.9 分钟 CER 12.0%。
    // 开时间戳的上限 30 分钟、内联体的上限约 20MB —— 超过走 uploadEndpoint（Files API）。
    id: 'gemini_transcribe', type: 'transcribe-gemini', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions', placeholder: null,
    defaultModel: 'gemini-3.5-transcribe',
    labelKey: null, label: 'Gemini Transcribe (Google)',
    hintKey: 'stt_hint',
    uploadEndpoint: 'https://generativelanguage.googleapis.com/upload/v1beta/files',
  },
  // 免费额度的中继 · 转写档（§8.10）：中继只转发一次性的 /audio/transcriptions，给说题与
  // 整段字幕用。对话 · 实时字幕自 2026-09-17 起走本机识别，不花额度也不经中继。
  {
    id: 'grant_stt', type: 'transcribe-compat', flavors: ['global'], grantOnly: true,
    needsKey: true, supportsKey: true, supportsBaseUrl: false, supportsModel: false,
    requiresEndpoint: false,
    defaultEndpoint: RELAY + '/audio/transcriptions',
    defaultModel: 'openai/whisper-1',
    // **必须是能出时间戳的那个。** gpt-4o-mini-transcribe 便宜约三倍，但它拒绝
    // verbose_json（经中继实测三段音频全 400），而字幕正是靠 segments 拿时间轴 ——
    // 钉它等于这一档只能做「说题」，做不了字幕。这个坑台账里对同族的另一个模型
    // 记过一次，2026-09-09 又在免费额度这一档上撞了第二次。
    // 换模型要**同时**改这里与服务端的 GRANT_MODELS，两处不一致每次请求都撞 403；
    // `npm run grant:status` 会当场点名（它 2026-09-09 真的抓到过一次）。
    label: { global: 'BelliedMonkey 免费额度' },
    labelKey: 'grant_engine_label',
  },
];
