# 2026-10-16 QwenCloud 上线顺序（只写不做）

核对日：2026-10-16。工作树 `mobiletranslator-592`，分支 `cursor/feat-592-unified-subs`。

这一份不部署函数，不改线上环境变量，不打开 `UPSTREAM=qwencloud`，不改客户端，不打包，不读密钥，不改 `bt-relay`。QwenCloud 的 Key 这一步用不到，没有读 `~/mobiletranslator/.local/keys.md`。

用户 2026-10-16 裁定：Supabase 中继（`bt-relay`）打开 `UPSTREAM=qwencloud` 之后，所有 IP 的聊天、朗读、转写都走 QwenCloud 国际。不再区分大陆 IP，不再读 `cn-cidrs.txt`，也不再用 `x-real-ip` 判断。国内中继（`UPSTREAM=dashscope`）和中国版 App 不变。

要删的行、删完之后三类请求的路径、`docs/relay-client-ip-proposal.md` 是否作废，写在 [#592](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592)。本文件只改上线顺序。仓库里的 `supabase/functions/bt-relay/index.ts` 仍按 IP 分叉（第 160–174 行读段表，第 341 行读 `x-real-ip`）。表里第 5–7 步写的是删完分叉之后的行为，不是现在这份源码打开开关之后的行为。

## 1. 三项待确认

先前记过的「未找到」和「大陆朗读、转写沿用 dashscope、不填 `GRANT_MODELS.tts` / `stt`」都不再作为这三项的结论。Supabase 这份中继不再按大陆 IP 分叉，那三件事没有要确认的对象。

### 1.1 托管函数上，客户端真实 IP 该读哪个头

**用户裁定不再区分大陆 IP，不需要。**

### 1.2 `cn-cidrs.txt` 会不会随函数一起发布

**用户裁定不再区分大陆 IP，不需要。**

### 1.3 大陆 IP 的朗读和转写

**用户裁定不再区分大陆 IP，不需要。**

## 2. 需要用户同意的顺序

10 步。本次一步都不执行。每一步线上操作仍需用户单独同意。从表里拿掉的只有 IP、段表、以及 `GRANT_MODELS` 的大陆分支（不填 `tts` / `stt`、大陆 503、空 `X-Real-IP` 当非中国）。依据是上面的裁定。`GRANT_MODELS` 本身留下：开关关闭、名单外、以及国内那份 `UPSTREAM=dashscope` 仍用它钉模型。

中国机上那份 `UPSTREAM=dashscope` 不在这个开关里，不在表里。中国版 App 不在表里。

哈希算法沿用清单第 4 节：去掉 `Bearer ` 前缀、trim，再 SHA-256，小写十六进制，无分隔符，名单里写全长 64 位。令牌明文不转小写，不写进文档、issue、日志或响应。日志只留哈希前 8 位。

`QWENCLOUD_ALLOW_TOKEN_HASHES` 未设置等于全量。设成空串是空名单，全部走旧路径，不要当成没设。灰度必须设置，不能靠不设这个变量。

Key 的规则：只在真正设密的那一步，从 `~/mobiletranslator/.local/keys.md` 的 `key_chat_qwencloud_global` 那一行读入环境变量。不打印，不写日志，不进命令行参数，不读别的行。官方 `supabase secrets set`（https://supabase.com/docs/reference/cli/supabase-secrets-set ，2026-10-16）的位置参数是 `NAME=VALUE`，另有 `--env-file` 从文件读。两处都不是「只从那一行进环境变量、不落盘、不进 argv」。本方案不写一条可执行的设密命令。

| # | 做什么 | 线上对象 | 回滚 | 回滚怎么做 | 验证 |
|---|---|---|---|---|---|
| 1 | 用户重置测试期间用过的 QwenCloud Key，把新值写入 `key_chat_qwencloud_global` 那一行 | QwenCloud 账号上的 Key；本机 `keys.md` 的那一行。不进仓库 | 能再重置一把新的。旧值作废之后不能用旧值退回 | 用户在 QwenCloud 控制台再重置，并改那一行。不把值贴到 issue | 这一步不读那一行，也不调用上游 |
| 2 | 把那一行设成线上 `QWENCLOUD_KEY`。开关仍关。值不进 argv、不进仓库、不进 issue | 托管项目的 secret `QWENCLOUD_KEY` | 能覆盖或卸掉。清单写：开关关闭时不读它 | `supabase secrets unset QWENCLOUD_KEY`，或再用一把新 Key 覆盖。具体设进去的命令本方案没有 | 不打印 secret。`supabase secrets list` 只看名字在不在，不看值 |
| 3 | 设 `QWENCLOUD_ALLOW_TOKEN_HASHES` 为**一个**测试令牌的 64 位小写哈希。先于开关 | 同一个项目的 secret `QWENCLOUD_ALLOW_TOKEN_HASHES` | 能 | 设成空串：空名单，走旧路径。不要用「删掉变量」当回滚，删掉等于全量 | 开关仍关时，旧客户端行为与现在相同。名单内容不出现在响应里 |
| 4 | 部署已经删掉 IP 分叉的 `bt-relay`。`supabase functions deploy bt-relay --no-verify-jwt`。不带 `--prune`。不改 `UPSTREAM`。不改 `GRANT_MODELS` 里现在的旧 id。现在仓库里的源码还没删分叉，不能拿它当这一步的包 | 托管函数 `bt-relay` | 开关未开时，清单写请求体和状态码与现在相同。清单没有写「把函数二进制换回上一版」的命令 | 运行时回滚见第 5 步。要换回旧代码，得另一次部署旧包，那次部署不在本表里 | 开关未开：旧模型名的聊天仍转发 |
| 5 | 设 `UPSTREAM=qwencloud`。第 3 步的名单必须已经是「已设置」。第 4 步的包必须已经是删完分叉的那一版 | secret `UPSTREAM` | 能，且不必为了这一下再部署 | 去掉 `UPSTREAM`，或设成 `openrouter`。清单第 5 节：环境变量立即生效。请求回到 OpenRouter，模型钉回 `GRANT_MODELS` 的旧 id。已经发出去的新客户端仍会 403，只改 `UPSTREAM` 滚不回客户端 | 名单内、聊天：`bt_grant_usage.model` 为 `qwen3.7-plus`。不看 IP。名单外仍走旧路径 |
| 6 | 同一个测试令牌只测聊天 | 已部署的 `bt-relay`；表 `bt_grant_usage`；函数日志 | 能 | 同第 5 步，停在当前名单，不发客户端 | 清单第 4 节的通过标准：至少一行 `kind=chat`，`model=qwen3.7-plus`；抽一行 `cost_usd` 等于 `prompt_tokens/1e6×0.40 + completion_tokens/1e6×1.60`（两个字段都缺才是 `chatFloor`）。日志没有 `upstream_billing`、`upstream_rate_limited`、`grant_misconfigured`。正文非空。连续多行都是地板价 0.0005：停 |
| 7 | 同一令牌再测朗读和说题转写。不按 IP 分 | 同上 | 能 | 同第 5 步 | `kind=tts` 且 `model=qwen3-tts-flash`，字节能当音频播；`kind=stt` 且 `model=qwen3-asr-flash`，`text` 非空，`cost_usd > 0`。要时间戳的转写通过标准是 400 `timestamps_unsupported`。出现 `audio_fetch` 或 `bad_asr_body`：停 |
| 8 | 通过第 6、7 步之后，再往名单里加下一个令牌的哈希。每加一次都重对通过 / 停止标准 | secret `QWENCLOUD_ALLOW_TOKEN_HASHES` | 能 | 从变量里拿掉刚加上的那一段哈希，保留已经通过的那些。不要把整个变量删掉 | 新哈希重复第 6、7 步。名单外的新模型名 403 `model_not_allowed` 是预期 |
| 9 | 第 6–8 步的读数过了，再发带 `qwen3.7-plus` / `qwen3-tts-flash` / `qwen3-asr-flash` 的客户端。本次不打包 | 客户端发行物。中继已经在线上 | 客户端一旦发出，只改 `UPSTREAM` 滚不回 | 客户端还没发：做第 5 步的回滚即可。已经发出：停止发放；清单写 OpenRouter 是否接受这三个 id 仍待确认，确认之前不靠改 `GRANT_MODELS` 去接新客户端 | 旧中继（开关关）对新模型名是 403。开关开且哈希在名单内才接受新名字 |
| 10 | 上线后 7 天沿用「出现即停」 | `bt_grant_usage` 与函数日志。不从库里读正文 | 能 | 停在当前灰度范围，按第 5 步去掉 `UPSTREAM`。不发下一档客户端，不改单价常量，不把这些失败记成用户的 402。已经记下的 `spent_usd` 不清 | 清单第 7 节那张表：成本公式、上游 429、测试令牌的空正文、`bad_asr_body` / 成片 `usage_missing`、`audio_fetch`。比例阈值清单写明待用户定；定下来之前用「出现即停」 |

停止条件（任一条就停在当前范围，做第 5 步的回滚，不发客户端）：缺 `QWENCLOUD_KEY` 时的 `grant_misconfigured`（日志 `no_key`）、`upstream_billing`、`upstream_rate_limited`、朗读 `audio_fetch`、转写 `bad_asr_body`、`model` 列不是这一档钉死的国际名字（`qwen3.7-plus` / `qwen3-tts-flash` / `qwen3-asr-flash`）。

段表读失败、大陆模型没配，不再列入停止条件。这两条是 IP 分叉里的 503，裁定之后不在这份顺序里。

## 3. 这一步没有做的

- 没有部署，没有 `supabase secrets set`，没有改 `UPSTREAM`。
- 没有改 `bt-relay`，没有删 `isChina`、段表加载、`x-real-ip` 读取或大陆分支。
- 没有读 `key_chat_qwencloud_global`。
- 没有改客户端，没有打包。
- 没有删 `docs/relay-client-ip-proposal.md`。作废范围写在 #592。
