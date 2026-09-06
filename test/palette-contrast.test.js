// test/palette-contrast.test.js — 调色板注册表的角色对必须过 WCAG AA，浅色与深色各一遍。
//
// 2026-09-06：引导页「去申请 key」链接在深色下 1.9:1 —— 全仓库没有链接 token，三份样式表
// 没有 a 规则；顺手一量，浅色的次要文字 3.61:1、主按钮白字 3.61:1，整个浅色模式偏淡。
// 这里钉的是**注册表**那一半（token 两两组合），页面那一半由 scripts/lib/sweep.js 在真
// Chrome 里量渲染结果。两半用同一个 contrast.js，所以数字对得上。
const { describe, test, ok } = require('./harness');
const { tokensCss } = require('../build/palette.config.js');
const { ratio, AA_TEXT, AA_LARGE } = require('../scripts/lib/contrast.js');

// 把 tokensCss() 切成浅/深两张表：深色块只写覆盖项，其余沿用浅色。
function schemes() {
  const css = tokensCss();
  const dark = css.indexOf('@media (prefers-color-scheme: dark)');
  const grab = (s) => {
    const m = {};
    for (const x of s.matchAll(/--([a-z-]+):\s*([^;]+);/g)) m[x[1]] = x[2].trim();
    const cs = /(?:^|[\s{;])color-scheme:\s*([^;]+);/.exec(s);
    if (cs) m['color-scheme'] = cs[1].trim();
    return m;
  };
  const light = grab(css.slice(0, dark));
  return { light, dark: Object.assign({}, light, grab(css.slice(dark))) };
}

// 文字 × 底色：谁压在谁上面，在哪些底上出现。
const TEXT_ON = [
  ['text', ['bg', 'card-bg', 'section-bg', 'input-bg']],
  ['text-secondary', ['bg', 'card-bg', 'section-bg', 'input-bg']],
  ['link', ['bg', 'card-bg', 'section-bg']],
  ['accent-deep', ['bg', 'card-bg', 'section-bg']],
  ['sage-text', ['bg', 'card-bg', 'section-bg', 'sage-light']],
  ['danger', ['bg', 'card-bg', 'section-bg']],
];
// 大字 / UI 组件（图标、填色、状态点）：3:1。
const UI_ON = [
  ['accent', ['bg', 'card-bg']],
  ['sage', ['bg', 'card-bg']],
  ['sage-strong', ['bg', 'card-bg']],
];

describe('palette — 角色对的 WCAG 对比度（浅色 + 深色）', () => {
  const S = schemes();
  for (const scheme of ['light', 'dark']) {
    const T = S[scheme];
    test(`${scheme}: 有 --link，且 color-scheme 声明了`, () => {
      ok(T.link, '注册表没有 --link —— 链接就会回到浏览器默认蓝');
      ok(/light dark/.test(T['color-scheme'] || ''), 'color-scheme 缺席：深色下原生控件还是浅色皮');
    });
    for (const [fg, bgs] of TEXT_ON) for (const bg of bgs) {
      test(`${scheme}: --${fg} 在 --${bg} 上 ≥ ${AA_TEXT}:1`, () => {
        const r = ratio(T[fg], T[bg]);
        ok(r >= AA_TEXT, `${T[fg]} on ${T[bg]} = ${r.toFixed(2)}:1`);
      });
    }
    for (const [fg, bgs] of UI_ON) for (const bg of bgs) {
      test(`${scheme}: --${fg} 在 --${bg} 上 ≥ ${AA_LARGE}:1（UI 组件）`, () => {
        const r = ratio(T[fg], T[bg]);
        ok(r >= AA_LARGE, `${T[fg]} on ${T[bg]} = ${r.toFixed(2)}:1`);
      });
    }
    test(`${scheme}: 白字压在 --accent 填色按钮上 ≥ ${AA_TEXT}:1`, () => {
      const r = ratio('#ffffff', T.accent);
      ok(r >= AA_TEXT, `#ffffff on ${T.accent} = ${r.toFixed(2)}:1`);
    });
    test(`${scheme}: 白字压在 --accent-hover 上 ≥ ${AA_TEXT}:1（悬停不能反而看不清）`, () => {
      const r = ratio('#ffffff', T['accent-hover']);
      ok(r >= AA_TEXT, `#ffffff on ${T['accent-hover']} = ${r.toFixed(2)}:1`);
    });
    // 只钉卡片底：输入框与分割线都画在卡片上。奶油底上 1.25:1 是设计稿的柔和边，
    // 它不是「看不清」这条报障的对象，这里不替设计做决定。
    test(`${scheme}: --border 在 --card-bg 上看得见（≥ 1.3:1）`, () => {
      for (const bg of ['card-bg']) {
        const r = ratio(T.border, T[bg]);
        ok(r >= 1.3, `${T.border} on ${T[bg]} = ${r.toFixed(2)}:1`);
      }
    });
  }
});
