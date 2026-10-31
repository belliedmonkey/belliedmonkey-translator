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
    ok(/if \(ptt\) \{/.test(fn), '没有「已经在收音」这一支');
    ok(/ptt\.side === side\) \{ pttStop\(\); return true; \}/.test(fn), '再点同一个键没有停止收音');
    // 换边先收口 + flush 尾巴（2026-10-10：模型断句路加一条 seg.flushAll(true) —— 旧串句器
    // 的 flushAll 照旧保留，两条路各自把自己的尾巴放出来，不留到相位变了才落行）。
    ok(/pttCut\(\);/.test(fn), '换边没有先收口（cut）');
    ok(/if \(seg\) \{ try \{ seg\.settle\('switch'\); \} catch \(_\) \{\} \}/.test(fn),
      '换边没有调唯一收尾出口 settle(\'switch\')');
    ok(/if \(cutter && cutter\.flushAll\) cutter\.flushAll\(\); \} catch \(_\) \{\}/.test(fn),
      '换边没有立刻 flush 串句器的尾巴（只 cut 不 flush，尾巴会悬着不落行）');
    // 方案 1（单一入口）：开始/换边都走 pttBegin(side)，setPtt(true) 只在 pttBegin 里做。
    ok(/pttBegin\(side\)/.test(fn), '换边/开始没有走统一的收音入口 pttBegin');
    ok(!/ptt = \{ side \};/.test(fn), 'ptt 还在 pttToggle 里散着设 —— 没有单一入口');
    ok(/phase === 'idle' \|\| phase === 'ended'\) start\(\)/.test(fn), 'idle/ended 没有起会话');
    ok(/phase === 'paused' \|\| phase === 'halted'\) resumeByUser\(\)/.test(fn), 'paused/halted 没有续上');
    // 停止/换边**不看相位**：点下去到管道起来之间（准备中）也该能停、能换（第一版只认
    // phase==='listening'，P-02/P-07 因此在「准备中」撞成了「什么都不发生」）。
    ok(!/if \(ptt && phase === 'listening'\)/.test(fn), '停止/换边又被相位挡住了');
    // 顺序不能反：start() 内部会 pttAbort()，先设收音态会被它清掉。
    const tail = fn.slice(fn.indexOf("phase === 'idle'"));
    ok(tail.indexOf('start()') >= 0 && tail.indexOf('start()') < tail.indexOf('pttBegin(side)'),
      '收音态比 start() 先设 —— 会被 pttAbort 清掉');
  });

  test('★ 方案 1：setPtt 只经 pttApplySeg 一处调（pttBegin/pttExit/start 共用）', () => {
    const apply = MODEL.slice(MODEL.indexOf('function pttApplySeg'), MODEL.indexOf('function pttBegin'));
    const begin = MODEL.slice(MODEL.indexOf('function pttBegin'), MODEL.indexOf('function pttExit'));
    const exit = MODEL.slice(MODEL.indexOf('function pttExit'), MODEL.indexOf('function pttAbort'));
    ok(/seg\.setPtt\(!!ptt\)/.test(apply), 'pttApplySeg 没有 seg.setPtt(!!ptt) —— 接线没通');
    ok(/pttApplySeg\(\)/.test(begin) && /pttApplySeg\(\)/.test(exit), '统一入口没有调 pttApplySeg');
    ok(/ptt = \{ side \};/.test(begin) && /pttForceOff\(\)/.test(exit), '统一入口没有管收音态/强制语言');
    // start() 里 seg 新建后也要套一次（pttBegin 早于新 seg 建好）。
    const startFn = MODEL.slice(MODEL.indexOf('async function start()'), MODEL.indexOf('async function start()') + 2200);
    ok(/seg = makeSeg\(gen\);\s*\n\s*pttApplySeg\(\)/.test(startFn), 'start() 新建 seg 后没有套收音态');
    // 全文件里 seg.setPtt 只出现在 pttApplySeg 一处（单一入口，注释不算）。
    const code = MODEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const calls = code.match(/seg\.setPtt\(/g) || [];
    ok(calls.length === 1, 'seg.setPtt 出现 ' + calls.length + ' 次 —— 应恰好 1 次（pttApplySeg）');
  });

  test('★ 方案 1：pause/end 在**关麦前**放行句头闸（wasPtt 必须在 pttAbort 之前记）', () => {
    const pauseFn = MODEL.slice(MODEL.indexOf('function pause(reason)'), MODEL.indexOf('function halt(reason'));
    const wasIdx = pauseFn.indexOf('const wasPtt = !!(ptt || pttStopTimer)');
    const abortIdx = pauseFn.indexOf('pttAbort()');
    const drainIdx = pauseFn.indexOf('if (wasPtt) drainGateHeld()');
    const micIdx = pauseFn.indexOf('micStop()');
    ok(wasIdx >= 0, 'pause 里没有在 pttAbort 之前记下 wasPtt（第七轮那个永假条件）');
    ok(abortIdx >= 0 && wasIdx < abortIdx, 'wasPtt 记在了 pttAbort 之后 —— 必然为假');
    ok(drainIdx >= 0, 'pause 没有放行句头闸');
    ok(micIdx >= 0 && drainIdx < micIdx, 'pause 的放行不在关麦之前');
    const endFn = MODEL.slice(MODEL.indexOf('function end()'), MODEL.indexOf('function end()') + 500);
    ok(/const wasPtt = !!\(ptt \|\| pttStopTimer\)/.test(endFn) && /if \(wasPtt\) drainGateHeld\(\)/.test(endFn),
      'end 没有补上关麦前的放行');
    const stopFn = MODEL.slice(MODEL.indexOf('function pttStop'), MODEL.indexOf('function pttBegin'));
    ok(!/drainGateHeld\(\)/.test(stopFn), 'pttStop 里那次过早的放行应当撤掉（挪到关麦前）');
  });

  test('停止收音先收口（cut）+ 主动 flush 串句器尾巴，再关麦', () => {
    ok(/const PTT_STOP_GRACE_MS = \d+;/.test(MODEL), '没有收尾间隙常量');
    const stop = MODEL.slice(MODEL.indexOf('function pttStop'), MODEL.indexOf('function pttAbort'));
    ok(/pttCut\(\)/.test(stop), '停止收音没有先收口');
    ok(/cutter\.flushAll\(\)/.test(stop), '没有手动 flush 串句器尾巴（尾巴要等 1200ms，450ms 后关麦就丢了）');
    ok(/setTimeout\([\s\S]{0,140}?pause\('user'\)/.test(stop), '收口之后没有关麦（pause）');
  });

  test('收音态与强制语言的唯一出口 pttAbort：pause/halt/end/leave/start 都走它', () => {
    ok(/function pttAbort\(\)/.test(MODEL), '没有 pttAbort');
    const ab = MODEL.slice(MODEL.indexOf('function pttExit'), MODEL.indexOf('function pttAbort'));
    ok(/ptt = null;/.test(ab) && /pttForceOff\(\)/.test(ab), '统一出口 pttExit 没有清收音态与强制语言');
    ok(/pttExit\(\)/.test(MODEL.slice(MODEL.indexOf('function pttAbort'), MODEL.indexOf('function pttView'))), 'pttAbort 没有走 pttExit');
    for (const anchor of ['function start(', 'function pause(', 'function halt(', 'function end(']) {
      const seg = MODEL.slice(MODEL.indexOf(anchor), MODEL.indexOf(anchor) + 400);
      ok(/pttAbort\(\)/.test(seg), anchor + ' 没有走 pttAbort（会漏清收音态）');
    }
  });

  test('强制语言的看门狗：收音结束时才清（守住 P-03 连红五轮那个 bug）', () => {
    ok(/if \(pttForce && !ptt && Date\.now\(\) - pttForce\.at >= 3000\) (?:\{ pttSpanClose\(\); )?pttForce = null;/.test(MODEL),
      '看门狗没有守住「收音还没结束就不清强制语言」');
  });

  test('收音期间**不冻**朗读队列（2026-10-09 用户裁定 A：撤 vbD0C，靠回声闸）', () => {
    ok(!/pttSpeakPaused|pttSpeakPause|pttSpeakResume/.test(MODEL), '冻队列那一套应当撤掉');
    ok(!/if \(pttSpeakPaused\) break;/.test(MODEL), '朗读泵不该再被收音冻住（冻住 = 自动朗读永不发声）');
    ok(/echo\.playingLangs|echo\.isEcho/.test(MODEL), '回声闸还在 —— 这是 A 案唯一的保护');
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

  test('断线重连 / 来电自动续听要回到「收音中」（麦开了就得有收音侧）', () => {
    const halt = MODEL.slice(MODEL.indexOf('function halt('), MODEL.indexOf('function halt(') + 600);
    ok(/reason === 'socket-retry' \|\| reason === 'locked'\) && ptt\) resumeSide = ptt\.side/.test(halt),
      'halt 没有为可续停机留下收音侧');
    const res = MODEL.slice(MODEL.indexOf('async function resume()'), MODEL.indexOf('function resumeByUser'));
    ok(/resumeSide && phase === 'listening'/.test(res) && /pttBegin\(s\)/.test(res),
      'resume 没有把「收音中」恢复回来');
    ok(/resumeSide = '';/.test(MODEL), 'resumeSide 用了不清（会把下一次续听也带偏）');
  });

  test('还在收音就不撤强制语言（撤了下一句没判据 ⇒ 整句丢）（真机 #578）', () => {
    ok(/if \(pttRow && !ptt\) pttForceOff\(\);/.test(MODEL),
      '落行时无条件撤强制语言 —— 收音中（一整段）会让后续每一句都被归属闸丢掉');
  });

  test('停止收音时音频会话 / 锁屏卡一起收；续听再开回来（真机 #578）', () => {
    ok(/function nativeSessionOff\(\)/.test(MODEL) && /NativeAudio\.sessionStop\(\)/.test(MODEL), '没有会话收尾出口');
    ok(/function nativeSessionOn\(\)/.test(MODEL) && /NativeAudio\.sessionStart\(\)/.test(MODEL), '没有会话开启出口');
    const pauseFn = MODEL.slice(MODEL.indexOf('function pause(reason)'), MODEL.indexOf('function pause(reason)') + 1200);
    ok(/nativeSessionOff\(\)/.test(pauseFn), 'pause 没有收会话 —— 员工停止对话后锁屏卡会一直挂着');
    const haltFn = MODEL.slice(MODEL.indexOf('function halt(reason'), MODEL.indexOf('function halt(reason') + 1400);
    ok(/nativeSessionOff\(\)/.test(haltFn), 'halt 没有收会话');
    const resFn = MODEL.slice(MODEL.indexOf('async function resume()'), MODEL.indexOf('async function resume()') + 700);
    ok(/nativeSessionOn\(\)/.test(resFn), 'resume 没有把会话开回来（续听会没有音频会话）');
  });

  test('文案与布局：左「说+本名」、两键小字都跟界面语言、无 pttHint、无小结卡/结束/已听/披露', () => {
    ok(/t\('listen_ptt_say', '说\{lang\}'\)/.test(MODEL), '左键不是「说 + 本名」');
    ok(/t\('listen_ptt_tap_start', '点一下开始'\)/.test(MODEL), '未收音小字不是新键 listen_ptt_tap_start');
    ok(/t\('listen_ptt_recording', '● 正在录 · 点一下停'\)/.test(MODEL), '收音中小字不是 listen_ptt_recording');
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
