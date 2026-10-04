# Microsoft MAI-Voice-2.1

**来源**：https://openrouter.ai/microsoft/mai-voice-2.1 —— 微软 AI（Microsoft AI）的语音合成模型，经 **OpenRouter** 的 `/api/v1/audio/speech` 提供（2026-10-02 记入，用户提）
**任务**：**TTS · 朗读**（文本 → 语音）· 多语种（**含中文**）
**许可**：**专有**（微软），**不可自托管、无开放权重** —— 只能经 OpenRouter（或微软自家端点）调用
**形态**：OpenRouter 的 **speech-compat** 形状 —— `POST /api/v1/audio/speech`，字段 `model` / `input` / `voice` / `response_format`（`mp3` | `pcm`，默认 pcm），返回**原始音频字节**（不是 JSON）。音色是**服务端列出的**、带语种前缀：`zh-CN-Bo` / `zh-CN-Lan` / `zh-CN-Mei` / `zh-CN-Wei` / `zh-CN-Grant` / `zh-CN-Harper`，以及 `en-US-*` / `en-GB-*` / `ja`? 等（本仓 `openrouter_speech` 是同族端点，见 `build/tts.config.js`）
**跑在哪**：**OpenRouter 托管**（第三方；用户自带 key ⇒ 浏览器 → OpenRouter 直连，**不依赖我们的服务端**）
**服务的面**：对话 · 实时听译（朗读译文）· 播客模式（朗读）· 复习朗读
**实测**：**我们没测过。** OpenRouter 页面标价 **$22 / 百万字符**（未经我们复核）。
**结论**：**`candidate`**（2026-10-02）—— 记进来的**唯一硬理由**：它补上 `openrouter_speech` 明确空着的那一格 —— **中文音色**。`build/tts.config.js:117-119` 写着该引擎「**没有中文音色** —— 读中文的人要用 openrouter_audio 或设备内置语音」，而这是一条 speech-compat、不需要新传输的候选。要动之前先实测中文朗读的质量与延迟（`/perf-tune`）；没过就留 `candidate`。
**治理**：TTS ⇒ 归 `build/tts.config.js` 的 **speech-compat** 那一族（`openrouter_speech` 已是同族端点、同格式，**不需要新传输**，因此**不是** `docs/domain-design.md` §7 意义上的领域设计变更）。**晋升** = 给那条引擎加一个可选 model：`build/model-params.config.js` 一行 + `build/perf-ledger.config.js` 一行（`npm test` 会拦：新引擎/模型必须有实测台账，见 `AGENTS.md`「Adding a provider means measuring it」），跑 **`/perf-tune`**。注意 `openrouter_speech` 的 `voices` 现在是 deepgram 的 90 个固定音色，换 model 要连音色表一起处理。规则 2（不依赖我们的服务端）：第三方托管 + 用户自带 key ⇒ ✓。

**姊妹条**：（暂无）
