// scripts/lid-eval-coreml.swift — Core ML 语种识别模型的真语音准确率矩阵（Mac，2026-10-07）。
//
// 为什么单独一支：`scripts/lid-eval-real.py` 走 sherpa-onnx（whisper 系），而候补模型
// **SpeechBrain ECAPA VoxLingua107（Core ML，40.8MB）** 在 Python 侧装不进 coremltools
// （官方发布的是没有 Manifest.json 的 ML Program），所以改成 Swift 直跑 —— 顺带把 mel 前端
// 逐字从官方 `frontend.py` 搬成 Swift（**必须逐值对过**：同一段音频 Python `11.283154` /
// Swift `11.283152`，对完才敢信评测）。
//
// 结论（2026-10-07，15 条真语音）：VoxLingua107 明显差于现用的 whisper-tiny
// （1s 40% / 2s 67% / 3s 73% / 整段 73%，而 tiny 是 50/83/83/100）⇒ **不换**。
// 细节与另外两个「评估陷阱」见 docs/learning-design.md §9.6.1.3。
//
// 用法（先按 README 把 .mlmodelc 与 labels.json / frontend.py 放到同一目录）：
//   swift scripts/lid-eval-coreml.swift <dir>/SpeechBrainECAPAVoxLingua107.mlmodelc --norm \
//     --windows 1,2,3,5,8,0 .local/lid-real/*_16k.wav
//   `--norm` 是**必须的**：图里已带句子级均值归一这一层……不，graph 里的那一层与前端里的
//   `sentence_mean_normalize` 只能有一个 —— 实测要把前端算出的归一化特征喂进去才对得上，
//   也就是说图里那一层是对 **SpeechBrain 自己那套** 的等价实现，别重复归一。
//   `--mel <wav> --2s [--norm]` 只打印 mel（CSV），用来与 Python 参考实现对拍。
import Foundation
import Accelerate
import CoreML
//   swift .local/lid-coreml/lidcheck.swift .local/lid-real/*_16k.wav
import Foundation
import Accelerate
import CoreML

// ── 前端（逐字对应 frontend.py）────────────────────────────────────────────────
let SR = 16000, N_FFT = 400, HOP = 160, N_MELS = 60

func periodicHamming(_ n: Int) -> [Float] {
    (0..<n).map { i in 0.54 - 0.46 * cos(2 * Float.pi * Float(i) / Float(n)) }
}

func speechbrainFilterbank(_ nMel: Int) -> [Float] {   // [N_FFT/2+1, nMel] 行主序
    func hzToMel(_ v: Float) -> Float { 2595 * log10(1 + v / 700) }
    func melToHz(_ v: Float) -> Float { 700 * (pow(10, v / 2595) - 1) }
    let lo = hzToMel(0), hi = hzToMel(Float(SR) / 2)
    var points = [Float](repeating: 0, count: nMel + 2)
    for i in 0...nMel + 1 { points[i] = lo + (hi - lo) * Float(i) / Float(nMel + 1) }
    let hz = points.map(melToHz)
    let centers = Array(hz[1..<(nMel + 1)])
    var bands = [Float](repeating: 0, count: nMel)
    for i in 0..<nMel { bands[i] = hz[i + 1] - hz[i] }
    let bins = N_FFT / 2 + 1
    var fb = [Float](repeating: 0, count: bins * nMel)
    for f in 0..<bins {
        let freq = Float(SR / 2) * Float(f) / Float(bins - 1)
        for m in 0..<nMel {
            let slope = (freq - centers[m]) / bands[m]
            fb[f * nMel + m] = max(0, min(slope + 1, -slope + 1))
        }
    }
    return fb
}

/// cos/sin 表：[bins, N_FFT]，用于把 DFT 变成点积。
let COS_T = (0..<(N_FFT / 2 + 1)).map { k in
    (0..<N_FFT).map { n in cos(-2 * Float.pi * Float(k) * Float(n) / Float(N_FFT)) }
}
let SIN_T = (0..<(N_FFT / 2 + 1)).map { k in
    (0..<N_FFT).map { n in sin(-2 * Float.pi * Float(k) * Float(n) / Float(N_FFT)) }
}

