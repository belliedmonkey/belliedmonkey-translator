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
  const ctx = loadModule('translation-core.js', { window, chrome, document: makeFakeDocument(), navigator: opts.navigator });
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

  // A true here means the unit is never sent to the provider and renders NOTHING, so a
  // wrong true is a silent non-translation. These cases pin the bias toward "no".
  test('isAlreadyTargetLanguage: skips native text, never a real translation job', () => {
    const A = TC.isAlreadyTargetLanguage;

    eq(A('公司真开起来，你会发现最简单的就是开公司本身了。', 'zh-CN'), true, 'pure Chinese, zh target');
    eq(A('广告', 'zh-CN'), true, 'short native label still counts');
    eq(A('Reading foreign articles every morning.', 'zh-CN'), false, 'English must be translated');

    eq(A('我们最近在读 Attention Is All You Need 这篇论文。', 'zh-CN'), false,
      'a few foreign words are enough to be worth translating');
    eq(A('看看 @someone 发的 https://t.co/abc 这条', 'zh-CN'), true,
      'handles and URLs are Latin for mechanical reasons — they must not look bilingual');

    eq(A('これは日本語の文章です。', 'ja'), true, 'kana → Japanese, ja target');
    eq(A('これは日本語の文章です。', 'zh-CN'), false, 'kana present → not Chinese, must translate');
    eq(A('한국어 문장입니다.', 'ko'), true, 'Hangul → Korean, ko target');
    eq(A('한국어 문장입니다.', 'zh-CN'), false, 'Hangul present → not Chinese');

    eq(A('This is plain English.', 'en'), false, 'Latin target never skips — script cannot separate en/fr');
    eq(A('Ceci est une phrase en français.', 'en'), false, 'French under an en target must still be sent');

    eq(A('', 'zh-CN'), false);
    eq(A('   ', 'zh-CN'), false);
    eq(A('公司真开起来', ''), false, 'no target language → never skip');
    eq(A(null, 'zh-CN'), false);
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
  // ── 看门狗：translate() 永不落地时，单元不能永远停在 pending ──────────────
  // 2026-08-29 真机（iPhone 14 Pro / iOS 26.5，全新设备刚授权扩展）实测：整页永远停在
  // 「翻译中…」。根因在传输层（storage 回调不来 → promise 不落地 → translate() 前的
  // await 卡死），但**引擎这一层不该依赖传输层永远正确**：只要有一个 promise 不落地，
  // `.then/.catch/.finally` 一个都不会跑，引擎自己的重试逻辑也就永远不会被触发。
  //
  // 这一族已经咬过两次（回调带 undefined；回调根本不来），传输层每修一个洞都还会有
  // 下一个洞。所以最终保证必须长在引擎里：超过 STALL_MS 一律进 error 态，给用户可点
  // 的重试。这条测试钉的就是那个保证 —— 它对根因不做任何假设。
  test('translate() 永不落地 → 超过 STALL_MS 必须进 error，而不是永远 pending', async () => {
    const { TC } = loadCore();
    const eng = TC.createEngine({
      translate: () => new Promise(() => {}),      // 永不 settle，正是真机上的形状
      window: Object.assign({}, FAST, { STALL_MS: 40 }),
    });
    const units = [{ text: 'hello' }];
    eng.setUnits(units);
    eng.pump();
    eq(eng.stateOf(units[0]).state, 'pending', '刚发出时应当是 pending');
    await tick(120);
    eq(eng.stateOf(units[0]).state, 'error',
      '超过 STALL_MS 之后必须是 error（渲染器据此显示「点此重试」）');
  });

  // 卡死不进重试计数：重试是给「可能自己好起来」的瞬时失败用的。一个不落地的 promise
  // 再等 3 个 STALL_MS 只是让用户多等三倍，所以第一次就该给重试入口。
  test('卡死一次就给重试，不消耗 MAX_RETRIES', async () => {
    const { TC } = loadCore();
    const eng = TC.createEngine({
      translate: () => new Promise(() => {}),
      window: Object.assign({}, FAST, { STALL_MS: 40, MAX_RETRIES: 3 }),
    });
    const units = [{ text: 'hello' }];
    eng.setUnits(units);
    eng.pump();
    await tick(120);
    eq(units[0]._tries, 0, '卡死不该累加重试次数');
    eq(eng.stateOf(units[0]).state, 'error');
  });

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

  // 2026-08-13 真机 bug：一个段落什么都不显示——没有译文、没有报错、没有重试。
  // 根因是引擎把「模型返回空正文」当成了「这段没东西可翻」（终态且静默），
  // 于是渲染器走「nothing to translate → 删掉兄弟节点」那条路。
  //
  // 这两件事必须分开：**请求发出之前**判定不用翻（同语言跳过）才可以静默；
  // **请求发出之后**拿回空正文是失败，必须显示失败并给重试。解析路径 2026-08-08
  // 就为同一形状加过 empty_output（思考型模型烧光预算返回空正文），翻译这条漏了。
  test('空正文 = 失败（可重试），不是「没东西可翻」', async () => {
    const { TC } = loadCore();
    const eng = TC.createEngine({ translate: async () => '', window: FAST });
    const units = [{ text: 'The Problem founder has one of the best excuses.' }];
    eng.setUnits(units);
    eng.pump();
    await tick(10);
    const st = eng.stateOf(units[0]);
    eq(st.state, 'error', '空正文必须落到 error（渲染器据此给出重试按钮）');
    ok(!units[0].tr, '不应写入译文');
  });

  test('空正文之后，retry() 能让它重新排队（否则重试按钮是摆设）', async () => {
    const { TC } = loadCore();
    let answer = '';
    const eng = TC.createEngine({ translate: async () => answer, window: FAST });
    const units = [{ text: 'hello' }];
    eng.setUnits(units);
    eng.pump(); await tick(10);
    eq(eng.stateOf(units[0]).state, 'error');
    answer = '你好';
    eng.retry(units[0]);
    eq(eng.stateOf(units[0]).state, 'pending', 'retry 后应回到 pending 而不是卡在 error');
    eng.pump(); await tick(10);
    deepEq(eng.stateOf(units[0]), { state: '', translation: '你好' });
  });

  test('请求之前的同语言跳过仍然静默（不能被这次修复带成 error）', async () => {
    const { TC } = loadCore();
    let called = 0;
    const eng = TC.createEngine({
      translate: async (t) => { called++; return t; },
      window: FAST, targetLang: 'zh-CN',
      detector: { detect: async () => [{ languageCode: 'zh', confidence: 0.99 }] },
    });
    const units = [{ text: '这段本来就是中文。' }];
    eng.setUnits(units);
    eng.pump(); await tick(20);
    eq(eng.stateOf(units[0]).state, '', '同语言跳过应保持静默终态');
    eq(called, 0, '同语言不该发请求');
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

  // 改判（2026-08-13，真机 bug）：这条断言原本写的是「空正文 marks done, never
  // retries」，把静默终结固化成了契约——正是那个「段落什么都不显示」的化石。
  // 保留其中仍然正确的一半：**不自动重试**（持续返回空正文的模型会烧配额）；
  // 推翻另一半：终态从静默改为 error，用户能看见失败、能点重试。
  test('空正文：不自动重试，但落到 error 而不是静默', async () => {
    const { TC } = loadCore();
    let calls = 0;
    const eng = TC.createEngine({ translate: async () => { calls++; return ''; }, window: FAST });
    const units = [{ text: 'a' }];
    eng.setUnits(units);
    eng.pump();
    await tick(10);
    deepEq(eng.stateOf(units[0]), { state: 'error', translation: '' });
    await tick(10);
    eng.pump();
    eq(calls, 1, '不自动重试——重试是用户点出来的');
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

  // Settings must be read LATE. The subtitle harness builds its engine before
  // settings exist, so capturing the value froze the same-language check to
  // DEFAULT_TARGET_LANG for the whole session (subtitles ignored the user's target
  // language entirely). See docs/domain-design.md §4.
  test('targetLang accepts a getter and is re-read every pump', () => {
    const { TC } = loadCore();
    let settings = {};                                   // not yet assigned, as in the real harness
    const sent = [];
    const eng = TC.createEngine({
      translate: async (t) => { sent.push(t); return 'x'; },
      targetLang: () => settings.targetLang || 'zh-CN',
      window: FAST,
    });
    const units = [{ text: 'これは日本語の文章です。' }];
    eng.setUnits(units);
    eng.pump();
    deepEq(sent, ['これは日本語の文章です。'], 'zh-CN target: kana present → must translate');

    eng.reset(); sent.length = 0;
    settings = { targetLang: 'ja' };                      // user switches target after construction
    eng.pump();
    deepEq(sent, [], 'ja target now skips it — the getter saw the change');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The OPTIONAL browser language detector (docs/domain-design.md §5.3). A skip is a
// silent non-translation, so every gate below is a "must still translate" case.
describe('TranslationCore — injected browser detector (capability axis)', () => {
  const DFAST = Object.assign({}, FAST, { MAX_DETECT_WAITS: 3 });
  // 60+ linguistic letters, so the length gate is satisfied and each case isolates
  // exactly the gate it names.
  const LONG_EN = 'The quick brown fox jumps over the lazy dog while the whole town sleeps soundly.';
  const reliable = (lang) => ({ lang, percentage: 100, isReliable: true });

  // Drives one pump with a canned detector and reports what reached the provider.
  function run(detect, opts = {}) {
    const { TC } = loadCore();
    const sent = [];
    const eng = TC.createEngine({
      translate: async (t) => { sent.push(t); return 'x'; },
      targetLang: opts.targetLang || 'en',
      detect,
      window: DFAST,
    });
    const units = [{ text: opts.text || LONG_EN }];
    eng.setUnits(units);
    for (let i = 0; i < (opts.pumps || 1); i++) eng.pump();
    return { sent, units, eng };
  }

  test('no detector injected → behaviour is exactly the script-only baseline', () => {
    const { sent } = run(null);
    deepEq(sent, [LONG_EN], 'Safari path: a Latin target still sends every unit');
  });

  test('all three gates pass → never sent to the provider', () => {
    const { sent, units } = run(() => reliable('en'));
    deepEq(sent, [], 'already the target language → no request');
    eq(units[0]._done, true, 'settles into the same "nothing to show" state as an empty response');
    deepEq(units[0].tr, undefined, 'and draws no translation');
  });

  test('base subtag is what matches — en-US settings vs an "en" answer', () => {
    deepEq(run(() => reliable('en'), { targetLang: 'en-US' }).sent, []);
    deepEq(run(() => reliable('en-GB'), { targetLang: 'en' }).sent, []);
  });

  test('gate 1 — isReliable false → still translated', () => {
    // Measured on real CLD: "Bonjour." comes back Norwegian at 100% with isReliable
    // false. A percentage is a share of the text, not a confidence.
    const { sent } = run(() => ({ lang: 'en', percentage: 100, isReliable: false }));
    deepEq(sent, [LONG_EN]);
  });

  test('gate 2 — below 90% of the text → still translated', () => {
    deepEq(run(() => ({ lang: 'en', percentage: 89, isReliable: true })).sent, [LONG_EN]);
    deepEq(run(() => ({ lang: 'en', percentage: 90, isReliable: true })).sent, [], 'boundary is inclusive');
  });

  test('gate 3 — under 60 linguistic letters → still translated', () => {
    const short = 'The cat sat on the mat and looked around.';   // 33 letters
    deepEq(run(() => reliable('en'), { text: short }).sent, [short],
      'short text is where detectors are confidently wrong');
    // URLs and @handles are not language and must not be counted toward the floor.
    const padded = 'Short line. https://example.com/a/very/long/path/that/is/not/language @somebody';
    deepEq(run(() => reliable('en'), { text: padded }).sent, [padded],
      'a long URL does not buy its way past the length gate');
  });

  test('a different language, or "und", is never a match', () => {
    deepEq(run(() => reliable('fr')).sent, [LONG_EN], 'French under an en target must be translated');
    deepEq(run(() => reliable('und')).sent, [LONG_EN], 'und = the detector does not know');
    deepEq(run(() => null).sent, [LONG_EN], 'null = no answer will ever come');
  });

  test('zh/ja/ko targets never consult the detector', () => {
    // Layer 1 (script) decides these targets, so layer 2 must not run at all — that is
    // what keeps the most-used path identical on Safari and Chrome.
    let asked = 0;
    const cn = run((t) => { asked++; return reliable('zh'); },
      { targetLang: 'zh-CN', text: '公司真开起来，你会发现最简单的就是开公司本身了。' });
    eq(asked, 0, 'the detector must not even be called for a script-decidable target');
    deepEq(cn.sent, [], 'and the script rule still skips native text on its own');

    // An English paragraph under a zh-CN target: script says "translate", and the
    // detector must not get a second vote either.
    const en = run((t) => { asked++; return reliable('en'); }, { targetLang: 'zh-CN' });
    eq(asked, 0);
    deepEq(en.sent, [LONG_EN]);
  });

  // Guards the boundary of the rule above rather than the rule itself: this is a
  // PRE-EXISTING limitation of the script layer, recorded so a future change to
  // isAlreadyTargetLanguage has to face it deliberately. Neither layer separates
  // Traditional from Simplified — 繁體 is Han without kana, exactly like 简体, and the
  // browser detector reports both as plain `zh`, so it cannot close the gap either.
  // See docs/interaction-spec.md.
  test('KNOWN GAP: Traditional vs Simplified Chinese are not separated', () => {
    const { TC } = loadCore();
    const TRAD = '這是一段完全用繁體中文寫成的句子，用來測試判斷結果是否可靠。';
    const SIMP = '这是一段完全用简体中文写成的句子，用来测试判断结果是否可靠。';
    eq(TC.isAlreadyTargetLanguage(TRAD, 'zh-CN'), true, 'Traditional under zh-CN is skipped — the gap');
    eq(TC.isAlreadyTargetLanguage(SIMP, 'zh-TW'), true, 'and the mirror case under zh-TW');
    // If this test ever goes red because the values flipped, the gap was closed on
    // purpose — update docs/interaction-spec.md's "Pre-existing limitation" note.
  });

  test('a detector that never answers cannot pin a unit at "pending"', () => {
    // detect() returning undefined forever = in flight forever. stateOf reports
    // 'pending' ("⏳ 翻译中…") while !_done, so without the bounded wait this unit
    // would never resolve and never render.
    let asked = 0;
    const { sent, units, eng } = run(() => { asked++; return undefined; }, { pumps: 3 });
    deepEq(sent, [], 'waits during the grace ticks');
    eq(eng.stateOf(units[0]).state, 'pending');
    eq(asked, 3);
    eng.pump();                     // MAX_DETECT_WAITS exceeded
    deepEq(sent, [LONG_EN], 'gives up waiting and translates — erring toward translating');
  });

  test('a detector that throws must not take the engine down with it', () => {
    const { sent } = run(() => { throw new Error('detector exploded'); });
    deepEq(sent, [LONG_EN], 'the unit is translated, exactly as on a browser with no detector');
  });

  // ── Wiring regressions ────────────────────────────────────────────────
  // The three tests below exist because the suite above could not have caught the
  // bugs they pin. Every case above hands createEngine a config the TEST built
  // (DFAST, with MAX_DETECT_WAITS present) and asserts on what reached the
  // provider. The defects lived in the config PRODUCTION builds, and in work done
  // rather than output produced — neither of which those assertions can see.

  test('a window override that omits MAX_DETECT_WAITS still grants the detector its ticks', () => {
    // FAST has no MAX_DETECT_WAITS — the exact shape an adapter writes when it
    // overrides only the knobs it cares about. If cfg.window REPLACED the defaults,
    // win.MAX_DETECT_WAITS would be undefined, `1 <= undefined` false, and the unit
    // would translate on tick 1. And because detect() always answers `undefined` on
    // the first ask for a new text, that silently turns the whole detector off — with
    // every other test in this file still green, because they all supply the key.
    const { TC } = loadCore();
    const sent = [];
    const eng = TC.createEngine({
      translate: async (t) => { sent.push(t); return 'x'; },
      targetLang: 'en',
      detect: () => undefined,          // in flight — the shape of every FIRST ask
      window: FAST,                     // note: no MAX_DETECT_WAITS
    });
    eng.setUnits([{ text: LONG_EN }]);
    eng.pump();
    deepEq(sent, [], 'must wait, not translate on tick 1 — else the detector never answers');
  });

  test('a unit under the length floor is never even asked', () => {
    // The floor depends only on the text, so a sub-floor unit can never be skipped
    // whatever the detector says. Asking anyway spends an IPC, a cache entry and a
    // reaper timer, and stalls the unit for MAX_DETECT_WAITS ticks to discard the
    // answer. Outcome-only assertions cannot see this: the unit is translated either
    // way. So assert on the CALL, the way the zh/ja/ko routing test does.
    let asked = 0;
    const short = 'The meeting starts at noon.';
    const { sent } = run(() => { asked++; return reliable('en'); }, { text: short });
    eq(asked, 0, 'below the floor the answer is unusable — do not spend the call');
    deepEq(sent, [short], 'and it is still translated');
  });

  test('detector waits consume the per-tick budget', () => {
    // Without this, a viewport full of units fires one detector call each inside a
    // single 350ms handler and starts zero translations — MAX_PER_TICK only counted
    // translate() starts, and the wait branch `continue`d past it.
    let asked = 0;
    const { TC } = loadCore();
    const eng = TC.createEngine({
      translate: async () => 'x',
      targetLang: 'en',
      detect: () => { asked++; return undefined; },
      window: Object.assign({}, DFAST, { MAX_PER_TICK: 2 }),
    });
    eng.setUnits(Array.from({ length: 10 }, (_, i) => ({ text: LONG_EN + ' ' + i })));
    eng.pump();
    eq(asked, 2, 'the detector fan-out is bounded by MAX_PER_TICK, not by unit count');
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

  // The subtitle path shares the engine, so the same-language skip must reach it too:
  // a Chinese-language video with target zh-CN would otherwise show every cue twice.
  test('cues already in the target language are never sent to the provider', async () => {
    const { TC } = loadCore();
    const calls = [];
    const eng = TC.createSubtitleEngine({
      getCurrentTime: () => 0,
      translate: async (x) => { calls.push(x); return x; },
      targetLang: 'zh-CN',
      window: FAST,
    });
    const native = { start: 0, end: 1000, text: '我们今天聊聊这个话题' };
    const foreign = { start: 2000, end: 3000, text: 'Today we are talking about this topic' };
    eng.setItems([native, foreign]);
    eng.pump();
    await tick();
    deepEq(calls, ['Today we are talking about this topic'], 'only the foreign cue is requested');
    eq(eng.stateOf(native, 500).state, '', 'native cue never sits in pending');
    ok(!eng.stateOf(native, 500).translation, 'native cue shows no second line');
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

  test('measurer element carries translate="no" (dom-processor hardSkip contract)', () => {
    // The hidden measurer is our own UI: dom-processor hardSkip honors
    // translate="no", so losing this attribute would let the webpage path
    // segment/translate the measurer itself. Assert the contract headlessly.
    const doc = makeFakeDocument();
    const ctx = loadModule('translation-core.js', {
      window: { MT_I18N_MESSAGES: MSGS }, chrome: makeChrome({}), document: doc,
    });
    const p = ctx.TranslationCore.createPager({ measurerId: 'mt-test-meas-attr' });
    p.pageize('measured once to lazily create the element', 1, 20, 300);
    const m = doc.getElementById('mt-test-meas-attr');
    ok(m, 'measurer created and reachable by id');
    eq(m.getAttribute('translate'), 'no', 'own UI opted out of re-translation');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('TranslationCore — isMobileLayout (single control-adapter device signal)', () => {
  const load = (nav) => loadCore({ navigator: nav }).TC;

  test('no navigator (headless) → false', () => {
    eq(load(undefined).isMobileLayout(), false);
  });
  test('touch device (maxTouchPoints > 0) → true (even with a desktop UA)', () => {
    eq(load({ maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari' }).isMobileLayout(), true);
  });
  test('mobile UA with no touch points → true', () => {
    eq(load({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Safari' }).isMobileLayout(), true);
  });
  test('desktop (no touch, desktop UA) → false', () => {
    eq(load({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120' }).isMobileLayout(), false);
  });
});
