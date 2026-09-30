# CLI 学习计划 —— 详细设计与实施计划

> **状态：提案 · 待人评审 · 待主干同步后重评。**
> 这是 CLI（命令行宿主）「可高度自定义的学习计划」的设计与实施计划，**尚未实现**。
> 每条设计决策旁标 **[可重议]**，方便主干同步后重新审视。若最终采纳，权威文本应并入
> `docs/learning-design.md` §9.11（新）与 §9.10，以及 `docs/interaction-spec.md`「命令行」。
> 相关：`docs/domain-design.md` §2.7 / §9、`docs/verification-spec.md` §3.1.13。

参考对象：本仓库现状（CLI 已落地 Phase 1–4：翻译、语料、复习、同步、文档/字幕/批量、
`bm setup` 引导领额度）。本计划只在其上加「学习计划」与「出题自定义」。

---

## 0. 前提与现状

- CLI 已有命令：`setup translate detect doc subtitle batch providers plan review import export login logout whoami sync config`。
- 现有 `plan` 只读打印今日牌库；`review` 交互式（read + write 填空档）。
- 现有调度 / 模型 / 题型 / 题包（**复用，不重写**）：
  - `extension/content/learn-scheduler.js`（`buildDeck` / `buildDeckAhead` / `pickSkills` / `applyReview` / `DEFAULTS`）
  - `extension/content/learn-model.js`（`splitPair` / `makeItem` / `clozeFor` / `clozeCheck` / `mergeSkills` / `touchedAt`）
  - `extension/content/learn-exercises.js`（`pickExercise` / `mcqFrom` / `listenPickFrom` / `gradeGate`）
  - `extension/learn/exercise-pack.js`（`PACK_VERSION` / `buildPrompt` / `parsePack`）
  - `extension/learn/notes.js`（`LearnNotes.chat`，聊天传输的唯一出口）
- 现有唯一的用户级「计划旋钮」是 **`learnDailyNew`**（`src/store/schema.js`），被扩展 / App / 复习页使用；**CLI 尚未接线**（`cli/plan.js`、`cli/review.js` 用死 `DEFAULTS`）。

---

## 1. 目标与范围

**目标**：让 CLI 用户（以及用户的 AI agent）能**高度自定义**自己的复习计划：
每天学哪些句子、语言、题型偏好、出题逻辑，乃至题目本身。

**范围**：

- 计划是 **CLI 专属**工件；**App / 扩展零改动**。
  - 「拿 App 复习」指的是**语料与复习历史**照旧经服务器同步，App 用它**自己的设置**复习。
  - 不做「App 读同一份计划」；那是更大的一条路（需把计划做成可同步物），本计划不做。
- 不做**全新题型渲染器**：自定义只在**现存题型**（`read`=recall/mcq、`write`=cloze、
  `listen`=listen-recall/listen-pick、`speak`）内选择并扩充其**素材**。全新渲染器留「第三刀」。

---

## 2. 决策清单（已确认）

| # | 决策 | 备注 |
|---|---|---|
| 1 | 计划只服务 CLI；App/扩展零改动 | 语料/复习历史仍同步 |
| 2 | 计划文件默认 `~/.config/belliedmonkey/plan.json`，`--plan` 可覆盖 | 与 config/state 同目录 |
| 3 | 第一刀 `selection + schedule + skills`；第二刀 `generator + questions` | 分阶段 |
| 4 | 并发：建议锁 + 临时文件原子写；冲突退出 **5/`busy`**；陈旧锁自动回收 | 我裁定 |
| 5 | 第二刀边界：只扩数据 + 选现存题型，不造新渲染器 | 第三刀另议 |
| 6 | `pack`（AI 题包）**默认关**；只有 plan 显式开才跑，`prefetch` 先报花费 | 防静默扣费 |
| 7 | `command` 缓存**默认开**（按 `itemId+command`），`cache:false` 可关 | |
| 8 | 「删除题目」：`questions[id]:null` 停用该卡**生成题**、回落 `local`；`bm questions clear` 清缓存。整卡不进牌库用 `selection.excludeIds` | 第二刀不做「跳过单题」 |
| 9 | `file/command/questions/pack` 统一过 `LearnExercisePack.parsePack` 校验，**无第二校验器**；失败只回落 `local` | 不可信输入原则 |
| 10 | 题目缓存是**本地衍生物**，绝不进 `corpus.mtlearn`、绝不同步 | 同 §9.2/§9.3 |

---

## 3. Plan 模型 `mt-plan/1`（全字段）

