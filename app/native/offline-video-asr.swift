// app/native/offline-video-asr.swift — Mac complete-video offline subtitles (domain-design §2.8).
//
// Stage 1 of BEL-103: this process launches the stage-0 CLI
// (`python -m offline_video_asr`). It does not load a model and it does not
// import the listen bridge. The whole file is macOS-only.
// Weights stay in Application Support; this binary does not contain them.
//
// Flag `offlineVideoAsr` defaults off (UserDefaults bool, missing = false).
// There is no home-screen control here — the page calls OfflineVideoAsr.start
// once the flag is on. A visible menu waits on a Pencil draft.
#if os(macOS)
import Foundation
import WebKit

final class OfflineVideoAsr: NSObject, WKScriptMessageHandler {
    static let shared = OfflineVideoAsr()
    static let channel = "mtOfflineVideoAsr"
    static let flagKey = "offlineVideoAsr"

    private weak var webView: WKWebView?
    private let queue = DispatchQueue(label: "offline.video.asr")
    private var process: Process?
    private var stdoutBuf = Data()
    private var stderrBuf = Data()
    private let lock = NSLock()

    func install(webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: OfflineVideoAsr.channel)
        ucc.add(self, name: OfflineVideoAsr.channel)
    }

    private var flagOn: Bool {
        UserDefaults.standard.bool(forKey: OfflineVideoAsr.flagKey)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "probe":
            emit(["type": "probe", "enabled": flagOn, "channel": OfflineVideoAsr.channel])
        case "start":
            start(body)
        case "cancel":
            cancel()
        default:
            break
        }
    }

    private func start(_ body: [String: Any]) {
        guard flagOn else {
            emit(["type": "result", "ok": false, "code": "flag_off"])
            return
        }
        guard let input = body["input"] as? String, !input.isEmpty,
              let out = body["out"] as? String, !out.isEmpty else {
            emit(["type": "result", "ok": false, "code": "codec_unsupported"])
            return
        }
        queue.async {
            if let running = self.process, running.isRunning {
                self.emit(["type": "result", "ok": false, "code": "busy"])
                return
            }
            self.launch(input: input, out: out, offline: (body["offline"] as? Bool) == true)
        }
    }

    private func cancel() {
        queue.async {
            guard let proc = self.process, proc.isRunning else { return }
            proc.terminate()
        }
    }

    private func pythonURL() -> URL? {
        let fm = FileManager.default
        if let custom = UserDefaults.standard.string(forKey: "offlineVideoAsrPython"), !custom.isEmpty,
           fm.isExecutableFile(atPath: custom) {
            return URL(fileURLWithPath: custom)
        }
        guard let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let bundled = base.appendingPathComponent("offline-video-asr/venv/bin/python3")
        if fm.isExecutableFile(atPath: bundled.path) { return bundled }
        return nil
    }

    private func supportDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("models/qwen3-asr", isDirectory: true)
    }

    private func packageDir() -> String? {
        let fm = FileManager.default
        if let custom = UserDefaults.standard.string(forKey: "offlineVideoAsrPackage"), !custom.isEmpty,
           fm.fileExists(atPath: (custom as NSString).appendingPathComponent("offline_video_asr")) {
            return custom
        }
        guard let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("offline-video-asr/pkg")
        if fm.fileExists(atPath: dir.appendingPathComponent("offline_video_asr").path) { return dir.path }
        return nil
    }

    private func extractBin() -> String? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let bin = base.appendingPathComponent("offline-video-asr/bin/offline-video-asr-extract")
        return FileManager.default.isExecutableFile(atPath: bin.path) ? bin.path : nil
    }

    private func launch(input: String, out: String, offline: Bool) {
        guard let python = pythonURL() else {
            emit(["type": "result", "ok": false, "code": "sidecar_crash"])
            return
        }
        let proc = Process()
        proc.executableURL = python
        var args = ["-m", "offline_video_asr", "--input", input, "--out", out,
                    "--support-dir", supportDir().path, "--timeout", "14400"]
        if offline { args.append("--offline") }
        proc.arguments = args
        var env = ProcessInfo.processInfo.environment
        if let pkg = packageDir() {
            let prev = env["PYTHONPATH"] ?? ""
            env["PYTHONPATH"] = prev.isEmpty ? pkg : pkg + ":" + prev
        }
        if let extract = extractBin() {
            env["OFFLINE_VIDEO_ASR_EXTRACT_BIN"] = extract
        }
        env["HF_HUB_DISABLE_TELEMETRY"] = "1"
        proc.environment = env

        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe
        lock.lock()
        stdoutBuf = Data()
        stderrBuf = Data()
        lock.unlock()
        outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.lock.lock()
            self?.stdoutBuf.append(data)
            self?.lock.unlock()
        }
        errPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.lock.lock()
            self?.stderrBuf.append(data)
            self?.lock.unlock()
        }
        do {
            try proc.run()
        } catch {
            emit(["type": "result", "ok": false, "code": "sidecar_crash"])
            return
        }
        process = proc
        proc.terminationHandler = { [weak self] finished in
            self?.queue.async { self?.finished(finished) }
        }
    }

    private func finished(_ proc: Process) {
        process = nil
        lock.lock()
        let stdout = String(data: stdoutBuf, encoding: .utf8) ?? ""
        let stderr = String(data: stderrBuf, encoding: .utf8) ?? ""
        lock.unlock()
        if proc.terminationReason == .uncaughtSignal {
            let sig = proc.terminationStatus
            if sig == 9 { emit(["type": "result", "ok": false, "code": "oom"]); return }
            if sig == 15 || sig == 2 { emit(["type": "result", "ok": false, "code": "cancelled"]); return }
            emit(["type": "result", "ok": false, "code": "sidecar_crash"])
            return
        }
        if proc.terminationStatus == 0 {
            emit(["type": "result", "ok": true, "cues": cueCount(stdout)])
            return
        }
        if let code = errorCode(stderr) {
            emit(["type": "result", "ok": false, "code": code])
            return
        }
        emit(["type": "result", "ok": false, "code": "sidecar_crash"])
    }

    private func cueCount(_ stdout: String) -> Int {
        for line in stdout.split(separator: "\n").reversed() {
            guard let data = String(line).data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  obj["ok"] as? Bool == true else { continue }
            return obj["cues"] as? Int ?? 0
        }
        return 0
    }

    private func errorCode(_ stderr: String) -> String? {
        for line in stderr.split(separator: "\n").reversed() {
            guard let data = String(line).data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let code = obj["code"] as? String, !code.isEmpty else { continue }
            return code
        }
        return nil
    }

    private func emit(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        let js = "window.__mtOfflineVideoAsrEvent && window.__mtOfflineVideoAsrEvent(\(text))"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
#endif
