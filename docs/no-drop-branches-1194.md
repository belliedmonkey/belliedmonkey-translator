# 1.19.4 听译管线：可能丢弃 partial / 定稿文字的分支表（任务 1194）

> 范围：`app/listen-core.js`、`src/app/listen-model.js`（模型断句路与旧路共用 intake / partialBy）。
> 兜底设计见 `docs/learning-design.md` §9.6.1.12（1194 九条 + flushPartial）。

| 文件:行号（约） | 触发条件 | 原后果 | 兜底（1194） | 九条 | 单测 |
|---|---|---|---|---|---|
| listen-model.js:refreshPartial TTL | partial 超过 `PARTIAL_TTL_MS` 仍无定稿 | 从 UI 消失、文字丢失 | `flushPartial(base,'timeout')` → `final:from-partial` | ④ | `1194 · flushPartial / 九条 › ④ timeout` |
| listen-model.js:closeSocket | 切源 / 关 socket（改语言、暂停前） | `partialBy` 被清空 | `flushAllPartials('source')` | ④ | `1194 · flushPartial`（pause/source 形状） |
| listen-model.js:pause | 用户/静音暂停 | 清半句 | `clearPartials('pause')` → from-partial | ④ | 待补 pause 集成（逻辑同 timeout） |
| listen-model.js:halt | 断线/拒绝/额度停机 | 清半句 | `clearPartials('authstop'/'pause')` | ④⑧ | `S1 · authStop` |
| listen-model.js:makeSeg onDegrade | 401/403 或连续非法 JSON 降级 | 账本交旧路，partial 可能丢 | `flushAllPartials('degrade')` | ⑧ | `S1 · hardCut`（旧路原文） |
| listen-model.js:makeSeg onQuota | 402 / grant 停机 | partial 丢 | `flushAllPartials('authstop')` | ⑧ | `S1 · authStop` |
| listen-model.js:socketLost | 识别器断线/重启 | partial 丢 | `flushAllPartials('socket')` | ④ | （回放用 timeout 同形） |
| listen-model.js:intakeFinal echo | `intakeDecide` 回声拒收 | delete partial | `flushPartial('echo')` + 可 lead_split | ②⑤ | 未改：需改数据结构/原生桥（回声与 partial 同文时仍拒 final） |
| listen-model.js:intakeFinal admit | final 入账成功 | delete partial | `flushPartial('consumed')` + 未合并句首 lead_split | ②③ | `S1 · EN1 回放` |
| listen-model.js:onPartial 空串 | 识别器 partial 为空 | delete key | `flushPartial('empty')` | — | 1194 A 扫描 |
| listen-model.js:intakeFinal S1 | 标点开尾定稿 + 同 base partial | 曾 delete 丢句首 | `mergeRescueLead` 一次 feed；`rescue:lead` | ① | `listen-590` / `listen-1194-s1` |
| listen-model.js:intakeFinal split | 合并不成、前缀仍在 partial | 丢前缀 | `rescueLeadSplit` + `feed` + `rescue:lead_split` | ②③ | `1194 · ② lead_split` |
| listen-model.js:partialWorthRescue | final 无字母 / 低置信 | 整段 partial 顶替 | `final:from-partial`（**不再**因标点开尾触发） | ⑥④ | `listen-r14` 回放 |
| listen-core.js:feed rescued dup-prev | 临时稿与上条 formal 尾重复 | return 不 feed | 仍丢；入口应先 flush/合并（1194 ⑤） | ⑤ | `listen-r15` rescued 去重 |
| listen-core.js:feed trimRescueByAlign | 正式 final 与未出行 rescued 对齐 | trim 或 return | 文字对齐去重，不删 partialBy | ⑤ | `listen-r14` trim |
| listen-core.js:makeFinalGate dup-prev | 低置信/rescued 与 formal 重复 | drop 片 | 仍 drop 扣住片；句首应在 intake 已合并 | ① | `yesplease-auto-10` |
| listen-core.js:hardCut / degradeAll | 失败上限 / 降级 | 账本交旧路 | 宿主 `flushAllPartials('hardcut'/'degrade')` | ⑦⑧ | `S1 · hardCut` |
| listen-core.js:authStop | 额度/key 停机 | 账本原文出行 | 宿主 `flushAllPartials('authstop')` | ⑧ | `S1 · authStop` |
| listen-core.js:settle stop 空账本 force | stop 时 force 误伤下一句首词 | 下一句首词单独成行 | **未改：需改数据结构/原生桥**（force 生命周期与 seg 状态机） | ⑨ | `listen-r14` g3 类 |

## 说明

- **唯一出口**：`delete partialBy[…]` 仅出现在 `flushPartial` 内（1194 A）；`clearPartials` 只调 `flushAllPartials`。
- **计数**：`rescue:lead`、`rescue:lead_split`、`rescue:lead_flush`（含 reason）、`final:from-partial`。
- **暂停 / 切源**：已纳入上表；pause/source 单测与 timeout 同形（集成测可跟 `listen-1194-s1` 扩展）。
