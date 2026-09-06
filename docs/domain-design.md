# Translation Domain Design (领域设计)

> **Authoritative source of truth for the translation domain model.** Code must
> conform to this document. Any change that touches the domain design (the model,
> the extractor/engine/renderer boundary, the device principle, the DomSegmenter
> rules) **must update this doc first and pass human domain-design review before
> the code changes** — see the governance rule in `AGENTS.md`.

## 1. Core idea — one pipeline for everything

Every kind of "parsing" reduces to the same pipeline:

```
source → Extractor (parse into units) → Engine (state machine + scheduling + retry) → Renderer
```

Only **three things are platform/source specific**: the **Extractor**, the
**scheduling strategy** (`selectActive`), and the **Renderer**. Everything in the
middle is generic and lives in `TranslationCore`.

```
                ┌──────────────── TranslationCore (platform-agnostic) ────────────────┐
                │  TranslationUnit { text, tr, _fetching,_done,_err,_tries, payload }  │
                │  Engine = createEngine({ translate, selectActive, targetLang, detect? }) │
                │     setUnits · pump · stateOf · retry · reset                       │
                │     state machine: pending → translating → (done | nothing | error→retry) │
                │     pump(): only translate units selectActive() picks; backoff retry │
                │  helpers: isTranslated · isAlreadyTargetLanguage · looksLikeCode ·   │
                │           language helpers · createPager · MSG · t · DEFAULT_TARGET_LANG │
                └──────────▲────────────────────────────────────────────▲─────────────┘
        DOM source (units{node})                                  timed text (units{start,end})
   ┌──────────────────────┴───────────────────────────┐   ┌──────────┴─────────────────────┐
   │ DomSegmenter — normal webpages + YouTube          │   │ SubtitleSource — video subtitles │
   │   title / description / comments                  │   │   yt-hook → parseJson3 → cues    │
   │   standard-HTML segmentation                      │   │   → mergeSentences               │
   │   scheduling = viewport-priority + lazy           │   │   scheduling = time-window       │
   │   renderer = child injection (+ rich text)        │   │   renderer = subtitle overlay    │
   └────────────────────────────────────────────────────┘   └────────────────────────────────┘
```

One **sink** hangs off the end of this pipeline — the learning layer's Collector
(§9). It is not a fourth stage: it reads what the Renderer already displayed and can
never influence anything upstream of it. Deleting it at runtime must leave
translation output byte-for-byte identical.

## 2. The split is "is the source DOM?", not "which site"

- **Anything that IS DOM** (normal pages **and** YouTube's title/description/
  comments) → the single general **`DomSegmenter`**. No per-site selectors; in
  particular **no `YT_TARGETS`**.
- **Video/audio subtitles are NOT DOM** — they are a timed transcript fetched
  whole (YouTube `/api/timedtext` json3; podcast WebVTT/SRT). There is no DOM to
  segment, so they use a different **kind** of extractor (`SubtitleSource` /
  `PodcastSource`), but feed the **same Engine**. This is a *source-kind* difference,
  not a site difference.
- **A third source kind — `AsrSource` (§2.4, added 2026-09-06).** When no timed
  transcript exists anywhere, the user may *ask* for one: on their explicit tap the
  page's own media is transcribed by the speech-to-text endpoint they configured, and
  the resulting timed cues feed the **same Engine** through the same harness. It is a
  source, never a different pipeline — the Engine and Renderer cannot tell it apart
  from a fetched transcript.
- **Podcast bilingual subtitles** are the audio analogue of video subtitles — see
  **§2.2**. Where a podcast has no timed transcript, it is just a **page** (show
  notes / a text transcript) and falls to the normal `DomSegmenter` text path —
  plus the §2.4 offer, which the user may take or ignore.

### 2.1 YouTube subtitle core constraint (核心约束 — do not break)

The YouTube subtitle path follows **one** logic, identical on every platform
(Safari iOS, Chrome) and identical to the Chrome-extension logic:

1. **Fetch the COMPLETE transcript up front, in one shot.** Acquire every cue for
   the current video as a single transcript before/at playback start — never
   caption-by-caption off the live player DOM. `AsrSource`'s file tier (§2.4)
   satisfies this rule literally; its live tier is the **one written exception**,
   bounded in §2.4 — it appends whole sentences in playback order and still never
   translates a caption or a word.
2. **Translate ahead in a 60-second sliding window, in batches** (`engine.pump`
   over `WINDOW.AHEAD_MS = 60000`). Whole merged sentences, with context.
3. **No word-by-word / per-caption translation.** We never translate YouTube's
   rolling live-caption text as the steady-state path. As long as translation
   throughput ≥ playback speed (the normal case, because work runs ahead), the
   **`⏳ 译文准备中…` state must not recur** during steady playback.
4. **Acquisition must not depend on `world:"MAIN"`.** Safari iOS does not support
   `world:"MAIN"` content scripts, so the page-world `fetch` hook in `yt-hook.js`
   can never capture the transcript there. And the caption-track `baseUrl` from
   `ytInitialPlayerResponse` **cannot be fetched directly** — `/api/timedtext`
   enforces a `pot` (proof-of-origin) token that only YouTube's own player mints,
   so a forged request returns `HTTP 200` with an **empty body** (verified).
   Therefore the transcript is acquired by the **isolated content script** like so:
   - Enable the player's captions once (so YouTube itself fetches the transcript,
     minting a valid `pot`) — cross-platform CC auto-enable.
   - Read YouTube's **own** `/api/timedtext` request URL (which carries the live
     `pot`/signature) from the **Resource Timing API**
     (`performance.getEntriesByType('resource')`, readable from the isolated world).
   - **Re-fetch that exact URL** ourselves (forcing `&fmt=json3`) to get the full
     transcript body, then `parseJson3 → mergeSentences → engine`.

   A `world:"MAIN"` fetch hook (`yt-hook.js`) remains only as an **opportunistic**
   capture that hands us the body directly on platforms that support it (Chrome) —
   never the sole source.

If the transcript genuinely cannot be obtained (no caption track, re-fetch blocked),
show a one-line notice — **do not** silently regress to per-caption translation.

### 2.2 Podcast subtitle core constraint (核心约束 — do not break)

Podcast bilingual subtitles are the **audio analogue of §2.1** and follow the same
one logic, reusing the same Engine (`createSubtitleEngine`, 60s translate-ahead) and
overlay renderer. The only podcast-specific parts are the **source** (where the
timed cues come from) and the **renderer anchor** (no video frame → fixed to the
viewport, not a player element).

1. **Prefer an EXISTING timestamped transcript; generate one only via §2.4, on the
   user's tap.** Acquire the COMPLETE timed transcript up front from a source that
   already carries timestamps:
   - **In-page caption file** — a WebVTT/SRT URL embedded in the page (e.g. Substack
     embeds a CloudFront-**signed** `…/en.vtt?Expires=…&Signature=…&Key-Pair-Id=…`;
     also `<track src>`). Use the *signed* URL; the bare URL is rejected. Fetch it
     from the isolated content script (cross-origin allowed via `<all_urls>` host
     permission, like the YouTube timedtext re-fetch) and `parseVtt/parseSrt → cues`.
   - **Podcasting 2.0 `<podcast:transcript>`** — discover the feed
     (`<link rel="alternate" type="application/rss+xml">`), match the current episode
     by its audio enclosure URL, read the `url`/`type` (prefer `text/vtt` /
     `application/x-subrip`), fetch + parse.
   - **Spotify synced transcript** (Phase B) — scrape the "Read along" cue nodes
     from the Now Playing DOM (audio is DRM/EME, but `currentTime` is still readable).
2. **Translate ahead in the 60-second sliding window, in batches**; whole merged
   sentences (`mergeSentences`), with context — identical to §2.1.
3. **No word-by-word.** The `⏳ 字幕加载中…` / steady-state must not flap; once loaded,
   never regress to per-line live translation.
4. **Sync to the `<audio>` element's `currentTime`** (`getCurrentTime` reads the page
   media element). DRM (Spotify/EME) hides the samples, **not** the playback clock.
5. **No *automatic* ASR.** If no timed transcript exists, show `字幕不可用` **with the
   §2.4 offer** (a button; nothing starts until it is tapped), and let the existing
   webpage text path translate the show-notes / transcript **page** as the floor.
   *(Before 2026-09-06 this rule read "No ASR / no self-generated transcripts
   (no-backend; infeasible on Safari iOS)". Both premises fell: the transcription
   runs on the endpoint the user configured, never on a backend of ours, and the
   file tier is two operations — fetch bytes, POST them — that Safari iOS already
   performs on the VTT path. See §2.4 and §5.3.)*

Platforms: **generic in-page VTT/SRT + RSS `podcast:transcript`** (incl. Substack)
are Phase A; **Spotify** synced-DOM is Phase B. **Apple Podcasts web** and **小宇宙**
expose no timed transcript on web → **text-only** (page path), no subtitle overlay.

### 2.3 Twitter/X video subtitle core constraint (核心约束 — do not break)

