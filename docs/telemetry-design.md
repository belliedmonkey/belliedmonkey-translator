# Telemetry design — anonymous usage events（匿名用量事件）

> Status: **design approved 2026-09-05; backend (PR-D1) live; client + copy (PR-D2/D3) implemented the same day.**
> **2026-09-10 amendment（第八期，待人评审）**：加第六问（§1）、`translate_fail.code` 加 `auth`、新事件
> `rate_prompt` / `ext_banner`（§3）、修 `translate_ok` 的 Seam、§8 的 smoke 断言这次真正落地并加自动化守卫。
> 起因写在 §3.1。Governed by
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
| `engine_set` | `provider` | provider changed and saved | `options.js` provider `change` (next to `engineChosen`) · `applyQuickSetup` |
| `translate_ok` | `provider` `kind: page \| subtitle` `ms` | **once per page session** (first translation painted), never per paragraph | `content-webpage.js` `makeEngine().onOk`（`okSent` 每会话一次；2026-09-10 修正，此前写的 `tick()` 与代码不符）· `subtitle-adapter.js` `onOk` |
| `translate_fail` | `provider` `code` `status` (number only) `route` `ms` | a request fails for good | `translation-core.js` where `it._err = true`; `code` ∈ `timeout / network / http / reasoning_starved / no_base / unknown_provider / credit_exhausted / grant_unavailable / model_not_allowed / auth` from `translation-api.js`（`credit_*`/`grant_*`/`model_*` 来自免费额度中继，§8.10；**`auth`** = 2026-09-10 加：HTTP 401/403 且请求带了**非空、非额度令牌**的 key —— 「这把 key 被服务商拒绝」，引擎停机，见 §3.1） |
| `subtitle_on` | `site: youtube \| substack \| podcast \| other` (a **class**, not a domain) | a subtitle session starts | `subtitle-adapter.js` `setActive(true)` |
| `capture_first` | — | first capture ever written on this install | `learn-collector.js` inside the write-success callback — **never** on the failure path (Collector law 2) |
| `review_session` | `graded` | a deck is finished | `review.js` `!deck.length` branch, same spot as the rating prompt |
| `grant_claimed` | — | 一次领取成功（每装机一次） | `learn/grant.js` 的 `claim()` 落定处 |
| `grant_exhausted` | — | 首次收到 402 且余额判定为用完 | 收到 `credit_exhausted` 且 `balance(force)` 判定余额 ≤ 0 处 |
| `sync_on` | — | first successful sync (once per install) | subscribe to `sync.js` `onStatus` `done` |
| `rate_prompt` | `action: shown \| tap \| dismiss` | 译文末尾那一行评分提示被挂上 / 被点 / 被关（2026-09-10，§3.1） | `content-webpage.js` `tick()` 挂行处（shown）与行内两个 click handler；`shown` 每装机每次挂上一条，挂上即等于 `mtRatingAskedAt` 落盘，所以一装机 90 天内至多一组 |
| `ext_banner` | `action: shown \| setup \| done` | App 首页「扩展还没打开」横幅显示 / 点「在 Safari 里打开扩展」/ 点「我已打开」（2026-09-10，§3.1） | `app/app.js` `paintExtBanner()`（`shown` 按 `tm:extBannerDay` 每日一条）与两个按钮的 listener |
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
