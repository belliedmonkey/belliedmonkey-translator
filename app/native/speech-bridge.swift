// app/native/speech-bridge.swift — 「对话 · 实时听译」本机路的原生一半（learning-design §9.6.1）：
// 设备内置转写（iOS 26 / macOS 26 SpeechAnalyzer）+ 设备内置朗读（sherpa-onnx 离线模型，Piper）。
//
// 同 audio-bridge.swift：不是工程成员，由 scripts/sync-app-assets.js 整块贴进 ViewController.swift。
// 零文案纪律同样适用 —— 这里没有一个用户可见的字，状态与原因都是协议 id，文案在 JS/locale。
//
// ── 协议（app/native-speech.js 的 PROTOCOL 与这里逐字对表，npm test 钉住）──────────
//   JS → 原生：stt-probe {locales} · stt-assets {locales} · stt-start {locales, vadMs?, vadLevel?} · stt-stop
//             tts-probe {models} · tts-assets {models} · tts-speak {id, text, lang, rate?} · tts-stop
//   原生 → JS：stt-state {state: ready|unsupported|failed|ended, reason?, assets?}
//             assets-progress {kind: stt|tts, locale, fraction, state: downloading|installed|failed|missing|unsupported}
//             stt-partial {locale, text, conf} · stt-final {locale, text, conf, alts, t0, t1}
//             tts-state {state: ready|assets|failed, langs, reason?} · tts-start {id} · tts-end {id} · tts-failed {id, reason}
//
// ── 音频从哪儿来 ───────────────────────────────────────────────────────────────
// 不第二次装 tap。MTAudioBridge 的 micSink 把 inputNode 原生格式的缓冲交到这里，转成 analyzer 要的
// 格式后喂两路识别器（我方 / 对方语言各一路，一个 locale 一路）。PCM 不过桥 —— 本机路里 JS 只收
// mic-level。朗读的音频也留在原生：playerNode 按块调度，首块到即出声，PCM 永不回 JS。
//
// ── 为什么自己收口 ─────────────────────────────────────────────────────────────
// 2026-09-12 实测：识别器的 final 是懒的时间片（停顿不收口，有声书 p90 14 s），所以这里用
// RMS 静音检测（默认 400 ms）调 analyzer.finalize(through:)，停顿后整句 ≈0.4–0.9 s 到。
// 句子切分不在这里做：final 串起来按标点切是 JS 的 sentenceCutter 的活。
import WebKit
import AVFoundation
import Speech
import CryptoKit
#if canImport(SherpaOnnx)
import SherpaOnnx
import SherpaOnnxC
#endif

/// 归一化到 Apple 转写器认的 locale（Apple 配方第一条，2026-10-02 真机实测）。
/// 传短码（"en"）会抛 SFSpeechErrorDomain Code=4「Some modules are configured with an unsupported
/// configuration.」—— 屏 2 的识别包于是永远装不上；归一化后是 "en-US" ✓。
/// 归一化不到 ⇒ nil，调用方按 unsupported 处理（不让它走到抛错那一步）。
///
/// **2026-10-04 起问两台转写器**：Apple 在 iOS 26 给了第二个模块 `DictationTranscriber`，
/// 它与 `SpeechTranscriber` 共用 `SpeechAnalyzer` 宿主，但语言集**更宽**（本机实测 54 门 ⊃ 45 门，
/// 多出 th-TH / ru-RU / ar-SA / vi-VN / id-ID / tr-TR …）。只问前者时，泰语在听译页根本列不出来
/// （45 门 ∩ 我们 12 门注册表 = 9 门 —— 与真机截图那 9 个语言完全吻合）。
@available(iOS 26.0, macOS 26.0, *)
func mtSpeechLocale(_ id: String) async -> Locale? {
    await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: id))
}

@available(iOS 26.0, macOS 26.0, *)
func mtDictationLocale(_ id: String) async -> Locale? {
    await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: id))
}

/// 这门语言该用哪台转写器：**能用窄的（SpeechTranscriber）就用窄的**
/// （它是 Apple 的新模型，长文/对话场景更好），窄的不支持才落回 `DictationTranscriber`。
/// 返回 nil = 两台都不认 ⇒ 调用方按 unsupported 处理。
///
/// **2026-10-04 真机（iOS 26.x）修正**：`SpeechTranscriber.supportedLocale(equivalentTo:)`
/// 在 **iOS 26.x 上对「窄的那台并不支持」的语言也会归一化出一个 locale**（27.0 才改成回 nil）。
/// 只信它，就会把泰/俄/阿错分给窄的那台 —— 而那台的 `AssetInventory.status` 是 `unsupported`
/// ⇒ 整个探针回 `unsupported/locale` ⇒ 首页「对话/实时字幕」两个入口一起变灰。判据：必须真出现在
/// `SpeechTranscriber.supportedLocales` 清单里才认窄的这台。
///
/// **2026-10-04 晚（#563 追踪，15 Pro/26.6.2 浮层数据）再修**：名单说支持 ≠ 资产说可用 ——
/// 未就绪（未下载/元数据未同步）的模块会被 `AssetInventory` 报成 `.unsupported`，只看名单会把
/// 「没下载好」误判成「语言不支持」，包屏随即藏掉「识别语言包」行、永远不去下它（死循环）。
/// 所以两台**都**按资产状态问一遍，先用「资产不是 unsupported」的那台；都不行才返回原选
/// （调用方按 status 报真因）。实测 26.6.2：`speechN=30 dictN=54`，泰语 `dictation installed`。
@available(iOS 26.0, macOS 26.0, *)
enum MTTranscriberKind { case speech, dictation }

@available(iOS 26.0, macOS 26.0, *)
func mtModuleUsable(_ kind: MTTranscriberKind, _ l: Locale) async -> Bool {
    let st = await AssetInventory.status(forModules: [mtProbeModule(kind, l)])
    if case .unsupported = st { return false }
    return true
}

@available(iOS 26.0, macOS 26.0, *)
func mtTranscriberFor(_ id: String) async -> (kind: MTTranscriberKind, locale: Locale)? {
    let speechLocales = await SpeechTranscriber.supportedLocales
    var speech: (MTTranscriberKind, Locale)? = nil
    if let l = await mtSpeechLocale(id),
       speechLocales.contains(where: { $0.identifier(.bcp47) == l.identifier(.bcp47) }) {
        speech = (.speech, l)
    }
    let dict = await mtDictationLocale(id).map { (MTTranscriberKind.dictation, $0) }
    if let s = speech, await mtModuleUsable(s.0, s.1) { return s }
    if let d = dict, await mtModuleUsable(d.0, d.1) { return d }
    return speech ?? dict
}

/// 报给 JS 的「本机识别器支持哪些 locale」= **两台之并**（不写死，当场问设备）。
@available(iOS 26.0, macOS 26.0, *)
func mtSupportedLocalesUnion() async -> [String] {
    let a = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
    let b = await DictationTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
    return Array(Set(a).union(b)).sorted()
}

/// 给 `AssetInventory` 用的探针模块：按上面选出来的那台转写器造一个。
/// （资产按**模块**管理，所以探测也得用同一种模块，否则读到的状态不是它真会用的那份。）
@available(iOS 26.0, macOS 26.0, *)
func mtProbeModule(_ kind: MTTranscriberKind, _ locale: Locale) -> any SpeechModule {
    switch kind {
    case .speech:
        return SpeechTranscriber(locale: locale, preset: .transcription)
    case .dictation:
        return DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
    }
}

final class MTSpeechBridge: NSObject, WKScriptMessageHandler {

    static let shared = MTSpeechBridge()
    /// 通道名。JS 侧 `window.webkit.messageHandlers.mtSpeech` 与 sync-app-assets.js 的 install 行同一个字符串。
    static let channel = "mtSpeech"

