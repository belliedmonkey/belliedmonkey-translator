// app/native/e1-sensevoice.swift — BEL-19 E1 SenseVoice VAD 最小接线（SPEC-E1 2026-10-25）
//
// 唯一分叉：RecognizerFactory.make(lane:, arm:)；默认臂仍是 SA（MTDeviceTranscriber）。
// B1 = SA partial + SenseVoice final，原生合并后仍走 stt-partial / stt-final。
// VAD 锁死 sil0.5_thr0.3_max8（只锁 SV 定稿前 silero；LID 门 MTDeviceVad 默认不改）。
// Release 也接受显式 e1_b1（默认仍 sa；用户路径由设置开关决定）。失败回退 SA + e1_fallback_reason 封闭枚举。
// ensureReady 接下行（MTBackgroundDownloader + sha + MTZip）；中继无包/未下完 ⇒ 回退 SA。

import Foundation
import AVFoundation
import CryptoKit
#if canImport(SherpaOnnx)
import SherpaOnnx
import SherpaOnnxC
#endif

// MARK: - VAD 参数锁（单测钉：test/e1-sensevoice.test.js）

enum MTE1VadLock {
    static let armName = "sil0.5_thr0.3_max8"
    static let minSilenceDuration: Float = 0.5
    static let threshold: Float = 0.3
    static let maxSpeechDuration: Float = 8.0
    static let minSpeechDuration: Float = 0.25
    static let windowSize: Int = 512
    static let sampleRate: Int32 = 16000
}

// MARK: - 臂 / 回退原因（封闭枚举；遥测无自由文本）

enum MTE1Arm: String {
    case sa
    case e1_b1
}

enum MTE1FallbackReason: String {
    case modelNotReady = "model_not_ready"
    case modelShaMismatch = "model_sha_mismatch"
    case downloadFailed = "download_failed"
    case loadFailed = "load_failed"
    case initTimeout = "init_timeout"
    case oom = "oom"
    case svNoFinalTimeout = "sv_no_final_timeout"
    case svEmptyFinals = "sv_empty_finals"
    case sherpaUnavailable = "sherpa_unavailable"
}

// MARK: - RecognizerFactory（SPEC §3.1 唯一分叉）

@available(iOS 26.0, macOS 26.0, *)
enum RecognizerFactory {
    /// 显式 `e1_b1` 即接受（Release 亦然）；`nil` / 其它一律 `sa`。默认 sa，用户路径由设置开关决定。
    static func resolveArm(_ raw: String?) -> MTE1Arm {
        if (raw ?? "").lowercased() == MTE1Arm.e1_b1.rawValue { return .e1_b1 }
        return .sa
    }

    /// `lane` = 主识别语言基码（zh / en / …）。非 zh 或 arm=sa ⇒ 现货 SA。
    static func make(lane: String, arm: MTE1Arm,
                     locales: [String], vadMs: Double, vadLevel: Double,
                     senseVoiceModels: Any? = nil) -> AnyObject {
        let base = lane.split(separator: "-").first.map(String.init)?.lowercased() ?? lane.lowercased()
        if arm == .e1_b1 && base == "zh" {
            return MTE1B1Transcriber(locales: locales, vadMs: vadMs, vadLevel: vadLevel,
                                     senseVoiceModels: senseVoiceModels)
        }
        return MTDeviceTranscriber(locales: locales, vadMs: vadMs, vadLevel: vadLevel)
    }
}

// MARK: - SenseVoice 模型宿主（Application Support/mt-sensevoice/）

#if canImport(SherpaOnnx)
final class MTE1SenseVoice {
    static let shared = MTE1SenseVoice()

    private struct Model {
        let dir: String
        let model: String
        let tokens: String
        let files: [(path: String, url: String, sha256: String, size: Int)]
    }

