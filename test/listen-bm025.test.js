// BM-025：句头闸 drain/timeout + xfer 不丢字（2026-10-22）
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');
const LearnRules = require('../extension/content/learn-rules.js');

const DEPS = { dominantScript: LearnRules.dominantScript };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function loadDiag() {
  const store = {};
  const ctx = {
    window: {}, navigator: { userAgent: 'bm025' },
    chrome: { storage: { local: { get: (k, cb) => cb({ [k]: store[k] }), set: (o, cb) => { Object.assign(store, o); if (cb) cb(); } } } },
    setTimeout, Date, fetch: async () => ({ ok: true, status: 201 }),
  };
  vm.createContext(ctx);
  vm.runInContext(read('app/diag-log.js'), ctx);
  return { DiagLog: ctx.DiagLog, store };
}

function fakeClock(start) {
  let t = start || 0;
  const timers = [];
  return {
    now: () => t,
    setT: (fn, ms) => { const id = timers.length; timers.push({ id, at: t + ms, fn }); return id; },
    clearT: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    advance: (ms) => {
      t += ms;
      for (let i = 0; i < timers.length; i++) {
        const x = timers[i];
        if (x.at <= t) { timers.splice(i, 1); i--; try { x.fn(); } catch (_) {} }
      }
    },
  };
}

describe('BM-025 finalGate', () => {
  test('低置信 hold 后同 locale 高置信 final ⇒ 两段都落行', () => {
    const lines = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, {
      onRelease: (loc, t) => lines.push(t),
      onDiag: () => {},
    }));
    deepEq(g.push({ locale: 'en-US', text: 'to. make', conf: 0.06, t0: 100, t1: 400 }), []);
    eq(g.held('en-US'), 'to. make');
    deepEq(g.push({ locale: 'en-US', text: 'three copies of this contract.', conf: 0.98, t0: 600, t1: 3000 }),
      ['three copies of this contract.']);
    ok(lines.indexOf('to. make') >= 0, 'hold 碎片应单独落行：' + JSON.stringify(lines));
    eq(g.held('en-US'), '');
  });

  test('orphan 收口 flushAll ⇒ 扣住内容落行 + gate-drain 诊断', () => {
    const lines = [];
    const diags = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, {
      onRelease: (loc, t) => lines.push(t),
      onDiag: (k) => diags.push(k),
    }));
    g.push({ locale: 'en-US', text: 'Yes.', conf: 0.2, t0: 0, t1: 300 });
    g.flushAll();
    ok(lines.some((t) => /Yes/.test(t)), 'flushAll 应落行');
    ok(diags.indexOf('gate:drain') >= 0, '应有 gate:drain 诊断事件');
  });

  test('socket 重连：旧闸 flushAll 后再换新闸', () => {
    const lines = [];
    const mk = () => C.makeFinalGate(Object.assign({}, DEPS, {
      onRelease: (loc, t) => lines.push(t),
      onDiag: () => {},
    }));
    let finalGate = mk();
    finalGate.push({ locale: 'en-US', text: 'before reconnect', conf: 0.1, t0: 0, t1: 400 });
    eq(finalGate.heldLocales().length, 1);
    if (finalGate.flushAll) finalGate.flushAll();
    finalGate = mk();
    deepEq(lines, ['before reconnect'], '重连前应落行旧扣住片');
    eq(finalGate.heldLocales().length, 0, '新闸为空');
  });

  test('cancelAll 清掉 maxTimer（3s 超时计时器）', async () => {
    const clk = fakeClock();
    const lines = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, {
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 10000, holdTimeoutMs: 3000,
      onRelease: (loc, t) => lines.push(t),
      onDiag: () => {},
    }));
    g.push({ locale: 'en-US', text: 'timer test', conf: 0.1, t0: 0, t1: 400 });
    eq(g.heldLocales().length, 1);
    g.cancelAll();
    eq(g.heldLocales().length, 0);
    await clk.advance(5000);
    eq(lines.length, 0, 'cancelAll 后 maxTimer 不应再落行');
  });

  test('hold 3s 超时 ⇒ 强制落行 + gate-timeout（无用户句）', async () => {
    const clk = fakeClock();
    const lines = [];
    const diags = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, {
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 10000, holdTimeoutMs: 3000,
      onRelease: (loc, t) => lines.push(t),
      onDiag: (k, t, w) => diags.push({ k, t, w }),
    }));
    g.push({ locale: 'en-US', text: 'hold me', conf: 0.1, t0: 0, t1: 400 });
    await clk.advance(3100);
    ok(lines.indexOf('hold me') >= 0, '超时应落行');
    ok(diags.some((d) => d.k === 'gate:timeout' && !(d.t && /hold me/i.test(d.t))), 'gate:timeout 不携带用户文字');
    ok(diags.some((d) => d.k === 'gate:timeout' && Number(d.w) >= 3000), '记录时长');
  });
});

