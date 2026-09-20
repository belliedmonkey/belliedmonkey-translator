// scripts/ext-inbox-harness.swift — 在 Mac 上跑**出货的那一份** MTExtInbox（§9.9 / iOS 线 I-6）。
//
// 由 scripts/verify-ext-inbox.js 驱动：它把 app/native/translate-ext/ExtInbox.swift 拷过来，
// **只改一行**（App Group 容器 → 临时目录），并断言差异确实只有那一行，然后与这份一起编译。
//
// 为什么值得在 Mac 上跑：macOS 没有 TranslationUIProvider 这个扩展点，弹层那条路只能上真机；
// 但**写收件箱的这段逻辑与平台无关**，而它此前零可执行覆盖 —— 门禁只是在读源码字符串。
// 第一次跑就抓到一个真 bug：文件名用 `String(format: "%d", 毫秒)` 拼，`%d` 按 32 位取，
// 1789883396612 被截成 -1117965820。文件名不再按时间有序，而 trim() 删最旧的、drain() 读顺序
// **都靠这个序** —— 删掉的会是最新的几条，且没有任何一处会报错。

import Foundation

enum MTTestContainer { static var url: URL? = nil }
enum MTVaultNames { static let group = "group.test" }

func files(_ d: URL) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: d.path)) ?? []).sorted()
}
var failed = 0
func check(_ ok: Bool, _ what: String) {
    print((ok ? "  ✓ " : "  ✗ ") + what); if !ok { failed += 1 }
}

let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("mt-inbox-\(UUID().uuidString)")
try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
MTTestContainer.url = tmp
let dir = MTExtInbox.dir!

print("ExtInbox（真的那一份，只把容器目录改成临时目录）")

// ① 正常写：落一个文件，内容是约定的七个键
check(MTExtInbox.write(text: "needing", tr: "需要", lang: "", trLang: "zh-CN"), "翻成了就写一条")
check(files(dir).count == 1, "落了恰好一个文件")
let f = dir.appendingPathComponent(files(dir)[0])
let rec = (try? JSONSerialization.jsonObject(with: Data(contentsOf: f))) as? [String: Any] ?? [:]
check(Set(rec.keys) == Set(["v", "text", "tr", "lang", "trLang", "ts", "via"]), "记录里只有约定的七个键：\(rec.keys.sorted())")
check(rec["via"] as? String == "system" && rec["text"] as? String == "needing", "原文与来源对")
check(files(dir)[0].hasSuffix(".json") && files(dir)[0].contains("-"), "文件名是 <毫秒>-<8hex>.json：\(files(dir)[0])")

// ② 失败路径一个字都不写（Collector law 2）
check(!MTExtInbox.write(text: "", tr: "x", lang: "", trLang: ""), "原文空 ⇒ 不写")
check(!MTExtInbox.write(text: "x", tr: "", lang: "", trLang: ""), "译文空 ⇒ 不写")
check(!MTExtInbox.write(text: "same", tr: "same", lang: "", trLang: ""), "译文等于原文 ⇒ 不写")
check(!MTExtInbox.write(text: String(repeating: "a", count: 2001), tr: "x", lang: "", trLang: ""), "超 2000 字 ⇒ 不写")
check(!MTExtInbox.write(text: " \n ", tr: "x", lang: "", trLang: ""), "只有空白 ⇒ 不写")
check(files(dir).count == 1, "以上五条一个文件都没多")

// ③ 200 条上限，删的是最旧的（按文件名排序 = 按时间排序）
for i in 0..<260 { _ = MTExtInbox.write(text: "t\(i)", tr: "译\(i)", lang: "", trLang: "") }
check(files(dir).count <= MTExtInbox.maxFiles, "超了删到 \(MTExtInbox.maxFiles) 条以内，实际 \(files(dir).count)")
let names = files(dir)
check(names == names.sorted(), "留下的仍然按时间有序")

// ④ 512 KB 上限
let big = String(repeating: "字", count: 1900)
for _ in 0..<120 { _ = MTExtInbox.write(text: big, tr: "译", lang: "", trLang: "") }
let total = files(dir).reduce(0) { $0 + (((try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent($1).path))?[.size] as? Int) ?? 0) }
check(total <= MTExtInbox.maxBytes, "总字节压在 512 KB 以内，实际 \(total / 1024) KB")

// ⑤ 容器拿不到时安静地不写（这正是真机上那个待查的分支）
MTTestContainer.url = nil
check(!MTExtInbox.write(text: "x", tr: "y", lang: "", trLang: ""), "拿不到容器 ⇒ 返回 false，不崩")

try? FileManager.default.removeItem(at: tmp)
print(failed == 0 ? "\n全部通过" : "\n\(failed) 条没过")
exit(failed == 0 ? 0 : 1)