    /// 薄包装：避免 Sherpa Swift 包装在 create 失败时 fatalError。
    private final class Reco {
        let ptr: OpaquePointer
        init(ptr: OpaquePointer) { self.ptr = ptr }
        deinit { SherpaOnnxDestroyOfflineRecognizer(ptr) }
        func decode(samples: [Float], sampleRate: Int = 16000) -> (text: String, lang: String) {
            guard let stream = SherpaOnnxCreateOfflineStream(ptr) else { return ("", "") }
            defer { SherpaOnnxDestroyOfflineStream(stream) }
            samples.withUnsafeBufferPointer { buf in
                guard let base = buf.baseAddress else { return }
                SherpaOnnxAcceptWaveformOffline(stream, Int32(sampleRate), base, Int32(samples.count))
            }
            SherpaOnnxDecodeOfflineStream(ptr, stream)
            guard let r = SherpaOnnxGetOfflineStreamResult(stream) else { return ("", "") }
            defer { SherpaOnnxDestroyOfflineRecognizerResult(r) }
            let text = r.pointee.text.map { String(cString: $0) } ?? ""
            let lang = r.pointee.lang.map { String(cString: $0) } ?? ""
            return (text, lang)
        }
    }

    private var models: [Model] = []
    private var reco: Reco?
    /// 避免 ensureReady 多次进入时并行开多条下载。
    private var downloading = false
    private var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("mt-sensevoice", isDirectory: true)
    }

    private func parse(_ v: Any?) -> [Model] {
        guard let list = v as? [[String: Any]] else { return [] }
        return list.compactMap { m in
            guard let dir = m["dir"] as? String,
                  let model = m["model"] as? String,
                  let tokens = m["tokens"] as? String else { return nil }
            let fs = (m["files"] as? [[String: Any]] ?? []).compactMap { f -> (String, String, String, Int)? in
                guard let p = f["path"] as? String, let u = f["url"] as? String, let s = f["sha256"] as? String else { return nil }
                return (p, u, s, (f["size"] as? Int) ?? 0)
            }
            return Model(dir: dir, model: model, tokens: tokens, files: fs)
        }
    }

    private func installed(_ m: Model) -> Bool {
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        let fm = FileManager.default
        for f in m.files where f.path.hasSuffix(".zip") {
            guard fm.fileExists(atPath: d.appendingPathComponent(".installed-" + f.sha256.lowercased()).path) else { return false }
        }
        return fm.fileExists(atPath: d.appendingPathComponent(m.model).path)
            && fm.fileExists(atPath: d.appendingPathComponent(m.tokens).path)
    }

    /// 同步：清单已装且能建识别器 ⇒ true。失败原因经 `reason` 回传。
    /// 未装时按 LID/TTS 同形踢 `MTBackgroundDownloader` 下载（本会话仍回退 SA；装好后下一会话可再试）。
    /// **禁仅 stamp**：必须真实 fetch + sha256 校验 + `MTZip.extract` 扁平解压后才写 `.installed-<sha>`。
    @discardableResult
    func ensureReady(models v: Any?, reason: inout MTE1FallbackReason?) -> Bool {
        models = parse(v)
        guard let m = models.first else { reason = .modelNotReady; return false }
        if !installed(m) {
            startDownloadIfNeeded(m)
            reason = .modelNotReady
            return false
        }
        if reco != nil { return true }
        let d = root.appendingPathComponent(m.dir, isDirectory: true)
        let sv = sherpaOnnxOfflineSenseVoiceModelConfig(
            model: d.appendingPathComponent(m.model).path,
            language: "zh",
            useInverseTextNormalization: true)
        let modelCfg = sherpaOnnxOfflineModelConfig(
            tokens: d.appendingPathComponent(m.tokens).path,
            numThreads: 2,
            provider: "cpu",
            modelType: "sense_voice",
            senseVoice: sv)
        let feat = sherpaOnnxFeatureConfig()
        var cfg = sherpaOnnxOfflineRecognizerConfig(featConfig: feat, modelConfig: modelCfg)
        guard let ptr = SherpaOnnxCreateOfflineRecognizer(&cfg) else {
            reason = .loadFailed
            return false
        }
        reco = Reco(ptr: ptr)
        return true
    }

    /// 与 `MTDeviceLid.install` / `MTDeviceSpeech.download` 同形：fetch → sha → 暂存解压 → 原子换入 → 写戳。
    private func startDownloadIfNeeded(_ m: Model) {
        guard !downloading else { return }
        downloading = true
        Task {
            defer { downloading = false }
            let d = root.appendingPathComponent(m.dir, isDirectory: true)
            var staging: URL?
            for f in m.files where f.path.hasSuffix(".zip") {
                do {
                    guard let url = URL(string: f.url) else { throw URLError(.badURL) }
                    let tmp = try await MTDeviceSpeech.fetch(url) { _ in }
                    let data = try Data(contentsOf: tmp)
                    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                    guard digest == f.sha256.lowercased() else {
                        try? FileManager.default.removeItem(at: tmp)
                        throw URLError(.cannotDecodeContentData)
                    }
                    let parent = d.deletingLastPathComponent()
                    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
                    let stage = parent.appendingPathComponent(".staging-" + UUID().uuidString, isDirectory: true)
                    staging = stage
                    try MTZip.extract(data, into: stage)
                    FileManager.default.createFile(
                        atPath: stage.appendingPathComponent(".installed-" + f.sha256.lowercased()).path,
                        contents: Data())
                    if FileManager.default.fileExists(atPath: d.path) {
                        try? FileManager.default.removeItem(at: d)
                    }
                    try FileManager.default.moveItem(at: stage, to: d)
                    staging = nil
                    try? FileManager.default.removeItem(at: tmp)
                } catch {
                    if let s = staging { try? FileManager.default.removeItem(at: s) }
                    // 失败不写戳；下次 ensureReady 仍 modelNotReady → 回退 SA（SPEC-E1 §5）
                    return
                }
            }
        }
    }

    func decode(samples: [Float]) -> (text: String, lang: String)? {
        guard let r = reco, !samples.isEmpty else { return nil }
        return r.decode(samples: samples)
    }
}
#endif

