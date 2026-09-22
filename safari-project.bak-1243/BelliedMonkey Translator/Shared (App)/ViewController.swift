//
//  ViewController.swift
//  Shared (App)
//
//  Created by belliedmonkey on 2026/9/8.
//

import WebKit

// ─── BEGIN mt-file-panel (generated — do not edit here) ───
// Source: app/native/file-panel-bridge.swift · written by scripts/sync-app-assets.js.
// Edit the repo file and re-run `npm run app:sync`; edits made here are overwritten.
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
final class MTFilePanel: NSObject, WKUIDelegate {
    static let shared = MTFilePanel()

    /// ViewController 就绪时调一次（webView 最终确定之后）。
    static func attach(_ view: WKWebView) {
        view.uiDelegate = shared
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
// ─── END mt-file-panel ───


// ─── BEGIN mt-review-bridge (generated — do not edit here) ───
// Source: app/native/review-bridge.swift · written by scripts/sync-app-assets.js.
// Edit the repo file and re-run `npm run app:sync`; edits made here are overwritten.
// app/native/review-bridge.swift — 系统评分弹窗（SKStoreReviewController）。
//
// 由 scripts/sync-app-assets.js 以标记块的形式贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 页面在「一轮复习刷完」之后经 controller 通道发 "request-review"（learn/feedback.js
// 的 maybeRequestRating，本机 90 天冷却）。系统再节流一层：Apple 每 365 天最多弹 3 次，
// 而且弹不弹不告诉我们 —— 所以这里没有回调，也不该有：它不是一个能「确认成功」的动作。
//
// 2026-09-05 的数字：30 天 202 次下载，App Store 两个条目 0 条评论。85% 的量来自
// 商店自然搜索，评分是那条渠道里唯一能动的社会证明。
import StoreKit

enum MTReview {
    static func request() {
        DispatchQueue.main.async {
#if os(iOS)
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }) else { return }
            SKStoreReviewController.requestReview(in: scene)
#elseif os(macOS)
            SKStoreReviewController.requestReview()
#endif
        }
    }
}
// ─── END mt-review-bridge ───


// ─── BEGIN mt-apple-signin (generated — do not edit here) ───
// Source: app/native/apple-signin-bridge.swift · written by scripts/sync-app-assets.js.
// Edit the repo file and re-run `npm run app:sync`; edits made here are overwritten.
// app/native/apple-signin-bridge.swift — 原生第三方登录：Apple（id_token）与 Google
// （ASWebAuthenticationSession → 一次性 code），结果都交给页面。
//
// 由 scripts/sync-app-assets.js 以标记块的形式贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 为什么要原生而不是在 WKWebView 里跑网页流程（learning-design §8.4.1.2）：
// 网页流程要弹一个浏览器、要 secret、要回调地址，而 App 里这三样都是多余的 ——
// 系统自己就能签一个 id_token 出来。而且苹果 4.8 要求 App **必须**提供 Sign in with
// Apple，用一个套着浏览器的版本去满足它，体验上是明显不如原生的那一档。
//
// 跨过桥的只有两样：**id_token 与 nonce**。不是会话、不是邮箱、不是姓名 ——
// 页面拿这两样去 Supabase 换会话，会话从头到尾只在页面那一侧。
//
// nonce 的形状是苹果规定的：送进 ASAuthorization 的必须是 **sha256 之后的十六进制**，
// 而送给 Supabase 的必须是**原始那一串**。两边填反是这条链上最常见的失败，
// 而失败信息是「Invalid token」，指不到这里。

import AuthenticationServices
import CryptoKit

