# 大肚猴翻译（mobiletranslator）规约摘要

- 用途：给「大肚猴翻译（mobiletranslator）」写的规约摘要，供 agent 开工前速读。
- 生成日期：2026-10-12
- 依据的提交：371c4bf4
- 处理日期：2026-10-12（第 9 节 CON-01～14 已按用户批准口径在源文件改掉，来源行号已按改后源文件重新核对）
- 读过的文件清单（相对路径）：
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.claude/settings.json`
  - `.claude/skills/pencil-draft/SKILL.md`
  - `.claude/skills/perf-tune/SKILL.md`
  - `.claude/skills/preview-video/SKILL.md`
  - `.claude/skills/store-release/SKILL.md`
  - `.claude/skills/store-release/assets.md`
  - `.claude/skills/win-matrix/SKILL.md`
  - `docs/adapter-architecture.md`
  - `docs/amo-build.md`
  - `docs/china-backend-cost.md`
  - `docs/device-verification.md`
  - `docs/domain-design.md`
  - `docs/growth-spec.md`
  - `docs/interaction-spec.md`
  - `docs/learn-regression.md`
  - `docs/learning-design.md`
  - `docs/model-recommendations.md`
  - `docs/oauth-design.md`
  - `docs/regression-tests.md`
  - `docs/release-baseline-1.19.3.md`
  - `docs/release-checklist.md`
  - `docs/seo-geo-checklist.md`
  - `docs/subscription-auth-research.md`
  - `docs/telemetry-design.md`
  - `docs/troubleshooting.md`
  - `docs/verification-spec.md`
  - Pencil 设计稿索引：`design/pencil-archive:design/pencil/INDEX.md`

说明：每条格式为 `- <编号> 要点 —— 来源「文件:行号」`；行号取自各笔记的标注，笔记未标注处已回读原文确认。敏感文件与商店脚本等按抽象化铁律以「（名称略）」处理。

## 1. 交互和文案（UX）

- UX-01 用户可见交互/布局规则的唯一权威是 `docs/interaction-spec.md`；改外观或行为必须同一份提交更新它，不得散落到代码注释或 `AGENTS.md` —— 来源「docs/interaction-spec.md:3-6」
- UX-02 任何触发 IO（网络请求、合成、读写存储、播放）的控件，从请求发出到结果落定之间必须 disabled，落定后恢复；目的是防重复触发重复扣费并给「正在干活」一个不说谎的信号 —— 来源「docs/interaction-spec.md:13-16」
- UX-03 在途期间必须有可见状态文案，失败必须具名 —— 来源「docs/interaction-spec.md:16-18」
- UX-04 disabled 必须看得见：每个页面样式表都要给 `:disabled` 可辨视觉态（灰化 + 去 hover 反色）—— 来源「docs/interaction-spec.md:18-20」
- UX-05 settings 类控件的即时本地保存（change 即写 storage、毫秒级、幂等）豁免禁用；一旦该 change 处理器串联慢 IO（拉语音列表、跑统计、强制同步），豁免失效 —— 来源「docs/interaction-spec.md:25-29」
- UX-06 YouTube 字幕每次页面加载默认关；用户没开就不翻译任何东西，刷新总是从关开始 —— 来源「docs/interaction-spec.md:43-44」
- UX-07 桌面 youtube.com 播放器内「译」按钮管视频字幕、页面 FAB 管网页文本，二者互不影响；移动端（任何触控设备，含 m.youtube.com）只有一个 FAB 同时驱动两者 —— 来源「docs/interaction-spec.md:45-55」
- UX-08 必须一次抓完整份 `/api/timedtext` 字幕，在 60 秒滑动窗口提前翻译并按 `video.currentTime` 匹配显示；禁止逐条字幕翻译、禁止逐词翻译 —— 来源「docs/interaction-spec.md:63-73」
- UX-09 自绘字幕叠层并隐藏 YouTube 原生字幕渲染；叠层固定在播放器恒定位置（bottom:11%）、水平居中、每种语言最多 1 行、过长文本按该句时间跨度分页（行宽实测、绝不按固定字数）—— 来源「docs/interaction-spec.md:82-92」
- UX-10 当前句译文未就绪时在译文行显示「⏳ 译文准备中…」，到达后下一 tick 自动换入；绝不显示空白或卡住的行 —— 来源「docs/interaction-spec.md:96-98」
- UX-11 网页双语翻译默认关（仅当 FAB 打开时开始）；译文注入每个原文段落之下；视口内先显示「⏳ 翻译中…」占位并增量填充；最多 5 段并行；失败显示可点的「⚠️ 翻译失败,点此重试」—— 来源「docs/interaction-spec.md:371-379」
- UX-12 需要译文的段落永远不会「什么都不显示」：静默终结只允许发生在请求发出之前；请求发出后没拿到可用译文（网络失败、重试耗尽、模型空正文）一律进失败态并给重试入口 —— 来源「docs/interaction-spec.md:380-387」
- UX-13 只翻译另一种语言的内容：已是目标语言的段落必须完全不产生译文行，也不得发给提供方 —— 来源「docs/interaction-spec.md:532-539」
- UX-14 跳过决定分两层：第 1 层脚本（所有表面可用，Safari 只有这层，只决定 zh/ja/ko 目标），第 2 层浏览器原生检测（仅部分浏览器，且只在三道闸全满足时开火）；zh/ja/ko 目标永不咨询第 2 层 —— 来源「docs/interaction-spec.md:546-561」「docs/interaction-spec.md:570-574」
- UX-15 绝不改变页面自身内容的行为：链接、按钮、处理器、右键菜单与选择必须与没有扩展时完全一致；interleave 在原文含交互或非文本内容时退回兄弟渲染；时间戳→跳转锚点只在 YouTube 宿主创建 —— 来源「docs/interaction-spec.md:470-490」
- UX-16 表格单元格把译文放在自身内部且对表格固有宽度零贡献；原文本身是 flex/grid 容器时译文强制换到下方独占整行 —— 来源「docs/interaction-spec.md:491-498」「docs/interaction-spec.md:613-624」
- UX-17 译文精确匹配原文的 computed font（family/size/weight/style/line-height/letter-spacing），唯一保持不同的字体属性是颜色；「字号」设置是在其上的相对比例 —— 来源「docs/interaction-spec.md:647-658」
- UX-18 界面语言（`uiLang`）与目标语言（`targetLang`）独立；默认跟随系统 locale，可在弹窗与设置两处显式覆盖，切换即时生效无需重载 —— 来源「docs/interaction-spec.md:1499-1508」
- UX-19 所有用户可见字符串都必须本地化、以 `_locales/` 的键存在（各 locale 键集相同）；硬编码文案是缺陷不是风格选择，由 `test/no-hardcoded-copy.test.js` 在每次 `npm test` 强制 —— 来源「docs/interaction-spec.md:1513-1524」
- UX-20 故意例外只三个且原样显示：语言选择器的本名（endonyms）、第三方品牌名、产品自己的「译」按钮字形 —— 来源「docs/interaction-spec.md:1525-1529」
- UX-21 采集默认关、开启时用户不可见（无 badge、无 toast、无高亮、无计数）；关闭与清除各自一键，关掉立即停采集但不静默删除已采集的 —— 来源「docs/interaction-spec.md:1538-1548」
- UX-22 复习揭示永远由用户发起（Nothing auto-advances, nothing is timed）；四个评分按钮各自显示后果（不记得→重新学 / 有点难→2 天后 / 记得→5 天后 / 太简单→12 天后）—— 来源「docs/interaction-spec.md:1610-1627」
- UX-23 绝不用 action badge 计数：service worker 在 Safari iOS 会死，badge 计数在那里会静默错误；计数由显示它的那个页面渲染 —— 来源「docs/interaction-spec.md:1602-1604」
- UX-24 App 屏序：未登录首屏只有登录（可点击元素 ⊆ {Apple, Google, 邮箱}），资源包屏不可跳过；就绪 = 登录 ∧ 引擎可解析 ∧ 识别语言包 ∧ 朗读包 ∧ 基础组件 —— 来源「docs/interaction-spec.md:1224-1246」
- UX-25 App 首页折叠线（844pt）以内实心按钮 ≤2 且恰是「开始实时字幕」「开始听译」；两张主角卡等高且卡高是常量（`height` 而非 `min-height`）；所有可点元素命中区 ≥44×44 —— 来源「docs/interaction-spec.md:2627-2636」「docs/interaction-spec.md:2641-2659」
- UX-26 语言区两门对称互译（听到 A 译 B、听到 B 译 A），不写「我 / 对方」角色；两边选成同一种语言不是拒绝而是对调，并说一句「两边不能是同一种语言 — 已对调」—— 来源「docs/interaction-spec.md:2317-2345」
- UX-27 文案与它描述的功能必须同版上线 —— 来源「docs/growth-spec.md:81-82」
- UX-28 品牌：产品是「大肚猴翻译 / BelliedMonkey Translator」；绝不在代码、文档或 UI 里提及参考扩展的名字 —— 来源「docs/interaction-spec.md:2601-2602」
- UX-29 不要遮挡超过必要的画面 / 页面 —— 来源「docs/interaction-spec.md:2600」
- UX-30 三种形态（窄 / 宽·iPad / 宽·Mac）由窗口宽度决定而非设备，断点只有一道 `@media (min-width: 720px)`；不写 iPad 专属布局 —— 来源「docs/interaction-spec.md:2130-2142」

## 2. Pencil 稿规矩（PEN）

- PEN-01 交互变更必须先出 Pencil 稿并过人评审再实现；固定顺序：Pencil 稿 → 人工签核 → `docs/interaction-spec.md` → 代码 → 门禁 —— 来源「AGENTS.md:139-146」
- PEN-02 不得没有稿子就把新交互 / 新文案写进代码，也不得用 HTML 手搓一份当捷径 —— 来源「.claude/skills/pencil-draft/SKILL.md:8-10」
- PEN-03 本仓库只用 Pencil（pen.dev），禁止 Open Design / OD；文案类改动同样要出稿 —— 来源「.claude/skills/pencil-draft/SKILL.md:12-13」
- PEN-04 画布 MCP 的所有工具（取应用状态 / 读技能 / execute / browser / 取样式）都要求编辑器里有一个 `.pen` 文档处于打开状态，否则一律报「文件需在编辑器中打开才能执行此操作」—— 来源「.claude/skills/pencil-draft/SKILL.md:41-46」
- PEN-05 画布 MCP 不能新建文档；要空白文档就让用户在 Pen.app 里新建，或打开一个已有的 —— 来源「.claude/skills/pencil-draft/SKILL.md:58」
- PEN-06 `.pen` 是加密的：永远不要用读文件 / 内容搜索的方式去读它，只能经画布 MCP —— 来源「.claude/skills/pencil-draft/SKILL.md:59」
- PEN-07 动手前必须先读 execute 与 pen-schema 两份文档；优先照抄已有稿的视觉语言（字体 / 字号 / 底色 / 圆角），别自造一套 —— 来源「.claude/skills/pencil-draft/SKILL.md:63-65」
- PEN-08 execute 的 input 是一段「脚本」而不是函数：不要写顶层 return，结果用 `Print(...)` 读 —— 来源「.claude/skills/pencil-draft/SKILL.md:67-70」
- PEN-09 别把 pen 的代码写进 Code Mode 的顶层沙箱：那层没有画布 API，会报 Unknown identifier（Print/Get/Insert/document 同理）；那是误报，不是版本或授权问题 —— 来源「.claude/skills/pencil-draft/SKILL.md:71-74」
- PEN-10 每个新增节点都要有可读的 `name`；更新操作不能改 id / type / ref —— 来源「.claude/skills/pencil-draft/SKILL.md:79」
- PEN-11 文本节点必须同时给 `textGrowth: "fixed-width"` 和宽度（`width: "fill_container"`）；只设宽度不生效，长文本会撑破父 frame 被裁 —— 来源「.claude/skills/pencil-draft/SKILL.md:80-82」
- PEN-12 别在普通 frame 上用「先 placeholder: true 再更新为 false」；要显式数字高度，`height: "fit_content"` 出 NaN 时也退回显式数字 —— 来源「.claude/skills/pencil-draft/SKILL.md:88-90」
- PEN-13 用带访问器的读取查 problems（溢出 / 被裁）与 bounds 量测；截图一次一张、只在成稿后截一次 —— 来源「.claude/skills/pencil-draft/SKILL.md:91-94」
- PEN-14 评审：把截图 / 预览给用户看，说清改了什么、代价是什么；等明确通过再改 app/ 或扩展代码，并在同一个提交里带上相应文档 —— 来源「.claude/skills/pencil-draft/SKILL.md:101-104」
- PEN-15 评审对象是 Pencil 稿而非 diff：`.pen` 画布才是人批准的东西，实现必须匹配它；内部诊断页与开发者开关豁免 —— 来源「AGENTS.md:153-155」
- PEN-16 稿子先行：画不出稿的任务必须等，不得「同时」推进交互工作，要停下并说明 —— 来源「AGENTS.md:149-152」
- PEN-17 每份稿必须覆盖该面所有形态、每个变体一列（窄 / 宽·iPad / 宽·Mac，断点 720px）；不写 iPad-only 布局 —— 来源「AGENTS.md:166-181」
- PEN-18 某个变体确实画不出，就说出来并停 —— 来源「AGENTS.md:185」
- PEN-19 所有设计稿都收进版本控制并归档（`.pen` + `png/` 导出）；INDEX 只记录已知的过审 / 取代关系 —— 来源「design/pencil-archive:design/pencil/INDEX.md:3-12」
- PEN-20 `.pen` 只能用 Pen 应用（或 `@pen.dev/cli` ≥ 0.3.11）打开，GitHub 上无法直接预览，要看 `png/` 下的导出图 —— 来源「design/pencil-archive:design/pencil/INDEX.md:3」
- PEN-21 稿子的工具自 2026-10-08 起是 Pencil，不再是 OpenDesign/OD —— 来源「AGENTS.md:139-141」

## 3. 测试和回归（TST）

- TST-01 所有验证 / 测试由 `docs/verification-spec.md` 唯一权威治理，每次必须精确遵循 —— 来源「AGENTS.md:387-389」
- TST-02 载重规则：每次验证跑产品已适配的每个面的完整矩阵（每次全回归）；矩阵只增不减，一旦适配就永久加入，禁止悄悄删掉某个面 —— 来源「docs/verification-spec.md:13-15」「docs/verification-spec.md:23-25」
- TST-03 不许单面「标准」通过：只在 iPhone 上或只在 Chrome 上验过都不叫验证，除非明确写明对该面不适用 —— 来源「docs/verification-spec.md:19-22」
- TST-04 每项任务须逐面如实报告：实测有据（截图 / 录像）· 记录未跑 · 不适用；禁止暗示做过而其实没做的覆盖 —— 来源「docs/verification-spec.md:26-28」
- TST-05 每次推送前必须通过 `npm test`（纯逻辑套件）与完整面矩阵；红着套件绝不推送 —— 来源「AGENTS.md:526-537」「docs/verification-spec.md:2026-2032」
- TST-06 改了什么就必须跑哪一门：门禁触发表含 `npm test`（每次推送）· `test:layout`（content/styles）· `test:smoke`（传输层）· `test:app`（app/options/模块清单）· `test:idb`（DB_VERSION）· `test:learn` · `test:listen` · `test:quick` · `test:asr` · `test:docs` · `test:wipe` · `test:inbox` · `test:chrome-cleanup`；判据与事故在 verification-spec §3 —— 来源「CLAUDE.md:118-136」
- TST-07 一条贯穿所有门的判据纪律：`test:smoke` / `test:docs` / `test:quick` / `test:wipe` 的判据都是端点或数据库收到了什么，不是页面画了什么 —— 来源「CLAUDE.md:138-140」
- TST-08 绿套件看不到的三个盲区：断言生产构建的配置（保留一个故意不完整的用例）、断言「没做的事」（`expectNotRequested` / `asked === 0`）、断言资源生命周期（注入记录的 setTimeout/clearTimeout）；绿套件只证 happy path 产出了对的输出 —— 来源「docs/verification-spec.md:2048-2074」
- TST-09 改存储版本号必跑 `test:idb`：用上一版出货 schema 播种、经存储打开自己的库，断言旧 items/reviews/meta/索引全部存活；这是唯一触碰用户已有数据的迁移 —— 来源「docs/verification-spec.md:2076-2092」
- TST-10 学习面变化必跑 `test:learn`：真 Chrome、两个宿主（出货 app bundle 布局 + 扩展复习页）、对数据库断言行为；学习面治理 = `npm test` + `test:learn` + `test:app`（碰 DB_VERSION 加 `test:idb`）—— 来源「docs/verification-spec.md:2101-2110」「docs/learn-regression.md:130-131」
- TST-11 布局门每次触碰内容脚本或样式的推送前必跑；机器上没有 Chrome 是硬失败（可设 `CHROME_BIN`），绝不静默跳过 —— 来源「docs/verification-spec.md:2430-2432」
- TST-12 增量适配契约：每个站点特定布局修复必须带一个从该站点最小布局提炼的新 fixture，且该 fixture 必须在修复前失败、修复后通过；fixture 绝不为了让新修复过关而改 —— 来源「docs/verification-spec.md:2436-2442」
- TST-13 纪律：每条新断言做变异反向验证，杀不死的变异就是测试缺口，先补齐再合并 —— 来源「docs/learn-regression.md:41」
- TST-14 新发现的 bug 一律先补一条先红后绿的用例再修；真机新 bug 先归类到层（逻辑 / 引擎 / 平台），在对应层补用例 —— 来源「docs/learn-regression.md:6-7」「docs/learn-regression.md:132-133」
- TST-15 颜色对比度：每个页面门在深浅两种配色下跑共享清扫，任何可见文本低于 WCAG AA（4.5:1，大字 3:1）即失败 —— 来源「docs/verification-spec.md:2454-2460」
- TST-16 Provider 矩阵：注册表每个出货条目必须至少对着真实端点驱动过一次并记进 §1.0 表；模型参数表写 `false` 必须有真实服务器拒绝原句，写 `true` 可引文档；未标日期的「能用」不是验证 —— 来源「docs/verification-spec.md:579-598」
- TST-17 新增提供方必须有性能台账行，否则 `npm test` 变红；结果分 adopted / rejected / unreachable / inferred，实测永远优先 —— 来源「.claude/skills/perf-tune/SKILL.md:10-11」「CLAUDE.md:219-230」
- TST-18 装 App 前先跑 `npm run verify:app-fresh`（`.app` 内每份灌入资源与 `dist-app/` 逐字节相同）；构建链的输出一律不许吞掉，`app:sync` 的非零退出码是真要处理的 —— 来源「docs/verification-spec.md:40-48」
- TST-19 学习层回归分三层：纯逻辑（vm harness）· 真实引擎（真 Chrome）· 真机矩阵；每条用例标注它的载体，自动化覆盖不了的写明真机步骤 —— 来源「docs/learn-regression.md:5」「docs/learn-regression.md:16-20」
- TST-20 真机连续暴露的 bug 全是一个形状：逻辑是对的、表面是坏的（绿字绿底的播放按钮、永远关着的 ttsMode、指错路的报错文案）；vm harness 里没有 CSS / 存储竞速 / 布局，这些 bug 一个都测不到 —— 来源「docs/learn-regression.md:11-14」
- TST-21 同步一致性的可验证验收条：同一账号同步后各设备的计数行必须逐字一致；无任何用户活动时连续三轮双向同步稳定在「收到 0 · 上传 0」—— 来源「docs/interaction-spec.md:2510-2513」「docs/verification-spec.md:2898-2901」
- TST-22 门禁要「证伪」过才算存在：删掉模块清单一行、恢复一处手写显隐、把旧 id 放回来、让某字段恒显，四种破坏方式必须当场各红一次 —— 来源「docs/verification-spec.md:2269-2270」
- TST-23 所有真实面一律只用 cua-driver 驱动，禁用其他浏览器 / 电脑操作工具（含桌面 Chrome）—— 来源「docs/verification-spec.md:38-39」
- TST-24 两个宿主的同一控件族必须由同一个组件渲染，规则只能一份；守门禁必须覆盖每一个宿主，只查一处等于修了一半 —— 来源「docs/verification-spec.md:29-37」
- TST-25 开工同时跑一次 `npm run issues`，把别人提的 issue / PR 里「我们一条都没回」的挑出来；只有拿到结果并回读过才可以标完成 —— 来源「CLAUDE.md:86-93」

## 4. 真机和录屏验收（DEV）

- DEV-01 真机验证固定做法（2026-10-09 用户裁定，强制）：QuickTime 展示 + Mac 本机录屏 + ffmpeg 逐帧判定；做不到就说清原因并停下，禁止退回「一张末态截图 + DOM 断言」—— 来源「docs/verification-spec.md:233-240」
- DEV-02 四个角色别混：驱动用 XCUITest runner（不用 iPhone 镜像）；展示用 QuickTime、麦克风必须选「无」；录屏用 Mac 本机 `screencapture` 录 Mac 屏幕（不加 `-g`）；逐帧分析用 ffmpeg `fps=2`，按用例判据逐帧读而不是只看末态 —— 来源「docs/verification-spec.md:242-249」
- DEV-03 取证要求：`.mov` + 抽帧目录 + 逐条判据表（每条写「第几秒到第几秒、屏幕应出现什么」）；判据读帧不读 passed；做不到录屏必须写明原因，不许静默降级 —— 来源「docs/verification-spec.md:274-275」
- DEV-04 真机装包 / 读写容器 / 启动 App 走 USB（devicectl），必须解锁；看屏幕 / 点击 / 打字走 iPhone 镜像，必须锁屏——两条路对锁屏的要求正好相反，顺序固定：先解锁装包 → 再锁屏遥控 —— 来源「docs/verification-spec.md:1812-1822」
- DEV-05 任何要读麦克风的环节先退出 iPhone 镜像（镜像开着时 Mac 占用手机麦克风，样本全零）；声源一律用 Mac 或另一台设备播放的语料，不用真人说话 —— 来源「docs/verification-spec.md:151-155」「docs/verification-spec.md:394-400」
- DEV-06 任何麦克风读数要同时报帧率与 dBFS，把 −120 dBFS（rms 恒 0）判为无效读数并大声失败；全零不是「房间很安静」而是设备被占或权限被拒 —— 来源「docs/verification-spec.md:2529-2535」
- DEV-07 镜像硬前提：手机必须设了锁屏密码（没密码时配对向导报连不上，而 devicectl 明明 connected）；排查顺序先问手机有没有密码再查网络 —— 来源「docs/verification-spec.md:277-282」
- DEV-08 镜像窗口底部约 70px 悬浮条会吃掉点击；⌘V 在镜像里会被吞；别用拖拽滚动，改用滚轮并把指针放在一段纯文本上 —— 来源「docs/verification-spec.md:149-150」「docs/verification-spec.md:180」
- DEV-09 截图 / 录像前先跑「确认屏幕真的在显示」的检查：屏保运行时 WebKit 会节流不渲染，伪装得非常像产品缺陷；抓不到画面时先怀疑观察手段再怀疑被观察对象 —— 来源「docs/verification-spec.md:2506-2522」
- DEV-10 录制时目标窗口必须是最前台；第 0 帧诚实检查是强制（抽首帧确认显示的是目标窗口，之后片子里任何东西才可信）—— 来源「docs/verification-spec.md:2497-2505」
- DEV-11 DOM 里有元素不等于用户看得见（曾出现 `.mt-yt-dual` 存在却被祖先 `overflow:hidden` 裁掉）；凡是用户要看的译文 / 字幕 / 布局，必须用已构建 + 已加载扩展的截图验证真实渲染 —— 来源「docs/verification-spec.md:2466-2472」
- DEV-12 交互 / 视觉类随时间变化的行为必须用录屏而不是截图（点击闪一下、布局先动后回、字幕计时、滚动卡顿，静止图抓不到瞬态）；保留修复前（复现）与修复后两段 —— 来源「docs/verification-spec.md:2473-2476」
- DEV-13 含播客 / 视频的页面必须在播放中验证（按播放并让它跑 ≥20–30 秒）；只看加载态几乎什么都没验 —— 来源「docs/verification-spec.md:2545-2549」
- DEV-14 「有东西出现」不是判据，「出现的是该出现的那个」才是：画中画窗里有英文 ≠ 真字幕（判据是原文下面有译文且没有失败提示）；窗口截图出手机图 ≠ 取景器是活的 —— 来源「.claude/skills/preview-video/SKILL.md:16-27」
- DEV-15 屏幕锁了的三个判据（一秒钟的事）：整屏截图字节数（锁屏约 11 万 vs 醒着 100 万以上）；拿一个已知正常的窗口问 AX 也返回 0；权限查询仍说 accessibility 为真 —— 来源「.claude/skills/preview-video/SKILL.md:36-46」
- DEV-16 iPhone 预览片（IPHONE_67，886×1920）要真机；QuickTime 只当取景器，录制交给 ffmpeg——不让 QuickTime 自己录（它是沙盒 App，只接受存储面板给的位置，脚本路径一律弹权限，试两次会把保存流程顶死）—— 来源「.claude/skills/preview-video/SKILL.md:91-102」
- DEV-17 取景器必须是活的：两帧之间故意改变手机画面，两帧 md5 必须不同；一样就是镜像冻了，拔插数据线重来 —— 来源「.claude/skills/preview-video/SKILL.md:114-118」
- DEV-18 录预览片前手机上必须先配好翻译引擎（TestFlight 新装容器是空的，而 runner 一上来就点「以后再设置」跳过引导 ⇒ 每句「译文失败」）；一键卡里没有 DeepSeek、其默认 OpenRouter 境内对默认模型 403；可用组合是「详细」档 DeepSeek + 凭证 —— 来源「.claude/skills/preview-video/SKILL.md:129-137」
- DEV-19 Windows 验收行（矩阵第 8 行）跑 `/win-matrix`：Windows 11 Chrome / Edge / Firefox，从 Mac 走网络驱动（`scripts/win-matrix/`）；矩阵只增不减，没跑写 ⬜ 不写 N/A —— 来源「.claude/skills/win-matrix/SKILL.md:6-32」「CLAUDE.md:53-60」
- DEV-20 每一条在 Mac 上跑的 node 命令都要清掉代理变量（否则连 192.168.x 的请求都会被送去代理、换回 503 / 空 body、报 bad json）；curl 同理加不绕过代理的参数 —— 来源「.claude/skills/win-matrix/SKILL.md:41-48」
- DEV-21 YouTube 字幕读数只有在带广告状态时才有效；要按当前 video 参数过滤字幕资源计时条目；「译」开着时绝不用肉眼判断原生字幕（扩展用注入样式把它藏了），要读字幕段元素 —— 来源「docs/verification-spec.md:1535-1542」
- DEV-22 全屏是一等公民、必须验证：任何触碰视频字幕的改动，每个桌面浏览器 × 每个视频站点进入原生全屏都是必检项；iOS（iPhone/iPad）全屏 = 不适用、绝不许报告成通过 —— 来源「docs/verification-spec.md:748-765」「docs/interaction-spec.md:331-339」
- DEV-23 一台机器同一时刻只允许装一份大肚猴翻译（国际版与中国版是两个 bundle id，系统允许并存但我们的验证不允许）；测完一个必须卸载（不是关掉）再装另一个，出现两条则本轮此前观测全部作废 —— 来源「docs/verification-spec.md:929-958」
- DEV-24 真机上仍要人验的四件：M22、M23（云端路，后作废）与 M24、M25（本机路）；Mac 层替代不了的四样仍走真机行：会话中断（来电 / Siri 抢音频）· 锁屏 / 灵动岛 · 蓝牙路由 · #563 原始触发 —— 来源「docs/verification-spec.md:2148」「docs/verification-spec.md:537-543」
- DEV-25 真机是唯一能验「存量用户」的地方：把容器里的本地存储库拉出来，升级前拉一份当基线、升级后再拉一份对比 —— 来源「docs/verification-spec.md:1824-1837」

## 5. 发版和 TestFlight（REL）

- REL-01 任何发布前过 `docs/release-checklist.md`；它装的是构建门禁看不见的东西（跨仓库或跨账号），另一边是商店脚本（名称略）；清单弱于门禁，能变成门禁的项都要搬进构建脚本并从清单删除 —— 来源「AGENTS.md:195-199」「docs/release-checklist.md:3-14」
- REL-02 发版流程走 `/store-release`：六面顺序为 Apple iOS 国际版 → Apple macOS 国际版 → Apple iOS 中国版 → Apple macOS 中国版 → Chrome Web Store → Firefox AMO → GitHub Release + 官网 —— 来源「.claude/skills/store-release/SKILL.md:8-20」
- REL-03 一条铁律：只信回读，不信「没报错」；这条流程里每一个「成功」都可能是假的（查询显示未挂、上传停在 UPLOAD_COMPLETE、PATCH 返回 204 无正文），判据没过就是这一步没做完 —— 来源「.claude/skills/store-release/SKILL.md:45-56」
- REL-04 build 号只有 App Store Connect 知道、问商店不问仓库；iOS 与 macOS 各自独立自增且同在一个 app 下；新 build 号 = 该平台当前最大值 + 1，别用「取最新那条」—— 来源「.claude/skills/store-release/SKILL.md:71-84」
- REL-05 改版本号两处都要改（包清单与扩展清单），构建脚本有版本漂移门禁同时校验两者；Safari 工程每次重生成会静默重置三样：MARKETING_VERSION / CURRENT_PROJECT_VERSION、扩展 target 的 bundle id 大小写、DEVELOPMENT_TEAM —— 来源「.claude/skills/store-release/SKILL.md:94-95」「docs/release-checklist.md:207-216」
- REL-06 归档前必须先跑应用资源同步（漏了会出转换器 979 字节模板页，曾有 macOS 版本就这么上架过三个版本）；Safari 构建脚本成功也会非零退出，判据是工程产物与资源路径对不对 —— 来源「.claude/skills/store-release/SKILL.md:102-108」
- REL-07 不要用导出命令直接上传（那条路依赖 Xcode 里会过期的 Apple ID 登录态，两次失败的退出码都是 0）；正确做法是本地导出（不联网）+ API key 上传；凭据相关步骤由沙箱外代办脚本执行，按监督方规定不记录 —— 来源「.claude/skills/store-release/SKILL.md:201-232」
- REL-08 上传判据是出现 "No errors uploading"（退出码不可信，上传工具失败时也返回 0）；传完查 build 列表并等该 build 变 VALID（约 1–3 分钟）—— 来源「.claude/skills/store-release/SKILL.md:231-239」
- REL-09 挂 build 必须显式写 build 号，不接受「取最新那个」（两平台号各自独立自增，按号排序取首条会安静地挂上另一个平台的包）；该命令 PATCH 之后会回读，回读不符即非零退出 —— 来源「.claude/skills/store-release/SKILL.md:240-245」
- REL-10 包体自查拆开看、不要信构建日志：iOS 资源在 bundle 根、macOS 在 `Contents/Resources/`；通用六项含版本 / build、bundle id、宿主页 `Main.html` 应为两万余字节（979 字节就是转换器模板页）、这一版真正改的东西、星号残留为 0、签名；中国版另有三项 —— 来源「.claude/skills/store-release/SKILL.md:174-197」
- REL-11 素材过时审计必须走、不要跳过（曾出现国际版商店图正展示已修 bug、另两张印着作者真实邮箱的事故）；判据逐张过内容而不是只比日期 —— 来源「.claude/skills/store-release/SKILL.md:86-89」「.claude/skills/store-release/assets.md:47-49」
- REL-12 素材上传先探一条、回读 `assetDeliveryState.state === 'COMPLETE'`、再推其余；ASC 资产上传是三步（预留 → 逐段 PUT → 提交校验和），漏了校验和会永远停在 `UPLOAD_COMPLETE` 而 API 全程不报错 —— 来源「.claude/skills/store-release/SKILL.md:320-322」
- REL-13 ASO：关键词 / 副标题 / 描述只能在版本记录还是 `PREPARE_FOR_SUBMISSION` 时改，提审之后就锁到下一版；底稿不直接上传，由商店脚本（名称略）派生 iOS 与 Mac 两份；每一版、每个语种组只改一个变量 —— 来源「.claude/skills/store-release/SKILL.md:324-343」「docs/growth-spec.md:121-128」
- REL-14 国际版与中国版的文案不该相同（中国版有它独有的修复，国际版没有那个 bug，写进去就是假的）—— 来源「.claude/skills/store-release/SKILL.md:357-358」
- REL-15 隐私文案必须与本次发布的功能同版上线（页面自己写「不会提前写、也不事后补」）；两个站点的隐私改动与扩展发版同时推送，各自托管在推送后自动部署 —— 来源「docs/release-checklist.md:73-88」
- REL-16 商店页的隐私政策 URL 是 ASC 里一个独立字段（改好页面并推上线不等于它指向新页面）；该字段在 READY_FOR_SALE 下改不了（409），只能跟着一次发版改，发版时顺手核一次 —— 来源「docs/release-checklist.md:96-130」「.claude/skills/store-release/SKILL.md:247-262」
- REL-17 发布说明要带齐历史版本：先从各自发布分支取回缺的说明、再生成、后提交；判据是 CHANGELOG 里本版下面紧邻上一版、不跳号，且生成脚本的检查绿 —— 来源「docs/release-checklist.md:160-176」
- REL-18 `whatsNew` 每个本地化一处都不能空，否则提审报「version is not in valid state」（API 里没有它让你去看的关联错误）；提审脚本先干运行（五道前置：状态可提交 / 挂了 build / build 是 VALID / 有截图 / 每个本地化有更新说明）—— 来源「.claude/skills/store-release/SKILL.md:352-373」
- REL-19 撤审命令必须明确点名 bundle id，不接受「撤全部」（排队位置清零，中国版上次首提排了 40 天）；撤审后的状态是 `DEVELOPER_REJECTED`（是开发者自己撤回，不是被审核拒了）；提交集合不允许 DELETE，重试前先复用没有条目的空壳 —— 来源「.claude/skills/store-release/SKILL.md:378-395」
- REL-20 CWS 上一版在审时什么都做不了；撞到「在审」先请用户去开发者后台点取消审核（API 没有撤回提交的端点），不要挂每 10 分钟重试的循环；AMO 体检要带 `filter=all_with_unlisted`，否则看不见刚提交的那一版 —— 来源「.claude/skills/store-release/SKILL.md:428-460」
- REL-21 GitHub Release 是真正的发布面、与 CWS / AMO 平级：官网首页下载按钮直链最新 Release 的下载资产，资产名是契约，改名等于把下载按钮变成 404 —— 来源「.claude/skills/store-release/SKILL.md:473-475」
- REL-22 三条路共用一道版本完整性门禁：包内版本必须有同名标签、HEAD 必须就在那个标签上、源码目录必须干净；走 worktree 是通过检查不是跳过，不用允许脏树的逃生参数 —— 来源「.claude/skills/store-release/SKILL.md:416-426」「.claude/skills/store-release/SKILL.md:477-488」
- REL-23 改过任何一份官网 i18n 文件之后，必须重新生成 11 套语言页，否则搜索引擎索引到的是旧文案；`llms.txt` 不在字典里、每次要单独改 —— 来源「.claude/skills/store-release/SKILL.md:523-539」
- REL-24 系统要求写在功能旁边：App 与扩展下限是 iOS 16.4 / macOS 13.3，「对话 · 实时听译」与「实时字幕」另要求 iOS 26 / macOS 26；不许把 ASC 的最低系统版本抬到 26 —— 来源「docs/release-checklist.md:153-158」
- REL-25 任何发布信息（哪些商店在架、什么版本、哪个 listing）必须先查 gbrain，绝不从仓库推断；`package.json` 是版本权威，但只有商店知道最后被接受的 build number —— 来源「AGENTS.md:270-285」
- REL-26 当前基线是 1.19.3：TestFlight 只上传、未提审、未挂到版本、未推送；ASC 读回四个 build 都是 VALID；不比基线差就可以发版 —— 来源「docs/release-baseline-1.19.3.md:39-45」「docs/release-baseline-1.19.3.md:1-3」
- REL-27 权限弹窗文案也是本地化的一部分（1.12.1 国际 iOS 曾因权限请求语言与 App 本地化语言不一致被拒）：Info.plist 里放英文，App 界面支持的每个语种各一份 `<lproj>/InfoPlist.strings`；出包后回读 lproj 计数期望 13 —— 来源「docs/release-checklist.md:185-205」
- REL-28 商店描述有两个上限、小的那个只在上传时才检查：Chrome Web Store 摘要 132、Safari `extension_description` 112；已由构建期描述长度门禁覆盖 —— 来源「docs/release-checklist.md:254-271」
- REL-29 发 TestFlight 的顺序不能错：先改版本再跑 Safari 构建脚本；已发布版本的 train 关着、同版本号不能再传新 build；`verify:ios` 必须对着本次的 `.xcarchive` 跑（不给参数会读上一次的产物）—— 来源「docs/verification-spec.md:218-231」
- REL-30 中国版合规硬判据：合规门两产物绿、被禁端点路径全 0、同步关闭、无被禁厂商、默认指定引擎、评分不出现、相关门禁绿 —— 来源「docs/verification-spec.md:3287」「.claude/skills/store-release/SKILL.md:190-197」

## 6. 禁止事项（BAN）

- BAN-01 绝不用别的产品名给本产品做品牌或描述；代码、文档、UI 里不得出现其他产品品牌 —— 来源「AGENTS.md:541-543」
- BAN-02 一个并行任务 = 一个 worktree；绝不在共享树里切换分支；不创建 `REASONIX.md` —— 来源「AGENTS.md:368-373」「AGENTS.md:295-299」
- BAN-03 绝不直接提交到 main；使用特性分支 —— 来源「AGENTS.md:555」
- BAN-04 绝不把已免费出货的功能变成付费功能；绝不发残废构建（合规压力靠收窄分发地区解决）—— 来源「AGENTS.md:107-118」
- BAN-05 服务端永不存储我们无权拥有的媒体（第三方音视频只存约 20 字节指针）；整页文本与截图出于同样理由排除在存储之外 —— 来源「AGENTS.md:89-94」
- BAN-06 绝不静默丢数据；遥测绝不发页面内容 / URL / hostname / API key / email / 服务端错误文本 —— 来源「AGENTS.md:105-106」「AGENTS.md:58-63」
- BAN-07 绝不在红色套件上推送；绝不声称覆盖了没跑的矩阵面 —— 来源「AGENTS.md:537」
- BAN-08 绝不在 `translation-api.js` 硬编码厂商 endpoint；绝不重新引入硬编码供应商列表；绝不往用户提供的 URL 上拼接任何东西 —— 来源「AGENTS.md:232-246」
- BAN-09 未经人类域设计评审不得重构架构、不得给 segmenter 加 per-site / per-device 分支；站点知识只经通用标记（`data-mt-player-region` / `data-mt-skip-region`）进入 —— 来源「AGENTS.md:216-225」「docs/domain-design.md:1225」
- BAN-10 不要生成 `--macos-only` 树；不要把转换器管进 `grep|tail`（SIGPIPE 会截断其资源步骤）—— 来源「AGENTS.md:445-451」「AGENTS.md:521-522」
- BAN-11 图标必须是真的 PNG（源 `icon.svg`）；绝不把 SVG 改名为 `.png` —— 来源「AGENTS.md:439-440」
- BAN-12 YouTube 强制 Trusted Types：绝不用 `innerHTML` / `insertAdjacentHTML`，要用 `textContent` + `createElement`；也不要去伪造 pot / 反机器人 token —— 来源「AGENTS.md:508-509」「AGENTS.md:496-499」
- BAN-13 绝不逐条 / 逐词翻译字幕；拿不到字幕绝不静默退回逐词，只显示一行「字幕不可用」—— 来源「docs/domain-design.md:87-90」「docs/interaction-spec.md:116-120」
- BAN-14 绝不改变页面自身内容的行为（链接、按钮、处理器、右键菜单、选择必须与没有扩展时完全一致）；绝不销毁用户的文本选择 —— 来源「docs/interaction-spec.md:452-490」
- BAN-15 绝不用 action badge 计数（Safari iOS service worker 会死，badge 静默出错）—— 来源「docs/interaction-spec.md:1602-1604」
- BAN-16 采集发生时不可见：无 badge、无 toast、无高亮、无计数；绝不为「购买本地存储」提供入口 —— 来源「docs/interaction-spec.md:1542-1545」「docs/interaction-spec.md:2552-2554」
- BAN-17 同一台机器同一时刻只允许装一份大肚猴翻译；出现两条则本轮此前观测全部作废 —— 来源「docs/verification-spec.md:929-937」
- BAN-18 验证一律只用 cua-driver，禁用其他浏览器 / 电脑操作工具（含桌面 Chrome）—— 来源「docs/verification-spec.md:38-39」
- BAN-19 每个面验证前必须配 DeepSeek，禁用免费 Google 端点 —— 来源「docs/verification-spec.md:49-57」
- BAN-20 语音类验证一律不靠真人说话（是规则不是建议）；声源一律是播放的语料 —— 来源「docs/verification-spec.md:394-400」
- BAN-21 绝不把密钥 / 令牌贴进对话、日志、提交或拉取请求；秘密信息不打印、不进日志、不进任何提交 —— 来源「docs/verification-spec.md:106-114」「.claude/skills/perf-tune/SKILL.md:42」
- BAN-22 模型下载地址不得以明文出现在编译进客户端包的任何文件里（反编译能看到全部字符串）—— 来源「docs/verification-spec.md:3497-3511」
- BAN-23 TTS 不得静默堵死：任何 TTS 失败必须在 3 秒内让用户知道，任何卡住不得阻塞整条队列 —— 来源「docs/verification-spec.md:3515-3517」
- BAN-24 绝不把「扩展上报的请求数为零」当作没发送（Safari 没有这类通道）；任何「没看到请求」的结论必须先有阳性对照 —— 来源「docs/verification-spec.md:901-906」
- BAN-25 别拿自己注入的测试 hack 当出货代码的证据；要验已构建 / 已加载的扩展 —— 来源「docs/verification-spec.md:2539-2540」
- BAN-26 竞品全名绝不进 App Store keywords（官网 / README / HN / Reddit 可以写）—— 来源「docs/seo-geo-checklist.md:57-58」「docs/growth-spec.md:137」
- BAN-27 永远不要把第三方的短码直接写进产品或 README；对外发自己域名下的 307 短链（不用 308，它会被浏览器永久缓存）—— 来源「docs/growth-spec.md:64-72」
- BAN-28 绝不用第三方分析（无 SDK、无第三方统计、无第三方分析平台）；遥测数据直连自有后端。中国版与国际版同一份用量白名单，入口是境内 ingest，不共东京；诊断通道仍单独披露、不含原文 / 译文（2026-10-29，BEL-135）—— 来源「docs/telemetry-design.md §2 原则 6」
- BAN-29 台账（账号 ↔ 花费）与遥测永不 join；中继转发的文本不进任何表、不进日志 —— 来源「docs/telemetry-design.md:75-78」「docs/telemetry-design.md:129」
- BAN-30 采集是汇绝不是源：Collector 绝不反向施压引擎（不影响选活跃、不改泵节奏、不标记单元、绝不自发翻译请求）；运行时删掉学习层，翻译输出必须逐字节相同 —— 来源「docs/learning-design.md:213-217」
- BAN-31 禁止自我采集：注入的学习 UI 必须带 `translate="no"` 且带跳过区标记；Collector 跳过译文节点与所有 `#mt-*` 子树 —— 来源「docs/learning-design.md:239-242」
- BAN-32 凭证是设备本地的、永不同步（服务器无端到端加密）；绝不硬编码语言、绝不做词汇 / 单词卡 —— 来源「docs/learning-design.md:878-880」「docs/learning-design.md:102-107」
- BAN-33 会话永不跨界（含访问 / 刷新令牌，泄露半径是整个账号）；邮箱也不传；只传不透明 userId，且 userId 与会话分开存、内容脚本只读它 —— 来源「docs/learning-design.md:1366-1386」
- BAN-34 拉下来的东西不许再推回去：重放时盖水印，推送只发水印之后的；水印只在同步路径盖、不在文件导入路径盖 —— 来源「docs/learning-design.md:1519-1523」
- BAN-35 客户端压实今天没有生产调用者，所以「存储上界」不成立；已驱逐过的设备永不压实（否则会永久删除它驱逐掉的材料）；若真要有界必须是服务端压实 —— 来源「docs/learning-design.md:1694-1714」
- BAN-36 越界即禁止：浏览器内 OCR、整份文档一次翻译 / 后台预翻、词汇单词卡与词频表、合成语音替代真实语音 —— 来源「docs/learning-design.md:4689-4701」
- BAN-37 未经同意的自动采集：采集默认关直到用户开启一次，可随时在设置里关闭并清除 —— 来源「docs/learning-design.md:4741-4743」
- BAN-38 学习层的 indexedDB 绝不能放在内容脚本（它属于宿主页面源，会散落到每个访问过的站点且被页面脚本可读）；service worker 不能进学习层路径（Safari iOS 锁屏后永久 undefined）—— 来源「docs/learning-design.md:760-766」

