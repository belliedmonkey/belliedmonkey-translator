// app/settings.js — the learning layer's own settings, in the app.
//
// Scope is plan §F's split, not "everything the extension has": the app owns the
// REVIEW loop's knobs, the account, and the corpus. Translation engine / API key /
// custom endpoint stay browser-side, because those are per-browser credentials for a
// thing this app never does.
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
    ttsAuto: '显示译文时自动朗读',
    ttsRate: '朗读速度',
    ttsNote: '朗读引擎与语音仍在浏览器扩展的设置页里配置 —— 那些是每个浏览器各自的凭证，'
      + '这里改了也不会跟着你走。',
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
  const KEYS = ['learnEnabled', 'learnDailyNew', 'ttsAutoPlay', 'ttsRate'];

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
    if (typeof cur.ttsAutoPlay !== 'boolean') patch.ttsAutoPlay = false;
    if (typeof cur.ttsRate !== 'number') patch.ttsRate = 1;
    if (Object.keys(patch).length) await set(patch);
  }

  function paintStatic() {
    $('settings-title').textContent = t('title');
    $('settings-back').textContent = t('back');
    $('daily-label').textContent = t('daily');
    $('tts-auto-label').textContent = t('ttsAuto');
    $('tts-rate-label').textContent = t('ttsRate');
    $('tts-note').textContent = t('ttsNote');
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
    $('tts-auto').checked = !!cur.ttsAutoPlay;
    $('tts-rate').value = cur.ttsRate != null ? cur.ttsRate : 1;
    $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    $('account-who').textContent = (session && session.email) || '';

    const [stats, reviews] = await Promise.all([LearnStore.stats(), LearnStore.allReviews()]);
    $('settings-counts').textContent =
      stats.total + ' ' + t('cards') + ' · ' + reviews.length + ' ' + t('reviews')
      + ' · ' + (stats.by.known || 0) + ' ' + t('known');
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
    $('tts-auto').addEventListener('change', () => set({ ttsAutoPlay: $('tts-auto').checked }));
    $('tts-rate').addEventListener('input', () => {
      $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    });
    $('tts-rate').addEventListener('change', () => set({ ttsRate: Number($('tts-rate').value) }));

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
