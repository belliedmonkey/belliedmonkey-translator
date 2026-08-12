# Interaction Spec (交互效果规范)

Single source of truth for all **user-facing interaction / layout constraints**.
Anything about how translations look or behave on screen is maintained HERE — not
scattered across code comments or AGENTS.md. When changing interaction behavior,
update this file in the same commit.

Verify every item here with a **screenshot** of the built, loaded extension — a DOM
element existing is not proof the user sees it (see AGENTS.md).

## 全局原则 (global principles)

- **IO 在途，控件不可用** *(2026-08-09，用户裁定)*。任何触发 IO 的操作（网络请求、
  合成、读写存储、播放）在请求发出到结果落定之间，**触发它的控件必须处于
  disabled 状态**，落定（成功收尾 / 失败 / 被打断）后恢复。两个目的：防止重复触发
  重复扣费，以及让「正在干活」有一个不会说谎的物理信号。配套要求：在途期间要有
  可见的状态文案（如「正在加载音频…」「播放中…」「解析中…」），失败要具名（见
  各节的失败文案规则）。**disabled 必须看得见**：每个页面的样式表都要给
  `:disabled` 一个可辨的视觉态（灰化 + 去 hover 反色）——功能上禁了、视觉上没变，
  等于对着用户撒谎（2026-08-09 全面查漏的直接起因）。
  已落地的面（2026-08-09 全产品查漏后）：语音 ▶ 与设置页试听（加载 + 播放全程）、
  解析这句、评分四键、来源治理全部按钮与语言 chips（改为真 `<button>`）、练习开始、
  存储压力清理、导入/导出、清空学习库、验证码/登录/退出/立即同步/删除账号、
  弹窗翻译按钮与本站开关、App 端全部对应面。
  **豁免（本条注明的不适用）**：settings 类控件的**即时本地保存**（select/checkbox/
  文本框 change 即存 `chrome.storage`，毫秒级、幂等、整体覆盖式写）——禁用只产生
  闪烁，双触发无害；但一旦该 change 处理器还串联了慢 IO（拉语音列表、跑统计、
  强制同步），豁免失效，照常禁用。
  新增任何 IO 操作时，这条默认适用，不适用要在本文注明理由。

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
- **All user-visible strings are localized — hardcoded copy is a defect, not a
  style choice** *(hardened 2026-08-08)*. This covers **every surface in every
  module**: extension pages, content-script notices, **and the host app shell** —
  the app bundle has carried `MT_I18N_MESSAGES` + `PageI18n` from the start, so
  "this surface has no `chrome.i18n`" was never a reason. A string a user can see
  lives as a key in `_locales/` (all locales, identical key sets), and the Chinese
  literal appears in code **only as the fallback argument of a `t()` call** — the
  convention that keeps a missing key from blanking the UI. Dynamic details go in
  as `{placeholders}` replaced at the call site, never concatenated into the
  fallback (a built-in detail is dead the moment the key resolves).
  **Enforced by `test/no-hardcoded-copy.test.js`** on every `npm test`: a CJK
  string literal outside a `t()` fallback position fails the build.
- The **deliberate exceptions, shown verbatim**, are exactly three: language-picker
  **endonyms** (简体中文 / English / 日本語 …), third-party **brand names**
  (ChatGPT (OpenAI) / Claude (Anthropic) / DeepSeek / 智谱 GLM), and the product's
  own **译 button glyph** — an icon that happens to be a character, identical in
  every locale. The test's allowlist must stay exactly as long as this list.

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

### 来源治理 (source governance) — 2026-08-09

Three user-authored controls over *what enters and stays in* the learning layer
(learning-design §4.1, §7.4, §8.9; the Collector-law carve-out is domain-design
§9.1 law 3). All three sync with the account; signed out they work locally.

- **学习语言 (language whitelist).** A chip row in options 学习 and in the app's
  settings: first chip 「全部（默认）」, then one chip per registry language. Picking
  chips means "only capture these"; on Safari the gate falls back to writing-system
  compatibility (learning-design §4.1) — the hint under the row says so in one line.
  Changing it never deletes what was already captured. A starred (long-pressed)
  sentence bypasses the whitelist — an explicit gesture outranks a standing filter.
