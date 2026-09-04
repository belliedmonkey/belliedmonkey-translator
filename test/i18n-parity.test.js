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

// 基准 = manifest 的 default_locale：任何 locale 缺的键，运行时都回落到它。
// 基准本身缺键则谁也救不了，那是下面第二条测试。
//
// 2026-09-04 从 zh_CN 改成 en，跟着 manifest 走（见 build.js 的 defaultLocaleGate：
// 没做本地化的市场此前装完看到的是中文界面，而那是 21.5% 的下载量）。
// **从 manifest 读，不写死** —— 两个地方各存一份「兜底语言是谁」，迟早会各说各话。
const BASE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'),
).default_locale;

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

  test('UI 文案里不许出现 markdown 标记 —— 这里没有渲染器，星号会原样显示', () => {
    // 第二次栽在同一件事上了：
    //   2026-08-17 `learn_section_hint` 的 zh_CN/zh_TW 把 **粗体** 写进纯文本串，
    //     在中国版商店截图里被一眼看见。
    //   2026-08-21 `options_custom_api_hint` 与 `drive_play_notes_note` 同样中招，
    //     13 条 × 11 个 locale，又是在重拍截图时看见的。
    // 「靠人在截图里看见」不是办法 —— 那要等到提审前才发现，而且只在被截到的那一屏。
    // i18n 串进的是 textContent，浏览器不做 markdown 渲染。
    const BAD = /\*\*[^*]+\*\*|__[^_]+__|(?:^|[^`])`[^`]+`/;
    for (const loc of LOCALES) {
      const has = load(loc);
      const hits = Object.keys(has).filter((k) => BAD.test(String((has[k] || {}).message || '')));
      eq(hits.length, 0,
        `${loc} 有 ${hits.length} 条文案带 markdown 标记（界面上会原样显示）：`
        + hits.slice(0, 6).join(', '));
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

// ── 占位符：兜底串与出货串必须声明同一批 {token} ───────────────────────────
//
// 2026-08-31 真机截图实证的一条缝：`engine-test.js` 写的是
// `t('engine_test_url', '请求地址：{u}').replace('{u}', url)`，而 11 个 locale 写的
// 都是 `{url}`。代码 replace 的是 `{u}`，出货串里没有这个记号，于是自检结果那一行
// 在**每一台真机**上原样显示「请求地址：{url}」。
//
// 为什么此前所有门禁都看不见：兜底串只在 locale 缺键时才生效，而 i18n-parity 保证
// 了一个都不缺 —— 也就是说，**兜底串这条路在生产里永远走不到**。开发者读代码只看得
// 到能自洽的那一份。
//
// 判据取「兜底串 vs 出货串的占位符集合相等」，而不是去解析 `.replace()` 链：后者要
// 跨行、要处理任意实参，解析器本身就会成为下一个假绿的来源。兜底串是作者对「这条
// 消息有哪些槽」的声明，拿它当基准既准确又便宜。
describe('i18n: 占位符在兜底串与 11 份译文之间必须一致', () => {
  const SRC = path.join(__dirname, '..', 'extension');
  const jsFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_locales') walk(p); }
      else if (e.name.endsWith('.js') && !e.name.endsWith('.gen.js')) jsFiles.push(p);
    }
  })(SRC);

  // t('key', '兜底串') —— 兜底串里不含单引号的那些（含转义引号的极少，漏掉它们
  // 只是少验几条，不会造成假绿）。
  const CALL = /\bt\(\s*'([a-z0-9_]+)'\s*,\s*'([^'\\]*)'\s*\)/g;
  const slots = (s) => (String(s).match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || []).sort().join(',');

  const seen = new Map();   // key → { file, fallback }
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = CALL.exec(src))) {
      if (!seen.has(m[1])) seen.set(m[1], { file: path.relative(SRC, f), fallback: m[2] });
    }
  }

  test('扫到的 t() 调用足够多 —— 正则失配会让这一组静默空转', () => {
    ok(seen.size >= 200, `只扫到 ${seen.size} 个 t() 调用，远少于预期 —— 正则或目录走歪了`);
  });

  for (const loc of LOCALES) {
    test(`${loc}：每条消息的占位符与代码里的兜底串一致`, () => {
      const msgs = load(loc);
      const bad = [];
      for (const [key, { file, fallback }] of seen) {
        const m = msgs[key];
        if (!m || typeof m.message !== 'string') continue;   // 缺键是上面那组的事
        const want = slots(fallback);
        const got = slots(m.message);
        if (want !== got) {
          bad.push(`${key}（${file}）：代码声明 [${want || '无'}]，${loc} 写的是 [${got || '无'}]`);
        }
      }
      eq(bad.length, 0,
        '占位符对不上 —— 代码 replace 的记号在出货串里不存在，用户会原样看到花括号：\n  '
        + bad.join('\n  '));
    });
  }
});
