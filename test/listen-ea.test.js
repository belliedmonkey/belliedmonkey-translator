// test/listen-ea.test.js — 断句路的 EA 用例 + 第四轮复现固定用例 + 模糊不变量 + 旧路回归。
//
// 全部行为测试：驱动真实账本路由器、真实注册表（build/providers.config.js + 真 WireFormat/
// EngineState）、抽取的纯判定（intakeDecide/finalAdmit/segRouteFor）。
const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');

// 文字系判定（与生产 LearnRules.dominantScript 同形：拉丁/汉字/假名…）。**不能返回 null** ——
// 返回 null 会让 rejectDeviceFinal 的 conf 那一步整条短路，句头闸的扣住/判 conf 路径就不被测到
// （第九轮发现：闸的模糊不变量此前正是被这个 null 蒙住的）。
const SCRIPT = (t) => {
  const s = String(t || '');
  if (/[\u3040-\u30ff]/.test(s)) return 'Kana';
  if (/[\u4e00-\u9fff]/.test(s)) return 'Han';
  if (/[\uac00-\ud7af]/.test(s)) return 'Hangul';
  if (/[A-Za-z]/.test(s)) return 'Latin';
  return null;
};

const ROOT = path.join(__dirname, '..');
const REAL = require('../build/providers.config.js');
function realWire() {
  const win = { MT_PROVIDERS: REAL.map((p) => Object.assign({}, p, { defaultModel: typeof p.defaultModel === 'string' ? p.defaultModel : ((p.defaultModel && p.defaultModel.global) || '') })) };
  return loadModule(['content/wire-format.js', 'content/engine-state.js'], { window: win });
}
function routeFor(id, model) {
  const m = realWire();
  return C.segRouteFor({
    providerId: m.EngineState.resolve(id), provider: m.EngineState.byId(m.EngineState.resolve(id)), model: model || '', baseUrl: '',
    formatOf: m.WireFormat.formatFor, resolveEndpoint: m.WireFormat.resolveEndpoint, isTranslationModel: m.WireFormat.translationModelName,
  });
}

function clock() {
  let t = 1e6, seq = 1; const timers = new Map();
  return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearT: (id) => { timers.delete(id); },
    size: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
      for (;;) {
        let n = null;
        for (const [id, x] of timers) if (x.at <= end && (!n || x.at < n.x.at)) n = { id, x };
        if (!n) break;
        timers.delete(n.id); t = Math.max(t, n.x.at); n.x.fn();
        await drain();
      }
      t = end; await drain();
    },
  };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const bufOf = (p) => String((p && p.user) || '').split('BUF:\n')[1].split('\nFORCE:')[0].trim();
function router(replies, opts) {
  const o = opts || {};
  const clk = clock(); const ev = []; const calls = []; const q = replies ? replies.slice() : null;
  const r = C.makeSegmentRouter({
    call: async (p) => {
      calls.push(p); const x = q ? q.shift() : undefined;
      if (x instanceof Error) throw x;
      if (typeof x === 'function') return x(p);
      if (typeof x === 'string') return x;
      if (x) return JSON.stringify(x);
      return JSON.stringify({ segments: [{ source: bufOf(p), translation: '译文' }], remainder: '' });
    },
    emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
    fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
    onDegrade: (why) => ev.push({ t: 'degrade', why }),
    onLeak: (left) => ev.push({ t: 'leak', left }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: o.idleMs || 1500, endWaitMs: o.endWaitMs || 3000,
  });
  return { r, clk, ev, calls };
}
const emits = (ev) => ev.filter((e) => e.t === 'emit').flatMap((e) => e.rows);
const origs = (ev) => ev.filter((e) => e.t === 'emit').map((e) => e.meta.orig);
const falls = (ev) => ev.filter((e) => e.t === 'fallback').map((e) => e.text);
const consumedIn = (ev) => {   // 按事件顺序拼出「已上屏的原文」
  const out = [];
  for (const e of ev) { if (e.t === 'emit') out.push(e.meta.orig); else if (e.t === 'fallback') out.push(e.text); }
  return out.join('');
};

// ══ 第四轮复现固定用例（r3repro/repro4.js、dbg2.js 转写）════════════════════════
describe('R4 复现 — 收尾时的丢字 / 重复 / 乱序', () => {
  test('★ P1-1 在飞时撞硬上限：同一段话只出一次（先作废在飞批次，再硬切）', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const clk = clock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: async (p) => { await gate; return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'x' }], remainder: '' }); },
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }), fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    const A = '一二三四五六七八九十'.repeat(3) + '甲';      // 31 字
    const B = '乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地人'.repeat(1) + '甲乙丙丁戊己庚辛'; // 30 字
    r.feed('zh-CN', A);
    r.settle('switch'); await tick();                        // A 在飞
    r.feed('zh-CN', B);                                      // 加上 B 撞硬上限（61 > 60）
    release(); await tick();                                  // 迟到的 A 回复
    const out = consumedIn(ev);
    eq(out, A + B, '整段只出一次（旧实现会先出 A+B 再出 A）');
    eq((out.match(new RegExp('^' + A)) || []).length, 1, 'A 只出现一次');
    r.dispose();
  });
  test('★ P1-2 结束时的顺序：后说的必须排在前一句之后（按账本顺序提交）', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const clk = clock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: async (p) => { await gate; return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'x' }], remainder: '' }); },
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }), fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, endWaitMs: 3000,
    });
    r.feed('zh-CN', '第一句话在这里');       // 在飞
    r.settle('stop'); await tick();
    r.feed('zh-CN', '好的');                 // 等待中（后面的）
    const p = r.settle('end');               // 等待中的立即交旧路，在飞的等回复
    await tick();
    eq(ev.length, 0, '在飞那段没回来之前，后面的不能先上屏（乱序就是这么来的）');
    release(); await tick(); await p; await tick();
    const out = consumedIn(ev);
    eq(out, '第一句话在这里好的', '顺序 = 说话顺序（第一句在前）');
    r.dispose();
  });
  test('★ P1-3 结束时在飞回复带回的 remainder 不丢（交旧路），且不留账本', async () => {
    const clk = clock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: async (p) => JSON.stringify({ segments: [{ source: bufOf(p).slice(0, 4), translation: 'x' }], remainder: bufOf(p).slice(4) }),
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }), fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, endWaitMs: 3000,
    });
    r.feed('zh-CN', '那个餐厅就在三楼的');
    r.settle('stop'); await tick();
    const p = r.settle('end'); await tick(); await p; await tick();
    const out = consumedIn(ev);
    eq(out, '那个餐厅就在三楼的', 'remainder 不丢（段 + 旧路尾巴）');
    eq(r.state().recs.length, 0, '结束后账本为空');
    r.dispose();
    eq(ev.filter((e) => e.t === 'leak').length, 0, 'dispose 无泄漏');
  });
  test('★ P2-1 停止后，在飞回复带回的 remainder 按 force 再送（不按普通空闲）', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const clk = clock(); const calls = [];
    const r = C.makeSegmentRouter({
      call: async (p) => {
        calls.push(p);
        if (calls.length === 1) { await gate; return JSON.stringify({ segments: [{ source: bufOf(p).slice(0, 4), translation: 'x' }], remainder: bufOf(p).slice(4) }); }
        return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'y' }], remainder: '' });
      },
      emit: () => {}, fallback: () => {}, ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    r.feed('zh-CN', '一共三千八百五十块');
    r.settle('switch'); await tick();     // 第一次送（在飞）
    r.settle('stop');                     // 收尾（stop）
    release(); await tick();
    eq(calls.length, 2, 'remainder 立即再送一次');
    ok(/true\s*$/.test(String(calls[1].user)), '这次是 force（不是普通空闲）');
    r.dispose();
  });
});

