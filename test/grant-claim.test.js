// test/grant-claim.test.js — BEL-271（P0）：领取失败的分类、一次重试、池子空了的 UI 判据。
//
// 这一组故意跑**真的** grant.js claim() + 真的 settings-model.claimAndApply()，
// 只在 fetch 上换成一个按序返回的桩。要守的是四件会静默出错的事：
//   · 连不上 / 超时 / 5xx 不能显示成「池子空了」；
//   · 只有服务端明确说池子空了（body.error = unavailable / grant_unavailable）才置位；
//   · 瞬时失败只重试一次，401/403/429/池子空了一次都不重试；
//   · 最终失败不发 grant_claimed / 成功事件；重试成功后三个槽真的写进去。
const { describe, test, eq, ok, deepEq, match, loadSrc } = require('./harness');

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
const LEGACY_CODES = ['exhausted', 'unavailable', 'misconfigured', 'revoked', 'invalid', 'model', 'busy'];

function makeStorage(seed) {
  const store = Object.assign({}, seed || {});
  const get = (keys, cb) => {
    const out = {};
    const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
    for (const k of arr) if (k in store) out[k] = store[k];
    if (cb) cb(out);
    return Promise.resolve(out);
  };
  const set = (patch, cb) => { Object.assign(store, patch); if (cb) cb(); return Promise.resolve(); };
  const remove = (keys, cb) => {
    for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
    if (cb) cb();
    return Promise.resolve();
  };
  return { store, get, set, remove };
}

// 一条「按顺序发生」的假网络。`calls` 是真实发出去的请求数 —— 重试次数就从这里数。
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

function loadModel(seq, seedStore) {
  const storage = makeStorage(seedStore);
  const events = [];
  const says = [];
  const win = {
    MT_GRANT: SPEC, MT_PROVIDERS: PROVIDERS, MT_TTS_ENGINES: TTS, MT_STT_ENGINES: STT,
    MT_BACKEND: { anonKey: 'anon' }, MT_TELEMETRY: { spec: { events: {} } },
  };
  const tel = { track(name, props) { events.push({ name, props }); return Promise.resolve(true); } };
  const fetchStub = makeFetch(seq);
  const sandbox = {
    window: win,
    chrome: {
      i18n: { getUILanguage: () => 'zh-CN', getMessage: () => '' },
      storage: { local: storage, onChanged: { addListener() {} } },
    },
    navigator: { language: 'zh-CN' },
    fetch: fetchStub.fn,
    MTTelemetry: tel,
    LearnAuth: { token: async () => 'jwt' },
    console, URL,
  };
  const gctx = loadSrc('src/shared/grant.js', 'grant', sandbox);
  sandbox.LearnGrant = gctx.grant;
  const mctx = loadSrc('src/app/settings-model.js', 'Settings', sandbox);
  return { Model: mctx.Settings, G: gctx.grant, storage, events, says, calls: fetchStub.calls };
}

async function claimFail(seq) {
  const h = loadModel(seq);
  let err = null;
  try { await h.Model.claimAndApply({ path: 'manual', retryDelayMs: 0, selfTest: false }); }
  catch (e) { err = e; }
  return Object.assign({ err }, h);
}

const poolEmpty = () => ({ status: 503, body: { error: 'unavailable' } });
const poolEmptyGrant = () => ({ status: 503, body: { error: 'grant_unavailable' } });
const http500 = () => ({ status: 500, body: {} });
const http429 = () => ({ status: 429, body: { error: 'busy' } });
const http401 = () => ({ status: 401, body: { error: 'grant_invalid' } });
const offline = () => new Error('fetch failed');
const timeout = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

describe('BEL-271 失败矩阵 —— reason 五值 + legacy code 七值', () => {
  const CASES = [
    ['offline', offline, 'network', 'unavailable', 2],
    ['timeout', timeout, 'network', 'unavailable', 2],
    ['HTTP 500', http500, 'server', 'unavailable', 2],
    ['HTTP 429', http429, 'busy', 'busy', 1],
    ['HTTP 401', http401, 'revoked', 'invalid', 1],
    ['genuine pool-empty', poolEmpty, 'other', 'unavailable', 1],
    ['pool-empty (grant_unavailable body)', poolEmptyGrant, 'other', 'unavailable', 1],
  ];
  for (const [name, makeStep, reason, code, tries] of CASES) {
    test(name + ' → reason ' + reason + '、code ' + code + '、' + tries + ' 次请求', async () => {
      const h = await claimFail([makeStep(), makeStep(), makeStep()]);
      ok(h.err, '必须抛出失败，不能静默成功');
      eq(h.err.reason, reason, '抛回 UI 的 reason');
      eq(h.Model.classifyGrantFailure(h.err).reason, reason);
      const ev0 = h.events.find((e) => e.name === 'grant_claim_fail');
      ok(LEGACY_CODES.indexOf(ev0.props.code) >= 0, 'legacy code 必须是七个之一：' + ev0.props.code);
      eq(h.calls.length, tries, '请求次数（= 1 次原请求 + 至多 1 次重试）');
      eq(h.err.attempts, tries);
      eq(h.events.filter((e) => e.name === 'grant_claim_fail').length, 1, '最终失败只记一条');
      eq(h.events.filter((e) => e.name === 'grant_claimed').length, 0, '失败路径绝不能有 grant_claimed');
      const ev = h.events.find((e) => e.name === 'grant_claim_fail');
      eq(ev.props.reason, reason, '事件里的真实 reason');
      eq(ev.props.code, code, '旧 code 同发');
    });
  }
});

