// 1194 · lead-mac-r2b（LEAD-R2B）：pause 短 partial / 连读 garbage final / from-partial 分流
const { describe, test, ok, eq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

function norm(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function withinDup(text, k) {
  const s = norm(text);
  for (let i = 0; i + k <= s.length; i++) {
    const seg = s.slice(i, i + k);
    if (s.indexOf(seg, i + 1) >= 0) return { seg, i };
  }
  return null;
}
function mkEl() {
  return { hidden: false, disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; }, getAttribute() { return ''; } };
}
let CLK_BASE = 1_792_576_000_000;
function fakeClock() {
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
function makeSandbox() {
  const st = { listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false, subtitleVideoLang: 'en' };
  const captured = { h: null, onEvent: null };
  const clk = fakeClock();
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true }), ensureAssets: async () => ({ ok: true }), ensureLid: async () => ({ ok: true }), ensureVad: async () => ({ ok: true }),
    lidPause: () => {}, diagAudio: () => {}, onLid: () => () => {},
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
      get: (keys, cb) => { if (typeof keys === 'string') cb(Object.assign({}, st, keys in st ? { [keys]: st[keys] } : {})); else cb(Object.assign({}, st)); },
      set: (o2, cb) => { Object.assign(st, o2); if (cb) cb(); },
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
        return JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' });
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
function diagN(diag, bucket, key) { return ((diag || {})[bucket] || {})[key] || 0; }
async function openSub() {
  const { sb, captured, clk } = makeSandbox();
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('subtitle');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  await A.start();
  await clk.runTo(0);
  if (captured.h && captured.h.onState) captured.h.onState('granted', '');
  await clk.runTo(8000);
  return { A, captured, clk };
}
async function settleEnd(A, clk) {
  await clk.runTo(4000);
  const h = A._test1194();
  if (h.settleSeg) await h.settleSeg('end');
  await clk.runTo(3000);
}

describe('1194 · lead-mac-r2b', () => {
  test('A-pause-orphan · 短 partial I think 在 closed 后仍出行且无重复词', async () => {
    const { A, captured, clk } = await openSub();
    captured.onEvent('partial', { locale: 'en-US', text: 'Could you check the schedule for tomorrow?' });
    await clk.runTo(50);
    captured.onEvent('final', { locale: 'en-US', text: 'Could you check the schedule for tomorrow?', conf: 0.99, t0: 1000, t1: 3200 });
    await clk.runTo(60);
    captured.onEvent('partial', { locale: 'en-US', text: 'I think' });
    await clk.runTo(20);
    A.pause('user');
    await clk.runTo(4000);
    await A.end();
    await clk.runTo(5000);
    const out = A._debug().rows.map((r) => r.text).join(' ');
    ok(/I think/i.test(out), out);
    ok(/schedule for tomorrow/i.test(out), out);
    eq(withinDup(out, 12), null, '重复词：' + out);
    eq(diagN(A._debug().seg.diag, 'rescue', 'lead_flush'), 1);
    eq(diagN(A._debug().seg.diag, 'rescue', 'lead_split'), 0);
    try { await A.leave(); } catch (_) {}
  });
  test('A-pause-late-close · pause 后立刻 end 不丢 I think', async () => {
    const { A, captured, clk } = await openSub();
    captured.onEvent('partial', { locale: 'en-US', text: 'Could you check the schedule for tomorrow?' });
    await clk.runTo(50);
    captured.onEvent('final', { locale: 'en-US', text: 'Could you check the schedule for tomorrow?', conf: 0.99, t0: 1000, t1: 3200 });
    await clk.runTo(60);
    captured.onEvent('partial', { locale: 'en-US', text: 'I think' });
    A.pause('user');
    await A.end();
    await clk.runTo(5000);
    const out = A._debug().rows.map((r) => r.text).join(' ');
    ok(/I think/i.test(out), out);
    try { await A.leave(); } catch (_) {}
  });
  test('B-back-to-back · EN1 定稿后 garbage final 两句内容都在行里', async () => {
    const { A, captured, clk } = await openSub();
    captured.onEvent('partial', { locale: 'en-US', text: 'Please make three copies of this contract and send them to my office.' });
    await clk.runTo(40);
    captured.onEvent('final', { locale: 'en-US', text: 'Please make 3 copies of this contract and send them to my office.', conf: 0.99, t0: 1000, t1: 4000 });
    await clk.runTo(50);
    captured.onEvent('partial', { locale: 'en-US', text: 'Okay, and then we can leave right after lunch.' });
    await clk.runTo(70);
    captured.onEvent('final', {
      locale: 'en-US',
      text: 'Please make 3 companies in this country after and send them to my office.',
      conf: 0.56, t0: 4100, t1: 9000,
    });
    await settleEnd(A, clk);
    const out = A._debug().rows.map((r) => r.text).join(' ');
    ok(/copies of this contract/i.test(out) && /send them to my office/i.test(out), out);
    ok(/okay.*lunch|leave right after lunch/i.test(out), out);
    try { await A.leave(); } catch (_) {}
  });
  test('C-from-partial · Q B 走 final:from-partial 且 lead/lead_split 为 0', async () => {
    const { A, captured, clk } = await openSub();
    captured.onEvent('partial', { locale: 'en-US', text: 'Q B' });
    await clk.runTo(30);
    captured.onEvent('final', { locale: 'en-US', text: '...............', conf: 0.2, t0: 1000, t1: 2000 });
    await clk.runTo(20);
    captured.onEvent('final', { locale: 'en-US', text: '....', conf: 0.15, t0: 2100, t1: 2400 });
    await settleEnd(A, clk);
    const rows = A._debug().rows.map((r) => r.text);
    ok(rows.some((r) => /\bQ\s+B\b/i.test(r)), JSON.stringify(rows));
    const d = A._debug().seg.diag || {};
    eq(diagN(d, 'final', 'from-partial'), 1);
    eq(diagN(d, 'rescue', 'lead'), 0);
    eq(diagN(d, 'rescue', 'lead_split'), 0);
    try { await A.leave(); } catch (_) {}
  });
});
