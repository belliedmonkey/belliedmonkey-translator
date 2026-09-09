# 用「订阅」而不是 API key 来翻译 —— 调研记录（2026-09-09）

> 状态：**调研完成，等产品裁定**。触发来源：外部 issue **#149** 与它的领域设计 PR **#150**
> （外部贡献者 `Speechlessmanbilibili`，2026-08-17 提出，我们 22 天没回）。
> 后续用户追问扩到了整个「Coding Plan」族（GLM / Qwen / Kimi）。
>
> **这份文档只回答「能不能」，不回答「做不做」。** 做不做是产品裁定。
>
> 前身：`docs/oauth-design.md`（2026-06-28）。那份文档因为只以 `chore` 提交、没有被任何
> 地方引用，两个半月后被完全遗忘，导致一位外部贡献者独立把同样的活重做了一遍。
> **这份文档存在的第一个理由，就是不要再发生一次。**

## 结论速览

| 路线 | 认证方式 | 结论 | 依据 |
|---|---|---|---|
| ChatGPT / Codex 订阅（#149 提议） | OAuth（非官方） | **技术可行，但可行性来自三重冒充** | §1 |
| 官方「Sign in with ChatGPT」 | OAuth（官方） | **给不了模型用量**，只给身份 | §1.5 |
| 智谱 **GLM Coding Plan** | API key | **官方明文禁止**，且无准入通道 | §2.1 |
| 阿里云百炼 **Qwen Coding Plan** | API key | **官方明文禁止** | §2.2 |
| 月之暗面 **Kimi Code** | API key | **官方明文禁止** | §2.3 |
| **Claude 订阅（Pro / Max）** | OAuth | **未排除 —— 唯一一条不需要冒充的路，但许可状态未定** | **§4** |

⇒ 四条排除，**一条开着**。合规的默认仍然是按量计费的标准 API key，以及 1.9.0 上线的免费额度；
而 Claude 订阅那条**值得花一封信去问清楚**（§4.3）。

> **⚠️ 本节曾经写错过一次（2026-09-09 当天更正）。** 初稿写的是「今天没有任何一条路是被
> 允许的」，把 Anthropic 归进了「已关门」。产品方反问「OpenClaw 和 Hermes 都接了各家的
> OAuth，他们怎么没问题」，一查才发现**我的 Anthropic 信息停在 2026-04**，漏掉了后面两次
> 反转（§1.6）。**结论下得太绝对，是因为时间线只查到一半就停了。** 记在这里，因为下一个
> 读这份文档的人很可能也会想当然。

---

## §1 ChatGPT / Codex 订阅（#149）

全部结论来自逐字读 `openai/codex` 源码（Apache-2.0，可读）。**没有向任何 OpenAI 端点发过请求。**

### 1.1 一次模型请求必须带什么

| 头 | 值 / 来源 | 浏览器能设吗 |
|---|---|---|
| `Authorization` | `Bearer <access_token>` | ✅ |
| `ChatGPT-Account-ID` | 从 access_token 的 JWT claim 解出 | ✅ |
| `originator` | **默认 `codex_cli_rs`**（`codex-rs/login/src/auth/default_client.rs`，`DEFAULT_ORIGINATOR`） | ✅ |
| `OpenAI-Beta` | `responses=experimental` | ✅ |
| **`User-Agent`** | `codex_cli_rs/<版本> (<OS> <版本>; <架构>) <终端标识>`，例如 `codex_cli_rs/0.5.0 (Macos 15.5; arm64) iTerm2/3.5`（`get_codex_user_agent()`） | ❌ **fetch 的禁用头** |

同一个文件里的 `USER_AGENT_SUFFIX` 全局，注释说它用来「区分不同的 MCP 客户端」
⇒ **UA 在 OpenAI 那边是用来辨认客户端的**，不是装饰。

### 1.2 这推翻了 `docs/oauth-design.md` 的结论

那份文档判「高风险、必须先 spike」，依据是「浏览器 fetch 设不了 UA」——
**但它假设请求由浏览器发出**（它的范围是「先 Chrome 桌面」，模型 fetch 留在内容脚本）。

