// src/app/shell-model.js — the app shell's imperative logic, moved VERBATIM from
// app/app.js (PR6a of the React migration, docs/domain-design.md §10).
//
// The React boundary in this PR is the DOM: AppShell.jsx renders the ten static
// sections inside <main id="app"> (text leaves left empty — the painters below
// write them, exactly as they wrote against the static HTML). Everything here is
// the shell's BEHAVIOUR — show(), the onboarding state machine, the ext banner,
// sign-in forms, deep links, sync — untouched so the test anchors that grep these
// bytes keep asserting the same invariants (their read() paths move in the same
// PR; the PR description carries the anchor table).
//
// Two deliberate movements, both declared in the PR description:
//   · the #quick fork (AppQuick.boot(); return) lives in main.jsx now — it must
//     run AFTER the React mount, because quick.js clones its language dropdown
//     from the static #target-lang options (quick-model.js boot), which only exist once
//     AppShell is on the page. The mount is side-effect-free (html.quick-mode CSS
//     hides #app; nothing opens idb or sends telemetry before the fork).
//   · the MTTelemetry.init tail lives at the end of main.jsx — it ran outside the
//     IIFE there, it runs outside bootShell() here.
//
// One mechanical rewrite, semantics-preserving: bare/window MT_* globals become
// Registry.* reads (src/lib/registry.js — the only place src/ may touch the
// window.MT_* registries; test/src-boundaries.test.js enforces this). Call-time
// getters return null/[] where the bare global was undefined, which is exactly
// the falsy the `typeof MT_BACKEND !== 'undefined'` guards branched on. MTTelemetry
// has no underscore — it stays a bare global that resolves to window, as before.
//
// The bridge surface moved in PR9: the four window-level ABI names (show /
// __mtAppleResult / __mtWebAuthResult / __mtDeepLink) are hung by
// native-bridge.installBridgeGlobals() (main.jsx, before the #quick fork) and
// this file SUBSCRIBES via NativeBridge.onNative — the hand-rolled pending
// replays (webauth/apple) are gone, and the deeplink one PR6a had dropped on
// the floor is back via the bridge's hold-and-replay (native-bridge.js header).

import Registry from '../lib/registry.js';
import NativeBridge from '../lib/native-bridge.js';
import PageText from '../lib/i18n.js';
import settingsModel from './settings-model.js';
import * as FirstRun from './firstrun.js';   // 首屏三段式的纯判定（#532）

