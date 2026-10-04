// src/app/AppShell.jsx — <main id="app"> 的十个 section（PR6a，React 迁移）。
//
// 这是**静态 JSX**：零 props、零 state —— React 在这里只当一次性的 DOM 模板引擎，
// 首帧渲染后不再碰这棵树。唯一的例外是 <SettingsView />（PR6b）：它自带状态、
// 自管重渲染。其余 section 对渲染结果做 textContent / hidden / classList 涂写的
// 命令式孤岛（painters 与 PR6c-d 要迁的各视图模块）永远存活 —— 与它们此前对
// 静态 HTML 涂写完全一样。
//
// 文本叶子的三种处置，与今天 index.html 的门禁逐一对应：
//   · 由 JS 涂写的叶子（app-html-i18n 门用 setsText 钉着的）留**空** —— painters
//     照旧涂，一个字都不变；
//   · 原 data-i18n 的五个静态中文叶子（dl-mismatch 三处、快速/详细两个 tab）改写
//     为 {t(key, 中文)}：今天它们靠 review.js 自举时的 applyI18n(document) 涂，
//     而 React mount 晚于那次涂写 —— 由这里以**同一语义**接管（同一个 PageI18n
//     规则、mount 时点同样是模块 auto → 系统语言，fallback 就是原标记里的中文）。
//     mount 后随 boot 的 applyStoredUiLang/paintStatic 重涂照旧发生；
//   · 语言 endonym 选项照抄（简体中文 / 繁體中文 / 日本語 / 한국語 在 VERBATIM
//     豁免清单里）—— 语言自己的名字不是文案。
// `● 实时` 徽标 PR6c 前同样留空：app/listen.js:1227 涂它（t('listen_live_badge', …)）；
// PR6c 起整段由 listen-view.jsx 接管，见该文件头注释。
//
// 不迁出 index.html 的两块（都在 </main> 之后或被移出，见本 PR 的 index.html diff）：
//   · #review-view —— 构建时从 extension/learn/review.html 注入 `<!--REVIEW-->`
//     槽，机制零改；
//   · <template id="app-art-1/2/3"> —— React 渲染 <template> 的子元素会落在
//     template **元素本体**而不是 content fragment（HTML 解析器才走 content），
//     obSteps() 的 tpl.content.cloneNode(true) 会拿到空。留在静态 HTML 里。
//
// id 全部保留；初始 hidden 与原标记一致；`app-listen-autospeak` /
// `app-listen-autospeak-label` 与设置页 g-listen 里那对**重复 id** 是现有 DOM
// 事实（getElementById 取第一份）—— PR6c 后 listen 页那份由 listen-view.jsx 渲染，
// 重复依旧存在（设置页 g-listen 仍在），getElementById 仍取 DOM 序第一份。
// SVG 属性走 React 的 camelCase（strokeWidth 等，输出仍是 stroke-width）。

import PageText from '../lib/i18n.js';
import SettingsView from './settings-view.jsx';
import { ListenView, ListenEntryButtons, ListenEntryPrivacy, ListenEntryNeeds } from './listen-view.jsx';
import DocsView from './docs-view.jsx';
import DrivingView from './driving-view.jsx';

// mount 时点的 t：模块 uiLang 尚为 auto → 系统语言 —— 与今天 review.js
// applyI18n(document) 跑在同一时点、同一模块态，首屏语义不变。
const t = PageText.t;

