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
- **Configure DeepSeek on every surface before verifying — never verify on the free
  Google endpoint (mandatory, 2026-07-27).** The free `translate_a/single` is not a
  stable baseline and derailed one full-matrix pass three separate ways: it returned a
  real translation and a verbatim echo for the *same* input minutes apart; its `sl=auto`
  classified a Chinese-dominant mixed block as zh and echoed the whole block, so the
  mixed-language cases never reached the code under test; and it echoed a Chinese line
  with the spaces around embedded Latin words stripped, manufacturing a duplicate-row
  symptom. Any of these turns "not exercised" into something that reads as a pass or a
  failure. **Check the provider first; do not settle for the default and explain
  afterwards.** The key lives only in the browser's extension storage — never in git,
  never baked into a build artifact. Safari's temporary extension and a default
  `web-ext` profile both wipe storage on quit, so either use a persistent profile
  (§2.E) or count "re-enter the key" as a setup step for that surface.

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

**Mandatory: desktop fullscreen playback with bilingual subtitles.** For any change
touching video subtitles, **entering native fullscreen on every desktop browser × every
video site is a required check** — the bilingual overlay must remain inside the
fullscreened player and keep advancing (and exiting fullscreen must restore it). This is
a **permanent matrix item** (per §0; it was a shipped x.com regression — overlay vanished
in fullscreen — so it is added forever):

| Desktop browser | YouTube fullscreen | x.com fullscreen | Podcast |
|---|---|---|---|
| macOS Safari | required | required | N/A (audio, no video) |
| macOS Chrome / Edge | required | required | N/A |
| Firefox | required | required | N/A |

**iOS (iPhone/iPad) fullscreen = N/A**: iOS uses the OS's *native* video-player
fullscreen (a system surface), which a DOM overlay cannot cover — a documented platform
limitation, **never** reported as passing. Verify iOS subtitles only in inline
(non-fullscreen) playback.

**Mandatory: the same-language skip, checked in BOTH directions.** The skip has a
browser-capability layer (`docs/domain-design.md` §5.3 — `chrome.i18n.detectLanguage`
exists on Chrome/Edge/Firefox, on no Safari), so the surfaces that *lack* it need a
check of their own. Testing only the rows where the feature fires would let a broken
probe — one that throws, or silently skips everything — ship to Safari unnoticed. This
is a **permanent matrix item** for any change touching the skip:

