#!/usr/bin/env node
// scripts/verify-version-consistency.js — X2 / B-05 / R-02：版本号一处一处对齐。
//
// 判据：package.json、extension/manifest.json、providers.gen.js 里的
// window.MT_VERSION、三个 dist 的 manifest.version（在的话）、两个 Safari 工程的
// MARKETING_VERSION（在的话）必须全等。global 与 china 共用 package.json 这一个
// 号：build-safari.sh 把同一份 VERSION 写进两棵工程。加 `--for-upload` 时再要求
// 大于商店上的版本（AMO 用公开接口读回；CWS 用 `cws:check` 读回）。只读，不碰线上、
// 不上传。
//
// 营销号禁止从 xcodebuild 旁路覆盖。覆盖写成「名字紧贴等号」的 build setting；
// pbxproj 里的赋值和 build-safari.sh 的 sed 两边都有空格，不会被这条当成覆盖。
//   node scripts/verify-version-consistency.js [--for-upload]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// 拼出来，避免本文件自己的源码里出现那段覆盖写法。
const OVERRIDE = 'MARKETING' + '_VERSION=';

const found = [];
const pkg = JSON.parse(read('package.json')).version;
found.push(['package.json', pkg]);
found.push(['extension/manifest.json', JSON.parse(read('extension/manifest.json')).version]);
{
  const gen = read('extension/content/providers.gen.js');
  const m = gen.match(/window\.MT_VERSION = "([^"]*)"/);
  found.push(['providers.gen.js MT_VERSION', m ? m[1] : null]);
}
for (const d of ['dist', 'dist-china', 'dist-firefox']) {
  const p = path.join(ROOT, d, 'manifest.json');
  if (fs.existsSync(p)) found.push([`${d}/manifest.json`, JSON.parse(fs.readFileSync(p, 'utf8')).version]);
}
// 两个 Safari 工程（本地生成、gitignored）：从 pbxproj 里读 MARKETING_VERSION。
// 未生成不算失败 —— CI 没有 Xcode。生成了就必须与 package.json 全等，两处不同也失败。
for (const proj of ['safari-project', 'safari-project-china']) {
  const dir = path.join(ROOT, proj);
  if (!fs.existsSync(dir)) { found.push([`${proj}（未生成）`, null]); continue; }
  let seen = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/\.(bak|rel-bak)/.test(e.name)) walk(p); }
      else if (e.name === 'project.pbxproj') {
        for (const m of read(path.relative(ROOT, p)).matchAll(/MARKETING_VERSION = ([^;]+);/g)) seen.add(m[1].trim());
      }
    }
  };
  walk(dir);
  found.push([`${proj} 的 MARKETING_VERSION`, [...seen].join(' / ') || null]);
}

let bad = 0;
console.log('版本号一致性');
for (const [what, v] of found) {
  const okv = v === pkg;
  if (!okv && v !== null) bad++;
  console.log(`  ${okv || v === null ? '·' : '✗'} ${what.padEnd(34)} ${v === null ? '（没有）' : v}`);
}

function marketingWriterProblem() {
  const sh = read('build-safari.sh');
  const assigns = sh.match(/^VERSION=/gm) || [];
  if (assigns.length !== 1 || !/^VERSION=\$\(node -p "require\('\.\/package\.json'\)\.version"\)$/m.test(sh)) {
    return 'build-safari.sh 必须只从 package.json 取一次 VERSION（global 与 china 共用，不许分叉）';
  }
  if (!/MARKETING_VERSION = \$VERSION;/.test(sh)) {
    return 'build-safari.sh 没有把 MARKETING_VERSION 写成 $VERSION';
  }
  if (!sh.includes('${MARKETING_VERSION+x}')) {
    return 'build-safari.sh 没有拒绝营销版本环境变量';
  }
  const gateAt = sh.indexOf('node scripts/verify-version-consistency.js');
  const archiveAt = sh.indexOf('xcodebuild -project');
  if (gateAt < 0 || archiveAt < 0 || gateAt > archiveAt) {
    return 'build-safari.sh 必须在打印 xcodebuild 归档命令之前跑本脚本';
  }
  const mac = read('scripts/test-mac.js');
  if (!mac.includes("delete env['MARKETING_VERSION']")) {
    return 'scripts/test-mac.js 传给 xcodebuild 的环境仍会继承营销版本变量';
  }
  return null;
}

const writerProblem = marketingWriterProblem();
if (writerProblem) {
  bad++;
  console.log(`  ✗ ${writerProblem}`);
} else {
  console.log('  · build-safari.sh 两棵 flavor 的 MARKETING_VERSION 都写成 package.json');
}

function shipFiles() {
  const out = [
    'build-safari.sh',
    'AGENTS.md',
    'CLAUDE.md',
    '.claude/skills/store-release/SKILL.md',
    'docs/release-checklist.md',
    'docs/verification-spec.md',
  ];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|sh)$/.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'scripts'));
  return out;
}

const overrides = [];
for (const rel of shipFiles()) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(OVERRIDE)) overrides.push(`${rel}:${i + 1}`);
  });
}
if (overrides.length) {
  bad += overrides.length;
  console.log('  ✗ xcodebuild 营销版本覆盖（名字紧贴等号）：');
  for (const hit of overrides) console.log(`    ${hit}`);
} else {
  console.log('  · 发布脚本没有营销版本覆盖');
}

if (bad) console.log(`✗ 有 ${bad} 处与 package.json（${pkg}）不一致，或营销号被旁路覆盖。不要归档。`);
else console.log(`✓ 都等于 ${pkg}`);

if (process.argv.includes('--for-upload')) {
  console.log('\n--for-upload：本地版本必须**大于**商店上的版本（只读：amo:check / cws:check）');
  const { execSync } = require('child_process');
  const env = Object.assign({}, process.env);
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY']) delete env[k];
  const gt = (a, b) => { const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0); } return false; };
  const shops = [
    ['AMO（Firefox）', 'npm run amo:check --silent', /线上版本:\s*([0-9.]+)/, '线上版本'],
    ['CWS（Chrome）', 'npm run cws:check --silent', /crx 版本:\s*([0-9.]+)/, 'crx 版本'],
  ];
  for (const [name, cmd, re, label] of shops) {
    let out = '';
    try { out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    const m = out.match(re);
    if (!m) { console.log(`  ⚠ ${name}：读不到${label}（凭证或网络？见 ${cmd} 的输出），这一项**没验证**`); continue; }
    if (gt(pkg, m[1])) console.log(`  ✓ ${name} ${label} ${m[1]} → 本地 ${pkg} 更大，可以上传`);
    else { console.log(`  ✗ ${name} ${label} ${m[1]} ≥ 本地 ${pkg} —— 商店不收重复版本号，必须先定新号（G-02）`); bad++; }
  }
}
process.exit(bad ? 1 : 0);
