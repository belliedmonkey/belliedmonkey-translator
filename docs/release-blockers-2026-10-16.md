# 2026-10-16 发 iOS 新版核对

核对日：2026-10-16。只读仓库、issue 评论和 App Store Connect。没有改产品代码，没有打包、上传、提审、推送。

结论只用三词：**已修已验**、**已修未验**、**未修**。

## 1. 分支

工作树 `mobiletranslator-592`。分支 `cursor/feat-592-unified-subs`。

HEAD `90329adf2db98f760969a2b4723d8180451e7bf5` `docs(listen): 写下 AEC3 探针的结论（#595）`。

| 对照 | 对方尖端 | 本分支比它多 | 对方有、本分支没有 |
|---|---|---|---|
| 本地 `main` | `126289eb42ac03f67bce280b4b7e389e8eba935a` `fix(win-matrix): React 菜单轮询等待 + Firefox 特权页截图兜底 + 测试页地址读 MT_WIN_PAGE（#542） (#587)` | 53 | 0 |
| `origin/main` | `c2aae718f5a5eccc73101df1de7cdcb8c770ea3c` `fix(listen): 听译不丢句头、首启不回包屏、识别名额不乱（1.19.4 r6） (#589)` | 52 | 0 |
| `cursor/fix-1194-r6` | `a39f81921bb5f1b3dbe2db42b6f709219bc69086` `docs(verify): 录屏前用 caffeinate 撑住显示器、QuickTime 浮动置顶后录整屏（#588）` | 53 | 5（见下） |
| `cursor/fix-590-live-subs` | `337184195cf0c1f82a047d4743c75016bc29ef7a` `fix(listen): 系统录音的 sound 与听到门槛同一道门（#590 A）` | 36 | 0 |

本地 `main` 比 `origin/main` 少 1 个提交：`c2aae718f5a5eccc73101df1de7cdcb8c770ea3c`。这个提交在本分支里。

`cursor/fix-1194-r6` 上有、本分支历史里没有的提交（`git cherry` 五行都是 `+`，不是等价补丁）：

- `2a3142e25b40e2b24b5fcfbe9695d143a374d791` `fix(listen): 听译不丢句头、首启不回包屏、识别名额不乱（1.19.4 r6，#588）`
- `f6c1ee2f05b7c1741c9a8fa1c44907c715a5fc1b` `chore(i18n): 重新生成 i18n-messages.js（#588）`
- `3bfa8d8ed1a6eb6fbefbfc4d25c013d93d202f0c` `fix(listen): 点停的 force 不再漏到下一次收音；录音键的行按进账本时刻判 pinned（#588）`
- `c3dab93aa950c3ab2187c08f57f429c63714ca54` `design(pencil): 改稿 I · 识别语言名额第四种状态「本机已有」（待评审，#588）`
- `a39f81921bb5f1b3dbe2db42b6f709219bc69086` `docs(verify): 录屏前用 caffeinate 撑住显示器、QuickTime 浮动置顶后录整屏（#588）`

同一项工作合进 `origin/main` 的提交是 `c2aae718f5a5eccc73101df1de7cdcb8c770ea3c`（#589），它在本分支里。上面五个提交号本身不是本分支的祖先。

## 2. 逐条

### #588 三个问题

**已修已验。**

修复在本分支的祖先 `c2aae718f5a5eccc73101df1de7cdcb8c770ea3c`。HEAD 上仍有 `listenPacksDone`（`src/app/shell-model.js`）、`gate:release`（`app/listen-core.js`）、`quotaSelectPlan`，以及 `runsOf(lc).length` 才置 `force`（`app/listen-core.js`）。

复测：

