// app/native/audio-bridge.swift — 播客模式 (§9.5「后台与锁屏播放」) 的原生一半。
//
// 这个文件**不是 Xcode 工程的成员**。`scripts/sync-app-assets.js` 在每次
// `npm run app:sync` 时把它整块贴进 `Shared (App)/ViewController.swift`
// （`import WebKit` 之后，一对 BEGIN/END 标记之间）。要改它就改这里，
// 改工程里那一份会在下一次 app:sync 时被原样覆盖。
//
// 为什么是「贴进已有文件」而不是「加一个源文件」：`safari-project*/` 是
// safari-web-extension-converter 的一次性产物，重新生成会重置 pbxproj 的文件清单。
// 贴进一个**本来就在 target 里**的文件，就永远不需要碰 PBXFileReference / PBXBuildFile
// —— 那是最容易被重生成打回原形的地方（learning-design §12，2026-08-17 那行否决的正题）。
//
// 为什么不是内联在 sync-app-assets.js 的 JS 字符串里：一百多行 Swift 拼在字符串里
// 没有高亮、没有编译器、`\(...)` 要和 JS 转义打架、git blame 全落在一行 `+` 上。
// 同一个理由让 macOS 菜单补丁写成了数据而不是字面量。
//
// ── 零文案纪律 ───────────────────────────────────────────────────────────────
// 这个文件里**没有一个用户可见的字**。锁屏/控制中心上显示的每一个字都由 JS 传进来，
// 因此照常走 `_locales/` 的 11 份 messages.json。原生侧一旦自己写文案，那句话就永远
// 不会被翻译，也永远不会跟着产品名改。
//
// ── 两个平台，两半代码 ──────────────────────────────────────────────────────
//   iOS   : 进程会被挂起 ⇒ 需要 UIBackgroundModes: audio + AVAudioSession(.playback)
//   macOS : 进程不会被挂起 ⇒ 后台播放无条件成立，这里只装媒体遥控那一半
// `AVAudioSession` 是 iOS-only 的 API，macOS 上不存在，所以会话那一半整个在 #if os(iOS) 里。
import WebKit
import AVFoundation
import MediaPlayer
#if os(iOS)
import ActivityKit
#endif

#if os(iOS)
/// Live Activity 的属性（§9.5 灵动岛）。**这份定义在两个 target 各编译一份**
/// （App 与 Widget 扩展），所以它和 `app/native/widget/LiveActivity.swift` 里那份
/// 必须逐字一致 —— 字段名对不上时不会编译报错，只会在运行时解码失败、岛上什么都不显示。
/// `npm test` 有一条断言逐字比对这两处。
struct MTPodcastAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var subtitle: String
        var progress: String
        var playing: Bool
    }
    var sessionId: String
}
#endif

#if os(iOS)
import UIKit
typealias MTImage = UIImage
#else
import AppKit
typealias MTImage = NSImage
#endif

/// 把 App 内 web 视图里的播客播放器接到系统音频栈上：音频会话（iOS）、
/// 媒体遥控与「正在播放」（两个平台）。
final class MTAudioBridge: NSObject, WKScriptMessageHandler {

    static let shared = MTAudioBridge()

    /// 通道名。JS 侧 `window.webkit.messageHandlers.mtAudio` 与
    /// sync-app-assets.js 的 install 行必须用同一个字符串 —— `npm test` 有一条断言钉住这三处。
    static let channel = "mtAudio"

    private weak var webView: WKWebView?
    private var commandsInstalled = false

    /// 当前卡片的封面（由 JS 画好送过来）。锁屏那一档用它。
    private var cardArt: MTImage?
#if os(iOS)
    /// 当前的 Live Activity。iOS 16.1+ 才有 —— 低版本上它恒为 nil，灵动岛那一半
    /// 不存在，其余（后台播放、锁屏封面、遥控）照常。能力语义，不是降级。
    private var activityBox: Any?
#endif
    /// 系统实际用哪些尺寸来问封面 —— Apple 没有公开这件事，所以这里如实记下来
    /// 回传给 JS，让「小尺寸阈值」由实测决定而不是猜。只回传没见过的尺寸。
    private var seenArtSizes = Set<Int>()

    /// 小于这个宽度（pt）就给 App 图标，不给卡片：那个尺寸上放不下一个句子，
    /// 缩过去只会是一团糊 —— 灵动岛那个「问号」位就在这一档。
    /// **这是个待实测的初值**，见 seenArtSizes。
    private static let iconMaxWidth: CGFloat = 120

    // MARK: - 安装

