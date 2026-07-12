# Device verification (all platforms) — cua-driver harness

> **⚠️ The normative verification rules now live in
> [`verification-spec.md`](verification-spec.md)** — the single source of truth (the
> full-matrix rule, per-surface build/enable commands, the honesty rules, the
> cua-driver tooling reference). **This file is now the historical device-run log /
> findings archive** below; read it for context and prior evidence, but follow
> `verification-spec.md` for what to do.

The cua-driver setup, driving techniques (AX vs pixel), and the per-surface
build→install→enable→drive pipelines that used to live here have MOVED to
[`verification-spec.md`](verification-spec.md) §2 (surface matrix + commands) and
§6 (tooling reference). Everything below is the dated findings archive.

## Status / findings (2026-06-30)
Harness verified end-to-end: the extension runs + translates on real iOS Safari
(`m.youtube.com`), **including video subtitles**.

- **(a) FIXED — flex/grid-row overlap.** A sibling `.mt-translation` injected into a
  flex/grid row became a flex/grid *item* placed inline next to the original (mobile
  YouTube metadata `次点赞/观看/年前`, header, comment counts) → overlap + horizontal
  spill. Fix: `flowFixCss()` in `content-webpage.js` forces the translation onto its
  own full-width line (flex → `flex-basis:100%` + make the row wrap, recording
  nowrap→wrap for clean revert; grid → `grid-column:1 / -1`). Verified on the sim:
  metadata translations now stack cleanly below each item, no overlap.
