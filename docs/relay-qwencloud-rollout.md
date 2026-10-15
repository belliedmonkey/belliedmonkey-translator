# 国际中继 QwenCloud 开关 — 部署前清单

日期：2026-10-15。issue [#592](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592)。
文档依据先贴在 [issuecomment-6186978520](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592#issuecomment-6186978520)。

这一份只是清单。不部署、不推送、不改线上环境变量、不改代码行为。代码在工作树 `mobiletranslator-592`、分支 `cursor/feat-592-unified-subs`，本地提交，没有 upstream。

开关是 `UPSTREAM=qwencloud`。不设、或仍是 `openrouter` / `dashscope` 时，请求体和状态码与现在相同。打开之后，走 QwenCloud 的令牌按 `X-Real-IP` 调用 `bt-models` 的 `isChina`：非中国走 QwenCloud 国际按量，中国走百炼北京兼容模式。哪些令牌走 QwenCloud 由 `QWENCLOUD_ALLOW_TOKEN_HASHES` 决定，见第 4 节。不设这个变量等于全量。

## 0. 现在还不能按这一份上线

第 1 条是已经写进代码的用法：灰度时必须设置，漏设等于全量。第 2–4 条不解决，第 1 节的顺序不能开始执行。本清单不替第 2–4 条做选择。

1. **灰度必须设置 `QWENCLOUD_ALLOW_TOKEN_HASHES`，否则等于全量。** 变量未设置时，`UPSTREAM=qwencloud` 对每一枚令牌生效。变量已设置时，只有名单里的令牌哈希走 QwenCloud；名单外走 `UPSTREAM` 未设时的现有路径，行为、状态码、记账与开关关闭相同。设成空串是空名单，全部走旧路径，不要当成没设。名单外的新客户端（`qwen3.7-plus` / `qwen3-tts-flash` / `qwen3-asr-flash`）会 403 `model_not_allowed`，这是预期。用法在第 4 节。
2. **`cn-cidrs.txt` 会不会随 Supabase 函数发布：待确认。** 见第 3 节。读不到时：名单未设置，开关打开后的每一个非 OPTIONS 请求都是 503 `grant_misconfigured`；名单已设置（含空串），这一条只挡走 QwenCloud 的令牌，名单外仍走旧路径。
3. **托管 Edge Function 的请求上有没有 `X-Real-IP`：待确认。** 见第 3 节。代码只读这个头。空字符串在 `isChina` 里是非中国，于是所有人走 QwenCloud。
4. **中国 IP 的朗读、转写模型 id：待确认。** 北京文档写的路径和中继中国分支发出去的路径不是同一条。不填的话这两档是 503 `grant_misconfigured`。见第 2 节。

## 1. 上线顺序

顺序固定：先部署中继并打开开关，并且先只对一个测试令牌的哈希放开；这一步的读数过了，再发带新模型名的客户端。放开的办法是设置 `QWENCLOUD_ALLOW_TOKEN_HASHES`（第 4 节）。不设这个变量不等于灰度，等于全量。

新客户端先发到旧中继上会 403。旧中继（开关关闭）把模型钉在 `GRANT_MODELS` 里现在的三个 id：聊天 `deepseek/deepseek-v4-flash`、朗读 `deepgram/aura-2`、转写 `openai/whisper-1`。这份分支上的客户端改成了 `qwen3.7-plus`、`qwen3-tts-flash`、`qwen3-asr-flash`。开关关闭时，客户端模型名和钉住的名字不一致就回 **403** `{error:"model_not_allowed", model:<服务端钉住的旧 id>}`，请求不转发、不记账。接受新模型名的分支只在该令牌走 QwenCloud 时执行：开关打开且名单未设置，或者哈希在名单里。名单外和开关关闭相同，仍是上面的 403。所以只部署代码、不打开开关，新客户端仍然 403；打开了开关但忘了把这枚令牌写进名单，也是 403。

旧客户端（仍发送上面三个旧 id）在走 QwenCloud 时（名单未设置，或哈希在名单里），按 IP 分两种。下面逐项写。名单外不按 IP 分，见第 4 节。音色与模型名取自改注册表之前的 `grant_speech`：模型 `deepgram/aura-2`，音色 `aura-2-thalia-en`。转写是否带时间戳看 `extension/content/request-shape.js`：只有调用方 `wantCues` 时才追加 `response_format=verbose_json` 和 `timestamp_granularities[]=segment`（约第 567 行）。说题那条路不加这两项。

### 非中国 IP（含 `X-Real-IP` 为空）

- **聊天。** 旧模型名被接受，换成 `qwen3.7-plus`。服务端写上顶层 `enable_thinking: false`。客户端若自己带了 `temperature`，白名单会原样带上；服务端不另写一个。`response_format` 只有恰好 `{"type":"json_object"}` 留下，这时丢掉 `max_tokens`。不发送 `usage.include`。成功时响应仍是聊天补全 JSON。记账用返回的 `prompt_tokens` × $0.40/百万 + `completion_tokens` × $1.60/百万。两个字段都没有才用 `GRANT_PRICES.chatFloor`（默认 0.0005）。账本 `model` 列写 `qwen3.7-plus`。
- **朗读。** 旧模型名被接受，换成 `qwen3-tts-flash`。音色 `aura-2-thalia-en` 不在 qwen3-tts-flash 的非实时表里，映射成 `Cherry`。`language_type` 为 `Auto`。不转发 `speed` / `response_format`。成功时客户端拿到的是音频字节和 GET 回来的 Content-Type（没有这个头则 `audio/wav`），不是上游那份 JSON。签名 URL 不进日志。URL 不是 `https://`、GET 不是 200、或 GET 抛错：502 `{error:"upstream"}`。记账用 `usage.characters` × $0.1/万；缺字段用输入字符串长度。
- **转写，说题（不带时间戳）。** 旧模型名 `openai/whisper-1` 被接受，换成 `qwen3-asr-flash`。音频编成 `data:<mime>;base64,...`（去掉 `;codecs=…`）。不传 `asr_options`。成功响应收成 `{text}`，没有 `segments`。记账用 `usage.seconds` × $0.000035。缺秒数或秒数不是有限数：记 0，日志 `usage_missing`，**不写** `bt_grant_usage` 行（只有 `charged > 0` 才记账）。编码后 base64 长度超过 9 MiB：413 `{error:"audio_too_large"}`，不截断。
- **转写，要字幕时间戳（`wantCues`）。** 400 `{error:"timestamps_unsupported"}`。不转发，不退回 OpenRouter。
- **上游 401 / 402 / 403。** 一律改写 503 `{error:"grant_unavailable"}`，不把上游正文给客户端。日志 `upstream_billing` 带原来的状态码。
- **上游 429。** 429 `{error:"upstream_rate_limited"}`。中继自己的每分钟 60 次仍是 429 `{error:"busy"}`。
- **余额地板。** 走 QwenCloud 的请求上 `floatOk()` 直接放行。`GRANT_FLOAT_MIN_USD=5` 设着也不检查 QwenCloud 余额。名单外的请求仍检查 OpenRouter 余额，见第 4 节。

### 中国 IP（仅当 `X-Real-IP` 被 `isChina` 判中）

- **聊天。** 旧模型名被接受，换成 `GRANT_MODELS.chat`，没配就是 `qwen-plus`。不写 `enable_thinking`，不改写客户端带来的 `temperature`。发到 `UPSTREAM_BASE`（默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`）的 `/chat/completions`，用 `UPSTREAM_KEY`。记账仍是开关关闭时的三级：`usage.cost`，否则 `total_tokens × chatPerKTok`，否则 `chatFloor`。不用 $0.40 / $1.60。
- **朗读。** `GRANT_MODELS.tts` 没配：503 `{error:"grant_misconfigured"}`，日志 `no_model_configured`。配了：发到同一基址的 `/audio/speech`，音色仍是客户端送来的 `aura-2-thalia-en`（中国分支不做 Cherry 映射）。北京文档没有写这条路径，所以上游会回什么是待确认。
- **转写。** `GRANT_MODELS.stt` 没配：同样 503 `grant_misconfigured`。配了：multipart 原样转到 `/audio/transcriptions`，时间戳字段会转发。北京文档没有写这条路径。记账仍是旧的三级（`usage.cost`，否则时长 × `sttPerMin`，否则字节 × `sttPerMB`）。
- **401 / 402 / 403 / 429** 的改写与非中国相同（开关打开对两边都改写）。

`GET /spec` 仍返回环境变量 `GRANT_MODELS` 的原文，不返回国际钉死的三个模型名。`GET /balance` 与开关无关，仍是 `{limit_usd, spent_usd, remaining_usd}`。

## 2. 线上环境变量

值只写「去哪里取」。不写任何密钥。生产密钥的设置方式见 Supabase 文档 [Environment variables](https://supabase.com/docs/guides/functions/secrets)（2026-10-15）：Dashboard 的 Edge Function Secrets，或 `supabase secrets set`。函数用 `Deno.env.get` 读。该页写：新密钥立即生效，不必为了密钥再部署一次。名字不能以 `SUPABASE_` 开头；下表没有这种名字。

| 变量 | 开关打开时是否必填 | 取值来源 | 不设时 |
|---|---|---|---|
| `UPSTREAM` | 要打开开关就必填，值是 `qwencloud` | 这次上线时由操作者设置。不是从密钥文件读 | 代码当作 `openrouter`。请求体和状态码与现在相同，含 401 原样透传 |
| `QWENCLOUD_ALLOW_TOKEN_HASHES` | 灰度时必填。不设等于全量 | 逗号分隔的令牌哈希，写全长 64 位。算法与验令牌的 `sha256Hex` 相同：对去掉 `Bearer ` 前缀并 trim 之后的明文做 SHA-256，小写十六进制，无分隔符（[#592 的说明](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592#issuecomment-6187390435)）。每一段先 trim 再转小写；明文本身不转小写。不要把明文写进这个变量 | 未设置：开关打开后全部走 QwenCloud。空串：空名单，全部走旧路径，不要当成没设 |
| `QWENCLOUD_KEY` | 非中国 IP 必填 | 用户重置后写入本机 `~/mobiletranslator/.local/keys.md` 的 `key_chat_qwencloud_global` 行，再由操作者设进 Supabase 密钥。文档和命令行都不出现这个值 | 非中国请求 503 `grant_misconfigured`，日志 `no_key`（不打出密钥）。开关关闭时不读它 |
| `QWENCLOUD_CHAT_BASE` | 否 | 生产不设。只给本地单测指向桩 | `https://maas.qwencloudapi.com/compatible-mode/v1` |
| `QWENCLOUD_TTS_URL` | 否 | 生产不设 | `https://maas.qwencloudapi.com/api/v1/services/aigc/multimodal-generation/generation` |
| `UPSTREAM_KEY` | 中国 IP 必填 | 现有百炼北京密钥的存放处（中国中继那一份，不从本清单复制） | 中国 IP 请求 503 `grant_misconfigured`，日志 `no_key`。开关关闭且 `UPSTREAM` 为 `openrouter` 时，聊天密钥是 `OPENROUTER_GRANT_KEY`，不读这个变量 |
| `UPSTREAM_BASE` | 否 | 生产不设，沿用代码默认。北京 Base URL 页（2026-10-15）把 `https://dashscope.aliyuncs.com/compatible-mode/v1` 列为华北 2（北京）的 OpenAI 兼容地址，并写现有域名仍可使用 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `GRANT_MODELS` | 见下 | JSON 密钥。聊天 id 见下一段。朗读、转写 id 待确认，确认前不要填一个从别的路径搬来的名字 | 见下 |
| `GRANT_PRICES` | 国际三档的标价不读它（常量在中继里） | 现有 JSON。中国聊天的 `chatPerKTok` / `chatFloor`、中国朗读的 `ttsPerKChar`、中国转写的 `sttPerMin` / `sttPerMB` 仍用它 | 代码默认：`chatPerKTok` 0.001，`chatFloor` 0.0005，`ttsPerKChar` 0.015，`sttPerMB` 0.02，`sttPerMin` 0.007。国际聊天在两个 token 字段都缺失时用 `chatFloor` |
| `GRANT_FLOAT_MIN_USD` | 保持 **5** | 现有密钥，不要改成别的数 | 代码默认 5。走 QwenCloud 的请求不查这个余额。名单外、空名单、以及 `UPSTREAM=openrouter` 时，仍用 OpenRouter 的 `/credits`，低于 5 美元则 503 `grant_unavailable` |

`GRANT_MODELS` 三档：

- **聊天。** 写 `qwen-plus`。依据（2026-10-15）：[文本生成](https://help.aliyun.com/zh/model-studio/text-generation-model) 华北 2（北京）「旧版 Qwen」表有 `qwen-plus` 及其快照；[限流](https://help.aliyun.com/zh/model-studio/rate-limit) 华北 2（北京）列出 `qwen-plus`；[OpenAI 兼容](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) 的北京聊天路径是 `POST …/compatible-mode/v1/chat/completions`，与中继中国分支一致。注册表 `grant` 的中国区 `defaultModel` 已是 `qwen-plus`。不设 `GRANT_MODELS.chat` 时代码同样用 `qwen-plus`。
- **朗读。** 待确认。不设则中国 IP 的 `/audio/speech` 为 503 `grant_misconfigured`。[非实时语音合成](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide) 写的是 `…/api/v1/services/aigc/multimodal-generation/generation`（Qwen-TTS，模型含 `qwen3-tts-flash`）和 `…/api/v1/services/audio/tts/SpeechSynthesizer`（Qwen-Audio-TTS）。中继中国分支发的是 `{UPSTREAM_BASE}/audio/speech`。OpenAI 兼容页写明 Qwen-Audio 不支持 OpenAI 兼容协议。不把 `qwen3-tts-flash` 填进 `GRANT_MODELS.tts`。
- **转写。** 待确认。不设则中国 IP 的 `/audio/transcriptions` 为 503 `grant_misconfigured`。[Qwen-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference) 的示例模型是 `qwen3-asr-flash`，HTTP 是 `POST …/compatible-mode/v1/chat/completions` 加 `input_audio`。中继中国分支发的是 multipart `/audio/transcriptions`。不把 `qwen3-asr-flash` 填进 `GRANT_MODELS.stt`。

`limit_usd` 不在这张表里，保持 5 的是 `GRANT_FLOAT_MIN_USD`。账号额度上限仍是表 `bt_grants.limit_usd` 里已有的 0.2 美元，本清单不改它。

## 3. `cn-cidrs.txt` 如何随函数发布

中继在 `UPSTREAM=qwencloud` 时读 `new URL("../bt-models/cn-cidrs.txt", import.meta.url)`。`bt-models` 读同一目录下的 `./cn-cidrs.txt`。`bt-models` 今天的部署说明写的是 Deno 容器挂整个目录（`supabase/functions/bt-models/index.ts` 文件头），那条路文件在目录里。它不在 `supabase/README.md` 的 `supabase functions deploy` 列表里。

Supabase 官方文档（2026-10-15，链接见依据评论）**没有**写：`supabase functions deploy bt-relay` 或 `bt-models` 会不会带上这个没有被 import、也没有写进 `static_files` 的兄弟文件。`static_files` 默认是 None；只有列进去、且路径在 `functions/` 目录内的文件才会按该机制打包；`--use-api` 不能带静态文件。共享代码的文档写法是 `_shared` 加相对 import，并要求函数之间不要互相依赖。因此：

**待确认。** `supabase/README.md` 里「现有的 Supabase 函数打包不会带上这个文件」那句，官方页面没有对应的原话。本清单不采用那句。

两个备选，不选：

1. **声明 `static_files`。** 在 `config.toml` 里给 `bt-relay` 和 `bt-models` 各列一条，路径落在 `functions/` 内（官方允许的范围），用带 Docker 的 CLI 部署，不用 `--use-api`。代价：要改配置（本清单不做）；官方没有写 `Deno.readTextFile(import.meta.url)` 会解析到这份打包文件，做完仍要用下面的 503 判据回读；不能用 `--use-api`。
2. **把段表放进被 import 的 `_shared` 模块。** 这是 Development tips 写明的函数间共享方式。代价：要改代码（本清单不做）；以后刷新段表要重新部署函数；不再是运行时读 `.txt`。

### 部署后的验证（将来执行，现在不跑）

- **读不到。** 模块加载失败或 IPv4 表为空时 `CN_BAD`。名单未设置时，之后每一个非 OPTIONS 请求，在验令牌之前就回 **503** `{error:"grant_misconfigured"}`。名单已设置（含空串）时，这一条只挡走 QwenCloud 的令牌，在算出哈希之后回同一个 503；名单外仍走旧路径。函数日志有一行 `relay cn_cidr` 加上截断到 80 字的错误（URL 被抹掉）。这一行没有令牌哈希。
- **读到了。** 一个有效测试令牌、非中国网络的聊天请求不再是上述「验令牌之前的 503」，并且 `bt_grant_usage.model` 为 `qwen3.7-plus`。一个已知中国网络的同一请求，`model` 为 `qwen-plus`（或 `GRANT_MODELS.chat`）。两边都是 `qwen3.7-plus`：头是空的，或没有被判成中国。空头走非中国是代码行为；头在不在请求上仍是上面的待确认。
- 日志只有哈希前 8 位。不要为了验证去打印 IP 或密钥。

`X-Real-IP` 的文档情况：Turnstile 示例在函数里读的是 `x-forwarded-for`。日志字段页把 `x-real-ip` 列为边缘日志可记录的头，没有写函数的 `Request` 上一定有它。`bt-models` 文件头写的 `X-Real-IP` 是中国机 Caddy `header_up` 放进去的。托管 Supabase 上有没有这个头：**待确认**。代码不读客户端自己带的 `X-Forwarded-For`。

## 4. 灰度

灰度靠 `QWENCLOUD_ALLOW_TOKEN_HASHES`。`UPSTREAM=qwencloud` 且这个变量**已设置**时，只有名单内的哈希走 QwenCloud。名单外走 `UPSTREAM` 未设时的现有路径：OpenRouter（`OPENROUTER_GRANT_KEY`、`OPENROUTER_BASE`）、`usage.include`、401 原样透传、429 原样透传、`GRANT_MODELS` 钉死的旧模型、`floatOk()` 查 OpenRouter 余额、聊天按 `usage.cost` 那三级记账。这条路径不改用百炼的 `UPSTREAM_KEY` / `UPSTREAM_BASE`，中国 IP 也不会把名单外的令牌拉去北京。QwenCloud 的模型钉死、`enable_thinking`、音色映射都不作用到名单外。朗读、转写的计价同样是开关关闭时的那套。

变量**未设置**等于全量：开关打开后每一枚令牌都走 QwenCloud。灰度时必须设置。设成空串按空名单处理，全部走上面的旧路径，不要当成没设。

名单外的新客户端仍发送 `qwen3.7-plus`、`qwen3-tts-flash`、`qwen3-asr-flash`。旧路径钉的是 `GRANT_MODELS` 里的旧 id，对不上就 **403** `{error:"model_not_allowed", model:<旧 id>}`，不转发、不记账。这是预期，不是故障。旧客户端（仍发送旧 id）在名单外可以照旧转发。

哈希算法与中继验令牌的 `sha256Hex` 相同：去掉 `Bearer ` 前缀、trim，再 SHA-256，小写十六进制，无分隔符，名单里写全长 64 位。依据是 [#592 的说明](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592#issuecomment-6187390435)。每一段先 trim 再转小写，所以大写哈希和两侧空格都能对上；令牌明文不转小写，大小写不同就是另一枚令牌。日志里只有哈希前 8 位，用来过滤。不要把明文写进文档、issue、日志或响应。响应头和响应体不带名单。

下面的步骤是顺序要求。不要靠「不设这个变量」来灰度，那是全量。

每一步都看两类记录：

- 表 `bt_grant_usage`：`kind`（`chat` / `tts` / `stt`）、`model`、`cost_usd`、`ms`。没有内容列，也没有 URL 列。失败且 `charged = 0` 的请求**不会**出现在这张表里。
- 函数日志（`function_logs`）：`upstream_billing` 后面的 401 / 402 / 403，`upstream_rate_limited`（上游 429），`busy`（自己的限速），`grant_misconfigured`，`audio_fetch`，`usage_missing`，`bad_asr_body`。按哈希前 8 位过滤。

**通过一步**（全部满足才扩大范围）：

- 该令牌这一步测到的每种 `kind` 至少一行，`model` 是该 IP 档钉死的名字（非中国：`qwen3.7-plus` / `qwen3-tts-flash` / `qwen3-asr-flash`）。
- 抽一行聊天：`cost_usd` 等于 `prompt_tokens/1e6×0.40 + completion_tokens/1e6×1.60`（两边都缺字段时才是 `chatFloor`）。连续多行都是地板价 0.0005：停，去看上游有没有返回 token 字段。
- 这一步的日志里没有 `upstream_billing`、`upstream_rate_limited`、`audio_fetch`、`bad_asr_body`、`grant_misconfigured`。
- 聊天响应正文非空；说题转写的 `text` 非空；朗读字节可被客户端当音频播放（RIFF 头由客户端嗅探）。

**停止**（出现任一条就停在当前范围，按第 5 节关掉开关，不发客户端）：

- 任一 `grant_misconfigured`（段表、缺密钥、中国档缺模型）。
- 任一 `upstream_billing`（上游 401 / 402 / 403，客户端看到的是 503 `grant_unavailable`）。
- 任一 `upstream_rate_limited`。
- 朗读 `audio_fetch`，或转写 `bad_asr_body`。
- `model` 列不是这一档钉死的名字。
- 要时间戳的转写若被当成「应该成功」来测：它的通过标准是 400 `timestamps_unsupported`，不是 200。收到 200 且带 segments，说明请求走了别的上游，停止。

比例阈值（429 占请求的百分之几算超标）原文没有规定，**待用户定**。在定下来之前，部署期用上面的「出现即停」。

建议的扩大顺序：把一个测试令牌的哈希写进 `QWENCLOUD_ALLOW_TOKEN_HASHES`，先测聊天 → 同一令牌的朗读和说题转写 → 再往名单里加令牌。每加一档都重新对上面的通过 / 停止标准。名单外的令牌不在这一档的通过标准里；它们走旧路径，新模型名的 403 是预期。中国 IP 的朗读和转写在模型 id 仍是待确认时不纳入通过标准，预期就是 503 `grant_misconfigured`；若这一 503 出现在非中国、且哈希在名单内的请求上，按停止处理。

## 5. 回滚

运行时：去掉 `UPSTREAM`，或设成 `openrouter`。按密钥文档，环境变量立即生效，不必为了这一下再部署。效果：

- 国际请求回到 OpenRouter：`usage.include`、401 原样透传、402/403 仍改写 503、`floatOk()` 重新检查 OpenRouter 余额（低于 5 美元则 503 `grant_unavailable`）。
- 不再读 `cn-cidrs.txt`，不再按 IP 分叉。
- 模型钉回 `GRANT_MODELS` 里的旧 id。旧客户端（`deepseek/deepseek-v4-flash` 等）恢复可转发。
- 新客户端若已经发布，仍发送 `qwen3.7-plus` 等三个新 id，对回滚后的中继是 **403** `model_not_allowed`。只改 `UPSTREAM` 滚不回已经发出去的客户端。要让新客户端在 OpenRouter 上通过，还得把 `GRANT_MODELS` 改成客户端正在发送的 id，并且 OpenRouter 接受这些 id。后半句官方文档本清单没有查到对应页面，**待确认**。在确认之前，回滚手段是：客户端尚未发布，或停止发放这份客户端。
- 中国 SCF 那份部署的 `UPSTREAM=dashscope` 不在这个开关里。回滚国际版不要去改它。

记账连续：`bt_grant_charge` 仍更新同一行 `bt_grants.spent_usd`，并往同一张 `bt_grant_usage` 追加行。开关打开期间已经记下的 `spent_usd` 还在，回滚不把它们清掉，也不新开一张额度。回滚之后的新行用 OpenRouter 的计价（`usage.cost` 那三级）。`charged = 0` 的请求（例如国际转写缺 `usage.seconds`）本来就没有 usage 行，回滚补不回这几笔。记账 RPC 失败时响应已经返回，那一笔同样不在表里（开关前后都是这个行为）。

## 6. 账号与密钥

QwenCloud 控制台（2026-10-15）：

- [Billing overview](https://docs.qwencloud.com/resources/billing-overview)：按量超出免费额度之前要补齐付款信息。有欠款时在 Total Due 里支付。
- [Billing and cost management](https://docs.qwencloud.com/resources/bill-query)：按量页 Limit 旁打开每月花费上限，设置告警百分比和接收邮件。该页写告警通常在 15 分钟内发出。上限的具体美元数本清单不代填。
- [Free quota](https://docs.qwencloud.com/resources/free-quota)：若打开 “Free quota only”，免费额度用完后调用被拦（`AllocationQuota.FreeTierOnly`）。这条国际中继要的是按量，这一档要关掉。

测试期间贴过聊天的那把 QwenCloud Key 必须重置。重置由用户做。新 Key 由用户写进 `~/mobiletranslator/.local/keys.md` 的 `key_chat_qwencloud_global` 行，再由操作者更新线上密钥 `QWENCLOUD_KEY`。不要把 Key 写进这个文件、提交、issue 或命令行。本清单没有读过那一行。

## 7. 上线后 7 天

账本没有正文，也没有「空正文」列。空正文和播放失败要靠测试令牌自己的客户端读响应；生产用户的正文不能从数据库里查。比例阈值待用户定（第 4 节）。在定下来之前，7 天里沿用「出现即停」：停在当前灰度范围，按第 5 节去掉 `UPSTREAM`，不发下一档客户端，不改单价常量，不把这些失败记成用户的 402。

| 检查 | 看哪里 | 超标时 |
|---|---|---|
| 成本 | `bt_grant_usage.cost_usd` 按 `model` 加总。国际聊天抽查是否符合 $0.40 / $1.60。国际朗读是否符合 `characters × 0.1 / 10000`。国际转写是否符合 `seconds × 0.000035`。同一令牌的 `bt_grants.spent_usd` 不超过其 `limit_usd`（允许规则 9 已写明的「最后一次略超几分钱」） | 公式对不上或地板价成片出现：停止扩大，关掉开关 |
| 429 | 日志 `upstream_rate_limited` 的次数，对照同一时段该哈希的请求次数。自己的 `busy` 分开计 | 出现上游 429：停止扩大，关掉开关 |
| 空正文 | 测试令牌的聊天响应。usage 表看不出 | 测试请求正文为空：停止扩大，关掉开关 |
| 转写失败 | 日志 `bad_asr_body`、`usage_missing`、413 `audio_too_large`、400 `timestamps_unsupported`（后者在要字幕的请求上是预期）。说题成功应有 `kind=stt` 且 `cost_usd > 0` | 说题路径出现 `bad_asr_body` 或成片 `usage_missing`：停止扩大，关掉开关 |
| 朗读 URL 拉取失败 | 日志 `audio_fetch` 或 `audio_url`。成功应有 `kind=tts` 且客户端播得出声音 | 出现 `audio_fetch`：停止扩大，关掉开关。签名 URL 不要从日志里抄 |

## 8. 实现时列出的 7 项

| # | 事项 | 状态 |
|---|---|---|
| 1 | 线上断句要不要设 `temperature`。三遍全同 17/20，此前 11/20；分段错误和翻译均分没有改善 | **待用户定。** 中继不写 `temperature`。客户端没改 |
| 2 | 中国 IP 的朗读 / 转写模型 id；聊天缺省 `qwen-plus` | 聊天 **已定**：`qwen-plus`（第 2 节的北京文档）。朗读、转写 **待确认** |
| 3 | 客户端与中继一起发布，否则 403 | **已定。** 顺序是第 1 节：先中继和开关，再客户端 |
| 4 | 打开开关前运行时必须读得到 `cn-cidrs.txt` | **待确认**（第 3 节）。另外：Supabase 请求上有没有 `X-Real-IP` 也是 **待确认** |
| 5 | 国际转写缺 `usage.seconds` 时记 0，不用字节估算 | **已定**（代码已这样写）。本清单不改。这笔不出现在 `bt_grant_usage` |
| 6 | 「560 页 / $0.2」按新单价重算 | **已重算**，写在 `docs/learning-design.md` §8.10「2026-10-15 重算」。输入/输出拆分原文没有，所以给出 1250 页和 312 页两端，拆分本身仍 **待确认** |
| 7 | 部署和推送等用户说再做 | **已定。** 本清单不执行 |

## 所依据的规约

- BAN-39（`docs/conventions-digest.md`，来源 `AGENTS.md`）：第三方字段、部署打包、环境变量和模型 id，先查该服务自己的文档，依据贴在 issue，对不上就写待确认。
- `docs/learning-design.md` §8.10：中继契约与规则 9「估算写在花钱之前」。页数估算在同一份提交里更新。
- 并行 session：只改 `mobiletranslator-592` 这一个工作树。没有碰 `main`，没有碰 `release/1.19.0`。
- 本次范围是文档。没有部署，没有对线上跑 `npm run grant:status` 或其他命令，没有读密钥。
