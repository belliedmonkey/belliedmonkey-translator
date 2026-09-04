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
//
// Learning wording is LOCAL-ONLY on purpose: the china flavor ships with sync
// disabled (PIPL gate unopened), so the copy must never imply multi-device.
module.exports = {
  _default: 'Bilingual webpage translation; sentences you read can become local review cards. Custom endpoints supported.',
  en:     'Bilingual webpage translation; sentences you read can become local review cards. Custom endpoints supported.',
  zh_CN:  '网页双语对照翻译，读过的句子可在本机变成复习卡。支持 DeepSeek、智谱 GLM、通义千问、Kimi 等引擎，可自定义接口。',
  zh_TW:  '網頁雙語對照翻譯，讀過的句子可在本機變成複習卡。支援 DeepSeek、智譜 GLM、通義千問、Kimi 等引擎，可自訂介面。',
  ja:     'ウェブページの対訳翻訳。読んだ文を端末内で復習カードにできます。カスタム接続にも対応。',
  ko:     '웹페이지 이중 번역. 읽은 문장을 기기 내 복습 카드로 만들 수 있습니다. 사용자 지정 엔드포인트 지원.',
  fr:     'Traduction bilingue des pages web ; les phrases lues peuvent devenir des cartes de révision locales.',
  de:     'Zweisprachige Webseiten-Übersetzung; gelesene Sätze können lokale Wiederholungskarten werden.',
  es:     'Traducción bilingüe de páginas; las frases leídas pueden volverse tarjetas de repaso locales.',
  // `pt_BR`, not `pt`: Chrome's supported-locale list has no bare `pt`, so #65 renamed
  // the directory. This key must match the DIRECTORY name — it is looked up by it.
  pt_BR:  'Tradução bilíngue de páginas; as frases lidas podem virar cartões de revisão locais.',
  ru:     'Двуязычный перевод страниц; прочитанные фразы могут стать локальными карточками для повторения.',
  ar:     'ترجمة ثنائية اللغة لصفحات الويب؛ يمكن تحويل الجمل المقروءة إلى بطاقات مراجعة محلية.',
  hi: 'द्विभाषी वेबपेज अनुवाद; पढ़े गए वाक्य स्थानीय रिवीज़न कार्ड बन सकते हैं। कस्टम एंडपॉइंट समर्थित।',
};
