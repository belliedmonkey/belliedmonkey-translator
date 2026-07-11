// build/descriptions.china.js — China-flavor extension_description per locale.
//
// The default _locales descriptions name OpenAI/ChatGPT/Claude, which China's App
// Store rejects (Guideline 5). For `--flavor china`, build.js swaps
// extension_description (in both the generated i18n table AND dist-china/_locales)
// with these BRAND-FREE strings. Any locale not listed falls back to `_default`.

// China-flavor descriptions intentionally OMIT YouTube: YouTube is blocked in
// mainland China, so advertising a YouTube feature there is both non-functional
// for users and a review risk (reviewer can't reach it). China listing is
// repositioned around webpage bilingual translation + domestic engines.
module.exports = {
  _default: 'Bilingual webpage translation with multiple built-in AI translation engines, plus custom endpoints.',
  en:    'Bilingual webpage translation with multiple built-in AI translation engines, plus custom endpoints.',
  zh_CN: '网页双语对照翻译，支持 DeepSeek、智谱 GLM、通义千问、Kimi 等多种国内大模型翻译引擎，并可自定义接口。',
  zh_TW: '網頁雙語對照翻譯，支援 DeepSeek、智譜 GLM、通義千問、Kimi 等多種大模型翻譯引擎，並可自訂介面。',
  ja:    'ウェブページの対訳翻訳。複数のAI翻訳エンジンに対応し、カスタム接続も可能。',
  ko:    '웹페이지 이중 번역. 여러 AI 번역 엔진과 사용자 지정 엔드포인트 지원.',
  fr:    'Traduction bilingue des pages web, avec plusieurs moteurs de traduction IA intégrés.',
  de:    'Zweisprachige Webseiten-Übersetzung mit mehreren integrierten KI-Übersetzungsmodulen.',
  es:    'Traducción bilingüe de páginas web, con varios motores de traducción de IA integrados.',
  pt:    'Tradução bilíngue de páginas, com vários motores de tradução de IA integrados e endpoints personalizados.',
  ru:    'Двуязычный перевод страниц с несколькими встроенными ИИ-движками и настраиваемыми эндпоинтами.',
  ar:    'ترجمة ثنائية اللغة لصفحات الويب، مع عدة محركات ترجمة بالذكاء الاصطناعي ونقاط نهاية مخصصة.',
};
