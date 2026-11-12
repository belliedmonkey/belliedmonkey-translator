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

署名：Conneau 等，FLEURS，arXiv:2205.12446。修改说明写在冻结集的 `attribution.modification`：只取子集；评分用的是 TSV 第 4 个字段（归一化转写）的原文；第 3 个字段（带标点的 raw）只作对照、不参与计分；中文归一化行是数据集公布的按字隔开的那一列。

TSV 校验：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `data/en_us/test.tsv` | 367864 | `74c046239374deeb60fa63f258f907388093a32bcaa3140965f70ef05c79f7ca` |
| `data/cmn_hans_cn/test.tsv` | 491487 | `5734461648f816181d7dab5fc79204b18c4b9bc2cd5138225b25c72d18385d21` |

选择规则：非空 raw 与归一化转写、音频名以 `.wav` 结尾；按句号数字再按音频文件名排序；每个句号只留第一条音频；每种语言取前 8 个句号。句号 1660 起。同一句的其他朗读不在这 16 条里。

## 归一化

英文：NFKC，小写，连续的非字母非数字变成一个空格，再按空白切词。指标名 `wer`。

中文：NFKC，去掉空白、标点和符号，剩下的每个字符是一个单位。指标名 `cer`。归一化行里留下的拉丁字母仍算在这条中文的字符序列里，不另算一次英文词错。

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

## 音频阻塞

原片只在这两个包里：

- `data/en_us/audio/test.tar.gz`，289851356 字节
- `data/cmn_hans_cn/audio/test.tar.gz`，525346466 字节

`datasets-server` 的单行接口对一条 test 样本返回 `TooBigContentError`。没有找到低于 8 MB 上限的单条音频 URL。这两个包没有下载，音频也不在 Git 里。`node eval/baselines/asr/fetch-fleurs.js --audio` 只做 HEAD，长度超过上限就停。

因此这条切片现在能核对参考转写，并对外部导出的假设算 CER/WER。它还不能对产品听写输出打分。听译和实时字幕的端到端仍然 **待测**。

## 这批不引入的来源

Common Voice 的再分发请求、Gutenberg 在美国境外的版权、以及附件里的其他候选，都没有进入本切片。
