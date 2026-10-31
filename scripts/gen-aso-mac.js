#!/usr/bin/env node
// scripts/gen-aso-mac.js —— 旧入口，保留给肌肉记忆与 test/aso-mac.test.js。
// 2026-09-25 起实现搬到 scripts/gen-aso-platforms.js（同时生成 aso-mac.md 与 aso-ios.md）；
// 跑这个脚本 = 跑那一个，两份都会重新生成。
'use strict';
const P = require('./gen-aso-platforms.js');
module.exports = { build: (md) => P.build(md, 'mac'), LIMIT: P.LIMIT };
if (require.main === module) {
  process.argv[1] = require.resolve('./gen-aso-platforms.js');
  require('child_process').execFileSync(process.execPath, [require.resolve('./gen-aso-platforms.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
}
