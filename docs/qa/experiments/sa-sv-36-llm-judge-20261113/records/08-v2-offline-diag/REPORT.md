# 正式 v2 剩余失败离线诊断（不回填、不付费）

目录：`judge-prep/v2-offline-diag-20261114/`。授权：t55u / [pt55u]「同意」先离线分析剩余失败，不再直接付费重跑。

约束：只读现有正式 v2 证据与已归档 pack；不付费、不网络、不 Mac、不 secret、不改仓库/冻结包/原 run/分数；官方 partial 永久保留；不做语义人审或伪造人审；不把本次 agent 审视当人审；不启动新 paid 补洞。预算台账仍为累计消耗 `0.10094232` / 计划 `0.28`，本诊断不改台账。

## 简短结论

原 parser 重放与正式结果一致：judge-a（GPT）34/36 有效、judge-b（Qwen）23/36 有效、双有效 22。正式原件 hash 与归档钉扎一致。15 条失败判决（14 个 item，`en_us/1673` 双失败）均已对照发送的 v2 contract 与完整存储响应检查。**未发现会把合法完整 JSON 误判为失败的 pack 解析器缺陷，也未发现可无损提取/去围栏即可正式通过的响应。** 不得回填、不得修 quote/截 note/修 JSON 编造判决。

失败精确分类（15 条）：

- **模型违反「返回一个 JSON 对象」且响应完整（finish_reason=stop，输出远小于 2048）共 8 条：** 6 条在 slot-1 结束后多了一个 `}`（`"}]}},{"slot":"slot-2"`）；1 条（GPT `cmn_hans_cn/1671`）在空 `hypQuote` 后键 `reason` 缺少起始引号（精确切片为 `"hypQuote":"",reason":`，JSON.parse 于 pos 474 / 字符 `r`；合法写法应为 `,"reason":`）；1 条（Qwen `cmn_hans_cn/1681`）出现 `"slot": "slot": "slot-2"`。无 markdown fence、无非法 JSON escape、非 max_tokens 截断。不能因为「看起来像判决」就改字节修复。
- **不可把「模型 JSON 写错」当作完整结论 1 条：** Qwen `cmn_hans_cn/1673`，`finish_reason=error`，`providerUsd=0`，`outputTokens=137`，存储 content 在 `"hyp` 处未终止字符串。这是网关/供应商未完成响应（至少存储如此）；官方记为 `bad-json` 对「已存文本」成立，但不能武断说模型在完整生成后写出了非法 JSON。
- **模型违反明确槽位键约束 3 条（官方 code=`note`）：** `cmn_hans_cn/1674`、`cmn_hans_cn/1676`、`en_us/1670` 的 slot-2 **缺少 `note` 字段**（不是 note 长度超过 400）。JS `note.length` 对此三项不适用。slot-1 的 note 均为空字符串 `""`（长度 0≤400）。
- **模型违反明确 exact-slice 约束 3 条（官方 code=`quote`）：** `ascend/00055` slot-2 `format-only` 的 `refQuote`/`hypQuote` 为 `运动。`，参考文本无 `。`；`cmn_hans_cn/1675` slot-1 `format-only` 的 `refQuote` 为 `即便`，参考为 `即使`（候选才有 `即便`）；`cmn_hans_cn/1680` slot-2 `format-only` 的 `hypQuote` 为 `5倍`，不在 slot-2 假设中（在 slot-1）。均为精确切片失败，禁止改 quote 放行。

是否确有代码缺陷：

- **pack `parse.js` / `verdict-contract.js` / 已发送 system prompt：未发现与这 15 条失败相关的实现不一致。** 发送 system 的 sha256 与 plan `promptTemplateSha256`=`a2e82f86…220923` 一致；schema 要求 slots 为长度 2 的数组、键含 `note`、quote 必须是参考/同槽候选的精确切片、note≤400。官方拒绝符合合同。
- **请求包装：72 条请求均为 `model/temperature/seed/max_tokens/messages`，system 为 v2 contract，未见把对象 slots 或 v1 提示混入本轮。**
- **响应提取：完整 finish=stop 的 14 条失败，存储 content 以 `{` 起、无 fence，内部语法或字段/切片问题，不像抽错网关字段。** 1 条 `finish_reason=error` 只有部分文本被存入 `content`——这是 QA/传输层的**可观察性缺口**（仍把不完整文本交给 parser，官方 code 只表现为 `bad-json`；`usage.complete=true` 因已有 token 计数，易被误读为完整成功）。**这不是把合法完整判决判失败，也不是可回填的解析 bug。** 证据：sidecar `finishReason=error`、`providerUsd=0`、content 以 `"hyp` 截断、http 200。

