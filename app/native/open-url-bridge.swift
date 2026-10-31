// app/native/open-url-bridge.swift — 接住外部打开这个 App 的 URL，转交给页面。
//
// 由 scripts/sync-app-assets.js 以标记块的形式贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 为什么需要它（learning-design §8.4.1.1）：扩展与 App 是两个面，两边登了不同账号时
// 此前**没有任何一侧发现得了** —— App 拉到 0 行，然后显示「先在浏览器里采集一些」，
// 反过来指责一个已经采集了一周的人。要发现它，就得有一个两边都认得的值跨过去。
// 跨过去的只有一个**不透明 userId**：不是会话（那里面有 token），也不是邮箱。
//
// 冷启动是这条路上最容易漏的一支：URL 可能在 WKWebView 还没就绪时就到了。所以这里
// 存一份 pending，等页面 attach 上来再送 —— 丢掉它的表现是「点了链接，App 打开了，
// 然后什么都没发生」，而那不会报任何错。
enum MTDeepLink {
    private static weak var webView: WKWebView?
    private static var pending: String?

    /// ViewController 就绪时调一次。会把冷启动期间攒下的那一条送出去。
    static func attach(_ view: WKWebView) {
        webView = view
        if let p = pending { pending = nil; deliver(p) }
    }

    /// 平台入口（iOS SceneDelegate / macOS AppDelegate）收到 URL 时调。
    static func handle(_ url: URL) {
        deliver(url.absoluteString)
    }

    private static func deliver(_ raw: String) {
        guard let view = webView else { pending = raw; return }
        // JSON 编码之后再拼，避免 URL 里的引号把这段脚本拆断。
        let data = try? JSONSerialization.data(withJSONObject: [raw], options: [])
        let arg = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        // 页面还没定义 __mtDeepLink 时（Main.html 尚未跑完）也存起来，由页面自己
        // 在准备好之后读 window.__mtDeepLinkPending。两边都兜住，链接才不会静默丢失。
        let js = """
        (function(){var u=\(arg)[0];
        if (typeof window.__mtDeepLink === 'function') { window.__mtDeepLink(u); }
        else { window.__mtDeepLinkPending = u; }})()
        """
        DispatchQueue.main.async { view.evaluateJavaScript(js, completionHandler: nil) }
    }
}
