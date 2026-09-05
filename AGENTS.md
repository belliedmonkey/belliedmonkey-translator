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
2. **Local first, and the free path never needs a server of ours.** Translation
   **defaults** to the user's own key, browser → provider directly, and that path
   stays fully capable forever — it is never degraded to make a paid path look
   better. A server-side model may be offered **only** as an opt-in paid
   alternative, and only where it demonstrably beats what the local path can do.
   The invariant is not "we never run a model" — it is: **a person who never pays
   and never signs in has a complete product.**
   *(Amended 2026-08-04. This rule used to read "never passes through a server of
   ours … does not yield to any feature", justified by end-to-end encryption making
   plaintext unreachable. That justification no longer holds — see rule 4 and
   `docs/learning-design.md` §8.4 — so the rule was narrowed to the part that was
   actually load-bearing: the free path's independence, not our abstinence.)*
3. **Accounts and sync are free.** The server carries only what genuinely cannot work
   without it — and the product must be complete for a signed-out user.
4. **No tracking, no content, no identity in telemetry — and server-side computation
   only as a paid, opt-in exception.** The product sends **anonymous usage events**
   (`docs/telemetry-design.md`): a fixed whitelist of event names, a random per-install
   id that is never joined to an account, and never any page content, URL, hostname,
   API key, email or server error text. It is on by default, disclosed at first run,
   switchable off in settings, and switching it off erases that install's rows. The
   **China flavor sends nothing** — `belliedmonkey.com` promises that in writing, and
   the promise stays literally true. Adding an event, a property, or a join is a
   domain-design change (governance rule below), not a code change. Model inference on
   user content (translation, quiz generation, grading) is allowed **only** when the
   user chose it and is paying for it, because it is a real recurring cost (rule 8).
   Whatever such a path processes must be disclosed for that path specifically —
   never averaged away in a claim about the product as a whole.
   *(Amended 2026-09-05. This rule used to read "No telemetry, ever … permanently
   forbidden". It was declared, never argued — issue #174 — and its cost was paid
   silently: 75 sync accounts of which 54 never produced a card, and nobody could say
   why. The owner's decision: anonymous usage events, even at the price of changing
   the privacy copy and the marketing claim. What survived is the part that was
   load-bearing — no tracking across sites, no third-party analytics, and nothing a
   user wrote or read ever leaves the device unasked.)*
5. **The server never stores media we do not own.** Third-party audio and video (a
   YouTube segment, podcast audio) is stored as a **pointer** — media id + start/end
   offsets, ~20 bytes — and replayed from the source. This is **not** a cost
   trade-off that a bigger budget could reverse: we never possess those bytes,
   obtaining them would breach the platform's terms, and redistributing them is a
   copyright matter. Full page text and screenshots are out for the same reason.
6. **Media the user generated locally may be stored — but only if the user chose
   it.** Speech synthesized by the user's own TTS engine is theirs, not a third
   party's. Such uploads are **off by default**, stated plainly in the UI, counted
   against the user's quota, and deletable in one action.
   *(Amended 2026-08-03. Rules 5 and 6 were one rule reading "the server stores no
   binary media", which conflated two different things: what we may not have, and
   what the user made. The former is a hard boundary; the latter is the user's
   call. "No binary media" was only ever an approximation of the first.)*
7. **Every account has a server-side hard quota (currently 50 MB), enforced by a
   database constraint** — never by client-side good behaviour. On reaching it: stop
   accepting new content, keep syncing progress, and say so. **Never silently drop
   data.**
8. **Charge only where the cost genuinely cannot be carried.** If some future
   feature's storage or compute is truly unaffordable, price *that feature* — and
   **never convert something already shipped free into a paid feature.**
9. **Cost is estimated before it is incurred.** Before introducing any server-side
   storage, write the bytes-per-user-per-year estimate **and its assumptions** into
   the design doc. (`docs/learning-design.md` §8.2 is the worked example.)
10. **No crippled builds.** Compliance or distribution pressure is resolved by
    narrowing *where the product is distributed* — never by shipping some users a
    version with fewer features.
11. **A server-side model feature may not ship before its local equivalent.**
    *(Added 2026-08-04 by domain-design review — see `docs/learning-design.md` §2.1.
    Appended rather than inserted next to rule 2 so that existing references to rules
    7/8/9 keep pointing at the same text.)* Any capability that depends on a model
    running on our server may be released only once the same capability already works
    on the local / self-hosted path. The hosted version may be faster or better; it
    may not be the **only** version. "Local first" on its own is a preference, and a
    preference cannot stop drift assembled from individually-sensible decisions —
    hosting always spares us the user's hardware, their configuration, and their error
    messages in eleven languages. This gate inverts that pull: **to ship the hosted
    version you must first build the local one**, so the easy path stops being a
    shortcut. Release check: *can someone who never signs in and never pays use this?*
    A "no" blocks the release.


## Interaction / UX constraints

**All user-facing interaction & layout rules live in [`docs/interaction-spec.md`](docs/interaction-spec.md)**
— the single source of truth (YouTube subtitle layout, line/paging rules, loading
state, control menu, webpage injection). When you change how translations look or
behave, update that file in the same commit. Don't scatter interaction rules here or
in code comments.

## Releasing

Before any release, work through [`docs/release-checklist.md`](docs/release-checklist.md).
It holds only what the build gates cannot see — chiefly the **cross-repo** obligation that
the two websites' privacy pages ship in the SAME version as the feature they describe
(`privacy.html` promises exactly that, in those words). A checklist is weaker than a gate;
anything on it that can become a gate should move into `build.js` and be deleted from there.

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
  `messages-compat` / `responses-compat`). The format is declared by the endpoint URL's
  path suffix first and the registry `type` second, family-closed so a suffix only picks
  a variant within one capability — see `docs/domain-design.md` §7. Never hardcode a
  vendor endpoint in `translation-api.js`.
