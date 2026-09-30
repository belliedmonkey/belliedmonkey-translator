// cli/messages.js — 命令行宿主的少量文案（interaction-spec「命令行」）。
//
// **真源仍是 `extension/_locales`。** 引擎失败那几句是**共用**的 —— 扩展的系统翻译弹层
// （build/ext-bundle.js 的 ExtCopy）与 Mac 快速翻译面板用的是同一批键（`auth_err_key` /
// `sys_fail_*`），这里按同一张对照表去 `_locales/<lang>/messages.json` 取，**不抄第二份**。
// 只有 CLI 独有的几个短句（用法 / 已写入 / 空库提示）暂时留在本文件内置表里，迁移进
// `_locales` 时只改这一处（Phase 1 尚未动 `_locales`，避免只加两三种语言就让 parity 门变红）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 停机码 → `_locales` 键。与 build/ext-bundle.js 的 COPY_KEYS 同源（共用那一批）。
const CODE_KEY = {
  auth: 'auth_err_key',
  timeout: 'sys_fail_timeout',
  network: 'sys_fail_network',
  http: 'sys_fail_http',
  no_base: 'sys_fail_no_base',
  unknown_provider: 'sys_fail_unknown_provider',
  needs_setup: 'sys_fail_needs_setup',
  empty: 'sys_fail_empty',
  empty_result: 'sys_fail_empty_result',
  unknown: 'sys_fail_unknown',
};

// CLI 独有的短句（**待迁 _locales**）。键名加 cli_ 前缀，迁移时一一对应。
const CLI_ONLY = {
  en: {
    cli_needs_setup_hint: 'Set up first:  bm setup   (sign in, free credit is added automatically)',
    cli_setup_hint: 'First run:  bm setup   (sign in → free credit, no configuration).  Or bring your own key:  bm config set provider <id> && bm config set apiKey <key>',
    cli_exhausted_hint: 'Free credit used up. Continue by configuring your own key (bm config set provider <id> && bm config set apiKey <key>) — or see {url}',
    cli_usage_translate: 'Usage: belliedmonkey translate [text|-] [--lang <code>] [--only] [--json]',
    cli_wrote: 'Wrote',
    cli_no_plan: 'No cards due right now, and no new cards left for today.',
    cli_dict_empty: 'The corpus is empty — import a .mtlearn export, or translate something with capture on.',
    cli_press_grade: 'Grade: 0 again · 1 hard · 2 good · 3 easy · q save & quit',
    cli_saved: 'Saved corpus.',
  },
  zh: {
    cli_needs_setup_hint: '先跑：bm setup（登录后自动领免费额度，无需配置）',
    cli_setup_hint: '先跑：bm setup（登录 → 自动领免费额度，无需配置）。或用自带 key：bm config set provider <id> && bm config set apiKey <key>',
    cli_exhausted_hint: '免费额度用完了。配置自己的 key 继续（bm config set provider <id> && bm config set apiKey <key>），或看 {url}',
    cli_usage_translate: '用法：belliedmonkey translate [文本|-] [--lang <语言码>] [--only] [--json]',
    cli_wrote: '已写入',
    cli_no_plan: '现在没有到期卡，今天的新卡也用完了。',
    cli_dict_empty: '语料是空的 —— 导入一份 .mtlearn，或者开着采集翻一点东西。',
    cli_press_grade: '评分：0 重来 · 1 难 · 2 好 · 3 易 · q 保存并退出',
    cli_saved: '语料已保存。',
  },
};

// UI 语言（扩展的 `uiLang` 取 Chrome locale 码，如 zh_CN / pt_BR；也可能是 getlocale 形式
// zh-CN）→ `_locales` 目录名。认不出回落 en。
function langDir(uiLang) {
  const c = String(uiLang || '').replace('-', '_');
  if (!c || c === 'auto') return 'en';
  const low = c.toLowerCase();
  if (low === 'zh' || low === 'zh_cn' || low === 'zh_hans') return 'zh_CN';
  if (low === 'zh_tw' || low === 'zh_hk' || low === 'zh_hant') return 'zh_TW';
  if (low === 'pt_br') return 'pt_BR';
  const two = low.split('_')[0];
  const known = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'ru'];
  return known.includes(two) ? two : 'en';
}

const cache = new Map();
function localeDict(dir) {
  if (cache.has(dir)) return cache.get(dir);
  let dict = {};
  try {
    dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', '_locales', dir, 'messages.json'), 'utf8'));
  } catch (_) { dict = {}; }
  cache.set(dir, dict);
  return dict;
}

// t(key, lang) —— 取 `_locales`；查不到再落 CLI 内置表；再查不到回键名。
function t(key, uiLang) {
  const dir = langDir(uiLang);
  const m = localeDict(dir)[key];
  if (m && m.message) return m.message;
  const cliKey = key in CODE_KEY ? CODE_KEY[key] : null;
  if (cliKey) {
    const m2 = localeDict(dir)[cliKey];
    if (m2 && m2.message) return m2.message;
    const en = localeDict('en')[cliKey];
    if (en && en.message) return en.message;
  }
  const cli = CLI_ONLY[dir === 'zh_CN' || dir === 'zh_TW' ? 'zh' : 'en'];
  return (cli && cli[key]) || (CLI_ONLY.en[key]) || key;
}

module.exports = { t, langDir, CODE_KEY, CLI_ONLY };
