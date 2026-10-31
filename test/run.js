// test/run.js — discover and run every *.test.js file, exit non-zero on failure.
// Zero dependencies (Node built-ins only) — see test/harness.js.
const fs = require('fs');
const path = require('path');
const { run } = require('./harness');

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const f of files) require(path.join(__dirname, f)); // registers tests

run().then((pass) => process.exit(pass ? 0 : 1));
