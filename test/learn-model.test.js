// test/learn-model.test.js — the salience gate and the content-addressed id.
//
// Most of this module's value is NEGATIVE: what it refuses to capture. A gate that
// accepts everything produces byte-identical *code paths* to one that works — only
// a direct assertion sees the difference (verification-spec §3.1.1 blind spot 2).

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

function load() {
  const ctx = loadModule('learn-model.js', { window: {} });
  return ctx.LearnModel;
}

const LATIN = 'The quick brown fox jumps over the lazy dog and keeps running.'; // 61 chars
const CJK = '这是一段足够长的中文句子，用来测试密集文字的长度区间。';

describe('LearnModel — id & normalization', () => {
  test('id is content-addressed: same text+lang → same id, across whitespace noise', () => {
    const M = load();
    eq(M.itemId('en', 'Hello   world'), M.itemId('en', ' Hello world '));
    eq(M.itemId('en', 'Hello\nworld'), M.itemId('en', 'Hello world'));
  });

  test('id separates by language — the same string in two languages is two items', () => {
    const M = load();
    ok(M.itemId('en', 'chat') !== M.itemId('fr', 'chat'));
  });

  test('id is 16 hex chars and stable across loads (it is a storage key)', () => {
    const a = load().itemId('en', LATIN);
    const b = load().itemId('en', LATIN);
    eq(a, b);
    ok(/^[0-9a-f]{16}$/.test(a), `expected 16 hex chars, got ${a}`);
  });

  test('the id never depends on crypto.subtle (absent on http pages in a content script)', () => {
    // Loading with NO crypto in the sandbox at all must still work.
    const ctx = loadModule('learn-model.js', { window: {} });
    eq(typeof ctx.crypto, 'undefined');
    ok(/^[0-9a-f]{16}$/.test(ctx.LearnModel.itemId('en', 'x')));
  });
});

describe('LearnModel — length band is script-aware', () => {
  test('a dense-script sentence scores 1 at a length that would be too short in Latin', () => {
    const M = load();
    const short = '这是一个中文短句子。'; // 10 chars — inside the dense band, below the Latin floor
    eq(M.isDense(short), true);
    eq(M.lengthScore(short), 1);
    eq(M.lengthScore('Ten chars.') < 1, true, 'the same length in Latin must NOT score 1');
  });

  test('both bands score 1 for a normal sentence of their own script', () => {
    const M = load();
    eq(M.lengthScore(LATIN), 1);
    eq(M.lengthScore(CJK), 1);
  });

  test('very long text tapers but never hits zero', () => {
    const M = load();
    const huge = LATIN.repeat(20);
    const s = M.lengthScore(huge);
    ok(s > 0 && s < 0.2, `expected a small positive taper, got ${s}`);
  });
});

describe('LearnModel — the gate (what it REFUSES)', () => {
  const draft = (over) => Object.assign({ text: LATIN, tr: '译文足够长的一句话。', dwellMs: 6000, seenCount: 1 }, over);

  test('a segment scrolled straight past is NOT captured', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 200 })), false);
    eq(M.shouldCapture(draft({ dwellMs: 2499 })), false, 'just under the dwell floor is still out');
  });

  test('a dwelled segment IS captured', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 2500 })), true);
  });

  test('an empty translation is never captured, however long it was on screen', () => {
    const M = load();
    eq(M.shouldCapture(draft({ tr: '' })), false);
    eq(M.shouldCapture(draft({ tr: '   ' })), false);
  });

  test('a too-short segment is rejected even at the dwell floor', () => {
    const M = load();
    eq(M.shouldCapture(draft({ text: 'Hi there.', dwellMs: 2500 })), false);
  });

  test('starring bypasses the gate entirely — including zero dwell', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 0, starred: true })), true);
    eq(M.salience(draft({ dwellMs: 0, starred: true })), 1);
  });

  test('a subtitle the playhead crossed is captured with zero dwell', () => {
    const M = load();
    eq(M.shouldCapture(draft({ dwellMs: 0 })), false);
    eq(M.shouldCapture(draft({ dwellMs: 0, playedThrough: true })), true);
  });

  test('config is MERGED over production DEFAULTS — a partial override cannot blank a field', () => {
    const M = load();
    // Only the threshold is supplied. Every other field (weights, bands, dwell
    // floor) must still come from DEFAULTS rather than reading undefined.
    eq(M.shouldCapture(draft({ dwellMs: 2500 }), { SALIENCE_MIN: 0.99 }), false);
    eq(M.shouldCapture(draft({ dwellMs: 6000 }), { SALIENCE_MIN: 0.01 }), true);
  });

  test('the production DEFAULTS are the ones asserted above, not a test-local copy', () => {
    const M = load();
    eq(M.DEFAULTS.DWELL_MIN_MS, 2500);
    eq(M.DEFAULTS.SALIENCE_MIN, 0.45);
    const w = M.DEFAULTS.W;
    eq(Math.round((w.dwell + w.length + w.repeat) * 100) / 100, 1, 'weights must sum to 1');
  });
});

