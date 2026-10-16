# AEC3 探针结论

2026-10-16 用户决定：停止 AEC3 探针，不再做声学测试，不往 App 里加 AEC3。本文只记已经写进日志和 [issue #595](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595) 的结果。分档不在这里重判。

验收写在 `docs/audio-aec3-proposal.md` 第 4 节和第 5 节：第 5 节三项都过，才可以再谈撤掉静麦和同语言硬拦；任一不过就不撤。第 5.2 节的真实语音档是：AEC3 开着时，对方在朗读期间说的那一句被收下。

## 第一步：编译与体积

日志 `docs/status/aec3-probe-step1-2026-10-16.json`。评论 [6205890307](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6205890307)。

按 `BuiltinAudioProcessingBuilder`、`echo_canceller.enabled = true` 链上的最小程序，Mach-O arm64 可执行文件 1,460,400 字节。`llvm-strip` 去掉符号和调试信息后的副本 1,018,560 字节。日志写明：这不是已经打进 App 的增量。

## 第二步及以后的声学结果

| 项 | 结果 | 来源 |
|---|---|---|
| 5.1 自己的声音 | 关 RMS 0.124030842，开 0.000472810995，比值 0.00381204374，档位「过」 | `docs/status/aec3-probe-step2-2026-10-16.json`；[6206239074](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6206239074) |
| 5.3 收敛 | 最早 t = 0.0 秒，档位「过」 | 同上 |
| 5.2 iPhone 外放 880 Hz | 关 9.40264987e-05，开 1.93630433e-05，比值 0.20593177，档位「不过」 | `docs/status/aec3-probe-step2-52-2026-10-16.json`；[6206610630](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6206610630) |
| 5.2-D | 前置不成立（关时 880 / 440 = 0.0145146888，规则是 ≥ 1/10）。没有分档 | `docs/status/aec3-probe-step2-52d-2026-10-16.json`；[6206763823](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6206763823) |
| 5.2-E 880 Hz | 关 0.000774843301，开 0.000680512408，比值 0.878258103，档位「过」 | `docs/status/aec3-probe-step2-52e-2026-10-16.json`；[6206871118](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6206871118) |
| 5.2-E 语音频段 | 关 0.109947708，开 0.0293385933，比值 0.266841337，当时档位「不过」 | 同上 |
| 5.2-F F1 对方单独说话 | 关 0.0577278619，开 0.0556271294，比值 0.963609729，档位「过」 | `docs/status/aec3-probe-step2-52f2-2026-10-16.json`；[6207135062](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6207135062) |
| 5.2-F F2 双方同时 | 关 0.0520193546，开 0.0135959962，比值 0.261364185，档位「不过」 | 同上 |
| 5.2-F 的 440 Hz | 关 0.00479457524，开 1.18039929e-09，开/关 2.46194758e-07，档位「压住」 | 同上 |

5.2-E 的语音频段比值不能当作语音保留率。规则评论 [6207004077](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6207004077) 写明：那次 300 到 3400 Hz 的 RMS 含自己的 440 Hz，关闭时的 0.109947708 主要是自己的测试音。5.2-E 的「不过」没有改判。5.2-F 的测量日志是 `aec3-probe-step2-52f2-2026-10-16.json`。`aec3-probe-step2-52f-2026-10-16.json` 是自检未过、没有开录的记录。

5.3 记 0.0 秒时，评论 [6206365689](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6206365689) 写下存疑：有可能不是消掉了回声，而是把麦克风整路压没。其后 5.2-E 的 880 Hz 留在关的一半以上（比值 0.878258103，过），5.2-F 的 F1 也留在一半以上（比值 0.963609729，过）。这两项部分排除「一整路都被压没」。F2 的比值 0.261364185 低于一半，不在这两项里。

## 局限

- F2 里对方声音和自己的 440 Hz 都从这台 Mac 的扬声器出去，同一条回声路径。5.2-E 的日志写：比真实场景更严。5.2-F 的日志写了同一句。见 `aec3-probe-step2-52e-2026-10-16.json` 的 `limitation`，以及 `aec3-probe-step2-52f2-2026-10-16.json` 的 `f2Path`。
- 合成语音不等于真实对话。5.2-F 的日志写：合成语音只能说明别人的语音不被压，不代表真实双方同时说话，人声的真实场景仍未验。
- F2 开/关比值是 0.261364185。这份残余能否被识别器认出：未测。日志里没有识别器读数。
- iPhone 的 `.mixWithOthers` 未做。`docs/audio-aec3-proposal.md` 第 3 节写：`.mixWithOthers` 是否保留未验证，本提案不改。探针日志里没有这项测量。

## 结论

按事先写好的验收，AEC3 不满足「自己朗读时对方插话仍能收」，因此现在不能撤掉静麦与同语言丢弃两道硬拦；苹果回声消除同样不满足（phase1h）。

第 5.2 节的 iPhone 880 Hz 是「不过」，5.2-F 的 F2 也是「不过」。第 4 节写明三项都过才撤两道硬拦。phase1h 的档位是 Q：880 Hz 开/关 = 2.5697716419788609e-11，开着时对方的 880 Hz 也被压没。日志 `docs/status/vp-probe-phase1h-2026-10-15.json`，评论 [6198182945](https://github.com/belliedmonkey/belliedmonkey-translator/issues/595#issuecomment-6198182945)。

## 可选后续

只列在这里，不排序，不推荐：

- 保持静麦
- 只在两句朗读之间开麦
- 测残余语音的识别率
- 换别的回声消除实现
