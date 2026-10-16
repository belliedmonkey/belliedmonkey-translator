# 2026-10-16 QwenCloud 上线顺序（只写不做）

核对日：2026-10-16。工作树 `mobiletranslator-592`，分支 `cursor/feat-592-unified-subs`。

这一份不部署函数，不改线上环境变量，不打开 `UPSTREAM=qwencloud`，不改客户端，不打包，不读密钥。QwenCloud 的 Key 这一步用不到，没有读 `~/mobiletranslator/.local/keys.md`。

依据是 BAN-39（`AGENTS.md`「第三方 API：先查该路径的官方文档」）。查的是该服务自己的页面。文档没写到这条路径上的，记 **未找到**，不改代码，不发探针。

清单原文：`docs/relay-qwencloud-rollout.md`。IP 提案原文：`docs/relay-client-ip-proposal.md`。中继中国分支实际发出的地址在 `supabase/functions/bt-relay/index.ts`：朗读 `POST {UPSTREAM_BASE}/audio/speech`，转写 `POST {UPSTREAM_BASE}/audio/transcriptions`。`UPSTREAM_BASE` 不设时是 `https://dashscope.aliyuncs.com/compatible-mode/v1`。

## 1. 三项待确认

1.1 与 1.2 仍是 **未找到**，本节不改这两节的结论，不发探针。1.3 按 2026-10-16 的裁定改记，不再是未找到。清单第 0 节的顺序仍然不能开始：1.1、1.2 没有落地，并且 1.3 的裁定和 Supabase 这份代码不是同一条路径。

### 1.1 托管函数上，客户端真实 IP 该读哪个头

**未找到。**

只读了 Supabase 自己的页面（2026-10-16）：

| 页面 | 链接 | 页面上有的 | 页面上没有的 |
|---|---|---|---|
| CAPTCHA support with Cloudflare Turnstile | https://supabase.com/docs/guides/functions/examples/cloudflare-turnstile | 示例函数读 `x-forwarded-for`，按逗号拆开，把第一段交给 Turnstile 的 `remoteip` | 没写这个头由平台写入，没写客户端不能伪造，没写第一段是访客地址，没写边缘函数该用它做地理判断 |
| Logging（Edge Functions） | https://supabase.com/docs/guides/functions/logging | `Object.fromEntries(req.headers)` 的示例里有 `cdn-loop`（值含 `cloudflare`）、`cf-ray`、`cf-worker`（值 `supabase.co`）、`x-forwarded-host` / `x-forwarded-port` / `x-forwarded-proto`。页面称这是 “something like” | 这份示例里没有 `x-forwarded-for`、`x-real-ip`、`cf-connecting-ip`。示例不是「这些头一定没有」 |
| Logging（平台日志） | https://supabase.com/docs/guides/monitoring-and-debugging/logs | API 日志允许记录的请求头包括 `cf-connecting-ip`、`x-real-ip`。同段写：没列进日志的头仍会到达 server(s) 和 client(s) | 这一节是 API 日志，不是函数 `Request` 的字段表 |
| Discovering and Interpreting API Errors in the Logs | https://supabase.com/docs/guides/troubleshooting/discovering-and-interpreting-api-errors-in-the-logs-7xREI9 | `edge_logs` 里 `request.headers.cf_connecting_ip` 的说明是 Requester's IP。示例过滤 `/auth/v1/` | 不是函数 `Request` |
| Log sources and fields | https://supabase.com/docs/guides/observability/log-field-reference | API 网关日志列表含 `cf-connecting-ip`、`x-real-ip`，并写其他头仍会到达应用。`function_edge_logs` 的请求头字段只有 `accept`、`content-length`、`host`、`user-agent` | 没有写托管函数的 `Request` 上，客户端真实 IP 在哪一个头，以及客户端能否伪造 |

代码仍只读 `x-real-ip`（`supabase/functions/bt-relay/index.ts` 第 341 行）。这一步不改。不把 Turnstile 示例的第一段搬过来。不发探针。

### 1.2 `cn-cidrs.txt` 会不会随函数一起发布

**未找到。**

中继在 `UPSTREAM=qwencloud` 时读 `new URL("../bt-models/cn-cidrs.txt", import.meta.url)`（同文件第 166 行）。这个 `.txt` 没有 `import`，也没有写进 `static_files`。

