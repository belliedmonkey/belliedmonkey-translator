// cli/grant.js — 加载编译好的免费额度模块（build/cli-bundle.js → dist-cli/grant.js）。
//
// **同一份实现**：它就是 `src/shared/grant.js`（扩展 / App 也在用），esbuild 编成 IIFE 挂
// `MTGrantCli`。CLI 只调 claim()/plan()，不重写「领 → 写槽」——那条流程只许有一份
// （test/grant-one-implementation.test.js）。加载前必须先挂好 window / MT_GRANT / LearnAuth
// 等全局（见 cli/bootstrap.js）。
'use strict';
const fs = require('fs');
const path = require('path');

function load() {
  const p = path.join(require('./engine.js').distDir(), 'grant.js');
  if (!fs.existsSync(p)) {
    const e = new Error(`免费额度模块未构建：${p}\n  先跑 node build.js`);
    e.code = 'grant_not_built';
    throw e;
  }
  return require(p);
}

module.exports = { load };
