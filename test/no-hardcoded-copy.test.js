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
// an earlier line. React pages keep `tRef.current` (the latest t) for async
// callbacks, so `tRef.current('key', ` is the same contract and counts too.
// Everything else fails, with file:line in the message.
//
// JSX 文本节点（PR3 起）没有引号 —— 字面量扫描天然看不见它们，`<button>翻译本页
// </button>` 这种写法会成为整个规则的后门。对 .jsx 额外扫「>…中文…<」的原始文本
// 形状（在 stripJsx 的 text 视图上跑 —— JS 注释已剥，所以注释里的中文不误报）；
// endonym 例外照旧豁免。.jsx 的字面量扫描同样跑在 stripJsx 的 js 视图上 —— 直接
// stripComments 会被 JSX 的 `</tag>`、`} />` 开出假态吞出盲区（2026-09-27 实测）。
//
// Deliberately scanned: extension/**/*.js, app/**/*.js and src/**/*.{js,jsx}
// (shipped code). Deliberately excluded: *.gen.js and i18n-messages.js (generated
// from the registry and _locales — brand names and endonyms live there by design,
// interaction-spec's two verbatim exceptions), and build/test/scripts
// (developer-facing, not shipped).

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
// ↑ 区间端点是码点字面量：Compatibility Ideographs U+F900 起 —— 别用形近的豈（U+8C48）替换，豈-FAFF 会把谚文和代理对整个吞进来。

function shippedJs(dir, exts = /\.js$/) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { out.push(...shippedJs(rel, exts)); continue; }
    if (!exts.test(e.name)) continue;
    if (e.name.endsWith('.gen.js') || e.name === 'i18n-messages.js') continue;
    out.push(rel);
  }
  return out;
}

const { stripComments, stripJsx } = require('./lib/strip-comments');

// A t-call tail: `t('some_key', ` optionally split across lines. PageI18n.t /
// TranslationCore.t / local t and i18n aliases all end the same way; so does the
// React pages' `tRef.current('some_key', ` (same two-argument fallback contract).
// `\bt` can't match inside tRef.current, so the shape is listed explicitly.
const T_TAIL = /(?:\bt|\bi18n|tRef\.current)\(\s*['"][a-z0-9_.]+['"]\s*,\s*$/i;

// interaction-spec 「界面语言」 names the verbatim exceptions, and this list must
// stay exactly as short as that section's: the product's 译 button glyph (an icon
// that happens to be a character), and language ENDONYMS (a language's own name is
// not copy to translate — rendering 简体中文 as "Simplified Chinese" to a French
// user helps nobody find their language). 한국어 joined the same day the JSX scan
// could finally SEE the language dropdowns (2026-09-27, stripJsx): the endonyms
// used to live in options.html, which this gate never scanned, so the omission was
// invisible until the dropdown moved into JSX text.
const VERBATIM = new Set(['译', '简体中文', '繁體中文', '日本語', '한국어']);

function violations(rel, isJsx) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // .jsx：stripJsx 先把 JSX 文本节点与标签骨架抹掉再剥 JS 注释（js 视图），文本节点
  // 扫描用只剥 JS 注释的 text 视图。直接喂 stripComments 会被 `</header>`、
  // `ref={x} />` 这类形状开出假正则/假字符串，吞出成段盲区（2026-09-27 实测）。
  const view = isJsx ? stripJsx(raw) : null;
  const src = view ? view.js : stripComments(raw);
  const textView = view ? view.text : src;
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
  if (isJsx) {
    const text = />([^<>{}]*[぀-ヿ㐀-鿿豈-﫿][^<>{}]*)</g;
    while ((m = text.exec(textView))) {
      if (VERBATIM.has(m[1].trim())) continue;
      const line = textView.slice(0, m.index).split('\n').length;
      bad.push(rel + ':' + line + '  (JSX 文本) ' + m[1].trim().slice(0, 30));
    }
  }
  return bad;
}

describe('零硬编码文案 — CJK 字面量只许出现在 t() 的 fallback 位', () => {
  for (const rel of [...shippedJs('extension'), ...shippedJs('app'),
    ...shippedJs('src', /\.(js|jsx)$/)]) {
    test(rel, () => {
      const bad = violations(rel, rel.endsWith('.jsx'));
      ok(bad.length === 0,
        '硬编码文案（用户只会看到中文，译者永远看不到）：\n    ' + bad.join('\n    '));
    });
  }
});
