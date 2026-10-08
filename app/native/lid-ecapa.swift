// lid-ecapa.swift — 端侧语种识别的**实验引擎**：SpeechBrain ECAPA（VoxLingua107）CoreML。
//
// 为什么有这个（学习设计 §9.6.1.3 的已知缺口）：whisper-tiny 天生偏中文（训练数据中文 23,446 h vs
// 泰语 226 h），短音频上倒向先验大的语言 —— 实测泰语前 1.5–3.3s 被判成 `zh`，中文识别器于是对泰语
// 音频吐一行垃圾（「甜汤萨蛋」）。门限/预热这类后处理修不好。ECAPA 是**专做语种识别**的声学模型：
// 干净朗读语料上 1.0 s 双门 98.3%，实测单次推理 5–15 ms（whisper-tiny 约 290 ms）。
//
// 判法（按调研报告）：**只比用户选的那两门**，取 log 概率之差 LLR；从开口起**累积**音频，
// 每 `judgeMs` 重算一次，|LLR| ≥ `threshold` 才定。0.5 s 的滑窗信息不够（实测 0.5 s 两门都没分开，
// 1.0 s 就分开了）—— 所以"累积"是这条路的要害，不是"窗口"。
//
// 前端必须与模型自带的 `frontend.py` **逐位对齐**（16 kHz、N_FFT=400、hop=160、periodic Hamming、
// SpeechBrain 那个两侧都用下边带的三角滤波、10log10 + max−80 dB 下限）。句级均值归一化在**模型图里**，
// 这里不要再做一遍。Swift 版与 Python 参考在泰/中两条真语音频上 LLR 差 ≤0.01（2026-10-08 实测）。
//
// 这是一条**实验**通路：模型不打进 App 包（与其它模型一样落 Application Support/mt-lid/<dir>/），
// 引擎由清单里的 `engine` 选（默认仍是 whisper），没有任何用户可见文案依赖它。

import Foundation
import Accelerate
import CoreML
import AVFoundation

/// ECAPA 的 log-mel 前端 + 累积判定。线程约定：只在 MTDeviceLid 的串行队列上调用。
final class MTEcapaLid {
    struct Decision {
        let lang: String
        let llr: Float
        let speechSec: Double
    }

    private let SR = 16000
    private let NFFT = 400, HOP = 160, NMELS = 60
    private let NBIN = 201

    private var model: MLModel?
    private var codes: [String] = []          // 索引 → 语言短码（labels.json）
    private var idx: [String: Int] = [:]      // 短码 → 索引
    private var langs: [String] = []          // 用户选的两门（短码）
    private var threshold: Float = 6.0
    private var cpuOnly = false                 // 实验开关：只走 CPU（排查与系统 ASR 抢 ANE/GPU）
    private let judgeMs: Double = 250         // 重算节奏（报告建议 0.25–0.5 s）
    /// **输入窗口只取这几档**（0.5/1.0/2.0/4.0 s，单位：样本）。为什么不是「窗口一直长大」：
    /// CoreML 对**每一个没见过的输入形状**都要重新 plan —— 实测每个新形状冷启动 40–70 ms，
    /// 而每 0.25 s 话音就换一个形状 ⇒ 每 0.25 s 付一次冷启动，App 里实测 CPU 冲到 85–95%
    /// （既不是前端的错也不是模型算得慢：同一形状反复只要 8–38 ms）。四档固定窗口 ⇒ 只有 4 个形状。
    /// 顺带：这四档正是调研报告离线评估用过的窗长（0.5/1.0/1.5/2/3 s 里的几档），可比。
    private let windowCaps: [Int] = [8000, 16000, 32000, 64000]

    // 前端表
    private var hamming = [Float]()
    private var cosT = [Float](), sinT = [Float]()
    private var filters = [Float]()

    // 流式状态
    private var mel = [Float]()               // 累积的 [frames × 60]，**原始 mel 能量**（未取对数）
                                              // —— dB 与 80 dB 下限是**整段**一起做的（frontend.py 如此），
                                              // 判定时对当前全部帧做一遍，不能逐帧做（下限依赖整段最大值）。
    private var melFrames = 0
    private var tail = [Float]()              // 不足一帧的剩余样本
    private var fedSamples = 0                // 已消化的样本总数（定帧数用）
    private var speechSamples: Int64 = 0      // 累计话音样本（诊断）
    private var fedAudioSamples: Int = 0      // 累计喂进来的音频样本（选窗口档用；VAD 门已把长静音挡掉了）
    private var lastJudgeSpeech: Int64 = 0    // 上次判定时已积累的话音样本数（按**音频时间**而不是墙上时钟：
                                             // 文件驱动/离线回放时墙上时钟几乎不动，闸门会永远不放行）
    private var lastLLR: Float = 0
    private var lastDecided = ""              // 本句已经定过的语言（避免反复发）
    /// 本句最近的判定样本（`finish()` 用；也方便 JS 侧看诊断）。
    private var lastText = ""