## 7. 各类已知坑（PIT）

- PIT-01 Safari iOS 上设备锁屏后后台 service worker 会永久变成 `undefined`，内容脚本的 `chrome.runtime.sendMessage()` 静默失败；所有翻译 API 的 `fetch()` 必须住在内容脚本，service worker 只处理存储 / 角标 / 设置同步 —— 来源「CLAUDE.md:179-183」
- PIT-02 iOS 无热重载：资源在 Xcode 构建时打包，改代码必须重新 Run（⌘R）会重装；刷新页面只重跑已打包的代码 —— 来源「AGENTS.md:515-517」
- PIT-03 Safari 转换器以相对路径引用 `dist/` 而非拷贝；保持 `dist/` 在原位并重建 —— 来源「AGENTS.md:518-520」
- PIT-04 内容脚本可在同一 frame 被注入两次；必须用 `window.__mtMainLoaded` 防双重初始化并让 DOM 注入幂等 —— 来源「AGENTS.md:512-514」
- PIT-05 YouTube `/api/timedtext` 受 pot 门禁：直取字幕轨 URL 返回 HTTP 200 + 0 字节；要捕获 YouTube 自己的请求复用有效 token，别伪造 —— 来源「AGENTS.md:496-499」
- PIT-06 轮询而不要观察：用约 250ms 的 `setInterval` 读 `video.currentTime`；对播放器子树用 MutationObserver 加上自己的写入会造成反馈循环并冻结页面 —— 来源「AGENTS.md:504-506」
- PIT-07 广告期间播放器的 `currentTime` 是广告时间轴，必须抑制叠层；0 字节字幕响应可能来自未按 video id 过滤时读到的广告自身请求 —— 来源「docs/regression-tests.md:185-188」「docs/verification-spec.md:1524-1535」
- PIT-08 表格 caption 的译文会压在原文上（浏览器把 block 兄弟包进匿名表格盒）；这与「表格单元格必须把译文作为子节点」是同一机制，判据要覆盖一组表格 display 值 —— 来源「docs/verification-spec.md:2760-2771」
- PIT-09 分页器用硬编码行高阈值，在衬线字体页会把每行判「过高」而吐 1 字符一页；要在元素真实字体里量一行实际高度作基准 —— 来源「docs/device-verification.md:108-114」
- PIT-10 带凭据抓 CDN 会 503 并显示「字幕不可用」；跨源 fetch 必须去掉 credentials（同源 track 仍发 cookie，绝不发往跨源 CDN）—— 来源「docs/device-verification.md:102-107」
- PIT-11 `resolveCues` 一次性 latch 会让慢嵌入或瞬态失败永远卡在「字幕不可用」；要改成重试 —— 来源「docs/device-verification.md:115-117」
- PIT-12 Spotify 的位置来自进度条滑块的 `aria-valuenow`（毫秒），不是媒体元素——它用 MSE 流式播放，`<video>` 的 currentTime 是缓冲位置 —— 来源「docs/interaction-spec.md:222-225」
- PIT-13 Spotify 转写只在「转录 / Transcript」标签激活时挂载，cue 类名被哈希；要按按钮 + 时间戳结构锚定，脆弱需定期复验 —— 来源「docs/interaction-spec.md:214-221」
- PIT-14 Safari 上没有 `chrome.i18n.detectLanguage`，所以在 Safari 采集的每一张卡 `lang` 都是 `und`（iOS 上的全部素材）—— 来源「docs/interaction-spec.md:1791-1796」
- PIT-15 YouTube 嵌入播放器只接受 http(s) embedding origin，从 `chrome-extension://` 会拒绝（错误 153）；不要再加回 iframe —— 来源「docs/interaction-spec.md:1633-1642」
- PIT-16 flex/grid 行里的兄弟译文会与原文并排重叠并横向溢出；要强制译文独占整行（flex 用 `flex-basis:100%` + 换行、grid 横跨所有列），反向 flex 容器按视觉顺序锚定 —— 来源「docs/device-verification.md:19-25」「docs/interaction-spec.md:499-509」
- PIT-17 App 的 `file://` 在这里是安全上下文，且跨域策略不挡后端（与浏览器相反）；所以 App 能力不需要任何 Swift —— 来源「docs/verification-spec.md:1565-1572」
- PIT-18 模拟器文本输入会把每个字符变成 a、⌘A/⌘V 被吞；可行路径是剪贴板 + 长按（原地拖拽持续约 2200ms）+ 粘贴；不要按 ⌘⇧K「去启用硬件键盘」（它是开关且本来开着，按下去会断开它）—— 来源「docs/verification-spec.md:131-139」「docs/verification-spec.md:1784-1792」
- PIT-19 两个坐标空间不同：自动化工具要的是窗口状态里的窗口局部像素，而模拟器截图只给设备像素；点击目标要在窗口状态图里定位 —— 来源「docs/verification-spec.md:1793-1796」
- PIT-20 `app:sync` 有产物过期守卫，触发时会静默丢掉 Swift 补丁（xcodebuild 照样 BUILD SUCCEEDED、装上去还是旧原生代码）；判据是 sync 输出无红叉、工程里能查到改动，且标记字符串要 > 15 字节 —— 来源「docs/verification-spec.md:319-322」「docs/verification-spec.md:2346-2351」
- PIT-21 转换器在转换时抓取文件清单：之后加进扩展源目录的文件永不被 Xcode 工程引用，静默缺席于构建包，而构建成功、manifest 校验过、每道门都绿（曾整个学习模块目录缺席导致设置页死掉）—— 来源「docs/verification-spec.md:2606-2629」
- PIT-22 存储读失败被当成「配置为空」⇒ 用默认值悄悄覆盖用户配置；回调形式把「扩展存储目录建不出来」报成空结果，只有 promise 形式说真话 —— 来源「docs/verification-spec.md:2660-2690」
- PIT-23 平台「不可能」时先清掉模拟器再下结论：一台被反复安装 / 卸载折腾过的模拟器能造出与产品缺陷难以区分的症状 —— 来源「docs/verification-spec.md:2692-2695」
- PIT-24 macOS 上用禁用签名方式构建的 App 即使放进 `/Applications` 也不会被 Safari 注册；要用 Apple Development 身份真签名 —— 来源「docs/verification-spec.md:3112-3114」
- PIT-25 Safari 临时扩展是快照：重建 `dist/` 不会更新已加载的临时扩展，旧快照会伪装成「修复没生效」；每次构建后都必须重新添加 —— 来源「docs/verification-spec.md:1067-1094」
- PIT-26 存在多个 `dist/` 文件夹（主检出与各工作树、中国版 / 火狐版），必须核对文件对话框里选中的路径，否则会静默加载不含本次改动的代码 —— 来源「docs/verification-spec.md:1095-1102」
- PIT-27 不要用扩展详情面板的「重新载入」来拾取重建（会让扩展保持加载但失效）；不退出而加载新构建要用「卸载」再「添加临时扩展」—— 来源「docs/verification-spec.md:1119-1124」
- PIT-28 本机环境变量会让任何 node 脚本一跑就崩（指向不存在的 preload）；所有 node / 含 node 的脚本都要先清掉它 —— 来源「.claude/skills/store-release/SKILL.md:113-114」
- PIT-29 Firefox 让内容脚本的请求受宿主页面 CSP 约束（Chrome 与 WebKit 都豁免）；无 CSP 页正常、有 CSP 页每段「翻译失败」，用户无从得知原因 —— 来源「docs/verification-spec.md:3007-3019」「docs/domain-design.md:1061-1077」
- PIT-30 模拟器会抢控制通道：iPhone 模拟器里同一个调试包也在拉命令，一小时内所有「真机」结果其实全是模拟器；验真机前先关掉所有模拟器 —— 来源「docs/verification-spec.md:315-318」
- PIT-31 构建会清空产物目录，而浏览器正加载着那个目录 ⇒ 扩展被静默卸载（页面照常打开但整段界面不在 DOM 里）；构建之后必须重新装载扩展 —— 来源「docs/verification-spec.md:2905-2907」
- PIT-32 关闭调试连接不等于关闭标签页：被「关掉」的页面还开着、采集器照常刷外发箱，于是看起来完全像同步不收敛（改变了被观察对象的观察工具，产出的是假象）—— 来源「docs/verification-spec.md:2908-2910」
- PIT-33 「没报错」不是判据、回读才是；查询显示 build「未挂」可能是 `include=build` 不返回关系数据且不报错；上传 200 也可能停在 `UPLOAD_COMPLETE` —— 来源「.claude/skills/store-release/SKILL.md:51-53」
- PIT-34 CWS 的 API 读不到审核状态（`uploadState: NOT_FOUND` 说的是「草稿里没有待传的包」，不是找不到条目）；AMO 的「线上版本」只算审核通过的，看不见刚提交的那一版 —— 来源「.claude/skills/store-release/SKILL.md:442-460」
- PIT-35 智能体光标会被印进商店素材（守护进程要带 `--no-overlay` 重启，用完还原）；录屏工具的窗口录制不是无遮挡的、起录会抢焦点、标签栏会泄露浏览记录 —— 来源「.claude/skills/store-release/assets.md:159-172」
- PIT-36 麦克风样本全零不是「房间很安静」而是设备被别人占着或权限被拒；安静房间是 −45 到 −50 dBFS 的底噪，不是 −∞ —— 来源「docs/verification-spec.md:2529-2532」
- PIT-37 后台标签页节流 `requestAnimationFrame`，真实字幕 / 叠层只在前台标签页渲染；对后台标签页的自动截图可能漏掉它们 —— 来源「docs/verification-spec.md:2543-2544」
- PIT-38 检查器自己要包住主体并给硬超时：「会挂起的检查」与「还在工作的检查」无法区分 —— 来源「docs/verification-spec.md:2094-2099」
- PIT-39 某个观察手段在成功与失败下产出相同输出时，它就不是证据（该换手段而不是再截一张图）—— 来源「docs/verification-spec.md:2860-2862」
- PIT-40 模拟器文字输入的坐标与窗口状态图要分清；Safari 会缓存本机测试页（改内容后要加 `?v=N`，否则真机拍到旧文案而页面看起来正常）—— 来源「docs/verification-spec.md:357-358」
- PIT-41 中国版「第一次登录报错、第二次就成功」的实据是验证码过期与邮箱写错，不是服务端故障；屏上「连不上服务器」只有 `network/offline` 一个来源，服务端日志与遥测都指望不上 —— 来源「docs/troubleshooting.md:160-166」
- PIT-42 追踪线上问题时不要试 SSH（那台机器没有密码在仓库里）；走腾讯云 TAT，且云 CLI 要用 uvx 前缀、端口参数大写、远端脚本里别再套一层引号 —— 来源「docs/troubleshooting.md:50-54」「docs/troubleshooting.md:91-95」
- PIT-43 不要把容器内网地址段（172.18.x.x）当用户；那是容器自己发出来的 —— 来源「docs/troubleshooting.md:127-128」
- PIT-44 别用「可见文本包含」判断元素在不在：自动化 UI 测试的 AX 快照会静默缺项；要确认元素在不在，用能看见的兄弟元素做锚点、滚到它可见并截图，文本搜索只用于同一份快照里刚成功匹配过的文字 —— 来源「docs/troubleshooting.md:339-352」
- PIT-45 同比例不等于「整屏」（裁剪只要按原比例切，比例就一模一样）；判据是内容（状态栏 / Home 指示条 / 能否继续下拉）—— 来源「docs/troubleshooting.md:320-330」
- PIT-46 HTTP 200 不等于成功 / 生效 / 最优：无效 key 可能被包在 200 里、参数可能被无视、两种拼法都 200 但一贵一倍 —— 来源「.claude/skills/perf-tune/SKILL.md:23-25」
- PIT-47 `max_completion_tokens` 在推理模型上同时覆盖思考与输出：长段落上思考先把预算吃光，返回 200 + 正文 0 字，用户看到「翻译失败」且重试永远同样失败 —— 来源「.claude/skills/perf-tune/SKILL.md:28-30」
- PIT-48 缺路径造成的失败与 CORS 失败在 WebKit 里表征完全相同、运行时无法区分，只有离线形状检查能分清；「我们调用了哪个地址」的结果行是唯一能把两者分开的事实 —— 来源「docs/interaction-spec.md:1845-1850」
- PIT-49 macOS 宿主必须实现 `runOpenPanel`，否则文件上传是死按钮；取消分支必须调 completionHandler(nil)，漏了这一下 `<input>` 会永远卡住且没有任何错误 —— 来源「docs/interaction-spec.md:787-789」「docs/device-verification.md:241-245」
- PIT-50 Safari 逐站权限在新装 / 升级后会重置为「询问」，未走完授权并重启 Safari 前内容脚本静默不注入（无 FAB），会伪装成代码 bug —— 来源「docs/regression-tests.md:469-472」「docs/device-verification.md:92-98」
- PIT-51 回声闸对泰语这类无空格文字会失明（整句一个巨型 token，包含度退化成整串相等）；要按字符 bigram 切 —— 来源「docs/device-verification.md:511-514」
- PIT-52 系统语音（AVSpeechSynthesizer）出声比 didFinish 晚，Dictation 定稿也可能晚落；只比对文本不够，还要给时间窗留尾（`ECHO_TAIL_MS` 1500→3000、放开静麦后 extendMuteTail）—— 来源「docs/device-verification.md:535-538」
- PIT-53 `swiftc -parse` 只查语法不查类型：写出 `pcm.channelCount` 这种类型错误时本地不拦，四个归档全失败（补 `swiftc -typecheck` 进本地流程）—— 来源「docs/device-verification.md:564-566」
- PIT-54 分析 / 转写引擎没配时，用户打开的开关绝不能静默什么都不做（2026-08-17 真机缺陷：功能与未实现无法区分）—— 来源「docs/interaction-spec.md:1948-1952」「docs/learn-regression.md:73」
- PIT-55 遥测心跳的并发：两个模块各调一次初始化会各发一次心跳并各持一份队列；测试曾是顺序调三次所以永远红不了 —— 来源「docs/telemetry-design.md:930-932」「docs/verification-spec.md:3430」
- PIT-56 不在客户端白名单里的 code 会被静默丢掉，于是「有多少人用完额度」永远是 0，而那正是花钱决策的唯一依据 —— 来源「docs/telemetry-design.md:126-129」
- PIT-57 配额数字被推导错过两次（由机制推导的数字只与机制一样真）；存储上界不是真的，多数活跃账户最终没有设备能压实 —— 来源「docs/learning-design.md:1179-1193」「docs/learning-design.md:1001-1018」
- PIT-58 导出曾经过「已毕业」过滤的构建路径，导致「一键导出全部」静默丢掉整个候选池，而导出「成功了」—— 来源「docs/learning-design.md:1158-1166」
- PIT-59 大陆经营主体的资质是硬门：国内短信签名与微信登录都要求企业主体（运营商层面实名报备），没有营业执照之前登录这一块没有可做的事 —— 来源「docs/china-backend-cost.md:279-307」
- PIT-60 该云上「PostgreSQL + serverless」这个组合不存在；换认证服务等于 532 行客户端重写 + schema 分叉，要微信登录应走前置换票而不是换认证服务 —— 来源「docs/china-backend-cost.md:46-66」「docs/china-backend-cost.md:182-218」
- PIT-61 泰文断句坏：识别器 final 是懒时间片、收口只按停顿 ≥400ms，而泰语句末是空格无标点 ⇒ 25–56s 才出一片；修法是加绝对上限 `maxUtterMs=5s`，且上限触发时优先切在最近一次够长的停顿上（不然会切在泰文半个词中间）；P50 从 43.3s 降到 12.98s —— 来源「docs/learning-design.md:3802-3826」
- PIT-62 CoreML 对每个新输入形状都要重新 plan（每形状冷启动 40–70ms、12 形状合计 1065ms、CPU 冲到 85–95%），必须改成固定几档输入；前端也不能写标量三重循环（要换 BLAS），矩阵乘摆错行主序会让特征全错、真机一行都不出 —— 来源「docs/learning-design.md:3869-3875」
- PIT-63 macOS 系统音频的「仅系统录音」权限框没被点时，HAL 调用会同步卡约 60s+30s 且返回 0 却无 IO 回调；建 tap / IOProc / 启动一律放后台队列，以收到第一个 IO 回调为「在抓」的唯一证据（启动调用返回 0 不算）—— 来源「docs/learning-design.md:3990-3991」
- PIT-64 两个关闭守卫（字幕的、常驻的）谁先装不一定：字幕会话结束时只摘自己，被包着就把自己从链上剪出去，否则会连常驻守卫一起摘掉或让链断在已释放对象上 —— 来源「docs/learning-design.md:4247-4248」
- PIT-65 系统翻译的联网键必须写在宿主 App 的 Info.plist；写在扩展的 plist 里无效（所有请求一律报网络不可达），写对后系统会在第一次使用时自己弹一页告知 —— 来源「docs/learning-design.md:4235-4237」
- PIT-66 `speak()` 没抛错不代表出声：iOS 对手势外的 `speechSynthesis.speak()` 静默忽略（无异常、无错误事件、无声）；只有 utterance 的 `start` 事件触发才算开始播放 —— 来源「docs/learning-design.md:2207-2214」
- PIT-67 有些面在 macOS App 里根本不渲染（AX 树里没有那一行，滚动也不改变树），别据此断定功能缺失；试听那一行就是一例 —— 来源「docs/device-verification.md:265-275」

