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

同一步失败两次就停。2026-11-13 对上面这个 GitHub zip URL 做了两次 HEAD，两次都是 HTTP 404，`content-type: text/plain`，最终 URL 没有跳到别的文件。那个 URL 没有再请求。配置里的 `https://api.belliedmonkey.com/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip` 是静态文件地址，客户端下载不带 Authorization，也不是推理接口。一次 GET 得到 160304482 字节，sha256 `286a4b89c62be15c78f195b908bf746c80a655f07588346ee0383a8f20f21e04`。包内只有 `model.int8.onnx` 和 `tokens.txt`，哈希记在 `eval/baselines/asr/sensevoice-zip-members-2026-11-13.json`。产品表里的 zip 身份没有改。Mac 用的 `sherpa-onnx-v2.0.1-osx-arm64-static-no-tts.tar.bz2` sha256 是 `e2496931fd955ab449c2df1a6839e4c17cedf451e018cc3efd1a77180980c49b`，里面有 `bin/sherpa-onnx-offline`。这台 Linux 没有运行它。stdout 解析只按官方样例的一行一个 JSON、`text` 为字符串来测，二进制存在不算已经支持。SenseVoice 的一次探索性 smoke 记在下面，不是排名。Mac 上的命令是解开脚本包之后：

```bash
node run-reviewed-36.js --run --backend sensevoice --out /tmp/r36-sv-smoke \
  --sensevoice-dir /ABS/model-dir \
  --sensevoice-bin /ABS/sherpa-onnx-v2.0.1-osx-arm64-static-no-tts/bin/sherpa-onnx-offline \
  --fleurs-cache /ABS/fleurs-cache --ascend-cache /ABS/ascend-cache
```

这只脚本包和 `aef9aa8f` 的 SA 包不是同一个文件。

`6d25fa8d` 那只扁平包缺 `config`，Mac 上的 `--check` 和 `--run` 停在 preflight，没有编译、安装或识别。不要把那只包再当可执行入口。

`aef9aa8f` 的第一轮 Mac smoke 由 chair 报告，时间 2026-11-13 16:30:47–59 Asia/Shanghai。机器是 `e223ea06-b095-46bd-82fd-4bc961a21408`，macOS 27，M2 Pro 12 核 16GB，Node 26.10，Swift 6.4。`--check` 在 16:30:34 退出 0。识别命令退出 0，墙钟 12.42 秒。phases 毫秒：preflight 28.833，stage 44.838，compile 1987.357，assetInstall 972.014，modelLoad null，recognize 9262.119，score 6.134，pack 8.057。en-US 与 zh-CN 都是 installed，`installRequested` false。recognize 9262.119 是 36 条子进程的墙钟，不是模型加载，也不是单条延迟，也不排名。chair 用包内 `codeswitch-score` 重算，36 条 hypothesis 都非空，和 score 一致：英文 15 条 WER 36/363 = 0.09917355371900827，中文 15 条 CER 57/624 = 0.09134615384615384，ASCEND 6 条 MER 24/42 = 0.5714285714285714，`ranking` false。`appleResult` true。`productMetric`、`endToEnd`、`leaderboard`、`ranking` 都是 false。`exploratory` true。`approvedPlannedSetCount` 0。这是一次探索，不是 SA 与 SenseVoice 的对照完成。

证据在 chair 拷到的 `/workspace/baseline-sa-sv-36-20261113/results/aef9aa8f/`，30 个文件。SHA256SUMS 的 sha256 是 `2ed0e67861ac02c64e2d3ae83ed0b588e8202e6bc75c15d5adbeadd8d36a563c`。hypothesis `255454cfc218d05bc30a1d8c7b07fde057071313e7549a828d91b529507dfa57`，score `96009a49c36813d71d24f46f8a58f9f28727546fac8d3f4771eb929b14bd94bc`，summary `b9e3d4814d5a7878fdb08fbc78dc5154676b408ae1a1bf51fb1b58b012bd19e2`。16:31:42 `--pack-existing` 退出 0，这三份哈希没变；打包后的 evidence 是 `253e3901ec48619be45a4c30bef1de794b42eb52ed4afa12dcbb59c8d0d92c79`。本仓库没有读取那个目录里的原始文件。load `3.45/3.23/3.28` 到 `3.68/3.29/3.29` 来自外部 wrapper，因为那次成功运行没有写 `env.json`。summary 顶层 `recognizeMs` 是 null，`phases.recognizeMs` 才是 9262.119。成功的 `stage` 是 null。`item-progress` 停在最后一条的 `item-start`。`--pack-existing` 覆盖了第一次的 evidence。这些缺口记在这里，不回填、不改那 30 个文件，也不为补元数据重跑识别。

