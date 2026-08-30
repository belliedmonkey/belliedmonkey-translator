// build/tts.config.js — SINGLE SOURCE OF TRUTH for speech (TTS) engines.
//
// Consumed at BUILD time by build.js, which writes extension/content/tts.gen.js
// (`window.MT_TTS_ENGINES`). The runtime (learn/tts.js, options.js) reads only that
// generated file — never this one.
//
// This is a SEPARATE registry from build/providers.config.js on purpose: that one is
// the registry of *translation* providers (docs/domain-design.md §7), and speech is a
// different capability. Folding them together would grow every translation entry a
// set of fields it never uses. The three rules are the same in both:
//   · transport is keyed by request FORMAT, never by vendor
//   · the registry is the only place an engine, model, voice or endpoint is written
//     down — never restate them in docs, UI strings or code comments
//   · region/flavor never enters at runtime
//
// Ordered LOCAL-FIRST, and the UI renders them in this order: the zero-config
// on-device engine, then a self-hosted endpoint, then a cloud one. That ordering is
// the 本地优先 principle made visible rather than merely stated.
//
// Field notes:
//   type            'browser'       — the platform's own speechSynthesis. No network,
//                                     no key, works offline. CANNOT return audio data:
//                                     the Web Speech API only speaks, so nothing from
//                                     this engine can ever be cached or uploaded.
//                   'speech-compat' — the OpenAI /v1/audio/speech request shape
//                                     ({model, input, voice, response_format} → audio
//                                     bytes). This is the de-facto shape local TTS
//                                     servers implement, so ONE format covers both
//                                     self-hosted and cloud.
//   defaultEndpoint string | null. The COMPLETE request URL, path included — never an
//                   origin to append to (domain-design §7 zero-concatenation).
//                   null + requiresEndpoint ⇒ the user supplies the whole address.
//   placeholder     string | null. Example address for the empty input; only meaningful
//                   when defaultEndpoint is null. Endpoints live in the registry, never
//                   in UI copy, so the hint text can stop naming a path.
//   voices          string[] | null. null ⇒ voices are discovered at runtime
//                   (browser) or free-form (self-hosted).
//   returnsAudio    whether this engine yields bytes we can cache locally and,
//                   if the user opts in, sync. False for 'browser', permanently.

module.exports = [
  {
    id: 'browser', type: 'browser', flavors: ['global', 'china'],
    needsKey: false, supportsBaseUrl: false, supportsModel: false, requiresEndpoint: false,
    // The system voice engine speaks no HTTP at all. Explicitly null, not absent.
    defaultEndpoint: null, placeholder: null, defaultModel: '', voices: null,
    returnsAudio: false,
    labelKey: 'tts_engine_browser', label: '设备内置语音（免费 · 离线）',
    hintKey: 'tts_hint_browser',
  },
  {
    // Any server implementing the /v1/audio/speech request shape on the user's own
    // machine or LAN. Brand-free by design — the user supplies the complete endpoint
    // URL, and the placeholder below is what tells them its shape (the hint copy used
    // to name the path itself, which put an endpoint in eleven translated strings).
    id: 'local', type: 'speech-compat', flavors: ['global', 'china'],
    // 同 stt.config.js 的 local：needsKey=false 是「不强制」，不是「不支持」。
    needsKey: false, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: true,
    defaultEndpoint: null, placeholder: 'http://127.0.0.1:8880/v1/audio/speech',
    defaultModel: '', voices: null,
    returnsAudio: true,
    labelKey: 'tts_engine_local', label: '本地 / 自建语音端点',
    hintKey: 'tts_hint_local',
  },
  {
    // 通义千问的语音合成。与 stt.config.js 的 qwen_asr **同一个地址**，靠家族区分。
    //
    // 两件只能靠打出来的事（2026-08-30，真 key）：
    //   · 型号要用 `qwen-tts`。厂商页上主推的 `qwen-audio-3.0-tts-flash` 是
    //     **WebSocket 专属**（只给 Python SDK 示例，wss://…/api-ws/v1/inference），
    //     在这个 HTTP 端点上答「url error」。我先按那一页下过「朗读不可行」的结论，
    //     是把同族的 qwen-tts 打一遍才推翻的。
    //   · 回包给的是**音频 URL**不是字节，且要不到内联 base64。取那个 URL 可行，
    //     因为扩展的 host_permissions 是 <all_urls>（那个 OSS 地址没有 CORS 头）。
    //
    // voices 是**服务端自己报出来的**：给一个不存在的音色，它回
    // 「Input should be 'Cherry', 'Serena', 'Ethan' or 'Chelsie'」。
    // 只登记 china：手上的 key 是境内的，intl 那侧没验过。
    id: 'qwen_tts', type: 'speech-dashscope', flavors: ['china'],
    needsKey: true, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    placeholder: null, defaultModel: 'qwen-tts',
    voices: ['Cherry', 'Serena', 'Ethan', 'Chelsie'],
    returnsAudio: true,
    labelKey: null, label: '通义千问 · 语音合成',
    hintKey: 'tts_hint_local',
  },
  {
    // 「会出声的对话模型」这条路。GLOBAL ONLY —— 地址与型号名都带品牌，中国版不发。
    //
    // 我先前判过「这个网关没有可用的 TTS」，那是**拿它去打 /audio/speech** 得到的
    // 结论（所有候选模型都答 does not exist）。这个型号根本不在那条路上：它是带音频
    // 输出模态的对话模型，走 /chat/completions。同一个错误犯了三次（ASR、qwen-tts、
    // 这个）—— 读页面下结论，而不是把该打的那条路打一遍。
    //
    // voices 是**服务端自己报的**：给一个不存在的音色，它列出全部 13 个允许值。
    id: 'openrouter_audio', type: 'speech-audio-chat', flavors: ['global'],
    needsKey: true, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    placeholder: null, defaultModel: 'openai/gpt-audio-mini',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral',
      'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar'],
    returnsAudio: true,
    labelKey: null, label: 'OpenRouter · audio model',
    hintKey: 'tts_hint_local',
  },
  {
    // GLOBAL ONLY. Its label, defaultEndpoint and hint key all carry a brand the China
    // bundle may not ship; `flavors` is what keeps it out. Without this field the
    // China compliance gate fails the build — which is how the omission was caught.
    id: 'openai_speech', type: 'speech-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://api.openai.com/v1/audio/speech', placeholder: null,
    defaultModel: 'gpt-4o-mini-tts',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
    returnsAudio: true,
    labelKey: null, label: 'OpenAI Speech',
    hintKey: 'tts_hint_openai',
  },
];
