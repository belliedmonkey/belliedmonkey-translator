# AGENTS.md

Guidance for AI agents working on this repo. (Format follows https://agents.md/.)

## Project overview

「大肚猴翻译 / BelliedMonkey Translator」— an open-source browser extension for
bilingual translation. Targets **Safari iOS** (primary) and **Chrome/Firefox**.
Webpage mode shows the translation under each paragraph; YouTube mode shows a
bilingual subtitle line under the original caption. Multi-provider, fully
configurable LLM APIs. The provider list is a **build-time region flavor**
(`global` / `china`) resolved from a single registry — see "Provider registry &
region flavors" below and `docs/domain-design.md` §7.

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

## Provider registry & region flavors (合规双分发) — domain design

**The provider transport model lives in [`docs/domain-design.md`](docs/domain-design.md) §7** and is
governed by the same human-review rule above. Key invariants:

- **One registry, four consumers.** `build/providers.config.js` is the single
  source of truth for providers; the build emits `content/providers.gen.js`
  (`window.MT_FLAVOR` + `window.MT_PROVIDERS`) read by the transport, options, and
  popup. Do **not** re-introduce a hardcoded provider list anywhere.
- **Transport is format-keyed, not vendor-keyed** (`google` / `chat-compat` /
  `messages-compat`). Never hardcode a vendor endpoint in `translation-api.js`.
- **Region flavor is decided at build time, never at runtime.**
  `node build.js --flavor global|china` and `bash build-safari.sh [china]` produce
  two independent binaries / bundle ids (`com.belliedmonkeytranslator` vs
  `com.belliedmonkeytranslator.cn`) → two App Store app records. Rationale: China
  mainland legal isolation (App Store Guideline 5 / MIIT) forbids OpenAI/ChatGPT
  references, and one app record serves one binary to all storefronts.
- **China build is brand-free and gated.** The china flavor carries no
  Google/OpenAI/Claude and no vendor brand strings; `build.js` runs a **compliance
  gate** over `dist-china/` (fails on `/ChatGPT|OpenAI|Claude|api.openai|api.anthropic/i`).
  Any change to china-flavor providers/labels must keep that gate green.

## Change documentation — every change gets a GitHub issue

**All changes must be recorded in a GitHub issue** (`gh issue create`) that
captures, for each problem addressed: the **problem** (what was wrong + how it was
observed), the **solution** (what changed and where), and the **reasoning behind
it** (root cause, why this approach, trade-offs/alternatives considered). Keep the
issue updated as related work lands, and reference it from commits/PRs. The goal
is a durable record of not just *what* changed but *why* — so the thinking behind
each fix is preserved, not just the diff.

## Device verification (mobile / real surfaces)

**Verify on real device surfaces by DRIVING the UI, not by reasoning.** The
standard harness + workflow is in [`docs/device-verification.md`](docs/device-verification.md):
the **cua-driver** computer-use MCP drives macOS + the **iOS Simulator** (Safari),
and there is a verified pipeline to build → install → enable → test this extension
in real iOS Safari (`m.youtube.com`). Use it for any "test on a device" /
mobile-regression / iOS-Safari task. `claude-in-chrome` only covers desktop Chrome.
Key gotchas live in that doc (cua-driver permissions + user-scope MCP + clean-stdout
handshake; iOS UI is AX-clickable by element_token but web content needs pixel
clicks; dump big AX trees to a file and jq/python the token out).

## Build & run

```bash
node build.js                     # global Chrome/Safari build → dist/ (+ belliedmonkeytranslator.zip)
node build.js --flavor china      # china build → dist-china/ (+ -china.zip); runs the compliance gate
node build.js firefox             # Firefox build → dist-firefox/ + .xpi
bash build-safari.sh              # global Safari Xcode project (needs FULL Xcode)
bash build-safari.sh china        # china Safari Xcode project (bundle id …​.cn)
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

## Regression testing — run BEFORE every push (mandatory)

**Every change must pass regression tests before it is pushed.** No exceptions —
this is a hard gate, not a suggestion.

1. **Automated logic suite — `npm test`** (zero-dep, `node test/run.js`). Covers the
   pure-logic core: the translate-ahead subtitle engine + state machine, cue→sentence
   merge, i18n / UI-language resolution, and every provider's request-building /
   caching / retry-fallback. **It must be green** before you push. When you change or
   add logic, **add/update tests in the same commit** so the suite keeps covering it.
2. **Manual / device checklist — [`docs/regression-tests.md`](docs/regression-tests.md).**
   For any change touching UI, DOM, layout, a platform surface, or a provider, **work
   through the relevant sections** on the built + loaded extension and **screenshot
   every visual item** (a DOM element existing is not proof the user sees it — see the
   Verification section above). Drive surfaces via **cua-driver only**.

The suite has **no dependencies** — `npm test` runs on a bare Node (≥16). If you add a
feature that isn't headlessly testable (needs a real DOM/browser), cover it in the
manual checklist instead and say so in the PR. Never push on a red suite.

## Conventions

- **Never brand or describe this product with another product's name.** Use our
  own naming for the product and its features (no other product's brand in code,
  docs, or UI).
- Commit messages: conventional style (`fix(youtube): …`), and end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Don't commit to `main` directly; use a feature branch.
