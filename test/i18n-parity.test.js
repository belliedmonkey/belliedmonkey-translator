// test/i18n-parity.test.js — 11 份 messages.json 必须是同一个键集。
//
// 为什么现在才有这道门：在此之前，「加 UI 文案要改 11 个文件」靠的是 CLAUDE.md 里的
// 一句提醒和人的记性。仓库自己对这种安排有一句话——**a list a human must remember to
// extend is not a gate, it is a wish**（domain-design §7 的注册表论证）。而漏掉的代价
// 不是报错：`chrome.i18n.getMessage` 对不存在的键返回空字符串，所以漏一份 locale 的
// 表现是那个语言下**一个空白的按钮**，只有说那门语言的人才看得见。
//
// 这道门只管键集，不管译文质量：一个键存在但内容是英文原文，这里会过。那是刻意的——
// 「先让所有语言都有这个键」与「译得好不好」是两件事，把后者塞进单元测试只会让人为了
// 让测试变绿而乱填。
//
// 反过来它管一件容易被忽略的事：**空字符串等于没有这个键**。en 有键、ja 是 ""，运行时
// 表现与 ja 缺键一字不差，所以这里把它当缺失处理。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const DIR = path.join(__dirname, '..', 'extension', '_locales');
const LOCALES = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'messages.json')));
const load = (l) => JSON.parse(fs.readFileSync(path.join(DIR, l, 'messages.json'), 'utf8'));

// zh_CN 是 manifest 的 default_locale，所以它是事实上的基准：任何 locale 缺的键，
// 运行时都回落到它。基准本身缺键则谁也救不了，那是下面第二条测试。
const BASE = 'zh_CN';

describe('i18n: 11 份 messages.json 是同一个键集', () => {
  test('每一份 locale 都存在且是合法 JSON', () => {
    ok(LOCALES.length >= 11, `只找到 ${LOCALES.length} 份 locale，少于 11 —— 有目录被删了？`);
    ok(LOCALES.includes(BASE), `基准 locale ${BASE} 不见了`);
  });

  const baseKeys = Object.keys(load(BASE));

  test('没有 locale 缺键 —— 缺键在界面上是一个空白控件，不是一条报错', () => {
    for (const loc of LOCALES) {
      const has = load(loc);
      const missing = baseKeys.filter((k) => !(k in has));
      eq(missing.length, 0,
        `${loc} 缺 ${missing.length} 个键：${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
    }
  });

  test('没有 locale 多出基准没有的键 —— 那是删键时漏删，会一直腐烂下去', () => {
    const baseSet = new Set(baseKeys);
    for (const loc of LOCALES) {
      const extra = Object.keys(load(loc)).filter((k) => !baseSet.has(k));
      eq(extra.length, 0,
        `${loc} 多出 ${extra.length} 个键：${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' …' : ''}`);
    }
  });

  test('没有空 message —— 空字符串与缺键在运行时完全一样', () => {
    for (const loc of LOCALES) {
      const has = load(loc);
      const blank = Object.keys(has).filter((k) => !String((has[k] && has[k].message) || '').trim());
      eq(blank.length, 0,
        `${loc} 有 ${blank.length} 个空文案：${blank.slice(0, 8).join(', ')}`);
    }
  });

  test('每条都有 message 字段 —— 结构写错时 getMessage 静默返回空', () => {
    for (const loc of LOCALES) {
      const has = load(loc);
      for (const k of Object.keys(has)) {
        ok(has[k] && typeof has[k].message === 'string',
          `${loc}/${k} 没有字符串 message 字段`);
      }
    }
  });
});
