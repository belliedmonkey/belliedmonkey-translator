# Regression tests — manual / device scenarios (手动回归清单)

This file is the **MANUAL / browser / device** regression checklist for
「大肚猴翻译 / BelliedMonkey Translator」. It covers everything a user actually
*sees and touches*: FAB, in-player 译 button, overlays, menus, localized notices,
layout on real pages.

It is deliberately **not** a substitute for the automated suite. The automated
suite (`npm test`, files under `test/`) covers **pure logic** — the subtitle state
machine / translate-ahead engine, cue merge into sentences, i18n locale resolution,
and provider request-building. Pure functions are **not** re-covered here.

> **How to run these scenarios is governed by
> [`verification-spec.md`](verification-spec.md)** — the single source of truth. In
> short: run `npm test` (logic) **and** the relevant sections below on **every adapted
> surface** (iPhone + iPad Simulator; macOS Safari/Chrome/Firefox on the real Mac,
> sandboxed) before every push. Every UI/visual item MUST be verified with a
> **screenshot of the built + loaded extension** (a DOM element existing is NOT proof
> the user sees it — the `.mt-yt-dual` element was once present but clipped invisible);
> behavior-over-time bugs need a **recording**. Drive surfaces via **cua-driver only**.

Every item cites the [`interaction-spec.md`](interaction-spec.md) rule it enforces.
Markers referenced: `#mt-fab` (FAB), `#mt-yt-btn` / `#mt-yt-overlay` (YouTube),
`#mt-pod-overlay` (podcast), `.mt-translation` (webpage bilingual line).

---

## 1. Controls & activation

- [ ] **FAB default-OFF on load.** Load any normal page (e.g. a Wikipedia article).
  Steps: fresh load, do nothing. **Expected:** `#mt-fab` is present but inactive
  (no `mt-fab-active`); **nothing is translated** until tapped; a refresh re-starts
  OFF (no persisted auto-start). *(Spec: Webpage "Off by default"; content-main
  `enabled:false`.)*

- [ ] **FAB toggles page text.** Steps: tap the FAB on → off. **Expected:** on =
  bilingual `.mt-translation` lines appear under paragraphs and FAB title flips to
  `关闭翻译`; off = translations removed, title back to `开启翻译`. *(Spec: Webpage
  bilingual — FAB turns it on per page load.)*

- [ ] **In-player 译 button toggles VIDEO subtitles independently.** On
  `youtube.com` desktop: toggle the terracotta 译 button's `开启视频字幕翻译 / 关闭视频字幕翻译`.
  **Expected:** only the `#mt-yt-overlay` subtitles change; page text (title /
  description / comments) is unaffected; and toggling the FAB does not change the
  video subtitles. *(Spec: YouTube "Two independent controls" — 译 = video, FAB =
  page text, they never affect each other.)*

- [ ] **Mobile `m.youtube.com` FAB drives BOTH.** On the iOS Simulator, load an
  `m.youtube.com/watch` video. Steps: tap the FAB. **Expected:** the FAB turns on
  **both** page text and video subtitles; there is **no** separate in-player 译
  button (no control bar to host it). *(Spec: YouTube Controls & activation — on
  `m.youtube.com` the page FAB drives the video subtitles; content-main
  `isMobileYouTube`.)*

- [ ] **Embed = subtitles only, no FAB / no page text.** Load a page with a
  third-party YouTube `embed` iframe. **Expected:** the terracotta 译 button appears over
  the embed and controls subtitles; **no** `#mt-fab`, **no** `.mt-translation` on
  the host page. *(Spec: content-main `isEmbed` → `YouTubeTranslator.init` only.)*

---

## 2. Webpage bilingual translation

- [ ] **Bilingual line injected under each paragraph.** FAB on, scroll a text page.
  **Expected:** each paragraph keeps the original above and a `.mt-translation`
  sibling below, in the configured color (default from build/palette.config.js — sage, dark-mode light step).
  *(Spec: "injected under each original paragraph" + Universal "Interleaved,
  paragraph by paragraph".)*

- [ ] **Font matches the ORIGINAL element exactly.** On a page with mixed type
  (large serif heading, italic hatnote, body, bold caption — e.g.
  `en.wikipedia.org/wiki/Giant_panda`). **Expected:** each translation copies the
  original's computed `font-family / font-size / font-weight / font-style /
  line-height / letter-spacing`; a bold heading → bold heading-sized translation,
  caption → caption. **Only color** is distinct. *(Spec: Universal "Font matches the
  original exactly".)*

- [ ] **「字号」 = relative scale, default 1.0×.** Set 字号 to default (1.0×) then
  0.8× / 1.25×. **Expected:** at 1.0× the translation is identical size to the
  original; the scale multiplies all translations up/down; legacy unit values migrate
  to 1.0×. *(Spec: Universal "字号 setting is a relative scale … default 1.0×".)*

- [ ] **Incremental fill + placeholder.** FAB on, watch a long page. **Expected:**
  each viewport paragraph shows `⏳ 翻译中…` until its translation arrives (viewport
  first, lazy for the rest); ≤5 translate in parallel. *(Spec: Webpage "Paragraph by
  paragraph" + concurrency cap 5.)*

- [ ] **Error + retry.** Force a provider failure (e.g. bad API key). **Expected:** a
  failed paragraph shows a clickable `⚠️ 翻译失败,点此重试`. *(Spec: Webpage "Error +
  retry".)*

- [ ] **No double-translation on re-run.** Toggle FAB off→on, or let the ~1s
  recollect poll run. **Expected:** paragraphs already marked `data-mt-processed` are
  not translated / appended twice (idempotent). *(Spec: Webpage "Idempotent (never
  duplicate if injected twice)".)*

- [ ] **SPA re-renders don't cluster / duplicate translations.** On a
  React/Vue-driven feed that re-renders its article container in place
  (`latent.space` and other Substack posts; scroll the whole article, wait a few
  seconds). **Expected:** every translation stays glued **immediately below its own
  paragraph** (interleaved 中/英), never drifting into an English block followed by a
  Chinese block at the container end, and no paragraph gets **two** translations.
  Verify in DevTools: `document.querySelectorAll('.mt-translation').length` equals the
  translated-paragraph count (no duplicates), and no run of adjacent `.mt-translation`
  siblings with no original between them. *(Fix: translations are tracked on
  `node.__mtTrans`, re-anchored after their node each tick, and orphans removed when the
  SPA replaces a node — content-webpage `ensureSibling` / `tick` re-anchor / `recollect`.)*

- [ ] **Clicking body text produces NO visible action — RECORDING required.** On a
  Substack article (`lennysnewsletter.com/p/…`) with page translation on and settled,
  click article paragraphs several times while **recording the screen**. **Expected:**
  zero visible flash, layout jump, or remove→re-add blink — frame-by-frame, no frame
  differs around the click (Substack's React MOVES article nodes on click; the
  MutationObserver re-anchor pass must fix ordering pre-paint). *(Spec: Webpage "SPA
  re-renders never visibly disturb the page"; content-webpage `reanchorAll` +
  `onDomMutations`.)*

- [ ] **Mobile flex/grid rows don't overlap.** On `m.youtube.com` metadata
  (`次点赞 / 观看 / 年前`), the top nav, comment counts. **Expected:** each translation
  takes its **own full-width line** below the item (flex → `flex-basis:100%` + row
  wraps; grid → spans all columns) — no inline overlap or horizontal spill. *(Spec:
  Webpage "Flex / grid rows: translation takes its own full-width line".)*

- [ ] **Only-visible text is translated.** On a page with a collapsed vs expanded
  description / `display:none` nodes. **Expected:** hidden text is not translated
  (computed-style visibility gate). *(Spec: Webpage "Translate only what's visible".)*

- [ ] **Disable removes translations.** FAB off. **Expected:** all `.mt-translation`
  removed and any flex `flex-wrap` mutation reverted. *(Spec: Webpage disable;
  content-main `WebpageTranslator.disable()`.)*

---

## 3. YouTube dual subtitles

- [ ] **译 button is one consistent terracotta circular widget everywhere.** Compare
  `youtube.com` desktop, `youtube.com` touch / Request-Desktop, and a third-party
  embed. **Expected:** identical always-visible terracotta circular floating `#mt-yt-btn`
  labelled `译` — **not** mounted in YouTube's auto-hiding control bar. *(Spec:
  YouTube "The 译 button is one consistent widget everywhere".)*

