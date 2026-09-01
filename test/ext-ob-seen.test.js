// test/ext-ob-seen.test.js — extObSeen 是**流程标记**，不是配置标记。
//
// 它只回答一句话：「这个人看过扩展的引导页没有。」它与「配好了没有」正交，而且两个
// 方向都能拆开：
//
//   什么都没配、它却已置位  —— 任何一次「以后再设置」都会写它（onboard.js 的 finish）
//   配得好好的、它却没置位  —— 设置页点一下「重看引导」就会删掉它（options.js）
//
// 所以拿它当「配好了」的信号会立刻出错。2026-09-01 的全流程图把它列为十个判据里
// 唯一一个**与配置状态正交却被当成信号**的，用户裁定：钉住它只在一处被读。
//
// 这道门禁防的是未来，不是现在 —— 今天的三处用法都是对的。它要挡的是那种一眼看去
// 很顺的误用：「看过引导了，那应该配好了吧」。popup.js 里已经有一段注释在防同一族的
// 另一个误用（故意不复用 App 的 onboardSeen 键名，免得有人写出「App 看过了扩展就不用
// 看」的假联动）；一句提醒不是门禁，所以这里替人记着。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const KEY = 'extObSeen';

// 扫全部出货的扩展代码（不含 dist，不含 App —— App 用的是自己的 onboardSeen）。
function shipped() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_locales') walk(p); }
      else if (/\.(js|html)$/.test(e.name) && !e.name.endsWith('.gen.js')
        && e.name !== 'i18n-messages.js') out.push(p);
    }
  })(path.join(ROOT, 'extension'));
  return out;
}

function hits() {
  const found = [];
  for (const f of shipped()) {
    const src = fs.readFileSync(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (!line.includes(KEY)) continue;
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) continue;      // 注释不算用法
      found.push({ file: path.relative(path.join(ROOT, 'extension'), f), line: i + 1, text: t });
    }
  }
  return found;
}

describe('extObSeen 只回答「看过引导没有」', () => {
  const all = hits();

  test('扫到了它 —— 一条扫不到东西的断言不是门禁', () => {
    ok(all.length >= 3, `只扫到 ${all.length} 处 ${KEY}，扫描走歪了？`);
  });

  test('写它的只有引导页的 finish()', () => {
    const writers = all.filter((h) => /storageSet\(|storage\.local\.set/.test(h.text));
    eq(writers.length, 1, '写 extObSeen 的地方不止一处：\n  '
      + writers.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n  '));
    ok(writers[0].file === 'onboard/onboard.js',
      '写它的应当是引导页的 finish()，实际在 ' + writers[0].file);
  });

  test('删它的只有设置页的「重看引导」', () => {
    const removers = all.filter((h) => /storage\.local\.remove/.test(h.text));
    eq(removers.length, 1, '删 extObSeen 的地方不止一处');
    ok(removers[0].file === 'options/options.js', '删它的应当是设置页，实际在 ' + removers[0].file);
  });

  test('★ 读它的只有弹窗一处 —— 多一处就是在拿它当「配好了」的信号', () => {
    const readers = all.filter((h) => !/storageSet\(|storage\.local\.(set|remove)/.test(h.text));
    const files = [...new Set(readers.map((h) => h.file))];
    eq(files.join(','), 'popup/popup.js',
      'extObSeen 被别的地方读了：\n  '
      + readers.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n  ')
      + '\n  它是流程标记，与「配好了没有」正交：按过「以后再设置」的人它已置位而一句'
      + '也翻不出来；点过「重看引导」的人配得好好的却没置位。'
      + '要判「配好了没有」，用 content/engine-state.js 的 needsSetup。');
  });

  test('它与 App 的 onboardSeen 不同名 —— 同名会长出「App 看过了扩展就不用看」的假联动', () => {
    for (const f of shipped()) {
      const src = fs.readFileSync(f, 'utf8');
      const bad = src.split('\n').map((l, i) => [i + 1, l])
        .filter(([, l]) => /['"]onboardSeen['"]/.test(l));
      eq(bad.length, 0, path.basename(f) + ' 用上了 App 的键名 onboardSeen：'
        + bad.map(([n, l]) => `${n}: ${l.trim()}`).join(' | ')
        + ' —— 两边存储不通，同名只会误导下一个读代码的人');
    }
  });
});
