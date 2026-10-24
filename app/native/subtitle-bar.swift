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
// 系统 hudWindow 材质在深色底上显浅灰 ⇒ 自绘不透明 rgb(22,20,18) 底。
// 曾经是 rgba(22,20,18,0.74)，后面窗口的字会透出来（#590）。subtitle-config.opacity 仍收下，不再乘进底色。
//
// ── 按钮回页面（§9.8 协议补充决定 9）─────────────────────────────────────────────
// 暂停 / 继续 → remote pause / play；A− / A+ → remote font-down / font-up（字号由 JS 存）；结束 → remote end；
// 主窗口 → 原生直接拉回主窗口 + remote open-app；打开系统设置 → 原生直接开隐私面板；穿透 → 原生本地态。
#if os(macOS)
import AppKit

/// 条与这些矩形（已是 AppKit 坐标）重叠时，挪到同一屏可见区域里最近的、不重叠的位置。
/// 不重叠就原样返回。距离一样时挑离障碍更远的那个（右下角的小窗 ⇒ 条去左下）。
func mtYieldedBar(_ bar: NSRect, screen: NSRect, obstacles: [NSRect]) -> NSRect {
    let gap: CGFloat = 16
    let inflated = obstacles.map { $0.insetBy(dx: -gap, dy: -gap) }
    func hits(_ r: NSRect) -> Bool { inflated.contains { $0.intersects(r) } }
    if !hits(bar) { return bar }
    let v = screen.insetBy(dx: 8, dy: 8)
    guard v.width + 1 >= bar.width, v.height + 1 >= bar.height else { return bar }
    let bottomY = min(v.maxY - bar.height, v.minY + 72)
    let topY = max(v.minY, v.maxY - bar.height - 32)
    let xs = [v.minX, v.maxX - bar.width, v.midX - bar.width / 2]
    let ys = bottomY == topY ? [bottomY] : [bottomY, topY]
    var spots: [NSRect] = []
    for y in ys {
        for x in xs {
            let r = NSRect(x: x, y: y, width: bar.width, height: bar.height)
            if v.insetBy(dx: -1, dy: -1).contains(r) { spots.append(r) }
        }
    }
    let clear = spots.filter { !hits($0) }
    guard let hit = inflated.first(where: { $0.intersects(bar) }) else { return bar }
    return clear.min { a, b in
        let da = hypot(a.minX - bar.minX, a.minY - bar.minY)
        let db = hypot(b.minX - bar.minX, b.minY - bar.minY)
        if abs(da - db) > 1 { return da < db }
        return hypot(a.midX - hit.midX, a.midY - hit.midY) > hypot(b.midX - hit.midX, b.midY - hit.midY)
    } ?? bar
}

/// 另一进程里、浮在我们这条（.floating）之上或自己名叫 PIP 的、比例像视频的小窗。
/// 菜单栏 / 程序坞又扁又宽，通知小卡是方形或层级更低，都进不来。
func mtLooksLikeVideoPip(owner: String, name: String, layer: Int, width: CGFloat, height: CGFloat, screenWidth: CGFloat, screenHeight: CGFloat, ownPID: Int32, pid: Int32) -> Bool {
    if pid == ownPID || pid == 0 { return false }
    if width < 160 || height < 90 { return false }
    if width > screenWidth * 0.7 || height > screenHeight * 0.7 { return false }
    let aspect = width / max(height, 1)
    if aspect < 1.2 || aspect > 2.45 { return false }
    let named = owner.range(of: "PIP", options: .caseInsensitive) != nil
        || name.range(of: "PIP", options: .caseInsensitive) != nil
    if named { return true }
    return layer >= Int(CGWindowLevelForKey(.floatingWindow))
}

struct MTForeignWindow {
    var pid: Int32
    var layer: Int
    var alpha: CGFloat
    var frame: NSRect
}

struct MTScreenGeom {
    var frame: NSRect
    var visible: NSRect
}

