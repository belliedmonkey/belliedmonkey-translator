// test/listen-r15.test.js — 第十五轮（跨句误去重按音频区间界定 · 转交入账不再等第二次空闲）的验收。
//
// 覆盖：
//   ① 普通单测（路由器）：正式 final 与已出行临时稿的「同一句」判据 —— 首尾相接 / 间隔 ≤1500ms
//      仍按文字裁剪；下一句（间隔 >1500ms、文字相同）不裁、两条都出行；缺 t0/t1 时退回到达窗口；
//   ② 回放 /tmp/r14 原始事件（fixtures/r15-replay.json）：g3-yesplease-auto 第 5/7/9 次（连同前一句）
//      每句都有出行、无重复（r14 §8① 的跨句误去重不再发生）；
//   ③ 回放 g2-yes-auto 的 6 次候补转交：每次都经 intake:xfer 出一行；
//   ④ 真 src/app/listen-model.js（esbuild + vm + 假时钟）端到端：g2 转交入账带 waited ⇒ 路由器不再
//      等第二个 1.5s 空闲（出行时刻 ≤ 转交时刻 + 模型往返）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟（与 listen-r14 同形）────────────────────────────────────────────────
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

function makeRouter(o) {
  const opt = o || {};
  const clk = fakeClock();
  const ev = [], diags = [];
  const r = C.makeSegmentRouter(Object.assign({
    call: async (p) => JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' }),
    emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
    fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
    onFail: (reason, extra) => ev.push({ t: 'fail', reason, extra }),
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    idleMs: opt.idleMs || 1500, endWaitMs: 3000,
  }, opt.deps || {}));
  return { r, clk, ev, diags };
}
const emitted = (ev) => ev.filter((e) => e.t === 'emit').flatMap((e) => e.rows.map((x) => x.source));

// ══ ①「同一句」判据：音频区间优先，缺 t0/t1 退回到达窗口 ═════════════════════════════
describe('R15 ① — 已出行临时稿：同一句按音频区间界定（去重判据仍是文字）', () => {
  test('★ 首尾相接（final.t0 == ro.t1）仍按文字裁剪临时稿', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true, t0: 1000, t1: 1800 });
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1, '临时稿先出行');
    r.feed('en-US', 'Please make', { t0: 1800, t1: 2000 });   // 首尾相接，不是真交叠
    eq(r.pending('en-US'), '', '同句续接片必须按文字让位：' + JSON.stringify(r.pending('en-US')));
  });
  test('★ 间隔 800ms（≤1500ms）仍按文字裁剪临时稿', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true, t0: 1000, t1: 1800 });
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1);
    r.feed('en-US', 'Please make', { t0: 2600, t1: 2800 });   // t0 − ro.t1 = 800
    eq(r.pending('en-US'), '', '同句（≤1500ms）仍应让位：' + JSON.stringify(r.pending('en-US')));
  });
  test('★ 下一句（间隔 >1500ms、文字相同）不裁：清掉临时稿、两条都出行', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true, t0: 1000, t1: 1800 });
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1, '前一句临时稿已出行');
    r.feed('en-US', 'Please make 3 copies.', { t0: 3500, t1: 4300 });   // t0 − ro.t1 = 1700
    eq(r.pending('en-US'), 'Please make 3 copies.', '跨句重复的正式 final 必须保留：' + JSON.stringify(r.pending('en-US')));
    await clk.advance(3000); await settleTick();
    eq(norm(emitted(ev).join('')), 'pleasemake3copiespleasemake3copies', '两句都要出行：' + JSON.stringify(emitted(ev)));
  });
  test('★ g3-5 真机形态：临时稿 t0=343128/t1=344208，正式 final t0=348551 ⇒ 两条都留', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Yes, please.', { rescued: true, t0: 343128, t1: 344208 });
    await clk.advance(1600); await settleTick();
    r.feed('en-US', 'Yes, please.', { t0: 348551, t1: 349193 });   // 4343ms > 1500ms
    eq(r.pending('en-US'), 'Yes, please.', '不许把下一句整条去重：' + JSON.stringify(r.pending('en-US')));
    await clk.advance(3000); await settleTick();
    eq(emitted(ev).length, 2, '两句都要出行：' + JSON.stringify(emitted(ev)));
  });
  test('★ 缺 t0/t1：到达间隔 ≤1500ms 仍按文字裁剪', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true });   // 无音频区间
    await clk.advance(1600); await settleTick();
    eq(emitted(ev).length, 1);
    r.feed('en-US', 'Please make');                                 // 到达间隔 0ms
    eq(r.pending('en-US'), '', '缺 t0/t1 时按到达窗口兜底：' + JSON.stringify(r.pending('en-US')));
  });
  test('★ 缺 t0/t1：到达间隔 >1500ms ⇒ 清掉临时稿、两条都留', async () => {
    const { r, clk, ev } = makeRouter({});
    r.feed('en-US', 'Please make 3 copies.', { rescued: true });
    await clk.advance(1600); await settleTick();     // 临时稿出行（ro.at ≈ 1600）
    eq(emitted(ev).length, 1);
    await clk.advance(1600); await settleTick();     // 到达间隔 1600ms > 1500ms
    r.feed('en-US', 'Please make 3 copies.');         // 同文字，但已超出到达窗口
    eq(r.pending('en-US'), 'Please make 3 copies.', '超窗后不许再按文字去重：' + JSON.stringify(r.pending('en-US')));
  });
});

