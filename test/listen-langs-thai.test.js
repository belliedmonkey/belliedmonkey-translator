// test/listen-langs-thai.test.js — 「所有选语言的地方都要有泰语」+ DictationTranscriber 回落（2026-10-04）。
//
// 两条来自真机/评审的裁定：
//   · 听译页的语言菜单此前**只列当前引擎支持的**（45 门 ∩ 12 门注册表 = 9 门，与真机截图完全吻合）
//     ⇒ 泰语根本不在列表里。用户裁定：**始终列全**，引擎不支持的灰显 + 一句「当前引擎不支持」，
//     并把出路**就地**给（换引擎），而不是从列表里拿掉。
//   · 根因是只问了 Apple 最窄的那台转写器。`DictationTranscriber` 语言集更宽（本机实测 54 ⊃ 45，含 th-TH）。
//
// 真机上的「选泰语能不能真的转」在 npm test 里造不出来 ⇒ 这里钉的是**使那件事成立的结构**。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MODEL = read('src/app/listen-model.js');
const VIEW = read('src/app/listen-view.jsx');
const SWIFT = read('app/native/speech-bridge.swift');
const LANGS = require(path.join(ROOT, 'build', 'langs.config.js'));

describe('听译页语言列表：始终列全（含 ไทย）', () => {
  test('★ 不再把引擎不支持的语言从列表里 continue 掉', () => {
    const fn = MODEL.slice(MODEL.indexOf('function langOptions'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    ok(!/continue;/.test(body), 'langOptions 里又在跳过不支持的语言 —— 那正是泰语从列表里消失的地方');
    ok(/disabled: bad/.test(body), '没有被挡住的标记（disabled）');
    ok(/listen_lang_engine_unsupported/.test(body), '没有用「当前引擎不支持」那句（用户 2026-10-04 定的措辞）');
  });

  test('注册表里每一门都会出现在选项里（含 th）', () => {
    // 结构判据：langOptions 里不再有基于 allowed 的 continue ⇒ 循环体对每门都 push。
    const fn = MODEL.slice(MODEL.indexOf('function langOptions'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    eq((body.match(/out\.push\(/g) || []).length, 1, 'push 应当只有一处（对每门都执行）');
    ok(/for \(const l of Registry\.langs\(\)\)/.test(body), '循环不是遍历注册表');
    ok(LANGS.some((l) => l.code === 'th'), '注册表里没有 th —— 先看 build/langs.config.js');
  });

  test('两个下拉都渲染 disabled（灰显而不是消失）', () => {
    const opts = (VIEW.match(/disabled=\{o\.disabled\}/g) || []).length;
    eq(opts, 2, '两个语言下拉都应当带 disabled={o.disabled}，实际 ' + opts);
  });

  test('★ 出路就地给：有「换引擎」，且点击走 shell 注入的 openSettings', () => {
    ok(/listen_lang_change_engine/.test(VIEW), 'View 里没有「换引擎」');
    ok(/listenModel\.changeEngine\(\)/.test(VIEW), '按钮没接到 changeEngine()');
    ok(/app-listen-change-engine/.test(VIEW), '按钮缺少稳定 id');
    ok(/setOpenEnginePicker/.test(MODEL) && /function changeEngine/.test(MODEL), '模型没有注入点');
    ok(/AppListen\.wire\(\{ openSettings \}\)/.test(read('src/app/shell-model.js')),
      'shell 没有把 openSettings 注入进来 —— 按钮会点了没反应');
  });
});

describe('本机识别：不只问 SpeechTranscriber', () => {
  test('★ 落回 DictationTranscriber（它含 th-TH）', () => {
    ok(/DictationTranscriber\.supportedLocale/.test(SWIFT), '没有问 DictationTranscriber 的 locale');
    ok(/func mtTranscriberFor/.test(SWIFT), '没有「这台不支持就问那台」的选择函数');
    ok(/DictationTranscriber\(locale:/.test(SWIFT), '没有真的构造过它');
  });

  test('报给 JS 的支持集是**两台之并**（否则列表里的泰语会被判成不支持）', () => {
    ok(/func mtSupportedLocalesUnion/.test(SWIFT), '没有并集函数');
    const i = SWIFT.indexOf('func mtSupportedLocalesUnion');
    const body = SWIFT.slice(i, i + 600);
    ok(/SpeechTranscriber\.supportedLocales/.test(body) && /DictationTranscriber\.supportedLocales/.test(body),
      '并集只问了一台');
    ok(/\.union\(/.test(body), '没有取并集');
  });

  test('识别会话按语言选模块类型，且**一个会话只用一种**（两台的结果类型不同，混排要两套读取）', () => {
    ok(/needDictation/.test(SWIFT), '会话没有判定「要不要整场改用 DictationTranscriber」');
    ok(/deliverDictation/.test(SWIFT), '没有 dictation 的投递分支');
    ok(/var mods: \[any SpeechModule\]/.test(SWIFT), '模块数组没有放宽到 any SpeechModule');
  });
});
