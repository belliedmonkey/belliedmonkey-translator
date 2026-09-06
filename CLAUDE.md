# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Domain design & governance:** the translation architecture (domain model,
> extractor/engine/renderer boundary, device principle) is maintained in
> [`docs/domain-design.md`](docs/domain-design.md). Per [`AGENTS.md`](AGENTS.md),
> any change touching the domain design must update that doc first and pass human
> domain-design review before the code changes.
>
> **Learning layer (记忆层):** the spaced-repetition domain built on captured
> `(source, translation)` pairs is maintained in
> [`docs/learning-design.md`](docs/learning-design.md), with its boundary in
> `docs/domain-design.md` §9. Core rule: **capture is a sink, never a source** —
> deleting the learning layer at runtime must leave translation byte-for-byte
> identical.
>
> **Telemetry (匿名用量事件):** designed in
> [`docs/telemetry-design.md`](docs/telemetry-design.md), governed by `AGENTS.md`
> rule 4 (amended 2026-09-05) and released through `docs/learning-design.md` §10
> Gate D. The event whitelist there is the only registry — adding an event or a
> property is a domain-design change. The China flavor sends nothing.
>
> **Verification & testing:** governed by
> [`docs/verification-spec.md`](docs/verification-spec.md) (the single source of truth).
> Every verification runs the **full matrix of adapted surfaces** — iPhone + iPad
> (Xcode Simulator), macOS Safari/Chrome/Firefox (real Mac, sandboxed) — via cua-driver
> only. Follow it for any test/QA/bug-repro task.
>
> **Shipping (发布):** run **`/store-release`**
> (`.claude/skills/store-release/SKILL.md`) for any release to any of the six
> surfaces — Apple iOS/macOS × global/China, Chrome Web Store, Firefox AMO, GitHub
> Release, and the site (`~/belliedmonkey-cc`). It is the **executable** half:
> exact commands, arguments, and a read-back criterion for every step, because on
> this path a great many "successes" are silent lies (a PATCH returns 204; an
> asset upload without its checksum sits at `UPLOAD_COMPLETE` forever; the build
> script exits non-zero even when everything worked).
> [`docs/release-checklist.md`](docs/release-checklist.md) remains the other half:
> the gates, the device matrix, the privacy-copy rule, and the Gate B history.
> Store-asset production (deciding what is stale, reshooting screenshots,
> producing the preview videos) lives in the skill's `assets.md`.

## 待办（人要做的事）

**所有需要用户人工去做、或要等外部结果的事，一律写进 `.local/TODO.md`**（gitignored，
不提交）。每次开工先读它，把「未完成」里的条目提醒一遍 —— 这是每日提醒，不是可选项。
**只有拿到结果并回读过（截图、API 读回、页面状态），才可以标 `[x]`**；「已经点了」「应该
好了」不算完成。新条目写清加入日期与完成判据。

## Project Overview

Safari iOS browser extension for bilingual translation — fully open source and free, with user-configurable LLM APIs. Supports:
- **Webpage translation**: bilingual display — original paragraph + translated text below, in green
- **YouTube dual subtitles**: original subtitle on top, translation appended below (sage by default, user-configurable)
- **Multi-provider LLM**: Google (free), OpenAI, Claude, DeepSeek, GLM (智谱)

## Build & Test

