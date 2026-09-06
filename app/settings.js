// app/settings.js — the learning layer's own settings, in the app.
//
// Scope is plan §F's split, not "everything the extension has": the app owns the
// REVIEW loop's knobs, the account, the corpus — and, per learning-design §7.2's
// 2026-08-08 amendment, ONE device-local credential: a chat engine + key used
// solely for sentence notes (§9.2). The app still never translates and never
// captures; the key never syncs (it is not in any chunk), and it lives in this
// device's localStorage in plaintext — the same standing as the extension's own
// key storage, which the wording below must not claim to improve on.
//
// Reads and writes through the SAME `chrome.storage.local` keys `review.js` and
// `tts.js` read (via the shim's localStorage backing), so there is no second settings
// model to drift — changing a value here changes what those modules see next time
// they read, with no plumbing in between.

var AppSettings = (() => {
  const $ = (id) => document.getElementById(id);

  // Same i18n as everything else (interaction-spec 「界面语言」: no hardcoded copy).
  // Chinese literals below are FALLBACKS beside their keys, never the only copy.
  const t = (k, fb) => PageI18n.t(k, fb);

  // The keys `review.js` and `tts.js` actually read (review.js:28-29). Named here so
  // a rename over there fails loudly at the next read rather than silently reverting
  // a user's setting to a default.
  const KEYS = ['learnEnabled', 'learnDailyNew', 'learnRules', 'uiLang',
    'ttsMode', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsAutoPlay', 'ttsRate',
    // §9.2 — the notes gate reads these (review.js:35). Same keys, same storage.
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    // §9.4 — the transcription group review.js reads. Device-local (§7.2).
    'sttEngine', 'sttBaseUrl', 'sttApiKey', 'sttModel',
    // 「地址按新语义存的」的戳，每个地址字段一个（content/wire-format.js）。
    // §9.5 播客模式。播放顺序由播放器里的按钮改，这里只管要花钱的那个开关，
    // 以及出发前预载的天数视野（`drivePreloadDays`，0 = 今天的牌库）。
    'drivePlayNotes', 'drivePreloadDays'];

  function get(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function set(items) {
    return new Promise((res) => chrome.storage.local.set(items, res));
  }

  // `learnEnabled` 被强制打开，因为「有没有材料来源」在 App 上确实为真：材料经同步
  // 进来，浏览器的采集开关不归这个面管。
  //
  // ⚠️ 2026-08-28 更正：这里原本写着它「gates」复习页那句「去设置里打开采集」。
  // 它不 gate —— review.js 全文只有存储键列表那一处提到 learnEnabled，空态分支
  // 根本不读它，所以那句错话是**无条件**显示的。真正的修复在 app.js 的
  // paintAppEmptyState()：把空态换成 App 自己的说法。这个 flag 与那件事无关。
  async function ensureDefaults() {
    const cur = await get(KEYS);
    const patch = {};
    if (cur.learnEnabled !== true) patch.learnEnabled = true;
    if (typeof cur.learnDailyNew !== 'number') patch.learnDailyNew = 15;
    // 坏值修复落到 **'off'**，不是 'assist'（2026-09-04）：语音要用户先配引擎才有，
    // 修一个坏值不该顺手把功能打开。chrome-shim 那边同步播种的那一段已经删掉了。
    if (['off', 'assist', 'audio-first'].indexOf(cur.ttsMode) < 0) patch.ttsMode = 'off';
    if (typeof cur.ttsAutoPlay !== 'boolean') patch.ttsAutoPlay = false;
    if (typeof cur.ttsRate !== 'number') patch.ttsRate = 1;
    if (Object.keys(patch).length) await set(patch);
  }

  function paintStatic() {
    $('settings-title').textContent = t('app_set_title', '设置');
    $('mode-quick').textContent = t('opt_mode_quick', '快速');
    $('mode-detail').textContent = t('opt_mode_detail', '详细');
    $('quick-setup-title').textContent = t('qs_title', '用一把 key 配好全部');
    $('settings-back').textContent = t('app_review_back', '← 返回');
    $('ui-lang-label').textContent = t('ui_lang_label', '界面语言');
    $('ui-lang-auto').textContent = t('ui_lang_auto', '跟随系统');
    $('daily-label').textContent = t('app_set_daily', '每天最多学几张新卡');
    // The three modes reuse the extension options page's keys — same feature, same
    // words, one translation to maintain.
    $('tts-mode-label').textContent = t('tts_mode', '语音模式');
    $('tts-mode-off').textContent = t('tts_mode_off', '关闭');
    $('tts-mode-assist').textContent = t('tts_mode_assist', '显示原文，可点播放');
    $('tts-mode-audio-first').textContent = t('tts_mode_audio_first', '先听后看（原文先隐藏）');
    // Engine labels come from the registry (labelKey via t, else the literal) —
    // same rule as the notes picker: nothing engine-specific restated here.
    $('tts-engine-label').textContent = t('tts_engine', '语音引擎');
    // 用注册表填下拉：EngineFields.populate 一处实现。它比手抄多做两件事 ——
    // 存着的 id 注册表不认识时**落到一个能用的选项**（换 flavor / 降级安装 / 厂商下架
    // 都会让一个合法保存过的 id 消失，留一个空 select 更糟），以及哨兵项的语义。
    // 哨兵 '' = 未配置（不朗读）。与 stt 同一套语义 —— 语音不再默认走系统自带。
    EngineFields.populate($('tts-engine'), window.MT_TTS_ENGINES || [], {
      t, sentinel: { value: '', text: t('tts_engine_none', '未配置（不朗读）') },
    });
    $('tts-key-label').textContent = t('tts_api_key', '语音 API Key');
    $('tts-base-label').textContent = t('tts_base_url', '语音端点地址');
    $('tts-model-label').textContent = t('tts_model', '语音模型');
    $('tts-voice-label').textContent = t('app_set_tts_voice', '朗读语音');
    $('tts-auto-label').textContent = t('app_set_tts_auto', '显示译文时自动朗读');
    $('tts-rate-label').textContent = t('app_set_tts_rate', '朗读速度');
    $('tts-note').textContent = t('app_set_tts_note', '语言未知的卡（例如在 Safari 里采集的 —— 那里没有语言检测）只用上面选定的朗读语音；不选则这类卡无法朗读。语音 API Key 与句子解析的密钥一样：只存这台设备、不随账号同步，本机明文保存。');
    $('notes-title').textContent = t('app_set_notes_title', '句子解析');
    $('notes-provider-label').textContent = t('app_set_notes_provider', '解析引擎');
    $('notes-key-label').textContent = t('app_set_notes_key', 'API Key');
    $('notes-base-label').textContent = t('app_set_notes_base', '自定义接口地址');
    $('notes-model-label').textContent = t('app_set_notes_model', '模型');
    $('notes-note').textContent = t('app_set_notes_note', '仅用于生成句子解析（生词 / 短语 / 语法），调用你自己的 API。密钥只存在这台设备上，不随账号同步；与浏览器扩展里配置的密钥互不相通，安全性也相同 —— 都是本机明文保存。');
    // The picker lists chat-capable engines ONLY, and asks LearnNotes which those
    // are — the gate and the picker share one definition, so they cannot drift.
    // Labels come from the registry; nothing engine-specific is restated here.
    // ⚠️ 哨兵的**语义在两个宿主上不同，这是有意的**：扩展那边 '' = 「跟随翻译引擎」
    // （它有一个翻译引擎可跟随）；App 里没有网页翻译，没有可跟随的对象，所以 '' =
    // 「不使用」。所以这里显式传 sentinel，而不是用 SLOTS.notes 的默认哨兵。
    EngineFields.populate($('notes-provider'), LearnNotes.chatEngines(), {
      t, sentinel: { value: '', text: t('app_set_notes_none', '不使用') },
    });
    // §9.4 — transcription engine for the 说 exercise. Empty = not configured =
    // the speak form does not exist. Candidates come from the generated registry.
    $('drive-title').textContent = t('drive_entry', '播客模式');
    $('drive-play-notes-label').textContent = t('drive_play_notes', '播放时朗读句子解析');
    $('drive-awake-note').textContent = t('drive_awake_note',
      '播客模式在前台时屏幕不会自动锁。锁屏之后想一直看到卡片，请打开系统的「息屏常显」：设置 → 显示与亮度 → 始终显示。');
    $('drive-play-notes-note').textContent = t('drive_play_notes_note', '开启后每张卡在原文和译文之后再读一遍解析（生词 / 短语 / 语法）。**没解析过的卡会自动调用你配置的解析引擎**——每张卡只收一次费，之后一直用缓存。不开则只读原文和译文。');
    $('drive-preload-days-label').textContent = t('drive_preload_days', '预载范围');
    $('drive-preload-days-0').textContent = t('drive_preload_days_0', '今天要听的牌库');
    $('drive-preload-days-3').textContent = t('drive_preload_days_3', '今天 + 未来 3 天');
    $('drive-preload-days-7').textContent = t('drive_preload_days_7', '今天 + 未来 7 天');
    $('drive-preload-hint').textContent = t('drive_preload_hint', '出发前点一下，把要听的语音、解析、译文全部下载到本机，路上没网也能整轮播完。第一下只算账、不花钱，看清楚要调用多少次再点第二下。');
    $('btn-drive-clear-audio').textContent = t('tts_clear_cache', '清空语音缓存');
    $('stt-title').textContent = t('stt_engine', '转写引擎');
    $('stt-engine-label').textContent = t('stt_engine', '转写引擎');
    $('stt-key-label').textContent = t('stt_api_key', '转写 API Key');
    $('stt-base-label').textContent = t('stt_base_url', '转写端点地址');
    $('stt-model-label').textContent = t('stt_model', '转写模型');
    $('btn-test-notes').textContent = t('engine_test', '测试连接');
    $('btn-test-stt').textContent = t('engine_test', '测试连接');
    $('btn-tts-test').textContent = t('tts_test', '试听一句');
    $('stt-note').textContent = t('stt_hint', '「说」题的录音会发到这里配置的端点转写，识别完立即丢弃、不存储不同步；不配置则不出「说」题。密钥只存本机。');
    EngineFields.populate($('stt-engine'), window.MT_STT_ENGINES || [], {
      t, sentinel: { value: '', text: t('stt_engine_none', '未配置（不出「说」题）') },
    });
    // 来源治理 (interaction-spec): rules follow the account (§8.9); the phone is a
    // natural place to edit them even though the app itself never captures.
    $('app-langs-title').textContent = t('learn_langs_label', '学习语言');
    $('app-langs-note').textContent = t('learn_langs_hint', '只收录选中语言的句子。Safari 无法精确识别语言时按文字系统判断；长按收藏不受限制。');
    $('app-sources-title').textContent = t('learn_sources_manage', '来源管理');
    $('corpus-title').textContent = t('app_set_corpus', '学习库');
    $('split-long').textContent = t('learn_split_long', '拆分长段卡');
    $('clean-known').textContent = t('app_set_clean_known', '清理已掌握的卡');
    $('clear-learn').textContent = t('learn_clear', '清空学习库');
    $('feedback-title').textContent = t('feedback_section', '反馈');
    $('feedback-mail').textContent = t('feedback_row', '发送反馈');
    $('feedback-rate').textContent = t('feedback_rate', '去商店评分');
    $('feedback-note').textContent = t('feedback_hint', '会打开你的邮件 App。主题里带着版本号和平台，除此之外什么都不发送。');
    $('telemetry-title').textContent = t('telemetry_section', '匿名用量数据');
    $('telemetry-label').textContent = t('telemetry_toggle', '分享匿名用量数据');
    $('telemetry-note').textContent = t('telemetry_hint', '只发送用了哪些功能、在哪个浏览器、翻译成功还是失败 —— 不含你读的网页、文字、地址、密钥或账号。关掉即删除这台设备发过的数据。');
    $('account-title').textContent = t('app_set_account', '账号');
    $('settings-signout').textContent = t('app_set_signout', '退出登录');
    $('delete-account').textContent = t('app_set_delete', '删除账号与云端数据');
    $('delete-note').textContent = t('app_set_delete_note', '删除后，服务器上的语料与复习记录会被永久移除，账号也会注销。这台设备上已经下载的内容不受影响 —— 想一并清掉，删除 App 即可。');
  }

  // **没有回落到第一个引擎**（2026-09-04）。这是全仓第三处同样的谎 —— 另两处在
  // `tts.js` 的 engine() 与 `options.js` 的 updateTtsUI，同一天一起删的。
  // 回落会让「未配置」在界面上显示成「已选 browser」，而用户从没做过那个选择。
  // 未配置返回 null，调用方各自处理（三处都已能吃 null）。
  const engineById = (id) => (window.MT_TTS_ENGINES || []).find((e) => e.id === id) || null;

  // ─── 出发前预载（§9.5）────────────────────────────────────────────────────
  // 两态按钮：`pending` 持有算好的账单，点第二下才开跑；`running` 时按钮是「停止」。
  // 这不是 UI 花样，是 §9.2 修订后那条例外的构成要件之一 —— 没有「先看账单」这一步，
  // 它就退回「自动批量」，仍然是禁止的。
  let preloadState = 'idle';     // idle | pending | running
  let preloadPlanned = null;
  let preloadStop = false;

  function resetPreload() {
    preloadState = 'idle';
    preloadPlanned = null;
    preloadStop = false;
    $('btn-drive-preload').disabled = false;
    $('btn-drive-preload').textContent = t('drive_preload', '预载离线资源');
    $('drive-preload-note').textContent = '';
  }

  async function refreshAudioCache() {
    const el = $('drive-audio-cache');
    if (!el) return;
    try {
      const e = engineById($('tts-engine').value);
      if (!e) { el.textContent = ''; $('btn-drive-clear-audio').hidden = true; return; }
      if (!e.returnsAudio) {
        el.textContent = t('tts_cache_na', '设备内置语音不产生缓存');
        $('btn-drive-clear-audio').hidden = true;
        return;
      }
      $('btn-drive-clear-audio').hidden = false;
      const st = await LearnStore.audioStats();
      el.textContent = st.count
        ? t('tts_cache', '语音缓存 {n} 条 · 约 {mb} MB（上限 {cap} MB）')
            .replace('{n}', String(st.count))
            .replace('{mb}', String(Math.max(1, Math.round(st.bytes / 1048576))))
            .replace('{cap}', String(Math.round(LearnStore.MAX_AUDIO_BYTES / 1048576)))
        : t('tts_cache_empty', '语音缓存为空');
    } catch (_) { el.textContent = ''; }
  }

  // 账单文案。**能力缺失也要在这里说出来** —— 用户开着「播放解析」却没配引擎时，
  // 默默把那些卡从计划里删掉，就是 build 38 那次「表现得和功能没做完全一样」的复刻。
  function priceText(p) {
    const lines = [];
    if (!p.cards.length) {
      // 「没有可听读的卡」单独说不够：语音引擎配坏了会让 speakableDeck 把**每一张**卡都
      // 判成读不出来，于是真正的原因（缺地址 / 缺 key）被一句「没卡」盖住。下面那些
      // 具名的行照常追加，所以用户看到的是原因，不是症状。
      lines.push(t('drive_empty', '没有可听读的卡'));
    } else {
      const parts = [t('drive_preload_cards', '{n} 张卡').replace('{n}', String(p.cards.length))];
      if (p.audioCacheable) {
        parts.push(t('drive_preload_audio', '待合成 {n} 段语音').replace('{n}', String(p.audioMissing)));
      }
      if (p.notesMissing) parts.push(t('drive_preload_notes', '待解析 {n} 张').replace('{n}', String(p.notesMissing)));
      if (p.trMissing) parts.push(t('drive_preload_tr', '待补译文 {n} 张').replace('{n}', String(p.trMissing)));
      lines.push(parts.join(' · '));
    }
    if (!p.audioCacheable) {
      lines.push(t('drive_preload_no_audio_cache',
        '设备内置语音不产生缓存，本来就能离线播放；这里只预载解析与译文。'));
    }
    if (p.audioCacheable && !p.engineReady) {
      lines.push(t('drive_preload_tts_bad',
        '语音引擎还没配置好（{reason}），这次一段音频都合成不出来（设置 → 语音引擎）')
        .replace('{reason}', p.engineReason || ''));
    }
    if (p.notesBlocked) {
      lines.push(t('drive_notes_engine_missing',
        '「播放解析」需要先在设置里配好解析引擎（设置 → 句子解析）'));
    } else if (p.fillBlocked) {
      lines.push(t('drive_preload_no_fill_engine',
        '没配解析引擎，没有译文的卡这次补不了译文（设置 → 句子解析）'));
    }
    if (p.skipped) {
      lines.push(t('drive_skipped', '跳过 {n} 张读不出来的卡（媒体卡或无语音）')
        .replace('{n}', String(p.skipped)));
    }
    return lines.join('\n');
  }

  function tallyText(r) {
    const head = (r.stopped ? t('drive_preload_stopped', '已停止：完成 {done}/{total}')
                            : t('drive_preload_done', '完成 {done}/{total}'))
      .replace('{done}', String(r.done)).replace('{total}', String(r.total));
    if (!r.failures.length) return head;
    const named = r.failures.map((f) => f.reason + ' ×' + f.n).join('、');
    return head + ' · ' + t('drive_preload_failed', '{n} 处失败（{reasons}）')
      .replace('{n}', String(r.failures.reduce((a, f) => a + f.n, 0)))
      .replace('{reasons}', named);
  }

  // 显隐与示例地址一律走 EngineFields —— **不在这里复述规则**。
  //
  // 这三个 paint* 曾经是手抄的（engine-fields.js 的文件头点名了它们），代价是四处
  // 静默漂移：`supportsKey ?? needsKey` 只有一半的地方判、notes 那处干脆不判
  // needsKey、示例地址只有一半的地方给。2026-09-04 用户报「App 设置页与扩展不一致」
  // 就是这么来的。规则只能有一份。
  // `slot` 是 EngineFields.SLOTS 的槽名 —— **输入框的 id 从那张表取，不在这里抄**。
  // 抄一份的下场就是这个仓库已经有的七份手抄键表：改一处，另外六处不会红。
  // `prefix` 只用于 App 自己的行容器（`<prefix>-key-field` 等），那是 App 的 markup，
  // SLOTS 不管它们。
  function applyFields(vis, slot, prefix) {
    const ids = EngineFields.SLOTS[slot].ids;
    $(prefix + '-key-field').hidden = !vis.key;
    $(prefix + '-base-field').hidden = !vis.baseUrl;
    $(prefix + '-model-field').hidden = !vis.model;
    $(ids.baseUrl).placeholder = vis.basePlaceholder;
    $(ids.model).placeholder = vis.modelPlaceholder;
  }

  function paintTtsFields(engineId) {
    applyFields(EngineFields.visibility(engineById(engineId)), 'tts', 'tts');
  }

  // Voice list is engine-aware, same three cases as the extension options page:
  // browser ⇒ the system's voices (async — the classic getVoices trap
  // LearnTTS.loadVoices exists for); a registry voice list ⇒ those; neither
  // (self-hosted, free-form voices) ⇒ just the automatic option. The '' option
  // means "match by the card's language" — which for an 'und' card (every card
  // captured on Safari, where no detector exists) means NO voice, so the note
  // below tells the user this picker is how those cards get a voice at all.
  async function paintVoices(selected) {
    const sel = $('tts-voice');
    const e = engineById($('tts-engine').value);
    sel.textContent = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = t('app_set_tts_voice_auto', '自动（按卡片语言）');
    sel.append(auto);
    if (e && e.type === 'browser') {
      for (const v of await LearnTTS.loadVoices(1500)) {
        const o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = v.name + ' (' + v.lang + ')';
        sel.append(o);
      }
    } else if (e && e.voices) {
      for (const v of e.voices) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.append(o);
      }
    }
    sel.value = [...sel.options].some((o) => o.value === selected) ? selected : '';
  }

  // Push the WHOLE speech config into the live LearnTTS — configure() is
  // RESET-style (DEFAULTS + next), and review.js only reads settings once at
  // bundle load, so this is what makes a change work on the NEXT card instead
  // of the next launch.
  function liveTtsConfigure() {
    LearnTTS.configure(Object.assign({}, LearnTTS.config, {
      // **没有回落。** 这里曾经是 `|| 'browser'` —— 于是「未配置」在试听时被静默
      // 换成系统自带，真的出了声，而界面说「播放中」。tts.js 里的那个回落 2026-09-04
      // 拆掉了，这一处漏了：同一条规则的第二份实现，正是这一轮在消灭的东西。
      engineId: $('tts-engine').value,
      apiKey: $('tts-api-key').value.trim(),
      baseUrl: $('tts-base-url').value.trim(),
      model: $('tts-model').value.trim(),
      voice: $('tts-voice').value,
    }));
  }

  // ─── 来源治理 (§4.1/§7.4/§8.9) ─────────────────────────────────────────
  // 本页自己的读数不订阅 storage.onChanged（它是写入方，重画自己就够了）——
  // same pattern as liveTtsConfigure(). Rules ride the next push as a `g` row;
  // a delete is account intent and gets a prompt forced sync (§7.4).

  async function writeRules(mutate) {
    const cur = await get(['learnRules']);
    const base = cur.learnRules || { v: 1, block: [], langs: null };
    const next = LearnRules.withUpdate(base, mutate(base));
    await set({ learnRules: next });
    if (typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
      LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
    }
    return next;
  }

  async function paintGovernance(say) {
    const cur = await get(['learnRules']);
    const rules = cur.learnRules || null;
    const langsBox = $('app-langs');
    const srcBox = $('app-sources');
    if (!langsBox || !srcBox) return;

    SourcesView.renderLangChips(langsBox, {
      registry: window.MT_LANGS || [],
      langs: rules && rules.langs,
      t,
      onChange: async (langs) => {
        await writeRules(() => ({ langs }));
        paintGovernance(say);
      },
    });

    const [items, sources] = await Promise.all([LearnStore.allItems(), LearnStore.allSources()]);
    SourcesView.render(srcBox, {
      items, sources, rules, t,
      onDelete: async ({ host, itemIds, sourceIds }) => {
        if (!itemIds.length) { say(t('learn_delete_none', '这个来源已没有可删的卡')); return; }
        if (!window.confirm(t('learn_delete_confirm', '删除 {host} 的 {n} 张卡？会同步到所有设备，不可恢复。')
          .replace('{host}', host).replace('{n}', String(itemIds.length)))) return;
        const n = await LearnStore.deleteItems(itemIds, Date.now()).catch(() => 0);
        await LearnStore.deleteSourcesIfOrphan(sourceIds).catch(() => {});
        say(t('learn_delete_done', '已删除 {n} 张卡').replace('{n}', String(n)));
        if (typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
          LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
        }
        paintGovernance(say);
      },
      onBlock: async (p) => {
        await writeRules((r) => ({
          block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
        }));
        paintGovernance(say);
      },
      onUnblock: async (p) => {
        await writeRules((r) => ({ block: (r.block || []).filter((x) => x !== p) }));
        paintGovernance(say);
      },
      onAddRule: async (p) => {
        await writeRules((r) => ({
          block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
        }));
        paintGovernance(say);
      },
      onInvalidRule: () => say(t('learn_block_invalid', '规则格式不对'), true),
    });
  }

  async function paint(session, say) {
    const cur = await get(KEYS);
    $('ui-lang').value = cur.uiLang || 'auto';
    $('daily').value = cur.learnDailyNew != null ? cur.learnDailyNew : 15;
    $('tts-mode').value = cur.ttsMode || 'off';
    // 不认识的 id（换 flavor / 降级安装 / 厂商下架）落到**哨兵**，不是第一个引擎 ——
    // 落到第一个引擎等于替用户做了一个他没做过的选择。
    $('tts-engine').value = (engineById(cur.ttsEngine) || {}).id || '';
    $('tts-api-key').value = cur.ttsApiKey || '';
    $('tts-base-url').value = cur.ttsBaseUrl || '';
    $('tts-model').value = cur.ttsModel || '';
    paintTtsFields($('tts-engine').value);
    await paintVoices(cur.ttsVoice || '');
    $('tts-auto').checked = !!cur.ttsAutoPlay;
    $('tts-rate').value = cur.ttsRate != null ? cur.ttsRate : 1;
    $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    $('notes-provider').value = cur.provider || '';
    $('notes-api-key').value = cur.apiKey || '';
    $('notes-base-url').value = cur.apiBaseUrl || '';
    $('notes-model').value = cur.apiModel || '';
    paintNotesFields(cur.provider || '');
    // `!== false`：默认开，且不需要往存储里播种默认值（见 app/driving.js 同款读法）。
    $('drive-play-notes').checked = cur.drivePlayNotes !== false;
    $('drive-preload-days').value = String(Number(cur.drivePreloadDays) > 0 ? Math.floor(Number(cur.drivePreloadDays)) : 0);
    resetPreload();
    refreshAudioCache();
    $('stt-engine').value = (window.MT_STT_ENGINES || []).some((e) => e.id === cur.sttEngine)
      ? cur.sttEngine : '';
    $('stt-api-key').value = cur.sttApiKey || '';
    $('stt-base-url').value = cur.sttBaseUrl || '';
    $('stt-model').value = cur.sttModel || '';
    paintSttFields($('stt-engine').value);
    $('account-who').textContent = LearnAuth.displayName(session);

    const [stats, reviews] = await Promise.all([LearnStore.stats(), LearnStore.allReviews()]);
    $('settings-counts').textContent =
      stats.total + ' ' + t('app_unit_cards', '张卡') + ' · '
      + reviews.length + ' ' + t('app_unit_reviews', '条复习记录')
      + ' · ' + (stats.by.known || 0) + ' ' + t('app_unit_known', '已掌握');

    await paintGovernance(say);
    await setupQuickCard(session, say);
  }

  // §9.4 — 同一条规则，同一个组件。
  function paintSttFields(engineId) {
    const e = (window.MT_STT_ENGINES || []).find((x) => x.id === engineId) || null;
    applyFields(EngineFields.visibility(e), 'stt', 'stt');
  }

  // 同一条规则，同一个组件。⚠️ 这一处此前是 `hidden = !p` —— **只要选了引擎就露出
  // Key 框，完全不看 needsKey**，而扩展那边看。不需要 Key 的引擎在 App 上多一个
  // 空 Key 框，是这次报障里最直观的那一处。
  function paintNotesFields(providerId) {
    const p = LearnNotes.chatEngines().find((e) => e.id === providerId) || null;
    applyFields(EngineFields.visibility(p), 'notes', 'notes');
  }

  // ── 「快速 | 详细」两档 ────────────────────────────────────────────────────
  //
  // 与扩展设置页同一套类名契约，不发明第二套。三条照抄的实现约束：
  //   · **只切 hidden，永不 remove()** —— 这一页按字面量读控件、零 null 保护。
  //   · 模式**单独存**一个 key，不进 KEYS —— 它是 UI 状态不是配置，混进去等于让
  //     整体式的读写去管一个跟配置无关的东西。
  //   · 这个 flavor 没有可一键的平台时不留空壳（_quickAvailable）——「只藏不给路
  //     是退化，不是简化」。
  // 让三档引擎的显隐重新说一次话。只读 DOM 当前选中的引擎，不碰存储。
  function repaintEngineFields() {
    try { paintTtsFields($('tts-engine').value); } catch (_) {}
    try { paintSttFields($('stt-engine').value); } catch (_) {}
    try { paintNotesFields($('notes-provider').value); } catch (_) {}
  }

  const DETAIL_KEY = 'optDetailMode';
  let _quickAvailable = true;

  // ⚠️ **两套机制在写同一个 `hidden`，必须有明确的先后。**
  //
  // `.adv-only` 管的是「这一档要不要露」，`applyFields` 管的是「这个引擎需不需要
  // 这个框」。三个引擎字段行**同时属于两者**。2026-09-04 在 iPhone 模拟器上实测到
  // 后果：详细档下语音引擎明明是「未配置（不朗读）」，Key 与端点地址却照样显示 ——
  // 因为 applyDetailMode 跑在 paintTtsFields 之后，把逐引擎的判断整个冲掉了。
  //
  // 所以放开 .adv-only 之后**必须再让逐引擎的判断说一次话**。顺序反过来会同样错。
  // 这是设备矩阵抓到的 —— 三道自动化门禁都看不见它（它们只在详细档下逐个切引擎，
  // 而那时 applyDetailMode 早已跑完，两者恰好一致）。
  function applyDetailMode(on) {
    for (const el of document.querySelectorAll('#app-settings .adv-only')) el.hidden = !on;
    if (on) repaintEngineFields();
    for (const el of document.querySelectorAll('#app-settings .quick-only')) {
      el.hidden = on || !_quickAvailable;
    }
    $('mode-quick').setAttribute('aria-selected', String(!on));
    $('mode-detail').setAttribute('aria-selected', String(!!on));
  }

  async function setDetail(on) {
    applyDetailMode(on);
    try { await set({ [DETAIL_KEY]: !!on }); } catch (_) {}
  }

  // 组件只返回 patch，写盘归本页 —— 与扩展设置页同一条分工。写完重画：一键配好的
  // 三组必须在「详细」里立刻看得见，否则用户下一次改任何一个字段都会用旧 DOM 覆盖回去。
  async function applyQuickSetup(plan, session, say) {
    if (plan && plan.writes && Object.keys(plan.writes).length) await set(plan.writes);
    await paint(session, say);
  }

  async function setupQuickCard(session, say) {
    if (!$('quick-setup')) return;
    // **已经挂上的卡不重画。** paint() 在每次写盘之后都会跑一遍（一键配好 → 写盘 → 重画
    // 详细档的三组字段），而 QuickSetup.render 是清空重建 —— 于是用户刚粘进去的 key、
    // 正在跑的「测试中…」三行，在按下按钮的那一瞬间一起消失，看起来像密码被吃掉了
    // （2026-09-06 用户报，1.7.14 起带入，1.7.16 已上架）。读设置本来就是现读的
    // （readSettings），卡不需要靠重建来保持新鲜。
    if ($('quick-setup').children.length) {
      let on = false;
      try { const r = await get([DETAIL_KEY]); on = r[DETAIL_KEY] === true; } catch (_) {}
      applyDetailMode(on);
      return;
    }
    QuickSetup.render($('quick-setup'), {
      t,
      // 现读而不是快照：拿旧快照判「配没配过」会覆盖用户刚在「详细」里输入的 key。
      readSettings: () => get(KEYS),
      targetLang: '',
      onApply: (plan) => applyQuickSetup(plan, session, say),
      // App 配完就没有下一步了，也没有网页可翻 —— 「现在翻一页看看」属于浏览器那一侧。
      showTry: false,
    });
    if (!$('quick-setup').children.length) {
      // 没有可一键的平台。不留空壳，也不给一个其中一边可证为空的二选一。
      _quickAvailable = false;
      $('mode-tabs').hidden = true;
      applyDetailMode(true);
      return;
    }
    let on = false;
    try { const r = await get([DETAIL_KEY]); on = r[DETAIL_KEY] === true; } catch (_) {}
    applyDetailMode(on);
  }

  function wire(opts) {
    const say = opts.say;
    $('mode-quick').addEventListener('click', () => setDetail(false));
    $('mode-detail').addEventListener('click', () => setDetail(true));

    // Persist on change, not behind a Save button. There is no multi-field state to
    // keep consistent here, and a Save button is one more thing to forget to press.
    $('daily').addEventListener('change', async () => {
      const n = Math.max(1, Math.min(200, parseInt($('daily').value, 10) || 15));
      $('daily').value = n;
      await set({ learnDailyNew: n });
    });
    // 界面语言：**改完立刻生效，不等下次启动**（interaction-spec「Switching applies live」）。
    // 三件事要一起做，漏一件都是「改了没反应」：
    //   1. PageI18n.setUiLang —— 之后每一次 t() 才走新 locale
    //   2. 重画本页 —— 已经渲染出来的文字不会自己变
    //   3. AppDriving.refreshEntry —— 播客模式入口按 uiLang 有没有语音做门控（§9.5），
    //      换了语言而不重算，入口会停在上一个语言的结论上
    $('ui-lang').addEventListener('change', async () => {
      const v = $('ui-lang').value || 'auto';
      await set({ uiLang: v });
      try { PageI18n.setUiLang(v); } catch (_) {}
      paintStatic();
      try { document.documentElement.lang = PageI18n.effectiveLocale().replace('_', '-'); } catch (_) {}
      try { AppDriving.refreshEntry(); } catch (_) {}
    });
    $('tts-mode').addEventListener('change', () => set({ ttsMode: $('tts-mode').value }));
    // Every speech knob reconfigures LearnTTS LIVE, not just at next launch —
    // same reasoning as the notes key (review.js reads settings once at bundle
    // load, and "pick an engine, tap ▶, silence" would read as broken).
    $('tts-engine').addEventListener('change', async () => {
      // interaction-spec 全局原则: paintVoices can stall up to 1.5s on voice
      // discovery — the select locks so a second change can't interleave.
      const sel = $('tts-engine');
      sel.disabled = true;
      try {
        const id = sel.value;
        // Voice names don't carry across engines (a voiceURI means nothing to a
        // speech endpoint, 'alloy' means nothing to the system) — reset it.
        await set({ ttsEngine: id, ttsVoice: '' });
        // 选了引擎而朗读模式还是「关」= 配好了却永远不出声的语音。一键配置早就是这条
        // 规则（quick-setup.js：ttsMode off → assist）；手动路径不做，配完 key ▶ 照样不出现。
        if (id && $('tts-mode').value === 'off') {
          $('tts-mode').value = 'assist';
          await set({ ttsMode: 'assist' });
        }
        paintTtsFields(id);
        await paintVoices('');
        liveTtsConfigure();
        // 换引擎会换掉整个音频缓存键（cacheKey 含 engineId/model/voice），所以已经
        // 算好的账单和缓存读数都过期了。
        resetPreload();
        await refreshAudioCache();
      } finally { sel.disabled = false; }
    });
    for (const id of ['tts-api-key', 'tts-base-url', 'tts-model']) {
      $(id).addEventListener('change', async () => {
        await set({
          ttsApiKey: $('tts-api-key').value.trim(),
          ttsBaseUrl: $('tts-base-url').value.trim(),
          ttsModel: $('tts-model').value.trim(),
        });
        liveTtsConfigure();
      });
    }
    $('tts-voice').addEventListener('change', async () => {
      await set({ ttsVoice: $('tts-voice').value });
      liveTtsConfigure();
    });
    $('tts-auto').addEventListener('change', () => set({ ttsAutoPlay: $('tts-auto').checked }));
    $('tts-rate').addEventListener('input', () => {
      $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    });
    $('tts-rate').addEventListener('change', async () => {
      const r = Number($('tts-rate').value);
      await set({ ttsRate: r });
      LearnTTS.configure(Object.assign({}, LearnTTS.config, { rate: r }));
    });
    // Voices can land AFTER the settings page painted (loadVoices' timeout path);
    // re-populate so the picker never sits empty on a machine full of voices.
    // Only meaningful for the browser engine — registry voice lists are static.
    LearnTTS.onVoicesChanged(() => {
      const e = engineById($('tts-engine').value);
      if (e && e.type === 'browser') get(['ttsVoice']).then((c) => paintVoices(c.ttsVoice || ''));
    });

    // §9.2 in the app: write the SAME keys review.js reads, and reconfigure
    // LearnNotes immediately — review.js only reads settings once at bundle load,
    // so without this the 解析 entry would stay closed until the next launch and
    // a freshly pasted key would look like a broken feature. The gate itself is
    // re-asked per card (`capable()`), so the next card picks this up live.
    async function saveNotesCfg() {
      const cfgNow = {
        provider: $('notes-provider').value,
        apiKey: $('notes-api-key').value.trim(),
        apiBaseUrl: $('notes-base-url').value.trim(),
        apiModel: $('notes-model').value.trim(),
      };
      await set(cfgNow);
      LearnNotes.configure({
        provider: cfgNow.provider, apiKey: cfgNow.apiKey,
        baseUrl: cfgNow.apiBaseUrl, model: cfgNow.apiModel,
      });
    }
    // 换引擎时清空非空的接口地址，并说出来（interaction-spec 「接口地址字段」）。
    // 地址不能跨端点携带 —— 与下面 tts-engine 重置 voice 是同一条理由。对有默认端点的
    // 条目，清空恰好回到一个能工作的配置。返回是否真的清了，好让调用方给出提示：
    // 静默丢掉用户敲过的东西，正是这条规则要避免的那种失败。
    function clearEndpointOnEngineSwitch(inputId) {
      const el = $(inputId);
      if (!el || !el.value.trim()) return false;
      el.value = '';
      return true;
    }

    $('notes-provider').addEventListener('change', async () => {
      const cleared = clearEndpointOnEngineSwitch('notes-base-url');
      paintNotesFields($('notes-provider').value);
      await saveNotesCfg();
      if (cleared) say(t('toast_endpoint_cleared', '换引擎了，接口地址已清空'));
    });
    for (const id of ['notes-api-key', 'notes-base-url', 'notes-model']) {
      $(id).addEventListener('change', saveNotesCfg);
    }

    // §9.4 in the app: write the SAME keys review.js reads and reconfigure
    // LearnSpeech immediately — capable() is re-asked per card, so the next card
    // picks a freshly configured engine up live (same reasoning as the notes key).
    async function saveSttCfg() {
      const c = {
        sttEngine: $('stt-engine').value,
        sttApiKey: $('stt-api-key').value.trim(),
        sttBaseUrl: $('stt-base-url').value.trim(),
        sttModel: $('stt-model').value.trim(),
      };
      await set(c);
      if (typeof LearnSpeech !== 'undefined') {
        LearnSpeech.configure({
          engineId: c.sttEngine, apiKey: c.sttApiKey,
          baseUrl: c.sttBaseUrl, model: c.sttModel,
        });
      }
    }
    $('drive-play-notes').addEventListener('change', () => {
      set({ drivePlayNotes: $('drive-play-notes').checked });
      resetPreload();     // 开关变了，账单就过期了 —— 不能让它继续代表旧的计划
    });
    $('drive-preload-days').addEventListener('change', () => {
      set({ drivePreloadDays: Number($('drive-preload-days').value) || 0 });
      resetPreload();
    });

    // 第一下算账、第二下开跑、跑起来之后是停止键（§9.5 / §9.2 修订后的四个构成要件）。
    $('btn-drive-preload').addEventListener('click', async () => {
      const btn = $('btn-drive-preload');
      const note = $('drive-preload-note');

      if (preloadState === 'running') { preloadStop = true; btn.disabled = true; return; }

      if (preloadState === 'idle') {
        btn.disabled = true;
        note.textContent = t('drive_preload_pricing', '正在核对本机已有的内容…');
        let p;
        try {
          p = await AppDriving.preloadPlan(Number($('drive-preload-days').value) || 0);
        } catch (_) { p = null; }
        btn.disabled = false;
        if (!p || !p.ok) {
          note.textContent = t('settings_read_failed_short', '读不到已保存的设置，请稍后再试');
          return;
        }
        note.textContent = priceText(p);
        if (!p.cards.length) return;
        // 全都已经在本机了就不必再点第二下 —— 一个「确认花 0 次调用」的按钮是噪音。
        if (!p.audioMissing && !p.notesMissing && !p.trMissing) {
          note.textContent = priceText(p) + '\n' + t('drive_preload_ready', '这些内容已经全在本机，路上不需要联网。');
          return;
        }
        preloadPlanned = p;
        preloadState = 'pending';
        btn.textContent = t('drive_preload_confirm', '确认预载（约 {n} 次付费调用）')
          .replace('{n}', String(p.notesMissing + p.trMissing + (p.audioCacheable ? p.audioMissing : 0)));
        return;
      }

      // pending → running
      const p0 = preloadPlanned;
      if (!p0) { resetPreload(); return; }
      preloadState = 'running';
      preloadStop = false;
      btn.textContent = t('drive_preload_stop', '停止');
      // 状态是在 await 之前就翻的，所以同一下点击派发两次事件时，第二次落在 running
      // 分支上会把刚开跑的这一轮立刻停掉。上面的 markup 注释记着那个坑；这里再挡一道，
      // 因为「点两下」在真机上还有别的来路（双击、辅助功能的重复激活）。
      preloadPlanned = null;
      const planned = p0;
      const r = await AppDriving.preloadRun(planned, {
        shouldStop: () => preloadStop,
        onProgress: ({ done, total }) => {
          note.textContent = t('drive_preload_progress', '预载中 {done}/{total}…')
            .replace('{done}', String(done)).replace('{total}', String(total));
        },
      });
      resetPreload();
      note.textContent = tallyText(r);
      await refreshAudioCache();
    });

    $('btn-drive-clear-audio').addEventListener('click', async () => {
      const btn = $('btn-drive-clear-audio');
      btn.disabled = true;
      try { await LearnStore.clearAudio(); } catch (_) {}
      btn.disabled = false;
      resetPreload();
      await refreshAudioCache();
      say(t('toast_cache_cleared', '缓存已清除'));
    });
    $('stt-engine').addEventListener('change', async () => {
      const cleared = clearEndpointOnEngineSwitch('stt-base-url');
      paintSttFields($('stt-engine').value);
      await saveSttCfg();
      if (cleared) say(t('toast_endpoint_cleared', '换引擎了，接口地址已清空'));
    });
    for (const id of ['stt-api-key', 'stt-base-url', 'stt-model']) {
      $(id).addEventListener('change', saveSttCfg);
    }

    // ── 引擎自检 ×3（与扩展 options 同一套语义：走功能真正用的传输、
    // 在途禁用、失败具名）。App 端的 key 是设备本地凭证（§7.2），
    // 能当场自检尤其重要——这里配错了，用户在复习页只会看到功能「不出现」。
    function engineTestReason(e) {
      const code = (e && e.code) || '';
      if (code === 'no_base') return t('engine_test_no_base', '还没填端点地址');
      if (code === 'no_key') return t('engine_test_no_key', '还没填 API Key');
      if (code === 'no_engine') return t('engine_test_no_engine', '还没选引擎');
      if (code === 'network') return t('stt_network', '连不上端点——检查地址是否可达；自建服务还需允许跨域访问（CORS）');
      if (code === 'timeout') return t('engine_test_timeout', '端点没有在超时前回应');
      if (code === 'no_path') return t('engine_test_no_path', '这个地址只有主机名，没有接口路径 —— 请填完整的接口地址（参考输入框里的示例）');
      if (code === 'bad_url') return t('engine_test_bad_url', '地址不是以 http:// 或 https:// 开头 —— 缺协议头会被当成相对路径，请求根本发不出去');
      if (code === 'empty_output') return t('notes_test_empty', '模型没有返回正文——思考（推理）型模型不适合，请换对话模型');
      if (code === 'bad_output') return t('engine_test_bad_output', '端点通了，但返回的内容无法解析');
      if (code === 'http') {
        const hint = (e.status === 401 || e.status === 403)
          ? t('engine_test_hint_key', 'key 不对或没有权限')
          : e.status === 404 ? t('engine_test_hint_404', '地址或模型名不对')
          : t('engine_test_hint_other', '服务端拒绝了这次请求');
        return t('engine_test_http', 'HTTP {n} —— {hint}').replace('{n}', String(e.status || '?')).replace('{hint}', hint);
      }
      return (e && e.message) || t('engine_test_failed', '没通');
    }
    // Second line: the URL the transport actually requested. Same reason as the
    // extension's options page — with a user-supplied endpoint the commonest failure is
    // a wrong ADDRESS, and a 404 and a CORS rejection read identically without it. The
    // key never appears here. (`r.url` on success is wired for the shared endpoint
    // resolver in #147; no test callback returns it yet.)
    const withUrl = (text, url) => text + (url
      ? '\n' + t('engine_test_url', '请求地址：{url}').replace('{url}', String(url))
      : '');
    const runTest = (btnId, noteId, fn) => async () => {
      const btn = $(btnId), note = $(noteId);
      btn.disabled = true;
      note.textContent = t('engine_test_running', '测试中…');
      try {
        const r = await fn();
        note.textContent = withUrl(
          t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
            + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
          r.url);
      } catch (e) {
        console.error('[engine-test]', (e && e.url) || '', e);
        note.textContent = withUrl('✗ ' + engineTestReason(e), e && e.url);
      } finally { btn.disabled = false; }
    };
    $('btn-test-notes').addEventListener('click', runTest('btn-test-notes', 'test-notes-note', async () => {
      await saveNotesCfg();
      return LearnNotes.test();
    }));
    $('btn-test-stt').addEventListener('click', runTest('btn-test-stt', 'test-stt-note', async () => {
      await saveSttCfg();
      if (typeof LearnSpeech === 'undefined') { const e = new Error('no module'); e.code = 'no_engine'; throw e; }
      return LearnSpeech.test();
    }));
    // 语音是「听得见才算通」，所以试听而不是探活——与扩展 options 的试听同义。
    $('btn-tts-test').addEventListener('click', async () => {
      const btn = $('btn-tts-test'), note = $('test-tts-note');
      btn.disabled = true;
      note.textContent = t('tts_testing', '正在合成…');
      try {
        liveTtsConfigure();
        const r = await LearnTTS.speak(t('tts_test_sample', 'This is what your review cards will sound like.'), 'en');
        note.textContent = r.ok ? t('tts_test_ok', '播放中') : ('✗ ' + LearnTTS.reason(r.reason, t));
        if (r.ok) await Promise.race([(r.done || Promise.resolve()).catch(() => {}),
          new Promise((res) => setTimeout(res, 15000))]);
      } finally { btn.disabled = false; }
    });

    $('split-long').addEventListener('click', async () => {
      // §4.2 存量长段卡治愈。批量写 + 全量重画在途,按钮可见地禁用。
      // 结构性拆分之后,配了解析引擎的话再跑 §4.2c LLM 裁决(走用户自己的
      // key,输出受机械验证,失败只会保整)。
      const btn = $('split-long');
      btn.disabled = true;
      try {
        const r = await LearnStore.splitLongItems().catch(() => null);
        let llm = null;
        if (r && r.skipped && LearnNotes.capable()) {
          try { llm = await LearnAlign.healUnalignable(); } catch (_) { llm = null; }
        }
        await paint(opts.session(), say);
        const parents = r ? r.parents + (llm ? llm.split : 0) : 0;
        const children = r ? r.children + (llm ? llm.children : 0) : 0;
        const skipped = r ? Math.max(0, r.skipped - (llm ? llm.split : 0)) : 0;
        if (!r || (!parents && !skipped)) say(t('learn_split_none', '没有可拆分的长段卡'));
        else {
          let msg = t('learn_split_done', '已把 {p} 张长段卡拆成 {c} 张句子卡')
            .replace('{p}', String(parents)).replace('{c}', String(children));
          if (skipped) msg += t('learn_split_skipped', '（{k} 张译文对不齐，保持原样）')
            .replace('{k}', String(skipped));
          say(msg);
        }
      } finally { btn.disabled = false; }
    });

    $('clean-known').addEventListener('click', async () => {
      // §7.1's targeted cleanup: drop what the scheduler itself concluded you no
      // longer need. Never a starred card, never one being actively learned.
      // interaction-spec 全局原则: bulk delete + full repaint are in flight.
      const btn = $('clean-known');
      btn.disabled = true;
      try {
        const n = await LearnStore.clearKnown().catch(() => 0);
        await paint(opts.session(), say);
        say(n
          ? t('app_set_cleaned', '已清理 {n} 张').replace('{n}', String(n))
          : t('app_set_clean_none', '没有可清理的卡'));
      } finally { btn.disabled = false; }
    });

    $('clear-learn').addEventListener('click', async () => {
      // Destructive and irreversible, so it names what goes rather than asking a
      // generic 「确定吗」 that gets answered without reading. Same string the
      // extension's settings page uses — one sentence, one meaning, eleven locales
      // already written.
      if (!window.confirm(t('learn_clear_confirm',
        '清空学习库？所有已采集的句子与复习进度都会被删除，且无法恢复。'))) return;
      const btn = $('clear-learn');
      btn.disabled = true;
      try {
        await LearnStore.clearAll();
        // §7.5's emptying guard: without this the local backup restores the corpus
        // on the next entry — and restored material carries no `syncedAt`, so it
        // would upload itself back as well. The typeof guard is mandatory: the app
        // bundle deliberately ships without LearnBackup.
        if (typeof LearnBackup !== 'undefined') { try { await LearnBackup.clear(); } catch (_) {} }
        await paint(opts.session(), say);   // read back: the counts must be 0 now
        say(t('toast_learn_cleared', '学习库已清空'));
      } catch (_) {
        say(t('toast_learn_clear_failed', '清空失败'), true);
      } finally { btn.disabled = false; }
    });

    // 反馈 / 评分。MTFeedback.open 在宿主 App 里走原生桥（window.open 在 WKWebView 里
    // 是哑的），且**同步**发生在点击里 —— 别在它前面 await。
    $('feedback-mail').addEventListener('click', () => { MTFeedback.open(MTFeedback.mailtoUrl('app')); });
    $('feedback-rate').addEventListener('click', () => { MTFeedback.open(MTFeedback.rateUrl()); });
    // 匿名用量事件的开关：独立键（tm:on），不进任何 saveAll。
    try {
      if (window.MT_TELEMETRY && typeof MTTelemetry !== 'undefined') {
        $('telemetry-block').hidden = false;
        MTTelemetry.enabled().then((on) => { $('telemetry-on').checked = !!on; });
        $('telemetry-on').addEventListener('change', () => { MTTelemetry.setEnabled($('telemetry-on').checked); });
      }
    } catch (_) {}

    $('settings-signout').addEventListener('click', async () => {
      const btn = $('settings-signout');
      btn.disabled = true;
      try { await opts.onSignOut(); } finally { btn.disabled = false; }
    });

    $('delete-account').addEventListener('click', async () => {
      // Destructive and irreversible, so it asks — and the question names what goes,
      // rather than a generic 「确定吗」 that the user answers without reading.
      if (!window.confirm(t('app_set_confirm_delete', '确定要删除账号吗？服务器上的所有内容会被永久移除，无法恢复。'))) return;
      $('delete-account').disabled = true;
      say(t('app_set_deleting', '正在删除…'));
      try {
        await LearnAuth.deleteAccount();
        say(t('app_set_deleted', '账号已删除。'));
        await opts.onSignOut();
      } catch (e) {
        say(String((e && e.message) || e), true);
      } finally {
        $('delete-account').disabled = false;
      }
    });
  }

  return { KEYS, ensureDefaults, paintStatic, paint, wire };
})();
