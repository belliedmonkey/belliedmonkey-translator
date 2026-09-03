---
name: store-release
description: 把一个版本发到六个商店面（Apple iOS/macOS × 国际版/中国版、Chrome Web Store、Firefox AMO、GitHub Release、官网）。出包 → 上传 → 挂 build → 真机验证 → 素材 → 发布说明 → 提审，每一步都有可跑的命令和可读回的判据。任何一次发版都跑它；跳过任何一步的代价在下面「陷阱索引」里逐条写了。
---

# store-release —— 发布的每一步都要能读回来

## 什么时候跑

要把某个版本送到用户手上时。六个面，**依赖顺序如下**（后面的依赖前面的）：

| # | 面 | 工具 | 凭证槽位 | 分档 |
|---|---|---|---|---|
| 1 | Apple iOS · 国际版 | `build-safari.sh` + `xcodebuild` + `scripts/asc*.js` | `ascIssuerId` `ascKeyId` `ascKeyPath` | `asc-media`/`asc-submit` 默认 dry-run |
| 2 | Apple macOS · 国际版 | 同上 | 同上 | 同上 |
| 3 | Apple iOS · 中国版 | 同上（`--flavor china`） | 同上 | 同上 |
| 4 | Apple macOS · 中国版 | 同上 | 同上 | 同上 |
| 5 | Chrome Web Store | `scripts/cws-publish.js` | `cws_client_id` `cws_client_secret` `cws_refresh_token` `cws_item_id` | `--check` / `--upload` / `--publish` |
| 6 | Firefox AMO | `scripts/amo-publish.js` | `amo_jwt_issuer` `amo_jwt_secret` `amo_addon_id` | 同上 |
| 7 | GitHub Release + 官网 | `gh release` + `~/belliedmonkey-cc` | GitHub 登录态 | 无 |

凭证唯一入口是 `.local/keys.md`（gitignored）。**一个都不要回显、不要提交、不要写进
任何日志。**

`docs/release-checklist.md` 是另一半：门禁清单、设备矩阵、隐私文案同版、Gate B 的
历史论证。那些不重复在这里；这里只放**能直接敲的东西**。

## 一条铁律：只信回读，不信「没报错」

这一整条流程里，**每一个「成功」都可能是假的**。四个实例，都是 2026-08-22 当天撞到的：

| 表面上 | 实际上 | 怎么才知道 |
|---|---|---|
| `asc.js versions` 显示 build「未挂」 | 已上架的版本也显示未挂 —— `include=build` **不返回关系数据**，不报错 | 逐个问 `/appStoreVersions/{id}/build` |
| 资产上传返回 200 | 漏了 md5 就永远停在 `UPLOAD_COMPLETE`，商店页看不到图 | 回读 `assetDeliveryState.state === 'COMPLETE'` |
| `PATCH` 成功 | ASC 的 PATCH 返回 204 无正文，「没报错」不等于「改对了」 | 改完再 `GET` 一次 |
| `build-safari.sh` 退出码非 0 | 一切都成功了也非 0（`set -e` + 末尾交互 `read` 遇 EOF） | 看 Step 3 的输出与产物，不看退出码 |

所以下面每一步都带一条**回读判据**。判据没过，这一步就是没做完。

## 步骤

### 0. 先问商店，不要信仓库

build 号只有 App Store Connect 知道。仓库里没有任何地方记着「上次发到几了」。

```bash
node scripts/asc.js builds      # 各线最近的 build 与处理状态
node scripts/asc.js versions    # 各线的版本记录、状态、挂了哪个 build
```

⚠️ **iOS 与 macOS 的 build 号各自独立自增**，而 ASC 把两个平台放在同一个 app 下。
查询不带 `filter[preReleaseVersion.platform]` 的话，号大的平台会把另一个整个挤出
列表 —— 看上去就像「macOS 那个包没传上去」。`asc.js` 已经按平台分开问了。

新 build 号 = 该平台当前最大值 + 1。**别用「取最新那条」**，见第 4 步。

### 1. 素材过时审计

→ **`assets.md`**。不要跳过：2026-08-22 那次，国际版商店图正在展示一个已修的 bug，
另外两张印着作者的真实邮箱。