    private weak var webView: WKWebView?
    private var transcriber: AnyObject?          // MTDeviceTranscriber（iOS 26+ 才有，所以按 AnyObject 存）
    private let speech = MTDeviceSpeech()
    private let system = MTSystemSpeech()      // 系统语音的原生后端（AVSpeechSynthesizer）：WebKit 只暴露 compact 档，增强/优质只有这里拿得到

    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: MTSpeechBridge.channel)
        ucc.add(self, name: MTSpeechBridge.channel)
        speech.emit = { [weak self] in self?.emit($0) }
        system.emit = { [weak self] in self?.emit($0) }
        MTDeviceLid.shared.emit = { [weak self] in self?.emit($0) }
        MTDeviceVad.shared.emit = { [weak self] in self?.emit($0) }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "stt-probe":  sttProbe(locales: strings(body["locales"]))
        case "diag-audio":
            // §0.4.1 诊断录音（2026-10-06）：JS 武装/收尾。文本 sidecar 只随音频包走。
            if let on = body["on"] as? Int, on == 1,
               let s = body["session"] as? String, let url = body["url"] as? String {
                MTDiagAudio.shared.arm(session: s, url: url)
            } else {
                MTDiagAudio.shared.disarm(sidecar: (body["sidecar"] as? String) ?? "")
            }
        case "stt-assets": sttAssets(locales: strings(body["locales"]))
        case "stt-start":  sttStart(body)
        case "stt-stop":   sttStop()
        case "tts-probe":  speech.probe(models: body["models"], systemLangs: system.langs())
        case "tts-assets": speech.download(models: body["models"])
        case "lid-probe":  MTDeviceLid.shared.probe(models: body["models"])
        case "lid-assets": MTDeviceLid.shared.install(models: body["models"])
        case "vad-probe":  MTDeviceVad.shared.probe(models: body["models"])
        case "vad-assets": MTDeviceVad.shared.install(models: body["models"])
        case "tts-speak":  if (body["backend"] as? String) == "system" { system.speak(body) } else { speech.speak(body) }
        case "tts-stop":   speech.stop(); system.stop()
        case "url-probe":  probeUrl(id: (body["id"] as? String) ?? "", url: (body["url"] as? String) ?? "")
        default: break
        }
    }

    private func strings(_ v: Any?) -> [String] { (v as? [Any])?.compactMap { $0 as? String } ?? [] }

    // MARK: - 地址可用性探测（learning-design §9.6.1.1）

    /// Range 0-0 的 GET（有的托管不认 HEAD），5 s 超时；2xx 算可用。只回 ok / status，不下内容。
    private func probeUrl(id: String, url: String) {
        guard let u = URL(string: url), u.scheme == "https" else {
            emit(["type": "url-probe", "id": id, "ok": false, "status": 0]); return
        }
        var req = URLRequest(url: u, timeoutInterval: 5)
        req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let ok = err == nil && code >= 200 && code < 300
            DispatchQueue.main.async { self?.emit(["type": "url-probe", "id": id, "ok": ok, "status": code]) }
        }.resume()
    }

    // MARK: - 转写

    private func sttProbe(locales: [String]) {
        guard #available(iOS 26.0, macOS 26.0, *) else {
            emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
        }
        Task {
            guard SpeechTranscriber.isAvailable else {
                self.emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
            }
            // 本机识别器支持的 locale 清单（2026-09-17，2026-10-04 起取两台的并集）：
            // JS 侧据此只列支持的语言 —— 清单由设备当场报，不写死。
            let supported = await mtSupportedLocalesUnion()
            var allInstalled = true
            var enginePicks: [String] = []   // 诊断（§0.4.1，2026-10-06）：每门语言实际选了哪台识别器
                                             // （st=SpeechTranscriber 窄引擎 / dt=DictationTranscriber）——
                                             // 「混对会话把好引擎拖回旧引擎」的量化数据
            for id in locales {
                // 归一化（2026-10-02）：短码 "en" 是不受支持的配置 ⇒ 先归一化成 "en-US"。
                // 2026-10-04：窄的不支持就落回 DictationTranscriber（泰语/俄语/阿拉伯语靠它）。
                guard let pick = await mtTranscriberFor(id) else {
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "unsupported"])
                    self.emit(["type": "stt-state", "state": "unsupported", "reason": "locale", "supported": supported])
                    return
                }
                enginePicks.append((pick.kind == .dictation ? "dt:" : "st:") + id)
                let t = mtProbeModule(pick.kind, pick.locale)
                let st = await AssetInventory.status(forModules: [t])
                switch st {
                case .unsupported:
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "unsupported"])
                    self.emit(["type": "stt-state", "state": "unsupported", "reason": "locale", "supported": supported])
                    return
                case .installed:
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 1, "state": "installed"])
                default:
                    allInstalled = false
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "missing"])
                }
            }
            self.emit(["type": "stt-state", "state": "ready", "assets": allInstalled ? "installed" : "missing", "supported": supported, "engines": enginePicks])
        }
    }

    private func sttAssets(locales: [String]) {
        guard #available(iOS 26.0, macOS 26.0, *) else {
            emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
        }
        Task {
            for id in locales {
                // 归一化（2026-10-02）：短码会让 assetInstallationRequest 抛 SFSpeechErrorDomain Code=4。
                // 2026-10-04：窄的不支持就落回 DictationTranscriber（泰语等靠它）。
                guard let pick = await mtTranscriberFor(id) else {
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "unsupported"])
                    self.emit(["type": "stt-state", "state": "unsupported", "reason": "locale"])
                    return
                }
                let t = mtProbeModule(pick.kind, pick.locale)
                // 诊断（2026-10-02）：真机上识别资产装不上时，屏上只剩「没动静」——这里把当场读到的
                // 状态与硬件可用性报出去，JS 会把它显示在超时那行。
                let st0 = await AssetInventory.status(forModules: [t])
                let supportedIds = await mtSupportedLocalesUnion()
                self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "missing",
                           "status": String(describing: st0), "ready": SpeechTranscriber.isAvailable, "supported": supportedIds.contains(id)])
                do {
                    guard let req = try await AssetInventory.assetInstallationRequest(supporting: [t]) else {
                        self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 1, "state": "installed"]); continue
                    }
                    let p = req.progress
                    let watcher = Task {
                        while !Task.isCancelled {
                            let f = p.fractionCompleted
                            self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": f, "state": "downloading",
                                       "total": p.totalUnitCount, "completed": p.completedUnitCount])
                            try? await Task.sleep(nanoseconds: 1_000_000_000)
                        }
                    }
                    try await req.downloadAndInstall()
                    watcher.cancel()
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 1, "state": "installed"])
                } catch {
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "failed", "reason": mtPrepareCode(error)])
                    // fail fast（2026-10-02）：以前这里直接 return，JS 只能干等满 120 s 超时（屏上只剩
                    // 「没动静」，真因不可见）；补一条带 assets 的 stt-state 立刻唤醒它，错误当场显示。
                    self.emit(["type": "stt-state", "state": "ready", "assets": "missing"])
                    return
                }
            }
            self.emit(["type": "stt-state", "state": "ready", "assets": "installed"])
        }
    }

    private func sttStart(_ body: [String: Any]) {
        // 旧的一路**静默**停掉：`ended` 是 `stt-stop` 的回执，在 start 里回一条会被刚开的新会话
        // 当成「自己结束了」（页面在会话进行中被 reload、或原生里还挂着上一场的 transcriber 时，
        // 下一个 start 就会把自己立刻打回 halted/socket）。
        mtStopCurrentTranscriber(announce: false)
        guard #available(iOS 26.0, macOS 26.0, *) else {
            emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
        }
        let locales = strings(body["locales"])
        guard !locales.isEmpty else { emit(["type": "stt-state", "state": "failed", "reason": "locales"]); return }
        let t = MTDeviceTranscriber(locales: locales,
                                    vadMs: (body["vadMs"] as? Double) ?? 400,
                                    vadLevel: (body["vadLevel"] as? Double) ?? 0.012)
        t.emit = { [weak self] in self?.emit($0) }
        transcriber = t
        t.start()
    }

    private func sttStop() {
        mtStopCurrentTranscriber(announce: true)
    }

    /// 停掉当前 transcriber。`announce` = 是否回一条 `stt-state ended`（只有 stt-stop 要）。
    private func mtStopCurrentTranscriber(announce: Bool) {
        guard let t = transcriber else { return }
        transcriber = nil
        if #available(iOS 26.0, macOS 26.0, *), let dt = t as? MTDeviceTranscriber { dt.stop() }
        if announce { emit(["type": "stt-state", "state": "ended"]) }
    }

    // MARK: - 原生 → JS

    fileprivate func emit(_ payload: [String: Any]) {
        guard let webView = self.webView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            webView.evaluateJavaScript(
                "window.NativeSpeech && window.NativeSpeech._fromNative(\(json))",
                completionHandler: nil)
        }
    }
}

// MARK: - 设备内置转写（SpeechAnalyzer）

@available(iOS 26.0, macOS 26.0, *)
final class MTDeviceTranscriber {
    var emit: (([String: Any]) -> Void)?
    private let locales: [String]
    private let vadMs: Double
    private let vadLevel: Double
    private var analyzer: SpeechAnalyzer?
    private var continuation: AsyncStream<AnalyzerInput>.Continuation?
    private var readers: [String: Task<Void, Never>] = [:]     // locale → reader
    /// locale ↔ 引擎 **成对**带出（混装后下标不再等于 locales 的下标）。
    private enum Mod { case speech(SpeechTranscriber); case dictation(DictationTranscriber) }
    private var converter: AVAudioConverter?
    private var format: AVAudioFormat?
    private var fed: Int64 = 0
    private var quietFrames: Int64 = 0
    private var spokeSinceFinalize = false
    private var stopped = false

    init(locales: [String], vadMs: Double, vadLevel: Double) {
        self.locales = locales; self.vadMs = vadMs; self.vadLevel = vadLevel
    }

    /// 进程内**已经 reserve 过的 locale**（短码 → Locale）。
    /// Apple 对每个 App 有硬上限：超过就抛 `SFSpeechErrorDomain Code=11 "Too many allocated
    /// locales, 5 maximum."` —— 2026-10-07 真机批 28：来回切语言之后点「开始听」就炸
    /// （每次 `stt-start` 都新建一个 transcriber，旧那一对的 locale **从来没释放过**）。
    /// 规矩：**每次 start 之前先把不再用的释放掉，只留当前这一对**。
    private static let heldLock = NSLock()
    private static var held: [String: Locale] = [:]
    private static func heldKey(_ code: String) -> String {
        String(code.lowercased().split(separator: "-").first ?? "")
    }
    /// 释放 `want` 之外的（**必须在建新模块之前调**：新模块自己也要占名额，先腾位置）。
    static func releaseUnused(_ want: [String]) async {
        let keep = Set(want.map { heldKey($0) })
        heldLock.lock()
        let drop = held.filter { !keep.contains($0.key) }
        for k in drop.keys { held[k] = nil }
        heldLock.unlock()
        for (_, loc) in drop { _ = await AssetInventory.release(reservedLocale: loc) }
    }
    private static func noteHeld(_ code: String, _ locale: Locale) {
        heldLock.lock(); held[heldKey(code)] = locale; heldLock.unlock()
    }