```bash
node build.js            # Copies extension/ → dist/ and creates belliedmonkeytranslator.zip
npm test                 # Pure-logic suite (zero-dep vm harness, **Node ≥20** — learn/chunk.js uses
                         # CompressionStream('deflate-raw'), and deflate-raw is a Node 20 addition) — every push
npm run test:layout      # Layout regression corpus (real headless Chrome via raw CDP,
                         # Node ≥22) — geometry asserts + in-page behavioral phases
                         # (selection / interaction / keeperGuards manifest keys: selection
                         # keeper + page-interaction invariance, fixtures 33-36).
                         # Mandatory when extension/content/** or styles/** change.
                         # Governed by docs/verification-spec.md §3.2 (incremental-adaptation
                         # contract: new site fix ⇒ new fixture red-before-fix, old fixtures stay green)
npm run app:sync         # Push dist-app/ into the generated Xcode project + patch ViewController.
                         # Run after EVERY regeneration of safari-project/ — that tree is
                         # gitignored and disposable; app/ in the repo is the real source.
npm run test:smoke       # 真实安装冒烟（real Chrome, Node ≥22）—— **改传输层必跑**。
                         # 把 dist/ 用 Extensions.loadUnpacked 装进真 Chrome，配一个
                         # custom_chat 端点（故意 OPTIONS→403、不给 CORS 头，即企业网关
                         # 的形状），打开网页翻一段，断言页面上真的出现译文、且报告走的
                         # 是直连还是扩展后台。其余各门都只看一层：npm test 看模块、
                         # test:layout 用 google 通道看渲染、test:app 看宿主页起不起得来
                         # —— 都不会因为「装上去根本不工作」而变红（2026-08-19 一天之内
                         # 三次：1.5.4 的回退是空转、1.5.5 的路线记忆毒化整页、1.5.8 被
                         # 报完全不可用时手上没有任何证据）。
npm run test:app         # Host app page comes up (real Chrome, Node ≥22) — mandatory when app/**
                         # changes. Serves the SHIPPED bundle layout (Main.html in Base.lproj/,
                         # Script.js at the root), because a flat layout hides the 404 that turns
                         # the app into a blank white screen.
                         # 也守**引擎配置的跨宿主一致性**（docs/verification-spec.md §3.1.4）：
                         # 进设置页、切「详细」、把三个下拉的每个引擎都选一遍，断言字段行的
                         # **渲染后可见性**与 EngineFields.visibility() 逐项相等。改
                         # extension/options/** 或 build/app-bundle.js 的 MODULES 时同样必跑
                         # —— 2026-09-04 报障的根因就是组件没进 App 包，而门禁只看扩展那侧。
npm run test:idb         # IndexedDB migration (real Chrome, Node ≥22) — mandatory whenever
                         # learn/store.js's DB_VERSION changes. It is the only change that touches
                         # data users ALREADY HAVE, and npm test cannot see it (no IndexedDB in the
                         # vm harness). See docs/verification-spec.md §3.1.2
npm run test:wipe        # 「清除本机全部数据」真的清干净了吗（real Chrome, Node ≥22）——
                         # 改 options 的清除路径、learn/store.js 的库命名或 chrome.storage
                         # 键面时必跑。种两个学习库（mt-learn + mt-learn-<uid>，**并故意开着
                         # 一个连接**）+ API Key + 翻译缓存，点清除，然后**回读**。
                         # 判据必须是回读：deleteDatabase 撞上未关闭的连接会发 blocked 然后
                         # 永远不落定 —— 不报错，界面照样说「已清除」，而库原封不动。
npm run test:learn       # Learning suite end-to-end in BOTH hosts (app bundle + extension review
                         # page; real Chrome, Node ≥22) — mandatory when the learning surface
                         # changes. Per-step surface sweep (labels non-empty, fg≠bg) + DB-verified
                         # tier/practice/notes flow. Cases: docs/learn-regression.md
```

**Sync ships ON, and a plain `node build.js` is what you want.** `MT_SYNC=on` was the
self-use channel for TestFlight builds 14–23, when the source switch was `false` and the
flag flipped it in the OUTPUT only. Gate B (v1.4.0) made the source switch `true`, so the
flag has been a **no-op** ever since — `build.js` accepts it and prints a yellow "no-op"
line so old muscle memory doesn't break. Nothing about a build changes if you pass it, and
nothing turns sync off if you don't. The live escape hatch is a different flag,
`MT_SYNC_E2E=1`, which is **not for shipping**: it bypasses Gate B's stale-privacy-copy
check for end-to-end testing and pays for it by withholding the artifact — `dist/` is
built and loadable unpacked, but no `.zip` is produced and a `.not-shippable` marker
blocks the iOS archive path via `verify:ios`. See `docs/learning-design.md` §10.

No npm install needed — zero dependencies. To load in Chrome: Extensions → Developer mode → Load unpacked → `dist/`.

To convert for Safari iOS (macOS + Xcode required):
```bash
xcrun safari-web-extension-converter dist/ --project-location ./safari-project --app-name "BelliedMonkey Translator"
```

## Architecture

```
extension/
├── manifest.json              # Manifest v3
├── background.js              # Service worker — state only (see Critical Safari Bug below)
├── content/
│   ├── translation-core.js    # Platform-agnostic engine: subtitle state machine, sliding-window preload, pager, cue merge, language helpers, i18n
│   ├── lang-detect.js         # OPTIONAL browser-native language detector (chrome.i18n) — absent on Safari
│   ├── translation-api.js     # All fetch() calls to LLM APIs — runs in content script
│   ├── dom-processor.js       # DomSegmenter: general standard-HTML segmentation (computed visibility, block/inline, code heuristics)
│   ├── floating-button.js     # Mobile FAB (draggable)
│   ├── content-webpage.js     # All DOM (normal + YouTube page text): DomSegmenter → engine (viewport sched) → sibling renderer
│   ├── content-youtube.js     # YouTube dual subtitles: preload transcript + translate-ahead
│   ├── yt-timedtext-observer.js # isolated document_start: records /api/timedtext URLs (Resource Timing) for Safari
│   ├── yt-hook.js             # world:MAIN hook (Chrome only) — opportunistic /api/timedtext body capture
│   └── content-main.js        # Entry point: reads settings, routes to webpage/YouTube
├── styles/
│   ├── bilingual.css          # .mt-translation, .mt-progress-bar, .mt-translate-chip
│   └── floating-button.css    # #mt-fab
├── popup/                     # Toolbar popup (quick settings)
└── options/                   # Full settings page
```