/// 窗口盖住整块屏（含菜单栏那一截）。比可见区域更高的捕获层会走到这里，系统全屏本身通常不会。
func mtWindowCoversScreen(_ window: NSRect, _ screen: NSRect) -> Bool {
    guard screen.width > 1, screen.height > 1 else { return false }
    let probe = screen.insetBy(dx: 8, dy: 8)
    return window.insetBy(dx: -2, dy: -2).contains(probe)
}

/// 和这块屏的可见区域对齐（系统全屏、以及放大到菜单栏下沿，两者的窗口矩形一样大）。
func mtWindowFillsVisible(_ window: NSRect, _ visible: NSRect) -> Bool {
    guard visible.width > 1, visible.height > 1 else { return false }
    return abs(window.minX - visible.minX) <= 8 && abs(window.minY - visible.minY) <= 8
        && abs(window.width - visible.width) <= 8 && abs(window.height - visible.height) <= 8
}

/// 系统全屏会在可见区域顶上放一条全宽、透明、约一行菜单高的窗口。放大到菜单栏下沿的普通窗口没有这条。
func mtFullscreenMenuStrip(_ window: NSRect, alpha: CGFloat, on visible: NSRect) -> Bool {
    if alpha > 0.05 { return false }
    if window.height < 20 || window.height > 48 { return false }
    if abs(window.width - visible.width) > 8 { return false }
    return abs(window.maxY - visible.maxY) <= 8
}

/// 全屏画面靠下的一条，横贯整屏。底下左 / 中 / 右都让不开，条就去上沿。
func mtCaptionBand(of screen: NSRect) -> NSRect {
    let bandH = min(max(140, screen.height * 0.22), screen.height * 0.4)
    return NSRect(x: screen.minX, y: screen.minY, width: screen.width, height: bandH)
}

