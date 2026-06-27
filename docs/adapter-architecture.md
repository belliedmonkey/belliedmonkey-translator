# Site-Adapter 架构设计（评审稿）

> 状态：草案 / 待评审
> 目标：把"一份通用代码硬扛所有网站"改成"每类布局有专属的解析与排版"，同时保留通用兜底。

## 1. 背景与动机

当前所有网页都走同一条 `DOMProcessor.collectParagraphs()`。真实站点结构千差万别，通用启发式很脆弱。已踩的坑：

- Substack 把正文包在 `<div class="main-content-and-sidebar-*">`，通用跳过逻辑按祖先 class 子串匹配到 "sidebar"，**整篇 465 段全被误杀**，只翻译了视频时间戳。

结论：不同布局应有各自的"解析(选哪些节点) + 排版(译文怎么插)"代码。一份通用代码只作兜底。

## 2. 设计目标 / 非目标

**目标**
- 每类布局的解析与排版**互相隔离**，互不影响。
- 加一个新站点 = 加一个 adapter 文件 + 注册一行，不改动其它 adapter。
- 通用 `GenericAdapter` 兜底，未匹配到专属 adapter 的页面仍能翻译。
- 复用现有共享能力：翻译引擎、缓存、懒加载、进度条。
- 契合现有"无打包、IIFE 模块、按顺序注入 content script"的简单结构，不引入 bundler。

**非目标**
- 不为每个网站都写 adapter（不现实）。只为高价值/结构特殊的站点写，其余靠 Generic。
- 本次不改翻译引擎（`translation-api.js`）与设置体系。

## 3. 核心抽象：两类 Adapter

不同布局其实分两种**调度模式**，接口据此分两类：

### 3.1 `document` 类（静态文档，绝大多数网页）

只声明"解析 + 排版"，调度（批处理 / 懒加载 / 动态内容 / 进度条）交给通用引擎。

```js
{
  id: 'substack',
  kind: 'document',
  match(loc, doc),                 // 是否适用（域名 / 特征选择器）
  root(doc) -> Element,            // 可选：正文根容器，缩小扫描范围
  collectBlocks(root) -> Element[],// 解析：返回待翻译的块级节点
  getSourceText(el) -> string,     // 取该节点的原文（默认取直接文本）
  renderTranslation(el, text),     // 排版：译文怎么插入、什么样式
  removeTranslation(el),           // 撤销（关闭翻译时）
}
```

### 3.2 `stream` 类（流式内容，如视频字幕）

字幕是持续变化的，不是一次性收集。adapter 自己管理生命周期，引擎只提供 `translate()`。

```js
{
  id: 'youtube',
  kind: 'stream',
  match(loc, doc),
  enable(ctx),    // ctx.translate(text) / ctx.settings
  disable(),
}
```

> YouTube 现有逻辑（观察 `.ytp-caption-segment` → 追加 `.mt-yt-dual`）直接落进 `YouTubeAdapter.enable/disable`。

## 4. 注册表与选择机制

```js
// adapters/registry.js
const AdapterRegistry = (() => {
  const adapters = [];                       // 按注册顺序 = 优先级
  function register(a) { adapters.push(a); }
  function select(loc = location, doc = document) {
    return adapters.find(a => a.match(loc, doc)) || GenericAdapter; // Generic 永远兜底
  }
  return { register, select };
})();
```

- 专属 adapter 先注册、先匹配；都不中则 `GenericAdapter`。
- `match` 用域名或特征选择器（例如 Substack 可同时匹配 `*.substack.com` 与自定义域上的 `.available-content`）。

## 5. 通用引擎（共享调度，不随站点变）

`document` 类 adapter 由 `DocumentEngine` 调度，集中复用现有 `WebpageTranslator` 里那套逻辑：

- 可视区优先 + `IntersectionObserver` 懒加载屏外节点
- `MutationObserver` 处理动态加载内容（去抖）
- 批量翻译 + 并发限制（现有 `TranslationAPI` 已有）
- 顶部进度条（`.mt-progress-bar`）

引擎只通过 adapter 的 `collectBlocks / getSourceText / renderTranslation` 与具体布局交互——**调度通用，解析排版专属**。

## 6. 目录结构

