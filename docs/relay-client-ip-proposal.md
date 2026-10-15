# 托管边缘函数的客户端 IP 该读哪个头 — 提案

日期：2026-10-15。issue [#592](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592)。

这一份只提案。不改代码，不部署，不推送，不对线上发请求，不再发探针。下面每条第三方结论都先写页面、链接、适用范围和读取日期。文档没写的标 **待确认**。

已完成的验证读数在 [issuecomment-6188976386](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592#issuecomment-6188976386)。那次只回答头的有无和格式。本提案用它作背景，不用它代替官方文档。

## 1. 两处宿主不要合成一件事

`isChina` 对空字符串返回 false，当作非中国（`supabase/functions/bt-models/china-ip.ts`，2026-10-15，第 38–40 行）。两个调用方都把 `x-real-ip` 传进去，宿主不同：

| 调用方 | 跑在哪 | 谁写这个头 |
|---|---|---|
| `bt-relay` 的 `useQc` 分支（`supabase/functions/bt-relay/index.ts` 第 340–341 行） | 托管 Supabase Edge Function | Supabase 文档没有写函数 `Request` 上有 `X-Real-IP`。验证实验里三次都是 `absent`，包括客户端自己送了这个头的那次 |
| `bt-models`（`supabase/functions/bt-models/index.ts` 第 53–54 行） | 中国机上的 Deno 容器，前面是 Caddy。`deploy/china/Caddyfile` 第 109–112 行：`header_up X-Real-IP {http.request.remote.host}` | 仓库里的 Caddy 指令把远端地址写进 `X-Real-IP`。这次验证没有打到这条路径 |

因此「读不到就当非中国，等于所有用户都被当成非中国」说的是**托管上的 `bt-relay`**，在 `UPSTREAM=qwencloud` 且该令牌走 QwenCloud 时。`bt-models` 不在这次 `functions list` 的托管函数里。本提案不建议改它的读头。

`qcIsChina` 只在 `useQc` 里计算。开关关闭、或令牌不在 `QWENCLOUD_ALLOW_TOKEN_HASHES` 里时，不读 IP，走旧路径。见 `docs/relay-qwencloud-rollout.md` 第 4 节。

## 2. 依据表

读取日期都是 2026-10-15。

| 页面 | 链接 | 适用范围 | 原文在说什么 | 没说什么 |
|---|---|---|---|---|
| CAPTCHA support with Cloudflare Turnstile | https://supabase.com/docs/guides/functions/examples/cloudflare-turnstile | 一个 Edge Function 示例。取出的地址交给 Turnstile 的 `remoteip` | `req.headers.get('x-forwarded-for')`，按逗号拆开，用第一段 `clientIps[0]` | 不提 `X-Real-IP`，不提 `cf-connecting-ip`。不说平台写入这个头，不说客户端能不能伪造，不说第一段为什么是客户端 |
| Logging（Edge Functions） | https://supabase.com/docs/guides/functions/logging | 怎么把函数收到的头打进日志。示例是 `Object.fromEntries(req.headers)` 的「something like」 | 示例里有 `cdn-loop`（值含 `cloudflare`）、`cf-ew-via`、`cf-ray`、`cf-visitor`、`cf-worker`（值是 `supabase.co`） | 示例里没有 `cf-connecting-ip`、`x-forwarded-for`、`x-real-ip`。示例不是字段合同，不能当成「这些头一定没有」 |
| Logging（平台日志） | https://supabase.com/docs/guides/monitoring-and-debugging/logs | 标题下的「Working with API logs」 | 「API logs run through the Cloudflare edge servers」。API 日志允许记录的请求头包括 `cf-connecting-ip`、`cf-ipcountry`、`x-real-ip`。同段写：没列进日志的头仍会到达 server(s) 和 client(s) | 这一节是 API 日志，不是函数 `Request` 的字段表。Edge Functions 那一小节只说 Invocations 显示函数调用的 edge logs，没有写该读哪个头 |
| Log sources and fields | https://supabase.com/docs/guides/observability/log-field-reference | `edge_logs` 是 API 网关（含 REST、GraphQL）。`function_edge_logs` 是一次 Edge Function 调用 | 「API Gateway logs capture only the headers below. Other headers still reach the application and client but are omitted from these logs.」网关捕获列表含 `cf-connecting-ip`、`x-real-ip`。`function_edge_logs` 的请求头字段只有 `accept`、`content-length`、`host`、`user-agent` | 「仍会到达应用」说的是 API 网关日志的省略，不是「函数 `Request` 上有 `x-real-ip`」。函数日志字段表里没有 `cf-connecting-ip`，也不说明函数代码读不到它 |
| Discovering and Interpreting API Errors in the Logs | https://supabase.com/docs/guides/troubleshooting/discovering-and-interpreting-api-errors-in-the-logs-7xREI9 | `edge_logs`，示例过滤 `/auth/v1/` | `request.headers.cf_connecting_ip` 的说明是请求方 IP | 不是函数 `Request`。不拿来选头 |
| Cloudflare HTTP headers | https://developers.cloudflare.com/fundamentals/reference/http-headers/ | 页面日期 Last updated Oct 9, 2026。Cloudflare 边缘到**源站**的请求头 | 见第 3、4 节引用 | 不提 Supabase，不提 Edge Function |
| Request Header Transform Rules | https://developers.cloudflare.com/rules/transform/request-header-modification/ | 页面日期 Last updated Sep 4, 2026。Cloudflare 客户的 Transform Rules，改发往源站的请求头 | 见第 3 节。客户规则不能改 `cf-connecting-ip` 的值（只能删），不能改 `x-forwarded-for` / `x-real-ip` / `true-client-ip` 的值 | 这是客户规则的限制，不是「每个客户端在进入 Cloudflare 之前写的头都会被丢掉」的完整清单。Worker 子请求另有规则 |

Supabase 文档里，函数代码被拿来当客户端 IP 的头只有 Turnstile 示例的 `x-forwarded-for` 第一段。没有任何 Supabase 页面写：托管函数的 `Request` 上，客户端 IP 由平台写入某一个头，且客户端不能伪造。

## 3. 四个问题

### 3.1 Supabase 对边缘函数里客户端 IP 的说法

该读哪个头：唯一出现在函数代码里的是 `x-forwarded-for` 的第一段（Turnstile 示例）。该页没有把它写成平台保证。

是否由平台写入、客户端能否伪造：这两句 Supabase 的函数文档都没有写。**待确认。**

日志页能确认的只有：API 日志经过 Cloudflare 边缘；函数日志示例里出现过若干 `cf-*` 头。示例里的 `cf-worker` 在 Cloudflare 的定义里是加在 Worker 子请求上的（HTTP headers 页的 CF-Worker：「added to an edge Worker subrequest」）。那是示例，不是「每个托管函数请求都是 Worker 子请求」的合同。函数请求属于下面哪一种，Supabase 没写，**待确认**：

- Cloudflare 到源站、且没有 Worker 子请求
- 同区 Worker 子请求
- 跨区 Worker 子请求
- Supabase 在 Cloudflare 之后又改过一次头

### 3.2 `cf-connecting-ip`

Cloudflare HTTP headers（源站方向）：

- `CF-Connecting-IP` 把连到 Cloudflare 的客户端 IP 提供给源站。这个头只出现在 Cloudflare 边缘发往源站的流量上。
- 没有 Worker 子请求时：`cf-connecting-ip` 是客户端 IP，并且 `x-real-ip` 被去掉。
- 同区 Worker 子请求：`CF-Connecting-IP` 反映 `x-real-ip`，而 `x-real-ip` 可以被该 Worker 脚本改掉。
- 跨区子请求：`CF-Connecting-IP` 被设成 Worker 的客户端地址 `2a06:98c0:3600::103`。Transform Rules 页对跨区子请求写了：Cloudflare 无条件换成内部地址，to prevent IP spoofing。
- 发往非 Cloudflare 客户区的 Worker 子请求：Worker 脚本可以改 `CF-Connecting-IP` 和 `x-real-ip`。
- Pseudo IPv4 设成 Overwrite Headers 时，Cloudflare 会用伪 IPv4 **覆盖**已有的 `Cf-Connecting-IP` 和 `X-Forwarded-For`，真实 IPv6 留在 `CF-Connecting-IPv6`。
- 页面建议：要在源站拿原始访客 IP，看 `CF-Connecting-IP` 或 `True-Client-IP`，不要看 `X-Forwarded-For`。前两个都是单个地址。`True-Client-IP` 是企业版，且该页写：叠加 CDN 时如果没有由 Cloudflare 加上这个头，它的值可以被伪造成任意值。本提案不读 `True-Client-IP`。

「覆盖客户端自带的值」这句，普通路径上 Cloudflare 用的词是「提供连到 Cloudflare 的客户端 IP」，不是「overwrite」。出现 overwrite 的是 Pseudo IPv4 的 Overwrite Headers。Transform Rules 不允许客户把 `cf-connecting-ip` 改成别的值，只允许删除。客户端在到达 Cloudflare 之前自己写的 `CF-Connecting-IP` 会不会被换成连接地址，该页没有用 overwrite 这句话写出来。**待确认**的是这句原话；头的定义仍然是「连到 Cloudflare 的那一个地址」。

Supabase 是否确认自己的边缘函数就是这条「边缘到源站、且没有 Worker 改写」的路径：没有明说。**待确认。** 在这句话落下来之前，不能把 Cloudflare 的源站定义直接当成 `bt-relay` 的 `Request`。

验证实验里，`cf-connecting-ip` 有值且格式是单个 `ipv4`。那是格式读数。实验没有伪造这个头，也没有去掉进程代理，所以它没有证明「平台覆盖了客户端自带值」，也没有证明「这个地址是访客而不是代理」。

`CF-IPCountry` 是两位国家码（另有 `XX`、`T1`）。同一页写：要把它加到请求上，得打开 Add visitor location headers 这个 Managed Transform。Supabase 只把它列在 API 日志里。函数 `Request` 上有没有它，**待确认**。本提案不选它。

### 3.3 `x-forwarded-for`

Cloudflare HTTP headers 写的是追加，不是覆盖：

- 请求到达 Cloudflare 时如果没有 `X-Forwarded-For`，Cloudflare 发出的值与 `CF-Connecting-IP` 相同，是单个地址。
- 如果已经有这个头，Cloudflare 把「连到 Cloudflare 的那一跳 HTTP 代理的 IP」**追加**到末尾。页面的例子：访客 `203.0.113.1`，前面还有两级代理，源站看到的是 `203.0.113.1,198.51.100.101,198.51.100.102`。最后一段是 Cloudflare 追加的。
- 第一段是到达 Cloudflare 时头里已经有的值。客户端自己可以先写上这一段。页面没有写 Cloudflare 会把第一段换成连接地址。
- Transform Rules 不能修改 `x-forwarded-for` 的值。删掉之后，后端代理会在规则阶段之后重新加上（Workers 处理的请求例外：代理还没重新加上，头会不在）。这说的是 Cloudflare 客户的规则，不是「客户端写不进去」。

所以在「函数看到的就是 Cloudflare 发给源站的那份头」这个前提下，第一段是到达边缘之前就有的值，可以被客户端先写上；Cloudflare 追加的是末尾。Supabase 的 Turnstile 示例取的是第一段。它没有写平台会盖掉客户端自带的值。两份文档放在一起：示例取的那一段，正是 Cloudflare 写明不会被替换的那一段。

「函数看到的头是否仍是 Cloudflare 发出的那一份、中间没有再被追加」：Supabase 没写。**待确认。** 若 Supabase 或它后面的运行时又追加了一跳，末尾就不再是 Cloudflare 追加的那一段。

验证实验里不带头时已经是 `comma-list`，客户端改送单个 `203.0.113.7` 之后仍然是 `comma-list`。按 Cloudflare 的规则，单个地址会变成逗号列表，说明到达边缘时头里已经有值，或者后面又有人追加。那次请求的进程环境里有 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`，本地代理自己就会追加。所以那次读数不能单独写成「平台追加已确认」。

取第一段在未确认时为什么可能被伪造：客户端在请求里自己放 `X-Forwarded-For: <选定的地址>`。Cloudflare 的规则是保留这段并在后面追加，不是换成连接地址。函数若取 `split` 之后的第 0 段，用的就是客户端选定的那段。确认「平台会覆盖或丢掉客户端写的第一段」之前，不能采用 Turnstile 示例的取法。

### 3.4 伪造和读不到，各自影响什么

只发生在 `useQc` 为真的请求上（`UPSTREAM=qwencloud`，且名单未设置，或该令牌哈希在名单里）。名单外和开关关闭不看 IP。

账本是同一个 `bt_grant_charge`（`index.ts` 第 630–634 行）。`limit_usd` 不因 IP 改变。`docs/relay-qwencloud-rollout.md` 写明账号上限仍是已有的 0.2 美元，`GRANT_FLOAT_MIN_USD` 保持 5，走 QwenCloud 国际的请求不查这道余额地板。

IP 改变的是路径和这一笔怎么计价（rollout 第 1 节）：

| `isChina` | 上游 | 聊天记账 |
|---|---|---|
| true | `UPSTREAM_BASE`（默认百炼北京），模型 `GRANT_MODELS.chat` 或 `qwen-plus` | `usage.cost`，否则 `total_tokens × chatPerKTok`，否则 `chatFloor` |
| false（含空 IP） | QwenCloud 国际，模型 `qwen3.7-plus` | `prompt_tokens × $0.40/百万 + completion_tokens × $1.60/百万`，两个字段都没有才用 `chatFloor` |

朗读、转写同样分叉。国际用 `QC_TTS_PER_10K` / `QC_ASR_PER_SEC`。中国档的朗读、转写模型没配时是 503 `grant_misconfigured`，不转发、不记账。

所以「只影响走北京还是国际，不影响钱和额度」**不成立**。同一条额度上限里，每一笔扣掉的美元数随计价公式变；我们付给上游的也是另一家。它**不**改变额度上限、不改变名单、不跳过记账（失败请求本来就不记账；国际转写缺秒数时记 0，这是现有规则）。

伪造成中国：聊天走北京计价和北京上游；朗读、转写在模型未配置时 503。伪造成非中国：走国际模型和国际标价，从同一个 0.2 美元里扣。

读不到（空字符串）：`isChina` 返回 false，与非中国相同。托管函数上 `x-real-ip` 缺失时，走 QwenCloud 的令牌全部走国际，没有人走北京。这不是免费，也不是绕过额度。

## 4. 候选读法

前提都是：只改托管 `bt-relay` 在 `useQc` 时读的那一个字符串。`bt-models` 仍读 Caddy 写入的 `X-Real-IP`。读不到、或解析不了，沿用 `isChina` 的现有行为（false，当非中国），除非第 6 节另定。

| 候选 | 读哪个头、取哪一段 | 文档依据 | 读不到 | 被伪造时 |
|---|---|---|---|---|
| A. 维持现状 | `x-real-ip` 整段 | Supabase 没有写函数 `Request` 上有它。Cloudflare 在「没有 Worker 子请求」时会去掉 `x-real-ip`。验证实验三次都是 `absent` | 全部当非中国，走国际 | 实验里客户端自己送的值也没有到达。在这条已观察到的路径上，客户端伪造这个头没有用。函数是不是「没有 Worker 子请求」那条路径，仍待确认 |
| B. Turnstile 的取法 | `x-forwarded-for` 按逗号拆开，取第一段 | Supabase 函数示例就是这样取的。Cloudflare 写明已有的头会被追加，第一段保留 | 头缺失则当非中国。Cloudflare 写：没有这个头时它会设成与 `CF-Connecting-IP` 相同的单个地址；函数上是否仍如此，待确认 | 第一段可以由客户端先写上。未确认平台会丢掉这段之前，不采用 |
| C. 逗号列表的最后一段 | `x-forwarded-for` 拆开后取最后一段非空 | Cloudflare 写它追加的是连到 Cloudflare 的那一跳。仅当函数看到的就是这份头、且后面没有再追加 | 缺失则当非中国 | 客户端可以加长列表，但按 Cloudflare 的追加规则，它改不掉末尾新加的那一段。Supabase 没有确认函数看到的末尾仍是那一段。**待确认，现在不改成这个** |
| D. `cf-connecting-ip` 整段 | 不按逗号拆。格式应是单个地址 | Cloudflare 对源站的定义，并建议用它而不是 `X-Forwarded-For`。Supabase 没有写函数该读它 | 缺失或不是单个地址：当非中国。验证实验里它是单个 `ipv4`；那次有进程代理，不能当成无代理的访客地址 | 普通路径上，页面没有写「overwrite 客户端自带值」这句原话。Worker 子请求里脚本可以改它，跨区会被换成固定地址。函数属于哪一种，**待确认** |
| E. `cf-ipcountry` | 两位国家码，`CN` 当中国 | Cloudflare 写了国家码，但要 Managed Transform 才加到请求上。Supabase 只把它列在 API 日志 | 没有这个头就无法判断。函数上有没有，待确认 | 不选。文档没有说函数 `Request` 上有它 |

## 5. 推荐

现在不改代码。

若以后只验证一个头，验证 `cf-connecting-ip` 的整段（候选 D），不验证「取 `x-forwarded-for` 第一段」（候选 B）。理由：Cloudflare 把单个地址的 `CF-Connecting-IP` 写成源站该看的客户端 IP，并写明 `X-Forwarded-For` 的第一段是到达边缘之前就有的值。Supabase 的 Turnstile 示例没有取消这句。

在 Supabase 写明「托管函数的 `Request` 就是 Cloudflare 发往源站、且没有 Worker 改写的那一份」之前，候选 D 也不能落地。这句话今天是 **待确认**。候选 C 同样要等这句，因为它依赖「末尾仍是 Cloudflare 追加的那一段」。

`bt-models` 继续读 Caddy `header_up` 写的 `X-Real-IP`。那不是托管 Supabase 的请求。

缺头时的行为维持 `isChina` 的现状（当非中国），直到第 6 节有人改这个选择。不在本提案里改成 503。

## 6. 要用户定的问题

1. 缺头、或头不是单个 IP 时，走 QwenCloud 的令牌继续当非中国，还是改为 503 `grant_misconfigured`、不转发？后者会让「头没到」变成整档不可用，而不是全部走国际。
2. 是否批准第 7 节的验证？不批准就不做。
3. `bt-models` 是否维持只读 Caddy 的 `X-Real-IP`？本提案的推荐是维持。

## 7. 若要再验证（只写不做）

目的：看客户端自带的 `cf-connecting-ip` 到函数时格式变不变，以及在**没有进程代理**时 `x-forwarded-for` 是单个地址还是逗号列表。不回地址，不回段表，不读密钥。不部署 `bt-relay`、`bt-models` 或任何已有函数。

预期在跑之前写死。读数与预期不符就停，不改函数再试。

函数沿用 `docs/relay-qwencloud-probe-plan.md` 的约束：`verify_jwt = false` 只因为不带用户 JWT 时默认校验会在函数代码之前返回 401（Function Configuration，该方案已引）。响应只有三个头的有无和格式（`absent` / `empty` / `ipv4` / `ipv6` / `comma-list` / `other`）。GET 以外 405。不读 `Deno.env`，不 `fetch`，不打日志。部署、删除的命令与该方案第 3 节相同，函数名换成下面这个，不带 `--use-api`，不带 `--prune`。

函数名：`tmp-probe-592-ip`。只报 `x-real-ip`、`x-forwarded-for`、`cf-connecting-ip` 的格式。

请求必须从没有 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 的进程发出。环境里有其中任何一个：停下报告，不取消代理再重试。中国 / 非中国仍不判断，格式里没有国家。

1. GET，不额外带头。
   - 若函数看到的是 Cloudflare「到达时没有 `X-Forwarded-For`」那条规则：`x-forwarded-for` 与 `cf-connecting-ip` 都是 `ipv4` 或都是 `ipv6`，`x-real-ip` 为 `absent`。
   - 若 `x-forwarded-for` 仍是 `comma-list`：无代理时已经有人追加。谁追加，文档没有写到这一跳，**待确认**。不要改成取最后一段。
2. 再 GET 一次。`x-forwarded-for: 203.0.113.7`，`cf-connecting-ip: not-an-ip`。`not-an-ip` 不是 IP，按探针格式应是 `other`。
   - `x-forwarded-for` 变成 `comma-list`：与 Cloudflare「已有则追加」相符。仍是 `ipv4`：单个值没有保持为「只有文档地址」这种可区分的形状；原样保留和被换成另一个 IPv4 无法分开，这一条保持 **待确认**。
   - `cf-connecting-ip` 为 `ipv4` 或 `ipv6`：客户端送的 `not-an-ip` 没有原样到达。为 `other`：客户端的值到了函数，这个头可以被伪造，候选 D 不成立。为 `absent`：被去掉且没有被设上。
3. 删除函数，`functions list` 确认名字不在，再 GET 一次只记 HTTP 状态。状态码不代替 list。然后删掉本地临时文件，不提交。

需要点头的步骤，按顺序：在 issue 贴本文件的预期（第 7 节这三条，不得事后改）→ 确认本机这次请求没有上述代理环境变量 → 点名部署 `tmp-probe-592-ip` → 发上述两次 GET → 点名删除并用 list 确认。

## 8. 仍是待确认

- Supabase 没有写：托管函数该读哪个头、该头是否由平台写入、客户端能否伪造。
- Supabase 没有写：函数 `Request` 是 Cloudflare 发往源站的流量，还是 Worker 子请求，还是边缘之后又改过一次。
- Cloudflare 没有用 overwrite 写明：普通路径上客户端自带的 `CF-Connecting-IP` 会被换成连接地址。Worker 子请求的改写规则是另几句。
- 函数看到的 `X-Forwarded-For` 末尾是不是 Cloudflare 追加的那一段。
- 函数 `Request` 上有没有 `CF-IPCountry`。
- 无进程代理时，不带头的 `x-forwarded-for` 是单个地址还是逗号列表。第 7 节不跑就仍然不知道。
- 托管 `bt-relay` 读不到段表时是否 503。本提案不观测。

## 所依据的规约

- BAN-39（`docs/conventions-digest.md`，来源 `AGENTS.md`）：Supabase 路径先查 Supabase 的文档；边缘网络只在查了 Cloudflare 自己的页之后引用。没写的标待确认，不靠试。本提案不发探针。
- `docs/relay-qwencloud-rollout.md` 第 1 节和第 3 节：空 `X-Real-IP` 当非中国；托管上有没有这个头在验证之后已有格式读数，文档合同仍未写。
- `docs/relay-qwencloud-probe-plan.md`：函数侧示例是 `x-forwarded-for` 第一段，且写明平台覆盖未确认之前不改代码。本提案在读了 Cloudflare 的追加规则之后，不采用那一取法。
- `docs/learning-design.md` §8.10：中继不记录内容。提案和将来的探针都不回地址、不回段表、不读密钥。
- 并行 session：只在 `mobiletranslator-592` 新增这一份文档。没有碰 `main`，没有碰 `release/1.19.0`。
