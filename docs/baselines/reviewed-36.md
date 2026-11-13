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

## 扁平包的 config

`6d25fa8d` 的 `MANIFEST.json` 有 36 条，但没有 `config`。包模式的 `loadManifest` 原样收下这些行。`checkCaches` 只用 `config === 'ascend'` 决定缓存根，缺了 config 就去 FLEURS 根找 `00004.wav`。`safeAudioRel` 同样看 config，所以就算预检被绕过，staging 也会是 `audio-path`。仓库模式的 `loadSet` 本来就带 config，当时的 mock 没有走打包再解压的命令，所以没撞上。

缓存布局是：FLEURS 根下的 `en_us/<audioName>` 与 `cmn_hans_cn/<audioName>`，ASCEND 根下的 `00004.wav` 这一类文件名。Mac 上已有的 `1668-<hash>.wav` 硬链接不改变这个规则。缺 `config` 是 `invalid-config`，不会改去猜路径。

预检失败也会先建 `--out`。目录里有 `run-summary.json`、`env.json`、`input-manifest.json` 和 `evidence.tar.gz`。`id` 和 `stage` 在 summary 里。`--pack-existing` 只打包已经写下的文件，不再识别。没给 `--out` 时，命令自己在当前目录建 `r36-result-<pid>-<time>`。

耳审记录以只读副本放进包，`audit.records` 记下源路径和 sha256。空白听写表不进包，源文件不改。

识别上限默认是 36 × 45 秒。45 秒是旧 16 句的逐条上限。180 秒是那 16 句的进程上限，对这 36 句不再沿用：sidecar 时长合计 371.07 秒，36 × 45 秒也大于 180 秒。这是上限，不是延迟估计。SA 的 `modelLoadMs` 保持 null，识别子进程的墙钟只记在 `recognizeMs`。`--process-cap-ms` 和 `--item-cap-ms` 可以改这两个数。

## 命令

默认离线，不访问网络。

```bash
node eval/baselines/asr/run-reviewed-36.js --check --out <新目录> \
  --fleurs-cache <FLEURS 缓存根> --ascend-cache <ASCEND 缓存根>
node eval/baselines/asr/run-reviewed-36.js --run --backend sa --out <新目录> \
  --fleurs-cache <FLEURS 缓存根> --ascend-cache <ASCEND 缓存根>
node eval/baselines/asr/run-reviewed-36.js --run --backend sensevoice --out <新目录> \
  --sensevoice-dir <含 model.int8.onnx 与 tokens.txt 的目录> \
  --fleurs-cache <FLEURS 缓存根> --ascend-cache <ASCEND 缓存根>
node eval/baselines/asr/run-reviewed-36.js --pack-existing <已有目录>
node eval/baselines/asr/run-reviewed-36.js --prefetch-sensevoice <显式 URL>
```

第一次真跑用上面的单次命令，不要加 `--repeats`。少于 5 次只记探索性，不排名。

`--check` 核对 36 条原始缓存和对应听审。缺文件、坏 hash、缺听审都是非零，并且没有分数。

`--run --backend sa` 在 Linux 上写 `unavailable`，退出码 2，`rates` 为 null。在 darwin 上、并且 `swiftc` 存在时，它会把 36 条原文件拷进该次运行目录下的 `audio-root`，拷完再对字节做 sha256，然后编译 `product-asr-mac.swift`，先 `--install-assets`，再跑识别。ASCEND 在交给 Swift 时的 `config` 是 `cmn_hans_cn`，对应 locale `zh-CN`，只这一次，不另跑 `en-US`。冻结 16 句不进这个 set。超时仍走 `run-sa-file.js` 的进程组 TERM/KILL。检测到达尔文不等于已经执行；没有 `swiftc` 时退出码是 `missing-swiftc`。

SenseVoice 没有模型目录时写 `model-missing`。目录里有 `model.int8.onnx` 和 `tokens.txt` 时先记录这两份 sha256；本机没有 `sherpa-onnx-offline` 时写 `backend-missing`，仍然没有分数。两者都不阻挡 SA 的准备。二进制存在时，子进程参数固定为 cpu、2 线程、`--sense-voice-language=zh`、`--sense-voice-use-itn=1`，36 条 wav 一次传入。`recognizeMs` 是这个子进程的墙钟，含模型加载；stderr 里的 `recognizer created in` 另记为 `modelLoadMs`。预先下载只接受与钉住 sha256、大小相同的 zip。仓库里的地址是产品中继，实验不调用它。公开的 tar.bz2 会被拒绝。显式 URL 是：

