// test/listen-593.test.js — #593：字幕与对话共用一条管线（§9.8.1）+ 一句里夹另一门语言的词（§9.6.1.13）。
//
// 覆盖：
//   ① 句头闸：中文路里与汉字片紧接的拉丁片是句内夹词（放行、不扣、不丢）；隔开的 / 太长的照旧；
//   ② scriptFirstLid：两路时文字系先于 LID；
//   ③ 句头闸 scriptFirst：拉丁路与已收的汉字定稿时间重叠 ⇒ 丢（按键锁定时不走）；
//   ④ 旧路修正契约：src == dst 时不要求翻译；两条提示都写了夹词；
//   ⑤ 真 listen-model：字幕走模型断句路；单路识别器时 LID 不做归属闸；「自动」时中文句只出一行原文、
//      不写语料、不出 trErr；夹在中文里的英文词进同一行。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

const SCRIPT = (t) => {
  const s = String(t || '');
  const han = (s.match(/\p{Script=Han}/gu) || []).length, lat = (s.match(/[A-Za-z]/g) || []).length;
  if (!han && !lat) return null;
  return han >= lat ? 'Han' : 'Latin';
};
function gateOf(extra) {
  const diags = [], released = [];
  const g = C.makeFinalGate(Object.assign({
    dominantScript: SCRIPT, now: () => 0, setTimeout: () => 1, clearTimeout: () => {},
    onDiag: (k, t, w) => diags.push({ k, t, w }), onRelease: (l, t) => released.push(t),
  }, extra || {}));
  return { g, diags, released };
}

describe('#593 ① 句头闸：句内夹词', () => {
  test('★ 与汉字片首尾相接（0 ms）的拉丁片放行（gate:embed），不当成另一门语言的碎片', () => {
    const { g, diags } = gateOf();
    eq(g.push({ locale: 'zh-CN', text: '请把这份', conf: 0.9, t0: 0, t1: 1200 }).join('|'), '请把这份');
    eq(g.push({ locale: 'zh-CN', text: 'PPT', conf: 0.9, t0: 1200, t1: 1500 }).join('|'), 'PPT');
    ok(diags.some((d) => d.k === 'gate:embed'), '没记 gate:embed：' + JSON.stringify(diags));
    eq(g.heldLocales().length, 0, '夹词不该被扣住');
  });
  test('★ 连着两片夹词也放行（累计 ≤ 4 词）', () => {
    const { g } = gateOf();
    g.push({ locale: 'zh-CN', text: '记得', conf: 0.9, t0: 0, t1: 600 });
    eq(g.push({ locale: 'zh-CN', text: 'follow', conf: 0.9, t0: 600, t1: 900 }).join('|'), 'follow');
    eq(g.push({ locale: 'zh-CN', text: 'up', conf: 0.9, t0: 900, t1: 1100 }).join('|'), 'up');
  });
  test('★ 与汉字片隔 1.3 s 的拉丁片不是夹词（另起的英文句）——不放行', () => {
    const { g } = gateOf();
    g.push({ locale: 'zh-CN', text: '好的', conf: 0.9, t0: 0, t1: 600 });
    eq(g.push({ locale: 'zh-CN', text: 'Let us start', conf: 0.9, t0: 1900, t1: 2600 }).length, 0);
  });
  test('★ 超过 4 个词不是夹词', () => {
    const { g } = gateOf();
    g.push({ locale: 'zh-CN', text: '好的', conf: 0.9, t0: 0, t1: 600 });
    eq(g.push({ locale: 'zh-CN', text: 'please send me the deck now', conf: 0.9, t0: 600, t1: 2000 }).length, 0);
  });
  test('★ 一片里汉字少、拉丁多（「这个 project deadline」，与上一句隔 1.9 s）仍是中文句，不丢', () => {
    const { g } = gateOf();
    g.push({ locale: 'zh-CN', text: '你。', conf: 0.99, t0: 4560, t1: 5013 });
    eq(g.push({ locale: 'zh-CN', text: '这个 project deadline', conf: 0.94, t0: 6873, t1: 9453 }).join('|'), '这个 project deadline');
    eq(g.push({ locale: 'zh-CN', text: '是', conf: 0.44, t0: 9453, t1: 9873 }).join('|'), '是');
  });
  test('一片里只夹一个汉字、拉丁词超过 8 个 ⇒ 不当夹词', () => {
    const { g } = gateOf();
    eq(g.push({ locale: 'zh-CN', text: 'okay 的 let us move on to the next item on the agenda', conf: 0.9, t0: 0, t1: 3000 }).length, 0);
  });
  test('embedded() 只读：不改链，判据与 push 一致', () => {
    const { g } = gateOf();
    g.push({ locale: 'zh-CN', text: '发到我的', conf: 0.9, t0: 0, t1: 900 });
    ok(g.embedded({ locale: 'zh-CN', text: 'email', t0: 900 }));
    ok(!g.embedded({ locale: 'zh-CN', text: 'email', t0: 2500 }));
    ok(!g.embedded({ locale: 'en-US', text: 'email', t0: 900 }), '拉丁路没有「夹词」这回事');
  });
});

