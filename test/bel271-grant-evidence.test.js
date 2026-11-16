// test/bel271-grant-evidence.test.js — BEL-271 证据：票面枚举子集 + 重试不产生第二枚令牌。
//
// 这一组只加证据，不改产品行为：
//   · 实际发出的 grant_claim_fail.reason / code 必须是 supabase/functions/bt-ingest/
//     events.gen.json 里 deployed 枚举的子集；负例证明集合外的值会被抓住。
//   · 一次「响应丢了」的瞬时失败后，服务端回传 reused=true 的同一枚令牌：客户端
//     只应落一枚令牌、只跑一次令牌写入、不再记一条 grant_claimed（不是新领取）。
//
// 1.23.5/main 的 deployed events.gen.json 还没有 reason（BEL-223 的票面没有随
// BEL-271 一起 backport）；那一支改为断言「事件不发 reason」，并用 UI/票面共用的
// 五值契约检查分类器。差异写进 RESULT。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, deepEq, match, loadSrc } = require('./harness');

const EVENTS_FILE = path.join(__dirname, '..', 'supabase', 'functions', 'bt-ingest', 'events.gen.json');
const DEPLOYED = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
const DEPLOYED_EVENT = DEPLOYED && DEPLOYED.events && DEPLOYED.events.grant_claim_fail;
const DEPLOYED_CODES = (DEPLOYED_EVENT && DEPLOYED_EVENT.code) || null;
// reason 是 1.23.4 的票面；1.23.5/main 的 deployed 文件只有 code。
const DEPLOYED_REASONS = (DEPLOYED_EVENT && DEPLOYED_EVENT.reason) || null;
// main 没有 reason 字段时，分类器仍只能吐这五个值（UI 与票面共用的既有契约）。
const REASON_CONTRACT = ['network', 'busy', 'server', 'revoked', 'other'];

function subsetViolations(values, allowed) {
  const set = new Set(allowed || []);
  return Array.from(new Set(values)).filter((v) => !set.has(v));
}
function assertSubset(values, allowed, label) {
  if (!Array.isArray(allowed) || !allowed.length) throw new Error(label + ': deployed enum 缺失');
  const bad = subsetViolations(values, allowed);
  if (bad.length) throw new Error(label + ' 不在 deployed 枚举内：' + bad.join(', '));
}

const SPEC = {
  vendor: 'qwencloud', vendorLabel: 'QwenCloud', limitUsd: 0.2,
  claimUrl: 'https://backend.invalid/functions/v1/bt-grant',
  models: { chat: 'qwen3.7-plus' },
};
const PROVIDERS = [{ id: 'grant', type: 'chat-compat', needsKey: true, grantOnly: true,
  defaultEndpoint: 'https://backend.invalid/functions/v1/bt-relay/chat/completions',
  defaultModel: 'qwen3.7-plus' }];
const TTS = [{ id: 'grant_speech', type: 'speech-compat', needsKey: true, grantOnly: true,
  defaultEndpoint: 'https://backend.invalid/functions/v1/bt-relay/audio/speech',
  defaultModel: 'qwen3-tts-flash' }];
const STT = [{ id: 'grant_stt', type: 'transcribe-compat', needsKey: true, grantOnly: true,
  defaultEndpoint: 'https://backend.invalid/functions/v1/bt-relay/audio/transcriptions',
  defaultModel: 'qwen3-asr-flash' }];
const TOKEN = 'bmg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAtail1234';
const CLAIMED = { token: TOKEN, limit_usd: 0.2, spent_usd: 0, reused: false };

function makeStorage(seed) {
  const store = Object.assign({}, seed || {});
  const writes = [];
  const get = (keys, cb) => {
    const out = {};
    const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
    for (const k of arr) if (k in store) out[k] = store[k];
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

// 一条「按顺序发生」的假网络。`calls` 是真实发出去的请求数。
function makeFetch(seq) {
  let i = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = seq[Math.min(i, seq.length - 1)];
    i++;
    if (step instanceof Error) throw step;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => (step.body === undefined ? {} : step.body),
    };
  };
  return { fn, calls };
}

