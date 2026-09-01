// test/try-pages.test.js — 试翻页的目标语言全集，必须与设置页那个下拉逐条一致。
//
// 「现在翻一页看看」按目标语言选页（QuickSetup.tryUrl）。表里漏掉一个语言，那个
// 用户会**静默回落到 setup.html** —— 没有报错、没有 404、没有任何东西会红，他只是
// 打开一页语言不对的示例，而这一页存在的全部理由就是语言要对。
//
// 所以这里把三处钉在一起：
//   1. 设置页下拉（用户能选的目标语言，唯一的事实来源）
//   2. build/try-pages.config.js 的 TARGETS（生成哪些页）
//   3. quick-setup.js 的 TRY_LANGS（运行时决定跳哪一页）
// 任何两处不一致都说明有一批用户到不了对的页。
//
// 顺带钉住这一页的**构成要件**：示例段落的语言必须**不等于**目标语言。这是它与
// setup.html 的唯一区别，也是它被造出来的原因。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const { PASSAGES, TARGETS } = require(path.join(ROOT, 'build/try-pages.config.js'));

// 设置页下拉里的目标语言。读 HTML 而不是维护第二份清单 —— 那份清单和界面分家的
// 那天，这道门禁就变成了摆设。
function optionLangs() {
  const html = fs.readFileSync(path.join(ROOT, 'extension/options/options.html'), 'utf8');
  const i = html.indexOf('id="target-lang"');
  const j = html.indexOf('</select>', i);
  ok(i > 0 && j > i, 'options.html 里找不到 #target-lang 的 <select> —— 读法走歪了');
  return [...html.slice(i, j).matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
}

function runtimeLangs() {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'extension/learn/quick-setup.js'), 'utf8'));
  const m = src.match(/const TRY_LANGS = \[([^\]]+)\]/);
  ok(!!m, 'quick-setup.js 里找不到 TRY_LANGS');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

describe('试翻页：目标语言三处一致', () => {
  const ui = optionLangs();
  const table = TARGETS.map((t) => t.code);
  const runtime = runtimeLangs();

  test('扫到了 —— 扫不到东西的断言不是门禁', () => {
    ok(ui.length >= 10, `设置页下拉只读到 ${ui.length} 个语言，读法走歪了？`);
  });

  test('★ 注册表 = 设置页下拉', () => {
    eq(table.slice().sort().join(','), ui.slice().sort().join(','),
      'build/try-pages.config.js 的 TARGETS 与设置页的目标语言下拉不一致 —— '
      + `多出：${table.filter((x) => !ui.includes(x)).join(',') || '无'}；`
      + `缺少：${ui.filter((x) => !table.includes(x)).join(',') || '无'}`
      + '（缺的那些语言的用户会静默落回 setup.html）');
  });

  test('★ 运行时 TRY_LANGS = 注册表', () => {
    eq(runtime.slice().sort().join(','), table.slice().sort().join(','),
      'quick-setup.js 的 TRY_LANGS 与注册表不一致 —— 页面生成了却没人跳过去，'
      + '或者跳去了一个没生成的页（404）');
  });

  test('★ 每一页的源语言都不等于目标语言 —— 这正是这一页存在的理由', () => {
    const bad = TARGETS.filter((t) => {
      const src = String(t.src);
      // zh-CN / zh-TW 都算中文：给一个目标繁中的人看简中示例同样自证不了。
      const fam = (c) => (String(c).startsWith('zh') ? 'zh' : String(c).split('-')[0]);
      return fam(src) === fam(t.code);
    });
    eq(bad.length, 0, '这些目标语言的示例段落跟目标同语言，翻了等于没翻：'
      + bad.map((t) => `${t.code}←${t.src}`).join(', '));
  });

  test('每个用到的源语言都有段落，且段落不是空的', () => {
    for (const t of TARGETS) {
      const p = PASSAGES[t.src];
      ok(!!p, `${t.code} 引用了不存在的源语言 ${t.src}`);
      ok(Array.isArray(p.paras) && p.paras.length >= 2,
        `${t.src} 的段落少于两段 —— 一段看不出「整页都翻」这件事`);
      // 20 而不是 40：这条断言要挡的是**占位符**（'TODO'、空串、一个词），而字符数
      // 这把尺子对不同文字松紧不同 —— CJK 每个字承载的意思是拉丁字母的两三倍，同样
      // 内容的中文段落字符数只有英文的三分之一。想同时卡紧两种文字就得换尺子，
      // 而「不是占位符」这件事用一个宽阈值已经判得了。
      for (const s of p.paras) {
        ok(String(s).trim().length > 20, `${t.src} 有一段太短，像占位符：${JSON.stringify(String(s).slice(0, 30))}`);
      }
      ok(String(p.endonym || '').trim().length > 0, `${t.src} 没有 endonym`);
    }
  });
});
