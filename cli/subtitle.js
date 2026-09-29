// cli/subtitle.js — 本地字幕文件翻译（learning-design §9.10 / domain-design §2.7）。
//
// 读一整份 `.vtt` / `.srt` → cues → 逐条翻译 → 写译文字幕（保持时间轴）。
//
// **时间轴解析与 `content/podcast.js` 的 `parseTimedText` 同规则**（那边内嵌在内容脚本里、
// 不导出，CLI 够不着）。这段解析是 25 行的稳定纯函数，这里照抄一份；合并回一个共享纯模块
// 列为后续项（PR 里点名）。翻译走 CLI engine 的 `translate`（同一份传输字节）。
'use strict';
const fs = require('fs');
const path = require('path');

function tcToMs(tc) {
  tc = (tc || '').trim().replace(',', '.').split(' ')[0];
  const p = tc.split(':');
  let h = 0, m = 0, s = 0;
  if (p.length === 3) { h = +p[0]; m = +p[1]; s = parseFloat(p[2]); }
  else if (p.length === 2) { m = +p[0]; s = parseFloat(p[1]); }
  else { s = parseFloat(p[0]); }
  return Math.round(((h * 3600 + m * 60 + s) || 0) * 1000);
}
function stripCueTags(t) { return t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[^\S\n]+/g, ' ').trim(); }

function parseTimedText(text) {
  const out = [];
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.length);
    const tl = lines.find((l) => l.indexOf('-->') !== -1);
    if (!tl) continue;
    const parts = tl.split('-->');
    if (parts.length < 2) continue;
    const start = tcToMs(parts[0]);
    const end = tcToMs(parts[1]);
    if (!(end > start)) continue;
    const txt = stripCueTags(lines.slice(lines.indexOf(tl) + 1).join(' '));
    if (txt) out.push({ start, end, text: txt });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

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
