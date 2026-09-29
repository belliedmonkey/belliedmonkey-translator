// cli/pdfjs.js — 在 Node 里加载 vendored pdf.js（learning-design §9.10 / domain-design §2.5）。
//
// 只做文本层：`getTextContent()` → 文本项 → `DocCore.paragraphsFromTextItems`。渲染（canvas）
// CLI 用不到，所以 Node 缺 `@napi-rs/canvas` / `DOMMatrix` 的告警与我们无关（spike 已验证
// 文本抽取可用）。
//
// 位置：优先构建产物 `dist-cli/vendor/pdfjs/legacy/`（build/cli-bundle.js 会拷进去），
// 否则仓库 `extension/vendor/pdfjs/legacy/`。vendor 文件一个字节不改（AMO 会比对哈希）。
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let cached = null;

function vendorDir() {
  try {
    const p = path.join(require('./engine.js').distDir(), 'vendor', 'pdfjs', 'legacy');
    if (fs.existsSync(p)) return p;
  } catch (_) { /* engine 未构建也能用仓库里的 vendor */ }
  return path.join(ROOT, 'extension', 'vendor', 'pdfjs', 'legacy');
}

async function load() {
  if (cached) return cached;
  const dir = vendorDir();
  // pdf.js 在 Node 里会 warn「@napi-rs/canvas 不可用 / DOMMatrix 未 polyfill」—— 那是渲染路径，
  // 我们只用文本层。cmd 的 stdout 是结果，不想被这类告警污染，于是只在 import 这一下静默 warn。
  const warn = console.warn;
  console.warn = () => {};
  let m;
  try { m = await import(pathToFileURL(path.join(dir, 'pdf.min.mjs')).href); }
  finally { console.warn = warn; }
  try {
    if (m.GlobalWorkerOptions) m.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(dir, 'pdf.worker.min.mjs')).href;
    if (typeof m.setVerbosityLevel === 'function') m.setVerbosityLevel(0);   // 连运行期告警（standardFontDataUrl 等）一起去掉
  } catch (_) { /* 没有 Worker 时 pdf.js 走 fake worker，文本层照常 */ }
  cached = m;
  return m;
}

module.exports = { load, vendorDir };
