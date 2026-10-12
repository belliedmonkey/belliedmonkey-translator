#!/usr/bin/env node
// scripts/verify-version-consistency.js — X2 / B-05 / R-02：版本号一处一处对齐。
//
// 判据：三个 dist 的 manifest.version、package.json 的 version、两个 Safari 工程的
// MARKETING_VERSION 必须**全等**。加 `--for-upload` 时再要求**大于**商店上的版本
// （AMO 用公开接口读回；CWS 用 `cws:check` 读回）。只读，不碰线上、不上传。
//   node scripts/verify-version-consistency.js [--for-upload]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const found = [];
const pkg = JSON.parse(read('package.json')).version;
found.push(['package.json', pkg]);
for (const d of ['dist', 'dist-china', 'dist-firefox']) {
  const p = path.join(ROOT, d, 'manifest.json');
  if (fs.existsSync(p)) found.push([`${d}/manifest.json`, JSON.parse(fs.readFileSync(p, 'utf8')).version]);
}
// 两个 Safari 工程（本地生成、gitignored）：从 pbxproj 里读 MARKETING_VERSION
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
  if (!okv && v !== null && !v.includes(' / ')) bad++;
  console.log(`  ${okv || v === null ? '·' : '✗'} ${what.padEnd(34)} ${v === null ? '（没有）' : v}`);
}
if (bad) console.log(`✗ 有 ${bad} 处与 package.json（${pkg}）不一致`);
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
