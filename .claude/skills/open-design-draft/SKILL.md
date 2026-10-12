---
name: open-design-draft
description: 交互/UI 变更先出稿。当任务要改用户看得见或摸得着的界面与交互时用它——新页面、弹窗/气泡、字幕条、工具栏、设置项、空/加载/错误态、引导步骤、手势或转场，以及布局、间距、层级、可见文案、"这里该用 sheet 还是内联"之类的设计问题。它通过 Open Design 的 MCP 工具委托出稿（或改稿），等运行结束，把产物拉回本仓库，再动 app/扩展代码。
---

# open-design-draft — 先出交互稿，再写实现

当改动涉及**用户可见的界面或交互**时用它（浏览器扩展 UI：Safari/Chrome/Firefox，以及宿主
app `app/`：iPhone/iPad/Mac）。例如新的弹窗/面板、改动的字幕条或工具栏、新的设置项、
空/错误态、引导步骤、手势/转场，或"这个交互该长什么样/怎么走"的问题。

目标是**让 Open Design 设计交互，本仓库负责实现**：不要没有稿子就直接把新交互写进代码，
也不要用 HTML 手搓一份设计当捷径。

## 0. 前置

- 本机需要 Open Design 在运行；它的 MCP server 已注册进 OpenCode，服务名为 `open-design`，
  工具前缀 `open-design_*`（Code Mode 下是 `tools["open-design"].<tool>`）。
- 用 `list_projects` 找到本仓库对应的项目，**每次调用都显式传 `project`**，不要依赖"用户当前
  打开的那个"。没有对应项目时用 `create_project({ name: "mobiletranslator" })` 建一个，并先跟
  用户确认名字再生成。

## 1. 先界定改动

- **新**稿子或确实全新的交互：先 `collect_brief`，让用户把渲染出来的 brief 卡片填完，再
  `confirm_brief`。只有用户明确说"别问了"才跳过。
- **改已有**稿子：先用 `get_artifact`（一次拿回入口文件 + 它引用的兄弟文件）把现状拉下来，在
  这些文件上改。

## 2. 决定让 Open Design 做什么

- `list_skills` 看有哪些设计 skill，挑最贴合的。本仓库常见选择：
  - `apple-hig` —— iOS/iPadOS/macOS 的交互、组件与平台惯例（宿主 app 与 Safari 扩展面的默认）。
  - `design-review` —— 拿设计系统审一遍已有页面。
  - `design-consultation` / `design-brief` —— 方向还没定的时候。
- 需要成套流程（deck、模板等）时看 `list_plugins`。
- 需要品牌/设计系统规范（调色板、字体、语气）时读 MCP 资源
  `od://design-systems/<id>/DESIGN.md`。

## 3. 委托运行

- 先 `list_agents`，只用本机真实存在的 agent，别猜名字；设计任务挑其中最强的。
- 每个**已确认的用户动作**只生成**一个**规范 UUID（或 ULID）作为 `requestId`；如果超时/丢响应
  重试，必须复用同一个值。
- 调用：

  ```
  start_run({
    project: "<项目 id 或名字>",
    requestId: "<uuid>",
    prompt: "<要设计/改什么、为什么——包含界面、各状态、约束、现有 token；用真实文案>",
    skill: "<list_skills 里的 id>",
    agent: "<list_agents 里的 id>",
  })
  ```

  `start_run` 返回 `runId`，Open Design 会自己起 agent 干活。

## 4. 耐心等待（重要）

- 每 **30–60 秒** `get_run(runId)` 轮询一次，直到状态变为 `succeeded` / `failed` / `canceled`。
  一次运行通常要 **5–30 分钟**。
- `status: running` 且文件 mtime 没变，是内部 agent 在思考，不是卡死；每次轮询之间跟用户说一句
  "还在做"。
- **不要**因为慢就 `cancel_run`（或用 `write_file` 当"更快"的替代）——那等于丢掉这条流水线的设计
  质量。只有用户明确要求中止才 cancel。
- 若 `get_run` 返回 `failureAction: "recharge"`：把 `rechargeUrl` 给用户看；用户确认充值后，用
  **同一个 `requestId`**、带 `resume: true` 把**原来那次** `start_run` 再调一次。

## 5. 把结果拉回本仓库

- 成功后 `get_run` 会给出预览 URL 和提示：打开预览让用户看，并用 `get_artifact` 拉回文件（优先
  用它，别一个个 `get_file`）。
- 稿子落到 `design/`（本仓库的 mockup 都在那：`.dc.html`、JSX 框架、tokens CSS）。iOS/app 面沿用
  现有 `design/ios-frame.jsx` / `App Mockups.dc.html` 的写法。
- 然后在 app/扩展代码里按稿实现。实现若偏离稿子，要说明偏差，并用后续 `start_run` 更新稿子，
  别让两边长期不一致。

## 6. 收尾必须走本仓库的规矩

- **同一次提交里**更新 [`docs/interaction-spec.md`](../docs/interaction-spec.md)（用户可见交互/布局的
  唯一真源，见 AGENTS.md > "Interaction / UX constraints"）；改动如何"看起来/用起来"变了，就写进去。
- 按 AGENTS.md > "Change documentation" 用 `gh issue create` 记一条 issue（问题 / 方案 / 理由）。
- 实现照常过验证门禁：[`docs/verification-spec.md`](../docs/verification-spec.md)（`npm test`、
  涉及 `extension/content/**` 或 `extension/styles/**` 时 `npm run test:layout`、以及必需的全矩阵
  设备验证）。出稿**不替代**验证。

## 约定

- 不要把内部关联值（request id、run id、brief id、nonce、socket 路径、工具/运行时 id）写进给用户
  看的文案或提交信息里；它们只出现在工具调用里。
- 每个出货面保持一个 Open Design 项目，且每次调用都显式传 `project`。
- 如果因为 daemon 不可达而失败：让用户打开一次 Open Design（它也会以 headless 方式自启），再重试
  ——不要悄悄退回去手搓 UI。
