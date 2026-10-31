// app/native/vault-bridge.swift — mtVault 的原生半边（learning-design §9.9）。
// JS 半边：app/vault-mirror.js。**整份 #if os(iOS)**：macOS 没有这个扩展点，
// 而 `webkit.messageHandlers.mtVault` 在不在，正是 JS 那边判断「这台设备有没有系统
// 翻译扩展」的唯一依据（能力靠探测，不靠 UA）。
//
// 由 scripts/sync-app-assets.js 以标记块的形式贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 这条通道经手的是**用户的 key**，所以只做三件事，一件都不多：
//   1. 整份非机密快照 → App Group 的 UserDefaults（一次写，不逐键）
//   2. apiKey → 共享钥匙串（**不进 App Group**：那边是明文、会被备份带走）
//   3. 回一条 vault-ack：只有键名与 OSStatus，**永远没有 key 的值**
//
// 「镜像，不搬家」：真源仍然是 App 这边的 chrome.storage，扩展拿到的是只读快照。
// 全量而不是增量 —— iOS 的钥匙串在 App 卸载后仍然留着，增量会留下「扩展里有一把 key、
// 而 App 里早就没配了」这种状态，而那一把 key 还会被拿去发请求。

#if os(iOS)
final class MTVault: NSObject, WKScriptMessageHandler {
    static let shared = MTVault()
    private weak var webView: WKWebView?

    /// ViewController 就绪时调一次（见 patchViewController 的 install 行）。
    func install(webView: WKWebView) {
        self.webView = webView
        webView.configuration.userContentController.add(self, name: "mtVault")
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "vault-sync": sync(body)
        case "vault-clear": clear()
        case "inbox-drain": drain()
        case "inbox-ack": ack(names: (body["names"] as? [String]) ?? [])
        case "inbox-clear": clearInbox()
        default: break   // 不认识的消息安静丢掉：JS 那边的协议表是权威，这里不猜
        }
    }

    private func sync(_ body: [String: Any]) {
        let nonSecret = (body["nonSecret"] as? [String: Any]) ?? [:]
        let secret = (body["secret"] as? [String: Any]) ?? [:]

        var keys: [String] = []
        if let d = UserDefaults(suiteName: MTVaultNames.group) {
            let json = (try? JSONSerialization.data(withJSONObject: nonSecret, options: [.sortedKeys]))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            d.set(json, forKey: MTVaultNames.snapshotKey)
            keys = nonSecret.keys.sorted()
        }

        // key 一项。空串 = 删除 —— 用户把引擎清了，扩展那边也必须立刻没有。
        let apiKey = (secret["apiKey"] as? String) ?? ""
        let status = MTVaultNames.keychainSet("apiKey", apiKey)
        if !apiKey.isEmpty || status == errSecSuccess { keys.append("apiKey") }
        ack(keys: keys, status: status)
    }

    private func clear() {
        UserDefaults(suiteName: MTVaultNames.group)?.removeObject(forKey: MTVaultNames.snapshotKey)
        let status = MTVaultNames.keychainSet("apiKey", "")
        ack(keys: [], status: status)
    }

    // MARK: - 收件箱（§9.9）

    private var inboxDir: URL? {
        guard let c = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: MTVaultNames.group) else { return nil }
        return c.appendingPathComponent("handoff-inbox", isDirectory: true)
    }

    /// 把收件箱里的记录整批交给页面。**只读不删** —— 先写库后删文件：item id 是内容哈希、
    /// merge 幂等，所以中途崩溃下次重来无害；反过来「先删后写」会在崩溃时静默丢句子。
    private func drain() {
        var records: [[String: Any]] = []
        if let d = inboxDir,
           let all = try? FileManager.default.contentsOfDirectory(at: d, includingPropertiesForKeys: nil) {
            for f in all.filter({ $0.pathExtension == "json" }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                guard let data = try? Data(contentsOf: f),
                      let rec = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                    // 读不出来的文件不该永远留着占位 —— 它也不会自己变好
                    try? FileManager.default.removeItem(at: f)
                    continue
                }
                records.append(["name": f.lastPathComponent, "record": rec])
            }
        }
        // 空批次也要回：页面那边在等一个回音，否则「收件箱是空的」与「原生没回话」分不开。
        send(["type": "inbox-batch", "records": records])
    }

    /// 页面写库落定之后才来 ack，这时才删文件。
    private func ack(names: [String]) {
        guard let d = inboxDir else { return }
        for n in names {
            // 只认文件名本身：`..` 或路径分隔符一律不碰（这条消息来自页面，页面来自我们，
            // 但一个能写任意路径的删除口不该存在）。
            guard !n.isEmpty, !n.contains("/"), !n.contains("..") else { continue }
            try? FileManager.default.removeItem(at: d.appendingPathComponent(n))
        }
    }

    private func clearInbox() {
        guard let d = inboxDir else { return }
        try? FileManager.default.removeItem(at: d)
    }

    /// 回执里**只有键名与 OSStatus**。真出问题时，「写了哪几个键、系统怎么答的」
    /// 就够定位了；带上值只会让它出现在日志、崩溃报告和截图里。
    private func ack(keys: [String], status: OSStatus) {
        send(["type": "vault-ack", "keys": keys, "status": Int(status)])
    }

    private func send(_ payload: [String: Any]) {
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [])
        let arg = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"type\":\"vault-ack\",\"keys\":[],\"status\":-1}"
        let js = "(function(){var m=\(arg);if(window.AppVault&&window.AppVault.onNative)window.AppVault.onNative(m);})()"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
#endif
