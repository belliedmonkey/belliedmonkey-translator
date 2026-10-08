// test/app-ptt.test.js — 按住说 / 点一下的状态机规则（第三十批 P 组的 node 侧）。
//
// 真机上的行为由 `__mtTest.ptt`（H3）驱动真按钮验；这里守的是**规则本身**：
// 0.4 s 分界、锁定、8 s 静默自动结束、按住时暂停判定、按住说的行出生即 pinned、
// 两指以先按下的为准、暂停/结束以点为准。这些一旦被改回去，界面测试未必看得见。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const MODEL = read('src/app/listen-model.js');
const VIEW = read('src/app/listen-view.jsx');
const HOOK = read('app/test-harness.js');

describe('按住说 / 点一下 · 规则（Pencil 终稿 3）', () => {
  test('0.4 秒分界：不足是「点一下」（锁定），够是「按住说」（定稿）', () => {
    ok(/const PTT_TAP_MS = 400;/.test(MODEL), '没有 0.4 s 分界常量');
    ok(/if \(now\(\) - ptt\.at < PTT_TAP_MS\) \{ ptt\.mode = 'locked'; pttArmSilence\(\); \}/.test(MODEL),
      '松手不足 0.4 s 没有进锁定');
    ok(/else pttFinish\(\);/.test(MODEL), '松手够 0.4 s 没有定稿');
  });

  test('锁定：再点同一个键结束；点另一个键先定稿再锁到那一门', () => {
    ok(/pttFinish\(\{ relock: side \}\); return true;/.test(MODEL),
      '锁定时点另一个键没有「先定稿再切」');
    // 看门狗：按住/锁定没结束前不许清强制语言（P-03 连红五轮的根因）。
    ok(/if \(pttForce && !ptt && Date\.now\(\) - pttForce\.at >= 3000\) pttForce = null;/.test(MODEL),
      '强制语言的看门狗没排除「按住/锁定还在进行」的情况');
    ok(/if \(relock\) \{/.test(MODEL) && /mode: 'locked', side: relock/.test(MODEL), '没有锁到那一门');
  });

  test('强制语言的看门狗只在「按住/锁定已经结束」时清（守住 P-03 连红五轮那个 bug）', () => {
    const at = MODEL.indexOf('function pttForceOn');
    const wd = MODEL.slice(at, at + 800);
    ok(/if \(pttForce && !ptt && Date\.now\(\) - pttForce\.at >= 3000\) pttForce = null;/.test(wd),
      '看门狗没有排除「按住/锁定还在进行」—— 锁定能到 8 秒，中途清掉强制语言会让这一句整句被丢');
    // 结束的三条出路都要能清掉它（否则下一句会被上一句的语言钉住）
    const fin = MODEL.slice(MODEL.indexOf('function pttFinish('), MODEL.indexOf('function pttFinish(') + 1200);
    ok(/pttForceOff\(\)/.test(fin), 'pttFinish 没有清强制语言');
    ok(/function pttAbort\([\s\S]{0,500}?pttForceOff\(\)/.test(MODEL), 'pttAbort（暂停/结束/具名停止）没有清强制语言');
    // 逐场景求值（照抄那行条件的语义；三个场景就是回归里踩到的那三个）
    const clears = (hasForce, pttActive, ageMs) => hasForce && !pttActive && ageMs >= 3000;
    ok(!clears(true, true, 5000), '锁定 5 秒时不该清（8 秒静默上限以内）');
    ok(!clears(true, true, 3200), '按住超过 3.2 秒时不该清');
    ok(clears(true, false, 3200), '松手 / 结束锁定 3.2 秒后该清（否则下一句被钉住）');
    ok(!clears(true, false, 1000), '刚松手 1 秒内不该清（收口那一片还在飞）');
  });

  test('8 秒静默自动结束；有半句定稿、没半句只提示', () => {
    ok(/pttSilenceMs: Number\(s\.pttSilenceMs\) > 0 \? Number\(s\.pttSilenceMs\) : 8000/.test(MODEL),
      'pttSilenceMs 默认不是 8000（或没读开发键）');
    ok(/if \(!ptt\.heard\) pttNoteSet\(t\('listen_ptt_heard_nothing'/.test(MODEL), '没半句时没有「没听到声音」的提示');
    ok(/pttFinish\(\{ quiet: !ptt\.heard \}\)/.test(MODEL), '自动结束时没有按「有没有半句」分开处理');
    ok(/pttArmSilence/.test(MODEL) && /setTimeout\(/.test(MODEL), '没有静默计时器');
  });

  test('按住/锁定期间暂停语种判定，结束恢复', () => {
    ok(/if \(pttForce\) return pttLangOf\(pttForce\.side\) \|\| '';/.test(MODEL),
      'lidPair() 没有在按住期间强制那门语言（归属会被判词推翻）');
    ok(/NativeSpeech\.lidPause\(true\)/.test(MODEL) && /NativeSpeech\.lidPause\(false\)/.test(MODEL),
      '没有暂停/恢复原生判定');
    ok(/pttForce!*= null;|pttForce = null;/.test(MODEL), '没有关掉强制语言');
  });

  test('按住说的行出生即 pinned；视图不给 ↔', () => {
    ok(/pinned: !!\(deps && deps\.pinned\)/.test(read('app/listen-core.js')), 'addFinal 不支持 pinned');
    ok(/pttRow \? \{ pinned: true \} : \{\}/.test(MODEL), '按住说的行没有带 pinned 进 addFinal');
    ok(/\{!hv\.sub && !r\.pinned && \(/.test(VIEW), '视图仍然给 pinned 的行画 ↔');
    ok(/pinned: !!r\.pinned,/.test(MODEL), '行数据里没有 pinned');
  });

  test('暂停 / 结束 / 具名停止：这一句丢掉，不落行', () => {
    ok(/function pause\(reason\) \{\s*pttAbort\(\);/.test(MODEL), '暂停没有先丢掉按住这一句');
    ok(/function end\(\) \{\s*pttAbort\(\);/.test(MODEL), '结束没有先丢掉按住这一句');
    ok(/function halt\(reason, why\) \{\s*pttAbort\(\);/.test(MODEL), '具名停止没有清掉按住态');
  });

  test('锁定态下的点击在 down 上处理：同键结束、异键先定稿再切', () => {
    // 第一版漏在这里：锁定后点同键什么都发生不了（等 up 才处理，而点一下没有「按住」那一段）。
    // P-03 / P-06 两条 Mac 用例同时抓到。
    ok(/if \(ptt\.mode === 'locked'\) \{\s*if \(ptt\.side === side\) \{ pttFinish\(\); return true; \}/.test(MODEL),
      '锁定后点同一个键没有「结束并定稿」');
    ok(/pttFinish\(\{ relock: side \}\); return true;/.test(MODEL), '锁定后点另一个键没有「先定稿再锁到那一门」');
  });

  test('两指：以先按下的为准，后按的那个忽略（只对「按住中」）', () => {
    ok(/按住中再按另一个键（两指）[\s\S]{0,80}?return false;/.test(MODEL), '按住中第二指没有忽略');
    ok(/onPointerDown/.test(VIEW) && /app-listen-ptt-mine/.test(VIEW) && /app-listen-ptt-other/.test(VIEW),
      '两个键没有各自的指针入口');
  });

  test('文案与布局：左「说+本名」、右本名+那门语言的小字、锁定提示、「正在听」+本名', () => {
    ok(/t\('listen_ptt_say', '说\{lang\}'\)/.test(MODEL), '左键不是「说 + 本名」');
    ok(/mineHint: t\('listen_ptt_tap_hold', '点一下或按住说话'\)/.test(MODEL),
      '左键小字不是新键 listen_ptt_tap_hold（C 案：跟界面语言翻）');
    ok(/pv\.mineHint/.test(VIEW) && /app-listen-ptt-mine-hint/.test(VIEW), '视图没有渲染左键小字');
    ok(/function pttHintOf\(code\)/.test(MODEL) && /e\.pttHint/.test(MODEL), '右键小字没有读语言注册表');
    ok(/t\('listen_ptt_locked', '● \{lang\} 正在说 · 再点一下结束'\)/.test(MODEL), '锁定提示不是稿里的那句');
    ok(/t\('listen_listening_lang', '正在听\{lang\}…'\)/.test(MODEL), '「正在听」+本名没实现');
    ok(/CJK_RE/.test(MODEL), '没有「非中日韩文字加空格」的规则');
    ok(/id="app-listen-ptt-bar"/.test(VIEW) && /listen-ptt-wrap/.test(VIEW), '视图里没有那条按钮条');
    ok(/t\('listen_ptt_need_start', '点「开始听」后可用'\)/.test(MODEL), '灰掉的原因不是那句');
  });

  test('按下时停掉正在播的朗读 + 冻住队列；松手 / 退出锁定后接着播（2026-10-08 评审定）', () => {
    ok(/let pttSpeakPaused = false;/.test(MODEL), '没有「朗读队列暂停」的状态位');
    // 按下就暂停（并在这一场第一次按下时调；relock 那一支不恢复 ⇒ 仍冻着）
    const down = MODEL.slice(MODEL.indexOf('function pttDown'), MODEL.indexOf('function pttFinish'));
    ok(/pttSpeakPause\(\);/.test(down), '按下时没有停朗读 / 冻队列');
    const pauseFn = MODEL.slice(MODEL.indexOf('function pttSpeakPause'), MODEL.indexOf('function pttSpeakPause') + 500);
    ok(/LearnTTS\.stop\(\)/.test(pauseFn), '没有停掉正在播的那一句');
    ok(!/sq\.clear\(\)/.test(pauseFn), '把队列清空了 —— 松手要按原顺序接着播，不能丢句');
    // 松手 / 退出锁定 ⇒ 恢复；relock 那支不恢复
    const fin = MODEL.slice(MODEL.indexOf('function pttFinish'), MODEL.indexOf('function pttFinish') + 1400);
    ok(/pttSpeakResume\(\);/.test(fin), '松手 / 退出锁定后没有接着播');
    ok(/if \(relock\) \{[\s\S]{0,220}?pttArmSilence\(\);/.test(fin), 'relock 那一支的形状变了（它应当仍然冻着队列）');
    const abortFn = MODEL.slice(MODEL.indexOf('function pttAbort'), MODEL.indexOf('function pttAbort') + 600);
    ok(/pttSpeakResume\(\);/.test(abortFn), '被暂停/结束点掉后没有解冻（队列会一直冻着）');
    // 泵：冻住时不取新句
    ok(/if \(pttSpeakPaused\) break;/.test(MODEL), '朗读泵没有在冻住时停下 —— 后面几句还会接着念');
    // 恢复时要能重新起泵（泵已经退出时）
    const resFn = MODEL.slice(MODEL.indexOf('function pttSpeakResume'), MODEL.indexOf('function pttSpeakResume') + 500);
    ok(/if \(!speakPumping && sq\.size\(\)\) speakPump\(\)/.test(resFn), '泵已经退出时没有重新起 —— 队列会卡住');
  });

  test('实时字幕没有按住说（单向译成）', () => {
    ok(/if \(mode === 'subtitle'\) return false;\s*\/\/ 字幕是单向的/.test(MODEL), '字幕模式没有挡住按住说');
    // 2026-10-08 改稿后：字幕模式隐藏 **且** 会话结束后由小结卡接管（两处都不出现）
    ok(/shown: !sub && !\(session && phase === 'ended'\)/.test(MODEL), '按钮条没有在字幕模式/结束后隐藏');
  });

  test('H3 钩子：驱动的是真按钮上的真指针事件', () => {
    ok(/ptt: \{/.test(HOOK) && /dispatchEvent\(new Ctor\(type/.test(HOOK), '没有 ptt 驱动');
    ok(/app-listen-ptt-other/.test(HOOK), '驱动没有落在真按钮上');
    ok(/lidPaused: !!\(d && d\.lidPaused\)/.test(HOOK), 'ptt.state() 不报 lidPaused');
    ok(/translateCalls\(\)/.test(HOOK) && /translateCalls\+\+/.test(MODEL), '没有翻译请求计数');
  });

  test('H1 钩子：显式 LID 注入 + 注入文本时可静音判词', () => {
    ok(/lid\(lang, opts\) \{ return emitLid\(lang, opts && opts\.llr, true\); \}/.test(HOOK), '没有 __mtTest.lid(lang,{llr})');
    ok(/lidMute\(on\)/.test(HOOK) && /if \(!lidMute\) emitLid\(loc\);/.test(HOOK), '没有 lidMute');
    ok(/lidPaused\(\)/.test(HOOK), '没有只读的 lidPaused()');
  });
});
