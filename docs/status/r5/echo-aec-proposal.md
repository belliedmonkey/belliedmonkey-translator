# 提案：朗读回声：用「App 自己的朗读声」做回声消除参照，保留对方插话

> 状态：**待用户评审**。本提案只读了代码，没有改代码、没有提交、没有动 App。
> 代码基准：用户 Mac `~/dsh-plugins/release1194/wt4`，分支 `fix/1194-r4`，提交 `371c4bf4`。
> 用户定的方向：把 App 的朗读声作为回声消除的参照信号，只消掉 App 自己的声音，保留对方插话。

---

## 一、现象

- 开着「自动朗读译文」外放时，App 读出的译文被麦克风收回来。**另一种语言**的识别通道把这段声音认成乱码，生成多余的行。
  - 113 验收：3 行回声。`, you, Hitong Fu Ben Bing song?`（中文译文被英文通道收进来，听着就是「合同副本并送」）、`theafternew.`、`去`。前两行显示「译文失败」，第三行被译成 `Go.`，还拖慢了正常句子的翻译。
  - 114 验收：又出了一行 `she.`。
  - dsh 第 4 轮在本机复现：`中文Plea teares afernow ⏳ 译文准备中…`。
- 之前试过两种修法，都已撤掉：
  1. 朗读期间丢掉所有识别结果：回声没了，但对方插话也被丢了，M4/M5/P-12 挂。
  2. 在收音引擎上直接开 `setVoiceProcessingEnabled(true)`：和 App 自己的朗读冲突，M2–M5、P-08 挂（朗读队列排不空）。

---

## 二、根因

### 2.1 播放链和收音链（代码地图）

**结论：朗读和收音不在同一个 AVAudioEngine 里。** 现在一共有 3 个独立的原生 AVAudioEngine，另外还有 2 条由 WebKit 播放的路，原生层根本看不到这两条。

| 链路 | 用途 | 实现 | 关键位置 |
|---|---|---|---|
| **收音** | 实时听译的麦克风 | `MTAudioBridge.micEngine`（独立的 AVAudioEngine）：`inputNode` 装一个 tap → `micDeliver` → `micSink`（交给设备转写 + VAD/LID）或 `mic-pcm`（交给 JS） | `app/native/audio-bridge.swift`：`micEngine` :164；`muteInput` :180；`micSink` :184；`micBegin` :232–276（iOS 设置 `.playAndRecord` :236–238，`AVAudioEngine()` :245，`installTap` :261，`start` :266）；`micDeliver` :279–322（静麦置零 :281–285，`micSink?(buffer)` :286）；配置变化后重建 `onEngineConfigChange` :677–688 |
| **朗读 1：设备内置模型** | 引擎 `device`（sherpa-onnx：Kokoro 中英 / vits 泰语） | `MTDeviceSpeech`：**自己建的** AVAudioEngine + AVAudioPlayerNode → mainMixer → output | `app/native/speech-bridge.swift`：`engine/player` :632–633；`speak` :765–842（合成回调 → `MTSpeechChunkBox.schedule`）；首块出声时开静麦 :820，播完关 :834；`stop` :844–852；`ensurePlayer` :854–872（`AVAudioEngine()` :861） |
| **朗读 2：系统语音（原生）** | 引擎 `browser` 在 App 里优先走这里 | `MTSystemSpeech`：`AVSpeechSynthesizer.write()` 交出 PCM → **又一个**自建的 AVAudioEngine + PlayerNode | `speech-bridge.swift`：`synth.write` :945；开静麦 :959，关 :949/:990；`ensurePlayer` :996–1007（`AVAudioEngine()` :999） |
| 共用的块调度器 | 上面两条都经过它 | `MTSpeechChunkBox`：`scheduleBuffer(.dataPlayedBack)` 加上「首块时刻 + 总时长」的定时器，谁先到算谁 | `speech-bridge.swift` :1015–1068（`schedule` :1032–1046，`finish` 的定时器 :1057–1065） |
| **朗读 3：云端 / 自建端点** | `grant_speech`（国际版登录送的免费额度）、OpenAI、OpenRouter、本地端点 | JS 里 `new Audio(dataURL)`，由 **WebKit 自己的进程**播放 | `extension/learn/tts.js` `speakBytes` :699–739 |
| **朗读 4：WebKit speechSynthesis** | 原生系统语音没有对应声音时的退路 | WebKit 播放 | `tts.js` `speakBrowser` :632–694 |
| JS 调度 | 自动朗读队列 | `autoSpeak` → `speakPump` → `speakOut` → `LearnTTS.speak` | `src/app/listen-model.js`：`speakOut` :2259；`speakPump` :2286（`echo.speaking` 在播放前登记，`echo.spoke` 在 `r.done` 之后）；`autoSpeak` :2367 |
| JS 回声闸 | 兜底 | `makeEchoGuard`（`playingLangs` 同语言硬闸 + 文字包含度 `ECHO_SIM=0.35`、`ECHO_TAIL_MS=3000`）；`intakeDecide` 的顺序是 ①朗读中同语言 → ②LID 归属 → ③文字回声 | `app/listen-core.js` :203–215、:254–300、:1070–1084；`listen-model.js` `intakeFinal` :1266–1325，半句闸 :1347–1348 |

