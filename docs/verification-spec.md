# Verification spec (验证规约) — the single source of truth

This file is the **single, authoritative source** for how any change or bug in
「大肚猴翻译 / BelliedMonkey Translator」 is **verified**. It is referenced by
[`AGENTS.md`](../AGENTS.md); the verification rules formerly scattered across
`AGENTS.md`, `docs/device-verification.md`, and `docs/regression-tests.md` now live
here. **Every verification / testing task MUST follow this spec exactly.**

---

## 0. The rule (load-bearing)

> **Every verification runs the FULL MATRIX of every surface the product has been
> adapted to — a full regression, every time. Once a device or browser is adapted,
> it is permanently added to the matrix and included in every future verification.**

Corollaries:

- **No single-surface "canonical" pass.** Verifying a fix on iPhone alone (or Chrome
  alone) is **not** verification. A change is "verified" only when it has been
  exercised across the **entire current matrix** (§1) or its inapplicability to a
  surface is stated explicitly.
- **The matrix only grows.** When a new device/browser is adapted (e.g. a new iOS
  version, Firefox Android, Edge), add a row to §1 and it is thereafter part of every
  regression. Never quietly drop a surface.
- **State honestly what was and wasn't run.** For each task, report the per-surface
  result: verified-live (screenshot/recording) · documented-not-run · N/A. Never imply
  full coverage you didn't perform. (See §4 honesty rules.)
- **Drive real surfaces via cua-driver only** — never `claude-in-chrome` or other
  browser/computer-use tools — for every surface, including desktop Chrome.

Scope: the full matrix applies to any change with an observable runtime surface —
a URL/page render, a subtitle/overlay, layout, a control, a provider, i18n. A
pure-logic change with **no** on-device surface needs only the automated gate (§3),
but say so.

---

## 1. Current surface matrix

The product is adapted to these surfaces (`README.md` 平台支持). **Only iPhone + iPad
run in the Xcode Simulator** (it only simulates iOS-family devices); the three desktop
browsers run on the **real Mac, fully sandboxed** (throwaway profiles / snapshot+restore
— nothing permanent left behind).

| # | Surface | Execution mode | Status |
|---|---|---|---|
| 1 | **iPhone Safari** | Xcode iOS Simulator (e.g. iPhone 15, iOS 17.2) | ✅ verified pipeline |
| 2 | **iPad Safari** | Xcode iOS Simulator (e.g. iPad Air 5th) — same iOS build, different UDID | ✅ verified pipeline |
| 3 | **macOS Safari** | Real Mac, sandboxed. **Side-load `dist/` via 开发者→添加临时扩展** (no Xcode/signing; auto-clears on quit; **SNAPSHOT — re-add after every rebuild**, see §2.C) | ✅ verified (FAB + full-page translation) — see §2.C; picker folder-selection is the one manual step |
| 4 | **macOS Chrome / Edge** | Real Mac, throwaway profile — **CDP `Extensions.loadUnpacked`** (CLI `--load-extension` blocked on Chrome ≥137) | ✅ verified (FAB + 11 translations) — see §2.D |
| 5 | **Firefox (desktop)** | Real Mac, `npx web-ext run` (throwaway profile, live-references `dist-firefox/`) + WebDriver BiDi driving | ✅ verified (FAB + page bilingual + podcast playback + 0px click) — see §2.E |

Every regression must cover **all rows**, or explicitly mark a row N/A for the change.

---

## 2. Per-surface build → install → enable → open-URL → drive

Shared first step for all Safari surfaces:

```bash
node build.js            # → dist/
# Regenerate the Xcode project WITH macOS targets — do NOT use --ios-only:
xcrun safari-web-extension-converter dist \
  --app-name "BelliedMonkey Translator" \
  --bundle-identifier com.belliedmonkeytranslator \
  --project-location /tmp/mt-safari --force --no-open --no-prompt
```