Supabase 页面（2026-10-16）写了静态文件这个机制，没有写「未列入、也没有被 import 的兄弟文件，`supabase functions deploy` 会不会带上」：

| 页面 | 链接 | 原文在说什么 |
|---|---|---|
| CLI config | https://supabase.com/docs/guides/local-development/cli/config | `functions.<function_name>.static_files` 默认 None。Specify an array of static files to be bundled with the function。only file paths within `functions` directory are supported |
| Using Wasm modules | https://supabase.com/docs/guides/functions/wasm | 部署前要在 `config.toml` 里声明 `static_files`，文件才会打进包。Static files cannot be deployed using the `--use-api` API flag. You need to build them with Docker on the CLI |
| Limits | https://supabase.com/docs/guides/functions/limits | 同一句：`--use-api` 不能部署静态文件，要用带 Docker 的 CLI |

`supabase/README.md` 里「现有的 Supabase 函数打包不会带上这个文件」没有对应的官方原话。本方案不采用那句。两个备选（声明 `static_files`，或把段表放进被 import 的模块）清单第 3 节已经写明不做。官方也没有写 `Deno.readTextFile(import.meta.url)` 会解析到 `static_files` 打进去的那份文件。不部署去试。

### 1.3 大陆 IP 的朗读和转写

**不做，沿用现有配置。** 用户 2026-10-16 裁定：大陆 IP 的朗读和转写沿用现有 dashscope 配置（国内中继 `UPSTREAM=dashscope` 与百炼北京区），不新增适配，不填新的 `GRANT_MODELS.tts` / `GRANT_MODELS.stt`。

**Supabase 这份代码没有做成「不经过 QwenCloud 开关，行为与现在一致」。** 读的是 `supabase/functions/bt-relay/index.ts` 与 `supabase/functions/bt-models/china-ip.ts`，没有改。`UPSTREAM=qwencloud` 且令牌进入 `useQc`（第 306 行：名单未设置则全部进入，名单已设置则只有哈希在名单里才进入）时，用 `x-real-ip` 调 `isChina`（第 341 行）。判成大陆之后，请求留在这份 Supabase 函数里，不转发到国内那份 `UPSTREAM=dashscope` 的中继。

`isChina` 为真、且不填 `GRANT_MODELS.tts` / `GRANT_MODELS.stt` 时：

| 类 | 走哪里 | 和现在的 Supabase（`UPSTREAM` 未设，即 OpenRouter） |
|---|---|---|
| 聊天 | 模型 `MODELS.chat \|\| 'qwen-plus'`（第 342 行）。密钥是 `UPSTREAM_KEY`（第 72、344 行），不是 `OPENROUTER_GRANT_KEY`。`qcIntl` 为假，不进 `QC_CHAT_BASE`。发出 `POST {UPSTREAM_BASE 或默认 https://dashscope.aliyuncs.com/compatible-mode/v1}/chat/completions`（第 505 行）。`UPSTREAM_KEY` 为空则第 345–347 行 503，日志 `no_key` | 另一条路径。不是 OpenRouter，也不是国内那份中继 |
| 朗读 | 模型 `MODELS.tts \|\| ''`（第 342 行）。不填就是空字符串。第 345–347 行直接 503 `{error:"grant_misconfigured"}`，日志 `no_model_configured`。到不了 `/audio/speech` | 503 |
| 转写 | 模型 `MODELS.stt \|\| ''`。同样第 345–347 行 503，日志 `no_model_configured`。到不了 `/audio/transcriptions` | 503 |

另外两处在分到这三类之前就会离开「与现在一致」：

- 段表读不到时 `CN_BAD` 为真（第 164–174 行）。`useQc` 的请求在第 307 行就 503，聊天、朗读、转写都是，还没看 IP。
- `isChina` 对空字符串返回 false（`china-ip.ts` 第 38–40 行）。`x-real-ip` 为空时，人在大陆也会被当成非中国，走 QwenCloud 国际：聊天 `qwen3.7-plus`，朗读 `qwen3-tts-flash`，转写 `qwen3-asr-flash`。这个头在不在托管函数的请求上，仍是第 1.1 节的未找到。

