# 正式 v2 补评与人审离线准备（不执行、不付费）

目录：`judge-prep/v2-backfill-prep-20261114/`。授权：t57u / [pt57u]「同意 开工吧。都做掉」。

本轮只做离线准备：精确 15 条 allowlist、全 36 匿名输入与原 assignment 不变验证、同池预留核对、以及按冻结 v2 标准准备的中文语义复核说明与待评空表。**不 Mac、不网络、不 key、不付费、不改仓库、不覆盖原证据。** 等云端新包（可观察性 + selection 入口）完成后，由父侧安排独立复验再执行；本准备不自行启动 paid，也不代填人审。

生成时间：2026-11-14 10:24:35 Asia/Shanghai (CST)。

## Selection（精确 15 对）

只补官方 v2 失败的评委×条目，共 15 次请求（14 个 item；`en_us/1673` 两位评委都失败）。不重跑已官方有效的 57 条，不用 v1 提示或 v1 判决，不重新随机槽位。

| itemId | judgeId | model | official code | finish_reason | request sha256 |
| --- | --- | --- | --- | --- | --- |
| fleurs-public-candidates/cmn_hans_cn/1671 | judge-a | openai/gpt-4.1-mini | bad-json | stop | `2d63be9699ef7eef2ebf25cdf8e71ecdeabab45fdd09f8df65b346d79eebf2d3` |
| fleurs-public-candidates/en_us/1673 | judge-a | openai/gpt-4.1-mini | bad-json | stop | `81542dd41179f9c1b17c400f0bbee11e061cd58bb44a38ea8c818837a58d5358` |
| ascend/00009 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | stop | `1841ca028ab5829f55420ffcc1c5c30b490d711d6d2aa948ecbb546f0fa3950e` |
| ascend/00028 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | stop | `4d0632239365da7ec54aa80e97b287f1c2343637dcee5944282e1f2ad497216c` |
| ascend/00055 | judge-b | qwen/qwen3-235b-a22b-2507 | quote | stop | `9ad460232f3453779ef099fd0d446ef32b9155de04d533d32f4079c90b150dad` |
| fleurs-public-candidates/cmn_hans_cn/1673 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | error | `124664d0a3279b0f6e7c19ff14678df4be2ffa9a2a4e513cef0304200fac8bb8` |
| fleurs-public-candidates/cmn_hans_cn/1674 | judge-b | qwen/qwen3-235b-a22b-2507 | note | stop | `0a8dba470fbe681a7be4ba7c7076815443aea27a43e6c1e1feb6effda47c49cd` |
| fleurs-public-candidates/cmn_hans_cn/1675 | judge-b | qwen/qwen3-235b-a22b-2507 | quote | stop | `ab9efae1b91db69a0788363402d23487295f317a4f62e11ed35ec244aed65d98` |
| fleurs-public-candidates/cmn_hans_cn/1676 | judge-b | qwen/qwen3-235b-a22b-2507 | note | stop | `19a36fdabece6018d92a748eaf675d9c8c0f0a8fb673b6cae0c34fc73102fa00` |
| fleurs-public-candidates/cmn_hans_cn/1680 | judge-b | qwen/qwen3-235b-a22b-2507 | quote | stop | `fafd156e3d4a68e0bbbaf92792ee3bd442702a7c5c1c5d624bc169b4ecfda745` |
| fleurs-public-candidates/cmn_hans_cn/1681 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | stop | `2140b3d6b7d73ee2085aa823c2e7496d72c134ab09e23d39a90ead3e60771be8` |
| fleurs-public-candidates/en_us/1670 | judge-b | qwen/qwen3-235b-a22b-2507 | note | stop | `326cbddd5f1c35707dac9ac21c03495552815f52597cba59708a9da2c370ab88` |
| fleurs-public-candidates/en_us/1672 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | stop | `a1a088408d44509b0f3cf53c6fd56be800f82cfa3c619b1f5e6902c4ad017b15` |
| fleurs-public-candidates/en_us/1673 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | stop | `71ec2d4a8e05a3e9d737a47c7e8fa9254e73b9a962eb36cf06dec1e5938d7657` |
| fleurs-public-candidates/en_us/1680 | judge-b | qwen/qwen3-235b-a22b-2507 | bad-json | stop | `d96da37ddc9d8554ead97acf92a186e7b73906a49b84ea944b396b5d45e16736` |

