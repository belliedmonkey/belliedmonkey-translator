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

## 「证书不受信任」：真因是代理劫走了那次校验（2026-09-25 解决）

装上新二进制之后，iOS 要**联网校验一次开发者证书**。这次请求**走代理走不通**时报

```
The application could not be launched because the Developer App Certificate is not trusted.
```

`devicectl` 帮不上忙（它没有「信任证书」这个能力），只能人在主屏点一下 `S56UITests-Runner`
的图标——点图标就是在前台重试那次校验。

**根治办法：把校验链路放直连。** 手机的 Shadowrocket 导入本目录的
[`shadowrocket-apple-dev-bypass.module`](shadowrocket-apple-dev-bypass.module)
（配置 → 模块 → + → 填地址 → 打开开关）。它只放行 `ppq.apple.com` 与几个 OCSP/CRL 域名，
**故意不写 `DOMAIN-SUFFIX,apple.com`**。

**对照实验（同一天，同一台机器）**：

| | 重建 runner 之后直接跑 |
|---|---|
| 导入模块前 | 失败两次，每次都要人点图标 |
| 导入模块后 | `TEST EXECUTE SUCCEEDED`，12.5 s，附件里有 `[0-launch] 起了 …` + 截图 —— **一下都没点** |

> 走到这一步之前绕过两个错误结论：以为是「卸了 runner」、以为是「Xcode 轮换了证书」。
> 逐项回读推翻了后者（**只有一张有效证书、profile 两个月没变，每次变的只有 CDHash**），
> 而真因是用户那句「先关 Shadowrocket 再打开 app 才行」点破的。
> **有人在回路里的时候，他的观察是最便宜的一次测量。**

「设置 › 通用 › VPN与设备管理」里**没有**「开发者App」那一节（开发者模式开着就不用它）——别去那里找。

⇒ 即便如此仍然**优先少重建**：加新流程用下面那个脚本驱动的用例，不需要改 Swift。

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
