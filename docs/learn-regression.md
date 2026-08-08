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
| 调度器 | `learn-scheduler.test.js` | applyReview 单调性、previewIntervals 等价、practiceOutcome 不对称（错=lapse / 对=null / 候选=null）、tierFor 边界 4/30、buildDeck 池子/弱先/日上限 |
| 数据模型 | `learn-model.test.js` | clozeFor 可还原+确定性、clozeCheck 归一化、mergeItem skills 并集幂等 |
| 句子解析 | `learn-notes.test.js` | 能力门按 type、解析器防不可信输出、**一卡至多扣一次费**（调用计数）、两种线格式 |
| 同步 | `learn-sync.test.js` | 推拉水位、配额如实报错、autoSync 节流/静默/并发去重、拉下来的不许推回去 |
| 语音 | `learn-tts.test.js` | pickVoice 语言匹配、und 单列 reason（available 与 speak 两个决策点）、缓存二次播放零请求 |
| 块格式 | `learn-chunk.test.js` | 往返无损、replay 幂等、复习记录带 mode/practice 通过重放 |
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
| 4 | und 卡 | 播放禁用、提示指路到**我们的**语音设置（不是系统设置） |
| 5 | 评分落库 | 「记得」后 s 上升、对应技能徽章点亮（读 IndexedDB，不信界面） |
| 6 | 做完态 | 练习入口出现（死路已removed） |
| 7 | 自由练习 | 答错 → sched 打回；答对 → sched 一字不动（§5.3 不对称）；候选不建 sched；练习记录带 practice/mode |
| 8 | 句子解析 | 门随 configure 即刻打开、mock 引擎结果渲染生词、结果落缓存 |
| 9 | App 设置页 | 标签全非空、语音选择器装入系统语音（仅 App 宿主） |
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
| M2 | autoplay 拦截如实 | iPhone App/Safari | 听懂档自动播被 iOS 拦下时不喊错，▶ 一点即播（spec：拦截静默处理） |
| M3 | OpenAI Speech 真调用 | iPhone App | 引擎选 OpenAI + 真 key → ▶ 出声；再播同句不再扣费（抓请求或看用量） |
| M4 | 解析真调用 | iPhone App | 贴真 key → 解析这句 → 生词/短语/语法渲染；重看即时出（无第二次请求） |
| M5 | 自动同步端到端 | Safari 采集 + App | 浏览器采集 → 开扩展复习页（上推）→ App 回前台（拉取）→ 进复习见新卡，全程零手动同步；再同步一次收敛 0/0 |
| M6 | 阶梯升降真机手感 | iPhone App | 认读→听懂→产出随强度切换；阈值 4/30 手感不对就调（设计文档标了「调整便宜」） |
| M7 | TestFlight 特查 | ASC | 新 build 处理完 **必须手动加进「天使」组**（16 的教训）；出口合规无警告 |
| M8 | 深浅色两查 | iPhone App | 深色模式下全部按钮/文字可读（表面扫描只跑浅色引擎） |

## 4. 治理

- 学习面（`learn/**`、`content/learn-*`、`app/**` 的复习相关）改动 ⇒ `npm test` +
  `test:learn` + `test:app` 必跑；碰 DB_VERSION 加 `test:idb`。
- 真机新 bug ⇒ 先归类到层（逻辑/引擎/平台），在对应层补一条**先红后绿**的用例，
  再修 —— 修完顺手做变异验证。
- 本文档与 runner 同 PR 演进：加步骤先加文档行。
