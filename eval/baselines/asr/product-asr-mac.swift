// Eval-only file feed for the Apple SpeechAnalyzer arm used by the app.
// run-product-asr.js launches this only after it has checked wav hashes and
// macOS >= 26. It is not the app process and it does not run e1_b1.
//
// Module options match MTDeviceTranscriber.makeModule in speech-bridge.swift:
// SpeechTranscriber(locale:transcriptionOptions:[] reportingOptions:
//   [.volatileResults, .fastResults, .alternativeTranscriptions]
//   attributeOptions:[.audioTimeRange, .transcriptionConfidence])
// The product can fall back to DictationTranscriber(locale:preset:.progressiveLongDictation).
// This file does not. en-US and zh-CN use SpeechTranscriber only.
// --install-assets calls AssetInventory.assetInstallationRequest(supporting:)
// and downloadAndInstall(). It does not call reserve or release.
// A framework or asset failure exits non-zero and writes no hypothesis file.
import Foundation
import AVFoundation
import CoreMedia
import Speech

struct Item: Decodable {
    let id: String
    let config: String
    let audioCache: String
}

struct SetFile: Decodable {
    let items: [Item]
}

struct AssetFail: Error {
    let code: String
    let locale: String
    let status: String
    let detail: String
    let attempts: Int
}

struct StageFail: Error {
    let stage: String
    let locale: String
    let sampleId: String
    let underlyingCode: String
    let underlying: Error
}

final class TimeBox: @unchecked Sendable {
    var value: CMTime?
}

final class FeedTrace {
    var inputs: [[String: Any]] = []
    var sourceFrames: Int64 = 0
    var sourceSampleRate: Double = 0
    var targetFrames: Int64 = 0
    var targetSampleRate: Double = 0
    var targetChannels: AVAudioChannelCount = 0
    var resultTaskStarted = false
    var resultEventsReceived = 0
    var lastResultEndSeconds: Double?
    var finishRequestedFrame: Int64 = 0
    var exclusiveEndFrame: Int64 = 0
    var finalSegmentCount = 0
    var finalizeReturned = false
    var volatileStartSeconds: Double?
    var volatileEndSeconds: Double?
    var flush: () -> Void = {}
    func noteInput(start: Int64, frames: Int64, rate: Double) {
        let end = start + frames
        inputs.append([
            "startFrame": start,
            "endFrame": end,
            "startSeconds": rate > 0 ? Double(start) / rate : 0,
            "endSeconds": rate > 0 ? Double(end) / rate : 0,
            "frameLength": frames,
        ])
        flush()
    }
    func bumpResult(endSeconds: Double?) {
        resultEventsReceived += 1
        if let endSeconds { lastResultEndSeconds = endSeconds }
        flush()
    }
}

// A SpeechTranscriber.Result is one phrase. Volatile events revise that phrase.
// A final for the same range replaces it. Different ranges stay, in arrival order.
final class SegmentText {
    private var pieces: [(start: Double, end: Double, text: String)] = []
    func note(isFinal: Bool, text: String, start: Double, end: Double) {
        guard isFinal else { return }
        if let idx = pieces.firstIndex(where: { $0.start == start && $0.end == end }) {
            pieces[idx].text = text
        } else {
            pieces.append((start, end, text))
        }
    }
    var text: String { pieces.map(\.text).joined() }
    var finalCount: Int { pieces.count }
}

if #available(macOS 26.0, *) {
    Task {
        let code = await FileASR.run()
        exit(code)
    }
    dispatchMain()
} else {
    fputs("{\"ok\":false,\"code\":\"need-macos-26\",\"productMetric\":false,\"hypotheses\":null}\n", stderr)
    exit(2)
}

@available(macOS 26.0, *)
enum FileASR {
    static func locale(for config: String) -> Locale {
        if config == "cmn_hans_cn" { return Locale(identifier: "zh-CN") }
        if config == "en_us" { return Locale(identifier: "en-US") }
        return Locale(identifier: config)
    }

