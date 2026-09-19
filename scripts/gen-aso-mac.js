#!/usr/bin/env node
// scripts/gen-aso-mac.js — 从 store-assets/aso.md 生成 macOS 两线用的 store-assets/aso-mac.md。
//
// 为什么要第二份：aso.md 是 iOS 与 macOS 共用的商店文案，而「快速翻译」只在 Mac 上有 —— Gate J-1
// （docs/learning-design.md §10）定的是「商店文案只在 Mac 两线提」，iOS 的商店页上写一个 iPhone 没有的功能是假话。
// 为什么是生成而不是手抄：手抄的第二份从第二天起就开始漂 —— 这份只比 aso.md 多一节，别的逐字相同。
//   node scripts/gen-aso-mac.js           # 生成
//   node scripts/gen-aso-mac.js --check   # 只比对（与现有文件不一致就 exit 1）
// 多出来的那一节来自 store-assets/aso-mac-section.json（每个语种 {heading, body}），插在描述的第 2 节之后。
// 用法：node scripts/asc.js aso <bundleId> MAC_OS <版本> store-assets/aso-mac.md [--apply]；iOS 照旧用 aso.md。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'store-assets', 'aso.md');
const OUT = path.join(ROOT, 'store-assets', 'aso-mac.md');
const SECTION = JSON.parse(fs.readFileSync(path.join(ROOT, 'store-assets', 'aso-mac-section.json'), 'utf8'));
const LIMIT = 4000;

function build(md) {
  let count = 0;
  const out = md.replace(/^(##\s+(?:国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*description\s*\n\n```\n)([\s\S]*?)(\n```)/gm, (m, head, loc, body, tail) => {
    const sec = SECTION[loc];
    if (!sec) throw new Error(`aso-mac-section.json 没有 ${loc}`);
    const parts = body.split(/\n\n/);
    if (parts.length < 4) throw new Error(`${loc} 的描述不到三节，没法判断插在哪`);
    // 各语种的节标题有两种写法：【…】与全大写一行。跟着这份描述自己的写法走。
    const bracket = /^【/.test(parts[1]);
    const heading = bracket ? `【${sec.heading}】` : sec.heading;
    parts.splice(3, 0, `${heading}\n${sec.body}`);
    const next = parts.join('\n\n');
    if (next.length > LIMIT) throw new Error(`${loc} 的描述加了一节之后 ${next.length} 字，超过 ${LIMIT}`);
    count += 1;
    return head + next + tail;
  });
  if (!count) throw new Error('aso.md 里一段 description 都没找到');
  const banner = '> **生成的文件，不要手改。** 由 `node scripts/gen-aso-mac.js` 从 `aso.md` + `aso-mac-section.json` 生成：\n'
    + '> 只比 `aso.md` 多一节「快速翻译（Mac App）」，别的逐字相同。**macOS 两线用这一份，iOS 两线用 `aso.md`**（Gate J-1）。\n\n';
  return { text: banner + out, count };
}

function main() {
  const { text, count } = build(fs.readFileSync(SRC, 'utf8'));
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('✗ store-assets/aso-mac.md 与 aso.md 不一致 —— 跑 node scripts/gen-aso-mac.js'); process.exit(1); }
    console.log(`✓ aso-mac.md 与 aso.md 一致（${count} 段描述各多一节）`); return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`✓ 写了 store-assets/aso-mac.md（${count} 段描述各多一节）`);
}
if (require.main === module) main();
module.exports = { build, LIMIT };
