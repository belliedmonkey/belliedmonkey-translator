# 大肚猴翻译 · Mobile Translator

Safari iOS 浏览器翻译插件，支持网页双语对照翻译、YouTube 与播客双语字幕。完全开源免费，可自由配置任意 LLM API，数据不上传。

## 功能

- **网页双语翻译**：原文保留，译文以绿色显示在每个段落下方
- **YouTube 双语字幕**：整段字幕预取 + 60 秒预译，整句原文 + 译文同步显示（自绘固定叠加层）
- **播客/音频双语字幕**：有时轴字幕的播客（Substack、Spotify「跟随文字」等）显示双语字幕；无字幕站点自动回退为页面文本翻译
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
# 1. 克隆项目
git clone https://github.com/belliedmonkey/belliedmonkey-translator
cd belliedmonkey-translator

# 2. 一键构建 + 生成 Xcode 项目
bash build-safari.sh
```

脚本自动完成：`node build.js` → `xcrun safari-web-extension-converter` → 提示打开 Xcode

在 Xcode 中完成最后步骤：
1. 点击左侧 `BelliedMonkey Translator` → `Signing & Capabilities` → **Team 选你的 Apple ID**
2. 同样设置 `BelliedMonkey Translator Extension`（两个 Target 都要）
3. 用数据线连接 iPhone，顶部选择你的设备
4. 点击 ▶ **Run**（或 `⌘R`）
5. 手机上：**设置 → Safari → 扩展 → 大肚猴翻译 → 打开 → 允许访问所有网站**

> **注意**：免费 Apple ID 安装的 App 有效期 7 天，到期后重新用 Xcode Run 一次即可续期，无需重新设置。

## 在 Chrome / Edge 测试（无需 Mac）

```bash
node build.js
```

打开 `chrome://extensions/` → 开启开发者模式 → 加载已解压的扩展程序 → 选择 `dist/`

## 发布到 Firefox（覆盖桌面 + Android 用户）

```bash
node build.js firefox   # → 生成 dist-firefox/ 和 belliedmonkeytranslator-firefox.xpi
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
node build.js              # Chrome / Safari 构建 → dist/ + belliedmonkeytranslator.zip
node build.js firefox      # Firefox 构建 → dist-firefox/ + belliedmonkeytranslator-firefox.xpi
bash build-safari.sh       # 生成 Safari iOS Xcode 项目（需 Mac）
```

零依赖，无需 `npm install`，需要 Node.js 16+。

## 代码结构

```
extension/
├── manifest.json              # Manifest v3（Chrome / Safari / Firefox 通用）
├── background.js              # Service worker — 仅管理状态，不做翻译请求
├── content/
│   ├── translation-core.js    # 平台无关引擎：字幕状态机、60s 预译窗口、分页、句子合并、i18n
│   ├── translation-api.js     # 所有 LLM API fetch() 调用（在 content script 中执行）
│   ├── dom-processor.js       # 段落检测、双语注入
│   ├── floating-button.js     # 悬浮按钮（可拖拽）
│   ├── content-webpage.js     # 网页全文双语翻译
│   ├── content-youtube.js     # YouTube 双语字幕：整段预取 + 60s 预译
│   ├── content-podcast.js     # 播客/音频双语字幕（Substack VTT / Spotify「跟随文字」等）
│   ├── yt-timedtext-observer.js # Safari：用 Resource Timing 记录 YouTube 自己的 /api/timedtext URL
│   ├── yt-hook.js             # world:MAIN 钩子（仅 Chrome）— 机会性抓取字幕
│   └── content-main.js        # 入口：读取设置，路由到网页/YouTube/播客翻译器
├── styles/
│   ├── bilingual.css          # 双语样式（.mt-translation、进度条、翻译 chip）
│   └── floating-button.css    # 悬浮按钮（#mt-fab）
├── popup/                     # 工具栏弹出快速设置
└── options/                   # 完整选项页（颜色/字号/API Key/缓存管理）
```

## 关键技术说明

**Safari iOS Service Worker Bug**：设备锁屏后 Safari 的 background service worker 会永久失效（直到强退 Safari）。因此所有翻译 API 的 `fetch()` 调用都在 `content/translation-api.js`（content script 中）直接发出，`background.js` 只负责存储初始化和图标状态，从不参与翻译。

**YouTube / 播客字幕方案**：不做逐字翻译。一次性预取完整字幕（YouTube 用 `/api/timedtext`；Safari 上通过 Resource Timing 观察器拿到 YouTube 自己带 pot 的 URL 再 refetch，绕开 `world:MAIN` 限制），按 **60 秒滑动窗口预译**，合并成整句后由 `video.currentTime` / `audio.currentTime` 匹配，显示在自绘的固定叠加层里。因此即使 LLM 较慢也不会逐条卡顿。播客侧支持站内 VTT/SRT、Podcasting 2.0 `<podcast:transcript>`、以及 Spotify「跟随文字」的 DOM 抓取。

## 隐私 Privacy

- **无自建服务器**：翻译请求直接从你的浏览器发往你选择的翻译引擎，我们不经手、不存储、不上传你的任何数据。
- **API Key 只存在本地**：你的 key 保存在浏览器本地存储（`chrome.storage.local`），从不离开你的设备。
- **自带 Key（BYO-key）**：用哪个引擎、花多少钱由你自己控制。用 Google 免费引擎则无需任何 Key。
- **完全开源，可自行审计**：以上每一条都能在源码里逐行验证——这正是开源的意义。

## 许可证 License

本项目采用 **GNU General Public License v3.0 (GPL-3.0-or-later)**，完整条款见 [`LICENSE`](LICENSE)。

你可以自由使用、研究、修改和分发本项目；但基于本项目的衍生作品必须同样以 GPL-3.0 开源。

Copyright (C) 2026 belliedmonkey and contributors.
