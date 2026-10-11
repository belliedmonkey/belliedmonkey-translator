// test/listen-ptt-e2e.test.js — 第八/九轮：从**按钮**一路走到上屏（方案 1 / 第九轮 D 节）。
//
// 不是 core 函数的单元测试：这里加载真的 src/app/listen-model.js（esbuild 打包后跑在 vm 里），
// 用**可注入的假时钟**驱动（不真实 sleep —— 真实 sleep 会造成偶发失败，第九轮 D 节明确要求）：
// 点 pttToggle("other") → 造一条原生 final → 过闸 → 进账本 → 模型断句出行 → 行出现在会话里。
//
// 第九轮 D 节的三条端到端：
//   ① 低置信 final 被句头闸扣住（还没出行）→ 点停 ⇒ 1.5s 内放行，why=forced（不是 idle）；
//   ② 高置信对照：不扣住（无 gate:hold），直接进账本出行；
//   ③ idle 对照：扣住后不点停 ⇒ 1.5s 到期放行，why=idle（与 forced 区分开）。
// 变异检查见本文件末尾：把 drainGateHeld 换成空操作 ⇒ ① 必须红。
const { test, ok, eq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟（注入 vm：Date.now / setTimeout / clearTimeout）──────────────────────
// 每个 clock 一个**独立的时间原点**：同一进程里跑多场会话时，后一场的假时钟回到过去会让
// 「本拍已有的计时器」永远算在未来（runTo 只会前进），整场调度静默停摆 —— 第九轮踩过一次。
let CLK_BASE = 1_700_000_000_000;
function fakeClock() {
  let t = (CLK_BASE += 1_000_000_000), seq = 1;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (Number(ms) || 0) }); return id; },
    clearT: (id) => { timers.delete(id); },
    // 把计时器推到目标时刻（不执行它们），用于「先注入事件、再让空闲到期」
    async runTo(ms) {
      const end = t + ms;
      for (;;) {
        let n = null;
        for (const [id, x] of timers) if (x.at <= end && (!n || x.at < n.x.at)) n = { id, x };
        if (!n) break;
        timers.delete(n.id);
        t = Math.max(t, n.x.at);
        n.x.fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

function mkEl() {
  return { hidden: false, disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; }, getAttribute() { return ''; } };
}

function makeSandbox(opts) {
  const o = opts || {};
  const captured = { h: null, onEvent: null, lid: null };
  const clk = fakeClock();
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    ensureAssets: async () => ({ ok: true }),
    ensureLid: async () => ({ ok: true }),
    ensureVad: async () => ({ ok: true }),
    lidPause: () => {}, diagAudio: () => {},
    onLid: (fn) => { captured.lid = fn; return () => {}; },
    sttOpen: (x) => { captured.onEvent = x.onEvent; return { sendPcm: () => true, close() {}, cut() {} }; },
  };
  const NativeAudio = {
    available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok' }),
    micStart: (rate, h) => { captured.h = h; return true; }, micStop: () => {}, recordMode: () => {},
    sessionStart: () => {}, sessionStop: () => {}, onEvent: () => {}, onTick: () => {},
    playingState: () => {}, nowPlaying: () => {},
    subtitleShow: () => {}, subtitleState: () => {}, subtitleConfig: () => {}, subtitleHide: () => {}, subtitleFloat: () => {},
  };
  const tr = { provider: 'deepseek', apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };
  const gateReasons = [];   // 句头闸每次裁决的 why（forced / idle / cjk-overlap / no-ts / …）
  const wrapGate = (deps) => C.makeFinalGate(Object.assign({}, deps, {
    onDiag: (k, t, w) => { if (k === 'gate:release' || k === 'gate:drop') gateReasons.push(w); if (deps && deps.onDiag) deps.onDiag(k, t, w); },
  }));
  // 变异：把闸的 flushAll 换成空操作 —— 模拟「关麦前不放行扣住的片」（drainGateHeld 断了）。
  const Core = o.mutateDrain ? Object.assign({}, C, {
    makeFinalGate: (deps) => { const g = wrapGate(deps); g.flushAll = () => {}; g.flushHeld = () => {}; return g; },
  }) : Object.assign({}, C, { makeFinalGate: wrapGate });
  const sb = {
    window: { addEventListener() {}, removeEventListener() {}, AudioContext: function () {}, webkitAudioContext: function () {} },
    document: { getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(), hidden: false },
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: {
      get: (k, cb) => cb({ listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false }),
      set: (o2, cb) => { if (cb) cb(); },
    }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: Core, NativeAudio, NativeSpeech,
    DiagLog: { push: () => {} },
    MTTelemetry: { track: () => {}, once: () => {} }, MTFeedback: {},
    LearnNotes: { resolveConfig: () => tr, shouldCapture: () => false, langAllowed: () => true },
    LearnRules: { dominantScript: (t) => (/[\u4e00-\u9fff]/.test(String(t || '')) ? 'Han' : 'Latin') },
    LearnDialog: { confirm: async () => true },
    TranslationAPI: {
      resolveProvider: () => 'deepseek',
      // 断句模型：按 prompt 里的 buffer 回一段（source 必须≈buffer，否则解析器的漂移门会拒）。
      listenPass: async (p) => {
        const b = String((p && p.user) || '').split('待处理文本：').pop().split('\n\n是否强制收尾')[0].trim();
        if (o.replies && o.replies.length) {
          const r0 = o.replies.shift();
          if (typeof r0 === 'function') return r0(b);
          return r0;
        }
        return JSON.stringify({ segments: [{ source: b, translation: '好的' }], remainder: '' });
      },
      translate: async () => '译文',
    },
    EngineState: { byId: () => ({ id: 'deepseek', type: 'chat-compat', defaultModel: 'deepseek-chat' }) },
    WireFormat: { formatFor: () => 'chat-compat', resolveEndpoint: () => 'https://api.deepseek.com/chat/completions', translationModelName: () => false },
    Date: { now: () => clk.now() },
    // 记录句头闸每次裁决的 why（forced / idle / cjk-overlap / no-ts / …）：forced 与 idle 必须分得开。
    __gateReasons: (() => { const a = []; a.cjsLog = () => a; return a; })(),
    setTimeout: (fn, ms) => clk.setT(fn, ms), clearTimeout: (id) => clk.clearT(id),
    setInterval: (fn, ms) => clk.setT(fn, ms), clearInterval: (id) => clk.clearT(id),
    console, URL,
  };
  return { sb, captured, clk, gateReasons };
}