Confirmed generated schemes: **`BelliedMonkey Translator (iOS)`** and
**`BelliedMonkey Translator (macOS)`**. (`build-safari.sh` passes `--ios-only`, which
suppresses the macOS target — do **not** use it for the full-matrix pipeline.)

### A. iPhone Safari (Xcode Simulator) — ✅ verified

```bash
xcodebuild -project "/tmp/mt-safari/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (iOS)" -sdk iphonesimulator \
  -configuration Debug -derivedDataPath /tmp/mt-dd CODE_SIGNING_ALLOWED=NO build
APP="/tmp/mt-dd/Build/Products/Debug-iphonesimulator/BelliedMonkey Translator.app"
xcrun simctl install <iPhone-UDID> "$APP"
xcrun simctl launch  <iPhone-UDID> com.belliedmonkeytranslator   # container shows "turn on in Settings"
xcrun simctl openurl <iPhone-UDID> "<test-url>"
```

Enable (once per fresh install; cua-driver AX clicks): Settings → `Safari浏览器` → `扩展`
→ the extension row → **允许扩展** ON → per-site permission → **始终允许 → 在此网站上始终允许**,
then terminate + reopen Safari. **Per-site grant resets to "ask" on a fresh install** —
until granted, content scripts silently don't inject (no FAB); this masquerades as a
code bug. (A reinstall sometimes *preserves* the toggle+grant — environment-dependent.)

Drive: `xcrun simctl io <UDID> screenshot x.png` to view cheaply; the FAB/overlay are
**web content, not AX-bridged** → locate them in a `get_window_state` window screenshot
and **pixel-click**. Record time-based behavior: `xcrun simctl io <UDID> recordVideo out.mov`.

### B. iPad Safari (Xcode Simulator) — ✅ verified

**Same iOS build**, different simulator UDID. `xcrun simctl install <iPad-UDID> "$APP"`
→ launch → openurl → drive. iPad Safari uses the **desktop-layout** (two-column) page;
the FAB injects at the bottom-right of the content column. Enable path is the same
Settings → Safari → 扩展 flow (its split-view Settings layout differs from iPhone — map
AX tokens fresh).

### C. macOS Safari (real Mac, sandboxed) — ⚠️ version-sensitive

**Snapshot first** (for restore): `cp ~/Library/Preferences/com.apple.Safari.plist <backup>`
and note whether the **Develop (开发)** menu is already visible. Then:

```bash
xcodebuild -project "/tmp/mt-safari/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (macOS)" -sdk macosx \
  -configuration Debug -derivedDataPath /tmp/mt-dd-mac CODE_SIGNING_ALLOWED=NO build
open "/tmp/mt-dd-mac/Build/Products/Debug/BelliedMonkey Translator.app"   # registers the extension
```

**Critical (verified 2026-07-11, macOS 26.5.1):** a build made with
`CODE_SIGNING_ALLOWED=NO` (or merely `codesign -s -` ad-hoc) does **NOT** register with
pluginkit/LaunchServices, so it **never appears in Settings → 扩展** — even after enabling
"允许未签名的扩展", even copied to `~/Applications` + `lsregister -f` + ad-hoc signed.
(Confirmed: the working extensions 1Password / 沉浸式翻译 DO show in `pluginkit -m`; ours
never does.) "允许未签名的扩展" governs Safari *loading*, not pluginkit *registration*.

So there are two real paths for macOS Safari — **prefer the first**:

