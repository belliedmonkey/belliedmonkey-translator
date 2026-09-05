# Telemetry design — anonymous usage events（匿名用量事件）

> Status: **design approved 2026-09-05; backend (PR-D1) live; client + copy (PR-D2/D3) implemented the same day.** Governed by
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

If a proposed event does not serve one of these rows, it does not go in.

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
| `translate_ok` | `provider` `kind: page \| subtitle` `ms` | **once per page session** (first translation painted), never per paragraph | `content-webpage.js` `tick()` where `painted = true` · `content-youtube.js` `onActiveChange` |
| `translate_fail` | `provider` `code` `status` (number only) `route` `ms` | a request fails for good | `translation-core.js` where `it._err = true`; `code` ∈ `timeout / network / http / reasoning_starved / no_base / unknown_provider` from `translation-api.js` |
| `subtitle_on` | `site: youtube \| substack \| podcast \| other` (a **class**, not a domain) | a subtitle session starts | `subtitle-adapter.js` `setActive(true)` |
| `capture_first` | — | first capture ever written on this install | `learn-collector.js` inside the write-success callback — **never** on the failure path (Collector law 2) |
| `review_session` | `graded` | a deck is finished | `review.js` `!deck.length` branch, same spot as the rating prompt |
| `sync_on` | — | first successful sync (once per install) | subscribe to `sync.js` `onStatus` `done` |
| `telemetry_off` | — | the user turns the switch off | settings switch `change` |

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
