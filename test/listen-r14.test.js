// test/listen-r14.test.js — 第十四轮（文字对齐让位 · 中文路候补转交 · 漂移门顺序）的验收。
//
// 覆盖：
//   ① 纯函数：对齐（数字=数词、长词 1 字母差、带数字的词不模糊）、标点开头句首补回、dup-prev 判据、
//      转交候补判据 / 标点清洗；
//   ② 路由器：临时稿按文字对齐让位（rescue:trim）、对不上两条都留（rescue:nomatch）、
//      两条正式 final 永不去重、已出行临时稿按文字只追加、dup-prev；
//   ③ 句头闸：heldJoin 拼接前做 dup-prev（Yes please 第 10 次形态）；
//   ④ parseSegReply 漂移门：先切与上一条已出行行重复的前缀、再算比例；与上一行无关的扩张照常拦；
//   ⑤ 回放 /tmp/r13 原始事件（fixtures/r14-replay.json，逐事件 partial/final）：
//      英文长句第 4/7/9 次无重复且覆盖全部正式 final、Yes please 第 10 次不多一行、
//      英文长句第 2/10 次句首补回、Yes 第 6/8/9 次与点停第 1 次转交出行、Yes 第 7 次不多一行、
//      英文长句第 1 次模型补回整句时一次往返出行且不与上一行重复、说中文键英文侧 0 行；
//   ⑥ 新增上游随机套 1000 条：坏 final + 超前 partial + 首尾相接正式片 / 同一词在两处 /
//      真重复两遍（都是正式 final）/ 两路并行（英文路缺失或只给标点）——相邻行与单行内无重复片段、
//      正式 final 全覆盖、说中文键英文侧 0 行、转交不产生重复；守恒以正式 final + 转交候补为准。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟（与 listen-r12 同形）────────────────────────────────────────────────
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
const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const SCRIPT = (t) => (/\p{Script=Han}/u.test(String(t || '')) ? 'Han' : (/[A-Za-z]/.test(String(t || '')) ? 'Latin' : null));
// 相邻两行（同 locale）与单行内都不得出现重复片段（归一化后 ≥6 字连续重合）。
function dupRuns(list, k) {
  const out = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = norm(list[i]), b = norm(list[i + 1]);
    const max = Math.min(a.length, b.length);
    for (let n = max; n >= k; n--) if (a.slice(-n) === b.slice(0, n)) { out.push({ i, n, a: a.slice(-n) }); break; }
  }
  return out;
}
function withinDup(text, k) {
  const s = norm(text);
  for (let i = 0; i + k <= s.length; i++) {
    const seg = s.slice(i, i + k);
    if (s.indexOf(seg, i + 1) >= 0) return { seg, i };
  }
  return null;
}
// 随机套用**整词**判重复（避免 `three1` / `three10` 这种数字前缀被逐字符误判）：
// 相邻行取「行尾整词后缀 == 下行行首整词前缀」，重合字符 ≥6 才算；单行内取连续整词串出现两次、≥12 字。
function tokenOverlapAdjacent(list) {
  const tk = list.map((s) => C.alignWords(s));
  const out = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = tk[i], b = tk[i + 1];
    for (let k = Math.min(a.length, b.length); k >= 1; k--) {
      let okk = true;
      for (let j = 0; j < k; j++) if (!C.wordNear(a[a.length - k + j], b[j])) { okk = false; break; }
      if (okk) {
        const chars = norm(a.slice(a.length - k).join('')).length;
        if (chars >= 6) out.push({ i, k, a: a.slice(a.length - k).join(' ') });
        break;
      }
    }
  }
  return out;
}
function tokenDupWithin(text) {
  const a = C.alignWords(text);
  for (let k = a.length; k >= 1; k--) {
    const seen = new Set();
    for (let i = 0; i + k <= a.length; i++) {
      const key = a.slice(i, i + k).map((w) => C.canonWord(w)).join('\u0001');
      if (seen.has(key)) {
        const raw = a.slice(i, i + k).join('');
        if (norm(raw).length >= 12) return { seg: raw };
      } else seen.add(key);
    }
  }
  return null;
}

// ══ ① 纯函数：文字对齐 ═════════════════════════════════════════════════════════
describe('R14 ① — 文字对齐（数字=数词、长词 1 字母差、带数字的词不模糊）', () => {
  test('alignWords：拉丁/数字按词、中日韩逐字', () => {
    deepEq(C.alignWords('Please make 3 copies'), ['please', 'make', '3', 'copies']);
    deepEq(C.alignWords('甲乙丙丁92戊'), ['甲', '乙', '丙', '丁', '92', '戊']);
    deepEq(C.alignWords("Mr. Zhang's office"), ['mr', 'zhang', 's', 'office']);
  });
  test('wordNear：Zang/Zhang 算同（1 字母差）；3=three；带数字的词只认完全相等', () => {
    ok(C.wordNear('zang', 'zhang'), 'Zang/Zhang');
    ok(C.wordNear('3', 'three'), '3 == three');
    ok(C.wordNear('5', 'five'), '5 == five');
    ok(!C.wordNear('this55', 'this58'), '带数字的词不做 1 字母模糊');
    ok(!C.wordNear('cop', 'copies'), '差 3 个字母不算同');
    ok(!C.wordNear('of', 'to'), '短词不许 1 字母模糊（避免 of/to 误配）');
  });
  test('alignFinalInTemp：final ⊂ temp ⇒ before = 对齐点之前；final ⊃ temp ⇒ 删临时稿；无关 ⇒ null', () => {
    const temp = 'copies of this contract and send them to Mr. Zang\'s office before 5 p.m.';
    eq(C.alignFinalInTemp(temp, ' of this contract and').before, 'copies');
    eq(C.alignFinalInTemp('Please make 3 cop', ' Please make').before, '');
    eq(C.alignFinalInTemp('of this contract and send them to Mr.', 'of this contract and send them to Mr.').before, '');
    eq(C.alignFinalInTemp('copies', 'send them to Mr.'), null);
    // 数字与数词互认
    eq(C.alignFinalInTemp('make three copies', 'make 3 copies').before, '');
  });
  test('isTailDup：临时稿整段是上一条正式 final 的结尾且音频邻接', () => {
    ok(C.isTailDup('Yes, please.', 'Please', 60, 300), '结尾 + 邻接');
    ok(!C.isTailDup('Yes, please.', 'Please', 1200, 300), '间隔过大不算');
    ok(!C.isTailDup('Yes, please.', 'Thanks', 60, 300), '不是结尾不算');
  });
  test('变异钩子证明测试抓得住：把 wordNear 改成「带数字也模糊」会让 this55/this58 变绿（本测试要求它红）', () => {
    // 这里不注入变异，只把生产判据的**反向**断言钉住：若哪天放宽成数字也模糊，这条会红。
    ok(!C.wordNear('make93', 'make95'), '带数字的词必须完全相等');
  });
});

