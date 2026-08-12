# 发布清单（release checklist）

> **这份清单收的是「构建闸门看不见的东西」。** 仓库里能自动化的都已经是闸门——版本漂移、
> `data_collection_permissions`、locale 目录名、译文里的版本号字面量、`enabled` 与隐私文案
> 的耦合、Safari 包完整性（`npm run verify:ios`）。**下面这些跨仓库或跨账号，闸门够不到，
> 只能靠这张表。**
>
> **清单比闸门弱。** 它依赖有人在发版时打开它。凡是能变成闸门的项，都应该从这里搬进
> `build.js` 然后从这里删掉——这份文件越短越好。

## 各商店状态：**别从这里读，去复验**（2026-08-08）

权威页是 gbrain 的 `belliedmonkey-translator-release-state`，**但它自己写着会过时**，
所以每次用之前跑那一页的「怎么复验」。08-08 实测，与 08-01 的记载有两处不符：

| 行 | 权威页（08-01） | 实测（08-08） |
|---|---|---|
| **Firefox AMO** | 1.2.0 仍在审核（401） | **已上架**：`status: public`、1.2.0、2 个日活 |
| iOS App Store | 1.3.0 已上传待审 | 线上仍是 **1.2.0**（07-29 发布）——1.3.0 传上去一周还没放出来，值得去 ASC 看是不是被拒了 |

```bash
curl -s "https://itunes.apple.com/lookup?id=6787190032" | ...   # iOS 线上版本
curl -s https://addons.mozilla.org/api/v5/addons/addon/mobiletranslator@belliedmonkey/
```

**Firefox 已上架这条会改变 Gate B 的成本**：`data_collection_permissions` 不再是首次
提交时随便填，而是**修改一条已公开的声明**，会被审核看见。

## 0. 门禁（都能自动跑，跑之前别做下面任何一步）

```bash
npm test                 # 纯逻辑
npm run test:layout      # 真实 headless Chrome，36+ fixture（含行为 phase：选区/交互）
node build.js            # Chrome/Safari；含全部构建期闸门
node build.js firefox    # Firefox
```

## 1. 设备矩阵

按 [`verification-spec.md`](verification-spec.md) §0：**全矩阵，每次**。
每一行要么跑过，要么显式标 N/A —— 不写「大概没影响」。

**配 DeepSeek，不要在免费 Google 端点上验证**（§0，强制）。判据：**译文里不该有原文回显**。
免费端点的典型故障就是对同一输入既返回真译文又返回逐字回显——本项目曾因此把一次 Google
的结果误当成 DeepSeek 验证通过。

## 2. 隐私文案必须与本次发布的功能同版上线 ⚠️

**这一条是承诺，不是惯例。** `belliedmonkey.com/privacy.html` 自己写着：

> 本 App 将来若在你的设备上保存更多内容，会在本节逐项列出，并在**该功能上线的同一个版本**
> 更新本页——**不提前写，也不事后补**。

所以两个站点的隐私改动**必须与扩展发版同时推送**：

```bash
git -C ~/belliedmonkey-com push    # EdgeOne Pages，推送即自动部署
git -C ~/belliedmonkey-cc  push    # Vercel，同上
```

- **提前推**：页面描述一个用户还没有的功能——违反「不提前写」，且用户会去找一个不存在的开关。
- **事后推**：功能已经在采集数据而页面还没说——违反「不事后补」，这一头严重得多。

> **Gate A（V1 本地采集）的站点部分已于 2026-08-06 推送并上线**，早于扩展发版。这是刻意
> 选择的：`.com` 先被推了，而**两个站点说法不一致比提前写严重**，所以 `.cc` 也补上了。
> 下次发版**不要**再推这两条——它们已经在线上。已核对：`.com` 有「学习材料」条目；`.cc`
> 的 8 种语言（ar/en/es/fr/hi/pt/ru/zh-CN）全部带 `privacy.s2li4`，没有空条目。
>
> 顺带记一个既有的不一致（非本次引入）：`.cc` 只有 8 种语言，而扩展有 11 种——**日语、
> 韩语、繁体中文的用户会看到英文站**。