    // MARK: 前端（照抄 frontend.py）

    private static func hzToMel(_ v: Double) -> Double { 2595.0 * log10(1.0 + v / 700.0) }
    private static func melToHz(_ v: Double) -> Double { 700.0 * (pow(10.0, v / 2595.0) - 1.0) }

    private func buildTables() {
        hamming = (0..<NFFT).map { Float(0.54 - 0.46 * cos(2.0 * Double.pi * Double($0) / Double(NFFT))) }
        // **行主序**：实测 `vDSP_mmul(A, …, C, M, N, P)` 把 A 当 M×P 的**行主序**矩阵
        // （同一帧上标量 DFT 与 mmul 逐值对照：行主序偏差 4.6e-5，列主序偏差 83 ⇒ 行主序）
        // ⇒ cosM[k*NFFT + n] = cos(k,n)。为什么必须走 BLAS：标量三重循环实测 ~1 ms/帧（-O 下也是），
        // 100 帧/秒就把单核吃满（App 里 88% CPU），而模型本身只要 3–20 ms/次。
        var c = [Float](repeating: 0, count: NBIN * NFFT)
        var s = [Float](repeating: 0, count: NBIN * NFFT)
        for k in 0..<NBIN {
            for n in 0..<NFFT {
                let a = -2.0 * Double.pi * Double(k) * Double(n) / Double(NFFT)
                c[k * NFFT + n] = Float(cos(a))
                s[k * NFFT + n] = Float(sin(a))
            }
        }
        cosT = c; sinT = s
        // SpeechBrain 三角滤波：两侧都用**下边带**（不是常见的 HTK 非对称构造）
        let lo = MTEcapaLid.hzToMel(0.0), hi = MTEcapaLid.hzToMel(Double(SR) / 2.0)
        var mp = [Double]()
        for i in 0...(NMELS + 1) { mp.append(lo + (hi - lo) * Double(i) / Double(NMELS + 1)) }
        let hz = mp.map { MTEcapaLid.melToHz($0) }
        let centers = Array(hz[1..<(NMELS + 1)])
        let bands = (1..<(NMELS + 1)).map { hz[$0] - hz[$0 - 1] }
        // mel 同理行主序：要算的是 out[m] = Σ_b filters[b][m]·power[b]，写成矩阵是 A[m][b] = filters[b][m]
        // ⇒ A 是 NMELS×NBIN 行主序 ⇒ f[m*NBIN + b]
        var f = [Float](repeating: 0, count: NBIN * NMELS)
        for b in 0..<NBIN {
            let freq = Double(SR) / 2.0 * Double(b) / Double(NBIN - 1)
            for m in 0..<NMELS {
                let slope = (freq - centers[m]) / bands[m]
                f[m * NBIN + b] = Float(max(0.0, min(slope + 1.0, -slope + 1.0)))
            }
        }
        filters = f
    }

    /// 一段 400 点窗口 → 60 维 mel（未取对数、未截断 —— 那些在整段上做）。
    private func frameMel(_ x: [Float]) -> [Float] {
        var win = [Float](repeating: 0, count: NFFT)
        vDSP_vmul(x, 1, hamming, 1, &win, 1, vDSP_Length(NFFT))
        var re = [Float](repeating: 0, count: NBIN)
        var im = [Float](repeating: 0, count: NBIN)
        vDSP_mmul(cosT, 1, win, 1, &re, 1, vDSP_Length(NBIN), 1, vDSP_Length(NFFT))
        vDSP_mmul(sinT, 1, win, 1, &im, 1, vDSP_Length(NBIN), 1, vDSP_Length(NFFT))
        var power = [Float](repeating: 0, count: NBIN)
        for k in 0..<NBIN { power[k] = re[k] * re[k] + im[k] * im[k] }
        var out = [Float](repeating: 0, count: NMELS)
        vDSP_mmul(filters, 1, power, 1, &out, 1, vDSP_Length(NMELS), 1, vDSP_Length(NBIN))
        return out
    }

