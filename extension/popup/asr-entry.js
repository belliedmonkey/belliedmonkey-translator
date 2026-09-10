// popup/asr-entry.js — 弹窗「🎙 实时转写 + 翻译」那一行的**状态判定**（纯逻辑，可单测；
// interaction-spec「AI 转写字幕 › Offer」五态表，2026-09-11）。
//
// 此前那一行只在「页面媒体 ≥ 30 s」时出现，否则整节 hidden —— 元数据没到、播放器在 shadow root
// 或 iframe 里，用户看到的都是「什么都没有」。现在那一行常显，只是副行说的话不同。
//
// 判定顺序即优先级：没有内容脚本 › 没配引擎 › 引擎没有实时接口 › 有媒体 › 只有 iframe 里有 › 没找到。
'use strict';

var AsrEntry = (() => {
  function engineOf(settings, engines) {
    const id = settings && settings.sttEngine;
    return (engines || []).find((e) => e && e.id === id) || null;
  }
  // state({ pageStatus, settings, engines }) → { kind, engine, label, hint, media, frames }
  //   kind ∈ 'no_script' | 'no_engine' | 'file_only' | 'ready' | 'no_media' | 'iframe_only'
  function state(o) {
    const ps = o && o.pageStatus;
    if (!ps) return { kind: 'no_script', engine: null, media: null, frames: [] };
    const eng = engineOf(o.settings, o.engines);
    const s = o.settings || {};
    const media = ps.media || null;
    const frames = Array.isArray(ps.frames) ? ps.frames.filter((f) => f && f.href) : [];
    const base = { engine: eng, media, frames };
    if (!eng || (eng.needsKey && !s.sttApiKey) || (eng.requiresEndpoint && !s.sttBaseUrl)) return Object.assign({ kind: 'no_engine' }, base);
    const live = !!(eng.liveEndpoint && eng.liveType);
    if (media) return Object.assign({ kind: live ? 'ready' : 'file_only' }, base);
    if (frames.length) return Object.assign({ kind: 'iframe_only' }, base);
    return Object.assign({ kind: 'no_media' }, base);
  }
  // 副行的时长文案：直播 / mm:ss / 时长未知。t(key, fallback) 由宿主给。
  function durationText(media, t) {
    if (!media) return '';
    if (media.live) return t('popup_asr_live', '直播');
    if (media.durationS > 0) return Math.floor(media.durationS / 60) + ':' + String(Math.round(media.durationS % 60)).padStart(2, '0');
    return t('popup_asr_unknown_dur', '时长未知');
  }
  return { state, durationText, engineOf };
})();

if (typeof window !== 'undefined') window.AsrEntry = AsrEntry;
if (typeof module !== 'undefined' && module.exports) module.exports = AsrEntry;
