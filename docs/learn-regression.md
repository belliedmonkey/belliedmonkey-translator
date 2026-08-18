# 学习套件回归用例（learn regression suite）

> 隶属 [`verification-spec.md`](verification-spec.md)（验证的唯一真源）§3.1.3。
> 这份文档回答一个问题：**学习套件改动后，怎样才算「全面测过了」。**
> 每条用例标注它的载体 —— 自动化的写明跑哪条命令，自动化覆盖不了的写明真机步骤。
> 新发现的 bug 一律先在这里补用例（红），修复后转绿 —— 与 §3.2 布局语料的
> 增量适配契约同一条纪律。

## 0. 为什么纯逻辑套件不够（本文档的存在理由）

真机连续暴露的 bug 全是一个形状：**逻辑是对的，表面是坏的**。绿字绿底的播放按钮
（App 壳 CSS 压在 review.css 下面）、永远关着的 ttsMode（没人写过那个键）、指错路
的报错文案（und 卡让用户去 iOS 设置找语音）。vm harness 里没有 CSS、没有存储竞速、
没有布局 —— 这些 bug 一个都测不到。所以回归分三层，各管各的盲区：

| 层 | 载体 | 管什么 | 管不了什么 |
|---|---|---|---|
| 纯逻辑 | `npm test`（vm harness） | 调度数学、合并语义、解析器、协议形状 | 一切渲染、存储实现、宿主差异 |
| 真实引擎 | `npm run test:learn` / `test:app` / `test:idb` / `test:layout`（真 Chrome） | DOM、CSS 级联、IndexedDB、双宿主流程 | 真声音、真网络、真触摸、WebKit 特有行为 |
| 真机矩阵 | cua-driver + 模拟器/真机（§2 的配方） | 平台真实行为（autoplay 拦截、WKWebView 怪癖、TestFlight） | 无 —— 但贵，只兜底 |

## 1. 纯逻辑（`npm test`，每次推送必跑）

现有断言的领域索引（文件即用例清单，此处只列覆盖面）：

| 域 | 测试文件 | 关键性质 |
|---|---|---|
| 调度器 | `learn-scheduler.test.js` | applyReview 单调性、previewIntervals 等价、practiceOutcome 不对称（错=lapse / 对=null / 候选=null）、tierFor 边界 4/30、buildDeck 池子/弱先/日上限；§5.4：pickSkills 最久未验证优先 / legacy `1` 排最前 / 能力过滤 / ≤2 且第二个仅过窗时、skillFresh 随强度伸缩（legacy `1` 恒过窗）、fullyMastered 缺能力语义、extra 行不消耗每日预算 |
| 数据模型 | `learn-model.test.js` | clozeFor 可还原+确定性、clozeCheck 归一化、知识点挖空（§5.4：答案⊆目标、seed 轮换被挖点、目标不在句中回落经典、重叠目标不出重叠空、CJK 短语、大小写不敏感匹配但答案保留句中原样）、mergeSkills 逐键 max 幂等可交换（legacy `1` 输给真时间戳、重放不放大） |
| 题型生成 | `learn-exercises.test.js` | pickExercise 同 (id,reps,skill) 确定且跨 reps 轮换、AI 变体仅门开时入轮换、mcqFrom 答案恰一次/排归一等值干扰、listenPickFrom 正确⊆句/干扰∩句=∅（含子串）、speakScore 密疏两路+漏读点名、gradeGate 与挖空规则对齐 |
| 题包 | `learn-pack.test.js` | 能力随解析引擎门、干扰项复述译文被拒（等值+包含双向）、句内词/子串不作听力干扰、理解题结构校验、accept 键必须句内且替代≠原词、部分题包逐项降级/全废 bad_output、**每卡每 PACK_VERSION 至多一次扣费**（调用计数）、并发去重、缓存写失败不重扣 |
| 语音输入 | `learn-speech.test.js` | CORS/网络拒绝具名为 `network`（不吞成通用错）、baseUrl 尾斜杠不产生双斜杠、capable() 各门控（引擎条件 × mic API 存在）、multipart 构造（und 永不硬报语言、Bearer 仅在有 key、模型默认值来自注册表）、每条路径都释放麦克风轨道、JSON 与 text/plain 响应、具名错误码（no_base/no_key 不发请求、http 带 status、empty_transcript） |
| 句子解析 | `learn-notes.test.js` | 能力门按 type、解析器防不可信输出、**一卡每提示词版本至多扣一次费**（调用计数；版本升级只为纠错，见 learning-design §9.2）、生词必须逐字来自原句（v2 提示词 + 零匹配判 bad_output）、并发去重、缓存写失败不重复扣费、两种线格式 |
| 同步 | `learn-sync.test.js` | 推拉水位、配额如实报错、autoSync 节流/静默/并发去重、拉下来的不许推回去 |
| 语音 | `learn-tts.test.js` | pickVoice 语言匹配、und 单列 reason（available 与 speak 两个决策点）、缓存二次播放零请求 |
| 块格式 | `learn-chunk.test.js` | 往返无损、replay 幂等、复习记录带 mode/practice 通过重放 |
| 播客模式 | `learn-driving.test.js` | §9.5：播放顺序（随机是**排列**不是抽样、绕圈重洗、顺序播放会结束而其余三种不会、下一张在单曲循环里也能跳走）、**一张卡三遍**（含解析 `[s1,s2,tr2,n2,s3]`、关解析、无译文时三遍都是原句、每段带 pass、原句恰好三次）、`notesToSpeech`、`reduce` 走查（三遍连走后推进、解析段取→播→推进、整机级失败停下 vs 单卡级失败跳过、暂停记住段号、换模式不打断音频）、**暂停时按需解析**（只从暂停进、读完回暂停且 seg 原样带回、空/失败都回暂停并具名、按需朗读期间下一张先停音频）、**以及反向断言：模块表面没有任何写进度的函数** |
| 文案纪律 | `no-hardcoded-copy.test.js` | CJK 字面量只许在 t() fallback 位（逐出货文件） |

