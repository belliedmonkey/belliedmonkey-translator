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

### 文档翻译 · macOS 宿主 App 的文件面板（`WKUIDelegate.runOpenPanel`，D5）(2026-09-11)

来源：`app/native/file-panel-bridge.swift`，由 `npm run app:sync` 作为标记块 `mt-file-panel` 贴进
`ViewController.swift`，并在 `navigationDelegate` 之后 `MTFilePanel.attach(self.webView)`。
自动化能证明的只有「编得过」（`xcodebuild … (macOS) build` BUILD SUCCEEDED，两棵工程都打上、
第二次 `app:sync` 报 already current）；面板本身是系统 UI，**只能在真 macOS App 里点**：

| 步 | 判据 |
|---|---|
| 首页「翻译文档」→ 点「上传文档」 | 弹出系统打开面板（sheet 挂在 App 窗口上） |
| 选一个 `.pdf` | 1 s 内阅读器出标题与「1 / N」，第 1 页译文随后到 |
| 再点「上传文档」→ 取消 | 不报错、页面无变化 |
| 取消之后再点一次 | **还能再弹**（取消分支必须 `completionHandler(nil)`；漏了这一下 `<input>` 永远卡住，且没有任何错误） |
| iOS（模拟器即可） | 点「上传文档」弹「照片 / 浏览」；不需要这段桥 |

---

## 2026-10-03 · 泰语（#556）+ 高质量语音 Kokoro（#558）矩阵记录

一次**未跑完**的矩阵，如实记录每一行的判据与证据，供下一位接着跑。

| 行 | 结果 | 证据 |
|---|---|---|
| **iPhone Safari（iPhone 18 Pro 模拟器）** | ✅ 泰语 ✓ · Kokoro 装包 ✓ | 首启屏**整屏泰文**（含「ชุดเสียงคุณภาพสูง…พร้อมแล้ว」= 高质量语音包**已就绪**）；盘上 `…/mt-speech/kokoro-zh-en/` **206 MB**、安装戳 `.installed-5bab4f62…` 与清单 sha256 逐字相同。截图 `.local/regress-1.19.0/thai/evidence/` |
| **iPad Safari（iPad Pro 13" M5 模拟器）** | ✅ | `testDbgThaiUi` **passed**（判据 = 朗读包到「พร้อมแล้ว」+ 首页/设置全泰文 + 无缺键回落汉字）。截图 `.local/regress-1.19.0/thai/sim-ipad/shots/` |
| **macOS host app（Debug 构建）** | ✅ 泰语 ✓ · Kokoro 装包 ✓ | AX 树整页泰文；首启给的是 **「รับเฉพาะชุดเสียงแล้วดำเนินการต่อ」（只下朗读包、继续）** —— #553 的降级路径；点完进首页（「โหมดพอดแคสต์」卡）。盘上同 iOS：206 MB + 同一个 sha256 戳。截图 `.local/regress-1.19.0/thai/macos-app/` |
| **macOS Chrome（CDP `Extensions.loadUnpacked`）** | ✅ | options 页 **3155 个泰文字符**、缺键回落汉字 **0**（脚本 `.local/chrome-thai-check.js`，判据豁免语言自名与品牌名）。截图 `.local/regress-1.19.0/thai/chrome-macos/` |
| **macOS Safari** | ⬜ **未跑** | 本机 Safari 被**另一个会话**占着（窗口标题是一串布局测量调试串且不变）—— 按「并行会话不抢共享资源」的规矩**没有去抢**。配方见 verification-spec §2.C 路径 A |
| **Firefox desktop** | ✅ **页面正常**（#560 是我的驱动 bug，已关闭） | 等 `web-ext` 打出 `Installed … as a temporary add-on` 之后**用地址栏导航**到 `moz-extension://<uuid>/options/options.html` ⇒ 窗口标题变「大肚猴翻译 — 设置」，整页正常渲染（引擎与密钥/免费额度/显示样式/复习/学习/缓存管理/关于），页面里能看到**学习语言的 13 个 chip 含「ไทย」**。截图 `.local/regress-1.19.0/thai/firefox-options-FIXED.png`。硬经验见 verification-spec §2.E |
| **macOS Safari** | 🧑 **人工阻塞 —— 明确记录为「不挡 TestFlight」** | 扩展**已装但未启用**：Safari → 设置 → **扩展**页里能看到「大肚猴翻译：双语对照 + 视频双字幕 + 生词复习」，勾选框 `value=0`（1Password 那条是 1）。用 cua-driver 点它（background 与 foreground 都试）**值不变**（`refusal`/无效果），启用这一步没做成 ⇒ 没往下走（其后还要「在每个网站上始终允许」+ 打开 options 页 + 切语言）。下次可用 GUI 手点，或查 Safari 对未签名/未启用扩展的启用条件。**2026-10-03 飞行窗监督裁定**：勾选需人手点、飞行窗内无人可点，而同一扩展在 Chrome（3155 个泰文字符、0 缺键回落）与 Firefox（整页渲染 + 13 个学习语言 chip 含 ไทย）两行已绿、iOS/iPad/macOS 三个宿主面亦绿 ⇒ **这一行按人工阻塞记账，不挡 TestFlight**；落地后补一次勾选即可闭合 |

