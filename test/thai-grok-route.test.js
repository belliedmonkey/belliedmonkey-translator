// test/thai-grok-route.test.js — 泰语 Grok STT 的 listen 路由（docs/thai-grok-stt-demo-spec.md 步 2）。
//
// 加载真的 src/app/listen-model.js（esbuild 打包后在 vm 里跑），用假时钟 + 假 NativeSpeech /
// 假 GrokStt 驱动到 openDevice：不设真 key、不真连网、不 sleep。
//
// 三条口径：
//   ① 开关关 + otherLang=th：th 仍进 NativeSpeech.sttOpen 的 locales；GrokStt.open 一次都不调。
//   ② 开关开 + otherLang=th（myLang=zh）：GrokStt.open 且 locale 基码 th；stt-start 的 locales
//      不含 th（若仍开原生，只含 zh）。
//   ③ 开关开 + otherLang=en（无 th）：GrokStt.open 不调；NativeSpeech 仍开 en。
const { test, ok, eq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟（与 test/listen-ptt-e2e.test.js 同一套）──────────────────────────────
let CLK_BASE = 1_700_000_000_000;
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
  const sttCalls = [];      // NativeSpeech.sttOpen 的入参
  const grokCalls = [];     // GrokStt.open 的入参
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    ensureAssets: async () => ({ ok: true }),
    ensureLid: async () => ({ ok: true }),
    ensureVad: async () => ({ ok: true }),
    lidPause: () => {}, diagAudio: () => {},
    onLid: (fn) => { captured.lid = fn; return () => {}; },
    sttOpen: (x) => {
      sttCalls.push(x);
      captured.onEvent = x.onEvent;
      return { sendPcm: () => true, close() {}, cut() {} };
    },
  };
  const GrokStt = {
    open: (x) => {
      grokCalls.push(x);
      // 步 2b 热修用例：模拟 App 内没有 key —— open 返回后异步报 no-key（不抛、不真连）。
      if (o.grokNoKey) clk.setT(() => { try { if (typeof x.onEvent === 'function') x.onEvent('error', { reason: 'no-key' }); } catch (_) {} }, 0);
      return {
        sendPcm() {},
        cut() {},
        // 与真 GrokStt.close() 同形：**同步** fire('close')。listen 的主动 close 必须把它
        // 当作「我关的」，不能读成掉线（改语言那条路 close 时 phase 还是 listening）。
        close() { try { if (typeof x.onEvent === 'function') x.onEvent('close', { reason: 'client' }); } catch (_) {} },
      };
    },
  };
  const NativeAudio = {
    available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok' }),
    micStart: (rate, h) => { captured.h = h; return true; }, micStop: () => {}, recordMode: () => {},
    sessionStart: () => {}, sessionStop: () => {}, onEvent: () => {}, onTick: () => {},
    playingState: () => {}, nowPlaying: () => {},
    subtitleShow: () => {}, subtitleState: () => {}, subtitleConfig: () => {}, subtitleHide: () => {}, subtitleFloat: () => {},
  };
  const tr = { provider: 'deepseek', apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };
  // 假 storage：thaiGrokStt 由用例开关；**不**放 thaiGrokSttApiKey（测试不设真 key）。
  const storage = {
    listenOtherLang: o.otherLang || 'en',
    listenMyLang: o.myLang || 'zh',
    listenAutoSpeak: false,
    listenCapture: false,
    thaiGrokStt: !!o.thaiGrokStt,
  };
  const sb = {
    // Registry.langs() 读 window.MT_LANGS（src/lib/registry.js）；没有它 langOk('th') 为假，
    // readCfg 会把 otherLang 自愈成 en —— 测试前提就不成立了。
    window: { addEventListener() {}, removeEventListener() {}, AudioContext: function () {}, webkitAudioContext: function () {},
      MT_LANGS: [{ code: 'zh' }, { code: 'en' }, { code: 'th' }] },
    document: { getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(), hidden: false },
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: {
      get: (k, cb) => cb(storage),
      set: (o2, cb) => { if (cb) cb(); },
    }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: C, NativeAudio, NativeSpeech, GrokStt,
    DiagLog: { push: () => {} },
    MTTelemetry: { track: () => {}, once: () => {} }, MTFeedback: {},
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
  return { sb, captured, clk, sttCalls, grokCalls };
}

// 把会话开到「收音中、socket 已建好」的稳定态（全部由假时钟驱动，不 sleep）。
async function openSession(opts) {
  const o = opts || {};
  const { sb, captured, clk, sttCalls, grokCalls } = makeSandbox(o);
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('conv');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  if (o.noPtt) {
    // 不按住某一侧：sessionLocales = deviceLocales(cfg)（我的语言 + 对方语言），
    // 这样开关开 + th 时能同时看到原生(zh) 与 Grok(th) 两个句柄。
    await A.start();
    await clk.runTo(0);
    if (captured.h && captured.h.onState) captured.h.onState('granted', '');
    await clk.runTo(0);
  } else {
    A.pttToggle('other');
    await clk.runTo(0);
    if (captured.h && captured.h.onState) captured.h.onState('granted', '');
    await clk.runTo(0);
  }
  return { A, captured, clk, sttCalls, grokCalls };
}

const base = (loc) => String(loc || '').split(/[-_]/)[0].toLowerCase();
const sttLocales = (calls) => calls.reduce((a, x) => a.concat(x && x.locales ? x.locales : []), []);