export function bootShell() {
  const $ = (id) => document.getElementById(id);

  // Declared up here, not beside the sign-in code: `show()` reads it and is defined
  // above that point, so a `let` further down would be a temporal-dead-zone trap
  // waiting for the first refactor that calls `show()` earlier.
  let currentSession = null;

  // Same i18n as every other surface (interaction-spec 「界面语言」: no hardcoded
  // copy, anywhere). The bundle has carried MT_I18N_MESSAGES from the start — the
  // shim's getUILanguage hands it the system locale — so the app shell localizes
  // exactly like the extension pages do. The Chinese here is the FALLBACK argument
  // only, per the standing convention: a missing key must never blank the UI, and
  // the literal beside the key is what the translator's source of truth
  // (_locales/zh_CN) says. (PR9: PageI18n.t → PageText.t — src/ has left the
  // shared-byte i18n; test/src-boundaries.test.js pins the whitelist.)
  const t = (k, fb) => PageText.t(k, fb);

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
    // 兜底**绝不把服务端原文甩给用户**（那一句多半是英文的 GoTrue 串，如 "Validation failed" /
    // "User already registered"）。2026-10-02（用户）：表外 code 走这里 —— 复用 App 已有的
    // 「登录没能完成」那句（12 语种已在位），不新造文案。
    // ⚠️ 它是 Apple 专用措辞（「改用下面的邮箱或手机号」在登录屏上任何一条路都成立，
    // 但「Apple 登录」这个前缀对 Google / 邮箱那条路不准）。等设计门出稿换成一条通用句。
    return t('app_apple_failed', 'Apple 登录没能完成。可以改用下面的邮箱或手机号。');
  }

  function paintStatic() {
    // 产品名也是要本地化的一句（`action_title`，12 个语种都有）。它原来是 index.html 里
    // 一段**写死的 h1**：没有 id、没有 data-i18n，于是谁都重画不到它 —— 界面语言切成
    // English、系统语言也切成英文之后，整屏只剩这四个字还是中文（2026-09-25 用户当场指出）。
    $('app-brand').textContent = t('action_title', '大肚猴翻译');
    // 顶栏品牌（2026-10-02）：账号行收进 44×44 圆键后，顶栏左侧只留品牌。
    $('acct-brand').textContent = t('action_title', '大肚猴翻译');
    // 屏 1 的主句讲 **App 自己的卖点**（2026-10-01 用户裁定）：原来那句「你在浏览器里读到的句子，
    // 会同步到这里来复习」把 App 写成扩展的下游 —— 而「边听边翻 + 声音只在设备上处理」是扩展
    // 给不了的。卡内那句同理：登录换来的是额度与两个设备包，不是「替扩展做同步」。
    $('lede').textContent = t('app_lede', '视频、对话、文档 —— 边听边翻，声音只在你的设备上处理。');
    $('email-label').textContent = t('app_email_label', '邮箱');
    $('send').textContent = t('app_send', '发送验证码');
    $('code-label').textContent = t('app_code_label', '验证码（查收邮件）');
    $('verify').textContent = t('app_verify', '登录');
    $('back').textContent = t('app_back_email', '换一个邮箱');
    $('resend').textContent = t('sync_resend', '重新发送');
    $('signin-why').textContent = t('app_signin_why',
      '登录后免费额度自动到账，两个语音包下到本机，之后不用再做设置。');
    $('btn-signin').textContent = t('sync_use_email', '或用邮箱登录');
    // local-note 已随 #532 退役（屏 1 只剩登录；那句「不登录也能完整使用」也不再成立）。
    $('app-use-pw').textContent = t('app_use_pw', '使用密码登录');
    $('app-pw-email-label').textContent = t('app_email_label', '邮箱');
    $('app-pw-label').textContent = t('app_pw_label', '密码');
    $('app-pw-login').textContent = t('app_verify', '登录');
    $('app-pw-back').textContent = t('app_pw_back', '改用验证码登录');
    $('signout').textContent = t('app_signout', '退出');
    $('gear').textContent = t('app_settings_link', '设置');
    // 账号键的可读名（VoiceOver：「账户与数据，按钮」）。圆键里是一个字母，靠它才有名字。
    $('acct').setAttribute('aria-label', t('opt_sec_account', '账户与数据'));
    // gear2（未登录首页的设置入口）随 #532 退役：屏 1 不许有设置入口。
    // 设置页的静态文字不再在这里重画：SettingsView（PR6b）的标签由 useT 驱动，
    // PageText.setUiLang 触发它自己的重渲染 —— 首页这层 paintStatic 只管自己的文字。
    $('review').textContent = t('app_review_start', '开始复习');
    $('review-back').textContent = t('app_review_back', '← 返回');
    $('sync').textContent = t('app_sync', '同步');
    $('today-label').textContent = t('app_today_due', '今天待复习');
    for (const id of ['modes-label', 'modes-label2']) { const e = $(id); if (e) e.textContent = t('app_modes_label', '听'); }
    AppDriving.paintStatic();
    paintAppEmptyState();
    // 引擎状态行跟着每一次重绘走（它是唯一的前置条件说明位，判据 J07/J08）。
    paintEngineStatus().catch(() => {});
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
    // 未登录的复习入口已退役（2026-10-01，#532）：App 以登录为前提。
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

  // 未登录也能复习（2026-09-27，Issue #386）。
  //
  // 卡片是本机数据，登录只影响**跨设备同步**（learning-design §7.2）—— 而此前 `#review`
  // paintSignedOutReview 已退役（2026-10-01，#532）：App 以登录为前提，未登录首页
  // 只留登录，所以「本机有卡就在未登录首页给个复习入口」这条 #386 的规矩作废。
  // 同一条判据在 test/app-firstrun.test.js 的 R1 与 test/growth-386.test.js 里各钉一次。

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
  // 本次会话里领取失败过没有（真机反馈 ① 的真因，2026-10-01）：删号之后旧会话还在，claim 会 401
  // ⇒ 一槽都没写 ⇒ 而状态行只会说「翻译引擎未配置」✗ —— 那句话把用户指向设置页，而那里救不了他。
  // 记住失败之后，状态行改说「额度没领到 / 已停用」并给一条**重领**的路（判据 J07：缺失项要有恢复路径）。
  let claimFailed = false;
  async function autoClaimOnce() {
    if (typeof LearnGrant === 'undefined' || !LearnGrant.enabled()) return;
    // 2026-09-30（§8.10.3，issue #513）：这里原来有一道守卫
    //   if (!EngineState.needsSetup(cur)) return;   // 「已经有引擎 —— 不碰」
    // 而 needsSetup 的判据是「apiKey 非空」——它是**引导门**的问题（该不该把用户送回引导），
    // 不是「这台设备有没有一个能用的引擎」。于是设备上留着一把残值 key（失效/被替换/手写错的）
    // 时，整条领取被跳过：不写额度、引擎坏着也不自愈，而登录即领取是它唯一的自愈路径。
    // 去掉的理由：`claimAndApply` 传的是 overwrite:false —— 它只写**空槽**，用户自己有效的
    // 配置一个字节都不会动（这是既有门禁，见 test/grant.test.js）。守卫是多余的，且它挡住的
    // 恰恰是坏配置的人。副作用是想要的：每次登录都会 claim 一次（服务端以 user_id 为主键、
    // 幂等），余额因此每次登录刷新 —— 「用尽后卡片显示旧余额」随之消失。
    // selfTest:false —— 登录那一刻弹一张三行自检卡会盖住引导；那一刻的回执就是引导下一屏
    // 「就地试一句」本身（真的翻一句，比三行「通了」更像证据）。
    try {
      await settingsModel.claimAndApply({ overwrite: false, selfTest: false });
      claimFailed = false;
    } catch (e) {
      claimFailed = true;          // 交给状态行去说人话；错误本身仍然由 autoClaimGrant 的 catch 吞掉
      throw e;
    }
  }
  const readObSettings = () => new Promise((r) => {
    try { chrome.storage.local.get(settingsModel.KEYS, (v) => r(v || {})); } catch (_) { r({}); }
  });

  // ── 首屏三段式（2026-10-01，#532）──────────────────────────────────────────
  // 判定是**纯函数**（`src/app/firstrun.js`）：四个输入 → step()。这一块只做两件事 ——
  // 把四个输入算出来、把该显示的那一屏显示出来。判据：test/app-firstrun.test.js（R1–R6）。
  let packAsrReady = false;
  let packTtsReady = false;
  let packAsrUnsupported = false;   // 该语种系统不支持识别 ⇒ 唯一允许的降级口
  let packsBusy = false;
  let firstRunScreen = '';   // '' | 'login' | 'packs' | 'onboarding' | 'home' —— 横幅要据此让位

  const readObSeen = () => new Promise((r) => {
    try { chrome.storage.local.get([OB_SEEN], (v) => r(!!(v && v[OB_SEEN]))); } catch (_) { r(false); }
  });

  // 包屏选的「我的语言 / 对方的语言」（2026-10-04）：与听译页**共用** listenMyLang /
  // listenOtherLang 两个键（同一件事只写一份）。缓存一份在这里，是因为 firstRunLocales 是**同步**的
  // （probePacks 与 paintFirstRun 都要用），而存储是异步的 —— paintFirstRun 每次刷它。
  let langPair = ['', ''];

  // 首次要下的语种：**用户选的那一对**优先；没选过才回落到 界面语言 + 目标语言。
  function firstRunLocales(s) {
    const picked = langPair.filter(Boolean).map((x) => String(x).split(/[-_]/)[0].toLowerCase());
    if (picked.length) return Array.from(new Set(picked));
    const ui = (() => { try { return (chrome.i18n.getUILanguage() || 'en').split('-')[0]; } catch (_) { return 'en'; } })();
    const target = ListenCore.toLocale((s && s.targetLang) || '') || '';
    return target && target !== ui ? [ui, target] : [ui];
  }

  function firstRunEngineOk(s) {
    // 引擎「可解析」＝**能用**，不是「apiKey 非空」——后者会把残值 key 的设备判成已配
    // （§8.10.3 / #513；`test/grant-one-implementation.test.js` 反向钉着「不许再拿
    // needsSetup 当引擎判据」）。两条路：① 登录后自动到账的额度在用；② 用户自己的
    // key 落在一个**真能解析出来**的引擎上（provider 认得出 + 有 key 或自定义地址）。
    try {
      if (typeof LearnGrant !== 'undefined' && LearnGrant.enabled() && LearnGrant.active(s)) return true;
    } catch (_) {}
    try {
      const entry = EngineState.resolve(s && s.provider);
      return !!(entry && (((s.apiKey || '').trim()) || ((s.baseUrl || '').trim())));
    } catch (_) { return false; }
  }

  // 探两个包。缺桥 / 探不通一律当「没就绪」，不去猜 —— 猜错会让硬门形同虚设。
  // 首屏三段式的两个设备包 = **设备引擎**那一套（`device` / 本地识别）。
  // 2026-10-01 裁定（用户）：「只要是 App 里用实时字幕/听译的都需要这个设备引擎」⇒ **必选**。
  // 所以探与下都**钉在设备引擎上**，不看当前默认选的是哪个引擎 —— 否则「登录即领额度」把 TTS
  // 引擎写成 `grant_speech` 之后，`deviceStatus(s.ttsEngine)` 会判 `not_device`、
  // `ensureDeviceReady` 以 skipped 返回（额度引擎本来就没有设备包要下），而硬门却仍要求设备包
  // ⇒ 屏 2 永远过不去（实测探针：`id="grant_speech" device=false reason=not_device`）。
  const DEVICE_TTS_ENGINE = 'device';

  // 引擎状态行（2026-10-01 设计稿 · 判据 J07/J08）：唯一的前置条件说明位。
  // 三样来源不同 ⇒ 判据分开写：翻译 = 引擎可解析（额度或自带 key）；朗读 = ttsEngine 有值；
  // 转写 = 设备内置（注册表那条已删 ⇒ 默认路，不需要配）。缺哪样就把哪样**原地**变成可点 chip。
  async function paintEngineStatus() {
    const txt = $('engine-status-text');
    const chip = $('engine-status-fix');
    if (!txt) return;
    let s = {};
    try { s = await readObSettings(); } catch (_) {}
    const engineOk = firstRunEngineOk(s);
    const ttsOk = !!(s && s.ttsEngine);
    const miss = !engineOk ? 'translate' : (!ttsOk ? 'tts' : '');
    if (!miss) {
      // 2026-10-03 用户裁定：配好之后首页**不出现这行** —— 「登录已配好…」是一句状态汇报，
      // 而配好的人打开就是要用功能。整行藏掉，只有缺东西时才露（下面那一支）。
      const row = $('engine-status');
      if (row) row.hidden = true;
      if (chip) chip.hidden = true;
      return;
    }
    const row = $('engine-status');
    if (row) row.hidden = false;
    txt.classList.add('miss');
    txt.textContent = t('engine_status_missing', '还差一样：');
    if (!chip) return;
    chip.hidden = false;
    // 翻译缺项有两种成因，界面必须分开说（真机反馈 ①）：
    //   · 领取失败（删号 / 额度停用 / 网络）⇒ 说「没领到」并给**重领**（点一下真的再领一次）；
    //   · 本来就没配 ⇒ 说「去设置里选一个」。
    if (miss === 'translate' && claimFailed) {
      chip.textContent = t('grant_err_revoked',
        '这份免费额度已经停用了（退出登录或删除账号会停用它）。重新登录同一个账号就会回来，余额不变。');
      chip.setAttribute('aria-label', t('grant_signin_again', '重新登录'));
      chip.onclick = async () => {
        _autoClaimed = null;                       // 清掉「本次会话只领一次」的记忆 ⇒ 允许重领
        try { await autoClaimGrant(); } catch (_) {}
        try { await paintEngineStatus(); } catch (_) {}
      };
      return;
    }
    chip.textContent = miss === 'tts'
      ? t('engine_status_fix_tts', '朗读引擎未配置，前往 设置 › 朗读 选择语音')
      : t('engine_status_fix_translate', '翻译引擎未配置，前往 设置 › 引擎 选一个');
    chip.setAttribute('aria-label', chip.textContent);
    chip.onclick = () => openSettings(miss === 'tts' ? 'tts-engine' : 'engine');
  }

  // 登录即就位：朗读那格钉到设备内置（2026-10-01 裁定）。用户选过就不动 —— 与额度领取
  // 「不碰用户自己的 key」同一条纪律。
  async function ensureDeviceTts() {
    const s = await readObSettings();
    if (s && s.ttsEngine) return;
    await new Promise((r) => { try { chrome.storage.local.set({ ttsEngine: 'device' }, r); } catch (_) { r(); } });
  }

  async function probePacks() {
    const s = await readObSettings();
    if (typeof LearnTTS !== 'undefined' && LearnTTS.deviceStatus) {
      try {
        LearnTTS.configure(Object.assign({}, LearnTTS.config, {
          engineId: DEVICE_TTS_ENGINE, apiKey: '', baseUrl: '', model: '', voice: '',
        }));
        const st = await LearnTTS.deviceStatus(DEVICE_TTS_ENGINE);
        packTtsReady = !!(st && st.ready);
      } catch (_) { packTtsReady = false; }
    } else { packTtsReady = false; }
    if (typeof NativeSpeech !== 'undefined' && NativeSpeech.probe) {
      try {
        const r = await NativeSpeech.probe(firstRunLocales(s));
        packAsrReady = !!(r && (r.ready === true || r.ok === true));
        // 这条判据跨了**三层**，词表各不同 —— 2026-10-03 就是在这里连错两次：
        //   桥（app/native/speech-bridge.swift）发 `stt-state {state:'unsupported', reason:'locale'|'os'}`
        //   → 包装器（app/native-speech.js）**吃掉 state**，规范化成 `{ok:false, reason, assets, locales}`
        //   → 这里能读到的只有 `{ok, reason}`。
        // 原来读的是 `r.reason === 'unsupported'`（桥不发）、我改成 `r.state === …`（包装器不给）
        // —— 两次都恒为 false，于是 firstrun.js 设计的**唯一降级**（识别器不支持这门语言 ⇒
        // 只下朗读包、其余照用）一次都没触发过：出不了屏 2。
        // 判据按 firstrun.js 的裁定收紧：只有「这个语种不支持」（reason='locale'）可降级；
        // OS 太旧（'os'）、缺桥（'no-bridge'）、还在探（'pending'）都不行。
        packAsrUnsupported = !!(r && r.ok === false && r.reason === 'locale');
      } catch (_) { packAsrReady = false; packAsrUnsupported = false; }
    } else { packAsrReady = false; packAsrUnsupported = false; }
  }

  function packsState(s) {
    return {
      loggedIn: !!s, engine: firstRunEngineOk(s),
      asrPack: packAsrReady, ttsPack: packTtsReady, onboardingSeen: false,
    };
  }

  async function paintFirstRun(session) {
    const sec = $('firstrun-packs');
    // 每一次判定都从「还没定」开始 —— show() 靠 `firstRunScreen !== 'packs'` 决定判完之后
    // 要不要露首页；留着上一次的 'packs' 会在这次判定失败（元素不在）时把首页一直藏着。
    firstRunScreen = '';
    if (!sec) return;
    // 屏 1（未登录）：这一屏只有登录 —— 横幅等一切都不许在场（#532 的 R1；
    // 2026-10-01 模拟器实测：全新安装时 Safari 横幅会把整屏占满，登录卡被挤到屏幕外）。
    if (!session) { sec.hidden = true; firstRunScreen = 'login'; return; }
    await probePacks();
    const seen = await readObSeen();
    const state = Object.assign(packsState(session), { onboardingSeen: seen });
    // 引擎不通（额度用尽且没有自带 key）时按 firstrun.step() 回到屏 1，不另造一屏。
    if (FirstRun.step(state) !== 'packs') { sec.hidden = true; firstRunScreen = 'home'; return; }
    firstRunScreen = 'packs';
    sec.hidden = false;
    $('signed-out').hidden = true;
    $('signed-in').hidden = true;
    $('packs-title').textContent = t('firstrun_packs_title', '先把两个语音包下好');
    $('packs-lede').textContent = t('firstrun_packs_lede', '下好这两样，之后你不用再做任何设置 —— 翻译、听译、字幕、朗读都能直接用。声音只在你的设备上处理。');
    $('pack-asr-name').textContent = t('firstrun_packs_asr', '识别语言包（听译 / 实时字幕）');
    $('pack-tts-name').textContent = t('firstrun_packs_tts', '高质量朗读包（朗读 / 播客）');
    const rowAsr = $('pack-row-asr'), rowTts = $('pack-row-tts');
    if (rowAsr) rowAsr.hidden = packAsrUnsupported;
    $('pack-asr-state').textContent = packAsrReady
      ? t('firstrun_packs_done', '已就绪')
      : t('listen_pack_missing', '识别语言包未下载 · {langs} · 由系统下载').replace('{langs}', firstRunLocales(await readObSettings()).join(' · '));
    // 朗读包那行：没有 langs/size 时别留孤零零的分隔点 —— 2026-10-01 模拟器实测读到
    // 「离线模型未下载 · · 」（两个空 replace 留下的尾巴）。
    $('pack-tts-state').textContent = packTtsReady
      ? t('firstrun_packs_done', '已就绪')
      : t('tts_pack_missing', '离线模型未下载 · {langs} · {size}')
        .replace('{langs}', '').replace('{size}', '')
        .replace(/(\s*·\s*)+$/, '')
        .replace(/·\s*·/g, '·');
    $('packs-net').textContent = t('firstrun_packs_net', '建议在 Wi-Fi 下下载；用蜂窝也行，你自己定。');
    // 语言对（2026-10-04 用户裁定）：这一页原来**没有**选择器，包按 界面语言+默认目标 硬下
    // （China 版上就看到写死的 zh）。现在与听译页共用同一对存储键、同一份选项
    // （listenModel.langOptions：注册表全量、含泰语；引擎不支持的灰显而不是拿掉）。
    // 用户没选过时，默认与「界面语言 + 目标语言」一致 —— 就是原来那一对，所以老用户行为不变。
    try {
      const pair = await new Promise((res) => chrome.storage.local.get(['listenMyLang', 'listenOtherLang'], (v) => res(v || {})));
      langPair = [String(pair.listenMyLang || ''), String(pair.listenOtherLang || '')];
      const defaults = firstRunLocales(s);
      const opts = (typeof AppListen !== 'undefined' && AppListen.langOptions) ? AppListen.langOptions(null) : [];
      const wire = (id, labelId, labelText, cur) => {
        const sel = $(id); if (!sel) return;
        $(labelId).textContent = labelText;
        sel.textContent = '';
        for (const o of opts) {
          const el = document.createElement('option');
          el.value = o.code; el.textContent = o.label; el.disabled = !!o.disabled;
          sel.appendChild(el);
        }
        sel.value = cur;
        sel.onchange = () => {
          const slot = id === 'packs-my-lang' ? 0 : 1;
          try { chrome.storage.local.set(slot === 0 ? { listenMyLang: sel.value } : { listenOtherLang: sel.value }); } catch (_) {}
          const next = [langPair[0], langPair[1]];
          next[slot] = sel.value;
          langPair = next;             // 下载（firstRunLocales）读的就是它，下一次「下载并继续」即生效
        };
      };
      // fallback 字面量必须留在 t() 调用点上（no-hardcoded-copy 门禁的判据，也是 translator 的取样点）。
      wire('packs-my-lang', 'packs-my-lang-label', t('listen_my_lang_label', '我的语言'), langPair[0] || defaults[0] || '');
      wire('packs-other-lang', 'packs-other-lang-label', t('listen_other_lang_label', '对方的语言'), langPair[1] || defaults[1] || '');
    } catch (_) {}    const go = $('packs-go');
    go.disabled = packsBusy;
    go.textContent = packsBusy
      ? t('firstrun_packs_busy', '正在下载…')
      : (packAsrUnsupported ? t('firstrun_packs_go_tts', '只下朗读包，继续') : t('firstrun_packs_go', '下载并继续'));
  }

  // 系统语音包（SFSpeechRecognizer 的资产）由 iOS 自己下，原生回一个 stt-assets 事件才算完。
  // **没有上限就会挂住**：2026-10-01 模拟器实测，按钮停在「正在下载…」15 分钟、无错误、
  // 容器里连 mt-speech 都没有。上限内没落地就按「没动静」交给重试 —— 不绕过硬门。
  const ASR_PACK_TIMEOUT_MS = 120000;

  // 下载 → 重新探 → 前进。失败留在这一屏并说明原因；唯一能绕过的是「该语种不支持识别」。
  async function runFirstRunPacks() {
    if (packsBusy) return;
    packsBusy = true;
    try { await paintFirstRun(currentSession); } catch (_) {}
    const err = $('packs-err');
    if (err) err.hidden = true;
    try {
      const s = await readObSettings();
      // 朗读包：与复习 ▶ / 播客 / 对话 / 设置试听**同一个**入口（learning-design §9.1.1）。
      // 引擎**钉在设备引擎上**（同 probePacks 的理由：这两个包是 App 的必备件，与当前默认
      // 选的是哪个引擎无关）。设置页与听译两处也是显式传引擎的。
      if (!packTtsReady && typeof LearnTTS !== 'undefined' && LearnTTS.ensureDeviceReady) {
        // 进度要画在**这一行**上（与设置页同一个做法）：包现在是硬门，而默认地址（global 走
        // GitHub）在国内可能先失败再换备用 —— 那几分钟不能只是一句「正在下载…」。
        const onProg = (m) => {
          const el = $('pack-tts-state');
          if (!el) return;
          if (m && m.state === 'switching') {
            el.textContent = t('tts_pack_fallback', '地址不可用，换一个重试…');
            return;
          }
          const pct = Math.round((Number(m && m.fraction) || 0) * 100);
          el.textContent = t('tts_pack_downloading', '正在下载离线模型 · {lang} · {pct}%')
            .replace('{lang}', (m && m.locale) || '').replace('{pct}', String(pct));
        };
        const r = await LearnTTS.ensureDeviceReady(onProg, DEVICE_TTS_ENGINE);
        // **返回值必须看**。设置页那条链一直是 `if (!r.ok) … '离线模型下载失败'`（settings-view），
        // 我这条以前把返回值丢了 ⇒「没下成」是**静默**的：容器里没有 mt-speech、屏上一句话也没有，
        // 然后还接着去走下一条（2026-10-01 实测就是这么把 15 分钟的挂住追出来的）。
        if (r && r.ok === false) {
          const why = String(r.why || r.reason || 'failed') + (r.attempts ? ' · ' + r.attempts : '');
          throw Object.assign(new Error(why), { mtTtsFailed: true, why });
        }
        // 下完就先让它显「已就绪」，别等两包都完 —— 这一屏的用途就是给人看进度。
        try { await paintFirstRun(currentSession); } catch (_) {}
      }
      if (!packAsrReady && !packAsrUnsupported && typeof NativeSpeech !== 'undefined' && NativeSpeech.ensureAssets) {
        let timer = null;
        let asrLast = '';
        const timeout = new Promise((_res, rej) => {
          timer = setTimeout(() => {
            const e = new Error('stt-timeout');
            e.mtSttTimeout = true;
            e.mtAsrLast = asrLast;
            rej(e);
          }, ASR_PACK_TIMEOUT_MS);
        });
        try {
          // 收原生每一条 assets-progress（含 probing 的 status/avail、downloading 的 bytes）——
          // 超时那行会显示最后一条，否则真机上只剩「没动静」，原因不可见（2026-10-02 实测）。
          await Promise.race([NativeSpeech.ensureAssets('stt', firstRunLocales(s), (m) => {
            if (!m) return;
            const pct = (typeof m.fraction === 'number') ? ' ' + Math.round(m.fraction * 100) + '%' : '';
            const extra = [];
            if (m.status) extra.push('status=' + m.status);
            if (typeof m.ready === 'boolean') extra.push('avail=' + m.ready);
            if (typeof m.supported === 'boolean') extra.push('supported=' + m.supported);
            if (typeof m.total === 'number') extra.push('bytes=' + (m.completed || 0) + '/' + m.total);
            asrLast = String(m.state || '') + pct + (extra.length ? ' · ' + extra.join(' ') : (m.reason ? ' · ' + m.reason : ''));
          }), timeout]);
        } finally { clearTimeout(timer); }
      }
    } catch (e) {
      if (err) {
        err.hidden = false;
        if (e && e.mtSttTimeout) {
          err.textContent = t('firstrun_packs_stt_slow', '系统语音包下载没动静 — 检查网络，再点一次。')
            + (e.mtAsrLast ? ' [' + e.mtAsrLast + ']' : '');
        } else if (e && e.mtTtsFailed) {
          err.textContent = t('tts_pack_failed', '离线模型下载失败：{why} —— 多半是网络问题，稍后重试').replace('{why}', LearnTTS.reason(String(e.why || ''), t));
        } else {
          err.textContent = t('firstrun_packs_err', '下载没成功：{why} —— 检查网络再点一次。')
            .replace('{why}', String((e && (e.reason || e.message)) || e));
        }
      }
    }
    packsBusy = false;
    await probePacks();
    const seen = await readObSeen();
    const state = Object.assign(packsState(currentSession), { onboardingSeen: seen });
    if (FirstRun.step(state) === 'packs' && !packAsrUnsupported) {
      await paintFirstRun(currentSession);   // 还缺 ⇒ 留在屏 2（按钮变「重试」）
      return;
    }
    // 就绪（或降级：识别不支持时只下朗读包）⇒ **直接落首页**（2026-10-03 用户裁定）：
    // 不再开引导屏 —— 那一屏只剩「开始设置 / 以后再设置」，而它下面什么都没有
    // （引擎随登录到账、两个包刚下完）。首页就是「对话 · 实时听译」那两张主角卡。
    const sec = $('firstrun-packs');
    if (sec) sec.hidden = true;
    // 老的 `onboardingSeen` 标记照旧落一次：老客户端读它、遥测的 step 枚举也留着。
    if (!seen) { try { await new Promise((r) => chrome.storage.local.set({ [OB_SEEN]: 1 }, r)); } catch (_) {} }
    // 默认意图「听」（2026-10-02 裁定 → 2026-10-03 跟着引导屏一起改到这儿）：引导屏撤了，
    // 那句 `trackIntent('listen')` 原本挂在它的「开始设置」上。现在落首页就记一次 ——
    // 首页的扩展横幅据此给「不要浏览器扩展」的人让路（interaction-spec「迎新页意图分叉」）。
    if (!obIntentRecorded) { obIntentRecorded = true; try { trackIntent('listen'); } catch (_) {} }
    $('signed-out').hidden = true;
    $('signed-in').hidden = false;
    firstRunScreen = 'home';
  }

  async function show(session) {
    currentSession = session;
    // Bind the corpus BEFORE anything reads it. Every path that changes who is
    // signed in arrives here — startup, both sign-in forms, sign-out — so this is
    // the one place where "which database" gets decided, and there is no second
    // place that could disagree.
    try { await LearnAuth.bindCorpus(session); }
    catch (_) { /* storage read failed — keep the corpus we are on rather than guess */ }
    // ── 揭屏推迟到首屏三段式判定**之后**（2026-10-02 真机：登录后先闪一下首页、1–2 秒后
    // 才跳到语音包页）。旧顺序是「先露出 #signed-in（首页）→ 再领取额度（一次网络往返）→
    // 再 paintFirstRun 判定」，于是揭屏发生在判定之前，首页当了那 1–2 秒的替身。
    //
    // 现在：**判定先行**（只探两个设备包 —— 原生往返，快），额度领取与它**并行**启动、
    // 稍后再 await。判定不看引擎（`firstrun.step` 只吃 loggedIn / 两个包 / seen），所以并行安全。
    if (!session) {
      $('signed-out').hidden = false;
      $('signed-in').hidden = true;
    } else {
      // 判定出结果前，两个内容面都不露 —— paintFirstRun 会露出对的那一个（首页 / 屏 2）。
      $('signed-out').hidden = true;
      $('signed-in').hidden = true;
    }
    // 领取额度：登录了就把免费额度装上，不再让人自己去点一次「领取」（2026-09-22 裁定，
    // learning-design §8.10.1）。读数：54 台登录并同步过的里 **47 台（87%）既没配引擎也没领
    // 额度** —— 我们让他们登了，却没顺手把额度给他们。挂在 show() 上而不是登录表单的回调里：
    // 这里是**所有**改变登录态的路径的唯一汇合点，所以带着旧会话启动的人也会被补上。
    // claim() 服务端以 user_id 为主键、第二次回传同一枚令牌，重复调用幂等（也顺带刷新余额）。
    // 三个闸：没登录不做 · 没有额度这条路不做（中国版 MT_GRANT 恒为 null）· 已经配好引擎的也做
    // （overwrite:false 只写空槽，不碰用户自己的 key）。
    //
    // **在判定之前启动、在状态行之前 await**（2026-10-02）：启动早于判定，冷启动那一帧里它
    // 一定跑得到；但等待晚于判定与揭屏，那次网络往返不再把揭屏拖住 1–2 秒（R2c / R2d）。
    const claimP = session ? autoClaimGrant().catch(() => { /* 领不到不挡首屏 */ }) : Promise.resolve();
    try { await paintFirstRun(session); } catch (_) {}
    // paintFirstRun 非 packs 时只判定、不揭屏；这里把首页露出来（屏 2 由它自己露）。
    if (session && firstRunScreen !== 'packs') { $('signed-in').hidden = false; }
    // 引擎状态行要**在领取（+ 补朗读）之后**重画一次（2026-10-02 真机反馈）：boot 的那次
    // paintStatic 跑在登录之前，那时存储里还没有额度令牌 / ttsEngine，而状态行只由
    // paintStatic 与「界面语言」切换重画 —— 不补这一句，登录成功后它会一直停在
    // 「翻译引擎未配置，前往 设置 › 引擎 选一个」。判据：test/home-engine.test.js。
    // 领取已并行启动，这里等它落地 —— 令牌晚一步落地，状态行就会读成「引擎不通」。
    await claimP;
    // 登录即把**朗读**引擎钉到设备内置（2026-10-01 裁定：登录完三样都该就位，这一屏直接能用）。
    // 三样的来源各不相同，所以只有这一格要写：
    //   · 翻译 —— 随额度到账（上面那次 claim）；
    //   · 转写 —— 本来就是**设备内置**（注册表里那条 2026-09-17 已删 ⇒ 系统识别器是默认路）；
    //   · 朗读 —— 空的，而屏 2 要下的离线模型正是它的（`ttsEngine='device'`）。
    // **不覆盖用户自己的选择**（选了别的引擎就不动）。
    if (session) { try { await ensureDeviceTts(); } catch (_) { /* 写不进去不挡首屏 */ } }
    if (session) { try { await paintEngineStatus(); } catch (_) {} }
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
      // 未登录也要跑一次 paintCounts —— 它算的两件事**都不是登录态的函数**：
      //   ① `browserSideOk`（「材料来源通没通」）：只在 paintCounts 里被赋值 ⇒ 未登录时恒为假，
      //      于是**本机明明有卡**（卡只可能是扩展写的）的人仍被告知「扩展还没启用」。
      //   ② 本机有几张卡 —— 未登录复习入口（#386，2026-09-27）的可见性判据就是它。
      //      它此前挂在只有已登录才跑的路径上，于是在**唯一该出现**的场景里永不出现。
      //      2026-09-27 真 Chrome 实测：total=1、未登录、`#signed-out-review` 仍是 hidden。
      await paintCounts();
    }
    if (session) {
      const dn = LearnAuth.displayName(session);
      $('who').textContent = dn;
      // 圆键里那一个字母（2026-10-02）：取邮箱/手机号的首个字母或数字；都没有就一个点，
      // 免得圆键看起来是坏掉的空框。它只是装饰，可读名来自 #acct 的 aria-label。
      $('acct-initials').textContent = ((dn.match(/[A-Za-z0-9]/) || ['·'])[0]).toUpperCase();
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
  // 迎新页的意图（2026-09-28，#486/#487）：'read' / 'listen' / 'both'。选 'listen' 的人
  // 首页不挂扩展横幅（他不要浏览器扩展）。同 extBannerDone，init 预读进内存。
  let onboardIntent = '';
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
    // iOS 形态（`canOpenPrefs` / `known` 都为假）拿不到扩展状态，所以**不再拿「有没有材料」当判据**
    // （2026-09-28，Issue #384 重定）：材料要「开启 + 允许网站 + 开采集 + 登录 + 同步」全走完才出现，
    // 用它会让「已经开好扩展、只是还没抓到卡」的人继续被告知「还没打开」（模拟器实测）。macOS 有真实
    // 状态（`getStateOfSafariExtension`），维持 `browserSideOk` 那一半。
    const ios = !!(state && !state.canOpenPrefs && !state.known);
    // 首屏让位（#532）：**不看 firstRunScreen，因为它可能还没被算出**（横幅由原生状态
    // 推送先画，早于 show()）。判据直接读事实：没登录 ⇒ 屏 1（只有登录）；
    // 已登录但屏 2 在场 ⇒ 资源包。2026-10-01 模拟器实测：不让位时这张横幅把首屏整屏占满。
    const firstRunActive = !currentSession || firstRunScreen === 'packs';
    if (away || (browserSideOk && !ios) || extBannerDone || onboardIntent === 'listen' || firstRunActive) { sec.hidden = true; collapseExtPanel(); syncReview(); paintSysBanner(); return; }
    // 引导进行中不挂横幅：引导第 3 屏本身就是这件事，两个一起显示会把同一句话
    // 一字不差地说两遍（2026-08-28 模拟器实测看到的，自动化断言看不出来 ——
    // 它只查内容对不对，不查有没有重复）。
    const onboarding = $('onboard') && !$('onboard').hidden;
    // 「继续设置」卡在场时也让路：它继续的那条引导最后一屏就是这件事（首页不挂两张「还差一步」）。
    // （取法写成局部变量：`$('ob-resume') && !$('ob-resume').hidden` 这种短路判空虽然安全，
    //  但 test/app-shell-dom.test.js 认不出「它在短路保护里」，会把退役 id 的直接取属性一律拦下。）
    const resumeCard = $('ob-resume');
    const resuming = !!resumeCard && !resumeCard.hidden;
    if (onboarding || resuming || !state || state.enabled === true) { sec.hidden = true; collapseExtPanel(); syncReview(); paintSysBanner(); return; }
    sec.hidden = false;
    syncReview();
    paintSysBanner();   // 扩展那张在场 ⇒ 这一张让位（AppSysBanner.decide 读的就是它）
    // iOS 形态（2026-09-10）：5 天遥测里 App 装机 72、Safari 扩展装机 25 —— 装了 App 的人
    // 大多没把扩展打开，而这里 iOS 唯一能用的动作曾是一个次级按钮。改成标题 + 三步
    // （与引导 ext 屏同一份文案与插图）+ 填色主按钮 + 「我已打开」。macOS 形态不变。
    $('ext-banner-title').textContent = ios
      ? t('app_ext_banner_title_ios', 'Safari 扩展还没打开')
      : (state.known ? t('app_ext_off_title', '扩展还没启用') : t('app_ext_unknown_title', '先把浏览器那半边打通'));
    const steps = $('ext-banner-steps');
    if (steps) {
      if (ios) obSteps(iosSteps(), steps); else { steps.hidden = true; steps.textContent = ''; }
    }
    const done = $('ext-banner-done');
    if (done) { done.hidden = !ios; done.textContent = t('app_ext_done', '我已打开'); }
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
    const host = (Registry.flavor() === 'china') ? 'belliedmonkey.com' : 'belliedmonkey.cc';
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
    // 首屏三段式（#532）：屏 1 / 屏 2 在场上时，这一张也**不许**在场 —— 三屏是独占的。
    // 2026-10-01 模拟器实测：屏 2 的截图上方挂着这张（iOS「翻译」App 那三步 +「我已设好」），
    // 与屏 2 的内容挤在同一页 —— R1b 那次只收掉了 Safari 扩展横幅，漏了这张同族的。
    const firstRun = firstRunScreen === 'login' || firstRunScreen === 'packs';
    const away = firstRun || !$('review-view').hidden || !$('app-drive').hidden || !$('app-listen').hidden
      || !$('app-docs').hidden || !$('app-settings').hidden;
    AppSysBanner.paint({
      away,
      onboarding: !!($('onboard') && !$('onboard').hidden),
      extBannerShown: !!(ext && !ext.hidden),
    }).catch(() => {});
  }

  function setExtState(next) { extState = next; paintExtBanner(extState); }

  // ViewController 在页面加载完时调它（Swift 调 window.show；window 名由
  // native-bridge.installBridgeGlobals 统一挂载，这里订阅 show 事件）。参数跟
  // 转换器模板一致，别改 —— 改了 Swift 侧就对不上。
  NativeBridge.onNative('show', function (platform, isEnabled, useSettingsDeepLink) {
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
  });

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
    .concat((Registry.backend() && Registry.backend().enabled) ? ['signin'] : [])
    // 'ext'（网页翻译配置引导）2026-10-02 撤出引导（#547）：它**只留在设置页**（#g-webext）。
    .concat(['firstuse']);
  let obAt = 0;
  // 引导**出现**的时刻（telemetry-design §3.9 的 dwell）。App 与扩展不一样：这里引导是
  // 首页里的一屏，有两条进场路（首次运行、从「继续设置」卡点进来），两条都要打点，
  // 否则从卡进来的那批人停留时长永远算成「从启动到现在」。
  let obShownAt = 0;
  // 这一次引导是否已经记过「离开」那一条。两条进场路都要清掉它 —— 跳过之后从
  // 「继续设置」卡回来是**新的一次**引导，它的结局要照样记一条。
  let obLeft = false;
  let obIntentRecorded = false;   // 默认意图只记一条（2026-10-03：原来挂在引导按钮上，每次点击一条）

  function obPaint() {
    if ($('ob-telemetry')) $('ob-telemetry').hidden = true;   // 只在最后一屏露出
    const step = OB[obAt];
    // 页面自报当前是哪一屏（同扩展 onboard.js 的做法）。门禁原来按「点了几次」数屏：
    // `for (i < 5) seen.push(...)` 再断言 seen.length === 5 —— 屏数变了它照样是 5，
    // 最后一屏被采两遍而已，**结构上就红不了**。2026-09-22 登录屏挪位之后正是这样漏掉了
    // 「登录屏点了只翻页、根本不登录」。自报之后门禁问的是「现在是哪一屏」。
    try { document.body.dataset.obStep = step; } catch (_) {}
    $('ob-fill').style.width = Math.round(((obAt + 1) / OB.length) * 100) + '%';
    for (const id of ['ob-steps', 'ob-kv', 'ob-prefs', 'ob-setup', 'ob-try', 'ob-alt', 'ob-xb-box', 'ob-hint']) $(id).hidden = true;
    // 主/次逐屏重设，不留状态（同扩展 onboard.js）。默认「继续」是这一屏的主行动；
    // 有自己主行动的屏（「就地试一句」）在下面把它降级 —— 两个填色按钮并排时，用户看不出该点哪个。
    $('ob-next').classList.remove('secondary');
    $('ob-skip').hidden = false;   // 只有登录屏藏它，别的屏要放回来
    $('ob-skip').textContent = t('ob_skip', '以后再设置');
    $('ob-next').hidden = false;   // 只有 'ext' 屏藏它，别的屏要放回来
    $('ob-next').textContent = obAt === OB.length - 1
      ? t('app_signin_open', '登录') : t('ob_next', '继续');

    if (step === 'welcome') {
      // 2026-10-02 用户裁定（#547）：这一屏**不再给选项** —— 模型 chips 与用途三分都撤了。
      // 默认就是「主要想听 · 即时字幕」，点「开始设置」按它走；网页翻译那条配置引导
      // **只在设置页**（settings-view 的 #g-webext）。
      //
      // 文案两个都用**既有键**（12 语种已经在位）：标题 = 那条默认路的名字，正文 =
      // 「配好之后不用再做设置」。正式的屏级文案等 OpenDesign 出稿再换 —— 本次设计门卡住
      // （三个 agent：限额 / 未登录 / 空手），按用户授权先落最小可用版，见 issue #547。
      $('ob-title').textContent = t('ob_intent_listen', '主要想听 · 即时字幕');
      $('ob-text').textContent = t('firstrun_packs_lede',
        '下好这两样，之后你不用再做任何设置 —— 翻译、听译、字幕、朗读都能直接用。声音只在你的设备上处理。');
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
      if (tn) { tn.hidden = !Registry.telemetryEnabled(); tn.textContent = t('telemetry_onboard', '会发送匿名用量数据（不含网页内容与地址），帮助改进；设置里可关。'); }
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

  // 第一屏那一行引擎名。**从注册表读，不写死牌子**（仓库根那份说明里的一注册表原则）——
  // 写死的后果是中国版会显示一堆境内用不了的名字，而门禁看不出来。
  // ⚠️ 这段注释会原样进中国版产物：别在这里写任何厂商名，`build/china-gate.js` 会红
  //（它的词表连文件名里的那个词都算）。
  // 两条过滤都是通用规则，不是牌子名单：
  //   · custom_* 与 grant 不是牌子（一个是「自己填地址」，一个是我们的免费额度）；
  //   · 后面那个标签若以前面某个开头就跳过 —— 同一家的第二条（如 MT 版）不重复占位。
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
  // 这一次引导「离开」的那一条读数。**每次引导至多一条**（§3 表的定义）：
  // 点过「我只要网页翻译」之后，ext 屏上的收尾不再重复记。
  function obTrackLeave(result) {
    if (obLeft) return;
    obLeft = true;
    try {
      if (typeof MTTelemetry !== 'undefined') {
        // dwell（§3.9 提案 A）：分桶的停留时长。算不出来就不带这个键 ——
        // 空串不在枚举里，带上去整条事件会被判掉。
        const d = MTTelemetry.dwell(obShownAt);
        MTTelemetry.track('onboarding_done', Object.assign({
          surface: 'app', result, step: OB[obAt],
        }, d ? { dwell: d } : {}));
      }
    } catch (_) {}
  }

  async function obFinish(result) {
    obTrackLeave(result === 'skipped' ? 'skipped' : 'done');
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
    await show(await LearnAuth.currentStable());
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
    const card = $('ob-resume');
    if (card) card.hidden = true;   // #532 之后这张卡不在 DOM 里（同 brew：别在退役元素上无条件访问）
    try {
      await new Promise((r) => chrome.storage.local.set({ [OB_SEEN]: 1 }, r));
      await new Promise((r) => chrome.storage.local.remove(OB_RESUME, r));
    } catch (_) {}
  }
  // 启动时调一次（每次启动至多计一次）。返回卡是否在场。
  async function paintObResume(session) {
    const card = $('ob-resume');
    if (!card) return false;   // 屏 1 改成「只有登录」后这张卡不再存在（#532）—— 不许在这里抛
    card.hidden = true;
    if (!obResume) return false;
    let needs = true;
    try { needs = EngineState.needsSetup(await readObSettings()); } catch (_) {}
    if ((Number(obResume.shows) || 0) >= OB_RESUME_MAX && !session && needs) obResumeTrack('expired');
    if (session || !needs || (Number(obResume.shows) || 0) >= OB_RESUME_MAX) { await obResumeRetire(); return false; }
    obResume = { step: obResume.step, shows: (Number(obResume.shows) || 0) + 1 };
    try { await new Promise((r) => chrome.storage.local.set({ [OB_RESUME]: obResume }, r)); } catch (_) {}
    const at = Math.max(0, OB.indexOf(obResume.step));
    // 卡内文字一律**从 card 往下找**：这些 id 已不在 App 页面源码里（#532 退役），
    // 用 `$('ob-resume-title')` 这种全局取法会让「元素没了」这件事永远看不见。
    const put = (sel, text) => { const e = card.querySelector(sel); if (e) e.textContent = text; };
    put('#ob-resume-title', t('ob_resume_title', '继续设置 · 还差 {n} 步').replace('{n}', String(OB.length - at)));
    put('#ob-resume-body', t('ob_resume_body', '从上次停下的那一屏接着来，一两分钟就好。'));
    put('#ob-resume-go', t('ob_resume_go', '从上次停下的地方继续'));
    const closeBtn = card.querySelector('#ob-resume-close');
    if (closeBtn) closeBtn.setAttribute('aria-label', t('ob_resume_close', '不再提示'));
    card.hidden = false;
    obResumeTrack('shown');
    paintExtBanner(extState);
    return true;
  }
  // 「继续设置」卡随 #532 退役（屏 1 只剩登录，卡不再有落脚处），但这段监听留在原处 ——
  // 于是 `$('ob-resume-go')` 为 **null** 时 `.addEventListener` 抛出，**整个壳的启动就此中断**：
  // 2026-10-01 实测，装机后是一屏奶油色空白（样式在、内容空），console 第一行就是
  // `Uncaught TypeError: Cannot read properties of null (reading 'addEventListener')`。
  // 教训与门禁：`test/app-shell-dom.test.js` 现在静态钉住「shell-model 引用的 id 必须在
  // AppShell.jsx 里存在」—— 这七个（ob-resume 一族 / gear2 / local-note）当时一个都没被拦住，
  // 因为套件跑在无 DOM 环境里，看不见「元素没了但代码还在引用」。
  // 2026-10-03：这一块**删了**。它 2026-10-01 就已成死代码（`#ob-resume-go` 随 #532 退役），
  // 只因为 `if` 守卫为假才没炸；而它是最后两处把 `#onboard` 打开的代码之一。引导屏撤掉
  //（2026-10-03 裁定）之后，留着它等于给「引导还会回来」留一条线。教训见上面那段注释。

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
      if (Registry.flavor() !== 'china') return false;
      const B = Registry.backend();
      if (!B || !B.enabled) return false;
      return /\.supabase\.co$/i.test(new URL(B.url).hostname);
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
    // 2026-10-03：welcome 那句 trackIntent('listen') 挪走了 —— 引导屏已撤，这条按钮不可达，
    // 留着会让「默认意图」在真跑与测试里各记一条（实测 n=2）。现在记在落首页那一刻。
    if (obAt < OB.length - 1) { obAt += 1; obPaint(); return; }
    // 最后一屏的主按钮直接进登录表单 —— 引导走到这儿，人是准备好的。
    // 引导收尾落到未登录首屏的说明卡上：一键登录在卡上，邮箱是卡上那行链接 ——
    // 不再直接摊开邮箱表单（那会让最费劲的路又排到最前面）。
    obFinish().then(() => { try { $('btn-apple').focus(); } catch (_) {} });
  });
  $('ob-skip').addEventListener('click', () => { obFinish('skipped'); });
  // 「我只要网页翻译 →」（画布板 B2 / telemetry-design §3.9 提案 B）。
  //
  // 两件事，顺序不能反：**先记，再把人送走**。记的是 result:'web_only' ——
  // 这一条与 done / skipped 并列，是「他自己说了要哪一半」，不是「他放弃了」。
  //
  // 送到哪儿：**最后那一屏（ext）**，那一屏讲的就是怎么把浏览器那半边打通
  // （macOS 直达 Safari 扩展设置，iOS 给三步 + 在网页上完成设置）。
  // 不直接退出引导：退出等于把他丢回一个还没配好的首页，而他要的东西就在那一屏上。
  //
  // obLeft：这一次引导**只记一条** onboarding_done（§3 表的定义是「离开时一条」）。
  // 点了这里之后，ext 屏上的收尾不再重复记 —— 否则同一个人会出现两行，
  // 「有多少人只要网页翻译」和「有多少人走完了」两个数同时变虚。
  // 意图分叉（2026-09-28，#486/#487，用户评审通过）：记一个粗粒度枚举 `onboard_intent{goal}`，
  // 并把选择落盘 —— 首页的扩展横幅据此给「听」的人让路（他不要浏览器扩展）。
  function trackIntent(goal) {
    onboardIntent = goal;
    try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('onboard_intent', { goal }); } catch (_) {}
    try { chrome.storage.local.set({ onboardIntent: goal }, () => {}); } catch (_) {}
    paintExtBanner(extState);
  }
  // 2026-10-02（#547）：这一屏不再给选项 ⇒ 默认就是「听」，在 ob-next 离开 welcome 时记。
  // 原来那三条 handler（我只要网页翻译 / 主要想听 / 都要）随之删掉；网页翻译的配置引导
  // 移到设置页（#g-webext / #webext-setup）。
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
  if (appleBridge && Registry.backend() && Registry.backend().enabled && (Registry.backend().providers || []).includes('apple')) {
    $('btn-apple-label').textContent = t('sync_with_apple', '用 Apple 登录');
    $('btn-apple').hidden = false;
    $('btn-apple').addEventListener('click', () => {
      $('btn-apple').disabled = true;
      say(t('app_apple_waiting', '正在打开 Apple 登录…'));
      try { window.webkit.messageHandlers.mtAppleSignIn.postMessage({}); } catch (err) {
        $('btn-apple').disabled = false;
        try { LearnAuth.noteAuthFail('apple', 'native', err); } catch (_) {}
        say(humanError(err), true);
      }
    });
  }

  // ── Google：系统鉴权会话（§8.4.1.2）────────────────────────────────────────
  //
  // Google 禁止在内嵌 WebView 里跑 OAuth，所以 App 里这条交给系统的
  // ASWebAuthenticationSession。**URL 在这一侧算**（PKCE 的 verifier 只能在这里），
  // 原生只负责把会话开起来、把 code 带回来 —— 与扩展那条路是同一套 auth.js 入口。
  if (appleBridge && Registry.backend() && Registry.backend().enabled && (Registry.backend().providers || []).includes('google')) {
    const scheme = (Registry.flavor() === 'china') ? 'belliedmonkeycn' : 'belliedmonkey';
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
      } catch (err) { g.disabled = false; try { LearnAuth.noteAuthFail('google', 'native', err); } catch (_) {} say(humanError(err), true); }
    });
  }

  // 系统鉴权会话回来的 code。与扩展那条路唯一的不同是票不经内容脚本 ——
  // 它直接从原生进到这一页，而这一页本来就持有 verifier。
  // 冷启动时结果可能先到：pending 槽由 install 回放、早到的调用由桥的
  // hold-and-replay 补发（native-bridge.js 头注释），这里不再自兜。
  NativeBridge.onNative('webauth-result', async (r) => {
    const g = $('btn-google'); if (g) g.disabled = false;
    if (!r || r.error) {
      if (r && r.error === 'canceled') { say(''); return; }
      try { LearnAuth.noteAuthFail('google', 'native', (r && r.error) ? String(r.error) : 'native_error'); } catch (_) {}
      say(t('app_apple_failed', '登录没能完成。可以改用下面的邮箱或手机号。'), true);
      return;
    }
    say(t('app_verifying', '正在登录…'));
    // 交换与「登录之后」分开埋（telemetry-design §3.14）：交换那条路 auth.js 自己记；
    // show()/doSync() 抛的错以前没有任何记录 —— 真机上「登录已完成却报连不上服务器」
    // 最可能就是它。
    let session = null;
    try {
      session = await LearnAuth.completeProviderSignIn({ code: r.code, state: r.state });
    } catch (err) {
      say(humanError(err), true);
      // 兑换失败会把 verifier 作废（它是一次性的），**必须重新备一份** ——
      // 不备的话，下一次点击拿到的是 pkce_missing，按钮直到刷新页面前都是死的。
      // 2026-09-03 用户实测「重试也没成功」就是这个：第一次 pkce_state，
      // 第二次开始永远 pkce_missing。
      LearnAuth.prepareProviderSignIn().catch(() => {});
      return;
    }
    try {
      await show(session);
      await doSync();
    } catch (err) {
      try { LearnAuth.noteAuthFail('google', 'post_login', err); } catch (_) {}
      say(humanError(err), true);
    }
  });

  // 原生那边把结果送回来。冷启动时结果可能先到（同 deeplink 的形状），兜法同上。
  NativeBridge.onNative('apple-result', async (r) => {
    $('btn-apple').disabled = false;
    if (!r || r.error) {
      // 用户自己取消不是错误，别画成失败 —— 那会让人以为登录坏了。
      if (r && r.error === 'canceled') { say(''); return; }
      // 原生那一步的失败要留档（telemetry-design §3.14）：它发生在 id_token 之前，
      // auth.js 看不到 —— 经同一个出口回 auth_fail，不另写白名单/归一化。
      try { LearnAuth.noteAuthFail('apple', 'native', (r && r.error) ? String(r.error) : 'native_error'); } catch (_) {}
      say(t('app_apple_failed', 'Apple 登录没能完成。可以改用下面的邮箱或手机号。'), true);
      return;
    }
    say(t('app_verifying', '正在登录…'));
    // 交换 / 「登录之后」分开埋（telemetry-design §3.14）：同 webauth-result 那条。
    let session = null;
    try {
      session = await LearnAuth.signInWithIdToken('apple', r.idToken, r.nonce);
    } catch (err) { say(humanError(err), true); return; }
    try {
      await show(session);
      // 与验证码那条路逐字相同：刚登录的人要的就是他的材料，让他再去找一个按钮，
      // 等于这个 App 承认自己不知道自己是干什么的。
      await doSync();
    } catch (err) {
      try { LearnAuth.noteAuthFail('apple', 'post_login', err); } catch (_) {}
      say(humanError(err), true);
    }
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
    let session = null;
    try {
      try {
        session = await LearnAuth.verify(pendingEmail, $('code').value);
        $('code').value = '';
      } catch (err) {
        say(humanError(err), true);   // 交换那条已由 auth.js 记过
        return;
      }
      try {
        await show(session);
        // Pull immediately. A user who just signed in is asking for their material —
        // making them find a second button to get it would be the app admitting it does
        // not know what it is for.
        await doSync();
      } catch (err) {
        try { LearnAuth.noteAuthFail('email', 'post_login', err); } catch (_) {}
        say(humanError(err), true);
      }
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
    let session = null;
    try {
      try {
        session = await LearnAuth.signInPassword($('app-pw-email').value, $('app-pw').value);
        $('app-pw').value = '';
      } catch (err) {
        say(humanError(err), true);   // 交换那条已由 auth.js 记过
        return;
      }
      try {
        await show(session);
        // Same as the OTP path: a user who just signed in is asking for their
        // material — pull immediately.
        await doSync();
      } catch (err) {
        try { LearnAuth.noteAuthFail('email', 'post_login', err); } catch (_) {}
        say(humanError(err), true);
      }
    } finally {
      $('app-pw-login').disabled = false;
      $('app-pw-login').textContent = t('app_verify', '登录');
    }
  });

  $('signout').addEventListener('click', async (e) => {
    // 菜单里的「退出」：先把菜单收起，再走登录态切换（视图会整屏换掉）。
    closeAcctMenu();
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
      if (!(await reconcileSession())) say(humanError(err), true);
    } finally {
      $('sync').disabled = false;
      $('sync').textContent = t('app_sync', '同步');
    }
  }

  $('sync').addEventListener('click', doSync);

  // 会话被服务端判死（auth.js token()：400/401 且带 GoTrue 错误体 ⇒ store(null)）之后，界面要跟着回到
  // 未登录的登录卡。原来没有这一步：会话已经清掉，首页却还挂着邮箱和「退出」，同步按钮只会说
  // 「学习库有归属，但现在没有登录」—— 登录入口藏在「退出」后面。2026-09-22 中国版切境内后端时每个
  // 已登录的老用户都会撞上一次（东京签的刷新令牌在境内必然被拒）；国际版里刷新令牌被作废时同样如此。
  async function reconcileSession() {
    if (!currentSession) return false;
    let s = null;
    try { s = await LearnAuth.current(); } catch (_) { return false; }   // 读不到 ≠ 已退出（§8.4.1）
    // 同一条 §8.4.1 的另一半：load() 读失败**不抛**，而是返回 null 并记 loadError —— 上面
    // 那个 catch 挡不住它。不加这道守卫，一次存储瞬断（#335：宿主 App 的 WKWebView 启动
    // 早期 localStorage 可能短暂读不出）会把还登着的人判成「登录已失效」画回登录卡。
    // 只有**确认读到空**（服务端判死已经 store(null)，load 已闩）才回登录卡；读失败 ⇒
    // 维持现状 —— 同步那行的错误文案自己会说话。
    if (!s && LearnAuth.lastLoadError()) return false;
    if (s) return false;
    await show(null);
    say(t('sync_err_signed_out', '登录已失效，请重新登录。'), true);
    return true;
  }

  // §8.8 修订版 — launch and return-to-foreground are ENTRIES, and every entry
  // FORCES a sync (interaction-spec「多设备同步一致性」: 每次进 App 即同步，绕过
  // 节流). Failures stay non-interruptive: the review header's status line carries
  // the state; the loud path stays on the button above. 进复习视图不再额外触发 ——
  // 启动/回前台已覆盖，且 inflight 会去重。
  async function quietSync(extra) {
    if (!currentSession) return;
    const r = await LearnSync.autoSync(Date.now(), Object.assign({ force: true }, extra || {}))
      .catch(() => null);
    if (await reconcileSession()) return;
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
  // 未登录首页的复习入口走的是同一条路（2026-09-27，Issue #386）：不在这里抄第二份视图切换，
  // 直接点那个真正的按钮 —— 同 AppSysBanner 的做法（见本文件下方 openReview 的桥）。
  // （未登录复习入口的监听随该入口一起退役，2026-10-01 #532）
  // 屏 2 的主按钮：下载 → 重探 → 前进；失败留在原地并说明原因（#532）。
  if ($('packs-go')) $('packs-go').addEventListener('click', () => { runFirstRunPacks(); });

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
      // 「从哪来、回哪去」（2026-09-27，Issue #386）：未登录也能进复习了，返回就不能无条件
      // 回到登录态首页 —— 那会把一个从没登录过的人丢进他从没见过的界面。
      if (currentSession) { $('signed-in').hidden = false; } else { $('signed-out').hidden = false; }
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
    // 旧 AppSettings.paint(session, say) 的时序位：现在走通知制 —— 视图订阅
    // onSettingsShown，这里等所有订阅者的重画 promise 收齐（「paint 之后再滚」不变）。
    await settingsModel.notifySettingsShown(currentSession);
    paintExtRestore();
    say('');
    if (!anchorId) return;
    const el = $(anchorId);
    if (!el) return;
    // 落点在「引擎与密钥」的某一档里 ⇒ 先切到那一档（2026-09-17 设置页信息架构：档位只管第一节，
    // 但那一节里的东西在另一档下是 hidden 的，滚过去只会落到一片看不见的东西上）。
    if (el.closest('.adv-only')) await settingsModel.requestDetail(true);
    else if (el.closest('.quick-only')) await settingsModel.requestDetail(false);
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
    // 在设置里配好引擎（或改回额度）再回首页时，状态行也该跟着变 —— 它只在
    // paintStatic / 语言切换时画，不补这一句就会停在进设置前的样子（同一类漏重画）。
    paintEngineStatus().catch(() => {});
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
  // 一次动作即视为问过（2026-09-28，Issue #384 重定）：点过主按钮后就不再出现「还没打开」横幅。
  // iOS 上 App 判不了扩展开没开，反复说「还没打开」只会打扰已经照做的人；要再确认走设置页的复位键。
  // 扩展引导行（2026-10-02 真机修订 J18/J19）：点行展开/收起二级面板（动作 + 三步）。
  // 首屏只看得到这一行；步骤不再占首屏。收起由行自己与 paintExtBanner（隐藏整段时）驱动。
  // 取元素写在函数里（不在模块初始化期绑 const）：paintExtBanner 会在别处提前调到
  // collapseExtPanel，懒查避免任何初始化顺序问题。
  function collapseExtPanel() {
    const panel = $('ext-banner-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    const row = $('ext-banner-row');
    if (row) row.setAttribute('aria-expanded', 'false');
  }
  $('ext-banner-row').addEventListener('click', () => {
    const panel = $('ext-banner-panel');
    panel.hidden = !panel.hidden;
    $('ext-banner-row').setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
  });
  $('ext-banner-setup').addEventListener('click', () => {
    extBannerTrack('setup');
    extBannerDone = true;
    try { chrome.storage.local.set({ [EXT_DONE]: Date.now() }, () => {}); } catch (_) {}
    openExternal(setupPageUrl());
    paintExtBanner(extState);
  });
  // 网页翻译配置引导（2026-10-02 #547）：从引导首屏搬到设置页 —— 这里开外链同样走原生桥。
  if ($('webext-setup')) $('webext-setup').addEventListener('click', () => openExternal(setupPageUrl()));
  $('ext-banner-done').addEventListener('click', () => {
    extBannerDone = true;
    extBannerTrack('done');
    try { chrome.storage.local.set({ [EXT_DONE]: Date.now() }, () => {}); } catch (_) {}
    paintExtBanner(extState);
  });
  $('ob-setup').addEventListener('click', () => {
    openExternal(setupPageUrl());
    // 这一屏没有「继续」，所以这个按钮同时是前进键 —— 否则点了它的人（也就是照做
    // 的人）会被卡在这一屏，后面三屏只能靠「以后再设置」整个跳过。
    // ext 现在是**最后一屏**（2026-09-22 重排），所以这个按钮兼作收尾键；
    // 它以前排在中间，那时它兼作前进键。两种情形都不能把照做的人卡在原地。
    if (OB[obAt] !== 'ext') return;
    if (obAt < OB.length - 1) { obAt += 1; obPaint(); } else obFinish();
  });
  // ── 顶栏账号键（2026-10-02 真机修订 J04）──────────────────────────────────
  // 点键开合菜单；点菜单外或按 Esc 收起；进设置/退出前先收起（动作自己会切视图）。
  // closeAcctMenu 用函数声明（会被提升），登录处理器在文件更靠前也要调它。
  const acctMenu = $('acct-menu');
  const acctBtn = $('acct');
  function closeAcctMenu() {
    if (!acctMenu || acctMenu.hidden) return;
    acctMenu.hidden = true;
    acctBtn.setAttribute('aria-expanded', 'false');
  }
  acctBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    acctMenu.hidden = !acctMenu.hidden;
    acctBtn.setAttribute('aria-expanded', acctMenu.hidden ? 'false' : 'true');
  });
  document.addEventListener('click', (e) => {
    if (!acctMenu.hidden && e.target !== acctBtn && !acctBtn.contains(e.target) && !acctMenu.contains(e.target)) {
      closeAcctMenu();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAcctMenu(); });
  $('gear').addEventListener('click', () => { closeAcctMenu(); openSettings(); });
  // gear2 的监听随该入口一并退役（#532）。注意这一行以前是**无条件**注册的：元素不在 DOM 里
  // 时会抛，且发生在初始化期（`$('ob-resume-go')` 之后第二处）。
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
    // 上面那一遍是按**系统**语言画的（存储还没读回来）。补这一次重画，否则首页
    // 永远不跟随「界面语言」—— 而设置页会跟随（它经 review.js 调过 setUiLang），
    // 于是同一个 App 里一半英文一半中文。非中文用户的第一屏就是这块。
    // （PR9：从 PageI18n 翻到 PageText —— React 视图靠 setUiLang 的通知重画，
    // paintStatic 这一遍命令式重涂照旧。）
    PageText.applyStoredUiLang(paintStatic);
    // 改语言当场生效的那一半。设置页是写入方，它只重画自己那一节（settings.js 的
    // paintStatic），而首页这一层的文字是这里画的 —— 走 onChanged 总线接，不在
    // 设置页里手写第二处显式重绘（2026-09-06 裁定）。setUiLang 的通知会把已迁的
    // React 视图整树重画；main.jsx 顶部的 PageI18n 耦合段已随 PR9 退役。
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (!ch || !ch.uiLang) return;
        PageText.setUiLang(ch.uiLang.newValue || 'auto');
        paintStatic();
      });
    } catch (_) {}

    // The app must honour the SAME shipping switch as the extension. `MT_BACKEND
    // .enabled === false` promises there is "no path to an account or to our server"
    // — and an app whose entire job is signing in and pulling is exactly such a path.
    // Gating only the extension's settings page would have left that promise true in
    // the place anyone checks and false in the place it mattered.
    if (!Registry.backend() || !Registry.backend().enabled) {
      $('signed-out').hidden = true;
      $('signed-in').hidden = true;
      say(t('app_sync_disabled', '同步尚未在这个版本中启用。浏览器扩展的采集与复习不受影响，全部存在本机。'));
      return;
    }

    // Before ensureDefaults / any paint: those read the corpus, and reading the
    // wrong one for a few hundred milliseconds is how a stale count gets shown and
    // believed.
    try { await LearnAuth.bindCorpus(); } catch (_) {}

    await settingsModel.ensureDefaults();
    await migrateSttDevice();
    AppDriving.wire();
    AppListen.wire({ openSettings });
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
    settingsModel.bind({
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
    // window.__mtDeepLinkPending，就绪之后调 window.__mtDeepLink。pending 的回放
    // 与早到调用的补发都在桥里（native-bridge.js）—— 这里只订阅 deeplink 事件。
    // （PR6a 迁移时把旧 app.js 的 pending 回放半边弄丢了，PR9 随桥收编补回。）
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
    NativeBridge.onNative('deeplink', (raw) => { const d = parseDeepLink(raw); if (d) applyDeepLink(d); });

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
      const session = await LearnAuth.currentStable();
      // 横幅的 UI 状态键预读进内存（paintExtBanner 是同步的）。读失败按「没点过」。
      try {
        const o = await new Promise((r) => chrome.storage.local.get([EXT_DONE, 'tm:extBannerDay', 'onboardIntent'], r));
        extBannerDone = !!(o && o[EXT_DONE]);
        extBannerShownDay = (o && o['tm:extBannerDay']) || '';
        onboardIntent = (o && o.onboardIntent) || '';
      } catch (_) {}
      // 首次运行且未登录 ⇒ 走引导。已登录的人显然已经过了这一关，别再挡他。
      // 首屏三段式（#532）：全新安装的第一屏是**屏 1（登录）**，不再是引导 ——
      // 引导要等「登录 + 两个设备包就绪」之后（`firstrun.step()` 说 'onboarding' 才进）。
      // 这里只做预读；显隐交给下面的 show() → paintFirstRun()。
      const obState = await new Promise((r) => chrome.storage.local.get([OB_SEEN, OB_RESUME], r)).catch(() => null);
      const seen = !obState || !!obState[OB_SEEN];
      obResume = (!seen && obState && obState[OB_RESUME] && typeof obState[OB_RESUME] === 'object') ? obState[OB_RESUME] : null;
      void seen;
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
}
