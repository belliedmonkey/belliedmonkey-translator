#!/usr/bin/env node
// scripts/verify-provider.js — verification-spec §1.0 的执行体：把**一个注册表条目**
// 用**真实的传输代码**打到**它真实的端点**上，然后按 §1.0 的四条判据给结论。
//
//   node scripts/verify-provider.js custom_chat
//   node scripts/verify-provider.js glm --flavor china
//   node scripts/verify-provider.js custom_chat --model openai/gpt-4o-mini
//
// 为什么要有它：§1.0 那张表在此之前只能靠人手动去设置页点「测试连接」，于是十七行里
// 常年只有几行有日期。一个只能手动执行的规约会退化成一句愿望。
//
// 它**不是**自己写一份请求去打端点——那样测出来的「通了」只说明那个端点活着，不说明
// 我们的代码能用它。它加载的是 `extension/content/translation-api.js` 与
// `wire-format.js` 本体（和单元测试同一个 loader），只把 fetch 换成 Node 的真 fetch。
// 所以走的是地址解析、形状判定、请求体构造（能力表 + 最小必要兜底）、错误具名的
// 同一条路。
//
// 凭证从 `.local/keys.md` 读（`key_chat_<id>[_flavor]` / `base_…` / `model_…`），
// 值不打印、不进日志——只打印它去请求的**地址**，那正是 §1.0 判据 2 要看的东西。

'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { loadModule } = require('../test/harness.js');
const { makeChrome } = require('../test/stubs.js');

const ROOT = path.join(__dirname, '..');

function slot(name) {
  try {
    return execFileSync('node', [path.join(__dirname, 'local-keys.js'), 'get', name],
      { encoding: 'utf8' }).trim();
  } catch (_) { return ''; }
}

function die(msg, hint) {
  console.error('✗ ' + msg);
  if (hint) console.error('  ' + hint);
  process.exit(1);
}

// ─── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith('--'));
const flagOf = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : ''; };
const flavor = flagOf('flavor') || 'global';
if (!id) die('用法：node scripts/verify-provider.js <entry-id> [--flavor china] [--model …]');

// ─── 注册表 ──────────────────────────────────────────────────────────────
// 从**构建源**读并按 flavor 折叠，和 build.js 同一份数据；不抄任何端点。
const CONFIG = require(path.join(ROOT, 'build', 'providers.config.js'));
const pickFlavor = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v[flavor] : v;
const raw = CONFIG.find((p) => p.id === id);
if (!raw) die(`注册表里没有 ${id}`, '可选：' + CONFIG.map((p) => p.id).join(', '));
if (!raw.flavors.includes(flavor)) die(`${id} 不在 ${flavor} flavor 里`, '试试 --flavor ' + raw.flavors.join(' / --flavor '));
const entry = Object.assign({}, raw, {
  defaultEndpoint: pickFlavor(raw.defaultEndpoint),
  label: pickFlavor(raw.label),
});

// ─── 凭证 ────────────────────────────────────────────────────────────────
// 槽位名的 flavor 后缀规则必须与 local-keys.js 的 slotsFor 一致：只有「两个 flavor
// 都发且端点不同」才带后缀。这里重算一次而不是导出共享，是因为一旦不一致，下面那句
// 「缺 key」会指向一个不存在的槽位名，而那比读不到值更难查。
const db = raw.defaultEndpoint;
const perFlavor = db && typeof db === 'object' && !Array.isArray(db)
  && raw.flavors.length > 1 && db.china !== db.global;
const ns = `chat_${id}${perFlavor ? '_' + flavor : ''}`;
// 判据 3（失败具名）需要一次**故意打不通**的请求。走环境变量而不是命令行参数：
// 参数会进 shell 历史和 ps，而这个位置迟早有人塞真 key。
const apiKey = raw.needsKey ? (process.env.MT_VERIFY_KEY || slot(`key_${ns}`)) : '';
if (process.env.MT_VERIFY_KEY) console.log('（本次用 MT_VERIFY_KEY 覆盖了槽位里的 key —— 错 key 演练）');
const baseUrl = slot(`base_${ns}`);
const model = flagOf('model') || slot(`model_${ns}`) || '';

