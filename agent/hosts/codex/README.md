# Codex · 本机 stdio

Local stdio is the daily server. Remote MCP is later. A remote MCP is not published. 不要把本进程说成已上架云 MCP。

宿主可用自有订阅或 API Key · 大肚猴额度不是唯一路径。Codex 用 `OPENAI_ACCESS_TOKEN` 或 `CODEX_ACCESS_TOKEN`（订阅），或者 `OPENAI_API_KEY` 或 `CODEX_API_KEY`。API Key 会打到提供方并留下用量观测。订阅令牌走同一条请求；提供方不肯代付时回执是 `subscription_cannot_pay`，不会改走大肚猴额度假装成功。环境变量非空本身不是成功，也不是额度。

Codex 读仓库根的 `.codex/config.toml`。那张表的 `command` 是 `node`，`args` 是 `agent/hosts/claude-code/stdio.js`。该文件只加载 W2 内核 `agent/mcp-stdio.js`。工具名与内核的七个动作 ID 相同，含 `ready.check`。没有第二份名字 `ready_check`。

在仓库根、需要写进本机用户配置时：

```bash
codex mcp add belliedmonkey -- node "$PWD/agent/hosts/claude-code/stdio.js"
```

不要加 `--url`。本包装没有 Remote 地址，也没有 Grok 或 Muse 的本地插件。

`codex mcp list` 应看到服务器 `belliedmonkey`。

`ready.check` · `open_setup` · `start_live_subtitles` · `translate_page` · `translate_video_captions` · `capture_to_study` · `explain_or_drill`
