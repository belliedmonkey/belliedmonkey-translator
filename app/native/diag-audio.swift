#if canImport(AVFoundation)
// ─────────────────────────────────────────────────────────────────────────────
// MTDiagAudio — 诊断录音采集与上传（§0.4.1，2026-10-06 用户拍板「全都干」）。
//
// 目的：转写质量的真相 = 音频 + 对齐文字回放分析（§0.3 的实验室方法论搬到真机）。
// 纪律（test/diag-log.test.js 的门禁钉着）：
//   · **默认关**：只有用户在 设置 › 诊断日志 打开「上传诊断录音」、且听译会话进行中才录；
//   · 识别文本只随音频包走（sidecar），**零内容事件通道一个字节不变**；
//   · 服务端 write-only、72h 自动清理、单文件 25MB 上限。
// 采集点：麦克风电平 tap 的同一 PCM（audio-bridge 的 micSink）、TTS 合成 PCM
// （speech-bridge 的播放管线）。CAF 未压缩（16k 单声道 ≈32KB/s，5 分钟 ≈9.6MB）。
// ─────────────────────────────────────────────────────────────────────────────
import AVFoundation

final class MTDiagAudio {
    static let shared = MTDiagAudio()
    private var dir: URL?
    private var files: [String: AVAudioFile] = [:]
    private(set) var armed = false
    private var session = ""
    private var uploadBase = ""
    private var startedAt = Date()
    private var written: [String: Int] = [:]   // 每流已写字节：到上限就停（真机 mic.caf 会超接收器 25MB 上限被整包拒）
    // 接收器单文件上限 25MB（deploy/china/diagrecv/main.go）。真机麦克风是高采样率，几分钟就超，
    // 于是 mic.caf 被 413 拒掉、整场只剩 tts-*.caf（2026-10-06 实测）。上限卡在 20MB 留余量。
    private let perStreamCap = 20 << 20;
    // 落盘走独立串行队列（2026-10-06 真机回归：在实时音频 tap 线程里同步写 AVAudioFile
    // 会饿死识别器 —— 一开诊断录音就「一句不定稿、一句不播放」。实时线程只做 armed 检查 +
    // 拷贝 + 入队，IO 在后台）。
    private let io = DispatchQueue(label: "mt.diag.audio.io", qos: .utility)

    // JS 经 mtSpeech 发 diag-audio {on:1, session, url} 武装；{on:0, sidecar} 收尾并上传。
    func arm(session: String, url: String) {
        io.sync {
            self.files.removeAll()
            self.written.removeAll()
            self.session = session
            self.uploadBase = url
            self.armed = true
            self.startedAt = Date()
            let d = FileManager.default.temporaryDirectory.appendingPathComponent("mt-diag-\(session)", isDirectory: true)
            try? FileManager.default.removeItem(at: d)
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
            self.dir = d
        }
    }

    func disarm(sidecar: String) {
        io.sync {
            self.files.removeAll()
            self.armed = false
        }
        guard let d = dir else { return }
        // sidecar（识别/朗读文本，仅随音频包走）落盘后整目录上传。**即使空也写一个文件**：
        // 上一次真机 sidecar.json 整个不见（只剩 tts-*.caf），无从判断是没写还是没传上来。
        let sc = d.appendingPathComponent("sidecar.json")
        try? (sidecar.isEmpty ? "[]" : sidecar).data(using: .utf8)?.write(to: sc)
        // meta.json：哪个包、跑了多久、每流写了多少（截断没有）—— 排障第一眼要的就是这个。
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        let meta: [String: Any] = ["version": v, "build": b, "startedAt": startedAt.timeIntervalSince1970,
                                   "endedAt": Date().timeIntervalSince1970, "bytes": written]
        if let md = try? JSONSerialization.data(withJSONObject: meta) { try? md.write(to: d.appendingPathComponent("meta.json")) }
        upload(dir: d)
        dir = nil
    }

    /// 任一 PCM 流写入（stream = "mic" / "tts-<id>"）。**实时线程零阻塞**：armed 检查 + 拷贝 +
    /// 入队；建文件与 write 都在 io 队列（AVAudioPCMBuffer 会被调用方复用，必须先拷贝）。
    func write(_ stream: String, _ buf: AVAudioPCMBuffer) {
        guard armed, buf.frameLength > 0 else { return }
        guard let copy = AVAudioPCMBuffer(pcmFormat: buf.format, frameCapacity: buf.frameLength) else { return }
        copy.frameLength = buf.frameLength
        let ch = Int(buf.format.channelCount)
        if let src = buf.floatChannelData, let dst = copy.floatChannelData {
            for c in 0..<ch { memcpy(dst[c], src[c], Int(buf.frameLength) * MemoryLayout<Float>.size) }
        }
        io.async { [weak self] in
            guard let self, self.armed, let d = self.dir else { return }
            if (self.written[stream] ?? 0) >= self.perStreamCap { return }   // 到上限就停，别把整包撑过接收器上限
            if self.files[stream] == nil {
                self.files[stream] = try? AVAudioFile(forWriting: d.appendingPathComponent("\(stream).caf"), settings: copy.format.settings)
            }
            try? self.files[stream]?.write(from: copy)
            self.written[stream] = (self.written[stream] ?? 0) + Int(copy.frameLength) * max(1, ch) * MemoryLayout<Float>.size
        }
    }

    private func upload(dir: URL) {
        guard var names = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil), !names.isEmpty else { return }
        // 先传小的文本（sidecar/meta），再传音频：上传是 fire-and-forget，App 被切走时大的最容易丢
        // （真机实测 sidecar.json 整个没上来，而音频上来了）。
        names.sort { (($0.pathExtension == "json") ? 0 : 1) < (($1.pathExtension == "json") ? 0 : 1) }
        // 逐文件 POST（multipart 略：body 即文件字节，名字放 query）——保持 receiver 极简。
        // uploadBase 必须带尾斜杠（Caddy /diag-audio/* 路由不匹配裸路径，2026-10-06 部署实测）。
        let base = uploadBase.hasSuffix("/") ? uploadBase : uploadBase + "/"
        for f in names {
            guard let data = try? Data(contentsOf: f) else { continue }
            if data.count > 25_000_000 { continue }   // 单文件上限
            var req = URLRequest(url: URL(string: "\(base)?name=\(session)/\(f.lastPathComponent)")!)
            req.httpMethod = "POST"
            req.httpBody = data
            req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
        }
    }
}
#endif
