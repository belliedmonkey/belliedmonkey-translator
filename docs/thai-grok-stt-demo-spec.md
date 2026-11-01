# archdemo：泰语走 Grok STT（grok-voice-transcribe-2.0）

日期：2026-10-23（Asia/Shanghai）。作者：架构师。  
依据：用户 2026-10-22 12:26 定方向；用户 2026-10-23 07:17 批「现在开做」（经 AI 科学家转达）。  
性质：**独立 archdemo**，验证完再交产品总监；**不进 1.19.x**，不进 App Store / TestFlight。

旁证（效果摸底，非本 demo）：`/workspace/research/grok-stt-benchmark-2026-10-22.md`  
— 泰语 FLEURS：Grok 流式 CER **10.5%**、批量 14.9%（+热词 12.5%）；SenseVoice ≈100%（不支持）；流式整句丢失 0/40。

## 1. 目标

在 `~/mobiletranslator-archdemo`（`arch/demo-2026-10-20`）里，用**开发开关**让听译在「对方语言 = 泰语」时走 **Grok STT**，证明（或否证）：

1. 泰语音频能稳定出定稿行（不丢句、句首可接受为拆行）；
2. 云端效果达到旁证量级（CER 大致 ≤15%，整句丢失 ≈0）；
3. **中国翻墙链路能用即可**（延迟不设硬门，只记数）；
4. 开关关时与今天路径**逐字相同**（仍走本机 DictationTranscriber / th-TH）。

不做：进版本规划、替换中英日粤端上路径、用 Grok 流式直接刷字幕的产品定案、Mac 上跑 SpeechAnalyzer 对照（用户已禁）。

## 2. 现状（只读）

| 项 | 事实 |
|---|---|
| 工作树 | Mac `~/mobiletranslator-archdemo`，分支 `arch/demo-2026-10-20` @ `7a090c15`（开工前再核对） |
| 听译 STT | 固定本机：`NativeSpeech` → `speech-bridge` → SpeechTranscriber **或** DictationTranscriber；泰语靠后者（窄引擎不支持 th） |
| SenseVoice | 不支持泰语；与本 demo 无关 |
| 额度中继 `bt-relay` | 有 `shape=stt` 分支，现默认 **不**走 QwenCloud STT；**本 demo 默认不改线上中继** |
| 密钥 | 禁止打印；不用 OpenAI；改线上 secrets / 额度 / 中继模型前必须先问用户 |

## 3. 架构（demo）

```
麦克风 PCM (16k)
    │
    ├─ 开关关：今天路径 → DictationTranscriber(th-TH) → stt-partial/final
    │
    └─ 开关开且会话含 th：
         PCM → GrokSttSession（JS，同 WsTranscribe 句柄形）
              → wss://api.x.ai/v1/stt?model=grok-voice-transcribe-2.0
                &sample_rate=16000&encoding=pcm&interim_results=true
              → 映射为 stt-partial / stt-final（locale=th-TH）
              → 仍进 listen-core 既有管线（xfer / echo / 翻译）
```

要点：

1. **新模块** `app/grok-stt.js`（或 `extension/learn/grok-stt.js` 再挂进 App）：`open({locale})` → `{ sendPcm, close }`，事件形与 `NativeSpeech.sttOpen` / `WsTranscribe.open` 对齐，便于 listen 只改「开哪路」。
2. **路由**：仅当 Debug 开关 `thaiGrokStt === true` **且** 本路 locale 基码为 `th` 时走 Grok；其它语言零改动。
3. **流式优先（demo）**：旁证泰语流式 CER 优于批量且整句丢失更少；产品字幕定案以后再评「端上流式 + 句末批量重识别」。本 demo 先接流式，记锁定延迟与改写次数诊断。
4. **鉴权（默认不碰线上中继）**：
   - Debug：从本机环境 / App 诊断位读 `XAI_API_KEY`（或用户粘贴到 Debug 字段，**永不入库、永不打日志正文**）；
   - **禁止**把 xAI key 写进仓库、打进包、或经 `DiagLog` 明文；
   - 若日后要走额度中继（`bt-relay` 钉 Grok STT），**另开一步并先问用户**，本规格不授权改 secrets / 部署。
