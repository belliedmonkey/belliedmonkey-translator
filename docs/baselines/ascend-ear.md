# ASCEND 六条人耳记录

机器可读记录是 [`eval/baselines/ascend/ascend-ear-2026-11-13.json`](../../eval/baselines/ascend/ascend-ear-2026-11-13.json)。文字筛选清单 [`ascend-test-v1.json`](../../eval/baselines/ascend/ascend-test-v1.json) 不改，里面的 `humanVerifiedCount` 仍是 0。

2026-11-13 09:44（Asia/Shanghai，UTC+8），ZHAO ZHANG 逐条听了这 6 个原 wav。播放的是冻结的 pcm_s16le、16 kHz、单声道原字节，没有另做转换。来源是 CAiRE/ASCEND，卡片修订 `737e9800ae31be9932ba8464c80366559bd28424`，数据文件 sha256 `a4c81d2b5ed6124f052089a695972808c16e0ce0c365ec9773c5d1a8fcf043a7`，CC-BY-SA-4.0。

每条结论都是：确认中英混语，转写相符。`00055` 只确认「um运动啊男生一般不都喜欢运动」这一句，不把它扩大成充分的语义混语样本。6 条都是短片段，不是各自独立的说话人，也不是一段连续会话，这里不做显著性声称。口音、噪声、连续对话仍是 unknown。

校验命令是 `node eval/baselines/default-chain-check.js`。`ascendHumanVerifiedCount` 是 6，加上 `cmn_hans_cn/1663` 后 `humanVerifiedCount` 是 7。30 条公开候选仍是 0。批准计划仍是 30 条、实际 0 条，命令仍退出码 2。端到端仍 **待测**。
