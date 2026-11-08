# 产品决定

本文件只收已经裁定、并且会和别处打架的那几条。事件名、属性与字段表仍以
`docs/telemetry-design.md` 为准。这里不留第二套承诺。

## 2. 遥测

### 2.1 匿名用量

默认开、设置里可关、永不发内容。两个 flavor 都成立。见 `docs/telemetry-design.md` §2
原则 1–5 与 `AGENTS.md` 规则 4。

### 2.2 不用第三方；台账可连接但不外传

用量事件直连自有后端，没有第三方统计 SDK。**2026-11-08 修订**：`bt_auth_ok` 把
`user_id` 与 `install_id` 写进同一张第一方表，`bt_grant_usage` 也带 `install_id` ——
匿名用量与我们自己的账号**可连接**；仅用于支持与滥用排查，不用于广告、跨站追踪，
也不卖给第三方。旧的「台账不与 `install_id` 连接」到此为止。

**关掉遥测时**（2026-11-08，BEL-227）：服务端在同一次原子删除里删掉该 install 的事件行
（`bt_events`）与 `bt_auth_ok` 里对应的行 —— 这个安装与账号的关联随之消失；**仍在的是
计费流水 `bt_grant_usage`**（含 `user_id` / `install_id` / 花费与时间），按 90 天保留，
用于对账与滥用排查，关遥测不删它。

### 2.3 诊断通道

诊断通道（L2，`bt_diag_events`）仍发，单独披露，不并进 `track()`。**另**发与 intl
同构的匿名用量白名单（见 §2.4）。原文、译文不进诊断。

2026-10-06 那句「中国版只发不含内容的诊断」到此为止，不再单独代表中国版的全部上报。

### 2.4 中国版遥测 ≡ 国际版白名单

（2026-10-29 用户定。**覆盖** 2026-10-24 Gate D「仅 `listen_session` / `listen_first_line`」
与原则 6「白名单默认 0 行」。旧文不保留。）

> **4. 中国版遥测 ≡ 国际版白名单**（2026-10-29 用户定；覆盖 2026-10-24 Gate D「仅 listen_*」）：中国 flavor 发出与 intl **同一注册表**的匿名用量事件（含 `grant_claimed` / `grant_exhausted` / `engine_set` / `translate_ok|fail` 等全表）；入口仍 **境内** `api.belliedmonkey.com/.../bt-ingest`（不共东京生产）；隐私页 + 首启披露与发出事件 **同版**改写（删「无遥测是长期承诺」等无条件句；字段表与 intl 同构）。不含内容的诊断通道（L2）保持并列。原文、译文、音频、网址、账号、key 一律不发。台账与匿名用量可由 `install_id` 连接（仅自有库、支持与滥用排查、不进第三方）。境内 bt-ingest 现网部署+回读另批（Phase B）；未回读不得宣称生产已对齐。出处：`ARCH-SHORT-china-telemetry-align-intl-2026-10-29`；令 `order-gate-d-cn-telemetry-align-bel135`。

`listen_session` / `listen_first_line` 不在当前注册表里。它们以后若进 intl 表，中国版用同一张字段表，本决定不单独造子集，也不在还没有这两条时把它们写进 `EVENTS`。