顺序停在这里。不改代码。第 7 步不写成「大陆 IP 不经过 QwenCloud 开关，行为与现在一致」。

## 2. 需要用户同意的顺序

10 步。本次一步都不执行。1.1 与 1.2 仍是未找到。1.3 的裁定与上面的代码读数不一致（朗读、转写 503，聊天不走国内中继、也不走现在的 OpenRouter）。清单第 1 节的顺序不能开始，下面 10 步也不能开始。

中国机上那份 `UPSTREAM=dashscope` 不在这个开关里，不在表里。

哈希算法沿用清单第 4 节：去掉 `Bearer ` 前缀、trim，再 SHA-256，小写十六进制，无分隔符，名单里写全长 64 位。令牌明文不转小写，不写进文档、issue、日志或响应。日志只留哈希前 8 位。

`QWENCLOUD_ALLOW_TOKEN_HASHES` 未设置等于全量。设成空串是空名单，全部走旧路径，不要当成没设。灰度必须设置，不能靠不设这个变量。

Key 的规则：只在真正设密的那一步，从 `~/mobiletranslator/.local/keys.md` 的 `key_chat_qwencloud_global` 那一行读入环境变量。不打印，不写日志，不进命令行参数，不读别的行。官方 `supabase secrets set`（https://supabase.com/docs/reference/cli/supabase-secrets-set ，2026-10-16）的位置参数是 `NAME=VALUE`，另有 `--env-file` 从文件读。两处都不是「只从那一行进环境变量、不落盘、不进 argv」。本方案不写一条可执行的设密命令。

