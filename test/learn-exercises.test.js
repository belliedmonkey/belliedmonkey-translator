// test/learn-exercises.test.js — §5.4/§9.3 exercise generation.
//
// The load-bearing properties: DETERMINISM (same card, same reps ⇒ same exercise —
// a reload must re-ask the same question), material honesty (an MCQ option that IS
// the answer in disguise, or a listen foil that was actually heard, makes the
// exercise unwinnable-by-honesty), and the objective-result → allowed-grades map
// staying aligned with the cloze rule.

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

function load() {
  const m = loadModule('learn-model.js', { window: {} });
  const ctx = loadModule('learn-exercises.js', { window: {}, LearnModel: m.LearnModel });
  return ctx.LearnExercises;
}

const ITEM = { id: 'card1', text: 'The forgetting curve is steep at first.', tr: '遗忘曲线起初很陡。' };
const POOL = [
  ITEM,
  { id: 'p1', text: 'Practice makes memories durable.', tr: '练习让记忆持久。' },
  { id: 'p2', text: 'Spaced repetition beats cramming.', tr: '间隔重复胜过临时抱佛脚。' },
  { id: 'p3', text: 'Sleep consolidates what you learned.', tr: '睡眠巩固你学到的东西。' },
  { id: 'p4', text: 'Reviews should arrive before forgetting.', tr: '复习应赶在遗忘之前。' },
];

describe('LearnExercises — pickExercise (§9.3 rotation)', () => {
  test('deterministic per (id, reps, skill) — a reload re-asks the same question', () => {
    const E = load();
    for (let r = 0; r < 6; r++) {
      const a = E.pickExercise('read', ITEM, { reps: r, poolSize: 9, hasAI: false });
      const b = E.pickExercise('read', ITEM, { reps: r, poolSize: 9, hasAI: false });
      eq(a.kind, b.kind, 'reps=' + r + ' 两次结果不同');
    }
  });

  test('the rotation actually rotates: recall AND mcq both appear across reps', () => {
    const E = load();
    const kinds = new Set();
    for (let r = 0; r < 16; r++) {
      kinds.add(E.pickExercise('read', ITEM, { reps: r, poolSize: 9, hasAI: false }).kind);
    }
    ok(kinds.has('recall') && kinds.has('mcq'), '16 次 reps 只出了 ' + [...kinds].join(','));
  });

  test('comprehension joins the rotation ONLY while the pack gate is open', () => {
    const E = load();
    const withoutAI = new Set(), withAI = new Set();
    for (let r = 0; r < 24; r++) {
      withoutAI.add(E.pickExercise('read', ITEM, { reps: r, poolSize: 9, hasAI: false }).kind);
      withAI.add(E.pickExercise('read', ITEM, { reps: r, poolSize: 9, hasAI: true }).kind);
    }
    ok(!withoutAI.has('comprehension'), '门没开也轮出了理解题');
    ok(withAI.has('comprehension'), '门开着却永远轮不到理解题');
  });

  test('a small corpus cannot host an MCQ — falls back to recall, never a broken card', () => {
    const E = load();
    for (let r = 0; r < 16; r++) {
      const k = E.pickExercise('read', ITEM, { reps: r, poolSize: 2, hasAI: false }).kind;
      ok(k !== 'mcq', '语料只有 2 条还轮出了选择题');
    }
  });

  test('write is always cloze, speak is always speak — no variants behind them', () => {
    const E = load();
    eq(E.pickExercise('write', ITEM, { reps: 3 }).kind, 'cloze');
    eq(E.pickExercise('speak', ITEM, { reps: 3 }).kind, 'speak');
  });
});

describe('LearnExercises — mcqFrom (译文选择题)', () => {
  test('the answer appears exactly once and correct points at it', () => {
    const E = load();
    const q = E.mcqFrom(ITEM, POOL, null, 0);
    ok(q, 'MCQ 没生成');
    eq(q.options.filter((o) => o === ITEM.tr).length, 1);
    eq(q.options[q.correct], ITEM.tr);
    ok(q.options.length >= 2 && q.options.length <= 4);
  });

  test('deterministic: the same corpus asks the same question', () => {
    const E = load();
    deepEq(E.mcqFrom(ITEM, POOL, null, 2), E.mcqFrom(ITEM, POOL, null, 2));
  });

  test('pack distractors are preferred, but one that restates the answer is dropped', () => {
    const E = load();
    const q = E.mcqFrom(ITEM, POOL, ['记忆随时间增强。', '遗忘曲线起初很陡', '练习毫无作用。'], 0);
    ok(q.options.indexOf('记忆随时间增强。') >= 0, '合规的题包干扰项没被采用');
    // '遗忘曲线起初很陡' normalizes equal to the answer — using it would make two
    // options both "correct" and the exercise unwinnable-by-honesty.
    eq(q.options.filter((o) => o.indexOf('遗忘曲线起初很陡') >= 0).length, 1,
      '归一化等值的干扰项混进了选项');
  });

  test('a corpus with no usable distractor yields null (caller falls back to recall)', () => {
    const E = load();
    eq(E.mcqFrom(ITEM, [ITEM], null, 0), null);
    eq(E.mcqFrom({ id: 'x', text: 't', tr: '' }, POOL, null, 0), null, '空译文出不了题');
  });
});