**未验证**（两个都要如实带上）：

1. **引擎装载 + 合成：✅ 已验证**（2026-10-03，走**播客模式**而不是设置页的试听）。
   macOS App 首页点「โหมดพอดแคสต์」⇒ AX 树出现：
   `การ์ดที่ 3 จาก 4`（第 3/4 张卡）+ **`รอบที่ 1 · กำลังเล่นต้นฉบับ…`（第 1 遍 · 正在播放原文…）** + `🔁 เล่นซ้ำ`。
   ⇒ 引擎**装载成功并真的出声**：配置写错只会显示 TTS 失败，不会有这个播放态。
   截图：`.local/regress-1.19.0/thai/macos-app/macos-podcast-kokoro-playing.png`。
   为什么不在设置页试听：**那一行在 macOS App 的设置页里根本不渲染**（AX 369 元素、`elements_complete:false`，
   只有语音模式 / 自动朗读 / 每日新卡那几行；滚动也不改变树）。两处都试过，走播客模式反而更接近真实用法。
   iOS 模拟器侧仍到不了设置页（首启的识别包必然 `reason='locale'` ⇒ 停在包屏）——已知限制，不阻塞。
2. **试听（续）**：macOS App 的**设置页里没有那一行** —— AX 树（369 元素、`elements_complete:false`）里只有「โหมดเสียงพูด / อ่านออกเสียงอัตโนมัติ / จำนวนการ์ดใหม่สูงสุดต่อวัน」等，
   没有 `เล่นตัวอย่าง`（试听）也没有「离线模型」那行；滚动也没让树变化。⇒ **Kokoro 的装载+出声仍未被端上验证**。
   可走的两条：① App 的**播客模式**（它朗读走同一个引擎，首页那张卡可见）；② 设置页里那行（需要先弄清它在哪个档/为什么没渲染）。
3. **音质 A/B**：**按裁定留给落地后的耳朵**（飞行窗内无法主观听判）。
   样本生成脚本在 `.local/kokoro-probe.py`（en/zh 各两句，24 kHz WAV）；
   判据是「Kokoro 与 Piper 谁更好听」—— 不好听就把 `device-models.config.js` 换回 piper 两行（vits 分支仍在）。

---

## 2026-10-03 · TestFlight 第三批（泰语 #556 + Kokoro #558）

