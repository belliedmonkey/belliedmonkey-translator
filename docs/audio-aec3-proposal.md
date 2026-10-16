# App 内 WebRTC AEC3 提案

日期：2026-10-16。这一份只写方案。不改代码，不放声，不改音量，不改 `ECHO_SIM`、`ECHO_TAIL_MS`、`ECHO_PLAY_MAX_MS`，不改扩展、Mac 系统声音字幕采集、中国版与国际版的分叉。写完即停，不开始实现。

用户 2026-10-15 同意：苹果回声消除停在 phase1h 的 Q（开着时对方的 880 Hz 也被压没）。改评估 App 内的 WebRTC AEC3。依据已贴 [issue #595](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6198182945)。phase1f 的 K 与 phase1g 的 N 不改分档。

2026-10-12 已同意、2026-10-15 写进 `docs/audio-engine-unify-proposal.md` 的方向，本提案不重开：所有朗读和收音进同一台原生引擎；参照是 App 自己的朗读；疑似回声留成能恢复的灰行；对方插话时只停当前这一句；三道文字阈值不改；开关默认关；扩展与 Mac 系统声音字幕采集不动。变的只有消回声的那一层：系统 Voice Processing 不再往下做，改为评估 AEC3。静麦和同语言硬拦要到第 4 节写的条件成立才撤。

查阅日期一律 2026-10-16。官方树是 `https://webrtc.googlesource.com/src` 的 `refs/heads/main`。没有找到独立的版本号（仓库根没有 `VERSION` 文件，同日请求为 404）。当时 main 的 tip 是 `52da778c185a17fe953ead983af213aa447e773e`，提交说明是 AV1，不是 AEC 改动。下面引的是这个 tip 上读到的文件，不把该提交说成 AEC 的一次发布。

## 1. 现状

### 1.1 这次的实测

对照 `docs/status/r5/echo-aec-proposal.md` 第 3.2 节和第 4 节。那两节把系统 Voice Processing 放在前面，AEC3 放成过不了关时的备选。2026-10-12 的方向沿用了这个顺序。phase1h 的 Q 就是那个「过不了关」。

| 次 | 分档 | 和 AEC3 提案有关的读数 |
|---|---|---|
| phase1c | 结果栏是 C，九通道全零（当时输入音量是 0） | 不是「能取到有声帧」。不记通过，也不记失败 |
| phase1d | C | 开着 VP、不挂播放，麦克风有非零采样。不是消除 |
| phase1e | **G** | 挂上播放节点之后 tap 仍有非零采样。**能取到帧**。不证明消除 |
| phase1f | **K**（不改） | 分档看放声段 maxAbs 比 0.7548732699192687。同一段 RMS 比 0.04372912558140089。K 是只看 maxAbs 造成的 |
| phase1g | **N**（不改） | 1 秒之后的评分窗里，3.8–4.8 秒的底噪片超过五分之一，最后超标片起点 4.8 秒，`convergenceSec` 为空。放声段里 0.2 秒那一片开/关 RMS 比已是 0.004311139680340659。N 是评分窗含进放完后的静音造成的 |
| phase1h | **Q** | 分析窗 [1.5, 3.0) 秒、通道 0，880 Hz 能量开/关 = 2.569771641978861e-11。440 Hz 比与整段 RMS 比不进分档。**对方的声音也被压没** |

日志在 `docs/status/vp-probe-phase1c-2026-10-15.json` 至 `vp-probe-phase1h-2026-10-15.json`。

phase1h 还有一个格式读数，第 2 节要用：关 VP 时 tap 是 48000 Hz（分析窗 72000 个采样）；开 VP 时 tap 是 44100 Hz（66150 个采样）。这是这次探针的读数，不是 Apple 文档里的保证。

### 1.2 r5 第 3.2 节、第 4 节里哪些句子这次不沿用

r5 把 AEC 放在 `micDeliver` 之前，参照取自播放器排进去的 PCM，再用主机时间对齐。这个**摆法**与统一引擎方案一致，第 3 节保留。下面这些数字和库名是那份旧方案自己的估计，不是 2026-10-16 读到的官方说法，本提案不沿用：

| r5 写的 | 本提案 |
|---|---|
| BSD-3；独立库 `webrtc-audio-processing`；编成 xcframework；约 1–2 MB | 许可证以仓库根 `LICENSE` 与 `PATENTS` 为准，见第 2 节。`webrtc-audio-processing` 不是 `https://webrtc.googlesource.com/src`。xcframework 与 1–2 MB 未找到 |
| 自带延迟估计和非线性残余抑制；效果接近通话级 | 延迟估计的类注释见第 2 节。没有读到「非线性残余抑制」或「通话级」这句评价 |
| 每路 16 kHz 单声道占一个核的 2–5% | 未找到。不写 CPU 百分比 |
| 10 ms 一帧，加上缓冲约 20–40 ms | 10 ms 帧长有官方出处。20–40 ms 未找到，不写进预算 |
| 代价表里「消除效果接近通话级」「插话全程保留」「延迟 +20–40 ms」「iOS / Mac 无系统副作用」 | 都还没测。插话保不保留，以第 5 节事先写的分档为准，不沿用这张表 |
| 过关标准里的 ERLE ≥ 20 dB | 统一引擎方案已经写明不沿用。本提案也不用 |
| SpeexDSP 作为被否的对照 | 本提案不评估 Speex |

r5 第 4 节推荐「先做系统 VP，两天不过关再转 AEC3」。phase1h 的 Q 满足「不过关」。本提案是这个转折，不是另一条产品方向。

### 1.3 `.mixWithOthers`

Mac 上不可读。phase1g / phase1h 日志里 `readable` 为 false，`lost` 为 null。

- `AVAudioSession` 与 `categoryOptions` 是 `API_UNAVAILABLE(macos)`（MacOSX27.0.sdk `AVFAudio.framework/Headers/AVAudioSession.h` 第 31、84 行）。
- `AVAudioSessionCategoryOptionMixWithOthers = 0x1` 是类别选项，注释写明随 iOS 6 / watchOS 2 / tvOS 9 引入（iPhoneOS SDK `AVAudioSessionTypes.h` 第 454–482 行）。
- macOS 上输入/输出节点对的是系统默认设备，不是 `AVAudioSession`（MacOSX27.0.sdk `AVAudioIONode.h` 第 103–105 行）。

这个选项只对 iPhone 有意义。是否保留仍未验证。本提案不改它，也不在 Mac 上找替代属性。

## 2. WebRTC AEC3 的官方依据

第三方帖子不进这张表。旧方案里的 `webrtc-audio-processing` 只算线索：它不是下面这个仓库。

| 事项 | 出处（2026-10-16，`refs/heads/main`） | 文档写了什么 |
|---|---|---|
| 仓库 | 根目录 `README.md`：Master source code repo 为 `https://webrtc.googlesource.com/src`。`docs/native-code/README.md` 写同一地址，并写明先读 License & Rights | 官方源码在这个仓库。没有读到单独的「AEC3 发行包」或语义化版本号 |
| 许可证 | 仓库根 `LICENSE`（版权 2011 The WebRTC project authors）：源码再分发须保留版权声明、条件与免责；二进制再分发须在文档或其他材料中再现同一段；未经事先书面许可，不得用 Google 或其贡献者的名字为衍生作品背书或推广。头文件另指向同仓库的 `PATENTS` | `PATENTS` 是额外的专利许可：对这份实现中必然侵权、且由 Google 可许可的权利要求给予许可；若被许可方就这份实现对任何实体提起专利诉讼，则该许可自起诉之日起终止。本提案不做法务结论 |
| 给调用方的接法 | `api/audio/audio_processing.h` 第 45–54、74–77、81–107、199–204、598–611 行 | 处理模块有两路：近端采集进 `ProcessStream()`，远端渲染进 `ProcessReverseStream()`。示例是 `config.echo_canceller.enabled = true`，渲染帧到了调 `ProcessReverseStream`，采集帧到了先 `set_stream_delay_ms` 再 `ProcessStream`。回声处理打开时，`set_stream_delay_ms` **必须**调用（if and only if） |
| 这个接口接不接受的采样率与帧长 | 同文件第 74–77、680–719 行 | 线性 PCM，块长约 10 ms（`kChunkSizeMs = 10`）。`GetFrameSize` 为 `sample_rate_hz / 100`：16000 Hz 是 160 个采样，48000 Hz 是 480 个，44100 Hz 是 441 个。整数接口的 native rate 列出 8000、16000、32000、48000。注释写明：采样率不能被 100 整除时，内部重采样到 10 ms 会造成模拟时钟漂移，并影响回声消除 |
| AEC3 类本身的采样率与帧长 | `modules/audio_processing/aec3/echo_canceller3.h` 第 84–93 行；`aec3_common.h` 第 28、44–49、57–64、100–111 行 | 类注释：接收 10 ms 的分带帧；下层用 64 个采样的块；只部分处理渲染调用与采集调用之间的抖动。`kFrameSize = 160`，`kBlockSize = 64`，`kBlockSizeMs = 64 * 1000 / 16000`（即 4），`kNumBlocksPerSecond = 250`。`ValidFullBandRate` 只有 16000、32000、48000。`NumBandsForRate` 为 `sample_rate_hz / 16000`（16 kHz 为 1 带，32 为 2，48 为 3）。8001 Hz 被断言为非法。**44100 不在 `ValidFullBandRate` 里** |
| 远端与近端怎么对齐 | `echo_canceller3.h` 第 84–93、109–117 行；`audio_processing.h` 第 598–611 行 | `AnalyzeRender` 保存分带渲染信号的内部副本。`ProcessCapture` 从分带采集信号里去掉回声。类注释只说部分处理两路调用顺序的抖动。`AudioProcessing` 要求调用方给出毫秒延迟：`delay = (t_render - t_analyze) + (t_process - t_capture)`。`t_analyze` 是帧送进 `ProcessReverseStream` 的时刻，`t_render` 是同一帧第一个采样被硬件播出的时刻；`t_capture` 是采集帧第一个采样被硬件采到的时刻，`t_process` 是同一帧送进 `ProcessStream` 的时刻 |
| 延迟估计怎么给 | `echo_canceller3.h` 第 125–126 行；`block_processor.h` 第 62–63 行；`echo_path_delay_estimator.h` 第 36 行；`echo_canceller3_config.h` 第 38–55 行；`clockdrift_detector.h` 类注释 | `SetAudioBufferDelay(int delay_ms)` 的注释是「可选的、外部给出的音频缓冲延迟估计」。`EchoPathDelayEstimator` 的类注释是「估计回声路径的延迟」。配置里 `use_external_delay_estimator` 初值 false，`fixed_capture_delay_samples` 初值 0，`default_delay` 初值 5。`ClockdriftDetector` 的类注释是通过分析估计出的延迟来检测时钟漂移 |
| 名字里的 AEC3 | `audio_processing.h` 第 151–152 行 | pipeline 注释写「AEC3 处于活动时」允许采集侧多声道。**没有写** `echo_canceller.enabled = true` 就等于构造 `EchoCanceller3` |
| 编译 | `docs/native-code/development/README.md` 第 3、28–33、81–98 行 | 支持的平台写了 Windows、Mac OS X、Linux、Android、iOS。默认构建系统是 Ninja，工程文件用 GN 生成（示例 `gn gen out/Default`）。Mac（含 iOS 支持）的**检出**体积估计 5.6 GB，原因是 Chromium 工具链和依赖，不是打进 App 的那一块 |
| 近端状态 | `modules/audio_processing/aec3/dominant_nearend_detector.h` 第 24 行 | 类注释：选择抑制器处于 nearend 状态还是 echo 状态。没有出现 double-talk / 双讲这几个字 |

`docs/native-code/README.md` 还写：这份原生包是给要集成 WebRTC 的浏览器开发者的；应用开发者被建议改用 WebRTC API。该页没有写这个浏览器 API 能否消掉我们自己 `AVAudioEngine` 里的朗读回声。

### 2.1 未找到

下面这些本次没有在上述官方文件里读到。不靠试参数补。

1. 语义化版本号，或「AEC3 单独发行」的版本。
2. `echo_canceller.enabled = true` 是否就是 `EchoCanceller3` 这一个类。
3. `EchoCanceller3` 构造函数里的 `NeuralResidualEchoEstimator*` 是否允许空指针。
4. `default_delay = 5` 的单位。相邻字段有的写了 samples、有的写了 blocks，这一项没有单位注释。不把它写成 5 ms 或 5 块。
5. `use_external_delay_estimator = true` 时的行为。只读到初值 false。
6. 双讲是否支持：没有 double-talk 的句子。nearend / echo 两种状态不能写成「对方说话时声音能通过」。
7. `initial_state_seconds = 2.5`（`echo_canceller3_config.h` 第 113 行）是否就是收敛时间。字段没有这句注释，不用它当门限。
8. 官方收敛毫秒数。
9. 「非线性残余抑制」、ERLE 门限、CPU 百分比、打进 App 之后增加的体积。
10. 把 AEC3 编成 xcframework 的步骤。iOS 构建子页本次没有读完；开发页只写了整棵树用 GN + Ninja。5.6 GB 是检出体积，不是 App 增量。
11. 浏览器 WebRTC API 能否作为本 App 朗读回声的消除器。
12. 蓝牙音箱与内置麦克风不在同一时钟时，检测时钟漂移之外是否会补偿。只读到「检测」。
13. 调用方若不是走 `ProcessReverseStream` / `ProcessStream`，该把扬声器参照和麦克风怎样对齐。官方对齐句子就是上面的延迟公式；公式以外的接法未找到。

## 3. 在我们架构里的摆法

消回声的一层换成 AEC3 之后，统一引擎方案第 3 节的边界仍在。hub 仍负责播放和唯一的输入 tap。AEC3 不识别、不翻译、不决定哪一行是回声。

### 3.1 参照与采集

参照信号取自统一引擎自己的朗读输出：sherpa 的 PCM、系统语音 `write()` 的 PCM、云端字节在原生解码后的 PCM，都先排进这台引擎的播放节点。听译会话里 WebKit 的 `new Audio`、`speechSynthesis`、保活 wav 不播放，也不当作参照。Mac 系统声音字幕的进程 tap 排除本进程，听的是别的 App，不并进这台引擎，也不当作参照。

麦克风走普通采集，不开苹果回声消除（`setVoiceProcessingEnabled` 保持关）。phase1h 已经说明开着时对方的声音也被压没。

按第 2 节的用法示例，远端是送进 `ProcessReverseStream` 的渲染帧，近端是送进 `ProcessStream` 的采集帧。延迟用该文件给出的公式现量，不预填常数。`EchoCanceller3` 上的 `SetAudioBufferDelay` 注释写的是可选；`AudioProcessing` 上的 `set_stream_delay_ms` 在回声处理打开时是必须的。本提案把接入面放在后者这条例子上。2026-10-16 已定：用这个入口，不直接构造 `EchoCanceller3`（第 6.3 节）。

采样率：AEC3 的 `ValidFullBandRate` 只有 16 / 32 / 48 kHz。phase1h 开着 VP 时的 44100 Hz 不能直接送进这个函数。关着 VP 的那一次读到 48000 Hz，这只是那次探针的格式，不是「关 VP 就总是 48 kHz」。2026-10-16 已定全带采样率用 16 kHz。实现前先读实际格式；若不是 16 kHz，先重采样到 16 kHz，再送进去。不把 44100 Hz 直接送进去，也不用「不能被 100 整除的采样率」去喂 `AudioProcessing` 的回声消除（该头文件写明这种速率会带来模拟时钟漂移并影响消除）。

### 3.2 Mac 与 iPhone

头文件没有把 AEC3 分成 Mac 版和 iOS 版。官方开发页把 Mac OS X 和 iOS 都列为支持的平台。iOS 构建子页已在 2026-10-16 读完，步骤与「未找到」写在 issue #595；本步只做 macOS，不编 iOS。

我们自己的差别：

- Mac：没有 `AVAudioSession`。输入/输出节点对默认设备。两天试做的范围仍是 Mac，与统一引擎方案相同。
- iPhone：类别仍由 `MTAudioBridge` 钉成 `.playAndRecord`。`.mixWithOthers` 是否保留未验证，本提案不改。声学验收不在模拟器上做（统一引擎方案已写：模拟器麦克风是 0 字节）。iPhone 不进尚未批准的声学探针。

### 3.3 打包体积与编译

官方编译方式是整棵原生树用 GN 生成 Ninja 工程，再用 Ninja 编其中一个目标。`docs/native-code/development/README.md` 第 144–149 行写明：编某一个目标用 `autoninja -C out/Default <目标名>`，例子是 `h264_depacketizer_fuzzer`，不是 `modules/audio_processing`。iOS 子页第 88–99 行写明：对想要的目标跑 ninja，目标列表用 `gn ls` 查看。`modules/audio_processing` 这个目标名本身未在这两页写出。Mac（含 iOS 支持）的检出估计 5.6 GB。打进 App 的体积仍未找到，第一步在仓库外测量。r5 的 xcframework 与 1–2 MB 不写进计划。体积测到并写明之前，不把 AEC3 编进中国版或国际版的出货包。

### 3.4 扩展、中国版、国际版

- 扩展没有这套 Swift，也不获得麦克风源（`docs/domain-design.md` 第 384–392 行）。本提案不改扩展。听译会话里扩展仍用 WebKit 出声。
- 中国版与国际版共用 `scripts/sync-app-assets.js` 灌进工程的同一份 `audio-bridge.swift` 与 `speech-bridge.swift`（该文件第 388、393–405 行）。不按 flavor 分叉音频路径。开关默认关；关着时两版行为与今天相同。
- Mac 系统声音字幕采集保持现状，不并进朗读引擎。

## 4. 与已定规则的衔接

这些规则来自 `docs/audio-engine-unify-proposal.md`，本提案只把「打开系统 VP 之后」改成「AEC3 这条路径按第 5 节过关之后」。

| 规则 | 衔接 |
|---|---|
| 静麦 | 现在仍置位。只有第 5 节三项都过、并且开关打开时，才不再把帧置零。没过之前不撤 |
| 同语言硬拦 | 同样。没过之前，`intakeDecide` 的 `speaking` 支和半句上的同语言丢弃保持今天的行为 |
| 疑似回声灰行 | 两项硬拦撤掉之后，文字相似度改成可恢复的灰行，不翻译、不朗读、不进语料。灰行是用户能看见的界面，Pencil 稿放在声学三项通过之后，失败就不出稿 |
| 插话 | 只停当前正在念的那一句。队列里还没开口的后续句接着念。灰行不触发打断 |
| 三道文字阈值 | `ECHO_SIM` 0.35、`ECHO_TAIL_MS` 3000、`ECHO_PLAY_MAX_MS` 15000 不改 |
| 开关 | 默认关。关着时两版都是今天的路径，包括静麦。退回静麦的开关只放在内部诊断里，不进设置页 |
| 苹果 VP | 保持关。phase1h 的 Q 之后不再改调用顺序重试 |

## 5. 验收口径

沿用 phase1g / phase1h 的做法：先关后开，中间至少 5 秒，不交换顺序，不重试；只看通道 0；不保存麦克风音频；只在试做窗口内改输入音量，结束时还原；不改输出音量、提示音和静音。分档写在开跑之前。**本次不开跑。**

三项都要测，并且都过，这条路才可以再谈撤掉两道硬拦。任一不过就停，不改分档，不改 `EchoCanceller3Config` 里的字段再跑。重复出字、乱序、卡住、说中文键时英文侧乱码，仍以基线 `~/mobiletranslator/.local/release-baseline-1.19.3.md` 的 0 为准（2026-10-15 读到的硬指标）。该文件不复制进仓库。这四项不是下面的声学分档；AEC3 若以后进到听译会话，任一项高于 0 即差于基线。

苹果 VP 不参与这三项。对照是「AEC3 关」与「AEC3 开」，麦克风两边都是普通采集。

### 5.1 放自己的声音时压低

只看放声的那 3 秒（与 phase1f 的放声段相同）。不用 phase1f 的 maxAbs。不把放完后的静音算进去（那是 phase1g 的 N）。

- **过**：放声段内，开的 RMS ≤ 关的 RMS / 5。
- **不过**：放声段 RMS 比高于 1/5。
- **E**：任一次抛错。不算过，不重试。

### 5.2 同时有别人说话时，对方的声音能通过

这一项用 880 Hz，或用真实语音。两条都还没对 AEC3 跑过。2026-10-16 已定：先跑 880 Hz，再跑真实语音（第 6.3 节）。分档现在写好。

**880 Hz**（做法与 phase1h 相同：引擎放 440 Hz，0.5 秒后另一路放 880 Hz；分析窗 [1.5, 3.0) 秒；通道 0；Goertzel 功率 / N²）：

- **过**：开的 880 Hz 能量 ≥ 关的 / 2。相等算过。
- **不过，停**：开的能量 ≥ 关的 / 10 且 < 关的 / 2。
- **不过，停**：开的能量 < 关的 / 10。phase1h 的苹果 VP 落在这一档。
- 关的能量为 0、外放那一路退出码不是 0、或样本对不齐：不算分，不重试。
- 440 Hz 能量和整段 RMS 只记录，不进这一项。

**真实语音**（不另造文字门限）：

- **过**：AEC3 开着、对方在朗读期间说的那一句被收下，并且不是被静麦或同语言硬拦丢掉的。
- **不过**：那一句没有被收下，或只有关掉 AEC3 才被收下。
- 这一句的重复出字、乱序、卡住、乱码仍以基线的 0 为准。高于 0 即差于基线，与上面的「过」同时失败。

### 5.3 收敛时间

官方没有写收敛毫秒数。`initial_state_seconds = 2.5` 不拿来当门。门是本提案事先写的，只看放声的 3 秒，100 ms 一片，通道 0：

- **过**：存在片起点 t（相对放声命令），t ≤ 1.0 秒，并且从 t 到放声结束的每一片，开的 RMS ≤ 关的 RMS / 5。最早的那个 t 记成收敛时间。
- **不过**：放声段内没有这样的 t，或最早的 t > 1.0 秒。
- 放完之后回到底噪的片子不进这一项。
- **E**：抛错。不重试。

1.0 秒沿用 phase1g「从 1 秒起算」的窗口位置，但窗口到放声结束为止，不到探针的第 6 秒。这不是官方收敛时间。

## 6. 风险、停手、要用户决定的问题

### 6.1 风险

- AEC3 还没测。phase1h 说明苹果 VP 会把对方的声音一起压没；AEC3 会不会同样压没，只有第 5.2 节能回答。
- 延迟公式要现量。把 `default_delay = 5` 猜成一个单位再填进去，就会走到文档没写的参数上。
- 设备格式若是 44100 Hz，必须先重采样。直接送进去不在 `ValidFullBandRate` 里。
- 时钟漂移只读到「检测」，没读到「补偿」。蓝牙音箱加内置麦克风是否对得齐，未找到。
- 打进 App 的体积未找到。整树检出是数 GB 量级，不能把整树塞进出货包。第一步只在仓库外测量编译体积，测到之前这条仍是未找到。
- `LICENSE` 与 `PATENTS`（含专利诉讼则许可终止）已由用户于 2026-10-16 接受。这不是法务结论。源码仍放在仓库外，不引进本仓库。
- 原生包的说明把应用开发者指向浏览器 API。那个 API 没有写能消我们自己引擎里的回声。本提案仍评估原生 AEC3，因为统一引擎方案已经把备选写在这份源码上；不把浏览器 API 写成退路。

### 6.2 停手

出现任一条就停，不改阈值，不改分档，不再跑一次碰运气：

- 再打开苹果 Voice Processing。
- 改 `ECHO_SIM`、`ECHO_TAIL_MS` 或 `ECHO_PLAY_MAX_MS`。
- 为了过关去改 `EchoCanceller3Config` 里本次没有读到行为说明的字段，或把 `default_delay` 猜一个单位填上。
- 把 44100 Hz，或其他不在 `ValidFullBandRate` 里的速率，直接送进 AEC3。
- 第 5 节三项任一不过，仍继续改参数重跑。
- 三项还没过，就撤静麦或同语言硬拦。
- 改扩展、Mac 系统声音字幕采集，或按中国版 / 国际版分叉音频路径。
- 开关默认打开，或关着时两版行为与今天不同。
- 没有 Pencil 稿就做灰行界面。
- 用户还没接受 `LICENSE` 与 `PATENTS`，就把源码引进仓库。
- 体积还是「未找到」，就把 AEC3 编进出货包。

### 6.3 用户答复（2026-10-16）

下列六项按本提案的建议定案。已定且不重开的还有：不重开统一引擎、灰行、只停当前句、三道阈值、开关默认关、扩展与系统 tap 不动、苹果 VP 停止。

1. **先做独立探针，不接 App。** 不接入统一引擎，不开苹果 Voice Processing，不撤静麦和同语言硬拦。探针与 App 代码分开。
2. **全带采样率用 16 kHz。** 这是 `ValidFullBandRate` 里的一档。不改用 48 kHz，也不试跑挑选。
3. **按 `audio_processing.h` 的用法示例，用 `AudioProcessing` 入口。** 打开 `echo_canceller.enabled`，远端走 `ProcessReverseStream`，近端在 `set_stream_delay_ms` 之后走 `ProcessStream`。不直接构造 `EchoCanceller3`。头文件仍没有写这两个入口是同一个对象；按已定的入口用，不改用另一个。
4. **已接受仓库根的 `LICENSE` 与 `PATENTS`，包括专利诉讼则许可终止。** 这是用户接受这两份文件，不是法务结论。源码放在仓库之外，不提交进本仓库。
5. **别人说话先跑 880 Hz，再跑真实语音。** 第 5.2 节两套分档都还没跑。880 Hz 没有过之前，不开始真实语音。
6. **iPhone 的 `.mixWithOthers` 等 Mac 通过后另批。** Mac 上这个选项不可读。本次不验证、不改。Mac 上的探针通过之前，不单独做 iPhone 的只读检查。
