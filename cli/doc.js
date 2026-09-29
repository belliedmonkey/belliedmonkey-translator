// cli/doc.js — 文档翻译（learning-design §9.10 / domain-design §2.5）。
//
// 复用 `learn/doc-core.js`（纯逻辑）与 `learn/doc-reader.js`（txt/docx/pdf 读法，正则解析
// docx、不依赖 DOMParser）。**打开一页翻一页**（§2.5 规则 4）：默认只翻第 1 页，要翻更多必须
// 显式给 `--pages`。没有「翻整份」的默认动作 —— 一份 500 页的文档就是 500 次有意的翻页决定。
//
// 图片与扫描页：CLI v1 不接（domain-design §2.7 / §8）。图片文件直接报 `image_unsupported`；
// 无文本层的 PDF 页在这一页注明并跳过 —— **明说不支持，不静默跳过**。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DocCore = require(path.join(ROOT, 'extension/learn/doc-core.js'));
global.DocCore = DocCore;   // doc-reader.js 引用裸全局 DocCore（与两个浏览器宿主同形）
const DocReader = require(path.join(ROOT, 'extension/learn/doc-reader.js'));

async function openDoc(file) {
  const abs = path.resolve(file);
  const name = path.basename(abs);
  const bytes = fs.readFileSync(abs);
  const kind = DocCore.sniffKind(name, bytes);
  if (kind === 'image') {
    const e = new Error('CLI v1 不支持图片 / 扫描页识别（domain-design §2.7 / §8）');
    e.code = 'image_unsupported';
    throw e;
  }
  let pdfjs = null;
  if (kind === 'pdf') pdfjs = await require('./pdfjs.js').load();
  const doc = await DocReader.open(name, new Uint8Array(bytes), { pdfjs });
  return { abs, name, kind, doc };
}

// 页码范围：`""` ⇒ 第 1 页；`3` / `1-3` / `1,3-5`。没有 `all`（§2.5 规则 4）。
function parseRange(spec, total) {
  const s = String(spec == null ? '' : spec).trim();
  if (!s) return total > 0 ? [1] : [];
  const out = new Set();
  for (const part of s.split(',')) {
    const t = part.trim();
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (m) {
      let a = +m[1], b = +m[2];
      if (a > b) { const x = a; a = b; b = x; }
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(t)) out.add(+t);
  }
  return [...out].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
}

// 逐页翻译。`translate(text, opts) → {ok, text, code}`（CLI engine 的 translate）。
async function translateDoc(file, rangeSpec, translate, opts) {
  const o = await openDoc(file);
  const total = o.doc.pages;
  const range = parseRange(rangeSpec, total);
  const out = [];
  for (const n of range) {
    let paras = [];
    try { paras = await o.doc.textOf(n); } catch (_) { paras = []; }
    if (!paras.length) { out.push({ page: n, scanned: true, units: [] }); continue; }
    const units = DocCore.unitsFor(n, paras);
    const pairs = [];
    for (const u of units) {
      const r = await translate(u.text, opts);
      pairs.push({ src: u.text, tr: (r && r.ok) ? r.text : '', ok: !!(r && r.ok), code: r && r.code });
    }
    out.push({ page: n, scanned: false, units: pairs });
  }
  o.doc.close();
  return { abs: o.abs, name: o.name, kind: o.kind, total, range, out };
}

module.exports = { openDoc, translateDoc, parseRange };
