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

## Status / findings (2026-06-29)
Harness verified end-to-end: the extension runs + translates on real iOS Safari
(`m.youtube.com`).

- **(a) FIXED — flex/grid-row overlap.** A sibling `.mt-translation` injected into a
  flex/grid row became a flex/grid *item* placed inline next to the original (mobile
  YouTube metadata `次点赞/观看/年前`, header, comment counts) → overlap + horizontal
  spill. Fix: `flowFixCss()` in `content-webpage.js` forces the translation onto its
  own full-width line (flex → `flex-basis:100%` + make the row wrap, recording
  nowrap→wrap for clean revert; grid → `grid-column:1 / -1`). Verified on the sim:
  metadata translations now stack cleanly below each item, no overlap.
- **(b) OPEN — video-subtitle CC-on pass.** Still pending. Hard to drive on the sim:
  autoplay is muted, the player controls auto-hide, and `&cc_load_policy=1` does not
  reliably auto-enable captions on the mobile web player. Needs captions actually
  rendering before `.mt-yt-dual` can be observed.
