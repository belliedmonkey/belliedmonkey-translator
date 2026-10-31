// test/rate-row.test.js — 译文末尾的评分提示行（第八期 C，2026-09-10）。
//
// 三件事钉住：
//   ① .mt-rate-row 的颜色与 .mt-translation 逐字相同（浅 / 深两色各一对）—— sweep.js 的
//      对比度门禁不扫内容脚本注入的 DOM，所以这一行的可读性只能靠「与译文同色」来继承
//      译文那对已经过审的颜色。
//   ② 两块 content_scripts（YouTube / <all_urls>）都带 learn/app-link.js + learn/feedback.js，
//      且在 content-webpage.js 之前 —— 内容脚本里 MTFeedback 是 typeof 守卫的，漏了不会红，
//      只会让评分行永远不出现。
//   ③ 评分行的点击处理里 window.open（MTFeedback.open）在 markRatingAsked 之前 ——
//      user-gesture.test.js 扫的是 await，这里补「顺序」。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const ROOT = path.join(__dirname, '..');

describe('评分提示行', () => {
  test('颜色与 .mt-translation 同一对（浅 / 深）', () => {
    const css = fs.readFileSync(path.join(ROOT, 'extension/styles/bilingual.css'), 'utf8');
    const color = (sel, dark) => {
      const src = dark ? css.slice(css.indexOf('prefers-color-scheme: dark')) : css.slice(0, css.indexOf('prefers-color-scheme: dark'));
      const blocks = [...src.matchAll(new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}', 'g'))];
      for (const b of blocks) { const m = /(?:^|\s)color:\s*([^;]+);/.exec(b[1]); if (m) return m[1].trim(); }
      return null;
    };
    for (const dark of [false, true]) {
      const a = color('.mt-translation', dark), b = color('.mt-rate-row', dark);
      ok(a && b, `两条规则都要有 color（dark=${dark}）`);
      eq(b, a, `.mt-rate-row 的颜色要与 .mt-translation 相同（dark=${dark}）`);
    }
  });
  test('两块 content_scripts 都在 content-webpage.js 之前带 app-link + feedback', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
    const blocks = m.content_scripts.filter((b) => b.js.includes('content/content-webpage.js'));
    eq(blocks.length, 2);
    for (const b of blocks) {
      const i = (f) => b.js.indexOf(f);
      ok(i('learn/app-link.js') >= 0 && i('learn/feedback.js') >= 0, `${b.matches[0]}: 缺 app-link / feedback`);
      ok(i('learn/app-link.js') < i('learn/feedback.js'), 'feedback 依赖 app-link，顺序不能反');
      ok(i('learn/feedback.js') < i('content/content-webpage.js'), 'feedback 要在 content-webpage 之前');
    }
  });
  // 2026-09-25 起这一行有两个目的地（§3.12）：Safari 走 AppLink.open（自定义 scheme），
  // Chrome / Firefox 用 window.open 打开扩展复习页。两条都必须先开再记 —— 第一版落地时
  // Safari 那一支写反了，是这条测试抓到的。
  test('点击那一行：两个目的地都先打开、再 markRatingAsked（手势只在第一次 await 之前有效）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'extension/content/content-webpage.js'), 'utf8');
    for (const opener of ['AppLink.open(settings.learnUserId', "window.open(chrome.runtime.getURL('learn/review.html')"]) {
      const i = src.indexOf(opener);
      const j = src.indexOf('MTFeedback.markRatingAsked()', i);
      ok(i > 0, '找不到打开目的地的那一行：' + opener);
      // 在同一个 onclick 里：从打开处往回找最近的 onclick，markRatingAsked 必须在打开之后、下一个 onclick 之前
      const nextHandler = src.indexOf('.onclick = (ev)', i);
      ok(j > i && (nextHandler < 0 || j < nextHandler), 'markRatingAsked 必须在打开之后：' + opener);
      const k = src.lastIndexOf('.onclick = (ev)', i);
      const before = src.slice(k, i);
      ok(!before.includes('markRatingAsked'), '打开之前不许先写存储：' + opener);
    }
  });
});
