// app/native/subtitle-bar.swift — 「实时字幕」的 Mac 悬浮字幕条（learning-design §9.8 · interaction-spec M5–M9）。
//
// 这个文件**不是 Xcode 工程的成员**：`scripts/sync-app-assets.js` 把它整块贴进
// `Shared (App)/ViewController.swift` 的 mt-subtitle-bar 标记块（与 audio-bridge.swift 同一个做法、同一个理由）。
// 整份只在 macOS 编译；iOS 的字幕位置是画中画小窗（一期另做）。
//
// ── 零文案 ─────────────────────────────────────────────────────────────────────
// 条上的每个字、按钮上的每个字、「窗口」菜单里的三项，都来自 `subtitle-config.labels`（JS 的 _locales）。
// 这里只有协议 id 与两个字形符号（A− / A+），`npm test` 用字符串白名单钉住。
//
// ── 形状（尖刺 S4 实证）─────────────────────────────────────────────────────────
// NSPanel [.nonactivatingPanel, .borderless, .resizable] + .floating + [.canJoinAllSpaces, .fullScreenAuxiliary]
// + hidesOnDeactivate = false ⇒ 盖在别的 App 的全屏视频上、从不成为 key（点条之后空格仍暂停视频）。
// 系统 hudWindow 材质在深色底上显浅灰 ⇒ 自绘 rgba(22,20,18,0.74) 底。
//
// ── 按钮回页面（§9.8 协议补充决定 9）─────────────────────────────────────────────
// 暂停 / 继续 → remote pause / play；A− / A+ → remote font-down / font-up（字号由 JS 存）；结束 → remote end；
// 主窗口 → 原生直接拉回主窗口 + remote open-app；打开系统设置 → 原生直接开隐私面板；穿透 → 原生本地态。
#if os(macOS)
import AppKit

final class MTSubtitleBar: NSObject, NSWindowDelegate {

    static let shared = MTSubtitleBar()

    /// 字幕条在 ⇒ 有字幕会话。AppDelegate 补丁读它：会话中最后一个窗口「关了」也不退出。
    static var sessionActive: Bool { shared.panel != nil }

    /// 条上按钮 → 桥（`remote {command}`）。由 MTAudioBridge 在 subtitle-config 时设。
    var onRemote: ((String) -> Void)?

    private var panel: NSPanel?
    private weak var mainWindow: NSWindow?
    private var closeGuard: MTCloseGuard?
    private var activity: NSObjectProtocol?
    private var menuItems: [NSMenuItem] = []

    private var stateLabels: [String: String] = [:]
    private var controlLabels: [String: String] = [:]
    private var menuLabels: [String: String] = [:]
    private var fontScale: CGFloat = 1
    private var opacity: CGFloat = 1
    private var clickThrough = false

    private var orig = ""
    private var tr = ""
    private var partial = false
    private var state = "listening"
    private var pct = 0

    private let box = MTBarView()
    private let trLabel = NSTextField(wrappingLabelWithString: "")
    private let origLabel = NSTextField(labelWithString: "")
    private let stateLabel = NSTextField(labelWithString: "")
    private let actionButton = NSButton()
    private let stateRow = NSStackView()
    private let badge = NSTextField(labelWithString: "")
    private let controls = NSStackView()
    private var toggleButton: NSButton?

    private var dragStart = NSPoint.zero
    private var dragOrigin = NSPoint.zero

    // MARK: - 桥 → 条