function makeSandbox(storage, fetchFn, events) {
  const win = {
    MT_GRANT: SPEC, MT_PROVIDERS: PROVIDERS, MT_TTS_ENGINES: TTS, MT_STT_ENGINES: STT,
    MT_BACKEND: { anonKey: 'anon' }, MT_TELEMETRY: { spec: { events: {} } },
  };
  return {
    window: win,
    chrome: {
      i18n: { getUILanguage: () => 'zh-CN', getMessage: () => '' },
      storage: { local: storage, onChanged: { addListener() {} } },
    },
    navigator: { language: 'zh-CN' },
    fetch: fetchFn,
    MTTelemetry: { track(name, props) { events.push({ name, props }); return Promise.resolve(true); } },
    LearnAuth: { token: async () => 'jwt' },
    console, URL,
  };
}

function loadModel(seq, seedStore) {
  const storage = makeStorage(seedStore);
  const events = [];
  const says = [];
  const fetchStub = makeFetch(seq);
  const sandbox = makeSandbox(storage, fetchStub.fn, events);
  const gctx = loadSrc('src/shared/grant.js', 'grant', sandbox);
  sandbox.LearnGrant = gctx.grant;
  const mctx = loadSrc('src/app/settings-model.js', 'Settings', sandbox);
  return { Model: mctx.Settings, G: gctx.grant, storage, events, says, calls: fetchStub.calls };
}

// 只装 telemetry 那一层：用来直接跑 grantClaimCode / grantClaimReason 的映射矩阵。
function loadTelemetry() {
  const storage = makeStorage();
  const events = [];
  const sandbox = makeSandbox(storage, async () => { throw new Error('unused'); }, events);
  const ctx = loadSrc('src/app/telemetry-session.js', 'TelemetrySession', sandbox);
  return { T: ctx.TelemetrySession, events };
}

async function claimFail(seq) {
  const h = loadModel(seq);
  let err = null;
  try { await h.Model.claimAndApply({ path: 'manual', retryDelayMs: 0, selfTest: false }); }
  catch (e) { err = e; }
  return Object.assign({ err }, h);
}

const offline = () => new Error('fetch failed');
const timeout = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

// 真实 claim()/claimAndApply() 走一遍；每个用例都必须是**最终失败**，所以重复给同一步，
// 瞬时失败最多重试一次也就够用。
const EVENT_CASES = [
  ['offline', offline],
  ['timeout', timeout],
  ['HTTP 500 empty', () => ({ status: 500, body: {} })],
  ['HTTP 500 server', () => ({ status: 500, body: { error: 'server' } })],
  ['HTTP 503 unavailable', () => ({ status: 503, body: { error: 'unavailable' } })],
  ['HTTP 503 grant_unavailable', () => ({ status: 503, body: { error: 'grant_unavailable' } })],
  ['HTTP 429 busy', () => ({ status: 429, body: { error: 'busy' } })],
  ['HTTP 429 rate_limited', () => ({ status: 429, body: { error: 'rate_limited' } })],
  ['HTTP 401 grant_invalid', () => ({ status: 401, body: { error: 'grant_invalid' } })],
  ['HTTP 401 session', () => ({ status: 401, body: { error: 'session' } })],
  ['HTTP 403 auth', () => ({ status: 403, body: { error: 'auth' } })],
  ['HTTP 409 revoked', () => ({ status: 409, body: { error: 'revoked' } })],
  ['HTTP 400 exhausted', () => ({ status: 400, body: { error: 'exhausted' } })],
  ['HTTP 400 invalid', () => ({ status: 400, body: { error: 'invalid' } })],
  ['HTTP 400 misconfigured', () => ({ status: 400, body: { error: 'misconfigured' } })],
  ['HTTP 400 grant_misconfigured', () => ({ status: 400, body: { error: 'grant_misconfigured' } })],
  ['HTTP 404 model_not_allowed', () => ({ status: 404, body: { error: 'model_not_allowed' } })],
  ['HTTP 400 bad_request', () => ({ status: 400, body: { error: 'bad_request' } })],
  ['HTTP 400 no_host', () => ({ status: 400, body: { error: 'no_host' } })],
  ['HTTP 400 signed_out', () => ({ status: 400, body: { error: 'signed_out' } })],
];

// grantClaimCode 能收到的原始码（grant.js 的传输码 + telemetry 的归一化表）。
const RAW_CODES = [
  'exhausted', 'unavailable', 'misconfigured', 'revoked', 'invalid', 'model', 'busy',
  'grant_unavailable', 'offline', 'network', 'server', 'timeout', 'fetch', '',
  'grant_misconfigured', 'no_host', 'no host', 'signed_out', 'auth', '401', '403',
  'model_not_allowed', 'model_not_allowed_x', 'grant_invalid', 'bad_request', '400',
  'rate_limited', '429', 'session', 'revoked_token',
];

