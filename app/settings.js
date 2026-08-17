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
  const KEYS = ['learnEnabled', 'learnDailyNew', 'learnRules',
    'ttsMode', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsAutoPlay', 'ttsRate',
    // §9.2 — the notes gate reads these (review.js:35). Same keys, same storage.
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    // §9.4 — the transcription group review.js reads. Device-local (§7.2).
    'sttEngine', 'sttBaseUrl', 'sttApiKey', 'sttModel',
    // 「地址按新语义存的」的戳，每个地址字段一个（content/wire-format.js）。
    'apiBaseUrlVerbatim', 'ttsBaseUrlVerbatim', 'sttBaseUrlVerbatim'];

  function get(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function set(items) {
    return new Promise((res) => chrome.storage.local.set(items, res));
  }

  // `learnEnabled` gates review.js's 「还没有学习材料 · 去设置里打开采集」 screen.
  // In the app that message is simply wrong: the app never captures, and its material
  // arrives by sync. So the flag is forced ON here — not to fake a capture toggle,
  // but because "is there a source of material" is genuinely true, and the browser's
  // capture switch is not this surface's business.
  async function ensureDefaults() {
    const cur = await get(KEYS);
    const patch = {};
    if (cur.learnEnabled !== true) patch.learnEnabled = true;
    if (typeof cur.learnDailyNew !== 'number') patch.learnDailyNew = 15;
    // Normally already seeded by chrome-shim.js (which must win the race against
    // review.js's boot read); this only repairs a corrupted value.
    if (['off', 'assist', 'audio-first'].indexOf(cur.ttsMode) < 0) patch.ttsMode = 'assist';
    if (typeof cur.ttsAutoPlay !== 'boolean') patch.ttsAutoPlay = false;
    if (typeof cur.ttsRate !== 'number') patch.ttsRate = 1;
    if (Object.keys(patch).length) await set(patch);
  }

  function paintStatic() {
    $('settings-title').textContent = t('app_set_title', '设置');
    $('settings-back').textContent = t('app_review_back', '← 返回');
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
    const esel = $('tts-engine');
    esel.textContent = '';
    for (const e of (window.MT_TTS_ENGINES || [])) {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.labelKey ? t(e.labelKey, e.label || e.id) : (e.label || e.id);
      esel.append(o);
    }
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
    const sel = $('notes-provider');
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = ''; none.textContent = t('app_set_notes_none', '不使用');
    sel.append(none);
    for (const p of LearnNotes.chatEngines()) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label;
      sel.append(o);
    }
    // §9.4 — transcription engine for the 说 exercise. Empty = not configured =
    // the speak form does not exist. Candidates come from the generated registry.
    $('stt-title').textContent = t('stt_engine', '转写引擎');
    $('stt-engine-label').textContent = t('stt_engine', '转写引擎');
    $('stt-key-label').textContent = t('stt_api_key', '转写 API Key');
    $('stt-base-label').textContent = t('stt_base_url', '转写端点地址');
    $('stt-model-label').textContent = t('stt_model', '转写模型');
    $('btn-test-notes').textContent = t('engine_test', '测试连接');
    $('btn-test-stt').textContent = t('engine_test', '测试连接');
    $('btn-tts-test').textContent = t('tts_test', '试听一句');
    $('stt-note').textContent = t('stt_hint', '「说」题的录音会发到这里配置的端点转写，识别完立即丢弃、不存储不同步；不配置则不出「说」题。密钥只存本机。');
    const ssel = $('stt-engine');
    ssel.textContent = '';
    const snone = document.createElement('option');
    snone.value = '';
    snone.textContent = t('stt_engine_none', '未配置（不出「说」题）');
    ssel.append(snone);
    for (const e of (window.MT_STT_ENGINES || [])) {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.labelKey ? t(e.labelKey, e.label || e.id) : (e.label || e.id);
      ssel.append(o);
    }
    // 来源治理 (interaction-spec): rules follow the account (§8.9); the phone is a
    // natural place to edit them even though the app itself never captures.
    $('app-langs-title').textContent = t('learn_langs_label', '学习语言');
    $('app-langs-note').textContent = t('learn_langs_hint', '只收录选中语言的句子。Safari 无法精确识别语言时按文字系统判断；长按收藏不受限制。');
    $('app-sources-title').textContent = t('learn_sources_manage', '来源管理');
    $('corpus-title').textContent = t('app_set_corpus', '学习库');
    $('split-long').textContent = t('learn_split_long', '拆分长段卡');
    $('clean-known').textContent = t('app_set_clean_known', '清理已掌握的卡');
    $('account-title').textContent = t('app_set_account', '账号');
    $('settings-signout').textContent = t('app_set_signout', '退出登录');
    $('delete-account').textContent = t('app_set_delete', '删除账号与云端数据');
    $('delete-note').textContent = t('app_set_delete_note', '删除后，服务器上的语料与复习记录会被永久移除，账号也会注销。这台设备上已经下载的内容不受影响 —— 想一并清掉，删除 App 即可。');
  }

  const engineById = (id) =>
    (window.MT_TTS_ENGINES || []).find((e) => e.id === id) || (window.MT_TTS_ENGINES || [])[0] || null;

  // Field visibility follows the registry entry (needsKey / supportsBaseUrl /
  // supportsModel), mirroring the extension options page — one registry, N
  // consumers, no restating what an engine wants.
  function paintTtsFields(engineId) {
    const e = engineById(engineId);
    $('tts-key-field').hidden = !(e && e.needsKey);
    $('tts-base-field').hidden = !(e && e.supportsBaseUrl);
    $('tts-model-field').hidden = !(e && e.supportsModel);
    if (e) {
      $('tts-base-url').placeholder = (e.defaultEndpoint || e.placeholder) || 'https://…';
      $('tts-model').placeholder = e.defaultModel || '';
    }
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
      engineId: $('tts-engine').value || 'browser',
      apiKey: $('tts-api-key').value.trim(),
      baseUrl: $('tts-base-url').value.trim(),
      // Read straight off the form, so it is by definition the new semantics.
      baseUrlVerbatim: true,
      model: $('tts-model').value.trim(),
      voice: $('tts-voice').value,
    }));
  }

  // ─── 来源治理 (§4.1/§7.4/§8.9) ─────────────────────────────────────────
  // The shim has NO storage.onChanged, so every write repaints explicitly — the
  // same pattern as liveTtsConfigure(). Rules ride the next push as a `g` row;
  // a delete is account intent and gets a prompt forced sync (§7.4).

  async function writeRules(mutate) {
    const cur = await get(['learnRules']);
    const base = cur.learnRules || { v: 1, block: [], langs: null };
    const next = Object.assign({}, base, mutate(base), { v: 1, updatedAt: Date.now() });
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

  // 端点迁移（#147）。跑在这里而不是 chrome-shim：wire-format.js 的 legacy 分支已经保证
  // 没迁移的设备行为不变，所以它没有要抢的竞速，也不需要在 bundle 启动时就位；而它要用
  // 的按 flavor 过滤的冻结表在 providers.gen.js 里，那是 shim 之后才加载的。
  // 迁移只做两件事：让输入框里显示的就是真正会被请求的地址，以及少算一次。
  async function migrateEndpointsOnce(cur) {
    const patch = WireFormat.migrationPatch(cur);
    if (!Object.keys(patch).length) return cur;
    await set(patch);                    // 值与备份、戳同写一次 —— 覆盖是唯一不可逆的动作
    return Object.assign({}, cur, patch);
  }

  async function paint(session, say) {
    const cur = await migrateEndpointsOnce(await get(KEYS));
    $('daily').value = cur.learnDailyNew != null ? cur.learnDailyNew : 15;
    $('tts-mode').value = cur.ttsMode || 'assist';
    $('tts-engine').value = engineById(cur.ttsEngine).id;
    $('tts-api-key').value = cur.ttsApiKey || '';
    $('tts-base-url').value = cur.ttsBaseUrl || '';
    $('tts-model').value = cur.ttsModel || '';
    paintTtsFields($('tts-engine').value);
    await paintVoices(cur.ttsVoice || '');
    $('tts-auto').checked = !!cur.ttsAutoPlay;
    $('tts-rate').value = cur.ttsRate != null ? cur.ttsRate : 1;
    $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    $('notes-provider').value = cur.provider || '';
    $('notes-key').value = cur.apiKey || '';
    $('notes-base').value = cur.apiBaseUrl || '';
    $('notes-model').value = cur.apiModel || '';
    paintNotesFields(cur.provider || '');
    $('stt-engine').value = (window.MT_STT_ENGINES || []).some((e) => e.id === cur.sttEngine)
      ? cur.sttEngine : '';
    $('stt-key').value = cur.sttApiKey || '';
    $('stt-base').value = cur.sttBaseUrl || '';
    $('stt-model').value = cur.sttModel || '';
    paintSttFields($('stt-engine').value);
    $('account-who').textContent = (session && session.email) || '';

    const [stats, reviews] = await Promise.all([LearnStore.stats(), LearnStore.allReviews()]);
    $('settings-counts').textContent =
      stats.total + ' ' + t('app_unit_cards', '张卡') + ' · '
      + reviews.length + ' ' + t('app_unit_reviews', '条复习记录')
      + ' · ' + (stats.by.known || 0) + ' ' + t('app_unit_known', '已掌握');

    await paintGovernance(say);
  }

  // §9.4 — STT field visibility follows the registry entry, same rule as TTS.
  function paintSttFields(engineId) {
    const e = (window.MT_STT_ENGINES || []).find((x) => x.id === engineId) || null;
    $('stt-key-field').hidden = !(e && e.needsKey);
    $('stt-base-field').hidden = !(e && e.supportsBaseUrl);
    $('stt-model-field').hidden = !(e && e.supportsModel);
    if (e) {
      $('stt-base').placeholder = (e.defaultEndpoint || e.placeholder) || 'https://…';
      $('stt-model').placeholder = e.defaultModel || '';
    }
  }

  // Field visibility and placeholders follow the registry entry, not a hardcoded
  // idea of what engines want (§9.2: never restate what the registry knows).
  function paintNotesFields(providerId) {
    const p = LearnNotes.chatEngines().find((e) => e.id === providerId) || null;
    $('notes-key-field').hidden = !p;
    $('notes-base-field').hidden = !(p && p.supportsBaseUrl);
    $('notes-model-field').hidden = !(p && p.supportsModel);
    if (p) {
      $('notes-base').placeholder = (p.defaultEndpoint || p.placeholder) || 'https://…';
      $('notes-model').placeholder = p.defaultModel || '';
    }
  }

  function wire(opts) {
    const say = opts.say;

    // Persist on change, not behind a Save button. There is no multi-field state to
    // keep consistent here, and a Save button is one more thing to forget to press.
    $('daily').addEventListener('change', async () => {
      const n = Math.max(1, Math.min(200, parseInt($('daily').value, 10) || 15));
      $('daily').value = n;
      await set({ learnDailyNew: n });
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
        paintTtsFields(id);
        await paintVoices('');
        liveTtsConfigure();
      } finally { sel.disabled = false; }
    });
    for (const id of ['tts-api-key', 'tts-base-url', 'tts-model']) {
      $(id).addEventListener('change', async () => {
        await set({
          ttsApiKey: $('tts-api-key').value.trim(),
          ttsBaseUrl: $('tts-base-url').value.trim(),
          // 保存即新语义（见 content/wire-format.js）。
          ttsBaseUrlVerbatim: true,
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
        apiKey: $('notes-key').value.trim(),
        apiBaseUrl: $('notes-base').value.trim(),
        apiBaseUrlVerbatim: true,
        apiModel: $('notes-model').value.trim(),
      };
      await set(cfgNow);
      LearnNotes.configure({
        provider: cfgNow.provider, apiKey: cfgNow.apiKey,
        baseUrl: cfgNow.apiBaseUrl, baseUrlVerbatim: true, model: cfgNow.apiModel,
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
      const cleared = clearEndpointOnEngineSwitch('notes-base');
      paintNotesFields($('notes-provider').value);
      await saveNotesCfg();
      if (cleared) say(t('toast_endpoint_cleared', '换引擎了，接口地址已清空'));
    });
    for (const id of ['notes-key', 'notes-base', 'notes-model']) {
      $(id).addEventListener('change', saveNotesCfg);
    }

    // §9.4 in the app: write the SAME keys review.js reads and reconfigure
    // LearnSpeech immediately — capable() is re-asked per card, so the next card
    // picks a freshly configured engine up live (same reasoning as the notes key).
    async function saveSttCfg() {
      const c = {
        sttEngine: $('stt-engine').value,
        sttApiKey: $('stt-key').value.trim(),
        sttBaseUrl: $('stt-base').value.trim(),
        sttBaseUrlVerbatim: true,
        sttModel: $('stt-model').value.trim(),
      };
      await set(c);
      if (typeof LearnSpeech !== 'undefined') {
        LearnSpeech.configure({
          engineId: c.sttEngine, apiKey: c.sttApiKey,
          baseUrl: c.sttBaseUrl, baseUrlVerbatim: true, model: c.sttModel,
        });
      }
    }
    $('stt-engine').addEventListener('change', async () => {
      const cleared = clearEndpointOnEngineSwitch('stt-base');
      paintSttFields($('stt-engine').value);
      await saveSttCfg();
      if (cleared) say(t('toast_endpoint_cleared', '换引擎了，接口地址已清空'));
    });
    for (const id of ['stt-key', 'stt-base', 'stt-model']) {
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
        note.textContent = r.ok ? t('tts_test_ok', '播放中') : ('✗ ' + (r.reason || ''));
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
