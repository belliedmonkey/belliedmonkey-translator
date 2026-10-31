# 主干先行自动扫（BEL-125）

上架过的 IA / 用户可见项必须先在 **main**，再从 main 落条打版。人工 `git grep`
不够：本脚本对照「上一正式上架 tip」与 `origin/main`（或指定 MAIN_REF），写出机器收据。

勾选真源：[`docs/product/user-visible-checklist.md`](product/user-visible-checklist.md)。
硬规则：[`docs/release-checklist.md`](release-checklist.md)「主干先行」。
tip↔tip 提审硬闸（BEL-124）：[`docs/tip-user-visible-diff.md`](tip-user-visible-diff.md)。
提审合裁总装：[`docs/quality/TEMPLATE-QD-JUDGE-submit.md`](quality/TEMPLATE-QD-JUDGE-submit.md)。

## 怎么跑

```bash
bash scripts/main-first-user-visible-scan.sh <BASE_RFS_TIP> [MAIN_REF]
```

- `BASE_RFS_TIP`：上一正式上架 tip（App Store 曾/正 `READY_FOR_SALE`）。
- `MAIN_REF`：默认 `origin/main`，解析成 commit。

## 输出

```
docs/status/main-first-scan-<BASE8>-vs-<MAIN8>.md
```

收据含：

- BASE 是否为 MAIN 祖先（`git merge-base --is-ancestor`）
- 每条标记 PRESENT / MISSING / NEW / ABSENT（与 tip-diff 同义）
- BASE 上有的标记有多少也在 MAIN 上

标记表：`scripts/lib/user-visible-markers.txt`（与 `tip-user-visible-diff.sh` 共用）。

## 质量硬闸

宣称「上架过 IA 已在 main / 可从 main marketing 落条」的提审或打版路径：

- **必须**附本扫描收据
- **缺收据 = BLOCKED**，不得 PASS（含 PASS-WITH-ACCEPT）
- 脚本对 MISSING / 非祖先不 `exit ≠ 0`；裁决在 QD / 架构形检

示例收据：`docs/status/main-first-scan-aac5a87d-vs-78fc49fc.md`
（BASE `aac5a87d` 1.21.2 RFS tip vs `origin/main` @ `78fc49fc`）。
