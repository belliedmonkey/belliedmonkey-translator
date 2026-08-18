// app/driving.js — 驾车模式 orchestrator (§9.5, interaction-spec 「驾车模式」).
//
// APP-ONLY on purpose: the extension page on iOS Safari refuses gesture-less
// playback, so a hands-free loop cannot exist there — this module ships in the
// app bundle and never in the extension manifest. The session LOGIC lives in
// LearnDriving (content/learn-driving.js, pure); this file only executes its
// effects — TTS chaining, fixed-window recording, progress writes, the view —
// and feeds events back. Progress writes use the SAME primitives review.js's
// gradeInner uses (putItem + recordReview, no new row fields), so the mode's
// §5.3/§5.4 story is the reviewer's, not a second implementation.
//
// The app shell owns view SWITCHING (app/app.js, same split as #review-view);
// everything inside #app-drive is owned here.

var AppDriving = (() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => PageI18n.t(k, fb);

  // ─── Session state (one live session at most) ─────────────────────────────
  let state = { name: 'idle' };
  let deck = [];             // speakable text cards only (media + voiceless filtered)
  let dueSet = new Set();    // ids drawn while actually due — the §5.3 fork
  let idx = 0;
  let practicing = false;    // deck exhausted → optional practice round
  let schedCfg = LearnScheduler.DEFAULTS;
  let uiLang = 'zh-CN';
  let sttOk = false;         // LearnSpeech.capable() and not denied this session
  let uiVoiceOk = false;     // the uiLang prompts themselves can be spoken
  let voiceLoop = false;     // sttOk && uiVoiceOk && DrivingQA.capable()
  let plan = { segments: [], exercise: null };
  let lastAnswer = '';
  let lastScoreLine = '';
  // Generation counters: `gen` invalidates every async continuation on session
  // start/stop; speakSeq/recSeq invalidate a superseded speak/recording so an
  // interrupted utterance's `done` can never advance the NEW state (the same
  // epoch discipline tts.js uses internally).
  let gen = 0;
  let speakSeq = 0;
  let recSeq = 0;
  let rec = null;            // live recorder handle
  let recTimer = 0;

  function loadSettings() {
    // Explicit keys, never get(null) — same list and same reason as review.js.
    return PageSettings.read([
      'uiLang', 'learnDailyNew',
      'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
      'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
      'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
      'sttEngine', 'sttBaseUrl', 'sttApiKey', 'sttModel',
    ]).then((r) => r.data);
  }

  function applySettings(s) {
    uiLang = s.uiLang && s.uiLang !== 'auto' ? s.uiLang : (navigator.language || 'zh-CN');
    // Defensive reconfigure — review.js configured these at bundle load, but the
    // user may have changed settings since; configure() is cheap and idempotent.
    LearnTTS.configure({
      engineId: s.ttsEngine || LearnTTS.DEFAULTS.engineId,
      baseUrl: s.ttsBaseUrl || '', apiKey: s.ttsApiKey || '', model: s.ttsModel || '',
      voice: s.ttsVoice || '', rate: Number(s.ttsRate) > 0 ? Number(s.ttsRate) : 1,
    });
    if (typeof LearnSpeech !== 'undefined') {
      LearnSpeech.configure({
        engineId: s.sttEngine || '', baseUrl: s.sttBaseUrl || '',
        apiKey: s.sttApiKey || '', model: s.sttModel || '',
      });
    }
    LearnNotes.configure(LearnNotes.resolveConfig(s));
    schedCfg = Object.assign({}, LearnScheduler.DEFAULTS, {
      dailyNew: Number(s.learnDailyNew) > 0 ? Number(s.learnDailyNew) : LearnScheduler.DEFAULTS.dailyNew,
    });
  }

  // ─── Entry gating (capability semantics: exists or doesn't, never disabled) ─
  // The entry button renders only when the session could actually speak — the
  // uiLang prompts are its floor. Voices land asynchronously, so wait a moment.
  async function refreshEntry() {
    const btn = $('app-drive-start');
    if (!btn) return;
    try {
      applySettings(await loadSettings());
      const av = await LearnTTS.available(uiLang, 2000);
      btn.hidden = !av.ok;
    } catch (_) { btn.hidden = true; }
  }

  // ─── Copy ─────────────────────────────────────────────────────────────────
  // TTS failure reasons reuse the SAME i18n keys review.js's reasonText maps —
  // one wording per failure across surfaces.
  function ttsReason(reason) {
    switch (reason) {
      case 'no_voice': return t('tts_no_voice', '系统里没有这门语言的语音');
      case 'no_voice_und': return t('tts_no_voice_und', '这张卡的语言未知 —— 在设置里选一个朗读语音后即可朗读');
      case 'unsupported': return t('tts_unsupported', '这个浏览器不提供内置语音');
      case 'no_base': return t('tts_no_base', '还没填语音端点地址');
      case 'no_key': return t('tts_no_key', '还没填语音 API Key');
      case 'blocked': return t('tts_blocked', '浏览器拦下了自动播放，点一下继续');
      case 'http': return t('tts_http', '语音服务返回了错误');
      default: return t('tts_failed', '这句暂时读不出来');
    }
  }

  function statusText() {
    switch (state.name) {
      case 'speaking_source': return t('drive_status_source', '播放原文…');
      case 'speaking_tr': return t('drive_status_tr', '播放译文…');
      case 'prompt_speak':
      case 'announcing_result':
      case 'asking':
      case 'speaking_answer': return t('tts_playing', '播放中…');
      case 'recording_speak':
      case 'recording_reply': return t('drive_status_recording', '录音中，请说话…');
      case 'scoring':
      case 'classifying': return t('learn_speak_busy', '识别中…');
      case 'answering': return t('drive_status_answering', '正在回答…');
      case 'paused': return t('drive_status_paused', '已暂停');
      case 'stopped_error': return ttsReason(state.reasonCode);
      case 'session_done': return t('drive_done', '本轮听完了');
      default: return '';
    }
  }

  // ─── View ─────────────────────────────────────────────────────────────────
  function paint() {
    const active = state.name !== 'idle' && state.name !== 'session_done';
    const pauseLike = state.name === 'paused' || state.name === 'stopped_error';
    $('app-drive-pause').textContent = pauseLike
      ? t('drive_resume', '▶ 继续') : t('drive_pause', '⏸ 暂停');
    $('app-drive-pause').hidden = !active;
    $('app-drive-next').hidden = !active;
    $('app-drive-repeat').hidden = !active;
    // The ask button EXISTS only while the voice loop does (capability rule) and
    // follows the standing IO rule inside a segment: disabled while its own IO
    // (recording / transcribing / answering) is in flight.
    const askBusy = state.name === 'recording_reply' || state.name === 'classifying'
      || state.name === 'answering' || state.name === 'speaking_answer'
      || state.name === 'recording_speak' || state.name === 'scoring';
    $('app-drive-ask').hidden = !(active && voiceLoop);
    $('app-drive-ask').disabled = askBusy;
    $('app-drive-more').hidden = state.name !== 'session_done';
    $('app-drive-status').textContent = statusText();
    $('app-drive-progress').textContent = deck.length
      ? t('drive_progress', '第 {i} / {n} 张')
          .replace('{i}', String(Math.min(idx + 1, deck.length))).replace('{n}', String(deck.length))
      : '';
    $('app-drive-cost').textContent = voiceLoop
      ? t('drive_qa_cost', '提问使用你配置的解析引擎，每问一次调用，不缓存') : '';
  }

  function note(msg) { $('app-drive-note').textContent = msg || ''; }

  function renderCard(item) {
    $('app-drive-text').textContent = item ? item.text : '';
    $('app-drive-tr').textContent = item ? (item.tr || '') : '';
    $('app-drive-answer').textContent = '';
    $('app-drive-score').textContent = '';
    lastAnswer = '';
    lastScoreLine = '';
    note('');
  }

  // ─── Effects ──────────────────────────────────────────────────────────────
  function speechFor(what, item) {
    switch (what) {
      case 'source': return { text: item.text, lang: item.lang || '' };
      case 'tr': return { text: item.tr || '', lang: item.targetLang || uiLang };
      case 'prompt_speak': return { text: t('drive_prompt_speak', '请跟着读一遍'), lang: uiLang };
      case 'score': return { text: lastScoreLine, lang: uiLang };
      case 'ask': return { text: t('drive_prompt_question', '有没有疑问？'), lang: uiLang };
      case 'answer': return { text: lastAnswer, lang: uiLang };
      default: return { text: '', lang: uiLang };
    }
  }

  async function execSpeak(what) {
    const myGen = gen, mySeq = ++speakSeq;
    const item = deck[idx];
    const { text, lang } = speechFor(what, item || {});
    if (!text) { dispatch({ type: 'tts_done' }); return; }
    const r = await LearnTTS.speak(text, lang);
    if (myGen !== gen || mySeq !== speakSeq) return;
    if (!r.ok) {
      // `superseded` means a newer speak owns the session — not a failure here.
      if (r.reason !== 'superseded') dispatch({ type: 'tts_fail', reason: r.reason });
      return;
    }
    await (r.done || Promise.resolve());
    if (myGen !== gen || mySeq !== speakSeq) return;
    dispatch({ type: 'tts_done' });
  }

  function cancelRecording() {
    recSeq++;
    if (recTimer) { clearTimeout(recTimer); recTimer = 0; }
    if (rec) { try { rec.cancel(); } catch (_) {} rec = null; }
  }

  // Fixed-window recording: no VAD exists in this codebase, so the window is
  // time-boxed (LearnDriving.DEFAULTS, unvalidated / cheap to retune). Silence
  // surfaces as rec_empty (empty blob or empty_transcript), which the state
  // machine treats as "no attempt" / "no question" — never as a failed answer.
  async function execRecord(what) {
    const myGen = gen, mySeq = ++recSeq;
    const item = deck[idx];
    let handle;
    try {
      handle = await LearnSpeech.startRecording();
    } catch (e) {
      if (myGen === gen && mySeq === recSeq) dispatch({ type: 'rec_fail', code: (e && e.code) || 'unsupported' });
      return;
    }
    if (myGen !== gen || mySeq !== recSeq) { try { handle.cancel(); } catch (_) {} return; }
    rec = handle;
    const winMs = what === 'speak' ? LearnDriving.DEFAULTS.SPEAK_REC_MS : LearnDriving.DEFAULTS.REPLY_REC_MS;
    recTimer = setTimeout(async () => {
      recTimer = 0;
      if (rec !== handle) return;
      rec = null;
      let out = null;
      try { out = await handle.stop(); } catch (_) { out = null; }
      if (myGen !== gen || mySeq !== recSeq) return;
      if (!out || !out.blob || !out.blob.size) { dispatch({ type: 'rec_empty' }); return; }
      // Transcription language: shadowing is in the CARD's language; a question
      // reply is in the user's own (§9.4: 'und' is never asserted as a language).
      const lang = what === 'speak' ? (item && item.lang) || '' : uiLang;
      try {
        const text = await LearnSpeech.transcribe(out.blob, out.ext, lang);
        if (myGen !== gen || mySeq !== recSeq) return;
        dispatch({ type: 'rec_done', transcript: text });
      } catch (e) {
        if (myGen !== gen || mySeq !== recSeq) return;
        const code = (e && e.code) || 'http';
        dispatch(code === 'empty_transcript' ? { type: 'rec_empty' } : { type: 'rec_fail', code });
      }
    }, winMs);
  }

  // The write, using gradeInner's exact primitives — no new row fields, so sync
  // replay is untouched (§9.5: driving is a new DRIVER of existing write paths).
  async function commitOutcome(item, out, now) {
    if (out.kind === 'none') return;
    let dirty = false;
    if (out.sched) {
      item.sched = out.sched;
      item.state = LearnScheduler.stateFor(item, schedCfg);
      dirty = true;
    }
    if (out.stampSkill) {
      item.skills = Object.assign({}, item.skills);
      item.skills.speak = now;
      item.lastSeenAt = now;
      dirty = true;
    }
    if (dirty) await LearnStore.putItem(item);
    await LearnStore.recordReview(item.id, out.grade, now,
      out.kind === 'review' ? { mode: 'speak' } : { practice: 1, mode: 'speak' });
  }

  async function execScore(transcript) {
    const myGen = gen;
    const item = deck[idx];
    const now = Date.now();
    const { score } = LearnExercises.speakScore(item.text, transcript);
    const isDue = !practicing && dueSet.has(item.id);
    const out = LearnDriving.speakRepOutcome(item.sched, isDue, score, now, schedCfg);
    try {
      await commitOutcome(item, out, now);
    } catch (_) { /* a storage failure loses one rep, never the session */ }
    if (myGen !== gen) return;
    lastScoreLine = t('learn_speak_score', '与原句匹配 {n}%').replace('{n}', String(Math.round(score * 100)));
    $('app-drive-score').textContent = lastScoreLine;
    dispatch({ type: 'score_ready' });
  }

  async function execQA(question) {
    const myGen = gen;
    const item = deck[idx];
    try {
      const answer = await DrivingQA.ask(item, question, uiLang);
      if (myGen !== gen) return;
      lastAnswer = answer;
      // textContent only — model output is untrusted.
      $('app-drive-answer').textContent = answer;
      dispatch({ type: 'qa_ok' });
    } catch (e) {
      if (myGen !== gen) return;
      dispatch({ type: 'qa_fail', code: (e && e.code) || 'http' });
    }
  }

  function noteFor(code) {
    if (code === 'speak_skipped') return t('drive_skip_speak', '这张卡的跟读已跳过');
    if (code === 'qa' || code === 'http' || code === 'no_base' || code === 'empty_output') {
      return t('drive_qa_fail', '回答失败，可以再问一次');
    }
    return t('drive_skip_speak', '这张卡的跟读已跳过');
  }

  function advance() {
    idx++;
    nextCard();
  }

  function nextCard() {
    if (idx >= deck.length) { dispatch({ type: 'deck_done' }); return; }
    const item = deck[idx];
    // caps.speak feeds §5.4 eligibility; the exercise additionally needs the
    // uiLang prompts to be speakable (they carry the 请跟着读一遍 / score lines).
    plan = LearnDriving.cardPlan(item, { listen: true, speak: sttOk }, sttOk && uiVoiceOk, schedCfg);
    renderCard(item);
    dispatch({ type: 'card' });
  }

  async function execDone() {
    // Spoken AND shown — the whole mode is ears-first (fire-and-forget: a
    // missing uiLang voice here must not wedge the done screen).
    const myGen = gen, mySeq = ++speakSeq;
    const r = await LearnTTS.speak(t('drive_done', '本轮听完了'), uiLang);
    if (myGen === gen && mySeq === speakSeq && r.ok) await (r.done || Promise.resolve());
  }

  function exec(fx) {
    switch (fx.t) {
      case 'stop_tts': speakSeq++; LearnTTS.stop(); return;
      case 'cancel_rec': cancelRecording(); return;
      case 'speak': execSpeak(fx.what); return;
      case 'record': execRecord(fx.what); return;
      case 'score': execScore(fx.transcript); return;
      case 'classify':
        dispatch({ type: 'reply', intent: LearnDriving.classifyReply(fx.transcript), transcript: fx.transcript });
        return;
      case 'qa': execQA(fx.question); return;
      case 'advance': advance(); return;
      case 'done': execDone(); return;
      case 'note': note(noteFor(fx.code)); return;
      case 'stt_gone':
        // The voice loop's form ceases to exist for this session — degrade to
        // buttons-only listening, visibly (§9.4 mic_denied semantics).
        sttOk = false;
        voiceLoop = false;
        note(t('drive_stt_gone', '麦克风不可用，本次会话改为纯听读'));
        return;
    }
  }

  function dispatch(ev) {
    const r = LearnDriving.reduce(state, ev, { voiceLoop, exercise: !!plan.exercise });
    state = r.state;
    if (r.reason) state = Object.assign({}, state, { reasonCode: r.reason });
    if (r.note) note(noteFor(r.note));
    for (const fx of r.effects) exec(fx);
    paint();
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────
  async function buildSession() {
    const [items, reviews] = await Promise.all([LearnStore.allItems(), LearnStore.allReviews()]);
    const now = Date.now();
    const full = practicing
      ? LearnScheduler.buildPracticeDeck(items, now, schedCfg, { pool: 'learning' })
      : LearnScheduler.buildDeck(items, now, schedCfg, LearnScheduler.introducedToday(reviews, now));
    // Mark what was actually DUE at build time — the §5.3 fork in speakRepOutcome.
    dueSet = new Set();
    for (const it of items) {
      if (LearnScheduler.stateFor(it, schedCfg) !== 'learning') continue;
      if (LearnScheduler.retrievability(it.sched, now) <= schedCfg.targetR) dueSet.add(it.id);
    }
    // Media cards never enter (synthetic speech never replaces real speech, §11);
    // cards whose language — either side — has no voice are skipped too, COUNTED,
    // never silently (no silent caps).
    const voiceOk = new Map();
    const can = async (lang) => {
      const k = lang || '';
      if (!voiceOk.has(k)) voiceOk.set(k, (await LearnTTS.available(k)).ok);
      return voiceOk.get(k);
    };
    deck = [];
    let skipped = 0;
    for (const it of full) {
      if (it.anchor && it.anchor.k === 'media') { skipped++; continue; }
      if (!(await can(it.lang)) || (it.tr && !(await can(it.targetLang || uiLang)))) { skipped++; continue; }
      deck.push(it);
    }
    return skipped;
  }

  async function start() {
    gen++;
    cancelRecording();
    LearnTTS.stop();
    state = { name: 'idle' };
    idx = 0;
    practicing = false;
    applySettings(await loadSettings());
    sttOk = typeof LearnSpeech !== 'undefined' && LearnSpeech.capable();
    uiVoiceOk = (await LearnTTS.available(uiLang, 2000)).ok;
    voiceLoop = sttOk && uiVoiceOk && DrivingQA.capable();
    const skipped = await buildSession();
    renderCard(null);
    if (skipped) {
      note(t('drive_skipped', '跳过 {n} 张读不出来的卡（媒体卡或无语音）').replace('{n}', String(skipped)));
    }
    if (!deck.length) {
      state = { name: 'session_done' };
      paint();
      $('app-drive-status').textContent = t('drive_empty', '没有可听读的卡');
      return;
    }
    nextCard();
  }

  async function startPractice() {
    gen++;
    cancelRecording();
    LearnTTS.stop();
    state = { name: 'idle' };
    idx = 0;
    practicing = true;
    const skipped = await buildSession();
    renderCard(null);
    if (skipped) {
      note(t('drive_skipped', '跳过 {n} 张读不出来的卡（媒体卡或无语音）').replace('{n}', String(skipped)));
    }
    if (!deck.length) {
      state = { name: 'session_done' };
      paint();
      $('app-drive-status').textContent = t('drive_empty', '没有可听读的卡');
      return;
    }
    nextCard();
  }

  // Full stop: exit the session entirely (view switching is the app shell's).
  function stop() {
    gen++;
    dispatch({ type: 'tap_stop' });
    deck = [];
    dueSet = new Set();
    state = { name: 'idle' };
  }

  // ─── Wiring (everything inside #app-drive) ────────────────────────────────
  function wire() {
    $('app-drive-pause').addEventListener('click', () => {
      dispatch({ type: state.name === 'paused' || state.name === 'stopped_error' ? 'tap_resume' : 'tap_pause' });
    });
    $('app-drive-next').addEventListener('click', () => dispatch({ type: 'tap_next' }));
    $('app-drive-repeat').addEventListener('click', () => dispatch({ type: 'tap_repeat' }));
    $('app-drive-ask').addEventListener('click', () => dispatch({ type: 'tap_ask' }));
    $('app-drive-more').addEventListener('click', () => { startPractice(); });
    // A hidden app (lock, call, app switch) pauses: TTS stops, the recording is
    // cancelled, the mic is released. Resuming is always a tap, never automatic.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' && !$('app-drive').hidden) {
        dispatch({ type: 'hidden' });
      }
    });
  }

  function paintStatic() {
    $('app-drive-start').textContent = t('drive_entry', '驾车模式');
    $('app-drive-back').textContent = t('app_review_back', '← 返回');
    $('app-drive-title').textContent = t('drive_entry', '驾车模式');
    $('app-drive-next').textContent = t('drive_next', '⏭ 下一张');
    $('app-drive-repeat').textContent = t('drive_repeat', '🔁 再听一遍');
    $('app-drive-ask').textContent = t('drive_ask', '🎙 提问');
    $('app-drive-more').textContent = t('drive_practice_more', '继续练习');
    $('app-drive-pause').textContent = t('drive_pause', '⏸ 暂停');
  }

  // Test-only introspection (verify-learn-flow.js): the session's moving parts,
  // read-only. Not a public surface.
  function _debug() {
    return { state: state.name, deck: deck.length, idx, voiceLoop, sttOk, uiVoiceOk, uiLang };
  }

  return { start, stop, wire, paintStatic, refreshEntry, _debug };
})();
