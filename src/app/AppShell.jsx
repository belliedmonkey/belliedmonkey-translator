// src/app/AppShell.jsx — <main id="app"> 的十个 section（PR6a，React 迁移）。
//
// 这是**静态 JSX**：零 props、零 state、常量 vdom —— React 在这里只当一次性的
// DOM 模板引擎，首帧渲染后不再碰这棵树（没有任何 props/状态会让它重渲染）。
// 所以对渲染结果做 textContent / hidden / classList 涂写的命令式孤岛（painters
// 与 PR6b-d 要迁的各视图模块）永远存活 —— 与它们此前对静态 HTML 涂写完全一样。
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
// `● 实时` 徽标同样留空：app/listen.js:1227 涂它（t('listen_live_badge', …)）。
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
// 事实（getElementById 取第一份），不是本文件的笔误 —— PR6c 迁 listen.js 时收编。
// SVG 属性走 React 的 camelCase（strokeWidth 等，输出仍是 stroke-width）。

import PageText from '../lib/i18n.js';

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

      <section id="ext-banner" hidden>
        <p id="ext-banner-title"></p>
        <p id="ext-banner-body" className="note"></p>
        <button id="ext-banner-act" type="button" hidden></button>
        {/* 官网的启用教程页是**唯一**能回答「扩展到底启用了没」的地方：它被扩展
             注入后会自己亮绿灯（content-main.js 的 dataset.mtExtension）。iOS 上
             App 自己查不到状态，所以正确的动作不是猜，是把人送到查得到的那一页。 */}
        {/* iOS 形态（2026-09-10）：三步与引导 ext 屏同一份文案与插图，但容器另建 ——
             #ob-steps 那个节点被门禁钉着「恰好三个子元素」，不搬它。 */}
        <button id="ext-banner-setup" type="button" className="secondary"></button>
        {/* 三步放在主按钮**之后**：320×480 下三张插图会把按钮顶出首屏（引导 ext 屏
             靠 sticky 页脚解决，横幅在可滚动的首页里没有页脚），先给动作再给佐证。 */}
        <ol id="ext-banner-steps" className="ob-steps" hidden></ol>
        {/* 「我已打开」：iOS 上 App 判不了扩展启没启用，诚实的做法是由用户告诉我们。
             用户裁定：只有点了它才收起（extBannerDoneAt）。 */}
        <button id="ext-banner-done" type="button" className="secondary" hidden></button>
        <p id="ext-banner-check" className="note" hidden><a href="#" id="ext-banner-check-link"></a></p>
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
        {/* 「继续设置」卡（2026-09-22，画布 PTAr3ymseUw7s1sKvUX7Kf 第 1 页「以后再设置只记这一次」，用户点头）：
             点「以后再设置」只关这一次；下次打开、还没登录也没引擎时，回来的是这张卡，不是整条引导。
             ✕ = 永久收起；最多跟着 3 次启动。显隐由 app.js paintObResume() 决定。 */}
        <div id="ob-resume" hidden>
          <div className="ob-resume-head">
            <p id="ob-resume-title"></p>
            <button id="ob-resume-close" type="button" className="link">✕</button>
          </div>
          <p id="ob-resume-body" className="note"></p>
          <button id="ob-resume-go" type="button"></button>
        </div>
        {/* 未登录也要能进设置（2026-09-17）：此前这张首页通向设置的唯一路径是对话入口灰态下的「去设置里选择 →」，
             实时转写固定为设备内置后那个按钮常藏 —— 没登录的人就再也进不了设置页。 */}
        <p className="note" id="signed-out-actions"><button id="gear2" type="button" className="link"></button></p>

        {/* 未登录也能复习（2026-09-27，Issue #386）：卡片是**本机**数据，登录只影响跨设备同步
             （learning-design §7.2），所以本机有卡的人不该被登录墙挡在复习外面。
             只在真有卡时出现（src/app/shell-model.js 的 paintSignedOutReview），没有卡时不给一个
             必然空着的入口。次级按钮：这一屏的主行动仍是「把扩展 / 登录打通」，
             与「每屏至多一个填色按钮」那条家规一致（横幅在场时 #review 同样降次级）。 */}
        <div id="signed-out-review" hidden>
          <p className="note" id="signed-out-review-desc"></p>
          <button id="signed-out-review-btn" type="button" className="secondary"></button>
        </div>

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

        <p className="note" id="local-note"></p>
        {/* 对话 · 实时听译（§9.6）在未登录时也存在：它不依赖同步进来的牌库，语料写本机。
             与播客模式不同（那个要牌库，只在登录后的首页）。同一门控、同一条去设置的路。 */}
        <div className="modes">
          <span className="modes-label" id="modes-label2"></span>
          <div className="mode-list">
            <button id="app-listen-entry2" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-terra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /><path d="M9 21h6" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-listen-entry-hint2"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            {/* 实时字幕（learning-design §9.8）：原生不回 audio-caps（老壳）时整行不存在；门没过时灰掉 + 一句原因。 */}
            <button id="app-subs-entry2" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-terra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 13h4" /><path d="M13 13h4" /><path d="M8 21h8" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-subs-entry-hint2"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            {/* 文档翻译（§9.7 / D4）：不依赖账号，语料写本机；不设门，没配引擎时页内那一行会说去哪配。 */}
            <button id="app-docs-entry2" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-sage"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-docs-entry-hint2"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
          <p className="note" id="modes-privacy2"></p>
          <p className="note" id="app-listen-need-live2" hidden>
            <span id="app-listen-need-live-why2"></span>
            <button id="app-listen-need-live-go2" type="button" className="link"></button>
          </p>
          <p className="note" id="app-subs-need2" hidden>
            <span id="app-subs-need-why2"></span>
            <button id="app-subs-need-go2" type="button" className="link"></button>
          </p>
        </div>
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
          <div id="ob-engines" className="ob-chips" hidden></div>
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
          {/* 「我只要网页翻译 →」（画布板 B2，telemetry-design §3.9 提案 B）。
               它**首先是对用户有用的**：只想要网页翻译的人本来在这一屏只能二选一 ——
               走完一段与他无关的引导，或者点「以后再设置」然后自己去找。其次才是证据：
               点了记 result:'web_only'，于是「用户只想要网页翻译」这个假说第一次可证伪。
               放在 ob-body 末尾 ⇒ 渲染在页脚按钮**上方**，与画布一致。 */}
          <a id="ob-webonly" className="ob-exit" href="#" hidden>
            <span id="ob-webonly-text"></span><span className="ob-exit-arrow" aria-hidden="true">→</span>
          </a>
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
          <span id="who"></span>
          <span className="head-actions">
            <button id="gear" type="button" className="link"></button>
            <button id="signout" type="button" className="link"></button>
          </span>
        </header>

        {/* 今日一张卡（design: 大肚猴翻译 App 首页 · 主推）：待复习是唯一的大数字，其余四个
             计数缩成小字，开始复习是卡内唯一主按钮，同步收成小胶囊 + 上次同步时间。
             计数由 app.js 的 cell() 按语义类落格，CSS 按类而不是按位置排版。 */}
        <section className="today">
          <div className="today-head"><span className="today-label" id="today-label"></span><span className="note" id="last"></span></div>
          <div id="app-counts" className="counts"></div>
          <div className="today-bar" aria-hidden="true"><span id="today-bar-learning"></span><span id="today-bar-due"></span></div>
          <div className="row">
            <button id="review" type="button"></button>
            <button id="sync" type="button" className="secondary"></button>
          </div>
        </section>

        {/* 「听」：两个模式做成带图标与一句说明的列表行。门控不过时整行不存在
             （AppDriving.refreshEntry / AppListen.refreshEntry 切 hidden），两行都不在时整组
             隐藏（CSS :has）；门没过时留一条可见、有标签、直达设置页那个控件的路。 */}
        <div className="modes">
          <span className="modes-label" id="modes-label"></span>
          <div className="mode-list">
            <button id="app-drive-start" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-sage"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5z" /><path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5z" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-drive-desc"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            <button id="app-listen-entry" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-terra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /><path d="M9 21h6" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-listen-entry-hint"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            {/* 实时字幕（learning-design §9.8）：原生不回 audio-caps（老壳）时整行不存在；门没过时灰掉 + 一句原因。 */}
            <button id="app-subs-entry" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-terra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 13h4" /><path d="M13 13h4" /><path d="M8 21h8" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-subs-entry-hint"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            {/* 文档翻译（§9.7 / D4）：不依赖账号，语料写本机；不设门，没配引擎时页内那一行会说去哪配。 */}
            <button id="app-docs-entry" type="button" className="mode" hidden>
              <span className="mode-icon mode-icon-sage"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></svg></span>
              <span className="mode-text"><span className="mode-title"></span><span className="mode-desc" id="app-docs-entry-hint"></span></span>
              <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
          <p className="note" id="modes-privacy"></p>
          <p className="note" id="app-drive-need-tts" hidden>
            <span id="app-drive-need-tts-why"></span>
            <button id="app-drive-need-tts-go" type="button" className="link"></button>
          </p>
          <p className="note" id="app-listen-need-live" hidden>
            <span id="app-listen-need-live-why"></span>
            <button id="app-listen-need-live-go" type="button" className="link"></button>
          </p>
          <p className="note" id="app-subs-need" hidden>
            <span id="app-subs-need-why"></span>
            <button id="app-subs-need-go" type="button" className="link"></button>
          </p>
        </div>
      </section>

      {/* 播客模式（learning-design §9.5 / interaction-spec 「播客模式」）：App 专属
           免提听读会话。文本全程可见（音频优先，从不藏字）；超大按钮；语音问答环
           仅在 STT + 解析引擎 + uiLang 音色三门全开时存在。视图切换归 shell-model
           （同 #review-view 的分工），内部全归 app/driving.js。 */}
      <section id="app-drive" hidden>
        <button id="app-drive-back" type="button" className="link"></button>
        <h2 id="app-drive-title"></h2>
        <p className="note" id="app-drive-progress"></p>
        <div className="drive-card">
          <p id="app-drive-text"></p>
          <p id="app-drive-tr"></p>
          {/* 解析文本：耳朵优先，但从不藏起来 —— 停车时看得见刚才播的是什么。 */}
          <p className="note" id="app-drive-notes"></p>
        </div>
        <p className="note" id="app-drive-status" role="status" aria-live="polite"></p>
        <p className="note err" id="app-drive-note"></p>
        <div className="drive-grid">
          <button id="app-drive-pause" type="button" hidden></button>
          <button id="app-drive-next" type="button" hidden></button>
          <button id="app-drive-repeat" type="button" hidden></button>
          {/* 播放顺序：随机 / 顺序 / 循环 / 单曲循环，点一下轮换。它只改变**这张卡
               结束之后**发生什么，永不打断正在播的音频 —— 所以开车时按它是安全的。 */}
          <button id="app-drive-mode" type="button" hidden></button>
          {/* 「解析这句」：只在暂停时出现。解析 + 显示 + 朗读，读完回到暂停 ——
               暂停的语义是「我在控制」，读完一段解析不该顺势把整场恢复。 */}
          <button id="app-drive-explain" type="button" hidden></button>
        </div>
        <button id="app-drive-more" type="button" className="secondary" hidden></button>
        <p className="note" id="app-drive-cost"></p>
      </section>

      {/* 对话 · 实时听译（learning-design §9.6 / interaction-spec 同名一节）：App 专属。
           上卡 = 当下（逐词原文 + 临时译文），下面 = 整句定稿历史（可加星）；按住「我说」
           走 walkie-talkie；松手 → 翻面大字给对方看 + 朗读。视图切换归本模块（open/leave），
           与 #app-drive 的分工相同。 */}
      <section id="app-listen" hidden>
        <div className="listen-head">
          <button id="app-listen-back" className="link" type="button"></button>
          <h2 id="app-listen-title"></h2>
          <span id="app-listen-pill" className="listen-pill"></span>
        </div>
        <p className="note listen-langline"><span id="app-listen-lang"></span> <span id="app-listen-ephemeral-pill" className="listen-eph-pill" hidden></span></p>
        <p className="note listen-mac-note" id="app-listen-mac-note" hidden></p>
        <div className="drive-card listen-now" id="app-listen-now">
          <div className="listen-now-head"><span id="app-listen-now-label"></span><span id="app-listen-live" className="listen-live" hidden></span></div>
          <p id="app-listen-partial" className="listen-partial"></p>
          <p id="app-listen-partial-tr" className="listen-partial-tr"></p>
          {/* iPhone 实时字幕：画中画小窗预览的占位块（原生在同一矩形上叠预览，§9.8 协议补充决定（三）17） */}
          <div id="app-subs-pip" className="listen-subs-pip" hidden><p id="app-subs-pip-note" className="listen-subs-pip-note"></p></div>
          <button id="app-subs-float" type="button" className="link" hidden></button>
        </div>
        <div id="app-listen-history-wrap" className="drive-card listen-history-wrap">
          <div className="listen-now-head"><span id="app-listen-history-title"></span><span className="listen-head-acts"><button id="app-listen-copy" type="button" className="link" hidden></button><button id="app-listen-end" type="button" className="link" hidden></button></span></div>
          <div id="app-listen-history" className="listen-history"></div>
        </div>
        <p className="note" id="app-listen-queue" hidden></p>
        <p className="note err" id="app-listen-note"></p>
        {/* 只剩一个主按钮：不再有「按住 · 我说」，双方自由说话（2026-09-08）。 */}
        <div id="app-listen-actions">
          <button id="app-listen-toggle" type="button"></button>
        </div>
        {/* 实时字幕的隐私段（§10 Gate I）：说在「开始」按钮下面，只在字幕模式出现。 */}
        <p className="note" id="app-subs-privacy" hidden></p>
        {/* 语言对摊在外面而不是收进设置里（画布画板 6，2026-09-08 定 A 版）：语言对是这个
             模式唯一的必填配置，而它选错之后**不会报错** —— 每句都判成对方、译文语言不对，
             只会「看起来怪」。摊在外面等于让这个错误自己暴露。 */}
        <div className="listen-pair" id="app-listen-pair">
          <label className="note"><span id="app-listen-my-label"></span> <select id="app-listen-my"></select></label>
          <span className="listen-pair-arrow" aria-hidden="true">⇄</span>
          <label className="note"><span id="app-listen-other-label"></span> <select id="app-listen-other"></select></label>
        </div>
        <label className="check listen-autospeak" id="app-listen-autospeak-row">
          <input id="app-listen-autospeak" type="checkbox" />
          <span id="app-listen-autospeak-label"></span>
        </label>
        {/* 「这次不留记录」（裁定 6）：一场为单位，开始前决定、中途不可改，**不记进存储** ——
             记住上次的勾选反而危险，用户会以为在留记录而其实没有。 */}
        <label className="check listen-autospeak" id="app-listen-ephemeral-row">
          <input id="app-listen-ephemeral" type="checkbox" />
          <span id="app-listen-ephemeral-label"></span>
        </label>
        {/* 灰掉时屏上一定有原因（表 1 的家规）：会话进行中且没勾上，说清为什么改不了。 */}
        <p className="note" id="app-listen-ephemeral-why" hidden></p>
        {/* 实时字幕（§9.8）：「字幕进复习」开关（与设置页那个是同一份设置）+ 一句按平台的提示。 */}
        <div id="app-subs-prep" hidden>
          <label className="check listen-autospeak">
            <input id="app-subs-capture" type="checkbox" />
            <span id="app-subs-capture-label"></span>
          </label>
          <p className="note" id="app-subs-tip"></p>
        </div>
        <p className="note" id="app-listen-cost"></p>
        <p className="note" id="app-listen-device-privacy" hidden></p>

        <div id="app-listen-summary" className="drive-card" hidden>
          <h3 id="app-listen-summary-title"></h3>
          <p id="app-listen-summary-body"></p>
          <p className="note" id="app-listen-summary-note"></p>
          <div className="drive-grid">
            <button id="app-listen-summary-home" type="button"></button>
            <button id="app-listen-summary-again" type="button" className="secondary"></button>
          </div>
        </div>

        {/* 放大展示卡（给对方看）：点任一历史行打开，底下照常在听；「朗读」只在有 TTS 引擎时存在；
             点任意处关闭。不是一个 phase，是历史行上的叠层（画布「交互逻辑」表 1 showing）。 */}
        <div id="app-listen-flip" className="listen-flip" hidden>
          <p className="listen-flip-hint" id="app-listen-flip-hint"></p>
          <p className="listen-flip-text" id="app-listen-flip-text"></p>
          <p className="listen-flip-sub" id="app-listen-flip-sub"></p>
          <p className="listen-flip-speaking" id="app-listen-flip-speaking" hidden></p>
          <div className="drive-grid">
            <button id="app-listen-flip-again" type="button" className="secondary"></button>
            <button id="app-listen-flip-back" type="button"></button>
          </div>
        </div>
      </section>

      {/* 文档翻译（learning-design §9.7 / domain-design §2.5）：渲染器是 extension/learn/doc-view.js
           （与扩展页同一份字节），编排在 app/docs.js。文件选择是原生 <input type=file>：iOS 由 WKWebView
           弹系统选择器；macOS 要宿主实现 runOpenPanel（D5），否则是死按钮。 */}
      <section id="app-docs" hidden>
        <div className="docs-head">
          <button id="app-docs-back" className="link" type="button"></button>
          <h2 id="app-docs-title"></h2>
        </div>
        <div id="app-docs-root"></div>
        <input type="file" id="app-docs-file" accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" hidden />
      </section>

      <section id="app-settings" hidden>
        <button id="settings-back" type="button" className="link"></button>
        <h2 id="settings-title"></h2>

        {/* 2026-09-17 设置页信息架构（interaction-spec「设置页信息架构」，画布 design/settings-ia）：四节按用途 ——
             ① 引擎与密钥 ② 功能 ③ 账号与数据 ④ 关于。控件只搬不改 id；「快速 / 详细」只管第一节。
             与扩展设置页同一套类名契约（.adv-only / .quick-only）和同一条不变量：一键配置卡与逐引擎控件**永不同屏**。
             切换只切 hidden，**永不 remove()**：这一页按字面量读控件、零 null 保护。 */}
        <div className="sec" id="sec-engines">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">1</span><h3 id="sec-engines-title"></h3></div>
            <div className="mode-tabs" id="mode-tabs" role="tablist">
              <button id="mode-quick" type="button" role="tab">{t('opt_mode_quick', '快速')}</button>
              <button id="mode-detail" type="button" role="tab">{t('opt_mode_detail', '详细')}</button>
            </div>
          </div>

          {/* 一把 key 配好全部（QuickSetup）：与扩展设置页、扩展引导第 2 屏是**同一个组件**；它算出 patch 交给 host 写盘。 */}
          {/* 免费额度（§8.10）。与一键卡并排在同一个 tab 里（裁定 D2：登录不是墙）。MT_GRANT 为 null 时整块不出。 */}
          <section className="quick-only" id="grant-card" hidden>
            <div id="grant-box"></div>
          </section>

          <section className="quick-only" id="quick-setup-card">
            <h3 id="quick-setup-title"></h3>
            <div id="quick-setup"></div>
          </section>

          {/* 「从哪来」的那一行（画布第 7 页 SetupFrom）。系统翻译的弹层 / Mac 快译面板把人
               推过来配引擎时，先说清楚他为什么在这儿；配好之后同一行就地变成「你可以回去了」。 */}
          <p className="note" id="setup-from" hidden></p>

          {/* 「配好了」的回执（画布第 7 页 SetupDone）。四个落点一种回执：先摆出自检行，
               再逐行落成 ✓/✗，最后一句话 + 一个随「从哪来」变的下一步。
               **没通过就不说「可以用了」** —— 见 app/setup-done.js 的文件头。 */}
          <section id="setup-done" hidden>
            <h3 id="setup-done-title"></h3>
            <div id="setup-done-rows"></div>
            <p id="setup-done-note"></p>
            <div className="row" id="setup-done-act" hidden></div>
          </section>

          {/* 永不同屏，但路必须有：详细档顶上一行指回快速档 */}
          <p className="note adv-only" id="app-adv-hint"><button type="button" className="link" id="app-adv-hint-go"></button></p>

          {/* 详细档是三张槽卡：翻译与句子解析 / 整段转写 / 朗读。第一张**就是主翻译引擎**
               （notesProvider 优先于 provider，见 LearnNotes.resolveConfig）—— #421 方案 A 之前
               它自称「仅用于生成句子解析」，于是没人知道翻译该在哪儿配。 */}
          <div className="sgroup adv-only" id="g-notes">
            <h3 id="notes-title"></h3>
            <label className="field adv-only">
              <span id="notes-provider-label"></span>
              <select id="notes-provider"></select>
            </label>
            <label className="field adv-only" id="notes-key-field">
              <span id="notes-key-label"></span>
              <input id="notes-api-key" type="password" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only" id="notes-base-field">
              <span id="notes-base-label"></span>
              <input id="notes-base-url" type="url" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only" id="notes-model-field">
              <span id="notes-model-label"></span>
              <input id="notes-model" type="text" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only">
              <button id="btn-test-notes" type="button"></button>
            </label>
            <p className="note" id="test-notes-note"></p>
            <p className="note" id="notes-note"></p>
          </div>

          {/* 整段转写（learning-design §9.4）：「说」题的录音只发到这里配置的端点，识别后即弃；设备本地凭证（§7.2）。
               实时转写不在这里 —— 它固定为设备内置，不是引擎（2026-09-17）。 */}
          <div className="sgroup adv-only" id="g-stt">
            <h3 id="stt-title"></h3>
            <label className="field adv-only">
              <span id="stt-engine-label"></span>
              <select id="stt-engine"></select>
            </label>
            <label className="field adv-only" id="stt-key-field">
              <span id="stt-key-label"></span>
              <input id="stt-api-key" type="password" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only" id="stt-base-field">
              <span id="stt-base-label"></span>
              <input id="stt-base-url" type="url" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only" id="stt-model-field">
              <span id="stt-model-label"></span>
              <input id="stt-model" type="text" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only">
              <button id="btn-test-stt" type="button"></button>
            </label>
            <p className="note" id="test-stt-note"></p>
            <p className="note" id="stt-note"></p>
          </div>

          <div className="sgroup adv-only" id="g-tts">
            <h3 id="tts-title"></h3>
            <label className="field adv-only">
              <span id="tts-engine-label"></span>
              <select id="tts-engine"></select>
            </label>
            <label className="field adv-only" id="tts-key-field">
              <span id="tts-key-label"></span>
              <input id="tts-api-key" type="password" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only" id="tts-base-field">
              <span id="tts-base-label"></span>
              <input id="tts-base-url" type="url" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field adv-only" id="tts-model-field">
              <span id="tts-model-label"></span>
              <input id="tts-model" type="text" autoComplete="off" autoCapitalize="none"
                autoCorrect="off" spellCheck="false" />
            </label>
            <label className="field">
              <span id="tts-voice-label"></span>
              <select id="tts-voice"></select>
            </label>
            {/* 离线模型行（learning-design §9.1.1，2026-09-17）：只在选了「设备内置朗读」时出现。此前模型只在
                 对话开始那一步下载，设置里选了、试听了都静默回落系统语音 —— 用户「没感受到下载」。
                 五态：未下载 · 大小 · [下载] / 下载中 pct% / 已安装 / 下载失败 · [重试] / 试听回落具名（在试听结果行）。 */}
            <div className="field adv-only" id="tts-offline-row" hidden>
              <span id="tts-offline-label"></span>
              <p className="note" id="tts-offline-state" role="status" aria-live="polite"></p>
              <progress id="tts-offline-progress" max="100" value="0" hidden></progress>
              <button id="tts-offline-dl" type="button" className="secondary"></button>
            </div>
            <label className="field adv-only">
              <button id="btn-tts-test" type="button"></button>
            </label>
            <p className="note" id="test-tts-note"></p>
            <p className="note" id="tts-note"></p>
          </div>
        </div>

        <div className="sec" id="sec-features">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">2</span><h3 id="sec-features-title"></h3></div>
          </div>

          {/* 界面语言。与扩展设置页是同一个键（uiLang）、同一份选项；在 App 里它还是 driving.js 眼里用户的母语。 */}
          <label className="field">
            <span id="ui-lang-label"></span>
            <select id="ui-lang">
              <option value="auto" id="ui-lang-auto"></option>
              <option value="zh_CN">简体中文</option>
              <option value="zh_TW">繁體中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="hi">हिन्दी</option>
              <option value="ar">العربية</option>
              <option value="pt_BR">Português</option>
              <option value="ru">Русский</option>
            </select>
          </label>

          {/* 译成（2026-09-19）。存储键 targetLang；空 = 跟随界面语言（此前的实际行为）。选项对着
               build/target-langs.config.js 核（test/engine-fields.test.js）。它管文档翻译、播客补译文、
               系统翻译与快速翻译；不管对话 · 实时字幕（那里有自己的一对语言）。 */}
          <label className="field">
            <span id="target-lang-label"></span>
            <select id="target-lang">
              <option value="" id="target-lang-follow"></option>
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁體中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="ar">العربية</option>
              <option value="pt">Português</option>
              <option value="ru">Русский</option>
              <option value="it">Italiano</option>
            </select>
            <small id="target-lang-hint"></small>
          </label>

          {/* 复习：怎么听、每天多少张。语音模式 / 自动朗读 / 语速此前混在「语音」组里，与引擎字段同屏。 */}
          <div className="sgroup" id="g-review">
            <h3 id="app-review-title"></h3>
            <div className="dep" id="dep-review"></div>
            <label className="field" id="app-tts-section">
              <span id="tts-mode-label"></span>
              <select id="tts-mode">
                <option value="off" id="tts-mode-off"></option>
                <option value="assist" id="tts-mode-assist"></option>
                <option value="audio-first" id="tts-mode-audio-first"></option>
              </select>
            </label>
            <label className="check">
              <input id="tts-auto" type="checkbox" />
              <span id="tts-auto-label"></span>
            </label>
            <label className="field">
              <span id="tts-rate-label"></span>
              <input id="tts-rate" type="range" min="0.5" max="1.5" step="0.1" />
              <output id="tts-rate-out"></output>
            </label>
            <label className="field">
              <span id="daily-label"></span>
              <input id="daily" type="number" min="1" max="200" step="1" inputMode="numeric" />
            </label>
          </div>

          <div className="sgroup" id="g-capture">
            {/* 来源治理（interaction-spec）：规则随账号同步（§8.9），在手机上改是
                 自然场景。App 自身不采集 —— 这里改的是浏览器扩展那头的采集行为。 */}
            <h3 id="app-langs-title"></h3>
            <div id="app-langs"></div>
            <p className="note" id="app-langs-note"></p>

            <h3 id="app-sources-title"></h3>
            <div id="app-sources"></div>
          </div>

          {/* 播客模式（learning-design §9.5）。这里只放**要花钱**的那个开关与出发前预载。 */}
          <div className="sgroup" id="g-drive">
            <h3 id="drive-title"></h3>
            <div className="dep" id="dep-drive"></div>
            <label className="check">
              <input id="drive-play-notes" type="checkbox" />
              <span id="drive-play-notes-label"></span>
            </label>
            <p className="note" id="drive-play-notes-note"></p>
            {/* 出发前预载（learning-design §9.5）。第一下只算账、不发请求；第二下才花钱。
                 这是 §9.2 修订后「允许的批量」的唯一实例，四个构成要件（先算账 / 第二下才跑 /
                 可停 / 具名报账）都长在这几个元素上，别把它简化成一个直接开跑的按钮。 */}
            <label className="field">
              <span id="drive-preload-days-label"></span>
              <select id="drive-preload-days">
                <option value="0" id="drive-preload-days-0"></option>
                <option value="3" id="drive-preload-days-3"></option>
                <option value="7" id="drive-preload-days-7"></option>
              </select>
            </label>
            {/* 裸 button，**不要**包进 <label class="field">：label 会把激活转发给它内部的
                 那个控件，于是一次点击派发两个 click 事件。旁边 btn-test-notes 之类包在 label
                 里没出事，只是因为 runTest 在同步阶段就 disabled 了按钮（禁用的按钮不再派发）。
                 这个按钮是两态的（算账 → 开跑），第二个事件会在开跑的瞬间把自己停掉。 */}
            <button id="btn-drive-preload" type="button" className="secondary"></button>
            <p className="note" id="drive-preload-note" role="status" aria-live="polite"></p>
            <p className="note" id="drive-preload-hint"></p>
            <p className="note" id="drive-audio-cache"></p>
            <button id="btn-drive-clear-audio" type="button" className="danger"></button>
            {/* 亮屏（§9.5）。App 在前台时屏幕不自动锁，这是 app:sync 的 idle-timer 补丁。
                 但**锁屏之后保持亮屏第三方 App 做不到** —— 唯一能让锁屏卡片持续可见的是
                 系统的「息屏常显」。所以这里写的是「去哪儿开」，不是「我们做不到」。 */}
            <p className="note" id="drive-awake-note"></p>
          </div>

          {/* 对话 · 实时听译 与 实时字幕（§9.6 / §9.8）：实时转写固定为设备内置 —— 依赖行说它在不在，语言包行说包在不在。 */}
          <div className="sgroup" id="g-listen">
            <h3 id="listen-title"></h3>
            <div className="dep" id="dep-listen"></div>
            <label className="check">
              <input id="listen-capture" type="checkbox" />
              <span id="listen-capture-label"></span>
            </label>
            <p className="note" id="listen-capture-note"></p>
            <label className="check">
              <input id="subtitle-capture" type="checkbox" />
              <span id="subtitle-capture-label"></span>
            </label>
            {/* 语言对（§9.6，2026-09-08）。两个下拉与对话页底部那两个是**同一份设置**：
                 洽谈现场发现语言选错要能立刻改，跳设置页等于中断会话，所以两处都有。
                 两边选成同一种语言时不是拒绝而是对调 —— 见 ListenCore.langPatch 的注释。 */}
            <label className="field">
              <span id="listen-my-lang-label"></span>
              <select id="listen-my-lang"></select>
            </label>
            <label className="field">
              <span id="listen-other-lang-label"></span>
              <select id="listen-other-lang"></select>
            </label>
            <p className="note" id="listen-lang-note"></p>
            {/* 识别语言包（§9.1.1，镜像 §9.6 的 downloading 态）：本机识别器的语言包由系统按需下载；
                 换了语言先在这里说清在不在，而不是等到点「开始听」才发现要等。 */}
            <div className="field" id="listen-pack-row" hidden>
              <p className="note" id="listen-pack-state" role="status" aria-live="polite"></p>
              <progress id="listen-pack-progress" max="100" value="0" hidden></progress>
              <button id="listen-pack-dl" type="button" className="secondary"></button>
            </div>
            {/* 实时字幕「视频的语言」（§9.8 协议补充决定 6）进设置页（2026-09-17）：与准备页那处是「两处一份设置」。 */}
            <label className="field">
              <span id="subtitle-video-lang-label"></span>
              <select id="subtitle-video-lang"></select>
            </label>
            <label className="check">
              <input id="listen-autospeak" type="checkbox" />
              <span id="listen-autospeak-label"></span>
            </label>
            <p className="note" id="listen-autospeak-note"></p>
          </div>

          {/* 文档翻译（§9.7） */}
          {/* 快速翻译（learning-design §9.9）。只在 macOS 出现：原生回了 quick-caps 才显示（AppQuickHost.onCaps），
               iOS 与老原生壳整块不出现。M-1 只有「在菜单栏常驻」这一个开关，快捷键 / 增强取词 / 截图随各自的 PR 进来。 */}
          <div className="sgroup" id="g-quick" hidden>
            <h3 id="quick-title"></h3>
            <label className="check">
              <input id="quick-enabled" type="checkbox" />
              <span id="quick-enabled-label"></span>
            </label>
            <p className="note" id="quick-enabled-note"></p>
            {/* 三个全局快捷键（M-7）。行由 app/quick-settings.js 画：录制控件五态；「输入翻译」那一行在下面的「更多选项」里。 */}
            <div className="hk-head"><h4 id="quick-hotkeys-title"></h4><button id="quick-hotkeys-reset" type="button" className="link"></button></div>
            <div id="quick-hotkeys"></div>
            {/* 增强取词（M-5）：默认关，打开才问系统权限。原生没回 postEvent 能力时整行不出现。 */}
            <div id="quick-enhanced-row" hidden>
              <label className="check">
                <input id="quick-enhanced" type="checkbox" />
                <span id="quick-enhanced-label"></span>
              </label>
              <p className="note" id="quick-enhanced-hint"></p>
              <p className="note" id="quick-enhanced-state" role="status" hidden></p>
              <div className="row" id="quick-enhanced-actions" hidden>
                <button id="quick-enhanced-relaunch" type="button"></button>
                <button id="quick-enhanced-privacy" type="button" className="secondary"></button>
              </div>
            </div>
            {/* 存入复习库（quickCapture，默认开；受学习总闸控制）。 */}
            <label className="check">
              <input id="quick-capture" type="checkbox" />
              <span id="quick-capture-label"></span>
            </label>
            <p className="note" id="quick-capture-hint"></p>
            {/* 「更多选项」：输入翻译的快捷键、屏幕录制状态、登录时启动（默认关）、给右键「服务」绑快捷键。
                 画布写的是「详细档多露几行」，但「快速 / 详细」两档只许管「引擎与密钥」一节（test:app 的不变量）⇒
                 这一块不跟全局档位，用块内自己的折叠区，默认收起。 */}
            <details className="quick-more" id="quick-more">
              <summary id="quick-more-title"></summary>
              <div id="quick-hotkeys-more"></div>
              <p className="note" id="quick-screen-state" role="status"></p>
              <div className="row"><button id="quick-screen-privacy" type="button" className="secondary" hidden></button></div>
              <div id="quick-login-row" hidden>
                <label className="check">
                  <input id="quick-login" type="checkbox" />
                  <span id="quick-login-label"></span>
                </label>
                <p className="note" id="quick-login-hint"></p>
                <p className="note" id="quick-login-approval" role="status" hidden></p>
                <div className="row"><button id="quick-login-go" type="button" className="secondary" hidden></button></div>
              </div>
              <p className="note"><button id="quick-services-go" type="button" className="link"></button></p>
            </details>
          </div>

          {/* 系统翻译（learning-design §9.9 / iOS 线 I-7）。只在 iPhone / iPad 上出现：
               原生装了 mtVault 通道才显示（AppVault.available()），macOS 与老原生壳整块不出现。
               系统不提供「我是不是默认翻译 App」的接口 —— 所以这里说的是**我们答得上来的那件事**：
               引擎配置有没有同步过去。选没选成默认，让用户自己在那三步里看。 */}
          <div className="sgroup" id="g-systrans" hidden>
            <h3 id="systrans-title"></h3>
            <p className="note" id="systrans-state" role="status" aria-live="polite"></p>
            <p className="note" id="systrans-intro"></p>
            <ol className="steps" id="systrans-steps">
              <li id="systrans-step1"></li>
              <li id="systrans-step2"></li>
              <li id="systrans-step3"></li>
            </ol>
            <p className="note" id="systrans-need"></p>
            <label className="check">
              <input id="systrans-capture" type="checkbox" />
              <span id="systrans-capture-label"></span>
            </label>
            <p className="note" id="systrans-capture-hint"></p>
          </div>

          {/* 误点了「我已打开」能把首页横幅找回来（2026-09-22，画布 YEDD4VmT9Pv2htUpoWZ9ZB 第 2 页板 ⑤，用户点头）。
               只在横幅被「我已打开」收起过时出现；点了就地说「已恢复」，这一组随即收起。显隐由 app.js paintExtRestore()。 */}
          <div className="sgroup" id="g-extbanner" hidden>
            <h3 id="extb-title"></h3>
            <p className="note" id="extb-note"></p>
            <button id="extb-restore" type="button" className="secondary"></button>
            <p className="note" id="extb-done" role="status" aria-live="polite" hidden></p>
          </div>

          <div className="sgroup" id="g-docs">
            <h3 id="docs-title"></h3>
            <div className="dep" id="dep-docs"></div>
            <label className="check">
              <input id="doc-capture" type="checkbox" />
              <span id="doc-capture-label"></span>
            </label>
            <p className="note" id="doc-capture-note"></p>
            <label className="check">
              <input id="doc-prefetch" type="checkbox" />
              <span id="doc-prefetch-label"></span>
            </label>
          </div>
        </div>

        <div className="sec" id="sec-account">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">3</span><h3 id="sec-account-title"></h3></div>
          </div>
          <div className="sgroup" id="g-account">
            <h3 id="account-title"></h3>
            <p className="note" id="account-who"></p>
            <button id="settings-signout" type="button" className="secondary"></button>
            {/* Apple requires in-app account deletion wherever accounts exist
                 (learning-design §10 Gate B). Not a nice-to-have: without it the app cannot
                 ship. Destructive, so it confirms and says exactly what goes. */}
            <button id="delete-account" type="button" className="danger"></button>
            <p className="note" id="delete-note"></p>
          </div>
          <div className="sgroup" id="g-corpus">
            <h3 id="corpus-title"></h3>
            <div className="counts" id="settings-counts"></div>
            <button id="split-long" type="button" className="secondary"></button>
            <button id="clean-known" type="button" className="secondary"></button>
            {/* 本机卫生，不是同步功能：一台设备换过账号之后，唯一的出路不该是删应用
                 重装。刻意**不受**后端开关门控 —— 先例是扩展设置页的同一个
                 按钮就在同步块之外，所以中国版扩展照样有它。 */}
            <button id="clear-learn" type="button" className="secondary danger"></button>
          </div>
        </div>

        <div className="sec" id="sec-about">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">4</span><h3 id="sec-about-title"></h3></div>
          </div>
          <div className="sgroup" id="g-feedback">
            {/* 反馈 / 评分：宿主 App 里 window.open 是哑的，两个按钮经原生桥在系统里
                 打开（邮件 App / App Store 评分页），地址由 learn/feedback.js 统一给。 */}
            <h3 id="feedback-title"></h3>
            <button id="feedback-mail" type="button" className="secondary"></button>
            <button id="feedback-rate" type="button" className="secondary"></button>
            <p className="note" id="feedback-note"></p>
          </div>
          {/* 匿名用量事件的开关（docs/telemetry-design.md §5）。中国版没有遥测脚本，整块藏掉。 */}
          <div id="telemetry-block" hidden>
            <h3 id="telemetry-title"></h3>
            <label className="row-toggle"><span id="telemetry-label"></span><input type="checkbox" id="telemetry-on" /></label>
            <p className="note" id="telemetry-note"></p>
          </div>
        </div>
      </section>
    </>
  );
}

export default AppShell;
