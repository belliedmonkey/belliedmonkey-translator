# 脚本是隔离证据，不是付费入口

本目录里的 `.js` / `.mjs` / `.py` / `.sh` 是当时离线复现或包内快照，用来核对已经发生的记录。它们不是产品执行入口，不接扩展，不接 App，不进默认链路。

禁止用它们发付费请求、调用 OpenRouter、补跑 15 条、或重跑已成功的 57 对。官方 v1 与 v2 永久是 `partial`。入口包 `75266d0a` 与 `e5a17a1c` 的独立复验都是 FAIL。在 origin 判决与 lock 成败集合交叉核验通过之前，没有可执行的付费入口。密钥不在本树。

`records/*/pack-unpacked/` 与 `pack-src/*.gz` 是被复验包的字节证据，包括未通过的 `run-judge.js`。保留它们是为了能对照 hash，不是为了在本检出里执行 `--run`。

## 相对路径和历史路径不是同一棵树

脚本没有按本仓库的 `records/NN-*` 目录改写。两种路径都保留原样：

| 写法 | 它当时相对谁 | 在本检出里 |
|---|---|---|
| 写死的 `/workspace/baseline-sa-sv-36-20261113/...` | 制作机上的盒 | 盒路径。本检出没有这棵目录，脚本不会因此改成仓库相对路径 |
| 写死的 `/Users/belliedmonkey/...` | 报告里的 Mac 路径。归档当步没有访问 Mac | 只作出处，不是本仓库路径 |
| `fileURLToPath` + `resolve(HERE, '..')` 再拼 `v2-real-run-20261114-0015/`、`input-asr-36.json`、`v2-offline-diag-20261114/` | 盒上 `judge-prep/` 的**兄弟目录名** | 证据已收进 `records/07-*`、`records/03-*`、`records/08-*` 等编号目录，兄弟名对不上。不要为了能跑而改脚本 |

因此：

- `records/11-verify-e5a17a1c-FAIL/scripts/verify-supplement-gate.mjs` 和 `records/10-verify-75266d0a-FAIL/scripts/verify-observe.mjs` 用的是脚本文件位置向上的相对路径，不是 `/workspace` 字符串，但它们要的兄弟目录名是盒上的 `judge-prep/` 布局。`REPORT.md` 里印出的 `node /workspace/...` 是当时的命令记录。
- `records/12-earlier-pack-verify-3ee413a0/scripts/reverify.js`、`records/12-earlier-pack-verify-8ddf6e8e/scripts/reverify-bound.js`、`records/12-judge-prep-scripts/run-offline-audit.js`、`records/12-judge-prep-scripts/build-pair-and-audit-inputs.py`、`records/01-sa-official-aef9aa8f/analysis-aef9aa8f/scripts/audit-sa-errors.js` 把 `PREP` 或结果目录写成 `/workspace/baseline-sa-sv-36-20261113/...`。
- `records/09-v2-backfill-prep/scripts/prepare-v2-backfill-prep.mjs` 默认也按 `judge-prep/` 兄弟名找证据；环境变量 `V2_EVIDENCE`、`V1_ASSIGNMENT`、`FROZEN_INPUT`、`V2_PACK` 是脚本里原有的覆盖口，不是本步新加的。本步不运行它。
- `verify-observe.mjs` 还会找证据下的 `tokenizers/qwen`。权重按剔除规则不在本树。

已写好的 `out/`、`REPORT.md`、request、response、parsed、usage 可以直接读。要按原脚本再跑一遍，只能在盒上的历史目录名下对照，或者另做一份不改脚本字节的临时目录布局。不要改这些脚本去迁就本仓库路径，那会改掉证据。

## 和 PR #663 里 `eval/baselines/` 的区别

[PR #663](https://github.com/belliedmonkey/belliedmonkey-translator/pull/663) HEAD `e5a17a1c046a4df370c95ba2731b20e2e14eaeea` 里的 `node eval/baselines/...` 不在本分支。计划说明在 [`docs/baselines/ARCHIVAL-NOTE.md`](../../../baselines/ARCHIVAL-NOTE.md)。本目录的包快照是独立复验用的字节，不是把那个 PR 的实现合进来。