**纪律**：每条新断言做变异反向验证（杀不死的变异 = 测试缺口，先补齐再合并）。


## 2. 真实引擎（改动学习面必跑）

### 2.1 `npm run test:learn` —— 双宿主全流程走查（本套件的主干）

同一份 review.js 字节，两个宿主各跑一遍完整循环 —— App（dist-app 出货布局 +
壳 CSS 级联）与扩展复习页（dist/learn/review.html + chrome 垫片）。种子语料一张卡
一个档位：认读（s=1.5）、听懂（s=10，mock 英语语音）、产出（s=60）、und 卡、候选卡。

| # | 步骤 | 断言 |
|---|---|---|
| 1 | 种子后重建牌组 | 首卡出现、计数行非空 |
| 2 | 产出档 | 先见译文、挖空输入在、检查前评分隐藏；全对后「不记得」被禁用（客观结果约束评分） |
| 3 | 听懂档 | 原文先隐藏、「显示原文」与播放按钮有字；点开原文 → 答案 → 评分 |
| 3a | 盲听选词（§9.3，种子钉 reps 保证出现） | 原文在确认前不露、选项 ≥3 且非空；全对确认后原文出现、「不记得」被禁用 |
| 3c | 说题卡（§9.4，speak1 种子 + mock 转写端点 + 页内 stub 麦克风） | 原句可见（朗读非回忆）；录→停→「识别中」→transcript+匹配度渲染；完美朗读禁用「不记得」；复习行带 `mode:'speak'` |
| 3b | 译文选择题（§9.3，种子钉 reps 保证出现） | 题干与选项非空；选对后答案面出现、「不记得」被禁用（客观结果约束评分） |
| 4 | und 卡 | 播放禁用、提示指路到**我们的**语音设置（不是系统设置） |
| 5 | 评分落库 | 「记得」后 s 上升、对应技能**时间戳**落库（读 IndexedDB，不信界面） |
| 5.5 | 同卡第二题（§5.4） | extra-note 出现过；extra 行带 mode 不带 practice；listen1 的 reps 恰 +1（第二题不推进排程）；第二题通过刷新技能时间戳 |
| 6 | 做完态 | 练习入口出现（死路已removed） |
| 7 | 自由练习 | 答错 → sched 打回；答对 → sched 一字不动（§5.3 不对称）；候选不建 sched；练习记录带 practice/mode |
| 8 | 句子解析 | 门随 configure 即刻打开、mock 引擎结果渲染生词、结果落缓存 |
| 9 | App 设置页 | 标签全非空、语音选择器装入系统语音（仅 App 宿主） |
| 10 | 播客入口门控（§9.5，仅 App 宿主） | mock 音色在 ⇒ 「播客模式」入口出现；无音色 ⇒ 入口**不存在**（门控而非禁用） |
| 10a | 播客自动连播 + **零写入** | 顺序播放走完一整轮：**三遍结构**（原句/原句/译句…，第一张卡的原句被读满三次）、播放段数 ≥ 卡数×4；跑完 IndexedDB **零新复习行**、`sched`/`skills` 一字不动（load-bearing 反向断言） |
| 10b | 播放模式按钮 | 点一下换模式、落盘到 `drivePlaybackMode`、且 `LearnTTS.stop` 调用次数不变（**不打断正在播的音频**） |
| 10c | 随机是排列 | 切随机后 `order` 是 0..n-1 的一个排列（无重复无遗漏）—— 「每次随机抽一张」会在这里露馅 |
| 10d | 播放解析 + 自动补全 | 清空所有 notes 后（解析默认开）：未解析的卡触发解析请求、解析文本被 speak、播放中常驻行显示费用提示；且该会话仍**零复习行** |
| 10d′ | **解析引擎没配 ⇒ 必须说话** | **先清掉 `provider`/`apiKey`** 再开开关：断言 `playNotes && !notesOk`、常驻行有具名说明、且**没有发出任何解析请求**。这是 2026-08-17 那次真机缺陷的回归用例——原来的 10d 抓不到它，因为它在打开开关的同一次写入里把引擎也配好了 |
| 10d″ | 暂停时按需解析 | 暂停 ⇒ 「解析这句」按钮出现；点了之后解析被读出来、文字显示、**状态回到 paused 且 seg 不变**（seg 丢了「继续」会跳段） |
| 10e | 播客暂停 | 暂停 ⇒ `LearnTTS.stop` 被调，此后零写入；恢复须手点 |
| * | **每步表面扫描** | 可见 button/a/select：文字非空 **且前景色≠背景色**（绿字绿底类 bug 整类击杀） |

