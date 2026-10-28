// test/n26-fail-halt.test.js — extension N26 fail-halt.
//
// Port of the Safari-extension halt on mobiletranslator main b0ddea77
// (PR#16 tip c9a51503). The pump stops for four immediate codes and for a
// timeout streak of 5. http / network / 429 stay on the row.
const { describe, test, eq, ok, loadModule } = require('./harness');
const { makeChrome } = require('./stubs');

function load() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  const window = { MT_I18N_MESSAGES: {}, MT_FLAVOR: 'global' };
  const ctx = loadModule(['translation-core.js', 'fail-surface.js'], {
    window, chrome,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } },
    navigator: {},
  });
  return { TC: ctx.TranslationCore, FS: ctx.FailSurface, window };
}

const FOUR = ['credit_exhausted', 'grant_unavailable', 'model_not_allowed', 'auth'];

describe('N26 classifyFail — 封闭码表，不另造 translate_fail 码', () => {
  const { TC } = load();

  test('HALT_IMMEDIATE 含四码，且是 FAIL_CODES 的子集', () => {
    for (const code of FOUR) {
      ok(TC.HALT_IMMEDIATE.indexOf(code) >= 0, code);
      ok(TC.FAIL_CODES.indexOf(code) >= 0, code + ' 不在封闭表里');
    }
    eq(TC.TIMEOUT_STREAK_MAX, 5);
    eq(TC.WINDOW.TIMEOUT_STREAK_MAX, 5);
  });

  test('classifyFail 的非空结果都在 FAIL_CODES 里', () => {
    const samples = [
      { code: 'credit_exhausted', status: 402, grant: true },
      { code: 'grant_unavailable', status: 503, grant: true },
      { code: 'model_not_allowed', status: 403, grant: true },
      { code: 'auth', status: 401, halt: true },
      { code: 'grant_invalid', status: 401, grant: true },
      { code: 'grant_revoked', grant: true },
      { code: 'grant_misconfigured', grant: true },
      { code: 'busy', status: 429, grant: true },
      { code: 'rate_limit', status: 429 },
      { status: 429 },
      { status: 500, code: 'http' },
      { code: 'network' },
      { code: 'timeout' },
      { code: 'reasoning_starved' },
      { code: 'no_base' },
      { code: 'unknown_provider' },
      { name: 'AbortError' },
      { name: 'TypeError', message: 'Failed to fetch' },
      { code: 'brand_new_code' },
      new Error('HTTP 500'),
    ];
    for (const err of samples) {
      const code = TC.classifyFail(err);
      if (!code) continue;
      ok(TC.FAIL_CODES.indexOf(code) >= 0, '造了表外的码 ' + code + ' ← ' + JSON.stringify(err));
    }
  });

  test('令牌类归 grant_unavailable；429 / busy 归 http，不升格', () => {
    eq(TC.classifyFail({ code: 'grant_invalid' }), 'grant_unavailable');
    eq(TC.classifyFail({ code: 'grant_revoked' }), 'grant_unavailable');
    eq(TC.classifyFail({ code: 'grant_misconfigured' }), 'grant_unavailable');
    eq(TC.classifyFail({ code: 'busy', status: 429, grant: true }), 'http');
    eq(TC.classifyFail({ status: 429, code: 'credit_exhausted' }), 'http');
    eq(TC.classifyFail({ code: 'network' }), 'network');
    eq(TC.classifyFail(new Error('boom')), '');
  });
});

