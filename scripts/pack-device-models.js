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

// Kokoro 多语包不是 vits 那三样：模型 + voices.bin + 三本词典 + 中文三个 fst + jieba dict/ +
// espeak-ng-data/。**全部打进去** —— 少一样在设备上就是「装好了但念不出来」，
// 而那种失败在真机上只表现为「某个语言不出声」，不报错（2026-10-03 接入时定）。
const KOKORO = [
  modelFile, 'voices.bin', 'tokens.txt',
  'lexicon-gb-en.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt',
  'date-zh.fst', 'number-zh.fst', 'phone-zh.fst',
  'dict', 'espeak-ng-data', 'LICENSE',
];
const isKokoro = /^kokoro/.test(name);
// MMS-TTS（facebook/mms-tts-*，VITS 形状）：只有 model.onnx + tokens.txt，
// **没有 espeak-ng-data**（Python 实测 data_dir 传空即可正常合成泰语，2026-10-04）。
const isMms = /^vits-mms/.test(name);
const want = isKokoro ? KOKORO : isMms ? [modelFile, 'tokens.txt'] : [modelFile, 'tokens.txt', 'espeak-ng-data'];
for (const f of want) {
  if (!fs.existsSync(path.join(srcDir, f))) { console.error('✗ 缺 ' + f); process.exit(1); }
}
fs.rmSync(zip, { force: true });
// -X 去掉 macOS 的扩展属性；-r 递归；在源目录里打，路径才是扁平的
execFileSync('zip', ['-q', '-r', '-X', zip, ...want], { cwd: srcDir, stdio: 'inherit' });
const buf = fs.readFileSync(zip);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const row = {
  file: name + '.zip', size: buf.length, sha256: sha,
  type: isKokoro ? 'kokoro' : 'vits',
  model: modelFile, tokens: 'tokens.txt', dataDir: isMms ? '' : 'espeak-ng-data',
};
if (isKokoro) { row.voices = 'voices.bin'; row.dictDir = 'dict'; row.lexicon = 'lexicon-us-en.txt,lexicon-zh.txt'; }
console.log(JSON.stringify(row, null, 2));
console.log('→ ' + path.relative(process.cwd(), zip));
