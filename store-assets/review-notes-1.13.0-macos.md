# 1.13.0 审核备注 · macOS 两线（国际版 + 中国版同文）

> Gate J-1（docs/learning-design.md §10）要求的三条。填在 App Store Connect › 该版本 ›「App 审核信息」›「备注」里，
> **提审前由人看一眼再提交**。审核员读英文，所以只有英文；下面的中文是给我们自己对照的。
> iOS 两线这一版没有新的权限或常驻行为，不需要这份备注。

```
New in 1.13.0 (macOS only): "Quick Translate" — translate text from any app into a small floating panel.

1. Menu bar item. The app keeps a menu bar item so its global shortcuts keep working after the main window is closed. This is on by default and can be turned off in Settings > Quick Translate > "Stay in the menu bar"; with it off, closing the window quits the app as before. The first time the window is closed, the app explains this.

2. "Enhanced Capture" (OFF by default). When the user turns it on, the app asks for permission using the system API CGRequestPostEventAccess — the system shows its own prompt and adds the app to the list by itself. The app never instructs users to add it manually in System Settings. With the permission, pressing the shortcut sends a single Cmd-C to the frontmost app, reads the selected text, and restores the previous clipboard contents byte for byte. It does not monitor the keyboard and does not read the clipboard in the background. Without the permission everything still works: the user copies first (Cmd-C) and then presses the shortcut, or uses the Services menu item.

3. Screenshot translation (Screen Recording permission). Requested only the first time the user triggers it, after an in-app explanation. The app captures only the rectangle the user drags, at that moment, recognises the text on-device with Vision, and discards the image. Nothing is written to disk. The image leaves the device only if on-device recognition finds nothing AND the user explicitly taps "Try again with my image-capable engine", which sends it to the translation service the user configured.

How to try it: copy any sentence, press Control-Option-T. Or select text in any app and choose Services > "Translate with BelliedMonkey". Translation uses the engine configured in the app's Settings.
```

## 对照（中文）

1. **常驻菜单栏**：为了主窗口关掉后全局快捷键仍可用；默认开，设置里可关，关掉后关窗即退出（同以前）；第一次关窗时会说明。
2. **增强取词（默认关）**：用的是系统的请求接口 `CGRequestPostEventAccess`，系统自己弹窗、自己把 App 加进列表，**我们不引导用户手动添加**；
   有权限后按快捷键只发一次 ⌘C、读选中的文字、把剪贴板逐字节还原；不监听键盘、不常驻读剪贴板；没有权限时照样能用（先 ⌘C 再按快捷键，或用「服务」）。
3. **截图翻译（录屏权限）**：第一次触发时才问，之前先有我们自己的说明；只截用户框的那一块、本机 Vision 识别、识别完即丢弃、不落盘；
   只有本机没认出来**且**用户点了「用我的识图引擎再试」，图片才会发给用户自己配置的引擎。
- 怎么试：复制一句话按 ⌃⌥T；或选中文字 › 服务 ›「Translate with BelliedMonkey」。
