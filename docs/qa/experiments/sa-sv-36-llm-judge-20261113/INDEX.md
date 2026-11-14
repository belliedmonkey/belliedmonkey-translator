# 本检出里的入口（封袋之后加的，不在 SHA256SUMS 里）

封袋说明仍是同目录三行 [`README.md`](README.md)。那份文件的字节保持交接包原样。本页只加导航，不改分数。

| 文件 | 用途 |
|---|---|
| [`OPENBOT-HANDOFF.zh.md`](OPENBOT-HANDOFF.zh.md) | 接手第一步：交叉核验 origin 判决与 lock 成败集合 |
| [`HANDOFF.zh.md`](HANDOFF.zh.md) | 冻结结论与时间线 |
| [`PINS.json`](PINS.json)、[`LEDGER.md`](LEDGER.md)、[`LEDGER.json`](LEDGER.json) | hash 与费用 |
| [`INVENTORY.md`](INVENTORY.md)、[`EXCLUSIONS-AND-BOUNDARIES.md`](EXCLUSIONS-AND-BOUNDARIES.md) | 目录与剔除 |
| [`SCRIPTS-AND-PATHS.md`](SCRIPTS-AND-PATHS.md) | 脚本不可付费；历史路径和仓库相对路径 |
| [`CURATION.md`](CURATION.md) | 入库时去掉的字节码，以及封袋后新增了哪些文件 |
| [`records/15-plans-unrun/BEL-258-URLS.md`](records/15-plans-unrun/BEL-258-URLS.md) | DeepSeek 卡片地址；原计划文件未改，实验未做 |
| [`records/16-lock-binding-544f78f5-supplement/REPORT.md`](records/16-lock-binding-544f78f5-supplement/REPORT.md) | lock 绑定修复后的 15 对补评：结果、覆盖、费用、仍为 null 的 5 对 |
| [`DO-NOT-MERGE-PR663.txt`](DO-NOT-MERGE-PR663.txt) | 不要把 PR #663 的未验实现一并合入 |

可核对事实（`ranking=false`，不是产品排名）：SA 英文 WER 36/363、中文 CER 57/624、混语 MER 24/42；SenseVoice 29/363、57/624、17/42。官方评委 v1 与 v2 都是 `partial`。语义人审 0。入口包 `75266d0a` 与 `e5a17a1c` 独立复验都是 FAIL，两份都不能当 runner。

15 对补评已执行（2026-11-14 12:12 CST）：15 次调用，`supplement-partial`，10 对解析成功、5 对仍为 null，花费 0.00638081 provider / 0.00780564 信封，剩余 0.17125204。有效 pair 57→67/72，双臂有效条目 22→31/36。`doubleBlindComplete` 仍为 false。

实现 PR：[#663](https://github.com/belliedmonkey/belliedmonkey-translator/pull/663) 仍开放。lock 绑定修复 PR [#669](https://github.com/belliedmonkey/belliedmonkey-translator/pull/669) 已合并进该分支，head 现为 `544f78f563e16e02c0ae214352597b804e8406e1`。合并 #669 只修 lock 绑定，不构成对 663 其余部分的复验。