/// `windows` 从前到后。系统全屏（有那条透明菜单）才返回画面底部的字幕带。
/// 放大到可见区域的普通窗口不算。比整块屏还高的捕获层跳过，继续看它后面的窗口。
func mtFullscreenCaptionBand(windows: [MTForeignWindow], screens: [MTScreenGeom], ownPID: Int32) -> NSRect? {
    for w in windows {
        if w.pid == ownPID || w.pid == 0 { continue }
        if w.layer < 0 || w.alpha < 0.05 { continue }
        if w.frame.width < 80 || w.frame.height < 80 { continue }
        guard let screen = screens.first(where: { mtWindowFillsVisible(w.frame, $0.visible) || mtWindowCoversScreen(w.frame, $0.frame) }) else { return nil }
        if windows.contains(where: { $0.pid == w.pid && mtFullscreenMenuStrip($0.frame, alpha: $0.alpha, on: screen.visible) }) {
            return mtCaptionBand(of: screen.frame)
        }
        if mtWindowCoversScreen(w.frame, screen.frame) && !mtWindowFillsVisible(w.frame, screen.visible) { continue }
        return nil
    }
    return nil
}

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
    private var dragging = false
    private var yieldTimer: Timer?
    private var screenObserver: NSObjectProtocol?
    private var activeObserver: NSObjectProtocol?
    private var resignObserver: NSObjectProtocol?
    private var spaceObserver: NSObjectProtocol?
    /// 用户放下的位置（系统视频小窗让开后的位置也算）。
    /// 自己的窗口、以及别的 App 全屏时让开画面底部，这两次挪动不写这里（#590 N / 全屏字幕带）。
    private var rememberedOrigin: NSPoint?
    private var parkedAside = false
    private var autosaveName = ""
    private var stackTop: NSLayoutConstraint?
    private static let textTop: CGFloat = 14

    /// 记住的位置可能来自另一块屏或更宽的屏（#590 J：条的右半截跑出屏幕）。夹回某块屏的可见区域内。
    static func clamped(_ f: NSRect) -> NSRect {
        let screens = NSScreen.screens
        let s = screens.max { $0.visibleFrame.intersection(f).width * $0.visibleFrame.intersection(f).height
            < $1.visibleFrame.intersection(f).width * $1.visibleFrame.intersection(f).height }
        let v = (s ?? NSScreen.main)?.visibleFrame ?? f
        var r = f
        r.size.width = min(r.width, v.width - 16)
        r.size.height = min(r.height, v.height - 16)
        r.origin.x = min(max(r.minX, v.minX + 8), v.maxX - 8 - r.width)
        r.origin.y = min(max(r.minY, v.minY + 8), v.maxY - 8 - r.height)
        return r
    }

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
        if firstShow {
            panel?.orderFrontRegardless()
            startYieldWatch()
            yieldToVideoPip(animated: false)
        }
    }

    /// `subtitle-show {orig, tr, partial}`：最新一句（半句或定稿）。
    func show(_ body: [String: Any]) {
        let o = body["orig"] as? String ?? ""
        let t = body["tr"] as? String ?? ""
        let isPartial = (body["partial"] as? Bool) ?? false
        // 没有一个字母/数字的半句（识别器换句时会先报空串或「.」）不顶掉上一句 —— 顶掉了条就塌成
        // 「正在听系统声音…」再弹回来（#590 O）。清屏只走非半句的空串（停下时页面发的那一条）。
        if isPartial && !MTSubtitleBar.meaningful(o) && !MTSubtitleBar.meaningful(t) { return }
        orig = o; tr = t; partial = isPartial
        // 新的一句已经来了：上一句的「这句译文失败」不再属于条上这句话
        if isPartial && state == "tr-failed" { state = "listening" }
        render()
    }

    static func meaningful(_ s: String) -> Bool { s.rangeOfCharacter(from: .alphanumerics) != nil }

    /// `s + "…"` 在 `width` 宽内放得下 `lines` 行就原样返回；放不下就从头砍，直到放得下，前面补「…」。
    static func tailFitting(_ s: String, font: NSFont, width: CGFloat, lines: Int) -> String {
        let attrs: [NSAttributedString.Key: Any] = [.font: font]
        let limit = NSLayoutManager().defaultLineHeight(for: font) * CGFloat(lines) + 1
        func fits(_ t: String) -> Bool {
            NSAttributedString(string: t + "…", attributes: attrs)
                .boundingRect(with: NSSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin]).height <= limit
        }
        if fits(s) { return s }
        let chars = Array(s)
        var lo = 1, hi = chars.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if fits("…" + String(chars[mid...])) { hi = mid } else { lo = mid + 1 }
        }
        return "…" + String(chars[lo...]).trimmingCharacters(in: .whitespaces)
    }

    /// `subtitle-state {state, pct?}`：条上那一行状态。文字取 labels.state[state]。
    func setState(_ body: [String: Any]) {
        state = body["state"] as? String ?? state
        pct = (body["pct"] as? NSNumber)?.intValue ?? 0
        render()
    }

    /// `subtitle-hide`：会话结束。条、菜单项、关闭守卫、activity 一并收掉；主窗口若被隐藏着就放回来（不激活）。
    func hide() {
        stopYieldWatch()
        // 单例活过会话。停掉时把「记住的位置 / 正在临时让开」清掉，下一场从自动保存重新来。
        parkedAside = false
        rememberedOrigin = nil
        guard let p = panel else { return }
        p.orderOut(nil)
        panel = nil
        removeMenu()
        if let g = closeGuard, let w = mainWindow {
            // 我们的守卫可能被快速翻译的常驻守卫包在里面（resident.swift，两者谁先装不一定）。
            // 还是最外层 ⇒ 照旧摘掉；被包着 ⇒ 把自己从链上剪出去。两个守卫的 original 都是 weak：
            // 直接把 delegate 设回 g.original 会连常驻守卫一起摘掉，而留着不剪，我们一释放链就断在这里。
            if w.delegate === g { w.delegate = g.original }
            else if let outer = w.delegate as? MTResidentCloseGuard, outer.original === g { outer.original = g.original }
            // 常驻开着时用户把主窗口收起来是有意的，字幕会话结束不该把它弹回来。
            if !w.isVisible && !MTResident.keepAlive { w.orderFront(nil) }
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
        shared.yieldToVideoPip(animated: true)
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
        p.setFrame(MTSubtitleBar.clamped(p.frame), display: false)
        p.setFrameAutosaveName(MTAudioBridge.channel)
        autosaveName = MTAudioBridge.channel
        rememberedOrigin = p.frame.origin
        parkedAside = false

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
        // 文字比条宽时只能折行 / 截断，不能把条撑宽：标签默认的抗压缩（750）高于窗口
        // 「保持尺寸」（500），一句没出行的长实时行会把整条推出屏幕右缘（#590 J，u4 录屏 40 s）。
        for l in [trLabel, origLabel, stateLabel] {
            l.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
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

        let top = stack.topAnchor.constraint(equalTo: box.topAnchor, constant: MTSubtitleBar.textTop)
        stackTop = top
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -22),
            top,
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
        _ = opacity
        box.layer?.backgroundColor = NSColor(calibratedRed: 22 / 255, green: 20 / 255, blue: 18 / 255, alpha: 1).cgColor

        let big = NSFont.systemFont(ofSize: 26 * fontScale, weight: .semibold)
        trLabel.font = partial ? NSFontManager.shared.convert(big, toHaveTrait: .italicFontMask) : big
        origLabel.font = .systemFont(ofSize: 16 * fontScale)
        stateLabel.font = .systemFont(ofSize: 14 * fontScale)
        badge.font = .systemFont(ofSize: 11, weight: .medium)

        // 译文大字在上、原文小字在下；还没译文（半句 / 这句译文失败）时原文顶到大字位。
        // 只有标点、没有一个字母或数字的半句不显示（真机读数 M27：暂停后条上残留「••••」「.」）。
        let meaningful = MTSubtitleBar.meaningful
        let rawHead = tr.isEmpty ? orig : tr
        let head = meaningful(rawHead) ? rawHead : ""
        let textWidth = max(80, p.frame.width - 44)
        for l in [trLabel, origLabel, stateLabel] { l.preferredMaxLayoutWidth = textWidth }
        // 实时行超过两行时留**最新**的词（截尾会把正在说的那半截截掉）
        trLabel.stringValue = partial && !head.isEmpty
            ? MTSubtitleBar.tailFitting(head, font: trLabel.font ?? big, width: textWidth, lines: 2) + "…"
            : head
        trLabel.isHidden = head.isEmpty
        origLabel.stringValue = tr.isEmpty ? "" : orig
        // 译文与原文一字不差（模型原样回了原文）时，小字那行只是同一句话的重影
        let same = orig.trimmingCharacters(in: .whitespacesAndNewlines) == tr.trimmingCharacters(in: .whitespacesAndNewlines)
        origLabel.isHidden = tr.isEmpty || !meaningful(orig) || head.isEmpty || same

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
        } else if state == "grant" {
            // 额度 / key 停机：出口在主窗口那句提示上（点它去设置页对应那张卡）
            let title = controlLabels["main"] ?? ""
            setTitle(actionButton, title, size: 13 * fontScale)
            actionButton.action = #selector(tapMain)
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
        if !parkedAside { rememberedOrigin = f.origin }
        yieldToVideoPip(animated: false)
    }

    // MARK: - 悬停、拖动、吸附

    private func hover(_ inside: Bool) {
        controls.isHidden = !inside || clickThrough
        badge.isHidden = !clickThrough || inside
        // 控件那一排在右上角：悬停时把文字往下让一排，长句不再压在按钮底下（#590 J）
        let want = controls.isHidden ? MTSubtitleBar.textTop : MTSubtitleBar.textTop + controls.fittingSize.height + 4
        if let c = stackTop, abs(c.constant - want) > 0.5, let p = panel {
            c.constant = want
            fitHeight(p)
        }
    }

    private func drag(_ phase: Int) {
        guard let p = panel else { return }
        let at = NSEvent.mouseLocation
        switch phase {
        case 0:
            dragging = true
            dragStart = at; dragOrigin = p.frame.origin
        case 1:
            p.setFrameOrigin(NSPoint(x: dragOrigin.x + at.x - dragStart.x, y: dragOrigin.y + at.y - dragStart.y))
        default:
            dragging = false
            snap(p)
            rememberedOrigin = p.frame.origin
            // 临时让开时自动保存是摘掉的。松手这一下先把放下的位置写回去，再决定让不让。
            if p.frameAutosaveName.isEmpty, !autosaveName.isEmpty { p.saveFrame(usingName: autosaveName) }
            // 吸完再判一次（系统视频小窗、自己的窗口、全屏画面底部）。拖的过程中不挪。
            yieldToVideoPip(animated: true)
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
        render()
    }

    /// 小窗可以在条不动的时候被拖走。拖条的过程中不跟（松手那一下再判）。
    private func startYieldWatch() {
        stopYieldWatch()
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.yieldToVideoPip(animated: true) }
        RunLoop.main.add(t, forMode: .common)
        yieldTimer = t
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.yieldToVideoPip(animated: false) }
        activeObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.yieldToVideoPip(animated: true) }
        resignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.yieldToVideoPip(animated: true) }
        spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.yieldToVideoPip(animated: true) }
    }

    private func stopYieldWatch() {
        yieldTimer?.invalidate()
        yieldTimer = nil
        if let o = screenObserver { NotificationCenter.default.removeObserver(o) }
        if let o = activeObserver { NotificationCenter.default.removeObserver(o) }
        if let o = resignObserver { NotificationCenter.default.removeObserver(o) }
        if let o = spaceObserver { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        screenObserver = nil
        activeObserver = nil
        resignObserver = nil
        spaceObserver = nil
        dragging = false
        // 不在这里清 rememberedOrigin / parkedAside：startYieldWatch 开头会先调这里。
        // 清掉的话，render 里已经按记住的位置让开之后，紧接着的那次重判会把临时位置当成记忆（#590 N）。
    }

    /// 自己的主窗口正在最前面，并且（含间隙）压住记住的位置时，返回它的 frame。
    private func ownFrontObstacle(against base: NSRect) -> NSRect? {
        guard NSApp.isActive, let w = mainWindow, w.isVisible, !w.isMiniaturized else { return nil }
        let front = NSApp.orderedWindows.first { $0.isVisible && !($0 is NSPanel) }
        guard front === w else { return nil }
        guard w.frame.insetBy(dx: -16, dy: -16).intersects(base) else { return nil }
        return w.frame
    }

    /// `persist == false`：临时挪开，摘掉自动保存，不改记住的位置。
    private func place(_ p: NSPanel, _ raw: NSRect, persist: Bool, animated: Bool) {
        let next = MTSubtitleBar.clamped(raw)
        let same = abs(next.origin.x - p.frame.origin.x) < 1 && abs(next.origin.y - p.frame.origin.y) < 1
            && abs(next.size.height - p.frame.size.height) < 1 && abs(next.size.width - p.frame.size.width) < 1
        if persist {
            rememberedOrigin = next.origin
            parkedAside = false
            if p.frameAutosaveName.isEmpty {
                if !same { p.setFrame(next, display: true, animate: animated) }
                if !autosaveName.isEmpty {
                    p.saveFrame(usingName: autosaveName)
                    p.setFrameAutosaveName(autosaveName)
                }
            } else if !same {
                p.setFrame(next, display: true, animate: animated)
            }
        } else {
            if !p.frameAutosaveName.isEmpty {
                autosaveName = p.frameAutosaveName
                p.setFrameAutosaveName("")
            }
            parkedAside = true
            if !same { p.setFrame(next, display: true, animate: animated) }
        }
    }

    private func yieldToVideoPip(animated: Bool) {
        guard !dragging, let p = panel else { return }
        if rememberedOrigin == nil { rememberedOrigin = p.frame.origin }
        if autosaveName.isEmpty, !p.frameAutosaveName.isEmpty { autosaveName = p.frameAutosaveName }
        let screen = (p.screen ?? NSScreen.main)?.visibleFrame ?? p.frame
        let full = (p.screen ?? NSScreen.main)?.frame ?? screen
        let base = NSRect(origin: rememberedOrigin ?? p.frame.origin, size: p.frame.size)
        if let own = ownFrontObstacle(against: base) {
            let next = mtYieldedBar(base, screen: screen, obstacles: [own])
            let moved = abs(next.origin.x - base.origin.x) > 1 || abs(next.origin.y - base.origin.y) > 1
            if moved {
                place(p, next, persist: false, animated: animated)
                return
            }
        }
        // 自己的 App 在前台时不按全屏让：全屏窗口已经不是最前面的那个。
        if !NSApp.isActive, let band = fullscreenCaptionBand(), band.intersects(base) {
            let next = mtYieldedBar(base, screen: screen, obstacles: [band])
            let moved = abs(next.origin.x - base.origin.x) > 1 || abs(next.origin.y - base.origin.y) > 1
            if moved {
                place(p, next, persist: false, animated: animated)
                return
            }
        }
        let pips = videoPipFrames().filter { $0.intersects(full) }
        let next = mtYieldedBar(base, screen: screen, obstacles: pips)
        let pipMoved = abs(next.origin.x - base.origin.x) > 1 || abs(next.origin.y - base.origin.y) > 1
        // 全屏或自己的窗口不再挡着：回到记住的位置。系统视频小窗造成的挪动要记下来（#590 M）。
        if pipMoved || parkedAside { place(p, next, persist: true, animated: animated) }
    }

    private struct MTListedWindow {
        var pid: Int32
        var layer: Int
        var alpha: CGFloat
        var owner: String
        var name: String
        var frame: NSRect
    }

    /// CGWindow 的 y 从主屏顶往下；主屏是 `NSScreen.screens` 的第一块（菜单栏所在）。从前到后。
    private func listedWindows() -> [MTListedWindow] {
        let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let primaryH = NSScreen.screens.first?.frame.height ?? 0
        var out: [MTListedWindow] = []
        for w in info {
            let pid = (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
            let layer = (w[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
            let alpha = CGFloat((w[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1)
            let owner = w[kCGWindowOwnerName as String] as? String ?? ""
            let name = w[kCGWindowName as String] as? String ?? ""
            guard let dict = w[kCGWindowBounds as String] as? NSDictionary else { continue }
            var cg = CGRect.zero
            guard CGRectMakeWithDictionaryRepresentation(dict as CFDictionary, &cg), cg.width > 0, cg.height > 0 else { continue }
            let cocoa = NSRect(x: cg.origin.x, y: primaryH - cg.origin.y - cg.height, width: cg.width, height: cg.height)
            out.append(MTListedWindow(pid: pid, layer: layer, alpha: alpha, owner: owner, name: name, frame: cocoa))
        }
        return out
    }

    private func fullscreenCaptionBand() -> NSRect? {
        let own = ProcessInfo.processInfo.processIdentifier
        let screens = NSScreen.screens.map { MTScreenGeom(frame: $0.frame, visible: $0.visibleFrame) }
        let windows = listedWindows().map { MTForeignWindow(pid: $0.pid, layer: $0.layer, alpha: $0.alpha, frame: $0.frame) }
        return mtFullscreenCaptionBand(windows: windows, screens: screens, ownPID: own)
    }

    private func videoPipFrames() -> [NSRect] {
        let own = ProcessInfo.processInfo.processIdentifier
        var rects: [NSRect] = []
        for w in listedWindows() {
            let screen = NSScreen.screens.first { $0.frame.intersects(w.frame) }?.frame ?? w.frame
            if mtLooksLikeVideoPip(owner: w.owner, name: w.name, layer: w.layer, width: w.frame.width, height: w.frame.height,
                                   screenWidth: screen.width, screenHeight: screen.height, ownPID: own, pid: w.pid) {
                rects.append(w.frame)
            }
        }
        return rects
    }

    private func applyClickThrough() {
        panel?.ignoresMouseEvents = clickThrough
        controls.isHidden = true
        badge.isHidden = !clickThrough
        if let c = stackTop, c.constant != MTSubtitleBar.textTop, let p = panel { c.constant = MTSubtitleBar.textTop; fitHeight(p) }
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
