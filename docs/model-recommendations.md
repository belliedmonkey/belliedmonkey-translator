# 模型推荐与实测台账

> **这份文件是生成的，不要手改。**
> 来源：`build/recommend.config.js`（建议）+ `build/perf-ledger.config.js`（证据）。
> 改内容请改那两份，然后跑 `node scripts/gen-model-recommendations.js`。

三张表的分工：**台账**记打过什么（永不过期，带日期）·**参数表**记该发哪些字段
（随厂商改协议而变）·**推荐单**记同一件事该选哪个（随新模型出现变得最快）。

## 轴

- **fast** —— 速度优先 —— 按实测墙钟时间选（同一段 870 字正文，每项两遍）
- **cheap** —— 便宜优先 —— 按实测单次成本选
- **default** —— 默认 —— 注册表里出货的那个，兼顾速度、稳定与「不用配就能用」
- **quality** —— 效果优先 —— **未做质量评测**，依据是厂商定位/模型规模，不是我们的测量

## 推荐

### OpenRouter（国际版，一个 key）

**翻译 / 句子解析**

| 轴 | 模型 | 依据 | 为什么 |
|---|---|---|---|
| default | `google/gemini-3.7-flash` | default | 注册表的 defaultModel。选它而不是更便宜的 flash-lite，是因为 model-params 里有为它准备的降档行（openrouter-thinking）—— 换一个没有对应行的模型，用户会安静地拿到最慢那一档。实测降档后 2.9–3.3 秒 / 思考 0。 |
| cheap | `google/gemini-3.1-flash-lite` | cost | 能力探针实测单次 $0.0000065、573ms —— 目录里最便宜的可用文本模型之一。**注意它不在 openrouter-thinking 行的前缀里**，所以不发降档参数；探针那次没观察到它思考，但没做过长正文的参数实测。 |
| quality | `openai/gpt-5-mini` | judgment | **这是判断不是测量** —— 我们没有质量评测。依据是它在台账里有完整的参数实测（reasoning:{effort:low}，基线 9146ms/704tok → 4255ms/192tok），且属于厂商的推理系列。想要更强就换更大的型号，代价是更慢更贵。 |

**转写（「说」题）**

| 轴 | 模型 | 依据 | 为什么 |
|---|---|---|---|
| default | `openai/gpt-4o-mini-transcribe` | default | 注册表的 defaultModel。实测（系统语音念「The quick brown fox…」）逐字转对，600–730ms、单次 $0.000035。 |
| cheap | `openai/whisper-large-v3` | cost | 单次 $0.0000064，比默认便宜 5 倍。**代价看得见**：同一段音频它把 The 听成了 a（返回 " a quick brown."），而默认那个逐字转对。转写要喂给「说」这一档评分，错一个词就是错一分 —— 便宜在这里不一定划算。 |

**朗读**

| 轴 | 模型 | 依据 | 为什么 |
|---|---|---|---|
| default | `deepgram/aura-2` | default | 注册表的 defaultModel，走已有的 speech-compat 形状。真宿主实测 1.8–2.6 秒、浏览器解码出 2.5–2.7 秒音频。90 个音色带语种后缀（en/es/nl/it/de/ja/fr）。**没有中文音色** —— 读中文要用下面那条或设备内置语音。 |
| quality | `openai/gpt-audio-mini` | judgment | **判断不是测量**。它是「带音频输出的对话模型」而不是专用 TTS：能念任何语言（含中文，aura-2 做不到），但也可能不照着念 —— 传输层为此加了 transcript 核对。真宿主实测 1.4 秒 / 290KB / 解码 6.05 秒。 |

### 千问AI平台 / DashScope（中国版，一个 key）

**翻译 / 句子解析**

