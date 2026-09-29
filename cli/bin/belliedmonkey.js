#!/usr/bin/env node
// cli/bin/belliedmonkey.js — 命令行宿主（learning-design §9.10）。
//
// 无头、零依赖（node:util.parseArgs）。命令与退出码见 interaction-spec「命令行」：
//   0 成功 · 1 用法/参数错 · 2 引擎未配置 · 3 翻译失败 · 4 语料/文件错
//
// 这里只做**命令层**：解析参数、读配置、调 engine.js 暴露的 API、把结果画到 stdout。
// 一切传输判断（四种 wire format、可选字段、停机码、重试）都在 dist-cli/engine.js 里，
// 与扩展 / App 同一份字节（domain-design §2.7）—— 这里多一行判断就是第二份实现的开始。
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');

const config = require('../config.js');
const messages = require('../messages.js');

const NAME = 'belliedmonkey';
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; }
  catch (_) { return '0.0.0'; }
})();

const OPTIONS = {
  lang: { type: 'string' },
  'ui-lang': { type: 'string' },
  only: { type: 'boolean' },
  json: { type: 'boolean' },
  out: { type: 'string', short: 'o' },
  days: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function usage() {
  return [
    `${NAME} ${VERSION} — 大肚猴翻译命令行`,
    '',
    '用法：',
    `  ${NAME} translate [文本|-] [--lang <语言码>] [--only] [--json]   翻译一段文本（缺省读 stdin）`,
    `  ${NAME} detect [文本|-]                                        识别语言`,
    `  ${NAME} providers                                              列出可用引擎`,
    `  ${NAME} config get [键]                                        查看配置（key 打码）`,
    `  ${NAME} config set <键> <值>                                   写入配置`,
    `  ${NAME} config path                                            显示配置文件路径`,
    '',
    '选项：--lang <code> · --only（只出译文）· --json · -o/--out <file> · --ui-lang <code>',
    `版本：${VERSION}`,
  ].join('\n');
}

function stderr(line) { process.stderr.write(line + '\n'); }

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

// 配置快照必须在 require 引擎**之前**放进 global.__mtSeed —— 垫片在加载期读它。
function engine() {
  const cfg = config.load();
  global.__mtSeed = cfg;
  return { engine: require('../engine.js').load(), cfg };
}

function uiLang(cfg, values) { return (values && values['ui-lang']) || cfg.uiLang || ''; }

const FAIL_EXIT = { needs_setup: 2, unknown_provider: 2, no_base: 2 };

function printFail(r, cfg, values) {
  const lang = uiLang(cfg, values);
  const text = messages.t(r.code, lang);
  stderr(`${NAME}: ${text}${r.code === 'unknown' && r.status ? ` (HTTP ${r.status})` : ''}`);
  if (r.code === 'needs_setup') stderr('  ' + messages.t('cli_needs_setup_hint', lang));
  process.exit(FAIL_EXIT[r.code] || 3);
}

function writeResult(text, r, values) {
  if (values.json) {
    process.stdout.write(JSON.stringify({ src: text.trim(), tr: r.text, lang: r.lang, provider: r.provider, ms: r.ms }) + '\n');
    return;
  }
  if (values.only) { process.stdout.write(r.text + '\n'); return; }
  process.stdout.write(text.trim() + '\n\n' + r.text + '\n');
}

async function cmdTranslate(positionals, values) {
  const rest = positionals.slice(1);
  const piped = !rest.length || rest[0] === '-';
  if (piped && process.stdin.isTTY) { stderr(usage()); process.exit(1); }
  const text = piped ? readStdin() : rest.join(' ');
  const { engine: eng, cfg } = engine();
  const r = await eng.translate(text, { lang: values.lang, uiLang: uiLang(cfg, values) });
  if (!r.ok) printFail(r, cfg, values);
  writeResult(text, r, values);
}

async function cmdDetect(positionals, values) {
  const rest = positionals.slice(1);
  const piped = !rest.length || rest[0] === '-';
  if (piped && process.stdin.isTTY) { stderr(usage()); process.exit(1); }
  const text = piped ? readStdin() : rest.join(' ');
  const { engine: eng, cfg } = engine();
  const r = await eng.detectLanguage(text);
  if (!r.ok) printFail(r, cfg, values);
  if (values.json) process.stdout.write(JSON.stringify(r) + '\n');
  else process.stdout.write((r.lang || 'und') + '\n');
}

function cmdProviders(values) {
  const { engine: eng, cfg } = engine();
  const list = eng.providers();
  const current = cfg.provider || eng.resolveConfig().provider;
  if (values.json) { process.stdout.write(JSON.stringify(list, null, 2) + '\n'); return; }
  for (const p of list) {
    const mark = p.id === current ? '*' : ' ';
    const bits = [p.type];
    if (p.needsKey) bits.push('needs key');
    if (p.defaultModel) bits.push(p.defaultModel);
    process.stdout.write(`${mark} ${p.id.padEnd(14)} ${p.label || ''}  (${bits.join(' · ')})\n`);
  }
}

function cmdConfig(positionals, values) {
  const sub = positionals[1];
  if (sub === 'path') { process.stdout.write(config.FILE + '\n'); return; }
  if (sub === 'get') {
    const key = positionals[2];
    if (key && !config.KEYS.includes(key)) { stderr(`未知的配置键：${key}`); process.exit(1); }
    const cfg = config.get();
    const keys = key ? [key] : config.KEYS;
    const out = {};
    for (const k of keys) if (k in cfg) out[k] = config.mask(k, cfg[k]);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  if (sub === 'set') {
    const key = positionals[2];
    const val = positionals.slice(3).join(' ');
    if (!config.KEYS.includes(key) || val === '') {
      stderr(`用法：${NAME} config set <${config.KEYS.join('|')}> <值>`); process.exit(1);
    }
    // 与扩展的 saveAll 同一条：**选中引擎这个动作本身**就是 engineChosen 的来源
    // （EngineState.needsSetup 的另一半判据）。否则选了免费的无 key 引擎也会被判「没配置」。
    config.save(key === 'provider' ? { provider: val, engineChosen: true } : { [key]: val });
    stderr(`${key} = ${config.mask(key, val)}`);   // 确认写 stderr，stdout 留给结果
    return;
  }
  stderr(`用法：${NAME} config <get|set|path> ...`); process.exit(1);
}

async function main() {
  let parsed;
  try { parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true, strict: false }); }
  catch (e) { stderr(String(e.message || e)); stderr(usage()); process.exit(1); }
  const { values, positionals } = parsed;

  if (values.version) { process.stdout.write(`${NAME} ${VERSION}\n`); return; }
  if (values.help && !positionals.length) { process.stdout.write(usage() + '\n'); return; }

  const cmd = positionals[0];
  switch (cmd) {
    case 'translate': return cmdTranslate(positionals, values);
    case 'detect': return cmdDetect(positionals, values);
    case 'providers': return cmdProviders(values);
    case 'config': return cmdConfig(positionals, values);
    case undefined: process.stdout.write(usage() + '\n'); process.exit(1); break;
    default: stderr(`未知命令：${cmd}`); stderr(usage()); process.exit(1);
  }
}

main().catch((e) => { stderr(`${NAME}: ${(e && e.message) || e}`); process.exit(1); });
