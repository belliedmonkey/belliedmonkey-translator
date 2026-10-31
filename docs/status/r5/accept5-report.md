# 1.19.4 第 5 轮（fix/1194-r5，基线 371c4bf4）自动化验收报告

- 模型：**DeepSeek V4.1 Flash（deepseek-flash）**
- 依据规约条目：`docs/conventions-digest.md` 的 SUP-03/04/06/07/08/09/10/11、TST-01/05/06/07/14、DEV-06、REL-03/04/08、BAN-21/25、PIT-36。
- 结论：**pass = true**（回归不差于 1.19.3 基线；A/B/C 全部通过；F/G 中 113/114 已通过的项没有变差）。
- 是否推送：**否**。全程未 push、未合并、未切换/新建分支、未碰发版分支、未提审、未传浏览器扩展、未 reset/rebase/amend。
- Guard：本轮后半段（12:01 起）无新的 guard 拦截；上一轮 10:02 的那次 GUARD-BLOCK 已由监督方确认（处理=侦察命令里去掉/不再引用被保护目录名）。

---

## 0. 回归（与 1.19.3 基线对比）

| 项 | 本轮 | 基线 | 判定 |
|---|---|---|---|
| npm test | **2666 passed / 0 failed**（监督方应用文档改动后重跑） | 2628/2628 | 更好 |
| test:mac | 只红 **M8 / M9 / P-12**；M2–M5、M7、P-01…P-08 全绿 | 只红 M8/M9；P-12 已知在这台 Mac 挂 | 一致（P-12 = 监督方 2026-10-12 放行项，SUP-06） |
| build-check / test-app / test-app:china / test-smoke / test-layout | 全通过（本轮开工前已完成，见 progress） | 一致 | 一致 |

`test:mac` 原文（hostexec 日志 `120727-test-mac.log`）：

```
✓ M1 ✓ M6 ✗ M8 ✗ M9
✓ M2 ✓ M3 ✓ M7 ✓ M4 ✓ M5
✓ P-01 ✓ P-02 ✓ P-03 ✓ P-05 ✓ P-06 ✓ P-07 ✓ P-08 ✗ P-12
✗ 3 个 case 红
```

- M8/M9 红因 native 点录音键开麦等不到（本机权限，与 1.19.3 基线同因）。
- P-12 红：录音键说的行还画着 ↔；自第 4 轮起在这台 Mac 上稳定复现，监督方已放行。

---

## 1. A / B / C 根因（调用链 文件:行号）、修法与新增测试

详见 `.local/accept5/rootcause.md`（含基线行号与改后行号）。要点：

### A 识别语言名额（改稿 H）
- 根因：状态查询（探针）与安装请求会在系统里**占用** locale 名额，而基线 `held`/`releaseUnused` 只覆盖「开会话」那一半 ⇒ 装到上限再装第 6 门时 `prepareToAnalyze` 抛 `SFSpeechErrorDomain Code=11 "Too many allocated locales"`（native 旧 `speech-bridge.swift:223/265` 探针/安装从不登记也不释放）。
- 修法：原生新增 `noteReserved`（`app/native/speech-bridge.swift:455`）、`mtQuotaSnapshot()`（:118，读系统 `maximumReservedLocales` / `reservedLocales`）、`stt-release`→`sttRelease`→`releaseExplicit`（:226/:460，**只在用户确认让出时**调 `AssetInventory.release`）；JS 桥 `app/native-speech.js` 新增 `quota()`（:237）/`releaseSlots()`（:241）；本机记忆 `src/app/asr-quota.js`（`listenAsrInstalled` / `listenAsrLastUsed`）；纯逻辑 `app/listen-core.js` `quotaRows`（:2307）/`canYield`（:2323）/`pickYield`（:2328）/`quotaSelectPlan`（:2341）；UI `src/app/shell-model.js` `paintQuota`（:640）/`openYieldSheet`（:675）/`yieldAndRestore`（:773），`src/app/listen-model.js` `setQuotaFull`（:866）/`quotaYieldAndRestore`（:912）/`warmBody`（:960）/`ensurePacksForPair`（:1856）/`halt`（:2119）。
- 新增测试：`test/listen-r5.test.js` 的 A 段 5 条（三态 / 已用 N 上限 / 当前语言对不可让出 / 最久没用默认 / 首启超额）。

