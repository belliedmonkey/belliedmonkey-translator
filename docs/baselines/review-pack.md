# 听审空白表

这是交给人复核的材料，不是人审结果。`humanVerifiedCount` 保持 0。批准计划仍是 30 条捐献、实际 0 条。`node eval/baselines/default-chain-check.js` 仍然 `blocked`。

覆盖两处已经冻结的 FLEURS 朗读：30 条公开候选，以及 `cmn_hans_cn/1663`。参考文本原样抄出。括注拉丁有没有被念出来、音频和转写是否不符，两列都空着。

```bash
node eval/baselines/asr/make-review-pack.js --out <目录>
```

wav 只出现在这个输出目录，不进 git，也不进评分证据包。输出目录不能落在 `.cache/audio`、`.cache/public-candidates` 或 `runs`。端到端仍 **待测**。