describe('BEL-271 票面枚举 —— deployed events.gen.json 是唯一边界', () => {
  test('deployed 文件带 grant_claim_fail.code 枚举（reason 可以因分支而异）', () => {
    ok(DEPLOYED_EVENT, 'events.gen.json 缺 grant_claim_fail');
    ok(Array.isArray(DEPLOYED_CODES) && DEPLOYED_CODES.length >= 7, '缺 code 七值枚举');
    ok(DEPLOYED_CODES.indexOf('unavailable') >= 0 && DEPLOYED_CODES.indexOf('busy') >= 0,
      'code 枚举不像 deployed 的那张表：' + JSON.stringify(DEPLOYED_CODES));
    if (DEPLOYED_REASONS) {
      ok(Array.isArray(DEPLOYED_REASONS) && DEPLOYED_REASONS.length === 5,
        'reason 枚举不是五值：' + JSON.stringify(DEPLOYED_REASONS));
    }
  });

  test('子集：代码能发出的 reason/code 都在 deployed 枚举内', async () => {
    const { T } = loadTelemetry();

    // 1) telemetry 的归一化表：任何原始码吐出来的 legacy code 都必须是 deployed 七值之一。
    const mappedCodes = RAW_CODES.map((c) => T.grantClaimCode(c));
    assertSubset(mappedCodes, DEPLOYED_CODES, 'grantClaimCode');
    ok(new Set(mappedCodes).size === 7, '归一化表没有覆盖 legacy 七码：' + Array.from(new Set(mappedCodes)).join(','));

    // 2) reason 五值：1.23.4 有 grantClaimReason；main 的票面还没有这个字段。
    const reasonFn = typeof T.grantClaimReason === 'function' ? T.grantClaimReason : null;
    if (DEPLOYED_REASONS) {
      ok(reasonFn, 'deployed 有 reason 枚举，但这一支没有 grantClaimReason —— 票面会缺字段');
      const grid = [];
      for (const code of RAW_CODES.concat(['server', 'grant_unavailable', 'no_host'])) {
        for (const status of [0, 400, 401, 403, 409, 429, 500, 503]) {
          for (const poolEmpty of [false, true]) grid.push({ code, status, poolEmpty });
        }
      }
      const reasons = grid.map(reasonFn);
      assertSubset(reasons, DEPLOYED_REASONS, 'grantClaimReason');
      ok(new Set(reasons).size === DEPLOYED_REASONS.length,
        'reason 矩阵没有覆盖五值：' + Array.from(new Set(reasons)).join(','));
      // 上游已标好的 reason（幂等）也不能把集合外的值带进来。
      const given = grid.map((e) => reasonFn(Object.assign({}, e, { reason: 'network' })));
      assertSubset(given, DEPLOYED_REASONS, 'grantClaimReason(given)');
      eq(reasonFn({ code: 'offline', reason: 'quota_exceeded' }), 'network',
        '集合外的 given reason 必须被忽略，不能原样透传');
    } else {
      ok(!reasonFn, 'deployed 没有 reason，但这一支有 grantClaimReason —— 票面契约不一致');
    }

    // 3) 真正走 claim()/claimAndApply() 发出的票面：reason/code 都对着 deployed 表验。
    const eventReasons = new Set();
    const eventCodes = new Set();
    for (const [name, makeStep] of EVENT_CASES) {
      const h = await claimFail([makeStep(), makeStep(), makeStep()]);
      ok(h.err, name + '：必须抛出失败');
      const evs = h.events.filter((e) => e.name === 'grant_claim_fail');
      eq(evs.length, 1, name + '：最终失败只记一条');
      const props = evs[0].props || {};
      ok(DEPLOYED_CODES.indexOf(props.code) >= 0,
        name + '：code=' + props.code + ' 不在 deployed 枚举');
      if (DEPLOYED_REASONS) {
        ok(DEPLOYED_REASONS.indexOf(props.reason) >= 0,
          name + '：reason=' + props.reason + ' 不在 deployed 枚举');
        eventReasons.add(props.reason);
      } else {
        eq(Object.prototype.hasOwnProperty.call(props, 'reason'), false,
          name + '：deployed 没有 reason，事件不能发这个属性');
      }
      eventCodes.add(props.code);
    }
    if (DEPLOYED_REASONS) {
      deepEq(Array.from(eventReasons).sort(), DEPLOYED_REASONS.slice().sort(),
        '真实事件没有覆盖 deployed reason 五值');
    }
    // 这条矩阵恰好把 legacy 七码都走了一遍；少一个说明用例退化了。
    eq(eventCodes.size, DEPLOYED_CODES.length,
      '真实事件没有覆盖 deployed code 七值：' + Array.from(eventCodes).sort().join(','));
  });

  test('负例：集合外的 reason/code 会被子集检查抓住', () => {
    const reasonEnum = DEPLOYED_REASONS || REASON_CONTRACT;
    assertSubset(['network', 'busy'], reasonEnum, 'reason');
    let bad = null;
    try { assertSubset(['network', 'quota_exceeded'], reasonEnum, 'reason'); }
    catch (e) { bad = e; }
    ok(bad && /quota_exceeded/.test(bad.message), 'reason 负例没有被抓住：' + (bad && bad.message));

    assertSubset(['unavailable', 'busy'], DEPLOYED_CODES, 'code');
    bad = null;
    try { assertSubset(['unavailable', 'hard_fail'], DEPLOYED_CODES, 'code'); }
    catch (e) { bad = e; }
    ok(bad && /hard_fail/.test(bad.message), 'code 负例没有被抓住：' + (bad && bad.message));
  });
});

