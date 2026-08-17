// test/learn-driving.test.js — §9.5 driving mode pure logic.
//
// The load-bearing properties: the auto-grade can NEVER contradict
// gradeGate('speak')'s allowed set (§5.2 honesty — swept across the whole score
// range), the write decision is §5.3's asymmetry verbatim (due=review /
// non-due=practice / candidate=nothing), the reply classifier never turns
// silence into a question, and the state machine stops on NAMED reasons and
// cancels recordings on every interrupt.

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

function load() {
  const m = loadModule('learn-model.js', { window: {} });
  const s = loadModule('learn-scheduler.js', { window: {} });
  const e = loadModule('learn-exercises.js', { window: {}, LearnModel: m.LearnModel });
  const d = loadModule('learn-driving.js', {
    window: {}, LearnModel: m.LearnModel, LearnScheduler: s.LearnScheduler,
  });
  return { D: d.LearnDriving, S: s.LearnScheduler, E: e.LearnExercises };
}

const NOW = 1755400000000;

describe('LearnDriving — drivingGradeFor (§9.5 auto-grade)', () => {
  test('always inside gradeGate("speak")\'s allowed set — full score sweep incl. boundaries', () => {
    const { D, E } = load();
    for (let i = 0; i <= 100; i++) {
      const sc = i / 100;
      const g = D.drivingGradeFor(sc);
      const allowed = E.gradeGate('speak', { score: sc });
      ok(allowed.indexOf(g) >= 0, 'score=' + sc + ' grade=' + g + ' 不在允许集 [' + allowed + ']');
    }
    eq(D.drivingGradeFor(0.9), 2, '0.9 边界应为记得');
    eq(D.drivingGradeFor(0.5), 1, '0.5 边界应为有点难');
    eq(D.drivingGradeFor(0.49), 0, '0.49 应为不记得');
    eq(D.drivingGradeFor(undefined), 0, '无分数按 0 处理');
  });
});

describe('LearnDriving — speakRepOutcome (§5.3 asymmetry verbatim)', () => {
  function sched(S) { return S.applyReview(null, 2, NOW - 10 * 86400000); }

  test('due card + high score → a real review: grade 2, reps advance, skill stamped', () => {
    const { D, S } = load();
    const sc = sched(S);
    const out = D.speakRepOutcome(sc, true, 0.95, NOW);
    eq(out.kind, 'review');
    eq(out.grade, 2);
    eq(out.sched.reps, sc.reps + 1, 'reps 应 +1');
    ok(out.sched.s > sc.s, '记得后 s 应上升');
    ok(out.stampSkill, '到期通过应打技能戳');
  });

  test('due card + low score → a real lapse', () => {
    const { D, S } = load();
    const sc = sched(S);
    const out = D.speakRepOutcome(sc, true, 0.3, NOW);
    eq(out.kind, 'review');
    eq(out.grade, 0);
    eq(out.sched.lapses, sc.lapses + 1, 'lapse 应 +1');
    ok(out.sched.s < sc.s, '不记得后 s 应下降');
    ok(!out.stampSkill, '失败不打技能戳');
  });

  test('non-due card + pass → practice, sched writes NOTHING', () => {
    const { D, S } = load();
    const sc = sched(S);
    const out = D.speakRepOutcome(sc, false, 0.95, NOW);
    eq(out.kind, 'practice');
    eq(out.sched, null, '练习答对不写 sched（§5.3）');
    ok(out.stampSkill, '练习通过仍打技能戳（镜像 gradeInner：技能戳所有路径都打）');
  });

  test('non-due card + fail → practice lapse (forgetting is evidence any time)', () => {
    const { D, S } = load();
    const sc = sched(S);
    const out = D.speakRepOutcome(sc, false, 0.2, NOW);
    eq(out.kind, 'practice');
    ok(out.sched && out.sched.lapses === sc.lapses + 1, '练习答错应照实 lapse');
  });

  test('candidate (no sched) → writes nothing at all, either way', () => {
    const { D } = load();
    for (const sc of [0.95, 0.2]) {
      const out = D.speakRepOutcome(null, false, sc, NOW);
      eq(out.kind, 'none', 'score=' + sc);
      eq(out.sched, null);
      ok(!out.stampSkill);
    }
  });
});