// ══ ② 路由器：临时稿让位 / 对不上两条都留 / 正式 final 永不去重 ══════════════════
function makeRouter(o) {
  const opt = o || {};
  const clk = fakeClock();
  const ev = [], calls = [], diags = [];
  const queue = opt.replies ? opt.replies.slice() : null;
  const r = C.makeSegmentRouter(Object.assign({
    call: async (p) => {
      calls.push(p);
      const r0 = queue ? queue.shift() : undefined;
      if (r0 instanceof Error) throw r0;
      if (typeof r0 === 'function') return r0(p, calls.length);
      if (typeof r0 === 'string') return r0;
      if (r0) return JSON.stringify(r0);
      return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' });
    },
    emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
    fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
    onFail: (reason, extra) => ev.push({ t: 'fail', reason, extra }),
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    idleMs: opt.idleMs || 1500, endWaitMs: 3000,
  }, opt.deps || {}));
  return { r, clk, ev, calls, diags };
}
const emitted = (ev) => ev.filter((e) => e.t === 'emit').flatMap((e) => e.rows.map((x) => x.source));
const fallbacks = (ev) => ev.filter((e) => e.t === 'fallback').map((e) => e.text);
const diagN = (diags, kind) => diags.filter((d) => d.kind === kind).length;

describe('R14 ② — 临时稿按文字对齐让位（不再按音频区间）', () => {
  test('★ r13 英文长句第 4 次形态：临时稿让位后，正式 final 片全部保留、无重复', async () => {
    const { r, clk, ev, diags } = makeRouter({});
    // 临时稿（partial 救回）：覆盖到 p.m.；正式 final 从 of this contract and 开始（首尾相接）
    r.feed('en-US', 'Please make', { rescued: true, t0: 33434, t1: 34196 });
    r.feed('en-US', 'copies of this contract and send them to Mr. Zang\'s office before 5 p.m.', { rescued: true, t0: 34556, t1: 34856 });
    r.feed('en-US', ' of this contract and', { t0: 34856, t1: 35876 });
    r.feed('en-US', ' send them to Mr.', { t0: 35876, t1: 36836 });
    r.feed('en-US', " Zang's", { t0: 36836, t1: 37436 });
    r.feed('en-US', ' office before 5', { t0: 37436, t1: 38276 });
    r.feed('en-US', ' p.m.', { t0: 38276, t1: 39116 });
    await clk.advance(3000); await settleTick();
    const out = emitted(ev).join(' ');
    ok(diagN(diags, 'rescue:trim') >= 1, '没有走到文字对齐：' + JSON.stringify(diags.map((d) => d.kind)));
    for (const piece of ['of this contract and', 'send them to Mr.', "Zang's", 'office before 5', 'p.m.']) {
      ok(norm(out).indexOf(norm(piece)) >= 0, '正式 final 片丢了 ' + JSON.stringify(piece) + '：' + JSON.stringify(out));
    }
    eq(withinDup(out, 12), null, '行内出现重复片段：' + JSON.stringify(out));
    eq(norm(out), 'pleasemakecopiesofthiscontractandsendthemtomrzangsofficebefore5pm', '临时稿让位后只保留对齐点之前的部分：' + JSON.stringify(out));
  });
  test('★ 对不上 ⇒ 两条都留（rescue:nomatch），宁可重复不丢字', async () => {
    const { r, clk, diags } = makeRouter({});
    r.feed('en-US', 'completely unrelated temp draft', { rescued: true, t0: 1000, t1: 1500 });
    r.feed('en-US', 'and this is the real final', { t0: 2000, t1: 2500 });
    eq(diagN(diags, 'rescue:nomatch'), 1, '没有记 rescue:nomatch：' + JSON.stringify(diags));
    eq(r.pending('en-US'), 'completely unrelated temp draft and this is the real final');
  });
  test('★ 两条正式 final 之间永不去重：真重复两遍都保留', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { t0: 1000, t1: 2000 });
    r.feed('en-US', 'Please make 3 copies.', { t0: 2100, t1: 3100 });
    await clk.advance(3000); await settleTick();
    eq(norm(emitted(ev).join('')), 'pleasemake3copiespleasemake3copies', '真说了两遍不许被去重：' + JSON.stringify(emitted(ev)));
  });
  test('★ dup-prev：临时稿整段是紧挨着的上一条正式 final 的结尾 ⇒ 丢掉（rescue:dup-prev）', async () => {
    const { r, clk, ev, diags } = makeRouter({});
    r.feed('en-US', 'Yes, please.', { t0: 266373, t1: 267795 });
    r.feed('en-US', 'Please', { rescued: true, t0: 267855, t1: 268890 });
    await clk.advance(3000); await settleTick();
    eq(diagN(diags, 'rescue:dup-prev') >= 1, true, '没有记 rescue:dup-prev：' + JSON.stringify(diags));
    eq(norm(emitted(ev).join('')), 'yesplease', '重复的 Please 不许再出一行：' + JSON.stringify(emitted(ev)));
  });
  test('★ 已出行的临时稿：正式 final 去掉已出行的重叠前缀、只追加剩余（按文字）', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true, t0: 1000, t1: 1800 });
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1, '临时稿先出行');
    r.feed('en-US', 'Please make', { t0: 1000, t1: 1400 });
    r.feed('en-US', '3', { t0: 1400, t1: 1600 });
    eq(r.pending('en-US'), '', '已出行的前缀不再追加：' + JSON.stringify(r.pending('en-US')));
    r.feed('en-US', 'Thanks.', { t0: 1800, t1: 2000 });
    eq(r.pending('en-US'), 'Thanks.', '不重叠的部分照常追加：' + JSON.stringify(r.pending('en-US')));
  });
  test('★ 真机 g3 第 2 次回归：已出行临时稿只对**同一段话**有效 —— 跨句重复的正式 final 不许被整条去重', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Yes, please.', { rescued: true, t0: 1000, t1: 2000 });
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1, '临时稿先出行');
    await clk.advance(12000); await settleTick();          // 新一段话（间隔 > SEG_RESCUE_KEEP_MS）
    r.feed('en-US', 'Yes, please.', { t0: 50000, t1: 51000 });
    eq(r.pending('en-US'), 'Yes, please.', '跨句重复的正式 final 必须保留（不许丢字）：' + JSON.stringify(r.pending('en-US')));
    await clk.advance(2000); await settleTick();
    eq(norm(emitted(ev).join('')), 'yespleaseyesplease', '两句都要出行：' + JSON.stringify(emitted(ev)));
  });
});

