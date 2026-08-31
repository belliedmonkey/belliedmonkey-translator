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
  const freeChannel = PROVIDERS.some((p) => p && !p.needsKey);

  const providerById = (id) => PROVIDERS.find((p) => p.id === id);
  const providerLabel = (p) => (p.labelKey ? t(p.labelKey, p.label || p.id) : (p.label || p.id));

  function paint() {
    const step = OB[at];
    $('ob-fill').style.width = Math.round(((at + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-quick', 'ob-engine', 'ob-engine-toggle', 'ob-cta', 'ob-capture', 'ob-cta-note']) $(id).hidden = true;
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-next').textContent = at === OB.length - 1 ? t('extob_finish', '完成') : t('ob_next', '继续');
    $('ob-next').hidden = false;

    if (step === 'welcome') {
      $('ob-title').textContent = t('extob_welcome_title', '边读边记，不用离开页面');
      $('ob-text').textContent = t('extob_welcome_body',
        '原文留在原地，译文长在下面。你真正停下来读完的句子会变成复习卡，按遗忘曲线回来找你。');
      $('ob-next').textContent = t('ob_start', '开始设置');
    } else if (step === 'engine') {
      $('ob-title').textContent = t('extob_engine_title', '选一个翻译引擎');
      $('ob-text').textContent = freeChannel
        ? t('extob_engine_body_free', '免费通道零配置就能用。想要更好的质量，填入你自己的 API Key。')
        : t('extob_engine_body_key', '这一步躲不掉：不填 Key 就翻不出任何东西。');
      // paintEngine 无论露不露都要跑：展开的那一刻不该看到一个空下拉。
      paintEngine();
      // 一键卡在，手动填就收起来（与设置页同一条裁定）；一键卡不在，它就是唯一入口。
      const quickShown = paintQuick();
      $('ob-engine').hidden = quickShown && !engineExpanded;
      $('ob-engine-toggle').hidden = !quickShown || engineExpanded;
      $('ob-engine-toggle').textContent = t('extob_engine_manual', '用别的引擎？手动填 ▾');
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
      $('ob-cta').onclick = () => {
        // 地址走 QuickSetup.siteUrl —— 设置页的「现在翻一页看看」去的是同一页，
        // 两处各写一份 flavor→域名 的映射迟早会漂。
        window.open(QuickSetup.siteUrl('/setup.html'), '_blank', 'noopener');
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

  // ── 第 2 屏：真的引擎设置 ───────────────────────────────────────────────────
  function paintEngine() {
    const sel = $('ob-provider');
    if (!sel.options.length) {
      for (const p of PROVIDERS) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = providerLabel(p);
        sel.appendChild(o);
      }
    }
    sel.value = settings.provider || (PROVIDERS[0] && PROVIDERS[0].id) || '';
    $('ob-key').value = settings.apiKey || '';
    syncKeyRow();
    $('ob-test').textContent = t('engine_test', '测试连接');
  }

  // 「手动填」的展开是**一次性**的：展开过就一直开着。收回去会把用户刚填了一半的
  // Key 藏起来，那比多占一屏糟得多。
  let engineExpanded = false;

  // 「一把 key 配好全部」——与设置页**同一个组件**。
  //
  // onApply 走局部写（storageSet），**不是** options.js 的 saveAll()：这一页没有
  // tts/stt/notes 的控件，整体覆盖式的保存会把它们全部清空。写完重画第 2 屏，
  // 否则用户会在同一屏上同时看到「已配好 OpenRouter」和一个还写着别的引擎的下拉。
  let quickMounted = false;
  function paintQuick() {
    const box = $('ob-quick');
    if (!box || typeof QuickSetup === 'undefined') return;
    if (!quickMounted) {
      QuickSetup.render(box, {
        t,
        settings,
        sub: t('extob_quick_sub',
          '一把 key 就能同时配好翻译、朗读、转写。想用别的引擎，展开下面手动填。'),
        onApply: async (plan) => {
          await storageSet(plan.writes);
          Object.assign(settings, plan.writes);
          paintEngine();
        },
      });
      quickMounted = true;
    }
    box.hidden = !box.children.length;
    return !box.hidden;
  }
  function syncKeyRow() {
    const p = providerById($('ob-provider').value);
    const needs = !p || p.needsKey !== false;
    $('ob-key-row').hidden = !needs;
    $('ob-engine-note').textContent = needs
      ? t('setup_need_key', '这个引擎需要 API Key。填入下面的 Key 之后翻译才会工作。')
      : t('setup_free_channel', '当前使用免费通道，不需要 API Key —— 适合先看看效果。');
  }
  $('ob-engine-toggle').addEventListener('click', () => {
    engineExpanded = true;
    $('ob-engine').hidden = false;
    $('ob-engine-toggle').hidden = true;
  });
  $('ob-provider').addEventListener('change', async () => {
    syncKeyRow();
    await storageSet({ provider: $('ob-provider').value });
    settings.provider = $('ob-provider').value;
  });
  // input 而不是 change：change 只在失焦时触发，用户填完直接点「继续」就丢了。
  // 这是 2026-08-30 在 options.js 上修过的同一个缺陷，不要在新代码里重犯。
  let keyTimer = null;
  $('ob-key').addEventListener('input', () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(async () => {
      settings.apiKey = $('ob-key').value.trim();
      await storageSet({ apiKey: settings.apiKey });
    }, 400);
  });
  $('ob-test').addEventListener('click', async () => {
    const out = $('ob-test-out');
    out.hidden = false;
    out.textContent = t('toast_translating', '翻译中…');
    try {
      // noCache: 一个可能不发请求的「测试连接」是有害的，不是省事 —— 它会在端点其实是
      // 坏的时候报「通了」。同 options.js:824 的理由。
      const s = await storageGet(['targetLang', 'apiBaseUrl', 'apiModel'], {});
      // 走共用的 EngineTest：这里原本是第六份手写实现，同一个 401 在设置页上显示
      // 完整失败码表 + 服务端原话 + 请求地址 + 通路，在这一页只显示「✗ Load failed」。
      const r = await EngineTest.translation({
        provider: $('ob-provider').value, apiKey: $('ob-key').value.trim(),
        baseUrl: s.apiBaseUrl || '', model: s.apiModel || '', targetLang: s.targetLang || 'zh-CN',
      });
      out.textContent = EngineTest.format(r, null, t);
    } catch (e) {
      out.textContent = EngineTest.format(null, e, t);
    }
  });

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
    const s = await storageGet(
      ['provider', 'apiKey', 'learnEnabled', 'learnRules', 'uiLang', 'targetLang'], {});
    settings = s || {};
    _uiLang = settings.uiLang || 'auto';
    learnRules = settings.learnRules || null;
    applyI18n();
    paint();
  })();
})();