func computeFbank(_ audio: [Float]) -> [[Float]] {
    let win = periodicHamming(N_FFT)
    let fb = speechbrainFilterbank(N_MELS)
    let bins = N_FFT / 2 + 1
    let pad = N_FFT / 2
    var padded = [Float](repeating: 0, count: pad)
    padded.append(contentsOf: audio)
    padded.append(contentsOf: [Float](repeating: 0, count: pad))
    let frames = padded.count >= N_FFT ? (padded.count - N_FFT) / HOP + 1 : 0
    var out = [[Float]](repeating: [Float](repeating: 0, count: N_MELS), count: frames)
    var frame = [Float](repeating: 0, count: N_FFT)
    var power = [Float](repeating: 0, count: bins)
    var mel = [Float](repeating: 0, count: N_MELS)
    var globalMax: Float = -1e30
    for t in 0..<frames {
        let start = t * HOP
        for i in 0..<N_FFT { frame[i] = padded[start + i] * win[i] }
        for k in 0..<bins {
            var re: Float = 0, im: Float = 0
            COS_T[k].withUnsafeBufferPointer { c in frame.withUnsafeBufferPointer { x in vDSP_dotpr(x.baseAddress!, 1, c.baseAddress!, 1, &re, vDSP_Length(N_FFT)) } }
            SIN_T[k].withUnsafeBufferPointer { s in frame.withUnsafeBufferPointer { x in vDSP_dotpr(x.baseAddress!, 1, s.baseAddress!, 1, &im, vDSP_Length(N_FFT)) } }
            power[k] = re * re + im * im
        }
        for m in 0..<N_MELS {
            var acc: Float = 0
            for k in 0..<bins { acc += power[k] * fb[k * N_MELS + m] }
            let db = 10 * log10(max(acc, 1e-10))
            mel[m] = db
            if db > globalMax { globalMax = db }
        }
        out[t] = mel
    }
    let floor = globalMax - 80
    for t in 0..<frames { for m in 0..<N_MELS { if out[t][m] < floor { out[t][m] = floor } } }
    // 句子级均值归一：README 说**图里已经带了**这一层 ⇒ 默认不再自己做（用 --norm 才做）。
    if doNorm, frames > 0 {
        var mean = [Float](repeating: 0, count: N_MELS)
        for t in 0..<frames { for m in 0..<N_MELS { mean[m] += out[t][m] } }
        for m in 0..<N_MELS { mean[m] /= Float(frames) }
        for t in 0..<frames { for m in 0..<N_MELS { out[t][m] -= mean[m] } }
    }
    return out
}

// ── WAV（16-bit PCM 单声道）────────────────────────────────────────────────────
func readWav16(_ path: String) -> [Float]? {
    guard let d = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    var pos = 12, dataRange: Range<Int>? = nil
    var channels = 1, bits = 16
    while pos + 8 <= d.count {
        let id = String(bytes: d[pos..<(pos + 4)], encoding: .ascii) ?? ""
        var size = 0
        withUnsafeMutableBytes(of: &size) { _ = d.copyBytes(to: $0, from: pos + 4..<pos + 8) }
        if id == "fmt " { channels = Int(d[pos + 10]) | (Int(d[pos + 11]) << 8); bits = Int(d[pos + 22]) | (Int(d[pos + 23]) << 8) }
        if id == "data" { dataRange = (pos + 8)..<min(pos + 8 + size, d.count) }
        pos += 8 + size + (size % 2)
    }
    guard let r = dataRange, bits == 16, channels >= 1 else { return nil }
    let n = r.count / 2 / channels
    var out = [Float](repeating: 0, count: n)
    d.withUnsafeBytes { raw in
        let p = raw.baseAddress!.advanced(by: r.lowerBound).assumingMemoryBound(to: Int16.self)
        for i in 0..<n { out[i] = Float(p[i * channels]) / 32768 }
    }
    return out
}