#149 的架构把模型请求放进 **iOS 宿主 App 的原生代码**，原生 `URLSession` 可以任意设 UA。
同理，「`redirect_uri` 只认死的 `http://localhost:1455/auth/callback`」这个死结在 iOS 上
也有解：App 自己起本地回环监听（`ASWebAuthenticationSession` + `NWListener`，
`n0an/VivaDicta` 的架构文档记录了这个做法）。

⇒ **杀死我们 6 月方案的技术障碍，在原生路线上不存在。#149 技术上比我们自己那版更可行。
那个 spike 不必再跑了 —— 它要回答的问题已经不是问题。**

### 1.3 但可行性恰恰来自「冒充 Codex CLI」，而且是三重的

1. 用 Codex 的 `client_id`（`app_EMoamEEZ73f0CkXaXp7hrann`，公开在
   `codex-rs/login/src/auth/manager.rs` 与 `codex-rs/tui/src/onboarding/auth.rs`）；
2. 发 `originator: codex_cli_rs`；
3. **主动把 `User-Agent` 伪造成 `codex_cli_rs/…`**。

第 3 条是性质分界线：**在浏览器里是「做不到」，在原生里是「我们选择这么做」。**
技术限制与刻意伪装是两件事，评审时不能混为一谈。

**「代码开源」不解决这个问题。** Apache-2.0 给的是**代码**的权利（读、改、再分发，须署名
并保留 NOTICE），§6 还明确**不授予商标权**；它管不了你能不能这样使用 OpenAI 的**服务** ——
那由用户条款管。而 `client_id` 是**标识那个客户端的凭证**，拿它去认证服务器换 token，
是身份问题，不是许可证问题。

### 1.4 device-code 那条路（#150 提议）应当直接排除 🚨

`codex-rs/login/src/device_code_auth.rs` 确实存在，用它绕开 localhost 回调的判断是对的。但：

- **不是 RFC 8628 标准设备流程**：没有 `device_authorization` 端点、没有 `verification_uri`
  字段、没有 `urn:ietf:params:oauth:grant-type:device_code`。是私有的
  `POST {issuer}/api/accounts/deviceauth/usercode` → 轮询 `/deviceauth/token`。
- 服务端把 **`code_verifier` 一起回给客户端**（`CodeSuccessResp`）。
- 验证页是 `{issuer}/codex/device`，一个 **Codex 品牌**页面。
- **最要命的**，Codex 打印给用户的原话（`device_code_prompt`）：

  > "Continue only if you started this login in Codex.
  > **If a website or another person gave you this code, cancel.**"

  而我们要做的正是「一个应用给用户一个代码，让他去那个页面输入」。
  **我们会让用户去做 OpenAI 明确叫他取消的那个动作。**

### 1.5 官方「Sign in with ChatGPT」给不了这件事

它是**身份提供方**：应用只拿到姓名、邮箱、头像，**不给模型用量**
（首批伙伴 Airtable / GitLab / HubSpot / Notion / Supabase / Vercel）。
官方 Apps SDK 则是「在 ChatGPT **里面**跑的应用」，对 Safari 扩展不适用。
⇒ **这条需求没有任何官方路径。**

### 1.6 同行先例：这扇门关过，又开了 —— 完整时间线

**不要只看到 04-04 就停下**（初稿就是这么错的）。Anthropic 对 Claude 订阅，2026 全年：

| 日期 | 发生了什么 |
|---|---|
| 01-09 | 服务端拦截，把订阅 OAuth 限制在官方 Claude Code |
| 02-19 | 写进消费者条款 |
| **04-04** | **执行 —— 任何第三方 harness 里的订阅令牌全部失效。** 约 13.5 万个 OpenClaw 实例受影响，部分用户成本涨到 50 倍 |
| 05-13 | 宣布改为独立计量的 **Agent SDK 额度**（Pro $20 / Max5x $100 / Max20x $200 / Team-Ent $100–200 每席，不滚存），06-15 生效，**明确允许 Conductor、OpenClaw 这类第三方应用经 Agent SDK 认证** |
| **06-15** | **Anthropic 把这个改动撤回了。** Agent SDK、`claude -p`、GitHub Actions 以及「**用你的订阅做认证的第三方应用**」继续照旧从订阅额度里走，没有额度可领；官方称正在重做方案，未来变更会提前通知 |