@available(iOS 13.0, macOS 10.15, *)
final class MTAppleSignIn: NSObject, ASAuthorizationControllerDelegate,
                           ASAuthorizationControllerPresentationContextProviding {
    static let shared = MTAppleSignIn()
    private weak var webView: WKWebView?
    private var rawNonce: String = ""
    // 强引用住自己那一次的 controller：ASAuthorizationController 不持有 delegate，
    // 而局部变量出了作用域就没了 —— 表现是「点了按钮，弹窗一闪而过，什么都没发生」。
    private var controller: ASAuthorizationController?

    static func attach(_ view: WKWebView) { shared.webView = view }

    /// 页面调 window.webkit.messageHandlers.mtAppleSignIn.postMessage({}) 时进来。
    static func start() { shared.begin() }

    private func begin() {
        rawNonce = MTAppleSignIn.randomNonce()
        let req = ASAuthorizationAppleIDProvider().createRequest()
        req.requestedScopes = [.email]          // 只要邮箱。姓名我们不用，也就不要。
        req.nonce = MTAppleSignIn.sha256Hex(rawNonce)
        let c = ASAuthorizationController(authorizationRequests: [req])
        c.delegate = self
        c.presentationContextProvider = self
        controller = c
        c.performRequests()
    }

    // MARK: - 结果

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        self.controller = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = cred.identityToken,
              let token = String(data: data, encoding: .utf8) else {
            deliver(error: "no_identity_token")
            return
        }
        deliver(token: token, nonce: rawNonce)
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        self.controller = nil
        // 用户自己取消**不是错误**，别把它画成失败 —— 那会让人以为登录坏了。
        let code = (error as NSError).code
        if code == ASAuthorizationError.canceled.rawValue { deliver(error: "canceled"); return }
        deliver(error: "apple_failed")
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if os(macOS)
        return webView?.window ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #else
        return webView?.window ?? UIApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }

    // MARK: - 交给页面

    private func deliver(token: String? = nil, nonce: String? = nil, error: String? = nil) {
        var payload: [String: Any] = [:]
        if let t = token { payload["idToken"] = t }
        if let n = nonce { payload["nonce"] = n }
        if let e = error { payload["error"] = e }
        let data = try? JSONSerialization.data(withJSONObject: [payload], options: [])
        let arg = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[{\"error\":\"encode\"}]"
        // 与 deeplink 同一个形状：页面没准备好就存 pending，两边都兜住。
        let js = """
        (function(){var r=\(arg)[0];
        if (typeof window.__mtAppleResult === 'function') { window.__mtAppleResult(r); }
        else { window.__mtApplePending = r; }})()
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - nonce

    private static func randomNonce(_ length: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        // base64url：nonce 会原样进 JWT，非 URL 安全的字符在那条路上会被改写。
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func sha256Hex(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Google：走 ASWebAuthenticationSession，**不能**在 WKWebView 里跑。
///
/// Google 明确禁止在内嵌 WebView 里做 OAuth（`disallowed_useragent`），所以 App 里
/// 这条必须交给系统的鉴权会话。它长得像浏览器、但由系统持有，Google 认它。
///
/// 回调用我们自己已经注册好的自定义 scheme（`belliedmonkey://` / `belliedmonkeycn://`，
/// 见 sync-app-assets 的 urlTypeXml）—— 不必再登记一个新的。
///
/// 跨桥的只有 **code 与 state**，和扩展那条路完全一样：没有 verifier 它换不出东西，
/// 而 verifier 只在页面那一侧（learning-design §8.4.1.1 第二条跨界裁定）。
@available(iOS 13.0, macOS 10.15, *)
final class MTWebAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = MTWebAuth()
    private weak var webView: WKWebView?
    // 强引用住会话：ASWebAuthenticationSession 出了作用域就会被回收，
    // 表现是「弹窗一闪而过」——同 ASAuthorizationController 的那个坑。
    private var session: ASWebAuthenticationSession?

    static func attach(_ view: WKWebView) { shared.webView = view }

    /// 页面把整条 authorize URL 与回调 scheme 递进来。**URL 由页面算**（PKCE 的
    /// challenge 在那一侧），原生这边只负责把系统鉴权会话开起来。
    static func start(url: String, scheme: String) { shared.begin(url: url, scheme: scheme) }

    private func begin(url: String, scheme: String) {
        guard let u = URL(string: url) else { deliver(error: "bad_url"); return }
        let s = ASWebAuthenticationSession(url: u, callbackURLScheme: scheme) { [weak self] cb, err in
            self?.session = nil
            if let e = err as NSError?,
               e.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                self?.deliver(error: "canceled"); return       // 取消不是错误
            }
            guard let cb = cb,
                  let items = URLComponents(url: cb, resolvingAgainstBaseURL: false)?.queryItems else {
                self?.deliver(error: "no_callback"); return
            }
            let get = { (n: String) in items.first { $0.name == n }?.value }
            guard let code = get("code") else { self?.deliver(error: get("error") ?? "no_code"); return }
            // 只带 code 回去。回跳地址不许带查询串（Supabase 白名单是精确匹配），
            // 所以我们自己的 state 不绕这一圈；绑定由页面那一侧的 code_verifier 承担。
            self?.deliver(code: code, state: get("st"))
        }
        s.presentationContextProvider = self
        // 每次都用干净的会话：留着上一次的 cookie，换账号时会**静默**登回上一个人。
        s.prefersEphemeralWebBrowserSession = true
        session = s
        s.start()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return webView?.window ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #else
        return webView?.window ?? UIApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }

    private func deliver(code: String? = nil, state: String? = nil, error: String? = nil) {
        var payload: [String: Any] = [:]
        if let c = code { payload["code"] = c }
        if let st = state { payload["state"] = st }
        if let e = error { payload["error"] = e }
        let data = try? JSONSerialization.data(withJSONObject: [payload], options: [])
        let arg = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[{\"error\":\"encode\"}]"
        let js = """
        (function(){var r=\(arg)[0];
        if (typeof window.__mtWebAuthResult === 'function') { window.__mtWebAuthResult(r); }
        else { window.__mtWebAuthPending = r; }})()
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

/// 页面 → 原生 的收信端。
///
/// 单独一个类而不是让 MTAppleSignIn 自己实现 WKScriptMessageHandler：
/// userContentController.add 会**强引用** handler，而 MTAppleSignIn 持有 webView 的弱引用；
/// 让同一个对象既被 WKWebView 强持有、又持有 webView，是那种在别处才炸的循环。
@available(iOS 13.0, macOS 10.15, *)
final class MTAppleSignInRelay: NSObject, WKScriptMessageHandler {
    static let shared = MTAppleSignInRelay()
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "mtAppleSignIn" else { return }
        // 一个通道两种用法：不带参数 = 原生 Apple；带 url/scheme = 系统鉴权会话（Google）。
        // 多开一个通道意味着多一处 add() 与多一处补丁锚点，而这两件事本质是同一件：
        // 「页面请原生去完成一次登录」。
        if let d = message.body as? [String: Any],
           let url = d["url"] as? String, let scheme = d["scheme"] as? String {
            if #available(iOS 13.0, macOS 10.15, *) { MTWebAuth.start(url: url, scheme: scheme) }
            return
        }
        MTAppleSignIn.start()
    }
}
// ─── END mt-apple-signin ───


// ─── BEGIN mt-deeplink-bridge (generated — do not edit here) ───
// Source: app/native/open-url-bridge.swift · written by scripts/sync-app-assets.js.
// Edit the repo file and re-run `npm run app:sync`; edits made here are overwritten.
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
// ─── END mt-deeplink-bridge ───


// ─── BEGIN mt-audio-bridge (generated — do not edit here) ───
// Source: app/native/audio-bridge.swift · written by scripts/sync-app-assets.js.
// Edit the repo file and re-run `npm run app:sync`; edits made here are overwritten.
// app/native/audio-bridge.swift — 播客模式 (§9.5「后台与锁屏播放」) 的原生一半。
//
// 这个文件**不是 Xcode 工程的成员**。`scripts/sync-app-assets.js` 在每次
// `npm run app:sync` 时把它整块贴进 `Shared (App)/ViewController.swift`
// （`import WebKit` 之后，一对 BEGIN/END 标记之间）。要改它就改这里，
// 改工程里那一份会在下一次 app:sync 时被原样覆盖。
//
// 为什么是「贴进已有文件」而不是「加一个源文件」：`safari-project*/` 是
// safari-web-extension-converter 的一次性产物，重新生成会重置 pbxproj 的文件清单。
// 贴进一个**本来就在 target 里**的文件，就永远不需要碰 PBXFileReference / PBXBuildFile
// —— 那是最容易被重生成打回原形的地方（learning-design §12，2026-08-17 那行否决的正题）。
//
// 为什么不是内联在 sync-app-assets.js 的 JS 字符串里：一百多行 Swift 拼在字符串里
// 没有高亮、没有编译器、`\(...)` 要和 JS 转义打架、git blame 全落在一行 `+` 上。
// 同一个理由让 macOS 菜单补丁写成了数据而不是字面量。
//
// ── 零文案纪律 ───────────────────────────────────────────────────────────────
// 这个文件里**没有一个用户可见的字**。锁屏/控制中心上显示的每一个字都由 JS 传进来，
// 因此照常走 `_locales/` 的 11 份 messages.json。原生侧一旦自己写文案，那句话就永远
// 不会被翻译，也永远不会跟着产品名改。
//
// ── 两个平台，两半代码 ──────────────────────────────────────────────────────
//   iOS   : 进程会被挂起 ⇒ 需要 UIBackgroundModes: audio + AVAudioSession(.playback)
//   macOS : 进程不会被挂起 ⇒ 后台播放无条件成立，这里只装媒体遥控那一半
// `AVAudioSession` 是 iOS-only 的 API，macOS 上不存在，所以会话那一半整个在 #if os(iOS) 里。
import WebKit
import AVFoundation
import MediaPlayer
#if os(iOS)
import ActivityKit
#endif

#if os(iOS)
/// Live Activity 的属性（§9.5 灵动岛）。**这份定义在两个 target 各编译一份**
/// （App 与 Widget 扩展），所以它和 `app/native/widget/LiveActivity.swift` 里那份
/// 必须逐字一致 —— 字段名对不上时不会编译报错，只会在运行时解码失败、岛上什么都不显示。
/// `npm test` 有一条断言逐字比对这两处。
struct MTPodcastAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var subtitle: String
        var progress: String
        var playing: Bool
    }
    var sessionId: String
}
#endif