    func start() {
        Task {
            // 先释放不再用的 locale（上限 5 个；见 `releaseUnused` 的注释）。
            await MTDeviceTranscriber.releaseUnused(locales)
            // 2026-10-06（#570 / §9.6.1.2）：**每种语言各按自己的引擎定，不再整体降级。**
            // 旧规则「只要有一门需要 DictationTranscriber，整个会话都用它」会把 zh 从更准的
            // SpeechTranscriber 拖走，而 Dictation 不报置信度 ⇒ 中泰会话里错语言那一路（泰语路把
            // 中文硬解成泰文）既过文字系、又无置信度可判，直接成为一行假译（真机 94 号）。
            // 现在两种模块混装在**同一个** SpeechAnalyzer 里（它收的就是 `[any SpeechModule]`，
            // 而读取本来就是「每模块一个 reader」），Speech 那一路拿回置信度，交给 JS 的跨语言
            // 仲裁（listen-core 的 makeFinalArbiter）用。
            var mods: [any SpeechModule] = []
            var pairs: [(String, Mod)] = []
            for id in locales {
                guard let m = await makeModule(id) else {
                    emit?(["type": "stt-state", "state": "failed", "reason": "locale"]); return
                }
                pairs.append(m); mods.append(module(m))
            }
            guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: mods) else {
                emit?(["type": "stt-state", "state": "failed", "reason": "format"]); return
            }
            let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
            let an = SpeechAnalyzer(inputSequence: stream, modules: mods, options: nil,
                                    analysisContext: AnalysisContext(), volatileRangeChangedHandler: nil)
            do { try await an.prepareToAnalyze(in: fmt) } catch {
                // **不要把系统原文送出去**（协议规矩：reason 是 id，人话由 JS 拼）。这条真机上
                // 长这样：`Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales,
                // 5 maximum."` —— 而界面把它拼进「离线模型下载失败：…多半是网络问题」（误报）。
                emit?(["type": "stt-state", "state": "failed", "reason": mtPrepareCode(error)]); return
            }
            if stopped { return }
            analyzer = an; continuation = cont; format = fmt
            for (id, m) in pairs { startReader(id, m) }
            MTAudioBridge.shared.micSink = { [weak self] buf in self?.feed(buf) }
            emit?(["type": "stt-state", "state": "ready"])
        }
    }

    /// 这门语言该用哪个模块（能窄的用窄的）；资产没装 / 语言不支持 ⇒ nil。
    private func makeModule(_ id: String) async -> (String, Mod)? {
        guard let p = await mtTranscriberFor(id) else { return nil }
        MTDeviceTranscriber.noteHeld(id, p.locale)   // 记下「这个 locale 被我们占着」（见 releaseUnused）
        switch p.kind {
        case .speech:
            let t = SpeechTranscriber(locale: p.locale, transcriptionOptions: [],
                                      reportingOptions: [.volatileResults, .fastResults, .alternativeTranscriptions],
                                      attributeOptions: [.audioTimeRange, .transcriptionConfidence])
            guard await AssetInventory.status(forModules: [t]) == .installed else { return nil }
            return (id, .speech(t))
        case .dictation:
            let t = DictationTranscriber(locale: p.locale, preset: .progressiveLongDictation)
            guard await AssetInventory.status(forModules: [t]) == .installed else { return nil }
            return (id, .dictation(t))
        }
    }
    private func module(_ m: (String, Mod)) -> any SpeechModule {
        switch m.1 { case .speech(let t): return t; case .dictation(let t): return t }
    }
    /// 给一路起 reader（`deliver` 拿置信度、`deliverDictation` 没有）。
    private func startReader(_ id: String, _ m: Mod) {
        guard readers[id] == nil else { return }
        readers[id] = Task { [weak self] in
            do {
                switch m {
                case .speech(let t): for try await r in t.results { self?.deliver(id, r) }
                case .dictation(let t): for try await r in t.results { self?.deliverDictation(id, r) }
                }
            } catch {
                self?.emit?(["type": "stt-state", "state": "failed", "reason": mtPrepareCode(error)])
            }
        }
    }

    private func deliver(_ locale: String, _ r: SpeechTranscriber.Result) {
        var n = 0, sum = 0.0
        for run in r.text.runs { if let c = run.transcriptionConfidence { sum += c; n += 1 } }
        var payload: [String: Any] = [
            "type": r.isFinal ? "stt-final" : "stt-partial",
            "locale": locale,
            "text": String(r.text.characters),
            "conf": n > 0 ? sum / Double(n) : -1,
        ]
        if r.isFinal {
            payload["alts"] = r.alternatives.dropFirst().prefix(3).map { String($0.characters) }
            payload["t0"] = Int(r.range.start.seconds * 1000)
            payload["t1"] = Int(r.range.end.seconds * 1000)
        }
        emit?(payload)
    }

    /// 落回 `DictationTranscriber` 的会话走这一条（2026-10-04）。
    /// 与 `deliver` 的差别是**它没有 audioTimeRange / 置信度**（那两样是 SpeechTranscriber 的属性），
    /// 所以字幕时间戳与备选译法在这条路上为空 —— 语言能力优先，代价如实记在 learning-design 里。
    private func deliverDictation(_ locale: String, _ r: DictationTranscriber.Result) {
        emit?(["type": r.isFinal ? "stt-final" : "stt-partial",
               "locale": locale,
               "text": String(r.text.characters),
               "conf": -1])
    }

    /// 由 MTAudioBridge 的 tap 线程调用：转格式、喂 analyzer、顺手做静音检测。
    private func feed(_ buffer: AVAudioPCMBuffer) {
        // §9.6.1.3：同一段麦克风 PCM 顺手喂语种识别。**先过 VAD**（silero）——「这段是不是人在说话」
        // 由它判，只有真语音才累计进 LID（真泰语多人对谈实测：演播室背景乐 + 多人交叠时，LID 的判词
        // 会在十几门语言之间乱跳，判错一次就让错语言那一路的定稿上屏）。拿不到 VAD ⇒ 退回能量门。
        let rms = MTAudioBridge.rms(buffer)
        if let pcm = MTDeviceLid.shared.pcm16(buffer) {
            let speech = MTDeviceVad.shared.accept(pcm, fallback: rms > vadLevel)
            MTDeviceLid.shared.feed(pcm, speech: speech)
        }
        guard !stopped, let fmt = format, let cont = continuation, let an = analyzer else { return }
        if converter == nil || converter!.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: fmt)   // 路由切换后格式会变：懒重建
        }
        guard let conv = converter else { return }
        let cap = AVAudioFrameCount(Double(buffer.frameLength) * fmt.sampleRate / buffer.format.sampleRate) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { return }
        var consumed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true; status.pointee = .haveData; return buffer
        }
        guard err == nil, out.frameLength > 0 else { return }
        cont.yield(AnalyzerInput(buffer: out, bufferStartTime: CMTime(value: fed, timescale: CMTimeScale(fmt.sampleRate))))
        fed += Int64(out.frameLength)
        // 静音检测（在原生格式上算，不管它是 Float32 还是 Int16）—— rms 已在函数开头算过
        if rms > vadLevel { quietFrames = 0; spokeSinceFinalize = true }
        else { quietFrames += Int64(buffer.frameLength) }
        if spokeSinceFinalize, Double(quietFrames) / buffer.format.sampleRate * 1000 >= vadMs {
            spokeSinceFinalize = false
            let through = CMTime(value: fed, timescale: CMTimeScale(fmt.sampleRate))
            Task { try? await an.finalize(through: through) }
            MTDeviceLid.shared.finish()   // 同一句结束：判一次语言（与识别器 finalize 同时刻）
        }
    }

    func stop() {
        stopped = true
        MTAudioBridge.shared.micSink = nil
        MTDeviceLid.shared.reset()   // 会话结束：丢掉没判完的那半句
        MTDeviceVad.shared.reset()
        continuation?.finish()
        let an = analyzer
        analyzer = nil; continuation = nil
        let rs = Array(readers.values); readers = [:]
        Task {
            if let an { await an.cancelAndFinishNow() }
            for r in rs { r.cancel() }
        }
    }
}

// MARK: - 设备内置朗读（sherpa-onnx 离线模型）

/// 模型文件在 Application Support/mt-speech/<dir>/ 下；由 JS 给清单（url + sha256 + size），
/// 这里下载、校验、加载、合成、播放。任何系统上都编译（sherpa 是 iOS 15+），但只在 JS 探过之后才用。
final class MTDeviceSpeech {
    var emit: (([String: Any]) -> Void)?

    private struct Model {
        let lang: String; let dir: String
        let model: String; let tokens: String; let dataDir: String
        // 2026-10-03（高质量语音）：Kokoro 不是 vits 那一套。多出来的四样按 type 取，
        // 缺省即 vits（老条目逐字节不变）。
        let type: String
        let voices: String; let dictDir: String; let lexicon: String; let voiceLang: String
        let files: [(path: String, url: String, sha256: String, size: Int)]
    }
    private var models: [String: Model] = [:]          // lang → 清单
#if canImport(SherpaOnnx)
    private var loaded: [String: SherpaOnnxOfflineTtsWrapper] = [:]
#endif
    private let queue = DispatchQueue(label: "mt.speech.tts")
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var playerRate: Double = 0
    private var currentId = ""
    private var cancelled = false

