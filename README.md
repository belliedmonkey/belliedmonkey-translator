# 大肚猴翻译 · Mobile Translator

Safari iOS 浏览器翻译插件，支持网页双语对照翻译和 YouTube 双语字幕。翻译交互模仿大肚猴翻译插件。

## 功能

- **网页翻译**：原文保留，译文以绿色显示在每段落下方（双语对照）
- **YouTube 字幕**：原字幕保留，译文自动追加在下方（双语字幕）
- **多引擎支持**：Google 翻译（免费）、ChatGPT、Claude、DeepSeek、智谱 GLM
- **移动端优化**：可拖拽悬浮按钮、点击段落翻译、深色模式适配

## 安装到 iPhone（需要 Mac）

**前提条件**：Mac + Xcode 14+ + 免费 Apple ID（无需付费开发者账号）

```bash
# 克隆项目
git clone https://github.com/belliedmonkey/mobiletranslator
cd mobiletranslator

# 一键构建 + 生成 Xcode 项目（在 Mac 上运行）
bash build-safari.sh
```

脚本完成后按提示在 Xcode 中：
1. `Signing & Capabilities` → Team 选你的 Apple ID
2. 连接 iPhone，点击 ▶ Run
3. 手机：**设置 → Safari → 扩展 → MobileTranslator → 打开 → 允许所有网站**

> 免费账号安装的 App 有效期 7 天，到期用 Xcode 重新 Run 一次即可。

## 在 Chrome/Edge 测试（无需 Mac）

```bash
node build.js
# 打开 chrome://extensions/ → 开发者模式 → 加载已解压 → 选 dist/
```

## 配置翻译引擎

点击 Safari 工具栏中的插件图标 → 设置，或点击"更多设置"：

| 引擎 | 费用 | 需要 API Key |
|---|---|---|
| Google 翻译 | 免费 | 否 |
| ChatGPT (OpenAI) | 按量计费 | 是 |
| Claude (Anthropic) | 按量计费 | 是 |
| DeepSeek | 极低价 | 是 |
| 智谱 GLM | 有免费额度 | 是 |

支持配置自定义 API 地址（适用于中转代理）。

## 构建命令

```bash
node build.js            # Chrome/Safari 构建 → dist/
node build.js firefox    # Firefox 构建 → dist-firefox/ + .xpi
bash build-safari.sh     # 生成 Safari Xcode 项目（需 Mac）
```
