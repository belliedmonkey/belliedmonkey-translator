# ASCEND 小批候选

这是 test 划分里按转写文字筛出的 6 条。本文件仍是文字筛选快照，`humanVerifiedCount` 仍是 0，也不是批准计划里的 30 条捐献。人耳结论另记在 [ascend-ear.md](ascend-ear.md)：只确认这 6 句听到了中英混语且转写相符。口音、噪声、连续对话仍是 unknown。端到端仍 **待测**。

卡片修订和数据文件分开冻结。卡片是 `CAiRE/ASCEND` 的 `737e9800ae31be9932ba8464c80366559bd28424`。数据是 `main/test-00000-of-00001.parquet`，105756434 字节，sha256 `a4c81d2b5ed6124f052089a695972808c16e0ce0c365ec9773c5d1a8fcf043a7`，与该修订的 LFS oid 相同。许可以卡片 Licensing Information 的 CC-BY-SA-4.0 为准，链接是 <https://creativecommons.org/licenses/by-sa/4.0/>。GitHub 仓库上的 MIT 是代码许可，不是这批音频的许可。

出版方把整套数据写成香港采集的自发中英混语、多轮对话；论文摘要写的是干净语音。那是对收集过程的描述。这 6 条自己的证据只是官方转写里同时有汉字和拉丁字母，外加原样保存的 wav。文件名里的起点分别是 25.32、48.75、126.43、269.62、324.57、330.42 秒，中间隔着别的片段，所以不能说连续对话已经覆盖。

筛选是 test、按 id 升序、取前 6 条符合文字条件的：`00004`、`00009`、`00028`、`00055`、`00066`、`00068`。转写没有改写，也没有翻译。6 条合计 398662 字节、12.45 秒，都是 16000 Hz 的原始 wav。

```bash
node eval/baselines/ascend/fetch-ascend.js --freeze
node eval/baselines/ascend/fetch-ascend.js --offline
```

`--freeze` 才写清单。`--offline` 只核对 hash，不改清单。音频在 `eval/baselines/ascend/.cache/`，不进 git，也不进 FLEURS 的缓存或评分证据包。