    private var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("mt-speech", isDirectory: true)
    }

    private func parse(_ v: Any?) -> [Model] {
        guard let list = v as? [[String: Any]] else { return [] }
        return list.compactMap { m in
            guard let lang = m["lang"] as? String, let dir = m["dir"] as? String,
                  let model = m["model"] as? String, let tokens = m["tokens"] as? String,
                  let dataDir = m["dataDir"] as? String, let files = m["files"] as? [[String: Any]] else { return nil }
            let fs = files.compactMap { f -> (String, String, String, Int)? in
                guard let p = f["path"] as? String, let u = f["url"] as? String, let s = f["sha256"] as? String else { return nil }
                return (p, u, s, (f["size"] as? Int) ?? 0)
            }
            return Model(lang: lang, dir: dir, model: model, tokens: tokens, dataDir: dataDir,
                         type: (m["type"] as? String) ?? "vits",
                         voices: (m["voices"] as? String) ?? "",
                         dictDir: (m["dictDir"] as? String) ?? "",
                         lexicon: (m["lexicon"] as? String) ?? "",
                         voiceLang: (m["kokoroLang"] as? String) ?? "",
                         files: fs)
        }
    }

    /// zip 条目（清单里 path 以 .zip 结尾）解到目录后留一个以 sha256 命名的安装戳；普通文件按大小判。
    /// 三个必需路径（模型 / tokens / 数据目录）也必须在 —— 半个模型等于没有。
    private func installed(_ m: Model) -> Bool {
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        let fm = FileManager.default
        for f in m.files {
            if f.path.hasSuffix(".zip") {
                guard fm.fileExists(atPath: d.appendingPathComponent(".installed-" + f.sha256.lowercased()).path) else { return false }
                continue
            }
            let p = d.appendingPathComponent(f.path)
            guard let attrs = try? fm.attributesOfItem(atPath: p.path), (attrs[.size] as? Int) == f.size else { return false }
        }
        guard !m.files.isEmpty else { return false }
        // MMS-TTS 没有 espeak-ng-data（`dataDir` 为空串）—— 不要因此把它判成「没装」。
        let dataOk = m.dataDir.isEmpty || fm.fileExists(atPath: d.appendingPathComponent(m.dataDir).path)
        return fm.fileExists(atPath: d.appendingPathComponent(m.model).path)
            && fm.fileExists(atPath: d.appendingPathComponent(m.tokens).path)
            && dataOk
    }

    /// tts-state 同时带系统语音后端的可用语言（`system` / `systemLangs`），JS 的 `browser` 引擎据此决定走原生还是 WebKit。
    func probe(models v: Any?, systemLangs: [String]) {
        let list = parse(v)
        for m in list { models[m.lang] = m }
#if canImport(SherpaOnnx)
        let langs = list.filter { installed($0) }.map { $0.lang }
        for m in list {
            emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": installed(m) ? 1 : 0, "state": installed(m) ? "installed" : "missing"])
        }
        emit?(["type": "tts-state", "state": langs.count == list.count && !list.isEmpty ? "ready" : "assets", "langs": langs, "system": true, "systemLangs": systemLangs])
#else
        emit?(["type": "tts-state", "state": "failed", "reason": "no-engine", "langs": [], "system": true, "systemLangs": systemLangs])
#endif
    }

    /// 逐文件下载 + sha256 校验；任何一个不符 ⇒ 删掉、报 failed，绝不留半个模型。
    func download(models v: Any?) {
        let list = parse(v)
        for m in list { models[m.lang] = m }
        Task {
            for m in list where !installed(m) {
                let d = root.appendingPathComponent(m.dir, isDirectory: true)
                var done = 0
                let total = max(m.files.reduce(0) { $0 + $1.size }, 1)
                for f in m.files {
                    let dst = d.appendingPathComponent(f.path)
                    do {
                        try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
                        guard let url = URL(string: f.url) else { throw URLError(.badURL) }
                        let before = done
                        var lastEmit = 0.0
                        let tmp = try await MTDeviceSpeech.fetch(url) { [weak self] frac in
                            // ≤ 4 次/秒：每个字节回调都过桥会把主线程淹掉
                            let now = Date().timeIntervalSince1970
                            guard now - lastEmit >= 0.25 else { return }
                            lastEmit = now
                            let fraction = (Double(before) + frac * Double(f.size)) / Double(total)
                            DispatchQueue.main.async { self?.emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": fraction, "state": "downloading"]) }
                        }
                        let data = try Data(contentsOf: tmp)
                        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                        guard digest == f.sha256.lowercased() else { try? FileManager.default.removeItem(at: tmp); throw URLError(.cannotDecodeContentData) }
                        if f.path.hasSuffix(".zip") {
                            // 解包到模型目录（扁平布局），成功后留安装戳；zip 本身不留
                            try MTZip.extract(data, into: d)
                            try? FileManager.default.removeItem(at: tmp)
                            FileManager.default.createFile(atPath: d.appendingPathComponent(".installed-" + f.sha256.lowercased()).path, contents: Data())
                        } else {
                            try? FileManager.default.removeItem(at: dst)
                            try FileManager.default.moveItem(at: tmp, to: dst)
                        }
                        done += f.size
                        emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": Double(done) / Double(total), "state": "downloading"])
                    } catch {
                        // **不删整个模型目录**（那会把同一次里已经下好的文件一起抹掉，下次从零再来 ——
                        // 而这一次失败很可能只是网络抖了一下），也**不把 `String(describing: error)` 送出去**
                        // —— 真机上那句「Error Domain=NSURLErrorDomain Code=-1005…」就是从这儿去的界面。
                        // 送协议码，人话由 JS 用既有 i18n 键拼（仓库的协议规矩：reasons 是 id，不是文案）。
                        emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang,
                               "fraction": 0, "state": "failed", "reason": mtdlCode(error)])
                        emit?(["type": "tts-state", "state": "failed", "reason": "download", "langs": Array(self.loadedLangs())])
                        return
                    }
                }
                emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": 1, "state": "installed"])
            }
            let langs = models.values.filter { installed($0) }.map { $0.lang }.sorted()
            emit?(["type": "tts-state", "state": "ready", "langs": langs])
        }
    }

    /// 带进度的下载（一个模型就是一个几十到一百多 MB 的 zip，「下载完才回调」的接口会让进度条只有 0% 和 100% ——
    /// 2026-09-12 真机实测就是这样）。调用方限频。
    /// **2026-10-04 起走 `MTBackgroundDownloader`**（后台会话 + 断点续传 + 自动重试），
    /// 原因见那个类的注释 —— 真机上最小化 + 断网会以 -1005 收场，而 resume data 明明就在手边。
    static func fetch(_ url: URL, progress: @escaping (Double) -> Void) async throws -> URL {
        try await MTBackgroundDownloader.shared.fetch(url, progress: progress)
    }

    private func loadedLangs() -> [String] { models.values.filter { installed($0) }.map { $0.lang }.sorted() }

    func speak(_ body: [String: Any]) {
        guard let id = body["id"] as? String, let text = body["text"] as? String, let lang = body["lang"] as? String else { return }
        let rate = (body["rate"] as? Double) ?? 1.0
#if canImport(SherpaOnnx)
        guard let m = models[lang], installed(m) else { emit?(["type": "tts-failed", "id": id, "reason": "lang"]); return }
        cancelled = false
        currentId = id
        emit?(["type": "tts-debug", "id": id, "step": "speak"])
        queue.async { [self] in
            let tts: SherpaOnnxOfflineTtsWrapper
            if let t = loaded[lang] { tts = t } else {
                let d = root.appendingPathComponent(m.dir, isDirectory: true)
                let model: SherpaOnnxOfflineTtsModelConfig
                if m.type == "kokoro" {
                    // Kokoro 多语（sherpa-onnx 的 kokoro 清单）：**一个引擎同时念中英** ——
                    // 词表按字符区间自己分流（kokoro-multi-lang-lexicon.cc 的
                    // expr_chinese / expr_not_chinese），所以中英各一条清单也共用同一份模型。
                    // lang 是给 espeak 的语言提示（cmn / en-us），词典两本都要给。
                    let k = sherpaOnnxOfflineTtsKokoroModelConfig(
                        model: d.appendingPathComponent(m.model).path,
                        voices: d.appendingPathComponent(m.voices).path,
                        tokens: d.appendingPathComponent(m.tokens).path,
                        dataDir: d.appendingPathComponent(m.dataDir).path,
                        dictDir: d.appendingPathComponent(m.dictDir).path,
                        lexicon: m.lexicon.split(separator: ",").map { d.appendingPathComponent(String($0)).path }.joined(separator: ","),
                        lang: m.voiceLang)
                    model = sherpaOnnxOfflineTtsModelConfig(kokoro: k, numThreads: 2)
                } else {
                    let vits = sherpaOnnxOfflineTtsVitsModelConfig(
                        model: d.appendingPathComponent(m.model).path,
                        tokens: d.appendingPathComponent(m.tokens).path,
                        // **dataDir 为空必须传空串**（#567 真凶，2026-10-06 sherpa stderr 实锤：
                        // 传目录会被当 espeak 数据目录校验 phontab，不存在即拒载 —— vits 在任何
                        // 包里都没装载成功过，此前泰语全靠系统语音兜底；iOS 无泰语语音 ⇒ 全哑）。
                        dataDir: m.dataDir.isEmpty ? "" : d.appendingPathComponent(m.dataDir).path)
                    model = sherpaOnnxOfflineTtsModelConfig(vits: vits, numThreads: 2)
                }
                var cfg = sherpaOnnxOfflineTtsConfig(model: model, maxNumSentences: 1)
                let t = SherpaOnnxOfflineTtsWrapper(config: &cfg)
                guard t.tts != nil else { DispatchQueue.main.async { self.emit?(["type": "tts-failed", "id": id, "reason": "load"]) }; return }
                // 内存封顶：Kokoro int8 一个引擎峰值 RSS ≈460 MB（2026-10-03 在本机实测，
                // 见 docs/learning-design.md §9.6.1）。两个语言同时驻留就是两倍，iOS 上会被
                // jetsam 杀掉 —— 所以只留当前语言这一个；切语言的代价是重新装载（约 1–2 s），
                // 而交替朗读本来就慢于这个量级。
                if m.type == "kokoro" { for k in loaded.keys where k != lang { loaded.removeValue(forKey: k) } }
                loaded[lang] = t; tts = t
            }
            let sampleRate = Double(tts.sampleRate)
            let player: AVAudioPlayerNode
            do { player = try self.ensurePlayer(rate: sampleRate) } catch {
                DispatchQueue.main.async { self.emit?(["type": "tts-failed", "id": id, "reason": mtdlCode(error)]) }; return
            }
            let box = MTSpeechChunkBox(player: player, rate: sampleRate)
            box.ttsStream = "tts-\(id)"
            DispatchQueue.main.async { self.emit?(["type": "tts-debug", "id": id, "step": "player"]) }
            box.onFirst = { [weak self] in MTAudioBridge.shared.muteInput = true; self?.emit?(["type": "tts-start", "id": id]) }
            box.isCancelled = { [weak self] in self?.cancelled ?? true }
            let cb: TtsCallbackWithArg = { samples, n, arg in
                let b = Unmanaged<MTSpeechChunkBox>.fromOpaque(arg!).takeUnretainedValue()
                if b.isCancelled() { return 0 }
                if let samples { b.schedule(samples, Int(n)) }
                return 1
            }
            let ptr = Unmanaged.passUnretained(box).toOpaque()
            let audio = tts.generateWithCallbackWithArg(text: text, callback: cb, arg: ptr, sid: 0, speed: Float(rate))
            let n = audio.audio != nil ? Int(audio.audio.pointee.n) : -1
            DispatchQueue.main.async { self.emit?(["type": "tts-debug", "id": id, "step": "generated", "n": n]) }
            box.finish { [weak self] in
                guard let self else { return }
                MTAudioBridge.shared.muteInput = false
                guard self.currentId == id else { self.emit?(["type": "tts-debug", "id": id, "step": "stale"]); return }
                self.emit?(["type": "tts-end", "id": id])
            }
        }
#else
        emit?(["type": "tts-failed", "id": id, "reason": "no-engine"])
#endif
    }

    func stop() {
        cancelled = true
        let id = currentId
        currentId = ""
        player?.stop()
        player?.play()
        MTAudioBridge.shared.muteInput = false
        if !id.isEmpty { emit?(["type": "tts-end", "id": id]) }
    }

    private func ensurePlayer(rate: Double) throws -> AVAudioPlayerNode {
        if let p = player, let e = engine, e.isRunning, playerRate == rate { return p }
        engine?.stop()
#if os(iOS)
        // 会话类别由 MTAudioBridge 钉（听译一律 .playAndRecord + mixWithOthers）；这里只保证它是活的。
        try AVAudioSession.sharedInstance().setActive(true)
#endif
        let e = AVAudioEngine()
        let p = AVAudioPlayerNode()
        e.attach(p)
        e.connect(p, to: e.mainMixerNode, format: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1))
        try e.start()
        p.play()
        engine = e; player = p; playerRate = rate
        return p
    }
}