| # | 做什么 | 线上对象 | 回滚 | 回滚怎么做 | 验证 |
|---|---|---|---|---|---|
| 1 | 用户重置测试期间用过的 QwenCloud Key，把新值写入 `key_chat_qwencloud_global` 那一行 | QwenCloud 账号上的 Key；本机 `keys.md` 的那一行。不进仓库 | 能再重置一把新的。旧值作废之后不能用旧值退回 | 用户在 QwenCloud 控制台再重置，并改那一行。不把值贴到 issue | 这一步不读那一行，也不调用上游 |
| 2 | 把那一行设成线上 `QWENCLOUD_KEY`。开关仍关。值不进 argv、不进仓库、不进 issue | 托管项目的 secret `QWENCLOUD_KEY` | 能覆盖或卸掉。清单写：开关关闭时不读它 | `supabase secrets unset QWENCLOUD_KEY`，或再用一把新 Key 覆盖。具体设进去的命令本方案没有 | 不打印 secret。`supabase secrets list` 只看名字在不在，不看值 |
| 3 | 设 `QWENCLOUD_ALLOW_TOKEN_HASHES` 为**一个**测试令牌的 64 位小写哈希。先于开关 | 同一个项目的 secret `QWENCLOUD_ALLOW_TOKEN_HASHES` | 能 | 设成空串：空名单，走旧路径。不要用「删掉变量」当回滚，删掉等于全量 | 开关仍关时，旧客户端行为与现在相同。名单内容不出现在响应里 |
| 4 | 部署托管函数 `bt-relay`。`supabase functions deploy bt-relay --no-verify-jwt`。不带 `--prune`。不带 `--use-api`（静态文件那条路官方写明 `--use-api` 带不上）。不改 `UPSTREAM`。不改 `GRANT_MODELS` 里现在的旧 id。不填 `tts` / `stt` | 托管函数 `bt-relay` | 开关未开时，清单写请求体和状态码与现在相同。清单没有写「把函数二进制换回上一版」的命令 | 运行时回滚见第 5 步。要换回旧代码，得另一次部署旧包，那次部署不在本表里 | 开关未开：旧模型名的聊天仍转发。不读段表（段表只在 `IS_QC` 时读，同文件第 160–166 行） |
| 5 | 设 `UPSTREAM=qwencloud`。第 3 步的名单必须已经是「已设置」 | secret `UPSTREAM` | 能，且不必为了这一下再部署 | 去掉 `UPSTREAM`，或设成 `openrouter`。清单第 5 节：环境变量立即生效。国际请求回到 OpenRouter；不再读段表，不再按 IP 分叉；模型钉回 `GRANT_MODELS` 的旧 id。已经发出去的新客户端仍会 403，只改 `UPSTREAM` 滚不回客户端 | 名单内、非中国、聊天：`bt_grant_usage.model` 为 `qwen3.7-plus`。名单外仍走旧路径。空 `X-Real-IP` 在代码里是非中国；头在不在请求上仍是第 1.1 节的未找到 |
| 6 | 同一个测试令牌只测聊天 | 已部署的 `bt-relay`；表 `bt_grant_usage`；函数日志 | 能 | 同第 5 步，停在当前名单，不发客户端 | 清单第 4 节的通过标准：至少一行 `kind=chat`，`model=qwen3.7-plus`；抽一行 `cost_usd` 等于 `prompt_tokens/1e6×0.40 + completion_tokens/1e6×1.60`（两个字段都缺才是 `chatFloor`）。日志没有 `upstream_billing`、`upstream_rate_limited`、`grant_misconfigured`。正文非空。连续多行都是地板价 0.0005：停 |
| 7 | 同一令牌再测朗读和说题转写。不写成「大陆 IP 不经过 QwenCloud 开关，行为与现在一致」：`useQc` 且 `isChina` 为真、又不填 `GRANT_MODELS.tts` / `stt` 时，朗读和转写是 503 `grant_misconfigured`（第 345–347 行），聊天走 `UPSTREAM_BASE` 的 `/chat/completions`。顺序停在第 1.3 节，这一步不执行 | 同上 | 能 | 同第 5 步。这一 503 若出现在名单内的非中国请求上，按停止，不扩大 | 非中国：`kind=tts` 且 `model=qwen3-tts-flash`，字节能当音频播；`kind=stt` 且 `model=qwen3-asr-flash`，`text` 非空，`cost_usd > 0`。要时间戳的转写通过标准是 400 `timestamps_unsupported`。出现 `audio_fetch` 或 `bad_asr_body`：停 |
| 8 | 通过第 6、7 步之后，再往名单里加下一个令牌的哈希。每加一次都重对通过 / 停止标准 | secret `QWENCLOUD_ALLOW_TOKEN_HASHES` | 能 | 从变量里拿掉刚加上的那一段哈希，保留已经通过的那些。不要把整个变量删掉 | 新哈希重复第 6、7 步。名单外的新模型名 403 `model_not_allowed` 是预期 |
| 9 | 第 6–8 步的读数过了，再发带 `qwen3.7-plus` / `qwen3-tts-flash` / `qwen3-asr-flash` 的客户端。本次不打包 | 客户端发行物。中继已经在线上 | 客户端一旦发出，只改 `UPSTREAM` 滚不回 | 客户端还没发：做第 5 步的回滚即可。已经发出：停止发放；清单写 OpenRouter 是否接受这三个 id 仍待确认，确认之前不靠改 `GRANT_MODELS` 去接新客户端 | 旧中继（开关关）对新模型名是 403。开关开且哈希在名单内才接受新名字 |
| 10 | 上线后 7 天沿用「出现即停」 | `bt_grant_usage` 与函数日志。不从库里读正文 | 能 | 停在当前灰度范围，按第 5 步去掉 `UPSTREAM`。不发下一档客户端，不改单价常量，不把这些失败记成用户的 402。已经记下的 `spent_usd` 不清 | 清单第 7 节那张表：成本公式、上游 429、测试令牌的空正文、`bad_asr_body` / 成片 `usage_missing`、`audio_fetch`。比例阈值清单写明待用户定；定下来之前用「出现即停」 |

停止条件（任一条就停在当前范围，做第 5 步的回滚，不发客户端）：`grant_misconfigured`、`upstream_billing`、`upstream_rate_limited`、朗读 `audio_fetch`、转写 `bad_asr_body`、`model` 列不是这一档钉死的名字。

## 3. 这一步没有做的

- 没有部署，没有 `supabase secrets set`，没有改 `UPSTREAM`。
- 没有发 IP 探针，没有改 `bt-relay` 的读头。
- 没有读 `key_chat_qwencloud_global`。
- 没有改客户端，没有打包。
- 没有改 `bt-relay`。1.3 的代码读数与裁定不一致，顺序停在第 1.3 节。