#if os(iOS)
import UIKit
typealias MTImage = UIImage
#else
import AppKit
typealias MTImage = NSImage
#endif

/// 把 App 内 web 视图里的播客播放器接到系统音频栈上：音频会话（iOS）、
/// 媒体遥控与「正在播放」（两个平台）。
final class MTAudioBridge: NSObject, WKScriptMessageHandler {

    static let shared = MTAudioBridge()

    /// 通道名。JS 侧 `window.webkit.messageHandlers.mtAudio` 与
    /// sync-app-assets.js 的 install 行必须用同一个字符串 —— `npm test` 有一条断言钉住这三处。
    static let channel = "mtAudio"

    private weak var webView: WKWebView?
    private var commandsInstalled = false

    /// 当前卡片的封面（由 JS 画好送过来）。锁屏那一档用它。
    private var cardArt: MTImage?
#if os(iOS)
    /// 当前的 Live Activity。iOS 16.1+ 才有 —— 低版本上它恒为 nil，灵动岛那一半
    /// 不存在，其余（后台播放、锁屏封面、遥控）照常。能力语义，不是降级。
    private var activityBox: Any?
#endif
    /// 系统实际用哪些尺寸来问封面 —— Apple 没有公开这件事，所以这里如实记下来
    /// 回传给 JS，让「小尺寸阈值」由实测决定而不是猜。只回传没见过的尺寸。
    private var seenArtSizes = Set<Int>()

