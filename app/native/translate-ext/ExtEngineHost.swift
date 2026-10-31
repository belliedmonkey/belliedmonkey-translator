// app/native/translate-ext/ExtEngineHost.swift — 在 JavaScriptCore 里跑**与 App 同一份**
// 传输栈（learning-design §9.9 / domain-design §2.6 规则 2）。
//
// 为什么不是 Swift 重写一遍：传输那一层不是「发个 HTTP 请求」—— 四种 wire format、按
// host + 模型前缀查表决定发哪些可选字段、免费额度的中继、停机码的归类，每一处调参都要
// 两份同时改。写第二份的那天起两份就开始漂，而漂开的症状是「Mac 上好好的，iPhone 上少
// 一个字段」，没有任何一行日志会说。
//
// 尖刺 T1 在真机上量过：87 KB 的包在 JSC 里就绪 3–10 ms、常驻 +3.2 MB，扩展总占用
// 17–18 MB，而这个扩展点的上限在 230 MB 量级（压到被杀读出来的）—— 余量 90% 以上。
//
// 原生只装三个钩子，与 app/ext-shim.js 逐字对应：
//   __mtSeed    引擎配置与 key 的快照（建上下文时注入，之后只读）
//   __mtFetch   一次请求 → Promise<{status, headers, body}>
//   __mtTimer   等一会儿 → Promise
// **不装 chrome.runtime.sendMessage**：垫片故意不给，让「后台在吗」的探针如实失败 ⇒ 直连。
import Foundation
import JavaScriptCore

final class MTExtEngine {
    private let ctx = JSContext()!
    private var lastException: String?
    private(set) var ready = false

    /// 建上下文并装引擎。同步返回 —— 3–10 ms，比一次布局还短。
    /// 失败会留下 `lastException`，由调用方按 `engine_unavailable` 出文案（不上屏原始错误：
    /// 用户看到 `TypeError: undefined is not an object` 学不到任何东西）。
    @discardableResult
    func boot(seed: [String: Any]) -> Bool {
        if ready { return true }
        ctx.exceptionHandler = { [weak self] _, e in self?.lastException = e?.toString() }
        ctx.setObject(seed, forKeyedSubscript: "__mtSeed" as NSString)
        install()
        guard let url = Bundle.main.url(forResource: "ExtEngine", withExtension: "js"),
              let js = try? String(contentsOf: url, encoding: .utf8) else {
            lastException = "ExtEngine.js missing from the extension bundle"
            return false
        }
        ctx.evaluateScript(js)
        // 判据是**引擎自己说它起来了**，不是「evaluateScript 没抛」——
        // 漏了某个模块时脚本照样跑完，只是 TranslationAPI 不存在。
        let r = ctx.objectForKeyedSubscript("MTExt")?.invokeMethod("ready", withArguments: [])
        ready = (r?.objectForKeyedSubscript("ok")?.toBool() ?? false)
        return ready
    }

    /// 翻一段。`lang` 传空表示按快照里的「译成」。
    /// 回调在主队列，结果形状与 app/ext-entry.js 的返回值逐键相同。
    func translate(_ text: String, lang: String, done: @escaping ([String: Any]) -> Void) {
        guard ready, let ext = ctx.objectForKeyedSubscript("MTExt") else {
            done(["ok": false, "code": "engine_unavailable"]); return
        }
        var opts: [String: Any] = ["uiLang": Locale.preferredLanguages.first ?? ""]
        if !lang.isEmpty { opts["lang"] = lang }
        guard let promise = ext.invokeMethod("translate", withArguments: [text, opts]) else {
            done(["ok": false, "code": "engine_unavailable"]); return
        }
        var settled = false
        let onValue: @convention(block) (JSValue?) -> Void = { v in
            if settled { return }; settled = true
            let o = (v?.toDictionary() as? [String: Any]) ?? ["ok": false, "code": "unknown"]
            DispatchQueue.main.async { done(o) }
        }
        // 拒绝也要落地：少了这一半，一次 JS 异常会变成「永远转圈」，而转圈没有错误码。
        let onError: @convention(block) (JSValue?) -> Void = { e in
            if settled { return }; settled = true
            let msg = e?.toString() ?? ""
            DispatchQueue.main.async { done(["ok": false, "code": "unknown", "detail": msg]) }
        }
        promise.invokeMethod("then", withArguments: [unsafeBitCast(onValue, to: AnyObject.self)])
        promise.invokeMethod("catch", withArguments: [unsafeBitCast(onError, to: AnyObject.self)])
    }

    // MARK: - 三个钩子

    private func install() {
        // fetch。**这里不做重试、不做超时** —— 那些在 translation-api.js 里，两个宿主同一份。
        let fetchFn: @convention(block) (JSValue) -> JSValue = { [weak self] req in
            guard let self = self else { return JSValue(undefinedIn: JSContext()) }
            let o = (req.toDictionary() as? [String: Any]) ?? [:]
            return JSValue(newPromiseIn: self.ctx) { resolve, reject in
                guard let urlString = o["url"] as? String, let u = URL(string: urlString) else {
                    reject?.call(withArguments: [self.jsError("TypeError: bad url")]); return
                }
                var r = URLRequest(url: u)
                r.httpMethod = (o["method"] as? String) ?? "GET"
                for (k, v) in (o["headers"] as? [String: String]) ?? [:] { r.setValue(v, forHTTPHeaderField: k) }
                if let b = o["body"] as? String { r.httpBody = Data(b.utf8) }
                // 这里的超时给得很宽：真正的上限是 JS 那边的 AbortController（用户配的
                // reqTimeoutSec）。两处都掐会让「超时」有两个来源，而只有一个带得出错误码。
                r.timeoutInterval = 180
                URLSession.shared.dataTask(with: r) { data, resp, err in
                    if let e = err {
                        reject?.call(withArguments: [self.jsError("TypeError: \(e.localizedDescription)")])
                        return
                    }
                    let http = resp as? HTTPURLResponse
                    var headers: [String: String] = [:]
                    for (k, v) in http?.allHeaderFields ?? [:] { headers["\(k)".lowercased()] = "\(v)" }
                    resolve?.call(withArguments: [[
                        "status": http?.statusCode ?? 0,
                        "headers": headers,
                        "body": String(data: data ?? Data(), encoding: .utf8) ?? "",
                    ]])
                }.resume()
            }
        }
        let timerFn: @convention(block) (Double) -> JSValue = { [weak self] ms in
            guard let self = self else { return JSValue(undefinedIn: JSContext()) }
            return JSValue(newPromiseIn: self.ctx) { resolve, _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(max(0, ms)))) {
                    resolve?.call(withArguments: [])
                }
            }
        }
        ctx.setObject(fetchFn, forKeyedSubscript: "__mtFetch" as NSString)
        ctx.setObject(timerFn, forKeyedSubscript: "__mtTimer" as NSString)
    }

    private func jsError(_ message: String) -> JSValue {
        JSValue(newErrorFromMessage: message, in: ctx) ?? JSValue(newObjectIn: ctx)
    }
}
