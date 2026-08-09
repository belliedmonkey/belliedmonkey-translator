# Learning Domain Design (记忆层领域设计)

> **Authoritative source of truth for the learning/memory domain.** Code must
> conform to this document. The learning layer is a **new stage attached to the
> translation pipeline**, so this doc is subordinate to
> [`docs/domain-design.md`](domain-design.md) — where the two disagree, the
> translation domain wins. Any change touching the model, the Collector boundary,
> the scheduler contract, or the storage tiers **must update this doc first and
> pass human domain-design review before the code changes** (see `AGENTS.md`).
>
> User-facing interaction rules for the review surfaces live in
> [`docs/interaction-spec.md`](interaction-spec.md); verification lives in
> [`docs/verification-spec.md`](verification-spec.md).

---

## 0. 评审记录 (domain-design review log)

| 日期 | 评审人 | 范围 | 结论 |
|---|---|---|---|
| 2026-08-04 | belliedmonkey | 记忆层 V1 + TTS + V3 同步（`feat/learn-tts`, PR #71） | 通过，附 4 项修订（见下） |
| 2026-08-07 | belliedmonkey | 学习面进配套 App；上行范围含候选池 | 待评审 —— 本次改动见 §7.2 / §8.5 / §8.6 / §12 |
| 2026-08-08 | belliedmonkey | 学习循环重设计：掌握阶梯 / 自由练习 / 评分透明 / 句子解析 | 待评审 —— 见 §5.1–5.3 / §4 / §9.2 / §11 / §12 |
| 2026-08-08 (二) | belliedmonkey | App 与扩展的功能落差三项：App 侧凭证（解析入 App）；自动同步触发；App 语音默认 `assist` | 待评审 —— 见 §7.2 / §8.8 / §9.2 / §12，及 interaction-spec 语音节修订 |
| 2026-08-08 (三) | belliedmonkey | 真机 bug 双修：§9.2 提示词点名生词只取自原句 + 缓存带提示词版本（「永不重复扣费」的刻意例外）；§9.1 speak() 补 iOS 解卡（resume + cancel 让位） | 待评审 —— 见 §9.2 |
| 2026-08-09 | belliedmonkey | 多设备同步一致性（用户裁定）：§8.8 规则 1 静默→状态行可见；进入即同步（force 绕节流）；每日新卡预算改账户级（复习台账推导，UTC 日界）；`lastSyncOkAt` 统一成功戳；MT_SYNC=on 自用构建通道 | 待评审 —— 见 §8.8 及 interaction-spec「多设备同步一致性」 |

**2026-08-08 的评审范围**由真机使用反馈驱动：评分按钮后果不可见、「学习好了」无
标准、牌组耗尽后精力无处使。三个方向已由产品在设计前定下（AskUserQuestion）：
掌握 = 读听写三技能阶梯；练习 = 答错算数、答对不加速；解析 = 按需生成、自带 key。

**2026-08-07 这次是前置评审**（文档先于代码），与上一次相反。起因是真机使用发现
**手机上进复习页要三步**（地址栏扩展图标 → 大肚猴翻译 → 复习），而这是 iOS 放置扩展
UI 的构造位置，不是可以靠调菜单解决的。

结论是加一个配套 App 作为浅入口，**同时保留浏览器端复习页**。过程中被否掉的两个方案
连同证据都记在 §12：走原生消息把语料交给 App 上传（上传进度会落到 App 手里），以及
把扩展退成纯采集器（会使产品对未登录用户不完整）。

**这是一次追溯性评审。** `AGENTS.md` 要求领域改动「先更新文档、过人工评审、再改代码」；
实际顺序是反的——评审发生时已有 15 个 commit。记在这里不是自责，是因为**追溯评审有一个
前置评审没有的失败模式**：评审人会锚定在既有实现上，把评审做成盖章。将来读到这一行的人
应当知道，下面这些结论是在那个偏置下做出的。

本轮四项结论：

1. **铁律二维持修订后的范围**（§3 law 2 / `domain-design.md` §9.1）。范围是「**任何**
   导致采集停止或丢弃已采集内容的事」，而不是只有「存储满」。已知代价：每新增一条可能
   丢数据的路径，必须同时做一个用户可见的面。**这是有意保留的约束，不是疏漏。**
2. **§2.1 增加可执行闸门**（下详）。原文只有「本地部署优先」一句倾向，没有任何机制
   阻止重心往服务端漂。
3. **§6 改为如实描述**。原文把这道门写成「显著性选择器」，实际行为是垃圾过滤器；
   真正的限流阀是调度器的 `dailyNew`。数字不变，描述改。
4. **新增 §12 否决记录**。文档此前只保留最后一版方案，被否的路径和原因全部丢失。

---

## 1. Why this exists

The extension is currently amnesiac. It builds, for every page and every video the
user consumes, a large set of **aligned `(source, translation)` pairs** — the most
expensive asset in language learning — and then throws them away when the 12-hour
translation cache expires.

The learning layer keeps them, and re-surfaces them on an Ebbinghaus forgetting
curve. What the user *has already read* becomes what the user *studies*. Nothing is
authored, imported, or bought: the corpus is a by-product of ordinary browsing.

Two scopes are deliberately **out** of the model (decided 2026-08-02):

- **No vocabulary/word cards.** The unit of study is the sentence the user actually
  met, in the context they met it. Word extraction needs frequency lists per
  language, and would break the "language-agnostic" property the translation domain
  fought for (§3 of domain-design).
- **Media cards replay the ORIGINAL audio, never a synthesized substitute.** A
  YouTube sentence is re-heard as it was actually said. (Text cards are a different
  matter — they have no original audio, so §9.1 gives them synthesized speech. The
  rule is "never replace real speech with synthetic", not "never synthesize".)
  - Replay **opens the source at the timestamp**; it is not an inline player.
    YouTube's embedded player only accepts an http(s) embedding origin and refuses
    `chrome-extension://` with error 153 — verified across four URL/referrer
    variants on 2026-08-02, including the no-referrer case that also covers a
    sandboxed page. A future iOS host app (§V4) may be able to embed natively; the
    extension cannot, ever.

---

## 2. Product shape — free for everyone

There is no paid tier and no subscription. This follows the **普惠优先 / free by
default** product principle in `AGENTS.md`, which this feature is the first to be
designed under.

| | Everyone |
|---|---|
| Translation | **defaults** to the user's own key, browser → provider directly, and that path stays free and fully capable forever. A server-side model may be offered as an opt-in **paid** alternative (§2.1) |
| Learning corpus | device-local IndexedDB; optionally synced to our server under a fixed free quota (§8), with one-action export at any time |
| LLM quizzes | the user's own key by default; a paid server-side path is permitted under §2.1 |
| Account & sync | free, optional, opt-in. A signed-out user has a complete product |
| Storage at rest | **plaintext** on our server (§8.6), under the obligations in §8.7 |

> **核心约束 — the free path never needs a server of ours.** A person who never pays
> and never signs in must have a *complete* product: capture, scheduling, review,
> on-device speech, and BYO-key translation all work with no account and no network
> of ours. The local path is never degraded to make a paid path look better. This is
> the invariant that survived — it is **not** "we never run a model".

### 2.1 When a server-side model is allowed

*(Amended 2026-08-04. This section previously read "the server never runs a model,
and that is load-bearing", justified by end-to-end encryption. §8.4 removed the
encryption, so that justification is gone; the rule was narrowed rather than kept
for its own sake.)*

Three conditions, all required:

1. **The user chose it and is paying for it.** Inference is a real recurring cost, so
   pricing it is exactly what `AGENTS.md` rule 8 permits — and BYO-key stays free, so
   rule 8's other half (never convert something already shipped free into a paid
   feature) is not touched either.
2. **It demonstrably beats what the local path can do.** "Convenient for us to host"
   is not a reason. If a user's own key produces the same result, there is nothing to
   sell.
3. **What that path processes is disclosed for that path specifically** — never
   averaged away into a claim about the product as a whole (§10).

**Local deployment stays first.** Default, recommended, and the one the onboarding
teaches. A hosted model is an alternative for people who want it, never the path of
least resistance.

> **核心约束 — a server-side model feature may not ship before its local equivalent.**
> *(Added 2026-08-04 by domain review; `AGENTS.md` rule 11.)* Any capability that depends on a model
> running on our server may be released only once the same capability already works
> on the local / self-hosted path. The hosted version may be faster or better; it may
> not be the **only** version.
>
> **Why this needs to be a gate and not a preference.** "Local first" was one
> sentence, and nothing enforced it — while the pull toward the server is real and
> constant: hosting spares us the user's GPU, their endpoint configuration, and error
> messages in eleven languages. Every individual feature looks more sensible hosted.
> Drift is the accumulation of decisions that were each locally correct, which is
> exactly the kind of drift a preference cannot stop. This gate inverts the pull:
> **to ship the hosted version you must first build the local one**, so the easy path
> stops being a shortcut.
>
> It is also checkable, which a preference is not. Before release, ask: *can someone
> who never signs in and never pays use this?* A "no" blocks the release.

**Telemetry remains permanently forbidden**, and is not affected by any of this.

---

## 3. 核心约束 — the Collector laws (do not break)

The pipeline in domain-design §1 gains **one bypass sink**:

```
source → Extractor → Engine → Renderer
                                  │
                                  └──▶ Collector ──▶ Store ──▶ Scheduler ──▶ Reviewer
```

1. **Capture is a sink, never a source.** The Collector reads only what the Renderer
   has *already decided to display*. It never back-pressures the engine: it does not
   influence `selectActive`, does not change `pump()` cadence, does not mark units,
   and **never originates a translation request**. If the learning layer were deleted
   at runtime, translation output must be byte-for-byte identical.

2. **Silent in the browsing flow — never silent to a user who opted in.**
   *(Amended 2026-08-04; see §7.1 for what the surfaces must show.)*
   - **Toward the page: absolutely silent.** Storage full, IndexedDB unavailable,
     quota denied, outbox overflow — all reduce to *no capture*, with the translation
     path untouched. No retry loop, no notice injected into the page, no half-state
     (same shape as domain-design §5.3.3).
   - **Toward a user who turned capture ON: never silent.** Anything that stops
     capture, or discards material already collected, must be **visible in the
     learning surfaces with an action that fixes it**. §8.5 already says exactly this
     about the server quota; the original wording of this law contradicted it, and
     the contradiction was resolved in favour of telling the user.
   - **Dropping captures is still a normal path, not an error path** — it just is not
     an *invisible* one.

3. **Nothing reaches `DomSegmenter`.** The Collector adds **zero selectors**. Site
   knowledge enters only through the two generic markers the segmenter already
   honors — `data-mt-player-region` and `data-mt-skip-region` (domain-design §3).
   Needing a per-site or per-device branch to decide what to capture means the design
   has regressed; fix the salience model instead.

4. **Self-capture is forbidden.** Any injected learning UI carries `translate="no"`
   **and** `data-mt-skip-region`, and the Collector skips `.mt-translation` and every
   `#mt-*` subtree. Without this the extension translates its own translations and
   captures the result — an unbounded feedback loop that corrupts the corpus.

---

## 4. Data model