// ══ ③ 句头闸：heldJoin 拼接前做 dup-prev ═════════════════════════════════════
describe('R14 ③ — 句头闸 heldJoin 拼接前的 dup-prev（Yes please 第 10 次形态）', () => {
  function gate() {
    const clk = fakeClock(); const rel = []; const diags = [];
    const g = C.makeFinalGate({ dominantScript: SCRIPT, now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
      onRelease: (loc, t, meta) => rel.push({ loc, t, meta }),
      onDiag: (k, t, w) => diags.push({ k, t, w }) });
    return { g, clk, rel, diags };
  }
  test('★ `. Yes, please.`(conf .138) + 补救片 `Please`(rescued) ⇒ Please 被丢、只放行 `Yes, please.`', async () => {
    const { g, clk, rel, diags } = gate();
    deepEq(g.push({ locale: 'en-US', text: '. Yes, please.', conf: 0.138, t0: 266373, t1: 267795 }), []);
    deepEq(g.push({ locale: 'en-US', text: 'Please', conf: 0.154, rescued: true, t0: 267855, t1: 268890 }), []);
    ok(/yes, please/i.test(g.held('en-US')), '补救片已被去重：' + JSON.stringify(g.held('en-US')));    await clk.advance(1600);
    eq(rel.length, 1, '一次放行');
    eq(norm(rel[0].t), 'yesplease', '只放行 Yes, please.（不带 Please）：' + JSON.stringify(rel[0].t));
    ok(diags.some((d) => d.k === 'rescue:dup-prev'), '没有记 rescue:dup-prev：' + JSON.stringify(diags));
  });
  test('对照（不该误伤）：真正的新词（不是上一条结尾）照常拼接', async () => {
    const { g, clk, rel } = gate();
    g.push({ locale: 'en-US', text: 'Yes.', conf: 0.3, t0: 1000, t1: 1400 });
    g.push({ locale: 'en-US', text: 'please', conf: 0.005, t0: 1400, t1: 1800 });
    await clk.advance(1600);
    eq(rel.length, 1);
    eq(norm(rel[0].t), 'yesplease', 'Yes + please 两片都要在：' + JSON.stringify(rel[0].t));
  });
});

// ══ ④ parseSegReply 漂移门顺序 ═══════════════════════════════════════════════
describe('R14 ④ — 漂移门：先切与上一条已出行行重复的前缀，再算比例', () => {
  const LAST = 'Please make 3 copies of this contract and send them';
  const BUF = 'to. Zang\'s office before 5 p.m.';
  const FULL = 'Please make 3 copies of this contract and send them to Mr. Zhang\'s office before 5 p.m.';
  const reply = JSON.stringify({ segments: [{ source: FULL, translation: 'T' }], remainder: '' });
  test('★ r13 英文长句第 1 次：模型把 remainder 补回整句 ⇒ 先切重复前缀，一次往返就通过漂移门', () => {
    const p0 = C.parseSegReply(reply, { buffer: BUF });
    eq(p0.ok, false, '旧顺序（不带上一条）会误判漂移');
    eq(p0.reason, 'drift');
    const p1 = C.parseSegReply(reply, { buffer: BUF, last: LAST });
    eq(p1.ok, true, '先切重复前缀后应通过：' + JSON.stringify(p1));
    eq(p1.segments.length, 1);
  });
  test('★ 与上一行无关的扩张照常被漂移门拦住', () => {
    const unrelated = JSON.stringify({ segments: [{ source: 'completely different words that nobody said at all here now today again and again and once more for good measure indeed', translation: 'T' }], remainder: '' });
    const p = C.parseSegReply(unrelated, { buffer: BUF, last: LAST });
    eq(p.ok, false, '无关扩张必须拦');
    eq(p.reason, 'drift');
  });
  test('★ 模型 source == buffer（合法，无扩张）时不误判、也不误切', () => {
    const p = C.parseSegReply(JSON.stringify({ segments: [{ source: BUF, translation: 'T' }], remainder: '' }), { buffer: BUF, last: LAST });
    eq(p.ok, true, 'source == buffer 合法：' + JSON.stringify(p));
  });
});

