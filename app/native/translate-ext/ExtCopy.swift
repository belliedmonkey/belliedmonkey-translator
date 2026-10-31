// app/native/translate-ext/ExtCopy.swift — 弹层里的文案，按停机码查表
// （learning-design §9.9 / §10 Gate J-2；交互稿「系统翻译」第 1 页第 8 条）。
//
// **文案的唯一登记处是 `extension/_locales`**，与产品别处同一份。这里读的是
// `build/ext-bundle.js` 从那 12 份 JSON 里挑出来、打进扩展 bundle 的 `ExtCopy.json`。
//
// 为什么要挑：整份界面文案是 1 MB（extension/content/i18n-messages.js），而这个扩展的
// 内存预算是 230 MB 里我们只肯用 18 MB 的那一档。挑出来的是这个弹层真的会显示的那几十句。
//
// 为什么不在 Swift 里写死：上一版把中英两语写死在这个文件里，而共用的那几句
// （`auth_err_key` / `grant_err_*`）在产品别处早就有 12 个语种 —— 两处各写一套的结果是
// 同一件事在 Mac 面板上和 iPhone 弹层上说得不一样，而两边各自都「没报错」。
//
// 回落链：首选语言 → 语言主码（zh-HK → zh-Hans）→ **en**。默认是英文，不是中文 ——
// 1.12.1 国际 iOS 因为中文权限说明被拒（Guideline 4）之后定下的那一条。
import Foundation

enum ExtCopy {
    /// 停机码 → `_locales` 的键。**左边是既有那套码**（translation-api 抛的、ext-entry 判的），
    /// 右边是产品里已经有 12 个语种的那一句。没列进来的码落到 `sys_fail_unknown`。
    static let keyOf: [String: String] = [
        "auth": "auth_err_key",
        "credit_exhausted": "grant_err_exhausted",
        "grant_unavailable": "grant_err_unavailable",
        "grant_misconfigured": "grant_err_misconfigured",
        "grant_revoked": "grant_err_revoked",
        "grant_invalid": "grant_err_invalid",
        "model_not_allowed": "grant_err_model",
        "busy": "grant_err_busy",
        "network": "sys_fail_network",
        "timeout": "sys_fail_timeout",
        "http": "sys_fail_http",
        "no_base": "sys_fail_no_base",
        "unknown_provider": "sys_fail_unknown_provider",
        "needs_setup": "sys_fail_needs_setup",
        "not_synced": "sys_fail_not_synced",
        "empty": "sys_fail_empty",
        "empty_result": "sys_fail_empty_result",
        "engine_unavailable": "sys_fail_engine",
        "unknown": "sys_fail_unknown",
    ]

    /// 能自己好的给「重试」；要改配置的给「打开大肚猴翻译」。**两者不同时出现** ——
    /// 要改配置时给「重试」等于让人再失败一次（与 Mac 面板的 RETRYABLE 同一条）。
    static let retryable: Set<String> = ["network", "timeout", "http", "busy", "grant_unavailable", "empty_result", ""]

    private static let table: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "ExtCopy", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: [String: String]]
        else { return [:] }
        return obj
    }()

    /// 这台设备该看哪一份。`Locale.preferredLanguages` 给的是 `zh-Hans-CN` 这样的标签，
    /// 而表里的键是 `zh-Hans` —— 逐段退，退到语言主码，再退到 en。
    private static let lang: String = {
        for tag in Locale.preferredLanguages {
            var t = tag
            while !t.isEmpty {
                if table[t] != nil { return t }
                guard let dot = t.lastIndex(of: "-") else { break }
                t = String(t[t.startIndex..<dot])
            }
            // zh-HK / zh-TW 之外的中文一律按简体（表里只有 zh-Hans / zh-Hant 两支）
            if tag.hasPrefix("zh") && table["zh-Hans"] != nil { return "zh-Hans" }
        }
        return "en"
    }()

    /// 按 `_locales` 的键取一句。取不到就回空串 —— **不回键名**：一个写着
    /// `sys_fail_http` 的弹层比一个空的更难看懂。
    static func key(_ k: String) -> String {
        if let v = table[lang]?[k], !v.isEmpty { return v }
        return table["en"]?[k] ?? ""
    }

    /// 按停机码取一句。
    static func fail(_ code: String) -> String {
        key(keyOf[code] ?? "sys_fail_unknown")
    }
}
