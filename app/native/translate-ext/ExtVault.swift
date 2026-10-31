// app/native/translate-ext/ExtVault.swift — 扩展这一侧读镜像过来的引擎配置
// （learning-design §9.9）。写的那一侧是 app/native/vault-bridge.swift。
//
// 扩展是**只读**的：它改不了配置，也不该有第二个写入者 —— 所以不存在「两份配置谁说了算」。
//
// 这里把快照翻译成 `__mtSeed`，也就是 `chrome.storage.local` 在 JavaScriptCore 里的样子。
// **键名按 App 那边原始存储的样子给**（apiBaseUrl / apiModel），不是快照里的 baseUrl /
// model：ExtEngine.js 里跑的是与 App 逐字相同的 `LearnNotes.resolveConfig`，它认的是
// 原始键。镜像那边已经解析过一次了，所以喂进去等于一次恒等变换 —— 解析规则只有一份。
import Foundation

struct MTExtConfig {
    var seed: [String: Any] = [:]
    var provider = ""
    var flavor = "global"
    var learnEnabled = true
    var handoffCapture = true
    /// 弹层字号（#495，2026-09-29 裁定）：三档 0.85 / 1 / 1.2，与字幕条的 FONT_STEPS
    /// 同族。缺省 1（标准）；只缩放原文+译文正文，叠加系统 Dynamic Type（相乘）。
    var fontScale: CGFloat = 1
    /// 没配引擎。判据留给 JS（EngineState.needsSetup，与设置页、Mac 面板同一个函数）——
    /// 这里只在**连快照都没有**时抢答，那是「App 还没同步过来」，不是「没配」。
    var hasSnapshot = false

    static func load() -> MTExtConfig {
        var c = MTExtConfig()
        guard let d = UserDefaults(suiteName: MTVaultNames.group),
              let json = d.string(forKey: MTVaultNames.snapshotKey),
              let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
        else { return c }
        c.hasSnapshot = true
        c.provider = (obj["provider"] as? String) ?? ""
        c.flavor = (obj["flavor"] as? String) ?? "global"
        c.learnEnabled = (obj["learnEnabled"] as? Bool) ?? true
        c.handoffCapture = (obj["handoffCapture"] as? Bool) ?? true
        // 快照给的是数字；不在合理区间（手改过 / 损坏）就落回标准档，不猜。
        let fs = (obj["sysTranslateFontScale"] as? NSNumber)?.doubleValue ?? 1
        c.fontScale = (fs > 0.5 && fs <= 2) ? CGFloat(fs) : 1

        var seed: [String: Any] = [
            "provider": c.provider,
            "apiBaseUrl": (obj["baseUrl"] as? String) ?? "",
            "apiModel": (obj["model"] as? String) ?? "",
        ]
        for k in ["targetLang", "uiLang", "grantTail"] { seed[k] = (obj[k] as? String) ?? "" }
        // 请求参数（超时 / 重试 / 并发 / 退避 / 分段上限）：**缺席与 0 是两件事** ——
        // 缺席让 translation-api 用它自己的默认值，写 0 会让它立刻超时。
        for k in ["reqTimeoutSec", "reqRetries", "reqConcurrency", "reqBackoffMs", "reqMaxChars"] {
            if let v = obj[k] as? NSNumber { seed[k] = v }
        }
        let (_, key) = MTVaultNames.keychainGet("apiKey")
        seed["apiKey"] = key ?? ""
        c.seed = seed
        return c
    }
}
