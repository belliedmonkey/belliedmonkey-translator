#!/usr/bin/env node
// scripts/gh-release.js —— 发 GitHub Release，并把直装 ZIP 挂上去。
//
// 用法：
//   node scripts/gh-release.js                    # 只打印计划（默认）
//   node scripts/gh-release.js --apply            # 真的发（对外动作）
//   node scripts/gh-release.js --apply --clobber  # 覆盖已存在的同名资产
//   node scripts/gh-release.js --apply --prerelease
//                                                 # **内测包**：发成 prerelease。
//                                                 # GitHub 的 releases/latest 跳过
//                                                 # prerelease，所以官网首页那个下载
//                                                 # 按钮不会被顶掉 —— 这是「只给自己
//                                                 # 装来测，不给用户」唯一不靠自觉的
//                                                 # 做法。脚本会**回读 latest**确认它
//                                                 # 仍指向原来那条正式版。
//   node scripts/gh-release.js --allow-dirty      # 显式跳过版本完整性门禁
//   node scripts/gh-release.js --zip <路径> --tag v1.6.4-store --worktree <目录>
//                                                 # 从某个历史 tag 重出的正确产物：
//                                                 # 溯源被**说出来并验证**，不是跳过
//
// **为什么要有这个脚本**：官网首页的「下载 Chrome 安装包」直链
// `releases/latest/download/belliedmonkey-translator-chrome.zip`，也就是说
// GitHub Release **是一个真正的发布面**，和 CWS / AMO 平级。但它原来是手敲
// `gh release create` 出去的，于是唯独它没有那两条路都有的版本完整性门禁。
//
// 代价在 2026-08-21 当天就付了：Release 从 v1.6.4 tag（13:45）出，而 markdown
// 星号修复 19:05 才合进来。商店 build 43 是修复之后出的，官网 ZIP 不是。
// 于是官网上那句「与提交商店的源码完全一致」变成了假话，**而没有任何人做错一步**。
//
// 资产名是**契约**：官网直链写死了 belliedmonkey-translator-chrome.zip，
// 改名等于把下载按钮变成 404。所以这里把它钉成常量，不接受参数。
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { assertVersionIntegrity, versionInZip } = require('./lib/release-gate.js');

const ROOT = path.join(__dirname, '..');
const BUILT_ZIP = path.join(ROOT, 'belliedmonkeytranslator.zip');
// 官网 index.html 的直链依赖这个名字，见 ~/belliedmonkey-cc/index.html。
const ASSET_NAME = 'belliedmonkey-translator-chrome.zip';

const sh = (cmd, opts) => execSync(cmd, Object.assign({ encoding: 'utf8' }, opts || {}));

// 把 store-assets/release-notes-<版本>.md 里「## 国际版 · en-US」与「## 国际版 · zh-Hans」
// 两个代码块拼成 Release 正文，写到临时文件；没有那份文件返回 null（走 --generate-notes）。
// 段落取法与 scripts/asc.js 的 parseNotes 同一条正则，别各写一份。
function releaseNotesFile(version) {
  const md = path.join(ROOT, 'store-assets', `release-notes-${version}.md`);
  if (!fs.existsSync(md)) return null;
  const src = fs.readFileSync(md, 'utf8');
  const pick = (locale) => {
    const re = new RegExp('^##\\s+国际版\\s*·\\s*' + locale + '\\s*$', 'm');
    const m = re.exec(src); if (!m) return '';
    const f = src.slice(m.index + m[0].length).match(/```[a-z]*\n([\s\S]*?)```/);
    return f ? f[1].trim() : '';
  };
  const en = pick('en-US'), zh = pick('zh-Hans');
  if (!en && !zh) return null;
  const body = [en, zh ? '---\n\n' + zh : ''].filter(Boolean).join('\n\n')
    + `\n\n**Full Changelog**: https://github.com/belliedmonkey/belliedmonkey-translator/compare/v${prevVersion(version)}...v${version}`;
  const out = path.join(require('os').tmpdir(), `release-notes-${version}.md`);
  fs.writeFileSync(out, body);
  return out;
}
function prevVersion(v) {
  try {
    const tags = sh('git tag --list "v*" --sort=-v:refname').split('\n').map((t) => t.trim()).filter(Boolean);
    const i = tags.indexOf('v' + v);
    return i >= 0 && tags[i + 1] ? tags[i + 1].slice(1) : v;
  } catch (_) { return v; }
}
module.exports = { releaseNotesFile };