## Critical Safari iOS Bug

**The background service worker goes permanently `undefined` after device lock on Safari iOS.** `chrome.runtime.sendMessage()` from content scripts will fail silently.

**Rule**: All translation API `fetch()` calls live in `content/translation-api.js` (content script context). The service worker (`background.js`) only handles storage init, badge updates, and settings sync — never translation.

## Translation Provider Adapters

**The provider list is NOT written down here.** `build/providers.config.js` is the
single registry (`docs/domain-design.md` §7); the build emits
`content/providers.gen.js` (`window.MT_PROVIDERS`), and every runtime surface reads
it — `translation-api.js` (dispatch), `options.js` / `popup.js` (UI). Read the
registry for the current ids, endpoints, `defaultModel`s and which flavor each ships
in. **Outside the registry, never re-state a model name, endpoint or provider list —
not in docs, not in UI strings, not in code** — each copy is a consumer that stops
tracking the registry and drifts (the DeepSeek hint kept saying `deepseek-chat` long
after the API rejected it). The registry's `placeholder` field exists so the settings
UI can show an example address without becoming such a copy.

**The endpoint is used EXACTLY as stored — we concatenate nothing.** `defaultEndpoint`
is a complete request URL, path included; `content/wire-format.js` is the one place an
address is resolved, and all four transports go through it. Transport is keyed by
request **format**, declared by the endpoint URL's path suffix first
(`/chat/completions`, `/responses`, `/messages`, `/audio/speech`,
`/audio/transcriptions`) and the registry `type` second — family-closed, so a suffix
only picks a variant within one capability. See `docs/domain-design.md` §7 for why the
URL outranks `type` and why the pre-2026-08 legacy branch is permanent.

**Which optional fields go in the body is a lookup, not a probe.**
`build/model-params.config.js` is the single table of "this host + this model prefix
takes these parameters"; the build emits it into the same `providers.gen.js`
(`window.MT_MODEL_PARAMS`, flavor-filtered), and `content/request-shape.js` is the one
place a body is built — all four transports go through it. **A host the table does not
know gets the protocol minimum** (`{model, messages}`), which is why a corporate
gateway on its own domain works out of the box. Same one-registry rule as above: never
re-state a parameter capability anywhere else. Writing `false` in that table requires
a quoted server rejection (`docs/verification-spec.md` §1.0); writing `true` may cite
docs. There is no trial-and-error retry — see §7 for why the 1.5.3–1.5.9 negotiation
was removed.

**Adding a provider means measuring it, not reading its docs.** Every entry you add to
`build/providers.config.js` must have a row in `build/perf-ledger.config.js` — the
evidence ledger behind the capability table — or `npm test` goes red. Produce one with
**`/perf-tune`** (`.claude/skills/perf-tune/SKILL.md`): drive every model of that
provider that can translate, through `scripts/perf-probe.js`, against the real endpoint.
Record all three outcomes — `adopted`, `rejected` (measured, nothing worth writing), and
`unreachable` (a dated IOU) — because "measured and decided against" and "never measured"
are different facts, and only the ledger can tell them apart. `npm run perf:status`
lists what is still owed. Why measurement beats docs, in one line each: a documented
value 400s on `o3-mini`; GLM returns 200 and ignores the parameter; OpenRouter accepts
both spellings but one is twice as expensive; MiniMax returns an auth error inside an
HTTP 200.

Cache: in-memory Map (1000 entries) + `chrome.storage.local` (TTL 12h), keyed `tr:{provider}:{lang}:{text}`.

## Content Script Load Order