收音这一侧：`micBegin` 是 `MTAudioBridge` 自己 `new` 的 engine，tap 只看得到麦克风。两个原生朗读后端各自 `new` 一个 engine，输出直接进系统混音。所以**任何一个 engine 上开的 voice processing，都拿不到朗读声做参照**。

### 2.2 现有防线和漏点

现在的防线有两层：

1. **原生静麦 `muteInput`**（2026-09-13 定为常开）：原生朗读出声时，交给识别器的是**同长度的静音帧**，播完后再静 350 ms。
   - ⚠️ 这一条说明：**现在用原生朗读时，对方插话本来就被整段静掉了**。test:mac 的 M4/P-12 注入的是**事件**（`__mtTest.say` 直接发 `stt-final`，见 `app/test-harness.js:65–78`），绕过了音频，所以测不出来。要实现用户定的「保留对方插话」，就得在 AEC 模式下**撤掉静麦**。
2. **JS 回声闸**：朗读中的同语言定稿直接丢（规则 (g)），其余按文字相似度判。

按 dsh 的根因（rootcause.md 第 3 条），加上我读代码补的两条，漏点如下：

- **L1（dsh 已指出）**：硬闸只认「正在朗读的那门语言」。另一门语言的通道把读声认成乱码，`base ≠ 朗读语言`，硬闸不拦；文字已经面目全非，相似度闸也拦不住。
- **L2（新发现，代码可证）**：**R14「候补转交」绕过了回声闸。** 例：App 正在读英文，中文通道把读声认成拉丁字母的短句（`theafternew.` 这类）。LID 判的是 `en`，于是在 `intakeDecide` 的②被归属闸拒掉，同时被标成「可转交」（`isXferCandidate`，`listen-core.js:1388–1397`，≤3 个词）。等一次空闲（`SEG_IDLE_MS=1500`）之后，`onXfer`（`listen-model.js:1254–1262`）直接 `seg.feed` 进英文通道，**不再查** `playingLangs('en')`，也不再查 `isEcho`。113/114 的回声大多是拉丁字母短句，和这条路完全吻合。
- **L3（待证实）：为什么开着静麦，回声音频还能进识别器？** 两个假设：
  - **H1（我认为可能性更大）**：这几场用的是**WebKit 播放的朗读**（国际版登录送的 `grant_speech`、自建端点，或者 WebKit speechSynthesis 退路）。这些路**不触发 `muteInput`**，音频照样进识别器。佐证：dsh 试过「朗读期间丢掉所有定稿」，确实能消掉回声。那道闸的时间窗就是 JS 的播放窗口，和 H1 吻合。
  - **H2**：静麦放开得太早。`MTSpeechChunkBox.finish` 的定时器从「首块入队」起算 `总样本数 / 采样率`，前提是合成比实时快。Kokoro 在 CPU 吃紧时合成可能更慢，块和块之间有空隙，定时器就会先到；而且它没算输出设备的延迟（蓝牙音箱有 100–300 ms）。
  - **核实办法**：查 113/114 两场 `bt_diag_events` 里 `speak` 事件的 `engine` 字段（`tts.js` 的 `speak()` 本来就记了），再把诊断录音的 `mic.caf` 和 `tts-*.caf` 对齐，看回声音频落在静麦窗内还是窗外。这一步只读数据，不用改代码。

