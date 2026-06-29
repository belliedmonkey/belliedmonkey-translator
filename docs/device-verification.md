# Device verification (all platforms) — cua-driver harness

How an AI agent verifies this extension on **real device surfaces** (macOS desktop
Chrome, and especially **iOS Safari via the Simulator**) by driving the actual UI,
not just reasoning. Built on the **cua-driver** computer-use MCP. This is the
standard for any "test it on a device" / mobile-regression task.

## Why
Browser automation (`claude-in-chrome`) only drives Chrome tabs — it can't reach
the macOS desktop, the iOS Simulator, or Safari settings. The mobile bugs that
matter (iOS Safari caption rendering, `playsinline`/fullscreen, the mobile
`m.youtube.com` layout) only reproduce on real iOS Safari. cua-driver gives the
agent the whole screen + apps.

## cua-driver setup (one-time, needs the user)
- Install: `com.trycua.driver` (`/Applications/CuaDriver.app`, CLI at `~/.local/bin/cua-driver`).
- **Permissions** (user must grant via macOS GUI — agent can't): `cua-driver permissions grant` → approve **Accessibility + Screen Recording**.
- **MCP scope**: register at **user scope**, not project scope, so it loads in every session:
  `claude mcp add --scope user --transport stdio cua-driver -- cua-driver mcp`
  (A project-scoped entry only loads when Claude Code is launched from that project dir.)
- **Gotcha — clean stdout**: before grants, `cua-driver mcp` prints a plain-text
  "auto-launching the daemon…" line on **stdout**, which corrupts the JSON-RPC
  handshake → the harness fails to load its tools. After grants + the daemon
  running, stdout is clean. So: grant → restart Claude Code → tools appear
  (`mcp__cua-driver__*`). Verify with `cua-driver permissions status` (both ✅) and
  `cua-driver status` (daemon running).

## Driving the UI — key techniques
- **Native macOS / iOS-Simulator UI is AX-bridged**: `get_window_state(pid, window_id)`
  returns the iOS UI as `AXButton`/`AXCheckBox` etc. — click reliably by
  `element_token` (no pixel math). The Simulator window is `com.apple.iphonesimulator`;
  find it via `list_windows`.
- **Web content is NOT AX-bridged** (our injected FAB/overlay don't appear): use
  **pixel clicks**. `get_window_state(capture_mode: "vision", screenshot_out_file: …)`
  saves the window PNG (no huge AX tree); Read it, locate the element in window-PNG
  pixels, then `click({x, y, window_id, debug_image_out})` to verify the crosshair.
- **Big AX trees blow the context window** (a Settings screen ≈ 25k+ tokens, mostly
  the macOS menu bar). The tool **saves the full JSON to a file** when it overflows —
  do NOT read it; `python3`/`jq` it to extract only the `element_token` you need:
  `python3 -c "import json;d=json.load(open(F));[print(e['element_index'],e['element_token'],e['label']) for e in d['elements'] if e.get('label') and '扩展' in e['label']]"`
- **To SEE the iOS screen cheaply**: `xcrun simctl io booted screenshot /tmp/x.png` then Read it (one image ≪ an AX dump).
- The cua-driver `page` tool does NOT support the Simulator (`Unsupported browser:
  com.apple.iphonesimulator`) — to inspect the sim's web DOM, use Safari Web
  Inspector (Mac Safari → Develop → Simulator) instead.

## iOS Safari extension test pipeline (verified working)
1. **Build the extension with the latest code** — the on-disk `safari-project/` may
   be stale/empty; regenerate from `dist/`:
   `xcrun safari-web-extension-converter dist --app-name "BelliedMonkey Translator" --bundle-identifier com.belliedmonkeytranslator --project-location /tmp/mt-safari --force --no-open --no-prompt`
2. **Build for the simulator** (no signing needed): scheme is `... (iOS)`:
   `xcodebuild -project "/tmp/mt-safari/.../*.xcodeproj" -scheme "BelliedMonkey Translator (iOS)" -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/mt-dd CODE_SIGNING_ALLOWED=NO build`
3. **Install + register**: `xcrun simctl install booted ".../BelliedMonkey Translator.app"` then `xcrun simctl launch booted com.belliedmonkeytranslator` (the container app shows "turn on in Settings").
4. **Enable the extension** (cua-driver, AX clicks): Settings → `Safari浏览器` → `扩展`
   → the extension row → toggle **允许扩展** ON → per-site permission `youtube.com` →
   **允许**. (`prefs:root=SAFARI` deep links do NOT work on the sim — navigate the GUI.)
5. **Test**: `xcrun simctl openurl booted "https://m.youtube.com/watch?v=…"` →
   screenshot → pixel-click the FAB → observe.

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

### Podcast bilingual subtitles (2026-06-30, desktop Chrome)
Verified end-to-end on desktop Chrome (unpacked `dist/`) against the Substack
podcast page `lennysnewsletter.com/p/openai-codex-lead-on-the-new-shape` (in-page
CloudFront-signed `en.vtt`). The iOS-Simulator pass was blocked by Safari's per-site
extension-permission grant (resets on each reinstall; not reliably automatable via
AX) — Chrome is the equivalent content-script surface and the cue logic is shared.

Confirmed: FAB enables podcast subtitles → the signed VTT resolves (HTTP 200, **1369
cues** parsed → merged sentences), and the viewport-anchored overlay shows matched
whole-sentence pairs synced to `audio.currentTime` — e.g. at 4s
"Not 90% of engineers, that's…" / "不是90%的工程师，而是整个公司90%的人。", at 30s
"A lot of people seem to like the app." / "很多人似乎都喜欢这个应用。" — advancing with
the clock, never word-by-word. The 译 control menu (双语/仅译文/仅原文, 下载.srt, 设置)
renders. Two bugs found ONLY by running it on a real page (invisible to code review):

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