// ══ 第七轮：句头闸必须有确定去处 / 自动听 0.8s / 诊断带内容 ════════════════════
describe('R7 句头闸裁决', () => {
  function gclk() { let t = 1e6, seq = 1; const T = new Map(); return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; T.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearT: (id) => T.delete(id), size: () => T.size,
    async adv(ms) { const e = t + ms; for (;;) { let n = null; for (const [id, x] of T) if (x.at <= e && (!n || x.at < n.x.at)) n = { id, x }; if (!n) break; T.delete(n.id); t = Math.max(t, n.x.at); n.x.fn(); await Promise.resolve(); } t = e; await Promise.resolve(); },
  }; }
  const mkGate = (c, opts) => { const rel = []; const drops = []; const holds = []; const rels = [];
    const g = C.makeFinalGate({ dominantScript: SCRIPT, now: c.now, setTimeout: c.setT, clearTimeout: c.clearT, idleMs: C.SEG_IDLE_MS,
      anyOtherConflict: !!(opts && opts.anyOtherConflict),   // 变异钩子：任何另一门定稿都算冲突
      onRelease: (loc, t) => rel.push({ loc, t }), onDiag: (k, t, w) => {
        if (k === 'gate:drop') drops.push({ t, w });
        if (k === 'gate:release') rels.push({ t, w });
        if (k === 'gate:hold') holds.push(t);
      } });
    return { g, rel, drops, holds, rels }; };
  const confEn = (text, t0, t1) => ({ locale: 'en-US', text, conf: 0.1, t0, t1 });

  // 第九轮（方案 1）改判：低置信拉丁片**不再按 conf 直接丢**，而是「同时间段中文侧有没有
  // 已被入口接收且含汉字的定稿」——有 ⇒ 丢（cjk-overlap），没有 ⇒ 当场放行进账本。
  test('短低置信拉丁片 ⇒ 扣住；1.5s 无中文重叠 ⇒ 放行进账本（gate:release / idle）', async () => {
    const c = gclk(); const { g, rel, holds } = mkGate(c);
    deepEq(g.push(confEn('Yes.', 1000, 1600)), [], '短片先扣住');
    eq(holds.length, 1, '记 gate:hold');
    eq(g.heldLocales().length, 1);
    eq(rel.length, 0);
    await c.adv(1600);
    deepEq(rel, [{ loc: 'en-US', t: 'Yes.' }], '到点无重叠 ⇒ 放行');
    eq(g.heldLocales().length, 0, '闸里不残留');
  });
  test('低置信拉丁片与「已被接收含汉字」的中文时间重叠 ⇒ BM-025 落行（gate:release / cjk-overlap）', async () => {
    const c = gclk(); const { g, rel, drops, rels } = mkGate(c);
    deepEq(g.push(confEn('we', 1100, 1400)), [], '低置信短片先扣住');
    eq(g.heldLocales().length, 1);
    g.noteOtherText('zh-CN', '今天天气不错', 1100, 1800);
    deepEq(g.push(confEn('you', 1150, 1450)), [], '重叠 ⇒ 先落行扣住的片');
    ok(rels.some((x) => x.t === 'we' && x.w === 'cjk-overlap') || rel.some((r) => r.t === 'we'), 'we 应落行');
    eq(g.heldLocales().length, 0, '没有残留');
    await c.adv(2000);
    ok(rel.length >= 1, '不应静默丢字');
  });
  // 补正（2026-10-11 监督方）：短片与长片**共用同一套**重叠判定；中文侧被接收但**不含汉字**
  // 的定稿不算冲突（扣住的短片到点照常放行）。
  test('★ 补正：短片 + 中文侧「已接收但不含汉字」的定稿 ⇒ 到点放行（不算冲突）', async () => {
    const c = gclk(); const { g, rel, drops } = mkGate(c);
    deepEq(g.push(confEn('Sure.', 1000, 1300)), [], '短片扣住');
    g.noteOtherText('zh-CN', 'Yes, sure.', 1100, 1400);      // 另一门语言的**拉丁**定稿（已接收）
    eq(g.heldLocales().length, 1, '不含汉字 ⇒ 不冲突、仍扣住');
    await c.adv(1600);
    deepEq(rel, [{ loc: 'en-US', t: 'Sure.' }], '到点放行');
    eq(drops.filter((x) => x.w === 'cjk-overlap').length, 0, '不该记 cjk-overlap：' + JSON.stringify(drops));
  });
  test('★ 补正：短片 + 中文侧「已接收且含汉字」的重叠定稿 ⇒ BM-025 落行', async () => {
    const c = gclk(); const { g, rel, rels } = mkGate(c);
    deepEq(g.push(confEn('we', 1100, 1400)), [], '短片扣住');
    g.noteOtherText('zh-CN', '今天天气不错', 1100, 1800);     // 含汉字、时间重叠
    eq(g.heldLocales().length, 0, '当场裁决、不残留');
    ok(rels.some((x) => x.t === 'we' && x.w === 'cjk-overlap') || rel.some((r) => r.t === 'we'), 'we 落行');
    await c.adv(2000);
    ok(rel.length >= 1, '不应静默丢字');
  });
  test('★ 补正变异：把判定换回「任何另一门定稿都算冲突」⇒ 仍落行（BM-025）', async () => {
    const c = gclk(); const { g, rel } = mkGate(c, { anyOtherConflict: true });
    deepEq(g.push(confEn('Sure.', 1000, 1300)), [], '短片扣住');
    g.noteOtherText('zh-CN', 'Yes, sure.', 1100, 1400);      // 拉丁定稿：变异下被当成冲突
    eq(g.heldLocales().length, 0, '当场裁决');
    await c.adv(1600);
    ok(rel.length >= 1, 'BM-025：冲突也落行');
  });
  test('中文接收在时间上不重叠 ⇒ 低置信拉丁片到点仍放行', async () => {
    const c = gclk(); const { g, rel } = mkGate(c);
    g.noteOtherText('zh-CN', '今天天气不错', 5000, 6000);   // 不重叠
    deepEq(g.push(confEn('Sure.', 1000, 1300)), [], '短片扣住');
    await c.adv(1600);
    deepEq(rel, [{ loc: 'en-US', t: 'Sure.' }], '不重叠 ⇒ 到点放行');
  });
  test('不合格的中文重叠（拉丁垃圾 / 没被接收）不算数 ⇒ 仍放行', async () => {
    const c = gclk(); const { g, rel } = mkGate(c);
    g.noteOtherText('zh-CN', 'Rugua, Ting, Xing', 1000, 1300);   // 中文侧的拉丁垃圾：不含汉字 ⇒ 不记
    deepEq(g.push(confEn('Sure.', 1000, 1300)), [], '短片扣住');
    await c.adv(1600);
    deepEq(rel, [{ loc: 'en-US', t: 'Sure.' }], '拉丁垃圾不算重叠 ⇒ 到点放行');
  });
  test('flushAll（按住说停止/换边/结束）立即放行扣住的片；之后无残留', async () => {
    const c = gclk(); const { g, rel, holds } = mkGate(c);
    // 纯标点片会扣住（无字母 ⇒ 不能当场放行，否则实时框多出碎片）。用**非拉丁 locale** 制造
    // 一条不落 confLate 的片（拉丁 locale 的低置信片第九轮已当场放行）。
    deepEq(g.push({ locale: 'th-TH', text: '...', conf: 0.1, t0: 1000, t1: 1600 }), []);
    eq(holds.length, 1, '纯标点扣住（gate:hold）');
    eq(g.heldLocales().length, 1);
    g.flushAll();
    deepEq(rel, [], '纯标点在 settleHeld 里当 punct 丢掉 ⇒ 不调 onRelease');
    eq(g.heldLocales().length, 0);
    eq(c.size(), 0, '计时器清掉');
  });
  test('★ 随机序列：静置后闸里不得残留任何记录（变异：计时器不触发必须被抓到）', async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = gclk(); const { g } = mkGate(c);
      const rnd = mulberry32(seed);
      for (let i = 0; i < 30; i++) {
        const r = rnd();
        if (r < 0.5) g.push(confEn('word' + i, 1000 * i, 1000 * i + 400));
        else if (r < 0.65) g.noteOtherText('zh-CN', '今天天气不错', 1000 * i, 1000 * i + 400);   // 含汉字的已接收定稿
        else if (r < 0.8) g.flushAll();
        else await c.adv(100 + Math.floor(rnd() * 2000));
      }
      await c.adv(5000);
      eq(g.heldLocales().length, 0, 'seed ' + seed + '：静置后闸里有残留');
      eq(c.size(), 0, 'seed ' + seed + '：闸的计时器没清');
    }
    // 变异检查：把闸的计时器改成永不触发 ⇒ 上面的不变量必须能抓到。
    // 用**纯标点**（无字母）制造一条真正会扣住的片：低置信拉丁只要有字母，第九轮就会当场放行。
    const c2 = gclk(); const g2 = C.makeFinalGate({ dominantScript: SCRIPT, now: c2.now, setTimeout: () => 1, clearTimeout: () => {}, idleMs: C.SEG_IDLE_MS, onRelease: () => {}, onDiag: () => {} });
    g2.push({ locale: 'th-TH', text: '...', conf: 0.1, t0: 0, t1: 100 });   // 无字母 + 非拉丁 ⇒ 扣住
    await c2.adv(5000);
    ok(g2.heldLocales().length === 1, '变异（计时器不触发）下闸里确实残留 —— 说明上面那条不变量抓得到');
  });
});

