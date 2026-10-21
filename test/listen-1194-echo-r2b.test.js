// 1194 · ECHO-PROPOSAL-r2b：统一 classifyEcho 咽喉 + sameUtterance consumed 补行
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

const MODEL = fs.readFileSync(path.join(__dirname, '../src/app/listen-model.js'), 'utf8');

function diagN(diag, bucket, key) { return Number((diag[bucket] || {})[key]) || 0; }

function mkEl() {
  return { hidden: false, disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; }, getAttribute() { return ''; } };
}
let CLK_BASE = 1_792_577_000_000;
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
function makeSandbox(store) {
  const st = Object.assign({ listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false, subtitleVideoLang: 'en' }, store || {});
  const captured = { onEvent: null };
  const clk = fakeClock();
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }), ensureAssets: async () => ({ ok: true }), ensureLid: async () => ({ ok: true }), ensureVad: async () => ({ ok: true }),
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
function t1194(A) { return A._test1194(); }

function braceBody(src, openBraceIdx) {
  let depth = 0;
  for (let k = openBraceIdx; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') {
      depth--;
      if (depth === 0) return { start: openBraceIdx, end: k + 1 };
    }
  }
  return null;
}
function namedFunctionBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  const j = src.indexOf('{', i);
  const span = braceBody(src, j);
  return span ? src.slice(span.start, span.end) : null;
}
function inSpan(idx, span) { return span && idx >= span.start && idx < span.end; }
function spanOfBody(body, baseIdx) {
  if (!body) return null;
  return { start: baseIdx, end: baseIdx + body.length };
}

async function openConv() {
  const { sb, captured, clk } = makeSandbox({});
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('conv');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  ok(A.pttToggle('other'), 'conv + ptt 应能开麦');
  await clk.runTo(0);
  if (captured.h && captured.h.onState) captured.h.onState('granted', '');
  await clk.runTo(8000);
  ok(A._debug().id, 'session 未建立');
  ok(typeof captured.onEvent === 'function', 'stt onEvent 未挂上');
  return { A, captured, clk };
}

const TED_PARTIAL = "Stick too closely to what's safe and you risk starvation when the grove runs dry";
const TED_FINAL = ', you, and you risk starvation when the Grove runs dry.';

async function tedBadCutIntake(setup) {
  const { A, captured, clk } = await openConv();
  const h = t1194(A);
  h.setPartial('en', { text: TED_PARTIAL, at: h.clockNow() });
  if (setup) await setup(h, clk, A);
  captured.onEvent('final', { locale: 'en-US', text: TED_FINAL, conf: 0.9, t0: 1000, t1: 2000 });
  await clk.runTo(4000);
  await h.settleSeg('end');
  await clk.runTo(3000);
  const d = h.segDiag();
  const rows = A._debug().rows.map((r) => r.text).join(' ');
  try { await A.leave(); } catch (_) {}
  return { d, rows };
}

function makeClosedEchoRouter(setup) {
  const clk = fakeClock();
  const echo = C.makeEchoGuard();
  const drops = [];
  const rows = [];
  const classify = (t, lc) => C.classifyEcho(String(t || ''), {
    base: C.baseCode(lc), at: clk.now(), echo, src: 'closed',
  });
  const r = C.makeSegmentRouter({
    classifyEcho: classify,
    call: async () => JSON.stringify({ segments: [{ source: 'x', translation: 'T' }], remainder: '' }),
    emit: (list) => { for (const x of list) rows.push(x.source); },
    fallback: (t) => rows.push(t),
    onDiag: (kind, extra) => { if (kind === 'rescue:echo_drop') drops.push(extra || {}); },
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    idleMs: 800, endWaitMs: 500,
  });
  if (setup) setup(echo, clk);
  return { r, clk, drops, rows, echo };
}

describe('1194 · echo r2b · sameUtterance', () => {
  test('three/3 · 大小写 · 标点 · um 不补行', () => {
    const a = 'Please make three copies of this contract.';
    eq(C.sameUtterance(a, 'Please make 3 copies of this contract!').same, true);
    eq(C.sameUtterance(a, 'PLEASE MAKE THREE COPIES OF THIS CONTRACT').same, true);
    eq(C.sameUtterance('Um, please make three copies.', a).same, true);
  });
  test('Grove/grove 不额外补行', () => {
    eq(C.sameUtterance('Meet at Grove Street.', 'meet at grove street').same, true);
  });
  test('被 EN1 吞掉的独立句仍补行', () => {
    const orphan = 'Okay, and then we can leave right after lunch.';
    const finalText = 'Could you check the schedule for tomorrow?';
    eq(C.sameUtterance(orphan, finalText).same, false);
  });
});