⇒ 门**关过一次，然后又开了**。今天（2026-09）第三方应用用 Claude 订阅认证是**在走的**，
而且 Anthropic 自己在撤回公告里把它当成一个正常存在的面来描述。

Google 对 Gemini CLI 有过类似动作。OpenAI 至今**未动手**，且贡献者引的上游讨论
（`openai/codex#24988`，专门问原生移动端认证）**零回复** —— 从没被官方回答过。

### 1.7 他给的三个开源项目

| 项目 | 许可证 | 规模 / 活跃 | 能不能用 |
|---|---|---|---|
| `atom2ueki/CodingPlanKit` | MIT | 3 star · 2026-07-06 后无更新 | 许可证上可抄，但太小太新、无维护，不该依赖 |
| `timazed/CodexKit` | **无许可证文件** | 30 star · 活跃 | **一行都不能抄**（无许可证 = 保留所有权利） |
| `n0an/VivaDicta` | MIT | 110 star · 活跃 | 是完整 App 不是库；有价值的是它的 OAuth 架构文档 |
| （源头）`openai/codex` | Apache-2.0 | 12.2 万 star | 代码可读可抄，但见 §1.3 |

---

## §2 Coding Plan 一族（GLM / Qwen / Kimi）

**动机**：这一族给的是 **API key**，不是 OAuth ⇒ 天然不碰冒充那一整套，而且
GLM / Qwen / Kimi **本来就在我们的注册表里**，差别只是端点换成 Anthropic 兼容那个。
我们的 `messages-compat` 传输发的正是 `x-api-key` + `anthropic-version` +
`anthropic-dangerous-direct-browser-access`（`extension/content/request-shape.js:424-427`），
形状是对的。**所以技术上几乎零成本 —— 卡住它的完全是条款。**

### 2.1 智谱 GLM Coding Plan —— 明文禁止

官方 FAQ（`docs.bigmodel.cn/cn/coding-plan/faq`）原文：

> 「GLM Coding Plan **仅限在官方支持的指定工具与产品环境中使用**」
>
> 「在除规定工具外调用 API，**不可享用 Coding 套餐的额度**。如需在**自建应用、网站、
> 机器人、SaaS 产品**等场景中通过 API 集成模型能力，请使用智谱提供的标准 API 服务」
>
> 「套餐为订阅人专享使用……若因账号共享导致多人共用同一套餐，我们可能会视为不当使用，
> 并在必要时对订阅权益做出相应限制，严重时或将影响账号正常使用」

⇒ 一个浏览器扩展做网页翻译，正是它点名排除的「自建应用、网站」。**出局。**

### 2.2 阿里云百炼 Qwen Coding Plan —— 明文禁止

官方文档（`help.aliyun.com/zh/model-studio/coding-plan`）原文：

> 「**仅限在编程工具**（如 Claude Code、Qoder、Qoder CN、OpenClaw 等）中使用」
>
> 「**禁止以 API 调用的形式用于自动化脚本、自定义应用程序后端或任何非交互式批量调用场景**」
>
> 违规后果：「订阅被暂停或 API Key 被封禁」

端点：OpenAI 兼容 `https://coding.dashscope.aliyuncs.com/v1`；
Anthropic 兼容 `https://coding.dashscope.aliyuncs.com/apps/anthropic`；key 形如 `sk-sp-xxxxx`。

⇒ 网页翻译是**逐段批量**调用，正落在「非交互式批量调用场景」里。**出局。**

### 2.3 月之暗面 Kimi Code —— 明文禁止，并且点名了 UA

> 「Kimi Code 订阅**仅限交互式使用**，支持主流编程工具与 Agent 框架
> （Kimi CLI、VS Code、Claude Code、OpenCode、OpenClaw 等）」
>
> 「该服务**仅限于在编程工具中使用，禁止以 API 调用的形式用于自动化脚本、自定义应用**等场景」
>
> 「使用时请**保持工具的真实身份标识，篡改客户端标识（User-Agent）将被视为违规**，
> 可能导致会员权益暂停」