describe('LearnDriving — classifyReply (§9.5 intent table)', () => {
  test('silence and whitespace are none — never a question', () => {
    const { D } = load();
    for (const t of ['', '   ', null, undefined, '.', '嗯']) {
      const got = D.classifyReply(t);
      ok(got === 'none', JSON.stringify(t) + ' → ' + got + '（应为 none）');
    }
  });

  test('no-question phrases advance (none), zh + en', () => {
    const { D } = load();
    for (const t of ['没有', '没有了', '不用了', 'no', 'Nope', 'no questions', '没问题']) {
      eq(D.classifyReply(t), 'none', t);
    }
  });

  test('explicit next / repeat commands', () => {
    const { D } = load();
    for (const t of ['下一个', '下一张', '继续', 'next', 'Skip']) eq(D.classifyReply(t), 'next', t);
    for (const t of ['再来一遍', '再听一遍', '重听', 'again', 'Repeat', 'one more time']) {
      eq(D.classifyReply(t), 'repeat', t);
    }
  });

  test('anything substantive is a question — the mode\'s promise is you can just talk', () => {
    const { D } = load();
    for (const t of ['这个词是什么意思', 'why is it past tense here', '第二个单词怎么拼']) {
      eq(D.classifyReply(t), 'question', t);
    }
  });
});

