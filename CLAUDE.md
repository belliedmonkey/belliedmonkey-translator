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
> **Verification & testing:** governed by
> [`docs/verification-spec.md`](docs/verification-spec.md) (the single source of truth).
> Every verification runs the **full matrix of adapted surfaces** — iPhone + iPad
> (Xcode Simulator), macOS Safari/Chrome/Firefox (real Mac, sandboxed) — via cua-driver
> only. Follow it for any test/QA/bug-repro task.

## Project Overview

Safari iOS browser extension for bilingual translation — fully open source and free, with user-configurable LLM APIs. Supports:
- **Webpage translation**: bilingual display — original paragraph + translated text below, in green
- **YouTube dual subtitles**: original subtitle on top, translation appended below in yellow
- **Multi-provider LLM**: Google (free), OpenAI, Claude, DeepSeek, GLM (智谱)

## Build & Test

```bash
node build.js            # Copies extension/ → dist/ and creates belliedmonkeytranslator.zip
npm test                 # Pure-logic suite (zero-dep vm harness, Node ≥18 — learn/chunk.js uses CompressionStream/Response) — every push
npm run test:layout      # Layout regression corpus (real headless Chrome via raw CDP,
                         # Node ≥22) — mandatory when extension/content/** or styles/** change.
                         # Governed by docs/verification-spec.md §3.2 (incremental-adaptation
                         # contract: new site fix ⇒ new fixture red-before-fix, old fixtures stay green)
npm run app:sync         # Push dist-app/ into the generated Xcode project + patch ViewController.
                         # Run after EVERY regeneration of safari-project/ — that tree is
                         # gitignored and disposable; app/ in the repo is the real source.
npm run test:app         # Host app page comes up (real Chrome, Node ≥22) — mandatory when app/**
                         # changes. Serves the SHIPPED bundle layout (Main.html in Base.lproj/,
                         # Script.js at the root), because a flat layout hides the 404 that turns
                         # the app into a blank white screen.
npm run test:idb         # IndexedDB migration (real Chrome, Node ≥22) — mandatory whenever
                         # learn/store.js's DB_VERSION changes. It is the only change that touches
                         # data users ALREADY HAVE, and npm test cannot see it (no IndexedDB in the
                         # vm harness). See docs/verification-spec.md §3.1.2
```

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
in. **Never re-state a model name, endpoint or provider list in docs, UI strings or
code** — each copy is a consumer that stops tracking the registry and drifts (the
DeepSeek hint kept saying `deepseek-chat` long after the API rejected it).

Transport is keyed by request **format**, not vendor: `google`, `chat-compat`
(OpenAI Chat-Completions shape) or `messages-compat` (Anthropic Messages shape), read
from each entry's `type`. A custom base URL (`apiBaseUrl`) / model (`apiModel`) is
available on any entry whose `supportsBaseUrl` / `supportsModel` is set.

Cache: in-memory Map (1000 entries) + `chrome.storage.local` (TTL 12h), keyed `tr:{provider}:{lang}:{text}`.

## Content Script Load Order

Scripts are loaded in this order by manifest (IIFE pattern, no ES modules):
1. `translation-core.js` → exposes `window.TranslationCore` (platform-agnostic engine:
   subtitle state machine + sliding-window preload, pager, cue merge, language-aware
   helpers, i18n `t()`, MSG). Must load first — others depend on it.
2. `lang-detect.js` → exposes `window.LangDetect`, the OPTIONAL browser-native language
   detector (`chrome.i18n.detectLanguage`; absent on every Safari). Adapters inject it
   into the engine — the engine never probes for it. See `docs/domain-design.md` §5.3.
3. `translation-api.js` → exposes `window.TranslationAPI`
4. `dom-processor.js` → exposes `window.DOMProcessor`
5. `floating-button.js` → exposes `window.FloatingButton`
6. `content-webpage.js` → exposes `window.WebpageTranslator`
7. `content-youtube.js` → exposes `window.YouTubeTranslator` (thin adapter over TranslationCore)
8. `content-main.js` → reads settings, initializes everything

## Internationalization (i18n)

UI strings follow the browser language via `chrome.i18n`, with keys in
`_locales/<locale>/messages.json` (en, zh_CN, zh_TW, ja, ko, fr, de, es, ar, pt, ru;
`default_locale` zh_CN). Content scripts read them through `TranslationCore.t(key,
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