describe('BEL-271 只有真正的池子空了才置 unavailable，且文案不是「池子空了」', () => {
  const cases = [
    ['offline', offline],
    ['timeout', timeout],
    ['HTTP 500', http500],
  ];
  for (const [name, makeStep] of cases) {
    test(name + '：poolEmpty=false，文案可重试且不含「池子空了」', async () => {
      const h = await claimFail([makeStep(), makeStep()]);
      const view = h.Model.grantFailureView(h.err);
      eq(view.poolEmpty, false);
      eq(view.transient, true);
      match(view.copy, /连不上|重试/);
      ok(!/池空了/.test(view.copy), '网络失败显示了「池子空了」：' + view.copy);
    });
  }

  test('HTTP 429：不重试，poolEmpty=false，给「等几秒」而不是池子空了', async () => {
    const h = await claimFail([http429(), http429()]);
    const view = h.Model.grantFailureView(h.err);
    eq(h.calls.length, 1);
    eq(view.poolEmpty, false);
    match(view.copy, /等几秒|太密/);
    ok(!/池空了/.test(view.copy));
  });

  test('真正的池子空了：poolEmpty=true，仍说「池子空了」', async () => {
    const h = await claimFail([poolEmpty(), poolEmpty()]);
    const view = h.Model.grantFailureView(h.err);
    eq(view.poolEmpty, true);
    ok(/池空了/.test(view.copy));
    eq(h.calls.length, 1, '池子空了不重试');
  });

  test('本地规格缺失（grant_unavailable 无 status）不算池子空了', () => {
    const h = loadModel([]);
    const view = h.Model.grantFailureView({ code: 'grant_unavailable', message: 'grant not available' });
    eq(view.poolEmpty, false);
    eq(view.reason, 'other');
    ok(!/池子空了/.test(view.copy), '本地没规格不是池子空了：' + view.copy);
  });
});

describe('BEL-271 重试成功 —— 走原来的 claim-and-apply，三槽真的写进去', () => {
  test('offline 后第二次成功：两次请求、只有一条 grant_claimed、三槽落盘', async () => {
    const h = loadModel([offline(), { status: 200, body: CLAIMED }]);
    const r = await h.Model.claimAndApply({ path: 'manual', retryDelayMs: 0, selfTest: false, say: (s) => h.says.push(s) });
    eq(h.calls.length, 2, '瞬时失败只重试一次');
    eq(r.wroteAny, true);
    eq(h.storage.store.provider, 'grant');
    eq(h.storage.store.apiKey, TOKEN, '翻译槽');
    eq(h.storage.store.ttsEngine, 'grant_speech', '朗读槽');
    eq(h.storage.store.sttEngine, 'grant_stt', '转写槽');
    eq(h.events.filter((e) => e.name === 'grant_claimed').length, 1, '成功只记一条');
    eq(h.events.filter((e) => e.name === 'grant_claim_fail').length, 0, '重试成功后不记失败');
  });

  test('500 后第二次成功：同样只重试一次并落盘', async () => {
    const h = loadModel([http500(), { status: 200, body: CLAIMED }]);
    await h.Model.claimAndApply({ path: 'silent', retryDelayMs: 0, selfTest: false });
    eq(h.calls.length, 2);
    eq(h.storage.store.apiKey, TOKEN);
  });

  test('429 后没有自动重试 —— 即使下一次会成功也不打', async () => {
    const h = loadModel([http429(), { status: 200, body: CLAIMED }]);
    let err = null;
    try { await h.Model.claimAndApply({ path: 'manual', retryDelayMs: 0, selfTest: false }); }
    catch (e) { err = e; }
    ok(err && err.code === 'busy');
    eq(h.calls.length, 1, '429 绝不能自动重试');
    eq(h.storage.store.apiKey, undefined, '没领到就不许写槽');
    eq(h.events.filter((e) => e.name === 'grant_claimed').length, 0);
  });
});