云端 Linux 不能报 SA 分数。合成夹具的 `rates` 保持 null。

## SenseVoice 一次 smoke

chair 报告了 `f6ec838b` 上的一次 SenseVoice 组件 smoke，时间 2026-11-13 17:11:51–17:13:11 Asia/Shanghai。授权是 t43/t44。命令退出 0，36 条 hypothesis 都非空，识别失败 0。冻结 v1 重算与这次分数一致，v1 规则没有改。本仓库没有打开 `/workspace/baseline-sa-sv-36-20261113/results/f6ec838b-sv/`，没有复制 hypothesis，下面的数字是 chair 摘要。摘要文件是 `eval/baselines/asr/mac-sv-36-f6ec838b-2026-11-13.json`。

英文 15 条 WER 29/363。中文 15 条 CER 57/624。ASCEND 6 条 MER 17/42，`ranking` false。同一套规则下的 SA 是 36/363、57/624、24/42。中文合计相同，不是逐条相同。ASCEND 分条是 `00004` 4/5、`00009` 6/13、`00028` 3/3、`00055` 1/14、`00066` 1/4、`00068` 2/3，加总是 17/42。`approvedPlannedSetCount` 是 0。`productMetric` 和端到端都不成立。

资源钉全部命中：zip `286a4b89c62be15c78f195b908bf746c80a655f07588346ee0383a8f20f21e04`，`model.int8.onnx` `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51`。词表文件的摘要是 `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`。后端包 `e2496931fd955ab449c2df1a6839e4c17cedf451e018cc3efd1a77180980c49b`。实际二进制是 Mach-O arm64，29996336 字节，sha256 `5a2d733a900cd6956a04432026fbf625e5912e694a8c8698fa69929659e0cf66`。参数是 cpu、2 线程、`zh`、ITN 开。没有调用 `api.belliedmonkey.com`，没有凭据、cookie 或私有 API。ModelScope 上的同一只 zip 是 `https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip`。chair 先遇到 Mac CopyFromBox 暂不可达，随后在 Mac 上用普通 curl 访问这个 URL，pin 再次命中。这次没有网络封锁，也没有审批拒绝。本仓库这一轮没有再下载。

FLEURS 的 float32 被该二进制接受。runner 只按字节拷贝，`stage-manifest` 里的 `converted` 固定写 false，并不探测编码。

墙钟 80.57 秒，user 155.45，sys 2.11。phases 毫秒：preflight 29.868，stage 55.515，compile null，assetInstall null，modelLoad 674，recognize 80146.724，score 7.579，pack 17.362。load 从 4.78/4.11/3.36 到 5.34/4.55/3.60。机器是 M2 Pro 12 核 16GB，macOS 27，Node 26.10。

`modelLoadMs` 不是 36 条的合计。`modelLoadFromStderr` 只取整段 stderr 里第一处 `recognizer created in`，乘 1000 后四舍五入。后面的同类行不累加。`recognizeMs` 是这一个 `sherpa-onnx-offline` 进程的墙钟，36 条 wav 一次放进参数。它包含该进程里的模型创建，不是单条延迟。SA 也是一个进程跑完全部 36 条，但 Swift 循环里每次 `transcribe` 都新建 `SpeechTranscriber`，`modelLoadMs` 保持 null，recognize 9262.119 毫秒是安装资源之后那个进程的墙钟。两边的 80.57 秒和 12.42 秒不是同一口径，不能当成速度胜负。这一轮不是交替 5 次，没有性能排名，也不为这份报告再跑重复实验。

