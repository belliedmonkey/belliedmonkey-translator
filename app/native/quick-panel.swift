// app/native/quick-panel.swift — macOS 快速翻译的面板（docs/learning-design.md §9.9，决定 D2）。
//
// 标记块，整份 #if os(macOS)。面板 = 不抢焦点的 NSPanel + **第二个 WKWebView**，加载同一份 Main.html 并在
// document-start 注入 `location.hash = '#quick'`（loadFileURL 不收带 # 的地址，T2 读数）。同源 ⇒ 引擎配置、
// 界面语言、「译成」直接共享。面板页只显示与翻译；「进复习库」与「翻成了 / 失败了」经这里中继给主页面
// （MTResident.relay）—— 主页面那个 WebView 在主窗口收起后仍然活着，桥消息 1–2 ms 送达（S3 读数）。
//
// 协议（通道 mtQuick；与 app/quick.js 的 PROTOCOL 逐字对表，npm test 守着）：
//   原生 → 面板页  quick-show {via, origin, text?, concealed?, own?, blocked?, fresh}
//                 quick-ocr {lines}                         截图识别出的行框（screen-ocr.swift）
//                 quick-image {dataUri}                     只在用户点了「用我的识图引擎再试」之后
//   面板页 → 原生  quick-ready · quick-resize {h} · quick-close · quick-pin {on} · quick-copy {text}
//                 quick-capture {…} · quick-result {…}      ⇒ 原样中继给主页面
//                 quick-open-settings                       ⇒ 聚焦主窗口的设置
//                 quick-reselect                            重新框选 / 改用截图翻译
//                 quick-request-perm {which} · quick-open-privacy {which} · quick-relaunch   录屏权限（which = screen）
//                 quick-ocr-cloud                           用户点了「用我的识图引擎再试」
//
// 零权限路径：快捷键 ⇒ 读剪贴板。三件不能错的事 ——
//   · 带隐藏 / 临时标记（密码管理器打的）⇒ **根本不读文字**，只告诉页面 concealed
//   · 读取放后台队列 + 1 秒超时：剪贴板隐私开着时后台读取会**卡住不返回**（T2 读数：>90 s）
//   · 我们自己刚复制出去的译文（记下 changeCount）⇒ own，不再翻一遍
// 这里没有任何给用户看的文案。
#if os(macOS)
import AppKit
import WebKit
import Carbon.HIToolbox

/// 无边框的面板默认成不了 key —— 输入翻译要打字，所以放开；但永远不当 main，不抢主窗口的身份。
final class MTQuickPanelWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// 面板不抢焦点 ⇒ 它多半不是 key 窗口；AppKit 默认把「点在非 key 窗口上的第一下」只用来激活窗口，
/// 于是复制 / 钉住 / 关闭要点两次。放开它：第一下就是一次真的点击。
final class MTQuickWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class MTQuickPanel: NSObject, WKScriptMessageHandler {

    static let shared = MTQuickPanel()
    static let channel = "mtQuick"

    private static let width: CGFloat = 400
    private static let minHeight: CGFloat = 120
    private static let hotkeyClipboard: UInt32 = 1
    private static let hotkeyScreenshot: UInt32 = 2
    private static let hotkeyEscape: UInt32 = 9

    private var panel: MTQuickPanelWindow?
    private var web: WKWebView?
    private var ready = false
    private var pending: [[String: Any]] = []
    private var pinned = false
    private var topLeft = NSPoint.zero
    private var monitors: [Any] = []
    private var ownChangeCount = -1

    /// 用户想不想用增强取词（页面经 quick-config 给）。真的用不用，每次按键时再读一次系统权限。
    var enhanced = false

    var isEnabled: Bool { web != nil }

    // MARK: - 开 / 关（跟着「在菜单栏常驻」走）