describe('1194 · echo r2b · 结构守护', () => {
  test('listen-model 不经散落 echo.isEcho / playingLangs，feedPartialRescue 过 classifyEcho', () => {
    ok(/function classifyEchoAt/.test(MODEL));
    ok(!/echo\.isEcho/.test(MODEL), '散落 isEcho 应移除');
    ok(!/echo\.playingLangs\(/.test(MODEL) || (MODEL.match(/echo\.playingLangs\(/g) || []).length === 1, 'playingLangs 只留 intakeDecide');
    const fp = MODEL.slice(MODEL.indexOf('function feedPartialRescue'), MODEL.indexOf('function flushPartial'));
    ok(/classifyEchoAt/.test(fp), 'feedPartialRescue 入口应 classifyEcho');
    ok(/makeSegmentRouter\(\{[\s\S]*classifyEcho:/.test(MODEL), 'emitClosedStandalone 应接 classifyEcho');
    eq((MODEL.match(/feedPartialRescue\(/g) || []).length, 6, 'feedPartialRescue 调用计数');
  });

  test('段 router / cutter / fallback 只从 feedPartialRescue、releaseGateText、xfer、intakeFinal 出口调用', () => {
    const feedPartialRescue = namedFunctionBody(MODEL, 'function feedPartialRescue');
    const releaseGateText = namedFunctionBody(MODEL, 'function releaseGateText');
    const xferSig = 'onXfer: (text, locale, cand) => {';
    const xferIdx = MODEL.indexOf(xferSig);
    ok(xferIdx >= 0, '找不到 xfer onXfer');
    const xferSpan = braceBody(MODEL, MODEL.indexOf('{', xferIdx));
    const intakeSig = 'const intakeFinal = (ev0) => {';
    const intakeIdx = MODEL.indexOf(intakeSig);
    ok(intakeIdx >= 0, '找不到 intakeFinal');
    const intakeSpan = braceBody(MODEL, MODEL.indexOf('{', intakeIdx));
    const exits = [
      ['feedPartialRescue', spanOfBody(feedPartialRescue, MODEL.indexOf('function feedPartialRescue'))],
      ['releaseGateText', spanOfBody(releaseGateText, MODEL.indexOf('function releaseGateText'))],
      ['xfer', xferSpan],
      ['intakeFinal', intakeSpan],
    ];
    for (const [name, span] of exits) ok(span, name + ' 函数体解析失败');

    const segFbDef = MODEL.indexOf('function segFallback');
    const segFbBody = namedFunctionBody(MODEL, 'function segFallback');
    const makeSegFbSig = 'fallback: (text, meta) => { if (myGen !== gen) return; segFallback(text, meta); }';
    const makeSegFbIdx = MODEL.indexOf(makeSegFbSig);
    const makeSegFbSpan = braceBody(MODEL, MODEL.indexOf('{', makeSegFbIdx));

    const rules = [
      [/\bseg\.feed\s*\(/g, 'seg.feed'],
      [/\bcutter\.add\s*\(/g, 'cutter.add'],
      [/\bcut\.add\s*\(/g, 'cut.add'],
      [/\bsegFallback\s*\(/g, 'segFallback'],
    ];
    let segFbCalls = 0;
    for (const [re, label] of rules) {
      for (const m of MODEL.matchAll(re)) {
        const idx = m.index;
        if (label === 'segFallback') {
          if (inSpan(idx, spanOfBody(segFbBody, segFbDef))) continue;
          if (inSpan(idx, makeSegFbSpan)) continue;
          segFbCalls++;
        }
        const owner = exits.find(([, span]) => inSpan(idx, span));
        ok(owner, label + ' 出现在非法出口 @' + idx + '（只允许 feedPartialRescue / releaseGateText / xfer / intakeFinal）');
      }
    }
    eq((MODEL.match(/\bseg\.feed\s*\(/g) || []).length, 4, 'seg.feed 计数');
    eq((MODEL.match(/\bcutter\.add\s*\(/g) || []).length, 2, 'cutter.add 计数');
    eq((MODEL.match(/\bcut\.add\s*\(/g) || []).length, 1, 'cut.add 计数');
    eq(segFbCalls, 1, 'segFallback 只许 feedPartialRescue 直调');
  });
});

describe('1194 · echo r2b · lead_split 路径 echo_drop', () => {
  test('朗读中 · badCut lead_split 丢弃', async () => {
    const { d, rows } = await tedBadCutIntake((h) => {
      h.echoSpeaking(TED_PARTIAL, 'en');
    });
    eq(diagN(d, 'rescue', 'lead_split'), 1);
    eq(diagN(d, 'rescue', 'echo_drop'), 1);
    ok(!/stick too closely/i.test(rows), rows);
  });

  test('尾窗内 · badCut lead_split 丢弃', async () => {
    const { d, rows } = await tedBadCutIntake(async (h, clk) => {
      const t0 = h.clockNow();
      h.echoSpeaking(TED_PARTIAL, 'en');
      h.echoSpoke(t0 + 2000);
      await clk.runTo(C.ECHO_TAIL_MS - 100);
    });
    eq(diagN(d, 'rescue', 'lead_split'), 1);
    eq(diagN(d, 'rescue', 'echo_drop'), 1);
    ok(!/stick too closely/i.test(rows), rows);
  });

  test('尾窗外 · badCut lead_split 真人句首仍出行', async () => {
    const { d, rows } = await tedBadCutIntake(async (h, clk) => {
      const t0 = h.clockNow();
      h.echoSpeaking(TED_PARTIAL, 'en');
      h.echoSpoke(t0 + 2000);
      await clk.runTo(2000 + C.ECHO_TAIL_MS + 200);
    });
    eq(diagN(d, 'rescue', 'lead_split'), 1);
    eq(diagN(d, 'rescue', 'echo_drop'), 0);
    ok(/stick too closely/i.test(rows) && /risk starvation/i.test(rows), rows);
  });
});

describe('1194 · echo r2b · closed 路径 echo_drop', () => {
  test('朗读中 · emitClosedStandalone 丢弃', async () => {
    const spoken = 'At ten thousand units we can do three twenty per piece';
    const { r, clk, drops, rows } = makeClosedEchoRouter((echo, c) => {
      echo.speaking(spoken, c.now(), 'en');
    });
    await r.settle('end');
    r.feed('en-US', 'we can do three twenty per piece', { rescued: true });
    await clk.runTo(500);
    eq(drops.length, 1);
    eq(drops[0].src, 'closed');
    ok(!rows.some((t) => /three twenty per piece/i.test(t)), JSON.stringify(rows));
    r.dispose();
  });

  test('尾窗内 · emitClosedStandalone 丢弃', async () => {
    const { r, clk, drops, rows } = makeClosedEchoRouter((echo, c) => {
      const t0 = c.now();
      echo.speaking('五周可以。', t0, 'en');
      echo.spoke(t0 + 2000);
    });
    await clk.runTo(C.ECHO_TAIL_MS - 100);
    await r.settle('end');
    r.feed('en-US', '五周可以。', { rescued: true });
    await clk.runTo(500);
    eq(drops.length, 1);
    eq(drops[0].src, 'closed');
    ok(!rows.some((t) => /五周可以/.test(t)), JSON.stringify(rows));
    r.dispose();
  });

  test('尾窗外 · emitClosedStandalone 真人话仍出行', async () => {
    const { r, clk, drops, rows } = makeClosedEchoRouter((echo, c) => {
      const t0 = c.now();
      echo.speaking('五周可以。', t0, 'en');
      echo.spoke(t0 + 2000);
    });
    await clk.runTo(2000 + C.ECHO_TAIL_MS + 200);
    await r.settle('end');
    r.feed('en-US', 'Can you do four weeks instead?', { rescued: true });
    await clk.runTo(500);
    eq(drops.length, 0);
    ok(rows.some((t) => /four weeks instead/i.test(t)), JSON.stringify(rows));
    r.dispose();
  });
});

describe('1194 · echo r2b · 咽喉 echo_drop', () => {
  async function echoFlush(reason, partialText, setup) {
    const { A, clk } = await openSub();
    const h = t1194(A);
    if (setup) await setup(h, clk, A);
    h.setPartial('en', { text: partialText, at: h.clockNow() });
    h.flushPartial('en', reason, { locale: 'en-US', finalText: 'Unrelated final sentence here.', finalConf: 0.99 });
    await h.settleSeg('end');
    await clk.runTo(2000);
    const d = h.segDiag();
    const rows = A._debug().rows.map((r) => r.text).join(' ');
    try { await A.leave(); } catch (_) {}
    return { d, rows };
  }

  test('播放中 · consumed 补行路径 echo_drop', async () => {
    const spoken = 'At ten thousand units we can do three twenty per piece';
    const { d, rows } = await echoFlush('consumed', 'we can do three twenty per piece', async (h) => {
      h.echoSpeaking(spoken, 'en');
    });
    eq(diagN(d, 'rescue', 'echo_drop'), 1);
    ok(!/three twenty per piece/i.test(rows), rows);
  });

  test('尾窗 1s · pause flush echo_drop', async () => {
    const { d, rows } = await echoFlush('pause', '五周可以。', async (h, clk) => {
      const t0 = h.clockNow();
      h.echoSpeaking('五周可以。', 'en');
      h.echoSpoke(t0 + 2000);
      await clk.runTo(1000);
    });
    eq(diagN(d, 'rescue', 'echo_drop'), 1);
    ok(!/五周可以/.test(rows), rows);
  });

  test('尾窗 2.9s · timeout flush echo_drop', async () => {
    const { d, rows } = await echoFlush('timeout', '五周可以。', async (h, clk) => {
      const t0 = h.clockNow();
      h.echoSpeaking('五周可以。', 'en');
      h.echoSpoke(t0 + 2000);
      await clk.runTo(C.ECHO_TAIL_MS - 100);
    });
    eq(diagN(d, 'rescue', 'echo_drop'), 1);
    ok(!/五周可以/.test(rows), rows);
  });

  test('尾窗 3.1s · 同文字 timeout 仍出行', async () => {
    const { A, clk } = await openSub();
    const h = t1194(A);
    const t0 = h.clockNow();
    h.echoSpeaking('五周可以。', 'en');
    h.echoSpoke(t0 + 2000);
    await clk.runTo(2000 + C.ECHO_TAIL_MS + 100);
    h.setPartial('en', { text: '五周可以。', at: h.clockNow() });
    h.flushPartial('en', 'timeout', { locale: 'en-US' });
    await h.settleSeg('end');
    await clk.runTo(2000);
    eq(diagN(h.segDiag(), 'rescue', 'echo_drop'), 0);
    ok(A._debug().rows.some((r) => /五周可以/.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });

  test('尾窗内无关真话 pause 仍出行', async () => {
    const { d, rows } = await echoFlush('pause', 'Can you do four weeks instead?', async (h, clk) => {
      const t0 = h.clockNow();
      h.echoSpeaking('五周可以。', 'en');
      h.echoSpoke(t0 + 2000);
      await clk.runTo(500);
    });
    eq(diagN(d, 'rescue', 'echo_drop'), 0);
    ok(/four weeks instead/i.test(rows), rows);
  });

  test('consumed_same · 改写 partial 不补行', async () => {
    const { A, clk } = await openSub();
    const h = t1194(A);
    const partial = 'Please make three copies of this contract and send them to my office.';
    const finalText = 'Please make 3 copies of this contract and send them to my office.';
    h.setPartial('en', { text: partial, at: h.clockNow() });
    h.flushPartial('en', 'consumed', { locale: 'en-US', finalText, finalConf: 0.99 });
    await h.settleSeg('end');
    await clk.runTo(2000);
    eq(diagN(h.segDiag(), 'rescue', 'consumed_same'), 1);
    eq(diagN(h.segDiag(), 'rescue', 'echo_drop'), 0);
    const rows = A._debug().rows.map((r) => r.text);
    eq(rows.filter((t) => /three copies|3 copies/i.test(t)).length, 0, JSON.stringify(rows));
    try { await A.leave(); } catch (_) {}
  });

  test('consumed · orphan 句补单独一行', async () => {
    const { A, clk } = await openSub();
    const h = t1194(A);
    h.setPartial('en', { text: 'Okay, and then we can leave right after lunch.', at: h.clockNow() });
    h.flushPartial('en', 'consumed', {
      locale: 'en-US',
      finalText: 'Could you check the schedule for tomorrow?',
      finalConf: 0.99,
    });
    await h.settleSeg('end');
    await clk.runTo(2000);
    ok(A._debug().rows.some((r) => /leave right after lunch/i.test(r.text)), JSON.stringify(A._debug().rows));
    eq(diagN(h.segDiag(), 'rescue', 'consumed_same'), 0);
    try { await A.leave(); } catch (_) {}
  });
});
