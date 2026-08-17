// learn-driving.js — pure logic for 驾车模式 (driving mode, 记忆层).
// See docs/learning-design.md §9.5 and docs/interaction-spec.md 「驾车模式」.
//
// PURE, like learn-exercises.js: the session state machine (`reduce`), the spoken
// reply intent classifier (`classifyReply`), and the speak-rep write decision
// (`speakRepOutcome`) are all deterministic functions of their inputs — the app
// orchestrator (app/driving.js) executes the effects and feeds events back. That
// split is what lets the vm harness walk the whole hands-free loop without a DOM,
// a voice, or a microphone. Depends only on LearnModel and LearnScheduler.

var LearnDriving = (() => {
  const DEFAULTS = {
    // Fixed recording windows — there is no VAD in this codebase, so the window is
    // time-boxed. Unvalidated, cheap to retune (same caveat family as §5.2 tiers).
    SPEAK_REC_MS: 6000,   // 跟读 window
    REPLY_REC_MS: 5000,   // 「有没有疑问？」 reply window
  };

  function cfgOf(cfg) { return Object.assign({}, DEFAULTS, cfg || {}); }

  // Same normalization contract as LearnExercises: case, punctuation and
  // whitespace are noise, not meaning.
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  // ─── Reply intent (§9.5) ───────────────────────────────────────────────────
  // The transcript of the reply window maps to one of four intents. Unmatched
  // speech is a QUESTION — the mode's promise is that the user can just talk.
  // 'none' and 'next' both advance; they are distinguished so the surface can
  // phrase itself honestly (silence vs an explicit 下一个).
  // These patterns match NORMALIZED text — norm() has already stripped spaces
  // and punctuation, so multi-word English phrases appear fused ("noquestions").
  const NONE_RE = /^(没有了?|没|不用了?|没问题|没疑问|好了?|嗯|哦|no|nope|nothing|imgood|allgood|noquestions?)$/;
  const NEXT_RE = /^(下一个|下一张|下一句|继续|跳过|过|next|skip|continue|moveon|goon)$/;
  const REPEAT_RE = /^(再来一遍|再听一遍|再放一遍|重听|重复|重来|再一遍|again|repeat|onemoretime|play(it)?again|say(it)?again)$/;
  function classifyReply(transcript) {
    const t = norm(transcript);
    if (t.length < 2 && !/^[没过嗯哦no]$/.test(t)) return 'none';
    if (NONE_RE.test(t)) return 'none';
    if (NEXT_RE.test(t)) return 'next';
    if (REPEAT_RE.test(t)) return 'repeat';
    return t ? 'question' : 'none';
  }

  // ─── Score → grade (§9.5) ──────────────────────────────────────────────────
  // Hands-free means nobody taps a grade button, so the speakScore band picks the
  // grade. Each value sits inside gradeGate('speak')'s allowed set for its band
  // (≥0.9 → [1,2,3] ∋ 2; <0.5 → [0,1] ∋ 0; middle → [0,1,2,3] ∋ 1), so the
  // auto-grade can never contradict §5.2's honesty rule — pinned by a property
  // test that sweeps the whole score range.
  function drivingGradeFor(score) {
    const sc = Number(score) || 0;
    if (sc >= 0.9) return 2;
    if (sc < 0.5) return 0;
    return 1;
  }

  // ─── The write decision (§9.5 = §5.3 verbatim) ─────────────────────────────
  // One pure function decides what a speak rep writes, so the mode's whole
  // progress story is testable in isolation:
  //   · due card       → a real review: applyReview, row {mode:'speak'}
  //   · non-due card   → §5.3 asymmetry via practiceOutcome: fail lapses,
  //                      pass writes only a {practice:1, mode:'speak'} row
  //   · candidate      → nothing at all (introduction belongs to the daily deck;
  //                      unreachable in practice — cardPlan gates the exercise on
  //                      s ≥ TIER_SPEAK_S, which a candidate never has)
  // stampSkill mirrors gradeInner's rule EXACTLY: a pass at ≥「记得」 stamps on
  // every path, practice included — practice proves nothing about long-term
  // memory (§5.3), but demonstrating a skill is demonstrating a skill (§5.4).
  function speakRepOutcome(sched, isDue, score, now, cfg) {
    const grade = drivingGradeFor(score);
    const hadSched = !!(sched && sched.s);
    if (!hadSched) return { kind: 'none', grade, sched: null, stampSkill: false };
    if (isDue) {
      return {
        kind: 'review',
        grade,
        sched: LearnScheduler.applyReview(sched, grade, now, cfg),
        stampSkill: grade >= 2,
      };
    }
    return {
      kind: 'practice',
      grade,
      sched: LearnScheduler.practiceOutcome(sched, grade, now, cfg),
      stampSkill: grade >= 2,
    };
  }

  // ─── Per-card plan (§9.5) ──────────────────────────────────────────────────
  // What the session does with one card. Media cards never reach this (the
  // orchestrator skips them — synthetic speech never replaces real speech, §11).
  // The speak exercise exists only when the card's speak form exists (§5.4
  // eligibility incl. caps) AND a transcription engine is configured — missing
  // capability means the form does not exist, never a degraded version of it.
  function cardPlan(item, caps, sttCapable, cfg) {
    const segments = ['source'];
    if (item && item.tr) segments.push('tr');
    const eligible = !!(item && LearnScheduler.eligibleSkills(item, caps, cfg).indexOf('speak') >= 0);
    return { segments, exercise: eligible && !!sttCapable ? 'speak' : null };
  }

  // ─── The session state machine ─────────────────────────────────────────────
  // reduce(state, event, ctx) → { state, effects } — a deterministic transition
  // table. `ctx` carries the two capability axes the orchestrator owns:
  //   ctx.voiceLoop — the spoken Q&A loop exists (STT + chat gate + uiLang voice)
  //   ctx.exercise  — the current card has a speak exercise (from cardPlan)
  // Effects are descriptors the orchestrator executes:
  //   speak(what) · record(what) · score(transcript) · classify(transcript) ·
  //   qa(question) · commit(outcome…) is NOT an effect — the orchestrator commits
  //   inside its score handler so the write and the score_ready event can't drift
  //   apart · advance · stop_tts · cancel_rec · note(code) · done
  const ACTIVE = {
    speaking_source: 1, speaking_tr: 1, prompt_speak: 1, recording_speak: 1,
    scoring: 1, announcing_result: 1, asking: 1, recording_reply: 1,
    classifying: 1, answering: 1, speaking_answer: 1,
  };
  const RECORDING = { recording_speak: 1, recording_reply: 1 };

  function S(name, effects, extra) {
    return Object.assign({ state: { name }, effects: effects || [] }, extra || {});
  }

  // After the card's own audio is done: ask (voice loop) or just move on.
  function afterCard(ctx) {
    return ctx && ctx.voiceLoop
      ? S('asking', [{ t: 'speak', what: 'ask' }])
      : S('advancing', [{ t: 'advance' }]);
  }

  function reduce(state, event, ctx) {
    const st = (state && state.name) || 'idle';
    const ev = (event && event.type) || '';
    ctx = ctx || {};

    // ── Global interrupts first — legal from any active state ──
    if (ev === 'tap_stop') return S('idle', [{ t: 'stop_tts' }, { t: 'cancel_rec' }]);
    if (ev === 'tap_pause' || ev === 'hidden') {
      if (st === 'idle' || st === 'session_done') return { state, effects: [] };
      if (st === 'paused') return { state, effects: [] };
      return S('paused', [{ t: 'stop_tts' }, { t: 'cancel_rec' }]);
    }
    if (ev === 'tap_next') {
      if (ACTIVE[st] || st === 'paused' || st === 'stopped_error') {
        return S('advancing', [{ t: 'stop_tts' }, { t: 'cancel_rec' }, { t: 'advance' }]);
      }
      return { state, effects: [] };
    }
    if (ev === 'tap_repeat') {
      if (ACTIVE[st] || st === 'paused' || st === 'stopped_error') {
        return S('speaking_source', [{ t: 'stop_tts' }, { t: 'cancel_rec' }, { t: 'speak', what: 'source' }]);
      }
      return { state, effects: [] };
    }
    if (ev === 'tap_resume' && (st === 'paused' || st === 'stopped_error')) {
      // Resume restarts the CURRENT card from its source — a mid-sentence resume
      // point would need utterance offsets the Web Speech API doesn't give us.
      return S('speaking_source', [{ t: 'speak', what: 'source' }]);
    }
    if (ev === 'tap_ask' && ctx.voiceLoop && ACTIVE[st] && !RECORDING[st]) {
      return S('recording_reply', [{ t: 'stop_tts' }, { t: 'record', what: 'reply' }]);
    }

    // ── A TTS failure anywhere active stops the session on a NAMED reason —
    // never a silent skip, never an idle loop (§9.1 reason discipline). ──
    if (ev === 'tts_fail' && ACTIVE[st]) {
      return S('stopped_error', [{ t: 'cancel_rec' }], { reason: (event && event.reason) || 'tts' });
    }

    // ── STT capability dying mid-session (mic revoked, engine gone) degrades
    // the session to buttons-only listening and keeps going — the voice loop's
    // form ceases to exist, same semantics as the 说 form (§9.4). ──
    if (ev === 'rec_fail' && RECORDING[st]) {
      const code = (event && event.code) || '';
      if (code === 'mic_denied' || code === 'no_mic') {
        return S('advancing', [{ t: 'stt_gone', code }, { t: 'advance' }]);
      }
      // Transport-shaped failures skip this card's exercise / question, say so,
      // and continue — a flaky endpoint must not end the drive.
      return st === 'recording_speak'
        ? Object.assign(afterCard(ctx), { note: code })
        : S('advancing', [{ t: 'note', code }, { t: 'advance' }]);
    }

    switch (st) {
      case 'idle':
      case 'advancing':
        if (ev === 'card') return S('speaking_source', [{ t: 'speak', what: 'source' }]);
        if (ev === 'deck_done') return S('session_done', [{ t: 'done' }]);
        break;

      case 'speaking_source':
        if (ev === 'tts_done') return S('speaking_tr', [{ t: 'speak', what: 'tr' }]);
        break;

      case 'speaking_tr':
        if (ev === 'tts_done') {
          return ctx.exercise
            ? S('prompt_speak', [{ t: 'speak', what: 'prompt_speak' }])
            : afterCard(ctx);
        }
        break;

      case 'prompt_speak':
        if (ev === 'tts_done') return S('recording_speak', [{ t: 'record', what: 'speak' }]);
        break;

      case 'recording_speak':
        if (ev === 'rec_done') return S('scoring', [{ t: 'score', transcript: event.transcript }]);
        // Silence is NO ATTEMPT, not a failed attempt — grading it would lapse a
        // card because the driver was merging lanes. Skip, say so, move on.
        if (ev === 'rec_empty') return Object.assign(afterCard(ctx), { note: 'speak_skipped' });
        break;

      case 'scoring':
        if (ev === 'score_ready') return S('announcing_result', [{ t: 'speak', what: 'score' }]);
        break;

      case 'announcing_result':
        if (ev === 'tts_done') return afterCard(ctx);
        break;

      case 'asking':
        if (ev === 'tts_done') return S('recording_reply', [{ t: 'record', what: 'reply' }]);
        break;

      case 'recording_reply':
        if (ev === 'rec_done') return S('classifying', [{ t: 'classify', transcript: event.transcript }]);
        if (ev === 'rec_empty') return S('advancing', [{ t: 'advance' }]);
        break;

      case 'classifying':
        if (ev === 'reply') {
          const intent = event.intent;
          if (intent === 'question') return S('answering', [{ t: 'qa', question: event.transcript }]);
          if (intent === 'repeat') return S('speaking_source', [{ t: 'speak', what: 'source' }]);
          return S('advancing', [{ t: 'advance' }]);
        }
        break;

      case 'answering':
        if (ev === 'qa_ok') return S('speaking_answer', [{ t: 'speak', what: 'answer' }]);
        // A failed answer names itself and re-asks — the question still stands.
        if (ev === 'qa_fail') return S('asking', [{ t: 'note', code: (event && event.code) || 'qa' }, { t: 'speak', what: 'ask' }]);
        break;

      case 'speaking_answer':
        if (ev === 'tts_done') return S('asking', [{ t: 'speak', what: 'ask' }]);
        break;
    }
    return { state, effects: [] };
  }

  return { DEFAULTS, reduce, classifyReply, drivingGradeFor, speakRepOutcome, cardPlan };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnDriving;
