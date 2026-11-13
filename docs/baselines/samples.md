# 样本授权、脱敏与版本

本文件是规范。目录 [`eval/baselines/samples.json`](../../eval/baselines/samples.json) 的 `records` 现在是空的。冻结集 [`eval/baselines/frozen-sets.json`](../../eval/baselines/frozen-sets.json) 也是空的。真实失败样本 **待测** 的前置条件还没满足：没有可入库的授权材料。

本批没有读取生产日志、生产录音、账号内容或凭据，也没有编造失败句。

## 可以入库的来源

| `authorization.kind` | 含义 |
|---|---|
| `user-consented` | 当事人同意把这段文字或音频用于评测，同意范围写在 `note` |
| `public-license` | 许可证允许这种再分发与评测使用，记下许可证名与出处 |
| `internal-review` | 已经脱敏的内部复盘，复盘记录本身可审计 |

`tool-only` 只允许出现在 `eval/baselines/fixtures/`。检查器会拒绝把它当成质量样本。合成句不能填质量基线。

## 禁止

- 未授权的生产日志、录音、网页、文档、字幕
- 未脱敏的姓名、账号、密钥、能反推身份的 URL 或文件名
- 第三方版权材料拿来当内部语料
- 把 2026-10 水位、既有试跑票或测试夹具里的句子直接当成失败库。启用前要单独核授权与完整性

## 脱敏

每条入库记录至少有：

- `redaction.identity === true`：标识和可反推元数据已去掉
- `redaction.text`：文本是否已替换敏感片段
- `redaction.audio`：音频是否保留。默认不保留原片；若保留，要写降质或替换方式
- `form` 与 `stage`：必须是清点矩阵里的 id
- `setVersion`：非空。改一条样本的内容就要新版本，不覆盖旧版本

音频若不能安全保留，记录现象和阶段即可，不要把原片放进仓库。

## 一条记录要写什么

业务形态、处理阶段、语言、平台、现象、授权依据、脱敏记录、存储位置。场景标签（口音、噪声、专名、数字、纠正过度、语义保真）有则记，没有就记缺口。不要用「流畅 / 幻觉」代替从样本里读出来的失败方式。

## 当前缺口

| 形态 | 样本 |
|---|---|
| `realtime-listen` | 0 |
| `realtime-subtitles` | 0 |
| `webpage-text` | 0 |
| `webpage-youtube` | 0 |
| `webpage-x-video` | 0 |
| `webpage-podcast-timed` | 0 |
| `webpage-ai-transcript` | 0 |
| `document` | 0 |
| 相邻形态 | 0，且即使以后有，也不能顶替上面的形态 |

因此没有真实失败冻结集、没有人工金标、没有 LLM judge 校准集。这些都 **待测**。

## 默认链路目录

`eval/baselines/default-chain-catalog.json` 把已有的 16 句公开朗读标成 `sa` 文件 smoke，新集合的 `plannedTarget` 是 30，`actualCount` 是 0，真实失败是 0。这 30 仍是计划里的捐献名额，不是下面的公开候选。`cmn_hans_cn/1663` 的人耳核对已记入，`zh1663AudioChecked` 为 true，`humanVerifiedCount` 只计这一条。批准集合仍是空的，不能按这条改参考。离线命令是 `node eval/baselines/default-chain-check.js`。产品进程里的文件喂入仍要另一次批准，本文件不实现它。

同一 FLEURS 修订 `70bb2e84b976b7e960aa89f1c648e09c59f894dd` 上，冻结 16 句没用到的下一批 15 个共同句子编号在 `eval/baselines/asr/public-candidates-v1.json`。那是 30 条朗读文本、15 个编号对齐，来源许可不是人审核对。`humanVerifiedCount`、`approvedPlannedSetCount`、`realFailureCount` 都是 0。口音、噪声、混语、连续对话的计数是 0，状态是 unknown。30 条 wav 在 `eval/baselines/asr/.cache/public-candidates`，不进 git，也不和冻结 16 句的 `.cache/audio` 混放。`cmn_hans_cn/1663` 的人耳结论见 [zh1663-ear.md](zh1663-ear.md)。1668–1676 的中英人耳结论见 [fleurs-candidate-ear.md](fleurs-candidate-ear.md)。这几份都不改这 30 条清单里的 `humanVerifiedCount`。离线命令核对全部 30 条，缺任何一条都不是成功：`node eval/baselines/asr/fetch-public-candidates.js --offline`。首次把 hash 写入 sidecar 才用 `node eval/baselines/asr/fetch-public-candidates.js --freeze-audio`，普通运行不改 sidecar。空白听审表是 `node eval/baselines/asr/make-review-pack.js --out <目录>`，不把任何一条标成通过。口音、噪声、混语、连续对话的公开说明见 [scene-sources.md](scene-sources.md)。ASCEND 另有 6 条文字筛选，见 [ascend-candidates.md](ascend-candidates.md)，不计入这 30 条捐献。

## 公开对照不是这份目录

FLEURS `en_us` / `cmn_hans_cn` test 各 8 句在 [`asr-public.md`](asr-public.md)。许可记录为 CC BY 4.0，`kind` 为 `public-comparison`。它不进入 `samples-0`，也不把朗读参考写成用户失败。真实失败行数仍是 0。

## 版本

- 目录版本现在是 `samples-0`，表示「空，且被阻塞」
- 第一批真实样本入库时改为新的版本号，并同时给每个要测的形态写冻结集版本
- 训练集、调参集、最终测试集必须分开。本批三者都不存在
