# 费用 ledger（信封 vs provider）

时区：Asia/Shanghai (UTC+8)。本归档步骤未产生新费用。

## 计划口径（官方 v2 RESULT 钉死，不得因归档改写）

| 项 | USD |
|---|---|
| 累计计划上限 | 0.28 |
| 已用（累计信封） | 0.10094232 |
| 剩余 | 0.17905768 |

来源：官方 v2 `ledger/RESULT.json` sha256 `580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc`（字段 `cumulativePlanUsd` / `cumulativeConsumedUsd` / `cumulativeRemainingUsd`）。

分解：

- 历史 v1 信封消耗 0.05570372 = 探针预留 0.00589824 + judgeHeld 0.04980548（v1 RESULT sha256 `e1496fd413d4057b09ee75346c96d7da7cd85402c2f1a270d2fc40bf6ba5e0b6`，当时计划上限还是 0.25）。
- 本轮官方 v2 信封结算 0.0452386；`0.05570372 + 0.0452386 = 0.10094232`。
- 官方 v2 本轮 `budgetUsd=0.22429628`（在累计改到 0.28 之后）。

## Provider actual（分列）

| 项 | USD | 依据 |
|---|---|---|
| v1 provider actual | **0.04447240** | 72 次正式调用 usage 合计 **0.04435536** + 两次历史 probe **0.0000808 + 0.00003624** |
| v2 provider actual | **0.03845668** | 官方 RESULT `thisRoundProviderUsd` 与 usage 72 次合计一致 |

说明：v1 `usage.json` 的 `spentUsd/settledUsd=0.04980548` 是信封，且 `providerUsdIgnored=true`，不能当成 provider。v1 `ledger.json` 的 `providerUsdSum` 为 null。本步按 usage 各 call 的 `providerUsd` 与 probe JSON 复算后与交接要求的 0.04447240 **一致**。

v2 未再支付 probe（复用历史探针）。两轮 provider 合计 0.08292908，小于信封累计 0.10094232，这是预期差异，不要用 provider 去改 plan used。

## 补评 15 预留（本节为封袋时的状态，已被下一节取代）

- 公式：`2 × 0.00411136 + 13 × 0.0018688 = 0.03251712`
- 封袋时执行状态：未执行，花费 0
- 建议预算字段：`budgetUsd=0.17905768`，`maxRequests=15`，`maxTotalTokens=48000`

封袋制作时未调用 LLM、未付费、未改预算数字。

## 补评执行（2026-11-14 12:12–12:15 CST）

授权：用户批准合并 #669 并执行 15 对补评。记录见 [`records/16-lock-binding-544f78f5-supplement/`](records/16-lock-binding-544f78f5-supplement/REPORT.md)。

| 项 | USD |
|---|---|
| 请求数 | 15（`maxRetries=0`） |
| provider actual | **0.00638081** |
| 本轮信封结算 | **0.00780564** |
| 预算上限（本轮） | 0.17905768 |
| 15 对预留 | 0.03251712（未用满，剩 0.02471148） |
| 计划累计已用（信封） | 0.10094232 + 0.00780564 = **0.10874796** |
| 剩余 | **0.17125204** |

口径照旧：plan used 用信封结算，不用 provider 相加。本轮 provider 合计 0.00638081 只作对照。

结果 `supplement-partial`：10 对解析成功、5 对仍为 null（`bad-json` 2、`quote` 2、`note` 1）。有效 pair 从 57 升到 67/72；双臂都有有效判决的条目从 22 升到 31/36。`doubleBlindComplete` 与 `singleRunComplete` 仍为 false，`semanticHumanReviewCount` 仍为 0。

本包身份：head `544f78f5`，本地构建 pack `d5ebe767…a27297`，24313 字节，内置 `run-judge.js` `c8180376…1e2a9b74`，41 项复验全过。
