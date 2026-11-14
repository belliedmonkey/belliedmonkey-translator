# 首轮双评委 partial 离线根因报告

生成时间：2026-11-13 23:36:13 Asia/Shanghai (UTC+8)
范围：只读已有 raw responses / 实际发送的 system+user / 冻结 pack 的 parse 与 rubric。不付费、不网络、不读 key、不碰 Mac、不改仓库、不改冻结证据、不回填原 run。
官方结果保持永久：`ok=false`，`code=partial`，`doubleBlindComplete=false`。本诊断不得宣称 36 条双盲完成。

## 1. 冻结原件哈希（未改）

- `package/01M7AJ65AKYJT2H26187ZDN7TW.gz`: `74258e362de80cf39986717b32b65ef6ec9d3719bd60d21b91af54c1d441a9fe` OK
- `input/input-asr-36.json`: `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1` OK
- `input/pair-manifest.json`: `2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7` OK
- `config/config.draft-openrouter-20261113.json`: `912305f81258ce801c16285816af06949d9dec81590a8adb2b296daa176a1600` OK
- `judge-run/summary.json`: `44d9be2d34f633815622754e4e6ee3535bf67bb6f059e5f67d9d237236eb1e7b` OK
- `judge-run/human-review.json`: `6dc6b18b2a95f158bff1e29e12df8514eaf5de497f4be3adf3d581b62cbc855a` OK
- `judge-run/assignment.json`: `3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470` OK
- `judge-run/plan.json`: `9a0d9f86ebbef41a3657f0e773c3cb9bb231c39fbc1b647f2f6d7cd69261ab81` OK
- `judge-run/usage.json`: `c4dcc906a14e460f32cee30e110a8f1bbebfdfffe295c73138349789a3652216` OK
- `ledger/RESULT.json`: `e1496fd413d4057b09ee75346c96d7da7cd85402c2f1a270d2fc40bf6ba5e0b6` OK
- 官方 `EXPECTED-SHA256.txt` 另列 provenance/tokenizers 路径，本证据树中未包含这些文件；未改 EXPECTED，也未补写那些文件。存在的 pack/input/pair/config 四项与 EXPECTED 一致。

## 2. Root cause：实际发送的提示没有可执行的 JSON 数组 schema / 示例

- 72 条 request 的 system 提示完全相同（1 份，1593 字符），且与 pack `rubric.js` 的 `ASR_RUBRIC` 逐字一致。`promptTemplateSha256=a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6`，与官方 summary 一致。
- 72 条 user 载荷形状相同：JSON 对象，键为 `untrusted, itemId, reference, candidates`；`candidates` 是长度为 2 的**数组**，元素为 `{slot, text}`。
- system **没有** JSON 示例、没有代码围栏、没有 “JSON array / is an array / slots is an array” 字样。
- 关键句是歧义的：`slots has one object for slot-1 and one for slot-2.` 既可以读成「数组里各有一个对象」，也可以读成「以 slot-1 / slot-2 为键的对象」。紧接着的 “The object keys are only schema, itemId, and slots” 还强化了「用对象键组织」的读法。
- “findings to be an empty array” 只约束 abstain 时的 findings，不是 slots 的示例。
- 解析器要求 `slots` 必须是长度为 2 的数组，但该约束只写在 `parse.js`，没有写进发送给模型的 rubric。
- `note` / `reason` 的 400 字符上限同样只在 `parse.js`，发送提示中完全没有 “400”。
- 允许的 kind 列表写在了提示里（format-only, entity, number, negation, semantic, omission, addition），其中**没有** punctuation。

结论：提示对 slots 的形状是歧义且缺少可执行示例的；这足以诱导对象形态。这是协议/提示缺陷，不是后处理改 quote 能补的。

## 3. GPT（judge-a）35 条 slots 对象 + 1 条 bad-json

- 官方：0/36 解析成功。35 条 `code=slots`，1 条 `code=bad-json`（`ascend/00066`）。
- 35 条可解析 JSON 的顶层键均为 `schema, itemId, slots`，`schema=belliedmonkey.llm-judge.verdict.v1`，`slots` 全部是对象，键恰好为 `slot-1` 与 `slot-2`。
- 70 个内层对象的键均为 `slot, abstain, confidence, note, findings`，且内层 `slot` 与对象键一致。无键冲突，无缺 identity。
- 全样本同一形状，与歧义句一一对应，判定为 **prompt 歧义诱导**，不是偶发格式噪声。

