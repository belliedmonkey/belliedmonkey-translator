// learn/pdfjs-loader.js — 把 vendored pdf.js 装进当前宿主（domain-design §2.5 规则 3；D0 探针 2026-09-11）。
//
// 两个宿主，两条路，同一个出口（pdfjsLib 已挂好 workerPort）：
//   · App（file:// 的 WKWebView）：库文本 → blob: URL → import()；worker 文本 → blob: 模块 Worker。
//     模块脚本 / Worker / fetch 对 file:// 一律拒绝（D0 实测），而 blob: 三样都通。
//   · 扩展页：直接 import(chrome.runtime.getURL(lib)) + new Worker(getURL(worker), {type:'module'})。
//     MV3 扩展页的 CSP 是 script-src 'self'，**blob: 模块脚本会被拒**（test:docs 2026-09-11 实测：
//     「Failed to fetch dynamically imported module: blob:chrome-extension://…」），而扩展自己的
//     URL 就是 'self'。
// 为什么让 pdf.js 自己建 Worker 不行：GlobalWorkerOptions.workerSrc = blob: 时它永远不 ready（D0）。
//
// 两个垫片给 iOS 17.2（都缺）：Promise.withResolvers、ReadableStream 异步迭代。App 路前置在
// blob 文本里；扩展路在 import 之前 eval 到页面（Worker 里不需要：扩展页的 Chrome/Safari 都够新，
// iOS 17.2 只出现在 App 那条路上）。vendor 文件一个字节不改（AMO 会比对第三方库哈希）。
//
// 来源：App 里 build/app-bundle.js 把两份文本编进 Script.js（window.__MT_PDFJS）。
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
  // 扩展页 CSP 是 script-src 'self'，eval 被禁（2026-09-11 全回归：Safari 26.5 没有 ReadableStream 异步迭代，
  // eval 静默失败 ⇒ pdf.js getTextContent 抛「undefined is not a function」，Chrome/Firefox 原生支持所以没露）。
  // 所以垫片直接以函数写在这里，对着传入的全局对象（默认 globalThis）补。POLYFILL 字符串只给 App 的 blob 文本前置用。
  function applyPolyfills(g) {
    const G = g || globalThis;
    try {
      if (G.Promise && typeof G.Promise.withResolvers !== 'function') {
        G.Promise.withResolvers = function () { let res, rej; const promise = new G.Promise((a, b) => { res = a; rej = b; }); return { promise, resolve: res, reject: rej }; };
      }
      if (G.ReadableStream && G.ReadableStream.prototype && !G.ReadableStream.prototype[Symbol.asyncIterator]) {
        G.ReadableStream.prototype[Symbol.asyncIterator] = async function* () { const r = this.getReader(); try { for (;;) { const x = await r.read(); if (x.done) return; yield x.value; } } finally { r.releaseLock(); } };
      }
    } catch (_) {}
  }

  // 来源：{ lib, worker } 是文本（App）或 { libUrl, workerUrl }（扩展页）。
  function sources() {
    const w = (typeof window !== 'undefined') ? window : {};
    if (w.__MT_PDFJS && w.__MT_PDFJS.lib && w.__MT_PDFJS.worker) return { lib: w.__MT_PDFJS.lib, worker: w.__MT_PDFJS.worker };
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return { libUrl: chrome.runtime.getURL(LIB), workerUrl: chrome.runtime.getURL(WORKER) };
    }
    throw new Error('pdfjs sources unavailable in this host');
  }

  // load() → pdfjsLib（已挂好 workerPort）。只装一次；失败允许重试。
  function load(src) {
    if (loading) return loading;
    loading = (async () => {
      applyPolyfills();
      const s = src || sources();
      let m, worker;
      if (s.libUrl) {
        m = await import(s.libUrl);
        worker = new Worker(s.workerUrl, { type: 'module' });
      } else {
        m = await import(blobUrl(POLYFILL + s.lib));
        worker = new Worker(blobUrl(POLYFILL + s.worker), { type: 'module' });
      }
      m.GlobalWorkerOptions.workerPort = worker;
      return m;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  return { load, sources, applyPolyfills, POLYFILL, LIB, WORKER };
})();

if (typeof window !== 'undefined') window.PdfJsLoader = PdfJsLoader;
if (typeof module !== 'undefined' && module.exports) module.exports = PdfJsLoader;
