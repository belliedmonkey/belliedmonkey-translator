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
  const KEYS = ['learnEnabled', 'learnDailyNew',
    'ttsMode', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsAutoPlay', 'ttsRate',
    // §9.2 — the notes gate reads these (review.js:35). Same keys, same storage.
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel'];

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
    $('corpus-title').textContent = t('app_set_corpus', '学习库');
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
      $('tts-base-url').placeholder = e.defaultBase || 'https://…';
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
      model: $('tts-model').value.trim(),
      voice: $('tts-voice').value,
    }));
  }

  async function paint(session, say) {
    const cur = await get(KEYS);
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
    $('account-who').textContent = (session && session.email) || '';

    const [stats, reviews] = await Promise.all([LearnStore.stats(), LearnStore.allReviews()]);
    $('settings-counts').textContent =
      stats.total + ' ' + t('app_unit_cards', '张卡') + ' · '
      + reviews.length + ' ' + t('app_unit_reviews', '条复习记录')
      + ' · ' + (stats.by.known || 0) + ' ' + t('app_unit_known', '已掌握');
  }

  // Field visibility and placeholders follow the registry entry, not a hardcoded
  // idea of what engines want (§9.2: never restate what the registry knows).
  function paintNotesFields(providerId) {
    const p = LearnNotes.chatEngines().find((e) => e.id === providerId) || null;
    $('notes-key-field').hidden = !p;
    $('notes-base-field').hidden = !(p && p.supportsBaseUrl);
    $('notes-model-field').hidden = !(p && p.supportsModel);
    if (p) {
      $('notes-base').placeholder = p.defaultBase || '';
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
      const id = $('tts-engine').value;
      // Voice names don't carry across engines (a voiceURI means nothing to a
      // speech endpoint, 'alloy' means nothing to the system) — reset it.
      await set({ ttsEngine: id, ttsVoice: '' });
      paintTtsFields(id);
      await paintVoices('');
      liveTtsConfigure();
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
        apiKey: $('notes-key').value.trim(),
        apiBaseUrl: $('notes-base').value.trim(),
        apiModel: $('notes-model').value.trim(),
      };
      await set(cfgNow);
      LearnNotes.configure({
        provider: cfgNow.provider, apiKey: cfgNow.apiKey,
        baseUrl: cfgNow.apiBaseUrl, model: cfgNow.apiModel,
      });
    }
    $('notes-provider').addEventListener('change', async () => {
      paintNotesFields($('notes-provider').value);
      await saveNotesCfg();
    });
    for (const id of ['notes-key', 'notes-base', 'notes-model']) {
      $(id).addEventListener('change', saveNotesCfg);
    }

    $('clean-known').addEventListener('click', async () => {
      // §7.1's targeted cleanup: drop what the scheduler itself concluded you no
      // longer need. Never a starred card, never one being actively learned.
      const n = await LearnStore.clearKnown().catch(() => 0);
      await paint(opts.session(), say);
      say(n
        ? t('app_set_cleaned', '已清理 {n} 张').replace('{n}', String(n))
        : t('app_set_clean_none', '没有可清理的卡'));
    });

    $('settings-signout').addEventListener('click', opts.onSignOut);

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