### `ascend/00066` bad-json 的真实结构

- 不是合法 JSON，不能做 object→array 适配，也不能靠删括号「修好」后当有效判决。
- 文本以 `"slots":{"slot-1":{...` 开始，即仍想写成对象形态。
- JSON.parse 失败：Expecting ',' delimiter；第一个非法关闭是位置 513 的多余 `]`。窗口为 `tion differences"}]}],"slot-2":{"slot":"`，即 slot-1 对象结束后出现 `}]}],"slot-2"`（对象关闭后再多一个数组关闭符）。这是对象/数组标点混用。
- 全文扫描 **没有** 非法 JSON 转义（先前摘要里 raw 尾部的 `\'哦\'` 是 Python `repr` 对普通单引号的写法，不是 JSON 里的反斜杠）。
- 结束深度依赖这个多余括号才回到近乎配对；不得删除该 `]` 来发明判决。此条必须新判断。

### 形状可适配但官方 quote 仍失败：`fleurs-public-candidates/cmn_hans_cn/1681`

- 35 条对象形态中有 34 条在 object→array 之后通过官方 parse + 独立 quote 复核；本条形状适用且可逆，但适配后 official/diagnostic code=`quote`，保持 null。不得改 quote 回收。
- slot-2 finding 2：kind=`semantic`，`refQuote='提出问题及进行观察，也可以指导科学研究。'` 在 reference 中不存在。reference 对应片段是 `提出问题及进行观察也可以指导科学研究。`（「观察」与「也可以」之间没有 U+FF0C 全角逗号）。该逗号出现在 slot-1 候选中；本 refQuote 把 reference 的「及」与另一槽的逗号拼成了 reference 与 slot-2 都不含有的字符串。
- 这是真实切片缺陷，只是先前被 `slots` 形状错误挡住、在合法形状适配后才暴露。不是规则过严。judge-b 本条官方已通过。必须新判断 judge-a。

## 4. Qwen（judge-b）4 条失败：内容/规则对照（未放宽，未改 quote）

官方：32/36 解析成功。失败 4 条如下。独立按官方 `isSlice`（精确子串）和 kind 白名单、note.length<=400（JS UTF-16 长度）复核，不把近匹配当作通过。

### `ascend/00028` — official code `note`（真实超长，不是 quote 问题）

- slot-1 `noteLen=429`（Python 码点与 JS UTF-16 均为 429）> 400；slot-2 为 284，未超。
- 两条 findings 的 quotes 均为精确切片，kind=`entity` 合法。
- 400 上限未写进发送提示，这是 **提示未声明、解析器单独强制** 的限制，不是「过严的 quote 规则」，也不是虚构的切片错误。
- **严禁截断 note 冒充有效**。不可无损恢复，必须新判断。建议在未来新版提示中写明上限。

### `ascend/00055` — official code `quote`（真实切片缺陷）

- slot-2 finding：kind=`format-only`，`refQuote=hypQuote='运动。'`（「运动」+ U+3002 IDEOGRAPHIC FULL STOP）。
- 该串在 slot-2 候选中存在，在 **reference 中不存在**。reference 为 `um运动啊男生一般不都喜欢运动`，含「运动」但不含句号；句号只出现在 slot-2 候选末尾。
- 近匹配不能代替精确切片。不得把 quote 改成「运动」或把句号从 reference 侧删掉来掩盖错误。这是真实内容缺陷，不是规则过严。必须新判断。

### `fleurs-public-candidates/cmn_hans_cn/1680` — official code `quote`（真实张冠李戴）

- slot-2 finding 1：kind=`format-only`，`refQuote='五倍'`（在 reference 中）但 `hypQuote='5倍'` **不在 slot-2 候选中**。
- slot-2 候选写的是「五倍」；「5倍」出现在 **slot-1** 候选。模型把另一槽的数字/汉字对照写到了本槽。
- 不是空白/大小写近匹配。不得对调 slot 或改写 hypQuote 来补救。真实内容缺陷。必须新判断。

