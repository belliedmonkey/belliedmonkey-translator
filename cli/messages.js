// cli/messages.js — 命令行宿主的文案。**真源是 `extension/_locales`**（12 语种，与扩展同一张表，
// interaction-spec「命令行」）。共用失败码那几句（`auth_err_key` / `sys_fail_*`）与 CLI 独有
// 短句都在那里 —— 之前 CLI 独有短句内置在本文件，2026-09-30 迁进 `_locales`（`cli_*` 键）。
//
// 位置：优先构建产物 `dist-cli/_locales/`（build/cli-bundle.js 会拷进去），否则仓库
// `extension/_locales/`（开发时）。查不到的键原样返回键名 —— 不静默成空串。
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

function localesDir() {
  try {
    const p = path.join(require('./engine.js').distDir(), '_locales');
    if (fs.existsSync(p)) return p;
  } catch (_) { /* engine 未构建也能用仓库里的 */ }
  return path.join(ROOT, 'extension', '_locales');
}

// UI 语言（扩展的 `uiLang` 取 Chrome locale 码，如 zh_CN / pt_BR；也可能是 zh-CN）→ 目录名。
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
  try { dict = JSON.parse(fs.readFileSync(path.join(localesDir(), dir, 'messages.json'), 'utf8')); }
  catch (_) { dict = {}; }
  cache.set(dir, dict);
  return dict;
}

function raw(key, uiLang) {
  const dir = langDir(uiLang);
  const m = localeDict(dir)[key];
  if (m && m.message) return m.message;
  const en = localeDict('en')[key];
  if (en && en.message) return en.message;
  return key;
}

// t(key, lang) —— 取值；失败码走 CODE_KEY 对照。
function t(key, uiLang) {
  const dir = langDir(uiLang);
  const direct = localeDict(dir)[key];
  if (direct && direct.message) return direct.message;
  const cliKey = CODE_KEY[key];
  if (cliKey) {
    const m = localeDict(dir)[cliKey] || localeDict('en')[cliKey];
    if (m && m.message) return m.message;
  }
  return raw(key, uiLang);
}

// fmt(key, lang, {name: value, ...}) —— 取值并替换 {name} 占位符（与 _locales 同一套写法）。
function fmt(key, uiLang, vars) {
  let s = t(key, uiLang);
  for (const k of Object.keys(vars || {})) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

module.exports = { t, fmt, langDir, CODE_KEY };
