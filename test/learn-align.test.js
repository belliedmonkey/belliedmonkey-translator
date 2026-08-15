// test/learn-align.test.js — §4.2c LLM alignment adjudication.
//
// The safety property under test: the LLM PROPOSES, the code DISPOSES. A
// grouping is applied only when it partitions both sides' sentence indices in
// order into the same number of groups, slices verbatim, and passes the ratio
// guard — a hallucinating model can only fail closed to keep-whole.
const { loadModule, describe, test, eq, deepEq, ok } = require('./harness');

const LM = loadModule('learn-model.js', {}).LearnModel;

const EN3 = 'It rained. We stayed home. The roof leaked.';
const ZH2 = '下雨了，我们待在家里。屋顶漏了。'; // translator merged en 0+1

describe('LearnModel.alignByGroups — mechanical verification of a proposed grouping', () => {
  test('a valid grouping heals the translator-merge case, verbatim', () => {
    const pairs = LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: [[0, 1], [2]], b: [[0], [1]] });
    eq(pairs.length, 2, JSON.stringify(pairs));
    deepEq(pairs[0], { text: 'It rained. We stayed home.', tr: '下雨了，我们待在家里。' });
    deepEq(pairs[1], { text: 'The roof leaked.', tr: '屋顶漏了。' });
  });

  test('unequal group counts → null', () => {
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: [[0], [1], [2]], b: [[0], [1]] }), null);
  });

  test('a dropped index → null (every sentence must land somewhere)', () => {
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: [[0], [2]], b: [[0], [1]] }), null);
  });

  test('a duplicated / out-of-order index → null', () => {
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: [[0, 1], [1, 2]], b: [[0], [1]] }), null);
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: [[1, 0], [2]], b: [[0], [1]] }), null);
  });

  test('fewer than 2 groups → null (nothing to split)', () => {
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: [[0, 1, 2]], b: [[0, 1]] }), null);
  });

  test('a grouping producing a wildly off-ratio pair → null (ratio guard)', () => {
    const en = 'Yes. The committee spent eleven long months deliberating over the proposal, holding dozens of meetings, before finally rejecting it outright.';
    const zh = '是的，委员会否决了它。就这样。';
    // pairing the tiny "Yes." against the huge zh-remainder direction:
    eq(LM.alignByGroups(en, zh, 'en', 'zh-CN', { a: [[0], [1]], b: [[1], [0]] }), null, 'non-ascending b');
    eq(LM.alignByGroups(zh, en, 'zh-CN', 'en', { a: [[0], [1]], b: [[1], [0]] }), null);
  });

  test('null / garbage groups → null', () => {
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', null), null);
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: null, b: [[0]] }), null);
    eq(LM.alignByGroups(EN3, ZH2, 'en', 'zh-CN', { a: 'x', b: 3 }), null);
  });
});

describe('LearnAlign — parse strictly, adjudicate through the verifier', () => {
  function align(chatImpl) {
    const LearnNotes = { chat: chatImpl };
    return loadModule('learn/align.js', {
      window: {}, LearnModel: LM, LearnNotes,
      LearnStore: {},
    }).LearnAlign;
  }

  test('parseGroups: JSON with prose around it still parses; garbage does not', () => {
    const A = align(async () => '');
    deepEq(A.parseGroups('Sure! {"a":[[0,1],[2]],"b":[[0],[1]]} hope that helps'),
      { a: [[0, 1], [2]], b: [[0], [1]] });
    eq(A.parseGroups('{"a":null}'), null);
    eq(A.parseGroups('no json at all'), null);
    eq(A.parseGroups('{"a":[[0]]}'), null); // missing b
  });

  test('adjudicate: a valid model grouping returns verified pairs', async () => {
    const A = align(async () => '{"a":[[0,1],[2]],"b":[[0],[1]]}');
    const pairs = await A.adjudicate({ text: EN3, tr: ZH2, lang: 'en', targetLang: 'zh-CN' });
    eq(pairs.length, 2);
    eq(pairs[0].tr, '下雨了，我们待在家里。');
  });

  test('adjudicate: model refusal ({"a":null}) → null, nothing applied', async () => {
    const A = align(async () => '{"a":null}');
    eq(await A.adjudicate({ text: EN3, tr: ZH2, lang: 'en', targetLang: 'zh-CN' }), null);
  });

  test('adjudicate: hallucinated grouping fails the verifier → null', async () => {
    const A = align(async () => '{"a":[[0],[1],[2]],"b":[[0],[1],[2]]}'); // b has only 2 sentences
    eq(await A.adjudicate({ text: EN3, tr: ZH2, lang: 'en', targetLang: 'zh-CN' }), null);
  });

  test('adjudicate: single-sentence side is never sent to the model', async () => {
    let called = 0;
    const A = align(async () => { called++; return '{"a":[[0]],"b":[[0]]}'; });
    eq(await A.adjudicate({ text: 'One sentence.', tr: ZH2, lang: 'en', targetLang: 'zh-CN' }), null);
    eq(called, 0, 'no spend on unsplittable items');
  });
});

