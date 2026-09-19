// test/app-html-i18n.test.js — App 外壳（app/index.html）里写死的中文，必须有人负责换掉。
//
// App 的界面文案有两条本地化的路：元素带 data-i18n，由 applyI18n 换；或者元素有 id，
// 由脚本 `$('<id>').textContent = t(...)` 设。两条都不走的中文，在英文、日文……界面里
// 就原样露出来。
//
// 2026-09-15 促成它的缺陷：对话 / 实时字幕页的「● 实时」角标写死在 HTML 里，listen.js
// 只切 hidden、从不设文字 —— 于是英文 App 在听的时候，上卡右上角挂着一个中文角标。
// 发现它的不是任何门禁，而是拍英文商店截图时肉眼看到的。
//
// 判据：带中文文字的叶子元素，要么带 data-i18n，要么它的 id 在 App 脚本里被设过
// textContent / innerHTML。例外只有两类，都写在下面：品牌名，和语言选择里的自称
// （「日本語」在任何界面语言下都该写成「日本語」）。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
const JS = fs.readdirSync(path.join(ROOT, 'app'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'))
  .join('\n');

const BRAND = '大肚猴翻译';
const CJK = /[一-鿿]/;

function setsText(id) {
  const q = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\$\\(['"]${q}['"]\\)\\.(textContent|innerHTML)\\s*=`).test(JS)
    || new RegExp(`getElementById\\(['"]${q}['"]\\)\\.(textContent|innerHTML)\\s*=`).test(JS);
}

describe('App 外壳 — app/index.html 没有无人本地化的中文', () => {
  test('每段中文要么 data-i18n，要么由脚本按 id 设文字', () => {
    const re = /<(\w+)\b([^>]*)>([^<]*)<\/\1>/g;
    const bad = [];
    let m;
    while ((m = re.exec(HTML))) {
      const [, tag, attrs, raw] = m;
      const text = raw.trim();
      if (!CJK.test(text)) continue;
      if (/\bdata-i18n=/.test(attrs)) continue;
      if (text === BRAND) continue;
      // 语言的 endonym 按定义不翻译。两个选择器：界面语言用 Chrome 的 locale 码（zh_CN），
      // 「译成」（2026-09-19）用目标语言码（zh-CN）。
      if (tag === 'option' && /\bvalue="(zh_CN|zh_TW|zh-CN|zh-TW|ja)"/.test(attrs)) continue;
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
      if (id && setsText(id)) continue;
      bad.push(`<${tag}${id ? ` id="${id}"` : ''}>${text}`);
    }
    ok(bad.length === 0, `这些中文在非中文界面里会原样露出：\n  ${bad.join('\n  ')}`);
  });
});