if (require.main === module) (async () => {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const clobber = argv.includes('--clobber');
  const allowDirty = argv.includes('--allow-dirty');
  const prerelease = argv.includes('--prerelease');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const zipPath = opt('--zip') || BUILT_ZIP;
  const tagOpt = opt('--tag');
  const worktree = opt('--worktree');

  if (!fs.existsSync(zipPath)) {
    console.error(`✗ 找不到 ${zipPath} —— 先跑 node build.js`);
    process.exit(1);
  }
  const version = versionInZip(zipPath);
  if (!version) {
    console.error('✗ 读不出包内版本号（manifest.json）');
    process.exit(1);
  }
  const tag = `v${version}`;
  console.log(apply ? '\x1b[1m模式：真的发布（对外动作）\x1b[0m' : '模式：只打印计划（加 --apply 才发）');
  console.log(`  包 ${zipPath} · 版本 ${version} · ${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB`);

  // 门禁：和 CWS / AMO 同一份实现。
  assertVersionIntegrity({ version, what: '这次 Release', allowDirty, tag: tagOpt, cwd: worktree });

  // Release 已存在？存在就只换资产，不重建（tag 与 notes 不该被一次重传改掉）。
  let exists = true;
  try { sh(`gh release view ${tag} --json tagName`, { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (_) { exists = false; }

  if (exists) {
    const assets = JSON.parse(sh(`gh release view ${tag} --json assets`)).assets.map((a) => a.name);
    const has = assets.includes(ASSET_NAME);
    console.log(`  Release ${tag} 已存在，资产：${assets.join(', ') || '无'}`);
    if (has && !clobber) {
      console.error(`✗ ${ASSET_NAME} 已存在。要替换请加 --clobber（会覆盖用户当前下载到的那一份）。`);
      process.exit(1);
    }
    console.log(`  ${has ? '替换' : '新增'}资产 ${ASSET_NAME}`);
  } else {
    console.log(`  新建 Release ${tag}，并挂上 ${ASSET_NAME}`);
  }
  console.log(prerelease
    ? '  ⚑ 内测（prerelease）：releases/latest 不会改，官网首页的下载按钮仍指向当前正式版'
    : '  ⚑ 正式版：releases/latest 会指到这里，官网首页的下载按钮立刻跟着变');

  // 发之前先记下 latest 是谁。prerelease 的全部意义就是它不该变，而「不该变」
  // 只有拿发布前后两次读数比对才算数。
  let latestBefore = null;
  try { latestBefore = JSON.parse(sh('gh release view --json tagName',
    { stdio: ['ignore', 'pipe', 'ignore'] })).tagName; } catch (_) { /* 一个 release 都没有 */ }
  console.log(`  当前 latest：${latestBefore || '（无）'}`);

  if (!apply) { console.log('\n（只是计划。确认无误后加 --apply）'); return; }

  // 用契约名上传：gh 按文件名决定资产名，所以先复制成那个名字。
  const staged = path.join(require('os').tmpdir(), ASSET_NAME);
  fs.copyFileSync(zipPath, staged);

  if (!exists) {
    // 发布说明：有 store-assets/release-notes-<版本>.md 就用它的 en-US + zh-Hans 两段
    // （与商店 whatsNew 同源），没有才退回 --generate-notes。2026-09-06 之前一直是后者：
    // Release 页面上只有一行中文 PR 标题，而 Releases 是英文用户最先看的地方。
    const notesFile = releaseNotesFile(version);
    sh(`gh release create ${tag} ${JSON.stringify(staged)} --title ${JSON.stringify(tag)}`
      + (notesFile ? ` --notes-file ${JSON.stringify(notesFile)}` : ' --generate-notes')
      + (prerelease ? ' --prerelease' : ''), { stdio: 'inherit' });
  } else {
    sh(`gh release upload ${tag} ${JSON.stringify(staged)} ${clobber ? '--clobber' : ''}`, { stdio: 'inherit' });
  }

  // 回读。**不是看 gh 有没有报错** —— 要确认 latest 指向的那份下载下来确实是这个版本。
  const back = JSON.parse(sh(`gh release view ${tag} --json tagName,assets,isPrerelease,isDraft`));
  // 2026-09-05 的形状：删远端 tag 重打时，GitHub 把挂在旧 tag 上的已发布 release 降成 Draft，
  // 而这里第二次跑只看「已存在」换资产 —— 官网 beta 页的直链 404 了十几个小时，每一步都 ✓。
  if (back.isDraft) {
    console.error('✗ 回读：Release 是 Draft —— 直链是 404。多半是 tag 被移过：`gh release edit ' + tag + ' --draft=false`');
    process.exit(1);
  }
  // 直链本身也要读回：Draft 之外还有别的办法让它 404（资产名、权限），只信 HTTP 200。
  try {
    const code = sh(`curl -sIL -o /dev/null -w "%{http_code}" https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/${tag}/${ASSET_NAME}`).trim();
    if (code !== '200') { console.error(`✗ 回读：直链 HTTP ${code}`); process.exit(1); }
    console.log('✓ 直链 HTTP 200');
  } catch (e) { console.error('✗ 回读直链失败：' + (e && e.message)); process.exit(1); }
  if (prerelease && !back.isPrerelease) {
    console.error('✗ 回读：它不是 prerelease —— 这会把官网首页的下载按钮顶成内测包');
    process.exit(1);
  }
  const asset = back.assets.find((a) => a.name === ASSET_NAME);
  if (!asset) { console.error('✗ 回读：资产不在 Release 里'); process.exit(1); }
  console.log(`✓ ${back.tagName} → ${asset.name} (${(asset.size / 1024).toFixed(0)} KB)`);

  // latest 的回读。prerelease 时它必须没变；正式版时它必须变成这个 tag。
  let latestAfter = null;
  try { latestAfter = JSON.parse(sh('gh release view --json tagName',
    { stdio: ['ignore', 'pipe', 'ignore'] })).tagName; } catch (_) { /* 同上 */ }
  if (prerelease) {
    if (latestAfter !== latestBefore) {
      console.error(`✗ 回读：latest 从 ${latestBefore} 变成了 ${latestAfter} —— 官网首页被内测包顶了`);
      process.exit(1);
    }
    console.log(`✓ latest 仍是 ${latestAfter}（官网首页的下载按钮没被动过）`);
    console.log('  内测直链：releases/download/' + tag + '/' + ASSET_NAME);

    // 官网那一页的版本**钉在 HTML 里**，所以每次发内测都要重生成它。
    // 这一步接在这里而不是靠记性：第一版把「保持最新」全押在页面运行时那次
    // api.github.com 请求上，而那个请求在部分网络下根本发不出去 —— 于是 1.7.4 发了
    // 出去，页面还写着 1.7.3，同时印着「所以这个链接不会停在旧版本」
    // （2026-09-02 用户实测）。
    try {
      sh(`node ${JSON.stringify(path.join(__dirname, 'gen-beta-page.js'))} --tag ${tag}`,
        { stdio: 'inherit' });
      const site = path.join(require('os').homedir(), 'belliedmonkey-cc');
      const dirty = sh('git status --porcelain beta.html', { cwd: site }).trim();
      if (dirty) {
        console.log('\n⚠ 官网内测页已更新但**还没推**。这一页不推的话，用户看到的仍是上一版：');
        console.log(`    cd ${site} && git add beta.html && git commit -m "chore: 内测包 ${tag}" && git push`);
      } else {
        console.log('  官网内测页：已经是 ' + tag + '，无需改动');
      }
    } catch (e) {
      console.log('\n⚠ 官网内测页没能更新（' + (e && e.message) + '）—— 手动跑 node scripts/gen-beta-page.js --tag ' + tag);
    }
  } else {
    if (latestAfter !== tag) {
      console.error(`✗ 回读：latest 是 ${latestAfter}，不是 ${tag}`);
      process.exit(1);
    }
    console.log('  官网直链：releases/latest/download/' + ASSET_NAME);
  }
})();
