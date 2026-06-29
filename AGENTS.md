# AGENTS.md

Guidance for AI agents working on this repo. (Format follows https://agents.md/.)

## Project overview

「大肚猴翻译 / BelliedMonkey Translator」— an open-source browser extension for
bilingual translation. Targets **Safari iOS** (primary) and **Chrome/Firefox**.
Webpage mode shows the translation under each paragraph; YouTube mode shows a
bilingual subtitle line under the original caption. Multi-provider: Google
(free), OpenAI, Claude, DeepSeek, Zhipu GLM. Fully configurable LLM APIs.

## Interaction / UX constraints

**All user-facing interaction & layout rules live in [`docs/interaction-spec.md`](docs/interaction-spec.md)**
— the single source of truth (YouTube subtitle layout, line/paging rules, loading
state, control menu, webpage injection). When you change how translations look or
behave, update that file in the same commit. Don't scatter interaction rules here or
in code comments.

## Domain design (architecture) — REQUIRES HUMAN REVIEW

**The translation domain model is the single source of truth in
[`docs/domain-design.md`](docs/domain-design.md)** — the pipeline `source →
Extractor → units → Engine (state machine + scheduling + retry) → Renderer`, the
`DomSegmenter` / `SubtitleSource` / `TranslationCore` boundary, the
"split-by-source-kind-not-site" rule, and the "parsing is device-agnostic; device
differences only in a thin control/render adapter" principle.

**Governance rule (mandatory):** any change that touches the domain design — the
model, the extractor/engine/renderer boundary, the device principle, or the
`DomSegmenter` rules — **must first update `docs/domain-design.md` and pass human
domain-design review before the code changes.** Do not refactor the architecture
or add per-site / per-device branches to the segmenter without that review.
Routine bug fixes that conform to the existing model do not require it.

## Build & run

```bash
node build.js              # Chrome/Safari build → dist/ (+ belliedmonkeytranslator.zip)
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
(Layout/interaction rules → `docs/interaction-spec.md`. Technical gotchas below.)
- **Transcript via `/api/timedtext` is pot-gated.** Fetching the caption track URL
  directly returns empty (HTTP 200, 0 bytes) — YouTube requires a pot/anti-bot token.
  Don't forge it. Instead **capture YouTube's OWN request**: `yt-hook.js` hooks
  `fetch`/`XHR` and reuses the response YouTube's player already fetched (valid token).
- **Inject the hook as `world:"MAIN"`** (manifest content_scripts). A `<script src>`
  injection is blocked by YouTube's strict-dynamic CSP. `world:MAIN` is browser-injected
  and bypasses page CSP (Chrome 111+ / Safari 16.4+).
- **CC must be on** for YouTube to fetch the transcript; `enable()` clicks it on.
- **Poll, don't observe.** Drive the display with a `setInterval` (~250ms) reading
  `video.currentTime`; a `MutationObserver` on the player subtree + our own writes
  caused a feedback loop that froze the page.
- Mobile (`m.youtube.com`) uses the SAME caption DOM/player as desktop.
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