// MARK: - SV 定稿前 silero（与 LID 门 MTDeviceVad **分离**；参数锁死）

#if canImport(SherpaOnnx)
final class MTE1SvVad {
    private var vad: OpaquePointer?
    private var pending: [Float] = []
    private let window = MTE1VadLock.windowSize
    /// 段回调：samples + 段起点（以窗计的 sample index，相对本会话送入的累计）
    var onSegment: (([Float], Int) -> Void)?
    private var fedSamples = 0

    /// 用与 LID 相同的 silero 模型文件，但 **另建** 检测器，参数 = E1 锁。
    func load(modelPath: String) -> Bool {
        if vad != nil { return true }
        let silero = sherpaOnnxSileroVadModelConfig(
            model: modelPath,
            threshold: MTE1VadLock.threshold,
            minSilenceDuration: MTE1VadLock.minSilenceDuration,
            minSpeechDuration: MTE1VadLock.minSpeechDuration,
            windowSize: MTE1VadLock.windowSize,
            maxSpeechDuration: MTE1VadLock.maxSpeechDuration)
        var c = sherpaOnnxVadModelConfig(sileroVad: silero, sampleRate: MTE1VadLock.sampleRate, numThreads: 1)
        vad = SherpaOnnxCreateVoiceActivityDetector(&c, 30.0)
        return vad != nil
    }

    func reset() {
        pending.removeAll(keepingCapacity: true)
        fedSamples = 0
        if let v = vad { SherpaOnnxVoiceActivityDetectorReset(v) }
    }

    func accept(_ pcm: [Float]) {
        guard let v = vad, !pcm.isEmpty else { return }
        pending.append(contentsOf: pcm)
        var i = 0
        while pending.count - i >= window {
            pending.withUnsafeBufferPointer { p in
                SherpaOnnxVoiceActivityDetectorAcceptWaveform(v, p.baseAddress! + i, Int32(window))
            }
            i += window
            fedSamples += window
            while SherpaOnnxVoiceActivityDetectorEmpty(v) == 0 {
                if let seg = SherpaOnnxVoiceActivityDetectorFront(v) {
                    let n = Int(seg.pointee.n)
                    let start = Int(seg.pointee.start)
                    let samples = Array(UnsafeBufferPointer(start: seg.pointee.samples, count: n))
                    SherpaOnnxDestroySpeechSegment(seg)
                    SherpaOnnxVoiceActivityDetectorPop(v)
                    onSegment?(samples, start)
                } else {
                    SherpaOnnxVoiceActivityDetectorPop(v)
                }
            }
        }
        if i > 0 { pending.removeFirst(i) }
    }

    deinit {
        if let v = vad { SherpaOnnxDestroyVoiceActivityDetector(v) }
    }
}
#endif

// MARK: - B1 会话：SA partial + SV final