// ══ ⑤ 回放 /tmp/r13 原始事件 ═════════════════════════════════════════════════
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'r14-replay.json'), 'utf8'));

// partialWorthRescue 的复刻（生产在 src/app/listen-model.js；这里只做回放接线，判据逐条抄）
const PARTIAL_TTL_MS = 2500, RESCUE_LETTER_GAP = 3, RESCUE_LEAD_PUNCT = /^[\s,.;:!?…、。，！？]+/u, RESCUE_TS_TOL = 120;
const LETTER_RE = /[\p{L}\p{N}]/u;
function letterCount(s) { const m = String(s || '').match(/[\p{L}\p{N}]/gu); return m ? m.length : 0; }
function partialWorthRescue(ev, p, at) {
  const text = String((ev && ev.text) || '');
  if (!p || !LETTER_RE.test(p.text)) return false;
  if ((at - p.at) > PARTIAL_TTL_MS) return false;
  const letters = letterCount(text);
  const conf = Number(ev && ev.conf);
  const lowConf = Number.isFinite(conf) && conf >= 0 && conf < C.LATIN_MIN_CONF;
  if (!(letters === 0 || RESCUE_LEAD_PUNCT.test(text) || lowConf)) return false;
  const fTsOk = Number.isFinite(ev && ev.t0) && Number.isFinite(ev && ev.t1);
  const pTsOk = Number.isFinite(p.t0) && Number.isFinite(p.t1);
  if (fTsOk && pTsOk) {
    const plea = letterCount(p.text);
    if (plea < letters + RESCUE_LETTER_GAP && !(RESCUE_LEAD_PUNCT.test(text) && plea > letters)) return false;
    return p.t0 >= ev.t0 - RESCUE_TS_TOL && p.t1 <= ev.t1 + RESCUE_TS_TOL;
  }
  return letters === 0;
}
// 回放一条用例：按原始事件时间推进假时钟，走「生产同序」的 intake 接线（partialBy → 补救/句首 →
// intakeDecide → 句头闸 → feed；被 attrib 拒的中文路结果交候补转交）。
async function replay(key, opt) {
  const o = opt || {};
  const c = FIX.cases[key];
  const clk = fakeClock();
  const emittedRows = [], diags = [], feeds = [];
  const partialBy = {};
  const seg = C.makeSegmentRouter({
    call: (p) => {
      if (o.replyFn) return Promise.resolve(o.replyFn(p));
      return Promise.resolve(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' }));
    },
    emit: (rows, meta) => { for (const row of rows) emittedRows.push({ locale: C.baseCode(meta && meta.locale), source: row.source, who: meta && meta.locale }); },
    fallback: (text, meta) => emittedRows.push({ locale: C.baseCode(meta && meta.locale), source: text, fb: true }),
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
  });
  const xfer = C.makeTransferGate({
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500,
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    canXfer: () => c.lid === 'en',
    onXfer: (text, locale, cand) => { feeds.push({ locale, text, xfer: true }); seg.feed(locale, text, { rescued: true, t0: cand && cand.t0, t1: cand && cand.t1 }); },
  });
  const gate = C.makeFinalGate({ dominantScript: SCRIPT, now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    onRelease: (locale, text, meta) => { feeds.push({ locale, text, rescued: !!(meta && meta.rescued) }); seg.feed(locale, text, { rescued: !!(meta && meta.rescued), t0: meta && meta.t0, t1: meta && meta.t1 }); },
    onDiag: (k, t, w) => diags.push({ kind: k, text: t, why: w }) });
  const intake = (ev) => {
    const base = C.baseCode(ev.locale);
    const pNow = partialBy[base];
    let text = ev.text, rescued = false;
    if (partialWorthRescue(ev, pNow, clk.now())) { text = pNow.text; rescued = true; }
    if (base === c.lid && /[A-Za-z]/.test(text)) xfer.noteEnLetter();
    const dec = C.intakeDecide({ base, lid: c.lid, pttSwitch: null, now: clk.now(), playing: new Set(), text, isEcho: () => false });
    if (!dec.admit) {
      diags.push({ kind: 'intake:' + dec.reason });
      if (dec.xfer) xfer.offer({ text: C.xferClean(text), locale: c.lid === 'en' ? 'en-US' : C.toLocale(c.lid), t0: ev.t0, t1: ev.t1 });
      return;
    }
    const texts = gate.push({ locale: ev.locale, text, conf: ev.conf, rescued, t0: ev.t0, t1: ev.t1 });
    for (const tt of texts) seg.feed(ev.locale, tt, { rescued, t0: ev.t0, t1: ev.t1 });
  };
  let last = 0;
  for (const e of c.events) {
    const d = Math.max(0, e.rel - last);
    if (d) { await clk.advance(d); await settleTick(); }
    last = e.rel;
    if (e.type === 'stt-partial') {
      const k = C.baseCode(e.locale);
      partialBy[k] = { text: String(e.text || ''), at: clk.now(), t0: e.t0, t1: e.t1 };
      // 生产接线：归属这一路的 partial 有字母 ⇒ 也算「英文路有结果」（候补作废）。
      if (k === c.lid && /[A-Za-z]/.test(String(e.text || ''))) xfer.noteEnLetter();
      if (seg.notePartial) seg.notePartial(e.locale);
    } else if (e.type === 'stt-final') {
      intake(e);
      delete partialBy[C.baseCode(e.locale)];
    }
    await settleTick();
  }
  if (c.mode === 'tap') {
    await clk.advance(Math.max(0, c.t_end_rel + 50 - last)); last = c.t_end_rel + 50;
    xfer.stop();
    await clk.advance(450); last += 450;
    xfer.stop();
  }
  await clk.advance(6000); await settleTick();
  const pe = seg.settle('end'); await clk.advance(3600); await settleTick(); await pe; await settleTick();
  seg.dispose();
  return { emittedRows, diags, feeds, pending: { 'en-US': seg.pending('en-US') || '', 'zh-CN': seg.pending('zh-CN') || '' } };
}
// 原始事件里的正式 final（含字母、非补救）文字：覆盖判据
function formalFinals(key) {
  const c = FIX.cases[key];
  return c.events.filter((e) => e.type === 'stt-final' && C.baseCode(e.locale) === c.lid)
    .map((e) => String(e.text || '').replace(/^[\s,.;:!?…、。，！？]+/u, '').trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}
const enRows = (rows) => rows.filter((r) => r.locale === 'en').map((r) => r.source);

describe('R14 ⑤ — 回放 /tmp/r13 原始事件', () => {
  for (const key of ['en-auto-4', 'en-auto-7', 'en-auto-9']) {
    test('★ ' + key + '：无重复且覆盖全部正式 final', async () => {
      const res = await replay(key);
      const out = enRows(res.emittedRows).join(' ');
      const normOut = norm(out);
      eq(dupRuns(enRows(res.emittedRows), 6).length, 0, '相邻行重复：' + JSON.stringify(enRows(res.emittedRows)));
      eq(withinDup(out, 12), null, '行内重复：' + JSON.stringify(out));
      for (const f of formalFinals(key)) {
        ok(normOut.indexOf(norm(f)) >= 0, '正式 final 未覆盖 ' + JSON.stringify(f) + '：' + JSON.stringify(out));
      }
      ok(diagsTrim(res) >= 1, '必须真的走到文字对齐（rescue:trim）：' + JSON.stringify(res.diags.map((d) => d.kind)));
    });
  }
  test('★ yesplease-auto-10：`Yes, please.` 之后不再单出一行 `Please`', async () => {
    const res = await replay('yesplease-auto-10');
    const rows = enRows(res.emittedRows);
    eq(rows.length, 1, '只许一行：' + JSON.stringify(rows));
    ok(/yes/i.test(rows[0]) && /please/i.test(rows[0]), '那一行应是 Yes, please.：' + JSON.stringify(rows[0]));
    eq(withinDup(rows[0], 12), null, '行内重复：' + JSON.stringify(rows[0]));
  });
  for (const key of ['en-auto-2', 'en-auto-10']) {
    test('★ ' + key + '：标点开头的 final + partial 带句首 ⇒ 不再多出一行句首（#592）', async () => {
      const res = await replay(key);
      const rows = enRows(res.emittedRows);
      const out = rows.join(' ');
      ok(norm(out).indexOf('andsendthemtomr') >= 0, '定稿正文没出行：' + JSON.stringify(out));
      ok(norm(out).indexOf('make3copiesofthiscontract') < 0, 'partial 句首被切成一行：' + JSON.stringify(rows));
      ok(!res.diags.some((d) => d.kind === 'rescue:lead'), '不该再记 rescue:lead：' + JSON.stringify(res.diags.map((d) => d.kind)));
      eq(withinDup(out, 12), null, '行内重复：' + JSON.stringify(out));
    });
  }
  for (const key of ['yes-auto-6', 'yes-auto-8', 'yes-auto-9', 'yes-tap-1']) {
    test('★ ' + key + '：中文路 `Yes。` 候补转交 ⇒ 出行（intake:xfer）', async () => {
      const res = await replay(key);
      const rows = enRows(res.emittedRows);
      ok(rows.length >= 1, '没有出行：' + JSON.stringify(res.emittedRows));
      ok(rows.some((t) => /yes/i.test(t)), '出行文字里没有 Yes：' + JSON.stringify(rows));
      ok(res.diags.some((d) => d.kind === 'intake:xfer'), '没有记 intake:xfer：' + JSON.stringify(res.diags.map((d) => d.kind)));
      eq(dupRuns(enRows(res.emittedRows), 6).length, 0, '相邻行重复：' + JSON.stringify(rows));
    });
  }
  test('★ yes-auto-7：英文路已给 `Yeah.`（补救文字）⇒ 候补被丢，不多一行', async () => {
    const res = await replay('yes-auto-7');
    const rows = enRows(res.emittedRows);
    eq(rows.length, 1, '只许一行：' + JSON.stringify(rows));
    ok(/yeah/i.test(rows[0]), '应是 Yeah.：' + JSON.stringify(rows[0]));
    ok(!res.diags.some((d) => d.kind === 'intake:xfer'), '不该转交：' + JSON.stringify(res.diags.map((d) => d.kind)));
    ok(res.diags.some((d) => d.kind === 'intake:xfer-drop'), '应当记 intake:xfer-drop：' + JSON.stringify(res.diags.map((d) => d.kind)));
  });
  test('★ en-auto-1：模型把 remainder 补回整句 ⇒ 一次往返出行，且不与上一行重复', async () => {
    // 回放真实模型回复：第一次回缓冲本身；第二次（缓冲 to. Zang's...）回补回的整句。
    const FULL = 'Please make 3 copies of this contract and send them to Mr. Zhang\'s office before 5 p.m.';
    const res = await replay('en-auto-1', {
      replyFn: (p) => {
        const b = bufOf(p);
        if (b.indexOf('to.') === 0) return JSON.stringify({ segments: [{ source: FULL, translation: 'T' }], remainder: '' });
        return JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' });
      },
    });
    const rows = enRows(res.emittedRows);
    eq(dupRuns(rows, 6).length, 0, '相邻行重复：' + JSON.stringify(rows));
    eq(withinDup(rows.join(' '), 12), null, '行内重复：' + JSON.stringify(rows));
    ok(res.diags.filter((d) => d.kind === 'fail:drift').length === 0, '不该再判漂移：' + JSON.stringify(res.diags.map((d) => d.kind)));
    ok(rows.some((t) => /zang|zhang/i.test(t) && /5\s*p\.?m/i.test(t)), '后半句应当出行：' + JSON.stringify(rows));
  });
  test('★ 说中文键（zh-auto-1 / zhshort-auto-1）：英文侧出行 0 行', async () => {
    for (const key of ['zh-auto-1', 'zhshort-auto-1']) {
      const res = await replay(key);
      eq(enRows(res.emittedRows).length, 0, key + ' 英文侧不该出行：' + JSON.stringify(res.emittedRows));
      ok(!res.diags.some((d) => d.kind === 'intake:xfer'), key + ' 不该有转交：' + JSON.stringify(res.diags.map((d) => d.kind)));
    }
  });
});
function diagsTrim(res) { return res.diags.filter((d) => d.kind === 'rescue:trim').length; }

// ══ ⑥ 转交候补纯逻辑 ═══════════════════════════════════════════════════════════
describe('R14 ⑥ — 中文路 → 英文路候补转交（纯逻辑）', () => {
  test('isXferCandidate：只限中文路 → 英文、无汉字、有字母、≤3 词', () => {
    ok(C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: 'Yes。' }), 'Yes。是候补');
    ok(C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: 'Yes please.' }), '两个词也是候补');
    ok(C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: 'yes please thank you' }) === false, '>3 词不候补');
    ok(!C.isXferCandidate({ base: 'en-US', lid: 'en', text: 'Yes.' }), '英文路自己不算候补');
    ok(!C.isXferCandidate({ base: 'zh-CN', lid: 'zh', text: 'Yes。' }), '说中文键（lid=zh）不触发');
    ok(!C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: '是的。' }), '有汉字不候补');
    ok(!C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: '是的 Yes。' }), '汉字 + 字母 也不候补');
    ok(!C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: '。' }), '没字母不候补');
  });
  test('intakeDecide 在 attrib 拒绝时多返回可转交标记', () => {
    const d = C.intakeDecide({ base: 'zh-CN', lid: 'en', text: 'Yes。', pttSwitch: null, playing: new Set(), now: 1, isEcho: () => false });
    eq(d.admit, false); eq(d.reason, 'attrib'); eq(d.xfer, true);
    const d2 = C.intakeDecide({ base: 'zh-CN', lid: 'en', text: '帮我把这份合同复印三份送到办公室', pttSwitch: null, playing: new Set(), now: 1, isEcho: () => false });
    eq(d2.reason, 'attrib'); eq(d2.xfer, false, '汉字垃圾不候补');
    const d3 = C.intakeDecide({ base: 'zh-CN', lid: 'zh', text: 'Yes。', pttSwitch: null, playing: new Set(), now: 1, isEcho: () => false });
    eq(d3.admit, true, '说中文键时中文路照常接收');
    eq(d3.xfer, false);
  });
  test('xferClean：中文标点换英文、去掉非 ASCII', () => {
    eq(C.xferClean('Yes。'), 'Yes.');
    eq(C.xferClean('Yes，please！'), 'Yes, please!');
    eq(C.xferClean('是的。'), '');
  });
  test('★ makeTransferGate：英文路有带字母结果就丢候补；到点/停止收音则转交', async () => {
    const clk = fakeClock(); const got = []; const drops = [];
    const g = C.makeTransferGate({ now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: (k, e) => { if (k === 'intake:xfer-drop') drops.push(e && e.text); } });
    // 情形一：候补前 1.5s 内英文路已有结果 ⇒ 直接丢
    g.noteEnLetter();
    eq(g.offer({ text: 'Yes.', locale: 'en-US' }), false, '英文路已有结果 ⇒ 不候补');
    eq(drops.length, 1);
    // 情形二：等待期间英文路来结果 ⇒ 丢
    await clk.advance(1600);
    eq(g.offer({ text: 'Yes.', locale: 'en-US' }), true);
    eq(g.pending(), true);
    g.noteEnLetter();
    eq(g.pending(), false, '英文路来结果 ⇒ 候补作废');
    await clk.advance(1600);
    eq(got.length, 0, '不该转交：' + JSON.stringify(got));
    // 情形三：英文路一直没结果 ⇒ 到点转交
    eq(g.offer({ text: 'Yes.', locale: 'en-US' }), true);
    await clk.advance(1600);
    deepEq(got, ['Yes.'], '到点应转交');
    // 情形四：点停 stop() ⇒ 立即转交
    eq(g.offer({ text: 'Yes please.', locale: 'en-US' }), true);
    eq(g.stop(), true);
    deepEq(got, ['Yes.', 'Yes please.']);
  });
  test('★ 变异对照：把转交改成双向（lid=zh 也候补）会让「说中文键不触发」变红 —— 用生产判据的反向断言钉住', () => {
    ok(!C.isXferCandidate({ base: 'en-US', lid: 'zh', text: 'Yes.' }), '英文路 → 中文路 不候补');
    ok(!C.isXferCandidate({ base: 'zh-CN', lid: 'zh', text: 'Yes。' }), '归属中文时不候补');
  });
});

