// app/native/translate-ext/ExtInbox.swift — 弹层翻完的句子写进 App Group 收件箱
// （learning-design §9.9）。读的那一侧在 app/native/vault-bridge.swift，摄入在 app/handoff.js。
//
// **为什么是「每条一个文件」而不是追加一个文件**：写的是扩展进程、读的是 App 进程，两边都可能
// 随时被系统杀掉。追加式文件要处理并发追加与半行损坏，而每条一个文件加一次原子替换就没有这两件事。
//
// **为什么是收件箱而不是直接写库**：学习库按账号分库（store.js 的 useDb），第二个打开者手里
// 会握着过期的库名；何况扩展进程根本够不着 App 的 IndexedDB。唯一写入者仍然是 App 主页面。
//
// **这里是 sink，不是 source**（Collector law 1/2）：只把已经显示给用户看过的译文抄一份，
// 失败路径一个字都不写。开关关着就整个不写 —— 不留用户看不见的积压。
import Foundation

enum MTExtInbox {
    static let dirName = "handoff-inbox"
    static let maxFiles = 200
    static let maxBytes = 512 * 1024
    static let maxChars = 2000

    static var dir: URL? {
        guard let c = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: MTVaultNames.group) else { return nil }
        return c.appendingPathComponent(dirName, isDirectory: true)
    }

    /// 写一条。返回写没写 —— 调用方不看这个值（写不进去不该影响用户看到的译文），
    /// 但门禁与真机取证要读得到。
    @discardableResult
    static func write(text: String, tr: String, lang: String, trLang: String, via: String = "system") -> Bool {
        // 门与 app/handoff.js 的 whyNot 同一套。这里先拦一遍，是为了**不把注定进不去的记录
        // 写进收件箱** —— 写进去也只会在摄入时被丢掉，中间那段时间它是磁盘上的一份用户文字。
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let r = tr.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !r.isEmpty, t != r, text.count <= maxChars else { return false }
        guard let d = dir else { return false }
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)

        let rec: [String: Any] = [
            "v": 1, "text": text, "tr": tr,
            "lang": lang, "trLang": trLang,
            "ts": Int(Date().timeIntervalSince1970 * 1000), "via": via,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: rec, options: [.sortedKeys]) else { return false }
        // **别用 `String(format: "%d", …)` 拼毫秒时间戳。** `%d` 在 Swift 里按 32 位取，
        // 而毫秒 epoch 是 1.79e12 —— 会被截成负数（实测 1789883396612 → -1117965820）。
        // 那样文件名就不再按时间有序，而 trim() 删最旧的、drain() 读顺序**都靠这个序**：
        // 一旦错位，删掉的是最新的几条，而没有任何一处会报错。
        let ms = Int(Date().timeIntervalSince1970 * 1000)
        let name = "\(ms)-" + String(format: "%08x", UInt32.random(in: 0...UInt32.max)) + ".json"
        // 原子写：读的那一侧随时可能在扫目录，看到半个文件比看不到更糟。
        guard (try? data.write(to: d.appendingPathComponent(name), options: [.atomic])) != nil else { return false }
        trim()
        return true
    }

    /// 上限 200 条 / 512 KB，超了删最旧的。**按文件名排序就是按时间排序** —— 名字前缀是毫秒时间戳，
    /// 而文件的修改时间在 iOS 上不保证跟得上（备份恢复、时钟回拨都会动它）。
    static func trim() {
        guard let d = dir else { return }
        let keys: [URLResourceKey] = [.fileSizeKey]
        guard let all = try? FileManager.default.contentsOfDirectory(at: d, includingPropertiesForKeys: keys) else { return }
        var files = all.filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        var total = files.reduce(0) { $0 + ((try? $1.resourceValues(forKeys: Set(keys)))?.fileSize ?? 0) }
        while files.count > maxFiles || total > maxBytes {
            guard let oldest = files.first else { break }
            total -= (try? oldest.resourceValues(forKeys: Set(keys)))?.fileSize ?? 0
            try? FileManager.default.removeItem(at: oldest)
            files.removeFirst()
        }
    }
}
