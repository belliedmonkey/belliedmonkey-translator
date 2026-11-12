# 公开 ASR 对照切片（FLEURS）

这是一条可离线评分的公开对照，不是用户真实失败集，也不是听译或实时字幕的端到端基线。产品上的识别结果 **待测**。这里没有系统假设文件，所以没有 CER/WER 产品数字。

## 已实现

- 冻结集 [`eval/baselines/asr/fleurs-public-v1.json`](../../eval/baselines/asr/fleurs-public-v1.json)：`en_us` 与 `cmn_hans_cn` 的 test 切分各 8 句，一句只留排序后的第一条录音。
- 评分器 [`eval/baselines/asr/score.js`](../../eval/baselines/asr/score.js)：英文按词（WER），中文按字（CER），两种率分列，不平均。
- 校验脚本 [`eval/baselines/asr/fetch-fleurs.js`](../../eval/baselines/asr/fetch-fleurs.js)：只重新下载两份 test TSV，核对字节数、SHA-256 和入选行。

`eval/baselines/samples.json` 仍是 `samples-0`，记录数为 0。公开对照的 `kind` 是 `public-comparison`，不写入那份真实失败目录。

## 来源与许可

独立核对（2026-11-12），不是法律裁定：

- 数据集 `google/fleurs`，修订 `70bb2e84b976b7e960aa89f1c648e09c59f894dd`。Hub 元数据 `license: cc-by-4.0`，卡片标签同为 `license:cc-by-4.0`。卡片正文写 “All datasets are licensed under the Creative Commons license (CC-BY)”，链接到 Creative Commons 许可总页，没有单独的版本号。
- 讨论串 #2 中，维护者账号 `vaxelrod` 对 “Does this mean that FLEURS has the cc-by-4.0 license?” 回答 “Yes cc-by-4.0”。
- 数据集 `gated` 为 false。直接 GET 上述修订的 test TSV 返回 200，没有登录页，也没有条款点击。
- CC BY 4.0 摘要页写明可复制、改编，包括商业性使用，并要求署名、标明修改、不再附加限制。法律文本：<https://creativecommons.org/licenses/by/4.0/legalcode>。

署名：Conneau 等，FLEURS，arXiv:2205.12446。修改说明写在冻结集的 `attribution.modification`：只取子集；评分用的是 TSV 第 4 个字段的原文，没有为了格式重写。第 3 个字段（带标点的 raw）只作对照、不参与计分。中文这一列并不都是字间空格。多数行是按字隔开的；`cmn_hans_cn/1663/17125746560393607835.wav` 的参考是连写汉字，中间夹着带空格的拉丁专名 `cochamó valley`，与 TSV 该字段逐字相同。

TSV 校验：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `data/en_us/test.tsv` | 367864 | `74c046239374deeb60fa63f258f907388093a32bcaa3140965f70ef05c79f7ca` |
| `data/cmn_hans_cn/test.tsv` | 491487 | `5734461648f816181d7dab5fc79204b18c4b9bc2cd5138225b25c72d18385d21` |

选择规则：非空 raw 与归一化转写、音频名以 `.wav` 结尾；按句号数字再按音频文件名排序；每个句号只留第一条音频；每种语言取前 8 个句号。句号 1660 起。同一句的其他朗读不在这 16 条里。

## 归一化

英文：NFKC，小写，连续的非字母非数字变成一个空格，再按空白切词。指标名 `wer`。

中文：NFKC，去掉空白、标点和符号。汉字、拉丁字母和数字按原顺序保留，不删掉夹在句中的专名或数字。发布稿在拉丁专名两侧加的空格，在这个字符比较里不是词边界。指标名 `cer`。同一行不再另算一次英文 WER。

同一 FLORES 句号的中英两句不是时间对齐，也不在这里做翻译分。

空参考（归一化后没有单位）不出比率。空预测记为全部删除，并标 `emptyHypothesis`。重复 id、缺少假设、多余 id 都不填一个总分。

## 怎么跑

重新核对公开文本，不下载音频：

```bash
node eval/baselines/asr/fetch-fleurs.js
```

