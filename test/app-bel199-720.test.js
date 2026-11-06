// test/app-bel199-720.test.js — BEL-199 · Mac ≥720 的包屏 / 文档 / 播客布局契约。
//
// 卡：BEL-199（父因 BEL-198 ACCEPT 拆卡）。基线 fde0c794。
// `npm test` 没有 jsdom（docs/domain-design.md §10），所以这里钉**结构 + 媒体查询边界**，
// 不假装跑了浏览器（真实视口由 test:app / 真机截图验收）：
//   · #firstrun-packs 宽窗主列 560；#packs-go 跟主列走，不拉满窗；语言行仍一行一语言。
//   · #app-docs 顶栏 + #app-docs-root 960；阅读器 .docv-unit 在 :where(#app-docs) 作用域内
//     原文 | 译文左右；文件列表仍单列；doc-view.js 的共享 STYLE 一个字不动。
//   · #app-drive 卡内原文 | 译文左右，notes 通栏；仍 2 列键；min-height:64px 与
//     1.25 / 1.05 字号保持；没有 220 侧栏。
//   · 以上 max-width / grid 全部只在 @media (min-width: 720px) 里；<720 回落现单栏。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const RAW_CSS = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8');
const CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const DOC_VIEW = fs.readFileSync(path.join(ROOT, 'src/shared/doc-view.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DOCS_VIEW = fs.readFileSync(path.join(ROOT, 'src/app/docs-view.jsx'), 'utf8');
const DRIVE_VIEW = fs.readFileSync(path.join(ROOT, 'src/app/driving-view.jsx'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'src/app/AppShell.jsx'), 'utf8');
const WIDE_Q = '(min-width: 720px)';

// 取出每一个 @media (min-width: 720px) { … } 的 body（大括号配平）。
function mediaBlocks(css, query) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = css.indexOf('@media ' + query, from);
    if (i < 0) break;
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) { out.push(css.slice(open + 1, j)); from = j + 1; break; }
      }
    }
  }
  return out;
}
function stripMedia(css, query) {
  let s = css;
  for (;;) {
    const i = s.indexOf('@media ' + query);
    if (i < 0) return s;
    const open = s.indexOf('{', i);
    let depth = 0;
    let end = s.length;
    for (let j = open; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    s = s.slice(0, i) + s.slice(end);
  }
}
const wide = mediaBlocks(CSS, WIDE_Q).join('\n');
const narrow = stripMedia(CSS, WIDE_Q);
const rule = (text, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(text);
  return m ? m[1] : '';
};
// 某个宽窗块里所有 selector 命中 re 的规则体。
const rulesMatching = (text, re) => [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter((m) => re.test(m[1]))
  .map((m) => ({ sel: m[1].trim(), body: m[2] }));

describe('BEL-199 · Mac ≥720 桌面布局（包屏 / 文档 / 播客）', () => {
  test('包屏：≥720 主列 560，#packs-go 跟主列、不拉满窗；.pack-line 仍一行一语言', () => {
    const col = rule(wide, '#firstrun-packs:not([hidden])');
    ok(/max-width\s*:\s*560px/.test(col), '≥720 #firstrun-packs 主列不是 560：' + col);
    ok(/width\s*:\s*100%/.test(col), '≥720 #firstrun-packs 没有占满可用列宽（max-width 才不会缩成内容宽）：' + col);
    const go = rule(wide, '#firstrun-packs > #packs-go');
    ok(/width\s*:\s*100%/.test(go), '≥720 #packs-go 没有跟主列等宽：' + go);
    ok(!/100vw/.test(go), '#packs-go 被写成 100vw（会拉满窗）');
    // 语言行仍是一行一语言：基线 flex 行，宽窗没有把它改成多列网格。
    ok(/:where\(#firstrun-packs\) \.pack-line \{[^}]*display\s*:\s*flex/.test(narrow),
      '窄窗基线 .pack-line 不再是 flex 行');
    ok(!/\.pack-line[^{]*\{[^}]*grid-template-columns/.test(wide), '宽窗把 .pack-line 改成了多列语言表');
    // 两个浮层不在本拍作用域内。
    ok(!/#packs-cellular[^{]*\{[^}]*max-width\s*:\s*560px[^}]*\}/.test(wide),
      '宽窗动了 #packs-cellular（本拍不动）');
    ok(/id="packs-go"/.test(SHELL) && /id="firstrun-packs"/.test(SHELL),
      'AppShell 里 #firstrun-packs / #packs-go 的 id 被改了');
  });

  test('文档：≥720 顶栏 + #app-docs-root 960；作用域双栏；列表仍单列', () => {
    const root = rule(wide, '#app-docs > #app-docs-root');
    ok(/max-width\s*:\s*960px/.test(root), '≥720 #app-docs-root 主列不是 ~960：' + root);
    const head = rule(wide, '#app-docs > .docs-head');
    ok(/max-width\s*:\s*960px/.test(head), '≥720 文档顶栏没跟主列同宽：' + head);
    const body = rule(wide, ':where(#app-docs) .docv-unit .body');
    ok(/display\s*:\s*grid/.test(body), '≥720 阅读器 .docv-unit .body 没有分栏：' + body);
    ok(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/.test(body),
      '≥720 阅读器不是原文 / 译文等宽两栏：' + body);
    const tr = rule(wide, ':where(#app-docs) .docv-unit .body .tr');
    ok(/border-left\s*:\s*1px solid var\(--line\)/.test(tr), '宽窗译文列没有左侧分隔线：' + tr);
    ok(/border-top\s*:\s*0/.test(tr), '宽窗译文还留着窄窗的顶部分隔线：' + tr);
    // 只许在 #app-docs 作用域里 —— 不允许无作用域的 .docv-unit .body 分栏规则。
    ok(!/(^|\n)\s*\.docv-unit \.body\s*\{[^}]*display\s*:\s*grid/.test(wide),
      '宽窗 .docv-unit .body 出现了无 #app-docs 作用域的分栏规则 —— 扩展 docs 页会跟着变');
    ok(/:where\(#app-docs\)/.test(wide), '双栏规则没有 :where(#app-docs) 作用域');
    // doc-view.js 是 App 与扩展 docs 页共用的一份 STYLE —— 本拍一字不改。
    ok(!/#app-docs/.test(DOC_VIEW), 'doc-view.js 里出现 #app-docs —— 作用域被写进了共享渲染器');
    ok(/\.docv-list \{ display:flex; flex-direction:column;/.test(DOC_VIEW),
      'doc-view.js 的 .docv-list 不再是单列 flex');
    ok(/\.docv-unit \.tr \{[^}]*border-top:1px solid/.test(DOC_VIEW),
      'doc-view.js 的共享 STYLE 被改了（.tr 的窄窗形态不见了）');
    // 宽窗也不许把文件列表改成多列。
    ok(!/\.docv-list[^{]*\{[^}]*grid-template-columns/.test(wide), '宽窗把文件列表改成了多列');
    for (const id of ['app-docs-root', 'app-docs-back', 'app-docs-title']) {
      ok(new RegExp(`id="${id}"`).test(DOCS_VIEW), `docs-view.jsx 里丢了 #${id}`);
    }
  });

  test('播客：卡内原文 | 译文左右 + notes 通栏；2 列键；无 220 侧栏', () => {
    const card = rule(wide, '#app-drive .drive-card');
    ok(/display\s*:\s*grid/.test(card), '≥720 .drive-card 没有分栏：' + card);
    ok(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/.test(card),
      '≥720 .drive-card 不是两栏：' + card);
    ok(/grid-column\s*:\s*1/.test(rule(wide, '#app-drive .drive-card #app-drive-text')),
      '#app-drive-text 不在左栏');
    ok(/grid-column\s*:\s*2/.test(rule(wide, '#app-drive .drive-card #app-drive-tr')),
      '#app-drive-tr 不在右栏');
    ok(/grid-column\s*:\s*1 \/ -1/.test(rule(wide, '#app-drive .drive-card #app-drive-notes')),
      '#app-drive-notes 没有通栏在卡底');
    // 仍是 2×N 键 —— 宽窗不改成三列；键高的唯一一条 64px 不许被覆盖。
    ok(/\.drive-grid \{[^}]*grid-template-columns\s*:\s*1fr 1fr/.test(narrow),
      '基线 .drive-grid 不是 2 列');
    for (const r of rulesMatching(wide, /#app-drive/)) {
      ok(!/grid-template-columns[^;]*\b3\b|repeat\(3/.test(r.body),
        '宽窗把驾驶键改成了三列：' + r.sel);
      ok(!/min-height/.test(r.body), '宽窗改了驾驶键的 min-height（64 一条不准改）：' + r.sel);
      ok(!/\b220px\b/.test(r.body), '宽窗给 #app-drive 写了 220 侧栏：' + r.sel);
      ok(!/font-size/.test(r.body), '宽窗动了驾驶卡字号（1.25 / 1.05 不降）：' + r.sel);
    }
    ok(/:where\(#app-drive\) button:not\(\.link\):not\(#app-drive-back\) \{[^}]*min-height:\s*64px/.test(narrow),
      '基线里找不到驾驶键 min-height:64px');
    ok(/#app-drive-text \{[^}]*font-size:\s*1\.25rem/.test(narrow), '基线原文 1.25rem 没了');
    ok(/#app-drive-tr \{[^}]*font-size:\s*1\.05rem/.test(narrow), '基线译文 1.05rem 没了');
    // 返回键仍是文字链，不是侧栏项。
    ok(/id="app-drive-back"/.test(DRIVE_VIEW), 'driving-view.jsx 里丢了 #app-drive-back');
    ok(!/remove\(/.test(DRIVE_VIEW), 'driving-view.jsx 里出现 remove() —— 只许切 hidden');
  });

  test('<720 回落：宽窗 max-width / grid 全在媒体查询里，窄窗保持现单栏', () => {
    ok(!/#firstrun-packs[^{]*\{[^}]*max-width\s*:\s*560px/.test(narrow),
      '560 主列规则跑到了无媒体查询的规则里 —— iPhone / 窄窗会变');
    ok(!/#packs-go[^{]*\{[^}]*width\s*:\s*100%/.test(narrow),
      '#packs-go 的全宽规则跑到了窄窗');
    ok(!/#app-docs-root[^{]*\{[^}]*max-width\s*:\s*960px/.test(narrow),
      '#app-docs-root 的 960 主列跑到了窄窗');
    ok(!/\.docv-unit \.body\s*\{[^}]*display\s*:\s*grid/.test(narrow),
      '阅读器双栏跑到了窄窗');
    ok(!/\.drive-card\s*\{[^}]*grid-template-columns/.test(narrow),
      '驾驶卡两栏跑到了窄窗');
    ok(!/#app-drive[^{]*\{[^}]*max-width\s*:\s*960px/.test(narrow),
      '#app-drive 主列宽跑到了窄窗');
    // 窄窗的竖叠、单列、全宽 CTA 仍在（这些是 iPhone 的契约）。
    ok(/\.drive-card \{[^}]*flex-direction:\s*column/.test(narrow), '窄窗 .drive-card 不再是竖叠');
    ok(/:where\(#firstrun-packs\) \.packs-langs \{[^}]*flex-direction:\s*column/.test(narrow),
      '窄窗语言对不再是竖排');
    ok(/@media \(min-width: 720px\)/.test(RAW_CSS), '整份 CSS 里找不到 720 断点');
  });
});
