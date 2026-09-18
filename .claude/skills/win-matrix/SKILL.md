---
name: win-matrix
description: 在 Windows 上验大肚猴翻译（验收矩阵第 8 行：Windows 11 Chrome / Edge / Firefox）。两个目标——Mac 上的 VMware Fusion 虚拟机、局域网里的 Windows 真机——都从 Mac 走网络驱动，不进 Windows 点鼠标。任何全回归、任何动了字幕 / 语音 / 排版的改动要补 Windows 这一行时跑它；用户说「在 Windows 上看看」「台式机上跑一下」也跑它。
---

# win-matrix —— Windows 这一行，从 Mac 上一条命令跑完

规约在 `docs/verification-spec.md` §1 第 8 行与 §2.H；这里是**可执行**的那一半：命令、参数、每一步回读什么才算数。
脚本全在 `scripts/win-matrix/`，结果落在 `.local/win/`（不提交）。

## 什么时候跑

- 全回归（§0：矩阵只增不减，Windows 是其中一行，没跑写 ⬜ 不写 N/A）。
- 改了 `extension/content/**`、`styles/**`、字幕适配器、语音（TTS）相关代码。
- 用户报的问题只在 Windows 上出现，或者要排除「是不是 Windows 特有」。

## 两个目标，怎么选

| | 虚拟机（VMware Fusion · Windows 11 **ARM**） | 真机（局域网台式机 · Windows 11 x64） |
|---|---|---|
| 地址 | vmnet8 NAT，IP 从 `/var/db/vmware/vmnet-dhcpd-vmnet8.leases` 读（09-18 是 192.168.2.128）；Mac 在它眼里是 192.168.2.1 | `ssh -G win-desktop` 里的 HostName（09-18 是 192.168.50.5）；Mac 是自己的局域网地址 |
| 命令通道 | **没有**。起浏览器要人在虚拟机里粘一行 PowerShell | **SSH**（`ssh win-desktop`），推包、起浏览器全自动 |
| 浏览器配置 | 一次性空配置 | 日常配置的**副本**（带登录态） |
| 共享文件夹 | 没有（ARM 客户机的设置面板里根本没有「共享」） | 不需要，走 scp |
| 适合 | 装载、整页翻译、语音清单、排版读数；Firefox（真机上没装） | 一条命令的常规回归；需要登录态的场景 |

先选真机：`scripts/win-matrix/desktop.sh chrome`。真机睡了 / 关了（`nc -z <ip> 22` 不通）再用虚拟机。

## 0. 共同前提

```bash
node build.js                                   # dist/ 与 dist-firefox/ 要是这次要验的那个版本
node scripts/local-keys.js check                # 翻译引擎必须是 deepseek 且 key 已填 —— 脚本从 .local/keys.md 读，不回显
```

**每一条在 Mac 上跑的 node 命令都要清掉代理变量**（`desktop.sh` 里的 `clean` 已经做了；手跑时自己加）：

```bash
env -u NODE_USE_ENV_PROXY -u HTTP_PROXY -u http_proxy -u HTTPS_PROXY -u https_proxy -u ALL_PROXY node …
```

这台 Mac 的 shell 带着代理变量，Node 22 认 `NODE_USE_ENV_PROXY`：不清掉，连 192.168.x 的请求都会被送去代理，换回 503 / 空 body，
报错是 `bad json`，看不出是代理。`curl` 同理要 `--noproxy '*'`。

## A. 真机：一次性底座（换机器才重做）

1. Mac 上：`scripts/win-matrix/desktop.sh serve` —— 起文件服务并打印下一步要在台式机上敲的那一行。
2. 台式机上，**管理员** PowerShell：`$u='http://<Mac局域网IP>:8765'; irm $u/setup.ps1 | iex`。
   它做：防火墙 + 端口转发 9223→127.0.0.1:9222、OpenSSH Server、放 Mac 的公钥、`C:\mt` 与启动器、计划任务 `mt-launch`。
   回读（脚本末尾自己打印）：`sshd Running / Automatic`、转发表里有 `0.0.0.0 9223 → 127.0.0.1 9222`、`whoami` 的输出。
3. Mac 上 `~/.ssh/config`：

   ```
   Host win-desktop
     HostName <台式机IP>
     User <微软账号的邮箱>          # 不是 whoami 给的短名，见陷阱索引
     IdentityFile ~/.ssh/id_ed25519
     IdentitiesOnly yes
     UseKeychain yes
     AddKeysToAgent yes
   ```

