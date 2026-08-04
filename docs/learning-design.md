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
   rule 6 (never convert free to paid) is not touched.
2. **It demonstrably beats what the local path can do.** "Convenient for us to host"
   is not a reason. If a user's own key produces the same result, there is nothing to
   sell.
3. **What that path processes is disclosed for that path specifically** — never
   averaged away into a claim about the product as a whole (§10).

**Local deployment stays first.** Default, recommended, and the one the onboarding
teaches. A hosted model is an alternative for people who want it, never the path of
least resistance.

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
}
```

- **`id` is content-addressed.** The same sentence met on a second device, or on a
  second site, collapses onto one item and increments `seenCount`. This is what makes
  sync idempotent without a server-assigned identity.
- **`id` must use a synchronous non-cryptographic hash (FNV-1a).** `crypto.subtle` is
  unavailable in content scripts on plain-`http` pages (not a secure context), so a
  SHA-based id would silently fail on exactly the long tail of sites we care about.
- **`text` / `tr` / `anchor` are immutable after creation.** Only `sched`, `state`,
  `starred` and the counters mutate. This is what shrinks the sync conflict surface
  to almost nothing (§8.3).

### 4.1 The learned language is the source language

`item.lang` is the **source** language, not "English". Detection order:
`LangDetect` (Chrome/Edge/Firefox; absent on every Safari) → script inference →
`'und'`. Per domain-design §5.3.2 the detector is **injected by the adapter, never
probed by the Collector**, and an undetected language is stored as `'und'` and
grouped separately in the review UI — capture is never blocked on detection.

The user picks which languages to study; the default is *every* language that is not
`targetLang`. No language is hard-coded anywhere in the learning layer.

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

---

## 6. What counts as "seen" — the salience gate

A single page yields hundreds of segments. Capturing all of them produces a corpus
nobody wants to review. The gate is **deterministic, LLM-free, word-list-free and
language-agnostic**:

```
salience = 0.45*dwell + 0.25*lengthBand + 0.20*repeat + 0.10*sourceRecency
gate:      salience ≥ 0.45  AND  (dwellMs ≥ 2500 OR playedThrough)
starred ⇒ salience = 1.0, gate bypassed
```

- **dwell** — `IntersectionObserver` at threshold 0.5, accumulating visible
  milliseconds; `clamp(dwellMs / 6000, 0, 1)`. This is the honest reading of "看过":
  a segment that scrolled past in 200 ms was not read.
- **lengthBand** — script-aware, mirroring the segmenter's own script-aware floor
  (`dom-processor.js` `minLen`): 8–60 chars for CJK/Hangul/Thai, 40–220 for
  Latin/Cyrillic. Tapers outside the band rather than cutting hard.
- **repeat** — `min(1, (seenCount - 1) / 3)`. Meeting the same sentence again is
  evidence it matters.
- Noise is removed with judgments that **already exist**: `looksLikeCode()`,
  `isAlreadyTargetLanguage()`, and the `data-mt-skip-region` marker.
- **Subtitles** — a sentence counts only if the playhead actually crossed
  `[start, end]` while the overlay was showing (`playedThrough`). Seeking past a
  sentence is not watching it.

---

## 7. 核心约束 — storage is three tiers, and the reason is origin

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
> for more of it would violate `AGENTS.md` rules 8 (price only what genuinely cannot
> be carried) and 6 (never convert something already free into paid). A paid option
> may appear **only** against the server quota — a cost that is actually incurred —
> and only once such a tier exists. Never show an upgrade path to a tier that does
> not exist.

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

### 8.2 核心约束 — export stays, and it is not a nicety

> **A one-action export of everything, and an import that restores it, ship with
> sync — not after.** Three independent reasons, any one of which is sufficient:
>
> 1. **It is the data-portability right** (GDPR Art. 20). We now hold the data, so
>    this is no longer optional in the way it was when we held nothing.
> 2. **It is the no-account path.** Someone who never wants to sign in can still move
>    between their own devices by carrying the file.
> 3. **It is the honest answer to "I don't trust you".** That answer must not be
>    "self-host Supabase" — realistically nobody will. It is "take your file and go",
>    and it has to actually work.
>
> The format is the §8.4 chunk format unchanged, so this costs almost nothing to
> provide and would be indefensible to withhold.

### 8.3 Quota pressure — the third state in §7.1

The server quota is the third of the three pressure states §7.1 already describes,
and it reuses that machinery: a line in the review page and settings, with a cleanup
action beside it, never a blocker and never a page-level interruption.

**The quota's real job is anti-abuse, not rationing.** At §8.5's ~0.55 MB per
user-year, 50 MB is roughly 90 years of ordinary use — a normal user will never see
it. It exists so that free storage with open sign-up does not quietly become a file
host. So: build the cleanup path properly, but do **not** build an elaborate
quota-management experience for a state real users will not reach, and do not
advertise "limited storage" as though it were a constraint they will feel.

Cleanup is the same targeted action as local (§7.1): drop `state='known'` cards —
what the scheduler itself concluded you no longer need — never a starred card or one
being actively learned.

### 8.4 Chunk format and transport

```sql
-- RLS on every table: user_id = auth.uid()
learn_chunks (user_id uuid, seq bigint, kind text,   -- 'cards' | 'reviews' | 'sources'
              blob bytea, generation int,            -- deflate-raw, NOT encrypted
              PRIMARY KEY (user_id, seq))            -- append-only; never UPDATEd
