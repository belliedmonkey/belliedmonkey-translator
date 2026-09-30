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
  capture: { type: 'boolean' },
  corpus: { type: 'string' },
  state: { type: 'string' },
  code: { type: 'string' },
  pages: { type: 'string' },
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
    `  ${NAME} setup                                                  首次配置：登录后自动领免费额度`,
    `  ${NAME} translate [文本|-] [--lang <语言码>] [--only] [--json] [--capture]   翻译（缺省读 stdin）`,
    `  ${NAME} detect [文本|-]                                        识别语言`,
    `  ${NAME} doc <file> [--pages 1-3] [-o <file>]                   文档翻译（pdf/docx/txt/md，默认只翻第 1 页）`,
    `  ${NAME} subtitle <file.vtt|.srt> [--only] [-o <file>]          本地字幕翻译`,
    `  ${NAME} batch <file|dir> [--pages 1] [-o <dir>]                批量翻译文件 / 目录`,
    `  ${NAME} providers                                              列出可用引擎`,
    `  ${NAME} plan [--days N]                                        今日牌库 + 未来 N 天（只读）`,
    `  ${NAME} review                                                 交互式复习（0-3 打分，q 保存退出）`,
    `  ${NAME} import <file.mtlearn>                                  合并一份导出进本地语料`,
    `  ${NAME} export [-o <file>]                                     导出本地语料`,
    `  ${NAME} login <邮箱|手机号> [--code <六位码>]                   登录（同步用）`,
    `  ${NAME} logout                                                 退出登录`,
    `  ${NAME} whoami                                                 当前登录身份`,
    `  ${NAME} sync                                                   同步语料（登录后）`,
    `  ${NAME} config get [键] / set <键> <值> / path                  配置（key 打码）`,
    '',
    '选项：--lang <code> · --only · --json · --capture（翻译时采集进语料）· --pages <N|A-B|列表> ·',
    '      --corpus <file> · --state <file> · --code <N> · -o/--out <file|dir> ·',
    '      --days <N> · --ui-lang <code>',
    `版本：${VERSION}`,
    '',
    '短入口：仓库根目录的 ./bm（等价），或 `npm link` 后用 `bm`。',
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
  if (r.code === 'needs_setup') stderr('  ' + messages.t('cli_setup_hint', lang));
  if (r.code === 'credit_exhausted') {
    const url = require('../setup.js').pageUrl();
    stderr('  ' + messages.t('cli_exhausted_hint', lang).replace('{url}', url));
  }
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

// 首次配置：登录 → 自动领免费额度 → 写好配置（learning-design §9.10）。
async function cmdSetup(positionals, values) {
  if (!process.stdin.isTTY) { stderr('setup 需要交互终端（在真实终端里运行 bm setup）'); process.exit(1); }
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a)));
  const { guidedSetup } = require('../setup.js');
  let r;
  try { r = await guidedSetup(values, { ask, out: (s) => process.stdout.write(s + '\n'), err: stderr }); }
  finally { rl.close(); }
  if (!r || !r.ok) process.exit(r && r.code === 'grant_unavailable' ? 2 : 5);
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
  // 采集是 sink：只读已经翻好的 (text, tr)，绝不改译文（§3 law 1）。默认关，`--capture` 才采。
  if (values.capture) {
    const corpus = await openCorpus(values);
    const res = corpus.capture(text, r.text, {
      lang: '', targetLang: r.lang, anchor: { k: 'handoff', via: 'input', at: Date.now() },
    }, Date.now());
    await corpus.save();
    stderr(`已采集 +${res.added} 张（跳过 ${res.skipped}），语料 ${corpus.path}`);
  }
}

// ── 文档 / 字幕 / 批量（Phase 3）：翻译引擎来自 dist-cli/engine.js（同一份传输）──
function makeTranslate(eng, cfg, values) {
  return (t, o) => eng.translate(t, Object.assign({ uiLang: uiLang(cfg, values) }, o || {}));
}