- **(b) FIXED — video-subtitle dual rendering on mobile.** Root causes were
  two-fold: (1) the transcript was never acquired on Safari — `yt-hook.js` needs
  `world:"MAIN"` (the converter warns it's unsupported on Safari), so YouTube's
  `/api/timedtext` was never captured; and a direct fetch of the caption-track
  `baseUrl` is **pot-blocked** (HTTP 200, empty body). (2) With no transcript it
  fell back to translating the rolling live caption word-by-word → perpetual
  `译文准备中…`. Fix (see `domain-design.md` §2.1): auto-enable captions so YouTube
  mints a valid pot, read YouTube's own `/api/timedtext` URL from the **Resource
  Timing API** (`performance.getEntriesByType('resource')`, readable from the
  isolated content script), re-fetch the full json3 transcript ourselves, and feed
  the existing 60s translate-ahead engine; the word-by-word fallback was removed.
  Verified on the sim: tapping the FAB auto-enabled CC (YouTube toast
  「已启用字幕（英语 - Default）」) and the overlay showed matched whole-sentence
  pairs that advanced with playback (e.g. "companies and built a lot of products."
  / "您创办了很多公司并开发了很多产品。"), never word-by-word, never a stuck
  「译文准备中…」. Also added: during ads the player's `currentTime` is the ad
  timeline, so the overlay is suppressed while `#movie_player` has
  `ad-showing`/`ad-interrupting` (avoids a mismatched subtitle over the ad).

### User-selectable UI language + webpage font-matching (iPhone 15 sim, iOS 17.2) (2026-06-30)
Verified on the **iPhone 15 sim** via cua-driver after the standard build pipeline
(`node build.js` → safari-converter → `xcodebuild … (iOS)` → `simctl install`). Both
features run in the real extension.

- **PASS — webpage translation font matches the original.** On
  `en.wikipedia.org/wiki/Giant_panda`, FAB on: the large serif heading **Giant panda**
  → **大熊猫** in matching large serif green; the *italic hatnote* → an *italic* green
  translation at the same size; the body lead paragraph → body-sized green text; the
  infobox caption **Giant panda** → a bold green **大熊猫** matching that caption. Font
  family / size / weight / style are copied from the original (`getComputedStyle`);
  only the color stays distinct (green). The 「字号」 setting is now a relative scale
  (default 1.0×). See `interaction-spec.md` "Font matches the original exactly".
- **PASS — user-selectable UI language, live.** The extension popup now shows a
  **「界面语言」** selector next to 「目标语言」, defaulting to **跟随系统** (OS locale).
  The picker lists 跟随系统 + all 11 shipped locales. Selecting **English** re-localized
  the popup **immediately, no reload** — Target language / Interface language /
  Translation engine / View original / More settings / Translated all switched to
  English. Implementation: `chrome.i18n.getMessage` can't be switched at runtime, so
  `t()` consults a bundled `MT_I18N_MESSAGES` table (generated from `_locales/` by
  `build.js`) keyed by the effective locale (stored `uiLang`, or normalized
  `getUILanguage()` when `auto`), then falls back to `chrome.i18n`, then the literal.
  Content-script notices (`译文准备中…` etc.) use the same resolver and follow the same
  setting. See `interaction-spec.md` "Interface language".
- **Note (reinstall gotcha, again):** reinstalling the app kept the Safari extension
  toggle + per-site grant for `wikipedia.org` this time (the FAB injected without a
  re-grant) — unlike some prior runs. Environment-dependent, not a code issue.

### Podcast bilingual subtitles (2026-06-30 — desktop Chrome AND iOS Safari sim)
Verified end-to-end on BOTH surfaces against the Substack podcast page
`lennysnewsletter.com/p/openai-codex-lead-on-the-new-shape` (in-page CloudFront-signed
`en.vtt`).

**Desktop Chrome** (unpacked `dist/`): FAB enables podcast subtitles → the signed VTT
resolves (HTTP 200, **1369 cues** parsed → merged sentences), and the viewport-anchored
overlay shows matched whole-sentence pairs synced to `audio.currentTime` — e.g. at 4s
"Not 90% of engineers, that's…" / "不是90%的工程师，而是整个公司90%的人。", at 30s
"A lot of people seem to like the app." / "很多人似乎都喜欢这个应用。" — advancing with
the clock, never word-by-word. The 译 control menu (双语/仅译文/仅原文, 下载.srt, 设置)
renders.

**iOS Safari (iPhone 15 sim)**: confirmed the SAME flow on-device — FAB activates, the
floating 译 control appears, page text translates (green interlinear), and on playback
the overlay renders the transcript original synced to `audio.currentTime` (e.g. ~1:37 in:
"data analysis, reading your emails, and a…"). Crucially this proves the **cross-origin
content-script fetch of the signed VTT works on Safari** (same host-permission path as
the YouTube timedtext re-fetch) — the credentials fix below was load-bearing here too.
- **Gotcha — Safari per-site permission must be granted as "始终允许在此网站上".** A fresh
  install (or app upgrade) resets the `<all_urls>` per-site grant to *ask*. The auto
  prompt's **允许1天 / 始终允许…** only stick reliably once you complete **始终允许… →
  在此网站上始终允许** and then RESTART Safari (terminate + reopen). Until then content
  scripts silently don't inject (no FAB) — which masquerades as a code bug. Confirmed via
  Settings → Safari → 扩展 → 大肚猴翻译 (允许扩展 ON; site = 允许) and an on-page diagnostic
  banner showing every module loaded (`TC/API/DOM/FB/WP/YT/POD = object`, no error).

Two bugs found ONLY by running it on a real page (invisible to code review):

- **(c) FIXED — credentialed CDN fetch → 503 → `字幕不可用`.** `fetchTimedText`/RSS
  fetch used `{credentials:'include'}`; a CloudFront-signed transcript URL returns
  **HTTP 503** for cookie-bearing requests (the signature already authorizes it).
  Plain `fetch(url)` returns 200. Fix (`content-podcast.js`): drop credentials — the
  default `'same-origin'` still sends cookies for a same-origin `<track>` but never
  to a cross-origin CDN. Confirmed via the network panel (503 vs 200, same URL).
- **(d) FIXED — pager emitted 1-char pages on serif-font pages.** `pageize`
  (`translation-core.js`, shared with YouTube) used a hardcoded `fp*1.3` line-height
  threshold; Substack inherits the serif face **"Spectral"**, whose line box renders
  ~43px vs the 41px threshold, so EVERY line measured "too tall" → binary search
  collapsed to one character per page. Fix: measure an actual one-line height (`'Mg'`)
  in the element's real font and use it as the basis (font-independent; also hardens
  the YouTube overlay).
- **Hardened**: `resolveCues` was one-shot (`resolveTried` latched) — a slow embed or
  transient failure stuck `字幕不可用` forever. Now retries up to 6× every 2.5s before
  giving up.

