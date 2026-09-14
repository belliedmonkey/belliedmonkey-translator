// app/native/subtitle-pip.swift — 「实时字幕」iPhone 一期的画中画悬浮字幕窗（learning-design §9.8 协议补充决定（三）17–20 · interaction-spec I3–I9）。
//
// 这个文件**不是 Xcode 工程的成员**：`scripts/sync-app-assets.js` 把它整块贴进 `Shared (App)/ViewController.swift`
// 的 mt-subtitle-pip 标记块（与 audio-bridge.swift 同一个做法、同一个理由）。整份只在 iOS 编译；Mac 的字幕位置是悬浮条（subtitle-bar.swift）。
//
// ── 零文案 ─────────────────────────────────────────────────────────────────────
// 小窗里的状态行文字来自 `subtitle-config.labels.state`（JS 的 _locales）；字幕内容来自 `subtitle-show`。这里只有协议 id。
//
// ── 形状（尖刺 S7 真机实证）─────────────────────────────────────────────────────
// AVSampleBufferDisplayLayer 自绘深色字幕帧 → AVPictureInPictureController(contentSource: sampleBufferDisplayLayer)，
// canStartPictureInPictureAutomaticallyFromInline = true ⇒ 离开 App（切到任意其它 App）时自动浮出（S7：1.7 s 内出现），
// 小窗浮在 Safari 上持续更新，录音引擎不停，Safari 外放零暂停。
// **来源必须在屏幕上**（协议补充决定 17）：页面在「现在」卡里留一个 16:9 占位块，把它在视口里的矩形发过来
// （subtitle-float {rect}），这里在 WKWebView 上同一位置叠一个不接触摸的预览视图。
//
// ── 系统控件回页面（协议补充决定 19、20）──────────────────────────────────────────
// ⏸ / ▶（setPlaying）→ remote pause / play；浮出 / 关掉 / 回到 App → subtitle-window {state: floating | closed | inline}。
// 「浮出字幕窗」（subtitle-float 不带 rect）只在场景前台活跃时能成，失败回 closed / not-active。
#if os(iOS)
import UIKit
import AVKit
import CoreMedia

final class MTSubtitlePip: NSObject, AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {

    static let shared = MTSubtitlePip()

    /// 小窗的系统控件 → 桥（remote {command}）。由 MTAudioBridge 在 subtitle-config 时设。
    var onRemote: ((String) -> Void)?
    /// 小窗状态 → 桥（subtitle-window）。
    var onWindow: (([String: Any]) -> Void)?

    private weak var webView: WKWebView?
    private let preview = UIView()
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var pip: AVPictureInPictureController?
    private var timer: Timer?
    private var restoring = false

    private var stateLabels: [String: String] = [:]
    /// 小窗自己的几行字（labels.pip）：title / hint / close（空窗说明）、history（翻看历史时顶部那行）
    private var pipLabels: [String: String] = [:]
    /// 翻看历史：从最新往回藏掉几句（0 = 看最新）。系统后退 / 前进按钮每次翻 3 句（用户 2026-09-14 裁定借这两个按钮翻页）
    private var historyOffset = 0
    private static let pageSize = 3
    private var finals: [(orig: String, tr: String)] = []
    private var partialLine: (orig: String, tr: String)?
    private var state = "listening"
    private var pct = 0
    /// 系统回报的小窗渲染尺寸（I5：捏合放大后按新尺寸重画，不是把小图拉糊）。
    /// **小窗的宽高比由帧的宽高比决定**，用户只能等比缩放 —— 初值 4:5 偏竖，一次看 4–5 句（用户 2026-09-14 手测后裁定，
    /// S7 探针的 16:9 一次只看得清两句）。
    private var renderSize = CGSize(width: 640, height: 800)
    private var dirty = true

    // MARK: - 桥 → 小窗