后续最小建议（**本轮不执行**）：

1. 保持官方 v2 partial 与分数不动；不把任何 diagnostic derived 回填。本诊断无无损可回放通过项。
2. 若日后要补洞，只对失败的评委×条目付费重跑（14 个 item、15 次请求），不要重跑已官方有效的 57 条；须另授权预算，且不得与本诊断 derived 混用。当前剩余计划额度仅作记账备忘，本文件不启动请求。
3. 可选的未来 QA（非本轮开发）：sidecar/`parsed` 保留 `finishReason`；当 `finish_reason=error` 或 content 未闭合时使用单独 code（如 `provider-error`），避免只显示 `bad-json`。禁止自动修 JSON/quote/note。
4. 对外说明：官方 `note` 失败包含「缺字段」；aux `notComparable=17` 含 14 未解析 + 3 双解析弃权，不是 17 条未解析。`semanticHumanReviewed` 仍为 false。

## 原件 hash 与 parser 重放

| 钉扎 | sha256 | 一致 |
| --- | --- | --- |
| tarball | `e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002` | 是 |
| RESULT | `580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc` | 是 |
| summary | `4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f` | 是 |
| usage | `2c72567b6f04191536f84fdb42dda3971082fcb6bb561c3b53ae184478126da1` | 是 |
| human-review | `b034c87c8fc841a32e99d20967a011bf7621165bba08cfbc0f2f2fe77889c453` | 是 |
| assignment | `3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470` | 是 |
| formal-config | `e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180` | 是 |
| pack-gz | `a81afb949cc3e7ebc807e7ac90e88b6cd520220bd519641ec3051876d3ee3f92` | 是 |
| input | `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1` | 是 |
| frozen-input-judge-prep | `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1` | 是 |

重放：judge-a parsed=34 fail=2（官方 34/2）；judge-b parsed=23 fail=13（官方 23/13）；双有效=22（官方 22）。与官方 parsed 文件逐条 code 一致：是。

发送 system prompt sha256=`a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`，与 plan.promptTemplateSha256 一致：是；72 条 system 完全相同：是。

## 逐条失败

