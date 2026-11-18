# 实验记录

这里只收研究记录和计划，不是产品入口，也不发布。

| 目录 | 是什么 |
|---|---|
| [`sa-sv-36-llm-judge-20261113/`](sa-sv-36-llm-judge-20261113/INDEX.md) | 2026-11-13/14 的 36 条 SpeechAnalyzer 与 SenseVoice 组件实验，以及 partial LLM 评委、两次入口 FAIL、未执行的 15 条补评 |
| [`e2e-b1-text-mt-20261114/`](e2e-b1-text-mt-20261114/REPORT.md) | 端到端文本基线 B1：同 36 条，A 金标输入 vs B 产品 ASR 输入。**其 B 条件数字已被 B1b 取代**，A 条件不受影响 |
| [`e2e-b1b-unified-judge-20261118/`](e2e-b1b-unified-judge-20261118/REPORT.md) | A/B 两条件用同一份提示词重判：B 条件意义 58.3% → 66.2%，条目 14/36 → 22/36，A 仍 36/36 |
| [`e2e-b1c-judge-gold-20261118/`](e2e-b1c-judge-gold-20261118/REPORT.md) | 50 条评委金标与校准结果。金标是**草案派生**（用户接受草案、0 格修改）：条目级 TPR judge-a 62.5% / judge-b 82.3%，双评委任一判错覆盖 14/17，漏掉的 3 条全是专名/品牌/职衔 |

全链路阶段和业务形态的计划索引在 [`docs/baselines/README.md`](../../baselines/README.md)。那份索引从仍开放的 PR #663 抄出计划正文，不含其未复验实现。
