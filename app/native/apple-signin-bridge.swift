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
