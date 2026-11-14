# Independent audit of judge package 01M7A2YMDT938TGQV83BY7T8KT

Asia/Shanghai (UTC+8). Package not modified. No `--run` CLI, no real LLM, no env secret read, no network. Library cases that exercise the run path used an injected mock transport and fake in-process env values only.

Archive sha256 `f4a58b85f79c7e8da13d2049f987802bcd0fbebbdb70320c85b0aaf422302d55`, 12101 bytes. Safe unpack: no `..`, absolute paths, links, or devices. Inner SHA256SUMS all OK. Prompt template sha256 `7899bec12e0764d4a224c4c1491d5e7ae3147b2e77a5333fa7aee1fedbe29094`.

## What holds

- Default CLI is dry-run: `called=false`, `results=null`, no `requests/` directory, env names in config are not read.
- Two judge `model` strings must differ (`schema.js` `same-model`, line 87). Missing endpoint or key in a `--run` path returns `blocked` and does not clone the other model (`run-judge.js` 265–274).
- Declared `model` is recorded on the plan and in request evidence. `responseModel` is stored separately and is not written back over the declared id (`run-judge.js` 328–331, 239).
- One `assignItems(items, seed)` mapping is shared by both judges. Seed 20261113 swapped 18 of 36 real items. Mock calls showed identical messages for judge-a and judge-b. Candidate keys and backend names are not placed in the prompt; only `slot-1` / `slot-2`. Assignment lives in `assignment.json`, not in the request body.
- Verdict schema, quote slices, abstain (empty findings + note), and identity-leak checks work. Bad JSON is `verdict: null` with the raw body kept under `responses/` and `parsed/`, and the run is not `complete`.
- `task: "translation"` exits `translation-not-open` with `results=null`. The named translation rubric is not sent.
- Reference and hypothesis strings are not executed. Empty candidate text is rejected, so a missing second arm cannot be faked with `""`.
- When `maxItems` is below the input length, a real run is `code=item-cap`, `ok=false`, `doubleBlindComplete=false`, and the leftover ids remain in `results` as incomplete. This is not a silent complete.
- Missing `usage.usd` with `budgetUsd` set is recorded as `costUnknown` (not 0) and stops later calls (`budget-unknown`). The first successful call in the missing-usd fixture was the only call (`audit/fixtures/budget-unknown-result.json`).

## Defects (package unchanged; for cloud fix)

1. **budgetUsd is ineffective when `usd` is 0.**
   - `run-judge.js` 92 (`usageOf`: `costUnknown: usd === null`), 310–313, 342–343.
   - `Number.isFinite(0)` is true, so `usd: 0` is a “known” cost, `spent` stays 0, the cap never binds, and `budget-unknown` is not set.
   - Minimal fixture: `audit/fixtures/budget-usd-zero-clean-result.json` (2 items × 2 judges, `budgetUsd=1`, transport returns `usage.usd: 0` and valid abstain verdicts). Observed: `nCalls=4`, `code=complete`, `ok=true`, `spentUsd=0`, `costUnknown=false`.
   - `audit/fixtures/usageOf-cases.json` shows the same classification.

2. **`costUnknown` on transport failure does not stop a budgeted run.**
   - `run-judge.js` 335–343. `stop = 'budget-unknown'` requires `result.ok && usdThis === null`.
   - Docs (`llm-judge.md`) say that when a budget is configured, missing cost stops later calls. A timeout sets `costUnknown=true` but continues.
   - Minimal fixture: `audit/fixtures/timeout-continues-under-budget-result.json`. Observed: 4 calls on 2×2 items with `budgetUsd=1` and a timeout transport.

3. **Timeout / HTTP failure does not leave per-item request evidence.**
   - `run-judge.js` 335–338 writes `requests/`, `responses/`, and `parsed/` only on `result.ok`.
   - Minimal fixture: `audit/fixtures/timeout-evidence-result.json`. Observed: no `requests/` or `parsed/` dirs; only `usage.json` attempts if the process finishes. Bad JSON is already retained (success-path write).

4. **Dry-run does not surface an item cap.**
   - `run-judge.js` 248–262. Dry-run is `ok=true`, `code=dry-run` even when `items.length > maxItems`.
   - Minimal fixture: `audit/fixtures/dryrun-item-cap-silent-result.json` (2 items, `maxItems=1`). The plan lists both ids and `maxItems`, but success can be mistaken for “the official 36 will complete.” Official 36 dry-run used `maxItems=36` and listed 36 ids.

5. **Capped items are omitted from `human-review.json`.**
   - `run-judge.js` 51–53: if both judges are missing, the id is not pushed to `unparsed`.
   - Minimal fixture: `audit/fixtures/item-cap-result.json`. Run code is correctly `item-cap` / `ok=false` (not a silent complete). `fixture-2` is in `results` but not in `humanReview.rows`.

6. **Reference / hypothesis fences are unsanitized.**
   - `prompt.js` 5–7 `block()` wraps text in `<<<` / `>>>` with no escaping.
   - Minimal fixture: `audit/fixtures/malicious-text-prompt.json`. A reference containing a `>>>` line closes the data fence early. The process does not `eval` the strings, but the envelope the model sees is breakable. Official data for this 36-item set does not contain that delimiter.

## Not defects, but operator constraints

- Endpoints are not required to differ, only model id strings. Two models on one gateway are allowed.
- Stock `httpTransport` only reads `usage.usd` or top-level `json.usd`. Token counts are not converted to USD. If `budgetUsd` is set and the vendor omits `usd`, the official run will stop after the first success (`budget-unknown`). That is conservative, not a cap bypass, but it will not finish 36×2 unless the operator supplies `usd` or sets `budgetUsd` to null.
- Negative `usage.usd` is not rejected; not separately fixtured.

## Real 36 pair (this stream)

Aligned 15/15/6 on verified pack + SA `aef9aa8f` + SV `f6ec838b-sv` ids. Judge `reference` is `PACK-MANIFEST.items[].raw` (human-audited publisher text). Official v1 rates stay in the original score files (SA en 36/363, zh 57/624, mixed 24/42; SV en 29/363, zh 57/624, mixed 17/42). Four items have identical hypothesis *text* from independently hashed files; SV was not copied from SA.
