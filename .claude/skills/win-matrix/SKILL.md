---
name: win-matrix
description: 在 Windows 上验大肚猴翻译（验收矩阵第 8 行：Windows 11 Chrome / Edge / Firefox）。目标是宿主机 omarchy 上的 KVM 虚拟机（libvirt 域 win11，macvtap 静态 IP 192.168.50.237），从 Mac 走网络驱动，命令与包经 QEMU guest agent 送入，不进 Windows 点鼠标。任何全回归、任何动了字幕 / 语音 / 排版的改动要补 Windows 这一行时跑它；用户说「在 Windows 上看看」也跑它。
---

# win-matrix —— Windows 这一行：KVM 虚拟机，从 Mac 上驱动

规约在 `docs/verification-spec.md` §1 第 8 行与 §2.H；这里是**可执行**的那一半：命令、参数、每一步回读什么才算数。
脚本全在 `scripts/win-matrix/`，结果落在 `.local/win/`（不提交）。

## 什么时候跑

- 全回归（§0：矩阵只增不减，Windows 是其中一行，没跑写 ⬜ 不写 N/A）。
- 改了 `extension/content/**`、`styles/**`、字幕适配器、语音（TTS）相关代码。
- 用户报的问题只在 Windows 上出现，或者要排除「是不是 Windows 特有」。

## 目标（2026-10-02 用户裁定：VM 从 Mac 搬到 omarchy 桌面）

- **宿主机 `omarchy`** = `100.69.15.88`（tailscale）/ `192.168.50.5`（LAN），root 登录（key `~/.ssh/id_ed25519_omarchy`）。
- **客户机**：libvirt 域 `win11`，Windows 11 Pro 26H2（26300.9457）简体中文，**静态 IP `192.168.50.237`**（macvtap on `enp4s0`），4 vCPU / 8 GiB / 80 GiB qcow2，随宿主自启。账号 `win` / `MtTest2026!`，常驻自动登录。
- **从 Mac 直连 `192.168.50.237`**；宿主本身看不到客户机（macvtap 隔离）——驱动只要从 Mac 走。
- **命令与文件走 QEMU guest agent**（`virsh qemu-agent-command`），不走网络：宿主 `/root/win11/ga.sh`（cmd.exe）、`gps.sh`（PowerShell）。IP 配错也能靠这条救回来。
- 测试页地址用 `MT_WIN_PAGE`：本拓扑 Mac 是 `192.168.50.231`，即 `http://192.168.50.231:8765/page.html`（**别用默认的旧地址 `192.168.2.1`，那是不通的**）。
- 历史：2026-09-18 那台 Mac 上的 VMware Fusion ARM VM 已退役，记录在 §2.H「Historical record」。

## 0. 共同前提

```bash
node build.js                                   # dist/ 与 dist-firefox/ 要是这次要验的那个版本
node scripts/local-keys.js check                # 翻译引擎必须是 deepseek 且 key 已填 —— 脚本从 .local/keys.md 读，不回显
```

**每一条在 Mac 上跑的 node 命令都要清掉代理变量**：

```bash
clean(){ env -u NODE_USE_ENV_PROXY -u HTTP_PROXY -u http_proxy -u HTTPS_PROXY -u https_proxy -u ALL_PROXY "$@"; }
```

这台 Mac 的 shell 带着代理变量，Node 认 `NODE_USE_ENV_PROXY`：不清掉，连 192.168.x 的请求都会被送去代理，换回 503 / 空 body，
报错是 `bad json`，看不出是代理。`curl` 同理要 `--noproxy '*'`。

## 每次怎么跑

1. **Mac 侧起包与测试页**（一个放着 `dist-chrome.zip` / `dist-firefox.zip` / `page.html` 的目录）：
   ```bash
   cd .local/win/serve && python3 -m http.server 8765 --bind 0.0.0.0
   ```