```
extension/content/
  translation-api.js      # 不变（共享翻译引擎）
  dom-processor.js        # 降级为 GenericAdapter 的工具/默认实现
  floating-button.js      # 不变
  engine/
    document-engine.js    # 通用调度（从 content-webpage.js 抽出）
  adapters/
    registry.js           # 注册表 + 选择
    generic.js            # GenericAdapter（兜底，document 类）
    youtube.js            # YouTubeAdapter（stream 类，迁自 content-youtube.js）
    substack.js           # SubstackAdapter（document 类，首个站点 adapter）
  content-main.js         # 改为：registry.select() → 用引擎/适配器启动
```

`manifest.json` 的 `content_scripts.js` 注入顺序（依赖在前）：

```
translation-api.js → dom-processor.js → floating-button.js →
engine/document-engine.js → adapters/registry.js →
adapters/generic.js → adapters/youtube.js → adapters/substack.js →
content-main.js
```

## 7. 内置 adapter

| adapter | kind | match | 解析 | 排版 |
|---|---|---|---|---|
| `GenericAdapter` | document | 兜底（永远 true） | 改进版 `collectParagraphs`（祖先只按语义区域跳过，不按 class 子串） | `.mt-translation` 绿色译文插在节点内末尾 |
| `YouTubeAdapter` | stream | `youtube.com` | 观察 `.ytp-caption-segment` | `.mt-yt-dual` 追加在字幕下方 |
| `SubstackAdapter` | document | `*.substack.com` 或含 `.available-content` | 正文根锁定 `.available-content`，段落取其中 `p,h1..h3,li,blockquote` | 同 `.mt-translation` |

## 8. content-main 改造

```js
const adapter = AdapterRegistry.select();
if (adapter.kind === 'stream') {
  if (cfg.enabled) adapter.enable(ctx);
  // 监听设置/开关变化 → adapter.enable/disable
} else {
  const engine = DocumentEngine.create(adapter, cfg);
  if (cfg.enabled) engine.enable();
  // 开关、storage.onChanged、popup 消息 → engine.enable/disable
}
```

悬浮按钮、storage 同步、popup 消息这些与布局无关的逻辑留在 `content-main.js`，不进 adapter。

## 9. 从现有代码的增量迁移步骤

1. 抽 `DocumentEngine`：把 `content-webpage.js` 的调度（可视优先、懒加载、Mutation、进度条）搬进 `engine/document-engine.js`，解析/排版改为调用 adapter。
2. 建 `GenericAdapter`：包装现有（已修复的）`DOMProcessor` 作为默认解析 + `.mt-translation` 排版。
3. 建 `YouTubeAdapter`：把 `content-youtube.js` 整体迁入，接口对齐 `stream`。
4. 建 `registry.js` 并注册 `[Substack, YouTube, Generic]`。
5. 改 `content-main.js` 用 `registry.select()` 分发，删掉写死的 `isYouTube` 三元判断。
6. 加 `SubstackAdapter`（首个站点 adapter）。
7. 更新 `manifest.json` 注入顺序，`node build.js` 重建。

每步可独立验证；前 5 步是无行为变化的重构，第 6 步才新增能力。

## 10. 加一个新站点 adapter（开发者指南）

1. 在 `adapters/` 新建 `<site>.js`，实现 `match` + 解析/排版（或 stream 生命周期）。
2. 在 `registry.js` 注册（放在 Generic 之前）。
3. `manifest.json` 注入列表加该文件。
4. `node build.js` → 重载扩展 → 在目标站点验证。

## 11. 验证方式

- 单页验证：在目标站点跑 `adapter.collectBlocks()`，确认命中正文、排除导航/侧栏/评论。
- 回归：Generic 兜底在 example.com / 普通博客仍正常。
- 数量对比：Substack 由 1 → 数百段（已用补丁验证 1→785）。

## 12. 待你决策的开放问题

1. **首批要做专属 adapter 的站点清单**？（已定 Substack；是否加微信公众号、Medium、知乎、arXiv、GitHub README 等）
2. **排版样式是否允许 per-adapter 自定义**（颜色/字号/插入位置），还是全局统一？
3. **匹配优先级**：纯域名匹配，还是允许"特征选择器"匹配（同一 adapter 适配自定义域的 Substack）？
4. Generic 的 class 跳过策略：完全去掉，还是改为"精确整词 class 匹配"而非子串？
