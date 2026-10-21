// test/listen-1194-s1.test.js — 1.19.4 S1：标点开头定稿补句首合并同一行（推翻 #592 删补句首）
const fs = require('fs');
const path = require('path');
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
        timers.delete(n.id); t = Math.max(t, n.x.at); n.x.fn(); await flush();
      }
      t = end; await flush();
    },
  };
}
function makeSandbox(store) {
  const st = Object.assign({ listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false, subtitleVideoLang: 'en' }, store || {});
  const captured = { h: null, onEvent: null };
  const clk = fakeClock();
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    ensureAssets: async () => ({ ok: true }), ensureLid: async () => ({ ok: true }), ensureVad: async () => ({ ok: true }),
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
      get: (keys, cb) => {
        if (typeof keys === 'string') cb(Object.assign({}, st, keys in st ? { [keys]: st[keys] } : {}));
        else cb(Object.assign({}, st));
      },
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
async function openListen1194() {
  const { sb, captured, clk } = makeSandbox({ subtitleVideoLang: 'en' });
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('subtitle');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  await A.start();
  await clk.runTo(0);
  if (captured.h && captured.h.onState) captured.h.onState('granted', '');
  await clk.runTo(8000);
  ok(A._debug().id, 'session 未建立');
  return { A, captured, clk };
}
async function openListen1194Conv() {
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
  return { A, captured, clk };
}
function t1194(A) { return A._test1194(); }
function diagN(diag, bucket, key) { return Number((diag[bucket] || {})[key]) || 0; }
function bufOf(p) {
  const s = String((p && p.user) || p || '');
  const parts = s.split('BUF:\n');
  if (parts.length > 1) return parts[1].split('\nFORCE:')[0].trim();
  return s.trim();
}
function makeSegRouter(o) {
  const opt = o || {};
  const clk = fakeClock();
  const ev = [], diags = [];
  const r = C.makeSegmentRouter(Object.assign({
    call: async (p) => JSON.stringify({ segments: [{ source: bufOf(p), translation: 'T' }], remainder: '' }),
    emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
    fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
    onDiag: (kind, extra) => diags.push({ kind, extra }),
    ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    idleMs: opt.idleMs || 1500, endWaitMs: 3000,
  }, opt.deps || {}));
  return { r, clk, ev, diags };
}
const segEmitted = (ev) => ev.filter((e) => e.t === 'emit').flatMap((e) => e.rows.map((x) => x.source));

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const MODEL = strip(read('src/app/listen-model.js'));

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

function intakeLeadMerge(ev, partialBy, diags) {
  const base = C.baseCode(ev.locale);
  const pNow = partialBy[base];
  let text = ev.text;
  if (pNow && !pNow.leadUsed) {
    const cut = C.rescueLeadCut(ev.text, pNow.text);
    if (cut && cut.lead) {
      text = C.mergeRescueLead(cut.lead, cut.text);
      partialBy[base] = Object.assign({}, pNow, { leadUsed: true });
      diags.push({ kind: 'rescue:lead' });
    } else if (cut && cut.text && cut.text !== ev.text) text = cut.text;
  }
  return text;
}

describe('S1 · rescueLeadCut / mergeRescueLead', () => {
  test('EN1：定稿 ", and send…" + partial 整句 ⇒ 合并一条', () => {
    const cut = C.rescueLeadCut(', and send them to my office',
      'Please make three copies of this contract and send them to my office');
    ok(cut && cut.lead.indexOf('Please make three copies') >= 0, JSON.stringify(cut));
    const merged = C.mergeRescueLead(cut.lead, cut.text);
    ok(/please make three copies/i.test(merged) && /send them to my office/i.test(merged), merged);
  });
  test('中文：定稿「，明天之前发给我」+ partial 整句 ⇒ 不加空格合并', () => {
    const cut = C.rescueLeadCut('，明天之前发给我', '请把这份报告翻译成英文，明天之前发给我');
    ok(cut && cut.lead.indexOf('请把这份报告') >= 0, JSON.stringify(cut));
    const merged = C.mergeRescueLead(cut.lead, cut.text);
    ok(merged.indexOf('请把这份报告翻译成英文') >= 0 && merged.indexOf('明天之前发给我') >= 0, merged);
    ok(!/\u82f1\u6587\s，/.test(merged), '中文与标点开尾不应插空格：' + merged);
  });
  test('#590 L：`, you, and you risk…` 切垃圾前缀、不借 partial 句首', () => {
    const cut = C.rescueLeadCut(', you, and you risk starvation.', 'and you risk starvation when dry');
    ok(cut && /and you risk starvation/i.test(cut.text) && !/^,\s*you/i.test(cut.text), JSON.stringify(cut));
    ok(!cut.lead, '对不上的 partial 不应硬补句首');
  });
  test('约束 3：对不上 partial ⇒ 不补', () => {
    eq(C.rescueLeadCut(', totally different final words here', 'Please make three copies only'), null);
  });
  test('约束 2：不以标点开头 ⇒ 不补', () => {
    eq(C.rescueLeadCut('Please make copies', 'Please make three copies of this contract'), null);
  });
});

describe('S1 · EN1 回放（单 feed、一行、rescue:lead）', () => {
  test('★ partial + 标点开尾定稿 ⇒ 一行且 diag rescue:lead=1', async () => {
    const partialBy = {};
    const diags = [];
    const rows = [];
    let feeds = 0;
    const seg = C.makeSegmentRouter({
      call: (p) => {
        const m = String(p).match(/BUF:\n([\s\S]*?)\nFORCE:/);
        const buf = m ? m[1].trim() : '';
        return Promise.resolve(JSON.stringify({ segments: [{ source: buf, translation: 'T' }], remainder: '' }));
      },
      emit: (list) => { for (const r of list) rows.push(r.source); },
      fallback: (t) => rows.push(t),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      idleMs: 1500, endWaitMs: 3000,
    });
    const origFeed = seg.feed.bind(seg);
    seg.feed = (...args) => { feeds++; return origFeed(...args); };
    const gate = C.makeFinalGate({ dominantScript: () => 'Latin', now: () => Date.now(), idleMs: 1500 });
    partialBy.en = { text: 'Please make three copies of this contract and send them to my office', at: Date.now() };
    const merged = intakeLeadMerge({ locale: 'en-US', text: ', and send them to my office', conf: 0.9, t0: 1, t1: 2 }, partialBy, diags);
    const texts = gate.push({ locale: 'en-US', text: merged, conf: 0.9, t0: 1, t1: 2 });
    for (const tt of texts) seg.feed('en-US', tt);
    await seg.settle('end');
    eq(diags.filter((d) => d.kind === 'rescue:lead').length, 1, JSON.stringify(diags));
    eq(feeds, texts.length, '只 feed 一次（合并后）：' + feeds);
    eq(rows.length, 1, JSON.stringify(rows));
    ok(/please make three copies/i.test(rows[0]), rows[0]);
    seg.dispose();
  });
});

describe('S1 · 约束 2 反例', () => {
  test('跨 base 不借 partial', () => {
    const partialBy = { zh: { text: '请把这份报告翻译成英文，明天之前发给我', at: 0 } };
    const diags = [];
    const out = intakeLeadMerge({ locale: 'en-US', text: ', and send them to my office', conf: 0.9 }, partialBy, diags);
    eq(out, ', and send them to my office');
    eq(diags.length, 0);
  });
  test('同段 partial 句首只救一次', () => {
    const partialBy = { en: { text: 'Please make three copies of this contract and send them to my office', at: 0 } };
    const diags = [];
    intakeLeadMerge({ locale: 'en-US', text: ', and send them to my office', conf: 0.9 }, partialBy, diags);
    eq(diags.length, 1);
    const out2 = intakeLeadMerge({ locale: 'en-US', text: ', again tail words', conf: 0.9 }, partialBy, diags);
    eq(out2, ', again tail words');
    eq(diags.length, 1, '第二次不应再 rescue:lead');
  });
});

describe('S1 · hardCut / authStop 合并句首不重复不丢', () => {
  test('hardCut 交旧路：合并后的整句原文照出、句首不重复', async () => {
    const merged = C.mergeRescueLead(
      'Please make three copies of this contract',
      C.rescueLeadCut(', and send them to my office', 'Please make three copies of this contract and send them to my office').text,
    );
    const ev = [];
    const r = C.makeSegmentRouter({
      call: () => Promise.reject(new Error('net')),
      emit: (rows, meta) => ev.push({ t: 'emit', rows, orig: meta.orig }),
      fallback: (s) => ev.push({ t: 'fallback', text: s }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    });
    r.feed('en-US', merged);
    r.settle('stop'); await tick();
    r.settle('stop'); await tick();
    ok(ev.some((e) => e.t === 'fallback'), '应 hardCut 交旧路');
    const shown = ev.filter((e) => e.t === 'fallback').map((e) => e.text).join(' ');
    const hits = (shown.match(/please make three copies/gi) || []).length;
    ok(hits <= 1, '句首重复出现：' + shown);
    ok(/send them to my office/i.test(shown), '尾巴丢失：' + shown);
    r.dispose();
  });
  test('authStop：合并后的整句原文照出一次、不重复句首', async () => {
    const merged = C.mergeRescueLead(
      'Please make three copies of this contract',
      ', and send them to my office',
    );
    const err = Object.assign(new Error('402'), { status: 402, grant: true, code: 'credit_exhausted' });
    const ev = [];
    const r = C.makeSegmentRouter({
      call: () => Promise.reject(err),
      emit: (rows, meta) => ev.push({ t: 'emit', orig: meta.orig, rows }),
      fallback: (s) => ev.push({ t: 'fallback', text: s }),
      onQuota: (e) => ev.push({ t: 'quota', grant: !!(e && e.grant) }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    });
    r.feed('en-US', merged);
    r.settle('switch');
    await tick();
    eq(ev.filter((e) => e.t === 'fallback').length, 0, 'authStop 不应走旧路');
    const shown = ev.filter((e) => e.t === 'emit').map((e) => e.orig).join('');
    ok(shown.indexOf('Please make three copies') >= 0 && /send them to my office/i.test(shown), shown);
    ok((shown.match(/please make three copies/gi) || []).length <= 1, '句首重复：' + shown);
    eq(ev.filter((e) => e.t === 'quota').length, 1);
    r.dispose();
  });
});

describe('S1 · 生产入口形状', () => {
  test('listen-model：merge 在 gate 前、无单独 feed lead', () => {
    ok(/rescueLeadCut/.test(MODEL));
    ok(/mergeRescueLead/.test(MODEL));
    ok(/diagBump\('rescue',\s*'lead'/.test(MODEL));
    ok(!/seg\.feed\(ev\.locale,\s*lead/.test(MODEL));
    ok(/leadUsed/.test(MODEL), 'partial 句首消费标记');
    ok(/function flushPartial\(/.test(MODEL), '1194 A：flushPartial 唯一出口');
  });
  test('1194 A：delete partialBy 只在 flushPartial 内', () => {
    const fpStart = MODEL.indexOf('function flushPartial(');
    const fpEnd = MODEL.indexOf('function flushAllPartials', fpStart);
    ok(fpStart >= 0 && fpEnd > fpStart, '找不到 flushPartial');
    const flushBody = MODEL.slice(fpStart, fpEnd);
    ok((flushBody.match(/delete partialBy/g) || []).length >= 1, 'flushPartial 内应有 delete');
    const hookAt = MODEL.indexOf('_test1194:');
    for (const m of MODEL.matchAll(/delete partialBy/g)) {
      const idx = m.index;
      const inFlush = idx >= fpStart && idx < fpEnd;
      const inHook = hookAt >= 0 && idx > hookAt && idx < hookAt + 400 && /setPartial:/.test(MODEL.slice(hookAt, idx + 20));
      ok(inFlush || inHook, '非法 delete partialBy @ offset ' + idx);
    }
    ok(!/partialBy\s*=\s*\{\}/.test(MODEL.replace(/let partialBy = \{\}/, '')), '不得整体重置 partialBy');
  });
});

describe('1194 · flushPartial / 九条', () => {
  test('② lead_split：入口与纯函数存在', () => {
    ok(typeof C.rescueLeadSplit === 'function');
    ok(/lead_split/.test(MODEL));
    ok(/rescueLeadSplit/.test(MODEL));
  });
  test('pause / source：关麦与切源走 flushAllPartials', () => {
    ok(/clearPartials\('pause'\)/.test(MODEL));
    ok(/flushAllPartials\('source'\)/.test(MODEL));
    ok(/clearPartials\(reason === 'grant' \? 'authstop' : 'pause'\)/.test(MODEL));
    ok(!/closeSocket\(\);\s*\n\s*nativeSessionOff\(\);\s*\n\s*if \(inc\) inc\.reset\(\);\s*\n\s*clearPartials/.test(MODEL), 'halt 应先 clearPartials 再 closeSocket');
  });
  test('⑨ 连说两句：第二句 partial 不借第一句 base', () => {
    const partialBy = { en: { text: 'First sentence complete.', at: 0, leadUsed: true } };
    const diags = [];
    const out = intakeLeadMerge({ locale: 'en-US', text: ', second sentence tail', conf: 0.9 }, partialBy, diags);
    eq(out, ', second sentence tail');
    eq(diags.length, 0);
  });
});

describe('1194 · 生产 flushPartial（_test1194）', () => {
  test('④ timeout：partial 当定稿出行 final:from-partial', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    h.setPartial('en', { text: 'Please make three copies', at: clk.now() - 3000 });
    h.flushPartial('en', 'timeout', { locale: 'en-US' });
    await h.settleSeg('end');
    await clk.runTo(3000);
    eq(diagN(h.segDiag(), 'final', 'from-partial'), 1);
    eq(h.partialKeys().length, 0);
    ok(A._debug().rows.some((r) => /please make three copies/i.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('B · flushPartial 幂等：同 base 调两次只出一行', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    h.setPartial('en', { text: 'orphan partial line', at: clk.now() });
    h.flushPartial('en', 'pause', { locale: 'en-US' });
    h.flushPartial('en', 'pause', { locale: 'en-US' });
    await h.settleSeg('end');
    await clk.runTo(3000);
    const hits = A._debug().rows.filter((r) => /orphan partial line/i.test(r.text));
    eq(hits.length, 1, JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('④ pause 集成：暂停后 orphan partial 出行且记 lead_flush:pause', async () => {
    const { A, clk } = await openListen1194();
    eq(A._debug().phase, 'listening', '应进入 listening 才能测 pause：' + A._debug().phase);
    t1194(A).setPartial('en', { text: 'paused orphan partial line', at: clk.now() });
    A.pause('user');
    await clk.runTo(4000);
    ok(A._debug().rows.some((r) => /paused orphan partial/i.test(r.text)), JSON.stringify(A._debug().rows));
    eq(diagN(t1194(A).segDiag(), 'rescue', 'lead_flush'), 1);
    try { await A.leave(); } catch (_) {}
  });
  test('⑧ authstop：flush 在 segDegrade 前仍出行', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    h.setPartial('en', { text: 'quota halt orphan partial', at: clk.now() });
    h.flushPartial('en', 'authstop', { locale: 'en-US' });
    await h.settleSeg('end');
    await clk.runTo(3000);
    ok(A._debug().rows.some((r) => /quota halt orphan/i.test(r.text)), JSON.stringify(A._debug().rows));
    eq(diagN(h.segDiag(), 'rescue', 'lead_flush'), 1);
    try { await A.leave(); } catch (_) {}
  });
  test('empty：partial 空串触发 flush 仍出行上一帧文字', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    h.setPartial('en', { text: 'empty partial orphan', at: clk.now() });
    h.flushPartial('en', 'empty', { locale: 'en-US' });
    await h.settleSeg('end'); await clk.runTo(2000);
    ok(A._debug().rows.some((r) => /empty partial orphan/i.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('无 opt.locale：localeForBase/toLocale 兜底仍出行', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    h.setPartial('fr', { text: 'no locale partial orphan', at: clk.now() });
    h.flushPartial('fr', 'timeout', {});
    await h.settleSeg('end'); await clk.runTo(2000);
    ok(A._debug().rows.some((r) => /no locale partial orphan/i.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('未知 reason：整段 partial 出行不静默删', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    h.setPartial('en', { text: 'unknown reason orphan', at: clk.now() });
    h.flushPartial('en', 'weird-reason', { locale: 'en-US' });
    await h.settleSeg('end'); await clk.runTo(2000);
    ok(A._debug().rows.some((r) => /unknown reason orphan/i.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('echo · 朗读中 partial 丢弃且记 lead_flush:echo_drop', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    const spoken = 'At ten thousand units we can do three twenty per piece';
    h.echoSpeaking(spoken, 'en');
    h.setPartial('en', { text: 'we can do three twenty per piece', at: h.clockNow() });
    h.flushPartial('en', 'echo', { locale: 'en-US' });
    await h.settleSeg('end'); await clk.runTo(2000);
    eq(diagN(h.segDiag(), 'rescue', 'lead_flush'), 1);
    ok(!A._debug().rows.some((r) => /three twenty per piece/i.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('echo · 播完尾窗内 isEcho 丢弃 partial', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    const t0 = h.clockNow();
    h.echoSpeaking('五周可以。', 'en');
    h.echoSpoke(t0 + 2000);
    await clk.runTo(2000 + C.ECHO_TAIL_MS - 50);
    h.setPartial('en', { text: '五周可以。', at: h.clockNow() });
    h.flushPartial('en', 'echo', { locale: 'en-US' });
    await h.settleSeg('end'); await clk.runTo(500);
    eq(diagN(h.segDiag(), 'rescue', 'lead_flush'), 1);
    ok(!A._debug().rows.some((r) => /五周可以/.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('echo · 尾窗外用户真说话 partial 照常出行（reason echo 非 timeout）', async () => {
    const { A, clk } = await openListen1194();
    const h = t1194(A);
    const t0 = h.clockNow();
    h.echoSpeaking('五周可以。', 'en');
    h.echoSpoke(t0 + 2000);
    await clk.runTo(2000 + C.ECHO_TAIL_MS + 100);
    h.setPartial('en', { text: 'Can you do four weeks instead?', at: h.clockNow() });
    h.flushPartial('en', 'echo', { locale: 'en-US' });
    await h.settleSeg('end'); await clk.runTo(3000);
    eq(diagN(h.segDiag(), 'final', 'from-partial'), 0, 'echo 出行不应记 from-partial');
    eq(diagN(h.segDiag(), 'rescue', 'lead_flush'), 1);
    ok(A._debug().rows.some((r) => /four weeks instead/i.test(r.text)), JSON.stringify(A._debug().rows));
    try { await A.leave(); } catch (_) {}
  });
  test('② 句首出行排在定稿之前（真实 intakeFinal）', async () => {
    const { A, captured, clk } = await openListen1194Conv();
    captured.onEvent('partial', { locale: 'en-US', text: 'Please make three copies of this contract and send them to my office' });
    await clk.runTo(0);
    captured.onEvent('final', { locale: 'en-US', text: ', and send them to my office', conf: 0.9, t0: 1000, t1: 2000 });
    await hSettle1194(A, clk);
    const rows = A._debug().rows.map((r) => r.text);
    eq(rows.length, 1, JSON.stringify(rows));
    ok(/please make three copies/i.test(rows[0]) && /send them to my office/i.test(rows[0]), rows[0]);
    eq(diagN(t1194(A).segDiag(), 'rescue', 'lead'), 1);
    try { await A.leave(); } catch (_) {}
  });
  test('⑤ dup-prev · feed 真实丢弃：文字已在已出行行里', async () => {
    const { r, clk, ev, diags } = makeSegRouter({});
    r.feed('en-US', 'Yes, please.', { t0: 266373, t1: 267795 });
    await clk.runTo(5000); await tick();
    ok(segEmitted(ev).some((t) => /yes,\s*please/i.test(t)), '正式 final 应先出行：' + JSON.stringify(segEmitted(ev)));
    r.feed('en-US', 'Please', { rescued: true, t0: 267855, t1: 268890 });
    await clk.runTo(3000); await tick();
    eq(diags.filter((d) => d.kind === 'rescue:dup-prev').length, 1, JSON.stringify(diags));
    eq(norm(segEmitted(ev).join('')), 'yesplease', '重复的 Please 不许再出一行：' + JSON.stringify(segEmitted(ev)));
    r.dispose();
  });
  test('⑤ dup-prev：合并后整句已 feed，临时稿不会比 formal 尾长丢字', async () => {
    const merged = C.mergeRescueLead(
      'Please make three copies of this contract',
      C.rescueLeadCut(', and send them to my office', 'Please make three copies of this contract and send them to my office').text,
    );
    const { r, clk, ev } = makeSegRouter({});
    r.feed('en-US', merged);
    await clk.runTo(5000); await r.settle('end'); await tick();
    const rows = segEmitted(ev);
    ok(/please make three copies/i.test(rows.join(' ')) && /send them to my office/i.test(rows.join(' ')), rows.join(' '));
    r.dispose();
  });
});

async function hSettle1194(A, clk) {
  await clk.runTo(4000);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const h = t1194(A);
  if (h.settleSeg) await h.settleSeg('end');
  await clk.runTo(3000);
}

describe('1194 · TED 1:22 Stick too closely 防回归', () => {
  test('★ badCut 句首单独出行 + 定稿尾句（真实 partial/final 入口，stick 行在前）', async () => {
    const partial = "Stick too closely to what's safe and you risk starvation when the grove runs dry";
    const final = ', you, and you risk starvation when the Grove runs dry.';
    const cut = C.rescueLeadCut(final, partial);
    ok(cut && cut.lead, JSON.stringify(cut));
    const { A, captured, clk } = await openListen1194Conv();
    captured.onEvent('partial', { locale: 'en-US', text: partial });
    await clk.runTo(0);
    captured.onEvent('final', { locale: 'en-US', text: final, conf: 0.9, t0: 1000, t1: 2000 });
    await hSettle1194(A, clk);
    const rows = A._debug().rows.map((r) => r.text);
    const out = rows.join(' ');
    ok(/stick too closely/i.test(out) && /risk starvation/i.test(out) && /grove runs dry/i.test(out), JSON.stringify(rows));
    eq(withinDup(out, 12), null, '重复词：' + JSON.stringify(rows));
    const stickPos = out.search(/stick too closely/i);
    const tailPos = out.search(/risk starvation/i);
    ok(stickPos >= 0 && tailPos >= 0 && stickPos < tailPos, '句首应排在 starvation 前：' + JSON.stringify(rows));
    eq(diagN(t1194(A).segDiag(), 'rescue', 'lead_split'), 1);
    eq(diagN(t1194(A).segDiag(), 'rescue', 'lead'), 0, 'badCut 不应走 merge rescue:lead');
    try { await A.leave(); } catch (_) {}
  });
});
