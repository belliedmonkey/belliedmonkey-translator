// scripts/lib/contrast.js — WCAG 2.x 对比度，一份实现两处用。
//
// Node 侧：test/palette-contrast.test.js 直接 require，对注册表 token 两两算比值。
// 页面侧：scripts/lib/sweep.js 把 `PAGE_SRC` 以字符串注入真 Chrome，对渲染后的
// 元素算比值 —— 同一段代码，所以「注册表算出来 5.7」与「页面上量出来 5.7」不会
// 因为两份公式而对不上。
//
// 为什么现在才有：2026-09-06 用户报「引导页申请 key 的链接在深色模式下看不清」——
// 那个 <a> 全仓库没人给 color，走浏览器默认蓝 #0000EE，深色底上 1.9:1。而所有门禁
// 里的「表面扫描」只判 fg === bg 的字符串相等，且只跑浅色。比值是唯一能说出
// 「看得清」的数字，所以它必须是函数，不是形容词。

// ── 页面与 Node 共用的那一段（纯 ES5，因为要注入到任意页面）────────────────
const PAGE_SRC = `
function __mtParseColor(s) {
  // 'rgb(1, 2, 3)' | 'rgba(1, 2, 3, .5)' | '#abc' | '#aabbcc' | 'transparent'
  if (!s) return null;
  s = String(s).trim();
  var m = /^rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*(?:,\\s*([\\d.]+))?\\s*\\)$/.exec(s)
    || /^rgba?\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*(?:\\/\\s*([\\d.%]+))?\\s*\\)$/.exec(s);
  if (m) {
    var a = m[4] === undefined ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }
  var h = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (h) {
    var x = h[1];
    if (x.length === 3 || x.length === 4) x = x.split('').map(function (c) { return c + c; }).join('');
    var a2 = x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16), a: a2 };
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}
function __mtLuminance(c) {
  var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
// 把带 alpha 的前景铺到不透明的背景上（simple alpha compositing）。
function __mtCompose(fg, bg) {
  var a = fg.a === undefined ? 1 : fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function __mtRatio(fg, bg) {
  var f = __mtCompose(fg, bg), l1 = __mtLuminance(f), l2 = __mtLuminance(bg);
  var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
`;

// ── Node 侧包装 ─────────────────────────────────────────────────────────────
const vm = require('vm');
const ctx = vm.createContext({});
vm.runInContext(PAGE_SRC, ctx);
const parseColor = (s) => ctx.__mtParseColor(s);
const luminance = (s) => ctx.__mtLuminance(parseColor(s));
// ratio('#8c491a', '#f5ead8') → 5.72
function ratio(fg, bg) {
  const f = parseColor(fg), b = parseColor(bg);
  if (!f || !b) throw new Error(`contrast.ratio: unparsable colour ${fg} / ${bg}`);
  return ctx.__mtRatio(f, { r: b.r, g: b.g, b: b.b, a: 1 });
}
// 把一个颜色沿「变暗」方向按 2% 步进，直到与 bg 的比值 ≥ want。用于给出「最近一档」
// 而不是拍脑袋选色。返回 #rrggbb。
function darkenUntil(hex, bg, want) {
  let c = parseColor(hex);
  for (let i = 0; i < 60; i++) {
    if (ctx.__mtRatio(c, parseColor(bg)) >= want) break;
    c = { r: c.r * 0.98, g: c.g * 0.98, b: c.b * 0.98, a: 1 };
  }
  const h = (v) => Math.round(v).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

module.exports = { PAGE_SRC, parseColor, luminance, ratio, darkenUntil, AA_TEXT: 4.5, AA_LARGE: 3 };
