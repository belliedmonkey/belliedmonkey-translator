// test/bel274-fail-surface.test.js — BEL-274 失败面（1.23.4）.
//
// Four user rulings under test:
//   1. provider 402 and the relay's credit_exhausted are separate sentences.
//   2. 400/429 share one threshold block after 3 consecutive failures; success clears.
//   3. a row has exactly one click (open settings), no side-by-side action.
//   4. 400 has no sentence of its own; it uses the same block as 429.
//
// The UI-only codes (provider_402 / streak) must never leak into FAIL_CODES, classifyFail,
// or the shipped translate_fail enum. The 400/429 counter is in memory, keyed by
// provider+endpoint+model, and is NOT persisted.
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, loadModule, tick } = require('./harness');
const { makeChrome } = require('./stubs');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt_BR', 'ru', 'th', 'zh_CN', 'zh_TW'];
const NEW_KEYS = [
  'halt_balance_row', 'fail_balance_title', 'fail_balance_next', 'fail_switch_engine',
  'halt_no_base_row', 'no_base_field_hint', 'halt_streak_row', 'fail_streak_title',
  'fail_streak_next',
];
const EN_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales/en/messages.json'), 'utf8'));
const EN = {};
for (const [k, v] of Object.entries(EN_JSON)) EN[k] = v.message;

function load() {
  const chrome = makeChrome({ uiLanguage: 'en-US' });
  const window = { MT_I18N_MESSAGES: { en: EN }, MT_FLAVOR: 'global' };
  const ctx = loadModule(['translation-core.js', 'fail-surface.js'], {
    window, chrome,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } },
    navigator: {},
  });
  return { TC: ctx.TranslationCore, FS: ctx.FailSurface };
}

