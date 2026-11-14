# v2 pack e998c2c0 独立离线复验

生成时间：2026-11-14 00:01:53 Asia/Shanghai (UTC+8)
范围：只读新包与冻结 36 条真实 input；无 --run、无付费、无网络、无 Mac、无 secret、不改仓库与旧证据。对象 adapter 仅诊断，不能正式通过。原包 `74258e36…` 与官方 partial 未动。npm 3399 / CI green / head `e998c2c03f13af0229229405bb1f7b06a3be967b` 由调用方陈述，本步未联网复核。实模型未调用不记为包失败。

## 结论

- 包复验 **passed**，已在本目录记下冻结（`FROZEN-V2.json`）。这不是 36 双盲完成。
- 发送 system 由 `verdict-contract.js` `rubricText()` 生成，sha256 `a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`，UTF-8 **2507** 字节，版本 `asr.v2` / `verdict.v2`。冻结 v1 提示词仍为 `a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6`，不会被当成 v2 发送。
- 解析器与提示同源使用 contract 的 schema、7 kind、NOTE/REASON 400，以及同一 JSON 数组示例。`slots` 明确是长度 2 的数组而非对象。quote 必须落在 reference 与**同一槽**候选。
- 真实失败夹具全部按预期拒绝：字典 `slots`、跨槽 quote、添标点 quote、超长 note、非法 kind `punctuation`、非法 JSON。数组示例 parse 通过。仅改 schema 字段的官方失败原文，在 v2 下仍给出原来的失败码。官方 v1 原文直接解析均为 `verdict-schema` 或 `bad-json`，不能混入 v2 complete。
- `slots-object-adapter.js` 未被 `parse.js` / `run-judge.js` 引用；适配结果带 `official:false`。

## Token 范围与 maxInputTokens

- 计数器：官方 `count-tokens.py`（sha `8be0c606…`）。GPT = tiktoken `gpt-4.1-mini` / **o200k_base** + cookbook 每条 +3、结尾 +3（假设，`exact=false`）。Qwen = 已钉 tokenizer.json / chat_template（sha `aeb13307…` / `a62ff0a2…`）。详见 `TOKENIZER-ASSUMPTIONS.md`。
- 未把 2507 字节当作 token 或 cap。system-only 计数另存于 `counts/token-counts.json`，只作说明。
- 36 条真实 input × 2 模型，共 72 次完整请求（system+user）token：全体 **660–889**；GPT **660–889**；Qwen **669–873**。
- 边际规则：`max(256, ceil(15% × max))` 再上取整到 64。本批 margin=256。选定 **maxInputTokens=1152**，maxOutputTokens=2048。v1 官方 72 次中该计数器与账单 input 全为差 0，仍不把 v2 计作 exact。

## 72 次全额预留 vs 旧池剩余

- 价目沿用已取官方包络：GPT `4.4e-7` / `1.76e-6`，Qwen `2e-7` / `8e-7`，sourceVersion 仍是 2026-11-13T22:42:19+08:00 那份目录钉选。
- 单次预留：GPT `0.00411136`，Qwen `0.0018688`。
- **72 次全额预留合计 `0.21528576`。** 旧池 remaining `0.19429628` **不够**。额外需要 `0.02098948`。**须重新批准**，本步未花、未请求。
- 不够的原因：按要求保持 output 2048 时，72 次输出包络预留已占 0.18874368；剩下不够覆盖 v2 实际输入上限下的输入预留。不能靠压低 maxInput 到无法装下真实提示来迁就余额。`budgetUsd` 在草稿配置里写成全额预留，只用于 sizing，不是授权。

## Dry-run

- `run=false`，`synthetic=false`，冻结 input 36 条，code=`dry-run`，`called=false`，`doubleBlindComplete=false`，72 条 inputBound 均 ok。
- 草稿配置：`/workspace/baseline-sa-sv-36-20261113/judge-prep/verify-e998c2c0-v2/config/config.draft-v2-openrouter-e998c2c0.json`。
- 仍需一次授权后的真实 36×2 v2 调用才能正式完成；完成后仍需人工审（`semanticHumanReviewed=false`）。不得把旧 GPT/Qwen 结果拼进 v2 complete。

## 夹具摘要

- PASS `array-example-parses` expected=parsed got=parsed
- PASS `raw-official-qwen-v1-rejected` expected=verdict-schema got=verdict-schema
- PASS `raw-official-gpt-v1-object-rejected` expected=verdict-schema got=verdict-schema
- PASS `raw-official-gpt-00066-still-bad-json` expected=bad-json got=bad-json
- PASS `v2-schema-copy-gpt-object-still-slots` expected=slots got=slots
- PASS `v2-schema-copy-qwen-00028-still-note` expected=note got=note
- PASS `v2-schema-copy-qwen-00055-added-punct-still-quote` expected=quote got=quote
- PASS `v2-schema-copy-qwen-1680-cross-slot-still-quote` expected=quote got=quote
- PASS `v2-schema-copy-qwen-1675-invalid-kind-still-finding-kind` expected=finding-kind got=finding-kind
- PASS `v2-schema-copy-gpt-1681-added-punct-still-quote-after-diag-adapt-only` expected=quote got=quote
- PASS `clean-v2-dictionary-rejected-slots` expected=slots got=slots
- PASS `adapter-on-dict-is-diagnostic-not-official` expected=adapted-diagnostic-only got=adapted
- PASS `parse-of-adapted-dict-text-may-succeed-but-is-not-runner-complete` expected=parsed got=parsed
- PASS `note-400-accepted` expected=parsed got=parsed
- PASS `note-401-rejected` expected=note got=note
- PASS `reason-400-accepted` expected=parsed got=parsed
- PASS `reason-401-rejected` expected=reason got=reason
- PASS `invalid-kind-punctuation-rejected` expected=finding-kind got=finding-kind
- PASS `cross-slot-real-strings-available` expected=true
- PASS `constructed-cross-slot-quote-rejected` expected=quote got=quote
- PASS `constructed-added-punctuation-quote-rejected` expected=quote got=quote
- PASS `illegal-json-rejected` expected=bad-json got=bad-json
- PASS `real-00066-illegal-json-rejected` expected=bad-json got=bad-json

可复现：`node /workspace/baseline-sa-sv-36-20261113/judge-prep/verify-e998c2c0-v2/verify-v2.js`
