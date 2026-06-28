# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Safari iOS browser extension for bilingual translation — fully open source and free, with user-configurable LLM APIs. Supports:
- **Webpage translation**: bilingual display — original paragraph + translated text below, in green
- **YouTube dual subtitles**: original subtitle on top, translation appended below in yellow
- **Multi-provider LLM**: Google (free), OpenAI, Claude, DeepSeek, GLM (智谱)

## Build

```bash
node build.js        # Copies extension/ → dist/ and creates belliedmonkeytranslator.zip
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
│   ├── translation-api.js     # All fetch() calls to LLM APIs — runs in content script
│   ├── dom-processor.js       # Leaf-block paragraph detection, bilingual injection
│   ├── floating-button.js     # Mobile FAB (draggable)
│   ├── content-webpage.js     # Full-page bilingual translation with IntersectionObserver
│   ├── content-youtube.js     # YouTube dual subtitles: preload transcript + translate-ahead
│   ├── yt-hook.js             # world:MAIN hook — captures YouTube's /api/timedtext response
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

All in `TranslationAPI` (IIFE in `translation-api.js`):

| Provider | Key setting | API format |
|---|---|---|
| `google` | none | Unofficial `translate.googleapis.com` batch endpoint |
| `openai` | `apiKey` | OpenAI chat completions, model `gpt-4o-mini` |
| `claude` | `apiKey` | Anthropic messages, header `x-api-key`, model `claude-haiku-4-5-20251001` |
| `deepseek` | `apiKey` | OpenAI-compatible, model `deepseek-chat` |
| `glm` | `apiKey` | OpenAI-compatible, model `glm-4-flash` |

Custom base URL (`apiBaseUrl` setting) is supported for OpenAI-compatible providers (openai, deepseek, glm).

Cache: in-memory Map (1000 entries) + `chrome.storage.local` (TTL 12h), keyed `tr:{provider}:{lang}:{text}`.

## Content Script Load Order

Scripts are loaded in this order by manifest (IIFE pattern, no ES modules):
1. `translation-core.js` → exposes `window.TranslationCore` (platform-agnostic engine:
   subtitle state machine + sliding-window preload, pager, cue merge, language-aware
   helpers, i18n `t()`, MSG). Must load first — others depend on it.
2. `translation-api.js` → exposes `window.TranslationAPI`
3. `dom-processor.js` → exposes `window.DOMProcessor`
4. `floating-button.js` → exposes `window.FloatingButton`
5. `content-webpage.js` → exposes `window.WebpageTranslator`
6. `content-youtube.js` → exposes `window.YouTubeTranslator` (thin adapter over TranslationCore)
7. `content-main.js` → reads settings, initializes everything

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

**Preload + translate-ahead** (no per-caption lag, so a slow LLM like DeepSeek works):

1. `content/yt-hook.js` runs as a `world:"MAIN"` content script (manifest), hooking
   `fetch` + `XMLHttpRequest` to capture YouTube's OWN `/api/timedtext` response —
   the full timed transcript, carrying the valid pot/signature token YouTube
   generated. It forwards the body to the content script via `postMessage`.
   `world:"MAIN"` is required: a `<script src>` injection is blocked by YouTube's
   strict-dynamic CSP.
2. `content-youtube.js` parses the json3 transcript into timed cues, batch-translates
   them ahead of playback (`TranslationAPI.translateBatch`, in playback order), and
   displays the pre-translated `.mt-yt-dual` line by matching `video.currentTime` to
   the active cue — instant, no translation latency.
3. **Fallback**: if no transcript is captured (captions off, hook unavailable), it
   falls back to live DOM translation (poll `.ytp-caption-segment`, translate, append).

## Key DOM Markers

- `.mt-translation` — injected bilingual translation div
- `data-mt-processed` — marks a node as already translated (skip on re-run)
- `data-mt-translatable` — marks detected paragraph nodes (for tap-to-translate)
- `.mt-yt-dual` — YouTube dual subtitle span
- `#mt-fab` — floating action button
