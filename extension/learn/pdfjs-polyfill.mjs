// learn/pdfjs-polyfill.mjs — pdf.js 在旧 WebKit 里缺的两样（iOS 17.2 都缺；Safari 26.5 缺后一样）。
// 作为 ES 模块被 pdfjs-worker.mjs **先于** vendor worker 导入：模块按导入顺序求值，所以 worker
// 代码跑起来之前垫片已经在。内容与 pdfjs-loader.js 的 applyPolyfills 逐字等价（那份给主线程，这份给 Worker）。
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () { let res, rej; const promise = new Promise((a, b) => { res = a; rej = b; }); return { promise, resolve: res, reject: rej }; };
}
if (typeof ReadableStream !== 'undefined' && ReadableStream.prototype && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () { const r = this.getReader(); try { for (;;) { const x = await r.read(); if (x.done) return; yield x.value; } } finally { r.releaseLock(); } };
}
