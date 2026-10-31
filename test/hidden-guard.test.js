// test/hidden-guard.test.js — 每一个页面外壳的样式表都必须让 `hidden` 真的隐藏。
//
// UA 样式表的 `[hidden] { display: none }` 输给作者样式表里**任何一条** display
// 声明。所以 `#ob-engine { display: flex }` 这一行，就让整个页面的 `hidden` 属性
// 对它失效 —— 而 JS 读回 `el.hidden` 仍然是 true，控制台里一切正常。
//
// 这个 bug 在这个仓库里犯过两次：
//   · options.css:1-7 —— `.pressure{display:flex}` 让一个「零张卡可回收」的按钮常驻，
//     对着一个不存在的问题喊话；
//   · onboard.css —— `#ob-engine, #ob-capture { display: flex }`，2026-08-31 真机
//     截图实证：引擎块漏在欢迎屏上，下拉「无选项」、测试按钮没有文字（因为那一屏
//     根本没跑 paintEngine），用户点了那个神秘按钮，拿到一句「这个版本不认识当前
//     存着的引擎」。
//
// 第一次犯的时候，修法是在 options.css 顶上写一行注释说「以后每个 display 规则都
// 要记得」。第二次证明了那句话的价值：**a list a human must remember to extend is
// not a gate, it is a wish.** 所以这里改成机器记着。
//
// 判据故意宽松（有这条规则即可，不检查它在文件的哪一行）：真正要防的是「新页面
// 忘了写」，而不是排版。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const GUARD = /\[hidden\][^{]*\{[^}]*display\s*:\s*none[^}]*!important/i;

// 页面外壳 = 有 <html> 的那些。注入到别人页面上的样式表（bilingual.css /
// floating-button.css）不拥有一个 document，不在此列。
function pages() {
  const out = [];
  for (const dir of ['extension', 'app']) {
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
        else if (e.name.endsWith('.html')) {
          const html = fs.readFileSync(p, 'utf8');
          if (/<html[\s>]/i.test(html)) out.push({ file: p, html });
        }
      }
    })(path.join(ROOT, dir));
  }
  return out;
}

describe('每个页面外壳都必须让 hidden 真的隐藏', () => {
  const found = pages();

  test('扫到了页面 —— 一条扫不到东西的断言不是门禁', () => {
    ok(found.length >= 4, `只扫到 ${found.length} 个页面外壳，目录走歪了？`);
  });

  for (const { file, html } of found) {
    const rel = path.relative(ROOT, file);
    test(`${rel}：链进来的样式表里有 [hidden]{display:none!important}`, () => {
      const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/gi)].map((m) => m[1]);
      const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
      // href 按**出货时的布局**写，源码树里可能解析不到（app/index.html 链的是
      // `../Style.css`：装出来以后 index 在 Base.lproj/、样式在包根）。所以解析不到
      // 时按文件名在这一页所属的顶层目录里找一次 —— 大小写不敏感，因为那次搬运
      // 顺带把 style.css 改成了 Style.css。
      const top = path.join(ROOT, path.relative(ROOT, file).split(path.sep)[0]);
      const byName = new Map();
      (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const q = path.join(d, e.name);
          if (e.isDirectory()) walk(q);
          else if (e.name.toLowerCase().endsWith('.css')) byName.set(e.name.toLowerCase(), q);
        }
      })(top);

      const texts = [];
      const unresolved = [];
      for (const h of hrefs) {
        const direct = path.resolve(path.dirname(file), h);
        const p = fs.existsSync(direct) ? direct : byName.get(path.basename(h).toLowerCase());
        if (p && fs.existsSync(p)) texts.push(fs.readFileSync(p, 'utf8'));
        else unresolved.push(h);
      }
      ok(unresolved.length === 0,
        `${rel} 链了解析不到的样式表：${unresolved.join(', ')} —— 页面会裸奔，而浏览器不报错`);
      texts.push(...inline);
      ok(texts.length > 0, `${rel} 一个样式表都没链上 —— href 写错了？`);
      ok(texts.some((t) => GUARD.test(t)),
        `${rel} 的样式表里没有 [hidden]{display:none!important}。`
        + '任何一条作用在同一元素上的 display 声明都会让 hidden 静默失效，'
        + `而 JS 读回 el.hidden 仍然是 true。样式表：${hrefs.join(', ') || '(仅内联)'}`);
    });
  }
});