    /// 由 ViewController.viewDidLoad 调用（补丁插入）。可以被调用多次而不出事。
    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        // 先摘再挂：同名 handler 重复注册在 WebKit 里是 fatal error，而 viewDidLoad
        // 在某些生命周期下确实会跑第二次。
        ucc.removeScriptMessageHandler(forName: MTAudioBridge.channel)
        ucc.add(self, name: MTAudioBridge.channel)

#if os(iOS)
        let nc = NotificationCenter.default
        nc.removeObserver(self)
        nc.addObserver(self, selector: #selector(onInterruption(_:)),
                       name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(onRouteChange(_:)),
                       name: AVAudioSession.routeChangeNotification, object: nil)
        // 屏幕常亮要在每次回前台重申一次。`isIdleTimerDisabled` 只在 viewDidLoad 设过
        // 一次，而它只在 App 处于前台时被系统尊重 —— 从后台回来之后不重申，播客模式
        // 放着放着屏幕就自己灭了，而用户看到的只是「屏幕黑了」，无从归因。
        //
        // 注意这解决的**不是**「锁屏后保持亮屏」：那件事第三方 App 做不到，手动锁屏后
        // 屏幕必灭，唯一能让锁屏内容持续可见的是系统的「息屏常显」。
        nc.addObserver(self, selector: #selector(onDidBecomeActive),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
#endif
    }

    // MARK: - JS → 原生

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // 安全解包，不是 `as!`：一个形状对不上的 body 应该被忽略，不该让 App 崩掉。
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "session-start":  startSession()
        case "session-stop":   stopSession()
        case "now-playing":    updateNowPlaying(body); updateActivity(body)
        case "now-playing-artwork": updateArtwork(body)
        case "playing-state":  updatePlaybackState(body)
        case "record-mode":    recordMode = (body["on"] as? Bool) ?? false   // 实时听译（§9.6）
        default: break   // 未知类型静默忽略：JS 比原生新是半同步开发树的常态
        }
    }

    /// 实时听译要的是「一边录一边（可能）放」的会话；播客模式仍是只放不录。
    /// 由 JS 在 session-start 之前用 record-mode 声明，原生只在建会话时读它。
    private var recordMode = false

    private func startSession() {
#if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            // .playback = 「这是内容音频，静音键不该关掉它，后台要继续」。
            // .spokenAudio = 口播语义：蓝牙/车机路由与「暂停别人的播客」都按这个来。
            // 不加 .mixWithOthers —— 播客模式就是要接管，混着播等于两个人同时说话。
            if recordMode {
                // .playAndRecord + 扬声器 + 蓝牙：线下对话手机放桌上，声音要从外放出、耳机要能用。
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            } else {
                try session.setCategory(.playback, mode: .spokenAudio, options: [])
            }
            try session.setActive(true)
        } catch {
            // 建不起来就如实说，让 JS 退回「隐藏即暂停」的老行为，而不是继续假装能后台播。
            emit(["type": "session-failed", "reason": String(describing: error)])
            return
        }
#endif
        installCommands()
        // `suspends` 是 JS 用来判断「隐藏之后还能不能出声」的唯一依据。由原生报，
        // 而不是让 JS 去嗅 UA —— domain-design §5.3 规则 2 禁止用 UA 做能力判断，
        // 而这恰恰是一个平台能力问题：iOS 会挂起进程，macOS 不会。
#if os(iOS)
        emit(["type": "session-ready", "platform": "ios", "suspends": true])
#else
        emit(["type": "session-ready", "platform": "macos", "suspends": false])
