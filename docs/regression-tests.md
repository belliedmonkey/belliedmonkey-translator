# Regression tests — manual / device scenarios (手动回归清单)

This file is the **MANUAL / browser / device** regression checklist for
「大肚猴翻译 / BelliedMonkey Translator」. It covers everything a user actually
*sees and touches*: FAB, in-player 译 button, overlays, menus, localized notices,
layout on real pages.

It is deliberately **not** a substitute for the automated suite. The automated
suite (`npm test`, files under `test/`) covers **pure logic** — the subtitle state
machine / translate-ahead engine, cue merge into sentences, i18n locale resolution,
and provider request-building. Pure functions are **not** re-covered here.

**Dev norm (per [`AGENTS.md`](../AGENTS.md)): run BOTH before every push.**
`npm test` (logic) **and** the relevant manual sections below (behavior on the
built + loaded extension).

> **Screenshot rule (per [`AGENTS.md`](../AGENTS.md) and
> [`interaction-spec.md`](interaction-spec.md)):** every UI / visual item below MUST
> be verified with a **screenshot of the built + loaded extension** showing the
> actual rendered result. **A DOM element existing is NOT proof the user sees it**
> (the `.mt-yt-dual` element was once present but clipped invisible by an ancestor's
> `overflow:hidden`). Real captions only render in a **foreground** tab. Drive real
> device surfaces per [`docs/device-verification.md`](device-verification.md). **Dev
> norm: drive any browser / simulator / computer via cua-driver only — never
> claude-in-chrome or other browser/computer-use tools** (both desktop Chrome and the
> iOS Simulator).

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
  `youtube.com` desktop: toggle the green 译 button's `开启视频字幕翻译 / 关闭视频字幕翻译`.
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
  third-party YouTube `embed` iframe. **Expected:** the green 译 button appears over
  the embed and controls subtitles; **no** `#mt-fab`, **no** `.mt-translation` on
  the host page. *(Spec: content-main `isEmbed` → `YouTubeTranslator.init` only.)*

---

## 2. Webpage bilingual translation

- [ ] **Bilingual line injected under each paragraph.** FAB on, scroll a text page.
  **Expected:** each paragraph keeps the original above and a `.mt-translation`
  sibling below, in the configured color (default green `#0a7a3c` / dark `#4ade80`).
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

- [ ] **译 button is one consistent green circular widget everywhere.** Compare
  `youtube.com` desktop, `youtube.com` touch / Request-Desktop, and a third-party
  embed. **Expected:** identical always-visible green circular floating `#mt-yt-btn`
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

## 4. Podcast bilingual subtitles

- [ ] **Web podcast with existing timed transcript (Substack).** Load
  `lennysnewsletter.com/p/…` (in-page CloudFront-signed `en.vtt`), FAB on, play.
  **Expected:** VTT resolves (cross-origin content-script fetch, **no**
  `credentials:'include'`), merges to sentences, and `#mt-pod-overlay` shows matched
  bilingual pairs synced to `audio.currentTime`, viewport-anchored bottom-center. The
  floating 译 control menu (双语/仅译文/仅原文, 下载.srt, 设置) renders. *(Spec: Podcast
  Source & timing + Layout + Controls.)*

- [ ] **`⏳ 字幕加载中…` while fetching.** **Expected:** shown dimmed while
  fetching/parsing, then auto-swaps to the bilingual pair — never a stuck line.
  *(Spec: Podcast Loading / fallback.)*

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

- [ ] **OpenAI / Claude / DeepSeek / GLM with API key.** For each: set provider + key
  in options, translate a page and a video. **Expected:** each returns translations
  via its adapter (`gpt-4o-mini` / `claude-haiku-4-5` / `deepseek-chat` /
  `glm-4-flash`). *(CLAUDE.md Provider Adapters.)*

- [ ] **Custom base URL for OpenAI-compatible.** Set `apiBaseUrl` for openai /
  deepseek / glm. **Expected:** requests go to the custom endpoint. *(CLAUDE.md
  "Custom base URL … supported for OpenAI-compatible providers".)*

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
- **Manual (this file):** work through the relevant sections on **desktop Chrome**
  (unpacked `dist/`) **and** the **iOS Simulator (Safari)** — both driven via
  **cua-driver only** (never claude-in-chrome), per the standing dev norm and
  [`docs/device-verification.md`](device-verification.md) — build → converter →
  `xcodebuild … (iOS)` → `simctl install` → enable → test. **Screenshot every visual
  item** on the built + loaded extension (a DOM element existing is not proof the
  user sees it).

Per [`AGENTS.md`](../AGENTS.md), run **both** before every push.
