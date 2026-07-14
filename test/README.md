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

## Layout regression suite (`test/layout/`) — real browser, still zero-dep

`npm run test:layout` (Node >= 22) drives the **sibling renderer in a real Chrome
layout engine** — the one thing the vm harness cannot do. It is still
zero-dependency: a raw CDP client over Node's built-in WebSocket launches a
throwaway-profile Chrome, loads `dist/` (`Extensions.loadUnpacked`), serves
`test/layout/fixtures/*.html` on localhost, intercepts the Google endpoints with
canned deterministic translations (`【译】` + original, offline), and asserts geometry
invariants in the extension's isolated world. Screenshots + `results.json` land in
`test/layout/artifacts/` (gitignored). Governed by
[`../docs/verification-spec.md`](../docs/verification-spec.md) §3.2, including the
**incremental-adaptation contract**: every site-layout fix adds a fixture that failed
before the fix, and all older fixtures must stay green.

Fixture authoring rules:

- One layout pattern per file, fully self-contained: inline CSS only, system
  `sans-serif` (no font loading), no external resources, total height < ~1100px
  (the viewport scheduler only translates near-viewport units).
- Natural English/Arabic sentences (the segmenter's code/symbol heuristics skip
  artificial strings).
- Expectations live INSIDE the page in a `<script type="application/json"
  id="mt-expect">` manifest: `unitCount`, per-target named assertions
  (`sameLeft:2`, `centeredInParent:3`, `ownRow`, `withinCardBounds:2`, ...),
  `mutations` (parent changes the renderer is EXPECTED to make — their absence
  fails), `skipUniversal` opt-outs, `rerender` (re-assert after a
  settings-change disable/enable cycle). Vocabulary: `test/layout/assert-lib.js`.
- Universal invariants run on every unit automatically: translation visible,
  **contains a real canned translation** (【译】 marker — kills vacuous greens from
  pending/error placeholders; error fixtures opt out via
  `skipUniversal.translationContent`), below its original, original geometry
  stable, parent styles unpolluted, no horizontal overflow (document-scoped;
  opt out only with `["*"]`).
- Manifest extras: `countMode: "error"` + `failTranslate: true` for error-path
  fixtures (the runner fails translate requests via `Fetch.failRequest` and waits
  for terminal error chips instead of 【译】 translations), `timeoutMs` for slow
  fixtures, `rerender: true` to re-assert after a settings-change
  disable/enable cycle.
- RTL: centered column (fixture 11) AND indented column (fixture 13 — pins the
  `margin-inline-start` logical-property mirror; a physical `margin-left` is
  dropped by the RTL over-constrained rule and failed this fixture by exactly
  the indent). Dark mode is excluded: every invariant here is geometric; colors
  are owned by the device matrix screenshots.
- Chrome runs `--headless=new` by default; set `MT_LAYOUT_HEADED=1` for a
  visible window (pairs with `--keep` for debugging).
- Known accepted gaps (documented, not silent): the `__mtLayoutCss` hidden-node
  *read* path has no organic trigger in fixtures (mutation-survivor; the cache
  *write* is pinned by fixture 09, whose `cachedLayoutCss` regex is exempt from
  the never-edit rule if the CSS serialization changes); `column-reverse` flex
  behavior is an open renderer decision; viewport-resize/orientation re-measure
  is not implemented (frozen-px philosophy, same as font sizing) — tracked on
  the suite's GitHub issue.

## What's NOT here (manual)

Browser/device behavior beyond Chromium geometry (YouTube & podcast overlays, FAB
dragging, Safari iOS/WebKit rendering, visual color/contrast) can't be tested
headlessly without adding a dependency (forbidden) or a real device. Those live in
**[`../docs/regression-tests.md`](../docs/regression-tests.md)**
as a screenshot-verified manual checklist.

Per [`../AGENTS.md`](../AGENTS.md), **both** the automated suite and the relevant
manual checklist must be run before every push.