2. **把包送进客户机**（宿主上，经 guest agent）：
   ```bash
   # /root/win11/gps.sh 在 win11 里跑 PowerShell
   /root/win11/gps.sh "Invoke-WebRequest -UseBasicParsing http://192.168.50.231:8765/dist-chrome.zip -OutFile C:\mt\dist-chrome.zip; Expand-Archive C:\mt\dist-chrome.zip -DestinationPath C:\mt\dist -Force"
   # dist-firefox.zip → C:\mt\dist-firefox
   ```
3. **起浏览器 —— 必须在用户会话（session 1），不能在 session 0**。guest agent 是 SYSTEM（session 0），
   在那儿起的浏览器没有桌面、不渲染，**所有 CDP `Page.captureScreenshot` / `Runtime.evaluate` 都会超时**。
   用计划任务 `-LogonType Interactive` 以 `WIN11-MT\win` 起（现成脚本 `/root/win11/launch-chrome.ps1`、
   `launch-edge.ps1`、`launch-firefox.ps1`），并带 `--hide-crash-restore-bubble --disable-session-crashed-bubble`
   —— 强杀 Chrome 会留「要恢复页面吗」气泡，一样会卡住渲染进程。
4. **Mac 上跑脚本**（清代理变量 + 设 `MT_WIN_PAGE`）：

```bash
V=192.168.50.237
MT_WIN_PAGE=http://192.168.50.231:8765/page.html clean node scripts/win-matrix/chromium.js $V 9223 'C:\mt\dist' chrome   # 或 edge
MT_WIN_PAGE=… clean node scripts/win-matrix/firefox.js  $V 9223 'C:\mt\dist-firefox'
MT_WIN_PAGE=… clean node scripts/win-matrix/yt-subtitles.js $V 9223
MT_WIN_PAGE=… clean node scripts/win-matrix/speech-fullscreen-chromium.js $V 9223 chrome
MT_WIN_PAGE=… clean node scripts/win-matrix/speech-fullscreen-firefox.js  $V 9223 <firefox.js 拿到的扩展 uuid>
```

每段的判据：

| 段 | 回读什么才算过 |
|---|---|
| 连得上 | `curl -s --noproxy '*' http://$V:9223/json/version` 回出 `Browser`（Firefox 没有这个端点，直接跑 `firefox.js`）|
| 装载 + 翻译 | `problems: []`、`version` 等于 `package.json`、4 条译文（标题 + 三段，**全含汉字且没有一条还是「⏳ 翻译中…」**）|
| 语音 | 中文、英文各自的 `start` 是数字。`start: null, timeout: true` 就是静音，不是通过 |
| 全屏 | 进全屏后叠层在 `document.fullscreenElement` 里且可见，隔 8 秒译文换了一句，退出后叠层还在 |
| YouTube 字幕 | `yt-subtitles.js` 末行 `subtitleAfterAdMs` 是数字；有广告时前面应有「广告结束」一行 |

## 网络与语音的两条平台前提（跑之前先确认）

- **YouTube 要经宿主代理。** VM 直连出口在国内 ⇒ youtube.com 不通，症状像「渲染进程冻住」。客户机有第二条
  NAT 网卡（`192.168.122.50`），宿主 `mt-proxy-relay.service` 把 mihomo 的 mixed 端口中继到 `192.168.122.1:7897`。
  Chrome/Edge 启动带 `--proxy-server=http://192.168.122.1:7897 --proxy-bypass-list=192.168.50.*;192.168.122.*;<local>`；
  Firefox 在 profile 的 `user.js` 里设 `network.proxy.type=1` 且 `http` **和 `ssl`** 都指 `192.168.122.1:7897`。
- **英文语音要本地声。** zh-CN Windows 默认只有本地中文声（Huihui / Kangkang / Yaoyao）；en-US 回落到连不上的
  Google 在线声，`start` 永远不出现。装 `Language.TextToSpeech~~~en-US~0.0.1.0` 能力后出现本地 `Microsoft Mark`。

## YouTube 怎么验才算数