describe('LearnExercises — listenPickFrom (盲听选词)', () => {
  test('every correct option occurs in the sentence; no foil does', () => {
    const E = load();
    const q = E.listenPickFrom(ITEM, POOL, null, 0);
    ok(q, '选词题没生成');
    const sent = ITEM.text.toLowerCase();
    for (const o of q.options) {
      if (o.hit) ok(sent.indexOf(o.w.toLowerCase()) >= 0, '正确项不在句中: ' + o.w);
      else ok(sent.indexOf(o.w.toLowerCase()) < 0, '干扰项出现在句中: ' + o.w);
    }
    ok(q.options.some((o) => o.hit) && q.options.some((o) => !o.hit), '两类选项都要有');
  });

  test('a pack foil that actually occurs in the sentence is rejected', () => {
    const E = load();
    const q = E.listenPickFrom(ITEM, POOL, ['curve', 'memory', 'sleep', 'window'], 0);
    ok(q.options.every((o) => o.hit || o.w !== 'curve'),
      '句中出现过的词被当成了干扰项 —— 惩罚听对了的耳朵');
  });

  test('a foil that is a SUBSTRING of a sentence word is rejected too', () => {
    const E = load();
    // 'forget' is not a content unit of the sentence, but the ear that heard
    // "forgetting" will (correctly) recognize it — offering it as a foil
    // punishes exactly that ear. The unit-set guard cannot catch this one;
    // only the raw in-sentence check does.
    const q = E.listenPickFrom(ITEM, POOL, ['forget', 'memory', 'sleep'], 0);
    ok(q.options.every((o) => o.hit || o.w !== 'forget'),
      '句中词的子串被当成了干扰项');
  });

  test('deterministic per (id, reps); different reps rotate the tested words', () => {
    const E = load();
    deepEq(E.listenPickFrom(ITEM, POOL, null, 1), E.listenPickFrom(ITEM, POOL, null, 1));
    const seen = new Set();
    for (let r = 0; r < 8; r++) {
      for (const o of E.listenPickFrom(ITEM, POOL, null, r).options) {
        if (o.hit) seen.add(o.w.toLowerCase());
      }
    }
    ok(seen.size > 3, '8 次 reps 考来考去都是同几个词（' + [...seen].join(',') + '）——知识点没有轮换');
  });

  test('not enough foil material ⇒ null, never a one-sided exercise', () => {
    const E = load();
    eq(E.listenPickFrom(ITEM, [ITEM], null, 0), null);
  });
});

describe('LearnExercises — speakScore (§9.4 local judge)', () => {
  test('sparse: exact read = 1, empty = 0 with everything missed', () => {
    const E = load();
    eq(E.speakScore(ITEM.text, ITEM.text).score, 1);
    eq(E.speakScore(ITEM.text, 'the forgetting curve is steep at first').score, 1,
      '大小写与标点是噪音不是知识');
    const none = E.speakScore(ITEM.text, '');
    eq(none.score, 0);
    ok(none.missed.length > 0, '全没读出来却没有漏读词');
  });

  test('sparse: a partial read scores between 0 and 1 and names the missed words', () => {
    const E = load();
    const r = E.speakScore('Practice makes memories durable.', 'practice makes durable');
    ok(r.score > 0 && r.score < 1, 'got ' + r.score);
    ok(r.missed.indexOf('memories') >= 0, '漏读的词没有被点名: ' + JSON.stringify(r.missed));
  });

  test('dense: exact = 1; a missing span lowers the score and shows in missed', () => {
    const E = load();
    eq(E.speakScore('间隔重复胜过临时抱佛脚', '间隔重复胜过临时抱佛脚').score, 1);
    const r = E.speakScore('间隔重复胜过临时抱佛脚', '间隔重复');
    ok(r.score > 0 && r.score < 1, 'got ' + r.score);
    ok(r.missed.length > 0);
  });

  test('a transcript of the WRONG sentence scores near zero', () => {
    const E = load();
    ok(E.speakScore(ITEM.text, 'completely unrelated words spoken here').score < 0.2);
  });
});

describe('LearnExercises — gradeGate (objective result → allowed grades)', () => {
  test('binary kinds mirror the cloze rule exactly', () => {
    const E = load();
    for (const kind of ['mcq', 'listen-pick', 'comprehension', 'cloze']) {
      deepEq(E.gradeGate(kind, { correct: true }), [1, 2, 3], kind + ' 全对后「不记得」必须禁用');
      deepEq(E.gradeGate(kind, { correct: false }), [0], kind + ' 答错后不许自评通过');
    }
  });

  test('speak is thresholded, with an honest middle band', () => {
    const E = load();
    deepEq(E.gradeGate('speak', { score: 0.95 }), [1, 2, 3]);
    deepEq(E.gradeGate('speak', { score: 0.3 }), [0, 1]);
    deepEq(E.gradeGate('speak', { score: 0.7 }), [0, 1, 2, 3], '中间带保留自评');
    deepEq(E.gradeGate('speak', null), [0, 1], '没有结果按最差档处理');
  });
});
