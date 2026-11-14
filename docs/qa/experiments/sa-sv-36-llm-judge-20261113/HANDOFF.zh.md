# SA vs SenseVoice 36 条独立组件实验 — 记录与计划交接（2026-11-14）

时区：Asia/Shanghai（UTC+8）。本文件写于 2026-11-14 11:10 CST。  
授权依据：用户 t58u / [pt58u]「先把所有实验的记录和计划都提交合并吧。接下来我转给openbot去做」。

## 0. 本步做了什么、没做什么

本步**只归档、整理脱敏资料包**，供 Cloud 做**文档专用**提交并合并记录/计划。

已停止且本步未做：

- 继续修复 judge 包代码或仓库代码（不改 translator repo，不开 PR，不修 75266d0a / e5a17a1c）
- 付费补评 / 任何 OpenRouter 调用 / 重跑测试 / 重跑 LLM / 扩审计
- 真实语义人审执行（空表保持空白，`semanticHumanReviewCount` 仍为 0）
- 向 OpenBot 发消息（用户自己转）
- 访问 Mac、联网、读取或复制密钥 / `.local` / cookie / token
- 把官方 v1/v2 partial 改标为 complete
- 改官方 ASR 原分
- 把当前大 PR #663 的未验代码一并自动合入

制作机是共享 box。OpenBot **不能假定能读 box**，也不应假定能读 Mac。关键小记录已放进本包，便于随后写入仓库文档路径。大音频只提供路径与 hash。

## 1. 当前冻结结论（不得因归档改写）

- 这是**独立组件 ASR 对比**，不是产品指标、不是默认链路、不是发布、未合并进研发。
- 官方 ASR 原分（来自官方 `score.json`，productMetric=false）必须保持不变：
  - SA（`results/aef9aa8f`，hypotheses `255454cf…507dfa57`，score `96009a49…14bd94bc`）：en WER **36/363**，zh CER **57/624**，codeswitch MER **24/42**（`ranking=false`）
  - SV（`results/f6ec838b-sv`，run hypotheses `c6780b64…c22e02d8`，score `4eac5f35…423605b5`；独立复打分 `a8e683a2…b72bb994` 与 run 分数一致）：en WER **29/363**，zh CER **57/624**，codeswitch MER **17/42**（`ranking=false`）
- 官方 **v1** 付费跑：`ok=false`，`code=partial`。RESULT sha256 `e1496fd413d4057b09ee75346c96d7da7cd85402c2f1a270d2fc40bf6ba5e0b6`。归档后仍是 partial。
- 官方 **v2** 付费跑：`ok=false`，`code=partial`。RESULT sha256 `580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc`。解析：judge-a 34/2，judge-b 23/13，双方成功 22。归档后仍是 partial。
- 语义人审实际完成数：**0**。官方 `human-review.json` sha256 `b034c87c8fc841a32e99d20967a011bf7621165bba08cfbc0f2f2fe77889c453`：`semanticHumanReviewCount=0`，`earReviewUsedAsSemanticReview=false`，分歧 17、抽样 5（因约定成功只有 5 条故抽满 5）、`notAssessed` 14。空表在 `records/09-v2-backfill-prep/human-review/`。
- **听审/耳听不是语义人审。** `records/14-ear-listen-not-semantic-review/` 只是早期听音材料。
- 最新两份补评入口包均为独立复验 **FAIL**，不得用于付费：
  1. `01M7BYBRDRFCHNC7FXJJV8A3GE` / 宣称 head `75266d0a`：6 项 fail-closed 缺口
  2. `01M7BZMPXBWB0C6952HYQ3SNY3` / 宣称 head `e5a17a1c046a4df370c95ba2731b20e2e14eaeea`：前述 6 项在诚实 lock 下已挡住，**唯一剩余阻塞**是 `origin-lock` 的 `failedPairs`/`succeededPairs` **未与 origin 的 summary.results 或 parsed/ 交叉核验**（正确 hash 的 lock 若把官方成功对 relabel 为 failed，仍会发请求并返回 supplement-complete）。36 项检查中 35 通过、1 项关键失败。
