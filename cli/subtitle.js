// cli/subtitle.js — 本地字幕文件翻译（learning-design §9.10 / domain-design §2.7）。
//
// 读一整份 `.vtt` / `.srt` → cues → 逐条翻译 → 写译文字幕（保持时间轴）。
//
// 时间轴解析是**共享的同一份实现**：`extension/content/timed-text.js`（内容脚本
// podcast / twitter 与 CLI 共用）。翻译走 CLI engine 的 `translate`（同一份传输字节）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TimedText = require(path.join(ROOT, 'extension/content/timed-text.js'));
const parseTimedText = (text) => TimedText.parseTimedText(text);

function pad(n, w) { return String(n).padStart(w, '0'); }
function fmt(ms, comma) {
  const t = Math.max(0, ms | 0);
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), x = t % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${comma ? ',' : '.'}${pad(x, 3)}`;
}

async function translateSubtitle(file, translate, opts) {
  const abs = path.resolve(file);
  const text = fs.readFileSync(abs, 'utf8');
  const cues = parseTimedText(text);
  for (const c of cues) {
    const r = await translate(c.text, opts);
    c.tr = (r && r.ok) ? r.text : '';
  }
  return { abs, name: path.basename(abs), cues };
}

// 译文在原文下一行（双语）；`only` 时只出译文。
function toVtt(cues, only) {
  const blocks = cues.map((c) => {
    const body = only ? c.tr : c.text + '\n' + (c.tr || '');
    return `${fmt(c.start, false)} --> ${fmt(c.end, false)}\n${body}`;
  });
  return 'WEBVTT\n\n' + blocks.join('\n\n') + '\n';
}
function toSrt(cues, only) {
  const blocks = cues.map((c, i) => {
    const body = only ? c.tr : c.text + '\n' + (c.tr || '');
    return `${i + 1}\n${fmt(c.start, true)} --> ${fmt(c.end, true)}\n${body}`;
  });
  return blocks.join('\n\n') + '\n';
}
function fmtText(cues, only) {
  return cues.map((c) => (only ? c.tr : c.text + '\n' + (c.tr || ''))).join('\n\n') + '\n';
}

module.exports = { parseTimedText, translateSubtitle, toVtt, toSrt, fmtText };
