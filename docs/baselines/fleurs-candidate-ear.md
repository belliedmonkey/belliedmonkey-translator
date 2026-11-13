# FLEURS 候选三条人耳记录

机器可读记录是 [`eval/baselines/asr/fleurs-candidate-ear-2026-11-13.json`](../../eval/baselines/asr/fleurs-candidate-ear-2026-11-13.json)。30 条文字清单和空白听审包不改。

2026-11-13 10:59（Asia/Shanghai，UTC+8），ZHAO ZHANG 对已经连音频一起交出去的条目说：「前面的都通过。」原话只这一句。这里不补逐字核对，也不单写括注有没有被念出。

计入的只有 3 条，证据绑冻结原 wav，试听副本不是参考：

| 句子 | 语言 | 原 wav sha256 | 试听副本 sha256 |
|---|---|---|---|
| 1668 | en_us | `d6ab97bb7e3232b60b61910d3ac7e1cf37acbcbfd062773b453c76217682f49e` | `a79c8854109fff73c5a857a9824acaf8a337e1740a276a13e167eebb24dda56b` |
| 1668 | cmn_hans_cn | `7b95a45446dc31d99d50232a7a6dbda26cc9c87eb26aec1263f73e7f9dd6405f` | `e1e696cdab62f2c8492f1af404c71c8afa9919976d903f97145fdffa76241184` |
| 1669 | en_us | `40d7e92df0355f4836e2b8fa2a88d7c7e047d0472f0845ca08f0c21257785390` | `4094b32e805260f1fddf3e3b4a210648f11388ca8d725c610407770eec108f74` |

当时 1669 的中文只发了原文，1670 的中英都没有发，所以那一刻不计通过。USGS 在 1670 里。

2026-11-13 11:03（同一时区），这三条音频已经完整交过。ZHAO ZHANG 的原话是：「确认。都是对的。usgc也读出了」。记录保留 usgc，不把官方原文里的 USGS 改掉，也不另写一版用户拼写。这三条与官方原文相符；1670 的中英括注按这句原话记为读出。另见 [`fleurs-candidate-ear-2026-11-13-1103.json`](../../eval/baselines/asr/fleurs-candidate-ear-2026-11-13-1103.json)。10:59 的那份记录不改。

两份合起来是 1668、1669、1670 的中英共 6 条。其余 24 条候选仍未审。口音、噪声、连续对话仍不记成已覆盖。

校验命令是 `node eval/baselines/default-chain-check.js`。加上 `cmn_hans_cn/1663` 和 ASCEND 的 6 条，去重后 `humanVerifiedCount` 是 13。批准计划仍是 30 条、实际 0 条，命令仍退出码 2。端到端仍 **待测**。
