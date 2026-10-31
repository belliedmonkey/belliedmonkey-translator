// app/native/mcp-oauth-bridge.swift — BEL-151 MCP OAuth refresh token: its own
// Keychain slot, on BOTH platforms.
//
// JS half: src/app/mcp-oauth-client.js (channel `mtMcpOAuth`).
// Patched into ViewController.swift by scripts/sync-app-assets.js; **edit here,
// then run `npm run app:sync`** — edits made in the generated tree are overwritten.
//
// Why a second Keychain service instead of the mtVault slot:
//   · mtVault is iOS-only (there is no system translation extension on macOS), so
//     the Mac half of this feature would silently have nowhere to persist;
//   · the two credentials have different owners and lifetimes: mtVault holds the
//     user's engine key for the extension, this holds an MCP refresh token for this
//     App's device session. Wiping one must never wipe the other.
//
// `device_cred` deliberately does NOT live here: it is a device-session credential
// and stays in the App's storage (src/app/device-bridge-host.js). Two slots, two
// lifetimes — the whole point is that clearing one does not require touching the
// other.
//
// What crosses the bridge: a named account (mcp_refresh / mcp_access) and, on a
// write, one token string. The reply carries `ok` and the account's presence, never
// the value back on a write. No page content, no email, no device id.

import WebKit
import Security

final class MTMcpOAuth: NSObject, WKScriptMessageHandler {
    static let shared = MTMcpOAuth()

    /// Service name, not the account: one service, two accounts. Keeping the
    /// service constant makes "clear the MCP grant" a two-account delete and makes
    /// it impossible for this code to touch mt.vault by accident.
    private static let service = "mt.mcp.oauth"
    /// Only these two account names are addressable. A page cannot ask for an
    /// arbitrary keychain item by inventing a name.
    private static let accounts: Set<String> = ["mcp_refresh", "mcp_access"]

    private weak var webView: WKWebView?

    static func install(webView: WKWebView) {
        // Idempotent for the same web view (cold relaunch creates a new one, which
        // must get the handler again). Adding the same handler twice to one
        // controller would deliver each message twice.
        if shared.webView === webView { return }
        shared.webView = webView
        webView.configuration.userContentController.add(shared, name: "mtMcpOAuth")
    }

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "mtMcpOAuth",
              let body = message.body as? [String: Any],
              let id = body["id"] as? String, !id.isEmpty,
              let op = body["op"] as? String,
              let account = body["account"] as? String,
              MTMcpOAuth.accounts.contains(account) else { return }
        switch op {
        case "get":       get(id, account)
        case "set":       set(id, account, (body["value"] as? String) ?? "")
        case "clear":     set(id, account, "")     // empty value = delete
        default:          reply(["id": id, "ok": false, "error": "bad_op"])
        }
    }

    // MARK: - Keychain

    private func baseQuery(_ account: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: MTMcpOAuth.service,
            kSecAttrAccount as String: account,
        ]
    }

    private func get(_ id: String, _ account: String) {
        var q = baseQuery(account)
        q[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        // errSecItemNotFound is "not configured", not an error.
        if status == errSecItemNotFound {
            reply(["id": id, "ok": true, "found": false])
            return
        }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            reply(["id": id, "ok": false, "status": Int(status)])
            return
        }
        reply(["id": id, "ok": true, "found": true, "value": value])
    }

    private func set(_ id: String, _ account: String, _ value: String) {
        let q = baseQuery(account)
        SecItemDelete(q as CFDictionary)
        if value.isEmpty {
            reply(["id": id, "ok": true, "found": false])
            return
        }
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        #if os(iOS)
        // The refresh may be used after a relaunch before first unlock (background
        // launch). AfterFirstUnlock is the same choice mtVault makes for its key.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        #endif
        let status = SecItemAdd(add as CFDictionary, nil)
        reply(["id": id, "ok": status == errSecSuccess, "status": Int(status)])
    }

    // MARK: - back into the page

    private func reply(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let arg = String(data: data, encoding: .utf8) else { return }
        // Same shape as the other bridges: a page that is not ready yet gets a
        // pending slot instead of a dropped reply. The JS half installs the
        // dispatcher before it posts, so this is a belt-and-braces branch.
        let js = """
        (function(){var r=\(arg);
        if (typeof window.__mtMcpOAuth === 'function') { window.__mtMcpOAuth(r); }
        else { window.__mtMcpOAuthPending = r; }})()
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
