// test/app-ptt.test.js — 录音两键的规则（改稿 D，2026-10-09；P 组的 node 侧）。
//
// 真机上的行为由 `__mtTest.ptt`（H3）驱动真按钮验；这里守的是**规则本身**：
// 只有「点一下」（点一下开收音、再点同键停）、点另一个键先收口再换边、没有按住 / 没有锁定 /
// 没有静音自动停、收音＝开麦、进页面不开麦、开始收音停朗读（vbD0C）、两键小字都跟界面语言。
// 这些一旦被改回去，界面测试未必看得见。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const MODEL = read('src/app/listen-model.js');
const VIEW = read('src/app/listen-view.jsx');
const HOOK = read('app/test-harness.js');

describe('录音两键 · 规则（改稿 D · 点一下开 / 停）', () => {
  test('只有「点一下」：没有 0.4s 分界、没有锁定态、没有静音自动停', () => {
    ok(/function pttToggle\(side\)/.test(MODEL), '没有 pttToggle（点一下）');
    ok(!/PTT_TAP_MS/.test(MODEL), '0.4 秒分界应当退役（改稿 D 取消按住）');
    ok(!/pttArmSilence|pttSilence\(|pttFinish|pttUp\b|pttDown\b|pttTap\b/.test(MODEL),
      '按住 / 锁定 / 静音自动结束那一套应当退役');
    ok(!/mode: 'locked'|mode: 'hold'/.test(MODEL), '还在造 hold/locked 态');
    ok(!/listen_ptt_locked|listen_ptt_heard_nothing/.test(MODEL), '锁定提示 / 「没听到声音」应当退役');
  });

  test('点一下 = 开收音（idle/ended 起会话；paused/halted 续）；再点同键 = 停', () => {
    const fn = MODEL.slice(MODEL.indexOf('function pttToggle'), MODEL.indexOf('function pttStop'));
    ok(/if \(ptt && phase === 'listening'\)/.test(fn), '没有「正在收音」这一支');
    ok(/ptt\.side === side\) \{ pttStop\(\); return true; \}/.test(fn), '再点同一个键没有停止收音');
    ok(/pttCut\(\);/.test(fn) && /ptt = \{ side \};/.test(fn), '点另一个键没有「先收口再换边」');
    ok(/phase === 'idle' \|\| phase === 'ended'\) start\(\)/.test(fn), 'idle/ended 没有起会话');
    ok(/phase === 'paused' \|\| phase === 'halted'\) resumeByUser\(\)/.test(fn), 'paused/halted 没有续上');
    // 顺序不能反：start() 内部会 pttAbort()，先设收音态会被它清掉。
    const tail = fn.slice(fn.indexOf("phase === 'idle'"));
    ok(tail.indexOf('start()') >= 0 && tail.indexOf('start()') < tail.indexOf('ptt = { side }'),
      '收音态比 start() 先设 —— 会被 pttAbort 清掉');
  });

  test('停止收音先收口（cut）再关麦：给定稿留一点时间，别把刚说的半句丢掉', () => {
    ok(/const PTT_STOP_GRACE_MS = \d+;/.test(MODEL), '没有收尾间隙常量');
    const stop = MODEL.slice(MODEL.indexOf('function pttStop'), MODEL.indexOf('function pttAbort'));
    ok(/pttCut\(\)/.test(stop), '停止收音没有先收口');
    ok(/setTimeout\([\s\S]{0,120}?pause\('user'\)/.test(stop), '收口之后没有关麦（pause）');
  });

  test('收音态与强制语言的唯一出口 pttAbort：pause/halt/end/leave/start 都走它', () => {
    ok(/function pttAbort\(\)/.test(MODEL), '没有 pttAbort');
    const ab = MODEL.slice(MODEL.indexOf('function pttAbort'), MODEL.indexOf('function pttView'));
    ok(/ptt = null;/.test(ab) && /pttForceOff\(\)/.test(ab), 'pttAbort 没有清收音态与强制语言');
    ok(/pttSpeakResume\(\)/.test(ab), 'pttAbort 没有接着播队列');
    for (const anchor of ['function start(', 'function pause(', 'function halt(', 'function end(']) {
      const seg = MODEL.slice(MODEL.indexOf(anchor), MODEL.indexOf(anchor) + 400);
      ok(/pttAbort\(\)/.test(seg), anchor + ' 没有走 pttAbort（会漏清收音态）');
    }
  });

  test('强制语言的看门狗：收音结束时才清（守住 P-03 连红五轮那个 bug）', () => {
    ok(/if \(pttForce && !ptt && Date\.now\(\) - pttForce\.at >= 3000\) pttForce = null;/.test(MODEL),
      '看门狗没有守住「收音还没结束就不清强制语言」');
  });

  test('开始收音停朗读 + 冻队列；停止收音接着播（vbD0C，改挂到点一下上）', () => {
    ok(/let pttSpeakPaused = false;/.test(MODEL), '没有「朗读队列暂停」的状态位');
    const fn = MODEL.slice(MODEL.indexOf('function pttToggle'), MODEL.indexOf('function pttStop'));
    ok(/pttSpeakPause\(\);/.test(fn), '开始收音没有停朗读 / 冻队列');
    ok(/pttSpeakResume\(\)/.test(MODEL.slice(MODEL.indexOf('function pttAbort'), MODEL.indexOf('function pttView'))),
      '停止收音没有解冻（队列会一直冻着）');
    ok(!/sq\.clear\(\)/.test(MODEL.slice(MODEL.indexOf('function pttSpeakPause'), MODEL.indexOf('function pttSpeakPause') + 400)),
      '把队列清空了 —— 停止收音要按原顺序接着播，不能丢句');
    ok(/if \(pttSpeakPaused\) break;/.test(MODEL), '朗读泵没有在冻住时停下');
    ok(/if \(!speakPumping && sq\.size\(\)\) speakPump\(\)/.test(
      MODEL.slice(MODEL.indexOf('function pttSpeakResume'), MODEL.indexOf('function pttSpeakResume') + 500)),
      '泵已经退出时没有重新起 —— 队列会卡住');
  });

  test('进页面不开麦：open 的对话分支不再 start()', () => {
    const open = MODEL.slice(MODEL.indexOf('function open(m)'), MODEL.indexOf('function paintMode'));
    ok(!/^\s*start\(\);\s*$/m.test(open), '对话分支还在自动 start()（会一进页面就开麦）');
    ok(/readCfg\(\)\.then/.test(open), '对话分支没有只读配置');
    ok(/sub,/.test(VIEW) || /mv\.sub/.test(VIEW), '视图拿不到 sub 标志（大按钮要按模式藏）');
    ok(/hidden=\{tv\.ended \|\| !mv\.sub\}/.test(VIEW), '「正在听·暂停」大按钮没有只留给字幕');
  });

  test('30 秒静音自动暂停只剩实时字幕（对话页「一直录到你点停」）', () => {
    ok(/session\.mode === 'subtitle' && C\.silenceCheck\(session, C\.rmsOf\(int16\), now\(\)\)/.test(MODEL),
      '对话页的静音门没有被撤掉');
    ok(/session\.mode === 'subtitle' && C\.silenceCheck\(session, rms, now\(\)\)/.test(MODEL),
      '本机路（onLevel）的静音门没有被撤掉');
  });

  test('文案与布局：左「说+本名」、两键小字都跟界面语言、无 pttHint、无小结卡/结束/已听/披露', () => {
    ok(/t\('listen_ptt_say', '说\{lang\}'\)/.test(MODEL), '左键不是「说 + 本名」');
    ok(/t\('listen_ptt_tap_start', '点一下开始'\)/.test(MODEL), '未收音小字不是新键 listen_ptt_tap_start');
    ok(/t\('listen_ptt_recording', '● 正在录 · 点一下结束'\)/.test(MODEL), '收音中小字不是 listen_ptt_recording');
    ok(!/pttHintOf|\.pttHint\b/.test(MODEL), '不再读那门语言写的 pttHint');
    ok(/pv\.mineHint/.test(VIEW) && /app-listen-ptt-mine-hint/.test(VIEW), '视图没有渲染左键小字');
    ok(!/app-listen-ptt-locked/.test(VIEW), '锁定提示那一行应当退役');
    ok(!/id="app-listen-end"/.test(VIEW), '「结束」按钮应当退役');
    ok(!/id="app-listen-summary"/.test(VIEW), '小结卡应当退役');
    ok(!/id="app-listen-cost"/.test(VIEW), '已听那一行应当退役');
    ok(!/app-listen-device-privacy/.test(VIEW) && !/app-subs-privacy/.test(VIEW), '两段披露应当从听译页撤走');
  });

  test('两段披露搬进「设置 › 听译」，文字一字不改', () => {
    const sv = read('src/app/settings-view.jsx');
    ok(/id="set-listen-privacy"/.test(sv) && /listen_device_privacy/.test(sv), '设置页没有对话段的披露');
    ok(/id="set-subs-privacy"/.test(sv) && /subtitle_privacy/.test(sv), '设置页没有字幕段的披露（Gate I）');
  });

  test('实时字幕没有录音键（单向译成）', () => {
    ok(/if \(mode === 'subtitle'\) return false;\s*\/\/ 字幕是单向的/.test(MODEL), '字幕模式没有挡住录音键');
    ok(/shown: !sub,/.test(MODEL), '按钮条没有在字幕模式隐藏');
  });

  test('H3 钩子：驱动的是真按钮上的真点击', () => {
    ok(/ptt: \{/.test(HOOK) && /dispatchEvent\(new MouseEvent\('click'/.test(HOOK), '没有 ptt 的点击驱动');
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
