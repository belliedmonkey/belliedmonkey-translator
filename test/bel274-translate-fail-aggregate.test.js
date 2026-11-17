// test/bel274-translate-fail-aggregate.test.js — BEL-274.
//
// translate_fail was emitted once per paragraph: a 402 page produced ~60 rows in
// one run, and 326 rows came from 2 devices. The engine now owns a per-run token
// and suppresses a repeated (run, kind, code); no_base joins the terminal halt
// list and both it and credit_exhausted get dedicated, actionable copy.
//
// The emitted props are asserted against the SHIPPED events.gen.json, not a copy
// in the test: "no new event keys" is only true if the shipped schema says so.
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, deepEq, loadModule, tick } = require('./harness');
const { makeChrome } = require('./stubs');

function load() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  const window = { MT_I18N_MESSAGES: {}, MT_FLAVOR: 'global' };
  const ctx = loadModule(['translation-core.js', 'fail-surface.js'], {
    window, chrome,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } },
    navigator: {},
  });
  return { TC: ctx.TranslationCore, FS: ctx.FailSurface };
}

const SCHEMA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'bt-ingest', 'events.gen.json'), 'utf8',
)).events.translate_fail;

const WIN = {
  AHEAD_MS: 60000, MAX_PER_TICK: 50, MAX_RETRIES: 1, RETRY_GAP_MS: 0,
  GRACE_MS: 0, STALL_MS: 60000, TIMEOUT_STREAK_MAX: 5,
};
const units = (n) => Array.from({ length: n }, (_, i) => ({ text: 'paragraph ' + i }));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await tick(10); };

// The six props the two extension call sites construct. Kept here as the assertion
// target: if a call site starts sending a key the shipped schema does not have,
// the schema test below must fail.
function failProps(e, provider) {
  const fail = {
    provider: String(provider || ''),
    kind: 'page',
    code: (e && typeof e.code === 'string') ? e.code : 'network',
    status: Number.isInteger(e && e.status) ? e.status : 0,
    route: (e && e.route === 'proxy') ? 'proxy' : ((e && e.route === 'direct') ? 'direct' : ''),
  };
  if (Number.isInteger(e && e.ms)) fail.ms = e.ms;
  return fail;
}

