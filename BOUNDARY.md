# BOUNDARY.md · 公仓 / 旁仓边界（OpenCode B′ · P0）

- **状态：** P0 落地稿（BEL-172）。**不是**「已按 MIT 开源」的公告。
- **依据：** [`docs/architecture-p0/P0-SPLIT-opencode-b-prime-2026-11-01.md`](docs/architecture-p0/P0-SPLIT-opencode-b-prime-2026-11-01.md) §2 ·
  [`docs/architecture-p0/CONTRACT-v0-hosted-gateway-2026-11-01.md`](docs/architecture-p0/CONTRACT-v0-hosted-gateway-2026-11-01.md) §0/§5/§7
- **许可证状态：** 本分支是 **OSS orphan 根**（`oss/mit-orphan`），项目代码为 **MIT**。
  商店 / 开发 tip（`main`、`release/**`）在迁到 orphan 根之前仍是 GPL-3.0-or-later。
  **本拍不对外宣布 MIT**：发布 tag / 营销文案另走 `docs/oss-release.md` 的公告闸。
- **执行：** `scripts/check-boundary.js` + `.github/workflows/boundary.yml`；`npm test` 里的
  `test/boundary.test.js` 守同一张表。

## 0 · 一句话

**公仓只放「任何人都能拿到、拿到也不泄密」的东西**：客户端壳、本地协议、BYOK 配置面、
公开契约与 mock、公开 flavor 配方与布尔开关语义。**托管实现、账本、上游 Key、合规
填报与运维 runbook 全部在私有旁仓**。任何「为了构建方便临时放回来」都是这张表的失效。

## 1 · 公仓 allowlist（可留 / scrub 后留）

| 路径模式 | 说明 |
|---|---|
| `app/` `src/app/` | 宿主 App 壳与共享 UI |
| `extension/` `src/{content,pages,shared,store,lib}` | 扩展壳；**后端地址/anon key 改为 build 注入**（`build/backend-inject.js`） |
| `agent/`（stdio / 本地协议 / BYOK credentials 槽） | **禁**内嵌上游供应商 Key；grant 客户端只调契约 |
| `build.js` `build/*.config.js` | flavor 公开配方；`china.ready` / `grant.china.ready` **布尔语义**可留 |
| `docs/` | 含 tip 防丢闸与 `docs/oss-release.md`（商店 tip ≠ OSS tag） |
| `scripts/tip-*.sh` 等防丢闸脚本 | 可开；含内网 URL 的 runbook 去旁仓 |
| `contracts/` | 托管 API 契约（OpenAPI），纯 schema，**无真钥** |
| `mocks/` | 契约 mock（`mocks/hosted-gateway/`），CI 只打这里 |
| `test/`（公仓可构建子集） | 集成测打 mock，不打真 grant |
| `supabase/schema.sql` | **数据契约**：表、RLS、配额约束；见 §4 carve-out |
| `supabase/functions/bt-ingest/events.gen.json` | 公开事件白名单（BEL-135：china ≡ intl）；**不含实现** |
| `LICENSE` `NOTICE` `README` `BOUNDARY.md` | 许可证与诚实叙述（`mcp-remote` 已发布事实另见 README 修正） |

## 2 · 公仓 denylist（P0 必须迁出或删除出公 tip）

| 路径模式 | 迁往 | 本拍动作 |
|---|---|---|
| `supabase/functions/bt-relay/` | `*-hosted` | 已迁出；公仓只留契约 + mock |
| `supabase/functions/bt-grant/` `bt-grant-ledger/` | `*-hosted` | 已迁出 |
| `supabase/functions/bt-models/` | `*-hosted` | 已迁出（按 IP 选源 + 模型清单） |
| `supabase/functions/bt-ingest/`（真管道） | `*-hosted` | 已迁出；公仓留 `events.gen.json` 白名单 |
| `supabase/functions/bt-delete-account/` | `*-hosted` | 已迁出 |
| `deploy/china-relay/`（SCF 打包公网中继） | `*-hosted` | 已迁出 |
| `build/china-gate.js` 的**区域策略实现**（host 白名单 / `MT_GRANT` 形状 / grantOnly 端点） | `*-compliance` | 已迁出；公仓只留品牌 + no-`*.supabase.co` 不变量 |
| `deploy/china/`（备案/部署/审计 runbook） | `*-compliance` | 已迁出 |
| `supabase/README.md`（运维 runbook / secrets set） | `*-hosted` | 公仓改为契约指针 |
| `extension/learn/backend.config.js` 内硬编码 anonKey/host | **删硬编码**；build 注入 | 已改为占位 + 注入 |
| `.mcp.json` 真 `project_ref` | 示例占位 / 本地配置 | 已改为占位 |
| 任何 `service_role` / `GRANT_KEK` / Apple 共享密钥 / 上游 API Key 真值 | **永不入公 tip**（含 history → orphan） | gitleaks 零高危；见 `evidence/secret-scan.md` |
| 任何 `import` / submodule 指向旁仓源码 | — | 公仓构建不依赖旁仓 |