### 2. 出包

```bash
# 改版本号：**两处都要改** —— package.json 与 extension/manifest.json。
# build.js 有 version drift 门禁同时校验两者，只改一处会直接红。
node build.js                      # → dist/            + belliedmonkeytranslator.zip
node build.js --flavor china       # → dist-china/      + belliedmonkeytranslator-china.zip
node build.js firefox              # → dist-firefox/    + belliedmonkeytranslator-firefox.xpi

# Safari 工程（每个 flavor 一棵双平台树）
env -u NODE_OPTIONS bash build-safari.sh global   # 或 china
npm run app:sync                                  # ⚠️ 必须在归档前
```

四件容易翻车的事：

- **`build-safari.sh` 成功也会非 0 退出**（见上）。判据是 `safari-project*/` 下
  `*.xcodeproj` 存在**且** pbxproj 里 `path = ../../../dist*/` 指向对的 flavor。
- **`app:sync` 必须在 `xcodebuild archive` 之前**。它灌宿主 App 资源并打六个补丁；
  漏了它，出的是转换器 979 字节的模板页（macOS 1.4.1 就这么上架过三个版本）。
- **`BUILD_NUMBER=<n>` 是全局替换**，两个平台的 target 会写成同一个号。归档另一个
  平台时在 `xcodebuild` 上加 `CURRENT_PROJECT_VERSION=<n>` 覆盖。
- **本机的 `NODE_OPTIONS` 会让任何 node 先崩**（指向一个不存在的 cmux preload）。
  所有 node / 含 node 的脚本都要 `env -u NODE_OPTIONS`。

归档：

```bash
env -u NODE_OPTIONS xcodebuild -project "safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (iOS)" -configuration Release \
  -destination "generic/platform=iOS" -archivePath /tmp/mt-ios.xcarchive \
  DEVELOPMENT_TEAM=X2Q85MABWK CURRENT_PROJECT_VERSION=<n> -allowProvisioningUpdates archive
```

`DEVELOPMENT_TEAM` 每次重生成工程都会丢，必须显式传。

**描述文件要新拉时（改了 capability / entitlement），加三个 API key 参数** ——
否则 `-allowProvisioningUpdates` 会去要 Xcode 里那个**会过期**的账号登录态：

```bash
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_S9UZYBNW63.p8 \
  -authenticationKeyID S9UZYBNW63 \
  -authenticationKeyIssuerID 69a6de76-b4fd-47e3-e053-5b8c7c11a4d1
```

> 2026-09-03：给 App ID 开了 Sign in with Apple 之后，归档报 `No Accounts` +
> `No profiles for … were found`。补上这三个参数后**报错换了一个** ——
> 「Your team has no devices from which to generate a provisioning profile」，
> 说明它已经在和 Apple 通话了。真因是 macOS 归档用的是**开发型**描述文件，
> 而开发型要求团队里至少有一台该平台的设备，那时三台在册的全是 iPhone。
> 注册这台 Mac 之后一次通过：
>
> ```bash
> system_profiler SPHardwareDataType | grep "Provisioning UDID"
> node scripts/asc.js devices <UDID> "开发 MacBook Pro" --mac
> ```
>
> `--mac` 是那次一并补上的：`cmdDevices` 原来把 platform 写死成 IOS，注册 Mac 会
> 静默注册成一台 iPhone，而 ASC 的报错指不到这里。

**导出也要那三个参数**，不只是归档 —— 归档用的是**开发型**描述文件，导出重签名用的
是**分发型**，那是两张，各自都要含新 capability：

```
error: exportArchive Provisioning profile "iOS Team Store Provisioning Profile: …"
       doesn't include the Sign In with Apple capability.
```

2026-09-03 实测：归档过了、导出才红，因为只给归档加了参数。给 `-exportArchive`
也加上 `-allowProvisioningUpdates` + 三个 key 参数即可。

**entitlement 的判据是归档之后回读，不是构建没报错**：

```bash
codesign -d --entitlements :- "<archive>/Products/Applications/*.app" | plutil -convert json -o - -- -
```