    /// `subtitle-config {labels, clickThrough, fontScale, opacity}`。会话开始发一次，改字号时再发。
    func configure(_ body: [String: Any], window: NSWindow?) {
        let labels = body["labels"] as? [String: Any] ?? [:]
        stateLabels = labels["state"] as? [String: String] ?? stateLabels
        controlLabels = labels["controls"] as? [String: String] ?? controlLabels
        menuLabels = labels["menu"] as? [String: String] ?? menuLabels
        fontScale = CGFloat((body["fontScale"] as? NSNumber)?.doubleValue ?? 1)
        opacity = CGFloat((body["opacity"] as? NSNumber)?.doubleValue ?? 1)
        let firstShow = panel == nil
        if firstShow {
            clickThrough = (body["clickThrough"] as? Bool) ?? false
            if let window { mainWindow = window }
            buildPanel()
            installCloseGuard()
            activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: MTAudioBridge.channel)
        }
        rebuildControls()
        installMenu()
        applyClickThrough()
        render()
        if firstShow { panel?.orderFrontRegardless() }
    }

    /// `subtitle-show {orig, tr, partial}`：最新一句（半句或定稿）。
    func show(_ body: [String: Any]) {
        orig = body["orig"] as? String ?? ""
        tr = body["tr"] as? String ?? ""
        partial = (body["partial"] as? Bool) ?? false
        render()
    }

    /// `subtitle-state {state, pct?}`：条上那一行状态。文字取 labels.state[state]。
    func setState(_ body: [String: Any]) {
        state = body["state"] as? String ?? state
        pct = (body["pct"] as? NSNumber)?.intValue ?? 0
        render()
    }

    /// `subtitle-hide`：会话结束。条、菜单项、关闭守卫、activity 一并收掉；主窗口若被隐藏着就放回来（不激活）。
    func hide() {
        guard let p = panel else { return }
        p.orderOut(nil)
        panel = nil
        removeMenu()
        if let g = closeGuard, let w = mainWindow {
            w.delegate = g.original
            if !w.isVisible { w.orderFront(nil) }
        }
        closeGuard = nil
        if let a = activity { ProcessInfo.processInfo.endActivity(a) }
        activity = nil
        orig = ""; tr = ""; partial = false; state = "listening"; pct = 0
        clickThrough = false
    }

    /// Dock 点击 / 菜单「显示主窗口」/ 条上「主窗口」。
    static func showMainWindow() {
        let w = shared.mainWindow ?? NSApp.windows.first { !($0 is NSPanel) && $0.contentViewController != nil }
        w?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - 视图

    private func buildPanel() {
        let screen = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let w: CGFloat = min(760, screen.width - 80), h: CGFloat = 96
        let p = NSPanel(contentRect: NSRect(x: screen.midX - w / 2, y: screen.minY + 80, width: w, height: h),
                        styleMask: [.nonactivatingPanel, .borderless, .resizable], backing: .buffered, defer: false)
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isFloatingPanel = true
        p.becomesKeyOnlyIfNeeded = true
        p.isMovableByWindowBackground = false   // 拖动自己做：松手时要吸附（M7）
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.minSize = NSSize(width: 320, height: 56)
        p.delegate = self
        // 位置与宽度记住（§9.8 协议补充决定 6：条的位置由原生自存）
        if !p.setFrameUsingName(MTAudioBridge.channel) { p.setFrame(p.frame, display: false) }
        p.setFrameAutosaveName(MTAudioBridge.channel)

        box.wantsLayer = true
        box.layer?.cornerRadius = 18
        box.layer?.masksToBounds = true
        box.onHover = { [weak self] inside in self?.hover(inside) }
        box.onDrag = { [weak self] phase in self?.drag(phase) }

        for l in [trLabel, origLabel, stateLabel, badge] {
            l.isSelectable = false
            l.drawsBackground = false
            l.isBezeled = false
        }
        trLabel.textColor = .white
        trLabel.maximumNumberOfLines = 2
        trLabel.cell?.truncatesLastVisibleLine = true
        origLabel.textColor = NSColor.white.withAlphaComponent(0.66)
        origLabel.maximumNumberOfLines = 1
        origLabel.lineBreakMode = .byTruncatingHead      // 长句看最新的词
        stateLabel.textColor = NSColor.white.withAlphaComponent(0.82)
        stateLabel.maximumNumberOfLines = 2
        stateLabel.lineBreakMode = .byWordWrapping
        badge.textColor = NSColor.white.withAlphaComponent(0.6)

        actionButton.bezelStyle = .inline
        actionButton.target = self
        stateRow.orientation = .horizontal
        stateRow.alignment = .firstBaseline
        stateRow.spacing = 10
        stateRow.addArrangedSubview(stateLabel)
        stateRow.addArrangedSubview(actionButton)

        let stack = NSStackView(views: [stateRow, trLabel, origLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)

        controls.orientation = .horizontal
        controls.spacing = 6
        controls.isHidden = true
        controls.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(controls)
        badge.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(badge)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -22),
            stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: box.bottomAnchor, constant: -14),
            trLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            origLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            controls.topAnchor.constraint(equalTo: box.topAnchor, constant: 8),
            controls.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -12),
            badge.topAnchor.constraint(equalTo: box.topAnchor, constant: 8),
            badge.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -14),
        ])
        p.contentView = box
        panel = p
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let b = NSButton(title: title, target: self, action: action)
        b.bezelStyle = .recessed
        setTitle(b, title, size: 12)
        return b
    }

    /// 深色底上的白字。真机读数（M27）：.recessed / .inline 两种按钮都不认 contentTintColor，字是深灰压深色底、几乎看不见 ——
    /// 只有 attributedTitle 管用。每次改字都要走这里，直接赋 title 会把颜色冲掉。
    private func setTitle(_ b: NSButton, _ title: String, size: CGFloat) {
        b.attributedTitle = NSAttributedString(string: title, attributes: [
            .foregroundColor: NSColor.white,
            .font: NSFont.systemFont(ofSize: size, weight: .medium),
        ])
    }

    /// 暂停 / 继续 · 穿透 · A− · A+ · 主窗口 · 结束（M6 ④）。文字随 labels 变，所以每次 config 重建。
    private func rebuildControls() {
        for v in controls.arrangedSubviews { controls.removeArrangedSubview(v); v.removeFromSuperview() }
        let toggle = button(controlLabels["pause"] ?? "", #selector(tapToggle))
        toggleButton = toggle
        for b in [toggle,
                  button(controlLabels["clickThrough"] ?? "", #selector(tapClickThrough)),
                  button("A−", #selector(tapFontDown)),
                  button("A+", #selector(tapFontUp)),
                  button(controlLabels["main"] ?? "", #selector(tapMain)),
                  button(controlLabels["end"] ?? "", #selector(tapEnd))] {
            controls.addArrangedSubview(b)
        }
        badge.stringValue = controlLabels["clickThrough"] ?? ""
    }

    private var listening: Bool { state == "listening" || state == "tr-failed" || state == "downloading" || state == "reconnecting" || state == "silent" }

    private func render() {
        guard let p = panel else { return }
        box.layer?.backgroundColor = NSColor(calibratedRed: 22 / 255, green: 20 / 255, blue: 18 / 255, alpha: 0.74 * max(0.3, min(opacity, 1))).cgColor

        let big = NSFont.systemFont(ofSize: 26 * fontScale, weight: .semibold)
        trLabel.font = partial ? NSFontManager.shared.convert(big, toHaveTrait: .italicFontMask) : big
        origLabel.font = .systemFont(ofSize: 16 * fontScale)
        stateLabel.font = .systemFont(ofSize: 14 * fontScale)
        badge.font = .systemFont(ofSize: 11, weight: .medium)

        // 译文大字在上、原文小字在下；还没译文（半句 / 这句译文失败）时原文顶到大字位。
        // 只有标点、没有一个字母或数字的半句不显示（真机读数 M27：暂停后条上残留「••••」「.」）。
        let meaningful = { (s: String) -> Bool in s.rangeOfCharacter(from: .alphanumerics) != nil }
        let rawHead = tr.isEmpty ? orig : tr
        let head = meaningful(rawHead) ? rawHead : ""
        trLabel.stringValue = partial && !head.isEmpty ? head + "…" : head
        trLabel.isHidden = head.isEmpty
        origLabel.stringValue = tr.isEmpty ? "" : orig
        origLabel.isHidden = tr.isEmpty || !meaningful(orig) || head.isEmpty

        // 状态行：非 listening 一律显示；listening 只在还没出字时显示（「正在听系统声音…」）
        let text = (stateLabels[state] ?? "").replacingOccurrences(of: "{pct}", with: String(pct))
        let showState = !text.isEmpty && (state != "listening" || head.isEmpty)
        stateLabel.stringValue = text
        stateRow.isHidden = !showState

        // 行内出口：拒绝 / 还没听到系统声音（不中断，决定 10 修订二）/ 没听到过声音就静音暂停（O2）⇒ 打开系统设置；
        // 停下 ⇒ 继续（不自动恢复）。silence-permission 的「继续」在悬停控件的切换钮上
        if state == "denied" || state == "silent" || state == "silence-permission" {
            let title = controlLabels["openSettings"] ?? ""
            setTitle(actionButton, title, size: 13 * fontScale)
            actionButton.action = #selector(tapOpenSettings)
            actionButton.isHidden = title.isEmpty
        } else if state == "paused" || state == "silence" || state == "socket" {
            let title = controlLabels["resume"] ?? ""
            setTitle(actionButton, title, size: 13 * fontScale)
            actionButton.action = #selector(tapToggle)
            actionButton.isHidden = title.isEmpty
        } else {
            actionButton.isHidden = true
        }
        if let toggle = toggleButton {
            setTitle(toggle, listening ? (controlLabels["pause"] ?? "") : (controlLabels["resume"] ?? ""), size: 12)
        }

        fitHeight(p)
    }

    /// 高度随内容走，宽度由用户拉。靠近屏幕下半部时保持底边不动（字幕往上长），上半部保持顶边不动。
    private func fitHeight(_ p: NSPanel) {
        box.layoutSubtreeIfNeeded()
        let want = max(p.minSize.height, box.fittingSize.height)
        var f = p.frame
        guard abs(f.height - want) > 0.5 else { return }
        let screen = p.screen?.visibleFrame ?? f
        if f.midY > screen.midY { f.origin.y += f.height - want }
        f.size.height = want
        p.setFrame(f, display: true)
    }

    // MARK: - 悬停、拖动、吸附

    private func hover(_ inside: Bool) {
        controls.isHidden = !inside || clickThrough
        badge.isHidden = !clickThrough || inside
    }

    private func drag(_ phase: Int) {
        guard let p = panel else { return }
        let at = NSEvent.mouseLocation
        switch phase {
        case 0:
            dragStart = at; dragOrigin = p.frame.origin
        case 1:
            p.setFrameOrigin(NSPoint(x: dragOrigin.x + at.x - dragStart.x, y: dragOrigin.y + at.y - dragStart.y))
        default:
            snap(p)
        }
    }

    /// 两个吸附位：屏幕底部居中、顶部居中（M7）。离得够近才吸，其余位置原样留着。
    private func snap(_ p: NSPanel) {
        let s = (p.screen ?? NSScreen.main)?.visibleFrame ?? p.frame
        let f = p.frame
        let spots = [NSPoint(x: s.midX - f.width / 2, y: s.minY + 80), NSPoint(x: s.midX - f.width / 2, y: s.maxY - f.height - 40)]
        for spot in spots where hypot(spot.x - f.origin.x, spot.y - f.origin.y) < 72 {
            p.setFrame(NSRect(origin: spot, size: f.size), display: true, animate: true)
            return
        }
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if let p = panel { fitHeight(p) }
    }

    private func applyClickThrough() {
        panel?.ignoresMouseEvents = clickThrough
        controls.isHidden = true
        badge.isHidden = !clickThrough
    }

    // MARK: - 按钮

    @objc private func tapToggle() { onRemote?(listening ? "pause" : "play") }
    @objc private func tapFontDown() { onRemote?("font-down") }
    @objc private func tapFontUp() { onRemote?("font-up") }
    @objc private func tapEnd() { onRemote?("end") }
    @objc private func tapMain() {
        MTSubtitleBar.showMainWindow()
        onRemote?("open-app")
    }
    @objc private func tapClickThrough() {
        clickThrough = true
        applyClickThrough()
    }
    @objc private func tapOpenSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - 「窗口」菜单（M9）：穿透中的条收不到点击，出口必须在别处

    private func installMenu() {
        removeMenu()
        guard let menu = NSApp.windowsMenu else { return }
        let items = [
            NSMenuItem(title: menuLabels["showMain"] ?? "", action: #selector(menuShowMain), keyEquivalent: ""),
            NSMenuItem(title: menuLabels["cancelClickThrough"] ?? "", action: #selector(menuCancelClickThrough), keyEquivalent: ""),
            NSMenuItem(title: menuLabels["end"] ?? "", action: #selector(tapEnd), keyEquivalent: ""),
            NSMenuItem.separator(),
        ]
        for (i, it) in items.enumerated() {
            it.target = self
            menu.insertItem(it, at: i)
        }
        menuItems = items
    }

    private func removeMenu() {
        for it in menuItems { it.menu?.removeItem(it) }
        menuItems = []
    }

    @objc private func menuShowMain() { MTSubtitleBar.showMainWindow() }
    @objc private func menuCancelClickThrough() {
        clickThrough = false
        applyClickThrough()
    }

    // MARK: - 会话中关主窗口 = 隐藏（§9.8 协议补充决定 14）

    private func installCloseGuard() {
        guard let w = mainWindow, closeGuard == nil else { return }
        let g = MTCloseGuard(original: w.delegate)
        closeGuard = g
        w.delegate = g
    }
}

/// 主窗口的关闭守卫：会话中 windowShouldClose 改成 orderOut；其余委托方法原样转给原来的委托（storyboard 里是窗口控制器）。
final class MTCloseGuard: NSObject, NSWindowDelegate {
    weak var original: NSWindowDelegate?
    init(original: NSWindowDelegate?) { self.original = original }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if MTSubtitleBar.sessionActive {
            sender.orderOut(nil)
            return false
        }
        return original?.windowShouldClose?(sender) ?? true
    }
    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }
    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        (original?.responds(to: aSelector) ?? false) ? original : super.forwardingTarget(for: aSelector)
    }
}

/// 条的底：悬停出控件、按住拖动（松手吸附）。点在文字上也算拖条；只有按钮自己接点击。
final class MTBarView: NSView {
    var onHover: ((Bool) -> Void)?
    var onDrag: ((Int) -> Void)?
    private var area: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let a = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(a)
        area = a
    }
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let v = super.hitTest(point) else { return nil }
        return (v is NSButton || v.superview is NSButton) ? v : self
    }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
    override func mouseDown(with event: NSEvent) { onDrag?(0) }
    override func mouseDragged(with event: NSEvent) { onDrag?(1) }
    override func mouseUp(with event: NSEvent) { onDrag?(2) }
}
#endif
