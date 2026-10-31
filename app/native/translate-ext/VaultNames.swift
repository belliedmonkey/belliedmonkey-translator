// app/native/translate-ext/VaultNames.swift — App 与系统翻译扩展**共用**的那几个名字
// （learning-design §9.9）。
//
// **一份文件，两个消费者**：App 那边由 scripts/sync-app-assets.js 以标记块贴进
// ViewController.swift（BLOCKS 里的 mt-vault-names），扩展那边直接编进 target。
// 抄第二份的那天，就是两边开始漂的那天 —— 而漂开的症状是「写进去了、读不出来」，
// 钥匙串只会回一个 -25300（找不到），不会说「你查的组不是写的那个组」。
//
// 为什么名字要算、不能写死：两个 flavor 是两个 App ID（com.belliedmonkeytranslator
// 与 …cn），共用一个 App Group 等于让两份装在同一台机器上的 App 互相看得见对方的 key。
import Foundation
import Security

enum MTVaultNames {
    /// **App** 的 bundle id。扩展跑在 `<app>.MTTranslateExt` 里，要去掉最后一段 ——
    /// 共享的两个组都跟着 App 走，而不是跟着谁在跑。
    static var appBundleId: String {
        let me = Bundle.main.bundleIdentifier ?? ""
        // `.appex` 是扩展 bundle 的后缀（ExtensionKit 与 app-extension 都是）。
        guard Bundle.main.bundleURL.pathExtension == "appex" else { return me }
        guard let dot = me.lastIndex(of: ".") else { return me }
        return String(me[me.startIndex..<dot])
    }

    /// App Group：非机密的那半份快照，以及收件箱（I-6）。
    static var group: String { "group." + appBundleId }

    /// 钥匙串里这一项的 service。**key 只在这里，不进 App Group** —— 那边是明文、
    /// 会被 iTunes/iCloud 备份带走。
    static let service = "mt.vault"

    /// UserDefaults 里放整份非机密快照的那一个键。整份 JSON 一次写 ——
    /// 逐键写会在中途被杀时留下半份配置，而半份配置看起来和完整的一样。
    static let snapshotKey = "mt.vault.snapshot.v1"

    /// 共享钥匙串的 access group = `<团队前缀>.<App bundle id>.shared`，与两份
    /// entitlements 里写的那一行逐字对应。
    ///
    /// 团队前缀运行时拿不到现成的（`$(AppIdentifierPrefix)` 只在 entitlements 里展开），
    /// 所以按 T1 尖刺验过的办法探一次：写一条自己默认组里的项，读回它的 access group，
    /// 取第一段。探针项留在那儿无害（几个字节，且是我们自己的组）。
    static func accessGroup() -> String? {
        if let cached = cachedPrefix { return cached + "." + appBundleId + ".shared" }
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service + ".prefix-probe",
            kSecAttrAccount as String: "p",
            kSecReturnAttributes as String: true,
        ]
        var r: CFTypeRef?
        var st = SecItemCopyMatching(q as CFDictionary, &r)
        if st == errSecItemNotFound {
            var a = q
            a.removeValue(forKey: kSecReturnAttributes as String)
            a[kSecValueData as String] = Data("x".utf8)
            a[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            _ = SecItemAdd(a as CFDictionary, nil)
            st = SecItemCopyMatching(q as CFDictionary, &r)
        }
        guard st == errSecSuccess, let d = r as? [String: Any],
              let g = d[kSecAttrAccessGroup as String] as? String,
              let prefix = g.split(separator: ".").first else { return nil }
        cachedPrefix = String(prefix)
        return String(prefix) + "." + appBundleId + ".shared"
    }
    private static var cachedPrefix: String?

    /// 读一项。回 `(OSStatus, 值)`：**errSecItemNotFound 不是错误**，是「没配」。
    static func keychainGet(_ account: String) -> (OSStatus, String?) {
        guard let g = accessGroup() else { return (errSecParam, nil) }
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: g,
            kSecReturnData as String: true,
        ]
        var r: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &r)
        return (st, (r as? Data).flatMap { String(data: $0, encoding: .utf8) })
    }

    /// 写一项。**空字符串 = 删除**：快照是全量的，「这一次没有这个值」与「这一项不存在」
    /// 在扩展那边必须是同一件事，否则用户清了 key 之后扩展还拿着上一把在发请求。
    @discardableResult
    static func keychainSet(_ account: String, _ value: String) -> OSStatus {
        guard let g = accessGroup() else { return errSecParam }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: g,
        ]
        SecItemDelete(base as CFDictionary)
        if value.isEmpty { return errSecSuccess }
        var a = base
        a[kSecValueData as String] = Data(value.utf8)
        // 锁屏后扩展也可能被拉起（通知里的文字、锁屏小组件），所以不是 WhenUnlocked。
        a[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(a as CFDictionary, nil)
    }
}
