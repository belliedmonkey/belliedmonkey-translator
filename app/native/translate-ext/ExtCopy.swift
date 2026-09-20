// app/native/translate-ext/ExtCopy.swift — 弹层里的文案，按停机码查表
// （learning-design §9.9；交互稿「系统翻译」第 1 页第 8 条）。
//
// **为什么原生查表，而不是把文案打进 ExtEngine.js**：整份界面文案是 1 MB
// （extension/content/i18n-messages.js），而这个扩展的内存预算是 230 MB 量级里我们只肯
// 用 18 MB 的那一档。裁剪包里只有传输栈，文案留给原生。
//
// **共用的句子必须与产品里已有的逐字相同。** 下面每一行都标了它在
// `extension/_locales/` 里的键；test/build-scripts.test.js 把 zh-Hans 那一列与
// `_locales/zh_CN` 逐字比对 —— 抄一句改一个字，就是两套说法。
//
// 语种：**现在只有 en 与 zh-Hans**。iOS 线 I-7（文案 ×12）把它补齐到与 `_locales`
// 同一份清单。回落链是「首选语言 → 中文归 zh-Hans → en」，与 App 的
// `default_locale = en` 同一条（1.12.1 被拒那次的教训：默认语言必须是英文）。
import Foundation

enum ExtCopy {
    /// 一条文案。`loc` 是它在 `extension/_locales/` 里的键；新写的句子没有，写 nil。
    struct Row {
        let loc: String?
        let en: String
        let zh: String
    }

