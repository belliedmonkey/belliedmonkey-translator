# 短规格 · Duo 分屏旁挂字幕台（B）· 1.21.1

- 架构 · 2026-10-24 23:55 Asia/Shanghai
- **实施 GO：GO-WITH-ACCEPT**（见 §8）
- 产品挂档：`product/duo-dual-pane-subtitle-b-hang-2026-10-24.md` → **1.21.1** · [BEL-29](https://linear.app/belliedmonkey/issue/BEL-29)
- 交互定稿：`design/duo-dual-pane-subtitle-ix-2026-10-24.md`
- §5 答文：`architecture/ARCH-ANSWER-duo-split-caption-desk-s5-2026-10-24.md`
- Pencil：Duo-09 / 09b（过稿后与本 GO 齐再令研发动手）

---

## 1. 一句话

**Duo 内屏展开（及分屏半宽）实时字幕主形态＝本 App 整面「字幕台」；对面是系统里的视频 App。不自建播放器。compact / 外屏仍外放+PiP。**

---

## 2. 目标与非目标

| 做 | 不做 |
| --- | --- |
| 扩壳层呈现：`LayoutContext` → `CaptionChrome` | 改 ListenSession / ASR / LID / 回声闸 / 额度 |
| `captionDesk` 半宽与全宽+引导两态 | App 内嵌播（A）、假视频窗（C） |
| 退分屏/后台与 PiP 时序按 §5.3 | 二期屏幕录制；双系统 PiP |
| AC-DP1–4 模拟器半宽可证 | 动 1.21.0 tip `1d2bead3`；本波 push/TF/提审 |

---

## 3. 领域（钉死）

### 3.1 CaptionChrome（实时字幕壳，非会话）

```text
CaptionChrome
  compactPipPath   // 普通 iPhone / Duo 外屏：准备页→外放→PiP；预览 #app-subs-pip 4:5（H9）
  captionDesk      // 展开/分屏：整面字幕台；无 App 内视频栏
```

- **一套** `ListenSession` / `captionState` / `timeline`（INV-1/6）；切 chrome **禁止** `createSession`。
- `PresentationMode` 仍只由 `LayoutContext` 推导；**不**新增「是否分屏」持久业务布尔。

### 3.2 谁决定 chrome（防 Mac 误伤）

| 层 | 规则 |
| --- | --- |
| **原生 iOS App** | 计算并注入 `captionChrome`（或等价字段）。`PresentationMode == singleCompact` → `compactPipPath`；否则在「实时字幕」流 → `captionDesk`。 |
| **Mac / 非 iOS** | **恒** `compactPipPath`（或不注入 desk）；本规格不改 Mac 听译主舞台。 |
| **JS** | **只读**注入的 `captionChrome` + `sceneGeometry`；**禁止** `UIScreen` / idiom / orientation 分支（AC-D5）。 |

### 3.3 captionDesk 宽窄（钉阈值）

在 `captionChrome == captionDesk` 时：

| 子态 | 判据（本 scene 宽） | UI |
| --- | --- | --- |
| **deskNarrow** | `sceneGeometry.width < 520` pt | 交互 §4.1 半宽字幕台（顶栏+主字幕面+语言行+最近句+底控） |
| **deskWide** | `width >= 520` pt | 同一套字幕台全宽 + **分屏引导 CTA**（交互 §4.3 / Duo-09b）；**禁止**假视频窗 |

520 为实施钉；若 Pencil 过稿后半宽观感系统性差，只允许 ±40pt 内调并写进 tip 说明，不另开产品波。

Stage Manager / Split View：**无**专用分支，只吃变窄后的 `sceneGeometry`。

---

## 4. 音频（硬）

1. 字幕档：`.playAndRecord` + `[.mixWithOthers, .defaultToSpeaker]`，**无** `.allowBluetooth`。  
2. 禁独占 category / `voiceChat` 等打断对面播。  
3. **不改**回声闸与 Speak 时钟；分屏不重置闸。  
4. interruption / routeChange：现货恢复；禁 leave+open 新会话。

---

## 5. PiP 降级时序（硬）

1. 前台仅几何变化（进/出分屏、宽窄切换）→ 只 `LayoutContextChanged` → 重算 chrome；**不**浮 PiP。  
2. `listening` 且 scene → inactive/background → **允许**浮 subtitle-pip（✕＝暂停听，同 compact）。  
3. 合外屏仍前台 → `singleCompact` + `compactPipPath` 预览；未离 App 不浮系统 PiP。  
4. 禁止：退分屏瞬间自动 PiP；用「分屏中」布尔持久化。

H9：`#app-subs-pip` 4:5 **仅** `compactPipPath`；`captionDesk` **不得**无条件钉 4:5 伤其它舞台。

---

## 6. UI / 文案边界

- 页壳跟系统亮暗；**主字幕面固定深色**。  
- compact 准备页文案 **一字不废**（外放+PiP）。  
- deskWide 引导：「在分屏另一半打开视频或浏览器…；也可离开 App，字幕浮在画中画。」（以 COPY-LOCK / Pencil 过稿为准）。  
- 不改「对话 · 实时听译」左控右史双栏。

---

## 7. 验收（交质量）

| ID | 内容 | 环境 |
| --- | --- | --- |
| AC-DP1 | deskNarrow/半宽：字幕台完整可读；deskWide：CTA 可见非纯黑 | 模拟器半宽替身 **必证** |
| AC-DP2 | 壳跟系统亮暗；主字幕面深色 | 模拟器 |
| AC-DP3 | 展开↔外屏/退分屏：caption 连续；compact 预览/PiP ✕＝暂停听 | 模拟器几何+activation |
| AC-DP4 | compact 回归：无「必须分屏」误导 | 模拟器 |
| AC-DP5 | 与视频 App 系统分屏一眼见片+字 | **need-device**（不得挡 DP1–4） |
| AC-DP6 | 结束分屏后离 App：PiP 降级同 compact | 真机补像素；状态机模拟器可先证 |

禁止替身：App 内假视频窗。

---

## 8. 实施 GO · GO-WITH-ACCEPT

**架构裁定：GO-WITH-ACCEPT**

| ACCEPT | 说明 |
| --- | --- |
| A1 | **动手前**：交互书面确认 Duo-09 / 09b **过稿**（与产品闸序一致） |
| A2 | 旁路 tip；**禁**改 tip `1d2bead3` / 1.21.0 同包；基线 tip 与分支名开工时与产品/研发达成书面一行 |
| A3 | 差分限于：LayoutContext 注入、`CaptionChrome` 壳、字幕台 CSS/JSX、引导 CTA；**不**动回声闸/ASR/H9 断言 |
| A4 | Mac 听译主舞台无回归伤（desk 仅 iOS 注入） |
| A5 | 本 GO **≠** push / TF / 提审；另批 |

### 序

1. 交互过稿 Duo-09/09b → 通知产品+架构+研发  
2. 研发开旁路 tip（本 GO + A1 齐）  
3. 架构只读形检 tip → 质量 AC-DP → 产品另裁 push/TF  

### 明确未 GO

- 合 main / 提审 / 屏幕录制二期 / 内嵌播 A  

---

## 9. 同步

| 角色 | 动作 |
| --- | --- |
| 产品 | 挂档已齐；A1 已解；可书面令研发旁路 tip；1.21.0 提审闸不挡 |
| 交互 | Duo-09/09b 过稿 PASS（A1 已解） |
| 研发 | A1 已齐；等产品书面令后旁路 tip |
| 质量 | 1.21.1 锁 COPY/AC；缺陷统一报用户 |


## 10. A1 闸状态（2026-10-25）

**A1 = PASS** · 交互签核 `design/duo-09-ix-pass-2026-10-25.md`（00:11 Asia/Shanghai）。

架构认：ACCEPT A1 已满足；实施 GO-WITH-ACCEPT 其余条款仍有效。
下一步：产品书面令研发旁路 tip → tip 交架构形检 → 质量 AC-DP。禁动 `1d2bead3`；≠push/TF/提审。
