#!/usr/bin/env node
// #592 — 国际版 / 中国版 iOS 试编译（不进 npm test 全量）。
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DD = path.join(ROOT, '.local/ios-compile-smoke-592-dd');

const TARGETS = [
  {
    name: 'global',
    project: path.join(ROOT, 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj'),
    scheme: 'BelliedMonkey Translator (iOS)',
  },
  {
    name: 'china',
    project: path.join(ROOT, 'safari-project-china/BelliedMonkey Translator CN/BelliedMonkey Translator CN.xcodeproj'),
    scheme: 'BelliedMonkey Translator CN (iOS)',
  },
];

function compileOne(t) {
  if (!require('fs').existsSync(t.project)) {
    console.error(`跳过 ${t.name}：无工程 ${t.project}`);
    return 2;
  }
  const r = spawnSync(
    'xcodebuild',
    [
      'build',
      '-project', t.project,
      '-scheme', t.scheme,
      '-configuration', 'Debug',
      '-destination', 'generic/platform=iOS',
      '-derivedDataPath', path.join(DD, t.name),
      '-allowProvisioningUpdates',
      'CODE_SIGNING_ALLOWED=NO',
    ],
    { stdio: 'inherit', cwd: ROOT },
  );
  return r.status == null ? 1 : r.status;
}

if (require.main === module) {
  let fail = 0;
  for (const t of TARGETS) {
    process.stderr.write(`\n▶ iOS 试编译 ${t.name}\n`);
    const code = compileOne(t);
    if (code !== 0) fail = code;
  }
  process.exit(fail);
}

module.exports = { compileOne, TARGETS };