> 第一刀实现：`selection` / `schedule` / `skills`。
> 第二刀实现：`exercise` / `questions`。
> 第一刀时，plan 里出现 `exercise`/`questions` 不报错，但 `bm plan validate` 明确报
> 「本版本未启用」，`plan`/`review` **忽略它们**（不静默假装生效）。

```jsonc
{
  "format": "mt-plan/1",
  "name": "英语冲刺",
  "updatedAt": 0,

  // ── 第一刀：选哪些句子 ─────────────────────────────────────────────
  "selection": {
    "langs": ["en"],                    // [] = 全部（≠ targetLang 的语言）
    "sources": { "include": ["en.wikipedia.org"], "exclude": ["x.com"] },
    "states": ["candidate", "learning"], // 允许的状态；空 = 全部非 muted
    "starredOnly": false,
    "minSalience": 0.45,
    "includeIds": ["<卡片id>"],          // 显式点名（最高优先）
    "excludeIds": [],
    "query": "lang:en salience>=0.5 -source:x.com star:optional"
  },

  // ── 第一刀：配额 / 混比 / 间隔（“优化计划”的旋钮；只是配置，不造第二张时间表）──
  "schedule": {
    "dailyNew": 10,                      // = learnDailyNew
    "deckSize": 25,
    "mix": { "due": 0.7, "fresh": 0.2, "known": 0.1 },
    "targetR": 0.9,
    "knownResurfaceR": 0.95,
    "maxPerSource": 3
  },

  // ── 第一刀：题型偏好（能力门控仍生效）──────────────────────────────
  "skills": {
    "allowed": ["read", "write"],        // 只考这些（listen/speak 仍需能力）
    "order": ["write", "read"],          // 覆盖默认轮换序
    "weights": { "write": 2, "read": 1 },
    "tiers": { "writeS": 30, "listenS": 4, "speakS": 4 }
  },

  // ── 第二刀：题目从哪来 ───────────────────────────────────────────
  "exercise": {
    "generator": "local"                 // | "pack" | { "file": "q.json" } | { "command": "…" }
    , "prompt": "…"                      // generator=pack 时的自定义提示词（换哈希 ⇒ 换缓存）
    , "ai": { "enabled": false, "maxCallsPerSession": 5 }
    , "cache": true                      // command 结果缓存开关
    , "timeoutMs": 10000
  },

  // ── 第二刀：显式题目（逐卡覆盖；null = 停用该卡生成题，回落 local）──
  "questions": {
    "<卡片id>": { "mcq": { "distractors": ["…","…","…"] },
                  "comprehension": [{ "q": "…", "options": ["…","…"], "correct": 1 }],
                  "accept": { "word": ["…"] } },
    "<卡片id2>": null
  }
}
```

**预估的第一刀最小 schema**：`format` / `name` / `selection` / `schedule` / `skills`。

---

## 4. 边界与不变量（不得破坏）

- **一次到期，一条曲线**：`schedule` 只是调度器配置（合并进 `buildDeck`），绝不制造第二张时间表。
- **能力门控**：`listen`/`speak` 需要 TTS / 麦克风（CLI 没有）；`skills.allowed`/generator 不能
  让「不存在的题型」出现（§5.2）。
- **采集仍是 sink**：计划/题目生成都不改译文、不反向影响翻译输出（domain-design §9.1）。
- **题包是衍生物**：AI/外部题目缓存设备本地、可再生成、**永不同步**；`corpus.mtlearn` 只装
  cards/reviews/dels/rules。
- **语料不可变**：`text`/`tr`/`anchor` 创建后不可变；外部题目不得改它们。

---

## 5. generator 约定（第二刀）

### 5.1 来源与优先级

```
questions[itemId]（plan 内联显式；null 表示停用生成题）
      > generator（file / command / pack）
      > local（内置，永远免费兜底）
```

任一步产不出可用数据 → 回落 `local`，**绝不挡复习**，并计数。

### 5.2 统一校验（关键：无第二校验器）

`file` / `command` / `questions` / `pack` 产出**一律**经
`LearnExercisePack.parsePack(JSON.stringify(raw), item)`（把 JSON 变回文本喂进同一校验器）：
- `mcq.distractors` 归一化后不得等于/包含 `item.tr`
- `listen.foils` 不得出现在原句
- `comprehension` 选项 2–4 个、`correct` 在界内
- `accept` 键必须逐字来自原句、替代答案归一化后 ≠ 键
违规逐项丢弃、部分可用照用；全废 ⇒ `bad_output` ⇒ 回落 `local`。

### 5.3 `pack`（AI）

