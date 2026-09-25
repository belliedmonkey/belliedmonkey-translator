---
name: preview-video
description: 录并合成 App Store 的预览片（Mac 的 DESKTOP 两支、iPhone 的 IPHONE_67 两支）。手机那半边要真机 + QuickTime 取景器 + ffmpeg 裁窗口；Mac 那半边全自动。任何「重拍商店预览视频」「补一段功能进片子」的活都走这里。
---

# preview-video —— 录出来的东西，判据是「该出现的那个」

## 什么时候跑

- 商店预览片过时了（片中没有这一版的主打功能）；
- 要往片子里加一段新功能（Mac 的快速翻译、iPhone 的系统翻译）；
- `store-assets/video/{en,zh}-{ios,mac}.mp4` 与截图不同版。

素材盘点、截图是否过时，仍然归 `.claude/skills/store-release/assets.md`；**视频的录与合成只在这里**。

## 一条贯穿全篇的判据纪律

**「有东西出现」不是判据，「出现的是该出现的那个」才是。** 2026-09-25 一天里在这一条上栽了三次：

| 我读到的 | 我下的结论 | 真相 | 正确的判据 |
|---|---|---|---|
| 画中画窗里有英文 | 「真字幕 ✓」 | 那是**原文**，每句下面都写着「译文失败 · 重试」 | 原文**下面有译文**，且没有「译文失败」 |
| `cap screenshot --window` 出了张漂亮的手机图 | 「取景器是活的 ✓」 | 冻住的一帧，录了 155 秒全是同一张 | **两帧、不同时刻、md5 不同** |
| `list_windows` 里没有快速翻译面板 | 「快捷键没生效」 | 面板是**浮动 panel**，不在 layer 0 | 整屏截图 |
| AX 返回 0 个窗口、窗口渲染全黑、`System Events` 报 `-1719` | 「AX 这一层塌了，要重启 cua-driver 或重启 Mac」 | **屏幕锁了** —— 解锁之后一切照旧 | 见下 |

前两条是用户当场指出来的（「翻译其实失败的」）。**这一类错的共同形状：盯着「有反应」，没盯「反应对不对」。**

### 开工前先确认屏幕是醒的 —— 锁屏的表现像「什么都坏了」

录屏这条路上**最会骗人的一件事**：屏幕一锁，窗口渲染全黑、AX 返回 0 个窗口、
`System Events` 报 `-1719「无效的索引」`、`cap screenshot` 出纯黑图 —— 每一项单独看
都像被测对象坏了。2026-09-25 我为此判过两次错：先判「QuickTime 卡死」，后判
「辅助功能层塌了，得重启 cua-driver 或重启 Mac」。**两次都只是屏幕锁了。**

三条判据，都是一秒钟的事：

```bash
# ① 整屏截图的**字节数**：锁屏时约 11 万，醒着时 100 万以上
cap screenshot --screen 1 --path /tmp/t.png && ls -l /tmp/t.png
# ② 对照组：拿一个**已知正常**的窗口问 AX。它也返回 0 ⇒ 不是被测对象的问题
# ③ check_permissions 仍说 accessibility: true ⇒ 权限没掉，那就是锁屏
```

**「任何 AX 判据都要先跑一个已知正常的 App 当对照」**（`docs/verification-spec.md` §2.G 第 5 条）
就是为这一类写的 —— 不跑对照，量到的是自己这一侧的状态，不是被测对象。

录屏动辄十几分钟，中途锁屏会废掉整条 take。**开工前把「息屏/锁屏」推远**，
或者每次开录前先跑一次上面的①。

## Mac 两支（DESKTOP 2560×1600，28.5 s）

全自动，不用人。产物 `store-assets/video/{en,zh}-mac.mp4`。

### 输入

```bash
bash store-assets/src/make-preview-inputs.sh    # 题卡（横竖两套）+ en/zh/music/conv 四条音轨 → .local/store-media/
```

录屏那四段（`rec/{en,zh}-{subs,talk-v2}.mov` + 各自 `.start.txt`）是现场拍的，配方见
`store-assets/README.md`「App Preview 视频」。**快速翻译那一段**（`rec/{en,zh}-quick.mov`）这样拍：

```bash
# 背景页：store-assets/src/preview-quick.html（?src=zh 给 en 那支用 —— 方向必须是「外语 → 看片人的语言」）
open -a "Google Chrome" --args --user-data-dir=<临时> --app="file://…/preview-quick.html"
# 三击选中第一段 → 把同一句放进剪贴板 → ⌃⌥T
ffmpeg -f avfoundation -capture_cursor 1 -framerate 30 -i "<屏幕设备号>:none" -t 11 …
ffmpeg -ss <面板出现后> -t 3 -vf "crop=2934:1834:45:130" …   # 裁掉菜单栏与标题条，正好 16:10
```

四件必须做对，全是实测出来的：