单条 probe 是 ASCEND `00004`，退出 0，文本是「我死的。」，1.50 秒。它不进正式分母。

证据目录里有 run、pack、probe、rescore、REPORT 和 SHA256SUMS。第一次 evidence sha256 `bbc4a0cae169d5e66557fc4cd73cca05055c4ec8928119ea6778ff4faacdaa0c`，pack 之后没变。新 pack 是 `8a57cea938cce2dd05cc9afc845e84a2db5a110f7dd2642163d6331705596076`。SA 旧证据没有改。

LLM 评委还没有对这批 hypothesis 做真实调用。box 上另有审计在核 judge 包，本仓库不重复那一步，也不把音字听审或评委结果写成已经通过。原始 hypothesis 仍不在本仓库。若要归档原文，需要另传。

## 只读误差审计

chair 对 `aef9aa8f` 的 36 条结果做了只读误差审计。本仓库没有打开 `/workspace/baseline-sa-sv-36-20261113/analysis-aef9aa8f/` 里的原件。记录的哈希是：`AUDIT.md` `1d444394bfbd49488e698927ad7656999ac86812f632f9ad3912fb23fe07a1be`，`audit-report.json` `6694c3f22474e0d8469da0abb9bc785a48567660e7b99c3dc802afbc11ee5726`，`ASCEND-6.md` `d44a4e4c1a8f1ac5240b760b0a2296bc9ed6c23ec76c2e7dc41eea4b41379d8d`。36 条原始 hypothesis、score、summary 的哈希没有因这次审计改动。

冻结重算与已公布的分数相同，只补了操作计数：英文 36/363 = 28 替换、4 删除、4 插入，正确 331。中文 57/624 = 30 替换、18 删除、9 插入，正确 576。ASCEND 24/42 = 15 替换、6 删除、3 插入，正确 21。`00068` 是 6/3，编辑率可以大于 1。这不是新的排名。

v1 归一把 `29¾` 收成英文 token `293`、`4`，不是 `29`、`3`、`4`。这是 NFKC 把分数粘到前面的数字上，属于结构问题。当前 `score.js` 保持这个行为，回归只锁住它，不把它改成新分数。`24½` 同样粘成 `241`、`2`。数字词和数字、中文数字和阿拉伯数字、`i s m` 和 `ISM` 的表面差异都先记着。正式的下一版只能对同一段冻结的声音内容写对称等价，并先写适用面和反例。不能按这次 SA 的错例挑选规则。`thirteen`/`13`、`five`/`5`、`一`/`1`、`十三`/`13` 都还不是已批准的替换。

中文 CER 保留拉丁字母，这是冻结规范，不是待删的缺陷。1668 中文里的 Wild Card 删除是 8/9，审计数出中文路径上的拉丁相关误差 21 次。听审通过的是声音和官方原文一致，并且 USGS、`cmn_hans_cn/1663` 里的拉丁字母是读出来的。删掉括注或拉丁字母会把真实的漏读藏起来。删拉丁之后的 40/595 只是标明「不是识别一致性分」的诊断，不能当修正成绩，也不能替换已记录的 57/624。`um`/`嗯` 同样不是听审授权的替换。英文大小写和标点在 v1 里已经对齐：`OK` 与 `ok` 同为 `ok`。没有控制字符 token。`2005/10` 分成 `2005` 和 `10`，不因此误罚。

ASCEND 里确有识别错误：`00004` 5/5，`00068` 6/3，几乎没有重叠；`00055` 的 `um`/`嗯`，`00066` 的 `technical`/`technicle`。`00009` 的官方原文就是分开的 `i s m`，把它收成 `ISM` 会改变冻结参考。

v1 永久保留。下一版如果要改归一，单独成文，带盲测和反例，然后对 SA 和 SenseVoice 用同一套规则重算已有 hypothesis。不必为了改归一而重跑模型。这次没有新的分数，也没有对照排名。

文本盲评是另一条入口，见 [`llm-judge.md`](llm-judge.md)。它不改这里的编辑率，也不代替 SenseVoice 识别。
