# TEMPLATE · QD-JUDGE-submit（提审合裁总装）

**用途**：每一份 `QD-JUDGE-submit-*`（或同等提审合裁）**必须**按本表填裁，或在文首显式引用本模板并逐门对勾。  
**生效**：order-rd-template-qd-judge-submit · 用户卡 t1265u · 对齐 bel123 缺项④ / bel125-126 ACCEPT 缺口③。  
**时区**：裁决时间写 Asia/Shanghai。

本文件是质量侧总装（仓内真源）。分闸说明：

| 闸 | 仓内说明 |
|---|---|
| BEL-124 tip-diff | [`docs/tip-user-visible-diff.md`](../tip-user-visible-diff.md) · 脚本 `scripts/tip-user-visible-diff.sh` |
| BEL-125 main-first | [`docs/main-first-scan.md`](../main-first-scan.md) · 脚本 `scripts/main-first-user-visible-scan.sh` |
| BEL-126 大合入两证 | [`docs/product/user-visible-checklist.md`](../product/user-visible-checklist.md)「强制合入门」· [`docs/release-checklist.md`](../release-checklist.md) |
| 箱质量闸镜像 | `/workspace/qd-gates/TEMPLATE-QD-JUDGE-submit.md` + BEL-124/125/126 分闸文 |

---

## 何时挂

- 产品开出 `order-submit-*` / ASC Submit 回执后的质量合裁
- 任何自称「提审合裁」「Submit QD」的 `QD-JUDGE-submit-*`
- **不**替代冒烟 QD、合入 QD、形检；那些另挂。本表只管提审硬门合裁。

---

## 总裁规则

1. **缺任一适用硬门证 → 不得 PASS，也不得 PASS-WITH-ACCEPT。**  
2. **ACCEPT** 只留给：有完整硬门收据之后的**范围残差**（例：令写明只提三端、第四端旁观不挡；有 tip-diff 但 MISSING 已有产品卡退役）。  
3. **不得**用 ACCEPT 掩盖缺证、冒充四端全过、或跳过 README / tip-diff /（适用时）main-first /（适用时）大合入两证。  
4. tip-diff / main-first 仍是**标记代理** ≠ 完整行为 / 视觉 QA（既有 ACCEPT；本总装不宣称永久堵住防丢）。

---

## 硬门表（合裁时逐行填）

| # | 门 | 证路径或命令 | 缺证裁 | 有证但异常裁 | 本拍裁（填） |
|---|---|---|---|---|---|
| 1 | **README 闸** | GitHub 根 README 已覆盖本 marketing / tip 用户可见范围；产品认 PASS 记证（常引合入 README 的 PR# / tip） | **BLOCKED** 至 README 补齐 + 产品认；未过不得进 Submit 合裁 PASS | 覆盖不足 / 未认 = **BLOCKED** | |
| 2 | **BEL-124 tip-diff** | `bash scripts/tip-user-visible-diff.sh <RFS_TIP> <SUBMIT_TIP>` → `docs/status/tip-user-visible-diff-<BASE8>-vs-<HEAD8>.md`（BASE=上一正式上架 RFS tip；HEAD=本提审 / 二进制 tip） | **BLOCKED**，不得 PASS / PASS-WITH-ACCEPT | MISSING 未解释（无产品卡补回/退役）= **BLOCKED** 或 **FAIL** | |
| 3 | **BEL-125 main-first**（**条件门**） | **当**本拍宣称「上架 IA / 用户可见已在 main」或「从 main 落条」：`bash scripts/main-first-user-visible-scan.sh <RFS_TIP> [MAIN_REF]` → `docs/status/main-first-scan-<BASE8>-vs-<MAIN8>.md` | 宣称 main-first 却**缺收据** → **BLOCKED** | MISSING / 非祖先：由 QD 解释或 **BLOCKED/FAIL**；脚本不 fail exit，**缺证**才硬 BLOCK | |
| 3b | BEL-125 N/A | 若路径**不**宣称 main-first：本行写 **N/A** + 一行理由（禁止静默跳过） | — | 静默跳过 = 不合规 | |
| 4 | **BEL-126 大合入两证**（**条件门**） | **当**本 tip/PR 为大合入进 main 或 marketing 长驻分支：① tip-diff 收据 ② `docs/status/merge-user-visible-checklist-<BASE8>-vs-<HEAD8>.md` 盖章 | **缺任一 → BLOCKED** | MISSING 未解释 / 无产品卡 = **BLOCKED** 或 **FAIL** | |
| 4b | BEL-126 N/A | 非大合入路径：本行写 **N/A** + 一行理由 | — | 静默跳过 = 不合规 | |
| 5 | **HEAD 钉** | 二进制 / ASC whatsNew tip 与令 tip 对齐说明；agent-only 未入包须显式写出 | tip / 包钉不清 → **BLOCKED** | 令 tip ≠ 包 tip 且未说明 = **BLOCKED** 或 **FAIL** | |
| 6 | **NO-PPO** | 未 Apply PPO；证或声明 | 已 Apply / 无声明且令禁 PPO → **FAIL** 或 **BLOCKED** | — | |
| 7 | **冒烟前置**（若产品令点名） | 点名之 `QD-JUDGE-smoke-*` = PASS **且** 产品已认 | 令点名却缺 / 未认 → **BLOCKED** | 冒烟 FAIL 未另令 = **BLOCKED** | |
| 8 | **ASC 四端表** | 每 lane：build · ASC state · submission id；子集 Submit 须显式 ACCEPT，**不得**冒充四端全过 | 宣称已 Submit 却无 state/id → **BLOCKED** | 未提端须单列 ACCEPT（范围残差），不可写成 PASS 四端 | |

