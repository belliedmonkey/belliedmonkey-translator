// app/native/vp-probe.swift — 第 1 阶段的独立试验，不进 App、不进扩展。
//
// 只建一台 AVAudioEngine，只按头文件规定的顺序打开 voice processing。
// 不接 sherpa、系统语音、云端 TTS、WebKit。播放节点只在第二项读数里挂上，
// 不排缓冲区、不开始播放：用来回答「挂了播放节点之后 tap 还有没有帧」。
//
// 依据（2026-10-15 读 MacOSX27.0.sdk）：
// AVFAudio.framework/Headers/AVAudioIONode.h
//   setVoiceProcessingEnabled:error: 讨论，第 151–162 行。
//   引擎必须停着；输入节点的输出格式与输出节点的输入格式必须相同，
//   且只能在引擎停着时改；只在渲染到音频设备时可用，手动渲染不行。
//   第 103–104 行：macOS 上输入/输出节点连的是系统默认设备，不是 AVAudioSession。
// AVAudioSession.h 第 31、84 行：AVAudioSession 与 categoryOptions 均为
//   API_UNAVAILABLE(macos)。.mixWithOthers 因此在这一步读不到。
//
// 开关默认关。关的时候这个文件什么引擎都不建，生产路径（audio-bridge / speech-bridge）
// 不调用这里。

import AVFoundation
import Foundation

enum MTVPProbe {
    static let enabledByDefault = false

    /// 观察窗，不是 Voice Processing 的参数。头文件没有给出该等多久，
    /// 这里只取一次 1 秒来数帧；数到 0 不再换一个更长的窗。
    static let measurementWindowMs = 1000

    /// AVAudioNode.h 第 85、124 行：tap 的 bufferSize 支持范围是 [100, 400] ms。
    /// 取这个区间的中点 200 ms，按当时测到的采样率换算成帧。不改生产路径的 4096，
    /// 也不在安装失败后再换一个大小。
    static let tapBufferMs = 200.0

    static let enableCitation =
        "AVAudioIONode.h setVoiceProcessingEnabled:error: discussion, lines 151-162 " +
        "(MacOSX27.0.sdk AVFAudio.framework/Headers/AVAudioIONode.h, read 2026-10-15): " +
        "engine must be stopped; input-node output format and output-node input format must match " +
        "and may change only while stopped; voice processing is only supported when rendering to an " +
        "audio device, not manual rendering."

    static let mixCitation =
        "AVAudioSession is API_UNAVAILABLE(macos): MacOSX27.0.sdk AVAudioSession.h lines 31 and 84 " +
        "(the class and categoryOptions). AVAudioSessionCategoryOptionMixWithOthers = 0x1 is an " +
        "AVAudioSession category option (iPhoneOS SDK AVAudioSessionTypes.h lines 461-482, introduced iOS 6). " +
        "AVAudioIONode.h lines 103-104: on macOS the IO nodes talk to the default devices, not an AVAudioSession. " +
        "This step does not read a substitute property. lost is null: the option was neither observed present nor observed lost."

    static func run(enabled: Bool, attachPlayer: Bool) -> [String: Any] {
        if !enabled {
            return base(
                name: "off",
                switchOn: false,
                engineCreated: false,
                attachPlayer: false,
                authorization: nil,
                started: false,
                reason: "switch-off"
            )
        }
        let auth = authorize()
        if auth != "authorized" {
            return base(
                name: attachPlayer ? "vp-plus-player" : "vp-only",
                switchOn: true,
                engineCreated: false,
                attachPlayer: attachPlayer,
                authorization: auth,
                started: false,
                reason: "permission-" + auth
            )
        }
        return measure(attachPlayer: attachPlayer, authorization: auth)
    }

    private static func measure(attachPlayer: Bool, authorization: String) -> [String: Any] {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        var tapInstalled = false
        var vpEnabled = false
        defer {
            if tapInstalled {
                input.removeTap(onBus: 0)
            }
            if engine.isRunning {
                engine.stop()
            }
            if vpEnabled && engine.isRunning == false {
                try? input.setVoiceProcessingEnabled(false)
            }
        }

        var out: [String: Any] = base(
            name: attachPlayer ? "vp-plus-player" : "vp-only",
            switchOn: true,
            engineCreated: true,
            attachPlayer: attachPlayer,
            authorization: authorization,
            started: false,
            reason: "incomplete"
        )

        let beforeIn = input.outputFormat(forBus: 0)
        let beforeOut = engine.outputNode.inputFormat(forBus: 0)
        out["formatsBeforeEnable"] = [
            "inputNodeOutput": snap(beforeIn),
            "outputNodeInput": snap(beforeOut),
        ]
        let beforeMatch = formatsMatch(beforeIn, beforeOut)
        out["formatsMatchBeforeEnable"] = beforeMatch
        if !beforeMatch {
            out["reason"] = "format-mismatch"
            return out
        }
        if beforeIn.sampleRate == 0 || beforeIn.channelCount == 0 {
            out["reason"] = "format-zero"
            return out
        }

        if attachPlayer {
            let player = AVAudioPlayerNode()
            engine.attach(player)
            // AVAudioEngine.h connect:to:format:error:（第 283–295 行）是 macOS 27 的替换入口，
            // 仍是总线 0 对总线 0（混音器则用 nextAvailableInputBus）。失败就停，不退回旧接口。
            do {
                try engine.connectNode(player, to: engine.mainMixerNode, format: beforeIn)
            } catch {
                out["playerAttached"] = false
                out["reason"] = "player-connect-failed"
                out["error"] = String(describing: error)
                return out
            }
            out["playerAttached"] = true
            out["buffersScheduled"] = 0
            let midIn = input.outputFormat(forBus: 0)
            let midOut = engine.outputNode.inputFormat(forBus: 0)
            out["formatsAfterPlayer"] = [
                "inputNodeOutput": snap(midIn),
                "outputNodeInput": snap(midOut),
            ]
            let midMatch = formatsMatch(midIn, midOut)
            out["formatsMatchAfterPlayer"] = midMatch
            if !midMatch || midIn.sampleRate == 0 || midIn.channelCount == 0 {
                out["reason"] = "format-diverged-after-player"
                return out
            }
        }

        // 头文件：只能在引擎停止时打开。此处不满足就停，不改顺序再试一次。
        guard engine.isRunning == false else {
            out["engineRunningBeforeEnable"] = true
            out["reason"] = "engine-already-running"
            return out
        }
        out["engineRunningBeforeEnable"] = false
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            out["reason"] = "vp-enable-failed"
            out["error"] = String(describing: error)
            return out
        }
        vpEnabled = true
        out["voiceProcessingEnabled"] = input.isVoiceProcessingEnabled