### `fleurs-public-candidates/en_us/1675` — official code `finding-kind`（非法 kind）

- slot-2 finding 1：`kind=punctuation`，`refQuote=hypQuote='.'`，二者都是精确切片。
- `punctuation` 不在提示给出的 7 个允许 kind 中，解析器拒绝是与已发送 rubric 一致的，不是额外暗规则。
- **不得把 punctuation 改标为 format-only** 来回收结果。即便该现象在别的标签下或许可写，也只能留给新判断，不能改官方输出。必须新判断。

对官方已通过的 32 条 Qwen 判决，用同一套官方 parse + 独立 isSlice 复核，无额外 quote 失败（与官方 parsed 一致）。未放宽、也未收紧规则。

## 5. 候选规范：纯形状一对一可逆 object→array（不回填、不按赢家挑规则）

规范名：`belliedmonkey.llm-judge.slots-object-to-array.candidate.v1-diag`。状态：post-hoc-format-adaptation-candidate; not frozen original protocol; not a formal pass。

### 适用条件（须全部满足）

- Input text is valid JSON and the root is a plain object.
- Root keys are a subset of {schema, itemId, slots}; extra root keys are not stripped (official parse may then fail score-field).
- slots is a plain object (not an array, not null).
- slots has exactly the keys slot-1 and slot-2 (both present, no other keys).
- Each value is a plain object (not an array, not null).
- Slot identity is unique and complete: if an inner object has a slot field, it must equal the object key; if it lacks a slot field, the adapter may insert slot equal to the object key only (identity, not scoring content). This official run already has matching inner slot fields on every adaptable object, so no insertion is required.
- The transform is slotsArray = [slots["slot-1"], slots["slot-2"]]. No other field is added, deleted, truncated, remapped, or rewritten (notes, findings, quotes, kinds, reasons, confidence, abstain stay byte-for-byte as parsed JSON values).
- The mapping is one-to-one reversible: objectFrom(array) keyed by inner slot equals the (identity-completed) original slots object.
- After the shape change, the official parseVerdict is applied unchanged. Quote, note, kind, reason, leak, item-id, and remaining checks are not relaxed. A later parse failure stays null.

### 反例 / 拒绝条件（任一条即拒绝，失败保持 null）

- Invalid JSON (including mixed object/array punctuation). Do not delete or insert brackets, do not unescape, do not guess a repaired document.
- slots is already an array, is missing, or is not a plain object.
- Object keys are not exactly {slot-1, slot-2} (missing, extra, or renamed keys). Do not drop extra keys; that would delete content.
- A value is not a plain object.
- Object key conflicts with the inner slot field (e.g. key slot-1 but inner slot is slot-2 or any other string).
- Duplicate slot identity after conversion.
- Any rewrite of quotes (including whitespace/punctuation near-misses), truncation of note or reason to meet the 400 cap, remapping of finding-kind (including punctuation -> format-only), or adding/removing findings.
- Using the adapter to backfill official summary/human-review or to claim doubleBlindComplete under the frozen v1 protocol.

本 run 的 35 条 GPT 对象形态满足适用条件（内层已有一致 slot，无需插入 identity）。`ascend/00066` 与全部 Qwen 内容失败都不适用。

## 6. 事后格式适配诊断计数（非冻结协议正式通过）

标签：**事后格式适配 / 非冻结原 protocol 正式通过 / 仍不能宣称 36 双盲完成。** `semanticHumanReviewed=false`。

### 两评委官方有效（冻结协议）

- （空）0 条。官方没有任何一条同时通过双评委。

### 可无损恢复（仅诊断：GPT object→array 后官方 parse+quote 通过，且未改判分内容）

