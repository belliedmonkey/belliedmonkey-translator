---
name: pencil-draft
description: 交互/UI/文案变更先出 Pencil 稿再改代码。用 pen.dev 画布（Pen.app 自带的 MCP，服务名 pencil，Code Mode 下是 tools["pencil"].<tool>）。当任务要改用户看得见或摸得着的界面、交互或可见文案时用它——新页面、弹窗/气泡、字幕条、工具栏、设置项、空/加载/错误态、引导步骤、手势/转场，以及布局、间距、层级、"这里该用 sheet 还是内联"之类的问题。**绝不用 Open Design**。也记着读写画布的几个硬坑：文档必须先打开、execute 是脚本不能顶层 return、文本要 textGrowth 才折行。
---

# pencil-draft — 先出 Pencil 稿，再改代码

改动涉及**用户可见的界面、交互或可见文案**时用它（宿主 app `app/`：iPhone/iPad/Mac；浏览器
扩展 UI：Safari/Chrome/Firefox）。**不要**没有稿子就把新交互/新文案写进代码，也**不要**用 HTML
手搓一份当捷径。

> **本仓库只用 Pencil（pen.dev），禁止 Open Design / OD。** 出稿、评审、通过之后再动代码；
> 文案类改动同样要出稿（用户 2026-10-07 明确要求）。

## 0. 前置：MCP 只能操作「**已经打开着**的文档」

`tools["pencil"].*` 的所有工具（`get_app_state` / `read_skill` / `execute` / `browser` / `get_style`）
都要求 Pencil 编辑器里**有一个 `.pen` 文档是打开状态**。否则一律报：

```
Failed to access file "<path|undefined>". A file needs to be open in the editor to perform this action.
```

**怎么办**：

- 先 `get_app_state()`——它回 `Currently active canvas editor: <path>` 和顶层 frame 清单。通了就直接用。
- 不通时用系统打开一个文档（本机文档在 `~/.pencil/documents/<uuid>/*.pen`）：

  ```bash
  find "$HOME/.pencil/documents" -name "*.pen" | head
  open -a Pen "/Users/<you>/.pencil/documents/<uuid>/<name>.pen"
  ```

- **MCP 不能新建文档**；要空白文档就让用户在 Pen.app 里 ⌘N，或打开一个已有的。
- `.pen` 是**加密**的：**永远不要**用 Read / Grep 去读它，只能经 MCP。

## 1. 先读必读的参考

- `read_skill({})` 拿 pen-dev 的技能目录；**必须**读 `read_skill({ path: "execute.md" })` 与
  `read_skill({ path: "pen-schema.md" })` 再动手。
- `get_app_state()` 看现有画布、顶层 frame；**优先照抄已有稿的视觉语言**（字体/字号/底色/圆角），
  别自造一套。

## 2. 出稿 / 改稿（`execute` 的正确用法 —— 最容易踩的坑）

- **调用形状**：`tools["pencil"]["execute"]({ filePath: "<打开的 .pen 路径>", input: "<脚本文本>" })`。
- **`input` 是一段「脚本」，不是函数**：**不要写顶层 `return`**（会报
  `SyntaxError: return not in a function`）。要把结果读出来用 **`Print(...)`**（会出现在返回的
  `Print output` 里）。想取值跨调用传递时，用**不带 `const`/`let` 的裸赋值**（`myId = Insert(...)`），
  因为每次 execute 是独立作用域。
- **别把 pen 的代码写进 Code Mode 的顶层沙箱**：那层沙箱里**没有**画布 API，你会看到
  `ReferenceError: Unknown identifier 'Print'`（`Get` / `Insert` / `document` 同理）——**那是误报**，
  不是版本/授权问题。pen 代码只能放在 `input` 里。区分方法：`input` 里 `Print('x=' + typeof Insert)`
  会回 `x=function`。