    /// 小于这个宽度（pt）就给 App 图标，不给卡片：那个尺寸上放不下一个句子，
    /// 缩过去只会是一团糊 —— 灵动岛那个「问号」位就在这一档。
    /// **这是个待实测的初值**，见 seenArtSizes。
    private static let iconMaxWidth: CGFloat = 120

    // MARK: - 安装

    /// 由 ViewController.viewDidLoad 调用（补丁插入）。可以被调用多次而不出事。
    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        // 先摘再挂：同名 handler 重复注册在 WebKit 里是 fatal error，而 viewDidLoad
        // 在某些生命周期下确实会跑第二次。
        ucc.removeScriptMessageHandler(forName: MTAudioBridge.channel)
        ucc.add(self, name: MTAudioBridge.channel)

#if os(iOS)
        let nc = NotificationCenter.default
        nc.removeObserver(self)
        nc.addObserver(self, selector: #selector(onInterruption(_:)),
                       name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(onRouteChange(_:)),
                       name: AVAudioSession.routeChangeNotification, object: nil)
        // 屏幕常亮要在每次回前台重申一次。`isIdleTimerDisabled` 只在 viewDidLoad 设过
        // 一次，而它只在 App 处于前台时被系统尊重 —— 从后台回来之后不重申，播客模式
        // 放着放着屏幕就自己灭了，而用户看到的只是「屏幕黑了」，无从归因。
        //
        // 注意这解决的**不是**「锁屏后保持亮屏」：那件事第三方 App 做不到，手动锁屏后
        // 屏幕必灭，唯一能让锁屏内容持续可见的是系统的「息屏常显」。
        nc.addObserver(self, selector: #selector(onDidBecomeActive),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
#endif
    }

    // MARK: - JS → 原生

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // 安全解包，不是 `as!`：一个形状对不上的 body 应该被忽略，不该让 App 崩掉。
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "session-start":  startSession()
        case "session-stop":   stopSession()
        case "now-playing":    updateNowPlaying(body); updateActivity(body)
        case "now-playing-artwork": updateArtwork(body)
        case "playing-state":  updatePlaybackState(body)
        case "record-mode":    recordMode = (body["on"] as? Bool) ?? false   // 实时听译（§9.6）
        case "mic-start":      micStart(rate: (body["rate"] as? Double) ?? 24000)
        case "mic-stop":       micStop()
        default: break   // 未知类型静默忽略：JS 比原生新是半同步开发树的常态
        }
    }

    // MARK: - 麦克风（§9.6 对话·实时听译 —— 原生采集）
    //
    // 为什么在这儿而不在网页里：WebKit 在 App 不可见时一律静音页内的 getUserMedia
    // （2026-09-07 真机三轮实证：锁屏期间采集帧恒为 0，页面一可见立刻恢复；页内音频
    // 保活只能保住 JS，保不住采集）。AVAudioEngine 的输入 tap 不受这条限制 —— 只要
    // 会话是 .playAndRecord 且声明了 UIBackgroundModes: audio，锁屏后照常出块。
    //
    // 形状：inputNode 的原生格式 → AVAudioConverter → 单声道 Int16 @ 请求的采样率
    // （注册表 liveRate，OpenAI 是 24 kHz）→ base64 → 一条 `mic-pcm`。每块 ≈ 85 ms
    // （4096 帧 @ 48 kHz），≈ 12 条/s、≈ 64 KB/s base64 —— evaluateJavaScript 扛得住。
    //
    // 权限由这里一次性要（AVAudioApplication / AVAudioSession），不再让 WKWebView 每次
    // 重装都重新弹。拒绝 ⇒ `mic-state denied`，JS 那边有一句指路文案。

    private var micEngine: AVAudioEngine?
    private var micConverter: AVAudioConverter?
    private var micOutFormat: AVAudioFormat?

    private func micStart(rate: Double) {
        micStop()
        requestMicPermission { [weak self] granted in
            guard let self = self else { return }
            guard granted else { self.emit(["type": "mic-state", "state": "denied"]); return }
            self.micBegin(rate: rate)
        }
    }

    private func requestMicPermission(_ done: @escaping (Bool) -> Void) {
#if os(iOS)
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { ok in DispatchQueue.main.async { done(ok) } }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { ok in DispatchQueue.main.async { done(ok) } }
        }
