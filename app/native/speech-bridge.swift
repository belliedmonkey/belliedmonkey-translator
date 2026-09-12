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

final class MTSpeechBridge: NSObject, WKScriptMessageHandler {

    static let shared = MTSpeechBridge()
    /// 通道名。JS 侧 `window.webkit.messageHandlers.mtSpeech` 与 sync-app-assets.js 的 install 行同一个字符串。
    static let channel = "mtSpeech"

    private weak var webView: WKWebView?
    private var transcriber: AnyObject?          // MTDeviceTranscriber（iOS 26+ 才有，所以按 AnyObject 存）
    private let speech = MTDeviceSpeech()

    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: MTSpeechBridge.channel)
        ucc.add(self, name: MTSpeechBridge.channel)
        speech.emit = { [weak self] in self?.emit($0) }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "stt-probe":  sttProbe(locales: strings(body["locales"]))
        case "stt-assets": sttAssets(locales: strings(body["locales"]))
        case "stt-start":  sttStart(body)
        case "stt-stop":   sttStop()
        case "tts-probe":  speech.probe(models: body["models"])
        case "tts-assets": speech.download(models: body["models"])
        case "tts-speak":  speech.speak(body)
        case "tts-stop":   speech.stop()
        default: break
        }
    }

    private func strings(_ v: Any?) -> [String] { (v as? [Any])?.compactMap { $0 as? String } ?? [] }

    // MARK: - 转写

    private func sttProbe(locales: [String]) {
        guard #available(iOS 26.0, macOS 26.0, *) else {
            emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
        }
        Task {
            guard SpeechTranscriber.isAvailable else {
                self.emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
            }
            var allInstalled = true
            for id in locales {
                let t = SpeechTranscriber(locale: Locale(identifier: id), preset: .transcription)
                let st = await AssetInventory.status(forModules: [t])
                switch st {
                case .unsupported:
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "unsupported"])
                    self.emit(["type": "stt-state", "state": "unsupported", "reason": "locale"])
                    return
                case .installed:
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 1, "state": "installed"])
                default:
                    allInstalled = false
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "missing"])
                }
            }
            self.emit(["type": "stt-state", "state": "ready", "assets": allInstalled ? "installed" : "missing"])
        }
    }

    private func sttAssets(locales: [String]) {
        guard #available(iOS 26.0, macOS 26.0, *) else {
            emit(["type": "stt-state", "state": "unsupported", "reason": "os"]); return
        }
        Task {
            for id in locales {
                let t = SpeechTranscriber(locale: Locale(identifier: id), preset: .transcription)
                do {
                    guard let req = try await AssetInventory.assetInstallationRequest(supporting: [t]) else {
                        self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 1, "state": "installed"]); continue
                    }
                    let p = req.progress
                    let watcher = Task {
                        var last = -1.0
                        while !Task.isCancelled {
                            let f = p.fractionCompleted
                            if f != last { last = f; self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": f, "state": "downloading"]) }
                            try? await Task.sleep(nanoseconds: 500_000_000)
                        }
                    }
                    try await req.downloadAndInstall()
                    watcher.cancel()
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 1, "state": "installed"])
                } catch {
                    self.emit(["type": "assets-progress", "kind": "stt", "locale": id, "fraction": 0, "state": "failed", "reason": String(describing: error)])
                    return
                }
            }
            self.emit(["type": "stt-state", "state": "ready", "assets": "installed"])
        }
    }

    private func sttStart(_ body: [String: Any]) {
        sttStop()
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
        guard let t = transcriber else { return }
        transcriber = nil
        if #available(iOS 26.0, macOS 26.0, *), let dt = t as? MTDeviceTranscriber { dt.stop() }
        emit(["type": "stt-state", "state": "ended"])
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
    private var readers: [Task<Void, Never>] = []
    private var converter: AVAudioConverter?
    private var format: AVAudioFormat?
    private var fed: Int64 = 0
    private var quietFrames: Int64 = 0
    private var spokeSinceFinalize = false
    private var stopped = false

    init(locales: [String], vadMs: Double, vadLevel: Double) {
        self.locales = locales; self.vadMs = vadMs; self.vadLevel = vadLevel
    }

    func start() {
        Task {
            var mods: [SpeechTranscriber] = []
            for id in locales {
                let t = SpeechTranscriber(locale: Locale(identifier: id), transcriptionOptions: [],
                                          reportingOptions: [.volatileResults, .fastResults, .alternativeTranscriptions],
                                          attributeOptions: [.audioTimeRange, .transcriptionConfidence])
                if await AssetInventory.status(forModules: [t]) != .installed {
                    emit?(["type": "stt-state", "state": "failed", "reason": "assets"]); return
                }
                mods.append(t)
            }
            guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: mods) else {
                emit?(["type": "stt-state", "state": "failed", "reason": "format"]); return
            }
            let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
            let an = SpeechAnalyzer(inputSequence: stream, modules: mods, options: nil,
                                    analysisContext: AnalysisContext(), volatileRangeChangedHandler: nil)
            do { try await an.prepareToAnalyze(in: fmt) } catch {
                emit?(["type": "stt-state", "state": "failed", "reason": String(describing: error)]); return
            }
            if stopped { return }
            analyzer = an; continuation = cont; format = fmt
            for (i, t) in mods.enumerated() {
                let id = locales[i]
                readers.append(Task { [weak self] in
                    do {
                        for try await r in t.results { self?.deliver(id, r) }
                    } catch {
                        self?.emit?(["type": "stt-state", "state": "failed", "reason": String(describing: error)])
                    }
                })
            }
            MTAudioBridge.shared.micSink = { [weak self] buf in self?.feed(buf) }
            emit?(["type": "stt-state", "state": "ready"])
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

    /// 由 MTAudioBridge 的 tap 线程调用：转格式、喂 analyzer、顺手做静音检测。
    private func feed(_ buffer: AVAudioPCMBuffer) {
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
        // 静音检测（在原生格式上算，不管它是 Float32 还是 Int16）
        let rms = MTAudioBridge.rms(buffer)
        if rms > vadLevel { quietFrames = 0; spokeSinceFinalize = true }
        else { quietFrames += Int64(buffer.frameLength) }
        if spokeSinceFinalize, Double(quietFrames) / buffer.format.sampleRate * 1000 >= vadMs {
            spokeSinceFinalize = false
            let through = CMTime(value: fed, timescale: CMTimeScale(fmt.sampleRate))
            Task { try? await an.finalize(through: through) }
        }
    }

    func stop() {
        stopped = true
        MTAudioBridge.shared.micSink = nil
        continuation?.finish()
        let an = analyzer
        analyzer = nil; continuation = nil
        let rs = readers; readers = []
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
            return Model(lang: lang, dir: dir, model: model, tokens: tokens, dataDir: dataDir, files: fs)
        }
    }

    private func installed(_ m: Model) -> Bool {
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        for f in m.files {
            let p = d.appendingPathComponent(f.path)
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: p.path),
                  (attrs[.size] as? Int) == f.size else { return false }
        }
        return !m.files.isEmpty
    }

    func probe(models v: Any?) {
        let list = parse(v)
        for m in list { models[m.lang] = m }
#if canImport(SherpaOnnx)
        let langs = list.filter { installed($0) }.map { $0.lang }
        for m in list {
            emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": installed(m) ? 1 : 0, "state": installed(m) ? "installed" : "missing"])
        }
        emit?(["type": "tts-state", "state": langs.count == list.count && !list.isEmpty ? "ready" : "assets", "langs": langs])
#else
        emit?(["type": "tts-state", "state": "failed", "reason": "no-engine", "langs": []])
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
                        let tmp = try await MTDeviceSpeech.fetch(url)
                        let data = try Data(contentsOf: tmp)
                        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                        guard digest == f.sha256.lowercased() else { try? FileManager.default.removeItem(at: tmp); throw URLError(.cannotDecodeContentData) }
                        try? FileManager.default.removeItem(at: dst)
                        try FileManager.default.moveItem(at: tmp, to: dst)
                        done += f.size
                        emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": Double(done) / Double(total), "state": "downloading"])
                    } catch {
                        try? FileManager.default.removeItem(at: d)
                        emit?(["type": "assets-progress", "kind": "tts", "locale": m.lang, "fraction": 0, "state": "failed", "reason": String(describing: error)])
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

    /// 回调式下载包成 async：`URLSession.download(from:)` 的 async 版要 macOS 12，而 App 的 macOS
    /// 部署目标是 10.15。回调里的临时文件在回调返回后就被删，所以先挪走再落定。
    static func fetch(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { c in
            let task = URLSession.shared.downloadTask(with: url) { tmp, resp, err in
                if let err { c.resume(throwing: err); return }
                guard let tmp else { c.resume(throwing: URLError(.badServerResponse)); return }
                if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) { c.resume(throwing: URLError(.badServerResponse)); return }
                let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                do { try FileManager.default.moveItem(at: tmp, to: keep); c.resume(returning: keep) } catch { c.resume(throwing: error) }
            }
            task.resume()
        }
    }

    private func loadedLangs() -> [String] { models.values.filter { installed($0) }.map { $0.lang }.sorted() }

    func speak(_ body: [String: Any]) {
        guard let id = body["id"] as? String, let text = body["text"] as? String, let lang = body["lang"] as? String else { return }
        let rate = (body["rate"] as? Double) ?? 1.0
#if canImport(SherpaOnnx)
        guard let m = models[lang], installed(m) else { emit?(["type": "tts-failed", "id": id, "reason": "lang"]); return }
        cancelled = false
        currentId = id
        queue.async { [self] in
            let tts: SherpaOnnxOfflineTtsWrapper
            if let t = loaded[lang] { tts = t } else {
                let d = root.appendingPathComponent(m.dir, isDirectory: true)
                let vits = sherpaOnnxOfflineTtsVitsModelConfig(
                    model: d.appendingPathComponent(m.model).path,
                    tokens: d.appendingPathComponent(m.tokens).path,
                    dataDir: d.appendingPathComponent(m.dataDir).path)
                let model = sherpaOnnxOfflineTtsModelConfig(vits: vits, numThreads: 2)
                var cfg = sherpaOnnxOfflineTtsConfig(model: model, maxNumSentences: 1)
                let t = SherpaOnnxOfflineTtsWrapper(config: &cfg)
                guard t.tts != nil else { DispatchQueue.main.async { self.emit?(["type": "tts-failed", "id": id, "reason": "load"]) }; return }
                loaded[lang] = t; tts = t
            }
            let sampleRate = Double(tts.sampleRate)
            let player: AVAudioPlayerNode
            do { player = try self.ensurePlayer(rate: sampleRate) } catch {
                DispatchQueue.main.async { self.emit?(["type": "tts-failed", "id": id, "reason": String(describing: error)]) }; return
            }
            let box = MTSpeechChunkBox(player: player, rate: sampleRate)
            box.onFirst = { [weak self] in self?.emit?(["type": "tts-start", "id": id]) }
            box.isCancelled = { [weak self] in self?.cancelled ?? true }
            let cb: TtsCallbackWithArg = { samples, n, arg in
                let b = Unmanaged<MTSpeechChunkBox>.fromOpaque(arg!).takeUnretainedValue()
                if b.isCancelled() { return 0 }
                if let samples { b.schedule(samples, Int(n)) }
                return 1
            }
            let ptr = Unmanaged.passUnretained(box).toOpaque()
            let audio = tts.generateWithCallbackWithArg(text: text, callback: cb, arg: ptr, sid: 0, speed: Float(rate))
            _ = audio.audio.pointee.n
            box.finish { [weak self] in
                guard let self, self.currentId == id else { return }
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

/// 一次合成的块调度器：块一到就排进 playerNode；最后一块播完才算 tts-end。
final class MTSpeechChunkBox {
    private let player: AVAudioPlayerNode
    private let rate: Double
    private var chunks = 0
    private var pending = 0
    private var finished = false
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
        lock.lock(); chunks += 1; pending += 1; let first = chunks == 1; lock.unlock()
        if first { DispatchQueue.main.async { self.onFirst?() } }
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in self?.played() }
    }

    private func played() {
        lock.lock(); pending -= 1; let done = finished && pending <= 0; lock.unlock()
        if done { DispatchQueue.main.async { self.onDone?() } }
    }

    func finish(_ done: @escaping () -> Void) {
        lock.lock(); onDone = done; finished = true; let already = pending <= 0; lock.unlock()
        if already { DispatchQueue.main.async { done() } }
    }
}
