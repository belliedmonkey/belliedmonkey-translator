// test/user-gesture.test.js — window.open 必须同步发生在点击里。
//
// 浏览器只在**用户手势期间**放行 window.open。手势不是「这次点击的整个回调」，是
// 回调里第一次 await 之前的那一段：一旦 await 过，手势就用掉了，之后的 window.open
// 被当成自动弹窗拦掉。
//
// 这个坑没有任何一处会红：
//   · 没有异常，没有控制台输出 —— window.open 只是返回 null
//   · Chrome 对这条**宽松**，所以本地开发和三道真浏览器门禁全都看不见
//   · 用户看到的是「点了没反应」，而这正是最贵的那类 bug（见 memory：静默失败要给
//     用户出口）
//
// 2026-09-01 真机报的就是设置页的「重看开始使用引导」：它先 await 了一次
// storage.local.remove 再 open。修法不是加超时，是**换顺序** —— 两件事本来就不互相
// 依赖。所以判据也不是「别 await」，而是「window.open 之前不许有 await」。
//
// 扫的是全部扩展页 + 内容脚本 + src/ 里的 React 页（App 那边 app.js 也扫：
// 同一个浏览器规则）。JSX 页（PR3 起）没有 addEventListener：处理器是命名 const
// 箭头函数，JSX 里 onClick={name} 直接引用 —— 所以另有 constArrowHandlers 截它们。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');

function sources() {
  const out = [];
  for (const dir of ['extension', 'app', 'src']) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '_locales' && e.name !== 'node_modules') walk(p); }
        else if ((e.name.endsWith('.js') || e.name.endsWith('.jsx')) && !e.name.endsWith('.gen.js')) out.push(p);
      }
    })(path.join(ROOT, dir));
  }
  return out;
}

// 从 addEventListener('click', … 起，按大括号配平截出回调体。
// 源码已抹掉注释与正则，字符串里的括号仍在 —— 所以顺带跳过字符串。
function clickHandlers(src) {
  const out = [];
  const re = /addEventListener\(\s*['"]click['"]\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    let i = src.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0; let q = '';
    for (let j = i; j < src.length; j += 1) {
      const c = src[j];
      if (q) { if (c === '\\') { j += 1; continue; } if (c === q) q = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) { out.push({ at: m.index, body: src.slice(i, j + 1) }); break; } }
    }
  }
  return out;
}

// JSX 页的处理器是命名 const 箭头函数（const openProviderSignIn = async () => {…}）。
// 从声明行起按大括号配平截出函数体，跳字符串同上。function 声明与对象字面量里的
// 内联箭头（onAction: () => {…}）不匹配 —— popup/onboard 现有的 window.open 都在
// 这两种形状里，零命中是有意为之（它们走上面那个提取器也不命中，因为 JSX 里没有
// addEventListener；覆盖它们的是 onClick={…} 直接引用之外的遗留页 app/extension）。
function constArrowHandlers(src) {
  const out = [];
  const re = /const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const i = src.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0; let q = '';
    for (let j = i; j < src.length; j += 1) {
      const c = src[j];
      if (q) { if (c === '\\') { j += 1; continue; } if (c === q) q = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) { out.push({ at: m.index, body: src.slice(i, j + 1) }); break; } }
    }
  }
  return out;
}

describe('window.open 不许排在 await 后面', () => {
  const files = sources();
  const handlers = (src) => clickHandlers(src).concat(constArrowHandlers(src));

  test('扫到了点击处理器 —— 扫不到东西的断言不是门禁', () => {
    const n = files.reduce((a, f) => a + handlers(stripComments(fs.readFileSync(f, 'utf8'))).length, 0);
    ok(n >= 20, `只截出 ${n} 个处理器（click + const 箭头），截法走歪了？`);
  });

  test('扫得到已知的那几处 window.open —— 否则这条断言是空的', () => {
    const n = files.reduce((a, f) => a
      + handlers(stripComments(fs.readFileSync(f, 'utf8')))
        .filter((h) => h.body.includes('window.open')).length, 0);
    ok(n >= 2, `处理器里只找到 ${n} 处 window.open，扫法走歪了？`);
  });

  // options.jsx 六个命名处理器含 window.open（grantAction 一处两发）。没有这条，
  // 上面那个 ≥2 只靠旧页续命 —— 哪天全部迁完、const-arrow 截法坏了，负向断言不会
  // 有任何感觉，因为根本没东西可查。
  test('★ React 设置页的处理器也在扫描面里', () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'src/pages/options.jsx'), 'utf8'));
    const n = constArrowHandlers(src).filter((h) => h.body.includes('window.open')).length;
    ok(n >= 4, `options.jsx 的 const 箭头处理器里只截到 ${n} 个含 window.open —— `
      + 'onProviderChange 迁移时换掉了锚点，还是截法坏了？');
  });

  test('★ 每一处 window.open 之前都没有 await', () => {
    const bad = [];
    for (const f of files) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      for (const h of handlers(src)) {
        const w = h.body.indexOf('window.open');
        if (w < 0) continue;
        const a = h.body.indexOf('await');
        if (a < 0 || a > w) continue;
        const line = src.slice(0, h.at).split('\n').length;
        bad.push(`${path.relative(ROOT, f)}:${line} 的处理器先 await 再 window.open`
          + ' —— 用户手势已经用掉，Safari 会把这次 open 当弹窗拦掉，而且不报任何错。'
          + '把 window.open 提到第一个 await 之前。');
      }
    }
    eq(bad.length, 0, '\n  ' + bad.join('\n  '));
  });
});