test('★ 步 2 路由①：开关关 + otherLang=th ⇒ 原生 locales 含 th；GrokStt.open 未被调用', async () => {
  const { A, sttCalls, grokCalls } = await openSession({ thaiGrokStt: false, otherLang: 'th', myLang: 'zh', noPtt: true });
  try {
    eq(grokCalls.length, 0, '开关关时不该调用 GrokStt.open：' + JSON.stringify(grokCalls.map((x) => x.locale)));
    ok(sttCalls.length > 0, '开关关时 NativeSpeech.sttOpen 应照旧被调用');
    const locs = sttLocales(sttCalls);
    ok(locs.some((l) => base(l) === 'th'), '开关关时 th 必须仍在 stt-start 的 locales 里：' + JSON.stringify(locs));
  } finally { try { await A.leave(); } catch (_) {} }
});

test('★ 步 2 路由②：开关开 + otherLang=th ⇒ GrokStt.open（locale 基码 th）；stt-start 不含 th', async () => {
  const { A, sttCalls, grokCalls } = await openSession({ thaiGrokStt: true, otherLang: 'th', myLang: 'zh', noPtt: true });
  try {
    eq(grokCalls.length, 1, '开关开且本场有 th 时必须且只开一路 GrokStt：' + grokCalls.length);
    eq(base(grokCalls[0] && grokCalls[0].locale), 'th', 'GrokStt.open 的 locale 基码不是 th：' + JSON.stringify(grokCalls[0] && grokCalls[0].locale));
    eq(typeof (grokCalls[0] && grokCalls[0].getApiKey), 'function', 'GrokStt.open 必须拿到 getApiKey（无 key 时由 GrokStt 异步报 no-key）');
    ok(sttCalls.length > 0, '本场还有 zh，NativeSpeech.sttOpen 应仍开一路（只含 zh）');
    eq(typeof grokCalls[0].onEvent, 'function', 'Grok 路必须有事件回调');
    ok(grokCalls[0].onEvent !== sttCalls[0].onEvent, 'Grok 路要单独包一层 source 标记（步 2b 热修），不能与原生直接共用同一个函数');
    const locs = sttLocales(sttCalls);
    ok(!locs.some((l) => base(l) === 'th'), 'th 与原生互斥失败：stt-start 里仍有 th：' + JSON.stringify(locs));
    ok(locs.length > 0 && locs.every((l) => base(l) === 'zh'), '原生只应保留非 th 的语言（本例 zh）：' + JSON.stringify(locs));
  } finally { try { await A.leave(); } catch (_) {} }
});

test('★ 步 2b 热修：开关开 + zh+th + 无 key ⇒ Grok 报 no-key 后 phase 不 halt，原生路仍 listening', async () => {
  const { A, captured, clk, sttCalls, grokCalls } = await openSession({
    thaiGrokStt: true, otherLang: 'th', myLang: 'zh', noPtt: true, grokNoKey: true,
  });
  try {
    eq(grokCalls.length, 1, '本场有 th 且开关开，应开一路 Grok');
    ok(sttCalls.length > 0, '本场还有 zh，原生路应照旧开着');
    const locs = sttLocales(sttCalls);
    ok(locs.length > 0 && locs.every((l) => base(l) === 'zh'), '原生路只该保留非 th 语言：' + JSON.stringify(locs));
    // 假 GrokStt 在 open 后异步发 no-key；openSession 已用假时钟跑到那一拍。
    const d = A._debug();
    eq(d.phase, 'listening', 'th 路 no-key 把整场拖进了 ' + d.phase + '，原生 zh 路被误杀');
    // 原生路仍可用：再喂一条 zh partial，phase 不应变化（没有 socketLost）。
    if (captured.h && captured.h.onState) captured.h.onState('granted', '');
    captured.onEvent('partial', { locale: 'zh-CN', text: '你好' });
    await clk.runTo(0);
    eq(A._debug().phase, 'listening', 'no-key 之后原生路事件不再被接收（整场已 halt）');
  } finally { try { await A.leave(); } catch (_) {} await clk.runTo(0); }
});

test('★ 步 2 路由③：开关开 + otherLang=en（无 th）⇒ GrokStt.open 未调用；原生仍开 en', async () => {
  const { A, sttCalls, grokCalls } = await openSession({ thaiGrokStt: true, otherLang: 'en', myLang: 'zh', noPtt: true });
  try {
    eq(grokCalls.length, 0, '无 th 时不该调用 GrokStt.open：' + JSON.stringify(grokCalls.map((x) => x.locale)));
    ok(sttCalls.length > 0, '无 th 时仍应走原来的 NativeSpeech.sttOpen');
    const locs = sttLocales(sttCalls);
    ok(locs.some((l) => base(l) === 'en'), '原生路仍应开 en：' + JSON.stringify(locs));
    ok(!locs.some((l) => base(l) === 'th'), '本场无 th，stt-start 不该出现 th：' + JSON.stringify(locs));
  } finally { try { await A.leave(); } catch (_) {} }
});

test('★ 步 2 路由④：主动 close 时 GrokStt 同步发的 close 不得被当成掉线（改语言仍能重连）', async () => {
  const { A, sttCalls, clk } = await openSession({ thaiGrokStt: true, otherLang: 'th', myLang: 'zh', noPtt: true });
  try {
    eq(A._debug().phase, 'listening', '测试前提：开场后应处在收音中');
    const before = sttCalls.length;
    A.langChange('other', 'en');      // 本机路改语言 ⇒ closeSocket 后重连
    await clk.runTo(0);
    const d = A._debug();
    ok(d.phase !== 'halted', '主动 close 的 close 事件被读成掉线，改语言整场 halt 在「断线」：' + d.phase);
    ok(sttCalls.length > before, '改语言后没有重新 NativeSpeech.sttOpen（重连没发生）');
  } finally { try { await A.leave(); } catch (_) {} await clk.runTo(0); }
});