// 把会话开到「收音中、socket 已建好」的稳定态（全部由假时钟驱动，不 sleep）。
async function openSession(opts) {
  const { sb, captured, clk, gateReasons } = makeSandbox(opts || {});
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('conv');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  A.pttToggle('other');
  await clk.runTo(0);                 // 让 start() 的异步链走完（socket / seg 建好）
  if (captured.h && captured.h.onState) captured.h.onState('granted', '');
  await clk.runTo(0);
  return { A, captured, clk, gateReasons };
}
const gateDiag = (A) => ((A._debug().seg || {}).diag || {}).gate || {};
const rowTexts = (A) => A._debug().rows.map((r) => r.text);

// ── ① 低置信扣住 → 点停 ⇒ 1.5s 内放行（why=forced）─────────────────────────────
async function runHoldThenStop(mutateDrain) {
  const { A, captured, clk, gateReasons } = await openSession({ mutateDrain: !!mutateDrain });
  const t0 = clk.now();
  captured.onEvent('final', { locale: 'en-US', text: 'Yes.', conf: 0.2, t0, t1: t0 + 600 });
  await clk.runTo(0);
  const heldNow = A._debug().gateHeld.length > 0;   // 扣住（闸里有片，还没进账本）
  const rowsBefore = rowTexts(A);
  // 点停（同一侧再点一下 = 停止收音）—— 关麦前的 drainGateHeld 就是被测的那一条
  A.pttToggle('other');
  await clk.runTo(1400);                        // 1.4s < idleMs 1.5s：区分「点停放行」与「自然到期」
  const d = A._debug();
  const rows = rowTexts(A);
  const diag = gateDiag(A);
  const hasYes = rows.some((x) => /yes/i.test(x));
  const forced = gateReasons.indexOf('forced') >= 0;
  const idleRelease = gateReasons.indexOf('idle') >= 0;
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
  return { heldNow, rowsBefore, rows, hasYes, forced, idleRelease, diag, hold: d.gateHeld.length, calls: d.seg.calls };
}

