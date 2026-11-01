# OSS release lane（OpenCode B′ · P0）

- **Status:** P0 lane definition (BEL-172). This document defines how an OSS tag is cut; it
  is **not** an announcement that the project is MIT-licensed today.
- **P1 entry (2026-11-01):** the stranger path is
  [`docs/oss-quickstart.md`](oss-quickstart.md); own-key and local-model guides are
  [`docs/byok.md`](byok.md) and [`docs/local-model.md`](local-model.md). Those docs describe
  the orphan tip; they do not change the tag rules below.
- **Applies to:** the public MIT orphan root (`oss/mit-orphan`) and any `oss/**` tag.
- **Does not apply to:** store submission, App Store Connect, marketing copy.

## 0 · 一句话

**OSS tag ≠ 商店 tip。** 开源 tag 永远从 **orphan MIT 根**切，禁止从带未 scrub 材料的商店 tip
直接打 tag；商店轨的防丢闸（BEL-123～126）在这一拍**不撤、不弱化**。

## 1 · 两条轨

| 轨 | 分支 / tag | 内容 | 许可 |
|---|---|---|---|
| 商店 tip | `main`、`release/**` | 实际提交 App Store / CWS / AMO 的树 | 本分支 **GPL-3.0-or-later**（until the orphan root is adopted） |
| OSS release | `oss/mit-orphan`、`oss-v*` tag | 公开源码、契约、mock、文档 | **MIT**（orphan root，无 GPL history） |

规则：

1. `oss/**` **不得** merge `main` / `release/**` 的未 scrub tip。要同步一个修复，先在
   `oss/**` 上重做（或 cherry-pick **scrub 后**的提交），再走下面 §3 的检查。
2. `main` / `release/**` 也不得 merge `oss/**` 的 MIT 牌面到未 orphan 的树 —— 那会把
   GPL 与 MIT 混在一份 history 里，正是「半洗」。
3. 商店 tip 的提交/验收仍按 `docs/release-checklist.md`；BEL-123（tip 用户可见 diff）、
   BEL-124（submit QD 模板）、BEL-125（主干先行）、BEL-126（大合入 checklist）对商店轨
   **继续硬闸**。本文件不放宽任何一条。

## 2 · 切 OSS tag

```bash
# 1) orphan root 必须只有一个 root commit，且没有 GPL 祖先
git log --max-parents=0 oss/mit-orphan          # exactly one line
git merge-base --is-ancestor <gpl-main-tip> oss/mit-orphan && echo BAD || echo ok

# 2) 边界 + 秘密（必须绿）
npm run boundary
node scripts/check-boundary.js
gitleaks dir . --no-banner --redact -c .gitleaks.toml --exit-code 1

# 3) 构建（注入真实后端值只在本机/CI secret；仓库里永远是占位）
npm test
node build.js
node build.js --flavor china
node build.js firefox

# 4) tag 指向 orphan tip，不指向 main
git tag -a oss-v<version> -m "OSS release <version> (MIT orphan root)" <orphan-tip>
git push origin oss-v<version>
```

**判据是回读，不是命令退出码**：tag 解引用后必须是 orphan 根的后代；`git log` 里不得出现
GPL 时代的提交；`git show oss-v<version>:LICENSE` 必须是 MIT 全文。

## 3 · 每次 OSS 发版必查

| # | 检查 | 判据 |
|---|---|---|
| 1 | 无旁仓引用 | `npm run boundary` 绿；公仓构建不需要 `*-hosted` / `*-compliance` 的源码 |
| 2 | 无闭源符号 | 公仓无 `supabase/functions/bt-relay|bt-grant*|bt-ingest` 实现；契约 + mock 在 `contracts/` / `mocks/` |
| 3 | secret scan | `gitleaks dir . -c .gitleaks.toml` 零发现；history 只有 orphan 根（无 GPL history） |
| 4 | anon 仅注入 | `extension/learn/backend.config.js` 只有 `*.invalid` 占位；真实值来自 `MT_BACKEND_*` / `.local/backend.env` |
| 5 | 无 service_role / 上游 Key | 构建拒绝 `role=service_role` 的 JWT；relay mock 拒绝 BYOK key 回显 |
| 6 | 遥测 | 开源构建默认 **off / 显式同意**（O8；P1 落地，P0 只钉方向） |
| 7 | 文档 | README 的 mcp-remote 叙述与已发布事实一致；本文件 + `BOUNDARY.md` 在树 |
| 8 | 公告闸 | README badge / 营销文案**不写**「已 MIT 开源」，直到产品另行认关 |

## 4 · 后端注入（构建，不是提交）

```bash
# 本机（gitignored）：
cat > .local/backend.env <<'EOF'
MT_BACKEND_URL=https://<intl-host>
MT_BACKEND_ANON_KEY=<publishable anon key>
MT_CHINA_BACKEND_URL=https://<china-host>
MT_CHINA_BACKEND_ANON_KEY=<publishable anon key>
MT_CHINA_RELAY_URL=https://<china-relay-host>
EOF

# 或 CI secret → 同名环境变量
node build.js
```

- 没有注入时构建仍成功，但产物指向 `*.invalid`，`build.js` 会打黄字。这是有意的：
  一个没有 secret 的 OSS 构建**不应该**悄悄连到生产后端。
- `build/backend-inject.js` 拒绝 `service_role` JWT、非 https、以及两个 flavor 共用同一后端。
- **CI 只打 mock**：`mocks/hosted-gateway/`（`npm run mock:hosted-gateway`）。真 grant 密钥
  永不进 CI。

## 5 · flavor / 商店 tip

- 同仓 `build.js --flavor china` → `dist-china/` 继续保留；intl → `dist/`。
- 公仓可留：默认域名占位、文案、provider 过滤表、`china.ready` / `grant.china.ready` 的
  **布尔语义**。
- 须在 compliance 私仓：区域能力开关**实现细节**、备案/填报私流程、审计留存。
- **禁**以「开源准备」名义改 ASC / 盲合商店 tip；**禁**把 CN flavor 的备案私货带进公仓。

## 6 · mcp-remote 与推理网关

- 推理网关（旧 `bt-relay`）→ hosted 私仓；公仓只有 `contracts/` + `mocks/`。
- `belliedmonkey-mcp-remote` 是独立的已部署远程 MCP（连接/OAuth/工具面），**不是**推理网关。
- 额度计量/托管上游调用若存在 → hosted 或经 CONTRACT-v0；**禁**借开源叙事宣称「无托管云」，
  也**禁**把 BEL-151 标 Done。

## 7 · P1 落地（2026-11-01）

- 陌生人路径、BYOK、本地模型、三端构建文档已落在
  [`docs/oss-quickstart.md`](oss-quickstart.md) / [`docs/byok.md`](byok.md) /
  [`docs/local-model.md`](local-model.md)；验收证据在 QA OUT，不改变本文件的 tag 规则。
- 订阅/云同步（P2）仍由增长令负责；公仓只消费 `contracts/` + `mocks/`，不落服务端实现。
- 遥测默认 off 的代码实现、任何 `Done` 状态变更（BEL-171～175 / BEL-151…）不在本文件授权内。

P0 出口以 `docs/architecture-p0/P0-SPLIT-opencode-b-prime-2026-11-01.md` §6 的 **E1–E7** 为准。