- 可用 API：`Insert(parentId, node)`→返回 id、`Copy` / `Update` / `Replace` / `Delete` / `Move`、
  `Get(idOrPath, {depth}|{depth:0})`、`Get(id, visitor, {depth})`（`ctx.bounds` / `ctx.problems`）、
  `FindEmptySpace({width,height,direction,padding})`、`SetVariables` / `GetVariables`、
  `Print(...)`、`TakeScreenshot([ids])`、`Export(...)`、`Generate(...)`。
- **每个新增节点都要 `name`**（可读的名字）；`Update` **不能**改 `id` / `type` / `ref`。
- **文字要折行**：文本节点必须同时给 `textGrowth: "fixed-width"` **和**宽度（`width: "fill_container"`）。
  只设 `width` **不生效**（schema 原文："`textGrowth` Required before width/height take effect"），
  长文本会一路撑宽把父 frame 撑破、被裁。建节点时就带上：

  ```js
  const T = (name, content, size, weight, fill) => ({ type: 'text', name, content, fontFamily: 'Inter',
    fontSize: size, fontWeight: weight, fill, textGrowth: 'fixed-width', width: 'fill_container' });
  ```
- **别在普通 frame 上用 `placeholder: true → Update({placeholder:false})` 这套**：它会把尺寸锁在
  建时的状态，后续换行/增删导致高度不重算，甚至算出 `NaN`。**用显式数字高度**；若 `height:
  "fit_content"` 出现 `NaN`，也退回显式数字。
- **量测**：用 `Get(id, (n, c) => c.problems && Print(n.name, c.problems), { depth: N })` 查溢出/被裁；
  用 `c.bounds` 看实际尺寸。**同一调用里刚 `Update` 完立刻 `TakeScreenshot` 可能读到 `NaN` 尺寸**——
  复核时**另起一次** `execute`（不截图）再读。
- **截图**：`TakeScreenshot([nodeId])` 一次一张、只在成稿后**一次**（它贵）。

## 3. 评审 → 通过 → 才动代码

- 把截图/预览给用户看，说清**改了什么、代价是什么**；等**明确通过**再改 `app/` / `ext/` 代码。
- 通过后再改代码，并在**同一个提交**里带上相应文档（交互规则进 `docs/interaction-spec.md`；
  涉及领域设计的先改 `docs/domain-design.md` / `docs/learning-design.md` 并过人工评审）。
- 每次改动都要有 GitHub issue（见 `AGENTS.md`）。

## 4. 版本与更新：逐个查，别假设

- **CLI**：`npm view @pen.dev/cli version` 对比本机（`pen version` / `npm ls -g @pen.dev/cli`）。
- **Pen.app**：更新源在 `app-update.yml`（GitHub `highagency/pen-desktop-releases`）；查
  `curl -s https://api.github.com/repos/highagency/pen-desktop-releases/releases/latest`。
- **技能包**：`~/.pencil/skills/`（`latest.json` 指一个远端 zip）；内容可能只是被重传、**逐字节
  相同**——下载解包 `diff -rq` 一下再说有没有新版。
- **agent 授权**：`~/.pencil/agent-auth` 为空（`{}`）/ `pen status` 未登录时，CLI 的生成模式
  （`pen --out x.pen --prompt "…"`）用不了；MCP 的读写一般不受影响（先按 §2 确认调用形状再说）。

## 5. 最小可用骨架（照抄起步）

```js
const pos = FindEmptySpace({ width: 960, height: 700, direction: 'bottom', padding: 80 });
const root = Insert(document, { type: 'frame', name: '稿 · <主题> <日期>', x: pos.x, y: pos.y,
  layout: 'vertical', gap: 18, padding: 32, fill: '#FFFFFF', cornerRadius: 28, width: 960 });
Insert(root, T('标题', '<一句话标题>', 22, '700', '#2B2B2B'));
Insert(root, T('导语', '<这次改什么、为什么>', 13, 'normal', '#8A8578'));
// …内容（两栏对照 / 页面复刻）…
Print('rootId', root);
Get(root, (n, c) => { if (c.problems) Print('P', n.name, '|', c.problems); });
TakeScreenshot([root]);
```
