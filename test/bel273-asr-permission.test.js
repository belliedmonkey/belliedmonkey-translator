// BEL-273：麦克风权限预检 + 采集链 native_code。
//
// 判据分两层：
//   1. 纯状态机 —— 未决定先解释、拒绝给设置、从设置回来重试、已授权直接开；
//   2. 接线 —— 真模型走同一串原生消息，事件属性必须是**生成**的 asr_fail 白名单子集。
// native_code 是 BEL-273 的契约新增：只随 fail_reason='capture' 发出，只收归一后的
// /^[a-z0-9_-]{1,32}$/ 短码；原始 NSError domain/description/用户内容不进事件。
const fs = require('fs');
const path = require('path');
const { test, ok, eq, match, loadSrc } = require('./harness');
const cfg = require('../build/telemetry.config.js');
const C = require('../app/listen-core.js');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/bt-ingest/events.gen.json'), 'utf8')).events.asr_fail;
const SCHEMA_KEYS = Object.keys(SCHEMA);
const ID_RE = /^[a-z0-9_-]{1,32}$/;

function names(tracked, n) { return tracked.filter((e) => e[0] === n); }

function fakeClock() {
  let t = 1_700_000_000_000, seq = 1;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
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

function boot(opts) {
  const o = opts || {};
  // 默认真机形态：Mac（audioCaps 报 system:ok）；要测 iPhone 麦克风字幕就传
  // { caps: { system: 'unsupported', sources: ['mic'] } }。
  const caps = o.caps || { system: 'ok', sources: ['mic', 'system'] };
  const tracked = [];
  const captured = { h: null, native: null, reads: 0, starts: 0, settings: 0 };
  const clk = fakeClock();
  const NativeAudio = {
    available: () => true, suspends: () => false, audioCaps: () => caps,
    micStart: (_rate, h) => { captured.h = h; captured.starts++; return true; }, micStop: () => {}, recordMode: () => {},
    sessionStart: () => {}, sessionStop: () => {},
    onEvent: (fn) => { captured.native = fn; }, onTick: () => {},
    micPermRead: () => { captured.reads++; return true; },
    micPermOpenSettings: () => { captured.settings++; return true; },
    playingState: () => {}, nowPlaying: () => {},
    subtitleShow: () => {}, subtitleState: () => {}, subtitleConfig: () => {}, subtitleHide: () => {}, subtitleFloat: () => {},
  };
  const sb = {
    window: { addEventListener() {}, removeEventListener() {} },
    document: {
      getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [],
      addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(),
      hidden: false, visibilityState: 'visible',
    },
    navigator: { platform: o.platform || 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test' },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: {
      get: (k, cb) => cb({ listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false, provider: 'deepseek', apiKey: 'k' }),
      set: (_o, cb) => { if (cb) cb(); },
    }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: C,
    NativeAudio,
    NativeSpeech: {
      available: () => true,
      probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
      probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
      ensureAssets: async () => ({ ok: true }),
      ensureLid: async () => ({ ok: true }),
      ensureVad: async () => ({ ok: true }),
      lidPause: () => {}, diagAudio: () => {},
      onLid: () => () => {},
      sttOpen: (x) => { captured.onStt = x.onEvent; return { sendPcm: () => true, close() {}, cut() {} }; },
      quota: () => ({ max: 5, reserved: [] }),
    },
    DiagLog: { push: () => {} },
    MTTelemetry: { track: (n, p) => { tracked.push([n, p || {}]); }, once: () => {} },
    MTFeedback: {},
    LearnNotes: { resolveConfig: () => ({ provider: 'deepseek', apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }), shouldCapture: () => false, langAllowed: () => true },
    LearnRules: { dominantScript: (t) => (/[\u4e00-\u9fff]/.test(String(t || '')) ? 'Han' : 'Latin'), langAllowed: () => true },
    LearnDialog: { confirm: async () => true },
    TranslationAPI: {
      resolveProvider: (id) => id || 'deepseek',
      listenPass: async () => '{"text":"ok","translation":"好"}',
      translate: async () => '好',
    },
    EngineState: { byId: () => ({ id: 'deepseek', type: 'chat-compat', defaultModel: 'deepseek-chat' }) },
    WireFormat: { formatFor: () => 'chat-compat', resolveEndpoint: () => 'https://api.deepseek.com/chat/completions', translationModelName: () => false },
    Date: { now: () => clk.now() },
    setTimeout: (fn, ms) => clk.setT(fn, ms), clearTimeout: (id) => clk.clearT(id),
    setInterval: (fn, ms) => clk.setT(fn, ms), clearInterval: (id) => clk.clearT(id),
    console, URL,
  };
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  return { A: ctx.AppListen, tracked, captured, clk };
}

test('BEL-273 方案 B 状态机：未决定直接放行；拒绝 → 设置；授权 → 开', () => {
  const M = loadSrc('src/app/mic-permission.js', 'MicPermission').MicPermission;
  let m = M.initial();
  eq(m.state, 'unknown');
  eq(M.canStart(m), true, '还没读到状态时放行（老壳退回原生请求）');

  m = M.enter(m, 'not_determined');
  eq(m.gate, '', '方案 B：未决定不再停「解释」门');
  eq(M.canStart(m), true, '未决定直接放行，同时由页面画 first-hint（与 #701 相反）');

  m = M.observe(m, 'prompted');
  eq(m.gate, 'requesting');
  eq(M.canStart(m), false, '系统框在飞时挡住开麦');

  m = M.observe(m, 'granted');
  eq(m.gate, '');
  eq(M.canStart(m), true);

  let d = M.enter(M.initial(), 'denied');
  eq(d.gate, 'denied');
  eq(M.canStart(d), false);
  d = M.openSettings(d);
  eq(d.settingsOpened, true, '去设置要能被状态机记住');
  d = M.observe(d, 'granted');
  d = M.retry(d);
  eq(d.gate, '');
  eq(M.canStart(d), true, '从设置回来已授权，点开始必须能开，不要求重启');

  const r = M.enter(M.initial(), 'restricted');
  eq(r.gate, 'denied');
  eq(M.canStart(r), false, 'restricted 与 denied 一样挡住');
  eq(M.GATES.indexOf('explain'), -1, '解释步已从状态机拿掉');
});

// iPhone 字幕听的是麦克风（Mac 的 audioCaps 才报 system:ok）。
const IPHONE = { caps: { system: 'unsupported', sources: ['mic'] } };

test('BEL-273 方案 B：进听译不显示独立权限卡，也没有「继续」', async () => {
  const { A, captured, clk } = boot();
  A.wire();
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  const reads0 = captured.reads;
  A.open('conv');
  await clk.runTo(0);
  ok(captured.reads > reads0, '进入听译页仍要静默读一次真实权限（探测保留）');

  const pv = A.permView();
  eq(pv.shown, false, '进听译不再显示独立权限卡');
  eq(pv.primary, null, '没有「继续」按钮可点');
  eq(pv.secondary, null, '没有第二个按钮');
  eq(A._debug().perm.pending, null, '没有待放行的开始');
  eq(A.permInlineView().shown, false, '没点开始前不画 first-hint');

  for (const st of ['not_determined', 'prompted', 'granted', 'denied', 'restricted']) {
    captured.native({ type: 'mic-perm', state: st, kind: 'mic' });
    await clk.runTo(0);
    eq(A.permView().shown, false, `${st} 也不显示独立权限屏`);
  }

  const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/listen-view.jsx'), 'utf8');
  ok(!/\bid="app-listen-perm"/.test(src), 'DOM 里不许再有 #app-listen-perm 独立卡');
  ok(!/\bid="app-listen-perm-continue"/.test(src), 'DOM 里不许有「继续」按钮');
});

test('BEL-273 方案 B：not_determined 点开始 / PTT 立刻 mic-start 并画 first-hint', async () => {
  // 对话 PTT
  const a = boot();
  a.A.wire();
  a.captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  a.A.open('conv');
  await a.clk.runTo(0);
  eq(a.A.pttToggle('other'), true, '未决定时点 PTT 直接放行');
  await a.clk.runTo(0);
  eq(a.captured.starts, 1, 'PTT 立刻发 mic-start（系统框只一次）');
  const iv = a.A.permInlineView();
  eq(iv.kind, 'hint');
  match(iv.hint, /第一次开始会弹出麦克风授权/, '同时能读到 first-hint 文案');
  eq(a.A.permView().shown, false, 'first-hint 不是独立卡');

  // 字幕单键
  const b = boot(IPHONE);
  b.A.wire();
  b.captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  b.A.open('subtitle');
  await b.clk.runTo(0);
  b.A.toggle();
  await b.clk.runTo(0);
  eq(b.captured.starts, 1, '字幕「开始」直接发 mic-start');
  eq(b.A.permInlineView().kind, 'hint');
  match(b.A.permInlineView().hint, /第一次开始会弹出麦克风授权/);
  eq(b.A.toggleView().text, '开始', 'hint 期间同一颗按钮仍叫「开始」，不闪成「准备中…」');
});

test('BEL-273 方案 B：prompted 字幕按钮置灰短句；PTT 双键置灰 + 行内等待', async () => {
  const a = boot(IPHONE);
  a.A.wire();
  a.captured.native({ type: 'mic-perm', state: 'prompted', kind: 'mic' });
  a.A.open('subtitle');
  await a.clk.runTo(0);
  const tv = a.A.toggleView();
  eq(tv.disabled, true, '系统框在飞：同一颗「开始」置灰');
  match(tv.text, /等待系统授权/, '按钮文案换成 listening_perm_waiting 短句');
  ok(!/弹出的权限框/.test(tv.text), '不把 subtitle_bar_waiting 长句贴到主按钮');
  eq(a.A.permInlineView().kind, 'waiting');

  const b = boot();
  b.A.wire();
  b.captured.native({ type: 'mic-perm', state: 'prompted', kind: 'mic' });
  b.A.open('conv');
  await b.clk.runTo(0);
  const pv = b.A.pttView();
  eq(pv.mineDisabled, true, 'PTT 左键置灰');
  eq(pv.otherDisabled, true, 'PTT 右键置灰');
  eq(b.A.permInlineView().kind, 'waiting');
  match(b.A.permInlineView().hint, /等待系统授权/, '等待文案走行内 note');
  ok(!/等待系统授权/.test(pv.mineLabel + pv.otherLabel), '不把某一侧 PTT 改名当第三颗按钮');
});

test('BEL-273 方案 B：denied 行内 + 文本链去设置；开始仍是开始且挡住开麦', async () => {
  const a = boot(IPHONE);
  a.A.wire();
  a.captured.native({ type: 'mic-perm', state: 'denied', kind: 'mic' });
  a.A.open('subtitle');
  await a.clk.runTo(0);
  const iv = a.A.permInlineView();
  eq(iv.kind, 'denied');
  match(iv.hint, /麦克风权限未开启/, '行内 denied 文案');
  match(iv.link, /去设置/, '文本链「去设置」');
  eq(a.A.toggleView().text, '开始', '主按钮仍是「开始」');
  ok(!/重试/.test(a.A.toggleView().text), '不把「开始」改成「重试」');
  a.A.toggle();
  await a.clk.runTo(0);
  eq(a.captured.starts, 0, 'denied 时点开始不发 mic-start');
  a.A.permOpenSettings();
  eq(a.captured.settings, 1, '文本链走 NativeAudio.micPermOpenSettings');
  eq(a.A.permView().shown, false, '去设置不打开独立屏');

  a.captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  await a.clk.runTo(0);
  eq(a.A.permInlineView().shown, false, '从设置回来已授权：hint / denied 都收起');
  a.A.toggle();
  await a.clk.runTo(0);
  eq(a.captured.starts, 1, '已授权后点「开始」才开麦');

  // 对话 PTT 同一套
  const b = boot();
  b.A.wire();
  b.captured.native({ type: 'mic-perm', state: 'denied', kind: 'mic' });
  b.A.open('conv');
  await b.clk.runTo(0);
  eq(b.A.permInlineView().kind, 'denied');
  eq(b.A.pttToggle('other'), false, 'denied 时 PTT 不放行');
  await b.clk.runTo(0);
  eq(b.captured.starts, 0, 'denied 时 PTT 不发 mic-start');
  b.A.permOpenSettings();
  eq(b.captured.settings, 1);
  b.captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  await b.clk.runTo(0);
  eq(b.A.pttToggle('other'), true);
  await b.clk.runTo(0);
  eq(b.captured.starts, 1, '已授权后点 PTT 才开麦');
});

test('BEL-273 方案 B：拒绝后 halted 主按钮仍是「开始」；授权前点它不开麦，授权后才 resume', async () => {
  const { A, captured, clk } = boot(IPHONE);
  A.wire();
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  A.open('subtitle');
  await clk.runTo(0);
  A.toggle();
  await clk.runTo(0);
  eq(captured.starts, 1, '第一次点开始发 mic-start');
  ok(captured.h, 'mic-start 之后原生才有 h 回调');
  captured.h.onState('denied', '', 'mic');
  await clk.runTo(0);
  eq(A._debug().perm.state, 'denied');
  eq(A.toggleView().text, '开始', '拒绝后主按钮仍叫「开始」');
  ok(!/重试|继续/.test(A.toggleView().text), '不改成「重试」也不退回「继续」');
  eq(A.permInlineView().kind, 'denied');
  A.toggle();
  await clk.runTo(0);
  eq(captured.starts, 1, '仍 denied 时再点「开始」不发第二次 mic-start');
  captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  await clk.runTo(0);
  eq(A.toggleView().text, '开始', '从设置回来已授权，这颗按钮仍叫「开始」');
  eq(A.permInlineView().shown, false, '已授权后行内 denied 收起');
  A.toggle();
  await clk.runTo(0);
  eq(captured.starts, 2, '已授权后点「开始」才 resume 开麦');
});

test('BEL-273 方案 B：已授权无 hint / 无 denied', async () => {
  const a = boot(IPHONE);
  a.A.wire();
  a.captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  a.A.open('subtitle');
  await a.clk.runTo(0);
  eq(a.A.permView().shown, false);
  eq(a.A.permInlineView().shown, false, '已授权不画任何权限提示');
  eq(a.A.toggleView().text, '开始');
  a.A.toggle();
  await a.clk.runTo(0);
  eq(a.captured.starts, 1);

  const b = boot();
  b.A.wire();
  b.captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  b.A.open('conv');
  await b.clk.runTo(0);
  eq(b.A.permInlineView().shown, false);
  b.A.pttToggle('other');
  await b.clk.runTo(0);
  eq(b.captured.starts, 1);
  ok(b.A._debug().perm.gate === '');
});

test('BEL-273 方案 B：Mac 实时字幕听系统声音，无麦克风门、toggle 仍发 start', async () => {
  const { A, captured, clk } = boot();   // 默认 caps system:ok = Mac
  A.wire();
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  A.open('subtitle');
  await clk.runTo(0);
  eq(A.permView().shown, false, '系统声音字幕不该显示麦克风门');
  eq(A.permInlineView().shown, false, '系统声音字幕不画任何麦克风提示');
  A.toggle();
  await clk.runTo(0);
  eq(captured.starts, 1, '系统声音采集照常开始');
  eq(captured.h.source, 'system', '字幕的采集源仍是系统声音，不是麦克风');
});

function captureFail(code) {
  const b = boot();
  b.A.wire();
  b.captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  b.A.open('conv');
  return b.clk.runTo(0).then(() => {
    b.A.pttToggle('other');
    return b.clk.runTo(0);
  }).then(() => {
    b.captured.h.onState('granted', '', 'mic');
    b.captured.h.onState('failed', 'native', 'mic', code);
    return b.clk.runTo(0);
  }).then(() => b);
}

async function failAfter(state, opts) {
  const o = opts || {};
  const b = boot();
  b.A.wire();
  b.captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  b.A.open('conv');
  await b.clk.runTo(0);
  b.A.pttToggle('other');
  await b.clk.runTo(0);
  b.captured.h.onState('granted', '', 'mic');
  await b.clk.runTo(o.ms || 0);
  b.captured.h.onState(state, o.reason || '', 'mic', o.code || '');
  await b.clk.runTo(0);
  return b;
}

test('BEL-273 native_code 归一映射：五个 domain 前缀 + 权限/中断/未知', () => {
  const { A } = boot();
  const norm = A._debug().normalizeNativeCode;
  eq(norm('AVFoundationErrorDomain:561017449'), 'avf_561017449');
  eq(norm('NSOSStatusErrorDomain:-10851'), 'os_10851');
  eq(norm('AVAudioSession:561017449'), 'session_561017449');
  eq(norm('AVAudioEngine:converter'), 'engine_converter');
  eq(norm('NSURLErrorDomain:-1009'), 'url_1009');
  eq(norm('denied'), 'denied');
  eq(norm('interrupted'), 'interrupted');
  eq(norm('SFSpeechErrorDomain:11'), 'other', '未知 domain 只分类，不带原文');
  eq(norm('Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales"'), '',
    '老壳 NSError 长文不归一（也不缓存）');
  for (const v of ['avf_561017449', 'os_10851', 'session_561017449', 'engine_converter',
    'url_1009', 'denied', 'interrupted', 'other']) {
    ok(ID_RE.test(v), v + ' 不是契约短码');
  }
});

test('BEL-273 采集失败：两个 domain/code 归一成不同短码并进 asr_fail', async () => {
  const a = await captureFail('NSOSStatusErrorDomain:-10851');
  eq(a.A._debug().asrNativeCode, 'os_10851');
  const fa = names(a.tracked, 'asr_fail')[0][1];
  eq(fa.fail_reason, 'capture');
  eq(fa.native_code, 'os_10851');

  const b = await captureFail('AVFoundationErrorDomain:561017449');
  eq(b.A._debug().asrNativeCode, 'avf_561017449');
  const fb = names(b.tracked, 'asr_fail')[0][1];
  eq(fb.fail_reason, 'capture');
  eq(fb.native_code, 'avf_561017449');
  ok(fa.native_code !== fb.native_code, '两个原因必须可区分');
});

test('BEL-273 采集失败：asr_fail props 是生成白名单子集，native_code 是 id 短码', async () => {
  eq(SCHEMA_KEYS.sort().join(','), Object.keys(cfg.EVENTS.asr_fail).sort().join(','),
    'repo 注册表与 events.gen.json 必须一致');
  eq(SCHEMA.native_code, 'id', 'asr_fail.native_code 必须是 id 型');
  eq(cfg.EVENTS.asr_fail.native_code, 'id');

  const b = await captureFail('NSOSStatusErrorDomain:-10851');
  const fails = names(b.tracked, 'asr_fail');
  eq(fails.length, 1);
  eq(fails[0][1].fail_reason, 'capture');
  eq(fails[0][1].native_code, 'os_10851');
  for (const k of Object.keys(fails[0][1])) {
    ok(SCHEMA_KEYS.indexOf(k) >= 0, `事件属性 ${k} 不在生成的 asr_fail 白名单里`);
  }
  ok(ID_RE.test(fails[0][1].native_code), 'native_code 必须是 /^[a-z0-9_-]{1,32}$/');
  ok(!/Domain|NSError|Too many|SFSpeech|Settings|Privacy/.test(JSON.stringify(fails[0][1])),
    '事件里不许有系统长文');
});

test('BEL-273 采集失败：非法字符被清洗，原始内容不入事件', async () => {
  const b = await captureFail('AVAudioEngine:Input-Format!$%^&*()');
  const f = names(b.tracked, 'asr_fail')[0][1];
  eq(f.fail_reason, 'capture');
  eq(f.native_code, 'engine_inputformat');
  ok(ID_RE.test(f.native_code), f.native_code);
  ok(!/[^a-z0-9_-]/.test(f.native_code), '只能有小写字母/数字/_/-');
  ok(!/Input|Format|AVAudioEngine/.test(JSON.stringify(f)), '原始 domain/code 文本不进事件');
});

test('BEL-273 采集失败：老壳长文不落 props，折成 capture；权限/采集中断三码互斥', async () => {
  const b = await captureFail('Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales"');
  eq(b.A._debug().asrNativeCode, '', '不合有界 domain:code 的长文不缓存');
  const f = names(b.tracked, 'asr_fail')[0][1];
  eq(f.fail_reason, 'capture');
  ok(!('native_code' in f), '没有归一码时不带 native_code');
  ok(!/Domain|SFSpeech|Too many/.test(JSON.stringify(f)));

  const map = b.A._debug().asrFailReason;
  eq(map('denied', ''), 'permission');
  eq(map('failed', 'native'), 'capture');
  eq(map('locked', ''), 'interrupted');
  eq(new Set([map('denied', ''), map('failed', 'native'), map('locked', '')]).size, 3,
    'permission / capture / interrupted 必须是三个不同的统计值');
});

test('BEL-273 非采集失败不带 native_code：permission / interrupted', async () => {
  const denied = await failAfter('denied', {});
  const pf = names(denied.tracked, 'asr_fail')[0][1];
  eq(pf.fail_reason, 'permission');
  ok(!('native_code' in pf), 'permission 失败不能带 native_code');

  const interrupted = await failAfter('interrupted', { ms: 3500 });
  const intf = names(interrupted.tracked, 'asr_fail')[0][1];
  eq(intf.fail_reason, 'interrupted');
  ok(!('native_code' in intf), 'interrupted 失败不能带 native_code');
});

test('BEL-273 原生协议：设置深链与 native_code 键都在桥的协议里', () => {
  const js = fs.readFileSync(path.join(__dirname, '../app/native-audio.js'), 'utf8');
  ok(js.includes("'mic-perm-open-settings'"), 'JS 协议缺设置深链');
  ok(/function micPermOpenSettings\s*\(/.test(js), 'NativeAudio 没暴露设置深链');
  ok(/native_code/.test(js), 'native_code 没有从原生消息里读出来');
  const swift = fs.readFileSync(path.join(__dirname, '../app/native/audio-bridge.swift'), 'utf8');
  ok(swift.includes('case "mic-perm-open-settings"'), 'Swift 没接设置深链');
  ok(swift.includes('UIApplication.openSettingsURLString'), 'iOS 没落到本 App 系统设置页');
  ok(swift.includes('Privacy_Microphone'), 'macOS 没落到麦克风隐私面板');
  ok(swift.includes('"native_code"'), 'Swift 没把有界 domain:code 送过来');
});
