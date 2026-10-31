# Confucius4-R2T2

**来源**：https://github.com/netease-youdao/Confucius4-R2T2 —— 上游网易有道 AI 团队；权重在 HF / ModelScope（`netease-youdao/Confucius4-R2T2`，另有 `-GGUF` 仓）；在线 demo `r2t2.youdao.com`（727 stars / 64 forks，2026-09-30 记入）
**任务**：ASR · **真流式** · 中 / 英优化（另有多语言，见下）
**许可**：**双许可** —— 仓库代码 **Apache-2.0**；**权重走《网易模型使用许可协议》（`MODEL_LICENSE` / `MODEL_LICENSE_zh`，自定义、非 OSI）**。**权重条款采用前要逐条读**；若要随包分发或由我们托管，先过法务
**形态**：基于 **Qwen3-ASR**。**参数量 / 权重体积 README 未标**（记入时未核实 —— 记这一条是为了下次有人问时知道去 HF 卡上量）。核心是**真流式 + 稳定前缀**：只提交「最长稳定前缀」，**已输出的字永不回改**（append-only）；解码 chunk **80 ms – 2 s** 可配（代表性 160 ms），平均延迟 **200–600 ms**；**离线精度不因加流式而下降**（官方说法）；原生支持 **context / 热词提示**。后端三条：vLLM、transformers、**llama.cpp（GGUF 量化变体，仓库内自带预编译 CUDA 件）**。仓库自带可跑的 **WebSocket 服务**（`/asr_stream_api_v1`，返回增量 `text` + `reset`）与参考客户端；WS 服务需要一个 VAD 模型（默认接 FireRedVAD 的 `Stream-VAD`）
**跑在哪**：**自托管**。GPU 走 vLLM（官方给 docker，直接跑在 Qwen3-ASR 官方镜像上）；**GGUF 那条路意味着用户自己的 Mac 也可能跑得动**（llama.cpp / Metal）—— 这正是我们该验的一件事：「不依赖我们的服务端」能不能从口号变成用户的现实
**服务的面**：整段轉寫 · 對話（转场）· 即时字幕（**受 §2.4/§7 限制，见治理**）
**实测**：**我们没测过。** 官方表（160 ms，WER / CER %，越低越好）：EN —— LS-clean **2.13** / LS-other 4.88 / AMI 11.37 / Giga-clean 9.60 / VoxPopuli 3.07 / TED-LIUM 3.34 / SPGI 3.00；CN —— Wenet-net **5.87** / Wenet-meeting 7.27 / SPEECHIO-06 7.30 / CN-RealSI 3.48；同表对手含 Qwen3-ASR、WhisperRT、Nemotron、Voxtral、AssemblyAI 与两套商用系统。**未经我们复核**（他们也自认欢迎被质疑）。
**结论**：**`watch`**（2026-09-30）—— 它两个特点都戳我们：① **append-only**（字幕不回改，与 [T3PO](confucius4-t3po.md) 同一个卖点，但那是翻译、这是识别）；② **GGUF / llama.cpp**（可能跑在用户自己机器上）。但**它真正的主战场（实时转写）今天被 `domain-design §2.4 / §7` 挡着**（实时固定走设备内置识别器），所以**现在不值当动产品代码**，标 `watch` 而不是 `spike`。**触发条件（满足任一再上来）**：T3PO 的 spike 通过；或我们决定给「整段轉寫」加一个自托管引擎。届时把它与 [Audio8 ASR Infinite](audio8-asr-infinite.md) **并排实测**（同一批中英素材，比 CER、延迟、以及**回改次数**）—— 那一次的结论写回本条。**安全注**：它自带的 WS 服务里 `secret_key` 是**硬编码的开发占位符**（T3PO 的 README 明确警告 `test0102`），自托管到局域网或公网之前**必须自己改掉**。
**治理**：与 [Audio8](audio8-asr-infinite.md) 同一条路：① **整段轉寫**这条缝原则上能进（`build/stt.config.js` 只问请求格式），但它的 WS 协议 + 增量语义**是一种新格式** ⇒ 协议决定，先过评审；② 想用在**实时**上，先要动 `domain-design §2.4 / §7` 那条裁定（**人审**），并过 `AGENTS.md` 规则 4 / 8 / 11（规则 11 的本地等价物即设备内置识别器，**已满足**）；③ 权重是**自定义许可** —— 随包分发或我们托管前先过法务。
