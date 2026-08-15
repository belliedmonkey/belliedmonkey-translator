// test/learn-split.test.js — §4.2 sentence splitting at capture.
//
// The unit of study is the SENTENCE (learning-design §3) but the renderer hands
// the Collector paragraphs. splitPair's one hard rule: pair by COUNT EQUALITY
// only — a long card is a nuisance, a MISALIGNED immutable (text, tr) is
// permanent corpus corruption. A mismatch gets ONE bounded §4.2b reconciliation
// attempt (ops only at known segmenter-ambiguity boundaries, unique survivor,
// ratio guard) and otherwise keeps the pair whole. The splitter itself must
// survive Intl.Segmenter's known faults: the `Dr.` false split and the
// trailing-opening-quote orphan (`他睡了。“`).
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

describe('LearnModel.splitSentences — citation TAIL ends a sentence (§4.2 espresso etymology regression)', () => {
  test('`.[16][17][a] Outside` splits — cite-tail segment is not re-glued by rule ②', () => {
    const out = LM.splitSentences(
      'Several sources speculate the word "express" contributed to its uptake.[16][17][a] Outside of the Anglosphere, expresso is commonly used in France.', 'en');
    deepEq(out, ['Several sources speculate the word "express" contributed to its uptake.[16][17][a]',
                 'Outside of the Anglosphere, expresso is commonly used in France.']);
  });
});

describe('LearnModel.splitPair — §4.2b count reconciliation (real-library mismatches)', () => {
  test('zh embedded quoted question (`？”这类…`) merges back under en count evidence', () => {
    const en = 'What your archetype will not tell you are answers to questions like “How often should I post?” Founder comms are like workout routines.';
    const zh = '你的原型不会告诉你的是“我应该多久发一次帖？”这类问题的答案。创始人沟通就像健身计划。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 2, JSON.stringify(pairs));
    eq(pairs[0].tr, '你的原型不会告诉你的是“我应该多久发一次帖？”这类问题的答案。');
  });

  test('en refuses to break before an @handle — zh count re-opens it', () => {
    const en = 'The team reduced overhead by many orders of magnitude. @VitalikButerin estimates the approach is within 10x overhead in some settings. That framing matters.';
    const zh = '团队将开销降低了多个数量级。@VitalikButerin 估计该方法在某些场景下开销在10倍以内。这个框架很重要。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 3, JSON.stringify(pairs.map((p) => p.text)));
    eq(pairs[1].text, '@VitalikButerin estimates the approach is within 10x overhead in some settings.');
  });

  test('en refuses to break before a digit (`volume. 750ml bottles`) — reconciled', () => {
    const en = 'That is the future of wine in supermarkets being sold by volume. 750ml bottles still have a place, but the way we sell them needs to change.';
    const zh = '这就是超市中按量销售葡萄酒的未来。750毫升的瓶装葡萄酒仍有其位置，但我们的销售方式需要改变。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 2, JSON.stringify(pairs.map((p) => p.text)));
    eq(pairs[1].text.slice(0, 5), '750ml');
  });

  test('single-letter initial (`Comando G. My cellar`) re-opened by zh count', () => {
    const en = 'I have three clients who are 100% wine, one being Comando G. My cellar of Comando G wines is probably the best in the world!';
    const zh = '我有三个客户是100%用酒抵费的，其中一个就是Comando G。我的Comando G葡萄酒收藏大概是全世界最好的！';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 2, JSON.stringify(pairs.map((p) => p.text)));
    eq(pairs[1].text.slice(0, 9), 'My cellar');
  });

  test('bare-ellipsis 2:1 stays a single WHOLE pair (merged result would be < 2 pairs)', () => {
    const en = 'Finally there is the notion of doing something "expressly" for a person ... The first machines in 1906 took 45 seconds to make a cup, expressly for you.';
    const zh = '最后，还有“专门”为某人做某事的概念……1906 年，第一台机器只需 45 秒就能冲泡一杯，专门为您而做。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    // the ellipsis merge would land 1:1 — reconcile refuses (< 2 pairs), so the
    // pair is kept whole VERBATIM (space preserved); the ≥3-part success case is
    // the "merge WINS a 3:2 reconcile" test below
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
    ok(pairs[0].text.includes('person ... The first'), pairs[0].text);
  });

  test('need=2: two soft-splits in one reconcile (multi-op subset search)', () => {
    const en = 'The launch drew mixed reactions. @alice praised the latency wins across every region she tested. @bob countered that pricing remains the real blocker for most teams.';
    const zh = '这次发布反响不一。@alice 称赞了她测试的每个区域的延迟改进。@bob 反驳说，定价仍然是大多数团队真正的障碍。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 3, JSON.stringify(pairs.map((p) => p.text)));
    eq(pairs[1].text.slice(0, 6), '@alice');
    eq(pairs[2].text.slice(0, 4), '@bob');
  });

  test('splitPair with empty/null sides → a single degenerate whole pair', () => {
    deepEq(LM.splitPair('', '下雨了。我们在家。', 'en', 'zh-CN'), [{ text: '', tr: '下雨了。我们在家。' }]);
    deepEq(LM.splitPair('It rained. We stayed.', '', 'en', 'zh-CN'), [{ text: 'It rained. We stayed.', tr: '' }]);
    deepEq(LM.splitPair(null, null, 'en', 'zh-CN'), [{ text: '', tr: '' }]);
  });

  test('ja quoted question mid-sentence reconciles like zh', () => {
    const ja = '彼は「もう帰るの？」という質問に答えなかった。翌日も同じだった。';
    const en = 'He did not answer the question “Are you leaving already?” The next day was the same.';
    const pairs = LM.splitPair(en, ja, 'en', 'ja');
    eq(pairs.length, 2, JSON.stringify(pairs));
  });

  test('two needed ops but one candidate → honestly whole (never guess)', () => {
    const en = '“What’s yours called?” asks Matthew, as we stand uncomfortably staring at each other. “Managing Wine,” I confess. He breaks into giggles.';
    const zh = '“你那门课叫什么名字？”马修问道。我们正别扭地互相对视。“葡萄酒管理，”我坦白道。他咯咯笑了起来。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
  });

  test('translator restructuring with NO candidate boundary → honestly whole', () => {
    const en = 'It’s never been easier to start a company. It’s also never been harder to get someone to care. Anyone can go from idea to business quickly.';
    const zh = '创业从未如此简单，但让别人在意也从未如此困难。如今任何人都能快速从想法走向商业落地。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1);
  });
});