@available(iOS 26.0, macOS 26.0, *)
final class MTE1B1Transcriber {
    var emit: (([String: Any]) -> Void)?
    private let sa: MTDeviceTranscriber
    private let locales: [String]
    // 唯一硬锁：只有 start() 里 SV 根本装不起来才置 true（本会话没有 E1 可能）。
    private var sessionLockedToSa = false
    private var fallbackReason: MTE1FallbackReason?
    private var segSeq = 0
    private var emptyFinalStreak = 0
    private let emptyFinalLimit = 3
    // 软放行（BEL-19 B1 五条锁拆除）：被扣住的 zh SA final 等 SV 定稿等够 svWaitMs 就回放。
    private var svPassthrough = false
    private let svWaitMs: Double = 15.0
    private var pendingSince: Double?                    // 最早一条被扣 SA final 的 systemUptime
    private var pendingSaFinals: [[String: Any]] = []
    private let pendingSaFinalLimit = 32
    private var passthroughReason: MTE1FallbackReason?
    private var passthroughAtFed16k: Int64 = 0           // 进入软放行时的音频位置（land_drop 用）
    private var svFinals = 0
    private var saFinalsSinceSv = 0
    // tap 线程（onPcm16/onSvSegment）与 SA reader 线程（routeSaEvent）共用上面这些状态。
    private let e1Lock = NSLock()
    private var fed16k: Int64 = 0
#if canImport(SherpaOnnx)
    private let svVad = MTE1SvVad()
    private var svModels: Any?
#endif

    init(locales: [String], vadMs: Double, vadLevel: Double, senseVoiceModels: Any?) {
        self.locales = locales
        self.sa = MTDeviceTranscriber(locales: locales, vadMs: vadMs, vadLevel: vadLevel)
#if canImport(SherpaOnnx)
        self.svModels = senseVoiceModels
#endif
    }

    func start() {
        // 尝试武装 SV；失败 ⇒ 本会话锁 SA
        var reason: MTE1FallbackReason?
        let svOk = armSenseVoice(reason: &reason)
        if !svOk {
            sessionLockedToSa = true
            fallbackReason = reason ?? .modelNotReady
            emitFallbackTelemetry()
        }

        sa.emit = { [weak self] payload in
            self?.routeSaEvent(payload)
        }
        sa.pcm16Tap = { [weak self] pcm in
            self?.onPcm16(pcm)
        }
        sa.start()
    }

    func stop() {
        sa.pcm16Tap = nil
        // 说一句就停、不等 15s：先回放被扣住的 SA 定稿，再清 emit（否则最后一句永远丢）。
        flushPendingSaFinals()
        sa.emit = nil
#if canImport(SherpaOnnx)
        svVad.reset()
#endif
        sa.stop()
    }

    func cut() { sa.cut() }

    private func armSenseVoice(reason: inout MTE1FallbackReason?) -> Bool {
#if canImport(SherpaOnnx)
        guard MTE1SenseVoice.shared.ensureReady(models: svModels, reason: &reason) else {
            return false
        }
        // SV-VAD 与 LID 门共用同一 silero **文件**，另建检测器、锁 E1 参数。
        let vadRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("mt-vad", isDirectory: true)
            .appendingPathComponent("silero-vad", isDirectory: true)
            .appendingPathComponent("silero_vad.onnx")
        guard FileManager.default.fileExists(atPath: vadRoot.path),
              svVad.load(modelPath: vadRoot.path) else {
            reason = .modelNotReady
            return false
        }
        svVad.onSegment = { [weak self] samples, startIdx in
            self?.onSvSegment(samples: samples, startIdx: startIdx)
        }
        return true
#else
        reason = .sherpaUnavailable
        return false
#endif
    }

    private func emitFallbackTelemetry() {
        guard let r = fallbackReason else { return }
        emitE1Telemetry(reason: r, phase: "hard", afterMs: 0, svFinals: 0, saFinals: 0)
    }

    /// E1 遥测：封闭枚举 + 计数，零内容。state 不用 "ready" —— 否则会误 fire sttSession 的 ready。
    private func emitE1Telemetry(reason: MTE1FallbackReason, phase: String, afterMs: Int,
                                 svFinals: Int, saFinals: Int, dropped: Int = 0) {
        var body: [String: Any] = [
            "type": "stt-state",
            "state": "e1-fallback",
            "e1_fallback_reason": reason.rawValue,
            "e1_phase": phase,
            "e1_after_ms": max(0, afterMs),
            "e1_sv_finals": svFinals,
            "e1_sa_finals": saFinals,
            "asr_zh": "sa",
        ]
        if dropped > 0 { body["e1_dropped"] = dropped }
        emit?(body)
    }

