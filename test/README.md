# Regression test suite

Zero-dependency automated tests for the **pure-logic core** of the extension. Runs on
a bare Node (≥16) — no npm install, no jsdom, consistent with the project's
zero-dependency rule.

```bash
npm test        # or: node test/run.js
```

## What's covered (automated)

| File | Module under test | Scenarios |
|---|---|---|
| `translation-core.test.js` | `extension/content/translation-core.js` | language helpers (`isTranslated`, `endsSentence`, `joinCue`, `wordBreakIndex`, `looksLikeCode`), `mergeSentences` cue→sentence merge, i18n / UI-language resolution (OS default, override, live switch, fallback order), `createEngine` state machine (pending→done, retry, error, `MAX_PER_TICK`, reset), `createSubtitleEngine` (`activeAt`, sliding window, grace), `createPager` pagination |
| `translation-api.test.js` | `extension/content/translation-api.js` | each provider's request shape (Google, OpenAI, DeepSeek, GLM, Claude), custom base URL, cache (memory + `chrome.storage` key format), retry + Google fallback, `translateBatch` |

## How it works

The extension ships as browser IIFE modules (attach to `window`, use `chrome.*` /
`document` / `fetch`). `harness.js` `loadModule()` evals a source file inside a Node
`vm` sandbox seeded with just-enough stubs (`stubs.js`: in-memory `chrome.storage` +
`chrome.i18n`, a deterministic fake DOM measurer for the pager, a `fetch` recorder),
then reads the global the IIFE assigns. Each `*.test.js` registers cases via
`harness.test()`; `run.js` discovers and runs them, exiting non-zero on any failure.

## What's NOT here (manual)

DOM-heavy / browser / device behavior (webpage segmentation, YouTube & podcast
overlays, FAB, font-matching, Safari iOS) can't be tested headlessly without adding a
dependency (forbidden). Those live in **[`../docs/regression-tests.md`](../docs/regression-tests.md)**
as a screenshot-verified manual checklist.

Per [`../AGENTS.md`](../AGENTS.md), **both** the automated suite and the relevant
manual checklist must be run before every push.
