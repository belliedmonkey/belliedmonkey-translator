#!/usr/bin/env node
// scripts/verify-manifest-diff.js — X1 / B-04 / R-03：清单与**已上架版本**逐项对比，变宽就判红。
//
// 为什么是「变宽」而不是「有差异」：权限收窄是好事，宽了才是商店风险（用户重新授权、审核问询）。
// 但**任何**差异都要能解释 —— 所以差异全列出来，只是把「变宽」当红。
//
//   node scripts/verify-manifest-diff.js [tag=v1.19.0]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tag = process.argv[2] || 'v1.19.0';
const gitShow = (p) => execFileSync('git', ['show', `${tag}:${p}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const KEYS = ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions'];
const asSet = (v) => new Set(Array.isArray(v) ? v : []);
const sorted = (v) => (Array.isArray(v) ? [...v].sort() : v);

function compare(name, oldM, newM, problems, notes) {
  for (const k of KEYS) {
    const a = sorted(oldM[k] || []), b = sorted(newM[k] || []);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      const added = [...asSet(b)].filter((x) => !asSet(a).has(x));
      notes.push(`${name}.${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
      if (added.length) problems.push(`${name}.${k} 变宽：新增 ${JSON.stringify(added)}`);
    }
  }
  const cs = (m) => (m.content_scripts || []).map((c) => `${(c.matches || []).join(',')}|${c.world || 'ISOLATED'}|${c.all_frames ? 1 : 0}|${c.run_at || ''}`);
  if (JSON.stringify(cs(oldM)) !== JSON.stringify(cs(newM))) {
    notes.push(`${name}.content_scripts: ${JSON.stringify(cs(oldM))} → ${JSON.stringify(cs(newM))}`);
    // 变宽 = 新增了匹配范围，或 all_frames 从 0 变 1
    const oldM2 = cs(oldM).length, newM2 = cs(newM).length;
    if (newM2 > oldM2) problems.push(`${name}.content_scripts 条目变多（${oldM2} → ${newM2}）`);
    if (cs(newM).some((x) => x.endsWith('|1|')) && !cs(oldM).some((x) => x.endsWith('|1|'))) {
      problems.push(`${name}.content_scripts 有 all_frames 从 0 变 1`);
    }
  }
  const war = (m) => JSON.stringify((m.web_accessible_resources || []).map((w) => (typeof w === 'string' ? w : `${(w.resources || []).join(',')}|${(w.matches || []).join(',')}`)));
  if (war(oldM) !== war(newM)) {
    notes.push(`${name}.web_accessible_resources 有变化`);
    const oldFlat = new Set((oldM.web_accessible_resources || []).flatMap((w) => (typeof w === 'string' ? [w] : w.resources || [])));
    const added = (newM.web_accessible_resources || []).flatMap((w) => (typeof w === 'string' ? [w] : w.resources || [])).filter((x) => !oldFlat.has(x));
    if (added.length) problems.push(`${name}.web_accessible_resources 新增 ${JSON.stringify(added)}`);
  }
  const dcp = (m) => JSON.stringify(((m.browser_specific_settings || {}).gecko || {}).data_collection_permissions || null);
  if (dcp(oldM) !== dcp(newM)) {
    notes.push(`${name}.gecko.data_collection_permissions: ${dcp(oldM)} → ${dcp(newM)}`);
    problems.push(`${name}.gecko.data_collection_permissions 变了 —— 这是**修改一份已公开的声明**，必须先问用户`);
  }
}

const oldSrc = JSON.parse(gitShow('extension/manifest.json'));
const oldDist = {};
for (const d of ['dist', 'dist-china', 'dist-firefox']) {
  try { oldDist[d] = JSON.parse(gitShow(`${d}/manifest.json`)); } catch (_) { oldDist[d] = null; }
}
const problems = [], notes = [];
// ① 源码 manifest vs 标签的源码 manifest
compare('extension/manifest.json', oldSrc, JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')), problems, notes);
// ② 三个 dist 的产物 vs 标签里同名的产物（产物是构建出来的，比源码更接近用户拿到的）
for (const d of ['dist', 'dist-china', 'dist-firefox']) {
  const p = path.join(ROOT, d, 'manifest.json');
  if (!fs.existsSync(p)) continue;
  const now = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (oldDist[d]) compare(`${d}/manifest.json`, oldDist[d], now, problems, notes);
  else { compare(`${d}/manifest.json(对照源码)`, oldSrc, now, problems, notes); notes.push(`${d}/manifest.json 在 ${tag} 里不存在（那就是新增的产物），按源码对照`); }
}

console.log(`清单差异（对照 ${tag}）`);
if (!notes.length) console.log('  （无差异）');
for (const n of notes) console.log('  · ' + n);
console.log();
if (problems.length) {
  console.log('✗ 变宽的项（B-04 / R-03 判红）：');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log(`✓ 权限没有变宽（差异 ${notes.length} 处，逐条列在上面）`);