5. **中国版**：同一开关；请求仍直连 `api.x.ai`（依赖用户翻墙）。不新增境内 STT 上游。`china-gate` 允许 Debug 包出现 `api.x.ai` 字样仅当开关相关字符串在 Debug 分支；Release 产物必须 0 条 Grok 路径（开关编译剥掉或恒 false）。
6. **不进 App Store 包**：开关默认 false；Release / 提审脚本不带 key、不启开关。

## 4. dsh 步骤（仅 archdemo 树；DeepSeek 4.1 flash；只本地提交；不 push）

每步完成后交架构师只读复核，再进下一步。

| 步 | 内容 | 验证 |
|---|---|---|
| 0 | 记录 HEAD、`git status`；确认不污染 `.dsh-bridge-git/` / `vendor`；`npm test` 记基线 | 工作区干净或仅有已知无关脏文件清单 |
| 1 | 落地 `grok-stt.js`：WS 建连、PCM 分帧（100ms）、`audio.done`、事件映射；单测用假 WS（不定真 key） | 单测绿；无 key 时 open 失败原因具名、不抛未捕 |
| 2 | listen 接线：Debug 开关 + th 路由；关开开关各跑一次假会话 | 开关关：与基线同路径；开关开：th 路不进 DictationTranscriber |
| 3 | 云端活测（**只在 box / 云端机器**）：FLEURS th 子集 ≥20 条经同一适配器；出 CER / 丢句 / 延迟表 | CER ≤15% 或写明差距；整句丢失 0；不在 Mac 跑 SA 对照 |
| 4 | （可选，另批）中国翻墙手测：用户本机开代理听一句泰语，记通断与首字延迟 | 通即可；不通则记代理类型，不改系统网络设置 |
| 5 | 验收报告 → 架构师 → 产品总监；**不**自动进版本规划 | 报告路径见 §7 |

停手条件：需要改线上 `bt-relay` / secrets / 额度模型；需要把开关默认开进 Release；Mac 要跑 SA 对照；要动用户网络/注销/重启。

## 5. 验收口径

| 指标 | 方法 | 过关线 |
|---|---|---|
| 功能 | 开关开，对方语=th，云端灌泰语音频或真听 | 有 partial/final；定稿进听译行；不崩 |
| 准确率 | 同旁证 FLEURS th（可子集）经 demo 适配器 | CER ≤15%；整句丢失 0（句首拆行可接受） |
| 回归 | 开关关 | 与开工 HEAD 行为一致；`npm test` 不比基线少绿 |
| 安全 | 扫产物与日志 | 无 xAI key 明文；Release 无 Grok 运行时路径 |
| 范围 | 分支 / 包 | 仅 archdemo 本地提交；不进 1.19.x、不 TF、不提审 |

## 6. 风险

- 流式锁定延迟偏大（旁证 th 锁定 p50≈2.8s）→ 字幕体验差；demo 只记数，不优化产品 UI。
- 直连 `api.x.ai` 在中国依赖翻墙；失败要有具名错误，不能静默变回 SA。
- Key 泄漏；必须 Debug-only、不进 git。
- 与本机 Dictation 双开会双计费/双行 → **互斥**：th 走开 Grok 时不 `stt-start` 该 locale 的本机路。
- 误把改动 cherry-pick 进 1.19.5 → 规格写明禁止；复核时盯 diff 范围。

## 7. 产物路径

- 规格：本文件（box `/workspace/qa/archdemo-thai-grok/THAI-GROK-STT-DEMO-SPEC.md`；落地后可拷进 archdemo `docs/`）
- 实现：Mac `~/mobiletranslator-archdemo` 本地提交
- 活测表：`/workspace/qa/archdemo-thai-grok/LIVE-*.md`
- 结论文：`/workspace/qa/archdemo-thai-grok/RESULT.md`（交产品）

## 8. 需要用户知道 / 可能再问的

1. **已批**：开做短规格 + 落地；不进 1.19.x；改线上中继前先问。
2. Demo 默认 **直连 xAI（Debug key）**，**不改**线上 `bt-relay`。若要额度代付 Grok STT，请另说一声。
3. 活测在云端跑；需要中国翻墙手测时再喊你（不改系统网络）。
4. 每步 dsh 本地提交，不 push；你未另批前不打包 TF。