// ══ ⑦ 新增上游随机套 1000 条 ═════════════════════════════════════════════════
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
function mkWords(rnd, n, tok) { let s = ''; for (let i = 0; i < n; i++) s += (i ? ' ' : '') + EN_WORDS[Math.floor(rnd() * EN_WORDS.length)] + (tok.n++); return s; }
function mkZh(rnd, n, tok) { let s = ''; for (let i = 0; i < n; i++) s += ZH_CHARS[Math.floor(rnd() * ZH_CHARS.length)] + (tok.n++); return s; }

// 生成序列：坏 final + 超前 partial + 首尾相接正式片；同一词在 final 与下一段 partial；
// 真重复两遍（都是正式 final）；两路并行（英文路随机缺失/只给标点，中文路给拉丁或汉字）。
async function runR14Fuzz(seed) {
  const rnd = mulberry32(seed);
  const clk = fakeClock();
  const viol = [];
  const rows = [];       // { locale, source }
  const formal = { en: [], zh: [] };   // 必须被覆盖的正式 final
  const xferCand = [];   // 转交候补（守恒基准的一部分）
  const intentional = [];   // 故意「真重复两遍」的归一化文本（不进无重复判据）
  const diags = [];
  const seg = C.makeSegmentRouter({
    call: (p) => new Promise((res) => clk.setT(() => {
      const b = bufOf(p);
      res(JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' }));
    }, 40 + Math.floor(rnd() * 300))),
    emit: (list, meta) => { for (const r of list) rows.push({ locale: C.baseCode(meta && meta.locale), source: r.source }); },
    fallback: (t, meta) => rows.push({ locale: C.baseCode(meta && meta.locale), source: t }),
    onDiag: (kind) => diags.push(kind),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
  });
  const partialBy = {};
  const xfer = C.makeTransferGate({
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500,
    canXfer: () => true,
    onXfer: (text, locale) => { xferCand.push(text); seg.feed(locale, text, { rescued: true }); },
  });
  const gate = C.makeFinalGate({ dominantScript: SCRIPT, now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    onRelease: (locale, text, meta) => seg.feed(locale, text, { rescued: !!(meta && meta.rescued), t0: meta && meta.t0, t1: meta && meta.t1 }),
    onDiag: () => {} });
  const intake = (ev, lid) => {
    const base = C.baseCode(ev.locale);
    const p = partialBy[base];
    let text = ev.text, rescued = false;
    if (p && /[\p{L}\p{N}]/u.test(p.text) && (clk.now() - p.at) <= 2500) {
      const letters = letterCount(text);
      if (letters === 0 || /^[\s,.;:!?…、。，！？]+/u.test(text)) { text = p.text; rescued = true; }
    }
    if (base === lid && /[A-Za-z]/.test(text)) xfer.noteEnLetter();
    const dec = C.intakeDecide({ base, lid, pttSwitch: null, now: clk.now(), playing: new Set(), text, isEcho: () => false });
    if (!dec.admit) {
      if (dec.xfer) xfer.offer({ text: C.xferClean(text), locale: C.toLocale(lid), t0: ev.t0, t1: ev.t1 });
      return;
    }
    const texts = gate.push({ locale: ev.locale, text, conf: ev.conf, rescued, t0: ev.t0, t1: ev.t1 });
    for (const tt of texts) seg.feed(ev.locale, tt, { rescued, t0: ev.t0, t1: ev.t1 });
  };
  let t = 1000;
  const tok = { n: 0 };
  const lid = rnd() < 0.5 ? 'en' : 'zh';
  const steps = 20 + Math.floor(rnd() * 24);
  for (let i = 0; i < steps; i++) {
    const lc = rnd() < 0.55 ? 'en-US' : 'zh-CN';
    const base = C.baseCode(lc);
    const roll = rnd();
    const t1 = t + 300 + Math.floor(rnd() * 900); t += 400 + Math.floor(rnd() * 900);
    const admitted = (base === lid);   // 只有归属语言那一路的结果会被接收（另一路按设计拒）
    if (roll < 0.25 && base === 'en') {
      // 坏 final（无字母 ⇒ 补救成临时稿）+ 超前 partial（含后文）+ 首尾相接的正式片。
      // 正式片是临时稿的**后半段** ⇒ 文字对齐让位（rescue:trim），临时稿只留对齐点之前的 head。
      const head = mkWords(rnd, 1, tok);
      const tail = mkWords(rnd, 3, tok);
      const ahead = head + ' ' + tail;
      partialBy[base] = { text: ahead, at: clk.now(), t0: t, t1: t1 };
      intake({ locale: lc, text: '.', conf: 0.02, t0: t, t1: t1 }, lid);
      if (admitted) formal.en.push(tail);
      intake({ locale: lc, text: tail, conf: 0.9, t0: t1, t1: t1 + 500 }, lid);
      const cont = mkWords(rnd, 3, tok);
      if (admitted) formal.en.push(cont);
      intake({ locale: lc, text: cont, conf: 0.9, t0: t1 + 500, t1: t1 + 900 }, lid);
      delete partialBy[base];
    } else if (roll < 0.45 && base === 'en') {
      // 同一词在 final 与下一段 partial 各出现一次（Yes please 形态）
      const w = mkWords(rnd, 2, tok);
      if (admitted) formal.en.push(w);
      intake({ locale: lc, text: w, conf: 0.95, t0: t, t1: t1 }, lid);
      partialBy[base] = { text: w.split(' ').pop(), at: clk.now() };
      const badT1 = t1 + 200;
      intake({ locale: lc, text: '.', conf: 0.1, t0: t1 + 60, t1: badT1 }, lid);
      delete partialBy[base];
    } else if (roll < 0.6) {
      // 真重复两遍（都是正式 final）
      const w = base === 'en' ? mkWords(rnd, 3, tok) : mkZh(rnd, 4, tok);
      if (admitted) { formal[base].push(w); formal[base].push(w); intentional.push(norm(w)); }
      intake({ locale: lc, text: w, conf: 0.9, t0: t, t1 }, lid);
      intake({ locale: lc, text: w, conf: 0.9, t0: t1 + 80, t1: t1 + 700 }, lid);
    } else if (roll < 0.68) {
      // 两路并行：英文路缺失或只给标点，中文路给拉丁（唯一 token，避免误报重复）/ 汉字。
      const han = rnd() < 0.5;
      const zhLatin = han ? mkZh(rnd, 4, tok) : (mkWords(rnd, 1 + Math.floor(rnd() * 2), tok) + '。');
      // 只有含汉字的结果才过得了 zh 路的文字系闸（拉丁垃圾被 gate:drop / 扣住放行）⇒ 只对它能要求覆盖。
      if (lid === 'zh' && /\p{Script=Han}/u.test(zhLatin)) formal.zh.push(zhLatin);
      intake({ locale: 'zh-CN', text: zhLatin, conf: 0.8, t0: t, t1 }, lid);
      if (rnd() < 0.5) intake({ locale: 'en-US', text: '.', conf: 0.5, t0: t, t1 }, lid);
    } else if (roll < 0.85) {
      await clk.advance(150 + Math.floor(rnd() * 2200)); await settleTick();
    } else {
      seg.settle(rnd() < 0.5 ? 'stop' : 'switch');
    }
    await settleTick();
  }
  await clk.advance(7000); await settleTick();
  const pe = seg.settle('end'); await clk.advance(3600); await settleTick(); await pe; await clk.advance(500); await settleTick();
  const timers = clk.size();
  seg.dispose();
  const en = rows.filter((r) => r.locale === 'en').map((r) => r.source);
  const zh = rows.filter((r) => r.locale === 'zh').map((r) => r.source);
  // ① 相邻行与单行内无重复片段（整词判据）；**故意真重复两遍**的那段先抠掉（豁免）。
  const stripInt = (s) => { let x = norm(s); for (const t of intentional) x = x.split(t).join(''); return x; };
  for (const [name, list] of [['en', en], ['zh', zh]]) {
    const cleaned = list.map(stripInt);
    const d = tokenOverlapAdjacent(cleaned);
    if (d.length) viol.push(name + ' 相邻行重复：' + JSON.stringify(d.slice(0, 2)) + ' | rows=' + JSON.stringify(list));
    for (let i = 0; i < cleaned.length; i++) {
      const w = tokenDupWithin(cleaned[i]);
      if (w) { viol.push(name + ' 行内重复：' + JSON.stringify({ s: list[i], ...w })); break; }
    }
  }
  // ② 正式 final 全覆盖（出行 + 未出行）
  const cover = { en: norm(en.join('') + (seg.pending('en-US') || '')), zh: norm(zh.join('') + (seg.pending('zh-CN') || '')) };
  for (const b of ['en', 'zh']) {
    for (const f of formal[b]) { const fn = norm(f); if (fn && cover[b].indexOf(fn) < 0) viol.push(b + ' 正式 final 未覆盖：' + JSON.stringify(f) + ' | 出行=' + JSON.stringify(b === 'en' ? en : zh)); }
  }
  // ③ 说中文键（lid=zh）⇒ 英文侧出行 0；且转交只在 lid=en 且英文路无字母结果时发生
  if (lid === 'zh' && en.length) viol.push('说中文键时英文侧出行 ' + en.length + ' 行');
  if (lid === 'en' && diags.filter((x) => x === 'intake:xfer').length) {
    for (const c of xferCand) { const w = withinDup(en.join(' '), 12); if (w && norm(c).length >= 12) { /* 由相邻/行内检查兜 */ } }
  }
  if (timers !== 0) viol.push('残留计时器 ' + timers);
  return { seed, viol, en, zh, xferN: xferCand.length, trim: diags.filter((x) => x === 'rescue:trim').length };
}
describe('R14 ⑦ — 新增上游随机套（1000 条）：无重复 / 覆盖正式 final / 中文键英文侧 0 行', () => {
  test('★ 1000 条全过；且必须真的走到文字对齐与转交路径', async () => {
    const N = Number(process.env.R14_FUZZ || 1000);   // 变异检查时可设小值提速；默认验收 1000 条
    const bad = [];
    let trim = 0, xfer = 0;
    for (let seed = 1; seed <= N; seed++) {
      const res = await runR14Fuzz(seed);
      trim += res.trim; xfer += res.xferN;
      if (res.viol.length) bad.push('seed ' + seed + '：' + res.viol.slice(0, 2).join('；'));
    }
    eq(bad.length, 0, bad.slice(0, 8).join('\n'));
    if (N >= 1000) {
      ok(trim > 0, '这条随机套必须真的走到文字对齐（rescue:trim=' + trim + '）');
      ok(xfer > 0, '这条随机套必须真的走到转交（xfer=' + xfer + '）');
    }
  });
});