    static let rows: [String: Row] = [
        // ── 失败（停机码来自 translation-api.js，与 Mac 快速翻译面板同一张表）──────
        "auth": Row(loc: "auth_err_key",
                    en: "The provider rejected this key (HTTP 401/403). Check that the key is correct and has permission for this model.",
                    zh: "服务商拒绝了这把 key（HTTP 401/403）。检查 key 是否填对、有没有这个模型的权限。"),
        "credit_exhausted": Row(loc: "grant_err_exhausted",
                    en: "Your free credit is used up. You can add your own API key to keep going (one key covers translation, speech and transcription), or ask in the community.",
                    zh: "免费额度已经用完了。你可以填一把自己的 key 继续用（一把通吃翻译、朗读、转写），或者到社群里问问。"),
        "grant_unavailable": Row(loc: "grant_err_unavailable",
                    en: "This isn't you running out — our free-credit pool is empty and we're topping it up. Use your own key for now, or come back later.",
                    zh: "不是你用完了 —— 是我们这边的免费额度池空了，正在补。先用自己的 key，或者稍后再来。"),
        "grant_misconfigured": Row(loc: "grant_err_misconfigured",
                    en: "Something is misconfigured on our side for free credit, and we've logged it. This isn't your fault; use your own key for now.",
                    zh: "免费额度这条路我们这边配错了，已经记下。这不是你的问题；先用自己的 key。"),
        "grant_revoked": Row(loc: "grant_err_revoked",
                    en: "This free credit has been deactivated (signing out or deleting your account deactivates it). Sign back in to the same account and it returns, with the same balance.",
                    zh: "这份免费额度已经停用了（退出登录或删除账号会停用它）。重新登录同一个账号就会回来，余额不变。"),
        "grant_invalid": Row(loc: "grant_err_invalid",
                    en: "This free credit is no longer recognised. Open settings and claim it again.",
                    zh: "这份免费额度认不出来了。到设置里重新领一次。"),
        "model_not_allowed": Row(loc: "grant_err_model",
                    en: "Free credit only works with the model it pins. You changed the model under Advanced — change it back, or add your own key.",
                    zh: "免费额度只能用它指定的那个模型。你在「详细」里改过模型 —— 改回去，或者填一把自己的 key。"),
        "busy": Row(loc: "grant_err_busy",
                    en: "Too many requests right now. Wait a few seconds and try again.",
                    zh: "这会儿请求太密了，等几秒再试。"),

        // ── 扩展独有的几句（新写的，I-7 补齐 12 语种）───────────────────────────
        "network": Row(loc: nil,
                    en: "Couldn't reach the translation engine. Check your connection and try again.",
                    zh: "连不上翻译引擎。检查一下网络再试。"),
        "timeout": Row(loc: nil,
                    en: "The engine didn't answer in time.",
                    zh: "引擎这次没有按时回话。"),
        "http": Row(loc: nil,
                    en: "The engine returned an error.",
                    zh: "引擎回了一个错误。"),
        "no_base": Row(loc: nil,
                    en: "This engine needs an address, and none is set. Open BelliedMonkey Translator and fill it in.",
                    zh: "这个引擎要填地址，而现在是空的。打开大肚猴翻译填一次。"),
        "unknown_provider": Row(loc: nil,
                    en: "This engine is no longer available. Pick another one in BelliedMonkey Translator.",
                    zh: "这个引擎已经不在了。到大肚猴翻译里另选一个。"),
        "needs_setup": Row(loc: nil,
                    en: "No translation engine is set up yet. Open BelliedMonkey Translator once and it will work here.",
                    zh: "还没配置翻译引擎。打开大肚猴翻译配置一次，这里就能用了。"),
        "not_synced": Row(loc: nil,
                    en: "Open BelliedMonkey Translator once so it can share your engine settings with this sheet.",
                    zh: "打开一次大肚猴翻译，把引擎配置同步过来。"),
        "empty": Row(loc: nil,
                    en: "Nothing to translate in the selection.",
                    zh: "选中的内容里没有可翻译的文字。"),
        "empty_result": Row(loc: nil,
                    en: "The engine returned nothing this time.",
                    zh: "引擎这次什么都没返回。"),
        "engine_unavailable": Row(loc: nil,
                    en: "The translation engine didn't start.",
                    zh: "翻译引擎没能启动。"),
        "unknown": Row(loc: nil,
                    en: "Translation failed.",
                    zh: "这次没翻成。"),

        // ── 按钮与提示 ────────────────────────────────────────────────────────
        "ui_translating": Row(loc: nil, en: "Translating…", zh: "正在翻译…"),
        "ui_slow": Row(loc: nil, en: "Still going — free credit can be slow.", zh: "还在翻 · 免费额度会慢一些。"),
        "ui_replace": Row(loc: nil, en: "Replace", zh: "替换原文"),
        "ui_done": Row(loc: nil, en: "Done", zh: "完成"),
        "ui_copy": Row(loc: nil, en: "Copy", zh: "复制"),
        "ui_retry": Row(loc: "quick_retry", en: "Retry", zh: "重试"),
        "ui_open_app": Row(loc: nil, en: "Open BelliedMonkey Translator", zh: "打开大肚猴翻译"),
        // 系统自己会先弹一页「所选内容将发送给…进行翻译处理」（T1 实测）。那一句只说
        // 「发给这个 App」，没说「发给你配置的引擎」—— 所以我们这一行仍要有，但**不可点**、
        // 读过即止（交互稿修订 3）。`%@` 是引擎名。
        "ui_disclose": Row(loc: nil,
                    en: "The selected text is sent to the engine you configured (%@).",
                    zh: "选中的文字会发送给你配置的引擎（%@）。"),
        // 「会存入复习库」那一行**不在这里** —— 收件箱要到 I-6 才真的写。先写这句就是
        // 一句现在还不成立的承诺，而界面上看不出它没兑现。
    ]

    /// 能自己好的给「重试」；要改配置的给「打开大肚猴翻译」。**两者不同时出现** ——
    /// 要改配置时给「重试」等于让人再失败一次（与 Mac 面板的 RETRYABLE 同一条）。
    static let retryable: Set<String> = ["network", "timeout", "http", "busy", "grant_unavailable", "empty_result", ""]

    static func text(_ key: String) -> String {
        guard let row = rows[key] else { return rows["unknown"]!.pick() }
        return row.pick()
    }
}

extension ExtCopy.Row {
    func pick() -> String {
        let pref = Locale.preferredLanguages.first ?? "en"
        return pref.hasPrefix("zh") ? zh : en
    }
}
