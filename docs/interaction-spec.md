# Interaction Spec (交互效果规范)

Single source of truth for all **user-facing interaction / layout constraints**.
Anything about how translations look or behave on screen is maintained HERE — not
scattered across code comments or AGENTS.md. When changing interaction behavior,
update this file in the same commit.

Verify every item here with a **screenshot** of the built, loaded extension — a DOM
element existing is not proof the user sees it (see AGENTS.md).

---

## YouTube bilingual subtitles

### Controls & activation
- **Default OFF on every page load.** Nothing is translated until the user turns it
  on. No persisted auto-start — a refresh always starts off.
- **Desktop — two independent controls.** On a **desktop (non-touch)** `youtube.com`,
  the in-player **译 button** controls VIDEO SUBTITLES (menu: 开启/关闭, plus
  双语/仅译文/仅原文, .srt, settings); the page **FAB** controls WEBPAGE TEXT (title /
  description / comments). They never affect each other.
- **Mobile — ONE button drives everything.** On **any touch device** — both
  `m.youtube.com` *and* a phone / iPad on the desktop-layout `www.youtube.com` — there is
  **no separate 译 button**; the page **FAB** drives BOTH the video subtitles and the page
  text. This prevents two near-identical green circles colliding on a small screen.
  "Mobile" is a single shared signal, `TranslationCore.isMobileLayout()`
  (`navigator.maxTouchPoints > 0` or a mobile UA), used by both the router
  (`content-main`) and the button gate (`content-youtube`) so they can never disagree.
- **The 译 button widget (desktop + embed only).** Where it IS shown it is an
  **always-visible green circular floating button**, identical on desktop `youtube.com`
  and third-party **embeds** — NOT mounted inside YouTube's auto-hiding control bar. On
  desktop `youtube.com` it sits **above the page FAB** (`bottom:150px`); in an embed (no
  page FAB) it sits at the corner (`bottom:10px`). The menu anchors just above it.

### Source & timing
- **Fetch the whole transcript up front, then translate-ahead.** Acquire the
  COMPLETE `/api/timedtext` (json3) transcript for the video in one shot — the
  isolated content script enables captions, reads YouTube's own pot-bearing
  `/api/timedtext` URL from the Resource Timing API, and re-fetches the full
  transcript itself, so it works on Safari iOS where `world:MAIN` is unavailable
  (a direct caption `baseUrl` fetch is pot-blocked). Translate ahead in a
  **60-second sliding window** and display by
  matching `video.currentTime`. There must be **no per-caption translation lag** —
  a slow LLM (e.g. DeepSeek) must not delay display, because the work is done in
  advance. **Never** translate the live caption text word-by-word. (Core constraint
  — see [`domain-design.md`](domain-design.md) §2.1.)
- **Whole sentences, together.** Show the **original as a complete sentence** (merged
  from cues), not YouTube's word-by-word rollup. Original line + translation line
  appear **at the same time**, both driven by the current sentence.
- **Sentence merge.** Cues are merged into sentences (break on sentence-ending
  punctuation or a long pause) so the engine translates with context → fluent output,
  not choppy fragments.

### Layout (hard constraints)
- **Self-rendered overlay.** We draw our OWN caption overlay and **hide YouTube's
  native caption rendering** (`.ytp-caption-window-container { opacity:0 }`). Do NOT
  render into YouTube's `.caption-window` (it rolls word-by-word and YouTube moves it).
- **Fixed position.** The overlay is anchored to the player at a **constant** position
  (`bottom: 11%`). It MUST NOT move when the cursor moves or the controls show/hide.
- **Centered.** Horizontally centered (`left:50%; translateX(-50%)`), `text-align:center`.
- **Max 1 line per language.** Each language line is capped at **a single line**.
  Longer text is split into 1-line **pages** shown in sequence over the sentence's
  time span. Line capping is **measured** at the current width (responsive — works on
  desktop and narrow mobile alike), never a fixed character count.
- **Width cap.** `max-width: ~82%` of the player so it never covers too much of the frame.
- Translation line color follows the `ytTextColor` setting (default white).

### Loading state
- When the active sentence's translation is **not ready yet**, show a hint
  (**`⏳ 译文准备中…`**) in the translation line, dimmed/italic. When the translation
  arrives, the next tick **auto-swaps** it in. Never show a blank or stuck line.

### In-player control button + menu
- A **`译` button** is an always-visible **green circular floating button** (same widget
  on youtube.com desktop/touch and on embeds — see Controls & activation above), not an
  in-control-bar button.