| 评委 | item | 官方 code | finish_reason | out/max tok | provider | 分类 | 关键证据（切片/长度） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| judge-a | fleurs-public-candidates/cmn_hans_cn/1671 | bad-json | stop | 451/2048 | OpenAI | model-invalid-json-unquoted-key | missing opening quote on key reason at 460: "hypQuote":"",reason":; JSON.parse position 474: Expected double-quoted property name in JSON at position 474 (line 1 column 475); content 1621 chars / 1749 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=451/2048 |
| judge-a | fleurs-public-candidates/en_us/1673 | bad-json | stop | 328/2048 | OpenAI | model-invalid-json-extra-closer-after-slot-1 | extra } after slot-1 at index 742; JSON.parse position 746: Expected ',' or ']' after array element in JSON at position 746 (line 1 column 747); content 1399 chars / 1407 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=328/2048 |
| judge-b | ascend/00009 | bad-json | stop | 413/2048 | Nebius | model-invalid-json-extra-closer-after-slot-1 | extra } after slot-1 at index 964; JSON.parse position 968: Expected ',' or ']' after array element in JSON at position 968 (line 1 column 969); content 1604 chars / 1676 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=413/2048 |
| judge-b | ascend/00028 | bad-json | stop | 334/2048 | Nebius | model-invalid-json-extra-closer-after-slot-1 | extra } after slot-1 at index 801; JSON.parse position 805: Expected ',' or ']' after array element in JSON at position 805 (line 1 column 806); content 1335 chars / 1383 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=334/2048 |
| judge-b | ascend/00055 | quote | stop | 309/2048 | Nebius | model-quote-not-exact-slice | slot-2#1 kind=format-only refQuote="运动。" (len=3, inRef=false, refIndex=-1) hypQuote="运动。" (len=3, inSameSlot=true, hypIndex=13, inSlots={"slot-1":false,"slot-2":true}) |
| judge-b | fleurs-public-candidates/cmn_hans_cn/1673 | bad-json | error | 137/2048 | Nebius | provider-or-gateway-incomplete | JSON.parse position 356: Unterminated string in JSON at position 356 (line 1 column 357); content 356 chars / 494 utf8 bytes; fence=false; illegalEscapes=0; finish=error out=137/2048 |
| judge-b | fleurs-public-candidates/cmn_hans_cn/1674 | note | stop | 178/2048 | Nebius | model-missing-required-note-field | slot-2 keys=[slot,abstain,confidence,findings] note absent; slot-1 note.length=0 utf8=0 (>400=false) |
| judge-b | fleurs-public-candidates/cmn_hans_cn/1675 | quote | stop | 455/2048 | Nebius | model-quote-not-exact-slice | slot-1#2 kind=format-only refQuote="即便" (len=2, inRef=false, refIndex=-1) hypQuote="即便" (len=2, inSameSlot=true, hypIndex=24, inSlots={"slot-1":true,"slot-2":true}) |
| judge-b | fleurs-public-candidates/cmn_hans_cn/1676 | note | stop | 150/2048 | Parasail | model-missing-required-note-field | slot-2 keys=[slot,abstain,confidence,findings] note absent; slot-1 note.length=0 utf8=0 (>400=false) |
| judge-b | fleurs-public-candidates/cmn_hans_cn/1680 | quote | stop | 669/2048 | Parasail | model-quote-not-exact-slice | slot-2#1 kind=format-only refQuote="五倍" (len=2, inRef=true, refIndex=43) hypQuote="5倍" (len=2, inSameSlot=false, hypIndex=-1, inSlots={"slot-1":true,"slot-2":false}) |
| judge-b | fleurs-public-candidates/cmn_hans_cn/1681 | bad-json | stop | 430/2048 | Parasail | model-invalid-json-duplicate-slot-key | duplicate slot key at 813: "slot": "slot": "slot-2"; JSON.parse position 827: Expected ',' or '}' after property value in JSON at position 827 (line 26 column 21); content 1700 chars / 1762 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=430/2048 |
| judge-b | fleurs-public-candidates/en_us/1670 | note | stop | 559/2048 | Parasail | model-missing-required-note-field | slot-2 keys=[slot,abstain,confidence,findings] note absent; slot-1 note.length=0 utf8=0 (>400=false) |
| judge-b | fleurs-public-candidates/en_us/1672 | bad-json | stop | 253/2048 | Parasail | model-invalid-json-extra-closer-after-slot-1 | extra } after slot-1 at index 631; JSON.parse position 635: Expected ',' or ']' after array element in JSON at position 635 (line 1 column 636); content 1014 chars / 1014 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=253/2048 |
| judge-b | fleurs-public-candidates/en_us/1673 | bad-json | stop | 361/2048 | Nebius | model-invalid-json-extra-closer-after-slot-1 | extra } after slot-1 at index 701; JSON.parse position 705: Expected ',' or ']' after array element in JSON at position 705 (line 1 column 706); content 1509 chars / 1519 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=361/2048 |
| judge-b | fleurs-public-candidates/en_us/1680 | bad-json | stop | 295/2048 | Venice | model-invalid-json-extra-closer-after-slot-1 | extra } after slot-1 at index 697; JSON.parse position 701: Expected ',' or ']' after array element in JSON at position 701 (line 1 column 702); content 1184 chars / 1184 utf8 bytes; fence=false; illegalEscapes=0; finish=stop out=295/2048 |

分类计数：model-invalid-json-unquoted-key=1；model-invalid-json-extra-closer-after-slot-1=6；model-quote-not-exact-slice=3；provider-or-gateway-incomplete=1；model-missing-required-note-field=3；model-invalid-json-duplicate-slot-key=1。

无损提取/格式恢复：0 条。strip/fence/首尾对象切片均不能在不改 JSON 字节的前提下恢复合法对象。不生成 derived 判决，不修 quote/note/JSON。

## human-review 17+5+14 与 aux 倾向

- 17+5+14 与官方 human-review 文件一致，不是误读：17 为双有效 22 条中的 kind 列表不一致；5 为全部一致项（约定 sampleCount=6，但一致项只有 5，故抽样=全部一致项）；14 为至少一名评委官方无效的条目（36-22），其中 en_us/1673 双评委均失败，故失败判决 15 条对应 14 个 item。
- aux notComparable=17 若被读成「17 条未解析」则是误读。正确组成是 14 条至少一名未官方解析，加上 3 条双解析但至少一名弃权/不可比（en_us/1676、cmn_hans_cn/1679、ascend/00004，均为 judge-b abstain）。4+3+7+5=19 为双解析且可比较的倾向合计，19+3=22。本核验不改原件，也不把倾向当胜者或人审。

本诊断不做语义复核，不改 human-review 原件，不将 agent 审视记为 `semanticHumanReviewed`。

## 预算台账（不变）

累计计划 0.28，累计消耗 0.10094232，本诊断未产生新费用。

## 可复现命令

```
node /workspace/baseline-sa-sv-36-20261113/judge-prep/v2-offline-diag-20261114/scripts/diagnose-v2-failures.mjs
```

输出：`out/`、`fixtures/`、本 `REPORT.md`、`SHA256SUMS`、`MANIFEST.json`。证据树只读。