共 34 条 judge-a：
- fleurs-public-candidates/en_us/1668
- fleurs-public-candidates/cmn_hans_cn/1668
- fleurs-public-candidates/en_us/1669
- fleurs-public-candidates/cmn_hans_cn/1669
- fleurs-public-candidates/en_us/1670
- fleurs-public-candidates/cmn_hans_cn/1670
- fleurs-public-candidates/en_us/1671
- fleurs-public-candidates/cmn_hans_cn/1671
- fleurs-public-candidates/en_us/1672
- fleurs-public-candidates/cmn_hans_cn/1672
- fleurs-public-candidates/en_us/1673
- fleurs-public-candidates/cmn_hans_cn/1673
- fleurs-public-candidates/en_us/1674
- fleurs-public-candidates/cmn_hans_cn/1674
- fleurs-public-candidates/en_us/1675
- fleurs-public-candidates/cmn_hans_cn/1675
- fleurs-public-candidates/en_us/1676
- fleurs-public-candidates/cmn_hans_cn/1676
- fleurs-public-candidates/en_us/1677
- fleurs-public-candidates/cmn_hans_cn/1677
- fleurs-public-candidates/en_us/1678
- fleurs-public-candidates/cmn_hans_cn/1678
- fleurs-public-candidates/en_us/1679
- fleurs-public-candidates/cmn_hans_cn/1679
- fleurs-public-candidates/en_us/1680
- fleurs-public-candidates/cmn_hans_cn/1680
- fleurs-public-candidates/en_us/1681
- fleurs-public-candidates/en_us/1682
- fleurs-public-candidates/cmn_hans_cn/1682
- ascend/00004
- ascend/00009
- ascend/00028
- ascend/00055
- ascend/00068

其中适配后仍被官方规则拒绝的 judge-a：fleurs-public-candidates/cmn_hans_cn/1681
judge-a 完全不能适配（bad-json 等）：ascend/00066

### 诊断意义上双评委都有效（GPT 适配通过 **且** Qwen 官方已通过）

共 30 条：
- fleurs-public-candidates/en_us/1668
- fleurs-public-candidates/cmn_hans_cn/1668
- fleurs-public-candidates/en_us/1669
- fleurs-public-candidates/cmn_hans_cn/1669
- fleurs-public-candidates/en_us/1670
- fleurs-public-candidates/cmn_hans_cn/1670
- fleurs-public-candidates/en_us/1671
- fleurs-public-candidates/cmn_hans_cn/1671
- fleurs-public-candidates/en_us/1672
- fleurs-public-candidates/cmn_hans_cn/1672
- fleurs-public-candidates/en_us/1673
- fleurs-public-candidates/cmn_hans_cn/1673
- fleurs-public-candidates/en_us/1674
- fleurs-public-candidates/cmn_hans_cn/1674
- fleurs-public-candidates/cmn_hans_cn/1675
- fleurs-public-candidates/en_us/1676
- fleurs-public-candidates/cmn_hans_cn/1676
- fleurs-public-candidates/en_us/1677
- fleurs-public-candidates/cmn_hans_cn/1677
- fleurs-public-candidates/en_us/1678
- fleurs-public-candidates/cmn_hans_cn/1678
- fleurs-public-candidates/en_us/1679
- fleurs-public-candidates/cmn_hans_cn/1679
- fleurs-public-candidates/en_us/1680
- fleurs-public-candidates/en_us/1681
- fleurs-public-candidates/en_us/1682
- fleurs-public-candidates/cmn_hans_cn/1682
- ascend/00004
- ascend/00009
- ascend/00068

这 **不是** 官方双盲完成。不得写入原 summary / 不得回填。

### 必须新判断（至少一名评委即使在合法形状适配后仍为 null）

共 6 条：
- fleurs-public-candidates/en_us/1675
- fleurs-public-candidates/cmn_hans_cn/1680
- fleurs-public-candidates/cmn_hans_cn/1681
- ascend/00028
- ascend/00055
- ascend/00066

拆分：judge-a 不可恢复：ascend/00066, fleurs-public-candidates/cmn_hans_cn/1681；judge-b 必须重评：fleurs-public-candidates/en_us/1675, fleurs-public-candidates/cmn_hans_cn/1680, ascend/00028, ascend/00055。

### 分歧 / 抽样 / 人工审

