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
  // 快速翻译的面板页（learning-design §9.9）：同一份页面以 #quick 加载时只启动 AppQuick —— 不登录、不同步、
  // 不开学习库、不发心跳。主壳的一切副作用都在这个 IIFE 里，所以在这里返回就是全部。
  if (typeof AppQuick !== 'undefined' && AppQuick.isQuickMode()) { AppQuick.boot(); return; }
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
    // ── 免费额度（§8.10）。七句与扩展**逐字共用同一批键** —— 措辞与在哪个界面
    // 无关，抄第二份只会漂（enc_unsupported 那种「升级的对象两边不是一个东西」
    // 才需要各自的键）。
    if (code === 'credit_exhausted') return t('grant_err_exhausted', '免费额度已经用完了。你可以填一把自己的 key 继续用（一把通吃翻译、朗读、转写），或者到社群里问问。');
    if (code === 'grant_unavailable') return t('grant_err_unavailable', '不是你用完了 —— 是我们这边的免费额度池空了，正在补。先用自己的 key，或者稍后再来。');
    if (code === 'grant_misconfigured') return t('grant_err_misconfigured', '免费额度这条路我们这边配错了，已经记下。这不是你的问题；先用自己的 key。');
    if (code === 'grant_revoked') return t('grant_err_revoked', '这份免费额度已经停用了（退出登录或删除账号会停用它）。重新登录同一个账号就会回来，余额不变。');
    if (code === 'grant_invalid') return t('grant_err_invalid', '这份免费额度认不出来了。到设置里重新领一次。');
    if (code === 'model_not_allowed') return t('grant_err_model', '免费额度只能用它指定的那个模型。你在「详细」里改过模型 —— 改回去，或者填一把自己的 key。');
    if (code === 'busy') return t('grant_err_busy', '这会儿请求太密了，等几秒再试。');
    if (code === 'auth') return t('auth_err_key', '服务商拒绝了这把 key（HTTP 401/403）。检查 key 是否填对、有没有这个模型的权限。');
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
    $('resend').textContent = t('sync_resend', '重新发送');
    $('signin-why').textContent = t('app_signin_why',
      '卡片是浏览器扩展采集的。登录同一个账号，它们就会同步到这台设备。');
    $('btn-signin').textContent = t('sync_use_email', '或用邮箱登录');
    $('local-note').textContent = t('app_local_note', '可选。不登录也能完整使用 —— 采集和复习都在本机，登录只是为了同步到别的设备。');
    $('app-use-pw').textContent = t('app_use_pw', '使用密码登录');
    $('app-pw-email-label').textContent = t('app_email_label', '邮箱');
    $('app-pw-label').textContent = t('app_pw_label', '密码');
    $('app-pw-login').textContent = t('app_verify', '登录');
    $('app-pw-back').textContent = t('app_pw_back', '改用验证码登录');
    $('signout').textContent = t('app_signout', '退出');
    $('gear').textContent = t('app_settings_link', '设置');
    $('gear2').textContent = t('app_settings_link', '设置');   // 未登录首页的设置入口（2026-09-17）
    AppSettings.paintStatic();
    $('review').textContent = t('app_review_start', '开始复习');
    $('review-back').textContent = t('app_review_back', '← 返回');
    $('sync').textContent = t('app_sync', '同步');
    $('today-label').textContent = t('app_today_due', '今天待复习');
    for (const id of ['modes-label', 'modes-label2']) { const e = $(id); if (e) e.textContent = t('app_modes_label', '听'); }
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
      cell(stats.total, t('learn_count_total', '总计'), 'count-total'),
      cell(due, t('learn_count_due', '待复习'), 'count-due'),
      cell(stats.by.learning || 0, t('learn_count_learning', '学习中'), 'count-learning'),
      cell(stats.by.candidate || 0, t('learn_count_new', '候选'), 'count-new'),
      cell(stats.by.known || 0, t('learn_count_known', '已掌握'), 'count-known'));
    // 今日卡的进度条：学习中 / 待复习 各占总数的比例（纯装饰，aria-hidden）
    const total = Math.max(1, stats.total || 0);
    const pct = (n) => Math.min(100, Math.round((n / total) * 100)) + '%';
    if ($('today-bar-learning')) $('today-bar-learning').style.width = pct(stats.by.learning || 0);
    if ($('today-bar-due')) $('today-bar-due').style.width = pct(due);
    // 「上次同步」读统一成功戳；旧装机回退老键（只读回退，不迁移）。
    const last = lastOk || lastLegacy;
    $('last').textContent = last
      ? t('app_last_sync', '上次同步 {t}').replace('{t}', new Date(last).toLocaleString())
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

  // 一次会话只试一次 —— 存的是**那一次尝试本身**，晚来的调用者（引导的「就地试一句」）
  // 等同一次，而不是看见「已经试过」就当作有了引擎。
  let _autoClaimed = null;
  async function autoClaimGrant() {
    if (!_autoClaimed) _autoClaimed = autoClaimOnce().catch(() => {});
    return _autoClaimed;
  }
  async function autoClaimOnce() {
    if (typeof LearnGrant === 'undefined' || !LearnGrant.enabled()) return;
    if (typeof AppSettings === 'undefined' || !AppSettings.claimAndApply) return;
    // 「配好了没有」的判据只有一个出口（EngineState.needsSetup），不在这里另写一份。
    try {
      if (typeof EngineState !== 'undefined' && EngineState.needsSetup) {
        const cur = await readObSettings();
        if (!EngineState.needsSetup(cur)) return;   // 已经有引擎 —— 不碰
      }
    } catch (_) { return; }
    // selfTest:false —— 登录那一刻弹一张三行自检卡会盖住引导；那一刻的回执就是引导下一屏
    // 「就地试一句」本身（真的翻一句，比三行「通了」更像证据）。
    await AppSettings.claimAndApply({ overwrite: false, selfTest: false });
  }
  const readObSettings = () => new Promise((r) => {
    try { chrome.storage.local.get(AppSettings.KEYS, (v) => r(v || {})); } catch (_) { r({}); }
  });

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
    // 登录了就把免费额度装上，不再让人自己去点一次「领取」（2026-09-22 裁定，
    // learning-design §8.10.1）。读数：54 台登录并同步过的里 **47 台（87%）既没配
    // 引擎也没领额度** —— 我们让他们登了，却没顺手把额度给他们。
    //
    // 挂在 show() 上而不是登录表单的回调里：这里是**所有**改变登录态的路径的唯一汇合
    // 点（见上面那段注释），所以启动时带着旧会话进来的人也会被补上 —— 那 47 台不必
    // 重新登录一次才能拿到。claim() 服务端以 user_id 为主键、第二次回传同一枚令牌，
    // 所以重复调用是幂等的（它同时就是读余额那个调用）。
    //
    // 三个闸：没登录不做 · 没有额度这条路不做（中国版 MT_GRANT 恒为 null）·
    // **已经配好引擎的不做** —— overwrite 传 false，不碰用户自己的 key。
    // 静默失败：领不到额度不该挡住首页（grant_unavailable 等）。
    if (session) autoClaimGrant().catch(() => {});
    // 引导停在登录屏时登上了 ⇒ 往下翻一屏。挂在这里而不是某个登录按钮的回调里，理由同上：
    // Apple / Google / 邮箱三条路最后都到这儿，只写一处就三条都对。
    try {
      if (session && !$('onboard').hidden && OB[obAt] === 'signin' && obAt < OB.length - 1) {
        obAt += 1; obPaint();
      }
    } catch (_) { /* 启动早期 OB 还没求值时不管 */ }
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
      $('signin-prompt').classList.remove('code-step');
      $('btn-signin').hidden = false;
      // 未登录也要按当前事实重画横幅：真机上 Swift 在 didFinish 就调 window.show('ios')，
      // 早于 init 里 extBannerDoneAt 的异步预读，那一笔画的是「没点过」；预读完成后
      // 登录路径经 paintCounts 会再画一次，未登录路径此前没有 —— 于是点过「我已打开」
      // 的人每次重开 App 都再看一遍横幅（2026-09-11 全回归 F 面，模拟器实测）。
      paintExtBanner(extState);
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
  // 「我已打开」点过了（extBannerDoneAt）。paintExtBanner 是同步函数（paintCounts 与
  // Swift 的 window.show 直接调），所以这个键在 init 时预读进内存，画的时候只看变量 ——
  // 否则先画再收会闪一下。
  const EXT_DONE = 'extBannerDoneAt';
  let extBannerDone = false;
  let extBannerShownDay = '';
  // 启动时「当天记过没有」与「继续设置卡在不在」都还没读出来之前，横幅照画、但不记 shown。
  // 原生的 show('ios') 常在预读之前就到 ⇒ extBannerShownDay 还是空串，每次启动都记一条
  // （1.12.1–1.14.0 线上约四成「装机·天」记了多条，最多一天 52 条）；而且继续设置卡要等
  // paintObResume 才露面，横幅在那之前会先闪一下并记一条，其实用户没看到它。
  let extBannerPrimed = false;
  function extBannerTrack(action) {
    try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('ext_banner', { action }); } catch (_) {}
  }

  function paintExtBanner(state) {
    const sec = $('ext-banner');
    if (!sec) return;
    // 横幅在场时首页 #review 降为次级：「每屏至多一个填色按钮」这条家规同样管首页，
    // 而扩展没开的人本来也没有复习材料。
    const syncReview = () => { const r = $('review'); if (r) r.classList.toggle('secondary', !sec.hidden); };
    // 横幅只属于首页。它原来与 #review-view / #app-settings 平级，而没有任何代码在
    // 进那些视图时收起它 —— 于是它横跨每一个界面钉在最顶上，在一台明显已经在用的
    // 设备上反复说「先去把扩展打开」。
    //
    // 判据写成「有别的视图开着就收起」，而不是「首页开着才显示」：后者在首页两个
    // 区块都还没被 show() 决定归属的那一刻（首帧、以及测试直接调 show() 时）会把
    // 横幅误伤掉。
    const away = !$('review-view').hidden || !$('app-drive').hidden || !$('app-listen').hidden || !$('app-docs').hidden || !$('app-settings').hidden;
    if (away || browserSideOk || extBannerDone) { sec.hidden = true; syncReview(); paintSysBanner(); return; }
    // 引导进行中不挂横幅：引导第 3 屏本身就是这件事，两个一起显示会把同一句话
    // 一字不差地说两遍（2026-08-28 模拟器实测看到的，自动化断言看不出来 ——
    // 它只查内容对不对，不查有没有重复）。
    const onboarding = $('onboard') && !$('onboard').hidden;
    // 「继续设置」卡在场时也让路：它继续的那条引导最后一屏就是这件事（首页不挂两张「还差一步」）。
    const resuming = $('ob-resume') && !$('ob-resume').hidden;
    if (onboarding || resuming || !state || state.enabled === true) { sec.hidden = true; syncReview(); paintSysBanner(); return; }
    sec.hidden = false;
    syncReview();
    paintSysBanner();   // 扩展那张在场 ⇒ 这一张让位（AppSysBanner.decide 读的就是它）
    // iOS 形态（2026-09-10）：5 天遥测里 App 装机 72、Safari 扩展装机 25 —— 装了 App 的人
    // 大多没把扩展打开，而这里 iOS 唯一能用的动作曾是一个次级按钮。改成标题 + 三步
    // （与引导 ext 屏同一份文案与插图）+ 填色主按钮 + 「我已打开」。macOS 形态不变。
    const ios = !state.canOpenPrefs && !state.known;
    $('ext-banner-title').textContent = ios
      ? t('app_ext_banner_title_ios', 'Safari 扩展还没打开')
      : (state.known ? t('app_ext_off_title', '扩展还没启用') : t('app_ext_unknown_title', '先把浏览器那半边打通'));
    const steps = $('ext-banner-steps');
    if (steps) {
      if (ios) obSteps(iosSteps(), steps); else { steps.hidden = true; steps.textContent = ''; }
    }
    const done = $('ext-banner-done');
    if (done) { done.hidden = !ios; done.textContent = t('app_ext_done', '我已打开'); }
    const check = $('ext-banner-check');
    if (check) { check.hidden = !ios; $('ext-banner-check-link').textContent = t('app_ext_check_hint', '不确定？打开检测页看绿灯 →'); }
    if (ios && extBannerPrimed) {
      // 每装机每天至多一条 shown（telemetry-design §3.1）。
      const today = new Date().toISOString().slice(0, 10);
      if (extBannerShownDay !== today) {
        extBannerShownDay = today;
        try { chrome.storage.local.set({ 'tm:extBannerDay': today }, () => {}); } catch (_) {}
        extBannerTrack('shown');
      }
    }
    // 正文按「有没有可点的东西」选，不是按「知不知道状态」选。
    // 2026-08-29 真机撞到：#177 的回退触发后按钮被收起，而正文仍走 known 分支，
    // 于是横幅变成一句「它没启用」加一片空白 —— 收起了动作却没补上说明，
    // 等于把一条死路换成了另一条。有按钮才说「没启用」，没按钮就得给步骤。
    // iOS 形态下三步已经把话说完，正文只留一句「卡片从哪来」。
    $('ext-banner-body').textContent = ios
      ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
      : (state.canOpenPrefs
        ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
        : t('app_ext_ios_body', '卡片来自 Safari 扩展：在 Safari 里点地址栏左边的扩展图标 →「管理扩展」→ 打开大肚猴翻译。'));
    const act = $('ext-banner-act');
    // 只有 macOS 有直达入口。iOS 给按钮却跳不过去，比不给按钮更糟。
    act.hidden = !state.canOpenPrefs;
    act.textContent = t('app_ext_open_prefs', '打开 Safari 扩展设置');
    // 两个平台都给：macOS 有直达设置，但「设完了到底成没成」仍然只有官网那一页
    // 答得出；iOS 除了它没有别的答案。
    const setup = $('ext-banner-setup');
    if (setup) {
      setup.hidden = false;
      // 主/次跟着平台走（与引导 ext 屏 :417 同一写法）：iOS 上它是唯一能用的动作。
      setup.classList.toggle('secondary', !ios);
      setup.textContent = ios
        ? t('app_ext_open_safari', '在 Safari 里打开扩展 →')
        : t('app_ext_open_setup', '在网页上完成设置');
    }
  }

  function iosSteps() {
    return [
      { text: t('ob_ios_1', '在 Safari 里点地址栏左边的扩展图标'), art: 'app-art-1' },
      { text: t('ob_ios_2', '选「管理扩展」，把「大肚猴翻译」打开'), art: 'app-art-2' },
      { text: t('ob_ios_3', '权限选「允许」，网站选「所有网站」'), art: 'app-art-3' },
    ];
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
  // 系统翻译的发现横幅。**跟着扩展横幅一起决定** —— 首页不能同时挂两张「还差一步」，
  // 而「扩展那张在不在」正是这一张的判据之一（画布第 7 页 DiscoverWhen）。
  function paintSysBanner() {
    if (typeof AppSysBanner === 'undefined') return;
    const ext = $('ext-banner');
    const away = !$('review-view').hidden || !$('app-drive').hidden || !$('app-listen').hidden
      || !$('app-docs').hidden || !$('app-settings').hidden;
    AppSysBanner.paint({
      away,
      onboarding: !!($('onboard') && !$('onboard').hidden),
      extBannerShown: !!(ext && !ext.hidden),
    }).catch(() => {});
  }

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
  // 「以后再设置」只记这一次（2026-09-22，画布「以后再设置只记这一次」，用户点头两处：最多 3 次启动、✕ = 永久）。
  // 跳过写这个而**不写** OB_SEEN：{ step: 停在哪一屏, shows: 那张卡已经跟着出现过几次启动 }。
  // 原来跳过与走完写的是同一个 OB_SEEN ⇒「以后」这两个字是句假话：按下去就是「永远不」。
  const OB_RESUME = 'onboardResume';
  const OB_RESUME_MAX = 3;
  // signin 屏按**同步有没有编进这个构建**取舍，与扩展引导的 OB 同一个写法
  // （onboard.js 的 syncOn）。中国版扩展的登录入口是被整节 remove 掉的
  // （options.js 的 `if (!MT_BACKEND.enabled)`），所以那一屏那句「扩展里也要登录
  // 一次」把人送去一个不存在的地方 —— 引导里的第二条死路。
  // 判据按**值**不按 flavor 名：interaction-spec「不存在的功能不许长死状态条」。
  // ⚠️ 中国版**App** 的 MT_BACKEND.enabled 仍是 true（backend.config.js 里明写的
  // 不对称：App Review Route A 需要密码登录），所以今天这个分支在出货产物里不触发。
  // 它守的是「哪天 App 侧也关掉同步」，那时这一屏必须跟着消失，而不是留在那里。
  // 屏序（2026-09-22 重排，画布 #392 第 1 页「App 5 → 4 屏」）：
  //
  //   welcome → signin → firstuse → ext
  //
  // ① **登录从最后一屏提到第 2 屏。** 它是转化最高、且能把后面全部自动化的那一步 ——
  //    登录 = 拿到账号级的免费额度 = 引擎就绪，顺带把扩展那边也备好（额度以 user_id
  //    为主键，一人一枚）。读数：App 侧登录过 29%、**有引擎只有 13%**；54 台登录并
  //    同步过的里 **47 台（87%）既没配引擎也没领额度**。放在最后 = 多数人在拿到引擎
  //    之前就走了，而 **176/247 台整个生命周期不到 5 分钟**，没有第二次会话。
  // ② **「还有两件事在浏览器里做」（填 Key）那一屏删掉** —— 那正是 83% 卡住的一步，
  //    而它的零摩擦替代（登录领额度）此前被排在它后面，顺序是反的。
  // ③ **扩展降到最后一屏** —— 它是唯一会把人送出 App 的动作，而送出去就不回来
  //    （18 台点过「我已打开」的里 16 台点完再没有任何事件）。
  const OB = ['welcome']
    .concat((typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) ? ['signin'] : [])
    .concat(['firstuse', 'ext']);
  let obAt = 0;

  function obPaint() {
    if ($('ob-telemetry')) $('ob-telemetry').hidden = true;   // 只在最后一屏露出
    const step = OB[obAt];
    // 页面自报当前是哪一屏（同扩展 onboard.js 的做法）。门禁原来按「点了几次」数屏：
    // `for (i < 5) seen.push(...)` 再断言 seen.length === 5 —— 屏数变了它照样是 5，
    // 最后一屏被采两遍而已，**结构上就红不了**。2026-09-22 登录屏挪位之后正是这样漏掉了
    // 「登录屏点了只翻页、根本不登录」。自报之后门禁问的是「现在是哪一屏」。
    try { document.body.dataset.obStep = step; } catch (_) {}
    $('ob-fill').style.width = Math.round(((obAt + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-steps', 'ob-kv', 'ob-prefs', 'ob-setup', 'ob-try', 'ob-alt', 'ob-xb-box']) $(id).hidden = true;
    // 主/次逐屏重设，不留状态（同扩展 onboard.js）。默认「继续」是这一屏的主行动；
    // 有自己主行动的屏（「就地试一句」）在下面把它降级 —— 两个填色按钮并排时，用户看不出该点哪个。
    $('ob-next').classList.remove('secondary');
    $('ob-skip').hidden = false;   // 只有登录屏藏它，别的屏要放回来
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-next').hidden = false;   // 只有 'ext' 屏藏它，别的屏要放回来
    $('ob-next').textContent = obAt === OB.length - 1
      ? t('app_signin_open', '登录') : t('ob_next', '继续');

    if (step === 'welcome') {
      // 2026-09-22：不再一上来就讲分工。先说**这个 App 自己能做什么** —— 24% 的人
      // 本来就会自己去找听译，而其中一多半手里没引擎。
      $('ob-title').textContent = t('ob_welcome_title', '学习你真正在读的东西');
      $('ob-text').textContent = t('ob_welcome_body',
        '划词翻译、听一段、看实时字幕 —— 这些在这个 App 里就能用。网页翻译在浏览器那半边。');
      $('ob-next').textContent = t('ob_start', '开始设置');
    } else if (step === 'ext') {
      $('ob-title').textContent = t('app_ext_unknown_title', '先把浏览器那半边打通');
      // 平台不对称照实呈现：macOS 有直达入口和真实状态，iOS 两样都没有。
      const mac = extState && extState.canOpenPrefs;
      $('ob-text').textContent = mac
        ? t('app_ext_off_body', '卡片来自 Safari 扩展。它还没启用，所以这里会一直是空的。')
        : t('app_ext_ios_body', '卡片来自 Safari 扩展：在 Safari 里点地址栏左边的扩展图标 →「管理扩展」→ 打开大肚猴翻译。');
      if (mac) { $('ob-prefs').hidden = false; $('ob-prefs').textContent = t('app_ext_open_prefs', '打开 Safari 扩展设置'); }
      else obSteps(iosSteps());
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
    // 'browser'（「还有两件事在浏览器里做」：填 Key + 打开采集）2026-09-22 删除。
    // 填 Key 是 83% 卡住的那一步，而登录领额度是它的零摩擦替代；采集默认就是开的。
    } else if (step === 'firstuse') {
      // 「就地试一句」（2026-09-22，画布 #392 第 2 页）。原来这一屏是「去读一篇」—— 又一次把
      // 人往浏览器那边推。现在素材内置、两个动作都在 App 里完成：第一次会话必须有产出，
      // 而 176/247 台整个生命周期不到 5 分钟，没有第二次。**不给「先跳过」**（右上角全局的
      // 「以后再设置」仍在，所以不是死路）。
      $('ob-title').textContent = t('ob_try_title', '现在就试一句');
      $('ob-text').textContent = t('ob_try_body', '不用自己找素材，这句就在这儿。翻翻看，或者听一遍。');
      $('ob-try').hidden = false;
      $('ob-next').classList.add('secondary');   // 这一屏的主行动是「翻这一句」
      paintTry();
    } else {
      // 2026-09-22：这一屏从最后提到了第 2 屏，所以「最后一步」这四个字作废；而且它的主按钮
      // 不能再是「继续」—— 原来能登录，是因为它是最后一屏、那个按钮其实是「结束引导、落到
      // 首页登录卡上」。挪到中间之后若不改，这一屏就只是一张说明，**点了只翻页、根本不登录**。
      // 文案按**这个构建有没有额度**分岔：中国版的额度已裁定但还没落地，现在对它说
      // 「领一份免费额度」是假话。判据问 LearnGrant.enabled()，不问 flavor 名。
      const hasGrant = typeof LearnGrant !== 'undefined' && LearnGrant.enabled();
      $('ob-title').textContent = hasGrant
        ? t('ob_signin_grant_title', '登录，顺手领一份免费额度')
        : t('ob_signin_sync_title', '登录（可选）');
      $('ob-text').textContent = hasGrant
        ? t('ob_signin_grant_body', '额度由我们出，够先用一阵；也可以用你自己的 key。登录还能把卡片同步到你的其它设备。')
        : t('ob_signin_sync_body', '登录用来把卡片同步到你的其它设备。翻译引擎可以在设置里填你自己的 key。');
      $('ob-next').textContent = obSignInLabel();
      $('ob-alt').hidden = false;
      $('ob-alt').textContent = t('ob_signin_later', '先不登录');
      // 这一屏只有自己的出口（登录 / 先不登录），不再挂全局的「以后再设置」：
      // 两个意思相近的「不」并排，用户分不清哪个是「跳过这一屏」、哪个是「整条引导都不要」。
      // 画布 #392 第 2 页的登录屏也只有这几个出口。
      $('ob-skip').hidden = true;
      $('ob-xb-box').hidden = !xbNeeded;
      $('ob-kv').hidden = false;
      obKv([[t('ob_kv_twice', '扩展里也要登录一次'), t('ob_kv_twice_note', '两边的存储是分开的，所以会收到两次验证码。用同一个邮箱。')]]);
      // 匿名用量事件说在前面（docs/telemetry-design.md §5）。中国版 App 同一份 bundle，
      // 但 MT_TELEMETRY 为 null，这一句藏掉。
      const tn = $('ob-telemetry');
      if (tn) { tn.hidden = !window.MT_TELEMETRY; tn.textContent = t('telemetry_onboard', '会发送匿名用量数据（不含网页内容与地址），帮助改进；设置里可关。'); }
    }
  }

  // 吃字符串或 {text, art}。`art` 是 index.html 里一个 <template> 的 id —— 插图是
  // 图形不是文案，里面一个要翻译的字都没有，所以克隆一份就行，不必进 i18n。
  //
  // ⚠️ #ob-steps 必须恰好三个直接子元素（verify-app-bundle.js 的断言）。图画在 <li>
  // 内部，不要因为想加一张图就多一个兄弟节点。
  function obSteps(lines, container) {
    const ol = container || $('ob-steps');
    if (!ol) return;
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


  // `result`：走完还是跳过。两条路本来就走同一个收尾，于是在表里长得一模一样
  // （telemetry-design §3.6，2026-09-22）。`step` 是**离开时停在哪一屏**，只记这一条。
  async function obFinish(result) {
    try {
      if (typeof MTTelemetry !== 'undefined') {
        MTTelemetry.track('onboarding_done', {
          surface: 'app', result: result === 'skipped' ? 'skipped' : 'done', step: OB[obAt],
        });
      }
    } catch (_) {}
    try {
      if (result === 'skipped') {
        await new Promise((r) => chrome.storage.local.set({ [OB_RESUME]: { step: OB[obAt], shows: 0 } }, r));
      } else {
        await new Promise((r) => chrome.storage.local.set({ [OB_SEEN]: 1 }, r));
        await new Promise((r) => chrome.storage.local.remove(OB_RESUME, r));
      }
    } catch (_) {}
    $('onboard').hidden = true;
    paintExtBanner(extState);   // 引导退场，横幅按真实状态回来
    await show(await LearnAuth.current().catch(() => null));
  }

  // ── 「继续设置」卡 ─────────────────────────────────────────────────────────
  //
  // 只在**未登录首页**上、且这台设备「还没配好」（EngineState.needsSetup —— 判据只有这一处）时出现。
  // 已登录或已有引擎 ⇒ 要做的已经做了：永久收起，不再出现。每出现一次计一次；第 OB_RESUME_MAX 次
  // 之后自己收起，不纠缠。扩展横幅在它在场时让路（paintExtBanner）：引导最后一屏就是「打开扩展」，
  // 首页不许同时挂两张「还差一步」。
  let obResume = null;
  // 读数（telemetry-design §3.8）：出现 / 点 ✕ / 自动收起。「已登录或已有引擎」那条收起不记 ——
  // 那是「已经做完了」，不是这张卡的结局；点「继续」之后由原来的 surface:'app' 那条回答。
  function obResumeTrack(result) {
    try {
      if (typeof MTTelemetry !== 'undefined' && obResume) {
        MTTelemetry.track('onboarding_done', { surface: 'app_resume', result, step: obResume.step });
      }
    } catch (_) {}
  }
  async function obResumeRetire() {
    obResume = null;
    $('ob-resume').hidden = true;
    try {
      await new Promise((r) => chrome.storage.local.set({ [OB_SEEN]: 1 }, r));
      await new Promise((r) => chrome.storage.local.remove(OB_RESUME, r));
    } catch (_) {}
  }
  // 启动时调一次（每次启动至多计一次）。返回卡是否在场。
  async function paintObResume(session) {
    const card = $('ob-resume');
    card.hidden = true;
    if (!obResume) return false;
    let needs = true;
    try { needs = EngineState.needsSetup(await readObSettings()); } catch (_) {}
    if ((Number(obResume.shows) || 0) >= OB_RESUME_MAX && !session && needs) obResumeTrack('expired');
    if (session || !needs || (Number(obResume.shows) || 0) >= OB_RESUME_MAX) { await obResumeRetire(); return false; }
    obResume = { step: obResume.step, shows: (Number(obResume.shows) || 0) + 1 };
    try { await new Promise((r) => chrome.storage.local.set({ [OB_RESUME]: obResume }, r)); } catch (_) {}
    const at = Math.max(0, OB.indexOf(obResume.step));
    $('ob-resume-title').textContent = t('ob_resume_title', '继续设置 · 还差 {n} 步').replace('{n}', String(OB.length - at));
    $('ob-resume-body').textContent = t('ob_resume_body', '从上次停下的那一屏接着来，一两分钟就好。');
    $('ob-resume-go').textContent = t('ob_resume_go', '从上次停下的地方继续');
    $('ob-resume-close').setAttribute('aria-label', t('ob_resume_close', '不再提示'));
    card.hidden = false;
    obResumeTrack('shown');
    paintExtBanner(extState);
    return true;
  }
  $('ob-resume-go').addEventListener('click', () => {
    const at = Math.max(0, OB.indexOf(obResume && obResume.step));
    $('ob-resume').hidden = true;
    $('signed-out').hidden = true;
    $('signed-in').hidden = true;
    $('onboard').hidden = false;
    paintExtBanner(extState);
    obAt = at; obPaint();
  });
  $('ob-resume-close').addEventListener('click', async () => { obResumeTrack('dismissed'); await obResumeRetire(); paintExtBanner(extState); });

  // ─── Sign in ──────────────────────────────────────────────────────────────

  let pendingEmail = '';

  // ── 出境单独同意（2026-09-22）─────────────────────────────────────────────
  //
  // 中国版 App 的账号与卡片存在东京（backend.config.js 顶层 url）。PIPL 第 39 条要求
  // 向境外提供个人信息须告知接收方等事项、并取得**单独同意**；人数少只免于申报，
  // 这一条不免（《促进和规范数据跨境流动规定》第 5 条第 4 项 与第 10 条）。
  //
  // 「单独」的意思是：不跟隐私政策捆在一起、不默认勾上、不同意也能用别的功能。所以：
  //   · 框默认不勾；不勾时**四条登录路**（Apple · Google · 邮箱验证码 · 密码）全部拦下；
  //   · 拦下时说清楚「不勾也能用，只是不同步」—— 登录本来就是可选的；
  //   · 同意记一次就不再问（xbConsent），两个框（首页卡 / 引导登录屏）读写同一个键。
  //
  // 出不出现按**值**判，不按 flavor 名：后端地址在 *.supabase.co（东京）才需要。境内后端
  // 就绪（china.ready=true，产物 url 换成境内域名）那天，这个框自己消失，不用再改这里。
  const XB_KEY = 'xbConsent';
  const xbNeeded = (() => {
    try {
      if (window.MT_FLAVOR !== 'china') return false;
      if (typeof MT_BACKEND === 'undefined' || !MT_BACKEND.enabled) return false;
      return /\.supabase\.co$/i.test(new URL(MT_BACKEND.url).hostname);
    } catch (_) { return false; }
  })();
  let xbAgreed = false;
  const XB_BOXES = [['xb-box', 'xb-check'], ['ob-xb-box', 'ob-xb-check']];
  function xbPaint() {
    for (const [box, chk] of XB_BOXES) {
      const el = $(box); if (!el) continue;
      // 引导里那一份只在登录屏露出，显隐归 obPaint 管；这里只管首页卡上那一份。
      if (box === 'xb-box') el.hidden = !xbNeeded;
      if (!xbNeeded) continue;
      el.querySelector('.xb-text').textContent = t('xb_consent',
        '我单独同意：登录后，我的账号信息（邮箱或 Apple 账号标识）与学习卡片（读过的句子、译文、来源页面的地址与标题）传输到位于日本东京的服务器存储，接收方为 Supabase Pte. Ltd.。');
      el.querySelector('.xb-link').textContent = t('xb_consent_link', '接收方、用途与怎么撤回，见隐私政策第 3 节');
      $(chk).checked = xbAgreed;
      if (xbAgreed) { el.classList.remove('need'); el.querySelector('.xb-err').hidden = true; }
    }
  }
  function xbSet(on) {
    xbAgreed = !!on;
    try {
      if (on) chrome.storage.local.set({ [XB_KEY]: { v: 1, at: new Date().toISOString() } });
      else chrome.storage.local.remove(XB_KEY);
    } catch (_) {}
    xbPaint();
  }
  // 放行 → true；拦下 → false，并在**离人最近的那个框**上说为什么。
  function xbGate(boxId) {
    if (!xbNeeded || xbAgreed) return true;
    const el = $(boxId);
    if (el) {
      el.classList.add('need');
      const err = el.querySelector('.xb-err');
      err.textContent = t('xb_need', '要登录，先勾选上面这一条。不勾也能用，只是卡片不会同步。');
      err.hidden = false;
      try { $(boxId === 'ob-xb-box' ? 'ob-xb-check' : 'xb-check').focus(); } catch (_) {}
    }
    return false;
  }
  for (const [box, chk] of XB_BOXES) {
    $(chk).addEventListener('change', (e) => xbSet(e.target.checked));
    $(box).querySelector('.xb-link').addEventListener('click', (ev) => {
      ev.preventDefault();
      openExternal('https://belliedmonkey.com/privacy.html#sync');
    });
  }
  // 拦在**捕获阶段**、挂在卡片上：四条路各自的监听器都在按钮/表单本身上，捕获阶段先到，
  // stopImmediatePropagation 之后它们一个都收不到。新加一条登录路只要在这张卡里，就自动被拦。
  $('signin-prompt').addEventListener('click', (e) => {
    if (!e.target.closest('#btn-apple, #btn-google')) return;
    if (!xbGate('xb-box')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  $('signin-prompt').addEventListener('submit', (e) => {
    if (!xbGate('xb-box')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  if (xbNeeded) {
    try {
      chrome.storage.local.get([XB_KEY], (v) => { xbAgreed = !!(v && v[XB_KEY]); xbPaint(); });
    } catch (_) {}
  }
  xbPaint();

  // 登录屏的主按钮：**代理首页那张卡上真的登录按钮**，不再写第二份登录。顺序与那张卡
  // 一致 —— 一键的在前（Apple → Google），都不在（桥缺席、或这个构建没开那家）才退到邮箱；
  // 邮箱是多步表单，放不进引导，所以它是唯一一条「结束引导、去首页那张卡」的路。
  function obSignInProvider() {
    for (const id of ['btn-apple', 'btn-google']) {
      const b = $(id);
      if (b && !b.hidden && !b.disabled) return b;
    }
    return null;
  }
  function obSignInLabel() {
    const b = obSignInProvider();
    if (b && b.id === 'btn-apple') return t('sync_with_apple', '用 Apple 登录');
    if (b && b.id === 'btn-google') return t('sync_with_google', '用 Google 登录');
    return t('ob_signin_email', '用邮箱登录');
  }
  function obStartSignIn() {
    if (!xbGate('ob-xb-box')) return;   // 出境单独同意（见 xbNeeded）
    const b = obSignInProvider();
    if (b) { b.click(); return; }   // 登录成功会回到 show(session)，那里让引导前进一屏
    obFinish().then(() => { try { openEmailForms(); } catch (_) {} });
  }
  // ── 「就地试一句」────────────────────────────────────────────────────────────
  //
  // 素材内置（2026-09-22 裁定）。**目标语言是英文的人换一句非英文的** —— 拿英文去翻英文，
  // 译文和原文几乎一样，看起来就像「没翻」（1.14.0 拍系统翻译截图时踩过：英译英）。
  // 两个动作走的都是**功能真正用的那条传输**（TranslationAPI / LearnTTS），不另造请求：
  // 一个用别的请求去试的「试一句」，试到的就不是用户之后会走的那条路。
  const TRY_EN = 'Reading in a second language gets easier once the same words keep coming back.';
  let tryText = TRY_EN, tryLang = 'en';
  async function paintTry() {
    $('ob-try-tr').textContent = t('ob_try_translate', '翻这一句');
    $('ob-try-say').textContent = t('ob_try_listen', '听这一句');
    const out = $('ob-try-out'); out.hidden = true; out.textContent = ''; out.className = '';
    let target = '';
    try { target = (await readObSettings()).targetLang || ''; } catch (_) {}
    if (!target && typeof TranslationCore !== 'undefined') target = TranslationCore.DEFAULT_TARGET_LANG || '';
    if (/^en(\b|-|_|$)/i.test(target)) {
      tryText = t('ob_try_sample_alt', '在第二语言里读东西，同一个词见得多了，就不再需要查了。');
      tryLang = 'zh-CN';
    } else { tryText = TRY_EN; tryLang = 'en'; }
    $('ob-try-src').textContent = tryText;
  }
  function tryOut(text, cls) {
    const out = $('ob-try-out'); out.hidden = false; out.className = cls || ''; out.textContent = text;
  }
  // 没有引擎时说的那句话，按这个构建**有没有额度**分岔（中国版现在说「登录就有」是假话）。
  const tryNoEngine = () => ((typeof LearnGrant !== 'undefined' && LearnGrant.enabled())
    ? t('ob_try_noengine_grant', '还没有可用的翻译引擎。登录一下就会自动领一份免费额度；也可以在设置里填自己的 key。')
    : t('ob_try_noengine_key', '还没有可用的翻译引擎 —— 在设置里填一把 key 就能用。'));

  $('ob-try-tr').addEventListener('click', async () => {
    const btn = $('ob-try-tr');
    if (btn.disabled) return;                 // 全局原则：IO 在途，控件不可用
    btn.disabled = true;
    tryOut(t('ob_try_working', '正在翻译…'));
    try {
      if (currentSession) await autoClaimGrant();   // 刚登上的人：等那一次领取落地
      const s = await readObSettings();
      if (typeof EngineState !== 'undefined' && EngineState.needsSetup && EngineState.needsSetup(s)) {
        tryOut(tryNoEngine(), 'bad'); return;
      }
      const target = s.targetLang || (typeof TranslationCore !== 'undefined' && TranslationCore.DEFAULT_TARGET_LANG) || 'zh-CN';
      const out = await TranslationAPI.translate(tryText, target, s.provider, s.apiKey, s.apiBaseUrl, s.apiModel);
      // isTranslated(input, output) —— **两个参数**。只传一个的话 output 是 undefined，任何
      // 真实译文都被判成「没翻」、显示「端点通了但返回的内容无法解析」。门禁钉死「有引擎」
      // 那个场景（桩一句译文）之后当场抓到的，之前那一版门禁只测到了「连不上外网」。
      if (!out || (typeof TranslationCore !== 'undefined' && !TranslationCore.isTranslated(tryText, out))) {
        const e = new Error('empty'); e.code = 'bad_output'; throw e;
      }
      tryOut(String(out).trim(), 'ok');
    } catch (e) {
      // 失败具名，而且与设置页同一句话（EngineTest.reason 是那张表的唯一出处）。
      tryOut('✗ ' + ((typeof EngineTest !== 'undefined') ? EngineTest.reason(e, t) : String((e && e.message) || e)), 'bad');
    } finally { btn.disabled = false; }
  });

  $('ob-try-say').addEventListener('click', async () => {
    const btn = $('ob-try-say');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      if (currentSession) await autoClaimGrant();
      const s = await readObSettings();
      // **没有回落**：未配置就说未配置，不偷偷换成系统自带去出一个声（settings.js
      // liveTtsConfigure 那条同一个理由）。
      LearnTTS.configure(Object.assign({}, LearnTTS.config, {
        engineId: s.ttsEngine || '', apiKey: s.ttsApiKey || '', baseUrl: s.ttsBaseUrl || '',
        model: s.ttsModel || '', voice: s.ttsVoice || '',
      }));
      const r = await LearnTTS.speak(tryText, tryLang);
      if (!r || !r.ok) { tryOut('✗ ' + LearnTTS.reason(r && r.reason, t), 'bad'); return; }
      // 播放也算在途（同复习页 ▶）：按钮等这一句放完，但有上限 —— 有的宿主会吞掉 end 事件。
      await Promise.race([(r.done || Promise.resolve()).catch(() => {}), new Promise((res) => setTimeout(res, 15000))]);
    } catch (e) {
      tryOut('✗ ' + String((e && e.message) || e), 'bad');
    } finally { btn.disabled = false; }
  });

  $('ob-alt').addEventListener('click', () => {
    if (OB[obAt] === 'signin' && obAt < OB.length - 1) { obAt += 1; obPaint(); }
  });

  $('ob-next').addEventListener('click', () => {
    if (OB[obAt] === 'signin') { obStartSignIn(); return; }
    if (obAt < OB.length - 1) { obAt += 1; obPaint(); return; }
    // 最后一屏的主按钮直接进登录表单 —— 引导走到这儿，人是准备好的。
    // 引导收尾落到未登录首屏的说明卡上：一键登录在卡上，邮箱是卡上那行链接 ——
    // 不再直接摊开邮箱表单（那会让最费劲的路又排到最前面）。
    obFinish().then(() => { try { $('btn-apple').focus(); } catch (_) {} });
  });
  $('ob-skip').addEventListener('click', () => { obFinish('skipped'); });
  $('ob-prefs').addEventListener('click', openSafariPrefs);

  // 邮箱是备选：展开表单时一键登录仍留在卡上；只有那行链接自己消失。
  function openEmailForms() {
    $('signin-forms').hidden = false;
    $('btn-signin').hidden = true;
    try { $('email').focus(); } catch (_) {}
  }
  $('btn-signin').addEventListener('click', openEmailForms);

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
    $('btn-apple-label').textContent = t('sync_with_apple', '用 Apple 登录');
    $('btn-apple').hidden = false;
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
    $('btn-google-label').textContent = t('sync_with_google', '用 Google 登录');
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
      $('signin-prompt').classList.add('code-step');   // 验证码是第二屏，不往下堆
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
    $('signin-prompt').classList.remove('code-step');
    $('email').focus();
    say('');
  });
  $('resend').addEventListener('click', async () => {
    if (!pendingEmail) return;
    $('resend').disabled = true;
    say(t('app_sending', '正在发送…'));
    try { await LearnAuth.signIn(pendingEmail); say(t('app_code_sent', '验证码已发送，查收邮件。')); }
    catch (err) { say(humanError(err), true); }
    finally { $('resend').disabled = false; }
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
      // 离开复习面 = 这一轮结束（telemetry-design §3.7 A）。App 是长驻单页，没有 pagehide 可挂。
      try { if (window.LearnReview && LearnReview.leave) LearnReview.leave(); } catch (_) {}
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

  // `anchorId` 是可选的落点。**落点是那个控件本身，不是页面顶部** ——
  // 「按钮点了、人到了、控件没找到」是 2026-09-02 真机实测过的失败形状
  // （interaction-spec 有这条：任何把人往某个控件送的按钮，落点是那个控件）。
  // 从哪个首页进的设置，关掉就回哪个。此前这里只藏 signed-in、closeSettings 恒显 signed-in ——
  // 从未登录首页进设置再退出，两个首页同时可见（2026-09-17 test:listen 把它暴露出来）。
  let settingsFrom = 'signed-in';
  async function openSettings(anchorId) {
    settingsFrom = $('signed-in').hidden && !$('signed-out').hidden ? 'signed-out' : 'signed-in';
    // 从复习页点「设置」也是离开复习面（telemetry-design §3.7 A）。
    if (!$('review-view').hidden) { try { if (window.LearnReview && LearnReview.leave) LearnReview.leave(); } catch (_) {} }
    $('signed-in').hidden = true;
    $('signed-out').hidden = true;
    $('review-view').hidden = true;
    $('app-settings').hidden = false;
    await AppSettings.paint(currentSession, say);
    paintExtRestore();
    say('');
    if (!anchorId) return;
    const el = $(anchorId);
    if (!el) return;
    // 落点在「引擎与密钥」的某一档里 ⇒ 先切到那一档（2026-09-17 设置页信息架构：档位只管第一节，
    // 但那一节里的东西在另一档下是 hidden 的，滚过去只会落到一片看不见的东西上）。
    if (el.closest('.adv-only')) await AppSettings.setDetail(true);
    else if (el.closest('.quick-only')) await AppSettings.setDetail(false);
    // paint 之后再滚：paint 会增删 .adv-only 的 hidden，滚在它之前会落到旧布局上。
    try { el.scrollIntoView({ block: 'center' }); } catch (_) { el.scrollIntoView(); }
    el.classList.add('anchor-flash');
    setTimeout(() => el.classList.remove('anchor-flash'), 2400);
  }

  // 2026-09-17：实时转写固定为设备内置，转写注册表里不再有 `device` 条目（learning-design §9.4 修订）。
  // 老装机若存着 sttEngine:'device'，四元组清空 —— 它在文件槽（说题）从未工作过，清掉不是丢配置，
  // 而是让说题回到「未配置」这个诚实的哨兵态。幂等：只在命中时写一次，之后再也命不中。
  async function migrateSttDevice() {
    try {
      const s = await new Promise((r) => chrome.storage.local.get(['sttEngine'], (v) => r(v || {})));
      if (s.sttEngine !== 'device') return;
      await new Promise((r) => chrome.storage.local.set({ sttEngine: '', sttApiKey: '', sttBaseUrl: '', sttModel: '' }, r));
    } catch (_) {}
  }

  async function closeSettings() {
    $('app-settings').hidden = true;
    // 回执与「从哪来」那一行都只属于这一次配置，离开就收掉 —— 留着的话，
    // 下一次进设置页会看到一段与此刻无关的「可以用了」。
    try { if (typeof AppSetupDone !== 'undefined') AppSetupDone.hide(); } catch (_) {}
    if ($('setup-from')) $('setup-from').hidden = true;
    $(settingsFrom).hidden = false;
    await paintCounts();
    say('');
  }

  // ── 设置 · ② 功能 ·「Safari 扩展」：误点了「我已打开」能把首页横幅找回来 ─────────────
  //
  // 画布 YEDD4VmT9Pv2htUpoWZ9ZB 第 2 页板 ⑤，用户 2026-09-22 点头（放「② 功能」、就地说「已恢复」）。
  // 数据说延时提醒触达不到（18 台点过「我已打开」且没卡的里，隔天回来 0 台），所以不做「7 天后自动回来」，
  // 只给一个手动入口。只在横幅确实被「我已打开」收起过时出现 —— 对没点过的人那是一个什么都不会发生的按钮。
  // 不加读数：横幅回来后照常发 ext_banner{shown}。回首页时横幅由 closeSettings → paintCounts → paintExtBanner
  // 重画（那条路本来就在），这里只负责把内存与存储里的标记一起清掉。
  function paintExtRestore() {
    const g = $('g-extbanner'); if (!g) return;
    g.hidden = !extBannerDone;
    $('extb-title').textContent = t('extb_title', 'Safari 扩展');
    // {done} 由横幅按钮自己的文案填 —— 不在 12 份译文里各抄一遍：第一版抄了，4 门语言与按钮上的字对不上。
    $('extb-note').textContent = t('extb_note', '你之前点过「{done}」，首页那张提示已经收起。如果其实还没打开，从这里把它找回来。')
      .replace('{done}', t('app_ext_done', '我已打开'));
    $('extb-restore').textContent = t('extb_restore', '在首页重新显示「打开扩展」提示');
    $('extb-note').hidden = false; $('extb-restore').hidden = false; $('extb-done').hidden = true;
  }
  $('extb-restore').addEventListener('click', async () => {
    extBannerDone = false;
    extBannerShownDay = '';     // 也清当天已显示的计数：回首页立刻看得到，不用等到明天
    try { await new Promise((r) => chrome.storage.local.remove([EXT_DONE, 'tm:extBannerDay'], r)); } catch (_) {}
    $('extb-note').hidden = true; $('extb-restore').hidden = true;
    const done = $('extb-done');
    done.textContent = t('extb_done', '已恢复 —— 回到首页就能看到那张提示。');
    done.hidden = false;
  });

  $('ext-banner-act').addEventListener('click', openSafariPrefs);
  $('ext-banner-setup').addEventListener('click', () => { extBannerTrack('setup'); openExternal(setupPageUrl()); });
  $('ext-banner-done').addEventListener('click', () => {
    extBannerDone = true;
    extBannerTrack('done');
    try { chrome.storage.local.set({ [EXT_DONE]: Date.now() }, () => {}); } catch (_) {}
    paintExtBanner(extState);
  });
  // `check` 与主按钮的 `setup` 分开记（telemetry-design §3.7 B）：两处原来共用 setup，分不出人是从哪儿走的。
  $('ext-banner-check-link').addEventListener('click', (ev) => { ev.preventDefault(); extBannerTrack('check'); openExternal(setupPageUrl()); });
  $('ob-setup').addEventListener('click', () => {
    openExternal(setupPageUrl());
    // 这一屏没有「继续」，所以这个按钮同时是前进键 —— 否则点了它的人（也就是照做
    // 的人）会被卡在这一屏，后面三屏只能靠「以后再设置」整个跳过。
    // ext 现在是**最后一屏**（2026-09-22 重排），所以这个按钮兼作收尾键；
    // 它以前排在中间，那时它兼作前进键。两种情形都不能把照做的人卡在原地。
    if (OB[obAt] !== 'ext') return;
    if (obAt < OB.length - 1) { obAt += 1; obPaint(); } else obFinish();
  });
  $('gear').addEventListener('click', openSettings);
  $('gear2').addEventListener('click', openSettings);
  $('settings-back').addEventListener('click', closeSettings);
  // 播客入口下面「没配语音 → 设置」的出口。driving.js 只管显隐与文案，点击归这里
  // （它才拥有 openSettings）—— 而这条线以前没接，按钮是死的，恰恰在「还没配语音」
  // 这个最需要出路的场景里（2026-09-06）。落点是语音引擎那个控件，不是页面顶部。
  $('app-drive-need-tts-go').addEventListener('click', () => openSettings('tts-engine'));
  // 2026-09-17 之前：对话 · 实时字幕入口灰掉时有一条「去设置里选择 →」通向转写引擎那一档。
  // 实时转写固定为设备内置后，灰掉只可能是系统太旧或语言不支持 —— 设置里没有能解决它的东西，
  // 那几个按钮由 app/listen.js 常藏；asr_entry{no_live} 改在入口刷出灰态时记（listen.js refreshEntry）。
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
    await migrateSttDevice();
    AppDriving.wire();
    AppListen.wire();
    AppDocs.wire({ openSettings });
    // 快速翻译（§9.9）：macOS 才有原生半边；别的壳上 quick-probe 没人回，这一行就是空操作。
    // 确认框用页内的 LearnDialog —— App 里 window.confirm 恒为 false。
    // 引擎配置镜像给系统翻译扩展（§9.9）。iOS 才有原生半边；别的壳上 available() 是
    // false，这一行就是空操作 —— 与 AppQuickHost 的 quick-probe 同一条纪律。
    try { if (typeof AppVault !== 'undefined') AppVault.start(); } catch (_) {}
    try {
      if (typeof AppQuickHost !== 'undefined') {
        AppQuickHost.start({ openSettings, confirm: (m, o) => (typeof LearnDialog !== 'undefined' ? LearnDialog.confirm(m, o) : Promise.resolve(true)) });
      }
    } catch (_) {}
    AppSettings.wire({
      say,
      session: () => currentSession,
      // 免费额度那张卡要的两样。开外链必须走原生桥（WKWebView 里 window.open 是哑的），
      // 判断只放在这一处 —— 设置页自己 postMessage 的话，宿主判断就成了两份。
      openExternal,
      onSignIn: () => { show(null); },
      onSignOut: async () => {
        // 同扩展设置页（F06）：额度在用先确认，退出即清三槽令牌与 grantTail / grantBalance。
        const cur = await new Promise((res) => chrome.storage.local.get(['apiKey', 'ttsApiKey', 'sttApiKey', 'grantTail'], (v) => res(v || {})));
        const active = typeof LearnGrant !== 'undefined' && LearnGrant.active(cur);
        if (active) {
          const go = await LearnDialog.confirm(t('grant_signout_confirm', '退出登录后免费额度会停用（余额保留，再登录就回来）。要退出吗？'), { ok: t('app_set_signout', '退出登录') });
          if (!go) return;
        }
        await LearnAuth.signOut();
        if (cur.grantTail) {
          const c = LearnGrant.clearOnSignOut(cur);
          await new Promise((res) => chrome.storage.local.set(c.writes, () => chrome.storage.local.remove(['grantTail', 'grantBalance'], res)));
        }
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
    try { if (typeof AppSetupDone !== 'undefined') AppSetupDone.wire({ close: () => closeSettings() }); } catch (_) {}
    try { if (typeof AppSysBanner !== 'undefined') AppSysBanner.wire({ openReview: () => { const r = $('review'); if (r) r.click(); } }); } catch (_) {}

    function parseDeepLink(raw) {
      try {
        const u = new URL(String(raw || ''));
        if (!/^belliedmonkey(cn)?:$/.test(u.protocol)) return null;
        // `has` 与「空串」必须分开：不带 uid 是「扩展没登录」，带空串是
        // 「登录了但 id 读不出来」—— 两者要给的话不一样。
        const has = u.searchParams.has('uid');
        return { action: (u.hostname || u.pathname.replace(/^\/+/, '')) || 'review',
          // `from` 说的是「谁把我推过来的」。此前它被整个丢弃，于是弹层那句
          // 「配好后回到刚才的 App 再点一次翻译」（interaction-spec :980）无从落地。
          from: String(u.searchParams.get('from') || ''),
          hasUid: has, uid: has ? String(u.searchParams.get('uid') || '') : null };
      } catch (_) { return null; }
    }
    window.__mtDeepLink = (raw) => { const d = parseDeepLink(raw); if (d) applyDeepLink(d); };

    // 「从哪来」的那一行。只有真的被推过来时才出现 —— 自己走进设置页的人不需要它。
    // 配好之后它不必自己变：回执块就在同一屏上，那才是「你可以回去了」的载体。
    function paintSetupFrom(src) {
      const el = $('setup-from');
      if (!el) return;
      if (src !== 'systrans') { el.hidden = true; return; }
      el.textContent = t('setup_from_systrans',
        '从系统翻译过来的：配好之后，回到刚才的 App 再点一次「翻译」。');
      el.hidden = false;
    }

    // 三支，每一支都必须说得出**事实**，不猜。
    async function applyDeepLink(d) {
      // ⓪ action='listen'（2026-09-16）：扩展那边遇到转不了的媒体，把人送到实时字幕。
      //
      // **排在账号三支之前，因为它与账号无关** —— 实时字幕/听译不是学习层功能，
      // 不需要登录。落进下面那三支的话，一个没登录的人会被要求先登录才能听字幕，
      // 而登录对这件事毫无作用。
      //
      // 走按钮自己的处理器，不在这里抄一份视图切换 —— 同下面 $('review').click()
      // 那条注释的理由：那一段还带着入口门控与模式绘制，抄漏一件的表现是
      // 「进了页面但开不了」。入口灰着（没有实时引擎等）时 click 不触发，人看到的
      // 是首页上那条具名的灰态原因 + 去设置的链接，那已经是有意义的状态。
      // ①' action='setup'（2026-09-20，§9.9）：系统翻译的弹层在未配置时把人送过来。
      //
      // 与 'listen' 同理排在账号三支之前 —— 配引擎与登不登录无关，落进下面那三支会让
      // 一个没登录的人被要求先登录才能填 key，而登录对这件事毫无作用。
      // 送到「引擎与密钥」那一节，不是设置页顶部：人是带着「这里不能用」这个问题来的。
      if (d.action === 'setup') {
        $('onboard').hidden = true;
        // 人是带着「那边不能用」这个问题来的：先记下从哪来（决定配好之后说什么），
        // 再在「引擎与密钥」顶上说清楚他为什么在这儿。
        const src = d.from === 'system-translate' ? 'systrans' : 'settings';
        try { if (typeof AppSetupDone !== 'undefined') AppSetupDone.mark(src); } catch (_) {}
        try { openSettings('sec-engines'); } catch (_) { openSettings(); }
        paintSetupFrom(src);
        return;
      }
      if (d.action === 'listen') {
        $('onboard').hidden = true;
        // 入口有登录/未登录两个变体（`app-subs-entry` 与 `…entry2`，见 listen.js 的
        // ENTRY_SUFFIXES）。点**可见且没被禁用**的那一个：hidden 元素的 click() 照样
        // 触发处理器，点错会让视图从一个本不该在场的来处切走；disabled 则不触发，
        // 那正是我们要的 —— 没有实时引擎时人停在首页，看到那条具名的灰态原因。
        try {
          const btn = ['app-subs-entry', 'app-subs-entry2']
            .map((id) => $(id)).find((b) => b && !b.hidden && !b.disabled);
          if (btn) btn.click();
        } catch (_) {}
        return;
      }
      const mine = (currentSession && currentSession.userId) || '';
      // ① App 未登录。扩展那边登没登录，决定这句话怎么说。
      if (!mine) {
        $('onboard').hidden = true;
        $('signed-out').hidden = false;
        openEmailForms();
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
      openEmailForms();
      say(t('app_dl_signin', '浏览器扩展那边已经登录了。在这里用同一个账号登录，卡片才会同步过来。'), true);
    });
    $('dl-mismatch-keep').addEventListener('click', () => { $('dl-mismatch').hidden = true; });

    try {
      const session = await LearnAuth.current();
      // 横幅的两个 UI 状态键预读进内存（paintExtBanner 是同步的）。读失败按「没点过」。
      try {
        const o = await new Promise((r) => chrome.storage.local.get([EXT_DONE, 'tm:extBannerDay'], r));
        extBannerDone = !!(o && o[EXT_DONE]);
        extBannerShownDay = (o && o['tm:extBannerDay']) || '';
      } catch (_) {}
      // 首次运行且未登录 ⇒ 走引导。已登录的人显然已经过了这一关，别再挡他。
      const obState = await new Promise((r) => chrome.storage.local.get([OB_SEEN, OB_RESUME], r)).catch(() => null);
      const seen = !obState || !!obState[OB_SEEN];
      obResume = (!seen && obState && obState[OB_RESUME] && typeof obState[OB_RESUME] === 'object') ? obState[OB_RESUME] : null;
      // 跳过过的人回来：不重弹整条引导（被跳过的东西再挡一次路是打扰），首页出「继续设置」卡。
      if (!session && !seen && !obResume) {
        $('signed-out').hidden = true;
        $('signed-in').hidden = true;
        $('onboard').hidden = false;
        extBannerPrimed = true;
        paintExtBanner(extState);   // 收掉横幅：引导第 3 屏就是它要说的话
        obAt = 0; obPaint();
        return;
      }
      await show(session);
      if (obResume) await paintObResume(session);
      extBannerPrimed = true;
      paintExtBanner(extState);   // 预读与继续设置卡都定了：这一次画才算用户看到的
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
      extBannerPrimed = true;
      await show(null);
      say(humanError(err), true);
    }
  })();
})();

// 用量事件：App 打开即 flush + 当日心跳。
try { if (typeof MTTelemetry !== 'undefined' && !(typeof AppQuick !== 'undefined' && AppQuick.isQuickMode())) MTTelemetry.init({ flushNow: true }); } catch (_) {}