function AppShell() {
  return (
    <>
      {/* 浏览器那半边没打通时的横幅。卡片只能从 Safari 扩展经同步进来，所以这条
           横跨登录与未登录两种状态 —— 它说的不是「你没登录」，是「材料的来源还没开」。
           状态由 ViewController 在 didFinish 里调 show() 灌进来（macOS 查得到，
           iOS 查不到 —— getStateOfSafariExtension 是 macOS-only）。 */}
      {/* 跨面账号不一致的拦截（learning-design §8.4.1.1）。
           扩展打开 belliedmonkey://review?uid=… 把人送过来，两边 userId 不同时出现。
           **不自动切换账号** —— §8.4.3 的归属闸说过，切账号会把一份语料推进另一个
           账号的云端。这里只给事实和两个动作，选择权在人手上。 */}
      <section id="dl-mismatch" hidden>
        <p id="dl-mismatch-title">{t('app_dl_mismatch_title', '两边不是同一个账号')}</p>
        <p id="dl-mismatch-body" className="note"></p>
        <button id="dl-mismatch-switch" type="button">{t('app_dl_switch', '退出，换成扩展那个账号')}</button>
        <button id="dl-mismatch-keep" type="button" className="secondary">{t('app_dl_keep', '保持当前账号')}</button>
      </section>

      {/* 系统翻译的发现横幅（画布第 7 页 Discover）。形状与 #ext-banner 逐样对齐，
           连「iOS 上 App 判不了，由用户告诉我们」那条纪律也是从它继承的。
           **没有「打开设置」按钮**：openSettingsURLString 只会打开我们自己 App 的设置页，
           而能直达「设置 › App › 翻译」的 prefs:root= 是私有接口 —— 见 app/sys-banner.js。
           排在 #ext-banner 之后：首页不能同时挂两张「还差一步」，扩展那张先。 */}
      <section id="systrans-banner" hidden>
        <p id="systrans-banner-title"></p>
        <p id="systrans-banner-body" className="note"></p>
        <ol id="systrans-banner-steps" className="ob-steps" hidden></ol>
        <button id="systrans-banner-done" type="button" className="secondary" hidden></button>
        <button id="systrans-banner-go" type="button" className="secondary" hidden></button>
      </section>
      {/* Signed out. This is the only screen a new user sees, so it has to say what
           signing in is FOR — the app is empty without it (learning-design §7.2), and
           an empty deck with no explanation reads as a broken app. */}
      <section id="signed-out" hidden>
        {/* 品牌行由 paintStatic 涂（app-action-title 键）—— 原标记里的中文只在那里出现。 */}
        <h1 id="app-brand"></h1>
        <p className="lede" id="lede"></p>
        {/* 屏 1 只留登录（2026-10-01，#532）。这里原先有四样东西，全部删除：
            「继续设置」卡（ob-resume）、未登录也能进设置的 gear2、「未登录也能复习」块（#386）、
            以及下面那段「不登录也能完整使用」的 local-note —— 未登录的人在这屏上看到的每一件
            都用不了，而它们把「先登录」这件事埋掉了。判据见 test/app-firstrun.test.js（R1/R6）。 */}

        {/* A3：首屏不再是登录墙。不登录也进得来 —— 能读懂这是什么、能看见
             #ext-banner 说的「浏览器那半边还没打通」、能自己去把设置做完。
             但**不假装登录是可选的**：App 结构上不采集，材料只能经同步进来
             （learning-design §7.2 / §9.2），所以要在这台设备上复习就必须登录。
             登录表单按需展开，而不是挡在门口。 */}
        {/* 2026-09-05 重设计（design/signin/）：一键登录直接在这张卡上，不再藏在
             「登录」按钮后面；邮箱是备选，折叠成一行链接。
             原生 Sign in with Apple（§8.4.1.2）与 Google（系统鉴权会话）由 app.js 在
             原生桥存在时才显示 —— 不存在时显示它等于给一个点了没反应的按钮。
             Apple 按钮按 HIG：黑底白字带标（暗色下反转）。 */}
        <div id="signin-prompt">
          <p id="signin-why"></p>
          {/* 出境单独同意（PIPL 第 39 条 / 《促进和规范数据跨境流动规定》第 10 条，2026-09-22）：
               中国版的账号与卡片存在东京。登录就是出境的那一刻，所以同意放在登录按钮**之前**、
               默认不勾、不勾就登录不了。只在「后端确实在境外」时出现（判据按值，见 app.js xbNeeded）。 */}
          <div className="xb-consent" id="xb-box" hidden>
            <label><input type="checkbox" id="xb-check" /><span className="xb-text"></span></label>
            <a className="xb-link" href="#"></a>
            <p className="xb-err" hidden></p>
          </div>
          <button id="btn-apple" type="button" className="provider apple" hidden><svg className="provider-mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg><span id="btn-apple-label"></span></button>
          <button id="btn-google" type="button" className="provider google" hidden><svg className="provider-mark" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg><span id="btn-google-label"></span></button>
          <button id="btn-signin" type="button" className="link"></button>

          {/* 邮箱表单在同一张卡里（design/signin/）：展开时接在链接的位置，验证码那一步
               把卡上的其它东西换掉（.code-step），不往下堆。 */}
          <div id="signin-forms" hidden>
            <form id="email-form">
              <label htmlFor="email" id="email-label"></label>
              <input id="email" type="text" inputMode="email" autoComplete="username"
                autoCapitalize="none" autoCorrect="off" spellCheck="false" required />
              <button id="send" type="submit" className="secondary"></button>
            </form>

            <form id="code-form" hidden>
              <label htmlFor="code" id="code-label"></label>
              <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code"
                autoCapitalize="none" autoCorrect="off" spellCheck="false" required />
              <button id="verify" type="submit"></button>
              <div className="link-row">
                <button id="resend" type="button" className="link"></button>
                <button id="back" type="button" className="link"></button>
              </div>
            </form>

            {/* 密码登录（§8.4.1 第二种 grant，2026-08-17）：验证码仍是默认路径；密码
                 面向已在服务端设置过密码的账号（如审核演示账号）。 */}
            <form id="app-pw-form" hidden>
              <label htmlFor="app-pw-email" id="app-pw-email-label"></label>
              <input id="app-pw-email" type="email" inputMode="email" autoComplete="email"
                autoCapitalize="none" autoCorrect="off" spellCheck="false" required />
              <label htmlFor="app-pw" id="app-pw-label"></label>
              <input id="app-pw" type="password" autoComplete="current-password"
                autoCapitalize="none" autoCorrect="off" spellCheck="false" required />
              <button id="app-pw-login" type="submit"></button>
              <button id="app-pw-back" type="button" className="link"></button>
            </form>
            {/* 默认隐藏：只有 plus-alias（演示账号）才会被 refreshPwEntry 揭出来。
                 **必须写在标记里**，不能只靠 show() 去设 —— 首次运行走引导那条路
                 根本不会调用 show()，那时它就会一直露着。 */}
            <button id="app-use-pw" type="button" className="link" hidden></button>
          </div>
        </div>
      </section>

      {/* 屏 2 · 资源包（2026-10-01，#532）。
           硬门：**识别语言包** + **高质量朗读包** 下完才放行 —— 这一屏**不许有跳过按钮**
           （判据 test/app-firstrun.test.js 的 R2）。唯一允许的降级：该语种系统不支持识别
           ⇒ 只下朗读包（firstrun.js 的 degradeAllowed('asrUnsupported')），其余一律只能重试。
           文案尽量复用设置页那两行已有的键（同一件事只写一份）。 */}
      <section id="firstrun-packs" hidden>
        <h1 id="packs-title"></h1>
        <p className="lede" id="packs-lede"></p>
        {/* 「我的语言 / 对方的语言」（2026-10-04 用户裁定）：这一页原来**没有**选择器，包按界面语言+默认
            目标硬下（China 版上就看到写死的 zh）。两个选择器与听译页共用同一对存储键
            （listenMyLang / listenOtherLang）——「同一件事只写一份」；选项由 listenModel.langOptions
            给出（**注册表全量**、含泰语 —— 用户 2026-10-04：「两个下拉都应该是我们支持的所有语言的列表」）。
            布局按 Pencil 稿 `稿 · 下载页 · 自选语言对 2026-10-04`：两个**全宽**选择器块、标签在上、
            选择器在下、纵向排开（原来是行内 label+select 挤成一行、紧贴下面的包列表）。 */}
        <div className="packs-langs" id="packs-langs">
          <label className="packs-lang">
            <span className="packs-lang-label" id="packs-my-lang-label"></span>
            <select id="packs-my-lang"></select>
          </label>
          <label className="packs-lang">
            <span className="packs-lang-label" id="packs-other-lang-label"></span>
            <select id="packs-other-lang"></select>
          </label>
        </div>
        <div className="pack-list">
          <div className="pack-row" id="pack-row-asr">
            <div className="pack-name" id="pack-asr-name"></div>
            <p className="note" id="pack-asr-state"></p>
            <progress id="pack-asr-bar" hidden></progress>
          </div>
          <div className="pack-row" id="pack-row-tts">
            <div className="pack-name" id="pack-tts-name"></div>
            <p className="note" id="pack-tts-state"></p>
            <progress id="pack-tts-bar" hidden></progress>
          </div>
        </div>
        <p className="note" id="packs-net"></p>
        <p className="note" id="packs-err" hidden></p>
        <button id="packs-go" type="button"></button>
      </section>


      {/* 首次运行引导（§引导）。
           设计稿里是九屏，这里只落四到五屏 —— 另外几屏 App 做不到：配翻译引擎、
           打开采集、看第一张卡，全都发生在扩展那一侧，而 App 与扩展**不共享存储**
           （app/chrome-shim.js 把 chrome.storage 垫在 localStorage 上）。
           在 App 里画一个引擎选择器或采集开关，设了也是空转 —— 那比不给更糟。
           所以这几屏的职责是：讲清楚闭环、设能设的（learnRules 经同步生效）、
           把人送到 Safari，然后如实交代还要在浏览器里做什么。 */}
      <section id="onboard" hidden>
        <div id="ob-bar"><div id="ob-fill"></div></div>
        <div id="ob-body">
          <h2 id="ob-title"></h2>
          <p id="ob-text"></p>
          {/* 第一屏的引擎名（画布板 B2，2026-09-24）：**从注册表渲染**，
               不写死任何牌子 —— 一注册表原则。副作用是好的：两个 flavor 各自显示自己
               注册表里的那几家，一份文案都对。（注释本身也进中国版产物，所以这里
               一个厂商名都不许写：build/china-gate.js 会红。） */}
          {/* 引擎 chips 2026-10-02 摘掉（#547）：这一屏不再让用户挑模型 ——
               默认「主要想听 · 即时字幕」，引擎随登录自动到账（免费额度）。
               要换引擎去设置页。 */}
          <ol id="ob-steps" className="ob-steps" hidden></ol>
          <div id="ob-kv" hidden></div>
          {/* 「就地试一句」（2026-09-22，画布 #392 第 2 页）：素材内置，不让人自己找、自己粘；
               两个动作都在这个 App 里完成，不把人送去任何别处。 */}
          <div id="ob-try" hidden>
            <p id="ob-try-src"></p>
            <div className="ob-try-acts">
              <button id="ob-try-tr" type="button"></button>
              <button id="ob-try-say" type="button" className="secondary"></button>
            </div>
            <p id="ob-try-out" hidden></p>
          </div>
          {/* 同一条出境单独同意（见 #xb-box），引导登录屏上的那一份。两个框写同一个存储键。 */}
          <div className="xb-consent" id="ob-xb-box" hidden>
            <label><input type="checkbox" id="ob-xb-check" /><span className="xb-text"></span></label>
            <a className="xb-link" href="#"></a>
            <p className="xb-err" hidden></p>
          </div>
          <p className="note" id="ob-telemetry" hidden></p>
          {/* 2026-10-02 用户裁定（#547）：这一屏**不再问用途**。原来那条「我只要网页翻译」
               出口与 2026-09-28 的三分（我只要网页翻译 / 主要想听 · 即时字幕 / 读网页 + 听，都要）
               都删掉了 —— 默认就是「主要想听 · 即时字幕」，不需要用户选；网页翻译的配置引导
               **只留在设置页**（#g-webext）。理由与残留影响见
               docs/interaction-spec.md「迎新页意图分叉」。 */}
        </div>
        {/* 三个行动键在**页脚**，不在可滚的 ob-body 里。'ext' 屏藏掉 ob-next，
             #ob-setup 就是那一屏的前进键（docs/interaction-spec.md）——
             一个前进键放在会被内容顶下去的地方，就是没有前进键。 */}
        <div id="ob-foot">
          <button id="ob-prefs" type="button" hidden></button>
          {/* class 由 obPaint 按平台设：iOS 上它是这一屏**唯一**的行动、也是前进键
               （那一屏没有「继续」），必须是主按钮；macOS 上主行动是 #ob-prefs
               （直达 Safari 扩展设置），它退成次级。写死在这里就没法分。 */}
          <button id="ob-setup" type="button" hidden></button>
          <button id="ob-next" type="button"></button>
          {/* 主按钮下的一行「两步，约 30 秒」（画布板 B）：把「这要花多久」先答了。 */}
          <p className="note ob-hint" id="ob-hint" hidden></p>
          {/* 每屏自定的次要动作（现在只有登录屏用它：「先不登录」）。排在主按钮**下面**。 */}
          <button id="ob-alt" type="button" className="secondary" hidden></button>
          <button id="ob-skip" type="button" className="link"></button>
        </div>
      </section>

      {/* Signed in. Stage 2 is deliberately just the sync state: proving material
           reaches the app is the whole point of this stage, and a review UI on top of
           an unproven pull would hide exactly the failure worth seeing. */}
      <section id="signed-in" hidden>
        <header>
          <span className="topbar-brand" id="acct-brand"></span>
          {/* 账号行收进 44×44 圆键（2026-10-02 真机评审裁定，判据 J04）。
              以前「邮箱 + 设置 + 退出」占顶栏整行；账号是全局动作，不该占首屏版面 ——
              点这个键才展开菜单，邮箱与设置/退出都收进去。按钮本身是唯一的顶栏控件，
              命中区就是 44×44（够 J04 的下限）。菜单里的元素恒挂载，靠 hidden 显隐。 */}
          <button id="acct" type="button" className="acct" aria-haspopup="true" aria-expanded="false">
            <span id="acct-initials" aria-hidden="true"></span>
          </button>
          <div id="acct-menu" role="menu" hidden>
            <p id="who"></p>
            <button id="gear" type="button" className="link" role="menuitem"></button>
            <button id="signout" type="button" className="link" role="menuitem"></button>
          </div>
        </header>

        {/* 引擎状态行（2026-10-01 设计稿 · 判据 J07/J08）：唯一的前置条件说明位。
            就位时是一行低对比绿摘要；某一样真缺时**原地**变成可点 chip（待办必须前置，
            不再把它扔在页脚 —— 现状那句「还没配语音引擎」在 y≈1275）。 */}
        <div className="status" id="engine-status">
          <span className="status-text" id="engine-status-text"></span>
          <button className="status-chip" id="engine-status-fix" type="button" hidden></button>
        </div>

        {/* 两位主角（2026-10-01 设计稿）：实时字幕与实时听译 —— 这一页唯一「别处做不到」的能力，
            登录后即可用。它们由 listen-view.jsx 渲染（整行可点），CSS 把它们做成等高同权的主角卡。 */}
        <div className="heroes">
          <ListenEntryButtons />
        </div>

        {/* 复习条（降级：从整屏大卡到一条 76pt）—— 裁定「看得见、一眼能开始，但不抢戏」。 */}
        <section className="today">
          <div className="today-head"><span className="today-label" id="today-label"></span><span className="note" id="last"></span></div>
          <div id="app-counts" className="counts"></div>
          <div className="today-bar" aria-hidden="true"><span id="today-bar-learning"></span><span id="today-bar-due"></span></div>
          <div className="row">
            <button id="review" type="button"></button>
            <button id="sync" type="button" className="secondary"></button>
          </div>
        </section>

        {/* 文档翻译：独立分区（判据 J11 —— 实时音频入口与文档类入口不得同区）。 */}
        <div className="docs">
          <span className="modes-label" id="docs-label"></span>
          <button id="app-docs-entry" type="button" className="mode" hidden>
            <span className="mode-icon mode-icon-sage"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></svg></span>
            <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-docs-entry-hint"></span></span>
            <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>

        {/* 播客模式入口 + 门控原因行（原「听」分区剩下的部分）。 */}
        <div className="modes">
          <span className="modes-label" id="modes-label"></span>
          <div className="mode-list">
            <button id="app-drive-start" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-sage"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5z" /><path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5z" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-drive-desc"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
          <ListenEntryPrivacy />
          <p className="note" id="app-drive-need-tts" hidden>
            <span id="app-drive-need-tts-why"></span>
            <button id="app-drive-need-tts-go" type="button" className="link"></button>
          </p>
          <ListenEntryNeeds />
        </div>

        {/* 扩展引导行（J18/J19，2026-10-02 真机评审修订）：以前它是一张占满首屏的卡
            （三步教程 + 插图），把两位主角挤到屏幕外。现在降级为**折叠线以下的一行** ——
            首屏只看得见「Safari 扩展还没打开」这句事实，点开这一行才是动作与三步说明；
            首页本身不含步骤教学。卡片只能从 Safari 扩展经同步进来，所以这条说的是
            「材料的来源还没开」；状态由 ViewController 在 didFinish 里调 show() 灌进来
            （macOS 查得到，iOS 查不到 —— getStateOfSafariExtension 是 macOS-only）。 */}
        <section id="ext-banner" hidden>
          <button id="ext-banner-row" type="button" aria-expanded="false">
            <span className="row-text">
              <span id="ext-banner-title"></span>
              <span className="note" id="ext-banner-body"></span>
            </span>
            <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <div id="ext-banner-panel" hidden>
            {/* 官网的启用教程页是**唯一**能回答「扩展到底启用了没」的地方：它被扩展
                  注入后会自己亮绿灯（content-main.js 的 dataset.mtExtension）。iOS 上
                  App 自己查不到状态，所以正确的动作不是猜，是把人送到查得到的那一页。 */}
            <button id="ext-banner-act" type="button" hidden></button>
            {/* iOS 形态（2026-09-10）：三步与引导 ext 屏同一份文案与插图，但容器另建 ——
                 #ob-steps 那个节点被门禁钉着「恰好三个子元素」，不搬它。 */}
            <button id="ext-banner-setup" type="button" className="secondary"></button>
            <ol id="ext-banner-steps" className="ob-steps" hidden></ol>
            {/* 「我已打开」：iOS 上 App 判不了扩展启没启用，诚实的做法是由用户告诉我们。
                  用户裁定：只有点了它才收起（extBannerDoneAt）。 */}
            <button id="ext-banner-done" type="button" className="secondary" hidden></button>
          </div>
        </section>
      </section>

      {/* 播客模式（learning-design §9.5 / interaction-spec 「播客模式」）：App 专属
           免提听读会话。PR6d 起整段由 driving-view.jsx 渲染（含本注释所述全部）；
           首页入口行（#app-drive-start）仍在上面静态区，由 AppDriving.refreshEntry /
           paintStatic 命令式涂写（React 对「vdom 没变的属性」不写 DOM，两套写入不打架）。 */}
      <DrivingView />

      {/* 对话 · 实时听译（learning-design §9.6 / interaction-spec 同名一节）：App 专属。
           上卡 = 当下（逐词原文 + 临时译文），下面 = 整句定稿历史（可加星）；按住「我说」
           走 walkie-talkie；松手 → 翻面大字给对方看 + 朗读。视图切换归本模块（open/leave），
           与 #app-drive 的分工相同。 PR6c 起整段由 listen-view.jsx 渲染（含本注释所述全部）。 */}
      <ListenView />

      {/* 文档翻译（learning-design §9.7 / domain-design §2.5）：渲染器是 src/shared/doc-view.js
           （与扩展页同一份源，PR7c 起 ESM 单源），编排在 src/app/docs-model.js。文件选择是原生 <input type=file>：
           iOS 由 WKWebView 弹系统选择器；macOS 要宿主实现 runOpenPanel（D5），否则是死按钮。
           PR6d 起骨架由 docs-view.jsx 渲染（back/title 进 useT；#app-docs-root 是孤岛容器）。 */}
      <DocsView />

      <SettingsView />

    </>
  );
}

export default AppShell;