#else
        AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async { done(ok) } }
#endif
    }

    private func micBegin(rate: Double) {
#if os(iOS)
        // 录音会话：不管 JS 有没有先发 record-mode，这里都把类别钉成可录的那一档。
        // 漏掉这一步的表现是「权限给了、tap 装了、块里全是 0」—— 查起来极贵。
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
            try session.setActive(true)
        } catch {
            emit(["type": "mic-state", "state": "failed", "reason": String(describing: error)])
            return
        }
#endif
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
            emit(["type": "mic-state", "state": "failed", "reason": "input-format"])
            return
        }
        guard let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: inFormat, to: outFormat) else {
            emit(["type": "mic-state", "state": "failed", "reason": "converter"])
            return
        }
        micEngine = engine
        micConverter = converter
        micOutFormat = outFormat
        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buffer, _ in
            self?.micDeliver(buffer)
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            micEngine = nil; micConverter = nil; micOutFormat = nil
            emit(["type": "mic-state", "state": "failed", "reason": String(describing: error)])
            return
        }
        emit(["type": "mic-state", "state": "granted"])
    }

    private func micDeliver(_ buffer: AVAudioPCMBuffer) {
        guard let converter = micConverter, let outFormat = micOutFormat else { return }
        let ratio = outFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
        let bytes = Data(bytes: ch[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size)
        emit(["type": "mic-pcm", "b64": bytes.base64EncodedString()])
    }

    private func micStop() {
        guard let engine = micEngine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        micEngine = nil; micConverter = nil; micOutFormat = nil
        emit(["type": "mic-state", "state": "ended"])
    }

    /// 实时听译要的是「一边录一边（可能）放」的会话；播客模式仍是只放不录。
    /// 由 JS 在 session-start 之前用 record-mode 声明，原生只在建会话时读它。
    private var recordMode = false

    private func startSession() {
#if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            // .playback = 「这是内容音频，静音键不该关掉它，后台要继续」。
            // .spokenAudio = 口播语义：蓝牙/车机路由与「暂停别人的播客」都按这个来。
            // 不加 .mixWithOthers —— 播客模式就是要接管，混着播等于两个人同时说话。
            if recordMode {
                // .playAndRecord + 扬声器 + 蓝牙 + 可混音：线下对话手机放桌上，声音要从外放出、耳机要能用；
                // **可混音是必须的** —— 页内的保活音频与朗读走 WebKit 自己（GPU 进程）的音频会话，不可混音的
                // 录音会话会被它当场打断（2026-09-07 真机：TestFlight 84 一进来就「录音被系统停止了」）。
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
            } else {
                try session.setCategory(.playback, mode: .spokenAudio, options: [])
            }
            try session.setActive(true)
        } catch {
            // 建不起来就如实说，让 JS 退回「隐藏即暂停」的老行为，而不是继续假装能后台播。
            emit(["type": "session-failed", "reason": String(describing: error)])
            return
        }
#endif
        installCommands()
        // `suspends` 是 JS 用来判断「隐藏之后还能不能出声」的唯一依据。由原生报，
        // 而不是让 JS 去嗅 UA —— domain-design §5.3 规则 2 禁止用 UA 做能力判断，
        // 而这恰恰是一个平台能力问题：iOS 会挂起进程，macOS 不会。
#if os(iOS)
        emit(["type": "session-ready", "platform": "ios", "suspends": true])
#else
        emit(["type": "session-ready", "platform": "macos", "suspends": false])
#endif
    }

    private func stopSession() {
        micStop()
        endActivity()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
#if os(iOS)
        // .notifyOthersOnDeactivation：让刚才被我们打断的那个 App 能自己恢复。
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
#endif
    }

    private func installCommands() {
        guard !commandsInstalled else { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget            { [weak self] _ in self?.remote("play");     return .success }
        center.pauseCommand.addTarget           { [weak self] _ in self?.remote("pause");    return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.remote("toggle");   return .success }
        center.nextTrackCommand.addTarget       { [weak self] _ in self?.remote("next");     return .success }
        // 「上一曲」= 再听一遍。播客模式没有「上一张」：随机是一次性排列，往回退没有定义。
        center.previousTrackCommand.addTarget   { [weak self] _ in self?.remote("previous"); return .success }

        for command in [center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
                        center.nextTrackCommand, center.previousTrackCommand] {
            command.isEnabled = true
        }
        // 一张卡三遍五段，任何进度条都会撒谎 —— 时间轴一律不给。
        for command in [center.changePlaybackPositionCommand, center.seekForwardCommand,
                        center.seekBackwardCommand, center.skipForwardCommand,
                        center.skipBackwardCommand] {
            command.isEnabled = false
        }
    }

    // MARK: - 「正在播放」

    private func updateNowPlaying(_ body: [String: Any]) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle]      = body["title"] as? String ?? ""
        info[MPMediaItemPropertyArtist]     = body["subtitle"] as? String ?? ""
        info[MPMediaItemPropertyAlbumTitle] = body["album"] as? String ?? ""
        // 无时间轴 ⇒ 系统不画拖动条。见 installCommands 里关掉 seek 的同一个理由。
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        info.removeValue(forKey: MPMediaItemPropertyPlaybackDuration)
        info.removeValue(forKey: MPNowPlayingInfoPropertyElapsedPlaybackTime)
        if let index = body["index"] as? Int, let count = body["count"] as? Int, count > 0 {
            info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = index
            info[MPNowPlayingInfoPropertyPlaybackQueueCount] = count
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - 灵动岛（Live Activity）

    // 系统的媒体形态在收起态只给「图标 + 波形」，第三方加不了字 —— 想在岛上看到
    // 正在念的是哪一句，只有 Live Activity 一条路。它与系统媒体形态**并存**，
    // 岛上会挤，这是已知代价（§9.5）。
    //
    // iOS 16.1 以下：`activityBox` 恒为 nil，这一半整个不存在，其余照常。
    private func startActivity(_ body: [String: Any]) {
#if os(iOS)
        guard #available(iOS 16.1, *), activityBox == nil else { return }
        // 用户可以在系统设置里关掉实时活动 —— 关了就别再试，也不该有任何提示：
        // 那是他自己的选择，不是一个要解释的故障。
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = contentState(body)
        do {
            activityBox = try Activity.request(
                attributes: MTPodcastAttributes(sessionId: UUID().uuidString),
                contentState: state, pushType: nil)
        } catch {
            // 起不来就算了。灵动岛是锦上添花，绝不能因为它影响播放。
            activityBox = nil
        }
#endif
    }

    private func updateActivity(_ body: [String: Any]) {
#if os(iOS)
        guard #available(iOS 16.1, *) else { return }
        guard let activity = activityBox as? Activity<MTPodcastAttributes> else {
            // 还没起来（会话刚开始、或上一次起失败）：拿这条 now-playing 当种子起一个。
            startActivity(body)
            return
        }
        let state = contentState(body)
        Task { await activity.update(using: state) }
#endif
    }

    private func endActivity() {
#if os(iOS)
        guard #available(iOS 16.1, *),
              let activity = activityBox as? Activity<MTPodcastAttributes> else { return }
        activityBox = nil
        // `.immediate`：会话结束了，岛上不该再留一条已经不动的信息。
        Task { await activity.end(dismissalPolicy: .immediate) }
#endif
    }

#if os(iOS)
    @available(iOS 16.1, *)
    private func contentState(_ body: [String: Any]) -> MTPodcastAttributes.ContentState {
        MTPodcastAttributes.ContentState(
            title: body["title"] as? String ?? "",
            subtitle: body["subtitle"] as? String ?? "",
            progress: body["album"] as? String ?? "",
            playing: lastPlaying)
    }
    /// 播放状态由 `playing-state` 单独送来，而 Live Activity 的一次更新要带上全部字段
    /// —— 所以这里存一份最后已知值。
    private var lastPlaying = true
#endif

    // MARK: - 封面

    /// data URL → 图片。只认 base64 那一种（JS 侧是 canvas.toDataURL，永远是它）。
    private func decode(_ dataUrl: String) -> MTImage? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let b64 = String(dataUrl[dataUrl.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return MTImage(data: data)
    }

    /// 小尺寸那一档：App 图标。原生这边本来就有（Assets.xcassets），不用过桥传。
    private func appIcon() -> MTImage? {
#if os(iOS)
        return UIImage(named: "AppIcon")
#else
        return NSApp.applicationIconImage
#endif
    }

    /// 按系统要的尺寸重画一张。**这不是优化，是契约**：`requestHandler` 的文档写的是
    /// 「Returns the artwork image for an item at a given size」，不管要多大都甩回一张
    /// 1024² 是常见的「代码跑了但封面就是不显示」的原因。
    private func scaled(_ image: MTImage, to size: CGSize) -> MTImage {
        guard size.width > 0, size.height > 0 else { return image }
#if os(iOS)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.opaque = true
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
#else
        let out = NSImage(size: size)
        out.lockFocus()
        image.draw(in: CGRect(origin: .zero, size: size))
        out.unlockFocus()
        return out
#endif
    }

    private func updateArtwork(_ body: [String: Any]) {
        guard let url = body["image"] as? String, let image = decode(url) else { return }
        cardArt = image
        let icon = appIcon()
        let art = MPMediaItemArtwork(boundsSize: image.size) { [weak self] size in
            guard let self = self else { return image }
            self.noteArtSize(size)
            let source = (size.width > 0 && size.width < MTAudioBridge.iconMaxWidth && icon != nil)
                ? icon! : (self.cardArt ?? image)
            return self.scaled(source, to: size)
        }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = art
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func noteArtSize(_ size: CGSize) {
        let w = Int(size.width), h = Int(size.height)
        let key = w * 100_000 + h
        DispatchQueue.main.async {
            guard !self.seenArtSizes.contains(key) else { return }
            self.seenArtSizes.insert(key)
            // 宽高按数字送，不在原生这边拼串：这个文件一个字符串字面量都不该多出来
            // （零文案纪律有测试钉着），而结构化数据本来也更好用。
            self.emit(["type": "artwork-size", "w": w, "h": h])
        }
    }

    private func updatePlaybackState(_ body: [String: Any]) {
        let playing = (body["playing"] as? Bool) ?? false
#if os(iOS)
        if #available(iOS 16.1, *) {
            lastPlaying = playing
            // 暂停/继续要在岛上立刻看得出来 —— 用最后已知的文案重发一次。
            if let activity = activityBox as? Activity<MTPodcastAttributes> {
                let state = MTPodcastAttributes.ContentState(
                    title: activity.contentState.title, subtitle: activity.contentState.subtitle,
                    progress: activity.contentState.progress, playing: playing)
                Task { await activity.update(using: state) }
            }
        }
#endif
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
#if os(iOS)
        if playing {
            // WebKit 每开一个 <audio> 都会按它自己的判断动一次音频会话类别。重申一次的
            // 代价是零，而漏掉一次的代价是「播到第三段忽然不能后台了」这种查不到的 bug。
            //
            // 实时听译（§9.6）也发这条消息（锁屏卡片的播放态），那时必须重申成**可录**的
            // 那一档 —— 2026-09-07 真机实证：结束再开始时这句把类别打回 .playback，
            // 麦克风引擎随即起不来（第一次能成只是因为权限查询把引擎启动排到了它后面）。
            if recordMode || micEngine != nil {
                try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
            } else {
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
            }
        }
#endif
    }

    // MARK: - 原生 → JS

#if os(iOS)
    @objc private func onInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            emit(["type": "interrupt", "phase": "begin"])
            // 录音中被打断（来电等）：引擎已被系统停掉，如实说，JS 那边停在具名态。
            if micEngine != nil { micStop(); emit(["type": "mic-state", "state": "interrupted"]) }
            return
        }
        let options = AVAudioSession.InterruptionOptions(
            rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        // `.shouldResume` 是系统在说「刚才那件事结束了，你可以接着播」。只有它为真才自动续播
        // —— 播放器不得在一次真正的中断之后自作主张地重新开口（§9.5）。
        let shouldResume = options.contains(.shouldResume)

        // ⚠️ 这次重新激活**必须留在这个 if 里**。它曾经是无条件的，那是个真缺陷：
        //
        // 中断的定义就是「系统停用了我们的会话」（Apple: "An audio interruption is the
        // deactivation of your app's audio session"），所以 `.ended` 时会话确实是非活跃的
        // —— 看起来「当然该重新激活一下」。但 `setActive(true)` 不是一个读操作，是**抢占**：
        // 我们的类别是 .playback（非混音），激活它就会打断当时正在出声的任何东西。而
        // shouldResume 为假时我们**不播**，于是结果是「我们占着一个活跃的非混音会话却一个
        // 字都不出」—— 最坏表现是**两边都没声**：刚开始播的音乐被我们掐掉，我们自己不响，
        // 屏幕上没有任何变化。这种静音在真机上几乎不可能归因。
        //
        // 只在真的要接着播时才激活。`test/build-scripts.test.js` 有一条断言钉住这个顺序。
        if shouldResume {
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        emit(["type": "interrupt", "phase": "end", "resume": shouldResume])
    }

    @objc private func onDidBecomeActive() {
        UIApplication.shared.isIdleTimerDisabled = true
    }

    @objc private func onRouteChange(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        // 耳机被拔了。暂停，且重连时**不**自动播 —— 拔掉耳机后从外放里冒出声音是所有
        // 音乐 App 都在避免的那件事。
        emit(["type": "route", "change": "device-lost"])
    }
#endif

    private func remote(_ command: String) {
        emit(["type": "remote", "command": command])
    }

    private func emit(_ payload: [String: Any]) {
        guard let webView = self.webView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            // 短路写法是必须的：这条通道在页面还没加载完、或者宿主里根本没有播客模式时
            // 会打到一个不存在的全局上。converter 模板自带的 `show('ios')` 就是这么一直在
            // 静默抛 ReferenceError 的（app.js 的 show 在 IIFE 里，从来不是全局）。
            webView.evaluateJavaScript(
                "window.NativeAudio && window.NativeAudio._fromNative(\(json))",
                completionHandler: nil)
        }
    }
}
// ─── END mt-audio-bridge ───