| 轴 | 模型 | 依据 | 为什么 |
|---|---|---|---|
| default | `qwen-plus` | default | 注册表的 defaultModel。能力探针实测 368ms / 33 出参 tok，本来就不思考。 |
| fast | `qwen-mt-turbo` | latency | 实测 268ms / 37 tok，这批里最快。翻译专用模型：它**不收 system 消息**（用普通对话形状打过去会被拒「Role must be in [user, assistant]」），所以只有走 wire-format 的模型级形状覆写才用得上 —— 那条覆写就是为它存在的。 |
| quality | `qwen3.8-max` | judgment | **判断不是测量**。依据是厂商把它定位为旗舰。实测 1.9–2.0 秒 / 131 tok（短句），长正文没单独测参数 —— 但它落在 dashscope 通行行里，会收到 enable_thinking:false。 |

**转写（「说」题）**

| 轴 | 模型 | 依据 | 为什么 |
|---|---|---|---|
| default | `qwen-audio-3.0-asr-flash` | default | 注册表的 defaultModel，也是这个平台上唯一实测通的转写模型。真宿主实测 351–488ms，wav 与 m4a（iOS Safari 实际产出的容器）都逐字转对。 |

**朗读**

| 轴 | 模型 | 依据 | 为什么 |
|---|---|---|---|
| default | `qwen-tts` | default | 注册表的 defaultModel。真宿主实测 2.0 秒 / 149KB / 浏览器解码 3.1 秒。**不要换成厂商主推的 qwen-audio-3.0-tts-flash** —— 那个是 WebSocket 专属，在这个 HTTP 端点上答「url error」。 |

## 我们**没有**测过的

- **翻译质量。** 没有评测集、没有人工打分、没有 A/B。所以 `quality` 轴上每一条的
  依据都是 `judgment`（厂商定位 / 模型规模），不是我们的测量。要把它变成可测的，
  需要一个固定的评测集（同一批段落 × 多语言）加一个可复现的判分方式。
- **转写准确率。** 只用一句「The quick brown fox jumps over the lazy dog.」比对过，
  那能抓住「引擎在瞎猜」，抓不住「口音下掉词率」这类差异。
- **朗读音质。** 只验到「浏览器能解码出声音、时长合理」。

## 实测台账（全部）

共 67 行。结局的含义见 `build/perf-ledger.config.js` 的文件头。

### `api.openai.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `gpt-5-mini` | 2026-08-20 | ✅ 采纳 | 基线 27786ms · 思考 2000tok · 降档后 5580ms | `{"reasoning_effort":"minimal"}` | 不发时预算被思考吃光：finish=length、正文 0 字，用户看到「翻译失败」且重试永远同样失败 |
| `gpt-5-nano` | 2026-08-20 | ✅ 采纳 | 基线 2147ms · 降档后 794ms | `{"reasoning_effort":"minimal"}` | 与 gpt-5-mini 同族，同一行覆盖；短输入上也快 2.7 倍 |
| `o3-mini` | 2026-08-20 | ✅ 采纳 | 基线 5782ms · 降档后 2785ms | `{"reasoning_effort":"low"}` | 不发时慢一倍；而 gpt-5 系那个 minimal 在这里直接 400，合成一行会打断一条能用的路 |
| `o4-mini` | 2026-08-20 | ✅ 采纳 | 基线 3332ms · 降档后 2642ms | `{"reasoning_effort":"low"}` | 同 o3-mini |
| `whisper-1` | 2026-09-06 | 🔵 可达（参数未扫） | 基线 89690ms | — | 文件式转写（verbose_json + segment/word 时间戳）：英文 12 分钟 38.3s / WER 2.5%，29.8 分钟 89.7s（另一次 92.5s，贴着 90s 的线）/ WER 2.1%；中文 12.6 分钟 46.7s / CER 7.7%，19.9 分钟 70.4s / CER 11.0%（含 LibriVox 片头片尾约 1 个点）。segment 边界不按句子切（原始句界命中 36%），按句末标点重切后 95%。gpt-transcribe 拒绝 verbose_json（"not compatible with model"），没有时间戳，做不了字幕。**参数层面没扫过** —— 转写这条路没有可调参数。 |
| `gpt-live-transcribe` | 2026-09-06 | 🔵 可达（参数未扫） | 基线 2238ms | — | Realtime 流式转写（wss://api.openai.com/v1/realtime?intent=transcription，子协议 openai-insecure-api-key 鉴权，pcm 24k，turn_detection 必须为 null）：逐词 delta 带标点，按句末标点切句后 —— 英文 12 分钟滞后 p50 1.78s / p90 2.24s / max 3.2s、WER 3.7%、99.2% 句子以标点闭合、0 断流；中文 12.6 分钟 p50 1.83s / p90 2.45s / max 3.5s、CER 3.9%、98.8%、0 断流。ms 记的是英文 p90 滞后。真 Chrome 页面源握手成功（scripts/asr-cors-probe.js）。**参数层面没扫过**（delay 档位 minimal/low/medium/high/xhigh 未试）。 |

