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
> **Windows（验收矩阵第 8 行）:** run **`/win-matrix`**
> (`.claude/skills/win-matrix/SKILL.md`) — Windows 11 Chrome / Edge / Firefox on the VMware
> Fusion VM (the only Windows target, user ruling 2026-09-18), driven from the Mac over the network
> (`scripts/win-matrix/`). It carries the read-back criteria and the trap index, including
> how to verify YouTube subtitles without being fooled by a pre-roll ad (#325).
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

> **运营 / 社区（growth）:** 面向用户的**非产品面** —— 社区、README、官网文案、商店文案、
> 对外发的每一句话 —— 归 [`docs/growth-spec.md`](docs/growth-spec.md)。**Discord 里一律用英文**
> （2026-09-20 用户裁定，理由在 §1），中国版的微信 / QQ 群一律用中文；对外的地址发我们自己域名下的
> 307 短链而不是第三方码（§3）；文案与它描述的功能必须同版上线（§4）；别人后台的界面会撒谎，
> 判据一律是独立回读（§5）。
>
## 待办（人要做的事）

**所有需要用户人工去做、或要等外部结果的事，一律写进 `.local/TODO.md`**（gitignored，
不提交）。每次开工先读它，把「未完成」里的条目提醒一遍 —— 这是每日提醒，不是可选项。

**开工同时跑一次 `npm run issues`**（`scripts/issues-triage.js`）：把**别人**提的
issue / PR 里「我们一条都没回」的挑出来，有就 exit 1。这个仓库 53 条 issue 里 52 条
是自己开给自己的待办，于是「看一眼 issue 列表」长期等于「看自己的待办」，别人的那一条
混在里面看不出来 —— 2026-09-09 才偶然发现 #149 已经躺了 **22 天**，而提问的人读过
`AGENTS.md`、按规约先开了一个 docs-only 的领域设计 PR 等评审。**这不是积压，是有人在等。**
发现了就按规约发起评审（动领域设计的先出文档 PR 过人评审），并且**先回一句**。
**只有拿到结果并回读过（截图、API 读回、页面状态），才可以标 `[x]`**；「已经点了」「应该
好了」不算完成。新条目写清加入日期与完成判据。

## Project Overview

Safari iOS browser extension for bilingual translation — fully open source and free, with user-configurable LLM APIs. Supports:
- **Webpage translation**: bilingual display — original paragraph + translated text below, in green
- **YouTube dual subtitles**: original subtitle on top, translation appended below (sage by default, user-configurable)
- **Multi-provider LLM**: Google (free), OpenAI, Claude, DeepSeek, GLM (智谱)

## Build & Test

零依赖，不用 `npm install`。Node 底线：`npm test` **≥20**（`learn/chunk.js` 用
`CompressionStream('deflate-raw')`），其余跑真 Chrome 的门 **≥22**（内置 WebSocket）。

```bash
node build.js        # extension/ → dist/ + belliedmonkeytranslator.zip
npm run app:sync     # dist-app/ → 生成的 Xcode 工程（每次重生成 safari-project/ 之后都要跑）
```

**门禁：改了什么，就必须跑哪一门。** 下表只给**触发条件**；判据、证伪方法、以及每一门
背后那次事故，全部在 [`docs/verification-spec.md`](docs/verification-spec.md) §3 ——
那里是唯一权威，**不要在这里复述**。

| 命令 | 改了这些就**必跑** | 详见 |
|---|---|---|
| `npm test` | 每次 push | §3.1 |
| `npm run test:layout` | `extension/content/**`、`styles/**` | §3.2 |
| `npm run test:smoke` | **传输层** | §3.1.7 |
| `npm run test:app` | `app/**`、`extension/options/**`、app-bundle 的 `MODULES` | §3.1.4 |
| `npm run test:idb` | `learn/store.js` 的 `DB_VERSION` | §3.1.2 |
| `npm run test:learn` | 学习面（`extension/learn/**`、`content/learn-*`、复习相关 `app/**`） | §3.1.3 |
| `npm run test:listen` | `app/listen*.js`、`native-audio.js` 的 mic-\* 协议、`audio-bridge.swift` 输入半边、sources-view/review 的 conv 分支 | §3.1.5 |
| `npm run test:quick` | `app/quick*.js`、`app.js` 的 `#quick` 分流、app-bundle 的 `MODULES`/`MAIN_ONLY` | §3.1.6 |
| `npm run test:asr` | `content/asr-source.js`、`ws-transcribe.js`、`subtitle-adapter.js` 的流式钩子、stt 注册表的 `live*` | §3.1.9 |
| `npm run test:docs` | `learn/doc-*.js`、`docs-page.js`、`pdfjs-loader.js`、request-shape 的图片形状、`translation-api.ocr`、`app/docs.js` | §3.1.10 |
| `npm run test:wipe` | options 的清除路径、`learn/store.js` 的库命名、`chrome.storage` 键面 | §3.1.8 |
| `npm run test:inbox` | `app/native/translate-ext/ExtInbox.swift`（需 `swiftc`，只在本机跑、不进 CI） | §3.1.11 |
| `npm run test:chrome-cleanup` | `test/layout/chrome.js` | §3.3 |

**一条贯穿所有门的判据纪律**：`test:smoke` / `test:docs` / `test:quick` / `test:wipe`
的判据都是**端点或数据库收到了什么**，不是页面画了什么 —— 「整份一次翻掉」「密码被发出去了」
「库其实根本没清掉」在界面上都看不出来。

**Sync ships ON，`node build.js` 就是你要的。** `MT_SYNC=on` 自 Gate B（v1.4.0）起是
**no-op**（`build.js` 接受它并打一行黄字，免得旧肌肉记忆报错），传不传都一样。真正还活着
的开关是另一个 —— `MT_SYNC_E2E=1`，**不能用来发版**：它绕过 Gate B 的隐私文案陈旧检查，
代价是不产出 artifact（`dist/` 可 load unpacked，但没有 `.zip`，且 `.not-shippable` 标记
会让 `verify:ios` 挡住 iOS 归档路）。见 `docs/learning-design.md` §10。

装进 Chrome：Extensions → Developer mode → Load unpacked → `dist/`。
转 Safari（需 macOS + Xcode）：

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
- Release to any of the six store surfaces → invoke `/store-release`
- Adding or measuring a provider/model → invoke `/perf-tune`
- Windows row of the verification matrix → invoke `/win-matrix`
- Bugs/errors → invoke `/gstack-investigate`
- Code review/diff check → invoke `/code-review` (built in; `/code-review ultra` is the
  cloud multi-agent one, and only the user can launch it)

> **2026-09-21 清理：** 50 个从未使用过的 gstack skill 被移到 `~/.claude/skills-disabled/`
> —— 五周 457 个会话里它们的调用次数全是 0，而描述常驻每个会话的上下文。需要哪一个就
> `mv ~/.claude/skills-disabled/<名字> ~/.claude/skills/`。注意 `/gstack-upgrade` 会把它们
> 全部装回来。保留的是 `gstack-browse` / `gstack-investigate` /
> `gstack-setup-browser-cookies` / `gstack-upgrade`，以及 `gstack/` 本身（Stop hook 和
> 全局 CLAUDE.md 里 `file://` 本地渲染用的 `gstack/browse/dist/browse` 都在里面）。
