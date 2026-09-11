// test/vendor.test.js — vendored 第三方库的三条门（第九期 C，2026-09-11）。
//
// ① 文件与 VERSION 里记的 sha256 逐字一致：AMO 审核会比对第三方库是不是官方原样，我们自己
//    也不许改一个字节（垫片前置在 loader 的 blob 文本里，不进 vendor 文件）；
// ② LICENSE 在（Apache-2.0 要署名）；
// ③ 中国合规 grep 同一条正则也扫 .mjs：build.js 原来只看 js|json|html|css|txt，vendor 一进来
//    就是假绿；这里再扫一遍，并钉住 build.js 已经把 mjs 加进去了。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describe, test, ok, eq } = require('./harness');
const ROOT = path.join(__dirname, '..');
const V = path.join(ROOT, 'extension/vendor/pdfjs');

describe('vendor/pdfjs', () => {
  test('VERSION 里的 sha256 与文件一致（原样、未改）', () => {
    const lines = fs.readFileSync(path.join(V, 'VERSION'), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}\s/.test(l));
    ok(lines.length === 2, 'VERSION 应记两份文件的 sha256');
    for (const l of lines) {
      const [sum, rel] = l.trim().split(/\s+/);
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(V, rel))).digest('hex');
      eq(actual, sum, rel + ' 被改动过或版本不对');
    }
  });
  test('LICENSE 在，且是 Apache-2.0', () => {
    ok(/Apache License/.test(fs.readFileSync(path.join(V, 'LICENSE'), 'utf8')));
  });
  test('中国合规正则对 .mjs 零命中；build.js 的扫描范围含 mjs', () => {
    const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
    const m = /const FORBIDDEN = (\/.*\/i);/.exec(build);
    ok(m, 'build.js 里找不到 FORBIDDEN');
    const re = new RegExp(m[1].slice(1, -2), 'i');
    for (const f of ['legacy/pdf.min.mjs', 'legacy/pdf.worker.min.mjs']) {
      const text = fs.readFileSync(path.join(V, f), 'utf8');
      ok(!re.test(text), f + ' 含中国版禁止的品牌/端点字样');
    }
    ok(/m\?js\|json\|html\|css\|txt/.test(build), 'build.js 的中国合规扫描要包含 .mjs');
  });
  test('loader 的垫片前置在 blob 文本里，不进 vendor 文件', () => {
    const L = require('../extension/learn/pdfjs-loader.js');
    ok(/withResolvers/.test(L.POLYFILL) && /asyncIterator/.test(L.POLYFILL));
    const lib = fs.readFileSync(path.join(V, 'legacy/pdf.min.mjs'), 'utf8').slice(0, 400);
    ok(!/withResolvers = function/.test(lib), 'vendor 文件里不该有我们的垫片');
  });
});
