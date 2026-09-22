# 中国版额度的境内中继 —— 方案 C 的部署契约

> **⚠️ 2026-09-22 已撤回。** 用户裁定中国版不依赖东京：额度等整套境内后端（`deploy/china/`）上线、
> 用户迁移之后再开，账本与账号同库。当天按本文部署过的腾讯云函数与 `bt-grant-ledger` 已删除。
> 本文保留，是因为那时中继仍是同一份 `bt-relay` 代码（上游百炼、`CLAIM_PROXY` 不再需要、账本连本机库），
> 下面的打包方式、回读判据与实测数字都还用得上。背景见 `docs/learning-design.md` §8.10.1 开头。

设计在 [`docs/learning-design.md`](../../docs/learning-design.md) §8.10.1。一句话：
**原文只走境内**（客户端 → 这台机器 → 阿里云百炼 · 千问），**账本留在东京**（这台机器只把
令牌 hash 与每次的花费数字发过去，不发原文）。领取也由它代转，所以中国版产物里一个东京的
额度路径都没有 —— `build/china-gate.js` 就按这一条验。

代码**不另写**：跑的就是 `supabase/functions/bt-relay/index.ts` 这同一个文件，只换环境变量。
两份实现会分叉，而分叉的那天没人会发现（那个文件头第 1 条纪律）。

---

## 0. 前置 —— 任何一件没好都不要翻 `grant.china.ready`

| | 判据 | 谁做 |
|---|---|---|
| **运行处** | **首选腾讯云云函数（Web 函数，境内地域如北京 / 上海）**，用平台默认域名 —— 不绑自己的域名就不涉及 ICP 备案（2026-09-22 用户裁定）。备选：一台境内机器（1B） | 你 |
| **默认域名可用** | 部署后在**境内手机网络**下回读 `/spec`（第 2 节 ⑤）。腾讯云对默认域名有过「仅供调试」一类说法，未核实 —— 回读不过就改绑自己的域名，那时才需要备案 | 你 |
| **百炼 key** | 阿里云百炼（北京区）开一把 API key，开余额告警（见第 4 节） | 你 |
| **价格** | 查百炼控制台里所钉模型的实价，填进 `GRANT_PRICES`（见第 1 节）。**不许照抄国际版那组数** | 你 |
| **出境同意已上线** | 带 #399 的中国版 App 已经过审上架 | — |

---

## 1A. 腾讯云云函数（首选）

**地域必须选境内**（北京 / 上海 / 广州…）。选香港或海外，原文就又出境了 —— 合规检查查不到
这一条，因为地址长得都一样。

建一个 **Web 函数**，运行环境选 **Node.js 18 或更新**。代码包用脚本打：

```bash
deploy/china-relay/build-scf.sh        # → deploy/china-relay/.out/bt-relay-scf.zip（约 15 KB）
```

包里四个文件：`relay.mjs`（`deno bundle` 把 `bt-relay/index.ts` 原样转成 JS —— **逻辑还是那一份**）、
`deno-shim.mjs`（在 Node 里补 `Deno.env.get` / `Deno.serve` 两个入口，不含任何中继逻辑）、`main.mjs`、
`scf_bootstrap`（`PORT=9000 node main.mjs`，Web 函数要求监听 `0.0.0.0:9000`）。

**为什么不直接带 Deno 进去**：Linux 版 deno 解压 95 MB，且要 glibc ≥ 2.18，云函数的运行环境未必满足；
Node 18+ 自带 fetch / Request / Response / FormData，缺的只有那两个入口。2026-09-22 本机按这个包
实跑过：`scf_bootstrap` 起在 9000、真实百炼回译文、按 total_tokens 记账、换模型 403、预检放行 apikey。

环境变量填在函数配置里（**不要**写进代码包），与 1B 的 `relay.env` 同一组：`SUPABASE_URL`、
`LEDGER_URL`、`LEDGER_KEY`、`UPSTREAM=dashscope`、`UPSTREAM_KEY`、`CLAIM_PROXY=1`、`GRANT_MODELS`、
`GRANT_PRICES`。超时设 60 秒（整页翻译的长请求）；开「函数 URL / 公网访问」拿到默认地址，
这个地址就是下面的 `R` 和第 3 节的 `relayUrl`。

## 1B. 在自己的机器上跑（备选；绑自己的域名就要 ICP 备案）

