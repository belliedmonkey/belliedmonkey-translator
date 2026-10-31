---
name: belliedmonkey
description: Call BelliedMonkey Translator through the local stdio MCP server belliedmonkey on dsh. Tool names on the wire are the seven N25 action ids ready.check, open_setup, start_live_subtitles, translate_page, translate_video_captions, capture_to_study, and explain_or_drill. Use when the user wants a readiness check, setup, live bilingual subtitles, page translation, video captions, study capture, or an explanation. Local stdio is the daily server. A remote MCP is not published.
---

# BelliedMonkey Translator

Local stdio is the daily server. Remote MCP is later. A remote MCP is not published. 不要把本进程说成已上架云 MCP。 Do not tell the user that a cloud server is already on a store, and do not invent an endpoint URL.

宿主可用自有订阅或 API Key · 大肚猴额度不是唯一路径. A host API key (`DEEPSEEK_API_KEY`) calls the provider; usage is observed and is not placed on the receipt. A host subscription token (`DEEPSEEK_AUTH_TOKEN`) uses that same call. If the provider will not bill the token, the receipt code is `subscription_cannot_pay` and the Bellied Monkey grant is not a silent success. A non-empty OAuth variable alone is not a grant and is not success. Do not tell the user the tool succeeded when that code comes back. A host API key that the provider accepts does not require login.

The server name is `belliedmonkey`. dsh starts `stdio.js` in this directory through `@deepseek-ai/dsh-mcp-client`. That launcher only loads `agent/mcp-stdio.js`. It does not define a second tool list.

## Tools

Call these MCP tools by these exact wire names. There is no second contract.

- `ready.check`
- `open_setup`
- `start_live_subtitles`
- `translate_page`
- `translate_video_captions`
- `capture_to_study`
- `explain_or_drill`

Do not call `ready_check`. If a host cannot display a dot, map it only in that host's UI. Do not publish a second name.

dsh's function-name contract allows only `[A-Za-z0-9_-]`. The model sees `mcp__belliedmonkey__<wire name>`. These six have no dot, so the model-facing names are `mcp__belliedmonkey__open_setup`, `mcp__belliedmonkey__start_live_subtitles`, `mcp__belliedmonkey__translate_page`, `mcp__belliedmonkey__translate_video_captions`, `mcp__belliedmonkey__capture_to_study`, and `mcp__belliedmonkey__explain_or_drill`.

`ready.check` contains a dot. The model-facing name is `mcp__belliedmonkey__ready_check_bc683c60f54e`. The suffix is the first 12 hex characters of SHA-256 of `belliedmonkey`, a NUL byte, and `ready.check`. This is a host mapping annotation. `tools/call` still receives the wire name `ready.check`. Do not register a tool named `ready_check`.

Only the seven names above are tools. A tool result is receipt JSON in `content[0].text`. Do not replace that receipt with a `belliedmonkey://` string and call it done.

`ready.check` is not sensitive. `open_setup` is not side-effect sensitive, but an inbound open_setup (deeplink or MCP) still confirms on this machine before it opens a settings page — it never opens the microphone, reads the page, or writes the study library. The other five are sensitive. A sensitive tool confirms on this machine before any microphone, page read, or study-library write. Do not pass `confirmed`, `allow`, or `grant`. Those arguments are dropped and do not count as a yes.

The receipt has no page text, transcript, or translation. Do not ask the tool to return the sentence, and do not paste the user's API key into a tool argument.

Empty text on translate_page and translate_video_captions is a billing probe; with text it is host page MT. Probe success is not a full page done.

## User-visible copy

When you describe the confirm card or a failure card, use these strings verbatim. A near-synonym is a failure. Banned near-synonyms: 语音包, 收录复习.

Confirm card, every confirm frame:

- Title: `确认调用`
- Primary: `允许这一次`
- Cancel: `取消`
- Footnote: `确认前不开麦、不读页、不写学习库`

Action names: `打开本机设置（安装引导）`, `开实时双语字幕`, `收进复习`. For `open_setup` the line `打开本机设置页（安装或就绪检查）` is a touch, not a microphone claim.

Device allow, only with the characters 本机: `本机始终允许（实时字幕）` / `本机始终允许（打开设置）`. The slot form is `本机始终允许（{动作短名}）`.

`始终允许此助手` is only for a caller that has a real `caller_id`. If there is no `caller_id`, that line must not appear.

Failure title: `还差一步`.

| code | 用户向一句 | 主 CTA | 次 |
| --- | --- | --- | --- |
| `need_permission_mic` | `需要麦克风 / 系统音频权限` | `去开启权限` | `取消` |
| `need_packs` | `需要下载语言包` | `去下载语言包` | `取消` |
| `need_ext` | `需要浏览器扩展` | `安装扩展说明` | `复制给 AI 的说明` |
| `site_unsupported` | `当前网站暂不支持视频双语字幕` | `改用实时字幕` | `关闭` |
| `need_engine` | `还没配置翻译引擎` | `去配置引擎与密钥` | `取消` |
| `need_app` | `尚未检测到本机「大肚猴翻译」。请先安装或打开 App，再重试。` | `去安装 / 打开 App` | `打开安装说明` |
| `need_login` | `需要登录` | `去登录` | `取消` |
| `grant_or_key_unavailable` | `本机额度或密钥不可用` | `去配置引擎与密钥` | `取消` |
| `network_unavailable` | `网络暂时不可用` | `重试` | `取消` |

`grant_or_key_unavailable` footnote: `亦可在宿主配置自有 Key 或订阅`. Its setup step is `engine` (the user's own key), not login. `network_unavailable` retries the same call and does not open engine, auth, or login.

For `need_ext`, do not offer a one-click store install link. For `site_unsupported`, do not describe the failure as success. `改用实时字幕` opens the subtitle surface and does not start the microphone.

The CLI does not draw the confirm card. Without elicitation the receipt message is `需要你在本机点确认` and the code is `need_confirm`. The confirm card is the App.