共同 provenance：

- 输入（36 条匿名）sha256=`1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1`
- assignment sha256=`3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470`（与正式 v1 匿名 assignment 相同）
- 已发送 v2 prompt sha256=`a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`（15 条请求的 system 均为此值；无一为 v1 `a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6`）
- 完整逐条字段见 `out/allowlist-15.json`。

## Assignment 与输入不变

用冻结输入 + seed 20261113 重放 `assignItems`，与正式 assignment 逐条槽位一致：是。与 v1 assignment 文件 hash 一致：是。15 条原请求中的 slot 文本与「输入候选 × 冻结 assignment」一致：是。选取这 15 个 item 只是切片，不重新抽随机数，故槽位映射不变。

## 预算（同池，不新开 0.28）

单次全 cap 预留（`maxInputTokens=1152` × 输入单价 + `maxOutputTokens=2048` × 输出单价）：GPT `0.00411136`，Qwen `0.0018688`。

公式：`2 × 0.00411136 + 13 × 0.0018688 = 0.03251712`。
独立核对（由单价整数演算）= `0.03251712`；与 pack 浮点 `reserveUsd` 在账本所用小数位一致：是（pack float 合计 `0.03251712`）。

累计历史消耗 `0.10094232` / 计划 `0.28`，剩余 `0.17905768`。15 条全 cap 预留 `0.03251712`，预留后账本余量 `0.14654056`。**够预留，不自动多轮补洞，不把结算差额拿去加请求。** 未来补评必须走同一累计池，不得另开 0.28。本准备不改台账、不发起请求。建议日后配置：`budgetUsd=0.17905768`（本轮可用余额，不是新池），`maxRequests=15`，`maxTotalTokens=48000`，`maxRetries=0`。在新包 selection 入口经独立复验前，不要用当前包对 36×2 盲目 `--run`。

## 人审材料

路径：`human-review/INSTRUCTIONS.zh.md`，空表 `human-review/forms/disagreement/`（17）与 `human-review/forms/sample/`（5），待补且**现在不要评**的清单 `human-review/pending-backfill-not-for-review-now.json`（14）。索引：`human-review/forms-index.json`。

空表保留匿名 reference / slot 文本、官方 findings 与 quote，以及空白标注字段。所有表内 `semanticHumanReviewed=false`，未代填任何语义结论。音字听审不计入。初始 17+5+14 须在补评后刷新。

## 原件钉扎（只读核对，未改写）

| 钉扎 | sha256 | 一致 |
| --- | --- | --- |
| tarball | `e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002` | 是 |
| RESULT | `580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc` | 是 |
| summary | `4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f` | 是 |
| usage | `2c72567b6f04191536f84fdb42dda3971082fcb6bb561c3b53ae184478126da1` | 是 |
| human-review | `b034c87c8fc841a32e99d20967a011bf7621165bba08cfbc0f2f2fe77889c453` | 是 |
| assignment-v2 | `3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470` | 是 |
| assignment-v1 | `3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470` | 是 |
| formal-config | `e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180` | 是 |
| pack-gz | `a81afb949cc3e7ebc807e7ac90e88b6cd520220bd519641ec3051876d3ee3f92` | 是 |
| input-evidence | `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1` | 是 |
| input-frozen | `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1` | 是 |

## 可复现命令

```
node /workspace/baseline-sa-sv-36-20261113/judge-prep/v2-backfill-prep-20261114/scripts/prepare-v2-backfill-prep.mjs
```

做完即停，等待新包；不自行启动 paid，不改 repo。