describe('R8 方案 2 — 所有丢弃分支都留痕 / 缺时间戳放行', () => {
  function gclk() { let t = 1e6, seq = 1; const T = new Map(); return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; T.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearT: (id) => T.delete(id), size: () => T.size,
    async adv(ms) { const e = t + ms; for (;;) { let n = null; for (const [id, x] of T) if (x.at <= e && (!n || x.at < n.x.at)) n = { id, x }; if (!n) break; T.delete(n.id); t = Math.max(t, n.x.at); n.x.fn(); await Promise.resolve(); } t = e; await Promise.resolve(); },
  }; }
  function mkGate(c) { const rel = [], drops = [], holds = [], rels = [];
    const g = C.makeFinalGate({ dominantScript: SCRIPT, now: c.now, setTimeout: c.setT, clearTimeout: c.clearT, idleMs: C.SEG_IDLE_MS,
      onRelease: (loc, t) => rel.push({ loc, t }),
      onDiag: (k, t, w) => { if (k === 'gate:drop') drops.push({ t, w }); if (k === 'gate:hold') holds.push(t); if (k === 'gate:release') rels.push({ t, w }); } });
    return { g, rel, drops, holds, rels }; }
  const conf = (text, conf, t0, t1) => ({ locale: 'en-US', text, conf, t0, t1 });

  test('缺 t0/t1（NaN）的低置信片 ⇒ 放行（gate:release / why=no-ts），不静默丢', async () => {
    const c = gclk(); const { g, rel, rels } = mkGate(c);
    deepEq(g.push(conf('Yes.', 0.1, NaN, NaN)), ['Yes.'], '缺时间戳应被放行而不是丢掉');
    ok(rels.some((x) => x.t === 'Yes.' && x.w === 'no-ts'), '没有记 gate:release / no-ts：' + JSON.stringify(rels));
    eq(g.heldLocales().length, 0, '放行后不残留');
    // 缺字段（undefined）同样按 no-ts 放行
    deepEq(g.push({ locale: 'en-US', text: 'Sure.', conf: 0.05 }), ['Sure.']);
    eq(rel.length, 0, '放行走 push 返回，不触发 onRelease（onRelease 只给扣住后到点/强制）');
  });
  test('★ 长的低置信拉丁片：无中文重叠 ⇒ 放行（不再按 conf 丢）', () => {
    const c = gclk(); const { g, rels } = mkGate(c);
    deepEq(g.push(conf('Rugua, Ting, Xing, Cho,', 0.27, 0, 1200)), ['Rugua, Ting, Xing, Cho,'], '长片也按重叠裁决 ⇒ 放行');
    ok(rels.some((x) => x.w === 'latin-no-cjk'), '记 gate:release / latin-no-cjk：' + JSON.stringify(rels));
    eq(g.heldLocales().length, 0, '长片不扣住');
  });
  test('★ 长的低置信拉丁片 + 同时间段已被接收的中文 ⇒ BM-025 落行并记 cjk-overlap', () => {
    const c = gclk(); const { g, rels } = mkGate(c);
    g.noteOtherText('zh-CN', '这是中文', 0, 1200);
    deepEq(g.push(conf('Rugua, Ting, Xing, Cho,', 0.27, 0, 1200)), []);
    ok(rels.some((x) => x.t === 'Rugua, Ting, Xing, Cho,' && x.w === 'cjk-overlap'), '记 gate:release/cjk-overlap：' + JSON.stringify(rels));
  });
  test('纯标点片：无字母 ⇒ 先扣住；到点丢弃并记 gate:drop（reason=punct）', async () => {
    const c = gclk(); const { g, drops, holds } = mkGate(c);
    deepEq(g.push({ locale: 'th-TH', text: '...', conf: 0.1, t0: 1000, t1: 1600 }), []);
    eq(holds.length, 1, '先扣住');
    eq(g.heldLocales().length, 1);
    await c.adv(2000);
    ok(drops.some((x) => x.w === 'punct'), '纯标点丢弃没有留痕：' + JSON.stringify(drops));
  });
});

