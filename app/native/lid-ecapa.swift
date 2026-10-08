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

/// 判定策略（H2）：**纯函数**，不碰模型、不碰音频 —— 输入是已经算好的分数，输出是判词或 nil。
///
/// 为什么抽出来单独放：这些数字（窗档 / 每档阈值 / 换判门槛 / 轻量修正）就是回归清单
/// L-01…L-06 的判据，靠真音频「碰巧跑对」证明不了；抽成纯函数后 `scripts/test-lid-policy.swift`
/// 直接喂数（`npm run test:lid`），边界值是断言出来的，不是试出来的。
///
/// 放在同一个文件里而不是新建一个：`lid-ecapa.swift` 已经在 Xcode 工程里，新建文件要改 pbxproj。
enum MTLidPolicy {
    /// 首判允许 1 s 窗（之后只用 2 s / 4 s）。
    static let firstCaps: [Int] = [16000, 32000, 64000]
    /// 首判之后只用这两档。
    static let windowCaps: [Int] = [32000, 64000]
    /// 换判看的那一档（2 s 窗）。
    static let changeCap: Int = 32000
    /// 换判要 2 s 窗 |LLR| ≥ 它（原来 8，2026-10-08 用户拍板 ②）。
    static let changeThreshold: Float = 6.0
    /// 基础阈值按窗长：1 s 档 6；2 s / 4 s 档 4。
    static func baseThreshold(cap: Int) -> Float { cap >= 32000 ? 4.0 : 6.0 }

    struct Input {
        let lastDecided: String          // 本句之前已经定过的语言（"" = 本场首判）
        let fedAudioSamples: Int          // 本句喂进来的样本数（16 k）
        let langs: [String]              // 用户选的两门（只在这两门里取）
        /// 取某档窗长时的 (llr, top)；算不出（帧数不够）就返回 nil。
        let scores: (Int) -> (llr: Float, top: String)?
        let rewrites: [String: Int]      // 本句两路的 partial 改写次数
        let rewriteFix: Bool             // 轻量修正开关（`lidRewriteFix`，默认开）
    }

