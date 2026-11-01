# 架构答文 · Duo 分屏旁挂字幕台 §5（2026-10-24）

- 对应交互定稿：`/workspace/design/duo-dual-pane-subtitle-ix-2026-10-24.md`（B · 系统分屏旁挂）
- 产品挂档：`product/duo-dual-pane-subtitle-b-hang-2026-10-24.md` → **1.21.1** · [BEL-29](https://linear.app/belliedmonkey/issue/BEL-29)；**不进/不挡 1.21.0**
- 角色：架构书面答 §5；**本文件 ≠ 实施 GO**（挂档已齐；开工仍等架构短规格 GO + Pencil Duo-09/09b 过稿）
- 并存：compact / Duo 外屏仍外放+PiP（H9 占位几何 CLOSED 管预览框，不改本形态）

---

## 总裁（给交互 / 产品）

交互定稿 **B** 与现领域模型兼容；产品已挂 **1.21.1**（BEL-29），架构 **认挂档**。  
实现原则：**只扩 LayoutContext→呈现**，不新开 ListenSession，不自建播放器，一期听源继续麦听外放 + 现货回声闸。  
研发 **勿开工本形态**，直至架构另发实施短规格 GO（本稿只答 §5；Pencil 过稿按产品闸序）。

---

## §5.1 Split View / Stage Manager → 半宽字幕台

### 可检测什么 / 不可检测什么

| 可依赖 | 不可依赖 |
| --- | --- |
| 本 App **本 scene** 的 `horizontalSizeClass` / `verticalSizeClass`、`safeAreaInsets`、`sceneGeometry`（窗口 bounds） | 「对面是不是视频 App」、对方 bundle、系统「分屏中」业务枚举 |
| `LayoutContextChanged` → 重算呈现 | `UIScreen.main` / idiom / `UIDevice.orientation` / 硬绑 Duo pose（INV-5 / AC-D5） |
| scene `activationState`（是否前台，供 PiP 降级） | 第二 scene 的内容或媒体状态 |

系统分屏 / Stage Manager 下，本 App 只是 **变窄的一个 scene**。对面播什么由用户选；我们用引导 CTA，不探测对家。

### 映射（建议）

在既有 `LayoutContext` → `PresentationMode` 上，为 **实时字幕** 增加呈现派生（名称可最终规格钉死），例如：

```text
LayoutContext
  → PresentationMode          // 仍可：singleCompact | dualRegular | dualSurfaceTent
  → CaptionChrome（实时字幕壳）
       compactPipPath         // 窄/compact：现货准备页→外放→PiP（预览 4:5）
       captionDesk            // 半宽或展开全宽字幕台（无 App 内视频栏）
```

**进入 `captionDesk` 的几何判据（草案，实施 GO 时钉阈值）：**

1. 实时字幕进行中或准备进入听译字幕态；且  
2. 本 scene **宽度**低于「内屏双栏听译」阈值（或 `horizontalSizeClass == compact` **或** 宽度 ∈ 半屏带），**或** 交互定义的 dualRegular 全宽未分屏态（此时仍 captionDesk + 分屏引导，**禁止**画假视频窗）。

要点：

- **半宽字幕台 = scene 变窄后的 chrome**，不是新设备枚举。  
- Duo 内屏全宽未分屏：`dualRegular` 几何 + `captionDesk` 全宽 + CTA（交互 §4.3）。  
- 与视频 App 分屏后：同一 `captionDesk`，只是 `sceneGeometry.width` 变半。  
- Stage Manager 任意窗宽：同一套宽度阈值，禁止「Stage Manager」专用分支。  
- **ListenSession / captionState / timeline 跨切换连续**（INV-1/6）；禁因分屏 `createSession`。

H9：`#app-subs-pip` 4:5 仅服务 **compactPiP 预览/浮窗占位**；`captionDesk` **不**复用「无条件钉 4:5 伤 Mac 主舞台」那条覆辙——半宽台用半宽版式（交互 §4.1），预览框几何与桌面分流。

---

## §5.2 一期麦听外放 · 分屏同屏播 · 音频 / 回声

### 结论

一期 **保持** 现货字幕档音频会话 + JS 回声闸；**不**为本形态改 ASR / 回声闸语义 / 另开第二听源。分屏同屏播在声学上 ≈「外放 + 本机麦」，距离更近，回声风险 **不低于** PiP 路径，靠既有闸 + 会话 profile，不靠新玩法。

### 壳层约束（硬）

1. **字幕档 profile 不变**（既有约定）：`.playAndRecord` + `[.mixWithOthers, .defaultToSpeaker]`，**不带** `.allowBluetooth`（避免把对面视频 App 拧成通话音质）。  
2. **禁止** 为「听得更干净」改成独占 category / `voiceChat` 等会 **打断或重压** 对面播放的模式。  
3. **不改** 回声闸阈值与 Speak 时钟契约；分屏不是新会话，不重置闸状态。  
4. routeChange / interruption：沿用 `audio-bridge` 重申同一 profile；对面 App 抢会话时按现货恢复，**不得** leave+open 新 ListenSession。  
5. 戴耳机：麦听不到外放 → 沿用现货静音/提示语义；分屏文案可弱提示「外放更稳」，不做新设置项（本期）。  
6. **二期** 屏幕录制另挂；本期验收不以其为门禁。

### 产品/质量预期

对面片源响、麦近 → 偶发多丢回声句可接受（与 PiP 外放同级）；若真机系统性差于 PiP 基线，先交质量量化，再议是否开声学增强轨（独立发版，不绑本形态门禁）。

---

## §5.3 退出分屏 ↔ subtitle-pip 降级时序

### 原则

- **前台变几何 ≠ 浮 PiP**。PiP 只在「听译进行中且本 App 进入非活跃/后台」时按 **compact 同款语义** 浮出。  
- 一套 `captionState`；退出分屏只触发 `LayoutContextChanged` → chrome 重算。

### 时序（规范）

```text
① 分屏中 · 前台 · listening
   → CaptionChrome = captionDesk（半宽）
   → 原生 subtitle-pip：不浮（或保持隐藏）

② 用户退出分屏，本 App 仍前台（scene 变全宽 / 仍 dualRegular 或变 compact 但仍 active）
   → 仅 LayoutContextChanged
   → captionDesk 全宽 + 引导 CTA，或收回 compact 预览壳
   → **此时禁止** 仅因「退出分屏」调用浮 PiP
   → ListenSession 不 recreate；timeline 连续

③ 用户离开本 App（home / 切走），listening 仍进行
   → scene activationState → inactive/background
   → **允许** 浮 subtitle-pip（✕＝暂停听，与 compact 一致）
   → AC-DP6

④ 合上到外屏（单列 compact）且仍前台
   → PresentationMode → singleCompact；CaptionChrome → compactPipPath 预览语义
   → 尚未离开 App：不浮系统 PiP；离开后再走 ③

⑤ 停止/结束听译
   → 收 PiP、清进行中；与基线一致
```

### 禁止

- 退出分屏瞬间自动 PiP（用户还在看全宽字幕台）。  
- 分屏→全宽→分屏 时 `createSession` 或清空 timeline。  
- 用「是否分屏」布尔持久化业务态（只认瞬时 LayoutContext）。

---

## §5.4 模拟器如何证 / 替身

| AC | 模拟器 | 替身 / 门禁 |
| --- | --- | --- |
| AC-DP1–4 | **必须能证** | 不依赖第二 App：把本 scene **收成半宽**（Simulator 分屏 / Stage Manager / 开发调试强制窄 bounds / Duo 模拟器半窗）。验字幕台完整、CTA 非纯黑、亮暗壳、caption 连续、compact 文案不误导。 |
| AC-DP5 | 若无法稳定「半屏本 App + 半屏真实视频 App」 | 记 **need-device**（真机 Duo 或可分屏设备 + 任意视频 App）；**不得**因此跳过 DP1–4。 |
| AC-DP6 | 半宽→全宽→后台 可在模拟器做几何+activation | 浮 PiP 若模拟器无系统 PiP：验「离开 App 后仍走现货 PiP 入口/状态机」；像素级系统 PiP 真机补。 |

**明确不做的替身：** 在本 App 内画假视频窗冒充半栏（交互已否决 C）。

演示叙事：模拟器证「半宽字幕台可读 + 引导」；「一眼同时见片与字」用真机录屏交质量。

---

## 与现规格边界

| 项 | 裁定 |
| --- | --- |
| SPEC-DUO-P0 / H9 | 不自动并入；本形态 **另波** 由产品挂档 |
| 回声闸 / ASR / 额度 | **不动** |
| 1.21.0 已 TF / 提审闸 | **不挡**（交互 §4.4）；本裁 ≠ 提审 |
| 实施 GO | **已发 GO-WITH-ACCEPT**：`SPEC-DUO-CAPTION-DESK-SPLIT-B-2026-10-24.md`；动手前须 Duo-09/09b 过稿（A1） |

---

## 同步

| 角色 | 动作 |
| --- | --- |
| 交互 | §5 已书面答；Pencil Duo-09/09b 仍等产品挂档后出 |
| 产品 | **已挂 1.21.1**（BEL-29）；1.21.1 开工前补 interaction-spec 姿态分路径一句；COPY-LOCK 随 1.21.1 |
| 研发 | **勿开工**本形态，直至架构实施 GO + Pencil 过稿；禁动 1.21.0 tip |
| 交互 | 挂档已齐 → **可出** Duo-09 / 09b |
| 质量 | 定稿不挡；AC-DP1–6 按上表；缺陷统一报用户 |

