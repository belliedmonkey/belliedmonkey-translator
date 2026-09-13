// app/native/file-panel-bridge.swift — macOS：让页面的 <input type=file> 真的弹出系统文件面板。
//
// 由 scripts/sync-app-assets.js 以标记块的形式贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 为什么需要它（learning-design §9.7 / 文档翻译 D5）：iOS 的 WKWebView 自己会弹「照片 / 浏览」
// 选择器；macOS 的 WKWebView **不会** —— 没有 WKUIDelegate.runOpenPanel 时点「上传文档」什么
// 都不发生，而且不报任何错（2026-09-11 探索时确认宿主没实现它）。这是「界面说它能做、其实
// 什么都没做」那一族里最安静的一种。
//
// 两条硬规矩：
//   · 取消也要调 completionHandler(nil) —— 漏了这一下，那个 <input> 就永远卡在「等结果」，
//     再点一次不会再弹（页面那侧 pickFile 的 change 监听也永远不 resolve）。
//   · 只读、只选文件；目录与多选按页面的参数走，不自作主张放宽。沙箱的 user-selected 只读
//     权限由转换器的 ENABLE_USER_SELECTED_FILES = readonly 提供，NSOpenPanel（powerbox）
//     选中的那一个文件即被授权，WebKit 自己把访问权带进 web 进程。
//
// 挂成 uiDelegate 的**唯一**持有者。以后要处理 JS alert / 新窗口也在这个类里加方法，
// 别再 new 一个 delegate 把它顶掉 —— uiDelegate 只有一个位置。
//
// 新窗口（2026-09-13 起也归这里）：页面里 `<a target="_blank">` 被点时，WebKit 问 uiDelegate
// 要一个新的 WKWebView；没有实现 createWebViewWith ⇒ 返回 nil ⇒ **什么都不发生，也不报错**。
// 中国版设置页「去开通 ↗」「还没有 key？去 通义千问 申请 ↗」点了没反应就是这个（用户报障）；
// 同一族还有复习页的来源链接、「▶ 重听这个片段」。这些链接写在扩展与 App 共用的组件里，
// 在扩展里本来就对，所以修在宿主：**用户亲手点的 https 链接**交给系统浏览器打开。
//   · 只认 linkActivated —— 脚本 window.open 不走这里（那一路有 open-url 桥和它的放行名单）。
//   · 只认 https —— 不开 file:、javascript:、自定义 scheme。
//   · 返回 nil，永远不在 App 里开第二个 WebView（在 App 内导航会把界面换掉且回不来）。
final class MTFilePanel: NSObject, WKUIDelegate {
    static let shared = MTFilePanel()

    /// ViewController 就绪时调一次（webView 最终确定之后）。
    static func attach(_ view: WKWebView) {
        view.uiDelegate = shared
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url,
              url.scheme?.lowercased() == "https" else { return nil }
#if os(iOS)
        UIApplication.shared.open(url)
#elseif os(macOS)
        NSWorkspace.shared.open(url)
#endif
        return nil
    }

#if os(macOS)
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canCreateDirectories = false
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        let finish: (NSApplication.ModalResponse) -> Void = { response in
            // 取消 ⇒ nil，不是空数组：WebKit 把 nil 当「用户取消」，<input> 回到可再点的状态。
            completionHandler(response == .OK ? panel.urls : nil)
        }
        if let window = webView.window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(panel.runModal())
        }
    }
#endif
}
