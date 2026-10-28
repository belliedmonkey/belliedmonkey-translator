# RESULT · BEL-114 extension N26 halt sync

Status: **awaiting architecture scope check, then product, before merge or TestFlight.**

This branch does not merge to `main`. It does not bump marketing version, touch App Store Connect, upload TestFlight, or submit for review. Linear BEL-114 and BEL-105 stay not Done.

## Tip

- Repo: `belliedmonkey/belliedmonkey-translator`
- Branch: `cursor/bel114-ext-n26-sync-3beb`
- Base: `main` @ `58fba4944df0c737650d699d5546ecd0d134a16d`
- Tip SHA: `TIP_SHA`
- Ancestor contrast: mobiletranslator PR#16 tip `c9a51503` → squash `main` `b0ddea77`. That GitHub repo is not readable with this checkout's token (HTTP 404). The port follows the halt contract already mirrored in this repo's App host (`src/app/n26-session.js`, PR #604) and the closed `translate_fail.code` list in `build/telemetry.config.js`. It is not a wholesale copy of the 34-file mobiletranslator diff.

## Grep proof (this tip)

`extension/content/translation-core.js`:

- `HALT_IMMEDIATE` = `credit_exhausted`, `grant_unavailable`, `model_not_allowed`, `auth`
- `TIMEOUT_STREAK_MAX` = `5`
- `enterHalt` on those four codes immediately, and on `timeout` only after the streak
- `FAIL_CODES` is the telemetry closed set. `grant_invalid` / `grant_revoked` / `grant_misconfigured` fold into `grant_unavailable`. HTTP 429 and `busy` fold into `http`. No new `translate_fail` code is introduced.
- When `halted` is set, `pump()` returns without starting requests.

`extension/content/fail-surface.js` maps the row click: the four immediate codes open `options.html#grant` or `#engine`; a timeout halt retries. `showAutoRetry` is false.

## What was not copied

mobiletranslator's 34-file list also touched locales, `safari-guide.js`, options, popup, background, and CSS. Those were not overwritten. The fail-surface strings already exist in `_locales` (added with the App host). Settings anchors `#grant` and `#engine` already exist. App listen host and `src/app/n26-session.js` were not changed.

## Files

- `extension/content/translation-core.js`
- `extension/content/fail-surface.js` (new)
- `extension/content/content-webpage.js`
- `extension/content/subtitle-adapter.js`
- `extension/manifest.json` (load `fail-surface.js` after `translation-core.js` in both content-script blocks)
- `test/n26-fail-halt.test.js` (new)
- `docs/domain-design.md` (N26 halt table, pending architecture review)
- `docs/interaction-spec.md` (row click / non-escalation)
- `README.md`, `README.zh-CN.md` (content script count 37 → 38)

## Tests

- `test/n26-fail-halt.test.js`, `test/grant-errors.test.js`, `test/halt-auth.test.js`: 38 passed
- `test/translation-core.test.js` and `test/no-hardcoded-copy.test.js`: passed (189 together with the suites above in that run)
- `npm test` on this machine: 2760 passed, 2 failed before the README count fix. After the count fix, `test/readme-facts.test.js` is green.
- Remaining local failure is pre-existing and environmental: `test/ext-reg-gates.test.js` X10 wants `dist/`, `dist-china/`, and `dist-firefox/` newer than HEAD. Those trees are not in the checkout. The test returns immediately when `CI` is set, which is how GitHub Actions runs `npm test`. This change does not build or publish those artifacts.

## Not done (on purpose)

- No merge to `main`
- No TestFlight, no marketing bump, no App Store submit, no PPO
- BEL-114 / BEL-105 not marked Done
- Full-matrix device verification (iPhone, iPad, macOS Safari/Chrome/Firefox) was not run here
