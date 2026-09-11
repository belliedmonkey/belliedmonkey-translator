// learn/pdfjs-loader.js — 把 vendored pdf.js 装进当前宿主（domain-design §2.5 规则 3；D0 探针 2026-09-11）。
//
// 两个宿主走**同一条 blob 路**：库文本 → blob: URL → import()；worker 文本 → blob: 模块 Worker → workerPort。
// 为什么不直接 import 文件：宿主 App 是 file:// 的 WKWebView，模块脚本 / Worker / fetch 对 file://
// 一律拒绝（D0 实测），而 blob: 三样都通；扩展页也走 blob，少一条 Safari 扩展页未测的路。
// 为什么让 pdf.js 自己建 Worker 不行：GlobalWorkerOptions.workerSrc = blob: 时它永远不 ready（D0）。
//
// 两个垫片给 iOS 17.2（都缺）：Promise.withResolvers、ReadableStream 异步迭代。前置在 blob 文本里，
// vendor 文件一个字节不改（AMO 会比对第三方库哈希）。
//
// 来源：App 里 build/app-bundle.js 把两份文本编进 Script.js（window.__MT_PDFJS）；扩展页从
// chrome.runtime.getURL('vendor/pdfjs/legacy/…') fetch。
'use strict';

var PdfJsLoader = (() => {
  const POLYFILL = [
    "if (typeof Promise.withResolvers !== 'function') { Promise.withResolvers = function () { var r, j; var p = new Promise(function (res, rej) { r = res; j = rej; }); return { promise: p, resolve: r, reject: j }; }; }",
    "if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) { ReadableStream.prototype[Symbol.asyncIterator] = async function* () { const r = this.getReader(); try { for (;;) { const x = await r.read(); if (x.done) return; yield x.value; } } finally { r.releaseLock(); } }; }",
    '',
  ].join('\n');
  const LIB = 'vendor/pdfjs/legacy/pdf.min.mjs', WORKER = 'vendor/pdfjs/legacy/pdf.worker.min.mjs';
  let loading = null;

  function blobUrl(text) { return URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); }
  function applyPolyfills() { try { (0, eval)(POLYFILL); } catch (_) {} }

  async function sources() {
    const w = (typeof window !== 'undefined') ? window : {};
    if (w.__MT_PDFJS && w.__MT_PDFJS.lib && w.__MT_PDFJS.worker) return { lib: w.__MT_PDFJS.lib, worker: w.__MT_PDFJS.worker };
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const [lib, worker] = await Promise.all([fetch(chrome.runtime.getURL(LIB)).then((r) => r.text()), fetch(chrome.runtime.getURL(WORKER)).then((r) => r.text())]);
      return { lib, worker };
    }
    throw new Error('pdfjs sources unavailable in this host');
  }

  // load() → pdfjsLib（已挂好 workerPort）。只装一次；失败允许重试。
  function load(src) {
    if (loading) return loading;
    loading = (async () => {
      applyPolyfills();
      const s = src || await sources();
      const m = await import(blobUrl(POLYFILL + s.lib));
      const worker = new Worker(blobUrl(POLYFILL + s.worker), { type: 'module' });
      m.GlobalWorkerOptions.workerPort = worker;
      return m;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  return { load, sources, POLYFILL, LIB, WORKER };
})();

if (typeof window !== 'undefined') window.PdfJsLoader = PdfJsLoader;
if (typeof module !== 'undefined' && module.exports) module.exports = PdfJsLoader;
