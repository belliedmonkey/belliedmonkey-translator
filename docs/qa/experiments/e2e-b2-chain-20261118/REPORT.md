# 端到端链路 B2：音频 → SpeechAnalyzer → 翻译 → 判审 + 机械检查

时间：2026-11-18 10:34–11:08 CST。授权：用户同意「开端到端产品链路基线」。
结论：**链路第一次真跑通（音频进、译文出），但翻译阶段不可复现。** ASR 36/36 逐字节复现；同一批音频、同一提示词、`temperature=0`，译文只有 22/36 与原记录相同。聚合结果仍是 22/36 通过，说明这个指标的噪声底约为 ±2 条 / ±5 个点。

这不是产品分、不是验收、不是排名。判审仍未校到真金标（金标是草案派生）。

## 0. 这次跑到哪一段

| 阶段 | 来源 | 状态 |
|---|---|---|
| 音频 | 本机 QA 缓存 `audio/fleurs` + `audio/ascend`，36 条 | 跑 |
| ASR | 产品臂 `sa`（Apple SpeechAnalyzer，端上），`reviewed-36-runner-aef9aa8f` | 跑 |
| 翻译 | 产品系统提示词 + `qwen3.7-plus` + 产品 `reasoning` 片段 | 跑 |
| 判审 | 统一提示词，`gpt-4.1-mini` + `qwen3-235b-a22b-2507` | 跑 |
| 机械检查 | `docs/qa/checks/entity-check.js` + 本集 glossary | 跑 |
| App 呈现 | 扩展 / App 界面 | **没跑**，仍是待测 |

## 1. ASR：完全复现

| 项 | 值 |
|---|---|
| 假设文件 | 36/36 与冻结 `aef9aa8f` **逐字节相同** |
| `en_us` WER | 36 / 363 = 9.92% |
| `cmn_hans_cn` CER | 57 / 624 = 9.13% |
| ASCEND MER | 24 / 42 = 57.1% |
| recognize 阶段（36 条） | 10 256 ms（≈285 ms/条，批量） |
| 编译 / 安装资产 | 2478 ms / 504 ms |

ASR 这一段可以当稳定基线用：同样的音频给出同样的字。

## 2. 翻译：不复现

同一批假设、同一系统提示词、同一模型、`temperature=0`、同一 `enable_thinking:false`：

| 项 | 值 |
|---|---|
| 与 B1 冻结译文逐字节相同 | **22 / 36** |
| 不同 | **14 / 36**，差异是改述级，不是空白或标点 |

三个例子：

| 条目 | 冻结译文 | 本次译文 |
|---|---|---|
| `cmn_hans_cn/1671` | "Since 2005, Congress has been funding…" | "Congress began funding the anti-pornography initiative in 2005…" |
| `cmn_hans_cn/1675` | "All nouns, except for the letter C representing you…" | "All nouns except for the one representing your C…" |
| `ascend/00004` | "I am so" | "I so" |

**推论：任何单次译文都是抽样，不是定值。** 这对基线的含义是，分数必须带「同一链路的第二次抽样」才能谈差异；只跑一次的 1–2 条差异不能算改进或退步。

## 3. 判审：聚合相同，条目有翻转

72 次判审（36 条 × 2 评委，统一提示词，与 B1b 同一份，脚本断言提示词骨架 sha 一致）：

| 指标 | B1b 样本 | 本次样本 |
|---|---|---|
| 条目级通过（两评委全维通过） | 22 / 36 | **22 / 36** |
| 意义保全（评委次） | 66.2% | 65.3% |
| 实体与数字 | 87.3% | 86.1% |
| 遗漏 | 81.7% | 76.4% |
| 幻觉 | 77.5% | 75.0% |
| 术语 | 88.7% | 86.1% |
| 流畅 | 98.6% | 97.2% |
| 否定 | 100% | 100% |

**条目级只有 2 条翻转**：`cmn_hans_cn/1671` 不过 → 过，`cmn_hans_cn/1682` 过 → 不过。

于是有了这个指标的噪声底：**同链路重复抽样，条目级 ±2/36，维度级最多 ±5.3 个点。** 以后看到小于这个幅度的差异，先当作噪声。

## 4. 机械检查：补上了评委的盲区，但只有一条是净增益

`entity-check` 在 72 对（本次 36 条 B + 冻结 36 条 A）上：**66 ok、6 warn、0 fail**。

6 条告警全部是真问题：

| 条目 | 告警 | 评委是否都放过 |
|---|---|---|
| `en_us/1670` B | `Glen Cushing` → 格伦·卡辛 | **是（净增益）** |
| `en_us/1670` A | 同上（金标输入也错） | **是（A 条件不是 36/36）** |
| `cmn_hans_cn/1668` B | `Wild Card` → Universal Card | 否 |
| `cmn_hans_cn/1675` B | `Sie` → letter C | 否 |
| `en_us/1675` B | `Sie` 消失 | 否 |
| `en_us/1682` B | 译文凭空出现 `Serenhu Roi` | 否 |

**第一条是这次最重要的**：`en_us/1670` 在**金标输入**下也把 Cushing 译成「卡辛」，两个评委都判全过。所以 B1 的「A 条件 36/36 全维通过」不成立——至少这一条实体错误漏了。这不是翻译被 ASR 拖累，是翻译本身在专名上出错。

检查器的定位因此很清楚：**它不替代评委，它挡住评委结构上看不见的那一类错。** 每条代价 0，可以每次跑。

## 5. 延迟与花费

| 项 | 值 |
|---|---|
| ASR recognize（36 条，批量） | 10.3 s，≈285 ms/条 |
| 翻译 p50 / p90 / max | 1557 / 2088 / 4044 ms |
| 判审 | 72 次，**0.02470932 USD** |
| 翻译 | 36 次，按 token 记，单价不在仓库内，未折算美元 |
| ASR | 本机端上，0 |

## 6. 局限

- **没有 App 呈现层。** 实时听译/字幕/网页/文档四种形态仍全是「待测」
- ASR 只有批量时延，没有「开口到首个上屏结果」
- 36 条、单机、单日；换机器或换 macOS 版本，ASR 可能不再逐字节复现
- 判审金标是草案派生，TPR/TNR 只对那份草案成立
- 机械检查的专名覆盖靠 `docs/qa/checks/glossary-reviewed-36.json` 这份人工词表；换集合必须换词表，否则只剩数字检查

## 7. 文件

| 文件 | 内容 |
|---|---|
| `input/hypotheses.json` | 本次 SA 识别结果（36 条，与冻结记录相同） |
| `input/asr-run-summary.json` / `asr-score.json` | 阶段耗时与 WER/CER/MER |
| `input/ASR.md` | 怎么跑出来的，命令与版本 |
| `chain.js` | `--translate` / `--compare` / `--judge` / `--check` |
| `out/translation/` | 36 条本次译文（含逐条时延） |
| `out/compare-frozen.json` | 与冻结译文的逐条对照 |
| `out/judge/` + `judge-summary.json` | 72 次判审与汇总 |
| `out/entity-check.json` | 机械检查结果 |
| `docs/qa/checks/entity-check.js` | 检查器本体（带 16 条单测，进 `npm test`） |
| `docs/qa/checks/glossary-reviewed-36.json` | 本集的专名/品牌词表 |
