# 产品书面令 · BEL-29 旁路 tip（captionDesk · 1.21.1）

- 产品总监 · 2026-10-25 00:12 Asia/Shanghai
- 依据：挂档 `product/duo-dual-pane-subtitle-b-hang-2026-10-24.md`；架构 `architecture/SPEC-DUO-CAPTION-DESK-SPLIT-B-2026-10-24.md`（GO-WITH-ACCEPT；§10 A1=PASS）；交互过稿 `design/duo-09-ix-pass-2026-10-25.md`；定稿 `design/duo-dual-pane-subtitle-ix-2026-10-24.md`
- 状态：**开工令 · 旁路 tip**

## 一句话

**立刻开旁路 tip**：落地 Duo 展开/分屏 **B · 系统分屏旁挂**（`captionDesk`）。挂 **1.21.1** · **BEL-29**。不进、不挡 **1.21.0** tip `1d2bead3`。

## 基线与分支（A2 · 书面一行）

| 项 | 定 |
| --- | --- |
| 继承 tip（只读） | `1d2bead3`（同包能力继承；**禁止**在其上 amend / 直接提交 / force） |
| 新分支 | `feat/duo-caption-desk-1.21.1`（自 `1d2bead3` 拉出） |
| marketing | **1.21.1** |
| Linear | BEL-29；BEL-26/27/28 **勿 Done** |

## interaction-spec 补一句（开工齐）

**姿态分路径**：compact / Duo 外屏 → `compactPipPath`（外放+PiP，文案一字不废）；内屏展开或分屏半宽 → `captionDesk`（整面字幕台，对面为系统视频 App；不自建播放器）。宽 `<520pt` = deskNarrow；`≥520pt` = deskWide + 分屏引导 CTA（无假视频窗）。

## 范围（跟 SPEC §2–§6 / A3）

- 做：`LayoutContext` 注入 → `CaptionChrome`（`compactPipPath` \| `captionDesk`）；deskNarrow/deskWide UI；deskWide 引导 CTA；PiP 降级时序按 SPEC §5；音频 mixWithOthers 硬规则
- 不做：动 ListenSession/ASR/LID/回声闸/额度；A 内嵌播；C 假双栏；改 Mac 听译主舞台（desk **仅 iOS 注入**）；动 H9 断言；屏幕录制二期

## 像素 / 文案

- 像素：对齐 Duo-09/09b 过稿（`design/duo-09-ix-pass-2026-10-25.md`）；产品另闸亮暗像素时可再令，**不挡**本旁路 tip 开工
- 文案：引导 CTA / 听译中胶囊 / 语言行 / 暂停·停止 → 质量 COPY-LOCK（随 1.21.1）

## 执行闸

1. 研发：按上表拉分支 → 落结构 → **报 tip SHA**（旁路，未 push）
2. tip → **架构形检**
3. 质量：AC-DP1–6（DP5 need-device 不挡 DP1–4）；COPY-LOCK
4. **禁 push / TF / 提审** 至另批（A5）
5. 1.21.0 tip `1d2bead3` 与提审闸 **不动**

## 验收（产品最小）

- 展开/半宽：见字幕台、无 App 内视频栏
- deskWide：CTA 可见，无假视频窗
- compact 回归：仍外放+PiP，无「必须分屏」误导
- 退分屏前台 ≠ 自动 PiP

## 同步

| 角色 | 动作 |
| --- | --- |
| 研发 | **开工**；报 tip SHA |
| 架构 | tip 形检；A2–A5 盯 |
| 交互 | 过稿已齐；后续像素另令再跟 |
| 质量 | COPY-LOCK + AC-DP；缺陷统一报用户 |
