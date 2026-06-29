# 订阅 OAuth 认证设计（评审稿）

> 状态：草案 / 待评审。基于对本机 openclaw 源码的逐字提取（流程为逆向、非官方）。
> 范围（已定）：OAuth 作为 API key 之外的**可选**认证模式；先 Chrome 桌面；OpenAI(Codex) + Claude 一起设计。Safari iOS 的回调单独评估，本期不做。

## 1. 两套真实流程（提取自 openclaw，含出处）

| 项 | OpenAI（ChatGPT/Codex） | Claude（Pro/Max） |
|---|---|---|
| authorize | `https://auth.openai.com/oauth/authorize` | `https://claude.ai/oauth/authorize` |
| token | `https://auth.openai.com/oauth/token` | `https://platform.claude.com/v1/oauth/token` |
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann` | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| scopes | `openid profile email offline_access` | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |
| redirect_uri | `http://localhost:1455/auth/callback` | `http://localhost:53692/callback` |
| PKCE | S256（WebCrypto） | S256（WebCrypto） |
| 额外授权参数 | `response_type=code`,`state`,`id_token_add_organizations=true`,`codex_cli_simplified_flow=true`,`originator` | `code=true`,`response_type=code`,`state` |
| token 交换 | form-urlencoded，`grant_type=authorization_code`,`client_id`,`code`,`code_verifier`,`redirect_uri` | **JSON**，同字段 + `state` |
| token 响应 | `access_token`,`refresh_token`,`expires_in`；**account_id 从 access_token JWT 解出**（claim `https://api.openai.com/auth`.`chatgpt_account_id`） | `access_token`,`refresh_token`,`expires_in`（无 account_id） |
| 刷新 | POST token，form，`grant_type=refresh_token`+`refresh_token`+`client_id` | POST token，**JSON**，同上 |
| 调模型 URL | `POST https://chatgpt.com/backend-api/codex/responses`（Responses API，SSE 流） | `POST https://api.anthropic.com/v1/messages`（流式） |
| 调模型必带头 | `Authorization: Bearer`,`chatgpt-account-id`,`originator`,`OpenAI-Beta: responses=experimental`,`accept: text/event-stream` | `Authorization: Bearer`（不是 x-api-key）,`anthropic-beta: claude-code-20250219,oauth-2025-04-20`,`anthropic-dangerous-direct-browser-access: true`,`anthropic-version`,`x-app: cli` |
| 请求体特殊点 | Responses 格式：`{model,instructions,input,stream:true,...}` | system **第一块强制** `"You are Claude Code, Anthropic's official CLI for Claude."`，再接我们的翻译 system；OAuth token 特征含 `sk-ant-oat` |

## 2. MV3 架构（关键决策）

### 2.1 登录回调的捕获 —— 最大的工程难点
openclaw 在 `localhost:1455/53692` 起一个 **node 本地 HTTP server** 收回调。**扩展里不能起服务器，也不能用 `chrome.identity.launchWebAuthFlow`**——因为后者要求 redirect_uri 是 `https://<extension-id>.chromiumapp.org/`，而这两个 OAuth client 只认死的 loopback redirect_uri（我们改不了，不是我们的 client）。

**方案**：后台 service worker
1. 生成 PKCE(verifier/challenge) + state（WebCrypto，`crypto.subtle`/`getRandomValues`，可直接移植）。
2. `chrome.tabs.create` 打开 authorize URL（带 loopback redirect_uri）。
3. 用 **`chrome.webNavigation.onBeforeNavigate`** 监听该 tab 跳转到 `http://localhost:<port>/...callback?code=...&state=...`——虽然 localhost 没人监听会加载失败，但跳转事件**在加载失败前就带着 code 触发**，我们从 URL 取 `code`+`state`，校验 state，关掉 tab。
4. **兜底**：手动粘贴回调 URL（openclaw 也保留了这个）。
5. 用 code 调 token 端点换 token（host_permissions `<all_urls>` 已覆盖，content/background fetch 不受 CORS 限制）。

