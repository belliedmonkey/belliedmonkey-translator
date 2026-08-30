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
