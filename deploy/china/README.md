# 中国版境内后端 —— 从空机器到切过去

一台轻量应用服务器跑整套：Postgres + GoTrue + PostgREST + Caddy。
**协议一个字节不变** —— 客户端说的是标准 GoTrue + PostgREST，只换地址。

成本与选型的依据在 [`docs/china-backend-cost.md`](../../docs/china-backend-cost.md)。
为什么现在做：中国版 **App 今天就在打东京**（`extension/learn/backend.config.js` 的
`china` 块开头有完整说明），而 App Store 中国区指向的隐私政策说「绝不上传」。

---

## 0. 三件前置，任何一件没好就不要开始

| | 判据 | 卡住多久 |
|---|---|---|
| **机器** | Lighthouse 入门型 2核2GB（¥35/月，年付 85 折 ≈ 357/年）。**不要买 CVM 的「轻量配置」tab** —— 同价只有一半带宽、流量还要另算 | 即时 |
| **ICP 备案** | `api.belliedmonkey.cn`（或所选域名）备案通过，**接入商就是这台机器所在的云厂商**。已有浙ICP备2026057340号，但子域名可能要单独提交 —— 去核实，不要假设 | **7-20 个工作日，关键路径** |
| **SMTP** | 一条境内可达、能发事务邮件的通道。腾讯云 SES 的文档**没写**个人主体能否创建发信域名 —— 问客服。备选：阿里云邮件推送 / 腾讯企业邮 SMTP | 未知，**先问** |

⚠️ 现状用的是 Gmail SMTP。**境内服务器连 Gmail SMTP 不可靠**，所以这一条必须在切过去
**之前**解决，不能边上线边试 —— 邮箱 OTP 一坏，用户连登录都做不到。

---

## 1. 准备 `.env`

```bash
cd deploy/china
cp gotrue.env.example gotrue.env      # 逐条填，每条注释都写了不配会怎样
cat > .env <<'EOF'
MT_DOMAIN=api.belliedmonkey.cn
POSTGRES_PASSWORD=<openssl rand -base64 32>
AUTHENTICATOR_PASSWORD=<openssl rand -base64 32>
JWT_SECRET=<openssl rand -base64 48>
ANON_KEY=<见第 2 步>
SERVICE_ROLE_KEY=<见第 2 步>
EOF
```

`JWT_SECRET` 要同时填进 `gotrue.env` 的 `GOTRUE_JWT_SECRET` —— **两处必须逐字相同**，
否则登录成功而同步全部 401（两个症状看起来毫无关系）。

## 2. 签两个长期 token

`anon` 与 `service_role` 是用同一个 `JWT_SECRET` 签的普通 JWT，不是什么特殊凭证：

```bash
node -e '
const c=require("crypto"), s=process.argv[1], role=process.argv[2];
const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"});
const p=b({role,iss:"belliedmonkey",aud:"authenticated",
           iat:Math.floor(Date.now()/1e3),exp:Math.floor(Date.now()/1e3)+10*365*86400});
console.log(`${h}.${p}.`+c.createHmac("sha256",s).update(`${h}.${p}`).digest("base64url"));
' "$JWT_SECRET" anon
```

`anon` 那个要填进 `extension/learn/backend.config.js` 的 `china.anonKey`（公开的，
无所谓 —— 每张表都在 RLS 后面，没有 session 的 anon key 读写不到任何东西）。
`service_role` **绝不下发给客户端**，只给删号那个服务。

## 3. 起服务 —— 顺序是硬的

```bash
docker compose up -d db
docker compose up -d auth          # ① 让 GoTrue 跑完自己的 migrations（建 auth schema + auth.users）
docker compose logs -f auth        #    等到看见 migrations 完成再往下

docker compose exec -T db psql -U postgres \
  -v mt.authenticator_password="'$AUTHENTICATOR_PASSWORD'" \
  < auth-compat.sql                # ② 角色 + auth.uid()/auth.role()
docker compose exec -T db psql -U postgres < ../../supabase/schema.sql   # ③ 原样，一个字节不改

docker compose up -d               # ④ 其余
```

**反过来跑会失败，且失败信息指向的是症状不是原因**：`schema.sql` 的每条 RLS 都用
`auth.uid()`，而那个函数**不是 GoTrue 的东西，是 Supabase 平台预置的** —— 自建时要
`auth-compat.sql` 补出来。`auth-compat.sql` 末尾有回读断言，别拿「没报错」当成功。

## 4. 五条真实链路，逐条跑通

这五条是客户端**已经在依赖**的行为。没跑通就不要翻 `china.ready`。

| # | 链路 | 怎么验 | 不通的样子 |
|---|---|---|---|
| 1 | 邮箱 OTP | `POST /auth/v1/otp {email,create_user:true}` → 收到**6 位数字**（不是链接） → `POST /auth/v1/verify` 拿到 session | 收到 8 位 ⇒ `GOTRUE_MAILER_OTP_LENGTH` 没配；收到链接 ⇒ 两个模板只改了一个 |
| 2 | Apple 登录 | 真机 App 走一次 Sign in with Apple（`POST /auth/v1/token?grant_type=id_token`） | 服务器出不了网到 `appleid.apple.com` 取 JWKS |
| 3 | push | `POST /rest/v1/bt_chunks`，body 的 `blob` 是 `\x…` hex | bytea 表示不对 ⇒ 语料上下行全坏 |
| 4 | pull + 配额 | `GET /rest/v1/bt_chunks?...&seq=gt.0`；再灌到超 50MB，看错误 JSON 的 `code` 是不是 `53100` | PostgREST 没把 PG error code 透传 ⇒ 超配额时报错不具名 |
| 5 | 删号 | `POST /functions/v1/bt-delete-account` | `SUPABASE_URL` 指错（必须是 `http://proxy:8081`，不是 `auth:9999`） |

还要验一条**不是单点而是时间**的：**放置一小时以上再操作**，确认 access token 过期后
能自动刷新。`GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL` 为 0 会让用户被**随机登出**
—— 那种「偶尔发生、复现不了」的故障，一次性验掉比事后查便宜得多。

## 5. 切过去

改 `extension/learn/backend.config.js` 的 `china` 块：

```js
china: {
  ready: true,
  url: 'https://api.belliedmonkey.cn',
  anonKey: '<第 2 步签的 anon>',
},
```

```bash
npm test                       # 门禁会检查：url 不是 *.supabase.co、两 flavor 的 url/anonKey 不同
node build.js --flavor china   # 回读：url 换了、MT_SYNC_ENABLED = true（不再是 false）
```

`ready` 为假时构建行为与从前**逐字相同**（关掉中国版扩展的同步），所以这个文件可以先
落地、门禁先守着，机器就绪那天只改三个值。

⚠️ **切过去之前必须决定的一件事**：中国版 App 已有用户的语料在东京。切到境内后端后
那部分数据不会跟过来，在新后端里看起来像「消失了」。要么迁移，要么在隐私政策与
版本说明里说清楚 —— **不能默默切**。

## 6. 备份与恢复演练

`docs/china-backend-cost.md` §8 说得直白：运维那一栏没有数字，但它是这个方案真正的价格。
单台机器没有冗余。

```bash
# 备份（放进 crontab，每天一次）
docker compose exec -T db pg_dump -U postgres -Fc postgres > backup-$(date +%F).dump
```

**至少每季度做一次恢复演练** —— 在一台临时实例上把 dump 恢复出来、起服务、跑通第 4 节
的第 1 和第 3 条。判据是**恢复出来的库能登录能同步**，不是「备份文件存在」。
备份存在 ≠ 能恢复，这两件事之间隔着的正是这次演练。
