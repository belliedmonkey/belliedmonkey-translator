// test/regress-2026-09.test.js — 2026-09-11 全回归抓到的缺陷，各留一条「先红后绿」的用例。
//
// F06 退出登录不清免费额度令牌、不先确认（interaction-spec L716–719，用户 09-08 裁定 D4）
// F07 额度激活时在一键卡粘自己的 key 被当成「已配过」（quick-setup.js render 没把 replaceKeyTail 传给 plan）
// F12 Safari 扩展页 pdf.js getTextContent 抛错：垫片用 eval 注入，扩展页 CSP 禁 eval；且阅读器吞掉异常什么都不显示
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('回归 2026-09 · F06 退出登录要先确认并清掉免费额度令牌', () => {
  test('扩展设置页的退出登录走 LearnGrant.clearOnSignOut', () => {
    ok(/clearOnSignOut/.test(read('extension/options/options.js')), 'options.js 的 btn-sync-out 处理器没调 LearnGrant.clearOnSignOut —— 退出后三槽里的 bmg_ 令牌与 grantTail 原样留着');
  });
  test('App 的退出登录也走 LearnGrant.clearOnSignOut', () => {
    ok(/clearOnSignOut/.test(read('app/app.js')), 'app.js 的 onSignOut 没调 LearnGrant.clearOnSignOut');
  });
  test('12 份 locale 都有退出确认文案 grant_signout_confirm', () => {
    for (const loc of fs.readdirSync(path.join(ROOT, 'extension/_locales'))) {
      const m = JSON.parse(read(`extension/_locales/${loc}/messages.json`));
      ok(m.grant_signout_confirm && m.grant_signout_confirm.message.length > 10, loc + ' 缺 grant_signout_confirm');
    }
  });
});

describe('回归 2026-09 · F07 一键卡粘自己的 key 时免费槽可覆盖', () => {
  test('render 的 apply 把 replaceKeyTail 传给 plan（否则免费槽永远算「已配过」）', () => {
    const src = read('extension/learn/quick-setup.js');
    const call = src.slice(src.indexOf('const p = plan({ platform: current'));
    ok(/replaceKeyTail/.test(call.slice(0, 400)), 'quick-setup.js render 里的 plan({...}) 调用没有 replaceKeyTail');
  });
  test('三个宿主都给 render 提供 replaceKeyTail（额度令牌尾八位）', () => {
    for (const f of ['extension/options/options.js', 'extension/onboard/onboard.js', 'app/settings.js']) {
      ok(/replaceKeyTail/.test(read(f)), f + ' 的 QuickSetup.render 没传 replaceKeyTail');
    }
  });
});

describe('回归 2026-09 · F12 pdf.js 垫片不能靠 eval；阅读器打开失败要说话', () => {
  test('pdfjs-loader.js 里没有 eval（扩展页 CSP script-src self 禁 eval，Safari 26.5 缺 ReadableStream 异步迭代 ⇒ getTextContent 抛错）', () => {
    ok(!/\beval\(/.test(read('extension/learn/pdfjs-loader.js')), 'pdfjs-loader.js 用了 eval');
  });
  test('applyPolyfills 在缺垫片的环境里真的补上（不经 eval）', () => {
    const src = read('extension/learn/pdfjs-loader.js');
    const vm = require('vm');
    const ctx = { window: {}, module: { exports: {} }, console, Promise: Object.assign(function P(ex) { return new Promise(ex); }, { resolve: Promise.resolve.bind(Promise), reject: Promise.reject.bind(Promise) }), ReadableStream: function RS() {}, Blob: function () {}, URL: { createObjectURL: () => 'blob:x' }, Symbol, Worker: function () {}, fetch: async () => ({ text: async () => '' }), chrome: undefined };
    ctx.ReadableStream.prototype = {};
    vm.runInNewContext(src, ctx);
    const L = ctx.window.PdfJsLoader || ctx.module.exports;
    ok(typeof L.applyPolyfills === 'function', 'loader 要导出 applyPolyfills');
    L.applyPolyfills(ctx);
    ok(typeof ctx.Promise.withResolvers === 'function', 'Promise.withResolvers 没补上');
    ok(typeof ctx.ReadableStream.prototype[Symbol.asyncIterator] === 'function', 'ReadableStream 异步迭代没补上');
  });
  test('doc-view 的 gotoPage 把 unitsForPage 的异常接住并显示 doc_open_failed', () => {
    const src = read('extension/learn/doc-view.js');
    const fn = src.slice(src.indexOf('async function gotoPage'), src.indexOf('async function unitsForPage'));
    ok(/try\s*\{[\s\S]*unitsForPage\(n, s, epoch\)[\s\S]*catch/.test(fn) && /doc_open_failed/.test(fn), 'gotoPage 没接住 unitsForPage 的异常（Safari 上 pdf.js 抛错时页面空白、无提示）');
  });
});