**Check the REQUEST, not the rendered line.** With an `en` target on an English paragraph
the DOM is byte-identical on every surface — a unit the engine skipped and a unit whose
echoed translation the renderer's identical-output backstop suppressed both render as
"no translation line". The only observable difference is whether the provider was
called. (Burned 2026-07-28: this table originally said Safari would "still get a
translation line"; it does not, and reading the DOM would have passed a broken detector.)

| Surface | Target `en`, long English paragraph | Target `zh-CN`, Chinese page |
|---|---|---|
| iPhone / iPad / macOS Safari | the paragraph **IS sent** to the provider (no detector — today's behaviour); no translation line is drawn either, and **no console error** mentioning `detectLanguage`. Measured on all three: macOS Safari 2026-07-28, iPhone (iOS 26.5) and iPad Air (iOS 17.2) 2026-07-28 via §1.1 | no translation lines, nothing sent (script layer, unchanged) |
| macOS Chrome / Edge | the paragraph is **NOT sent**; a French paragraph and a <60-letter English one still are | no translation lines (script layer — the detector must **not** be consulted) |
| Firefox | same as Chrome / Edge | same as Chrome / Edge |

**Mandatory: speech (TTS) is a per-surface expectation.** The on-device engine is
a browser capability, so per `docs/domain-design.md` §5.3.4 its per-surface behaviour
is named here rather than assumed:

| Surface | Expected |
|---|---|
| macOS Chrome / Edge · Firefox · macOS Safari | ▶ plays; autoplay on card open works |
| **iPhone / iPad Safari** | ▶ plays (verified 2026-08-03, iOS 17.2, 111 voices in the extension page). **Autoplay is REFUSED** — the card renders with the ▶ control enabled and nothing is spoken until tapped. This is expected; a run that reports iOS autoplay working is reporting a bug in the *test*, not a feature |

**Check that silence is reported as silence.** iOS drops `speechSynthesis.speak()`
without a gesture with no exception, no error event and no sound — so a test that
only asserts "speak() did not throw" passes over total silence. Assert on the
utterance's `start` event, or on the ▶ label flipping to its replay wording (which
only happens on a confirmed start).

**Mandatory: the learning layer (记忆层).** Permanent matrix item for any change
touching `content/learn-*.js`, `learn/**`, or the two capture attachment points
(`content-webpage.js` `renderUnit`, `subtitle-adapter.js` after `renderOverlay`). See
[`docs/learning-design.md`](learning-design.md).

Each row runs the same five steps, in order:

| # | Step | What proves it |
|---|---|---|
| 1 | **Non-interference** — translate a long article with capture **off**, then with capture **on** | Same unit count, same translation lines, no new console output. Domain-design §9.1 law 1 says translation must be *byte-for-byte* identical; a screenshot pair is the minimum, a DOM unit-count comparison is better |
| 2 | **Capture** — read 2–3 paragraphs for >3 s each, scroll past others fast | Only the dwelled ones appear in the review page. **The fast-scrolled ones must be absent** — that is the assertion that matters, and it is invisible unless you look for it |
| 3 | **Review** — open the review page, complete one full grading round | Cards render, all four grades present, source link resolves back to the page |
| 4 | **Persistence** — quit the browser / kill the app, reopen, open the review page | Scheduling state survived. On iOS this is also the only real check that a dead service worker did not take the corpus with it |
| 5 | **Origin isolation** — on the host page, evaluate `indexedDB.databases()` | **`mt-learn` must NOT be there.** The corpus lives in the extension origin; if it shows up under the host page, laws in domain-design §9.3 are broken and the user's reading history is readable by every site |

**Video cards must be verified during real playback** (§4): capture from a YouTube
video requires the playhead to actually cross the sentence, so a paused player
captures nothing — a run that "looked fine" without ≥20–30 s of playback has verified
nothing about subtitle capture.

**iOS rows:** `xcrun simctl erase` is still the only thing that refreshes content
scripts (§1.1), and any instrumentation must ship a build marker. Purge the `tr:`
cache *and* the `lq:` outbox between runs, or a previous run's captures will be
mistaken for this one's.

### 1.1 Request-level checks on the iOS simulators — the working recipe

**Achieved 2026-07-28.** An earlier note here claimed this was impossible because
simulator text entry is broken. The text entry *is* broken — cua-driver's synthesized
keystrokes arrive mangled (`http://127.0.0.1:8788` became `Aaaaaaaa…`, then `Vfff`),
`⌘V` types a literal "V" even after `xcrun simctl pbcopy`, and `⇧⌘K` does not restore
host-key delivery. But typing was never actually required: **stop configuring the app
and configure the build.**

1. Copy `dist/` to a throwaway dir and instrument the COPY only — never the repo:
   - `content/providers.gen.js` → point the provider's `defaultBase` at a local
     logging endpoint. Leaving 自定义 API 地址 empty then resolves to it, no typing.
   - `background.js` `DEFAULT_SETTINGS` → preset `targetLang` / `provider` / `apiKey`.
   - `content/translation-api.js` → `apiKey = apiKey || '<key>'`, because storage may
     already hold an empty key and `onInstalled` only fills **absent** keys.
2. `xcrun safari-web-extension-converter <throwaway-dist> --ios-only --copy-resources`,
   build with `CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO`, `simctl install`.
3. Enable the extension (page menu → 管理扩展 → toggle) and grant host access. Both are
   taps; the target-language and engine pickers are taps too. Only free text is broken.
4. Read the endpoint's log for which texts were sent.

**⚠️ `simctl install` does NOT refresh the extension's content scripts.** Reinstalling
the host app, terminating Safari, and rebooting the simulator all left the PREVIOUS
build's scripts running — with a correct new bundle verifiably on disk
(`simctl get_app_container` + grep confirmed it). Only **`xcrun simctl erase`** picked
up the new resources. Budget for that: erase wipes extension enablement, host
permission and all settings, so plan to re-grant afterwards.

**⚠️ Ship a build marker with any instrumented build.** Without one you cannot tell
"instrumented build running" from "stale copy", and every downstream reading is
uninterpretable. A fixed banner painted by a content script works:

```js
var b = document.createElement('div');
b.textContent = 'BUILD=instrumented base=' + provider.defaultBase;
b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b00;color:#fff';
(document.body || document.documentElement).appendChild(b);
```

Paint it **immediately** — content scripts run at `document_idle`, so a
`DOMContentLoaded` listener never fires and the marker silently never appears. That
false negative cost an incorrect "Safari is serving stale scripts" conclusion.
Note the banner is itself page text, so it shows up as a translatable unit in the log.

**How to see the requests.** Chrome exposes them over CDP `Network.requestWillBeSent`.
Firefox's BiDi `network.beforeRequestSent` proved **unreliable** (a run that demonstrably
translated reported zero requests) — do not trust it; and Safari has no such channel at
all. The portable instrument is to point 自定义 API 地址 at a local Chat-Completions-shaped
endpoint that logs each text and answers with a marked echo, so "was it sent" becomes
both logged and visible in the page. Always assert a **positive control** (a text you
know was translated must appear in the log); without one, "no request seen" is
indistinguishable from "I could not see".