    static func run() async -> Int32 {
        let args = CommandLine.arguments
        guard let setIdx = args.firstIndex(of: "--set"), setIdx + 1 < args.count,
              let outIdx = args.firstIndex(of: "--out"), outIdx + 1 < args.count else {
            fputs("{\"ok\":false,\"code\":\"usage\",\"productMetric\":false,\"hypotheses\":null}\n", stderr)
            return 2
        }
        let install = args.contains("--install-assets")
        let diagnostic = args.contains("--diagnostic-first")
        var diagnosticPath = ""
        if let pathIdx = args.firstIndex(of: "--diagnostic-path"), pathIdx + 1 < args.count {
            diagnosticPath = args[pathIdx + 1]
        }
        let setURL = URL(fileURLWithPath: args[setIdx + 1])
        let outURL = URL(fileURLWithPath: args[outIdx + 1])
        let statusURL = statusOutURL(args)
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        do {
            let data = try Data(contentsOf: setURL)
            let set = try JSONDecoder().decode(SetFile.self, from: data)
            if diagnostic && args.contains("--diagnostic-prepare-assets") {
                let sentenceId = "en_us/1660/12742373433258665797.wav"
                guard diagnosticPath == "apple-file" || diagnosticPath == "manual",
                      let item = set.items.first(where: { $0.id == sentenceId }) else {
                    fputs("{\"ok\":false,\"code\":\"prepare-assets-requires-one-sentence\",\"hypotheses\":null,\"rates\":null,\"productMetric\":false}\n", stderr)
                    return 2
                }
                try? FileManager.default.removeItem(at: outURL)
                if diagnosticPath == "manual" {
                    return await prepareAndRecognizeManual(item: item, root: root, statusURL: statusURL, args: args)
                }
                return await prepareAndRecognizeOfficial(item: item, root: root, statusURL: statusURL, args: args)
            }
            let chosen = diagnostic ? Array(set.items.prefix(1)) : set.items
            let locales = try assetLocales(SetFile(items: chosen))
            try await prepareAssets(locales: locales, install: install, statusURL: statusURL)
            if install {
                try? FileManager.default.removeItem(at: outURL)
                return 0
            }
            if diagnostic, let item = chosen.first {
                // Diagnostic mode does not write hypotheses.json.
                try? FileManager.default.removeItem(at: outURL)
                if diagnosticPath == "apple-file" {
                    let audio = URL(fileURLWithPath: item.audioCache, relativeTo: root)
                    let row = await officialFileProbe(url: audio, locale: locale(for: item.config), sampleId: item.id, statusURL: statusURL, item: item)
                    writeDiagnostic(statusURL, item: item, paths: [row])
                    return 0
                }
                if diagnosticPath == "manual" {
                    try await writeFirstClipDiagnostic(item: item, root: root, statusURL: statusURL, manualOnly: true)
                    return 0
                }
                fputs("{\"ok\":false,\"code\":\"need-diagnostic-path\",\"hypotheses\":null,\"rates\":null,\"productMetric\":false}\n", stderr)
                return 2
            }
            var rows: [[String: String]] = []
            for item in set.items {
                let audio = URL(fileURLWithPath: item.audioCache, relativeTo: root)
                let text = try await transcribe(url: audio, locale: locale(for: item.config), sampleId: item.id, statusURL: statusURL)
                rows.append(["id": item.id, "hypothesis": text])
            }
            let body = try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
            try body.write(to: outURL, options: .atomic)
            return 0
        } catch {
            try? FileManager.default.removeItem(at: outURL)
            let line = failLine(error, install: install)
            if let statusURL {
                let errURL = statusURL.deletingLastPathComponent().appendingPathComponent("recognition-error.json")
                try? Data(line.utf8).write(to: errURL, options: .atomic)
            }
            fputs(line, stderr)
            return 2
        }
    }

    static func statusOutURL(_ args: [String]) -> URL? {
        guard let idx = args.firstIndex(of: "--status-out"), idx + 1 < args.count else { return nil }
        return URL(fileURLWithPath: args[idx + 1])
    }

    static func assetLocales(_ set: SetFile) throws -> [Locale] {
        var out: [Locale] = []
        for item in set.items {
            let loc = locale(for: item.config)
            let id = loc.identifier(.bcp47)
            guard id == "en-US" || id == "zh-CN" else {
                throw AssetFail(code: "unsupported-locale", locale: item.config, status: "unknown", detail: "only en-US and zh-CN", attempts: 0)
            }
            if !out.contains(where: { $0.identifier(.bcp47) == id }) { out.append(loc) }
        }
        return out
    }

