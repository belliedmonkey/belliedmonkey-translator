// test/amo-copy.test.js — Firefox AMO 商店文案（store-assets/amo-listing.md）的门禁。
//
// 2026-08-30 促成它的两个缺陷，都是「上线了、没报错、页面上是坏的」：
//
//   ① description 只有 en-US 与 zh-CN 两个 locale，而 name/summary 有 10 个。
//      其余 8 个语言的用户看到的是 zh-CN（default_locale）—— 一屏中文。
//   ② en-US 里存的是**转义过的** `&lt;a href="…"&gt;`，AMO 又把它里面的裸网址
//      linkify 了一遍，于是英文商店页上直接显示一串两百字符的
//      `prod.outgoing.prod.webservices.mozgcp.net/v1/<hash>/…` 明文。
//
// 第二条的根因是 AMO 的 API **把 HTML 转义成文字**。写这道门禁的当天我自己又踩了
// 一次：把 `<a href>` PATCH 进去，返回 200、内容确实上线，只是九个 locale 的页面上
// 多了一行标签源码。裸网址交给 AMO linkify 才是对的，所以下面有一条「不许有标签」。
const { describe, test, ok, eq } = require('./harness');
const fs = require('fs');
const path = require('path');

const MD = fs.readFileSync(path.join(__dirname, '..', 'store-assets', 'amo-listing.md'), 'utf8');

// AMO 上 name/summary 已有的 10 个 locale。description 必须与它们对齐 ——
// 少一个就是那个语言的用户读 default_locale。
const LOCALES = ['de', 'en-US', 'es-ES', 'fr', 'ja', 'ko', 'pt-PT', 'ru', 'zh-CN', 'zh-TW'];

// 每个语种必须真的用它自己的文字写。拉丁语系无法这样判，改用「不等于 en-US」。
const SCRIPTS = {
  ja: /[぀-ヿ]/,        // 假名（汉字不够——中文也有）
  ko: /[가-힯]/,        // 谚文
  ru: /[Ѐ-ӿ]/,        // 西里尔
  'zh-CN': /[一-鿿]/,
  'zh-TW': /[一-鿿]/,
};

function parse(md) {
  const out = {};
  const re = /^## ([\w-]+) · description\n\n```\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(md))) out[m[1]] = m[2];
  return out;
}

const D = parse(MD);

describe('AMO 文案 — store-assets/amo-listing.md', () => {
  test('10 个 locale 齐全（与线上 name/summary 对齐）', () => {
    for (const l of LOCALES) ok(D[l], `缺 ${l} 的 description —— 该语言用户会读到 default_locale`);
    const extra = Object.keys(D).filter((l) => !LOCALES.includes(l));
    eq(extra.length, 0, `多出线上没有的 locale：${extra.join(', ')}`);
  });

  test('一个 HTML 标签都没有（AMO 的 API 会把它转义成可见文字）', () => {
    for (const l of LOCALES) {
      const m = (D[l] || '').match(/<[a-z][^>]*>/i);
      ok(!m, `${l} 里有 HTML 标签 ${m && m[0]} —— 商店页上会显示标签本身，交给 AMO linkify 裸网址`);
    }
  });

  test('每份都落到官网', () => {
    for (const l of LOCALES) {
      ok(/belliedmonkey\.cc/.test(D[l] || ''), `${l} 没有指向官网 —— 商店页是唯一能把人带去启用引导的地方`);
    }
  });

  test('每个语种用它自己的文字写，且不是 en-US 的副本', () => {
    for (const l of LOCALES) {
      if (l === 'en-US') continue;
      const re = SCRIPTS[l];
      if (re) ok(re.test(D[l]), `${l} 的文案里没有该语系的字符 —— 多半是粘成了英文`);
      ok(D[l] !== D['en-US'], `${l} 与 en-US 逐字相同 —— 漏译`);
    }
  });

  test('繁简不是同一份（zh-TW 直接复制 zh-CN 是最常见的偷懒）', () => {
    ok(D['zh-TW'] !== D['zh-CN'], 'zh-TW 与 zh-CN 逐字相同');
    ok(/[複習網頁影]/.test(D['zh-TW']), 'zh-TW 里没有繁体字形 —— 疑似简繁未转');
  });

  test('不点名具体引擎品牌（唯一来源是 build/providers.config.js）', () => {
    // 商店文案改不动那么勤，一旦点名就会比注册表更晚过期。说「你自己的 AI 服务密钥」。
    const BRANDS = ['OpenAI', 'ChatGPT', 'DeepSeek', 'Gemini', 'Anthropic', 'GLM', '智谱'];
    for (const l of LOCALES) {
      for (const b of BRANDS) {
        ok(!new RegExp(b, 'i').test(D[l]), `${l} 点名了 ${b} —— 注册表变了这里不会跟着变`);
      }
    }
  });

  test('长度在 AMO 的 15000 以内，且不至于短到没内容', () => {
    for (const l of LOCALES) {
      ok(D[l].length <= 15000, `${l} 超过 AMO 的 15000 字符上限`);
      ok(D[l].length >= 150, `${l} 只有 ${D[l].length} 字符 —— 疑似被截断`);
    }
  });
});
