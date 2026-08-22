// scripts/lib/release-gate.js —— 版本完整性门禁：一个版本号只能对应一份内容。
//
// 这段逻辑原来在 cws-publish.js 与 amo-publish.js 里各抄了一份。第三条路
// （GitHub Release / 官网直装 ZIP）**没有抄**，代价当天就付了：
//
//   v1.6.4 tag        2026-08-21 13:45   ← GitHub Release 从这里出
//   星号修复 437fe02  2026-08-21 19:05   ← 5 小时后才合进来
//   商店 build 43     2026-08-21 19:13   ← 从修复之后出
//
// 于是官网上那个「与提交商店的源码完全一致」的直装 ZIP，带着一个商店版本里
// 已经没有的 bug。**没有任何人做错一步**，只是那条路上没有闸门。
//
// 所以现在只有这一份，三条路都调它。抄第四份的那天，就是它再次失效的那天。
'use strict';

const { execSync } = require('child_process');

const git = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (_) { return ''; }
};

// 出货相关目录：改了这些就等于改了包的内容。
// 文档、测试、商店素材不在内 —— 它们不进包，为它们卡住一次发布是噪声。
const SHIPPING_PATHS = 'extension build build.js';

/**
 * 断言「这个版本号只对应一份内容」。不满足就打印原因并 exit 1。
 *
 * @param {object}  o
 * @param {string}  o.version    包内读出来的版本号（不是 package.json —— 要验的是**包**）
 * @param {string}  o.what       出错信息里怎么称呼这个产物，例：'这个包' / '这次 Release'
 * @param {boolean} o.allowDirty 显式放行（调用方从 --allow-dirty 传进来）
 * @returns {boolean} 通过为 true；allowDirty 放行时为 false（调用方可据此打印警告）
 */
function assertVersionIntegrity({ version, what = '这个包', allowDirty = false }) {
  if (!version) return false;
  if (allowDirty) {
    console.log(`\x1b[33m⚠ --allow-dirty：跳过版本完整性检查。${what}与 tag 的对应关系不再有保证。\x1b[0m`);
    return false;
  }

  const tag = `v${version}`;
  const tagSha = git(`git rev-list -n1 ${tag}`);
  const head = git('git rev-parse HEAD');
  const dirty = git(`git status --porcelain -- ${SHIPPING_PATHS}`);

  if (!tagSha) {
    console.error(`✗ 版本 ${version} 没有对应的 tag ${tag} —— ${what}不对应任何一次发布。`);
    process.exit(1);
  }
  if (tagSha !== head) {
    console.error(`✗ 版本是 ${version}，但 HEAD 不在 ${tag} 上。${tag} 之后还有：`);
    for (const l of git(`git log --oneline ${tag}..HEAD`).split('\n').filter(Boolean)) {
      console.error('    ' + l);
    }
    console.error(`  出去的话，${what}与已发布的 ${version} 会是两份不同的内容，`);
    console.error('  而两边都自称同一个版本号，事后无法分辨用户拿到的是哪一份。');
    console.error(`  要么发一个新版本，要么 git checkout ${tag} 后重新 build。`);
    console.error('  确实要出：加 --allow-dirty。');
    process.exit(1);
  }
  if (dirty) {
    console.error('✗ 出货相关目录有未提交改动：');
    for (const l of dirty.split('\n').filter(Boolean)) console.error('    ' + l);
    console.error('  确实要出：加 --allow-dirty。');
    process.exit(1);
  }
  console.log(`✓ 版本 ${version} 与 tag ${tag} 一致，工作树干净`);
  return true;
}

// 从一个 zip 里读 manifest.json 的版本号。读**包**而不是 package.json：
// 要验的是「这份产物里装的是什么」，不是「仓库现在是什么」。
function versionInZip(zipPath) {
  try {
    return JSON.parse(execSync(`unzip -p ${JSON.stringify(zipPath)} manifest.json`,
      { encoding: 'utf8' })).version;
  } catch (_) { return null; }
}

module.exports = { assertVersionIntegrity, versionInZip, SHIPPING_PATHS };
