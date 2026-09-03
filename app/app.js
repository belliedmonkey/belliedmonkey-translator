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
    // 归属闸的两个 code（sync.js 的 ownerGate）。没有这两行时它们会以**英文 code
    // 原文**出现在状态行 —— 下面那个 `return msg` 是兜底，不是文案。
    if (code === 'owner_mismatch') {
      return t('app_owner_mismatch', '这台设备上的学习库属于另一个账号。用原来那个邮箱登录，或在扩展的设置里清除本机数据后重来。');
    }
    if (code === 'pkce_missing') {
      return t('sync_err_pkce_missing', '这次登录没能接上 —— 中途换了浏览器、或清过数据。回到这一页重新点一次登录就行。');
    }
    if (code === 'pkce_state') {
      return t('sync_err_pkce_state', '这次登录的来源对不上，已经停下了。请重新点一次登录。');
    }
    if (code === 'storage_error') {
      return t('sync_err_storage', '读不到本机存储，这一步暂时做不了。重开这一页再试；如果一直这样，请把这条信息告诉我们。');
    }
    if (code === 'owner_unknown') {
      return t('app_owner_unknown', '这台设备上的学习库有归属，但现在没有登录。登录之后才能继续同步。');
    }
    // 这三个 App 侧同样会撞到（配额尤其：App 也推复习记录）。前两句与扩展逐字共用
    // 同一个键 —— 它们的措辞与在哪个界面无关，抄第二份只会漂。
    if (code === 'quota') return t('sync_err_quota', '云端空间已满，新内容暂时不再上传（本机不受影响）。清理已掌握的卡可以腾出空间。');
    if (code === 'rate_limited') return t('sync_err_rate', '验证码发得太频繁了，等几分钟再试。');
    // 升级的对象在两个界面上不是同一个东西（那边是扩展，这里是 App），所以这一句
    // 必须有自己的键。
    if (code === 'enc_unsupported') return t('app_err_upgrade', '云端有这个版本还读不了的内容（可能来自更新版本的扩展）。请升级 App 后再同步——那些内容没有丢，只是暂时读不了。');
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
    // 扩展的引导入口在 App 里是死链：App 打不开 chrome-extension:// 页面，而且 App
    // 结构上不采集。藏掉它，而不是让它躺在那儿等人点。
    const obRow = $('empty-onboard-row');
    if (obRow) obRow.hidden = true;
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
    // 「浏览器那半边通没通」的判据。没有额外的一次 IDB 读：这两样本来就在这儿。
    //
    // 原来只看「本机有卡」。那太晚了：刚登录、扩展也配好了、只是还没读过任何句子的人
    // 会被告知去做一件他已经做完的事。**成功拉取过一次**就足够 —— 拉得动说明账号通、
    // 同步通，而卡是从扩展那一端推上来的，所以另一端一定在。
    //
    // 判不了的那一半照实说清楚：扩展有没有配好翻译 key，App **看不见** ——
    // 同步协议刻意不带 settings 也不带 keys（learning-design §8）。要精确回答那一条
    // 得往同步里加一种新行，那是 domain design 的改动。
    browserSideOk = stats.total > 0 || (!!currentSession && Number(lastOk) > 0);
    paintExtBanner(extState);
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
    // Bind the corpus BEFORE anything reads it. Every path that changes who is
    // signed in arrives here — startup, both sign-in forms, sign-out — so this is
    // the one place where "which database" gets decided, and there is no second
    // place that could disagree.
    try { await LearnAuth.bindCorpus(session); }
    catch (_) { /* storage read failed — keep the corpus we are on rather than guess */ }
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
      $('who').textContent = LearnAuth.displayName(session);
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
  // 语料非空 = 浏览器那半边已经通了。这是事实而不是猜测：app-bundle 的 MODULES 里
  // 没有 learn-collector（domain-design §9.2 —— 采集只发生在浏览器里，App 只经同步
  // 收材料），所以 App 里的任何一张卡都必然是某个扩展写的。iOS 上查不到扩展状态，
  // 但「卡片从哪来的」这个问题本身已经把答案带上了。
  let browserSideOk = false;

  function paintExtBanner(state) {
    const sec = $('ext-banner');
    if (!sec) return;
    // 横幅只属于首页。它原来与 #review-view / #app-settings 平级，而没有任何代码在
    // 进那些视图时收起它 —— 于是它横跨每一个界面钉在最顶上，在一台明显已经在用的
    // 设备上反复说「先去把扩展打开」。
    //
    // 判据写成「有别的视图开着就收起」，而不是「首页开着才显示」：后者在首页两个
    // 区块都还没被 show() 决定归属的那一刻（首帧、以及测试直接调 show() 时）会把
    // 横幅误伤掉。
    const away = !$('review-view').hidden || !$('app-drive').hidden || !$('app-settings').hidden;
    if (away || browserSideOk) { sec.hidden = true; return; }
    // 引导进行中不挂横幅：引导第 3 屏本身就是这件事，两个一起显示会把同一句话
    // 一字不差地说两遍（2026-08-28 模拟器实测看到的，自动化断言看不出来 ——
    // 它只查内容对不对，不查有没有重复）。
    const onboarding = $('onboard') && !$('onboard').hidden;
    if (onboarding || !state || state.enabled === true) { sec.hidden = true; return; }
    sec.hidden = false;
    $('ext-banner-title').textContent = state.known
      ? t('app_ext_off_title', '扩展还没启用')
      : t('app_ext_unknown_title', '先把浏览器那半边打通');
    // 正文按「有没有可点的东西」选，不是按「知不知道状态」选。
    // 2026-08-29 真机撞到：#177 的回退触发后按钮被收起，而正文仍走 known 分支，
    // 于是横幅变成一句「它没启用」加一片空白 —— 收起了动作却没补上说明，
    // 等于把一条死路换成了另一条。有按钮才说「没启用」，没按钮就得给步骤。
    $('ext-banner-body').textContent = state.canOpenPrefs
      ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
      : t('app_ext_ios_body', '卡片来自 Safari 扩展：在 Safari 里点地址栏左边的扩展图标 →「管理扩展」→ 打开大肚猴翻译。');
    const act = $('ext-banner-act');
    // 只有 macOS 有直达入口。iOS 给按钮却跳不过去，比不给按钮更糟。
    act.hidden = !state.canOpenPrefs;
    act.textContent = t('app_ext_open_prefs', '打开 Safari 扩展设置');
    // 两个平台都给：macOS 有直达设置，但「设完了到底成没成」仍然只有官网那一页
    // 答得出；iOS 除了它没有别的答案。
    const setup = $('ext-banner-setup');
    if (setup) {
      setup.hidden = false;
      setup.textContent = t('app_ext_open_setup', '在网页上完成设置');
    }
  }

  function setupPageUrl() {
    const host = (window.MT_FLAVOR === 'china') ? 'belliedmonkey.com' : 'belliedmonkey.cc';
    return 'https://' + host + '/setup.html';
  }

  // WKWebView 里 window.open(_, '_blank') 是哑的：转换器模板没实现
  // createWebViewWith，点了什么都不会发生。走原生桥在**系统浏览器**里打开 ——
  // 在 App 内导航过去会把复习界面换掉且回不来，那比不给按钮更糟。
  function openExternal(url) {
    try {
      webkit.messageHandlers.controller.postMessage('open-url:' + url);
      return;
    } catch (_) { /* 不在宿主 App 里 —— 浏览器里打开的这一页，window.open 是通的 */ }
    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
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
  // 四到五屏（不是设计稿里的九屏）。少掉的三屏（配翻译引擎 / 打开采集 / 看第一张卡）
  // App 做不到 —— 它们都在扩展那一侧，而两边存储不通。在这里画一个引擎选择器
  // 或采集开关，写下去也到不了扩展，是纯粹的假控件。
  //
  // 曾经还有一屏「学习语言」，理由是 learnRules 是 App 唯一能真设的东西（它作为
  // chunk 的 `g` 行双向同步）。2026-09-01 去掉了：语言 chips 是**采集的过滤器**，
  // 而采集只能在扩展里打开 —— 那一屏是在让人给一个他还没启用、也无法在这里启用的
  // 功能配过滤器；而且它排在 signin 之前，那时还没同步，两边就是两份各自的值。
  // 同一个控件在扩展引导的采集屏上就在开关旁边，那才是它该在的地方。
  // App 设置页里仍然改得了，只是不再占引导的一屏。
  const OB_SEEN = 'onboardSeen';
  // signin 屏按**同步有没有编进这个构建**取舍，与扩展引导的 OB 同一个写法
  // （onboard.js 的 syncOn）。中国版扩展的登录入口是被整节 remove 掉的
  // （options.js 的 `if (!MT_BACKEND.enabled)`），所以那一屏那句「扩展里也要登录
  // 一次」把人送去一个不存在的地方 —— 引导里的第二条死路。
  // 判据按**值**不按 flavor 名：interaction-spec「不存在的功能不许长死状态条」。
  // ⚠️ 中国版**App** 的 MT_BACKEND.enabled 仍是 true（backend.config.js 里明写的
  // 不对称：App Review Route A 需要密码登录），所以今天这个分支在出货产物里不触发。
  // 它守的是「哪天 App 侧也关掉同步」，那时这一屏必须跟着消失，而不是留在那里。
  const OB = ['welcome', 'ext', 'browser', 'read']
    .concat((typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) ? ['signin'] : []);
  let obAt = 0;

  function obPaint() {
    const step = OB[obAt];
    $('ob-fill').style.width = Math.round(((obAt + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-steps', 'ob-kv', 'ob-prefs', 'ob-setup']) $(id).hidden = true;
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-next').hidden = false;   // 只有 'ext' 屏藏它，别的屏要放回来
    $('ob-next').textContent = obAt === OB.length - 1
      ? t('app_signin_open', '登录') : t('ob_next', '继续');

    if (step === 'welcome') {
      $('ob-title').textContent = t('ob_welcome_title', '读你真正在读的东西');
      $('ob-text').textContent = t('ob_welcome_body',
        '翻译发生在浏览器里，复习发生在这个 App 里。花两分钟把两边接上。');
      $('ob-next').textContent = t('ob_start', '开始设置');
    } else if (step === 'ext') {
      $('ob-title').textContent = t('app_ext_unknown_title', '先把浏览器那半边打通');
      // 平台不对称照实呈现：macOS 有直达入口和真实状态，iOS 两样都没有。
      const mac = extState && extState.canOpenPrefs;
      $('ob-text').textContent = mac
        ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
        : t('app_ext_ios_body', '卡片来自 Safari 扩展：在 Safari 里点地址栏左边的扩展图标 →「管理扩展」→ 打开大肚猴翻译。');
      if (mac) { $('ob-prefs').hidden = false; $('ob-prefs').textContent = t('app_ext_open_prefs', '打开 Safari 扩展设置'); }
      else obSteps([
        { text: t('ob_ios_1', '在 Safari 里点地址栏左边的扩展图标'), art: 'app-art-1' },
        { text: t('ob_ios_2', '选「管理扩展」，把「大肚猴翻译」打开'), art: 'app-art-2' },
        { text: t('ob_ios_3', '权限选「允许」，网站选「所有网站」'), art: 'app-art-3' },
      ]);
      // 「设完了到底成没成」在 iOS 上只有官网那一页答得出（它被扩展注入后自己亮
      // 绿灯），所以这一屏两个平台都给它 —— macOS 有直达设置，但没有回执。
      $('ob-setup').hidden = false;
      // 主/次跟着平台走。iOS 上它是这一屏唯一的行动，而且兼作前进键 ——
      // 和「以后再设置」长得一模一样时，用户看不出该点哪个（2026-09-02 真机截图）。
      $('ob-setup').classList.toggle('secondary', !!mac);
      $('ob-setup').textContent = t('app_ext_open_setup', '在网页上完成设置');
      // 这一屏**没有「继续」**。App 在 iOS 上判不了扩展启没启用（上面那条注释），
      // 所以一个「继续」按钮只能是「假装你做完了」—— 没设置好就该去网站设置。
      // 主行动因此变成「在网页上完成设置」：它既把人送去该去的地方，也把流程往前
      // 推一屏，后面三屏（浏览器里的两件事 / 去读一篇 / 登录）不会因此失联。
      // 比原来严格更好：原来点「继续」是原地跳过，现在是先送到位。
      $('ob-next').hidden = true;
    } else if (step === 'browser') {
      $('ob-title').textContent = t('ob_browser_title', '还有两件事在浏览器里做');
      $('ob-text').textContent = t('ob_browser_body',
        '这两个开关在扩展自己的设置页里 —— App 改不了它们，两边的存储是分开的。');
      $('ob-kv').hidden = false;
      // 「可以先用免费通道」这句在中国版是假话 —— 那个 flavor 的注册表里
      // 一个 needsKey:false 的引擎都没有（global 只有 google，而 google 是
      // global-only）。按注册表实际内容判定，不写死、也不按 flavor 名判断：
      // 单一注册表规则，且哪天注册表变了这里自动跟着变。
      // 不再按「注册表里有没有免费条目」分支。2026-09-01 裁定：决策不为免费通道开特例，
      // 第一优先级是一键配置 —— 说「没有 Key 也能先用」正是在劝人别配。
      obKv([
        [t('ob_kv_engine', '填一把翻译引擎的 Key'),
          t('ob_kv_engine_note_required', '扩展设置 → 翻译引擎。这一步躲不掉：不填 Key 就翻不出任何东西。')],
        [t('ob_kv_capture', '打开「采集学习材料」'), t('ob_kv_capture_note', '默认是关的。打开之后，你停下来读过的句子才会变成卡片。')],
      ]);
      // **这一屏不再给外链。** 上一屏（ext）已经有「在网页上完成设置」把人送去官网了；
      // 这里再放一个「打开配置教程」是第二个竞争入口，而且它去的是另一页。同一条
      // 裁定在扩展那边已经下过一次：没设置好就该去网站设置，不该再有别的按钮分散
      // 注意力（2026-09-01 用户对着真机截图指出）。
      // 这两件事 App 确实做不到 —— Key 跨过去就意味着它离开设备经我们的服务器
      // （产品的核心承诺正好相反），采集开关跨过去也只在登录后生效。做不到就别假装，
      // 但「说清楚」不等于「再给一个链接」。
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

  // 吃字符串或 {text, art}。`art` 是 index.html 里一个 <template> 的 id —— 插图是
  // 图形不是文案，里面一个要翻译的字都没有，所以克隆一份就行，不必进 i18n。
  //
  // ⚠️ #ob-steps 必须恰好三个直接子元素（verify-app-bundle.js 的断言）。图画在 <li>
  // 内部，不要因为想加一张图就多一个兄弟节点。
  function obSteps(lines) {
    const ol = $('ob-steps');
    ol.textContent = '';
    lines.forEach((line, i) => {
      const item = (typeof line === 'string') ? { text: line } : line;
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = String(i + 1);
      // 文字与插图竖排；<b> 仍在左侧，所以正文包一层。
      const body = document.createElement('div'); body.className = 'ob-step-body';
      const sp = document.createElement('span'); sp.textContent = item.text;
      body.append(sp);
      const tpl = item.art && $(item.art);
      if (tpl && tpl.content) body.append(tpl.content.cloneNode(true));
      li.append(b, body); ol.append(li);
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

  // ── 原生 Sign in with Apple（§8.4.1.2）────────────────────────────────────
  //
  // 按钮**只在原生桥在场时才显示**。桥不在（旧宿主、或补丁没打上）时显示它，等于
  // 给一个点了没反应的按钮 —— 这个仓库为「点了没反应」付过好几次代价了。
  // 判据是 webkit 的消息通道存在，不是「这是 Safari」。
  const appleBridge = (() => {
    try {
      return !!(window.webkit && window.webkit.messageHandlers
        && window.webkit.messageHandlers.mtAppleSignIn);
    } catch (_) { return false; }
  })();
  if (appleBridge && MT_BACKEND.enabled && (MT_BACKEND.providers || []).includes('apple')) {
    $('btn-apple').textContent = t('sync_with_apple', '用 Apple 登录');
    $('btn-apple').hidden = false;
    $('signin-or').textContent = t('sync_or', '或者用邮箱 / 手机号：');
    $('signin-or').hidden = false;
    $('btn-apple').addEventListener('click', () => {
      $('btn-apple').disabled = true;
      say(t('app_apple_waiting', '正在打开 Apple 登录…'));
      try { window.webkit.messageHandlers.mtAppleSignIn.postMessage({}); } catch (err) {
        $('btn-apple').disabled = false;
        say(humanError(err), true);
      }
    });
  }

  // ── Google：系统鉴权会话（§8.4.1.2）────────────────────────────────────────
  //
  // Google 禁止在内嵌 WebView 里跑 OAuth，所以 App 里这条交给系统的
  // ASWebAuthenticationSession。**URL 在这一侧算**（PKCE 的 verifier 只能在这里），
  // 原生只负责把会话开起来、把 code 带回来 —— 与扩展那条路是同一套 auth.js 入口。
  if (appleBridge && MT_BACKEND.enabled && (MT_BACKEND.providers || []).includes('google')) {
    const scheme = (window.MT_FLAVOR === 'china') ? 'belliedmonkeycn' : 'belliedmonkey';
    const g = $('btn-google');
    g.textContent = t('sync_with_google', '用 Google 登录');
    g.hidden = false;
    g.disabled = true;
    LearnAuth.prepareProviderSignIn().then(() => { g.disabled = false; })
      .catch(() => { /* 备不好就保持不可点 */ });
    g.addEventListener('click', () => {
      const url = LearnAuth.providerSignInUrl('google', scheme + '://auth');
      if (!url) { say(humanError({ code: 'pkce_missing' }), true); return; }
      g.disabled = true;
      say(t('app_apple_waiting', '正在打开登录…'));
      try {
        window.webkit.messageHandlers.mtAppleSignIn.postMessage({ url, scheme });
      } catch (err) { g.disabled = false; say(humanError(err), true); }
    });
  }

  // 系统鉴权会话回来的 code。与扩展那条路唯一的不同是票不经内容脚本 ——
  // 它直接从原生进到这一页，而这一页本来就持有 verifier。
  window.__mtWebAuthResult = async (r) => {
    const g = $('btn-google'); if (g) g.disabled = false;
    if (!r || r.error) {
      if (r && r.error === 'canceled') { say(''); return; }
      say(t('app_apple_failed', '登录没能完成。可以改用下面的邮箱或手机号。'), true);
      return;
    }
    say(t('app_verifying', '正在登录…'));
    try {
      const session = await LearnAuth.completeProviderSignIn({ code: r.code, state: r.state });
      await show(session);
      await doSync();
    } catch (err) {
      say(humanError(err), true);
      // 兑换失败会把 verifier 作废（它是一次性的），**必须重新备一份** ——
      // 不备的话，下一次点击拿到的是 pkce_missing，按钮直到刷新页面前都是死的。
      // 2026-09-03 用户实测「重试也没成功」就是这个：第一次 pkce_state，
      // 第二次开始永远 pkce_missing。
      LearnAuth.prepareProviderSignIn().catch(() => {});
    }
  };
  try {
    if (window.__mtWebAuthPending) {
      const p = window.__mtWebAuthPending; window.__mtWebAuthPending = null;
      window.__mtWebAuthResult(p);
    }
  } catch (_) {}

  // 原生那边把结果送回来。冷启动时结果可能先到（同 deeplink 的形状），所以两边都兜。
  window.__mtAppleResult = async (r) => {
    $('btn-apple').disabled = false;
    if (!r || r.error) {
      // 用户自己取消不是错误，别画成失败 —— 那会让人以为登录坏了。
      if (r && r.error === 'canceled') { say(''); return; }
      say(t('app_apple_failed', 'Apple 登录没能完成。可以改用下面的邮箱或手机号。'), true);
      return;
    }
    say(t('app_verifying', '正在登录…'));
    try {
      const session = await LearnAuth.signInWithIdToken('apple', r.idToken, r.nonce);
      await show(session);
      // 与验证码那条路逐字相同：刚登录的人要的就是他的材料，让他再去找一个按钮，
      // 等于这个 App 承认自己不知道自己是干什么的。
      await doSync();
    } catch (err) { say(humanError(err), true); }
  };
  try {
    if (window.__mtApplePending) {
      const p = window.__mtApplePending; window.__mtApplePending = null;
      window.__mtAppleResult(p);
    }
  } catch (_) {}

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
        // 空态那句话原来是「先在浏览器里采集一些，再回来同步」。在最常见的触发场景里
        // 它是**反过来指责用户**：扩展登 A、App 登 B 时 RLS 返回 0 行，而他已经采集
        // 了一周。两端的账号从不并排出现在同一个屏幕上，他无从发现自己登了两个号。
        // 所以这句话现在**带上这台设备登的是谁**，把可对比的事实交到他手上。
        const who = (currentSession && currentSession.email) || '';
        say(stats.total
          ? t('app_up_to_date', '已经是最新的。')
          : (who
            ? t('app_sync_empty_who', '同步完成，但 {email} 这个账号下还没有内容。如果你在浏览器扩展里采集过，确认那边登录的是同一个邮箱。').replace('{email}', who)
            : t('app_sync_empty', '同步完成，但服务器上还没有内容 —— 先在浏览器里采集一些，再回来同步。')));
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
    paintExtBanner(extState);
    say('');
  });

  // ─── 播客模式（§9.5）────────────────────────────────────────────────────
  // Same split as #review-view: the shell owns view switching, AppDriving owns
  // everything inside #app-drive.
  $('app-drive-start').addEventListener('click', () => {
    $('signed-in').hidden = true;
    $('app-drive').hidden = false;
    AppDriving.start();
    paintExtBanner(extState);
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
  $('ext-banner-setup').addEventListener('click', () => openExternal(setupPageUrl()));
  $('ob-setup').addEventListener('click', () => {
    openExternal(setupPageUrl());
    // 这一屏没有「继续」，所以这个按钮同时是前进键 —— 否则点了它的人（也就是照做
    // 的人）会被卡在这一屏，后面三屏只能靠「以后再设置」整个跳过。
    if (OB[obAt] === 'ext' && obAt < OB.length - 1) { obAt += 1; obPaint(); }
  });
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

    // Before ensureDefaults / any paint: those read the corpus, and reading the
    // wrong one for a few hundred milliseconds is how a stale count gets shown and
    // believed.
    try { await LearnAuth.bindCorpus(); } catch (_) {}

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

    // ── 跨面交接（learning-design §8.4.1.1）────────────────────────────────
    //
    // 扩展那边打开 belliedmonkey://review?uid=<userId> 把人送过来。跨过来的只有一个
    // **不透明 userId** —— 不是会话（那里面有 token），也不是邮箱。它只回答一个问题：
    // 两边是不是同一个人。
    //
    // 在这之前，两边登了不同账号时**没有任何一侧发现得了**：App 拉到 0 行，然后说
    // 「先在浏览器里采集一些」，反过来指责一个已经采集了一周的人。
    //
    // Swift 侧（app/native/open-url-bridge.swift）两头都兜：页面没就绪时它写
    // window.__mtDeepLinkPending，就绪之后调 window.__mtDeepLink。所以这里两样都读。
    function parseDeepLink(raw) {
      try {
        const u = new URL(String(raw || ''));
        if (!/^belliedmonkey(cn)?:$/.test(u.protocol)) return null;
        // `has` 与「空串」必须分开：不带 uid 是「扩展没登录」，带空串是
        // 「登录了但 id 读不出来」—— 两者要给的话不一样。
        const has = u.searchParams.has('uid');
        return { action: (u.hostname || u.pathname.replace(/^\/+/, '')) || 'review',
          hasUid: has, uid: has ? String(u.searchParams.get('uid') || '') : null };
      } catch (_) { return null; }
    }
    window.__mtDeepLink = (raw) => { const d = parseDeepLink(raw); if (d) applyDeepLink(d); };

    // 三支，每一支都必须说得出**事实**，不猜。
    async function applyDeepLink(d) {
      const mine = (currentSession && currentSession.userId) || '';
      // ① App 未登录。扩展那边登没登录，决定这句话怎么说。
      if (!mine) {
        $('onboard').hidden = true;
        $('signed-out').hidden = false;
        $('signin-prompt').hidden = true;
        $('signin-forms').hidden = false;
        try { $('email').focus(); } catch (_) {}
        say(d.hasUid && d.uid
          // 不给邮箱：跨过来的是不透明 id，我们**不知道**那是哪个邮箱，
          // 说「用 xxx 登录」就是编造。如实说「用扩展里那个账号」。
          ? t('app_dl_signin', '浏览器扩展那边已经登录了。在这里用同一个账号登录，卡片才会同步过来。')
          : t('app_dl_signin_none', '先在浏览器扩展里登录，再回到这里用同一个账号登录 —— 卡片是那边采集的。'), true);
        return;
      }
      // ② 同一个人 ⇒ 直接进复习，并强制同步一次（这一刻正是「进入」）。
      if (!d.hasUid || !d.uid || d.uid === mine) {
        $('onboard').hidden = true;
        quietSync();
        // 走那个按钮自己的处理器，而不是在这里抄一份视图切换 —— 那一段还带着
        // paintAppEmptyState / LearnReview.start / paintExtBanner 三件事，抄漏一件
        // 的表现是「进了复习页但卡是旧的」。
        try { $('review').click(); } catch (_) {}
        return;
      }
      // ③ 两边不是同一个人。**拦下来，不自动切换** —— §8.4.3 的归属闸说过，
      //    账号切换会把一份语料推进另一个账号的云端。给事实和两个动作，让人自己选。
      $('onboard').hidden = true;
      $('dl-mismatch-body').textContent = t('app_dl_mismatch_body',
        '浏览器扩展登录的是另一个账号，这台 App 登录的是 {email}。卡片属于账号，所以两边不是同一个账号时，这边看不到那边采集的东西。')
        .replace('{email}', LearnAuth.displayName(currentSession));
      $('dl-mismatch').hidden = false;
    }

    // 「退出，换成扩展那个账号」：只做退出，**不替他登录** —— 我们手上只有一个
    // 不透明 id，不知道那是哪个邮箱，也不该替他决定。退出之后表单展开，他自己填。
    $('dl-mismatch-switch').addEventListener('click', async () => {
      $('dl-mismatch').hidden = true;
      try { await LearnAuth.signOut(); } catch (_) {}
      await show(null);
      $('signin-prompt').hidden = true;
      $('signin-forms').hidden = false;
      try { $('email').focus(); } catch (_) {}
      say(t('app_dl_signin', '浏览器扩展那边已经登录了。在这里用同一个账号登录，卡片才会同步过来。'), true);
    });
    $('dl-mismatch-keep').addEventListener('click', () => { $('dl-mismatch').hidden = true; });

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
