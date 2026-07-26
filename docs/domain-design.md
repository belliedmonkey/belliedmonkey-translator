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
                │  Engine = createEngine({ translate, selectActive })                 │
                │     setUnits · pump · stateOf · retry · reset                       │
                │     state machine: pending → translating → (done | nothing | error→retry) │
                │     pump(): only translate units selectActive() picks; backoff retry │
                │  helpers: isTranslated · looksLikeCode · language helpers ·          │
                │           createPager · MSG · t (i18n) · DEFAULT_TARGET_LANG         │
                └──────────▲────────────────────────────────────────────▲─────────────┘
        DOM source (units{node})                                  timed text (units{start,end})
   ┌──────────────────────┴───────────────────────────┐   ┌──────────┴─────────────────────┐
   │ DomSegmenter — normal webpages + YouTube          │   │ SubtitleSource — video subtitles │
   │   title / description / comments                  │   │   yt-hook → parseJson3 → cues    │
   │   standard-HTML segmentation                      │   │   → mergeSentences               │
   │   scheduling = viewport-priority + lazy           │   │   scheduling = time-window       │
   │   renderer = sibling injection (+ rich text)      │   │   renderer = subtitle overlay    │
   └────────────────────────────────────────────────────┘   └────────────────────────────────┘
```

## 2. The split is "is the source DOM?", not "which site"

- **Anything that IS DOM** (normal pages **and** YouTube's title/description/
  comments) → the single general **`DomSegmenter`**. No per-site selectors; in
  particular **no `YT_TARGETS`**.
- **Video/audio subtitles are NOT DOM** — they are a timed transcript fetched
  whole (YouTube `/api/timedtext` json3; podcast WebVTT/SRT). There is no DOM to
  segment, so they use a different **kind** of extractor (`SubtitleSource` /
  `PodcastSource`), but feed the **same Engine**. This is a *source-kind* difference,
  not a site difference.
- **Podcast bilingual subtitles** are the audio analogue of video subtitles — see
  **§2.2**. Where a podcast has no timed transcript, it is just a **page** (show
  notes / a text transcript) and falls to the normal `DomSegmenter` text path.

### 2.1 YouTube subtitle core constraint (核心约束 — do not break)

The YouTube subtitle path follows **one** logic, identical on every platform
(Safari iOS, Chrome) and identical to the Chrome-extension logic:

1. **Fetch the COMPLETE transcript up front, in one shot.** Acquire every cue for
   the current video as a single transcript before/at playback start — never
   caption-by-caption off the live player DOM.
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

1. **Use an EXISTING timestamped transcript — never generate one.** Acquire the
   COMPLETE timed transcript up front from a source that already carries timestamps:
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
5. **No ASR / no self-generated transcripts** (no-backend; infeasible on Safari iOS).
   If no timed transcript exists, show `字幕不可用` and let the existing webpage text
   path translate the show-notes / transcript **page** as the floor.

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
   never a word-by-word or ASR fallback (no-backend; infeasible on Safari iOS).
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
selectors: sibling injection (resists Polymer re-render, also fine on normal
pages), clickable URLs (general), interleaved description. Only "timestamp click →
`video.currentTime`" is a small optional renderer hook.

**Renderer contract: the injected sibling MIRRORS its original, and the mirror is
not a one-shot.** Two consequences, both general (no site knowledge):

- **Placement follows VISUAL order, not DOM order.** "Original above, translation
  below" is the invariant; `afterend` is merely the usual way to achieve it. In a
  container whose visual order is reversed (`flex-direction:column-reverse`, or a
  row with `flex-wrap:wrap-reverse`, where the lines stack upward) the renderer
  anchors the translation *before* the original instead. The decision is computed
  from the parent's computed style at render time and cached on the node, so the
  per-tick re-anchor pass never forces a style recalc.
- **The mirror is re-measured when the viewport changes.** The copied geometry is
  viewport-time pixels (width cap, inline-start indent, the flex-row wrap fix), so
  rotation / resize / a media-query breakpoint invalidates it. The renderer drops
  the frozen state (debounced) and re-arms the render key; the next tick re-runs
  the **same** first-render path — there is deliberately no second layout code
  path. A hidden interleave original is briefly restored inside the same task
  (never painted) so it can be measured rather than served from a stale cache.

## 5. The control/render adapter — the only variation point (device × site)

**Principle: parsing / segmentation / engine are single implementations. ALL
variation lives in one thin control/render adapter, and that adapter varies along
exactly TWO axes — DEVICE and SITE.**

Naming the second axis is deliberate. The adapter always carried it (YouTube's
overlay anchors into `#movie_player`, the podcast overlay anchors to the viewport
because an audio page has no player), but the doc only described the device axis, so
the first *button*-level site difference (Twitter, below) read as an unexplained
exception. It isn't one — it is the site axis doing its job. What must stay closed is
the boundary: two axes, in one layer, and nowhere else.

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

## 6. Module map

