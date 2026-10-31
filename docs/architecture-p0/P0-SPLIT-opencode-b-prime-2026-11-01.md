# P0 · 拆仓图 + BOUNDARY（OpenCode B′）

- **ID：** `P0-SPLIT-opencode-b-prime`
- **时间：** 2026-11-01 ~06:17 Asia/Shanghai
- **触发：** 用户认关 PASS-WITH-ACCEPT；**O1=A**；产品令补拆仓图/契约 v0；跟踪 [BEL-172](https://linear.app/belliedmonkey/issue/BEL-172) / [BEL-175](https://linear.app/belliedmonkey/issue/BEL-175)
- **范围：** **仅 P0**（scrub + relicensing + 旁仓切分）；**禁越界 P1/P2**（公开文档跑通 BYOK、订阅同拍验另令）
- **底座：** `ARCH-SHORT-opencode-b-prime-oss-commerce-2026-11-01.md` · `opencode-b-prime-facts-2026-11-01.md`
- **本文件 ≠ 落码完成证明**；研发按本图迁/建仓后交形检

镜像：`/workspace/arch/P0-SPLIT-opencode-b-prime-2026-11-01.md`

---

## 0 · O1=A 钉死（用户已选）

| 项 | 钉 |
|---|---|
| 路径 | **A**：贡献者书面同意 relicensing **或** 可证明全部可再许可代码 → **新 orphan 根以 MIT 发布** |
| 旧仓 | 现 `belliedmonkey-translator`（GPL tip）归档只读或保留商店 tip 轨；**OSS 公 tip 不得从半洗 history 直接改牌** |
| NOTICE | 第三方依赖保留原证；根 `NOTICE` 齐 |
| 禁 | 不征同意就改 LICENSE 写 MIT；半洗后仍带 GPL-only 依赖却宣称纯 MIT |

P0 出口须附：同意书/证明索引（路径级，不含隐私正文）+ orphan tip SHA + LICENSE=MIT + NOTICE。

---

## 1 · 目标拓扑（最小集）

```text
┌─────────────────────────────────────────────────────────────┐
│  PUBLIC · MIT orphan（单仓多产物，保留现布局）                 │
│  建议名：belliedmonkey-translator（orphan 重建）或 *-oss     │
│  App / extension / agent(stdio) / build flavor 公开配方       │
│  + docs(tip闸/oss-release) + contracts/ + mocks/              │
│  + telemetry 空桩（默认 off）                                  │
└───────────────┬─────────────────────────────▲───────────────┘
                │ HTTP 契约（见 CONTRACT-v0）   │ mock / stub only
                ▼                              │
┌──────────────────────────┐    ┌─────────────────────────────┐
│  PRIVATE · *-hosted      │    │  PRIVATE · *-compliance     │
│  bt-relay / bt-grant*    │    │  china-gate 实现细节         │
│  ledger / 配额 / 云同步   │    │  备案包 / 商店填报私流程      │
│  上游供应商 Key / 运营    │    │  区域开关私实现              │
│  bt-ingest 真管道（可选） │    │  （公开只留开关名+默认端点表）│
└──────────────────────────┘    └─────────────────────────────┘

已有（不动本拍职责，仅链）：
  · 站点私仓 belliedmonkey-cc / -com / blog
  · 公仓 belliedmonkey-mcp-remote（MCP 连接/OAuth 壳；计量/托管上游若有 → hosted）
```

**不必**为 App/扩展再拆三公仓。旁仓只收闭源面。

**等价方案（可接受）：** 单私仓两目录 `hosted/` + `compliance/` + 严格 CODEOWNERS + 永不 push 公远程。

---

## 2 · BOUNDARY.md 草案（公仓落地稿）

研发落 orphan 时把本节落成仓根 `BOUNDARY.md`；CI path-deny 按 denylist 红灯。

### 2.1 公仓 allowlist（可留 / 须 scrub 后留）

| 路径模式 | 说明 |
|---|---|
| `app/` `src/app/` | 宿主 App 壳与共享 UI |
| `extension/` `src/{content,pages,shared,store,lib}` | 扩展壳；**密钥改为 build 注入** |
| `agent/`（stdio / 本地协议 / BYOK credentials 槽） | **禁**内嵌上游供应商 Key；grant 客户端只调契约 |
| `build.js` `build/*.config.js` | flavor 公开配方；china-gate **公开开关语义**可留，**私实现迁 compliance** |
| `docs/`（含 tip 防丢闸、将新增 `oss-release.md`） | 商店 tip ≠ OSS tag |
| `scripts/tip-*.sh` 等防丢闸脚本 | 可开；含内网 URL 的 runbook → 旁仓 |
| `contracts/` `mocks/`（新建） | OpenAPI/契约 + CI mock；**无真钥** |
| `test/`（公仓可构建子集） | 集成测打 mock，不打真 grant |
| `LICENSE` `NOTICE` `README` | MIT + 诚实 mcp-remote 叙述 |

### 2.2 公仓 denylist（P0 必须迁出或删除出 orphan tip）

| 路径模式 | 迁往 |
|---|---|
| `supabase/functions/bt-relay` | hosted |
| `supabase/functions/bt-grant*` `bt-grant-ledger` | hosted |
| `supabase/functions/bt-models`（若含上游 key 池/计量） | hosted |
| `supabase/functions/bt-ingest`（真管道） | hosted；公仓留空桩 |
| `supabase/functions/bt-delete-account`（账号侧） | hosted |
| `deploy/china-relay`（打包公网中继跑 SCF） | hosted |
| `build/china-gate.js` **实现细节** / 备案私流程 | compliance（公仓可留布尔语义说明） |
| `extension/learn/backend.config.js` 内硬编码 anonKey/host | **删硬编码**；build 时注入；公仓仅占位 |
| `.mcp.json` 真 project_ref | 示例占位或移出 tip |
| 含内网 URL / 运维密钥的 deploy runbook | hosted 或合规旁仓 |
| 任何 `service_role` / `GRANT_KEK` / Apple 共享密钥 / 上游 API Key 真值 | **永不入公 tip**（含 history → orphan） |

### 2.3 CI path-deny（出口验）

- PR / tip 若触及 denylist 路径 → **FAIL**
- secret lint（gitleaks/trufflehog 类）高危 → **FAIL**
- 禁 `import` / submodule 指向旁仓源码进公构建

---

## 3 · 迁移清单（P0 可构建顺序）

1. **收齐 O1=A 证明**（书面同意或可再许可证明）→ 冻结贡献者名单索引  
2. **建旁仓** `*-hosted` + `*-compliance`（或单私仓两目录）  
3. **迁 denylist 实现**到旁仓；旁仓可独立构建/部署（不依赖公 tip 源码倒灌）  
4. **公仓 orphan 根**：仅 allowlist；LICENSE=MIT；NOTICE；BOUNDARY.md；contracts+mocks  
5. **scrub**：backend.config 改注入；`.mcp.json` 占位；secret scan 零高危；曾泄密则轮转证明  
6. **文案**：README 对齐 mcp-remote 已发布事实；声明商店 tip 轨与 OSS tag 分轨  
7. **文档**：`docs/oss-release.md`（OSS tag 禁合未 scrub 商店 tip；防丢闸对商店轨仍硬闸）  
8. **出口包**：本拆仓图勾选 + CONTRACT-v0 mock 绿 + secret 报告（路径级）→ 交架构形检 → 产品认 P0 出口（**仍禁 P1/P2 落码至另令**）

---

## 4 · flavor / tip 分轨（O5，P0 文档钉）

| 轨 | 钉 |
|---|---|
| 构建 | 同仓保留 `build.js --flavor china` → `dist-china/`；intl → `dist/` |
| 公仓可留 | 默认域名、文案、provider 过滤表、`china.ready` / `grant.china.ready` **布尔语义** |
| 须迁 compliance | 区域能力开关**实现细节**、备案/填报私流程 |
| OSS vs 商店 | **OSS release tag ≠ 商店 tip**；开源准备 **禁**盲合 ASC / 未 scrub tip |
| 防丢闸 | BEL-123～126 文档+脚本保留；对**商店轨**继续硬闸 |
| 遥测 | 叠 BEL-135 china≡intl 白名单；开源默认 **off / 显式同意**（O8） |

---

## 5 · mcp-remote（O7，边界一句）

- **推理网关（bt-relay）≠ MCP Remote（连接/OAuth/工具面）**  
- 推理网关 → hosted；mcp-remote 协议壳可留公；**额度计量/托管上游调用** → hosted 或经 CONTRACT-v0  
- **禁**借本拍 Done BEL-151  

---

## 6 · P0 出口检查表（架构形检用）

| # | 检查 | PASS 条件 |
|---|---|---|
| E1 | O1=A | orphan MIT tip + 同意/证明索引 + NOTICE |
| E2 | 旁仓 | hosted + compliance 可构建；公仓无 denylist 源码 |
| E3 | BOUNDARY + CI deny | 文件在仓；触 denylist 红灯 |
| E4 | scrub | secret scan 零高危；无 service_role/上游 Key；anon 仅注入 |
| E5 | 契约 | CONTRACT-v0 + mock CI 绿；客户端不直连旁仓源码 |
| E6 | 文案 | README mcp-remote 诚实；oss-release 分轨写明 |
| E7 | 禁越界 | 无 P1「陌生人 BYOK 跑通」宣称、无 P2 订阅同拍宣称；相关 BEL 勿 Done |

---

## 7 · 回研发 / 产品要点

1. **O1=A**：orphan MIT，禁半洗改牌。  
2. **单 MIT 公仓** + **hosted / compliance 两旁仓**（或等价）；bt-relay 等 denylist 必须迁出。  
3. 契约见 `CONTRACT-v0-hosted-gateway-2026-11-01.md`；公仓只留契约+mock。  
4. **本拍禁 P1/P2**；形检前勿宣称「已按 OpenCode MIT 开源」。  
5. 跟踪 BEL-172（执行）/ BEL-175（短核台账）；**勿 Done** 至 P0 出口产品认。

证：本文件 + CONTRACT-v0 + ARCH-SHORT + facts。
