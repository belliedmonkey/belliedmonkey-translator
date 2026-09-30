# Audio8 ASR Infinite

**来源**：https://huggingface.co/Edge0/Audio8-ASR-Infinite —— 上游 Edge0（GitHub `Edge0-AI/Audio8-ASR-Infinite`）。HF 上 1.59k likes、月下载 26,749（2026-09-30 记入时）
**任务**：ASR · **流式**（中 / 英双语）
**许可**：**Apache-2.0** —— 可自托管、可分发；我们不会把权重打进任何包里（8.17 GB），所以「随包分发」这一问对它不适用
**形态**：4B 参数（bf16，`model.safetensors` **8.17 GB**）+ `semantic_vad_heads.safetensors`。架构：因果音频塔继承 Voxtral Realtime 4B，解码器是 Qwen2.5-3B-Instruct。**原生流式**（不是分块伪流式）：音频时钟 80 / 120 / 160 ms 可选，`target_delay_ms` 240–560 可调；rolling KV（30 s 窗口 + RoPE 重基）⇒ 24/7 连续转写，内存与延迟**恒定不漂移**。发布状态是 **preview**，正式版才承诺帧级语义感知
**跑在哪**：**自托管**（用户自带 GPU）。官方路径是**改过的 vLLM**（docker compose，realtime WS `:18191/v1/realtime`）或 torch 模拟流式解码；**HF 上没有 hosted provider** ⇒ 没有「拿来即用」的云 API，也没有 OpenAI 式 `/audio/transcriptions` 接口
**服务的面**：對話（**转场判断**）· 即时字幕 · 整段轉寫（离线批处理）
**实测**：**我们没测过。** 厂商声称（480 ms 延迟 / 80 ms 帧，贪心解码、抑制 EOS，错误率 %）：aishell1 CER **1.750** · aishell4 CER **2.893** · librispeech clean WER 3.042 / other 6.808 —— 平均 **3.623**（同一张表里 Voxtral-Mini-4B-Realtime 10.253、nemotron-3.5-asr-streaming-0.6b 9.524）。**这张表未经我们复核**，记在这里只作为「值不值得 spike」的线索
**结论**：**`spike`**（2026-09-30）—— 最值钱的不是 CER，是它的 **semantic VAD**（8 类，0.5 / 1 / 2 / 3 s 视野）：区分「思考停顿 / 口吃 / **真的说完了**」，而这正是**對話模式**里声学 VAD 判不好的那一步。建议的 spike（判据写在前面）：在 NAS 上按官方 docker 把它跑起来，喂**我们自己的中英素材**各一段（对话 / 视频音频 / 整段录音），量三件事 —— ① 端到端延迟（经我们的网络）② CER 能不能复现厂商那张表 ③ VAD 触点与我们现在的转场是否对得上。**spike 出数之前不碰任何产品代码。**
**治理**：`docs/domain-design.md` **§2.4 / §7**（2026-09-17）裁定**实时转写固定走设备内置识别器**，`build/stt.config.js` 的门禁**断言不许出现 `live*` 字段**且该注册表只回答「整段录音去哪」。因此：① **整段轉寫**这条缝**原则上**能进（注册表只问请求格式），但它不提供 OpenAI 式转写接口 —— 要么走它自己的 realtime WS，要么我们在那一侧**新增一种格式**，那本身就是一次协议决定，得先过评审；② 想把它用在**实时**上，先要动上面那条领域裁定（**人审**），并过 `AGENTS.md` 规则 4（服务端算力只能作付费可选，且须单独披露）/ 规则 8（成本要封顶）/ 规则 11（**已满足** —— 本地等价物即设备内置识别器，早就出货）。
