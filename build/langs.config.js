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
  { code: 'en', labelKey: 'lang_en', label: 'English',    scripts: ['Latin'] },
  { code: 'ja', labelKey: 'lang_ja', label: '日本語',      scripts: ['Han', 'Kana'] },
  { code: 'ko', labelKey: 'lang_ko', label: '한국어',      scripts: ['Hangul', 'Han'] },
  { code: 'zh', labelKey: 'lang_zh', label: '中文',        scripts: ['Han'] },
  { code: 'fr', labelKey: 'lang_fr', label: 'Français',   scripts: ['Latin'] },
  { code: 'de', labelKey: 'lang_de', label: 'Deutsch',    scripts: ['Latin'] },
  { code: 'es', labelKey: 'lang_es', label: 'Español',    scripts: ['Latin'] },
  { code: 'pt', labelKey: 'lang_pt', label: 'Português',  scripts: ['Latin'] },
  { code: 'it', labelKey: 'lang_it', label: 'Italiano',   scripts: ['Latin'] },
  { code: 'ru', labelKey: 'lang_ru', label: 'Русский',    scripts: ['Cyrillic'] },
  { code: 'ar', labelKey: 'lang_ar', label: 'العربية',    scripts: ['Arabic'] },
];