⇒ **出局。** 并且注意最后一句：Kimi 把「伪造 User-Agent」直接写成违规行为 ——
而那恰恰是 §1.3 里 ChatGPT 路线**必须做**的第三件事。
**一家厂商已经把另一条路唯一的可行手段写成了违规。**

### 2.4 这一族的共同形状

三家措辞不同，禁的是同一件事：**订阅额度只在「人在编程工具里交互」时有效**。
它们卖的不是 token，是「一个开发者坐在编辑器前」这个场景。
一个后台逐段翻译网页的扩展，在这三家的定义里都是「自建应用 / 非交互式批量调用」。

**这不是灰色地带，是三份各自独立写下的明文。**

### 2.5 「可是 OpenClaw / Hermes 都接了，他们怎么没问题」

这是产品方 2026-09-09 的反问，值得单独写一条，因为它的答案不是「他们风险承受力高」。

**他们在名单上，我们不在。** 逐字对照：

- Qwen 官方文档：「仅限在编程工具（如 Claude Code、Qoder、Qoder CN、**OpenClaw** 等）中使用」
- Kimi：「支持主流编程工具与 Agent 框架（Kimi CLI、VS Code、Claude Code、OpenCode、**OpenClaw** 等）」
- GLM：官方适配 20+ 工具，有专门的接入文档页

OpenClaw 与 Hermes 是**被点名写进白名单的编程工具**。它们不是「用同样的手法没被抓」，
而是**获得了授权**。同样的 wire format，授权状态完全不同 —— 这是「我们照他们的方式接入」
不成立的地方。

**而且 GLM 那个工具接入页没有申请入口** —— 它是给已获批工具的配置参考，没有申请表、
没有联系方式、没有任何新工具的准入流程。对 GLM 来说不是「风险大」，是**没有门可敲**。

顺带两条：
- **OpenClaw 恰恰是「风险已经兑现」的案例**，不是安全的证据 —— 见 §1.6 的 04-04 那一行。
- **Hermes 自己也没有提供 Claude 订阅接入**：有一个还开着的 feature request
  （`NousResearch/hermes-agent#25267`），以及一篇标题就叫「Why We Don't Offer It」的说明。

### 2.6 后果的不对称（不是禁止的理由，是定价风险的理由）

OpenClaw 是用户自己装的 CLI，被切断时用户改个配置就行。我们是**过 Apple 审核、发到
36 个国家的签名二进制** —— 厂商翻个开关，功能对所有人同时失效，而我们连热修都要等一个
审核周期。这不构成「所以禁止」，但它意味着**同样的风险对我们更贵**，因此值得要求更高的
确定性再动手。

---

## §3 仓库这一侧（若某天条款变了，要跨的坎）

按当时的实测与规约记录，留档备查：

- **内容脚本没有 `sendNativeMessage`**（2026-08-07 实测，`docs/verification-spec.md` Stage 0）。
  #150 用「扩展页桥接」绕开，方向正确 —— 但同一次尖刺还测出
  **冷启动第一次调用必然失败**（`tiny ERR 289ms 未能与帮助应用程序通信`），
  **而翻译的第一段就是冷启动第一次调用**。#150 未提及。
- 扩展与宿主 App 是**两个进程**，凭证跨过去需要 App Group / Keychain access group —
  今天都没有，且 `verification-spec.md` 记着 App Group「**尚未验证**」。
- 后台执行窗口今天靠 `UIBackgroundModes: audio` 挣来，**没有 `fetch` / `processing`**。
- **中国合规门扫不到 `.swift`**（`build.js` 的 `complianceGateChina` 只扫
  `.js/.json/.html/.css/.txt`，也不扫 `safari-project-china/`）。任何原生提供方代码都要
  新建一道门，否则会重演 1.6.4「中国版 App 带着全球注册表出货」。