function httpErr(code, status) {
  return Object.assign(new Error(code || 'HTTP ' + status), { code, status, ms: 17, route: 'direct' });
}

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — one translate_fail per (run, kind, code)', () => {
  const { TC } = load();

  test('20 paragraph failures with the same code → 20 attempts, exactly 1 event', async () => {
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw httpErr('http', 500); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    const list = units(20);
    eng.setUnits(list);
    eng.pump();
    await settle();

    eq(calls, 20, 'all 20 paragraphs must still be attempted');
    eq(seen.length, 1, 'only the first failure of this run/code is emitted');
    eq(seen[0].code, 'http');
    eq(seen[0].ms, 17, 'the first failure keeps its own ms');
    eq(seen[0].status, 500, 'the first failure keeps its own status');
    eq(seen[0].route, 'direct', 'the first failure keeps its own route');
  });

  test('two different codes in one run → one event each', async () => {
    const seen = [];
    const eng = TC.createEngine({
      translate: async (text) => { throw httpErr(text, text === 'http' ? 500 : 0); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    eng.setUnits([{ text: 'http' }, { text: 'network' }, { text: 'http' }, { text: 'network' }]);
    eng.pump();
    await settle();

    deepEq(seen.map((e) => e.code).sort(), ['http', 'network']);
  });

  test('a new run emits again — reset() rotates the token and clears the seen set', async () => {
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw httpErr('http', 500); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    const list = units(2);
    eng.setUnits(list);

    eng.pump(); await settle();
    const firstRun = eng.runId;
    eq(seen.length, 1);

    eng.reset();
    eq(eng.runId, 0, 'reset() ends the run');
    eng.pump(); await settle();
    ok(eng.runId !== firstRun, 'the next pump starts a new run');
    eq(seen.length, 2, 'a fresh run is allowed to emit the same code again');
    eq(calls, 4);
  });

  test('retry() also starts a new run (the user asked for another attempt)', async () => {
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw httpErr('http', 500); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    const list = units(1);
    eng.setUnits(list);
    eng.pump(); await settle();
    eq(seen.length, 1);

    eng.retry(list[0]);
    eq(eng.runId, 0);
    eng.pump(); await settle();
    eq(seen.length, 2);
    eq(calls, 2);
  });

  test('the run token is per engine and names its kind', async () => {
    const a = TC.createEngine({ translate: async () => 'x', window: WIN });
    const b = TC.createEngine({ translate: async () => 'x', window: WIN, kind: 'page' });
    const sub = TC.createSubtitleEngine({ getCurrentTime: () => 0, translate: async () => 'x', window: WIN });
    a.setUnits(units(1)); a.pump();
    b.setUnits(units(1)); b.pump();
    ok(a.runId > 0 && b.runId > 0 && a.runId !== b.runId, 'tokens are unique across engines');
    eq(a.failKind, 'page');
    eq(sub.failKind, 'subtitle');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — terminal no_base / 402 stop the run', () => {
  const { TC } = load();

  for (const code of ['credit_exhausted', 'no_base']) {
    test(code + ': first failure emits once, the rest neither retry nor emit', async () => {
      const seen = [];
      let calls = 0;
      const eng = TC.createEngine({
        translate: async () => {
          calls++;
          const e = new Error(code);
          e.code = code;
          e.status = code === 'credit_exhausted' ? 402 : 0;
          e.retryable = false;
          if (code === 'credit_exhausted') e.grant = true;
          e.ms = 23; e.route = 'proxy';
          throw e;
        },
        // One start per tick makes "remaining paragraphs did not retry" observable.
        window: Object.assign({}, WIN, { MAX_PER_TICK: 1 }),
        onFail: (e) => seen.push(e),
      });
      const list = units(20);
      eng.setUnits(list);
      eng.pump();
      await settle();

      eq(calls, 1, 'only the first paragraph was attempted');
      eq(seen.length, 1, 'exactly one translate_fail');
      eq(seen[0].code, code);
      eq(eng.halted, true);
      eq(eng.haltCode, code);

      for (let i = 0; i < 5; i++) { eng.pump(); await settle(); }
      eq(calls, 1, code + ' must not retry after the halt');
      eq(seen.length, 1, code + ' must not emit again');
      eq(list.every((it) => eng.stateOf(it).state === 'error'), true,
        'remaining paragraphs are settled as error so the renderer can show the halt row');
    });
  }

  test('429 / 400 / http keep their current non-halting behaviour', async () => {
    const cases = [
      { code: 'http', status: 429 },
      { code: 'http', status: 400 },
      { code: 'http', status: 500 },
    ];
    for (const sample of cases) {
      const seen = [];
      let calls = 0;
      const eng = TC.createEngine({
        translate: async () => { calls++; throw httpErr(sample.code, sample.status); },
        window: Object.assign({}, WIN, { MAX_PER_TICK: 1 }),
        onFail: (e) => seen.push(e),
      });
      const list = units(3);
      eng.setUnits(list);
      eng.pump(); await settle();
      eq(eng.halted, false, JSON.stringify(sample) + ' must not halt');
      const before = calls;
      eng.pump(); await settle();
      ok(calls > before, JSON.stringify(sample) + ' must keep pumping');
      eq(seen.length, 1, 'dedupe still applies, but it does not halt');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — dedicated, actionable copy', () => {
  const { TC, FS } = load();

  test('402 copy is the credit sentence, not the generic failure line', () => {
    const generic = TC.MSG.error;
    const credit = TC.haltMessage('credit_exhausted');
    ok(credit && credit !== generic, 'credit_exhausted must not use the generic sentence');
    ok(!/服务端拒绝/.test(credit), 'credit_exhausted must not say "server rejected"');
    eq(FS.row('credit_exhausted').text, FS.surface('credit_exhausted').rowNote);
    ok(FS.row('credit_exhausted').text !== generic);
    eq(FS.surface('credit_exhausted').anchor, '#grant');
  });

  test('no_base copy names the missing endpoint and points at the engine block', () => {
    const generic = TC.MSG.error;
    const noBase = TC.haltMessage('no_base');
    ok(noBase && noBase !== generic, 'no_base must not use the generic sentence');
    ok(/地址|address|endpoint/i.test(noBase), 'no_base copy must name the missing endpoint: ' + noBase);
    ok(noBase !== TC.haltMessage('credit_exhausted'), 'no_base is not a credit problem');
    eq(TC.haltAnchor('no_base'), '#engine');

    const row = FS.row('no_base');
    ok(row, 'no_base halt row must exist');
    eq(row.retry, false, 'no_base is not offered as a row retry');
    eq(row.anchor, '#engine');
    ok(/地址|address|endpoint/i.test(row.text));
    ok(row.text !== generic);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — no new event keys; props fit the shipped schema', () => {
  const { TC } = load();

  test('the shipped translate_fail schema still has exactly the current keys', () => {
    // BEL-294/BEL-296 起多了 op_id（一次操作一个 id）；除它之外仍不许有新键。
    deepEq(Object.keys(SCHEMA).sort(), ['code', 'kind', 'ms', 'op_id', 'provider', 'route', 'status']);
  });

  test('every FAIL_CODE is already in the shipped enum', () => {
    for (const code of TC.FAIL_CODES) ok(SCHEMA.code.includes(code), code + ' is missing from events.gen.json');
    ok(SCHEMA.code.includes('no_base'), 'no_base must remain in the shipped enum');
  });

  test('captured failures only produce props the shipped schema allows', async () => {
    const seen = [];
    const eng = TC.createEngine({
      translate: async (text) => { throw httpErr(text, 500); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    eng.setUnits([{ text: 'http' }, { text: 'network' }]);
    eng.pump(); await settle();
    eq(seen.length, 2);

    const allowed = new Set(Object.keys(SCHEMA));
    for (const e of seen) {
      const props = failProps(e, 'deepseek');
      for (const key of Object.keys(props)) {
        ok(allowed.has(key), 'emitted key ' + key + ' is not in the shipped translate_fail schema');
      }
      ok(SCHEMA.code.includes(props.code), props.code + ' is not in the shipped enum');
      eq(Number.isInteger(props.status), true);
    }
  });
});
