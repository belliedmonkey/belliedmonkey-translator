# N25-W2 · MCP 实现规格（薄）

- 日期：2026-10-26 Asia/Shanghai
- 轨：marketing **1.22.0** 独立支（不改 `package.json` 的现行版本号，不并 1.21.x）
- 契约：`architecture/SPEC-AGENT-DEEPLINK-v1-DRAFT-2026-10-23.md`（本仓库若尚未收入该稿，以开工令附件为准）§5 回执、§6 失败码
- 文案锁：`qa/1.22.0/spec/N25-AGENT-COPY-LOCK-2026-10-23.md`（附件；A1–A3 / F1–F5 逐字）
- 代码：`agent/contract.js`（工具 schema 的运行时源）、`agent/mcp-stdio.js`、`agent/run.js`、`src/app/agent-face.js`
- **假 MCP / 仅 echo 深链字符串却标 D3 = FAIL**

本文件是 W2 首交的实现规格。它不宣称已经上架云 MCP。Remote 后继若做，必须复用下面同一份 tool schema，而不是另起一套动作。

---

## 1. 传输

| 项 | 值 |
| --- | --- |
| 日用 | 本机 **stdio MCP**（JSON-RPC 2.0，一行一条，stdout 只写协议） |
| 启动 | `node agent/mcp-stdio.js` |
| npm | `npm run agent:mcp` |
| 服务名 | `belliedmonkey` |
| 版本戳 | `1.22.0-n25`（轨名，不是商店营销号） |
| Remote | **未发布**。初始化说明里写明 not published。不要把本进程说成已上架云 MCP |
| H1 包装 | 不在本规格。Claude Code / Codex 的 `.mcp.json` 由后续包装去引用这条启动命令 |

Flavor：环境变量 `MT_FLAVOR=china` 时，回执里的 `fix.open_setup` 用 `belliedmonkeycn://`，否则 `belliedmonkey://`。

---

## 2. 七个工具

名字与 N25 动作 ID **逐字相同**。`ready.check` 带点。没有第二个公开名字 `ready_check`。宿主若拒绝点号，只许在宿主侧做映射注解。

入参是深链 query 的子集。未知键忽略。`caller` 只用于展示，不能当成「始终允许此助手」的身份。`return` 在 allowlist 落地前忽略。`text` / `quote` 上限 2000 个码位；回执不回传它们。

公共键：`source`（`agent` \| `mcp` \| `deeplink` \| `web` \| `ext`）、`v`、`caller`、`caller_id`、`lang`、`return`。

| 工具名 | 敏感 | 额外入参 | 执行 |
| --- | --- | --- | --- |
| `ready.check` | 否 | — | 返回就绪摘要。不改设置、权限、学习库 |
| `open_setup` | 否 | `step`：`install_app` \| `install_ext` \| `login` \| `packs` \| `mic` \| `engine` | 打开既有设置步。非法 `step` → `bad_request` |
| `start_live_subtitles` | 是 | `video_lang`、`my_lang` | 确认后进入字幕独立表面。**不**调用开麦 |
| `translate_page` | 是 | `url`（提示，不抓取） | 扩展执行。无扩展 → `need_ext`，不读页 |
| `translate_video_captions` | 是 | `url`（提示，不抓取） | 扩展执行。站点探针为否 → `site_unsupported`（message 带主机名） |
| `capture_to_study` | 是 | `text` 或 `quote` | 确认后才写。皆无则确认卡可贴。回执无句子 |
| `explain_or_drill` | 是 | `text` / `quote`、`mode`：`explain` \| `drill`（默认 explain） | 确认后才解析。回执无句子 |

`tools/call` 的结果是 MCP `content[0].text`，其正文是下一节的回执 JSON。业务失败仍是 `isError: false`，失败在回执的 `code` 里。把深链 URL 字符串当作工具结果并标成 D3，是 FAIL。

P1（`listen.start`、`subtitle.export`、`learn.open_review`、`doc.translate`）不是工具。深链误入 → `unsupported_action`。

运行时 schema 就是 `agent/contract.js` 的 `TOOLS`。上面这张表与它对得上；对不上以代码加本表的测试为准，禁止再手写第三份名字。

---

## 3. 回执 JSON = 深链 §5

只这些键：

```json
{
  "ok": false,
  "action": "start_live_subtitles",
  "code": "need_permission_mic",
  "message": "需要麦克风 / 系统音频权限",
  "fix": {
    "open_setup": "belliedmonkey://agent/v1/open_setup?step=mic&source=mcp"
  },
  "receipt_id": "agt_…"
}
```

成功时 `ok: true`、`code: "ok"`、`fix` 为 `{}`。

