// test/bel230-q1-signout.test.js — BEL-230 Q1：真实换号是「A 退出 → 登录 → B 登录」。
//
// 上一版只修了同一页面里 A→B 直接换号（accountSwitched 为真），而三条 UI 退出路径
// 都先 show(null)，B 登录时 prevSession 已是 null ⇒ 换号清理永远不启动。这里钉四件：
//   1. 退出（show(null) 的清理口）按 ^bmg_ 前缀清三槽，grantTail 为空也清；用户自己的
//      key 一个字节不动 —— 不再有 `if (cur.grantTail)`。
//   2. 退出后 B 登录（prev=null）自动 claim 一次 ⇒ 三槽 = B 的新 token，TTS 也换到 B。
//   3. A 的 claim 晚到（await 期间换号）⇒ 不覆盖 B 的槽、不写 trackEngineSet。
//   4. 听译：换号后旧 cfg 不再发请求，迟到结果被 epoch/gen 丢掉。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, loadSrc, tick } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SPEC = {
  vendor: 'openrouter', vendorLabel: 'OpenRouter', limitUsd: 0.2,
  claimUrl: 'https://backend.example/functions/v1/bt-grant',
  models: { chat: 'deepseek/deepseek-v4-flash' },
};
const REG = {
  MT_PROVIDERS: [{ id: 'grant', type: 'chat-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/chat/completions',
    defaultModel: 'deepseek/deepseek-v4-flash' }],
  MT_TTS_ENGINES: [{ id: 'grant_speech', type: 'speech-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/audio/speech',
    defaultModel: 'deepgram/aura-2' }],
  MT_STT_ENGINES: [{ id: 'grant_stt', type: 'transcribe-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/audio/transcriptions',
    defaultModel: 'openai/gpt-4o-mini-transcribe' }],
};

const OLD_TOKEN = 'bmg_OLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDoldtail9';
const NEW_TOKEN = 'bmg_NEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWnewtail8';
const LATE_TOKEN = 'bmg_LATELATELATELATELATELATELATELATELATEtail7';

function loadGrant() {
  return loadSrc('src/shared/grant.js', 'grant', {
    window: Object.assign({ MT_GRANT: SPEC }, REG),
    document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) },
    chrome: { i18n: { getMessage: () => '' } },
  }).grant;
}
function loadShell() {
  return loadSrc('src/app/shell-model.js', 'Shell', { URL }).Shell;
}

// ── 一个可读写的 storage.local 替身（get 同时支持 callback / promise）──────────
function makeStorage(seed) {
  const store = Object.assign({}, seed || {});
  const writes = [];
  const pick = (keys) => {
    const out = {};
    const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
    for (const k of arr) if (k in store) out[k] = store[k];
    return out;
  };
  const get = (keys, cb) => {
    const out = pick(keys);
    if (cb) cb(out);
    return Promise.resolve(out);
  };
  const set = (patch, cb) => {
    writes.push(Object.assign({}, patch));
    Object.assign(store, patch);
    if (cb) cb();
    return Promise.resolve();
  };
  const remove = (keys, cb) => {
    for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
    if (cb) cb();
    return Promise.resolve();
  };
  return { store, writes, get, set, remove };
}

function loadSettings(storage, opts) {
  const o = opts || {};
  const G = loadGrant();
  const claims = [];
  const tracked = [];
  const ttsCfgs = [];
  const claim = o.claim || (async () => {
    claims.push(1);
    return { token: NEW_TOKEN, limitUsd: 0.2, spentUsd: 0, reused: false };
  });
  const LearnGrant = Object.assign({}, G, { claim });
  const LearnTTS = {
    config: { engineId: '', apiKey: '', baseUrl: '', model: '', voice: '' },
    configure(next) { ttsCfgs.push(Object.assign({}, next)); Object.assign(this.config, next); return this.config; },
  };
  const ctx = loadSrc('src/app/settings-model.js', 'Settings', {
    window: Object.assign({ MT_GRANT: SPEC }, REG),
    chrome: {
      i18n: { getUILanguage: () => 'zh-CN', getMessage: () => '' },
      storage: { local: { get: storage.get, set: storage.set, remove: storage.remove }, onChanged: { addListener() {} } },
    },
    navigator: { language: 'zh-CN' },
    LearnGrant, LearnTTS,
    EngineState: { needsSetup: () => false, resolve: (p) => String(p || '') },
    MTTelemetry: { track: (name, props) => { tracked.push({ name, props }); }, once() {} },
    AppSetupDone: { show: async () => {} },
    console, URL,
  });
  return { Settings: ctx.Settings, claims, tracked, ttsCfgs, LearnGrant };
}

