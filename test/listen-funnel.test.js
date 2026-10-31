// BEL-113：App 首启听译漏斗。判据是发出的事件名和枚举，不是页面画了什么。
// 打开听译页 ≠ 开麦；失败原因必须是短枚举，系统长文进不了 props。
const fs = require('fs');
const path = require('path');
const { test, ok, eq, loadSrc, loadModule } = require('./harness');
const cfg = require('../build/telemetry.config.js');
const C = require('../app/listen-core.js');

const FAIL = cfg.EVENTS.asr_fail.fail_reason;
const PERM = cfg.EVENTS.mic_permission.permission_state;

function names(tracked, n) {
  return tracked.filter((e) => e[0] === n);
}

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

function boot() {
  const tracked = [];
  const captured = { h: null, native: null, reads: 0 };
  const clk = fakeClock();
  const NativeAudio = {
    available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok', sources: ['mic', 'system'] }),
    micStart: (_rate, h) => { captured.h = h; return true; }, micStop: () => {}, recordMode: () => {},
    sessionStart: () => {}, sessionStop: () => {},
    onEvent: (fn) => { captured.native = fn; }, onTick: () => {},
    micPermRead: () => { captured.reads++; return true; },
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
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test' },
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

test('白名单：四条新事件的枚举是短码，信封不另造 app_version / platform', () => {
  eq(PERM.join(','), 'prompted,granted,denied,restricted,not_determined');
  ok(FAIL.indexOf('permission') >= 0 && FAIL.indexOf('other') >= 0, FAIL.join(','));
  ok(FAIL.every((x) => x.length <= 16 && !/\s/.test(x)), 'fail_reason 里有空格或长文');
  eq(cfg.EVENTS.mic_permission.kind.join(','), 'mic,system');
  ok(!cfg.EVENTS.asr_start.app_version && !cfg.EVENTS.asr_start.platform, '版本和平台已经在公共信封的 v / device 上');
  for (const ev of ['mic_permission', 'asr_start', 'asr_fail', 'translate_start']) {
    ok(cfg.SEAMS[ev].some((s) => s.host === 'app' && s.file), ev + ' 没有 App 发送点');
    ok(cfg.SEAMS[ev].some((s) => s.host === 'ext' && s.none), ev + ' 不该为扩展另开漏斗');
  }
});

test('客户端白名单会丢掉长 fail_reason，收短枚举', async () => {
  const window = { MT_VERSION: '9.9.9', MT_TELEMETRY: { url: 'https://x.test/functions/v1/bt-ingest', spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS }, allowAutomation: true } };
  const ctx = loadModule(['learn/telemetry.js'], { window, navigator: { webdriver: false, userAgent: '', language: 'en' }, chrome: { storage: { local: { get: (_k, cb) => cb({ 'tm:on': true, 'tm:id': '11111111-1111-4111-8111-111111111111', 'tm:queue': [] }), set: (_o, cb) => { if (cb) cb(); }, remove: (_k, cb) => { if (cb) cb(); } } }, runtime: { getManifest: () => ({ version: '9.9.9' }) } } });
  const T = ctx.MTTelemetry;
  eq(await T.track('asr_fail', { fail_reason: 'Error Domain=SFSpeechErrorDomain Code=11 Too many locales' }), false);
  eq(await T.track('asr_fail', { fail_reason: 'permission' }), true);
  eq(await T.track('mic_permission', { permission_state: 'granted', kind: 'mic' }), true);
  eq(await T.track('mic_permission', { permission_state: 'granted', kind: 'mic', note: 'user said hello' }), false);
  eq(await T.track('translate_start', { engine: 'deepseek', locale_pair: 'zh-en' }), true);
  eq(await T.track('asr_start', {}), true);
  eq(await T.track('translate_ok', { provider: 'deepseek', kind: 'subtitle', ms: 1 }), true);
});

test('asrFailReason 只吐枚举里的短码', () => {
  const { A } = boot();
  const map = A._debug().asrFailReason;
  const samples = [
    ['denied', '', 'permission'],
    ['headphones', '', 'interrupted'],
    ['locked', '', 'interrupted'],
    ['socket', 'locale', 'locale'],
    ['device', 'locales', 'quota'],
    ['device', 'assets', 'assets'],
    ['assets', 'timeout', 'timeout'],
    ['assets', 'download', 'assets'],
    ['os', '', 'os'],
    ['failed', 'os', 'os'],
    ['failed', 'Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales"', 'capture'],
    ['socket-retry', 'whatever long text the socket printed', 'other'],
    ['nope', '', 'other'],
  ];
  for (const [reason, why, want] of samples) {
    const got = map(reason, why);
    eq(got, want, reason + '/' + why.slice(0, 24));
    ok(FAIL.indexOf(got) >= 0, got + ' 不在 fail_reason 枚举里');
    ok(!/Error|Domain|http|@/.test(got), got);
  }
});

test('打开听译页只发 asr_entry；开麦才发 asr_start；权限按状态去重', async () => {
  const { A, tracked, captured, clk } = boot();
  A.wire();
  eq(captured.reads >= 1, true, '启动时要向原生读一次麦克风状态，不弹框');
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  eq(names(tracked, 'mic_permission').length, 1, '同一状态不重发');
  eq(names(tracked, 'mic_permission')[0][1].permission_state, 'not_determined');

  A.open('conv');
  await clk.runTo(0);
  eq(names(tracked, 'asr_entry').length, 1);
  eq(names(tracked, 'asr_entry')[0][1].result, 'started');
  eq(names(tracked, 'asr_start').length, 0, '只打开页面不算开麦');

  A.open('subtitle');
  await clk.runTo(0);
  eq(names(tracked, 'asr_start').length, 0, '字幕页停在准备态，还没点开始');
});

test('开麦之后：granted、asr_start、失败短码、翻译开始', async () => {
  const { A, tracked, captured, clk } = boot();
  A.wire();
  A.open('conv');
  await clk.runTo(0);
  const before = tracked.length;
  const toggled = A.pttToggle('other');
  await clk.runTo(0);
  ok(toggled !== false, '点了听译键却没接上');
  ok(names(tracked, 'asr_start').length >= 1, '开麦没发 asr_start，已有事件 ' + tracked.slice(before).map((e) => e[0]).join(','));
  const startProps = names(tracked, 'asr_start')[0][1];
  if (startProps.engine) ok(/^[a-z0-9_-]{1,32}$/.test(startProps.engine), startProps.engine);
  if (startProps.locale_pair) ok(/^[a-z0-9_-]{1,32}$/.test(startProps.locale_pair), startProps.locale_pair);

  captured.h.onState('waiting', 'waiting-permission', 'system');
  eq(names(tracked, 'mic_permission').some((e) => e[1].permission_state === 'prompted' && e[1].kind === 'system'), true);

  captured.h.onState('granted', '', 'mic');
  captured.h.onState('granted', '', 'mic');
  eq(names(tracked, 'mic_permission').filter((e) => e[1].permission_state === 'granted' && e[1].kind === 'mic').length, 1);

  captured.h.onState('failed', 'Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales"', 'mic');
  await clk.runTo(0);
  const fails = names(tracked, 'asr_fail');
  eq(fails.length, 1, JSON.stringify(fails));
  eq(fails[0][1].fail_reason, 'capture');
  ok(!/Domain|locales|Error/.test(JSON.stringify(fails[0][1])), JSON.stringify(fails[0][1]));
});

test('权限拒绝记 permission，不把系统文案写进事件', async () => {
  const { A, tracked, captured, clk } = boot();
  A.open('conv');
  await clk.runTo(0);
  A.pttToggle('other');
  await clk.runTo(0);
  captured.h.onState('denied', 'user denied the microphone in Settings › Privacy', 'mic');
  await clk.runTo(0);
  const fails = names(tracked, 'asr_fail');
  eq(fails.length, 1, JSON.stringify(tracked.map((e) => e[0])));
  eq(fails[0][1].fail_reason, 'permission');
  ok(names(tracked, 'mic_permission').some((e) => e[1].permission_state === 'denied' && e[1].kind === 'mic'));
  ok(!/Settings|Privacy|denied the/.test(JSON.stringify(fails[0][1])));
});

test('听出字并且翻译请求发出去 ⇒ translate_start，每场一次', async () => {
  const { A, tracked, captured, clk } = boot();
  A.open('conv');
  await clk.runTo(0);
  A.pttToggle('other');
  await clk.runTo(0);
  captured.h.onState('granted', '', 'mic');
  const t0 = clk.now();
  captured.onStt('final', { locale: 'en-US', text: 'Hello there.', conf: 0.95, t0, t1: t0 + 800 });
  await clk.runTo(0);
  A.pttToggle('other');
  await clk.runTo(2000);
  const starts = names(tracked, 'translate_start');
  const d = A._debug();
  ok(starts.length === 1, 'translate_start 条数 ' + starts.length
    + ' 事件 ' + tracked.map((e) => e[0]).join(',')
    + ' phase ' + d.phase + ' rows ' + d.rows.length + ' seg ' + JSON.stringify(d.seg && { route: d.seg.route, calls: d.seg.calls }));
  eq(names(tracked, 'translate_ok').length <= 1, true);
});
