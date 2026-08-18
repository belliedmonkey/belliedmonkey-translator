// app/driving.js — 驾车模式 orchestrator (§9.5, interaction-spec 「驾车模式」).
//
// APP-ONLY on purpose: the extension page on iOS Safari refuses gesture-less
// playback, so continuous hands-free audio cannot exist there — this module ships in
// the app bundle and never in the extension manifest. The session LOGIC lives in
// LearnDriving (content/learn-driving.js, pure); this file only executes its effects
// — TTS chaining, notes fetching, the view — and feeds events back.
//
// ─── It is a PLAYER, and it writes nothing ──────────────────────────────────
// No review row, no skill stamp, no `lastSeenAt`, no scheduler call. The earlier
// version asked a question after every card and offered a 跟读 exercise so a driver
// could push real progress; both are gone, because a recording window has to
// interrupt continuous playback to exist and continuous playback is the point. The
// learning layer's write paths stay on the review surface, where the user can see
// what they are grading. §12 keeps the record.
//
// The app shell owns view SWITCHING (app/app.js, same split as #review-view);
// everything inside #app-drive is owned here.

var AppDriving = (() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => PageI18n.t(k, fb);

  // ─── Session state (one live session at most) ─────────────────────────────
  let state = { name: 'idle' };
  let deck = [];             // speakable text cards only (media + voiceless filtered)
  let order = [];            // deck indices, in playback order
  let pos = 0;               // index INTO deck (not into order)
  let mode = LearnDriving.DEFAULT_MODE;
  let playNotes = false;
  let notesOk = false;       // a chat engine is configured — the notes gate (§9.2)
  let schedCfg = LearnScheduler.DEFAULTS;
  let uiLang = 'zh-CN';
  let plan = { segments: [] };
  let notesText = '';        // rendered notes for the current card, if fetched
  // Generation counters: `gen` invalidates every async continuation on session
  // start/stop; `speakSeq` invalidates a superseded utterance so an interrupted
  // speak's `done` can never advance the NEW state (the epoch discipline tts.js
  // uses internally); `notesSeq` does the same for an in-flight notes fetch, which
  // outlives the card that asked for it whenever the user taps 下一张.
  let gen = 0;
  let speakSeq = 0;
  let notesSeq = 0;

  const SETTINGS_KEYS = [
    'uiLang', 'learnDailyNew',
    'ttsEngine', 'ttsBaseUrl', 'ttsBaseUrlVerbatim', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
    'provider', 'apiKey', 'apiBaseUrl', 'apiBaseUrlVerbatim', 'apiModel',
    'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesBaseUrlVerbatim', 'notesModel',
    // §9.5 — this mode's own two knobs. Both persist: a driver sets them once.
    'drivePlaybackMode', 'drivePlayNotes',
  ];

  function loadSettings() {
    // Explicit keys, never get(null) — same list discipline as review.js.
    return PageSettings.read(SETTINGS_KEYS).then((r) => r.data);
  }

  function applySettings(s) {
    uiLang = s.uiLang && s.uiLang !== 'auto' ? s.uiLang : (navigator.language || 'zh-CN');
    mode = LearnDriving.MODES.indexOf(s.drivePlaybackMode) >= 0
      ? s.drivePlaybackMode : LearnDriving.DEFAULT_MODE;
    playNotes = s.drivePlayNotes === true;
    // Defensive reconfigure — review.js configured these at bundle load, but the
    // user may have changed settings since; configure() is cheap and idempotent.
    LearnTTS.configure({
      engineId: s.ttsEngine || LearnTTS.DEFAULTS.engineId,
      baseUrl: s.ttsBaseUrl || '', baseUrlVerbatim: s.ttsBaseUrlVerbatim === true,
      apiKey: s.ttsApiKey || '', model: s.ttsModel || '',
      voice: s.ttsVoice || '', rate: Number(s.ttsRate) > 0 ? Number(s.ttsRate) : 1,
    });
    LearnNotes.configure(LearnNotes.resolveConfig(s));
    notesOk = LearnNotes.capable();
    schedCfg = Object.assign({}, LearnScheduler.DEFAULTS, {
      dailyNew: Number(s.learnDailyNew) > 0 ? Number(s.learnDailyNew) : LearnScheduler.DEFAULTS.dailyNew,
    });
  }

  // ─── Entry gating (capability semantics: exists or doesn't, never disabled) ─
  // The entry button renders only when the session could actually speak.
  // Voices land asynchronously, so wait a moment.
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

  function modeLabel(m) {
    switch (m) {
      case 'sequential': return t('drive_mode_sequential', '⏭ 顺序播放');
      case 'loop': return t('drive_mode_loop', '🔁 循环播放');
      case 'repeat-one': return t('drive_mode_repeat_one', '🔂 单曲循环');
      default: return t('drive_mode_shuffle', '🔀 随机播放');
    }
  }

  function statusText() {
    switch (state.name) {
      case 'speaking': {
        const what = (plan.segments || [])[state.seg || 0];
        if (what === 'tr') return t('drive_status_tr', '播放译文…');
        if (what === 'notes') return t('drive_status_notes', '播放解析…');
        return t('drive_status_source', '播放原文…');
      }
      case 'fetching_notes': return t('drive_status_parsing', '正在解析这一句…');
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
    // The mode button stays live at all times — it changes what happens at the END
    // of the current card, never interrupting what is playing, which is exactly why
    // it is safe to press while moving.
    $('app-drive-mode').hidden = !active;
    $('app-drive-mode').textContent = modeLabel(mode);
    // `session_done` is reachable only in 顺序播放; the other three never end.
    $('app-drive-more').hidden = state.name !== 'session_done';
    $('app-drive-status').textContent = statusText();
    $('app-drive-progress').textContent = deck.length
      ? t('drive_progress', '第 {i} / {n} 张')
          .replace('{i}', String(Math.min(pos + 1, deck.length))).replace('{n}', String(deck.length))
      : '';
    // Say the cost while it is being incurred, not only in settings: the charge is
    // per un-parsed card, and it happens while the user is driving and not looking.
    $('app-drive-cost').textContent = (active && playNotes && notesOk)
      ? t('drive_notes_cost', '播放解析：没解析过的卡会调用你配置的解析引擎，每张卡只收一次费') : '';
  }

  function note(msg) { $('app-drive-note').textContent = msg || ''; }

  function renderCard(item) {
    $('app-drive-text').textContent = item ? item.text : '';
    $('app-drive-tr').textContent = item ? (item.tr || '') : '';
    $('app-drive-notes').textContent = '';
    notesText = '';
    note('');
  }

  // ─── Effects ──────────────────────────────────────────────────────────────
  function speechFor(what, item, fx) {
    switch (what) {
      case 'source': return { text: item.text, lang: item.lang || '' };
      case 'tr': return { text: item.tr || '', lang: item.targetLang || uiLang };
      // The notes text was rendered by the fetch effect and travels on the effect,
      // so the utterance can never disagree with what is shown.
      case 'notes': return { text: (fx && fx.text) || notesText, lang: uiLang };
      default: return { text: '', lang: uiLang };
    }
  }

  async function execSpeak(fx) {
    const myGen = gen, mySeq = ++speakSeq;
    const item = deck[pos];
    const { text, lang } = speechFor(fx.what, item || {}, fx);
    if (!text) { dispatch('tts_done'); return; }
    const r = await LearnTTS.speak(text, lang);
    if (myGen !== gen || mySeq !== speakSeq) return;
    if (!r.ok) {
      // `superseded` means a newer speak owns the session — not a failure here.
      if (r.reason !== 'superseded') dispatch('tts_fail', r.reason);
      return;
    }
    await (r.done || Promise.resolve());
    if (myGen !== gen || mySeq !== speakSeq) return;
    dispatch('tts_done');
  }

  // Fetch (generating if necessary) and render this card's notes for speech.
  //
  // §9.2's contract is unchanged: `LearnNotes.get` is cache-first and charges the
  // user's key AT MOST ONCE per card, ever. What is new is that the driving session
  // can be the thing that triggers that one charge, silently, while the phone is in
  // a cradle — hence the cost line in the view and the sentence beside the setting.
  async function execFetchNotes() {
    const myGen = gen, mySeq = ++notesSeq;
    const item = deck[pos];
    if (!item || !notesOk) { dispatch('notes_ready', ''); return; }
    let data = null;
    try {
      const r = await LearnNotes.get(item, uiLang);
      data = r && r.data;
    } catch (e) {
      if (myGen !== gen || mySeq !== notesSeq) return;
      dispatch('notes_fail', (e && e.code) || 'notes_failed');
      return;
    }
    if (myGen !== gen || mySeq !== notesSeq) return;
    const text = LearnDriving.notesToSpeech(data, {
      words: t('drive_notes_words', '生词：'),
      phrases: t('drive_notes_phrases', '短语：'),
      grammar: t('drive_notes_grammar', '语法：'),
    });
    notesText = text;
    $('app-drive-notes').textContent = text;
    dispatch('notes_ready', text);
  }

  function noteFor(code) {
    switch (code) {
      case 'no_base': return t('drive_notes_no_base', '解析引擎还没配置好，这张卡的解析跳过了');
      case 'no_voice':
      case 'no_voice_und': return t('drive_skip_card', '这张卡读不出来，已跳到下一张');
      case 'notes_failed':
      default: return t('drive_notes_failed', '这张卡的解析没成功，已跳过');
    }
  }

  // Move to the next card per the playback mode. `force` is the 下一张 button: a
  // manual skip moves on even in 单曲循环.
  function advance(force) {
    const r = LearnDriving.advance(pos, order, mode, Math.random, force);
    order = r.order;
    if (r.done) { dispatch('deck_done'); return; }
    pos = r.pos;
    openCard();
  }

  function openCard() {
    const item = deck[pos];
    if (!item) { dispatch('deck_done'); return; }
    plan = LearnDriving.cardPlan(item, { playNotes: playNotes && notesOk });
    renderCard(item);
    dispatch('card_ready');
  }

  async function execDone() {
    // Spoken AND shown — the whole mode is ears-first (fire-and-forget: a missing
    // uiLang voice here must not wedge the done screen).
    const myGen = gen, mySeq = ++speakSeq;
    const r = await LearnTTS.speak(t('drive_done', '本轮听完了'), uiLang);
    if (myGen === gen && mySeq === speakSeq && r.ok) await (r.done || Promise.resolve());
  }

  async function cycleMode() {
    mode = LearnDriving.nextMode(mode);
    // Changing to/from 随机 re-derives the order, but never the CURRENT card: the
    // card that is playing keeps playing. Only what comes next changes.
    order = LearnDriving.buildOrder(deck.length, mode, Math.random);
    paint();
    try { await PageSettings.write({ drivePlaybackMode: mode }); } catch (_) {}
  }

  function exec(fx) {
    switch (fx.t) {
      case 'stop_tts': speakSeq++; LearnTTS.stop(); return;
      case 'speak': execSpeak(fx); return;
      case 'fetch_notes': execFetchNotes(); return;
      case 'advance': advance(!!fx.force); return;
      case 'mode_next': cycleMode(); return;
      case 'done': execDone(); return;
      case 'note': note(noteFor(fx.code)); return;
    }
  }

  function dispatch(ev, arg) {
    const r = LearnDriving.reduce(state, ev, arg, { plan });
    state = r.state;
    if (ev === 'tts_fail') state = Object.assign({}, state, { reasonCode: arg });
    for (const fx of r.effects) exec(fx);
    paint();
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────
  async function buildSession() {
    const [items, reviews] = await Promise.all([LearnStore.allItems(), LearnStore.allReviews()]);
    const now = Date.now();
    const full = LearnScheduler.buildDeck(items, now, schedCfg,
      LearnScheduler.introducedToday(reviews, now));
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
    order = LearnDriving.buildOrder(deck.length, mode, Math.random);
    pos = order.length ? order[0] : 0;
    return skipped;
  }

  async function start() {
    gen++;
    LearnTTS.stop();
    state = { name: 'idle' };
    applySettings(await loadSettings());
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
    openCard();
  }

  // Full stop: exit the session entirely (view switching is the app shell's).
  function stop() {
    gen++;
    dispatch('tap_stop');
    deck = [];
    order = [];
    state = { name: 'idle' };
  }

  // ─── Wiring (everything inside #app-drive) ────────────────────────────────
  function wire() {
    $('app-drive-pause').addEventListener('click', () => {
      dispatch(state.name === 'paused' || state.name === 'stopped_error' ? 'tap_resume' : 'tap_pause');
    });
    $('app-drive-next').addEventListener('click', () => dispatch('tap_next'));
    $('app-drive-repeat').addEventListener('click', () => dispatch('tap_repeat'));
    $('app-drive-mode').addEventListener('click', () => dispatch('tap_mode'));
    $('app-drive-more').addEventListener('click', () => { start(); });
    // A hidden app (lock, call, app switch) pauses: TTS stops. Resuming is always a
    // tap, never automatic — a car that starts talking again on its own is worse
    // than one that waits.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' && !$('app-drive').hidden) {
        dispatch('hidden');
      }
    });
  }

  function paintStatic() {
    $('app-drive-start').textContent = t('drive_entry', '驾车模式');
    $('app-drive-back').textContent = t('app_review_back', '← 返回');
    $('app-drive-title').textContent = t('drive_entry', '驾车模式');
    $('app-drive-next').textContent = t('drive_next', '⏭ 下一张');
    $('app-drive-repeat').textContent = t('drive_repeat', '🔁 再听一遍');
    $('app-drive-more').textContent = t('drive_restart', '再来一轮');
    $('app-drive-pause').textContent = t('drive_pause', '⏸ 暂停');
    $('app-drive-mode').textContent = modeLabel(mode);
  }

  // Test-only introspection (verify-learn-flow.js): the session's moving parts,
  // read-only. Not a public surface.
  function _debug() {
    return { state: state.name, seg: state.seg || 0, deck: deck.length, pos, mode,
      playNotes, notesOk, uiLang, order: order.slice() };
  }

  return { start, stop, wire, paintStatic, refreshEntry, _debug };
})();