期望同时读到 `applesignin` + `app-sandbox` + `audio-input`。macOS 的沙箱来自构建
设置（`ENABLE_APP_SANDBOX`），而 Sign in with Apple 只能来自 `.entitlements` 文件 ——
两者共存与否，**只有这一行回读答得了**；沙箱掉了本地一切正常，只有 App Review 会拒。

### 3. 包体自查 —— 拆开看，不要信构建日志

归档完，直接翻 `.appex` 里的文件。iOS 资源在 bundle 根，**macOS 在
`Contents/Resources/`**（`npm run verify:ios` 对 macOS 是假阴性，它按 iOS 布局找）。

通用六项：

```
版本/build        与预期一致
bundle id         .cn 与否对得上 flavor
宿主页            Main.html 应为两万余字节，**979 字节就是转换器模板页**
本次修复的判据    grep 出这一版真正改了的东西（例：stripThink 3 处）
星号残留          grep -c '\*\*' content/i18n-messages.js  应为 0
签名              TestFlight 装回来的应是 Authority=TestFlight Beta Distribution
```

**中国版独有三项**（上次被拒就是栽在这里）：

```
sync              learn/backend.config.js 里 enabled: false
品牌词            grep -rlE 'ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com' 应命中 0 个文件
google 引擎       content/providers.gen.js 里 '"id":"google"' 应为 0 条
默认引擎          background.js 里 provider: 'deepseek'（不是 google）
```

### 4. 上传 + 挂 build

**不要用 `xcodebuild -exportArchive` 直接上传。** 那条路要 Xcode 里那个 Apple ID 的
登录态（`-allowProvisioningUpdates` 拿它去刷描述文件），而登录态会过期 —— 2026-08-29
就卡在这里：先报 `Failed to Use Accounts`，补上 API key 参数后改报 `Account credentials
have expired`。**分发证书本身是好的**，过期的是账号会话。两次失败的**退出码都是 0**。

改成两步：本地导出（不联网）+ API key 上传。这条路不依赖任何会过期的登录态。

```bash
# ① 本地导出 —— export 而不是 upload，且**不要** -allowProvisioningUpdates
cat > /tmp/export-local.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>X2Q85MABWK</string>
<key>uploadSymbols</key><true/>
<key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
env -u NODE_OPTIONS xcodebuild -exportArchive -archivePath /tmp/mt-ios.xcarchive \
  -exportOptionsPlist /tmp/export-local.plist -exportPath /tmp/out-ios
# 判据：EXPORT SUCCEEDED **且** /tmp/out-ios/*.ipa 真的存在

# ② API key 上传（.p8 必须叫 AuthKey_<KEYID>.p8 且放在这个目录）
KI=<ascKeyId>; II=<ascIssuerId>
mkdir -p ~/.appstoreconnect/private_keys
cp <ascKeyPath> ~/.appstoreconnect/private_keys/AuthKey_${KI}.p8
env -u NODE_OPTIONS xcrun altool --upload-app -f /tmp/out-ios/*.ipa -t ios \
  --apiKey "$KI" --apiIssuer "$II"
# 判据：出现 "No errors uploading"。**退出码不可信**，altool 失败时也返回 0。
```

⚠️ `altool` 会跑 Apple 自己的一整套校验，而它拒得比本地任何门禁都晚、都贵：归档
成功、导出成功、传到最后才拒，**而且一次只报一个 locale**。2026-08-29 撞到的是
`extension_name` 超过 **40** 字符（不是 manifest 的 45），五个 locale 同时超标 ——
照着报错改要来回五次。`build.js` 现在有 `nameLengthGate` 挡在前面了。

node scripts/asc.js builds      # 等到该 build 变 VALID（约 1–3 分钟）
node scripts/asc.js bind com.belliedmonkeytranslator IOS 1.6.4 43
```

`bind` **必须显式写 build 号**，不接受「取最新那个」：两个平台号各自独立自增，
按号排序取首条会安静地挂上另一个平台的包，而 ASC 不会拦。它 PATCH 之后会回读，
回读不符即 `exit 1`。

### 5. 真机验证

**§2.0：一台机器同一时刻只能装一份。** 不是「先关掉另一个」，是**卸载**。
关掉的那份仍在扩展列表里、仍参与 LaunchServices 的注册竞争，于是「跑的是哪一份」
没有确定答案，而验证的全部价值建立在这个答案上。

```bash
# macOS —— 认的是哪一份，只信这一行的版本号，不是「App 起来了」
pluginkit -m -v -p com.apple.Safari.web-extension | grep -i belliedmonkey
# 期望：恰好一行，且路径在 /Applications 下