#endif
    }

    private func stopSession() {
        endActivity()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
#if os(iOS)
        // .notifyOthersOnDeactivation：让刚才被我们打断的那个 App 能自己恢复。
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
#endif
    }

    private func installCommands() {
        guard !commandsInstalled else { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget            { [weak self] _ in self?.remote("play");     return .success }
        center.pauseCommand.addTarget           { [weak self] _ in self?.remote("pause");    return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.remote("toggle");   return .success }
        center.nextTrackCommand.addTarget       { [weak self] _ in self?.remote("next");     return .success }
        // 「上一曲」= 再听一遍。播客模式没有「上一张」：随机是一次性排列，往回退没有定义。
        center.previousTrackCommand.addTarget   { [weak self] _ in self?.remote("previous"); return .success }

        for command in [center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
                        center.nextTrackCommand, center.previousTrackCommand] {
            command.isEnabled = true
        }
        // 一张卡三遍五段，任何进度条都会撒谎 —— 时间轴一律不给。
        for command in [center.changePlaybackPositionCommand, center.seekForwardCommand,
                        center.seekBackwardCommand, center.skipForwardCommand,
                        center.skipBackwardCommand] {
            command.isEnabled = false
        }
    }

    // MARK: - 「正在播放」

    private func updateNowPlaying(_ body: [String: Any]) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle]      = body["title"] as? String ?? ""
        info[MPMediaItemPropertyArtist]     = body["subtitle"] as? String ?? ""
        info[MPMediaItemPropertyAlbumTitle] = body["album"] as? String ?? ""
        // 无时间轴 ⇒ 系统不画拖动条。见 installCommands 里关掉 seek 的同一个理由。
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        info.removeValue(forKey: MPMediaItemPropertyPlaybackDuration)
        info.removeValue(forKey: MPNowPlayingInfoPropertyElapsedPlaybackTime)
        if let index = body["index"] as? Int, let count = body["count"] as? Int, count > 0 {
            info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = index
            info[MPNowPlayingInfoPropertyPlaybackQueueCount] = count
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - 灵动岛（Live Activity）

    // 系统的媒体形态在收起态只给「图标 + 波形」，第三方加不了字 —— 想在岛上看到
    // 正在念的是哪一句，只有 Live Activity 一条路。它与系统媒体形态**并存**，
    // 岛上会挤，这是已知代价（§9.5）。
    //
    // iOS 16.1 以下：`activityBox` 恒为 nil，这一半整个不存在，其余照常。
    private func startActivity(_ body: [String: Any]) {
#if os(iOS)
        guard #available(iOS 16.1, *), activityBox == nil else { return }
        // 用户可以在系统设置里关掉实时活动 —— 关了就别再试，也不该有任何提示：
        // 那是他自己的选择，不是一个要解释的故障。
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = contentState(body)
        do {
            activityBox = try Activity.request(
                attributes: MTPodcastAttributes(sessionId: UUID().uuidString),
                contentState: state, pushType: nil)
        } catch {
            // 起不来就算了。灵动岛是锦上添花，绝不能因为它影响播放。
            activityBox = nil
        }
#endif
    }

    private func updateActivity(_ body: [String: Any]) {
#if os(iOS)
        guard #available(iOS 16.1, *) else { return }
        guard let activity = activityBox as? Activity<MTPodcastAttributes> else {
            // 还没起来（会话刚开始、或上一次起失败）：拿这条 now-playing 当种子起一个。
            startActivity(body)
            return
        }
        let state = contentState(body)
        Task { await activity.update(using: state) }
#endif
    }

    private func endActivity() {
#if os(iOS)
        guard #available(iOS 16.1, *),
              let activity = activityBox as? Activity<MTPodcastAttributes> else { return }
        activityBox = nil
        // `.immediate`：会话结束了，岛上不该再留一条已经不动的信息。
        Task { await activity.end(dismissalPolicy: .immediate) }
#endif
    }

#if os(iOS)
    @available(iOS 16.1, *)
    private func contentState(_ body: [String: Any]) -> MTPodcastAttributes.ContentState {
        MTPodcastAttributes.ContentState(
            title: body["title"] as? String ?? "",
            subtitle: body["subtitle"] as? String ?? "",
            progress: body["album"] as? String ?? "",
            playing: lastPlaying)
    }
    /// 播放状态由 `playing-state` 单独送来，而 Live Activity 的一次更新要带上全部字段
    /// —— 所以这里存一份最后已知值。
    private var lastPlaying = true
#endif

    // MARK: - 封面

    /// data URL → 图片。只认 base64 那一种（JS 侧是 canvas.toDataURL，永远是它）。
    private func decode(_ dataUrl: String) -> MTImage? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let b64 = String(dataUrl[dataUrl.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return MTImage(data: data)
    }

    /// 小尺寸那一档：App 图标。原生这边本来就有（Assets.xcassets），不用过桥传。
    private func appIcon() -> MTImage? {
#if os(iOS)
        return UIImage(named: "AppIcon")
#else
        return NSApp.applicationIconImage
#endif
    }

    /// 按系统要的尺寸重画一张。**这不是优化，是契约**：`requestHandler` 的文档写的是
    /// 「Returns the artwork image for an item at a given size」，不管要多大都甩回一张
    /// 1024² 是常见的「代码跑了但封面就是不显示」的原因。
    private func scaled(_ image: MTImage, to size: CGSize) -> MTImage {
        guard size.width > 0, size.height > 0 else { return image }
#if os(iOS)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.opaque = true
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
#else
        let out = NSImage(size: size)
        out.lockFocus()
        image.draw(in: CGRect(origin: .zero, size: size))
        out.unlockFocus()
        return out
#endif
    }

    private func updateArtwork(_ body: [String: Any]) {
        guard let url = body["image"] as? String, let image = decode(url) else { return }
        cardArt = image
        let icon = appIcon()
        let art = MPMediaItemArtwork(boundsSize: image.size) { [weak self] size in
            guard let self = self else { return image }
            self.noteArtSize(size)
            let source = (size.width > 0 && size.width < MTAudioBridge.iconMaxWidth && icon != nil)
                ? icon! : (self.cardArt ?? image)
            return self.scaled(source, to: size)
        }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = art
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func noteArtSize(_ size: CGSize) {
        let w = Int(size.width), h = Int(size.height)
        let key = w * 100_000 + h
        DispatchQueue.main.async {
            guard !self.seenArtSizes.contains(key) else { return }
            self.seenArtSizes.insert(key)
            // 宽高按数字送，不在原生这边拼串：这个文件一个字符串字面量都不该多出来
            // （零文案纪律有测试钉着），而结构化数据本来也更好用。
            self.emit(["type": "artwork-size", "w": w, "h": h])
        }
    }

    private func updatePlaybackState(_ body: [String: Any]) {
        let playing = (body["playing"] as? Bool) ?? false
#if os(iOS)
        if #available(iOS 16.1, *) {
            lastPlaying = playing
            // 暂停/继续要在岛上立刻看得出来 —— 用最后已知的文案重发一次。
            if let activity = activityBox as? Activity<MTPodcastAttributes> {
                let state = MTPodcastAttributes.ContentState(
                    title: activity.contentState.title, subtitle: activity.contentState.subtitle,
                    progress: activity.contentState.progress, playing: playing)
                Task { await activity.update(using: state) }
            }
        }
#endif
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
#if os(iOS)
        if playing {
            // WebKit 每开一个 <audio> 都会按它自己的判断动一次音频会话类别。重申一次的
            // 代价是零，而漏掉一次的代价是「播到第三段忽然不能后台了」这种查不到的 bug。
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
        }
#endif
    }

    // MARK: - 原生 → JS

#if os(iOS)
    @objc private func onInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            emit(["type": "interrupt", "phase": "begin"])
            return
        }
        let options = AVAudioSession.InterruptionOptions(
            rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        // `.shouldResume` 是系统在说「刚才那件事结束了，你可以接着播」。只有它为真才自动续播
        // —— 播放器不得在一次真正的中断之后自作主张地重新开口（§9.5）。
        let shouldResume = options.contains(.shouldResume)

        // ⚠️ 这次重新激活**必须留在这个 if 里**。它曾经是无条件的，那是个真缺陷：
        //
        // 中断的定义就是「系统停用了我们的会话」（Apple: "An audio interruption is the
        // deactivation of your app's audio session"），所以 `.ended` 时会话确实是非活跃的
        // —— 看起来「当然该重新激活一下」。但 `setActive(true)` 不是一个读操作，是**抢占**：
        // 我们的类别是 .playback（非混音），激活它就会打断当时正在出声的任何东西。而
        // shouldResume 为假时我们**不播**，于是结果是「我们占着一个活跃的非混音会话却一个
        // 字都不出」—— 最坏表现是**两边都没声**：刚开始播的音乐被我们掐掉，我们自己不响，
        // 屏幕上没有任何变化。这种静音在真机上几乎不可能归因。
        //
        // 只在真的要接着播时才激活。`test/build-scripts.test.js` 有一条断言钉住这个顺序。
        if shouldResume {
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        emit(["type": "interrupt", "phase": "end", "resume": shouldResume])
    }

    @objc private func onDidBecomeActive() {
        UIApplication.shared.isIdleTimerDisabled = true
    }

    @objc private func onRouteChange(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        // 耳机被拔了。暂停，且重连时**不**自动播 —— 拔掉耳机后从外放里冒出声音是所有
        // 音乐 App 都在避免的那件事。
        emit(["type": "route", "change": "device-lost"])
    }
#endif

    private func remote(_ command: String) {
        emit(["type": "remote", "command": command])
    }

    private func emit(_ payload: [String: Any]) {
        guard let webView = self.webView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            // 短路写法是必须的：这条通道在页面还没加载完、或者宿主里根本没有播客模式时
            // 会打到一个不存在的全局上。converter 模板自带的 `show('ios')` 就是这么一直在
            // 静默抛 ReferenceError 的（app.js 的 show 在 IIFE 里，从来不是全局）。
            webView.evaluateJavaScript(
                "window.NativeAudio && window.NativeAudio._fromNative(\(json))",
                completionHandler: nil)
        }
    }
}
