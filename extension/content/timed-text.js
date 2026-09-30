// content/timed-text.js — WebVTT / SRT 时间轴解析的**唯一实现**（domain-design §2.2 / §2.3）。
//
// 三个消费者：播客（content-podcast.js）、X 视频（content-twitter.js）、命令行
// （cli/subtitle.js）。前两者是内容脚本（manifest 里排在本文件之后，读 `window.TimedText`），
// CLI 直接 `require`（module.exports）。在这之前 podcast 与 twitter 各抄了一份同样的
// tcToMs / stripCueTags / parse —— 两份迟早会漂，而漂开的症状是「一种字幕站有字幕、另一种没有」。
'use strict';

var TimedText = (() => {
  // "HH:MM:SS.mmm" / "MM:SS.mmm" / "SS.mmm"，SRT 的逗号毫秒也认。取第一个空格前的时间码
  // （SRT/VTT 时间行后面可能跟 cue 设置）。
  function tcToMs(tc) {
    tc = (tc || '').trim().replace(',', '.').split(' ')[0];
    const p = tc.split(':');
    let h = 0, m = 0, s = 0;
    if (p.length === 3) { h = +p[0]; m = +p[1]; s = parseFloat(p[2]); }
    else if (p.length === 2) { m = +p[0]; s = parseFloat(p[1]); }
    else { s = parseFloat(p[0]); }
    return Math.round(((h * 3600 + m * 60 + s) || 0) * 1000);
  }
  // 去掉 cue 里的标签（X 把每个词包在 `<X-word-ms ...>` 里）与多余空白。
  function stripCueTags(t) { return t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[^\S\n]+/g, ' ').trim(); }

  // parseTimedText(text, { offsetMs, sort })
  //   offsetMs —— X/Twitter 分段 VTT 的叠加偏移，缺省 0
  //   sort     —— 缺省 true（播客 / CLI 要按时间排序）；X 多段拼接时传 false 保持段序
  function parseTimedText(text, opts) {
    const off = (opts && opts.offsetMs) || 0;
    const sort = !(opts && opts.sort === false);
    const out = [];
    for (const b of String(text || '').replace(/\r/g, '').split(/\n\n+/)) {
      const lines = b.split('\n').filter((l) => l.length);
      const tl = lines.find((l) => l.indexOf('-->') !== -1);
      if (!tl) continue;
      const parts = tl.split('-->');
      if (parts.length < 2) continue;
      const start = tcToMs(parts[0]) + off;
      const end = tcToMs(parts[1]) + off;
      if (!(end > start)) continue;
      const txt = stripCueTags(lines.slice(lines.indexOf(tl) + 1).join(' '));
      if (txt) out.push({ start, end, text: txt });
    }
    if (sort) out.sort((a, b) => a.start - b.start);
    return out;
  }

  return { tcToMs, stripCueTags, parseTimedText };
})();

if (typeof window !== 'undefined') window.TimedText = TimedText;
if (typeof module !== 'undefined' && module.exports) module.exports = TimedText;
