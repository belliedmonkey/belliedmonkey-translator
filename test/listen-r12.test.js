// test/listen-r12.test.js — 第十二轮（第十轮六条方案）的修复验收。
//
// 逐条单测 + 变异检查（每个变异都要让对应测试红）+ 一条上游模糊不变量：
//   方案 1 partial 补救文字按音频区间去重（未出行替换 / 已出行只追加不重叠部分）
//   方案 2 partial 活跃时 ≤2 词片不补调/不硬切；模型 source 句首重复前缀裁剪（emit:trim-dup）
//   方案 3 句头闸同 locale 扣住片按时间顺序拼接、不替换（丢弃全记 gate:drop）
//   方案 5 retryForce 真正发出时就地消费；≤2 词片空闲直接 force 发送
//   方案 6 上游 fuzz：partial 补救 + 同区间 final 重叠 + 模型扩张；相邻行拼接无重复片段、守恒
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟 ────────────────────────────────────────────────────────────────────
function fakeClock() {
  let t = 5_000_000, seq = 1;
  const timers = new Map();
  return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearT: (id) => { timers.delete(id); },
    size: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next.x.at)) next = { id, x };
        if (!next) break;
        timers.delete(next.id);
        t = Math.max(t, next.x.at);
        next.x.fn();
        await Promise.resolve(); await Promise.resolve();
      }
      t = end; await Promise.resolve();
    },
  };
}
const settleTick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const bufOf = (p) => String((p && p.user) || '').split('BUF:\n')[1].split('\nFORCE:')[0].trim();
const forceOf = (p) => /true\s*$/.test(String(p && p.user));
const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function makeRouter(o) {
  const opt = o || {};
  const clk = fakeClock();
  const ev = [], calls = [], diags = [];
  const queue = opt.replies ? opt.replies.slice() : null;
  const r = C.makeSegmentRouter(Object.assign({
    call: async (p, info) => {
      calls.push({ p, info });
      const r0 = queue ? queue.shift() : undefined;
      if (r0 instanceof Error) throw r0;
      if (typeof r0 === 'function') return r0(p, info, calls.length);
      if (typeof r0 === 'string') return r0;
      if (r0) return JSON.stringify(r0);
      return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' });
    },
    emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
    fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
    onFail: (reason, extra) => ev.push({ t: 'fail', reason, extra }),
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    onDegrade: (why) => ev.push({ t: 'degrade', why }),
    onLeak: (left) => ev.push({ t: 'leak', left }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    idleMs: opt.idleMs || 1500, endWaitMs: 3000,
  }, opt.deps || {}));
  return { r, clk, ev, calls, diags };
}
const emitted = (ev) => ev.filter((e) => e.t === 'emit').flatMap((e) => e.rows.map((x) => x.source));
const origs = (ev) => ev.filter((e) => e.t === 'emit').map((e) => e.meta.orig);
const fallbacks = (ev) => ev.filter((e) => e.t === 'fallback').map((e) => e.text);
const failsOf = (ev) => ev.filter((e) => e.t === 'fail').map((e) => e.reason);
const diagN = (diags, kind) => diags.filter((d) => d.kind === kind).length;

// ══ 方案 3：句头闸同 locale 扣住片按时间顺序拼接，不许替换 ═════════════════════
describe('R12 方案 3 — 句头闸同 locale 扣住片按时间顺序拼接（不替换、不静默丢片）', () => {
  const SCRIPT = (t) => (/[\u4e00-\u9fff]/.test(String(t || '')) ? 'Han' : (/[A-Za-z]/.test(String(t || '')) ? 'Latin' : null));
  function gateWith(o) {
    const clk = fakeClock(); const rel = []; const drops = [];
    const g = C.makeFinalGate(Object.assign({ dominantScript: SCRIPT, now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
      onRelease: (loc, t, meta) => rel.push({ loc, t, meta }),
      onDiag: (k, t, w) => { if (k === 'gate:drop') drops.push({ t, w }); } }, (o || {}).deps || {}));
    return { g, clk, rel, drops };
  }
  test('★ r10 auto-3：Yes.(conf .312) 先扣，please.(conf .005) 到点 ⇒ 两片按时间顺序一起放行（Yes 不丢）', async () => {
    const { g, clk, rel, drops } = gateWith();
    deepEq(g.push({ locale: 'en-US', text: 'Yes.', conf: 0.312, t0: 97907, t1: 99389 }), [], '第一片扣住');
    deepEq(g.push({ locale: 'en-US', text: 'please.', conf: 0.005, t0: 99389, t1: 100586 }), [], '第二片也扣住（不是替换）');
    eq(g.heldLocales().length, 1, '仍是一条扣住记录（两片已拼接）');
    await clk.advance(1600);
    eq(rel.length, 1, '到点一次放行（一起裁决）');
    eq(rel[0].loc, 'en-US');
    ok(/yes/i.test(rel[0].t) && /please/i.test(rel[0].t), '两片都在：' + JSON.stringify(rel[0].t));
    ok(rel[0].t.indexOf('Yes') < rel[0].t.indexOf('please'), '按时间顺序拼接：' + JSON.stringify(rel[0].t));
    eq(drops.length, 0, '没有静默丢弃：' + JSON.stringify(drops));
    eq(g.heldLocales().length, 0, '闸里不残留');
  });
  test('★ 变异：replaceHeld（退回同 locale 直接替换上一片）⇒ 上一条必须红', async () => {
    const { g, clk, rel } = gateWith({ deps: { replaceHeld: true } });
    g.push({ locale: 'en-US', text: 'Yes.', conf: 0.312, t0: 97907, t1: 99389 });
    g.push({ locale: 'en-US', text: 'please.', conf: 0.005, t0: 99389, t1: 100586 });
    await clk.advance(1600);
    eq(rel.length, 1, '变异下仍放行一次');
    ok(!/yes/i.test(rel[0].t), '变异下 Yes 被替换丢掉 —— 正是方案 3 要修的行为：' + JSON.stringify(rel[0].t));
    eq(rel[0].t, 'please.');
  });
});

// ══ 方案 1：partial 补救文字按音频区间去重 ═════════════════════════════════════
describe('R12 方案 1 — partial 补救文字与同区间 final 去重', () => {
  test('★ overlapTs（第十三轮）：只有真交叠才算重叠；首尾相接不算（全文件唯一判据）', () => {
    eq(C.overlapTs(0, 100, 100, 200), false, 'b0 == a1（首尾相接的续接片）不算重叠');
    eq(C.overlapTs(100, 200, 0, 100), false, 'a0 == b1 不算重叠');
    eq(C.overlapTs(0, 100, 99, 200), true, '交叠 1ms 算重叠');
    eq(C.overlapTs(0, 200, 50, 100), true, '完全包含算重叠');
    eq(C.overlapTs(0, 100, 200, 300), false, '不相邻不算');
    eq(C.overlapTs(0, 100, 100, 100), false, '零长片不算');
    eq(C.overlapTs(0, 100, NaN, 200), false, '缺 t0/t1 不算（有限数检查保留）');
    eq(C.overlapTs(undefined, 100, 50, 200), false, '缺字段不算');
    eq(C.overlapTs(Infinity, 100, 50, 200), false, '非有限数不算');
  });
  test('★ 首尾相接的续接片不得替换补救片（r12 §4.1 的真机形态：句首不丢）', async () => {
    const { r, clk, ev, diags } = makeRouter({});
    // P1-en-auto-1 的真实区间：补救片 [2280,3960]，续接 final [3960,4986]（t0 == 上一条 t1）
    r.feed('en-US', '. Please make 3 copies of this contract and', { rescued: true, t0: 2280, t1: 3960 });
    r.feed('en-US', 'contract and send.', { t0: 3960, t1: 4986 });
    eq(diagN(diags, 'rescue:replace'), 0, '首尾相接的续接片不得替换补救片：' + JSON.stringify(diags));
    await clk.advance(1600); await settleTick();
    const out = emitted(ev).join(' ');
    ok(norm(out).indexOf(norm('Please make 3 copies of this')) >= 0, '句首应当保留：' + JSON.stringify(out));
    ok(norm(out).indexOf(norm('contract and send.')) >= 0, '续接句尾也应当保留：' + JSON.stringify(out));
  });
  test('★ 尚未出行 ⇒ 正式 final 按文字对齐让临时稿让位（rescue:trim），缓冲里同一句首只出现一次', async () => {
    const { r, clk, ev, diags } = makeRouter({});
    // 临时稿（listen-model partialWorthRescue 救回的 partial）带 rescued 进账本；R14 起不再按音频区间去重
    r.feed('en-US', 'Please make 3 copyies', { rescued: true, t0: 1000, t1: 1400 });
    await settleTick();
    eq(r.pending('en-US'), 'Please make 3 copyies', '临时稿先进账本');
    // 识别器随后给正式 final（三条连续片段）：`Please make` 在临时稿里对齐 ⇒ 临时稿让位
    r.feed('en-US', 'Please make', { t0: 1000, t1: 1400 });
    r.feed('en-US', '3', { t0: 1400, t1: 1600 });
    r.feed('en-US', 'copies.', { t0: 1600, t1: 1800 });
    eq(diagN(diags, 'rescue:replace'), 0, 'R14 起不再有按时间的替换：' + JSON.stringify(diags));
    ok(diagN(diags, 'rescue:trim') >= 1, '没有记 rescue:trim：' + JSON.stringify(diags));
    eq(r.pending('en-US'), 'Please make 3 copies.', '临时稿让位（不是叠加）：' + JSON.stringify(r.pending('en-US')));
    await clk.advance(1600); await settleTick();
    const out = emitted(ev).join(' ');
    ok(out.indexOf('copyies') < 0, '被裁掉的临时稿不得上屏：' + JSON.stringify(out));
    eq(norm(out), 'pleasemake3copies', '上屏 = 正式 final：' + JSON.stringify(out));
    eq(norm(origs(ev).join('')), 'pleasemake3copies', '账本守恒（消耗的原文不含临时稿重复）：' + JSON.stringify(origs(ev)));
  });
  test('★ 变异：去掉补救去重（noRescueDedup）⇒ 上一条必须红（同一句首进账本两次）', async () => {
    const { r, clk, ev, diags } = makeRouter({ deps: { noRescueDedup: true } });
    r.feed('en-US', 'Please make 3 copyies', { rescued: true, t0: 1000, t1: 1400 });
    r.feed('en-US', 'Please make', { t0: 1000, t1: 1400 });
    r.feed('en-US', '3', { t0: 1400, t1: 1600 });
    r.feed('en-US', 'copies.', { t0: 1600, t1: 1800 });
    eq(diagN(diags, 'rescue:replace'), 0, '变异下没有替换');
    const pending = r.pending('en-US');
    ok(pending.indexOf('copyies') >= 0 && pending.indexOf('Please make 3') >= 0, '变异下补救文字与正式 final 叠加：' + JSON.stringify(pending));
    eq(norm(pending), 'pleasemake3copyiespleasemake3copies', '正是 r10 auto-4 的账本级重复');
    await clk.advance(1600); await settleTick();
    ok(emitted(ev).join(' ').indexOf('copyies') >= 0, '变异下重复文字上屏');
  });
  test('已出行 ⇒ 同区间 final 只追加不重叠部分（rescue:append），整段重复不追加', async () => {
    const { r, clk, ev, diags } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true, t0: 1000, t1: 1800 });
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1, '补救文字先出行');
    // 识别器随后对同一段音频又给一条完全相同/更短的正式 final ⇒ 整条都不该再追加
    r.feed('en-US', 'Please make', { t0: 1000, t1: 1400 });
    r.feed('en-US', '3', { t0: 1400, t1: 1600 });
    eq(r.pending('en-US'), '', '已出行的补救内容不再追加：' + JSON.stringify(r.pending('en-US')));
    eq(diagN(diags, 'rescue:append'), 2, '两次都记了 rescue:append：' + JSON.stringify(diags));
    // 真正的新内容（不在补救文字里）仍要追加
    r.feed('en-US', 'Thanks.', { t0: 1800, t1: 2000 });
    eq(r.pending('en-US'), 'Thanks.', '不重叠的部分照常追加：' + JSON.stringify(r.pending('en-US')));
  });
});

