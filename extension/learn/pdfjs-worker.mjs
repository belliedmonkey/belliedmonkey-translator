// learn/pdfjs-worker.mjs — 扩展页的 pdf.js 模块 Worker 入口：先垫片，再 vendor worker。
// 为什么要这一层（2026-09-11 全回归 A 面）：iOS 17.2 Safari 扩展页里直接 new Worker(vendor worker)
// 能起来、getDocument 也能过，但 getTextContent 永不落定 —— Worker 全局没有 Promise.withResolvers，
// 抛在 Worker 里主线程看不见。扩展页 CSP 是 script-src 'self'，blob: Worker 不可用，所以垫片只能
// 以「扩展自己的文件」进 Worker。静态 import 保证顺序；vendor 文件一个字节不改。
import './pdfjs-polyfill.mjs';
import '../vendor/pdfjs/legacy/pdf.worker.min.mjs';
