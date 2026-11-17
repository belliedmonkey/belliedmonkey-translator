# merge-user-visible-checklist-22f2b3cb-vs-50bcca5f

- date: 2026-11-17 19:46 Asia/Shanghai
- BASE (RFS): 22f2b3cb4954dfcf34a953bee278f9cac4de9795（上一正式上架 tip，v1.23.3）
- HEAD (merge): 50bcca5fd3b9bdf31621310511ba05d6faafcc2d（release/1.23.4 → main 合并提交）
- 已按 docs/product/user-visible-checklist.md 勾完
- 机器收据路径: docs/status/tip-user-visible-diff-22f2b3cb-vs-50bcca5f.md
- 机器收据结论: PRESENT 22 · MISSING 0 · NEW 0 · ABSENT 0
- 执行人: 大肚猴翻译质量总监（OpenBot / QA）

## 勾选说明

- 本表 22 项在合并后的 tip 上全部 PRESENT，无 MISSING（无静默丢失）。
- 合并取向：release/1.23.4 为 1.23.3/1.23.4 出货实现，冲突默认取 release 侧；
  主干独有的 E1/BEL-19 与版本号（1.23.5）保留主干侧；13 语 `_locales` 取并集。
- 测试：`node test/run.js` → 3653 passed / 1 failed；唯一失败为
  「X10 三个 dist 比 HEAD 新」要求已打包 zip（本机工作区无 zip，与 release/1.23.4
  baseline 同一项、同一原因，非合并引入）。