- 补 15 未执行、未花钱。原成功 57 对**不得重跑**。selection-15 已冻结，不得因选 15 重新 `assignItems`。
- `judge-prep/STATUS.json` 仍写「未调用真实 LLM」，是**过期准备态**，不能当作最新官方结果。

## 2. 费用 ledger

详见 `LEDGER.md`、`LEDGER.json`。摘要：

| 口径 | USD |
|---|---|
| 计划累计上限 | 0.28 |
| 已用（信封累计） | 0.10094232 |
| 剩余 | 0.17905768 |
| v1 provider actual | 0.04447240 |
| v2 provider actual | 0.03845668 |
| 补 15 预留 | 0.03251712（未执行、未花） |

v1 的 0.04447240 已用官方文件复核：72 次正式调用 `usage.json` 合计 **0.04435536**，加上两次历史 32-token probe **0.0000808 + 0.00003624**。v1 usage 的 `spentUsd=0.04980548` 是信封，`providerUsdIgnored=true`。v2 的 0.03845668 与 RESULT `thisRoundProviderUsd` 及 usage 72 次合计一致；本轮未再计 probe。信封累计 0.10094232 = v1 0.05570372 + v2 本轮结算 0.0452386。不要用 provider 之和去改 plan used。

## 3. 冻结钉（hash / pack / head / CI 边界）

完整钉在 `PINS.json`。要点：

**输入与作业**

- 匿名输入 `input-asr-36.json`：`1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1`
- `pair-manifest.json`：`2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7`
- assignment 整文件：`3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470`
- assignment 规范正文 `JSON.stringify({schema,seed,items})`：`3cffd11608d4cf4f721ca410cbd93a2a183d1cc7f2f6659e581524e79fb5f52e`
- seed **20261113**，选 15 时不得重摇槽位
- arm-mapping **不在本包**：sha256 `0267f1078c98a2a0cdfde35b9cefeb7699db281a9f2870123c453c72c97e841a`，取用说明见 `records/03-judge-prep-frozen/ARM-MAPPING-NOTE.md`

**Prompt**

- 官方 v2 模板：`a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`（2507 UTF-8 字节）
- 已废 v1 模板：`a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6`（不得再用于补评）

**官方 v2 跑（head / pack / 证据）**

- pack `01M7ASY5H5YT8XV1NH4Y291ZFP.gz`：`a81afb949cc3e7ebc807e7ac90e88b6cd520220bd519641ec3051876d3ee3f92`（本包 `records/06-v2-pack-verify-e998c2c0/package/` 与 v2 evidence package 中有副本）
- 宣称 head：`e998c2c03f13af0229229405bb1f7b06a3be967b`
- 正式配置：`e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180`，`budgetUsd=0.22429628`
- 证据 tar 原件（含 tokenizer 与 arm-mapping，本包未内嵌）：`e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002`
- summary `4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f`；usage `2c72567b6f04191536f84fdb42dda3971082fcb6bb561c3b53ae184478126da1`

**官方 v1 跑**

- pack `01M7AJ65AKYJT2H26187ZDN7TW.gz`：`74258e362de80cf39986717b32b65ef6ec9d3719bd60d21b91af54c1d441a9fe`
- 证据 tar 原件（含 mapping，本包未内嵌）：`dfc9e572939f8064b14e628076ff627fbd9f6bf8b2347390caff18cfed8221e4`

**selection-15 与诚实 lock**

- selection 文件 sha256 `55978cec4c045e7e606559af713a68260ea41aae1c686f2934d3a807876e1135`
- 规范正文（schema+pairs compact）`c151018bfda2953d2375f8cfce25580787745f162824b66f2d7eccec641979a4`
- 15 对、14 条（`en_us/1673` 双模型都失败）；GPT 2 + Qwen 13
- 诚实 origin-lock 文件 `1abc0d51af3b5e7fc99ac52a93dfdd01c43b86a44921440e3da180fa720a325e`（57 成功 / 15 失败，与 origin 一致）。**当前包不会核验该列表。**

**CI 边界**

