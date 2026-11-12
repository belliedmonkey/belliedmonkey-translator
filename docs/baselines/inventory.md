# 清点：形态 × 阶段 × 契约

机器可读的同一份清点是 [`eval/baselines/inventory.json`](../../eval/baselines/inventory.json)。本页是给人读的索引。每一格的状态和证据摘录以 JSON 为准，`node eval/baselines/check.js` 会核对摘录还在源文件里。

读数日期写在 JSON 的 `readOn`。产品版本写在 `sourceVersion`。本页所有质量、延迟、成本都是 **待测**。

状态词：

| 词 | 含义 |
|---|---|
| `wired` | 从用户入口到该阶段的调用能在源码里指出来 |
| `adjacent` | 源码里有这条路径，但它是另一种业务，不能顶替上一行 |
| `applies` | 该形态的调用链上有这个阶段 |
| `route-dependent` | 有，但是否走上取决于模式、flavor、端或设置 |
| `opt-in` | 有，且默认不跑，要用户打开或点按 |
| `not-applicable` | 这条形态不用这个阶段，证据写在格子里 |
| `pending` | 本批不能证实也不能证伪 |

## 阶段

| id | 在链路里是什么 | 输入 → 输出（源码契约，未测质量） |
|---|---|---|
| `vad` | 这段是不是人声 | PCM → 是否送进 LID，或 E1 臂自己的切段锁 |
| `lid` | 这句话属于哪一门语言 | 话音 → 语言码；`lidRewriteFix` 只改这个判定 |
| `asr` | 听写 | 音频 → 文本 final / partial |
| `segmentation` | 断句或切段 | 文本或 DOM/字幕 cue → 句或段落单元 |
| `sentence-correction` | 整句矫正 | 见下节。没有同名模块 |
| `translation` | 翻译 | 文本 → 译文。页译/字幕/文档用 `buildSystemPrompt`；听译用下面两条提示之一 |
| `tts` | 朗读 | 译文 → 本机语音。只在对话听译默认打开 |
| `ocr` | 识图 | 图 → 原文文本，不翻译。提示是 `OCR_SYSTEM` |
| `extract` | 取出待译内容 | DOM、字幕稿、文件字节或系统选中文字 |
| `render` | 用户看见的结果 | 兄弟节点、叠层、听译行、文档页、弹层 |

### 整句矫正

源码里没有叫「整句矫正」的模块。和它有关的是三件不同的事：

1. **转写文本的修正。** `app/listen-core.js` 的 `buildListenPrompt` 要求只改同音、错切和数字，再翻译。输出两行 `T:` / `X:`。`LISTEN_PASS` 为 `one`，表示一次往返。`acceptCorrection` 用长度比 0.7–1.3 决定是否收下修正稿。对话的旧路和实时字幕的定稿行走 `passRow`。
2. **模型断句里的顺带修正。** `buildSegPrompt` 第 4 条允许按上下文改明显识别错。这条只在对话、且 `segRouteFor` 判为 `model` 时替代 `passRow`。输出是 `{"segments":[{"source","translation"}],"remainder"}`。
3. **不是整句矫正的东西。** 回声闸、低置信句首闸、句首补回、`lidRewriteFix`（语种判定的轻量修正）。它们改变进不进账本或判给哪一门，不产出「纠正后的整句」。

网页文字、预制字幕、文档翻译都不经过 1 或 2。

## 听译和实时字幕怎么分

两条都从 App 首页进 `listenModel.open`。参数是 `'subtitle'` 才是实时字幕，否则是对话。会话开始时钉 `mode`。

对话在通用对话形状的引擎上可以走模型断句。字幕模式 `segRouteMode` 直接 `legacy`，注释写明字幕有自己的行协议。字幕的采集在系统声可用时用 system，否则用 mic。

intl Mac、中国版以外、`zhAsrE1 !== false` 时，中文听写臂是 `e1_b1`（SenseVoice 清单随 `stt-start` 下发，VAD 锁 `sil0.5_thr0.3_max8`）。其余是 `sa`（SpeechAnalyzer）。这是路由事实，不是质量结论。

## 模型与提示词钉在哪

不要把本页抄成第二份注册表。运行时读生成的 `providers.gen.js`。本清点只钉下面这些字符串还在源文件里：

| 钉 | 文件 | 意思 |
|---|---|---|
| `qwen` 的 `defaultModel: 'qwen-plus'` | `build/providers.config.js` | 自带 key 选这个条目且不改模型时的默认 |
| `chat: 'qwen3.7-plus'` | `build/grant-models.config.js` | 免费额度对话档 |
| `stt` / `tts` 同文件 | 同上 | 额度转写档与朗读档 |
| `qwen_asr` 的 `qwen-audio-3.0-asr-flash` | `build/stt.config.js` | 中国版注册的整段转写条目，不是听译默认臂 |
| 四条提示 | `P_CORRECT` `P_SEG_PROMPT` `P_PAGE` `P_OCR` | 修正+翻译、断句+翻译、页译、识图 |

听译实际发出的模型是当场 `cfg.tr.model`。空字符串表示走该 provider 的默认。2026-10 水位里的 “qwen plus” 不能代替这个规则。

## 矩阵

完整 12 形态 × 10 阶段在 JSON 的 `cells`。形态 id：

`realtime-listen` · `realtime-subtitles` · `webpage-text` · `webpage-youtube` · `webpage-x-video` · `webpage-podcast-timed` · `webpage-ai-transcript` · `document` · `adjacent-mac-offline-file` · `adjacent-quick` · `adjacent-system-translate` · `adjacent-agent-host`

阶段 id：

`vad` · `lid` · `asr` · `segmentation` · `sentence-correction` · `translation` · `tts` · `ocr` · `extract` · `render`

读某一格时同时看 `note`。`not-applicable` 也有证据，避免以后把「没写」当成「没查」。

## 平台与语言

本批没有把矩阵填成「已覆盖的语言 × 平台」分数表。源码能确定的只有路由差异，例如中国版不走 intl Mac 的 `e1_b1`，泰语 Grok 开关默认关，系统翻译弹层是 iOS 扩展点。某语言在某端的识别质量 **待测**。

## 场景

口音、噪声、专名、数字、纠正过度、语义保真：没有授权样本，所以覆盖格全部留空。计划见 [samples.md](samples.md)。
