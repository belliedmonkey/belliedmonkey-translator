// build/ui-langs.config.js — 界面语言的**唯一注册表**。
//
// 「这个产品的界面能说哪些语言」此前在**四个地方**各写一份，而且已经不一致：
//
//   extension/_locales/            11 份（缺 hi）
//   extension/options/options.html <select id="ui-lang"> 的 12 个 <option>
//   app/index.html                 同上，第二份 markup
//   ~/belliedmonkey-cc/i18n/       8 份 + i18n.js 里的 LANGS 表（缺 de/ja/ko/zh-TW）
//
// 2026-09-04 用户裁定：**三个面取全集**。全集是 12 门（下表），此前扩展少一门、
// 官网少四门 —— 也就是说印地语用户在扩展里选不到自己的语言，而德/日/韩/繁中用户
// 在官网上选不到。两边都不报错，只是那门语言的人看到的是兜底语言。
//
// ── 为什么端点是 markup，注册表却在这里 ──────────────────────────────────
//
// 语言选择器的 **endonym**（简体中文 / English / 日本語 …）是
// `test/no-hardcoded-copy.test.js` 三个刻意例外之一：它按定义不该被翻译，
// 所以只能是字面量、抽不成 `t()` 调用。端点抽不掉，那就让**门禁**对着这张表核 ——
// 四份清单谁都不许自己长出一门语言，也不许少一门。
//
// ⚠️ **官网是另一个仓库**（`~/belliedmonkey-cc`）。本仓库的 `npm test` 看不到它，
// 所以那一面的门禁挂在 `scripts/gen-site-langs.js --check` 上（那个脚本本来就
// 住在本仓库、本来就要读官网的树）。这条区别是真的：`local-gates-are-not-ci` ——
// 官网那一行只有在本机、且官网仓库在预期路径上时才跑得到。
'use strict';

// 顺序 = 选择器里的显示顺序。跟 options.html 既有的顺序一致（中文在前是刻意的：
// 这个产品的第一批用户在中文区），改顺序会同时改动三个面，别顺手动。
//
//   id      —— 规范 id，BCP-47 风格。官网直接用它做目录名与 JSON 文件名。
//   chrome  —— `extension/_locales/<dir>`。Chrome 只认它那张表里的目录名，
//              且**没有裸 pt**（只有 pt_BR / pt_PT）——见 build.js 的 CHROME_LOCALES
//              与 issue #65：目录名不被 Chrome 认识就静默忽略，一个字节都不会读。
//   endonym —— 选择器里显示的字面量。不翻译，所以三个面必须逐字相同。
module.exports = [
  { id: 'zh-CN', chrome: 'zh_CN', endonym: '简体中文' },
  { id: 'zh-TW', chrome: 'zh_TW', endonym: '繁體中文' },
  { id: 'en',    chrome: 'en',    endonym: 'English' },
  { id: 'ja',    chrome: 'ja',    endonym: '日本語' },
  { id: 'ko',    chrome: 'ko',    endonym: '한국어' },
  { id: 'fr',    chrome: 'fr',    endonym: 'Français' },
  { id: 'de',    chrome: 'de',    endonym: 'Deutsch' },
  { id: 'es',    chrome: 'es',    endonym: 'Español' },
  { id: 'hi',    chrome: 'hi',    endonym: 'हिन्दी' },
  { id: 'ar',    chrome: 'ar',    endonym: 'العربية' },
  { id: 'pt',    chrome: 'pt_BR', endonym: 'Português' },
  { id: 'ru',    chrome: 'ru',    endonym: 'Русский' },
];
