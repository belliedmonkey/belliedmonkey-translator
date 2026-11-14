# 计划文档的来源（2026-11-14）

本目录的计划正文从仍开放的
[PR #663](https://github.com/belliedmonkey/belliedmonkey-translator/pull/663)
HEAD `e5a17a1c046a4df370c95ba2731b20e2e14eaeea`
（分支 `cursor/baseline-inventory-1706`）**只读抄出**。抄的是 `docs/baselines/**/*.md`。
没有 cherry-pick，没有并入该 PR 的 `eval/baselines/**`、`test/**` 或 workflow。

记录这些计划不等于合并 PR #663。该 PR 在写入时仍是 open，HEAD 仍是上面的
`e5a17a1c`，其中的评委实现没有通过独立复验。

## 本检出没有那些命令

下文里的 `node eval/baselines/...` 指向的文件不在这个分支。它们不是产品执行入口，
也不能在这里直接拿来付费。隔离的证据复现脚本在
[`docs/qa/experiments/sa-sv-36-llm-judge-20261113/`](../qa/experiments/sa-sv-36-llm-judge-20261113/README.md)，
路径区别见该目录的 `SCRIPTS-AND-PATHS.md`。

## 哪几句不能当成最新结论

PR 文档写于实验进行中，有的句子停在当时：

- `reviewed-36.md` 文末「LLM 评委还没有对这批 hypothesis 做真实调用」是写该段时的状态。其后官方 v1 与 v2 都做过付费调用，并且都保持 `partial`。证据在实验记录里，不回写进那一段。
- `llm-judge.md` 前部「也没有已经发生的调用」与后部「2026-11-13 首轮 partial」并存。以实验记录里的官方 RESULT 为准：两次都是 `ok=false`、`code=partial`。
- `llm-judge.md`「这六种现在都在任何请求之前拒绝」描述的是 `e5a17a1c` 包在**诚实** lock 下的六项行为。独立复验仍然 FAIL：唯一剩余阻塞是 `origin-lock` 的 `failedPairs` / `succeededPairs` 没有与 origin 的 `summary.results` 或 `parsed/` 交叉核验。见实验记录 `records/11-verify-e5a17a1c-FAIL/REPORT.md`。
- 端到端、业务形态测量、语义人审在这些计划里仍是待测或 0。不要把组件原分或 partial 评委写成产品排名或已通过。

36 条组件原分、费用和补评规则以实验记录的 `HANDOFF.zh.md`、`PINS.json`、`LEDGER.md` 为准，不在本目录改数字。
