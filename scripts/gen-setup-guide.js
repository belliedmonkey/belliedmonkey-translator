#!/usr/bin/env node
// scripts/gen-setup-guide.js — 生成官网的「配置最佳实践」教程页。
//
//   node scripts/gen-setup-guide.js            # 两站都生成
//   node scripts/gen-setup-guide.js --check    # 只比对，不写（干运行即校验器）
//
// ── 为什么是生成的，不是写的 ────────────────────────────────────────────────
//
// 教程页天生全是模型名、端点地址和供应商列表 —— 而 CLAUDE.md 的规矩是「注册表之外
// 永不复述」，因为每一份副本都是一个会停止跟踪注册表的消费者。DeepSeek 那条提示词
// 就是这样在 API 早已拒绝 `deepseek-chat` 之后还写了很久。
//
// 一份手写的教程会是**最糟**的那种副本：它在别的仓库里、没有构建、没有测试，而且
// 恰恰是新用户唯一会照着抄的东西。抄错一个端点，他们得到的是一个不工作的配置和
// 「这软件是坏的」的第一印象。
//
// 所以这一页从五份注册表生成：
//   build/providers.config.js    翻译引擎（端点、默认模型、按 flavor 过滤）
//   build/stt.config.js          转写
//   build/tts.config.js          朗读
//   build/perf-ledger.config.js  实测台账 —— 「为什么推荐这个」的证据，带日期
//   build/model-params.config.js 每个 host+模型该发哪些可选字段
//
// 中国版与国际版的差别不是删几个字：中国版没有免费通道（必须自带 key）、没有云端
// 转写（只能自建）、同步是关的。那是注册表里的 `flavors` 决定的，不是这里的判断。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROVIDERS = require(path.join(ROOT, 'build/providers.config.js'));
const STT = require(path.join(ROOT, 'build/stt.config.js'));
const TTS = require(path.join(ROOT, 'build/tts.config.js'));
const LEDGER = require(path.join(ROOT, 'build/perf-ledger.config.js'));

// 每个 flavor 的产出位置与站点身份。域名也只写在这一处。
const SITES = {
  global: { dir: process.env.MT_SITE_CC || path.join(process.env.HOME, 'belliedmonkey-cc'),
            host: 'belliedmonkey.cc', lang: 'en' },
  china:  { dir: process.env.MT_SITE_CN || path.join(process.env.HOME, 'belliedmonkey-com'),
            host: 'belliedmonkey.com', lang: 'zh-Hans' },
};

// 控制台地址。**刻意不进注册表**：注册表管的是代码会用到的东西（端点、模型、能力），
// 而这几个地址没有任何代码读它们。放进去会让扩展包多背一份它用不上的数据，中国版
// 还要为此过一遍合规门。门禁保证这里出现的每个 id 都真的在注册表里。
const CONSOLE = {
  deepseek: 'https://platform.deepseek.com',
  openrouter: 'https://openrouter.ai/keys',
  openrouter_transcribe: 'https://openrouter.ai/keys',
  openrouter_speech: 'https://openrouter.ai/keys',
  openrouter_audio: 'https://openrouter.ai/keys',
  qwen_asr: { china: 'https://bailian.console.aliyun.com' },
  qwen_tts: { china: 'https://bailian.console.aliyun.com' },
  glm: { china: 'https://open.bigmodel.cn', global: 'https://z.ai' },
  qwen: { china: 'https://bailian.console.aliyun.com', global: 'https://modelstudio.console.alibabacloud.com' },
  qwen_mt: { china: 'https://bailian.console.aliyun.com', global: 'https://modelstudio.console.alibabacloud.com' },
  kimi: { china: 'https://platform.moonshot.cn', global: 'https://platform.moonshot.ai' },
  openai: 'https://platform.openai.com/api-keys',
  claude: 'https://console.anthropic.com',
  openai_transcribe: 'https://platform.openai.com/api-keys',
  openai_speech: 'https://platform.openai.com/api-keys',
};

const pick = (v, flavor) => (v && typeof v === 'object' && !Array.isArray(v) ? v[flavor] : v);

// 注册表的 `label` 是**中文的**，即使在 global flavor 下也是 —— 因为扩展 UI 显示的
// 是 `labelKey` 指向的 _locales 条目，`label` 只是没有 labelKey 时的兜底。
// 照搬 label 会让英文教程页写出「Google 翻译 works with no key at all」。
// 所以按页面语言查同一份 _locales，这仍然是注册表驱动（labelKey 就在注册表里）。
const MSGS = {};
function msg(locale, key) {
  if (!MSGS[locale]) {
    const f = path.join(ROOT, 'extension/_locales', locale, 'messages.json');
    MSGS[locale] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  }
  const e = MSGS[locale][key];
  return e && e.message ? e.message : null;
}
const LOCALE_OF = { global: 'en', china: 'zh_CN' };

function labelOf(entry, flavor) {
  return (entry.labelKey && msg(LOCALE_OF[flavor], entry.labelKey)) || pick(entry.label, flavor);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function forFlavor(list, flavor) {
  return list.filter((e) => e.flavors.includes(flavor)).map((e) => ({
    id: e.id,
    label: labelOf(e, flavor),
    endpoint: pick(e.defaultEndpoint, flavor),
    placeholder: e.placeholder,
    model: pick(e.defaultModel, flavor),
    needsKey: e.needsKey,
    console: pick(CONSOLE[e.id], flavor) || null,
  }));
}

// 台账里那一行的实测数字。找不到就返回 null —— 宁可不写这一段，也不写一个编的数字。
function measured(host, model) {
  const r = LEDGER.find((x) => x.host === host && x.model === model && x.verdict === 'adopted');
  if (!r || !r.baseline) return null;
  const best = (r.tried || []).filter((t) => t.outChars > 0).sort((a, b) => a.ms - b.ms)[0];
  if (!best) return null;
  return { date: r.date, before: r.baseline.ms, after: best.ms,
           x: (r.baseline.ms / best.ms).toFixed(1), thinkBefore: r.baseline.thinkTokens };
}

module.exports = { forFlavor, measured, CONSOLE, pick, SITES, labelOf, msg };

if (require.main === module) require('./lib/guide-render.js').main(process.argv.slice(2));
