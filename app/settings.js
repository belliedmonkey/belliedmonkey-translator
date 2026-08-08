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

  const T = {
    title: '设置',
    back: '← 返回',
    daily: '每天最多学几张新卡',
    ttsMode: '语音模式',
    ttsModeOff: '关闭',
    ttsModeAssist: '显示原文，可点播放',
    ttsModeAudioFirst: '先听后看（原文先隐藏）',
    ttsAuto: '显示译文时自动朗读',
    ttsRate: '朗读速度',
    ttsNote: '朗读引擎与语音仍在浏览器扩展的设置页里配置 —— 那些是每个浏览器各自的凭证，'
      + '这里改了也不会跟着你走。',
    notesTitle: '句子解析',
    notesProvider: '解析引擎',
    notesNone: '不使用',
    notesKey: 'API Key',
    notesBase: '自定义接口地址',
    notesModel: '模型',
    notesNote: '仅用于生成句子解析（生词 / 短语 / 语法），调用你自己的 API。'
      + '密钥只存在这台设备上，不随账号同步；与浏览器扩展里配置的密钥互不相通，'
      + '安全性也相同 —— 都是本机明文保存。',
    corpus: '学习库',
    cleanKnown: '清理已掌握的卡',
    cleaned: (n) => n ? ('已清理 ' + n + ' 张') : '没有可清理的卡',
    account: '账号',
    signout: '退出登录',
    deleteAccount: '删除账号与云端数据',
    deleteNote: '删除后，服务器上的语料与复习记录会被永久移除，账号也会注销。'
      + '这台设备上已经下载的内容不受影响 —— 想一并清掉，删除 App 即可。',
    confirmDelete: '确定要删除账号吗？服务器上的所有内容会被永久移除，无法恢复。',
    deleting: '正在删除…',
    deleted: '账号已删除。',
    cards: '张卡', reviews: '条复习记录', known: '已掌握',
  };
  const t = (k) => T[k] || k;

  // The keys `review.js` and `tts.js` actually read (review.js:28-29). Named here so
  // a rename over there fails loudly at the next read rather than silently reverting
  // a user's setting to a default.
  const KEYS = ['learnEnabled', 'learnDailyNew', 'ttsMode', 'ttsAutoPlay', 'ttsRate',
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
    $('settings-title').textContent = t('title');
    $('settings-back').textContent = t('back');
    $('daily-label').textContent = t('daily');
    $('tts-mode-label').textContent = t('ttsMode');
    $('tts-mode-off').textContent = t('ttsModeOff');
    $('tts-mode-assist').textContent = t('ttsModeAssist');
    $('tts-mode-audio-first').textContent = t('ttsModeAudioFirst');
    $('tts-auto-label').textContent = t('ttsAuto');
    $('tts-rate-label').textContent = t('ttsRate');
    $('tts-note').textContent = t('ttsNote');
    $('notes-title').textContent = t('notesTitle');
    $('notes-provider-label').textContent = t('notesProvider');
    $('notes-key-label').textContent = t('notesKey');
    $('notes-base-label').textContent = t('notesBase');
    $('notes-model-label').textContent = t('notesModel');
    $('notes-note').textContent = t('notesNote');
    // The picker lists chat-capable engines ONLY, and asks LearnNotes which those
    // are — the gate and the picker share one definition, so they cannot drift.
    // Labels come from the registry; nothing engine-specific is restated here.
    const sel = $('notes-provider');
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = ''; none.textContent = t('notesNone');
    sel.append(none);
    for (const p of LearnNotes.chatEngines()) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label;
      sel.append(o);
    }
    $('corpus-title').textContent = t('corpus');
    $('clean-known').textContent = t('cleanKnown');
    $('account-title').textContent = t('account');
    $('settings-signout').textContent = t('signout');
    $('delete-account').textContent = t('deleteAccount');
    $('delete-note').textContent = t('deleteNote');
  }

  async function paint(session, say) {
    const cur = await get(KEYS);
    $('daily').value = cur.learnDailyNew != null ? cur.learnDailyNew : 15;
    $('tts-mode').value = cur.ttsMode || 'assist';
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
      stats.total + ' ' + t('cards') + ' · ' + reviews.length + ' ' + t('reviews')
      + ' · ' + (stats.by.known || 0) + ' ' + t('known');
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
    $('tts-auto').addEventListener('change', () => set({ ttsAutoPlay: $('tts-auto').checked }));
    $('tts-rate').addEventListener('input', () => {
      $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    });
    $('tts-rate').addEventListener('change', () => set({ ttsRate: Number($('tts-rate').value) }));

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
      say(t('cleaned')(n));
    });

    $('settings-signout').addEventListener('click', opts.onSignOut);

    $('delete-account').addEventListener('click', async () => {
      // Destructive and irreversible, so it asks — and the question names what goes,
      // rather than a generic 「确定吗」 that the user answers without reading.
      if (!window.confirm(t('confirmDelete'))) return;
      $('delete-account').disabled = true;
      say(t('deleting'));
      try {
        await LearnAuth.deleteAccount();
        say(t('deleted'));
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
