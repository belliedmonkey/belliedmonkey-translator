// app/native/screen-ocr.swift — macOS「截图翻译」（docs/learning-design.md §9.9，M-6，决定 D8）。
//
// 标记块，整份 #if os(macOS)。给不能选、不能复制的字用：图片、视频画面、扫描件、游戏。
// 流程：快捷键 ⌃⌥S / 菜单 → 全屏变暗的框选层（每块屏各一层）→ ScreenCaptureKit 截**框的那一块** → 本机 Vision 识别
// → 行框交给面板页拼段、翻译。
//
// 不变量（npm test 对着这份源码钉着）：
//   ① 截图**不落盘**：全文件没有任何写文件的调用。识别完，像素只留在内存里那一张，下一次框选或面板收起即丢弃。
//   ② 截图**不离开设备**，除非用户点了面板里的「用我的识图引擎再试」—— 只有那条消息（quick-ocr-cloud）会把像素交给页面。
//   ③ 只截用户框的那一块（sourceRect），不截整屏再裁；我们自己的窗口（变暗层、面板）不进截图。
//   ④ 小于 12 × 12 当误触：直接取消，不截、不出面板。Esc 取消。
//   ⑤ 权限：只用系统的请求接口（CGRequestScreenCaptureAccess）；它不回调结果，授权后要重开 App 才生效（同增强取词）。
// ScreenCaptureKit 的截图接口要 macOS 14：更低的系统上 `supported` 为 false，入口整个不出现。
// 这里没有任何给用户看的文案。
#if os(macOS)
import AppKit
import Vision
import ScreenCaptureKit

final class MTScreenShot {

    static let shared = MTScreenShot()

    static var supported: Bool { if #available(macOS 14.0, *) { return true } else { return false } }
    static var granted: Bool { CGPreflightScreenCaptureAccess() }
    static func requestAccess() { _ = CGRequestScreenCaptureAccess() }
    static func openPrivacySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    /// 这台 Mac 上 Vision 有没有跑过（第一次要准备模型，二十秒量级 —— T2 读数 23.2 s）。
    private static let warmKey = "mtVisionWarm"
    static var visionWarm: Bool { UserDefaults.standard.bool(forKey: warmKey) }

    private var overlays: [MTShotOverlayWindow] = []
    private var lastImage: CGImage?                      // 只为「用我的识图引擎再试」留着；见 ②
    private var onRegion: ((CGImage?) -> Void)?

    // MARK: - 框选

    /// 回调：nil = 取消（Esc / 太小 / 截不到）。回调恒在主线程。
    func pickRegion(_ done: @escaping (CGImage?) -> Void) {
        cancelOverlays()
        lastImage = nil
        onRegion = done
        for screen in NSScreen.screens {
            let w = MTShotOverlayWindow(screen: screen) { [weak self] rect, scr in self?.finishPick(rect: rect, screen: scr) }
            overlays.append(w)
            w.orderFrontRegardless()
        }
        overlays.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }?.makeKey()
        NSCursor.crosshair.push()
    }

    private func cancelOverlays() {
        if !overlays.isEmpty { NSCursor.pop() }
        for w in overlays { w.orderOut(nil) }
        overlays = []
    }