### 2.3 为什么上次 `setVoiceProcessingEnabled` 会冲突

下面是代码结构加上 Apple VPIO 已知行为得出的**推断**，要在 spike 里证实：

1. **参照信号根本不对**：VP 只开在收音 engine 上，它的回声参照是**这个 engine 自己的输出**，而这个 engine 不放任何声音。朗读从另外两个 engine 出去，VP 等于对着静音做消除，**哪怕不冲突也消不掉朗读回声**。
2. **影响其他 engine**：开 VP 后，系统把这个 App 的 I/O 换成 Voice-Processing I/O，设备格式和聚合方式都会变，同进程的两个朗读 engine 可能收到 `AVAudioEngineConfigurationChange` 被停掉。PlayerNode 停了，`.dataPlayedBack` 回调丢失，`tts-end` 的时机就乱了。这和 test:mac 里「`drained()` 永远等不到」（M4/M5 超时）、M2/M3 红对得上。
3. **把自己的朗读当「其他音频」压低**：VPIO 默认会压低其他音频，同进程另一个 engine 的朗读也算在内。
4. **可能自激重建**：收音 engine 的 `onEngineConfigChange`（:677–688）一收到配置变化就整套重建 `micBegin`。如果 VP 在 `micBegin` 里打开，开 VP 本身又会触发配置变化，就可能反复重建。
5. **历史记录**：`docs/learning-design.md` 记过 2026-09-12 的 spike：「**挂了 playerNode 的 engine 上开 VP，tap 收到 0 帧（未解）**」。这正是方案 (a) 要用的拓扑，所以它是 (a) 的**第一道关**。常见原因是开 VP 后输入格式变了（变成单声道或改了采样率），tap 却还按开 VP 之前的格式装。要先开 VP、再读格式、再装 tap。

---

## 三、解法

### 3.0 第 0 步（不管选哪个方案都先做，便宜，马上见效）

- **0-a 查清 L3**：按 2.2 的核实办法，确认 113/114 用的是哪个朗读引擎、回声落在静麦窗内还是窗外。
- **0-b 堵 L2**：转交真正执行时（`makeTransferGate.fire` / `onXfer`），**按目标语言再过一遍**回声闸：`playingLangs(目标).has` 或 `isEcho` 或「疑似回声」（3.4）命中就丢，记 diag `intake:xfer-echo`。不在朗读窗内时，R14 的行为不变。
- **0-c 静麦对准真实播放**（H2 成立才做）：放开时间改用播放器的真实渲染时间（`player.playerTime(forNodeTime: lastRenderTime)`），再加上输出延迟（iOS 用 `AVAudioSession.outputLatency`，Mac 用 `outputNode.presentationLatency`）。这一条只在「静麦」退路模式下有意义。

### 3.1 方案 (a)：朗读和收音共用一个 AVAudioEngine，开系统 Voice Processing（**推荐**）