    private func routeSaEvent(_ payload: [String: Any]) {
        var p = payload
        let typ = p["type"] as? String ?? ""
        let locale = (p["locale"] as? String) ?? ""
        let base = locale.split(separator: "-").first.map(String.init)?.lowercased() ?? ""

        // 非 zh 或已回退：原样（关 E1 ≡ 基线）
        if sessionLockedToSa || base != "zh" {
            emit?(p)
            return
        }

        if typ == "stt-partial" {
            let sid = currentSegId()
            p["seg_id"] = sid
            p["lane"] = "zh"
            p["kind"] = "partial"
            p["range_quality"] = "approx"
            emit?(p)
            return
        }

        if typ == "stt-final" {
            // B1：zh final 默认由 SV 段回调出。SV 迟迟不出定稿时先扣住 SA final；
            // 有文字被扣住的年龄 ≥ svWaitMs 才软放行（不再 5 条整场锁、也不再硬锁）。
            e1Lock.lock()
            saFinalsSinceSv += 1
            e1Lock.unlock()
            // 先给 SV 一次机会（本次 SA final 可能刚好撞上 SV 定稿）；超时才软放行。
            maybeEnterPassthrough()
            e1Lock.lock()
            if svPassthrough {
                e1Lock.unlock()
                emit?(p)  // 软放行出的是 SA 定稿（conf 用 SA 的真实值）
            } else {
                if pendingSaFinals.isEmpty { pendingSince = monoNow() }
                pendingSaFinals.append(p)
                let overflowed = pendingSaFinals.count > pendingSaFinalLimit
                var flushed: [[String: Any]] = []
                if overflowed { flushed = enterPassthroughLocked(.svNoFinalTimeout) }
                let sv = svFinals
                let sa = saFinalsSinceSv
                e1Lock.unlock()
                for q in flushed { emit?(q) }
                if overflowed {
                    emitE1Telemetry(reason: .svNoFinalTimeout, phase: "soft", afterMs: 0,
                                    svFinals: sv, saFinals: sa)
                }
            }
            return
        }
        emit?(p)
    }

    private func currentSegId() -> String {
        "e1-\(segSeq)"
    }

    private func monoNow() -> Double { ProcessInfo.processInfo.systemUptime }

    /// 调用方持 e1Lock。进入软放行：记入口 fed16k（land_drop 用），取走 pending 供锁外 emit。
    private func enterPassthroughLocked(_ reason: MTE1FallbackReason) -> [[String: Any]] {
        guard !svPassthrough else { return [] }
        svPassthrough = true
        passthroughReason = reason
        passthroughAtFed16k = fed16k
        let flushed = pendingSaFinals
        pendingSaFinals.removeAll(keepingCapacity: true)
        pendingSince = nil
        return flushed
    }

    /// 超时入口：从 onPcm16（svVad.accept 之后）调用。
    /// 锚点是「最早一条被扣住的 zh SA final 的年龄」（pendingSince），不是会话开始 ——
    /// 用户先静音 20s 再开口时，第一条 SA final 仍该给 SV 机会。
    private func maybeEnterPassthrough() {
        e1Lock.lock()
        guard !sessionLockedToSa, !svPassthrough, let since = pendingSince else {
            e1Lock.unlock()
            return
        }
        let ageMs = Int((monoNow() - since) * 1000.0)
        guard Double(ageMs) >= svWaitMs * 1000.0 else {
            e1Lock.unlock()
            return
        }
        let flushed = enterPassthroughLocked(.svNoFinalTimeout)
        let sv = svFinals
        let sa = saFinalsSinceSv
        e1Lock.unlock()
        for p in flushed { emit?(p) }  // 锁外 emit：不持锁跨 evaluateJavaScript
        emitE1Telemetry(reason: .svNoFinalTimeout, phase: "soft", afterMs: ageMs,
                        svFinals: sv, saFinals: sa)
    }

    /// 回放被扣住的 SA 定稿：锁内拷贝、锁外 emit（tap / SA reader 两线程共用）。
    private func flushPendingSaFinals() {
        e1Lock.lock()
        let pending = pendingSaFinals
        pendingSaFinals.removeAll(keepingCapacity: true)
        pendingSince = nil
        e1Lock.unlock()
        for p in pending { emit?(p) }
    }

