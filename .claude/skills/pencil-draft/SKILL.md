---
name: pencil-draft
description: 交互/UI/文案变更先出 OpenPencil 稿再改代码。稿子在 OpenPencil（.fig 画布）上出：写需求 → 用画布 MCP 的 render（JSX）或 App 内 AI 搭稿 → export_image 出 PNG → 审稿，不合要求打回重画，最多 3 轮。**pen.dev/Pencil 与 Open Design/OD 都已停用**（历史工具）。当任务要改用户看得见或摸得着的界面、交互或可见文案时用它——新页面、弹窗/气泡、字幕条、工具栏、设置项、空/加载/错误态、引导步骤、手势/转场，以及布局、间距、层级、"这里该用 sheet 还是内联"之类的问题。
---

# pencil-draft — 写需求，在 OpenPencil 里出稿，审稿

改动涉及**用户可见的界面、交互或可见文案**时用它（宿主 app `app/`：iPhone/iPad/Mac；浏览器
扩展 UI：Safari/Chrome/Firefox）。**不要**没有稿子就把新交互/新文案写进代码，也**不要**用 HTML /
CSS 手搓一份当捷径。

> **工具（2026-11-03 起）：OpenPencil（`net.dannote.open-pencil`，≥0.16）。**
> pen.dev / Pencil（`.pen`）与 Open Design / OD 都是**历史**工具，只读旧稿，不要再用它们出稿。
> 稿子是 `.fig` 画布 + 导出的 PNG，审的是画布，不是 diff。

## 0. 出稿主路径：OpenPencil 画布

1. **写需求**：改什么、为什么、要覆盖哪些形态（§3），以及不能动的东西。写约束，不写逐步实现。
   需求同时落一份在 `design/_work/<ticket>/`，方便复跑。
2. **开稿**：在 OpenPencil 里新建或复用一份 `.fig`，存进仓库（`design/_work/<ticket>/<票号>-<主题>.fig`）。
   - 新稿：MCP `new_document { path }`（路径在 `OPENPENCIL_MCP_ROOT` 内）。
   - 有可参考的旧稿：先 `open_file`，再在空白处加画框；不要覆盖已签署的旧稿。
3. **搭稿**：优先用 MCP `render` 的 JSX（`Frame` / `Text` / `Icon` / `Rectangle`，`w` / `h` / `flex` /
   `gap` / `p` / `bg` / `rounded`），结构清楚、可 diff、可复跑；也可以用 OpenPencil 内置 AI 或画布
   手工微调。禁止把 HTML/CSS 页面当稿子交。
4. **落盘 + 导出**：先 `save_file`，再 `export_image` 到**同一目录**的 PNG（审稿看这张，GitHub 不能
   预览 `.fig`）。导出失败见 §1 的 WASM 处理。
5. **审稿**：把 PNG 给用户，说清**改了什么、代价是什么**；不合要求把具体缺口写回需求再出一版，
   **最多 3 轮**。3 轮仍不达标就停下报告，不要自己手搓成一份「合格的稿子」。

## 1. MCP 工具与硬坑

OpenPencil 桌面 App 启动时会在 `~/Library/Application Support/OpenPencil/` 下开一个本地 socket；
`openpencil-mcp` 只是 stdio → socket 的桥。**App 没开，所有工具都不可用。**

- 发现文档：`list_documents`（拿 `document_id` / `page_id`）；没有文档时 `new_document`。
- 文件工具（`save_file` / `open_file` / `export_image` 的 `path`）被限制在 `OPENPENCIL_MCP_ROOT`
  内；跑 MCP 时把根设成仓库：`OPENPENCIL_MCP_ROOT=/path/to/repo`。
- 常用：`render`（JSX）、`get_jsx`、`update_node`、`set_layout`、`export_image`、`save_file`、
  `lint`、`describe`、`get_page_tree`、`find_nodes`。
- **WASM OOM**：大画框导出可能报 `Aborted()` / `Out of bounds memory access`。
  先 `save_file`（稿不能丢）→ 退出并重开 OpenPencil → `open_file` 重开 `.fig` → 再导出，
  `maxEdge` 先给 2560–3000。不要反复重试同一个大导出。
