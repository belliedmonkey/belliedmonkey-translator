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
    // base URL, and the hint names the interface, never a vendor.
    id: 'local', type: 'transcribe-compat', flavors: ['global', 'china'],
    needsKey: false, supportsBaseUrl: true, supportsModel: true, requiresBaseUrl: true,
    defaultBase: null, path: '/v1/audio/transcriptions', defaultModel: '',
    labelKey: 'stt_engine_local', label: '本地 / 自建转写端点',
    hintKey: 'stt_hint',
  },
  {
    // GLOBAL ONLY: label and defaultBase carry a brand the China bundle may not
    // ship; `flavors` keeps it out and the compliance gate enforces that.
    id: 'openai_transcribe', type: 'transcribe-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresBaseUrl: false,
    defaultBase: 'https://api.openai.com', path: '/v1/audio/transcriptions',
    defaultModel: 'whisper-1',
    labelKey: null, label: 'OpenAI Transcribe',
    hintKey: 'stt_hint',
  },
];