/// 一次合成的块调度器：块一到就排进 playerNode；「播完」按**首块时刻 + 总时长**定时收口。
///
// ─── 系统语音的原生后端 ───────────────────────────────────────────────────────
/// 2026-09-13 真机实证：手机装了婷婷（增强）/ Han（优质）/ Ava（优质）等 16 个高档声音，原生
/// `AVSpeechSynthesisVoice.speechVoices()` 有 209 个，而 WKWebView 的 `speechSynthesis.getVoices()` 只有
/// 70 个、全是 compact / super-compact —— WebKit 那条路永远拿不到增强/优质档。所以 App 里的「设备内置语音」
/// （注册表 `browser`）经这里合成：按 优质 > 增强 > 默认 挑同语言的声音，走 App 自己的音频会话（锁屏可出声）。
/// 协议与 Piper 后端完全相同（tts-speak 带 `backend:"system"` → tts-start / tts-end / tts-failed），JS 不分。
///
/// **2026-10-05（#565 三轮）改走 `write()` 管线**：原来 `synth.speak(u)` 让系统在内部渲染播放，静麦只能
/// 跟着 delegate 回调（didStart/didFinish）走 —— 而那些回调比**实际出声**早/晚（真机：泰语念完仍被自己认成
/// 新句子），中文（Piper）那条自己渲染、自己排队、静麦对齐到「首块出声 + 总样本数」的路从不回声。
/// 现在 `write(_:toBuffer:)` 把合成出的 PCM 块交给**我们**，用与 Piper 完全相同的
/// `MTSpeechChunkBox` + `AVAudioPlayerNode` 播放 —— 系统语音从此走那条从不回声的通道。
final class MTSystemSpeech: NSObject {
    var emit: (([String: Any]) -> Void)?
    private var synth = AVSpeechSynthesizer()
    private var currentId = ""
    private var cancelled = false
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var playerRate: Double = 0

    /// 有声音的语言（小写、去地区），给 JS 判「这个语言原生能不能读」。
    func langs() -> [String] {
        var seen = Set<String>()
        for v in AVSpeechSynthesisVoice.speechVoices() {
            let base = v.language.split(separator: "-").first.map { String($0).lowercased() } ?? ""
            if !base.isEmpty { seen.insert(base) }
        }
        return seen.sorted()
    }

    private static func tier(_ v: AVSpeechSynthesisVoice) -> Int {
        switch v.quality { case .premium: return 3; case .enhanced: return 2; default: return 1 }
    }
    /// 选声：用户在设置里点过的（identifier 与 WebKit 的 voiceURI 同一命名空间）最优先；否则同语言里
    /// 优质 > 增强 > 默认，正牌人声（com.apple.voice.* / ttsbundle）压过 eloquence / 音效声，地区全等再加一分。
    static func pick(lang: String, preferred: String) -> AVSpeechSynthesisVoice? {
        let all = AVSpeechSynthesisVoice.speechVoices()
        if !preferred.isEmpty, let v = all.first(where: { $0.identifier == preferred }) { return v }
        let want = lang.lowercased()
        let base = want.split(separator: "-").first.map(String.init) ?? want
        let cands = all.filter { $0.language.lowercased() == want || $0.language.lowercased().hasPrefix(base + "-") || $0.language.lowercased() == base }
        func score(_ v: AVSpeechSynthesisVoice) -> Int {
            var n = tier(v) * 10
            let id = v.identifier
            if id.hasPrefix("com.apple.voice.") || id.contains("ttsbundle") { n += 2 }
            if id.hasPrefix("com.apple.eloquence.") || id.hasPrefix("com.apple.speech.synthesis.voice.") { n -= 5 }
            if v.language.lowercased() == want { n += 1 }
            return n
        }
        return cands.max { score($0) < score($1) }
    }

    func speak(_ body: [String: Any]) {
        guard let id = body["id"] as? String, let text = body["text"] as? String, let lang = body["lang"] as? String else { return }
        let rate = (body["rate"] as? Double) ?? 1.0
        let preferred = (body["voice"] as? String) ?? ""
        guard let voice = MTSystemSpeech.pick(lang: lang, preferred: preferred) else { emit?(["type": "tts-failed", "id": id, "reason": "lang"]); return }
        cancelled = false
        currentId = id
        synth.stopSpeaking(at: .immediate)   // 也终止在途的 write()（合成即刻停）
#if os(iOS)
        // 会话类别由 MTAudioBridge 钉（听译一律 .playAndRecord + mixWithOthers）；这里只保证它是活的。
        try? AVAudioSession.sharedInstance().setActive(true)
#endif
        let u = AVSpeechUtterance(string: text)
        u.voice = voice
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(rate)))
        // 与 Piper 同一条管线：write() 把合成的 PCM 块交给**我们**，排进自己的 AVAudioPlayerNode，
        // 静麦由 MTSpeechChunkBox 对齐到「首块出声 + 总样本数/采样率」—— 不再猜 delegate 回调的时机。
        var box: MTSpeechChunkBox?
        synth.write(u) { [weak self] buffer in
            guard let self else { return }
            // 空块 = 合成结束（write() 的收尾信号）
            guard let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0, pcm.floatChannelData != nil else {
                box?.finish { MTAudioBridge.shared.muteInput = false
                    guard self.currentId == id else { return }
                    self.emit?(["type": "tts-end", "id": id]) }
                return
            }
            if self.cancelled { return }
            if box == nil {
                do {
                    let (p, r) = try self.ensurePlayer(rate: pcm.format.sampleRate)
                    let b = MTSpeechChunkBox(player: p, rate: r); b.ttsStream = "tts-\(id)"
                    b.onFirst = { MTAudioBridge.shared.muteInput = true; self.emit?(["type": "tts-start", "id": id]) }
                    b.isCancelled = { self.cancelled }
                    box = b
                } catch {
                    self.currentId = ""
                    self.emit?(["type": "tts-failed", "id": id, "reason": mtdlCode(error)])
                    return
                }
            }
            let n = Int(pcm.frameLength)
            let chs = Int(pcm.format.channelCount)
            if chs > 1 {
                var mono = [Float](repeating: 0, count: n)
                for c in 0..<chs {
                    let src = pcm.floatChannelData![c]
                    for i in 0..<n { mono[i] += src[i] / Float(chs) }
                }
                box?.schedule(mono, n)
            } else {
                box?.schedule(pcm.floatChannelData![0], n)
            }
        }
    }

    func stop() {
        cancelled = true
        let id = currentId
        currentId = ""
        synth.stopSpeaking(at: .immediate)
        player?.stop()
        player?.play()
        MTAudioBridge.shared.muteInput = false
        if !id.isEmpty { emit?(["type": "tts-end", "id": id]) }
    }

    /// 与 MTSpeech.ensurePlayer 同一套：引擎/播放器按**这一嗓音的采样率**建（write() 的块原样排入，
    /// 不做重采样 —— 采样率只有拿到第一块才知道，所以引擎在第一块到达时才建）。
    private func ensurePlayer(rate: Double) throws -> (AVAudioPlayerNode, Double) {
        if let p = player, let e = engine, e.isRunning, playerRate == rate { return (p, rate) }
        engine?.stop()
        let e = AVAudioEngine()
        let p = AVAudioPlayerNode()
        e.attach(p)
        e.connect(p, to: e.mainMixerNode, format: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1))
        try e.start()
        p.play()
        engine = e; player = p; playerRate = rate
        return (p, rate)
    }
}

