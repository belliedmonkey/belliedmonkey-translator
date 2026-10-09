#!/usr/bin/env node
// scripts/verify-copy-draft.js — 文案稿的逐字核对 + 旧串在**构建产物**里清零（H6 / C-08 / C-11）。
//
// 两条判据分开，因为它们会以不同的方式坏掉：
//   ① 逐字：`_locales/zh_CN` 的值必须与「稿里的那一句」一字不差。稿在 `.pen` 文件里，而 .pen 是
//      加密的、只能用 Pencil 工具读（Node 读不了）—— 所以这里是**从稿里抄下来的那份文本**，
//      改稿时必须同步重抄（下面 DRAFT 表的注释写了怎么取）。
//   ② 旧串清零：构建产物（dist/、dist-china/、dist-app*/、两个 Xcode 工程的 Resources）里
//      不许再出现清单列的那些串。**排除 `*.bak*` / `*rel-bak*` 备份目录** —— 那些是历史快照。
//
// 用法：node scripts/verify-copy-draft.js   （加 `--json` 出机读结果）
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRAFT = {
  // 来源（2026-10-08）：Pencil 图层 zdhvA（文案改稿 4）——「建议改成」那一栏的正文。
  listen_who_guessed: '判错了？点 ↔ 换成另一种语言',
  listen_history_empty: '双方随便说，每句定稿后会出现在这里。判错了？点 ↔ 换成另一种语言',
  listen_lang_note: '在你选的两门语言之间自动识别。听译页里可以随时改这两门语言。',
  listen_lang_assets_missing: '这门语言的识别包还没装好。连上网后点一次「开始听」就能补上。',
  firstrun_packs_lede: '下好这两样，之后你不用再做任何设置 —— 翻译、听译、字幕、朗读都能直接用。'
    + '声音在你的设备上识别。识别出的文字会发去翻译：自己配了 key 时直接发给你配的服务商；'
    + '用免费额度时经我们的服务器转发，不保存文字。',
  app_lede: '视频、对话、文档 —— 边听边翻，声音在你的设备上识别。识别出的文字会发去翻译：'
    + '自己配了 key 时直接发给你配的服务商；用免费额度时经我们的服务器转发，不保存文字。',
  // 来源：Pencil 图层 SG2qu（补稿，评审有条件通过）。
  listen_flip_kept_card: '换到另一种语言了 · 之前那张卡你已经复习过，留在「来源 › 对话」里',
  listen_device_privacy: '本机转写：边说边出字；整句定稿后连同前几句上下文一起发去翻译：'
    + '自己配了 key 时直接发给你配的服务商，用免费额度时经我们的服务器转发，不保存文字。'
    + '选「设备内置朗读」时，语音在你的设备上合成，首次使用会下载一次离线模型。',
  // 来源：Pencil 图层 E4Q9y6（改稿 D，2026-10-09：点一下开 / 停；取消按住与锁定）。
  // 两个键的小字都跟界面语言。
  listen_ptt_say: '说{lang}',
  listen_ptt_tap_start: '点一下开始',
  listen_ptt_recording: '● 正在录 · 点一下停',
  listen_listening_lang: '正在听{lang}…',
};
// C-08 的旧串清单（一个字都不许留在产物里）。
const OLD = [
  '按语言猜的 · 点 ↔ 改',
  '判错了 · 点 ↔ 换到另一门',
  '改边',
  '语言不对？',
  '声音只在你的设备上处理',
  '对方说的：',
  '我正在说',
  '对方正在说',
  '按住说一整句再松手',
  '发到你自己配置的翻译引擎',
  // 改稿 D（2026-10-09）退役的按住说文案：注册表 pttHint、锁定提示、「没听到声音」、
  // 「点「开始听」后可用」—— 都不能再出现在产物里。
  '点一下或按住说话',
  '点「开始听」后可用',
  '没听到声音，再试一次',
  'Tap or hold to speak',
];
// 扫这些目录（存在才扫）。排除备份目录。
const SCAN = ['dist', 'dist-china', 'dist-app', 'dist-app-china', 'safari-project', 'safari-project-china'];
const SKIP = /(?:bak|rel-bak|\.bak)/i;
const TEXT_EXT = new Set(['.js', '.json', '.html', '.css', '.strings', '.plist', '.ts', '.jsx']);

let fails = 0, passes = 0;
const problems = [];
function ok(cond, what) { if (cond) { passes++; } else { fails++; problems.push(what); } }

// ① 逐字
const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales/zh_CN/messages.json'), 'utf8'));
for (const [key, want] of Object.entries(DRAFT)) {
  const got = msgs[key] && msgs[key].message;
  ok(got === want, `${key}：稿「${want}」≠ 实现「${got}」`);
}
const langsSrc = fs.readFileSync(path.join(ROOT, 'build/langs.config.js'), 'utf8');
// 改稿 D（2026-10-09）：那门语言写的 pttHint 已退役（两个键的小字都跟界面语言）—— 注册表里
// 不该再有它；有就是改回去了。
ok(!/pttHint/.test(langsSrc), 'pttHint 已退役，注册表里不该再有它');

// ② 产物里的旧串
function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (SKIP.test(e.name)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}
let scanned = 0;
const hits = [];
for (const d of SCAN) {
  const root = path.join(ROOT, d);
  if (!fs.existsSync(root)) continue;
  for (const f of walk(root, [])) {
    scanned++;
    let body;
    try { body = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const s of OLD) if (body.indexOf(s) >= 0) hits.push(`${path.relative(ROOT, f)} ← 「${s}」`);
  }
}
ok(hits.length === 0, `构建产物里还有旧串：\n    ` + hits.slice(0, 8).join('\n    '));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ passes, fails, problems, scanned }, null, 1));
} else {
  console.log(`文案逐字与旧串清零：扫了 ${scanned} 个产物文件`);
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(fails === 0 ? `✓ 全过（${passes} 条）` : `✗ ${fails} 条红 / ${passes} 条绿`);
}
process.exit(fails === 0 ? 0 : 1);