1. **⌃⌥T 是剪贴板入口**，不按 ⌘C 它翻的是上一次的内容，面板会写「是不是忘了按 ⌘C?」。
   cua 发 ⌘C **进不去 Chrome**；用 `osascript … key code 17 using {control down, option down}` 发热键，
   用 `pbcopy` 把同一句放进剪贴板（选区是真的，剪贴板内容一模一样，不算造假）。
2. **面板贴着鼠标**：先 `move_cursor` 把它摆到空白处再按热键。
3. **面板会把 App 自己的窗口从隐藏状态拉回来**，⌘H 压不住 —— 要让它不入镜，把窗口
   `set_window_frame` 挪到屏幕外。
4. **重复翻同一句会出「跟上次翻的是同一段」那行提示** —— 开录前先用另一段预热一次，再把剪贴板换回来。

### 合成

```bash
STORE_MEDIA=.local/store-media bash store-assets/src/compose-preview.sh zh   # 或 en
```

顺序是 题卡 → 字幕 10 s → 题卡 → 对话 8 s → **快速翻译 3 s** → 结尾卡 = **28.5 s**（Apple 限 15–30）。
缺 `$L-quick.mov` 脚本会**报错退出**：少一段在成片里看不出来，只有对着秒数数才发现。

## iPhone 两支（IPHONE_67 886×1920）

要真机。**QuickTime 只当取景器，录制交给 ffmpeg。**

### 为什么不是 QuickTime 自己录

它是沙盒 App，**只接受存储面板给的位置**。AppleScript 给路径一律弹
「未能将文稿…存储为…因没有权限」，连试两次会把它的保存流程顶死（进程 CPU 0%、AX 返回 0 个窗口、⌘S 没人接），
**录了 5 分钟的东西就此拿不出来**。

`cap record --window` 与 `ffmpeg` 抓窗口也不行：QuickTime 的预览走硬件层，两者都报
「No decodable frames found」。**只能录整屏再裁。**

### 步骤

```bash
# 0. 手机连上，确认 connected
xcrun devicectl list devices | grep -i <设备名>

# 1. QuickTime 取景器：新建影片录制 → 来源选 iPhone（**这一下要人点**：那个 ⌄ 悬停才浮出，
#    AX 上 AXPress 报 -25204）。选中后窗口会变成竖的（440×949 点）。
osascript -e 'tell application "QuickTime Player" to new movie recording'

# 2. 取景器必须是**活的**：两帧之间故意改变手机画面，md5 必须不同
cap screenshot --window <id> --path a.png
xcrun devicectl device process launch --device <udid> --terminate-existing com.apple.mobilesafari
cap screenshot --window <id> --path b.png
md5 -q a.png b.png        # 一样 ⇒ 镜像冻了，拔插数据线重来

# 3. **把取景器提到最前**，再拿一帧探针确认裁出来的是手机而不是别的窗口
osascript -e 'tell application "QuickTime Player" to activate'
ffmpeg … -t 2 -vf "crop=880:1898:<x*2>:<y*2>" probe.mov   # 抽一帧看

# 4. 声源循环外放（手机扬声器在镜像时是静音的，App 听的是 Mac 的喇叭），记 epoch
# 5. 开录（150 s 足够），记 epoch
# 6. 跑 runner 驱动手机
```

### 手机上的前置（不配好，录出来每句都是「译文失败」）

TestFlight 新装的包容器是空的，而 runner 一上来就点「以后再设置」跳过引导 ⇒ **没有引擎、没有 key**。
转写是设备内置的（不要 key），翻译要调引擎，于是每句「译文失败 · 重试」。

- **一键卡里没有 DeepSeek**（它只收能同时做翻译/朗读/转写的平台）；卡上默认的 OpenRouter
  在**境内对默认模型返回 403**。
- 可用的组合：**「详细」档 → 翻译与句子解析 → DeepSeek + key**（真机实测无 VPN 可用），
  或翻墙之后用一键卡的 OpenRouter。
- runner 里有通用的 `testFillKey`（`MT_TARGET_BUNDLE` / `MT_TAB` / `MT_PLATFORM` / `MT_KEY` / `MT_KEY_LEN`），
  判据是**圆点数 == key 长度**。⚠️ 但它找密钥框用的是 `secureTextFields.firstMatch`，
  在「详细」档下**仍可能抓到一键卡那个** —— 用之前先看回读里的「平台当前 / 按钮」两行确认落在哪张卡上。
  **这一步人手配三十秒，比调这个测试快。**

### 驱动手机的现成用例

