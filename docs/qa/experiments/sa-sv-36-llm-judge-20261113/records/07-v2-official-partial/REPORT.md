# Official v2 dual-judge run 20261114-0015

Generated 2026-11-14 00:31 Asia/Shanghai (UTC+8).
Fee card t54s476: cumulative plan raised to $0.28; full 36×2 v2 blind run; no recharge.
This file is a QA report. It is not a product metric, leaderboard, or model-declared winner.

## Outcome

- `ok=false`, `code=partial`, `called=true`, **`doubleBlindComplete=false`**.
- Protocol actually used: `belliedmonkey.llm-judge.asr.v2` / `verdict.v2`, prompt sha256 `a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923` (all 72 system messages).
- 72/72 new v2 requests settled. No v1/raw/derived mix-in. Object-to-array adapter was not used as a formal pass. Quotes, notes, kinds, and JSON were not rewritten. Failures remain null.
- Anonymous assignment sha256 `3c54b9c2…e79470` matches the frozen v1 mapping (same seed, unchanged assign.js). Requests still used the v2 prompt.
- Formal config only changed `budgetUsd` to this-round remaining `0.22429628` (sha256 `e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180`). Models, envelope prices, maxInput 1152, maxOutput 2048, maxRequests 72, seed 20261113, maxRetries 0 unchanged. Draft config `f3b38dd2…` kept as the pre-budget copy.
- Public price check immediately before the run (no secrets): no listed provider rate exceeded the envelope. Qwen endpoint set changed vs the 2026-11-13 pin; max listed rates still within envelope.
- No new paid probe. Historical 32-token probes (GPT/OpenAI, Qwen/Parasail, `finish_reason=length`) were reused and are **not a hard guarantee**. This run’s providers included GPT OpenAI 35 + Azure 1; Qwen Nebius 17, Parasail 16, Venice 2, DeepInfra 1. No output exceeded max_tokens=2048.
- Secret scan clean. Keys stayed in Mac memory; nothing copied to box evidence. v1 evidence and v1 QA dir were not overwritten.
- Official ASR scores and Latin rules were not changed. Human semantic review was **not** performed: `semanticHumanReviewed=false`.

## Parse counts

- judge-a (openai/gpt-4.1-mini): **34 valid**, **2 fail**, both `bad-json`: `fleurs-public-candidates/cmn_hans_cn/1671`, `fleurs-public-candidates/en_us/1673`.
- judge-b (qwen/qwen3-235b-a22b-2507): **23 valid**, **13 fail**
  - `bad-json` (7): `ascend/00009`, `ascend/00028`, `cmn_hans_cn/1673`, `cmn_hans_cn/1681`, `en_us/1672`, `en_us/1673`, `en_us/1680`
  - `quote` (3): `ascend/00055`, `cmn_hans_cn/1675`, `cmn_hans_cn/1680`
  - `note` (3): `cmn_hans_cn/1674`, `cmn_hans_cn/1676`, `en_us/1670`
- Both judges officially valid: **22**. One item failed both (`en_us/1673`). 57 official-ok verdicts are all `verdict.v2`.
- This result stays partial. No paid backfill this turn.

## Preference (fixed rule, not a winner)

Only officially parsed, comparable slots. contentFindings = non-`format-only` findings; fewer is preferred; abstain or unparsed is not scored as 0.

- both parsed: 22
- both prefer SA: 4
- both prefer SV: 3
- both tie: 7
- split/mixed: 5
- not comparable (unparsed or abstain): 17

This is not a model-emitted winner, not a product default, and not a substitute for official edit rates.

## Human review (unfinished)

- `semanticHumanReviewCount=0`, `semanticHumanReviewed=false`, EAR not used as semantic review.
- disagreement (official kind-list rule, 17): `cmn_hans_cn/1668`, `cmn_hans_cn/1669`, `cmn_hans_cn/1670`, `en_us/1674`, `en_us/1675`, `en_us/1676`, `en_us/1677`, `cmn_hans_cn/1677`, `en_us/1678`, `cmn_hans_cn/1678`, `cmn_hans_cn/1679`, `en_us/1681`, `en_us/1682`, `cmn_hans_cn/1682`, `ascend/00004`, `ascend/00066`, `ascend/00068`
- sample (5; only 5 items agreed, seed 20261113, sampleCount 6): `en_us/1679`, `en_us/1671`, `en_us/1669`, `cmn_hans_cn/1672`, `en_us/1668`
- notAssessed (14 items missing at least one official verdict): `en_us/1670`, `cmn_hans_cn/1671`, `en_us/1672`, `en_us/1673`, `cmn_hans_cn/1673`, `cmn_hans_cn/1674`, `cmn_hans_cn/1675`, `cmn_hans_cn/1676`, `en_us/1680`, `cmn_hans_cn/1680`, `cmn_hans_cn/1681`, `ascend/00009`, `ascend/00028`, `ascend/00055`

## Cost

Envelope rates unchanged. `costUnknown=false`. No recharge.

- This round envelope settled / held: **0.0452386** (GPT 0.0302918, Qwen 0.0149468). Provider-reported: **0.03845668** (GPT 0.027538, Qwen 0.01091868).
- This-round pool started 0.22429628; remaining 0.17905768. 72 full reserve was 0.21528576; actual settled stayed under it.
- Historical (not refundable): 0.05570372.
- Cumulative consumed: **0.10094232** of 0.28; cumulative remaining **0.17905768**.
- Token ranges this run: GPT in 660–889, out 91–642; Qwen in 669–873, out 79–709.
- Elapsed 464411 ms (~00:21:11–00:28:56 Asia/Shanghai).

## Paths and hashes

- Mac QA (new, did not overwrite v1): `/Users/belliedmonkey/qa/llm-judge-v2-real-20261114-0015`
- Box evidence: `/workspace/baseline-sa-sv-36-20261113/judge-prep/v2-real-run-20261114-0015/`
- Evidence tarball sha256 `e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002`
- Pack `a81afb949cc3e7ebc807e7ac90e88b6cd520220bd519641ec3051876d3ee3f92`
- Formal config `e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180`
- RESULT.json `580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc`
- summary.json `4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f`
- usage.json `2c72567b6f04191536f84fdb42dda3971082fcb6bb561c3b53ae184478126da1`
- human-review.json `b034c87c8fc841a32e99d20967a011bf7621165bba08cfbc0f2f2fe77889c453`
- v1 pack and v1 RESULT hashes unchanged (`74258e36…`, `e1496fd4…`).
