# dsh · 本机 stdio

Local stdio is the daily server. Remote MCP is later. A remote MCP is not published. 不要把本进程说成已上架云 MCP。

宿主可用自有订阅或 API Key · 大肚猴额度不是唯一路径。dsh 用 `DEEPSEEK_AUTH_TOKEN`（订阅）或 `DEEPSEEK_API_KEY`。API Key 会打到提供方并留下用量观测。订阅令牌走同一条请求；提供方不肯代付时回执是 `subscription_cannot_pay`，不会改走大肚猴额度假装成功。环境变量非空本身不是成功，也不是额度。

本目录是 dsh 的 plugin 包装。`stdio.js` 只加载 W2 内核 `agent/mcp-stdio.js`。工具的线协议名与内核的七个动作 ID 相同，含 `ready.check`。没有第二份名字 `ready_check`。本包装没有 Remote 地址，没有 H3，也没有 Grok 或 Muse 的本地插件。

dsh 的函数名只允许 `[A-Za-z0-9_-]`。六个没有点号的工具，模型看见的名字是 `mcp__belliedmonkey__` 加上动作 ID。`ready.check` 的模型侧映射是 `mcp__belliedmonkey__ready_check_bc683c60f54e`（SHA-256(`belliedmonkey` + NUL + `ready.check`) 的前 12 位十六进制）。这是宿主映射注解。`tools/call` 收到的仍是 `ready.check`。

不要把 `belliedmonkey` 写进仓库根的 `.mcp.json`。不要执行 `dsh plugin add @deepseek-ai/dsh-mcp-client`：那个客户端已经随 dsh 自带，单独再装会落到旧的 dist-tag。

## 装成 bundle

在仓库根，把本目录装进要用的 profile（`<profile>` 换成 `web` 或其他已有 profile）：

```bash
dsh plugin --profile <profile> add "$PWD/agent/hosts/dsh"
```

装好后重启该 profile。`package.json` 的 `dsh.bundle` 会带上 `cordis.patch.yml`。那一层先加载本目录的 `index.js`（只记下 `stdio.js` 的绝对路径，不注册工具），再让 `@deepseek-ai/dsh-mcp-client` 用 `node` 启动那个文件。`transport` 是 `stdio`。不要加 `url`。

`dsh --profile <profile> --dump-config` 里应能看到 `belliedmonkey-dsh` 和 `mcp-belliedmonkey`。`serverName` 是 `belliedmonkey`。

## 不装 bundle，只挂一次

从仓库根启动，让相对路径 `agent/hosts/dsh/stdio.js` 对得上：

```bash
dsh --profile <profile> --patch "$PWD/agent/hosts/dsh/repo-mcp.patch.yml"
```

要写进 profile 自己的 `cordis.patch.yml` 时，用同一段 `insert`。文件若是 `[]`，用这段替换 `[]`。不要把段落接在 `[]` 下面。绝对路径留在本机那份文件里，不要提交回来。

## Skill

dsh 从 `$DSH_HOME/skills` 读用户 skill（未设置 `DSH_HOME` 时是 `~/.dsh/skills`）。本仓库不放置 `.agents/skills`，也不把这份产品 skill 放进 `.claude/skills`。

```bash
mkdir -p "${DSH_HOME:-$HOME/.dsh}/skills"
ln -sfn "$PWD/agent/hosts/dsh/skills/belliedmonkey" "${DSH_HOME:-$HOME/.dsh}/skills/belliedmonkey"
```

## 冒烟

`node agent/hosts/dsh/stdio.js` 走 MCP `initialize` 与 `tools/list`，七个工具名与 `agent/contract.js` 的动作 ID 逐字相同。`test/agent-h2.test.js` 用这个入口对照 W2 内核。它不驱动 App，也不驱动浏览器扩展。dsh → App / 扩展的端到端留给 QD，标 OPEN。

`ready.check` · `open_setup` · `start_live_subtitles` · `translate_page` · `translate_video_captions` · `capture_to_study` · `explain_or_drill`

Empty text on translate_page and translate_video_captions is a billing probe; with text it is host page MT. Probe success is not a full page done.
