# 公开 ASR 对照切片（FLEURS）

这是一条可离线评分的公开对照，不是用户真实失败集，也不是听译或实时字幕的端到端基线。产品上的识别结果 **待测**。下面的 16 句数字是 SA 文件组件的一次探索性分数，不是产品 CER/WER，也不是官方 FLEURS 排行榜。

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

它先核对缓存 wav 的 SHA-256、WAV 头和采样数。不是 Darwin 时退出码 2，`hypotheses` 为 null。Darwin 且 `sw_vers` 主版本 ≥ 26 时，给出 `--out-dir` 才会尝试用 `swift` 编译并运行 `product-asr-mac.swift`。那个文件适配器只覆盖 SA 文件喂入，臂是 `sa`，不是国际版 Mac 中文默认的 `e1_b1`，也不是端到端。没有假设文件，所以没有产品 CER/WER。端到端仍 **待测**。

可复现命令（输出目录自定，不写本机路径）：

```bash
node eval/baselines/asr/run-product-asr.js --out-dir <output-dir>
```

源文件 SHA-256（`516fae6e`）：`product-asr-mac.swift` 为 `e1f1ffd1d271e3c64d0edbc1232a8dbce62a1a9466bd372aa19290cf17417606`，`run-product-asr.js` 为 `77bef37427ad8a528b9b08375c95fc290fd4269909cfe69a0305d9f1642d9151`。

### Mac 上的两次运行，到此停止

脱敏记录在 [`eval/baselines/asr/mac-sa-file-attempts.json`](../../eval/baselines/asr/mac-sa-file-attempts.json)。没有本机家目录、用户名或设备标识，也没有假设文本。

第一次（macOS 27.0 build 26A428，Swift 6.4，node 26.10.0）：Swift 编译失败。`product-asr-mac.swift` 当时第 134 行，`AVAudioConverter?` 必须解包才能调用 `convert`。没有进入识别，没有权限提示，没有假设文件。随后源码改为 `guard let`，nil 就抛错，不用 `!`。

第二次（2026-11-12 13:26:32–13:26:34，Asia/Shanghai，macOS 27.0，Swift 6.4）：Swift 编译已通过。`node` 与 `swift` 退出码 2。stderr 为 `sa-file-failed`，detail 是 `speech assets not installed`。`checked` 为 16。假设文件不存在。metadata：`arm` 为 `sa`，`sameProductProcess` 为 false，`matchesIntlMacChineseDefaultArm` 为 false，`endToEnd` 为 false，`productMetric` 为 false，`hypotheses` 为 null。`swiftCompiledByPackager` 仍是 false，这只表示打包端没有预先编译，不表示这次 Mac 编译失败。

当前阻塞是语音资源状态不是已安装。脚本对 `SpeechTranscriber` 查了 `AssetInventory.status`，不是 `.installed` 后又查了回落的 `DictationTranscriber`，仍不是 `.installed`，于是抛出 domain `product-asr`、code 1。这次抛错前没有请求安装语音资源，也没有出现权限提示。权限是否已授予是未知的，因为执行没有走到那一步。怎样安装这些资源没有在这里研究，本文不写谁才能安装。

那两次停在「没有发起安装」。之后用户授权只补这一处：显式安装入口，不把那两次记录改成已经装好。

## 显式安装入口

官方说明（2026-11-12 读 Apple 文档 JSON）：

