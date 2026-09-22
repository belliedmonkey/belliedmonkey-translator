# 中国版额度的境内中继 —— 方案 C 的部署契约

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
| **机器** | 一台境内机器能跑 Deno ≥ 1.40。原来那台 Lighthouse（北京，`lhins-6amaoj8m`）如果还在，可以直接用 | 你 |
| **域名 + ICP** | 例如 `relay.belliedmonkey.com`。`belliedmonkey.com` 已有浙ICP备2026057340号，但**子域名的接入是否要单独报**要去核实，不要假设；解析到这台机器的云厂商必须就是备案的接入商 | 你 |
| **百炼 key** | 阿里云百炼（北京区）开一把 API key，开余额告警（见第 4 节） | 你 |
| **价格** | 查百炼控制台里所钉模型的实价，填进 `GRANT_PRICES`（见第 1 节）。**不许照抄国际版那组数** | 你 |
| **出境同意已上线** | 带 #399 的中国版 App 已经过审上架 | — |

---

## 1. 在机器上跑

```bash
# 拷那一个文件过去；不需要仓库的其它东西
scp supabase/functions/bt-relay/index.ts relay:/opt/bt-relay/index.ts

# /opt/bt-relay/relay.env（权限 600）
SUPABASE_URL=https://cavezcufztzqsohpjmup.supabase.co    # 账本在东京
SUPABASE_SERVICE_ROLE_KEY=<东京项目的 service_role key>
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

## 2. 回读 —— 每一步都要看到结果，不是「命令没报错」

```bash
R=https://relay.belliedmonkey.com
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
china: { ready: true, relayUrl: 'https://relay.belliedmonkey.com', vendor: 'dashscope' },
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