// ── 听译模型：真 listen-model，只把原生桥 / 翻译 API 换成桩 ──────────────────
function mkEl() {
  return { hidden: false, disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; }, getAttribute() { return ''; } };
}

function bootListen(opts) {
  const o = opts || {};
  const calls = { translate: [], pass: [] };
  const store = Object.assign({
    listenOtherLang: 'en', listenMyLang: 'zh', listenAutoSpeak: false, listenCapture: false,
    provider: 'deepseek', apiKey: 'A_KEY',
  }, o.store || {});
  const get = (keys, cb) => {
    const out = {};
    const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
    for (const k of arr) if (k in store) out[k] = store[k];
    if (cb) cb(out);
    return Promise.resolve(out);
  };
  const set = (patch, cb) => { Object.assign(store, patch); if (cb) cb(); return Promise.resolve(); };
  const remove = (k, cb) => { delete store[k]; if (cb) cb(); return Promise.resolve(); };
  const sb = {
    window: {
      addEventListener() {}, removeEventListener() {},
      AudioContext: function () {}, webkitAudioContext: function () {},
      MT_LANGS: [{ code: 'en', label: 'English' }, { code: 'zh', label: '中文' }],
    },
    document: { getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(), hidden: false },
    navigator: { platform: 'MacIntel', maxTouchPoints: 0, language: 'zh-CN', userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome: { storage: { local: { get, set, remove }, onChanged: { addListener() {} } }, runtime: { getURL: (u) => u } },
    ListenCore: require('../app/listen-core.js'),
    NativeAudio: {
      available: () => true, suspends: () => false, audioCaps: () => ({ system: 'ok' }),
      micStart: () => true, micStop() {}, recordMode() {}, sessionStart() {}, sessionStop() {},
      onEvent() {}, onTick() {}, micPermRead: () => true, playingState() {}, nowPlaying() {},
      subtitleShow() {}, subtitleState() {}, subtitleConfig() {}, subtitleHide() {}, subtitleFloat() {},
      capsProbe: async () => ({ system: 'ok' }),
    },
    NativeSpeech: {
      available: () => true,
      supportedLocales: () => ['zh-CN', 'en-US'],
      probeResult: () => ({ ok: true, reason: '', assets: 'installed', locales: [] }),
      probe: async () => ({ ok: true, reason: '', assets: 'installed' }),
      ensureAssets: async () => ({ ok: true }), ensureLid: async () => ({ ok: true }), ensureVad: async () => ({ ok: true }),
      lidPause() {}, diagAudio() {}, onLid: () => () => {},
      sttOpen: () => ({ sendPcm: () => true, close() {}, cut() {} }),
    },
    DiagLog: { push() {} }, MTTelemetry: { track() {}, once() {} }, MTFeedback: {},
    LearnNotes: { resolveConfig: () => ({ provider: 'deepseek', apiKey: 'A_KEY', baseUrl: 'https://api.example.test', model: 'm' }) },
    LearnRules: { dominantScript: () => 'Latin', langAllowed: () => true },
    LearnDialog: { confirm: async () => true },
    TranslationAPI: {
      resolveProvider: (p) => p,
      listenPass: (...args) => { calls.pass.push(args); return o.passImpl ? o.passImpl(...args) : Promise.resolve('{}'); },
      translate: (...args) => { calls.translate.push(args); return o.translateImpl ? o.translateImpl(...args) : Promise.resolve('x'); },
    },
    EngineState: { byId: () => ({ id: 'deepseek', type: 'chat-compat', defaultModel: 'm' }) },
    WireFormat: { formatFor: () => 'chat-compat', resolveEndpoint: () => 'https://api.example.test/chat/completions', translationModelName: () => false },
    console, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  const ctx = loadSrc('src/app/listen-model.js', 'AppListen', sb);
  return { A: ctx.AppListen, calls, store };
}

async function waitUntil(fn, ms) {
  const until = Date.now() + (ms || 1500);
  while (Date.now() < until) { if (fn()) return true; await tick(5); }
  return !!fn();
}

// ── 1. 退出即清（主路径）────────────────────────────────────────────────────
describe('BEL-230 Q1 — 退出时按 ^bmg_ 清三槽（grantTail 为空也清），但保留 grant', () => {
  test('★ grantTail 丢失时三个 bmg_ 槽仍被清；grant 记录保留 ⇒ 卡面仍说余额保留', async () => {
    const G = loadGrant();
    const storage = makeStorage({
      apiKey: OLD_TOKEN, ttsApiKey: 'sk-user-own-tts', sttApiKey: OLD_TOKEN,
      grantTail: '', grantBalance: { spentUsd: 0.2, limitUsd: 0.2, at: 1 },
      grant: { vendor: 'openrouter', limitUsd: 0.2, at: 1 },
    });
    const Shell = loadShell();
    let after = 0;
    const clear = Shell.createSignOutClear({
      read: async () => Object.assign({}, storage.store),
      clear: (s) => G.clearForAccountSwitch(s),
      write: async (patch) => { await storage.set(patch); },
      afterWrite: async () => { after++; },
    });
    await clear();
    eq(storage.store.apiKey, '', '翻译槽的 bmg_ 令牌没清 —— 就是主路径漏掉的那一枚');
    eq(storage.store.sttApiKey, '', '转写槽的 bmg_ 令牌没清');
    eq(storage.store.ttsApiKey, 'sk-user-own-tts', '把用户自己粘的朗读 key 清掉了');
    eq(storage.store.grantTail, '', 'grantTail 应保持空');
    // BEL-230 ACCEPT-1：退出保留 grant 记录（只有 hash 与时间，无令牌）。它一旦被
    // 清掉，status() 就从 signed_out 掉回 none，卡面也从「余额保留着」变成
    // 「登录之后可以领一份免费额度」—— 与退出确认里的承诺自相矛盾。
    ok(storage.store.grant && storage.store.grant.vendor === 'openrouter',
      '退出把上一账号的 grant 记录清掉了 —— 卡面会说成「登录后可以领一份」');
    eq(storage.store.grant.apiKey, undefined, 'grant 记录里不该回填令牌');
    eq(storage.store.grantBalance, null, '上一账号的余额缓存没清');
    ok(!('grant' in storage.writes[0]), '退出清理 patch 不该包含 grant');
    eq(G.status(storage.store, { signedIn: false }), 'signed_out',
      '退出后 status 不是 signed_out —— 卡面会掉回「登录后可以领一份」');
    const card = G.cardFor('signed_out', { t: (k, d) => d });
    ok(card && /余额保留着/.test(card.body), '退出卡面没有说「余额保留着」');
    eq(card.action.id, 'signin', '退出卡面的入口不是「重新登录」');
    ok(!('ttsApiKey' in storage.writes[0]), '清理 patch 不该包含用户自己的 tts key');
    eq(after, 1, '落盘后没有重配在线 TTS');
  });

  test('★ show(null) 已收口：代际/听译/清理都在 no-session 分支里；三条退出路径都走它', () => {
    const src = stripComments(read('src/app/shell-model.js'));
    const show = src.slice(src.indexOf('async function show('));
    ok(/reconcileAccountChange\(prevSession, session, switched\)/.test(show),
      'show() 没有调用账号变更收口函数');
    const rec = src.slice(src.indexOf('function reconcileAccountChange'), src.indexOf('const readObSettings'));
    ok(/if \(!session\)/.test(rec), '退出分支不在 reconcileAccountChange 里');
    ok(/runSignOutClear\(\)/.test(rec), 'show(null) 的收口函数没有执行退出清理');
    ok(/settingsModel\.bumpAccountEpoch\(\)/.test(rec), 'show(null) 没递增账号代际');
    ok(/AppListen\.accountChanged/.test(rec), 'show(null) 没让听译作废旧 cfg');
    ok(!/if \(cur\.grantTail\)/.test(src), '还有 `if (cur.grantTail)` 前置 —— 尾号丢了就不清');
    for (const anchor of ["$('signout').addEventListener", 'onSignOut: async', "$('dl-mismatch-switch').addEventListener"]) {
      const at = src.indexOf(anchor);
      ok(at > -1, '找不到退出路径：' + anchor);
      ok(src.slice(at, at + 1400).includes('await show(null)'), anchor + ' 没有走 show(null)');
    }
  });
});

// ── 1a. 扩展设置页退出：无条件清令牌，grant 保留（1.23.4 C2）──────────────
describe('BEL-230 C2 — 扩展退出按 ^bmg_ 无条件清三槽，但保留 grant', () => {
  test('★ grantTail 为空也清；用户自己的 key 不动；grant 记录仍在 storage', async () => {
    const G = loadGrant();
    const storage = makeStorage({
      apiKey: OLD_TOKEN, ttsApiKey: 'sk-user-own-tts', sttApiKey: OLD_TOKEN,
      grantTail: '', grantBalance: { spentUsd: 0.2, limitUsd: 0.2, at: 1 },
      grant: { vendor: 'openrouter', limitUsd: 0.2, at: 1 },
    });
    const c = G.clearOnSignOut(Object.assign({}, storage.store));
    await storage.set(c.writes);
    await storage.remove(['grantTail', 'grantBalance']);
    eq(storage.store.apiKey, '', '翻译槽的 bmg_ 令牌没清');
    eq(storage.store.sttApiKey, '', '转写槽的 bmg_ 令牌没清');
    eq(storage.store.ttsApiKey, 'sk-user-own-tts', '把用户自己粘的朗读 key 清掉了');
    ok(storage.store.grant && storage.store.grant.vendor === 'openrouter',
      '退出把 grant 记录清掉了 —— 卡面会掉回「登录后可以领一份」');
    ok(!('grant' in storage.writes[0]), '退出清理 patch 不该包含 grant');
    eq(G.status(storage.store, { signedIn: false }), 'signed_out');
  });

  test('★ options.jsx 的退出处理器无条件调用，并复位 autoClaimRef', () => {
    const src = read('src/pages/options.jsx');
    const at = src.indexOf('const btnSyncOut');
    ok(at > -1, 'options.jsx 找不到 btnSyncOut');
    const fn = src.slice(at, src.indexOf('const btnSyncDelete'));
    ok(/LearnGrant\.clearOnSignOut\(cur\)/.test(fn), '退出处理器没调 clearOnSignOut');
    ok(!/if\s*\(cur\.grantTail\)/.test(fn),
      '还有 `if (cur.grantTail)` 前置 —— 尾号丢了就不清三槽里的旧令牌');
    ok(/autoClaimRef\.current\s*=\s*false/.test(fn),
      '退出后没有复位 autoClaimRef —— 同一会话里再登录另一个账号不会自动领取');
  });
});

// ── 1b. 直接换号仍清 grant —— ACCEPT-1 的另一半 ────────────────────────────
describe('BEL-230 ACCEPT-1 — 直接换号（A→B 同进程）仍清上一账号的 grant', () => {
  test('★ createAccountSwitch 的清理 patch 里 grant=null；退出保留不漏到换号', async () => {
    const G = loadGrant();
    const storage = makeStorage({
      apiKey: OLD_TOKEN, ttsApiKey: OLD_TOKEN, sttApiKey: OLD_TOKEN,
      grantTail: OLD_TOKEN.slice(-8),
      grantBalance: { spentUsd: 0.1, limitUsd: 0.2, at: 1 },
      grant: { vendor: 'openrouter', limitUsd: 0.2, at: 1 },
    });
    const Shell = loadShell();
    const switchFn = Shell.createAccountSwitch({
      enabled: () => true,
      read: async () => Object.assign({}, storage.store),
      clear: (s) => G.clearForAccountSwitch(s),
      write: async (patch) => { await storage.set(patch); },
      claimAndApply: async () => {},   // 只考「清理」这一段，claim 由别的用例覆盖
    });
    await switchFn();
    eq(storage.store.grant, null,
      '直接换号把上一账号的 grant 记录留下了 —— B 会继承 A 的领过/余额');
    eq(storage.store.grantTail, '', '直接换号没清旧 grantTail');
    eq(storage.store.grantBalance, null, '直接换号没清旧余额缓存');
    ok('grant' in storage.writes[0] && storage.writes[0].grant === null,
      '换号清理 patch 里没有 grant=null');
  });
});

// ── 2. 退出 A → B 登录（prev=null）→ claim 一次 → 三槽 = B ──────────────────
describe('BEL-230 Q1 — 退出后 B 登录（prev=null）自动领取', () => {
  test('★ 清理后再 claim 一次：三槽 / grantTail 都是 B，TTS 立即换到 B', async () => {
    const G = loadGrant();
    const storage = makeStorage({
      apiKey: OLD_TOKEN, ttsApiKey: OLD_TOKEN, sttApiKey: OLD_TOKEN,
      grantTail: '', grant: { vendor: 'openrouter', limitUsd: 0.2, at: 1 },
    });
    const Shell = loadShell();
    await Shell.createSignOutClear({
      read: async () => Object.assign({}, storage.store),
      clear: (s) => G.clearForAccountSwitch(s),
      write: async (patch) => { await storage.set(patch); },
    })();
    eq(storage.store.apiKey, '', '退出没清干净，后面的 claim 会命中「已配置」而跳过');

    const { Settings, claims, tracked, ttsCfgs } = loadSettings(storage);
    const res = await Settings.claimAndApply({ overwrite: false, selfTest: false });
    eq(claims.length, 1, 'B 登录没有自动 claim 一次（或 claim 了不止一次）');
    eq(res.stale, undefined, 'B 的 claim 不该被判成 stale');
    eq(storage.store.apiKey, NEW_TOKEN, '翻译槽不是 B 的新 token');
    eq(storage.store.ttsApiKey, NEW_TOKEN, '朗读槽不是 B 的新 token');
    eq(storage.store.sttApiKey, NEW_TOKEN, '转写槽不是 B 的新 token');
    eq(storage.store.grantTail, NEW_TOKEN.slice(-8), 'grantTail 没换绑到 B 的 token');
    eq(storage.store.grant.vendor, 'openrouter', 'B 的 grant 记录没落盘');
    ok(tracked.some((e) => e.name === 'engine_set'), 'B 的 claim 成功了却没记 engine_set');
    ok(ttsCfgs.some((c) => c.apiKey === NEW_TOKEN), '落盘后没有把 B 的令牌推给在线 TTS');
  });
});

// ── 3. A 的 claim 晚到 ──────────────────────────────────────────────────────
describe('BEL-230 Q1 — claim 竞态：A 的晚到结果不覆盖 B', () => {
  test('★ claim await 期间换号 ⇒ 不写盘、不 trackEngineSet、不动 B 的槽', async () => {
    const storage = makeStorage({
      apiKey: NEW_TOKEN, ttsApiKey: NEW_TOKEN, sttApiKey: NEW_TOKEN,
      grantTail: NEW_TOKEN.slice(-8),
      grant: { vendor: 'openrouter', limitUsd: 0.2, at: 2, reused: false },
    });
    let release;
    const claim = () => new Promise((resolve) => { release = resolve; });
    const { Settings, tracked } = loadSettings(storage, { claim });
    const beforeWrites = storage.writes.length;
    const p = Settings.claimAndApply({ overwrite: false, selfTest: false });
    await waitUntil(() => typeof release === 'function');
    Settings.bumpAccountEpoch();                 // A 还没回来，B 已经登录/退出
    release({ token: LATE_TOKEN, limitUsd: 0.2, spentUsd: 0.2, reused: false });
    const res = await p;
    eq(res.stale, true, '晚到的 claim 没被判成 stale');
    eq(storage.store.apiKey, NEW_TOKEN, 'A 的晚到 claim 覆盖了 B 的翻译槽');
    eq(storage.store.ttsApiKey, NEW_TOKEN, 'A 的晚到 claim 覆盖了 B 的朗读槽');
    eq(storage.store.sttApiKey, NEW_TOKEN, 'A 的晚到 claim 覆盖了 B 的转写槽');
    eq(storage.writes.length, beforeWrites, 'stale claim 仍然写了盘');
    ok(!tracked.some((e) => e.name === 'engine_set'), 'stale claim 记了 engine_set');
    ok(!('engineChosen' in storage.store), 'stale claim 写了 engineChosen');
  });

  test('switchAccountGrant 先 await 上一段 _autoClaimed，再开新段', () => {
    const src = read('src/app/shell-model.js');
    const fn = src.slice(src.indexOf('async function switchAccountGrant'));
    ok(/const prevClaim = _autoClaimed/.test(fn.slice(0, 500)), '没有记住上一段 claim');
    ok(/await prevClaim/.test(fn.slice(0, 900)), '新段启动前没有 await 上一段');
    const awaitAt = fn.indexOf('await prevClaim');
    const runAt = fn.indexOf('runAccountSwitch()');
    ok(awaitAt > -1 && runAt > awaitAt, 'await 上一段必须发生在 runAccountSwitch 之前');
  });
});

// ── 4. 听译账号代际 ───────────────────────────────────────────────────────
describe('BEL-230 Q1 — 听译：换号后旧 cfg 不发请求、迟到结果被丢', () => {
  async function ready(opts) {
    const box = bootListen(opts);
    box.A.open('conv');
    await waitUntil(() => box.A._debug().cfgReady);
    box.A._testForceListening();
    return box;
  }

  test('★ 换号清 cfg：旧行不再发请求，await 中的迟到译文不落 row', async () => {
    let release;
    const box = await ready({ passImpl: () => new Promise((r) => { release = r; }) });
    const { A, calls } = box;
    const injected = A._testInjectFinal('Hello there.', { who: 'them' });
    const row = A._debug().rows.find((r) => r.rid === injected.rid);
    ok(row && row.raw, '测试需要一行带 raw 的定稿（走 passRow）');
    const beforeEpoch = A._debug().acctEpoch;
    const p = A.retranslate(row, true);
    await waitUntil(() => calls.pass.length === 1);
    eq(calls.pass[0][2], 'A_KEY', '换号前这一发用的不是 A 的 key');
    A.accountChanged();
    eq(A._debug().acctEpoch, beforeEpoch + 1, '换号没有递增账号 epoch');
    eq(A._debug().cfgReady, false, '换号后旧 cfg 没被清掉');
    release('{"source":"Hello there.","translation":"你好。"}');
    await p;
    eq(row.tr, '', '迟到的 A 结果写进了旧行');
    eq(row.trBusy, false, '旧行停在「翻译中」');
    const n = calls.pass.length;
    await A.retranslate(row, true);
    eq(calls.pass.length, n, '换号后仍拿旧 cfg 发了请求');
  });

  test('★ 普通翻译路同样按 epoch 丢弃迟到结果', async () => {
    let release;
    const box = await ready({ translateImpl: () => new Promise((r) => { release = r; }) });
    const { A, calls } = box;
    const injected = A._testInjectFinal('How much is this?', { who: 'them' });
    const row = A._debug().rows.find((r) => r.rid === injected.rid);
    row.raw = null;                              // 让 retranslate 走 translateRow
    const p = A.retranslate(row, true);
    await waitUntil(() => calls.translate.length === 1);
    eq(calls.translate[0][3], 'A_KEY', '换号前这一发用的不是 A 的 key');
    A.accountChanged();
    release('这个多少钱？');
    await p;
    eq(row.tr, '', '迟到的普通翻译结果写进了旧行');
  });

  test('源码钉：translate / passRow / segCall 都捕获并比较账号 epoch', () => {
    const model = read('src/app/listen-model.js');
    const tr = model.slice(model.indexOf('async function translate('), model.indexOf('function tmProvider'));
    ok(/const myEpoch = acctEpoch/.test(tr) && /myEpoch !== acctEpoch/.test(tr),
      'translate 没有按账号 epoch 丢弃迟到结果');
    const pr = model.slice(model.indexOf('async function passRow('), model.indexOf('function retranslate'));
    ok(/const myEpoch = acctEpoch/.test(pr) && /myEpoch !== acctEpoch/.test(pr),
      'passRow 没有按账号 epoch 丢弃迟到结果');
    const sc = model.slice(model.indexOf('function segCall('), model.indexOf('// 断句 prompt'));
    ok(/const myEpoch = acctEpoch/.test(sc) && /myEpoch !== acctEpoch/.test(sc),
      'segCall 没有按账号 epoch 丢弃迟到结果');
    ok(/accountChanged,/.test(model), 'listen-model 没有导出 accountChanged 给 shell 调');
  });
});