- cloud55 自称 3402 tests 绿，cloud56 自称 3412 tests 绿。测试不在 pack 内。本归档**未重跑测试或 CI**，不得把「自称绿」写成已经本步验证。

## 4. 规范与数据局限（组件实验，不是产品）

- 集合：30 条 FLEURS（1668–1682，en_us + cmn_hans_cn）+ 6 条 ASCEND（00004,00009,00028,00055,00066,00068）。FLEURS CC-BY-4.0，ASCEND CC-BY-SA-4.0。
- 官方打分金标准是 pack `reference`（规范化后）；judge 输入里的 `reference` 是 pack `raw`。二者不要混用。
- codeswitch / mixed 的 MER 不算排名指标（`ranking=false`）。
- 已知规范/数据局限应继续写在分析与 reviewed 文档中，例如：拉丁规则、个别金标与译文不完全同形（诊断里出现过 cmn 1675「即使」vs 引用「即便」这类 quote 失败，是 quote 约束问题，不要回头改官方 ASR 分）。具体条目以 `analysis-aef9aa8f`、`v2-offline-diag` 报告为准，不要在本交接里发明新结论。
- 辅助臂倾向只是 QA 旁路，不是 winner：双方解析 22；倾向计数曾记 SA 4 / SV 3 / tie 7 / split 5 / notComparable 17（其中 14 未解析 + 3 条双方解析但 judge-b abstain）。不得把 17 读成 17 条未解析。
- 不透明键 `hx9q2w`/`jt4m8c` 出现在 assignment / allowlist 的槽位上是预期的；**映射到 SA/SV 的文件不在本包、不在人审表。**

## 5. 基线全链路 / 业务形态计划（已有文件索引，不是已完成端到端）

这些是「计划与审查说明」，端到端/产品形态**仍待测**，不要写成已经跑完全链路：

- `records/13-full-chain-plan-index/runner-bundle-inspect/reviewed-36.md`
- `records/13-full-chain-plan-index/runner-bundle-inspect-aef9aa8f/reviewed-36.md`
- `records/13-full-chain-plan-index/runner-bundle-inspect-f6ec838b/reviewed-36.md`

要点（摘自已有 reviewed 文档，不是新实验）：这是独立组件研究，不是产品桥、不是默认链路、不是发布；端到端仍待测。仓库里的某些下载地址是产品中继，实验不应调用。

## 6. 本流已读实验与计划时间线（不虚构未读项）

清点范围：`/workspace/baseline-sa-sv-36-20261113` 及已知相关 QA 目录（`baseline-review-*`、`baseline-sa-mac-20261112` 仅索引）。**未全盘扫描。**

1. **SA / SV 真实 36 组件数据**（`records/01-*`、`02-*`、`00-baseline-36`）：官方分数见第 1 节。分析见 `analysis-aef9aa8f`（AUDIT、ASCEND-6、item 表）。
2. **全链路/业务形态计划**：见第 5 节，仅索引已有文件。
3. **官方 v1 judge 付费跑（partial）+ 离线诊断**：`records/04-v1-official-partial`、`records/05-v1-offline-diag`。v1 主要问题是 prompt 诱发 GPT 把 slots 写成对象；已被 v2 合约（slots 必须是长度 2 的数组）纠正。细节以该目录 REPORT 为准。
4. **v2 包离线复验（e998c2c0）后的官方 v2 付费 36×2（partial）**：`records/06-v2-pack-verify-e998c2c0`、`records/07-v2-official-partial`。模型：`openai/gpt-4.1-mini` 与 `qwen/qwen3-235b-a22b-2507`，OpenRouter Chat Completions。
5. **v2 剩余失败离线诊断**（同意先分析、不立刻付费重跑）：`records/08-v2-offline-diag`。15 个官方失败（14 条）：GPT 2 条 bad-json；Qwen 7 条 bad-json（其中 cmn 1673 `finish_reason=error` 且 providerUsd=0，不得写成「已完成的模型 JSON 错误」）；3 条缺 note 字段（不是超 400 字）；3 条 quote 不合法。未发现可无损恢复的官方 pass。观测性缺口（error finish 只标 bad-json；有 token 时 usage.complete=true）已记录，本步不修代码。
6. **补评准备（离线，未执行）**：`records/09-v2-backfill-prep`。allowlist-15、预算、人审说明与 17+5 空表、14 条 pending 此时不要审。`DO-NOT-RUN.txt` 仍有效。
7. **两次入口独立复验 FAIL**：`records/10-verify-75266d0a-FAIL`、`records/11-verify-e5a17a1c-FAIL`。最小脚本与脱敏 fixtures / 合成输出已收录，供后续修包后复验，**本步不修代码**。
8. **最新唯一 lock 集合交叉核验阻塞**：见第 1 节与 `records/11-verify-e5a17a1c-FAIL/REPORT.md`。
9. **DeepSeek BEL-258**：仅开卡、未实验。本盒已清点文件中**未找到 URL**，不虚构。见 `records/15-plans-unrun/BEL-258-DeepSeek.md`。
10. 更早的包审计（`verify-3ee413a0`、`verify-8ddf6e8e`、lib-fixture、audit）作为历史准备收录在 `records/12-*`，不要把它们写成另一次官方付费成功。