// ── 跑 ──────────────────────────────────────────────────────────────────────
let args = Array(CommandLine.arguments.dropFirst())
let doNorm = args.contains("--norm")   // 图里已带归一 ⇒ 默认不自己做
// --mel <wav>：把 mel 打出来（CSV），用于与 Python 参考实现逐值对拍
if let mi = args.firstIndex(of: "--mel"), mi + 1 < args.count {
    guard let x = readWav16(args[mi + 1]) else { print("read fail"); exit(1) }
    let n = min(x.count, args.contains("--2s") ? 32000 : x.count)
    let mel = computeFbank(Array(x[0..<n]))
    print("frames=\(mel.count)")
    for t in stride(from: 0, to: mel.count, by: max(1, mel.count / 3)) {
        print(mel[t].map { String(format: "%.6f", $0) }.joined(separator: ","))
    }
    exit(0)
}
let modelDir = args.first(where: { $0.hasSuffix(".mlmodelc") }) ?? ""
let wavs = args.filter { $0.hasSuffix(".wav") }
let labelsURL = URL(fileURLWithPath: modelDir).deletingLastPathComponent().appendingPathComponent("labels.json")
let labels = (try? JSONSerialization.jsonObject(with: Data(contentsOf: labelsURL))) as? [[String: Any]] ?? []
var codeById = [Int: String]()
for l in labels { if let id = l["id"] as? Int, let c = l["code"] as? String { codeById[id] = c } }

let cfg = MLModelConfiguration()
cfg.computeUnits = .all
let model: MLModel
do { model = try MLModel(contentsOf: URL(fileURLWithPath: modelDir), configuration: cfg) }
catch { FileHandle.standardError.write("✗ 装载失败: \(error)\n".data(using: .utf8)!); exit(1) }
print("模型装载 ✓ 输入 \(model.modelDescription.inputDescriptionsByName.keys.sorted())")

func lid(_ samples: [Float]) -> String {
    var mel = computeFbank(samples)                       // [frames, 60]
    if mel.count > 3001 { mel = Array(mel[0..<3001]) }     // 模型上限 3001 帧（≈30s）
    let frames = mel.count
    guard frames >= 10 else { return "-" }                 // 模型最少 10 帧
    do {
        let arr = try MLMultiArray(shape: [1, NSNumber(value: frames), NSNumber(value: N_MELS)], dataType: .float32)
        for t in 0..<frames { for m in 0..<N_MELS { arr[[NSNumber(value: 0), NSNumber(value: t), NSNumber(value: m)]] = NSNumber(value: mel[t][m]) } }
        let inName = model.modelDescription.inputDescriptionsByName.keys.first!
        let outName = model.modelDescription.outputDescriptionsByName.keys.first!
        let pred = try model.prediction(from: try MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(multiArray: arr)]))
        guard let out = pred.featureValue(for: outName)?.multiArrayValue else { return "?" }
        var best = 0, bestV = -Float.greatestFiniteMagnitude
        for i in 0..<out.count { let v = out[i].floatValue; if v > bestV { bestV = v; best = i } }
        return codeById[best] ?? "?\(best)"
    } catch {
        FileHandle.standardError.write("✗ predict \(frames) 帧: \(error)\n".data(using: .utf8)!)
        return "ERR"
    }
}

let win = args.contains("--windows") ? (args[args.firstIndex(of: "--windows")! + 1]) : nil
let wins = (win ?? "1,2,3,5,8,0").split(separator: ",").map { Double($0)! }
print("语言   时长 " + wins.map { $0 == 0 ? "    整段" : String(format: "%6.0fs", $0) }.joined(separator: " "))
var tally: [Double: (Int, Int)] = [:]
for w in wavs {
    guard let x = readWav16(w) else { print("✗ \(w) 读不了"); continue }
    let name = URL(fileURLWithPath: w).lastPathComponent.split(separator: "_")[0]
    var row: [String] = []
    for s in wins {
        let n = s == 0 ? x.count : Int(s * 16000)
        if n > x.count || n < 16000 { row.append("     - "); continue }
        let got = lid(Array(x[0..<n]))
        row.append(String(format: "%7@", got as NSString))
        var t = tally[s] ?? (0, 0)
        t.1 += 1; if got.lowercased() == name.lowercased() { t.0 += 1 }
        tally[s] = t
    }
    print(String(format: "%@ %5.1fs ", name as NSString, Double(x.count) / 16000) + row.joined(separator: " "))
}
for s in wins {
    guard let t = tally[s], t.1 > 0 else { continue }
    print(String(format: "  %@: %d/%d = %.1f%%", (s == 0 ? "整段" : String(format: "%.0fs", s)) as NSString, t.0, t.1, Double(t.0) / Double(t.1) * 100))
}
