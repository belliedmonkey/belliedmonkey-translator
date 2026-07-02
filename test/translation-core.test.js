// test/translation-core.test.js — regression for the platform-agnostic engine.
const { describe, test, ok, eq, deepEq, match, tick } = require('./harness');
const { makeChrome, makeFakeDocument } = require('./stubs');
const { loadModule } = require('./harness');

// A representative bundled-messages table (subset of _locales) for i18n tests.
const MSGS = {
  en:    { msg_preparing: 'Preparing translation…', msg_loading: 'Translating…' },
  zh_CN: { msg_preparing: '译文准备中…', msg_loading: '翻译中…' },
  zh_TW: { msg_preparing: '譯文準備中…' },
  ja:    { msg_preparing: '翻訳を準備中…' },
};

function loadCore(opts = {}) {
  const chrome = makeChrome({
    uiLanguage: opts.uiLanguage || 'en-US',
    store: opts.store || {},
    messages: opts.chromeMessages || {},
  });
  const window = { MT_I18N_MESSAGES: opts.messages || MSGS };
  const ctx = loadModule('translation-core.js', { window, chrome, document: makeFakeDocument() });
  return { TC: ctx.TranslationCore, chrome, window };
}

const FAST = { AHEAD_MS: 60000, MAX_PER_TICK: 6, MAX_RETRIES: 3, RETRY_GAP_MS: 5, GRACE_MS: 0 };

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — language helpers', () => {
  const { TC } = loadCore();

  test('isTranslated: non-empty output is success; identical is allowed', () => {
    eq(TC.isTranslated('x', 'y'), true);
    eq(TC.isTranslated('x', 'x'), true, 'identical output is NOT a failure');
    eq(TC.isTranslated('x', ''), false);
    eq(TC.isTranslated('x', '   '), false, 'whitespace-only is empty');
    eq(TC.isTranslated('x', null), false);
    eq(TC.isTranslated('x', 5), false, 'non-string is not translated');
  });

  test('endsSentence: terminals across scripts + trailing quote/bracket', () => {
    eq(TC.endsSentence('Hello.'), true);
    eq(TC.endsSentence('你好。'), true);
    eq(TC.endsSentence('Wait…'), true);
    eq(TC.endsSentence('He said "Go."'), true, 'terminal before a close-quote still ends');
    eq(TC.endsSentence('Hello'), false);
    eq(TC.endsSentence('Hello,'), false, 'comma is not a sentence terminal');
  });

  test('joinCue: CJK joins without a space, spaced scripts with one space', () => {
    eq(TC.joinCue('你好', '世界'), '你好世界');
    eq(TC.joinCue('Hello', 'world'), 'Hello world');
    eq(TC.joinCue('', 'x'), 'x');
    eq(TC.joinCue('x', ''), 'x');
    eq(TC.joinCue('a  b', 'c'), 'a b c', 'runs of whitespace collapse');
  });

  test('wordBreakIndex: prefer a nearby space, else break at cut', () => {
    // 'abcdefghij klmno' — space at index 10; cut 13 → 10 > 13*0.6 → 10.
    eq(TC.wordBreakIndex('abcdefghij klmno', 13), 10);
    // cut 5, no space before it → break exactly at cut (CJK-friendly).
    eq(TC.wordBreakIndex('abcdefghij', 5), 5);
  });

  test('looksLikeCode: flags data blobs / JS, passes prose', () => {
    eq(TC.looksLikeCode(`SML.load([["id",332]],'en-US/','auto')`), true, 'reddit inline blob');
    eq(TC.looksLikeCode('[["abc", 123]]'), true);
    eq(TC.looksLikeCode('const f = () => { return 1; }'), true);
    eq(TC.looksLikeCode('This is a perfectly normal sentence.'), false);
    eq(TC.looksLikeCode(''), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — mergeSentences', () => {
  const { TC } = loadCore();
  const OPT = { GAP_MS: 1200, MAX_LEN: 160 };

  test('splits on a gap larger than GAP_MS', () => {
    const out = TC.mergeSentences([
      { start: 0, end: 1000, text: 'Hello' },
      { start: 3000, end: 4000, text: 'World' },
    ], OPT);
    eq(out.length, 2);
    eq(out[0].text, 'Hello');
    eq(out[1].text, 'World');
  });

  test('splits on a sentence terminal', () => {
    const out = TC.mergeSentences([
      { start: 0, end: 1000, text: 'Hi.' },
      { start: 1000, end: 2000, text: 'Bye.' },
    ], OPT);
    eq(out.length, 2);
    eq(out[0].text, 'Hi.');
  });

  test('merges continuation cues into one sentence (spans start→end)', () => {
    const out = TC.mergeSentences([
      { start: 0, end: 1000, text: 'Hello' },
      { start: 1100, end: 2000, text: 'world' },
    ], OPT);
    eq(out.length, 1);
    eq(out[0].text, 'Hello world');
    eq(out[0].start, 0);
    eq(out[0].end, 2000, 'merged sentence spans to the last cue');
  });

  test('CJK cues merge with no space', () => {
    const out = TC.mergeSentences([
      { start: 0, end: 1000, text: '你好' },
      { start: 1100, end: 2000, text: '世界' },
    ], OPT);
    eq(out[0].text, '你好世界');
  });

  test('splits when a sentence exceeds MAX_LEN', () => {
    const long = 'a '.repeat(50).trim(); // ~99 chars, no terminal
    const out = TC.mergeSentences([
      { start: 0, end: 1000, text: long },
      { start: 1100, end: 2000, text: 'tail' },
    ], { GAP_MS: 1200, MAX_LEN: 20 });
    ok(out.length >= 2, 'over-long text flushed before appending more');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — i18n / UI-language resolution', () => {
  test('auto follows the OS locale (getUILanguage)', () => {
    const { TC } = loadCore({ uiLanguage: 'ja-JP' }); // no stored uiLang → auto
    eq(TC.t('msg_preparing', 'FB'), '翻訳を準備中…');
  });

  test('zh-CN / zh-TW region tags resolve to their own bundle', () => {
    eq(loadCore({ uiLanguage: 'zh-TW' }).TC.t('msg_preparing', 'FB'), '譯文準備中…');
    eq(loadCore({ uiLanguage: 'zh-CN' }).TC.t('msg_preparing', 'FB'), '译文准备中…');
  });

  test('bare zh falls back to zh_CN', () => {
    eq(loadCore({ uiLanguage: 'zh' }).TC.t('msg_preparing', 'FB'), '译文准备中…');
  });

  test('explicit uiLang override beats the OS locale', () => {
    const { TC } = loadCore({ uiLanguage: 'ja-JP', store: { uiLang: 'en' } });
    eq(TC.t('msg_preparing', 'FB'), 'Preparing translation…');
  });

  test('runtime uiLang change (storage.onChanged) is picked up live', () => {
    const { TC, chrome } = loadCore({ uiLanguage: 'en-US' });
    eq(TC.t('msg_preparing', 'FB'), 'Preparing translation…');
    chrome._fireChange({ uiLang: { newValue: 'ja' } });
    eq(TC.t('msg_preparing', 'FB'), '翻訳を準備中…', 'MSG getters re-read the locale');
  });

  test('unknown locale → default zh_CN', () => {
    eq(loadCore({ uiLanguage: 'xx-YY' }).TC.t('msg_preparing', 'FB'), '译文准备中…');
  });

  test('resolution order: bundle → chrome.i18n → literal fallback', () => {
    // Key absent from the bundle but present in chrome.i18n.
    const { TC } = loadCore({ uiLanguage: 'en-US', chromeMessages: { only_in_chrome: 'FromChrome' } });
    eq(TC.t('only_in_chrome', 'FB'), 'FromChrome');
    eq(TC.t('nowhere', 'LiteralFallback'), 'LiteralFallback');
  });

  test('MSG getters reflect the active locale', () => {
    const { TC } = loadCore({ uiLanguage: 'en-US' });
    eq(TC.MSG.preparing, 'Preparing translation…');
    eq(TC.MSG.loading, 'Translating…');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — createEngine (state machine)', () => {
  test('happy path: pending → translated', async () => {
    const { TC } = loadCore();
    const eng = TC.createEngine({ translate: async (t) => t.toUpperCase(), window: FAST });
    const units = [{ text: 'a' }, { text: 'b' }];
    eng.setUnits(units);
    eq(eng.stateOf(units[0]).state, 'pending', 'before translation → pending');
    eng.pump();
    await tick(10);
    eq(units[0].tr, 'A');
    deepEq(eng.stateOf(units[0]), { state: '', translation: 'A' });
  });

  test('respects MAX_PER_TICK per pump', () => {
    const { TC } = loadCore();
    let calls = 0;
    const eng = TC.createEngine({
      translate: async (t) => { calls++; return t; },
      window: Object.assign({}, FAST, { MAX_PER_TICK: 2 }),
    });
    eng.setUnits(Array.from({ length: 10 }, (_, i) => ({ text: 'u' + i })));
    eng.pump();
    eq(calls, 2, 'only MAX_PER_TICK translations kick off in one tick');
  });

  test('empty output marks done, never retries', async () => {
    const { TC } = loadCore();
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; return ''; }, window: FAST });
    const units = [{ text: 'a' }];
    eng.setUnits(units);
    eng.pump();
    await tick(10);
    eq(units[0]._done, true);
    deepEq(eng.stateOf(units[0]), { state: '', translation: '' });
    await tick(10);
    eng.pump();
    eq(calls, 1, 'a done unit is not translated again');
  });

  test('error after MAX_RETRIES, then retry() clears it', async () => {
    const { TC } = loadCore();
    const eng = TC.createEngine({ translate: async () => { throw new Error('boom'); }, window: FAST });
    const units = [{ text: 'a' }];
    eng.setUnits(units);
    for (let i = 0; i < 4 && !units[0]._err; i++) { eng.pump(); await tick(FAST.RETRY_GAP_MS + 5); }
    eq(units[0]._err, true);
    eq(eng.stateOf(units[0]).state, 'error');
    eng.retry(units[0]);
    eq(units[0]._err, false);
    eq(units[0]._tries, 0);
  });

  test('reset() clears all per-unit state', async () => {
    const { TC } = loadCore();
    const eng = TC.createEngine({ translate: async (t) => t.toUpperCase(), window: FAST });
    const units = [{ text: 'a' }];
    eng.setUnits(units);
    eng.pump();
    await tick(10);
    eq(units[0].tr, 'A');
    eng.reset();
    eq(units[0].tr, '');
    eq(units[0]._done, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — createSubtitleEngine', () => {
  const items = () => ([
    { start: 0, end: 1000, text: 'one' },
    { start: 2000, end: 3000, text: 'two' },
  ]);

  test('activeAt: start ≤ t < end, latest wins, gaps → null', () => {
    const { TC } = loadCore();
    let t = 0;
    const eng = TC.createSubtitleEngine({ getCurrentTime: () => t, translate: async (x) => x, window: FAST });
    eng.setItems(items());
    eq(eng.activeAt(0).text, 'one', 'inclusive lower bound');
    eq(eng.activeAt(999).text, 'one');
    eq(eng.activeAt(1000), null, 'exclusive upper bound');
    eq(eng.activeAt(1500), null, 'in a gap');
    eq(eng.activeAt(2500).text, 'two');
  });

  test('sliding window: only sentences within [t, t+AHEAD] translate', () => {
    const { TC } = loadCore();
    let now = 0;
    let calls = [];
    const eng = TC.createSubtitleEngine({
      getCurrentTime: () => now,
      translate: async (x) => { calls.push(x); return x; },
      window: FAST, // AHEAD 60000
    });
    eng.setItems([
      { start: 0, end: 1000, text: 'near' },
      { start: 30000, end: 31000, text: 'soon' },
      { start: 120000, end: 121000, text: 'far' },
    ]);
    eng.pump();
    ok(calls.includes('near') && calls.includes('soon'), 'in-window sentences translate');
    ok(!calls.includes('far'), 'beyond AHEAD is not translated yet');
  });

  test('grace period: no "pending" until we are behind by GRACE_MS', () => {
    const { TC } = loadCore();
    const eng = TC.createSubtitleEngine({
      getCurrentTime: () => 0, translate: async (x) => x,
      window: Object.assign({}, FAST, { GRACE_MS: 700 }),
    });
    const it = { start: 1000, end: 5000, text: 'hi' };
    eq(eng.stateOf(it, 1100).state, '', 'within grace → no pending flicker');
    eq(eng.stateOf(it, 1900).state, 'pending', 'past grace → pending');
    it.tr = '你好';
    deepEq(eng.stateOf(it, 1900), { state: '', translation: '你好' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — createPager (deterministic fake measurer)', () => {
  const { TC } = loadCore();
  const pager = TC.createPager({ measurerId: 'mt-test-meas' });

  test('empty text → single empty page', () => {
    deepEq(pager.pageize('', 1, 20, 300), ['']);
  });

  test('text that fits stays one page', () => {
    const pages = pager.pageize('short line', 1, 20, 300);
    deepEq(pages, ['short line']);
  });

  test('long latin text splits into multiple pages, preserving characters', () => {
    const text = 'the quick brown fox jumps over the lazy dog and then keeps on running for a while';
    const pages = pager.pageize(text, 1, 20, 200);
    ok(pages.length > 1, 'wrapped into pages');
    ok(pages.every((p) => p.length > 0), 'no empty page');
    eq(pages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''), 'no characters lost across pages');
  });

  test('long CJK text splits with no lost characters', () => {
    const text = '一二三四五六七八九十'.repeat(6); // 60 chars, no spaces
    const pages = pager.pageize(text, 1, 20, 120);
    ok(pages.length > 1);
    eq(pages.join(''), text, 'CJK breaks at any grapheme, nothing dropped');
  });
});
