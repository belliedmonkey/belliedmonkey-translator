#!/usr/bin/env node
// 把一个离线朗读模型目录打成 App 能下载的 zip，并打印 extension/learn/device-models.config.js 要的那一行
// （sha256 / size）。模型不进仓库、不进包：托管在 GitHub Release（全球）与 belliedmonkey.com（中国版）。
//
//   node scripts/pack-device-models.js piper-zh <模型目录> <model.onnx 文件名>
//   node scripts/pack-device-models.js piper-en <模型目录> <model.onnx 文件名>
//
// zip 里只放三样：模型、tokens.txt、espeak-ng-data/（sherpa-onnx 的 vits 需要的全部）。
// 布局扁平（不带顶层目录），App 解到 Application Support/mt-speech/<dir>/ 下。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const [name, srcDir, modelFile] = process.argv.slice(2);
if (!name || !srcDir || !modelFile) { console.error('usage: pack-device-models.js <name> <dir> <model.onnx>'); process.exit(1); }
const OUT = path.join(__dirname, '..', '.local', 'device-models');
fs.mkdirSync(OUT, { recursive: true });
const zip = path.join(OUT, name + '.zip');
for (const f of [modelFile, 'tokens.txt', 'espeak-ng-data']) {
  if (!fs.existsSync(path.join(srcDir, f))) { console.error('✗ 缺 ' + f); process.exit(1); }
}
fs.rmSync(zip, { force: true });
// -X 去掉 macOS 的扩展属性；-r 递归；在源目录里打，路径才是扁平的
execFileSync('zip', ['-q', '-r', '-X', zip, modelFile, 'tokens.txt', 'espeak-ng-data'], { cwd: srcDir, stdio: 'inherit' });
const buf = fs.readFileSync(zip);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
console.log(JSON.stringify({ file: name + '.zip', size: buf.length, sha256: sha, model: modelFile, tokens: 'tokens.txt', dataDir: 'espeak-ng-data' }, null, 2));
console.log('→ ' + path.relative(process.cwd(), zip));