**做法**
- 新建一个原生单例 `MTAudioHub`，持有**唯一**的 AVAudioEngine：
  - `inputNode` 装 tap，即现在 `micBegin` 的逻辑，挪进来。
  - 一个 `ttsPlayer: AVAudioPlayerNode` → `mainMixerNode` → `outputNode`。
  - **开 VP 的顺序必须固定**：engine 停着 → `inputNode.setVoiceProcessingEnabled(true)`（输出节点会一起开）→ 读开 VP **之后**的 `inputNode.outputFormat(forBus: 0)` → 用这个格式装 tap、建转换器 → `prepare/start`。
  - 压低其他音频的程度设到最小：`voiceProcessingOtherAudioDuckingConfiguration = (advanced: false, level: .min)`（iOS 17 / macOS 14 起，要加 `#available`；部署目标是 iOS 16.4 / macOS 13.3，不过设备转写本来就要 26，听译路不受影响）。
  - AGC 默认开还是关，在 spike 里比较 `isVoiceProcessingAGCEnabled` 两种设置的识别率再定。
- `MTDeviceSpeech.ensurePlayer` 和 `MTSystemSpeech.ensurePlayer` **不再自建 engine**，改向 hub 要 player。`MTSpeechChunkBox.schedule` 把块统一转成 hub 的固定格式（例如 48 kHz 单声道 Float32），**运行中不重连节点**，避免触发配置变化。
- **云端 / 自建端点的朗读改由原生播放**：JS 不再 `new Audio()`，而是发 `tts-play {id, b64, mime}`，原生用 AVAudioFile 解码后排进同一个 player，`tts-start`/`tts-end` 的协议不变。否则这部分声音进不了参照，H1 那类回声消不掉。WebKit speechSynthesis 退路在听译会话期间改成具名失败（原生系统语音已经覆盖了大部分语言），或者接受它没有 AEC。
- **只在「对话听译」会话里开 VP**：
  - `micBegin` 时开，`micStop` 时关，**只在会话边界切换**，绝不在一句话中间切。
  - 「实时字幕」（`recordProfile == "subtitle"` / Mac 系统声音 tap）**不开 VP**：那里本来就是要听外放的视频声，VP 的降噪会伤识别。
  - 播客、学习页的朗读（不收音）不开 VP，音质不变。
- **退路**：配置项 `echoMode = 'aec' | 'mute'`。下面任一情况自动落回 `mute`（现在的静麦），并记 diag，**会话不断**：开 VP 抛错、开 VP 后 1 s 内 tap 收不到帧、`start` 失败。
- AEC 模式下：撤掉原生静麦（否则插话照样被静掉）；JS 的规则 (g)「朗读中同语言直接丢」降级成 3.4 的「疑似回声」判定（要用户定，见第六节）。

**为什么能避开上次的冲突**：朗读走 VPIO 自己的输出总线，所以参照就是朗读声本身；只剩一个 engine，没有「另一个 engine 被停、被压低」的问题；VP 只在会话开始时切一次，不会在朗读中途改 I/O；配置变化的处理统一收进 hub，开 VP 不再触发自激重建。

**改动范围**：原生 `audio-bridge.swift`（收音挪进 hub）、`speech-bridge.swift`（两个 `ensurePlayer`、`MTSpeechChunkBox`、新增 `tts-play`），JS 的 `tts.js` `speakBytes` 改走原生，`native-speech.js` 加一个消息类型。估计 400–600 行，加上 spike。

**对两端的影响**
- **iOS**：VP 在 iPhone 上很成熟（FaceTime、微信都用这条路）。已知风险：开 VP 后**扬声器外放音量会明显变小**，音色也偏「通话感」；接 AirPods 时如果走 HFP，会降成窄带。要在真机上比较 `.defaultToSpeaker` 和不同 mode 的效果。锁屏后台不受影响，类别还是 `.playAndRecord`。
- **Mac**：会话期间控制中心会出现「麦克风模式」（语音突显 / 宽频谱），用户看得见；其他 App 的声音可能被轻微压低。外接多声道 USB 声卡上 VP 可能起不来，这时会落回 `mute`。