2026-09-18 一整天，「虚拟机上 YouTube 字幕拿不到」先后被归因成未登录、服务端拦截、日本出口节点、会话被拒，还写进了规约和记忆。
**四条全错**，真因是自动化里没人点「跳过广告」，片头广告把 8 次取字幕耗光、锁死在「字幕不可用」（#325 / PR #326）。所以：

- **读数里必须带广告状态。** `#movie_player` 有没有 `ad-showing` / `ad-interrupting`。广告期间正片的字幕请求本来就不存在。
- **timedtext 要按当前视频 id 过滤。** 广告自己也会发 `/api/timedtext`，广告没字幕，响应体是 0 字节 —— 不过滤就会读成「YouTube 给了空字幕」。
- **别用肉眼看 YouTube 原生字幕。** 「译」开着时扩展注入 `.ytp-caption-window-container{opacity:0}` 把它藏了。
- **「译」菜单自 v1.19.0 起是 React 渲染的**（`content/sub-menu.bundle.js`）：点 `#mt-yt-btn` 只开菜单，开关是
  `#mt-yt-menu > div` 第一行；**要轮询等它出现**，固定 600 ms 会读成 `null`。
- 桌面版的字幕翻译由播放器里的「译」按钮控制。
- 广告随机且有频控：连看几次后就不投了。要复现长广告：`NOSKIP=1` 多跑几次。
- 浏览器界面语言是中文时，YouTube 会自动选人工中文字幕轨 ⇒ 原文即目标语言 ⇒ 同语跳过，只有一行中文、译文为空。这是设计，不是缺陷。
  （要拿「英文原文 → 中文译文」，启动加 `--lang=en-US --accept-lang=en-US`。）
- **归因之前先找一个能证伪的最便宜的测试。** 这次那个测试就是「点掉广告再看」，做它只要十秒。

## 陷阱索引