4. 私钥有密码的话，**用户**在终端里跑一次 `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`（要输密码，代理做不了）。
5. 回读：`ssh -o BatchMode=yes win-desktop whoami` 打印 `<机器名>\<账号>`。

Claude Code 的 auto 模式分类器会把「远程操作计划任务」判成持久化拦下，也不允许代理给自己加权限。需要用户在
`.claude/settings.local.json` 的 `permissions.allow` 里手动加：`Bash(ssh win-desktop *)`、`Bash(ssh -T -o BatchMode=yes win-desktop *)`、
`Bash(scp * win-desktop:*)`、`Bash(scripts/win-matrix/desktop.sh *)`。

## B. 真机：每次

```bash
scripts/win-matrix/desktop.sh chrome      # 或 edge
```

它依次：推 `dist/` → 传 `launch.ps1` → 在**你的桌面会话**里起带调试口的浏览器（配置是日常配置的副本）→ `chromium.js`
（装载 + 整页翻译 + Windows 读数）→ `speech-fullscreen-chromium.js`（语音 `start` 事件 + 带真字幕的全屏）→ `yt-subtitles.js`。

每段的判据：

| 段 | 回读什么才算过 |
|---|---|
| 起浏览器 | `listening9222=True` 且 `session` **不是 0**（0 = 落在不可见的会话里，计划任务没起作用）|
| 装载 + 翻译 | `problems: []`、`version` 等于 `package.json`、`translations: 4`（标题 + 三段，**全含汉字且没有一条还是「⏳ 翻译中…」**）|
| 语音 | 中文、英文各自的 `start` 是数字。`start: null, timeout: true` 就是静音，不是通过 |
| 全屏 | `enter = [true, true, true, <译文>]`，`later` 的译文与 `enter` 不同（在走），`exit = [false, true]` |
| YouTube 字幕 | 末行 `subtitleAfterAdMs` 是数字；有广告时前面应有「广告结束」一行 |

## C. 虚拟机：每次

没有命令通道，起浏览器要用户在虚拟机里粘一行。用 `pbcopy` 把命令放进剪贴板（VMware Tools 会同步过去；没同步就让用户在虚拟机里先随便复制点东西再粘）。
**用 PowerShell 写法**，别给 cmd 写法：

```powershell
# Chrome（CDP 能直接 Extensions.loadUnpacked）
Get-Process chrome,msedge,firefox -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3; Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--user-data-dir=$env:TEMP\mt-prof --no-first-run --no-default-browser-check --remote-debugging-port=9222 --remote-allow-origins=* about:blank"
# Edge（没有 loadUnpacked ⇒ 启动时装进去）
Get-Process chrome,msedge,firefox -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3; Start-Process msedge -ArgumentList "--user-data-dir=$env:TEMP\mt-edge2 --no-first-run --no-default-browser-check --remote-debugging-port=9222 --remote-allow-origins=* --enable-unsafe-extension-debugging --load-extension=C:\Users\张钊\Downloads\mt\dist about:blank"
# Firefox（WebDriver BiDi）
Get-Process chrome,msedge,firefox -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3; Start-Process "C:\Program Files\Mozilla Firefox\firefox.exe" -ArgumentList "--remote-debugging-port 9222 --remote-allow-hosts 192.168.2.128 --remote-allow-origins http://192.168.2.128:9223 -remote-allow-system-access -no-remote -profile $env:TEMP\mt-ff about:blank"
```

包怎么进虚拟机：Mac 上在一个放着 `dist-chrome.zip` / `dist-firefox.zip` / `page.html` 的目录里 `python3 -m http.server 8765 --bind 0.0.0.0`，
虚拟机浏览器开 `http://192.168.2.1:8765/` 下载解压。**包变了就要重新下**。测试页 `page.html` 也由这个服务提供，服务停了脚本会报
`NS_ERROR_CONNECTION_REFUSED` / 导航失败。

然后在 Mac 上（虚拟机默认的测试页地址就是 192.168.2.1，不用设 `MT_WIN_PAGE`）：

```bash
V=192.168.2.128
clean() { env -u NODE_USE_ENV_PROXY -u HTTP_PROXY -u http_proxy -u HTTPS_PROXY -u https_proxy -u ALL_PROXY "$@"; }
clean node scripts/win-matrix/chromium.js $V 9223 'C:\Users\张钊\Downloads\mt\dist' chrome      # 或 edge
clean node scripts/win-matrix/speech-fullscreen-chromium.js $V 9223 chrome                       # --tts-only 只跑语音
clean node scripts/win-matrix/yt-subtitles.js $V 9223
clean node scripts/win-matrix/firefox.js $V 9223 'C:\Users\张钊\Downloads\mt\dist-firefox'
clean node scripts/win-matrix/speech-fullscreen-firefox.js $V 9223 <firefox.js 打印的扩展 uuid>
```