### 2.2 其余真实引擎门禁（既有，此处挂名）

- `test:app`：App 壳两发布态渲染、模块齐全、解析 live-gate、双注册表选择器计数（§3.1.1）
- `test:idb`：DB_VERSION 迁移，唯一碰用户已有数据的改动（§3.1.2）
- `test:layout`：内容脚本布局语料（§3.2）

## 3. 真机矩阵（发版前 / 学习面大改后，§2 配方驱动）

自动化覆盖不了的平台真实行为，逐条人工/半自动过：

| # | 用例 | 面 | 步骤与预期 |
|---|---|---|---|
| M1 | 真声音出来 | iPhone App | 设置选英语语音 → 复习页 ▶ → 有声；und 卡先指路、选完语音后可播 |
| M1′ | **WKWebView TTS 冒烟（半自动，模拟器）** | iOS 模拟器 App | cua-driver 驱动：升级安装当前构建（保登录态与语料）→ 设置：断言「朗读语音」列出**真实 iOS 语音**（WKWebView 的 getVoices 真通，测不了 mock）→ 选一个英语语音 → 复习页 ▶ → 断言按钮转「▶ 再听一遍」且无错误提示（utterance 的 `start` 事件真的来了 = WebKit 真在合成；iOS 静默吞掉 speak 时按钮不会变、会报 blocked——这正是 tts.js 等 start 的设计在验证自己）。不用插耳朵即可回归到手机侧最后一层；真发声仍归 M1。**首跑 2026-08-08（iPhone 17 Pro 模拟器 · iOS 26.5）全过**：真实语音表载入（Tingting/Daniel/Anna…）、选 Daniel (en-GB) 即刻生效、und 卡（真实 Safari 采集语料）按钮由禁用+指路文案转为可播、▶ 后转「再听一遍」。同一趟顺带在真 WKWebView 实证了绿字绿底修复与 und 指路文案 |
| M2 | autoplay 拦截如实 | iPhone App/Safari | 听懂档自动播被 iOS 拦下时不喊错，▶ 一点即播（spec：拦截静默处理） |
| M3 | OpenAI Speech 真调用 | iPhone App | 引擎选 OpenAI + 真 key → ▶ 出声；再播同句不再扣费（抓请求或看用量） |
| M4 | 解析真调用 | iPhone App | 贴真 key → 解析这句 → 生词/短语/语法渲染；重看即时出（无第二次请求） |
| M5 | 自动同步端到端 | Safari 采集 + App | 浏览器采集 → 开扩展复习页（上推）→ App 回前台（拉取）→ 进复习见新卡，全程零手动同步；再同步一次收敛 0/0 |
| M6 | 阶梯升降真机手感 | iPhone App | 认读→听懂→产出随强度切换；阈值 4/30 手感不对就调（设计文档标了「调整便宜」） |
| M7 | TestFlight 特查 | ASC | 新 build 处理完 **必须手动加进「天使」组**（16 的教训）；出口合规无警告 |
| M8 | 深浅色两查 | iPhone App | 深色模式下全部按钮/文字可读（表面扫描只跑浅色引擎） |
| M9 | 真麦克风门控（§9.4）**✅ 2026-08-13 模拟器实证** | iPhone App + iOS Safari 扩展页 | 实测通过：App 里配好转写引擎后**说徽章出现**（capable() 在真 WKWebView 为真）、iOS 麦克风授权弹窗正常弹出并可授权；WebKit `isTypeSupported('audio/mp4')`=true，选中 m4a 符合设计。**模拟器无法完成真录音**：授权后拿到的音轨立刻 `readyState=ended`、MediaRecorder 产出 0 字节（Simulator 无可用音频输入，非代码问题——原始 MediaRecorder 诊断确认 `dataavailable` 先于 `stop`，出货代码在 onstop 读 chunks 的假设在 WebKit 成立）。**真录音改到真机上做。** 原步骤：| App：配转写引擎 → 说题出现 → 🎙 触发系统麦克风授权（`NSMicrophoneUsageDescription` 来自 app:sync 补丁）→ 授权后可录；扩展页：iOS Safari 扩展页 getUserMedia 历史受限——预期表现为**说档不存在**（能力门控），绝不是报错或死卡 |
| M10 | 真转写端到端（§9.4）**⚠️ 部分完成** | iPhone App | 已证：出货 speech-input.js 在真 WebKit 里跑通到上传（服务器实收并处理），**且揪出真 bug——自建端点缺 CORS 时 WebKit 在读状态码前就判死 fetch，只抛裸 TypeError**（已修：具名 `network` + 文案点出可达性与 CORS + 尾斜杠裁剪）。**未证**：真语音→真 transcript→匹配度（模拟器无麦，见 M9）。原步骤：| Safari 的 MediaRecorder 出 mp4/m4a 容器 → 发真 whisper 兼容端点（本地起一个即可）→ 有 transcript、有匹配度；文件扩展名与容器不匹配是常见断点，必须真测。macOS App 的 `com.apple.security.device.audio-input` entitlement 由 `app:sync` 的 pbxproj 补丁写入（`ENABLE_RESOURCE_ACCESS_AUDIO_INPUT`，2026-08-12 已实证进入签名后的 entitlements）——工程重新生成后记得重跑 app:sync |