官方 `human-review.json`：`semanticHumanReviewCount=0`，`disagreement=[]`，`sample=[]`，`notAssessed` 为全部 36 条（因为没有任何 official both-ok）。本诊断视 `semanticHumanReviewed=false`，未做人工语义审，不把 EAR 听评当作语义审。
对事后适配副本，用与 pack `reviewList` 相同的规则（按槽比较排序后的 kind 列表，含 abstain；seed=20261113，sampleCount=6）得到诊断 human-review（仍 `semanticHumanReviewCount=0`，`semanticHumanReviewed=false`）：
- disagreement：fleurs-public-candidates/en_us/1668, fleurs-public-candidates/cmn_hans_cn/1668, fleurs-public-candidates/en_us/1669, fleurs-public-candidates/cmn_hans_cn/1669, fleurs-public-candidates/en_us/1670, fleurs-public-candidates/cmn_hans_cn/1670, fleurs-public-candidates/cmn_hans_cn/1671, fleurs-public-candidates/en_us/1673, fleurs-public-candidates/cmn_hans_cn/1673, fleurs-public-candidates/en_us/1674, fleurs-public-candidates/cmn_hans_cn/1674, fleurs-public-candidates/cmn_hans_cn/1675, fleurs-public-candidates/cmn_hans_cn/1676, fleurs-public-candidates/en_us/1677, fleurs-public-candidates/cmn_hans_cn/1677, fleurs-public-candidates/en_us/1678, fleurs-public-candidates/cmn_hans_cn/1678, fleurs-public-candidates/en_us/1680, fleurs-public-candidates/en_us/1681, fleurs-public-candidates/en_us/1682, fleurs-public-candidates/cmn_hans_cn/1682, ascend/00004, ascend/00009, ascend/00068
- sample（仅从诊断 agreed 中抽，待审，未评）：fleurs-public-candidates/en_us/1672, fleurs-public-candidates/cmn_hans_cn/1679, fleurs-public-candidates/en_us/1676, fleurs-public-candidates/cmn_hans_cn/1672, fleurs-public-candidates/en_us/1679, fleurs-public-candidates/en_us/1671
- notAssessed：fleurs-public-candidates/en_us/1675, fleurs-public-candidates/cmn_hans_cn/1680, fleurs-public-candidates/cmn_hans_cn/1681, ascend/00028, ascend/00055, ascend/00066
上述 disagreement/sample 只用于诊断，不是官方待审清单的更新。正式人工审仍应在未来授权的官方有效双评委结果上进行。

## 7. 需要重评的数量与未用预算（仅估算，未发请求）

官方剩余计划预算：`planRemainingUsd=0.19429628`（`planConsumedUsd=0.05570372`，其中 probes 0.00589824 + judge settled 0.04980548）。本步 **没有** 发出任何推理请求。

信封预留（官方 prices）：GPT `0.00405504` / 次，Qwen `0.0018432` / 次。

### A. 若要在冻结原协议下正式完成 36 双盲（不承认事后适配为正式通过）

- 需重评：judge-a 全部 36 次 + judge-b 失败 4 次 = 40 次请求。
- 预留合计：`0.15335424`。剩余预算是否覆盖预留：是，余量 `0.04094204`。
- 按首轮每模型已结算均值的**预期**花费：`0.03556228`（非保证，仅估算）。

### B. 若只重评诊断上不可无损恢复的评委/条目

- judge-a：fleurs-public-candidates/cmn_hans_cn/1681, ascend/00066
- judge-b：fleurs-public-candidates/en_us/1675, fleurs-public-candidates/cmn_hans_cn/1680, ascend/00028, ascend/00055
- 预留合计：`0.01548288`，剩余是否覆盖预留：是。
- 按均值预期：`0.003657171`。即便做完 B，那 34 条形状适配且校验通过的 GPT 诊断结果仍不是冻结协议正式通过，也仍不能宣称 36 双盲完成。

未改 Latin 规则，未改原 ASR 分。未展开 DeepSeek，未改 Linear，未对外发消息。

## 8. 可复现单命令

```
node /workspace/baseline-sa-sv-36-20261113/judge-prep/offline-diag-20261113/replay-derived-diag.js
```

输出只写在 `/workspace/baseline-sa-sv-36-20261113/judge-prep/offline-diag-20261113/out/`（QA 诊断，非仓库、非生产、非官方证据覆盖）。脚本结束前再次核对冻结哈希。

主要产物：`REPORT.md`、`MANIFEST.json`、`SHA256SUMS`、`spec-object-to-array.json`、`FIX-SUGGESTIONS.md`、`fixtures-min/failure-summaries.json`、`replay-derived/`（含 LABEL 与适配后的 parse 结果）。