- **来源管理 (sources manager).** In options 学习 and the app's settings: a list of
  captured domains, one row per domain — `host · N 张卡` — with two actions,
  「删除已存」 and 「不再收录」. A blocked domain shows 「已屏蔽」 and 「恢复收录」.
  Below the list: the block-rule chips (each removable) and an *advanced* wildcard
  input (`*.example.com/news/*`); the list is the primary path — nobody is required
  to type a wildcard. Deleting asks for confirmation **with the count and the
  consequence**: 「删除 {host} 的 {n} 张卡？会同步到所有设备，不可恢复。」 A card
  that later reappears was re-encountered on another device after the delete — the
  docs and support copy say that plainly (learning-design §7.4).
- **popup 「本站」 section.** The in-page quick entry, deliberately in the popup and
  not on the page (capture must stay invisible in the browsing flow). Shows the
  current host and a 「收录本站」 switch: off appends the site rule, on removes it.
  If the site is blocked by a **broader** wildcard rule the switch is replaced by
  「由规则 {pattern} 屏蔽」 plus a 管理 link — never a switch that lies. Hidden on
  pages the extension cannot read (chrome:// etc.).
- **Review card source actions.** The ⓘ source line gains a 「⋯」 button revealing
  two inline actions: 「删除已存 · {host}」 (same confirm-with-count flow, then the
  deck rebuilds) and 「不再收录 · {host}」 (already-blocked shows 已屏蔽, disabled).
  This is law 2's fix-action surface: the place you notice unwanted material is the
  place you can act on it.

### Entry points
- **popup**: a 「复习 (N)」 row at the top, N = cards currently due. Zero due ⇒ the row
  still shows, reading 「复习」 with no count — never hidden, or the feature becomes
  undiscoverable. Below it, the 「本站」 section (see 来源治理).
- **options**: a 学习 section (master switch, 学习语言 whitelist, daily new-card
  cap, corpus size / usage, 来源管理, export, purge).
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
- **Every grade button shows its consequence** *(2026-08-08 — real-device feedback:
  「点击完后不知道意味着什么」)*: 「不记得 → 重新学」「有点难 → 2 天后」「记得 →
  5 天后」「太简单 → 12 天后」, computed for the card on screen via
  `previewIntervals` (learning-design §5.1). Choosing a grade is choosing a preview,
  never a surprise.
- **Memory strength is always visible on the card**: a small bar plus
  「记忆强度 {s} 天 / 180 天」. 「已掌握」 has a user-visible definition — strength
  reaching 180 days ≈ nine-in-ten recall after half a year untouched.
- **First visit shows a one-time explainer** (three sentences: 记得→间隔拉长；
  忘了→重来；强度攒满→毕业), dismissed forever once seen. Stored in `meta`.
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

### 语音 (TTS)

Turns a review card into listening practice. **Off until the user turns it on** in
the browser extension, like capture — with one dated exception:

- **The app defaults to `assist`** *(2026-08-08)*. Two reasons, both app-specific:
  the default engine is the platform's own on-device `speechSynthesis` (free, sends
  nothing anywhere — the off-default was never privacy-motivated for it), and the
  mastery ladder's 听懂 form gates on TTS being available: an app that ships the
  ladder with speech permanently off ships a ladder missing a rung, plus settings
  (autoplay / rate) that govern a feature which can never run. The extension keeps
  the off-default — it lives next to capture, and its users chose their modes
  already. The app's 语音模式 control offers the same three modes either way.

- **On-device first.** The default engine is the platform's own `speechSynthesis`:
  free, offline, nothing sent anywhere. A self-hosted or cloud endpoint is a choice
  the user makes, never the default. The settings list is ordered on-device →
  self-hosted → cloud, so the principle is visible rather than merely stated.
  *(2026-08-08)* **Both hosts offer the full engine choice**: the extension's
  options page and the app's settings render the same registry
  (`MT_TTS_ENGINES`), same order, same per-engine fields; the app's speech key is
  a device-local credential under learning-design §7.2's boundaries (never
  synced), and app-side changes reconfigure TTS live — next card, no relaunch.
- **Three modes.**
  - `off` — no audio UI at all.
  - `assist` — the card looks as it always did, plus a ▶ control.
  - `audio-first` — **the original text starts hidden**: listen → 「显示原文」→
    「显示译文」→ grade.
- **`audio-first` does not violate "reveal is always user-initiated."** That rule
  governs the **translation**. Playing the original aloud reveals nothing — it is the
  same information the card was already going to show, in another channel. Revealing
  the text and revealing the translation both remain explicit taps.
- **Voices are matched to the card's language, not chosen globally.** A Japanese
  sentence read in an English voice is worse than silence. The user's preferred voice
  is used **only if it speaks that language**; otherwise the best system voice for
  that language is used; if there is none, **the card says so and the ▶ control is
  disabled** — never a button that silently does nothing.
