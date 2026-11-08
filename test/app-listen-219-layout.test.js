// test/app-listen-219-layout.test.js — BEL-219 · Mac 字幕/听译语言行不竖拆。
//
// 事故：≥720 时 `.listen-pair-seg select { max-width: none }` 让 select 按最长 option
// 撑开；`#app-listen-lang-wrap` 又是列布局，两个 CJK 标签被挤到 min-content ——
// 「视频语言：」「译成」逐字竖着排。
//
// 修法（ARCH-SHORT BEL-219 GO-WITH-ACCEPT）：
//   · 字幕的「视频语言」移出胶囊；「译成」在胶囊内独立成 span，不单独占 .listen-pair-seg；
//   · 标签/胶囊 nowrap + flex:none；≥720 select 不再 max-width:none，改 min-width:0 + 9em 上限；
//     <720 保留 42vw，整行可换行。
// 听译的 langPairLabels 仍是 ['', '']，两个标签都不渲染 ⇒ [中文 ▾] ⇄ [English ▾]。
//
// `npm test` 没有 jsdom（docs/domain-design.md §10）；这里钉**结构 + 媒体查询边界**，
// 真实视口的一行/不溢出由 test/evidence 截图夹具验收（本文件不假装跑了浏览器）。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/listen-view.jsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const MODEL = fs.readFileSync(path.join(ROOT, 'src/app/listen-model.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const WIDE_Q = '(min-width: 720px)';

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

// 从某个 id 的开标签起，按同名标签配平到它的闭标签（JSX 里这一段全是 div/label/span）。
function elementRange(src, id) {
  const at = src.indexOf(`id="${id}"`);
  ok(at >= 0, `listen-view.jsx 里没有 #${id}`);
  const open = src.lastIndexOf('<', at);
  const tag = (src.slice(open).match(/^<([a-zA-Z][\w-]*)/) || [])[1];
  ok(tag, `#${id} 的开标签没解析出来`);
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = open;
  let depth = 0, m;
  while ((m = re.exec(src))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { start: open, end: re.lastIndex, tag };
  }
  throw new Error(`#${id} 的 <${tag}> 没有配平`);
}

describe('BEL-219 · Mac 字幕/听译语言行（不竖拆）', () => {
  test('字幕 DOM：视频语言在胶囊外；译成在胶囊内且不是 .listen-pair-seg', () => {
    const wrap = elementRange(VIEW, 'app-listen-lang-wrap');
    const video = elementRange(VIEW, 'app-listen-video-lang-label');
    const target = elementRange(VIEW, 'app-listen-target-label');

    ok(video.start < wrap.start || video.start >= wrap.end,
      '#app-listen-video-lang-label 还在 #app-listen-lang-wrap 里面');
    ok(target.start > wrap.start && target.end < wrap.end,
      '#app-listen-target-label 不在 #app-listen-lang-wrap 里（ACCEPT：按稿留胶囊内）');

    // 「译成」不得落在任何一个 .listen-pair-seg 里 —— 那会让它按 CJK min-content 单独收缩。
    let from = 0;
    for (;;) {
      const i = VIEW.indexOf('className="listen-pair-seg"', from);
      if (i < 0) break;
      const open = VIEW.lastIndexOf('<', i);
      const tag = (VIEW.slice(open).match(/^<([a-zA-Z][\w-]*)/) || [])[1];
      const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
      re.lastIndex = open;
      let depth = 0, m;
      while ((m = re.exec(VIEW))) {
        depth += m[1] ? -1 : 1;
        if (depth === 0) {
          ok(!(target.start > open && target.end < re.lastIndex),
            '#app-listen-target-label 又被包进 .listen-pair-seg 了');
          from = re.lastIndex;
          break;
        }
      }
      if (depth !== 0) break;
    }

    // 五个 id 一个都不能丢（模型 / shell / 测试按字面量取）。
    for (const id of ['app-listen-lang-wrap', 'app-listen-my', 'app-listen-other',
      'app-listen-video-lang-label', 'app-listen-target-label']) {
      ok((VIEW.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1,
        `#${id} 应恰好出现一次`);
    }
  });

  test('听译：[中文 ▾] ⇄ [English ▾] —— langPairLabels 仍 [空白] 且标签条件渲染', () => {
    ok(/langPairLabels:\s*sub\s*\?\s*\[[^\]]*\]\s*:\s*\['',\s*''\]/.test(MODEL),
      'listen-model.js 的听译 langPairLabels 不再是 [\'\', \'\']');
    ok(/langPairLabels\[0\]\s*\?/.test(VIEW) && /langPairLabels\[1\]\s*\?/.test(VIEW),
      '标签不是按 langPairLabels 条件渲染 —— 听译会套上「视频语言/译成」');
    ok(/id="app-listen-my"/.test(VIEW) && /id="app-listen-other"/.test(VIEW) &&
      /listen-pair-arrow/.test(VIEW), '听译的两个 select + ⇄ 不齐');
  });

  test('<720 CSS：标签/胶囊 nowrap + flex:none；select 保留 42vw 且可缩', () => {
    const pill = rule(narrow, ':where(#app-listen) #app-listen-lang-wrap');
    ok(/white-space\s*:\s*nowrap/.test(pill), '窄窗胶囊没有 white-space:nowrap：' + pill);
    ok(/flex\s*:\s*none/.test(pill), '窄窗胶囊没有 flex:none：' + pill);
    const label = rule(narrow, ':where(#app-listen) .listen-lang-label');
    ok(/white-space\s*:\s*nowrap/.test(label), '语言标签没有 white-space:nowrap：' + label);
    ok(/flex\s*:\s*none/.test(label), '语言标签没有 flex:none：' + label);
    const row = rule(narrow, ':where(#app-listen) .listen-lang-row');
    ok(/flex-wrap\s*:\s*wrap/.test(row), '<720 语言行不能整体换行：' + row);
    const sel = rule(narrow, ':where(#app-listen) .listen-pair-seg select');
    ok(/max-width\s*:\s*42vw/.test(sel), '<720 select 不保留 42vw 上限：' + sel);
    ok(/min-width\s*:\s*0/.test(sel), '<720 select 没有 min-width:0（不能收缩）：' + sel);
  });

  test('≥720 CSS：不再 max-width:none；select min-width:0 + 约 9em 上限；整行 nowrap', () => {
    const sel = rule(wide, ':where(#app-listen) .listen-pair-seg select');
    ok(sel, '≥720 找不到 .listen-pair-seg select 规则');
    ok(!/max-width\s*:\s*none/.test(sel), '≥720 select 还是 max-width:none —— 按最长 option 撑开：' + sel);
    ok(/max-width\s*:\s*9em/.test(sel), '≥720 select 没有约 9em 上限：' + sel);
    ok(/min-width\s*:\s*0/.test(sel), '≥720 select 没有 min-width:0：' + sel);
    const row = rule(wide, ':where(#app-listen) .listen-lang-row');
    ok(/flex-wrap\s*:\s*nowrap/.test(row), '≥720 语言行不是 nowrap：' + row);
  });
});