### 条件门怎么勾

- **BEL-125**：看产品令 / 研发回执是否写「上架 IA 已在 main」「从 main 落条」「主干先行」。有 → 必须收据；无 → 3b N/A+理由。  
- **BEL-126**：看本 tip 是否合大功能进 main / marketing，或产品自称「大合入」。是 → 两证；否 → 4b N/A+理由。  
- 同一 PR 既大合入又提审：**124 + 126 都挂**；若还宣称 main-first，**125 也挂**。

---

## 样例骨架（复制改包号）

```markdown
# QD-JUDGE-submit-<ver>-<tip8>

- **裁**：…
- **时间（Asia/Shanghai）**：…
- **令**：order-submit-… · 用户卡 …
- **marketing / order tip / TF tip**：…
- **总装**：本裁按 docs/quality/TEMPLATE-QD-JUDGE-submit.md

## 硬门表
| # | 门 | 裁 | 证 |
|---|---|---|---|
| 1 | README | PASS/BLOCKED | … |
| 2 | BEL-124 tip-diff | PASS/BLOCKED/FAIL | docs/status/tip-user-visible-diff-… |
| 3 | BEL-125 main-first | PASS/BLOCKED/N/A | 收据或 N/A 理由 |
| 4 | BEL-126 大合入两证 | PASS/BLOCKED/N/A | tip-diff + checklist 或 N/A 理由 |
| 5 | HEAD 钉 | PASS/BLOCKED | … |
| 6 | NO-PPO | PASS/FAIL | … |
| 7 | 冒烟前置 | PASS/BLOCKED/N/A | … |
| 8 | ASC 四端 | PASS/ACCEPT/BLOCKED | 表见下 |

## 四端表
| lane | build | ASC state | submission id |
|---|---|---|---|

## ACCEPT（仅范围残差；缺硬证不得写 ACCEPT 顶 PASS）
…

## 禁
禁 Apply PPO；BEL-123/124/125/126 勿 Done；不宣称防丢闸永久堵住 / Submit 解 HOLD。
```

---

## 禁（常备 · 写入每份 JUDGE）

- **禁** Submit / Apply PPO（本模板与合裁本身不授权 Submit）
- **BEL-123 / 124 / 125 / 126 勿 Done** 至验收勾齐（本总装落地 ≠ Issue Done）
- **不宣称**防丢闸「已永久堵住」或 Submit **解 HOLD**
- tip-diff / main-first = 标记代理，≠ 完整行为验

---

## 修订

| when (Asia/Shanghai) | what |
|---|---|
| 2026-10-29 23:54 | 初版 · 收 README · 124 · 125 · 126 · 既有 submit 口径于一表（t1265u） |