/// 2026-09-12 真机实证：tts-start 发了、tts-end 永远不发，自动朗读的队列在第二句上永远等着（手点
/// 「朗读」只等开始所以看着正常）。真因是**生命周期**：box 是队列块里的局部量，generate 一返回就被
/// 释放，弱引用的完成回调全打在 nil 上 —— 不是音频会话的问题。现在回调与定时器都强引用 box 到落定。
/// 两个信号谁先到谁算，只落定一次：播放完成回调，和「首块出声时刻 + 总样本数 / 采样率」的定时器
/// （块比实时快得多地按序排入，所以这个估计是准的；回调若失灵也有它兜底）。
final class MTSpeechChunkBox {
    private let player: AVAudioPlayerNode
    private let rate: Double
    var ttsStream = "tts"   // §0.4.1 诊断录音：speak() 侧按语言+序号命名（mic 与 tts 区分、多轮不混）
    private var chunks = 0
    private var pending = 0
    private var frames = 0
    private var firstAt: Date?
    private var finished = false
    private var settled = false
    private var onDone: (() -> Void)?
    private let lock = NSLock()
    var onFirst: (() -> Void)?
    var isCancelled: () -> Bool = { false }

    init(player: AVAudioPlayerNode, rate: Double) { self.player = player; self.rate = rate }

    func schedule(_ samples: UnsafePointer<Float>, _ n: Int) {
        guard n > 0, let fmt = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
              let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n)) else { return }
        buf.frameLength = AVAudioFrameCount(n)
        memcpy(buf.floatChannelData![0], samples, n * MemoryLayout<Float>.size)
        // §0.4.1 诊断录音（2026-10-06）：TTS 合成 PCM 的采集点 —— 所有引擎（vits/kokoro/
        // 系统语音）都经这里进播放器。默认关，写失败静默。
        MTDiagAudio.shared.write(ttsStream, buf)
        lock.lock(); chunks += 1; pending += 1; frames += n; let first = chunks == 1; if first { firstAt = Date() }; lock.unlock()
        if first { DispatchQueue.main.async { self.onFirst?() } }
        // 强引用：box 是 speak() 那个队列块里的局部量，generate 一返回它就会被释放 —— 弱引用的回调
        // 与定时器全都打在 nil 上，tts-end 永远不发（2026-09-12 真机抓到：tts-start 有、tts-end 无）。
        // 回调持有它到播放结束为止，之后随之释放，不泄漏。
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { _ in self.played() }
    }

    private func settle() {
        lock.lock(); let go = !settled && finished; if go { settled = true }; let cb = onDone; lock.unlock()
        if go { DispatchQueue.main.async { cb?() } }
    }
    private func played() {
        lock.lock(); pending -= 1; let done = finished && pending <= 0; lock.unlock()
        if done { settle() }
    }

    func finish(_ done: @escaping () -> Void) {
        lock.lock()
        onDone = done; finished = true
        let noAudio = chunks == 0
        let remaining = max(0, Double(frames) / rate - (firstAt.map { Date().timeIntervalSince($0) } ?? 0))
        lock.unlock()
        if noAudio { settle(); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + remaining + 0.15) { self.settle() }   // 同上：强引用
    }
}

// MARK: - 最小 zip 解包（stored / deflate），给离线模型包用
//
// Foundation 没有解 zip 的 API；模型包一个 60 MB 的 onnx + 三百多个 espeak 小文件，逐文件下载不像话。
// 这里只认 zip 的中央目录（名字、方法、压缩/原始大小、本地头偏移），deflate 用系统的 Compression
// 框架（raw deflate = COMPRESSION_ZLIB 的 buffer 接口）。不认加密、不认 zip64 —— 模型包不需要。
import Compression

enum MTZip {
    struct Entry { let name: String; let method: UInt16; let compSize: Int; let size: Int; let offset: Int }
    enum Err: Error { case bad(String) }

    static func extract(_ data: Data, into dir: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        for e in try entries(data) {
            // 防 zip-slip：条目名不许跳出目录
            let clean = e.name.split(separator: "/").filter { $0 != ".." && $0 != "." && !$0.isEmpty }.joined(separator: "/")
            guard !clean.isEmpty else { continue }
            let dst = dir.appendingPathComponent(clean)
            if e.name.hasSuffix("/") { try fm.createDirectory(at: dst, withIntermediateDirectories: true); continue }
            try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
            let body = try payload(data, e)
            try body.write(to: dst, options: .atomic)
        }
    }

    private static func u16(_ d: Data, _ i: Int) -> Int { Int(d[i]) | (Int(d[i + 1]) << 8) }
    private static func u32(_ d: Data, _ i: Int) -> Int { u16(d, i) | (u16(d, i + 2) << 16) }

    static func entries(_ d: Data) throws -> [Entry] {
        // End of central directory：从尾部找签名 0x06054b50
        var eocd = -1
        var i = d.count - 22
        let stop = max(0, d.count - 22 - 65_536)
        while i >= stop { if u32(d, i) == 0x06054b50 { eocd = i; break }; i -= 1 }
        guard eocd >= 0 else { throw Err.bad("eocd") }
        let count = u16(d, eocd + 10), cdOff = u32(d, eocd + 16)
        var out: [Entry] = []
        var p = cdOff
        for _ in 0..<count {
            guard p + 46 <= d.count, u32(d, p) == 0x02014b50 else { throw Err.bad("cdir") }
            let method = UInt16(u16(d, p + 10)), comp = u32(d, p + 20), size = u32(d, p + 24)
            let nlen = u16(d, p + 28), xlen = u16(d, p + 30), clen = u16(d, p + 32), off = u32(d, p + 42)
            guard p + 46 + nlen <= d.count, let name = String(data: d.subdata(in: (p + 46)..<(p + 46 + nlen)), encoding: .utf8) else { throw Err.bad("name") }
            out.append(Entry(name: name, method: method, compSize: comp, size: size, offset: off))
            p += 46 + nlen + xlen + clen
        }
        return out
    }

    static func payload(_ d: Data, _ e: Entry) throws -> Data {
        guard e.offset + 30 <= d.count, u32(d, e.offset) == 0x04034b50 else { throw Err.bad("local") }
        let nlen = u16(d, e.offset + 26), xlen = u16(d, e.offset + 28)
        let start = e.offset + 30 + nlen + xlen
        guard start + e.compSize <= d.count else { throw Err.bad("range") }
        let raw = d.subdata(in: start..<(start + e.compSize))
        if e.method == 0 { return raw }
        guard e.method == 8 else { throw Err.bad("method") }
        if e.size == 0 { return Data() }
        var out = Data(count: e.size)
        let n = out.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) -> Int in
            raw.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Int in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, e.size,
                                          src.bindMemory(to: UInt8.self).baseAddress!, raw.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard n == e.size else { throw Err.bad("inflate") }
        return out
    }
}

/// 下载委托：进度按字节比例回调；完成时把临时文件挪到自己的位置再落定（回调返回后系统就删它）。
/// 后台可续传的下载器（2026-10-04，真机 -1005 之后）。
///
/// 为什么不是「起一个一次性会话、下完就丢」：那个会话活在调用栈里，App 一挂起就被冻住 ——
/// 真机上最小化 + 断网收场是 `NSURLErrorDomain -1005`，而 UserInfo 里**明明带着 11862 字节的
/// `NSURLSessionDownloadTaskResumeData`**，我们却既没用它、也没给用户留出路（停在一个失败态等人再点）。
///
/// 所以：① **background** 配置的会话 —— 传输由系统守护进程代跑，App 挂起/被回收都不影响；
/// ② 失败先留 **resume data**，再按退避**自动重试**（只有网络类才重试：校验不过、HTTP 4xx 重试一万次也一样）；
/// ③ 重试期间**不动界面**（不发明细、也不报失败）⇒ 用户看到的是「还在下」。
///
/// 不往界面送任何错误原文 —— 只送协议码（见 `mtdlCode`），人话由 JS 用既有 i18n 键拼。
final class MTBackgroundDownloader: NSObject, URLSessionDownloadDelegate {
    static let shared = MTBackgroundDownloader()

    private struct Job {
        let url: URL
        let progress: (Double) -> Void
        let completion: (Result<URL, Error>) -> Void
        let attempt: Int
    }

    private var jobs: [Int: Job] = [:]
    private let q = DispatchQueue(label: "mt.speech.download")
    private var session: URLSession!

    /// 重试节奏：2s / 5s / 15s / 60s / 120s，之后每 5 分钟，最多 20 次（≈ 100 分钟）。
    /// 为什么给这么长：这两个包是**首启硬门**，而网络中断常是过隧道/切网，几十秒就回来。
    private static let backoff: [TimeInterval] = [2, 5, 15, 60, 120]
    private static let maxAttempts = 20

    private override init() {
        super.init()
        let cfg = URLSessionConfiguration.background(withIdentifier: "com.belliedmonkeytranslator.mt-speech.download")
        cfg.isDiscretionary = false          // 「蜂窝也行，你自己定」⇒ 不等 Wi-Fi
        cfg.sessionSendsLaunchEvents = true
        cfg.waitsForConnectivity = true      // 系统等到网络回来自动继续，不必我们轮询
        cfg.timeoutIntervalForResource = 3600
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }

    func fetch(_ url: URL, progress: @escaping (Double) -> Void) async throws -> URL {
        try await withCheckedThrowingContinuation { c in
            q.async {
                self.start(url, attempt: 0, resumeData: nil, progress: progress) { r in c.resume(with: r) }
            }
        }
    }

    private func start(_ url: URL, attempt: Int, resumeData: Data?, progress: @escaping (Double) -> Void,
                       completion: @escaping (Result<URL, Error>) -> Void) {
        let task: URLSessionDownloadTask
        if let rd = resumeData, !rd.isEmpty {
            task = session.downloadTask(withResumeData: rd)   // ← 断点续传：接着下，不从零开始
        } else {
            task = session.downloadTask(with: url)
        }
        jobs[task.taskIdentifier] = Job(url: url, progress: progress, completion: completion, attempt: attempt)
        task.resume()
    }

