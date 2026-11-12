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
        let setURL = URL(fileURLWithPath: args[setIdx + 1])
        let outURL = URL(fileURLWithPath: args[outIdx + 1])
        let statusURL = statusOutURL(args)
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        do {
            let data = try Data(contentsOf: setURL)
            let set = try JSONDecoder().decode(SetFile.self, from: data)
            let locales = try assetLocales(set)
            try await prepareAssets(locales: locales, install: install, statusURL: statusURL)
            if install {
                try? FileManager.default.removeItem(at: outURL)
                return 0
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
            let keep = stage.underlyingCode == "speech-assets-not-installed" || stage.underlyingCode == "unsupported-locale"
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

    static func transcribe(url: URL, locale: Locale, sampleId: String, statusURL: URL?) async throws -> String {
        let localeId = locale.identifier(.bcp47)
        let file = try await stage("audio-open", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            try AVAudioFile(forReading: url)
        }
        let speech = speechModule(locale)
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
            if let t = module as? SpeechTranscriber {
                var last = ""
                for try await result in t.results {
                    if result.isFinal { last = String(result.text.characters) }
                }
                return last
            }
            if let t = module as? DictationTranscriber {
                var last = ""
                for try await result in t.results {
                    if result.isFinal { last = String(result.text.characters) }
                }
                return last
            }
            return ""
        }
        let fed: Int64 = try await stage("convert", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
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
            var fed: Int64 = 0
            while true {
                try file.read(into: inBuf)
                if inBuf.frameLength == 0 { break }
                let cap = AVAudioFrameCount(Double(inBuf.frameLength) * fmt.sampleRate / file.processingFormat.sampleRate) + 16
                guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else {
                    throw NSError(domain: "product-asr", code: 5, userInfo: [
                        NSLocalizedDescriptionKey: "output buffer unavailable",
                    ])
                }
                var consumed = false
                var err: NSError?
                converter.convert(to: out, error: &err) { _, status in
                    if consumed { status.pointee = .noDataNow; return nil }
                    consumed = true
                    status.pointee = .haveData
                    return inBuf
                }
                if let err { throw err }
                if out.frameLength == 0 { continue }
                cont.yield(AnalyzerInput(buffer: out, bufferStartTime: CMTime(value: fed, timescale: CMTimeScale(fmt.sampleRate))))
                fed += Int64(out.frameLength)
            }
            cont.finish()
            return fed
        }
        try await stage("analyzer-finish", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            let through = CMTime(value: fed, timescale: CMTimeScale(fmt.sampleRate))
            try await analyzer.finalize(through: through)
        }
        return try await stage("result-consume", locale: localeId, sampleId: sampleId, statusURL: statusURL) {
            let text = try await reader.value
            if text.isEmpty {
                throw NSError(domain: "product-asr", code: 3, userInfo: [NSLocalizedDescriptionKey: "empty final"])
            }
            return text
        }
    }
}