### `api.deepseek.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `deepseek-v4-flash` | 2026-08-20 | ✅ 采纳 | 基线 3549ms · 思考 278tok · 降档后 1126ms | `{"thinking":{"type":"disabled"}}` | **注册表默认模型**，也是我们的验证基线 —— 它一直在为每个段落思考。关掉快 3.2 倍 |
| `deepseek-reasoner` | 2026-08-20 | ✅ 采纳 | 基线 3506ms · 思考 226tok · 降档后 1296ms | `{"thinking":{"type":"disabled"}}` | 同 host 通行；reasoning_effort 在这里无效，只有 thinking 开关有用 |

### `open.bigmodel.cn`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `glm-4.6` | 2026-08-20 | ✅ 采纳 | 基线 24833ms · 思考 1995tok · 降档后 1410ms | `{"thinking":{"type":"disabled"}}` | 与 gpt-5-mini 同一种坏法：预算被思考吃光、正文 0 字，用户看到「翻译失败」 |
| `glm-4-flash` | 2026-08-20 | ✅ 采纳 | 基线 4660ms · 思考 0tok · 降档后 5554ms | `{"thinking":{"type":"disabled"}}` | 注册表默认模型，本身不思考；这一行记的是「host 通行不会打断它」 |

### `api.z.ai`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `glm-4.6` | 2026-08-20 | ✅ 采纳 | 降档后 1444ms | `{"thinking":{"type":"disabled"}}` | 与 open.bigmodel.cn 同一套 paas/v4，同一行两个 host；这里补的是「z.ai 也接受且生效」 |