    /// 选窗档 → 基础阈值 → 轻量修正 → 换判门槛 → 出不出判词。
    static func decide(_ i: Input) -> (lang: String, llr: Float, cap: Int, effThr: Float)? {
        let caps = i.lastDecided.isEmpty ? firstCaps : windowCaps
        guard let cap = caps.last(where: { $0 <= i.fedAudioSamples }) else { return nil }
        guard let sc = i.scores(cap) else { return nil }
        var effThr = baseThreshold(cap: cap)
        // **轻量修正**：另一门的 partial 改写次数明显更多（→ 说话人更像在说它）就把阈值抬高一点，
        // 让 ECAPA 拿出更多证据才改判。首判不加（还没有「本路」可比）。
        if i.rewriteFix && !i.lastDecided.isEmpty {
            let mine = i.rewrites[i.lastDecided] ?? 0
            let other = i.rewrites[i.langs.first { $0 != i.lastDecided } ?? ""] ?? 0
            effThr += Float(min(2.0, Double(max(0, other - mine)) / 4.0))
        }
        if abs(sc.llr) < effThr { return nil }
        let pick = sc.llr >= 0 ? (i.langs.first ?? sc.top) : (i.langs.count > 1 ? i.langs[1] : sc.top)
        // **换判**：已有判词时要另过一道 —— 2 s 窗 |LLR| ≥ 6。
        if !i.lastDecided.isEmpty && pick != i.lastDecided {
            guard let s2 = i.scores(changeCap), abs(s2.llr) >= changeThreshold else { return nil }
        }
        if pick == i.lastDecided { return nil }
        return (pick, sc.llr, cap, effThr)
    }
}

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
    private var threshold: Float = 4.0
    private var cpuOnly = false                 // 实验开关：只走 CPU（排查与系统 ASR 抢 ANE/GPU）
    private let judgeMs: Double = 250         // 重算节奏（报告建议 0.25–0.5 s）
    /// 轻量修正开关（`lidRewriteFix`，默认开）。L-16 用「关」这一档做方向核实。
    /// 阈值 / 窗档 / 换判门槛都在 `MTLidPolicy`（纯函数，`npm run test:lid` 守边界值）。
    var rewriteFix = true
    /// **输入窗口只取这几档**（1.0/2.0/4.0 s，单位：样本）。为什么不是「窗口一直长大」：
    /// CoreML 对**每一个没见过的输入形状**都要重新 plan —— 实测每个新形状冷启动 40–70 ms，
    /// 而每 0.25 s 话音就换一个形状 ⇒ 每 0.25 s 付一次冷启动，App 里实测 CPU 冲到 85–95%
    /// （既不是前端的错也不是模型算得慢：同一形状反复只要 8–38 ms）。四档固定窗口 ⇒ 只有 4 个形状。
    /// 顺带：这几档正是调研报告离线评估用过的窗长（0.5/1.0/1.5/2/3 s 里的几档），可比。
    /// **为什么最小档是 1.0 s 而不是 0.5 s**（2026-10-08 用户拍板「1+3」）：离线实测 0.5 s 时两门
    /// **还没分开**（泰 −0.53、中 **+1.43** —— 符号都是错的），1.0 s 才分开（+5.36 / −10.58）。
    /// 而识别器收口时那一小片常常只有几百毫秒 —— 拿 0.5 s 窗口判就会偶发翻到另一门，翻过去之后
    /// 另一路识别器的半句立刻上屏（真机标准 5 例的 `zh-multi` 实测到 58 条错语言半句）。
    /// **顺带得到「超短句沿用上句判词」**：构不出窗口（本句话音 < 1.0 s）就**不判**，判词保持上一条 ——
    /// 这正是用户「1+3」里的第 3 条，不需要另写分支。

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
    func load(dir: URL, langs wanted: [String], threshold t: Float, cpuOnly co: Bool = false, rewriteFix rw: Bool = true) -> Bool {
        cpuOnly = co
        rewriteFix = rw
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
        let d = judge(force: true)
        // **每句结束就把累积清掉**（与 whisper 那条路 `MTDeviceLid.finish` 清 `buf` 同理）：
        // 不重置的话窗口会一直锚在**会话开头**那几秒 ⇒ 换语言后判词永远换不了 —— 实测
        // 「中→泰→中」的用例里整场只判了第一次 `zh`，泰语段落全被丢、而中文识别器在泰语音频上的
        // 垃圾反而进来了（标准 5 例的 `zh-th-zh` 就是这么红的）。窗口语义 = 「从**本句**开口起累积」。
        resetUtterance()
        return d
    }

    /// 清掉本句的累积，但保留 `lastDecided`（同一门语言不重复报）。
    private func resetUtterance() {
        mel = []; melFrames = 0; fedSamples = 0; fedAudioSamples = 0
        speechSamples = 0; lastJudgeSpeech = 0
        tail = [Float](repeating: 0, count: NFFT / 2)   // 左补 200 个 0，同 frontend.py
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

    /// **只记录用**的开关（2026-10-08，用户 15:35）：开时每次判定顺带把**每一档窗长**的 LLR 都算出来，
    /// 放进 `lastTrace`，由 `MTDeviceLid` 发 `lid-trace`。它**不改任何行为**（不参与判定）。
    var trace = false
    private(set) var lastTrace: [String: Any]?
    private(set) var judgeSeq = 0          // 判定序号（lid-trace 只在**新判定**时发一次，不重复）
    /// 本句两路的 partial **改写次数**（由 `MTDeviceLid` 喂进来）—— 轻量修正用（用户拍板 ③）。
    var rewrites: [String: Int] = [:]

    /// 某一档窗长的两门结果：LLR（langs[0] − langs[1]）+ 各自的 log 概率 + 最高门。
    private func scores(capFrames: Int) -> (llr: Float, pa: Float, pb: Float, top: String)? {
        guard let model, capFrames >= 10, capFrames <= melFrames else { return nil }
        let n = capFrames * NMELS
        var feat = [Float](repeating: 0, count: n)
        for i in 0..<n { feat[i] = 10.0 * log10(max(mel[i], 1e-10)) }
        if let mx = feat.max() {
            let floorDb = mx - 80.0
            for i in 0..<n where feat[i] < floorDb { feat[i] = floorDb }
        }
        guard let arr = try? MLMultiArray(shape: [1, NSNumber(value: capFrames), NSNumber(value: NMELS)],
                                          dataType: .float32) else { return nil }
        feat.withUnsafeBufferPointer { src in
            memcpy(arr.dataPointer, src.baseAddress!, n * MemoryLayout<Float>.size)
        }
        let tModel = Date()
        guard let prov = try? MLDictionaryFeatureProvider(dictionary: ["mel_features": MLFeatureValue(multiArray: arr)]),
              let out = try? model.prediction(from: prov),
              let key = out.featureNames.first,
              let mv = out.featureValue(for: key)?.multiArrayValue else { return nil }
        lastModelMs = Date().timeIntervalSince(tModel) * 1000
        var best = -Float.greatestFiniteMagnitude
        var bestLang = ""
        for c in langs {
            guard let i = idx[c], i < mv.count else { continue }
            let v = mv[i].floatValue
            if v > best { best = v; bestLang = c }
        }
        var llr: Float = 0, pa: Float = 0, pb: Float = 0
        if langs.count >= 2, let i0 = idx[langs[0]], let i1 = idx[langs[1]], i0 < mv.count, i1 < mv.count {
            pa = mv[i0].floatValue; pb = mv[i1].floatValue; llr = pa - pb
        }
        return (llr, pa, pb, bestLang)
    }

    /// 判定：取两门的 log 概率差。**策略本身在 `MTLidPolicy.decide`**（纯函数、可单测，H2）——
    /// 这里只负责「从当前帧数算得出哪一档的分数」和记账（trace / lastLLR / lastDecided）。
    private func judge(force: Bool) -> Decision? {
        debugInfo = "enter"
        guard let model else { debugInfo = "no-model"; return nil }
        let speechSec = Double(speechSamples) / Double(SR)
        judgeCount += 1
        judgeSeq += 1
        // 取「当前音频量能填满的最大那一档」窗口（帧取自**开口**，即前缀）；帧数不够（模型最少 10 帧）
        // ⇒ 这一档算不出来，当作「没有这一档」。
        let scoreAt = { [self] (cap: Int) -> (llr: Float, top: String)? in
            let f = min(melFrames, (cap - NFFT / 2) / HOP + 1)
            guard f >= 10 else { return nil }
            guard let s = scores(capFrames: f) else { return nil }
            return (s.llr, s.top)
        }
        // 只记录：把每一档窗长的分数都算一遍（**不参与判定**）。
        var traceCaps: [[String: Any]] = []
        if trace {
            for c in MTLidPolicy.firstCaps where c <= fedAudioSamples {
                let f = min(melFrames, (c - NFFT / 2) / HOP + 1)
                guard f >= 10, let s2 = scores(capFrames: f) else { continue }
                traceCaps.append(["ms": c / 16, "llr": Double(s2.llr), "pa": Double(s2.pa), "pb": Double(s2.pb), "top": s2.top])
            }
        }
        let out = MTLidPolicy.decide(MTLidPolicy.Input(
            lastDecided: lastDecided, fedAudioSamples: fedAudioSamples, langs: langs,
            scores: { cap -> (llr: Float, top: String)? in
                // trace 之外只算「选中的那档」与「换判那档」—— 纯函数要哪档我们事先不知道，
                // 所以这里就按 cap 现算（`scores` 本身只在有新帧时才重算）。
                guard let s = scoreAt(cap) else { return nil }
                return (llr: s.llr, top: s.top)
            },
            rewrites: rewrites, rewriteFix: rewriteFix))
        if trace {
            lastTrace = ["seq": judgeSeq, "speechMs": Int(Double(speechSamples) / Double(SR) * 1000),
                         "fedMs": Int(Double(fedAudioSamples) / Double(SR) * 1000),
                         "melFrames": melFrames, "caps": traceCaps,
                         "decided": lastDecided, "threshold": Double(out?.effThr ?? MTLidPolicy.baseThreshold(cap: 32000)),
                         "baseThreshold": Double(MTLidPolicy.baseThreshold(cap: 32000)), "rewrites": rewrites]
        }
        debugInfo = "frames=\(melFrames)"
        guard let d = out else { return nil }
        lastLLR = d.llr
        lastDecided = d.lang
        lastText = d.lang
        if trace { lastTrace?["verdict"] = d.lang; lastTrace?["verdictLlr"] = Double(d.llr) }
        return Decision(lang: d.lang, llr: d.llr, speechSec: speechSec)
    }
}
