// app/native/http-bridge.swift — 宿主 App 的原生 HTTP 桥（1.23.4 C5 / BEL-236）。
//
// 为什么需要它：MaaS 主机 与 TTS 回的 OSS 结果域都没有
// `Access-Control-Allow-Origin`。浏览器预检不带 key，所以标准 WKWebView 里带 Bearer
// 的请求过不了；扩展有 <all_urls>，不受影响。桥把**这两类主机**的请求交给 URLSession，
// 其余 BYO 仍走浏览器 CORS —— 不是全量代理，也不是第二个 ExtEngineHost。
//
// 边界（见 docs/domain-design.md §7 与 ARCH-C5）：
//   · 只放 https、443/无端口、无 userinfo；拒绝 IP / localhost / file / data
//   · global：精确 maas 主机（POST）+ OSS 结果域正则（GET）
//     china：只 OSS 结果域（maas 不进中国包）
//   · 不通配 *.aliyuncs.com / *.qwencloudapi.com，不放 supabase/relay
//   · 不跟随重定向（30x 原样回页面）；ephemeral、禁 cookie；剥 Cookie/Origin/
//     Referer/Host，不透传 Set-Cookie；日志只记 host/status/字节数
//   · 响应上限 16 MiB、请求体 1 MiB、硬超时 120 s
//   · 运行开关 `MTHttpBridge.enabled`（Swift）与 `window.__MT_HTTP_OFF`（JS）
//
// `__MT_HTTP_ALLOW_JSON__` 与 `__MT_HTTP_SHIM_BASE64__` 由 scripts/sync-app-assets.js
// 按 flavor 注入：allowlist 与注入的 JS 同源生成，Swift 与页面看到的是同一份名单。
// 本块插在模板的 `import WebKit` 之后，Foundation 由它带入 —— 这里不再重复 import。

private enum MTHttpResult {
    case response(status: Int, headers: [String: String], body: Data)
    case failure(String)
}

private final class MTHttpRunner: NSObject, URLSessionDataDelegate {
    let id: String
    private let request: URLRequest
    private let maxBytes: Int
    private let timeout: TimeInterval
    private let done: (MTHttpResult) -> Void

    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var response: HTTPURLResponse?
    private var data = Data()
    private var finished = false
    private let stateLock = NSLock()

    init(id: String, request: URLRequest, maxBytes: Int, timeout: TimeInterval,
         done: @escaping (MTHttpResult) -> Void) {
        self.id = id
        self.request = request
        self.maxBytes = maxBytes
        self.timeout = timeout
        self.done = done
        super.init()

        let conf = URLSessionConfiguration.ephemeral
        conf.httpCookieStorage = nil
        conf.httpShouldSetCookies = false
        conf.requestCachePolicy = .reloadIgnoringLocalCacheData
        conf.timeoutIntervalForRequest = timeout
        conf.timeoutIntervalForResource = timeout
        session = URLSession(configuration: conf, delegate: self, delegateQueue: nil)
    }

    func start() {
        var req = request
        req.timeoutInterval = timeout
        let t = session.dataTask(with: req)
        task = t
        t.resume()
    }

    func cancel() {
        stateLock.lock()
        if finished { stateLock.unlock(); return }
        finished = true
        stateLock.unlock()
        task?.cancel()
        session.invalidateAndCancel()
    }

    private func finish(_ result: MTHttpResult) {
        stateLock.lock()
        if finished { stateLock.unlock(); return }
        finished = true
        stateLock.unlock()
        session.finishTasksAndInvalidate()
        done(result)
    }

    // 不跟随重定向：Authorization 不能被带到另一个主机。30x 作为状态码回页面。
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        self.response = response as? HTTPURLResponse
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        stateLock.lock()
        if finished { stateLock.unlock(); return }
        if self.data.count + data.count > maxBytes {
            finished = true
            stateLock.unlock()
            task?.cancel()
            session.invalidateAndCancel()
            done(.failure("too_large"))
            return
        }
        self.data.append(data)
        stateLock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let err = error as NSError? {
            if err.code == NSURLErrorCancelled { return }
            finish(.failure(err.code == NSURLErrorTimedOut ? "timeout" : "network"))
            return
        }
        guard let r = response else { finish(.failure("network")); return }
        var headers: [String: String] = [:]
        for (k, v) in r.allHeaderFields {
            let name = String(describing: k).lowercased()
            // 不透传 Set-Cookie；URLSession 已经解压/重组过的内容，长度与编码头不再成立。
            if ["set-cookie", "content-encoding", "content-length", "transfer-encoding"].contains(name) {
                continue
            }
            headers[name] = String(describing: v)
        }
        finish(.response(status: r.statusCode, headers: headers, body: data))
    }
}

final class MTHttpBridge: NSObject, WKScriptMessageHandler {
    static let shared = MTHttpBridge()
    /// 运行期总开关：关掉之后新请求一律拒绝，页面回退到浏览器 CORS。
    static var enabled = true

    private static let channel = "mtHttp"
    private static let allowJson = #"__MT_HTTP_ALLOW_JSON__"#
    private static let shimBase64 = #"__MT_HTTP_SHIM_BASE64__"#