```bash
# 拷那一个文件过去；不需要仓库的其它东西
scp supabase/functions/bt-relay/index.ts relay:/opt/bt-relay/index.ts

# /opt/bt-relay/relay.env（权限 600）
SUPABASE_URL=https://cavezcufztzqsohpjmup.supabase.co    # 账本在东京
LEDGER_URL=https://cavezcufztzqsohpjmup.supabase.co/functions/v1/bt-grant-ledger
LEDGER_KEY=<与东京 supabase secret LEDGER_KEY 相同>     # **不放 service_role**，见下
UPSTREAM=dashscope
UPSTREAM_KEY=<百炼 key>
CLAIM_PROXY=1
GRANT_MODELS={"chat":"<见下>"}
GRANT_PRICES={"chatPerKTok":<按实价>,"chatFloor":<按实价>}

deno run --allow-net --allow-env --env-file=/opt/bt-relay/relay.env /opt/bt-relay/index.ts   # 默认监听 8000
```

前面用 Caddy 反代并自动签证书：

```
relay.belliedmonkey.com {
  reverse_proxy 127.0.0.1:8000
}
```

`GRANT_MODELS.chat` **必须与注册表逐字相同** —— 它是 `build/providers.config.js` 里 `qwen`
那一条的中国区 `defaultModel`（`grant` 条目的中国区模型就是从那儿取的，不另写）：

```bash
node -e "const L=require('./build/providers.config.js');console.log(L.find(p=>p.id==='qwen').defaultModel)"
```

**只有翻译这一槽。** 百炼没有与中继同形状的朗读 / 转写接口，`GRANT_MODELS` 里不写
`tts` / `stt`，那两条路径会回具名的 503 `grant_misconfigured`（不是静默 500）。

---

### 为什么中继不拿 service_role（2026-09-22 用户裁定）

service_role 是东京那个库的最高权限。中继只需要「查额度、扣额度」两个动作，所以东京加了一个窄口
`supabase/functions/bt-grant-ledger`：只认一把专用钥匙 `LEDGER_KEY`，只做 `/check` 与 `/charge`，
单次记账 ≤ $0.05、hash 必须是 64 位 hex。这把钥匙泄露的最坏后果是「某个令牌被多记账、提前用完」，
读不到任何内容、加不了额度、碰不到别的表。中继设了 `LEDGER_URL` 就走它，不再直连 RPC。

东京那边设钥匙（值取 `.local/keys.md` 的 `ledger_key`，不回显）：

```bash
SUPABASE_ACCESS_TOKEN=… supabase secrets set --project-ref cavezcufztzqsohpjmup LEDGER_KEY=…
```

## 2. 回读 —— 每一步都要看到结果，不是「命令没报错」

```bash
R=<1A 拿到的默认地址，或 1B 的域名>
curl -s $R/spec                          # ① {"models":{"chat":"<与注册表同名>"},...}
curl -s -X POST $R/claim                 # ② 401 {"error":"session"} —— 代转通了（东京回的）
curl -s -X POST $R/chat/completions -H 'Authorization: Bearer bmg_x' -d '{}'
                                         # ③ 401 {"error":"grant_invalid"} —— 账本查询通了
```

④ 用一个真实账号在中国版里登录、领取、翻一句：东京 `bt_grants.spent_usd`
出现这一次的花费，**且**这台机器的日志里只有 `relay <hash前8位> chat 200 …` 这一行，没有任何原文。

⑤ 从境外访问 `$R` 的延迟无所谓；从境内手机网络访问，`/spec` 要能在 1 秒内回来。

---

## 3. 翻开关

`extension/learn/backend.config.js`：

```js
china: { ready: true, relayUrl: '<同上，https 开头>', vendor: 'dashscope' },
```

然后 `node build.js --flavor china`。构建会：

- 拒绝非 https、拒绝 `*.supabase.co`（那是东京）—— 配错就失败，不静默退回 null；
- 把 `grant` 条目放进中国版注册表（端点在 `relayUrl` 上，模型取 qwen 的中国区默认值）；
- 发射 `MT_GRANT`（`claimUrl = relayUrl + '/claim'`）；
- 过合规门：产物里每一个额度地址都必须在 `relayUrl` 那台主机上，东京的 bt-grant / bt-relay /
  bt-ingest 一条都不许有。

**同版要改的文案**（`growth-spec` §4，文案与功能同版上线）：`belliedmonkey.com/privacy.html`
第 5 节「中国版不提供我们代领的免费额度」要改写成方案 C 的说法（原文只经境内中继到百炼；
账号与花费记在东京）。

---

## 4. 盯池子

OpenRouter 有余额接口，中继每 10 分钟读一次、低于底线就停转发（503「不是你用完了」）。
**百炼没有同形状的读法**，所以境内中继的 `floatOk()` 恒为放行 —— 池子只能靠百炼控制台的
**余额告警**盯。没开告警就上线，等于池子见底那天用户看到的是一串上游报错，而我们不知道。