- 治理上两条要产品方裁定：`AGENTS.md` 规则 10「不做阉割版」（中国版必然缺席 ——
  可用「Google 在中国版缺席从不算阉割」类比辩护，但 #150 没做这个类比）；
  以及 `learning-design.md` §12 于 2026-09-08 刚重申的「订阅制仍否决」。

---

## §4 Claude 订阅 —— 唯一没被排除的一条

### 4.1 为什么它和 Codex 那条本质不同

**它不需要冒充任何人。** Anthropic **自己文档化了** `anthropic-dangerous-direct-browser-access`
这个头 —— 那正是它为「浏览器直连」开的官方口子，而我们的 `messages-compat` 传输
**本来就在发它**（`extension/content/request-shape.js:424-427`，同时发 `x-api-key` 与
`anthropic-version`）。没有伪造 User-Agent，没有借用别人的 `client_id`。

对照 §1.3：Codex 那条的可行性**建立在三重冒充上**；Claude 这条不需要其中任何一重。

### 4.2 现在的许可状态：**未定，而且我无法从一手来源确认**

- 消费者条款第 3 节的原文是：
  > "Except when you are accessing our Services **via an Anthropic API Key** or where we
  > **otherwise explicitly permit it**, [you may not] access the Services through automated
  > or non-human means, whether through a bot, script, or otherwise."

  「用 API key」是**明写的豁免口**；「或我们另行明确许可」是**第二个口子**。
- 而 §1.6 的 06-15 撤回公告里，Anthropic 把「**用你的订阅做认证的第三方应用**」当成一个
  **继续存在的正常面**来描述。
- **但我取到的条款页面日期是 2025-10-08**，反映不出 2026-02-19 那次更新（新闻报道说那次
  加了 OAuth 条款）。⇒ **「第 3 节的第二个口子今天覆不覆盖我们」这件事，靠读公开页面
  定不下来。**

**不要在这一点上猜。** 猜错的两个方向代价都很大：猜「不许」会白白丢掉唯一一条干净的路；
猜「许可」会把一个上架 App 建在一条随时可能被认定违规的链路上。

### 4.3 因此下一步是**写一封信**，不是写代码

问 Anthropic 三个具体问题（笼统地问「可以吗」只会拿到笼统的回答）：

1. 一个**非编程类的消费级应用**（浏览器翻译扩展），让用户用自己的 Claude Pro/Max 订阅
   通过 OAuth 认证并调用 Messages API —— 这**是否在**消费者条款第 3 节
   「otherwise explicitly permit」的范围内？
2. 若可以，是否有**注册/登记流程**，或对 `client_id`、`originator`、User-Agent 之类的
   客户端标识有要求？（我们不打算复用任何现有客户端的标识。）
3. 2026-06-15 撤回之后，「用订阅做认证的第三方应用」这条的**长期方向**是什么？
   会不会再回到 Agent SDK 独立额度那个方案？

**成本是一封信；收益是把这个功能从「不敢做」变成「能做/不能做」的确定答案。**
在拿到回复之前，不写任何相关代码。

---

## §5 下一步

1. **不基于 `timazed/CodexKit` 写任何代码**（无许可证）—— 与方向裁定无关，先钉死。
2. **device-code 路线排除**（§1.4）—— 同样与方向裁定无关。
3. **Coding Plan 一族排除**（§2）—— 三份官方明文，没有解释空间。
4. ChatGPT / Codex 订阅这一条：**技术可行性已经清楚，剩下的是「要不要三重冒充另一家
   公司的官方客户端」**。那是产品裁定，不是技术裁定。
5. 尚未做、也不建议在裁定前做的实测：拿真实 ChatGPT 账号登录一次、看后端接不接受一个
   非 Codex 的原生客户端。**即使它通过，要裁定的问题一个字都不会变。**
6. **Claude 订阅这一条：写信问 Anthropic（§4.3），这是本文档唯一一件建议现在就做的事。**
   它不需要冒充、我们的传输层本来就说这个协议，卡住的只是一个**能问清楚**的许可问题。

**#149 / #150 至今未回复**（用户 2026-09-09 裁定：先把技术调研做完再回）。