    private func settle(_ task: URLSessionTask, _ r: Result<URL, Error>) {
        var job: Job?
        q.sync { job = jobs.removeValue(forKey: task.taskIdentifier) }
        job?.completion(r)
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        var p: ((Double) -> Void)?
        q.sync { p = jobs[downloadTask.taskIdentifier]?.progress }
        guard totalBytesExpectedToWrite > 0, let p else { return }
        p(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        if let h = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            settle(downloadTask, .failure(URLError(.badServerResponse))); return
        }
        let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do { try FileManager.default.moveItem(at: location, to: keep); settle(downloadTask, .success(keep)) }
        catch { settle(downloadTask, .failure(error)) }
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        var job: Job?
        q.sync { job = jobs[task.taskIdentifier] }
        guard let job else { return }
        guard mtdlRetryable(error), job.attempt + 1 < Self.maxAttempts else {
            settle(task, .failure(error)); return
        }
        // 手边的 resume data —— 真机上就是这个字段带着 11862 字节，以前被我们丢掉了。
        let rd = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        let n = job.attempt + 1
        let delay = (n - 1) < Self.backoff.count ? Self.backoff[n - 1] : 300
        q.asyncAfter(deadline: .now() + delay) {
            self.q.sync { _ = self.jobs.removeValue(forKey: task.taskIdentifier) }
            self.start(job.url, attempt: n, resumeData: rd, progress: job.progress) { r in job.completion(r) }
        }
    }
}

/// 可重试的失败：网络类。校验不过、HTTP 4xx 这类重试没有意义（重试一万次也一样）。
private func mtdlRetryable(_ error: Error) -> Bool {
    let e = error as NSError
    guard e.domain == NSURLErrorDomain else { return false }
    switch e.code {
    case NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet,
         NSURLErrorTimedOut, NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost,
         NSURLErrorDataNotAllowed, NSURLErrorSecureConnectionFailed,
         NSURLErrorDNSLookupFailed, NSURLErrorInternationalRoamingOff:
        return true
    default: return false
    }
}

/// 识别器装配失败 ⇒ **协议码**。`SFSpeechErrorDomain Code=11` 是「locale 分配超上限」（每 App 5 个），
/// 与网络无关 —— 真机上被拼进「离线模型下载失败…多半是网络问题」是误报（2026-10-07 批 28）。
private func mtPrepareCode(_ error: Error) -> String {
    let e = error as NSError
    if e.domain == "SFSpeechErrorDomain", e.code == 11 { return "locales" }
    return "analyzer"
}

/// 下载失败 ⇒ **协议码**（不是文案、也不是系统原文）。人话由 JS 用既有 i18n 键拼。
private func mtdlCode(_ error: Error) -> String {
    let e = error as NSError
    guard e.domain == NSURLErrorDomain else { return "load" }
    switch e.code {
    case NSURLErrorCannotDecodeContentData:
        return "sha"                       // 我校验对不上（download() 里自己抛的）
    case NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet,
         NSURLErrorTimedOut, NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost,
         NSURLErrorDataNotAllowed, NSURLErrorDNSLookupFailed, NSURLErrorInternationalRoamingOff:
        return "offline"
    case NSURLErrorBadServerResponse, NSURLErrorBadURL, NSURLErrorUnsupportedURL:
        return "http"
    default:
        return "load"
    }
}

// MARK: - 语种识别（LID，§9.6.1.3，2026-10-07）

/// 端上 LID：sherpa-onnx 的 SLID（whisper tiny）。听译里「这段是哪门语言」由它判 ——
/// **取代手写文字系 / 置信度那套规则**（那条路在「两路识别器都给同一段音频两种解读」时没有判据）。
/// 同一段麦克风 PCM（`micSink`）顺手喂进来，逐句判定，把语言码发给 JS（`lid-result {lang}`）。
/// 模型与 TTS 同一条下载/校验通道（sha256 钉住），落在 Application Support/mt-lid/<dir>/。
#if canImport(SherpaOnnx)
final class MTDeviceLid {
    static let shared = MTDeviceLid()
    var emit: (([String: Any]) -> Void)?

    private struct Model {
        let dir: String
        let encoder: String
        let decoder: String
        let files: [(path: String, url: String, sha256: String, size: Int)]
    }
    private var models: [Model] = []
    private var slid: SherpaOnnxSpokenLanguageIdentificationWrapper?
    private let q = DispatchQueue(label: "mt.lid")
    private var buf: [Float] = []                 // 本句累计的 16k 单声道
    private let maxSamples = 16000 * 20           // 只留最近 20s（模型也只用 <30s）
    private var conv: AVAudioConverter?
    private var lastLive = 0.0        // 上一次「边说边判」的时刻
    private var lastLang = ""         // 上一次判出的语言（变了才发 lid-live）
    private var sawSpeech = false     // 本句累计里有没有过话音（静音不判）
    private var quietRun = 0          // 连续没话音的样本数（超过阈值就不再累计）
    private let fmt16 = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)
    private var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("mt-lid", isDirectory: true)
    }

    private func parse(_ v: Any?) -> [Model] {
        guard let list = v as? [[String: Any]] else { return [] }
        return list.compactMap { m in
            guard let dir = m["dir"] as? String, let enc = m["encoder"] as? String, let dec = m["decoder"] as? String else { return nil }
            let fs = (m["files"] as? [[String: Any]] ?? []).compactMap { f -> (String, String, String, Int)? in
                guard let p = f["path"] as? String, let u = f["url"] as? String, let s = f["sha256"] as? String else { return nil }
                return (p, u, s, (f["size"] as? Int) ?? 0)
            }
            return Model(dir: dir, encoder: enc, decoder: dec, files: fs)
        }
    }
    private func installed(_ m: Model) -> Bool {
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        let fm = FileManager.default
        for f in m.files where f.path.hasSuffix(".zip") {
            guard fm.fileExists(atPath: d.appendingPathComponent(".installed-" + f.sha256.lowercased()).path) else { return false }
        }
        return !m.files.isEmpty
            && fm.fileExists(atPath: d.appendingPathComponent(m.encoder).path)
            && fm.fileExists(atPath: d.appendingPathComponent(m.decoder).path)
    }

    func probe(models v: Any?) {
        models = parse(v)
        emit?(["type": "assets-progress", "kind": "lid", "locale": "lid", "fraction": models.contains(where: installed) ? 1 : 0,
               "state": models.contains(where: installed) ? "installed" : "missing"])
        emit?(["type": "lid-state", "state": models.contains(where: installed) ? "ready" : "assets"])
        load()
    }

    /// 逐文件下载 + sha256 校验（与 `MTDeviceSpeech.download` 同一形状）。
    func install(models v: Any?) {
        models = parse(v)
        Task {
            for m in models where !installed(m) {
                let d = root.appendingPathComponent(m.dir, isDirectory: true)
                var done = 0
                let total = max(m.files.reduce(0) { $0 + $1.size }, 1)
                for f in m.files {
                    do {
                        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                        guard let url = URL(string: f.url) else { throw URLError(.badURL) }
                        let before = done
                        var lastEmit = 0.0
                        let tmp = try await MTDeviceSpeech.fetch(url) { [weak self] frac in
                            let now = Date().timeIntervalSince1970
                            guard now - lastEmit >= 0.25 else { return }
                            lastEmit = now
                            let fraction = (Double(before) + frac * Double(f.size)) / Double(total)
                            DispatchQueue.main.async { self?.emit?(["type": "assets-progress", "kind": "lid", "locale": "lid", "fraction": fraction, "state": "downloading"]) }
                        }
                        let data = try Data(contentsOf: tmp)
                        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                        guard digest == f.sha256.lowercased() else { try? FileManager.default.removeItem(at: tmp); throw URLError(.cannotDecodeContentData) }
                        try MTZip.extract(data, into: d)
                        try? FileManager.default.removeItem(at: tmp)
                        FileManager.default.createFile(atPath: d.appendingPathComponent(".installed-" + f.sha256.lowercased()).path, contents: Data())
                        done += f.size
                        emit?(["type": "assets-progress", "kind": "lid", "locale": "lid", "fraction": Double(done) / Double(total), "state": "downloading"])
                    } catch {
                        emit?(["type": "assets-progress", "kind": "lid", "locale": "lid", "fraction": 0, "state": "failed", "reason": mtdlCode(error)])
                        emit?(["type": "lid-state", "state": "failed"])
                        return
                    }
                }
                emit?(["type": "assets-progress", "kind": "lid", "locale": "lid", "fraction": 1, "state": "installed"])
            }
            emit?(["type": "lid-state", "state": "ready"])
            load()
        }
    }

    /// 建 SLID（模型装好了才有；幂等）。
    func load() {
        guard slid == nil, let m = models.first(where: installed) else { return }
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        let w = sherpaOnnxSpokenLanguageIdentificationWhisperConfig(
            encoder: d.appendingPathComponent(m.encoder).path,
            decoder: d.appendingPathComponent(m.decoder).path)
        var c = sherpaOnnxSpokenLanguageIdentificationConfig(whisper: w)
        slid = SherpaOnnxSpokenLanguageIdentificationWrapper(config: &c)
    }

    func reset() { q.async { [weak self] in
        self?.buf.removeAll(keepingCapacity: true)
        self?.lastLang = ""
        self?.lastLive = 0
        self?.sawSpeech = false
        self?.quietRun = 0
    } }

    /// 麦克风 PCM（tap 的原生格式）→ 16k 单声道 Float32。
    /// **必须在 tap 线程里调用**：`bufIn` 与转换缓冲都只在这个回调里有效，所以这里直接把样本拷成数组。
    func pcm16(_ bufIn: AVAudioPCMBuffer) -> [Float]? {
        guard let t = fmt16, bufIn.frameLength > 0 else { return nil }
        if conv == nil || conv?.inputFormat != bufIn.format { conv = AVAudioConverter(from: bufIn.format, to: t) }
        guard let c = conv else { return nil }
        let cap = AVAudioFrameCount(Double(bufIn.frameLength) * t.sampleRate / max(1, bufIn.format.sampleRate)) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: t, frameCapacity: cap) else { return nil }
        var err: NSError?
        var consumed = false
        c.convert(to: out, error: &err) { _, st in
            if consumed { st.pointee = .noDataNow; return nil }
            consumed = true; st.pointee = .haveData; return bufIn
        }
        guard err == nil, out.frameLength > 0, let ch = out.floatChannelData else { return nil }
        return [Float](UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
    }

    /// 喂一段 16k 单声道。`speech` 由 VAD 判（拿不到 VAD 时退化为能量门）；
    /// **`pcm` 必须已经在 tap 线程上拷好**（见 `pcm16`）。
    /// **只累计话音**：把静音/房间噪声一起累计进去会把 whisper SLID 的判词带跑
    /// （实测：10 s 噪声 + 7 s 泰语 ⇒ `sq`；只喂话音 ⇒ `th`）。
    func feed(_ pcm: [Float], speech: Bool) {
        guard !pcm.isEmpty else { return }
        q.async { [weak self] in
            guard let self, let slid = self.slid else { return }
            let chunk = pcm
            if speech { self.quietRun = 0 } else { self.quietRun += chunk.count }
            guard speech || self.quietRun <= 4000 else { return }   // 停顿 >0.25 s 就不再累计（话音尾巴留一点）
            self.buf.append(contentsOf: chunk)
            if self.buf.count > self.maxSamples { self.buf.removeFirst(self.buf.count - self.maxSamples) }
            if speech { self.sawSpeech = true }
            // 边说边判（半句要归属就得在**本句进行中**知道语言）：**≥2s 才有话音才判**，语言变了才发。
            // 为什么是 2s 不是 1s：12 门真语音实测（scripts/lid-eval-real.py，2026-10-07）
            // **1s 只有 50%**、2s 83%、3s 83%、5s 92%、整段 100% —— 1s 的判词基本是掷硬币，
            // 而判错一次就会让错语言那一路的半句上屏（正是要根治的那件事）。宁可晚 1s。
            let now = Date().timeIntervalSince1970
            guard self.buf.count >= 32000, self.sawSpeech, now - self.lastLive >= 1.0 else { return }
            self.lastLive = now
            let lang = slid.decode(samples: self.buf, sampleRate: 16000).lang
            if lang != self.lastLang {
                self.lastLang = lang
                DispatchQueue.main.async { self.emit?(["type": "lid-live", "lang": lang]) }
            }
        }
    }

    /// 一句结束（与识别器 `finalize(through:)` 同一时刻）：判一次语言发给 JS。
    func finish() {
        q.async { [weak self] in
            guard let self else { return }
            let samples = self.buf
            self.buf.removeAll(keepingCapacity: true)      // 不论判不判，本句到此为止
            self.lastLive = Date().timeIntervalSince1970
            self.sawSpeech = false
            self.quietRun = 0
            guard let slid = self.slid, samples.count >= 8000 else { self.lastLang = ""; return }   // <0.5s 不判
            let lang = slid.decode(samples: samples, sampleRate: 16000).lang
            self.lastLang = lang          // 下一句的 live 从这句的结论起步（同语言不再重复报）
            DispatchQueue.main.async { self.emit?(["type": "lid-result", "lang": lang, "ms": samples.count / 16]) }
        }
    }
}
#endif