describe('N26 引擎停泵', () => {
  const { TC } = load();
  const WIN = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 1, RETRY_GAP_MS: 0, GRACE_MS: 0, STALL_MS: 60000 };
  const units = () => Array.from({ length: 8 }, (_, i) => ({ text: 'line ' + i, tr: '' }));
  async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

  async function pumpUntil(eng, pred, cap) {
    for (let i = 0; i < (cap || 20) && !pred(); i++) { eng.pump(); await settle(); }
  }

  for (const code of FOUR) {
    test(code + ' 一次即停，之后 pump 不再发请求', async () => {
      let calls = 0;
      const seen = [];
      const eng = TC.createEngine({
        translate: async () => {
          calls++;
          throw Object.assign(new Error(code), { code, grant: code !== 'auth', halt: code === 'auth', status: 402 });
        },
        window: WIN,
        onFail: (e) => seen.push(e),
      });
      const list = units();
      eng.setUnits(list);
      eng.pump(); await settle();
      const first = calls;
      ok(first >= 1, '第一拍至少发了一次');
      eq(eng.halted, true);
      eq(eng.haltCode, code);
      eng.pump(); await settle();
      eng.pump(); await settle();
      eq(calls, first, '停机后又发了 ' + (calls - first) + ' 次');
      eq(list.filter((it) => eng.stateOf(it).state === 'pending').length, 0);
      ok(seen.length >= 1);
      eq(seen[0].code, code);
    });
  }

  test('http / network / 429 / busy 不停机，请求还在发', async () => {
    const cases = [
      { code: 'http', status: 500 },
      { code: 'network' },
      { code: 'busy', status: 429, grant: true },
      { status: 429, code: 'http' },
    ];
    for (const sample of cases) {
      let calls = 0;
      const eng = TC.createEngine({
        translate: async () => { calls++; throw Object.assign(new Error('no'), sample); },
        window: WIN,
      });
      eng.setUnits(units());
      eng.pump(); await settle();
      const first = calls;
      eng.pump(); await settle();
      ok(calls > first, JSON.stringify(sample) + ' 停机了');
      eq(eng.halted, false, JSON.stringify(sample));
      eq(eng.haltCode, '');
    }
  });

  test('grant_invalid 归一成 grant_unavailable 后停泵', async () => {
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => {
        calls++;
        throw Object.assign(new Error('bad token'), { code: 'grant_invalid', grant: true, status: 401 });
      },
      window: WIN,
      onFail: (e) => seen.push({ code: e.code }),
    });
    eng.setUnits(units());
    eng.pump(); await settle();
    const first = calls;
    eng.pump(); await settle();
    eq(calls, first);
    eq(eng.halted, true);
    eq(eng.haltCode, 'grant_unavailable');
    eq(seen[0].code, 'grant_unavailable');
  });

  test('连续 5 次单元级 timeout 才停；4 次不停', async () => {
    const timeoutErr = () => Object.assign(new Error('timeout'), { code: 'timeout' });
    const win = Object.assign({}, WIN, { MAX_PER_TICK: 1, TIMEOUT_STREAK_MAX: 5 });
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw timeoutErr(); },
      window: win,
    });
    const list = Array.from({ length: 6 }, (_, i) => ({ text: 't' + i }));
    eng.setUnits(list);
    await pumpUntil(eng, () => list.filter((u) => u._err).length >= 4, 30);
    eq(list.filter((u) => u._err).length >= 4, true);
    eq(eng.halted, false, '4 次单元级 timeout 不该停机');
    await pumpUntil(eng, () => eng.halted, 20);
    eq(eng.halted, true);
    eq(eng.haltCode, 'timeout');
    const before = calls;
    eng.pump(); await settle();
    eq(calls, before, 'timeout 停机后泵还在发');
  });

  test('单次 stalled 不把连续超时往上推', async () => {
    const eng = TC.createEngine({
      translate: async () => { const e = new Error('stalled'); e.stalled = true; e.code = 'timeout'; throw e; },
      window: Object.assign({}, WIN, { MAX_PER_TICK: 1, TIMEOUT_STREAK_MAX: 2 }),
    });
    const list = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
    eng.setUnits(list);
    await pumpUntil(eng, () => list.every((u) => u._err), 10);
    eq(eng.halted, false);
    eq(eng.haltCode, '');
  });

  test('retry() 解锁停机，泵恢复发请求', async () => {
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw Object.assign(new Error('x'), { code: 'credit_exhausted', grant: true }); },
      window: WIN,
    });
    const list = units();
    eng.setUnits(list);
    eng.pump(); await settle();
    eq(eng.halted, true);
    eng.retry(list[0]);
    eq(eng.halted, false);
    eq(eng.haltCode, '');
    const before = calls;
    eng.pump(); await settle();
    ok(calls > before);
  });
});

describe('N26 fail-surface — 下一步锚点', () => {
  test('即停四码去设置页，超时是重试，都不自动再请求', () => {
    const { FS } = load();
    const credit = FS.surface('credit_exhausted');
    eq(credit.halt, true);
    eq(credit.showAutoRetry, false);
    eq(credit.anchor, '#grant');
    eq(credit.primary.action, 'open');
    eq(FS.surface('grant_unavailable').anchor, '#grant');
    eq(FS.surface('model_not_allowed').anchor, '#grant');
    const auth = FS.surface('auth');
    eq(auth.anchor, '#engine');
    eq(auth.primary.anchor, '#engine');
    ok(auth.secondary && auth.secondary.anchor === '#grant');
    const timeout = FS.surface('timeout');
    eq(timeout.halt, true);
    eq(timeout.showAutoRetry, false);
    eq(timeout.primary.action, 'retry');
    eq(timeout.anchor, '');
    const row = FS.row('timeout');
    eq(row.retry, true);
    eq(row.anchor, '');
    eq(FS.row('http'), null);
    eq(FS.row('credit_exhausted').retry, false);
    eq(FS.row('credit_exhausted').anchor, '#grant');
    eq(FS.row('auth').anchor, '#engine');
  });

  test('中国版超时没有「改免费通道」', () => {
    const { FS } = load();
    const cn = FS.surface('timeout', { region: 'cn' });
    eq(cn.secondary, null);
    ok(cn.next);
    const global = FS.surface('timeout', { region: 'global' });
    ok(global.secondary);
    eq(FS.surface('auth', { region: 'cn' }).secondary, null);
  });
});