- [AssetInventory](https://developer.apple.com/documentation/speech/assetinventory)：用模块配置安装资产；模型从 Apple 的服务器下载，由系统管理。
- [assetInstallationRequest(supporting:)](https://developer.apple.com/documentation/speech/assetinventory/assetinstallationrequest%28supporting:%29)：当前状态已是 `.installed` 时返回 nil。需要的 locale 还没预留时，它会自动预留；如果会超过 [maximumReservedLocales](https://developer.apple.com/documentation/speech/assetinventory/maximumreservedlocales)，或者资产不支持，就抛错。
- [downloadAndInstall()](https://developer.apple.com/documentation/speech/assetinstallationrequest/downloadandinstall%28%29)：下载并安装设备上还没有的资产。
- [Status](https://developer.apple.com/documentation/speech/assetinventory/status)：`.supported` 是「配置可用，但资产还要下载」，不是 `.installed`。`.downloading` 是正在下载或在等条件。`.unsupported` 是这个配置不能用。
- [reserve(locale:)](https://developer.apple.com/documentation/speech/assetinventory/reserve%28locale:%29) 是可选的手动预留。安装请求自己会预留，所以这个脚本不调用它。
- [release(reservedLocale:)](https://developer.apple.com/documentation/speech/assetinventory/release%28reservedlocale:%29) 会去掉预留，系统随后可能删掉资产。这个脚本不调用它，也不卸载、不替换系统默认、不重置授权、不用 sudo。

仓库里已有的安装例子是 `app/native/speech-bridge.swift` 的 `sttAssets`：同样只调用 `assetInstallationRequest(supporting:)` 和 `downloadAndInstall()`，不在这条路上调用 `reserve` / `release`。这次不改产品 App，也不改国际版 Mac 中文默认的 `e1_b1`。

范围只是 `en-US` 与 `zh-CN` 的 `SpeechTranscriber`，也就是 SA 文件入口的 `sa` 臂。默认命令不安装。只有带 `--install-assets` 才向系统申请。准备命令不写假设文件。安装失败、语言不支持、预留满了（`SFSpeechErrorDomain` code 11）、或下载失败，都退出码 2，`hypotheses` 为 null。状态写在输出目录的 `asset-status.json`，里面有安装前和安装后的状态名。

同一步下载最多两次，整段安装预算 15 分钟。到点记 `asset-download-timeout`。node 在准备命令上多等 30 秒，只为把状态文件写完，不是第三次下载。

官方文档没有给出资源字节数，所以大小记为 unknown，这里不编数字。文档也没有写安装会不会弹出系统权限对话框。第二次运行没有调用安装接口，所以也没有观察到对话框。如果系统弹出对话框，脚本不会代点。这里不说用户必须点。

`swiftCompiledByPackager` 仍是 false。没有产品 CER/WER。端到端仍 **待测**。

### Mac 上安装已完成，识别被错误归类

2026-11-12 13:42:36–13:42:39（Asia/Shanghai），macOS 27.0，Swift 6.4。补丁编译通过。`--install-assets` 退出码 0。`en-US` 与 `zh-CN` 都是 `supported` → `installed`，每种语言调用了一次 `downloadAndInstall()`。没有再下载已经安装的资源。

13:43:01–13:43:02，不带 `--install-assets` 的识别退出码 2。两种语言的状态复查仍是 `installed`。没有假设文件，没有比率。stderr 是 `asset-install-failed`，`locale` 为空，`attempts` 为 0，`installFlag` 为 false，detail 为 `Foundation._GenericObjCError error 0`。没有看到阻塞用的权限提示。`permissionPrompt` 仍是 unknown，不能据此说已授权或被拒绝。

13:49:16–13:49:18 的诊断把上面那个归类问题排除了。编译通过，16 条 wav 门禁通过，两种语言安装前后都是 `installed`，`installRequested` 为 false。`recognition-error.json` 与 trace 一致：`recognition-failed`，阶段 `convert`，locale `en-US`，样本 `en_us/1660/12742373433258665797.wav`。错误链只有一项：`swiftType` 为 `Foundation._GenericObjCError`，domain 同名，code 0，description 为 `nilError`，userInfo 为空，没有 underlying。没有假设，没有比率。阶段停在 `convert`，所以不是 `finalize` 的 `CancellationError`。

这条样本是 16 kHz、单声道、32-bit float WAV，170880 个采样（10.68 秒）。[AVAudioFile.read(into:)](https://developer.apple.com/documentation/avfaudio/avaudiofile/read(into:)) 从 `framePosition` 顺序读，读到的帧数写在 `frameLength`。它的 Objective-C 实现在读不到帧时返回 `NO` 且不填 `NSError`。Swift 导入这类方法时，失败又没有错误对象，就会抛出 `Foundation._GenericObjCError.nilError`（[Handling Cocoa Errors in Swift](https://developer.apple.com/documentation/swift/handling-cocoa-errors-in-swift)）。旧循环在文件读完后再调用一次 `read`，正好落在这个点，而且包在 `convert` 阶段里。转换器的 `convert` 本身不 `throw`；`.endOfStream` 和 `.inputRanDry` 不是失败（[AVAudioConverter.OutputStatus](https://developer.apple.com/documentation/avfaudio/avaudioconverter/outputstatus)）。

修复只停在读完之前不再调用 `read`。文件已经到头时的 `nilError` 视为正常结束。文件还没读完时的 `nilError` 或其他错误仍然抛出，不写假设。没有改成 `analyzeSequence(from:)`。

13:54:54–14:09:55，`74fc3224` 编译通过，EOF 的 `convert` 错误已经越过，识别没有跑通。trace 大约从 13:56 起停在 `analyzer-finish`，直到 Node 的 15 分钟上限把进程杀掉。没有进入 `result-consume`。其余 15 条没有开始。stderr 为空，没有 `recognition-error.json`。两种语言仍是 `installed`，没有安装开关，没有权限提示。没有假设，没有比率。Node 把这次杀掉记成 `swiftExit` 1，那不是 Swift 自己的退出码。

结果任务在 `finalize` 之前就已经创建，所以不是「没启动消费」。[finalize(through:)](https://developer.apple.com/documentation/speech/speechanalyzer/finalize%28through:%29) 写明：如果输入序列里还没消费到给定时间，方法会一直等到消费到；返回时结果已经发到结果流，但调用方可以还没读。所以文档不支持「必须先读完结果，finalize 才会返回」这种死锁。`cont.finish()` 在进入 `analyzer-finish` 之前已经调用。产品侧是在麦克风流还开着时，用另一个 `Task` 调 `finalize(through:)`，并不在同一处等待它返回。我们这里用的结束时间是已喂帧数 `fed`，和产品的帧计数相同。输入已经关闭后再等这个时间，会不会永远等不到，目前只是假设，没有被这次日志单独证明。因此没有把结束调用换成 `finalizeAndFinishThroughEndOfInput()`。

每条样本的 `analyzer-finish` 现在自己限 45 秒。到点由 Swift 写出 `recognition-timeout` 并退出，这不是把 15 分钟上限加长。总进程上限仍是 15 分钟。如果仍是 Node 杀掉子进程，记录为 `timedOut`、信号、trace 里的阶段，`swiftExit` 为 null，没有假设。这不表示识别已经成功。

`e05a6beb` 的 45 秒上限还没有在 Mac 上跑过。最后一次真实运行仍是 `74fc3224`。

官方文件样例在 [WWDC25 session 277](https://developer.apple.com/videos/play/wwdc2025/277/)：`SpeechAnalyzer(modules:)`，然后 [analyzeSequence(from:)](https://developer.apple.com/documentation/speech/speechanalyzer/analyzesequence%28from:%29) 自己读文件并返回最后采样时间，再 `finalizeAndFinish(through: lastSample)`。结果用 `async let` 在分析之前开始读。当前脚本是另一条路：自己转 PCM，用输出帧数作 `AnalyzerInput` 的 `bufferStartTime`，`cont.finish()` 之后 `finalize(through: fed)`。源码里没有 `@MainActor`，所以不能从文件本身证明任务继承了 MainActor。结果任务创建了，不等于收到了事件。

待验证的唯一假设：手动路径的 `fed` 结束时间和分析器消费到的时间不一致，所以 `finalize(through:)` 停住；官方 `analyzeSequence` 对照如果能收到结果事件并返回，就说明识别器本身可用，故障在手动时间线。如果两条都收不到结果事件，这个假设不成立。这不是整集分数，`completeSet` 为 false，`rates` 为 null，不写 `hypotheses.json`。

14:52:56–14:55:57 的单句双路径把手动路径跑满 Node 的 3 分钟 `SIGTERM`（`swiftExit` 为 null，stderr 为空）。42 段从 0 连续到 170880，源和目标都是 170880 帧、16000 Hz、单声道，`finishRequestedFrame` 等于最后一段的 `endFrame`。`resultEventsReceived` 为 37，`finalizeReturned` 为 false。官方 `analyzeSequence` 条目不存在，因为同进程里的手动 `finalize` 没有把控制交回来。`withThrowingTaskGroup` 在 body 退出前会等已取消的子任务；`finalize(through:)` 不响应取消，所以 45 秒时限不会返回。37 个结果事件否定了「没有结果事件」。末次 `result.end` 为 9 秒，这不是消费位置的证据。

15:05:03–15:05:05，`diagnosticPath` 是 `let` 又被赋值，`swiftc` 失败，没有二进制，没有运行。随后改成 `var`。15:08:40–15:08:43，Mac 编译通过。编出来的 `diag-sa` 退出码 2，停在安装阶段：`speech-assets-not-installed`，locale `en-US`，状态 `supported`，`installFlag` false。`asset-status` 只有 en-US，`before` 为 `supported`，`installed` 为 false。没有 `diagnostic-run.json`，没有 trace，没有假设，没有分数。官方 `analyzeSequence` 仍未进入。同一命令这是第二次失败，到此停止，不再为了日志重跑。

源码里安装检查和手动路径用同一个 `speechModule`：`Locale(identifier: "en-US")`，`transcriptionOptions: []`，同一组 `reportingOptions` / `attributeOptions`，没有 `preset`。状态只调 `AssetInventory.status(forModules:)`。`install` 为 false 时不调用 `assetInstallationRequest`。源码里没有按解释执行或 `swiftc` 分支改这些参数，也没有 `release`。两小时前同机曾报 `installed`。源码不能说明状态为何回到 `supported`。

Node 把子进程退出码 2 收成总退出 0，并把顶层 `swiftExit` 写成 0。子进程的 2 只留在 `paths[0]`。这是包装错误，不是 Swift 退出 0。

t10u（15:14+08）要求换一次可证伪实验，不是重跑 15:08 的命令。选项 `--diagnostic-prepare-assets` 当时只在同时有 `--diagnostic-first` 和 `--diagnostic-path apple-file` 时合法。默认 16 句和单独的 `--install-assets` 不变。它只对公开英文首句 `en_us/1660/12742373433258665797.wav` 做一次 en-US 准备：状态已是 `installed` 就不下载；是 `supported` 就按官方 `assetInstallationRequest(supporting:)` 加一次 `downloadAndInstall()`。请求为 nil 时按官方含义不再下载，并立刻复查；复查仍不是 `installed` 就失败退出，不把 nil 或 `supported` 当成就绪。不调用 `release` / `reserve`，不碰其他语言。准备和 `analyzeSequence` 使用同一份编译出的 binary、同一个进程、同一个 `speechModule` 实例。`swiftc` 上限 90 秒。该进程的硬上限是 `min(180 秒, 4 分钟 − 编译用时)`。到点先发 `SIGTERM`；若 5 秒后进程还在，再发 `SIGKILL`。记录里的 `signal` 是实际结束进程的那个，`swiftExit` 为 null。阶段文件里的准备 120 秒、识别 45 秒是轮询杀掉，不是三套叠在一起的时钟；没有阶段文件时只剩进程硬上限。

15:31:08–15:31:11，这条官方命令在 Mac 上编译和运行都是退出码 0。en-US `statusBefore` 为 `supported`，`assetInstallationRequest` 一次返回 nil，没有下载，复查为 `installed`。准备后、识别前、结束时都是 `installed`。同一个 `speechModule`，同一份编译出的 binary。`analyzeSequence` 返回 `lastSampleSeconds` 10.679937499999999，即 170879/16000；文件是 170880 帧、16000 Hz。`finalizeAndFinish` 返回，reader 结束，37 个事件。`diagnosticText` 只有 `" Schlegel."`，`lastResultEndSeconds` 为 9。`success` 仍是 false。这不是整集分数，也不是产品分数。它只证明这次同进程序列能返回，不解释状态为什么从 `installed` 变成 `supported`。

[`finalize(through:)`](https://developer.apple.com/documentation/speech/speechanalyzer/finalize(through:)) 会等到分析器消费到给定时间码，含该点，才返回。`analyzeSequence` 返回的是最后一个被消费采样的时间码。这次就是 170879/16000，不是缓冲的独占终点 170880/16000。手动路径原来把帧数之和 `fed` 当作 through。那个时间码不是一个采样，按文档不会被消费，等待没有上界。手动 PCM 的 through 现已改成起点加帧数减一，时基仍是缓冲的采样率；帧数为 0 时直接失败，不把时间减成负数。从 0 起的 170880 帧对应 170879。15:43:40–15:44:28，这条手动命令编译成功。en-US 一直是 `installed`，没有请求，没有下载。trace 在 15:43:43 进入 `result-consume`，这个阶段只在 `analyzer-finish` 返回后才写，所以 `finalize(through:)` 已经返回。随后 `await reader.value` 不结束，直到 45 秒识别上限 `SIGTERM`。Node 退出码 2，`timedOut` 为 true，`swiftExit` 为 null。没有假设文件。当时 `diagnostic-run` 的中途 flush 是空的，文件仍停在 `recognize-before`，不能用里面的 false 否定 trace。

[`SpeechTranscriber.Result`](https://developer.apple.com/documentation/speech/speechtranscriber/result) 是按顺序送来的一段。`isFinal` 为 false 时是这段的修订，不进入定稿；为 true 时是这段的定稿。同一时间范围后来的定稿替换该段，不把修订重复拼上。评测原先只用最后一条 `isFinal` 的文本覆盖整句，所以接口走完后 `diagnosticText` 仍只有 `" Schlegel."`。定稿现按段拼接。这只改评测提取。产品桥仍是每条 final 单独送出。接口返回不表示转写正确。

[`finalize(through:)`](https://developer.apple.com/documentation/speech/speechanalyzer/finalize(through:)) 只把结果定稿，不结束分析会话，结果流继续开着。[`finalizeAndFinish(through:)`](https://developer.apple.com/documentation/speech/speechanalyzer/finalizeandfinish(through:)) 在同样的定稿之后结束会话，结果流随之终止。有限文件把输入 `finish` 掉也不会结束会话。产品麦克风流在会话还开着时调用 `finalize(through:)`，并不等待 reader 结束，因为后面还有音频。有限文件的手动 PCM 现改为 `finalizeAndFinish(through:)`，through 仍是上一轮的最后有效采样。不取消 reader，不把 volatile 当定稿，不改成 `analyzeSequence`。这次还没有在 Mac 上复验，所以不称 reader 已经会结束。

手动诊断现在每个阶段都写下 `fed`、`finishRequestedFrame`、`exclusiveEndFrame`、`inputLastEndFrame`、`finalizeReturned`、事件数和定稿分段。`diagnosticText` 只在 reader 正常返回后写入。45 秒上限不延长。已安装就不下载。官方文件对照不再跑。

15:54:36–15:54:39，同一条手动命令编译和运行都是退出码 0，没有超时。en-US 一直是 `installed`，没有下载。`fed`、`inputLastEndFrame`、`exclusiveEndFrame` 都是 170880，`finishRequestedFrame` 是 170879，`finalizeReturned` 为 true，reader 正常结束，阶段是 `done`。37 个事件，3 段相连的定稿：1.08–7.02、7.02–7.98、7.98–9。`diagnosticText` 是 “Romanticism had a large element of cultural determinism drawn from writers such as Goethe, Fished, and Schlegel.” 参考里的 Fichte 被听成 Fished，这不是截尾。`success` 仍是 false，不是质量分。

默认 16 句走同一个 `transcribe`：文件读到末帧停止、through 是最后有效采样、`finalizeAndFinish(through:)`、定稿按段拼接。资源在同一进程里先查 en-US 和 zh-CN。已安装不下载；`supported` 只做一次官方请求和复查。不调用 `reserve` / `release`。每句的 45 秒包在 `finalizeAndFinish` 外面；若这次调用不返回，进程内的取消等不到它，硬停止是整段进程的 180 秒。16 条音频合计 165.26 秒，短于 180 秒，所以上限不延长。不足 16 条字符串假设、子进程非 0、或被杀掉，都不留假设文件，`rates` 为 null。诊断用的 `success: false` 不写进这条 16 句记录。

2026-11-12 16:04:00–16:04:07（+08），macOS 27、Swift 6.4，同一份编译出的 binary 跑完 16 句，退出码 0，没有触发 180 秒上限。编译大约 2 秒。资源检查大约在 16:04:03：en-US 和 zh-CN 的 `before` 都是 `supported`，各一次官方请求且返回 nil，下载次数 0，复查为 `installed`。假设与冻结集的 16 个 id 和顺序一致，全是非空字符串，没有重复或错位。完整假设文件只在 16 句的 `finalizeAndFinish` 和 reader 都返回之后原子写入。逐句标志没有落盘，这里不补。整段用时 7 秒，含编译和准备，不是产品延迟，也不是模型实时率。音频合计 165.26 秒。16:04:42 的独立评分退出码 0。主席读取的 `score.json` 是 `ok: true`，`missing`、`unknown`、`rejected` 都是空数组。英文 WER：8 句、11/174、0.06321839080459771。中文 CER：8 句、33/301、0.10963455149501661。逐句 errors/length：英文 1660–1667 为 1/17、0/20、3/22、3/23、3/17、0/24、0/22、1/29；中文为 2/32、0/28、2/34、26/63、2/26、0/37、0/35、1/46。这些数字来自主席摘要，本仓库没有那份假设文件，也不记录它的 SHA。机器可读摘要在 [`eval/baselines/asr/mac-sa-16-chair-2026-11-12.json`](../../eval/baselines/asr/mac-sa-16-chair-2026-11-12.json)。原始文件在主席目录 `/workspace/baseline-sa-mac-20261112/full16-attempt1/`，可复核。`samples-0` 的记录数仍是 0。这不是 `e1_b1`，不是端到端，也不能据此排优劣。端到端仍 **待测**。

评分口径没有改。分母与冻结集第 3 字段经现有 `enTokens` / `zhChars` 后的长度一致，所以没有重算，也没有按假设去改参考。英文这 8 句的参考用单词 two；`Two` 与 `two` 是同一个词，数字 `2` 不是，规则不把 `2` 改写成 two。中文 CER 去掉空白、标点和符号，保留汉字、拉丁字母和数字，参考和假设走同一个函数。`cmn_hans_cn/1663` 的计分参考长 63，其中 42 个汉字、21 个拉丁字母（去掉空格后是 `cochamóvalleyyosemite`）。原始字段有括号，计分字段没有括号，但两边去掉标点后都是 63，括号不是多出来的长度。26/63 是中文 33 个错误里的大头。音频没有核对这串拉丁是不是被念出来了。参考保持冻结，分数不优化。这不是评分器分叉，所以不因此阻断这次冻结口径下的记录；它仍然只是探索性结果，不是排行榜比较。

一条命令完成预检、编译、资源、16 句、评分和证据包。`--audio-cache` 是已经含 `en_us/` 和 `cmn_hans_cn/` 的目录。冻结字段里的仓库前缀会在运行时去掉，JSON 本身不改。已有目录不会被覆盖。预检失败也写证据包，`rates` 为 null，并且 `appleResult` 为 false。坑和边界在 [asr-file-pits.md](asr-file-pits.md)。

```bash
node eval/baselines/asr/run-sa-file.js --audio-cache eval/baselines/asr/.cache/audio --out-root eval/baselines/asr/runs
```

离线包不含音频：`node eval/baselines/asr/pack-sa-file.js --out sa-file-bundle.tar.gz`。解开后：

```bash
node run-sa-file.js --audio-cache <existing-cache-audio> --out-root <new-runs-dir>
```

只重新打包一个已经存在的运行目录，不重新识别：

```bash
node eval/baselines/asr/run-sa-file.js --pack-existing <run-dir>
```

目录里缺分数或假设文件时，这条命令失败，并且不创建它们。

`cbc0c0e1` 在 Mac 上的一键验收，数字来自主席报告。本仓库没有读取 `/workspace/baseline-sa-mac-20261112/one-command-cache-fix-verification/`，也不记录那里源文件的 SHA。2026-11-12 16:44:14–16:44:22（+08）第一次退出码 0，用时 7.62 秒，含编译和准备。16:45:04–16:45:10 第二次退出码 0。两次的运行目录和 run id 各自独立，摘要哈希和证据包哈希不同，第一次的目录没有被第二次改写。两轮假设都是恰好 16 条非空字符串。主席报告的假设 SHA256 是 `b0dae4d76fdef94c8f051f436f01f864cafea19fff493685bd0c75ab042e8ea6`，分数文件 SHA256 是 `21a887d1fa30f86a2bc57f9f6f6900aa6c5bc62b117a97aafdd6555e3b9dc9e5`。英文 11/174，中文 33/301。`platformEligible`、`appleExecutionStarted`、`recognitionCompleted`、`appleResult` 都是 true。`productMetric`、端到端、以及和 `e1_b1` 相同，都是 false。en-US 和 zh-CN 都是 `supported`，官方请求返回 nil，复查 `installed`，下载 0。16:45:37 空缓存退出码 2，代码 `missing-audio`。没有假设文件，没有分数文件，`rates` 为 null，`appleResult`、`appleExecutionStarted`、`recognitionCompleted` 都是 false。`run-summary.json`、`MANIFEST.sha256`、`evidence.tar.gz` 都在，主席核过。这仍是 `cbc0c0e1` 的探索性组件结果，不是产品分。机器可读摘要在 [`eval/baselines/asr/mac-sa-one-command-cbc0c0e1-2026-11-12.json`](../../eval/baselines/asr/mac-sa-one-command-cbc0c0e1-2026-11-12.json)。

同一次 Mac 包里还有不在 MANIFEST 中的 `._*` 成员。`f1f1cbb2` 加上 `COPYFILE_DISABLE=1` 和 Darwin 的 `--disable-copyfile` 之后，2026-11-12 16:59:45（+08）的 `--pack-existing` 仍退出 2。这不是识别。假设、分数和摘要都没有改，原来的运行还在。Darwin bsdtar 3.5.3 不再写 `._*`，但默认 pax 仍为每个文件写 typeflag `x` 的 `PaxHeader/<file>`，6 个普通成员变成 12 个。校验拒绝并删掉包，外层只报了 `evidence-pack-failed`。本仓库没有读取那次的原目录。后来的修复改为 `--format=ustar`，并在输出里保留 `archive-members` 这类具体原因。上面是 `f1f1cbb2` 的失败记录，不是 `3bd90f75` 的结论。机器可读的失败记录在 [`eval/baselines/asr/mac-sa-pack-existing-f1f1cbb2-2026-11-12.json`](../../eval/baselines/asr/mac-sa-pack-existing-f1f1cbb2-2026-11-12.json)。

`3bd90f75` 的只打包在 2026-11-12 17:17:32（Asia/Shanghai）退出码 0，stderr 为空。它只对 `cbc0c0e1` 第一次成功运行的副本执行 `--pack-existing`，没有调用 `swiftc`，没有识别，也没有重新评分。假设 SHA256 `b0dae4d76fdef94c8f051f436f01f864cafea19fff493685bd0c75ab042e8ea6`、分数 SHA256 `21a887d1fa30f86a2bc57f9f6f6900aa6c5bc62b117a97aafdd6555e3b9dc9e5`、摘要 SHA256 `5752da98ef0446154e5f3a11da32e83fdfff54fbb762a4f21f9f4c1df65d3503` 的内容和修改时间都没变。原来的那次运行没有被碰。新证据包 SHA256 是 `d942a5c8774c0a6573e61336a7f29a1cbcc747cf6ad48e163e6eb8c795b0656a`，2944 字节。原始成员恰好 6 个 ustar 普通文件，typeflag 都是 `0`：`run-summary.json` 1349 字节、`score.json` 473、`hypotheses.json` 3227、`child-stdout.txt` 0、`child-stderr.txt` 0、`MANIFEST.sha256` 408。MANIFEST 的 SHA256 是 `35e8ee881095ebb8526a0237723b15e714fe9f193b5c1f9b14b18573b1531633`，五个被打包的文件与清单里的哈希一致。没有 `._*`、PAX 头、多余成员、符号链接、目录、绝对路径、`..`、音频、二进制、秘密或私人路径。stdout 里 `appleResult` 为 false，`rates` 为 null。这不是一次新的 Apple 识别，也不是 `3bd90f75` 又跑了 16 句。本仓库没有读取 `/workspace/baseline-sa-mac-20261112/one-command-ustar-verification/`。机器可读摘要在 [`eval/baselines/asr/mac-sa-pack-existing-3bd90f75-2026-11-12.json`](../../eval/baselines/asr/mac-sa-pack-existing-3bd90f75-2026-11-12.json)。

产品实施建议（不在本 PR 改 App）：给现有 `MTDeviceTranscriber` / `MTE1B1Transcriber` 加一条文件 PCM 入口，而不是再写一套识别器。

## 这批不引入的来源

Common Voice 的再分发请求、Gutenberg 在美国境外的版权、以及附件里的其他候选，都没有进入本切片。
