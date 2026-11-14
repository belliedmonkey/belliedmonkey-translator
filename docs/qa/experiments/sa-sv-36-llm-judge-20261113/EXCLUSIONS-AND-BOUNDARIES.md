# 敏感剔除项与遗漏边界

时区：Asia/Shanghai（UTC+8）。

## 明确剔除（未进入本包）

1. **arm-mapping.json 正文**（sha256 `0267f1078c98a2a0cdfde35b9cefeb7699db281a9f2870123c453c72c97e841a`）。只留 `records/03-judge-prep-frozen/ARM-MAPPING-NOTE.md`。官方 v1/v2 原 evidence tar 因含该文件，改为摘录而非内嵌原 tar。
2. **Qwen tokenizer 权重**（`tokenizer.json` 约 11.43MB）及 tokenizers 目录。官方 EXPECTED-SHA256 / TOKENIZER-ASSUMPTIONS 若在摘录中则保留文字钉，不附权重。
3. **音频波形**（`/workspace/baseline-sa-sv-36-20261113/audio/` 约 23MB；以及 `baseline-review-*` 中的 wav）。只留 `audio-index/` 的路径与从基线 SHA256SUMS 摘出的 hash。基线整包 tar 约 23.5MB，不套进本归档。
4. **完整 OpenRouter models catalog**（`openrouter-api-v1-models.json` 及约 17MB 的 `openrouter-catalog-20261113`）。只留索引。
5. **大体积分期/准备目录整树**：`official-stage-20261113-2253`（约 17MB）、`v2-real-run-20261114-0015-prep`（约 15MB）、`judge-prep/llm-judge-real-20261113-2253.tar.gz`（约 3.9MB，sha256 `36143f842d199d54d8035db2c1afc5118c1c823d5edd962a3b83e34138c0827b`）。官方结果以 v1/v2 摘录为准。
6. **凭证与密钥**：未复制 `.env`、`.local`、credentials、cookie、token、Authorization 实值、私钥。本步未访问 Mac `.local`。官方请求 JSON 中 `authorization` 已是 `"redacted"`；复制扫描未再发现需遮盖的实值。
7. **AppleDouble** `._*` 文件。
8. **模型权重 / onnx** 等二进制（若出现则跳过）。
9. **人审材料中的臂映射**：未放入。assignment / allowlist 中的不透明键 `hx9q2w`/`jt4m8c` 是槽标签，不是 mapping 正文。

## 原官方 evidence tar（保留 hash，不内嵌）

| 项 | 盒路径 | sha256 |
|---|---|---|
| v1 证据 tar | `/workspace/baseline-sa-sv-36-20261113/judge-prep/real-run-20261113-2253/llm-judge-real-run-20261113-2253-evidence.tar.gz` | `dfc9e572939f8064b14e628076ff627fbd9f6bf8b2347390caff18cfed8221e4` |
| v2 证据 tar | `/workspace/baseline-sa-sv-36-20261113/judge-prep/v2-real-run-20261114-0015/llm-judge-v2-real-20261114-0015-evidence.tar.gz` | `e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002` |

Mac 对应 QA 目录见 HANDOFF 第 10 节。原 tar 可在那些位置按 hash 核对。

## 遗漏与清点边界（诚实限制）

- **未全盘扫描** box。只清点 `/workspace/baseline-sa-sv-36-20261113` 与已知相关目录：`/workspace/baseline-review-*`、`/workspace/baseline-sa-mac-20261112`（后者仅索引，未把其中排障日志写成已完成实验）。
- **未访问 Mac**，未复核 Mac 上文件是否仍与盒上 hash 一致。Mac 路径来自已有官方报告。
- **DeepSeek BEL-258 URL**：会话称已知，但已清点文件中没有卡片正文或链接，本包不虚构。
- **未把全部历史对话原文**倒进本包；以盒上 REPORT/RESULT/usage/selection/lock 为准。
- **未联网**拉取 Linear、GitHub PR #663 或 OpenRouter 目录。CI「绿测」只记录 pack 自称值，本步未跑测试。
- **未重跑** SA/SV、未重跑官方 judge、未重跑 tokenizer 计数、未扩展审计。
- 更早 pack 审计目录中的 `pack-unpacked` 可能不完整（跳过了 tokenizer）；完整 pack gz 已在官方 v2 / 两次 FAIL 目录中提供。
- verify 脚本可能写死 `/workspace/...` 原盒路径；接续时要改路径或同时保留盒访问。
- `lib-fixture-runs`、早期 dryrun 是库级/合成记录，不是第二次官方付费。
- 若盒上还有未列入「已知相关 QA 目录」的平行实验，本包没有声称穷尽。

## 本归档步骤的安全处理

复制 JSON 时若发现 authorization / api_key / cookie / token 等字段且值不是已有的 `redacted`/空，会改写为 `REDACTED-BY-HANDOFF-20261114`。本轮实际改写次数见 `SECRET-SCAN.md`。