describe('BM-025 xfer en-letter', () => {
  test('zh 路 en-letter 且英文路 ±1.5s 无覆盖 ⇒ 转交落行', async () => {
    const clk = fakeClock();
    const got = [];
    const diags = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: (k, e) => diags.push({ k, e }),
    });
    g.noteEnSample({ text: 'make', t0: 5000, t1: 5200 });
    ok(g.offer({ text: 'Please', locale: 'zh-CN', t0: 1000, t1: 1200 }), '候补应成立');
    eq(g.stop(), true);
    deepEq(got, ['Please'], '英文未覆盖同一区间 ⇒ 转交');
    ok(!diags.some((d) => d.k === 'intake:xfer-drop' && d.e && d.e.text === 'en-letter-now'), '不应误丢');
  });

  test('英文路已覆盖句中候补 ⇒ 丢且不重复转交', async () => {
    const clk = fakeClock();
    const got = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: () => {},
    });
    g.noteEnSample({ text: 'Please make three', t0: 1000, t1: 2500 });
    eq(g.offer({ text: 'please', locale: 'zh-CN', t0: 1200, t1: 1400 }), false, '句中 covered ⇒ 拒绝候补');
    eq(g.pending(), false);
    eq(got.length, 0, '句中且 covered ⇒ 不转交');
  });
});

describe('BM-025 r4 review §4 unit tests', () => {
  function mkGate(extra) {
    const lines = [];
    const diags = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, {
      onRelease: (loc, t) => lines.push(String(t)),
      onDiag: (k, t, w) => diags.push({ k, t, w }),
    }, extra || {}));
    return { g, lines, diags };
  }

  test('(1) 句头闸 (a)：低置信 Yes + 紧接高置信 please make three copies ⇒ 1 行', () => {
    const { g, lines } = mkGate();
    deepEq(g.push({ locale: 'en-US', text: 'Yes', conf: 0.2, t0: 0, t1: 300 }), []);
    const out = g.push({ locale: 'en-US', text: 'please make three copies', conf: 0.98, t0: 300, t1: 2500 });
    ok(/yes.*please make three copies/i.test(out.join(' ')), out.join('|'));
    eq(lines.length, 0, 'merge 不应再 releaseLine');
  });

  test('(2) 句头闸 (b)：make three 与随后 formal 时间交叠 ⇒ covered 丢、1 行', () => {
    const { g, diags } = mkGate();
    g.push({ locale: 'en-US', text: 'make three', conf: 0.15, t0: 1000, t1: 1800 });
    const out = g.push({ locale: 'en-US', text: 'make three copies of this contract.', conf: 0.99, t0: 1200, t1: 4000 });
    eq(out.length, 1);
    ok(/make three copies/i.test(out[0]));
    ok(diags.some((d) => d.k === 'gate:drop' && d.w === 'covered'), JSON.stringify(diags));
  });

  test('(3) 句头闸 (b) 反例：Yes. 2s 后 Yes, I agree. ⇒ 2 行', () => {
    const { g, lines } = mkGate();
    g.push({ locale: 'en-US', text: 'Yes.', conf: 0.2, t0: 0, t1: 300 });
    const out = g.push({ locale: 'en-US', text: 'Yes, I agree.', conf: 0.99, t0: 2300, t1: 3200 });
    eq(out.length, 1);
    ok(lines.some((t) => /Yes\./i.test(t)), lines.join('|'));
    ok(/agree/i.test(out[0]));
  });

  test('(4) drain/超时反例：上一句 Yes, please. 后 5s 扣住 Yes. 超时 ⇒ 落行', async () => {
    const clk = fakeClock();
    const lines = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, {
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 10000, holdTimeoutMs: 3000,
      onRelease: (loc, t) => lines.push(String(t)),
      onDiag: () => {},
    }));
    const o1 = g.push({ locale: 'en-US', text: 'Yes, please.', conf: 0.99, t0: 0, t1: 1200 });
    g.push({ locale: 'en-US', text: 'Yes.', conf: 0.2, t0: 6200, t1: 6500 });
    await clk.advance(3100);
    const all = o1.concat(lines);
    ok(all.some((t) => /Yes,\s*please/i.test(t)) && all.some((t) => /Yes\./.test(t) && !/please/i.test(t)),
      '两行都应落：' + JSON.stringify(all));
  });

  test('(5) drain 正例：扣住片与已落行时间交叠且词包含 ⇒ covered 丢', () => {
    const { g, lines, diags } = mkGate();
    g.push({ locale: 'en-US', text: 'make three copies.', conf: 0.99, t0: 0, t1: 2000 });
    g.push({ locale: 'en-US', text: 'three', conf: 0.1, t0: 500, t1: 900 });
    g.flushAll();
    ok(!lines.some((t) => /^three$/i.test(t.trim())), '交叠子序列应丢：' + JSON.stringify(lines));
    ok(diags.some((d) => d.k === 'gate:drop' && d.w === 'covered'));
  });

  test('(6) 转交：英文开口前中文路 Please ⇒ 保留（run2 回归）', () => {
    const clk = fakeClock();
    const got = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: () => {},
    });
    ok(g.offer({ text: 'Please', locale: 'zh-CN', t0: 800, t1: 950 }));
    g.noteEnSample({ text: 'Please make three copies', t0: 1000, t1: 2400 });
    eq(g.pending(), true, '句首不因 covered 作废');
    eq(g.stop(), true);
    deepEq(got, ['Please']);
  });

  test('(7) 转交：英文句中 threp 垃圾 ⇒ inside-en 丢', () => {
    const clk = fakeClock();
    const got = [];
    const diags = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: (k, e) => diags.push({ k, e }),
    });
    g.noteEnSample({ text: 'three copies', t0: 1000, t1: 2000 });
    eq(g.offer({ text: 'threp', locale: 'zh-CN', t0: 1500, t1: 1700 }), false);
    eq(got.length, 0);
    ok(diags.some((d) => d.k === 'intake:xfer-drop' && d.e && d.e.why === 'inside-en'));
  });

  test('(8) 转交：Yes 对英文 Yeah. ⇒ 1 行（inside-en）', () => {
    const clk = fakeClock();
    const got = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: () => {},
    });
    g.noteEnSample({ text: 'Yeah.', t0: 1000, t1: 1400 });
    eq(g.offer({ text: 'Yes', locale: 'zh-CN', t0: 1500, t1: 1700 }), false);
    eq(got.length, 0);
  });

  test('(9) 转交：子串 an 与 1 分钟前 can 不交叠 ⇒ 仍转交', () => {
    const clk = fakeClock();
    const got = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: () => {},
    });
    g.noteEnSample({ text: 'I can do it', t0: 0, t1: 800 });
    clk.advance(60000);
    ok(g.offer({ text: 'an', locale: 'zh-CN', t0: 61000, t1: 61200 }));
    eq(g.stop(), true);
    deepEq(got, ['an']);
  });

  test('(10) 缺时间戳：句头闸 covered 不丢；转交闸用到达时刻句首判据', () => {
    const { g, lines } = mkGate();
    g.push({ locale: 'en-US', text: 'no', conf: 0.1, t0: null, t1: null });
    const out = g.push({ locale: 'en-US', text: 'I know that.', conf: 0.99, t0: 1000, t1: 2000 });
    ok(lines.some((t) => /no/i.test(t)) || out.some((t) => /no/i.test(t)), '缺 ts 不因 no⊂know 丢');
    const clk = fakeClock();
    const got = [];
    const gx = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: () => {},
    });
    gx.noteEnLetter();
    clk.advance(100);
    ok(gx.offer({ text: 'Hi', locale: 'zh-CN' }));
    eq(gx.stop(), true);
    deepEq(got, ['Hi']);
  });
});