// MARK: - 语音活动检测（VAD，2026-10-07）

/// silero VAD：判「这一段到底是不是人在说话」。听译里只用它做一件事 —— **只把话音喂给 LID**。
/// 为什么需要它（2026-10-07 真泰语多人对谈实测）：演播室背景乐 + 多人交叠 + 低电平的音频上，
/// whisper SLID 的判词会在十几门语言之间乱跳（`zh→th→ko→fr→ja→es→la→ru→ur…`），而判错一次就让
/// 错语言那一路的定稿上屏（实测出 `那你你给我们也不` / `乌克兰。` 这种中文垃圾行）。
/// **拿不到它不影响听译**：`accept` 会退回调用方给的能量门判据（原来的行为）。
#if canImport(SherpaOnnx)
final class MTDeviceVad {
    static let shared = MTDeviceVad()
    var emit: (([String: Any]) -> Void)?

    private struct Model {
        let dir: String
        let model: String
        let files: [(path: String, url: String, sha256: String, size: Int)]
    }
    private var models: [Model] = []
    private var vad: OpaquePointer?
    private var pending: [Float] = []          // 不足一个窗的尾巴
    private var lastSpeech = 0.0
    private let window = 512                   // silero 的固定窗（16k）
    private let hangover: Double = 0.6         // 说完 0.6s 内仍算「在人声里」（留给 LID 语尾）
    private var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("mt-vad", isDirectory: true)
    }

    private func parse(_ v: Any?) -> [Model] {
        guard let list = v as? [[String: Any]] else { return [] }
        return list.compactMap { m in
            guard let dir = m["dir"] as? String, let model = m["model"] as? String else { return nil }
            let fs = (m["files"] as? [[String: Any]] ?? []).compactMap { f -> (String, String, String, Int)? in
                guard let p = f["path"] as? String, let u = f["url"] as? String, let s = f["sha256"] as? String else { return nil }
                return (p, u, s, (f["size"] as? Int) ?? 0)
            }
            return Model(dir: dir, model: model, files: fs)
        }
    }
    private func installed(_ m: Model) -> Bool {
        let fm = FileManager.default
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        for f in m.files {
            let p = d.appendingPathComponent(f.path)
            guard let a = try? fm.attributesOfItem(atPath: p.path), (a[.size] as? Int) == f.size else { return false }
        }
        return fm.fileExists(atPath: d.appendingPathComponent(m.model).path)
    }

    func probe(models v: Any?) {
        models = parse(v)
        let ok = models.contains(where: installed)
        emit?(["type": "assets-progress", "kind": "vad", "locale": "vad", "fraction": ok ? 1 : 0, "state": ok ? "installed" : "missing"])
        emit?(["type": "vad-state", "state": ok ? "ready" : "assets"])
        load()
    }

    /// 单文件下载 + sha256 校验（与 LID 同形，但它是一个普通文件，不是 zip）。
    func install(models v: Any?) {
        models = parse(v)
        Task {
            for m in models where !installed(m) {
                let d = root.appendingPathComponent(m.dir, isDirectory: true)
                for f in m.files {
                    do {
                        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                        guard let url = URL(string: f.url) else { throw URLError(.badURL) }
                        var lastEmit = 0.0
                        let tmp = try await MTDeviceSpeech.fetch(url) { [weak self] frac in
                            let now = Date().timeIntervalSince1970
                            guard now - lastEmit >= 0.25 else { return }
                            lastEmit = now
                            DispatchQueue.main.async { self?.emit?(["type": "assets-progress", "kind": "vad", "locale": "vad", "fraction": frac, "state": "downloading"]) }
                        }
                        let data = try Data(contentsOf: tmp)
                        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                        guard digest == f.sha256.lowercased() else { try? FileManager.default.removeItem(at: tmp); throw URLError(.cannotDecodeContentData) }
                        let dst = d.appendingPathComponent(f.path)
                        try? FileManager.default.removeItem(at: dst)
                        try FileManager.default.moveItem(at: tmp, to: dst)
                    } catch {
                        emit?(["type": "assets-progress", "kind": "vad", "locale": "vad", "fraction": 0, "state": "failed", "reason": mtdlCode(error)])
                        emit?(["type": "vad-state", "state": "failed"])
                        return
                    }
                }
                emit?(["type": "assets-progress", "kind": "vad", "locale": "vad", "fraction": 1, "state": "installed"])
            }
            emit?(["type": "vad-state", "state": "ready"])
            load()
        }
    }

    /// 建检测器（幂等）。
    func load() {
        guard vad == nil, let m = models.first(where: installed) else { return }
        let p = root.appendingPathComponent(m.dir, isDirectory: true).appendingPathComponent(m.model).path
        let silero = sherpaOnnxSileroVadModelConfig(model: p, threshold: 0.5, minSilenceDuration: 0.25,
                                                    minSpeechDuration: 0.25, windowSize: 512, maxSpeechDuration: 5.0)
        var c = sherpaOnnxVadModelConfig(sileroVad: silero, sampleRate: 16000, numThreads: 1)
        vad = SherpaOnnxCreateVoiceActivityDetector(&c, 30.0)
    }

    func reset() {
        pending.removeAll(keepingCapacity: true)
        lastSpeech = 0
        if let v = vad { SherpaOnnxVoiceActivityDetectorReset(v) }
    }

    /// tap 线程调用。返回「此刻算不算在人声里」。**没装/没建成 ⇒ 返回调用方的 `fallback`**。
    func accept(_ pcm: [Float], fallback: Bool) -> Bool {
        guard let v = vad else { return fallback }
        pending.append(contentsOf: pcm)
        var i = 0
        while pending.count - i >= window {
            pending.withUnsafeBufferPointer { p in
                SherpaOnnxVoiceActivityDetectorAcceptWaveform(v, p.baseAddress! + i, Int32(window))
            }
            i += window
        }
        if i > 0 { pending.removeFirst(i) }
        // 段队列必须排空：只查 Detected 不排空的话，内部段只涨不落（内存）。
        while SherpaOnnxVoiceActivityDetectorEmpty(v) == 0 {
            if let seg = SherpaOnnxVoiceActivityDetectorFront(v) { SherpaOnnxDestroySpeechSegment(seg) }
            SherpaOnnxVoiceActivityDetectorPop(v)
        }
        let now = Date().timeIntervalSince1970
        let detected = SherpaOnnxVoiceActivityDetectorDetected(v) != 0
        if detected { lastSpeech = now }
        return detected || (now - lastSpeech) < hangover
    }
}
#endif