对应关系（`learning-design.md` §10）：

| 发布内容 | 闸门 |
|---|---|
| V1 本地采集 | **Gate A** —— README 隐私段 + 两个站点的「本机存储的数据」条目 |
| V3 同步 | **Gate B** —— 「无账号」那句必须改；`build.js` 已有闸门：`learn/backend.config.js` 的 `enabled` 为 true 而 README 仍写着旧句子时**构建失败** |

## 3. 商店文案

`extension_description` 与商店描述由注册表驱动，不要手写服务商清单（AGENTS.md「一个注册表，
N 个消费者」；已因此漂移过两次：DeepSeek 模型名、版本号）。

## 4. Issue 与 PR

AGENTS.md 要求每个改动一个 issue。**修复合并进 `main` 之后才关闭 issue**——分支上就关，
等于声称一件还没进产品的事已经做完了。

## iOS：重新生成 Safari 工程会静默重置三样东西

`xcrun safari-web-extension-converter --force` 每跑一次，都会把工程恢复成转换器的
默认值。**这三样都只在发布那一刻才炸，本地跑模拟器一切正常。**

| 被重置的 | 默认值 | 正确值 | 不改会怎样 |
|---|---|---|---|
| `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | `1.0` / `1` | 当前版本 / 上次 build + 1 | 传上去是 1.0(1)，被 ASC 当成版本回退 |
| 扩展 target 的 `PRODUCT_BUNDLE_IDENTIFIER` | `…​.Extension`（大写 E） | `…​.extension`（小写） | 导出直接失败：`No profiles for '…​.Extension' were found` |
| `DEVELOPMENT_TEAM` | 空 | `X2Q85MABWK` | 自动签名找不到团队 |

第三项之外，**文件清单**曾经也是这类问题（#72），已由 `npm run verify:ios` 覆盖。

### 发 TestFlight 的完整命令

```bash
node build.js                       # 工程直接引用 ../../../dist/，必须先重建
npm run verify:ios                  # 逐文件比对，缺一个就非零退出

xcodebuild -project "safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (iOS)" -configuration Release \
  -destination "generic/platform=iOS" -archivePath /tmp/bmt-archive.xcarchive \
  -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath /tmp/bmt-archive.xcarchive \
  -exportOptionsPlist /tmp/exportOptions.plist -exportPath /tmp/bmt-export \
  -allowProvisioningUpdates
```

导出后**必须核对**（历史上每一项都出过错）：

```bash
codesign -dv --verbose=2 <app>      # Authority 必须是 Apple Distribution，不是 Development
                                    # appex id 必须是小写 .extension
                                    # version / build 必须是你以为的那个
