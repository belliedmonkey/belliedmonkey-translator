// extension/onboard/onboard.js — 扩展侧的首次引导。
//
// 内容是 App 六屏的**逆**：App 做了它能做的三屏（选语言 / 去装扩展 / 去登录），
// 这里做 App 结构上做不到的那三件事 —— 配引擎、开采集、翻第一页。
//
// 每一屏都是**真控件**，不是说明文字。理由在 app/app.js:256-262 那段注释里已经论证过：
// 一个「告诉你去哪里点」的引导，把用户送出去之后就失去了他；一个「就在这里点」的引导
// 不会。所以第 2 屏直接写 chrome.storage、第 3 屏直接开采集开关。
(() => {
  const $ = (id) => document.getElementById(id);
  const PROVIDERS = window.MT_PROVIDERS || [];

  // ── i18n：与 options.js:42-71 同一套（bundled 表 → chrome.i18n → 标记里的兜底）──
  let _uiLang = 'auto';
  function normalizeLocale(tag) {
    const T = window.MT_I18N_MESSAGES || {};
    if (!tag) return '';
    const s = String(tag).replace(/-/g, '_');
    if (T[s]) return s;
    const base = s.split('_')[0];
    if (base === 'zh') return T.zh_CN ? 'zh_CN' : (T.zh_TW ? 'zh_TW' : '');
    if (T[base]) return base;
    for (const k of Object.keys(T)) if (k.split('_')[0] === base) return k;
    return '';
  }
  function effectiveLocale() {
    if (_uiLang && _uiLang !== 'auto') { const n = normalizeLocale(_uiLang); if (n) return n; }
    try { const n = normalizeLocale(chrome.i18n.getUILanguage()); if (n) return n; } catch (_) {}
    return 'zh_CN';
  }
  const t = (key, fb) => {
    try {
      const T = window.MT_I18N_MESSAGES;
      if (T) { const loc = effectiveLocale(); const m = T[loc] && T[loc][key]; if (m) return m; }
      const cm = chrome.i18n.getMessage(key); if (cm) return cm;
    } catch (_) {}
    return fb;
  };
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const m = t(el.dataset.i18n, ''); if (m) el.textContent = m;
    });
    const dt = t('extob_header', ''); if (dt) document.title = dt;
  }

  // ── 存储：与 request-shape.js 的 storageGet 同一个理由 ────────────────────────
  // 只在回调里 resolve 的 promise，遇上「回调根本不来」就永不落地（2026-08-29 真机实测
  // 过这一族）。这里的读发生在渲染第一屏之前，卡住就是白屏。
  const STORAGE_TIMEOUT_MS = 3000;
  function storageGet(keys, fallback) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const timer = setTimeout(() => done(fallback), STORAGE_TIMEOUT_MS);
      const finish = (v) => { clearTimeout(timer); done(v); };
      try {
        chrome.storage.local.get(keys, (res) => {
          try { finish(res || fallback); } catch (_) { finish(fallback); }
        });
      } catch (_) { finish(fallback); }
    });
  }
  const storageSet = (obj) => new Promise((r) => {
    try { chrome.storage.local.set(obj, () => r()); } catch (_) { r(); }
  });

  // ── 屏序 ────────────────────────────────────────────────────────────────────
  // 第 5 屏（sync）按 MT_BACKEND.enabled 决定是否存在。中国版的产物里那个值是 false
  // （build.js 在构建时翻的），所以那一屏自动消失、进度条分母自动变 4 ——
  // **这是免费的正确性**：那个值本来就是 flavor 正确的，不需要在这里判 flavor 名。
  const syncOn = !!(window.MT_BACKEND && window.MT_BACKEND.enabled);
  const OB = ['welcome', 'engine', 'capture', 'try'].concat(syncOn ? ['sync'] : []);
  let at = 0;
  let settings = {};
  let learnRules = null;

  // 免费通道是按**注册表内容**判的，不是按 flavor 名 —— 沿用 app/app.js:308-312 已经
  // 确立的规则。中国版注册表里一个 needsKey:false 都没有，所以第 2 屏对它是必经。

  // 这一页要读的键。**必须覆盖 QuickSetup.state() 判「配没配过」看的那三个**
  // （apiKey / ttsApiKey / sttEngine）—— 原来这份清单里没有后两个，于是朗读和转写在
  // 引导页上永远判成「没配过」，从设置页点「重看引导」再按一次一键配置，会把已配好的
  // 音色、模型、自定义端点全部清掉，同时显示 ✓。
  //
  // ttsAutoPlay 也要读，而且**不许给默认值**：undefined = 从没选过，是 plan() 用来
  // 决定要不要写 false 防止持续扣费的判据。给了默认值那道保护就没了，且测试全绿。
  const SETTINGS_KEYS = [
    'provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'engineChosen',
    'ttsEngine', 'ttsApiKey', 'ttsBaseUrl', 'ttsModel', 'ttsMode', 'ttsAutoPlay',
    'sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel',
    'learnEnabled', 'learnRules', 'uiLang', 'targetLang',
  ];

  // 一键卡在**点下按钮那一刻**用它现读一次，而不是拿加载时的快照。
  // 读失败必须报失败，不能回落成 {} —— 空档案会被 state() 判成「什么都没配过」，
  // 然后照着这个判断覆盖存储。page-settings.js 的文件头用 27 行论证过同一件事。
  const readSettings = () => (typeof PageSettings !== 'undefined'
    ? PageSettings.read(SETTINGS_KEYS)
    : storageGet(SETTINGS_KEYS, null).then((d) => ({ ok: !!d, data: d || {} })));


  function paint() {
    const step = OB[at];
    $('ob-fill').style.width = Math.round(((at + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-modes', 'ob-quick', 'ob-manual', 'ob-cta', 'ob-capture', 'ob-cta-note']) $(id).hidden = true;
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-skip').hidden = false;   // 只有 'try' 屏藏这两个，别的屏要放回来
    $('ob-next').textContent = at === OB.length - 1 ? t('extob_finish', '完成') : t('ob_next', '继续');
    $('ob-next').hidden = false;

    if (step === 'welcome') {
      $('ob-title').textContent = t('extob_welcome_title', '边读边记，不用离开页面');
      $('ob-text').textContent = t('extob_welcome_body',
        '原文留在原地，译文长在下面。你真正停下来读完的句子会变成复习卡，按遗忘曲线回来找你。');
      $('ob-next').textContent = t('ob_start', '开始设置');
    } else if (step === 'engine') {
      $('ob-title').textContent = t('extob_engine_title', '选一个翻译引擎');
      // 不再按「有没有免费通道」分支。2026-09-01 裁定：决策不为免费通道开特例，
      // 第一优先级是一键配置 —— 原来那句「免费通道零配置就能用」正是在劝人别配。
      // 免费引擎仍然选得到（在「三引擎分别配」里），只是不再由我们推荐。
      $('ob-text').textContent = t('extob_engine_body_key', '这一步躲不掉：不填 key 就一个字也翻不出来。');
      paintModes();
    } else if (step === 'capture') {
      $('ob-title').textContent = t('extob_capture_title', '要不要顺便把读过的句子记下来');
      $('ob-text').textContent = t('extob_capture_body',
        '默认是关的。打开之后，你真正读完的句子（快速滚过去的不算）会存成复习卡。');
      $('ob-capture').hidden = false;
      paintCapture();
    } else if (step === 'try') {
      $('ob-title').textContent = t('extob_try_title', '现在翻一页看看');
      $('ob-text').textContent = t('extob_try_body',
        '打开一页真实网页，点右下角的悬浮按钮，原文下面就会出现译文。');
      $('ob-cta').hidden = false;
      $('ob-cta').textContent = t('extob_try_cta', '打开示例页面');
      // 这一屏**只有这一个按钮**。「继续」在这里是「配好了但不去看」，
      // 「以后再设置」是「配好了但不用」—— 都在跟这一屏唯一想让人做的事抢注意力。
      $('ob-next').hidden = true;
      $('ob-skip').hidden = true;
      $('ob-cta').onclick = () => {
        // 地址走 QuickSetup.siteUrl —— 设置页的「现在翻一页看看」去的是同一页，
        // 两处各写一份 flavor→域名 的映射迟早会漂。
        window.open(QuickSetup.siteUrl('/setup.html'), '_blank', 'noopener');
        // 它同时是前进键：这一屏没有别的出口，不然点了它的人（也就是照做的人）
        // 会卡在这里，后面那屏（登录同步）再也到不了。中国版没有那一屏，这里就是
        // 收尾 —— 必须走 finish()，否则 extObSeen 不写，弹窗会一直提示「第一次用？」。
        if (at < OB.length - 1) { at += 1; paint(); } else finish();
      };
    } else if (step === 'sync') {
      $('ob-title').textContent = t('extob_sync_title', '换台设备接着复习');
      $('ob-text').textContent = t('extob_sync_body',
        '不登录也能完整使用，所有数据留在本机。登录只在你想让手机接着复习电脑上读到的句子时才需要。');
      $('ob-cta').hidden = false;
      $('ob-cta').textContent = t('extob_sync_cta', '打开设置去登录');
      $('ob-cta').onclick = () => { try { chrome.runtime.openOptionsPage(); } catch (_) {} };
      $('ob-cta-note').hidden = false;
      // 只说 App 真正独有的两件事。**不要**把「跨设备同步」写成 App 独有 ——
      // 扩展↔扩展也有，那是假话。
      $('ob-cta-note').textContent = t('extob_app_note',
        '想在手机上复习、或者边走边听播客模式？那两样在 iPhone / Mac 的 App 里。');
    }
  }

  // ── 第 2 屏：两条互斥的路 ───────────────────────────────────────────────────
  //
  // 裁定（docs/interaction-spec.md）：一键配置与逐引擎配置**永不同屏**。共存时，
  // 用户在下面改了引擎，上面那张卡显示的「已配过 / 没配过」当场变成谎话，而它下一次
  // 被按下就会照着那份谎话覆盖存储。所以这里是两个互斥 tab，不是一个折叠。
  //
  // 默认「一键配置」——最短的那条路。**不持久化**：这是一次性流程里的一个瞬时选择，
  // 不是配置。
  let manualMode = false;

  // 「一把 key 配好全部」与「三引擎分别配」都写局部 patch（storageSet），
  // **不是** options.js 的 saveAll()：那一份是整体覆盖式的，而这一页没有
  // notes / 音色 / 语速 的控件，覆盖会把它们全部清空。
  let quickMounted = false;
  function paintQuick() {
    const box = $('ob-quick');
    if (!box || typeof QuickSetup === 'undefined') return false;
    if (!quickMounted) {
      QuickSetup.render(box, {
        t,
        readSettings,
        sub: t('extob_quick_sub', '一把 key 就能同时配好翻译、朗读、转写。'),
        onApply: async (plan) => {
          await storageSet(plan.writes);
          Object.assign(settings, plan.writes);
          manualMounted = false;          // 三引擎那一页要按新值重画
          $('ob-manual').textContent = '';
        },
      });
      quickMounted = true;
    }
    box.hidden = !box.children.length;
    return !box.hidden;
  }

  // 三引擎分别配。控件由 EngineFields 生成 —— 与设置页**同一个组件、同一套 id**，
  // 所以两边以后是一起改的。
  let manualMounted = false;
  function paintManual() {
    const box = $('ob-manual');
    if (!box || typeof EngineFields === 'undefined') return;
    if (manualMounted) return;
    box.textContent = '';
    for (const slot of ['chat', 'tts', 'stt']) {
      EngineFields.render(box, {
        slot,
        t,
        values: settings,
        // 每改一个字段就落一次盘。**不防抖**中的那一半：输入框自己在组件里挂的是
        // input 事件（change 只在失焦时触发，用户填完直接点「继续」就丢了）。
        onChange: async (patch) => {
          Object.assign(settings, patch);
          // 在这一页选引擎就是一次**主动选择** —— 出厂默认不算。故意选了免费引擎的人
          // 必须能满足「配好了」，否则悬浮球会一直把他弹回这一页。见 engine-state.js。
          if (slot === 'chat' && 'provider' in patch) {
            patch = Object.assign({}, patch, { engineChosen: 1 });
            settings.engineChosen = 1;
          }
          await storageSet(patch);
        },
      });
    }
    manualMounted = true;
  }

  function paintModes() {
    const quickShown = paintQuick();
    // 一键卡渲染不出来的 flavor：没有可选的东西，就不给一个只有一边的二选一。
    $('ob-modes').hidden = !quickShown;
    const manual = manualMode || !quickShown;
    if (manual) paintManual();
    $('ob-quick').hidden = manual || !quickShown;
    $('ob-manual').hidden = !manual;
    $('ob-mode-quick').textContent = t('extob_mode_quick', '一键配置');
    $('ob-mode-manual').textContent = t('extob_mode_manual', '三引擎分别配');
    $('ob-mode-quick').setAttribute('aria-selected', String(!manual));
    $('ob-mode-manual').setAttribute('aria-selected', String(manual));
  }
  $('ob-mode-quick').addEventListener('click', () => { manualMode = false; paintModes(); });
  $('ob-mode-manual').addEventListener('click', () => { manualMode = true; paintModes(); });

  // ── 第 3 屏：真的采集开关 + 语言 chips ──────────────────────────────────────
  function paintCapture() {
    $('ob-learn').checked = settings.learnEnabled === true;
    $('ob-capture-note').textContent = t('extob_capture_note',
      '只收录你真正停下来读完的句子。随时可以在设置里关掉，已存的卡也能整站删除。');
    renderChips();
  }
  function renderChips() {
    const box = $('ob-langs');
    if (!box || !window.SourcesView) return;
    box.hidden = !$('ob-learn').checked;
    if (box.hidden) return;
    window.SourcesView.renderLangChips(box, {
      registry: window.MT_LANGS || [],
      langs: learnRules && learnRules.langs,
      t,
      // 必须把 promise 交回去：SourcesView 的 lock() 靠它决定 chip 何时重新可点，
      // 丢掉它会重开「两次快点丢一个语言」那个竞态（options.js:1106-1109 的疤）。
      onChange: (langs) => {
        learnRules = Object.assign({}, learnRules, { langs });
        return storageSet({ learnRules });
      },
    });
  }
  $('ob-learn').addEventListener('change', async () => {
    settings.learnEnabled = $('ob-learn').checked;
    await storageSet({ learnEnabled: settings.learnEnabled });
    renderChips();
  });

  // ── 导航 ────────────────────────────────────────────────────────────────────
  $('ob-next').addEventListener('click', () => {
    if (at < OB.length - 1) { at += 1; paint(); return; }
    finish();
  });
  $('ob-skip').addEventListener('click', finish);
  async function finish() {
    await storageSet({ extObSeen: 1 });
    $('onboard').hidden = true;
    $('ob-done').hidden = false;
    $('ob-done-title').textContent = t('extob_done_title', '设置好了');
    $('ob-done-text').textContent = t('extob_done_text',
      '打开任意外语网页，点右下角的悬浮按钮即可。想改设置或重看这段引导，都在扩展的设置页里。');
    $('ob-done-close').textContent = t('extob_done_close', '知道了');
  }
  $('ob-done-close').addEventListener('click', () => { try { window.close(); } catch (_) {} });

  // ── 启动 ────────────────────────────────────────────────────────────────────
  (async () => {
    const r = await readSettings();
    settings = r.data || {};
    _uiLang = settings.uiLang || 'auto';
    learnRules = settings.learnRules || null;
    applyI18n();
    paint();
  })();
})();
