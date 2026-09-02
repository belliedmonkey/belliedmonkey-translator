// test/syntax.test.js — 每一个出货的 JS 都必须解析得了。
//
// 听起来像废话，直到 2026-09-02：往 review.js 的 if/else 链中间插了一行，
// 那是语法错误，而它的表现**不是报一行错** —— 是整个 review.js 不解析，复习页
// 一片空白，控制台里只有一条谁都不会去看的 SyntaxError。
//
// 而当时 `npm test` 是绿的：那套 vm harness 只加载它显式 require 的模块，
// review.js / options.js / onboard.js / content-*.js 这些**由 HTML 加载的文件**
// 一个都不在里面。也就是说，仓库里体量最大的那批前端代码，此前没有任何东西
// 保证过它们能被解析。
//
// 判据用 `new vm.Script`：与浏览器同一个解析器语义，且不执行任何一行 ——
// 这些文件都是 IIFE，一执行就会去碰 document / chrome。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function shippedJs() {
  const out = [];
  for (const dir of ['extension', 'app']) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '_locales') walk(p); }
        else if (e.name.endsWith('.js')) out.push(p);
      }
    })(path.join(ROOT, dir));
  }
  return out;
}

describe('出货的 JS 都解析得了', () => {
  const files = shippedJs();

  test('扫到了文件 —— 扫不到东西的断言不是门禁', () => {
    ok(files.length >= 40, `只扫到 ${files.length} 个 js，扫法走歪了？`);
    const rel = files.map((f) => path.relative(ROOT, f));
    // 点名几个**由 HTML 加载、不进 vm harness** 的，它们正是这道门禁的理由。
    for (const must of ['extension/learn/review.js', 'extension/options/options.js',
      'extension/onboard/onboard.js', 'extension/content/content-main.js', 'app/app.js']) {
      ok(rel.includes(must), `没扫到 ${must}`);
    }
  });

  test('★ 每一个都解析得了', () => {
    const bad = [];
    for (const f of files) {
      try {
        // 只解析，不执行。produceCachedData 逼它真的走完整个解析。
        new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f, produceCachedData: true });
      } catch (e) {
        bad.push(`${path.relative(ROOT, f)} — ${String((e && e.message) || e).split('\n')[0]}`);
      }
    }
    eq(bad.length, 0, '这些文件解析不了，浏览器里整份都不会执行：\n  ' + bad.join('\n  '));
  });
});