```bash
node eval/baselines/asr/run-reviewed-36.js --prefetch-sensevoice https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip
```

同一步失败两次就停。2026-11-13 对上面这个 GitHub zip URL 做了两次 HEAD，两次都是 HTTP 404，`content-type: text/plain`，最终 URL 没有跳到别的文件。那个 URL 没有再请求。配置里的 `https://api.belliedmonkey.com/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip` 是静态文件地址，客户端下载不带 Authorization，也不是推理接口。一次 GET 得到 160304482 字节，sha256 `286a4b89c62be15c78f195b908bf746c80a655f07588346ee0383a8f20f21e04`。包内只有 `model.int8.onnx` 和 `tokens.txt`，哈希记在 `eval/baselines/asr/sensevoice-zip-members-2026-11-13.json`。产品表里的 zip 身份没有改。Mac 用的 `sherpa-onnx-v2.0.1-osx-arm64-static-no-tts.tar.bz2` sha256 是 `e2496931fd955ab449c2df1a6839e4c17cedf451e018cc3efd1a77180980c49b`，里面有 `bin/sherpa-onnx-offline`。这台 Linux 没有运行它。stdout 解析只按官方样例的一行一个 JSON、`text` 为字符串来测，二进制存在不算已经支持。SenseVoice 还没有 36 条分数。

`6d25fa8d` 那只扁平包缺 `config`，Mac 上的 `--check` 和 `--run` 停在 preflight，没有编译、安装或识别。不要把那只包再当可执行入口。

`aef9aa8f` 的第一轮 Mac smoke 由 chair 报告，时间 2026-11-13 16:30:47–59 Asia/Shanghai。机器是 `e223ea06-b095-46bd-82fd-4bc961a21408`，macOS 27，M2 Pro 12 核 16GB，Node 26.10，Swift 6.4。`--check` 在 16:30:34 退出 0。识别命令退出 0，墙钟 12.42 秒。phases 毫秒：preflight 28.833，stage 44.838，compile 1987.357，assetInstall 972.014，modelLoad null，recognize 9262.119，score 6.134，pack 8.057。en-US 与 zh-CN 都是 installed，`installRequested` false。recognize 9262.119 是 36 条子进程的墙钟，不是模型加载，也不是单条延迟，也不排名。chair 用包内 `codeswitch-score` 重算，36 条 hypothesis 都非空，和 score 一致：英文 15 条 WER 36/363 = 0.09917355371900827，中文 15 条 CER 57/624 = 0.09134615384615384，ASCEND 6 条 MER 24/42 = 0.5714285714285714，`ranking` false。`appleResult` true。`productMetric`、`endToEnd`、`leaderboard`、`ranking` 都是 false。`exploratory` true。`approvedPlannedSetCount` 0。这是一次探索，不是 SA 与 SenseVoice 的对照完成。

证据在 chair 拷到的 `/workspace/baseline-sa-sv-36-20261113/results/aef9aa8f/`，30 个文件。SHA256SUMS 的 sha256 是 `2ed0e67861ac02c64e2d3ae83ed0b588e8202e6bc75c15d5adbeadd8d36a563c`。hypothesis `255454cfc218d05bc30a1d8c7b07fde057071313e7549a828d91b529507dfa57`，score `96009a49c36813d71d24f46f8a58f9f28727546fac8d3f4771eb929b14bd94bc`，summary `b9e3d4814d5a7878fdb08fbc78dc5154676b408ae1a1bf51fb1b58b012bd19e2`。16:31:42 `--pack-existing` 退出 0，这三份哈希没变；打包后的 evidence 是 `253e3901ec48619be45a4c30bef1de794b42eb52ed4afa12dcbb59c8d0d92c79`。本仓库没有读取那个目录里的原始文件。load `3.45/3.23/3.28` 到 `3.68/3.29/3.29` 来自外部 wrapper，因为那次成功运行没有写 `env.json`。summary 顶层 `recognizeMs` 是 null，`phases.recognizeMs` 才是 9262.119。成功的 `stage` 是 null。`item-progress` 停在最后一条的 `item-start`。`--pack-existing` 覆盖了第一次的 evidence。这些缺口记在这里，不回填、不改那 30 个文件，也不为补元数据重跑识别。

云端 Linux 不能报 SA 分数。合成夹具的 `rates` 保持 null。
