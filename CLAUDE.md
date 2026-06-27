# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Safari iOS browser extension for bilingual translation — fully open source and free, with user-configurable LLM APIs. Supports:
- **Webpage translation**: bilingual display — original paragraph + translated text below, in green
- **YouTube dual subtitles**: original subtitle on top, translation appended below in yellow
- **Multi-provider LLM**: Google (free), OpenAI, Claude, DeepSeek, GLM (智谱)

## Build

```bash
node build.js        # Copies extension/ → dist/ and creates mobile-translator.zip
```

No npm install needed — zero dependencies. To load in Chrome: Extensions → Developer mode → Load unpacked → `dist/`.

To convert for Safari iOS (macOS + Xcode required):
```bash
xcrun safari-web-extension-converter dist/ --project-location ./safari-project --app-name MobileTranslator
```

## Architecture

```
extension/
├── manifest.json              # Manifest v3
├── background.js              # Service worker — state only (see Critical Safari Bug below)
├── content/
│   ├── translation-api.js     # All fetch() calls to LLM APIs — runs in content script
│   ├── dom-processor.js       # Leaf-block paragraph detection, bilingual injection
│   ├── floating-button.js     # Mobile FAB (draggable)
│   ├── content-webpage.js     # Full-page bilingual translation with IntersectionObserver
│   ├── content-youtube.js     # YouTube dual subtitles via MutationObserver
│   ├── content-injected.js    # Injected into page world for XHR interception (secondary)
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
1. `translation-api.js` → exposes `window.TranslationAPI`
2. `dom-processor.js` → exposes `window.DOMProcessor`
3. `floating-button.js` → exposes `window.FloatingButton`
4. `content-webpage.js` → exposes `window.WebpageTranslator`
5. `content-youtube.js` → exposes `window.YouTubeTranslator`
6. `content-main.js` → reads settings, initializes everything

## YouTube Subtitle Strategy

Primary: `MutationObserver` on `.ytp-caption-window-container`. When `.ytp-caption-segment` elements appear, translate their text and append a `.mt-yt-dual` span below. Cached so repeat captions are instant.

Secondary (progressive enhancement): `content-injected.js` injects into page main world to intercept XHR calls to YouTube's `timedtext` API, notifying the content script via `postMessage`.

## Key DOM Markers

- `.mt-translation` — injected bilingual translation div
- `data-mt-processed` — marks a node as already translated (skip on re-run)
- `data-mt-translatable` — marks detected paragraph nodes (for tap-to-translate)
- `.mt-yt-dual` — YouTube dual subtitle span
- `#mt-fab` — floating action button