## 8. 监督方规矩（SUP）

- SUP-01 用户可见的交互、文案、布局改动，必须先出 Pencil 稿，不出 OD 稿；纯内部的排障界面不需要稿。Pencil 稿由 pen.dev 自带的 AI 设计，我们只写需求、负责审稿。所有设计稿都收进 git。（用户口头规定，2026-10-12 重申；pen.dev AI 出稿自 2026-10-12 起）
- SUP-02 语言名一律用该语言自己的文字写本名。（用户口头规定，2026-10 起）
- SUP-03 不推送、不合并发版分支、不提审、不传浏览器扩展，不让模型读到密钥。只有 ASC 读回 VALID 才能说已经在 TestFlight。（用户口头规定，2026-10-12 汇总）
- SUP-04 被 guard 拦或审批被拒，就停下来报告，不许拆命令、换工具、改写法绕过。（用户口头规定，2026-10-12 重申）
- SUP-05 同类问题反复出现时不要边修边试：先停手，定位根因，写解法提案交用户评审，通过后再改。问题只剩阈值层面时不再反复调，直接放行。（用户口头规定，2026-10 起）
- SUP-06 发版基线是 1.19.3，基线文件 `docs/release-baseline-1.19.3.md`。不比基线差就可以发版；P-12 在这台 Mac 上是已知会挂的项（`test:mac` 的 M8/M9 也因权限 EPERM 不通，见基线文件）。（用户口头规定，2026-10-11 12:57；P-12 放行 2026-10-12）
- SUP-07 修 bug 先写会失败的测试，要拿实际的原生调用链证实根因。（用户口头规定，2026-10 起）
- SUP-08 真机测试只临时取消静音，测完恢复音量 88、静音。识别语言名额每个 App 最多 5 门，测试前要确认只占着 zh-CN、en-US、th-TH，测完要恢复。（用户口头规定，2026-10-12）
- SUP-09 自动化验收走 Debug 包自带的测试端点。录屏效果验收由监督方从全新安装开始做。执行时整单一次跑完，进度写日志，不依赖监督方逐步派活。（用户口头规定，2026-10-11/12）
- SUP-10 方案和回归用例由监督方设计，改代码、测试、回归、打包、上传 TestFlight 由 dsh 全包。每次报告开头写明实际用的模型，并列出这次依据了哪些规约条目。（用户口头规定，2026-10-12）
- SUP-11 只是文字里出现敏感字样触发 guard 误拦时，改成抽象措辞继续不算绕过；但前提是先停下、由监督方确认之后才能改。（用户口头规定，2026-10-12 11:38）

