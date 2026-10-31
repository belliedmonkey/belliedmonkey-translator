/* findings.js — 审计结论数据。
   每条 evidence 必须是可复核的源码位置（file:line），或仓库内既有文档的条款。
   报告只做呈现与过滤，不在数据里做判断。 */
window.FINDINGS = [
  {
    id: 'OVL-01',
    severity: 'P0',
    kind: 'visual',
    surface: 'overlay',
    title: '页内注入层完全脱离 token 体系，palette 门禁管不到',
    impact: '字幕叠层、历史面板、译按钮菜单这三个用户看得最多的注入界面，既不受对比度门禁约束，也不和扩展页共用形态语言。',
    evidence: [
      { file: 'extension/content/subtitle-adapter.js', line: 192, note: 'background:rgba(8,8,8,0.82);border-radius:3px —— 字幕行内联样式' },
      { file: 'extension/content/subtitle-adapter.js', line: 218, note: "色值 '#ffb3b3' 写死在失败态" },
      { file: 'extension/content/subtitle-adapter.js', line: 224, note: "占位/待重试行写死 '#d6d6d6'" },
      { file: 'extension/content/subtitle-adapter.js', line: 435, note: '菜单面板 background:rgba(28,28,28,.97);border-radius:10px' },
      { file: 'extension/content/subtitle-adapter.js', line: 444, note: '菜单项 hover 态 rgba(255,255,255,.1) 内联赋值' },
      { file: 'extension/content/subtitle-adapter.js', line: 465, note: '菜单表头 #9a9a9a' },
      { file: 'build/palette.config.js', line: 9, note: '门禁声明只覆盖「页面注入 CSS 与 icon.svg 里的字面 hex」，管不到 JS 内联 cssText' },
      { file: 'extension/styles/organic-tokens.gen.css', line: 4, note: 'WCAG 比值由 test/palette-contrast.test.js 钉住，同样只覆盖走 token 的那条路' }
    ],
    fix: '抽一张 overlay.css（.mt-overlay-line / .mt-panel / .mt-menu / .mt-sub-btn），颜色从 content/palette.gen.js 的运行时对象取而不是内联字面量。这样门禁能覆盖到，注入层也从此和扩展页共用同一套形态语言。'
  },
  {
    id: 'OVL-02',
    severity: 'P0',
    kind: 'visual',
    surface: 'overlay',
    title: '叠层圆角与全站形态语言相反',
    impact: '视频画面上的品牌控件是 3px 直角矩形，与扩展页「按钮一律胶囊」是两种语言；用户在两处看到的是两个产品。',
    evidence: [
      { file: 'extension/content/subtitle-adapter.js', line: 192, note: '字幕行 border-radius:3px' },
      { file: 'extension/content/subtitle-adapter.js', line: 251, note: '转写按钮 border-radius:12px' },
      { file: 'extension/content/subtitle-adapter.js', line: 435, note: '菜单面板 border-radius:10px' },
      { file: 'design/handoff.md', line: 26, note: '「按钮/输入框一律胶囊 border-radius: 999px」' }
    ],
    fix: '随 OVL-01 一起收敛。定两档就够：字幕行是文本块不是控件，用 6px；按钮与菜单是控件，用胶囊或统一 12px。'
  },
  {
    id: 'POP-01',
    severity: 'P0',
    kind: 'interaction',
    surface: 'popup',
    title: '键盘焦点态大面积缺失',
    impact: '纯键盘用户在弹窗、复习页、App 壳里无法知道焦点在哪。弹窗里的目标语言下拉和本站开关恰恰是最依赖焦点反馈的控件。',
    evidence: [
      { file: 'design/_ds/organic-3a5ce71b-e7ca-43e4-a746-002b04f3a674/styles.css', line: 104, note: '设计系统里是有这条的：:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }' },
      { file: 'extension/popup/popup.css', line: 221, note: '该文件只有 disabled 规则，全文 focus-visible 计数为 0' },
      { file: 'extension/popup/popup.css', line: 148, note: '.switch input { opacity:0; width:0; height:0 } —— 视觉隐藏的 checkbox 没有任何焦点代理样式' },
      { file: 'extension/learn/review.css', line: 119, note: 'button:hover 有 border-color 反馈，但没有对应的 focus 反馈' },
      { file: 'extension/options/options.css', line: 268, note: '#sync-section button:focus-visible —— 全站唯一一处焦点环' },
      { file: 'extension/options/options.css', line: 135, note: '输入控件 outline: none，:139 的 input:focus 只改 border-color' }
    ],
    fix: '四个页面共用一条 :focus-visible 基线，直接抄设计系统那条。给 .switch 补 input:focus-visible + .slider 的代理焦点环。保留 :focus 的默认行为、只用 :focus-visible 画环。'
  },
  {
    id: 'DS-01',
    severity: 'P1',
    kind: 'visual',
    surface: 'ds',
    title: 'Organic 字体在实现中零落地',
    impact: '设计系统与实现之间有一道断层。中文界面里标题与正文同族同重，全部层级靠字号和字重撑，品牌识别度没有任何来自字体的贡献。',
    evidence: [
      { file: 'design/_ds/organic-3a5ce71b-e7ca-43e4-a746-002b04f3a674/styles.css', line: 2, note: '@import 引入 Caprasimo / Figtree' },
      { file: 'design/_ds/organic-3a5ce71b-e7ca-43e4-a746-002b04f3a674/styles.css', line: 44, note: '--font-heading: "Caprasimo" —— 设计系统的展示字体真源' },
      { file: 'extension/popup/popup.css', line: 32, note: '实现用的是 -apple-system, BlinkMacSystemFont, Segoe UI, system-ui' },
      { file: 'extension/options/options.css', line: 26, note: '同上，系统栈' },
      { file: 'extension/learn/review.css', line: 32, note: '同上，系统栈' },
      { file: 'app/style.css', line: 49, note: '同上，系统栈；全仓对 Caprasimo / Figtree 的引用计数为 0' }
    ],
    fix: '两个方向二选一，不要停在中间。要么在设计系统里把展示字体显式降级为「可选增强」并删掉实现承诺，让设计稿不再提；要么在扩展页引入 Figtree 的 Latin 子集作为 --font-display，CJK 回落系统字，至少让英文界面有一致的展示字。'
  },
  {
    id: 'DS-02',
    severity: 'P1',
    kind: 'visual',
    surface: 'ds',
    title: '没有 type scale，基准字号三套、取值 36 个',
    impact: '同一档语义（说明文字、标签、次要信息）在四个面里各是一个值；rem 与 px 混写同一个名义尺寸，改根字号时会分叉。',
    evidence: [
      { file: 'extension/popup/popup.css', line: 33, note: '基准 14px' },
      { file: 'extension/options/options.css', line: 27, note: '基准 15px' },
      { file: 'extension/learn/review.css', line: 32, note: '基准 15px' },
      { file: 'app/style.css', line: 49, note: '基准 16px，且全篇用 rem —— 与扩展侧 px 混写同一名义尺寸（12px / 0.75rem / 0.78rem≈12.5px）' }
    ],
    fix: '在 organic-tokens.gen.css 里加一组 --fs-caption / --fs-small / --fs-body / --fs-title / --fs-display，四个文件统一引用。基准字号定一个值并写进 handoff。'
  },
  {
    id: 'DS-03',
    severity: 'P1',
    kind: 'visual',
    surface: 'ds',
    title: '垂直节奏各页自成一套，没有共同的间距基线',
    impact: '三套内边距节奏（12/14/16/18/22/24）并存，跨页面对不齐，密度感也不一致 —— 弹窗偏紧、设置页与复习页偏松。',
    evidence: [
      { file: 'extension/popup/popup.css', line: 43, note: 'header padding: 16px 16px 14px' },
      { file: 'extension/popup/popup.css', line: 85, note: 'section margin: 0 14px 12px' },
      { file: 'extension/options/options.css', line: 56, note: '.card padding: 22px 24px; margin-bottom: 14px' },
      { file: 'extension/options/options.css', line: 34, note: '.page max-width: 640px; padding: 16px' },
      { file: 'extension/learn/review.css', line: 66, note: '.panel padding: 22px' },
      { file: 'extension/learn/review.css', line: 39, note: '.page max-width: 680px —— 与设置页的 640px 也不一致' }
    ],
    fix: '定一条 8px 基线的间距 token（4/8/12/16/24/32），把 14/18/22 这些半档值按语义归并：卡片内边距 24、卡片间距 16、行间距 12。'
  },
  {
    id: 'DS-04',
    severity: 'P2',
    kind: 'visual',
    surface: 'ds',
    title: '圆角双轨：小圆角散落在胶囊语言之外',
    impact: '同一张复习卡上就有 16px（评分键）、6px（习惯格）、3px（强度条）三种圆角语言；同一份设置页里散着 2/10/12/14px。',
    evidence: [
      { file: 'extension/learn/review.css', line: 160, note: '.grade border-radius: var(--radius-md) —— 16px' },
      { file: 'extension/learn/review.css', line: 144, note: 'textarea border-radius: 14px' },
      { file: 'extension/learn/review.css', line: 197, note: '.habit-days span border-radius: 6px' },
      { file: 'extension/learn/review.css', line: 179, note: '.strength-track border-radius: 3px' },
      { file: 'extension/options/options.css', line: 183, note: 'input[type=color] border-radius: 10px' },
      { file: 'extension/options/options.css', line: 196, note: '.color-preview border-radius: 2px' },
      { file: 'design/handoff.md', line: 26, note: '只规定了胶囊，没规定其余档位' }
    ],
    fix: '在 handoff 里补三档：胶囊 = 可交互控件与输入；16px = 卡片内内容块；8px = 指示性小元件。把 2/3/6/10 收到 8px 一档。'
  },
  {
    id: 'POP-02',
    severity: 'P1',
    kind: 'visual',
    surface: 'popup',
    title: '弹窗与扩展页的字号密度不一致，跨面切换有跳变',
    impact: '同一个「设置行」在弹窗里是 13px、在设置页是 14px；说明文字在两处分别是 11px 与 12px。',
    evidence: [
      { file: 'extension/popup/popup.css', line: 33, note: '基准 14px（设置页是 15px）' },
      { file: 'extension/popup/popup.css', line: 127, note: '.row-label 13px' },
      { file: 'extension/popup/popup.css', line: 134, note: '.hint 11px' },
      { file: 'extension/options/options.css', line: 91, note: '.field.row label 14px —— 同一语义，差 1px' },
      { file: 'extension/options/options.css', line: 99, note: '.hint 12px —— 同一语义，差 1px' }
    ],
    fix: '随 DS-02 一起收进 type scale。先统一基准，再让每面只做密度档位差异，而不是各写各的。'
  },
  {
    id: 'POP-03',
    severity: 'P1',
    kind: 'interaction',
    surface: 'popup',
    title: '触控目标低于 44pt，且标准存在但未全局执行',
    impact: '弹窗里复习、文档、站点开关这几行是手机上的高频点击目标，40px 高正好落在误触区间。',
    evidence: [
      { file: 'extension/popup/popup.css', line: 96, note: '.row { min-height: 40px } —— 整行可点的设置行' },
      { file: 'extension/styles/bilingual.css', line: 39, note: '.mt-rate-x { padding: 0 6px; font-size: 1.1em } —— 译文末尾提示行的关闭键，命中区远低于 44px' },
      { file: 'extension/content/subtitle-adapter.js', line: 407, note: '译按钮 width:40px;height:40px' },
      { file: 'extension/options/options.css', line: 272, note: '#sync-section button.link-btn { min-height: 44px } —— 标准是有的，只是没全局执行' }
    ],
    fix: '.row 提到 44px；.mt-rate-x 视觉尺寸不变、用伪元素把命中区扩到 44×44；译按钮视觉直径保持 40，用 padding 扩。'
  },
  {
    id: 'POP-04',
    severity: 'P2',
    kind: 'visual',
    surface: 'popup',
    title: '图标语言混用，emoji 充当功能图标',
    impact: 'emoji 在不同平台字形不同，与产品内部线性图标族不是一套；描边宽度 2 与 2.75 并存。',
    evidence: [
      { file: 'src/pages/popup.jsx', line: 405, note: "行首用 '📄 翻译文档（PDF / Word / 图片）' 作功能图标" },
      { file: 'design/handoff.md', line: 27, note: '「图标：Lucide，stroke-width: 2.75」' },
      { file: 'extension/styles/floating-button.css', line: 56, note: '.mt-fab-stroke stroke-width: 2 —— mascot 几何，形态上可以豁免，但 handoff 没写' }
    ],
    fix: '弹窗那行换 Lucide 文件图标（14px / stroke 2）。描边宽度定一档写进 token，FAB 的 2 作为造型豁免写进 handoff，别让它继续像个疏漏。'
  },
  {
    id: 'POP-05',
    severity: 'P2',
    kind: 'interaction',
    surface: 'popup',
    title: 'popup.jsx 存在恒等三元，React 迁移残留',
    impact: '两个分支相同。读代码的人会以为这里曾有两种态，实际差异只落在内容上。',
    evidence: [
      { file: 'src/pages/popup.jsx', line: 374, note: "className={firstRunVisible ? 'setup-note' : 'setup-note'}" }
    ],
    fix: '直接写 className="setup-note"。若本意是两态，差异应落在内容上而不是 className 上。'
  },
  {
    id: 'OPT-01',
    severity: 'P1',
    kind: 'interaction',
    surface: 'options',
    title: '设置页后三节永远全展开，导航成本高',
    impact: '只有第一节受「快速 / 详细」控制，后三节与档位无关、永远全展开，一屏装不下。锚点跳转的存在本身就是这个问题的证据。',
    evidence: [
      { file: 'extension/options/options.html', line: 180, note: '四节编号：1 引擎与密钥 / 2 功能 / 3 账号与数据 / 4 关于，共 10 张卡' },
      { file: 'extension/options/options.css', line: 397, note: '注释明说「快速 / 详细」只管第一节，其余三节永远可见' },
      { file: 'extension/options/options.css', line: 377, note: '.field.anchor-flash —— 为「按钮点了、人到了、开关没找到」打的补丁' },
      { file: 'extension/options/options.css', line: 242, note: '.card button:not(.btn-danger):not(.icon-btn) —— 用排除选择器统一卡内所有按钮，主/次语义无法枚举' }
    ],
    fix: '后三节也接入档位，或至少给每节一个可折叠。把排除选择器换成显式类名（.btn-secondary / .btn-quiet / .btn-danger），让按钮语义可枚举、可审计。'
  },
  {
    id: 'OVL-03',
    severity: 'P1',
    kind: 'visual',
    surface: 'overlay',
    title: '注入层出现 Material 绿，与 Organic 不同族',
    impact: '全站唯一一处非品牌色的注入元素，出现在字幕叠层菜单的勾选标记上。',
    evidence: [
      { file: 'extension/content/subtitle-adapter.js', line: 447, note: "勾选标记 color:#4caf50" },
      { file: 'build/palette.config.js', line: 26, note: 'sage 家族 #f0fae1…#272e1b，注册表里没有 #4caf50' }
    ],
    fix: '换成 sage-strong 的运行时值（浅色 #56633f / 暗色 #aebf92），或直接用 ytTextColor —— 后者本来就在设置里暴露给用户。'
  },
  {
    id: 'OVL-04',
    severity: 'P2',
    kind: 'visual',
    surface: 'overlay',
    title: 'FAB 没有暗色变体',
    impact: '用户最常按的那个元件，在深色网页上仍是浅色块 + 浅色投影，与页面底色直接冲突。同层的译文块有暗色，FAB 没有。',
    evidence: [
      { file: 'extension/styles/floating-button.css', line: 49, note: '耳朵 / 头 / 肚是奶油 #f5ead8，全文 prefers-color-scheme 计数为 0' },
      { file: 'extension/styles/floating-button.css', line: 39, note: 'drop-shadow 是浅色配方，暗色页面上没有对应的深色配方' },
      { file: 'extension/styles/bilingual.css', line: 54, note: '同一层的 .mt-translation 是有暗色分支的 —— 两个文件覆盖不一致' },
      { file: 'design/handoff.md', line: 22, note: '「暗色模式 Organic 未提供」—— 这是整条暗色债务的总账，不只是 FAB' }
    ],
    fix: '给 FAB 加 prefers-color-scheme 块，奶油部分换 neutral 浅阶或加一圈深色描边保住轮廓。handoff §1 里说的「后续派生完整暗色阶」是同一件事，建议合并做。'
  },
  {
    id: 'OVL-05',
    severity: 'P2',
    kind: 'visual',
    surface: 'overlay',
    title: '译文层留有空规则与未联动的分隔线',
    impact: '弱。::before 留了个 display:none 的空实现；分隔线是固定 18% 透明度，没有跟随译文色。',
    evidence: [
      { file: 'extension/styles/bilingual.css', line: 49, note: '.mt-translation::before { display: none } —— 空实现' },
      { file: 'extension/styles/bilingual.css', line: 10, note: 'border-top: 1px solid rgba(86,99,63,0.18) —— 固定透明度，暗色下靠另一条规则硬改' }
    ],
    fix: '删掉空规则。分隔线改用 color-mix 跟随译文色，暗色自动跟着走，省掉一条媒体查询。'
  },
  {
    id: 'APP-01',
    severity: 'P1',
    kind: 'interaction',
    surface: 'app',
    title: 'App 壳是 13 个平铺 section，没有导航模型',
    impact: '屏与屏之间平权，看不出层级。从听译/跟读返回该落到首页还是上次位置，全靠每屏自己放一个返回按钮 —— 三个系统 banner 与六个功能屏占同一层槽位。',
    evidence: [
      { file: 'app/index.html', line: 22, note: '13 个顶层 section：dl-mismatch / ext-banner / systrans-banner / signed-out / onboard / signed-in / app-drive / app-listen / app-docs / app-settings / setup-done / review-view / quick-root' },
      { file: 'app/index.html', line: 372, note: '每屏各放一个 .link 返回按钮，如 app-drive-back' },
      { file: 'app/style.css', line: 32, note: '[hidden] { display: none !important } —— 屏与屏互斥全靠这一条' }
    ],
    fix: '至少给深度 >2 的屏（跟读 / 听译 / 文档）定一条统一返回约定并抽成 goBack()，同时恢复滚动位置。三个 banner 抽成 toast 或 sheet 层，不再占用 section 槽位。'
  },
  {
    id: 'APP-02',
    severity: 'P1',
    kind: 'visual',
    surface: 'app',
    title: '跨宿主同一组件无法共用 token',
    impact: '免费额度卡这类「扩展页与 App 都有」的组件，两个宿主两套值。这个方向已经踩过一次 —— 同一个 token 在两个宿主差 0.87 的对比度事故。',
    evidence: [
      { file: 'build/palette.config.js', line: 44, note: 'neutral700 提到 #6a6255 的原因记录：同一张卡在两个宿主差 0.87，贴线意味着任何底色微调都会把它推到线下' },
      { file: 'app/style.css', line: 17, note: '壳层只能别名共享 token（--fg/--dim/--line/--field），无法定义自己的字号阶梯' },
      { file: 'app/style.css', line: 49, note: 'App 侧 16px + rem 阶梯' },
      { file: 'extension/options/options.css', line: 27, note: '扩展侧 15px + px 阶梯' }
    ],
    fix: '随 DS-02 一起解决：基准字号与字号阶梯进 token，App 侧不再自有 rem 阶梯。'
  },
  {
    id: 'APP-03',
    severity: 'P2',
    kind: 'visual',
    surface: 'app',
    title: 'App 壳与复习页的样式拼接是结构性耦合',
    impact: '现在靠 :where() 的特异度技巧挡住了，但没有结构性保证。下次有人在壳层加一条裸元素规则，第一时间会打穿复习页 —— 注释里记的 green-on-green ▶ 就是这么来的。',
    evidence: [
      { file: 'app/style.css', line: 63, note: '整段注释在解释为什么所有壳层规则都要用 :where() 限域' },
      { file: 'extension/learn/review.css', line: 22, note: '同一件事的另一半：两个文件会被 build/app-bundle.js 拼在一起，同名 :root 会全局互相覆盖' },
      { file: 'app/style.css', line: 16, note: '因此「这个块只能别名共享 token，写裸 hex 会重开拼接陷阱」' }
    ],
    fix: '把复习视图从 app shell 的样式拼接里拆成独立产物，让两份 CSS 不再共享一个作用域。:where() 是止血，不是治本。'
  },
  {
    id: 'APP-04',
    severity: 'P2',
    kind: 'visual',
    surface: 'app',
    title: 'App 壳与设置页的内容宽度不一致',
    impact: '弱。同一层级的两页，一页 640px 一页 680px，横屏或桌面窗口下换页时内容会左右跳一下。',
    evidence: [
      { file: 'extension/options/options.css', line: 34, note: '.page max-width: 640px' },
      { file: 'extension/learn/review.css', line: 39, note: '.page max-width: 680px' }
    ],
    fix: '定一个 --page-max 给两个页面共用。'
  },

  /* ── 新手引导 ────────────────────────────────────────────── */
  {
    id: 'ONB-01',
    severity: 'P0',
    kind: 'interaction',
    surface: 'onboarding',
    title: 'iOS 上 App 判不了扩展启没启用 —— 这是引导所有问题的根因',
    impact: '引导的最后一屏要求用户去 Safari 打开扩展，而 App 端读不到结果。整条引导因此无法闭环：它只能把人送出去，收尾时无从判断成没成。',
    evidence: [
      { file: 'app/app.js', line: 601, note: '代码自述：「App 在 iOS 上判不了扩展启没启用」，所以这一屏没有「继续」' },
      { file: 'app/app.js', line: 382, note: '唯一的确认途径是一条链接：「不确定？打开检测页看绿灯 →」' },
      { file: 'app/app.js', line: 587, note: '正文本身就是一段手动路径：地址栏左边的扩展图标 →「管理扩展」→ 打开' },
      { file: 'app/app.js', line: 419, note: 'iosSteps() 把这条路径固化成三行 step，两处复用' }
    ],
    fix: '不要试图在 App 里猜状态。把官网检测页做成引导的最后一屏本身——用户读完看到绿灯或红灯，才算走完。在那之前，引导保持「未完成」。'
  },
  {
    id: 'ONB-02',
    severity: 'P0',
    kind: 'interaction',
    surface: 'onboarding',
    title: 'iOS 上引导的最后一屏是死胡同：照做即永久出师无回',
    impact: '唯一能点的按钮会把人送出 App，并且**当场**把引导标记为「已完成」。用户没得到任何成功确认，也再没有回来的入口——因为 resume 记录同时被删掉了。',
    evidence: [
      { file: 'app/app.js', line: 604, note: 'ext 屏 ob-next 被隐藏，这一屏没有「继续」' },
      { file: 'app/app.js', line: 1500, note: 'ob-setup 的唯一行为：openExternal() 然后 obFinish() —— 点一下就收尾' },
      { file: 'app/app.js', line: 435, note: 'openExternal 走原生桥开**系统浏览器**（WKWebView 的 window.open 是哑的），人真的离开了 App' },
      { file: 'app/app.js', line: 727, note: 'obFinish() 无参调用 → 写 OB_SEEN=1 并删掉 OB_RESUME，resume 入口随之消失' }
    ],
    fix: '点「在网页上完成设置」不应该等于完成。改成两个明确出口：「我已打开」（回检测页对答案后再收尾）与「稍后再说」（保留 OB_RESUME，进度条停在当前屏）。'
  },
  {
    id: 'ONB-03',
    severity: 'P0',
    kind: 'interaction',
    surface: 'onboarding',
    title: '引导刚退场，同一句话立刻以横幅形态回来',
    impact: '用户照做 → 离开 App → 打开回来 → 引导标记完成 → 横幅立刻顶上来说「Safari 扩展还没打开」，文案和三步插图与刚才那一屏一字不差。在 iOS 上这几乎是必然发生的。',
    evidence: [
      { file: 'app/app.js', line: 732, note: 'obFinish 的最后一步就是 paintExtBanner()，注释写明「引导退场，横幅按真实状态回来」' },
      { file: 'app/app.js', line: 376, note: 'iOS 横幅形态的注释：与引导 ext 屏「同一份文案与插图」' },
      { file: 'app/app.js', line: 377, note: '横幅直接调用 obSteps(iosSteps(), steps)，与 ext 屏共用同一个函数' },
      { file: 'app/app.js', line: 361, note: '现有的抑制只是「引导进行中不挂横幅」—— 退场那一刻抑制解除，横幅照挂' }
    ],
    fix: 'obFinish 后不要无条件 paintExtBanner。给一个显式确认态：用户点「我已打开」并被检测页确认后才允许横幅接手；未确认前，引导入口本身就是那个常驻位，不需要第二个组件说同样的话。'
  },
  {
    id: 'ONB-04',
    severity: 'P1',
    kind: 'interaction',
    surface: 'onboarding',
    title: '「我只要网页翻译」把用户推进死胡同',
    impact: '首屏那个出口的含义是「我不想要 App 这边，只要网页翻译」。但它跳转的目标正是「打开网页翻译扩展」那一屏——在 iOS 上，那恰好是走不出去的一屏。语义和落点相反。',
    evidence: [
      { file: 'app/app.js', line: 581, note: '首屏唯一出口：ob-webonly「我只要网页翻译」' },
      { file: 'app/app.js', line: 1003, note: '点击后 obAt = OB.indexOf(\'ext\') —— 直接落到 ext 屏' },
      { file: 'app/app.js', line: 553, note: '同屏还有 ob-skip「以后再设置」，与它构成两个语义相近的离开方式' },
      { file: 'app/app.js', line: 578, note: '主按钮下承诺「两步，约 30 秒」，但 ext 屏要人离开 App 手工点 Safari 设置' }
    ],
    fix: 'iOS 上「我只要网页翻译」应当直接收尾并把 ext-banner 留在首页，而不是把人送进一个需要手工操作的屏。同时首屏三个出口（开始设置 / 以后再设置 / 我只要网页翻译）应收敛到两个。'
  },
  {
    id: 'ONB-05',
    severity: 'P1',
    kind: 'visual',
    surface: 'onboarding',
    title: 'App 引导与扩展引导是两套相反的范式',
    impact: 'App 侧是定长线性脚本，不看现状、照演一遍；扩展侧是活状态驱动，已配好的事直接跳过。同一产品两套引导心智，用户要学两次。',
    evidence: [
      { file: 'app/app.js', line: 528, note: 'App：const OB = [\'welcome\'] (+signin) + [\'firstuse\',\'ext\']，线性无分支' },
      { file: 'src/pages/onboard.jsx', line: 62, note: '扩展：const OB = [\'welcome\',\'engine\',\'try\']，engine 屏带分叉' },
      { file: 'src/pages/onboard.jsx', line: 309, note: '扩展的 forkPick 分 grant / key 两条路，配了引擎的人不必再被问' },
      { file: 'src/pages/onboard.jsx', line: 392, note: '扩展的 forkLanded 订阅真实 grantTail 到账，界面跟着活状态走' },
      { file: 'extension/options/options.js', line: 723, note: '「引导页本身读的是活状态，extObSeen 只影响弹窗那个入口」' }
    ],
    fix: '把 App 引导也改成活状态驱动：已登录的不出登录屏、已领额度的跳过领额度屏、已启用扩展的不出 ext 屏。定长脚本是「假设用户什么都没配」，这正是 iOS 用户体验崩掉的起点。'
  },
  {
    id: 'ONB-06',
    severity: 'P1',
    kind: 'interaction',
    surface: 'onboarding',
    title: '引导进行中会被登录态检查打断，进度不保留',
    impact: '走到第 3 屏的用户可能被一次后台登录态检查拽出引导。onboard 被直接隐藏，而这不是 skipped 分支，不写 resume 记录——下次进来从头开始。',
    evidence: [
      { file: 'app/app.js', line: 1718, note: "dl-mismatch 触发时 $('onboard').hidden = true —— 引导被硬关" },
      { file: 'app/app.js', line: 1725, note: '该路径走 LearnAuth.signOut()，把用户踢回登录表单' },
      { file: 'app/app.js', line: 782, note: '相比之下 ob-resume 的正规入口会显式记住停在哪一屏' }
    ],
    fix: 'dl-mismatch 应该等引导收尾后再判，或作为引导之上的模态呈现并保留 obAt。不要让一次状态检查把用户的进度清零。'
  },
  {
    id: 'ONB-07',
    severity: 'P2',
    kind: 'interaction',
    surface: 'onboarding',
    title: '「打开 Safari 扩展」这句话有五个可能的出处，没有统一状态',
    impact: 'iOS 用户第一次打开 App，可能在引导、横幅、扩展自己的引导页、弹窗首帧、设置页快速设置里各遇到一次说法相近但措辞不同的提示，而没有一处会告诉他「这条你已经知道了」。',
    evidence: [
      { file: 'app/app.js', line: 584, note: '① 引导 ext 屏' },
      { file: 'app/app.js', line: 343, note: '② 首页 ext-banner' },
      { file: 'src/pages/onboard.jsx', line: 302, note: '③ 扩展侧引导页' },
      { file: 'src/pages/popup.jsx', line: 137, note: '④ 弹窗首帧 first-run，条件是 !s.extObSeen && !setup' },
      { file: 'src/pages/popup.jsx', line: 128, note: '⑤ 同屏的 setup-note，与 ④ 互斥 —— 引擎没配好时只出 ⑤，④ 直接消失' }
    ],
    fix: '把「扩展未启用」抽成一个全局共享状态加单一展示位：谁都能读，但同一时刻只有一处负责说。弹窗那两条合并成一条按真实状态分支的提示。'
  },
  {
    id: 'ONB-08',
    severity: 'P2',
    kind: 'interaction',
    surface: 'onboarding',
    title: '跨端引导状态互不可见',
    impact: 'App 侧记 OB_SEEN / OB_RESUME，扩展侧记 extObSeen，两套 storage 互不相通。在 App 里跳过的用户到扩展里还会被问一遍，反之亦然。',
    evidence: [
      { file: 'app/app.js', line: 499, note: "App 侧：const OB_SEEN = 'onboardSeen'" },
      { file: 'app/app.js', line: 503, note: "App 侧：const OB_RESUME = 'onboardResume'" },
      { file: 'src/pages/popup.jsx', line: 132, note: '扩展侧：extObSeen 是流程标记，popup 用它决定要不要出首帧提示' },
      { file: 'extension/options/options.js', line: 893, note: '设置页手动清 extObSeen —— 说明它只是个入口开关，不代表用户真的走过引导' }
    ],
    fix: '两个入口共用一个「已完成哪些」的记录（Sync 已经在同步这类状态），否则同一件事永远要教两遍。'
  },

  /* ── 正面样本 ────────────────────────────────────────────── */
  {
    id: 'POS-01',
    severity: 'POS',
    kind: 'strength',
    surface: 'ds',
    title: '治理层做对的地方：门禁管住了什么，以及这次的问题为什么不在门禁内',
    impact: '这次没有把 token 漂移写进结论，正是因为下面这几道防线确实在工作。剩下的问题全部落在门禁覆盖不到的维度上。',
    evidence: [
      { file: 'build/palette.config.js', line: 1, note: '单一真源：颜色唯一真源，构建期发射 token 与运行时对象' },
      { file: 'build/palette.config.js', line: 12, note: 'build.js 的 legacyBrandGate 拒收任何未注册的 hex —— 所以「硬编码色值漂移」不是真问题' },
      { file: 'test/palette-contrast.test.js', line: 1, note: 'WCAG 比值由测试钉住 —— 所以「对比度不达标」不是真问题' },
      { file: 'extension/options/options.css', line: 9, note: '「链接颜色只有一个来源：--link」—— 并记下了浏览器默认蓝在深色卡上只有 1.56:1 那次事故' },
      { file: 'extension/options/options.css', line: 385, note: 'prefers-reduced-motion 正确降级，且保留静态描边 —— 动画关掉了「是哪一行」这件事仍然说得出' },
      { file: 'extension/popup/popup.css', line: 2, note: '四个文件都把 [hidden] { display:none !important } 写在最前并写清原因' }
    ],
    fix: '把门禁的覆盖面扩一扩是最高杠杆的一步：OVL-01 建议的 overlay.css 一旦走 palette.gen.js，注入层就自动进入现有门禁，不需要新建机制。'
  }
];
