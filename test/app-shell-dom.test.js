// test/app-shell-dom.test.js — 壳引用的 DOM 元素必须真的存在（2026-10-01，#536）。
//
// 为什么需要这条门：#532 把「继续设置」卡（#ob-resume 一族）和未登录首页的设置入口
// （#gear2）从 AppShell.jsx 里删掉了，但 src/app/shell-model.js 里还留着**无条件**访问：
//
//     $('ob-resume-go').addEventListener('click', …)   // 元素为 null ⇒ TypeError
//
// 它发生在**初始化期**（不是某个回调里），于是整个壳的启动就此中断 —— 装机后是一屏奶油色
// 空白：样式在（底色是 Style.css 的奶油），内容空（React 挂载之后的初始化没跑完）。
// `npm test` 当时全绿：套件跑在无 DOM 环境里（docs/domain-design.md §10，不带 jsdom），
// 看不见「元素被删了而代码还在引用」。这条门用**静态**办法补上，不需要浏览器。
//
// 规则：
//   1. shell-model.js 里每个 `$('id')` 的 id，必须出现在 App 页面源码（JSX / HTML）的
//      `id="…"` 里，或在 EXPLAINED 里逐条写明理由（运行时创建的 id）。
//   2. 退役元素**不得**用 `$('id').属性` 直接取（那正是今天的抛法）。要么先存局部变量再判空，
//      要么从容器往下找（`card.querySelector('#…')`）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');

// App 页面源码 = 打进 Script.js 的那一套（壳 + 各视图 + 宿主 HTML）。
function appSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src/app'));
  const idx = path.join(ROOT, 'app/index.html');
  if (fs.existsSync(idx)) out.push(idx);
  return out;
}

// JSX 里 id 的三种写法 + HTML 的写法。
function idsIn(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bid=["']([^"'{}]+)["']/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\bid=\{\s*["']([^"']+)["']\s*\}/g)) ids.add(m[1]);
  return ids;
}

// 去注释：否则本文件要拦的那句恰好也会出现在注释里（教训的正文里就引用了它）。
function stripComments(src) {
  return src.replace(/\{\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

// 运行时才创建、因此不在 JSX/HTML 里的 id。每条都要有理由 —— 没有理由的例外等于没有门。
const EXPLAINED = {
  'empty-onboard-row': 'paintAppEmptyState 运行时创建（空态行）',
  'empty-settings': 'paintAppEmptyState 运行时创建（空态行）',
  'ob-resume': '#532 退役的「继续设置」卡；引用处已判空（整体退役时应连这些条目一起删）',
  'ob-resume-body': '#532 退役；只在 paintObResume 内、且已过 `if (!card) return false`（改为从 card 往下找）',
  'ob-resume-close': '#532 退役；监听注册已判空（局部变量）',
  'ob-resume-go': '#532 退役；监听注册已判空（局部变量）',
  'ob-resume-title': '#532 退役；只在 paintObResume 内、且已过 `if (!card) return false`（改为从 card 往下找）',
};

const universe = (() => {
  const ids = new Set();
  for (const f of appSources()) for (const id of idsIn(fs.readFileSync(f, 'utf8'))) ids.add(id);
  return ids;
})();

const shell = stripComments(fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8'));
const refs = [...shell.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
const refSet = [...new Set(refs)];
const derefs = [...new Set([...shell.matchAll(/\$\('([^']+)'\)\s*\./g)].map((m) => m[1]))];

describe('App 壳 ↔ DOM 契约（#536：元素退役而代码还在引用 ⇒ 整壳启动中断）', () => {
  test('取 id 的扫描器本身没坏（防「门禁静默通过」）', () => {
    ok(universe.size > 300, `App 页面源码只扫到 ${universe.size} 个 id —— 扫描器坏了，不是门绿了`);
    ok(refSet.length > 50, `shell-model 只扫到 ${refSet.length} 个 $('id') —— 扫描器坏了`);
  });

  test('壳引用的每个 id 都在 App 页面源码里，或在 EXPLAINED 里写明理由', () => {
    const unexplained = refSet.filter((id) => !universe.has(id) && !(id in EXPLAINED));
    deepEq(unexplained, [], '壳引用了一个不在 App 页面源码里的 id —— 元素被退役了？'
      + '那 src/app/shell-model.js 里的引用必须一起清理（登记 EXPLAINED 也要有理由，别只图变绿）。'
      + '2026-10-01 的空白屏就是这么来的：#ob-resume 一族与 #gear2 被删，#532 却留着无条件访问。');
  });

  test('退役元素不得用 $(\'id\').属性 直接取（那就是会抛的写法）', () => {
    const bad = derefs.filter((id) => !universe.has(id));
    deepEq(bad, [], '对不在页面源码里的 id 直接取了属性 —— null 上取属性会抛 TypeError；'
      + '而初始化期抛出会中断整个壳的启动（白屏）。先把 $(\'id\') 存进局部变量并判空，'
      + '或从容器往下找（card.querySelector）。');
  });

  test('EXPLAINED 的每条例外都必须写出理由', () => {
    const noReason = Object.entries(EXPLAINED).filter(([, why]) => !why || why.length < 6).map(([id]) => id);
    deepEq(noReason, [], '登记了没有理由的例外 —— 例外没有理由，等于没有这条门');
  });
});