test('★ 第九轮 D：低置信 final 被句头闸扣住 → 点停后在 1.5s 内放行（why=forced，不是 idle）', async () => {
  const r = await runHoldThenStop(false);
  eq(r.heldNow, true, '低置信 final 应当先被句头闸扣住（seg.hold=true），实际 ' + r.heldNow);
  eq(r.rowsBefore.length, 0, '扣住时不应出行：' + JSON.stringify(r.rowsBefore));
  ok(r.hasYes, '点停后 1.4s 内没有出现该词的行：' + JSON.stringify(r.rows));
  ok(r.forced, '放行原因不是收口（gate:release why=forced）：' + JSON.stringify(r.diag));
  ok(!r.idleRelease, '这次不该走 idle 到期放行（那是自然到期的路径）');
  eq(r.hold, 0, '放行后闸里不得残留');
});

test('★ 变异检查：断开 drainGateHeld（关麦前不放行）⇒ 上面那条必须红', async () => {
  const r = await runHoldThenStop(true);
  eq(r.heldNow, true, '变异下低置信 final 仍是先扣住');
  ok(!r.hasYes, '变异（关麦前不放行）下竟然还是出行了 —— 说明上一条测试抓不到 drainGateHeld');
});

// ── ② 高置信对照：不扣住、直接进账本 ──────────────────────────────────────────
test('第九轮 D 对照：高置信 final 不进扣住路径（无 gate.hold），进账本后出行', async () => {
  const { A, captured, clk } = await openSession({});
  const t0 = clk.now();
  captured.onEvent('final', { locale: 'en-US', text: 'Yes please.', conf: 0.95, t0, t1: t0 + 600 });
  await clk.runTo(0);
  const heldMid = A._debug().gateHeld.length > 0;
  const recsMid = A._debug().seg.recs.length;
  // 点停 ⇒ 路由器 force 收尾（等待中的文字立即送模型）⇒ 出行
  A.pttToggle('other');
  await clk.runTo(700);            // 越过 pttStop 的 450ms 收口宽限 ⇒ pause('user') ⇒ settle('stop') 强制送
  const rows = rowTexts(A);
  const diag = gateDiag(A);
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
  eq(heldMid, false, '高置信片不进句头闸（gateHeld 空）');
  eq(recsMid, 1, '高置信片直接进账本（1 条 wait 记录）');
  ok(!(diag.hold >= 1), '高置信片不应记 gate:hold：' + JSON.stringify(diag));
  ok(rows.some((x) => /yes please/i.test(x)), '高置信片没有出行：' + JSON.stringify(rows));
});

// ── ③ idle 对照：扣住后不点停 ⇒ 1.5s 到期放行（why=idle）──────────────────────
test('第九轮 D 对照：扣住后不点停 ⇒ 1.5s 到期放行（why=idle，与 forced 区分）', async () => {
  const { A, captured, clk, gateReasons } = await openSession({});
  const t0 = clk.now();
  captured.onEvent('final', { locale: 'en-US', text: 'Yes.', conf: 0.2, t0, t1: t0 + 600 });
  await clk.runTo(0);
  eq(A._debug().gateHeld.length, 1, '先扣住（finalGate.heldLocales）');
  await clk.runTo(1600);                       // 过一个 idleMs（不点停）
  const diag = gateDiag(A);
  const rows = rowTexts(A);
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
  ok((diag.release || 0) >= 1, '到期放行没记 gate:release：' + JSON.stringify(diag));
  ok(gateReasons.indexOf('idle') >= 0, '到期放行的 why 不是 idle：' + JSON.stringify(gateReasons));
  ok(gateReasons.indexOf('forced') < 0, '没有点停，不该出现 forced');
  eq(A._debug().gateHeld.length, 0, '到期后闸里不残留');
  ok(rows.length >= 1, '到期放行后应出行：' + JSON.stringify(rows));
});

