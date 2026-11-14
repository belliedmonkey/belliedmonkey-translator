# 正式 v2 人工语义复核说明（冻结判定标准）

本文只用于真人对照参考与匿名 slot 文本，复核两位评委的 findings。本准备目录不是已完成人审，不得把本说明或空表当作 `semanticHumanReviewed=true`。

## 何时评、何时不评

- 当前官方 v2 跑次的人审清单是**初始状态**：分歧 17 + 一致样本 5 + 未评估 14。这 14 条是至少一名评委官方无效、正待最多 15 次补评的条目。
- **现在不要评这 14 条待补项。** 补评成功后必须用同一套 `reviewList`（按槽位排序后的 finding kind 列表是否一致；弃权记为 `['abstain']`；再按 seed=20261113、sampleCount=6 从新的一致项抽样）刷新清单。一致集合变化后，样本集合也可能变化。
- 17+5 的空表已按当前双有效判决预备，便于查看格式与材料；**建议等补评刷新后再一次性送审**，以免评完又要按新清单补看。若有人在补评前先看了 17+5，补评后只补看新进入 divergence/sample 的条目，且不得把待补 14 条提前当完成。
- 以前的音字听审（听音频核字）**不是**本栏语义人审，不能迁移计数。`earReviewUsedAsSemanticReview` 必须保持 false，除非用户另行明确否定这一协议（本准备不改变该协议）。
- 只有用户本人（或用户明确指定的真人）在空表上完成标注并确认后，才能把对应条目计为语义已审。任何 agent / 自动脚本不得代填结论，不得把模型或本诊断的判断写入人审字段。
- 本复核不改官方 ASR 分数、不改拉丁/语气词规则、不评选胜者、不把 aux 倾向当结论。

## 你看到的材料

每份空表包含：

- 匿名 `itemId`、参考文本 `reference`、`slot-1` / `slot-2` 的候选文本（只有槽位名，没有系统名或产品名）。
- 两位评委的官方有效判决：每槽的 `abstain`、`confidence`、`note`，以及每条 finding 的 `kind`、`refQuote`、`hypQuote`、`reason`。
- 空的 `humanAnnotation` 字段，供你填写。`semanticHumanReviewed` 在空表里保持 `false`，完成确认前不要改官方计数。

不要尝试根据写法和风格猜测哪条是哪个系统。不要把槽位还原成产品名。

## 冻结 v2 判定标准（评委合同，也是你复核的尺度）

依据已发送的 v2 system / `verdict-contract.js`（prompt sha256 `a2e82f86…220923`），不是 v1。

- 评委没有听音频，只比较参考与两条匿名候选。人审本栏同样以文本为准；听过音频的印象不能直接当作本表结论，更不能改参考去迁就候选。
- 不要改参考。括号里的拉丁字母、语气词（如 um）要保留，不能为了让候选看起来更近而丢掉。
- 不要用外部知识修补候选。若专名或数字可能只是写法不同、而仅凭这两个字符串无法判断，应倾向认为评委弃权是合理的。
- `format-only`：同一值的表面形式不同（如数字与汉字数字）。**值不同**则应是 `number`、`entity`、`negation` 或 `semantic`，不能把值变了还标成格式。
- `omission`：参考里有、候选里缺。`addition`：候选里有、参考里无。
- 每条非弃权 finding 的引用必须是**精确切片**：`refQuote` 必须是参考的连续子串，`hypQuote` 必须是**同一槽**候选的连续子串，不得借用另一槽，不得增删标点或近义改写。不能引用就应弃权，不得编造 quote。
- 合法 kind 仅七个：`format-only`、`entity`、`number`、`negation`、`semantic`、`omission`、`addition`。
- 官方双评委「一致 / 分歧」只比较每槽排序后的 kind 列表（弃权为 `abstain`），不比较 note 措辞。人审可以指出 kind 用错、quote 不精确、或该弃权却未弃权，即使官方已判「一致」。
- 不要要求评委或你自己给出 WER/CER/MER 或胜者。

## 如何填空表

对每个槽分别填写：

- `agreeJudgeAFindingKinds` / `agreeJudgeBFindingKinds`：`true` / `false` / `null`（未评请保持 null）。
- `comment`：简短说明不同意的理由（例如 quote 不是精确切片、把「即使/即便」这类不同用字标成纯格式、该弃权等）。
- `ownKindsIfDifferent`：仅当你认为官方 kind 列表不合适时，给出你的 kind 列表；不要编造新 quote 去「修好」官方判决。
- `overallComment`：整条的补充。
- `reviewerId` 与 `reviewedAtAsiaShanghai`（Asia/Shanghai 时区）在你实际评完该条后再填。

未评条目保持空字符串 / `null` / `false`（未审标记）。不要为了凑数而填写。

## 刷新

补评完成后，用新的官方 `human-review.json` 与有效判决重跑本目录脚本或后续刷新入口，再生成新空表。初始 17+5+14 不得冒充补评后的最终送审清单。
