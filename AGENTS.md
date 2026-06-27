# AGENTS.md

Guidance for AI agents working on this repo. (Format follows https://agents.md/.)

## Project overview

「大肚猴翻译 / BelliedMonkey Translator」— an open-source browser extension for
bilingual translation. Targets **Safari iOS** (primary) and **Chrome/Firefox**.
Webpage mode shows the translation under each paragraph; YouTube mode shows a
bilingual subtitle line under the original caption. Multi-provider: Google
(free), OpenAI, Claude, DeepSeek, Zhipu GLM. Fully configurable LLM APIs.

## Build & run

```bash
node build.js              # Chrome/Safari build → dist/ (+ mobile-translator.zip)
node build.js firefox      # Firefox build → dist-firefox/ + .xpi
bash build-safari.sh       # build + generate the Safari Xcode project (needs FULL Xcode)
```

- Source lives in `extension/`; `build.js` copies it to `dist/` and validates.
- Icons: real PNGs in `extension/icons/` (source `icon.svg`). The build FAILS if
  they aren't genuine PNGs — don't emit SVG renamed to `.png`.

## ⚠️ Verification — ALWAYS screenshot visual/UI features

**A DOM element existing is NOT proof the user sees it.** This burned us: the
YouTube translation `.mt-yt-dual` was present in the DOM (`querySelectorAll`
found it) but invisible — clipped by an ancestor's `overflow:hidden`. We wrongly
reported "working" based on the DOM check.

Rules:
- For anything the user looks at (translations, subtitles, layout), **verify
  with a screenshot** showing the actual rendered result — not just DOM/console
  checks. Confirm the text is really visible and correctly placed.
- Don't trust your own injected test hacks as proof of the shipped code. Verify
  the **built/loaded extension's** behavior, screenshot it.
- Be honest about what was vs wasn't verified (static check vs runtime vs
  screenshot). State it.
- Real YouTube/page captions only render in a **foreground** tab — background
  tabs throttle `requestAnimationFrame`, so automated screenshots of a
  backgrounded tab may not show captions.

## Architecture

- `extension/content/translation-api.js` — multi-provider translate + cache;
  `fetch()` runs in the content script (deliberate, to dodge a Safari iOS
  service-worker bug).
- `extension/content/dom-processor.js` — webpage paragraph detection + injecting
  the `.mt-translation` line.
- `extension/content/content-webpage.js` — webpage orchestration.
- `extension/content/content-youtube.js` — YouTube bilingual subtitles.
- `extension/content/content-main.js` — entry point; routes YouTube vs webpage.
- `docs/adapter-architecture.md` — planned per-layout adapter design (not yet
  implemented).

## Gotchas (hard-won)

### YouTube subtitles
- **Poll, don't observe.** A `MutationObserver` on the player subtree +
  `renderDualLine` writing into that subtree = feedback loop that freezes the
  page. Use a simple `setInterval` poll (~500ms).
- **Rollup captions** (`ytp-caption-window-rollup`, the mobile default) change
  text every frame. Do NOT drop a translation because the live caption changed
  during translation — only skip out-of-order results.
- `.caption-window` has `overflow:hidden` + fixed height. An appended line is
  clipped; inject `.caption-window{overflow:visible!important}` so it shows.
- Mobile (`m.youtube.com`) uses the SAME caption DOM as desktop
  (`#movie_player`, `.caption-window`, `.ytp-caption-segment`).
- YouTube enforces **Trusted Types**: no `innerHTML`/`insertAdjacentHTML`; use
  `textContent` + `createElement`.

### Safari / iOS
- Content scripts can be injected **twice** in the same frame — guard against
  double-init (`window.__mtMainLoaded`) and make DOM injection idempotent, or
  translations duplicate.
- **No hot reload on iOS.** Resources are bundled at Xcode build time; to test a
  code change you must re-Run in Xcode (⌘R), which reinstalls. Refreshing the
  page only re-runs the already-bundled code.
- The Safari converter (`safari-web-extension-converter`) **references `dist/`
  by relative path** (`../../../dist`) instead of copying — keep `dist/` in place
  and rebuilt; re-Run in Xcode picks up changes.
- Don't pipe the converter through `grep|tail` — a closed pipe (SIGPIPE) can cut
  off its resource step.

## Conventions

- **Never** reintroduce the words「大肚猴翻译」/「大肚猴翻译」/ "Immersive
  Translate" anywhere in code, docs, or UI.
- Commit messages: conventional style (`fix(youtube): …`), and end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Don't commit to `main` directly; use a feature branch.