    private func onPcm16(_ pcm: [Float]) {
        e1Lock.lock()
        fed16k += Int64(pcm.count)
        e1Lock.unlock()
#if canImport(SherpaOnnx)
        guard !sessionLockedToSa else { return }
        svVad.accept(pcm)
        // 必须在 accept 之后：本次 accept 若刚好产出 SV 定稿，成功路径已清掉 pending，
        // 不会被误判超时；反过来则短句/说完即停在静音里永远等不到下一次 final。
        maybeEnterPassthrough()
#endif
    }

#if canImport(SherpaOnnx)
    private func onSvSegment(samples: [Float], startIdx: Int) {
        guard !sessionLockedToSa else { return }
        // C5：坏 final（空/全标点）不上屏
        guard let out = MTE1SenseVoice.shared.decode(samples: samples) else {
            noteEmptyFinal()
            return
        }
        let text = sanitize(out.text)
        if text.isEmpty {
            noteEmptyFinal()
            return
        }
        segSeq += 1
        let sid = "e1-\(segSeq)"
        let sr = Double(MTE1VadLock.sampleRate)
        let t0 = Int(Double(startIdx) / sr * 1000.0)
        let t1 = Int(Double(startIdx + samples.count) / sr * 1000.0)

        e1Lock.lock()
        emptyFinalStreak = 0
        let wasPassthrough = svPassthrough
        let passReason = passthroughReason
        let passAt = passthroughAtFed16k
        let sa = saFinalsSinceSv
        svFinals += 1
        let sv = svFinals
        saFinalsSinceSv = 0
        pendingSaFinals.removeAll(keepingCapacity: true)
        pendingSince = nil
        svPassthrough = false
        passthroughReason = nil
        passthroughAtFed16k = 0
        e1Lock.unlock()

        // 用户认的 land_drop（ARCH §5.2）：整段起点落在 passthrough 入口之前 ⇒ 这段音频
        // 已经由软放行的 SA 定稿上屏，丢 SV 定稿，只发 recover，避免重复行。
        if wasPassthrough && startIdx < Int(passAt) {
            emitE1Telemetry(reason: passReason ?? .svNoFinalTimeout, phase: "recover",
                            afterMs: 0, svFinals: sv, saFinals: sa, dropped: 1)
            return
        }
        if wasPassthrough {
            emitE1Telemetry(reason: passReason ?? .svNoFinalTimeout, phase: "recover",
                            afterMs: 0, svFinals: sv, saFinals: sa)
        }

        var payload: [String: Any] = [
            "type": "stt-final",
            "locale": zhLocale(),
            "text": text,
            "conf": 0.9,
            "seg_id": sid,
            "lane": "zh",
            "kind": "final",
            "range_quality": "exact",
            "t0": t0,
            "t1": t1,
        ]
        // engine_lang 仅参考（不进听译去重）
        if !out.lang.isEmpty { payload["engine_lang"] = out.lang }
        emit?(payload)
    }
#endif

    private func noteEmptyFinal() {
        e1Lock.lock()
        emptyFinalStreak += 1
        // 空/全标点 SV 段只软放行（sv_empty_finals）；绝不硬锁，也绝不碰 sessionLockedToSa。
        let hit = emptyFinalStreak >= emptyFinalLimit && !svPassthrough && !sessionLockedToSa
        var flushed: [[String: Any]] = []
        var ageMs = 0
        if hit {
            ageMs = pendingSince.map { Int((monoNow() - $0) * 1000.0) } ?? 0
            flushed = enterPassthroughLocked(.svEmptyFinals)
        }
        let sv = svFinals
        let sa = saFinalsSinceSv
        e1Lock.unlock()
        guard hit else { return }
        for p in flushed { emit?(p) }
        emitE1Telemetry(reason: .svEmptyFinals, phase: "soft", afterMs: ageMs,
                        svFinals: sv, saFinals: sa)
    }

    private func sanitize(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // 全标点 / 空 ⇒ 坏 final
        let letters = t.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || (0x4E00...0x9FFF).contains($0.value) }
        return letters.isEmpty ? "" : t
    }

    private func zhLocale() -> String {
        for loc in locales {
            let b = loc.split(separator: "-").first.map(String.init)?.lowercased() ?? ""
            if b == "zh" { return loc }
        }
        return "zh-CN"
    }
}
