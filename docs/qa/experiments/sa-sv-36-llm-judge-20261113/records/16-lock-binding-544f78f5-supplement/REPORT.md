# 冻结 15 对补评（lock 绑定修复后首跑）

时间：2026-11-14 12:12–12:15 CST（UTC+8）。授权：用户授权合并 #669 并执行 15 对补评。
结论：**15 次调用全部发出，10 对解析成功、5 对仍为 null，`code=supplement-partial`。不是完整，也不写成完整。**

## 0. 这次补评的前置

上一轮唯一阻塞是 `origin-lock` 的列表没被 origin 钉住：hash 正确但列表可改写，能把官方已成功的 pair 再买一次。

- 修复 PR：[#669](https://github.com/belliedmonkey/belliedmonkey-translator/pull/669)，已合并进 `cursor/baseline-inventory-1706`
- 合并点 head：`544f78f563e16e02c0ae214352597b804e8406e1`
- 本包是本地从该 head 用 `eval/baselines/judge/pack-judge-bundle.js` 现打的，**没有服务端 pack id**
  - 文件：`pack-src/01-PACK-LOCK-BINDING-544f78f5.gz`
  - sha256 `d5ebe767adf4b29349f92ec84f9f97b4298c5216bfe4fc5948e6859ad6a27297`，24313 字节
  - 内置 `run-judge.js` sha256 `c8180376c3c35ac3dbf358a03c5f70675443a3a282773864c7c8db8f1e2a9b74`
- 独立复验：**41 项全过**（原 36 项 + 5 项对抗），见 `verify/verify-results.json`
  - 含拒绝：成功 relabel 成 failed、等条数互换、重复条目、summary 缺 `results`
  - 含对照：诚实 lock 仍然只发选中的 15 对
- 复验用的是**本机真实证据树** `/Users/belliedmonkey/qa/llm-judge-v2-real-20261114-0015`，不是归档副本；summary / usage / RESULT / human-review / input / 正式配置 六个 sha256 全部与 `PINS.json` 一致

## 1. 结果

| 项 | 值 |
|---|---|
| `code` | `supplement-partial` |
| 请求数 | 15 / 15（`maxRequests=15`，无重试） |
| 解析成功 | 10 |
| 仍为 null | 5 |
| 有效 pair 合计 | 67 / 72（origin 57 + 补评 10） |
| 双臂都有有效判决的条目 | **31 / 36**（补评前 22） |
| 单臂有效条目 | 5 |
| 双臂都空的条目 | 0 |
| `singleRunComplete` | false |
| `doubleBlindComplete` | false |
| `supplementComplete` | false（因为 partial） |
| `semanticHumanReviewCount` | 0 |

`derivedCoverageComplete=false`，`cherryPick=false`，origin 的 57 条只引用、`verdict=null`、不拷贝不挑优。补评的 15 条 `source=supplement`，无效即 null。

### 5 个仍为 null 的 pair

| itemId | judge | parseCode |
|---|---|---|
| `fleurs-public-candidates/cmn_hans_cn/1671` | judge-a | `bad-json` |
| `fleurs-public-candidates/cmn_hans_cn/1674` | judge-b | `note` |
| `fleurs-public-candidates/cmn_hans_cn/1680` | judge-b | `quote` |
| `fleurs-public-candidates/en_us/1670` | judge-b | `quote` |
| `fleurs-public-candidates/en_us/1680` | judge-b | `bad-json` |

失败形态与补评前诊断一致：模型 JSON 不合法、缺 `note`、引用不合法。**没有可无损恢复的成功项，也没有对它们挑拣或改写。** 补齐到 15/15 需要新授权、新预算和新包，不在本步范围。

## 2. 费用

| 口径 | USD |
|---|---|
| 本轮 provider actual | 0.00638081 |
| 本轮信封结算 | 0.00780564 |
| 预算上限（本轮） | 0.17905768 |
| 15 对预留 | 0.03251712（实际未用满） |
| 计划累计上限 | 0.28 |
| 累计已用（信封） | 0.10094232 + 0.00780564 = 0.10874796 |
| 剩余 | 0.17125204 |

15 次调用的逐条 `providerUsd` 在 `out/sidecars/`。两次 `--dry` 各 0 调用、0 花费。中途一次被自家闸挡下（`out-not-empty`，0 调用 0 花费），原因是 wrapper 在 gate 之前就建了 `sidecars` 子目录；已修。

## 3. 冻结值（未改）

- 官方 v1、v2 仍是 `ok=false / partial`；v2 RESULT sha256 `580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc` 未变
- SA：en WER 36/363，zh CER 57/624，codeswitch MER 24/42（`ranking=false`）
- SV：en WER 29/363，zh CER 57/624，codeswitch MER 17/42（`ranking=false`）
- origin `summary.json` sha256 补评前后均为 `4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f`，未被写入
- 输入 `1a44cca3…7c795a1`、assignment 规范体 `3cffd116…fb5f52e`、selection `55978cec…76e1135`、诚实 lock `1abc0d51…0a325e`、补评配置 `f94c3958…12ec46d`、prompt `a2e82f86…d220923`、seed 20261113 全部未变

## 4. 人审

`semanticHumanReviewCount` 仍是 **0**。补评只是模型判决，不是人审。听审 / 耳听不算语义人审。

补评后真正没有有效判决的对象从 14 条缩到 **5 对**，清单在 `human-review-pending-after-supplement.json`。旧 `records/09-v2-backfill-prep/human-review/` 的 14 条 pending 列表自此作废，但那批空表作为历史保持不动。

## 5. 边界

- 未重跑已成功的 57 对
- 未切默认链路、未发布、未晋升
- 未改仓库代码（本轮只有记录），未改 SA/SV 原分，未把 partial 改叫 complete
- 密钥只在进程内存读取，未写入记录、未打印；记录目录已按 `sk-or-` / `Bearer` 模式扫描，0 命中
- 本记录不含 arm mapping

## 6. 文件

- `pack-src/` 本包（本地构建，无服务端 id）
- `config/` 补评配置：`budgetUsd=0.17905768`、`maxRequests=15`、`maxTotalTokens=48000`、`maxRetries=0`
- `lock/origin-lock.json` 由正式 parsed 推出并经包内核验
- `selection/selection-15.json` 冻结 15 对
- `verify/` 41 项复验脚本与结果
- `ledger/` `RESULT.json`、公开 summary、derived coverage
- `out/` 本次 run 的 `parsed/`、`sidecars/`、`summary.json`、`derived-merge.json`、`human-review.json`
- `human-review-pending-after-supplement.json` 补评后仍是 null 的 5 对