describe('BM-025 总底线', () => {
  test('各兜底分支输入文字最终都出现在行里', async () => {
    const lines = [];
    const mkClk = () => fakeClock();
    const mk = (clk, extra) => C.makeFinalGate(Object.assign({}, DEPS, {
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 10000, holdTimeoutMs: 3000,
      onRelease: (loc, t) => lines.push(String(t)),
      onDiag: () => {},
    }, extra || {}));

    // timeout
    const c1 = mkClk();
    const g1 = mk(c1);
    g1.push({ locale: 'en-US', text: 'alpha', conf: 0.05, t0: 0, t1: 200 });
    await c1.advance(3100);
    ok(lines.some((t) => /alpha/i.test(t)), 'timeout 分支');

    // high-conf after hold
    const g2 = mk(mkClk());
    g2.push({ locale: 'en-US', text: 'beta', conf: 0.05, t0: 0, t1: 200 });
    const out2 = g2.push({ locale: 'en-US', text: 'gamma sentence', conf: 0.99, t0: 400, t1: 2000 });
    out2.forEach((t) => lines.push(t));
    ok(lines.some((t) => /beta/i.test(t)) && lines.some((t) => /gamma/i.test(t)), 'high-conf 分支');

    // flushAll / drain
    const g3 = mk(mkClk());
    g3.push({ locale: 'en-US', text: 'delta', conf: 0.05, t0: 0, t1: 200 });
    g3.flushAll();
    ok(lines.some((t) => /delta/i.test(t)), 'drain 分支');

    // xfer
    const xferClk = mkClk();
    const xfer = C.makeTransferGate({
      now: xferClk.now, setTimeout: xferClk.setT, clearTimeout: xferClk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => lines.push(String(text)),
      onDiag: () => {},
    });
    xfer.offer({ text: 'epsilon', locale: 'zh-CN', t0: 9000, t1: 9100 });
    xfer.stop();
    ok(lines.some((t) => /epsilon/i.test(t)), 'xfer 分支');
  });

  test('诊断事件不含用户文字（seg 导出 scrub）', () => {
    const { DiagLog } = loadDiag();
    DiagLog.push('seg', { reason: 'gate-timeout', calls: 1, json_bad: 0, ms: 3001, why: 'timeout' });
    DiagLog.push('seg', { reason: 'gate-drain', calls: 1, json_bad: 0, why: 'forced' });
    const exp = DiagLog.exportText();
    ok(exp.indexOf('Please') < 0 && exp.indexOf('make three') < 0, '导出无用户句');
    ok(/gate-timeout/.test(exp) && /"ms":3001/.test(exp), 'timeout 字段保留');
    delete global.DiagLog;
  });
});
