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
    // 聚合网关的**专用** TTS。走已有的 speech-compat 形状，不需要新传输 —— 这是它
    // 比同网关的「会出声的对话模型」（openrouter_audio）更该作为默认的原因：更便宜、
    // 不会不照着念、音色自带语种。
    //
    // 我一度判定这个网关「没有可用 TTS」，因为我只拿一个厂商的模型名去打 /audio/speech，
    // 全部答 does not exist。换个厂商名就通了 —— 服务端答的是「Unknown voice」而不是
    // 「Model does not exist」，那是两个完全不同的结论。
    //
    // ⚠️ 它声明 `Content-Type: audio/pcm;rate=24000`，而 body 是 RIFF（WAV）。
    // tts.js 的 sniffAudioType() 按魔数纠正；照声明存会让播放**一声不响地不出声**。
    //
    // voices 是**服务端自己列出来的**全部 90 个（给一个不存在的音色，它把允许值全列了）。
    // 后缀就是语种：-en 41 · -es 17 · -nl 9 · -it 9 · -de 7 · -ja 5 · -fr 2。
    // **没有中文音色** —— 读中文的人要用 openrouter_audio 或设备内置语音。
    id: 'openrouter_speech', type: 'speech-compat', flavors: ['global'],
    needsKey: true, supportsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://openrouter.ai/api/v1/audio/speech', placeholder: null,
    defaultModel: 'deepgram/aura-2',
    voices: [
      'aura-2-thalia-en', 'aura-2-amalthea-en', 'aura-2-andromeda-en', 'aura-2-apollo-en',
      'aura-2-arcas-en', 'aura-2-aries-en', 'aura-2-asteria-en', 'aura-2-athena-en',
      'aura-2-atlas-en', 'aura-2-aurora-en', 'aura-2-callista-en', 'aura-2-cora-en',
      'aura-2-cordelia-en', 'aura-2-delia-en', 'aura-2-draco-en', 'aura-2-electra-en',
      'aura-2-harmonia-en', 'aura-2-helena-en', 'aura-2-hera-en', 'aura-2-hermes-en',
      'aura-2-hyperion-en', 'aura-2-iris-en', 'aura-2-janus-en', 'aura-2-juno-en',
      'aura-2-jupiter-en', 'aura-2-luna-en', 'aura-2-mars-en', 'aura-2-minerva-en',
      'aura-2-neptune-en', 'aura-2-odysseus-en', 'aura-2-ophelia-en', 'aura-2-orion-en',
      'aura-2-orpheus-en', 'aura-2-pandora-en', 'aura-2-phoebe-en', 'aura-2-pluto-en',
      'aura-2-saturn-en', 'aura-2-selene-en', 'aura-2-theia-en', 'aura-2-vesta-en',
      'aura-2-zeus-en', 'aura-2-ama-ja', 'aura-2-ebisu-ja', 'aura-2-fujin-ja',
      'aura-2-izanami-ja', 'aura-2-uzume-ja', 'aura-2-aurelia-de', 'aura-2-elara-de',
      'aura-2-fabian-de', 'aura-2-julius-de', 'aura-2-kara-de', 'aura-2-lara-de',
      'aura-2-viktoria-de', 'aura-2-agathe-fr', 'aura-2-hector-fr', 'aura-2-agustina-es',
      'aura-2-alvaro-es', 'aura-2-antonia-es', 'aura-2-aquila-es', 'aura-2-carina-es',
      'aura-2-celeste-es', 'aura-2-diana-es', 'aura-2-estrella-es', 'aura-2-gloria-es',
      'aura-2-javier-es', 'aura-2-luciano-es', 'aura-2-nestor-es', 'aura-2-olivia-es',
      'aura-2-selena-es', 'aura-2-silvia-es', 'aura-2-sirio-es', 'aura-2-valerio-es',
      'aura-2-cesare-it', 'aura-2-cinzia-it', 'aura-2-demetra-it', 'aura-2-dionisio-it',
      'aura-2-elio-it', 'aura-2-flavio-it', 'aura-2-livia-it', 'aura-2-maia-it',
      'aura-2-melia-it', 'aura-2-beatrix-nl', 'aura-2-cornelia-nl', 'aura-2-daphne-nl',
      'aura-2-hestia-nl', 'aura-2-lars-nl', 'aura-2-leda-nl', 'aura-2-rhea-nl',
      'aura-2-roman-nl', 'aura-2-sander-nl'
    ],
    returnsAudio: true,
    labelKey: null, label: 'OpenRouter · speech',
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