四个包，**只传 TestFlight，未提审**（驱动全程只用 `xcodebuild archive → exportArchive → altool --upload-app`，
没有任何 `asc.js bind` / `asc-submit` 调用）。驱动：`.local/build-1190d-four.sh`（号码在跑之前从 ASC 回读确定：
global 132/80、china 75/73 均为 VALID ⇒ 本批取 +1）。

| 面 | 构建号 | ASC 回读 | 备注 |
|---|---|---|---|
| 国际 iOS | **133** | **VALID**（2026-10-03 08:10） | 包体回读 `com.belliedmonkeytranslator 1.19.0 133`、**`lproj: 14`**（Base + 13 门，泰语在包内） |
| 国际 macOS | **81** | **VALID**（08:12） | `lproj: 0` 是 macOS 的正常形状（lproj 在 `Contents/Resources/` 下，脚本数直接子项） |
| 中国 iOS | **76** | **VALID**（08:21） | 包体 `com.belliedmonkeytranslator.cn 1.19.0 76`、`lproj: 14` |
| 中国 macOS | **74** | **VALID**（08:18） | |

上传返回：四条都是 `UPLOAD SUCCEEDED with no errors` + Delivery UUID；china iOS 的 build 在 ASC 里晚约 7 分钟出现（处理中），
所以回读是**轮询到 VALID 才记**的，不是上传成功就记。

**这一批包含**：泰语第 13 门语言（#556，1193 键 + 四个消费面 + 中国版描述 + 13 lproj + 可学习语言白名单）、
Kokoro int8 多语离线朗读（#558 + #557）、一键卡随界面语言重画（#559）。
矩阵结论见上一节：四绿 / Firefox 页面绿 / **macOS Safari 人工阻塞（不挡 TF）** / 音质 A/B 留给落地后。

---

## 2026-10-04 · TestFlight 第四批（泰语可选 + Kokoro + 离线包后台续传）

驱动 `.local/build-1190e-four.sh`（号码跑前从 ASC 回读确定：global 133/81、china 76/74 均为 VALID）。
**只上传 TestFlight，全程没有 `asc.js bind` / `asc-submit`。** ASC 回读（监督实读）：

| 面 | 构建号 | ASC | 上传时间（CST） |
|---|---|---|---|
| 国际 iOS | **134** | **VALID** | 04:50 |
| 国际 macOS | **82** | **VALID** | 04:53 |
| 中国 iOS | **77** | **VALID** | 04:55 |
| 中国 macOS | **75** | **VALID** | 04:57 |

包体回读：国际 iOS `com.belliedmonkeytranslator 1.19.0 134` / **`lproj: 14`**（泰语在包内）；
中国 iOS `…cn 1.19.0 77` / `lproj: 14`；两个 macOS 的 `lproj: 0` 是正常形状（lproj 在 `Contents/Resources/` 下）。

这一批含：泰语在语言列表可选（#561，识别侧 `DictationTranscriber` 回落）+ Kokoro 中英离线朗读（#558/#557）
+ 离线包**后台续传**（#561，真机 -1005 之后）+ 一键卡随界面语言重画（#559）。

⚠️ 本批**未重跑全矩阵**（用户明确要求），矩阵状态仍沿用 2026-10-03 那一节。

---

## 2026-10-04 · TestFlight 第五批（登录第一发自动重试 + 首启包页语言对）

驱动 `.local/build-1190f-four.sh`，从 `ced7ff9a`（feat/firstrun-gates）出，版本 **1.19.0**。
号码跑前从 ASC 回读确定（第四批 134/82/77/75 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **135** | **VALID** |
| 国际 macOS | **83** | **VALID** |
| 中国 iOS | **78** | **VALID** |
| 中国 macOS | **76** | **VALID** |

**这一批补的两处**（第四批 134/82/77/75 里没有 —— 用户手里是 CN iOS 77，所以必须进包）：

