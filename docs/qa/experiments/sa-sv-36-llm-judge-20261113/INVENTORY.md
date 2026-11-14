# 记录目录清单

本清单位于归档封袋之前对资料树的枚举（随后还会加入本文件、EXCLUSIONS、SECRET-SCAN 与 SHA256SUMS）。

当前文件数：1264
当前字节合计：4800745

| 目录/文件 | 文件数 | 字节 |
|---|---:|---:|
| `DO-NOT-MERGE-PR663.txt` | 1 | 361 |
| `HANDOFF.zh.md` | 1 | 17366 |
| `LEDGER.json` | 1 | 2327 |
| `LEDGER.md` | 1 | 2088 |
| `PINS.json` | 1 | 5117 |
| `README.md` | 1 | 195 |
| `audio-index` | 2 | 5221 |
| `records/00-baseline-36` | 4 | 52138 |
| `records/01-sa-official-aef9aa8f` | 36 | 296975 |
| `records/02-sv-official-f6ec838b` | 23 | 116324 |
| `records/03-judge-prep-frozen` | 10 | 85932 |
| `records/04-v1-official-partial` | 258 | 818667 |
| `records/05-v1-offline-diag` | 55 | 321592 |
| `records/06-v2-pack-verify-e998c2c0` | 33 | 233278 |
| `records/07-v2-official-partial` | 334 | 1044469 |
| `records/08-v2-offline-diag` | 38 | 187025 |
| `records/09-v2-backfill-prep` | 35 | 183937 |
| `records/10-verify-75266d0a-FAIL` | 78 | 387497 |
| `records/11-verify-e5a17a1c-FAIL` | 28 | 217613 |
| `records/12-earlier-pack-verify-3ee413a0` | 101 | 199967 |
| `records/12-earlier-pack-verify-8ddf6e8e` | 65 | 200908 |
| `records/12-indexes-not-copied` | 4 | 2786 |
| `records/12-judge-prep-audit` | 18 | 21622 |
| `records/12-judge-prep-scripts` | 2 | 45062 |
| `records/12-lib-fixture-runs` | 88 | 81670 |
| `records/12-qa-config-draft-20261113` | 8 | 64501 |
| `records/13-full-chain-plan-index` | 24 | 149706 |
| `records/14-ear-listen-not-semantic-review` | 13 | 55796 |
| `records/15-plans-unrun` | 1 | 605 |

## records 子目录说明
- `00-baseline-36`：36 条集合 README、SHA256SUMS、PACK-MANIFEST
- `01-sa-official-aef9aa8f`：SA 官方 hypotheses/score/分析（原分不可改）
- `02-sv-official-f6ec838b`：SV 官方 run/rescore 分数与 REPORT
- `03-judge-prep-frozen`：冻结输入、pair-manifest、要求、STATUS（过期说明）、arm-mapping 仅备注
- `04-v1-official-partial`：官方 v1 付费 partial 摘录（无 mapping、无原 tar）
- `05-v1-offline-diag`：v1 离线诊断
- `06-v2-pack-verify-e998c2c0`：官方 v2 包离线复验（含 pack 副本）
- `07-v2-official-partial`：官方 v2 付费 partial 摘录（无 tokenizer、无 mapping、无原 tar）
- `08-v2-offline-diag`：v2 失败离线诊断
- `09-v2-backfill-prep`：补 15 准备、人审空表、allowlist（未执行付费）
- `10-verify-75266d0a-FAIL`：cloud55 入口复验 FAIL、脚本与合成输出、pack 副本
- `11-verify-e5a17a1c-FAIL`：cloud56 入口复验 FAIL、脚本、诚实 lock、pack 副本
- `12-earlier-pack-verify-3ee413a0`：更早 pack 审计（历史）
- `12-earlier-pack-verify-8ddf6e8e`：更早 pack 审计（历史）
- `12-judge-prep-audit`：judge-prep audit 小文件
- `12-lib-fixture-runs`：库级夹具跑（非官方付费）
- `12-qa-config-draft-20261113`：早期配置草稿（inspection）
- `12-judge-prep-scripts`：judge-prep 脚本
- `12-indexes-not-copied`：大目录仅索引
- `13-full-chain-plan-index`：全链路/业务形态已有计划文件
- `14-ear-listen-not-semantic-review`：耳听材料文本（不是语义人审）
- `15-plans-unrun`：BEL-258 等未实验计划

逐文件 hash 见根目录 `SHA256SUMS`（封袋后会再写入 archive 元数据）。