**Purge the translation cache between runs.** It is keyed `tr:{provider}:{lang}:{text}`
with a 12h TTL, so a rerun serves the previous run's answers and issues no requests at
all — which reads as "the skip fired" for every paragraph. Either clear the `tr:` keys or
weave a per-load nonce into every paragraph of the fixture.

**And on all five rows**: set the target to something other than `zh-CN` (e.g. `ja`) and
play a subtitled video — the subtitle path must honour that target. It previously froze
to `DEFAULT_TARGET_LANG` at construction regardless of settings.

> **Measured in real content scripts (2026-07-27), keep for the next person.** Chrome:
> `chrome.i18n` exposes `detectLanguage`, returns a Promise *and* fires a callback.
> Firefox: `detectLanguage` is present but **callback-only** — it returns `undefined`,
> so a promise-only implementation never resolves there. The same English paragraph
> scores 100% on Chrome and **99%** on Firefox, which is why the confidence gate sits at
> 90 rather than 100. Neither of these is guessable from the compat tables; re-measure
> rather than assume if the wrapper is rewritten.

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
  tab (on macOS ≤ 15 it's Develop menu → 允许未签名的扩展). **Session-scoped on every macOS
  version, 26 included — see the password/persistence note below.** Then grant host
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

  - **⚠️ 允许未签名的扩展 needs the user's macOS PASSWORD (2026-07-27).** Ticking it raises a
    system authorization prompt ("Safari浏览器正尝试允许未签名的扩展"). An agent must not type
    it — hand this step to the user together with the folder pick, in ONE ask, so they are
    interrupted once rather than twice. `defaults write com.apple.Safari
    AllowUnsignedAppExtensions` is **not** a way around it: Safari's prefs live in a
    sandboxed container and the write fails outright without Full Disk Access.
  - **⚠️ That authorization is SESSION-SCOPED — it does NOT persist (corrected 2026-07-28,
    macOS 26.5.1).** The checkbox is clear again after every Safari quit and the password
    prompt returns. So **once the user has authorized, do not quit Safari** for the rest of
    the run — quitting throws their authorization away and costs them a second interruption
    for nothing. (Burned 2026-07-28: quitting to force a clean snapshot did exactly that.)
    This supersedes the earlier "once granted the setting persists".
  - **⚠️ Do NOT use the extension detail pane's 重新载入 to pick up a rebuild (2026-07-27).**
    It left the extension loaded but inert — the FAB injected and no unit ever translated.
    (Re-confirmed 2026-07-28: after 重新载入 the extension's own options page renders blank
    and a ⌘R does not revive it — its old UUID is dead.) To load a fresh build **without
    quitting**, use 卸载 then 添加临时扩展 again; reserve quit → reopen for when no
    authorization is at stake.
  - **⚠️ An off-screen Safari window screenshots BLANK — that is a capture artifact, not a
    bug (2026-07-27).** `list_windows` reporting `is_on_screen: false` while the title is
    correct means the capture will be empty white; `bring_to_front` first. Cost an
    incorrect "the extension broke the page" conclusion.

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

**⚠️ Rebuilding `dist/` is NOT enough — reload the extension (burned 2026-07-26, twice).**
An already-loaded unpacked extension keeps serving the content scripts it loaded with;
a page reload runs the OLD code. Symptom: you rebuild with a fix, reload the tab, the bug
is still there, and you conclude the fix does not work. On a **long-lived** Chrome
(`chrome://extensions` → the extension's ⟳ **reload** icon) this is mandatory after every
`node build.js`; then reload the page. **Firefox has the same trap** (§2.E:
`about:debugging` → **重载 / Reload** on the temporary add-on, then reload the page) — and
Safari's temporary extension is worse still, being a snapshot (§2.C). Only the throwaway
CDP flow below is exempt, because it loads the extension fresh each run.

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
  --profile-create-if-missing --keep-profile-changes \
  -p "$HOME/.mt-verify-firefox" \
  --start-url "<test-url>" --no-config-discovery
```

**Use a PERSISTENT profile, not the default throwaway one.** §0 requires DeepSeek, and
the API key lives in extension storage — a throwaway profile wipes it on every quit, so
each run would need the key re-entered by hand. `--profile-create-if-missing
--keep-profile-changes -p <dir>` keeps the key (and the granted permissions) across
runs. The profile dir is outside the repo and holds only the key, so it never reaches
git; delete it to reset. This is still fully sandboxed — it is NOT the daily browser
profile.

`web-ext run` (Mozilla's official tool, npx-fetched — not a repo dependency) launches a
**fresh throwaway profile** with the add-on temporarily installed (auto-clears on quit;
it live-references `dist-firefox/`, and about:debugging has a per-extension **Reload**
button — friendlier than Safari's snapshot semantics).

**⚠️ A PENDING Firefox update blocks this row entirely (2026-07-27).** If an update is
staged under `~/Library/Caches/Mozilla/updates/Applications/Firefox/updates/0/`
(`update.mar` present), every launch hands off to `org.mozilla.updater`, which then waits
for **all** Firefox instances to quit — so the daily browser being open leaves it spinning
forever and `web-ext` dies with `ECONNREFUSED` on its debugger port. It looks like a
web-ext/harness failure and is not. `--pref app.update.*=false` does **not** help: the
staged update is applied by the launcher before prefs are read. Check first:

```bash
ls ~/Library/Caches/Mozilla/updates/Applications/Firefox/updates/0/update.mar 2>/dev/null
pgrep -x firefox; pgrep -f org.mozilla.updater
```

The fix is the user's call, not the agent's — ask them to quit Firefox so the update
applies (they get the security update and it stops recurring). Moving the staged update
aside works too but touches their update cache, so it needs explicit consent.

**⚠️ That Reload button is mandatory, not optional (burned 2026-07-26).** Like Chrome
(§2.D), a loaded add-on keeps serving the content scripts it started with: after
`node build.js firefox` you must hit **重载 / Reload** on the add-on in
`about:debugging`, *then* load the page — otherwise you are testing the previous build
and will wrongly conclude the fix failed. **A logged-in session is a reason to prefer
the real profile over `web-ext run`:** the throwaway profile has no cookies, so for a
login-gated site load the temporary add-on into your normal Firefox instead
(`about:debugging` → 临时载入附加组件 → `dist-firefox/manifest.json`; it still
auto-clears when Firefox quits). Manual alternative:
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

**Learning layer (记忆层).** `learn-model.js` and `learn-scheduler.js` are pure by
construction and belong here in full; `learn-collector.js` is testable with an
injected clock and an `IntersectionObserver` stub. All three land in §3.1.1's line of
fire, and the mapping is not optional:

- **(1) production config** — the scheduler must be asserted against the exported
  `DEFAULTS`, with one case passing a deliberately partial config. A scheduler whose
  `dailyNew` silently reads `undefined` still returns a plausible-looking deck.
- **(2) work not done** — a segment below the dwell threshold must produce **zero**
  storage writes, and a mature card must be **absent** from the deck. Both are
  invisible in the output; only call counts see them.
- **(3) resource lifetime** — `disable()` must disconnect every `IntersectionObserver`
  and clear the flush timer. Inject recording stubs; do not assume cleanup.

#### 3.1.1 Three blind spots a green suite does not cover

Found the hard way (2026-07-28): a pre-landing review caught three defects in a
feature whose suite was 76/76 green, one of which silently disabled the whole
feature. None were oversights — each sat in a place the assertions structurally
could not look. When you add a test, ask which of these it needs:

1. **Assert on the config PRODUCTION builds, not one the test assembles.** The
   detector tests passed `createEngine` a window object they had built correctly;
   the bug was in the partial literal an *adapter* writes. A default that a caller
   can silently omit fails open (`n <= undefined` is false), so the guard vanishes
   with every test still green. Prefer merging over defaults (`Object.assign({},
   WINDOW, cfg.window)`) so a partial override cannot be wrong, and keep one test
   that passes the *incomplete* shape on purpose.
2. **Assert on work NOT done, not only on output.** A wasted provider call, a
   redundant IPC, or a skipped unit produces byte-identical output. If the feature's
   value is a negative — "this is not sent", "this is not asked" — then only a
   call-count or a request log can see it. This project's whole same-language skip
   is such a feature; `expectNotRequested` (§3.2) and `asked === 0` unit assertions
   exist for exactly this reason.
3. **Assert on resource lifetime where it matters.** Timers, caches and retained
   strings are invisible to outcome assertions. The vm harness merges whatever
   globals you pass, so inject a recording `setTimeout`/`clearTimeout` rather than
   assuming cleanup happens.

The recurring shape behind all three: **a green suite proves the happy path
produced the right output; it proves nothing about cost, cleanup, or wiring.**

### 3.2 `npm run test:layout` — layout regression corpus

`npm run test:layout` (`node test/layout/run-layout.js`, zero-dep, Node ≥22 for the
built-in WebSocket) drives the **real sibling renderer in a real Chrome layout engine**:
it builds `dist/`, loads it into a throwaway-profile Chrome via the §2.D CDP
`Extensions.loadUnpacked` flow, serves the local fixture pages in
`test/layout/fixtures/` over localhost, intercepts the Google translate endpoints with
canned deterministic responses (fully offline), and asserts geometry invariants on the
injected `.mt-translation` siblings (below the original, same column, no parent-style
pollution, no horizontal overflow, …). A fixture can also declare a **mid-run
viewport change** (`resize` in its manifest — `Emulation.setDeviceMetricsOverride`),
which re-runs every assert after the renderer's debounced re-measure: that is the
rotation / window-resize / media-query-breakpoint path. Screenshots land in
`test/layout/artifacts/` (gitignored, pid-locked so concurrent runs don't clobber
each other) for human eyeballing. ~50s wall time (headless Chrome).

Two manifest keys reach beyond geometry, because some behaviour is **invisible in the
DOM**:

- `"cfg": {…}` overlays the run's settings for that fixture — `targetLang` above all.
  Fixtures default to a `zh-CN` target; the same-language rules behave differently under
  a Latin target, and that path needs its own fixture (29).
- `"expectNotRequested"` / `"expectRequested"` assert on the **provider requests the
  page actually issued** (the harness already intercepts them). This is the only way to
  test a unit the engine skips ahead of time: the renderer's identical-output backstop
  would suppress that line anyway, so the rendered DOM is byte-identical with and
  without the skip — what changes is the request that was never sent, i.e. the user's
  quota. A DOM-only fixture for such a change passes for the wrong reason and would
  stay green if the feature were deleted.

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

**Learning layer.** The Collector is a sink and must be geometrically inert, so it
owes this suite a fixture of its own: with capture enabled, **every geometry
invariant must hold unchanged**, and the injected `.mt-translation` siblings must
never themselves be collected (domain-design §9.1 law 4). When the in-page review
card lands, it injects DOM into the page and therefore falls under the contract above
in full — new fixture, **red before the change**, all pre-existing fixtures green.

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

---

## Safari bundle completeness — a gate, because the build cannot see this

`xcrun safari-web-extension-converter` captures the extension's **file list** at
conversion time. Files added to `extension/` afterwards are never referenced by the
Xcode project, so they are silently absent from the built `.appex` — while the build
succeeds, the manifest validates, and every one of our own gates stays green.

**This had already happened.** The entire `learn/` directory was missing from the iOS
build. The visible consequence was not "the learning feature is absent": `options.html`
loaded seven scripts that were not there, `options.js` threw on the first undefined
global, and **the whole settings page was dead — including the field where the API key
is entered**. Found by running the matrix, not by any test.

Before any iOS/macOS verification run, and before any Safari release:

```bash
node build.js
xcodebuild -scheme "BelliedMonkey Translator (iOS)" \
  -destination 'id=<SIM_UDID>' -configuration Debug \
  -derivedDataPath /tmp/bt-dd CODE_SIGNING_ALLOWED=NO build
npm run verify:ios            # every dist/ file must exist in the .appex
```

A non-zero exit means **regenerate the project** (the command is printed in the
failure) and rebuild. Do not hand-add files in Xcode: the next added file reproduces
the same silent gap.

---

## 更正与未决（iPhone 行，2026-08-05）

**更正一条已推送的错误声明。** commit `8036d83` 的信息里写着「同一篇 Wikipedia、同一个
DeepSeek key……改后 30 秒内全部渲染」。**那次的译文其实来自免费 Google 端点**，不是
DeepSeek——覆盖安装（`simctl install` 不卸载）**会清空扩展设置**，而我只验证了代码
刷新、没验证存储保留，就把结论说满了。

识别它的信号当时就在眼前：那段译文前后大半是**原文回显**，正是本文件 §0 记录的免费
端点典型故障，我却当成模型质量问题带过去了。**「验证用的是不是你以为的那条路」必须
在每次重装后重新确认，不能沿用。**

重配 DeepSeek 后已重新验证：译文全中文、无回显。所以

- 悬挂 promise 的修复 **成立**（该 bug 在 fetch 之前，与引擎无关）；
- 「iOS 上 DeepSeek 端到端翻译」**现在才成立**。

### 本行仍未验证

- 采集是否真的写入学习库、复习页、TTS、长按加星。
- **已修但未在设备上验证**：Safari iOS 上**扩展页读不回 `chrome.storage.local`**。
  决定性证据：设置页重新加载后显示 Google，而**同一时刻内容脚本正拿着已保存的
  DeepSeek key 成功翻译**。所以写入是好的，读不回来的只有扩展页（设置页、弹窗、
  复习页）。用户的真实体验是「每次打开设置页配置都像消失了，得重填 API Key」。
  修法见 `extension/learn/page-settings.js`：**机制尚未隔离**（需要 Web Inspector），
  所以不赌任何一种——正常数组读一次；仅当结果里一个目标 key 都没有时才回退到整桶读
  并过滤。数组形式正常的平台上零变化。有 5 个单测，其中一条专门断言「正常路径只有
  一次调用」，避免让所有平台替 Safari 买单。
  **状态：验证不通过，缺陷仍然存在。** 2026-08-05 在设备上按预先写死的判据验收——
  配好 DeepSeek → 离开设置页 → 重新打开——**仍然显示 Google**。

  否定结果缩小了范围：整桶读 `get(null)` 也拿不回来，**所以不是「数组形式不被支持」**。
  扩展页在该平台上似乎完全读不到 `chrome.storage.local`，而同一设备上的内容脚本读得到，
  且这个页面自己的写入确实持久化了（内容脚本能看到）。

  `page-settings.js` 保留但**已在文件头标注它不是修复**——只是让扩展页的读取变得防御性
  （不抛、不挂、不返回 undefined），并把重试收在一处。**下一步只有 Safari Web Inspector**：
  除了 console，没有别的办法区分「读返回了空」和「读根本没返回」。
- **（此前记为独立缺陷的）弹窗显示 Google**：同一根因，不是两个 bug——设置页显示
  DeepSeek 且译文确由 DeepSeek 产生时，弹窗仍显示「Google 翻译（免费）」并展示免费
  通道提示。状态本身（已翻译/未翻译）是对的。用户会因此以为自己的 key 没生效。
  与 `options.js` 的 init 失败同族（`chrome.storage.local.get` 在该平台上的回调行为），
  但 popup 有 `s || {}` 兜底，所以不是崩溃而是**静默退回默认值**——更难发现。

### 一条操作纪律

`simctl install` 覆盖安装**会重置扩展存储**（也会重置 Safari 的扩展开关与站点授权）。
每次重装后：重新配 provider + key，并**用「译文里有没有原文回显」确认自己确实在验
预期的那条路径**。
