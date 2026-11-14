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

同一步失败两次就停。2026-11-13 对上面这个 zip URL 做了两次 HEAD，两次都是 HTTP 404，`content-type: text/plain`，最终 URL 没有跳到别的文件。没有下载，也没有用 tar.bz2 顶替。SenseVoice 这一项是 blocked。SA 的 staging、编译和子进程路径不依赖它。

`6d25fa8d` 那只扁平包缺 `config`，Mac 上的 `--check` 和 `--run` 停在 preflight，没有编译、安装或识别。不要把那只包再当可执行入口。云端 Linux 不能报 SA 分数。合成夹具的 `rates` 保持 null。