未整树复制的大目录（约 15–17MB，多半是 tokenizer/catalog）只留索引：`records/12-indexes-not-copied/`。

## 7. 官方 v2 十五失败与补评规则（精确，不重跑 57）

allowlist 在 `records/09-v2-backfill-prep/out/allowlist-15.json`（sha256 `07d7a773b38352b35a0ba4966318247edd6f01d2d636e057e1186a95f309c536`）。selection 用上述冻结文件。

日后若（且仅当）用户新授权、且新包独立复验通过 lock↔origin 交叉核验之后，才可以考虑付费补评。计划参数（仍不得在本步执行）：

- 同一池、同一 assignment、官方 v2 prompt，不自动加轮
- `--select` 冻结 selection-15
- `--origin` 钉到官方 v2 judge-run，summary sha256 `4744aef1…34365f`
- `--origin-lock` 必须先证明其 lists 与 origin `parsed/` 及 `summary.results` 1:1，禁止仅凭正确 hash 的伪造列表
- `--out` 必须是新的空目录，不能是 origin、不能是符号链接/别名/父子路径
- `budgetUsd=0.17905768`，`maxRequests=15`，`maxTotalTokens=48000`，`maxRetries=0`
- 计数器与运输由官方包装器注入；密钥只存在 Mac 内存，不得落盒、不得进本包
- 补评失败保持 null，不得把 origin 57 改写或挑拣；`supplement-complete` 不得把单次/双盲 complete 置真
- 人审名单在补评后必须刷新；14 条 notAssessed 在补评完成前不要当成人审对象

## 8. 输入 / assignment / 复现命令（记录用，本步不执行付费）

本包已收：匿名输入、pair-manifest、assignment、selection-15、官方 v2 prompt 所在 pack、usage/summary/RESULT、allowlist、人审空表、两次 FAIL 的 verify 脚本。

已执行过的离线准备（不必重跑，除非要核对脚本本身）：

```
node records/09-v2-backfill-prep/scripts/prepare-v2-backfill-prep.mjs
```

（原盒绝对路径是 `/workspace/baseline-sa-sv-36-20261113/judge-prep/v2-backfill-prep-20261114/scripts/prepare-v2-backfill-prep.mjs`。脚本若写死盒路径，在其他机器上需要改路径或对照本包副本。）

两次失败入口的最小复验脚本（只读复现，不修包、不付费）：

```
# 脚本与结果已在本包；路径需指向本包或原盒
node records/10-verify-75266d0a-FAIL/scripts/verify-observe.mjs
node records/11-verify-e5a17a1c-FAIL/scripts/verify-supplement-gate.mjs
```