describe('LearnModel — item shape & merge', () => {
  test('makeItem uses the INJECTED clock, never an ambient one', () => {
    const M = load();
    const it = M.makeItem({ text: LATIN, tr: '译文', lang: 'en' }, 12345);
    eq(it.createdAt, 12345);
    eq(it.lastSeenAt, 12345);
  });

  test('a re-encounter accumulates evidence but never rewrites the content', () => {
    const M = load();
    const a = M.makeItem({ text: LATIN, tr: '第一版译文', lang: 'en', dwellMs: 3000 }, 1000);
    const b = M.makeItem({ text: LATIN, tr: '第二版译文', lang: 'en', dwellMs: 4000 }, 2000);
    const m = M.mergeItem(a, b);
    eq(m.id, a.id);
    eq(m.tr, '第一版译文', 'tr is immutable after creation — sync conflict-freedom depends on it');
    eq(m.dwellMs, 7000);
    eq(m.seenCount, 2);
    eq(m.lastSeenAt, 2000);
  });

  test('starring on a later encounter promotes a candidate to learning', () => {
    const M = load();
    const a = M.makeItem({ text: LATIN, tr: '译文', lang: 'en' }, 1);
    eq(a.state, 'candidate');
    const m = M.mergeItem(a, Object.assign({}, a, { starred: true }));
    eq(m.starred, true);
    eq(m.state, 'learning');
  });
});

describe('LearnModel — outbox contract', () => {
  test('outbox keys are prefixed and bounded (the settings readers filter on this)', () => {
    const M = load();
    eq(M.OUTBOX_PREFIX, 'lq:');
    ok(M.OUTBOX_INDEX.startsWith(M.OUTBOX_PREFIX));
    ok(M.MAX_OUTBOX_SESSIONS > 0 && M.MAX_OUTBOX_SESSIONS <= 100);
  });
});

// ─── §5.2 — the write tier's cloze: pure, deterministic, reconstructable ─────

describe('LearnModel — clozeFor (§5.2)', () => {
  const M = () => loadModule('learn-model.js', { window: {} }).LearnModel;
  const joined = (c) => c.parts.map((p) => p.t === 'text' ? p.v : p.answer).join('');

  test('joining parts reproduces the sentence EXACTLY — Latin and CJK', () => {
    const m = M();
    for (const s of [
      'The forgetting curve shows how memory decays over time.',
      '遗忘曲线展示了记忆随时间衰退的规律。',
      'Short one.',
      '短句。',
      // The two longest words are ADJACENT — the text segment between their blanks
      // is a single space, which is exactly what an off-by-one in partsFrom eats.
      'The absolutely magnificent creature ran off and hid again today.',
    ]) {
      const c = m.clozeFor(s);
      eq(joined(c), m.normText(s), '重组失败: ' + s);
    }
  });

  test('deterministic — same sentence, same blanks, every time', () => {
    const m = M();
    const s = 'Practice cannot grind out mastery, but it can expose forgetting.';
    eq(JSON.stringify(m.clozeFor(s)), JSON.stringify(m.clozeFor(s)));
  });

  test('every sentence with content gets at least one blank, never more than three', () => {
    const m = M();
    for (const s of [
      'Hi.', 'One two.', '好。', '你好吗。',
      'A considerably longer sentence with many perfectly blankable content words inside it, extended even further to be safe.',
      '这是一个相当长的中文句子，包含许多可以挖空的内容词汇，为了保险起见再延长一点。',
    ]) {
      const c = m.clozeFor(s);
      ok(c.blanks >= 1, '没挖空: ' + s);
      ok(c.blanks <= 3, '挖多了(' + c.blanks + '): ' + s);
    }
  });

  test('short sentences get exactly one blank; blanks prefer content words', () => {
    const m = M();
    const c = m.clozeFor('The quick brown fox jumps.');
    eq(c.blanks, 1);
    const answers = c.parts.filter((p) => p.t === 'blank').map((p) => p.answer);
    ok(answers.every((a) => a.length >= 4), '挖到了功能词: ' + answers.join(','));
  });

  test('CJK blanks are letter runs — punctuation is never inside an answer', () => {
    const m = M();
    const c = m.clozeFor('学习一门语言，最难的是坚持，而不是方法。');
    for (const p of c.parts) {
      if (p.t !== 'blank') continue;
      ok(!/[，。、；]/.test(p.answer), '空里有标点: "' + p.answer + '"');
      eq(p.answer.length, 2, 'CJK 空应为两字: "' + p.answer + '"');
    }
  });
});