**延迟**：VP 增加大约 10–30 ms 采集延迟，相对现在 600 ms 的静音收口可以忽略。

**风险**
- R-a1 **0 帧问题**（2026-09-12 记录在案，未解）：spike 第一关就验它，过不了就换方案 (b)。
- R-a2 朗读音量和音质变差，尤其是 iPhone 外放。
- R-a3 macOS 的 VP 是否连**其他进程**的声音也消掉，影响 test:mac 用 `say` 模拟插话。如果会消，物理测试的插话声要换另一台设备来放。
- R-a4 两个采样率的语音（Kokoro / vits / 系统语音）统一重采样后，音质要再听一遍。

### 3.2 方案 (b)：App 内自己做 AEC（WebRTC AEC3 或 speex），用朗读 PCM 当参照

**做法**：在 `micDeliver` 之前插一级 AEC。参照信号来自 `MTSpeechChunkBox.schedule` 交给播放器的 PCM（诊断录音的 `tts` 流已经在这一点上采集了），按播放器的真实渲染时间加输出延迟打上主机时间戳，放进环形缓冲；麦克风 tap 交来的块带 `AVAudioTime.hostTime`，两边按时间对齐后喂进 AEC。

- **WebRTC AEC3**（BSD-3，可以用独立的 `webrtc-audio-processing` 库编成 xcframework，约 1–2 MB）：自带延迟估计和非线性残余抑制，效果接近通话级。
- **SpeexDSP**（BSD，几十 KB）：线性 MDF 滤波器，对扬声器失真和长混响弱，对齐要求更严，**不推荐**作为主方案。

**优点**：不碰系统 VP，朗读音量、音质和 Mac 控制中心都不变；**可以完全确定性地离线测试**（往麦克风里注入「朗读声卷积房间脉冲响应 + 插话 + 噪声」），test:mac 能稳定复现。

**代价和风险**：工程量最大（引入 C++ 库、两端编译、对齐、调参）；外放和麦克风不在同一个时钟时（蓝牙音箱 + 内置麦克风）会有时钟漂移，AEC3 只能部分应付；CPU 估计每路 16 kHz 单声道占一个核的 2–5%（待实测）。云端朗读同样要改成原生播放才有参照。

**延迟**：10 ms 一帧，加上缓冲，约 20–40 ms。

### 3.3 方案 (c)：其他做法

- **(c1) 保留静麦，加「插话检测」**：朗读时识别器照样喂静音，但原生侧对**原始**麦克风做近端检测：麦克风能量明显高于「按朗读参照估出来的回声能量」，就判为有人插话 → **停掉（或压低）App 的朗读**，放开静麦，并把最近 500 ms 的原始音频补喂给识别器。改动中等，不依赖任何 AEC 库，行为可控。但这是**产品行为变化**：对方一开口，App 就停读，后半句译文对方听不到；插话的开头有 200–300 ms 可能丢。
- **(c2) 朗读期间暂停识别**：用户已否决（插话全丢）。现在原生静麦其实就是这个效果。
- **(c3) 戴耳机提示 / 降低外放音量**：只能辅助，不能根治。

### 3.4 兜底：疑似回声判定（各方案通用，在 JS 里做纯函数，可单测）

AEC 不可能 100% 消干净。兜底只拦「**同时满足所有回声特征**」的短句；只要出现**任意一条插话特征**就放行。另外它不当场丢，而是**先扣住**，等朗读结束再裁决。

**前提数据（原生补齐）**
- 播放窗用**原生真实**的 `tts-start`/`tts-end` 时间，不用 JS 的 `speak` 时刻。
- `stt-final` 带上 `t0/t1`（现在部分路径已有）和 `conf`（Dictation 为 -1）。
- AEC 模式下，原生按每段话额外给出 `near`（近端活动）：AEC 之后的残余能量明显高于残余底噪、且 VAD 判为人声的帧占比。

