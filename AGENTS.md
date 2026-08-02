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

## 产品原则：普惠优先（能免费尽量免费）

This project exists to be **freely and widely usable**, not to be monetized. Ask
these in order when designing anything new:

1. **Can this be done without a server?** If yes, do it without one. Anything the
   device can compute, the device computes.
2. **Translation always uses the user's own key and never passes through a server of
   ours.** This is not a cost decision — it is the foundation of the privacy
   architecture. A server that never proxies a translation never sees plaintext,
   which is the only condition under which end-to-end encryption means anything and
   under which `README.md`'s "no servers of ours in the middle" stays literally true.
   **This does not yield to any feature**, including a hosted default for users who
   have not configured a key.
3. **Accounts and sync are free.** The server carries only what genuinely cannot work
   without it — and the product must be complete for a signed-out user.
4. **The server performs no computation on user data.** No model calls, no
   server-side recommendation, quiz generation, or analytics.
5. **The server stores no binary media** — no audio, video, images, screenshots, or
   full page text. Media is stored as a **pointer** (e.g. media id + start/end
   offsets, ~20 bytes).
6. **Charge only where the cost genuinely cannot be carried.** If some future
   feature's storage or compute is truly unaffordable, price *that feature* — and
   **never convert something already shipped free into a paid feature.**
7. **Cost is estimated before it is incurred.** Before introducing any server-side
   storage, write the bytes-per-user-per-year estimate **and its assumptions** into
   the design doc. (`docs/learning-design.md` §8.2 is the worked example.)
8. **No crippled builds.** Compliance or distribution pressure is resolved by
   narrowing *where the product is distributed* — never by shipping some users a
   version with fewer features.

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

**The learning/memory domain (记忆层) lives in
[`docs/learning-design.md`](docs/learning-design.md)**, with its boundary against the
translation pipeline fixed in [`docs/domain-design.md`](docs/domain-design.md) §9.
The load-bearing rule: **capture is a sink, never a source** — if the learning layer
were deleted at runtime, translation output must be byte-for-byte identical.

**Governance rule (mandatory):** any change that touches the domain design — the
model, the extractor/engine/renderer boundary, the device principle, the
`DomSegmenter` rules, or the learning layer's Collector boundary / scheduler
contract / storage tiers — **must first update `docs/domain-design.md` (and
`docs/learning-design.md` where it applies) and pass human domain-design review
before the code changes.** Do not refactor the architecture or add per-site /
per-device branches to the segmenter without that review. Routine bug fixes that
conform to the existing model do not require it.

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

## Release state — never inferred from this repo

**Anything about publishing (which stores the product is live on, at what version,
under which listing) must be looked up in gbrain first, never derived from the
repo.** No git tag, no GitHub release, and no store link in the README says
anything about whether a build shipped — those are simply not how this project
tracks releases. The store listings, app record ids, legal pages and per-platform
status live in the marketing-site content indexed in gbrain
(`belliedmonkey-cc` / `belliedmonkey-com`).

This is not a style preference; reasoning from the repo produces confidently wrong
answers. On 2026-07-28 the absence of tags was read as "never published" while both
the App Store and the Chrome Web Store had live listings, and the local (gitignored)
Xcode project was read as the shipped version while App Store Connect was two
versions ahead of it.

The same asymmetry applies inside a release: `package.json` is the source of truth
for the *version*, but only the store knows the last accepted *build number*.

## Verification — governed by the verification spec

**All verification / testing is governed by the single source of truth,
[`docs/verification-spec.md`](docs/verification-spec.md). Every verification/testing
task MUST follow it exactly.** The load-bearing rule:

> **Every verification runs the FULL MATRIX of every surface the product has been
> adapted to — a full regression, every time.** Current matrix: **iPhone Safari** &
> **iPad Safari** (Xcode Simulator) + **macOS Safari**, **macOS Chrome/Edge**, and
> **Firefox desktop** (real Mac, sandboxed). Once a device/browser is adapted, it is
> permanently added to the matrix. Verifying on one surface is **not** verification.

The spec also carries: the per-surface build→install→enable→open-URL→drive commands,
the `npm test` automated gate (green before every push), the verification-honesty
rules (a DOM element existing is NOT proof; screenshot the built+loaded extension;
**screen-RECORDING** for behavior-over-time bugs; state what was vs wasn't verified),
the **cua-driver-only** dev norm (never `claude-in-chrome`), and the cua-driver
tooling reference. The itemized manual scenarios remain in
[`docs/regression-tests.md`](docs/regression-tests.md); the historical device-run log
is in [`docs/device-verification.md`](docs/device-verification.md).

## Build & run

```bash
node build.js                     # global Chrome/Safari build → dist/ (+ belliedmonkeytranslator.zip)
node build.js --flavor china      # china build → dist-china/ (+ -china.zip); runs the compliance gate
node build.js firefox             # Firefox build → dist-firefox/ + .xpi
bash build-safari.sh              # global Safari iOS Xcode project (needs FULL Xcode)
bash build-safari.sh china        # china Safari iOS Xcode project (bundle id …​.cn)
bash build-safari.sh global macos # global Safari macOS project → safari-project-macos/
BUILD_NUMBER=11 bash build-safari.sh global macos   # also set the upload build number
```

- Source lives in `extension/`; `build.js` copies it to `dist/` and validates.
- Icons: real PNGs in `extension/icons/` (source `icon.svg`). The build FAILS if
  they aren't genuine PNGs — don't emit SVG renamed to `.png`.
- `build-safari.sh <flavor> <platform>`: flavor `global|china`, platform
  `ios|macos`. **Every run re-applies** the project settings — version (from
  `package.json`), both bundle ids, display name, and the Info.plist keys the
  stores require (`ITSAppUsesNonExemptEncryption`, plus
  `LSApplicationCategoryType` on macOS). Only your signing config is preserved.
  `safari-project*/` is gitignored, i.e. purely local state, so the script is the
  only thing keeping it from drifting — an earlier version skipped all
  post-processing when the project already existed, and `MARKETING_VERSION` sat
  at 1.0 while `package.json` reached 1.2.0.
- Build numbers are **not** derived: App Store requires them to increase per
  platform, and iOS/macOS count separately. The script only writes
  `CURRENT_PROJECT_VERSION` when `BUILD_NUMBER=` is given; otherwise it keeps the
  existing value and tells you to check App Store Connect. The repo cannot know
  the store's state — see the release-state rule below.

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

**Every change must pass regression tests before it is pushed — a hard gate.** The
full procedure is in [`docs/verification-spec.md`](docs/verification-spec.md); in short:

1. **Automated logic suite — `npm test`** (zero-dep, `node test/run.js`) **must be green**
   before you push; add/update tests in the same commit when you change logic.
2. **Full-matrix manual/device verification** — for any change with a runtime surface,
   work the relevant [`docs/regression-tests.md`](docs/regression-tests.md) scenarios on
   **every adapted surface** (iPhone + iPad Simulator; macOS Safari/Chrome/Firefox on the
   real Mac, sandboxed), driven via **cua-driver only**, screenshotting every visual item.

Never push on a red suite; never claim coverage of a matrix surface you didn't run.

## Conventions

- **Never brand or describe this product with another product's name.** Use our
  own naming for the product and its features (no other product's brand in code,
  docs, or UI).
- Commit messages: conventional style (`fix(youtube): …`), and end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Don't commit to `main` directly; use a feature branch.
