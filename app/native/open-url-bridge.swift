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
    // (b) 只有一条待送：新链接到达即覆盖 pending，并让 generation +1 —— 旧的重试链看到
    // generation 变了就自行停下，永远只送最新那一条。
    private static var pending: String?
    private static var pendingId: String?
    private static var generation = 0
    private static var timer: DispatchWorkItem?
    private static var loadObs: NSKeyValueObservation?
    private static var lifecycleObs: [NSObjectProtocol] = []
    private static var inBackground = false
    static let maxAttempts = 100              // × 100ms ≈ 10s
    static let retryInterval = 0.1

    /// ViewController 就绪时调一次。会把冷启动期间攒下的那一条送出去。
    static func attach(_ view: WKWebView) {
        webView = view
        // (c) Main.html 加载完成（isLoading 变 false）时补送仍挂着的那一条。
        loadObs = view.observe(\.isLoading, options: [.new]) { _, change in
            if change.newValue == false { DispatchQueue.main.async { resume("didFinish") } }
        }
        observeLifecycle()
        resume("attach")
    }

    /// 平台入口（iOS SceneDelegate / macOS AppDelegate）收到 URL 时调。
    static func handle(_ url: URL) {
        dispatchPrecondition(condition: .onQueue(.main))
        // (a) 每条链接一个 id（URL + 到达时刻 + 序号）；页面按 id 只处理一次，重发幂等。
        generation += 1
        pending = url.absoluteString
        pendingId = "\(Int(Date().timeIntervalSince1970 * 1000))-\(generation)"
        schedule(attempt: 0, delay: 0)
    }

    // (d) 计时器只在主线程；后台 / 页面销毁时停（pending 保留，回前台或页面就绪再送）。
    private static func observeLifecycle() {
        if !lifecycleObs.isEmpty { return }
        let nc = NotificationCenter.default
        #if os(macOS)
        let bg = NSApplication.didResignActiveNotification, fg = NSApplication.didBecomeActiveNotification
        #else
        let bg = UIApplication.didEnterBackgroundNotification, fg = UIApplication.willEnterForegroundNotification
        #endif
        lifecycleObs.append(nc.addObserver(forName: bg, object: nil, queue: .main) { _ in
            inBackground = true; cancelTimer() })
        lifecycleObs.append(nc.addObserver(forName: fg, object: nil, queue: .main) { _ in
            inBackground = false; resume("foreground") })
    }

    private static func cancelTimer() { timer?.cancel(); timer = nil }

    private static func resume(_ why: String) {
        guard pending != nil, timer == nil, !inBackground else { return }
        schedule(attempt: 0, delay: 0)
    }

    private static func schedule(attempt: Int, delay: Double) {
        cancelTimer()
        let gen = generation
        let w = DispatchWorkItem { timer = nil; deliver(gen: gen, attempt: attempt) }
        timer = w
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: w)
    }

    private static func deliver(gen: Int, attempt: Int) {
        guard gen == generation, let raw = pending, let id = pendingId else { return }   // (b) 旧链停下
        guard !inBackground else { return }                                               // (d)
        guard let view = webView else { return }   // (d) 页面没了：pending 留着，下次 attach 再送
        // JSON 编码之后再拼，避免 URL 里的引号把这段脚本拆断。
        let data = try? JSONSerialization.data(withJSONObject: [raw, id], options: [])
        let arg = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\",\"\"]"
        // D19：macOS 冷启动时 attach() 在 loadFileURL 之前就调了，open urls 到达时 webView 里
        // 还是初始空白文档 —— pending 写在那上面会随 Main.html 加载整份丢掉。所以只有当前文档
        // 已是 Main.html 才落地；否则回 'wait'。(a) 同一 id 只落地一次（__mtDeepLinkSeen）。
        let js = """
        (function(){var a=\(arg),u=a[0],id=a[1];
        if (String(location.pathname || '').indexOf('Main.html') < 0) { return 'wait'; }
        if (window.__mtDeepLinkSeen === id) { return 'ok'; }
        window.__mtDeepLinkSeen = id;
        if (typeof window.__mtDeepLink === 'function') { window.__mtDeepLink(u); return 'ok'; }
        window.__mtDeepLinkPending = u; return 'ok';})()
        """
        view.evaluateJavaScript(js) { result, _ in
            // evaluateJavaScript 的回调在主线程。
            guard gen == generation else { return }
            if (result as? String) == "ok" {
                if pendingId == id { pending = nil; pendingId = nil }
                cancelTimer(); return
            }
            if attempt + 1 >= maxAttempts {
                // (c) 超时不丢：pending 原样留着，等 didFinish / 回前台 / 下次 attach 再送。
                NSLog("[MTDeepLink] deliver timed out after %d attempts; kept pending id=%@", maxAttempts, id)
                return
            }
            schedule(attempt: attempt + 1, delay: retryInterval)
        }
    }
}
