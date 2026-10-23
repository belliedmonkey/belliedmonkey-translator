#!/usr/bin/env node
// scripts/verify-duo-ac-d5.js — Duo P0 AC-D5 / INV-5 守卫（SPEC-DUO-P0 T9）
//
// 扫描听译壳相关路径：禁止**新增**以 UIScreen.main / userInterfaceIdiom /
// UIDevice.orientation（及 CSS orientation 媒体查询）驱动听译布局的分支。
//
// 范围对齐架构 §2：app/、src/app/、app/native/（排除 vendor）、以及若存在的
// safari-project*/（生成物，有则扫）。
// macOS-only 字幕条里的 NSScreen / NSStackView.orientation 不在听译 iOS 布局路径，豁免。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAIL = [];
const WARN = [];

const SKIP_DIR = new Set(['vendor', 'node_modules', '.git', 'dist', 'dist-app', 'dist-app-china', 'dist-china', 'dist-firefox']);

/** @param {string} abs */
function walk(abs, out) {
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isFile()) { out.push(abs); return; }
  if (!st.isDirectory()) return;
  for (const name of fs.readdirSync(abs)) {
    if (SKIP_DIR.has(name)) continue;
    walk(path.join(abs, name), out);
  }
}

function rel(p) { return path.relative(ROOT, p); }

function scanFile(file) {
  const r = rel(file);
  // 豁免：macOS 字幕条 / 非听译布局
  if (/app\/native\/subtitle-bar\.swift$/.test(r)) return;
  if (/app\/native\/quick-panel\.swift$/.test(r)) return;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\n/);
  const isSwift = /\.swift$/.test(file);
  const isCss = /\.css$/.test(file);
  const isJs = /\.(js|jsx|mjs|cjs)$/.test(file);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const where = `${r}:${i + 1}`;
    // 注释里点名禁词是文档，不是分支
    if (isSwift || isJs) {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*[^*]*\*\//g, '');
      if (!code.trim()) continue;
      line = code;
    }
    if (isCss) {
      // 整行注释跳过；块注释由上游粗剥不够，单行 /* … */ 够用
      const code = line.replace(/\/\*[^*]*\*\//g, '').trim();
      if (!code || code.startsWith('/*') || code.startsWith('*')) continue;
      line = code;
    }

    if (isSwift) {
      // NSStackView.orientation = .horizontal 之类：属性名 orientation，非 UIDevice
      if (/\bUIScreen\.main\b/.test(line) || /\bUIScreen\.bounds\b/.test(line)) {
        FAIL.push(`${where}: UIScreen 布局嫌疑（AC-D5）· ${line.trim().slice(0, 120)}`);
      }
      if (/\buserInterfaceIdiom\b/.test(line)) {
        FAIL.push(`${where}: userInterfaceIdiom 布局嫌疑（AC-D5）· ${line.trim().slice(0, 120)}`);
      }
      if (/\bUIDevice\.current\.orientation\b/.test(line)
          || /\bstatusBarOrientation\b/.test(line)
          || /\binterfaceOrientation\b/.test(line)) {
        FAIL.push(`${where}: orientation 布局嫌疑（AC-D5）· ${line.trim().slice(0, 120)}`);
      }
    }
    if (isCss) {
      if (/@media\s*\(\s*orientation\s*:/.test(line)) {
        FAIL.push(`${where}: CSS orientation 媒体查询（AC-D5）· ${line.trim().slice(0, 120)}`);
      }
    }
    if (isJs) {
      // 听译壳：禁止 window.orientation / screen.orientation 驱动布局
      if (/listen/.test(r) || /app\/style/.test(r)) {
        if (/\bwindow\.orientation\b/.test(line) || /\bscreen\.orientation\b/.test(line)) {
          FAIL.push(`${where}: JS orientation 布局嫌疑（AC-D5）· ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }
}

const roots = [
  path.join(ROOT, 'app', 'native'),
  path.join(ROOT, 'app', 'style.css'),
  path.join(ROOT, 'src', 'app'),
  path.join(ROOT, 'safari-project'),
  path.join(ROOT, 'safari-project-china'),
];

const files = [];
for (const r of roots) walk(r, files);
for (const f of files) {
  if (!/\.(swift|css|js|jsx|mjs|cjs)$/.test(f)) continue;
  // storyboard 不在此脚本；生成工程里的 ViewController 是贴块，源在 app/native
  if (/ViewController\.swift$/.test(f)) continue;
  scanFile(f);
}

if (WARN.length) {
  console.log('warnings:');
  for (const w of WARN) console.log('  · ' + w);
}
if (FAIL.length) {
  console.error('✗ AC-D5 守卫失败（' + FAIL.length + '）：');
  for (const f of FAIL) console.error('  · ' + f);
  process.exit(1);
}
console.log('✓ AC-D5 守卫通过（扫描 ' + files.length + ' 个路径条目；零 UIScreen/idiom/orientation 听译布局分支）');