describe('#593 ② scriptFirstLid：两路时文字系先于 LID', () => {
  const base = { partnerLocale: 'en-US', dominantScript: SCRIPT };
  test('★ 中文路的汉字定稿归中文（不论 LID）', () => {
    eq(C.scriptFirstLid(Object.assign({ locale: 'zh-CN', text: '这个项目的进度' }, base)), 'zh');
  });
  test('★ 中文路的句内夹词归中文', () => {
    eq(C.scriptFirstLid(Object.assign({ locale: 'zh-CN', text: 'PPT', embedded: true }, base)), 'zh');
  });
  test('中文路的整句拉丁（不是夹词）⇒ 空串（照旧按 LID）', () => {
    eq(C.scriptFirstLid(Object.assign({ locale: 'zh-CN', text: 'Let us start the meeting' }, base)), '');
  });
  test('拉丁路 / 同为拉丁的一对 ⇒ 空串', () => {
    eq(C.scriptFirstLid({ locale: 'en-US', partnerLocale: 'zh-CN', text: 'hello', dominantScript: SCRIPT }), '');
    eq(C.scriptFirstLid({ locale: 'fr-FR', partnerLocale: 'en-US', text: 'bonjour', dominantScript: SCRIPT }), '');
  });
});

describe('#593 ③ 句头闸 scriptFirst：拉丁路与已收的汉字定稿重叠 ⇒ 丢', () => {
  test('★ 高置信的拉丁长片也丢（cjk-overlap）', () => {
    const { g, diags } = gateOf({ scriptFirst: () => true });
    g.noteOtherText('zh-CN', '请把PPT发到我的email', 0, 3000);
    eq(g.push({ locale: 'en-US', text: 'project, deadline, schedule.', conf: 0.9, t0: 500, t1: 2500 }).length, 0);
    ok(diags.some((d) => d.k === 'gate:drop' && d.w === 'cjk-overlap'));
  });
  test('scriptFirst 为假（按键锁定）时照旧放行高置信片', () => {
    const { g } = gateOf({ scriptFirst: () => false });
    g.noteOtherText('zh-CN', '请把PPT发到我的email', 0, 3000);
    eq(g.push({ locale: 'en-US', text: 'project, deadline, schedule.', conf: 0.9, t0: 500, t1: 2500 }).length, 1);
  });
  test('不重叠的英文句照常放行', () => {
    const { g } = gateOf({ scriptFirst: () => true });
    g.noteOtherText('zh-CN', '好的', 0, 600);
    eq(g.push({ locale: 'en-US', text: 'Let us start the meeting.', conf: 0.9, t0: 2000, t1: 3500 }).length, 1);
  });
});