describe('LearnModel — clozeCheck (§5.2)', () => {
  const M = () => loadModule('learn-model.js', { window: {} }).LearnModel;

  test('case, punctuation and whitespace are typing noise, not knowledge', () => {
    const m = M();
    ok(m.clozeCheck('Forgetting', 'forgetting'));
    ok(m.clozeCheck('curve', '  curve '));
    ok(m.clozeCheck("don't", 'dont'));
    ok(m.clozeCheck('记忆', '记忆'));
  });

  test('everything else must match exactly', () => {
    const m = M();
    eq(m.clozeCheck('curve', 'curves'), false);
    eq(m.clozeCheck('记忆', '技艺'), false);
    eq(m.clozeCheck('word', ''), false);
  });

  test('an empty expectation NEVER passes — 检查 must not succeed on nothing', () => {
    const m = M();
    eq(m.clozeCheck('', ''), false);
    eq(m.clozeCheck('。', '。'), false);   // punctuation-only normalizes to empty
  });
});

// ─── §4/§5.4 — skills merge per-key by MAX, in both merge semantics ──────────
// (Was a boolean union; max is the same operation once values are timestamps,
// and the legacy-boolean cases below are what keep old corpora convergent.)

describe('LearnModel — skills union (§4)', () => {
  const M = () => loadModule('learn-model.js', { window: {} }).LearnModel;
  const item = (over) => Object.assign({
    id: 'x', text: 't', tr: 'y', lang: 'en', seenCount: 1, dwellMs: 0,
    lastSeenAt: 1, salience: 0.5, state: 'learning', starred: false, sched: null,
  }, over);

  test('union under BOTH accumulate and copy — a skill passed anywhere is passed everywhere', () => {
    const m = M();
    for (const opts of [undefined, { accumulate: false }]) {
      const out = m.mergeItem(
        item({ skills: { read: 1 } }),
        item({ skills: { write: 1 } }), opts);
      eq(JSON.stringify(out.skills), '{"read":1,"write":1}',
        JSON.stringify(opts) + ' 下不是并集');
    }
  });

  test('idempotent — replaying the same copy changes nothing', () => {
    const m = M();
    const a = item({ skills: { read: 1, listen: 1 } });
    const once = m.mergeItem(a, item({ skills: { read: 1, listen: 1 } }), { accumulate: false });
    const twice = m.mergeItem(once, item({ skills: { read: 1, listen: 1 } }), { accumulate: false });
    eq(JSON.stringify(once.skills), JSON.stringify(twice.skills));
  });

  test('both sides absent stays absent — no phantom object on every merge', () => {
    const m = M();
    eq(m.mergeItem(item({}), item({})).skills, undefined);
  });

  test('§5.4 — a legacy boolean 1 loses to any real timestamp, both directions and both modes', () => {
    const m = M();
    const TS = 1700000000000;
    for (const opts of [undefined, { accumulate: false }]) {
      const a = m.mergeItem(item({ skills: { read: 1 } }), item({ skills: { read: TS } }), opts);
      eq(JSON.stringify(a.skills), JSON.stringify({ read: TS }), '老徽章不得压过真时间戳');
      const b = m.mergeItem(item({ skills: { read: TS } }), item({ skills: { read: 1 } }), opts);
      eq(JSON.stringify(b.skills), JSON.stringify({ read: TS }), '真时间戳不得被老徽章回退');
    }
  });

  test('§5.4 — per-key max: the LATEST verification wins, other keys union through', () => {
    const m = M();
    const out = m.mergeSkills({ read: 100, write: 900 }, { read: 500, listen: 300 });
    eq(JSON.stringify(out), JSON.stringify({ read: 500, write: 900, listen: 300 }));
  });

  test('§5.4 — mergeSkills is idempotent and commutative (replay cannot amplify)', () => {
    const m = M();
    const a = { read: 100, listen: 1 }, b = { read: 200 };
    const ab = m.mergeSkills(a, b);
    eq(JSON.stringify(m.mergeSkills(ab, b)), JSON.stringify(ab), '重放同一份不变');
    eq(JSON.stringify(m.mergeSkills(b, a)), JSON.stringify(ab), '两个方向同一结果');
  });

  test('§5.4 — non-numeric garbage counts as absent, never NaN', () => {
    const m = M();
    eq(JSON.stringify(m.mergeSkills({ read: 'x' }, { read: 5 })), JSON.stringify({ read: 5 }));
    eq(JSON.stringify(m.mergeSkills({ read: 'x' }, null)), JSON.stringify({}));
    eq(m.mergeSkills(null, undefined), undefined);
  });
});
