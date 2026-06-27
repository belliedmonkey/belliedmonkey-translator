# 大肚猴翻译 · Mobile Translator

Safari iOS 浏览器翻译插件，支持网页双语对照翻译和 YouTube 双语字幕。完全开源免费，可自由配置任意 LLM API。

## 功能

- **网页双语翻译**：原文保留，译文以绿色显示在每个段落下方
- **YouTube 双语字幕**：原字幕保留，译文自动追加在字幕下方（黄色）
- **多引擎切换**：Google 翻译（免费无需 Key）/ ChatGPT / Claude / DeepSeek / 智谱 GLM
- **移动端交互**：可拖拽悬浮按钮、点击段落弹出翻译 chip、深色模式适配
- **翻译缓存**：内存 + 本地存储双层缓存（TTL 12 小时），重复内容秒出
- **自定义 API 地址**：支持中转代理（适用于国内访问 OpenAI 等）

## 平台支持

| 平台 | 支持 | 说明 |
|---|---|---|
| iPhone / iPad Safari | ✅ | 需要 Mac + Xcode 打包安装 |
| Mac Safari | ✅ | 同上 |
| Chrome / Edge（桌面） | ✅ | 直接加载 `dist/` 解压扩展 |
| Firefox（桌面 + Android） | ✅ | `node build.js firefox` 构建后提交 AMO |
| iPhone Chrome / Firefox | ❌ | iOS 系统限制，所有浏览器均不支持扩展 |

## 安装到 iPhone（Safari）

**前提**：Mac + Xcode 14+ + Apple ID（免费账号即可，无需付费开发者计划）

```bash
# 1. 克隆项目并切换分支
git clone https://github.com/belliedmonkey/mobiletranslator
cd mobiletranslator
git checkout claude/safari-mobile-translation-5p7tt9

# 2. 一键构建 + 生成 Xcode 项目
bash build-safari.sh
```

脚本自动完成：`node build.js` → `xcrun safari-web-extension-converter` → 提示打开 Xcode

在 Xcode 中完成最后步骤：
1. 点击左侧 `MobileTranslator` → `Signing & Capabilities` → **Team 选你的 Apple ID**
2. 同样设置 `MobileTranslator Extension`（两个 Target 都要）
3. 用数据线连接 iPhone，顶部选择你的设备
4. 点击 ▶ **Run**（或 `⌘R`）
5. 手机上：**设置 → Safari → 扩展 → MobileTranslator → 打开 → 允许访问所有网站**

> **注意**：免费 Apple ID 安装的 App 有效期 7 天，到期后重新用 Xcode Run 一次即可续期，无需重新设置。

## 在 Chrome / Edge 测试（无需 Mac）

```bash
node build.js
```

打开 `chrome://extensions/` → 开启开发者模式 → 加载已解压的扩展程序 → 选择 `dist/`

## 发布到 Firefox（覆盖桌面 + Android 用户）

```bash
node build.js firefox   # → 生成 dist-firefox/ 和 mobile-translator-firefox.xpi
```

本地测试：Firefox → `about:debugging` → 此 Firefox → 临时载入附加组件 → 选 `.xpi`

正式发布：前往 [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) → 上传 `.xpi` → 填写描述截图 → 提交审核（通常 1-3 个工作日，**免费**）

发布后 Firefox Android 用户可直接在附加组件商店搜索安装。

## 配置翻译引擎

点击 Safari 工具栏插件图标打开快速设置，或点击「更多设置」进入完整选项页。

| 引擎 | 费用 | API Key | 推荐场景 |
|---|---|---|---|
| Google 翻译 | 免费 | 不需要 | 日常使用默认选项 |
| ChatGPT (OpenAI) | 按量计费 | 是（`sk-…`） | 翻译质量要求高 |
| Claude (Anthropic) | 按量计费 | 是（`sk-ant-…`） | 长文翻译质量好 |
| DeepSeek | 极低价 | 是 | 高性价比 |
| 智谱 GLM | 有免费额度 | 是 | 免费体验 LLM 翻译 |

所有 LLM 引擎均支持配置**自定义 API 地址**，可接入中转代理或自建服务。

## 构建命令速查

```bash
node build.js              # Chrome / Safari 构建 → dist/ + mobile-translator.zip
node build.js firefox      # Firefox 构建 → dist-firefox/ + mobile-translator-firefox.xpi
bash build-safari.sh       # 生成 Safari iOS Xcode 项目（需 Mac）
```

零依赖，无需 `npm install`，需要 Node.js 16+。

## 代码结构

```
extension/
├── manifest.json              # Manifest v3（Chrome / Safari / Firefox 通用）
├── background.js              # Service worker — 仅管理状态，不做翻译请求
├── content/
│   ├── translation-api.js     # 所有 LLM API fetch() 调用（在 content script 中执行）
│   ├── dom-processor.js       # 段落检测、双语注入
│   ├── floating-button.js     # 悬浮按钮（可拖拽）
│   ├── content-webpage.js     # 网页全文双语翻译
│   ├── content-youtube.js     # YouTube 双语字幕（MutationObserver）
│   ├── content-injected.js    # 注入页面主世界拦截 XHR（辅助方案）
│   └── content-main.js        # 入口：读取设置，路由到网页/YouTube 翻译器
├── styles/
│   ├── bilingual.css          # 双语样式（.mt-translation、进度条、翻译 chip）
│   └── floating-button.css    # 悬浮按钮（#mt-fab）
├── popup/                     # 工具栏弹出快速设置
└── options/                   # 完整选项页（颜色/字号/API Key/缓存管理）
```

## 关键技术说明

**Safari iOS Service Worker Bug**：设备锁屏后 Safari 的 background service worker 会永久失效（直到强退 Safari）。因此所有翻译 API 的 `fetch()` 调用都在 `content/translation-api.js`（content script 中）直接发出，`background.js` 只负责存储初始化和图标状态，从不参与翻译。

**YouTube 字幕方案**：使用 MutationObserver 监听 `.ytp-caption-segment` 元素出现，翻译后在其下方追加 `.mt-yt-dual` span。缓存命中时无延迟，首次出现约 300-600ms 后显示译文。
