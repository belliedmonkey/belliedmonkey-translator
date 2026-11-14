# Re-verification of judge package 3ee413a0

Timezone: Asia/Shanghai (UTC+8). Built 2026-11-13 21:31:11 +0800 (CST).

Original archive was not modified. Frozen two-arm input and pair manifest were not modified. Previous audit under `judge-prep/audit/` was not overwritten. No CLI `--run`, no real LLM, no env secret read, no network, no SA/SV rerun, no Mac, no repo write.

## Package pin

- Path: `/cursor/stores/user/grok-bot/agents/e8195c0f-e3a2-46a7-bda6-acf61585317c/assets/01M7AHBGMRMKB80TS561PPJR6H.gz`
- 14470 bytes, sha256 `042a39e835d3d54dc1c967d0e3464114e3499ee7fc18efcb0a5b8df8a363f511`
- Claimed head `3ee413a0731f862397051b644e730cbb15e45cbf` (not re-checked against git; this is an independent archive)
- Safe unpack, no traversal/links; inner SHA256SUMS all OK
- Prompt template sha256 `a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6` (matches claim)
- Unchanged from previous pack: README.md, assign.js, parse.js

## Frozen two-arm artifacts (reused, not rewritten)

- `input-asr-36.json` sha256 `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1`
- `pair-manifest.json` sha256 `2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7`
- `arm-mapping.json` sha256 `0267f1078c98a2a0cdfde35b9cefeb7699db281a9f2870123c453c72c97e841a`
- Parent `judge-prep/SHA256SUMS` still `3bea1b09fd43f9b0899b9c2d3bbd9339fa734aa20b9497c75f8f8e2047e8df30`, 122 files OK after this work

## Original six defects — all PASS

1. **Zero cost no longer silently disables the budget.** Unmarked `inputUsdPerToken=outputUsdPerToken=0` with `pricedZero: false` is `price-zero-unmarked`. Explicit `pricedZero: true` is required for a free model. Provider `usage.usd: 0` is recorded as `providerUsd` and ignored for the cap; settle uses declared token rates (`fixtures/provider-usd-zero-ignored-result.json`, settled 0.00014 not 0).
2. **Timeout keeps the reserve and stops later calls.** One timeout on 2 items × 2 judges: `nCalls=1`, `code=budget-unknown`, `spentUsd` equals the reserve (0.0056), no later request files (`fixtures/timeout-keeps-reserve-result.json`).
3. **Failures write redacted request/response.** Timeout writes `requests/` with `stage=reserved`, `authorization=redacted`, `urlStored=false`, plus `responses/` (`ok=false`, `code=timeout`) and `parsed/`.
4. **Dry-run item-cap is not success.** Real CLI without `--run`, 2 items, `maxItems=1`: exit 2, `code=item-cap`, `ok=false`, `called=false`, `results=null`, `omittedIds=["fixture-2"]` (`fixtures/cli-dryrun-item-cap.meta.json`).
5. **`notAssessed` lists unevaluated ids.** Item-cap dry-run `notAssessed` is both fixture ids. After a mid-run timeout, `notAssessed` still includes both unparsed items (schema now uses `disagreement` / `sample` / `notAssessed` instead of `rows`).
6. **Reference/hypothesis is JSON, not `>>>` fences.** A payload containing `>>>` remains one parseable JSON object with the delimiter inside the string; CLI dry-run of that fixture is `dry-run` (`fixtures/malicious-text-prompt.json`).

## Budget / token guards

PASS — missing token usage fail-closes after one call (`budget-unknown`).
PASS — if one conservative reserve does not fit `budgetUsd`, no request is written or sent (`budget-blocked`).
PASS — after a near-full settle that exhausts the budget, the next call is blocked before send (`fixtures/second-call-blocked-before-send-result.json`).
PASS — `req.maxTokens` equals `prices.maxOutputTokens` and official `httpTransport` puts it in the JSON body as `max_tokens` (`run-judge.js:140`). This stream did not talk to a gateway, so it cannot confirm a future vendor honors that field (some APIs want `max_completion_tokens`).
PASS — `maxRetries` is still required and recorded in the plan, but `callJudge` no longer retries (one timeout = one attempt). That is conservative for spend. `llm-judge.md` section “失败怎么记” is stale: it still mentions retries and using provider `usd` as the budget.

FAIL / residual — **character-to-token estimate is not a safe upper bound.** `run-judge.js:337` uses `Math.ceil(chars / 4)` before send. Fixture `fixtures/chars-div4-underestimate-result.json`: 1751 chars, estimate 438, `maxInputTokens=438` passed the pre-check, the request was sent, transport reported `prompt_tokens=488` and `completion_tokens=800`. `settle()` then fail-closed (`budget-unknown`), but the call had already gone out. Reserved USD was 0.002038; a token bill at those reported counts would have been 0.002088, above the reserve. Official transport also has no input-token cap, only output `max_tokens`. This 36-item corpus has max prompt length 2697 characters (ceil/4 = 675). Until the package uses a true upper bound or a tokenizer, an official config should set `maxInputTokens` to at least 2697 and size `budgetUsd` for 72 reserves at that cap.

## 36 dry-run (no `--synthetic`, no `--run`)

`dryrun-real36/`: `code=dry-run`, `called=false`, `synthetic=false`, `results=null`, `editRates=null`, 36 item ids, `omittedIds=[]`, `notAssessed` length 36, no `requests/` directory. Config used `config.dryrun-placeholders-not-a-quote.json` (REPLACE_* models and price source; numbers are schema fillers, not a quote).

## Formal config still missing (can enter config stage)

The frozen `judge-prep/config.placeholders.json` is correctly rejected by this package (`budget-required` / missing `prices`). It was not modified.

Before a paid `--run`, the operator still must supply:

- Two explicit, different model ids (not `REPLACE_MODEL_*`)
- Price `source` and `sourceVersion` from a real list, plus `inputUsdPerToken` / `outputUsdPerToken` / `pricedZero` per model (do not invent these)
- `budgetUsd` large enough for 36 × reserve(A) + 36 × reserve(B)
- `maxInputTokens` / `maxOutputTokens` / `maxTotalTokens` / `maxRequests` (requests >= 72)
- Endpoint and key **env names**; values only at `--run` time
- Confirmation the chosen gateway honors `max_tokens`
- Decision on the residual chars/4 bound (recommended: `maxInputTokens >= 2697` for this frozen input)

A fill-in template with formulas and corpus sizing, and with all prices left null, is `cost-plan-template.json`.

**Config stage: yes** — gather gateway, model ids, and a dated price source from the user. **Paid `--run`: not yet** — models/prices are unselected, and the chars/4 input bound should be treated conservatively (or fixed) before spending.