- 复用 `LearnExercisePack.buildPrompt(explainLang)` 与 `PACK_VERSION`；`exercise.prompt` 给了就用它。
- **默认关**：只有 `generator:"pack"` 且 `exercise.ai.enabled:true` 才跑。
- 缓存键 = `itemId + PACK_VERSION + promptHash`；每键至多一次调用；`ai.maxCallsPerSession` 封顶。
- 聊天传输复用 `LearnNotes.chat`（经 `cli/entry.js` 暴露的 `chat(system,user)`）；无 chat 引擎 ⇒
  能力门关，具名 `no_engine`，回落 `local`。
- `bm questions prefetch`：生成前打印「将调用 N 次、估算花费」，再执行（§9.3 成本文案在生成前）。

### 5.4 `file`

- 文件：`{ "<itemId>": {…题包形状…} }`；载入逐卡过 §5.2；未知 id 忽略并计数；静止无成本。

### 5.5 `command`（用户/agent 的脚本；CLI 专属）

- 调用：执行用户程序（用户机器、用户权限），stdin 一行 JSON：
  ```json
  {"item":{"id","text","tr","lang"},"skill":"read|write|listen|speak",
   "variant":"mcq|cloze|listen-pick|…","plan":{…}}
  ```
  stdout：题包形状 JSON，exit 0 = 成功。
- 护栏：`timeoutMs`（默认 10s）、stdout 上限（256KB，超限判废）、非 0 退出 / 非 JSON / 超时 ⇒ 丢弃回落。
- 缓存：默认按 `(itemId, commandHash)` 缓存本地；`cache:false` 关。
- 安全：**这是用户的程序**，我们不做沙箱、不代跑逻辑；文档写明「命令以你的权限执行」。
- **仅 CLI**；App 不支持。

### 5.6 `questions`（plan 内联）

- 少量精确覆盖；`null` = 停用该卡生成题（回落 `local`）。
- 大量题目建议走 `file`，别把 plan 撑大。

### 5.7 缓存存放

- 放 `~/.local/share/belliedmonkey/questions.json`（或 `state.json`），键含 `itemId`/`PACK_VERSION`/`promptHash`/`commandHash`。
- **绝不写 `corpus.mtlearn`、绝不同步**（断言：生成前后语料文件字节不变）。

---

## 6. CLI 命令与退出码

### 第一刀新增/改动

```
bm plan [--plan f] [--now ISO] [--json]      # 只读，按计划算牌库
bm plan init [--plan f]                      # 写一份默认计划
bm plan validate [--plan f]                  # 校验；具名报错
bm plan show [--plan f]                      # 打印生效计划（脱敏）
bm status [--json]                           # 语料张/各状态/到期/同步水位/额度余额
bm review [--plan f] [--now ISO] [--grades JSON] [--json]
```

### 第二刀新增

```
bm review … [--dry-run]     # 只列出这次会问的题目、不写复习行
bm questions prefetch [--plan f]   # 显式预生成（报花费）
bm questions clear [--plan f]      # 清本地题目缓存
```

### 退出码