**判为「疑似回声」需要同时满足（全部成立）**
1. **时间重叠**：这段话的音频区间 `[t0, t1]` 有 ≥60% 落在某段朗读窗 `[播放开始, 播放结束 + 800 ms]` 内。
2. **跨语言**：识别通道的语言 ≠ 正在朗读的语言（同语言的情况由现有规则或 AEC 模式下的同款判定处理）。
3. **短**：≤4 个词 / ≤6 个汉字 / 时长 ≤1.5 s。
4. **劣化**（满足其一即可）：`conf < 0.5` 或 `conf == -1`；中文通道吐出纯拉丁字母（L2 那类）；这一段的 **LID 判词 = 正在朗读的语言**（LID 听到的是英文，而中文通道吐出乱码，这是最强的信号）。
5. **没有近端活动**：AEC 模式下 `near == false`（静麦模式没有这一项，就跳过）。

**处置**：先扣住，等到「播放结束 + 800 ms」。期间如果出现下面任一情况就放行，否则丢弃并记 diag `intake:echo-suspect`（附文字和特征，只存本机）：
- 同一通道接着说出更长的话（说明是真人在说）；
- `near` 变为 true；
- 用户在这段时间按下了说话键。

**怎么做到不误杀插话**
- 真人插话通常**长**（>1.5 s）、**置信度高**、LID 判词和自己的通道一致、AEC 之后**有近端能量**。这四条里只要有一条不符合回声特征，就不算疑似回声。
- 扣住只发生在朗读窗内，而且最多多等 0.8–1.5 s。最坏的情况是插话**晚上屏一下**，不会被吞掉。
- 朗读窗外完全不受影响（M4「念完后回话照收」的语义不变）。
- 同一套判定也用在 0-b 的转交复查上。

---

## 四、代价

| | (a) 共用 engine + 系统 VP（推荐） | (b) App 内 AEC3 | (c1) 静麦 + 插话检测 |
|---|---|---|---|
| 改动范围 | 原生两文件重构 + 云端朗读改原生播放 + JS 兜底，约 400–600 行 | 引入 C++ 库 + 对齐 + 调参 + 云端朗读改原生 + JS 兜底，约 800–1500 行加构建 | 原生近端检测 + 朗读停止/压低 + JS 兜底，约 300–500 行 |
| 消除效果 | 通话级，Apple 针对自家硬件调过 | 接近通话级，要调参 | 不消除，靠「停读」规避 |
| 插话保留 | 全程保留 | 全程保留 | 插话开头可能丢 200–300 ms，App 停读 |
| 延迟 | +10–30 ms | +20–40 ms | 插话检测 200–300 ms |
| iOS 影响 | 外放音量 / 音色可能变差（要验） | 无系统副作用 | 无 |
| Mac 影响 | 控制中心出现麦克风模式，其他声音可能被轻微压低 | 无 | 无 |
| 主要风险 | 9-12 那次「挂 playerNode 后 tap 收 0 帧」 | 时钟漂移、对齐、CPU、维护成本 | 产品行为变化，需要用户同意 |
| 可测性 | 注入测不到 VP 本身，要靠物理回环测试 | 可以离线确定性测试 | 中 |

**推荐路线**：先做第 0 步（几小时，马上减少回声）→ (a) 做**时间限定的 spike**（建议 2 天，Mac 和 iPhone 各过一遍）→ spike 过关就实装 (a)，过不了就转 (b)。兜底 3.4 两种情况下都做。`echoMode` 开关一直保留 `mute` 退路，直到真机验收通过。

