// app/driving.js — 播客模式 (podcast mode) orchestrator (§9.5, interaction-spec 「播客模式」).
//
// ─── 名字：用户看到的是「播客模式」，代码里仍叫 drive/driving ────────────────
// 2026-08-18 改的只是**产品名**。标识符没跟着改，是权衡后的结果，不是偷懒：
//   · `drivePlaybackMode` / `drivePlayNotes` 是**已经落在用户设备上的存储键**。改名
//     等于再来一次迁移，而收益是零 —— 用户永远看不到键名。
//   · 这个仓库里 `podcast` 已经有主了：`content/content-podcast.js` 是扩展在播客网站上
//     的字幕翻译。把学习层这个模块也叫 podcast，两个不同的东西就会在代码里同名。
// 要读的人记住一件事就够：**drive* = 播客模式**。
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
  // 会话级的一句话（例如「开关开着但引擎没配」）。它必须由 paint() 渲染进**常驻行**：
  // 写进 #app-drive-note 会被 renderCard() 每张卡的 note('') 抹掉 —— 提示话音未落就没了。
  let sessionNote = '';
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
    'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    // §9.5 — this mode's own two knobs. Both persist: a driver sets them once.
    'drivePlaybackMode', 'drivePlayNotes',
  ];

  // Returns { ok, data }. The `ok` is NOT decoration: `page-settings.js`'s whole
  // contract is that a FAILED read is not an empty profile, and this used to throw
  // that away — a storage failure came back as "every setting is at its default",
  // which is exactly the 2026-08-05 incident shape (settings appearing to revert).
  // A driving session started on defaults would silently drop the user's engine, so
  // the caller refuses to start instead.
  function loadSettings() {
    return PageSettings.read(SETTINGS_KEYS);
  }

  function applySettings(s) {
    uiLang = s.uiLang && s.uiLang !== 'auto' ? s.uiLang : (navigator.language || 'zh-CN');
    mode = LearnDriving.MODES.indexOf(s.drivePlaybackMode) >= 0
      ? s.drivePlaybackMode : LearnDriving.DEFAULT_MODE;
    // `!== false`，不是 `=== true`：默认开，且**不需要往存储里播种默认值** ——
    // 老装机（键不存在）与新装机因此行为一致。
    playNotes = s.drivePlayNotes !== false;
    // Defensive reconfigure — review.js configured these at bundle load, but the
    // user may have changed settings since; configure() is cheap and idempotent.
    LearnTTS.configure({
      engineId: s.ttsEngine || LearnTTS.DEFAULTS.engineId,
      baseUrl: s.ttsBaseUrl || '',
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
      const r = await loadSettings();
      if (!r.ok) { btn.hidden = true; return; }   // 读不到设置就不假装入口可用
      applySettings(r.data);
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

  // 段带着 pass 就是为了这一行：摊平之后，界面无法从 `what` 区分「第一遍的原句」和
  // 「第三遍的原句」，而听的人需要知道自己在第几遍。
  function passPrefix(seg) {
    const s = (plan.segments || [])[seg];
    if (!s || !s.pass) return '';
    return t('drive_pass', '第 {i} 遍').replace('{i}', String(s.pass)) + ' · ';
  }

  function statusText() {
    switch (state.name) {
      case 'speaking': {
        const seg = state.seg || 0;
        const s = (plan.segments || [])[seg] || {};
        const body = s.what === 'tr' ? t('drive_status_tr', '播放译文…')
          : s.what === 'notes' ? t('drive_status_notes', '播放解析…')
          : t('drive_status_source', '播放原文…');
        return passPrefix(seg) + body;
      }
      case 'fetching_notes': return passPrefix(state.seg || 0) + t('drive_status_parsing', '正在解析这一句…');
      case 'explain_fetch': return t('drive_status_explaining', '正在解析…');
      case 'explain_speak': return t('drive_status_notes', '播放解析…');
      case 'paused': return t('drive_status_paused', '已暂停');
      case 'stopped_error': return ttsReason(state.reasonCode);
      case 'session_done': return t('drive_done', '本轮听完了');
      default: return '';
    }
  }

  // 按需解析这两个态在**用户看来仍然是暂停中**（他没点继续），所以按钮显隐按暂停处理。
  function pausedLike() {
    return state.name === 'paused' || state.name === 'stopped_error'
      || state.name === 'explain_fetch' || state.name === 'explain_speak';
  }

  // ─── View ─────────────────────────────────────────────────────────────────
  function paint() {
    const active = state.name !== 'idle' && state.name !== 'session_done';
    const pauseLike = pausedLike();
    $('app-drive-pause').textContent = pauseLike
      ? t('drive_resume', '▶ 继续') : t('drive_pause', '⏸ 暂停');
    // 「解析这句」只在暂停时出现，且只在解析引擎可用时出现（能力语义）。引擎不可用时
    // 它不存在 —— 但**为什么不存在**由 sessionNote() 那行说出来，而不是留一个空位。
    $('app-drive-explain').hidden = !(pauseLike && notesOk);
    $('app-drive-explain').disabled = state.name === 'explain_fetch' || state.name === 'explain_speak';
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
    // 常驻行：会话级说明优先于费用提示 —— 「引擎没配」比「会花钱」更该先被看到。
    $('app-drive-cost').textContent = sessionNote || ((active && playNotes && notesOk)
      ? t('drive_notes_cost', '播放解析：没解析过的卡会调用你配置的解析引擎，每张卡只收一次费') : '');
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
    // 具名，不是静默成功。这里原本 dispatch 一个空串（= 悄悄跳过这一段），于是
    // 「开了播放解析但没配解析引擎」在整个 App 里没有一个字告诉用户发生了什么 ——
    // 真机上表现得和功能没做完全一样。走 notes_fail 之后，它至少会说话。
    if (!item) { dispatch('notes_fail', 'notes_failed'); return; }
    if (!notesOk) { dispatch('notes_fail', 'no_engine'); return; }
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
      case 'no_engine': return t('drive_notes_engine_missing',
        '「播放解析」需要先在设置里配好解析引擎（设置 → 句子解析）');
      case 'notes_empty': return t('drive_notes_empty', '这张卡没有可播的解析');
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
    // 预取解析：三遍结构白送的一个改进。走到第二遍的解析段才发起请求，会在
    // 「原句 → 译句 → ★几秒静默★ → 解析」中间留一个听起来像卡住的空档；开卡就发起，
    // 通常等走到那一段时已经在手。**不会重复扣费**：notes.js 的 inflight map 按
    // item.id 去重，两次调用拿到的是同一个 promise。失败留给正式那次去具名处理。
    if (playNotes && notesOk) {
      try { LearnNotes.get(item, uiLang).catch(() => {}); } catch (_) {}
    }
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
    sessionNote = '';
    const read = await loadSettings();
    if (!read.ok) {
      // 读失败绝不降级成「全用默认值」——那会把用户配好的引擎悄悄换掉。
      state = { name: 'session_done' };
      paint();
      $('app-drive-status').textContent = t('settings_read_failed_short', '读不到已保存的设置，请稍后再试');
      return;
    }
    applySettings(read.data);
    const skipped = await buildSession();
    renderCard(null);
    // 开关开着、引擎没配 ⇒ 说一次，会话级，不是每张卡。这不是「能力语义下的形态不
    // 存在」——用户**明确打开了一个开关**，什么都不发生就必须给出理由，而且要点名去哪配。
    // 真机 build 38 上这条路径静默无声，表现得和功能没做一模一样。
    sessionNote = (playNotes && !notesOk)
      ? t('drive_notes_engine_missing', '「播放解析」需要先在设置里配好解析引擎（设置 → 句子解析）')
      : '';
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
    $('app-drive-explain').addEventListener('click', () => dispatch('tap_explain'));
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
    $('app-drive-start').textContent = t('drive_entry', '播客模式');
    $('app-drive-back').textContent = t('app_review_back', '← 返回');
    $('app-drive-title').textContent = t('drive_entry', '播客模式');
    $('app-drive-next').textContent = t('drive_next', '⏭ 下一张');
    $('app-drive-repeat').textContent = t('drive_repeat', '🔁 再听一遍');
    $('app-drive-more').textContent = t('drive_restart', '再来一轮');
    $('app-drive-pause').textContent = t('drive_pause', '⏸ 暂停');
    $('app-drive-mode').textContent = modeLabel(mode);
    $('app-drive-explain').textContent = t('drive_explain', '🔍 解析这句');
  }

  // Test-only introspection (verify-learn-flow.js): the session's moving parts,
  // read-only. Not a public surface.
  function _debug() {
    const cur = (plan.segments || [])[state.seg || 0] || {};
    return { state: state.name, seg: state.seg || 0, pass: cur.pass || 0,
      segments: (plan.segments || []).map((x) => x.what + x.pass),
      deck: deck.length, pos, mode,
      playNotes, notesOk, uiLang, order: order.slice() };
  }

  return { start, stop, wire, paintStatic, refreshEntry, _debug };
})();
