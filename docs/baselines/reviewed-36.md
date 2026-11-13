# 已听审 36 条的组件实验

这是独立组件研究，不是产品桥，不是默认链路，也不是发布。索引见 [`docs/baselines/README.md`](README.md)。端到端仍 **待测**。

要验证的说法只有这一句：在已经人耳核对过的 36 条上，SpeechAnalyzer 和 SenseVoice 各自的识别错误、等待时间和失败能不能被同一条离线命令记下来。36 条是 FLEURS 1668–1682 的中英 30 条，加上 ASCEND 的 6 条。冻结 16 句和 `cmn_hans_cn/1663` 不进这个分母。批准计划的 actual 仍是 0。口音、噪声、连续对话仍未覆盖。6 条短混语不能代表多说话人或一整段对话。

听审范围是声音和官方原文是否一致，不是中英翻译质量。1681 的英文原句、1680 的括注、1682 的 `29¾` 和 `24½` 都留在冻结文本里。

## 两个后端，都从现有源码读

SpeechAnalyzer 沿用 `eval/baselines/asr/product-asr-mac.swift`。英文 `en-US`，中文 `zh-CN`。ASCEND 只记一次 `zh-CN`，不跑第二种 locale，也不取较好的那次。模块是 `SpeechTranscriber`，不走 Dictation 回退。

SenseVoice 沿用 `app/device-models.config.js` 里的表，不另抄一份会漂的地址。钉住的是 `model.int8.onnx`、`tokens.txt`、int8、sherpa-onnx、cpu、2 线程、`language: zh`、`useInverseTextNormalization: true`。zip 名 `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip`，160304482 字节，sha256 `286a4b89c62be15c78f195b908bf746c80a655f07588346ee0383a8f20f21e04`。本实验不调用 `api.belliedmonkey.com` 中继。公开的 tar.bz2 不是这只 zip，不能拿来顶替。

## 口径

朗读英文用既有 WER，朗读中文用既有 CER，两边同一套 `score.js` 归一。原始 hypothesis 留在 `hypotheses.json`。

混语不用「把拉丁字母拆成字再算 CER」当总排名。混语 token 是：汉字各算一个，连续的拉丁字母或数字算一个词，标点切开。这个编辑距离叫 MER，只作这一层的诊断，`ranking` 为 false。汉字段和拉丁段再分开记，也不合并成名次。

计时用单调时钟，分开记 preflight、编译、资源安装、模型加载、识别等待、评分、打包。识别没开始时 `recognizeMs` 是 null，不是 0。历史那次含编译的约 7 秒不是这里的延迟。性能比较要每一侧至少 5 次、交替 A/B，再报中位数、范围和失败数。次数不够就只写探索性，不排名。

## 命令

默认离线，不访问网络。

```bash
node eval/baselines/asr/run-reviewed-36.js --check
node eval/baselines/asr/run-reviewed-36.js --run --backend sa --out <新目录>
node eval/baselines/asr/run-reviewed-36.js --run --backend sensevoice --out <新目录>
node eval/baselines/asr/run-reviewed-36.js --pack-existing <已有目录>
node eval/baselines/asr/run-reviewed-36.js --prefetch-sensevoice <显式 URL>
```

`--check` 核对 36 条原始缓存和对应听审。缺文件、坏 hash、缺听审都是非零，并且没有分数。`--run` 在 Linux 上对 SA 写 `unavailable`，退出码 2，`rates` 为 null。在 darwin 上这一轮写 `sa-not-executed`：Swift 源码仍是 `product-asr-mac.swift`，它要一个 `--audio-root`，而这 36 条原始文件分在两个缓存目录，子进程还没有从这里启动。SenseVoice 的 zip 不在本机时同样是 `unavailable`。空 hypothesis 不会变成错误率 0。`--pack-existing` 只打包，不重新识别。超时清理仍用 `run-sa-file.js` 的进程组 TERM/KILL，旁观者测试在 `test/sa-file-run.test.js`。

Mac 上的真实识别还没在这台环境跑过。云端 Linux 不能报 SA 分数。预先准备 SenseVoice 时只能给与钉住 sha256 相同的 zip，并且要显式写 URL。不调用产品中继。