### `dashscope.aliyuncs.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `qwen-plus` | 2026-08-20 | ⬜ 测过不写 | 基线 3175ms · 思考 0tok · 降档后 3819ms | — | 默认就不思考，没有可关的东西。加了参数也一样 —— 写进表只会是一个要跟着厂商改的负担 |
| `qwen3-max` | 2026-08-20 | ⬜ 测过不写 | 基线 3938ms · 思考 0tok · 降档后 4017ms | — | 同 qwen-plus，默认不思考 |
| `qwen-mt-turbo` | 2026-08-20 | ⬜ 测过不写 | 基线 383ms · 思考 0tok | — | 翻译专用模型，不思考，且本身就是最快的一档（383ms，对比 qwen-plus 509ms） |
| `qwen3.8-max` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 1978ms | — | 能力探针（短句）：1.9–2.0 秒 / 131 出参 tok。长正文的**参数层面没扫过** —— 但它落在 dashscope 通行行里，会收到 enable_thinking:false（那一行由 glm-4.6 等四个模型的实测支撑）。 |
| `qwen-audio-3.0-asr-flash` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 351ms | — | 转写可达性（真 Chrome 扩展页）：351–488ms，wav 与 m4a 都逐字转对。走 transcribe-dashscope 形状（JSON + base64 data URI）。**参数层面没扫过**。 |
| `qwen-tts` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 2004ms | — | 朗读可达性（真 Chrome 扩展页）：2004ms、148844 字节 WAV、浏览器解码 3.1 秒。两步链路（先要音频 URL 再取字节，回包是 http:// 必须升 https）。四个音色由服务端自己列出。**参数层面没扫过**。 |
| `glm-4.6` | 2026-08-30 | ✅ 采纳 | 基线 68902ms · 思考 3623tok · 降档后 4161ms | `{"enable_thinking":false}` | 这一轮最贵的一条：一段 870 字正文基线要 **68.9 秒**、思考 3623 tok；enable_thinking:false 之后 4.2 秒、思考归零，译文长度不变 —— **快 17 倍**。六种拼法里只有这一种有效，其余五种要么被无视、要么让它思考得更多。教程讲的正是「一个千问 Key 打多厂商模型」，用户一旦手动换到 glm-4.6 就会撞上这 68 秒，而没有任何地方会告诉他为什么慢。 |
| `kimi-k3` | 2026-08-30 | ✅ 采纳 | 基线 24365ms · 思考 805tok · 降档后 6498ms | `{"enable_thinking":false}` | 基线 24.4 秒 / 思考 805 tok → 6.6 秒 / 思考 0，快 3.7 倍。四种拼法有效，选 enable_thinking:false 是因为它同时是 glm-4.6 唯一有效的那一种 —— 一个网关一行，比按模型分叉更不容易漏。 |
| `qwen3.8-flash` | 2026-08-30 | ✅ 采纳 | 基线 21247ms · 思考 2365tok · 降档后 2023ms | `{"enable_thinking":false}` | 基线抖得厉害（21.2 秒 / 思考 2365，与 4.0 秒 / 思考 217 两次），正说明「思考多少」不由输入决定 —— 这也是墙钟时间证据力最弱的原因。降档后稳定在 2.2 秒 / 思考 0。 |
| `deepseek-v4-flash-0731` | 2026-08-30 | ✅ 采纳 | 基线 16506ms · 思考 1410tok · 降档后 2624ms | `{"enable_thinking":false}` | 基线 16.5 秒 / 思考 1410 → 2.6 秒 / 思考 0，快 6.3 倍。顺带拿到一条服务端拒绝原话：这个端点的 reasoning_effort 不收 minimal（只收 low/medium/high/xhigh/max）—— 那正是「写 false 必须有引文」要的那种证据。 |