describe('R8 方案 4 — 闸放行后不再等第二次空闲', () => {
  test('waited=true 的片：当场送模型、结果回来即出行（不预送扣住）', async () => {
    const clk = clock(); const ev = []; const calls = [];
    const r = C.makeSegmentRouter({ call: (p) => { calls.push(p); return new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 100)); },
      emit: (rows, meta) => ev.push({ at: clk.now(), orig: meta.orig }), fallback: () => {}, ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, releaseMs: 800 });
    r.feed('en-US', 'Yes.', { waited: true });
    await tick();
    eq(calls.length, 1, '闸放行后应当立刻送模型（闸里已等过 1.5s 空闲）');
    await clk.advance(200); await tick();
    eq(ev.length, 1, '结果回来即出行 —— 不再等第二次空闲（0.8s）');
    r.dispose();
    // 对照：普通 feed（没在闸里等过）仍要走「预送 + 第二次空闲」
    const clk2 = clock(); const ev2 = [];
    const r2 = C.makeSegmentRouter({ call: (p) => new Promise((res) => clk2.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 100)),
      emit: (rows, meta) => ev2.push({ at: clk2.now(), orig: meta.orig }), fallback: () => {}, ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk2.now, setTimeout: clk2.setT, clearTimeout: clk2.clearT, idleMs: 1500, releaseMs: 800 });
    r2.feed('en-US', 'Yes.');
    await clk2.advance(1000); await tick();
    eq(ev2.length, 0, '普通 feed：1s 时还没出行（要等第一次空闲 1.5s 预送）');
    r2.dispose();
  });
});

describe('R7 自动听 0.8s / 按住说 1.5s', () => {
  test('自动听：第二次空闲 0.8s 出行；旧按住说（setHold）：仍是 1.5s', async () => {
    const mk = (ptt, hold) => { const clk = clock(); const ev = [];
      const r = C.makeSegmentRouter({ call: (p) => new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 100)),
        emit: (rows, meta) => ev.push({ at: clk.now(), orig: meta.orig }), fallback: () => {}, ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
        now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, releaseMs: 800 });
      r.setPtt(ptt); r.setHold(hold); return { r, clk, ev }; };
    // 自动听：喂非短碎片 → 第一次空闲(1.5s)预送 → 第二次空闲(0.8s)出行 ⇒ 总约 2.3s
    const a = mk(false, false);
    a.r.feed('zh-CN', '你好你好吗');   // 5 字 ⇒ 非「≤2 词短片」，走预送扣住（方案 5 改：≤2 词片空闲直接 force）
    await a.clk.advance(1600); await tick();
    eq(a.ev.length, 0, '预送期不出行');
    await a.clk.advance(900); await tick();
    eq(a.ev.length, 1, '自动听：第二次空闲 0.8s 后出行');
    // 旧按住说（setHold(true)）：同样时序下 0.9s 还不出行（要 1.5s）
    const b = mk(true, true);
    b.r.feed('zh-CN', '你好你好吗');
    await b.clk.advance(1600); await tick();
    await b.clk.advance(900); await tick();
    eq(b.ev.length, 0, '按住说：0.9s 还没到（1.5s 参数）');
    await b.clk.advance(700); await tick();
    eq(b.ev.length, 1, '按住说：1.5s 后出行');
    // ★ 方案 1 的解耦：setPtt(true)（按键收音接线点）**不得**把第二次空闲改成 1.5s。
    const c = mk(true, false);
    eq(c.r.state().ptt, true, 'setPtt(true) 必须反映在 state().ptt（方案 1 的接线可观测点）');
    c.r.feed('zh-CN', '你好你好吗');
    await c.clk.advance(1600); await tick();
    await c.clk.advance(900); await tick();
    eq(c.ev.length, 1, 'setPtt(true) + 自动听参数：第二次空闲仍 0.8s（接线后不得变慢）');
  });
});

describe('R7 remainder-mismatch 诊断带内容', () => {
  test('带上识别原文 / 模型 remainder / 原始回复（各 ≤200 字）', async () => {
    const clk = clock(); const fails = [];
    const raw = JSON.stringify({ segments: [{ source: '一共三千八百五十块钱，刷卡还是付款呢？', translation: 'total 3850' }], remainder: '不存在的尾巴' });
    const r = C.makeSegmentRouter({ call: async () => raw, emit: () => {}, fallback: () => {},
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
      onFail: (reason, extra) => fails.push({ reason, extra }) });
    r.feed('zh-CN', '一共三千八百五十块钱，刷卡还是付款呢？');
    await clk.advance(1600); await tick();
    const m = fails.find((x) => x.reason === 'remainder-mismatch');
    ok(m, '记了 remainder-mismatch');
    eq(m.extra.text, '一共三千八百五十块钱，刷卡还是付款呢？', '带识别原文');
    eq(m.extra.rem, '不存在的尾巴', '带模型 remainder');
    ok(m.extra.raw.indexOf('不存在的尾巴') >= 0, '带原始回复');
    for (const k of ['text', 'rem', 'raw']) ok(String(m.extra[k]).length <= 200, k + ' ≤200');
    r.dispose();
  });
});