## YouTube 怎么验才算数

2026-09-18 一整天，「虚拟机上 YouTube 字幕拿不到」先后被归因成未登录、服务端拦截、日本出口节点、会话被拒，还写进了规约和记忆。
**四条全错**，真因是自动化里没人点「跳过广告」，片头广告把 8 次取字幕耗光、锁死在「字幕不可用」（#325 / PR #326）。未登录的虚拟机 Edge
点掉广告后 4 秒就出字幕。所以：

- **读数里必须带广告状态。** `#movie_player` 有没有 `ad-showing` / `ad-interrupting`。广告期间正片的字幕请求本来就不存在。
  「播到约 45 秒跳回 0:00 停住」是片头广告播完切到正片（没手势正片不自动播），不是拦截。
- **timedtext 要按当前视频 id 过滤。** 广告自己也会发 `/api/timedtext`，广告没字幕，响应体是 0 字节 —— 不过滤就会读成「YouTube 给了空字幕」。
- **别用肉眼看 YouTube 原生字幕。** 「译」开着时扩展注入 `.ytp-caption-window-container{opacity:0}` 把它藏了（`content-youtube.js` 的
  `injectCaptionStyle`）。看 DOM：`.ytp-caption-segment` 在不在。
- 桌面版的字幕翻译由播放器里的「译」按钮控制：`#mt-yt-btn.click()` 只是**打开菜单**，开关是 `#mt-yt-menu > div` 的第一行。
- 广告随机且有频控：连看几次后就不投了。要复现长广告：`NOSKIP=1 node scripts/win-matrix/yt-subtitles.js …` 多跑几次。
- 浏览器界面语言是中文时，YouTube 会自动选人工中文字幕轨 ⇒ 原文即目标语言 ⇒ 同语跳过，只有一行中文、译文为空。这是设计，不是缺陷。
- 已经开着一个 YouTube 页、不想打扰它：`node scripts/win-matrix/yt-probe.js <ip> 9223` 只读不点。
- **归因之前先找一个能证伪的最便宜的测试。** 这次那个测试就是「点掉广告再看」，做它只要十秒。

## 陷阱索引

