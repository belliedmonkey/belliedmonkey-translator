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
// 扫的是全部扩展页 + 内容脚本（App 那边 app.js 也扫：同一个浏览器规则）。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');

function sources() {
  const out = [];
  for (const dir of ['extension', 'app']) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '_locales') walk(p); }
        else if (e.name.endsWith('.js') && !e.name.endsWith('.gen.js')) out.push(p);
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

describe('window.open 不许排在 await 后面', () => {
  const files = sources();

  test('扫到了点击处理器 —— 扫不到东西的断言不是门禁', () => {
    const n = files.reduce((a, f) => a + clickHandlers(stripComments(fs.readFileSync(f, 'utf8'))).length, 0);
    ok(n >= 20, `只截出 ${n} 个 click 处理器，截法走歪了？`);
  });

  test('扫得到已知的那几处 window.open —— 否则这条断言是空的', () => {
    const n = files.reduce((a, f) => a
      + clickHandlers(stripComments(fs.readFileSync(f, 'utf8')))
        .filter((h) => h.body.includes('window.open')).length, 0);
    ok(n >= 2, `click 处理器里只找到 ${n} 处 window.open，扫法走歪了？`);
  });

  test('★ 每一处 window.open 之前都没有 await', () => {
    const bad = [];
    for (const f of files) {
      const raw = fs.readFileSync(f, 'utf8');
      const src = stripComments(raw);
      for (const h of clickHandlers(src)) {
        const w = h.body.indexOf('window.open');
        if (w < 0) continue;
        const a = h.body.indexOf('await');
        if (a < 0 || a > w) continue;
        const line = src.slice(0, h.at).split('\n').length;
        bad.push(`${path.relative(ROOT, f)}:${line} 的 click 处理器先 await 再 window.open`
          + ' —— 用户手势已经用掉，Safari 会把这次 open 当弹窗拦掉，而且不报任何错。'
          + '把 window.open 提到第一个 await 之前。');
      }
    }
    eq(bad.length, 0, '\n  ' + bad.join('\n  '));
  });
});