    /// `subtitle-config {labels, …}`：会话开始时来一次（改字号时也会再来，iOS 这边只取 labels）。
    func configure(_ body: [String: Any], webView: WKWebView) {
        let labels = body["labels"] as? [String: Any] ?? [:]
        stateLabels = labels["state"] as? [String: String] ?? stateLabels
        pipLabels = labels["pip"] as? [String: String] ?? pipLabels
        guard self.webView == nil else { dirty = true; return }
        self.webView = webView
        preview.isUserInteractionEnabled = false
        preview.isHidden = true
        preview.backgroundColor = MTSubtitlePip.background
        preview.layer.cornerRadius = 12
        preview.layer.masksToBounds = true
        displayLayer.videoGravity = .resizeAspect
        preview.layer.addSublayer(displayLayer)
        webView.addSubview(preview)

        // 系统不支持画中画（模拟器实测：isPictureInPictureSupported NO，控制器建出来是空的）⇒ 不建；预览照画，浮出时如实回 failed
        if AVPictureInPictureController.isPictureInPictureSupported() {
            let c = AVPictureInPictureController(contentSource: .init(sampleBufferDisplayLayer: displayLayer, playbackDelegate: self))
            c.delegate = self
            c.canStartPictureInPictureAutomaticallyFromInline = true
            // false：让系统给出后退 / 前进两个按钮，借来翻看历史（skipByInterval）
            c.requiresLinearPlayback = false
            pip = c
        }

        render()
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, self.dirty else { return }
            self.render()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        onWindow?(["state": "inline"])
    }

    /// `subtitle-float {rect}`：预览在视口里的位置（CSS px = pt）；`rect: null` = 滚出视口，藏起预览。
    /// `subtitle-float`（不带 rect）：重新浮出小窗（I9）。
    func float(_ body: [String: Any]) {
        guard let webView = webView else { return }
        if body.keys.contains("rect") {
            guard let r = body["rect"] as? [String: Any],
                  let x = (r["x"] as? NSNumber)?.doubleValue, let y = (r["y"] as? NSNumber)?.doubleValue,
                  let w = (r["w"] as? NSNumber)?.doubleValue, let h = (r["h"] as? NSNumber)?.doubleValue, w > 0, h > 0 else {
                preview.isHidden = true
                return
            }
            // getBoundingClientRect 以可视视口左上为原点；WKWebView 的可视区从被系统栏遮住的那段之下开始
            let top = webView.scrollView.adjustedContentInset.top
            preview.frame = CGRect(x: x, y: y + top, width: w, height: h)
            displayLayer.frame = preview.bounds
            preview.isHidden = false
            dirty = true
            return
        }
        // 不静默：没有画中画可用也要回一句，页面的「浮出字幕窗」保持可点（协议补充决定 20）
        guard let c = pip else { onWindow?(["state": "closed", "reason": "failed"]); return }
        guard !c.isPictureInPictureActive else { return }
        let active = webView.window?.windowScene?.activationState == .foregroundActive
        guard active, c.isPictureInPicturePossible else {
            onWindow?(["state": "closed", "reason": "not-active"])
            return
        }
        c.startPictureInPicture()
    }

    /// `subtitle-show {orig, tr, partial}`。定稿按原文去重（同一句先出原文、译文到了再来一次）。
    func show(_ body: [String: Any]) {
        let orig = body["orig"] as? String ?? ""
        let tr = body["tr"] as? String ?? ""
        let partial = (body["partial"] as? Bool) ?? false
        let meaningful = { (s: String) -> Bool in s.rangeOfCharacter(from: .alphanumerics) != nil }
        if partial {
            partialLine = meaningful(orig) || meaningful(tr) ? (orig, tr) : nil
        } else {
            partialLine = nil
            if meaningful(orig) || meaningful(tr) {
                if let last = finals.last, last.orig == orig { finals[finals.count - 1] = (orig, tr) } else {
                    finals.append((orig, tr))
                    if historyOffset > 0 { historyOffset += 1 }   // 正在翻看历史时，新句子到来不把画面拽回最新
                }
                if finals.count > 12 { finals.removeFirst(finals.count - 12) }
            }
        }
        dirty = true
    }

