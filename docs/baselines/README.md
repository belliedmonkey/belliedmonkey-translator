# 全链路基线

适用范围：仓库 `package.json` 版本见 `eval/baselines/inventory.json` 的 `sourceVersion`。这是源码清点与协议，不是一次端到端测量。

质量、延迟、成本在本协议下全部 **待测**。这里没有总分，没有通过门槛。2026-10 的数字仍只在 [`docs/benchmark-waterlevel.md`](../benchmark-waterlevel.md)，标为历史参考，未按本协议重测。

## 这一批做到哪

| 文档 | 内容 | 状态 |
|---|---|---|
| [inventory.md](inventory.md) | 业务形态 × 阶段 × 证据 | 源码契约已钉；真机行为待测 |
| [samples.md](samples.md) | 授权、脱敏、样本版本 | 规范已写；真实样本 0 条，冻结集为空 |
| [protocol.md](protocol.md) | 分阶段归因、质量/延迟/成本口径、回归 | 口径已写；质量运行器未跑 |
| [forms/realtime.md](forms/realtime.md) | 实时听译、实时字幕各自的端到端协议 | 协议；待测 |
| [forms/web.md](forms/web.md) | 网页文字，以及四种预制媒体路径 | 协议；待测 |
| [forms/documents.md](forms/documents.md) | 文档，以及不能并进上两类的相邻形态 | 协议；待测 |
| [asr-public.md](asr-public.md) | FLEURS 中英 test 各 8 句的公开 ASR 参考，加离线 CER/WER | 16 条文本已冻结；16 条 wav 在忽略缓存里。15:54 手动首句生命周期已走完，Fichte 被听成 Fished。16 句分数还没有跑。端到端仍待测 |

离线检查：`node eval/baselines/check.js`。它核对证据摘录仍在源码里、矩阵每一格都在、真实失败样本库仍为空、工具用合成句不能变成质量样本。公开 ASR 切片另见上表，不打产品分。

## 和历史水位的关系

[`docs/benchmark-waterlevel.md`](../benchmark-waterlevel.md) 保持原表。其中「端上 SpeechAnalyzer → … → 云端 qwen plus」描述的是 2026-10 快照。当前源码里，听译/字幕的翻译模型来自当场设置；免费额度对话档的钉扎在 `build/grant-models.config.js`；注册表条目 `qwen` 的 `defaultModel` 仍是另一处。intl Mac 的中文听写还有 `e1_b1` 臂。这些差异是清点结论，不是新的分数。

## 形态一览

用户点名的形态都在矩阵里。另外四条是源码里真实存在、但不能拿去代替上面任一形态的路径。学习/复习是采集汇，删掉它翻译输出必须不变，所以不单列成翻译基线。

| id | 用户可见形态 | 源码状态 | 端到端 |
|---|---|---|---|
| `realtime-listen` | 对话 · 实时听译 | 已接线 | 待测 |
| `realtime-subtitles` | 实时字幕 | 已接线，与听译分路 | 待测 |
| `webpage-text` | 网页文字 | 已接线 | 待测 |
| `webpage-youtube` | YouTube 已有字幕 | 已接线 | 待测 |
| `webpage-x-video` | x.com 已有 VTT | 已接线 | 待测 |
| `webpage-podcast-timed` | 播客/音频已有时轴稿 | 已接线；无稿不转写 | 待测 |
| `webpage-ai-transcript` | 无字幕媒体，用户点按后转写 | 已接线，默认不跑 | 待测 |
| `document` | PDF / docx / 文本 / 图片 | 已接线；pptx、xlsx、epub、OLE `.doc` 不支持 | 待测 |
| `adjacent-mac-offline-file` | Mac 本地视频文件 | 桥存在，旗标默认关 | 不是网页媒体基线 |
| `adjacent-quick` | Mac 快捷翻译与截图 | 已接线 | 待测 |
| `adjacent-system-translate` | 系统翻译弹层 | 已接线 | 待测 |
| `adjacent-agent-host` | 宿主 `translate_page` | 计费路径是单次译到 zh-CN；App 未接扩展整页端口 | 待测，且不并进页译 |

场景轴（口音、噪声、专名、数字、纠正过度、语义保真）只是将来的采样计划。语言和平台不按「四端都已覆盖」或「12 语已覆盖」填写。

## 变更规则

- 改注册表默认模型、听译路由、提示词或形态入口时，更新 `eval/baselines/inventory.json` 里对应摘录，并让 `node eval/baselines/check.js` 通过。
- `package.json` 的 version 变更时，同步 `sourceVersion`，并在本索引写明这次版本是否重测。未重测就继续写待测。
- 冻结集一旦有了版本号，改样本必须新版本。本批还没有冻结集。
- 门槛只作为建议交给人工裁定，写进 `thresholds` 之前视为未生效。现在该数组是空的。
- 产品行为改动不在本目录实施。

## 建议（不改产品）

1. 下一次听译测量要钉死当场的臂：`sa` 还是 `e1_b1`、模型断句还是 T/X、设置里的 provider/model。不要沿用 2026-10 那一句管线描述当唯一路线。
2. 文档提取写明双栏和表格不做特判。表格维度在有授权样本之前不能报通过。
3. 播客已有稿、无字幕点按转写、Mac 本地文件，是三条路径。对外数字必须写明是哪一条。
