// test/app-listen-grid.test.js — 对话 / 实时字幕页的宽屏网格：每个子元素都要有自己的格子。
//
// ≥720px 时 #app-listen 是具名网格（app/style.css 的 grid-template-areas）。后来加进页面的
// 元素如果没写 grid-area，就被自动放置 —— 落到哪一格没人说得准；和别人共用一个 class 的，
// 还会继承同一个 grid-area，两个元素叠在同一格里。两种都不报错，JS 读回来一切正常。
//
// 2026-09-15 拍 1.11.0 商店截图时两种都看到了：Mac 宽屏对话页上「朗读译文」与「这次不留
// 记录」两行字叠在一起（同为 .listen-autospeak ⇒ 同为 speakrow）；iPad 实时字幕页「会话
// 已经开始……」那句说明跑到了右上角，离它解释的那个灰掉的勾选框隔着半个屏。
//
// 判据：section#app-listen 的每个直接子元素，在 720px 媒体块里都解析到一个 grid-area
// （id 规则优先于 class 规则，与 CSS 优先级一致：`:where()` 的优先级是 0），这个名字在
// grid-template-areas 里存在，且没有两个子元素解析到同一个名字。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function directChildren() {
  const start = HTML.indexOf('<section id="app-listen"');
  ok(start >= 0, 'app/index.html 里找不到 section#app-listen');
  const re = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g;
  re.lastIndex = HTML.indexOf('>', start) + 1;
  const VOID = /^(input|br|img|hr|meta|link|source|wbr)$/i;
  const out = [];
  let depth = 0, m;
  while ((m = re.exec(HTML))) {
    const [, close, tag, attrs] = m;
    if (close) { if (depth === 0) break; depth--; continue; }
    if (depth === 0) {
      out.push({
        tag,
        id: (attrs.match(/\bid="([^"]+)"/) || [])[1],
        cls: ((attrs.match(/\bclass="([^"]+)"/) || [])[1] || '').split(/\s+/).filter(Boolean),
      });
    }
    if (!VOID.test(tag)) depth++;
  }
  return out;
}

function wideBlock() {
  const at = CSS.search(/@media\s*\(min-width:\s*720px\)\s*\{[^}]*#app-listen[^{]*\{[^}]*grid-template-areas/);
  ok(at >= 0, 'style.css 里找不到 #app-listen 的 720px 网格块');
  let i = CSS.indexOf('{', at), depth = 0;
  const from = i;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') depth++; else if (CSS[i] === '}' && --depth === 0) break; }
  return CSS.slice(from + 1, i);
}

// position: fixed / absolute 的子元素（翻面大字那一层）不占格子，不在此列。
function outOfFlow(c) {
  const keys = [c.id && '#' + c.id, ...c.cls.map((k) => '.' + k)].filter(Boolean)
    .map((k) => new RegExp(k.replace(/[.#-]/g, '\\$&') + '(?![\\w-])'));
  for (const r of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/position\s*:\s*(fixed|absolute)/.test(r[2])) continue;
    if (r[1].split(',').some((sel) => keys.some((re) => re.test(sel)))) return true;
  }
  return false;
}

describe('对话 / 实时字幕页 — 宽屏网格里每个子元素有自己的格子', () => {
  test('直接子元素都解析到模板里存在、且互不重复的 grid-area', () => {
    const block = wideBlock();
    const tpl = (block.match(/grid-template-areas\s*:\s*([^;]+);/) || [])[1] || '';
    const names = new Set(tpl.match(/"[^"]*"/g).join(' ').replace(/"/g, ' ').split(/\s+/).filter((n) => n && n !== '.'));
    const byId = {}, byClass = {};
    for (const r of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const area = (r[2].match(/grid-area\s*:\s*([\w-]+)/) || [])[1];
      if (!area) continue;
      for (const sel of r[1].split(',').map((s) => s.trim())) {
        let x;
        if ((x = sel.match(/^#([\w-]+)$/))) byId[x[1]] = area;
        else if ((x = sel.match(/^:where\(#app-listen\)\s+\.([\w-]+)$/))) byClass[x[1]] = area;
      }
    }
    const problems = [];
    const seen = {};
    for (const c of directChildren()) {
      if (outOfFlow(c)) continue;
      const label = `<${c.tag}${c.id ? ` id="${c.id}"` : ''}${c.cls.length ? ` class="${c.cls.join(' ')}"` : ''}>`;
      const area = (c.id && byId[c.id]) || c.cls.map((k) => byClass[k]).find(Boolean);
      if (!area) { problems.push(`${label} 没有 grid-area —— 宽屏下会被自动放到不知道哪一格`); continue; }
      if (!names.has(area)) problems.push(`${label} 的 grid-area「${area}」不在 grid-template-areas 里`);
      if (seen[area]) problems.push(`${label} 与 ${seen[area]} 同在「${area}」—— 两个元素会叠在同一格里`);
      else seen[area] = label;
    }
    // 一行写完：harness 只打印报错的前三行，换行分隔的清单会被截掉后半截
    ok(problems.length === 0, `宽屏网格有 ${problems.length} 处问题：` + problems.join(' ｜ '));
  });
});
