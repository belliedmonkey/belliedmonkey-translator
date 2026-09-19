// build/target-langs.config.js — 「译成什么语言」的**唯一注册表**（2026-09-19）。
//
// 这张清单此前写在四处，而且已经不一致：
//
//   extension/options/options.html  <select id="target-lang">   12 项
//   extension/popup/popup.html      <select id="target-lang">   11 项（缺 it）
//   extension/content/translation-api.js  LANG_NAMES            12 项（提示词里的语言名）
//   app/index.html                  —— 没有。App 一直没有这个设置，默默译成界面语言
//                                       （docs/verification-spec.md 记为已知缺口）
//
// 系统翻译与快速翻译（docs/domain-design.md §2.6）需要一个明说的值，于是 App 补上「译成」，
// 这张清单也就多了第四个端点 —— 多一个端点就多一处会漂的地方，所以先立注册表再加端点。
//
// 与 build/ui-langs.config.js 同一个形状、同一个理由：endonym（简体中文 / English …）按定义
// 不该被翻译，只能是 markup 里的字面量，抽不成 t()；端点抽不掉，就让门禁对着这张表核
// （test/engine-fields.test.js「目标语言」一组）。**四份都对着注册表核，不是互核。**
//
// 它**不是** build/langs.config.js：那张是「可学习的语言」（学习层的脚本判定用），只有一个 zh；
// 译成什么要区分简体与繁体。两张表回答的是两个问题，合并会让其中一个答错。
//
// 顺序 = 选择器里的显示顺序（与 options.html 既有顺序一致），别顺手改。
'use strict';

module.exports = [
  { id: 'zh-CN', endonym: '简体中文' },
  { id: 'zh-TW', endonym: '繁體中文' },
  { id: 'en', endonym: 'English' },
  { id: 'ja', endonym: '日本語' },
  { id: 'ko', endonym: '한국어' },
  { id: 'fr', endonym: 'Français' },
  { id: 'de', endonym: 'Deutsch' },
  { id: 'es', endonym: 'Español' },
  { id: 'ar', endonym: 'العربية' },
  { id: 'pt', endonym: 'Português' },
  { id: 'ru', endonym: 'Русский' },
  { id: 'it', endonym: 'Italiano' },
];
