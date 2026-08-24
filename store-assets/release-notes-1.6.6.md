# 1.6.6 发布说明（扩展三面：Chrome Web Store / Firefox AMO / GitHub + 官网）

> **Apple 四条线本轮不发。** 1.6.5 的国际版 iOS 与中国版 iOS 还在审，撤审会把排队
> 位置清零；中国版 macOS 1.6.5 已上架。1.6.6 的渲染器修复随下一轮 Apple 发布走。

**为什么 Chrome 直接从 1.6.4 跳到 1.6.6，跳过 1.6.5**：CWS 的 1.6.4 从 2026-08-21 起
挂在 Pending review，三天没动，期间 API 拒绝任何上传（"item is in pending review"）。
而 1.6.5 的主打功能「播客模式出发前预载」是 **App 专属**的，Chrome 用户根本看不到 ——
用一个三天的审核周期换一个他们看不见的版本，然后立刻再排一次队，不值。1.6.6 是
1.6.5 的超集。

---

## Chrome Web Store · 中文

```
修复：在 Substack 这类用 React 渲染的网站上，开启翻译后选不中文字、超链接点不开。

原因是译文节点插在了页面框架管辖的容器里，导致每次选中文字都会让整篇文章的段落被
重新排布一遍——选区因此被清掉，鼠标按下和抬起之间段落已经换了位置，点击也就到不了
链接上。现在译文改为插入到原文段落内部，不再打扰页面自己的结构。

其他改进：
· 语音朗读连不上服务时，20 秒内明确报错并停下，不再干等到系统超时。
· 采集与复习的若干稳定性修复。

（「播客模式出发前预载」是 macOS / iOS App 的功能，浏览器扩展中不提供。）
```

## Chrome Web Store · English

```
Fixed: on React-rendered sites such as Substack, turning translation on made text
impossible to select and hyperlinks impossible to open.

The translation was being inserted as a sibling inside a container the page's own
framework owns, so every change of selection made the framework re-lay-out every
paragraph in the article — which wiped the selection, and moved the paragraph out
from under the pointer between mouse-down and mouse-up so the click never reached
the link. The translation now goes inside its own paragraph and leaves the page's
structure alone.

Also:
· When the speech endpoint cannot be reached it now says so and stops within 20
  seconds, instead of waiting for the system timeout.
· Stability fixes in capture and review.

(The podcast preload feature is part of the macOS / iOS app, not the extension.)
```

## Firefox AMO

同 Chrome 中文文案。AMO 的版本说明可留空——它的审核看的是包，不是文案。

## 判据（发布后回读）

```bash
curl -sL -o /tmp/v.zip "https://github.com/belliedmonkey/belliedmonkey-translator/releases/latest/download/belliedmonkey-translator-chrome.zip"
unzip -p /tmp/v.zip manifest.json | grep '"version"'                       # 1.6.6
unzip -p /tmp/v.zip content/content-webpage.js | grep -c 'CHILD_BOX'       # >0，渲染器修复在包里
unzip -p /tmp/v.zip content/i18n-messages.js | grep -c '\*\*'              # 0
```