- Clicking opens a menu with:
  - **字幕显示类型**: 双语字幕 / 仅译文 / 仅原文 (current mode checked)
  - **下载字幕 (.srt)** — exports the transcript + translation as `.srt`
    (bilingual / translation-only / original depending on the current mode)
  - **设置** — opens the extension options page
- 仅译文 hides the original line; 仅原文 hides the translation line.

### Requirements / fallback
- **A caption track must exist** for the video (auto or manual). We auto-enable
  the player's captions so YouTube fetches `/api/timedtext` (minting a valid pot),
  capture that URL, and re-fetch the full transcript ourselves — we do **not** rely
  on a `world:MAIN` hook, and we do **not** translate the rendered live caption DOM.
- If no transcript can be obtained (no caption track, or the fetch is blocked),
  show a **one-line notice** in the overlay (`字幕不可用`). Do **not** silently
  regress to per-caption / word-by-word translation of the live caption DOM.

### Known tradeoff
- A 1-line cap is tight, so pages can break mid-phrase (a page may end on a stray
  word or start with punctuation). This is the accepted cost of "max 1 line". If it
  reads too choppy, the line cap can be raised to 2 (more coverage, more natural breaks).

---

## Podcast bilingual subtitles

The audio analogue of YouTube subtitles (see [`domain-design.md`](domain-design.md)
§2.2). Same engine, same 60s translate-ahead, same display modes and loading/fallback
states. Differences from YouTube are noted below.

### Source & timing
- **Use an existing timed transcript, fetched whole up front.** In-page WebVTT/SRT
  (e.g. Substack's signed `…/en.vtt?Expires=…&Signature=…&Key-Pair-Id=…`, or a
  `<track src>`), or a Podcasting 2.0 `<podcast:transcript>` from the feed, or
  Spotify's synced "Read along" transcript (scraped from the episode page — see below).
  Parse → merge into sentences → translate ahead in the 60-second window.
  **No word-by-word; no ASR.**
- **Synced to the `<audio>` element's `currentTime`.** Original + translation appear
  together as whole sentences.

### Layout (differs from YouTube)
- **Self-rendered overlay anchored to the VIEWPORT** (audio pages have no video
  frame): `position:fixed`, bottom-center (≈`bottom: 8%`), horizontally centered,
  `pointer-events:none`, capped width. It must not overlap the site's own player
  controls more than necessary.
- **Max 1 line per language**, measured paging — same as YouTube.
- Translation line color follows the `ytTextColor` setting (shared subtitle color).

### Controls & activation
- **Off by default.** The **FAB** turns podcast subtitles on/off (there is no
  in-player button on an audio page) — the same FAB that turns on page-text
  translation, mirroring mobile YouTube.
- A small **floating 译 control** (shown only while subtitles are active) opens the
  same menu as YouTube: **双语字幕 / 仅译文 / 仅原文**, **下载字幕 (.srt)**, **设置**.

### Loading / fallback
- While fetching/parsing the transcript, show **`⏳ 字幕加载中…`** (dimmed) — auto-swaps
  to the bilingual pair when ready; never a stuck line.
- **Notice states require playback.** A paused / never-started video must show NO
  `⏳ 字幕加载中…` and no `字幕不可用` — a never-played video would otherwise pin a
  loading box on the page indefinitely (the 译 control button itself stays). The
  bilingual PAIR is different: it follows the active cue at `currentTime` regardless
  of play/pause — pausing mid-sentence keeps the pair on screen (reading is a
  feature), and enabling translation while paused inside a sentence shows that
  sentence's pair. At a never-played 0:00 no cue is active, so nothing renders.
- If no timed transcript exists on a host that MIGHT have one (generic audio pages),
  show **`字幕不可用`** and do **not** synthesize one. The page's show-notes / text
  transcript still translates via the webpage text path (the floor) when the FAB is on.
- **Known text-only hosts → no subtitle overlay at all** (not even `字幕不可用`): the FAB
  simply translates the page text. This is **`podcasts.apple.com`** and **`小宇宙`** — the
  web pages expose **no timed transcript at all** (transcripts are App-only), so it's a
  permanent text-only floor, independent of login. Routing gate: `isTextOnlyPodcast` in
  `content-main.js`.