**spike 过关标准**（任意一条不过就转 (b)）
1. 挂着 ttsPlayer 开 VP，tap 帧数 > 0，持续 10 分钟不掉；
2. 外放朗读时，回声衰减（ERLE）≥ 20 dB（对比诊断录音的 mic 和 tts）；
3. 朗读中插话的识别错误率不比安静时高出 10 个百分点以上；
4. 朗读音量（以手机外放为准）主观可接受，用户试听确认；
5. M2–M5、P-08 在 `aec` 模式下全绿。

---

## 五、验证方法

### 5.1 单元测试（`npm test`，listen-core 纯函数）

- **U1 疑似回声判定真值表**：5 条特征逐一置反，各自放行；全部满足才判为疑似。
- **U2 扣住与裁决**：扣住 → 窗口结束丢弃；期间出现更长后续 / `near` / 按键 → 放行；最长扣住时间有上限。
- **U3 转交复查（L2）**：英文朗读中，中文通道的拉丁乱码转交 → 丢弃（`xfer-echo`）；朗读窗外同样的输入 → 照常转交（R14 不回退）。
- **U4 真实样本**：把 113/114 的 `, you, Hitong Fu Ben Bing song?`、`theafternew.`、`去`、`she.`、`Plea teares afernow` 按当时的时序构造进去 → 全部拦住；真插话样本（`Yes.`、`OK`、`等一下`，高置信或 `near=true`；以及跨语言长句）→ 全部放行。
- **U5 播放窗时间源**：用原生 `tts-start/tts-end` 而不是 JS 的 `speak` 时刻；`tts-end` 丢了时有 15 s 兜底（沿用 `ECHO_PLAY_MAX_MS`）。
- **U6 `echoMode` 退路**：`aec` 启动失败的事件 → 落回 `mute`，会话继续，diag 计数 +1。
- 方案 (b) 额外加：离线金标测试（固定的房间脉冲响应 + 朗读 + 插话 → ERLE ≥ 20 dB，插话文字召回）。

### 5.2 test:mac 新增「回声组 E」

现有 M 组会把输出静音、把输入音量拉到 0（`scripts/test-mac.js` `muteOn` :280）。所以 **E1–E4、E7–E8 用注入**，放在常规跑法里；**E5–E6 是物理回环**，放进单独的 `test:mac:physical`，要显式选择才跑（会开扬声器、调音量，跑完还原）。

| ID | 类型 | 内容 | 判据 |
|---|---|---|---|
| E1 | 注入版回声（跨语言） | App 朗读英文时，向中文通道注入低置信拉丁短句，`t0/t1` 落在播放窗内 | 不新增行；diag 有 `echo-suspect` |
| E2 | 注入版回声（转交路） | 同 E1，但走 R14 转交（LID 判为 en） | 不新增行；diag 有 `xfer-echo` |
| E3 | 注入插话（跨语言长句） | 朗读中注入对方语言的高置信长句 | 15 s 内成行，文字完整 |
| E4 | 注入插话（短句 + 近端） | 朗读中注入短句，带 `near=true` | 成行（允许晚 ≤1.5 s） |
| E5 | 真机外放回声 | 固定音量外放，App 连续读 4 句，没人说话 | 回声行 = 0；ERLE ≥ 20 dB（诊断录音） |
| E6 | 真机外放插话 | App 读英文译文时，用另一台设备（或确认不会被 VP 消掉的 `say`）放一句中文 | 成行，字符错误率 ≤15%；App 的朗读没有被静掉 |
| E7 | VP 失败退路 | 调试开关强制开 VP 失败 | 落回 `mute`，会话继续，有 diag |
| E8 | 字幕模式不受影响 | 实时字幕（系统声音 / 字幕档）开一场 | VP 没开，识别和现在一致 |

### 5.3 现有用例的回归要求

