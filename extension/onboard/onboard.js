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
  // 屏序：四屏，两个 flavor 同形。
  //
  // **登录不在引导里**（2026-09-02 用户裁定）。它曾经是第 4 屏，排在「翻一页」之前 ——
  // 也就是在人看到第一句译文之前，先要他填邮箱、收验证码。现在登录的请求由官网交接块
  // 在**翻译成功那一刻**提出，并由复习页那行「未登录」接住；两处都在他已经看到价值
  // 之后。这也正是 2026-09-01「官网试翻页上就地给」那条裁定的落点。
  //
  // try 仍是**终止屏**：它唯一的按钮开一个新标签，人就走了，引导这个标签留在背后。
  // 所以它必须排最后，而且它的 CTA 同时是收尾键（finish 写 extObSeen）。
  const OB = ['welcome', 'engine', 'capture', 'try'];
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
    // 把当前步骤 id 挂到 DOM 上。门禁原来靠「第一个带 CTA 的屏」来认 try 屏 ——
    // 那是个代理，2026-09-01 把 sync 挪到 try 前面时它就指错了屏，而断言照样在跑。
    // 页面自报身份之后，断言问的是「try 屏怎么样」，不是「看起来像 try 的那屏」。
    try { document.body.dataset.obStep = step; } catch (_) {}
    $('ob-fill').style.width = Math.round(((at + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-steps', 'ob-modes', 'ob-quick', 'ob-manual', 'ob-cta', 'ob-capture']) $(id).hidden = true;
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-skip').hidden = false;   // 只有 'try' 屏藏这两个，别的屏要放回来
    $('ob-next').textContent = at === OB.length - 1 ? t('extob_finish', '完成') : t('ob_next', '继续');
    $('ob-next').hidden = false;
    // 主/次逐屏重设，不留状态（同 app/app.js 的写法）。默认「继续」是这一屏的主行动；
    // 有 #ob-cta 的屏会在下面把它降级 —— 两个填色按钮并排时，用户看不出该点哪个。
    $('ob-next').classList.remove('secondary');

    if (step === 'welcome') {
      $('ob-title').textContent = t('extob_welcome_title', '边读边记，不用离开页面');
      $('ob-text').textContent = t('extob_welcome_body',
        '原文留在原地，译文长在下面。你真正停下来读完的句子会变成复习卡，按遗忘曲线回来找你。');
      $('ob-next').textContent = t('ob_start', '开始设置');
      paintSteps();
    } else if (step === 'engine') {
      $('ob-title').textContent = t('extob_engine_title', '选一个翻译引擎');
      // 不再按「有没有免费通道」分支。2026-09-01 裁定：决策不为免费通道开特例，
      // 第一优先级是一键配置 —— 原来那句「免费通道零配置就能用」正是在劝人别配。
      // 免费引擎仍然选得到（在「三引擎分别配」里），只是不再由我们推荐。
      $('ob-text').textContent = t('extob_engine_body_key', '这一步躲不掉：不填 key 就一个字也翻不出来。');
      paintModes();
      // 这一屏的主行动是**配好**（一键卡的「配好翻译、朗读、转写」，或手动区的三个
      // 「测试连接」），「继续」是「先不配、往下走」。两个填色按钮并排时用户看不出
      // 该点哪个 —— 2026-09-02 靠一张截图才发现，而当时的门禁只数页脚那三个按钮，
      // 一键卡的按钮在 body 里，它看不见。
      $('ob-next').classList.add('secondary');
    } else if (step === 'capture') {
      $('ob-title').textContent = t('extob_capture_title', '读过的句子会自己变成复习卡');
      $('ob-text').textContent = t('extob_capture_body',
        '已经开着了。你真正读完的句子（快速滚过去的不算）会存成复习卡，只存在这台设备上；不想要可以在这里关掉。');
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
        // 地址走 QuickSetup.tryUrl —— 设置页的「现在翻一页看看」去的是同一页，
        // 两处各写一份 flavor→域名 的映射迟早会漂。按**目标语言**选页：目标是英文的
        // 人打开一页英文示例，看到的是英文翻英文。
        window.open(QuickSetup.tryUrl(settings.targetLang), '_blank', 'noopener');
        // 它同时是收尾键。try 现在**永远是最后一屏**（见上面 OB 的注释：它是终止屏，
        // 点下去人就去了另一个标签），所以这里必须 finish() —— 否则 extObSeen 不写，
        // 弹窗会一直提示「第一次用？」。
        finish();
      };
    }
  }

  // ── 第 1 屏：三步带插图 ─────────────────────────────────────────────────────
  //
  // 原来这一屏只有一句话加一大片空白。三步讲的是**这个产品怎么用**，不是怎么配 ——
  // 配置是下一屏的事。插图是图形，里面一个要翻译的字都没有（见 onboard.html 那段注释）。
  function paintSteps() {
    const ol = $('ob-steps');
    if (!ol) return;
    if (!ol.children.length) {
      const rows = [
        [t('extob_use_1', '打开一页外语网页'), 'ob-art-1'],
        [t('extob_use_2', '点右下角的悬浮按钮'), 'ob-art-2'],
        [t('extob_use_3', '译文长在原文下面；你真正读完的句子会变成复习卡'), 'ob-art-3'],
      ];
      rows.forEach(([text, artId], i) => {
        const li = document.createElement('li');
        const b = document.createElement('b'); b.textContent = String(i + 1);
        const body = document.createElement('div'); body.className = 'ob-step-body';
        const sp = document.createElement('span'); sp.textContent = text;
        body.append(sp);
        const tpl = $(artId);
        if (tpl && tpl.content) body.append(tpl.content.cloneNode(true));
        li.append(b, body); ol.append(li);
      });
    }
    ol.hidden = false;
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
        // 配过的回显出来。设置页早就这么做了（options.js 的 prefill），而这一页没有 ——
        // 于是从「重看开始使用引导」回来的老用户看到一个**空 key 框**，而这一页自己
        // 写过的规矩是「把已配好的 Key 显示成空白会让人以为设置丢了，比不给重看更糟」。
        prefill: (() => {
          const q = QuickSetup.represents(settings);
          return q ? { host: q.host, key: settings.apiKey } : null;
        })(),
        // 自检要按**用户真实的目标语言**测。原来它读一个全仓从未被赋值的
        // window.__mtTargetLang，于是永远测「译成 zh-CN」——一个把目标设成日文的人，
        // 自检通过了也说明不了他要的那条路通没通。
        targetLang: settings.targetLang,
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
        // 自检。这一页原来**零反馈** —— 填完 key 唯一的回应是什么都没有，然后点
        // 「继续」。而这是整条链的第一环：key 没配对，后面每一步都白走，却要到他翻
        // 第一页时才发现（2026-09-02 链路核查）。
        //
        // 走的是各功能**真正用的那条传输**（EngineTest 的四条），所以「通了」意味着
        // 真的能翻/能读，不只是字段填了。settings 是现读的：onChange 每敲一个字符就
        // 更新它，所以点测试时拿到的是屏幕上那份。
        onTest: () => {
          if (slot === 'chat') {
            return EngineTest.translation({
              provider: settings.provider, apiKey: settings.apiKey,
              baseUrl: settings.apiBaseUrl, model: settings.apiModel,
              targetLang: settings.targetLang,
            });
          }
          if (slot === 'tts') {
            return EngineTest.tts({
              engineId: settings.ttsEngine, apiKey: settings.ttsApiKey,
              baseUrl: settings.ttsBaseUrl, model: settings.ttsModel, voice: settings.ttsVoice,
            });
          }
          // **没有 notes 这一支**：这一页的手动区只有 chat / tts / stt 三槽（解析跟随
          // 翻译引擎，与一键卡那边同一条规则）。写一支用不到的分支，代价是要为它加载
          // learn/notes.js —— 而 onboard.html 顶上那条注释明确说了别「顺手补齐」：
          // 那会把 IndexedDB 那一层拖进这一页，而三条被测的传输一个都不需要它。
          return EngineTest.stt({
            engineId: settings.sttEngine, apiKey: settings.sttApiKey,
            baseUrl: settings.sttBaseUrl, model: settings.sttModel,
          });
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
        // 两处曾经都错：
        //   · 成形 —— 原来是 Object.assign({}, learnRules, { langs })，v 与 updatedAt
        //     都没写。缺 updatedAt 的记录在 §8.9 里是「远古」：永远输给任何远端，也
        //     永远不会被推上去（sync.js 的 rulesDue 判据是 updatedAt > since）。
        //   · 不重画 —— SourcesView 的 chip 只上报，不自己翻状态（渲染由宿主负责，
        //     见 render() 那段注释）。设置页写完会 renderGovernance()，引导页什么都没做，
        //     于是点了存进去了、界面一动不动 —— 用户看到的就是「选语言没有反应」。
        learnRules = LearnRules.withUpdate(learnRules, { langs });
        return storageSet({ learnRules }).then(() => renderChips());
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
    try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('onboarding_done', { surface: 'ext' }); } catch (_) {}
    $('onboard').hidden = true;
    $('ob-done').hidden = false;
    $('ob-done-title').textContent = t('extob_done_title', '设置好了');
    $('ob-done-text').textContent = t('extob_done_text',
      '打开任意外语网页，点右下角的悬浮按钮即可。想改设置或重看这段引导，都在扩展的设置页里。');
    $('ob-done-close').textContent = t('extob_done_close', '知道了');
    // 第 0 天就把出口给出来：引导页说得再对，真机上总有一个站不听话。
    $('ob-done-feedback-text').textContent = t('extob_done_feedback', '哪里不对劲？写信给我 —— 每一封我都会读。');
    const fl = $('ob-done-feedback-link');
    fl.textContent = t('feedback_row', '发送反馈');
    try { fl.href = MTFeedback.mailtoUrl('onboarding'); } catch (_) { fl.hidden = true; }
    // 匿名用量事件说在前面（docs/telemetry-design.md §5）：默认开、设置里可关。中国版没有。
    const tp = $('ob-done-telemetry');
    if (tp) {
      if (!window.MT_TELEMETRY) tp.hidden = true;
      else {
        $('ob-done-telemetry-text').textContent = t('telemetry_onboard', '会发送匿名用量数据（不含网页内容与地址），帮助改进；设置里可关。');
        const a = $('ob-done-telemetry-link'); a.textContent = t('telemetry_what', '会发送什么'); a.href = 'https://belliedmonkey.cc/privacy.html#usage';
      }
    }
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