- **Video posts are peers of audio — gated on a discoverable transcript.** An `<audio>`
  element always engages the subtitle path. A **video-only** page (e.g. a Substack video
  post with no audio companion) engages **only when a timed-transcript source is
  discoverable** (a caption `<track>` or an embedded signed `.vtt`/`.srt` URL in the
  page). Pages with decorative / hero / autoplaying background videos therefore never
  grow a 译 button or a `字幕不可用` notice — same philosophy as the text-only floor.
  When a page embeds several transcript URLs (the post's own + sidebar recommendations),
  the one sharing a path segment (upload id) with the playing media's `src` wins.
  Routing gate: `drivesPodcast()` + `PodcastTranslator.hasTranscriptHint()`.
- **One subtitle display at a time — native `<track>` captions are suppressed while
  ours drive.** WebKit (Safari / iOS / iPadOS) auto-enables a media element's subtitle
  `<track>` per the system caption preference, and players (e.g. Substack's) sync their
  own caption UI to the track mode — the user would see the native caption line AND our
  bilingual overlay. While our overlay has a transcript to show, every text track on the
  media element is forced to `disabled` (re-asserted each tick, like the Spotify
  native-transcript hide); the original modes are restored the moment translation is
  turned off. Our cue acquisition never reads `track.cues` (it fetches the track/page
  URL), so suppression costs nothing.
- **…and so are player-DRAWN caption layers that duplicate our overlay.** Some players
  render captions as their own DOM (Substack's caption box), driven by their private UI
  state — the `<track>` suppression can't reach it. While our overlay has a transcript:
  an element inside an adapter-marked player region whose box overlaps the video and
  whose text matches the currently-active cue is a caption display → hidden
  (`data-mt-native-hidden`, restored the moment translation is off; re-asserted each
  tick). A transcript **sidebar** that doesn't overlap the video stays visible.
- **Adapter-marked player regions (Substack).** The Substack player nests
  `playerShell > stage > {video-player > VIDEO, caption box, transcript scroller}` —
  the segmenter's generic `closest('[class*="player"]')` finds only the inner wrapper,
  so the per-word caption rows / transcript panel would be collected as page text and
  polluted with translations. Per domain review, the **podcast adapter** (site
  knowledge lives in adapters) feature-detects the shell (`[class*="playerShell"]`
  containing a media element — works on custom-domain Substacks) and marks it
  `data-mt-player-region`, re-asserted each tick, unconditionally (the pollution
  happens whenever the webpage path runs, even with subtitles off). `DomSegmenter`
  honors the marker generically (domain-design §3).
- **Spotify (`open.spotify.com`) — synced "Read along" subtitles.** On an **episode**
  page (only), when the episode has Spotify's auto-generated transcript, we scrape it
  into timed cues and show the bilingual overlay like any other podcast. Details:
  - The transcript only mounts when the episode's **转录 / Transcript** tab is active, so
    we activate that tab once, then read the cue list. Each cue is a header row (a seek
    `<button>` whose text starts with a `m:ss` timestamp, optionally `Speaker N`) followed
    by its spoken-text rows. Cue classes are hashed → we anchor structurally on the
    button + timestamp pattern, not on class names (fragile; re-verify periodically).
  - **Position comes from the player's progress-bar slider** (`aria-valuenow`, in ms),
    NOT the media element — Spotify streams via MSE so the `<video>`'s `currentTime` is a
    buffer position, not the episode position. (`resolveSpotifyDom` / `positionMs` in
    `content-podcast.js`.)
  - Music / playlist pages, and episodes with no transcript, stay text-only (episodes
    with no transcript show `字幕不可用` after the resolve retries).
  - **While translation is on, Spotify's own transcript panel is hidden.** Otherwise the
    native cue list and our bilingual overlay would show every English line twice. Once
    the cues are scraped we hide *only* the transcript cue-list div — the 简介 / 转录 / 章节
    tab bar stays usable — and restore it the moment translation is turned off. (The
    creator's burned-in captions on a video podcast are part of the video, not Spotify
    UI, so they are left untouched.)

---

## x.com / twitter.com

Two independent things happen on x.com: **in-tweet video subtitles** (the video
analogue of YouTube/Podcast — see [`domain-design.md`](domain-design.md) §2.3) and a
**de-cluttered page-text pass** (§3's `data-mt-skip-region` marker). Same engine, same
60s translate-ahead, same display modes as YouTube. Only the differences are listed.

### Video subtitles — source & timing
- **VTT-only. Never ASR, never per-caption.** Captions exist only when the uploader or X
  provided a WebVTT track in the HLS master playlist. **No track → `字幕不可用`**, and
  that is a **first-class, common outcome** — not a degraded mode, and never a
  word-by-word fallback.
- **Whole transcript up front**, then translate-ahead in the 60-second window. A visible
  consequence the user can check: with subtitles on and the video **paused at the
  start**, the first sentence's original line is **already on screen** — the transcript
  was fetched whole, not scraped per caption. Once loaded, `字幕准备中…` must not recur
  during steady playback.
- **X's own captions are suppressed** while ours drive. The user must never see X's grey
  native caption box and our bilingual overlay at the same time.

### Video subtitles — layout & fullscreen
- **Overlay is anchored INSIDE the active video's player container** (not
  `position:fixed` on the page), bottom-centred over the video, original line above and
  translation below.
- **Fullscreen is first-class and must-verify.** Entering the player's own fullscreen
  keeps **both the overlay and the `译` button visible inside the fullscreened player**,
  and the pair keeps advancing with playback; exiting restores the inline overlay. This
  is a permanent matrix item (`verification-spec.md` §0) on **Chrome, Safari and
  Firefox** — it was a shipped regression once (a body-level `fixed` element is not
  promoted into the browser's top layer, so the subtitle vanished).
- **iOS (iPhone / iPad) fullscreen is N/A**, never "passing": iOS hands video fullscreen
  to the OS's native player, which a DOM overlay cannot cover. On iOS, subtitles are an
  **inline-playback** feature.

### Video subtitles — controls
- **Desktop: the `译` button is embedded in the video itself** (top-right, inside the
  player container), not floating at the page corner. Two reasons the user feels: it
  survives fullscreen, and in a feed of many videos it is unambiguous **which** video it
  controls. (This differs from YouTube's floating button — see domain-design §5.2.)
- **Mobile (any touch device): no separate `译` button.** The page **FAB drives both**
  the video subtitles and the page text — one green circle, never two.
- The button's menu is the shared one: **开启/关闭视频字幕翻译**, **双语字幕 / 仅译文 /
  仅原文**, **下载字幕 (.srt)**, **设置**.
- **A feed holds many videos.** The subtitles follow the *active* one (playing, or
  clearly the most visible) and switch only with **hysteresis** — two comparably sized
  videos must not make the overlay flip back and forth while scrolling.

### Page text — what is NOT translated
- Tweet text translates through the **normal webpage path**, unchanged. What the adapter
  removes is only **non-content chrome**, which must show **no** translation line: the
  left nav, the right rail (**相关用户** / **有什么新鲜事** trends), the per-tweet
  engagement bar (reply / repost / like / bookmark counts), the tweet author line, the
  status page's `time · date · views` metadata row, the reply composer placeholder,
  inline promos and the footer link farm.
- **The three no-op residues are gone.** `帖子`, `广告` and `来自 <domain>` used to get a
  duplicate of themselves; they were documented as left by design because they are bare
  spans with no stable anchor to skip by *region*. They are all same-language duplicates,
  so the universal "only translate what is in another language" rule above removes them
  by *content* instead — no site-specific selector needed. Seeing one of them duplicated
  again **is** a regression now.

---

## Webpage bilingual translation
- **Off by default**; starts only when the FAB is turned on (per page load).
- Translation is injected **under each original paragraph** (original kept above,
  translation below), in the configured text color.
- **Paragraph by paragraph.** Each paragraph in the viewport shows a **`⏳ 翻译中…`**
  placeholder until its translation arrives, so the page fills in incrementally
  (viewport-first, lazy for the rest).
- **At most 5 paragraphs translate in parallel** (`TranslationAPI` concurrency cap).
- **Error + retry.** If a paragraph's translation fails after retries, it shows a
  clickable **`⚠️ 翻译失败,点此重试`** (same state machine as subtitles).
- Skip non-content regions and non-text (nav/header/footer/aside, buttons, code,
  scripts, hidden elements). Idempotent (never duplicate if injected twice).

### One unified path (incl. YouTube) — see [`domain-design.md`](domain-design.md)
- All DOM — normal pages **and** YouTube title/description/comments — goes through
  the **single general `DomSegmenter`** (standard-HTML semantics, **no per-site
  selectors**). Translation is inserted as a **SIBLING** after the original
  (resists YouTube Polymer re-render; works on normal pages too) and re-applied by
  a ~1s recollect poll.
- **SPA re-renders never visibly disturb the page.** A mere click/selection makes
  SPA frameworks (React on Substack) re-render the article — MOVING existing nodes,
  which order-displaces our sibling translations. Translations must stay glued to
  their paragraphs with **no visible flash, layout jump, or remove→re-add blink** —
  clicking body text produces **no perceptible action**. (A childList
  MutationObserver runs the cheap re-anchor pass in the same microtask — before the
  browser paints — so displaced order never renders; orphan adoption + the ~1s poll
  remain the backstop for genuinely replaced nodes. The observer ignores mutations
  involving only our own `mt-` nodes to avoid the YouTube observer-feedback-loop
  gotcha.)
- **Flex / grid rows: translation takes its own full-width line.** When the
  original's parent is a flex or grid container (mobile YouTube video metadata
  `次点赞/观看/年前`, the top nav, comment counts), the sibling translation would
  otherwise become a flex/grid *item* placed inline next to the original and
  overlap/spill off the row. So the translation is forced onto its own line below:
  flex → `flex-basis:100%` + the row is made to wrap; grid → spans all columns.
  The row's `flex-wrap` is restored on disable.
- **Reversed flex containers: the translation still reads BELOW the original.**
  A `flex-direction:column-reverse` container stacks its items bottom-to-top, and
  a row with `flex-wrap:wrap-reverse` stacks its *lines* bottom-to-top — in both,
  a translation appended after its original in the DOM would **paint above it**
  and the bilingual pair would read backwards. Placement therefore follows
  **visual order, not DOM order**: in those containers the translation is
  anchored *before* the original so it still renders below. (A plain
  `row-reverse` only mirrors the main axis; its own-line translation already
  lands below, so it is unchanged.)
- **Rotation / resize / breakpoint re-measures the mirror.** The geometry a
  translation copies from its original (the width cap, the indent, the flex-row
  fix) is measured in **pixels at render time**. When the viewport changes —
  iPhone rotation, a desktop window resize, a media-query breakpoint — those
  frozen pixels are dropped (debounced) and every visible translation
  re-measures on the next tick, so it keeps matching its original instead of
  squeezing into a stale column. A row that a media query has flipped to a
  column also gets its wrap fix reverted there and then. For a single-blob
  interleave, whose original is hidden, the original is briefly restored *within
  the same task* (never painted) to re-measure it.
- **Translate only what's visible.** Hidden text (e.g. the collapsed-vs-expanded
  description, `display:none` nodes) is excluded via computed-style visibility —
  never translate text the user can't see.
- **Preserve structure.** Multi-line / single-blob text (description, multi-line
  comments) is rendered with `white-space: pre-wrap`, keeping line breaks; a
  single blob with multiple paragraphs is re-rendered interleaved (see universal
  rules below).

---

## Text translation — universal rules (ALL devices, ALL pages)
These apply to every webpage text translation, on every platform:
- **Only translate what is in ANOTHER language — and don't even ask the provider
  otherwise.** A paragraph that is already in the target language must produce **no
  translation line at all**: not a duplicate, not a placeholder, not an error. It must
  also **not be sent to the provider** — an unnecessary request costs the user quota,
  and the answer would be discarded anyway. A bilingual pair is only shown when the two
  sides really are different languages; **a few foreign words are enough** to make a
  paragraph worth translating, so a mostly-Chinese sentence quoting an English phrase
  still gets translated.
- **How the skip decides, in two layers.** The bias never changes: **erring toward
  translating is deliberate**, because a wrongly skipped paragraph shows nothing at all
  and gives the user nothing to retry — far worse than one redundant line. URLs,
  `@handles` and `#tags` are excluded from every measurement below; they are Latin even
  inside otherwise-native text.

  **Layer 1 — script, on every surface.** Available everywhere, the only layer on
  Safari. Script can only tell you *same script*, never *same language*, so it decides
  **only Chinese / Japanese / Korean targets**, where the mapping is clean (Han without
  kana → Chinese, kana → Japanese, Hangul → Korean). It answers "no" for every other
  target.

  **Layer 2 — browser-native detection, where the browser has it.** Chrome, Edge and
  Firefox expose a language detector (`chrome.i18n.detectLanguage`); no Safari does.
  Where present, it decides the targets layer 1 cannot — the English/French case — and
  those units are skipped too.

  **Layer 2 is never consulted for zh/ja/ko targets.** It has nothing to add there and
  would cost consistency. Measured: the detector reports 繁體中文 as plain `zh`, the
  same answer it gives 简体中文 — which is precisely the blind spot layer 1 already
  has (both are Han without kana). Routing the most-used path through a
  browser-conditional check would fix no case and make Safari and Chrome disagree.

  > **Pre-existing limitation, recorded not fixed.** Because neither layer separates
  > Traditional from Simplified, a 繁體中文 paragraph under a `zh-CN` target is skipped
  > today and shows no translation (and the mirror case under `zh-TW`). That is a real
  > gap, it predates the two-layer split, and a browser detector cannot close it —
  > separating Hant from Hans needs character-repertoire analysis, not language
  > detection. Tracked separately; do not cite it as intended behaviour.

  **Layer 2 only fires under all three gates**, because a language detector is
  confidently wrong on short text far more often than on long text: the detector
  reports the result **reliable**, the winning language holds **≥ 90%** of the text,
  and the text has **≥ 60 letters** after the exclusions above. Miss any one gate and
  the unit is translated.

  `isReliable` is the load-bearing gate and the length gate exists to feed it. Measured:
  `"Bonjour."` comes back as **Norwegian at 100%** — with `isReliable: false`. A
  percentage is a share of the text, not a confidence, so it is near-useless alone; and
  a 48-letter English sentence still self-reports unreliable, which is where the 60
  floor comes from. **When tuning, raise the length gate — never relax the other two.**

  The 90% figure has headroom for a reason: the same unambiguous English paragraph
  scores **100% on Chrome and 99% on Firefox**. The engines do not agree to the point,
  so a gate at 100 would silently do nothing on Firefox.

- **Known limit — stated, not hidden.** The two layers mean a browser without a
  detector translates a paragraph that a browser with one skips: with an `en` target on
  an English page, Chrome draws nothing under the paragraph and Safari draws a redundant
  translation line. Safari's behaviour is exactly the behaviour every browser had
  before, so nothing regresses — but the surfaces are not identical, and that is
  accepted rather than accidental (`docs/domain-design.md` §5.3).
- **Backstop for everything the two layers let through:** if a translation comes back
  **identical** to the original after normalisation, draw nothing. Strict equality only —
  never a similarity guess, which could suppress a genuine translation. This is what
  keeps Safari's output correct (just costlier) without a detector, and it stays the
  final net even where layer 2 runs — a unit under 60 letters is never skipped ahead of
  time, so short native lines still land here.
- **Normalisation ignores spacing that is typography rather than language.** Whitespace
  runs collapse, and whitespace *touching a CJK character* is dropped entirely: providers
  re-typeset freely around an embedded Latin word (Google returned
  「我会创建一个 Obsidian 文档」 as 「我会创建一个Obsidian文档」), and treating that as a
  translation draws the line twice. A space **between two Latin words** is untouched. This
  stays strict equality — a real translation differs by far more than spacing — and it is
  the comparison used for both the whole-unit and the per-line check.
- **The backstop applies per LINE, not just per paragraph.** The skip decision is made
  for a whole unit, but the reader sees the interleaved slices of it. A paragraph can
  legitimately deserve translating (it quotes foreign words) and still contain an
  individual line that is already the target language and comes back unchanged — that
  line is drawn **once, with no translation row under it**, while its siblings keep
  theirs. So the interleaved sequence is not always strictly original/translation/
  original/translation: an original may stand alone. What is never allowed is a
  translation row that does not sit directly under its own original.
- **A table cell holds its translation INSIDE itself, not beside it.** "Below the
  original" is a *visual* rule, not a DOM-sibling rule, and in one place the two
  conflict: an element placed next to a `display: table-cell` unit lands in the
  `<tr>`, where the browser wraps it in an anonymous cell — so the translations become
  an extra **column** and the table's intrinsic width roughly doubles. Observed on a
  floated Wikipedia infobox (issue #59): the prose column beside it collapsed to
  ~115px while paragraphs below the table were untouched. Cells therefore take the
  translation as their **last child**, and it must contribute **nothing** to the
  table's intrinsic width — an auto-width table is sized from its cells' max-content,
  so merely wrapping the translation still widens the column (+78px, measured).
  Cells also skip the interleave path, which hides the original and would take the
  translation down with it. Fixture 30; generic, not site knowledge.
- **Interleaved, paragraph by paragraph.** Each original paragraph is **immediately
  followed by its own translation** (original above, translation below) — never a
  whole block of originals followed by a whole block of translations. If the
  platform renders text as one blob with no per-paragraph nodes (e.g. the YouTube
  description), re-render it ourselves to achieve the interleave.
- **What counts as a "paragraph" here.** Leaving this undefined is how the rule above
  got violated in practice, so: it is a blank-line-delimited paragraph **and, in
  line-structured text, a single line**. A chapter list, lyrics, a poem or a
  plain-text bullet list separates entries with one newline; treating the block as a
  single paragraph makes N originals render above N translations — the very shape the
  rule forbids. A newline only counts when it is **really rendered as a line break**
  (the element's `white-space` is `pre` / `pre-wrap` / `pre-line` / `break-spaces`);
  in ordinary HTML a newline between inline elements is source formatting and renders
  as a space, so splitting on it would shred a normal paragraph into fake lines.
- **Never mis-pair.** Original and translation are interleaved only when both sides
  yield the **same** number of slices. If the model reflows the text and the counts
  disagree, fall back to the single-translation-block rendering: fewer interleaves is
  acceptable, attaching a translation to the wrong original is not.
- **Translation style matches the original.** The translated paragraph mirrors the
  original's formatting: line breaks / blank lines preserved (`white-space:
  pre-wrap`), and inline elements kept functional — URLs stay clickable links and
  timestamps stay seekable.
- **Font matches the original exactly.** The translation copies the original
  element's **computed font** — `font-family`, `font-size`, `font-weight`,
  `font-style`, `line-height`, `letter-spacing` — read via `getComputedStyle(original)`
  at render time. So a bold heading gets a bold heading-sized translation, body text
  gets body text, a caption gets a caption. The **only** font-related property that
  stays distinct is the **color** (configurable, default green `#0a7a3c` / dark-mode
  `#4ade80`) so the bilingual pair is still tellable apart. The 「字号」 setting is a
  **relative scale** applied on top (default `1.0×` = identical to the original;
  `0.8×`–`1.25×` to tune all translations up/down; legacy unit values migrate to
  `1.0×`). Applies to the sibling translation and to the re-rendered originals +
  translations in the single-blob interleave path. Subtitle overlays are a separate
  path (`lineCss`, keyed off `ytTextColor`) and are unaffected.
- **…and in the interleave path the ORIGINAL keeps looking like an original.** When a
  single-blob paragraph is re-drawn as alternating original / translation rows, the
  re-drawn original rows carry the **source element's own color**, not the
  translation color. The holder we draw them into is itself a `.mt-translation`
  element, so without that the originals inherit the green and the whole block
  renders in one solid color — the bilingual pair stops being tellable apart, which
  is the single thing color exists to do here. (Regression-tested by fixture 25.)

---

## First run — choosing an engine is a step, not a skip

The default provider needs no key and works immediately, and **that is the trap**: it is
not a stable endpoint (`verification-spec.md` §0 — it can return the original text
unchanged for input it translated a minute earlier). A user who never opens settings meets
that flakiness as their first impression and reads it as "the extension is broken".

So the onboarding tells them what to expect **before** a bad first result, never after:

- **On install only** (`reason === 'install'`, never on update) a **dot** is placed on the
  toolbar icon, cleared the first time the popup opens. A dot rather than `!`, because the
  shipped default is a *working* configuration and a permanent error badge on something
  that works is crying wolf. Best-effort: wrapped, because `chrome.action` is not
  guaranteed on every Safari surface and failing to show onboarding must never break the
  install.
  - **Not `openOptionsPage()`.** That was tried and rejected on evidence: opening a tab at
    install time **hung the layout suite indefinitely**, because loading the extension over
    CDP fires `onInstalled` and the surprise tab derailed the harness. A side effect our own
    automation cannot survive is the wrong mechanism, not a harness bug to work around — and
    what it does to a test run, it also does to a user who was mid-task.
- **A setup note sits at the top of BOTH the popup and the options page**, in two mutually
  exclusive states, never both:
  - the chosen engine needs a key and none is set → **warn**: translation will not work
    until a key is entered;
  - the free no-key engine is selected → **plain**: it works and is fine for a first look,
    it is not a stable endpoint and can hand back the original text unchanged, and any LLM
    engine with your own key is more reliable and better.
  - A configured keyed engine shows **nothing** — the note is onboarding, not chrome.
- The note clears on `input`, not just `change`. Waiting for blur would leave "translation
  will not work" on screen while the field is visibly full.
- **The free engine is not removed or hidden.** Zero-config trial is a real feature and is
  promised in the store listing; what changes is that the user is told what it is, instead
  of landing on it silently.

## Interface language (界面语言)
The extension's own UI chrome — popup/options labels, the FAB tooltip, the in-player
menu, and every subtitle/notice state (`⏳ 译文准备中…`, `⏳ 翻译中…`, `⚠️ 翻译失败,点此
重试`, `⏳ 字幕加载中…`, `字幕不可用`, …) — is shown in the **UI language**.
- **Default = follow the OS/system locale** (`uiLang: 'auto'`). The user can
  **explicitly override** it from a 「界面语言」 selector in **both** the popup and the
  options page (mirroring the 「目标语言」 selector), choosing any of the shipped locales.
- **UI language ≠ target language.** `targetLang` is what pages get *translated into*;
  `uiLang` is the language of the extension's chrome. They are independent.
- Switching applies **live** (no reload): the popup/options re-localize immediately,
  and content-script notices pick up the new language on the next render.
- Implementation note: `chrome.i18n.getMessage` is locked to the browser/OS locale and
  can't be switched at runtime, so `t()` consults a bundled message table
  (`MT_I18N_MESSAGES`, generated from `_locales/`) keyed by the effective locale, then
  falls back to `chrome.i18n`, then the literal Chinese fallback.
- **All user-visible strings are localized**, with two **deliberate exceptions shown
  verbatim**: language-picker **endonyms** (简体中文 / English / 日本語 …) and third-party
  **brand names** (ChatGPT (OpenAI) / Claude (Anthropic) / DeepSeek / 智谱 GLM).

## 复习 / Review (记忆层)

Domain model, scheduler math and storage live in
[`learning-design.md`](learning-design.md); the boundary rule lives in
[`domain-design.md`](domain-design.md) §9. **Only the user-facing behavior is here.**

### Capture — consent and control
- **OFF until the user turns it on, once.** Capture never starts by itself on
  upgrade. The first-run copy says plainly what is recorded (the sentence, its
  translation, the page URL and title, and how long it was on screen) and that it
  **stays on this device**.
- **Capture is invisible while it happens.** No badge, no toast, no highlight, no
  count ticking up in the corner. Reading a page with capture on must look and feel
  **exactly** like reading it with capture off — this is the user-facing face of the
  "capture is a sink" law (domain-design §9.1).
- **Off and purge are one tap each**, both in the options page: a master switch and a
  「清空学习库」 button with a confirm step. Turning it off stops capture immediately;
  it does **not** silently delete what was already collected (say so on the switch).
- **Saving a sentence deliberately** is a long-press / right-click on an injected
  `.mt-translation`, which stars it and bypasses the salience gate. A plain tap on
  body text still produces **no perceptible action** (see "Text translation —
  universal rules"); only the translation sibling is interactive, and only on
  long-press. A brief inline confirmation appears on the sibling itself — never a
  page-level toast.

### Entry points
- **popup**: a 「复习 (N)」 row at the top, N = cards currently due. Zero due ⇒ the row
  still shows, reading 「复习」 with no count — never hidden, or the feature becomes
  undiscoverable.
- **options**: a 学习 section (master switch, languages being learned, daily new-card
  cap, corpus size / usage, export, purge).
- **Never the action badge.** The service worker dies on Safari iOS, so a badge count
  would be silently wrong there (domain-design §5.3.1). Counts are rendered by the
  page that shows them.

### The review card
Reveal is **always** user-initiated. Nothing auto-advances, nothing is timed.

```
①  source sentence, large                ← media card: a 「▶ 重听这个片段」 button below
    [ 显示译文 ]                            one reveal button, nothing else on screen
─────────────────────────────  after reveal
②  translation, in the bilingual green (same visual language as .mt-translation)
    [不记得] [有点难] [记得] [太简单]        ← grades 0/1/2/3, always four, never two
    ⓘ source: site · title · 打开原文
```

- **Four grades, not two.** The scheduler's stability update is graded; collapsing to
  记得/不记得 would throw away the signal it needs.
- **Media cards replay the original audio, never TTS.** They do it by **opening the
  source at the timestamp in a new tab**, not with an inline player. Our own bilingual
  subtitles are active on that tab, so the replay is still a bilingual one.
  - **There is no inline player, and this is permanent.** YouTube's embedded player
    only accepts an http(s) embedding origin; from `chrome-extension://` it refuses
    with 「错误 153 · 视频播放器配置错误」. Measured 2026-08-02 across four variants —
    `youtube-nocookie.com` and `youtube.com`, each with the default referrer policy
    and with `no-referrer` — all four failed identically. The `no-referrer` runs also
    rule out a sandboxed extension page (opaque origin, no referrer). **Do not
    re-add the iframe**; it will look like a regression to fix and is not one.
- **Passage cards are re-reads, not tests.** Source and translation shown together,
  one 「已重读」 action (recorded as grade 2). No reveal step — there is nothing to hide.
- **Source attribution is always present and always clickable.** A card the user
  cannot trace back to where they met it is a flashcard, which is exactly what this
  feature is not.
- **LLM quizzes are opt-in and must state their cost.** When the selected engine is
  the free Google endpoint the toggle is **disabled with the reason shown** — never
  offered and then silently failing.

### States
- **Empty corpus**: explain how material gets collected (browse and translate), not
  「暂无数据」.
- **Nothing due**: say when the next card comes up. Do not fabricate work by
  advancing cards early — the whole product claim is that timing is principled.
- **Injected review UI obeys the same rules as every other piece of our chrome**:
  `translate="no"` **and** `data-mt-skip-region`, so we never translate, re-render, or
  re-capture our own interface.

## General
- **Screenshot-verify** every visual change against the built/loaded extension.
- Don't cover more of the frame/page than necessary.
- Branding: the product is「大肚猴翻译 / BelliedMonkey Translator」. Never reference the
  reference extension's name anywhere in code, docs, or UI.
