// app/native/resident.swift — macOS 菜单栏常驻 + 快速翻译的桥（docs/learning-design.md §9.9）。
//
// 这份文件是「标记块」：scripts/sync-app-assets.js 把它整份贴进生成工程的 ViewController.swift
// （转换器生成的工程是一次性的，见那份脚本的文件头）。整份 #if os(macOS)：iOS 上一个字节都不编。
//
// 为什么要常驻：快速翻译的快捷键与右键「服务」只有在 App 进程活着时才有用，所以开着「在菜单栏常驻」
// 时，关掉主窗口不再退出 App。这改变了一个老行为 —— 第一次发生时页面要说一句（JS 侧的一次性提示），
// 而且那个开关必须找得回来（设置页「快速翻译」块）。
//
// 协议（通道 mtQuick；与 app/quick-host.js 的 PROTOCOL 逐字对表，npm test 守着）：
//   JS → 原生  quick-probe                       问原生有哪些能力（老原生壳不回 ⇒ 页面不显示这一块）
//              quick-config {enabled, seen, labels}   开关、是否已经看过「还在菜单栏」的提示、菜单文案
//              quick-close-main                  页面上的提示读完了：现在把主窗口收起来
//   原生 → JS  quick-caps {resident, panel}      能力回执
//              quick-first-close                 用户第一次关主窗口：先别关，让页面说一句
//              quick-open-settings               菜单里点了「快速翻译设置…」（或面板里点了「打开设置」）
//              quick-capture · quick-result      面板页交来的，原样中继（quick-panel.swift）：进复习库 / 遥测只归主页面
//
// 这里没有任何给用户看的文案：菜单标题全部由 JS 经 labels 给（12 个语种在 _locales 里）。
#if os(macOS)
import AppKit
import WebKit

final class MTResident: NSObject, WKScriptMessageHandler {

    static let shared = MTResident()
    static let channel = "mtQuick"

    /// AppDelegate 补丁读它：常驻开着 ⇒ 最后一个窗口关了也不退出。
    /// 页面还没发来 quick-config 之前是 false —— 老行为（关窗即退出）是安全的默认。
    static var keepAlive: Bool { shared.enabled }

    private var enabled = false
    private var seen = false
    private var labels: [String: String] = [:]
    private var item: NSStatusItem?
    private weak var webView: WKWebView?
    private weak var mainWindow: NSWindow?
    private var closeGuard: MTResidentCloseGuard?

    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: MTResident.channel)
        ucc.add(self, name: MTResident.channel)
        // 右键「服务」不看常驻开关，也可能正是它把 App 冷启动起来的 ⇒ 一启动就登记，不等页面的 quick-config。
        MTQuickServices.shared.install()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "quick-probe":
            emit(["type": "quick-caps", "resident": true, "panel": true])
        case "quick-config":
            enabled = (body["enabled"] as? Bool) ?? false
            seen = (body["seen"] as? Bool) ?? false
            labels = (body["labels"] as? [String: String]) ?? labels
            refresh()
        case "quick-close-main":
            seen = true
            mainWindowNow()?.orderOut(nil)
        default:
            break
        }
    }

    // MARK: - 菜单栏

    private func refresh() {
        if enabled {
            if item == nil {
                let it = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
                if let img = NSApp.applicationIconImage.copy() as? NSImage {
                    img.size = NSSize(width: 18, height: 18)
                    it.button?.image = img
                }
                item = it
            }
            item?.menu = buildMenu()
            installCloseGuard()
            MTQuickPanel.shared.enable()
        } else {
            if let it = item { NSStatusBar.system.removeStatusItem(it); item = nil }
            MTQuickPanel.shared.disable()
        }
    }

    private func buildMenu() -> NSMenu {
        let m = NSMenu()
        let clip = NSMenuItem(title: labels["clip"] ?? "", action: #selector(menuClipboard), keyEquivalent: "t")
        // 只是把全局快捷键写在菜单上；真正的注册在 MTHotkey
        clip.keyEquivalentModifierMask = [.control, .option]
        clip.target = self
        let input = NSMenuItem(title: labels["input"] ?? "", action: #selector(menuInput), keyEquivalent: "")
        input.target = self
        m.addItem(clip); m.addItem(input); m.addItem(.separator())
        let open = NSMenuItem(title: labels["open"] ?? "", action: #selector(menuOpen), keyEquivalent: "")
        open.target = self
        let settings = NSMenuItem(title: labels["settings"] ?? "", action: #selector(menuSettings), keyEquivalent: "")
        settings.target = self
        let quit = NSMenuItem(title: labels["quit"] ?? "", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        m.addItem(open); m.addItem(settings); m.addItem(.separator()); m.addItem(quit)
        return m
    }

    @objc private func menuOpen() { showMainWindow() }
    @objc private func menuSettings() { openSettings() }
    @objc private func menuClipboard() { MTQuickPanel.shared.translateClipboard() }
    @objc private func menuInput() { MTQuickPanel.shared.typeToTranslate() }

    func openSettings() { showMainWindow(); emit(["type": "quick-open-settings"]) }

    /// 面板页交来的消息原样交给主页面（quick-capture / quick-result）。
    func relay(_ payload: [String: Any]) { emit(payload) }

    private func mainWindowNow() -> NSWindow? {
        if let w = mainWindow { return w }
        let w = webView?.window ?? NSApp.windows.first { !($0 is NSPanel) && $0.contentViewController != nil }
        mainWindow = w
        return w
    }

    func showMainWindow() {
        mainWindowNow()?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - 常驻时关主窗口 = 收起

    private func installCloseGuard() {
        guard closeGuard == nil, let w = mainWindowNow() else { return }
        let g = MTResidentCloseGuard(original: w.delegate)
        closeGuard = g
        w.delegate = g
    }

    /// 关闭守卫问这里。返回 true = 放行给原来的委托（真的关）。
    fileprivate func shouldReallyClose(_ window: NSWindow) -> Bool {
        guard enabled else { return true }
        if !seen {
            // 第一次：窗口先留着，让页面把那句话说完；页面读完会发 quick-close-main。
            emit(["type": "quick-first-close"])
            return false
        }
        window.orderOut(nil)
        return false
    }

    private func emit(_ payload: [String: Any]) {
        guard let webView = self.webView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            webView.evaluateJavaScript("window.AppQuickHost && window.AppQuickHost._fromNative(\(json))", completionHandler: nil)
        }
    }
}

/// 主窗口的关闭守卫。实时字幕那一个（MTCloseGuard）可能已经先装上了 —— 这里包在它外面：
/// 常驻不拦的时候原样转给它，两条规则互不覆盖。
final class MTResidentCloseGuard: NSObject, NSWindowDelegate {
    weak var original: NSWindowDelegate?
    init(original: NSWindowDelegate?) { self.original = original }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if !MTResident.shared.shouldReallyClose(sender) { return false }
        return original?.windowShouldClose?(sender) ?? true
    }
    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }
    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let o = original, o.responds(to: aSelector) { return o }
        return super.forwardingTarget(for: aSelector)
    }
}
#endif
