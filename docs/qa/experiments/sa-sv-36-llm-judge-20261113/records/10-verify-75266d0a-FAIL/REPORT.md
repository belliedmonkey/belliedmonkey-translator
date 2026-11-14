# 独立离线复验：observe 包 75266d0a / 01M7BYBRDRFCHNC7FXJJV8A3GE

**结论：复验未通过，停，不修包，不启动付费。** 功能性选 15、全 cap 预留、错误分类和「出目录与 origin 不同时不改原件」已成立，但有 6 项会影响付费范围 / 盲法 / provenance 的 fail-closed 缺口，包本身不拒绝这些危险输入。

授权范围：仅独立离线最小复验。不网络、不 Mac、不 secret、不 paid、不改 repo、不改正式 v2 证据。时间：2026-11-14 10:37:03 Asia/Shanghai (CST)。cloud 所称 3402 tests / CI green 不在本包内，本轮未重跑 CI。包内无 git head 字符串；本目录只核验 gz 哈希与字节数。

## 已核验通过的部分

- 包 `01M7BYBRDRFCHNC7FXJJV8A3GE.gz`：21194 字节，sha256 `89a6a263dfff22fb0415f30de43e5e26dfc51f92a6e1be4896aa799678179ee4`，与交包声明一致。内层 SHA256SUMS 全部匹配。
- v2 同源未改：`verdict-contract.js`、`parse.js`、`prompt.js`、`rubric.js`、`schema.js`、`assign.js`、`input-bound.js`、`slots-object-adapter.js`、`README.md` 与正式 v2 包逐文件 sha 相同。prompt sha 仍为 `a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`。仅 `run-judge.js`（`d58e7e26…937e9c6e`）与 `llm-judge.md` 及内层 SHA256SUMS 有改。
- 用已准备的精确 15 对适配为只含 schema 的 `belliedmonkey.llm-judge.selection.v1`（GPT 2 / Qwen 13，pair 集合未改）。文件：`selection/selection-15.json`。规范序列化 sha256 `c151018bfda2953d2375f8cfce25580787745f162824b66f2d7eccec641979a4`。
- 全 36 匿名输入与 seed `20261113` 重放 assignment，与正式 assignment 文件 sha `3c54b9c2…e79470` 一致。当前包 `buildPrompt` 的 72 条 messages 与正式 v2 存储请求完全一致（故官方声明 token 660–889 仍适用，均 ≤1152）。本盒本轮无 `tiktoken`/`tokenizers`，dry-run 的 counter 在确认 prompt 字节一致后回放官方 `plan.inputChecks` 声明值，不是新的付费计数。
- 真实 36 dry-run：`code=dry-run`，`called=false`。`plan.selectedPairs` 为 15，`selectionSha256` 与规范值一致。包仍对全部 72 做 input-bound（更保守，不扩大付费）；其中 15 条选中检查全部 ok。dry-run 在预留循环之前返回，15 次全 cap 预留由单价计算：`2×0.00411136+13×0.0018688=0.03251712`，与 pack 浮点一致，小于剩余 `0.17905768`（预留后余量 `0.14654056`）。草稿配置（仅供检视，**不得 --run**）：`budgetUsd=0.17905768`，`maxRequests=15`，`maxTotalTokens=48000`，其余价格 / token 上限 / 模型 / seed / `maxRetries=0` 与正式 v2 相同。
- 合成 transport、无真实网关：只发出 allowlist 15 对，57 条已有效组合未发。`supplement-complete`/`supplement-partial` 时 `singleRunComplete` 与 `doubleBlindComplete` 均为 false；`supplement.json` 标 `official=false`；有 origin 时才写 `derived-merge.json`（仅为 provenance 说明，不含合并结果表）。`--out` 与 origin 不同时，正式 origin `summary.json` sha 仍为 `4744aef1…34365f`。
- 观测分类（用正式失败原文回放）：`finish_reason=stop` 且非法 JSON → `modelFormatFault=true`、`parseCode=bad-json`；`error` 且不完整 → 非模型格式过错、`generationOk=false`；`length` 截断 → 非 `modelFormatFault`；缺 `note` / quote 失败分别留在 `parseCode`，不是 format fault。缺 usage → `budget-unknown`，预留留下并停止后续请求。`providerUsd=0` 但有 token 时按信封单价结算，不当免费（`providerUsdIgnored=true`）。
- selection 缺 item / 无效 judge / 重复 pair / 错误 schema / 空 pairs，以及 origin 路径不存在：均在调用 transport 之前以 `selection` 或 `origin-missing` 阻断。