    /// rect：屏幕内坐标（点，左下原点）。nil = 取消。
    private func finishPick(rect: NSRect?, screen: NSScreen) {
        cancelOverlays()
        let done = onRegion; onRegion = nil
        guard let r = rect, r.width >= 12, r.height >= 12 else { done?(nil); return }
        guard #available(macOS 14.0, *) else { done?(nil); return }
        // 变暗层收起之后再截，给合成器一拍时间。
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            Task {
                let img = await MTScreenShot.capture(rect: r, on: screen)
                await MainActor.run { self.lastImage = img; done?(img) }
            }
        }
    }

    @available(macOS 14.0, *)
    private static func capture(rect: NSRect, on screen: NSScreen) async -> CGImage? {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else { return nil }
        let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
        guard let display = content.displays.first(where: { $0.displayID == id }) ?? content.displays.first else { return nil }
        let mine = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
        let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        // sourceRect 是显示器内坐标、左上原点；AppKit 给的是左下原点。
        let top = screen.frame.height - rect.maxY
        cfg.sourceRect = CGRect(x: rect.minX, y: top, width: rect.width, height: rect.height)
        let scale = screen.backingScaleFactor
        cfg.width = Int(rect.width * scale)
        cfg.height = Int(rect.height * scale)
        cfg.showsCursor = false
        return try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
    }

    // MARK: - 本机识别

    /// 行框：坐标归一化到 0–1、**左上原点**（Vision 给的是左下原点，这里换算好再交出去）。回调在主线程。
    static func recognize(_ image: CGImage, _ done: @escaping ([[String: Any]]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            var lines: [[String: Any]] = []
            let req = VNRecognizeTextRequest { r, _ in
                for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
                    guard let s = o.topCandidates(1).first?.string, !s.isEmpty else { continue }
                    let b = o.boundingBox
                    lines.append(["text": s, "box": ["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]])
                }
            }
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = true
            if #available(macOS 13.0, *) { req.automaticallyDetectsLanguage = true }
            req.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES", "pt-BR", "ru-RU"]
            try? VNImageRequestHandler(cgImage: image, options: [:]).perform([req])
            UserDefaults.standard.set(true, forKey: warmKey)
            DispatchQueue.main.async { done(lines) }
        }
    }

    /// App 空闲时把 Vision 预热一次：一台 Mac 上的第一次识别要二十秒量级，别让用户第一次框选时去等。
    /// 识别的是一张我们自己画的小图，与屏幕无关，也不需要录屏权限。
    static func prewarmIfNeeded() {
        guard supported, !visionWarm else { return }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10) {
            let size = NSSize(width: 160, height: 40)
            let img = NSImage(size: size)
            img.lockFocus()
            NSColor.white.setFill(); NSRect(origin: .zero, size: size).fill()
            ("warm up" as NSString).draw(at: NSPoint(x: 8, y: 10), withAttributes: [.font: NSFont.systemFont(ofSize: 18), .foregroundColor: NSColor.black])
            img.unlockFocus()
            guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
            recognize(cg) { _ in }
        }
    }

    // MARK: - 「用我的识图引擎再试」

    /// 只有用户点了那个按钮才会被调用：把内存里那一张编码成 data URL 交给面板页。长边压到 1600。
    func lastImageDataURL() -> String? {
        guard let img = lastImage else { return nil }
        let long = CGFloat(max(img.width, img.height))
        let k = min(1, 1600 / long)
        let rep = NSBitmapImageRep(cgImage: img)
        var out = rep
        if k < 1, let scaled = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(CGFloat(img.width) * k), pixelsHigh: Int(CGFloat(img.height) * k),
                                                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) {
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: scaled)
            rep.draw(in: NSRect(x: 0, y: 0, width: scaled.pixelsWide, height: scaled.pixelsHigh))
            NSGraphicsContext.restoreGraphicsState()
            out = scaled
        }
        guard let png = out.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    func discardImage() { lastImage = nil }
}

/// 一块屏一层：变暗、十字光标、拖出矩形（矩形里不变暗）、右下角标尺寸、Esc 取消。
final class MTShotOverlayWindow: NSWindow {
    private let pick: (NSRect?, NSScreen) -> Void
    private let target: NSScreen

    init(screen: NSScreen, pick: @escaping (NSRect?, NSScreen) -> Void) {
        self.pick = pick
        self.target = screen
        super.init(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        level = .screenSaver
        ignoresMouseEvents = false
        hasShadow = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        let v = MTShotOverlayView(frame: NSRect(origin: .zero, size: screen.frame.size))
        v.onDone = { [weak self] r in guard let s = self else { return }; s.pick(r, s.target) }
        contentView = v
    }

    override var canBecomeKey: Bool { true }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { pick(nil, target) } else { super.keyDown(with: event) }
    }
}

final class MTShotOverlayView: NSView {
    var onDone: ((NSRect?) -> Void)?
    private var start: NSPoint?
    private var current: NSRect = .zero

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil)
        current = .zero
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let s = start else { return }
        let p = convert(event.locationInWindow, from: nil)
        current = NSRect(x: min(s.x, p.x), y: min(s.y, p.y), width: abs(p.x - s.x), height: abs(p.y - s.y))
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        let r = current
        start = nil
        onDone?(r.width >= 1 && r.height >= 1 ? r : nil)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.32).setFill()
        bounds.fill()
        guard current.width > 0, current.height > 0 else { return }
        NSColor.clear.setFill()
        current.fill(using: .copy)
        NSColor.white.withAlphaComponent(0.9).setStroke()
        let path = NSBezierPath(rect: current.insetBy(dx: 0.5, dy: 0.5))
        path.lineWidth = 1
        path.stroke()
        let label = "\(Int(current.width)) × \(Int(current.height))" as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium), .foregroundColor: NSColor.white]
        let size = label.size(withAttributes: attrs)
        var at = NSPoint(x: current.maxX - size.width - 6, y: current.minY - size.height - 6)
        if at.y < 4 { at.y = current.minY + 6 }
        NSColor.black.withAlphaComponent(0.6).setFill()
        NSBezierPath(roundedRect: NSRect(x: at.x - 4, y: at.y - 2, width: size.width + 8, height: size.height + 4), xRadius: 4, yRadius: 4).fill()
        label.draw(at: at, withAttributes: attrs)
    }
}
#endif