if (raw.needsKey && !apiKey) die(`缺 key：key_${ns}`, '填到 .local/keys.md（不要贴进对话）');
if (raw.requiresEndpoint && !baseUrl) die(`缺端点：base_${ns}`, '这个条目没有默认端点，必须自填完整接口地址');
if (raw.requiresEndpoint && raw.supportsModel && !model) die(`缺模型：model_${ns}`, '或用 --model 传');

// ─── 真实传输 ────────────────────────────────────────────────────────────
// window 只放这次要验的这一个条目：注册表在这里是**输入**，不是被测对象。
const window = { MT_FLAVOR: flavor, MT_PROVIDERS: [entry] };
const WireFormat = require(path.join(ROOT, 'extension', 'content', 'wire-format.js'));
window.WireFormat = WireFormat;

// 每次请求的地址都记下来。#159 删掉请求体协商之后，正常情况下这里**只该有一行** ——
// 多出来的行只可能来自 429/网络错误的退避重试，那本身就是要看见的事。
const seen = [];
const tracingFetch = (url, init) => { seen.push(String(url)); return fetch(url, init); };

const ctx = loadModule(['request-shape.js', 'translation-api.js'], {
  fetch: tracingFetch, chrome: makeChrome(), AbortController, URLSearchParams, window, WireFormat,
});
const API = ctx.TranslationAPI;

// 判据 2 要的是「打算请求哪个地址」，在发之前就能算出来——发不出去时它同样有用。
const intended = WireFormat.resolveEndpoint(baseUrl, entry);
const shape = WireFormat.formatFor(intended, entry.type);

(async () => {
  console.log(`条目      ${id}  ·  flavor ${flavor}  ·  ${entry.label || ''}`);
  console.log(`地址      ${intended}${baseUrl ? '  （自填）' : '  （注册表默认端点）'}`);
  console.log(`形状      ${shape}${shape === entry.type ? '' : `  （由地址后缀判定，注册表 type 是 ${entry.type}）`}`);
  if (model) console.log(`模型      ${model}`);
  console.log('');

  const SOURCE = 'Spaced repetition is an evidence-based learning technique.';
  const t0 = Date.now();
  let out = null, err = null;
  try { out = await API.translate(SOURCE, 'zh-CN', id, apiKey, baseUrl, model); }
  catch (e) { err = e; }
  const ms = Date.now() - t0;

  // 请求了哪些地址 —— 判据 2。多于一行 = 发生了退避重试，值得看一眼为什么。
  for (let i = 0; i < seen.length; i++) {
    console.log(`请求 ${i + 1}    ${seen[i]}`);
  }
  const urlOk = seen.length > 0 && seen.every((u) => u === intended);
  console.log('');

  if (err) {
    console.log(`✗ 失败 · ${ms}ms`);
    console.log(`  具名      ${err.code || '(无 code —— 判据 3 不通过)'}${err.status ? ' / HTTP ' + err.status : ''}`);
    if (err.serverMessage) console.log(`  服务端原话 ${err.serverMessage}`);
    else console.log('  服务端原话 （空 —— 服务端没给正文，或我们没取到）');
    console.log(`  回显地址  ${err.url || '(没带 url —— 判据 2 不通过)'}`);
    console.log('');
    // 失败也能证伪一部分：地址原样、失败具名，这两条与 key 对不对无关。
    console.log(`判据 2 地址原样：${urlOk ? '✓' : '✗'}`);
    console.log(`判据 3 失败具名：${err.code ? '✓' : '✗'}`);
    console.log('判据 1 端点答 200 并解析出正文：✗');
    process.exit(1);
  }

  const got = String(out || '').trim();
  console.log(`原文      ${SOURCE}`);
  console.log(`译文      ${got || '(空)'}`);
  console.log('');
  console.log(`判据 1 答 200 且解析出非空正文：${got ? '✓' : '✗'}`);
  console.log(`判据 2 请求地址就是打算请求的：${urlOk ? '✓' : '✗'}`);
  console.log('判据 3 失败具名：本次没有失败可看（错 key 单独试一次）');
  console.log(`判据 4 记录进 §1.0 表：请手动填日期（${new Date().toISOString().slice(0, 10)}）`);
  console.log('');
  console.log(got && urlOk ? `✓ ${id} · ${ms}ms` : `✗ ${id}`);
  process.exit(got && urlOk ? 0 : 1);
})();