### 2.1 CI path-deny

- PR / tip 触及上面任一路径 → **FAIL**（`scripts/check-boundary.js`）。
- 全树 secret scan（gitleaks）高危 → **FAIL**（`.github/workflows/boundary.yml`）。
- 公仓构建里出现旁仓路径（`HOSTED_REPO` / `../belliedmonkey-translator-hosted` 等）→ **FAIL**。
- 例外只允许**契约/白名单/mock**：`contracts/**`、`mocks/**`、
  `supabase/functions/bt-ingest/events.gen.json`、`supabase/schema.sql`。

## 3 · 威胁模型（承重，摘自 CONTRACT-v0 §0）

1. **BYOK 默认不经托管网关**：用户供应商 Key 仅本机（`chrome.storage.local` /
   local-keys / agent credentials）；请求直连供应商。
2. **托管路径**客户端只持用户会话 JWT / grant token；**上游供应商 Key 只在 hosted**。
3. **托管响应不得回显**上游 Key、`service_role`、`GRANT_KEK`、原始供应商错误体里的密钥材料。
4. **禁强制改道**：额度用尽回落 BYOK 由客户端本地完成；服务端不得把已声明 BYOK 的请求
   劫持进托管。
5. **公仓集成测试只打 `mocks/`**；禁真 grant 密钥进 CI。

## 4 · 显式 carve-out（须架构形检确认）

| 项 | 决定 | 理由 |
|---|---|---|
| `build/china-gate.js` | 公仓只留**通用不变量**：品牌词 + 无 `*.supabase.co`。区域策略（境内 host 白名单、`MT_GRANT` 形状、grantOnly 端点）在 `*-compliance` 的 `china-gate/`（13 条证伪测试 + `check-dist.js`） | 公仓构建必须能自证「无品牌词、无东京后端」—— 这是公开承诺，不是运营策略。详细区域策略是合规实现，已迁私仓；两边都不是对方的替代品。 |
| `supabase/schema.sql` | **留在公仓** | 它是已公开的数据契约（表、RLS、配额），`docs/learning-design.md` 已逐条描述。**不是**服务端实现；实现（函数、部署、密钥）已迁旁仓。 |
| `supabase/functions/bt-ingest/events.gen.json` | **留在公仓** | 事件名白名单按 O8 可公开；真管道在 hosted。 |

> 以上两项是**有意的解释**，不是遗漏。`build/china-gate.js` 的区域策略已按拆仓图迁到
> compliance（公仓只留通用品牌/东京不变量）；其余两项是公开数据契约。不要在没有替代闸的
> 情况下删除公仓的品牌/东京不变量。

## 5 · mcp-remote（O7）

- **推理网关（旧 `bt-relay`）≠ Remote MCP**（连接 / OAuth / 工具面）。
- 推理网关 → `*-hosted`；`belliedmonkey-mcp-remote` 的协议/OAuth 壳可留公。
- 额度计量 / 托管上游调用 → hosted 或经 `contracts/hosted-gateway.v0.yaml`。
- **禁**借本拍把 BEL-151 标 Done；README 的「remote not published」一句按已发布事实修正。

## 6 · 改动纪律

1. 改边界 = 同时改 **本文件 + `scripts/check-boundary.js` + `test/boundary.test.js`**，
   三处不一致就是一张会漂的表。
2. 新增公开端点 = 先有 `contracts/` 条目，再有 mock，再有客户端调用点；实现永远在旁仓。
3. 新增旁仓 = 在 §2 写清 URL、可见性、CODEOWNERS，并更新 `evidence/side-repos.txt`。
