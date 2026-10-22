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
    deepEq(g.push({ locale: 'en-US', text: 'three copies of this contract.', conf: 0.98, t0: 500, t1: 3000 }),
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

  test('英文路已覆盖同一区间 ⇒ 才丢且不重复转交', async () => {
    const clk = fakeClock();
    const got = [];
    const g = C.makeTransferGate({
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500, coverMs: 1500,
      canXfer: () => true,
      onXfer: (text) => got.push(text),
      onDiag: () => {},
    });
    ok(g.offer({ text: 'Please', locale: 'zh-CN', t0: 1000, t1: 1200 }));
    g.noteEnSample({ text: 'Please make', t0: 1000, t1: 1400 });
    eq(g.pending(), false);
    eq(g.stop(), false);
    eq(got.length, 0, '已覆盖 ⇒ 不重复转交');
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
