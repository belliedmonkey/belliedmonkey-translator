// test/dep-line.test.js — 功能块首行的「依赖」行（interaction-spec「设置页信息架构」②，2026-09-17）。
// 判据来自既有判据，标签来自注册表，快速档一句话，不可用的实时转写没有「去配置」。
//
// PR7a 锚点迁移：源从 extension/learn/dep-line.js（IIFE）换到 src/shared/dep-line.js
// （纯 ESM，§9.4 两宿主单源）。items() 五槽四态断言零改；旧 render(el,…) 的 DOM 拼接
// 退成纯映射 segments(list, onGo) —— 换成数据断言（' · ' 前缀、'：'、' ✓' 后缀、go 字段），
// 视觉输出本身由 dep-line-view.jsx 组件承担、走真 Chrome 的 CDP 门（vm 不测组件，§10）。
// EngineState / EngineFields 仍是全局兜底（PR7b 翻），按生产同构把真源码跑进同一 context。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadSrc, describe, test, ok, eq, deepEq } = require('./harness');

const PROVIDERS = [{ id: 'google', label: 'Google', needsKey: false }, { id: 'deepseek', label: 'DeepSeek', needsKey: true }];
const TTS = [{ id: 'browser', label: '设备内置语音', labelKey: 'tts_engine_browser' }, { id: 'device', label: '设备内置朗读', type: 'device-speech' }];
const STT = [{ id: 'openrouter_transcribe', label: 'OpenRouter · transcription' }];
const T = (k, d) => (k === 'tts_engine_browser' ? '系统语音' : d);

const EXT_ROOT = path.join(__dirname, '..', 'extension');

function load() {
  const ctx = loadSrc('src/shared/dep-line.js', 'DepLine', {
    window: { MT_PROVIDERS: PROVIDERS, MT_TTS_ENGINES: TTS, MT_STT_ENGINES: STT },
  });
  // 生产里 EngineState / EngineFields 是先于 dep-line 的独立 <script>/拼接段（全局兜底）；
  // 这里把同两份真源码跑进同一 context，与生产同构。
  for (const f of ['content/engine-state.js', 'learn/engine-fields.js']) {
    vm.runInContext(fs.readFileSync(path.join(EXT_ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.DepLine;
}

describe('DepLine.items — 五种槽、四种状态', () => {
  test('翻译：配了 key ⇒ ok + 注册表标签；没配 ⇒ unset', () => {
    const D = load();
    deepEq(D.items({ provider: 'deepseek', apiKey: 'k' }, { slots: ['chat'], t: T }).map((x) => [x.state, x.label]), [['ok', 'DeepSeek']]);
    eq(D.items({ provider: 'deepseek' }, { slots: ['chat'], t: T })[0].state, 'unset');
  });
  test('朗读 / 整段转写：引擎 id 在注册表里 ⇒ ok（标签走 labelKey）；空 ⇒ unset', () => {
    const D = load();
    const r = D.items({ ttsEngine: 'browser', sttEngine: '' }, { slots: ['tts', 'stt'], t: T });
    deepEq(r.map((x) => [x.slot, x.state, x.label]), [['tts', 'ok', '系统语音'], ['stt', 'unset', '']]);
    eq(r[1].text, '未配置');
  });
  test('解析：notesProvider 为空 = 跟随翻译引擎（follow，不是 unset）', () => {
    const D = load();
    eq(D.items({}, { slots: ['notes'], t: T })[0].state, 'follow');
    eq(D.items({ notesProvider: 'deepseek' }, { slots: ['notes'], t: T })[0].label, 'DeepSeek');
  });
  test('实时转写：由宿主传 NativeSpeech 的结论 —— ok 是本机；不可用是 na，文案分系统 / 语言', () => {
    const D = load();
    eq(D.items({}, { slots: ['live'], live: { ok: true }, t: T })[0].state, 'ok');
    const os = D.items({}, { slots: ['live'], live: { ok: false, reason: 'os' }, t: T })[0];
    ok(os.state === 'na' && /iOS 26/.test(os.text), JSON.stringify(os));
    ok(/语言/.test(D.items({}, { slots: ['live'], live: { ok: false, reason: 'locale' }, t: T })[0].text));
  });
  test('快速档且一键卡表示得了这份配置 ⇒ 只有一句「由一键配置提供 ✓」', () => {
    const D = load();
    const r = D.items({ provider: 'deepseek', apiKey: 'k' }, { slots: ['chat', 'tts'], quick: true, t: T });
    eq(r.length, 1); eq(r[0].state, 'quick');
  });
});

describe('DepLine.segments — 旧 render 的文本拼接现在是数据；go 只给 unset', () => {
  test('每槽一段：ok 带 ✓、unset 带 go、na 没有 go；文本逐字同构', () => {
    const D = load();
    const segs = D.segments(
      D.items({ ttsEngine: 'browser', sttEngine: '' }, { slots: ['tts', 'stt', 'live'], live: { ok: false, reason: 'os' }, t: T }),
      (s) => s,
    );
    eq(segs.length, 3);
    ok(/· 朗读：系统语音 ✓$/.test(segs[0].text), segs[0].text);
    eq(segs[0].go, '', 'ok 的槽不带「去配置」');
    eq(segs[1].state, 'unset');
    eq(segs[1].go, 'stt', 'unset 的槽才有「去配置」');
    eq(segs[2].state, 'na');
    eq(segs[2].go, '', '实时转写不可用不是配置问题，没有「去配置」');
    ok(/iOS 26/.test(segs[2].text));
    // 快速档：' · ' 前缀 + 一句话，无名字段、无 go
    const q = D.segments(D.items({ provider: 'deepseek', apiKey: 'k' }, { slots: ['chat'], quick: true, t: T }), (s) => s);
    eq(q[0].text, ' · 由一键配置提供 ✓');
    eq(q[0].go, '');
  });
  test('onGo 未传 ⇒ 连 unset 也没有 go；空表 ⇒ 空数据', () => {
    const D = load();
    const segs = D.segments(D.items({ provider: 'deepseek' }, { slots: ['chat'], t: T }));
    eq(segs[0].go, '');
    deepEq(D.segments(null), []);
    deepEq(D.segments([]), []);
  });
});