| 看到什么 | 其实是 | 怎么办 |
|---|---|---|
| 浏览器起来了、CDP 也连上，但 `Page.captureScreenshot` / `Runtime.evaluate` 全超时 | 浏览器在 **session 0**（guest agent 起的）/ 或 Chromium 的「要恢复页面吗」气泡挡住了渲染进程 | 用计划任务 `-LogonType Interactive` 以 `WIN11-MT\win` 起；加 `--hide-crash-restore-bubble --disable-session-crashed-bubble`；回读桌面截图确认没有弹窗 |
| 页面在导航后卡死、`Runtime.evaluate` 超时、`yt-subtitles` 报 `Runtime.evaluate wasn't found` | VM 直连出口在国内，**youtube.com 被墙**，不是渲染器坏 | 走宿主代理（见上）；先 `curl.exe -x http://192.168.122.1:7897 https://www.youtube.com` 确认 200 |
| Firefox `NS_ERROR_NET_RESET` / 打不开外网 | `user.js` 只设了 `network.proxy.http` + `share_proxy_settings`，HTTPS 走了直连 | 同时设 `network.proxy.ssl` 和 `network.proxy.ssl_port` |
| 英文 TTS `start: null, timeout: true` | zh-CN 系统没有本地英文声，回落 Google 在线声（连不上） | 装 `Language.TextToSpeech~~~en-US~0.0.1.0`；回读 `(Get-WindowsCapability …).State` = `Installed` |
| `ytMenuRow: null` / 菜单第一行拿不到 | v1.19.0 菜单是 React 异步渲染，点完按钮 600 ms 还没出来 | 轮询等 `#mt-yt-menu > div`（脚本已改） |
| 键盘自动化打出来的命令变汉字/乱码 | 中文输入法（微软拼音）拦截按键 | 每个新窗口先 tap 一次 `Shift` 切英文再打字 |
| Mac 连 `<ip>:9222` 超时，Windows 本机 `127.0.0.1:9222` 是通的 | 桌面 Chrome / Firefox **不认** `--remote-debugging-address`，只听回环 | 客户机上已做（重装才需要）：`netsh interface portproxy add v4tov4 listenport=9223 listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1` + 防火墙放行 9223 |
| `FAILED bad json` / curl 回 503 | Mac 这边的代理变量 | 清代理变量；curl 加 `--noproxy '*'` |
| `CDP File path cannot be resolved` | dist 的 Windows 路径不对 | 客户机上路径是 `C:\mt\dist` / `C:\mt\dist-firefox`（本拓扑固定的）|
| Edge：`CDP Method not available` | Edge 154 仍不开放 `Extensions.loadUnpacked` | 启动时加 `--enable-unsafe-extension-debugging --load-extension=C:\mt\dist`；`chromium.js` 会自动退回去找已装的扩展 |
| `没找到扩展的 service worker` | 浏览器刚起、SW 还没注册；或 MV3 的 worker 空闲 30 秒退出 | 等 CDP 就绪再跑；补充脚本会退回读 `.local/win/<label>.json` 里的 `extId` |
| `eval: ReferenceError: chrome is not defined`（种配置时） | 重复 `loadUnpacked` 会重载扩展，刚匹配到的 worker 正在退场 | `chromium.js` 已重找重试 |
| 译文「卡在 ⏳ 翻译中… 30 秒」 | 断言把占位符当成了中文译文（它也含汉字） | 判据必须排除 `翻译中` / `加载中` / `准备中` |
| Firefox：WebSocket 握手 400 | 远程代理只认 `Host: 127.0.0.1:9222` | `lib/raw-ws.js`（手写 RFC 6455，能改 Host）|
| Firefox：`Navigation to "moz-extension://…" is not allowed` / 自导航被拒 | BiDi 禁止导航到扩展页；跳板页必须真的能加载 | 跳板页用 `MT_WIN_PAGE`（别硬编码旧网段）；UUID 从预置 profile 的 `prefs.js` 读，或直接查 `browsingContext.getTree` 里 `moz-extension://<uuid>/` 的实际 uuid |
| Firefox：`captureScreenshot` 回「privileged scope」 | Firefox 157 的 BiDi 不支持对特权上下文截图 | 视为可选（`firefox.js` 已容错）；证据用网页截图 |
| Firefox：`Maximum number of active sessions` | 只许一个 BiDi 会话；上个客户端被强杀后 portproxy 攥着内侧连接 | 只能重启 Firefox；脚本须在每条退出路径 `session.end` |
| 全屏：发了 Esc 还在全屏 | CDP 的按键只到页面，浏览器级退出全屏不吃 | `document.exitFullscreen()` |
| Chrome：英文在线声第一次 `speak()` 15 秒无声无错 | Google 在线声首次调用的预热 | 装本地英文声即可绕开；否则第二次再量 |
| 把截图 `read` 进对话，报 `a request may include at most 20 images` | 对话里累积的图片超上限 | 用 `.local/win/vmocr.sh`：截图 → macOS Vision OCR → **只回文字** |

## 结果记到哪

- 原始证据：`.local/win/<label>.json` + 截图（不提交）。
- 规约：§1 第 8 行的状态格、§1.0 四张分面表的 Windows 行、§2.H。**没跑的写 ⬜，不写 N/A；写了 ✅ 就要带日期和读数。**
- 发现产品缺陷：开 issue → 先红后绿的用例 → 修 → PR（#325 / #326 是样板）。

## 还欠着的（2026-10-02）

- **Firefox 上的 YouTube 真字幕**：叠层只出「字幕不可用，先在设置里选择转写引擎」（Firefox 拿不到 caption 轨）。
  `speech-fullscreen-firefox.js` 写于 #325 查明之前、也不点「跳过广告」，需要单独查。**跟踪：#543**。
- Windows 上的 AI 转写字幕那张表（要一个有 key 的转写引擎）。
- 浏览器界面语言是中文时 YouTube 走中文轨（同语跳过），要测「英→中」得给浏览器加 `--lang=en-US --accept-lang=en-US`。

> 本次迁移与 harness 修复的记录：**#542**。