    func enable() {
        guard web == nil else { return }
        // 默认 ⌃⌥T。不用纯 ⌥ 组合：macOS 15 的沙盒对它有限制。录制控件在 M-7。
        MTHotkey.shared.register(id: MTQuickPanel.hotkeyClipboard, keyCode: UInt32(kVK_ANSI_T),
                                 modifiers: UInt32(controlKey | optionKey)) { [weak self] in self?.hotkeyPressed() }
        // 截图翻译 ⌃⌥S（macOS 14+；更低的系统上入口整个不出现）。
        if MTScreenShot.supported {
            MTHotkey.shared.register(id: MTQuickPanel.hotkeyScreenshot, keyCode: UInt32(kVK_ANSI_S),
                                     modifiers: UInt32(controlKey | optionKey)) { [weak self] in self?.translateScreenshot() }
            MTScreenShot.prewarmIfNeeded()
        }
        // 预热：第二个 WebContent 进程约 70–80 MB，冷启动 70 ms；主窗口先就绪，2 秒后再建。
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.buildIfNeeded() }
    }

    func disable() {
        MTHotkey.shared.unregister(id: MTQuickPanel.hotkeyClipboard)
        MTHotkey.shared.unregister(id: MTQuickPanel.hotkeyScreenshot)
        // 右键「服务」不看常驻开关：App 被它冷启动时，页面随后发来的「常驻关着」不能把正在用的面板拆掉。
        if panel?.isVisible == true || !pending.isEmpty { return }
        hide()
        web?.configuration.userContentController.removeScriptMessageHandler(forName: MTQuickPanel.channel)
        panel?.contentView = nil
        panel = nil; web = nil; ready = false; pending = []
    }

    /// force：右键「服务」是用户明确点的，不看常驻开关（services.swift）。预热那一路照旧只在常驻开着时建。
    private func buildIfNeeded(force: Bool = false) {
        guard web == nil, force || MTResident.keepAlive,
              let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
              let root = Bundle.main.resourceURL else { return }
        let conf = WKWebViewConfiguration()
        conf.userContentController.addUserScript(WKUserScript(source: "location.hash = '#quick';",
                                                              injectionTime: .atDocumentStart, forMainFrameOnly: true))
        conf.userContentController.add(self, name: MTQuickPanel.channel)
        let w = MTQuickWebView(frame: NSRect(x: 0, y: 0, width: MTQuickPanel.width, height: MTQuickPanel.minHeight), configuration: conf)
        w.setValue(false, forKey: "drawsBackground")          // 圆角之外要透出去
        w.autoresizingMask = [.width, .height]
        let p = MTQuickPanelWindow(contentRect: w.frame, styleMask: [.nonactivatingPanel, .borderless],
                                   backing: .buffered, defer: true)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.level = .floating
        p.hidesOnDeactivate = false
        p.isMovableByWindowBackground = true
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        p.contentView = w
        panel = p; web = w
        w.loadFileURL(page, allowingReadAccessTo: root)
    }

    // MARK: - 入口

    /// 快捷键：想用增强取词**且此刻系统权限在** ⇒ 取选中的文字；否则就是「翻译剪贴板」。
    /// 权限事后被用户撤销时，这里自动落回剪贴板那条路 —— 不报错、不卡住。
    func hotkeyPressed() {
        if enhanced && MTQuickCapture.granted { translateSelection() } else { translateClipboard() }
    }

    /// 增强取词：替用户按一次 ⌘C，读到后把剪贴板原样写回（capture.swift）。
    func translateSelection() {
        MTQuickCapture.captureSelection { [weak self] outcome in
            var m: [String: Any] = ["type": "quick-show", "via": "select", "origin": "selection"]
            switch outcome {
            case .text(let t): m["text"] = t
            case .concealed: m["concealed"] = true
            case .blocked: m["blocked"] = true
            }
            self?.present(m, focus: false)
        }
    }

    /// 菜单「翻译剪贴板」
    func translateClipboard() {
        readClipboard { [weak self] payload in
            var m = payload
            m["type"] = "quick-show"; m["via"] = "select"; m["origin"] = "clipboard"
            self?.present(m, focus: false)
        }
    }

    /// 右键「服务」交来的文字（services.swift）。不是通用剪贴板 ⇒ 三个陷阱都不适用，来源标签是「服务」。
    func translateFromService(_ text: String) {
        present(["type": "quick-show", "via": "service", "origin": "service", "text": text], focus: false, force: true)
    }

    /// 截图翻译（screen-ocr.swift）：快捷键 ⌃⌥S、菜单、面板里的「重新框选」/「改用截图翻译」都到这里。
    /// 没有录屏权限 ⇒ 不框选，面板里先把话说清楚（系统弹窗之前我们自己的话先到；入口不因为被拒而消失）。
    func translateScreenshot() {
        guard MTScreenShot.supported else { return }
        guard MTScreenShot.granted else {
            let appName = (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? ""
            present(["type": "quick-show", "via": "shot", "origin": "screen", "perm": "screen", "appName": appName], focus: false, force: true)
            return
        }
        hide()
        MTScreenShot.shared.pickRegion { [weak self] image in
            guard let s = self, let image = image else { return }      // Esc / 太小 / 截不到：什么都不出现
            s.present(["type": "quick-show", "via": "shot", "origin": "screen", "busy": true, "first": !MTScreenShot.visionWarm],
                      focus: false, force: true)
            MTScreenShot.recognize(image) { lines in s.send(["type": "quick-ocr", "lines": lines]) }
        }
    }

    /// 菜单「输入翻译」
    func typeToTranslate() {
        present(["type": "quick-show", "via": "input", "origin": "typed"], focus: true)
    }

    private func readClipboard(_ done: @escaping ([String: Any]) -> Void) {
        var finished = false                                   // 只在主线程读写
        let own = ownChangeCount
        DispatchQueue.global(qos: .userInitiated).async {
            let pb = NSPasteboard.general
            let marks = (pb.types ?? []).map { $0.rawValue }
            let concealed = marks.contains("org.nspasteboard.ConcealedType") || marks.contains("org.nspasteboard.TransientType")
            var out: [String: Any] = [:]
            if concealed {
                out["concealed"] = true                        // 文字一个字都不读
            } else {
                if pb.changeCount == own { out["own"] = true }
                out["text"] = pb.string(forType: .string) ?? ""
            }
            DispatchQueue.main.async { if !finished { finished = true; done(out) } }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { if !finished { finished = true; done(["blocked": true]) } }
    }

    private func present(_ message: [String: Any], focus: Bool, force: Bool = false) {
        buildIfNeeded(force: force)
        guard let p = panel else { return }
        var m = message
        let wasVisible = p.isVisible
        m["fresh"] = !wasVisible                               // 面板会话的起点：遥测「每会话一条」按它算
        if !wasVisible || !pinned { place(p) }                 // 钉住时再次触发 ⇒ 原地换内容
        if focus { p.makeKeyAndOrderFront(nil) } else { p.orderFrontRegardless() }
        if !wasVisible { startDismissWatch() }
        send(m)
    }

    // MARK: - 位置与尺寸

    /// 鼠标右下方；贴边就翻到另一侧。之后变高只往下长（顶边不动），长到屏幕底就往上顶。
    private func place(_ p: NSPanel) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        guard let vf = screen?.visibleFrame else { return }
        let h = max(p.frame.height, MTQuickPanel.minHeight)
        var x = mouse.x + 14
        if x + MTQuickPanel.width > vf.maxX - 8 { x = mouse.x - 14 - MTQuickPanel.width }
        x = min(max(x, vf.minX + 8), vf.maxX - 8 - MTQuickPanel.width)
        var top = mouse.y - 14
        if top - h < vf.minY + 8 { top = min(mouse.y + 14 + h, vf.maxY - 8) }
        topLeft = NSPoint(x: x, y: top)
        p.setFrame(NSRect(x: x, y: top - h, width: MTQuickPanel.width, height: h), display: true)
    }

    private func resize(to height: CGFloat) {
        guard let p = panel, let vf = (p.screen ?? NSScreen.main)?.visibleFrame else { return }
        let h = min(max(height, MTQuickPanel.minHeight), floor(vf.height * 0.7))
        var top = topLeft.y
        if top - h < vf.minY + 8 { top = min(vf.minY + 8 + h, vf.maxY - 8) }
        topLeft.y = top
        p.setFrame(NSRect(x: p.frame.minX, y: top - h, width: MTQuickPanel.width, height: h), display: true, animate: false)
        p.invalidateShadow()
    }

    // MARK: - 关闭规则：Esc / 点面板外；钉住后两者都不关

    private func startDismissWatch() {
        stopDismissWatch()
        guard !pinned else { return }
        // 面板不抢焦点 ⇒ Esc 到不了它。面板在、且没钉住的这段时间里，Esc 归我们。
        MTHotkey.shared.register(id: MTQuickPanel.hotkeyEscape, keyCode: UInt32(kVK_Escape), modifiers: 0) { [weak self] in self?.hide() }
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        if let g = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] _ in self?.hide() }) { monitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] ev in
            if let s = self, ev.window !== s.panel { s.hide() }
            return ev
        }) { monitors.append(l) }
    }

    private func stopDismissWatch() {
        MTHotkey.shared.unregister(id: MTQuickPanel.hotkeyEscape)
        for m in monitors { NSEvent.removeMonitor(m) }
        monitors = []
    }

    func hide() {
        stopDismissWatch()
        MTScreenShot.shared.discardImage()                     // 截图只留到面板收起为止
        pinned = false
        panel?.orderOut(nil)
    }

    // MARK: - 桥

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "quick-ready":
            ready = true
            let queued = pending; pending = []
            for m in queued { send(m) }
        case "quick-resize":
            if let h = body["h"] as? Double { resize(to: CGFloat(h)) }
        case "quick-close":
            hide()
        case "quick-pin":
            pinned = (body["on"] as? Bool) ?? false
            if pinned { stopDismissWatch() } else if panel?.isVisible == true { startDismissWatch() }
        case "quick-copy":
            if let text = body["text"] as? String, !text.isEmpty {
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setString(text, forType: .string)
                ownChangeCount = pb.changeCount
            }
        case "quick-capture", "quick-result":
            MTResident.shared.relay(body)
        case "quick-open-settings":
            hide()
            MTResident.shared.openSettings()
        case "quick-reselect":
            translateScreenshot()
        case "quick-request-perm":
            if (body["which"] as? String) == "screen" { MTScreenShot.requestAccess() }
        case "quick-open-privacy":
            if (body["which"] as? String) == "screen" { MTScreenShot.openPrivacySettings() }
        case "quick-relaunch":
            MTQuickCapture.relaunch()
        case "quick-ocr-cloud":
            // 用户点了「用我的识图引擎再试」：只有这一条会把截图的像素交给页面（screen-ocr.swift 不变量 ②）。
            send(["type": "quick-image", "dataUri": MTScreenShot.shared.lastImageDataURL() ?? ""])
        default:
            break
        }
    }

    private func send(_ payload: [String: Any]) {
        guard ready, let web = self.web else { pending.append(payload); return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.AppQuick && window.AppQuick._fromNative(\(json))", completionHandler: nil)
    }
}
#endif