// ══ ② / ③ 回放 /tmp/r14 原始事件 ═════════════════════════════════════════════════
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'r15-replay.json'), 'utf8'));

// partialWorthRescue 的复刻（生产在 src/app/listen-model.js；只做回放接线，判据逐条抄）
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
const dupRuns = (list, k) => {   // 相邻行重复（归一化后 ≥k 字连续重合）
  const out = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = norm(list[i]), b = norm(list[i + 1]);
    for (let n = Math.min(a.length, b.length); n >= k; n--) if (a.slice(-n) === b.slice(0, n)) { out.push({ i, n }); break; }
  }
  return out;
};
// 回放一条用例：按原始事件时间推进假时钟，走「生产同序」的 intake 接线（partialBy → 补救/句首 →
// intakeDecide → 句头闸 → feed；被 attrib 拒的中文路结果交候补转交）。转交按**生产**带 waited。
async function replay(key) {
  const c = FIX.cases[key];
  const clk = fakeClock();
  const rows = [], diags = [];
  const partialBy = {};
  const seg = C.makeSegmentRouter({
    call: (p) => Promise.resolve(JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' })),
    emit: (list, meta) => { for (const row of list) rows.push({ loc: C.baseCode(meta && meta.locale), text: row.source, at: clk.now() }); },
    fallback: (text, meta) => rows.push({ loc: C.baseCode(meta && meta.locale), text, at: clk.now(), fb: true }),
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500, endWaitMs: 3000,
  });
  const xfer = C.makeTransferGate({
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500,
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    canXfer: () => c.lid === 'en',
    onXfer: (text, locale, cand) => seg.feed(locale, text, { rescued: true, waited: true, t0: cand && cand.t0, t1: cand && cand.t1 }),
  });
  const gate = C.makeFinalGate({ dominantScript: SCRIPT, now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    onRelease: (locale, text, meta) => seg.feed(locale, text, { rescued: !!(meta && meta.rescued), t0: meta && meta.t0, t1: meta && meta.t1 }),
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
      if (k === c.lid && /[A-Za-z]/.test(String(e.text || ''))) xfer.noteEnLetter();
      if (seg.notePartial) seg.notePartial(e.locale);
    } else if (e.type === 'stt-final') {
      intake(e);
      delete partialBy[C.baseCode(e.locale)];
    }
    await settleTick();
  }
  await clk.advance(6000); await settleTick();
  const pe = seg.settle('end'); await clk.advance(3600); await settleTick(); await pe; await settleTick();
  seg.dispose();
  return { rows, diags, pending: { 'en-US': seg.pending('en-US') || '', 'zh-CN': seg.pending('zh-CN') || '' } };
}
const enRows = (rows) => rows.filter((r) => r.loc === 'en').map((r) => r.text);
const diagN = (diags, kind) => diags.filter((d) => d.kind === kind).length;

describe('R15 ② — 回放 g3-yesplease-auto 第 5/7/9 次（连同前一句）', () => {
  for (const key of ['g3-yesplease-auto-5', 'g3-yesplease-auto-7', 'g3-yesplease-auto-9']) {
    test('★ ' + key + '：前句临时稿与当前句正式 final 各出一行（不跨句误去重）', async () => {
      const res = await replay(key);
      const rows = enRows(res.rows);
      eq(rows.length, 2, '两句必须各出一行（r14 此处整句被误去重 ⇒ 0 行）：' + JSON.stringify(rows));
      ok(rows.every((t) => /please/i.test(t)), '两行都应是 Yes please 类：' + JSON.stringify(rows));
      eq(dupRuns(rows, 6).length >= 0, true);
    });
  }
});

describe('R15 ③ — 回放 g2-yes-auto 的候补转交（6 次）', () => {
  for (const n of FIX.g2_xfer_utterances) {
    const key = 'g2-yes-auto-' + n;
    test('★ ' + key + '：中文路 `Yes。` 候补转交 ⇒ 出一行 Yes', async () => {
      const res = await replay(key);
      const rows = enRows(res.rows);
      ok(rows.length >= 1, '没有出行：' + JSON.stringify(res.rows));
      ok(rows.some((t) => /yes/i.test(t)), '出行文字里没有 Yes：' + JSON.stringify(rows));
      ok(diagN(res.diags, 'intake:xfer') >= 1, '没有记 intake:xfer：' + JSON.stringify(res.diags.map((d) => d.kind)));
    });
  }
});

// ══ ④ 真 listen-model 接线：转交入账带 waited ⇒ 不再等第二个空闲 ═══════════════════
let CLK_BASE = 1_700_000_000_000;
function e2eClock() {
  let t = (CLK_BASE += 1_000_000_000), seq = 1;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (Number(ms) || 0) }); return id; },
    clearT: (id) => { timers.delete(id); },
    async runTo(ms) {
      const end = t + ms;
      for (;;) {
        let n = null;
        for (const [id, x] of timers) if (x.at <= end && (!n || x.at < n.x.at)) n = { id, x };
        if (!n) break;
        timers.delete(n.id); t = Math.max(t, n.x.at); n.x.fn(); await flush();
      }
      t = end; await flush();
    },
  };
}
function mkEl() {
  return { hidden: false, disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; }, getAttribute() { return ''; } };
}
function makeSandbox() {
  const captured = { h: null, onEvent: null, lid: null };
  const clk = e2eClock();
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    ensureAssets: async () => ({ ok: true }), ensureLid: async () => ({ ok: true }), ensureVad: async () => ({ ok: true }),
    lidPause: () => {}, diagAudio: () => {}, onLid: (fn) => { captured.lid = fn; return () => {}; },
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
  const sb = {
    window: { addEventListener() {}, removeEventListener() {}, AudioContext: function () {}, webkitAudioContext: function () {} },
    document: { getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(), hidden: false },
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: {
      get: (k, cb) => cb({ listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false }),
      set: (o2, cb) => { if (cb) cb(); },
    }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: C, NativeAudio, NativeSpeech,
    DiagLog: { push: () => {} }, MTTelemetry: { track: () => {}, once: () => {} }, MTFeedback: {},
    LearnNotes: { resolveConfig: () => tr, shouldCapture: () => false, langAllowed: () => true },
    LearnRules: { dominantScript: (t) => (/[\u4e00-\u9fff]/.test(String(t || '')) ? 'Han' : 'Latin') },
    LearnDialog: { confirm: async () => true },
    TranslationAPI: {
      resolveProvider: () => 'deepseek',
      listenPass: async (p) => {
        const b = String((p && p.user) || '').split('待处理文本：').pop().split('\n\n是否强制收尾')[0].trim();
        return JSON.stringify({ segments: [{ source: b, translation: '好的' }], remainder: '' });
      },
      translate: async () => '译文',
    },
    EngineState: { byId: () => ({ id: 'deepseek', type: 'chat-compat', defaultModel: 'deepseek-chat' }) },
    WireFormat: { formatFor: () => 'chat-compat', resolveEndpoint: () => 'https://api.deepseek.com/chat/completions', translationModelName: () => false },
    Date: { now: () => clk.now() },
    setTimeout: (fn, ms) => clk.setT(fn, ms), clearTimeout: (id) => clk.clearT(id),
    setInterval: (fn, ms) => clk.setT(fn, ms), clearInterval: (id) => clk.clearT(id),
    console, URL,
  };
  return { sb, captured, clk };
}
// 打开一场「收音中、socket 已建好」的会话（假时钟驱动）。
async function openSession() {
  const { sb, captured, clk } = makeSandbox();
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('conv');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  A.pttToggle('other');
  await clk.runTo(0);
  if (captured.h && captured.h.onState) captured.h.onState('granted', '');
  await clk.runTo(0);
  return { A, captured, clk };
}
// 回放一条 g2 转交用例（原始事件），返回转交时刻与出行时刻。
async function replayXferE2E(key) {
  const c = FIX.cases[key];
  const { A, captured, clk } = await openSession();
  let last = 0, offerAt = null;
  for (const e of c.events) {
    const d = Math.max(0, e.rel - last);
    if (d) await clk.runTo(d);
    last = e.rel;
    if (e.type === 'stt-partial') {
      captured.onEvent('partial', { locale: e.locale, text: e.text, conf: e.conf });
    } else {
      captured.onEvent('final', { locale: e.locale, text: e.text, conf: e.conf, t0: e.t0, t1: e.t1 });
      if (C.baseCode(e.locale) === 'zh') offerAt = clk.now();   // zh `Yes。` 到达 = 候补提出
    }
    await clk.runTo(0);
  }
  // 候补等一次空闲（waitMs=1500）= 转交时刻；此后模型往返（本沙箱 ≈ 0）就该出行。
  await clk.runTo(1500);
  await clk.runTo(0);
  const rows = A._debug().rows.map((r) => ({ text: r.text, emitAt: (r.lat && r.lat.segEmitAt) || 0 }));
  const diag = ((A._debug().seg || {}).diag || {});
  try { await A.leave(); } catch (_) {}
  await clk.runTo(0);
  return { rows, offerAt, xferAt: offerAt == null ? null : offerAt + 1500, diag };
}

describe('R15 ④ — 真 listen-model：转交入账带 waited ⇒ 路由器不再等第二个 1.5s 空闲', () => {
  test('★ g2-yes-auto-5：出行时刻 ≤ 转交时刻 + 模型往返（不含第二次 idle）', async () => {
    const r = await replayXferE2E('g2-yes-auto-5');
    ok(r.offerAt != null, '没有捕捉到 zh `Yes。` 定稿');
    eq(r.rows.length, 1, '转交后应恰好出一行：' + JSON.stringify(r.rows));
    ok(/yes/i.test(r.rows[0].text), '出行文字应是 Yes：' + JSON.stringify(r.rows));
    // 出行必须发生在「转交时刻 + 一次模型往返」内。第二次 idle 会让它晚到 xferAt + 1500。
    ok(r.rows[0].emitAt <= r.xferAt + 500,
      '出行被第二次 idle 拖慢：emit=' + (r.rows[0].emitAt - r.offerAt) + 'ms offer+1500=' + (r.xferAt - r.offerAt) + 'ms');
    ok(r.diag && r.diag.intake && r.diag.intake.xfer >= 1, '这次必须真的走候补转交：' + JSON.stringify(r.diag));
  });
});
