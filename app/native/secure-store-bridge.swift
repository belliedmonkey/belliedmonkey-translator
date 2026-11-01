// app/native/secure-store-bridge.swift — 本机 Keychain 小桥（1.21.2 泰语 Grok BYOK）。
//
// 与 vault-bridge 的差别：
//   · vault 整份 #if os(iOS)，服务系统翻译扩展的 App Group / 共享 Keychain；
//   · 本桥 **intl iOS + intl Mac** 都要（#if !CHINA）：泰语 Grok Key 只给宿主 App
//     自己的 grok-stt-open 用，不进扩展、不进 App Group。
//
// 纪律（与 vault / 引擎 key 同向）：
//   · 回执永远只有 account / present / OSStatus / req —— **永不回传 key 值到日志路径**；
//     get 仅把值经 evaluateJavaScript 交给页面内存（一次会话用），不 os_log / print。
//   · 空串 set = 删除。
//   · china 编译门剥整份（与 MTGrokStt* 同绑 flavor/CHINA）。
//
// 由 scripts/sync-app-assets.js 以标记块贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**。

#if !CHINA
import Foundation
import Security
import WebKit

final class MTSecureStore: NSObject, WKScriptMessageHandler {
    static let shared = MTSecureStore()
    static let channel = "mtSecure"
    /// 与 vault 的 mt.vault 分开：本服务只服务 App 私有项，不进共享组。
    private static let service = "mt.secure"

    private weak var webView: WKWebView?

    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: MTSecureStore.channel)
        ucc.add(self, name: MTSecureStore.channel)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let account = ((body["account"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let req = (body["req"] as? String) ?? ""
        guard !account.isEmpty, account.count <= 64, !account.contains("/"), !account.contains("..") else {
            ack(type: "secure-ack", account: account, present: false, status: Int(errSecParam), req: req, value: nil)
            return
        }
        switch type {
        case "secure-set":
            let value = (body["value"] as? String) ?? ""
            let st = Self.keychainSet(account, value)
            ack(type: "secure-ack", account: account, present: !value.isEmpty && st == errSecSuccess,
                status: Int(st), req: req, value: nil)
        case "secure-get":
            let (st, val) = Self.keychainGet(account)
            let present = (st == errSecSuccess && !(val ?? "").isEmpty)
            // 值只进页面内存回调；ack 形状不含 value 字段名以外的旁路。
            ack(type: "secure-value", account: account, present: present,
                status: Int(st == errSecItemNotFound ? errSecSuccess : st), req: req,
                value: present ? val : nil)
        case "secure-clear":
            let st = Self.keychainSet(account, "")
            ack(type: "secure-ack", account: account, present: false, status: Int(st), req: req, value: nil)
        default:
            break
        }
    }

    private func ack(type: String, account: String, present: Bool, status: Int, req: String, value: String?) {
        var payload: [String: Any] = [
            "type": type,
            "account": account,
            "present": present,
            "status": status,
            "req": req,
        ]
        if let value = value { payload["value"] = value }
        send(payload)
    }

    private func send(_ payload: [String: Any]) {
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [])
        let arg = data.flatMap { String(data: $0, encoding: .utf8) }
            ?? "{\"type\":\"secure-ack\",\"account\":\"\",\"present\":false,\"status\":-1,\"req\":\"\"}"
        let js = "(function(){var m=\(arg);if(window.AppSecureStore&&window.AppSecureStore.onNative)window.AppSecureStore.onNative(m);})()"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - App-private Keychain（无 access group）

    private static func keychainGet(_ account: String) -> (OSStatus, String?) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var r: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &r)
        return (st, (r as? Data).flatMap { String(data: $0, encoding: .utf8) })
    }

    /// 空串 = 删除。返回最终 OSStatus。
    @discardableResult
    private static func keychainSet(_ account: String, _ value: String) -> OSStatus {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        if value.isEmpty { return errSecSuccess }
        var a = base
        a[kSecValueData as String] = Data(value.utf8)
        a[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(a as CFDictionary, nil)
    }
}
#endif