    // MARK: 生命周期

    /// 从 `<dir>/SpeechBrainECAPAVoxLingua107.mlmodelc` + `<dir>/labels.json` 装载。
    func load(dir: URL, langs wanted: [String], threshold t: Float, cpuOnly co: Bool = false) -> Bool {
        cpuOnly = co
        let mURL = dir.appendingPathComponent("SpeechBrainECAPAVoxLingua107.mlmodelc", isDirectory: true)
        guard FileManager.default.fileExists(atPath: mURL.path) else { return false }
        if hamming.isEmpty { buildTables() }
        let cfg = MLModelConfiguration()
        // 实验：可切计算单元（定位 App 内 CPU 远高于独立测试的原因；见 `cpuOnly` 字段）
        cfg.computeUnits = cpuOnly ? .cpuOnly : .all
        guard let m = try? MLModel(contentsOf: mURL, configuration: cfg) else { return false }
        // labels.json：[{id, code, ...}]
        if codes.isEmpty {
            let lURL = dir.appendingPathComponent("labels.json")
            if let d = try? Data(contentsOf: lURL),
               let arr = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] {
                var pairs: [(Int, String)] = []
                for it in arr { if let i = it["id"] as? Int, let c = it["code"] as? String { pairs.append((i, c)) } }
                let n = (pairs.map { $0.0 }.max() ?? 0) + 1
                codes = [String](repeating: "", count: n)
                for (i, c) in pairs where i < n { codes[i] = c }
                for (i, c) in codes.enumerated() { idx[c] = i }
            }
        }
        guard !codes.isEmpty else { return false }
        model = m
        langs = wanted.filter { idx[$0] != nil }
        threshold = t
        reset()
        return !langs.isEmpty
    }

    func reset() {
        mel = []; melFrames = 0; fedSamples = 0
        // **左补 200 个 0**：frontend.py 是 `np.pad(samples, (NFFT//2, NFFT//2))` 之后再定帧，
        // 少了这 200 个零，每一帧都错位 200 个样本 —— 特征完全不同，LLR 直接失去意义。
        tail = [Float](repeating: 0, count: NFFT / 2)
        speechSamples = 0; fedAudioSamples = 0; lastJudgeSpeech = 0; lastLLR = 0; lastDecided = ""; lastText = ""
    }

    var ready: Bool { model != nil && !langs.isEmpty }
    var currentLLR: Float { lastLLR }
    // 耗时（实验要报「单次推理耗时」）：上游/下前段分开计量，模型那次单独算。
    private(set) var lastFrontendMs: Double = 0
    private(set) var lastModelMs: Double = 0
    private(set) var judgeCount: Int = 0
    private(set) var frameCount: Int = 0          // 累计出了多少帧（前端负载的直接度量）
    private(set) var feTotalMs: Double = 0        // 前端累计耗时（帧化 + DFT + mel）
    /// 诊断（实验期用；不发到 JS）
    var debugInfo: String = ""

    // MARK: 喂音频

    /// 喂一段 16 kHz 单声道。`speech` 由 VAD 判（与 whisper 那条路同一个门）。
    /// 返回 nil = 还没到判的时候 / 还没过阈值；返回 Decision = 现在定下来了。
    func feed(_ pcm: [Float], speech: Bool) -> Decision? {
        guard ready else { return nil }
        if speech { speechSamples += Int64(pcm.count) }
        appendAudio(pcm)
        guard speech else { return nil }
        guard speechSamples - lastJudgeSpeech >= Int64(judgeMs / 1000 * Double(SR)) else { return nil }
        lastJudgeSpeech = speechSamples
        return judge(force: false)
    }

    /// 一句结束（与识别器 finalize 同一时刻）：补右尾（200 个 0，同 frontend.py）再强制判一次。
    func finish() -> Decision? {
        guard ready else { return nil }
        let pad = [Float](repeating: 0, count: NFFT / 2)
        var data = tail; data.append(contentsOf: pad)
        var i = 0
        while i + NFFT <= data.count {
            var win = [Float](repeating: 0, count: NFFT)
            for n in 0..<NFFT { win[n] = data[i + n] }
            mel.append(contentsOf: frameMel(win)); melFrames += 1; frameCount += 1
            i += HOP
        }
        tail = []
        return judge(force: true)
    }

    private func appendAudio(_ pcm: [Float]) {
        let t0 = Date()
        defer { feTotalMs += Date().timeIntervalSince(t0) * 1000 }
        fedSamples += pcm.count
        fedAudioSamples += pcm.count
        var data = tail
        data.append(contentsOf: pcm)
        var i = 0
        // 左侧补 200 个 0（与 frontend.py 的 pad 一致）：第一帧要多等 200 个样本才定型。
        // `tail` 里始终留着不足一帧的尾巴，下一段来了接着拼。
        while i + NFFT <= data.count {
            var win = [Float](repeating: 0, count: NFFT)
            for n in 0..<NFFT { win[n] = data[i + n] }
            mel.append(contentsOf: frameMel(win))
            melFrames += 1
            frameCount += 1
            i += HOP
        }
        tail = Array(data[i...])
    }

    /// 判定：取两门的 log 概率差。
    private func judge(force: Bool) -> Decision? {
        debugInfo = "enter"
        guard let model else { debugInfo = "no-model"; return nil }
        // 取「当前音频量能填满的最大那一档」窗口（帧取自**开口**，即前缀）
        guard let cap = windowCaps.last(where: { $0 <= fedAudioSamples }) else { debugInfo = "waiting cap=\(fedAudioSamples)"; return nil }
        let capFrames = min(melFrames, (cap - NFFT / 2) / HOP + 1)
        guard capFrames >= 10 else { debugInfo = "short \(capFrames)f"; return nil }   // 模型最少 10 帧
        let speechSec = Double(speechSamples) / Double(SR)
        judgeCount += 1
        let tFe = Date()
        // 10*log10(max(mel,1e-10))，再截到 (窗口内最大 − 80 dB) —— 与 frontend.py 一致（**整段**做，
        // 不能逐帧：下限依赖整段最大值）。窗口 = 前 capFrames 帧。
        let n = capFrames * NMELS
        var feat = [Float](repeating: 0, count: n)
        for i in 0..<n { feat[i] = 10.0 * log10(max(mel[i], 1e-10)) }
        if let mx = feat.max() {
            let floorDb = mx - 80.0
            for i in 0..<n where feat[i] < floorDb { feat[i] = floorDb }
        }
        // 模型输入 [1, capFrames, 60]（**句级均值归一化在图里做**，这里不要再做一遍）；
        // capFrames 只取 windowCaps 那几档 ⇒ 形状固定 ⇒ 不会每个新形状重新 plan。
        guard let arr = try? MLMultiArray(shape: [1, NSNumber(value: capFrames), NSNumber(value: NMELS)],
                                          dataType: .float32) else { debugInfo = "no-multiarray"; return nil }
        feat.withUnsafeBufferPointer { src in
            memcpy(arr.dataPointer, src.baseAddress!, n * MemoryLayout<Float>.size)
        }
        let tModel = Date()
        guard let prov = try? MLDictionaryFeatureProvider(dictionary: ["mel_features": MLFeatureValue(multiArray: arr)]),
              let out = try? model.prediction(from: prov),
              let key = out.featureNames.first,
              let mv = out.featureValue(for: key)?.multiArrayValue else { debugInfo = "no-prediction"; return nil }
        lastModelMs = Date().timeIntervalSince(tModel) * 1000
        lastFrontendMs = (tModel.timeIntervalSince(tFe)) * 1000
        var best = -Float.greatestFiniteMagnitude
        var bestLang = ""
        for c in langs {
            guard let i = idx[c], i < mv.count else { continue }
            let v = mv[i].floatValue
            if v > best { best = v; bestLang = c }
        }
        // LLR = 两门之差（哪门大就是哪门）
        var llr: Float = 0
        if langs.count >= 2, let i0 = idx[langs[0]], let i1 = idx[langs[1]], i0 < mv.count, i1 < mv.count {
            llr = mv[i0].floatValue - mv[i1].floatValue
        }
        lastLLR = llr
        debugInfo = "frames=\(melFrames) mv=\(mv.count) feat0=\(feat.first ?? 0)"
        if abs(llr) < threshold { return nil }
        let pick = llr >= 0 ? langs.first ?? bestLang : (langs.count > 1 ? langs[1] : bestLang)
        if pick == lastDecided { return nil }
        lastDecided = pick
        lastText = pick
        return Decision(lang: pick, llr: llr, speechSec: speechSec)
    }
}
