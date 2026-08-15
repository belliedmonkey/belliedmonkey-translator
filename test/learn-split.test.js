// test/learn-split.test.js — §4.2 sentence splitting at capture.
//
// The unit of study is the SENTENCE (learning-design §3) but the renderer hands
// the Collector paragraphs. splitPair's one hard rule: pair by COUNT EQUALITY
// only — a long card is a nuisance, a MISALIGNED immutable (text, tr) is
// permanent corpus corruption, so a mismatch keeps the pair whole. The splitter
// itself must survive Intl.Segmenter's two known faults: the `Dr.` false split
// and the trailing-opening-quote orphan (`他睡了。“`).
const { describe, test, eq, deepEq, ok } = require('./harness');
const { loadModule } = require('./harness');

const LM = loadModule('learn-model.js', {}).LearnModel;

describe('LearnModel.splitSentences — segmentation with fault repair', () => {
  test('plain multi-sentence English splits cleanly', () => {
    deepEq(LM.splitSentences('It rained. We stayed home. The roof leaked.', 'en'),
      ['It rained.', 'We stayed home.', 'The roof leaked.']);
  });

  test('abbreviation false split (Dr.) merges forward', () => {
    deepEq(LM.splitSentences('Dr. Smith went home. He slept.', 'en'),
      ['Dr. Smith went home.', 'He slept.']);
  });

  test('Chinese trailing opening-quote orphan moves to the next sentence', () => {
    deepEq(LM.splitSentences('他回家了。他睡了。“我在哭，”她说。', 'zh'),
      ['他回家了。', '他睡了。', '“我在哭，”她说。']);
  });

  test('single sentence stays single', () => {
    deepEq(LM.splitSentences('One sentence only.', 'en'), ['One sentence only.']);
  });

  test('empty / whitespace → []', () => {
    deepEq(LM.splitSentences('   ', 'en'), []);
    deepEq(LM.splitSentences(null, 'en'), []);
  });

  test('a Latin fragment with no terminal merges forward (mid-sentence cut)', () => {
    const out = LM.splitSentences('He said no' + '\n' + 'and left quickly. Then rain.', 'en');
    eq(out.length, 2, JSON.stringify(out));
    eq(out[1], 'Then rain.');
  });
});

describe('LearnModel.splitPair — count-equality pairing, never guess', () => {
  const EN3 = 'It rained. We stayed home. The roof leaked.';
  const ZH3 = '下雨了。我们待在家里。屋顶漏了。';

  test('aligned 3:3 → three pairs, in order', () => {
    const pairs = LM.splitPair(EN3, ZH3, 'en', 'zh-CN');
    eq(pairs.length, 3);
    deepEq(pairs[1], { text: 'We stayed home.', tr: '我们待在家里。' });
  });

  test('count mismatch → kept WHOLE (misalignment would corrupt the corpus)', () => {
    const zh2 = '下雨了，我们待在家里。屋顶漏了。'; // 2 sentences vs 3
    const pairs = LM.splitPair(EN3, zh2, 'en', 'zh-CN');
    eq(pairs.length, 1);
    eq(pairs[0].text, EN3);
    eq(pairs[0].tr, zh2);
  });

  test('single-sentence pair → unchanged single pair', () => {
    const pairs = LM.splitPair('One sentence.', '一句话。', 'en', 'zh-CN');
    eq(pairs.length, 1);
    deepEq(pairs[0], { text: 'One sentence.', tr: '一句话。' });
  });

  test('the real-device pain paragraph splits 5:5', () => {
    const en = 'Primary messaging pillar: The centerpiece of a Problem founder’s comms strategy is high-repetition, vignette-style storytelling about their experience with the problem. '
      + 'I think of this as the Taylor Swift method: communicate specific, scene-based details about an experience to evoke universal and strong emotional responses. '
      + 'You should have a well-rehearsed “origin story” that describes your experience with the problem and can be repeated across channels. '
      + 'For that story to connect, it can’t sound like “existing options weren’t working for me.” '
      + 'It needs to be more like “I was crying in my car during lunch.”';
    const zh = '首要信息支柱：问题型创始人传播战略的核心，是高重复、小场景式地讲述自己与这个问题的经历。'
      + '我把它称为泰勒·斯威夫特方法：用具体的、基于场景的细节唤起普遍而强烈的情绪共鸣。'
      + '你应该有一个排练好的「起源故事」，描述你与问题的经历，并能在各渠道反复讲。'
      + '要让故事打动人，它不能听起来像「现有方案对我不管用」。'
      + '它得更像「我午休时在车里哭」。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 5, JSON.stringify(pairs.map((p) => p.text.slice(0, 30))));
    eq(pairs[4].text, 'It needs to be more like “I was crying in my car during lunch.”');
    eq(pairs[4].tr, '它得更像「我午休时在车里哭」。');
  });

  test('same sentence in two paragraphs → same content-addressed id (§4 property)', () => {
    const a = LM.splitPair('The roof leaked. It rained.', '屋顶漏了。下雨了。', 'en', 'zh-CN');
    const b = LM.splitPair('It rained. We slept.', '下雨了。我们睡了。', 'en', 'zh-CN');
    const idA = LM.itemId('en', a[1].text);
    const idB = LM.itemId('en', b[0].text);
    eq(idA, idB, 'It rained. collapses onto one item from either paragraph');
  });
});