```

### 上传需要凭证 —— 这台机器上一个都没有

`xcrun altool` / `xcodebuild` 上传需要二者之一：

- **ASC API key**：`~/.appstoreconnect/private_keys/AuthKey_XXXX.p8` + Key ID + Issuer ID
- **App 专用密码**：Apple ID + [appleid.apple.com](https://appleid.apple.com) 生成的专用密码

两者都没有时，只剩 **Xcode Organizer 图形界面**这一条路（用已登录的 Apple ID）。
配一次 API key 之后整条链路就能无人值守。

### 商店描述有两个不同的上限，小的那个只在上传时才检查

| 面 | 上限 | 谁来查 |
|---|---|---|
| Chrome Web Store 摘要 | 132 | 商店后台 |
| **Safari 扩展 `extension_description`** | **112** | **只有 App Store Connect 的上传校验** |

2026-08-07 实测：六个 locale 写到 121–125 字符，`npm test`、`test:layout`、三个构建、
`verify:ios`、归档、导出**全部通过**，模拟器安装运行正常，**只在 TestFlight 上传那一刻**
被逐 locale 拒绝：

```
Invalid messages file. The messages.json validation failed for locale de …
The description field must be present, of string type, and 112 or fewer characters long.
```

已由 `descriptionLengthGate`（build.js 第五道闸门）覆盖，**两个 flavor 都跑**——中国版
描述是构建期生成的，一样会超长。另有两条单元测试。

### 上传成功与否，看本地分发日志，不要只看界面

```bash
LATEST=$(ls -dt /var/folders/*/*/T/*.xcdistributionlogs | head -1)
grep -rhiE 'UPLOAD SUCCEEDED|ERROR ITMS|Invalid' "$LATEST" | tail -5
grep -rhoE 'BelliedMonkey[^"]*\.xcarchive|"cfBundleVersion" : "[0-9]+"' "$LATEST" | sort -u
```

第二条命令能确认**上传的到底是哪个归档、哪个 build 号**——Organizer 里同时躺着好几个
版本相近的归档时，这是唯一能证明「传的是修好的那个」的证据。

## Gate B 的缺口：逃生口挡得住 .zip，挡不住 iOS 归档

`MT_SYNC_E2E=1` 的设计是「能测，但发不出去」——它把 `.zip` withhold 掉。**但 iOS 的
可发布产物不是 `.zip`，是 `.xcarchive` / `.ipa`**，而 Xcode 工程直接读 `dist/`，
`dist/` 照常生成，所以归档、导出、上传 TestFlight 全程无阻。

2026-08-07 实测确认：以 `MT_SYNC_E2E=1` 构建的 sync-enabled `dist/` 归档出的
build 14 顺利导出并可上传。当时是**刻意**这么做的（见下），但缺口本身不该靠人记得。

**✅ 已补（2026-08-09，Gate B 落地同批）**：任何 `SKIP_ZIP` 路径现在都会在 `dist/`
写 `.not-shippable` 标记（内容 = 不可发布的原因），`verify:ios` 见标记即非零退出并
指路重跑正常构建；正常构建自动清除标记。实测：E2E 构建 → 标记落盘 → verify:ios 拒绝。

> 已知例外（2026-08-07）：TestFlight build 14 是**明知故犯**地开着同步上传的，用于
> 家庭范围内的真机测试。产品所有者在被告知承诺冲突后仍确认要这么做。这不构成先例，
> 也不改变下面 Gate B 的发布前要求。

## 打开同步之前必须改完的（Gate B 全清单）—— v1.4.0 执行记录（2026-08-09）

同步一旦对公众发布，下面每一项都必须先改完 —— 前四项是**承诺**，第五项是**登记**：

1. ✅ `README.md` / `README.zh-CN.md`（v1.4.0 同一提交；中文版顺带补上了缺失的
   Gate A bullet。闸门已扩展：中文 README 与 11 locale 的 `learn_section_hint`
   假句、声明值不足三项，任一残存都拒绝构建）
2. **官网隐私页**：`.cc` 8 个语言逐个改（执行中）；**`.com` 不改** —— 它是中国版
   站点，而 china flavor 的产物在构建时把同步翻回 false（合规未评估，另行开门），
   中国版口径仍然为真。
3. **Chrome Web Store** 的数据用途声明（提交 1.4.0 时后台更新）
4. ✅ **Firefox** 的 `gecko.data_collection_permissions` → 三项（v1.4.0 manifest；
   这是修改已公开声明，AMO 审核可见）
5. **App Store Connect 的 App Privacy** —— 如实登记「收集邮箱」与「收集用户内容
   （学习语料）」，以及是否与身份关联。**这一项不是文案，是法律登记**，写错比写少更糟。
   （提交 1.4.0 时在 ASC 填写）

发布前的自检：把「我们不接收你的任何内容」这句话在整个仓库和两个站点里 grep 一遍，
每一条命中都要能回答「同步开着的时候这句话还真吗」。