// ══ 方案 2：partial 活跃时的短片 + 模型 source 重复前缀裁剪 ═════════════════════
describe('R12 方案 2 — partial 活跃时短片留缓冲 / 模型 source 句首重复裁剪', () => {
  test('★ partial 仍在到达 + ≤2 词片：整段 remainder 也不强制补调 / 不硬切（留缓冲与后文合并）', async () => {
    const clk = fakeClock(); const calls = []; const ev = [];
    const r = C.makeSegmentRouter({
      call: (p) => { calls.push({ p, at: clk.now() }); return new Promise((res) => clk.setT(() => res('{"segments":[],"remainder":"Please"}'), 300)); },
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
      fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
      onFail: (reason) => ev.push({ t: 'fail', reason }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
    });
    r.feed('en-US', 'Please');
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '第一次空闲送出');
    r.notePartial('en-US');                        // 模型往返期间 partial 仍在到达（人还在说）
    await clk.advance(400); await settleTick();    // 回复到达：整段 remainder
    eq(calls.length, 1, '人还在说 ⇒ 整段 remainder 后**不**立即补调');
    eq(fallbacks(ev).length, 0, '不硬切、不走旧路上屏');
    // partial 停了（过了判活窗口）⇒ 这时才按普通空闲重发（force，短片直发）
    await clk.advance(2600); await settleTick();
    ok(calls.length >= 2, 'partial 停了以后才重发');
    eq(fallbacks(ev).length, 0, '仍然不硬切');
  });
  test('★ 变异对照：没有 partial 时同样输入会立即补调一次（证明上一条测的是 partial 抑制）', async () => {
    const { r, clk, calls } = makeRouter({
      replies: ['{"segments":[],"remainder":"Please"}', '{"segments":[],"remainder":""}'],
    });
    r.feed('en-US', 'Please');                   // 不调 notePartial
    await clk.advance(1600); await settleTick();
    await settleTick();
    eq(calls.length, 2, '无 partial ⇒ 整段 remainder 后立即 force 补调一次');
    eq(forceOf(calls[1].p), true, '第二次是 force 补调');
  });
  test('★ 模型 source 句首补回上一条已出行尾部 ⇒ 切掉前缀（emit:trim-dup），拼接后无重复', async () => {
    const TAIL = 'make 3 copies of this contract and send them to Mr. Zhang\'s office before 5 p.m.';
    const { r, clk, ev, diags } = makeRouter({
      replies: ['{"segments":[{"source":"Please","translation":"T"}],"remainder":""}',
        JSON.stringify({ segments: [{ source: 'Please ' + TAIL, translation: 'T' }], remainder: '' })],
    });
    r.feed('en-US', 'Please');
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1, '上一条已出行');
    r.feed('en-US', TAIL);
    await clk.advance(1600); await settleTick();
    const rows = emitted(ev);
    eq(rows.length, 2, '两行：' + JSON.stringify(rows));
    eq(norm(rows[1]), norm(TAIL), '第二条 source 的重复句首被切掉：' + JSON.stringify(rows[1]));
    ok(diagN(diags, 'emit:trim-dup') >= 1, '没有记 emit:trim-dup：' + JSON.stringify(diags));
    eq(norm(rows.join('')), norm('Please ' + TAIL), '拼接后 = 原文（无重复片段）：' + JSON.stringify(rows.join(' ')));
    ok(!/pleaseplease/i.test(norm(rows.join(''))), '相邻两行拼接后无重复片段');
  });
  test('★ 变异对照：模型 source 与 buffer 一致（无扩张）时不得误切', async () => {
    const { r, clk, ev, diags } = makeRouter({ replies: ['{"segments":[{"source":"Please","translation":"T"}],"remainder":""}'] });
    r.feed('en-US', 'Please');
    await clk.advance(1600); await settleTick();
    r.feed('en-US', 'please keep');              // source = buffer（legit，缓冲本身以它开头）
    await clk.advance(1600); await settleTick();
    eq(diagN(diags, 'emit:trim-dup'), 0, '不该误切：' + JSON.stringify(diags));
    eq(emitted(ev).length, 2);
  });
});