One `Item` type. The three study granularities are distinguished by the `anchor`
union, **not** by three parallel types — same reasoning as domain-design §2 ("the
split is the source kind, not the site").

```js
Item = {
  id,              // FNV-1a(lang \0 normText) as 16 hex chars — content-addressed
  text, tr,        // source / translation
  lang,            // SOURCE language = the language being learned; 'und' if unknown
  targetLang,
  kind: 'sentence' | 'passage',
  anchor:
      { k:'dom',   url, title, siteKind, quote }            // passage re-read: quote locates it again
    | { k:'media', url, mediaKey, title, startMs, endMs },  // clip replay: jumps back to the segment
  createdAt, lastSeenAt, seenCount, dwellMs,
  salience,        // 0..1, computed deterministically at capture time
  state: 'candidate' | 'learning' | 'known' | 'muted',
  sched: { s, d, lastReviewAt, dueAt, reps, lapses },
  starred,         // explicit user save → bypasses the salience gate
  skills,          // {read?:1, listen?:1, write?:1} — tiers passed at grade ≥ 2 (§5.2)
}
```

A review-log row is `{ itemId, grade, at }` plus, since 2026-08-08, two optional
fields: `mode: 'read' | 'listen' | 'write'` (which exercise form was graded, §5.2)
and `practice: 1` (a free-practice rep, §5.3 — logged but not schedule-advancing).
Both are additive: the log is append-only and JSONL carries unknown fields through
old readers untouched, so the chunk format (§8.4) does not version-bump for this.

- **`id` is content-addressed.** The same sentence met on a second device, or on a
  second site, collapses onto one item and increments `seenCount`. This is what makes
  sync idempotent without a server-assigned identity.
- **`id` must use a synchronous non-cryptographic hash (FNV-1a).** `crypto.subtle` is
  unavailable in content scripts on plain-`http` pages (not a secure context), so a
  SHA-based id would silently fail on exactly the long tail of sites we care about.
- **`text` / `tr` / `anchor` are immutable after creation.** Only `sched`, `state`,
  `starred`, `skills` and the counters mutate. This is what shrinks the sync conflict
  surface to almost nothing (§8.3).
- **`skills` merges as a UNION** — a skill once passed anywhere is passed everywhere.
  Union (max per key) is idempotent under *both* of §8.4.2's merge semantics, so it
  needs no accumulate/copy branch and cannot echo-amplify: the same reasoning that
  made `starred` safe to sync applies unchanged.

### 4.1 The learned language is the source language

`item.lang` is the **source** language, not "English". Detection order:
`LangDetect` (Chrome/Edge/Firefox; absent on every Safari) → script inference →
`'und'`. Per domain-design §5.3.2 the detector is **injected by the adapter, never
probed by the Collector**, and an undetected language is stored as `'und'` and
grouped separately in the review UI — capture is never blocked on detection.

The user picks which languages to study; the default is *every* language that is not
`targetLang`. No language is hard-coded anywhere in the learning layer.

**Implemented (2026-08-09) as the whitelist half of `learnRules`** (`{v, block,
langs, updatedAt}` in `chrome.storage.local`; §8.9 for how it syncs). `langs: null`
is the default and means "everything ≠ targetLang"; a non-null array is the
whitelist. The gate runs at capture (`LearnCollector.flush`) and again at drain —
**never** on the corpus, so tightening the whitelist later does not delete what was
already saved (deletion is §7.4's job, a separate user action).

**On Safari every candidate is `'und'`** (no detector), so a literal whitelist would
capture nothing on the product's primary platform. The fallback: when
`lang === 'und'`, the gate passes iff the text's dominant Unicode script
(`LearnRules.dominantScript`) is compatible with at least one whitelisted language,
per the `scripts` table in the language registry (`build/langs.config.js` →
`window.MT_LANGS`). The stored `lang` stays `'und'` — the script check is a capture
gate only and never changes `itemId`. Known looseness, accepted and deliberate:
scripts are shared across languages (whitelist `[zh]` admits pure-kanji Japanese;
`[ja]` admits Han + Kana; `[en]` admits French). The gate errs toward capturing —
per §3 law 2, over-capture is recoverable (delete), silent under-capture is not.
A **starred** draft (explicit long-press) bypasses the whitelist: a deliberate
gesture outranks a standing filter.

---

## 5. The scheduler (`learn-scheduler.js` — pure functions)

Exponential forgetting, in the FSRS stability convention (`R(S) = 0.9`), which is the
same Ebbinghaus curve with a more controllable parameterization:

```
R(t) = 0.9 ^ (t / S)                              // t, S in days
dueAt = lastReviewAt + S * ln(targetR) / ln(0.9)  // targetR 0.90 ⇒ interval = S
```

> **Why a continuous `R` rather than a binary due-queue.** The product promise is
> "keeps recommending", not "37 cards are due today". Sorting by `R` ascending yields
> "closest to being forgotten first" as a *continuous* ranking, and one piece of math
> then serves the review page queue, the in-page card picker (V2), and the
> notification threshold (V2) without three different definitions of "due".

Grades: `0 again · 1 hard · 2 good · 3 easy`.

```js
const DEFAULTS = {
  targetR: 0.90,
  S0:      [0.15, 0.7, 1.5, 4.0],   // days; first grade sets initial stability
  FACTOR:  [0.35, 1.15, 2.4, 3.6],
  DELTA_D: [1.2, 0.35, 0, -0.5],    // difficulty increment
  S_MIN: 0.02, S_MAX: 365,          // ~29 minutes .. 1 year
  KNOWN_S: 180,                     // S ≥ 180d ⇒ state = 'known'
  SPACING_GAIN: 1.0,
  dailyNew: 15, deckSize: 20,
};

R       = pow(0.9, elapsedDays / s)
diffMod = (11 - d) / 10                    // d ∈ [1,10]; harder items grow slower
spacing = 1 + (1 - R) * SPACING_GAIN       // a late-but-correct review earns more
s' = grade === 0
     ? clamp(s * 0.35, S_MIN, S_MAX)                              // lapses++
     : clamp(s * (1 + (FACTOR[grade] - 1) * diffMod * spacing), S_MIN, S_MAX)
d' = clamp(d + DELTA_D[grade], 1, 10)
```

**`buildDeck(now, opts)` — a 70 / 20 / 10 mix:**

- **70%** `state='learning'` with `R ≤ targetR`, sorted by `R` ascending.
- **20%** `state='candidate'`, sorted by `salience` descending, bounded by `dailyNew`.
- **10%** `state='known'` whose `R` has slipped below 0.95 — interleaving, so that
  "learned" never means "never seen again".

No more than 3 consecutive cards from the same source (same URL / same video), so a
session is not one article read back to itself.

**Contracts this module must satisfy** (verification-spec §3.1.1):

- `now()` is **injected**, never read from the ambient clock — otherwise none of this
  is testable.
- Config is **merged**, `Object.assign({}, DEFAULTS, cfg)`, and asserted against the
  production `DEFAULTS`, with at least one case passing a deliberately partial config.
- The valuable behaviors here are **negative** (a mature card must *not* appear, a
  new card beyond `dailyNew` must *not* appear). Those need call-count assertions —
  a deck that merely *looks* right proves nothing about what was correctly withheld.

### 5.1 核心约束 — 评分的后果必须可见（2026-08-08）

*(真机反馈原话：「『太简单了』『我记住了』等状态我不知道点击完后意味着什么」。
这不是文案问题——是调度器的全部输出都停在内部数字上，界面一个都不给。)*

- **四个评分按钮各自标注后果。** 对当前卡预演 `applyReview(sched, g, now)` 四次
  （纯函数，零成本），把间隔写在按钮上：「不记得 → 重新学」「有点难 → 2 天后」
  「记得 → 5 天后」「太简单 → 12 天后」。新增纯函数
  `previewIntervals(sched, now, cfg) → [ms, ms, ms, ms]`，和调度器的其余部分一样
  注入 `now`、可测。选择即预览，是把调度器从黑箱变成可预期工具的最小改动。
- **记忆强度常驻可见。** 卡片上一条小进度条 + 「记忆强度 {s} 天 / 180 天」。
  「已掌握」由此第一次有了用户可见的定义：**强度达到 180 天，约等于半年不碰
  仍有九成概率记得**（`R(180d) = 0.9`，§5 的公式直译成人话）。
- **首次进入复习页给一张一次性说明卡**，三句话讲完循环：记得 → 间隔拉长；
  忘了 → 重来；强度攒满 → 毕业。看过存 `meta`，永不再弹。
- **牌组耗尽页说明上限并给出路。**「今天的复习做完了」页面注明「每天新卡上限
  {n}，可在设置调整」——上限本来就可调（1–200），只是没人知道；同页给 §5.3 的
  练习入口，耗尽不再是死路。

### 5.2 核心约束 — 掌握是一个阶梯，不是一个阈值（2026-08-08）

**「学习好了」的标准：同一个句子，能认、能听懂、能写出来。** 三种题型共用
**一套排程**，按记忆强度逐级升难：

| 阶段 | 题型 | 门控 |
|---|---|---|
| **认读** | 看原句 → 自评含义（原有流程） | `s < TIER_LISTEN_S` |
| **听懂** | 只放音频 → 自评含义（复用既有 audio-first 机制，`review.js` 已有） | `TIER_LISTEN_S ≤ s < TIER_WRITE_S`，且该卡 TTS 可用 |
| **产出** | 看译文 → 补全原句挖空（1–3 空按长度带），**输入自动判对** | `s ≥ TIER_WRITE_S` |

```js
TIER_LISTEN_S: 4,   // days — same "unvalidated, cheap to retune" caveat as §6
TIER_WRITE_S: 30,
```

- **为什么一套排程带三种题型，而不是每技能一张时间表**：独立排程使 `sched` 变成
  三份、同步合并的「按 lastReviewAt 取新」拆成三路、复习债×3，而换来的精度建立在
  两个本就未经验证的阈值上（§12 已否决）。强度本身就是难度的正确门控——记忆越牢，
  测试越苛刻，这正是「拉通听说读写」在间隔重复框架里的诚实实现。
- **验证的诚实边界，写明而不是含混**：**写是唯一客观判定的技能**——挖空答案归一化
  （大小写、标点、空白）后精确比对；读与听仍是自评。宣称「科学验证」时只有产出
  阶段配得上这四个字，文档与界面都不夸大。
- **挖空是本地纯函数** `LearnModel.clozeFor(text, lang)`：脚本感知选实词（沿用
  §6 长度带的 CJK/Latin 区分），不调用任何模型。放 `learn-model.js` 因为两个宿主
  （扩展页 + App）都已加载它。
- **说 = 跟读，自评，不作验证。** 听懂阶段附「跟着读一遍」提示。浏览器的语音识别
  API（SpeechRecognition）把录音送往厂商服务器，与「无遥测」承诺正面冲突，ASR
  维持 §11 排除（本次重审后二次否决，§12）。界面明说这是练习不是测验。
- **技能徽章**：每张卡显示 读 / 听 / 写 三枚徽章，各自在该题型下拿过 ≥「记得」
  即点亮，落 `item.skills`（并集合并，§4）。
- **「全面掌握」= `s ≥ KNOWN_S` 且该卡可用技能全部点亮。** 这是**展示层**概念：
  `stateFor` / `known` 保持纯 `s` 判定不动——调度器状态机零迁移，已有用户的
  「已掌握」不回退，只是徽章未满的卡在界面上标为「记忆已牢，技能未全」。
- **TTS 不可用（无引擎 / 无该语言语音）的卡自动跳过听懂档**：能力缺失意味着该档
  *不存在*，不是该卡失败——同 domain-design §5.3 规则 1 的能力语义。
- **生词 / 语法 / 短语不进掌握标准。** 学习单位是句子（§1、§11 不变）；词汇与
  语法作为句子卡的**解析面**提供（§9.2），帮助理解，不单独考、不单独排程。

### 5.3 核心约束 — 自由练习：答错算数，答对不加速（2026-08-08）

*(真机反馈：「每次只能学几个句子，太少了。应该允许用户根据自己的精力情况反复
学习所有在学习库里的内容。」)*

- **入口**：牌组耗尽页的「继续巩固练习」按钮 + 复习页常驻「自由练习」。
- **池子**：默认「学习中」（按 R 升序，最接近遗忘的先出）；可切「全部」（含候选
  与已掌握）。批量 10 / 20 / 不限；`spreadBySource` 照常防单文章连读。
- **对排程的影响是不对称的，这是本节的核心**：
  - **答错 → 照实算**：记录 + `applyReview(grade 0)`，打回重学、尽快再见。
    任何时刻的遗忘都是真实证据。
  - **答对 → 只记录，不写 `sched`**：刚见过就答对，证明不了长期记忆——把它计入
    会让连点两遍「记得」刷出几个月的假间隔，正是「科学验证」的反面（Anki 对
    cram 的处理同理；§12 记录了对称方案的否决）。
  - 界面一句话讲清：**「练习不能刷出掌握，但能暴露遗忘。」**
- **候选卡在练习里只曝光**：无论答对答错都不建 `sched`。新卡的正式引入只走每日
  牌组——`dailyNew` 的意义就是防止今天的热情变成明天的复习债，练习不得绕开它。
- 练习记录带 `practice: 1` 与 `mode`（§4），照常进 append-only 日志、照常同步；
  重放端不因它推进任何排程（排程本来就随条目走、不由日志重建，§8.4.2 的机制
  天然覆盖）。收敛判据不变：无活动时双向同步仍须稳定 0 / 0。

---

## 6. What counts as "seen" — the capture gate

*(Renamed and rewritten 2026-08-04 by domain review. It was called a "salience gate"
and described as selecting what stands out. The numbers do not do that, and the
mismatch is what the review caught — see below. The numbers were kept; the
description was corrected. Also fixed here: the formula previously written in this
doc had four terms including a `sourceRecency` that **does not exist in the code**.)*

The gate is **deterministic, LLM-free, word-list-free and language-agnostic**:

```
salience = 0.50*dwell + 0.28*lengthBand + 0.22*repeat        # learn-model.js W
gate:      salience ≥ 0.45  AND  (dwellMs ≥ 2500 OR playedThrough)
starred ⇒ salience = 1.0, gate bypassed
```

> **What this actually does, stated plainly.** On a first encounter `repeat` is 0 and
> an in-band length contributes 0.28, so clearing 0.45 needs only `dwell ≥ 0.34` —
> about 2 s, under the 2.5 s hard floor that applies anyway. **Any in-band sentence
> you looked at for 2.5 seconds is captured the first time you see it; the repeat term
> never has to participate.** Subtitles are stronger still: `playedThrough` scores
> dwell 1.0, so every fully-played sentence lands at 0.78.
>
> So this is a **junk filter, not a selector**. It removes what you scrolled past,
> what is too short to be a card, code, and text already in your language. What
> survives is *everything you actually read* — on the order of 100–150 captures a day
> for a normal reading habit, or 200+ from one 20-minute video, reaching the 20,000
> cap in roughly two to three months of daily use, after which §7.1 eviction begins.
>
> **Selection happens one layer down, in the scheduler**: `dailyNew` (15) is the real
> limiter on what enters review. The corpus is a firehose and the deck is a trickle,
> and that is the design — not an accident of tuning. Anyone re-tuning these weights
> should know they are adjusting *what is kept*, not *what is studied*.

- **dwell** — `IntersectionObserver` at threshold 0.5, accumulating visible
  milliseconds; `clamp(dwellMs / 6000, 0, 1)`. This is the honest reading of "看过":
  a segment that scrolled past in 200 ms was not read.
- **lengthBand** — script-aware, mirroring the segmenter's own script-aware floor
  (`dom-processor.js` `minLen`): 8–60 chars for CJK/Hangul/Thai, 40–220 for
  Latin/Cyrillic. Tapers outside the band rather than cutting hard.
- **repeat** — `min(1, (seenCount - 1) / 3)`. Meeting the same sentence again is
  evidence it matters. In practice it only ever *raises* an already-passing score.
- Noise is removed with judgments that **already exist**: `looksLikeCode()`,
  `isAlreadyTargetLanguage()`, and the `data-mt-skip-region` marker.
- **Subtitles** — a sentence counts only if the playhead actually crossed
  `[start, end]` while the overlay was showing (`playedThrough`). Seeking past a
  sentence is not watching it.

**These numbers are unvalidated.** They were chosen to have the shape of an FSRS-like
model, not from evidence. Retuning the gate is cheap forever — it changes only what is
captured next, never an existing card. Retuning the **scheduler** shifts the due dates
of cards that already have history, and lowering either **cap** evicts data
permanently; those two are the ones that get expensive.

---

## 7. 核心约束 — storage is three tiers, and the reason is origin

> *(§7.2 adds the host app, which is a **fourth** origin and therefore a second corpus.
> The three tiers below describe the extension's, and are unchanged by it.)*

> **A content script's `indexedDB` belongs to the HOST PAGE's origin, not the
> extension's.** Writing the corpus there would scatter it across every site the user
> visits and expose it to the page's own scripts. It is not an option.
>
> **The service worker cannot be in the path either** — it goes permanently
> `undefined` on Safari iOS after device lock (`background.js:1-4`, domain-design
> §5.3.1). Capture, write and drain must all work with a dead SW.

```
content script  ──write──▶  chrome.storage.local  ──drain──▶  IndexedDB
(host-page origin)          `lq:` bounded outbox            (chrome-extension:// origin)
                            one key per page session         the real corpus
```

1. During a page session the Collector accumulates in memory (`Map<id, draft>`).
2. On flush (`pagehide`, `mediaKey` change, every 30 s, `disable()`) it writes **one**
   key: `lq:<sessionId> = Item[]`, and updates `lq:index`.
3. `lq:index` is capped (40 sessions / ~1.5 MB); the oldest are dropped. Per Collector
   law 2, **dropping is a normal path**.
4. Any extension page (review / popup / options) drains the outbox into IndexedDB on
   open and deletes the keys. Browsers with a living SW also drain there.

Merge on drain: existing `id` ⇒ `seenCount++`, `dwellMs +=`, `lastSeenAt` updated,
`salience = max(…)`. `text` / `tr` / `anchor` are never overwritten.

**IndexedDB `mt-learn` v2** — `items` (keyPath `id`; indexes `state`, `lang`,
`createdAt`, `salience`), `sources`, `reviews` (append-only; indexes `itemId`, `at`),
`meta` (sync cursor, device id, daily-new counter, key material), and `audio` (§9.1's
speech cache; added in v2). Every `createObjectStore` is guarded by `contains`, so a
version bump only ever adds.

**Capacity.** Hard cap 20,000 items; eviction order `state='known'` → `salience`
ascending → `createdAt` ascending. V1 deliberately does **not** request
`unlimitedStorage` (a new permission affects store review); the cap plus a usage
readout in settings is the mechanism instead.

> **Pre-existing debt this forces us to fix.** `chrome.storage.local.get(null)`
> (whole-bucket read) appears in 5 places — `background.js:62,83`, `options.js:148,216`,
> `popup.js:61`, `content-main.js:12`. With an outbox in the same bucket, every
> settings read on every page load would drag the outbox along. These must move to
> explicit key lists before the Collector ships. (`DEFAULT_SETTINGS` has also drifted:
> `apiModel` and `ytTextColor` are written at runtime but absent from it, and
> `bilingualMode` is dead.)

---

### 7.1 Storage pressure must be visible — and fixable

Law 2 (§3) requires that anything which stops capture, or discards material already
collected, is visible **in the learning surfaces**. Concretely there are three
pressure states, and they are genuinely different:

| State | What actually happens today | What the user is told |
|---|---|---|
| **Outbox overflowed** (`lq:` past 40 sessions) | Captures from the oldest page sessions were **lost before ever reaching the corpus** — this is the one that really means "capture stopped". Happens when the user browses a lot but never opens an extension page | 「有采集内容没能存下来」 + how to prevent it (opening the review page drains the outbox) |
| **Corpus at the cap** (20,000 items) | Capture does **not** stop — the corpus recycles, dropping `known` first, then lowest-salience, then oldest, never a starred card. But material the user collected is being discarded | 「学习库已满，正在自动淘汰旧卡」 + the cleanup action below |
| **Server quota full** (50 MB, V3) | New card *text* stops uploading; progress keeps syncing (§8.5) | 「已达云端上限」 + cleanup, and this is the one place a paid tier is coherent |

**Two cleanup actions, not one.** 「清空学习库」 (erase everything) already exists but
is nuclear — it throws away months of scheduling progress to reclaim space. The
primary action must be **targeted**: drop `state='known'` cards, which are by
definition the ones the scheduler has decided you no longer need, and never touch a
starred card or one you are actively learning.

> **核心约束 — do not offer to sell local storage.** The 20,000-item cap is
> *self-imposed*: it exists so V1 need not request the `unlimitedStorage` permission,
> which affects store review. Local storage costs the project nothing, so charging
> for more of it would violate `AGENTS.md` rule 8 on both counts — price only what
> genuinely cannot be carried, **and** never convert something already shipped free
> into a paid feature. A paid option
> may appear **only** against the server quota — a cost that is actually incurred —
> and only once such a tier exists. Never show an upgrade path to a tier that does
> not exist.

### 7.2 核心约束 — there are TWO corpora, and only the server joins them

*(2026-08-07, with the host app.)* The three tiers above describe **one** corpus, the
extension's. The host app has its own, in its own `WKWebView` origin, and **origin is
the entire reason §7 exists** — the app can no more read the extension's IndexedDB
than a content script can. There is no shared-container shortcut: see §12 for why the
native-messaging bridge was rejected on product grounds even though it works.

```
extension: content script ─▶ lq: outbox ─▶ IndexedDB ─┐
                                                       ├─▶ §8 sync (the server)
app:                                    app store ────┘
```

Three consequences that surprise people, so state them where they will be read:

1. **Same device, still through the server.** On one iPhone, Safari's corpus and the
   app's corpus meet only via §8.
2. **The app is empty until you sign in**, and must say so in those words rather than
   showing an empty deck. The extension's review page is the signed-out path (§8.1).
3. **The extension owns the upload** — it holds `syncPushedAt` and can therefore tell
   the user what has and has not reached the server. Nothing else can.

**App 侧凭证（2026-08-08 (二) 放宽，边界如下；同日稍晚扩至语音引擎）。** 此前的
边界是「翻译引擎 / API key / 自定义端点一律留在浏览器侧」，理由是 App 从不翻译。
§9.2 的解析改变了后半个前提：App 里的复习面有确实需要用户自备引擎的功能。因此
App 的设置页**可以**配置：一个 chat 类引擎 + key（仅供 §9.2 解析），以及一个语音
引擎 + key（仅供 §9.1 朗读；引擎表来自 `MT_TTS_ENGINES` 注册表，本地优先的排序
照旧）—— App 仍然从不翻译、从不采集。三条不放宽的边界（对两把 key 同样成立）：

1. **凭证是设备本地的，永不同步。** key 不进 chunk、不进服务器 —— §8.6 已裁定
   服务器无 E2E，把凭证放上去等于把泄露半径从一台设备扩到整个服务端（§12）。
   换设备重新填一次 key，代价与收益相称。
2. **配置是可选的，空着不减损其它一切。** 解析的能力门控（§9.2）本来就规定
   「没引擎 ⇒ 入口不渲染」；App 不配 key 就是这个状态，不是降级。
3. **存放风险如实陈述**：App 的 `chrome.storage` 垫片背靠 `localStorage`，明文，
   与扩展侧 `chrome.storage.local` 的现状同级（都不加密）。这不是新增风险面，
   但设置页的措辞不得暗示比扩展更安全。2026-08-09 起同步会话（`learnAuth`）也在
   这一层与 API key 并排明文存放（§8.4.1 会话存储位置）—— 同暴露级、无新面，
   换来的是跨升级不重登。

### 7.3 Eviction and compaction cancel each other out

*(Found 2026-08-07 while reversing §8.5 lever 1; direction decided and both mechanisms
built the same day.)*

Device A hits the 20,000 cap and evicts 5,000 `known` cards per §7.1. Device B later
compacts (§8.4): it writes a snapshot **from its own complete corpus** and deletes
every row below it. A's next pull replays that snapshot and **receives the 5,000 cards
it just evicted**, putting it straight back over the cap.

It does not loop forever — replayed items carry the `syncedAt` watermark (§8.4.2) so
they are not pushed back — but **eviction is undone at every compaction**, and the
user sees 「清理完又满了」. While only cards that had entered the deck were uploaded
this was years away for a real user; with the candidate pool travelling (§8.5) the cap
arrives in **two to three months** (§6), so this is now on the normal path.

#### The churn is the mild half. Compaction from an evicting device destroys data.

Reverse the roles. **Device A evicts 5,000 cards and then compacts**: it writes a
snapshot from a corpus that is now missing those 5,000, and deletes every row below
it. Nothing else on the server holds them. **They are gone for every device and for
good** — not churn, not a re-download, permanent loss of material the user never asked
to delete.

Compaction's licence to delete rests entirely on the snapshot being COMPLETE (§8.4).
Eviction is precisely the thing that makes a device incomplete. The two features are
not merely awkward together; **as written, one of them is a data-loss bug in the
presence of the other**, and eviction went from "years away" to "two to three months"
when the candidate pool started travelling.

#### 核心约束 — eviction is local pressure, not the user deleting something

This is the sentence that decides the design, and both of the directions this section
originally floated violate it:

> A device running out of room is a fact about **that device**. It is not a statement
> about what the corpus should contain, and it must never remove anything from another
> device or from the server.

- **Eviction propagates (tombstones in the chunk format)** — rejected. It converts
  "this phone is full" into "delete this everywhere". A user whose phone fills up
  would silently lose corpus on their laptop. Wrong semantics, and a format change
  besides.
- **Snapshots exclude what a device evicted** — rejected. Same wrong semantics,
  reached by a different route, plus it breaks the completeness property outright.

**Decision (2026-08-07): the server is the ARCHIVE, each device keeps a WORKING SET.**
Two mechanisms follow, and they are small:

1. **Eviction records a local tombstone, and the tombstone filters the SYNC PULL only.**
   `chunk.js`'s `replay()` already distinguishes the two callers via `opts.fromServer`
   (§8.4.2) — the same seam. A tombstoned id is not re-admitted from a chunk, so the
   churn stops. Tombstones **never sync**; they are per-device by definition.
   - **Capture always wins.** If the user reads the sentence again, the Collector
     captures it and the drain re-admits it, tombstone or not. Only the server path is
     filtered. This preserves law 1's direction of travel and matches §8.4.2's
     existing split between "a new observation" and "a copy of the same fact".
   - Reviews arriving for a tombstoned card are **kept**, not dropped — they are 13
     bytes and they are the user's actual history. See PR #88 for why orphan reviews
     are already a normal state.
   - The tombstone set is bounded like everything else here; on overflow the oldest
     are forgotten and those cards may return once. Degrades to today's behaviour,
     which is the right direction for a bound to fail in.
2. **Only a device that can prove its corpus is complete may compact.** In practice a
   device that has ever evicted cannot prove that, so the workable rule is blunt:
   **a device that has ever evicted never compacts.**
   - The gate is an `everEvicted` **latch in `meta`**, deliberately not a read of the
     tombstone store or of the `evicted` pressure counter. Both of those are erasable
     — tombstones age out, and `clearPressure` is a user action — and a permission to
     delete server rows must not come back just because the evidence was tidied away.

**Storage layout** (`store.js`, IndexedDB **v3**): a `tombs` store keyed by item id,
with an `at` index for aging. Both selection decisions — which items are evicted, and
which tombstones are forgotten — are pure exported functions (`doomedFor`,
`staleTombs`) so the suite can assert on them; everything around them is IndexedDB
plumbing. The v2→v3 migration has its own gate, `npm run test:idb`
(`verification-spec` §3.1.2), because it is the one change that touches data users
already have and `npm test` structurally cannot see it.

#### What this costs, stated plainly: the storage bound is not real

Rule 2 has a consequence that has to be said rather than buried. Eviction is on the
normal path now, so **most active accounts will end up with no device eligible to
compact** — and §8.5's lever 4, the thing that makes stored bytes *bounded*, stops
applying to exactly the users who generate the most data.

So the honest position, until something changes:

- Storage follows §8.5's **flow** row: ~3.6 MB/user-year, **unbounded**, reaching the
  50 MB quota in ~14 years.
- That is beyond any horizon this project is planning for, so **doing nothing is a
  legitimate answer** — and it is the current answer. `compact()` has no production
  caller anyway (§8.5), so nothing regresses.
- If a bound is ever wanted, the shape that survives this section is **server-side
  compaction** (a Postgres function over the user's own rows, which by construction
  sees the complete archive), not a smarter client. Recorded here so the next person
  does not re-derive the client-side version and re-discover why it deletes data.

### 7.4 核心约束 — 用户删除 ≠ 淘汰：删除是账号级意图，必须传播（2026-08-09）

§7.3 pinned eviction as a fact about one device. A **user-initiated delete** (整站
清理 in 来源管理, per-card source actions in review) is the opposite kind of fact:
a statement about what the corpus should contain. It therefore **propagates to every
device and to the server**, and it must not reuse any part of the eviction path:

> Eviction says "this device is full". User delete says "I don't want this".
> The first must never leave the device; the second must never stay on it.

Mechanism, all additive to the `mt-learn/1` format (§8.4):

1. **A local delete ledger** — IndexedDB store `dels` `{id, at}` (v5), bounded at
   20,000 like everything else, aged by the pure `staleDels`. Distinct from `tombs`
   in every consequence: it syncs, it applies on import, and it **never touches
   `everEvicted`** — after a user delete, "local minus deleted" *is* the intended
   archive, so the device keeps its licence to compact.
2. **A `{t:'d', v:{ids, at}}` row** in the chunk. **Concrete item ids only, never a
   pattern** — a pattern replayed elsewhere would delete matches the user never saw.
   Replay applies it on the sync pull **and** on file import (intent travels with
   the corpus, unlike tombstones), then upserts the ledger with `max(at)`.
3. **The resolution rule is per item and time-based**: an item dies iff
   `touchedAt(item) <= del.at`; an incoming card is suppressed iff the ledger holds
   `del.at >= touchedAt(incoming)`. A card genuinely re-touched *after* the delete
   (re-read, reviewed elsewhere) wins and re-admits — same direction of travel as
   §7.3's "capture always wins". The rule is commutative and idempotent over an
   append-only log ordered by `seq`, so every device converges to the same set
   regardless of replay interleaving.
4. **Compaction is how a delete becomes permanent server-side.** Every snapshot part
   ends with the **full** dels ledger (and the current `g` row, §8.9): the deleted
   cards and their reviews are simply absent from the snapshot, and the riding
   ledger heals any device — including an old client that skipped `d` rows before
   updating — whose cursor was behind the swept rows. A local delete also removes
   the item's local review rows (privacy intent; keeps `introducedToday` honest);
   their copies in old server rows vanish at the next compaction.
5. **Failure directions**, chosen to match §7.3: ledger overflow forgets the oldest
   deletes and a very stale device may re-introduce those cards once. Old clients
   count `d`/`g` rows as `skipped` and keep working. Rules read failure at capture
   time fails **open** (capture proceeds unfiltered) — a genuinely broken storage
   read also loses `learnEnabled === true`, so the realistic broken state captures
   nothing rather than capturing wrongly.

UI copy consequence (Gate B, §10): deletion is described as account-wide —
「删除会同步到所有设备」 — and the 「删了又回来」 case has the explanation "you
touched it again on another device", not a bug report.

### 7.5 持久性与本地备份（2026-08-09）

「升级后状态还在」不是感觉，是逐面测过的事实表（磁盘取证 2026-08-09，模拟器
iPhone 17 Pro；重装 = install over-the-top）：

| 面 | 存储 | 跨升级/重装 | 证据 |
|---|---|---|---|
| App 设置与 key | localStorage（`mt:*`，file:// origin） | ✅ 存活 | 8-07 出生的 `localstorage.sqlite3` 活过 8-09 重装 |
| App 语料/会话 | IndexedDB（file:// origin） | ✅ 存活 | 同上；origin 序列化为 `("file","",nil)`，不含容器路径 |
| 扩展设置与 key | `chrome.storage.local`（bundle id 目录） | ✅ 存活 | key 从未丢过 |
| **扩展语料（+旧制会话）** | IndexedDB（`safari-web-extension://<UUID>`） | ❌ **UUID 轮换即孤儿** | 同一模拟器两个孤儿桶 |

两条只能文档不能修的边界：**dev 构建的扩展存储目录带 `(UNSIGNED)` 后缀**，与
TestFlight/商店签名版不同目录 —— 换签名形态必然分桶，属 OS 身份模型；WebKit 把
IndexedDB Blob 存成文件句柄，容器搬家后句柄悬空（§audio 已用 ArrayBuffer 规避）。

**本地备份（`learn/backup.js`，LearnBackup）** 是对最后一行 ❌ 的救生方案：

- **格式零新增**：就是 `LearnChunk.exportBytes` 的 `mt-learn/1` 字节（含 dels 台账
  与 learnRules），base64 后存 `chrome.storage.local` 单键 `learnBackup`；小键
  `learnBackupMeta` 供节流判断，不反序列化大负载。
- **节奏**：6 小时节流（无备份时必跑），fire-and-forget，空库跳过；体积上限 4MB
  base64（§8.5 的 2 万条全量 ≈ 1.7MB 压缩，含裕量；不申请 `unlimitedStorage`），
  超限跳过并记入 `learnBackupMeta.lastError`，在 options 学习区以 pressure 式一行
  可见 —— 备份失败不是丢失（语料还活着），永不进浏览流。
- **恢复**：扩展页启动时若语料为空且有备份 ⇒ `importBytes` 重放（幂等、应用 dels、
  不打 `syncedAt` —— 恢复出的语料会重新上传，顺带治愈服务器），**先于 drain 与
  进入即同步**：未登录用户由备份兜底，已登录用户随后的 pull 再补齐。
- **清空守卫**：「清空学习库」在 `clearAll()` 后连带删除备份 —— 用户要的清空不许
  下次打开还魂。
- **只在扩展页跑**：App 的 IDB 已实证耐久，而 2–3MB base64 会压垮 shim 的
  localStorage —— App 侧刻意不装（review.js 以 `typeof LearnBackup` 守卫，共享
  字节保持 App 安全）。
- 设置/API key **不进备份**：它们本就在耐久层，双份只添分歧风险，零收益。

## 8. Sync (V3) — hosted, with a fixed free quota

*(Settled 2026-08-04, after two reversals. The design went: our server with E2E →
the user's own cloud folder → **our server, plaintext, fixed quota**. The middle
option was dropped because a browser extension has no settable "data directory":
`showDirectoryPicker` is Chromium-desktop only — not Firefox, not macOS Safari, and
**impossible on iOS**, where an extension cannot reach the Files app or iCloud Drive.
A default path that works on one of five matrix rows, and not the primary one, is not
a default. The reasoning is kept here because it is the kind of thing that looks
attractive again in six months.)*

### 8.1 The shape

- The corpus syncs to **our server**, as the same append-only chunks. Stored in
  **plaintext** (§8.4 — the trust answer is that the project is open source and the
  backend self-hostable, plus §8.2's export).
- **Every account has a fixed free quota** (currently 50 MB, `AGENTS.md` rule 7),
  enforced by a database constraint, never by client-side good behaviour.
- **On reaching it**: stop accepting new card text, keep syncing review progress, say
  so plainly, and offer cleanup (§8.3). **Never silently drop data.**
- Sync is **opt-in**. A signed-out user has a complete product; that is rule 2 and it
  does not bend.
- **Since 2026-08-07 sync has a second job: it is the only way material reaches the
  host app** (§7.2). Both sentences have to be said together, and neither may be
  dropped to make the other sound better:
  - *Signing in is not required to learn.* The extension's review page is complete
    without an account, on every browser. That is what keeps rule 2 intact.
  - *Without signing in, the app has nothing.* Not a degraded app — an empty one.
    Say it in those words, at the point where a user would otherwise wait for cards
    that are never coming.

  What an account buys is therefore **multi-device sync and a one-tap surface**, not
  the feature itself. If that ever inverts, rule 2 has been broken, whatever the
  release notes say.

### 8.2 核心约束 — export stays, and it is not a nicety

> **A one-action export of everything, and an import that restores it, ship with
> sync — not after.** Three independent reasons, any one of which is sufficient:
>
> 1. **It is the data-portability right** (GDPR Art. 20). We now hold the data, so
>    this is no longer optional in the way it was when we held nothing.
> 2. **It is the exit, not a transport.** *(Reworded 2026-08-07.)* This used to read
>    "it is the no-account path — carry the file between your own devices". That is no
>    longer what it is for, and leaving the old wording would have quietly made a file
>    shuttle into the answer for signed-out users.
> 3. **It is the honest answer to "I don't trust you".** That answer must not be
>    "self-host Supabase" — realistically nobody will. It is "take your file and go",
>    and it has to actually work.

**The no-account path is the extension's own review page** (§8.1), not a file. A file
bridge between the extension and the app was considered and dropped on product
grounds, not principle: *nobody imports and exports by hand several times a week to
keep studying.* Building it would satisfy the rule on paper and produce a feature no
one uses, and a feature no one uses is not compliance — it is decoration. **A rule is
kept by the path people actually take.**

> **The export used not to match this section, and now does** *(fixed 2026-08-07)*.
> `chunk.js`'s `build()` filtered through `isGraduated`, and `exportBytes()` goes
> through that same `build()` — so 「一键导出**全部**」 silently omitted the entire
> candidate pool for as long as the filter existed. Nobody noticed because the export
> *worked*: it produced a valid, importable file that was simply missing most of the
> corpus. Reversing §8.5 lever 1 removed the filter and fixed this in the same edit.
>
> The format is the §8.4 chunk format unchanged, so this costs almost nothing to
> provide and would be indefensible to withhold.

### 8.3 Quota pressure — the third state in §7.1

The server quota is the third of the three pressure states §7.1 already describes,
and it reuses that machinery: a line in the review page and settings, with a cleanup
action beside it, never a blocker and never a page-level interruption.

**The quota's real job is anti-abuse, not rationing.** An ordinary account grows at
~3.6 MB/user-year (§8.5), so 50 MB is **~14 years** of daily use — a normal user will
not see it. It exists so that free storage with open sign-up does not quietly become a
file host.

> *(Corrected twice on 2026-08-07, and the second correction matters more than the
> first.)* This first said 「~0.55 MB/人年 ⇒ 约 90 年」, then 「收敛到 ~2 MB 并停在
> 那里」 once compaction was framed as a bound. **The second version was wrong for a
> more interesting reason than the first**: compaction is not something an evicting
> device may safely do (§7.3), and eviction is now on the normal path — so for exactly
> the heaviest users, no bound applies. The plain unbounded number is the one that
> survives contact with §7.3, and it is still comfortable.
>
> Worth keeping the shape of the mistake, since it is the sort that repeats: **the
> second version was more sophisticated than the first and wronger in a way that was
> harder to see.** 「~0.55 MB/人年 ⇒ 约 90 年」 was merely a stale rate. 「收敛到
> ~2 MB」 introduced a *bound* by reasoning about a mechanism (compaction) without
> checking whether that mechanism could actually run — it had no production caller
> (§8.5) and, once §7.3 was worked through, turned out to be unsafe for most accounts
> anyway. A number derived from a mechanism is only as true as the mechanism.

So: build the cleanup path properly, but do **not** build an elaborate
quota-management experience for a state real users will not reach, and do not
advertise "limited storage" as though it were a constraint they will feel.

Cleanup is the same targeted action as local (§7.1): drop `state='known'` cards —
what the scheduler itself concluded you no longer need — never a starred card or one
being actively learned.

### 8.4 Chunk format and transport

```sql
-- 实际落地的表（2026-08-04）。RLS 开启，策略只有 select / insert / delete。
bt_chunks (
  seq        bigint generated always as identity primary key,   -- 服务端分配
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('cards','reviews','sources')),
  blob       bytea not null,                                    -- deflate-raw, 未加密
  generation int  not null default 0,
  created_at timestamptz not null default now())
```

**Row kinds are additive (2026-08-09).** The JSONL body carries `{t, v}` rows;
`fromJsonl` counts an unknown `t` as `skipped` and keeps going, which is what makes
new kinds a compatible extension rather than a format break. The format stays
`mt-learn/1` with five kinds: `s` (source), `c` (card), `r` (review), and since
2026-08-09 `d` (user delete, §7.4) and `g` (governance rules, §8.9). An old client
skips `d`/`g` rows — it merely lags on deletes/rules until it updates, then heals
from the next compaction snapshot, which always carries the full ledger (§7.4).

Two deliberate deviations from the earlier sketch, both discovered while applying it:

- **`seq` is server-assigned (`identity`), not `PRIMARY KEY (user_id, seq)` written by
  the client.** Client-assigned sequence numbers race: two devices pushing at the same
  moment pick the same next number and one insert fails, or worse, silently wins.
  Pull semantics are unchanged — `where user_id = auth.uid() and seq > cursor`.
- **Append-only is enforced by the ABSENCE of an UPDATE policy**, not by client
  discipline. With RLS on and no UPDATE policy, nothing in the system — including our
  own client, including a bug in it — can rewrite a chunk that has been written.
  That is the kind of invariant worth having the database hold rather than a comment.

**Quota is a `BEFORE INSERT` trigger** summing `octet_length(blob)` for that user, and
it raises rather than truncating — `AGENTS.md` rule 7's "enforced by a database
constraint, never by client-side good behaviour" plus "never silently drop data". The
client turns that error into §7.1's pressure state with a cleanup action.

**核心约束 — a push is batched at ~200 cards per chunk** *(promoted from an assumption
to a rule, and implemented, 2026-08-07)*. §8.5 lever 3 had always described chunks as
"~200 cards packed together", but `sync.js`'s `push()` built **one** bundle from
everything fresh and did **one** `insert`. That was harmless while only cards that had
entered the deck travelled — a few hundred at most. With the candidate pool travelling,
a user who has been capturing for three months pushes ~20,000 items the first time they
sign in:

- ~1.7 MB compressed, and PostgREST carries `bytea` as a `\x` hex literal, so the
  **request body is ~3.4 MB** (§8.4's deliberate 2×-on-the-wire trade).
- A single failure loses the whole push; there is no partial progress to resume from.

Batching also gives the surfaces something honest to show, which law 2 (§3) requires:
「已上传 3,400 / 19,800」 rather than one opaque wait.

**`PUSHED` stays all-or-nothing, and that is deliberate.** Advancing it per batch so an
interrupted push resumes looks obviously right and is a trap: `revs` is selected by
`at > since`, and **a review can be older than the card carrying it** (a later re-read
lifts `lastSeenAt`, and `touchedAt` is the max). A partly-advanced watermark would
therefore step over reviews whose card had not been sent yet — silent, permanent loss,
in exchange for saving a retransmit. Idempotent replay already makes the whole-push
retry safe; the cost is bandwidth, and bandwidth is the cheap thing here.

**The same batching applies to compaction**, which writes the entire corpus. Splitting a
snapshot does not weaken what compaction rests on — "a snapshot supersedes everything
below it *because* it is complete" is a property of the SET of rows above the deletion
point, not of there being exactly one row — but **every part must be written before
anything is deleted**, or a failure part-way leaves a hole with nothing below to
recover it. Compaction also now **refuses to run from an empty corpus**: the delete is
justified only by completeness, and a device that has not pulled yet would otherwise
erase the account's whole history on behalf of the one device that knows the least.

### 8.4.1 核心约束 — this project's identity system belongs to the learning layer

As of 2026-08-04 these tables live **in the champagne project**, distinguished by the
`bt_` prefix, and **`auth.users` is ours**. That second half is a decision, recorded
here because it binds the other product:

> Champagne is paused and will not use Supabase Auth. Its three users live in its own
> Prisma `User` table (`Account` / `Session` / `VerificationToken`) and have never
> touched GoTrue — `auth.users` was empty when we took it. **If champagne ever needs a
> Supabase identity system, champagne moves to its own project, not us.**

That is the right way round: we are the only occupant with users under `auth.uid()`,
and RLS on every one of our tables is written against it. Moving the party that has no
GoTrue rows costs nothing; moving the party that does costs every user a
re-registration, because rows can be dumped and moved and auth identities cannot.

**Why the prefix alone could not have settled this.** A prefix namespaces tables; it
cannot namespace identity, because a Supabase project has exactly one `auth.users`.
Two products both using it would share one set of email templates, one JWT secret, one
rate limit, one user list. The decision above removes the second occupant rather than
trying to partition something that does not partition.

**Replacing GoTrue with a self-hosted framework was considered and rejected** (same
day) — it would have made this worse, not better:

- Auth.js / NextAuth and friends **need a server to run on**. We do not have one, and
  §2.1 plus `AGENTS.md` rule 4 make acquiring one a real decision, not a detail.
- PostgREST validates JWTs against the **project's single JWT secret**, which is also
  what `auth.uid()` reads. Handing that secret to a second auth service lets it mint
  valid tokens for the other product's users, and vice versa — promoting an
  inconvenience into each product holding a master key to the other.

**The client still treats the backend as replaceable.** `learn/auth.js` exposes exactly
`signIn / verify / token / signOut / deleteAccount` and is the only module that knows
what GoTrue is; `learn/sync.js` speaks PostgREST and never learns how the token was
obtained. Changing provider — or moving to a dedicated project — is a one-file change
with the sync path untouched.

**Setup consequence, easy to lose:** sign-in is a **6-digit code**, not a magic link —
a link needs a page we host to catch the redirect and we host nothing. The provider's
email template must therefore render `{{ .Token }}`; the stock template sends a link,
and a link cannot be completed from inside an extension.

#### 会话存储位置 — `chrome.storage.local`（2026-08-09，取代旧裁定）

会话（`{accessToken, refreshToken, expiresAt, email, userId}`）存 **`chrome.storage.local`
键 `learnAuth`**，不再存 IndexedDB `meta['auth']`。这推翻了 auth.js 原头注「特意放
IDB，因为内容脚本读得到 storage.local」的理由，依据是磁盘取证（2026-08-09）：

> Safari 给扩展页的 origin 是 `safari-web-extension://<随机UUID>`，**重装/换签名时
> 轮换** —— 装着语料与会话的 IndexedDB 整桶变孤儿，无迁移无报错（同一台模拟器上
> 找到两个孤儿桶实证）。而 `chrome.storage.local` 落在**按扩展 bundle id 命名**的
> 目录里，跨升级存活 —— API key 从来没丢过，正是因为它在这一层。
> 「每次升级都要重新登录」的结构性根因就是会话放错了层。

暴露面权衡，如实陈述：内容脚本理论上可读 `chrome.storage.local`，但本仓库的内容
脚本**只读显式键列表**（`content-main.js` SETTINGS_KEYS，§7 的既有纪律），
**`learnAuth` 永不加入任何 SETTINGS_KEYS / POPUP_KEYS**。页面自身的脚本在隔离世界
之外，本就读不到扩展存储。净效果：会话与 API key 同层同暴露级（§7.2 第 3 条的
风险陈述本来就覆盖明文存储），换来跨升级不重登。

迁移语义（读穿式，一次性）：`load()` 先读 `learnAuth`；没有时读 legacy
`meta['auth']`；读到则采用并回写 `learnAuth`，**回写成功后**才清空 legacy（清除
失败留双份无害 —— 读序上 storage.local 优先，下会话重试清除）。已被 UUID 轮换
孤儿化的旧桶自然迁移落空 = **最后一次重新登录**，此后不再发生。

判死收紧（同日同因修复）：刷新令牌只在**确定性拒绝**（400/401 且带 GoTrue 错误体）
时清会话；离线、5xx、无 body 的 4xx 一律重试一次后抛出而**不登出** —— 离线永远
不是登出理由。存储读取失败也不是「未登录」：`load()` 失败不闩定、下次重试，界面
按 §7 的 page-settings 事故准则显示「存储读取失败」，绝不静默画成登出态。

### 8.4.2 核心约束 — 合并有两种语义，混淆它们就是数据损坏

**2026-08-06 两台真实设备打真实后端跑完整闭环时定下的。** 三条缺陷同源：把
「同一条卡的两次合并」当成了一回事。它们不是。

| 语义 | 谁触发 | dwellMs / seenCount |
|---|---|---|
| **新的观察** | 采集器：这段文字被又读了一次 | **相加**——那是两份独立证据 |
| **同一事实的副本** | 同步重放、文件导入 | **取 max**——同一批经历的拷贝 |

同步会例行地重放**自己**推上去的块（拉取游标不跳过自己写的行），所以相加式合并
会让每一轮同步都把累加量放大。实测：一次重放之后同一条卡的 dwellMs 在两台设备上
是 2639657 对 220812。`sync.js` 压缩逻辑旁边那句「Idempotent replay is what makes
that a non-event rather than a corruption」写的正是这条要求，而代码原本不满足它。

**排程按 `lastReviewAt` 取较新的一方。** 在此之前 `sched` 根本不在 `mergeItem` 的
覆盖列表里，本地排程永远赢：两台设备都有这张卡之后，在 A 上复习完，B 上那张卡照旧
到期。复习日志同步了、排程没同步——而这恰好是多设备学习唯一必须做对的事。

**拉下来的东西不许再推回去。** 重放时给条目盖 `syncedAt` 水印（复习记录则是
`viaSync`），push 只发 `touchedAt > max(PUSHED, syncedAt)` 的东西。没有这道闸门时，
新设备的 PUSHED 是 0，于是它拉完整份语料之后**立刻把整份推回服务器**——用户为同一
份数据在 50 MB 配额里付两次钱，25 MB 的库加一台设备就直接顶满。水印**只在同步路径
盖，不在文件导入路径盖**：导入的语料本来就该上传，盖了会被静默地永远挡在本地。

验收判据是**收敛**：无任何用户活动时，连续多轮双向同步必须稳定在「收到 0 · 上传
0」。这条比任何单点断言都难糊弄——回声、非幂等累加、水位算错，都会让它一直不为零。

### 8.5 Storage cost — three levers (one reversed), and the estimate rule 9 requires

**Assumptions.** Capture runs at ~125/day (§6's measured 100–150) ⇒ ~45,000
captures per user-year; the corpus is hard-capped at 20,000 items, so it turns over
~2.3× a year. A card's `text` + `tr` is ~220 B of plaintext. `dailyNew = 15` ⇒ ~5,000
cards enter the deck per user-year, each accruing ~8 reviews at ~13 B. ~30 cards come
from one page ⇒ ~1,500 sources a year at ~160 B.

| Lever | What it does | Saves |
|---|---|---|
| ~~**1 — sync only cards that entered the deck**~~ | **REVERSED 2026-08-07 — see below.** The candidate pool now travels | ~~~10×~~ |
| **2 — normalize the source** | URL + title is ~160 B, nearly half a card. A `Source` row is shared by every card from the same page (~30 for an article) | 160 B → ~5 B |
| **3 — compress in batches** | Compressing one short sentence is near-useless, so ~200 cards are packed into one immutable chunk and compressed together. Mixed CJK/Latin batches at ~3× | ~3× |
| **4 — append-only + whole-snapshot compaction** | Chunks are only appended. Past a threshold the client pulls everything, rewrites one snapshot chunk, deletes the superseded ones. **No incremental merge machinery** — the local corpus is hard-capped at 20,000 items, so a whole rewrite is affordable | 5,000 rows → ~25 |

#### Why lever 1 was reversed

**A card only enters the deck by being reviewed.** Lever 1's own justification — "the
candidate pool *should* be a product of what you read on this device, while cards you
have started learning *should* follow you" — quietly assumed the deck and the corpus
live on the same device. With the host app (§7.2) they do not, and the assumption
becomes a deadlock:

> Someone who wants to study in the app will not first go and study in the browser.
> So nothing enters their deck → nothing is uploaded → **the app stays empty forever**
> and they never get a first card. The extension meanwhile reports 「同步成功 ·
> 上传 0 张」, which is the worst possible shape: correct, cheerful, and useless.

Uploading the candidate pool is the only thing that breaks the cycle. The cost of
doing so is below; it is real but it is not close to a limit.

#### The estimate rule 9 requires

**Written per user-year** (bandwidth, and what the quota trigger sees):

| | Raw | Compressed |
|---|---|---|
| Captures 45,000 × 220 B | 9.9 MB | **~3.3 MB** |
| Review log 40,000 × 13 B | 520 KB | ~173 KB |
| Sources ~1,500 × 160 B | 240 KB | ~80 KB |
| **Per user-year** | ~10.7 MB | **~3.6 MB** |

**Stored, if lever 4 ever applies** — read the caveat below before using this table;
for an account whose devices evict, it does not apply at all (§7.3). Lever 4 sweeps
every superseded row, and the local corpus cannot exceed 20,000 items, so an account
converges rather than growing:

| | Compressed |
|---|---|
| Snapshot: 20,000 cards | ~1.47 MB |
| + review log, + ~700 sources | ~0.21 MB |
| + up to `COMPACT_AT` (40) increment chunks | ~0.36 MB |
| **Steady state per account** | **~2.1 MB** |

So: ~6.5× the old flow figure. **For planning, use the flow row** — ~3.6 MB/user-year,
i.e. the 50 MB quota in ~14 years, and Supabase's free 500 MB holding roughly **140
account-years** of active use (the 8 GB paid tier ~2,300). The ~2.1 MB ceiling applies
only to an account no device of which has ever evicted, which §7.3 shows is not the
common case.

> **The bound is conditional, and the condition is not met today** *(found
> 2026-08-07 while implementing the batching)*. Every "stored is bounded" claim above
> rests on lever 4, and **`LearnSync.compact()` has no production caller** — it is
> reachable only from the test suite. Nothing schedules it, and `sync()` does not call
> it. Until something does, storage follows the *flow* row (~3.6 MB/user-year,
> unbounded), not the ceiling: an account reaches the 50 MB quota in roughly **14
> years** rather than never.
>
> That is still not a number a real user meets, so this is not urgent — but it is the
> difference between a designed bound and an accident, and the cost model must not be
> read as describing behaviour that no code performs.
>
> **Do not treat this as a gap waiting to be closed by scheduling `compact()`.** §7.3
> settled the eviction conflict the same day and the answer runs the other way: a
> device that has evicted cannot write a complete snapshot, and letting it compact
> would **permanently delete** the material it evicted, for every device. Since
> eviction is now on the normal path, most active accounts will have no device
> eligible to compact at all. **Lever 4 therefore does not apply to the users who
> generate the most data, and the honest number for them is the flow row.** If a bound
> is ever wanted it has to be *server-side* compaction (§7.3), not a client that has
> been made cleverer.

**What the server never stores**: audio, video, images, screenshots, and full page
text. Media is a pointer only — `mediaKey` plus start/end offsets, ~20 bytes.

> **The candidate pool used to be on that list.** It is not any more, and that is a
> privacy change, not a billing one — it is the difference between "the sentences you
> chose to study" and "everything you read". §8.6 is re-argued against the wider
> dataset; do not treat this as a line-item edit.

### 8.6 No end-to-end encryption — decided 2026-08-04, with the door held open

**What is actually stored is not "some sentences" — it is a reading history.** A chunk
carries the sentences and translations, the **source table (URL + title)**, and the
review log (card id, grade, **timestamp**). Together those reconstruct which pages a
person read, when, and which sentences they keep forgetting. The sensitive column is
the URL, not the prose. Any argument about this data that reasons about "just text"
is reasoning about the wrong object.

#### Re-argued 2026-08-07, because the dataset got much wider

This section was decided when only cards that had entered the deck were uploaded —
~5,000 a year, **selected by the user**. Since §8.5 lever 1 was reversed, what leaves
the device is the candidate pool: by §6's own description, **everything you actually
read** — every in-band segment you looked at for 2.5 seconds — at ~45,000 a year, with
URL, title and timestamp.

The difference is a change of kind, not of volume:

| | Before | Now |
|---|---|---|
| Granularity | pages you studied from | **paragraphs you read** |
| Selection | you chose them | the junk filter kept them |
| Reconstructs | a study record | **a reading history, near-complete** |

**The decision does not change, and the reasons it does not are the same ones:** key
management would fall hardest on the users least able to carry it (§2 普惠), a lost key
is unrecoverable, and E2E is mutually exclusive with §2.1. None of that is affected by
the corpus getting wider.

**What does change is what we owe the user, and it changes in three places:**

1. **The disclosure must name the real thing.** Not "the sentences you're studying" —
   **"every sentence you read on a page you translated, in readable form on our
   servers"**. §10 Gate B is rewritten accordingly. A disclosure calibrated to the
   narrower dataset is now inaccurate, and it is inaccurate in our favour, which is
   the kind that costs trust when someone notices.
2. **§8.7's obligations get sharper, not merely restated** — deletion, retention and
   breach notification now cover a reading history rather than a flashcard deck.
3. **The case for optional E2E is materially stronger than it was**, and the `enc`
   door (below) is now the most valuable thing in this section rather than a hedge.
   This does not make it ship; it makes it the first thing to revisit.

**Decision: no E2E for now; optional E2E later; the format door is open today.**

What E2E would buy, stated honestly because it is not nothing:

- A dump of the database becomes noise instead of every user's reading history.
- **It takes us out of the trust chain — which "open source" does not.** Open source
  proves the CLIENT is honest: anyone can read it and confirm what it uploads. It says
  nothing about what runs on our server, which we can change unobserved. And
  self-hosting is not a real option for ~all users; it means running a Supabase. The
  relationship is the other way round from how §8.6 used to put it: **E2E is what
  would make "we are open source" an actual answer**, because then the thing you must
  verify is the client, and the client is verifiable.
- Materially smaller breach exposure (ciphertext, no key). Not zero — we still hold
  email addresses.

What it would cost, and why the cost decided it:

- **Key management would become the hardest UX problem in the product, and it
  collides with §2's free-for-everyone.** The key must reach the second device: a
  recovery code the user will lose, or a password — and login is deliberately
  passwordless OTP precisely to keep friction near zero. Either way, **the users least
  able to manage a key are the ones who would lose everything**, which is the wrong
  people to hand the burden to in a product whose whole premise is 普惠.
- Lost key = permanently unreadable, with support powerless. Value here accrues over
  months.
- **Collides with §2.1** (paid server-side models): a server that cannot read the
  corpus can never run anything over it.
- It is not "we know nothing" regardless: email, upload times, chunk sizes and
  frequency stay in the clear, and that metadata alone shows when someone reads.

**Not a technical obstacle.** `crypto.subtle` is unavailable in content scripts on
plain-http pages (§7), but sync runs entirely in extension pages, which are secure
contexts. Everything blocking this is product cost, not implementation cost.

**What ships today instead: the `enc` field.** Every chunk header declares
`enc: 'none'`, and a reader that meets an `enc` it does not know **refuses with its
own code** (`enc_unsupported`) rather than treating the ciphertext as damaged lines.
Two consequences worth stating, because both are easy to undo by accident:

- **The header line stays plaintext, forever.** Whatever encryption arrives encrypts
  the records, never the header — a reader that cannot decrypt must still be able to
  say *why*. Encrypting the header would turn "update the extension" into "your data
  is corrupt", which sends the user to look for a fault that does not exist.
- **On pull, an unreadable-because-newer chunk STALLS sync and does not advance the
  cursor** (§8.4). This is the opposite of the handling for an unparseable row, and
  the difference is recoverability: a stalled sync resumes after an update, whereas a
  skipped chunk is stepped over permanently and no later version ever gets it back.

> **核心约束 — do not oversell "open source" as the privacy answer.** Being open
> source lets people verify the client. It does not constrain the server, and
> self-hosting is not available to the people who most need the assurance. Until E2E
> exists, the honest sentence is "we can read what you sync" — say that, rather than
> implying the licence protects them.

### 8.7 核心约束 — we hold personal data now, and the obligations are not optional

> **What the plaintext actually is**: the sentences you read, their translations, the
> page URL and title, and when you reviewed them. That is a **reading history** — the
> most sensitive thing this product touches — tied to an email address.
>
> This is personal data under GDPR and 个人信息保护法 (whose Art. 3 extra-territorial
> reach covers PRC residents wherever we run). There is no argument left that we hold
> only opaque bytes; that argument died with the encryption, and pretending otherwise
> would be the dishonest kind of shortcut.

**Build these before the first byte is stored, not after:**

- **RLS on every table**, so one account can never read another's;
- **one-action export** (§8.2) and **one-action deletion** of everything, from
  settings — deletion must remove the account too, not just its rows;
- **breach notification** capability: know what you hold and who to tell;
- **TLS in transit, provider encryption at rest** — table stakes, not features;
- **retention that is stated and honoured**, including what happens to an abandoned
  account.

*This is the engineering shape of the argument, not legal advice. Have it reviewed
before any of it is published as a privacy claim.*

### 8.8 自动同步触发 — 打开即同步，静默失败，手动按钮不动（2026-08-08 (二)）

真机用出来的问题：全仓库只有两个同步触发点，且都是手动按钮（扩展选项页、App 主
页）。用户在浏览器里采集了一周，App 里的库还停在上次点按钮那天 —— 表现为「App 没
有我账号的例句」，实际是**没人扮演心跳**。

**触发模型：页面打开就是心跳，不引入定时器。**

- **扩展**：复习页与选项页打开时，若已登录则自动 `sync()`（推 + 拉），节流
  **10 分钟**（meta `autoSyncAt`，设备本地）。扩展页都是短命页面，打开事件天然
  就是「用户在用」的信号；Safari iOS 的后台 SW 会永久死掉（Critical Safari Bug），
  任何 alarms / 周期任务在主力面上都是假心跳（§12）。
- **App**：启动（及从后台回前台）时，若已登录则自动 `sync()`。App 的拉取本来就
  发生在这两个时刻之后的手动点击里 —— 把点击省掉，语义不变。
- **复习面时效性**：App 是常驻单页，deck 在 bundle 加载时建一次 —— 自动拉取若不
  伴随重建，新材料到了库里、复习面却看不见。因此**进入复习视图时重建 deck**
  （`review.js` 暴露 `start()`，App 进视图时调用）。扩展侧复习页每次打开都是新
  页面，天然重建，行为不变。

**三条规则（规则 1 于 2026-08-09 修订）：**

1. **自动同步可见但不打断（修订，2026-08-09 用户裁定）。** 原文是「静默失败」；
   现在复习页头部有常驻状态行（interaction-spec「多设备同步一致性」），自动路径
   的每个状态——同步中 / 同步完成·时间 / 离线 / 失败 / 未登录——都写进那一行。
   仍然**不弹任何东西、不打断评分**（IO 规则的明确豁免：自动路径没有触发控件）；
   配额满的可见性仍由 §8.3 的压力状态负责。「静默」死掉的原因：离线和失败完全
   不可见，用户只能靠两台设备数字对不上来发现同步断了——正是 2026-08-09 真机
   实测的事故形状。
2. **手动按钮原样保留，语义不变。** 它仍然是「现在就同步，并把结果说给我听」——
   成功报数字、失败报原因。自动路径永远不能替代一条用户能主动拽的绳子。
3. **收敛判据不变。** 自动触发只是把既有 `sync()` 在既有时机之外多调几次；无
   活动时双向同步仍须稳定「收到 0 · 上传 0」。若自动化让 0/0 破了，坏的是
   sync，不是触发器 —— 修那边。

**进入即同步（2026-08-09 用户裁定，追加到触发模型）：** App 启动、App 回前台、
扩展**复习页**每次打开都是「进入」，进入**强制**触发完整 `sync()`
（`autoSync(now, {force:true})`，绕过 10 分钟节流；节流只对被动面——选项页——
继续生效）。`online` 事件视同进入。成功统一盖 `lastSyncOkAt`（手动/自动同戳，
所有「上次同步/同步完成·时间」读它；旧 `appLastSync` 只读回退不迁移）。

**每日新卡预算改为账户级（2026-08-09）：** `newToday` 设备本地 meta 废弃；今天已
引入的新卡数由 `LearnScheduler.introducedToday(reviews, now)` 从**同步的复习台账**
推导——每卡首条非练习复习落在 **UTC 今天**（`todayKey` 一直是 toISOString 取日，
这里把 UTC 日界升格为刻意约定：一个账号一个日界，跨时区一致）。`viaSync` 的复习
**计入**——手机上引入的新卡消耗电脑侧的当日预算，这正是账户级的含义。

### 8.9 治理规则同步（`g` 行）— LWW，整组覆盖（2026-08-09）

`learnRules = {v, block, langs, updatedAt}`（`chrome.storage.local` 单键）随同步
链路走：`push()` 在 `learnRules.updatedAt > PUSHED` 时于末批附一条
`{t:'g', v:learnRules}`；重放（拉取与文件导入皆然）按 **last-writer-wins 整组
覆盖** —— `incoming.updatedAt > local.updatedAt` 才采纳，不做逐条合并。规则集小
（几十条封顶）、编辑是显式用户动作，逐条 CRDT 的复杂度买不来任何东西；两台设备
同分钟内各改一次，后写的赢，先写的在下一次打开设置页时看得见结果并可改回。

- **未登录用户规则留在本地**，功能完整（同步是增值，不是门槛 —— §8.2 同款立场）。
- 规则**不**写入 IndexedDB meta：采集门在内容脚本里跑，内容脚本只有
  `chrome.storage.local`（§7 origin 边界）。App 侧经 chrome-shim 落 localStorage。
- 压实快照携带当前 `g` 行（§7.4 机制 4），游标落后的设备从快照拿到最新规则。
- 读取失败（`PageSettings` `ok:false`）按 §7.4 机制 5 **失败开放**。

## 9. Module map additions

These rows are mirrored into `docs/domain-design.md` §6.

| Module | File | Role |
|---|---|---|
| `LearnModel` | `content/learn-model.js` | pure: content-addressed id (FNV-1a), text normalization, script-aware salience scoring, `Item` factory, shared constants |
| `LearnScheduler` | `content/learn-scheduler.js` | pure: `retrievability` / `nextDue` / `applyReview` / `buildDeck`; `now()` injected, config merged over production `DEFAULTS` |
| `LearnCollector` | `content/learn-collector.js` | the sink (§3): dwell observation via `IntersectionObserver`, salience gate, bounded `lq:` outbox writes. Never originates a translation |
| `LearnStore` | `learn/store.js` + `learn/drain.js` | extension-page-only IndexedDB corpus and the outbox→corpus drain/merge |
| `Reviewer` | `learn/review.{html,css,js}` | the review surface; one implementation for all five matrix rows, hosted **both** in an extension page and in the app's `WKWebView` (domain-design §9.4) |
| `LearnNotes` | `learn/notes.js` *(planned, §9.2)* | 句子解析：生词 / 短语 / 语法点。调用用户配置的 chat 类引擎，结果落 IndexedDB `notes` 表（v4），永不同步 |
| `LearnRules` | `content/learn-rules.js` | pure: URL/domain wildcard matcher, `dominantScript`, whitelist gate `langAllowed` (§4.1), delete selection `doomedFor`, rules LWW merge (§8.9). Registry-injected (`window.MT_LANGS`), zero storage access |
| `SourcesView` | `learn/sources-view.js` | shared 来源管理 renderer (domain-per-row list + block chips), used by options **and** the app shell; ids prefixed `srcm-` |
| Host app | `app/` → `dist-app/` | the one-tap surface on iOS + macOS. **Not a second engine**: `build/app-bundle.js` concatenates the SAME `learn-model.js` / `learn-scheduler.js` / `store.js` / `auth.js` / `chunk.js` / `sync.js` the extension ships, plus `app/app.js`. Stage 2 needs **no host shim at all** — none of those modules touch `chrome.*` at runtime |

> **Why the app is exactly three files.** `safari-project/` is gitignored and gets
> regenerated, which resets the Xcode project's file list (release-checklist #72). The
> converter's App target already references `Main.html`, `Script.js` and `Style.css` —
> so emitting those three names and no others means **the app can grow forever without
> a pbxproj edit**, and regeneration stays routine instead of destructive. The cost is
> a concatenated bundle rather than separate modules; the alternative was
> hand-maintaining an Xcode project or re-meeting "new files never enter the bundle"
> every time. `npm run app:sync` copies them in and patches the one Swift line the
> converter gets wrong for us (`isScrollEnabled`).

---

## 9.1 Speech (TTS)

Registry: `build/tts.config.js` → `content/tts.gen.js` (`window.MT_TTS_ENGINES`).
A **second** registry, deliberately: `build/providers.config.js` is the registry of
*translation* providers (domain-design §7), and folding a different capability into it
would grow every translation entry fields it never uses. The three rules carry over
unchanged — transport keyed by **format** not vendor, the registry is the only place
an engine/model/voice/endpoint is written down, and no runtime region branching.

Two formats cover the whole space:

| type | why it exists |
|---|---|
| `browser` | the platform's `speechSynthesis`. Free, offline, zero-config, **the default**. It only *speaks*: the Web Speech API exposes no way to obtain the audio data, so nothing from this engine can ever be cached or uploaded. That is a property of the API, not a gap to close |
| `speech-compat` | the OpenAI `/v1/audio/speech` request shape — which is also what self-hosted TTS servers implement. **One format therefore covers both "my own machine" and "a cloud key"**, which is exactly what 本地优先 needs |

**Audio is a derived artifact, not content.** Same text + same engine + same voice =
same audio, so the *configuration* is what syncs; each device synthesizes locally.
That is better than syncing audio on every axis that matters: offline, instant,
zero egress, and changing the voice takes effect everywhere at once.

**Local cache** (endpoint engines only): IndexedDB `audio` store, keyed
`hash16(engineId ␀ model ␀ voice ␀ lang ␀ normText)`. Synthesis costs the user money
or CPU and a card is replayed many times, so this is not an optimization — it is what
makes a paid engine usable. Capped (200 MB default) with **least-recently-played**
eviction: `at` is refreshed on every cache *hit*, so the sentences actually being
reviewed stay resident while one-off synthesis ages out.

**The cache key is already the sync key.** When optional audio upload lands (§8),
the local → server → synthesize fallback falls out of this without a migration.

**Measured platform behaviour (2026-08-03, iPhone simulator iOS 17.2, in the real
`safari-web-extension://` page):** `speechSynthesis` is present, `getVoices()`
returns 111 voices (31 of them English), and `LearnTTS.speak()` resolves `ok` with
the utterance's `start` and `end` both firing — **so the on-device engine is fully
usable on iOS, which is what made it safe to keep as the default.** Autoplay without
a user gesture is **refused**; the utterance is dropped silently, which is why
`speak()` waits for `start` rather than trusting a non-throwing call. Not verified:
whether one gesture unlocks autoplay for the rest of the page session.

**Voice selection is language-aware** (§4.1's rule, applied): the user's preferred
voice is used only if it speaks the card's language; otherwise the best system voice
for that language; otherwise **the feature reports itself unavailable with a reason**
rather than reading the sentence in the wrong language.

## 9.2 句子解析 (sentence notes) — 生词、短语、语法（2026-08-08）

答案面新增「解析这句」：用**用户已配置的引擎**为当前句子生成生词表（词 + 释义）、
短语 / 搭配、一个语法点。定位是**句子卡的一个面**，帮助理解——不拆词卡、不单独考、
不进掌握标准（§5.2、§11 的边界都不动）。

- **能力门控，同 domain-design §5.3 规则 1。** 只有 chat 类引擎（`MT_PROVIDERS`
  中 `type` 为 `chat-compat` / `messages-compat`）能做这件事；免费 Google 通道是
  翻译 API，做不了。没配可用引擎时**整个入口不渲染**——能力缺失 = 功能不存在，
  不是灰按钮加解释。
- **按需生成，一次缓存，永不重复扣费。** 结果按卡 id 落 IndexedDB 新 `notes` 表
  （**DB_VERSION 3 → 4**，建表照例带 `contains` 守卫；这是唯一碰用户已有数据的
  改动，`npm run test:idb` 必跑）。重看即时出。UI 注明：「使用你配置的 API，
  一次调用，永久缓存」——成本可预期，绝不自动批量生成。
- **不同步。** 解析是可再生的衍生物：换设备按需重新生成即可。省掉的是 chunk
  格式变更与 50 MB 配额占用（§8.5 的成本模型不因它改一个字）。
- **提示词英文**（同翻译系统提示词的既有惯例），解释语言跟 `uiLang`；要求 JSON
  输出并防御性解析——模型输出不可信是前提，不是意外。
- **提示词必须点名「生词只取自原句」，且缓存带提示词版本号（2026-08-08 (三)）。**
  v1 提示词只说 "given a sentence and its translation"，没规定生词来自哪一侧；
  而 Safari 采集的卡 `lang` 全是 `und`（domain-design §5.3——检测器缺失不是边缘
  情况），模型没有任何学习语言的信号，真机实测把中文**译文**当成了学习对象（英文
  卡解析出带拼音的中文生词）。修正后的提示词明确：生词/短语**逐字取自原句**、
  永不取译文，解释用 `uiLang`。**「永不重复扣费」增加一个刻意的例外**：缓存记录
  带 `v`（提示词版本），版本不符视为未命中、下次点击重新生成——每卡每次版本升级
  至多多扣一次费。版本号只在提示词修正**错误输出**时才允许升，措辞打磨不算。
- 规约走查：用户自己的 key、设备发起、结果不落我们的服务器 —— 规约 1 / 2 / 4 全
  满足，不涉及 §2.1 的付费服务端路径。
- **App 里同样可用（2026-08-08 (二)）**：App 设置页可配 chat 引擎 + key（§7.2 的
  放宽及其三条边界），配了之后同一个能力门自然打开 —— `review.js` 是同一份字节，
  门控逻辑一行不改。App 侧需要把 `providers.gen.js` 进 bundle（注册表仍是唯一
  来源，App 不复述任何引擎名）。不配 key 的 App 维持现状：入口不渲染。

## 10. Privacy statement changes — a release gate, not a follow-up

`README.md`, `README.zh-CN.md` and `belliedmonkey.cc/privacy.html` currently make
claims that the learning layer falsifies. **These edits ship in the same PR as the
code that falsifies them — never before (the feature does not exist yet) and never
after (that is shipping a false statement).** They are listed here so the target is
reviewed once, up front, rather than improvised under release pressure.

### Gate A — ships with V1 (local capture)

Today's text and why it moves:

| Current claim | Status at V1 | Required change |
|---|---|---|
| "**No servers of ours.** … there is no 'we' in the path at all." | **still true** | none |
| "**Your API key never leaves your device.**" | **still true** | none |
| "**What is sent** is the text to be translated. Not the URL, not the page title, …" | **still true** — capture adds zero network traffic | none, but do **not** delete it; it is the sentence that stays true when the next one changes |
| "**No account, no tracking, no telemetry.** Nothing to sign up for." | **no longer complete** | must gain the local-history disclosure below |

Required new bullet, adjacent to the "no account" bullet:

> - **Learning material is built on your device.** If you turn on the learning
>   feature, the extension keeps the sentences you actually read — with the page URL,
>   its title, and how long the text was on screen — in local storage on that device,
>   so it can show them to you again later. It is off until you turn it on, it is
>   never uploaded, and one button erases all of it.

`extension/manifest.json` Firefox `data_collection_permissions.required` stays
`["websiteContent"]` at V1: nothing new is transmitted.

### Gate B — ships with V3 (sync)

*(Rewritten twice on 2026-08-04 as §8 moved: our server → the user's cloud folder →
our server again. That churn is exactly why this gate exists as a written target
rather than as wording improvised at release time. The version below matches the
settled §8: **we host the corpus, in plaintext, under a fixed quota**.)*

- **"No servers of ours in the middle"** (README hero, line 6) and "**No servers of
  ours.** Requests go from your browser to the engine you picked" **stay verbatim** —
  they describe the *translation* path, which is unchanged and still goes straight
  from the browser to the engine the user chose. Do not weaken them to cover sync;
  weakening a true statement to cover a different thing is how a privacy page stops
  meaning anything.
- **"No account, no tracking, no telemetry. Nothing to sign up for."** is the one that
  changes, and it must change honestly. No tracking and no telemetry stay literally
  true. What is added is an **optional account** for syncing, which the extension
  works completely without — and, for people who turn it on, **every sentence they
  read on a translated page is stored on our servers in readable form**, along with
  the page URL, its title and the time. Say it in those words. It is the sentence a
  reader deserves to find without digging.
  *(Sharpened 2026-08-07 per §8.6: this used to say "the corpus", which was accurate
  when only cards you had chosen to study were uploaded. Since the candidate pool
  travels, "the corpus" understates it to the reader's disadvantage.)*
- **A hosted model (§2.1), if it ever ships, is a separate disclosure**: that path
  sends page text through us. Name it as its own exception; never fold it into a
  sentence about sync.
- **The host app needs its own disclosure, and it must not lean on the extension's.**
  *(Added 2026-08-07.)* The app is useless without an account (§7.2), so the person
  reading its App Store page is by definition someone who will sign in — the "works
  completely without an account" sentence that is true of the extension is
  **misleading if it is the first thing they read**. State it the other way round for
  the app: this app syncs your learning corpus through our servers, in readable form;
  the browser extension works without an account and stores everything locally.
  *(This bullet replaces a duplicate of the one above, which had drifted into the
  list twice with slightly different wording — itself a small warning about how a
  privacy statement decays.)*
- **Firefox `data_collection_permissions`** must be re-evaluated against `build.js`
  (which already carries this reminder and a build-time assertion). Syncing transmits
  website content **and** browsing activity, readable on the receiving end, so the
  declaration almost certainly has to grow — and the wording must not lean on "it's
  encrypted", because it is not.
- **App Store privacy labels** must be refilled — adds "User Content"; **not** "Usage
  Data", since there is still no telemetry — and the host app must offer in-app
  **account deletion**, an Apple requirement wherever accounts exist.
- **Export ships with sync, not after** (§8.2). It is simultaneously the portability
  right, the no-account path, and the honest answer to "I don't trust you".
- **`belliedmonkey.cc/privacy.html` lives outside this repo.** Per `AGENTS.md`, look
  its current state up in gbrain first; never infer it from this repository.

#### The exact replacement text (written 2026-08-08, ships WITH sync, not before)

This section used to describe the changes. Descriptions get re-interpreted under
release pressure, which is the thing §10 exists to prevent — so here is the text.

**Nothing below may land early.** With `MT_BACKEND.enabled === false` the current
README is TRUE, and replacing it now would make the project claim it stores a reading
history that it does not store. False in the frightening direction is still false.
`build.js`'s gate enforces exactly this pairing: it blocks `enabled: true` while the
old sentence is present, so the flip is one atomic change.

**README.md § Privacy — four sentences change, and the fourth is the dangerous one:**

| Now | Becomes |
|---|---|
| **No servers of ours.** … We never handle, store or upload your data — there is no "we" in the path at all. | **No servers of ours in the translation path.** Requests go from your browser to the engine you picked. *(Keep the first half verbatim — it is still true and §10 forbids weakening a true statement to cover a different one. Delete only the "there is no 'we' at all" clause, which sync makes false.)* |
| **No account, no tracking, no telemetry.** Nothing to sign up for. | **No tracking, no telemetry — and no account unless you want one.** Syncing your learning material between your own devices needs a free account; everything else works without one. |
| It is off until you turn it on, **it is never uploaded**, and one button erases all of it. | It is off until you turn it on, it stays on your device **unless you turn on sync**, and one button erases all of it. |
| **What is sent** is the text to be translated. Not the URL, not the page title, not the referrer… | **What is sent for translation** is the text, and nothing else — not the URL, not the page title, not the referrer, not any identifier. **What sync sends, if you turn it on, is different and larger: every sentence the extension kept, the page URL and title it came from, and when you reviewed it — in readable form on our servers.** |

The last row is the one to get right. Per §8.6 the corpus is now the candidate pool,
i.e. **everything you read**, not a flashcard deck — a disclosure calibrated to the
narrower dataset would be inaccurate *in our favour*, which is the kind that costs
trust when someone notices.

**One sentence added with 来源治理 (2026-08-09), same gate:** deleting learning
material by source is account-wide — 「删除会同步到所有设备」. It rides wherever the
sync disclosure lives (options 学习/同步 copy and the README sync paragraph), because
a delete that the user believes is local but that propagates — or the reverse — is a
consent error in either direction.

**`manifest.json` → `browser_specific_settings.gecko.data_collection_permissions`:**

```jsonc
{ "required": ["websiteContent", "browsingActivity", "personallyIdentifyingInfo"] }
```

- `browsingActivity` — the source table is URL + title + time. §8.6: "the sensitive
  column is the URL". The current declaration deliberately says *not*
  `browsingActivity`, and that comment must go with it.
- `personallyIdentifyingInfo` — the account is an email address.
- **Firefox is LIVE on AMO** (re-verified 2026-08-08: `status: public`, 1.2.0), so this
  is a change to a published declaration, not a first submission. Growing it is a
  review-visible event; budget for it.

## 11. Out of scope

- **Vocabulary/word cards and word-frequency lists** (§1). The unit is the sentence.
  *(Re-examined 2026-08-08 with the mastery ladder: still out. §9.2's sentence notes
  surface vocabulary and grammar as a FACET of the sentence card — they aid
  understanding, are never separately tested, and never get their own schedule.)*
- **Synthetic speech as a REPLACEMENT for real speech** (§1). A media card always
  replays the original audio; it is never re-read by a synthetic voice. Synthesizing
  speech for *text* cards — which have no original audio — is in scope and specified
  in §9.1.
- **A hosted model as the DEFAULT path** (§2.1). Local/BYO-key is the default and
  stays fully capable; a server-side model is an opt-in paid alternative or it does
  not ship at all.
- **Telemetry and usage analytics**, permanently — unaffected by §2.1.
- **Converting anything already free into paid.** Per `AGENTS.md` rule 8. A paid
  server-side model is a *new* capability, not a conversion, which is the only reason
  it is permitted.
- **ASR** remains out of scope, unchanged from domain-design §8: the learning layer
  consumes transcripts that already exist, it never creates them.
  *(Re-examined 2026-08-08 for the 说 skill and rejected a second time — §12. The
  browser's `SpeechRecognition` ships the user's recordings to vendor servers, which
  the no-telemetry promise cannot absorb. 说 is offered as shadowing with
  self-assessment at the listen tier, labelled as practice, never as verification.)*
- **Auto-capture without consent.** Capture is off until the user turns it on once,
  and can be disabled and purged from settings at any time. See `README.md` — the
  privacy statement is part of the product, not marketing copy.

---

## 12. 否决记录 (rejected alternatives)

*(Added 2026-08-04 by domain review.)* This document used to keep only the surviving
version of each decision. That is how a project re-walks a path it already found
closed: the reasoning is in a chat log nobody reads, so the idea comes back, sounds
reasonable, and costs the same investigation twice. **Every entry below was learned by
trying it.**

Add a row whenever a considered approach is dropped. One line is enough; the reason
matters more than the detail.

| 日期 | 被否的方案 | 为什么不行 |
|---|---|---|
| 2026-08-03 | 订阅制（服务端 LLM 额度 + Stripe/IAP） | 产品决策：改为公益普惠，BYO-key 永远免费。收费只用在成本确实扛不住的地方（`AGENTS.md` 规则 8） |
| 2026-08-03 | 中国版单独构建（阉割功能集） | 产品决策：单一国际版；「我不要做成阉割版」。分发统一见 `domain-design.md` §7 |
| 2026-08-03 | 复习页内嵌 YouTube 播放器重听 | **平台硬限制**：error 153。nocookie/youtube.com × 默认/no-referrer 四种变体全部同样失败，`no-referrer` 那两次也排除了「扩展页被沙箱」的解释。媒体卡改为跳转到时间点。**不要再加 iframe** |
| 2026-08-04 | 端到端加密（原为「无例外」的核心约束） | 密钥管理会把最重的负担压在最不会保管密钥的用户身上，与 §2 普惠正面冲突；且与 §2.1 付费服务端模型互斥。完整得失见 §8.6。**留了 `enc` 信封的门** |
| 2026-08-04 | 同步到用户自己的云盘目录（iCloud / Google Drive） | `showDirectoryPicker` 只有桌面 Chromium 有：Firefox 没有，macOS Safari 没有，**iOS 上根本不可能**——而 iOS 是主力面。浏览器扩展没有可设的「数据目录」 |
| 2026-08-04 | 自建 auth 框架替代 GoTrue（Auth.js 之类） | 需要一台我们运维的服务器；更糟的是 PostgREST 用**项目唯一的** JWT secret 验签，把它交给第二个 auth 服务等于两个产品互持对方的万能钥匙。见 §8.4.1 |
| 2026-08-04 | 与 champagne 共用 Supabase 项目（`bt_` 前缀隔离） | 前缀能隔离表，**隔离不了身份**——一个项目只有一个 `auth.users`。已迁至独立项目（东京）。当时迁移代价为零，因为表里还没有数据；有用户之后同样这一步要每个人重新注册 |
| 2026-08-07 | 扩展经 `sendNativeMessage` 把外发箱排空给 App，由 **App 负责上传** | **不是不可行——尖刺跑通了**（`verification-spec.md` Stage 0，提交 `1f4113a`：内容脚本没有这个 API；background 有，200KB 往返 10ms、热态 ~0.8ms/次，但**冷启动第一次调用必然失败**）。否决理由是**上传进度会落到 App 手里**：用户不打开 App 就可能永远不上传，而扩展连数据到没到服务器都无从得知。改为扩展直传服务器、自己持有 `syncPushedAt`。连带省掉了原生桥、App Group，以及 `safari-project` 重新生成会抹掉手写 Swift 的整个冲突 |
| 2026-08-07 | 扩展退成纯采集器，删掉浏览器端复习页，全部学习入口引导到 App | 未登录用户就没有复习面了，与 `AGENTS.md` 规约 2（不付费不登录也有完整产品）和规约 3（对未登录用户必须完整）正面冲突。保留浏览器复习页之后，登录换来的是**多端同步 + 一个一键可达的面**，而不是功能本身 |
| 2026-08-07 | 用导出/导入文件做扩展↔App 的无账号通道 | **产品判断，不是原则妥协**：没有人会为了继续学习，每周手动导入导出几次。造出来就是没人用的功能，而没人用的功能不叫合规，叫装饰。规约要靠**用户真会走的那条路**来守——那条路是浏览器端自己的复习页（§8.2） |
| 2026-08-08 | 读 / 听 / 写各自独立排程 | `sched` 变三份、同步「按 lastReviewAt 取新」拆三路、复习债 ×3，换来的精度建立在两个本就未经验证的阈值上。一套排程 + 按强度门控题型（§5.2）以十分之一的复杂度覆盖同一目标 |
| 2026-08-08 | 自由练习正常推进排程 | 连点两遍「记得」就能把间隔刷到几个月——掌握变成可以刷出来的假象，恰是「科学验证」的反面。改为不对称规则：答错照实算（遗忘证据任何时刻有效），答对只记录（刚见过就答对证明不了长期记忆）。Anki 对 cram 的处理同理（§5.3） |
| 2026-08-08 | ASR 语音评测（为「说」）——二次否决 | 浏览器 `SpeechRecognition` 把录音送厂商服务器（Chrome→Google、Safari→Apple），与「无遥测」承诺正面冲突；本地 ASR 模型则破坏零依赖。说 = 听懂档的跟读自评，界面明标「练习，不验证」（§5.2） |
| 2026-08-08 (二) | API key 走账号同步通道（凭证进 chunk / 服务器），让 App「登录即有解析」 | §8.6 已裁定服务器无 E2E —— 凭证上服务器等于把泄露半径从一台设备扩到整个服务端，且解析本身是可再生衍生物（§9.2 本来就不同步）。换设备重填一次 key 的代价与收益相称。App 侧改为本地配置（§7.2） |
| 2026-08-08 (二) | 后台定时自动同步（`chrome.alarms` / 周期任务 / App 后台刷新） | Safari iOS 的后台 SW 锁屏后永久 `undefined`（Critical Safari Bug），主力面上定时器就是假心跳 —— 表上有、实际不跑，比没有更糟（用户以为在同步）。页面打开事件才是真实可靠的「用户在用」信号，且免去一整类不可见失败面（§8.8） |
