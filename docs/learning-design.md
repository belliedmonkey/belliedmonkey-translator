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
| Translation | **always** the user's own key, browser → provider directly. There is no server-side translation, ever |
| Learning corpus | device-local IndexedDB; optionally synced across devices |
| LLM quizzes | the user's own key |
| Account & sync | free, optional, opt-in |
| Encryption | end-to-end, **no exception** — the server only ever holds ciphertext and an email address |

> **核心约束 — the server never runs a model, and that is load-bearing.** The reason
> is not cost. It is that a server which never proxies a translation **never sees
> plaintext**, which is the only condition under which end-to-end encryption is
> meaningful and under which `README.md`'s "no servers of ours in the middle" stays
> literally true. Do not add a server-side model call for any feature, including a
> "convenience" default for users without a key.

> **核心约束 — the consequence must be stated, not buried.** Because storage is
> ciphertext-only, **server-side intelligence is permanently impossible**: no
> cross-user difficulty grading, no shared quiz cache (the same sentence quizzed once
> for everyone), no web review app. This was chosen knowingly. Do not re-litigate it
> in code by "temporarily" storing plaintext.

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

2. **Degradation is silent and total.** Storage full, IndexedDB unavailable, quota
   denied, outbox overflow — all reduce to the same thing: *no capture*, and the
   translation path continues untouched. No retry loop, no user-visible notice, no
   half-state. (Same shape as the browser-capability rule, domain-design §5.3.3.)
   **Dropping captures is a normal path, not an error path.**

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

**IndexedDB `mt-learn` v1** — `items` (keyPath `id`; indexes `dueAt`, `state`, `lang`,
`createdAt`, `salience`, `[state+dueAt]`), `reviews` (append-only; indexes `itemId`,
`at`), `meta` (sync cursor, device id, daily-new counter, key material).

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

## 8. Sync and encryption (V3)

### 8.1 No new dependency

The repo is zero-dependency by rule. **`@supabase/supabase-js` is not introduced** —
the client speaks raw `fetch` to GoTrue (`/auth/v1/otp`, `/auth/v1/verify`) and
PostgREST.

**Login is an emailed 6-digit OTP entered in the options page.** No redirect, no
callback URL, no `identity` permission, no `webNavigation` permission. It also avoids
Apple's "offer Sign in with Apple if you offer third-party login" rule, since
email-only login does not trigger it.

### 8.2 Storage cost control — four levers

`AGENTS.md` requires a bytes-per-user-per-year estimate, with its assumptions, before
any server-side storage is introduced. This section is that estimate; the protocol in
§8.3 is shaped by it rather than the other way round.

**Assumptions.** `dailyNew = 15` ⇒ at most ~5,000 graduated cards per user-year; a
card's `text` + `tr` is ~200 B of plaintext; a card accrues ~8 reviews over its life.

| Lever | What it does | Saves |
|---|---|---|
| **1 — sync only graduated cards** | The candidate pool (hundreds of segments per page) **never leaves the device**. This is not merely thrift: the candidate pool *should* be a product of what you read on this device, while cards you have actually started learning *should* follow you | ~10× |
| **2 — normalize the source** | URL + title is ~160 B, nearly half a card. A `Source` row is shared by every card from the same page (~30 for an article) | 160 B → ~5 B per card |
| **3 — compress, then encrypt, in batches** | Ciphertext is incompressible, so the order **must** be deflate → AES-GCM. Compressing one short sentence is near-useless, so ~200 cards are packed into one **immutable chunk** and compressed together. Mixed CJK/Latin text batches at ~3× | ~3× |
| **4 — append-only + whole-snapshot compaction** | Chunks are only ever appended, never updated. When the chunk count passes a threshold the client pulls everything, rewrites it as one snapshot chunk, and deletes the superseded ones. **No incremental merge machinery** — the local corpus is already hard-capped at 20,000 items, so a whole rewrite is affordable | 5,000 rows → ~25 |

| | Raw | After |
|---|---|---|
| Card text 5,000 × 220 B | 1.1 MB | ~365 KB |
| Review log 40,000 × 13 B | 520 KB | ~173 KB |
| Sources ~500 × 160 B | 80 KB | ~27 KB |
| **Per user-year** | ~1.7 MB | **~0.55 MB** |

Without levers 2 and 3 it is ~2.5 MB/user-year, so those two are worth ~4.5×
together. At 0.55 MB: Supabase's free 500 MB holds ~900 user-years; the 8 GB paid
tier ~14,500. **Compression must use the platform's own `CompressionStream`
(`deflate-raw`)** — adding a compression library would violate the zero-dependency
rule for a saving the browser already provides.