describe('LearnAlign.healByRetranslate — §4.2d per-sentence re-translation fallback', () => {
  const EN = 'It rained. We stayed home. The roof leaked.';
  function rig(items, translate) {
    const applied = [];
    const LearnStore = {
      allItems: async () => items,
      retranslateCandidatesFor: (its) => {
        // delegate to the REAL pure decision so the rig cannot drift from it
        const indexedDB = { open: () => { throw new Error('idb'); } };
        const S = loadModule('learn/store.js', { window: {}, indexedDB, LearnModel: LM, LearnScheduler: {} }).LearnStore;
        return S.retranslateCandidatesFor(its);
      },
      applySplit: async (it, pairs) => { applied.push({ id: it.id, pairs }); return pairs.length; },
    };
    const A = loadModule('learn/align.js', { window: {}, LearnModel: LM, LearnNotes: {}, LearnStore }).LearnAlign;
    return { A, applied };
  }
  const item = (over) => Object.assign({
    id: 'p1', anchor: { k: 'dom' }, lang: 'en', targetLang: 'zh-CN',
    text: EN, tr: '下雨了，我们待在家里。屋顶漏了。',
  }, over);

  test('a truncated translation is rescued — pairs aligned by construction', async () => {
    const { A, applied } = rig([item({ tr: '下雨' })], null);
    const r = await A.healByRetranslate(async (s) => '译:' + s);
    eq(r.split, 1); eq(r.children, 3);
    eq(applied[0].pairs.length, 3);
    deepEq(applied[0].pairs[1], { text: 'We stayed home.', tr: '译:We stayed home.' });
  });

  test('an empty translation for ANY sentence keeps the item whole', async () => {
    const { A, applied } = rig([item({})], null);
    const r = await A.healByRetranslate(async (s) => (s.startsWith('We') ? '' : '译:' + s));
    eq(r.split, 0); eq(applied.length, 0);
  });

  test('a throwing engine keeps the item whole and the run alive', async () => {
    const { A } = rig([item({ id: 'a' }), item({ id: 'b' })], null);
    let n = 0;
    // the first item aborts on its FIRST sentence call; the second item's calls all succeed
    const r = await A.healByRetranslate(async (s) => { n++; if (n <= 1) throw new Error('http'); return '译:' + s; });
    eq(r.split, 1, 'second item still healed');
  });

  test('the sentence budget caps spend and reports the capped remainder', async () => {
    const big = 'A rain fell. '.repeat(90).trim(); // 90 sentences > 80 budget
    const { A } = rig([item({ text: big, tr: '雨。' })], null);
    const r = await A.healByRetranslate(async (s) => '译:' + s);
    eq(r.asked, 0); eq(r.capped, 1);
  });
});

describe('LearnStore.retranslateCandidatesFor — §4.2d candidate decision', () => {
  const S = (() => {
    const indexedDB = { open: () => { throw new Error('idb'); } };
    return loadModule('learn/store.js', { window: {}, indexedDB, LearnModel: LM, LearnScheduler: {} }).LearnStore;
  })();
  const EN = 'It rained. We stayed home. The roof leaked.';
  const dom = (over) => Object.assign({
    id: 'x', anchor: { k: 'dom' }, lang: 'en', targetLang: 'zh-CN',
    text: EN, tr: '下雨了，我们待在家里。屋顶漏了。',
  }, over);

  test('a truncated-tr multi-sentence item IS a candidate (unlike the LLM path)', () => {
    eq(S.retranslateCandidatesFor([dom({ tr: '下雨' })]).length, 1);
    eq(S.llmCandidatesFor([dom({ tr: '下雨' })]).length, 0, 'grouping needs ≥2 tr sentences');
  });

  test('aligned pairs, media, and single-sentence sources are NOT candidates', () => {
    eq(S.retranslateCandidatesFor([dom({ tr: '下雨了。我们待在家里。屋顶漏了。' })]).length, 0);
    eq(S.retranslateCandidatesFor([dom({ anchor: { k: 'media' } })]).length, 0);
    eq(S.retranslateCandidatesFor([dom({ text: 'One sentence only.' })]).length, 0);
  });
});

describe('LearnStore.llmCandidatesFor — who gets an adjudication attempt', () => {
  const S = (() => {
    const indexedDB = { open: () => { throw new Error('touched indexedDB at load'); } };
    return loadModule('learn/store.js', { window: {}, indexedDB, LearnModel: LM, LearnScheduler: {} }).LearnStore;
  })();
  const dom = (over) => Object.assign({
    id: 'x', anchor: { k: 'dom' }, lang: 'en', targetLang: 'zh-CN',
    text: EN3, tr: ZH2,
  }, over);

  test('a structurally-refused multi-sentence pair IS a candidate', () => {
    eq(S.llmCandidatesFor([dom({})]).length, 1);
  });

  test('media cues, aligned pairs, and single-sentence sides are NOT', () => {
    eq(S.llmCandidatesFor([dom({ anchor: { k: 'media' } })]).length, 0);
    eq(S.llmCandidatesFor([dom({ tr: '下雨了。我们待在家里。屋顶漏了。' })]).length, 0, 'aligned → structural path owns it');
    eq(S.llmCandidatesFor([dom({ tr: '一句话。' })]).length, 0);
    eq(S.llmCandidatesFor([dom({ text: 'One sentence only.' })]).length, 0);
  });

  test('over the splitter input cap → not a candidate (no spend on monsters)', () => {
    eq(S.llmCandidatesFor([dom({ text: 'A. '.repeat(6000) })]).length, 0);
  });
});