Scripts are loaded in this order by manifest (IIFE pattern, no ES modules):
0. Generated registries load ahead of everything: `i18n-messages.js`,
   `palette.gen.js` (→ `window.MT_PALETTE`, the brand palette + shared round-button
   style from `build/palette.config.js` — **never restate a brand hex in JS**, same
   one-registry rule as the providers; the carve-out is page-injected CSS and the
   mascot SVG, which cannot read a JS registry and instead are PINNED by build.js's
   palette gate: any hex there that the registry doesn't know fails the build),
   `providers.gen.js`, `langs.gen.js`.
1. `translation-core.js` → exposes `window.TranslationCore` (platform-agnostic engine:
   subtitle state machine + sliding-window preload, pager, cue merge, language-aware
   helpers, i18n `t()`, MSG). Must load first — others depend on it.
2. `lang-detect.js` → exposes `window.LangDetect`, the OPTIONAL browser-native language
   detector (`chrome.i18n.detectLanguage`; absent on every Safari). Adapters inject it
   into the engine — the engine never probes for it. See `docs/domain-design.md` §5.3.
3. `request-shape.js` → exposes `window.RequestShape` (请求体：发哪些可选字段 +
   怎么解回来). Loads after `wire-format.js` (uses its `hostOf`) and before every
   transport. Reads `chrome.storage` for the advanced parameters, which is why it is
   a separate file from `wire-format.js` — that one is deliberately dependency-free.
4. `translation-api.js` → exposes `window.TranslationAPI`
5. `dom-processor.js` → exposes `window.DOMProcessor`
6. `floating-button.js` → exposes `window.FloatingButton`
7. `content-webpage.js` → exposes `window.WebpageTranslator`
8. `content-youtube.js` → exposes `window.YouTubeTranslator` (thin adapter over TranslationCore)
9. `content-main.js` → reads settings, initializes everything

## Internationalization (i18n)

UI strings follow the browser language via `chrome.i18n`, with keys in
`_locales/<locale>/messages.json` (en, zh_CN, zh_TW, ja, ko, fr, de, es, ar, pt, ru;
`default_locale` **en** — the fallback for any market we have not localized;
it is `zh_CN` in the China artifact only, forked and gated by `build.js`
(`defaultLocaleGate`)). Content scripts read them through `TranslationCore.t(key,
fallback)`; popup/options use a local `t()` + `applyI18n()` over `data-i18n` /
`data-i18n-placeholder` / `data-i18n-title` / `data-i18n-aria` attributes. Always
pass a Chinese fallback so a missing key never blanks the UI. To add a UI string,
add the key to every `_locales` file (the generator lives in the session scratchpad).

Translation logic is language-agnostic: no hardcoded `zh-CN` (use
`TranslationCore.DEFAULT_TARGET_LANG`), the LLM system prompt is English, success is
`TranslationCore.isTranslated()` (non-empty, NOT `!== input`), and cue join / word
break / sentence-end use script-aware helpers (`joinCue`, `wordBreakIndex`,
`endsSentence` via `\p{Sentence_Terminal}`).

## YouTube Subtitle Strategy

**Core constraint (do not break) — see [`docs/domain-design.md`](docs/domain-design.md) §2.1:**
fetch the COMPLETE transcript up front, translate ahead in a **60-second sliding
window** (`TranslationCore.WINDOW.AHEAD_MS`), display matched whole-sentence pairs.
**No word-by-word / per-caption translation**, and once loaded the `译文准备中…`
state must not recur during steady playback.

Acquisition (must work on Safari iOS, where `world:"MAIN"` is unsupported):

1. A direct fetch of the caption-track `baseUrl` (from `ytInitialPlayerResponse`) is
   **pot-blocked** — YouTube returns HTTP 200 with an empty body. So we let YouTube
   fetch `/api/timedtext` itself (auto-enable CC; on mobile m.youtube.com the CC
   button only mounts when controls are visible, so `ensureCaptionsOn` synthesizes a
   non-pausing touch tap to surface them), which mints a valid pot.
2. `content/yt-timedtext-observer.js` (isolated world, `run_at: document_start`)
   records YouTube's own pot-bearing `/api/timedtext` URLs from the **Resource
   Timing API** onto `window.__mtTimedTextUrls` — registered before YouTube fetches,
   so the URL is never lost to buffer eviction.
3. `content-youtube.js` re-fetches that exact URL (`&fmt=json3`) → `parseJson3` →
   `mergeSentences` → engine (60s translate-ahead) → fixed centered overlay matched
   by `video.currentTime` (classes `mt-yt-orig` / `mt-yt-trans`). Ad playback is
   detected and the overlay suppressed (the ad's `currentTime` ≠ the transcript).
4. `content/yt-hook.js` (`world:"MAIN"`) is an **opportunistic** body-capture that
   only works on Chrome (forwards the body via `postMessage`); never the sole source.
5. If no transcript can be obtained, show a one-line notice (`字幕不可用`) — never a
   word-by-word fallback.

## Key DOM Markers

- `.mt-translation` — injected bilingual translation div
- `data-mt-processed` — marks a node as already translated (skip on re-run)
- `data-mt-translatable` — marks detected paragraph nodes (for tap-to-translate)
- `data-mt-hidden` — original hidden by the interleave path; the attribute VALUE stores the page's prior inline `display` (`1` = none) so disable restores it exactly (same prior-value family: `data-mt-flow-fix` for `flex-wrap`, `data-mt-pos-fix` for `position` on video containers)
- `#mt-yt-overlay` — YouTube subtitle overlay; `.mt-yt-orig` (original) / `.mt-yt-trans` (translation) lines inside it
- `#mt-fab` — floating action button

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