## 9. 矛盾与过时（已处理）

> 用户 2026-10-12 11:38 已批准以下处理口径，本单已在源文件按口径改掉；行号为**改完后**的当前行号，来源已重新核对。只改文档类文件，未改代码 / 脚本 / 配置。

- CON-01 Pencil 出稿方式冲突 —— **已处理**：`.claude/skills/pencil-draft/SKILL.md:15-34` 新增 §0「出稿主路径：pen.dev 自带 AI」（写需求 → `npx @pen.dev/cli --in/--out/--prompt` 出稿 → 审稿 → 不合要求打回重画、**最多 3 轮**）；原「自己用 MCP 逐条画」降为 `.claude/skills/pencil-draft/SKILL.md:36-94` 的排查 / 微调**备用手段**，画布硬坑保留；同口径写进 `AGENTS.md:157-165`、`docs/release-checklist.md:27-29`。
- CON-02 影子技能根 —— **已处理**：`AGENTS.md:300` 与 `CLAUDE.md:33-37` 补例外——用户目录 `~/.agents/skills/` 下**指向仓库 `.claude/skills/` 的符号链接是允许的**（为了让 dsh 自动发现技能，2026-10-12）；仓库里的 `.agents/skills` 仍须为空 / 不存在。
- CON-03 发版 / 提审 / 推送流程冲突 —— **已处理**：`.claude/skills/store-release/SKILL.md:28-48` 新增「阶段闸门：提审 / 推送 / 传扩展 / 发 Release **默认禁止**，只有用户**当次明确授权**才能做」，并在对应步骤 `.claude/skills/store-release/SKILL.md:362-364`（§8 提审）、`:380-382`（§9 撤审）、`:403-405`（§10 两店扩展）、`:464-466`（§11 GitHub Release + 官网）各加禁令；`docs/release-checklist.md:16-21`（顶部闸门）与 `:82-84`（§2 推送）同口径。**只上传 TestFlight 不在禁止之列**，但「已在 TestFlight」只以 ASC 读回该 build 为 `VALID` 为准。
- CON-04 OD 稿与历史设计工具 —— **已处理**：`AGENTS.md:139-141`、`docs/release-checklist.md:27-29`、`docs/interaction-spec.md:1431`、`:1492`、`:2610`、`:2616` 的 OpenDesign / OD 字样统一标为「**2026-10-08 之前的历史工具**，不要据它实现任何界面」，纯历史记录保留不删；`.claude/skills/pencil-draft/SKILL.md:12-13` 保持「禁止 Open Design / OD」。`design/pencil-archive:design/pencil/INDEX.md` 不在本单允许改的文档类内，未动。
- CON-05 旧版本号与旧商店状态 —— **已处理**：`AGENTS.md:448-452`（macOS 1.4.0/1.4.1/1.4.2 模板页事故）、`AGENTS.md:470-472`（`MARKETING_VERSION` 停在 1.0）、`docs/release-checklist.md:35-38`（08-01 / 08-08 商店状态表）都标成「**历史读数，已过时**」，现行以 `docs/release-baseline-1.19.3.md` 与 gbrain / ASC 回读为准；历史记录一条没删。
- CON-06 旧测试计数 —— **已处理**：`docs/verification-spec.md:3289`（1635，标 2026-09-11 历史读数）、`docs/verification-spec.md:3478`（2294，标 2026-09-28）、`docs/device-verification.md:420`（2382，2026-10-04）、`:495`（2384）、`:517`（2386）、`:541`（2387，2026-10-05）全部标成带日期的历史读数，并指向现行基线 2628/2628（`docs/release-baseline-1.19.3.md:8`）。
- CON-07 旧 Node 下限 —— **已处理**：`docs/amo-build.md:10-12` 按 `CLAUDE.md` 分档改写——构建与真 Chrome 门 **≥22**，`npm test` **≥20**，`package.json` engines ≥20。
- CON-08 旧 VM 位置（Windows 测试）—— **已处理**：`.claude/skills/win-matrix/SKILL.md:3`、`:6`、`:17-32` 目标改为**现行是 Omarchy 上的 Windows VM**（Edge / Chrome / Firefox 都在那台测；需要人工介入就放弃该项并如实记 ⬜），VMware Fusion 那段标「历史」保留；`docs/verification-spec.md:1335-1352`（§H 标题与目标段）、`CLAUDE.md:53-60` 同口径改写。
- CON-09 中国版「一个字节都不发」 —— **2026-10-29 再改（BEL-135）**：用量白名单与国际版相同，入口境内；诊断通道仍不含原文和译文。现行文在 `docs/telemetry-design.md` 原则 6、`docs/decisions.md` §2.4、`AGENTS.md` 规则 4 的 2026-10-29 注。`docs/china-backend-cost.md:30` 未改——那句指同步（未登录不上传），不是遥测。
- CON-10 云端实时「待人评审」与已落地的删除 —— **已处理**：`docs/domain-design.md:254`、`docs/domain-design.md:1309`、`docs/verification-spec.md:725`、`docs/telemetry-design.md:294` 四处旧口径标注「**已被 `docs/verification-spec.md` §3.1.5 与 `docs/learn-regression.md` M22 / M23 的作废记录取代**（设备内置识别是唯一路，云端实时条目已删）」，不删。
- CON-11 提供方清单被复述 —— **已处理**：`CLAUDE.md:100-103` 删掉复述，改为指向唯一注册表 `build/providers.config.js` → `content/providers.gen.js`，并说明「不再在此复述」。
- CON-12 oauth-design 整篇过期 —— **已处理**：`docs/oauth-design.md:3-8` 文件开头加醒目标注「**已过期（2026-10-12）：仅作历史，订阅认证以 `docs/subscription-auth-research.md` 为准**」，正文与 2026-09-09 复核记录保留不删。
- CON-13 播客锁屏 / 后台播放的否决记录 —— **已处理**：`docs/learning-design.md:4778` 的否决行标注「**已被 `docs/learning-design.md` §9.5「后台与锁屏播放」取代**（推翻于 2026-08-24），本行只作历史」，不删。
- CON-14 浏览器语音识别的旧口径 —— **已处理**：`docs/learning-design.md:4717` 的「permanently out」标注「**已被 `docs/learning-design.md` §9.4 与 §12 的 2026-08-12 三审收窄取代**：否定的是「录音离开用户自选端点」，不是「一切 ASR」；「学习层永不转写页面音视频」仍然成立」，不删。

## 统计

- 交互和文案（UX）：30 条
- Pencil 稿规矩（PEN）：21 条
- 测试和回归（TST）：25 条
- 真机和录屏验收（DEV）：25 条
- 发版和 TestFlight（REL）：30 条
- 禁止事项（BAN）：38 条
- 各类已知坑（PIT）：67 条
- 监督方规矩（SUP）：11 条
- 矛盾与过时（CON，已处理）：14 条
- 总条数：261 条