官方付费包装器脚本在各自 evidence 的 `scripts/`（如 `run-official.js`、`count-tokens.py`）。其中请求里的 `authorization` 字段在官方存档中已是 `"redacted"`。不要回填真实密钥。Tokenizer 权重未进本包，计数以官方跑当时写入的 plan/inputChecks 为准；本盒当时缺 tiktoken/tokenizers，后验只在 prompt 与官方存档 request 消息一致后使用官方声明 token 数。

## 9. 人审材料

- 实际语义人审：0，不得用代理审或耳听冒充
- 空表与说明：`records/09-v2-backfill-prep/human-review/`（17 disagreement + 5 sample，全部 `semanticHumanReviewed` 应为 false；`pending-backfill-not-for-review-now.json` 是 14 条）
- 人审表不得带臂映射。本包未放入 `arm-mapping.json`

## 10. 路径对照（盒 / Mac）

Box（制作本包的机器，OpenBot 不一定能访问）：

- 基线根：`/workspace/baseline-sa-sv-36-20261113/`
- 本包：`/workspace/experiment-records-handoff-20261114/`
- 音频：`/workspace/baseline-sa-sv-36-20261113/audio/`（hash 见 `audio-index/`）
- 官方 v1 证据树：`/workspace/baseline-sa-sv-36-20261113/judge-prep/real-run-20261113-2253/`
- 官方 v2 证据树：`/workspace/baseline-sa-sv-36-20261113/judge-prep/v2-real-run-20261114-0015/`

Mac（本步未访问，路径来自已有官方报告）：

- 工程：`/Users/belliedmonkey/mobiletranslator`（machineId `e223ea06-b095-46bd-82fd-4bc961a21408`）
- QA v1：`/Users/belliedmonkey/qa/llm-judge-real-20261113-2253`
- QA v2：`/Users/belliedmonkey/qa/llm-judge-v2-real-20261114-0015`

密钥只应在 Mac `.local` 内存使用，禁止复制到 box 或本包。

## 11. 推荐仓库文档布局（文档专用提交，不要并入 PR 663 未验代码）

建议在 translator 仓库开**独立文档/记录分支**，例如：

```
docs/qa/experiments/sa-sv-36-llm-judge-20261113/
  README.md                          # 一页指向 HANDOFF.zh.md
  HANDOFF.zh.md
  LEDGER.md
  LEDGER.json
  PINS.json
  INVENTORY.md
  EXCLUSIONS-AND-BOUNDARIES.md
  DO-NOT-MERGE-PR663.txt
  audio-index/                       # 只有清单与 hash，没有 wav
  records/                           # 本包 records/ 原样
```

不要把 23MB 音频、tokenizer.json、OpenRouter 全量 catalog、`arm-mapping.json` 送进 git。官方 evidence 原 tar 因含 mapping 与 11MB tokenizer，用摘录 + 原件 hash 说明即可。若日后需要 tokenizer，按官方 EXPECTED-SHA256 在原盒/Mac 原 tar 取，而不是改官方分数。

提交说明应写清：仅合并实验记录与计划；**不**把 PR #663 当前未通过付费入口复验的实现一并合入；不发布、不切默认。

## 12. 接续者（OpenBot，由用户转交）注意

- 先读本文件、`LEDGER.md`、`PINS.json`、`EXCLUSIONS-AND-BOUNDARIES.md`
- 未通过「lock 列表 × origin parsed/summary」的新包，不得进入 Mac 付费
- 不得修改官方 v1/v2 RESULT 的 partial 状态，不得改 ASR 原分
- 不得把耳听当语义人审
- 不要向本归档步骤补做付费或扩审计
- BEL-258 只是计划
- 需要揭盲时按 ARM-MAPPING-NOTE 在原件上按 hash 取用，不要把 mapping 写入人审材料或公开文档

## 13. 本包内容边界

见 `EXCLUSIONS-AND-BOUNDARIES.md` 与 `INVENTORY.md`。敏感剔除：arm-mapping 正文、tokenizer 权重、音频波形、完整模型 catalog、`.env`/`.local`/凭证、AppleDouble `._*`、官方原 tar（因含 mapping 与 tokenizer）。请求里的 authorization 在官方存档已是 `redacted`；复制时未发现需再次遮盖的密钥正文。
