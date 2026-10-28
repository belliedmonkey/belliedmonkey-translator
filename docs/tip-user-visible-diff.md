# 提审 tip 的用户可见 diff（BEL-124）

上一正式上架 tip 和本提审 tip 之间，用户看得见的东西丢了没有，用脚本对一遍，留下一份
收据。勾选真源是 [`docs/product/user-visible-checklist.md`](product/user-visible-checklist.md)。
「必须先合 main 再落条」这条硬规则在 [`docs/release-checklist.md`](release-checklist.md)
「主干先行」。

## 怎么跑

在仓库根目录：

```bash
bash scripts/tip-user-visible-diff.sh <BASE_TIP> <HEAD_TIP>
```

- `BASE_TIP`：上一正式上架 tip 的 SHA（App Store 曾经或正在 `READY_FOR_SALE` 的那一版）。短 SHA 可以，脚本会 `git rev-parse` 成完整提交。
- `HEAD_TIP`：这次要提审 / 要切 marketing 的 tip。

BASE 必须是**还带着这些用户可见项的那一版**。如果 BASE 和 HEAD 都已经把标记丢了，
收据里该行是 ABSENT（两边都没有），看不出「从上一上架掉下来」这件事。

## 输出路径

```
docs/status/tip-user-visible-diff-<BASE8>-vs-<HEAD8>.md
```

`<BASE8>` / `<HEAD8>` 是解析后 SHA 的前 8 位。脚本覆盖同名文件。收据里每一行标记是
下面四种之一：

| 状态 | 含义 |
|---|---|
| PRESENT | BASE 和 HEAD 都有这个标记 |
| MISSING | BASE 有，HEAD 没有（丢了） |
| NEW | HEAD 有，BASE 没有 |
| ABSENT | 两边都没有（这组 SHA 对不上这条标记） |

标记和路径表在 `scripts/tip-user-visible-diff.sh` 顶部的 `MARKERS`。加 checklist
一行时，同一提交里给这张表加对应的路径和符号。路径都是仓库里真实存在过的文件
（语言包 / 设置 / 文案 / Duo / 字幕台 / 听译），不写占位文件名。

## 质量硬闸

`QD-JUDGE-submit-*` 必须引用这份收据。没有收据 = **BLOCKED**，不得 PASS。
闸在质量侧；本仓库只规定收据的路径和跑法，不改质量仓里的模板。

示例收据（证明 D-02 一类项会标成 MISSING）：

`docs/status/tip-user-visible-diff-aac5a87d-vs-ecd8b8b4.md`

BASE `aac5a87d`（1.21.2），HEAD `ecd8b8b4`。HEAD 不在手头时用 `be19269f` 代替
（它是 `ecd8b8b4` 的后裔，同一批标记同样不在）。
