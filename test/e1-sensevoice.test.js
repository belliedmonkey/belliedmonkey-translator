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

// 源码形态门（Swift 没有运行时测试目标）：按成员切段，钉「谁在谁之后 / 谁不再出现」。
// 这是形态断言，不是行为证明 —— 真机矩阵仍按 docs/verification-spec.md 跑。
function member(startMarker, endMarker) {
  const i = SWIFT_E1.indexOf(startMarker);
  if (i < 0) return '';
  let j = SWIFT_E1.length;
  if (endMarker) {
    const k = SWIFT_E1.indexOf(endMarker, i + startMarker.length);
    if (k >= 0) j = k;
  }
  return SWIFT_E1.slice(i, j);
}

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
  test('JS 只认 schema：未存过/true 才 e1_b1，显式 false 才 sa', () => {
    const lm = read('src/app/listen-model.js');
    ok(!/zh_asr_e1_arm/.test(lm), 'listen-model 仍引用旧开发键 zh_asr_e1_arm');
    ok(!/testBridge/.test(lm), 'listen-model 仍留 testBridge');
    ok(/zhAsrE1Arm:\s*\(isMacHost\(\)\s*&&\s*Registry\.flavor\(\)\s*!==\s*'china'\s*&&\s*s\.zhAsrE1\s*!==\s*false\)\s*\?\s*'e1_b1'\s*:\s*'sa'/.test(lm),
      '听译未按 intl Mac + zhAsrE1 !== false 选臂');
    ok(!lm.includes('__mtTest'), 'listen-model 含 __mtTest 字面量（出货包会带测试桥）');
    ok(/zhAsrE1Arm: \(cfg && cfg\.zhAsrE1Arm === 'e1_b1'\) \? 'e1_b1' : 'sa'/.test(lm), 'sttOpen 未传臂');
    const resume = lm.slice(lm.indexOf('async function resume()'), lm.indexOf('function resumeByUser'));
    ok(resume && !/readCfg/.test(resume), 'resume() 重读了 readCfg（会话应钉住本场臂）');
    const schema = read('src/store/schema.js');
    ok(!/zh_asr_e1_arm/.test(schema), 'zh_asr_e1_arm 不应进 schema');
  });
  test('schema zhAsrE1 默认 true、app+listen 双面可见', () => {
    const ctx = loadSrc('src/store/schema.js', 'SETTINGS_SCHEMA', { MT_PALETTE: {} });
    const S = ctx.SETTINGS_SCHEMA;
    eq(S.defaultFor('zhAsrE1'), true, 'zhAsrE1 默认不是 true');
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

describe('E1 B1 五条锁拆除（BEL-19 land_drop）', () => {
  test('5 条 SA final 整场锁的旋钮彻底消失', () => {
    ok(!/suppressedSaFinalLimit|suppressedSaFinals/.test(SWIFT_E1), 'suppressedSaFinal/Limit 仍在');
    ok(!/consecutive_empty_final/.test(SWIFT_E1), '旧 consecutive_empty_final 仍在');
  });

  test('硬锁只留 start()：sessionLockedToSa = true 全文件一处', () => {
    eq((SWIFT_E1.match(/sessionLockedToSa\s*=\s*true/g) || []).length, 1, '硬锁赋值点不是一处');
    const i = SWIFT_E1.indexOf('sessionLockedToSa = true');
    const s = SWIFT_E1.indexOf('func start()');
    const t = SWIFT_E1.indexOf('func stop()');
    ok(i > s && i < t, '唯一的硬锁赋值不在 start() 里');
    const note = member('private func noteEmptyFinal', 'private func sanitize');
    ok(note && !/sessionLockedToSa\s*=\s*true/.test(note), '空 SV 段仍硬锁整场');
  });

  test('软等待 svWaitMs 在 12–20 秒（钉 15.0），时钟用 systemUptime', () => {
    const m = SWIFT_E1.match(/private let svWaitMs: Double = ([0-9.]+)/);
    ok(m, 'svWaitMs 常量缺失');
    const v = Number(m[1]);
    ok(v >= 12 && v <= 20, 'svWaitMs 越界: ' + v);
    eq(v, 15, 'svWaitMs 不是 15.0');
    ok(/ProcessInfo\.processInfo\.systemUptime/.test(SWIFT_E1), '计时源不是 systemUptime');
  });

  test('计时锚 = 最早被扣 SA final 的年龄（pendingSince），不是会话开始', () => {
    ok(/private var pendingSince: Double\?/.test(SWIFT_E1), 'pendingSince 缺失');
    ok(/private var pendingSaFinals: \[\[String: Any\]\]/.test(SWIFT_E1), 'pendingSaFinals 缓存缺失');
    ok(/private func flushPendingSaFinals\(\)/.test(SWIFT_E1), 'flushPendingSaFinals 缺失');
    ok(/NSLock\(\)/.test(SWIFT_E1) && /e1Lock\.lock\(\)/.test(SWIFT_E1), 'NSLock 跨线程守卫缺失');
    const maybe = member('private func maybeEnterPassthrough', 'private func onPcm16');
    ok(/pendingSince/.test(maybe) && /svWaitMs/.test(maybe), '超时判定没用 pendingSince/svWaitMs');
    ok(!/sessionStartedAt|sessionStart|startedAt\b/.test(SWIFT_E1), '仍在用会话开始做计时锚');
  });

  test('计时检查在 onPcm16、且在 svVad.accept 之后', () => {
    const on = member('private func onPcm16', 'private func onSvSegment');
    const accept = on.indexOf('svVad.accept(pcm)');
    const maybe = on.indexOf('maybeEnterPassthrough()');
    ok(accept >= 0, 'onPcm16 不再喂 svVad');
    ok(maybe > accept, 'maybeEnterPassthrough 不在 svVad.accept 之后');
  });

  test('stop() 清 emit 前回放 pending SA final', () => {
    const stop = member('func stop()', 'func cut()');
    const flush = stop.indexOf('flushPendingSaFinals()');
    const clear = stop.indexOf('sa.emit = nil');
    ok(flush >= 0 && clear >= 0 && flush < clear, 'stop() 没有在清 emit 前 flushPendingSaFinals()');
  });

  test('SA final：SV 出定稿前扣住、软放行；不再 5 条整场锁', () => {
    const fin = member('if typ == "stt-final"', 'private func currentSegId');
    ok(/svPassthrough/.test(fin) && /pendingSaFinals\.append/.test(fin), 'final 分支没有 pending 缓存/软放行');
    ok(/emit\?\(p\)/.test(fin), '软放行后没有放行 SA final');
    ok(!/suppressedSaFinalLimit/.test(fin) && !/saFinalsSinceSv\s*>=\s*5/.test(fin), '5 条整场锁还在');
  });

  test('SV 成功恢复：清 pending / 撤销 passthrough / conf 0.9 仍在', () => {
    const seg = member('private func onSvSegment', 'private func noteEmptyFinal');
    ok(/guard !sessionLockedToSa/.test(seg), 'onSvSegment 硬锁 guard 被改坏');
    ok(/svFinals \+= 1/.test(seg), 'SV 成功未计数');
    ok(/saFinalsSinceSv = 0/.test(seg), 'SV 成功未清 SA 计数');
    ok(/pendingSaFinals\.removeAll/.test(seg) && /pendingSince = nil/.test(seg), 'SV 成功未清 pending');
    ok(/svPassthrough = false/.test(seg), 'SV 成功未撤销 passthrough');
    ok(/"conf": 0\.9/.test(seg), 'SV 定稿 conf 0.9 被改');
    ok(/phase: "recover"/.test(seg), '恢复未发 recover 遥测');
  });

  test('land_drop：整段起点早于 passthroughAtFed16k ⇒ 丢 SV 定稿，只发 recover', () => {
    ok(/private var passthroughAtFed16k: Int64/.test(SWIFT_E1), '未记 passthroughAtFed16k');
    const seg = member('private func onSvSegment', 'private func noteEmptyFinal');
    const i = seg.search(/startIdx\s*<\s*Int\((passthroughAtFed16k|passAt)\)/);
    const j = seg.indexOf('emit?(payload)');
    ok(i >= 0, '恢复时未按 startIdx 与入口比较');
    ok(/let passAt = passthroughAtFed16k/.test(seg), '入口位置未在锁内取快照（跨线程读 passthroughAtFed16k）');
    ok(j > i, '丢段判断不在 emit SV 定稿之前');
    ok(/dropped: 1/.test(seg), '重叠段未标 dropped');
    const drop = seg.slice(i, j);
    ok(/return/.test(drop), '丢段分支没有 return，SV 定稿仍会上屏');
  });

  test('空 SV 段改软：sv_empty_finals，不碰 sessionLockedToSa', () => {
    const note = member('private func noteEmptyFinal', 'private func sanitize');
    ok(/svEmptyFinals/.test(note), '空段未走 sv_empty_finals 软放行');
    ok(/enterPassthroughLocked/.test(note), '空段未进软放行');
    ok(!/sessionLockedToSa\s*=\s*true/.test(note), '空段仍硬锁');
  });

  test('e1 遥测：state e1-fallback + phase/after_ms/sv_finals/sa_finals，零内容', () => {
    ok(/"state": "e1-fallback"/.test(SWIFT_E1), 'state 不是 e1-fallback');
    for (const k of ['e1_phase', 'e1_after_ms', 'e1_sv_finals', 'e1_sa_finals']) ok(SWIFT_E1.includes(k), '缺遥测字段 ' + k);
    ok(!/"state": "ready"/.test(SWIFT_E1), 'E1 回退仍发 state:ready（会误 fire sttSession）');
    ok(/phase: "hard"/.test(SWIFT_E1) && /phase: "soft"/.test(SWIFT_E1), '硬/软 phase 缺失');
  });
});

describe('E1 失败回退枚举', () => {
  test('e1_fallback_reason 封闭枚举（9 值，旧值已删）', () => {
    for (const r of ['model_not_ready', 'model_sha_mismatch', 'download_failed', 'load_failed',
                     'init_timeout', 'oom', 'sv_no_final_timeout', 'sv_empty_finals', 'sherpa_unavailable']) {
      ok(SWIFT_E1.includes('"' + r + '"'), '缺枚举 ' + r);
    }
    ok(!SWIFT_E1.includes('consecutive_empty_final'), '旧 consecutive_empty_final 仍在');
  });
});

describe('BEL-19 中文默认 SenseVoice — 设置行与 13 语文案', () => {
  const VIEW = read('src/app/settings-view.jsx');
  const ROW = (VIEW.match(/<label[^>]*id="listen-e1-row"[^>]*>/) || [''])[0];
  const NOTE = (VIEW.match(/<p[^>]*id="listen-e1-note"[^>]*>/) || [''])[0];
  const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt_BR', 'ru', 'th', 'zh_CN', 'zh_TW'];
  const M = {};
  for (const l of LOCALES) M[l] = JSON.parse(read('extension/_locales/' + l + '/messages.json'));

  test('设置页读 !== false；行常显（去 adv-only / !detail），China/iOS 仍 hidden', () => {
    ok(/\$\('listen-e1'\)\.checked = cur\.zhAsrE1 !== false;/.test(VIEW),
      '设置页回填仍不是 cur.zhAsrE1 !== false');
    ok(ROW, '找不到 listen-e1-row 的 label 开标签');
    ok(!/adv-only/.test(ROW), 'listen-e1-row 仍带 adv-only');
    ok(!/!detail/.test(ROW), 'listen-e1-row 仍被 !detail 隐藏');
    ok(/hidden=\{!listenModel\.isMacHost\(\) \|\| isChinaFlavor\(\)\}/.test(ROW),
      'listen-e1-row 未保留 Mac 非中国 hidden 门');
    ok(NOTE, '找不到 listen-e1-note 的开标签');
    ok(!/adv-only/.test(NOTE), 'listen-e1-note 仍带 adv-only');
    ok(!/!detail/.test(NOTE), 'listen-e1-note 仍被 !detail 隐藏');
    ok(/hidden=\{!listenModel\.isMacHost\(\) \|\| isChinaFlavor\(\)\}/.test(NOTE),
      'listen-e1-note 未保留 Mac 非中国 hidden 门');
  });

  test('13 语 app_e1_note 含 160，且不再以旧「默认关闭」前缀开头', () => {
    const OLD = ['Off by default', '默认关闭', '預設關閉', '既定ではオフ', 'Standardmäßig aus',
      'Desactivado por defecto', 'Désactivé par défaut', 'Desativado por padrão',
      'По умолчанию выключено', 'معطّل افتراضيًا', 'डिफ़ॉल्ट रूप से बंद',
      '기본적으로 꺼져', 'ปิดเป็นค่าเริ่มต้น'];
    eq(Object.keys(M).length, 13, 'locale 数不是 13');
    for (const l of LOCALES) {
      const note = ((M[l].app_e1_note || {}).message || '');
      ok(note.includes('160'), l + ' 的 app_e1_note 未写约 160MB');
      for (const p of OLD) ok(note.indexOf(p) !== 0, l + ' 的 app_e1_note 仍以旧默认关前缀开头: ' + p);
    }
  });

  test('en / zh_CN / zh_TW label 去「实验」', () => {
    ok(!/Experimental/.test(M.en.app_e1_label.message), 'en label 仍带 Experimental');
    ok(!/实验/.test(M.zh_CN.app_e1_label.message), 'zh_CN label 仍带「实验」');
    ok(!/實驗/.test(M.zh_TW.app_e1_label.message), 'zh_TW label 仍带「實驗」');
  });

  test('en / zh_CN 兜底文案逐字', () => {
    eq(M.en.app_e1_label.message, 'Chinese speech-to-text with SenseVoice');
    eq(M.en.app_e1_note.message,
      'On by default for Chinese (zh) only. The model downloads in the background on first use (about 160 MB); until it finishes, and on failure, system dictation is used. It takes effect on the next session. Turn off to go back to system dictation.');
    eq(M.zh_CN.app_e1_label.message, '中文听译 SenseVoice');
    eq(M.zh_CN.app_e1_note.message,
      '默认开启，仅中文（zh）。首次使用会在后台下载约 160MB；下载完成前及失败时仍用系统听写，完成后的下一次会话生效。关闭后回到系统听写。');
  });
});