function renderDoc(res, values) {
  const lines = [];
  for (const pg of res.out) {
    lines.push(`— 第 ${pg.page} 页 —`);
    if (pg.scanned) { lines.push('（本页无文本层：扫描页，CLI v1 不识别图片 —— domain-design §2.7 / §8）'); lines.push(''); continue; }
    for (const u of pg.units) {
      if (!values.only) lines.push(u.src);
      lines.push(u.tr || '');
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

async function cmdDoc(positionals, values) {
  const file = positionals[1];
  if (!file) { stderr(`用法：${NAME} doc <file> [--pages 1-3] [-o <file>]`); process.exit(1); }
  const { engine: eng, cfg } = engine();
  const { translateDoc } = require('../doc.js');
  let res;
  try { res = await translateDoc(file, values.pages, makeTranslate(eng, cfg, values), { lang: values.lang }); }
  catch (e) { stderr(`${NAME}: 文档错误${e && e.code ? '（' + e.code + '）' : ''} ${(e && e.message) || e}`); process.exit(4); }
  const text = values.json ? JSON.stringify(res) + '\n' : renderDoc(res, values);
  if (values.out) { const o = path.resolve(values.out); fs.writeFileSync(o, text); stderr(`${NAME}: 已写入 ${o}`); }
  else process.stdout.write(text);
  if (res.total > res.range.length) stderr(`（共 ${res.total} 页，本次翻了 ${res.range.join(',') || '无'}；要更多页给 --pages）`);
}

async function cmdSubtitle(positionals, values) {
  const file = positionals[1];
  if (!file) { stderr(`用法：${NAME} subtitle <file.vtt|.srt> [--only] [-o <file>]`); process.exit(1); }
  const { engine: eng, cfg } = engine();
  const { translateSubtitle, toVtt, toSrt, fmtText } = require('../subtitle.js');
  let res;
  try { res = await translateSubtitle(file, makeTranslate(eng, cfg, values), { lang: values.lang }); }
  catch (e) { stderr(`${NAME}: 字幕错误 ${(e && e.message) || e}`); process.exit(4); }
  const ext = path.extname(file).toLowerCase();
  const text = values.json ? JSON.stringify(res.cues) + '\n'
    : ext === '.srt' ? toSrt(res.cues, values.only)
      : ext === '.vtt' ? toVtt(res.cues, values.only)
        : fmtText(res.cues, values.only);
  if (values.out) { const o = path.resolve(values.out); fs.writeFileSync(o, text); stderr(`${NAME}: 已写入 ${o}`); }
  else process.stdout.write(text);
}

async function cmdBatch(positionals, values) {
  const target = positionals[1];
  if (!target) { stderr(`用法：${NAME} batch <file|dir> [--pages 1] [-o <dir>]`); process.exit(1); }
  const { engine: eng, cfg } = engine();
  const { collect, SUB_EXT } = require('../batch.js');
  const { translateDoc } = require('../doc.js');
  const { translateSubtitle, toVtt, toSrt, fmtText } = require('../subtitle.js');
  let files;
  try { files = collect(target); } catch (e) { stderr(`${NAME}: 找不到 ${target}`); process.exit(4); }
  if (!files.length) { stderr(`${NAME}: 没有可翻的文件（pdf/docx/txt/md/vtt/srt）`); process.exit(1); }
  const outDir = values.out ? path.resolve(values.out) : null;
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const translate = makeTranslate(eng, cfg, values);
  const suffix = values.lang || 'out';
  let done = 0, failed = 0;
  for (const f of files) {
    try {
      let text, outExt;
      if (SUB_EXT.test(f)) {
        const res = await translateSubtitle(f, translate, { lang: values.lang });
        const ext = path.extname(f).toLowerCase();
        text = ext === '.srt' ? toSrt(res.cues, values.only) : ext === '.vtt' ? toVtt(res.cues, values.only) : fmtText(res.cues, values.only);
        outExt = ext;
      } else {
        text = renderDoc(await translateDoc(f, values.pages, translate, { lang: values.lang }), values);
        outExt = '.txt';
      }
      if (outDir) fs.writeFileSync(path.join(outDir, path.basename(f, path.extname(f)) + '.' + suffix + outExt), text);
      else process.stdout.write(text);
      done++; stderr(`✓ ${path.basename(f)}`);
    } catch (e) { failed++; stderr(`✗ ${path.basename(f)}: ${e && e.code ? e.code + ' ' : ''}${(e && e.message) || e}`); }
  }
  stderr(`完成 ${done} · 失败 ${failed}`);
  if (failed && !done) process.exit(4);
}

async function openCorpus(values) {
  const { Corpus } = require('../corpus.js');
  const c = new Corpus(values.corpus);
  try { await c.load(); }
  catch (e) { stderr(`${NAME}: ${e.message}`); process.exit(4); }
  return c;
}

async function cmdPlan(positionals, values) {
  const lang = values['ui-lang'] || '';
  const corpus = await openCorpus(values);
  const { buildPlan } = require('../plan.js');
  const p = buildPlan(corpus, Date.now(), values.days);
  if (values.json) {
    process.stdout.write(JSON.stringify({
      total: p.total, due: p.due, newToday: p.newToday, horizon: p.horizon,
      deck: p.deck.map((c) => ({ id: c.id, text: c.text, tr: c.tr })),
      ahead: p.ahead ? p.ahead.map((c) => c.id) : null,
    }) + '\n');
    return;
  }
  if (!p.total) { process.stdout.write(messages.t('cli_dict_empty', lang) + '\n'); return; }
  if (!p.deck.length) { process.stdout.write(messages.t('cli_no_plan', lang) + '\n'); }
  else {
    process.stdout.write(`今日 ${p.deck.length} 张 · 到期 ${p.due} · 今日新卡 ${p.newToday}\n`);
    for (const c of p.deck) process.stdout.write(`  · ${c.text}\n    ${c.tr}\n`);
  }
  if (p.ahead) process.stdout.write(`未来 ${p.horizon} 天合计 ${p.ahead.length} 张\n`);
}

async function cmdReview(positionals, values) {
  const lang = values['ui-lang'] || '';
  if (!process.stdin.isTTY) { stderr('review 需要交互终端（stdin 不是 TTY）'); process.exit(1); }
  const corpus = await openCorpus(values);
  const { runReview } = require('../review.js');
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (item, n, total) => new Promise((resolve) => {
    process.stderr.write(`\n(${n}/${total}) ${item.text}\n  ${item.tr}\n  ${messages.t('cli_press_grade', lang)} > `);
    rl.question('', (a) => resolve(a.trim()));
  });
  const res = await runReview(corpus, Date.now(), ask);
  rl.close();
  stderr(messages.t('cli_saved', lang) + ` (${res.graded}/${res.total})`);
}

async function cmdImport(positionals, values) {
  const file = positionals[1];
  if (!file) { stderr(`用法：${NAME} import <file.mtlearn> [--corpus <file>]`); process.exit(1); }
  const corpus = await openCorpus(values);
  let stats;
  try { stats = await corpus.importFrom(file); }
  catch (e) { stderr(`${NAME}: ${e.message}`); process.exit(4); }
  process.stdout.write(JSON.stringify(stats) + '\n');
}

async function cmdExport(positionals, values) {
  const corpus = await openCorpus(values);
  const r = await corpus.exportTo(values.out, Date.now());
  process.stdout.write(r.path + '\n');
}

// ── 账号与同步（Phase 2b）：复用 learn/auth.js + learn/sync.js（§9.10）──────
function isChina() { return process.env.BM_CLI_FLAVOR === 'china'; }
function refuseChina(cmd) {
  if (!isChina()) return;
  stderr(`${NAME}: 中国版 CLI 的 ${cmd} 尚未开放 —— 跨境同步需单独评估（对齐扩展侧中国版 sync 关闭）`);
  process.exit(2);
}
function setupSync(corpus, values) {
  const { setup } = require('../sync-runtime.js');
  return setup(corpus, { flavor: isChina() ? 'china' : 'global', stateFile: values.state });
}

async function cmdLogin(positionals, values) {
  refuseChina('login');
  const who = positionals[1];
  if (!who) { stderr(`用法：${NAME} login <邮箱|手机号> [--code <六位码>]`); process.exit(1); }
  const rt = setupSync(await openCorpus(values), values);
  try {
    if (!values.code) {
      await rt.auth.signIn(who);
      rt.saveState();
      process.stderr.write(`${NAME}: 验证码已发往 ${who}\n`);
      process.stderr.write(`  收到后跑：${NAME} login ${who} --code <六位码>\n`);
      return;
    }
    const sess = await rt.auth.verify(who, values.code);
    rt.saveState();
    process.stdout.write(`已登录：${rt.auth.displayName(sess) || sess.userId}\n`);
  } catch (e) {
    stderr(`${NAME}: 登录失败${e && e.code ? '（' + e.code + '）' : ''} ${(e && e.message) || e}`);
    process.exit(5);
  }
}

async function cmdLogout(positionals, values) {
  refuseChina('logout');
  const rt = setupSync(await openCorpus(values), values);
  try { await rt.auth.signOut(); rt.saveState(); process.stdout.write('已退出登录\n'); }
  catch (e) { stderr(`${NAME}: 退出失败 ${(e && e.message) || e}`); process.exit(5); }
}

async function cmdWhoami(positionals, values) {
  refuseChina('whoami');
  const rt = setupSync(await openCorpus(values), values);
  const s = await rt.auth.current();
  if (!s) { stderr(`${NAME}: 未登录`); process.exit(2); }
  process.stdout.write((rt.auth.displayName(s) || s.userId) + '\n');
}

async function cmdSync(positionals, values) {
  refuseChina('sync');
  const corpus = await openCorpus(values);
  const rt = setupSync(corpus, values);
  try {
    const res = await rt.sync.sync(Date.now());
    await corpus.save();
    rt.saveState();
    if (values.json) { process.stdout.write(JSON.stringify(res) + '\n'); return; }
    process.stdout.write(`已同步：拉取 ${res.pulled.cards} 张 · 推送 ${res.pushed.pushed} 张\n`);
  } catch (e) {
    stderr(`${NAME}: 同步失败${e && e.code ? '（' + e.code + '）' : ''} ${(e && e.message) || e}`);
    if (e && e.code === 'signed_out') stderr(`  先登录：${NAME} login <邮箱>`);
    if (e && e.code === 'owner_mismatch') stderr('  这份语料属于另一个账号（语料归属 = 认领它的账号）。');
    process.exit(5);
  }
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
    case 'setup': return cmdSetup(positionals, values);
    case 'translate': return cmdTranslate(positionals, values);
    case 'detect': return cmdDetect(positionals, values);
    case 'doc': return cmdDoc(positionals, values);
    case 'subtitle': return cmdSubtitle(positionals, values);
    case 'batch': return cmdBatch(positionals, values);
    case 'providers': return cmdProviders(values);
    case 'plan': return cmdPlan(positionals, values);
    case 'review': return cmdReview(positionals, values);
    case 'import': return cmdImport(positionals, values);
    case 'export': return cmdExport(positionals, values);
    case 'login': return cmdLogin(positionals, values);
    case 'logout': return cmdLogout(positionals, values);
    case 'whoami': return cmdWhoami(positionals, values);
    case 'sync': return cmdSync(positionals, values);
    case 'config': return cmdConfig(positionals, values);
    case undefined: process.stdout.write(usage() + '\n'); process.exit(1); break;
    default: stderr(`未知命令：${cmd}`); stderr(usage()); process.exit(1);
  }
}

// 管道下游先关（`... | head`）会让 stdout 抛 EPIPE —— 这是正常结束，不是崩溃。
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });

main().catch((e) => { stderr(`${NAME}: ${(e && e.message) || e}`); process.exit(1); });