describe('LearnModel.splitPair — §4.2b reconciliation guard rails (coverage audit)', () => {
  test('|diff| > 3 → whole even when candidate ops could bridge it (bounded attempt)', () => {
    // en is 1 segment with FOUR @-handle split candidates; zh is 5 sentences.
    // diff = 4 exceeds the cap, so reconcile never even enumerates — whole.
    const en = 'Alpha said hi to everyone. @aa said more here. @bb replied fast. @cc agreed then. @dd closed it out.';
    const zh = '阿尔法向大家问好。@aa 说了更多。@bb 很快回复。@cc 表示同意。@dd 结束了讨论。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
  });

  test('more than 4 split candidates → genuinely ambiguous, kept whole', () => {
    // en is 1 segment with FIVE @-handle candidates; zh is 4 sentences (diff 3
    // passes the diff cap) — the candidate cap refuses the search.
    const en = 'Alpha said hi. @aa said more. @bb replied. @cc agreed. @dd nodded. @ee closed it.';
    const zh = '阿尔法问好，@aa 说了更多。@bb 回复了，@cc 也同意。@dd 点头了。@ee 结束了讨论。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
  });

  test('more than 4 MERGE candidates → genuinely ambiguous, kept whole', () => {
    // en is 6 segments with FIVE bare-ellipsis merge candidates; zh is 3
    // sentences (diff 3 passes the diff cap) — the merge-side cap refuses.
    const en = 'I waited alone ... Then rain came down ... Then wind picked up ... Then snow fell hard ... Then sun broke out ... Then calm came at last.';
    const zh = '我独自等着，然后下起了雨，接着起了风。然后下起了大雪，太阳又出来了。最后终于平静了。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
  });

  test('ratio guard rejects a count-equal but misaligned merge → whole', () => {
    // Merging en[0]+en[1] lands counts 2:2, but pairs a ~170-char English run
    // with 4-char 「他问了。」 — the per-pair ratio guard must throw it out.
    const en = 'He kept asking “Why would anyone ever pay for this?” Nobody in the room, not the investors, not the founders, not even the interns, had any kind of answer to give him that day. So we left.';
    const zh = '他问了。那天房间里没有一个人能回答他，不管是投资人、创始人还是实习生，大家都沉默着，我们就走了。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
  });

  test('two ratio-plausible merge candidates → ambiguous, kept whole (uniqueness rule)', () => {
    // zh has TWO `？”` merge candidates and either merge survives the ratio
    // guard — two distinct survivors mean the count evidence proves nothing.
    const en = 'He asked if we were hungry at all. She asked if we were tired again, and the two of them laughed for a long time.';
    const zh = '他先问：“饿了吗？”她又问：“累了吗？”两个人都笑了很久。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.text)));
  });

  test('OPENER_HEAD veto + corroboration: dialogue with quote-less counterpart stays whole', () => {
    // zh[0] ends ？” but zh[1] opens with “ — that candidate is vetoed. The
    // remaining `。”`+attribution candidate then fails corroboration: the en
    // counterpart is INDIRECT speech with no quoted terminal to echo. This is
    // structurally identical to the reviewers' poison case (`She said no.` →
    // `她说：“不。”然后…` where the merge is WRONG), so both must keep whole —
    // one right and one wrong reading of the same shape is exactly a guess.
    const en = 'He asked if she was really sure. She said she was sure and walked away.';
    const zh = '他问：“你确定吗？”“我确定。”她说完就走了。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 1, JSON.stringify(pairs.map((p) => p.tr)));
  });

  test('poison family: an incidental candidate never bridges translator restructuring', () => {
    // Each constructed by an independent adversarial review (2026-08-15): the
    // true mismatch cause is a translator merge at a NON-candidate boundary;
    // the incidental candidate elsewhere must not win. Corroboration kills the
    // first two (`。”` has no `?`-class echo / the counterpart's ellipsis is
    // final, not internal); the uppercase-continuation veto kills the third.
    const CASES = [
      ['She said no. Then she nodded and left.',
       '她说：“不。”然后她点了点头。接着她离开了。'],
      ['He kept waiting for an answer that never came ... The rain fell harder against the window. She finally turned away and walked home.',
       '他一直等着那个永远不会到来的答案……雨点更猛烈地敲打着窗户,她终于转过身,走回了家。'],
      ['She looked up and asked “Will you stay?” He said nothing at all. Then she nodded and left the room quietly.',
       '她抬起头问：“你会留下来吗？”他一言不发,然后她点了点头,安静地离开了房间。'],
      // 3rd-gen (echo present on BOTH sides, killed by mergeDominates: the true
      // non-candidate boundary fits the ratio metric strictly better)
      ['She answered, “No.” Then she nodded and left.',
       '她说：“不。”然后她点了点头。接着她离开了。'],
      ['He asked, “Ready?” She nodded and set off.',
       '他问：“准备好了吗？”她点了点头。接着出发了。'],
    ];
    for (const [en, zh] of CASES) {
      eq(LM.splitPair(en, zh, 'en', 'zh-CN').length, 1, en.slice(0, 30));
    }
  });

  test('bare-ellipsis merge WINS a 3:2 reconcile (not just the 2:1 kept-whole case)', () => {
    // the zh counterpart carries the corroborating INTERNAL `……` — the
    // translator ran the sentences together too (real-corpus shape)
    const en = 'He paused for a moment and said nothing at all ... The rain kept falling on the roof for hours. We finally went home.';
    const zh = '他停顿了一会儿什么也没说……雨在屋顶上下了几个小时。我们终于回家了。';
    const pairs = LM.splitPair(en, zh, 'en', 'zh-CN');
    eq(pairs.length, 2, JSON.stringify(pairs.map((p) => p.text)));
    ok(pairs[0].text.includes('... The rain'), pairs[0].text);
    eq(pairs[1].text, 'We finally went home.');
  });

  test('equal-count fast path is ratio-guarded too (translator-restructure coincidence)', () => {
    const en = 'Yes. The committee spent eleven months deliberating over the proposal before rejecting it. No.';
    const zh = '委员会花了整整十一个月反复审议这份提案,来来回回开了几十次会,最终还是把它否决了,理由写了满满三页纸。是的。不。';
    eq(LM.splitPair(en, zh, 'en', 'zh-CN').length, 1);
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