### B 回声第 0 步（转交路径过回声闸）
- 根因：`intakeDecide`（`app/listen-core.js:1070`）把「中文路收到的纯拉丁短句、归属判成 en」标成 `xfer` 候补；候补由 `makeTransferGate`（:1402）等一次空闲后经 `onXfer` **直接注入英文通道**，**不再查** `playingLangs('en')`、也不查 `isEcho` ⇒ App 朗读的英文被收成 `she.` / `theafternew.` 时成了多余行。
- 修法：`makeTransferGate` 的 `fire()`（`app/listen-core.js:1410-1429`）在真正转交前按目标语言再过同一遍回声闸（`playing().has('en')` → 记 `intake:xfer-echo` 丢弃；`isEcho(text)` 命中同丢）。`src/app/listen-model.js:1365-1381` 注入 `targetLang:()=>'en'`、`playing:()=>echo.playingLangs(...)`、`isEcho`。
- 新增测试：`test/listen-r5.test.js` B1 段 6 条（`she.`/`theafternew.` 被拦、播完后相似文本被文字闸拦、真人插话照转、另一门真人中文不被误杀、非候补行为不变）。

### C 小纠错
- C1「English已就绪」补空格：`ListenCore.fillPrepDetail`（`app/listen-core.js:2277`）按「值末字符 vs 模板紧邻字符」是否分属拉丁/汉字补空格。
- C2 设置页语言本名 + 补 ไทย：`src/app/settings-view.jsx` `paintListenPack`（:272）列**全部占名额语言**（`NativeSpeech.quota().reserved`）的本名。
- C3 完成页别夸泰语朗读：`src/app/shell-model.js` `paintPackChrome` done 分支（:894-915）只把**真下过朗读包**的语言算进「能朗读」，否则说「…可以听译了；…可以朗读」。

---

## 2. 「开着静麦，回声为什么还进得来」的结论

**H1 是主因**：只有两条原生朗读路会置静麦 `MTAudioBridge.shared.muteInput = true` —— `MTDeviceSpeech.speak`（Piper/Kokoro，`app/native/speech-bridge.swift:820`）与 `MTSystemSpeech.speak`（`AVSpeechSynthesizer.write`，:959）。**WebKit 播放的三条路不置静麦**：云端/自建/免费额度的 `speakBytes`（`extension/learn/tts.js:699-739`）、原生无该语言声音时的 WebKit `speechSynthesis` 退路（:631-695）。这些音频由 WebKit 自己进程播放，`app/native/audio-bridge.swift` 的 `micDeliver`（:279）不知道它在放，静麦不会置位 ⇒ 朗读声原样进识别器。**H2（次要）**：`MTSpeechChunkBox.finish`（`speech-bridge.swift:1057`）从首块入队起算样本数/采样率、没有计输出设备延迟，`.dataPlayedBack` 失灵时定时器可能早于真实播完释放静麦。本轮不改音频引擎，结论到此；真根修见 `.local/qa/echo-aec-proposal.md`。

---

## 3. 自动化验收（Debug 包测试端点）

### A1–A9：识别语言名额（真的装满 → 让出 → 补回 → 恢复）

起始名额扫描（`.local/accept5/scan-quota.txt`，12:07）：

```
quota max=5 reserved=[en-US, th-TH, zh-CN]；三门外加探针 assets=installed, ok=true
supportedLocales().length=68（设备支持全集，非占名额集合）
```