x.com/twitter.com in-tweet video is the **video analogue of §2.1/§2.2** and follows
the same one logic, reusing the same Engine (`createSubtitleEngine`, 60s translate-
ahead) and overlay renderer. Twitter-specific parts are only the **source**
(HLS-embedded WebVTT) and the **renderer anchor** (the active tweet's video).

1. **VTT-ONLY — never ASR, never per-caption.** X serves video as HLS
   (`video.twimg.com/amplify_video/<id>/pl/<hash>.m3u8`). Captions exist **only when
   the uploader/X provided a WebVTT subtitle track** — surfaced in the HLS **master
   playlist** as `#EXT-X-MEDIA:TYPE=SUBTITLES,…,URI="…"` (X auto-generates one for
   many videos, `CHARACTERISTICS="twitter.auto-generated"`). If there is **no
   SUBTITLES track**, show `字幕不可用` — this is a **first-class, common** outcome,
   never a word-by-word fallback and never an *automatic* ASR fallback. The §2.4
   offer applies here as on every subtitle surface; X video and Spaces are MSE
   (`blob:`) media, so only §2.4's live tier can serve them.
2. **Acquire the COMPLETE transcript up front** (verified 2026-07-18 on the target
   video): master m3u8 → SUBTITLES `URI` → a VOD **subtitle sub-playlist** whose
   `#EXTINF` lists `.vtt` segment(s) (`/subtitles/amplify_video/<id>/<seg>/<hash>.vtt`)
   → fetch + **concatenate** the segments. Unlike YouTube's `/api/timedtext`, these
   URLs are **NOT pot-locked** — a direct fetch from the isolated content script
   returns the real body (`<all_urls>` host permission covers cross-origin
   `video.twimg.com`). The `.vtt` text wraps words in a custom `<X-word-ms …>` tag;
   the shared `parseTimedText` strips `<[^>]+>` and yields clean text, so **the
   podcast VTT parser is reused unchanged**.
3. **Discovery must not depend on `world:"MAIN"`** (Safari iOS). The master `.m3u8`
   URL is recorded from the **Resource Timing API** by an isolated `document_start`
   observer (`content/tw-media-observer.js`, `window.__mtTwHlsUrls`) — same pattern as
   `yt-timedtext-observer.js`. Multi-segment VTT carries `X-TIMESTAMP-MAP`; honor per
   segment (or trust absolute cue times for a single segment) before `mergeSentences`.
4. **Translate ahead in the 60-second window, whole merged sentences** — identical to
   §2.1/§2.2; once loaded the `字幕准备中…` state must not recur during steady playback.
5. **A tweet/feed can hold MANY `<video>` elements.** The active media is the
   playing / most-viewport-visible one, chosen with **hysteresis**: the current active
   video is kept until it stops/leaves the viewport or another video's visible area
   clearly exceeds it (≥1.3×), so two comparably-sized videos do not flip every 250ms
   tick (a flip changes `mediaKey` → engine reset). `mediaKey` = the tweet's status id
   (from the nearest `a[href*="/status/"]`) so scrolling to another playing video
   re-acquires that video's transcript. See §5.
6. **Overlay AND the `译` button are anchored INSIDE the active video's player
   container** (re-parented into it, `position:absolute`), not left `position:fixed`
   on `document.body`. This is the §2.1 YouTube pattern (`placeOverlay` →
   `player.appendChild(ov)`) and is **load-bearing for fullscreen**: the browser
   promotes only ONE element into the top layer on fullscreen, so a body-level `fixed`
   sibling of the fullscreened player is not painted and the subtitle vanishes. Placing
   both controls *inside* the container that X fullscreens makes them ride into the top
   layer and survive. A `fullscreenchange` / `webkitfullscreenchange` listener is the
   fallback: if `document.fullscreenElement` differs from our container, re-parent
   overlay + button into it. **Desktop fullscreen with bilingual subtitles is a
   first-class, must-verify surface (Chrome + Safari on x.com);** it is a **permanent
   matrix item** per `verification-spec.md` §0. (iOS uses the OS's native video
   fullscreen — a DOM overlay cannot cover it; that is a documented N/A, never faked.)

### 2.4 AI 转写字幕 — user-initiated transcription (核心约束 — do not break)

Added 2026-09-06 after PR0 measurement (`scripts/asr-probe.js`, `scripts/asr-cors-probe.js`;
ledger rows `api.openai.com × whisper-1 / gpt-live-transcribe`). The measured question was
"is a transcription endpoint fast and accurate enough to be a subtitle *source*"; the
answer for OpenAI was yes on every threshold (streaming lag p90 2.24 s en / 2.45 s zh,
WER 3.7 % / CER 3.9 %, 99 % of sentences closed on punctuation, no drops in 12 minutes).
Gemini and Meta are measured the same way before their entries ship.

1. **User-initiated only. Never automatic.** Nothing is captured, fetched or sent until
   the user taps the offer — a button inside the `字幕不可用` notice, or the popup's
   「转写音频字幕」 action (shown only when the page has a media element ≥ 30 s long).
   The offer states the per-minute cost. A decorative `<video>` never surfaces subtitle
   UI (`docs/regression-tests.md` §4) — the popup action is the *only* entry for a
   video with no transcript hint, so `drivesPodcast()` is unchanged. After any stop the
   offer must be tapped again; there is no auto-restart (a media-key flap must not
   restart a paid session).
2. **Tier A — file mode — is the baseline, and it obeys §2.1 rule 1 literally.** When
   the media has a fetchable `http(s)` URL, the whole file is fetched and transcribed
   *once*; the complete timed transcript arrives before it is used, exactly like a VTT.
   This tier needs nothing Safari iOS lacks (§5.3).
3. **Tier B — live mode — is the one written exception to "complete transcript up
   front".** When there is no fetchable URL (`blob:`/MSE — YouTube, Twitch, X video and
   Spaces, live streams) the element's audio is captured in-page and streamed to the
   endpoint; cues are **appended in playback order as whole sentences** (closed on a
   sentence terminal, `MAX_LEN`, or a silence gap — the same closing rules as
   `mergeSentences`). The open tail sentence is never handed to the Engine, so no unit
   is ever replaced and no translation is ever discarded. **No word-by-word, no
   per-caption translation** — the Engine still receives sentences, in a window, and
   translates them exactly as it does a fetched transcript. Because a sentence can only
   close after it has been spoken, the pair appears **after** the speech (measured
   ≈ 1.8 s p50 before translation); the Renderer holds it on screen for `HOLD_MS`
   after its end or until the next sentence, and the live window uses a longer
   `GRACE_MS` so `⏳ 译文准备中…` does not flicker on every sentence.
   *Amended 2026-09-06 (user decision, after trying a YouTube live stream):* the live
   tier may additionally **translate the growing partial** — 「边说边译」, on by default
   for live sessions, a menu toggle. The original line shows words as they are
   recognised; the translation line shows a debounced (≈ 0.9 s), one-in-flight
   translation of the partial and is **replaced** as the sentence grows; when the
   sentence closes, a partial translation of that exact text becomes the unit's `tr`
   (no second request). This is a Renderer/harness affair: the Engine still receives
   only closed sentences, and the "no word-by-word" clause is read as *no per-word
   units in the Engine and never for fetched transcripts*, not as *no live feedback*.
   The cost is bounded by the debounce (≈ 3–5 partial requests per sentence) and the
   quality of a partial is by construction provisional — the UI marks it with an
   ellipsis. Run-on speech is closed at a clause boundary past ~90 characters so a
   speaker who never lands a period does not hold the pair back indefinitely.
   *Same day, second step:* the Renderer gains a **second output surface** for the
   live tier — a floating multi-line 「字幕历史」 panel (bottom-right of the viewport,
   inside the fullscreen element when there is one) that lists the closed sentences
   with their whole-sentence translations, the corrected record; while it is on
   (default, a menu toggle remembered in storage) the in-video overlay shows ONLY the
   stream — the partial and its provisional translation — and never a closed
   sentence. The Engine is unchanged; the learning Collector treats a pair as
   displayed the moment its final translation lands in the panel, once per sentence.
4. **Capture is the capability, not the floor.** Tier B depends on
   `HTMLMediaElement.captureStream()` (Chrome, Firefox) or Web Audio's
   `createMediaElementSource` (Safari), both of which refuse or silence cross-origin
   media loaded without `crossorigin` — so a live session first probes the media URL
   with a CORS `GET`, reloads the element with `crossOrigin='anonymous'` at the same
   position, and only then attaches. Where the CDN sends no CORS header, live mode is
   impossible and the notice says so. Where capture attaches but yields silence for
   3 s while the element is playing and unmuted, the session stops and the notice says
   so. **Never a silent failure**: every stop (silence, CORS refusal, socket close,
   region refusal) is a visible line in the overlay.
5. **Audio goes only to the endpoint the user configured. Our server never sees it.**
   This is AGENTS.md product rule 5 restated for this source: we transmit page media
   to the user's own STT endpoint at the user's request, and nothing of ours stores,
   proxies or logs it. The privacy copy ships in the same version (`release-checklist`
   §2). There is no zero-config engine here for the same reason there is none for 说
   (`stt.config.js` header): an empty `sttEngine` means the offer opens settings.
6. **Stops are total.** A `mediaKey` change, `disable()`, or a change to the
   transcription settings aborts the capture, closes the socket and drops the open
   tail; already-appended sentences keep their translations (the Engine's `reset()`
   keeps units and re-translates, as today).

Registry consequences are in §7 (`liveEndpoint` / `liveType` / `liveModel` /
`uploadEndpoint` on `build/stt.config.js` entries, and the subprotocol / query-string
key carve-outs). Module consequences are in §6. Per-surface expectations are named in
`docs/verification-spec.md`.

## 3. Generality — DomSegmenter uses only standard HTML semantics

`DomSegmenter` relies on: block/inline classification (by computed `display` —
`inline`/`contents` are inline, `inline-block`/`inline-flex`/… are blocks),
`getComputedStyle` visibility, **open Shadow DOM traversal** (web components like
reddit's `<shreddit-*>` keep the nav / sidebar / description in shadow roots — a
plain TreeWalker on `document.body` never enters them, so we recurse into every
open `shadowRoot`), standard attributes (`translate="no"`, `.notranslate`,
`aria-hidden`, `contenteditable`), **script-aware minimum length** (CJK/Hangul/Thai
floor 2, Latin/Cyrillic floor 10 — a flat char count is biased against dense
scripts), and text heuristics (Unicode `\p{L}` "has a letter" + URL/email/@/#/
`looksLikeCode`). **Zero site selectors.** Reddit's inline `SML.load([[…]])` is not
translated because it lives in a non-rendered / hidden node and looks like code —
a consequence of the generic rules, true on GitHub/Medium/any SPA alike.

**Inline code is KEPT VERBATIM; block code is excluded.** `pre` and any
`code`/`kbd`/`samp`/`var` whose computed display is block-level are never
translated and never descended into — that is what the exclusion is for. But the
same tags used **inline inside a text-bearing paragraph** carry sentence-critical
content, and dropping them does not produce a shorter sentence, it produces a
**wrong** one:

> `Apps start from a hotkey (<kbd>Super + Return</kbd> for the terminal, …)`
> extracted as `Apps start from a hotkey ( for the terminal, …)`
> → 「应用通过热键启动（终端用热键，浏览器用热键…）」

The engine did nothing wrong; it faithfully translated a sentence with holes in
it. So inline code-ish elements contribute their text to the unit **unchanged**,
and are handed to the engine as ordinary words.