**What the server never stores** (also an `AGENTS.md` principle): audio, video,
images, screenshots, full page text, and the candidate pool. Media is a **pointer
only** — `mediaKey` plus start/end offsets, ~20 bytes.

### 8.3 Protocol

```sql
-- RLS on every table: user_id = auth.uid()
learn_chunks (user_id uuid, seq bigint, kind text,   -- 'cards' | 'reviews' | 'sources'
              ct bytea, generation int,
              PRIMARY KEY (user_id, seq))            -- append-only; never UPDATEd
```

- **Pull** `seq > cursor`; decrypt, inflate, replay into the local IndexedDB. Cursor
  lives in `meta`.
- **Push** batches new cards and reviews into a fresh chunk and appends it.
- **Conflicts:** `text`/`tr`/`anchor` are immutable ⇒ none. `sched` is **derived by
  replaying the review log**, never synced directly ⇒ none. Only `starred` / `state` /
  `muted` need last-write-wins, carried as ordinary log entries.
- **Compaction** may only be initiated by a client that has *just* completed a full
  pull (so it demonstrably holds everything), and carries `expected_generation`. A
  losing racer simply retries later; after N consecutive failures it backs off, so two
  devices cannot livelock each other.

Replay must be **idempotent** — a chunk applied twice produces the same local state.
That is what makes an interrupted sync safe to simply re-run.

### 8.4 Crypto

AES-GCM-256. The key is generated locally (`crypto.getRandomValues(32)`), stored in
`chrome.storage.local`, and exported to the user as a Crockford base32 **recovery
code**. Per-record random nonce. Encryption runs **only in extension pages**, which
are secure contexts (§4's note on `crypto.subtle`).

> **Losing the recovery code makes the synced corpus permanently unreadable.** That
> is the price of end-to-end encryption and the UI must say it in those words, with a
> blocking "I have written it down" confirmation at enrollment. Never soften this
> into "you may lose access".

### 8.5 Abuse limits — free accounts still need a ceiling

Free storage with open sign-up is a file-hosting service waiting to be discovered.
Three limits, all server-side, because a client-side limit is a suggestion:

- **Per-account hard cap** (e.g. 50 MB — roughly 90 user-years of normal use)
  enforced by a Postgres constraint or trigger, not by the client.
- **Email verification** is already implicit in the OTP flow (§8.1); no unverified
  account can write.
- **Rate limits** on chunk append, so a loop cannot burn the quota in a minute.

When the cap is reached: stop uploading **new card text**, keep syncing progress, and
say so plainly. **Never silently drop data** — a learner discovering months later
that their corpus stopped syncing is worse than being told on day one.

---

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

### Gate B — ships with V3 (accounts and sync)

- **"No servers of ours in the middle"** (README hero, line 6) and "**No servers of
  ours.** Requests go from your browser to the engine you picked" **stay verbatim**.
  They are about the *translation* path, and that path never touches our server —
  before or after sync exists. Do not weaken them out of an abundance of caution;
  they are the strongest true thing the project can say.
- **"No account, no tracking, no telemetry. Nothing to sign up for."** is the one
  that changes. It becomes: no tracking and no telemetry (still true), plus an
  **optional, free account** that exists solely to sync an end-to-end-encrypted
  learning corpus — and which the extension works completely without.
- **Firefox `data_collection_permissions`** must be re-evaluated against
  `build.js` (which already carries this reminder and a build-time assertion) —
  syncing ciphertext is still transmitting website content plus browsing activity.
- **App Store privacy labels** must be refilled (adds "Usage Data" and "User
  Content"), and the host app must offer in-app **account deletion** — an Apple
  requirement for any app with account creation, not a nicety.
- **`belliedmonkey.cc/privacy.html` lives outside this repo.** Per `AGENTS.md`, look
  its current state up in gbrain first; never infer it from this repository.

## 11. Out of scope

- **Vocabulary/word cards and word-frequency lists** (§1). The unit is the sentence.
- **TTS / synthesized speech** (§1). Audio review replays the original media.
- **Any server-side model call** (§2), including a "convenience" hosted default for
  users who have not configured a key. The server never runs a model.
- **Server-side intelligence** (§2) — precluded by ciphertext-at-rest.
- **Paid tiers for anything designed here.** Per `AGENTS.md`, a feature may only be
  priced if its storage or compute genuinely cannot be carried for free, and
  **something already shipped free is never converted to paid**.
- **ASR** remains out of scope, unchanged from domain-design §8: the learning layer
  consumes transcripts that already exist, it never creates them.
- **Auto-capture without consent.** Capture is off until the user turns it on once,
  and can be disabled and purged from settings at any time. See `README.md` — the
  privacy statement is part of the product, not marketing copy.