# iPhone —— 设置 → App → Safari浏览器 → 扩展，期望「大肚猴翻译」恰好一条
```

出现两条 ⇒ 先卸载多余那份，**这一轮此前的观测全部作废**。

两个 App 在主屏上**同名同图标、图标文件字节相同**，分不出来。能分辨的地方是
**设置 → 通用 → iPhone 储存空间**：在用的那份有几十 MB「文稿与数据」，没用过的
只有包体大小。

验什么：翻一整段长正文，读 `document.querySelectorAll('.mt-translation').length`
而不是看截图。macOS 上用 AppleScript 驱动 Safari 最稳（地址栏输入那条路走不通）：

```bash
osascript -e 'tell application "Safari" to open location "https://en.wikipedia.org/wiki/Coffee"'
osascript -e 'tell application "Safari" to do JavaScript "document.querySelectorAll(\".mt-translation\").length" in front document'
```

⚠️ **换包时 Safari 会弹一个模态框**「无法使用扩展，因为该扩展不再有效」，它会
**阻塞一切 AppleScript**。先关掉它再继续；页面刷新后扩展会自行恢复。

### 6. 素材上传

```bash
node scripts/asc-media.js                        # 只打印计划
node scripts/asc-media.js --apply --only cn-mac  # 先探一条
node scripts/asc-media.js --apply                # 其余
```

版本号取自 `package.json`，`--version` 可覆盖。

**先探一条、回读 COMPLETE、再推其余。** ASC 的资产上传是三步（预留 → 按
`uploadOperations` 逐段 PUT → 提交 md5），漏了校验和会永远停在 `UPLOAD_COMPLETE`，
商店页看不到图，**而 API 全程不报错**。

### 7. 发布说明 —— 空了会让整轮提审失败，而 Apple 不告诉你

写 `store-assets/release-notes-<版本>.md`，再 PATCH 进每个本地化的 `whatsNew`。

> 2026-08-22，四条线全部在 `POST /reviewSubmissionItems` 被挡：
> `appStoreVersions … is not in valid state. please check associated errors`。
> 版本状态、build、截图、审核联系信息全部正常。**真因是 `whatsNew` 六处本地化
> 一处都没填** —— 而 API 里并没有它让你去看的 associated errors。

国际版与中国版的文案**不该相同**：中国版有它独有的修复，国际版没有那个 bug，
写进去就是假的。

### 8. 提审

```bash
node scripts/asc-submit.js 1.6.4            # 干运行，五道前置全查
node scripts/asc-submit.js 1.6.4 --apply
```

五道前置：状态可提交 / 挂了 build / build 是 VALID / 有截图 / **每个本地化有更新说明**。

三步提交（建提交 → 挂版本 → `submitted:true`），只做前两步的话 ASC 网页上能看到一个
待提交草稿，而 Apple 那边什么都没收到。脚本做完会回读 state。

### 9. 撤审重提

```bash
node scripts/asc-submit.js 1.6.4 --cancel com.belliedmonkeytranslator --apply
```

**只对明确点名的 bundle id 生效**，不接受「撤全部」——排队位置会清零，中国版上次
首提排了 40 天。

两个命名陷阱：

- 撤审后的状态是 **`DEVELOPER_REJECTED`** —— 那是「开发者自己撤回」，**不是**「被审核拒了」。
  两个脚本的状态判据都必须认它，否则撤完就走不回去。
- `reviewSubmissions` **不允许 DELETE**（只有 CREATE/GET/UPDATE）。所以「建提交成功、
  挂版本失败」会留下一个永久的空壳；重试前先找同 app+platform 下**没有条目**的空壳复用。

**在审期间能改什么**：`whatsNew`、描述这类文本可以改；**新建截图集不行** ——
`POST /appScreenshotSets` 会被 409 `Can't Create Screenshot Set while In Review` 拒。
好消息是它**拒得很干净**，状态不受影响 —— 所以那是安全的死路，可以先试再决定要不要撤。

