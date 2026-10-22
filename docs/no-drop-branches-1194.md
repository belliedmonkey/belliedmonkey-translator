# 1.19.4 听译管线：可能丢弃 partial / 定稿文字的分支表（任务 1194）

> 范围：`app/listen-core.js`、`src/app/listen-model.js`（模型断句路与旧路共用 intake / partialBy）。
> 兜底设计见 `docs/learning-design.md` §9.6.1.12（1194 九条 + flushPartial）。

| 文件:行号（约） | 触发条件 | 原后果 | 兜底（1194） | 九条 | 单测 |
|---|---|---|---|---|---|
| listen-model.js:refreshPartial TTL | partial 超过 `PARTIAL_TTL_MS` 仍无定稿 | 从 UI 消失、文字丢失 | `flushPartial(base,'timeout')` → `final:from-partial` | ④ | `1194 · 生产 flushPartial › ④ timeout` |
| listen-model.js:closeSocket | 切源 / 关 socket（改语言、暂停前） | `partialBy` 被清空 | 调用方先 `flushAllPartials('source')`；`closeSocket` 本身不再 flush | ④ | `1194 · pause 集成` / `pause / source` 形状 |
| listen-model.js:pause | 用户/静音暂停 | 清半句 | `clearPartials('pause')`（在 `closeSocket` 前）→ `rescue:lead_flush`（环内 `why:pause`）+ `rescue:pause_partial`（长度+前 8 字） | ④ | `1194 · pause 集成` / `lead-mac-r2b A-pause-orphan` |
| listen-model.js:halt | 断线/拒绝/额度停机 | 清半句 | `clearPartials('authstop'/'pause')` **先于** `closeSocket` | ④⑧ | `1194 · authstop` / `S1 · authStop` |
| listen-model.js:makeSeg onDegrade | 401/403 或连续非法 JSON 降级 | 账本交旧路，partial 可能丢 | 先 `segDegrade` 再 `flushAllPartials('degrade')`；rows 重复/前缀 → `degrade_dup` | ⑧ | `S1 · hardCut` / r3d ⑧b |
| listen-model.js:makeSeg onQuota | 402 / grant 停机 | partial 丢 | **先** `segDegrade = true` **再** `flushAllPartials('authstop')`；补行前 rows 重复/前缀 → `authstop_dup`（零内容） | ⑧ | `1194 · authstop` / r3d ⑧′⑧a |
| listen-model.js:socketLost | 识别器断线/重启 | partial 丢 | `flushAllPartials('socket')` | ④ | `1194 · timeout` 同形 |
| listen-model.js:intakeFinal echo | `intakeDecide` 回声拒收 | delete partial | 统一 `classifyEcho`（播放中/尾窗文字）：经 `feedPartialRescue` 丢弃 + `rescue:echo_drop`；否则整段出行 + `lead_flush:echo` | ②⑤ | `1194 · echo` / `echo r2b` |
| listen-model.js:intakeFinal admit | final 入账成功 | delete partial | `flushPartial('consumed')` + 未合并句首 `lead_split` + `lead_flush`；partial 与定稿 `sameUtterance`（T=0.8）⇒ `consumed_same` 不补行；否则无关 orphan 经 `feedPartialRescue` 单独出行 | ②③ | `S1` / `lead-mac-r2b` / `echo r2b` |
| listen-model.js:onPartial 空串 | 识别器 partial 为空 | delete key | `flushPartial('empty')` 整段出行（上一帧 `p.text`） | — | `1194 · empty/无 locale/未知 reason` |
| listen-model.js:flushPartial 无 locale | `localeForBase` 为空 | 静默 delete | `C.toLocale(base)` 兜底 + 整段出行 | — | `1194 · empty/无 locale/未知 reason` |
| listen-model.js:flushPartial 未知 reason | 未列出的 reason | 静默 delete | 整段出行 + `lead_flush:{reason}` | — | `1194 · empty/无 locale/未知 reason` |
| listen-model.js:feedPartialRescue | 入口 `classifyEcho` 命中回声 | 不上屏 | 记 `rescue:echo_drop{why,src,len,sim}`；否则 seg/cutter/`segFallback` 出行 | ②⑤⑧ | `1194 · echo r2b` / `authstop flush` |
| listen-model.js:intakeFinal S1 | 标点开尾定稿 + 同 base partial | 曾 delete 丢句首 | `mergeRescueLead` 一次 feed；`rescue:lead` | ① | `listen-590` / `listen-1194-s1` / `② 句首 rescue` |
| listen-model.js:intakeFinal badCut | `badCut` 挡合并（final 字母多于 lead） | 丢 `cut.lead`；`cut.text` 也不替换 final | `dedupePartialEmit(lead)` → `feedPartialRescue` + `lead_split`/`lead_flush`（reason `badcut`）+ `leadUsed`；定稿仍用 `cut.text` | ②③ | `1194 · TED badCut` |
| listen-model.js:intakeFinal split | `rescueLeadCut` 无 lead、前缀仍在 partial | 丢前缀 | `rescueLeadSplit` + `feed` + `lead_split` + `lead_flush` | ②③ | `1194 · ② lead_split` |
| listen-model.js:partialWorthRescue | final 无字母 / 低置信 | 整段 partial 顶替 | `final:from-partial`（**不再**因标点开尾触发） | ⑥④ | `listen-r14` 回放 |
| listen-core.js:feed phase closed | `phase==='closed'`（非 degrade）迟到 feed | 静默 return | `emitClosedStandalone` 先 `classifyEcho`；回声 `rescue:echo_drop`；否则 legacy 单独成行 + `seg:closed_emit` | ②④ | `lead-mac-r2b` / `echo r2b` |
| listen-core.js:finishClosing | settle end 收尾时账本仍有 wait | 可能永不 commit | 先 `legacyRecs` 扫未 commit 再 `phase=closed` | ④ | `lead-mac-r2b A-pause-orphan` |
| listen-core.js:feed rescued dup-prev | 临时稿与上条 formal 尾重复（`isTailDup` ≤300ms） | return 不 feed | 记 `rescue:dup-prev`；被丢文字须已在已出行行里 | ⑤ | `1194 · dup-prev feed 真实丢弃` |
| listen-core.js:feed trimRescueByAlign | 正式 final 与未出行 rescued 对齐 | trim 或 return | 文字对齐去重，不删 partialBy | ⑤ | `listen-r14` trim |
| listen-core.js:makeFinalGate dup-prev | 低置信/rescued 与 formal 重复 | drop 片 | `lastFormal` 仅在**实际放行**后更新（被 gate/echo 拦掉的不记入 prev） | ① | `yesplease-auto-10` |
| listen-core.js:makeSegmentRouter lastFormalRec | 同上（账本 feed 路径） | dup-prev 误杀 | 仍仅在正式 final 入账时更新；被 trim 空的不更新 | ⑤ | `listen-r14` dup-prev |
| listen-core.js:hardCut / degradeAll | 失败上限 / 降级 | 账本交旧路 | 宿主 `flushAllPartials('hardcut'/'degrade')` | ⑦⑧ | `S1 · hardCut` |
| listen-core.js:authStop | 额度/key 停机 | 账本原文出行 | 宿主 `flushAllPartials('authstop')` | ⑧ | `S1 · authStop` |
| listen-core.js:settle stop 空账本 force | stop 时 force 误伤下一句首词 | 下一句首词单独成行 | **未改：需改数据结构/原生桥**（force 生命周期与 seg 状态机；放下一版） | ⑨ | `listen-r14` g3 类 |

## 说明

- **唯一出口**：`delete partialBy[…]` 仅出现在 `flushPartial` 内（1194 A；`_test1194.setPartial` 钩子豁免）；`clearPartials` 只调 `flushAllPartials`。
- **计数**：`rescue:lead`、`rescue:lead_split`、`rescue:lead_flush`（**`why`**：pause/echo/timeout/consumed/badcut/split/authstop/degrade 等）、`rescue:echo_drop`（统一回声闸丢弃）、`rescue:consumed_same`（partial 与定稿同句不补行）、`rescue:authstop_dup` / `rescue:degrade_dup`（额度/降级补行前与已上屏 rows 重复或前缀，零内容只记长度）、`rescue:pause_partial`、`final:from-partial`。
- **回声（1.19.4 r2b）**：`listen-core.classifyEcho` + `sameUtterance`；上屏咽喉 `feedPartialRescue` / `emitClosedStandalone`；intake / xfer / partial 半句 / flush echo 均调同一函数。
- **closeSocket**：不再内置 flush；`pause` / `halt` / 改语言 / `end` 在关 socket 前用正确 reason 调 `clearPartials` / `flushAllPartials('source')`。