| Module | File | Role |
|---|---|---|
| `TranslationCore` | `content/translation-core.js` | generic: `createEngine` (state machine + retry, `selectActive`), `createSubtitleEngine` (time-window specialization), helpers (`isTranslated`, `looksLikeCode`, language, pager, i18n) |
| `DomSegmenter` | `content/dom-processor.js` | general DOM extractor: `isVisible`, `shouldSkip`, `isInline`, `getText` (visibility-aware), `collectUnits`; honors two generic adapter markers — `computePlayerRegions` (`data-mt-player-region`) and `computeSkipRegions` (`data-mt-skip-region`) |
| `TwitterSite` | `content/site-twitter.js` | x.com/twitter.com **site adapter** (DOM/text dimension): feature-detects the tweet UI and marks non-content chrome (trends/who-to-follow sidebar, left nav, per-tweet engagement bar, and the tweet author/metadata line) with `data-mt-skip-region` so the generic segmenter excludes it; re-asserted via a `MutationObserver` against the virtualized feed. No selectors leak into `DomSegmenter`. |
| `SubtitleSource` | `content-youtube.js` + `yt-timedtext-observer.js` (+ optional `yt-hook.js`) | timed-text extractor: `yt-timedtext-observer.js` (isolated, `document_start`) records YouTube's own pot-bearing `/api/timedtext` URLs from the Resource Timing API before they're evicted; `content-youtube.js` re-fetches the full json3 transcript → cues → `mergeSentences`. `yt-hook.js` is an optional `world:MAIN` opportunistic body-capture (unavailable on Safari) |
| `WebpageTranslator` | `content/content-webpage.js` | all DOM (normal + YouTube page text): DomSegmenter → engine → sibling renderer |
| `YouTubeTranslator` | `content/content-youtube.js` | video subtitles only: SubtitleSource → engine → overlay; `PlayerContext` device adapter |
| `PodcastTranslator` | `content/content-podcast.js` | audio subtitles (§2.2): resolve an existing timed transcript (in-page VTT/SRT, RSS `podcast:transcript`, or Spotify synced DOM) → cues → `mergeSentences` → same Engine → viewport-anchored overlay; synced to the `<audio>` element's `currentTime` |
| `TwitterTranslator` | `content/content-twitter.js` + `content/tw-media-observer.js` | x.com/twitter.com in-tweet **video** subtitles (§2.3): `tw-media-observer.js` (isolated, `document_start`) records `video.twimg.com` HLS `.m3u8` URLs from the Resource Timing API into `window.__mtTwHlsUrls`; `content-twitter.js` fetches the master → SUBTITLES sub-playlist → `.vtt` segments → `parseTimedText` → `mergeSentences` → same Engine → overlay anchored to the active tweet's `<video>`. VTT-only, no ASR. (Shared overlay/tick/menu/SRT to be factored into `subtitle-adapter.js` — PR2a.) |
| `TranslationAPI` | `content/translation-api.js` | provider-agnostic transport (timeout/429/retry, concurrency queue); dispatches by request **format** (`chat-compat` / `messages-compat` / `google`) read from the build-time registry — see §7 |
| Provider registry | `build/providers.config.js` → `content/providers.gen.js` | single source of truth for the provider list, resolved per **region flavor** at build time (§7) |

## 7. Provider transport & region flavors (合规双分发)

The transport is **provider-agnostic and format-keyed**, and the provider *list*
is a build-time concern, not a runtime one.

- **Single source of truth.** `build/providers.config.js` is the one registry of
  translation providers. Each entry declares `{ id, type, flavors, needsKey,
  supportsBaseUrl, supportsModel, requiresBaseUrl, defaultBase, path, defaultModel,
  label, labelKey, hintKey }`. It replaces the four previously-duplicated lists
  (the two HTML `<select>`s, the two settings scripts, and the transport's own
  provider table). The build generates `content/providers.gen.js`
  (`window.MT_FLAVOR` + `window.MT_PROVIDERS`), which every runtime surface reads —
  `translation-api.js` (dispatch), `options.js`/`popup.js` (UI), so they can never
  drift.

- **Transport is keyed by request FORMAT, not vendor.** `type` is one of
  `google`, `chat-compat` (OpenAI Chat-Completions request shape), or
  `messages-compat` (Anthropic Messages request shape). No adapter names a vendor;
  a self-hosted or third-party endpoint is reached by picking the matching format +
  a custom `baseUrl`/`model`. `anthropic-version` is sent for `messages-compat` as a
  required *protocol* header, not a brand reference.

- **Region flavor is a build/distribution concern, decided at build time — never a
  runtime per-request branch.** `node build.js --flavor global|china` filters the
  registry by each entry's `flavors` and resolves flavor-varying `defaultBase` /
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

**ASR / self-generated podcast transcripts are out of scope** (§2.2): no-backend
principle + in-browser ASR is infeasible on Safari iOS. Podcasts with neither a
timed transcript nor a text transcript page get no translation.
