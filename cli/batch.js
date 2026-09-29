// cli/batch.js — 批量翻译文件 / 目录（learning-design §9.10）。
//
// 用户点名一个文件或一个目录，逐个翻。文档走 `doc.js`（默认同样只翻第 1 页，除非给
// `--pages`），字幕走 `subtitle.js`。这是**显式的批量意图**（用户亲手点了目录），所以
// 不再额外加确认；但默认页范围仍然保守，避免一个 `batch somedir/` 就悄悄烧掉整库。
'use strict';
const fs = require('fs');
const path = require('path');

const DOC_EXT = /\.(pdf|docx|txt|md)$/i;
const SUB_EXT = /\.(vtt|srt)$/i;

function collect(target) {
  const abs = path.resolve(target);
  const st = fs.statSync(abs);
  if (st.isFile()) return [abs];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (DOC_EXT.test(e.name) || SUB_EXT.test(e.name)) out.push(p);
    }
  })(abs);
  return out.sort();
}

module.exports = { collect, DOC_EXT, SUB_EXT };
