// media-probe.js — iframe 里的**轻量探针**（domain-design §2.4 规则 1，2026-09-11）。
//
// 只在子 frame 里活。顶层 getPageStatus 时向所有 frame 广播 {type:'mt-media-probe'}；探针回报
// 本 frame 里有没有媒体（时长 / 直播 / 在放 / 本 frame 的 href），并把请求转发给自己的子 frame
// （它们直接回给 window.top）。**只上报，永不启动会话**：字幕栈仍只在顶层 frame。
// 为什么不给 <all_urls> 那块加 all_frames：每个广告 iframe 都会加载 ~25 个文件。
// href 只用于弹窗的「在新标签页打开播放器」，不进遥测（规则 4：不带 URL）。
'use strict';
(() => {
  if (window.top === window) return;
  const PROBE = 'mt-media-probe', REPORT = 'mt-media-report';
  function media() {
    let best = null;
    try {
      for (const el of document.querySelectorAll('audio, video')) {
        const d = { durationS: isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : 0, live: el.duration === Infinity, playing: !el.paused && el.currentTime > 0 };
        if (!best || d.playing && !best.playing || d.live && !best.live || d.durationS > best.durationS) best = d;
      }
    } catch (_) {}
    return best;
  }
  window.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (!d || d.type !== PROBE) return;
    const m = media();
    if (m) { try { window.top.postMessage({ type: REPORT, id: d.id, href: location.href, media: m }, '*'); } catch (_) {} }
    // 再往下一层转发；子 frame 直接回给 top。
    try { for (let i = 0; i < window.frames.length; i++) window.frames[i].postMessage(d, '*'); } catch (_) {}
  });
})();
