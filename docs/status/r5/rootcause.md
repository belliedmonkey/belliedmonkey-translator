# 1.19.4 第 5 轮（fix/1194-r5，基线 371c4bf4）根因与修法

模型：DeepSeek V4.1 Flash（deepseek-flash）。
本文把 A（识别语言名额 / 改稿 H）、B（回声第 0 步）、C（小纠错）每一项的根因、调用链与修法写清。
行号以基线 `371c4bf4` 为准；改后的实际位置在括号里给出。

## 先写测试、确认失败

- 新测试文件 `test/listen-r5.test.js`（14 条）在实现**之前**写好。
- 「确认它在基线上会失败」这一步原计划用 `git stash <文件>`（暂存实现、只留测试）做对照，
  命令被 supervisor 的 git 传输类拦截规则**拦下**（guard 拦截即停，未换写法重试）；
  随后的 progress-sync 记录命令也被拦。因此这一次对照**未执行**，已按铁律停下并上报。
  新测试在实现落地后 14/14 全绿。

---

## A. 识别语言名额（改稿 H）

### 根因

Apple 对每个 App 的转写 locale 有硬上限（`SFSpeechErrorDomain Code=11 "Too many allocated
locales, N maximum."`）。状态查询（探针）与安装请求会在系统里**占用**一个 locale 名额，而
`MTDeviceTranscriber.held` / `releaseUnused` 只覆盖「开会话」那一半：

- 基线：`held` 只在 `makeModule` 里 `noteHeld`（`app/native/speech-bridge.swift` 旧 :466），
  `releaseUnused` 只在 `start()` 里按当前会话 locale 释放（旧 :421）；`sttProbe`（旧 :223）
  与 `sttAssets`（旧 :265）经 `mtTranscriberFor` / `assetInstallationRequest` 碰过的 locale
  **从不登记、也从不释放** ⇒ 装到第 6 门左右 `prepareToAnalyze` 抛 Code=11。
- `mtPrepareCode`（旧 :1258）已把 Code=11 映射成协议码 `'locales'`，但界面把它拼进
  「离线模型下载失败：…多半是网络问题」（误报），没有独立的「名额已满」一类。
- 关键实测约束（`final-r4.md`）：`AssetInventory.release(reservedLocale:)` 会把该 locale 的资产
  从 `.installed` 打回 `.supported` —— **成功路径一律不能释放**，否则「刚装好就要用」会变成未就绪。

### 修法（改稿 H 的产品模型：上限 N 门「占名额」，让出即变「未就绪·可补回」）

原生（`app/native/speech-bridge.swift`）：

1. **登记探针/安装占用的名额**：`sttProbe` / `sttAssets` 在 `mtTranscriberFor` 之后调新增的
   `MTDeviceTranscriber.noteReserved`（:455），与会话占用 (`held`) **分表**存放，互不误伤。
2. **上限读系统**：新增 `mtQuotaSnapshot()`（:118）读 `AssetInventory.maximumReservedLocales` /
   `.reservedLocales`；每条 `stt-state` 经 `withQuota()`（:217）带上 `maxReserved` / `reserved`。
3. **显式让出**：新增 `stt-release` 消息 → `sttRelease()`（:226）→ `releaseExplicit()`（:460），
   **只在用户确认让出时**调 `AssetInventory.release(reservedLocale:)`，并回一条 `stt-quota`。
4. `releaseUnused` 只释放会话表，不再顺手动探针/安装表（成功路径不释放）。

JS 桥（`app/native-speech.js`）：新增 `quota()`（:237）与 `releaseSlots()`（:241），
`PROTOCOL` 加 `stt-release` / `stt-quota`（与 .swift 的 case 逐字对表，`test/build-scripts.test.js` 钉着）。

本机记忆（新文件 `src/app/asr-quota.js`）：持久化 `listenAsrInstalled`（装过的短码）与
`listenAsrLastUsed`（每门最后一次听译时间）。系统只报「此刻占名额的」，无法区分「装过但让出」
和「没装过」；这份记忆正是改稿 H 三态里的第二态依据。

纯逻辑（`app/listen-core.js`）：`quotaRows`（:2307）、`quotaStateOf`、`canYield`、`pickYield`
（:2328，当前语言对不可让出、默认最久没用）、`quotaSelectPlan`（:2341，首启超额标「第 N 门」）。

UI（改稿 H）：

- 首启包屏与设置「语言包」屏共用 `#firstrun-packs`：新增「识别语言 · 已用 N / 上限」卡片（进度条
  分段）、三态图例、每行状态点 + 标签（占名额 / 未就绪 / 未下载）。（`src/app/shell-model.js`
  `paintQuota` :640、`makeRow` 支持 tag/action/dot、`paintPackBody` 管理态显示「补回 / 下载」。）
- 满员让出确认框：`openYieldSheet`（:672）默认选最久没用，当前语言对置灰不可选；确认后
  `yieldAndRestore`（:768）→ `releaseSlots` → `ensureOne`（:749）补回。首启勾到第 6 门标记
  「未就绪 · 第 6 门」不参与下载。
- 听译页：`setQuotaFull`（`src/app/listen-model.js` :866）→ 胶囊「名额已满」+ 卡片
  「还不能听 X：识别语言已占满 N 门」+「让出一门并补回」+ 底部确认框；`quotaYieldAndRestore`（:912）。
  已就绪一侧的说话键不动（A9：只把「需要的那门」标未就绪）。
- A8：「名额已满」是独立一类。`warmBody`（:960）与 `ensurePacksForPair` 在名额满时**不发起下载**，
  `halt`（:2119）遇到协议码 `locales` 时改挂这张卡片；胶囊、卡片、按钮与「下载失败/网络问题」文案不混。