- **(A) Recommended — side-load `dist/` unpacked, no Xcode:** Safari → Settings (`⌘,`) →
  **开发者 (Developer)** tab → check **允许未签名的扩展 (Allow Unsigned Extensions)** →
  **添加临时扩展… (Add Temporary Extension)**. Its prompt is *"选取包含扩展资源的文件夹或
  归档"* — it loads an **unpacked folder with `manifest.json`, like Chrome's Load
  Unpacked**, so you point it straight at **`dist/`**. No `xcodebuild (macOS)`, no signing.
  It loads as a *temporary* extension (auto-cleared on Safari quit → self-cleaning for
  verification). On macOS 26 the "允许未签名的扩展" toggle lives on this **开发者** Settings
  tab (on macOS ≤ 15 it's Develop menu → 允许未签名的扩展, session-scoped). Then grant host
  access **在每个网站上始终允许**, open the test URL, drive the FAB by pixel-click.

  **⚠️ Update semantics — the temporary extension is a SNAPSHOT (verified 2026-07-12).**
  Unlike Chrome (Load-Unpacked / CDP `Extensions.loadUnpacked` read from the `dist/` path,
  so rebuild + page reload runs new code), Safari **copies the folder at add-time**:
  - Rebuilding `dist/` does **NOT** update the loaded temporary extension — page reloads
    keep running the old snapshot. (Verified live: after a fix was built, Safari still
    reproduced the pre-fix bug on a fresh page load while Chrome and the iOS sims ran the
    new code — a stale snapshot masquerades as "fix didn't work", or worse, silently
    passes a regression check against the OLD build.)
  - The snapshot survives page loads and window closes while Safari stays running; it is
    cleared only when Safari quits.
  - **After re-adding, RELOAD the test page (⌘R) before observing.** An already-open tab
    keeps running the PREVIOUS injection's content scripts — and keeps their injected DOM
    artifacts — so observing it says nothing about the newly added build (burned
    2026-07-12: a playing tab predating the re-add still showed the old bug signature).
  - **Never let TWO copies of the extension be loaded at once (burned 2026-07-12).**
    Re-adding does not replace the previous temporary extension — both stay installed,
    each injecting content scripts into a **separate isolated world** (the
    `window.__mtMainLoaded` double-init guard cannot dedupe across worlds). Symptom: the
    two instances FIGHT — the inactive one removes the 译 button every tick while the
    active one re-creates it → **the button visibly blinks**; fixed-position FABs stack
    invisibly. Before verifying, Settings → 扩展 must show exactly ONE copy; the
    deterministic reset is **quit Safari (clears all temp extensions) → reopen → add
    once**.
  - **Rule: after EVERY `node build.js`, re-add the temporary extension** (开发者 →
    添加临时扩展 → `dist/`) before verifying anything on macOS Safari — treat "re-add" as
    part of the build step for this surface. Before trusting a Safari result, confirm the
    loaded code is current (e.g. check a marker introduced by the change under test via
    Web Inspector, such as an attribute or log the new build emits).
  - **⚠️ Multiple `dist/` folders exist — verify the PATH picked in the file dialog
    (burned 2026-07-12).** The main checkout (`~/mobiletranslator/dist`, built from
    `main`) and each git worktree (`…/.claude/worktrees/<name>/dist`, built from the
    feature branch) all have a `dist/`, plus `dist-china/` / `dist-firefox/`. A re-add
    that picks the WRONG dist silently loads code without the change under test — the
    symptom looks exactly like "the fix doesn't work on Safari". Before re-adding, state
    the **absolute path** of the dist being verified and confirm its freshness
    (`ls -la <dist>/content/<changed-file>` mtime, or grep the fix marker in the file).
- **(B) Signed app path:** build the `(macOS)` scheme **with a real Apple Development
  signing identity** (not `CODE_SIGNING_ALLOWED=NO`), `open` the container so it registers,
  then it appears in Settings → 扩展 → enable + grant host.

**Restore after:** if you enabled "允许未签名的扩展", uncheck it; remove any temporary
extension / app copy; return Develop-menu visibility to its snapshotted state.

> **Verified 2026-07-12 (macOS 26.5.1) ✅:** path A works end-to-end. Confirmed the
> unsigned/ad-hoc build won't register (path A required); 允许未签名的扩展 + 添加临时扩展 →
> `dist/` loaded (folder selection in the Open panel was done by hand — its ⌘⇧G/keyboard
> navigation resists the automation layer under multi-app focus contention; ~10s manual
> step, everything else scriptable). On `latent.space/p/modal2026`: FAB injected; a
> **foreground-delivery pixel click** (background click did NOT land on Safari web content —
> escalate per the click ladder) turned translation on → full-page bilingual render (title,
> description, in-player title) + the 译 podcast control. Screenshot captured. Reproduces the
> same cross-surface podcast bugs (duplicate 字幕加载中 loaders, sidebar translation
> overflowing its card).

**Dead end — safaridriver CANNOT load extensions (probed live 2026-07-12, Safari 26.5).**
Do not attempt a Chrome-style automated load via safaridriver; three-way evidence:
1. **Classic protocol:** the man page documents no extension capability, and a session
   created with every plausible key (`safari:extensions`, `safari:loadExtension`,
   `safari:webExtensions`, `webextension:path`, `safari:enableExtensions` → all pointing at
   `dist/`) navigated to the test page with **no FAB, zero extension nodes**. (safaridriver
   echoes back ALL requested capability keys, known or not — echo ≠ recognized.)
2. **WebDriver BiDi:** supported, but the standard `webExtension.install` command's domain
   does not exist — *"'webExtension' domain was not found"*. Available BiDi domains are only
   `session`, `browsingContext`, `script`, `browser`, `storage` (no private extension domain
   either: `extensions`/`safariExtensions`/`safari`/`permissions` all absent).
3. WebDriver sessions run in an isolated automation profile where extensions are off anyway.

Useful safaridriver facts discovered for OTHER purposes: enabling needs Settings → 开发者 →
**允许远程自动化** (or `safaridriver --enable`, needs sudo); **BiDi socket is gated behind the
undocumented capability `safari:experimentalWebSocketUrl: true`** (with `webSocketUrl: true`;
response then carries a real `ws://127.0.0.1:<port>/session/<id>` URL); safaridriver can also
target **iOS simulators** (`platformName: iOS`, `safari:useSimulator`, `safari:deviceUDID`) —
possibly useful for scripted page-level checks on the sim rows, untested with extensions.

### D. macOS Chrome / Edge (real Mac, throwaway profile) — ⚠️

**Critical (verified 2026-07-11, Chrome 150):** modern Chrome (since ~v137) **disables the
`--load-extension` command-line switch by default** (`DisableLoadExtensionCommandLineSwitch`),
so a throwaway `--user-data-dir --load-extension=dist` launch **silently does not load the
extension** — content scripts never inject (verified via CDP: no extension execution
context, `#mt-fab` absent on both latent.space AND example.com). `--disable-features=
DisableLoadExtensionCommandLineSwitch` did **not** re-enable it on Chrome 150. This is a
**harness limitation, not an extension defect** (the same `dist/` injects fine on iOS/iPad
Safari).

**Recommended — CDP `Extensions.loadUnpacked` (no GUI, no CLI flag):** launch a throwaway
profile with only `--remote-debugging-port`, then load the extension over the browser-level
CDP endpoint. This bypasses **both** the `--load-extension` block **and** the GUI file-picker:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROF" --no-first-run --no-default-browser-check \
  --remote-debugging-port=9225 "chrome://newtab/" &
# browser WS endpoint from http://localhost:9225/json/version → call:
#   Extensions.loadUnpacked  {path: "<abs path to dist>"}   → returns {id}
# then open the test URL and eval  !!document.querySelector('#mt-fab')
```

Alternatives if you prefer: `chrome://extensions` → Developer mode → **Load unpacked** →
`dist/` (GUI, has the file-picker keyboard-nav caveat); or **Chrome for Testing**
(`npx @puppeteer/browsers install chrome`), whose automation build still honors
`--load-extension`. A fresh Chrome may show its *own* Google-Translate bubble — unrelated;
don't mistake it for the extension.

**⚠️ Chrome unpacked extensions CACHE the loaded build (burned 2026-07-12).** Same trap
class as the Safari temp-extension snapshot: rebuilding `dist/` on disk does NOT update an
already-loaded unpacked extension in a long-running Chrome (the daily browser, not a
throwaway). **After every `node build.js`: `chrome://extensions` → click the extension
card's reload (⟳) → then RELOAD the test page** (existing tabs keep the previous
injection's scripts). A stale cached build reproduces already-fixed bugs and reads exactly
as "the fix doesn't work" — verified live: on the user's real Chrome, the pre-reload build
flashed on 3/3 body clicks (whole-page translations vanish/return, ~194k px A→B→A on the
display recording); after ⟳ + page reload, the same tab showed 0/3. Before trusting a
result from a persistent Chrome profile, confirm the loaded code is current (reload ⟳ is
cheap — just do it).

> **Verified 2026-07-11 (Chrome 150) ✅:** loaded `dist/` via `Extensions.loadUnpacked`,
> opened `latent.space/p/modal2026` → FAB present (`title:开启翻译`); clicking it → `关闭翻译`
> and **11 `.mt-translation` lines** rendered (e.g. "潜在空间：人工智能工程师播客", title →
> "为什么 AI 基础设施必须发展以提供座席体验 —…"). Screenshot captured. **Chrome surface works.**
> It also reproduces the same podcast-overlay bugs as iOS/iPad (duplicate "字幕加载中…"
> loaders floating over the article). Cleanup: `pkill -f "$PROF"; rm -rf "$PROF"` + remove any
> staged `dist/` copy.

### E. Firefox desktop (real Mac, throwaway profile) — ✅ verified

```bash
node build.js firefox        # → dist-firefox/ (MV3, gecko id set)
npx --yes web-ext run --source-dir dist-firefox \
  --firefox /Applications/Firefox.app/Contents/MacOS/firefox \
  --start-url "<test-url>" \
  --args=--remote-debugging-port=9251 --no-config-discovery
```

`web-ext run` (Mozilla's official tool, npx-fetched — not a repo dependency) launches a
**fresh throwaway profile** with the add-on temporarily installed (auto-clears on quit;
it live-references `dist-firefox/`, and about:debugging has a per-extension **Reload**
button — friendlier than Safari's snapshot semantics). Manual alternative:
`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → `dist-firefox/manifest.json`.

Drive/verify over **WebDriver BiDi** (Firefox ≥129 removed CDP): raw WebSocket at
`ws://127.0.0.1:<port>/session` → `session.new` → `browsingContext.getTree` →
`script.evaluate` for DOM assertions, `input.performActions` for TRUSTED clicks,
`browsingContext.captureScreenshot` for pixel-diff evidence.
**Gotcha: Firefox allows exactly ONE BiDi session and does not reap it promptly when the
socket closes** — "Maximum number of active sessions" on reconnect. Do the ENTIRE
verification in one connection, or restart web-ext between attempts.

> **Verified 2026-07-12 (Firefox 152.0.5) ✅:** FAB injects; FAB on → page bilingual (8
> units incl. sidebar); podcast playback (spec §4 playback rule) → overlay exactly 2
> clean pilled lines, 0 `.mt-translation` / 0 `data-mt-processed` inside, live pair
> advancing ("That this was your natural choice." / "这是你自然的选择。"); trusted click
> on body text → **0 changed px** across before/+150ms/+500ms/+1.7s screenshots (overlay
> band masked). Screenshot captured. Firefox is fully adapted.

---

## 3. Automated gates (mandatory, before every push)

### 3.1 `npm test` — pure logic (every push)

`npm test` (`node test/run.js`, zero-dep, Node ≥16) covers the pure-logic core: the
translate-ahead subtitle engine + state machine, cue→sentence merge, i18n/locale
resolution, and every provider's request-building / caching / retry-fallback. **It must
be green before you push.** When you change logic, add/update tests in the same commit.
**Never push on a red suite.**

### 3.2 `npm run test:layout` — layout regression corpus

`npm run test:layout` (`node test/layout/run-layout.js`, zero-dep, Node ≥22 for the
built-in WebSocket) drives the **real sibling renderer in a real Chrome layout engine**:
it builds `dist/`, loads it into a throwaway-profile Chrome via the §2.D CDP
`Extensions.loadUnpacked` flow, serves the local fixture pages in
`test/layout/fixtures/` over localhost, intercepts the Google translate endpoints with
canned deterministic responses (fully offline), and asserts geometry invariants on the
injected `.mt-translation` siblings (below the original, same column, no parent-style
pollution, no horizontal overflow, …). Screenshots land in `test/layout/artifacts/`
(gitignored) for human eyeballing. ~35s wall time (headless Chrome).

**Mandatory before every push that touches `extension/content/**` or
`extension/styles/**`; recommended otherwise.** No Chrome on the machine is a hard
failure (set `CHROME_BIN=/path/to/chrome`), never a silent skip.

**The incremental-adaptation contract** (the reason this suite exists):

1. Every site-specific layout fix MUST land with a new fixture in
   `test/layout/fixtures/` distilled from that site's minimal layout pattern, and that
   fixture must **fail before the fix** (record the red run in the GitHub issue).
2. The fixture passes after the fix.
3. **All pre-existing fixtures stay green.** A fixture is never edited to accommodate a
   new fix — unless the fixture's own assertion is demonstrably wrong, justified in the
   issue. This is what guarantees each adaptation is an increment, not a regression.

Scope honesty: this gate catches **renderer-logic regressions** (`flowFixCss`,
`layoutCss`, `ensureSibling`, interleave) in Chromium's layout engine. It does NOT
cover WebKit/Gecko engine differences, real devices, subtitles/overlays, or visual
color/contrast — those remain owned by the §1 full matrix via cua-driver.

---

## 4. Verification-honesty rules (mandatory)

**A DOM element existing is NOT proof the user sees it.** This burned us: the YouTube
`.mt-yt-dual` element was present (`querySelectorAll` found it) but invisible — clipped
by an ancestor's `overflow:hidden`.

- For anything the user looks at (translations, subtitles, layout), **verify with a
  screenshot of the built + loaded extension** showing the actual rendered result — not
  a DOM/console check. Confirm the text is really visible and correctly placed.
- **Interaction / visual bugs (behavior over time) MUST be verified with a screen
  RECORDING, not a screenshot** — a flash on click, a layout that shifts then reverts,
  subtitle timing, scroll jank. A still cannot capture the transient. Keep the **before
  (repro)** and **after (fix)** clips. Simulators: `xcrun simctl io <UDID> recordVideo`.
  **Desktop Chrome and desktop Safari: record with the `cap` CLI** (Cap.app's bundled
  CLI, `~/.cap/bin/cap` — agent-oriented, `--json` everywhere). Not installed? One-liner
  (also works for contributors on a fresh machine):

  ```bash
  curl -fsSL https://cap.so/install-cli.sh | sh
  ```

  Proven pipeline:

  ```bash
  export PATH="$HOME/.cap/bin:$PATH"
  cap doctor --json                    # permissions.screenRecording must be "granted"
  cap record windows --json            # window list; ids match CGWindowIDs (list_windows)
  cap record start --window <id> --duration <N> --fps 15 --path out.cap --json
  cap export out.cap --output out.mp4 --json
  ffmpeg -y -i out.mp4 -vframes 1 frame0.png   # then per-frame extraction as needed
  ```

  Gotchas (all hit live):
  - **The target window must be FRONTMOST while recording.** `--window` capture is
    region-style: an occluding window (e.g. the terminal running the command) is what
    gets recorded. Activate the target app once (`osascript -e 'tell application
    "Safari" to activate'`), then drive it with **background** cua-driver clicks only —
    a foreground-delivery click restores the prior frontmost app and ruins the clip.
  - **Frame-0 honesty check is mandatory**: extract the first frame and confirm it shows
    the target window (not the terminal) before trusting anything in the clip.
  - `--duration N` self-stops (no detach/stop dance needed for short clips); the `.cap`
    project dir and exported `.mp4` land in `--path`/`--output` (use the scratchpad).
- Don't trust your own injected test hacks as proof of the shipped code — verify the
  **built/loaded** extension.
- **Be honest about what was vs wasn't verified** (static check vs runtime vs screenshot
  vs recording; which surfaces of §1 were actually run). State it plainly.
- Real captions/overlays only render in a **foreground** tab — background tabs throttle
  `requestAnimationFrame`, so automated screenshots of a backgrounded tab may miss them.
- **Pages with a podcast/video MUST be verified DURING PLAYBACK.** Press play and let it
  run (≥20-30s): the subtitle pipeline (transcript fetch → cue sync → overlay pair →
  pager) only exercises while the clock advances. A loader-state-only check
  (`⏳ 字幕加载中…` visible, playback never started) verifies almost nothing — it misses
  stale-fragment accumulation, cue-sync errors, pager bugs, and ad/seek behavior.
  Capture the overlay showing a **matched bilingual pair advancing with playback**
  (screenshot for a moment-in-time claim; recording for anything about timing).

---

## 5. Manual scenario checklist

The itemized, per-feature scenarios (controls, webpage bilingual, YouTube, podcast,
i18n, providers, cross-platform, build) live in
[`docs/regression-tests.md`](regression-tests.md). For any change touching UI/DOM/layout/
a platform surface/a provider, work through the relevant sections **on every matrix
surface (§1)** and screenshot every visual item.

---

## 6. cua-driver tooling reference

- **Setup (one-time, needs the user):** install `com.trycua.driver`; grant **Accessibility
  + Screen Recording** (`cua-driver permissions grant`); register at **user scope**
  (`claude mcp add --scope user --transport stdio cua-driver -- cua-driver mcp`). Gotcha:
  before grants, `cua-driver mcp` prints a plain-text line on stdout that corrupts the
  JSON-RPC handshake — grant, then restart, then tools appear.
- **Native macOS / iOS-Simulator UI is AX-bridged** → click by `element_token` (no pixel
  math), works on backgrounded windows. Find the Simulator window
  (`com.apple.iphonesimulator`) or Safari window via `list_windows`.
- **Injected web content (our FAB/overlay) is NOT AX-bridged** → **pixel clicks**: take a
  `get_window_state` window screenshot (`screenshot_out_file` + low `max_elements` to
  avoid dumping a 10k-node tree), Read it, locate the element in window pixels, click
  `{x, y, window_id}`.
- **Big AX trees overflow context** — a Safari Settings tree is 250k+ chars. Pass
  `screenshot_out_file` + `max_elements`, or when it spills to a file, `jq`/`python3` out
  only the `element_token` you need. Do **not** Read the raw dump.
- **See the iOS screen cheaply:** `xcrun simctl io <UDID> screenshot x.png` then Read it.
- The cua-driver `page` tool does **not** support the Simulator
  (`Unsupported browser: com.apple.iphonesimulator`); for the sim's web DOM use Safari
  Web Inspector (Mac Safari → Develop → Simulator). On real desktop Safari/Chrome the
  `page` tool works for DOM inspection.
- **Watch for system dialogs.** Running `screencapture` from the terminal can trigger a
  macOS "allow <terminal> to record the screen" prompt — a real permission change; leave
  it for the user, don't auto-approve. Avoid triggering JS `alert/confirm` dialogs, which
  freeze the automation channel.

---

## 7. Governance

This spec is the single source of truth for verification. Changes to it should be made
deliberately and referenced from `AGENTS.md`. The separate **change-documentation rule**
(every change gets a GitHub issue capturing problem / solution / reasoning) lives in
[`AGENTS.md`](../AGENTS.md) — it is a process rule, not a verification rule, and is
unaffected by this consolidation.