        let afterIn = input.outputFormat(forBus: 0)
        let afterOut = engine.outputNode.inputFormat(forBus: 0)
        out["formatsAfterEnable"] = [
            "inputNodeOutput": snap(afterIn),
            "outputNodeInput": snap(afterOut),
        ]
        let afterMatch = formatsMatch(afterIn, afterOut)
        out["formatsMatchAfterEnable"] = afterMatch
        if !afterMatch || afterIn.sampleRate == 0 || afterIn.channelCount == 0 {
            out["reason"] = "vp-changed-format"
            return out
        }

        let counter = FrameCounter()
        let tapFrames = AVAudioFrameCount((afterIn.sampleRate * tapBufferMs / 1000).rounded())
        out["tapBufferFrames"] = tapFrames
        out["tapBufferMs"] = tapBufferMs
        // Swift 接口 installAudioTap（macOS 27，AVFAudio.swiftinterface）是
        // AVAudioNode.h 第 160 行 installTapOnBus:bufferSize:format:error:block 的提炼。
        // format 用刚核对过的输入格式（同头文件第 147–155 行的例子）。失败就停，不改成 nil 再试。
        do {
            try input.installAudioTap(onBus: 0, bufferSize: tapFrames, format: afterIn) { buffer, _ in
                counter.add(buffer)
            }
        } catch {
            out["reason"] = "tap-failed"
            out["error"] = String(describing: error)
            return out
        }
        tapInstalled = true
        do {
            engine.prepare()
            try engine.start()
        } catch {
            out["reason"] = "start-failed"
            out["error"] = String(describing: error)
            return out
        }
        out["started"] = true
        out["manualRendering"] = false
        out["windowMs"] = measurementWindowMs

        let deadline = Date().addingTimeInterval(Double(measurementWindowMs) / 1000)
        while Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        let stats = counter.snapshot()
        out["bufferCount"] = stats.buffers
        out["frameCount"] = NSNumber(value: stats.frames)
        out["maxAbs"] = NSNull()
        out["maxAbsNote"] = "not measured: AVReadOnlyAudioPCMBuffer.frameLength is the frame count; reading channelData aborts swiftc 6.4 (SILGen signal 6), so amplitude was not taken"
        out["reason"] = "ok"
        return out
    }

    private static func authorize() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            let box = AuthBox()
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                box.finish(ok ? "authorized" : "denied")
            }
            let deadline = Date().addingTimeInterval(20)
            while box.isFinished() == false && Date() < deadline {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
            }
            return box.value() ?? "timeout"
        @unknown default:
            return "unknown"
        }
    }

    private static func formatsMatch(_ a: AVAudioFormat, _ b: AVAudioFormat) -> Bool {
        a.sampleRate == b.sampleRate && a.channelCount == b.channelCount && a.commonFormat == b.commonFormat
    }

    private static func snap(_ format: AVAudioFormat) -> [String: Any] {
        [
            "sampleRate": format.sampleRate,
            "channelCount": format.channelCount,
            "commonFormat": String(describing: format.commonFormat),
        ]
    }

    private static func base(
        name: String,
        switchOn: Bool,
        engineCreated: Bool,
        attachPlayer: Bool,
        authorization: String?,
        started: Bool,
        reason: String
    ) -> [String: Any] {
        var obj: [String: Any] = [
            "name": name,
            "switch": switchOn ? "on" : "off",
            "engineCreated": engineCreated,
            "attachPlayer": attachPlayer,
            "started": started,
            "reason": reason,
            "buffersScheduled": 0,
            "citation": enableCitation,
            "mixWithOthers": [
                "readable": false,
                "lost": NSNull(),
                "citation": mixCitation,
            ] as [String: Any],
        ]
        if let authorization {
            obj["authorization"] = authorization
        } else {
            obj["authorization"] = NSNull()
        }
        if !started {
            obj["bufferCount"] = NSNull()
            obj["frameCount"] = NSNull()
            obj["maxAbs"] = NSNull()
        }
        return obj
    }
}

private final class AuthBox: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private var result: String?
    func finish(_ value: String) {
        lock.lock()
        result = value
        finished = true
        lock.unlock()
    }
    func isFinished() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return finished
    }
    func value() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}

private final class FrameCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var buffers = 0
    private var frames: Int64 = 0

    func add(_ buffer: AVReadOnlyAudioPCMBuffer) {
        lock.lock()
        buffers += 1
        frames += Int64(buffer.frameLength)
        lock.unlock()
    }

    func snapshot() -> (buffers: Int, frames: Int64) {
        lock.lock()
        defer { lock.unlock() }
        return (buffers, frames)
    }
}
