# N25 宿主包装 · Claude Code、Codex、dsh

- 轨：marketing **1.22.0**（`serverInfo.version` = `1.22.0-n25`）。不改 `package.json` 的现行版本号。
- 内核：W2 stdio MCP，`agent/mcp-stdio.js`。本目录只有包装。
- 工具名：与 `agent/contract.js` 的七个动作 ID 逐字相同，含 `ready.check`。没有第二份公开名字。

Local stdio is the daily server. Remote MCP is later. A remote MCP is not published. 不要把本进程说成已上架云 MCP。Remote 若以后做，必须复用同一份 tool schema。

宿主可用自有订阅或 API Key · 大肚猴额度不是唯一路径。宿主订阅或宿主 API Key 就能跑这些工具。大肚猴额度是可选的备用，不是唯一条件。

| 宿主 | 订阅（任一非空即可） | API Key（任一非空即可） |
| --- | --- | --- |
| Claude Code | `ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN` | `ANTHROPIC_API_KEY` |
| Codex | `OPENAI_ACCESS_TOKEN`、`CODEX_ACCESS_TOKEN` | `OPENAI_API_KEY`、`CODEX_API_KEY` |
| dsh | `DEEPSEEK_AUTH_TOKEN` | `DEEPSEEK_API_KEY` |

宿主 API Key 会按注册表向提供方发请求。用量记在配额观测里，不进回执，回执也不带变量的值。宿主订阅令牌走同一条请求。提供方不肯为这枚令牌代付时，回执码是 `subscription_cannot_pay`（用户看见的卡仍是 `grant_or_key_unavailable`）。这条失败不会改走大肚猴额度假装成功。环境变量非空本身不是成功，也不是额度。`capture_to_study` 不走这条传输，不会把句子发给提供方。`start_live_subtitles` 的计费不在这条线上。

`grant_or_key_unavailable` 的主按钮是「去配置引擎与密钥」，脚注是「亦可在宿主配置自有 Key 或订阅」。

本包装不包含 Grok 或 Muse 的本地插件。

## 三个宿主怎么接到同一个进程

| 宿主 | 配置 | 启动的文件 |
| --- | --- | --- |
| Claude Code | `agent/hosts/claude-code/.mcp.json` | `${CLAUDE_PLUGIN_ROOT}/stdio.js` |
| Codex | `.codex/config.toml` 的 `[mcp_servers.belliedmonkey]` | `agent/hosts/claude-code/stdio.js` |
| dsh | `agent/hosts/dsh/cordis.patch.yml` 的 `mcp-belliedmonkey` | `agent/hosts/dsh/stdio.js` |

`agent/hosts/claude-code/stdio.js` 与 `agent/hosts/dsh/stdio.js` 都只加载 `agent/mcp-stdio.js`。它们不声明工具。

仓库根上的 `.mcp.json` 是开发宿主的服务器列表（验证驱动等）。不要把 `belliedmonkey` 写进那份文件，也不要在本仓库里执行 `claude mcp add --scope project`。

## Claude Code

在仓库根：

```bash
claude --plugin-dir "$PWD/agent/hosts/claude-code"
```

插件带上 skill `skills/belliedmonkey/SKILL.md` 和上面的 `.mcp.json`。启用后服务器名是 `belliedmonkey`。

不装插件、只挂服务器时，用用户级配置（`$PWD` 会展开成绝对路径）：

```bash
claude mcp add --transport stdio --scope user belliedmonkey -- node "$PWD/agent/hosts/claude-code/stdio.js"
```

## Codex

项目配置已经在 `.codex/config.toml`。在仓库根打开 Codex，并信任这个项目后，它会启动同一个 launcher。

等价的用户级命令（写进本机 `~/.codex/config.toml`，不要把绝对路径提交回来）：

```bash
codex mcp add belliedmonkey -- node "$PWD/agent/hosts/claude-code/stdio.js"
```

然后 `codex mcp list`。看服务器名 `belliedmonkey`，命令是 `node`，参数指向 `stdio.js`。不要加 `--url`。

## dsh

包装在 `agent/hosts/dsh/`。日用是本机 stdio。Remote 未发布。没有 H3，也没有 Grok 或 Muse 的本地插件。

在仓库根把 plugin 装进 profile：

```bash
dsh plugin --profile <profile> add "$PWD/agent/hosts/dsh"
```

不装 plugin、只挂一次时，从仓库根：

```bash
dsh --profile <profile> --patch "$PWD/agent/hosts/dsh/repo-mcp.patch.yml"
```

`stdio.js` 只加载 `agent/mcp-stdio.js`。dsh 的函数名不允许点号，所以模型看见的 `ready.check` 映射是 `mcp__belliedmonkey__ready_check_bc683c60f54e`。这是宿主注解。没有第二份名字 `ready_check`。线协议名仍是 `ready.check`。细节在 `agent/hosts/dsh/README.md`。

## 七个工具

`ready.check` · `open_setup` · `start_live_subtitles` · `translate_page` · `translate_video_captions` · `capture_to_study` · `explain_or_drill`

敏感工具先在本机确认。回执是 JSON，不是一条深链。细节在 W2 规格 `architecture/SPEC-AGENT-W2-MCP-IMPL-2026-10-26.md` 和 skill 里。确认卡 / 失败卡文案以 `agent/copy.js` 的锁文为准。
