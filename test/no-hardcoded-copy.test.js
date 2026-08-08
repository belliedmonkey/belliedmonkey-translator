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

function stripComments(src) {
  // Good enough for this codebase's style: no regex literals containing `//`
  // followed by CJK, no CJK inside template-literal expressions.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
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
