# SA 文件组件：已踩的坑

这是评测入口的记录，不是产品行为，也不是操作清单。入口是 `node eval/baselines/asr/run-sa-file.js`。真实失败样本仍是 0。公共 16 句不能代替失败集。端到端仍 **待测**。

| 坑 | 症状 | 根因 | 结构修复 | 回归 | 实测 | 边界 |
|---|---|---|---|---|---|---|
| 可选转换器 | 编译失败，`AVAudioConverter?` 不能直接调用 | 已证实：`AVAudioConverter(from:to:)` 返回可选值 | `guard let`，失败即退出 | 源码断言转换器失败路径 | Mac 曾因此编译失败，随后编译通过 | 只覆盖文件适配器 |
| EOF nilError | 读到文件尾抛 `Foundation._GenericObjCError` / `nilError` | 已证实：`AVAudioFile.read` 在末帧返回 NO 且没有 NSError | `framePosition >= length` 时停止；中途 nilError 仍抛 | 读末帧不抛、中途仍抛 | 13:49 的 convert 阶段 | 不把转换器的 `endOfStream` 当错误 |
| 独占终点 | `finalize(through:)` 一直不返回 | 已证实：文档要等到该时间码被消费；官方返回的最后采样是 170879/16000，旧代码传了 170880/16000 | through 改为起点加帧数减一；0 帧直接失败 | `lastSampleTime`：170880→170879，非零起点的单帧，0 帧拒绝 | 15:43 已越过 finalize | 不靠随意减时间；不改成 `analyzeSequence` |
| 结果流不关 | finalize 已返回，`await reader` 直到父进程杀掉 | 已证实：`finalize(through:)` 只定稿，不结束会话；`finalizeAndFinish(through:)` 才结束结果流 | 有限文件调用 `finalizeAndFinish(through:)` | 有限文件与麦克风的结束条件分开 | 15:54 reader 正常结束，3 段定稿 | 麦克风流仍只 `finalize(through:)`，因为后面还有音频 |
| 最后一段覆盖整句 | 接口走完，文本只剩最后一句片段 | 已证实：每个 `Result` 是一段；`isFinal == false` 是修订 | 定稿按时间范围拼接，同范围替换，修订不拼入 | 聚合单测：多段、修订、同范围 | 15:54 文本是整句；Fichte 听成 Fished 是替换 | 不改产品桥；接口返回不是转写正确 |
| 任务组取消等不到 | 进程内 45 秒到点后函数不返回 | 已证实：`withThrowingTaskGroup` 会等已取消的子任务，`finalize` 不响应取消 | 删掉文件路径上的任务组。父进程看 `item-progress.json`，45 秒 `SIGTERM`，5 秒后 `SIGKILL` | 忽略 SIGTERM 的子进程以 SIGKILL 结束，`swiftExit` 为 null | 15:43 的 45 秒是 Node 杀掉的，不是任务组返回 | 不承诺“取消任务即截止” |
| 包装退出码 | 子进程退出 2，包装却退出 0，并把超时记成 `swiftExit` 1 或 0 | 已证实：包装用自己的 0 代替子进程状态 | 顶层 `swiftExit` 在超时或信号时为 null；子进程 2 使包装非 0 | 真实 `process.exit(2)` 与 `process.exit(0)` | 15:08 的包装 0 | 0 不是产品分数 |
| 资源状态 | 同机先 `installed` 后 `supported`；请求为 nil 后复查才是 `installed` | 未知：源码没有 `release`，也不能从进程身份下结论 | `supported` 才发一次官方请求；nil 按“不必再下载”复查，仍不是 `installed` 就失败 | 准备选项只对一句合法；默认 16 走 `ensureOnce` | 16:04 两语 `supported`，请求 nil，下载 0，复查 `installed` | 不编造状态变化的原因；不调用 `reserve` / `release` |
| 官方对照没跑到 | 手动路径卡住，官方 `analyzeSequence` 没有记录 | 已证实：控制没进入官方路径 | 官方路径单独进程；后来手动路径已能自己走完 | 路径隔离测试 | 15:31 官方路径单独跑通；15:08 之前的缺席不能当反证 | 官方结果不是产品分数 |
| 静态测试 | JS 断言通过 | 已证实：Linux 没有 Apple SDK | 断言标明不是 `swiftc` | 源码测试的名称写明这一点 | 每次 Mac 编译才是 SDK 证据 | 不把 JS 测试写成编译通过 |
| 参考与口径 | `cmn_hans_cn/1663` 的 26/63 占中文错误大头 | 计分参考含 21 个拉丁字母；音频未核这串有没有被念出。不是评分器分叉 | 不改冻结参考，不重算 | 1663 参考长度 63，`two` 与 `2` 不是同一个词 | 2026-11-12 主席摘要 | 探索性分数，不是排行榜 |
| 组件边界 | 文件分数被当成默认中文臂或端到端 | 已证实：国际版 Mac 中文默认是 `e1_b1`，且在产品进程里 | 记录 `sameProductProcess: false`、`endToEnd: false`、`productMetric: false` | 计划与评分测试 | 16 句是 SA 文件组件 | 真实失败集仍是 0，公共集不能替代 |
| 7 秒 | 整段很快 | 已证实：7 秒含编译和资源准备 | 摘要写 `notProductLatency` | 摘要字段 | 16:04:00–07 | 不能当成产品延迟或模型实时率 |

16 句的英文 WER 11/174、中文 CER 33/301 记在 [asr-public.md](asr-public.md)。机器可读摘要是 `eval/baselines/asr/mac-sa-16-chair-2026-11-12.json`。假设文件不在本仓库。
