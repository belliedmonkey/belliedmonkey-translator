# OpenBot 接手说明（2026-11-14）

用户 t58u 授权先提交并合并**实验记录和计划**，然后自行把后续转给 OpenBot。本文件是那次转交的独立说明。科学家负责研究记录；产品实现另要授权。本检出只归档，不代替那次转交去开工。

## 不要做的事

- 不要把仍开放的 [PR #663](https://github.com/belliedmonkey/belliedmonkey-translator/pull/663) 当作已经合并。HEAD 仍是 `e5a17a1c046a4df370c95ba2731b20e2e14eaeea`。该 PR 含有未通过独立复验的实现。记录进 git 不等于合并该 PR，也不要在本任务里合并它。
- 不要改官方 v1 / v2 的 `partial`，不要改 SA / SV 原分，不要把耳听写成语义人审。
- 不要切默认链路，不要发布，不要做生产晋升。本目录不是产品入口。
- 不要为了迁就仓库路径去改证据脚本。见 `SCRIPTS-AND-PATHS.md`。

## 接手第一步（只此一件，通过之前不要付费）

只做交叉核验，外加回归和独立复验：

1. 取官方 v2 origin 的 `summary.results` 与 `parsed/`，推出成功对与失败对。
2. 取 `origin-lock` 的 `succeededPairs` 与 `failedPairs`。
3. 证明两套集合 1:1，且不是「lock 文件 hash 正确、列表却把已成功对标成失败」。
4. 用独立复验再跑入口。`records/11-verify-e5a17a1c-FAIL/REPORT.md` 已记录：诚实 lock 下先前 6 项失败已在发请求前挡住；**唯一剩余阻塞**就是上面这一条没被包自己核验。36 项里 35 项通过、1 项关键失败。`75266d0a` 那一包保持 FAIL，不能当 runner。

这一步没过，就停。不要修着产品功能顺便付费，也不要在缺口还在时发 15 次补评。

## 通过之后才允许的补评形状

原 `input-asr-36`、assignment、model、prompt、token 上限都不变。只对冻结的 15 个失败对做**一次**补评：

- 不重跑已经成功的 57 对
- 不自动多轮，`maxRetries` 保持 0
- 不切默认，不发布
- `--out` 是新的空目录，不能是 origin，也不能是它的别名或父子路径
- 预算口径仍是计划剩余 `0.17905768` USD，`maxRequests=15`，`maxTotalTokens=48000`；15 对预留 `0.03251712` 在通过前仍是未执行、花费 0
- 密钥只在被授权的机器内存里，不写入仓库

官方 v1 与官方 v2 **永久 partial**。以后只能写成 supplement 或 derived coverage。`supplement-complete` 不得把 `singleRunComplete` 或 `doubleBlindComplete` 写成 true。

语义人审只有人工实际参与才算。当前 `semanticHumanReviewCount` 是 0。听审 / 耳听不是语义人审。14 条 `notAssessed` 在补评完成前不要当成人审对象。人审表不带臂映射。

## 冻结事实（不要改数字）

完整钉在 `PINS.json` 与 `LEDGER.md`。摘要：

- SA：en WER 36/363，zh CER 57/624，codeswitch MER 24/42，`ranking=false`
- SV：en WER 29/363，zh CER 57/624，codeswitch MER 17/42，`ranking=false`
- 计划累计 0.28 USD；信封已用 0.10094232；剩余 0.17905768
- provider actual：v1 0.04447240，v2 0.03845668
- 官方 v2 解析：judge-a 34/2，judge-b 23/13，双方成功 22；仍是 partial
- DeepSeek 只开了研究卡，没有实验。见 `records/15-plans-unrun/BEL-258-DeepSeek.md`

## 先读

1. 本文件
2. `HANDOFF.zh.md`
3. `LEDGER.md` 与 `PINS.json`
4. `EXCLUSIONS-AND-BOUNDARIES.md`
5. `records/11-verify-e5a17a1c-FAIL/REPORT.md`
6. [`docs/baselines/ARCHIVAL-NOTE.md`](../../../baselines/ARCHIVAL-NOTE.md)

全链路阶段和各业务形态的计划在 `docs/baselines/`。那些端到端格子仍是待测，不是这次 36 条组件实验的成绩。
