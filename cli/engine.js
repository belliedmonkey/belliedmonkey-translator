// cli/engine.js — 加载构建产物 `dist-cli/engine.js`（由 build/cli-bundle.js 生成）。
//
// flavor 是**构建期**决定的（domain-design §7）：国际版是 `dist-cli/`，中国版是
// `dist-cli-china/`，两个独立产物。运行时用环境变量选目录，不是运行时切 flavor ——
// 这里只是让**开发/测试**能把两份产物指向不同的目录（`BM_CLI_DIST`）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function distDir() {
  if (process.env.BM_CLI_DIST) return path.resolve(process.env.BM_CLI_DIST);
  return path.join(ROOT, process.env.BM_CLI_FLAVOR === 'china' ? 'dist-cli-china' : 'dist-cli');
}
function bundlePath() { return path.join(distDir(), 'engine.js'); }

function load() {
  const p = bundlePath();
  if (!fs.existsSync(p)) {
    const hint = process.env.BM_CLI_FLAVOR === 'china'
      ? 'node build.js --flavor china' : 'node build.js';
    throw new Error(`CLI 引擎还没构建：${p}\n  先跑：${hint}`);
  }
  return require(p);
}

module.exports = { load, bundlePath, distDir };