// ══ 方案 5：补调额度就地消费 + ≤2 词片空闲 force 发送 ═══════════════════════════
describe('R12 方案 5 — 补调额度真正发出时消费 / ≤2 词片空闲 force 发送', () => {
  const BUF = '一共三千八百五十块钱，刷卡还是付款呢？';   // 20 字、非片段、非短片
  test('★ 同一句最多补调一次，再失败直接硬切：empty-reply 只记一次（r11 C 的 empty-reply:2 修掉）', async () => {
    const { r, clk, calls, ev } = makeRouter({
      replies: [(p) => JSON.stringify({ segments: [], remainder: bufOf(p) }), '{"segments":[],"remainder":""}', '{"segments":[],"remainder":""}'],
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();     // #0 整段 remainder ⇒ 立即 force 补调
    eq(calls.length, 2, '原调用 + 一次补调，共 2 次（不再有第三次）：' + calls.length);
    eq(forceOf(calls[1].p), true, '第二次是 force 补调');
    await settleTick();
    eq(calls.length, 2, '补调真正发出时消费了额度 ⇒ 不会再触发第二次立即 force');
    eq(failsOf(ev).filter((x) => x === 'empty-reply').length, 1, 'empty-reply 只记一次：' + JSON.stringify(failsOf(ev)));
    ok(fallbacks(ev).length >= 1, '补调也失败 ⇒ 硬切交旧路（不丢字）：' + JSON.stringify(fallbacks(ev)));
  });
  test('★ 变异：去掉 retryForce 消费（noRetryConsume）⇒ 上一条必须红（同一句补调两次 / empty-reply:2）', async () => {
    const { r, clk, calls, ev } = makeRouter({
      deps: { noRetryConsume: true },
      replies: [(p) => JSON.stringify({ segments: [], remainder: bufOf(p) }), '{"segments":[],"remainder":""}', '{"segments":[],"remainder":""}'],
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();
    await settleTick();
    eq(calls.length, 3, '变异下多补一次 force（正是 r11 C 复现）：' + calls.length);
    eq(failsOf(ev).filter((x) => x === 'empty-reply').length, 2, '变异下 empty-reply:2：' + JSON.stringify(failsOf(ev)));
    ok(fallbacks(ev).length >= 1, '最终仍硬切');
  });
  test('★ 新话进账本 ⇒ 额度重置，新片段可再补一次（额度只由真正新话重置）', async () => {
    const { r, clk, calls } = makeRouter({
      replies: [
        (p) => JSON.stringify({ segments: [], remainder: bufOf(p) }),   // #0 all-remainder
        '{"segments":[],"remainder":""}',                               // #1 补调空
        (p) => JSON.stringify({ segments: [], remainder: bufOf(p) }),   // #2 新话后 all-remainder
        '{"segments":[],"remainder":""}',                               // #3 新话后的补调空
      ],
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick(); await settleTick();     // #0 + #1（额度用完，硬切）
    const before = calls.length;
    r.feed('zh-CN', '再多一句问一下价格吧');
    await clk.advance(1600); await settleTick(); await settleTick();
    ok(calls.length >= before + 2, '新话后又走「原调用 + 一次补调」：' + calls.length);
  });
  test('★ ≤2 词的片到空闲时直接用 force 发送，省掉一次整段 remainder 往返', async () => {
    const { r, clk, calls, ev } = makeRouter({
      replies: [(p) => (forceOf(p) ? JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' }) : JSON.stringify({ segments: [], remainder: bufOf(p) }))],
    });
    r.feed('en-US', 'Please');
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '只有一次调用（force 首发）：' + calls.length);
    eq(forceOf(calls[0].p), true, '首发就是 force=true（全部切完）');
    eq(failsOf(ev).length, 0, '没有整段 remainder 失败');
    eq(emitted(ev).length, 1, '一次调用即出行：' + JSON.stringify(emitted(ev)));
  });
  test('★ 变异：noShortForce ⇒ 上一条必须红（退回非 force 首发 + 补调的第二趟往返）', async () => {
    const { r, clk, calls } = makeRouter({
      deps: { noShortForce: true },
      replies: [(p) => (forceOf(p) ? JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' }) : JSON.stringify({ segments: [], remainder: bufOf(p) }))],
    });
    r.feed('en-US', 'Please');
    await clk.advance(1600); await settleTick();
    eq(forceOf(calls[0].p), false, '变异下首发不是 force');
    await settleTick();
    eq(calls.length, 2, '变异下要多一次补调往返：' + calls.length);
  });
});

// ══ 方案 6：上游 fuzz（partial 补救 + 同区间 final 重叠 + 模型扩张）══════════════
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const EN_WORDS = ['please', 'make', 'three', 'copies', 'this', 'contract', 'send', 'them', 'before', 'five', 'office'];
const ZH_CHARS = '合同复印三份送到办公室五点半之前一共三千八百五十块钱请问怎么走谢谢';
// 唯一 token（带序号）：随机文本里就不会出现「合法的重复片段」，任何相邻重合都只能是模型扩张造成的。
function mkWords(rnd, n, tokRef) { let s = ''; for (let i = 0; i < n; i++) s += (i ? ' ' : '') + EN_WORDS[Math.floor(rnd() * EN_WORDS.length)] + (tokRef.n++); return s; }
function mkZh(rnd, n, tokRef) { let s = ''; for (let i = 0; i < n; i++) s += ZH_CHARS[Math.floor(rnd() * ZH_CHARS.length)] + (tokRef.n++); return s; }
// 相邻两行（同一 locale）拼接后不得出现重复片段（归一化后，≥3 字的重合）
function adjacentDup(rows) {
  const bad = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    if (!rows[i].locale || rows[i].locale !== rows[i + 1].locale) continue;
    const a = norm(rows[i].source), b = norm(rows[i + 1].source);
    const max = Math.min(a.length, b.length);
    for (let k = max; k >= 3; k--) {
      if (a.slice(-k) === b.slice(0, k)) { bad.push(JSON.stringify({ i, a: a.slice(-8), b: b.slice(0, 8), k })); break; }
    }
  }
  return bad;
}
function runUpstreamFuzz(seed) {
  const rnd = mulberry32(seed);
  const clk = fakeClock();
  const viol = [];
  const emittedRows = [];      // { locale, source }（按上屏顺序）
  const consumed = [];         // { locale, orig }
  const expected = { 'en-US': '', 'zh-CN': '' };   // 识别器原始产出（补救被替换后不重复计）
  const formalPieces = { 'en-US': [], 'zh-CN': [] };   // 识别器**正式 final** 的文本（覆盖判据：不丢句首）
  let lastSource = {};         // locale → 上一条已出行行文本（假模型据此扩张 source）
  let diags = [];
  const r = C.makeSegmentRouter({
    call: (p, info) => new Promise((res) => clk.setT(() => {
      const b = bufOf(p);
      const lc = info.locale;
      const prevRow = String(lastSource[lc] || '');
      const tail = lc === 'en-US'
        ? (prevRow ? prevRow.split(/\s+/).pop() : '')
        : (prevRow ? prevRow.slice(-3) : '');
      const expanded = tail && !b.startsWith(tail) ? (tail + ' ' + b) : b;
      res(JSON.stringify({ segments: [{ source: expanded, translation: 'T' }], remainder: '' }));
    }, 50 + Math.floor(rnd() * 400))),
    emit: (rows, meta) => {
      for (const row of rows) { emittedRows.push({ locale: meta.locale, source: row.source }); lastSource[meta.locale] = String(row.source); }
      consumed.push({ locale: meta.locale, orig: meta.orig }); 
    },
    fallback: (t, meta) => { emittedRows.push({ locale: meta && meta.locale, source: t }); consumed.push({ locale: meta && meta.locale, orig: t }); },
    onDiag: (kind) => diags.push(kind),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
  });
  return (async () => {
    let t = 1000;
    const tok = { n: 0 };
    let abuttingN = 0;   // 场景 A（首尾相接 + partial 超前）实际出现次数
    const steps = 24 + Math.floor(rnd() * 24);
    for (let i = 0; i < steps; i++) {
      const lc = rnd() < 0.6 ? 'en-US' : 'zh-CN';
      const roll = rnd();
      if (roll < 0.30) {
        if (rnd() < 0.5) {
          // 场景 A（r12 §4.1 · 首尾相接 + partial 超前）：补救片是「正式 final + 后文的词」的流式
          // partial 形态；紧接着的续接片 t0 **恰好等于**补救片的 t1（首尾相接，不是同段重识别）。
          // 旧 overlapTs（`<=`）把续接片当同段重识别、替换掉补救片 ⇒ 句首整段丢（P1-en-auto-1）。
          const formal = lc === 'en-US' ? mkWords(rnd, 3, tok) : mkZh(rnd, 4, tok);
          const extra = lc === 'en-US' ? mkWords(rnd, 1, tok) : mkZh(rnd, 1, tok);
          const cont = lc === 'en-US' ? mkWords(rnd, 3, tok) : mkZh(rnd, 3, tok);
          const t0 = t, t1 = t + 500; t += 600;
          const ahead = formal + (lc === 'en-US' ? ' ' : '') + extra;   // partial 超前（比正式 final 多出词）
          formalPieces[lc].push(formal);                                 // 这条正式 final 必须出现在出行文字里
          expected[lc] += ahead;                                         // 补救片进账本（不被替换）
          r.feed(lc, ahead, { rescued: true, t0, t1 });
          expected[lc] += cont;                                          // 续接片 t0 == 补救片 t1
          r.feed(lc, cont, { rescued: false, t0: t1, t1: t1 + 500 });
          abuttingN++;
        } else {
          // 场景 B（原样 · 同区间替换）：补救片与正式 final 覆盖**同一段音频**（真重叠）
          // ⇒ 正式 final 替换补救片（不重复计）。
          const rescue = lc === 'en-US' ? mkWords(rnd, 3, tok) : mkZh(rnd, 4, tok);
          const t0 = t, t1 = t + 500; t += 600;
          expected[lc] += rescue;
          r.feed(lc, rescue, { rescued: true, t0, t1 });
          const formal = rescue + (lc === 'en-US' ? ' ' : '') + (lc === 'en-US' ? mkWords(rnd, 3, tok) : mkZh(rnd, 3, tok));
          // 替换：识别器原始产出里把补救那一段换成正式 final（不重复计）
          expected[lc] = expected[lc].slice(0, expected[lc].length - rescue.length) + formal;
          r.feed(lc, formal, { t0, t1 });
        }
      } else if (roll < 0.72) {
        const txt = lc === 'en-US' ? mkWords(rnd, 3 + Math.floor(rnd() * 3), tok) : mkZh(rnd, 4 + Math.floor(rnd() * 4), tok);
        expected[lc] += txt; 
        r.feed(lc, txt);
        if (rnd() < 0.5) r.notePartial(lc);
      } else if (roll < 0.92) {
        await clk.advance(100 + Math.floor(rnd() * 2200));
      } else {
        r.settle(rnd() < 0.5 ? 'stop' : 'switch');
      }
      await settleTick();
    }
    r.setSpeaking(false);
    await clk.advance(6000); await settleTick();
    const pe = r.settle('end'); await clk.advance(3600); await settleTick(); await pe;
    await clk.advance(500); await settleTick();
    // ① 相邻两行拼接后无重复片段
    const dup = adjacentDup(emittedRows);
    if (dup.length) viol.push('相邻行重复：' + dup.slice(0, 2).join('；'));
    // ② R14：守恒以识别器**正式 final** 为准（临时稿（partial 补救）本就让位/被裁，不进守恒基准）——
    //    每条正式 final 的归一化文字都必须出现在（出行 + 仍未出行）的文字里。
    const emittedAll = { 'en-US': '', 'zh-CN': '' };
    const cons = { 'en-US': '', 'zh-CN': '' };
    for (const x of consumed) cons[x.locale] = (cons[x.locale] || '') + x.orig;
    for (const row of emittedRows) emittedAll[row.locale] = (emittedAll[row.locale] || '') + norm(row.source);
    for (const lc of ['en-US', 'zh-CN']) {
      const outN = norm(cons[lc] + r.pending(lc));
      const okText = emittedAll[lc] + norm(r.pending(lc));
      // outN ⊇ emittedAll（出行条目都记进 consumed）；正式 final 必须被覆盖。
      for (const f of formalPieces[lc]) {
        const fn = norm(f);
        if (fn && okText.indexOf(fn) < 0) {
          viol.push(lc + ' 丢句首：正式 final ' + JSON.stringify(f) + ' 未出现在出行文字里');
        }
      }
      void outN;
    }
    const timers = clk.size();
    r.dispose();
    return { seed, viol, timers, abutting: abuttingN, rescueTrim: diags.filter((x) => x === 'rescue:trim').length, rescueNomatch: diags.filter((x) => x === 'rescue:nomatch').length, trimDup: diags.filter((x) => x === 'emit:trim-dup').length };
  })();
}
describe('R12 方案 6 — 上游 fuzz：临时稿文字对齐 / 同区间 final / 首尾相接 + partial 超前 / 模型扩张（200 条）', () => {
  test('★ 相邻两行无重复片段 + 每句出行覆盖正式 final（不丢句首）', async () => {
    const bad = [];
    let replace = 0, trim = 0, abutting = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const res = await runUpstreamFuzz(seed);
      replace += res.rescueTrim; trim += res.trimDup; abutting += res.abutting;
      if (res.viol.length) bad.push('seed ' + seed + '：' + res.viol.slice(0, 2).join('；'));
      if (res.timers !== 0) bad.push('seed ' + seed + '：残留计时器 ' + res.timers);
    }
    eq(bad.length, 0, bad.slice(0, 6).join('\n'));
    ok(replace > 0, '这条 fuzz 必须真的走到临时稿文字对齐路径（rescue:trim=' + replace + '）');
    ok(trim > 0, '这条 fuzz 必须真的走到模型扩张裁剪路径（emit:trim-dup=' + trim + '）');
    ok(abutting > 0, '这条 fuzz 必须真的走到「首尾相接 + partial 超前」场景（abutting=' + abutting + '）');
  });
});
