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
  text. This prevents two near-identical brand-coloured circles colliding on a small screen.
  "Mobile" is a single shared signal, `TranslationCore.isMobileLayout()`
  (`navigator.maxTouchPoints > 0` or a mobile UA), used by both the router
  (`content-main`) and the button gate (`content-youtube`) so they can never disagree.
- **The 译 button widget (desktop + embed only).** Where it IS shown it is an
  **always-visible terracotta circular floating button**, identical on desktop `youtube.com`
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
- Translation line color follows the `ytTextColor` setting (default from build/palette.config.js — sage-light since 2026-08).

### Loading state
- When the active sentence's translation is **not ready yet**, show a hint
  (**`⏳ 译文准备中…`**) in the translation line, dimmed/italic. When the translation
  arrives, the next tick **auto-swaps** it in. Never show a blank or stuck line.

### In-player control button + menu
- A **`译` button** is an always-visible **terracotta circular floating button** (same widget
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
  show a **one-line notice** in the overlay (`字幕不可用`) **with the 「AI 转写字幕」
  offer button** (see that section below). Do **not** silently regress to
  per-caption / word-by-word translation of the live caption DOM, and do **not**
  start transcribing on your own.

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
  **No word-by-word; no automatic ASR** — the user may ask for one, see
  「AI 转写字幕」 below.
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

---

## AI 转写字幕 — user-initiated transcription (2026-09-06)

Governed by [`domain-design.md`](domain-design.md) §2.4. One behaviour on every subtitle
surface (YouTube, podcast/generic media, x.com).

### Offer
- Appears **only** inside the `字幕不可用` notice (same overlay line, a button after the
  text) and as a popup action 「转写音频字幕」 when the page's media element is ≥ 30 s
  long. Nothing else surfaces it; a decorative video never does.
- The button text names the cost from the registry pick, e.g. 「🎙 AI 转写字幕（约
  $0.006/分钟）」; the notice under it says where the audio goes: 「音频将发送到你配置的
  转写端点」.
- With no transcription engine configured, the button reads 「先在设置里选择转写引擎」 and
  opens `options.html#stt`. Nothing is captured.

### While running
- File tier: 「⏳ 正在转写整段音频…」 (dimmed, italic — the loading style) until the
  complete transcript is in, then the normal bilingual pair. A progress fraction is
  shown when the upload is > 5 MB.
- Live tier: 「● 实时转写中」 until the first words; then the original line shows the
  words being spoken as they are recognised, and (with 「边说边译」 on, the default) the
  translation line shows a provisional translation ending in `…` that is replaced as the
  sentence grows. A closed sentence takes over both lines and stays for `HOLD_MS` (≈ 6 s)
  or until the next sentence. `⏳ 译文准备中…` uses the live grace (4 s), so it is rare.
- With 「字幕历史面板」 on (the default), a floating panel at the bottom-right of the
  video — inside the player, above its control bar, on YouTube (a viewport-fixed panel
  landed on the live chat column there, measured 2026-09-06); viewport-fixed
  bottom-right on audio pages — (≈ 380 px wide, ≤ 40 % of the viewport high,
  scrollable, last 40 sentences; **draggable by its header to anywhere on the page** —
  once dragged it stays viewport-fixed at that spot, clamped inside the viewport, and
  the spot is remembered)
  lists every closed sentence with its whole-sentence translation (`⏳ 译文准备中…`
  until it lands; a failed one in red, tap to retry); older rows are slightly dimmed;
  new rows auto-scroll unless the viewer scrolled up. While the panel is on the
  overlay shows only the stream (never a closed sentence); with it off the overlay
  holds each closed sentence ≈ 6 s as above. The panel keeps its rows after a stop
  and disappears with the media / when subtitles are turned off.
- Tapping the 译 control shows 「字幕历史面板」 and 「边说边译（快，译文会改）」
  (checkboxes) and 「停止转写」 rows while a session runs.

### Stops — always visible, never automatic restart
| Cause | Line shown |
|---|---|
| CDN refuses cross-origin reads and no capture path | 「无法读取该音频」 |
| capture attached but silent for 3 s while playing, unmuted | 「捕获不到声音，已停止转写」 |
| socket closed / vendor error | 「转写连接中断」 + the server's sentence, ≤ 1 line |
| media changed, subtitles turned off, STT settings changed | session ends; the notice reverts to `字幕不可用` + offer |
After any stop the user taps the offer again. Sentences already shown keep their
translations.

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
  the video subtitles and the page text — one brand-coloured circle, never two.
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
- **一个需要译文的段落，永远不会「什么都不显示」** *(2026-08-13，真机 bug 定案)*。
  静默终结**只允许**发生在请求发出**之前**——同语言跳过（本来就不该翻）。请求发出
  **之后**没拿到可用译文，无论原因（网络失败、重试耗尽、或**模型回了空正文**），
  一律进失败态并给重试入口。
  此前空正文被当作「这段没东西可翻」而静默终结（引擎里那行注释写着 "nothing to
  show, don't retry"），渲染器于是走「nothing to translate → 删掉兄弟节点」，
  段落永久空白、无提示、无补救——用户看到的就是漏译。解析路径 2026-08-08 已为同一
  形状加过 `empty_output`（思考型模型烧光预算返回空正文），翻译这条当时漏了。
  **不自动重试仍然保留**：持续返回空正文的模型自动重试只会烧配额，重试交给用户点。
- Skip non-content regions and non-text (nav/header/footer/aside, buttons, code,
  scripts, hidden elements). Idempotent (never duplicate if injected twice).

### One unified path (incl. YouTube) — see [`domain-design.md`](domain-design.md)
- All DOM — normal pages **and** YouTube title/description/comments — goes through
  the **single general `DomSegmenter`** (standard-HTML semantics, **no per-site
  selectors**). Translation is inserted as the original's **LAST CHILD** — inside
  its box, not beside it (resists YouTube Polymer re-render; works on normal pages
  too) and re-applied by a ~1s recollect poll. **A sibling is a correctness bug on
  any page whose framework owns the container**: an extra child shifts every
  position after it, so the next React commit moves the whole child list instead of
  patching it. See `docs/domain-design.md` §4 for the measured numbers. The
  interleave holder is the one exception — it hides the original, so it cannot live
  inside it.
- **SPA re-renders never visibly disturb the page.** A mere click/selection makes
  SPA frameworks (React on Substack) re-render the article — MOVING existing nodes.
  As a child the translation travels with its paragraph and is never order-displaced;
  the machinery below remains for the interleave holder (still a sibling) and for
  pages that move our child themselves. Translations must stay glued to
  their paragraphs with **no visible flash, layout jump, or remove→re-add blink** —
  clicking body text produces **no perceptible action**. (A childList
  MutationObserver runs the cheap re-anchor pass in the same microtask — before the
  browser paints — so displaced order never renders; orphan adoption + the ~1s poll
  remain the backstop for genuinely replaced nodes. The observer ignores mutations
  involving only our own `mt-` nodes to avoid the YouTube observer-feedback-loop
  gotcha.)
- **…and never destroy the user's text selection.** The same re-render MOVES the
  page's own paragraph nodes (remove+insert of the same objects) — verified live on
  lennysnewsletter.com 2026-08-12: selecting text triggers a React commit that
  performs **zero** paragraph mutations without our siblings and **hundreds** with
  them, and any move containing a selection endpoint kills or half-kills the
  selection（用户症状：「高亮闪一下就没」）. **Re-measured 2026-08-23 with the same
  method: 3 sibling divs → 76 paragraphs moved per selection change; 0 divs → 0.**
  That is why placement moved inside the original (above): the keeper below is now
  the backstop, not the cure. It never was a cure for the other half of the same
  bug — a click landing on a hyperlink was retargeted to a container ancestor, or
  dropped entirely, and no amount of after-the-fact repair can re-dispatch a click
  that never happened（用户症状：「超链接打不开」）. The renderer snapshots the live
  selection (`selectionchange`) and, in the **same pre-paint microtask** as the
  re-anchor pass, restores it via `setBaseAndExtent` when a real mutation batch
  damaged it. Restore never fights intent: a user gesture after the snapshot, a
  programmatic `removeAllRanges()` (no mutation batch), or endpoints that are no
  longer connected all suppress it, and it is bounded per gesture (page wins after
  8 rounds — the FAB-remount philosophy). Regression: layout fixture 33.
- **…and never change how the page's own content behaves.**（翻译文字插入后不要
  影响网页原有内容的交互动作。）The page's links, buttons, handlers, context
  menu and selection must behave exactly as they would without the extension —
  only our own injected UI (the `.mt-translation` child, FAB, subtitle
  controls) is ever interactive on our behalf. **The strongest reading of this rule
  is placement itself**: a translation node the page's framework has to reconcile
  around is already changing how the page's own content behaves, before anyone
  clicks anything. Concretely: the interleave redraw
  is plain text with the source hidden, so it **bails to sibling rendering**
  whenever the original contains interactive or non-text content (links,
  buttons, media, code — the original stays visible and fully clickable; fewer
  interleaves is the accepted price). Timestamp→seek anchors are created on
  **YouTube hosts only** — a hero `<video>` elsewhere must never be scrubbed by
  a translation. The selection keeper never overrides a selection the page set
  itself (a damaged selection is collapsed, keeps a snapshot endpoint, or clamps
  onto its ancestor; a page-set one shares none), never snapshots selections
  inside editors, and counts IME / dictation / paste (`beforeinput`,
  `compositionstart`) as user gestures. Every inline-style mutation on a page
  element records the prior value and restores it on disable (`data-mt-hidden`
  carries the prior `display`, `data-mt-pos-fix` the prior `position` — the
  `data-mt-flow-fix` pattern). Regression: layout fixtures 34–36.
- **Flex / grid rows: translation takes its own full-width line.** When the
  **original itself** is a flex or grid container, the translation — now one of its
  own children — would otherwise become an *item* placed inline beside the text and
  overlap/spill off the row. So it is forced onto its own line below: flex →
  `flex-basis:100%` + the container is made to wrap; grid → spans all columns. The
  container's `flex-wrap` is restored on disable. (Before 2026-08-23 this applied to
  the original's PARENT, because the translation was a sibling and therefore the
  parent's item. Same rule, one level in — moving inside is what narrowed it.)
- **Reversed flex containers: the translation still reads BELOW the original.**
  A `flex-direction:column-reverse` container stacks its items bottom-to-top, and
  a row with `flex-wrap:wrap-reverse` stacks its *lines* bottom-to-top — in both,
  a translation appended after its original in the DOM would **paint above it**
  and the bilingual pair would read backwards. Placement therefore follows
  **visual order, not DOM order**. As a last child the translation lands below its
  text unconditionally, so this now governs only the interleave holder, which is
  still a sibling: in those containers it is anchored *before* the original so it
  still renders below. (A plain
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
  stays distinct is the **color** (configurable; the default lives in
  `build/palette.config.js` — 2026-08 之后是鼠尾草 sage, dark-mode 用浅阶) so the bilingual pair is still tellable apart. The 「字号」 setting is a
  **relative scale** applied on top (default `1.0×` = identical to the original;
  `0.8×`–`1.25×` to tune all translations up/down; legacy unit values migrate to
  `1.0×`). Applies to the sibling translation and to the re-rendered originals +
  translations in the single-blob interleave path. Subtitle overlays are a separate
  path (`lineCss`, keyed off `ytTextColor`) and are unaffected.
- **…and in the interleave path the ORIGINAL keeps looking like an original.** When a
  single-blob paragraph is re-drawn as alternating original / translation rows, the
  re-drawn original rows carry the **source element's own color**, not the
  translation color. The holder we draw them into is itself a `.mt-translation`
  element, so without that the originals inherit the translation colour and the whole block
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
- **免费引擎仍然选得到，但我们不再推荐它** *(2026-09-01，用户裁定，推翻本节原有的
  「零配置试用是我们主推的第一印象」)*。原文是：「免费引擎不移除、不隐藏；零配置试用
  是真功能，改变的只是告诉用户它是什么。」前半句仍然成立 —— 它在设置页的详细配置和
  引导页的「三引擎分别配」里都选得到；**后半句不再成立**：我们给用户的第一优先级是
  一键配置。

  这条改的不只是文案，是**判据**。旧判据问「当前引擎需不需要 key」，于是出厂默认的
  免费引擎让全球版全新安装的人**永远不会被推去配一次**。新判据（`content/engine-state.js`
  的 `needsSetup`）问「配过没有」：

  - 配过 key ⇒ 配好了；
  - **主动点选过**一个不需要 key 的引擎 ⇒ 也算配好了（`engineChosen`）；
  - 其余 ⇒ 没配好，弹窗只留一个入口、悬浮球点下去进引导页。

  第二条不可省：只写「没 key = 没配好」会把**故意选了免费引擎的人困死**，悬浮球会一直
  把他弹回引导页。出厂默认不算选择，用户自己点的才算 —— 这正是这条裁定要区分的东西。

  随之删掉的三处「安抚免费通道」的分支：弹窗与设置页 setup note 的第三支、引导页第 2 屏
  按 flavor 分的正文、App 引导第 3 屏那行说明。它们的共同作用是让一个我们其实想让他去配
  的人安心不配。

  ⚠️ **商店描述里承诺过零配置试用**（本节原文如此）。免费引擎仍在，所以承诺没有作废，
  但下一次改商店文案时要重读这一条，别把「开箱即用、无需 Key」写成主打。

## extObSeen 是流程标记，不是配置标记

`extObSeen` 只回答一句话：**这个人看过扩展的引导页没有。** 它与「配好了没有」正交，
而且两个方向都能拆开：

- 什么都没配、它却已置位 —— 任何一次「以后再设置」都会写它；
- 配得好好的、它却没置位 —— 设置页点一下「重看引导」就会删掉它。

所以**拿它当「配好了」的信号会立刻出错**。要判「配好了没有」，用
`content/engine-state.js` 的 `needsSetup`（判据见上一节）。

落点：写它的只有引导页的 `finish()`，删它的只有设置页的「重看引导」，**读它的只有弹窗
那条「第一次用？」**。`test/ext-ob-seen.test.js` 钉住这三条 —— 一句提醒不是门禁。

它**故意不与 App 的 `onboardSeen` 同名**：两边存储不通（`app/chrome-shim.js` 把
`chrome.storage` 垫在 `file://` 的 localStorage 上），同名会让人写出「App 看过了扩展
就不用看」这种假联动。

## 一键配置与逐引擎配置永不同屏

**不变量。** 任何界面、任何时刻，一键配置卡与逐引擎配置控件不同时渲染。一键卡在场时，
必须有且只有一条可见、有标签的路通向逐引擎配置，且那条路落地后一键卡不在场。

第二句和第一句一样重要：一键卡只覆盖「同一个 host 一把 key 通吃翻译+朗读+转写」的
平台 —— 全球版 11 个对话引擎里覆盖 2 个，中国版 7 个里覆盖 1 个，且中国版没有免费
通道。**只藏不给路是退化，不是简化。**

**为什么这是正确性而不是排版。** 两者共存时，用户在逐引擎那一侧改了引擎或 key，
一键卡里那份「已配过 / 没配过」的判断当场变成谎话，而它下一次被按下就会照着那份谎话
写存储：把用户刚输入的 key 覆盖掉，并报告「✓ 通了」。反向同样成立（清空了 key，卡片
说「没动 · 你已经配过了」，翻译其实没配上）。2026-08-31 在设置页上实测到这三种表现。

配套的两条实现约束：

- **一键卡在按下按钮那一刻才读设置**，不用渲染时的快照。快照会跨模式、跨标签过期，
  而「重画一次」修不干净（重画会吃掉用户填了一半的 key）。读失败必须什么都不写 ——
  一个读不出设置的时刻不该被当成「用户没配过」。
- **两处的控件是同一个组件生成的**（`extension/learn/engine-fields.js`），id 也是同一套。
  两份「长得像的实现」意味着以后每次改都要改两遍，而漏掉的那一遍不会有人发现。

落点：设置页是「快速 | 详细」两个 tab；扩展引导页第 2 屏是「一键配置 | 三引擎分别配」
两个 tab，后面几屏共用。门禁在 `scripts/verify-onboard.js`（互斥、旧块不在 DOM、
两个 tab 之外没有任何引擎控件）与 `scripts/verify-extension-smoke.js`。

## 从翻译到复习：跨面交接 — 2026-09-01

**这条链路有四个环节，任何一环断了，用户看到的都是同一个症状：App 里永远是空的。**
2026-09-01 用户在真机 1.7.0 上顺着引导走完一遍之后报的正是这个 —— 翻译成功了，然后
什么都没发生。

| 环节 | 谁做 | 触发点 |
|---|---|---|
| ① 采集 | 内容脚本 `learn-collector.js` | `learnEnabled` 打开 + 停留够久（默认**关**） |
| ② 落库 | `drain.js` | 弹窗 / 设置页 / 复习页打开时 |
| ③ 上传 | `sync.js` 的 `push` | **弹窗**、复习页、设置页打开时（见下） |
| ④ 下拉 | App 的 `quietSync` | App 启动、回前台、`online` |

### 链路的形状（2026-09-02 重排）

```
引导四屏：边读边记 → 配引擎 → 开采集 → 去翻一页        ← 引导到此结束
                                             ↓ 新标签
官网试翻页：点悬浮球 → **出现译文** → 交接块「看看你的卡」
                                             ↓（先落盘）
复习页：看到刚读过的那句 →「未登录，仅本机数据 →」可点
                                             ↓
设置页登录 → 下一步是「去看你的卡」+「在 App 里继续复习 →」
```

四条不变量，每条都是从一次真实的断裂里来的：

1. **登录不在引导里。** 它曾经是第 4 屏，排在「翻一页」之前 —— 要人在看到第一句译文
   之前先填邮箱、收验证码。登录的请求归**官网交接块**（翻译成功那一刻）与**复习页**
   那行「未登录」，两处都在他看到价值之后。`verify-onboard.js` 断言引导四屏里
   不出现「登录」字样。
2. **交接块只在译文真的出现之后才画。** 它说的是「译文出来了」；在初始化期就画等于
   在页面一打开、一个字没翻的时候说这句话。判据是 `.mt-translation` 落进 DOM
   （MutationObserver，命中即断开），不是「脚本跑到了这里」。
3. **进复习页之前先落盘。** 采集只在 30 秒定时器或 `pagehide` 时写 outbox，而交接块用
   `window.open`——源页不卸载，两个条件一个都不满足。不落盘就开，等于把人送进一个
   刚刚还空着的房间，然后由空态告诉他「去打开采集」——而采集正是他两分钟前亲手打开的。
   落盘放在**画块时**，不是点击时：点击那一刻必须留给同步的 `window.open`（用户手势）。
4. **空态分两支。** 采集关着 ⇒「去设置里打开采集」；采集**开着**而 0 条 ⇒「采集已经
   开着了，读几段就会出现」，且不再给那个按钮。判据读 `learnEnabled`，不是只数条数。

**「去看你的卡」两个 flavor 都有。** 中国版没有同步，但采集与复习是完好的**本地**功能；
`MT_SYNC_ENABLED` 只管登录/同步那一支的文案与「直接去登录」链接，不许把整块关掉
（2026-09-02 之前它就是被整块关掉的，于是中国版从翻译到学习零路径）。

**登录之后的下一步要往前，不是往回。** 那里曾经唯一的按钮是「现在翻一页看看」——
引导 `try` 屏干的事。登录的价值在后面两件事上：看到自己的卡，以及让它们出现在 App 里。

### 弹窗也是心跳（推翻 2026-08 的「弹窗不加载 auth.js」）

③ 原来只有复习页与设置页两个入口级触发点。一个装好扩展、天天在网页上翻译、采集攒了
几百张卡、但**从没点开过那两页**的人，服务器上是空的 —— 于是他在 App 里读到「同步完成，
但服务器上还没有内容」，而他确实什么都没做错。

原来那条决定（弹窗只负责快点画出一个数字）成立的前提是「别的面会推」，而探查证明没有
别的面会推。所以弹窗现在也算一次心跳，规矩三条：**排在画计数之后**、**不带 force**
（受 10 分钟节流）、**失败全吞**。代价如实记：弹窗一关 JS 就死，push 可能被打断 ——
后果是下次重推、服务器多一条 chunk 行（append-only，replay 幂等），不是数据损坏，
而水位线 `syncPushedAt` 是全有或全无，被打断时不推进。门禁 `test/popup-heartbeat.test.js`。

### 官网试翻页上的交接块

「现在翻一页看看」落到 `/try/<目标语言>.html`（由 `scripts/gen-try-pages.js` 从
`build/try-pages.config.js` 生成）。**按目标语言分页**：示例段落的价值在于「这段你读不顺，
翻一下就顺了」，而把目标语言设成 English 的人打开一页英文示例，看到的是英文翻英文。

那一页上有一个交接块，三条不变量：

1. **页面只发空容器，文案由扩展的内容脚本填。** 于是它跟随用户在**扩展里**选的界面
   语言（11 份，不是站点的 8 份），且没装扩展时不可能出现。
2. **它不知道、也不许知道用户登没登录。** 内容脚本只读显式键列表，`learnAuth` 永不
   加入任何一份（`learning-design.md` §8.4.1）。所以它不假装知道 —— 它把人送到复习页，
   登录状态由那一页自己讲。
3. **中国版站点不发它。** 那个 flavor 的扩展 sync 是关的，给了就是死路。

主行动是**复习页**而不是设置页：复习页打开就是一次强制同步，一步同时完成「看到你的卡」
与「把它们推上去」。采集关着时换一套文案、改指设置页 —— 把一个没开采集的人送去空的
复习页，是把失败推迟到下一屏。门禁 `scripts/verify-site-handoff.js`（真实主机名 +
真实扩展，走 CDP 请求拦截）。

### 「不登录 = App 是空的」必须说在人会等的那个点上

`learning-design.md` §8.1 早就要求过这句话，但在这之前它没有落地处。现在有三处：
扩展引导的 sync 屏、官网交接块、App 空态。三处措辞可以不同，但都不许把登录说成
「可选的小功能」——它不是降级，它是 App 里有没有东西的分界。

### 界限是「浏览器 ↔ App」，不是「电脑 ↔ 手机」

**不许再写「让它们到手机上」「在手机上复习电脑上读到的句子」这一类话。**
两个面完全可能在**同一台设备**上：iPhone 上的 Safari 扩展与 iPhone 上的 App，
Mac 上的 Safari 与 Mac 上的 App。2026-09-02 用户正是在手机上读到「让它们到手机上」。

写这一族文案时的规矩：

- 说 **App**，不说「手机」。平台名（iPhone / Mac）只在告诉别人**去哪儿拿它**时出现。
- 说 **这个浏览器**，不说「电脑」。
- 「同步」要说清它连的是什么：浏览器里读到的句子 ↔ App 与你的其它设备。

### 采集开关与登录入口不属于「逐引擎配置」那一档

两者都曾被打上 `adv-only`，而那个类是「一键配置 vs 逐引擎配置」互斥用的
（见上一节）。代价是默认模式（快速）下**两个入口都看不见**，而产品里恰好各有一个
按钮把人往那里送：官网试翻页的「去打开采集」、引导第 4 屏的「打开设置去登录」。
按钮点了、人到了、控件不在 —— 两次真机实测，间隔一天。

- 任何把人往某个控件送的按钮，落点是**那个控件**，不是页面顶部
  （`options.html#sync` / `#learn`，锚点表在 options.js 里只有一份）。
- `verify-extension-smoke` 的互斥清单只列**引擎配置卡**，并反过来断言采集开关与
  登录入口在快速模式下**必须可见** —— 藏起来等于没有。

### 登录成功不是终点，是倒数第二步

登录本身对用户没有价值 —— 它的价值全在后面那两件事上：去翻一页，以及**在 App 里用
同一个账号登录**。所以登录成功之后必须给出这两条，而不是把界面切成邮箱 + 用量 +
三个管理按钮就完事（2026-09-02 真机实测：那一刻是个死胡同）。

- 「用同一个账号」这句话**必须带上刚登录的那个邮箱**。不带具体值时用户没有可对照的
  东西，而两端账号不一致正是这条链路最常见、最难自查的失败（见下一节）。
  在这之前，这句话在全仓只出现一次，且只在 App 引导的最后一屏 —— 也就是只有已经装了
  App 的人才看得到，而需要它的恰恰是还没装的人。
- 任何把人往登录送的按钮，落点都是**登录框本身**（`options.html#sync`），不是设置页
  顶部。`openOptionsPage()` 不接受 hash，所以那条路必须走 `getURL(...) + '#sync'`。
  滚动要排在模式切换（`applyDetailMode`）之后并等两帧 —— 那一步会增删卡片，
  滚完再改布局落点就偏了。
- 登录区的标题必须含「登录」。从一个写着「去登录」的按钮点过来，看到一个只写着
  「同步」的标题，人会以为走错了地方。

门禁 `scripts/verify-signin-flow.js`：手机视口（窗口默认 1300×900 时登录区本来就在
屏幕里，锚点滚没滚过去测不出来），断言落点坐标、标题含「登录」、下一步那一块可见
且句子里带着刚登录的邮箱。

### 两端账号不一致

**代码里没有跨端一致性检查，也不该有**（不变量在数据层：`sync.js` 的 `ownerGate()`）。
能做的是**让用户看得见可对比的事实**：App 空态那句话带上这台设备登录的邮箱，并提醒
确认扩展那边是同一个。原来那句「先在浏览器里采集一些」在最常见的触发场景里是反过来
指责一个已经采集了一周的人。

`ownerGate()` 的两个 code（`owner_mismatch` / `owner_unknown`）必须两端都有人话 ——
两个界面的兜底都是 `return e.message`，漏掉就是把英文标识符摆到用户眼前。
门禁 `test/error-copy.test.js` 从源码数 code，不维护手写清单。

## 首次运行引导（App 侧）— 2026-09-01 补记

`app/app.js` 与 `app/index.html` 长期引用「§引导」，而这一节直到今天都不存在。

**四到五屏**：`welcome → ext → browser → read`，再按 `MT_BACKEND.enabled` 决定要不要
`signin`。少掉的三屏（配翻译引擎 / 打开采集 / 看第一张卡）App 做不到 —— 它们都在扩展
那一侧，两边存储不通；在 App 里画一个引擎选择器是假控件。

- **`ext` 屏没有「继续」**：App 在 iOS 上判不了扩展启没启用，一个「继续」只能是
  「假装你做完了」。主行动「在网页上完成设置」同时是前进键。
- **`browser` 屏不给外链**：上一屏已经把人送去官网了，第二个竞争入口只会分散注意力。
- **`signin` 屏按构建取舍**：同步没编进这个构建时不渲染它。中国版扩展的登录入口是被
  整节 `remove()` 掉的，让人去那里登录是死路（对齐本文件「不存在的功能不许长死状态条」）。
- **行动键钉在页脚**（`position: sticky`）：`#onboard` 的父级是普通 block，flex 那条
  高度链是断的，靠 `overflow` 会静默失效。判据是渲染坐标，不是 CSS 里写了什么。

`#ext-banner` 说的是「材料来源没开」，**不是「你没登录」**——两件事不许混。它的出现
条件是：没有别的视图开着、`browserSideOk === false`、引导没在进行中、且 `state.enabled`
不为真。

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
  body text still produces **no perceptible action** (see "Webpage bilingual
  translation → One unified path" — the SPA / selection / interaction triad); only
  the translation sibling is interactive, and only on
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
②  translation, in the bilingual sage (same visual language as .mt-translation)
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
    This is a platform rule about user gestures, not a defect. *(The app's 播客模式
    is the one sanctioned hands-free regime — see its section below; it cannot and
    does not exist on the extension page.)*
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
  - **写**: cloze (existing); when the card has cached 解析, the blanks are drawn
    from its 生词/短语 and rotate across reviews (§5.4 — 这次挖这个词).
    Pack-provided `accept` alternates widen the checker — the sentence's own
    answer stays the answer of record and the correction shown.
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

### 语言未知的卡也要读得出来（2026-09-02）

Safari 上没有 `chrome.i18n.detectLanguage`，所以**在 Safari 里采集的每一张卡的
`lang` 都是 `und`** —— 也就是 iOS 上的全部素材。而挑音色的规则原来是「und 且没有
显式选过音色 ⇒ 没有音色」，于是播客模式在 iOS 上一张卡都播不了：4 张卡、4 张跳过、
一轮瞬间结束，而界面只说「读不出来的卡（媒体卡或无语音）」。

- **语言未知时按文本的主导脚本挑音色**（`LearnRules.dominantScript`）。假名 ⇒ ja、
  谚文 ⇒ ko、西里尔 ⇒ ru、汉字 ⇒ zh…… 拉丁字母是唯一含糊的一支，退回 en：
  我们的用户读的外文绝大多数是英文，而英文文本用英文音色念即使猜错也读得出来。
- 「日文卡用英文音色念比不念更糟」那条判断**不变** —— 它针对的是**已知**的语言。
  这里处理的是未知，而未知 ≠ 已知不匹配。
- **用户显式选过的音色永远最优先**：那是他的决定，不是我们的推断。
- 猜出来的语言仍然没有音色 ⇒ 照旧 `no_voice_und`，理由必须与 `no_voice` 分开：
  后者会让人去 iOS 设置里找一个他手机上明明有的音色，而真正的修法在我们的设置里。

**跳过的两个原因必须分开说。** 「媒体卡」（视频字幕的锚点，没有可朗读的正文）无解；
「没有能读它的音色」去设置里配一个就好。合成一句「读不出来的卡（媒体卡或无语音）」
等于让用户猜自己该做什么。

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
  microphone denied / **endpoint unreachable — including the CORS case** / the
  service returned an error / empty transcript. The unreachable message names
  BOTH causes a user can act on (address, and that a self-hosted server must
  allow cross-origin requests) — WebKit reports a blocked-by-CORS response as an
  indistinguishable network error, so guessing one cause would mislead half the time. A mic
  denial mid-session removes the 说 form for the session and the card re-renders on
  its next eligible skill.
- **Recordings are never stored** — sent only to the user-configured endpoint and
  discarded when the transcript returns (learning-design §9.4, §10 Gate C).
### 接口地址字段（所有引擎共用一条规则）

- **字段的语义是「完整的接口地址」**，不是主机名。用户填什么我们就请求什么，一个字符都不
  加（domain-design §7 零拼接）。空着表示「用这个引擎的默认端点」——那仍然是最常见、也最
  该鼓励的状态，占位符显示的就是那个完整默认地址。
- **占位符来自注册表**（`defaultEndpoint` 或 `placeholder`），不来自文案。一条路径写进
  十一种语言的翻译串就是十一份会过时的拷贝。
- **切换引擎时，若地址框非空则清空它**，并给一条可见提示。地址不能跨端点携带——理由与
  语音那条一样（`app/settings.js` 换引擎会重置 voice：「Voice names don't carry across
  engines」）。对有默认端点的条目，清空恰好回到一个能工作的配置；对必须自填的条目，本来
  就得重填。**不许静默清空**。
- **失败要分得开。** 「测试连接」在发请求之前做一次离线形状检查：地址缺协议头 ⇒
  `bad_url`；只有主机名没有路径 ⇒ `no_path`。这两条**只在自检里硬失败，运行时不拦**——
  逐字发送是承诺，而根路径端点虽罕见却合法。之所以要单独具名：缺路径造成的失败与 CORS
  失败在 WebKit 里表征完全相同（learning-design §9.4，2026-08-13 实测的裸 TypeError），
  运行时无法区分，只有离线检查能。
- **结果行回显真正请求的地址**（成功与失败都回显，key 永不出现在这一行）。用户填了自定义
  端点时最常见的故障就是地址错，而「我们调用了哪个地址」是唯一能把它和「连不上」分开的
  事实，没有任何错误文案能提供它。

- **Settings**: a 「转写引擎」 block in options 学习 and in the app's settings —
  engine list from `MT_STT_ENGINES` (self-hosted → cloud order; there is no
  on-device engine), endpoint URL / key / model per registry flags. It never follows
  the translation or 解析 group: where a recording goes is an explicit choice. The
  hint under the block carries the Gate C sentence.

### 播客模式 (driving mode) — 2026-08-17，2026-08-18 重定位（App 专属）

An app-only **player** for the deck (learning-design §9.5): TTS reads each card
原文 → 译文 (→ 解析, if the user turned that on), one card runs straight into the
next with nothing waiting on the user, in one of four playback orders. In **both host apps
(iOS and macOS)** it keeps playing once the app is no longer visible — backgrounded,
locked, minimised or switched away (2026-08-24, learning-design §9.5「后台与锁屏播放」);
on iOS the screen is also kept awake by the `app:sync` idle-timer patch while the app is
in front.

**It writes nothing** — no review row, no skill stamp, no `lastSeenAt`, no scheduler
call. The 跟读 exercise and the spoken 「有没有疑问？」 loop that v1 had are gone: a
recording window has to interrupt continuous playback to exist, and continuous
playback is the whole content of "listening while driving". Every write path stays on
the review surface, where the user can see what they are grading.

**Two explicit carve-outs, each naming the rule it amends** *(anything not carved
out follows the standing rules unchanged)*:

1. **Amends 「reveal is always user-initiated; nothing auto-advances」 and the
   `audio-first` ruling above.** Inside a driving session only, the translation is
   spoken without a reveal tap and cards auto-advance. The single entry tap
   (「播客模式」) is the consent for the whole session — same shape as the
   audio-first exception: what the rule protects is the *user's* pacing, and the
   user chose this pacing by entering the mode. 暂停/退出 returns to the normal
   regime instantly; nothing outside the session changes behaviour.
2. **Amends 全局原则「IO 在途，控件不可用」.** A driving session is one continuous
   IO chain; disabling controls for its duration would mean *no* controls.
   Carve-out: **⏸ 暂停/停止 is enabled at all times** (it is the interrupt for the
   in-flight IO, not a second trigger — double-fire is impossible by construction:
   `LearnTTS.stop()` is idempotent and epoch-guarded); ⏭ 下一张 / 🔁 再听一遍 are
   enabled between segments and debounced by the TTS epoch; the **playback-order
   button is enabled at all times and never interrupts audio** — it changes only what
   happens after the current card, which is exactly why it is safe to press while
   moving.

- **The gate ladder (capability semantics, never disabled buttons)**:
  - the 「播客模式」 entry button exists ⇔ TTS is usable at all;
  - the 解析 segment exists ⇔ the user turned it on AND the 解析引擎 gate is open
    (§9.2). Engine not configured ⇒ the segment does not exist, it is not greyed.
- **What is spoken per card — THREE passes** (2026-08-18): 原句 / 原句 + 译句 +
  解析 / 原句. The plan is flat but every segment carries its pass, because once
  flattened nothing else can tell the first pass's 原句 from the third's, and the
  status line says which one is playing. Text stays **visible** throughout —
  audio-first, never text-hidden (passengers and parked use exist).
- **暂停时出现「解析这句」**: analyse (generating if needed), show, read aloud, then
  **return to paused on the same segment**. Pausing means "I am in control", so
  finishing a piece of analysis must not decide to resume for the user; 继续 stays a
  tap. The button exists only when the notes engine is usable.
- **Playback order** — 随机 (default) / 顺序 / 循环 / 单曲循环, cycled by one button
  and persisted. 随机 is a *permutation*, not per-step sampling, and reshuffles when
  it wraps. ⏭ 下一张 moves on even in 单曲循环 — a player that ignores its own next
  button is broken. Only 顺序 ever reaches 「本轮听完了」.
- **Reading the 解析 aloud is ON by default and its cost is stated twice**: beside
  the setting ("a card that has never been analysed is analysed on the spot, using
  your engine — charged once per card, cached from then on") and as a standing line
  in the player while it is happening. Default-on means the FIRST session through a
  fresh deck analyses every card in it, which is exactly why the cost sentence is in
  two places rather than one. No per-session cap: a cap makes the analysis stop
  appearing partway through a session for no visible reason, which is harder to
  understand than the cost itself.
- **A switch the user turned ON must never do nothing in silence.** If 播放解析 is on
  while no notes engine is configured, the player says so once, in the standing line,
  and names where to configure it — this is NOT the "capability semantics" case
  (that covers forms the user never asked for). Shipped 2026-08-17 without it and the
  feature was indistinguishable from unimplemented on a real device.
- **Failures are told apart** (§9.1/§9.4 reason conventions): a whole-engine failure
  (`blocked`, `unsupported`) stops the session on a named reason, because it will
  recur on every card; a per-card failure (`no_voice`) says so and skips to the next,
  because one unreadable card must not end a session whose other cards are fine.
  Never silent either way.
- **Hiding is no longer pausing** (2026-08-24). The test is one question — *can this host
  keep making sound while it is not visible?* — and it answers differently per platform.
  On **macOS** the answer is unconditionally yes: the process is never suspended, so
  minimising, ⌘H or switching away just keeps playing (the only thing that ever stopped it
  was this handler). On **iOS** it holds while the host actually has an audio session AND
  the engine yields audio bytes. When it holds, `visibilitychange` does nothing and the
  session plays on — backgrounding is what "listening while driving" looks like, not an
  interruption. When it fails, hiding pauses exactly as before **and the standing line says
  which condition failed and where to change it**: a player the user entered expecting a
  music app must not go quiet without a sentence. Where background audio is unconditional
  it says nothing at all — there is nothing to explain. A **real** interruption (a phone
  call, another app taking the session) still pauses, and it resumes by itself only when
  the system says `.shouldResume`. Pulling headphones pauses and never auto-resumes on
  reconnect.
  > **This is the host app, not a browser.** 播客模式 ships zero bytes into the extension
  > (`manifest.json` never lists it), and the app's UI is `app/**` loaded with
  > `loadFileURL` into the app's own web view. "Background" here means *the app went to
  > the background*; Safari and the extension page are not involved on either platform.
- **Lock-screen / car / headset controls are the second surface of the same four buttons.**
  They dispatch the SAME events as the on-screen controls, so the session state machine
  gains no event and no state:

  | Remote | Event | |
  |---|---|---|
  | play / pause / toggle | `tap_resume` / `tap_pause` | shares one helper with the ⏸/▶ button |
  | next track | `tap_next` | |
  | **previous track** | **`tap_repeat`** | there is no "previous card" — 随机 is a one-shot permutation, so going back is undefined. Previous = 🔁 再听一遍 |

  The surface differs per platform — iOS: the lock screen, the car head unit, headset
  buttons; macOS: the keyboard media keys, AirPods, and Control Center's Now Playing
  (there is no lock-screen card on a Mac). The wiring is one `MediaPlayer` code path for
  both.

  **No timeline is published**: three passes over five segments make every scrub bar a lie,
  so seek / skip / position commands are all disabled. What is shown is the card itself —
  原句 large, 译句 under it, `第 i / n 张 · 第 k 遍` below that. That the sentence being
  studied appears on the lock screen (and in Control Center) is the intended behaviour of
  "show the card", stated here so it is agreed rather than discovered.

  **The analysis is read line by line, and the artwork follows it** (2026-08-26). While the
  解析 segment plays, the artwork keeps 原句/译句 where they are and lights up the line being
  spoken — 生词, 短语, 语法, one at a time, current one in full ink behind an accent bar, the
  others dimmed. It is the only place a third line can go: the control row's three slots are
  already 原句/译句/进度, and no lock-screen lyrics API exists. The analysis is split by those
  three blocks rather than by sentence because the block count is bounded and known before the
  text arrives — which is what lets 出发前预载 quote an honest upper bound. An empty block
  produces no line at all: an empty line would be an empty utterance, and that sounds exactly
  like a stall.

  **The artwork IS the card** (2026-08-25). Without one the system draws a placeholder —
  which is what the Dynamic Island's "question mark" was. The artwork is drawn from the
  live card, in the app's own card typography scaled up with its 21:19:12 ratio intact, in
  the system's light or dark palette. It exists because the control row is one truncating
  line and our sentences are long: **the artwork is the only place a long sentence can
  actually be read.** It carries no pass number — it is drawn once per card while the pass
  changes within one, and a lock screen must not display a sentence that stops being true
  a few seconds later; the pass belongs to the control row, which follows the segment. A
  card with no translation lets the 原句 grow into the space rather than leaving a hole.
  At small sizes (the Dynamic Island's ~24pt slot) the system is handed the **app icon**
  instead — a sentence is unreadable there, and being recognisable is the whole job of
  that slot.
- **开卡即并行，并前瞻一张**（2026-08-23，learning-design §9.5）: opening a card fires
  every network call that card needs at once — 原句音频 / 译句音频 / 解析，and the
  notes audio the moment the notes text lands — then warms the NEXT card's 原句/译句
  audio only. Not its notes: audio already in cache costs nothing extra, a notes call
  for a card the user quits before hearing is money spent on nothing. **Playback never
  translates on the spot**: the 译句 comes from `item.tr`, else a cached 补译文, else
  the card reads 原句 three times as it always did.
- **「出发前预载」 in settings**（2026-08-23）: one button that fills the local cache
  for 今天的牌库 + 未来 N 天 so a whole session plays with no network. It is the one
  sanctioned batch, and it wears all four conditions on the surface: **the first tap
  only prices it** (「N 张卡 · 待合成 P 段音频 · 待解析 M 张 · 待补译文 K 张」, no
  request sent), the second tap spends, 停止 works throughout, and it closes with a
  named tally including failures. A `returnsAudio: false` engine (设备内置语音, the
  default) says plainly that it produces no audio cache and is already offline, rather
  than showing a progress bar that can never move. Engine not configured ⇒ the price
  line names what will be skipped and where to configure it — the 10d′ rule again.
  预载写入的只有缓存: no review row, no skill stamp, no `lastSeenAt`, no scheduler call.


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
  always **user-initiated** — never automatic. *(2026-08-23: this line used to end
  「never bulk, never automatic」. Bulk was never the disease; a bill the user cannot
  see is. A batch is allowed when it meets all four of learning-design §9.2's
  conditions — price it first, spend on the second tap, stay stoppable, report by
  name. 「出发前预载」 below is the ONE place that holds, and it stays the only one:
  a second feature wanting this exception goes back through domain review rather than
  asserting it also meets the four.)*
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