Deliberately NOT done: a placeholder protocol (`⟦1⟧` … restore after). It buys
protection against an engine rewriting `Super + Return`, and costs a wire format
that every engine must honor — and when one doesn't, the failure is a paragraph
with visible garbage markers rather than a slightly-reworded key name. The
original stays on the page next to the translation (bilingual display is the
whole product), so a reworded identifier is recoverable by looking one line up; a
hole is not recoverable by anything.

**Leaf-block detection must see through `display:contents`.** A unit is a *leaf
block* (collected whole) only when it has no block-level child; otherwise we
descend. `display:contents` generates **no box** (so it is neither block nor
inline for layout), but its children DO render as blocks. So `hasBlockChild` must
treat a `display:contents` child as **transparent and recurse into it** — a
container whose only child is a `display:contents` wrapper (e.g. Substack's
`.single-post` → `div.pencraft[display:contents]` → the real paragraphs) would
otherwise be mis-seen as a leaf and its **entire subtree collected as ONE giant
unit**. That produces a single multi-thousand-px blob translation (duplicating the
real per-paragraph translations nested inside it), and when that blob re-renders
above the viewport the browser's scroll anchoring jumps the page far down. The rule
is symmetric with the visibility rule above, which already treats `display:contents`
as "render its children."

**…and an INLINE-LEVEL box must not break a paragraph.** The mirror image of the
same mistake. `inline-block` / `inline-flex` / `inline-grid` / `inline-table` are
**inline-level**: they sit in the parent's *inline* formatting context, in the line
box next to the text. They are decorations *within* a paragraph — an emoji wrapper,
a badge, an inline icon — not a break in it. Only `block` / `flex` / `grid` /
`list-item` / `table` are block-level and end a paragraph.

Counting them as blocks silently deletes the paragraph: `hasBlockChild` reports the
paragraph as a container, so the walker declines to collect it and descends instead;
inside, the prose lives in `inline` spans that the walk rejects, and the badge itself
fails `minLen`. **Nothing is collected — no translation, no placeholder, no error**,
which is worse than a visible failure because there is nothing for the user to
retry. (Found on x.com, where a tweet body is spans + `inline-flex` emoji wrappers —
but this is not site knowledge: any page with an inline badge inside running text has
it.)

So "does this child break the paragraph?" is a **different question** from "could
this element be a unit?", and the two must not share one predicate. Leaf-block
detection asks the former; an inline-level child answers *no*.

**Guard — do not resurrect the giant-blob failure.** A container whose children are
*all* inline-level boxes with no text-bearing inline content between them (an
inline-block card grid) is still a layout container and must be descended into,
exactly as above. An inline-level child therefore stops breaking the paragraph only
when the element **also holds inline content that actually bears text**. That keeps
both cases: decorated paragraph → one unit; card grid → one unit per card.