### `openrouter.ai`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `openai/gpt-5-mini` | 2026-08-21 | ✅ 采纳 | 基线 14951ms · 思考 1168tok · 降档后 4694ms | `{"reasoning":{"effort":"low"}}` | 第四种拼法：这个网关用嵌套 reasoning:{effort}，与 OpenAI 顶层字符串、GLM/DeepSeek 的 thinking 都不同。⚠️ 这一行被**重新验过一次**：同 host 的 minimax/minimax-m2 露出基线抖动 2.4 倍之后，本行原来的 n=1 证据就不够格了。复验后区间不重叠，结论保留 —— 规矩要先用在自己已经采纳的行上，否则它只是装饰 |
| `deepseek/deepseek-r1` | 2026-08-20 | ✅ 采纳 | 基线 10401ms · 思考 466tok · 降档后 22584ms | `{"reasoning":{"effort":"low"}}` | 同 host 通行行；思考 466→237tok |
| `qwen/qwen3.8-27b` | 2026-08-20 | ⬜ 测过不写 | 基线 2169ms · 思考 0tok · 降档后 2106ms | — | 本身不思考；这一行记的是「host 通行不会打断它」，不是它自己需要什么参数 |
| `minimax/minimax-m2` | 2026-08-21 | ⬜ 测过不写 | 基线 5940ms · 思考 496tok · 降档后 6257ms | — | 证明不了有效果。⚠️ 这一行同时是**工具自己的一次翻车记录**：单次采样下五个候选思考量落在 233–264，perf-probe 按最小的那个推荐了 enable_thinking:false —— 一个大概率没生效的参数。多跑几遍才看出那只是噪声。工具与 skill 已据此各加一条判据：候选相差 <15% 时不给自信结论，先测基线抖动 |
| `deepseek/deepseek-v4-flash` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | ⚠️ **反了**：基线不思考，加了参数反而思考 78–233 tok（2026-08-21 全家扫，19 个厂商代表） |
| `baidu/ernie-4.5-vl-424b-a47b` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | ⚠️ **反了**：0 → 372–535 tok，且耗时 4.6s → 13–16s（2026-08-21 全家扫，19 个厂商代表） |
| `mistralai/mistral-small-2603` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | ⚠️ **反了**：0 → 529 tok，2.4s → 5.4s（2026-08-21 全家扫，19 个厂商代表） |
| `amazon/nova-2-lite-v1` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | 基线不思考；加了参数也几乎没思考，但耗时 1.5s → 4.4s（2026-08-21 全家扫，19 个厂商代表） |
| `perplexity/sonar-reasoning-pro` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | 两边都不报推理 token（2026-08-21 全家扫，19 个厂商代表） |
| `xiaomi/mimo-v2.5` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | 两边都不报推理 token（2026-08-21 全家扫，19 个厂商代表） |
| `qwen/qwen3.7-flash` | 2026-08-21 | ⬜ 测过不写 | 思考 2401tok | — | 区间重叠，分不出（2026-08-21 全家扫，19 个厂商代表） |
| `minimax/minimax-m2.5` | 2026-08-21 | ⬜ 测过不写 | 思考 443tok | — | 区间重叠，分不出（2026-08-21 全家扫，19 个厂商代表） |
| `bytedance-seed/seed-1.6-flash` | 2026-08-21 | ⬜ 测过不写 | 思考 829tok | — | 区间重叠（略偏高）。⚠️ 这是豆包家族，但走的是网关，填不上 ark 自家端点那张欠条（2026-08-21 全家扫，19 个厂商代表） |
| `x-ai/grok-build-0.1` | 2026-08-21 | ⬜ 测过不写 | 思考 1564tok | — | ⚠️ **反了**：思考变多。与 api.x.ai 自家端点上「效果不一致」的结论方向一致（2026-08-21 全家扫，19 个厂商代表） |
| `tencent/hy3` | 2026-08-21 | ⬜ 测过不写 | 思考 1953tok | — | 区间重叠，分不出；且该模型基线就要 22–30 秒（2026-08-21 全家扫，19 个厂商代表） |
| `stepfun/step-3.5-flash` | 2026-08-21 | ⬜ 测过不写 | 思考 613tok | — | 区间重叠，分不出（2026-08-21 全家扫，19 个厂商代表） |
| `meituan/longcat-2.0` | 2026-08-21 | ⬜ 测过不写 | 思考 40tok | — | ⚠️ **反了**：思考变多（2026-08-21 全家扫，19 个厂商代表） |
| `inclusionai/ling-3.0-flash` | 2026-08-21 | ⬜ 测过不写 | 思考 458tok | — | 区间重叠且候选方差极大（38–1161），分不出（2026-08-21 全家扫，19 个厂商代表） |
| `z-ai/glm-4.7-flash` | 2026-08-21 | ⬜ 测过不写 | 思考 2108tok | — | ⚠️ 基线耗时 18.7–97.8 秒；候选有一次 200 但正文为空（饿死特征）。这个模型在网关上不适合做翻译（2026-08-21 全家扫，19 个厂商代表） |
| `moonshotai/kimi-k2.5` | 2026-08-21 | ⬜ 测过不写 | 思考 1083tok | — | 候选超时（>120 秒）。基线本身也要 29–45 秒（2026-08-21 全家扫，19 个厂商代表） |
| `nvidia/nemotron-3.5-lightning` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | 基线不思考；候选两次都 200 但正文为空（2026-08-21 全家扫，19 个厂商代表） |
| `upstage/solar-pro4` | 2026-08-21 | ⬜ 测过不写 | 思考 0tok | — | 基线不思考；候选两次都 200 但正文为空（2026-08-21 全家扫，19 个厂商代表） |
| `meta/muse-glimmer-30b` | 2026-08-21 | ⬜ 测过不写 | 思考 757tok | — | **唯一一个区间不重叠的**。但一个孤例不足以支撑 host 通行行，而 meta/ 前缀也不是我们会去匹配的家族（2026-08-21 全家扫，19 个厂商代表） |
| `google/gemini-3.1-flash-lite` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 573ms | — | 能力探针：573ms、单次 $0.0000065、16 出参 tok，目录里最便宜的可用文本模型之一。**参数层面没扫过**。注意它不在 openrouter-thinking 行的前缀里，所以不发降档参数。 |
| `openai/gpt-4o-mini-transcribe` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 600ms | — | 转写可达性：600–730ms、单次 $0.000035。用系统语音念的「The quick brown fox…」逐字转对；wav 与 m4a（iOS Safari 实际产出的容器）都通过。**参数层面没扫过** —— 转写这条路目前也没有可调参数。 |
| `openai/whisper-large-v3` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 1774ms | — | 转写可达性：1774ms、单次 $0.0000064（比 gpt-4o-mini-transcribe 便宜 5 倍）。**但同一段音频它把 The 听成了 a**（返回 " a quick brown."）。**参数层面没扫过**。 |
| `deepgram/aura-2` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 1765ms | — | 朗读可达性（真 Chrome 扩展页）：1765ms、16128 字节、浏览器解码出 2.688 秒音频。90 个音色带语种后缀，无中文。⚠️ 不发 response_format 时它声明 Content-Type: audio/pcm 而 body 是 RIFF —— tts.js 的 sniffAudioType() 按魔数纠正。**参数层面没扫过**。 |
| `openai/gpt-audio-mini` | 2026-08-30 | 🔵 可达（参数未扫） | 基线 1411ms | — | 朗读可达性（真 Chrome 扩展页）：1411ms、290444 字节 WAV、浏览器解码 6.05 秒。走 speech-audio-chat 形状（stream:true + pcm16，自己补 WAV 头）。**参数层面没扫过**。 |
| `google/gemini-3.7-flash` | 2026-08-30 | ✅ 采纳 | 基线 13329ms · 思考 1369tok · 降档后 3152ms | `{"reasoning":{"effort":"low"}}` | 为「官网教程推荐哪个模型」而测，真 key。基线每段思考 1369 tok / 13.3 秒；降档后思考归零、2.9–3.3 秒，译文长度不变 —— 同一段快 4 倍。要紧的是它**不在** openrouter-reasoning 那行的前缀里（那行只覆盖 openai/gpt-5\|o1\|o3\|o4），所以在补上 openrouter-gemini 行之前，推荐它等于让用户拿 13 秒那一档。 |
| `openai/gpt-oss-120b` | 2026-08-30 | ⬜ 测过不写 | 基线 2294ms · 思考 37tok · 降档后 1541ms | — | 同一轮的翻译候选。它**基线本来就几乎不思考**（19–37 tok），降档没有可拿的收益，而 minimal 反而让它思考得更多。测过、决定不写 —— 记下来是为了下一个人不会照文档把它补进参数表。同轮另一个发现：deepseek/deepseek-v4-flash-latest 被网关判为「is not a valid model ID」，那是模型清单里带 ~ 前缀的条目，不能当模型名用。 |

