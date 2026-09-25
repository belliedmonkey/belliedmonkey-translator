#!/usr/bin/env node
// scripts/gen-aso-platforms.js — 从共用底稿 store-assets/aso.md 生成两个平台各自上传的那一份：
//
//   store-assets/aso-mac.md  = aso.md + 每段描述多一节「快速翻译（Mac App）」   ← aso-mac-section.json
//   store-assets/aso-ios.md  = aso.md + 每段描述多一节「系统翻译（iPhone）」     ← aso-ios-section.json
//
// 为什么分平台：keywords / description / promotionalText 本来就是**按平台版本**各自存的（App Store Connect 的
// appStoreVersionLocalizations），而两个平台各有一个对方没有的主打功能 —— 快速翻译只在 Mac（Gate J-1），
// 系统翻译只在 iPhone（Gate J-2）。在一个平台的商店页上描述它没有的功能是假话。
// 2026-09-25 之前只分出了 Mac 那一份，于是 1.14.0 的主角「系统翻译」在 iOS 商店文案里**一次都没出现过**。
//
// 为什么是生成而不是手抄：手抄的第二份从第二天起就开始漂 —— 每一份只比 aso.md 多一节，别的逐字相同。
// aso.md 自己**不上传**，它是底稿；两个平台都从它派生。
//
//   node scripts/gen-aso-platforms.js           # 生成两份
//   node scripts/gen-aso-platforms.js --check   # 只比对（任一份与现有文件不一致就 exit 1）
//
// 上传：node scripts/asc.js aso <bundleId> IOS    <版本> store-assets/aso-ios.md [--apply]
//       node scripts/asc.js aso <bundleId> MAC_OS <版本> store-assets/aso-mac.md [--apply]
// （asc.js 会拦「平台与文件对不上」—— 拿底稿或对方那份去上传，都会丢掉一节而不报错。）
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SA = (f) => path.join(ROOT, 'store-assets', f);
const SRC = SA('aso.md');
const LIMIT = 4000;

const PLATFORMS = {
  mac: {
    out: 'aso-mac.md', section: 'aso-mac-section.json', label: '「快速翻译（Mac App）」',
    uses: '**macOS 两线用这一份**（Gate J-1）',
  },
  ios: {
    out: 'aso-ios.md', section: 'aso-ios-section.json', label: '「系统翻译（iPhone）」',
    uses: '**iOS 两线用这一份**（Gate J-2）',
  },
};
const section = (p) => JSON.parse(fs.readFileSync(SA(PLATFORMS[p].section), 'utf8'));

function build(md, platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('不认识的平台：' + platform);
  const SECTION = section(platform);
  let count = 0;
  const out = md.replace(/^(##\s+(?:国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*description\s*\n\n```\n)([\s\S]*?)(\n```)/gm, (m, head, loc, body, tail) => {
    const sec = SECTION[loc];
    if (!sec) throw new Error(`${cfg.section} 没有 ${loc}`);
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
  const banner = `> **生成的文件，不要手改。** 由 \`node scripts/gen-aso-platforms.js\` 从 \`aso.md\` + \`${cfg.section}\` 生成：\n`
    + `> 只比 \`aso.md\` 多一节${cfg.label}，别的逐字相同。${cfg.uses}；\`aso.md\` 是底稿，不直接上传。\n\n`;
  return { text: banner + out, count };
}

function main() {
  const md = fs.readFileSync(SRC, 'utf8');
  const check = process.argv.includes('--check');
  let bad = false;
  for (const p of Object.keys(PLATFORMS)) {
    const { text, count } = build(md, p);
    const out = SA(PLATFORMS[p].out);
    if (check) {
      const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
      if (cur !== text) { console.error(`✗ store-assets/${PLATFORMS[p].out} 与 aso.md 不一致 —— 跑 node scripts/gen-aso-platforms.js`); bad = true; }
      else console.log(`✓ ${PLATFORMS[p].out} 与 aso.md 一致（${count} 段描述各多一节）`);
    } else {
      fs.writeFileSync(out, text);
      console.log(`✓ 写了 store-assets/${PLATFORMS[p].out}（${count} 段描述各多一节）`);
    }
  }
  if (bad) process.exit(1);
}
if (require.main === module) main();
module.exports = { build, LIMIT, PLATFORMS };
