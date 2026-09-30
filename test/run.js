// test/run.js — discover and run every *.test.js file, exit non-zero on failure.
// Zero dependencies (Node built-ins only) — see test/harness.js.
const fs = require('fs');
const path = require('path');
const { run } = require('./harness');

// 可选过滤：`node test/run.js cli` 只跑文件名含 "cli" 的（npm run test:cli）。
// 不过滤就是全部 —— 与验证规约 §3.1「every push 跑 npm test」一致。
const filter = process.argv[2];
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

for (const f of files) require(path.join(__dirname, f)); // registers tests

run().then((pass) => process.exit(pass ? 0 : 1));