TSV 落在 `eval/baselines/asr/.cache/`，该目录不进 Git。

对一份外部假设打分。假设文件是 JSON 数组，元素为 `{ "id", "hypothesis" }`，`id` 必须与冻结集一致。没有这份文件时，评分器退出码为 2，不会把参考转写当成预测。

```bash
node eval/baselines/asr/score.js --set eval/baselines/asr/fleurs-public-v1.json --hyp /path/to/hypotheses.json
```

`productMetric` 恒为 false。工具夹具 [`eval/baselines/fixtures/asr-score-tool-only.json`](../../eval/baselines/fixtures/asr-score-tool-only.json) 只证明评分器算术，里面的 0 不是产品结果。

## 音频

默认命令不下载音频。显式获取会流式读取两个 test tar.gz，只把冻结的 16 个 wav 写进 `eval/baselines/asr/.cache/audio/`，整包不落盘、不进 Git。总下载上限 1 GiB，单次连接超时 15 分钟，失败最多两次就停。

这次在本环境实际跑过：

```bash
node eval/baselines/asr/fetch-fleurs.js --audio --record
```

压缩流读了 489272487 字节，16 个 wav 都抽到了。每个文件的 SHA-256、字节数、16 kHz、单声道、32 bit、采样数都写进冻结集，并且采样数与 TSV 的 `numSamples` 一致。没有系统假设文件，所以仍然没有产品 CER/WER。听译和实时字幕的端到端仍然 **待测**。

假设文件是 JSON 数组，元素只有 `{ "id", "hypothesis" }`。`hypothesis` 必须是字符串；缺字段、null 或数字会被拒绝。只有显式 `""` 表示识别器给出了空输出。`id` 用冻结集里的 id，对应缓存里的 `audioCache`。不要把 `reference` 填进 `hypothesis`。

## 产品 ASR 这一轮没有分数

这 16 条的产品识别器不是本机可执行的文件转写脚本。英文只走 `app/native/speech-bridge.swift` 里的 `SpeechAnalyzer`（macOS 26 / iOS 26）。`RecognizerFactory.make` 在语言不是 `zh` 或臂是 `sa` 时返回同一条 Apple 转写器。国际版 Mac 的中文默认臂 `e1_b1` 仍在这个进程里：SpeechAnalyzer 的 partial，加上 `language: "zh"`、`useInverseTextNormalization: true` 的 SenseVoice 定稿，定稿前还有 `sil0.5_thr0.3_max8` VAD。SenseVoice 权重不代替英文路径，单独跑 ONNX 也不是这条臂。

本环境是 Linux。命令：

```bash
node eval/baselines/asr/run-product-asr.js
```

它先核对缓存 wav 的 SHA-256、WAV 头和采样数，然后因不是 Apple SpeechAnalyzer 而退出码 2，`hypotheses` 为 null。Darwin 且 `sw_vers` 主版本 ≥ 26（含已测机器上的 macOS 27.0）时，同一命令在给出 `--out-dir` 后才会尝试用 `swift` 编译并运行 `product-asr-mac.swift`。那个文件适配器只覆盖 SA 文件喂入，臂是 `sa`，不是国际版 Mac 中文默认的 `e1_b1`，也不是端到端。`swiftCompiledByPackager` 在这份源码里恒为 false：本环境没有在 Mac 上编译过它。没有假设文件，所以没有产品 CER/WER。端到端仍 **待测**。

在 Mac 上把输出只写到指定目录：

```bash
node eval/baselines/asr/run-product-asr.js --out-dir /path/to/asr-output
```

首次调用系统语音框架时，macOS 可能弹出语音识别权限或语言资源下载的原生提示。脚本不会代替用户点允许，也不会改 App 或系统配置。

产品实施建议（不在本 PR 改 App）：给现有 `MTDeviceTranscriber` / `MTE1B1Transcriber` 加一条文件 PCM 入口，而不是再写一套识别器。

## 这批不引入的来源

Common Voice 的再分发请求、Gutenberg 在美国境外的版权、以及附件里的其他候选，都没有进入本切片。