1. **Apple 登录「连不上服务器」的第一发自动重试**（`extension/learn/auth.js` 的 `signInWithIdToken`）：
   换会话那发 POST 在网络层失败时重试 3 次、仅网络类（`network|offline`）、退避 400/1200 ms。
   定位依据：境内后端在用户报错的**同一分钟**（`2026-10-03T21:02:15Z` = 05:02:15 CST）记到的是
   **成功**的 Apple 登录 200（provider=apple、泰国 IP），近 6h 非 2xx 为空 ⇒ 失败在换会话那一跳、
   服务端无痕（§0），而原实现不重试。
2. **首启语音包页的语言对**：「我的语言 / 对方的语言」两个下拉（`src/app/AppShell.jsx` +
   `src/app/shell-model.js`），选项走 `AppListen.langOptions`（注册表全量、含泰语；引擎不支持的
   灰显而不是拿掉），与听译页**共用** `listenMyLang`/`listenOtherLang` 两键；
   `firstRunLocales` 改成优先用选中的那一对 ⇒ 识别包按所选语言下，不再写死 zh。

**进包已回读**（不是只看 git）：`dist-app/Script.js` 与 `dist-app-china/Script.js` 里都能搜到
`attempt < 3` + `400 + attempt * 800` 的完整重试循环，以及 `packs-my-lang` / `packs-other-lang`。

⚠️ 与本批一起记的**一处措辞偏差**（留给评审）：Pencil 已通过的「下载页 · 自选语言对」帧里第二个
选择器写作「目标语言（译成哪一种）」，而实现用的是听译页既有的「**对方的语言**」——
因为这一页的两个包要的是**被识别的语言**（ASR 包按口语语言下），与「译成」是两个概念；
沿用既有键也避免给同一件事起第二个名字。**用户 2026-10-04 拍板：保持「对方的语言」，不改成帧上的「目标语言」，代码不再为这个用词改动，
也不再为它打版。** 理由与决定已记进 `docs/interaction-spec.md`（首启屏那一节）——
这一页的两个包要的是**被识别的语言**，与「译成」是两个概念。

---

## 2026-10-04 · TestFlight 第六批（首启语音包页语言下拉空框的修复 #562）

驱动 `.local/build-1190g-four.sh`，从 `a9c84c03`（feat/firstrun-gates）出，版本 **1.19.0**。
号码跑前从 ASC 回读确定（第五批 135/83/78/76 全 VALID；`node scripts/asc.js builds`）。
**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **136** | **VALID** |
| 国际 macOS | **84** | **VALID** |
| 中国 iOS | **79** | **VALID** |
| 中国 macOS | **77** | **VALID** |

**这一批补的一处**（第五批 135/83/78/76 里没有）：

**首启语音包页「我的语言 / 对方的语言」两个下拉只剩空框**（用户 2026-10-04 build 78 实机截图，
issue #562）。根因：`paintFirstRun(session)` 里语言对那段写的是 `firstRunLocales(s)`，作用域里只有
形参 `session` ⇒ 严格模式抛 `ReferenceError`、被外层 `catch (_) {}` 静默吞掉，`wire(...)` 没跑，
两个 `<select>` 既无标签也无选项。改：默认语言对从 `readObSettings()` 读并单独兜底、两个槽都保证
有值；语言对提前到 `probePacks()` 之前（显示与下载一致）；选项 = 注册表全量；并按 Pencil 稿
`稿 · 下载页 · 自选语言对` 落地两个全宽选择器 + 包卡片。

**进包已回读**（不是只看 git）：`dist-app/Script.js` 与 `dist-app-china/Script.js` 都能搜到
`let defaults = ["", ""]` 与 `packs-lang-label`；`firstRunLocales(s)` 只剩 `probePacks` /
`runFirstRunPacks` 两处（那两处作用域里确有 `const s`）。

CI：PR #535 合并前 run 37176397751 5/5 pass；并入 main（`748e9b46`）后 run 37179080329 5/5 pass。

---

