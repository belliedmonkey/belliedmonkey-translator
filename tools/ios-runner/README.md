# tools/ios-runner —— 遥控真机 iPhone 的 XCUITest runner（源码）

这份是**源码的权威副本**。构建工作区在 `.local/spike/S6/runner/`（gitignored，里面还有
XcodeGen 生成的 `S56Runner.xcodeproj` 和 `dd-runner/` 的构建产物）。

> **为什么要有这个目录（2026-09-25）**：在这之前 runner 的源码**只存在于 `.local/` 里**，
> 而 `.gitignore` 忽略了整个 `.local/`。一天里加的 `testDrive` / `testFillKey` /
> `MT_NO_CLOSE` / 按标签找下拉 / 按住拖选，全都只在那一块盘上，清一次就没了。

## 两份怎么同步

改**这里**这一份，然后拷回工作区再构建：

```bash
cp tools/ios-runner/UITests/S56UITests.swift .local/spike/S6/runner/UITests/
cp tools/ios-runner/Host/HostApp.swift      .local/spike/S6/runner/Host/
cp tools/ios-runner/project.yml             .local/spike/S6/runner/
cd .local/spike/S6 && xcodebuild build-for-testing \
  -project runner/S56Runner.xcodeproj -scheme S56Runner \
  -destination id=<UDID> -derivedDataPath dd-runner -allowProvisioningUpdates
```

`npm test` 里的 `test/ios-runner-sync.test.js` 会比对两份的 sha256，不一致就红 ——
免得「改了工作区那份、仓库里这份还是旧的」这种静默漂移。

## 「证书不受信任」：触发它的是**装新 App 的二进制**，不是重建 runner

装上一个**这个开发者身份签的新 App 二进制**之后，iOS 要联网校验一次证书。校验没完成时，
**同一身份签的其它程序（包括这个 runner）一起被挡**，报：

```
The application could not be launched because the Developer App Certificate is not trusted.
```

`devicectl` 帮不上忙（它没有「信任证书」这个能力，而且**它不触发校验**）。

**已知可行的解法**（2026-09-25 当天两次实测，顺序不能错）：

1. **关掉手机上的代理（Shadowrocket）**
2. 人在主屏点一下 `S56UITests-Runner` 的图标（灰色空白图标，点开可能一闪就退，正常）
3. **再把代理打开**

「设置 › 通用 › VPN与设备管理」里**没有**「开发者App」那一节（开发者模式开着就不用它）——别去那里找。

### ⚠️ 本目录的 Shadowrocket 模块：**没有被证实有效，别当成根治**

`shadowrocket-apple-dev-bypass.module` 放行 `ppq.apple.com` 与几个 OCSP/CRL 域名。
当天我一度断言它根治了这件事，**那个结论是错的**：

| 观测 | 我当时的解释 | 实际 |
|---|---|---|
| 导入模块后重建 runner 三次全过、不用点 | 模块生效了 | **重建 runner 本来就不需要重新校验** —— 证书那时已经受信，变的只有二进制哈希 |
| 导入模块前重建失败两次 | 模块没装 | 那两次前面**装过新 App**，欠的是那一次校验 |
| 装完主 App 新包，runner 被挡、重建也不管用、点图标报「无法验证App」 | —— | **此时代理是开着的**（用户确认）⇒ 模块并没有让校验通过 |

最后一行是决定性的：**开着代理 + 装着模块，校验照样失败。** 所以模块留在这里只当一份
线索（域名清单是对的），**不要再把它写成解法**。为什么放行了还不通没有查实 —— 可能这段
流量不走 Shadowrocket 的规则引擎，也可能端点不止这几个。

> 方法论上这一条比结论值钱：**两个解释都能装下同一批观测时，我只验证了自己先想到的那个。**
> 分开它们的测试一直都在手边（关掉模块重建一次），而我没做就把结论写进了文档、记忆和 PR。
> 真正把它翻过来的又是用户的一句观察 ——「点的时候 Shadowrocket 是开着的」。

## `testDrive` —— 加流程写 JSON，不重建

```bash
cd .local/spike/S6
TEST_RUNNER_MT_TARGET_BUNDLE=com.belliedmonkeytranslator \
TEST_RUNNER_MT_SCRIPT='[
  {"op":"launch"},{"op":"alerts"},
  {"op":"tap","text":"以后再设置","exact":true},
  {"op":"tap","text":"我已打开"},
  {"op":"tap","text":"实时字幕","exact":true,"swipes":8},
  {"op":"tap","text":"开始","exact":true},
  {"op":"wait","s":8},{"op":"shot","name":"listening"}
]' \
xcodebuild test-without-building -project runner/S56Runner.xcodeproj -scheme S56Runner \
  -destination id=<UDID> -derivedDataPath dd-runner -resultBundlePath x.xcresult \
  -only-testing:S56UITests/S56UITests/testDrive
xcrun xcresulttool export attachments --path x.xcresult --output-path att   # 判据看附件
```

步骤只覆盖**真用过的动作**：

| op | 参数 | 说明 |
|---|---|---|
| `launch` / `activate` / `terminate` | `s` | 目标 App；`bundle` 可临时切换 |
| `alerts` | `s` | 吃掉系统权限弹窗 |
| `open` | `url` `s` | `XCUIDevice.system.open` |
| `tap` | `text` `exact` `swipes` | 滚动着找文字并点 |
| `menu` | `item` `s` | 点选中菜单里的一项（拷贝/查询/翻译/查找）|
| `drag` | `text` `from` `to` | **选整句**：长按只选一个词、三连点不扩选，只能按住拖 |
| `select` | `label` `value` | 下拉：**按标签找，不按值找**（四个下拉的值都是「中文」或「English」）|
| `selects` | `tag` | 整页下拉**边滚边收**（只看当前屏会误判「那几档不存在」）|
| `key` | `value` `expectLen` | 填密钥框；判据是**圆点数 == key 长度** |
| `wait` / `shot` / `dump` | `s` / `name` / `tag` | |

**没有 `MT_SCRIPT` 会直接 `XCTFail`** —— 「passed 但什么都没做」是这个 runner 的老毛病
（`docs/verification-spec.md` §0.2.3 第 1 条：判据看附件，不看 passed）。

## 其余用例

39 个历史用例仍在（`testT1*` 系统翻译、`testPiPClose` 实时字幕+画中画、`testCN*` 中国版、
`testV*` 收件箱……）。它们是特定流程的固化版本，改它们要重建；**新流程优先走 `testDrive`。**