describe('LearnDriving — reduce (§9.5 session state machine)', () => {
  function drive(D, state, events, ctx) {
    const fx = [];
    for (const ev of events) {
      const r = D.reduce(state, ev, ctx);
      state = r.state;
      fx.push(r.effects.map((e) => e.t + (e.what ? ':' + e.what : '')).join(','));
    }
    return { state, fx };
  }

  test('happy path, listen-only card, no voice loop: source → tr → advance', () => {
    const { D } = load();
    const { state, fx } = drive(D, { name: 'idle' }, [
      { type: 'card' }, { type: 'tts_done' }, { type: 'tts_done' },
    ], { voiceLoop: false, exercise: false });
    eq(state.name, 'advancing');
    deepEq(fx, ['speak:source', 'speak:tr', 'advance']);
  });

  test('happy path, speak card + voice loop: full chain through Q&A re-ask', () => {
    const { D } = load();
    const ctx = { voiceLoop: true, exercise: true };
    const { state, fx } = drive(D, { name: 'idle' }, [
      { type: 'card' },
      { type: 'tts_done' },                                // source → tr
      { type: 'tts_done' },                                // tr → prompt
      { type: 'tts_done' },                                // prompt → record
      { type: 'rec_done', transcript: 'the forgetting curve' },
      { type: 'score_ready' },
      { type: 'tts_done' },                                // score line → asking
      { type: 'tts_done' },                                // ask → record reply
      { type: 'rec_done', transcript: 'why past tense' },
      { type: 'reply', intent: 'question', transcript: 'why past tense' },
      { type: 'qa_ok' },
      { type: 'tts_done' },                                // answer spoken → re-ask
      { type: 'tts_done' },                                // ask → record reply
      { type: 'rec_empty' },                               // silence → advance
    ], ctx);
    eq(state.name, 'advancing');
    deepEq(fx, [
      'speak:source', 'speak:tr', 'speak:prompt_speak', 'record:speak',
      'score', 'speak:score', 'speak:ask', 'record:reply', 'classify',
      'qa', 'speak:answer', 'speak:ask', 'record:reply', 'advance',
    ]);
  });

  test('tts_fail stops on a NAMED reason — never a silent skip', () => {
    const { D } = load();
    const r = D.reduce({ name: 'speaking_tr' }, { type: 'tts_fail', reason: 'no_voice' }, {});
    eq(r.state.name, 'stopped_error');
    eq(r.reason, 'no_voice');
  });

  test('mic_denied mid-recording degrades and continues — the drive does not end', () => {
    const { D } = load();
    const r = D.reduce({ name: 'recording_speak' }, { type: 'rec_fail', code: 'mic_denied' }, { voiceLoop: true, exercise: true });
    eq(r.state.name, 'advancing');
    ok(r.effects.some((e) => e.t === 'stt_gone'), '应发出 stt_gone 让编排器降级');
    ok(r.effects.some((e) => e.t === 'advance'));
  });

  test('transport-shaped rec_fail skips this card\'s exercise and continues', () => {
    const { D } = load();
    const r = D.reduce({ name: 'recording_speak' }, { type: 'rec_fail', code: 'network' }, { voiceLoop: false, exercise: true });
    eq(r.state.name, 'advancing', '无语音环路时直接前进');
    eq(r.note, 'network', '失败具名');
  });

  test('speak-window silence is NO ATTEMPT — skip, never grade 0', () => {
    const { D } = load();
    const r = D.reduce({ name: 'recording_speak' }, { type: 'rec_empty' }, { voiceLoop: false, exercise: true });
    eq(r.state.name, 'advancing');
    eq(r.note, 'speak_skipped');
    ok(!r.effects.some((e) => e.t === 'score'), '静默绝不进评分');
  });

  test('hidden from every recording state cancels the recorder and pauses', () => {
    const { D } = load();
    for (const st of ['recording_speak', 'recording_reply']) {
      const r = D.reduce({ name: st }, { type: 'hidden' }, { voiceLoop: true, exercise: true });
      eq(r.state.name, 'paused', st);
      ok(r.effects.some((e) => e.t === 'cancel_rec'), st + ' 应撤录音');
      ok(r.effects.some((e) => e.t === 'stop_tts'), st + ' 应停 TTS');
    }
  });

  test('pause / resume / next / repeat interrupts from active states', () => {
    const { D } = load();
    let r = D.reduce({ name: 'speaking_tr' }, { type: 'tap_pause' }, {});
    eq(r.state.name, 'paused');
    r = D.reduce(r.state, { type: 'tap_resume' }, {});
    eq(r.state.name, 'speaking_source', '恢复从当前卡原文重来');
    r = D.reduce({ name: 'asking' }, { type: 'tap_next' }, { voiceLoop: true });
    eq(r.state.name, 'advancing');
    ok(r.effects.some((e) => e.t === 'stop_tts'));
    r = D.reduce({ name: 'announcing_result' }, { type: 'tap_repeat' }, {});
    eq(r.state.name, 'speaking_source');
  });

  test('qa_fail names itself and re-asks — the question still stands', () => {
    const { D } = load();
    const r = D.reduce({ name: 'answering' }, { type: 'qa_fail', code: 'http' }, { voiceLoop: true });
    eq(r.state.name, 'asking');
    ok(r.effects.some((e) => e.t === 'note' && e.code === 'http'));
  });

  test('deck exhaustion → session_done', () => {
    const { D } = load();
    const r = D.reduce({ name: 'advancing' }, { type: 'deck_done' }, {});
    eq(r.state.name, 'session_done');
  });
});

describe('LearnDriving — cardPlan (§9.5)', () => {
  test('speak exercise only when the form exists AND STT is capable', () => {
    const { D } = load();
    const strong = { id: 'a', text: 'x', tr: 'y', sched: { s: 10, lastReviewAt: NOW, reps: 3, lapses: 0, d: 5, dueAt: 0 } };
    const weak = { id: 'b', text: 'x', tr: 'y', sched: { s: 1, lastReviewAt: NOW, reps: 1, lapses: 0, d: 5, dueAt: 0 } };
    const caps = { listen: true, speak: true };
    eq(D.cardPlan(strong, caps, true).exercise, 'speak');
    eq(D.cardPlan(strong, caps, false).exercise, null, '无 STT ⇒ 形态不存在');
    eq(D.cardPlan(strong, { listen: true, speak: false }, true).exercise, null, '说档能力关 ⇒ 无题');
    eq(D.cardPlan(weak, caps, true).exercise, null, 's < TIER_SPEAK_S ⇒ 无题');
    deepEq(D.cardPlan(strong, caps, true).segments, ['source', 'tr']);
  });
});
