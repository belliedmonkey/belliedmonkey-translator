// test/e1-sensevoice.test.js — BEL-19 E1 SenseVoice VAD 最小接线（SPEC-E1）
// 钉：VAD 常量锁 · RecognizerFactory 唯一分叉 · Release 也接受显式 e1_b1（默认 sa）· 关臂 ≡ 基线 · 模型中继
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SWIFT_E1 = read('app/native/e1-sensevoice.swift');
const SWIFT_SB = read('app/native/speech-bridge.swift');
const MODELS = require('../app/device-models.config.js');

describe('E1 VAD 参数锁 sil0.5_thr0.3_max8', () => {
  test('原生 MTE1VadLock 三值写死', () => {
    ok(/static let armName = "sil0\.5_thr0\.3_max8"/.test(SWIFT_E1), 'armName 缺失');
    ok(/static let minSilenceDuration: Float = 0\.5/.test(SWIFT_E1), 'minSilence 非 0.5');
    ok(/static let threshold: Float = 0\.3/.test(SWIFT_E1), 'threshold 非 0.3');
    ok(/static let maxSpeechDuration: Float = 8\.0/.test(SWIFT_E1), 'maxSpeech 非 8');
  });
  test('device-models 清单镜像同一臂名与三值', () => {
    ok(MODELS.MT_DEVICE_SENSEVOICE.vadArm === 'sil0.5_thr0.3_max8', 'vadArm');
    const v = MODELS.MT_DEVICE_SENSEVOICE.vad;
    ok(v.minSilenceDuration === 0.5 && v.threshold === 0.3 && v.maxSpeechDuration === 8, 'vad 三值');
  });
  test('LID 门 MTDeviceVad 默认仍 thr0.5/sil0.25/max5（未盖掉）', () => {
    ok(/threshold:\s*0\.5,\s*minSilenceDuration:\s*0\.25/.test(SWIFT_SB), 'LID VAD 默认被改');
    ok(/maxSpeechDuration:\s*5\.0/.test(SWIFT_SB), 'LID maxSpeech 被改');
  });
});

describe('E1 RecognizerFactory 唯一分叉', () => {
  test('工厂符号存在且 sttStart 调用', () => {
    ok(/enum RecognizerFactory/.test(SWIFT_E1), '无 RecognizerFactory');
    ok(/static func make\(lane:/.test(SWIFT_E1), '无 make(lane:arm:)');
    ok(/RecognizerFactory\.make\(/.test(SWIFT_SB), 'sttStart 未走工厂');
    ok(/RecognizerFactory\.resolveArm\(/.test(SWIFT_SB), 'sttStart 未 resolveArm');
  });
  test('Release 也接受显式 e1_b1；nil / 其它恒 sa（无 #if DEBUG）', () => {
    ok(!/#if DEBUG/.test(SWIFT_E1), 'resolveArm 仍带 #if DEBUG');
    ok(/static func resolveArm\(_ raw: String\?\) -> MTE1Arm \{\s*if \(raw \?\? ""\)\.lowercased\(\) == MTE1Arm\.e1_b1\.rawValue \{ return \.e1_b1 \}\s*return \.sa\s*\}/.test(SWIFT_E1),
      'resolveArm 未按「显式 e1_b1 即接受，其余 sa」实现');
  });
  test('出口仍 stt-partial / stt-final（无第二收听口 / 无 asr_result 改名）', () => {
    ok(/"stt-partial"/.test(SWIFT_E1) && /"stt-final"/.test(SWIFT_E1), 'E1 出口改名');
    ok(!/type:\s*"asr_result"/.test(SWIFT_E1), '不应本 tip 改名 asr_result');
  });
});

describe('E1 关臂 ≡ 基线 SA', () => {
  test('arm=sa / lane!=zh ⇒ 现货 MTDeviceTranscriber', () => {
    const make = SWIFT_E1.slice(SWIFT_E1.indexOf('static func make(lane:'));
    const zhArm = make.indexOf('if arm == .e1_b1 && base == "zh" {');
    const b1 = make.indexOf('return MTE1B1Transcriber(locales:');
    const fallback = make.indexOf('return MTDeviceTranscriber(locales:');
    ok(fallback >= 0, 'sa 臂未回落 MTDeviceTranscriber');
    ok(zhArm >= 0 && b1 > zhArm && fallback > b1,
      'e1_b1 未限 zh（lane!=zh 应走 MTDeviceTranscriber）');
  });
  test('JS 只认 schema：zhAsrE1 为 true 才 e1_b1，其余 sa', () => {
    const lm = read('src/app/listen-model.js');
    ok(!/zh_asr_e1_arm/.test(lm), 'listen-model 仍引用旧开发键 zh_asr_e1_arm');
    ok(!/testBridge/.test(lm), 'listen-model 仍留 testBridge');
    ok(/zhAsrE1Arm: s\.zhAsrE1 === true \? 'e1_b1' : 'sa'/.test(lm),
      '听译未按 schema zhAsrE1 选臂');
    ok(!lm.includes('__mtTest'), 'listen-model 含 __mtTest 字面量（出货包会带测试桥）');
    ok(/zhAsrE1Arm: \(cfg && cfg\.zhAsrE1Arm === 'e1_b1'\) \? 'e1_b1' : 'sa'/.test(lm), 'sttOpen 未传臂');
    const schema = read('src/store/schema.js');
    ok(!/zh_asr_e1_arm/.test(schema), 'zh_asr_e1_arm 不应进 schema');
  });
  test('schema zhAsrE1 默认 false、app+listen 双面可见', () => {
    const ctx = loadSrc('src/store/schema.js', 'SETTINGS_SCHEMA', { MT_PALETTE: {} });
    const S = ctx.SETTINGS_SCHEMA;
    eq(S.defaultFor('zhAsrE1'), false, 'zhAsrE1 默认不是 false');
    ok(S.keysFor('app').includes('zhAsrE1'), 'app 面读不到 zhAsrE1');
    ok(S.keysFor('listen').includes('zhAsrE1'), 'listen 面读不到 zhAsrE1');
  });
});

describe('E1 模型中继', () => {
  test('SenseVoice URL 只走 MT_MODEL_RELAY', () => {
    const m = MODELS.mtDeviceSenseVoiceFor('china');
    const u = m.files[0].url;
    ok(u.startsWith('https://api.belliedmonkey.com/models/'), '非中继: ' + u);
    ok(!/huggingface|hf-mirror/i.test(JSON.stringify(m)), '清单含 HF 字样');
  });
  test('sync-app-assets 登记 e1 块', () => {
    const sync = read('scripts/sync-app-assets.js');
    ok(/mt-e1-sensevoice/.test(sync) && /e1-sensevoice\.swift/.test(sync), '未登记 BLOCK');
  });
});

describe('E1 失败回退枚举', () => {
  test('e1_fallback_reason 封闭枚举', () => {
    for (const r of ['model_not_ready', 'model_sha_mismatch', 'download_failed', 'load_failed',
                     'init_timeout', 'oom', 'consecutive_empty_final', 'sherpa_unavailable']) {
      ok(SWIFT_E1.includes('"' + r + '"') || SWIFT_E1.includes("= \"" + r + "\""), '缺枚举 ' + r);
    }
  });
});