| 项 | 结果 | 证据（真 App 原文） |
|---|---|---|
| A1/A9 首启/设置页「已用 N / 上限」 | ✅ | 包屏 `#packs-quota-used` = `已用 3 / 5`；`#packs-quota-note` = `Apple 限制：同时最多 5 门识别语言`；装满后 = `5 门都占着名额 · 再装新的会先标为「未就绪」` |
| A2 装满到上限 | ✅ | 管理页对 日本語、한국어 各点一次「下载」⇒ `已用 4 / 5` → `已用 5 / 5`；`NativeSpeech.quota()` = `[en-US,ja-JP,ko-KR,th-TH,zh-CN]` |
| A3 装第 6 门触发确认框 | ✅ | 点 Français 的「下载」⇒ `#packs-sheet` 展开；`#packs-sheet-title` = `识别语言已满 5 门`；`#packs-sheet-lede` = `要补回 Français，需要先让出一门。…` |
| A4 默认选中最久没用 | ✅ | 单选默认勾中 `日本語`（`最久没用`）；`한국어` 也 `最久没用`；`ไทย` = `今天用过`（test:mac 本轮用过）。`#packs-sheet-go` = `让出 日本語 · 补回 Français` |
| A5 当前语言对不可选 | ✅ | 行 `English` / `中文`：`disabled=true`，小字 `当前语言对 · 不能让出` |
| A6 让出后原位标未就绪 | ✅ | 点 go 后：`日本語` 行 `class=pack-line is-recoverable`、tag=`未就绪`、状态=`点一下补回 · 约 1–2 秒`、按钮=`补回`；`Français` 变 `已就绪/占名额`；仍 `已用 5 / 5` |
| A7 补回期间已就绪一侧能说 | ✅ | 听译页把对方语言切到刚让出的 日本語：胶囊=`名额已满`，卡片=`还不能听 日本語：识别语言已占满 5 门`；`#app-listen-ptt-other` 灰、小字=`名额已满 · 让出一门才能用`；`#app-listen-ptt-mine` 可点、小字=`点一下开始`。点「让出一门并补回」后逐 0.5s 采样：`shown=false`→pill=`日本語 0%`→`✓ 已就绪`，**全程 `mineDisabled=false`** |
| A8 Code=11 归「名额已满」类 | ✅ | 满员下直接第 6 门：`NativeSpeech.ensureAssets("stt",["de-DE"])` → reject **`reason:"locales"`**，且 reserved 前后不变。native 侧 `mtPrepareCode`（`speech-bridge.swift:1317-1321`）把 `SFSpeechErrorDomain code=11 → "locales"`；JS `halt`（`listen-model.js:2139-2141`）遇 `'locales'` 挂名额卡、备注留空（不写「下载失败/网络」，区别于 `listen_assets_failed2`） |
| A9 已就绪一侧说话键不动 | ✅ | 见 A7：整段 `mineDisabled=false` |

**验完恢复**（`.local/accept5/scan-quota-final.txt`，13:00）：

```
quota max=5 reserved=[en-US, th-TH, zh-CN]；probe(zh-CN,en-US,th-TH)=installed, ok=true；ptt off
```

### B：回声第 0 步（真 App 定时注入）

在 zh↔en 会话、`ptt` 强制在 `other`(en) 侧、用 `AppListen.speakNow` 播一段长英文（`speakingRid=900003`）期间，用 `__mtTest` 注入中文路候补：

- 注入 `she.`（113/114 真样本）→ `AppListen._debug().seg.diag.intake` 出现 **`xfer-echo: 1`**，`xfer` 计数不变（没转交）。
- 正对照：朗读结束后注入 `Yes please.` → **`xfer` 3→4**（真人式候补照转）。

（`__mtTest` 只注入原生事件；判据取模型自述 `_debug().seg.diag`，非我写的 hack。）

### C1–C3

| 项 | 结果 | 证据 |
|---|---|---|
| C1 | ✅ | 生产函数 `ListenCore.fillPrepDetail('{what}下载中 · {pct}% · {ready}已就绪','日本語',0,'基础组件、中文、English')` → `…中文、English 已就绪`（有空格）；`'…中文'` → `基础组件、中文已就绪`（汉字不补） |
| C2 | ✅ | 设置页 `#listen-pack-state` = `识别语言包已就绪 · English · ไทย · 中文`（全本名、含 ไทย、无 locale 码） |
| C3 | ✅ | 全新安装下勾中/英/泰但泰语朗读关，走到完成态：`#packs-lede` = `中文、English、ไทย 可以听译了；中文、English 可以朗读。…`（不再说 ไทย 能朗读） |

### F / G 回归（F 系列在全新安装首启上）

全新安装由监督方代办（`REQUEST-RESET` → `RESET-DONE-9`：清容器→起 Debug 包→测试账号登录）。登录判据用 `drv.js` 读 `#firstrun-packs` 可见 / `signed-out` 隐藏。