### `generativelanguage.googleapis.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `gemini-3.5-transcribe` | 2026-09-06 | 🔵 可达（参数未扫） | 基线 69362ms | — | 文件式转写（Interactions 接口，JSON 内联 base64，mode 必须 verbatim —— smart 与时间戳互斥，服务端原话 "Transcription mode SMART is incompatible with timestamps"）：英文 12 分钟 51.3s / WER 3.8%，29.8 分钟 69.4s / WER 2.9%（比 whisper-1 的 89.7s 快）；中文 19.9 分钟 59.0s / CER 12.0%（贴着 12% 的线）。词级时间戳与 whisper-1 参照 p90 差 220–260ms；按词切 cue 后句界命中 95–97%。usage 只报音频 token（12 分钟 18000 tok）。真 Chrome 页面源 POST 可读（CORS 放行）。**参数层面没扫过**（diarization、language_codes 未试）。 |
| `gemini-3.6-flash` | 2026-08-20 | ⬜ 测过不写 | 基线 7542ms · 降档后 2040ms | — | 出参 token 基本不变，没有可测量的收益；期间多次 503（high demand），所以按 token 而非墙钟下结论 |

### `dashscope-intl.aliyuncs.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `glm-4.6` | 2026-08-30 | 🟣 继承 | — | — | 同厂商不同域：国际站与境内站共用 model-params 的 dashscope 行，key 按区域绑定所以手上这把打不到它。境内站已实测 adopted（68.9 秒 → 4.2 秒），按继承规则沿用。手上有国际站 key 时应实测覆盖。 |
| `qwen-plus` | 2026-08-21 | 🟣 继承 | — | — | 同一套 compatible-mode 接口，与源 host 共享 model-params 行。源端实测 rejected（qwen-plus 与 qwen3-max 基线思考均为 0，加 enable_thinking:false 无变化），本域按同结论处理 —— 即 reasoning 一列留空 —— 直到拿到该域的 key 实测 |

