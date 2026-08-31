// test/no-hardcoded-copy.test.js — 零硬编码文案（interaction-spec 「界面语言」）.
//
// The rule this enforces: every user-visible string in shipped JS goes through the
// i18n table — CJK text may appear in code ONLY as the fallback argument of a t()
// call (the convention that keeps a missing key from blanking the UI). A CJK string
// literal anywhere else is hardcoded copy: it ships in one language to users of
// eleven, and no translator ever sees it.
//
// The app shell (app/*.js) was the standing violation — it carried its own Chinese
// T-table on the theory that "there is no chrome.i18n here", while the bundle it
// ships in has carried MT_I18N_MESSAGES + PageI18n the whole time. This test exists
// so that shortcut cannot quietly come back.
//
// Mechanics: strip comments, then find string literals containing CJK. A literal is
// legal iff the text immediately before it (same statement, up to 80 chars back)
// ends in a t-call opening — `t('key', ` / `t("key", ` — possibly with the key on
// an earlier line. Everything else fails, with file:line in the message.
//
// Deliberately scanned: extension/**/*.js and app/**/*.js (shipped code).
// Deliberately excluded: *.gen.js and i18n-messages.js (generated from the registry
// and _locales — brand names and endonyms live there by design, interaction-spec's
// two verbatim exceptions), and build/test/scripts (developer-facing, not shipped).

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

function shippedJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { out.push(...shippedJs(rel)); continue; }
    if (!e.name.endsWith('.js')) continue;
    if (e.name.endsWith('.gen.js') || e.name === 'i18n-messages.js') continue;
    out.push(rel);
  }
  return out;
}

// 逐字符走一遍，而不是两条正则。
//
// 原来那两条正则有一个**静默的洞**，2026-08-31 实测：quick-setup.js 的一句注释里写了
// `build/*.config.js`，里面的 `/*` 打开了一个假的块注释，一直吃到 310 行之后的下一个
// `*/`。那 310 行里的每一个 CJK 字面量都没被检查过 —— 门禁绿着，但它什么都没看。
//
// 这是这个仓库反复撞到的同一类事：一个扫不到东西的断言，和没有这条断言是一回事。
// 状态机分得清「注释里的 /*」「字符串里的 //」和真正的注释，原来那条
// `[^:'"\`]` 的前瞻只是在给 `https://` 打补丁，挡不住引号里的其它形状。
//
// 保留偏移：删掉的字符换成等量空格、换行原样留下，所以报出来的行号仍然是真行号。
// 这些字符之后的 `/` 只可能是正则开头，不可能是除号（JS 里两者只能这样分辨）。
const REGEX_OK = /[(,=:[!&|?{};+\-*%~^<>]|^$/;
function stripComments(src) {
  let out = '';
  let state = 'code';   // code | line | block | sq | dq | tpl | rx
  let prev = '';        // 上一个非空白的代码字符，用来分辨「除号」和「正则开头」
  let inClass = false;  // 正则里的 [...] 字符组，里面的 / 不结束正则
  for (let i = 0; i < src.length;) {
    const c = src[i]; const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue; }
      // 正则字面量。不认它的话，`/['"]/` 里的引号会把扫描器带进字符串态，从此后面
      // 每一条注释都被当成代码 —— 实测就是这样让 translation-core.js 的一句注释里的
      // 「⏳ 翻译中…」被误报的。判据是「上一个有意义的字符允许正则开头」，这是
      // 除法与正则在 JS 里唯一可分辨的方式。
      if (c === '/' && REGEX_OK.test(prev)) { state = 'rx'; out += c; i += 1; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      if (!/\s/.test(c)) prev = c;
      out += c; i += 1; continue;
    }
    if (state === 'rx') {
      if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { state = 'code'; prev = c; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? c : ' '); i += 1; continue;
    }
    // 字符串里：只认转义和自己的收尾引号。里面的 // 和 /* 都是内容。
    if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) { state = 'code'; prev = c; }
    out += c; i += 1; continue;
  }
  return out;
}

// A t-call tail: `t('some_key', ` optionally split across lines. PageI18n.t /
// TranslationCore.t / local t and i18n aliases all end the same way.
const T_TAIL = /(?:\bt|\bi18n)\(\s*['"][a-z0-9_.]+['"]\s*,\s*$/i;

// interaction-spec 「界面语言」 names the verbatim exceptions, and this list must
// stay exactly as short as that section's: the product's 译 button glyph (an icon
// that happens to be a character), and language ENDONYMS (a language's own name is
// not copy to translate — rendering 简体中文 as "Simplified Chinese" to a French
// user helps nobody find their language).
const VERBATIM = new Set(['译', '简体中文', '繁體中文', '日本語']);

function violations(rel) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const bad = [];
  const lit = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = lit.exec(src))) {
    if (!CJK.test(m[2])) continue;
    if (VERBATIM.has(m[2])) continue;
    const before = src.slice(Math.max(0, m.index - 80), m.index);
    if (T_TAIL.test(before)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    bad.push(rel + ':' + line + '  ' + m[2].slice(0, 30));
  }
  return bad;
}

describe('零硬编码文案 — CJK 字面量只许出现在 t() 的 fallback 位', () => {
  for (const rel of [...shippedJs('extension'), ...shippedJs('app')]) {
    test(rel, () => {
      const bad = violations(rel);
      ok(bad.length === 0,
        '硬编码文案（用户只会看到中文，译者永远看不到）：\n    ' + bad.join('\n    '));
    });
  }
});
