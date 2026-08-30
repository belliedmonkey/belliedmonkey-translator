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
// There is NO zero-config engine here and there never will be one: the browser's
// own SpeechRecognition ships recordings to its vendor's servers, which the
// no-telemetry promise cannot absorb (learning-design §12 — permanently rejected).
// An empty `sttEngine` therefore means the 说 exercise DOES NOT EXIST (§5.4
// capability semantics), which is the correct default.
//
// One format covers the whole space:
//   type 'transcribe-compat' — the OpenAI /v1/audio/transcriptions multipart shape
//   (file + model [+ language] → {text}), which is also what self-hosted whisper
//   servers implement. One format therefore covers both "my own machine" and
//   "a cloud key" — exactly what 本地优先 needs.

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
    // GLOBAL ONLY: label and defaultEndpoint carry a brand the China bundle may not
    // ship; `flavors` keeps it out and the compliance gate enforces that.
    id: 'openai_transcribe', type: 'transcribe-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: false,
    defaultEndpoint: 'https://api.openai.com/v1/audio/transcriptions', placeholder: null,
    defaultModel: 'whisper-1',
    labelKey: null, label: 'OpenAI Transcribe',
    hintKey: 'stt_hint',
  },
];