    private static let maxBodyBytes = 1 * 1024 * 1024
    private static let maxResponseBytes = 16 * 1024 * 1024
    private static let hardTimeout: TimeInterval = 120

    private struct Rule {
        let host: String?
        let pattern: NSRegularExpression?
        let methods: Set<String>
    }

    private let installed = NSHashTable<WKWebView>.weakObjects()
    private let lock = NSLock()
    private var runners: [String: MTHttpRunner] = [:]

    private lazy var rules: [Rule] = {
        guard let data = Self.allowJson.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []                                   // 名单解析不了 ⇒ 一律拒绝（fail closed）
        }
        return list.compactMap { obj in
            let methods = Set((obj["methods"] as? [String] ?? []).map { $0.uppercased() })
            guard !methods.isEmpty else { return nil }
            if let host = obj["host"] as? String, !host.isEmpty {
                return Rule(host: host.lowercased(), pattern: nil, methods: methods)
            }
            if let raw = obj["re"] as? String, let re = try? NSRegularExpression(pattern: raw) {
                return Rule(host: nil, pattern: re, methods: methods)
            }
            return nil
        }
    }()

    /// 主 WebView 与快速面板各调用一次。重复调用是幂等的。
    func install(webView: WKWebView?) {
        guard let webView = webView else { return }
        if installed.contains(webView) { return }
        installed.add(webView)

        let ucc = webView.configuration.userContentController
        ucc.add(self, name: Self.channel)
        if let data = Data(base64Encoded: Self.shimBase64),
           let js = String(data: data, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: js,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard Self.enabled,
              message.name == Self.channel,
              message.frameInfo.isMainFrame,
              let webView = message.webView,
              installed.contains(webView),
              let body = message.body as? [String: Any],
              let id = body["id"] as? String else { return }

        if (body["cancel"] as? Bool) == true {
            lock.lock()
            let runner = runners.removeValue(forKey: id)
            lock.unlock()
            runner?.cancel()
            return
        }

        guard let rawURL = body["url"] as? String,
              let url = URL(string: rawURL) else {
            respond(["id": id, "error": "bad_request"], to: webView)
            return
        }
        let method = String(body["method"] as? String ?? "GET").uppercased()
        guard validate(url, method: method) else {
            respond(["id": id, "error": "forbidden"], to: webView)
            return
        }

        var payload = Data()
        if let b64 = body["bodyBase64"] as? String, !b64.isEmpty {
            guard let decoded = Data(base64Encoded: b64), decoded.count <= Self.maxBodyBytes else {
                respond(["id": id, "error": "too_large"], to: webView)
                return
            }
            payload = decoded
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = payload.isEmpty ? nil : payload
        req.timeoutInterval = Self.hardTimeout
        if let headers = body["headers"] as? [String: String] {
            for (name, value) in headers {
                if Self.safeHeader(name) { req.setValue(value, forHTTPHeaderField: name) }
            }
        }

        let runner = MTHttpRunner(id: id, request: req,
                                  maxBytes: Self.maxResponseBytes,
                                  timeout: Self.hardTimeout) { [weak self, weak webView] result in
            guard let self = self else { return }
            // 先把 runner 摘掉，再判 webView：页面已经销毁时也不能把这一条留在字典里。
            self.lock.lock()
            self.runners.removeValue(forKey: id)
            self.lock.unlock()
            guard let webView = webView else { return }
            guard Self.enabled else {
                self.respond(["id": id, "error": "disabled"], to: webView)
                return
            }
            switch result {
            case .response(let status, let headers, let data):
                self.respond([
                    "id": id,
                    "status": status,
                    "headers": headers,
                    "bodyBase64": data.base64EncodedString(),
                ], to: webView)
            case .failure(let code):
                self.respond(["id": id, "error": code], to: webView)
            }
        }
        lock.lock()
        runners[id] = runner
        lock.unlock()
        runner.start()
    }

    // ── 安全 ──────────────────────────────────────────────────────────────
    private func validate(_ url: URL, method: String) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.user == nil, url.password == nil,
              url.port == nil || url.port == 443,
              let host = url.host?.lowercased(), !host.isEmpty else { return false }
        if host == "localhost" || host.hasSuffix(".local") { return false }
        if host.range(of: #"^\d{1,3}(\.\d{1,3}){3}$"#, options: .regularExpression) != nil { return false }
        if host.contains(":") { return false }              // IPv6 字面量

        for rule in rules {
            guard rule.methods.contains(method) else { continue }
            if let exact = rule.host, exact == host { return true }
            if let re = rule.pattern,
               re.firstMatch(in: host, range: NSRange(host.startIndex..., in: host)) != nil {
                return true
            }
        }
        return false
    }

    private static func safeHeader(_ name: String) -> Bool {
        switch name.lowercased() {
        case "authorization", "content-type", "accept", "accept-language",
             "x-dashscope-sse", "x-request-id":
            return true
        default:
            // Cookie / Origin / Referer / Host 以及其它未列出的头一律不发。
            return false
        }
    }

    private func respond(_ payload: [String: Any], to webView: WKWebView) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            webView.evaluateJavaScript("window.__mtHttpResolve(\(json));", completionHandler: nil)
        }
    }
}