// ══ 第六轮：出行回调报错不再卡死 + 判定有效性（变异检查）════════════════════
describe('R6 出行回调报错 / 判定有效性', () => {
  test('★ 出行回调报错一次后，后面的话照常出行（A1：先定状态再通知，每条 try/catch）', async () => {
    const clk = clock(); const ev = []; let thrown = false;
    const r = C.makeSegmentRouter({
      call: (p) => new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 500)),
      emit: (rows, meta) => {
        if (!thrown) { thrown = true; throw new Error('界面层出行报错（模拟 addFinal/朗读/字幕）'); }
        ev.push(meta.orig);
      },
      fallback: (t) => ev.push(t), onNotifyError: () => { /* 记诊断 */ },
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    r.feed('zh-CN', '第一句话在这里。');
    await tick(); await clk.advance(1600); await tick();
    r.feed('zh-CN', '第二句话在这里。');
    await tick(); await clk.advance(1600); await tick();
    r.feed('en-US', 'and this is the third one.');
    await tick(); await clk.advance(1600); await tick();
    await clk.advance(800); await tick();   // 让边界上的回复落地
    const joined = norm(ev.join(''));
    ok(joined.indexOf('第二句话在这里') >= 0 && joined.indexOf('third') >= 0, '第一次报错后，后两句照常出行（实际 ' + JSON.stringify(ev) + '）');
    eq(r.state().recs.length, 0, '账本清空、路由器没卡在「请求在飞」');
    ok(!r.state().busy, '没有请求卡在在飞状态');
    r.dispose();
  });
  test('★ 判定有效性：顺序判定能抓到「remainder 插到账本末尾」（变异）', () => {
    // 正常：remainder 继承原位置 ⇒ 位置不回退
    const seq = [{ pos: 1 }, { pos: 2 }, { pos: 2 }, { pos: 3 }];
    eq(orderViol(seq).length, 0, '正常序列 0 违例');
    // 变异：remainder 被插到账本末尾（位置跳到最后）⇒ 出行顺序回退，必须被抓到
    const mutated = [{ pos: 1 }, { pos: 3 }, { pos: 2 }];
    ok(orderViol(mutated).length >= 1, '位置回退必须被抓到');
  });
  test('★ 判定有效性：守恒判定能抓到「少算一个已用掉的字」（变异）', () => {
    const fed = '一二三四五六七八';
    eq(conservationViol(fed, '一二三四五六七八', '').length, 0, '正常 0 违例');
    ok(conservationViol(fed, '一二三六七八', '').length >= 1, '少算一个字（丢字）必须被抓到');
    ok(conservationViol(fed, '一二三四五六七八', '九').length >= 1, '多出一段（重复）必须被抓到');
  });
});

// ══ 第五轮复现固定用例（/tmp/r3repro/repro5.js 的 H1/H2/H4 转写）══════════════
describe('R5 复现 — 预送扣住的调度', () => {
  test('★ H1 预送期间接着说下一句 ⇒ 扣住的结果作废，两段并成一行', async () => {
    const clk = clock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: (p) => new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 900)),
      emit: (rows, meta) => ev.push({ t: 'emit', orig: meta.orig, rows }), fallback: (t) => ev.push({ t: 'fb', t }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    r.feed('en-US', 'The total is');
    await clk.advance(1700);            // 第一次空闲：预送并扣住
    r.feed('en-US', 'or mobile payment?');
    await clk.advance(8000);
    const emits = ev.filter((e) => e.t === 'emit');
    eq(emits.length, 1, '只出一行（碎片不单独成行）');
    eq(emits[0].orig, 'The total is or mobile payment?', '两段并成一行');
    r.dispose();
  });
  test('★ H2 预送期间开始朗读 ⇒ 短句仍出行（扣住结果的出行不受朗读影响）', async () => {
    const clk = clock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: (p) => new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 900)),
      emit: (rows, meta) => ev.push({ t: 'emit', at: clk.now(), orig: meta.orig }), fallback: () => {},
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    const base = clk.now();
    r.feed('zh-CN', '好的');
    await clk.advance(1600);            // 预送
    r.setSpeaking(true);
    await clk.advance(3000);            // 朗读 3 秒（会跨过出行时点）
    r.setSpeaking(false);
    await clk.advance(20000);
    const emits = ev.filter((e) => e.t === 'emit');
    eq(emits.length, 1, '朗读期间也出了行（不会永远卡住）');
    ok(emits[0].at - base <= 1600 + 1500 + 1, '出行时点 = 预送 + 空闲（不受朗读影响）：rel=' + (emits[0].at - base));
    r.dispose();
  });
  test('★ H4 朗读期间另一门语言到长度线 ⇒ 照常送（长度触发不受朗读影响；上屏仍按序）', async () => {
    const clk = clock(); const ev = []; const calls = [];
    const r = C.makeSegmentRouter({
      call: (p) => { calls.push(bufOf(p)); return new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 900)); },
      emit: (rows, meta) => ev.push({ t: 'emit', at: clk.now(), locale: meta.locale, orig: meta.orig }), fallback: () => {},
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    r.feed('zh-CN', '我们明天在车站见面吧');   // 中文短句（空闲计时被朗读暂停）
    r.setSpeaking(true);
    await clk.advance(100);
    r.feed('en-US', 'okay so I will bring the documents and the two contracts we talked about yesterday and also the receipts and the signed invoice please');
    await tick();
    await clk.advance(6000);
    eq(calls.length, 1, '朗读期间英文长句已发送（长度触发不受朗读影响）');
    eq(ev.length, 0, '上屏仍按序：前面那条中文还没出行，英文先扣着');
    r.setSpeaking(false);
    await tick();                        // 让取消朗读后的发送微任务落地
    await clk.advance(3000);
    eq(ev.length, 2, '朗读结束后两条都出行');
    eq(ev[0].locale, 'zh-CN', '顺序 = 说话顺序（中文在前）');
    eq(ev[1].locale, 'en-US', '英文在后');
    r.dispose();
  });
});

