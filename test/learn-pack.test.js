// test/learn-pack.test.js — AI 题包 (§9.3).
//
// Mirrors learn-notes.test.js, because the pack inherits §9.2's contracts: the
// capability gate is the NOTES gate, the output is untrusted (per-field mechanical
// compliance, partial packs survive), and the cache discipline — at most ONE charge
// per card per PACK_VERSION — is visible only to a call-count assertion.

const { loadModule, describe, test, ok, eq, deepEq, rejects } = require('./harness');

const ITEM = { id: 'card1', text: 'The forgetting curve is steep at first.', tr: '遗忘曲线起初很陡。', lang: 'en' };

const GOOD_PACK = JSON.stringify({
  mcq: { distractors: ['记忆随时间增强。', '练习没有任何效果。', '曲线始终平缓。'] },
  listen: { foils: ['memory', 'practice', 'window'] },
  comprehension: [{ q: '这句话在讲什么？', options: ['遗忘的速度', '做饭的步骤'], correct: 0 }],
  accept: { steep: ['stepe'] },
});

function setup(over) {
  over = over || {};
  const db = new Map();
  const calls = { chat: 0 };
  const LearnNotes = {
    capable: () => over.capable !== false,
    chat: async () => {
      calls.chat++;
      if (over.chatError) { const e = new Error('boom'); e.code = over.chatError; throw e; }
      return over.text !== undefined ? over.text : GOOD_PACK;
    },
  };
  const LearnStore = {
    getNote: (id) => Promise.resolve(db.get(id) || null),
    putNote: over.putFails
      ? () => Promise.reject(new Error('quota'))
      : (id, data, meta) => { db.set(id, Object.assign({ id, data }, meta)); return Promise.resolve(); },
  };
  const ctx = loadModule('learn/exercise-pack.js', { window: {}, LearnNotes, LearnStore, console });
  return { P: ctx.LearnExercisePack, db, calls };
}

describe('LearnExercisePack — the gate is the notes gate (§9.3)', () => {
  test('capable() delegates — one gate, two features, zero drift', () => {
    eq(setup().P.capable(), true);
    eq(setup({ capable: false }).P.capable(), false);
  });
});

describe('LearnExercisePack — parsePack enforces every prompt rule mechanically', () => {
  test('a fully valid pack survives intact (fenced or buried in prose too)', () => {
    const { P } = setup();
    const out = P.parsePack(GOOD_PACK, ITEM);
    eq(out.mcq.distractors.length, 3);
    eq(out.listen.foils.length, 3);
    eq(out.comprehension.length, 1);
    deepEq(out.accept.steep, ['stepe']);
    ok(P.parsePack('```json\n' + GOOD_PACK + '\n```', ITEM) !== null);
    ok(P.parsePack('Sure! ' + GOOD_PACK + ' Hope that helps!', ITEM) !== null);
  });

  test('a distractor that restates the translation is dropped — equal or containing, either way', () => {
    const { P } = setup();
    const out = P.parsePack(JSON.stringify({
      mcq: { distractors: ['遗忘曲线起初很陡。', '（遗忘曲线起初很陡)', '曲线', '记忆增强。'] },
    }), ITEM);
    // '曲线' is CONTAINED in the translation's normalization — also out.
    deepEq(out.mcq.distractors, ['记忆增强。']);
  });

  test('a foil that occurs in the sentence is dropped — it punishes a correct ear', () => {
    const { P } = setup();
    const out = P.parsePack(JSON.stringify({
      listen: { foils: ['curve', 'Forgetting', 'memory', 'practice'] },
    }), ITEM);
    deepEq(out.listen.foils, ['memory', 'practice']);
  });

  test('comprehension questions are type-checked and correct must be in range', () => {
    const { P } = setup();
    const out = P.parsePack(JSON.stringify({ comprehension: [
      { q: 'ok?', options: ['a', 'b'], correct: 0 },
      { q: 'bad-index', options: ['a', 'b'], correct: 2 },
      { q: 'one-option', options: ['a'], correct: 0 },
      { q: 42, options: ['a', 'b'], correct: 0 },
      { q: 'five-options', options: ['a', 'b', 'c', 'd', 'e'], correct: 0 },
    ] }), ITEM);
    eq(out.comprehension.length, 1);
    eq(out.comprehension[0].q, 'ok?');
  });

  test('accept keys must be verbatim from the sentence; alternates must differ from the key', () => {
    const { P } = setup();
    const out = P.parsePack(JSON.stringify({ accept: {
      steep: ['STEEP', 'stepe'],          // 'STEEP' normalizes equal to the key — useless
      notinsentence: ['whatever'],
    } }), ITEM);
    deepEq(Object.keys(out.accept), ['steep']);
    deepEq(out.accept.steep, ['stepe']);
  });

  test('a partial pack survives per-field drops; a pack with nothing usable is null', () => {
    const { P } = setup();
    const partial = P.parsePack(JSON.stringify({
      mcq: { distractors: ['遗忘曲线起初很陡。'] },      // all dropped
      listen: { foils: ['memory'] },                    // survives
    }), ITEM);
    ok(partial && !partial.mcq && partial.listen, JSON.stringify(partial));
    eq(P.parsePack(JSON.stringify({ mcq: { distractors: ['遗忘曲线起初很陡。'] } }), ITEM), null);
    eq(P.parsePack('I cannot help with that.', ITEM), null);
  });
});

describe('LearnExercisePack — cache discipline: at most one charge per card per PACK_VERSION', () => {
  test('second get() is a cache hit — zero further calls', async () => {
    const { P, calls } = setup();
    const a = await P.get(ITEM, 'zh-CN');
    eq(a.cached, false);
    const b = await P.get(ITEM, 'zh-CN');
    eq(b.cached, true);
    eq(calls.chat, 1, '同一张卡扣了 ' + calls.chat + ' 次费');
  });

  test('concurrent get()s dedupe onto one in-flight call', async () => {
    const { P, calls } = setup();
    const [a, b] = await Promise.all([P.get(ITEM, 'zh-CN'), P.get(ITEM, 'zh-CN')]);
    ok(a.data && b.data);
    eq(calls.chat, 1, '并发同卡扣了 ' + calls.chat + ' 次费');
  });

  test('a version mismatch is a miss — the one deliberate re-charge (§9.2 rule)', async () => {
    const { P, db, calls } = setup();
    db.set(P.packKey(ITEM.id), { id: P.packKey(ITEM.id), data: { listen: { foils: ['x'] } }, v: 0 });
    const r = await P.get(ITEM, 'zh-CN');
    eq(r.cached, false);
    eq(calls.chat, 1);
  });

  test('a failed cache write must NOT surface as failure — the charge already happened', async () => {
    const { P, calls } = setup({ putFails: true });
    const r = await P.get(ITEM, 'zh-CN');
    ok(r.data && r.data.mcq, '数据在手却报了失败 —— 会引诱第二次扣费');
    eq(calls.chat, 1);
  });

  test('bad_output rejects with its name and caches nothing', async () => {
    const { P, db } = setup({ text: 'no json here' });
    await rejects(() => P.get(ITEM, 'zh-CN'), /unusable/);
    eq(db.size, 0, '不可用的输出被缓存了');
  });

  test('transport errors pass through with their codes (no_base / http / empty_output)', async () => {
    const { P } = setup({ chatError: 'http' });
    try { await P.get(ITEM, 'zh-CN'); ok(false, '应当抛错'); }
    catch (e) { eq(e.code, 'http'); }
  });
});