| 看到什么 | 其实是 | 怎么办 |
|---|---|---|
| Mac 连 `<ip>:9222` 超时，Windows 本机 `127.0.0.1:9222` 是通的 | 桌面 Chrome / Firefox **不认** `--remote-debugging-address`，只听回环 | 端口转发 9223→9222 + 防火墙放行 9223（`setup.ps1` 第 1 步）。回读 `netsh interface portproxy show v4tov4` |
| `netsh …` 回一大段帮助文本，或「请求的操作需要提升」 | 命令没被接受 / 不是管理员 | 管理员 PowerShell；一行一条，别粘带 `&&` 的（Windows PowerShell 5.1 不认 `&&`，用 `;`） |
| PowerShell 报 `--` 运算符错误、`%TEMP%` 原样出现 | 把 cmd / Win+R 写法粘进了 PowerShell | 带引号的路径前加 `&`，或用 `Start-Process … -ArgumentList`；`%TEMP%` 写成 `$env:TEMP`；`msedge` 短名只有 Win+R 认 |
| `FAILED bad json` / curl 回 503 | Mac 这边的代理变量 | 清代理变量；curl 加 `--noproxy '*'` |
| `CDP File path cannot be resolved` | Windows 路径不对：**用户目录名不一定是登录名**（登录名 zhao，目录 `C:\Users\张钊`；真机目录 `belli`，账号 `belliedmonkey`） | `node scripts/win-matrix/ls.js <ip> 9223 'C:/Users/'` 先列目录 |
| Edge：`CDP Method not available` | Edge 145 不开放 `Extensions.loadUnpacked` | 启动时加 `--enable-unsafe-extension-debugging --load-extension=<dist>`；`chromium.js` 会自动退回去找已装的扩展 |
| `没找到扩展的 service worker` | MV3 的 worker 空闲 30 秒就退出 | 补充脚本会退回读 `.local/win/<label>.json` 里的 `extId` —— 所以同一次浏览器会话里先跑 `chromium.js` |
| `eval: ReferenceError: chrome is not defined`（种配置时） | 重复 `loadUnpacked` 会重载扩展，刚匹配到的 worker 正在退场 | `chromium.js` 已重找重试；自己写脚本时别缓存 worker 的 session |
| 译文「卡在 ⏳ 翻译中… 30 秒」 | 断言把占位符当成了中文译文（它也含汉字），循环 5 ms 就退出了 | 判据必须排除 `翻译中` / `加载中` / `准备中`。命中数或耗时离谱，先怀疑断言 |
| Firefox：WebSocket 握手 400 | 远程代理只认 `Host: 127.0.0.1:9222`，`--remote-allow-hosts` 帮不上 | `lib/raw-ws.js`（手写 RFC 6455，能改 Host）|
| Firefox：`Navigation to "moz-extension://…" is not allowed` | BiDi 禁止导航到扩展页和 `about:*` | UUID 从临时配置目录的 `prefs.js` 读（`file://`）；设置页靠**普通网页自己** `location.href = 'moz-extension://<uuid>/options/options.html'` 过去（它对 `<all_urls>` 是 web_accessible）|
| Firefox：`System access is required` | 在扩展页里执行脚本要启动参数 `-remote-allow-system-access` | 加上重启 |
| Firefox：`Maximum number of active sessions`，怎么重试都不行 | 只许一个 BiDi 会话；上一个客户端被强杀后，**portproxy 攥着内侧那条连接**不放 | 只能重启 Firefox。脚本必须在每条退出路径（正常 / 报错 / 看门狗 / SIGTERM）上 `session.end` |
| Google 登录页「此浏览器或应用可能不安全」 | 带远程调试参数启动的浏览器会被 Google 拒登 | 同一个配置目录**不带调试参数**开一次登录，再带参数重开；账号有 passkey 时点「试试其他方式」 |
| Chrome 起来了但拒绝调试口 / 走的是已有实例 | Chrome 136+ 拒绝在**默认配置目录**上开调试口；已有 Chrome 在跑时新进程会并进旧实例、参数全丢 | 用配置副本（`launch.ps1`）；起之前先杀干净 |
| 经 SSH 起的浏览器看不见、`session=0` | 从 SSH 会话直接起 GUI 程序落在会话 0 | 走计划任务 `mt-launch`（`/it`，只在交互会话里跑）|
| `ssh` 一直 `Permission denied`，钥匙和权限都对 | ① 微软账号要用**邮箱**当用户名（服务端日志里只有它出现 `Postponed publickey`）② Mac 私钥带密码且不在 agent 里：`Server accepts key` 之后客户端签不了名 | ① `User <邮箱>` ② `ssh-add --apple-use-keychain` + 配置里 `UseKeychain yes`。看服务端：`Get-WinEvent -LogName 'OpenSSH/Operational' -MaxEvents 15` |
| `irm … | iex` 的中文输出是乱码 | 响应体被按 Latin-1 解码 | 给 Windows 的脚本只输出 ASCII |
| `setup.ps1` 卡在 OpenSSH 那步几分钟 | `Add-WindowsCapability` 在等 Windows 更新 | 已经有 sshd 就跳过（脚本已处理）；22 端口通了就不用等它 |
| 全屏：发了 Esc 还在全屏 | CDP 的按键只到页面，浏览器级的退出全屏不吃 | `document.exitFullscreen()` |
| Chrome：英文在线声第一次 `speak()` 15 秒无声无错 | Google 在线声首次调用的预热 | 第二次再量；产品侧：不能凭 `speak()` 返回就说「播放中」|
| 从 Mac 合成点击点 Fusion 窗口：有悬停提示、点不进去 | 合成事件进不了客户机 | 不走这条路。也别在用户看着的时候反复重开浏览器 —— 他会中断你 |

## 结果记到哪

- 原始证据：`.local/win/<label>.json` + 截图（不提交）。
- 规约：§1 第 8 行的状态格、§1.0 四张分面表的 Windows 行、§2.H。**没跑的写 ⬜，不写 N/A；写了 ✅ 就要带日期和读数。**
- 发现产品缺陷：开 issue → 先红后绿的用例 → 修 → PR（#325 / #326 是样板）。

## 还欠着的（2026-09-18）

- 真机上的 Edge、Firefox（真机没装 Firefox）。
- Windows 上的 AI 转写字幕那张表（要一个有 key 的转写引擎）。
- `desktop.sh` 自身只在写成当天手工分段跑通过；整条命令的首次端到端还没回读（写它的那晚台式机睡了）。第一次用的人请把结果补在这里。