### 10. 扩展两面：CWS 与 AMO

```bash
npm run cws:check                                   # 体检
node scripts/cws-publish.js --upload                # 传 zip，不提审
node scripts/cws-publish.js --upload --publish      # 传 + 提审

npm run amo:check
node scripts/amo-publish.js --upload                # 传 xpi 并等异步校验
node scripts/amo-publish.js --upload --publish
```

### 11. GitHub Release + 官网

```bash
npm run gh:check                                   # 只打印计划
node scripts/gh-release.js --apply                 # 真的发
node scripts/gh-release.js --apply --clobber       # 替换已存在的同名资产
```

**GitHub Release 是一个真正的发布面**，和 CWS / AMO 平级 —— 官网首页的下载按钮
直链 `releases/latest/download/belliedmonkey-translator-chrome.zip`。资产名是
**契约**，改名等于把下载按钮变成 404，所以脚本把它钉成了常量。

## 三条路共用一道版本完整性门禁

`scripts/lib/release-gate.js`：包内版本必须有同名 tag、HEAD 必须就在那个 tag 上、
`extension/ build/ build.js` 必须干净。`--allow-dirty` 是唯一逃生口，用了会明说
「对应关系不再有保证」。

> **它原来只有两份，抄在 CWS 与 AMO 里，而第三条路没抄。** 2026-08-21 的代价：
> Release 从 `v1.6.4` tag（13:45）出，markdown 星号修复 19:05 才合进来，商店
> build 43 是修复之后出的。于是官网那句「与提交商店的源码完全一致」变成假话，
> **而没有任何人做错一步** —— 那条路上就是没有闸门。
>
> 现在只有一份实现，三条路都调它。**抄第四份的那天，就是它再次失效的那天。**

### 要重发一个历史版本的正确产物时

有时 tag 描述的**不是**真正出货的内容（v1.6.4 就是：星号修复在打完 tag 之后才合进来，
而商店 build 是修复之后出的）。这时**不要用 `--allow-dirty` 绕过去** —— 那等于把
溯源丢掉。正确做法是把事实说出来并验证它：

```bash
git tag -a v1.6.4-store -m "真正出货的那个提交" <sha> && git push origin v1.6.4-store
git worktree add /tmp/build v1.6.4-store && (cd /tmp/build && node build.js)
node scripts/gh-release.js --zip /tmp/build/belliedmonkeytranslator.zip \
  --tag v1.6.4-store --worktree /tmp/build --apply --clobber
git worktree remove /tmp/build
```

门禁会去那棵 worktree 里验 HEAD 确实在该 tag 上、且干净 —— **是通过检查，不是跳过**。
不移动已发布的 tag（同中国版 `v1.6.4-china-2` / `-china-3` 的做法）。

验收看的不是脚本有没有报错，而是**从官网那条直链重新下载**：

```bash
curl -sL -o /tmp/v.zip "https://github.com/belliedmonkey/belliedmonkey-translator/releases/latest/download/belliedmonkey-translator-chrome.zip"
unzip -p /tmp/v.zip content/i18n-messages.js | grep -c '\*\*'   # 期望 0
```

官网是**独立仓库** `~/belliedmonkey-cc`（Vercel 部署）。发版要改的是 8 份 i18n
里的两个键：

```
i18n/{ar,en,es,fr,hi,pt,ru,zh-CN}.json
  home.installSub   正文里的「当前为 v1.6.4」
  home.installDl    按钮文案「下载 Chrome 安装包 — v1.6.4（ZIP）」
```

官网还有**它自己的一套会过时的素材**：`media/shot-*.png`、`media/demo-macos-*.mp4`、
`media/demo-poster.jpg`。审计时别漏（见 `assets.md`）。

## 想知道用户是谁：`node scripts/asc.js installs [天数]`

免费 app 的 Units 就是下载次数，按 app / 设备 / 国家三个维度打印。

```bash
node scripts/asc.js installs 45
```

