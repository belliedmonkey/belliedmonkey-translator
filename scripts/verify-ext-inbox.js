#!/usr/bin/env node
// scripts/verify-ext-inbox.js — `npm run test:inbox`。
//
// 在 Mac 上跑出货的那一份 MTExtInbox（app/native/translate-ext/ExtInbox.swift）。
// 需要 swiftc（Xcode），所以只在本机跑、不进 CI —— 同 test:app / verify:ios 的处境。
//
// **只改一行**：把 App Group 容器换成临时目录。改多了这个测试就不再说明什么，所以改完
// 逐行比对、断言差异恰好一行；锚点变了就响亮地停下，而不是测一份和出货不一样的代码。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'native', 'translate-ext', 'ExtInbox.swift');
const HARNESS = path.join(__dirname, 'ext-inbox-harness.swift');
const ANCHOR = 'guard let c = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: MTVaultNames.group) else { return nil }';
const REPLACEMENT = 'guard let c = MTTestContainer.url else { return nil }';

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

const original = fs.readFileSync(SRC, 'utf8');
if (!original.includes(ANCHOR)) {
  die(`ExtInbox.swift 里找不到容器那一行 —— 锚点变了？\n  期望：${ANCHOR}`);
}
const patched = original.replace(ANCHOR, REPLACEMENT);
const a = original.split('\n'); const b = patched.split('\n');
const diff = a.reduce((n, line, i) => n + (line === b[i] ? 0 : 1), 0);
if (a.length !== b.length || diff !== 1) die(`改动应当恰好一行，实际 ${diff} 行`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-ext-inbox-'));
try {
  fs.writeFileSync(path.join(tmp, 'ExtInbox.swift'), patched);
  fs.copyFileSync(HARNESS, path.join(tmp, 'main.swift'));
  try {
    execFileSync('swiftc', ['-O', 'ExtInbox.swift', 'main.swift', '-o', 'run'], { cwd: tmp, stdio: 'pipe' });
  } catch (e) {
    die('编译失败：\n' + String(e.stderr || e.stdout || e.message).split('\n').slice(0, 12).join('\n'));
  }
  const out = execFileSync(path.join(tmp, 'run'), { cwd: tmp, encoding: 'utf8' });
  process.stdout.write(out);
  if (!/全部通过/.test(out)) process.exit(1);
  console.log('\n✓ MTExtInbox 在 Mac 上跑通（出货的那一份，只把容器换成临时目录）');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