```

- **Pull** `seq > cursor`; inflate, replay into the local IndexedDB. Cursor in `meta`.
- **Push** batches new cards and reviews into a fresh chunk and appends it.
- **Conflicts:** `text`/`tr`/`anchor` are immutable ⇒ none. `sched` is **derived by
  replaying the review log**, never synced directly ⇒ none. Only `starred` / `state` /
  `muted` need last-write-wins, carried as ordinary log entries.
- **Compaction** may only be initiated by a client that has *just* completed a full
  pull, and carries `expected_generation`; a losing racer retries later and backs off
  after N consecutive failures, so two devices cannot livelock each other.
- **Replay is idempotent** — a chunk applied twice yields the same local state, which
  is what makes an interrupted sync safe to simply re-run.
- **Not encrypted** (§8.6). Compression uses the platform's own
  `CompressionStream('deflate-raw')`; adding a library for what the browser provides
  would violate the zero-dependency rule.

**No new dependency**: `@supabase/supabase-js` is not introduced — raw `fetch`
against GoTrue (`/auth/v1/otp`, `/auth/v1/verify`) and PostgREST. Login is an emailed
6-digit OTP entered in the options page: no redirect, no callback URL, no `identity`
or `webNavigation` permission, and it does not trigger Apple's "offer Sign in with
Apple" rule.

### 8.5 Storage cost — four levers, and the estimate rule 9 requires

**Assumptions.** `dailyNew = 15` ⇒ at most ~5,000 graduated cards per user-year; a
card's `text` + `tr` is ~200 B of plaintext; a card accrues ~8 reviews over its life.

| Lever | What it does | Saves |
|---|---|---|
| **1 — sync only graduated cards** | The candidate pool (hundreds of segments per page) **never leaves the device**. Not merely thrift: the candidate pool *should* be a product of what you read on this device, while cards you have started learning *should* follow you | ~10× |
| **2 — normalize the source** | URL + title is ~160 B, nearly half a card. A `Source` row is shared by every card from the same page (~30 for an article) | 160 B → ~5 B |
| **3 — compress in batches** | Compressing one short sentence is near-useless, so ~200 cards are packed into one immutable chunk and compressed together. Mixed CJK/Latin batches at ~3× | ~3× |
| **4 — append-only + whole-snapshot compaction** | Chunks are only appended. Past a threshold the client pulls everything, rewrites one snapshot chunk, deletes the superseded ones. **No incremental merge machinery** — the local corpus is hard-capped at 20,000 items, so a whole rewrite is affordable | 5,000 rows → ~25 |

| | Raw | After |
|---|---|---|
| Card text 5,000 × 220 B | 1.1 MB | ~365 KB |
| Review log 40,000 × 13 B | 520 KB | ~173 KB |
| Sources ~500 × 160 B | 80 KB | ~27 KB |
| **Per user-year** | ~1.7 MB | **~0.55 MB** |

Without levers 2 and 3 it is ~2.5 MB/user-year. At 0.55 MB: Supabase's free 500 MB
holds ~900 user-years; the 8 GB paid tier ~14,500.

**What the server never stores**: audio, video, images, screenshots, full page text,
and the candidate pool. Media is a pointer only — `mediaKey` plus start/end offsets,
~20 bytes.

### 8.6 No end-to-end encryption — and what that obliges us to say

The synced corpus is stored **in plaintext**. The trust answer is that the project is
open source, the backend is self-hostable, sync is opt-in, and §8.2's export means
leaving costs nothing.

What this buys, and it is not small: **no recovery code** (the worst thing in the
original design — lose the code, lose everything, forever), a corpus that can be
debugged when a user reports broken sync, and the option of server-side features
later (a shared quiz cache would let one generation serve every user who meets the
same sentence — a real cost win for a free project).

> **核心约束 — do not oversell "open source" as the privacy answer.** Being open
> source makes the **client** auditable: a user can verify what it uploads. It does
> **not** make the **server** auditable — nobody can verify what happens to data
> after it arrives. Self-hosting answers both, but only for the few who can run it.
> The privacy statement must say what is *true* — we store your learning material in
> readable form, here is what we do and do not do with it, here is how to export it,
> here is how to delete it — and must never imply that publishing the source resolves
> the question.

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

## 9. Module map additions

These rows are mirrored into `docs/domain-design.md` §6.

| Module | File | Role |
|---|---|---|
| `LearnModel` | `content/learn-model.js` | pure: content-addressed id (FNV-1a), text normalization, script-aware salience scoring, `Item` factory, shared constants |
| `LearnScheduler` | `content/learn-scheduler.js` | pure: `retrievability` / `nextDue` / `applyReview` / `buildDeck`; `now()` injected, config merged over production `DEFAULTS` |
| `LearnCollector` | `content/learn-collector.js` | the sink (§3): dwell observation via `IntersectionObserver`, salience gate, bounded `lq:` outbox writes. Never originates a translation |
| `LearnStore` | `learn/store.js` + `learn/drain.js` | extension-page-only IndexedDB corpus and the outbox→corpus drain/merge |
| `Reviewer` | `learn/review.{html,css,js}` | the review surface; one implementation for all five matrix rows |

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
  works completely without — and, for people who turn it on, **the corpus is stored
  on our servers in readable form**. Say that in those words. It is the sentence a
  reader deserves to find without digging.
- **A hosted model (§2.1), if it ever ships, is a separate disclosure**: that path
  sends page text through us. Name it as its own exception; never fold it into a
  sentence about sync.
- **"No account, no tracking, no telemetry. Nothing to sign up for."** is the one
  that changes. It becomes: no tracking and no telemetry (still true), plus an
  **optional, free account** whose only job is to sync the learning corpus between
  the user's own devices — and which the extension works completely without.
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

## 11. Out of scope

- **Vocabulary/word cards and word-frequency lists** (§1). The unit is the sentence.
- **Synthetic speech as a REPLACEMENT for real speech** (§1). A media card always
  replays the original audio; it is never re-read by a synthetic voice. Synthesizing
  speech for *text* cards — which have no original audio — is in scope and specified
  in §9.1.
- **A hosted model as the DEFAULT path** (§2.1). Local/BYO-key is the default and
  stays fully capable; a server-side model is an opt-in paid alternative or it does
  not ship at all.
- **Telemetry and usage analytics**, permanently — unaffected by §2.1.
- **Converting anything already free into paid.** Per `AGENTS.md` rule 6. A paid
  server-side model is a *new* capability, not a conversion, which is the only reason
  it is permitted.
- **ASR** remains out of scope, unchanged from domain-design §8: the learning layer
  consumes transcripts that already exist, it never creates them.
- **Auto-capture without consent.** Capture is off until the user turns it on once,
  and can be disabled and purged from settings at any time. See `README.md` — the
  privacy statement is part of the product, not marketing copy.