#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "com.belliedmonkeytranslator.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

#if os(iOS)
        // Patched by scripts/sync-app-assets.js — lift the media user-gesture
        // gate. The storyboard web view copied its configuration at init, so it
        // must be recreated with the configuration the review page needs:
        // speech playback is "tap → async fetch → play()", which the default
        // policy rejects; auto-read is a feature here.
        let mtConf = WKWebViewConfiguration()
        mtConf.allowsInlineMediaPlayback = true
        mtConf.mediaTypesRequiringUserActionForPlayback = []
        let mtFresh = WKWebView(frame: self.webView.frame, configuration: mtConf)
        mtFresh.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.webView.superview?.addSubview(mtFresh)
        self.webView.removeFromSuperview()
        self.webView = mtFresh
#endif

        self.webView.navigationDelegate = self
        // Patched by scripts/sync-app-assets.js — macOS 文件面板（§9.7 文档翻译）：没有它 <input type=file> 是死按钮。
        MTFilePanel.attach(self.webView)

        // Patched by scripts/sync-app-assets.js — 原生 Sign in with Apple（§8.4.1.2）。
        if #available(iOS 13.0, macOS 10.15, *) {
            MTAppleSignIn.attach(self.webView)
            MTWebAuth.attach(self.webView)
            self.webView.configuration.userContentController.add(
                MTAppleSignInRelay.shared, name: "mtAppleSignIn")
        }

        // Patched by scripts/sync-app-assets.js — 跨面交接（learning-design §8.4.1.1）。
        MTDeepLink.attach(self.webView)