**Don't translate the media-player region.** The video player's chrome (live
captions, controls) and our own subtitle overlay belong to the **subtitle/player
path**, not the webpage extractor — so `DomSegmenter` skips any subtree inside a
video player (`<video>`'s player container) and our `#mt-yt-overlay`. Otherwise
the webpage path collects the live caption text and injects a "translating…"
placeholder under it (the duplicated-caption bug).

Real players nest several wrappers, and caption/transcript layers can live in
an OUTER shell as *siblings* of the inner video wrapper the generic
`closest('[class*="player"]')` finds (Substack: `playerShell > stage >
{video-player > VIDEO, captions, transcript scroller}` — the live caption rows
end up inside the collected page text, churn per word, and get translation
placeholders injected). Per domain review (2026-07-12): widening is
**site-specific knowledge and belongs to the platform adapters**, exactly like
the YouTube and Spotify adapters — the segmenter itself stays free of per-site
branches. Mechanism: an adapter marks the player shell it knows with
**`data-mt-player-region`**, and `DomSegmenter.computePlayerRegions` honors
that marker generically (marked subtree = player region, excluded from the
webpage path). The Substack adapter (in the podcast path, which already owns
Substack transcript acquisition) feature-detects the player shell by its
stable class prefix (`[class*="playerShell"]` containing a media element) and
re-asserts the marker each tick, so SPA re-renders can't shed it.

**Non-content chrome regions — the `data-mt-skip-region` marker (second generic
seam).** Some sites wrap large, unambiguous **non-content chrome** in a structure
that the content filters below cannot cleanly reject: a feed's trends /
who-to-follow sidebar, a footer link farm, a "subscribe to Premium" promo. Its
text is long, letter-bearing, real prose — so `minLen` / `isUntranslatable` pass
it, and it clutters the page with translations of things nobody reads bilingually
(x.com is the motivating case — see the Twitter adapter). This is site-specific
knowledge, so — exactly like `data-mt-player-region` above — it enters through a
**generic marker, never a segmenter selector**: a platform adapter that KNOWS its
chrome marks the subtree with **`data-mt-skip-region`**, and `DomSegmenter`'s
`computeSkipRegions` honors that marker generically (marked subtree = excluded
from the webpage path, pruned in `hardSkip` like a player region). The segmenter
itself gains no `data-testid`/host branches. The marker is the **only** sanctioned
way to skip a *region*; it is a deliberate, adapter-scoped exception to the
"skip by content, not by region" rule below, and adapters — not the segmenter —
are the sole writers of it (each adapter feature-detects its own site, so the
global marker never fires elsewhere).

**Skip by content, not by semantic region.** We do NOT blanket-skip
`<nav>/<header>/<footer>/<aside>` — SPAs (e.g. reddit) put real content (sidebar
descriptions, rules, nav labels) inside them, and the reference translates those.
A unit is dropped only by: excluded/hidden/attribute (hard, prunes subtree),
control roles (`button/menu/menuitem/tab/…`) or ad/chrome class patterns
(`ad/banner/cookie/…`, soft — skip the unit, keep descending), `looksLikeCode`/
URL/symbol text, or `< 10` chars. Short UI labels ("Home", "Wiki") fall out via
the length filter; long content (descriptions, rules) translates.

## 4. Consistency — webpage and subtitle paths are isomorphic

Both are `source → Extractor → units → same Engine (state machine + retry) →
Renderer`. The webpage path uses the **same per-unit state machine** as subtitles
(pending / translating / done / nothing-to-translate / error-with-retry). The old
ad-hoc `translateNode` (no retry/error UI) and the `YT_TARGETS` special path are
folded into `DomSegmenter + Engine`.

YouTube page-text specials become **general renderer capabilities**, not site
selectors: child injection (resists Polymer re-render, also fine on normal
pages — see the renderer contract below for why it is a child and not a
sibling), clickable URLs (general), interleaved description. Only "timestamp click →
`video.currentTime`" is a small optional renderer hook.

**Engine settings are read late, not captured at construction.** `createEngine`
accepts `targetLang` as either a string or a **getter function**, and `pump()` reads
it per tick. The subtitle harness needs the getter: `createSubtitleUI` builds its
engine at module scope, *before* `init`/`enable`/`updateSettings` ever assign
`settings` — capturing the value there froze the same-language check to
`DEFAULT_TARGET_LANG` for the whole session, so subtitles ignored the user's chosen
target language entirely. `translate` was already injected as a late-reading closure
for exactly this reason; `targetLang` now matches it. Anything else the engine reads
from user settings must follow the same rule.

**Renderer contract: the translation is a CHILD of its original, and the mirror is
not a one-shot.**

- **The translation goes INSIDE the original block, as its last child** — not
  beside it. This is the load-bearing half of the contract, and it is not a style
  preference: **an extra child in a container the page's framework owns is a
  correctness bug.** React (and every position-matching reconciler) aligns its
  children by index. A foreign node inserted between two of them shifts every
  position after it, so the next commit does not patch — it moves the whole list.
  Measured on `lennysnewsletter.com` (2026-08-23), one selection change inside the
  article:

  | our nodes in `div.body.markup` | mutations | `<p>` moved |
  |---|---|---|
  | 3, as siblings | 188 | **76** |
  | 0 | 12 | **0** |
  | 3, as children of their paragraphs | 6 | **0** |

  Three was enough. The nodes are *moved* (same objects re-inserted), not
  replaced — which is why this was survivable for a year: a live selection could
  be snapshotted and re-asserted. **Clicks could not.** A real mouse click landing
  dead centre on a hyperlink reported `mousedown`/`mouseup` with
  `target = DIV.single-post-container` instead of the `<a>`, and two mousedowns
  produced one `click`: the paragraph is moved out from under the pointer between
  press and release, so the browser retargets the click to a common ancestor or
  drops it. The anchor never activates. **「链接打不开」and「选不中」are one bug.**

  The 2026-08-12 note in `content-webpage.js` had already measured the same
  asymmetry ("ZERO paragraph mutations without our siblings and hundreds with
  them") and answered it with repair-after-the-fact — a pre-paint re-anchor pass
  plus a selection keeper. Repair cannot reach a click that was never dispatched.
  So the fix moved to the cause.

  Being a child also *removes* machinery rather than adding it: inside the
  original's own box there is no parent flex direction to reverse the pair
  (`computePlacement`), no sibling to constrain (`layoutCss` width mirroring), and
  no flex item to un-wrap on the parent (`flowFixCss`). Those exist to compensate
  for being a sibling. What replaces them is narrower: when the ORIGINAL is itself
  a flex/grid container our child becomes one of its items, and only then does it
  need a full-row escape.

- **The interleave holder stays a sibling, and that is not an oversight.** The
  interleave path HIDES the original (`data-mt-hidden`); a holder placed inside a
  `display:none` node would be hidden with it. So blobs keep the old placement and
  the old exposure. Acceptable because the two do not meet in practice: interleave
  only fires on multi-paragraph blobs, and `INTERLEAVE_UNSAFE` already bails out
  any blob containing a link, button, or media. A framework container full of
  blank-line blobs would still churn — write the fixture the day a real page does.

- **Placement follows VISUAL order, not DOM order.** "Original above, translation
  below" is the invariant. As a child, last-child achieves it unconditionally —
  the reversal rule below now applies only to the interleave holder, which is
  still a sibling. In a container whose visual order is reversed
  (`flex-direction:column-reverse`, or a row with `flex-wrap:wrap-reverse`, where
  the lines stack upward) the renderer anchors that holder *before* the original
  instead. The decision is computed from the parent's computed style at render
  time and cached on the node, so the per-tick re-anchor pass never forces a
  style recalc.

- **The cost we accepted: selecting a paragraph now selects its translation too.**
  A child is inside the original's range, so 划选整段 / ⌘A / copy picks up both
  languages. That is the same trade every in-place bilingual reader makes, and it
  is the honest side of the trade — the alternative is a pair the page's own
  framework destroys on every click.
- **The mirror is re-measured when the viewport changes.** The copied geometry is
  viewport-time pixels (width cap, inline-start indent, the flex-row wrap fix), so
  rotation / resize / a media-query breakpoint invalidates it. The renderer drops
  the frozen state (debounced) and re-arms the render key; the next tick re-runs
  the **same** first-render path — there is deliberately no second layout code
  path. A hidden interleave original is briefly restored inside the same task
  (never painted) so it can be measured rather than served from a stale cache.

## 5. The control/render adapter — the only variation point (device × site × capability)

**Principle: parsing / segmentation / engine are single implementations. ALL
variation lives in one thin control/render adapter, and that adapter varies along
exactly THREE axes — DEVICE, SITE and BROWSER CAPABILITY.**

Naming the second axis is deliberate. The adapter always carried it (YouTube's
overlay anchors into `#movie_player`, the podcast overlay anchors to the viewport
because an audio page has no player), but the doc only described the device axis, so
the first *button*-level site difference (Twitter, below) read as an unexplained
exception. It isn't one — it is the site axis doing its job. The third axis is named
for the same reason: the adapter already carried it (`yt-hook.js` exists only where
`world:"MAIN"` does, §2.1), and leaving it unnamed would make the next
capability-conditional feature read as an exception too. What must stay closed is
the boundary: three axes, in one layer, and nowhere else.

**When a SITE difference is legitimate** — all three must hold, or it is an
anti-pattern:

1. It lives **only** in the control/render adapter. Nothing reaches `DomSegmenter`,
   `SubtitleSource` or the Engine — in particular **no `dom-processor` selectors**
   (the §3 rule stands; site knowledge into the extractor still enters *only* through
   the generic `data-mt-player-region` / `data-mt-skip-region` markers).
2. It is forced by an **observable property of the host's own player/DOM** — the shape
   of what that site fullscreens, whether a media element exists at all — not by
   taste, and not by "this site felt nicer that way".
3. The **reason is written down here** next to the difference, so the next site is
   judged against the property, not against the precedent.

- `DomSegmenter` / `SubtitleSource` / `Engine` are **single implementations, not
  per-device and not per-site**. Standard HTML semantics apply identically to mobile and
  desktop DOM. *Needing a per-device or per-site branch in the segmenter means it has
  regressed into selector dependence (anti-pattern).* Device-specific behavior (touch
  tap-to-translate, FAB, viewport size) belongs to the **interaction layer**;
  viewport size is read at runtime (`innerHeight`), not branched in code.

### 5.1 The DEVICE axis — mobile vs desktop vs embed

- **YouTube video module** is unified; the desktop/mobile/embed differences are
  isolated in a `PlayerContext` adapter (the only variation point):
  - **desktop (non-touch)**: floating 译 button controls video subtitles; the page FAB
    controls page text separately (two independent controls).
  - **mobile (any touch device)**: **no separate 译 button** — the page FAB drives BOTH
    video subtitles and page text. This is `m.youtube.com` (no control bar) AND a
    phone / iPad on the desktop-layout `www.youtube.com` (which DOES have a control bar).
    The device is detected by a **single shared signal**, `TranslationCore.isMobileLayout()`
    (`navigator.maxTouchPoints > 0` or a mobile UA) — used by BOTH `content-main` (which
    control drives YouTube) and `content-youtube` (whether to mount the 译 button), so the
    two can never disagree. (Keying "mobile" off the `m.youtube.com` host in one place and
    the `.ytp-right-controls` DOM in the other is what produced the two-button bug.)
  - embed (iframe): floating 译 button; menu fixed
  The subtitle core (SubtitleSource + Engine + OverlayRenderer) is shared across all three.

### 5.2 The SITE axis today — control anchoring

The one place sites currently diverge is **where the overlay and the `译` button are
anchored**. Current state, stated plainly rather than as a rule, because the two sites
are not symmetric:

| site | overlay | desktop `译` button |
|---|---|---|
| **YouTube** | inside the player — `placeOverlay` → `player.appendChild(ov)` on `#movie_player` | **floating**, `position:fixed` on `document.body` (`content-youtube.js` `btnCss`), sitting above the page FAB |
| **Twitter/X** | inside the active tweet's player container | **inside the same container**, `position:absolute`, top-right |
| **Podcast** | viewport-anchored `position:fixed` — an audio page has **no player element to anchor to** (§2.2) | floating control, shown only while subtitles are active |

**Why Twitter embeds its button** (test #2 above — an observable property of the host):
X's desktop player fullscreens **its own container `div`**, which can host child nodes.
The browser promotes only ONE element into the top layer, so a body-level `fixed`
sibling of that container is not painted — the control would vanish in fullscreen.
Putting both the overlay and the button *inside* the container that X fullscreens makes
them ride into the top layer (§2.3.6), and additionally binds the button unambiguously
to the video it controls, which matters because a feed holds many videos (§2.3.5).
Verified live in fullscreen on macOS Safari, macOS Chrome and Firefox.

**Why YouTube's button is still floating: history, not a decision.** It predates the
Twitter work; the overlay was moved into `#movie_player` but the button was not. An
earlier draft of this section justified it as "YouTube's control bar auto-hides, so an
in-bar button would disappear" — that reasoning is **wrong and has been removed**:
*inside the player container* is not *inside the control bar*. Twitter's button is an
`position:absolute` child of the container, not part of X's control chrome, and it does
not auto-hide. Nothing about YouTube prevents the same treatment.

> **Open question — not verified.** By the §2.3.6 top-layer argument, YouTube's
> body-level `fixed` button should **disappear when the video is fullscreened** (the
> overlay survives; the button is not inside `#movie_player`). This has **not** been
> tested — two attempts to drive YouTube into fullscreen did not land, and no claim is
> made here either way. If it reproduces, the fix is to anchor YouTube's button into
> `#movie_player` exactly as Twitter does, which would collapse this row of the table
> and make in-container anchoring a genuine cross-site rule. Tracked separately; do not
> cite the current asymmetry as intentional design.

Mobile (touch) is unaffected on both sites: the `译` button is suppressed and the page
FAB drives both page text and subtitles, via the shared
`TranslationCore.isMobileLayout()` signal.

### 5.3 The BROWSER-CAPABILITY axis — opportunistic, never load-bearing

Some browsers expose a capability others do not. `world:"MAIN"` (§2.1) was the first;
**browser-native language detection is the second**. The rule that keeps this axis from
becoming a second product:

1. **The baseline must be complete on the weakest surface.** Safari iOS is the floor.
   A feature whose *correctness* depends on a capability Safari lacks is out of scope
   (that is the §8 argument against *in-browser* ASR, i.e. recognition running in the
   browser itself). A capability may only make an already-correct baseline **cheaper
   or sharper** — never supply the only working path.
2. **The capability is injected into the core, never probed by it.** The adapter
   probes, and passes a plain function in. The core's contract is that function's
   signature, not the browser behind it — `TranslationCore` must not call
   `chrome.i18n.detectLanguage`, test for `world:"MAIN"`, or sniff a UA.
   State the rule against the *capability*, not a namespace: `TranslationCore` does
   legitimately call `chrome.i18n.getUILanguage` / `getMessage` for locale lookup, so
   "must not contain the string `chrome.i18n`" would be false the day it was written —
   and a governance rule that fails on its own codebase gets ignored.
3. **Degradation is silent and total.** Absent capability, broken capability, and a
   capability that throws all reduce to the same thing: the baseline path, byte for
   byte. No retry loop, no user-visible notice, no half-state.
4. **The difference is written down here, and named in `docs/verification-spec.md`
   as a per-surface expectation** — so a regression on the surfaces that *lack* the
   capability is a test failure, not an untested assumption.

**Today's instance — same-language skip.** `createEngine` takes an optional
`detect(text)`. When absent (all Safari rows), the engine uses only the script-based
`isAlreadyTargetLanguage()`, which is decidable for zh/ja/ko targets and returns false
for everything else. When present (Chrome/Edge via `chrome.i18n.detectLanguage`,
Firefox likewise), the engine may additionally skip a unit whose detected language
matches a **non**-script-decidable target — the English/French case script cannot
separate. zh/ja/ko targets never consult the detector, so the most-used path is
identical on every surface by construction.

**Second instance — AI 转写字幕 (§2.4), 2026-09-06.** The baseline is tier A, file
mode: fetch the media bytes, POST them to the user's transcription endpoint, receive a
complete timed transcript. Those are the same two operations the VTT path already
performs on Safari iOS, so the baseline is complete on the floor. In-page audio
capture (tier B) is the capability: it exists on Chrome/Firefox (`captureStream`) and
on Safari (`createMediaElementSource`, with the crossorigin reload), and it only
**sharpens** the case where the baseline already failed for a reason outside our
control — the media has no fetchable URL. Where capture is absent, refused (CORS) or
silent, the surface behaves exactly as if tier B did not exist, with one deliberate
departure from rule 3: because the user *tapped* for this, the degradation is
**named in the overlay** rather than silent — §9.1's "never silent to a user who opted
in" outranks rule 3's silence, which was written for automatic sharpening nobody asked
for. iOS native HLS (`src=.m3u8`) is expected to yield silence from Web Audio and is a
matrix row, not an assumption.

> **Accepted asymmetry — reviewed, not overlooked.** This axis is weaker than the
> other two: DEVICE and SITE change *where* things are drawn, whereas this one can
> change *what the user sees*. With an `en` target on an English page, Chrome draws
> nothing under the paragraph and Safari draws a redundant translation line. That is
> deliberate — Safari's behaviour is exactly today's behaviour, so no surface
> regresses, and the alternative (holding every browser to Safari's floor) means
> permanently burning provider quota on requests whose answers are discarded. The
> asymmetry is bounded by the strict gates in `docs/interaction-spec.md`: the detector
> can only ever *remove* a line that duplicates the original.

### 5.4 The RESTRICTION axis — when a browser takes something away

§5.3 covers a browser having a capability others lack, and its rule is that the extra
capability may only sharpen an already-complete baseline. **This axis is the mirror
image and needs the opposite rule:** a browser can *forbid* something the baseline
depends on, and then the compensating path is not opportunistic — it is the only
working path on that surface, and it must be built.

**Today's instance — Firefox applies the host page's CSP to content-script `fetch`.**

Measured 2026-08-06, same Mac, same page (`en.wikipedia.org`, whose CSP `default-src`
allows `*.googleapis.com` / `api.openai.com` / `api.anthropic.com` but **not**
`api.deepseek.com`), same DeepSeek key, same extension code:

| Browser | Result |
|---|---|
| macOS Safari | 26 / 26 paragraphs translated |
| Firefox | every paragraph `翻译失败` |

On a page with no CSP the same Firefox translates perfectly. So on Firefox **whether
translation works depends on which site the reader is on**, and the user has no way to
tell why — changing key or model does nothing.

Chrome and WebKit both exempt content-script fetches from the page CSP; Firefox does
not. This is not a capability we can decline to use. It breaks the product.

#### The rule

1. **The default stays Safari's.** All translation `fetch` lives in
   `content/translation-api.js` because Safari iOS's service worker goes permanently
   `undefined` after device lock (§5.3.1 / CLAUDE.md). Safari is the floor and the
   floor sets the default.
2. **A restriction earns exactly one exception, at one chokepoint.** Firefox routes
   the same request through the background page, which is not subject to any page's
   CSP. The exception lives in `apiFetch()` — the single function every provider
   already funnels through — so the provider adapters, the retry/timeout policy and
   the error shape are untouched and cannot drift per browser.
3. **Detect the runtime by a fact, never by a UA string.** `chrome.runtime.getURL('')`
   returns `moz-extension://…` on Firefox and nothing else. §5.3 rule 2 forbids UA
   sniffing; this honours it — the check is on what the runtime *is*, not what it
   claims to be.
4. **No silent fallback to the blocked path.** If the background proxy fails, the
   error surfaces. A fallback to the direct fetch would work on CSP-free pages and
   fail on others, i.e. it would restore exactly the site-dependent unpredictability
   this exists to remove — and §7.1 / the #74 decision already ruled that a silent
   fallback that hides a misconfiguration is worse than a visible failure.
5. **The background stays state-only everywhere else — but that is enforced on the
   CALLER side, not by withholding the handler.** The proxy handler used to be
   registered only when the background was running on Firefox, on the theory that this
   made the Safari rule true by construction. It did not; it made §5.5's fallback a
   no-op instead (2026-08-19: the caller shipped for Chrome, the message had no
   listener, and the settings self-check still passed because an extension page is
   CORS-exempt — so the failure only appeared on real pages). The handler is now
   registered unconditionally. What actually holds the rule is that `apiFetch` always
   attempts the direct fetch first; a handler nobody calls creates no dependency.

#### Why this does not reopen §5.3 rule 1

Rule 1 says a capability may never supply the only working path. That protects the
*floor*: Safari must be complete without help. Here the floor is fine — Safari uses the
default path and works. What is broken is a surface *above* the floor, and the
compensation is confined to that surface. The invariant "Safari iOS is complete on the
default path" is untouched; nothing about Firefox's exception is load-bearing for it.

### 5.5 The same axis, second instance — a strict-CORS endpoint

§5.4's restriction came from the *browser*. This one comes from the *endpoint*, and it
is worth writing down separately because the compensating path is the same one and the
naive reading is that it contradicts §5.4 rule 4.

**The instance (measured 2026-08-19, real machine, corporate gateway).** A content
script's `fetch` goes out **as the page**: with the user reading `en.wikipedia.org`, the
request carries `Origin: https://en.wikipedia.org`. Our request also carries
`Authorization` and a JSON body, so it is not a *simple* request — the browser must send
an `OPTIONS` preflight first. The gateway answered that preflight **403**, so the browser
never sent the POST at all and `fetch` rejected with a bare `TypeError`.

The DevTools evidence is unambiguous and worth knowing by sight, because none of it
appears in our own error text:

| Symptom | What it means |
|---|---|
| paired rows: `403 · preflight` then `CORS error · fetch` | the preflight was refused; the real request never happened |
| `Provisional headers are shown` | the request was stopped locally and never hit the network |
| `Referer: https://en.wikipedia.org/` | it was being sent **as the page**, not as the extension |

This also explains the reports that preceded it: the same URL and key work in
command-line clients (no `Origin`, no preflight) and in other extensions (which send
from the background), while our public-API providers were unaffected because they answer
`Access-Control-Allow-Origin: *`.

#### The rule — one request, one route

The first attempt at this shipped as "direct first, fall back to the background on a
CORS failure". It worked, and it was wrong in two ways that only real use showed:

- **Every paragraph paid two round trips.** With translation running concurrently across
  a page, the whole first batch each hit a doomed preflight before discovering the
  fallback. The user's word for it was simply "slower".
- **It needed a memory of failure, and that memory poisoned the page.** Remembering
  "this origin cannot be reached either way" meant one transient miss — an MV3 worker
  mid-wake under concurrency — latched the origin into direct-only, and every later
  paragraph then skipped the background and failed outright. Symptom: the first few
  paragraphs translate, the rest all fail.

So the routing is chosen up front, per runtime, and the retry is only insurance:

| Runtime | Route | Why |
|---|---|---|
| Firefox | background **only**, no fallback | §5.4: the page's CSP governs a content script's fetch, and falling back would make success depend on which site you are reading |
| everything else | background first, direct as fallback | one request, no preflight, and it works against permissive and strict endpoints alike |

**Whether the background is usable is measured, not guessed.** An earlier version split
Safari out by runtime (`safari-web-extension://`) because its worker goes permanently
`undefined` after device lock. That carve-out was withdrawn on request, and removing it
needed something to replace it — the proxy's own timeout cannot serve, because it has to
cover the whole round trip (the background performs the API call before answering, so it
is a ~20s budget), and a dead worker would then cost 20s *per paragraph*.

So the content script asks the background one cheap question — `{action:'ping'}`, local
IPC, 1.5s ceiling — and routes on the answer. This is strictly better than the runtime
guess it replaced: it covers *every* reason a background can be unavailable, not just the
one we happened to know about, and it needs no assumption about whether a device has been
locked. The result is cached per page and **invalidated whenever a proxy attempt fails at
the transport level**, so a worker that was merely mid-wake is used again on the next
request rather than written off — the same self-healing discipline as the route memory
below, and for the same reason.

**The memory only ever records success.** `originRoute` stores the route that worked for
an origin; a failure never writes to it. A failure is a moment, a success is a fact about
the endpoint — and the version that recorded failures is the one that broke the page.
`timeout` never switches routes either: an abort means the request did reach the network,
so resending only doubles the wait.

#### Why this is not the fallback §5.4 rule 4 forbids

The two run in opposite directions. §5.4 rule 4 forbids falling back **to the blocked
path** (Firefox → direct fetch): it would succeed on CSP-free pages and fail elsewhere,
reintroducing site-dependent unpredictability. Nothing here falls back to a blocked path;
each runtime's fallback is the path the *other* runtimes use as their default. It is also
not the #74 pattern: #74 was a silent switch to a *different provider*, which produced a
plausible answer and hid a broken key. Here the endpoint, the credential and the body are
identical — only the sender changes.

#### What this costs the test harness

CDP's `Fetch` domain is scoped **per target**, so intercepting on the page session no
longer sees the traffic: it now originates in the extension's service worker. The layout
suite must attach to that target for **every** fixture, not just the error-path ones —
without it the mocked provider is bypassed entirely and the fixtures hit the real
network (measured: 1/36 green, 559s). A paused request must also be answered on **its
own** session; replying on the page's session leaves it pending forever, which surfaces
as units stuck at 「翻译中…」 rather than as a clean failure.

**Scope, stated plainly:** only the translation transport is covered today. Notes, TTS
and transcription each own their own `fetch` and would hit the same wall against the
same endpoint. `AsrSource` (§2.4) adds two more: the file-tier media fetch, which on
Chrome is subject to the *page's* CORS (measured 2026-09-06: Transistor, Megaphone,
Blubrry, 小宇宙 and archive.org enclosures are readable from a foreign origin;
Substack's are not) and therefore rides `apiFetch` so the Firefox/strict-CORS
compensation applies; and a **WebSocket** for the live tier, which has no CORS at all —
all three vendors' sockets were opened from a page origin in real Chrome. Whether a
content-script WebSocket on Firefox is subject to the page's `connect-src` is measured
in PR3, not assumed.

## 6. Module map

| Module | File | Role |
|---|---|---|
| `TranslationCore` | `content/translation-core.js` | generic: `createEngine` (state machine + retry, `selectActive`, optional injected `detect` — §5.3), `createSubtitleEngine` (time-window specialization), helpers (`isTranslated`, `isAlreadyTargetLanguage`, `looksLikeCode`, language, pager, i18n) |
| `LangDetect` | `content/lang-detect.js` | **optional** browser-native language detection (§5.3): probes `chrome.i18n.detectLanguage` (Chrome/Edge/Firefox; absent on all Safari), caches results, and exposes a **synchronous** three-state `detect(text)` — result / `undefined` (in flight) / `null` (never available) — so the engine's `pump()` stays sync. Latches off permanently on any error. Never the sole source of a skip decision |
| `DomSegmenter` | `content/dom-processor.js` | general DOM extractor: `isVisible`, `shouldSkip`, `isInline`, `getText` (visibility-aware), `collectUnits`; honors two generic adapter markers — `computePlayerRegions` (`data-mt-player-region`) and `computeSkipRegions` (`data-mt-skip-region`) |
| `TwitterSite` | `content/site-twitter.js` | x.com/twitter.com **site adapter** (DOM/text dimension): feature-detects the tweet UI and marks non-content chrome (trends/who-to-follow sidebar, left nav, per-tweet engagement bar, and the tweet author/metadata line) with `data-mt-skip-region` so the generic segmenter excludes it; re-asserted via a `MutationObserver` against the virtualized feed. No selectors leak into `DomSegmenter`. |
| `SubtitleSource` | `content-youtube.js` + `yt-timedtext-observer.js` (+ optional `yt-hook.js`) | timed-text extractor: `yt-timedtext-observer.js` (isolated, `document_start`) records YouTube's own pot-bearing `/api/timedtext` URLs from the Resource Timing API before they're evicted; `content-youtube.js` re-fetches the full json3 transcript → cues → `mergeSentences`. `yt-hook.js` is an optional `world:MAIN` opportunistic body-capture (unavailable on Safari) |
| `WebpageTranslator` | `content/content-webpage.js` | all DOM (normal + YouTube page text): DomSegmenter → engine → child renderer (interleave holder stays a sibling) |
| `YouTubeTranslator` | `content/content-youtube.js` | video subtitles only: SubtitleSource → engine → overlay; `PlayerContext` device adapter |
| `PodcastTranslator` | `content/content-podcast.js` | audio subtitles (§2.2): resolve an existing timed transcript (in-page VTT/SRT, RSS `podcast:transcript`, or Spotify synced DOM) → cues → `mergeSentences` → same Engine → viewport-anchored overlay; synced to the `<audio>` element's `currentTime`. Supplies the §2.4 offer (`unavailableAction`) and starts an `AsrSource` session on the user's tap |
| `AsrSource` | `content/asr-source.js` | the §2.4 source: resolves the media URL, runs tier A (fetch bytes → transcription endpoint → cues) or tier B (CORS probe → crossorigin reload → `captureStream` / `createMediaElementSource` → PCM → `WsTranscribe`), the 3-second silence guard, and one `AbortController` per session. Pushes closed sentences into the harness; never touches the Engine directly |
| `WsTranscribe` | `content/ws-transcribe.js` | the live-tier transport: one WebSocket client with per-vendor message adapters keyed by the registry's `liveType` (`ws-openai` subprotocol key + `input_audio_buffer.append`; `ws-gemini` `?key=` + `realtimeInput.audio` with the 10-minute reconnect; `ws-meta`). Emits `{kind:'partial'|'final', text, startMs?, endMs?}`; connect timeout, idle heartbeat, never a silent close |
| `TwitterTranslator` | `content/content-twitter.js` + `content/tw-media-observer.js` | x.com/twitter.com in-tweet **video** subtitles (§2.3): `tw-media-observer.js` (isolated, `document_start`) records `video.twimg.com` HLS `.m3u8` URLs from the Resource Timing API into `window.__mtTwHlsUrls`; `content-twitter.js` fetches the master → SUBTITLES sub-playlist → `.vtt` segments → `parseTimedText` → `mergeSentences` → same Engine → overlay anchored to the active tweet's `<video>`. VTT-only, no ASR. (Shared overlay/tick/menu/SRT to be factored into `subtitle-adapter.js` — PR2a.) |
| `TranslationAPI` | `content/translation-api.js` | provider-agnostic transport (timeout/429/retry, concurrency queue); dispatches by request **format** (`chat-compat` / `messages-compat` / `google`) read from the build-time registry — see §7 |
| Provider registry | `build/providers.config.js` → `content/providers.gen.js` | single source of truth for the provider list, resolved per **region flavor** at build time (§7) |
| `LearnModel` | `content/learn-model.js` | learning layer (§9): pure — content-addressed id (FNV-1a, **not** `crypto.subtle`, which is absent on plain-`http` pages), text normalization, script-aware salience scoring, `Item` factory |
| `LearnScheduler` | `content/learn-scheduler.js` | learning layer (§9): pure Ebbinghaus scheduler — `retrievability` / `nextDue` / `applyReview` / `buildDeck`; `now()` injected, config merged over production `DEFAULTS` |
| `LearnCollector` | `content/learn-collector.js` | learning layer (§9): the **sink** — dwell observation, salience gate, bounded `lq:` outbox writes. Reads only what the Renderer already displays; never originates a translation |
| `LearnStore` | `learn/store.js` + `learn/drain.js` | learning layer (§9): the corpus. IndexedDB opened **only in extension pages** (a content script's `indexedDB` belongs to the host page's origin) + the outbox→corpus drain/merge |
| `Reviewer` | `learn/review.{html,css,js}` | learning layer (§9): the review surface — one implementation covering all five matrix rows, hosted in an extension page **and** in the host app's `WKWebView` (§9.4) |
| Host app | `safari-project/…/Shared (App)/` | learning layer (§9.4): the one-tap surface on iOS + macOS. **Not a second engine** — it loads the same review UI and scheduler, swapping only the host shims. Requires sign-in; the server is its only source (§9.3) |

## 7. Provider transport & region flavors (合规双分发)

The transport is **provider-agnostic and format-keyed**, and the provider *list*
is a build-time concern, not a runtime one.

- **Single source of truth.** `build/providers.config.js` is the one registry of
  translation providers. Each entry declares `{ id, type, flavors, needsKey,
  supportsBaseUrl, supportsModel, requiresEndpoint, defaultEndpoint, placeholder,
  defaultModel, label, labelKey, hintKey }`. It replaces the four previously-duplicated
  lists (the two HTML `<select>`s, the two settings scripts, and the transport's own
  provider table). The build generates `content/providers.gen.js`
  (`window.MT_FLAVOR` + `window.MT_PROVIDERS`), which every runtime surface reads —
  `translation-api.js` (dispatch), `options.js`/`popup.js` (UI), so they can never
  drift.

- **The endpoint is used EXACTLY as stored. We concatenate nothing, ever.**
  `defaultEndpoint` is a COMPLETE request URL, path included, and a user-supplied
  address is sent verbatim — the only processing permitted is trimming surrounding
  whitespace on save. `content/wire-format.js` is the one place that resolves an
  address, and all four transports (translation, notes, speech, transcription) go
  through it — and, since §2.4, the live-transcription socket: `build/stt.config.js`
  entries may carry `liveEndpoint` (a complete `wss://` URL, used exactly as stored),
  `liveType` (the socket's message shape), `liveModel`, and `uploadEndpoint` (Gemini's
  Files API for media above the inline limit). They are *stored addresses*, not
  derivations: `https://…/interactions` → `wss://…/BidiGenerateContent` has no regular
  mapping, and inventing one would be the `defaultBase + path` mistake again. A
  user-supplied `sttBaseUrl` overrides the file endpoint only; the live socket stays the
  registry's (v1). Its sibling `content/request-shape.js` answers the question that is left
  once the shape is fixed — **which optional fields go in the body** — and the same
  four transports go through that one instead of each carrying its own copy (two of
  them used to, character for character, comments included).

  This replaced a `defaultBase + path` model, and the reason is not tidiness. That
  model assumed a regularity that never existed: `qwen`'s own default already carried
  a `/compatible-mode` path segment and `google` had no path at all, so "base = origin"
  was already false inside our own registry. Worse, it made a real configuration
  unreachable — one host can serve **two different request shapes** from two paths
  (Chat Completions and Responses), and appending a registry-chosen path meant the user
  had no way to say which one they wanted. Third-party proxies compound this: their
  path conventions need not match the vendor's, so anything we append is a guess about
  someone else's routing.

  `placeholder` carries the example address for entries with no default. It lives in
  the registry rather than in UI copy for the same reason every other endpoint does:
  a path written into eleven translated strings is a second copy that drifts.

- **Transport is keyed by request FORMAT, and the format is declared in two places,
  in this order:**

  1. **The endpoint URL's path suffix** — `/chat/completions`, `/responses`,
     `/messages`, `/audio/speech`, `/audio/transcriptions`. A path is part of an API
     contract, not part of a vendor's identity.
  2. **The registry entry's `type`** — the default shape, used when the address says
     nothing we recognise.

  The URL wins because `type` is our *guess* about an id, while the URL is the user's
  *statement* about their endpoint. Vendors participate in neither: no adapter names
  one, and the suffix table contains only protocol paths. `anthropic-version` is sent
  for `messages-compat` as a required *protocol* header, not a brand reference.

  Matching is **family-closed**: the suffix only selects a variant *within the same
  capability* (chat / speech / transcription), so a speech endpoint that happens to end
  in `/messages` can never be turned into a chat transport. It is also **end-anchored
  on the path** with the query string stripped first — `…/messages/v1/chat/completions`
  is Chat Completions, and an Azure-shaped `…/chat/completions?api-version=…` is
  recognised rather than missed. Unrecognised suffix ⇒ fall back to `type`, which is
  what keeps every unknown third-party endpoint behaving exactly as it does today.

  **A third declaration, added 2026-08-20 for translation-specialised models: within a
  single address, a model family may carry its own shape.** `qwen-mt-*` is served from
  the very same `…/compatible-mode/v1/chat/completions` URL as every other Qwen model,
  so the address cannot distinguish it — yet it is not Chat Completions at all:

  | probe (real endpoint, 2026-08-20) | result |
  |---|---|
  | a `system` message | `400 Role must be in [user, assistant].` |
  | more than one message | `400 The length of the input.messages field has exceeded the limit. only one` |
  | one user message + `translation_options` | `200`, correct translation |
  | **one user message, no `translation_options`** | **`200`, the SOURCE TEXT echoed back** |

  That last row is why this is a **shape** and not a row in the capability table. The
  table's licence (see below, and the header of `build/model-params.config.js`) holds
  only while a missing row costs us a capability, never a correct request. Here a
  missing field costs neither loudly: the server answers 200 with the English original,
  `isTranslated()` accepts any non-empty string — deliberately, since a correct
  translation may equal its input — and the page renders English under English, with no
  error anywhere and a 12-hour cache entry to match. A required field whose omission is
  answered with a plausible 200 must be **structural**: `request-shape.js` builds
  `translate-compat` with `translation_options` always present, so there is no code path
  that can omit it.

  The discriminator is **host + model prefix, both verified**, and it is deliberately
  narrow because *both* directions fail silently: sending the translate shape to a model
  that does not want it means sending bare text with no instruction, which also returns
  a plausible-looking 200. So it is a short pinned list in `wire-format.js` next to the
  suffix table — the file that already answers "which shape" — and never a wildcard.
  Anything not on it stays exactly as it is today.

- **The request BODY is looked up in a table, and anything not in it gets the
  protocol minimum.** Picking the right address and the right shape still leaves a
  third variable: the optional fields inside the body. `chat-compat` faces the entire
  compatibility zoo — every proxy, gateway and self-hosted server speaks it, and they
  disagree about `temperature`, `max_tokens`, the `system` role, and whether a
  non-streaming request is accepted at all. Newer models reject several of these
  outright with HTTP 400.

  The diagnostic that isolates this: **same address, same key, works in another
  client.** That rules out the URL and the credential and leaves the body — and the
  clients it works in are the ones that send none of the fields in question.

  Two rules, and the second is a reversal of what this section said until #159:

  1. **The server's own sentence is carried, never replaced.** A 400 names the exact
     parameter it will not accept. `apiFetch` reads the error body as **text** (so a
     gateway answering HTML or plain text survives), unwraps a gateway's layered
     re-forwarding down to the innermost human sentence, and puts it on
     `err.serverMessage`. The settings page prints it verbatim under our own hint: our
     hint is a guess, that sentence is evidence, and paraphrasing evidence makes it
     un-searchable. This rule is unchanged and now carries the whole weight — it is
     what a user sees when we get the body wrong.
  2. **We send what `build/model-params.config.js` says the endpoint takes, and
     nothing else.** Matching is by **host + longest model-name prefix**, not by
     registry id: the vendors users most need covered (openrouter, grok, minimax) are
     not registry entries at all — they are reached through `custom_chat` — while a
     corporate gateway runs on its own domain and matches nothing, which is the point.
     A miss yields the minimum the protocol requires (`{model, messages}` for
     `chat-compat`) and a miss is the *default*, not an error.

  **This overturns the rule that stood here from 2026-08-18 to 2026-08-20**, which
  read: *"On a 400/422 we concede the named field and retry… The alternative — a table
  of model names and their accepted parameters — is the same mistake as a vendor list:
  it is a copy of someone else's decisions and it starts rotting the day it is
  written."* That argument is kept here rather than deleted, because it is still
  correct about the design it was aimed at, and because the reversal only holds while
  the difference below holds:

  - It aimed at a table used to **construct an optimistic body**. Such a table breaks
    requests the day it goes stale. This one's default is the opposite: not in the
    table ⇒ minimum ⇒ cannot be rejected for something we sent. Its failure mode when
    stale is *conservative*, not *wrong*.
  - So the licence is conditional, and the condition is written at the top of the
    config file: **the moment anyone adds a field whose absence breaks a request**
    (an auth-header type, an endpoint rewrite, a required parameter), the table
    becomes the 2026-08-18 frozen-migration table again — the kind where a missing row
    computes a wrong URL — and this argument no longer protects it.

  What forced the reversal was not taste. Negotiation read the field name out of the
  server's sentence, and a real gateway (2026-08-20) forwarded the upstream error
  wrapped three deep: the field name `temperature` sat at character 100 of a 296-char
  wrapper against a 300-char truncation limit. A slightly longer trace id and the
  retry would have **neither fired nor errored** — the request would go out, be
  rejected, and the page would silently fail to translate. Whether the product worked
  depended on what the other side's error message happened to look like. Unwrapping
  improved the odds of that bet; it did not stop it being a bet.

  Two costs, both accepted and both visible rather than silent:
  - An endpoint that is not in the table no longer receives `temperature: 0.3`, so its
    translation randomness is whatever that server defaults to. The advanced panel
    lets a user set it back.
  - A gateway that accepts **only** streaming requests is no longer rescued (that
    concession, and the `sseMerge` that made it work, are gone). It now fails with the
    server's own sentence shown. A table cannot express that case either: "send
    non-streaming first, retry as a stream" *is* negotiation.

  **The table is the default, not the ceiling (#162).** Private endpoints — corporate
  gateways, self-hosted services, small vendors — can never be measured by us: we have no
  key, no route, and no business asking a user to hand over an internal address. For them
  the minimum body is safe, but it also left the user with **no way to say** "mine does
  take `thinking`" — and that knowledge is something they have and we don't. So the panel
  carries a free-form JSON field, merged into the body **last**, scoped **per engine**.

  Merging last means **the user overrides the table**, which reverses the rule this
  section carried until #162 ("the table wins, and the panel says why"). The reversal is
  narrow and deliberate: that rule was written for the four numeric fields, where the
  table's authority comes from a measurement of *that host*. For a host we never touched,
  the user's knowledge is better than ours, and being wrong costs a 400 carrying the
  server's own sentence — visible and recoverable, which is the failure mode this whole
  design prefers.

  What the field may **not** override is structural: `model`, `messages`, `system`,
  `input`, `instructions`, `stream`, `translation_options`. Changing those is not tuning a
  request, it is substituting a different one, and two of them fail silently rather than
  loudly — `stream` returns a body the parser cannot read (`sseMerge` went with the
  negotiation), and `translation_options` is the *definition* of `translate-compat`, whose
  absence is answered with a plausible 200 containing the untranslated source.

  The licence above is untouched: with nothing typed in, a host the table does not know
  still receives exactly `{model, messages}`. The escape hatch is explicit, per-engine,
  and owned by the person who opened it.

  The user-facing counterpart is the advanced-parameters panel (temperature, output
  budget, timeout, concurrency): collapsed by default, **unset** by default — the keys
  are absent from storage rather than present-with-a-default, because "not set" and
  "set to the default" must stay distinguishable. When the table says the current
  model refuses a parameter, the table wins and the panel **says so in place**: a
  dropped parameter is invisible otherwise, since no server complains about a field it
  never received.

  Retry policy follows the same logic: the outer retry loop only retries failures that
  might resolve themselves (network, timeout, 408, 429, 5xx). It used to retry
  everything three times, so one wrong key cost three doomed requests **per paragraph**
  — 150 on a 50-paragraph page — delaying the user's error message and burning the
  endpoint's rate limit for nothing.

- **`google` is an explicit carve-out.** Its two endpoints are built with query
  parameters at call time and cannot be expressed as one stored address; the user can
  never supply one either (`supportsBaseUrl: false`). It therefore declares
  `defaultEndpoint: null` **explicitly** — an absent field is the failure mode
  `test/registry.test.js` exists to catch, not a permitted default. Same shape as the
  palette carve-out for page-injected CSS: the exception is written down and gated,
  never left as an unmentioned gap.

- **Live-transcription sockets are the second carve-out, same shape.** A browser
  WebSocket cannot send an `Authorization` header, so each vendor's socket carries the
  key the only way it can: OpenAI as a subprotocol (`openai-insecure-api-key.<key>`,
  their documented browser path), Gemini as `?key=` on the URL (their documented path),
  Meta in the handshake as measured. `content/ws-transcribe.js` is the one place this
  happens, the registry's `liveType` names which, and `test/wire-format.test.js` pins
  that a `?key=` is stripped before suffix matching and never logged. Written down and
  gated, never an unmentioned gap.

- **`resolveEndpoint` has exactly two branches, and neither of them concatenates.**
  Empty stored value ⇒ the registry's `defaultEndpoint`; anything else ⇒ that value,
  trimmed and otherwise untouched. There is no capability argument, no stamp, no table.

  1.5.2 shipped a weaker version of this rule: verbatim *when a per-field
  `{key}Verbatim` stamp was present*, and otherwise a "legacy" branch that reproduced
  the old `base + path` expression from a frozen table, so that a device whose one-time
  migration had not run would keep working. That design was withdrawn in 1.5.3 after it
  produced two field failures in one session, and the lesson generalises past this
  module:

  - **A conditional promise is not a promise.** The condition travelled as a positional
    `verbatim` argument through six call sites. The settings page's 「测试连接」 did not
    pass it, so the self-check silently fell back to concatenation and reported a 404
    against `…/v1` + `/v1/chat/completions` while the address the user had typed was
    correct. Concatenation was not the exception; it was whatever happened when someone
    forgot an argument.
  - **A safety net that writes is not a safety net.** The same frozen table drove the
    one-time migration, and the migration did not consult the stamp — so it would append
    a path to an address the user had *just saved as complete*, corrupting a correct
    configuration on the next settings-page load.

  The exception would always have landed exactly where the user most needed us not to
  improvise: on an address whose shape we do not recognise. So the cost is accepted
  instead: an install upgrading from ≤1.5.2 that stored an old-style base address and
  never reopens settings will request that base and fail. It fails **loudly** — the
  transport names the failure and the settings page echoes the URL actually requested —
  and the field's own hint says to enter the full path. Trading a mechanism that
  corrupts correct configurations for one that inconveniences stale ones is the right
  direction of trade.

- **Region flavor is a build/distribution concern, decided at build time — never a
  runtime per-request branch.** `node build.js --flavor global|china` filters the
  registry by each entry's `flavors` and resolves flavor-varying `defaultEndpoint` /
  `label` to a single value:
  - **global** (`dist/`, `com.belliedmonkeytranslator`): Google, OpenAI, Claude,
    DeepSeek, GLM, Qwen, Kimi + custom (Chat / Messages). International endpoints
    (`api.z.ai`, `dashscope-intl…`, `api.moonshot.ai`). **Not available in China.**
  - **china** (`dist-china/`, `com.belliedmonkeytranslator.cn`): DeepSeek, GLM
    (智谱), Qwen (通义千问), Kimi + two brand-free custom endpoints (Chat / Messages
    format, user-supplied base URL). Domestic endpoints (`open.bigmodel.cn`,
    `dashscope.aliyuncs.com`, `api.moonshot.cn`). **No Google/OpenAI/Claude, and no
    vendor brand strings anywhere in UI or metadata.**

- **Why two binaries (not runtime storefront gating).** An App Store app record
  serves one binary to every storefront, so China-mainland legal isolation
  (Guideline 5 — generative-AI services need MIIT permits; OpenAI/ChatGPT
  references are disallowed) requires **two app records / two bundle ids**, driven
  by the same codebase via flavor. `build-safari.sh [china]` produces the matching
  Xcode project + bundle id.

- **Compliance gate (build-enforced).** After a `--flavor china` build, `build.js`
  greps `dist-china/` for `/ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com/i`
  and **fails the build on any hit**. Brand-free labels + no default global
  endpoints + description substitution together keep this at zero.

- **China has no free/no-key default.** Google is absent (blocked in China), so the
  china build defaults to a keyed domestic provider (GLM has a free tier); the
  China onboarding must include a "get a free GLM key" step. Fallback differs too:
  global builds fall back to Google on total provider failure; **china builds must
  not** — they surface the error instead (no reachable Google).

- **Residual risk.** A user-supplied custom endpoint in the china build is a generic
  BYO-endpoint; a reviewer could read it as indirect access to a disallowed service.
  Mitigated by brand-free labels + no default endpoint + Review Notes; the fallback
  if rejected is to drop the custom endpoints from the china flavor and keep only
  pure domestic-brand providers.

## 8. Out of scope

No Readability-style full-article extraction fallback (the reference extension
uses one for unstructured pages); rule-based semantic segmentation is sufficient
for bilingual injection. Revisit only if unstructured pages prove inadequate.

**In-browser ASR and backend-side ASR stay out of scope.** Recognition running in the
browser itself is infeasible on Safari iOS, and the learning layer's optional backend
(§9) is explicitly not a licence to transcribe — it carries text and scheduling state,
never media, and never audio we would have to transcribe. *(Amended 2026-09-06:)* what
is **in** scope is §2.4 — transcription on the endpoint the **user** configured, started
by the user's tap, with the audio never touching a server of ours. Podcasts with
neither a timed transcript nor a text transcript page get the page path plus that
offer, nothing automatic.

**Amended 2026-08-02 — "no backend" narrows to "no backend in the translation
path".** The original formulation treated *any* server of ours as out of scope. The
learning layer (§9) adds an **optional, opt-in, free** account whose server does
exactly one thing: hold the user's learning corpus so it can follow them between
devices, under a fixed free quota (`docs/learning-design.md` §8). It is stored in
plaintext, which carries real obligations — §8.7 lists them, and they are not
optional. Sync is opt-in and a signed-out user has a complete product.

What does **not** change, and is now load-bearing rather than incidental:

- **Translation DEFAULTS to browser → provider, on the user's own key, and that path
  stays free and fully capable forever.** It is never degraded to make a paid path
  look better. A server-side model may be offered as an **opt-in paid alternative**
  (`docs/learning-design.md` §2.1), which means `README.md`'s "no servers of ours in
  the middle" must be stated **per path** rather than as a blanket claim. The
  invariant that survives is not our abstinence — it is that **someone who never pays
  and never signs in has a complete product.**
- **The server runs no model and performs no computation on user data.** It stores
  opaque bytes.
- **Anonymous usage events are the one thing the product sends unasked** *(amended
  2026-09-05)*: a whitelist of event names with a random per-install id, never page
  content, URLs, hostnames, keys or account ids, off in one switch, and none at all
  in the China flavor. The whitelist is a domain-design artifact — adding an event or
  a property goes through the governance rule, not a PR. Design and Gate D:
  `docs/telemetry-design.md`, `docs/learning-design.md` §10.
- **The extension is complete without an account.** Sync is additive; every learning
  feature works fully offline and signed-out, on every surface.

See `AGENTS.md` 「产品原则：普惠优先」 for the governing rule, and
`docs/learning-design.md` §2 and §8 for the model.

## 9. The learning domain (记忆层) — a sink attached to the pipeline

> Full model, scheduler math, salience gate, storage tiers, sync protocol and crypto
> live in **[`docs/learning-design.md`](learning-design.md)**, which is the single
> source of truth for that domain. This section fixes only the part that constrains
> the *translation* domain — i.e. the boundary.

The extension already holds, for every page and video, a large set of aligned
`(source, translation)` pairs. The learning layer retains them and re-surfaces them
on an Ebbinghaus forgetting curve. It attaches as a **bypass sink**, downstream of
the Renderer:

```
source → Extractor → Engine → Renderer
                                  │
                                  └──▶ Collector ──▶ Store ──▶ Scheduler ──▶ Reviewer
```

### 9.1 核心约束 — the four Collector laws (do not break)

1. **Capture is a sink, never a source.** The Collector reads only what the Renderer
   has already decided to display. It never back-pressures the engine: it does not
   influence `selectActive`, does not alter `pump()` cadence, does not mark units, and
   **never originates a translation request**. *If the learning layer were deleted at
   runtime, translation output must be byte-for-byte identical.*

2. **Silent in the browsing flow — never silent to a user who opted in.**
   *(Amended 2026-08-04. The original wording was "degradation is silent and total",
   which conflated two separate things and let the second one hide behind the first.)*
   - **Toward the page: absolutely silent.** Storage full, IndexedDB unavailable,
     outbox overflow — all reduce to *no capture*, with the translation path
     untouched. No retry loop, no notice injected into the page, no half-state (same
     shape as §5.3.3). Reading a page must never be interrupted by the learning
     layer's problems.
   - **Toward a user who turned capture ON: never silent.** Anything that stops
     capture, or discards material already collected, **must be visible in the
     learning surfaces** (review page, settings, popup) with an action that fixes it.
     A learner who finds out months later that collection quietly stopped is the
     worst outcome this feature has — worse than being told on day one. (This is the
     same rule `learning-design.md` §8.5 already applies to the server quota; law 2
     used to contradict it.)
   - **Dropping captures is still a normal path, not an error path** — it just is not
     an *invisible* one.

3. **Nothing reaches `DomSegmenter`.** The Collector adds **zero selectors**. Site
   knowledge enters only through the two markers the segmenter already honors,
   `data-mt-player-region` and `data-mt-skip-region` (§3). Needing a per-site or
   per-device branch to decide *what to capture* means the design has regressed into
   selector dependence — fix the salience model instead.

   *Carve-out (2026-08-09): user-authored consent rules are not site knowledge.*
   A source blocklist (来源屏蔽) or learning-language whitelist (学习语言白名单)
   that the **user** writes is user governance — the same kind of consent as the
   `learnEnabled` switch, scoped narrower. Such rules gate only *whether the sink
   runs at all* for a page or a sentence (`learning-design.md` §4.1, §9): they never
   reach the segmenter, never add a selector, and never influence what is translated
   or rendered (law 1 holds byte-for-byte). What stays forbidden is **shipped**
   per-site knowledge — a rule list we author and distribute. Per law 2, a page or
   sentence where user rules stop capture must remain visible with a fix action; the
   popup's 本站 section and the options 来源管理 are those surfaces.

4. **Self-capture is forbidden.** Injected learning UI carries `translate="no"` **and**
   `data-mt-skip-region`; the Collector skips `.mt-translation` and every `#mt-*`
   subtree. Without this the extension translates its own translations and captures
   the result — an unbounded loop that corrupts the corpus.

> *Scope note (2026-08-12):* the learning layer's 说 exercise records the **user's
> own voice** at their explicit tap and sends it only to the transcription endpoint
> they configured (`learning-design.md` §9.4). This does not touch §2's subtitle
> rule: the translation pipeline consumes transcripts that already exist, or — since
> 2026-09-06, §2.4 — one the user explicitly asked their own endpoint to generate.
> Either way the Collector sees only what the Renderer displayed.

### 9.2 Where it attaches (the only three touch points)

| Surface | Attachment | Why there |
|---|---|---|
| Webpage | `content-webpage.js` `renderUnit`, inside the `st.translation && !sameAsOriginal` branch | This is **after** the same-language backstop, so only genuine translations reach it; node, source text and translation are all in hand |
| Subtitles | `subtitle-adapter.js`, after `renderOverlay` | The sentence carries `{start, end, text, tr}`; capture requires the playhead to have actually crossed `[start, end]` — seeking past is not watching |
| Session boundary | `spec.onMediaKeyChange` / `WebpageTranslator.disable()` | Flush point; also where the dwell observers are disconnected |

`dom-processor.js` is **not modified**. It knows neither URL nor title by design
(§3); the Collector reads `location.href` / `document.title` itself.

### 9.3 Storage — the boundary is an origin boundary, not a preference

> **A content script's `indexedDB` belongs to the HOST PAGE's origin.** The corpus
> cannot live there: it would scatter across every visited site and be readable by the
> page. And the service worker cannot be in the path either — it goes permanently
> `undefined` on Safari iOS after device lock (§5.3.1).

Hence three tiers: content script → bounded `lq:` outbox in `chrome.storage.local` →
IndexedDB opened only in extension pages. Same reason `crypto.subtle` is unusable in
content scripts (plain-`http` pages are not secure contexts), so the item id uses a
synchronous FNV-1a hash rather than `crypto.subtle`.

**The host app is a FOURTH origin, and the only bridge to it is the server**
*(2026-08-07)*. The app's `WKWebView` can no more read the extension's IndexedDB than
a content script can — it is a different origin again, and origin is the whole reason
this boundary exists. So there are two corpora, and exactly one thing connects them:

| Surface | Corpus lives in | Review surface | Signed out |
|---|---|---|---|
| Chrome / Firefox / Safari extension | extension-page IndexedDB | the extension's review page | **complete** |
| iOS / macOS app | the app's own store | the app | **empty** — and the app must say so |

Consequences, both counter-intuitive enough to be worth stating:

- **On one iPhone, Safari's corpus and the app's corpus still meet by going through
  the server.** Same device, same user, two origins.
- **The extension owns the upload.** It pushes its own captures and holds its own
  progress cursor; the app is downstream. The rejected alternative — draining the
  outbox to native and letting the app upload — is recorded in `learning-design.md`
  §12: it puts upload in the hands of a process the user may never launch, and the
  extension could not even observe whether its data had arrived.

### 9.4 Device axis

There are **two** review implementations, and the split is an *entry-depth* problem,
not a capability one: on iOS, reaching an extension page costs three taps (address bar
→ extension → review) because that is where iOS puts extension UI **by construction**.
An app icon is one tap. Both surfaces run the same engine (`learn-model.js`,
`learn-scheduler.js`); §5.1's principle still holds inside each — viewport size is read
at runtime, never branched.

| Implementation | Covers | Requires sign-in |
|---|---|---|
| Extension review page | all five matrix rows | no |
| Host app (iOS + macOS) | the two Apple rows | **yes** — the server is the only bridge (§9.3) |

> **核心约束 — the host app is an ADDITIONAL surface, never the only working path.**
> Safari iOS must be complete without it, per §5.3.1.
>
> **This constraint survived a design that was aimed directly at it** *(2026-08-07)*.
> The proposal was to retire the extension's review page everywhere and make the app
> the sole learning surface. It was rejected: it would leave a signed-out user without
> a review surface at all, against `AGENTS.md` rules 2 and 3. **Keeping the extension's
> review page is what makes signing in buy multi-device sync and a better surface,
> rather than buying the feature itself.**