    /// `subtitle-state {state, pct?}`：小窗底部那一行（I8：停下时最后一句留着，底部换成原因）。
    func setState(_ body: [String: Any]) {
        state = body["state"] as? String ?? state
        pct = (body["pct"] as? NSNumber)?.intValue ?? 0
        dirty = true
        pip?.invalidatePlaybackState()
    }

    /// `subtitle-hide`：会话结束。
    func hide() {
        timer?.invalidate()
        timer = nil
        pip?.stopPictureInPicture()
        pip = nil
        preview.removeFromSuperview()
        displayLayer.removeFromSuperlayer()
        displayLayer.flush()
        webView = nil
        finals = []
        partialLine = nil
        historyOffset = 0
        state = "listening"
        pct = 0
    }

    // MARK: - 绘制

    private static let background = UIColor(red: 22 / 255, green: 20 / 255, blue: 18 / 255, alpha: 1)
    private static let stateColor = UIColor(red: 246 / 255, green: 160 / 255, blue: 107 / 255, alpha: 1)

    private var listening: Bool { state == "listening" || state == "tr-failed" || state == "downloading" || state == "reconnecting" }

    private func render() {
        dirty = false
        let size = CGSize(width: max(320, renderSize.width), height: max(180, renderSize.height))
        // 字号与边距按**宽度**算（16:9 时与原来一样大）：窗口越高能放的句子越多。15 Pro 复测截图：按高度算时 4:5 只是把字放大，
        // 一屏仍只有两句半，没兑现「一次看 4–5 句」（§9.8 协议补充决定 24）
        let u = size.width * 0.5625
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = true
        let offset = min(historyOffset, max(0, finals.count - 1))
        let lines = Array(finals.dropLast(offset))
        let partial = offset == 0 ? partialLine : nil
        let historyText = offset > 0 ? (pipLabels["history"] ?? "") : ""
        let emptyTitle = pipLabels["title"] ?? ""
        let emptyHint = pipLabels["hint"] ?? ""
        let emptyClose = pipLabels["close"] ?? ""
        let stateText = listening ? "" : (stateLabels[state] ?? "").replacingOccurrences(of: "{pct}", with: String(pct))
        let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            MTSubtitlePip.background.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let pad = u * 0.06
            let w = size.width - pad * 2
            let trFont = UIFont.systemFont(ofSize: u * 0.095, weight: .semibold)
            let trAttr: [NSAttributedString.Key: Any] = [.font: trFont, .foregroundColor: UIColor.white]
            let trItalic: [NSAttributedString.Key: Any] = [
                .font: UIFont(descriptor: trFont.fontDescriptor.withSymbolicTraits(.traitItalic) ?? trFont.fontDescriptor, size: trFont.pointSize),
                .foregroundColor: UIColor.white]
            let orAttr: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: u * 0.066), .foregroundColor: UIColor(white: 1, alpha: 0.62)]
            let stAttr: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: u * 0.066, weight: .medium), .foregroundColor: MTSubtitlePip.stateColor]
            // 空窗（还没有一句字幕）：画说明，而不是一块莫名其妙的黑（用户 2026-09-14：「最小化 app 后立刻出现了这个黑色小窗，用户很莫名其妙」）
            // 说明的字号不跟字幕走：改按宽度算后它缩成原来的 0.45 倍、挤在顶上一小条（模拟器截图）⇒ 放回 build 97 的大小，整块垂直居中
            if lines.isEmpty && partial == nil {
                let titleAttr: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: u * 0.1, weight: .medium), .foregroundColor: UIColor(white: 1, alpha: 0.55)]
                let hintAttr: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: u * 0.138, weight: .semibold), .foregroundColor: UIColor.white]
                let closeAttr: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: u * 0.093), .foregroundColor: UIColor(white: 1, alpha: 0.62)]
                let items = [(emptyTitle, titleAttr), (emptyHint, hintAttr), (emptyClose, closeAttr)].filter { !$0.0.isEmpty }
                let heights = items.map { ceil(($0.0 as NSString).boundingRect(with: CGSize(width: w, height: size.height), options: .usesLineFragmentOrigin, attributes: $0.1, context: nil).height) }
                let gap = pad * 0.8
                let block = heights.reduce(0, +) + gap * CGFloat(max(0, heights.count - 1))
                var ty = max(pad, (size.height - block) / 2)
                for (i, item) in items.enumerated() {
                    (item.0 as NSString).draw(with: CGRect(x: pad, y: ty, width: w, height: heights[i]), options: .usesLineFragmentOrigin, attributes: item.1, context: nil)
                    ty += heights[i] + gap
                }
            }
            var top: CGFloat = 0
            if !historyText.isEmpty {
                let hAttr: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: u * 0.05, weight: .semibold), .foregroundColor: MTSubtitlePip.stateColor]
                let r = (historyText as NSString).boundingRect(with: CGSize(width: w, height: size.height), options: .usesLineFragmentOrigin, attributes: hAttr, context: nil)
                (historyText as NSString).draw(with: CGRect(x: pad, y: pad * 0.8, width: w, height: ceil(r.height)), options: .usesLineFragmentOrigin, attributes: hAttr, context: nil)
                top = pad * 0.8 + ceil(r.height) + pad * 0.5
            }
            var y = size.height - pad
            if !stateText.isEmpty {
                let r = (stateText as NSString).boundingRect(with: CGSize(width: w, height: size.height), options: .usesLineFragmentOrigin, attributes: stAttr, context: nil)
                y -= ceil(r.height)
                (stateText as NSString).draw(with: CGRect(x: pad, y: y, width: w, height: ceil(r.height)), options: .usesLineFragmentOrigin, attributes: stAttr, context: nil)
                y -= pad * 0.6
            }
            // 最新一句在最下面；半句（斜体、带省略号）排在所有定稿之后
            var items: [(orig: String, tr: String, partial: Bool)] = lines.map { ($0.orig, $0.tr, false) }
            if let p = partial { items.append((p.orig, p.tr, true)) }
            for item in items.reversed() {
                let head = item.tr.isEmpty ? item.orig : item.tr
                let headText = item.partial ? head + "…" : head
                let sub = item.tr.isEmpty ? "" : item.orig
                let attr = item.partial ? trItalic : trAttr
                let t = (headText as NSString).boundingRect(with: CGSize(width: w, height: size.height), options: .usesLineFragmentOrigin, attributes: attr, context: nil)
                let subH: CGFloat = sub.isEmpty ? 0 : ceil((sub as NSString).boundingRect(with: CGSize(width: w, height: size.height), options: .usesLineFragmentOrigin, attributes: orAttr, context: nil).height) + 2
                // 放不下的旧句子整句不画（模拟器截图：最上面一句被截掉半截）；最新一句总是画
                if y - subH - ceil(t.height) < top && item.orig != items.last?.orig { break }
                if !sub.isEmpty {
                    y -= subH - 2
                    (sub as NSString).draw(with: CGRect(x: pad, y: y, width: w, height: subH - 2), options: .usesLineFragmentOrigin, attributes: orAttr, context: nil)
                    y -= 2
                }
                y -= ceil(t.height)
                (headText as NSString).draw(with: CGRect(x: pad, y: y, width: w, height: ceil(t.height)), options: .usesLineFragmentOrigin, attributes: attr, context: nil)
                y -= pad * 0.7
                if y < 0 { break }
            }
        }
        guard let cg = img.cgImage else { return }
        enqueue(cg)
    }

    private func enqueue(_ cg: CGImage) {
        var pbOut: CVPixelBuffer?
        let attrs = [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true,
                     kCVPixelBufferIOSurfacePropertiesKey: [:] as [String: Any]] as CFDictionary
        CVPixelBufferCreate(nil, cg.width, cg.height, kCVPixelFormatType_32BGRA, attrs, &pbOut)
        guard let pb = pbOut else { return }
        CVPixelBufferLockBaseAddress(pb, [])
        if let bctx = CGContext(data: CVPixelBufferGetBaseAddress(pb), width: cg.width, height: cg.height, bitsPerComponent: 8,
                                bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
            bctx.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        }
        CVPixelBufferUnlockBaseAddress(pb, [])
        var fdOut: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: pb, formatDescriptionOut: &fdOut)
        guard let fd = fdOut else { return }
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 2),
                                        presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sbOut: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: pb, formatDescription: fd, sampleTiming: &timing, sampleBufferOut: &sbOut)
        guard let sb = sbOut else { return }
        if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: true) as? [NSMutableDictionary], let d = arr.first {
            d[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }
        if displayLayer.status == .failed { displayLayer.flush() }
        displayLayer.enqueue(sb)
    }

    // MARK: - AVPictureInPictureSampleBufferPlaybackDelegate

    func pictureInPictureController(_ c: AVPictureInPictureController, setPlaying playing: Bool) {
        onRemote?(playing ? "play" : "pause")
    }
    /// 有限的滑动时间窗（而不是直播形状的无穷区间）：系统才会给出后退 / 前进按钮。窗口右端 = 当前帧的时间戳。
    /// 待真机：按钮是否出现、进度条是否碍眼。
    func pictureInPictureControllerTimeRangeForPlayback(_ c: AVPictureInPictureController) -> CMTimeRange {
        let now = CMClockGetTime(CMClockGetHostTimeClock())
        let span = CMTime(seconds: 600, preferredTimescale: 600)
        return CMTimeRange(start: CMTimeSubtract(now, span), duration: CMTimeAdd(span, CMTime(seconds: 1, preferredTimescale: 600)))
    }
    func pictureInPictureControllerIsPlaybackPaused(_ c: AVPictureInPictureController) -> Bool { !listening }
    func pictureInPictureController(_ c: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {
        guard newRenderSize.width > 0, newRenderSize.height > 0 else { return }
        // 系统报的是点尺寸；按 2 倍画，放大后字仍清楚
        renderSize = CGSize(width: CGFloat(newRenderSize.width) * 2, height: CGFloat(newRenderSize.height) * 2)
        dirty = true
    }
    /// 后退 = 往回翻一页历史，前进 = 往新翻一页，翻到 0 就是最新（用户 2026-09-14 裁定借这两个按钮）。不动录音、不动页面。
    func pictureInPictureController(_ c: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) {
        if skipInterval.seconds < 0 {
            historyOffset = min(historyOffset + MTSubtitlePip.pageSize, max(0, finals.count - 1))
        } else {
            historyOffset = max(0, historyOffset - MTSubtitlePip.pageSize)
        }
        dirty = true
        completionHandler()
    }

    // MARK: - AVPictureInPictureControllerDelegate

    func pictureInPictureControllerDidStartPictureInPicture(_ c: AVPictureInPictureController) {
        onWindow?(["state": "floating"])
    }
    func pictureInPictureController(_ c: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        onWindow?(["state": "closed", "reason": "failed"])
    }
    func pictureInPictureController(_ c: AVPictureInPictureController,
                                    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        restoring = true          // ⧉ 回到 App：系统收起小窗、回到内联预览
        completionHandler(true)
    }
    func pictureInPictureControllerDidStopPictureInPicture(_ c: AVPictureInPictureController) {
        onWindow?(["state": restoring ? "inline" : "closed"])   // 没走 restore 就是用户点了 ✕
        restoring = false
    }
}
#endif
