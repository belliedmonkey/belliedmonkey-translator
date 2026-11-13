# cmn_hans_cn/1663 人耳记录

机器可读记录是 [`eval/baselines/asr/zh1663-ear-2026-11-13.json`](../../eval/baselines/asr/zh1663-ear-2026-11-13.json)。校验命令是 `node eval/baselines/default-chain-check.js`。它仍退出码 2，`status` 为 `blocked`，`actualCount` 为 0。`zh1663AudioChecked` 为 true，`humanVerifiedCount` 只计这一条。

2026-11-13 09:23（Asia/Shanghai，UTC+8），ZHAO ZHANG 在「大肚猴翻译首席科学家」对话里听了冻结原件 `17125746560393607835.wav`。文件 856378 字节，sha256 `0b242eb4c06512556915e53463bb712beaffc56bcee751865c7461d79e93e95c`，16000 Hz，13.38 秒。来源是 FLEURS 修订 `70bb2e84b976b7e960aa89f1c648e09c59f894dd`，CC-BY-4.0。

官方原文没有改：智利首选登山目的地科茶莫山谷 (Cochamó Valley) 被称为南美洲的优胜美地 (Yosemite)，这里有各式各样的花岗岩大石壁和峭壁。

两条结论：两处括注都读出来了（Cochamó Valley 与 Yosemite）；整句与官方原文相符，没有明显出入。字段是 `latinParentheticalSpoken` = `两处都读出`，`transcriptMismatchOrUncertain` = false。

试听副本 sha256 `5d88c9a11344318c1599740a94113dc7d149a711dee845c4f5ac800bd91c311b` 只为播放，由 16 位 PCM 转出。证据绑在冻结原 wav 的 hash 上，副本不是新参考。

FLEURS 其余 15 条、30 条公开候选和 ASCEND 的 6 条人审仍是 0。历史中文 CER 仍是探索性组件结果，没有重算。端到端仍 **待测**。
