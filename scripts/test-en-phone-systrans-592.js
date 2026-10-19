#!/usr/bin/env node
// #592 #122 — en-phone-systrans 验收：probe 服务 + testSwitchDefault + testV9Shot（MT_SKIP_VPN=1）。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { probe: devicectlProbe } = require('./mt592-ext-path.js');

const ROOT = path.resolve(__dirname, '..');
const UDID = process.env.MT_UDID || '00008120-000465443A98C01E';
const RUNNER = path.join(ROOT, '.local/spike/S6/runner/S56Runner.xcodeproj');
const RUNNER_DIR = path.join(ROOT, '.local/spike/S6/runner');
const DD = path.join(ROOT, '.local/spike/S6/dd-runner');
const XCTEST_RUNNER = path.join(DD, 'Build/Products/Debug-iphoneos/S56UITests-Runner.app');
const DEFAULT_APP = path.join(
  ROOT,
  '.local/ios-debug-dd-120/Build/Products/Debug-iphoneos/BelliedMonkey Translator.app',
);

function lanIPv4() {
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i && i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

function xcode(args, env = process.env) {
  return spawnSync('xcodebuild', args, {
    stdio: 'inherit',
    env,
    cwd: path.join(ROOT, '.local/spike/S6'),
  });
}

function syncRunnerSources() {
  const pairs = [
    ['UITests/S56UITests.swift', 'UITests/S56UITests.swift'],
    ['Host/HostApp.swift', 'Host/HostApp.swift'],
    ['project.yml', 'project.yml'],
  ];
  for (const [rel] of pairs) {
    fs.copyFileSync(path.join(ROOT, 'tools/ios-runner', rel), path.join(RUNNER_DIR, rel));
  }
  const gen = spawnSync('xcodegen', ['generate'], { cwd: RUNNER_DIR, encoding: 'utf8' });
  if (gen.status !== 0) {
    process.stderr.write((gen.stderr || gen.stdout || 'xcodegen failed') + '\n');
    process.exit(gen.status == null ? 1 : gen.status);
  }
}

function ensureRunnerBuilt() {
  if (!fs.existsSync(RUNNER)) {
    console.error('缺少 .local/spike/S6/runner — 见 tools/ios-runner/README.md');
    process.exit(2);
  }
  syncRunnerSources();
  if (!fs.existsSync(XCTEST_RUNNER) || process.env.MT592_REBUILD_RUNNER === '1') {
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
}

function runTest(name, extraEnv = {}) {
  const probeUrl = extraEnv.MT592_PROBE_URL || process.env.MT592_PROBE_URL || '';
  const env = {
    ...process.env,
    TEST_RUNNER_MT_SKIP_VPN: '1',
    TEST_RUNNER_MT_URL: process.env.MT_URL || 'https://example.org/',
    ...Object.fromEntries(
      Object.entries(extraEnv).map(([k, v]) => [`TEST_RUNNER_${k}`, String(v)]),
    ),
  };
  if (probeUrl) env.TEST_RUNNER_MT592_PROBE_URL = probeUrl;
  return xcode([
    'test-without-building',
    '-project', RUNNER,
    '-scheme', 'S56Runner',
    '-destination', `id=${UDID}`,
    '-derivedDataPath', DD,
    '-allowProvisioningUpdates',
    '-resultBundlePath', path.join(ROOT, '.local/spike/S6', `x-592-${name}.xcresult`),
    `-only-testing:S56UITests/S56UITests/${name}`,
  ], env);
}

function startProbeServer() {
  const port = Number(process.env.MT592_PROBE_PORT || '59292');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/mt592-probe-server.js')], {
    env: { ...process.env, MT592_PROBE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child, port, url: `http://${lanIPv4()}:${port}` };
}

function waitHealth(url, ms = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      http.get(`${url}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else if (Date.now() > deadline) reject(new Error('probe health timeout'));
        else setTimeout(tick, 300);
      }).on('error', () => {
        if (Date.now() > deadline) reject(new Error('probe health timeout'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function switchDefaultWithMacInject(probeUrl) {
  for (let row = 0; row < 2; row++) {
    const r = runTest('test592DefaultRowProbe', { MT592_ROW: row, MT592_PROBE_URL: probeUrl });
    if (r.status !== 0) return r;
    const p = devicectlProbe();
    process.stderr.write(`devicectl row${row}: ${p.path || '(none)'}\n`);
    if (p.intl) {
      return runTest('test592AssertIntlExtPath', { MT592_EXT_PATH: p.path, MT592_PROBE_URL: probeUrl });
    }
  }
  process.stderr.write('两行默认翻译 App 都未指向国际版 MTTranslateExt\n');
  return { status: 1 };
}

async function main() {
  const appPath = process.env.MT592_APP || DEFAULT_APP;
  if (fs.existsSync(appPath)) {
    const gate = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-mttranslateext-gate.js'), appPath], {
      encoding: 'utf8',
    });
    process.stderr.write(gate.stdout || gate.stderr || '');
    if (gate.status !== 0) process.exit(gate.status == null ? 1 : gate.status);
    if (process.env.MT592_INSTALL_APP === '1') {
      const ins = spawnSync('xcrun', ['devicectl', 'device', 'install', 'app', '--device', UDID, appPath], {
        stdio: 'inherit',
      });
      if (ins.status !== 0) process.exit(ins.status == null ? 1 : ins.status);
    }
  } else {
    process.stderr.write(`跳过门禁/装包：找不到 ${appPath}\n`);
  }

  ensureRunnerBuilt();
  const probe = startProbeServer();
  try {
    await waitHealth(probe.url);
  } catch (e) {
    probe.child.kill();
    console.error(e.message);
    process.exit(2);
  }

  const envBase = { MT592_PROBE_URL: probe.url };
  const mode = process.env.MT592_SWITCH_MODE || 'split';
  const sw = mode === 'monolith'
    ? runTest('testSwitchDefault', envBase)
    : switchDefaultWithMacInject(probe.url);
  if (sw.status !== 0) {
    probe.child.kill();
    process.exit(sw.status == null ? 1 : sw.status);
  }
  const v9 = runTest('testV9Shot', envBase);
  probe.child.kill();
  process.exit(v9.status == null ? 1 : v9.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
