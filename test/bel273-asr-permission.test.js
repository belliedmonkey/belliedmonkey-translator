// BEL-273：麦克风权限预检 + 采集链 native_code。
//
// 判据分两层：
//   1. 纯状态机 —— 未决定先解释、拒绝给设置、从设置回来重试、已授权直接开；
//   2. 接线 —— 真模型走同一串原生消息，事件属性必须仍是**已部署** asr_fail 白名单的子集。
// native_code 不在部署白名单里（schema 冻结），所以第 2 层同时钉住「文档化降级」：
// 只留在会话/_debug/可见失败句，绝不混进事件，也不静默丢。
const fs = require('fs');
const path = require('path');
const { test, ok, eq, loadSrc, loadModule } = require('./harness');
const cfg = require('../build/telemetry.config.js');
const C = require('../app/listen-core.js');

const DEPLOYED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/bt-ingest/events.gen.json'), 'utf8')).events.asr_fail;
const DEPLOYED_KEYS = Object.keys(DEPLOYED);

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

function boot() {
  const tracked = [];
  const captured = { h: null, native: null, reads: 0, starts: 0, settings: 0 };
  const clk = fakeClock();
  const NativeAudio = {
    available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok', sources: ['mic', 'system'] }),
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

test('BEL-273 状态机：未决定 → 先解释 → 请求；拒绝 → 设置；授权 → 开', () => {
  const M = loadSrc('src/app/mic-permission.js', 'MicPermission').MicPermission;
  let m = M.initial();
  eq(m.state, 'unknown');
  eq(M.canStart(m), true, '还没读到状态时放行（老壳退回原生请求）');

  m = M.enter(m, 'not_determined');
  eq(m.gate, 'explain');
  eq(M.canStart(m), false, '未决定且没解释过时不能直接开麦');

  m = M.explain(m);
  eq(m.gate, 'requesting');
  eq(M.canStart(m), true, '解释之后才允许触发系统框');

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
  eq(M.canStart(d), true, '从设置回来重试必须能开，不要求重启');
});

test('BEL-273 接线：进听译先读权限；未决定显示解释，继续后才发 mic-start', async () => {
  const { A, captured, clk } = boot();
  A.wire();
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  const reads0 = captured.reads;
  A.open('conv');
  await clk.runTo(0);
  ok(captured.reads > reads0, '进入听译页要再读一次真实权限（只读）');

  const pv = A.permView();
  eq(pv.shown, true);
  eq(pv.gate, 'explain');
  eq(A.pttToggle('other'), false, '未决定时不能直接开麦');
  eq(captured.starts, 0, '解释之前不该触发系统请求');
  eq(A._debug().perm.pending.kind, 'ptt');

  A.permAct('primary');
  await clk.runTo(0);
  eq(captured.starts, 1, '点「继续」后系统请求才发（mic-start 触发原生框）');
  eq(A._debug().perm.gate, 'requesting');
});

test('BEL-273 接线：拒绝显示「去设置」，回来授权后重试直接开始', async () => {
  const { A, tracked, captured, clk } = boot();
  A.wire();
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  A.open('conv');
  await clk.runTo(0);
  eq(A.pttToggle('other'), false, '未决定时先被解释门挡住');
  await clk.runTo(0);
  A.permAct('primary');          // 「继续」→ 系统框 → 用户拒绝
  await clk.runTo(0);
  ok(captured.h, '继续之后应该已经发过 mic-start，原生才有 h 回调');
  captured.h.onState('denied', '', 'mic');
  await clk.runTo(0);

  const pv = A.permView();
  eq(pv.gate, 'denied');
  ok(pv.primary && pv.primary.action === 'settings' && pv.primary.label, '拒绝卡必须有可点的「去设置」');
  ok(pv.secondary && pv.secondary.action === 'retry', '拒绝卡还要有「重试」');
  eq(names(tracked, 'asr_fail')[0][1].fail_reason, 'permission', '拒绝的统计仍是 permission');

  A.permAct('primary');
  eq(captured.settings, 1, '「去设置」必须走原生设置深链，不是一段文字');
  eq(A._debug().perm.settingsOpened, true);

  // 从设置回来：原生回读 granted。不重启 App，直接重试。
  captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  eq(A._debug().perm.gate, '', '授权后门要清掉');
  const starts0 = captured.starts;
  A.permAct('secondary');
  await clk.runTo(0);
  ok(captured.starts > starts0, '回来点重试必须真的重新开麦，不要求杀掉进程');
});

test('BEL-273 接线：已授权直接开始，不显示权限门', async () => {
  const { A, captured, clk } = boot();
  A.wire();
  captured.native({ type: 'mic-perm', state: 'granted', kind: 'mic' });
  A.open('conv');
  await clk.runTo(0);
  eq(A.permView().shown, false);
  A.pttToggle('other');
  await clk.runTo(0);
  eq(captured.starts, 1);
  ok(A._debug().perm.gate === '');
});

test('BEL-273 边界：Mac 实时字幕听系统声音，不被麦克风门拦住', async () => {
  const { A, captured, clk } = boot();
  A.wire();
  captured.native({ type: 'mic-perm', state: 'not_determined', kind: 'mic' });
  A.open('subtitle');
  await clk.runTo(0);
  eq(A.permView().shown, false, '系统声音字幕不该显示麦克风门');
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

test('BEL-273 采集失败：两个不同 native code/domain 都穿过到会话读数', async () => {
  const a = await captureFail('NSOSStatusErrorDomain:-10851');
  eq(a.A._debug().asrNativeCode, 'NSOSStatusErrorDomain:-10851');
  const b = await captureFail('AVAudioEngine:converter');
  eq(b.A._debug().asrNativeCode, 'AVAudioEngine:converter');
  ok(a.A._debug().asrNativeCode !== b.A._debug().asrNativeCode, '两个原因必须可区分');
});

test('BEL-273 采集失败：asr_fail 仍是部署白名单子集，native_code 不混入事件', async () => {
  // 先钉住契约缺口本身：部署的 asr_fail 没有 native_code（也冻结了 schema）。
  ok(DEPLOYED_KEYS.indexOf('native_code') < 0, '如果白名单已加 native_code，本测试与 RESULT 的契约缺口说明要一起改');
  eq(DEPLOYED_KEYS.sort().join(','), Object.keys(cfg.EVENTS.asr_fail).sort().join(','),
    '仓库白名单与部署白名单必须一致，避免本地自嗨');

  const b = await captureFail('NSOSStatusErrorDomain:-10851');
  const fails = names(b.tracked, 'asr_fail');
  eq(fails.length, 1);
  eq(fails[0][1].fail_reason, 'capture');
  for (const k of Object.keys(fails[0][1])) {
    ok(DEPLOYED_KEYS.indexOf(k) >= 0, `事件属性 ${k} 不在部署 asr_fail 白名单里`);
  }
  ok(!/Domain|NSError|Too many|SFSpeech|Settings/.test(JSON.stringify(fails[0][1])), '事件里不许有系统长文');
  ok(!('native_code' in fails[0][1]), '冻结白名单下 native_code 只能走本地读数，不能塞事件');
});

test('BEL-273 采集失败：老壳长文不落 props，折成 capture；权限/采集中断三码互斥', async () => {
  const b = await captureFail('Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales"');
  eq(b.A._debug().asrNativeCode, '', '不合有界 domain:code 的长文不缓存');
  const f = names(b.tracked, 'asr_fail')[0][1];
  eq(f.fail_reason, 'capture');
  ok(!/Domain|SFSpeech|Too many/.test(JSON.stringify(f)));

  const map = b.A._debug().asrFailReason;
  eq(map('denied', ''), 'permission');
  eq(map('failed', 'native'), 'capture');
  eq(map('locked', ''), 'interrupted');
  eq(new Set([map('denied', ''), map('failed', 'native'), map('locked', '')]).size, 3,
    'permission / capture / interrupted 必须是三个不同的统计值');
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