// ── ④ 方案 1 的 partial 兜底（rescued）：**无字母**的垃圾 final 改用 partial ──────────
test('★ 第九轮 方案 1（第十三轮收口）：final 无字母（纯标点）且 partial 更完整 ⇒ 用 partial 当定稿', async () => {
  const { A, captured, clk } = await openSession({});
  // 识别器先给一条完整半句，再给一条被吐成一串点的低置信 final（r9 C-en-3/C-en-5 的形状）。
  // 第十三轮起：**有字母**的 final（如 `to make...............`）不再被 partial 顶替（保守，见
  // rescueWorth 单测）；只有**一个字母都没有**的 final 才救。
  captured.onEvent('partial', { locale: 'en-US', text: 'Yes please.' });
  await clk.runTo(0);
  const at = clk.now();
  captured.onEvent('final', { locale: 'en-US', text: '...............', conf: 0.09, t0: at, t1: at + 600 });
  await clk.runTo(0);
  const d = A._debug();
  const fromPartial = ((d.seg.diag || {}).final || {})['from-partial'] || 0;
  A.pttToggle('other');
  await clk.runTo(700);
  const rows = rowTexts(A);
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
  ok(fromPartial >= 1, '没有用 partial 兜底（缺 final:from-partial）：' + JSON.stringify((d.seg.diag || {}).final));
  ok(rows.some((x) => /yes please/i.test(x)), '救回的文字没有进账本/出行：' + JSON.stringify(rows));
});
test('★ 第十三轮对照：有字母的低置信 final（`to make...............`）不被 partial 顶替（保留 final 自己的文字）', async () => {
  const { A, captured, clk } = await openSession({});
  captured.onEvent('partial', { locale: 'en-US', text: 'Yes please.' });
  await clk.runTo(0);
  const at = clk.now();
  captured.onEvent('final', { locale: 'en-US', text: 'to make...............', conf: 0.09, t0: at, t1: at + 600 });
  await clk.runTo(0);
  const d = A._debug();
  const fromPartial = ((d.seg.diag || {}).final || {})['from-partial'] || 0;
  A.pttToggle('other');
  await clk.runTo(700);
  const rows = rowTexts(A);
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
  eq(fromPartial, 0, '有字母的 final 不该被 partial 顶替（保守前提）：' + JSON.stringify((d.seg.diag || {}).final));
  ok(rows.some((x) => /to make/i.test(x)), 'final 自己的文字应保留：' + JSON.stringify(rows));
  ok(!rows.some((x) => /yes please/i.test(x)), '不该出现被顶替进来的 partial 文字：' + JSON.stringify(rows));
});

// ── 保留：方案 1 的接线点（seg.setPtt）────────────────────────────────────────
test('★ 方案 1 端到端：按钮开始收音 ⇒ seg.setPtt(true)；停止 ⇒ false', async () => {
  const { A, clk } = await openSession({});
  const afterBegin = A._debug().seg.ptt;
  A.pttToggle('other');
  await clk.runTo(700);            // 越过 450ms 收口宽限，pause('user') 才会真的清收音态
  const afterStop = A._debug().seg.ptt;
  try { await A.leave(); } catch (_) {}
  eq(afterBegin, true, '按钮开始收音后 seg.state().ptt 不是 true —— setPtt(true) 没接上');
  eq(afterStop, false, '停止收音后 seg.state().ptt 不是 false —— setPtt(false) 没接上');
});

