// test/n26-session.test.js — N26 App host: halt table, USD meter, fail CTA.
//
// The contract module is src/app/n26-session.js (same helpers as mobiletranslator
// main). The host is src/app/listen-model.js: listen and live subtitles share
// translate / passRow / segCall, so one pump gate covers both screens.
const { describe, test, ok, eq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');

const N = loadSrc('src/app/n26-session.js', 'N26').N26;
const t = (k, d) => d;

describe('n26-session — halt table', () => {
  test('即停四码；http / network / 429 不停；timeout 连续 5 才停；stalled 不计数', () => {
    const h = N.createHalt();
    for (const code of ['credit_exhausted', 'grant_unavailable', 'model_not_allowed', 'auth']) {
      const x = N.createHalt();
      eq(x.noteFailure({ code }).halted, true, code);
      eq(x.code, code);
    }
    const http = N.createHalt();
    for (let i = 0; i < 6; i++) http.noteFailure({ code: 'http', status: 500 });
    eq(http.halted, false);
    eq(http.noteFailure({ code: 'network' }).halted, false);
    eq(http.noteFailure({ status: 429, code: 'rate_limit' }).halted, false);
    eq(http.noteFailure({ code: 'too_many_requests' }).halted, false);
    eq(http.noteFailure({ code: 'busy' }).halted, false);
    eq(N.normalizeCode({ code: 'grant_invalid' }), 'grant_unavailable');
    eq(h.noteFailure({ stalled: true, code: 'timeout' }).streak, 0);
    eq(h.halted, false);
    for (let i = 0; i < 4; i++) eq(h.noteFailure({ code: 'timeout' }).halted, false);
    eq(h.streak, 4);
    eq(h.noteFailure({ code: 'timeout' }).halted, true);
    eq(h.code, 'timeout');
    eq(h.noteFailure({ code: 'credit_exhausted' }).code, 'timeout', '已经停了就不再改码');
    h.retry();
    eq(h.halted, false);
    eq(h.streak, 0);
    h.noteFailure({ code: 'timeout' });
    h.noteFailure({ code: 'timeout' });
    h.noteSuccess();
    eq(h.streak, 0);
    eq(h.halted, false);
  });
});

describe('n26-session — USD meter', () => {
  test('只读 spentUsd / limitUsd，格式 $x.xx / $y.yy', () => {
    eq(N.meterText(null), '');
    eq(N.meterText({ freeQuotaUsed: 3, daily: 1 }), '');
    eq(N.meterText({ spentUsd: 0, limitUsd: 0.2, at: Date.now() }), '$0.00 / $0.20');
    eq(N.meterText({ spentUsd: 0.2, limitUsd: 0.2, at: Date.now() }), '$0.20 / $0.20');
    eq(N.meterText({ spentUsd: 0.05, limitUsd: 0.2, segments: 9, at: Date.now() }), '$0.05 / $0.20');
    eq(N.meterText({ spentUsd: 0, limitUsd: 0 }), '');
  });
});

describe('n26-session — fail surface', () => {
  test('落点 grant-card / notes-provider；中国版没有免费通道次按钮；不自动重试', () => {
    const bal = { spentUsd: 0.2, limitUsd: 0.2, at: Date.now() };
    const ex = N.failSurface('credit_exhausted', { t, region: 'global', grantBalance: bal });
    eq(ex.halt, true);
    eq(ex.showAutoRetry, false);
    eq(ex.meter, '$0.20 / $0.20');
    eq(ex.meterLabel, '免费额度');
    eq(ex.primary.landing, 'grant-card');
    eq(ex.secondary.landing, 'notes-provider');
    const authCn = N.failSurface('auth', { t, region: 'cn' });
    eq(authCn.secondary, null);
    eq(authCn.primary.landing, 'notes-provider');
    const authG = N.failSurface('auth', { t, region: 'global' });
    eq(authG.secondary.landing, 'grant-card');
    const toCn = N.failSurface('timeout', { t, region: 'cn' });
    eq(toCn.secondary, null);
    eq(toCn.primary.action, 'retry');
    ok(toCn.next.indexOf('改免费') < 0, '中国版超时句不提免费通道：' + toCn.next);
    const toG = N.failSurface('timeout', { t, region: 'global' });
    eq(toG.secondary.landing, 'grant-card');
    const model = N.failSurface('model_not_allowed', { t, region: 'cn' });
    eq(model.primary.landing, 'grant-card');
    eq(model.primary.clearModel, true);
    const row = N.failSurface('http', { t, region: 'global' });
    eq(row.halt, false);
    eq(row.primary.action, 'retry-unit');
    eq(row.showAutoRetry, false);
  });
});

function fakeClock() {
  let t0 = 1_700_000_000_000, seq = 1;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  return {
    now: () => t0,
    setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t0 + (Number(ms) || 0) }); return id; },
    clearT: (id) => { timers.delete(id); },
    async runTo(ms) {
      const end = t0 + ms;
      for (;;) {
        let n = null;
        for (const [id, x] of timers) if (x.at <= end && (!n || x.at < n.x.at)) n = { id, x };
        if (!n) break;
        timers.delete(n.id);
        t0 = Math.max(t0, n.x.at);
        n.x.fn();
        await flush();
      }
      t0 = end;
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

function hostSandbox(opts) {
  const o = opts || {};
  const calls = [];
  const opened = [];
  const moments = [];
  const shows = [];
  const clk = fakeClock();
  const stored = Object.assign({
    listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false,
    provider: 'deepseek', apiKey: 'k',
  }, o.stored || {});
  const tr = { provider: stored.provider, apiKey: stored.apiKey, baseUrl: 'https://api.example.test', model: 'm' };
  const els = {};
  const getEl = (id) => {
    if (!els[id]) els[id] = mkEl();
    return els[id];
  };
  // 两个首页 section 在真 DOM 里恒存在（AppShell 静态 JSX），这里也先建出来，
  // 否则测试看的是「元素不存在」而不是「hidden 有没有被翻对」。
  getEl('signed-in'); getEl('signed-out');
  // 首页两个 section 默认都 hidden（AppShell 静态 JSX 的初始态）。
  getEl('signed-in').hidden = true; getEl('signed-out').hidden = true;
  // P1-2：模拟「已经站在 listen 视图里」——#signed-in 被上一轮 open() 藏掉了。
  if (o.domSignedInHidden) getEl('signed-in').hidden = true;
  if (o.domSignedInVisible) getEl('signed-in').hidden = false;
  const sb = {
    window: {
      addEventListener() {}, removeEventListener() {},
      AudioContext: function () {}, webkitAudioContext: function () {},
      MT_FLAVOR: o.flavor || 'global',
      MT_LANGS: [{ code: 'en', label: 'English' }, { code: 'zh', label: '中文' }],
    },
    document: { getElementById: getEl, querySelector: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(), hidden: false },
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: {
      get: (k, cb) => cb(Object.assign({}, stored)),
      set: (patch, cb) => { Object.assign(stored, patch); if (cb) cb(); },
    }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: C,
    NativeAudio: {
      available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok' }),
      micStart: (rate, h) => { sb.__mic = h; return true; }, micStop: () => {}, recordMode: () => {},
      sessionStart: () => {}, sessionStop: () => {}, onEvent: () => {}, onTick: () => {},
      playingState: () => {}, nowPlaying: () => {},
      subtitleShow: (p) => { shows.push(p); }, subtitleState: () => {}, subtitleConfig: () => {},
      subtitleHide: () => {}, subtitleFloat: () => {}, capsProbe: async () => ({ system: 'ok' }),
    },
    NativeSpeech: {
      available: () => true,
      probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
      probe: async () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
      ensureAssets: async () => ({ ok: true }),
      ensureLid: async () => ({ ok: true }),
      ensureVad: async () => ({ ok: true }),
      supportedLocales: () => ['en', 'zh'],
      lidPause: () => {}, diagAudio: () => {},
      onLid: () => () => {},
      sttOpen: (x) => { sb.__onEvent = x.onEvent; return { sendPcm: () => true, close() {}, cut() {} }; },
    },
    DiagLog: { push: () => {} },
    MTTelemetry: { track: () => {}, once: () => {} },
    MTFeedback: { noteValueMoment: (k) => { moments.push(k); return Promise.resolve(); } },
    LearnNotes: { resolveConfig: () => tr, shouldCapture: () => false, langAllowed: () => true },
    LearnRules: { dominantScript: (text) => (/[\u4e00-\u9fff]/.test(String(text || '')) ? 'Han' : 'Latin') },
    LearnDialog: { confirm: async () => true },
    LearnGrant: { activeIn: (s, slot) => slot === 'chat' && !!(s && s.grantBalance && s.grantTail && s.apiKey) },
    TranslationAPI: {
      resolveProvider: (id) => id || 'deepseek',
      listenPass: async (p) => {
        calls.push(p);
        if (o.fail) {
          const e = o.fail(calls.length);
          if (e) throw e;
        }
        const b = String((p && p.user) || '').split('待处理文本：').pop().split('\n\n是否强制收尾')[0].trim();
        return JSON.stringify({ segments: [{ source: b, translation: '好的' }], remainder: '' });
      },
      translate: async () => {
        calls.push('translate');
        if (o.fail) {
          const e = o.fail(calls.length);
          if (e) throw e;
        }
        return '译文';
      },
    },
    EngineState: { byId: () => ({ id: 'deepseek', type: 'chat-compat', defaultModel: 'm' }) },
    WireFormat: {
      formatFor: () => 'chat-compat',
      resolveEndpoint: () => 'https://api.example.test/chat/completions',
      translationModelName: () => !!o.legacy,
    },
    Date: { now: () => clk.now() },
    setTimeout: (fn, ms) => clk.setT(fn, ms), clearTimeout: (id) => clk.clearT(id),
    setInterval: (fn, ms) => clk.setT(fn, ms), clearInterval: (id) => clk.clearT(id),
    console, URL,
  };
  return { sb, clk, calls, opened, moments, shows, stored, els };
}

async function openConv(opts) {
  const box = hostSandbox(opts);
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', box.sb);
  const A = ctx.AppListen;
  const landed = [];
  A.wire({ openSettings: (id) => { landed.push(id); } });
  A.open('conv');
  await box.clk.runTo(0);
  A.setAutoSpeak(false);
  A.pttToggle('other');
  await box.clk.runTo(0);
  if (box.sb.__mic && box.sb.__mic.onState) box.sb.__mic.onState('granted', '');
  await box.clk.runTo(0);
  return Object.assign(box, { A, landed });
}

// 路由器的空闲计时用的是宿主 setTimeout。测试时钟推不到它，所以用点停把缓冲强制送出
// （与 listen-ptt-e2e 同一条收口）。点停是测试在收口，不是翻译失败把麦停了。
async function say(box, text) {
  const t0 = box.clk.now();
  if (!box.sb.__onEvent) throw new Error('socket onEvent missing');
  if (!box.A._debug().ptt.on) {
    box.A.pttToggle('other');
    await box.clk.runTo(0);
    if (box.sb.__mic && box.sb.__mic.onState) box.sb.__mic.onState('granted', '');
    await box.clk.runTo(0);
  }
  box.sb.__onEvent('final', { locale: 'en-US', text, conf: 0.95, t0, t1: t0 + 700 });
  await box.clk.runTo(0);
  box.A.pttToggle('other');
  await box.clk.runTo(1000);
}

function boom(code, extra) {
  const e = new Error(code);
  e.code = code;
  Object.assign(e, extra || {});
  return e;
}

describe('listen host pump — N26 halt / meter / CTA', () => {
  test('credit_exhausted 停泵：第二次不再打 listenPass，麦不停，失败面落 grant-card', async () => {
    const box = await openConv({
      fail: () => boom('credit_exhausted', { status: 402, grant: true }),
      stored: {
        grantBalance: { spentUsd: 0.2, limitUsd: 0.2, at: 1_700_000_000_000 },
        grantTail: 'abcd1234', apiKey: 'token-abcd1234', provider: 'deepseek',
      },
    });
    await say(box, 'Yes please.');
    const afterFirst = box.calls.length;
    ok(afterFirst >= 1, '第一句应该发出翻译');
    eq(box.A._debug().n26.halted, true);
    eq(box.A._debug().n26.code, 'credit_exhausted');
    eq(box.A._debug().pauseReason, 'user', '翻译停泵不该改成麦克风具名停止');
    const face = box.A.failView();
    eq(face.shown, true);
    eq(face.primary.landing, 'grant-card');
    eq(face.secondary.landing, 'notes-provider');
    eq(face.meter, '$0.20 / $0.20');
    eq(face.meterLabel, '免费额度');
    eq(box.A.meterView().shown, false, '用完时数字只出现在失败面上');
    eq(face.showAutoRetry, undefined);
    box.A.failAct('primary');
    eq(box.landed[0], 'grant-card');
    await say(box, 'And another sentence here.');
    eq(box.calls.length, afterFirst, '停泵之后又发出了翻译：' + box.calls.length);
    await box.A.end();
    await box.clk.runTo(0);
    eq(box.moments.length, 0, '停泵面上不该要评分');
  });

  test('http 与 429 不停泵；单次 timeout 只记账；stalled 不加 streak', async () => {
    const http = await openConv({ fail: () => boom('http', { status: 500 }) });
    await say(http, 'Yes please.');
    eq(http.A._debug().n26.halted, false);
    ok(http.calls.length >= 1);
    const n = http.calls.length;
    await say(http, 'Still going please.');
    ok(http.calls.length > n, 'http 失败之后泵还要继续');
    await http.A.end();

    const limited = await openConv({ fail: () => boom('rate_limit', { status: 429 }) });
    await say(limited, 'Yes please.');
    eq(limited.A._debug().n26.halted, false);
    eq(limited.A._debug().n26.code, '');
    await limited.A.end();

    const once = await openConv({ fail: () => boom('timeout') });
    await say(once, 'Yes please.');
    eq(once.A._debug().n26.halted, false, '一次超时不该停泵');
    ok(once.A._debug().n26.streak >= 1 && once.A._debug().n26.streak < 5, 'streak=' + once.A._debug().n26.streak);
    await once.A.end();

    const stall = await openConv({ fail: () => boom('timeout', { stalled: true }) });
    await say(stall, 'Yes please.');
    eq(stall.A._debug().n26.streak, 0);
    eq(stall.A._debug().n26.halted, false);
    await stall.A.end();
  });

  test('连续超时满 5 次才停，之后不再发', async () => {
    const box = await openConv({
      fail: (n) => (n <= 5 ? boom('timeout') : boom('should-not-send')),
    });
    await say(box, 'Yes please.');
    if (!box.A._debug().n26.halted) await say(box, 'Second sentence please.');
    if (!box.A._debug().n26.halted) await say(box, 'Third sentence please.');
    eq(box.A._debug().n26.halted, true);
    eq(box.A._debug().n26.code, 'timeout');
    eq(box.calls.length, 5, '第 6 次不该发出，实际 ' + box.calls.length);
    const face = box.A.failView();
    eq(face.primary.action, 'retry');
    eq(face.secondary.landing, 'grant-card');
    await say(box, 'Fourth sentence please.');
    eq(box.calls.length, 5);
    await box.A.end();
    eq(box.moments.length, 0);
  });

  test('中国版 auth 失败面没有免费通道次按钮，主按钮去 notes-provider', async () => {
    const box = await openConv({
      flavor: 'china',
      fail: () => boom('auth', { status: 401, halt: true }),
    });
    await say(box, 'Yes please.');
    eq(box.A._debug().n26.code, 'auth');
    const face = box.A.failView();
    eq(face.secondary, null);
    eq(face.primary.landing, 'notes-provider');
    box.A.failAct('primary');
    eq(box.landed[0], 'notes-provider');
    await box.A.end();
  });

  test('额度条只在用着免费额度时显示 $spent / $limit；成功结束才记 rate_prompt', async () => {
    const bare = await openConv({});
    eq(bare.A.meterView().shown, false);
    await bare.A.end();

    const box = await openConv({
      stored: {
        grantBalance: { spentUsd: 0.05, limitUsd: 0.2, at: 1_700_000_000_000 },
        grantTail: 'abcd1234', apiKey: 'token-abcd1234', provider: 'deepseek',
      },
    });
    const meter = box.A.meterView();
    eq(meter.shown, true);
    eq(meter.label, '免费额度');
    eq(meter.text, '$0.05 / $0.20');
    ok(!/段|daily|freeQuotaUsed/.test(meter.text + meter.label));
    await say(box, 'Yes please.');
    const rows = box.A._debug().rows;
    ok(rows.some((r) => r.tr), '成功译文没落行：' + JSON.stringify(rows.map((r) => r.tr)));
    eq(box.A._debug().n26.halted, false);
    const before = box.A._debug();
    await box.A.end();
    await box.clk.runTo(0);
    eq(box.moments.length, 1, JSON.stringify({
      moments: box.moments,
      phase: before.phase,
      rows: before.rows.map((r) => ({ who: r.who, tr: r.tr, err: r.trErr })),
    }));
    eq(box.moments[0], 'listen');
  });
});


// ── P1-2：离开会话误显「未登录」────────────────────────────────────────────
// open() 旧实现读 #signed-in.hidden：第一次进 listen 就把它藏了，视图里再 open()
// 一次就把 cameFrom 记成 signed-out，离开时露出登录页。这里把 DOM 两向都设成
// 与登录态相反，证明来源只认显式 session，不认 DOM；再做一次「杀进程重开」。
function loadListen(session, opts) {
  const box = hostSandbox(opts);
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', box.sb);
  const A = ctx.AppListen;
  A.wire({ openSettings: () => {}, session: () => session });
  return { box, A };
}

describe('P1-2 离开会话 — cameFrom 是显式登录态，不是 DOM 可见性', () => {
  test('已在 listen 视图里再 open()：仍是 signed-in；离开回到登录态首页', async () => {
    const { box, A } = loadListen({ userId: 'u1' }, { domSignedInHidden: true });
    A.open('conv');
    await box.clk.runTo(0);
    eq(A._debug().cameFrom, 'signed-in', '第一次进 listen 就被 DOM hidden 骗了');
    A.open('conv');                       // 旧实现在这里会记成 signed-out
    await box.clk.runTo(0);
    eq(A._debug().cameFrom, 'signed-in');
    await A.leave();
    await box.clk.runTo(0);
    eq(box.els['signed-in'].hidden, false, '离开后没回到登录态首页');
    eq(box.els['signed-out'].hidden, true, '离开后误露了未登录页');
  });

  test('杀进程重开：新模型实例 + 已恢复的 session，open/leave 仍是 signed-in', async () => {
    const first = loadListen({ userId: 'u1' }, { domSignedInHidden: true });
    first.A.open('conv');
    await first.box.clk.runTo(0);
    await first.A.leave();
    // 新实例 = 进程重开（内存里的 cameFrom 不在了，session 由宿主从存储恢复）
    const second = loadListen({ userId: 'u1' }, { domSignedInHidden: true });
    second.A.open('conv');
    await second.box.clk.runTo(0);
    eq(second.A._debug().cameFrom, 'signed-in');
    await second.A.leave();
    await second.box.clk.runTo(0);
    eq(second.box.els['signed-in'].hidden, false);
    eq(second.box.els['signed-out'].hidden, true);
  });

  test('真未登录：DOM 显示 signed-in 也不许冒充，离开落到登录页', async () => {
    const { box, A } = loadListen(null, { domSignedInVisible: true });   // DOM 说已登录
    A.open('conv');
    await box.clk.runTo(0);
    eq(A._debug().cameFrom, 'signed-out');
    await A.leave();
    await box.clk.runTo(0);
    eq(box.els['signed-out'].hidden, false, '真未登录却没有登录页');
    eq(box.els['signed-in'].hidden, true);
  });
});

describe('BEL-151 B-PUSH handlePendingConfirm — no URL roundtrip', () => {
  const session = require('../agent/session');
  const PENDING = '4839f0b4-8948-4c2c-861e-bd8bc1726167';
  const READY = { login: true, network: true };

  function ctxOf(extra) {
    const remembered = [];
    const decisions = [];
    const opened = [];
    return {
      remembered,
      decisions,
      opened,
      ctx: Object.assign({
        scheme: 'belliedmonkey',
        readiness: READY,
        ports: { enterSubtitle() { opened.push('subtitle'); return { ok: true }; } },
        deviceBridge: {
          rememberPending(row) { remembered.push(row); },
          confirm(call) { decisions.push(call); return { ok: true, sent: true }; },
        },
      }, extra || {}),
    };
  }

  test('pending mounts confirm with no URL and cancel never openedSubtitles', async () => {
    const { ctx, remembered, decisions, opened } = ctxOf();
    const shown = [];
    const out = await session.handlePendingConfirm(
      { action: 'start_live_subtitles', pending_id: PENDING },
      ctx,
      {
        confirm(card) {
          eq(card.title, '确认调用');
          return { allow: false };
        },
        show(rec) { shown.push(rec); },
      },
    );
    eq(out.code, 'cancelled');
    eq(remembered.length, 1);
    eq(remembered[0].pending_id, PENDING);
    eq(decisions.length, 1);
    eq(decisions[0].decision, 'deny');
    eq(opened.length, 0);
    eq(shown.length, 1);
    ok(!JSON.stringify(out).includes('openedSubtitles'), 'cancel claimed a surface');
  });

  test('parse-fail / 无 URL 仍 mount：listen URL returns null, structured pending does not', async () => {
    const { ctx, remembered, opened } = ctxOf();
    const silent = await session.handleAgentUrl('belliedmonkey://listen/subtitle', ctx, {
      confirm() { throw new Error('confirm must not run on parse-null'); },
      show() { throw new Error('show must not run on parse-null'); },
    });
    eq(silent, null);

    let confirmCalled = false;
    const out = await session.handlePendingConfirm(
      { action: 'start_live_subtitles', pending_id: PENDING },
      ctx,
      {
        confirm(card) {
          confirmCalled = true;
          eq(card.title, '确认调用');
          return { allow: false };
        },
        show() {},
      },
    );
    eq(confirmCalled, true);
    eq(out.code, 'cancelled');
    eq(remembered.length, 1);
    eq(opened.length, 0);
    ok(out !== null, 'pending must not return null');
    ok(!JSON.stringify(out).includes('openedSubtitles'));
  });

  test('unknown action is a failure card + deny, never silent null or openedSubtitles', async () => {
    const { ctx, remembered, decisions, opened } = ctxOf();
    const shown = [];
    const out = await session.handlePendingConfirm(
      { action: 'not_a_tool', pending_id: PENDING },
      ctx,
      {
        confirm() { throw new Error('unknown action must not confirm-run'); },
        show(rec) { shown.push(rec); },
      },
    );
    eq(out.code, 'unsupported_action');
    eq(remembered.length, 1);
    eq(decisions[0].decision, 'deny');
    eq(shown.length, 1);
    eq(opened.length, 0);
    ok(out !== null);
    ok(!JSON.stringify(out).includes('openedSubtitles'));
  });
});
