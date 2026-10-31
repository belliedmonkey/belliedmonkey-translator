// app/native/capture.swift — macOS「增强取词」（docs/learning-design.md §9.9，M-5）。
//
// 标记块，整份 #if os(macOS)。默认关；用户在设置里打开、并且系统给了 PostEvent 权限之后，快捷键不再要求先按 ⌘C：
// 我们替用户按一次 ⌘C，读到选中的文字，再把剪贴板**原样**写回去。
//
// 合规的只有这一条路：沙盒里读别的 App 的选区（辅助功能 API）与 AppleScript 都不可用，也过不了审；
// `CGRequestPostEventAccess()` 是系统自己的请求接口，App 会自己出现在列表里 —— 任何地方都不教用户手动添加。
// 平台现实（T2 读数）：授权之后**正在运行的进程读不到**新权限，重开才读得到；系统弹窗也不回调允许 / 拒绝。
//
// 四条不变量（npm test 对着这份源码钉着）：
//   ① 先记下剪贴板的全部内容，再按 ⌘C；只要剪贴板变过，**无论哪条分支**都原样写回。
//   ② 0.3 秒内剪贴板没变 ⇒ 没有选中、或这个 App 不让复制 ⇒ 交一段空文字。**绝不退回去翻旧剪贴板。**
//   ③ 取到的内容带隐藏 / 临时标记 ⇒ 根本不读文字。
//   ④ 读剪贴板的每一步都在后台队列、总时限 1 秒：剪贴板隐私开着时后台读取会卡住不返回（T2：>90 s）。
// 这里没有任何给用户看的文案。
#if os(macOS)
import AppKit
import Carbon.HIToolbox

final class MTQuickCapture {

    typealias Snapshot = [[(NSPasteboard.PasteboardType, Data)]]

    enum Outcome {
        case text(String)        // 取到了（可能是空串 = 没有选中 / 不让复制）
        case concealed           // 带隐藏标记：没有读
        case blocked             // 系统没让读剪贴板
    }

    static var granted: Bool { CGPreflightPostEventAccess() }

    /// 系统的请求接口：弹系统窗口、把 App 放进列表。不回调结果，返回值也只是「此刻有没有」。
    static func requestAccess() { _ = CGRequestPostEventAccess() }

    static func openPrivacySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    /// 重开自己：先起一个新实例，起来了再退。沙盒允许打开自己的包。
    static func relaunch() {
        let conf = NSWorkspace.OpenConfiguration()
        conf.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: conf) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    static func snapshot(_ pb: NSPasteboard) -> Snapshot {
        (pb.pasteboardItems ?? []).map { item in item.types.compactMap { t in item.data(forType: t).map { (t, $0) } } }
    }

    static func restore(_ snap: Snapshot, to pb: NSPasteboard) {
        pb.clearContents()
        let items: [NSPasteboardItem] = snap.map { pairs in
            let it = NSPasteboardItem()
            for (t, d) in pairs { it.setData(d, forType: t) }
            return it
        }
        if !items.isEmpty { pb.writeObjects(items) }
    }

    /// 回调恒在主线程、恒只来一次。
    static func captureSelection(_ done: @escaping (Outcome) -> Void) {
        var finished = false                                   // 只在主线程读写
        let finish: (Outcome) -> Void = { o in DispatchQueue.main.async { if !finished { finished = true; done(o) } } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { if !finished { finished = true; done(.blocked) } }

        DispatchQueue.global(qos: .userInitiated).async {
            let pb = NSPasteboard.general
            let before = snapshot(pb)
            let count = pb.changeCount

            // 用户此刻还按着快捷键的修饰键：等它们松开（最多 0.4 秒），不然宿主 App 收到的是 ⌃⌥⌘C。
            let held: CGEventFlags = [.maskControl, .maskAlternate, .maskShift]
            let t0 = Date()
            while !CGEventSource.flagsState(.combinedSessionState).intersection(held).isEmpty, Date().timeIntervalSince(t0) < 0.4 {
                usleep(10_000)
            }

            let src = CGEventSource(stateID: .combinedSessionState)
            let down = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: true)
            let up = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: false)
            down?.flags = .maskCommand
            up?.flags = .maskCommand
            down?.post(tap: .cghidEventTap)
            up?.post(tap: .cghidEventTap)

            let t1 = Date()
            while pb.changeCount == count, Date().timeIntervalSince(t1) < 0.3 { usleep(10_000) }
            if pb.changeCount == count { finish(.text("")); return }

            let marks = (pb.types ?? []).map { $0.rawValue }
            let concealed = marks.contains("org.nspasteboard.ConcealedType") || marks.contains("org.nspasteboard.TransientType")
            let got = concealed ? nil : (pb.string(forType: .string) ?? "")
            restore(before, to: pb)
            if let text = got { finish(.text(text)) } else { finish(.concealed) }
        }
    }
}
#endif
