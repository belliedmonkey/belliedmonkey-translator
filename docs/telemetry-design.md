# Telemetry design — anonymous usage events（匿名用量事件）

> Status: **design approved 2026-09-05; backend (PR-D1) live; client + copy (PR-D2/D3) implemented the same day.**
> **2026-09-10 amendment（第八期，待人评审）**：加第六问（§1）、`translate_fail.code` 加 `auth`、新事件
> `rate_prompt` / `ext_banner`（§3）、修 `translate_ok` 的 Seam、§8 的 smoke 断言这次真正落地并加自动化守卫。
> 起因写在 §3.1。
> **2026-09-16 amendment（第十二期，待人评审）**：新事件 `engine_test`（引擎测试整个是盲区）；
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
| `onboarding_done` | `surface: ext \| app` | onboarding finishes | `extension/onboard/onboard.js` `finish()` · `app/app.js` `obFinish()` |
| `engine_set` | `provider` | **配置真的完成了**（不是「在下拉里选了一下」） | `options.js` 的 `saveAll()` 末尾（`maybeTrackEngineSet`）· `app/settings.js` 的 `applyQuickSetup`。**判据是 `EngineState.needsSetup`**，两个宿主同一个出口，不另写一份。2026-09-16 修正：此前挂在 provider 的 `change` 上，点开下拉就记一条 —— 理由见 §3.3 |
| `translate_ok` | `provider` `kind: page \| subtitle \| doc` `ms` | **once per page session** (first translation painted), never per paragraph | `content-webpage.js` `makeEngine().onOk`（`okSent` 每会话一次；2026-09-10 修正，此前写的 `tick()` 与代码不符）· `subtitle-adapter.js` `onOk` · `learn/doc-view.js` `onOk`（`kind:'doc'`，两宿主同一份字节）· **App 的听译/实时字幕（2026-09-16）**：`app/listen.js` 定稿出译文处，`kind:'subtitle'` —— **不新增 kind**，理由见 §3.3 |
| `translate_fail` | `provider` `code` `status` (number only) `route` `ms` | a request fails for good | `translation-core.js` where `it._err = true`; `code` ∈ `timeout / network / http / reasoning_starved / no_base / unknown_provider / credit_exhausted / grant_unavailable / model_not_allowed / auth` from `translation-api.js`（`credit_*`/`grant_*`/`model_*` 来自免费额度中继，§8.10；**`auth`** = 2026-09-10 加：HTTP 401/403 且请求带了**非空、非额度令牌**的 key —— 「这把 key 被服务商拒绝」，引擎停机，见 §3.1） |
| `subtitle_on` | `site: youtube \| substack \| podcast \| other` (a **class**, not a domain) | a subtitle session starts | `subtitle-adapter.js` `setActive(true)` |
| `capture_first` | — | first capture ever written on this install | `learn-collector.js` inside the write-success callback — **never** on the failure path (Collector law 2) |
| `doc_open` | `kind: pdf \| docx \| txt \| image` · `pages` (int) | a document is opened in the reader（2026-09-11，learning-design §9.7）；`translate_ok{kind:'doc'}` 是该文档第一页译文落地那一次 | `learn/doc-view.js` 打开文档处（两个宿主同一份代码）。不带文件名、字数、页文本 —— 只回答「有没有人用、文档多大」 |
| `review_session` | `graded` | a deck is finished | `review.js` `!deck.length` branch, same spot as the rating prompt |
| `grant_claimed` | — | 一次领取成功（每装机一次） | `learn/grant.js` 的 `claim()` 落定处 |
| `grant_exhausted` | — | 首次收到 402 且余额判定为用完 | 收到 `credit_exhausted` 且 `balance(force)` 判定余额 ≤ 0 处 |
| `sync_on` | — | first successful sync (once per install) | subscribe to `sync.js` `onStatus` `done` |
| `rate_prompt` | `action: shown \| tap \| dismiss` | 译文末尾那一行评分提示被挂上 / 被点 / 被关（2026-09-10，§3.1） | `content-webpage.js` `tick()` 挂行处（shown）与行内两个 click handler；`shown` 每装机每次挂上一条，挂上即等于 `mtRatingAskedAt` 落盘，所以一装机 90 天内至多一组 |
| `ext_banner` | `action: shown \| setup \| done` | App 首页「扩展还没打开」横幅显示 / 点「在 Safari 里打开扩展」/ 点「我已打开」（2026-09-10，§3.1） | `app/app.js` `paintExtBanner()`（`shown` 按 `tm:extBannerDay` 每日一条）与两个按钮的 listener |
| `asr_entry` | `surface: popup \| notice \| pill \| app_home` · `result: started \| no_media \| no_engine \| no_live \| gesture_needed` | 用户从某个入口尝试开始 AI 转写字幕（2026-09-11，§3.2） | `asr-source.js` `startFrom(surface, …)`（started / no_engine / gesture_needed）、`liveTier` 抛 `nolive` 处（no_live）、`content-main.js` `transcribeMedia` 找不到媒体处（no_media）；`pill` = 页内 「▶ 点此开始实时转写」 那一下。**`app_home`（2026-09-16）** = App 首页那两张模式卡（`app-listen-entry` / `app-listen-entry2`），seam 在 `app/listen.js` 的入口门控处 —— App 的听译/实时字幕**不经过** `asr-source.js`，所以现有三个值一个都落不到它头上，这是本次唯一必须动枚举的一处 |
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
- **新事件 `engine_test`**（动白名单，本 PR 要裁定的第 4 条）。提议的白名单行：

  ```
  engine_test · slot: chat | tts | stt · result: ok | fail · code（失败时，复用
                translate_fail.code 的枚举）
  何时：用户点了一次「测试」并拿到结果
  Seam：learn/engine-test.js 的四个调用方各自的结果回调 —— options.js（设置页）、
        engine-fields.js（字段行）、quick-setup.js（一键卡三个槽）、onboard.js（引导页）
  ```

  不带 key、不带端点、不带服务器原文——`serverMessage` 可能引用用户输入，原则 1 已禁。
  它回答的是 §1 第一问里一直缺的那半：**人卡在配置这一步，是因为没试，还是因为试了不通。**

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
