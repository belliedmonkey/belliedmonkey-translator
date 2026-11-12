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
                let text = try await transcribe(url: audio, locale: locale(for: item.config))
                rows.append(["id": item.id, "hypothesis": text])
            }
            let body = try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
            try body.write(to: outURL, options: .atomic)
            return 0
        } catch {
            try? FileManager.default.removeItem(at: outURL)
            fputs(failLine(error, install: install), stderr)
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

    static func failLine(_ error: Error, install: Bool) -> String {
        let fail: AssetFail
        if let known = error as? AssetFail { fail = known }
        else { fail = classify(error, locale: "", attempts: 0) }
        let detail = fail.detail.replacingOccurrences(of: "\"", with: "'")
        return "{\"ok\":false,\"code\":\"\(fail.code)\",\"locale\":\"\(fail.locale)\",\"status\":\"\(fail.status)\",\"attempts\":\(fail.attempts),\"installFlag\":\(install),\"productMetric\":false,\"hypotheses\":null,\"arm\":\"sa\",\"detail\":\"\(detail)\"}\n"
    }

    static func transcribe(url: URL, locale: Locale) async throws -> String {
        let file = try AVAudioFile(forReading: url)
        let speech = speechModule(locale)
        let status = await AssetInventory.status(forModules: [speech])
        guard status == .installed else {
            throw AssetFail(code: "speech-assets-not-installed", locale: locale.identifier(.bcp47), status: statusName(status), detail: "status is not installed", attempts: 0)
        }
        let module: any SpeechModule = speech
        guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
            throw NSError(domain: "product-asr", code: 2, userInfo: [NSLocalizedDescriptionKey: "format"])
        }
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        let analyzer = SpeechAnalyzer(
            inputSequence: stream,
            modules: [module],
            options: nil,
            analysisContext: AnalysisContext(),
            volatileRangeChangedHandler: nil)
        try await analyzer.prepareToAnalyze(in: fmt)
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
        // AVAudioConverter(from:to:) is optional. A nil converter must fail closed.
        // Force-unwrap would abort, and skipping the call would still look like a run.
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
        let through = CMTime(value: fed, timescale: CMTimeScale(fmt.sampleRate))
        try await analyzer.finalize(through: through)
        let text = try await reader.value
        if text.isEmpty {
            throw NSError(domain: "product-asr", code: 3, userInfo: [NSLocalizedDescriptionKey: "empty final"])
        }
        return text
    }
}
