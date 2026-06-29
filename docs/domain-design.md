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
- **Video subtitles are NOT DOM** — they are a timed JSON transcript fetched
  whole from the network (`/api/timedtext`, json3). There is no DOM to segment, so
  they use a different **kind** of extractor (`SubtitleSource`), but feed the **same
  Engine**. This is a *source-kind* difference, not a site difference.

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

**Don't translate the media-player region.** The video player's chrome (live
captions, controls) and our own subtitle overlay belong to the **subtitle/player
path**, not the webpage extractor — so `DomSegmenter` skips any subtree inside a
video player (`<video>`'s player container) and our `#mt-yt-overlay`. Otherwise
the webpage path collects the live caption text and injects a "translating…"
placeholder under it (the duplicated-caption bug).

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

## 5. Device dimension (mobile vs desktop vs embed)

**Principle: parsing / segmentation / engine are device-agnostic; device
differences live only in a thin control/render adapter.**

- `DomSegmenter` / `SubtitleSource` / `Engine` are **single implementations, not
  per-device**. Standard HTML semantics apply identically to mobile and desktop
  DOM. *Needing a per-device branch in the segmenter means it has regressed into
  selector dependence (anti-pattern).* Device-specific behavior (touch
  tap-to-translate, FAB, viewport size) belongs to the **interaction layer**;
  viewport size is read at runtime (`innerHeight`), not branched in code.
- **YouTube video module** is unified; the desktop/mobile/embed differences are
  isolated in a `PlayerContext` adapter (the only variation point):
  - desktop: player `.html5-video-player`, control-bar button in `.ytp-right-controls`, menu absolute-in-player
  - mobile `m.youtube.com`: no control bar → FAB drives on/off; overlay anchored to player
  - embed (iframe): floating 译 button; menu fixed
  The subtitle core (SubtitleSource + Engine + OverlayRenderer) is shared across all three.

## 6. Module map

| Module | File | Role |
|---|---|---|
| `TranslationCore` | `content/translation-core.js` | generic: `createEngine` (state machine + retry, `selectActive`), `createSubtitleEngine` (time-window specialization), helpers (`isTranslated`, `looksLikeCode`, language, pager, i18n) |
| `DomSegmenter` | `content/dom-processor.js` | general DOM extractor: `isVisible`, `shouldSkip`, `isInline`, `getText` (visibility-aware), `collectUnits` |
| `SubtitleSource` | `content-youtube.js` + `yt-timedtext-observer.js` (+ optional `yt-hook.js`) | timed-text extractor: `yt-timedtext-observer.js` (isolated, `document_start`) records YouTube's own pot-bearing `/api/timedtext` URLs from the Resource Timing API before they're evicted; `content-youtube.js` re-fetches the full json3 transcript → cues → `mergeSentences`. `yt-hook.js` is an optional `world:MAIN` opportunistic body-capture (unavailable on Safari) |
| `WebpageTranslator` | `content/content-webpage.js` | all DOM (normal + YouTube page text): DomSegmenter → engine → sibling renderer |
| `YouTubeTranslator` | `content/content-youtube.js` | video subtitles only: SubtitleSource → engine → overlay; `PlayerContext` device adapter |
| `TranslationAPI` | `content/translation-api.js` | provider-agnostic transport (timeout/429/retry, concurrency queue) |

## 7. Out of scope

No Readability-style full-article extraction fallback (the reference extension
uses one for unstructured pages); rule-based semantic segmentation is sufficient
for bilingual injection. Revisit only if unstructured pages prove inadequate.