// ══ 补回的 4 条固定用例（第四轮只剩模糊覆盖）══════════════════════════════════
describe('R4/R5 固定用例（补回）', () => {
  test('401 降级：账本全部交给旧路（不丢）', async () => {
    const e = new Error('unauthorized'); e.status = 401;
    const { r, ev } = router([e, e, e, e]);
    r.feed('zh-CN', '帮我把这份合同复印三份'); r.feed('en-US', 'Please make three copies');
    r.settle('switch'); await tick();
    await tick();
    ok(ev.some((x) => x.t === 'degrade'), '降级');
    eq(falls(ev).join(''), '帮我把这份合同复印三份Please make three copies', '两路都交旧路');
    eq(r.pending('zh-CN') + r.pending('en-US'), '', '账本清空');
    r.dispose();
    eq(ev.filter((x) => x.t === 'leak').length, 0, '无泄漏');
  });
  test('一直失败：碎片在有限次数内交给旧路（每字 ≤3 次调用）', async () => {
    const { r, clk, ev, calls } = router([new Error('t'), new Error('t'), new Error('t'), new Error('t')]);
    r.feed('zh-CN', '你好');
    for (let i = 0; i < 10; i++) { await clk.advance(1700); r.settle('stop'); await tick(); }
    ok(calls.length <= 3, '同一批字最多 3 次调用（实际 ' + calls.length + '）');
    ok(falls(ev).join('').indexOf('你好') >= 0, '旧路出行');
    eq(r.pending('zh-CN'), '', '账本清空');
    r.dispose();
  });
  test('请求中途结束：等 ≤3s，超时把原文交旧路、迟到回复作废', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const clk = clock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: async (p) => { await gate; return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'x' }], remainder: '' }); },
      emit: (rows, meta) => ev.push({ t: 'emit' }), fallback: (t) => ev.push({ t: 'fb', text: t }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, endWaitMs: 3000,
    });
    r.feed('zh-CN', '在飞的一段话'); r.settle('stop'); await tick();
    const p = r.settle('end');
    await clk.advance(3100); await tick(); await p; release(); await tick();
    ok(ev.some((e) => e.t === 'fb' && e.text === '在飞的一段话'), '超时交旧路');
    eq(ev.filter((e) => e.t === 'emit').length, 0, '迟到回复不出行');
    r.dispose();
    eq(ev.filter((e) => e.t === 'leak').length, 0, '无泄漏');
  });
  test('请求中途实时框不为空（含在飞那段）', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const clk = clock();
    const r = C.makeSegmentRouter({
      call: async () => { await gate; return JSON.stringify({ segments: [], remainder: '' }); },
      emit: () => {}, fallback: () => {}, ctx: () => ({ userTmpl: 'BUF:\n{buffer}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    r.feed('zh-CN', '这段正在请求中');
    r.settle('switch'); await tick();
    eq(r.pending('zh-CN'), '这段正在请求中', '在飞期间实时框有字');
    release(); await tick(); r.dispose();
  });
});

// ══ 第三轮复现（保留）════════════════════════════════════════════════════════
describe('R3 复现 — 短句 / 碎片 / 合并', () => {
  test('带标点的完整短句 1.5 秒出行；无标点短尾巴多等一次后强制收尾', async () => {
    for (const s of ['好的。', 'Yes.']) {
      const { r, clk, calls } = router();
      r.feed('zh-CN', s);
      await clk.advance(1600); await tick();
      eq(calls.length, 1, s + '：1.5s 内应出行');
    }
    const { r, clk, calls } = router([null, null]);   // 预送 + 释放各一次
    r.feed('zh-CN', '谢谢你');
    await clk.advance(1600); await tick();
    await clk.advance(1600); await tick();
    ok(calls.length >= 1, '碎片最终出行');
  });
  test('模型给碎片补句号仍被并入后一段、且不带句号', async () => {
    const { r, ev } = router([{ segments: [
      { source: 'The total is.', translation: '总计是。' },
      { source: 'or mobile payment?', translation: '还是移动支付？' },
    ], remainder: '' }]);
    r.feed('en-US', 'The total is.or mobile payment?');
    r.settle('switch'); await tick();
    const rows = emits(ev).map((x) => x.source);
    eq(rows.length, 1, '并成一行');
    ok(rows[0].indexOf('The total is or mobile payment?') === 0, '不带模型补的句号：' + JSON.stringify(rows[0]));
  });
});

// ══ 两条路同一套闸 ═══════════════════════════════════════════════════════════
describe('回声 / 归属闸（两条路共用 intakeDecide）', () => {
  const mk = (over) => Object.assign({ base: 'en', lid: 'en', pttSwitch: null, now: 1000, playing: new Set(['zh']), text: 'hello world', isEcho: () => false }, over);
  test('回声文本相似度：同一输入在两条路都是 drop（同一函数）', () => {
    const o = mk({ isEcho: () => true });
    deepEq(C.intakeDecide(o), C.intakeDecide(o), '同一函数 = 同一套闸');
    eq(C.intakeDecide(o).reason, 'echo');
  });
  test('朗读期间只丢正在朗读的那门；另一门插话照收', () => {
    eq(C.intakeDecide(mk({ base: 'zh', playing: new Set(['zh']) })).reason, 'speaking');
    eq(C.intakeDecide(mk({ base: 'en', playing: new Set(['zh']) })).admit, true);
  });
  test('换边宽限收口片 force=true；LID 没稳/第三门 ⇒ drop', () => {
    const d = C.intakeDecide(mk({ base: 'en', lid: 'zh', pttSwitch: { from: 'en', at: 1000, used: false }, now: 1200 }));
    eq(d.force, true); eq(d.markUsed, true);
    eq(C.intakeDecide(mk({ lid: '' })).reason, 'attrib');
    eq(C.intakeDecide(mk({ lid: 'fr' })).reason, 'attrib');
  });
});

describe('路由与旧路回归', () => {
  test('真实注册表：google / qwen_mt / custom+qwen-mt ⇒ legacy；grant / deepseek ⇒ model', () => {
    eq(routeFor('google'), 'legacy');
    eq(routeFor('qwen_mt'), 'legacy');
    eq(routeFor('custom_chat', 'qwen-mt-plus'), 'legacy');
    eq(routeFor('grant'), 'model');
    eq(routeFor('deepseek'), 'model');
  });
  test('旧路串句器仍按句末标点切分', () => {
    const out = []; const cut = C.makeStreamCutter((l, s) => out.push(s));
    cut.add('en-US', 'First sentence. Second sentence.'); cut.flushAll();
    deepEq(out, ['First sentence.', 'Second sentence.']);
  });
});

// ══ 模糊不变量测试（第四轮补强）════════════════════════════════════════════════
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CJK = '一二三四五六七八九十你好吗这个是合同复印三份五点半之前送到办公室请您帮忙一共三千八百五十块钱';
const EN = 'the total is or mobile payment please make three copies of this contract and send them to Mr Zhang office before five pm we are meeting at People Square tomorrow afternoon bring laptop'.split(' ');
function rndText(rnd, maxLen, lc) {
  if (lc === 'en-US') {   // 真英文：按词计（长度线/碎片规则都按词走）
    const n = 1 + Math.floor(rnd() * maxLen);
    let s = '';
    for (let i = 0; i < n; i++) s += (i ? ' ' : '') + EN[Math.floor(rnd() * EN.length)];
    return s;
  }
  const n = 1 + Math.floor(rnd() * maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += CJK[Math.floor(rnd() * CJK.length)];
  return s;
}
const micro = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const norm = (x) => String(x || '').replace(/\s+/g, '');   // 比较忽略空白（join 规则不属于被测语义）
// 顺序判定（纯）：只看**说话位置**，不许回退。返回违例清单（不抛）。
const orderViol = (seq) => { const out = []; let last = -1; for (const it of seq) { if (it.pos < last) out.push('pos ' + it.pos + ' < ' + last); last = it.pos; } return out; };
// 守恒判定（纯）：已出行 + 未出行 == 全部进账本的原文（忽略空白）。
const conservationViol = (fed, cons, pending) => { const f = norm(fed), c = norm(cons), p = norm(pending); return c + p === f ? [] : ['fed ' + f.length + ' vs cons+pending ' + (c.length + p.length)]; };
function runFuzz(seed) {
  const rnd = mulberry32(seed);
  const clk = clock();
  const fed = { 'zh-CN': '', 'en-US': '' };
  const consumed = [];   // { locale, text }，按上屏顺序
  const consText = { 'zh-CN': '', 'en-US': '' };
  let maxCallsSeen = 0, leaks = 0, degrade = 0, degraded = false, lastPos = -1, lastHold = null;
  const viol = [];
  const r = C.makeSegmentRouter({
    call: async (p, info) => {
      const b = bufOf(p); const lc = b === '' ? '' : (/[\u4e00-\u9fff]/.test(b) ? 'zh-CN' : 'en-US');
      if (info && info.hold) lastHold = { lc, buffer: b };
      const delay = Math.floor(rnd() * 4000);       // 0–4 秒随机延迟（会盖过 3 秒结束等待）
      if (delay) await new Promise((res) => clk.setT(res, delay));
      const roll = rnd();
      if (roll < 0.01) { const e = new Error('auth'); e.status = 401; throw e; }
      if (roll < 0.06) throw new Error('timeout');
      if (roll < 0.12) return 'not json';
      if (roll < 0.30 && b.length > 1) {             // 只给一段 + 合法后缀 remainder
        const cut = Math.max(1, Math.min(3, b.length - 1));
        return JSON.stringify({ segments: [{ source: b.slice(0, b.length - cut), translation: 'T' }], remainder: b.slice(b.length - cut) });
      }
      return JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' });
    },
    emit: (list, meta) => {
      // 顺序只看**说话位置**（pos；remainder 继承原记录的位置）：不许回退。**违例只记录，不抛。**
      if (meta.pos < lastPos) viol.push('上屏顺序乱：pos ' + meta.pos + ' < ' + lastPos + '（' + meta.locale + '）');
      lastPos = meta.pos;
      // 行界（H1 形态）：预送（hold）的那段若期间又来了同语言新字，不许拿旧前缀单独成行
      if (C.segIsFragment(meta.orig || '') && lastHold && lastHold.lc === meta.locale) {
        const f = norm(fed[meta.locale]), c = norm(consText[meta.locale]);
        if (f.length > c.length && norm(lastHold.buffer).indexOf(norm(meta.orig)) === 0) viol.push('预送碎片单独成行：' + JSON.stringify(meta.orig));
      }
      lastHold = null;
      consText[meta.locale] = C.joinFrag(consText[meta.locale], meta.orig);
      consumed.push({ locale: meta.locale, text: meta.orig, pos: meta.pos });
    },
    fallback: (text, meta) => { consText[meta.locale] = C.joinFrag(consText[meta.locale], text); consumed.push({ locale: meta.locale, text }); },
    onDegrade: () => { degrade++; degraded = true; },
    onLeak: () => { leaks++; },
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
  });
  return (async () => {
    const steps = 30 + Math.floor(rnd() * 40);
    let ended = false;
    for (let i = 0; i < steps && !ended; i++) {
      const roll = rnd();
      if (roll < 0.40) {
        if (degraded) continue;                    // 降级后调用方已切旧路（不再喂路由器）
        const lc = rnd() < 0.55 ? 'zh-CN' : 'en-US';
        const t = rndText(rnd, 4, lc);
        fed[lc] = C.joinFrag(fed[lc], t); r.feed(lc, t);
      } else if (roll < 0.68) {
        await clk.advance(150 + Math.floor(rnd() * 2500));
      } else if (roll < 0.78) {
        r.setSpeaking(rnd() < 0.5);
      } else if (roll < 0.86) {
        r.settle('stop');
      } else if (roll < 0.93) {
        r.settle('switch');
      } else {
        const pe = r.settle('end');                // 中途结束（之后不再 feed）
        await clk.advance(3600); await micro(); await pe;
        ended = true;
      }
      await micro();
      for (const rec of r.state().recs) maxCallsSeen = Math.max(maxCallsSeen, rec.calls);
      // 不变量：实时框 = 该语言未上屏原文；上屏顺序 = 说话顺序（逐字前缀比较）
      for (const lc of ['zh-CN', 'en-US']) {
        const f = norm(fed[lc]), c = norm(consText[lc]), p = norm(r.pending(lc));
        if (p !== f.slice(c.length)) viol.push(lc + ' step ' + i + ' 实时框 ≠ 未上屏原文（pending=' + JSON.stringify(p) + '）');
        if (maxCallsSeen > 3) viol.push('rec.calls=' + maxCallsSeen + ' > 3');
      }
    }
    // 活性：停止喂入 / 关朗读，静置足够时间 ⇒ 账本必须**自己**清空（不能靠 settle('end') 收走）
    if (!degraded) {
      r.setSpeaking(false);
      await clk.advance(12000); await micro();
      for (const lc of ['zh-CN', 'en-US']) {
        const f = norm(fed[lc]), c = norm(consText[lc]), p = norm(r.pending(lc));
        if (p !== f.slice(c.length)) viol.push('静置后 ' + lc + ' 还有卡住的文字 ' + JSON.stringify(p));
      }
      if (r.state().recs.length && !r.state().busy) viol.push('静置后账本没清空（' + r.state().recs.length + ' 条）');
    }
    const pe2 = r.settle('end');
    await clk.advance(3600); await micro(); await pe2;
    const snap = consumed.length;
    await clk.advance(1000); await micro();
    const afterEnd = consumed.length - snap;
    const lefRecs = r.state().recs.length;
    const timers = clk.size();
    r.dispose();
    // closing 之后账本必须为空、onLeak = 0、结束后不再出行
    for (const lc of ['zh-CN', 'en-US']) {
      const f = norm(fed[lc]), c = norm(consText[lc]);
      if (c !== f) {
        let k = 0; while (k < f.length && f[k] === c[k]) k++;
        viol.push('不守恒 ' + lc + '：fed ' + f.length + ' vs consumed ' + c.length + '（首个不同在第 ' + k + ' 字）');
      }
    }
    return { seed, lefRecs, leaks, afterEnd, timers, degrade, maxCallsSeen, viol };
  })();
}
describe('模糊不变量（随机事件序列 · 0–4s 延迟 · 双语言 · 中途收尾）', () => {
  test('★ 1000 条序列：守恒 / 顺序 / ≤3 次调用 / 结束后账本空 + 无泄漏 + 不再出行', async () => {
    let n = 0, leaks = 0, degrades = 0, maxCalls = 0, afterEnd = 0;
    const bad = [];
    let checks = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const res = await runFuzz(seed);
      n++; leaks += res.leaks; degrades += res.degrade; maxCalls = Math.max(maxCalls, res.maxCallsSeen); afterEnd += res.afterEnd; checks += 1;
      if (res.lefRecs !== 0) bad.push('seed ' + seed + '：结束后账本还有 ' + res.lefRecs + ' 条');
      if (res.leaks !== 0) bad.push('seed ' + seed + '：onLeak ' + res.leaks);
      if (res.afterEnd !== 0) bad.push('seed ' + seed + '：结束后又出行 ' + res.afterEnd);
      if (res.timers !== 0) bad.push('seed ' + seed + '：残留计时器 ' + res.timers);
      if (res.viol.length) bad.push('seed ' + seed + '：' + res.viol.slice(0, 2).join('；'));
    }
    eq(bad.length, 0, bad.slice(0, 6).join(' \n'));
    ok(n === 1000, '跑了 ' + n + ' 条序列');
    ok(maxCalls <= 3, '单条记录最多调用 ' + maxCalls + ' 次');
  });
});

// ══ 第八轮：闸放行 → 账本 → 出行 的守恒/顺序（覆盖放行路径）════════════════
function runGateFuzz(seed, mut) {
  const rnd = mulberry32(seed);
  const clk = clock();
  const expected = { 'zh-CN': '', 'en-US': '' };
  const cons = { 'zh-CN': '', 'en-US': '' };
  const seq = [];       // 按喂入顺序
  const outSeq = [];    // 按出行顺序
  const baseOf = (l) => (String(l).indexOf('zh') === 0 ? 'zh-CN' : 'en-US');
  let posLast = -1;
  const viol = [];
  const feedRouter = (lc, t, waited) => {
    expected[lc] = C.joinFrag(expected[lc], t);
    seq.push(lc + '|' + norm(t));
    r.feed(lc, t, waited ? { waited: true } : {});
  };
  const gate = C.makeFinalGate({ dominantScript: SCRIPT, now: clk.now,
    setTimeout: mut ? (() => 1) : clk.setT, clearTimeout: mut ? (() => {}) : clk.clearT,
    idleMs: C.SEG_IDLE_MS,
    onRelease: (loc, t) => feedRouter(baseOf(loc), t, true), onDiag: () => {} });
  const r = C.makeSegmentRouter({
    call: (p) => new Promise((res) => clk.setT(() => res(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })), 30 + Math.floor(rnd() * 300))),
    emit: (rows, meta) => {
      if (meta.pos < posLast) viol.push('顺序回退 pos ' + meta.pos);
      posLast = meta.pos;
      cons[meta.locale] = C.joinFrag(cons[meta.locale], meta.orig); outSeq.push(meta.locale + '|' + norm(meta.orig));
    },
    fallback: (t, meta) => { const lc = baseOf(meta && meta.locale); cons[lc] = C.joinFrag(cons[lc], t); outSeq.push(lc + '|' + norm(t)); },
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
  });
  return (async () => {
    const words = ['yes', 'sure', 'okay', 'please', 'thanks', 'no', 'maybe', 'right'];
    const cjk = ['好的', '谢谢', '是', '对', '行'];
    const steps = 20 + Math.floor(rnd() * 25);
    for (let i = 0; i < steps; i++) {
      const roll = rnd();
      if (roll < 0.62) {
        const lc = rnd() < 0.5 ? 'zh-CN' : 'en-US';
        const low = rnd() < 0.5;
        // 三分之一是**文字系不符**的片（en 路吐汉字 / zh 路吐拉丁）：它们不进 confLate 的
        // 当场放行支路，会真正**扣住** —— 这样「闸永不放行」的变异才有东西可残留。
        const mismatch = rnd() < 0.33;
        const text = mismatch
          ? (lc === 'en-US' ? cjk[Math.floor(rnd() * cjk.length)] : words[Math.floor(rnd() * words.length)])
          : (lc === 'en-US'
            ? words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? '.' : '')
            : cjk[Math.floor(rnd() * cjk.length)] + (rnd() < 0.3 ? '。' : ''));
        const b = clk.now();
        const t1 = b + 200 + Math.floor(rnd() * 1000);
        const outs = gate.push({ locale: lc, text, conf: low ? 0.1 : 0.9, t0: b, t1 });
        // 入口接收了这条定稿（与生产 listen-model 的接线同序）：告诉闸「这条已进账本」。
        // 第九轮：只有含汉字的才记进重叠表 —— 低置信拉丁片的丢弃判据就靠它。
        if (outs.length) gate.noteOtherText(lc, text, b, t1);
        for (const o of outs) feedRouter(lc, o, false);
      } else if (roll < 0.88) {
        await clk.advance(100 + Math.floor(rnd() * 2200));
      } else {
        r.settle(rnd() < 0.5 ? 'stop' : 'switch');
      }
      await micro();
    }
    // 静置：闸扣住的必须全部放行（方案 4：放行后直接送）
    await clk.advance(9000); await micro();
    const heldLeft = gate.heldLocales().length;
    const pe = r.settle('end'); await clk.advance(3600); await micro(); await pe;
    await clk.advance(500); await micro();
    for (const lc of ['zh-CN', 'en-US']) {
      const f = norm(expected[lc]), c = norm(cons[lc]), p = norm(r.pending(lc));
      if (c + p !== f) viol.push('不守恒 ' + lc + '：expect ' + f.length + ' vs consumed+pending ' + (c.length + p.length));
    }
    const timers = clk.size();
    r.dispose();
    return { seed, heldLeft, viol, timers, fed: seq.length, out: outSeq.length };
  })();
}
describe('R8 闸放行 → 账本 → 出行（覆盖放行路径 · 1000 条）', () => {
  test('★ 守恒/顺序/闸无残留；变异：闸永不放行必须被抓到', async () => {
    const bad = [];
    for (let seed = 1; seed <= 1000; seed++) {
      const res = await runGateFuzz(seed, false);
      if (res.heldLeft !== 0) bad.push('seed ' + seed + '：静置后闸里残留 ' + res.heldLeft);
      if (res.timers !== 0) bad.push('seed ' + seed + '：残留计时器 ' + res.timers);
      if (res.viol.length) bad.push('seed ' + seed + '：' + res.viol.slice(0, 2).join('；'));
    }
    eq(bad.length, 0, bad.slice(0, 6).join(' \n'));
    // 变异检查：闸永不放行（计时器不触发）⇒ 序列必须报 heldLeft > 0
    let caught = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const res = await runGateFuzz(seed, true);
      if (res.heldLeft > 0) caught++;
    }
    ok(caught >= 1, '变异（闸永不放行）下没有任何序列报残留 —— 说明这条不变量抓不到');
  });
});
