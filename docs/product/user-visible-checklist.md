# 用户可见 checklist（真源）

BEL-126。这是「用户看得见的东西有没有在后一版里还在」的勾选真源。机器对照表在
`scripts/tip-user-visible-diff.sh`（标记与本表同一批路径）；怎么跑、收据放哪，见
[`docs/tip-user-visible-diff.md`](../tip-user-visible-diff.md)。硬规则见
[`docs/release-checklist.md`](../release-checklist.md)「主干先行」。

## 什么时候勾

大合入之前，以及从 main **新切 marketing / 提审 tip** 之前，用**上一正式上架** tip 当
BASE 勾本表。上一正式上架 = App Store 上曾经或正在 `READY_FOR_SALE` 的那个 tip，
不从仓库的 tag 或 README 推断（`AGENTS.md`「Release state」）。

每一行都是可勾的。勾上表示：这一项在本 tip 上仍在，**或者**已有产品卡写明补回或退役。

## 丢了怎么办

本表有、后一 tip 没有，叫做丢。丢了**不得静默放行**：

- 缺产品卡 → 不得 Submit。
- 曾上架（含曾经 `READY_FOR_SALE`）的项必须仍在 **main 祖先**上。只活在提审 tip、
  main 祖先里没有，视同未入库。架构形检核的就是这一句：「用户可见是否在 main 祖先」。

已知一次丢法（收据，不是补回）：`aac5a87d`（1.21.2）相对 `ecd8b8b4`，下面 D-02 起
各行的标记在后一 tip 上为 MISSING。BEL-122 另轨补回语言包屏，本文件不改 app 代码。

## 不在本表

旧的 `quotaHalt` 不恢复。N26 取代它。不要为了「对齐旧 tip」把它勾回来。

## 语言包屏

- [ ] **D-02 整体进度**（细条 / `% · MB` / CTA「下载中 {n}%」）
  - 细条宿主：`src/app/AppShell.jsx` 的 `packs-dl-progress`（`paintDlProgress` 维护，`src/app/shell-model.js`）
  - 文案：`firstrun_packs_progress_pct`（`{pct}% · 约 {size}`）、`firstrun_packs_busy_pct`（`下载中 {n}%`）
  - 汇总：`aggregatePackProgress`（`src/app/pack-progress.js`）
  - 曾上架须在 main 祖先

- [ ] **D-03 齐了就离开包屏**
  - 符号：`dismissPacksAfterDone`（`src/app/shell-model.js`）
  - 曾上架须在 main 祖先

- [ ] **N24 M-01…04 文案锁 / 包与设置的信息架构**
  - M-01：`src/app/shell-model.js` 注释 `N24 M-01`（行右态仅「未下载 / 已就绪」）
  - M-02：同文件 `N24 文案锁 M-02`（未勾行不显示进度）
  - M-03：`src/app/settings-view.jsx` `N24 M-03`（「语言包与朗读」日常块）
  - M-04：同文件 `N24 M-04`（端点 / 引擎模型名收进「高级参数」）
  - 曾上架须在 main 祖先

## 设置：一键与分项

- [ ] **一键 ⇄ 分项切换确认**
  - `src/app/settings-view.jsx` 与 `src/pages/options.jsx`
  - 文案键：`opt_mode_switch_to_quick`（改用一键会覆盖当前分项配置）、`opt_mode_switch_to_detail`（改用分项会作废当前一键配置）
  - 曾上架须在 main 祖先

## 听译列表

- [ ] **句子序 P0-B：新 → 旧（最新在上）**
  - `src/app/listen-model.js`、`src/app/listen-view.jsx` 的 `P0-B`（展示序 `out.reverse()`，存储序仍旧 → 新）
  - 曾上架须在 main 祖先

## 字幕台

- [ ] **captionDesk**
  - `src/app/layout-caption.js` 的 `captionDesk`（`captionDeskBand`；非 desk 返回空）
  - 曾上架须在 main 祖先

## Duo

- [ ] **Duo-06 门控徽章**
  - `src/app/listen-view.jsx` 的 `Duo-06`（门控灰态角标）
  - 曾上架须在 main 祖先

- [ ] **Duo-08 安全区 +12**
  - `app/style.css` 的 `Duo-08`（录音键左缘 = 竖条右缘 + 12pt）
  - 曾上架须在 main 祖先

## 泰语听译

- [ ] **泰语听译（国际版；中国包剥掉）**
  - 国际版源码必须在：`thaiGrokStt` 于 `src/app/listen-model.js` 与 `app/grok-stt.js`；模块表 `INTL_GROK_MODULES`（`build/app-bundle.js`）
  - 中国包剥扫是另一件事，不是把功能从源码里删掉：`build/china-gate.js` 拦 `grok-stt-open`（以及 `api.x.ai`）。源码里没有 `thaiGrokStt` = 国际版也丢了，不是「中国剥过所以可以没有」
  - 曾上架须在 main 祖先（国际版）
