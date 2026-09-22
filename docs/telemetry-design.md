# Telemetry design — anonymous usage events（匿名用量事件）

> Status: **design approved 2026-09-05; backend (PR-D1) live; client + copy (PR-D2/D3) implemented the same day.**
> **2026-09-10 amendment（第八期，待人评审）**：加第六问（§1）、`translate_fail.code` 加 `auth`、新事件
> `rate_prompt` / `ext_banner`（§3）、修 `translate_ok` 的 Seam、§8 的 smoke 断言这次真正落地并加自动化守卫。
> 起因写在 §3.1。
> **2026-09-19 amendment（二，同日用户评审通过）**：`translate_ok.kind` 加 `quick`（Mac 快速翻译）；iOS 系统翻译扩展**不发**任何事件（§3.5）。
> **2026-09-19 amendment（当日用户裁定通过；A、B 两条都发）**：§3 表的 Seam 一列进注册表、由 `npm test` 对着代码核（§3.4）——
> 起因是 1.12.x 首次回读时同一种洞第三次发作：三个事件登记了却没有发送点。事件、属性、枚举值**一个不加**。
> **2026-09-17**：`asr_entry` 加 `popup_app_row` / `to_app`（实时档下掉后的去 App 出口），起因写在 §3.3.2。
> **2026-09-16 amendment（第十二期，4 条已由用户裁定通过）**：新事件 `engine_test`（引擎测试整个是盲区）；
> `engine_set` 的判据从「选了下拉」改成 `EngineState.needsSetup`；`asr_entry.surface` 加 `app_home`；
> 澄清 App 的听译/实时字幕出译文归 `translate_ok{kind:'subtitle'}`（不新增 kind），以及补译文**不发**
> `translate_ok`。起因写在 §3.3。Governed by
> `AGENTS.md` rule 4 (amended the same day) and released through
> `docs/learning-design.md` §10 **Gate D**. The event whitelist in §3 is a
> domain-design artifact: adding an event, a property, or a join is a change to this
> document first, reviewed by a human, then code.

## 0. Why this exists (issue #174, answered)

Until 2026-09-05 the product had **zero** telemetry, by constitution. Everything called
"measurement" (`scripts/store-stats.js`, `asc.js reviews`, direct Supabase queries)
reads what stores hand to their operators; not one byte ever left a user's device
unasked. The cost was paid silently: 75 sync accounts, 54 of which never produced a
single card, and no way to say why. The owner's decision, in their words: 「就算改隐私
描述，改卖点我都要做遥测。」

Three decisions were taken with it: **on by default, switch in settings** ·
**activation funnel + retention + translation-failure diagnostics; no site hostnames**
· **our own Supabase, no third party**.

## 1. The five questions the data must answer