## 2026-10-04 · TestFlight 第七批（iOS 26.x 上「选窄转写器」错判泰/俄/阿的修复 #563）

驱动 `.local/build-1190h-four.sh`，从 `246b1342`（feat/firstrun-gates）出，版本 **1.19.0**。
号码跑前从 ASC 回读确定（第六批 136/84/79/77 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **137** | **VALID** |
| 国际 macOS | **85** | **VALID** |
| 中国 iOS | **80** | **VALID** |
| 中国 macOS | **78** | **VALID** |

**这一批补的一处**（第六批 136/84/79/77 里没有）：

**iPhone 15 Pro / iOS 26.6.2（听译语言 ไทย）首页两个入口一起灰**（issue #563）。根因：
`mtTranscriberFor` 先问 `SpeechTranscriber.supportedLocale(equivalentTo:)`，而它在 **iOS 26.x 上对
「窄的那台并不支持」的语言也会归一化出一个 locale**（27.0 才改成回 nil）⇒ 泰/俄/阿被错分给窄的
那台、其 `AssetInventory.status=unsupported` ⇒ 探针回 `unsupported/locale` ⇒ `ok=false` ⇒
`entryState.disabled` ⇒ 两张卡一起灰。修：认窄的那台前核对 `SpeechTranscriber.supportedLocales`，
不在清单里就落回 `DictationTranscriber`。

**实测对照（系统 API，非推测）**：iOS 26.5 模拟器 `speech(th-TH)=unsupported` / `dict(th-TH)=supported`；
iOS 27.0 的 14 Pro 上 `supportedLocale("th")` 本就回 nil、落 dict，端到端首页两张卡 CTA 带像素 =
实心 `#ac6231`（启用）⇒ 这是 26.x 线独有的缺陷。

**进包已回读**：`safari-project{,-china}/…/ViewController.swift` 里都搜得到 `speechLocales.contains`。

**待补**：15 Pro（26.6.2）真机端到端 —— 本批 china iOS 80 由用户验（首页两卡是否恢复可点、
选 ไทย 是否可用）。`npm test` 2382 passed / 0 failed；新增门禁见 `test/listen-langs-thai.test.js`。

⚠️ **第七批在 15 Pro / iOS 26.6.2 上没修好**（用户 16:12–16:13 报）：首页两卡仍灰（CTA 带像素
`(215,177,148)` ≈ 主色 `#ac6231` 压 0.45）、包屏「识别语言包」整行不见（`rowAsr.hidden =
packAsrUnsupported` ⇒ 探针仍回 `unsupported/locale`）。修复确实进了 80（`app:sync` 日志 =
`speech bridge block replaced`；china 归档重编了 `ViewController.swift`）⇒ **名单判据不够**，
需要设备上的中间值。

---

## 2026-10-04 · TestFlight 第八批（**诊断批**：探针中间值上屏幕，定位 #563）

驱动 `.local/build-1190i-four.sh`，从 `bc173c3e`（feat/firstrun-gates，临时诊断提交）出，版本 1.19.0。
号码按 ASC 回读定（第七批 137/85/80/78 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **138** | **VALID** |
| 国际 macOS | **86** | **VALID** |
| 中国 iOS | **81** | **VALID** |
| 中国 macOS | **79** | **VALID** |

这一批**只多了一条诊断**（不改产品行为）：原生 `stt-probe` 把中间值发回 JS，页面底部一条绿色固定浮层
`[mt-probe]` 显示 —— 输入语言对 / `ok·reason·assets` / `isAvail·speechN·dictN` / `unionN·unionHasTh`
/ 每门语言 `(id, 选中哪台, 资产状态)`。用来钉死「26.6.2 上泰语为什么仍被判不支持」。

**进包已回读**：`safari-project-china/…/ViewController.swift` 里搜得到 `"probe": probeDbg`（3 处）。
**浮层渲染已在 14 Pro（iOS 27.0）验过**：`isAvail=true speechN=45 dictN=54 unionN=68 unionHasTh=true`、
`probe: en-US speech installed`。

