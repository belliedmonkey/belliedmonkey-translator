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

  test('探针默认关；两次打开都先确认引擎停着', () => {
    const probe = read('app/native/vp-probe.swift');
    ok(/static let enabledByDefault = false/.test(probe), 'enabledByDefault');
    eq(probe.split('setVoiceProcessingEnabled(true)').length - 1, 4);
    eq(probe.split('setVoiceProcessingEnabled(false)').length - 1, 4);
    let from = 0;
    while (from < probe.length) {
      const at = probe.indexOf('setVoiceProcessingEnabled(true)', from);
      if (at < 0) break;
      const guardAt = probe.lastIndexOf('guard engine.isRunning == false', at);
      ok(guardAt >= 0 && at - guardAt < 700, 'isRunning check is not immediately before enable');
      from = at + 1;
    }
    const playerAt = probe.indexOf('static func runPlayerFrames()');
    const afterPlayer = probe.indexOf('private static func tapBufferChoice', playerAt);
    ok(playerAt > 0 && afterPlayer > playerAt, 'runPlayerFrames missing');
    const withoutPlayer = probe.slice(0, playerAt) + probe.slice(afterPlayer);
    ok(!/scheduleBuffer|\.play\(/.test(withoutPlayer), 'a path other than --player-frames schedules or plays');
    ok(!/import WebKit|speechSynthesis|CATapDescription/.test(probe), 'probe touches WebKit, speech, or the system tap');
    ok(/API_UNAVAILABLE\(macos\)/.test(probe), 'mixWithOthers citation');
    ok(/lines 151-162/.test(probe), 'header citation');
  });

  test('--format-only 不 start、不 prepare、不挂节点、不装 tap', () => {
    const probe = read('app/native/vp-probe.swift');
    const main = read('scripts/vp-probe-main.swift');
    const begin = probe.indexOf('static func runFormatOnly()');
    const end = probe.indexOf('private static func measure', begin);
    ok(begin > 0 && end > begin, 'runFormatOnly missing');
    const body = probe.slice(begin, end);
    ok(!/engine\.start\(|\.prepare\(|installAudioTap|installTap|connectNode|AVAudioPlayerNode/.test(body), body.slice(0, 200));
    ok(/--format-only/.test(main), 'main has no --format-only');
    ok(!/enabledByDefault = true/.test(probe), 'default flipped on');
  });

  test('--input-frames 只 start 一次，不挂播放、不连混音器', () => {
    const probe = read('app/native/vp-probe.swift');
    const main = read('scripts/vp-probe-main.swift');
    const begin = probe.indexOf('static func runInputFrames()');
    const end = probe.indexOf('private static let inputFramesWindowMs', begin);
    ok(begin > 0 && end > begin, 'runInputFrames missing');
    const body = probe.slice(begin, end);
    eq(body.split('engine.start()').length - 1, 1);
    ok(!/\.prepare\(|connectNode|mainMixerNode|AVAudioPlayerNode/.test(body), 'input-frames connects or prepares');
    ok(/installAudioTap/.test(body), 'input-frames does not install the documented tap');
    ok(/--input-frames/.test(main), 'main has no --input-frames');
  });

  test('--player-frames 先开回声消除再挂播放，只 start 一次，格式不手改', () => {
    const probe = read('app/native/vp-probe.swift');
    const main = read('scripts/vp-probe-main.swift');
    const begin = probe.indexOf('static func runPlayerFrames()');
    const end = probe.indexOf('private static let playerFramesWindowMs', begin);
    ok(begin > 0 && end > begin, 'runPlayerFrames missing');
    const body = probe.slice(begin, end);
    eq(body.split('engine.start()').length - 1, 1);
    eq(body.split('setVoiceProcessingEnabled(true)').length - 1, 1);
    eq(body.split('scheduleBuffer(').length - 1, 1);
    eq(body.split('player.playAudio()').length - 1, 1);
    ok(/connectNode\(player, to: engine\.mainMixerNode, format: nil\)/.test(body), 'connect format is not nil');
    ok(!/\.prepare\(/.test(body), 'player-frames prepares');
    ok(/bufferSize: playerTapFrames/.test(body), 'tap does not use playerTapFrames');
    ok(/private static let playerTapFrames: AVAudioFrameCount = 8192/.test(probe), 'tap frames are not 8192');
    ok(/playerToneAmplitude/.test(body) && /playerToneHz/.test(body), 'tone constants missing');
    const enableAt = body.indexOf('setVoiceProcessingEnabled(true)');
    const attachAt = body.indexOf('engine.attach(player)');
    const connectAt = body.indexOf('connectNode(');
    const tapAt = body.indexOf('installAudioTap');
    const startAt = body.indexOf('engine.start()');
    const playAt = body.indexOf('player.playAudio()');
    ok(enableAt >= 0 && enableAt < attachAt && attachAt < connectAt && connectAt < tapAt && tapAt < startAt && startAt < playAt, 'order is not enable, attach, connect, tap, start, play');
    ok(/--player-frames/.test(main), 'main has no --player-frames');
    ok(!/enabledByDefault = true/.test(probe), 'default flipped on');
    ok(!/sherpa|import WebKit|speechSynthesis|CATapDescription|AVSpeechSynthesizer/.test(body), 'player-frames touches speech or WebKit');
  });

  test('探针不进双 flavor 共用的 BLOCKS', () => {
    const { BLOCKS } = require('../scripts/sync-app-assets.js');
    ok(!BLOCKS.some((b) => b.src === 'vp-probe.swift'), 'vp-probe.swift is in BLOCKS');
    ok(!read('scripts/sync-app-assets.js').includes('vp-probe.swift'), 'sync script names the probe');
  });
});
