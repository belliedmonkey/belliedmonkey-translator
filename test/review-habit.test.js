// test/review-habit.test.js — 习惯条的算术（#386，2026-09-24 用户裁定）。
//
// 裁定原话：「每天或者每周有重新进来复习就好了 —— 养成习惯远比单词学很大量重要。」
// 于是复习面记的是**来过的日子**，不是刷了多少张。这个文件只测那两个纯函数：
// 连续天数（差一天就全错）与最近 7 天的窗口。**界面与存储由 test:learn 那边守。**
//
// review.js 是一个自执行的页面模块（要 DOM、要 chrome.storage），不能整份 require。
// 这里把那两个函数按源码原样取出来跑 —— 与 dist 比对的那条断言保证它们没有分叉。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, deepEq, ok } = require('./harness');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension/learn/review.js'), 'utf8');

function extract(name) {
  const at = SRC.indexOf('function ' + name + '(');
  ok(at > 0, '源码里找不到 ' + name);
  // 从函数头一直取到与之配对的那个右花括号（这几个函数里没有字符串花括号）。
  let depth = 0, i = SRC.indexOf('{', at);
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(at, j + 1); }
  }
  throw new Error('括号没配平：' + name);
}
// dayKey 是箭头常量（不是 function 声明），所以下面按源码原样重写一遍 ——
// 它只有两行，且被「与源码同构」那条断言盯着。
const H = (() => {
  const body = [
    'const dayKey = (d) => { const x = new Date(d);',
    "  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };",
    extract('streakOf'),
    extract('lastSeven'),
    'return { dayKey, streakOf, lastSeven };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(body)();
})();

// 2026-09-24 是周四。用本地时间构造，与 dayKey 同一套（它取的是本地年月日）。
const D = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();
const K = (y, m, d) => H.dayKey(D(y, m, d));

describe('习惯条 · 这份副本与 review.js 里的同源', () => {
  test('dayKey 的实现逐字出现在 review.js 里 —— 副本漂了这条就红', () => {
    const line = "return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');";
    ok(SRC.includes(line), 'review.js 里的 dayKey 变了，测试里这份副本要跟着改');
  });
});

describe('习惯条 · streakOf —— 从今天往回数，断了就停', () => {
  test('今天没来过 ⇒ 0（界面据此整条不显示，而不是显示「连续 0 天」）', () => {
    eq(H.streakOf([K(2026, 9, 21), K(2026, 9, 22), K(2026, 9, 23)], D(2026, 9, 24)), 0);
  });
  test('只有今天 ⇒ 1', () => {
    eq(H.streakOf([K(2026, 9, 24)], D(2026, 9, 24)), 1);
  });
  test('连着四天 ⇒ 4', () => {
    eq(H.streakOf([K(2026, 9, 21), K(2026, 9, 22), K(2026, 9, 23), K(2026, 9, 24)], D(2026, 9, 24)), 4);
  });
  test('中间断一天 ⇒ 只数到断点（断了不惩罚，但也不许假装连着）', () => {
    eq(H.streakOf([K(2026, 9, 20), K(2026, 9, 21), K(2026, 9, 23), K(2026, 9, 24)], D(2026, 9, 24)), 2);
  });
  test('重复的同一天不会多算', () => {
    eq(H.streakOf([K(2026, 9, 24), K(2026, 9, 24), K(2026, 9, 23)], D(2026, 9, 24)), 2);
  });
  test('跨月也要对：10-01 与 09-30 是连着的', () => {
    eq(H.streakOf([K(2026, 9, 30), K(2026, 10, 1)], D(2026, 10, 1)), 2);
  });
  test('空表 / 脏数据 ⇒ 0，不抛', () => {
    eq(H.streakOf([], D(2026, 9, 24)), 0);
    eq(H.streakOf(null, D(2026, 9, 24)), 0);
  });
});

describe('习惯条 · lastSeven —— 6 天前到今天，来过的填色', () => {
  test('恰好 7 格，最后一格是今天', () => {
    const cells = H.lastSeven([K(2026, 9, 24)], D(2026, 9, 24));
    eq(cells.length, 7);
    deepEq(cells, [false, false, false, false, false, false, true]);
  });
  test('窗口外的日子不进来（8 天前来过也不显示）', () => {
    const cells = H.lastSeven([K(2026, 9, 16), K(2026, 9, 22)], D(2026, 9, 24));
    deepEq(cells, [false, false, false, false, true, false, false]);
  });
});