### `api.x.ai`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `grok-4-fast` | 2026-08-20 | ⬜ 测过不写 | 基线 10176ms · 思考 858tok · 降档后 8255ms | — | 本型号有改善，但同 host 的 grok-3-mini 反而变差（624→969tok），效果不一致；且四次长段全部 finish=stop、271–283 字，没有饿死风险。不稳定的值是维护负担，不是知识 |
| `grok-3-mini` | 2026-08-20 | ⬜ 测过不写 | 基线 8535ms · 思考 624tok · 降档后 9428ms | — | 加了参数反而更慢更费；见 grok-4-fast 那行 |

### `api.anthropic.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | 2026-08-21 | ⬜ 测过不写 | 基线 4721ms · 思考 0tok · 降档后 3398ms | — | extended thinking 是 opt-in，默认就是关的（三个档位实测均为 0）。没有可关的东西；显式发 disabled 只是多一个字段，不省任何东西 |
| `claude-sonnet-4-5-20250929` | 2026-08-21 | ⬜ 测过不写 | 基线 6379ms · 思考 0tok · 降档后 6572ms | — | 同 haiku：默认不思考 |
| `claude-opus-4-5-20251101` | 2026-08-21 | ⬜ 测过不写 | 基线 6996ms · 思考 0tok · 降档后 6166ms | — | 同 haiku：默认不思考。三个档位（haiku/sonnet/opus）一致 |

### `api.minimax.io`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `MiniMax-M2` | 2026-08-21 | ⬜ 测过不写 | 基线 4777ms · 思考 1082tok · 降档后 3596ms | — | 区间重叠，分不出。⚠️ 但这一轮挖出两个**产品 bug**（都已修 + 加回归）：① OpenAI 兼容口上该模型把思考写进正文（<think>…</think>），261 字符输入换回 693 字符 —— 不剥就会把一段英文思考独白当译文渲染，而 isTranslated 只看非空，没有任何一方会报错；② messages 形状上 thinking 是 content 的第 0 块，而 extractMessages 原来只取 content[0].text ⇒ 一律取到空串 ⇒ 用户看到「翻译失败」，而响应里明明有译文。 另注：真正能用的 host 是 api.minimax.io（用户给出），不是表里原先写的 api.minimax.chat / api.minimaxi.com —— 后两者本轮 key 被拒，未能打通。 |

