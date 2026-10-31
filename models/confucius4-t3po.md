# Confucius4-T3PO

**来源**：https://github.com/netease-youdao/Confucius4-T3PO —— 上游网易有道 AI 团队；权重在 HF / ModelScope（`netease-youdao/Confucius4-T3PO`，另有 `-GGUF` 仓）；在线 demo `t3po.youdao.com`（112 stars / 8 forks，2026-09-30 记入）
**任务**：**同传**（simulTaneous translation）· **文本 → 文本** · 流式 · 中 ↔ 英
**许可**：仓库 `LICENSE` = **Apache-2.0（只覆盖代码）**；**权重许可记入时未核实** —— 这个仓库里**没有**像 R2T2 那样的 `MODEL_LICENSE` 文件。**采用前必须先确认权重条款**（这条不是形式：R2T2 的权重就是自定义许可）
**形态**：**14B** 文本同传模型，Qwen 底座，训练后仍保留通用指令跟随 ⇒ 可以在它上面再叠术语约束一类能力。机制：细粒度 chunk 流入（字符 / 词级），模型自己对每一段决定 **READ（再等等）/ WRITE（先出译文）**；**译文 append-only、已提交的永不改写**；交错历史协议（interleaved history）复用 KV cache 省重复计算。提供 `--latency-mode low / native / high` 三档质量–延迟操作点。**不支持语音输入** —— 要语音得串一个流式 ASR，官方就是串自家的 R2T2 组成 S2T
**跑在哪**：**自托管**（14B，需 GPU）。官方路径 `vllm serve`，对外是 **OpenAI 兼容的 `/v1/`**；也有 GGUF 仓。自带一个本地 Web UI（FastAPI + WebSocket，可接麦克风 / 浏览器标签 / 音频文件）
**服务的面**：网页双语翻译（长文）· 即时字幕 · 對話 · 文档翻译
**实测**：**我们没测过。** 官方评测：与开源 InfiniSST、EAST 及两套商用同传系统比 zh→en / en→zh 的 COMET–word-CW（只给图，未给数字表）；训练侧称其 Pareto 感知 RL 优于标准 GRPO，且避免「极低延迟区间质量崩塌」。**未经我们复核。**
**结论**：**`spike`**（2026-09-30）—— 三条里**离我们的用户痛点最近**的一条：我们今天的译文会**回头改写**（「边译边改」），视觉上是读者最刺眼的那类抖动；而它从设计上就是 **append-only**，正好治这件事，`low / native / high` 也正对上我们「快但会改 / 稳但慢」的取舍。建议的 spike 判据（**三条全过才继续**）：① **能不能被我们的传输收下** —— 它要 direction 与流式 READ/WRITE 协议，若落不进一个「按请求格式分族」的传输（`docs/domain-design.md` §7），**质量再好也不采用**（那条铁律不因为一个模型改）；② **append-only 在我们真实的字幕节奏下是否真的不回头** —— 喂一段我们自己存的 YouTube 双语字幕素材，数它改写了几次；③ 14B 在**我们能承受的硬件上**（用户自带 / 我们的服务端）延迟够不够用。三条里任一条不过，结论改成 `parked` 并写清卡在哪一条。
**治理**：同传是**翻译**能力 ⇒ 归 `build/providers.config.js` 那一族。**新增一种请求格式 = 领域设计变更**（`docs/domain-design.md` §7，**人审**）。若日后放到**我们的服务端**，还要过 `AGENTS.md` 规则 4（服务端算力只能作付费可选，且须单独披露）/ 规则 8（成本封顶）/ 规则 11（本地等价物：自带 key 的翻译早就出货 ⇒ **已满足**）。它要取代的对手是**我们自己已出货的 chat-compat 翻译**（零依赖、免费路径完整）—— 所以「值不值得引入」只能用**实测的抖动与延迟差**说话，不能用厂商的 COMET 图说话。

**姊妹条**：ASR 那一半见 [Confucius4-R2T2](confucius4-r2t2.md)；另一条流式 ASR 候选见 [Audio8 ASR Infinite](audio8-asr-infinite.md)。