`0` 成功 · `1` 用法/参数 · `2` 引擎未配置 · `3` 翻译失败 · `4` 语料/文件 ·
`5` 账号/同步/**`busy`**。

### `--grades`（agent 非交互复习）

```json
[{"itemId":"ab12…","grade":2,"mode":"read"}, {"itemId":"cd34…","grade":1,"mode":"write"}]
```
按给的行写复习（校验 id 存在；不存在则忽略并计数）；`--json` 输出 `{graded, skipped, external, fallback, bad_output, aiCalls}`。

---

## 7. 并发与确定性

- **建议锁 + 原子写**（`cli/lock.js`）：`withLock(file, fn)`、`writeAtomic(file, bytes)`；
  `corpus.mtlearn` / `state.json` / `plan.json` 的写都走它。
- 写冲突 ⇒ 退出 **5/`busy`**，**绝不写坏**；陈旧锁（PID 已死）自动回收；稍后重跑能成。
- **`--now <ISO>`**：`plan`/`review` 的时钟注入（**测试/CI 用**），让同一语料 + 同一时钟 ⇒ 同一牌库
  逐字节可复现。

---

## 8. 用户故事

### 人（用户）

- **上手**：`bm setup` 登录领免费额度即可翻；或自带 key；离线 / 验证码错的恢复。
- **翻译面**：参数/stdin/文件、`--only`、`--json`、`--lang`、同语言反向；文档（默认一页）、字幕、批量。
- **写计划**：按语言 / 来源（include-exclude）/ 状态 / 星标 / 显著度 / 显式 id / 查询语句选句子；
  设 `dailyNew`/`deckSize`/`mix`；挑题型顺序与权重；改阶梯阈值。
- **优化计划**：收紧 `dailyNew`、提前 `write` 档、把生成器从 `local` 换成 `pack`/`file`/脚本。
- **采集很多**后 `plan` 仍受配额约束（不一次端出全部）。
- **往返**：CLI 写计划 → 导出 → App 复习；App 导出 `.mtlearn` → CLI 导入 → 计划能选中。
- **复习**：read 自评 + write 填空；技能盖章；`q` 保存；跨会话继续；每日新卡预算跨会话累计。
- **账号/隐私**：退出登录清额度令牌；密钥打码；`owner_mismatch`/`signed_out` 具名。
- **中国版**：不代领、不同步；境内引擎。
- **故障恢复**：未配置、额度用完、坏文件、离线同步、截断导入。

### agent（用户的自动化）

- **全程机读**：所有命令 `--json`，stdout 纯净、stderr 走日志、无 ANSI、非 TTY 不挂起、退出码稳定。
- **非交互复习**：`review --grades`。
- **流水线**：`translate --capture → plan --json → review --grades → sync`；cron 每日 `plan --json` 摘要。
- **幂等/重试**：`sync`/`import` 可重跑；`sync` 连跑两次第二次 `pushed==0`。
- **并发安全**：同机并发（锁，`busy`）。
- **可复现**：`--now`。
- **发现/报表**：`plan validate`、`status --json`、`providers --json`。
- **出题**：用 `command`/`file`/`questions` 自定义题目与逻辑；`review --dry-run --json` 预演。

---

## 9. 红测清单（TDD：先写、先红）

测试骨架 `test/cli-harness.js`（新）：`runBm(args,env,stdin)`、`fakeBackend()`（GoTrue + PostgREST +
`bt-relay` + `bt-grant`）、`localChat()`、`simApp(语料,状态)`（用复习页**同一批共享模块**无头跑）、`tmpEnv()`。

### A. 计划引擎 `test/learn-plan.test.js`

- `selectItems`：`langs` / `sources.include-exclude` / `states` / `starredOnly` / `minSalience` /
  `includeIds` / `excludeIds` / `query` 各自过滤正确；include 优先于 exclude；`null` 语义（若适用）。
- `schedCfg`：`dailyNew`/`deckSize`/`mix` 真进 `buildDeck`；缺省落 `DEFAULTS`；非法值 → 具名错误。
- `skillsCfg`：`allowed`/`order`/`weights`/`tiers` 生效；不存在的技能被能力门忽略。
- `validatePlan`：未知字段 → 报错并给路径；`format` 不对 → 报错。
- 确定性：同计划 + 同语料 + 同 `now` → 牌库逐字节相同。

### B. 你的场景 `test/cli-plan.test.js`

- **I6a**：登录 → 多次 `translate --capture` → 写 plan（`lang:en`、排除 `x.com`）→ `plan --plan`
  只出所选、排除被排除的来源。
- **I6b**：调大 `schedule.dailyNew`、调小 `skills.tiers.writeS` → 今日牌库随之变（新卡数变、write 更早）。
- **I6c**：`plan` 绝不越过 `deckSize`/`dailyNew`（负向契约）。
- **I7**：App 导出 `.mtlearn` → CLI `import` → `plan` 能选中（跨宿主**语料**一致；计划本地）。
- **I8/I9**：`review --grades` 写复习行/技能戳；`sync` 到假后端 → `simApp` 复习 3 张 → 拉回 →
  CLI `dueCount` 下降、`sched` 相等。

### C. agent 接口 `test/cli-agent.test.js`

- 每个 `--json` 可 `JSON.parse`；stdout 无散文。
- 非 TTY：`review` 不带 `--grades` 退出 1；带 `--grades` 退出 0 且写入。
- 未知命令退出 1。
- `sync` 连跑两次 → 第二次 `pushed==0`。
- `status --json` 含语料张/各状态/到期/水位。

### D. 并发 / 故障 `test/cli-lock.test.js`

- 两个 `sync` 同时 → 一个成功、一个退出 5/`busy`，**语料不坏**，稍后再跑能成；陈旧锁回收。
- 离线同步 → 退出 5/`offline`，语料不动。
- 截断 `.mtlearn` → `skipped>0` 但好行保留。
- 额度用完 → 退出 3 + 两条出口 + 配置页 URL。

### E. generator / questions（第二刀）`test/cli-generator.test.js` + 扩 `learn-plan`

- **file**：合法题逐字采用；干扰项等于译文被抓 ⇒ 回落；未知 id 忽略并计数。
- **command**：fixture 脚本回合法题 ⇒ 采用；非 JSON / 超时 / 非 0 退出 / 超大输出 ⇒ 回落；缓存
  ⇒ 第二次不再执行（执行次数=1）；`cache:false` ⇒ 每次都执行。
- **questions 内联**：覆盖 command/file/pack；`null` ⇒ 回落 local；非法被丢。
- **pack**：提示词 == `buildPrompt(explainLang)`；自定义 prompt 改缓存键；第二次不调 chat；
  `maxCallsPerSession` 到顶即停；无 chat 引擎 ⇒ `no_engine` 回落。
- **能力门**：给不存在技能塞数据 ⇒ 忽略。
- **不污染**：生成前后 `corpus.mtlearn` 字节不变。
- **dry-run**：只列题、不写复习行。
- **validate**：未知 generator / 命令不存在 / 文件坏 ⇒ 具名报错。

---

## 10. PR 拆分与实施顺序

1. **PR-D（仅文档，先过人工评审）**：本文件的 §1–§7 提炼进 `docs/learning-design.md`
   §9.11（新）+ §9.10 扩写 + §0 评审台账；`docs/interaction-spec.md`「命令行」；
   `docs/verification-spec.md` §3.1.13 与矩阵第 11 行；`docs/domain-design.md` §2.7/§9 指一句。
   **评审通过前不动代码。**
2. **PR-1（第一刀）**：红测（A–D）→ 实现（`cli/plan-model.js`、`cli/lock.js`、`cli/plan.js`、
   `cli/review.js`、`cli/bin` 接线、`cli/corpus.js`/`cli/state.js` 原子写、`_locales` 若干
   `cli_*` 键 ×12）。红转绿。
3. **PR-2（第二刀）**：红测（E）+ 实现（`cli/entry.js` 暴露 `chat`、`cli/questions.js`、
   `cli/exec.js`、`review` 接 generator、`--dry-run`、`plan validate`、`questions prefetch|clear`）。

**每个实现 PR 的验收**：红转绿；`npm test` 全绿；`npm run test:cli` 计数纳入；
`node build.js` 与 `node build.js --flavor china` 均绿（中国版过品牌合规门）；
真机 App 那层仍是独立验证矩阵行。

---

## 11. 待重评 / 开放项

- **[可重议] 计划是否将来要做成「可同步/可携带」**：本计划定为 CLI 本地文件；若以后要 App 也读同一
  计划，需把计划做成可同步物（新增行种或格式升版）——那是领域改动，另评。
- **[可重议] 第三刀：全新题型渲染器**（任意外形的新题型）。本计划明确不做。
- **[可重议] `command` 的安全与沙箱**：当前按「用户自己的程序、用户权限、不沙箱」处理。
- **[可重议] plan UI**：CLI 只有 `plan init/show/validate` + 手改 JSON；是否需要更友好的交互式 `plan edit`。
- **[可重议] `skills.weights`** 的具体调度含义（是否影响 `pickSkills` 的选取概率；MVP 可先只用 `order`）。
- **[可重议] `query` 语法**：MVP 可先只支持结构化字段，`query` 作为语法糖后续补。

---

## 12. 复用点（避免重复实现）

| 需要 | 复用 | 位置 |
|---|---|---|
| 牌库/配额/混比/技能轮换 | `LearnScheduler.buildDeck` / `buildDeckAhead` / `pickSkills` / `applyReview` / `DEFAULTS` | `extension/content/learn-scheduler.js` |
| 切句/造卡/填空/判分 | `LearnModel.splitPair` / `makeItem` / `clozeFor` / `clozeCheck` / `mergeSkills` | `extension/content/learn-model.js` |
| 本地题型/客观评分门 | `LearnExercises.pickExercise` / `gradeGate` | `extension/content/learn-exercises.js` |
| 题包提示词与统一校验 | `LearnExercisePack.buildPrompt` / `parsePack` / `PACK_VERSION` | `extension/learn/exercise-pack.js` |
| 聊天传输（出题/AI） | `LearnNotes.chat`（经 `cli/entry.js` 薄包） | `extension/learn/notes.js` |
| 语料编解码 | `LearnChunk.build` / `toJsonl` / `fromJsonl` / `deflate` / `inflate` | `extension/learn/chunk.js` |
| 同步 | `learn/auth.js` + `learn/sync.js`（经 `cli/sync-runtime.js` 适配） | 既有 |

**单一实现纪律**：`parsePack` 是唯一的题目校验器；`LearnScheduler` 是唯一的调度；`LearnNotes.chat`
是唯一的聊天传输。CLI 只组合，不复制。
