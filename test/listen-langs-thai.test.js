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

  test('设置页的语言下拉同规则：全量 + disabled，不再 continue 掉（2026-10-06 由 S1 门禁抓出）', () => {
    // 设置页原来的 fillLangs 自己按 sttSupportedBases `continue` ⇒ 只列 9 门，与听译页（12 门）
    // 不一致 —— 正是裁定要消灭的那种「只在部分入口有」。现在两处共用 AppListen.langOptions。
    const SV = read('src/app/settings-view.jsx');
    const i = SV.indexOf('function fillLangs');
    ok(i > 0, '没找到 settings-view 的 fillLangs');
    const body = SV.slice(i, SV.indexOf('\n  }', i));
    ok(!/continue;/.test(body), '设置页 fillLangs 又在跳过不支持的语言 —— 那是唯一漏网的一处');
    ok(/AppListen\.langOptions\(/.test(body), '设置页没有用同一份 AppListen.langOptions（会与听译页/首启屏不一致）');
    ok(/\.disabled = !!o\.disabled/.test(body), '设置页没有把不支持的语言标成 disabled');
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

  test('★ 选窄的那台前必须核对支持清单 —— iOS 26.x 会为不支持的语言也归一化出 locale', () => {
    // 2026-10-04 真机：iOS 26.x 上 `SpeechTranscriber.supportedLocale(equivalentTo: "th")` 返回
    // `th-TH`（其实不含泰语），27.0 才改成回 nil。只信它会把泰/俄/阿错分给窄的那台，那台的资产
    // 状态是 unsupported ⇒ 探针回 unsupported/locale ⇒ 首页两个入口一起灰。
    const body = SWIFT.replace(/\/\/.*$/gm, '');
    const i = body.indexOf('func mtTranscriberFor');
    ok(i > 0, '没有 mtTranscriberFor');
    const fn = body.slice(i, body.indexOf('\n}', i));
    ok(/supportedLocales/.test(fn),
      'mtTranscriberFor 选 speech 前没有核对 SpeechTranscriber.supportedLocales');
    ok(/contains\(where:/.test(fn), '没有用「在清单里」这条判据');
    ok(fn.indexOf('supportedLocales') < fn.indexOf('.speech'),
      '核对必须在「返回 .speech」之前 —— 否则仍旧只信 supportedLocale()');
  });

  test('★ 名单说支持 ≠ 资产说可用：两台都按资产状态问，先可用者胜（#563 追踪，15 Pro/26.6.2）', () => {
    // 2026-10-04 晚，浮层数据（speechN=30 dictN=54，th dictation installed）：80 失败、82 好转
    // 之间没有代码差异 ⇒ 名单之外还有一层 —— 未就绪（未下载/元数据未同步）的模块会被
    // AssetInventory 报 .unsupported，只看名单会把「没下载好」误判成「语言不支持」，包屏随即
    // 藏掉「识别语言包」行、永远不去下它（死循环）。选择必须两台都问资产状态。
    const body = SWIFT.replace(/\/\/.*$/gm, '');
    const i = body.indexOf('func mtTranscriberFor');
    const fn = body.slice(i, body.indexOf('\n}', i));
    ok(/mtModuleUsable/.test(fn) && /AssetInventory\.status/.test(body),
      'mtTranscriberFor 没有按 AssetInventory.status 判「这台能不能用」—— 名单之外还得看资产（#563）');
    ok((fn.match(/mtModuleUsable\(/g) || []).length >= 2,
      '窄/宽两台都要按资产状态问一遍 —— 只问一台仍会把「没下载好」判成「不支持」');
    ok(/mtDictationLocale/.test(fn), '窄的那台不行时没有回落到宽的那台');
  });

  test('报给 JS 的支持集是**两台之并**（否则列表里的泰语会被判成不支持）', () => {
    ok(/func mtSupportedLocalesUnion/.test(SWIFT), '没有并集函数');
    const i = SWIFT.indexOf('func mtSupportedLocalesUnion');
    const body = SWIFT.slice(i, i + 600);
    ok(/SpeechTranscriber\.supportedLocales/.test(body) && /DictationTranscriber\.supportedLocales/.test(body),
      '并集只问了一台');
    ok(/\.union\(/.test(body), '没有取并集');
  });

  test('识别会话**每种语言各按自己的引擎定**（不再整场降级），两种模块混装在一个 analyzer 里', () => {
    // 2026-10-06（#570 / §9.6.1.2）：旧规则「任一门需要 Dictation 就整场换」会把 zh 从更准的
    // SpeechTranscriber 拖走、丢掉置信度，泰语路的假字于是没有任何仲裁依据。改为每门语言各自选，
    // Speech 那一路拿回置信度，交给 JS 的 makeFinalArbiter。
    const body = SWIFT.replace(/\/\/.*$/gm, '');
    ok(!/needDictation/.test(body), '不该再有整场降级的 needDictation');
    // 2026-10-07（§9.6.1.4）：建模块抽成 `makeModule`（会话中途换语言 `setLangs` 也要用它），
    // 「每门语言各选引擎」这条判据跟着搬到那里。
    const cls = body.indexOf('final class MTDeviceTranscriber');
    const mk = body.indexOf('private func makeModule', cls);
    ok(mk > cls, '没有 makeModule（每门语言各选引擎 + 会话中途换语言共用）');
    const fn = body.slice(mk, body.indexOf('private func module(', mk));
    ok(/mtTranscriberFor\(/.test(fn), 'makeModule 里没有按语言选引擎');
    ok(/case \.speech:/.test(fn) && /case \.dictation:/.test(fn), '两种引擎没有各自分支');
    // locale 与引擎必须成对带出（混装后下标不再等于 locales 的下标）：
    // 现在这一对放在 `mounted: [(String, Mod)]`（换语言时还要复用/停掉某一路），reader 按 locale 存。
    ok(/return \(id, \.speech\(t\)\)/.test(fn) && /return \(id, \.dictation\(t\)\)/.test(fn),
      'makeModule 没有把 (locale, 引擎) 成对返回');
    const cls2 = body.slice(cls);
    ok(/private var readers: \[String: Task/.test(cls2), 'reader 应当按 locale 存');
    ok(/deliver\(/.test(SWIFT) && /deliverDictation\(/.test(SWIFT), '两种投递分支都要在');
    ok(/var mods: \[any SpeechModule\]/.test(SWIFT), '模块数组没有放宽到 any SpeechModule');
  });
});
