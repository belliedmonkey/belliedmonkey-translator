// test/vp-probe.test.js — 第 1 阶段探针的源码门。
//
// 不启动麦克风、不编译 Swift。活的读数是本机 `swiftc` 之后单独跑 `--on`，
// 不进 `npm test`（CI 没有麦克风；与 test:lid / test:inbox 同一条界线）。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function swiftFiles(rel) {
  const out = [];
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'vendor') continue;
    const child = path.join(rel, ent.name);
    if (ent.isDirectory()) out.push(...swiftFiles(child));
    else if (ent.name.endsWith('.swift')) out.push(child);
  }
  return out;
}

describe('vp-probe 第 1 阶段（默认关，不改回声常数）', () => {
  test('三道回声常数仍是原值', () => {
    const src = read('app/listen-core.js');
    ok(/const ECHO_SIM = 0\.35;/.test(src), 'ECHO_SIM');
    ok(/const ECHO_TAIL_MS = 3000;/.test(src), 'ECHO_TAIL_MS');
    ok(/const ECHO_PLAY_MAX_MS = 15000;/.test(src), 'ECHO_PLAY_MAX_MS');
  });

  test('setVoiceProcessingEnabled 只出现在探针里', () => {
    const hits = [];
    for (const rel of [...swiftFiles('app'), ...swiftFiles('extension'), ...swiftFiles('scripts')]) {
      if (read(rel).includes('setVoiceProcessingEnabled')) hits.push(rel);
    }
    eq(hits.join('\n'), 'app/native/vp-probe.swift');
  });

  test('探针默认关，打开前确认引擎停着，true 只调用一次', () => {
    const probe = read('app/native/vp-probe.swift');
    ok(/static let enabledByDefault = false/.test(probe), 'enabledByDefault');
    eq(probe.split('setVoiceProcessingEnabled(true)').length - 1, 1);
    eq(probe.split('setVoiceProcessingEnabled(false)').length - 1, 1);
    const guardAt = probe.indexOf('guard engine.isRunning == false');
    const at = probe.indexOf('setVoiceProcessingEnabled(true)');
    ok(guardAt > 0 && at > guardAt && at - guardAt < 700, 'isRunning check is not immediately before enable');
    ok(!/scheduleBuffer|\.play\(/.test(probe), 'probe schedules or plays audio');
    ok(!/import WebKit|speechSynthesis|CATapDescription/.test(probe), 'probe touches WebKit, speech, or the system tap');
    ok(/API_UNAVAILABLE\(macos\)/.test(probe), 'mixWithOthers citation');
    ok(/lines 151-162/.test(probe), 'header citation');
  });

  test('探针不进双 flavor 共用的 BLOCKS', () => {
    const { BLOCKS } = require('../scripts/sync-app-assets.js');
    ok(!BLOCKS.some((b) => b.src === 'vp-probe.swift'), 'vp-probe.swift is in BLOCKS');
    ok(!read('scripts/sync-app-assets.js').includes('vp-probe.swift'), 'sync script names the probe');
  });
});
