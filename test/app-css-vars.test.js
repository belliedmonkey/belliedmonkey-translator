// test/app-css-vars.test.js — 门禁：App 的 CSS 里 `var(--x)` 引用的每个变量都必须**定义过**。
//
// 为什么单独立一条：2026-10-08 真机 iPhone 160 反馈「按住说两个键渲染成纯文字」。查下来是
// `app/style.css` 写了 `background: var(--sage-weak)`，而调色板里 sage 系列只有
// `--sage / --sage-deep / --sage-light / --sage-strong / --sage-text` —— **没有 `--sage-weak`**。
// `var()` 取不到值 ⇒ 该声明按 unset 处理 ⇒ 胶囊没有底色；而两个键自己写的是 `background:none`
// 又被排除在通用按钮规则之外 ⇒ 看起来就是普通文字。
//
// 当时没有任何测试看得见这件事（`test:app` 只验「样式已加载」，加载 ≠ 算出了颜色）。
// 这条门禁就是那次事故的直接对策：成本几行，挡住整类「引用了不存在的 token」的错误。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// App 用到的 CSS（organic-tokens 由 build 生成后前置进 Style.css；两个位置都认）
const CSS_FILES = [
  'app/style.css',
  'extension/styles/organic-tokens.gen.css',
  'extension/styles/bilingual.css',
  'extension/styles/floating-button.css',
  'extension/styles/typography.css',
];

describe('App CSS 的 token 门禁（不存在的 CSS 变量 = 一条静默失效的样式）', () => {
  test('var(--x) 引用的每个变量都有定义', () => {
    const defined = new Set();
    const bodies = [];
    for (const f of CSS_FILES) {
      let body;
      try { body = stripComments(read(f)); } catch (_) { continue; }
      bodies.push([f, body]);
      for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
    }
    // 允许 JS 里设到 root 上的变量（例如主题切换），但要在别处出现过的才算
    for (const m of read('app/style.css').matchAll(/setProperty\(\s*'(--[a-zA-Z0-9-]+)'/g)) defined.add(m[1]);
    ok(defined.size > 10, '调色板读不到内容（defined=' + defined.size + '）—— 门禁会变成空转');

    // **已知的两处**（2026-10-08 门禁建起来时抓到的、既有问题）：修它们会让那两条样式**真的生效**
    // ⇒ 属于用户可见的外观变化 ⇒ 要先出稿、由用户定。列在这里放行，新的照样判红。
    const KNOWN = new Set([
      // 2026-10-08 门禁建起来时抓到的**全部 7 处**（都是 `app/style.css` 里的既有问题）。
      // 修它们 = 那几条样式**真的生效** = 用户可见的外观变化 ⇒ 按规矩要先出 Pencil 稿；
      // 2026-10-09 裁定：**本批不修**，列在这里放行，新出现的照样判红。
      '--muted', '--sage-fill', '--tint', '--warn-bd', '--warn-bg', '--warn-text', '--warn-tx',
    ]);
    const missing = [];
    for (const [f, body] of bodies) {
      for (const m of body.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!defined.has(m[1]) && !KNOWN.has(m[1])) missing.push(`${f}: ${m[1]}`);
      }
    }
    ok(missing.length === 0, '引用了没定义的 CSS 变量（样式会静默失效）：\n    ' + [...new Set(missing)].join('\n    '));
    // 已知那两处一旦被修好（定义加上了），就该把它们从 KNOWN 里删掉
    const stillBad = [...KNOWN].filter((v) => defined.has(v));
    ok(stillBad.length === 0, 'KNOWN 里的变量已经有定义了，请从 KNOWN 删除：' + stillBad.join(','));
  });

  test('按住说按钮条用的都是真实存在的 token（这次事故的定点复验）', () => {
    const style = stripComments(read('app/style.css'));
    const block = style.slice(style.indexOf('.listen-ptt-wrap'), style.indexOf('.listen-ptt-wrap') + 1800);
    ok(block.length > 200, '读不到 .listen-ptt-wrap 那一段样式');
    const defined = new Set();
    for (const f of CSS_FILES) {
      try { for (const m of stripComments(read(f)).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]); } catch (_) {}
    }
    for (const m of block.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      ok(defined.has(m[1]), `按钮条用了不存在的变量 ${m[1]}`);
    }
    ok(!/sage-weak/.test(block), '按钮条又用回了 --sage-weak（调色板里没有这个变量）');
    // 三件套：实心底 + 圆角 + 高度 —— 真机投诉的正是「看不出能按」
    ok(/background:\s*var\(--sage-light\)|background:\s*var\(--card-bg\)/.test(block), '按钮没有实心底色');
    ok(/border-radius:\s*2[0-9]px/.test(block), '按钮没有圆角');
    ok(/height:\s*60px/.test(block), '按钮条高度不是 60px（≥56pt 的稿值）');
    ok(/position:\s*fixed/.test(block), '按钮条不是固定贴底（稿里要求固定贴底）');
  });
});
