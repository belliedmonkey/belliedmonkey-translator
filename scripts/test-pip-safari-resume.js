#!/usr/bin/env node
// #592 #83 — PiP ⏸→▶ 后 Safari 视频仍前进。仅手动/夜间；不进 test/run.js。
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const UDID = process.env.MT_UDID || '00008120-000465443A98C01E';
const RUNNER = path.join(ROOT, '.local/spike/S6/runner/S56Runner.xcodeproj');
const DD = path.join(ROOT, '.local/spike/S6/dd-runner');
const fs = require('fs');
const bundle = process.env.MT_TARGET_BUNDLE || 'com.belliedmonkeytranslator';
const XCTEST_RUNNER = path.join(DD, 'Build/Products/Debug-iphoneos/S56UITests-Runner.app');

if (!fs.existsSync(RUNNER)) {
  console.error('缺少 .local/spike/S6/runner — 见 tools/ios-runner/README.md 同步后再跑');
  process.exit(2);
}

function xcode(args) {
  return spawnSync('xcodebuild', args, {
    stdio: 'inherit',
    env: process.env,
    cwd: path.join(ROOT, '.local/spike/S6'),
  });
}

// #87/#88：只跑 test-without-building 且从未 build-for-testing 时 xcode 报 0 tests。
if (!fs.existsSync(XCTEST_RUNNER) || process.env.MT_PIP_REBUILD === '1') {
  console.error('PiP runner 未构建或 MT_PIP_REBUILD=1 — build-for-testing …');
  const b = xcode([
    'build-for-testing',
    '-project', RUNNER,
    '-scheme', 'S56Runner',
    '-destination', `id=${UDID}`,
    '-derivedDataPath', DD,
    '-allowProvisioningUpdates',
  ]);
  if (b.status !== 0) process.exit(b.status == null ? 1 : b.status);
}

const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal);
const pipUrl = process.env.MT_PIP_URL || (lan ? `http://${lan.address}:8781/autoplay-video.html` : 'http://127.0.0.1:8781/autoplay-video.html');

console.error('PiP Safari 联跑：先在本机起 fixture 静态服（另开终端）：');
console.error('  cd test/fixtures && python3 -m http.server 8781');
console.error('MT_PIP_URL=', pipUrl);

const env = {
  ...process.env,
  TEST_RUNNER_MT_TARGET_BUNDLE: bundle,
  TEST_RUNNER_MT_PIP_URL: pipUrl,
};

const r = spawnSync(
  'xcodebuild',
  [
    'test-without-building',
    '-project', RUNNER,
    '-scheme', 'S56Runner',
    '-destination', `id=${UDID}`,
    '-derivedDataPath', DD,
    '-allowProvisioningUpdates',
    '-only-testing:S56UITests/S56UITests/testPiPSafariResume59283',
  ],
  { stdio: 'inherit', env, cwd: path.join(ROOT, '.local/spike/S6') },
);
process.exit(r.status === null ? 1 : r.status);