| 项 | 结果 | 证据 |
|---|---|---|
| F1 首启包屏（多选） | ✅ | 登录后 `#firstrun-packs` 可见、`#packs-title=选择要下载的语言`，逐语言 checkbox |
| F2 默认勾中文(系统语言)+English | ✅ | `中文` checked、sub=`系统语言`；`English` checked |
| F3 全本名 | ✅ | 中文 / English / ไทย / 日本語（无 locale 码） |
| F4 其他 8 种折叠 | ✅ | `#packs-more` = `其他 8 种语言` |
| F5 基础组件「必需」并真下载 | ✅ | `基础组件` checked、disabled=true、sub 含 `必需`；点「下载并继续」后它到 `已就绪` |
| F6 中英朗读跟随；泰语朗读默认不勾 | ✅ | `朗读 · 中文 + English` checked；`朗读 · ไทย` unchecked、sub=`默认不勾…` |
| F7 每项一条进度 | ✅ | 采样：`朗读 · 中文 + English` = `排队中` → `已就绪`；`#packs-locked` 下载中可见、其余行勾选锁定。资产本机已有，**没抓到百分比那一档**（同 114 对 日本語 的记法） |
| F8 | — | Mac 无蜂窝，验不了 |
| F9 完成态点了才进 | ✅ | `#packs-go` = `进入实时听译`；点之前 `#app-listen` hidden，点之后 visible |
| F10 深色可读性 | ✅（自动门） | 未重拍深色截图：本机 System Events 切外观的脚本被权限挡下（不可用）。深浅两套配色的对比度由页面门自动跑（`test:app` 绿）覆盖；本轮新增名额卡用的是既有调色板变量 |
| F11 设置→管理语言包同一屏 | ✅ | 状态一致：中文/English/ไทย=`占名额·已就绪`、日本語=`未下载`·按钮`下载`、朗读中英=`已就绪`、基础组件=`已就绪`、`已用 3 / 5` |
| F12 计数一致 | ✅ | 下载全程 1s/次采样：`mismatch=0`；`下载中 · 还剩 1 项` ↔ 实际 1 项；完成变 `进入实时听译` |
| G1 准备中右键灰、左键正常 | ✅ | 切 日本語：`otherDisabled=true`、`otherHint=准备中 · 日本語 下载 0%`；`mineDisabled=false` |
| G2 点灰键不开麦 | ✅ | 准备中点 other 键：`on:false`、`side:""`；卡片=`还不能开始，下好后再点` |
| G3 未就绪期间不出现「正在录」 | ✅ | 准备中全程 `on:false`、`side:""` |
| G4 就绪后不自动开始 | ✅ | 就绪后 `on:false`；卡片=`下好了，点下面的键开始` |
| G5 胶囊「✓ 已就绪」 | ✅ | `#app-listen-pill` = `✓ 已就绪`（数秒后消失） |
| G6 说话 / 回声 | ✅ | 见 B（候补回声已拦）；真人说话不被误杀由 test:mac M2–M5、P-08 覆盖且全绿 |
| G7 宽屏两键竖排 | ✅ | `mine`(x20,y440,w250,h64)、`other`(x20,y520,w250,h64)：同 x、纵向排列 |
| G8 换边不暂停 | ✅ | 中文录着（`on:true,side:me,phase:listening`）点 English → `on:true,side:other,phase:listening`（不暂停） |
| G9 一侧下载时另一侧能单独录 | — | 本机资产已在本机，切语言 1–3s 内就绪，没有可观察的下载窗口（同 114 的记法；113 那次通过） |

**与 113/114 对比**：F1–F7、F9、F11、F12 通过（113/114 均通过）；F8 = —（同 114）；G1–G5、G7、G8 通过；G2/G3/G9 在 114 记为「—」，本轮的 G2/G3 反而验到了，G9 仍是—；G6 由 B 的修复加强。**没有变差。**

---

## 4. 名额装满与恢复的证据（原文）

- 起始：`{"max":5,"reserved":["en-US","th-TH","zh-CN"]}`
- 装满：`已用 4 / 5` → `已用 5 / 5`；`{"reserved":["en-US","ja-JP","ko-KR","th-TH","zh-CN"]}`
- 让出+补回：`日本語` = `未就绪·可补回`，`Français` = `占名额`，仍 `已用 5 / 5`
- 恢复（复扫）：`{"max":5,"reserved":["en-US","th-TH","zh-CN"]}`；`probe(["zh-CN","en-US","th-TH"])` = `assets:installed, ok:true`
- 音量：`volume-restore.sh` → `output volume:88, input volume:100, alert volume:100, output muted:true`

---

## 5. 异常与待人处理

1. **监督方重置脚本的 OTP 落码不稳**：`REQUEST-RESET-2/3/4/5` 出现「键入 6 位但未登录成功」，第 9 次成功。我的自动重试环（已 kill）误判 #8 已登录又写了 #9，把这个已被监督方指出；以后整个验收最多再请求 2 次全新安装。
2. **F10 深色**：本机 `osascript … System Events` 切外观挂起（权限），未能重拍深色截图；以自动深浅配色对比度门为准。
3. **P-12**：本轮仍红（监督方已放行）。
4. 测试临时把名额装到 5 门、装了 日本語/한국어，验完已通过「先在本实例 `ensureAssets` 重新登记、再 `releaseSlots`」恢复到 zh/en/th。