#if os(iOS)
        // Patched by scripts/sync-app-assets.js — 播客模式 (§9.5) is continuous
        // foreground audio with no touches; the idle timer would lock the phone
        // mid-card and stop the speech.
        UIApplication.shared.isIdleTimerDisabled = true
#endif

#if os(iOS)
        // Patched by scripts/sync-app-assets.js — the converter template is a single
        // non-scrolling screen; the review list is not.
        self.webView.scrollView.isScrollEnabled = true
#endif

        self.webView.configuration.userContentController.add(self, name: "controller")

        // Patched by scripts/sync-app-assets.js — 播客模式 (§9.5) 的后台/锁屏播放。
        MTAudioBridge.shared.install(webView: self.webView)

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS)
        webView.evaluateJavaScript("show('ios')")
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac')")

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // MT_PREFS_FAILED — patched by scripts/sync-app-assets.js (#177): 失败必须可见，退回三步文字而不是让用户点了没反应。
                DispatchQueue.main.async { webView.evaluateJavaScript("show('mac', false, false)") }
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), false)")
                }
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
// MT_OPEN_URL v3 — patched by scripts/sync-app-assets.js
        if let s = message.body as? String, s.hasPrefix("open-url:") {
            let raw = String(s.dropFirst("open-url:".count))
            // A native side that opens ANY url on request is a redirector reachable
            // from web content — so this is an allowlist: our two sites, the App
            // Store page of this app (rating), and mail to our own address (feedback).
            guard let url = URL(string: raw) else { return }
            var allowed = false
            if url.scheme == "mailto" { allowed = raw.hasPrefix("mailto:belliedmonkey@gmail.com") }
            else if url.scheme == "https", let host = url.host {
                allowed = host == "belliedmonkey.cc" || host == "belliedmonkey.com"
                    || host == "apps.apple.com"
                    || host == "openrouter.ai"      // 免费额度用完后去申请自己的 key
                    || host == "github.com"         // 社群（Discussions）
            }
            guard allowed else { return }
#if os(iOS)
            UIApplication.shared.open(url)
#elseif os(macOS)
            NSWorkspace.shared.open(url)
#endif
            return
        }
        // 系统评分弹窗（app/native/review-bridge.swift）。页面只在一轮复习刷完后发，
        // 且本机 90 天冷却；系统再节流一层，弹不弹不回报。
        if let s = message.body as? String, s == "request-review" { MTReview.request(); return }
        #if os(macOS)
        if (message.body as! String != "open-preferences") {
            return
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            guard error == nil else {
                // MT_PREFS_FAILED — patched by scripts/sync-app-assets.js (#177): 失败必须可见，退回三步文字而不是让用户点了没反应。
                DispatchQueue.main.async { self.webView.evaluateJavaScript("show('mac', false, false)") }
                return
            }

            DispatchQueue.main.async {
                NSApp.terminate(self)
            }
        }
#endif
    }

}