- C2 的设置页本名 + 补上 ไทย：`src/app/settings-view.jsx` `paintListenPack`（:272）改为列出
  全部占名额语言的本名（`endonymOf` :264），不再画 `zh-CN` 这类码。

---

## B. 回声第 0 步（只做 0-b 与只读查证，不改音频）

### B1 根因：R14 候补转交绕过了回声闸（L2，提案 §2.2）

- 唯一入口 `intakeDecide`（`app/listen-core.js` 旧 :1070）顺序是 ①朗读中同语言硬闸
  `playing.has(base)` ②LID 归属 ③文字回声 `isEcho`。
- 中文路把 App 朗读的英文收成纯拉丁短句（113/114 真样本 `she.`、`theafternew.`）时：
  归属闸在②把它拒掉，并标成 `xfer` 候补（`isXferCandidate` 旧 :1388）；等一次空闲后
  `onXfer`（`src/app/listen-model.js` 旧 :1254）直接 `seg.feed` 进英文通道 —— **不再查
  `playingLangs('en')`、也不再查 `isEcho`**。于是本该被回声闸丢掉的那句成了多余的行。

### B1 修法

`makeTransferGate`（`app/listen-core.js:1402`，在 `fire()` 内）在真正转交前，按**目标语言**
再同一遍回声闸：`playing()` 里含目标语言 ⇒ 记 `intake:xfer-echo`、丢；`isEcho(text)` 命中 ⇒
同丢。`src/app/listen-model.js` 的 `xfer` 注入 `targetLang: () => 'en'`、
`playing: () => echo.playingLangs(...)`、`isEcho: (s) => echo.isEcho(...)`（该站约 :1380）。
不在朗读窗内时 R14 行为不变（朗读结束后对方真人回话照收）。

新增测试用 113/114 真样本 `she.`、`theafternew.` 断言被拦；反例断言朗读结束后 `Yes please.`
照常转交、另一门语言的真人话不被误杀（`test/listen-r5.test.js`）。

### B2 只读查证：「开着静麦，回声为什么还能进识别器」

**代码调用链**（只读）：

- `autoSpeak` → `speakPump` → `speakOut` → `LearnTTS.speak`（`src/app/listen-model.js`）。
- 只有**两条**原生朗读路会置静麦 `MTAudioBridge.shared.muteInput = true`：
  `MTDeviceSpeech.speak`（Piper/Kokoro，`app/native/speech-bridge.swift` 旧 :820）与
  `MTSystemSpeech.speak`（`AVSpeechSynthesizer.write`，旧 :959）。
- **不置静麦**的路有三条：`speakBytes`（云端 / 自建 / 免费额度 `grant_speech`，WebKit
  `new Audio()`，`extension/learn/tts.js:699-739`）、`speakBrowser` 的 WebKit `speechSynthesis`
  退路（原生没有该语言声音时，`:631-695`）。这些音频由 WebKit 自己的进程播放，
  `app/native/audio-bridge.swift` 的 `micDeliver`（:279）根本不知道它在放，静麦不会置位。
- 另 `MTSpeechChunkBox.finish`（`speech-bridge.swift:1057`）从「首块入队」起算
  `总样本数/采样率`，**没有计输出设备延迟**，`.dataPlayedBack` 回调失灵时定时器可能早于真实播完
  释放静麦（H2 的成分）。

**结论**：H1 是主因 —— 这几场用的是 **WebKit 播放**的朗读（国际版登录送的 `grant_speech`
或自建端点走 `speakBytes`；原生无该语言声音时走 WebKit `speechSynthesis`），这条路**不触发
`muteInput`**，朗读声照原样进识别器；H2（静麦放开过早 / 未计输出延迟）是次要成分。证据为代码
调用链（上述三处不置静麦的播放路 vs 两处置静麦的原生路）。113/114 的验收日志没有记
`speak.engine` 字段，无法从旧事件里直接读回是哪一个引擎；本轮不改音频代码，结论到此为止
（真根修见 `echo-aec-proposal.md`）。

---

## C. 小纠错（文案 / 显示，布局不变）

- **C1「English已就绪」补空格**：`fillPrepDetail`（`src/app/listen-model.js:765`）原来只在
  `{what}` 与后一个汉字之间补空格，`{ready}` 与「已就绪」之间没补。现在整段填空按同一判据
  （值末字符与模板紧邻字符分属拉丁/汉字就补）。纯逻辑搬到 `ListenCore.fillPrepDetail`
  （`app/listen-core.js:2277`）以便单测。
- **C2 设置页语言本名 + 补 ไทย**：`paintListenPack`（`src/app/settings-view.jsx:272`）原来
  只画当前这一对的 `locales.join(' · ')`（`zh-CN · en-US`），既是指令码又漏了已就绪的 ไทย。
  改为列出**全部占名额语言**（`NativeSpeech.quota().reserved`，退路才用当前对）并写本名。
- **C3 完成页别夸泰语朗读**：`paintPackChrome` 的 done 分支（`src/app/shell-model.js:908`）
  原来把所选语言一律写成「可以听译和朗读了」。现在把「能朗读」限定为**真的下过朗读包**的语言
  （中英共用包 + 勾了且已就绪的泰语包），否则改说「…可以听译了；…可以朗读」。

---

## 与改稿 H 的偏离（如有）

实现按改稿 H 的文案与三态/名额条/确认框/听译页卡片落地；若验收发现某处布局或交互与稿子不一致，
按任务规则停在该项并写清，其余照做，最后不打包。偏离点记录见 `.local/accept5/report.md`。
