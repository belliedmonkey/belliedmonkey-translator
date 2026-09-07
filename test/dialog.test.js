// test/dialog.test.js — 页内确认框（LearnDialog）的类名不能撞上宿主页的样式。
//
// 它被注入到三个宿主页（App、复习页、设置页），每个宿主都有自己的按钮样式。2026-09-07
// TestFlight 87：确定键用了裸类名 `danger`，App 的 `button.danger { color: var(--danger) }`
// 以更高的特异度盖过 `.ld-ok { color:#fff }`，红字红底 —— 删除账号的确定键看着是空的。
// 所以：dialog.js 里出现的每个类名必须带 ld- 前缀，且宿主样式表里一个都不能出现。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'extension/learn/dialog.js'), 'utf8');

// 代码里赋出去的类名（className = '…' / ' …'）与样式块里的选择器类名，取并集。
function classesUsed() {
  const out = new Set();
  for (const m of src.matchAll(/className = '([^']+)'(?: \+ \(o\.danger \? ' ([^']+)' : ''\))?/g)) {
    m[1].split(/\s+/).forEach((c) => out.add(c));
    if (m[2]) out.add(m[2]);
  }
  for (const m of src.matchAll(/\.([a-zA-Z][\w-]*)\s*[{,.\s]/g)) if (m[1].startsWith('ld-')) out.add(m[1]);
  return [...out];
}

describe('LearnDialog 类名与宿主样式隔离', () => {
  const classes = classesUsed();
  test('至少找到了确定/取消/危险三个类', () => {
    ok(classes.includes('ld-ok') && classes.includes('ld-cancel'), classes.join(','));
    ok(classes.some((c) => /danger/.test(c)), '危险色那个类丢了');
  });
  test('每个类名都带 ld- 前缀', () => {
    for (const c of classes) ok(c.startsWith('ld-'), `裸类名 ${c} 会撞宿主样式`);
  });
  test('宿主样式表里不出现这些类', () => {
    const hosts = ['app/style.css', 'extension/learn/review.css', 'extension/options/options.css'].filter((f) => fs.existsSync(path.join(ROOT, f)));
    ok(hosts.length >= 2, '宿主样式表没找到');
    for (const h of hosts) {
      const css = fs.readFileSync(path.join(ROOT, h), 'utf8');
      for (const c of classes) eq(new RegExp('\\.' + c + '(?![\\w-])').test(css), false, `${h} 定义了 .${c}`);
    }
  });
  test('按钮选择器带 .ld-row，特异度压过宿主的 button.<class>', () => {
    ok(/\.ld-row \.ld-ok \{[^}]*color: #fff/.test(src), '确定键的白字要写在 .ld-row .ld-ok 下');
    ok(/\.ld-row \.ld-ok\.ld-danger/.test(src), '危险色要写在 .ld-row .ld-ok.ld-danger 下');
  });
});
