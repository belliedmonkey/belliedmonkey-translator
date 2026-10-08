// build/langs.config.js — SINGLE SOURCE OF TRUTH for learnable languages.
//
// Consumed at BUILD time by build.js → extension/content/langs.gen.js
// (`window.MT_LANGS`), the registry the learning-language whitelist reads
// (learning-design.md §4.1): options / app render the chips from it, and
// `LearnRules.langAllowed` uses the `scripts` tables for the Safari fallback
// (no detector there — an 'und' draft passes iff its dominant Unicode script
// is compatible with a whitelisted language). Same "one registry, N consumers"
// rule as providers.config.js / tts.config.js — never re-state a language list
// or a script table at a call site.
//
// Field notes:
//   code      base language code, compared against the DETECTOR's base code
//             (chrome.i18n.detectLanguage returns 'en' / 'zh' / 'zh-CN' …;
//             the gate compares the part before '-').
//   labelKey  i18n key for the display name; `label` is the endonym fallback
//             (endonyms are the sanctioned VERBATIM exception in
//             test/no-hardcoded-copy.test.js — a language's own name needs no
//             translation).
//   scripts   Unicode scripts this language is written in, matched against
//             LearnRules.dominantScript. Scripts are SHARED across languages
//             (Han: zh+ja, Latin: en+fr+…) — the whitelist is deliberately
//             loose on Safari, erring toward capture (§4.1).

module.exports = [
  // `pttHint`：听译页「按住说」**对方那个键**的小字（2026-10-08 用户拍板：本名大字 + 用**那门语言**
  // 写的一句「点一下或按住说话」—— 这个键是递给对方按的，用对方的话告诉他怎么用才闭环）。
  // 它**不随界面语言翻译**（与 `label` 同一条本名规则），所以放在这里而不是 `_locales/`。
  { code: 'en', labelKey: 'lang_en', label: 'English',    scripts: ['Latin'],            pttHint: 'Tap or hold to speak' },
  { code: 'ja', labelKey: 'lang_ja', label: '日本語',      scripts: ['Han', 'Kana'],      pttHint: 'タップまたは長押しで話す' },
  { code: 'ko', labelKey: 'lang_ko', label: '한국어',      scripts: ['Hangul', 'Han'],    pttHint: '탭하거나 길게 눌러 말하기' },
  { code: 'zh', labelKey: 'lang_zh', label: '中文',        scripts: ['Han'],              pttHint: '点一下或按住说话' },
  { code: 'fr', labelKey: 'lang_fr', label: 'Français',   scripts: ['Latin'],            pttHint: 'Appuyez ou maintenez pour parler' },
  { code: 'de', labelKey: 'lang_de', label: 'Deutsch',    scripts: ['Latin'],            pttHint: 'Tippen oder gedrückt halten zum Sprechen' },
  { code: 'es', labelKey: 'lang_es', label: 'Español',    scripts: ['Latin'],            pttHint: 'Toca o mantén pulsado para hablar' },
  { code: 'pt', labelKey: 'lang_pt', label: 'Português',  scripts: ['Latin'],            pttHint: 'Toque ou mantenha pressionado para falar' },
  { code: 'it', labelKey: 'lang_it', label: 'Italiano',   scripts: ['Latin'],            pttHint: 'Tocca o tieni premuto per parlare' },
  { code: 'ru', labelKey: 'lang_ru', label: 'Русский',    scripts: ['Cyrillic'],         pttHint: 'Коснитесь или удерживайте, чтобы говорить' },
  { code: 'ar', labelKey: 'lang_ar', label: 'العربية',    scripts: ['Arabic'],           pttHint: 'اضغط أو استمر بالضغط للتحدث' },
  // 2026-10-03（用户裁定「加」，随 #556 的泰国语一起）：泰语进白名单。
  // 泰文是**无空格文字** —— 采集门的脚本判定照旧（`LearnRules.dominantScript` 早就有
  // `['Thai', /\p{Script=Thai}/u]`，`guessLang` 也早就会猜 `th`），这里补的是「可学」这一格：
  // 不在这里列出来，泰语用户采集到的泰文卡会被白名单挡掉（`langs: null` 时除外）。
  // 脚本名照 §4.1 的 `scripts` 表；泰文不与别的语言共享脚本（Han/Latin 那种互相放行在这里不发生）。
  { code: 'th', labelKey: 'lang_th', label: 'ไทย',        scripts: ['Thai'],             pttHint: 'แตะหรือกดค้างเพื่อพูด' },
];