## 未通过（影响付费范围 / 盲法 / provenance，故整包不得付费）

下列情况包会**实际发请求或覆盖输出**，没有拒绝码。不修包。

1. **成功 pair 不拒绝。** 把 origin 中已官方有效的 `(itemId,judgeId)` 写入 selection 后，合成 --run 仍发出 1 次并得到 `supplement-complete`。付费范围可能被扩大到已成功项；也没有「不挑成功」的硬闸。
2. **`--select` 且 `--run` 可以不带 `--origin`。** 仍发出 15 次；只写 `supplement.json`，`originSummarySha256` 为空，无 `derived-merge.json`。provenance 可与正式 partial 脱节。
3. **错误 origin 只要存在 `summary.json` 即放行。** 用伪造 summary 时记录其 decoy hash 并调用 transport，不对照正式 `4744aef1…` 钉扎。
4. **不核对 origin assignment。** `config.seed=1` 时 `ascend/00009` 的槽位与冻结 assignment 对调（`hx9q2w`/`jt4m8c` 互换）仍发出请求。会破坏与原 run 的盲法对齐。
5. **`--out` 等于 `--origin` 时覆盖 origin。** 测试中 origin 的 `summary.json` 被写成 `supplement-partial`。这直接违反「origin 不能覆盖」。
6. **已有内容的 `--out` 不清空检查即覆盖。** 预置 `summary.json` 被替换。若误指向正式证据目录，会毁掉原件。

（`--out` 指向新目录时，origin 不被写入：此项通过，但不能替代 5/6 的硬闸。）

`derived-merge.json` 只有说明、没有合并判决表；补评成功判定必须以 `supplementComplete` 为准，不得把本次 `results` 中未选出的 57 个空位读成新的失败，也不得把 `ok=true`（在 `supplement-complete` 时）读成原来的 `singleRunComplete`。

## 因此不冻结「可执行付费」入口

`config/config.supplement-budget-remaining.json` 与 `selection/selection-15.json` 只供检视和日后复验对照，**不是批准的 Mac --run 配置。** 见 `DO-NOT-RUN.txt`。父侧在这些 fail-closed 缺口修复并再次独立复验通过之前，即使有 t57u 既有授权，也不应用本包启动 paid。本步未执行付费。

包若修补，最小要求（仍由父侧复验，不在本轮改包）：`--run --select` 必须有 origin；钉扎 origin `summary.json` hash（或与配置/selection 一同声明的期望值）；重放 assignment 必须与 origin 完全一致否则阻断；selection 不得包含 origin 已成功的 pair；`--out` 必须是空的新目录且不得等于 origin。wrapper 不能当成对上述缺口的默许替代，除非包本身已阻断。

## 日后（仅在复验通过后）Mac 执行轮廓（现不得执行）

wrapper 调用 `runJudge`（不要直接裸跑 CLI 以致没有 counter）：

- 注入与正式 v2 相同的 `countTokens`（GPT `o200k_base` cookbook；Qwen 钉扎 tokenizer + chat_template）。
- `--input` 冻结 36 条匿名输入；`--config` 为同池 `budgetUsd=0.17905768`、`maxRequests=15`、`maxTotalTokens=48000`，其余价格/模型/seed 同 v2。
- `--select` 本目录 `selection/selection-15.json`；`--origin` 正式 v2 `judge-run`（先核 `summary.json` sha `4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f`）。
- `--out` 必须是新的空目录，不得等于 origin，不得指向原证据。
- 密钥仅 Mac 内存解析，不落盘、不拷到 box。`maxRetries=0`，不自动多轮补洞。
- 运输层只发 `model/temperature/seed/max_tokens/messages`，sidecar 按 item 区分。

## 可复现（离线、不付费）

```
node /workspace/baseline-sa-sv-36-20261113/judge-prep/verify-75266d0a-observe/scripts/verify-observe.mjs
```

详细逐条结果：`out/verify-results.json`（49 项，43 通过，6 项 critical 失败）。正式证据 hash 复验后仍不变。
