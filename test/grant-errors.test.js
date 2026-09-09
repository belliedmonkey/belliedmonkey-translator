// test/grant-errors.test.js — 免费额度的错误码与引擎停机（docs/learning-design.md §8.10）。
//
// 这一族的失败没有中间状态：中继与提供方都会回 402，含义却相反 ——
// 中继的 402 是「你的免费额度用完了，去看看怎么继续」，提供方的 402 是
// 「你自己的账户没钱了，去充值」。认错了就是把用户支到错的地方，而两条路径
// 在代码里长得一模一样，只有一个具名 error 能分开。
//
// 最贵的那条断言是**没发出的请求**：额度用完之后引擎必须停机。没有它，一页 60 段
// 就是 60 次注定失败的请求 —— 不会红、不会抛，只是慢慢把一页翻译变成一页错误。
const { describe, test, eq, ok, loadModule } = require('./harness');
const { makeChrome } = require('./stubs');

function loadWire() {
  return loadModule('wire-format.js', { window: {} }).WireFormat;
}
function loadCore() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  return loadModule('translation-core.js', {
    window: { MT_I18N_MESSAGES: {} }, chrome,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } },
    navigator: {},
  }).TranslationCore;
}

describe('§8.10 grantError —— 只认中继自己的具名 error', () => {
  const W = loadWire();

  test('中继的 402 认出来，提供方的 402 不认', () => {
    eq(W.grantError(402, '{"error":"credit_exhausted"}'), 'credit_exhausted');
    // 提供方的 402 长这样：没有我们那套 error 名字 ⇒ 必须落空，回到普通 http 分支
    eq(W.grantError(402, '{"error":{"message":"Insufficient credits"}}'), '');
    eq(W.grantError(402, 'Payment Required'), '');
  });

  test('池子空了与用户用完了是两个码 —— 文案要分开', () => {
    eq(W.grantError(503, '{"error":"grant_unavailable"}'), 'grant_unavailable');
    eq(W.grantError(503, '{"error":"grant_misconfigured"}'), 'grant_misconfigured');
  });

  test('其余具名错误各归各的', () => {
    eq(W.grantError(403, '{"error":"model_not_allowed"}'), 'model_not_allowed');
    eq(W.grantError(403, '{"error":"grant_revoked"}'), 'grant_revoked');
    eq(W.grantError(401, '{"error":"grant_invalid"}'), 'grant_invalid');
    eq(W.grantError(429, '{"error":"busy"}'), 'busy');
  });

  test('不在白名单里的 error 名一律落空 —— 上游网关也会回 {error:"..."}', () => {
    eq(W.grantError(500, '{"error":"internal"}'), '');
    eq(W.grantError(502, '{"error":"upstream"}'), '');   // 中继有这个码，但它不是额度问题
  });

  test('2xx 与空正文永远不是额度错误', () => {
    eq(W.grantError(200, '{"error":"credit_exhausted"}'), '');
    eq(W.grantError(0, ''), '');
    eq(W.grantError(402, ''), '');
    eq(W.grantError(402, null), '');
  });
});

describe('§8.10 引擎停机 —— 额度用完后一个请求都不再发', () => {
  const TC = loadCore();
  const WIN = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 3, RETRY_GAP_MS: 0, GRACE_MS: 0 };
  const units = () => Array.from({ length: 8 }, (_, i) => ({ text: 'line ' + i, tr: '' }));
  const grantErr = () => Object.assign(new Error('HTTP 402'), { code: 'credit_exhausted', grant: true, retryable: false });

  async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

  test('第一个额度错误之后，后续的 pump 不再发请求', async () => {
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; throw grantErr(); }, window: WIN });
    eng.setUnits(units());
    eng.pump(); await settle();
    const afterFirst = calls;
    ok(afterFirst >= 1, '第一拍至少发了一次 —— 一次都没发的话这个测试什么也没证明');
    eng.pump(); await settle();
    eng.pump(); await settle();
    eq(calls, afterFirst, `停机后又发了 ${calls - afterFirst} 次请求`);
    eq(eng.halted, true);
  });

  test('停机时未译的单元当场置错 —— 不留一片「翻译中…」', async () => {
    const eng = TC.createEngine({ translate: async () => { throw grantErr(); }, window: WIN });
    const list = units();
    eng.setUnits(list);
    eng.pump(); await settle();
    eng.pump(); await settle();
    const pending = list.filter((it) => eng.stateOf(it).state === 'pending');
    eq(pending.length, 0, '还有单元停在 pending，用户会一直盯着「翻译中…」');
  });

  test('普通失败不停机 —— 只有额度那一族会（否则一次 500 就整页瘫掉）', async () => {
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; throw new Error('HTTP 500'); }, window: WIN });
    eng.setUnits(units());
    eng.pump(); await settle();
    const afterFirst = calls;
    eng.pump(); await settle();
    ok(calls > afterFirst, '普通错误也停机了 —— 一次 500 会让整页不再重试');
    eq(eng.halted, false);
  });

  test('用户点重试 = 解锁停机（他可能刚配好自带 key）', async () => {
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; throw grantErr(); }, window: WIN });
    const list = units();
    eng.setUnits(list);
    eng.pump(); await settle();
    eq(eng.halted, true);
    eng.retry(list[0]);
    eq(eng.halted, false);
    const before = calls;
    eng.pump(); await settle();
    ok(calls > before, '解锁之后还是不发请求');
  });

  test('reset 也解锁 —— 换了引擎配置就该重新开始', async () => {
    const eng = TC.createEngine({ translate: async () => { throw grantErr(); }, window: WIN });
    eng.setUnits(units());
    eng.pump(); await settle();
    eq(eng.halted, true);
    eng.reset();
    eq(eng.halted, false);
  });

  test('onFail 拿到的是带 grant 位的那个错误 —— 渲染器靠它分两句话', async () => {
    const seen = [];
    const eng = TC.createEngine({ translate: async () => { throw grantErr(); }, window: WIN, onFail: (e) => seen.push(e) });
    eng.setUnits(units());
    eng.pump(); await settle();
    ok(seen.length >= 1, 'onFail 一次都没被调用');
    eq(seen[0].code, 'credit_exhausted');
    eq(seen[0].grant, true);
  });
});

describe('§8.10 停机时页面上那一行 —— 只分两句，方向不能说反', () => {
  const TC = loadCore();

  test('「你用完了」与「不是你的问题」是两句不同的话', () => {
    const mine = TC.grantHaltMessage('credit_exhausted');
    const ours = TC.grantHaltMessage('grant_unavailable');
    ok(mine && ours, '有一句是空的');
    ok(mine !== ours, '两种情况说了同一句话 —— 方向说反的代价是用户去查自己的账户');
    ok(/不是你/.test(ours), '「我们的池子空了」那句没说清不是用户的问题：' + ours);
    ok(!/不是你/.test(mine), '「你用完了」那句却说了「不是你」：' + mine);
  });

  test('其余额度错误都归到「不是你的问题」那一句 —— 一行的地方不解释三种原因', () => {
    const ours = TC.grantHaltMessage('grant_unavailable');
    for (const c of ['grant_misconfigured', 'grant_revoked', 'grant_invalid', 'model_not_allowed', 'busy']) {
      eq(TC.grantHaltMessage(c), ours, c + ' 说了第三句话');
    }
  });

  test('没有码就没有这一行 —— 不是额度问题时必须走原来的「点此重试」', () => {
    eq(TC.grantHaltMessage(''), '');
    eq(TC.grantHaltMessage(null), '');
    eq(TC.grantHaltMessage(undefined), '');
  });
});