- **Never concatenate anything onto a user-supplied URL.** `defaultEndpoint` is a complete
  request URL; `content/wire-format.js` is the only place an address is resolved, and its
  legacy branch (which reproduces the pre-2026-08 `base + path` behaviour for installs
  that never migrated) is permanent — usage telemetry (rule 4) cannot justify deleting
  it either: the installs that never migrated are precisely the ones that stopped
  updating, so they are the ones no event would ever come from.
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
bash build-safari.sh global macos # global Safari macOS — the SAME tree as iOS (see below)
BUILD_NUMBER=11 bash build-safari.sh global macos   # also set the upload build number
```

- Source lives in `extension/`; `build.js` copies it to `dist/` and validates.
- Icons: real PNGs in `extension/icons/` (source `icon.svg`). The build FAILS if
  they aren't genuine PNGs — don't emit SVG renamed to `.png`.
- **One flavor, one tree — both platforms share it.** The converter emits a
  dual-platform project (targets/schemes `… (iOS)` and `… (macOS)`, folders
  `Shared (App)` / `iOS (App)` / `macOS (App)`), and `platform` only selects which
  archive instructions you get plus the macOS-only Info.plist keys. Do **not**
  generate a `--macos-only` tree: its flat layout has no `Shared (App)`, which is
  the exact thing `scripts/sync-app-assets.js` patches, so nothing reaches it —
  the host app then ships the converter's 979-byte template instead of ours
  (`dist-app/Main.html` is ~19.5 KB). That shipped in macOS 1.4.0/1.4.1/1.4.2.
  `app:sync` now **fails loudly** on such a tree instead of printing "未生成，跳过".
- Archive from the command line with the platform's scheme (the script prints the
  exact invocation). Build numbers count per platform, but
  `CURRENT_PROJECT_VERSION` is written project-wide, so pass
  `CURRENT_PROJECT_VERSION=<n>` to `xcodebuild` when archiving the other platform
  without re-running the script.
- `npm run verify:ios` works on macOS archives too — it reads the resource root off
  the bundle (`Contents/Resources/` on macOS, bundle root on iOS). It used to
  assume iOS and report all 71 dist files missing.
- `build-safari.sh <flavor> <platform>`: flavor `global|china`, platform
  `ios|macos`. **Every run re-applies** the project settings — version (from
  `package.json`), both bundle ids, display name, and the Info.plist keys the
  stores require (`ITSAppUsesNonExemptEncryption` and `LSApplicationCategoryType`;
  the latter is macOS-only in effect but written always, because one tree serves
  both platforms and a missing category fails macOS upload with 90242).
  Only your signing config is preserved.
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
