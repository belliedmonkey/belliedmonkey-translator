// content/stt-state.js — 「整段录音去哪儿、去得了吗」的**唯一**判据（learning-design §9.4，2026-09-17）。
//
// 转写引擎那四个键（sttEngine / sttApiKey / sttBaseUrl / sttModel）只服务一种能力：把一段**整体**
// 录音送到用户自选的端点转写一次 —— 说题（learn/speech-input.js）、扩展端整段字幕
// （content/asr-source.js）、弹窗那一行的状态（popup/asr-entry.js）。2026-09-17 之前它还兼着
// App 对话 · 实时字幕的「实时引擎」，于是「配好了没有」在五处各算一遍、对同一份存储给出不同答案
// （domain-design §7 / learning-design §9.6 门控 2026-09-17 修订记的就是这件事）。实时转写固定为
// 设备内置之后，这个问题只剩文件档一种，而三处消费者仍各自算 —— 差别很小（一处看
// requiresEndpoint，一处看 defaultEndpoint，一处把三种原因并成一种），小到没人会发现它们
// 什么时候开始不一致。所以收成这一份，形状仿 content/engine-state.js。
//
// 纯函数：不碰 DOM、不读存储；注册表默认读 window.MT_STT_ENGINES，也可以注入（弹窗与单测）。
// 这里**不**回答「App 的对话能不能开」—— 那由 NativeSpeech.probe 回答，与这四个键无关。

var SttState = (() => {
  'use strict';

  const KEYS = ['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel'];
  const list = (engines) => (Array.isArray(engines) ? engines : ((typeof window !== 'undefined' && window.MT_STT_ENGINES) || []));

  function byId(id, engines) { return list(engines).find((e) => e && e.id === id) || null; }

  // fileReady(settings[, engines]) → { ok, reason, eng, apiKey, baseUrl, model }
  //   reason ∈ '' | 'no_engine' | 'no_base' | 'no_key'  —— 与 LearnSpeech / EngineTest 的失败键族同名，
  //   界面文案逐一对应（§9.1 reason 惯例）。
  //   no_base：条目要求用户填端点却没填，或既没填也没有注册表默认端点（两种写法在今天的注册表上
  //   等价，但只在这里写一次才永远等价）。
  function fileReady(settings, engines) {
    const s = settings || {};
    const eng = byId(s.sttEngine, engines);
    if (!eng) return { ok: false, reason: 'no_engine', eng: null };
    const baseUrl = String(s.sttBaseUrl || '');
    if ((eng.requiresEndpoint && !baseUrl) || !(baseUrl || eng.defaultEndpoint)) return { ok: false, reason: 'no_base', eng };
    if (eng.needsKey && !s.sttApiKey) return { ok: false, reason: 'no_key', eng };
    return { ok: true, reason: '', eng, apiKey: s.sttApiKey || '', baseUrl, model: s.sttModel || eng.defaultModel || '' };
  }

  return { KEYS, byId, fileReady };
})();

if (typeof window !== 'undefined') window.SttState = SttState;
if (typeof module !== 'undefined' && module.exports) module.exports = SttState;