| 段 | 用例 | 覆盖 |
|---|---|---|
| App + 画中画 | `testPiPClose` | 开 App → 跳过引导 → 实时字幕 → 开始 → 开 Safari 测试页 → 点播放 → 画中画浮出 |
| 系统翻译 | `testT1Safari` / `testT1Default` | 设成默认翻译 App → 在别的 App 里选字 → 翻译 |
| 配 key | `testFillKey` | 见上 |
| **任何新流程** | **`testDrive`** | **脚本驱动：步骤用 JSON 从 `MT_SCRIPT` 传进去，不用改 Swift、不用重建 runner** —— 也就不会触发上面那道证书重校验。步骤表见 `tools/ios-runner/README.md` |

```bash
cd .local/spike/S6
TEST_RUNNER_MT_TARGET_BUNDLE=… TEST_RUNNER_MT_PIP_URL=… \
xcodebuild test-without-building -project runner/S56Runner.xcodeproj -scheme S56Runner \
  -destination id=<udid> -derivedDataPath dd-runner -resultBundlePath x.xcresult \
  -only-testing:S56UITests/S56UITests/testPiPClose
xcrun xcresulttool export attachments --path x.xcresult --output-path att   # **判据看附件，不看 passed**
```

### 合成

```bash
STORE_MEDIA=.local/store-media APP_MOV=… APP_IN=… APP_DUR=… \
PIP_MOV=… PIP_IN=… PIP_DUR=… PIP_T0=… SYS_MOV=… SYS_IN=… SYS_DUR=… \
AUDIO=… AUD_T0=… bash store-assets/src/compose-preview-ios.sh zh
```

顺序 题卡 → App 段 → 画中画段 → **系统翻译段** → 结尾卡。缺系统翻译段、或总长超 30 s，都报错退出。

⚠️ **声源是循环放的**，而脚本按 `PIP_T0 + PIP_IN - AUD_T0` 算音轨入点 —— 超过一轮就越界。
传 `AUD_T0` 时要**加上整数轮的长度**，让入点落回一轮之内（`ios-align.txt` 里有算好的式子）。

## 陷阱索引

| 现象 | 真因 | 判据 / 对策 |
|---|---|---|
| 窗口全黑 / AX 0 窗口 / `System Events -1719` | **屏幕锁了** | 整屏截图字节数 + 已知正常窗口当对照 |
| 录出来 155 秒是同一张图 | QuickTime 的手机镜像冻了 | 两帧 md5 必须不同；冻了就拔插数据线 |
| QuickTime 重启后来源退回内建摄像头 | 它不记住 iPhone 那个来源 | 那个 ⌄ **悬停才浮出**，AX 上 `AXPress` 报 `-25204` ⇒ 用元素报出来的 frame 做**像素点击**，别自己算坐标 |
| 录到的是自己的终端 | 取景器窗口**被别的窗口盖住**（坐标对 ≠ 在最上层） | 先 `activate`，再拿探针帧确认 |
| `ffmpeg -i "7:none"` 报 I/O error | `avfoundation` 的**屏幕设备号会变**（7 ↔ 5） | 每次录前重新 `-list_devices` |
| 「"某某iPhone"的相机」打不开 | 那是**连续互通相机**，不是手机屏幕 | 手机屏幕只能走 QuickTime |
| QuickTime 存不出文件、⌘S 没反应 | 沙盒只认存储面板；脚本路径一律无权限 | 别让它录，只当取景器 |
| runner 起不来 `Developer App Certificate is not trusted` | **重建了 runner** ⇒ 新二进制要联网重校验证书（证书与描述文件其实两个月没变，只有 CDHash 变了）| 让用户在主屏点一下 `S56UITests-Runner` 图标；**「VPN与设备管理」里没有「开发者App」那一节**。根治办法是**少重建** —— 用 `testDrive` 写 JSON |
| 画中画里只有原文 | 手机上没配翻译引擎 | 见上；判据是原文**下面**有译文 |
| Safari 里视频没播 | 本机测试页**被 Safari 缓存**了 | URL 加 `?v=N`；页面 `<video autoplay muted>`（镜像时喇叭本来就静音，静音不损失） |
| Chrome 弹「翻译此页？」进了录屏 | `--disable-translate` / `--disable-features=Translate` **都拦不住** | 页面自己 `translate="no"` + `<meta name="google" content="notranslate">` |
| 字幕一直是占位文案 | 声源放完了（`conv.wav` 只有 56 s，画中画在第 95 s） | 循环外放 |
| 测试 passed 但什么都没发生 | 环境变量少了 `TEST_RUNNER_` 前缀 | 判据看附件里的 note |

## 相关

- `store-assets/README.md`「App Preview 视频」—— 输入怎么生成、录屏参数
- `.claude/skills/store-release/assets.md` —— 素材是否过时、截图管线
- `docs/verification-spec.md` §0.2.3 —— XCUITest 驱动真机的十件事
- `store-assets/src/compose-preview.sh` · `compose-preview-ios.sh` · `make-preview-inputs.sh`
- `store-assets/src/preview-quick.html`（快速翻译背景页）· `preview-stage.html`（字幕段声源舞台）