    static func speechModule(_ locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults, .fastResults, .alternativeTranscriptions],
            attributeOptions: [.audioTimeRange, .transcriptionConfidence])
    }

    static func statusName(_ status: AssetInventory.Status) -> String {
        switch status {
        case .installed: return "installed"
        case .supported: return "supported"
        case .unsupported: return "unsupported"
        case .downloading: return "downloading"
        default: return "unknown"
        }
    }

    static func prepareAssets(locales: [Locale], install: Bool, statusURL: URL?) async throws {
        let deadline = Date().addingTimeInterval(15 * 60)
        var rows: [[String: Any]] = []
        for locale in locales {
            let id = locale.identifier(.bcp47)
            let module = speechModule(locale)
            let before = await AssetInventory.status(forModules: [module])
            var row: [String: Any] = [
                "locale": id,
                "before": statusName(before),
                "installed": before == .installed,
                "installRequested": false,
            ]
            rows.append(row)
            writeStatus(statusURL, rows: rows, install: install, state: "checked")
            if before == .installed {
                row["after"] = "installed"
                rows[rows.count - 1] = row
                continue
            }
            if before == .unsupported {
                row["after"] = "unsupported"
                rows[rows.count - 1] = row
                writeStatus(statusURL, rows: rows, install: install, state: "unsupported")
                throw AssetFail(code: "unsupported-locale", locale: id, status: "unsupported", detail: "module will not work with this configuration", attempts: 0)
            }
            if !install {
                writeStatus(statusURL, rows: rows, install: false, state: "missing")
                throw AssetFail(code: "speech-assets-not-installed", locale: id, status: statusName(before), detail: "status is not installed", attempts: 0)
            }
            var attempts = 0
            var last = AssetFail(code: "speech-assets-not-installed", locale: id, status: statusName(before), detail: "status is not installed", attempts: 0)
            while attempts < 2 && Date() < deadline {
                attempts += 1
                row["state"] = "waiting"
                row["attempts"] = attempts
                row["installRequested"] = true
                rows[rows.count - 1] = row
                writeStatus(statusURL, rows: rows, install: true, state: "waiting")
                do {
                    if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                        try await download(request, deadline: deadline, locale: id, attempts: attempts)
                    }
                    let after = await AssetInventory.status(forModules: [module])
                    row["after"] = statusName(after)
                    row["installed"] = after == .installed
                    row["attempts"] = attempts
                    rows[rows.count - 1] = row
                    writeStatus(statusURL, rows: rows, install: true, state: statusName(after))
                    if after == .installed { last = AssetFail(code: "", locale: id, status: "installed", detail: "", attempts: attempts); break }
                    last = AssetFail(code: "speech-assets-not-installed", locale: id, status: statusName(after), detail: "status after request was not installed", attempts: attempts)
                    if after == .unsupported { break }
                } catch let fail as AssetFail {
                    last = fail
                    if fail.code == "asset-download-timeout" || fail.code == "unsupported-locale" || fail.code == "reservation-unavailable" { break }
                } catch {
                    last = classify(error, locale: id, attempts: attempts)
                    if last.code == "unsupported-locale" || last.code == "reservation-unavailable" { break }
                }
            }
            if row["installed"] as? Bool != true {
                row["after"] = row["after"] ?? statusName(before)
                row["attempts"] = attempts
                rows[rows.count - 1] = row
                writeStatus(statusURL, rows: rows, install: true, state: "failed")
                throw last
            }
        }
        writeStatus(statusURL, rows: rows, install: install, state: "installed")
    }

    static func download(_ request: AssetInstallationRequest, deadline: Date, locale: String, attempts: Int) async throws {
        let remaining = deadline.timeIntervalSinceNow
        if remaining <= 0 {
            throw AssetFail(code: "asset-download-timeout", locale: locale, status: "downloading", detail: "15 minute budget exhausted", attempts: attempts)
        }
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await request.downloadAndInstall() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
                throw AssetFail(code: "asset-download-timeout", locale: locale, status: "downloading", detail: "15 minute budget exhausted", attempts: attempts)
            }
            do {
                try await group.next()
            } catch {
                group.cancelAll()
                throw error
            }
            group.cancelAll()
        }
    }

    static func classify(_ error: Error, locale: String, attempts: Int) -> AssetFail {
        let e = error as NSError
        let detail = e.localizedDescription.replacingOccurrences(of: "\"", with: "'")
        if e.domain == "SFSpeechErrorDomain" && e.code == 11 {
            return AssetFail(code: "reservation-unavailable", locale: locale, status: "unknown", detail: detail, attempts: attempts)
        }
        if e.domain == "SFSpeechErrorDomain" && e.code == 4 {
            return AssetFail(code: "unsupported-locale", locale: locale, status: "unsupported", detail: detail, attempts: attempts)
        }
        if e.domain == NSURLErrorDomain {
            return AssetFail(code: "asset-download-failed", locale: locale, status: "unknown", detail: detail, attempts: attempts)
        }
        return AssetFail(code: "asset-install-failed", locale: locale, status: "unknown", detail: detail, attempts: attempts)
    }

    static func writeStatus(_ url: URL?, rows: [[String: Any]], install: Bool, state: String) {
        guard let url else { return }
        let body: [String: Any] = [
            "arm": "sa",
            "component": "apple-speech-analyzer-file",
            "sameProductProcess": false,
            "matchesIntlMacChineseDefaultArm": false,
            "endToEnd": false,
            "productMetric": false,
            "hypotheses": NSNull(),
            "installFlag": install,
            "state": state,
            "downloadBytes": "unknown",
            "permissionPrompt": "unknown",
            "locales": rows,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func isNilObjCError(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == "Foundation._GenericObjCError" && ns.code == 0 && String(describing: error) == "nilError"
    }

    static func redact(_ text: String) -> String {
        let pattern = "(?:/Users/|/home/|file://)\\S+"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return re.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: "<path>")
    }

    static func errorChain(_ error: Error) -> [[String: Any]] {
        var chain: [[String: Any]] = []
        var current: Error? = error
        var depth = 0
        while let e = current, depth < 6 {
            depth += 1
            if let stage = e as? StageFail {
                current = stage.underlying
                continue
            }
            if let asset = e as? AssetFail {
                chain.append([
                    "swiftType": String(reflecting: type(of: asset)),
                    "domain": "product-asr",
                    "code": 0,
                    "description": redact(asset.detail),
                    "userInfo": ["code": asset.code, "status": asset.status],
                ])
                break
            }
            let ns = e as NSError
            var info: [String: Any] = [:]
            for (key, value) in ns.userInfo {
                let name = String(describing: key)
                if name == NSUnderlyingErrorKey { continue }
                if let text = value as? String {
                    info[name] = redact(String(text.prefix(300)))
                } else if let number = value as? NSNumber {
                    info[name] = number
                }
            }
            chain.append([
                "swiftType": String(reflecting: type(of: e)),
                "domain": ns.domain,
                "code": ns.code,
                "description": redact(String(String(describing: e).prefix(500))),
                "userInfo": info,
            ])
            if let next = ns.userInfo[NSUnderlyingErrorKey] as? Error {
                current = next
            } else {
                current = nil
            }
        }
        return chain
    }

    static func failObject(_ error: Error, install: Bool) -> [String: Any] {
        if let stage = error as? StageFail {
            let keep = stage.underlyingCode == "speech-assets-not-installed" || stage.underlyingCode == "unsupported-locale" || stage.underlyingCode == "recognition-timeout"
            return [
                "ok": false,
                "code": keep ? stage.underlyingCode : "recognition-failed",
                "phase": "recognition",
                "stage": stage.stage,
                "locale": stage.locale,
                "sampleId": stage.sampleId,
                "installFlag": install,
                "hypotheses": NSNull(),
                "rates": NSNull(),
                "productMetric": false,
                "arm": "sa",
                "sameProductProcess": false,
                "matchesIntlMacChineseDefaultArm": false,
                "endToEnd": false,
                "permissionPrompt": "unknown",
                "chain": errorChain(stage),
            ]
        }
        if let known = error as? AssetFail {
            return [
                "ok": false,
                "code": known.code,
                "phase": "install",
                "locale": known.locale,
                "status": known.status,
                "attempts": known.attempts,
                "installFlag": install,
                "productMetric": false,
                "hypotheses": NSNull(),
                "rates": NSNull(),
                "arm": "sa",
                "permissionPrompt": "unknown",
                "detail": redact(known.detail),
                "chain": errorChain(known),
            ]
        }
        let wrapped = StageFail(stage: "unspecified", locale: "", sampleId: "", underlyingCode: "", underlying: error)
        return failObject(wrapped, install: install)
    }

    static func failLine(_ error: Error, install: Bool) -> String {
        let obj = failObject(error, install: install)
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else {
            return "{\"ok\":false,\"code\":\"recognition-failed\",\"hypotheses\":null,\"rates\":null,\"productMetric\":false}\n"
        }
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    static func note(_ stage: String, locale: String, sampleId: String, statusURL: URL?) {
        guard let statusURL else { return }
        let url = statusURL.deletingLastPathComponent().appendingPathComponent("recognition-trace.json")
        let body: [String: Any] = [
            "stage": stage,
            "locale": locale,
            "sampleId": sampleId,
            "permissionPrompt": "unknown",
            "hypotheses": NSNull(),
            "rates": NSNull(),
            "productMetric": false,
            "arm": "sa",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func stage<T>(_ name: String, locale: String, sampleId: String, statusURL: URL?, _ body: () async throws -> T) async throws -> T {
        note(name, locale: locale, sampleId: sampleId, statusURL: statusURL)
        do {
            return try await body()
        } catch let fail as StageFail {
            throw fail
        } catch let fail as AssetFail {
            throw StageFail(stage: name, locale: locale, sampleId: sampleId, underlyingCode: fail.code, underlying: fail)
        } catch {
            throw StageFail(stage: name, locale: locale, sampleId: sampleId, underlyingCode: "", underlying: error)
        }
    }

    static func transcribe(url: URL, locale: Locale, sampleId: String, statusURL: URL?, trace: FeedTrace? = nil, speech existing: SpeechTranscriber? = nil) async throws -> String {
        let localeId = locale.identifier(.bcp47)
        let file = try await stage("audio-open", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            try AVAudioFile(forReading: url)
        }
        let speech = existing ?? speechModule(locale)
        let status = try await stage("asset-status", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            await AssetInventory.status(forModules: [speech])
        }
        guard status == .installed else {
            throw StageFail(
                stage: "asset-status",
                locale: localeId,
                sampleId: sampleId,
                underlyingCode: "speech-assets-not-installed",
                underlying: AssetFail(code: "speech-assets-not-installed", locale: localeId, status: statusName(status), detail: "status is not installed", attempts: 0))
        }
        let module: any SpeechModule = speech
        let fmt = try await stage("audio-format", locale: localeId, sampleId: sampleId, statusURL: statusURL) { () -> AVAudioFormat in
            guard let found = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
                throw NSError(domain: "product-asr", code: 2, userInfo: [NSLocalizedDescriptionKey: "format"])
            }
            return found
        }
        note("analyzer-init", locale: localeId, sampleId: sampleId, statusURL: statusURL)
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        let analyzer = SpeechAnalyzer(
            inputSequence: stream,
            modules: [module],
            options: nil,
            analysisContext: AnalysisContext(),
            volatileRangeChangedHandler: nil)
        try await stage("analyzer-prepare", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            try await analyzer.prepareToAnalyze(in: fmt)
        }
        let reader: Task<String, Error> = Task {
            trace?.resultTaskStarted = true
            trace?.flush()
            if let t = module as? SpeechTranscriber {
                let segments = SegmentText()
                for try await result in t.results {
                    trace?.bumpResult(endSeconds: result.range.end.seconds)
                    segments.note(isFinal: result.isFinal, text: String(result.text.characters), start: result.range.start.seconds, end: result.range.end.seconds)
                }
                trace?.finalSegmentCount = segments.finalCount
                return segments.text
            }
            if let t = module as? DictationTranscriber {
                let segments = SegmentText()
                var ordinal = 0.0
                for try await result in t.results {
                    ordinal += 1
                    segments.note(isFinal: result.isFinal, text: String(result.text.characters), start: ordinal, end: ordinal)
                }
                trace?.finalSegmentCount = segments.finalCount
                return segments.text
            }
            return ""
        }
        let lastSampleFrame: Int64 = try await stage("convert", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            // AVAudioConverter(from:to:) is optional. A nil converter must fail closed.
            guard let converter = AVAudioConverter(from: file.processingFormat, to: fmt) else {
                throw NSError(domain: "product-asr", code: 4, userInfo: [
                    NSLocalizedDescriptionKey: "audio converter unavailable",
                ])
            }
            guard let inBuf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096) else {
                throw NSError(domain: "product-asr", code: 5, userInfo: [
                    NSLocalizedDescriptionKey: "input buffer unavailable",
                ])
            }
            trace?.sourceFrames = file.length
            trace?.sourceSampleRate = file.processingFormat.sampleRate
            trace?.targetSampleRate = fmt.sampleRate
            trace?.targetChannels = fmt.channelCount
            var fed: Int64 = 0
            var origin: Int64?
            func deliver(_ out: AVAudioPCMBuffer) {
                let start = fed
                let frames = Int64(out.frameLength)
                if origin == nil { origin = start }
                trace?.noteInput(start: start, frames: frames, rate: fmt.sampleRate)
                cont.yield(AnalyzerInput(buffer: out, bufferStartTime: CMTime(value: start, timescale: CMTimeScale(fmt.sampleRate))))
                fed += frames
            }
            readLoop: while true {
                // AVAudioFile.read returns NO without an NSError once framePosition
                // reaches length. Swift then throws Foundation._GenericObjCError.nilError.
                if file.framePosition >= file.length { break }
                do {
                    try file.read(into: inBuf)
                } catch {
                    if file.framePosition >= file.length && isNilObjCError(error) { break }
                    throw error
                }
                if inBuf.frameLength == 0 { break }
                let cap = AVAudioFrameCount(Double(inBuf.frameLength) * fmt.sampleRate / file.processingFormat.sampleRate) + 16
                guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else {
                    throw NSError(domain: "product-asr", code: 5, userInfo: [
                        NSLocalizedDescriptionKey: "output buffer unavailable",
                    ])
                }
                var consumed = false
                var err: NSError?
                let outputStatus = converter.convert(to: out, error: &err) { _, status in
                    if consumed { status.pointee = .noDataNow; return nil }
                    consumed = true
                    status.pointee = .haveData
                    return inBuf
                }
                if let err { throw err }
                switch outputStatus {
                case .error:
                    throw NSError(domain: "product-asr", code: 6, userInfo: [
                        NSLocalizedDescriptionKey: "audio convert status error without NSError",
                    ])
                case .endOfStream:
                    if out.frameLength > 0 { deliver(out) }
                    break readLoop
                case .haveData, .inputRanDry:
                    if out.frameLength == 0 { continue }
                    deliver(out)
                default:
                    if out.frameLength == 0 { continue }
                    deliver(out)
                }
            }
            cont.finish()
            trace?.targetFrames = fed
            guard fed > 0, let origin else {
                throw NSError(domain: "product-asr", code: 8, userInfo: [
                    NSLocalizedDescriptionKey: "zero-input",
                ])
            }
            let lastSample = origin + fed - 1
            trace?.exclusiveEndFrame = origin + fed
            trace?.finishRequestedFrame = lastSample
            trace?.flush()
            return lastSample
        }
        try await stage("analyzer-finish", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            let through = CMTime(value: lastSampleFrame, timescale: CMTimeScale(fmt.sampleRate))
            trace?.flush()
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { try await analyzer.finalize(through: through) }
                group.addTask {
                    try await Task.sleep(nanoseconds: 45_000_000_000)
                    throw StageFail(
                        stage: "analyzer-finish",
                        locale: localeId,
                        sampleId: sampleId,
                        underlyingCode: "recognition-timeout",
                        underlying: NSError(domain: "product-asr", code: 7, userInfo: [
                            NSLocalizedDescriptionKey: "analyzer-finish exceeded 45s",
                        ]))
                }
                do {
                    try await group.next()
                } catch {
                    group.cancelAll()
                    throw error
                }
                group.cancelAll()
            }
            trace?.finalizeReturned = true
            if let range = await analyzer.volatileRange {
                trace?.volatileStartSeconds = range.start.seconds
                trace?.volatileEndSeconds = range.end.seconds
            }
            trace?.flush()
        }
        return try await stage("result-consume", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            let text = try await reader.value
            if text.isEmpty {
                if trace != nil { return "" }
                throw NSError(domain: "product-asr", code: 3, userInfo: [NSLocalizedDescriptionKey: "empty final"])
            }
            return text
        }
    }

    static func writeFirstClipDiagnostic(item: Item, root: URL, statusURL: URL?, manualOnly: Bool = false) async throws {
        let audio = URL(fileURLWithPath: item.audioCache, relativeTo: root)
        let locale = locale(for: item.config)
        var paths: [[String: Any]] = []
        let manualTrace = FeedTrace()
        var manual: [String: Any] = [
            "feed": "manual-pcm-analyzer-input",
            "notAProductScore": true,
            "notAFullSetScore": true,
            "productMetric": false,
            "hypotheses": NSNull(),
            "rates": NSNull(),
        ]
        manualTrace.flush = {
            manual["sourceFrames"] = manualTrace.sourceFrames
            manual["sourceSampleRate"] = manualTrace.sourceSampleRate
            manual["targetFrames"] = manualTrace.targetFrames
            manual["targetSampleRate"] = manualTrace.targetSampleRate
            manual["targetChannels"] = manualTrace.targetChannels
            manual["inputs"] = manualTrace.inputs
            manual["finishRequestedFrame"] = manualTrace.finishRequestedFrame
            manual["exclusiveEndFrame"] = manualTrace.exclusiveEndFrame
            manual["finalSegmentCount"] = manualTrace.finalSegmentCount
            manual["resultTaskStarted"] = manualTrace.resultTaskStarted
            manual["resultEventsReceived"] = manualTrace.resultEventsReceived
            manual["finalizeReturned"] = manualTrace.finalizeReturned
            if let end = manualTrace.lastResultEndSeconds { manual["lastResultEndSeconds"] = end }
            if let a = manualTrace.volatileStartSeconds { manual["volatileStartSeconds"] = a }
            if let b = manualTrace.volatileEndSeconds { manual["volatileEndSeconds"] = b }
            paths = [manual]
            writeDiagnostic(statusURL, item: item, paths: paths)
        }
        do {
            let text = try await transcribe(url: audio, locale: locale, sampleId: item.id, statusURL: statusURL, trace: manualTrace)
            manual["diagnosticText"] = text
            manual["finalizeReturned"] = true
        } catch {
            manual["error"] = redact(String(describing: error))
            manual["finalizeReturned"] = manualTrace.finalizeReturned
        }
        manualTrace.flush()
        paths = [manual]
        if !manualOnly {
            let official = await officialFileProbe(url: audio, locale: locale, sampleId: item.id, statusURL: statusURL, item: item)
            paths.append(official)
        }
        writeDiagnostic(statusURL, item: item, paths: paths)
    }

    static func writePhase(_ statusURL: URL?, _ phase: String) {
        guard let statusURL else { return }
        let url = statusURL.deletingLastPathComponent().appendingPathComponent("diagnostic-phase.json")
        let body: [String: Any] = ["phase": phase]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func argValue(_ args: [String], _ flag: String) -> String {
        guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return "" }
        return args[idx + 1]
    }

    // Same SpeechTranscriber instance for status, the one install request, and analyzeSequence.
    // Node kills this process. There is no in-process task-group deadline.
    static func prepareAndRecognizeOfficial(item: Item, root: URL, statusURL: URL?, args: [String]) async -> Int32 {
        let locale = locale(for: item.config)
        let speech = speechModule(locale)
        var row: [String: Any] = [
            "feed": "apple-analyzeSequence-file",
            "notAProductScore": true,
            "notAFullSetScore": true,
            "sameProductProcess": false,
            "endToEnd": false,
            "productMetric": false,
            "hypotheses": NSNull(),
            "rates": NSNull(),
            "completeSet": false,
            "success": false,
            "downloadBytes": "unknown",
            "permissionPrompt": "unknown",
            "module": [
                "constructedBy": "speechModule",
                "locale": locale.identifier(.bcp47),
                "transcriptionOptions": "[]",
                "reportingOptions": "volatileResults,fastResults,alternativeTranscriptions",
                "attributeOptions": "audioTimeRange,transcriptionConfidence",
                "preset": NSNull(),
            ],
            "sourceSha256": argValue(args, "--source-sha256"),
            "runtimeKind": argValue(args, "--runtime-kind"),
            "resultTaskStarted": false,
            "resultEventsReceived": 0,
            "finalizeReturned": false,
        ]
        func publish() { writeDiagnostic(statusURL, item: item, paths: [row]) }
        guard locale.identifier(.bcp47) == "en-US" else {
            row["code"] = "unsupported-locale"
            publish()
            return 2
        }
        writePhase(statusURL, "prepare-before")
        let before = await AssetInventory.status(forModules: [speech])
        row["statusBefore"] = statusName(before)
        publish()
        if before == .installed {
            row["installRequest"] = "not-called"
        } else if before == .supported {
            do {
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [speech]) {
                    row["installRequest"] = "downloadAndInstall"
                    try await request.downloadAndInstall()
                } else {
                    row["installRequest"] = "nil"
                }
            } catch {
                row["code"] = "speech-assets-not-installed"
                row["error"] = redact(String(describing: error))
                publish()
                return 2
            }
            let afterRequest = await AssetInventory.status(forModules: [speech])
            row["statusAfterRequest"] = statusName(afterRequest)
            if afterRequest != .installed {
                row["code"] = row["installRequest"] as? String == "nil" ? "nil-request-not-installed" : "speech-assets-not-installed"
                publish()
                return 2
            }
        } else {
            row["code"] = "speech-assets-not-installed"
            row["status"] = statusName(before)
            publish()
            return 2
        }
        let afterPrepare = await AssetInventory.status(forModules: [speech])
        row["statusAfterPrepare"] = statusName(afterPrepare)
        writePhase(statusURL, "prepare-after")
        publish()
        guard afterPrepare == .installed else {
            row["code"] = "speech-assets-not-installed"
            publish()
            return 2
        }
        writePhase(statusURL, "recognize-before")
        let beforeRecognize = await AssetInventory.status(forModules: [speech])
        row["statusBeforeRecognize"] = statusName(beforeRecognize)
        publish()
        do {
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: item.audioCache, relativeTo: root))
            row["sourceFrames"] = file.length
            row["sourceSampleRate"] = file.processingFormat.sampleRate
            let counter = FeedTrace()
            counter.resultTaskStarted = true
            row["resultTaskStarted"] = true
            let analyzer = SpeechAnalyzer(modules: [speech])
            async let pending: String = {
                let segments = SegmentText()
                for try await result in speech.results {
                    counter.bumpResult(endSeconds: result.range.end.seconds)
                    segments.note(isFinal: result.isFinal, text: String(result.text.characters), start: result.range.start.seconds, end: result.range.end.seconds)
                }
                counter.finalSegmentCount = segments.finalCount
                return segments.text
            }()
            if let lastSample = try await analyzer.analyzeSequence(from: file) {
                row["lastSampleSeconds"] = lastSample.seconds
                try await analyzer.finalizeAndFinish(through: lastSample)
                row["finalizeReturned"] = true
            } else {
                await analyzer.cancelAndFinishNow()
                row["code"] = "no-last-sample"
                row["finalizeReturned"] = false
            }
            row["diagnosticText"] = try await pending
            row["resultEventsReceived"] = counter.resultEventsReceived
            row["finalSegmentCount"] = counter.finalSegmentCount
            if let end = counter.lastResultEndSeconds { row["lastResultEndSeconds"] = end }
        } catch {
            row["error"] = redact(String(describing: error))
            publish()
            writePhase(statusURL, "done")
            return 2
        }
        let atEnd = await AssetInventory.status(forModules: [speech])
        row["statusAtEnd"] = statusName(atEnd)
        publish()
        writePhase(statusURL, "done")
        return row["finalizeReturned"] as? Bool == true ? 0 : 2
    }

    // A task group waits for a cancelled child. finalize(through:) does not
    // observe cancellation, so an in-process deadline never reached the next
    // path. This function has no in-process deadline. Node kills the process.
    static func officialFileProbe(url: URL, locale: Locale, sampleId: String, statusURL: URL?, item: Item) async -> [String: Any] {
        var row: [String: Any] = [
            "feed": "apple-analyzeSequence-file",
            "notAProductScore": true,
            "notAFullSetScore": true,
            "sameProductProcess": false,
            "endToEnd": false,
            "productMetric": false,
            "hypotheses": NSNull(),
            "rates": NSNull(),
            "resultTaskStarted": false,
            "resultEventsReceived": 0,
            "finalizeReturned": false,
        ]
        let counter = FeedTrace()
        do {
            let file = try AVAudioFile(forReading: url)
            row["sourceFrames"] = file.length
            row["sourceSampleRate"] = file.processingFormat.sampleRate
            let speech = speechModule(locale)
            let status = await AssetInventory.status(forModules: [speech])
            guard status == .installed else {
                row["error"] = "speech-assets-not-installed"
                row["status"] = statusName(status)
                return row
            }
            counter.resultTaskStarted = true
            row["resultTaskStarted"] = true
            let analyzer = SpeechAnalyzer(modules: [speech])
            let box = TimeBox()
            counter.flush = {
                var partial: [String: Any] = [
                    "feed": "apple-analyzeSequence-file",
                    "notAProductScore": true,
                    "notAFullSetScore": true,
                    "sameProductProcess": false,
                    "endToEnd": false,
                    "productMetric": false,
                    "hypotheses": NSNull(),
                    "rates": NSNull(),
                    "resultTaskStarted": counter.resultTaskStarted,
                    "resultEventsReceived": counter.resultEventsReceived,
                    "finalizeReturned": false,
                ]
                if let end = counter.lastResultEndSeconds { partial["lastResultEndSeconds"] = end }
                writeDiagnostic(statusURL, item: item, paths: [partial])
            }
            counter.flush()
            async let pending: String = {
                let segments = SegmentText()
                for try await result in speech.results {
                    counter.bumpResult(endSeconds: result.range.end.seconds)
                    segments.note(isFinal: result.isFinal, text: String(result.text.characters), start: result.range.start.seconds, end: result.range.end.seconds)
                }
                counter.finalSegmentCount = segments.finalCount
                return segments.text
            }()
            box.value = try await analyzer.analyzeSequence(from: file)
            if let lastSample = box.value {
                row["lastSampleSeconds"] = lastSample.seconds
                try await analyzer.finalizeAndFinish(through: lastSample)
                row["finalizeReturned"] = true
            } else {
                await analyzer.cancelAndFinishNow()
                row["lastSampleSeconds"] = NSNull()
                row["finalizeReturned"] = true
            }
            row["diagnosticText"] = try await pending
            row["resultEventsReceived"] = counter.resultEventsReceived
            row["finalSegmentCount"] = counter.finalSegmentCount
        } catch {
            row["error"] = redact(String(describing: error))
            row["resultTaskStarted"] = counter.resultTaskStarted
            row["resultEventsReceived"] = counter.resultEventsReceived
        }
        return row
    }

    // Same module for the nil-request recheck and the manual PCM finalize.
    // The through time is the last sample. This does not switch to analyzeSequence.
    static func prepareAndRecognizeManual(item: Item, root: URL, statusURL: URL?, args: [String]) async -> Int32 {
        let locale = locale(for: item.config)
        let speech = speechModule(locale)
        let trace = FeedTrace()
        var row: [String: Any] = [
            "feed": "manual-pcm-analyzer-input",
            "notAProductScore": true,
            "notAFullSetScore": true,
            "sameProductProcess": false,
            "endToEnd": false,
            "productMetric": false,
            "hypotheses": NSNull(),
            "rates": NSNull(),
            "completeSet": false,
            "success": false,
            "downloadBytes": "unknown",
            "permissionPrompt": "unknown",
            "module": [
                "constructedBy": "speechModule",
                "locale": locale.identifier(.bcp47),
                "transcriptionOptions": "[]",
                "reportingOptions": "volatileResults,fastResults,alternativeTranscriptions",
                "attributeOptions": "audioTimeRange,transcriptionConfidence",
                "preset": NSNull(),
            ],
            "sourceSha256": argValue(args, "--source-sha256"),
            "runtimeKind": argValue(args, "--runtime-kind"),
            "finalizeReturned": false,
            "finalSegmentCount": 0,
        ]
        func publish() { writeDiagnostic(statusURL, item: item, paths: [row]) }
        guard locale.identifier(.bcp47) == "en-US" else {
            row["code"] = "unsupported-locale"
            publish()
            return 2
        }
        writePhase(statusURL, "prepare-before")
        let before = await AssetInventory.status(forModules: [speech])
        row["statusBefore"] = statusName(before)
        publish()
        if before == .installed {
            row["installRequest"] = "not-called"
        } else if before == .supported {
            do {
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [speech]) {
                    row["installRequest"] = "downloadAndInstall"
                    try await request.downloadAndInstall()
                } else {
                    row["installRequest"] = "nil"
                }
            } catch {
                row["code"] = "speech-assets-not-installed"
                row["error"] = redact(String(describing: error))
                publish()
                return 2
            }
            let afterRequest = await AssetInventory.status(forModules: [speech])
            row["statusAfterRequest"] = statusName(afterRequest)
            if afterRequest != .installed {
                row["code"] = row["installRequest"] as? String == "nil" ? "nil-request-not-installed" : "speech-assets-not-installed"
                publish()
                return 2
            }
        } else {
            row["code"] = "speech-assets-not-installed"
            row["status"] = statusName(before)
            publish()
            return 2
        }
        let afterPrepare = await AssetInventory.status(forModules: [speech])
        row["statusAfterPrepare"] = statusName(afterPrepare)
        writePhase(statusURL, "prepare-after")
        publish()
        guard afterPrepare == .installed else {
            row["code"] = "speech-assets-not-installed"
            publish()
            return 2
        }
        writePhase(statusURL, "recognize-before")
        let beforeRecognize = await AssetInventory.status(forModules: [speech])
        row["statusBeforeRecognize"] = statusName(beforeRecognize)
        publish()
        do {
            let text = try await transcribe(
                url: URL(fileURLWithPath: item.audioCache, relativeTo: root),
                locale: locale,
                sampleId: item.id,
                statusURL: statusURL,
                trace: trace,
                speech: speech)
            row["diagnosticText"] = text
            row["finalizeReturned"] = trace.finalizeReturned
            row["finishRequestedFrame"] = trace.finishRequestedFrame
            row["exclusiveEndFrame"] = trace.exclusiveEndFrame
            row["finalSegmentCount"] = trace.finalSegmentCount
            row["resultEventsReceived"] = trace.resultEventsReceived
            if let end = trace.lastResultEndSeconds { row["lastResultEndSeconds"] = end }
        } catch {
            row["error"] = redact(String(describing: error))
            row["finalizeReturned"] = trace.finalizeReturned
            publish()
            writePhase(statusURL, "done")
            return 2
        }
        let atEnd = await AssetInventory.status(forModules: [speech])
        row["statusAtEnd"] = statusName(atEnd)
        publish()
        writePhase(statusURL, "done")
        return row["finalizeReturned"] as? Bool == true ? 0 : 2
    }

    static func writeDiagnostic(_ statusURL: URL?, item: Item, paths: [[String: Any]]) {
        guard let statusURL else { return }
        let url = statusURL.deletingLastPathComponent().appendingPathComponent("diagnostic-run.json")
        let body: [String: Any] = [
            "schema": "baseline-sa-file-diagnostic.v1",
            "completeSet": false,
            "notAFullSetScore": true,
            "productMetric": false,
            "rates": NSNull(),
            "hypotheses": NSNull(),
            "sameProductProcess": false,
            "endToEnd": false,
            "arm": "sa",
            "sampleId": item.id,
            "paths": paths,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