- [ ] **译 button position.** **Expected:** on `youtube.com` it sits **above** the
  page FAB (`bottom:150px`); in an embed (no FAB) it sits at the corner
  (`bottom:10px`); the menu anchors just above the button. *(Spec: YouTube Controls &
  activation position rules.)*

- [ ] **Whole transcript up front + 60s translate-ahead, no lag.** Enable subtitles,
  play, seek forward. Use a slow provider (e.g. DeepSeek). **Expected:** display is
  driven by `video.currentTime` from a pre-fetched full transcript; no per-caption
  translation lag even with a slow LLM. *(Spec: YouTube "Fetch the whole transcript
  up front, then translate-ahead" — core constraint.)*

- [ ] **Whole sentences, not word-by-word.** **Expected:** the original line is a
  complete merged sentence (not YouTube's word-by-word rollup), and the original +
  translation lines appear at the same time. **Never** word-by-word. *(Spec: YouTube
  "Whole sentences, together" + "Sentence merge".)*

- [ ] **`⏳ 译文准备中…` never recurs in steady playback.** Watch through a stretch of
  steady playback after load. **Expected:** the loading hint may show briefly before
  a sentence is ready and then auto-swaps; it does **not** recur / stick during steady
  playback. *(Spec: YouTube Loading state + core constraint.)*

- [ ] **Overlay fixed + centered, doesn't follow cursor/controls.** Move the mouse,
  show/hide controls, fullscreen. **Expected:** `#mt-yt-overlay` stays at a constant
  `bottom:11%`, horizontally centered, and does **not** move when the cursor moves or
  controls appear; YouTube's native `.ytp-caption-window-container` is hidden
  (`opacity:0`). *(Spec: YouTube Layout — Fixed position + Centered + Self-rendered
  overlay.)*

- [ ] **Max 1 line per language, measured paging.** Play a video with long captions
  on desktop and narrow mobile widths. **Expected:** each language line is capped to a
  single line (measured at current width, not a fixed char count); long text pages
  through 1-line pages over the sentence's span; width cap ~82%. *(Spec: YouTube
  Layout — "Max 1 line per language" + "Width cap".)*

- [ ] **双语 / 仅译文 / 仅原文 modes.** Cycle the menu's `字幕显示类型`. **Expected:**
  双语字幕 shows both lines (current mode checked); 仅译文 hides the original line; 仅原文
  hides the translation line. *(Spec: YouTube "In-player control button + menu".)*

- [ ] **下载字幕 (.srt).** Pick each mode, then `下载字幕 (.srt)`. **Expected:** a
  `.srt` downloads containing bilingual / translation-only / original per the current
  mode; if nothing is ready yet, the `字幕还没准备好…` alert shows. *(Spec: YouTube menu
  "下载字幕 (.srt)".)*

- [ ] **Ad playback suppresses the overlay.** During a pre-roll / mid-roll ad.
  **Expected:** no subtitle over the ad (`#movie_player` `ad-showing` /
  `ad-interrupting`, and the ad's `currentTime` ≠ transcript). *(Spec / device-verif
  (b): ad suppression.)*

- [ ] **`字幕不可用` when no transcript.** Load a video with no caption track (or a
  blocked fetch). **Expected:** a single-line `字幕不可用` notice in the overlay —
  **never** a silent regression to word-by-word live-caption translation. *(Spec:
  YouTube "Requirements / fallback".)*

- [ ] **Safari acquisition via Resource Timing observer.** On the iOS Simulator,
  enable subtitles. **Expected:** captions auto-enable (YouTube toast
  「已启用字幕…」), the pot-bearing `/api/timedtext` URL is read from the Resource
  Timing API and re-fetched (no `world:MAIN`, no pot-blocked `baseUrl` fetch), and
  matched whole-sentence pairs advance with playback. *(Spec: YouTube Source & timing;
  device-verif (b).)*

---

## 3.5 x.com / Twitter in-tweet video subtitles

Markers: `#mt-tw-overlay` + `.mt-tw-orig`/`.mt-tw-trans` (overlay), `#mt-tw-btn` (译).

- [ ] **译 button embedded INSIDE the video component.** Desktop x.com status page with a
  video. Enable subtitles. **Expected:** the terracotta `译` button sits **inside the active
  video's player container** (top-right corner), NOT floating fixed at the page's
  bottom-right. *(Spec: domain-design §5 Twitter control placement; §2.3.6.)*

- [ ] **Whole-sentence bilingual pairs advance with the clock.** Play. **Expected:**
  matched original (white) + translation lines appear together over the video, advancing
  with playback; **never** word-by-word. HLS→VTT: master `.m3u8` (Resource Timing
  observer, not pot-locked) → `#EXT-X-MEDIA:TYPE=SUBTITLES` → `.vtt` segments. *(Spec §2.3.)*

- [ ] **`字幕不可用` when the video has no SUBTITLES track.** **Expected:** single-line
  `字幕不可用` notice — a first-class, common outcome, never an ASR/word-by-word fallback.
  *(Spec §2.3.1.)*

- [ ] **Multi-video: control + overlay follow the ACTIVE video, with hysteresis.** A feed
  (or thread) with two videos. **Expected:** exactly one `译` + one overlay, bound to the
  playing / most-visible video; scrolling/switching moves them to the new active video;
  two comparably-sized videos do **not** flip the overlay every ~250ms tick. *(Spec
  §2.3.5; `activeVideo()` AREA_MARGIN 1.3× stickiness.)*

- [ ] **⭐ Fullscreen keeps bilingual subtitles (Chrome + Safari) — mandatory.** Play,
  click X's fullscreen button. **Expected:** `#mt-tw-overlay` stays **inside** the
  fullscreened player and the bilingual pairs keep advancing (overlay re-parented into
  `document.fullscreenElement`); exiting fullscreen restores the inline overlay. Run on
  **macOS Chrome AND macOS Safari** (Firefox too if applicable). *(Spec §2.3.6;
  verification-spec §1 mandatory fullscreen matrix. If X fullscreens a raw `<video>` on a
  given browser — no DOM child possible — record it honestly, do not fake a pass.)*

- [ ] **双语 / 仅译文 / 仅原文 + 下载字幕 (.srt).** Via the 译 menu, same as YouTube.
  **Expected:** modes switch; `.srt` downloads the merged sentences. *(Shared harness.)*

---

## 4. Podcast bilingual subtitles

- [ ] **Web podcast with existing timed transcript (Substack).** Load
  `lennysnewsletter.com/p/…` (in-page CloudFront-signed `en.vtt`), FAB on, play.
  **Expected:** VTT resolves (cross-origin content-script fetch, **no**
  `credentials:'include'`), merges to sentences, and `#mt-pod-overlay` shows matched
  bilingual pairs synced to `audio.currentTime`, viewport-anchored bottom-center. The
  floating 译 control menu (双语/仅译文/仅原文, 下载.srt, 设置) renders. *(Spec: Podcast
  Source & timing + Layout + Controls.)*

- [ ] **Video-only Substack post with transcript translates.** Load a Substack VIDEO
  post that has NO `<audio>` element but a transcription (e.g.
  `terroirchampagne.substack.com/p/marissa-ocasio-on-the-us-champagne`), FAB on, play
  ≥30s. **Expected:** the 译 button mounts, `#mt-pod-overlay` shows a single advancing
  bilingual pair, and the resolved `.vtt` belongs to the MAIN video (its URL shares the
  upload-id path segment with the `<video>` src — not a sidebar recommendation's vtt).
  *(Spec: Podcast "Video posts are peers of audio"; gate `drivesPodcast()` +
  `hasTranscriptHint()`.)*

- [ ] **AI 转写字幕 (domain-design §2.4) — the offer is user-initiated, never automatic.** On a
  podcast page with NO timed transcript (a Transistor / Megaphone-hosted episode page, or
  a LibriVox chapter on archive.org): with a transcription engine configured, the
  `字幕不可用` notice carries a 「🎙 AI 转写字幕」 button and NOTHING is fetched or sent before
  it is tapped (check the network log). Tap → 「⏳ 正在转写整段音频…」 → within ~20 s the
  bilingual pair follows playback, one upload per ≤ 6 MB slice, no per-sentence requests to
  the STT endpoint. With no engine configured the button reads 「先在设置里选择转写引擎」 and
  opens settings. A decorative `<video>` still surfaces nothing (below); the popup's
  「🎙 实时转写 + 翻译」 row is the only entry there and (since 2026-09-11) is shown whenever
  the page has any media element — inside open shadow roots too, metadata loaded or not;
  with no element found the row stays and says 「没找到正在播放的视频/音频」 rather than
  disappearing. The in-notice offer appears from the first failed acquire (≈ 2.5 s).
- [ ] **AI 转写字幕 — live tier stops are visible, never silent.** On a YouTube video with
  captions disabled (MSE ⇒ live tier): tap the offer → 「● 实时转写中」 → the overlay shows
  words as they are spoken with a provisional translation ending in `…`, and the
  bottom-right 「字幕历史」 panel gains a row per closed sentence with its whole-sentence
  translation (the two are NOT expected to match word for word — the panel is the
  corrected record); the 译 menu shows 「字幕历史面板」, 「边说边译」 and 「停止转写」.
  Turning the panel off makes the overlay hold each closed sentence ≈ 6 s. Then: mute the
  page's audio source at the OS level does NOT stop it (element unmuted, capture unaffected),
  but a Substack episode (no CORS on its CDN) must show 「无法读取该音频」 within 10 s, a
  changed transcription engine in settings must show 「转写引擎已更改，已停止转写」, and
  navigating to another video must end the session (no automatic restart, the offer is back).
- [ ] **Decorative videos never surface subtitle UI.** On an ordinary page with a
  hero/background/autoplaying `<video>` and no transcript source, FAB on. **Expected:**
  page text translates; **no** 译 button, **no** `字幕不可用` bar, no `#mt-pod-overlay` —
  ever. *(Spec: Podcast "Video posts are peers of audio" — transcript-hint gating.)*

- [ ] **Native `<track>` captions suppressed while our overlay drives.** On a video
  post whose media has a subtitle `<track>`, force it on before enabling us (WebKit
  does this automatically per system caption prefs; on Chrome simulate with
  `video.textTracks[0].mode='showing'` — the native caption line appears). FAB on,
  play. **Expected:** within a tick (≤250ms) the native caption line disappears —
  ONLY `#mt-pod-overlay` shows subtitles (one display at a time). Turn translation
  off → the native captions come back (original track mode restored). *(Spec:
  Podcast "One subtitle display at a time".)*

- [ ] **Substack caption rows / transcript panel are never webpage-translated.** On a
  Substack video post with the player's Subtitles ON (Substack settings menu →
  Subtitles → English; auto-on on WebKit), FAB on. **Expected:** 0 `.mt-translation`
  and 0 `data-mt-processed` inside the marked shell (`[data-mt-player-region]`) — no
  translation lines inside the caption box or transcript scroller, no `⏳翻译中…` churn.
  *(Spec: Podcast "Adapter-marked player regions"; domain-design §3.)*

- [ ] **Player-drawn caption box hidden while our overlay drives.** Same setup, play.
  **Expected:** Substack's own caption box (text = current cue, overlapping the video)
  disappears while our overlay shows the pair; a desktop transcript SIDEBAR (not
  overlapping the video) stays visible. Turn translation off → the box returns.
  *(Spec: Podcast "player-DRAWN caption layers".)*

- [ ] **`⏳ 字幕加载中…` while fetching.** **Expected:** shown dimmed while
  fetching/parsing, then auto-swaps to the bilingual pair — never a stuck line.
  *(Spec: Podcast Loading / fallback.)*

- [ ] **No subtitle UI while the media is not playing.** FAB on with the post's video
  NEVER started (paused at 0:00). **Expected:** no `⏳ 字幕加载中…`, no `字幕不可用`,
  no subtitle pill/black box anywhere on the page (译 button may show). Press play →
  the loading notice / bilingual pair appears; pause again mid-sentence → an
  already-shown pair may remain, but a notice never re-appears while paused.
  *(Spec: Podcast Loading / fallback — playback-gated notices.)*

- [ ] **Own UI is never re-translated by the webpage path.** With BOTH page text and
  podcast subtitles on, play ≥30s. **Expected:** `#mt-pod-overlay` contains exactly its
  two line divs — `document.querySelectorAll('#mt-pod-overlay .mt-translation').length
  === 0`, no `data-mt-processed` inside the overlay, no duplicate `字幕加载中` chip, no
  stale old-cue fragments stacking above the current pair. Repeat on a YouTube watch
  page with video subtitles + page text both on:
  `document.querySelectorAll('#mt-yt-overlay .mt-translation').length === 0` and no
  `data-mt-processed` inside `#mt-yt-overlay`. Same for `#mt-fab`, 译 buttons/menus.
  **Idle check:** after everything settles, stay hands-off ~10s — the tab's CPU stays
  flat and translations don't twitch (the SPA observer must not self-trigger on our own
  renders). *(Fix: every injected UI root sets `translate="no"`, honored by dom-processor
  `hardSkip` — without it the segmenter injects font-matched translation siblings INSIDE
  the fixed overlay, which grows upward from bottom:8% into the article.)*