| M11 | 播客连播真跑（§9.5） | iPhone App | 进播客模式 → 多张卡连续朗读**无需逐句手势**；**三遍节奏的听感**（会不会太啰嗦——若过头先退第三遍）；四种播放顺序各切一次、行驶中按模式键不打断音频；**解析引擎没配时那句说明真的出现**（2026-08-17 漏掉的正是这个场景）；暂停 → 「解析这句」 → 读完回到暂停；整机级 TTS 失败停在具名原因上，单卡级失败跳过并说明 |
| M12 | ~~TTS→麦克风交接~~ | — | **已作废（2026-08-18）**：跟读题从播客模式移除，麦克风完全不参与这个模式。音频会话交接不再是这条路径上的风险面 |
| M13 | 屏幕常亮 + 音频路由 | iPhone App | 播客会话中屏幕不自动锁（idle-timer 补丁生效）；蓝牙/CarPlay 路由下声音走车机（sanity，不追求完美）；来电/切后台落在暂停态，恢复须手点 |

## 4. 治理

- 学习面（`learn/**`、`content/learn-*`、`app/**` 的复习相关）改动 ⇒ `npm test` +
  `test:learn` + `test:app` 必跑；碰 DB_VERSION 加 `test:idb`。
- 真机新 bug ⇒ 先归类到层（逻辑/引擎/平台），在对应层补一条**先红后绿**的用例，
  再修 —— 修完顺手做变异验证。
- 本文档与 runner 同 PR 演进：加步骤先加文档行。