describe('LearnModel.splitSentences — corpus-driven repairs (real-library findings)', () => {
  test('wiki citation glue `.[2] The` splits, citation stays with ITS sentence', () => {
    const out = LM.splitSentences('Espresso is made with pressure, usually 25 seconds.[2] The result is a concentrated beverage.', 'en');
    deepEq(out, ['Espresso is made with pressure, usually 25 seconds.[2]',
                 'The result is a concentrated beverage.']);
  });

  test('zh leading citation cluster moves back to the previous sentence', () => {
    const out = LM.splitSentences('美国和英国的英语使用者更早开始用它。[15] Dictionary.com 收录了该词。', 'zh');
    eq(out.length, 2, JSON.stringify(out));
    eq(out[0], '美国和英国的英语使用者更早开始用它。[15]');
    eq(out[1], 'Dictionary.com 收录了该词。');
  });

  test('a citations-only tail segment merges into the previous sentence', () => {
    const out = LM.splitSentences('图像引用了速度与蒸汽的联想。[11]', 'zh');
    deepEq(out, ['图像引用了速度与蒸汽的联想。[11]']);
  });

  test("a genuine one-word sentence ('Apparently.') is NOT an abbreviation", () => {
    deepEq(LM.splitSentences('It’s a “buyer’s market”. Apparently. But which buyer?', 'en'),
      ['It’s a “buyer’s market”.', 'Apparently.', 'But which buyer?']);
  });

  test('dialogue attribution starting lowercase merges backward', () => {
    const out = LM.splitSentences('“What’s yours called?” asks Matthew, standing by the wall. I confess quietly.', 'en');
    eq(out.length, 2, JSON.stringify(out));
    eq(out[0], '“What’s yours called?” asks Matthew, standing by the wall.');
  });
});

describe('LearnModel.splitPair — cross-language regression (§4.2 应用户要求全语种回归)', () => {
  const CASES = [
    ['ja', '雨が降った。家にいた。屋根が漏れた。', 'zh-CN', '下雨了。我们在家。屋顶漏了。'],
    ['ko', '비가 왔다. 우리는 집에 있었다. 지붕이 샜다.', 'zh-CN', '下雨了。我们在家。屋顶漏了。'],
    ['fr', 'Il a plu. Nous sommes restés chez nous. Le toit fuyait encore !', 'zh-CN', '下雨了。我们待在家里。屋顶又漏了！'],
    ['de', 'Es regnete stark. Wir blieben z. B. zu Hause. Das Dach war undicht.', 'zh-CN', '雨下得很大。我们比如待在家里。屋顶漏了。'],
    ['es', '¿Llovió mucho? Nos quedamos en casa. ¡El techo goteaba!', 'zh-CN', '雨下得大吗？我们待在家里。屋顶在漏水！'],
    ['ru', 'Шёл дождь. Мы остались дома. Крыша протекала.', 'zh-CN', '下雨了。我们待在家里。屋顶漏了。'],
    ['ar', 'أمطرت بغزارة. بقينا في المنزل. كان السقف يسرب.', 'zh-CN', '雨下得很大。我们待在家里。屋顶在漏水。'],
    ['pt', 'Choveu muito. Ficamos em casa. O telhado vazava.', 'zh-CN', '雨下得很大。我们待在家里。屋顶在漏水。'],
    ['it', 'Ha piovuto. Siamo rimasti a casa. Il tetto perdeva.', 'zh-CN', '下雨了。我们待在家里。屋顶在漏水。'],
    ['en', 'It rained. We stayed home. The roof leaked.', 'ja', '雨が降った。家にいた。屋根が漏れた。'],
    ['en', 'It rained. We stayed home. The roof leaked.', 'ko', '비가 왔다. 우리는 집에 있었다. 지붕이 샜다.'],
    ['en', 'It rained. We stayed home. The roof leaked.', 'ar', 'أمطرت. بقينا في المنزل. كان السقف يسرب.'],
  ];
  for (const [lang, text, target, tr] of CASES) {
    test(`${lang} → ${target}: 3 sentences pair 3:3`, () => {
      const pairs = LM.splitPair(text, tr, lang, target);
      eq(pairs.length, 3, JSON.stringify(pairs.map((p) => p.text)));
      ok(pairs.every((p) => p.text && p.tr));
    });
  }

  test('und (Safari, no detector) still splits — segmenter locale is optional', () => {
    const pairs = LM.splitPair('It rained. We stayed home.', '下雨了。我们在家。', 'und', 'zh-CN');
    eq(pairs.length, 2);
  });
});
