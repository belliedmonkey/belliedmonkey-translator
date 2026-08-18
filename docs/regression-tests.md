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
  server verbatim. If the server named a field we send, the retry concedes it and the
  test PASSES on the second attempt (see §7 「请求体协商」); if not, the failure is
  reported unchanged.
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