- Mac：[issuecomment-6122795722](https://github.com/belliedmonkey/belliedmonkey-translator/issues/588#issuecomment-6122795722)、录像 [issuecomment-6123148773](https://github.com/belliedmonkey/belliedmonkey-translator/issues/588#issuecomment-6123148773)（2026-10-12，分支 `3bfa8d8e`：6/6 句整句，冷启动 3/3 落首页）。
- iPhone：[issuecomment-6124147392](https://github.com/belliedmonkey/belliedmonkey-translator/issues/588#issuecomment-6124147392)（2026-10-12 19:20–20:17，ZHAO的iPhone 14 Pro，iOS 27。中国版 1.19.4 Release 直装 `3bfa8d8e` + `c3dab93a`，不是 TestFlight。名额保持 2/5；下完包后冷启 5/5 再 2/2 落首页；12 句 → 12 行）。

这次没有在本分支 HEAD 上再跑这三条。录屏没达标，判据是 runner 截图，写在同一条 iPhone 评论里。未覆盖：iPad、国际版真机；第 6 门提示只有自动化。

### #588 36 个文案键

**已修已验。**

issue 正文这一节：34 个界面键没进 `_locales`，另外 2 个是提示词、按设计不进表。修法是补 38 个键（34 个漏掉的 + r6 新的 4 个）× 13 种语言，并加 `test/app-i18n-keys.test.js`。两条提示词 `listen_seg_system`、`listen_seg_user` 在白名单里。

`c2aae718f5a5eccc73101df1de7cdcb8c770ea3c` 带上这 38 个键和这道门。2026-10-16 对过 HEAD：这 38 个键在 13 个 `extension/_locales/*/messages.json` 里都在；那两个提示词键仍不在 `en/messages.json`。

复测记录：PR #589 正文写 `npm test` 2687 通过、0 失败。`test/run.js` 加载每一个 `*.test.js`，`test/app-i18n-keys.test.js` 在同一提交里。这次盘点没有重跑 `npm test`。没有「13 种界面语言在真机上逐键看过」的记录。

### #590 默认语言

**已修未验。**

`264250981bbfa109eb23b0823bf5da8f7cc4a93b`：视频的语言 = `subtitleVideoLang`，缺省 `auto`。单测 `test/listen-590.test.js`「语言键：视频的语言 = subtitleVideoLang（缺省自动），译成 = listenMyLang」断言 `src/store/schema.js` 的缺省是 `auto`。代码在 `src/app/listen-model.js` 读 `subtitleVideoLang`。

没有 iPhone 截图证明一台新装或清空存储之后，左格是「自动」。Mac 场次是人手把视频语言改成「自动」。TestFlight 中国 iOS 111 / 国际 iOS 168 的源是 `c2aae718`（[issuecomment-6124767625](https://github.com/belliedmonkey/belliedmonkey-translator/issues/588#issuecomment-6124767625)），早于这个提交。

### #590 与对话串键

**已修未验。**

同一提交 `264250981bbfa109eb23b0823bf5da8f7cc4a93b`。存储：视频的语言写 `subtitleVideoLang`，译成写 `listenMyLang`（与对话共用「我的语言」）。`src/app/listen-model.js` 注释写明两格曾经挂在相反的键上。写回在同文件 `subtitleVideoLang` / `listenMyLang` 两行。单测就是上一条那一个。

没有 iPhone 记录证明：只改字幕的视频语言，对话的语言对不动。译成继续共用 `listenMyLang` 是这次修复写明的存储，不是又一条未改的串键。

### #590 30 秒静音门

**已修未验。**

- `264250981bbfa109eb23b0823bf5da8f7cc4a93b`：一次声音都没听到之前，不按 30 秒停。
- `28a55a5d02c36863e3d00904658afa09b6c6e5e4`：断档不计入静音。提交正文里的「真机录屏复现」是断档被当成静音、第一帧当场暂停这一条的复现，不是修复之后的通过记录。

单测：`test/listen-590.test.js` 的 `#590 · 静音门（iOS 4 / A）`。

iPhone 修复前的读数：[issuecomment-6142459737](https://github.com/belliedmonkey/belliedmonkey-translator/issues/590#issuecomment-6142459737)（中国版 1.19.4 build 111）。约 14 秒停在「已暂停 · 00:14」，无障碍树里没有「30 秒没有声音」。那一条早于上面两个提交。

修复之后的出声记录是 Mac 系统录音（`33718419` 之后的评论 6160719613、6161053763、6161264315），不是 iPhone「切到 Safari、开场被 30 秒门吞掉」那一条。没有修复之后的 iPhone 复测。

### #590 画中画恢复抢源音频

**已修未验。**

`4f80027055a875ad84caab42137011cbc5684662`，单测 `42ccc41918466333d0b00f04e8600285f1bf0762`。`test/listen-590.test.js`「iOS 5：字幕暂停不拆音频会话；媒体遥控在字幕这场不暂停」。

[issuecomment-6167767044](https://github.com/belliedmonkey/belliedmonkey-translator/issues/590#issuecomment-6167767044)（2026-10-14，停在 `33718419`）把「iOS 5 会话收尾」写成 **待验**：单测有，真机回读没有。同条表里写「iPhone 画中画播放键都还没回读」。修复前的 [issuecomment-6142459737](https://github.com/belliedmonkey/belliedmonkey-translator/issues/590#issuecomment-6142459737) 也写了系统画中画的 ▶ 没有点。

### #569 第 1 处 `docs/telemetry-design.md`

**已修未验。**

`a72b9ee24fb50722778329000b613ae8ccc29de2` 是本分支祖先。走的是 issue 写的第二条路：独立通道，不进遥测白名单。节在 `docs/telemetry-design.md`「诊断上报（diagnostic upload）—— 独立通道，不进遥测白名单」。同节仍写：`belliedmonkey.com` 的隐私页必须同版本改写（#569）。

#569 评论数 0。没有这处改动的 `npm test` 或人工核对记录。

### #569 第 2 处 `build/telemetry.config.js`

**已修未验。**

同一提交没有改 `build/telemetry.config.js`。2026-10-16 在这个文件里搜 `diag` / `diagnostic`，没有命中。issue 允许的两条路里，选中的是「不走白名单，就在同一文档写明」。写明的位置就是上一节。

#569 评论数 0。issue 正文要求的 `test/telemetry-registry.test.js` 四道门禁，没有记在这条 issue 上。这次没有重跑。

### #569 第 3 处 两站隐私页 + `AGENTS.md` 规则 4 的注

**未修。**

`AGENTS.md` 规则 4 的注已在 `a72b9ee24fb50722778329000b613ae8ccc29de2` 改掉：中国版不再「一个字节都不发」，并写两站隐私页必须同版本改写。这一处 issue 把两站和这句注放在一起，两站线上没有诊断披露，所以整处记未修。

2026-10-16 读线上（curl，HTTP 200）：

- `https://belliedmonkey.com/privacy.html` 仍有：「在你登录之前，本 App 不会向我们的服务器发送任何关于你或你的内容的数据。」页内没有「匿名诊断」。同页另有一句「不开启同步，它们一个字节都不会离开这台设备」，说的是同步关闭时的本机存储。
- `https://belliedmonkey.cc/privacy.html` 页内没有 diagnostic / 诊断上报这段。

本地克隆不是线上页：

- `~/belliedmonkey-com` `5d6fe2db3a1c327fd6a573f0085007ea3145d065` `docs(privacy): 中国版隐私页随诊断 L2 改写`。本地 `privacy.html` 第 43 行仍是那句登录前的绝对句，同句后面加了匿名诊断例外。这版没有出现在上面读到的线上页里。
- `~/belliedmonkey-cc` 诊断段在 `ad0644161aa6a3770cbdb831b68adf64305eca42`。克隆 HEAD 是 `701c1157632639e6c486daeba47dba268c2e00ca`。英文诊断段在本地 `privacy.html`，不在上面读到的线上页里。

`www.belliedmonkey.com` 这次 TLS 握手失败，没有第二遍对照。

### #592 QwenCloud 部署前清单

**未修。**

清单是 `docs/relay-qwencloud-rollout.md`，提交 `ad4ec5ab7d12b17da6b8796b17b457f11dca6b06`。第 0 节标题是「现在还不能按这一份上线」。第 2–4 条标着待确认：`cn-cidrs.txt` 会不会随函数发布、托管函数请求上有没有 `X-Real-IP`、中国 IP 的朗读和转写模型 id。没有「清单已经执行、开关已经按灰度打开」的记录。

本分支国际版免费额度的客户端模型名已经改掉（`a88626e009412a70e4b8bbbddc831370cda93e33` 起）：`build/providers.config.js` 国际版 `qwen3.7-plus`，`build/tts.config.js` `qwen3-tts-flash`，`build/stt.config.js` `qwen3-asr-flash`。同一处注释写：与中继一起发布，否则每次请求 403。清单第 1 节写：只部署代码、不打开开关，新客户端仍然 403。中国区聊天仍从 `qwen` 那一条填，`defaultModel` 是 `qwen-plus`。`grant_speech` / `grant_stt` 的 `flavors` 只有 `global`。

### #592 客户端 IP 请求头

**未修。**

`docs/relay-client-ip-proposal.md` 提交 `125ba541c3611d5ceadbbfac4f1fc265ab3632c5`，正文第一段写：只提案，不改代码。`supabase/functions/bt-relay/index.ts` 仍是 `isChina(req.headers.get('x-real-ip') || '', ...)`。提案引用的 [issuecomment-6188976386](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592#issuecomment-6188976386)：托管函数上三次读到 `X-Real-IP` 为 absent，包括客户端自己送了这个头的那次。`deploy/china/Caddyfile` 会写 `X-Real-IP`，提案写那次验证没有打到中国机这条路径。

## 3. 最近一次 iPhone 真机完整回归

**没有。**

`docs/verification-spec.md` 里标题含「全回归」且含 iPhone 真机行的，最近两份是「全回归（2026-09-19，1.13.x 提审前）」和「全回归（2026-09-14）」。09-19 的 iPhone 行是 1.13.1 调试包上的部分行，文中没有 TestFlight build 号。09-14 基线是 `a6edddf`，真机行没有 build 号。09-28 那份全回归把「真机（ZHAO的iPhone）」写成待安排。2026-10-12 的 [issuecomment-6124147392](https://github.com/belliedmonkey/belliedmonkey-translator/issues/588#issuecomment-6124147392) 是 #588 三条的定向验收，不是完整回归，也没有商店 build 号。日期、build 号、结果这三项没有凑齐的一份。

## 4. 当前最新 TestFlight

来源：2026-10-16 读 App Store Connect API `GET /builds`（按 `uploadedDate` 取各平台最新一条，并读 `preReleaseVersion.version`）。四条都是 `VALID`，`expired=false`。

| 线 | bundle id | 版本 | build | 上传时间（API 原文） |
|---|---|---|---|---|
| 国际 iOS | `com.belliedmonkeytranslator` | 1.19.4 | 168 | 2026-10-12T05:58:12-07:00 |
| 国际 macOS | `com.belliedmonkeytranslator` | 1.19.4 | 117 | 2026-10-13T22:53:16-07:00 |
| 中国 iOS | `com.belliedmonkeytranslator.cn` | 1.19.4 | 111 | 2026-10-12T05:46:51-07:00 |
| 中国 macOS | `com.belliedmonkeytranslator.cn` | 1.19.4 | 109 | 2026-10-12T05:48:31-07:00 |

仓库里对得上的记录：iOS 四条里的 111 / 168 以及当时的 macOS 116，见 [issuecomment-6124767625](https://github.com/belliedmonkey/belliedmonkey-translator/issues/588#issuecomment-6124767625)（源 `c2aae718`）。国际 macOS 117 见 [issuecomment-6161918936](https://github.com/belliedmonkey/belliedmonkey-translator/issues/590#issuecomment-6161918936)（源 `cursor/fix-590-live-subs` @ `33718419`）。API 没有返回比上表更新的 build。111 和 168 早于 #590 的修复提交。

## 5. 三栏

条数：必修 7，建议修 2，可带着发 2。

### 必修

1. **#590 默认语言（已修未验）。** 依据：第 2 节。iOS 111 上报的，修复在 111 之后，没有 iPhone 复测。
2. **#590 与对话串键（已修未验）。** 依据：第 2 节。视频语言与译成的键已分开；没有 iPhone 复测证明对话语言对不动。
3. **#590 30 秒静音门（已修未验）。** 依据：第 2 节。单测在；iPhone 只有 build 111 上、修复前的读数。
4. **#590 画中画恢复抢源音频（已修未验）。** 依据：第 2 节。[issuecomment-6167767044](https://github.com/belliedmonkey/belliedmonkey-translator/issues/590#issuecomment-6167767044) 写明待验。
5. **#569 第 3 处两站隐私页（未修）。** 依据：第 2 节。线上中国页仍是登录前绝对句，且没有匿名诊断段；线上国际页没有诊断段。issue 要求与功能同版本。L2 从 `36465e49` 起会在登录前发诊断事件。
6. **#592 QwenCloud 部署前清单（未修）。** 依据：第 2 节。清单第 0 节写现在还不能按这一份上线。本分支国际版免费额度客户端已经改用 `qwen3.7-plus` / `qwen3-tts-flash` / `qwen3-asr-flash`，清单写开关不开则这些名字 403。
7. **#592 客户端 IP 请求头（未修）。** 依据：第 2 节。代码仍只读 `x-real-ip`；托管函数实验三次 absent。清单第 3 条把这件事标成待确认，不解决就不能按清单第 1 节的顺序打开开关。

### 建议修

1. **#569 第 1 处 `docs/telemetry-design.md`（已修未验）。** 依据：`a72b9ee24fb50722778329000b613ae8ccc29de2` 已写独立通道。#569 评论数 0。同节仍写隐私页必须同版本改写。
2. **#569 第 2 处独立通道、未改 `build/telemetry.config.js`（已修未验）。** 依据：第 2 节。文档写了为什么不进白名单。issue 点名的 `test/telemetry-registry.test.js` 没有记在 #569 上，这次没有重跑。

### 可带着发

1. **#588 三个问题（已修已验）。** 依据：第 2 节。修复在 `c2aae718f5a5eccc73101df1de7cdcb8c770ea3c`。iPhone 复测是 2026-10-12 直装 `3bfa8d8e`，不是本分支 HEAD，也不是 TestFlight 111。
2. **#588 36 个文案键（已修已验）。** 依据：第 2 节。38 个键 × 13 语言在 HEAD 上仍在；PR #589 的 `npm test` 2687/0 包含这道门。这次没有重跑。
