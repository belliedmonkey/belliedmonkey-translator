#!/usr/bin/env node
// #592 #83 — PiP ⏸→▶ 后 Safari 视频仍前进。仅手动/夜间；不进 test/run.js。
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const UDID = process.env.MT_UDID || '00008120-000465443A98C01E';
const RUNNER = path.join(ROOT, '.local/spike/S6/runner/S56Runner.xcodeproj');
const DD = path.join(ROOT, '.local/spike/S6/dd-runner');
const fs = require('fs');
const bundle = process.env.MT_TARGET_BUNDLE || 'com.belliedmonkeytranslator';
const XCTEST_RUNNER = path.join(DD, 'Build/Products/Debug-iphoneos/S56UITests-Runner.app');
const FIXTURE_DIR = path.join(ROOT, 'test/fixtures');
const FIXTURE_PORT = Number(process.env.MT_PIP_PORT || '8782');

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

function portListening(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/autoplay-video.html', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function waitPortFree(port, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tryOnce = () => {
      const s = net.createConnection({ port, host: '127.0.0.1' });
      s.on('connect', () => { s.destroy(); setTimeout(tryOnce, 200); });
      s.on('error', () => resolve(true));
      if (Date.now() - t0 > ms) resolve(true);
    };
    tryOnce();
  });
}

let fixtureSrv = null;
async function ensureFixtureServer() {
  if (process.env.MT_PIP_URL) return null;
  if (await portListening(FIXTURE_PORT)) {
    console.error(`PiP 静态服已在 127.0.0.1:${FIXTURE_PORT}（沿用，未占 8781）`);
    return null;
  }
  await waitPortFree(FIXTURE_PORT, 8000);
  fixtureSrv = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--bind', '0.0.0.0'], {
    cwd: FIXTURE_DIR,
    stdio: 'ignore',
    detached: false,
  });
  fixtureSrv.on('error', (e) => {
    console.error('起 fixture 静态服失败：', e.message);
    process.exit(2);
  });
  for (let i = 0; i < 40; i++) {
    if (await portListening(FIXTURE_PORT)) {
      console.error(`PiP 静态服已自起：test/fixtures → 0.0.0.0:${FIXTURE_PORT}（勿占 8781）`);
      return fixtureSrv;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`8782 上 autoplay-video.html 未就绪`);
  process.exit(2);
}

function shutdownFixture() {
  if (fixtureSrv && !fixtureSrv.killed) {
    try { fixtureSrv.kill('SIGTERM'); } catch (_) {}
  }
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

async function main() {
  await ensureFixtureServer();
  process.on('exit', shutdownFixture);
  process.on('SIGINT', () => { shutdownFixture(); process.exit(130); });
  process.on('SIGTERM', () => { shutdownFixture(); process.exit(143); });

  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  const pipUrl = process.env.MT_PIP_URL
    || (lan ? `http://${lan.address}:${FIXTURE_PORT}/autoplay-video.html` : `http://127.0.0.1:${FIXTURE_PORT}/autoplay-video.html`);

  console.error('MT_PIP_URL=', pipUrl);

  const env = {
    ...process.env,
    TEST_RUNNER_MT_TARGET_BUNDLE: bundle,
    TEST_RUNNER_MT_PIP_URL: pipUrl,
    // iPhone 14 Pro（2026-10-18）：PiP 控件条与 testPiPClose ✕ 同高
    TEST_RUNNER_MT_PIP_PAUSE_X: process.env.MT_PIP_PAUSE_X || '0.26',
    TEST_RUNNER_MT_PIP_PAUSE_Y: process.env.MT_PIP_PAUSE_Y || '0.66',
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
  shutdownFixture();
  process.exit(r.status === null ? 1 : r.status);
}

main().catch((e) => {
  console.error(e);
  shutdownFixture();
  process.exit(1);
});