describe('#593 ④ 提示词', () => {
  test('★ 旧路契约：src == dst 时只要求重复修正稿，不要求翻译', () => {
    const p = C.buildListenPrompt({ text: '我们下周开会', srcName: 'Chinese', dstName: 'Chinese', same: true });
    ok(/same as the source/.test(p.system), p.system);
    ok(!/translate the corrected sentence/.test(p.system));
    const q = C.buildListenPrompt({ text: '我们下周开会', srcName: 'Chinese', dstName: 'English' });
    ok(/translate the corrected sentence into English/.test(q.system));
  });
  test('★ 两条路的提示都写了夹词规则', () => {
    ok(/embed words of another language/.test(C.buildListenPrompt({ text: 'x', srcName: 'a', dstName: 'b' }).system));
    ok(/embed words of another language/.test(C.buildSegPrompt({ srcName: 'a', dstName: 'b', buffer: 'x' }).system));
    const model = fs.readFileSync(path.join(__dirname, '..', 'src/app/listen-model.js'), 'utf8');
    ok(/夹另一门语言的词/.test(model), 'listen_seg_system 的中文模板缺夹词规则');
  });
});

// ══ ⑤ 真 listen-model（esbuild + vm + 假时钟）═══════════════════════════════════
let CLK_BASE = 1_800_000_000_000;
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
function makeSandbox(store) {
  const cap = { h: null, onEvent: null, lid: null, opened: [], prompts: [], shows: [] };
  const clk = e2eClock();
  const NativeSpeech = {
    available: () => true,
    probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
    ensureAssets: async () => ({ ok: true }), ensureLid: async () => ({ ok: true }), ensureVad: async () => ({ ok: true }),
    lidPause: () => {}, diagAudio: () => {}, onLid: (fn) => { cap.lid = fn; return () => {}; },
    sttOpen: (x) => { cap.onEvent = x.onEvent; cap.opened.push(x); return { sendPcm: () => true, close() {}, cut() {} }; },
  };
  const NativeAudio = {
    available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok' }),
    micStart: (rate, h) => { cap.h = h; return true; }, micStop: () => {}, recordMode: () => {},
    sessionStart: () => {}, sessionStop: () => {}, onEvent: () => {}, onTick: () => {},
    playingState: () => {}, nowPlaying: () => {},
    subtitleShow: (o) => cap.shows.push(o), subtitleState: () => {}, subtitleConfig: () => {}, subtitleHide: () => {}, subtitleFloat: () => {},
  };
  const tr = { provider: 'deepseek', apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };
  const st = Object.assign({ listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: true, subtitleCapture: true }, store || {});
  const sb = {
    window: { addEventListener() {}, removeEventListener() {}, AudioContext: function () {}, webkitAudioContext: function () {},
      MT_LANGS: [{ code: 'zh', label: '中文' }, { code: 'en', label: 'English' }] },
    document: { getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(), hidden: false },
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: {
      get: (k, cb) => cb(Object.assign({}, st)),
      set: (o2, cb) => { Object.assign(st, o2); if (cb) cb(); },
    }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: C, NativeAudio, NativeSpeech,
    DiagLog: { push: () => {} }, MTTelemetry: { track: () => {}, once: () => {} }, MTFeedback: {},
    LearnNotes: { resolveConfig: () => tr, shouldCapture: () => true, langAllowed: () => true },
    LearnRules: { dominantScript: SCRIPT, langAllowed: () => true },
    LearnDialog: { confirm: async () => true },
    TranslationAPI: {
      resolveProvider: () => 'deepseek',
      LANG_NAMES: { zh: 'Chinese', en: 'English' },
      listenPass: async (p) => {
        cap.prompts.push(p);
        const b = String((p && p.user) || '').split('待处理文本：').pop().split('\n\n是否强制收尾')[0].trim();
        return JSON.stringify({ segments: [{ source: b, translation: /[A-Za-z]{3}/.test(b) && !/\p{Script=Han}/u.test(b) ? '译文' : b }], remainder: '' });
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
  return { sb, cap, clk };
}
async function openSubtitle(store) {
  const { sb, cap, clk } = makeSandbox(store);
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  const A = ctx.AppListen;
  A.open('subtitle');
  await clk.runTo(0);
  A.setAutoSpeak(false);
  A.start();
  await clk.runTo(0);
  if (cap.h && cap.h.onState) cap.h.onState('granted', '');
  await clk.runTo(0);
  return { A, cap, clk };
}
const fin = (cap, locale, text, t0, t1, conf) => cap.onEvent('final', { locale, text, conf: conf == null ? 0.9 : conf, t0, t1 });
// 断句路由器在 listen-core 里用真时钟（空闲 1.5 s）——等真的空闲过去，再推一下假时钟。
async function idle(clk) { await new Promise((r) => setTimeout(r, 1700)); await clk.runTo(0); await new Promise((r) => setTimeout(r, 20)); await clk.runTo(0); }

describe('#593 ⑤ 真 listen-model：字幕走同一条管线', () => {
  test('★ 字幕用通用对话引擎 ⇒ 模型断句路、vadMs 600', async () => {
    const { A, cap, clk } = await openSubtitle({ subtitleVideoLang: 'en' });
    ok(cap.onEvent, '识别器没开');
    eq((A._debug().seg || {}).route, 'model', '字幕仍走旧路：' + JSON.stringify(A._debug().seg));
    eq(cap.opened[cap.opened.length - 1].vadMs, 600);
    try { await A.leave(); } catch (_) {}
    await clk.runTo(0);
  });
  test('★ 指定视频语言（一路识别器）：LID 判成另一门也不丢定稿', async () => {
    const { A, cap, clk } = await openSubtitle({ subtitleVideoLang: 'en' });
    eq(cap.opened[cap.opened.length - 1].locales.length, 1, '指定视频语言应只开一路');
    if (cap.lid) cap.lid({ lang: 'zh' });
    await clk.runTo(1000);
    fin(cap, 'en-US', 'We need to review the budget today.', 0, 2500);
    await idle(clk);
    const rows = A._debug().rows;
    eq(rows.length, 1, '这一句被 LID 挡掉了：' + JSON.stringify(rows.map((r) => r.text)));
    try { await A.leave(); } catch (_) {}
    await clk.runTo(0);
  });
  test('★ 「自动」+ 译成中文：中文句只出一行原文（same、无 tr、无 trErr、不进语料），英文夹词在同一行', async () => {
    const { A, cap, clk } = await openSubtitle({ subtitleVideoLang: 'auto' });
    eq(cap.opened[cap.opened.length - 1].locales.length, 2, '「自动」应开两路');
    if (cap.lid) cap.lid({ lang: 'en' });   // LID 停在英文：中文句也必须靠文字系归中文
    await clk.runTo(1000);
    fin(cap, 'zh-CN', '请把这份', 0, 1200);
    fin(cap, 'zh-CN', 'PPT', 1200, 1500);
    fin(cap, 'zh-CN', '发到我的邮箱', 1500, 2600);
    fin(cap, 'en-US', 'project, deadline, schedule.', 200, 2400);
    await idle(clk);
    const rows = A._debug().rows;
    eq(rows.length, 1, '应恰好一行：' + JSON.stringify(rows.map((r) => r.text)));
    const r = rows[0];
    ok(/PPT/.test(r.text) && /请把这份/.test(r.text), '夹词没进同一行：' + r.text);
    ok(r.same && !r.tr && !r.trErr, '同语言行形状不对：' + JSON.stringify({ same: r.same, tr: r.tr, trErr: r.trErr }));
    ok(!r.written, '同语言行不该进语料');
    const last = cap.shows.filter((s) => !s.partial).pop();
    ok(last && last.orig === r.text && last.tr === '', '字幕条应只画原文：' + JSON.stringify(last));
    try { await A.leave(); } catch (_) {}
    await clk.runTo(0);
  });
});
