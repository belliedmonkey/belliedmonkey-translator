// media-finder.js — 「这一页有哪些 <audio>/<video>」的**唯一**实现（domain-design §2.4 规则 1，
// 2026-09-11 修订）。四个字幕后端与弹窗的 getPageStatus 此前各自 `querySelectorAll('audio, video')`，
// 都只看顶层 light DOM —— web-component 播放器（<media-player>、Vidstack、Reddit）把 <video>
// 放在 open shadow root 里，文本层（dom-processor.js walkRoot）早就会进去，媒体层从没进去过。
// 用户报的「明明有视频却什么都没有」，一半来自这里。
//
// 规则：
//   · all()：document + 递归每个 open shadow root；1 s TTL 记忆化（250 ms tick 反复全页遍历不值）。
//   · pick()：正在播放且 currentTime>0 › 直播（duration===Infinity）› 有限时长最长 › 元数据未到 › 第一个。
//   · describe()：给弹窗的一行副文用（时长 / 直播 / 就绪 / 源类型），不含 URL。
//   · whenMeta()：点「转写」时等一次 loadedmetadata（≤ ms），元数据未到的元素也算媒体，只是等它一拍。
// 不碰 iframe：那是 media-probe.js 的事（只上报，不启动）。
'use strict';

var MediaFinder = (() => {
  const TTL_MS = 1000;
  let cache = { at: 0, list: [] };

  function walk(root, out, depth) {
    if (!root || depth > 12) return;
    let els;
    try { els = root.querySelectorAll('audio, video, *'); } catch (_) { return; }
    for (const el of els) {
      const tag = el.tagName;
      if (tag === 'AUDIO' || tag === 'VIDEO') out.push(el);
      if (el.shadowRoot && el.shadowRoot.mode === 'open') walk(el.shadowRoot, out, depth + 1);
    }
  }
  function all(force) {
    const now = Date.now();
    if (!force && now - cache.at < TTL_MS) return cache.list;
    const out = [];
    walk(document, out, 0);
    cache = { at: now, list: out };
    return out;
  }
  function isLive(el) { return el.duration === Infinity; }
  function finiteDur(el) { return isFinite(el.duration) && el.duration > 0 ? el.duration : 0; }
  function pick(list) {
    const els = (list || all()).filter((e) => e && e.isConnected !== false);
    if (!els.length) return null;
    return els.find((e) => !e.paused && e.currentTime > 0)
      || els.find(isLive)
      || els.slice().sort((a, b) => finiteDur(b) - finiteDur(a)).find((e) => finiteDur(e) > 0)
      || els.find((e) => !(e.readyState >= 1))
      || els[0];
  }
  function describe(el) {
    if (!el) return null;
    const src = el.currentSrc || el.src || '';
    const srcKind = /^blob:/i.test(src) ? 'blob' : (/\.(m3u8|mpd)(\?|#|$)/i.test(src) ? 'manifest' : (/^https?:/i.test(src) ? 'http' : ''));
    return { durationS: Math.round(finiteDur(el)), live: isLive(el), ready: el.readyState >= 1, playing: !el.paused && el.currentTime > 0, srcKind, tag: el.tagName.toLowerCase() };
  }
  // 元数据未到（duration NaN）时等一拍；超时也算落定（用有什么算什么）。
  function whenMeta(el, ms) {
    if (!el || el.readyState >= 1) return Promise.resolve(el);
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; try { el.removeEventListener('loadedmetadata', fin); } catch (_) {} resolve(el); };
      try { el.addEventListener('loadedmetadata', fin, { once: true }); } catch (_) {}
      setTimeout(fin, ms || 3000);
    });
  }
  function invalidate() { cache = { at: 0, list: [] }; }

  return { all, pick, describe, whenMeta, invalidate, TTL_MS };
})();

if (typeof window !== 'undefined') window.MediaFinder = MediaFinder;
if (typeof module !== 'undefined' && module.exports) module.exports = MediaFinder;