### 2.2 token 存储与刷新
- 存 `chrome.storage.local`：`oauthTokens.{openai|claude} = {access_token, refresh_token, expires_at, account_id?}`。
- 刷新在**后台**集中做：调用前检查 `expires_at`，过期则用 refresh_token 换新。

### 2.3 调模型放哪
- 现有翻译 fetch 在 **content script**（为避开 Safari SW bug）。保持不变。
- content script 每次取 storage 里的 access_token；遇 401 时给后台发消息触发刷新再重试。OAuth 生命周期（登录/刷新）在后台，模型 fetch 仍在 content script。

### 2.4 Provider 认证抽象
- 设置新增 per-provider：`openaiAuthMode: 'apikey'|'oauth'`、`claudeAuthMode: 'apikey'|'oauth'`。
- `translateOpenAI`/`translateClaude` 按 authMode 分支：
  - `apikey` → 现有路径（`api.openai.com` / `api.anthropic.com` + key），**完全不动**。
  - `oauth` → 订阅路径（上表的 URL/头/体）。
- **不影响** Google/DeepSeek/GLM 与现有 key 流程。

### 2.5 响应解析差异
- Codex Responses 是 **SSE 流** → 要消费流、累积 `output_text`（比现在的 JSON 解析复杂）。
- Claude messages 可尝试 `stream:false` 拿简单 JSON（CLI 默认流式，但非流式大概率也接受——待验证）。
- Claude OAuth 必须带上"强制的 Claude Code system 第一块"，否则订阅鉴权不放行——意味着我们的翻译请求会携带 Claude Code 身份（如实记录这个怪点）。

### 2.6 权限
manifest 增加 `webNavigation`（回调拦截）。`storage`、`host_permissions:<all_urls>` 已有，覆盖所有端点。

## 3. 必须正视的两个可行性风险（诚实）

1. **ChatGPT 后端可能拦浏览器请求** ⚠️ 高风险
   - 调模型走的是 `chatgpt.com/backend-api/...`（ChatGPT 网页后端），可能有 Cloudflare/bot 防护。
   - `fetch` **不能设 `User-Agent`**（浏览器禁止改），而 CLI 是带 `User-Agent: codex/openclaw` 的；后端若按 UA 或浏览器特征拦截，扩展里就调不通。
   - → **OpenAI OAuth 能否在扩展里跑通，必须先做一个 spike 验证，不能假定能成。**

2. **Claude 相对可行** ✅ 较稳
   - 它的头里有 `anthropic-dangerous-direct-browser-access: true`——这正是 Anthropic 为**浏览器直连**开的口子，浏览器 UA 可接受。
   - 所以 Claude OAuth 在扩展里成功概率明显更高。

3. **通用**：逆向非官方流程，用的是 CLI 的 client_id——可能违反 ToS、端点/客户端会变、有账号被风控风险。功能要标注「实验性」。

## 4. 建议的分期实施

- **Phase 0 — Spike（先验证可行性，最重要）**：用脚本/扩展各发一次真实 OAuth 调模型请求，确认两个后端到底**接不接受浏览器来源 + 缺 User-Agent** 的请求。结果决定后面做不做 OpenAI。
- **Phase 1 — Claude OAuth**（成功率高，先做）：登录回调拦截 + token 存储/刷新 + messages OAuth 路径 + 设置页登录按钮。
- **Phase 2 — OpenAI OAuth**（仅当 Phase 0 通过）：Responses SSE 解析 + 同套流程。
- **Phase 3 — 设置页 UI**：每个 provider 的「API key / 订阅登录」切换 + 登录状态显示。

## 5. 待你决策

1. **先做 Spike**（我先只验证两个后端接不接受扩展请求，不写正式功能）——同意吗？这能避免在可能根本走不通的 OpenAI 上白费功夫。
2. OpenAI 若 spike 不通过，**只做 Claude OAuth** 可接受吗？
3. Claude 那条"强制携带 Claude Code 身份 system 块"——可接受吗（不接受就只能用 API key 模式）。
4. 这些只在 Chrome 做；Safari iOS 仍只用 API key——确认。
