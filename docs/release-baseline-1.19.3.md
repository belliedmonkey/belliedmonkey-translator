# 大肚猴翻译 发版测试基线（2026-10-11，1.19.3 候选）

用户规定（2026-10-11 12:57）：以后只要不比这个基线差就可以发版。

代码：~/dsh-plugins/trial3/wt（dsh-trial/seg-r8，基于 a4fca8b7）= 1.19.3 合入内容。

## 自动化（副本 ~/dsh-plugins/precheck）
- npm test 2628/2628 全过（含全部随机序列）
- test:app、test:app:china 通过；扩展 smoke/inject/menu/layout 44/44
- 国际/中国 × iOS/macOS Release 编译通过；verify:ios、资源新鲜度两条线通过
- test:mac：待 1.19.3 合入后补跑，结果补进本文件

## 真机（Mac App，硬指标）
- 重复出字 0、乱序 0、卡住 0、说中文键时英文侧乱码出行 0

## 真机（Mac App，逐组；有出行 / 3 秒内出行）
| 用例 | 有出行 | 3 秒内 | 来源 |
|---|---|---|---|
| 英文长句 自动听 | 10/10 | 9/10 | r15 |
| 英文长句 点停 | 5/5 | 5/5 | r14 |
| Yes 自动听 | 9/10 | 6/10 | r15（含 Yeah/Y 识别变体）|
| Yes please 自动听 | 10/10 | 9/10 | r15 |
| Yes 点停 | 3/5 | 2/5 | r15（已知问题：时间归零误去重）|
| Yes please 点停 | 5/5 | 5/5 | r15 |
| 中文长句 自动听 | 5/5 | 5/5 | r14 |
| 中文长句 点停 | 3/3 | 3/3 | r14 |
| 今天天气不错 自动听 | 5/5 | 3/5 | r15 |

## 已知问题（放行）
- 点停模式「Yes」偶发不出行
- 英文长句偶发后半句丢失（识别器只给 `to....`、模型退回整段）
- Yes 被识别成 Yeah/Y；中文偶丢开头「请」

## 待补
- 1.19.3 的 Mac 效果验收录屏和 iPhone 真机结果，验完补进来

## 1.19.3 出包记录（2026-10-11）
- 提交：~/mobiletranslator-1190 feat/firstrun-gates，a35b35ea（听译分句修复 + 版本号）、41a5fb64（providers.gen.js 版本常量）；打包用 HEAD = 41a5fb64，工作区干净（只剩 .dsh-bridge-git/ 未跟踪）
- TestFlight（只上传，未提审、未挂到版本、未推送）：ASC 读回四个 build 都是 VALID
  | 线 | 版本 / build | bundle id | ASC |
  |---|---|---|---|
  | 国际 iOS | 1.19.3 / 163 | com.belliedmonkeytranslator | VALID |
  | 国际 Mac | 1.19.3 / 111 | com.belliedmonkeytranslator | VALID |
  | 中国 iOS | 1.19.3 / 106 | com.belliedmonkeytranslator.cn | VALID |
  | 中国 Mac | 1.19.3 / 104 | com.belliedmonkeytranslator.cn | VALID |
- 出口合规：四个包的 Info.plist 都写了 ITSAppUsesNonExemptEncryption=false；没有动 TestFlight 测试组

## 1.19.3 Mac 验收 r2（41a5fb64，15:07–15:17，条件同 r14 measure，自动朗读关）
有效 6 组（有出行 / 含末字 / 3 秒内）：
| 用例 | r2 | 对比基线 |
|---|---|---|
| 英文长句 自动听 | 10/10 · 9/10 · 6/10 | 3 秒内比基线差（基线 9/10）|
| 英文长句 点停 | 5/5 · 5/5 · 5/5 | 持平 |
| Yes 自动听 | 10/10 · 10/10 · 6/10 | 持平 |
| Yes please 自动听 | 10/10 · 10/10 · 8/10 | 差 1 次 |
| Yes 点停 | 1/5 · 1/5 · 1/5 | 比基线差（已知问题）|
| Yes please 点停 | 5/5 · 5/5 · 5/5 | 持平 |
有效组里重复 0、乱序 0。中文长句两组受房间人声干扰，不计；「今天天气不错」没跑（输出被外部静音）。录屏：/workspace/qa/1.19.3/qa-mac-r2.mp4

## 1.19.3 已知问题（用户 15:56 同意带着发）
- 点停「Yes」被误去重不出行（r2 里 4/5 次）
- 英文长句偶发只出 `and....`，后半句丢失（识别器给出垃圾定稿，模型退回整段）
- 中文暂定译文慢一拍：新的半句已经出现，斜体暂定译文还停在上一句，约 3 秒（refreshPartial 的显示文字与增量翻译输入不一致；不阻塞）
- 中文组没在安静环境补测（r2 的中文两组受人声干扰）
- iPhone 听译这次没验
- test:mac M8/M9 因为 macOS 权限（EPERM）没跑通