### Podcast text-only floor — Apple Podcasts + Spotify (iPhone 15 sim) (2026-07-02)
Verified on the **iPhone 15 sim** (podcast branch build) via cua-driver + `simctl
openurl`/`screenshot`. Confirms the `isTextOnlyPodcast` routing (`content-main.js`) and
the webpage-text floor on the two hosts that have no login-free timed transcript.

- **PASS — no subtitle overlay on these hosts.** On both `podcasts.apple.com` and
  `open.spotify.com` only the green **文A** page-text FAB appears — **no** 译 subtitle
  control and **no** `字幕不可用` bar (previously the podcast path resolved to an
  intrusive `字幕不可用`). This matches the spec: Apple / 小宇宙 / (for now) Spotify are
  text-only.
- **PASS — text floor translates (Spotify).** FAB on → title **Lex Fridman Podcast** →
  green **莱克斯·弗里德曼播客**, author → **莱克斯·弗里德曼**, and the full description
  ("Conversations that explore technology, history, philosophy…") → a full green
  translation ("探讨技术、历史、哲学、物理、数学…"), each on its own line, font-matched.
- **PASS — text floor translates (Apple Podcasts).** FAB on → the show title translates
  (green, font-matched). Known cosmetic follow-up: on Apple's specific flex header the
  title's sibling translation renders inline and overflows to the right instead of
  wrapping to its own line (Spotify wraps correctly). Pre-existing WebpageTranslator
  flex-row behavior, not introduced here; tracked as a follow-up.
- **Minor:** Spotify localizes its own chrome to the OS locale (zh), so an already-zh
  heading like 所有单集 gets a redundant same-language "translation". Expected (we don't
  language-detect per paragraph); harmless.

### Spotify "Read along" synced subtitles — live DOM recon + logic validation (2026-07-02)
Done against a **logged-in desktop Chrome** Spotify session (user logged in; agent
operated read-only via the cua-driver `page` tool / CDP `execute_javascript` — no
playback or settings changes). Episode: "Got Somme" wine podcast, which has Spotify's
auto-generated transcript (转录 tab).

Findings (drove `resolveSpotifyDom` / `positionMs` design):
- **Transcript DOM**: only mounts when the episode's **转录/Transcript** tab is active. The
  cue list is a flat `<div>` of ~387 rows: a disclaimer, chapter headers, and per-cue
  **header rows** (a seek `<button>` whose text is `m:ss` + optional `Speaker N`) each
  followed by its **spoken-text rows**. Classes are hashed (fragile) → anchor on the
  button + timestamp pattern. Timestamps are second-granularity.
- **Scraper validated live**: produced **118 clean `{start,end,text}` cues** (multi-line
  segments merged, disclaimer skipped), first at 0 ms, last ≈ 14:41 (matches the ~14:43
  episode length).
- **Position source**: the only media element is a muted, paused blob `<video>`
  (`duration 6.75s`) — MSE, so its `currentTime` is a buffer position, useless. The real
  position is on the **progress-bar slider**: `aria-valuenow` in **ms**
  (`95000` = 1:35, `aria-valuemax = 213929` = 3:33). `positionMs()` reads that on Spotify.
- **Active-cue lookup validated**: at `posMs=95000` the lookup returned the correct cue
  `{93000–128000, "There was a comment on our Instagram…"}`.

Implemented `resolveSpotifyDom()` (auto-activates the transcript tab once, scrapes cues)
+ Spotify `positionMs()`; Spotify removed from `isTextOnlyPodcast` and scoped to
**episode pages only**. All three components (cue scrape, position read, active-cue
match) verified against the live page. **Pending:** the full overlay visual while the
episode plays (needs the new build loaded in the logged-in session).

### Spotify "Read along" — full overlay visual while playing (desktop Chrome) (2026-07-02)
Closes the "Pending" item above. Reloaded the new build into the **logged-in desktop
Chrome** session and drove the episode end-to-end via cua-driver (`page` /
`execute_javascript`; user re-logged-in after a session drop, then approved reload +
play). Episode: "Angus Tries a Portuguese Pinot Noir…" (Got Somme). Screenshot captured.

