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
  let preloadDays = 0;       // §9.5 出发前预载的天数视野（设置页读写）
  let uiLang = 'zh-CN';
  let plan = { segments: [] };
  let notesText = '';        // rendered notes for the current card, if fetched
  // 解析切成的行（§9.5「解析跟读」）。逐行朗读用它，封面高亮也用它 —— **一处**，
  // 否则念的和亮的会是两回事。`notesActive` 是正在念的下标，-1 = 没在念解析。
  let notesLines = [];
  let notesActive = -1;
  // 当前卡的补译文（§9.5）。只读缓存 —— 播放途中永不现场翻译，见 openCard()。
  let filledTr = '';
  // 会话级的一句话（例如「开关开着但引擎没配」）。它必须由 paint() 渲染进**常驻行**：
  // 写进 #app-drive-note 会被 renderCard() 每张卡的 note('') 抹掉 —— 提示话音未落就没了。
  let sessionNote = '';
  // 「这个引擎/这台设备不能后台播」那句，与上面那句并列显示。**分成两个变量**，因为
  // 它是异步到达的（`session-ready` 晚于 start()），而把它拼进 sessionNote 之后再想
  // 更新，就只能靠匹配文案把自己从字符串里挖出来 —— 那种正则在翻译成十一种语言之后
  // 必然失效。两个变量，paint() 里拼。
  let bgNote = '';
  // Generation counters: `gen` invalidates every async continuation on session
  // start/stop; `speakSeq` invalidates a superseded utterance so an interrupted
  // speak's `done` can never advance the NEW state (the epoch discipline tts.js
  // uses internally); `notesSeq` does the same for an in-flight notes fetch, which
  // outlives the card that asked for it whenever the user taps 下一张.
  let gen = 0;
  let speakSeq = 0;
  let notesSeq = 0;
  // openCard 现在会 await 一次补译文缓存读，于是「读到一半用户按了下一张」变成了一个真
  // 窗口：没有这个计数器，先发起的那次 openCard 会在回来后把旧卡的 plan 盖上去。gen 挡
  // 不住它 —— gen 只在开始/停止时变，换卡不变。
  let cardSeq = 0;

  const SETTINGS_KEYS = [
    'uiLang', 'learnDailyNew',
    'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    // §9.5 — this mode's own knobs. All persist: a driver sets them once.
    // `drivePreloadDays` is the 出发前预载 horizon (0 = 今天的牌库).
    'drivePlaybackMode', 'drivePlayNotes', 'drivePreloadDays',
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
    // 补译文骑同一组引擎（§9.5 / §7.2）。播放中只读缓存，但预载要用它生成。
    LearnTranslateFill.configure(LearnTranslateFill.resolveConfig(s));
    preloadDays = Number(s.drivePreloadDays) > 0 ? Math.floor(Number(s.drivePreloadDays)) : 0;
    schedCfg = Object.assign({}, LearnScheduler.DEFAULTS, {
      dailyNew: Number(s.learnDailyNew) > 0 ? Number(s.learnDailyNew) : LearnScheduler.DEFAULTS.dailyNew,
    });
  }

  // ─── Entry gating (capability semantics: exists or doesn't, never disabled) ─
  // The entry button renders only when the session could actually speak.
  // Voices land asynchronously, so wait a moment.
  // 只管显隐与文案；点击归 app.js（它才拥有 openSettings）——
  // 一个视图不该去开另一个视图。
  function showNeedSpeech(on, reason) {
    const box = $('app-drive-need-tts');
    if (!box) return;
    box.hidden = !on;
    if (!on) return;
    $('app-drive-need-tts-why').textContent = ttsReason(reason);
    $('app-drive-need-tts-go').textContent = t('app_settings_link', '设置');
  }

  async function refreshEntry() {
    const btn = $('app-drive-start');
    if (!btn) return;
    try {
      const r = await loadSettings();
      if (!r.ok) { btn.hidden = true; return; }   // 读不到设置就不假装入口可用
      applySettings(r.data);
      const av = await LearnTTS.available(uiLang, 2000);
      btn.hidden = !av.ok;
      // 「没配过 / 差一个字段」是**有出路**的失败，要说出来并给路；
      // 「这台设备做不到」没有出路，不给假希望。两者共用 ttsReason 的文案。
      const FIXABLE = ['not_configured', 'no_base', 'no_key'];
      showNeedSpeech(!av.ok && FIXABLE.indexOf(av.reason) >= 0, av.reason);
    } catch (_) { btn.hidden = true; showNeedSpeech(false); }
  }

  // ─── Copy ─────────────────────────────────────────────────────────────────
  // TTS failure reasons reuse the SAME i18n keys review.js's reasonText maps —
  // one wording per failure across surfaces.
  function ttsReason(reason) {
    switch (reason) {
      case 'no_voice': return t('tts_no_voice', '系统里没有这门语言的语音');
      case 'no_voice_und': return t('tts_no_voice_und', '这张卡的语言未知 —— 在设置里选一个朗读语音后即可朗读');
      case 'not_configured': return t('tts_not_configured', '还没配语音引擎 —— 到「设置 › 语音」里选一个');
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
  // 判据在 LearnDriving 里（`PAUSED_LIKE`），因为锁屏的播放/暂停切换键要按同一个判据
  // 倒向 —— 两份定义会让遥控和屏幕按钮对同一个状态给出相反的动作。
  function pausedLike() { return LearnDriving.isPausedLike(state.name); }

  // ─── 后台播放（§9.5「后台与锁屏播放」）─────────────────────────────────
  // 判据只有一句：**这个宿主能不能在 App 不可见时继续出声。** 两个平台取值不同，
  // 但问的是同一件事：
  //   · macOS —— 进程不会被挂起，无条件成立（`suspends()` 为 false）。
  //   · iOS   —— 要两件事同时成立：音频会话真的建起来了（`ready()`，不是 `available()`
  //     ——「桥在」不等于 `setCategory` 成功了），且引擎产出**音频字节**（复用注册表里
  //     已有的 `returnsAudio`，不发明新标志）。
  //
  // 第二条**是保守的，不是已证实的**。原来的理由是「speechSynthesis 拿不到音频字节，
  // 所以也活不过后台」—— 2026-08-24 的模拟器实测把它推翻了一半：把这道门临时打开，
  // 设备内置语音在 iOS 17.2 模拟器上后台连播 240 秒、跨了 5 张卡。「拿不到字节」是
  // Web Speech API 的性质，「活不过后台」是我们的猜测，两件事原来被混成了一件。
  // 门先留着，是因为模拟器对后台挂起的执行比真机宽松得多 —— 那个绿是弱证据（反过来
  // 红才是强证据）。**真机复现就删掉这两行**，中国版没有云端语音的问题随之消失；
  // 真机相反就按 learning-design §9.5 的裁定做原生语音合成桥。证据在
  // docs/verification-spec.md 的尖刺表。
  function backgroundCapable() {
    if (!NativeAudio.ready()) return false;
    if (!NativeAudio.suspends()) return true;
    const e = LearnTTS.engine();
    return !!(e && e.returnsAudio);
  }

  // 后台不成立时那句常驻说明。**没有桥的宿主一个字都不说** —— 那里从来没有过后台播放
  // 的承诺，解释「为什么会停」是噪音。不存在的形态不解释，存在但受限的形态才解释。
  function backgroundNote() {
    if (!NativeAudio.available() || backgroundCapable()) return '';
    if (!NativeAudio.ready()) {
      return t('drive_bg_session_failed', '这台设备现在建不起后台音频会话，App 退到后台或锁屏后会暂停');
    }
    return t('drive_bg_needs_audio_engine',
      '设备内置语音在 App 退到后台或锁屏后会停下来；想放着听，请配一个语音端点（设置 → 语音引擎）');
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
    const standing = [sessionNote, bgNote].filter(Boolean);
    $('app-drive-cost').textContent = standing.length ? standing.join(' · ')
      : ((active && playNotes && notesOk)
        ? t('drive_notes_cost', '播放解析：没解析过的卡会调用你配置的解析引擎，每张卡只收一次费') : '');
    paintNowPlaying(active, pauseLike);
  }

  // 锁屏卡片 / 控制中心的三行字。这里而不是 openCard()，是因为**第几遍**只有 paint()
  // 知道 —— 段一走，锁屏上的那行进度就该跟着变。三个字段全部由这边传给原生，原生侧
  // 一个用户可见的字都不持有（同 notesToSpeech(notes, labels) 的纪律）。
  //
  // 去重在 NativeAudio 里按 payload 做：paint() 每次重绘都会走到这儿，而绝大多数重绘
  // 什么都没变，每一次过桥都是一次 evaluateJavaScript 往返。
  function paintNowPlaying(active, pauseLike) {
    if (!NativeAudio.mediaAvailable()) return;
    const item = deck[pos];
    NativeAudio.playingState(active && !pauseLike);
    if (!active || !item) return;
    // `passPrefix` 带一个尾部的「 · 」（它在状态行里是前缀），这里当后缀用，所以剥掉。
    const pass = passPrefix(state.seg || 0).replace(/\s*·\s*$/, '');
    const progress = $('app-drive-progress').textContent;
    NativeAudio.nowPlaying({
      title: item.text || '',
      subtitle: item.tr || filledTr || '',
      album: pass ? progress + ' · ' + pass : progress,
      index: Math.min(pos + 1, deck.length),
      count: deck.length,
    });
  }

  // 锁屏 / 灵动岛的封面（§9.5）。**换卡时一次**，不跟着 paint 走 —— 一张 1024² 的图
  // 每次重绘都过一趟桥是白烧。文案在这里算好传进去，画图那边不持有任何字。
  //
  // **封面上不放遍次。** 它是每张卡画一次的，而遍次在一张卡内会 1→2→3 地变；写上去
  // 就是在锁屏上挂一句几秒后就不成立的话。遍次归媒体控件那一行 —— 那行跟着段走，
  // 而且改它不花任何东西。封面只承载卡级为真的事实。
  function pushArtwork(item) {
    if (!item || !NativeAudio.mediaAvailable()) return;
    try {
      const url = NowPlayingArt.render({
        badge: t('drive_progress', '第 {i} / {n} 张')
          .replace('{i}', String(Math.min(pos + 1, deck.length))).replace('{n}', String(deck.length)),
        text: item.text || '',
        tr: item.tr || filledTr || '',
        notes: notesLines.length ? { lines: notesLines, active: notesActive } : null,
      });
      if (!url) return;
      // 逐行高亮走**不过桥**的那条（只更新 mediaSession 的 blob），卡级才过桥一次。
      // 一张 1024² PNG ≈123 KB，跟着每一行过桥就是白烧 —— 而 iOS 上锁屏读的正是
      // mediaSession，所以逐行完全够。过桥那一次是给 macOS 的。
      if (notesActive >= 0) {
        NativeAudio.artworkLocal(url);
      } else {
        // 卡级过桥。去重键带上「解析有没有铺上」：一张卡会推两次 —— 开卡一次，
        // 解析文本回来后再一次（封面从"没有解析"变成"三行压暗铺着"）。只按卡片 id
        // 去重的话，第二次会被自己的去重静默吃掉，锁屏上永远看不到解析区。
        NativeAudio.artwork(item.id + (notesLines.length ? ':n' : ''), url);
      }
    } catch (_) { /* 画不出封面绝不影响播放 */ }
  }

  function note(msg) { $('app-drive-note').textContent = msg || ''; }

  function renderCard(item) {
    $('app-drive-text').textContent = item ? item.text : '';
    // `filledTr` 是补译文缓存（§9.5）。它由 openCard 在建 plan 之前读好，所以这里
    // 显示的和 cardPlan 决定要不要播译句段的，永远是同一个事实。
    $('app-drive-tr').textContent = item ? (item.tr || filledTr || '') : '';
    $('app-drive-notes').textContent = '';
    notesText = '';
    notesLines = []; notesActive = -1;
    note('');
  }

  // ─── Effects ──────────────────────────────────────────────────────────────
  function speechFor(what, item, fx) {
    switch (what) {
      case 'source': return { text: item.text, lang: item.lang || '' };
      case 'tr': return { text: item.tr || filledTr || '', lang: item.targetLang || uiLang };
      // The notes text was rendered by the fetch effect and travels on the effect,
      // so the utterance can never disagree with what is shown.
      case 'notes': return { text: (fx && fx.text) || notesText, lang: uiLang };
      default: return { text: '', lang: uiLang };
    }
  }

  async function execSpeak(fx) {
    const myGen = gen, mySeq = ++speakSeq;
    const item = deck[pos];

    // ─── 解析段：逐行念，念到哪一行封面就高亮哪一行（§9.5「解析跟读」）──────────
    //
    // **状态机一个字都没改。** plan 里仍然只有一个 `notes` 段；「一段变三行」整个
    // 发生在这个函数内部，全部念完才 dispatch('tts_done')。让 plan 在解析文本回来时
    // 动态长出几段，就得引入一个新的可变性来源 —— 而那是这个模块最不该有的东西。
    if (fx.what === 'notes' && notesLines.length > 1) {
      for (let i = 0; i < notesLines.length; i++) {
        notesActive = i;
        pushArtwork(item);
        const r = await LearnTTS.speak(notesLines[i], uiLang);
        // 每行之间都要重新守一次：念到一半按了暂停 / 下一张，这个循环必须当场作废，
        // 而不是把已经被顶掉的会话继续往前推。
        if (myGen !== gen || mySeq !== speakSeq) return;
        if (!r.ok) {
          if (r.reason !== 'superseded') dispatch('tts_fail', r.reason);
          return;
        }
        await (r.done || Promise.resolve());
        if (myGen !== gen || mySeq !== speakSeq) return;
      }
      notesActive = -1;
      pushArtwork(item);
      dispatch('tts_done');
      return;
    }

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

  // 解析口播的三个标签。**一处** —— 预热合成的音频和正式那次朗读的文本必须逐字相同，
  // 否则预热的是另一段话，缓存永远打不中，用户还多付一次钱。
  function notesLabels() {
    return {
      words: t('drive_notes_words', '生词：'),
      phrases: t('drive_notes_phrases', '短语：'),
      grammar: t('drive_notes_grammar', '语法：'),
    };
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
    const labels = notesLabels();
    notesLines = LearnDriving.notesToLines(data, labels);
    const text = notesLines.join('。');
    notesText = text;
    $('app-drive-notes').textContent = text;
    dispatch('notes_ready', text);
  }

  // `src` says WHICH engine failed ('tts' | 'notes'), and it is load-bearing: the two
  // share reason codes. `no_base` means「地址没配好」for either of them, and without the
  // source a dead SPEECH endpoint was reported to the user as 「这张卡的解析没成功」——
  // a sentence about the wrong feature, pointing at the wrong settings block.
  // (Found 2026-08-23 on the iOS simulator, verifying §9.5 出发前预载.)
  function noteFor(code, src) {
    if (src === 'tts') {
      switch (code) {
        case 'no_voice':
        case 'no_voice_und': return t('drive_skip_card', '这张卡读不出来，已跳到下一张');
        case 'no_base':
        case 'no_key': return t('drive_tts_not_configured',
          '语音引擎还没配置好，这一轮读不出声（设置 → 语音引擎）');
        case 'blocked': return t('drive_tts_blocked', '系统拦下了自动播放，点一下继续');
        case 'not_configured': return t('tts_not_configured', '还没配语音引擎 —— 到「设置 › 语音」里选一个');
        case 'unsupported': return t('drive_tts_unsupported', '这台设备上没有可用的语音引擎');
        default: return t('drive_tts_unreachable',
          '连不上语音引擎，这一轮读不出声。已经预载过的卡才能离线播放（设置 → 预载离线资源）');
      }
    }
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

  // 开卡：把这张卡需要联网的东西**一次性并行发出**（§9.5 开卡并行预热）。
  //
  // 从前这里只预取解析，于是一张卡三遍五段里还剩四个网络往返落在段与段之间的静默里 ——
  // 听起来就是「读一句、停一下、再读一句」。现在原句/译句/解析同时出发，解析文本一回来
  // 立刻把它的音频也预热掉（这一段是旧写法救不到的：文本要等 API 回来才知道）。
  //
  // async，但**调用方一律不 await**：`card_ready` 必须立刻派发，让第一段音频照常开播 ——
  // 预热是给后面几段用的，不是给第一段加一道闸。
  async function openCard() {
    const item = deck[pos];
    if (!item) { dispatch('deck_done'); return; }
    const myGen = gen, mySeq = ++cardSeq;
    const stale = () => myGen !== gen || mySeq !== cardSeq;
    // 补译文只读缓存，绝不现场翻译（§9.5）：行驶中不制造用户看不见的账单，也不让
    // 播放器停在一个网络往返上。生成只发生在设置页的「出发前预载」里。
    let tr = '';
    if (!item.tr) {
      try {
        const hit = await LearnTranslateFill.cached(item.id);
        if (stale()) return;                       // 期间已经换卡/退出
        tr = (hit && hit.data) || '';
      } catch (_) { tr = ''; }
    }
    if (stale()) return;
    filledTr = tr;
    plan = LearnDriving.cardPlan(item, {
      playNotes: playNotes && notesOk,
      hasTr: !!(item.tr || filledTr),
    });
    renderCard(item);
    pushArtwork(item);
    warmCard(item, myGen, mySeq);
    warmNext(myGen, mySeq);
    dispatch('card_ready');
  }

  // 这张卡的全部段落，并行预热。全部 fire-and-forget：预热失败没有任何后果，正式那次
  // 会自己具名处理；受 `gen` 保护，退出会话后回来的结果一律丢弃。
  //
  // **不会重复扣费**：解析按 item.id 在 notes.js 去重，音频按 cacheKey 在 tts.js 去重
  // （2026-08-23 加的 in-flight map）—— 预热在途、播放就轮到了，两条路拿到同一个 promise。
  function warmCard(item, myGen, mySeq) {
    const warm = (text, lang) => {
      if (!text) return;
      try { Promise.resolve(LearnTTS.prefetch(text, lang)).catch(() => {}); } catch (_) {}
    };
    warm(item.text, item.lang || '');
    warm(item.tr || filledTr, item.targetLang || uiLang);
    if (!(playNotes && notesOk)) return;
    try {
      LearnNotes.get(item, uiLang).then((r) => {
        if (myGen !== gen || mySeq !== cardSeq) return;
        // 解析的音频只能等文本回来才知道要合成什么 —— 这就是旧的「解析预取」救不到的
        // 那个空档。渲染文案与 execFetchNotes 用的是同一份标签，两处不会说不一样的话。
        // 逐行预热，不是整段 —— 播放也是逐行的（§9.5「解析跟读」），两处必须枚举
        // 同一批文本，否则预热的是另一段话，缓存永远打不中而用户多付一次钱。
        const lines = LearnDriving.notesToLines(r && r.data, notesLabels());
        for (const line of lines) warm(line, uiLang);
        // **开卡就把解析铺到封面上（压暗），不等念到那一段。** 否则锁屏在前两遍是
        // 「没有解析」、到第四段突然多出一块，整个版式跳一下 —— 而歌词的形状本来就是
        // 「后面几句你先看得见，念到才点亮」。这里只填内容，高亮仍由 execSpeak 推进。
        if (lines.length && !notesLines.length) {
          notesLines = lines;
          notesActive = -1;
          pushArtwork(item);
        }
      }).catch(() => {});
    } catch (_) {}
  }

  // 再往前看一张，只预热音频、不碰解析：音频迟早要合成（合成过就在缓存里），而用户随时
  // 可能退出，为一张没听到的卡付一次解析钱是不该发生的。
  //
  // 用 `peekNext` 而不是 `advance`：后者会重洗牌、会消耗随机数，拿它「看一眼」等于提前
  // 把随机序列走掉。随机/循环走到需要重洗的边界时 peekNext 返回 null —— 那时下一张是谁
  // 还没定，预热一个猜测就是白花钱。
  function warmNext(myGen, mySeq) {
    const at = LearnDriving.peekNext(pos, order, mode);
    if (at === null || at === pos) return;
    const nxt = deck[at];
    if (!nxt) return;
    const warm = (text, lang) => {
      if (!text) return;
      try { Promise.resolve(LearnTTS.prefetch(text, lang)).catch(() => {}); } catch (_) {}
    };
    warm(nxt.text, nxt.lang || '');
    if (nxt.tr) { warm(nxt.tr, nxt.targetLang || uiLang); return; }
    // 没有 `tr` 的卡：只有已经预载过补译文才有东西可预热，同样绝不现场翻译。
    LearnTranslateFill.cached(nxt.id).then((hit) => {
      if (myGen !== gen || mySeq !== cardSeq || !hit || !hit.data) return;
      warm(hit.data, nxt.targetLang || uiLang);
    }).catch(() => {});
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
      case 'note': note(noteFor(fx.code, fx.src)); return;
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
  // 牌库 → 真的听得出声的那些卡。**一份**，会话与预载共用：两条路要是各自过滤一遍，
  // 预载就会去合成一批会话根本不播的卡（或者漏掉会播的），而这种不一致在真机上表现为
  // 「明明预载过了，路上还是要联网」。
  //
  // Media cards never enter (synthetic speech never replaces real speech, §11);
  // cards whose language — either side — has no voice are skipped too, COUNTED,
  // never silently (no silent caps).
  async function speakableDeck(full) {
    const voiceOk = new Map();
    // **把文本一起交出去。** 语言未知（Safari 采的卡全是 'und'）时，LearnTTS 会按
    // 文本的主导脚本挑音色；不给文本它只能返回「读不了」，而那意味着 iOS 上一张都
    // 播不了（2026-09-02 真机：4 张卡全跳过，一轮瞬间结束）。
    // 缓存键要带上脚本判断的输入，否则第一张 und 卡的结论会盖住所有 und 卡 ——
    // 而它们的脚本可能各不相同。已知语言仍按语言缓存，一次问答走遍全牌库。
    const can = async (lang, text) => {
      const base = String(lang || '').toLowerCase().split('-')[0];
      const known = base && base !== 'und';
      const k = known ? base : 'und:' + (LearnTTS.scriptLang ? LearnTTS.scriptLang(text) : '');
      if (!voiceOk.has(k)) voiceOk.set(k, (await LearnTTS.available(lang, undefined, text)).ok);
      return voiceOk.get(k);
    };
    const out = [];
    // 两个原因分开数。「媒体卡」和「没有能读它的音色」对用户是完全不同的两件事：
    // 前者无解（那张卡是视频字幕的锚点），后者去设置里配个语音引擎就好了。
    // 合成一句「读不出来的卡（媒体卡或无语音）」等于让他猜自己该做什么。
    let media = 0; let noVoice = 0;
    for (const it of full) {
      if (it.anchor && it.anchor.k === 'media') { media += 1; continue; }
      // eslint-disable-next-line no-await-in-loop
      const srcOk = await can(it.lang, it.text);
      // eslint-disable-next-line no-await-in-loop
      const trOk = !it.tr || await can(it.targetLang || uiLang, it.tr);
      if (!srcOk || !trOk) { noVoice += 1; continue; }
      out.push(it);
    }
    return { deck: out, skipped: media + noVoice, media, noVoice };
  }

  async function buildSession() {
    const [items, reviews] = await Promise.all([LearnStore.allItems(), LearnStore.allReviews()]);
    const now = Date.now();
    const full = LearnScheduler.buildDeck(items, now, schedCfg,
      LearnScheduler.introducedToday(reviews, now));
    const r = await speakableDeck(full);
    deck = r.deck;
    order = LearnDriving.buildOrder(deck.length, mode, Math.random);
    pos = order.length ? order[0] : 0;
    return { media: r.media, noVoice: r.noVoice };
  }

  // ─── 出发前预载（§9.5）────────────────────────────────────────────────────
  //
  // §9.2 修订后「允许的批量」的唯一实例，四个构成要件在这两个函数里各占一半：
  // `preloadPlan` 只算账不花钱（**只读缓存，一个请求都不发**），`preloadRun` 才花钱，
  // 可停，结束报账。设置页负责把这两步接成「点一下看账单、点第二下开跑」。
  //
  // 它仍然什么都不写进学习记录：只填缓存，不产生复习行、不盖技能戳、不动 lastSeenAt。

  // 一张卡要合成的全部文本。原句在三遍里出现三次，但那是**同一个缓存键**，所以只算一段。
  //
  // 解析**按行**枚举（§9.5「解析跟读」）：播放已经是逐行的，预载要是还按整段算，
  // 路上每张卡都会在解析那几行上现场发请求 —— 直接打破「预载完整轮零请求」。
  function segmentsOf(item, tr, notesLineList) {
    const segs = [{ text: item.text, lang: item.lang || '' }];
    if (tr) segs.push({ text: tr, lang: item.targetLang || uiLang });
    for (const line of notesLineList || []) segs.push({ text: line, lang: uiLang });
    return segs.filter((x) => x.text);
  }

  // 会话结束那一句「本轮听完了」也要预载。它不属于任何一张卡，所以逐卡遍历天然漏掉它 ——
  // 于是一整轮离线播放会在最后一句上突然发一个网络请求。整轮零请求是这个功能的定义，
  // 「除了最后一句」不是。（这一条是 10f 的王冠断言逼出来的。）
  function tailSegment() {
    return { text: t('drive_done', '本轮听完了'), lang: uiLang };
  }

  async function audioCached(text, lang) {
    try {
      const hit = await LearnStore.getAudio(LearnTTS.cacheKey(text, lang));
      return !!(hit && hit.buf && hit.buf.byteLength);
    } catch (_) { return false; }
  }

  // 算账。只读缓存 —— 断言「这一步零请求」是 10f 的核心用例。
  async function preloadPlan(days) {
    const read = await loadSettings();
    if (!read.ok) return { ok: false, reason: 'settings' };
    applySettings(read.data);
    const n = (days === undefined || days === null) ? preloadDays : days;

    const [items, reviews] = await Promise.all([LearnStore.allItems(), LearnStore.allReviews()]);
    const now = Date.now();
    const full = LearnScheduler.buildDeckAhead(items, now, schedCfg,
      LearnScheduler.introducedToday(reviews, now), n);
    const r = await speakableDeck(full);

    const e = LearnTTS.engine();
    // 设备内置语音拿不到音频字节（§9.1）—— 它本来就离线可用。账单必须如实这么说，
    // 而不是显示一个永远是 0 的音频进度条。
    const audioCacheable = !!(e && e.returnsAudio);
    // 语音引擎配坏了（缺地址 / 缺 key）会让每一段合成都失败。不在账单上先说，用户就会
    // 点下确认、等一分钟，然后收到一整屏具名失败 —— 那些字都是对的，只是来晚了。
    const av = audioCacheable ? await LearnTTS.available(uiLang) : { ok: true };
    const wantNotes = playNotes && notesOk;
    const canFill = LearnTranslateFill.capable();

    const cards = [];
    let audioMissing = 0, notesMissing = 0, trMissing = 0;
    for (const it of r.deck) {
      const hitTr = it.tr ? null : await LearnTranslateFill.cached(it.id);
      const tr = it.tr || (hitTr && hitTr.data) || '';
      const needTr = !it.tr && !tr && canFill;
      if (needTr) trMissing++;

      const hitNotes = wantNotes ? await LearnNotes.cached(it.id) : null;
      const notesLineList = hitNotes ? LearnDriving.notesToLines(hitNotes.data, notesLabels()) : [];
      const needNotes = wantNotes && !hitNotes;
      if (needNotes) notesMissing++;

      let missing = 0;
      if (audioCacheable) {
        for (const seg of segmentsOf(it, tr, notesLineList)) {
          if (!(await audioCached(seg.text, seg.lang))) missing++;
        }
        // 还没生成的译文/解析，它们的音频也还不存在 —— 计入待合成，否则账单会少报。
        //
        // 解析按**上界**估：它会切成生词/短语/语法三行，而这张卡到底有几行要等文本
        // 回来才知道 —— 算账那一刻不可知。按 3 估是**多报**，而账单宁可多报不可少报：
        // 少报会让用户在路上撞见没预载到的请求。（这也是当初选「按三块切」而不是
        // 「按句切」的决定性理由：按句切的话连上界都给不出来。）
        if (needTr) missing++;
        if (needNotes) missing += LearnDriving.NOTE_LINES_MAX;
      }
      audioMissing += missing;
      cards.push({ item: it, tr, needTr, needNotes, notesLineList });
    }

    const tail = tailSegment();
    const tailMissing = !!(audioCacheable && cards.length && tail.text
      && !(await audioCached(tail.text, tail.lang)));
    if (tailMissing) audioMissing++;

    return {
      ok: true, days: n, cards, skipped: r.skipped, tailMissing,
      audioCacheable, audioMissing, notesMissing, trMissing,
      engineReady: !!av.ok, engineReason: av.ok ? '' : (av.reason || 'unsupported'),
      // 用户明确开着「播放解析」却没配引擎，绝不能默默把这些卡从计划里删掉 ——
      // build 38 的教训（§9.5），10d′ 的同型用例。
      notesBlocked: playNotes && !notesOk,
      fillBlocked: !canFill,
    };
  }

  // 花钱那一步。并发上限 4：串行太慢（一副 20 张的牌要几分钟），无上限会撞供应商限流。
  // `shouldStop()` 每张卡之间问一次 —— 停止是即时的语义，但不撕毁已经在途的请求。
  async function preloadRun(plan, opts) {
    const o = opts || {};
    const onProgress = o.onProgress || (() => {});
    const shouldStop = o.shouldStop || (() => false);
    const total = plan.cards.length;
    const failures = new Map();   // reason → count
    let done = 0, stopped = false;

    const fail = (reason) => failures.set(reason, (failures.get(reason) || 0) + 1);

    const one = async (c) => {
      let tr = c.tr;
      if (c.needTr) {
        try {
          const r = await LearnTranslateFill.get(c.item, c.item.targetLang || uiLang);
          tr = r.tr;
        } catch (err) { fail((err && err.code) || 'translate_failed'); }
      }
      let notesLineList = c.notesLineList;
      if (c.needNotes) {
        try {
          const r = await LearnNotes.get(c.item, uiLang);
          notesLineList = LearnDriving.notesToLines(r && r.data, notesLabels());
        } catch (err) { fail((err && err.code) || 'notes_failed'); }
      }
      if (!plan.audioCacheable) return;
      for (const seg of segmentsOf(c.item, tr, notesLineList)) {
        if (shouldStop()) return;
        const r = await LearnTTS.prefetch(seg.text, seg.lang);
        // `not_cacheable` 在这里不是失败：调用方已经知道这台机器不产生音频缓存。
        if (!r.ok && r.reason !== 'not_cacheable') fail(r.reason || 'http');
      }
    };

    if (plan.tailMissing) {
      const tail = tailSegment();
      const tr = await LearnTTS.prefetch(tail.text, tail.lang);
      if (!tr.ok && tr.reason !== 'not_cacheable') fail(tr.reason || 'http');
    }

    const queue = plan.cards.slice();
    const worker = async () => {
      for (;;) {
        if (shouldStop()) { stopped = true; return; }
        const c = queue.shift();
        if (!c) return;
        try { await one(c); } catch (_) { fail('unknown'); }
        done++;
        onProgress({ done, total });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { done, total, stopped, failures: Array.from(failures.entries()).map(([r, n]) => ({ reason: r, n })) };
  }

  async function start() {
    gen++;
    LearnTTS.stop();
    // 先要会话，再算 sessionNote —— `session-ready` 是异步回来的，但 `backgroundNote()`
    // 只有在 applySettings 之后才知道用的是哪个引擎，两者的顺序在 start() 里是对的：
    // 请求发在最前面，读结果发生在下面几个 await 之后。
    NativeAudio.sessionStart();
    state = { name: 'idle' };
    sessionNote = '';
    bgNote = '';
    filledTr = '';
    const read = await loadSettings();
    if (!read.ok) {
      // 读失败绝不降级成「全用默认值」——那会把用户配好的引擎悄悄换掉。
      state = { name: 'session_done' };
      paint();
      $('app-drive-status').textContent = t('settings_read_failed_short', '读不到已保存的设置，请稍后再试');
      return;
    }
    applySettings(read.data);
    const skip = await buildSession();
    renderCard(null);
    // 开关开着、引擎没配 ⇒ 说一次，会话级，不是每张卡。这不是「能力语义下的形态不
    // 存在」——用户**明确打开了一个开关**，什么都不发生就必须给出理由，而且要点名去哪配。
    // 真机 build 38 上这条路径静默无声，表现得和功能没做一模一样。
    sessionNote = (playNotes && !notesOk)
      ? t('drive_notes_engine_missing', '「播放解析」需要先在设置里配好解析引擎（设置 → 句子解析）')
      : '';
    bgNote = backgroundNote();
    // 两个原因各说各的，并且「没音色」那一支要说得出**去哪儿解决**。
    if (skip.media) {
      note(t('drive_skipped_media', '跳过 {n} 张视频字幕卡 —— 它们没有可朗读的正文')
        .replace('{n}', String(skip.media)));
    }
    if (skip.noVoice) {
      note(t('drive_skipped_voice', '跳过 {n} 张：这台设备上没有能读它们的语音。到设置 → 语音引擎里配一个，或换一个系统音色。')
        .replace('{n}', String(skip.noVoice)));
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
    // 会话结束就把「正在播放」收掉。留着它等于在锁屏上放一张点了没反应的幽灵卡片，
    // 而且会一直占着系统的 Now Playing 位置。
    NativeAudio.sessionStop();
    deck = [];
    order = [];
    filledTr = '';
    state = { name: 'idle' };
  }

  // ─── Wiring (everything inside #app-drive) ────────────────────────────────
  function wire() {
    $('app-drive-pause').addEventListener('click', togglePlayPause);
    $('app-drive-next').addEventListener('click', () => dispatch('tap_next'));
    $('app-drive-repeat').addEventListener('click', () => dispatch('tap_repeat'));
    $('app-drive-mode').addEventListener('click', () => dispatch('tap_mode'));
    $('app-drive-explain').addEventListener('click', () => dispatch('tap_explain'));
    $('app-drive-more').addEventListener('click', () => { start(); });

    // 锁屏 / 车机 / 耳机 / macOS 媒体键。映射是纯的（LearnDriving.nativeEvent），
    // 派发的是**和屏幕按钮同一批**事件 —— 状态机因此一个新事件都没长。
    NativeAudio.onEvent((msg) => {
      // 会话已经结束但系统的「正在播放」还没被收掉，是一个真实存在的窗口。那时按下的
      // 遥控键不该把一个已经退出的会话弄活过来。
      if ($('app-drive').hidden || state.name === 'idle') return;
      const ev = LearnDriving.nativeEvent(msg, state.name);
      if (ev) dispatch(ev);
      // 会话建起来 / 建不起来都会改变那句常驻说明该不该出现（`session-ready` 是异步
      // 回来的，可能晚于 start() 里算 sessionNote 的那一刻）。
      if (msg && (msg.type === 'session-ready' || msg.type === 'session-failed')) refreshBgNote();
    });

    // **隐藏不再等于暂停（§9.5「后台与锁屏播放」）。** 后台能力成立时什么都不做，
    // 继续播 —— 把手机塞回口袋、屏幕黑掉，正是「架在支架上听」的常态，不是中断。
    // 不成立时才照旧暂停，并且**说出是哪一条不成立**（sessionNote 里那行）。
    //
    // 原来这里的理由是「一辆自己重新开口说话的车比一辆等着的更糟」。那句话没有错，
    // 错的是它的前提：「隐藏 = 用户走开了」。有了后台播放之后这个前提不成立，所以规约
    // 缩窄到了它真正想防的那件事上 —— 一次**真正的中断**（来电、被别的 App 抢走音频）
    // 之后不得自作主张地重新开口，那条走 LearnDriving.nativeEvent 的 interrupt 分支。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') return;
      if ($('app-drive').hidden) return;
      if (backgroundCapable()) return;
      dispatch('hidden');
    });

    // 页面要走了：收掉锁屏卡片。留一张点了没反应的幽灵卡片比没有更糟。
    window.addEventListener('pagehide', () => { NativeAudio.sessionStop(); });
  }

  // 屏幕上那个 ⏸/▶ 和锁屏上的播放/暂停切换键共用它 —— 两处各写一次三元判断，
  // 迟早会对同一个状态给出相反的动作。
  function togglePlayPause() {
    dispatch(pausedLike() ? 'tap_resume' : 'tap_pause');
  }

  // 常驻行由 paint() 重绘，所以改的是变量不是元素。
  function refreshBgNote() { bgNote = backgroundNote(); paint(); }

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
      // 解析跟读（§9.5）：正在念第几行、一共几行。真机/模拟器上一段音频可能几秒就播完，
      // 靠连拍截图去撞那一帧是碰运气 —— 读这两个数才是确定的。
      notesLines: notesLines.length, notesActive,
      playNotes, notesOk, uiLang, order: order.slice(),
      // §9.5 后台播放。`bg` 是判据本身，`bridge` 是它的两个输入 —— 真机上「为什么退到
      // 后台还是停了」只有分开看这三个数才回答得了。
      bg: backgroundCapable(),
      bridge: { available: NativeAudio.available(), ready: NativeAudio.ready(),
        platform: NativeAudio.platform(), suspends: NativeAudio.suspends(),
        artSizes: NativeAudio.artSizes(),
        mediaActions: NativeAudio.mediaActions() } };
  }

  return { start, stop, wire, paintStatic, refreshEntry, preloadPlan, preloadRun, _debug };
})();
