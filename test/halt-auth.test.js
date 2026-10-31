// test/halt-auth.test.js — key 被服务商拒绝（HTTP 401/403）的停机（第八期，2026-09-10）。
//
// 起因：09-05 → 09-10 的 317 条 translate_fail 里 308 条来自同一台 Chrome —— 一把错的
// OpenAI key，401，每个段落砸一次，5 天 308 次。credit_exhausted 有整台引擎的停机闸
// （grant-errors.test.js），401 没有：isRetryable 不重试，但页面上一段一个「翻译失败，
// 点此重试」，用户点多少次都是同一个 401，而没有一处告诉他「去改 key」。
//
// 判据分三层：① 哪些请求算「带了真 key」（免费 Google 通道不带头、额度令牌 bmg_ 不算）；
// ② 引擎对 e.halt 与对 e.grant 一样停机；③ 文案是第三句（不是「额度」那两句），锚点去引擎块。
const { describe, test, eq, ok, loadModule } = require('./harness');
const { makeChrome } = require('./stubs');

function loadCore() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  return loadModule('translation-core.js', {
    window: { MT_I18N_MESSAGES: {} }, chrome,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } },
    navigator: {},
  }).TranslationCore;
}
function loadApi() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  return loadModule('translation-api.js', { window: { MT_PROVIDERS: [], MT_MODEL_PARAMS: [] }, chrome, navigator: {} }).TranslationAPI;
}

describe('auth —— 只有带了用户自己的 key 才算「key 被拒」', () => {
  const API = loadApi();
  test('Bearer 非空 ⇒ 真 key；x-api-key / x-goog-api-key 非空 ⇒ 真 key', () => {
    eq(API.sentRealKey({ headers: { Authorization: 'Bearer sk-abc' } }), true);
    eq(API.sentRealKey({ headers: { 'x-api-key': 'k' } }), true);
    eq(API.sentRealKey({ headers: { 'X-Goog-Api-Key': 'g' } }), true);
  });
  test('空 key 也会发出 `Bearer ` —— 那不是被拒，是没填', () => {
    eq(API.sentRealKey({ headers: { Authorization: 'Bearer ' } }), false);
    eq(API.sentRealKey({ headers: { Authorization: 'Bearer' } }), false);
    eq(API.sentRealKey({ headers: { 'x-api-key': '' } }), false);
  });
  test('额度令牌 bmg_ 不算用户的 key —— 中继透传上游 401 时不能把人送去改 key', () => {
    eq(API.sentRealKey({ headers: { Authorization: 'Bearer bmg_abcdefghijklmnop' } }), false);
  });
  test('免费 Google 通道不带任何头 ⇒ 永远不是 auth', () => {
    eq(API.sentRealKey({}), false);
    eq(API.sentRealKey({ headers: {} }), false);
    eq(API.sentRealKey(null), false);
  });
});

describe('auth —— 引擎对 e.halt 与对 e.grant 一样停机', () => {
  const TC = loadCore();
  const WIN = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 3, RETRY_GAP_MS: 0, GRACE_MS: 0 };
  const units = () => Array.from({ length: 8 }, (_, i) => ({ text: 'line ' + i, tr: '' }));
  const authErr = () => Object.assign(new Error('HTTP 401'), { code: 'auth', halt: true, status: 401, retryable: false });
  async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

  test('第一个 401 之后不再发请求，未译单元当场置错', async () => {
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; throw authErr(); }, window: WIN });
    const list = units();
    eng.setUnits(list);
    eng.pump(); await settle();
    const first = calls;
    ok(first >= 1);
    eng.pump(); await settle();
    eng.pump(); await settle();
    eq(calls, first, `停机后又发了 ${calls - first} 次`);
    eq(eng.halted, true);
    eq(list.filter((it) => eng.stateOf(it).state === 'pending').length, 0, '还有单元停在「翻译中…」');
  });
  test('onFail 拿到的是带 halt 位与 code=auth 的那个错误', async () => {
    const seen = [];
    const eng = TC.createEngine({ translate: async () => { throw authErr(); }, window: WIN, onFail: (e) => seen.push(e) });
    eng.setUnits(units());
    eng.pump(); await settle();
    ok(seen.length >= 1);
    eq(seen[0].code, 'auth'); eq(seen[0].halt, true); ok(!seen[0].grant, 'auth 不该带 grant 位 —— 那是额度那一族的');
  });
  test('普通 http（不带 halt）仍不停机', async () => {
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; throw Object.assign(new Error('HTTP 500'), { code: 'http', status: 500 }); }, window: WIN });
    eng.setUnits(units());
    eng.pump(); await settle();
    const first = calls;
    eng.pump(); await settle();
    ok(calls > first);
    eq(eng.halted, false);
  });
});

describe('auth —— 页面上那一行是第三句，锚点去引擎块', () => {
  const TC = loadCore();
  test('auth 的文案与两句额度文案都不同，也不是普通失败句', () => {
    const a = TC.haltMessage('auth');
    ok(a, 'auth 没有文案');
    ok(a !== TC.haltMessage('credit_exhausted') && a !== TC.haltMessage('grant_unavailable'), 'auth 复用了额度那两句 —— 方向错了');
    ok(a !== TC.MSG.error);
    ok(/key/i.test(a), '文案里没提 key：' + a);
  });
  test('旧名 grantHaltMessage 仍在，且与 haltMessage 同一份', () => {
    eq(TC.grantHaltMessage('credit_exhausted'), TC.haltMessage('credit_exhausted'));
    eq(TC.grantHaltMessage('auth'), TC.haltMessage('auth'));
  });
  test('锚点：额度去 #grant，key 被拒去 #engine', () => {
    eq(TC.haltAnchor('credit_exhausted'), '#grant');
    eq(TC.haltAnchor('grant_unavailable'), '#grant');
    eq(TC.haltAnchor('auth'), '#engine');
  });
});