const WIN = {
  AHEAD_MS: 60000, MAX_PER_TICK: 1, MAX_RETRIES: 1, RETRY_GAP_MS: 0,
  GRACE_MS: 0, STALL_MS: 60000, TIMEOUT_STREAK_MAX: 5,
};
const units = (n) => Array.from({ length: n }, (_, i) => ({ text: 'paragraph ' + i }));
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await tick(10); };
const httpErr = (status, extra) => Object.assign(
  new Error('HTTP ' + status), { code: 'http', status, ms: 9, route: 'direct' }, extra || {});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — provider 402 is UI-only and halts the run', () => {
  const { TC, FS } = load();

  test('provider_402 is not a FAIL_CODE and classifyFail never returns it', () => {
    eq(TC.FAIL_CODES.indexOf('provider_402'), -1);
    eq(TC.FAIL_CODES.indexOf('streak'), -1);
    eq(TC.classifyFail({ code: 'http', status: 402, route: 'direct' }), 'http');
    eq(TC.classifyFail({ code: 'http', status: 402, route: 'proxy' }), 'http');
  });

  test('bare provider 402: one attempt, one event, haltCode=provider_402, no later requests', async () => {
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw httpErr(402); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    const list = units(20);
    eng.setUnits(list);
    eng.pump();
    await settle();

    eq(calls, 1, 'only the first paragraph went out');
    eq(seen.length, 1, 'exactly one translate_fail');
    eq(seen[0].code, 'http', 'wire code stays http — provider_402 is UI-only');
    eq(seen[0].status, 402);
    eq(eng.halted, true);
    eq(eng.haltCode, 'provider_402');

    for (let i = 0; i < 5; i++) { eng.pump(); await settle(); }
    eq(calls, 1, '402 must not send another request in the same run');
    eq(seen.length, 1, '402 must not emit again');
    eq(list.every((it) => eng.stateOf(it).state === 'error'), true);
  });

  test('proxy 402 without a relay-named code stays ordinary http (not provider_402)', async () => {
    let calls = 0;
    const eng = TC.createEngine({
      translate: async () => { calls++; throw httpErr(402, { route: 'proxy' }); },
      window: WIN,
    });
    eng.setUnits(units(3));
    eng.pump();
    await settle();
    eq(eng.halted, false, 'a proxy 402 is the relay path, not the provider account path');
    const before = calls;
    eng.pump(); await settle();
    ok(calls > before, 'ordinary http keeps pumping');
  });

  test('402 row/card copy is the balance sentence and has no retry', () => {
    const row = FS.row('provider_402');
    eq(row.text, EN.halt_balance_row);
    eq(row.anchor, '#engine-balance');
    eq(row.retry, false);
    const s = FS.surface('provider_402');
    eq(s.halt, true);
    eq(s.title, EN.fail_balance_title);
    eq(s.next, EN.fail_balance_next);
    eq(s.primary.label, EN.fail_switch_engine);
    eq(s.secondary.label, EN.fail_fill_key);
    ok(!/retry|重试/i.test(s.next + ' ' + s.primary.label + ' ' + s.secondary.label),
      'the 402 card must not offer a retry');
    eq(TC.haltAnchor('provider_402'), '#engine-balance');
    eq(TC.haltMessage('provider_402'), EN.halt_balance_row);
  });

  test('credit_exhausted keeps its own sentence and card, byte for byte', () => {
    eq(FS.surface('credit_exhausted').title, EN.fail_credit_title);
    eq(FS.surface('credit_exhausted').next, EN.fail_credit_next);
    eq(FS.surface('credit_exhausted').anchor, '#grant');
    eq(FS.surface('credit_exhausted').primary.label, EN.fail_go_grant);
    eq(FS.surface('credit_exhausted').secondary.label, EN.fail_fill_key);
    ok(TC.haltMessage('credit_exhausted') !== TC.haltMessage('provider_402'),
      'the relay pool and the user account are different sentences');
    const credit = TC.createEngine({
      translate: async () => { throw Object.assign(new Error('402'), {
        code: 'credit_exhausted', status: 402, route: 'proxy', grant: true, retryable: false,
      }); },
      window: WIN,
    });
    credit.setUnits(units(2)); credit.pump();
    return settle().then(() => {
      eq(credit.halted, true);
      eq(credit.haltCode, 'credit_exhausted', 'named relay error must not be re-derived as provider_402');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — dedupe key includes status', () => {
  const { TC } = load();

  test('400 and 429 are two failures, not one; repeats of each stay one', async () => {
    const seen = [];
    let i = 0;
    const eng = TC.createEngine({
      translate: async () => {
        const status = (i++ % 3 === 0) ? 400 : 429;
        throw httpErr(status);
      },
      window: Object.assign({}, WIN, { MAX_PER_TICK: 10, MAX_RETRIES: 1 }),
      onFail: (e) => seen.push(e),
    });
    eng.setUnits(units(6));
    eng.pump();
    await settle();
    eq(seen.length, 2, 'one event per (kind, code, status): http:400 and http:429');
    eq(seen.map((e) => e.status).sort().join(','), '400,429');
  });

  test('20 identical 500s in one run still emit exactly one event', async () => {
    const seen = [];
    const eng = TC.createEngine({
      translate: async () => { throw httpErr(500); },
      window: Object.assign({}, WIN, { MAX_PER_TICK: 20, MAX_RETRIES: 1 }),
      onFail: (e) => seen.push(e),
    });
    eng.setUnits(units(20));
    eng.pump();
    await settle();
    eq(seen.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — 400/429 threshold: 3 consecutive runs, one count per run', () => {
  const { TC, FS } = load();
  const KEY = 'deepseek|https://api.deepseek.com/v1|deepseek-chat';

  function run(status, key) {
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      failKey: () => key,
      translate: async () => { calls++; throw httpErr(status); },
      window: WIN,
      onFail: (e) => seen.push(e),
    });
    eng.setUnits(units(3));
    return { eng, seen, calls: () => calls };
  }

  test('20 429 paragraphs count once, not 20', async () => {
    const key = KEY + '|many';
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      failKey: () => key,
      translate: async () => { calls++; throw httpErr(429); },
      window: Object.assign({}, WIN, { MAX_PER_TICK: 20, MAX_RETRIES: 1 }),
      onFail: (e) => seen.push(e),
    });
    eng.setUnits(units(20));
    eng.pump();
    await settle();
    eq(calls, 20, 'all 20 were attempted');
    eq(seen.length, 1, 'dedupe still collapses the event');
    eq(TC.failStreakOf(key), 1, 'one failed run = one count, not one per paragraph');
    eq(eng.halted, false);
  });

  test('run 1 and 2 stay on the ordinary retry row; run 3 halts with the streak block', async () => {
    const key = KEY + '|threshold';
    for (let n = 1; n <= 2; n++) {
      const r = run(400, key);
      r.eng.pump(); await settle();
      eq(r.eng.halted, false, 'run ' + n + ' must not halt');
      eq(r.eng.haltCode, '');
      eq(FS.row(r.eng.haltCode), null, 'no halt row yet — the renderer keeps the generic retry line');
      ok(/翻译失败|retry/i.test(TC.MSG.error), 'ordinary row is still the retry sentence');
      eq(TC.failStreakOf(key), n);
    }
    const third = run(429, key);
    third.eng.pump(); await settle();
    eq(third.eng.halted, true);
    eq(third.eng.haltCode, 'streak');
    eq(third.seen.length, 1);
    eq(third.seen[0].code, 'http', 'no new telemetry code: the event is still http/429');
    eq(third.seen[0].status, 429);
    const row = FS.row('streak');
    eq(row.text, EN.halt_streak_row);
    eq(row.anchor, '#engine-streak');
    eq(row.retry, false);
    eq(FS.surface('streak').title, EN.fail_streak_title);
    eq(FS.surface('streak').next, EN.fail_streak_next);
    eq(FS.surface('streak').primary.label, EN.fail_switch_engine);
    eq(FS.surface('streak').secondary.label, EN.fail_retry);
    eq(TC.haltAnchor('streak'), '#engine-streak');
    const before = third.calls();
    for (let i = 0; i < 3; i++) { third.eng.pump(); await settle(); }
    eq(third.calls(), before, 'a halted streak sends no later requests');
  });

  test('any success clears the counter', async () => {
    const key = KEY + '|reset';
    const a = run(429, key); a.eng.pump(); await settle(); eq(TC.failStreakOf(key), 1);
    const b = run(400, key); b.eng.pump(); await settle(); eq(TC.failStreakOf(key), 2);
    const okEng = TC.createEngine({
      failKey: () => key,
      targetLang: 'fr',
      translate: async () => 'bonjour',
      window: WIN,
    });
    const one = [{ text: 'hello' }];
    okEng.setUnits(one); okEng.pump(); await settle();
    eq(one[0].tr, 'bonjour');
    eq(TC.failStreakOf(key), 0, 'one success clears the consecutive-failure count');
    const c = run(429, key); c.eng.pump(); await settle();
    eq(TC.failStreakOf(key), 1, 'the next failure starts again from 1');
    eq(c.eng.halted, false);
  });

  test('10 minutes of idle also clears it; the counter is not persisted', () => {
    const key = KEY + '|idle';
    const a = run(429, key); a.eng.pump();
    return settle().then(() => {
      eq(TC.failStreakOf(key), 1);
      eq(TC.FAIL_STREAK_MAX, 3);
      eq(TC.FAIL_STREAK_IDLE_MS, 10 * 60 * 1000);
      eq(TC.failStreakOf(key, Date.now() + TC.FAIL_STREAK_IDLE_MS), 0);
      // Source-level: the counter must not write to chrome.storage / localStorage.
      const src = fs.readFileSync(path.join(ROOT, 'extension/content/translation-core.js'), 'utf8');
      const region = src.slice(src.indexOf('const failStreak = new Map()'), src.indexOf('function createEngine'));
      ok(!/storage|localStorage|sessionStorage/.test(region), 'the 400/429 counter must stay in memory');
    });
  });

  test('400 is not retried within one unit (non-retryable shape error)', async () => {
    const key = KEY + '|no-retry';
    const seen = [];
    let calls = 0;
    const eng = TC.createEngine({
      failKey: () => key,
      translate: async () => { calls++; throw httpErr(400, { retryable: false }); },
      window: Object.assign({}, WIN, { MAX_RETRIES: 3 }),
      onFail: (e) => seen.push(e),
    });
    eng.setUnits(units(1));
    eng.pump(); await settle();
    eq(calls, 1, 'retryable=false stops the unit after the first 400');
    eq(seen.length, 1);
    eq(eng.halted, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BEL-274 — no_base row, engine-base anchor, and 13-locale copy', () => {
  const { TC, FS } = load();

  test('no_base uses the dedicated row sentence and #engine-base', () => {
    eq(TC.haltMessage('no_base'), EN.halt_no_base_row);
    eq(TC.haltAnchor('no_base'), '#engine-base');
    eq(TC.haltAnchor('auth'), '#engine', '#engine still exists and still focuses the Key');
    eq(FS.row('no_base').text, EN.halt_no_base_row);
    eq(FS.row('no_base').anchor, '#engine-base');
    eq(FS.row('no_base').retry, false);
  });

  test('options.jsx has #engine-base (api-base-url) and #engine (api-key)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/options.jsx'), 'utf8');
    const baseStart = src.indexOf("'#engine-base'");
    const engineStart = src.indexOf("'#engine':");
    ok(baseStart >= 0, 'missing #engine-base anchor');
    ok(engineStart >= 0, 'missing #engine anchor');
    const baseBlock = src.slice(baseStart, baseStart + 420);
    ok(/sec: 'engine-card'/.test(baseBlock), '#engine-base must land on the engine card');
    ok(/getElementById\('api-base-url'\)/.test(baseBlock), '#engine-base must focus the address input');
    ok(/before: 'detail'/.test(baseBlock), '#engine-base must switch to the detail tab');
    const engineBlock = src.slice(engineStart, engineStart + 320);
    ok(/getElementById\('api-key'\)/.test(engineBlock), '#engine must still focus the Key input');
    ok(/no-base-hint/.test(src), 'the address row needs the under-box explanation');
    ok(/no_base_field_hint/.test(src), 'the under-box explanation must use the new key');
    const css = fs.readFileSync(path.join(ROOT, 'extension/options/options.css'), 'utf8');
    ok(/#api-base-url\.no-base-missing[\s\S]{0,120}box-shadow: 0 0 0 2px var\(--accent\)/.test(css),
      'missing 2px accent outline');
  });

  test('all 13 locales have the 9 new keys; en is English, zh_CN is the exact ruling copy', () => {
    const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales/zh_CN/messages.json'), 'utf8'));
    const gen = (() => {
      const raw = fs.readFileSync(path.join(ROOT, 'extension/content/i18n-messages.js'), 'utf8');
      const m = /window\.MT_I18N_MESSAGES = (\{[\s\S]*\});/.exec(raw);
      ok(m, 'i18n-messages.js is missing MT_I18N_MESSAGES');
      return JSON.parse(m[1]);
    })();
    for (const loc of LOCALES) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `extension/_locales/${loc}/messages.json`), 'utf8'));
      for (const k of NEW_KEYS) {
        ok(d[k] && d[k].message && d[k].message.trim(), `${loc} is missing ${k}`);
        eq(gen[loc][k], d[k].message, `${loc}/${k} is stale in the generated bundle`);
      }
    }
    eq(zh.halt_balance_row.message, '这个引擎没余额了 —— 点此去换');
    eq(zh.fail_balance_title.message, '这个引擎的账户没有余额');
    eq(zh.fail_streak_title.message, '连续 3 次都失败');
    eq(zh.fail_streak_next.message, '同一个引擎连续 3 次没成功，最近一次是 HTTP 429（限流）。多数时候是配置或限额的问题，换引擎更快；想再试一次也可以。');
    ok(!/[\u4e00-\u9fff]/.test(EN.fail_balance_title), 'en must not fall back to Chinese');
    ok(!/[\u4e00-\u9fff]/.test(EN.halt_streak_row), 'en must not fall back to Chinese');
  });
});