走的是 **salesReports**，不是 analyticsReports —— 后者要先 POST 一个请求再等 Apple
异步生成实例（一次性快照通常要等一天上下），前者是现成的，且每行自带 Country Code
与 Device。凭证是 `.local/keys.md` 里的 `ascVendorNumber`，那个号 **API 查不到**，
只能去网页上抄一次：「付款和财务报告」页左上角的灰色小字
（https://appstoreconnect.apple.com/itc/payments_and_financial_reports/#/）。

三个实测出来的坑（都由 test/build-scripts.test.js 钉住）：

| 现象 | 真因 |
|---|---|
| 拉 40 天在某一天炸掉 | 没有下载的那天返回 **404**，不是空报表 —— 要当成「那天安静」 |
| JSON.parse 失败 | 返回的是 **gzip 的 TSV**，不能走 `api()`；Accept 要 `application/a-gzip` |
| 设备分布 100% 是「iOS and macOS」 | 读错了列。`Supported Platforms` 是包支持什么，`Device` 才是用户用什么 |

## 陷阱索引

| 现象 | 真因 | 判据 |
|---|---|---|
| 「macOS 那个包没传上去」 | 查 build 没按平台过滤，被号大的 iOS 挤出列表 | `filter[preReleaseVersion.platform]` |
| 已上架版本也显示「未挂 build」 | `include=build` 不返回关系数据，且不报错 | 逐个问 `/build` 关系端点 |
| 商店页看不到刚传的图 | 漏 md5 校验和，停在 `UPLOAD_COMPLETE` | 回读 `assetDeliveryState` |
| 提审报「version is not in valid state」 | `whatsNew` 为空（Apple 不说） | `asc-submit.js` 干运行 |
| 撤审后走不回去 | 状态是 `DEVELOPER_REJECTED`，脚本判据没认 | 把它加进可提交集合 |
| 账号里堆一堆空提交 | `reviewSubmissions` 不允许 DELETE | 复用无条目的空壳 |
| 构建脚本「失败」 | `set -e` + 末尾交互 `read` 遇 EOF | 看产物，不看退出码 |
| 宿主 App 是空白页 | 漏了 `app:sync`，装的是 979 字节模板页 | 量 `Main.html` 字节数 |
| Safari 认的还是旧版本 | 同 bundle id 时 LaunchServices 认 `/Applications` 那份 | `pluginkit -m -p …` 的版本号 |
| 扩展列表里有幽灵条目 | `xcodebuild archive` 的中间产物被 LaunchServices 注册了 | `lsregister -dump` 找路径，`-u` 定点注销 |
| 任何 node 脚本一跑就崩 | 本机 `NODE_OPTIONS` 指向不存在的 preload | `env -u NODE_OPTIONS` |
| 官网 ZIP 与商店版本内容不同 | 那条路当时没有版本完整性门禁 | `npm run gh:check` |

## 判断口径

- **「没报错」不是判据，回读才是。** 每一步都要能说出「我读到了什么，所以它成了」。
- **build 号问商店，不问仓库。** 仓库不知道上次发到几；两个平台还各自计数。
- **一台机器只装一份。** 出现两条就作废这一轮的全部观测，不要「凑合着测」。
- **素材过时看内容，不看日期。** 08-15 拍的 `f2` 完全没过时；08-11 拍的 `f5` 印着 bug。
- **不确定能不能改，就先试。** Apple 的 409 拒得很干净；撤审却不可逆。**先试安全的那条。**
- **撤审只撤点名的那条线。** 排队位置没法回滚，而它可能值 40 天。
- **文档说的和实现不一样时，以实现为准，然后把文档改对。** 这次就修了三处。

## 相关

- `assets.md` —— 素材过时审计 + 截图/视频的完整配方（同目录）
- `docs/release-checklist.md` —— 门禁清单、设备矩阵、隐私文案同版、Gate B 历史
- `docs/verification-spec.md` §2.0 —— 一台机器只装一份（含执行判据）
- `store-assets/README.md` · `screenshots-cn/README.md` —— 两条截图管线各自的重做流程
- `scripts/asc.js` · `asc-media.js` · `asc-submit.js` —— ASC 三件套
- `scripts/cws-publish.js` · `cws-auth.js` · `amo-publish.js` —— 扩展两店
- `.claude/skills/perf-tune/SKILL.md` —— 新增引擎时的实测流程（发版前的上游）
