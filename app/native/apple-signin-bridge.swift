// app/native/apple-signin-bridge.swift — 原生 Sign in with Apple，把 id_token 交给页面。
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
        MTAppleSignIn.start()
    }
}
