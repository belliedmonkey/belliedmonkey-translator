// Eval-only file feed for the Apple SpeechAnalyzer arm used by the app.
// run-product-asr.js launches this only after it has checked wav hashes and
// macOS >= 26. It is not the app process and it does not run e1_b1.
//
// Module options match MTDeviceTranscriber.makeModule in speech-bridge.swift:
// SpeechTranscriber(locale:transcriptionOptions:[] reportingOptions:
//   [.volatileResults, .fastResults, .alternativeTranscriptions]
//   attributeOptions:[.audioTimeRange, .transcriptionConfidence])
// falling back to DictationTranscriber(locale:preset:.progressiveLongDictation).
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
        let setURL = URL(fileURLWithPath: args[setIdx + 1])
        let outURL = URL(fileURLWithPath: args[outIdx + 1])
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        do {
            let data = try Data(contentsOf: setURL)
            let set = try JSONDecoder().decode(SetFile.self, from: data)
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
            let msg = String(describing: error).replacingOccurrences(of: "\"", with: "'")
            fputs("{\"ok\":false,\"code\":\"sa-file-failed\",\"productMetric\":false,\"hypotheses\":null,\"detail\":\"\(msg)\"}\n", stderr)
            return 2
        }
    }

    static func transcribe(url: URL, locale: Locale) async throws -> String {
        let file = try AVAudioFile(forReading: url)
        let speech = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults, .fastResults, .alternativeTranscriptions],
            attributeOptions: [.audioTimeRange, .transcriptionConfidence])
        let status = await AssetInventory.status(forModules: [speech])
        let module: any SpeechModule
        if status == .installed {
            module = speech
        } else {
            let dict = DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
            let dictStatus = await AssetInventory.status(forModules: [dict])
            guard dictStatus == .installed else {
                throw NSError(domain: "product-asr", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "speech assets not installed",
                ])
            }
            module = dict
        }
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
        let converter = AVAudioConverter(from: file.processingFormat, to: fmt)
        let inBuf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096)!
        var fed: Int64 = 0
        while true {
            try file.read(into: inBuf)
            if inBuf.frameLength == 0 { break }
            let cap = AVAudioFrameCount(Double(inBuf.frameLength) * fmt.sampleRate / file.processingFormat.sampleRate) + 16
            guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { break }
            var consumed = false
            var err: NSError?
            converter.convert(to: out, error: &err) { _, status in
                if consumed { status.pointee = .noDataNow; return nil }
                consumed = true
                status.pointee = .haveData
                return inBuf
            }
            if err != nil || out.frameLength == 0 { break }
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