- `.fig` 是 App 的文档格式：**不要**用 Read / Grep 去解析；只用 MCP 工具或 App。
- JSX 是**一个表达式**：没有顶层语句 / `return`；需要循环或函数就在 `{(() => { … })()}` 里写。
- 文本要折行：给 `w="fill"`（定宽文本用固定 `w` + `textAutoResize="height"`）。只给宽度不给
  auto-resize 会撑破父框。
- 底部对齐用 spacer：`<Frame w="fill" h={1} grow={1} />`，不要靠猜坐标。
- 高度用显式数字；`h="hug"` 出 `NaN` 时退回数字。`overflow="hidden"` 会真裁切，别拿它掩盖溢出。
- 每个节点给可读 `name`；`update_node` 不改 `id` / `type`。
- 查溢出 / 被裁：`lint`、`describe`、`node_bounds`；截图 / 导出一次，在成稿后做。

## 2. 稿子的最小结构

一张审稿板至少包含：标题（票号 + 一句话）、三形态列、每列的规格标注、变更前后的数值对照、
以及「待签核」清单。参考 `design/_work/bel183/draft.jsx` 与同名 PNG。

```jsx
<Frame name="稿 · <票号> · <主题>" w={1600} h="hug" bg="#f5ead8" flex="col" gap={32} p={48}>
  <Text name="标题" w="fill" size={30} weight={700} color="#201e1d"><票号> · <一句话></Text>
  <Frame name="三形态" w="fill" flex="row" gap={32} items="start">
    {/* 窄 / 宽·iPad / 宽·Mac 各一列 */}
  </Frame>
</Frame>
```

## 3. 审稿 / 形态与签署

- **每份稿必须覆盖该面所有形态：窄（mobile）/ 宽·iPad / 宽·Mac，断点 720px，每个变体一列**
  （`AGENTS.md`「Interaction / UX constraints」）。不写 iPad-only 布局；某个变体确实画不出，就说出来
  并停。
- 把 PNG 给用户看，说清**改了什么、代价是什么**；等**明确通过**再改 `app/` / `ext/` 代码。
- 通过后改代码，并在**同一个提交**里带上相应文档（交互规则进 `docs/interaction-spec.md`；涉及领域
  设计的先改 `docs/domain-design.md` / `docs/learning-design.md` 并过人工评审）。
- **像素验收在稿子通过之后**，而且要在**真实构建包**上做（不是拼接 CSS 的 ad-hoc 副本）：按稿子的
  标注量卡高、控件盒、可见高、裁切、滚动，数值对得上才算过。
- 每次改动都要有 GitHub / Linear 单据（见 `AGENTS.md`）。

## 4. 版本与更新：逐个查，别假设

- **App**：`defaults read net.dannote.open-pencil CFBundleShortVersionString`（或看 `/Applications/OpenPencil.app`）。
  更新走 App 自带更新。
- **MCP**：`npm ls -g @open-pencil/mcp`；`npm i -g @open-pencil/mcp` 升级（版本要与 App 匹配）。
- **桥**：`which openpencil-mcp`；连不上时先确认 App 在跑、`~/Library/Application Support/OpenPencil/mcp.sock` 存在。
- 本机已验证版本：OpenPencil 0.16.0 + `@open-pencil/mcp` 0.16.0（2026-11-03）。

## 5. 历史工具（只读，不要用）

- **pen.dev / Pencil（`.pen`）**：2026-10-08 至 2026-11-02 的稿子工具。`.pen` 加密，只能用 Pen 应用
  或 `@pen.dev/cli` 打开；归档在 `design/pencil/`，只作历史参考。
- **Open Design / OD**：2026-10-08 之前的历史工具，`design/` 下早期 HTML 稿只作历史参考。
- 旧的操作手册（pen 的 execute / pen-schema / 硬坑）保留在 git 历史与本文件的历史版本里；新稿不要
  再走那条路。