| Question | Today | Events |
|---|---|---|
| Of the people who installed, how many configured an engine and translated something? | unknown | `engine_set` `translate_ok` |
| Where do translations fail — which engine, which error? | only when someone writes in | `translate_fail` |
| How many people still use it (DAU / WAU / retention)? | Apple gives downloads; AMO says 3 | `heartbeat` |
| Where does the learning loop break? | unknown | `capture_first` `review_session` `sync_on` |
| Safari vs Chrome vs the app — what share? | guessed from an unset WKWebView UA (#175) | `host` on every event |
| **(6, 2026-09-10)** When we ask the user for something — rate us, turn the extension on — is the ask ever *seen*, and does anyone act on it? | unknown: App Store 评分 5 天里 0 条，`review_session` 0 条，而我们不知道提示有没有出现过 | `rate_prompt` `ext_banner` |

If a proposed event does not serve one of these rows, it does not go in.

第六问是 2026-09-10 加的，不是原五问的注脚：前五问量的是**用户做了什么**，第六问量的是
**我们的提示做了什么** —— 一个从未被看见的提示与一个被看见却没人点的提示，对产品是两种
完全不同的病，而没有这一行两者都记成「评分为 0」。它只准放**提示的曝光与点击**，永远不带
提示的内容、页面、或用户输入。

## 2. Principles（写进规则 4 的那几条）

1. **Events, never content.** Never sent: source text, translations, page URLs, page
   titles, hostnames, API keys, emails, account ids, and the server's own error text
   (`serverMessage` can quote user text).
2. **One random id per device**, a UUID in `chrome.storage.local`, **never joined to an
   account**: events carry no `user_id`, and the server has no column that could link an
   `install_id` to `auth.users`. Turning the switch off = delete the local id, send one
   final `telemetry_off`, and the server deletes every row for that id.
3. **No third party.** Straight into our own Supabase; no SDK, no GA, no PostHog. "No
   third-party analytics" stays literally true; "no telemetry" is the sentence that changes.
4. **On by default, off in one switch, said up front.** One sentence in onboarding, a
   switch in settings, a privacy-page section listing every field.
5. **The event set is a whitelist.** Same rule as the provider registry: one place,
   reviewed, nothing restated elsewhere.
6. **The China flavor sends nothing.** `belliedmonkey.com` promises 「『无遥测』是长期承诺
   ……不随版本变化」 in writing, the domestic backend is not ready, and anonymous events
   crossing the border are not a conversation worth having under PIPL. The china build
   strips the module and the URL; the sentence stays true.
7. **台账 ≠ 遥测**（2026-09-08，免费额度）。`bt_grants` / `bt_grant_usage` 记的是账号 ↔ 花费
   （kind、cost、ms，**没有内容列**）—— 账号级数据，归 learning-design §8.7/§8.10 管；中继
   转发的文本不进任何表、不进日志。遥测这边只多两个**匿名**事件（领了 / 用完了），不带金额，
   且服务器上没有任何一列能把 `install_id` 连到 `bt_grants`。

## 3. Event whitelist v1

**On every event:** `install_id` · `ts` (client time, rounded to the minute) · `v`
(extension version) · `flavor` · `host` (`safari | chrome | firefox | app`, from
`MTFeedback.host()`) · `device` (`iPhone | iPad | Mac | Windows | Android | Linux`,
from `MTFeedback.device()`) · `ui` (UI language, coarse: `zh`, `en`, …).

| Event | Props | When | Seam (located 2026-09-05) |
|---|---|---|---|
| `installed` | — | the id is first generated | telemetry module first init |
| `heartbeat` | — | at most once per calendar day | any extension page / content script init, keyed by a local date stamp |
| `onboarding_done` | `surface: ext \| app` · `result: done \| skipped` · `step`（离开时停在哪一屏，取值与两个宿主的屏序数组同源） | 引导**离开**时 —— 走完与跳过都发，靠 `result` 分开（2026-09-22，§3.6） | `extension/onboard/onboard.js` `finish()` · `app/app.js` `obFinish()` |
| `engine_set` | `provider` | **配置真的完成了**（不是「在下拉里选了一下」） | `options.js` 的 `saveAll()` 末尾（`maybeTrackEngineSet`）· `app/settings.js` 的 `trackEngineSet()`（一键卡**与领免费额度**两条路都走它，§3.4）。**判据是 `EngineState.needsSetup`**，两个宿主同一个出口，不另写一份。2026-09-16 修正：此前挂在 provider 的 `change` 上，点开下拉就记一条 —— 理由见 §3.3 |
| `engine_test` | `slot: chat \| notes \| tts \| stt` · `result: ok \| fail` · `code`（失败时，**自己的**枚举，见 §3.3.1） | 用户点了一次「测试」并拿到结果（2026-09-16 用户裁定） | `learn/engine-test.js` 的**导出处**（`probe()` 包住四个方法）——设置页 / 字段行 / 一键卡 / 引导页都调这四个函数，包在这一层一处覆盖全部，也覆盖 App（该文件在 App 包里）。不带 key、不带端点、**不带 `serverMessage`**（它会引用用户输入，原则 1 明禁） |
| `translate_ok` | `provider` `kind: page \| subtitle \| doc` `ms` | **once per page session** (first translation painted), never per paragraph | `content-webpage.js` `makeEngine().onOk`（`okSent` 每会话一次；2026-09-10 修正，此前写的 `tick()` 与代码不符）· `subtitle-adapter.js` `onOk` · `learn/doc-view.js` `onOk`（`kind:'doc'`，两宿主同一份字节）· **App 的听译/实时字幕（2026-09-16）**：`app/listen.js` 定稿出译文处，`kind:'subtitle'` —— **不新增 kind**，理由见 §3.3 |
| `translate_fail` | `provider` `code` `status` (number only) `route` `ms` | a request fails for good | `translation-core.js` where `it._err = true`; `code` ∈ `timeout / network / http / reasoning_starved / no_base / unknown_provider / credit_exhausted / grant_unavailable / model_not_allowed / auth` from `translation-api.js`（`credit_*`/`grant_*`/`model_*` 来自免费额度中继，§8.10；**`auth`** = 2026-09-10 加：HTTP 401/403 且请求带了**非空、非额度令牌**的 key —— 「这把 key 被服务商拒绝」，引擎停机，见 §3.1） · **2026-09-19（§3.4 裁定 A、B）**：`app/listen.js` 定稿句译文失败处（每会话每 code 一条）· `learn/doc-view.js` 的 `onFail`（每页一条，两宿主同一份字节） |
| `subtitle_on` | `site: youtube \| substack \| podcast \| other` (a **class**, not a domain) | a subtitle session starts | `subtitle-adapter.js` `setActive(true)` |
| `capture_first` | — | first capture ever written on this install | `learn-collector.js` inside the write-success callback — **never** on the failure path (Collector law 2) |
| `doc_open` | `kind: pdf \| docx \| txt \| image` · `pages` (int) | a document is opened in the reader（2026-09-11，learning-design §9.7）；`translate_ok{kind:'doc'}` 是该文档第一页译文落地那一次 | `learn/doc-view.js` 打开文档处（两个宿主同一份代码）。不带文件名、字数、页文本 —— 只回答「有没有人用、文档多大」 |
| `review_session` | `graded` | a deck is finished | `review.js` `!deck.length` branch, same spot as the rating prompt |
| `grant_claimed` | — | 一次**新的**领取成功（服务端回 `reused` 的不记：读余额、重新登录拿回同一枚） | `learn/grant.js` 的 `claim()` 落定处 —— 两宿主同一份字节，不在调用方（§3.4） |
| `grant_exhausted` | — | 首次因额度用完而翻译失败（每装机一次） | `learn/telemetry.js` 内部：`translate_fail{code:'credit_exhausted'}` 经过 `track()` 时带出（§3.4） |
| `sync_on` | — | first successful sync (once per install) | subscribe to `sync.js` `onStatus` `done` |
| `rate_prompt` | `action: shown \| tap \| dismiss` | 译文末尾那一行评分提示被挂上 / 被点 / 被关（2026-09-10，§3.1） | `content-webpage.js` `tick()` 挂行处（shown）与行内两个 click handler；`shown` 每装机每次挂上一条，挂上即等于 `mtRatingAskedAt` 落盘，所以一装机 90 天内至多一组 |
| `ext_banner` | `action: shown \| setup \| done` | App 首页「扩展还没打开」横幅显示 / 点「在 Safari 里打开扩展」/ 点「我已打开」（2026-09-10，§3.1） | `app/app.js` `paintExtBanner()`（`shown` 按 `tm:extBannerDay` 每日一条）与两个按钮的 listener |
| `asr_entry` | `surface: popup \| notice \| pill \| app_home \| popup_app_row` · `result: started \| no_media \| no_engine \| no_live \| gesture_needed \| to_app` | 用户从某个入口尝试开始转写，**或选择去 App 听**（2026-09-11，§3.2；09-16 加 `app_home`；09-17 加 `popup_app_row` / `to_app`，§3.3.2） | `asr-source.js` `startFrom(surface, …)` 与 `appPointer()`（`to_app`）· `content-main.js` `transcribeMedia` 找不到媒体处（`no_media`）· `popup.js` 的常驻 App 行（`popup_app_row`）· `app/listen.js` `open()`（`app_home`+`started`）与 `app/app.js` 的 need-live-go（`app_home`+`no_live`）。**`gesture_needed` 保留但不再产生** —— 那套机制随 Tier B 下掉（domain-design §2.4 第 3 条），枚举留着是因为历史行还在表里 |
| `telemetry_off` | — | the user turns the switch off | settings switch `change` |

**免费额度的两条已于 2026-09-08（G2）进注册表**，见上表的 `grant_claimed` 与
`grant_exhausted`。两条都无属性：需要的只是「多少人领了」与「多少人用完了」。
`translate_fail.code` 的枚举同时加了 `credit_exhausted`（402）、`model_not_allowed`
（403 钉住模型）、`grant_unavailable`（503 池空）—— 不在枚举里的 code 会被客户端白名单
**静默丢掉**，于是「有多少人用完了」这个数永远是 0，而那正是判断这笔钱该不该继续花的
唯一依据。台账与遥测**永不 join**（原则 7）。

### 3.1 2026-09-10 amendment（第八期：评分为 0 的真因是激活）

三件事，全部来自 09-05 → 09-10 这 5 天的 900 条事件：

1. **测量本身有洞。** `learn/telemetry.js` 只在 YouTube 那块 `content_scripts` 里，`<all_urls>` 块
   没有 —— 普通网页上 `MTTelemetry` 是 undefined，`translate_ok{kind:page}` 只可能从 youtube.com
   发出。「118 台装机只有 9 台翻成功过」这个漏斗数是漏统计的。修法是把模块加进 `<all_urls>` 块
   （代码改动，PR1），本文档不变；顺带把 `translate_ok` 的 Seam 改对（上表）。
2. **`auth`**：317 条 `translate_fail` 里 308 条来自同一台 Chrome —— 一把错的 key，401，每个段落
   砸一次，5 天 308 次，界面上没有一个「key 被拒了」的停机出口（`credit_exhausted` 有 halt，401 没有）。
   `code:'auth'` 的判据是 **401 或 403，且请求头带了非空的 key，且那把 key 不是额度令牌**
   （`Bearer bmg_…` 是中继的，上游 401 透传时不能把领额度的人送去改一把不存在的 key）；免费
   Google 通道不带 key，它的 4xx 仍是 `http`。停机后同一装机不会再发请求，所以这个码在一个页面
   会话里的条数 ≤ 停机那一刻在飞的并发数。
3. **`rate_prompt` / `ext_banner`**：出口早就出货了（#185，1.7.15），评分仍为 0 是因为唯一触发点
   （App 里刷完一轮复习 ≥ 3 张）5 天里一次没发生；App 装机 72、Safari 扩展装机 25，装了 App 的人
   大多没把扩展打开。两个提示各自要能回答「被看见了吗、有人点吗」—— 这是 §1 的第六问。
   两个事件都**只有一个枚举属性**，不带页面、不带文案、不带任何输入。

### 3.2 2026-09-11 amendment（第九期：实时转写入口）

转写功能上线以来**零遥测**：入口有没有被看见、有没有人点、点了停在哪一档，一条数据都没有。
`asr_entry` 只有两个枚举属性：`surface`（从哪个入口：弹窗 / 叠层通知行 / 页内「再点一次」）与
`result`（开始了 / 没找到媒体 / 没配引擎 / 引擎没有实时接口 / Safari 需要页内手势）。不带媒体
URL、不带 frame href（探针上报给弹窗的 href 只在客户端用于「新标签页打开」，不进事件）、不带
引擎 id（引擎已在 `engine_set`）。它回答 §1 的第一问（激活：多少人真的走到了转写）与第六问
（这个入口被看见了吗）。

### 3.3 2026-09-16 amendment（第十二期：装机最多的那个面是黑的）

起因是一次「现在有哪些活跃用户」的例行查询。`bt_events` 里 **App 宿主 138 台装机（占全部
244 台的 57%）**，除 `installed` / `heartbeat` / `ext_banner` / `onboarding_done` /
`sync_on` 外**一条核心事件都没有**。静态查实：不是没人用，是这些 seam 在 App 侧**代码层面
就不存在**——

| 事件 | App 里的发送点 | |
|---|---|---|
| `engine_set` | 只在 `extension/options/options.js`；`app/settings.js` 一处都没有 | ❌ 缺口 |
| `capture_first` | 只在 `content/learn-collector.js`，内容脚本不进 App 包 | ❌ 缺口 |
| `translate_ok` | 只有 `doc-view.js`（文档）；听译 / 实时字幕 / 补译文零 seam | ❌ 缺口 |
| `asr_entry` | 只在内容脚本；App 的实时字幕是 `app/listen*.js` 另一套 | ❌ 缺口 |
| `review_session` | `review.js` 在 App 包里，能发 | ✅ 真的没人刷完一轮 |
| `doc_open` | `doc-view.js`，两宿主的 `track` 都接了 | ✅ 真的没人开过文档 |

**这是 §3.1 第 1 条那次 `<all_urls>` 漏统计的第二次发作**，而且更贵：漏掉的是装机最多的面，
后果是 §1 第一问的激活漏斗在 App 上整条是黑的，而且数字看上去像「用户不活跃」——
一个从未被接线的 seam 与一个没人触发的 seam，在表里都记成 0，这正是 §1 第六问那条教训的
另一种形状。**凡是新宿主上线，都要逐条问「这个事件在这个宿主有发送点吗」，不能假定同名模块
进了包就等于接上了。**

三条判断，两条不动白名单：

1. **App 的听译 / 实时字幕出译文 ⇒ `translate_ok{kind:'subtitle'}`，不新增 kind。**
   领域设计里已经有这条先例：`listen-core.js` 的语料锚点「字幕句子沿用 `k:'conv'`
   （不新增 kind），只多一个 `mode`」（learning-design §9.8）。同理，每条事件都带 `host`，
   于是 `host='app'` + `kind='subtitle'` 本就唯一地指向 App 的听译/字幕，而
   `host='safari'` + `kind='subtitle'` 是网页视频字幕 —— **不需要第四个 kind 就已经分得开**。
   少一个枚举值，就少一处会和 `host` 打架的维度。
2. **`translate-fill.js` 的补译文不发 `translate_ok`。** 它是学习层给一张已捕获的卡片补一个
   译文（§9.5），不是一次用户发起的翻译会话；而 `translate_ok` 的定义是「一次会话里第一次
   译文落地」。把它算进来会让激活漏斗的分子里混进后台动作，比漏掉它更糟。**结论是不做**，
   写在这里是为了下次有人再问时不必重新推一遍。
3. **`asr_entry.surface` 加 `app_home`。** 理由见 §3 表格那行：App 的听译/实时字幕不经过
   `asr-source.js`，现有 `popup | notice | pill` 三个值都是网页里的入口，一个都落不到 App
   首页那两张模式卡头上。

### 3.3.1 激活漏斗的第二个洞：引擎测试是盲区，而 `engine_set` 在说谎

同一次排查里翻出来的，比 App 那个洞更贵，因为它**污染的是已有的数**而不只是缺数。

**`engine_set` 记的是「在下拉里选了一下」，不是「配好了」。** 它挂在 provider 的 `change` 上，
key 一个字没填也记一条。而本仓早就写明过判据（`quick-setup.js` §「空」的判据）：

> 非空 key 是「用户有意配过」的**唯一无歧义证据**。provider 不能当判据 ——「选了 google」
> 与「从没碰过」在存储里一模一样。

遥测里的后果：7 台「配了 `openai`」的装机，6 台从没翻译过，**且一条失败记录都没有**。
那不是「配好了不用」，是根本没配完 —— 激活漏斗的分母虚高，卡点被记错了位置。对照组很刺眼：

| 配置方式 | 要填 key | 装机 | 翻成功 |
|---|---|---|---|
| 免费额度 `grant` | **不用** | 12 | **10（83%）** |
| 自带 key `openrouter` | 要 | 13 | 5（38%） |
| 自带 key `openai` | 要 | 7 | 1（14%） |

**而「填 key → 点测试 → 失败 → 放弃」这一整段没有任何事件。** `learn/engine-test.js` 零遥测，
四个调用方全在激活路径上，其中一个就是**引导页**。于是漏斗上最关键的一跳——人有没有跨过
「配一把能用的 key」——我们既看不见成功，也看不见失败。

两条改法，性质不同：

- **`engine_set` 改判据**（不动白名单，只改 Seam）：调 `EngineState.needsSetup`，挂在
  `saveAll()` 末尾——保存是所有配置路径的唯一汇合处。两个宿主同一个出口，不另写一份判据。
  **已在 #293 落地**。注意这改变了该事件的语义，与 09-16 之前的历史数据不可直接比。
- **新事件 `engine_test`**（动白名单；2026-09-16 用户裁定「做」，已进 §3 的表）。
  它回答的是 §1 第一问里一直缺的那半：**人卡在配置这一步，是因为没试，还是因为试了不通。**
  不带 key、不带端点、不带服务器原文——`serverMessage` 可能引用用户输入，原则 1 已禁。

  落地时与提案有**两处偏离**，都是实现时才看清的：

  1. **`code` 用自己的枚举，不复用 `translate_fail.code`。** `engine-test.js` 抛的码
     有一半不在那张表里（`no_key` / `bad_url` / `no_path` / `bad_output` / `empty_audio`…），
     而那几个恰恰最有价值——「没填 key 就点了测试」「地址写错了」正是我们要找的卡点。
     不在枚举里的 code 会被客户端白名单**静默丢掉**，于是失败原因分布会是一片空白：
     这就是 `credit_exhausted` 那条教训的原样重演。`other` 兜住 `reason()` 的 default 分支。
  2. **slot 多一个 `notes`。** 笔记解析引擎是独立的一槽（App 设置页有自己的下拉），
     并进 `chat` 会把两件事记成一件。
  3. **Seam 从「四个调用方」收到「`engine-test.js` 的导出处」**：四个页面都调同样这四个
     函数，包在导出处一处覆盖全部，还顺带覆盖了 App —— 比在四个调用方各接一次少三份
     会漂的副本。

**为什么这一行还没进 §3 的表**（下一个提案的人会撞上同一件事，写在这里省一轮）：
`test/telemetry-registry.test.js` 用正则从 §3 的表里抓事件名，与 `build/telemetry.config.js`
**双向**比对——文档有而注册表没有，同样红。所以「新增事件」的正确流程不是「docs PR 先改表」，
而是：**docs PR 只写提案（不进表）→ 人评审 → 一个 PR 同时改表 + 注册表 + 生成物 + 代码**。
本 PR 另外两处改动不受影响：`engine_set` 是改已有行的判据，`asr_entry.surface` 是加枚举值，
门禁只认事件名。**另注**：那条正则认的是「行首 `| \`x\` |`」这个形状，所以本文档里任何表格
的第一格都不要写成孤零零一个反引号词——引擎名 `openai` 会被当成事件名（本节那张对比表
因此在第一格加了「自带 key」前缀）。

落地顺序（本文档合并之后）：`build/telemetry.config.js`（唯一登记处）→
`node scripts/gen-telemetry.js` 重新生成 → 服务端 `bt-ingest` 随之更新 →
`test/telemetry-registry.test.js` 钉两边一致。判断 1、2 与 `engine_set` / `capture_first`
两处缺口**不动白名单**，已在 PR #293 先行落地。

### 3.3.2 2026-09-17：去 App 的那两处点击要有自己的名字

实时档从扩展端下掉之后（domain-design §2.4 第 3 条），扩展里多了两处「去 App」的点击：
弹窗里那条**常驻**的「用 App 听设备的声音」，以及走不通的媒体落到的那个出口。

第一版把它们记成 `asr_entry{result:'no_media'}` —— 拿「这一页没找到媒体」冒充「用户选择
去 App 听」。**这与 `engine_set` 那次语义漂移是同一型**（§3.3.1）：一个值被借去表示另一件事，
两件事从此在数据里分不开，而且旧数据看起来完全正常。所以给它们自己的名字：

- **`result: 'to_app'`** —— 用户点了去 App 的出口。它与 `started`（在扩展里开始转写）是
  互斥的两件事；合并记录等于放弃「下掉实时档之后，人是留在扩展里还是去了 App」这个问题。
- **`surface: 'popup_app_row'`** —— 弹窗里那条常驻行，与 `notice`（页内走不通时的出口）
  分开。两者回答的问题不同：一个是「主动发现」，一个是「撞墙之后」。这正是免费额度那次
  学到的 —— 83% vs 14% 的差距是**按入口**劈开才看见的。

**`gesture_needed` 保留但不再产生。** Safari 页内手势那套机制随 Tier B 一起下掉了。枚举留在
表里是因为历史行还在（180 天保留期内），删掉枚举会让那些行读不回来 —— **白名单同时是读的
契约，不只是写的闸门。**

### 3.3.3 2026-09-17：实时转写固定为设备内置 —— 白名单不变，两个值改含义（待人评审）

云端实时引擎下线、实时转写固定为本机（learning-design §9.6 门控 2026-09-17 修订）之后，**不加事件、不加
属性、不加值**。变的是两个既有值的含义，写在这里免得下次读数时按旧义解：

- **`asr_entry.result: 'no_live'`**（`surface: 'app_home'`）—— 原义「转写引擎没有实时接口 / 没填 key」，
  现在只可能是「本机识别器不可用」（系统太旧或语言不支持）。它仍回答同一个问题「首页入口灰了多少次」，
  所以不改名；但 09-17 前后的 `no_live` **不可比** —— 之前含配置问题，之后不含。
- **`engine_test.code: 'device_no_file'`** —— 随 `device` STT 注册表条目一起**不可达**（说题下拉里没有本机项了）。
  枚举保留（读的契约，同上一节），文档注明它自 09-17 起应恒为 0；如果不是 0，那是旧客户端还在跑。
- `engine_test.slot` **不加 `stt_live`**：上午两槽方案里要加的那个值，随方案一起作废。

### 3.4 2026-09-19 amendment：Seam 一列要能自己变红（当日用户裁定通过）

**起因。** 1.12.0 带着 §3.3 的四条裁定出货。09-19 首次回读（出货约 1.5 天），逐个事件、逐个
宿主核发送点，又是发送点不存在：

| 事件 | 本文档 §3 写的 Seam | 代码里实际的 | 后果 |
|---|---|---|---|
| `grant_claimed` | `learn/grant.js` 的 `claim()` 落定处（两宿主同一份字节） | 只在 `extension/options/options.js` 领取按钮的 handler 里；`app/settings.js` 的领取路径没有 | App 的领取恒为 0（1.12.x：App 0 条，safari 3 条）。App 是装机最多的面，账号侧 `bt_grants` 每天新领 2–6 个，其中多少来自 App 无从得知 |
| `engine_set`（领取这条路） | `app/settings.js` 的 `applyQuickSetup` | App 的领取路径直接 `set(plan.writes)`，不经 `applyQuickSetup` | 在 App 里领了额度 = 配好了引擎，却不记 `engine_set`。§3.3 补的 seam 只接住了一键卡；#293 的依据「一键卡是 App 里设置主翻译引擎的唯一入口」当时就不成立 |
| `translate_ok{kind:'subtitle'}`（App） | `app/listen.js` 定稿出译文处（§3.3 裁定 1，09-16 写进上表） | 没有 | 1.12.x 有 7 台 App 开始了听译，译文事件 0 条 |
| `grant_exhausted` | 收到 `credit_exhausted` 且余额判定用完处 | **全仓库零发送点**（两个宿主都没有） | 线上表 0 行。而 §3 自己写着这个数是「判断这笔钱该不该继续花的唯一依据」—— 09-08 进注册表至今从未被量过 |

> **更正（同日）。** 这一节的初稿写「#297 把『免费开始』提成了 App 引导的默认路径，于是流量被
> 引向一条没有读数的路」—— **错的**。first grant 分流屏在**扩展**的引导页
> （`extension/onboard/`），领取落在扩展设置页，那条路上 `grant_claimed` 与 `engine_set` 一直
> 在发；#297 的效果在扩展一侧是量得到的（只是样本还小）。量不到的是 App 设置页里那张额度卡。
> 错因与本节要治的是同一种病：没去读代码，凭一句待办摘要就断言了「哪个宿主」。留下这段更正
> 而不是悄悄改掉，是因为它正好说明为什么「哪个宿主有发送点」不能靠人记。

同一次核对里顺带查到、需要裁定的两处（不是漏接线，是从未决定过）：`translate_fail` 在
App 的听译 / 实时字幕，以及在文档阅读器（两宿主）都没有发送点 —— 于是这两条路只有成功数、
没有失败数，成功率算不出来。

**为什么每一道门禁都是绿的。** 现有的遥测门禁守三件事：白名单与服务端一致、白名单里没有
内容/身份字段（`telemetry-registry.test.js`）、`MTTelemetry` 模块自己的行为
（`telemetry.test.js`）。**没有任何一道守「这个事件有人调用」。** 一个登记了却没接线的事件，
对所有测试来说与「一切正常」无法区分；到了线上，与「没人触发」同样是 0。§3.3 已经写下
「凡是新宿主上线，都要逐条问这个事件在这个宿主有发送点吗」—— 那是一句话，不是门禁，
三天后就复发了。上表第 1、3 行更直接：**文档的 Seam 一列与代码不一致，而没有任何东西在比对它们。**

另有一处流程上的原因：§3.3 裁定 1 的结论是「不动白名单」，于是它没有走「改注册表 → 重生成
→ 部署 bt-ingest」那条有清单的路，也没有留下代码侧的待办；裁定随文档合并，待办按「PR 合并」
标了完成。

**修法（本次修订的全部内容）：Seam 一列进注册表，由 `npm test` 对着代码核。**

1. `build/telemetry.config.js` 每个事件加 `seams`：一个数组，每项
   `{ host: 'ext' | 'app', file, match? }` —— `file` 是仓库内路径，`match` 是可选的、
   必须与调用同现的字面量（如 `kind: 'subtitle'`），用来区分同名事件的不同表面。两宿主同一份
   字节的模块（`learn/*.js`）写一项 `host: 'ext'` 加一项 `host: 'app'`，后者的 `file` 相同，
   门禁额外核它在 `build/app-bundle.js` 的 `MODULES` 里 —— 「同名模块进了包」与「接上了」
   是两件事（§3.3），两件都要核。
2. 某个宿主**有意**不发的，写 `{ host, none: '<一句理由>' }`，不许留空。例：`subtitle_on`
   在 App 是 `none`（App 的入口由 `asr_entry{surface:'app_home'}` 回答）；`rate_prompt` 在
   App 是 `none`（评分提示挂在网页译文末尾，App 没有这个表面）；`ext_banner` 在扩展是 `none`。
   §3.3 裁定 2（补译文不发 `translate_ok`）也落成这样一项，于是「不做」第一次有了机器可读的形状。
3. 新门禁（并入 `test/telemetry-registry.test.js`）：① 每个事件、每个宿主，要么有 `seams`
   项要么有 `none`；② 每个 `seams` 项的 `file` 里真的有 `track('<事件>'` / `once('<事件>'`
   （或该事件在 `telemetry.js` 内部直发的等价形状），带 `match` 的还要同现；③ `host:'app'` 且
   `file` 在 `extension/` 下的，必须在 App 包的 `MODULES` 里。
4. **`seams` 不出注册表。** 它是构建期的元数据：不进 `events.gen.json`（服务端不需要知道
   谁在发），不进 `window.MT_TELEMETRY`（客户端不需要），也就不改线上契约 —— 事件、属性、
   枚举值一个不加。本文档 §3 表的 Seam 一列保留给人读，但**以注册表为准**；两者打架时改文档。
5. 静态核对只证明「有调用」，证明不了「走得到」。两条用户路径各加一条行为断言，挂在已有的
   端到端门禁里。自动化下 `MTTelemetry` 是空操作（`navigator.webdriver`，§8），所以断言的是
   **`track` 被以什么参数调用**，并拿注册表核参数在白名单内：`npm run test:listen` 的 T 段 ——
   一场定稿两句 ⇒ `translate_ok{kind:'subtitle'}` **恰好 1 条**；端点 401 连说两句 ⇒
   `translate_fail` **恰好 1 条**；T2 段 —— 在 App 设置页真点「领取」（只换掉网络与登录）⇒
   `grant_claimed` ×1 + `engine_set{provider:'grant'}`。`npm run test:grant` 对扩展设置页钉同一对
   事件 —— 发送点挪进 `claim()` 之后，扩展这一侧不能反过来丢掉。
6. **遥测待办的完成判据**一律写成「在 `bt_events` 里读到 `<host>` 的 `<event>`」，不写
   「PR 合并」。判据写成合并，就等于把「接上了」交给下一次偶然的回读去发现。

**随代码 PR 一起补的发送点（白名单不变）：**

- `grant_claimed` 挪回本文档一直写着的位置：`learn/grant.js` 的 `claim()` 落定处
  （`!reused` 时发）—— 一处覆盖两个宿主，`options.js` 那一处删掉。与 `engine_test` 包在
  导出处是同一个理由（§3.3.1 第 3 条）。
- App 的领取路径在写完配置后走与 `applyQuickSetup` 相同的 `EngineState.needsSetup` 判据发
  `engine_set`。
- `app/listen.js`：每个会话第一条译文定稿时发一次 `translate_ok{kind:'subtitle'}`
  （与网页侧「每会话一次」同义）。
- `grant_exhausted`：挂在 `learn/telemetry.js` 内部 —— `track('translate_fail', {code:
  'credit_exhausted'})` 经过时带出一条 `once('grant_exhausted')`（每装机一次，定义见 §3 表）。
  `credit_exhausted` 会从网页、字幕、文档、App 听译四条路上来，挂在任何一个调用方都会漏另外三条，
  而四条路都经过这一行。§3 表里原先写的 `balance(force)` 二次判定在代码里并不存在 —— 中继的 402
  本身就是「用完了」的判定，不再加一道。它因此依赖裁定 A、B：那两条路不发 `translate_fail`，
  在那两条路上用完额度的人就不会被数到。

**裁定的两条（2026-09-19 用户裁定：A、B 都发；都不动白名单，枚举现成）：**

- **A. App 听译 / 实时字幕的 `translate_fail`** —— **发**：定稿句的译文请求失败（界面出
  「译文失败 · 重试」）时记，`code` 用现有枚举，**每会话每个 code 至多一条**（一场里三十句全
  401 是一件事；网页侧一段一条，§3.1 那 308 条 401 就是这么来的）。半句的增量翻译失败不记；
  没配引擎不算一次失败的翻译。
  理由：没有失败数，`translate_ok` 只能说明「有人成功过」，说明不了「这条路通不通」。
- **B. 文档阅读器的 `translate_fail`**（两宿主）—— 建议**发**，同上，挂在 `doc-view.js`
  页状态落到 `error` 处，每页至多一条。

**历史数据怎么读。** first grant 分流屏（#297）的效果看 `host in (safari, chrome, firefox)` 的
`onboarding_done → grant_claimed → engine_set`，这条线一直是通的。`grant_claimed` 在 App 上、`translate_ok{subtitle}` 在 App 上、
`grant_exhausted` 在所有宿主上，**修复版本出货之前的 0 都是「量不到」**，不可与之后比较；
账号侧 `bt_grants` 的逐日新领数（09-15 起每天 2–6 个）是这段时间唯一可用的领取读数，
按原则 7 它不与遥测 join。

### 3.5 2026-09-19 amendment（二）：系统翻译与快速翻译（同日用户评审通过）

domain-design §2.6 / learning-design §9.9 加了两个 App 专属的表面。白名单的改动只有**一个枚举值**。

1. **`translate_ok.kind` 加 `quick`** —— Mac 的快速翻译（划词 / 剪贴板 / 服务 / 输入 / 截图，五个入口同一个值）。
   不能归进 `page`（没有网页）、`subtitle`（§3.3 裁定 1 已把 `host='app' + kind='subtitle'` 定义为听译 / 实时字幕，
   再塞进来这个数就读不出来了）或 `doc`。**不按入口再分**：`via` 是五个值，拆开之后每个值的日量都是个位数，
   而「哪个入口有人用」由 `asr_entry` 式的入口事件回答更合适 —— 第一版不加，满一个月看 `quick` 的量再议。
   `translate_fail` 不加属性：它本来就不带 `kind`。每次面板会话一条（同 §3「每会话一次」），不是每次重翻一条。
2. **发送点在主页面，不在面板页。** 面板是第二个 WKWebView，若它也启动 `MTTelemetry`，两个页面会各发一次
   `heartbeat`、各持一份队列。面板页经 `mtQuick` 把「翻成了 / 失败了 + 码」交给主页面，由 `app/handoff.js` 代发。
   `SEAMS`：`translate_ok` 加 `{ host: 'app', file: 'app/handoff.js', match: "kind: 'quick'" }`，`translate_fail` 同。
3. **iOS 系统翻译扩展不发任何事件**，`SEAMS` 写
   `{ host: 'app', surface: 'system-translate', none: '系统翻译扩展是独立进程，够不到 App 的遥测队列与开关；不为它开第二条发送路径' }`。
   理由是 §2 的两条原则：关掉开关必须**一处生效并删掉本机 id** —— 扩展要么自带一个 id（第二个 id），要么读镜像过去的
   id 自己发（第二条发送实现）；而把事件排进采集收件箱让 App 代发，会破坏收件箱「只存六个字段」的承诺，`ts` 也会漂出
   ±7 天窗口。它的用量由一个不带内容的既有信号间接回答：收件箱第一次摄入成功时的 `capture_first`。够不够，出货一个月后再看。
4. **`host` 不加值。** Mac 面板在 App 进程里，仍是 `app`。
5. **中国版照旧一条不发**，`ExtEngine.js` 里本来也没有遥测模块。

合并后的顺序照旧：`build/telemetry.config.js` → `node scripts/gen-telemetry.js` → 部署 `bt-ingest` → registry 测试。

### 3.6 2026-09-22 amendment（**提案，待人评审**）：引导是黑的

> **本节只写提案，不进 §3 的表。** 按 §3.3.1 那条流程：docs PR 只写提案 → 人评审 →
> **一个** PR 同时改表 + 注册表 + 生成物 + 代码。现在把事件名写进 §3 的表会让
> `telemetry-registry.test.js` 当场变红（它拿文档的表与注册表**双向**比对）。

**现象。** 两个面的引导都只有「完成」一个观测点，而且**跳过也发**：

- App 引导 5 屏（`welcome → ext → browser → read → signin`），跳过与走完走的是同一个收尾。
- 扩展引导 4 屏（`welcome → engine → capture → try`）。

于是「走完」与「放弃」在表里**长得一模一样** —— 这正是 §3.3 / §3.4 那条教训的又一种形状：
结果看得见，过程全黑。

**读数（2026-09-21/22）。** 扩展这条引导**只要人走到第 2 屏就成了**：走完引导的装机里几乎
全部配好了引擎（iPhone 20 / 20，Mac 19 / 18）。问题纯粹在走完率 —— iPhone 27%、Mac 31%、
Chrome 17%、Firefox 8%。而 Chrome 是个反例，**不能一刀切**：没走完引导但自己去设置页配好的
有 21 台，比走完的 9 台还多一倍（主动去商店装扩展的人画像不同）。真正的损失是 Safari 那
68 台 —— 既没走完也没配好。

**提案 A：让「走完」与「跳过」分得开。** 给现有的完成事件加一个属性，取值只有两种（走完 /
跳过）。这是加属性值，不是加事件。

**提案 B：停在第几屏。** 只在**离开引导时**记一条「停在第几屏」，**不是每屏一条** ——
按 §3 的准入筛子，每屏一条是噪声，回答不了 §1 的任何一问；而「停在第几屏」直接回答
「这 4 屏里哪一屏劝退」。屏名用稳定的短枚举（与代码里的屏序数组同源），不带任何内容。

**为什么值得现在提。** 2026-09-22 已裁定要动两个面的屏序（`learning-design` §0 当日行）。
**先补这两条，再改交互** —— 否则改完仍然只能拿到同一张分不出因果的表，等于白改一轮。
这也是复习那条（`review_session` 至今 0）现在的处境。

### 3.7 2026-09-22 amendment（**提案，待人评审**）：复习与「去 Safari 再回来」这两段是黑的

> 同 §3.6：**本节只写提案，不进 §3 的表**。评审通过后一个 PR 同时改表 + 注册表 + 生成物 + 代码
> + 两站隐私页（growth-spec §4 同版）。用户 2026-09-22 裁定这两条都「先补可观测性」（#386、#384）。

#### A · 复习：`review_session` 只在「清空」时发，于是 0 分不清是「没人复习」还是「量不到」（#386）

**读数（2026-09-21）**：52 台存过第一条语料，`review_session` **0 条**。根因叠了两层：
一轮的门槛是「今天全部清完」——对刚存下第一批语料的新用户，每副牌 4 张新卡、当日新卡预算 15
（`learn-scheduler.js`），**要一口气连评满 15 张才会发出第一条**；而**中途退出没有任何记录**
（`review.js` 没有 pagehide，App 的返回只重算计数）。卡级进度是落库的，缺的只是读数。

**提案**：不加事件，改 `review_session`：

| | 现在 | 提案 |
|---|---|---|
| 属性 | `graded`（int） | `graded`（int）· **`result: done \| left`** · **`left`（int，离开时还剩几张）** |
| 何时发 | 牌组清空（`!deck.length`） | 清空时发 `done`；**离开复习面时**（扩展 `pagehide`、App 返回键）若这一轮**已经露出过卡**且没清空，发 `left` —— `graded` 可以是 0（「打开了、一张没评就走」本身就是答案） |
| 每会话 | 一条 | 仍至多一条（`done` 与 `left` 互斥） |

回答的问题：没人来 / 来了没评 / 评了几张就走 / 离清完差多少 —— 这四种今天在表里都是同一个 0。
下一步要不要降门槛（画布），等这张表出来再定。

#### B · 「去 Safari 再回来」：App 把人送去检测页，而检测页那一侧一个数都没有（#384）

**读数（2026-09-21，#384 第三条评论）**：247 台 App 装机里 176 台（71%）生命周期不到 5 分钟；
**唯一还活着的窗口**是 66 台出现过「隔几分钟又回来」——正是去 Safari 弄一下再回来的形状。
而 `ext_banner{setup}` 之后发生了什么，我们一个数都没有；`setup` 本身还混着两个来源（主按钮与
「不确定？打开检测页看绿灯」共用一个 action）。

**提案**：把这一段补成三节漏斗，**只新增一个事件**：

1. **App 里点了哪个**：`ext_banner.action` 加一个值 `check`（「打开检测页」那一行），`setup` 只留给主按钮。加枚举值，不加事件。
2. **到没到检测页**：**不新增采集**。`belliedmonkey.cc` 已有 Vercel Web Analytics（09-20 起），
   `/setup` 的访问量就是这一节。只读汇总数、不与 `bt_events` join（原则 7）。
3. **看没看见绿灯**：新事件 **`setup_detected`**，无属性，**每装机一次**（`once`）。发送点是
   `content-main.js` 在自家域名上设 `data-mt-extension` 并派发 `mt-extension-ready` 的那一处，
   **只在检测页路径**（`/setup`）上发。它是扩展侧的事件（`host = safari | chrome | firefox`），
   回答「多少台 Safari 真的把扩展开起来、并且回到了我们给的那一页」。

**边界**：`setup_detected` 只在我们自己的域名上发（那段代码本来就只在 `MT_SITES` 里跑，见它上面
那条「不给任何网站造指纹面」的注释），不带页面地址、不带版本以外的任何东西；中国版不发（规则 4）。
App 侧与扩展侧的 `install_id` 天然不同，**不拼接** —— 这三节只看各自的总数与比例。

**Explicitly not collected:** site hostnames (owner's call) · crash stacks · review
answers · per-paragraph translation events · precise timestamps · IP addresses (the
edge function neither stores nor logs them as a field).

## 4. Transport

- **Client module** `extension/learn/telemetry.js` (`MTTelemetry`). `track(name, props)`
  only enqueues (key `tm:queue` in `chrome.storage.local`, cap 200, drop oldest).
  `flush()` runs when the queue reaches 10, or 60 s have passed, or any extension page
  opens; `navigator.sendBeacon` first, `fetch(keepalive)` as fallback. The host app runs
  the same bytes via `Script.js`.
- **Endpoint** `MT_BACKEND.url + '/functions/v1/bt-ingest'`, emitted by `build.js` as
  `window.MT_TELEMETRY_URL` into `providers.gen.js` (which content scripts already
  load). **No anon key**: the function is deployed `--no-verify-jwt`, so content scripts
  never load `backend.config.js` — `build.js`'s standing rule is that the anon key must
  not ride in a script injected into every page; the URL alone is public anyway.
- **Server** `supabase/functions/bt-ingest/index.ts`: event name and property keys
  must be on the whitelist; ≤ 1 KB per event, ≤ 50 per batch; per-`install_id` rate
  limit (60/min); on `telemetry_off`, `delete where install_id = ?`; writes with the
  service role.
- **Table** (`supabase/schema.sql`): `bt_events(id bigint identity, install_id uuid,
  ts timestamptz, v text, flavor text, host text, device text, ui text, name text,
  props jsonb, received_at timestamptz default now())`. RLS **denies everything** to
  `anon` and `authenticated` — only the edge function writes, and nothing reads from a
  client.
- **Retention**: raw rows deleted after **180 days** by pg_cron; daily materialized
  rollups (installs, DAU, funnel, failure rate by provider) are kept and carry no
  `install_id`.
- **Volume**: ~200 installs/month × ~10 events per active day — tens of thousands of
  rows a month, inside the free tier.

## 5. What the user sees

- **Onboarding, last screen**, one sentence with a link to the privacy section:
  「会发送匿名用量数据（不含网页内容与地址），帮助改进；设置里可关。」
- **Settings → About** (extension and app alike): a switch 「分享匿名用量数据」 and a
  「会发送什么」 link. The switch is a **standalone key** in the `engineChosen` style —
  not part of `saveAll()`'s literal reads — so the China flavor, which has no such
  control, cannot break saving.
- **Privacy page** (`belliedmonkey.cc`, 12 locales): a new section listing every
  field, the default, the switch, deletion on opt-out, and the retention period.
  「5. No tracking」 narrows to cross-site tracking / profiles / third-party analytics
  and points at the new section.

## 6. Gate D

The full surface-by-surface table lives in `docs/learning-design.md` §10 Gate D and
is not restated here. The one-sentence disclosure used verbatim everywhere:

> We collect anonymous usage events — which features are used, on which browser, and
> whether a translation succeeded or failed. Never the pages you read, the text, the
> addresses, your keys or your account. On by default; off in one switch; turning it
> off deletes what that device sent.

## 7. Delivery order

1. **PR-D0 — docs only** (this file, `AGENTS.md` rule 4, learning-design §2/§10/§11,
   domain-design §8). Human review. Nothing below starts before it merges.
2. **PR-D1 — backend**: `bt_events` + RLS + pg_cron in `supabase/schema.sql`; the
   `bt-ingest` edge function; a verification section in `supabase/README.md`.
3. **PR-D2 — client**: `learn/telemetry.js`, the eleven seams, the switch (extension +
   app), the onboarding sentence, `telemetry_hint` / `telemetry_toggle` × 12 locales,
   `build.js` URL emission + china stripping, Gate B inverted, `WANT_DCP` grown.
4. **PR-D3 — copy**: README ×2, `store-assets/aso.md`, `amo-listing.md`, the `.cc`
   site × 12. Ships with the next version; the App Store privacy labels and the CWS
   data disclosure are refilled by hand at submission (`/store-release` §4.5 gains a step).

## 8. Verification

- `npm test` — new `test/telemetry.test.js`: ① an event name or property key off the
  whitelist throws; ② any property value containing `http`, `@`, or longer than 64
  characters is rejected (nobody gets to smuggle a URL, an email or a sentence in);
  ③ after the switch is off, `track` is a no-op and the queue is cleared;
  ④ `heartbeat` enqueues once per day.
- `test/backend-config.test.js` — the china artifact contains no `MT_TELEMETRY_URL`.
- `npm run test:smoke` — a local stub endpoint; translate one paragraph; assert a
  `translate_ok` arrives and the payload has **no** URL or text field.
  **2026-09-10：这条此前只写在这里、没有实现**（`verify-extension-smoke.js` 里零命中）；PR1 落地，
  并加两条：假端点回 401 的那一幕收到 `translate_fail{code:'auth'}` 且**停机后不再增长**；
  自动化下的遥测只许打本机桩 —— `MT_TELEMETRY` 加 `allowAutomation` 字段由测试注入，`spec()`
  先看它再看 `navigator.webdriver`（headed 跑法 `webdriver` 为假，此前会把 `installed/heartbeat`
  打进线上表）。
- **发送点（2026-09-19，§3.4）**：`npm test` 的 `telemetry seams` —— 注册表的 `SEAMS` 去掉注释后对着
  代码逐项核，并带「门禁自己能红」的用例（同一张表对修复前的 main：8 处红）。走得到由
  `test:listen` 的 T / T2 段与 `test:grant` 守，两段在修复前均实测为红。**新增事件、新增宿主、
  挪动发送点 ⇒ 改 `SEAMS`**；门禁红了先问「接上了吗」，不是改门禁。
- Real device: Safari iOS, translate a page →
  `select name, host from bt_events order by id desc limit 5` shows
  `translate_ok / safari`; flip the switch off → zero rows for that `install_id`.
- Gate B, negative: put "no telemetry" back into the README → `node build.js` must go red.

## 9. The ledger (#174, closed by this design)

**Cost:** one review-visible disclosure change across six surfaces (about a day), two
days of backend + client work, two extra hand-filled fields at every release, and one
marketing sentence — "no telemetry" — retired in favour of "no third party, off in one
switch, never your content". **Benefit:** funnel, retention and failure codes, of which
we have none today. **Cost of not doing it:** already being paid — #174's table, plus
a whole day on 2026-09-05 spent asking users by email what a heartbeat would have said.
The China flavor pays nothing and breaks no promise.
