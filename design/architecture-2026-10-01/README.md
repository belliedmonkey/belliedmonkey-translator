# 当前完整架构（2026-10-01，中国版额度翻转后）

- `architecture.html` —— 自包含一页图（无外部依赖，双击就能看）。
- 同一份也在 **Open Design** 里：项目 `app-firstrun-3step` → 产物 `architecture-2026-10-01.html`
  （由 `od artifacts create` 建；导出 html / pdf / zip 都在那边）。

图上画的六块：① 客户端与三条出口（自带 key 直连 / 免费额度中继 / 账号与同步）
② 两个 flavor 各自的额度链路（东京 vs 境内云函数 + 境内库同库）
③ 实际部署与回读判据（境内服务器 6 个容器、云函数四条回读 + 境内延迟）
④ App 首屏三段式与两个设备包的来源
⑤ 数据边界上的承诺
⑥ 判据出处。

翻转的记录与全部实测数字在 issue **#532**；部署契约在 `deploy/china/README.md`（§6 是这轮踩到的五处坑）
与 `deploy/china-relay/README.md`。

## 第二张：部署架构（国际 / 中国 分家）

- `deploy-intl-cn.html` —— **两块并列的部署拓扑**：左侧国际（东京 Supabase 项目 + 五个 Edge Function + 七张表），
  右侧中国（北京轻量服务器六个容器 + 云函数 `bt-relay` + 境内库同库的账本），中间一条「两侧之间没有任何运行时连接」
  的边界带（附三条可验证判据）。分发状态取自 gbrain 权威页（2026-09-30 实测）+ 当日现场复验。
- OD 侧同名产物：`deploy-intl-cn-2026-10-01.html`。