- **M2**（中文 → 泰语译文 → 朗读出声）、**M3**（同语言注入回声被拦）、**M4**（念完后对方回话放行）、**M5**（连杀三句，队列不死）、**P-08**（收音时朗读不冻）：在 `echoMode=mute` 和 `echoMode=aec` **两种模式下都必须绿**，且**连续 3 次**都绿（之前 M2/M3 有抖动记录）。
- **P-12**：1.19.3 基线和 r4 都红（已知问题，依赖 P-02 那一行），要求**不比基线差**；如果顺带变绿，记一笔。
- 全套：`npm test`（目前 2651 条）全过，layout 44/44，test:mac 其余用例与 1.19.3 基线持平（目前在干净名额下基线只红 M8/M9/P-12）。
- 新增的 E 组不计入「和基线比」，单独出一张表。

### 5.4 真机录屏验收检查点（Mac + iPhone，外放，正常音量）

- **K1 四句说话测试，开自动朗读**：回声行 0 条（113 有 3 条）；没有因回声产生的「译文失败」；正常句的出译时间不比 114 慢。
- **K2 朗读中插话**：测试者在 App 读的时候插话，跨语言、同语言各一次 → 两次都成行，文字正确。
- **K3 朗读音质**：音量、音色、无削波；iPhone 外放能听清（和 114 的录音对比听）。
- **K4 耳机 / AirPods / 蓝牙音箱**：都没有回归；蓝牙音箱是延迟最大的情况，单独验一次回声。
- **K5 其他场景不受影响**：播客、学习页朗读的音质不变；实时字幕不变。
- **K6 Mac 控制中心**：听译时出现「麦克风模式」，确认用户能接受；结束会话后消失。
- **K7 长时间**：连续 10 分钟会话，回声不回来，CPU / 电量正常，iPhone 锁屏后台照常。
- **K8 退路**：故意制造 VP 起不来（外接声卡），App 落回静麦模式，会话不断，并有提示或诊断记录。

---

## 六、需要用户定的问题

1. **路线**：同意「第 0 步 → (a) spike 2 天 → 过不了转 (b)」吗？spike 期限定多长？
2. **AEC 模式下撤掉原生静麦，以及「朗读中同语言直接丢」这条规则 (g)**：撤了才能真正保留插话（包括和朗读同语言的插话）；代价是残余回声全靠兜底。是两条都撤，还是先只撤静麦、保留 (g)？
3. **云端 / 自建端点的朗读改成原生播放**（AEC 必须）：用户基本感觉不到区别，但涉及 `grant_speech` 这条付费路。同意吗？
4. **疑似回声的处置**：静默丢掉（只记诊断）、显示一行灰色「可能是回声」可以点开恢复，还是只记诊断不拦（观察期）？
5. **插话时 App 的朗读**：继续读、自动压低音量，还是直接停（方案 c1 那种行为）？
6. **Mac 体验**：听译期间控制中心出现「麦克风模式」、其他 App 的声音可能被轻微压低，能接受吗？
7. **退路开关给不给用户看**：设置里放一个「回声处理：自动 / 朗读时静音麦克风」，还是只做内部开关？
8. **物理回环测试**（E5/E6）要在测试时开扬声器、改音量，跑完还原。授权 dsh 在 `test:mac:physical` 里这么做吗？还是每次由你手动开？
9. **第 0 步要不要先单独出一轮**：堵 L2（转交漏洞），查清 L3（用的是哪个朗读引擎），不等 AEC。
10. **首版范围**：Mac 和 iPhone 一起上，还是先 Mac（测试环境更全）、iPhone 跟一轮？

---

### 附：本提案引用的只读来源

- `~/dsh-plugins/release1194/wt4/.local/accept4/rootcause.md` 第 3 条（dsh 根因原文）
- `.local/qa/accept-report-113.md`、`.local/qa/timetable-113.md`、`.local/accept4/report.md`
- `docs/learning-design.md` §9.6 回声段（2026-09-12 VP spike 读数、09-13 静麦裁定）、§9.6.1.2 (f)(g)
- 代码行号均以提交 `371c4bf4` 为准
