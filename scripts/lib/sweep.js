// scripts/lib/sweep.js — 「表面扫描」：页面上每一段看得见的文字，在浅色**和**深色下都要看得清。
//
// 判据是 WCAG 比值，不是「前景 ≠ 背景」。原来的 __sweep（verify-learn-flow.js 与
// verify-sync-consistency.js 各一份）只判字符串相等，于是深色底上 1.9:1 的默认链接蓝
// 一路绿着上了三家商店（2026-09-06 用户报「引导页申请 key 的链接在深色下看不清」）。
// 而且所有门禁都只跑浅色 —— 这里的 sweepBoth 用 Emulation.setEmulatedMedia 切两遍。
//
// 页面侧 __sweep(scope) 返回一组人话（'a#qs-key-link「去申请 ↗」 1.9:1 rgb(0,0,238) on
// rgb(15,23,42)'），空数组即通过。规则：
//   · 可见（有几何、display/visibility/opacity 都在）且带**自有文字**的元素：正文 4.5:1，
//     大字（≥24px，或 ≥18.66px 且粗体）3:1；input/select/textarea 的当前值同样算文字。
//   · disabled / aria-disabled 跳过（它们就该淡）；placeholder 不算文字。
//   · 背景沿祖先链合成：半透明层压到下一层上，直到不透明；到根还没有就按 canvas
//     （color-scheme 深色时是深底，否则白底）。祖先的 opacity 乘进前景 alpha。
//   · button / a 没有任何可读标签（文字 / value / aria-label / title）也算坏 —— 老规则保留。
const { PAGE_SRC } = require('./contrast.js');

const SWEEP_FN = `
${PAGE_SRC}
function __sweep(scope) {
  var bad = [];
  var root = (scope && document.querySelector(scope)) || document.body;
  if (!root) return bad;
  var isDark = (function () {
    try { return matchMedia('(prefers-color-scheme: dark)').matches
      && /dark/.test(getComputedStyle(document.documentElement).colorScheme || ''); } catch (_) { return false; }
  })();
  var canvas = isDark ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  var vis = function (el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  var effOpacity = function (el) {
    var o = 1;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  // 从 el 往上找不透明底：把半透明层依次压到更下面那层上。
  var ground = function (el) {
    var layers = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var c = __mtParseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    var bg = canvas;
    if (layers.length && layers[layers.length - 1].a >= 1) bg = layers.pop();
    while (layers.length) bg = __mtCompose(layers.pop(), bg);
    return bg;
  };
  var ownText = function (el) {
    var t = '';
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += c.nodeValue;
    return t.replace(/\\s+/g, ' ').trim();
  };
  var disabled = function (el) {
    return !!(el.disabled || el.closest('[disabled], [aria-disabled="true"]'));
  };
  var name = function (el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/)[0] : '');
  };
  var fmt = function (c) { return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')'; };
  var els = root.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg' || el.closest('svg')) continue;
    if (!vis(el)) continue;
    var isField = tag === 'input' || tag === 'select' || tag === 'textarea';
    var text = isField ? ((el.type === 'password' || el.type === 'checkbox' || el.type === 'range') ? '' : String(el.value || ''))
      : ownText(el);
    if (tag === 'button' || tag === 'a') {
      var label = (el.textContent || el.value || el.getAttribute('aria-label') || el.title || '').trim();
      if (!label) { bad.push(name(el) + ' 无文字'); continue; }
    }
    if (!text || disabled(el)) continue;
    var cs = getComputedStyle(el);
    var fg = __mtParseColor(cs.color);
    if (!fg) continue;
    fg.a = (fg.a === undefined ? 1 : fg.a) * effOpacity(el);
    var bg = ground(el);
    var px = parseFloat(cs.fontSize) || 16;
    var bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    var want = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
    var r = __mtRatio(fg, bg);
    if (r < want) {
      bad.push(name(el) + '「' + text.slice(0, 18) + '」 ' + r.toFixed(2) + ':1 (' + fmt(__mtCompose(fg, bg)) + ' on ' + fmt(bg) + ')');
    }
  }
  return bad;
}
`;

// Node 侧：装进页面，然后两种配色各扫一遍。
async function installSweep(cdp, sessionId) {
  await cdp.send('Runtime.evaluate', { expression: `(() => { ${SWEEP_FN}\nwindow.__sweep = __sweep; return 'ok'; })()` }, sessionId);
}
async function setScheme(cdp, sessionId, scheme) {
  await cdp.send('Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId);
  await new Promise((r) => setTimeout(r, 60));   // 让样式重算落地
  // 切配色会触发 `transition: color .2s` 之类的过渡 —— 60ms 后量到的是**半路上的颜色**
  // （危险按钮量出 rgb(216,74,70)，两套 token 里都没有这个值，是浅红→深红的中点）。
  // 把所有进行中的过渡直接跳到终点，再量。
  await cdp.send('Runtime.evaluate', { expression:
    "(() => { try { document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) {} }); } catch (_) {} return 'ok'; })()" }, sessionId);
  await new Promise((r) => setTimeout(r, 30));
}
// 返回坏项数组，每项带配色前缀。只装了 __sweep 的页面才能调（installSweep 或
// addScriptToEvaluateOnNewDocument 里带上 SWEEP_FN）。扫完回到浅色。
async function sweepBoth(cdp, sessionId, scope) {
  const out = [];
  for (const scheme of ['dark', 'light']) {
    await setScheme(cdp, sessionId, scheme);
    const r = await cdp.send('Runtime.evaluate',
      { expression: `__sweep(${JSON.stringify(scope || 'body')})`, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error('__sweep 抛了: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    for (const b of (r.result && r.result.value) || []) out.push((scheme === 'dark' ? '（深色）' : '（浅色）') + b);
  }
  return out;
}

module.exports = { SWEEP_FN, installSweep, setScheme, sweepBoth };