describe('BEL-271 重试幂等 —— 响应丢了也只落同一枚令牌', () => {
  test('offline 后服务端回 reused=true 的同一枚：一次令牌写入、零第二条 grant_claimed', async () => {
    const h = loadModel([offline(), { status: 200, body: Object.assign({}, CLAIMED, { reused: true }) }]);
    // 记下每次 claim() 的返回值/错误：证明重试用的是第二次的**同一个响应**。
    const claimResults = [];
    const origClaim = h.G.claim;
    h.G.claim = async function claimSpy(...args) {
      try {
        const r = await origClaim.apply(this, args);
        claimResults.push({ ok: true, r });
        return r;
      } catch (e) {
        claimResults.push({ ok: false, e });
        throw e;
      }
    };

    const applied = await h.Model.claimAndApply({ path: 'manual', retryDelayMs: 0, selfTest: false });

    eq(h.calls.length, 2, '一次原请求 + 一次重试，不能有第三次');
    eq(claimResults.length, 2, 'claim() 恰好调用两次');
    eq(claimResults[0].ok, false, '第一次是丢了响应的瞬时失败');
    eq(claimResults[1].ok, true);
    eq(claimResults[1].r.token, TOKEN);
    eq(claimResults[1].r.reused, true, '服务端回的是已有那一枚');

    // 落盘只有一枚令牌：三槽同尾号，grantTail 不是第二枚的尾号。
    eq(h.storage.store.apiKey, TOKEN, '翻译槽');
    eq(h.storage.store.ttsApiKey, TOKEN, '朗读槽');
    eq(h.storage.store.sttApiKey, TOKEN, '转写槽');
    eq(new Set([h.storage.store.apiKey, h.storage.store.ttsApiKey, h.storage.store.sttApiKey]).size, 1,
      '三槽必须指向同一枚令牌');
    eq(h.storage.store.grantTail, TOKEN.slice(-8), 'grantTail 是这一枚的尾号');
    eq(h.storage.store.grant.reused, true, '领取记录如实标 reused');
    eq(applied.wroteAny, true, '翻译槽确实写了');

    const tokenWrites = h.storage.writes.filter((p) => Object.prototype.hasOwnProperty.call(p, 'apiKey'));
    eq(tokenWrites.length, 1, '令牌写入路径只跑一次');
    const tailWrites = h.storage.writes.filter((p) => Object.prototype.hasOwnProperty.call(p, 'grantTail'));
    eq(tailWrites.length, 1, 'grantTail 只写一次');
    eq(h.events.filter((e) => e.name === 'grant_claimed').length, 0,
      'reused=true 不是新领取，不能再记一条 grant_claimed');
    eq(h.events.filter((e) => e.name === 'grant_claim_fail').length, 0,
      '重试成功后不记失败');
  });
});
