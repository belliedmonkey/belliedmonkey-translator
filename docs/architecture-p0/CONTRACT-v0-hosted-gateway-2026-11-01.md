# CONTRACT-v0 · 托管网关 / Grant（OpenCode B′ · P0）

- **ID：** `CONTRACT-v0-hosted-gateway`
- **时间：** 2026-11-01 ~06:17 Asia/Shanghai
- **用途：** P0 公仓只留**契约 + mock**；实现迁 `*-hosted`。供客户端与 CI 对齐，**非** P1/P2 产品完整 OpenAPI。
- **跟踪：** [BEL-172](https://linear.app/belliedmonkey/issue/BEL-172) · [BEL-175](https://linear.app/belliedmonkey/issue/BEL-175)
- **叠钉：** O2/O6 · t291u（宿主 BYOK）· 禁上游 Key 回显

镜像：`/workspace/arch/CONTRACT-v0-hosted-gateway-2026-11-01.md`

---

## 0 · 安全公理（不可破）

1. **BYOK 默认不经托管网关**：用户供应商 Key 仅本机（`chrome.storage.local` / local-keys / agent credentials）；请求直连供应商。  
2. **托管路径**客户端只持 **用户会话 JWT / grant token**；**上游供应商 Key 只在 hosted**。  
3. **托管响应不得回显**上游 Key、service_role、GRANT_KEK、原始供应商错误体中的密钥材料。  
4. **禁强制改道**：产品「额度用尽可回落 BYOK」时，客户端切换本地 BYOK，**服务端不得**把已声明 BYOK 的请求劫持进托管。  
5. **公仓集成测试**只打 `mocks/`；禁真 grant 密钥进 CI。

---

## 1 · 角色与基址

| 角色 | 说明 | 公仓可见 |
|---|---|---|
| Client | App / 扩展 / agent | 源码开 |
| Hosted Gateway | 现 `bt-relay` 等迁入旁仓后的实现 | **闭**；仅本契约 |
| Grant / Ledger | 额度发放、扣减、账本 | **闭** |
| Mock Server | 本契约的本地/CI 实现 | **开**（`mocks/`） |

**基址（逻辑名，值由 flavor / build 注入，禁硬编码入 orphan tip）：**

| 逻辑名 | intl 典型 | china 典型 |
|---|---|---|
| `HOSTED_RELAY_BASE` | 注入（原 supabase functions 面） | `api.belliedmonkey.com` 中继面 |
| `GRANT_BASE` | 与 relay 同域或并列 path | 同左；受 `grant.china.ready` |
| `AUTH_ISSUER` | GoTrue / 现有 IdP | 境内同 issuer 门（叠 BEL-151 已认短核，本约不重开） |

P0：**占位符 + mock**；真 URL 仅旁仓配方 / CI secret。

---

## 2 · 鉴权

| 项 | 钉 |
|---|---|
| 托管 API | `Authorization: Bearer <user_access_jwt>`（或现网等价会话头）；校验 iss/aud/exp；失败 → `401` |
| Grant 操作 | 同上；另可绑 device / app attestation（细节旁仓；契约只要求「未授权不可扣额度」） |
| BYOK | **无**托管 Bearer；本地直连供应商 |
| 错码 | `401` 未授权 · `403` 禁止（含区域/风控）· `429` 配额 · `5xx` 上游/网关故障（**无密钥**） |

---

## 3 · 端点草案（v0 · 稳定语义，path 可映射现网）

> 现网 path（`bt-relay` / `bt-grant*`）可继续用，但**实现离公仓**。下列为语义契约；orphan 内 `contracts/hosted-gateway.v0.yaml` 落地时允许 alias。

### 3.1 `POST {HOSTED_RELAY_BASE}/v0/relay`

**用途：** 订阅/额度用户的托管推理转发（非 BYOK）。

**请求（示意）：**

```json
{
  "model": "string",
  "input": {},
  "stream": false,
  "client": { "app": "extension|app|agent", "build": "semver", "flavor": "global|china" }
}
```

**响应：** 供应商兼容或统一 envelope；**不得**含 `upstream_api_key` / 原始密钥头。  
**错误：** `402`/`429` 额度不足（客户端可提示改 BYOK 或订阅——UI 属 P1/P2）。  
**禁：** 请求体携带用户 BYOK 供应商 Key（若误带 → `400` 并丢弃，不转发）。

### 3.2 `GET {GRANT_BASE}/v0/grant/balance`

**响应示意：**

```json
{
  "remaining": 0,
  "unit": "tokens|requests",
  "resets_at": "ISO-8601|null",
  "product": "free|monthly|yearly|unknown"
}
```

### 3.3 `POST {GRANT_BASE}/v0/grant/consume`（若与 relay 分拆）

原子扣减；幂等键 `Idempotency-Key` 必填。失败不泄漏账本内部 id 以外的密钥。

### 3.4 `GET {HOSTED_RELAY_BASE}/v0/models`（可选）

**仅**返回用户 entitlement 可见模型列表；**禁**返回上游账号或 key 池元数据。

### 3.5 账号删除 / 云同步

`bt-delete-account`、云同步服务端 → **hosted**；P0 契约只要求：公仓客户端保留 **调用点 + mock**，不保留服务端实现。详细 schema **P2 另增 minor**；本 v0 标 `reserved`。

### 3.6 遥测 ingest

真管道 hosted；公仓 **空桩 / 默认 off**。事件名可公开白名单（叠 BEL-135）；write key **不进**公仓。

---

## 4 · 双路径状态机（客户端须遵守）

```text
                    ┌──────────────┐
                    │ 选路 UI/配置  │
                    └──────┬───────┘
           BYOK            │           托管/订阅
            │              │              │
            ▼              │              ▼
   本地直连供应商          │     Bearer → relay/grant
   （不经 HOSTED_*）       │     上游 Key 仅 hosted
            │              │              │
            └──── 额度尽 ──┴── 可回落 BYOK（产品钉）
```

| 状态 | 网络 | 密钥 |
|---|---|---|
| `mode=byok` | 供应商 endpoint | 本机 Key |
| `mode=hosted` | `HOSTED_*` | 用户 JWT + 服务端上游 Key |
| 切换 | 客户端本地完成 | 禁服务端静默改 mode |

---

## 5 · 公仓落地物（P0）

| 路径 | 内容 |
|---|---|
| `contracts/hosted-gateway.v0.yaml`（或 `.json`） | 本文件端点/schema 机读版 |
| `mocks/hosted-gateway/` | 静态/轻服务：balance 固定值、relay echo **无密钥**、401/429 样例 |
| `docs/oss-release.md` 一节 | 「CI 只打 mock；旁仓配方注入基址」 |
| 客户端配置 | `MT_*` / backend 由 **build 注入**；orphan tip **无**真 anon JWT |

---

## 6 · 版本与兼容

| 规则 | 钉 |
|---|---|
| v0 | P0 出口用；允许 path alias 映射旧 `bt-*` |
| 破坏性变更 | 另起 `v1`；旁仓与公仓契约同步发 |
| 禁 | 公仓为「方便」重新打入 relay 实现「临时」 |

---

## 7 · P0 验收（对照拆仓图 E5）

- [ ] 公 tip **无** `supabase/functions/bt-relay` 等 denylist 实现  
- [ ] `contracts/` + `mocks/` 可本地跑通 balance + relay 401/200 样例  
- [ ] 客户端配置路径无硬编码真 anonKey（占位或注入槽）  
- [ ] 威胁模型段落进 README 或 `BOUNDARY.md`（引用本契约 §0）  
- [ ] **未**宣称 P1 陌生人 BYOK 跑通 / P2 订阅同拍完成  

证：本文件 + `P0-SPLIT-opencode-b-prime-2026-11-01.md`。
