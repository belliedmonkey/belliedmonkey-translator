// cli/config.js — 命令行宿主的配置（learning-design §9.10）。
//
// 存的是一个**与扩展 / App 同名的键**的普通对象（provider / apiKey / apiBaseUrl /
// apiModel / targetLang / uiLang），这样 LearnNotes.resolveConfig / TranslationAPI.
// resolveProvider / AppTargetLang.resolve 三个唯一解析处原样复用，CLI 不引入第四种配置形状。
//
// 位置：`$BELLIEDMONKEY_CONFIG_DIR` 或 `$XDG_CONFIG_HOME/belliedmonkey/config.json` 或
// `~/.config/belliedmonkey/config.json`，权限 0600。环境变量覆盖（BM_API_KEY 等）优先级最高，
// 且**只覆盖不回写** —— 一次 `config set` 不会把环境里的一把 key 抄进磁盘。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.BELLIEDMONKEY_CONFIG_DIR
  || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'belliedmonkey');
const FILE = path.join(DIR, 'config.json');

// 允许在配置里设置的键。`uiLang` 决定 CLI 文案语言（interaction-spec「命令行」）；
// `engineChosen` 与扩展 / App 同一个判据（EngineState.needsSetup）—— 用户主动选过引擎，
// 免费的无 key 引擎（google）才被当作「已配置」（否则 CLI 永远用不上免费路径）。
const KEYS = ['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'targetLang', 'uiLang', 'engineChosen'];
const ENV = {
  provider: 'BM_PROVIDER',
  apiKey: 'BM_API_KEY',
  apiBaseUrl: 'BM_BASE_URL',
  apiModel: 'BM_MODEL',
  targetLang: 'BM_TARGET_LANG',
  uiLang: 'BM_UI_LANG',
};

function readFile() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (_) { return {}; }
}

// 磁盘值 + 环境变量覆盖。用于**运行时**（翻译 / 复习）。
function load() {
  const cfg = readFile();
  for (const k of Object.keys(ENV)) if (process.env[ENV[k]]) cfg[k] = process.env[ENV[k]];
  return cfg;
}

// 只写磁盘那一份（不含环境变量覆盖）。用于 `config set`。
function save(patch) {
  const next = Object.assign({}, readFile(), patch);
  for (const k of Object.keys(next)) {
    if (next[k] === undefined || next[k] === null || next[k] === '') delete next[k];
  }
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch (_) { /* 平台不支持就算了，内容已按要求写 */ }
  return next;
}

function get(key) {
  const cfg = load();
  return key ? cfg[key] : cfg;
}

// 打码：key / token / secret 一类只露后四位，绝不回显完整值（interaction-spec「命令行」）。
function mask(key, v) {
  if (v == null || v === '') return v;
  if (/key|token|secret|password/i.test(key)) {
    const s = String(v);
    return '••••' + s.slice(-4);
  }
  return v;
}

module.exports = { load, save, get, mask, FILE, DIR, KEYS, ENV };