// ── R12 方案 4（第十三轮补前提）：补救判据 = final 不合格 + partial 可界定 ─────────
test('★ R12 方案 4 / 第十三轮：只有 final 不合格才补救；无 partial 时间信息时只在 final 无字母时救', async () => {
  const { A, clk } = await openSession({});
  const w = A._debug().rescueWorth;
  const at = clk.now();
  // ① final 本身合格（高置信、有字母、不以标点开头）⇒ 一律不救 —— 这正是 r12 §4.2 的使能条件：
  //    conf 0.957 的 `Please make 3 copies of this` 曾被领先的 partial 顶掉，句首整段丢。
  eq(w({ text: 'Please make 3 copies of this', conf: 0.957, t0: at, t1: at + 600 },
    { text: '. Please make 3 copies of this contract and', at }, at), false,
    'r12 auto-1：高置信 final 不得被超前的 partial 顶替');
  eq(w({ text: 'Yes.', t0: at, t1: at + 600 }, { text: 'Yes please.', at }, at), false,
    '有字母的 final（哪怕 partial 更长）不被 partial 顶替');
  eq(w({ text: '., please.' }, { text: 'Yes, please.', at }, at), false,
    'final 以标点开头但**有字母**、partial 又无时间信息 ⇒ 保守不救（旧版会救）');
  // ② final 无字母（纯标点 / 空）：识别器确实没听到内容 ⇒ partial 是唯一候选，救（记 from-partial）。
  eq(w({ text: '.' }, { text: 'Please make 3 copyies', at }, at), true, 'r10 auto-4：final 只有标点 ⇒ 用 partial');
  eq(w({ text: '...............', conf: 0.09, t0: at, t1: at + 600 }, { text: 'Yes please.', at }, at), true,
    '纯标点 final ⇒ 救');
  eq(w({ text: '.' }, { text: '...', at }, at), false, '没字母的 partial 不救');
  eq(w({ text: '.', at }, { text: 'Yes please.', at: at - 3000 }, at), false, '超过 2.5s 的 partial 不救');
  // ③ 若 partial 也带音频区间（将来原生补上）：只有整段 partial 落在 final 区间内才救，
  //    否则它可能含后续音频的词（不得混入）—— 这里的 final 低置信且有字母，靠区间界定才允许。
  eq(w({ text: 'to make', conf: 0.09, t0: 1000, t1: 1600 }, { text: 'to make three copies', at, t0: 1000, t1: 1600 }, at), true,
    '低置信 final + partial 区间落在 final 区间内 ⇒ 救');
  eq(w({ text: 'to make', conf: 0.09, t0: 1000, t1: 1600 }, { text: 'to make three copies', at, t0: 1000, t1: 2400 }, at), false,
    'partial 区间超出 final 区间（含后续音频的词）⇒ 不救');
  eq(w({ text: 'Yes please.', conf: 0.95, t0: 1000, t1: 1600 }, { text: 'Yes please now', at, t0: 1000, t1: 1600 }, at), false,
    '高置信 final 有区间也不救');
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
});

// ── 回放：r12 auto-1 的真实事件序列（/tmp/r12/r12-probe-at-stop.json 的 probe.native）──
// 真实事件：partial `. Please make 3 copies of this contract and`（t=1791650354989，句首领先），
// 紧随其后的正式 final `Please make 3 copies of this`（conf **0.957**，t0 2280 / t1 3960），
// 再一条首尾相接的续接 final `contract and send.`（t0 3960 / t1 4986，即 t0 == 上一条 t1）。
// 旧实现：高置信 final 被 partial 顶替（§4.2），随后续接片又把句首片替换掉（§4.1）⇒ 屏上只剩
// `contract and send.`。本测试证明两句都在、句首不丢。
test('★ 回放 r12 auto-1 真实事件序列：高置信 final 不被 partial 顶替 + 首尾相接的续接片不丢句首', async () => {
  const { A, captured, clk } = await openSession({});
  const base = clk.now();
  captured.onEvent('partial', { locale: 'en-US', text: '. Please make 3 copies of this contract and' });
  await clk.runTo(0);
  captured.onEvent('final', { locale: 'en-US', text: 'Please make 3 copies of this', conf: 0.957, t0: base, t1: base + 1680 });
  await clk.runTo(0);
  const fromPartial = ((A._debug().seg.diag || {}).final || {})['from-partial'] || 0;
  eq(fromPartial, 0, '高置信 final 不得被 partial 顶替（r12 §4.2）：' + JSON.stringify((A._debug().seg.diag || {}).final));
  // 首尾相接的续接片：t0 == 上一条 final 的 t1（续接，不是同段重识别）
  captured.onEvent('final', { locale: 'en-US', text: 'contract and send.', conf: 0.659, t0: base + 1680, t1: base + 2706 });
  await clk.runTo(0);
  A.pttToggle('other');
  await clk.runTo(700);
  const rows = rowTexts(A).join(' ');
  const n = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  ok(n(rows).indexOf(n('Please make 3 copies of this')) >= 0, '句首整段丢了（只剩续接片？）：' + JSON.stringify(rowTexts(A)));
  ok(n(rows).indexOf(n('contract and send.')) >= 0, '续接片丢了：' + JSON.stringify(rowTexts(A)));
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
});
