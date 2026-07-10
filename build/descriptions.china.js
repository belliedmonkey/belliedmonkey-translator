// build/descriptions.china.js — China-flavor extension_description per locale.
//
// The default _locales descriptions name OpenAI/ChatGPT/Claude, which China's App
// Store rejects (Guideline 5). For `--flavor china`, build.js swaps
// extension_description (in both the generated i18n table AND dist-china/_locales)
// with these BRAND-FREE strings. Any locale not listed falls back to `_default`.

module.exports = {
  _default: 'Bilingual webpage translation + YouTube dual subtitles, with multiple built-in AI translation engines.',
  en:    'Bilingual webpage translation + YouTube dual subtitles, with multiple built-in AI translation engines.',
  zh_CN: '网页双语对照翻译 + YouTube 双语字幕，支持 DeepSeek、智谱 GLM、通义千问、Kimi 等多种国内大模型翻译引擎，并可自定义接口。',
  zh_TW: '網頁雙語對照翻譯 + YouTube 雙語字幕，支援 DeepSeek、智譜 GLM、通義千問、Kimi 等多種大模型翻譯引擎，並可自訂介面。',
  ja:    'ウェブページの対訳翻訳 + YouTube バイリンガル字幕。複数のAI翻訳エンジンに対応。',
  ko:    '웹페이지 이중 번역 + YouTube 이중 자막. 여러 AI 번역 엔진 지원.',
  fr:    'Traduction bilingue des pages web + sous-titres YouTube, avec plusieurs moteurs de traduction IA intégrés.',
  de:    'Zweisprachige Webseiten-Übersetzung + YouTube-Untertitel, mit mehreren integrierten KI-Übersetzungsmodulen.',
  es:    'Traducción bilingüe de páginas web + subtítulos de YouTube, con varios motores de traducción de IA integrados.',
  pt:    'Tradução bilíngue de páginas + legendas do YouTube, com vários motores de tradução de IA integrados.',
  ru:    'Двуязычный перевод страниц + субтитры YouTube, с несколькими встроенными ИИ-движками перевода.',
  ar:    'ترجمة ثنائية اللغة لصفحات الويب + ترجمة يوتيوب، مع عدة محركات ترجمة بالذكاء الاصطناعي.',
};