- [ ] **Apple Podcasts + 小宇宙 = text-only floor, NO `字幕不可用` bar.** Load
  `podcasts.apple.com` and a `xiaoyuzhoufm.com` episode, FAB on. **Expected:** only
  the page-text FAB translation appears (title/author/description, font-matched);
  **no** 译 subtitle control and **no** `字幕不可用` bar. *(Spec: Podcast "Known
  text-only hosts → no subtitle overlay at all"; content-main `isTextOnlyPodcast`.)*

- [ ] **Spotify Read-along scraped + synced.** Load an `open.spotify.com` **episode**
  that has a 转录 transcript, FAB on, play. **Expected:** the 转录 tab is activated once,
  cues scraped from the button + `m:ss` timestamp rows, and the overlay tracks the
  **progress-bar `aria-valuenow` (ms)** — not the MSE `<video>.currentTime`. Music /
  playlist pages and transcript-less episodes stay text-only (the latter show
  `字幕不可用` after resolve retries). *(Spec: Podcast "Spotify — synced Read along".)*

- [ ] **Spotify native transcript hidden while translating, restored when off.** FAB
  on. **Expected:** the scraped cue-list div goes `display:none`
  (`data-mt-native-hidden="1"`) so English isn't shown twice; FAB off restores it
  (`display:block`); overlay removed. *(Spec: Podcast "While translation is on,
  Spotify's own transcript panel is hidden".)*

- [ ] **Spotify tab bar stays usable.** With translation on. **Expected:** the
  简介 / 转录 / 章节 tab bar remains visible and clickable (only the list div is hidden,
  never the wrapping section). The creator's burned-in on-video captions are left
  untouched. *(Spec: Podcast Spotify — tab bar stays usable.)*

---

## 5. Interface language / i18n

- [ ] **uiLang default = follow OS.** Fresh install, OS locale set (e.g. system
  Chinese vs English). **Expected:** popup/options, FAB tooltip, in-player menu, and
  notices show in the OS locale (`uiLang:'auto'`). *(Spec: Interface language —
  "Default = follow the OS/system locale".)*

- [ ] **User override in BOTH popup and options.** Change 「界面语言」 in the popup, then
  in the options page. **Expected:** both expose the selector (mirroring 「目标语言」);
  selecting a locale (e.g. English) re-localizes **live, no reload**; content-script
  notices pick up the new language on the next render. *(Spec: Interface language —
  override in both, applies live.)*

- [ ] **All subtitle / notice states localize.** With a non-Chinese UI language,
  trigger each state. **Expected:** `⏳ 译文准备中…`, `⏳ 翻译中…`,
  `⚠️ 翻译失败,点此重试`, `⏳ 字幕加载中…`, `字幕不可用` all render in the UI language.
  *(Spec: Interface language — "every subtitle/notice state … in the UI language".)*

- [ ] **Brand names + endonyms stay verbatim.** Any UI language. **Expected:**
  language-picker endonyms (简体中文 / English / 日本語 …) and brand names (ChatGPT
  (OpenAI) / Claude (Anthropic) / DeepSeek / 智谱 GLM) are **not** translated. *(Spec:
  Interface language — "two deliberate exceptions shown verbatim".)*

- [ ] **UI language ≠ target language.** Set 界面语言 = English but 目标语言 = 中文.
  **Expected:** chrome is English while pages still translate into Chinese — the two
  are independent. *(Spec: Interface language — "UI language ≠ target language".)*

- [ ] **Version / about line localizes.** Open options → about/version line.
  **Expected:** it renders in the UI language (brand name stays verbatim). *(Spec:
  Interface language — all user-visible strings localized.)*

---

## 6. Providers

- [ ] **Google free = default.** Fresh install, no key. **Expected:** provider is
  `google` and translation works with no API key. *(CLAUDE.md provider table;
  content-main `provider:'google'`.)*

- [ ] **Every keyed provider in the flavor, with an API key.** For each entry in
  `build/providers.config.js` whose `needsKey` is set and whose `flavors` include
  the build under test: set provider + key in options, translate a page and a video.
  **Expected:** each returns translations, and the options page's hint + model
  placeholder both show that entry's `defaultModel`. Do **not** hardcode the model
  names in this checklist — the registry owns them (`docs/domain-design.md` §7), and
  a copy here is one more consumer that drifts. *(This is how the stale
  `deepseek-chat` hint survived a model rename.)*

- [ ] **Custom endpoint URL.** For each entry with `supportsBaseUrl`, set `apiBaseUrl`
  to a COMPLETE request URL (path included).
  **Expected:** the request goes to exactly that address — nothing appended, trailing
  slash preserved. Read the address back off the 「测试连接」 result line, which echoes
  the URL actually requested.
- [ ] **Responses vs Chat Completions on one host.** Point the endpoint at
  `…/v1/responses` and translate.
  **Expected:** the request body carries `input` + `instructions` (not `messages`), and
  translation still works. Switch the address back to `…/v1/chat/completions` and it
  returns to the Chat Completions shape — the ADDRESS is what chooses, nothing else.
- [ ] **Upgrade drill (do this on a profile that predates 1.5.3).** Install the old
  build, fill all four endpoint fields with host-only values, then install this build.
  **Expected:** each transport requests the host-only address **verbatim** and fails
  with a NAMED error whose line echoes that exact URL — no path is appended, and no
  stored value is rewritten. This is the accepted cost of unconditional zero
  concatenation (domain-design §7); the failure must be loud and the address visible,
  which is what makes it one edit to fix.
- [ ] **A complete address survives a settings reload.** Save a complete endpoint whose
  shape we do not recognise (e.g. `…/api/openai/v1`), close the settings page, reopen it.
  **Expected:** the field still shows exactly what you typed. The 1.5.2 migration
  appended a path here on every reload — a correct configuration corrupted by a
  mechanism meant to protect stale ones.
- [ ] **A rejected body says which field.** Point a chat endpoint at a model that
  refuses `temperature` or `max_tokens` and press 「测试连接」.
  **Expected:** the result shows our hint AND a second line 「服务端原话：…」 quoting the
  server verbatim — one request, one failure, no silent retry. (Before #159 this
  case was expected to self-heal on a second attempt; that mechanism is gone, so a
  second request here is now itself the bug.)
- [ ] **An unknown endpoint gets the minimum body.** Configure a gateway on a domain
  that is not in `build/model-params.config.js` and translate a page.
  **Expected:** it works, and DevTools → Network shows a request body of exactly
  `{model, messages}` — no `temperature`, no `max_tokens`. This is the case that made
  a real corporate gateway return 400 for a whole day.
- [ ] **The table wins over the panel, visibly.** Open 高级参数, set 随机度 to 0.9,
  then set the model to one the table marks as refusing it (e.g. an `api.openai.com`
  reasoning model). **Expected:** the input greys out and the line under it says the
  parameter will not be sent. Silently dropping it is the failure this line prevents —
  the server never complains about a parameter it did not receive.
- [ ] **Host-only address is named, not blamed on CORS.** Put `https://api.deepseek.com`
  (no path) in the field and press 「测试连接」.
  **Expected:** 「这个地址只有主机名，没有接口路径」 — NOT the CORS/unreachable copy.
- [ ] **Provider switch re-translates active content.** With page text (and video
  subtitles) on, change provider in the popup. **Expected:** the storage change fires
  and active content re-translates via the new provider (no full reload). *(content-main
  `chrome.storage.onChanged` → `updateSettings`.)*

---

## 7. Cross-platform / Safari iOS specifics

- [ ] **Double-injection guard.** On iOS Safari, where content scripts may inject
  twice per frame. **Expected:** the second run bails (`window.__mtMainLoaded`) — no
  duplicated translators, no paragraph translated/appended twice. *(content-main
  re-entry guard.)*

- [ ] **Service-worker-undefined-after-lock → fetch stays in content script.** On iOS
  Safari, lock the device, unlock, then translate. **Expected:** translation still
  works — all API `fetch()` runs in the content script; the SW is only storage/badge.
  *(CLAUDE.md "Critical Safari iOS Bug".)*

- [ ] **Per-site permission resets to "ask" on fresh install.** Fresh install / app
  upgrade. **Expected:** the `<all_urls>` per-site grant is reset to *ask*; content
  scripts don't inject (no FAB) until you complete **始终允许… → 在此网站上始终允许** and
  restart Safari. *(device-verif Gotcha — Safari per-site permission.)*

- [ ] **No hot reload — re-Run in Xcode.** After a code change on iOS Safari.
  **Expected:** the change only appears after rebuilding + re-running via the
  build→converter→`xcodebuild (iOS)`→`simctl install` pipeline. *(device-verif iOS
  Safari test pipeline.)*

---

## 8. Build sanity

- [ ] **`node build.js` produces dist/ + zip.** Run it. **Expected:** `dist/`
  populated and `belliedmonkeytranslator.zip` created; build validates and passes.
  *(CLAUDE.md Build; AGENTS.md Build & run.)*

- [ ] **Icons are real PNGs.** **Expected:** `extension/icons/*.png` are genuine PNGs;
  the build **fails** if any is SVG renamed to `.png`. *(AGENTS.md "Icons … build
  FAILS if they aren't genuine PNGs".)*

- [ ] **`node build.js firefox`.** Run it. **Expected:** `dist-firefox/` +
  `belliedmonkeytranslator-firefox.xpi` produced. *(AGENTS.md Build & run.)*

## 9. App host — 引导 · 账号 · 额度 · 听面 · 语音包（矩阵行 6/7/9；国际版 + 中国版双跑）

> **为什么有这一节（2026-09-29）**：App 宿主（iPhone/iPad/Mac）此前没有任何成文的手工场景——
> 场景散在 verification-spec 的执行记录里，中国版 App 甚至从未在模拟器/真机上走过引导。
> 本节是 App 侧的逐项清单；扩展侧引导页不在此（`test:onboard` + §1–5 已覆盖）。
>
> **证据规约**：视觉项截图；**时序行为录屏**；状态用 XCUITest `evaluateJavaScript` 读回
> （storage / `AppListen._debug().lat` / 桥事件 `tts-start` / `assets-progress`）；遥测走
> `bt_events` SQL（flush：terminate+activate 后等几分钟）。**[H]** = 只能人做（输密码、人耳听声）。
> **双 flavor**：两台模拟器各装一版（§2.0 一机一版）；标注「intl-only / cn-only」的除外，
> 中国版的判据见各项尾注（chips 无 google/openai/claude、无额度话术、遥测零发送 Gate D）。
> 声源一律用播放代替真人（§0.3：Mac `afplay` conv 语料 / 外放英语视频）。

### 9.0 前置（每次开跑前）

- [ ] **两台模拟器各装一版 + 真机国际版 Debug 包。** `bash build-safari.sh global|china` →
  `app:sync` → xcodebuild Debug → simctl / devicectl 装。**Expected:** `dist-app` 与
  `dist-app-china` 都过 `test:app` / `test:app:china`。
- [ ] **重置手段就位。** 全新安装 = 卸载重装；只重置引导 =
  `chrome.storage.local.remove(['onboardSeen','onboardResume','extBannerDoneAt','engineChosen','onboardIntent'])`。
- [ ] **素材与网络。** 播客/听译要学习卡（模拟器 `LearnStore.putItem` 播种带 `text`+`tr`；真机登录同步）；
  语音包下载 china 关 VPN（ModelScope）、intl 走 GitHub（境内需代理，或反向验失败分支）。

### 9.0.1 驱动配方（2026-09-30 模拟器实测踩实；runner 与证据在 `.local/regress-1.19.0/runner/`）

- **驱动方式**：XCUITest 走**无障碍树**（`app.webViews.buttons/staticTexts` 按文案匹配），坐标兜底点击。
  runner 脚本 `run-ob.sh`（单用例 + 卸载重装 + 证据导出）与 `seed-tts.sh`（存储播种）在本 worktree 的 `.local`，
  **不进仓库**——它们是本机驱动件，不是产物。
- **模拟器 locale ≠ flavor**：国际版模拟器也可能是中文 locale（2026-09-30 实测），文案锚点一律**双语匹配**，
  否则「语言不对」会误报成「界面没出现」。
- **容器 label 会把子元素文案拼起来**：`CONTAINS firstMatch` 可能命中容器，tap 落点滑到邻居（中国版「听」那次
  点了没反应、界面停在 welcome）。匹配顺序固定为「按钮·精确 label → 任意·精确 → 按钮·CONTAINS → 任意·CONTAINS」。
- **屏外元素在树里但点不动**：WKWebView 长页里，断言能读到屏外文本，点击前必须先滑动到 `isHittable`
  （`tapAny` 内置最多 8 次 swipeUp）。断言与点击的可见性口径**不是同一件事**。
- **WKWebView 的 `<select>` 驱动不了**（无障碍里只是一个 label=字段名的按钮，点了不出 picker）⇒ 需要「先选引擎」
  才能验的面（语音包等）用**直写 localStorage 播种**绕过：值为 `JSON.stringify(v)` 的 **UTF-16LE**，
  键带 `mt:` 前缀，位置 `…/Library/WebKit/<bundle>/WebsiteData/Default/<hash>/<hash>/LocalStorage/localstorage.sqlite3`，
  **必须在 App 未运行时写**（App 在跑会以内存缓存覆盖）。引擎键：`mt:ttsEngine` = `"device"`。
  播种后 `OB_SKIP_FRESH=1` 跑用例（跳过一次性的卸载重装，保住种子）。
- **快结束的状态不许只盯瞬间**：129 MB 离线模型实测 <30 s 装完，「正在下载」可能一闪而过 ——
  判据写成「见过进度 **或** 已安装」，只有「下载失败」与「一直没动静」才是红。
- **证据**：`XCTAttachment(.keepAlways)` 截图 → xcresult → `xcresulttool export attachments` 导出并按
  manifest 重命名为可读名，每用例一个子目录（`.local/regress-1.19.0/{onboard,deep}/<面>/shots/<用例>/`）。
- **首页「设置」在屏外**：裸点会静默落在首页上，后面所有断言都在错页面跑（2026-09-30 真踩）——
  任何入口点击都走同一套滑动揭示，别在助手函数里写裸 tap。

- **OTP 登录可以全自助**（2026-09-30 跑通 D1/D2/D5/D6）：`generate_link {type:'magiclink', email}`
  返回的 `email_otp` 就是 App 那条路要的码 —— **App 的 verify 用 `type:'email'`，正好接受它**
  （用 `type:'magiclink'` 验会被 403）。三条纪律：①**必须在 App 的「发送验证码」之后铸**（后落的
  token 才有效，先铸会被 App 那次发送顶掉）；②输码前必须先清空字段（WebKit 不会自己清，追加会变成
  `000000<otp>`）；③service key 走 `TEST_RUNNER_OB_*` 环境变量透传（**不进 argv**，别写进命令行）。
- **字段/按钮的定位两招**：`<label for>` 会映射成输入框的无障碍 label ⇒ **按标签找字段**比
  `textFields.firstMatch` 稳（后者会命中屏外的旧字段）；同文案的按钮（验证键与登录链接都叫「登录」）
  用**几何位置**消歧 —— 但键盘会推走布局，**点之前先收键盘**（点页面空白处），否则「字段下 40pt」
  会落到键盘上（2026-09-30 三次失败都出在这）。
- **「未覆盖语言回落具名」怎么确定性触发**（2026-09-30 跑通 D40）：设置页「试听一句」固定说 **en**，
  而离线模型表里 en 是覆盖语言 ⇒ 正常永远走不到回落分支。壳把**已装包**里那一条的
  `lang: 'en', dir: 'piper-en'` 改成 `lang: 'xx'`（包仍是「已安装」⇒ 引擎 ready，只是不再覆盖 en）
  ⇒ 试听必然走回落，行上出现「…用系统语音」（`tts_test_ok_fallback`）。跑完把包还原。
  复习页的 ▶ 与播客模式**不**印这句（只有设置页与听译行会具名）—— 要验那两处得按库序/到期把卡摆好。
- **`-only-testing` 指向不存在的用例会「静默通过」**：xcodebuild 退出 0、xcresult 里
  `result: unknown`、0 个用例 —— 驱动脚本必须回读 `passedTests`（>0 才算过了），否则「测试没跑」
  会被读成「通过」（2026-09-30 真踩，D5 第一次就是这么「过」的）。

### 9.0.2 测试账号与额度造态（全自助，2026-09-30 跑通；驱动件同在上面的 `.local`）

- **会话铸造**：`seed-auth.js` 用 `.local/keys.md` 的 `supabase_test_refresh_token` 续期（**轮转**：新 token 写回
  同槽位），把 `sessionFrom` 形状（`accessToken/refreshToken/expiresAt/email/userId`）写成 `mt:learnAuth`
  （同样 UTF-16LE 直写，App 须先停）。槽位里的 token 全部失效时，可用 **service key 的管理端路径**重铸：
  `POST /auth/v1/admin/generate_link {type:'magiclink', email}` → 拿 `email_otp` → `POST /auth/v1/verify` →
  把返回的 refresh token 写回槽位。此后每次跑都自助，不需要验证码。
- **额度服务端造态/回读**：`grant-state.sh show | fresh | spent <usd>`（service key 走 REST；
  `bt_grants / bt_grant_usage / bt_events` 都可这么读）。
- **复现「首次领取」的必要条件**：**同时** 清服务端行 **和** 客户端 `engineChosen`。只删行不够 ——
  autoClaimGrant 的守卫是「已经配好引擎的不碰」，`engineChosen=1` 时整条领取被跳过，
  界面停在旧状态，**看起来像「领取写坏了」**（2026-09-30 为此查了半小时）。
- **额度卡在快速档**（`详细` 档只显示「一键配置在「快速」里 →」）；断言时先切档。
- **`apiBaseUrl` 写空是设计**（`test/grant.test.js:72`：端点必须写空，留着上一个引擎的地址配新 key 是明文禁止的）——
  「引擎」行据此报「还没填端点地址」不一定是缺陷，先对着测试的期望值核。
- **观察（待裁定）**：客户端余额读的是存储里的 `grantBalance`，刷新只在 claim（领取/改回免费额度）时发生 ——
  服务端把额度用尽后，App 的卡片可能仍显示旧余额直到下一次 claim。是设计还是显示滞后，1.19.0 回归时一并定。

### 9.1 新手引导（App OB：welcome → [signin·后端开] → firstuse → ext）

- [ ] **全新安装·意图「都要」全流程。** 选「读网页 + 听，都要」→ **直送 ext 屏**（跳过
  signin/firstuse）→ 点「在网页上完成设置」收尾。**Expected:** `onboardIntent='both'` 落盘、
  `onboardSeen=1`、首页**挂**扩展横幅、重启不再出引导。（录屏收尾前后）
- [ ] **意图「听」。** **Expected:** 当场收尾（不经 ext）、`onboardIntent='listen'`、首页**无**横幅、重启仍无。
- [ ] **出口「我只要网页翻译」。** **Expected:** 记 `onboarding_done{result:web_only,step:welcome}`
  一条 + `onboard_intent{goal:read}`，**落到 ext 屏继续**；之后收尾**不**发第二条 `onboarding_done`。
- [ ] **登录屏三支。** 邮箱 OTP（发码 [H] 读码 → 登录自动前进一屏）；「先不登录」（只翻页不写登录态）；
  Apple 一键 **[H·真机]**。**Expected:** intl 标题「登录，顺手领一份免费额度」/ cn「登录（可选）」；
  此屏无「以后再设置」。
- [ ] **就地试一句三态。** 无引擎（intl 提额度文案 / cn 提 key 文案，具名不空转）；有引擎真网络
  （译文落结果行 ~2s，「翻这一句」是主行动填色）；离线（具名连不上文案）。(录屏)
- [ ] **「听这一句」。** 未配 TTS 具名错误；配了出声 **[H·人耳]**。
- [ ] **跳过 → 继续设置卡。** 「以后再设置」记屏不写 `onboardSeen` → 卡出现 3 次（横幅让路）→
  第 4 次自动收起（expired）；✕ 当场永久（dismissed）；已配引擎根本不出。
- [ ] **冷启动两支。** 已配引擎 / 已登录 ⇒ 无引导无卡。已登录者登出再进不重弹引导。
- [ ] **flavor 面。** cn：引擎 chips 无 google/openai/claude（有即红）；「免费通道」话术零出现；
  登录屏**无**出境同意框（境内后端）；全程 `tm:queue` 恒空 + SQL 零行（Gate D）。
- [ ] **语言与布局。** zh（模拟器默认）+ en（真机系统语言，期望文案以 `_locales/en` 为准）；
  iPad 布局抽查；系统 Dynamic Type +2 档 welcome 屏主行动完整可见。

### 9.2 登录与注册（含 #335 回归）

- [ ] **OTP 首登即注册。** 新邮箱收码登录。**Expected:** 建号成功、登录态三处一致
  （首页 / 设置账号块 / 复习返回去向）。
- [ ] **验证码错/过期。** **Expected:** 具名文案、可重发、不卡死。
- [ ] **退出重开登录态保持（#335 原场景）。** 正常使用 → 退进程 → 重开。**Expected:** 首页与
  设置页**同答**（都登录）、重启 5 次全一致。
- [ ] **境内后端联通（cn）。** 发码可达、同步成功（`api.belliedmonkey.com`）。
- [ ] **换账号归属闸。** 库属 A、登录 B。**Expected:** `owner_mismatch` 具名 + 两动作
  （换回 / 清除重来），不自动切换。

### 9.3 免费额度（intl-only）

- [ ] **登录即自动领取。** **Expected:** 额度卡变已领、`grant_claimed` 恰一条；二次登录不重复。
- [ ] **额度卡三态与改回。** 未领→已领带余额；用尽（可 SQL 造态）`credit_exhausted` 停机可重试；
  「改回免费额度」先出确认框再覆盖。
- [ ] **用额度真翻一句。** **Expected:** `translate_ok{provider:grant}` ≥1；`translate_fail{grant,timeout}`
  = 0（1.18.0 timeout 熔断不误触发，#475 回归）。
- [ ] **cn 无此路。** 设置页无额度卡、无额度话术，翻译路只有自带 key。

### 9.4 对话 · 实时听译（§9.6）

- [ ] **设备内置转写·对方说。** 播放 conv 语料。**Expected:** 时序四预算（volatile ≤2s · 停顿→final
  ≤1.0s · final→修正+译文 ≤1.0s · 译文→开口 ≤0.5s，`_debug().lat` 时间戳）；先 raw 后修正；语料存
  **修正后**文本；`mic-level.rms` 非恒 0。
- [ ] **「我说」翻面。** 按住说 [H·人声]。**Expected:** 翻面卡归属正确、译文大字在上。
- [ ] **语言对切换。** 底部下拉与设置页同一份；**设备路换语言必须重连**（静默无操作即缺陷）。
- [ ] **TTS 三档。** off（无朗读动作）/ 设备内置语音 AVSpeech / 设备内置朗读 Piper —— 出声 [H·人耳]。
- [ ] **锁屏两验（真机）。** M24（设备 STT 锁屏 60s 续听，时间戳落在锁屏窗内）+ M25-sys（系统语音
  锁屏出声 [H]）。
- [ ] **采集开关。** 开 ⇒ 语料 `k:'conv'`；关 ⇒ 零写入零积压。
- [ ] **中断族具名。** 拒权限（带系统设置路径）/ 戴耳机 / socket 断（已听句子还在）/ 30s 静音 paused。

### 9.5 实时字幕（§9.8；真机为主）

- [ ] **入口门控。** 26 下限那句（`subtitle_need_os` 已删，2026-09-29）；设备路可用时入口在。
- [ ] **真机外放视频出双语字幕。** 离开 App **自动**浮出 PiP 小窗（4:5）、双语滚动、Safari 不暂停。(录屏)
- [ ] **A−/A+ 与历史。** 三档 0.85/1/1.2 到头不动；系统后/前进翻历史，顶部标「历史 · 点前进回到最新」。
- [ ] **⏸ 语义（维持现状裁定）。** ⏸ 连带暂停源视频；结束会话源视频续播。
- [ ] **采集。** `subtitleCapture` 开 ⇒ 语料 `mode:'subtitle'`；关 ⇒ 丢弃并清。
- [ ] **戴耳机具名提示。** 摘下耳机用外放。

### 9.6 播客模式（§9.5）

- [ ] **入口门控与进出。** uiLang 能开口才渲染；返回后首页计数刷新。
- [ ] **播放。** 逐卡念原文/译文、上一曲=再听一遍、进度与跳过；出声 [H·人耳]。
- [ ] **后台/锁屏继续播（双 flavor，A 级）。** Home/锁屏 60s+ 不断 —— **中国版同判据**
  （2026-08-24 裁定：无阉割版）。
- [ ] **锁屏/车机遥控 + 解析跟读。** tap_* 映射；锁屏封面逐行高亮。
- [ ] **补译文。** 无 `tr` 卡联网补上（至多一次/设备，重开不重译）；断网具名失败、正文照念。
- [ ] **预载离线。** 「出发前预载」（今天+未来 N 天）→ **断网**完整播一轮（含前瞻）。
- [ ] **播放器零写入（A 级）。** 播 N 张后 SQL 对账：复习行数不变、无 skill 戳、卡 `lastSeenAt` 不动。

### 9.7 语音包（设备内置朗读离线模型 + STT 资产）

- [ ] **zh 包首下。** 首用自动触发；进度胶囊「正在下载{lang}离线模型 · {pct}%」→ `installed`；
  67MB 量级。**cn 走 ModelScope（关 VPN 直连成功 = A 级**，托管切换的回归点）；intl 走 GitHub。
- [ ] **en 包同上；两包共存按句语言选用。**
- [ ] **失败分支。** 断网/断点 ⇒ `listen_assets_failed` 具名 + 系统/云端出口可见。
- [ ] **sha 不符自动重下。** 篡改安装戳/删半个包 ⇒ 视为未安装重下成功。
- [ ] **非覆盖语言回落。** 如 ja ⇒ 系统语音且**行上具名**（不许无声）。
- [ ] **下载中杀 App 重开。** 状态恢复、不半包假成功。
- [ ] **STT 资产。** `assets-progress{kind:stt}` 同通道可观测（SpeechAnalyzer locale）。

---

## How to run

- **Automated (logic):** `npm test` — runs the pure-function suite under `test/`
  (engine, cue merge, i18n resolution, provider request-building).
- **Manual (this file):** work through the relevant sections on **every adapted surface**
  — **iPhone + iPad** in the Xcode Simulator, and **macOS Safari / macOS Chrome / Firefox**
  on the real Mac (sandboxed) — all driven via **cua-driver only** (never claude-in-chrome).
  The exact per-surface build → install → enable → drive commands and the sandboxing rules
  are in [`verification-spec.md`](verification-spec.md). **Screenshot every visual item**
  on the built + loaded extension (a DOM element existing is not proof the user sees it).

Per [`verification-spec.md`](verification-spec.md), run **both** — and the **full surface
matrix** — before every push.
