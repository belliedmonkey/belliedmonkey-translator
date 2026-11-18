# BEL-273 方案 B · 听译麦克风引导（已过审）

- 稿 ID：`BEL-273-alt-b.pen`（5 个画框，pen.dev 原生 JSON，可编辑）
- PNG：`png/BEL273-B-*.png`（pen.dev `Export()` 直出，与 `.pen` 同源）
- 评审人：**用户**（2026-11-18 「过审核了。落码吧。」）
- 结论：**已过审 2026-11-18**。设计稿 ID `BEL-273-alt-b`，用户已过审。可落码；四端包重打另令；禁 Submit。
- 卡选：用户 2026-11-18 选「出方案 B 稿，塞回 1.23.4」
- 画框：`listen-idle` / `listen-first-click-hint` / `listen-waiting` / `listen-denied-inline` / `listen-mac-no-gate`
- 主表面：iPhone **实时字幕**（单键 `#app-listen-toggle`「开始」）。对话 PTT 页同一套行内提示，稿未另画双键。
- 语言行对齐现网：胶囊外「视频语言：」，胶囊内默认「自动 → 译成 中文」（译成 = 系统语言，不写盘播种）。
- 配色：Organic（cream `#f5ead8` / creamWell `#f9f4ed` / ink `#201e1d` / accent `#ac6231` / line `#dcd3c4` / dim `#6a6255` / stage `#0F172A`）

## 逐帧

| # | 画框 | PNG | 覆盖的界面与交互 | 结论 |
|---|---|---|---|---|
| 1 | `BEL273-B-idle` | `png/BEL273-B-idle.png` | 字幕页 idle：唯一填充「开始」，无权限卡 | **过** |
| 2 | `BEL273-B-first-click` | `png/BEL273-B-first-click.png` | 第一次点开始：按钮上方 note + 同时弹出系统授权框（框不是本 App 的屏） | **过** |
| 3 | `BEL273-B-waiting` | `png/BEL273-B-waiting.png` | 系统框还在：按钮置灰「等待系统授权…」，不新增按钮 | **过** |
| 4 | `BEL273-B-denied` | `png/BEL273-B-denied.png` | 拒绝后：行内一句 + 文本链「去设置」；「开始」仍是唯一填充按钮 | **过** |
| 5 | `BEL273-B-mac` | `png/BEL273-B-mac.png` | Mac 字幕听系统声音，不出现任何麦克风提示 | **过** |

## 用户过审裁定（2026-11-18）

1. **五帧交互**按方案 B 过（单「开始」+ 行内提示，不要独立权限屏）。
2. **第一次点开始** note「第一次开始会弹出麦克风授权，点「允许」即可。」接受。
3. **denied** 一行 + 「去设置」文本链、不把「开始」改成「重试」。接受。
4. **waiting** 用短文案「等待系统授权…」（按钮上）；现网长句 `subtitle_bar_waiting` 留给字幕条/系统声音等待，不贴到主按钮。
5. **对话 PTT 页**同一套行内提示（稿只画了字幕单键；PTT 上方同样 note / 去设置链，不新增填充按钮）。

## 文案（zh 上画框；en 表内）

新短句。独立权限卡用的 `listen_perm_explain_*` / `listen_perm_denied_body`（「点重试」）本方案不用。

| 用途 | zh | en | 键 |
|---|---|---|---|
| 主按钮 | 开始 | Start | 现网 `subtitle_start` |
| 第一次点开始 note | 第一次开始会弹出麦克风授权，点「允许」即可。 | The first Start will ask for microphone access — tap Allow. | **新** `listen_perm_first_hint` |
| 等待 | 等待系统授权… | Waiting for permission… | **新短句**（或缩短现网 `subtitle_bar_waiting`） |
| 拒绝行内 | 麦克风权限未开启。到系统设置打开麦克风，回来点开始即可。 | Microphone access is off. Turn it on in System Settings, then come back and tap Start. | **新** `listen_perm_denied_inline` |
| 文本链 | 去设置 | Open Settings | **新** `listen_perm_open_settings` |
| Mac 灰字 | 线上会议、视频通话也能用：让对方的声音从扬声器放出来即可。 | （现网） | 现网 `listen_mac_use` |
| 舞台空态 | 开始后，字幕会出现在这里 | Captions will appear here once you start. | 现网 `subtitle_stage_empty` |

13 语种：过审后落码时补 3–4 个新键。系统授权框文案由 iOS/macOS 出，不进 `_locales`。

## 过审后

- 用户 2026-11-18 显式 reopen BEL-273，令 RD 按本稿改 UI（`order-rd-bel273-alt-b.md`）
- 四端包重打另令（现 VALID intl iOS 234 / intl Mac 183 / CN iOS 175 / CN Mac 174 本拍不重打）
- Submit 另令

## 边界

- 273 遥测（`mic-perm-read` / `native_code` / `mic_permission`）已在 tip，本稿不动。
- 派活令用语：`BEL-273-alt-b`，用户已过审 2026-11-18。