- **PASS — overlay mounts + plays.** FAB → 开启翻译 flips the FAB title to `关闭翻译`;
  `#mt-pod-overlay` mounts and the transcript scrapes. Playing the episode advances the
  progress bar and the overlay tracks it live (250 ms `tick`).
- **PASS — synced bilingual pairs** (sampled while playing):
  `"I think here it's more about something new,"` → `我觉得这里更多的是关于新鲜事物…`;
  `"even have to make bookings, you just drive,"` → `车过去，停在路边，进去吃午饭就行。当然，那…`.
- **Not a bug — fraction-paged long sentences.** A long merged sentence pages by
  playback time-fraction (`floor(frac × pageCount)`), and EN/ZH paginate at different
  granularities, so a short English tail-page (e.g. `"few drinks."`) lines up with a
  denser Chinese page of the *same* sentence. Matched at the sentence level per spec.
- **Not a bug — white translation line.** Renders `settings.ytTextColor || '#fff'`,
  identical to the YouTube overlay (`lineCss`); default white, user-configurable via
  字幕颜色. Consistent, not podcast-specific.
- **Cosmetic follow-up (tracked, not a regression):** Spotify's *own* Read-Along
  transcript (the karaoke line + 转录 panel) stays on the page while our overlay draws at
  the bottom → overlapping English texts. Inherent to scraping Spotify's transcript
  panel; the feature works, just visually busier than YouTube/Apple. **→ Resolved below.**

### Spotify — hide native transcript while translating (desktop Chrome) (2026-07-02)
Closes the cosmetic follow-up above (`syncSpotifyNativeUI`). Verified live in the
logged-in Chrome session (reload picks up the content-script edit from `dist/`), driven
via cua-driver `execute_javascript` + screenshot.

- **PASS — native transcript hidden while ON.** FAB → 开启翻译, episode playing: the
  scraped cue-list div goes `display:none` (`data-mt-native-hidden="1"`, `offsetParent
  null`) while our `#mt-pod-overlay` shows the synced bilingual pair. Screenshot confirms
  the cue list is gone and the following "更多同类单曲/单集" section fills the space.
- **PASS — tab bar preserved.** The 简介 / 转录 / 章节 tabs stay visible and usable (we hide
  the list div, which is a *sibling* of the tab bar, never the wrapping section).
- **PASS — restore on OFF.** FAB → 关闭翻译: `data-mt-native-hidden` cleared, the list is
  `display:block` / visible again, overlay removed. Fully reversible.
- **Left untouched (correct):** the creator's burned-in on-video captions ("I'm gonna
  throw the glass on you…") — part of the video, not Spotify UI; a `data-testid` scan
  found no separate Spotify lyric/synced-transcript element.

### Mobile YouTube — single button on www.youtube.com (iPhone 15 sim + real device) (2026-07-04)
Verifies the fix for the two-green-circle bug (issue #2 / PR #3): on a phone at the
**desktop-layout `www.youtube.com`** the in-player 译 button and the page FAB both
appeared. Fix unifies "mobile" on `TranslationCore.isMobileLayout()` (`maxTouchPoints > 0`
or a mobile UA); on any mobile device the FAB drives everything and the 译 button is
suppressed.

- **PASS — one button (iPhone 15 sim).** `simctl openurl` to `https://www.youtube.com/watch?v=…`
  stayed on `www` (desktop layout, has `.ytp-right-controls`). Screenshot shows **only the
  green 文A FAB — no separate 译 button** (compare the reporter's screenshot with two
  stacked green circles).
- **PASS — FAB drives BOTH.** Tapping the single FAB produced the video dual-subtitle
  overlay (`But then those middle` / `但是中间的几个月`, synced to playback) **and** the
  page-text translation (title → 拖延症大师的内心世界…, comment → green) at once — proving
  `isMobileYouTube` now routes YouTube on `www` mobile.
- **PASS — real device (TestFlight build 2).** User confirmed the single-button behavior
  on a physical iPhone at `www.youtube.com` after installing the rebuilt TestFlight build.
- **Desktop unchanged (by logic + unit test):** non-touch → `isMobileLayout()` false →
  `ensureControlButton` still mounts the 译 button; covered by
  `test/translation-core.test.js` (`isMobileLayout` cases).