⚠️ **这一批是临时的**：定位完成后删诊断（`bc173c3e` + `build-scripts` 白名单里的 `"probe"/"nil"`）。

---

## 2026-10-04 · TestFlight 第九批（第八批原样重发：81 在 15 Pro 上卡「准备中」）

用户在 15 Pro 装 81 时 TestFlight 卡「准备中」不动；ASC 上 81 是 VALID 的（CDN/端侧问题）。
按用户裁定「重来」重发一批：**同一 HEAD `59f3acbc`，内容与 138/86/81/79 完全相同**（诊断浮层那版）。
驱动 `.local/build-1190j-four.sh`。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **139** | **VALID** |
| 国际 macOS | **87** | **VALID** |
| 中国 iOS | **82** | **VALID** |
| 中国 macOS | **80** | **VALID** |

（本轮插曲：当时本机 `127.0.0.1:1082` 本地代理已死 + NAS 上 mihomo 栈 8317/18080/19090/19091 全
CLOSED ⇒ push/gh/ASC 全断。绕开代理直连后恢复；两笔欠推 `53d82b05..59f3acbc` 已补。）

---

## 2026-10-04 · TestFlight 第十批（#564 语言对对调修复 + #563 探针两台按资产选）

驱动 `.local/build-1190k-four.sh`，从 `03e5728a`（feat/firstrun-gates）出，版本 **1.19.0**。
号码按 ASC 回读确定（第九批 139/87/82/80 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **140** | **VALID** |
| 国际 macOS | **88** | **VALID** |
| 中国 iOS | **83** | **VALID** |
| 中国 macOS | **81** | **VALID** |

这一批两处：① **#564 语言对对调** —— 包屏默认值把 `firstRunLocales()`（去重集合）当槽位一对用，
且「选默认值不触发 change」令 `listenMyLang` 恒空 ⇒ 点下载后「我=中文、对方=ไทย」跳成
「我=ไทย、对方=English」。修：槽位默认各算（我的=界面语言，对方的=targetLang∥一门不同的）+
「下载并继续」先落盘。② **#563 追踪** —— `mtTranscriberFor` 两台都按 `AssetInventory.status`
问（`mtModuleUsable`），先可用者胜；依据 15 Pro/26.6.2 浮层数据（speechN=30 dictN=54、
`th dictation installed`）：名单说支持 ≠ 资产说可用，未就绪模块会被 26.x 报 `.unsupported`。

**进包已回读**：`ViewController.swift` 有 `func mtModuleUsable`；`dist-app-china/Script.js` 有
`listenMyLang: langPair[0]`（下载落盘）与 `getUILanguage()`（槽位默认）。诊断浮层**再留一轮**
（验证新选法），用户确认后删。

`npm test` 2384 passed / 0 failed（R2g 改判 + 新增 R2h + thai 资产判据）；`test:app` global/china 绿。

---

## 2026-10-04 · TestFlight 第十一批（#565 回声闸泰语修复；诊断浮层删除）

驱动 `.local/build-1190l-four.sh`，从 `1e2bdf0e`（feat/firstrun-gates）出，版本 **1.19.0**。
号码按 ASC 回读确定（第十批 140/88/83/81 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **141** | **VALID** |
| 国际 macOS | **89** | **VALID** |
| 中国 iOS | **84** | **VALID** |
| 中国 macOS | **82** | **VALID** |

这一批一处：**#565 回声闸对泰语失明** —— `echoTokens` 只认「中日韩按字 / 其余按词」，泰文没有词间
空格 ⇒ 整句一个巨型 token，包含度退化成整串相等 ⇒ 自己念的泰语被当成新句子翻回中文。修：无空格
文字（泰/老挝/高棉/缅甸）按字符 bigram 切。**同时删除 #563 的临时诊断浮层**（`stt-state.probe` /
`paintProbeDebug` / 白名单 `"probe"/"nil"`，包内 grep 残留 0）。

