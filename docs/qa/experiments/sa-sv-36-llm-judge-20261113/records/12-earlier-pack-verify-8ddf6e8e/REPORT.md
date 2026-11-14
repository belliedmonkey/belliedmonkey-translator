# Re-verification of judge package 8ddf6e8e (chars/4 residual only)

Timezone: Asia/Shanghai (UTC+8). 2026-11-13 21:42:34 +0800 (CST).

Offline only: no `--run`, no real LLM, no secret read, no network. Frozen 36-item input and pair manifest were not modified. Previous verify directories were not overwritten. No SA/SV rerun, no Mac, no repo write, no paid review.

## Package

- `/cursor/stores/user/grok-bot/agents/e8195c0f-e3a2-46a7-bda6-acf61585317c/assets/01M7AJ65AKYJT2H26187ZDN7TW.gz`
- 16254 bytes, sha256 `74258e362de80cf39986717b32b65ef6ec9d3719bd60d21b91af54c1d441a9fe`
- Claimed head `8ddf6e8e4d823018c2e6c5b56067b7238a8bdc22` (archive pin only; git not re-checked here)
- Safe unpack; inner SHA256SUMS all OK

## Focused residual fixture — PASS

The previous hole used fixture-1 / seed 7: content-join 1751 characters, `ceil(chars/4)=438`, `maxInputTokens=438`, then a 488-token input report after send.

Reproduced the same 1751/438 prompt. The send gate now measures the full request JSON (system + user + JSON escaping + `max_tokens`/role). That body is 1928 UTF-8 bytes, larger than the content-join, and is not treated as exact tokens (`exact: false`).

With a synthetic counter returning 488 and `maxInputTokens=438`: **no send**, `code=input-over-bound`, `called=false`, no `requests/`. Plan is written. Reserve is the full cap `438+800` tokens, reserve USD 0.0056 — not the old under-reserve based on chars/4. Fixture: `fixtures/original-488-over-438-bound-result.json`.

The same 438 cap with synthetic `utf8-bytes-plus-overhead` / overhead 0 also blocks before send (`input-over-bound`). Missing `inputBound`, or `counter` without a function, is `tokenizer-unspecified` and does not send. If a loose counter is used only to reach the post-response path and the provider reports 488/800, reserve is kept and later calls stop with `providerExceededDeclaredCap` / `budget-unknown`. Missing usage also fail-closes and keeps the plan. Insufficient budget is `budget-blocked` before send and still writes `plan.json`. `maxRetries` must be 0 (`retries-disabled` otherwise). Docs no longer prescribe retries.

These inputBound/price objects are **synthetic structural fixtures only**, not a real tokenizer, gateway, or quote.

## 36 dry-run — PASS

No `--synthetic`, no `--run`. Frozen input hash unchanged. `code=dry-run`, `called=false`, `synthetic=false`, `results=null`, 36 ids, no `requests/`. Config: `config.dryrun-structural-not-a-quote.json` (REPLACE_* / SYNTHETIC_STRUCTURAL_NOT_A_QUOTE). Max packaged request body in this set is 2891 UTF-8 bytes (not a tokenizer count).

Frozen pins still: input `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1`, pair `2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7`. Parent `judge-prep/SHA256SUMS` unchanged and still verifies.

## Official config still missing

Gateway, two explicit model ids, and a dated price list (source, version, rates, `pricedZero`) are still unselected. A real run also needs an `inputBound` that the operator can actually stand behind (model tokenizer / applicable source, or a justified utf8+overhead assertion). This package is frozen pending that real configuration. No further work or paid review from this stream.