### `ark.cn-beijing.volces.com`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `doubao-seed-2-1-turbo-260628` | 2026-08-21 | ✅ 采纳 | 基线 120003ms · 降档后 4750ms | `{"thinking":{"type":"disabled"}}` | 基线 120 秒超时而候选 4.9 秒成功 —— 不加参数这个模型没法用于翻译。 ⚠️ 这一轮同时暴露了工具的一个判断错误并据此修掉：它按「基线一次都没成功」建议了 unreachable，而五个候选明明成功了。基线失败不等于端点打不通 —— 候选成功时那是「基线本身不可用」，是 adopted 的**最强**证据，不是欠条。 |
| `doubao-seed-translation-250915` | 2026-08-21 | ⚠️ 打不到 | — | — | 翻译专用模型（与 qwen-mt 同类），账号里未开通：「Your account … has not activated the model」。**用户 2026-08-21 明确决定暂不开通**，所以这不是一张待办欠条，而是一个已作出的选择 —— 记在这里是为了下一个人不要再去追它。（若将来开通：通用模型上那个 120 秒基线说明这一档很可能便宜且快得多，而它也可能像 qwen-mt 一样有自己的请求契约，需要单独做形状。） |
| `(历史记录：三次问错问题)` | 2026-08-20 | ⚠️ 打不到 | — | — | 真因是**账号未开通模型**，不是 key 或 id 有问题：「Your account … has not activated the model doubao-seed-translation-250915」。 排查路径值得记下来，因为我前两次都问错了问题：① 一开始凭印象猜 id（doubao-seed-1.6 / doubao-pro-32k），全是 404 —— 而豆包的id 用**连字符不用点**，且要带日期后缀；② 直到去打 GET /api/v3/models 才拿到真实目录（130 个，未下线 61 个）——**同样的教训 kimi 那次已经教过一遍：先问 API 它有什么，别猜**；③ 用目录里的 name（doubao-seed-2-1-turbo）仍 404，要用 id（…-260628）才换来那句「has not activated」。⚠️ /models 列的是目录（能看见），不等于已开通（能调用）。 待用户在控制台开通后重测；建议优先 doubao-seed-translation-250915（翻译专用模型，与 qwen-mt 同类）与 doubao-seed-2-1-turbo-260628（通用快档，做基线对照）。 |

### `api.moonshot.cn`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `moonshot-v1-8k` | 2026-08-21 | 🟣 继承 | — | `{"thinking":{"type":"disabled"}}` | 同厂不同域，与 api.moonshot.ai 共享 model-params 行。源端实测：基线两次里饿死一次，thinking:disabled 后思考 1999→1 tok、快约 8 倍。本域按同结论处理，直到拿到 .cn 的 key 实测。 ⚠️ 另有一个**未决**的问题：国际站的 moonshot-v1-8k 已下架，本域的 defaultModel 仍是它 —— 那个值没有 key 可验，改与不改都是猜，所以保持原样并记在这里。 |

### `api.moonshot.ai`

| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |
|---|---|---|---|---|---|
| `kimi-k2.6` | 2026-08-21 | ✅ 采纳 | 基线 27275ms · 思考 1999tok · 降档后 3348ms | `{"thinking":{"type":"disabled"}}` | 基线两次里饿死一次（HTTP 200、正文 0 字），与 gpt-5-mini / glm-4.6 同一种坏法。五个候选里只有 thinking:disabled 有效，另外四个要么救不了要么让思考变多 —— 「名字里带 disable/false」不等于「行为是关闭」，这一条只有实测能分辨。 |
| `moonshot-v1-8k` | 2026-08-21 | ⚠️ 打不到 | — | — | 404 Not found the model moonshot-v1-8k or Permission denied —— 该型号已从国际站下架。这一行记的不是参数结论，是「注册表默认模型失效」这个事实本身。 |

---

怎么增补：新平台/新模型跑 `node scripts/capability-probe.js <平台>`（横扫可达性），
要调参数跑 `/perf-tune` → `node scripts/perf-probe.js`（纵扫参数）。两者都产出可直接
粘进台账的草稿。台账变了之后重跑本生成器。