**进包已回读**：`dist-app-china/Script.js` 有 `NOSPACE_SCRIPT`（2 处），`probeDbg`/`paintProbeDebug`
残留 0。`npm test` 2386 passed / 0 failed（回声闸新增泰语两条门禁）；`test:app` global/china 绿。

**待用户验（84）**：zh↔th 听译里泰语译文念完后不再被自己识别翻回中文；中文句照常自动朗读。

---

## 2026-10-05 · TestFlight 第十二批（#565 回声闸二轮：窗 1500→3000ms + 系统语音静麦尾 0.9s）

驱动 `.local/build-1190m-four.sh`，从 `e39eb397`（feat/firstrun-gates）出，版本 **1.19.0**。
号码按 ASC 回读确定（第十一批 141/89/84/82 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **142** | **VALID** |
| 国际 macOS | **90** | **VALID** |
| 中国 iOS | **85** | **VALID** |
| 中国 macOS | **83** | **VALID** |

**84 上 bigram 切词已对、回声仍漏** —— 漏的不是「比对」是「时间」：系统语音（AVSpeechSynthesizer）
出声比 `didFinish` 晚（静麦放开后又听到尾音）+ Dictation 定稿晚落（落在 JS 回声窗 1500ms 之外）。
修：`ECHO_TAIL_MS` 1500→3000；`MTSystemSpeech` 的 didFinish/didCancel/stop 放开静麦后
`extendMuteTail(0.9)`（audio-bridge 新增，Piper 路的 0.35 不动）。

**进包已回读**：`ViewController.swift` 有 `extendMuteTail`（4 处）；`dist-app-china/Script.js` 有
`ECHO_TAIL_MS = 3000`。`npm test` 2387 passed / 0 failed（念完 2.5s 才到的泰语定稿 ⇒ 仍判回声）；
`test:app` global/china 绿。

**待用户验（85）**：zh↔th 听译里泰语念完后不再冒出「新句子翻成中文」。

---

## 2026-10-05 · TestFlight 第十三批（#565 三轮 · 路 A：系统语音走 write() 自有管线）

驱动 `.local/build-1190n-four.sh`，从 `e52a98e1`（feat/firstrun-gates）出，版本 **1.19.0**。
号码按 ASC 回读确定（第十二批 142/90/85/83 全 VALID）。**只上传 TestFlight，无 bind / 无 submit。**

| 面 | 构建号 | ASC |
|---|---|---|
| 国际 iOS | **143** | **VALID** |
| 国际 macOS | **91** | **VALID** |
| 中国 iOS | **86** | **VALID** |
| 中国 macOS | **84** | **VALID** |

这一批：**系统语音从 `synth.speak()`（系统内部渲染、静麦跟 delegate 回调猜时机）改为
`write(_:toBuffer:)` → `MTSpeechChunkBox` → 自有 `AVAudioPlayerNode`** —— 与 Piper（中文）同一条
从不回声的管线；tts-start/tts-end/静麦全部对齐「首块出声 + 总样本数/采样率」。JS/协议零改动。

**插曲（第一次跑全红）**：`pcm.channelCount` 写错（在 `pcm.format.channelCount` 上）——本地只跑了
`swiftc -parse`（查语法不查类型）没拦住；四个归档全失败、**未上传任何坏包**（号码 143/91/86/84 在
ASC 从未出现，重跑直接复用）。补了真类型检查（`swiftc -typecheck` 组合三个 native 文件）进本地流程。

**进包已回读**：`ViewController.swift` 有 `synth.write(u)`（1）与 `format.channelCount`（2），
delegate 三回调与 `extendMuteTail` 残留 0。

**待用户验（86）**：zh↔th 听译里泰语念完后不再被自己认成新句子。