硬规则：

- 默认没有 `text` / `transcript` / `translation` / `content`
- `ready.check` 的缺口写在 `message`，形如 `缺口 need_login,need_packs`。本拍不另加 `gaps` 字段，避免撑破 §5
- `fix.open_setup` 是完整深链（scheme + `source=`）
- `code` 必须属于 §6。构造器遇到表外 code 直接抛错

`ready.check` 成功码永远是 `ok`。没接上本机状态时 message 为 `缺口 need_app`，不假装就绪。

---

## 4. 失败码 ∈ §6

冻结集（与深链 §6 相同，含成功码 `ok`）：

`ok` · `need_confirm` · `cancelled` · `unsupported_action` · `bad_request` · `untrusted_denied` · `need_app` · `need_ext` · `need_login` · `need_packs` · `need_engine` · `need_os` · `need_permission_mic` · `site_unsupported` · `quota_or_key` · `study_capture_off`

不使用 `need_user`、`missing_app`、`need_mic`、`ready_check`。

用户能看见的 F1–F5 一句与按钮，用文案锁原文（见 `agent/copy.js`）：

| code | 用户向一句 | 主 CTA | 次 |
| --- | --- | --- | --- |
| `need_permission_mic` | 需要麦克风 / 系统音频权限 | 去开启权限 | 取消 |
| `need_packs` | 需要下载语言包 | 去下载语言包 | 取消 |
| `need_ext` | 需要浏览器扩展 | 安装扩展说明 | 复制给 AI 的说明 |
| `site_unsupported` | 当前网站暂不支持视频双语字幕 | 改用实时字幕 | 关闭 |
| `need_engine` | 还没配置翻译引擎 | 去配置引擎与密钥 | 取消 |

F 帧标题：`还差一步`。F3 不放商店一键安装活链。F4 不把失败说成成功；「改用实时字幕」只打开字幕表面，不开麦。

---

## 5. 确认门

敏感工具（上表「是」）在副作用之前停住：

1. 先做不碰麦 / 页 / 库的前置失败（`need_ext`、`need_login`、`need_packs`、`need_permission_mic`、`need_os`、`need_engine`、`quota_or_key`、`study_capture_off`、`site_unsupported`、`bad_request`）
2. 已有本机授权则直接执行
3. 否则向客户端发 `elicitation/create`（客户端在 `initialize` 里声明了 `elicitation` 时）。文案是确认卡锁文：`确认调用`、动作名、`允许这一次`、`取消`、`确认前不开麦、不读页、不写学习库`
4. 客户端 `accept` = 允许这一次。`decline` / `cancel` → `cancelled`，不执行
5. 客户端没声明 elicitation，或 elicitation 失败 → 回执 `need_confirm`，不执行
6. 工具参数里的 `confirmed` / `allow` / `grant` **删掉**，不能自证

匿名（没有合法 `caller_id`）的确认卡**没有** `始终允许此助手`。出现即 FAIL。

`本机始终允许（实时字幕）` 这类设备级勾选可以记在 `~/.belliedmonkey/agent/grants.json`（`MT_AGENT_HOME` 可改）。助手级只按 `caller_id` 记，不按 `caller` 展示名。

App 深链走同一套 `runAgentAction`。确认卡在 `src/app/agent-face.js`，字符串来自 `agent/copy.js`。`start_live_subtitles` 确认通过后只调用 `AppListen.open('subtitle')`，不调用 `start()`。

本拍不写学习库、不跑解释引擎、不改听译默认引擎：对应端口没接上时，确认之后回 `need_app`（message 说明写不进去 / 做不了解析），不回 `ok`。页译 / 视频字幕在扩展探针不为真时回 `need_ext`。

---

## 6. 什么叫 FAIL

- 工具名不是动作 ID，或另外公开 `ready_check`
- 失败码不在 §6
- 回执带全文，或工具结果只是一条 `belliedmonkey://…` 深链却称为 D3
- 敏感工具在确认或既有授权之前开麦、读页、写学习库
- 匿名确认出现 `始终允许此助手`
- 把本 stdio 进程写成已经上架的云 MCP
- 为 Grok / Muse 做本地插件链（不在本拍）

---

## 7. 证据（本拍）

`node test/agent-w2.test.js` 不单独进 `npm test` 的发现器——发现器会加载 `test/*.test.js`，所以 `npm test` 会跑到它。断言包括：工具名列表等于七个动作 ID；stdio 握手成功；`ready_check` 被拒；敏感调用先 elicitation 再 `enterSubtitle` 且 `micStarted: false`；取消与无 elicitation 不执行；回执键集等于 §5；句子不出现在回执里。