- **Unknown-language cards (`und`) speak only with a user-chosen voice** *(2026-08-08)*.
  This is a population, not an edge case: the browser-native detector is absent on
  every Safari, so every card captured there is `und` — on the phone that is MOST
  cards. Guessing a voice would read text in the wrong language (the exact thing the
  rule above forbids), so `und` plays with the explicitly chosen voice or not at all
  — and its failure message must point at OUR voice setting (「这张卡的语言未知 ——
  在设置里选一个朗读语音后即可朗读」), never claim the system lacks a voice. Both
  hosts offer the voice picker: the extension's options page and the app's settings
  (the app's reconfigures TTS live — a picked voice works on the next card, no
  relaunch).
- **Loading is visible, and the ▶ control is disabled for the whole attempt**
  *(2026-08-09, revised same day per 全局原则「IO 在途，控件不可用」)*. From the
  moment a play is requested — auto or manual — the card shows 「正在加载音频…」
  (`tts_loading`) and the ▶ button is DISABLED; once playback starts the note
  becomes 「播放中…」(`tts_playing`) and the button STAYS disabled until playback
  finishes (`speak()`'s `done` promise: ended / errored / interrupted), then
  re-enables. A failed attempt re-enables immediately with its named reason.
  *(The first 2026-08-09 revision kept the button live during auto attempts so a
  tap could rescue a blocked autoplay; that mattered only while the app's
  WKWebView media gate was still up — lifted the same day — and the user ruled
  the IO rule wins. On hosts where autoplay is refused (iOS Safari extension
  page), the auto attempt settles fast and the button returns with the blocked
  message naming the tap as the fix.)*
- **Every failure names itself — auto attempts included** *(revised 2026-08-09)*:
  no voice for this language / no built-in speech in this browser / no endpoint
  URL / no API key / the service returned an error / autoplay blocked. The
  blocked-autoplay message doubles as the instruction (「点一下播放」), and with a
  visible loading state the old silent handling would read as a loading line that
  vanished into nothing. *(The pre-2026-08-09 rule kept auto-blocked silent; that
  predates the loading state.)*
- **Autoplay is a setting, and never blocks anything.** If the browser refuses it,
  the card is fully usable via the button.
  - **On iOS Safari (the extension page), autoplay IS refused** — measured
    2026-08-03 on the iPhone simulator (iOS 17.2): the card renders, the ▶
    control is enabled, and nothing is spoken until the user taps it. So there,
    `audio-first` means *tap to listen, then reveal*, not *listen hands-free*.
    This is a platform rule about user gestures, not a defect.
  - **In the APP, the gate is lifted** *(2026-08-09, 真机定案)*: the shell's
    WKWebView sets `mediaTypesRequiringUserActionForPlayback = []` (patched by
    `scripts/sync-app-assets.js` — the converter template never sets it). The
    default policy only allows `play()` inside a gesture's SYNCHRONOUS call
    stack, but endpoint-engine playback is inherently "tap → async fetch →
    play()": first plays of every card were rejected (`blocked`), cache hits
    raced the gesture window and worked only sometimes. The review page is our
    own content; auto-read is a feature, not third-party abuse — so in the app,
    autoplay genuinely plays.
  - **A blocked autoplay must be DETECTED, not assumed to have worked.** iOS ignores
    `speechSynthesis.speak()` without a gesture *silently*: no exception, no error
    event, no sound. Treating a non-throwing call as success made the card announce
    「播放中…」 over silence. Playback counts as started only when the utterance's
    `start` event fires.
- **Synthesized audio is cached on the device** (endpoint engines only — the built-in
  voice cannot return audio data at all). Cache size and a one-tap clear are visible
  in settings, because a cache the user cannot see is a cache they will one day be
  surprised by.

### 掌握阶梯与技能轮换 (mastery ladder & skill rotation) — 2026-08-08 / 2026-08-12

One schedule; the exercise FORM is gated by memory strength (learning-design §5.2)
and rotated across the four skills (learning-design §5.4). The grading flow does not
change: four grades, consequence previews, strength bar.

- **What a due card asks** is the eligible skill verified longest ago: 读 always
  exists; 听 / 说 from `s ≥ 4` (each behind its own capability); 写 from `s ≥ 30`.
  One review may append ONE extra exercise for a second stale skill, labelled
  「再练一项 · 不再计入间隔」 — it refreshes that skill's badge; a fail lapses the
  card, a pass never lengthens the interval (the §5.3 asymmetry, reused verbatim).
- **Exercise variants per skill** — deterministic local ones always exist; AI ones
  appear only when the 解析引擎 gate is open (learning-design §9.3), and **any AI
  failure falls back to the local variant of the same skill** — never a dead card:
  - **读**: recall (existing) / **译文选择题** — 4 options as real buttons, one tap
    locks the option row, the objective result constrains the grades (same rule as
    cloze: all-correct disables 不记得, a wrong pick disables the passing grades).
  - **听**: audio-first recall (existing) / **盲听选词** — the audio plays FIRST;
    the options render only after playback has started. Replay is allowed and the
    card says so. Pick the words actually heard; objective result constrains grades.
  - **写**: cloze (existing; pack-provided `accept` alternates widen the checker) /
    an optional 「AI 复核」 after a failed blank — user-initiated, cost-labelled.
  - **说**: see 说题卡 below. Capability-gated: no microphone or no transcription
    engine ⇒ the form does not exist; the 「跟着读一遍」 shadowing hint stays at the
    listen tier, still labelled 练习，不验证.
- **Skill badges 读 / 听 / 写（/ 说 when its gate is open）** on every card — lit
  when that form was passed at ≥「记得」. A lit badge past its freshness window
  (learning-design §5.4) shows a 「待重验」 style, never goes dark. All available
  skills fresh + strength full ⇒ 「全面掌握」; full strength with stale or unlit
  badges reads 「记忆已牢，技能待验」, never a demotion.
- **A card whose language has no TTS skips the 听 forms entirely** — a missing
  capability means the form does not exist, not that the card failed (same
  semantics as domain-design §5.3 rule 1). The same sentence covers 说.

### 说题卡 (speaking exercise) — 2026-08-12

- **Anatomy**: the original sentence stays VISIBLE (this is reading aloud, not
  recall) → 🎙 「朗读这句」 → recording state (the button becomes 停止 with elapsed
  seconds; any TTS playback is stopped before recording starts) → on stop the whole
  speak control is DISABLED with 「识别中…」 (全局原则「IO 在途，控件不可用」) →
  the transcript renders (textContent only — model output is untrusted) with a
  score line 「与原句匹配 {n}%」 and the missed words → the score constrains the
  grades (≥90% disables 不记得; <50% leaves only 不记得/有点难).
- **Cost is stated at the point of use**: 「使用你配置的转写端点，每次录音一次
  调用」. Re-recording is allowed once the attempt settles.
- **Every failure names itself**: no endpoint URL / no API key / no microphone /
  microphone denied / the service returned an error / empty transcript. A mic
  denial mid-session removes the 说 form for the session and the card re-renders on
  its next eligible skill.
- **Recordings are never stored** — sent only to the user-configured endpoint and
  discarded when the transcript returns (learning-design §9.4, §10 Gate C).
- **Settings**: a 「转写引擎」 block in options 学习 and in the app's settings —
  engine list from `MT_STT_ENGINES` (self-hosted → cloud order; there is no
  on-device engine), base URL / key / model per registry flags. It never follows
  the translation or 解析 group: where a recording goes is an explicit choice. The
  hint under the block carries the Gate C sentence.

### 自由练习 (free practice) — 2026-08-08

- **Entry**: a standing 「自由练习」 on the review page, and 「继续巩固练习」 on
  the deck-done screen — 「今天的复习做完了」 is no longer a dead end. That screen
  also names the daily-new cap and links to its setting.
- **Pool**: 学习中 by default (weakest `R` first); switchable to 全部 (candidates
  and known included). Batch 10 / 20 / 不限. `spreadBySource` applies as always.
- **The asymmetric rule, stated on the surface in one line**:
  **「练习不能刷出掌握，但能暴露遗忘。」** A practice FAIL counts fully (lapse,
  card comes back soon); a practice PASS is logged but never lengthens the
  interval. Candidates in practice are exposure only — introduction stays with the
  daily deck (learning-design §5.3).

### 解析 (sentence notes) — 2026-08-08

- **「解析这句」 on the answer face** generates 生词表 / 短语搭配 / 一个语法点
  via the user's own chat-capable engine (learning-design §9.2).
- **Capability-gated like everything else**: no chat-capable engine configured ⇒
  the button does not render at all. Never a disabled button with an apology.
- **Cost is stated at the point of use**: 「使用你配置的 API，一次调用，永久缓存」.
  Cached notes render instantly with no spinner and no second charge. Generation is
  always per-card and user-initiated — never bulk, never automatic.
- **In the app** *(2026-08-08)*: the app's settings can hold a chat engine + key of
  their own (learning-design §7.2 — device-local, never synced; the wording must not
  imply it is safer than the extension's storage). Configured ⇒ the same gate opens;
  not configured ⇒ the entry point does not render, same as everywhere else.
- **独立解析引擎** *(2026-08-09 二，用户裁定)*: options 学习区新增「解析引擎」——
  默认「跟随翻译引擎」，选定后 key/地址/模型整组切换到解析组（learning-design
  §9.2 的整组规则）。提示语点名思考（推理）型模型不适合解析。字段属 settings
  即时本地保存，适用全局原则的豁免条款。

### 多设备同步一致性 — 2026-08-09（用户裁定，取代 2026-08-08「App 内同步与时效」）

> **原则（用户原话）：同一账号下，不管什么情况下，学习素材在多设备中一定要保持同步。**

- **每个设备显示总条目数与各状态数。** 复习页头部的计数行为
  「总计 N · 待复习 N · 学习中 N · 候选 N · 已掌握 N」，App 主屏同口径。同一账号
  完成同步后，各设备的这一行**逐字一致**——这是可验证的验收条，不是愿景
  （`verify-sync-consistency` 的王冠断言）。
- **常驻同步状态行**（复习页头部，计数行下方，小字弱色，永不遮挡卡片）：
  - 同步进行中 → 「与服务器同步中…」
  - 成功落定 → 「同步完成 · {时间}」（用户词「同步完成」逐字保留；追加时间是因为
    这行**常驻**，没有时间的「完成」放一小时就成了谎言）
  - 网络不通 → 「当前网络离线，稍后自动重试。学习记录已保存在本机。」
  - 其它失败 → 「同步没能完成，稍后自动重试。」
  - 未登录 → 「未登录，仅本机数据」（用户裁定：提醒此设备计数可能与其它设备不同）
  - 公开构建（同步未编入）→ 整行不渲染。不存在的功能不许长死状态条。
- **每次进入即同步，绕过节流**：App 启动、App 回前台、扩展复习页每次打开，三者
  都算「进入」，都强制触发一次完整 `sync()`（10 分钟节流只对被动面——设置页——
  继续生效）。断网恢复（`online` 事件）视同进入，立刻补一次。No timers, no
  background tasks — on iOS those die with the service worker（原 §8.8 约束不变）。
- **自动同步可见，但不打断。** 这是全局原则「IO 在途，控件不可用」的**明确豁免**：
  该规则约束的是*触发 IO 的控件*；自动同步没有触发控件，评分按钮永不因同步而
  禁用，卡片永不被同步抢走（在屏卡片不重建，只有空态/收官态才因新素材重建）。
  手动 同步 按钮维持响亮语义（成功报数字、失败报原因）且全程禁用（IO 规则照常）。
- **每日新卡预算是账户级的**：今天已引入的新卡数从**同步的复习台账**推导（每卡
  首条非练习复习落在 UTC 今天），不再是设备本地计数——手机上引入的新卡同样消耗
  电脑侧的当日预算。日界取 UTC：一个账号一个日界，跨时区一致。
- **一致性的边界（如实陈述）**：驱逐上限（单设备 2 万条）以内保证一致；设备时钟
  漂移会让「待复习」短暂偏差（同一时刻同一数据必然同数）；收敛判据不变——
  无活动时双向同步稳定「收到 0 · 上传 0」。

### 存储压力

Capture stopping, or collected material being discarded, is **never** announced in
the page — but it is **always** visible to a user who turned capture on
(domain-design §9.1 law 2). It surfaces in the review page and settings, never as a
toast over an article.

- **Review page**: a single line above the card — 「学习库已满，正在自动淘汰旧卡」 or
  「有采集内容没能存下来」 — with the cleanup action beside it. It never blocks the
  card; a full corpus still reviews perfectly well.
- **Settings**: the same state, stated with numbers, next to the usage readout.
- **The primary cleanup is targeted, not nuclear.** 「清理已掌握的卡」 removes only
  `state='known'` items — the ones the scheduler itself concluded you no longer need
  — and never a starred card or one you are learning. 「清空学习库」 stays available
  for people who want a clean slate, with its existing confirm step.
- **Never offer to sell local storage.** The local cap is self-imposed and costs the
  project nothing; see learning-design §7.1. A paid option may only ever appear
  against the *server* quota, and only if such a tier exists.
- Once cleared, the message goes away on its own — it reports a live state, not a
  dismissed alert.

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
