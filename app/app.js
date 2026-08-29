// app/app.js — the host app's Stage 2 surface: sign in, then pull.
//
// This runs LAST in the built `Script.js`, after the shared modules it depends on
// (LearnStore / LearnAuth / LearnChunk / LearnSync). Those are the SAME files the
// extension ships — not ports of them. `docs/learning-design.md` §9 is explicit that
// the app is not a second engine, and the moment a behaviour is retyped here the two
// surfaces start disagreeing about what a corpus is.
//
// Verified before any of this was written (verification-spec, Stage 2 spike): on the
// app's `file://` origin, IndexedDB, `crypto.subtle`, `CompressionStream` and `fetch`
// to Supabase all work, identically on macOS, iOS 17.2 and iOS 26.5. None of it needs
// a shim, which is why there is none.

(() => {
  const $ = (id) => document.getElementById(id);

  // Declared up here, not beside the sign-in code: `show()` reads it and is defined
  // above that point, so a `let` further down would be a temporal-dead-zone trap
  // waiting for the first refactor that calls `show()` earlier.
  let currentSession = null;

  // Same i18n as every other surface (interaction-spec 「界面语言」: no hardcoded
  // copy, anywhere). The bundle has carried MT_I18N_MESSAGES + PageI18n from the
  // start — the shim's getUILanguage hands it the system locale — so the app shell
  // localizes exactly like the extension pages do. The Chinese here is the FALLBACK
  // argument only, per the standing convention: a missing key must never blank the
  // UI, and the literal beside the key is what the translator's source of truth
  // (_locales/zh_CN) says.
  const t = (k, fb) => PageI18n.t(k, fb);

  const say = (msg, isErr) => {
    const el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  };

  // Never show a raw provider string to a user. `auth.js` and `sync.js` attach `code`
  // precisely so callers can decide the wording, and "AuthApiError: Token has expired
  // or is invalid" is not wording — it is a stack trace with a sentence around it.
  function humanError(e) {
    const offline = () => t('app_offline', '连不上服务器，检查网络后重试。');
    const codeBad = () => t('app_code_bad', '验证码不对或已过期，重新试一次。');
    const code = e && e.code;
    if (code === 'network' || code === 'offline') return offline();
    if (code === 'invalid_credentials') return t('app_pw_bad', '邮箱或密码不对，重新试一次。');
    if (code === 'signed_out') return codeBad();
    const msg = String((e && e.message) || e);
    if (/invalid login credentials/i.test(msg)) return t('app_pw_bad', '邮箱或密码不对，重新试一次。');
    if (/expired|invalid|otp/i.test(msg)) return codeBad();
    if (/network|fetch|load failed/i.test(msg)) return offline();
    return msg;
  }

  function paintStatic() {
    $('lede').textContent = t('app_lede', '你在浏览器里读到的句子，会同步到这里来复习。');
    $('email-label').textContent = t('app_email_label', '邮箱');
    $('send').textContent = t('app_send', '发送验证码');
    $('code-label').textContent = t('app_code_label', '验证码（查收邮件）');
    $('verify').textContent = t('app_verify', '登录');
    $('back').textContent = t('app_back_email', '换一个邮箱');
    $('signin-why').textContent = t('app_signin_why',
      '卡片是浏览器扩展采集的。要在这台设备上复习，就得登录同步过来。');
    $('btn-signin').textContent = t('app_signin_open', '登录');
    $('local-note').textContent = t('app_local_note', '浏览器扩展不登录也能采集和复习，全部存在本机。登录只是为了让语料同步到这台设备上。');
    $('app-use-pw').textContent = t('app_use_pw', '使用密码登录');
    $('app-pw-email-label').textContent = t('app_email_label', '邮箱');
    $('app-pw-label').textContent = t('app_pw_label', '密码');
    $('app-pw-login').textContent = t('app_verify', '登录');
    $('app-pw-back').textContent = t('app_pw_back', '改用验证码登录');
    $('signout').textContent = t('app_signout', '退出');
    $('gear').textContent = t('app_settings_link', '设置');
    AppSettings.paintStatic();
    $('review').textContent = t('app_review_start', '开始复习');
    $('review-back').textContent = t('app_review_back', '← 返回');
    $('sync').textContent = t('app_sync', '同步');
    AppDriving.paintStatic();
    paintAppEmptyState();
  }

  // 复习页的空态整段是从扩展的 review.html 原样嵌进来的（build/app-bundle.js 的
  // <!--REVIEW--> 槽），所以它说的是扩展的话：「打开采集开关」+ 一个「去设置里打开采集」
  // 的链接。在 App 里这两句都是错的 ——
  //   · App 结构上就不采集：learn-collector.js 不在 app-bundle 的 MODULES 里，
  //     材料只能经同步进来（domain-design §9.2）
  //   · 那个链接被 app.js 拦去打开 App 设置，而 App 设置里没有采集开关 —— 死路
  // 2026-08-28 实测：40 个外部用户全部经 App 进来，没有一个产生过一张卡。
  // 每一个点进复习页的人撞的都是这面墙。
  function paintAppEmptyState() {
    const body = document.querySelector('#empty [data-i18n="learn_empty_body"]');
    if (body) body.textContent = t('app_empty_body', '学习材料来自浏览器扩展 —— 这个 App 负责复习它们。');
    const link = $('empty-settings');
    if (!link) return;
    // 降级成纯文本：iOS 没有跳到 Safari 扩展设置的深链，给一句能照做的话，
    // 比给一个跳到死路的链接强。（macOS 有 SFSafariApplication 深链，但那要新增
    // 一条 native 消息，属于另一件事。）
    const how = document.createElement('span');
    how.id = 'empty-settings';
    how.textContent = t('app_empty_how',
      '在 iOS「设置 → Safari → 扩展」里启用大肚猴翻译，打开采集，然后照常浏览、照常翻译。');
    link.replaceWith(how);
  }

  async function paintCounts() {
    // 总计 + 四状态 —— 与复习页头部同一口径（interaction-spec「多设备同步一致性」：
    // 每设备显示总条目数与各状态数，同一账号同步后逐字一致）。待复习用调度器默认
    // 配置，与 review.js 的有效 targetR/KNOWN_S 一致（dailyNew 不影响这两个数）。
    const [stats, items, lastOk, lastLegacy] = await Promise.all([
      LearnStore.stats(),
      LearnStore.allItems(),
      LearnStore.getMeta('lastSyncOkAt', 0),
      LearnStore.getMeta('appLastSync', 0),
    ]);
    const due = LearnScheduler.dueCount(items, Date.now(), LearnScheduler.DEFAULTS);
    $('app-counts').innerHTML = '';
    // cls = semantic hook for style.css's stat-tile colors (never color by
    // position — a reordered/hidden tile would silently mis-color).
    const cell = (n, label, cls) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      const b = document.createElement('b');
      b.textContent = String(n);
      const s = document.createElement('span');
      s.textContent = label;
      d.append(b, s);
      return d;
    };
    $('app-counts').append(
      cell(stats.total, t('learn_count_total', '总计')),
      cell(due, t('learn_count_due', '待复习'), 'count-due'),
      cell(stats.by.learning || 0, t('learn_count_learning', '学习中'), 'count-learning'),
      cell(stats.by.candidate || 0, t('learn_count_new', '候选')),
      cell(stats.by.known || 0, t('learn_count_known', '已掌握')));
    // 「上次同步」读统一成功戳；旧装机回退老键（只读回退，不迁移）。
    const last = lastOk || lastLegacy;
    $('last').textContent = last
      ? new Date(last).toLocaleString()
      : t('app_never_synced', '还没有同步过');
  }

  // 密码登录只服务「服务端已设过密码」的账号 —— 产品内没有任何设密码的面，
  // 所以对普通用户它 100% 会失败。2026-08-28 的 GoTrue 日志里实证撞了两次：
  // Apple 审核员（08-26，17.185.64.x）与一个真实用户（08-27，刚发完验证码就连点
  // 三次密码登录，全部 invalid_credentials，然后再没回来）。他就是那批「发了码从没
  // 验证」的用户之一 —— 也就是说这个入口在真实地吃转化。
  //
  // 判据用 plus-alias 而不是写死某个地址：演示账号按 §8.4.1 的做法一律是 Gmail
  // 别名（belliedmonkey+applereview@gmail.com），而真实用户几乎不会用 + 标签。
  // 写死地址的话，下次换演示账号就是一次 App Review 拒审。
  function isDemoAddress(v) { return /\+[^@\s]*@/.test(String(v || '').trim()); }

  function refreshPwEntry() {
    const el = $('app-use-pw');
    if (!el) return;
    // 密码表单已经打开时不要把入口抽走。
    el.hidden = !isDemoAddress($('email').value) && $('app-pw-form').hidden;
  }

  async function show(session) {
    currentSession = session;
    $('signed-out').hidden = !!session;
    $('signed-in').hidden = !session;
    // Signing out from inside settings or review must not leave that view on screen
    // over the sign-in form.
    if (!session) {
      $('app-settings').hidden = true;
      $('review-view').hidden = true;
      // And the sign-in surface resets to its default (OTP) path.
      $('app-pw-form').hidden = true;
      $('app-use-pw').hidden = true;   // 只有 demo 地址才会把它揭出来（refreshPwEntry）
      $('email-form').hidden = false;
      $('code-form').hidden = true;
      // A3：退出后回到可浏览的首页，表单收起来 —— 不要又变成一堵墙。
      $('signin-forms').hidden = true;
      $('signin-prompt').hidden = false;
    }
    if (session) {
      $('who').textContent = session.email || '';
      await paintCounts();
      // 播客模式入口是能力门控的（§9.5）：uiLang 能开口才渲染。Fire-and-forget —
      // 计数与登录绝不等一次语音列表加载。
      AppDriving.refreshEntry();
    }
  }

  // ─── 浏览器那半边（§引导）────────────────────────────────────────────────
  //
  // 转换器模板自带一套「告诉用户去启用扩展」的接线，两端都在工程里，两端都接空气：
  //   Swift → 页面：didFinish 里 evaluateJavaScript("show('mac', <启用状态>, true)")
  //                 —— 而我们用 Main.html 换掉模板页之后，全局 show() 就没了，
  //                 ReferenceError 被 evaluateJavaScript 静默吞掉。
  //   页面 → Swift：userContentController 收到 "open-preferences" 就调
  //                 SFSafariApplication.showPreferencesForExtension —— 而全仓库
  //                 零处发送这条消息。
  // 这里把两端接上。Swift 一行都不用改。
  //
  // ⚠️ 平台不对称，且不能假装对称：getStateOfSafariExtension 是 macOS-only，
  // iOS 分支只有一句无参数的 show('ios')。所以 iOS 上我们**不知道**扩展开没开，
  // 只能给步骤；macOS 上才有真实状态和一键直达。
  function paintExtBanner(state) {
    const sec = $('ext-banner');
    if (!sec) return;
    // 引导进行中不挂横幅：引导第 3 屏本身就是这件事，两个一起显示会把同一句话
    // 一字不差地说两遍（2026-08-28 模拟器实测看到的，自动化断言看不出来 ——
    // 它只查内容对不对，不查有没有重复）。
    const onboarding = $('onboard') && !$('onboard').hidden;
    if (onboarding || !state || state.enabled === true) { sec.hidden = true; return; }
    sec.hidden = false;
    $('ext-banner-title').textContent = state.known
      ? t('app_ext_off_title', '扩展还没启用')
      : t('app_ext_unknown_title', '先把浏览器那半边打通');
    $('ext-banner-body').textContent = state.known
      ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
      : t('app_ext_ios_body', '卡片来自 Safari 扩展：到「设置 → Safari → 扩展」里打开大肚猴翻译，权限选「所有网站」。');
    const act = $('ext-banner-act');
    // 只有 macOS 有直达入口。iOS 给按钮却跳不过去，比不给按钮更糟。
    act.hidden = !state.canOpenPrefs;
    act.textContent = t('app_ext_open_prefs', '打开 Safari 扩展设置');
  }

  let extState = null;
  function setExtState(next) { extState = next; paintExtBanner(extState); }

  // ViewController 在页面加载完时调它。签名跟转换器模板一致，别改 —— 改了 Swift 侧就对不上。
  window.show = function (platform, isEnabled, useSettingsDeepLink) {
    if (platform === 'mac') {
      setExtState({
        known: typeof isEnabled === 'boolean',
        enabled: isEnabled === true,
        // fail-closed：必须显式给 true 才显示直达按钮。
        // show('mac') 这个「还不知道状态」的初次调用因此不给按钮；
        // Swift 侧深链失败时会回调 show('mac', false, false)，按钮同样收起，
        // 退回三步文字 —— 给一个点了没反应的按钮，比不给更糟（#177）。
        canOpenPrefs: useSettingsDeepLink === true,
      });
    } else {
      // iOS：查不到状态，也没有深链。
      setExtState({ known: false, enabled: false, canOpenPrefs: false });
    }
  };

  function openSafariPrefs() {
    try {
      webkit.messageHandlers.controller.postMessage('open-preferences');
    } catch (_) {
      // 不在宿主 App 里（浏览器里开的复习页、或测试环境）—— 静默即可，
      // 横幅上的文字本身已经说清楚该去哪。
    }
  }

  // ─── 首次运行引导（§引导）───────────────────────────────────────────────
  //
  // 六屏，不是设计稿里的九屏。少掉的三屏（配翻译引擎 / 打开采集 / 看第一张卡）
  // App 做不到 —— 它们都在扩展那一侧，而两边存储不通。在这里画一个引擎选择器
  // 或采集开关，写下去也到不了扩展，是纯粹的假控件。
  //
  // 能真设的只有一样：learnRules（学习语言 / 屏蔽），它作为 chunk 的 `g` 行
  // 双向同步，所以在 App 里选的语言登录后会传到扩展。复用设置页同一个
  // SourcesView.renderLangChips，不另画一份。
  const OB_SEEN = 'onboardSeen';
  const OB = ['welcome', 'langs', 'ext', 'browser', 'read', 'signin'];
  let obAt = 0;

  function obPaint() {
    const step = OB[obAt];
    $('ob-fill').style.width = Math.round(((obAt + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-steps', 'ob-langs', 'ob-kv', 'ob-prefs']) $(id).hidden = true;
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-next').textContent = obAt === OB.length - 1
      ? t('app_signin_open', '登录') : t('ob_next', '继续');

    if (step === 'welcome') {
      $('ob-title').textContent = t('ob_welcome_title', '读你真正在读的东西');
      $('ob-text').textContent = t('ob_welcome_body',
        '翻译发生在浏览器里，复习发生在这个 App 里。花两分钟把两边接上。');
      $('ob-next').textContent = t('ob_start', '开始设置');
    } else if (step === 'langs') {
      $('ob-title').textContent = t('learn_langs_label', '学习语言');
      $('ob-text').textContent = t('learn_langs_hint', '只收录选中语言的句子。');
      $('ob-langs').hidden = false;
      obPaintLangs();
    } else if (step === 'ext') {
      $('ob-title').textContent = t('app_ext_unknown_title', '先把浏览器那半边打通');
      // 平台不对称照实呈现：macOS 有直达入口和真实状态，iOS 两样都没有。
      const mac = extState && extState.canOpenPrefs;
      $('ob-text').textContent = mac
        ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
        : t('app_ext_ios_body', '卡片来自 Safari 扩展：到「设置 → Safari → 扩展」里打开大肚猴翻译，权限选「所有网站」。');
      if (mac) { $('ob-prefs').hidden = false; $('ob-prefs').textContent = t('app_ext_open_prefs', '打开 Safari 扩展设置'); }
      else obSteps([
        t('ob_ios_1', '打开系统「设置」→ 找到 Safari'),
        t('ob_ios_2', '进「扩展」，把「大肚猴翻译」打开'),
        t('ob_ios_3', '权限选「允许」，网站选「所有网站」'),
      ]);
    } else if (step === 'browser') {
      $('ob-title').textContent = t('ob_browser_title', '还有两件事在浏览器里做');
      $('ob-text').textContent = t('ob_browser_body',
        '这两个开关在扩展自己的设置页里 —— App 改不了它们，两边的存储是分开的。');
      $('ob-kv').hidden = false;
      // 「可以先用免费通道」这句在中国版是假话 —— 那个 flavor 的注册表里
      // 一个 needsKey:false 的引擎都没有（global 只有 google，而 google 是
      // global-only）。按注册表实际内容判定，不写死、也不按 flavor 名判断：
      // 单一注册表规则，且哪天注册表变了这里自动跟着变。
      const freeChannel = (window.MT_PROVIDERS || []).some((x) => x && !x.needsKey);
      obKv([
        [t('ob_kv_engine', '填一把翻译引擎的 Key'),
          freeChannel
            ? t('ob_kv_engine_note', '扩展设置 → 翻译引擎。没有 Key 也能先用免费通道看看效果。')
            : t('ob_kv_engine_note_required', '扩展设置 → 翻译引擎。这一步躲不掉：不填 Key 就翻不出任何东西。')],
        [t('ob_kv_capture', '打开「采集学习材料」'), t('ob_kv_capture_note', '默认是关的。打开之后，你停下来读过的句子才会变成卡片。')],
      ]);
    } else if (step === 'read') {
      $('ob-title').textContent = t('ob_read_title', '去读一篇');
      $('ob-text').textContent = t('ob_read_body',
        '设置完了就照常浏览、照常翻译。读过的句子会自己攒起来；想立刻收下某一句，长按它的译文。');
    } else {
      $('ob-title').textContent = t('ob_signin_title', '最后一步：登录');
      $('ob-text').textContent = t('app_signin_why',
        '卡片是浏览器扩展采集的。要在这台设备上复习，就得登录同步过来。');
      $('ob-kv').hidden = false;
      obKv([[t('ob_kv_twice', '扩展里也要登录一次'), t('ob_kv_twice_note', '两边的存储是分开的，所以会收到两次验证码。用同一个邮箱。')]]);
    }
  }

  function obSteps(lines) {
    const ol = $('ob-steps');
    ol.textContent = '';
    lines.forEach((line, i) => {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = String(i + 1);
      const sp = document.createElement('span'); sp.textContent = line;
      li.append(b, sp); ol.append(li);
    });
    ol.hidden = false;
  }

  function obKv(rows) {
    const box = $('ob-kv');
    box.textContent = '';
    for (const [head, note] of rows) {
      const d = document.createElement('div');
      const b = document.createElement('b'); b.textContent = head;
      const sp = document.createElement('span'); sp.textContent = note;
      d.append(b, sp); box.append(d);
    }
  }

  async function obPaintLangs() {
    if (typeof SourcesView === 'undefined') return;
    const cur = await new Promise((r) => chrome.storage.local.get(['learnRules'], r));
    const rules = cur.learnRules || null;
    SourcesView.renderLangChips($('ob-langs'), {
      registry: window.MT_LANGS || [], langs: rules && rules.langs, t,
      onChange: async (langs) => {
        const base = (cur.learnRules) || { v: 1, block: [], langs: null };
        await new Promise((r) => chrome.storage.local.set(
          { learnRules: Object.assign({}, base, { langs, v: 1, updatedAt: Date.now() }) }, r));
        obPaintLangs();
      },
    });
  }

  async function obFinish() {
    try { await new Promise((r) => chrome.storage.local.set({ [OB_SEEN]: 1 }, r)); } catch (_) {}
    $('onboard').hidden = true;
    paintExtBanner(extState);   // 引导退场，横幅按真实状态回来
    await show(await LearnAuth.current().catch(() => null));
  }

  // ─── Sign in ──────────────────────────────────────────────────────────────

  let pendingEmail = '';

  $('ob-next').addEventListener('click', () => {
    if (obAt < OB.length - 1) { obAt += 1; obPaint(); return; }
    // 最后一屏的主按钮直接进登录表单 —— 引导走到这儿，人是准备好的。
    obFinish().then(() => {
      $('signin-prompt').hidden = true;
      $('signin-forms').hidden = false;
      $('email').focus();
    });
  });
  $('ob-skip').addEventListener('click', () => { obFinish(); });
  $('ob-prefs').addEventListener('click', openSafariPrefs);

  $('btn-signin').addEventListener('click', () => {
    $('signin-prompt').hidden = true;
    $('signin-forms').hidden = false;
    $('email').focus();
  });

  $('email').addEventListener('input', refreshPwEntry);

  $('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    if (!email) return;
    $('send').disabled = true;
    $('send').textContent = t('app_sending', '正在发送…');
    say('');
    try {
      await LearnAuth.signIn(email);
      pendingEmail = email;
      $('email-form').hidden = true;
      $('code-form').hidden = false;
      $('code').focus();
      say(t('app_code_sent', '验证码已发送，查收邮件。'));
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('send').disabled = false;
      $('send').textContent = t('app_send', '发送验证码');
    }
  });

  $('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('verify').disabled = true;
    $('verify').textContent = t('app_verifying', '正在登录…');
    say('');
    try {
      const session = await LearnAuth.verify(pendingEmail, $('code').value);
      $('code').value = '';
      await show(session);
      // Pull immediately. A user who just signed in is asking for their material —
      // making them find a second button to get it would be the app admitting it does
      // not know what it is for.
      await doSync();
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('verify').disabled = false;
      $('verify').textContent = t('app_verify', '登录');
    }
  });

  $('back').addEventListener('click', () => {
    $('code-form').hidden = true;
    $('email-form').hidden = false;
    $('email').focus();
    say('');
  });

  // ─── Password sign-in (§8.4.1 second grant, 2026-08-17) ──────────────────
  // OTP stays the default path; this form serves accounts that HAVE a password
  // (set server-side — e.g. the App Review demo account). Same session shape,
  // same downstream flow as verify().
  $('app-use-pw').addEventListener('click', () => {
    $('email-form').hidden = true;
    $('code-form').hidden = true;
    $('app-use-pw').hidden = true;
    $('app-pw-form').hidden = false;
    $('app-pw-email').value = $('email').value;
    $('app-pw-email').focus();
    say('');
  });

  $('app-pw-back').addEventListener('click', () => {
    $('app-pw-form').hidden = true;
    $('email-form').hidden = false;
    refreshPwEntry();
    $('email').focus();
    say('');
  });

  $('app-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('app-pw-login').disabled = true;
    $('app-pw-login').textContent = t('app_verifying', '正在登录…');
    say('');
    try {
      const session = await LearnAuth.signInPassword($('app-pw-email').value, $('app-pw').value);
      $('app-pw').value = '';
      await show(session);
      // Same as the OTP path: a user who just signed in is asking for their
      // material — pull immediately.
      await doSync();
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('app-pw-login').disabled = false;
      $('app-pw-login').textContent = t('app_verify', '登录');
    }
  });

  $('signout').addEventListener('click', async (e) => {
    // interaction-spec 全局原则: network sign-out + repaint are in flight.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await LearnAuth.signOut();
      // The corpus deliberately survives sign-out, exactly as it does in the extension
      // (`sync.js` `forget()` — "turning sync off leaves the local corpus untouched").
      await show(null);
      say('');
    } finally { btn.disabled = false; }
  });

  // ─── Pull ─────────────────────────────────────────────────────────────────

  async function doSync() {
    $('sync').disabled = true;
    $('sync').textContent = t('app_syncing', '正在同步…');
    say('');
    try {
      // Pull AND push. The app is downstream for CORPUS (the extension captures and
      // owns that upload, domain-design §9.3) but it is the origin of REVIEW
      // PROGRESS — grades given here exist nowhere else. Without the push, learning on
      // the phone would be a dead end: the extension would keep showing those cards as
      // due, and reinstalling the app would lose months of scheduling.
      //
      // Pushing is safe because of §8.4.2's watermarks, not because of care taken
      // here: items replayed from the server carry `syncedAt = touchedAt`, so only a
      // LOCAL review lifts them back above it, and reviews that arrived from the
      // server carry `viaSync`. A first push from a freshly-synced app therefore
      // uploads the grades and nothing else — which is exactly what convergence
      // (「上传 0」on the second run) proves.
      const { pulled, pushed } = await LearnSync.sync();
      const r = pulled;
      // sync() 自己盖统一成功戳 lastSyncOkAt（手动/自动一视同仁）；老键不再写。
      await paintCounts();
      // Both directions get said, and the upload is not hidden when it is the only
      // thing that happened — 「收到 0」 alone after a review session would read as
      // "your grades went nowhere".
      const up = pushed && (pushed.pushed || pushed.reviews)
        ? ' · ' + t('app_uploaded_n', '上传 {n} 条复习记录').replace('{n}', String(pushed.reviews || 0))
        : '';

      if (r.needsUpgrade) {
        // `sync()` returns pushed:null in this case — it refuses to push on top of a
        // chunk it could not read, so there is nothing to report but the stall.
        say(t('app_needs_upgrade', '服务器上有这个版本读不了的内容，请更新 App。'), true);
      } else if (r.cards || r.reviews) {
        // Keyed on what was NEW, not on `r.chunks`. A converged pull still READS a
        // chunk — the cursor does not skip rows this device wrote (§8.4.2) — so
        // branching on chunks announced 「收到 0 张卡 · 0 条复习记录」 right after a
        // perfectly successful sync. Second time this exact confusion has been
        // shipped in this file; both times it turned the healthy state into a
        // sentence that reads like a failure.
        say(t('app_received', '收到 {n} 张卡 · {m} 条复习记录')
          .replace('{n}', String(r.cards)).replace('{m}', String(r.reviews)) + up);
      } else if (up) {
        say(t('app_uploaded_only', '已上传 {n} 条复习记录')
          .replace('{n}', String((pushed && pushed.reviews) || 0)));
      } else {
        // Zero chunks is TWO different states and they must not share a sentence.
        // Converged (the good one) told the user 「服务器上还没有内容」 while the
        // counts beside it read 11 — i.e. the app announced data loss every time
        // sync worked perfectly. Distinguish by whether anything is actually here.
        const stats = await LearnStore.stats();
        say(stats.total
          ? t('app_up_to_date', '已经是最新的。')
          : t('app_sync_empty', '同步完成，但服务器上还没有内容 —— 先在浏览器里采集一些，再回来同步。'));
      }
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('sync').disabled = false;
      $('sync').textContent = t('app_sync', '同步');
    }
  }

  $('sync').addEventListener('click', doSync);

  // §8.8 修订版 — launch and return-to-foreground are ENTRIES, and every entry
  // FORCES a sync (interaction-spec「多设备同步一致性」: 每次进 App 即同步，绕过
  // 节流). Failures stay non-interruptive: the review header's status line carries
  // the state; the loud path stays on the button above. 进复习视图不再额外触发 ——
  // 启动/回前台已覆盖，且 inflight 会去重。
  async function quietSync(extra) {
    if (!currentSession) return;
    const r = await LearnSync.autoSync(Date.now(), Object.assign({ force: true }, extra || {}))
      .catch(() => null);
    if (r) await paintCounts();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') quietSync();
  });
  // 断网自愈：网络回来立刻补一次进入级同步。
  window.addEventListener('online', () => { quietSync({ online: true }); });

  // ─── Review ───────────────────────────────────────────────────────────────
  // `review.js` runs its own boot on load and owns everything inside #review-view.
  // The app only shows and hides that view — reaching into its internals here would
  // be the start of the second implementation §9 exists to prevent.
  $('review').addEventListener('click', () => {
    $('signed-in').hidden = true;
    $('review-view').hidden = false;
    // review.js 自己的 applyI18n 会把每个 [data-i18n] 的 textContent 按扩展的文案
    // 写回去，所以 paintStatic() 那次重绘会被它覆盖。进入复习页时再绘一次 ——
    // 这里是空态真正会被看见的时刻。
    paintAppEmptyState();
    // §8.8 — the app is a long-lived single page and review.js built its deck at
    // bundle load, so material synced since then is invisible until a rebuild.
    // Entering the view IS the rebuild point. `start()` is review.js's own export
    // (same bytes as the extension); this is showing/hiding plus one sanctioned
    // call, not a second implementation.
    if (window.LearnReview) LearnReview.start();
    say('');
  });

  // ─── 播客模式（§9.5）────────────────────────────────────────────────────
  // Same split as #review-view: the shell owns view switching, AppDriving owns
  // everything inside #app-drive.
  $('app-drive-start').addEventListener('click', () => {
    $('signed-in').hidden = true;
    $('app-drive').hidden = false;
    AppDriving.start();
    say('');
  });

  $('app-drive-back').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      AppDriving.stop();
      $('app-drive').hidden = true;
      $('signed-in').hidden = false;
      // 跟读评分改了语料，出门时的计数不能还是进门时的。
      await paintCounts();
    } catch (err) {
      say(String((err && err.message) || err), true);
    } finally { btn.disabled = false; }
  });

  $('review-back').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      $('review-view').hidden = true;
      $('signed-in').hidden = false;
      // Grades given in there changed the corpus, so the counts on the way out must
      // not be the ones from the way in.
      await paintCounts();
    } catch (err) {
      // 失败要具名: stale counts + silence would read as "nothing happened".
      say(String((err && err.message) || err), true);
    } finally { btn.disabled = false; }
  });

  // ─── Settings ─────────────────────────────────────────────────────────────
  // The review page's own 「设置」 link lands here. Before Stage 4 it called
  // `chrome.runtime.openOptionsPage()`, which the shim throws on — a dead end the
  // user could reach in two taps.

  async function openSettings() {
    $('signed-in').hidden = true;
    $('review-view').hidden = true;
    $('app-settings').hidden = false;
    await AppSettings.paint(currentSession, say);
    say('');
  }

  async function closeSettings() {
    $('app-settings').hidden = true;
    $('signed-in').hidden = false;
    await paintCounts();
    say('');
  }

  $('ext-banner-act').addEventListener('click', openSafariPrefs);
  $('gear').addEventListener('click', openSettings);
  $('settings-back').addEventListener('click', closeSettings);
  // Both of review.html's settings links, captured so review.js's own handler (which
  // throws through the shim) never runs. Capture phase, because review.js attached
  // first and `preventDefault` alone would not stop a listener already registered.
  // 'empty-settings' 不在列内：它在 App 里已被 paintAppEmptyState 换成纯文本，
  // 而它原本指向的 App 设置没有采集开关。
  for (const id of ['open-settings']) {
    const el = $(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettings();
      }, true);
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  (async () => {
    paintStatic();

    // The app must honour the SAME shipping switch as the extension. `MT_BACKEND
    // .enabled === false` promises there is "no path to an account or to our server"
    // — and an app whose entire job is signing in and pulling is exactly such a path.
    // Gating only the extension's settings page would have left that promise true in
    // the place anyone checks and false in the place it mattered.
    if (!MT_BACKEND.enabled) {
      $('signed-out').hidden = true;
      $('signed-in').hidden = true;
      say(t('app_sync_disabled', '同步尚未在这个版本中启用。浏览器扩展的采集与复习不受影响，全部存在本机。'));
      return;
    }

    await AppSettings.ensureDefaults();
    AppDriving.wire();
    AppSettings.wire({
      say,
      session: () => currentSession,
      onSignOut: async () => {
        await LearnAuth.signOut();
        await show(null);
      },
    });

    try {
      const session = await LearnAuth.current();
      // 首次运行且未登录 ⇒ 走引导。已登录的人显然已经过了这一关，别再挡他。
      const seen = await new Promise((r) => chrome.storage.local.get([OB_SEEN], r))
        .then((o) => !!(o && o[OB_SEEN])).catch(() => true);
      if (!session && !seen) {
        $('signed-out').hidden = true;
        $('signed-in').hidden = true;
        $('onboard').hidden = false;
        paintExtBanner(extState);   // 收掉横幅：引导第 3 屏就是它要说的话
        obAt = 0; obPaint();
        return;
      }
      await show(session);
      // Storage-read failure ≠ signed out (§8.4.1): the sign-in form still works
      // as the recovery path, but the status line must name the real problem.
      if (!session && LearnAuth.lastLoadError()) {
        say(t('sync_status_storage_error', '读不到登录状态（存储读取失败），稍后自动重试 —— 这不代表已退出登录。'), true);
      }
      // Fire-and-forget: launch is a heartbeat (§8.8), and the sign-in screen or
      // counts must never wait on the network for a run the user didn't ask for.
      quietSync();
    } catch (err) {
      // A corrupt session must not leave a blank window with no way forward.
      await show(null);
      say(humanError(err), true);
    }
  })();
})();
