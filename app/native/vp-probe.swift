// app/native/vp-probe.swift — 第 1 阶段的独立试验，不进 App、不进扩展。
//
// 只建一台 AVAudioEngine，只按头文件规定的顺序打开 voice processing。
// 不接 sherpa、系统语音、云端 TTS、WebKit。
// `--on` 的第二项只挂一个空的播放节点，不排缓冲区、不开始播放。
// `--player-frames` 才在同一台引擎上挂播放节点并放一段程序生成的正弦，默认不走。
// `--player-ab` 用同一段测试音先关后开各跑一台引擎，默认不走。
// `--player-ab-slices` 用同一段测试音先关后开，把 tap 在缓冲内部按采样点切成 100 毫秒，默认不走。
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
import Darwin
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

    /// 只回答「停着的引擎上打开一次 voice processing」：成功则再读格式，抛错则记下域和码。
    /// 不连接节点，不 prepare，不 start，不挂播放节点，不装 tap，不改任何一侧的格式。
    static func runFormatOnly() -> [String: Any] {
        let auth = authorize()
        let engine = AVAudioEngine()
        let input = engine.inputNode
        var vpEnabled = false
        defer {
            if vpEnabled && engine.isRunning == false {
                try? input.setVoiceProcessingEnabled(false)
            }
        }

        var out: [String: Any] = base(
            name: "format-only",
            switchOn: true,
            engineCreated: true,
            attachPlayer: false,
            authorization: auth,
            started: false,
            reason: "incomplete"
        )
        out["nodesConnected"] = false
        out["prepared"] = false
        out["tapInstalled"] = false

        let beforeIn = input.outputFormat(forBus: 0)
        let beforeOut = engine.outputNode.inputFormat(forBus: 0)
        out["formatsBeforeEnable"] = [
            "inputNodeOutput": snap(beforeIn),
            "outputNodeInput": snap(beforeOut),
        ]
        out["formatsMatchBeforeEnable"] = formatsMatch(beforeIn, beforeOut)

        guard engine.isRunning == false else {
            out["engineRunningBeforeEnable"] = true
            out["threw"] = false
            out["outcome"] = "not-called"
            out["reason"] = "engine-already-running"
            return out
        }
        out["engineRunningBeforeEnable"] = false
        do {
            try input.setVoiceProcessingEnabled(true)
            vpEnabled = true
            let afterIn = input.outputFormat(forBus: 0)
            let afterOut = engine.outputNode.inputFormat(forBus: 0)
            let matched = formatsMatch(afterIn, afterOut)
            out["voiceProcessingEnabled"] = input.isVoiceProcessingEnabled
            out["formatsAfterEnable"] = [
                "inputNodeOutput": snap(afterIn),
                "outputNodeInput": snap(afterOut),
            ]
            out["formatsMatchAfterEnable"] = matched
            out["threw"] = false
            out["errorDomain"] = NSNull()
            out["errorCode"] = NSNull()
            out["outcome"] = matched ? "A" : "enabled-formats-still-differ"
            out["reason"] = "ok"
        } catch {
            let ns = error as NSError
            out["threw"] = true
            out["outcome"] = "B"
            out["reason"] = "vp-enable-failed"
            out["errorDomain"] = ns.domain
            out["errorCode"] = ns.code
            out["errorDescription"] = ns.localizedDescription
            out["error"] = String(describing: error)
            if let failure = ns.localizedFailureReason {
                out["errorFailureReason"] = failure
            }
        }
        return out
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

    /// 读数①：打开 voice processing 后，输入 tap 的帧数是不是 0。
    /// 不挂播放节点，不连 mainMixerNode，不 prepare。start 只一次，约 5 秒后 stop。
    /// 缓冲大小只按头文件选一次：例子里的 8192 帧若落在 [100, 400] ms 内就用它，否则用该区间中点 200 ms。失败不换。
    static func runInputFrames() -> [String: Any] {
        let auth = authorize()
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
            name: "input-frames",
            switchOn: true,
            engineCreated: true,
            attachPlayer: false,
            authorization: auth,
            started: false,
            reason: "incomplete"
        )
        out["nodesConnected"] = false
        out["prepared"] = false
        out["playerAttached"] = false
        out["windowMs"] = inputFramesWindowMs

        guard engine.isRunning == false else {
            out["engineRunningBeforeEnable"] = true
            out["outcome"] = "not-called"
            out["reason"] = "engine-already-running"
            out["engineRunningAtEnd"] = engine.isRunning
            return out
        }
        out["engineRunningBeforeEnable"] = false
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            let ns = error as NSError
            out["threw"] = true
            out["outcome"] = "vp-enable-failed"
            out["reason"] = "vp-enable-failed"
            out["errorDomain"] = ns.domain
            out["errorCode"] = ns.code
            out["errorDescription"] = ns.localizedDescription
            out["error"] = String(describing: error)
            out["engineRunningAtEnd"] = engine.isRunning
            return out
        }
        vpEnabled = true
        out["voiceProcessingEnabled"] = input.isVoiceProcessingEnabled

        let tapFormat = input.outputFormat(forBus: 0)
        out["tapFormat"] = describe(tapFormat)
        let chosen = tapBufferChoice(sampleRate: tapFormat.sampleRate)
        guard let tapFrames = chosen.frames else {
            out["outcome"] = "not-called"
            out["reason"] = "tap-buffer-out-of-documented-range"
            out["tapBufferNote"] = chosen.note
            out["engineRunningAtEnd"] = engine.isRunning
            return out
        }
        out["tapBufferFrames"] = tapFrames
        out["tapBufferMs"] = chosen.ms
        out["tapBufferNote"] = chosen.note

        let stats = InputFrameStats(channelCount: Int(tapFormat.channelCount))
        do {
            try input.installAudioTap(onBus: 0, bufferSize: tapFrames, format: tapFormat) { buffer, _ in
                stats.add(buffer)
            }
        } catch {
            let ns = error as NSError
            out["threw"] = true
            out["outcome"] = "E"
            out["reason"] = "tap-failed"
            out["errorDomain"] = ns.domain
            out["errorCode"] = ns.code
            out["errorDescription"] = ns.localizedDescription
            out["error"] = String(describing: error)
            out["engineRunningAtEnd"] = engine.isRunning
            return out
        }
        tapInstalled = true
        out["tapInstalled"] = true
        do {
            try engine.start()
        } catch {
            let ns = error as NSError
            out["threw"] = true
            out["outcome"] = "E"
            out["reason"] = "start-failed"
            out["errorDomain"] = ns.domain
            out["errorCode"] = ns.code
            out["errorDescription"] = ns.localizedDescription
            out["error"] = String(describing: error)
            out["engineRunningAtEnd"] = engine.isRunning
            return out
        }
        out["started"] = true
        FileHandle.standardError.write(Data("window-start\n".utf8))
        let deadline = Date().addingTimeInterval(Double(inputFramesWindowMs) / 1000)
        while Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        let snapStats = stats.snapshot()
        if engine.isRunning {
            engine.stop()
        }
        out["engineRunningAtEnd"] = engine.isRunning
        out["bufferCount"] = snapStats.buffers
        out["frameCount"] = NSNumber(value: snapStats.frames)
        out["audioBufferListCount"] = snapStats.listCount ?? NSNull()
        out["samplesParsed"] = snapStats.parsed
        if let note = snapStats.note {
            out["sampleNote"] = note
        }
        if snapStats.parsed {
            out["nonzeroFrameCount"] = NSNumber(value: snapStats.nonzeroFrames)
            out["maxAbs"] = NSNumber(value: snapStats.maxAbs)
            out["channels"] = snapStats.channels
        } else {
            out["nonzeroFrameCount"] = NSNull()
            out["maxAbs"] = NSNull()
            out["channels"] = snapStats.channels
        }
        if snapStats.frames == 0 {
            out["outcome"] = "D"
        } else {
            out["outcome"] = "C"
        }
        out["reason"] = "ok"
        out["threw"] = false
        out["errorDomain"] = NSNull()
        out["errorCode"] = NSNull()
        return out
    }

    private static let inputFramesWindowMs = 5000

    /// 时间分辨对照。同一段测试音先关后开，间隔 playerABGapMs。不调换，不重试。
    /// 每台引擎把 tap 在缓冲内部按采样点切成 playerSliceMs，只取第 0 路。默认不走。
    /// 不改 phase1f 的分档，也不把那一次算作通过。
    static func runPlayerABSlices() -> [String: Any] {
        let off = runPlayerFrames(name: "player-ab-slices-off", enableVoiceProcessing: false, collectSlices: true)
        let gapStart = Date()
        Thread.sleep(forTimeInterval: Double(playerABGapMs) / 1000)
        let gapEnd = Date()
        let on = runPlayerFrames(name: "player-ab-slices-on", enableVoiceProcessing: true, collectSlices: true)
        return playerABSliceResult(off: off, on: on, gapStart: gapStart, gapEnd: gapEnd)
    }

    /// 开/关对照：各自单独起一台引擎。先关后开，中间停 playerABGapMs。不调换，不重试。
    static func runPlayerAB() -> [String: Any] {
        let off = runPlayerFrames(name: "player-ab-off", enableVoiceProcessing: false)
        let gapStart = Date()
        Thread.sleep(forTimeInterval: Double(playerABGapMs) / 1000)
        let gapEnd = Date()
        let on = runPlayerFrames(name: "player-ab-on", enableVoiceProcessing: true)
        return playerABResult(off: off, on: on, gapStart: gapStart, gapEnd: gapEnd)
    }

    /// 读数②：回声消除已经打开的同一台引擎上再挂播放节点，看输入 tap 还有没有非零采样。
    /// 顺序只走一次：停着时打开 voice processing，再 attach，再 connect（format 传 nil，不手改格式），
    /// 再装 tap，再 start 一次。任一步抛错就停。窗口 6 秒；开始后 1 秒播放 440 Hz、幅度 0.2、3 秒的正弦。
    /// enableVoiceProcessing 为 false 时不调用 setVoiceProcessingEnabled，格式仍取节点当前输出。
    static func runPlayerFrames(name: String = "player-frames", enableVoiceProcessing: Bool = true, collectSlices: Bool = false) -> [String: Any] {
        let auth = authorize()
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let player = AVAudioPlayerNode()
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
            name: name,
            switchOn: true,
            engineCreated: true,
            attachPlayer: false,
            authorization: auth,
            started: false,
            reason: "incomplete"
        )
        out["prepared"] = false
        out["windowMs"] = playerFramesWindowMs
        out["nodesConnected"] = false

        func fail(_ error: Error, _ reason: String) {
            let ns = error as NSError
            out["threw"] = true
            out["outcome"] = "E"
            out["reason"] = reason
            out["errorDomain"] = ns.domain
            out["errorCode"] = ns.code
            out["errorDescription"] = ns.localizedDescription
            out["error"] = String(describing: error)
            out["engineRunningAtEnd"] = engine.isRunning
        }

        out["setVoiceProcessingEnabledCalled"] = false
        if enableVoiceProcessing {
            guard engine.isRunning == false else {
                out["engineRunningBeforeEnable"] = true
                out["outcome"] = "not-called"
                out["reason"] = "engine-already-running"
                out["engineRunningAtEnd"] = engine.isRunning
                return out
            }
            out["engineRunningBeforeEnable"] = false
            do {
                try input.setVoiceProcessingEnabled(true)
            } catch {
                fail(error, "vp-enable-failed")
                return out
            }
            vpEnabled = true
            out["setVoiceProcessingEnabledCalled"] = true
        } else {
            out["engineRunningBeforeEnable"] = engine.isRunning
        }
        out["voiceProcessingEnabled"] = input.isVoiceProcessingEnabled

        engine.attach(player)
        out["playerAttached"] = true
        out["attachPlayer"] = true
        do {
            // format nil：AVAudioEngine.h 写明非 nil 才会改源节点输出格式。这里不传格式。
            try engine.connectNode(player, to: engine.mainMixerNode, format: nil)
        } catch {
            fail(error, "player-connect-failed")
            return out
        }
        out["nodesConnected"] = true
        let playFormat = player.outputFormat(forBus: 0)
        out["playerFormat"] = describe(playFormat)

        let tapFormat = input.outputFormat(forBus: 0)
        out["tapFormat"] = describe(tapFormat)
        out["tapBufferFrames"] = playerTapFrames
        out["slicesCollected"] = collectSlices
        let stats = InputFrameStats(channelCount: Int(tapFormat.channelCount))
        let slices = Channel0Slices(sampleRate: tapFormat.sampleRate, sliceMs: playerSliceMs)
        var playerOutputHost: UInt64?
        var playerOutputSample: Int?
        func attachSlices() {
            guard collectSlices else { return }
            out["channel0Slices"] = slices.snapshot()
            var delay: [String: Any] = [
                "sampleIndex": playerOutputSample.map { NSNumber(value: $0) } ?? NSNull(),
                "hostTicks": NSNull(),
                "delaySec": NSNull(),
            ]
            if let host = playerOutputHost, let rel = slices.secondsSincePlay(host) {
                delay["hostTicks"] = String(host)
                delay["delaySec"] = NSNumber(value: rel)
            }
            out["playerOutputFirstNonZero"] = delay
        }
        do {
            try input.installAudioTap(onBus: 0, bufferSize: playerTapFrames, format: tapFormat) { buffer, when in
                stats.add(buffer, trackPhase: true)
                if collectSlices {
                    slices.add(buffer, when: when)
                }
            }
        } catch {
            fail(error, "tap-failed")
            attachSlices()
            return out
        }
        tapInstalled = true
        out["tapInstalled"] = true
        do {
            try engine.start()
        } catch {
            fail(error, "start-failed")
            attachSlices()
            return out
        }
        out["started"] = true

        let windowStart = Date()
        let deadline = windowStart.addingTimeInterval(Double(playerFramesWindowMs) / 1000)
        let toneAt = windowStart.addingTimeInterval(Double(playerToneDelayMs) / 1000)
        while Date() < toneAt {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }

        let tone: AVAudioPCMBuffer
        switch makeTone(format: playFormat) {
        case .buffer(let buffer):
            tone = buffer
        case .stopped(let reason):
            out["threw"] = false
            out["outcome"] = "stopped"
            out["reason"] = reason
            out["errorDomain"] = NSNull()
            out["errorCode"] = NSNull()
            out["engineRunningAtEnd"] = engine.isRunning
            out["segments"] = stats.segmentSnapshot()
            attachSlices()
            return out
        }
        out["tone"] = [
            "hz": playerToneHz,
            "amplitude": playerToneAmplitude,
            "frames": tone.frameLength,
            "seconds": Double(tone.frameLength) / playFormat.sampleRate,
        ] as [String: Any]
        player.scheduleBuffer(tone, at: nil, options: [], completionHandler: {
            stats.markPlayEnd(Date())
        })
        out["buffersScheduled"] = 1
        if collectSlices {
            playerOutputSample = Self.firstNonZeroSampleIndex(tone)
        }
        stats.markPlayStart(Date())
        if collectSlices {
            slices.markPlay(host: mach_absolute_time())
        }
        do {
            try player.playAudio()
        } catch {
            fail(error, "play-failed")
            out["segments"] = stats.segmentSnapshot()
            attachSlices()
            return out
        }

        while Date() < deadline {
            if collectSlices && playerOutputHost == nil, let sampleIndex = playerOutputSample {
                let playerSample = AVAudioTime(sampleTime: AVAudioFramePosition(sampleIndex), atRate: playFormat.sampleRate)
                if let node = player.nodeTime(forPlayerTime: playerSample) {
                    if node.isHostTimeValid {
                        playerOutputHost = node.hostTime
                    } else if let render = player.lastRenderTime, render.isHostTimeValid, render.isSampleTimeValid,
                              let full = node.extrapolateTime(fromAnchor: render), full.isHostTimeValid {
                        playerOutputHost = full.hostTime
                    }
                }
            }
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        if engine.isRunning {
            engine.stop()
        }
        out["engineRunningAtEnd"] = engine.isRunning
        let snapStats = stats.snapshot()
        let phases = stats.phaseMarks()
        out["bufferCount"] = snapStats.buffers
        out["frameCount"] = NSNumber(value: snapStats.frames)
        out["segments"] = stats.segmentSnapshot()
        out["playStartedAt"] = phases.started.map(iso8601) ?? NSNull()
        out["playEndedAt"] = phases.ended.map(iso8601) ?? NSNull()
        out["toneCompletionFired"] = phases.ended != nil
        out["samplesParsed"] = snapStats.parsed
        if let note = snapStats.note {
            out["sampleNote"] = note
        }
        let nonzeroSamples = snapStats.channels.reduce(Int64(0)) { sum, row in
            sum + ((row["nonzeroSamples"] as? NSNumber)?.int64Value ?? 0)
        }
        if snapStats.parsed {
            out["nonzeroFrameCount"] = NSNumber(value: snapStats.nonzeroFrames)
            out["nonzeroSamples"] = NSNumber(value: nonzeroSamples)
            out["maxAbs"] = NSNumber(value: snapStats.maxAbs)
            out["channels"] = snapStats.channels
        } else {
            out["nonzeroFrameCount"] = NSNull()
            out["nonzeroSamples"] = NSNull()
            out["maxAbs"] = NSNull()
            out["channels"] = snapStats.channels
        }
        if snapStats.frames == 0 {
            out["outcome"] = "H"
        } else if snapStats.parsed && nonzeroSamples == 0 {
            out["outcome"] = "I"
        } else if snapStats.parsed && nonzeroSamples > 0 {
            out["outcome"] = "G"
        } else {
            out["outcome"] = "unparsed"
        }
        out["reason"] = "ok"
        out["threw"] = false
        out["errorDomain"] = NSNull()
        out["errorCode"] = NSNull()
        attachSlices()
        return out
    }

    private static let playerFramesWindowMs = 6000
    private static let playerToneDelayMs = 1000
    private static let playerToneMs = 3000
    private static let playerToneHz = 440.0
    private static let playerToneAmplitude: Float = 0.2
    private static let playerTapFrames: AVAudioFrameCount = 8192
    private static let playerABGapMs = 5000
    private static let playerSliceMs = 100

    private static func playerABResult(off: [String: Any], on: [String: Any], gapStart: Date, gapEnd: Date) -> [String: Any] {
        var out: [String: Any] = [
            "name": "player-ab",
            "order": ["off", "on"],
            "gapMs": playerABGapMs,
            "gapActualMs": gapEnd.timeIntervalSince(gapStart) * 1000,
            "gapStartedAt": iso8601(gapStart),
            "gapEndedAt": iso8601(gapEnd),
            "halfRule": "J when on during maxAbs <= off during maxAbs / 2; L when on during maxAbs is greater; otherwise K",
            "off": off,
            "on": on,
        ]
        func metric(_ run: [String: Any], _ key: String) -> Double? {
            guard let segs = run["segments"] as? [String: [String: Any]],
                  let during = segs["during"],
                  let number = during[key] as? NSNumber else { return nil }
            return number.doubleValue
        }
        let offMax = metric(off, "maxAbs")
        let onMax = metric(on, "maxAbs")
        let offRms = metric(off, "rms")
        let onRms = metric(on, "rms")
        if let offMax, let onMax, offMax != 0 {
            out["duringMaxAbsRatioOnOverOff"] = NSNumber(value: onMax / offMax)
        } else {
            out["duringMaxAbsRatioOnOverOff"] = NSNull()
        }
        if let offRms, let onRms, offRms != 0 {
            out["duringRmsRatioOnOverOff"] = NSNumber(value: onRms / offRms)
        } else {
            out["duringRmsRatioOnOverOff"] = NSNull()
        }
        out["duringMaxAbs"] = [
            "off": offMax.map { NSNumber(value: $0) } ?? NSNull(),
            "on": onMax.map { NSNumber(value: $0) } ?? NSNull(),
        ]
        out["duringRms"] = [
            "off": offRms.map { NSNumber(value: $0) } ?? NSNull(),
            "on": onRms.map { NSNumber(value: $0) } ?? NSNull(),
        ]
        let offThrew = (off["threw"] as? Bool) == true
        let onThrew = (on["threw"] as? Bool) == true
        if offThrew || onThrew {
            let failed = offThrew ? off : on
            out["outcome"] = "E"
            out["threw"] = true
            out["errorDomain"] = failed["errorDomain"] ?? NSNull()
            out["errorCode"] = failed["errorCode"] ?? NSNull()
            out["errorReason"] = failed["reason"] ?? NSNull()
            return out
        }
        guard let offMax, let onMax else {
            out["outcome"] = "unparsed"
            out["threw"] = false
            out["errorDomain"] = NSNull()
            out["errorCode"] = NSNull()
            return out
        }
        if onMax > offMax {
            out["outcome"] = "L"
        } else if onMax <= offMax / 2 {
            out["outcome"] = "J"
        } else {
            out["outcome"] = "K"
        }
        out["threw"] = false
        out["errorDomain"] = NSNull()
        out["errorCode"] = NSNull()
        return out
    }

    private struct SliceMeas {
        var rms: Double
        var maxAbs: Double
        var count: Int
    }

    private static func asDouble(_ value: Any?) -> Double? {
        switch value {
        case let number as Double:
            return number
        case let number as NSNumber:
            return number.doubleValue
        case let number as Int:
            return Double(number)
        default:
            return nil
        }
    }

    private static func asInt(_ value: Any?) -> Int? {
        switch value {
        case let number as Int:
            return number
        case let number as NSNumber:
            return number.intValue
        default:
            return nil
        }
    }

    private static func sliceMap(_ run: [String: Any]) -> (ok: Bool, reason: String, rows: [Int: SliceMeas]) {
        guard let box = run["channel0Slices"] as? [String: Any] else {
            return (false, "channel0Slices missing", [:])
        }
        if (box["parsed"] as? Bool) != true {
            return (false, (box["note"] as? String) ?? "samples unparsed", [:])
        }
        if (box["hostTimeValid"] as? Bool) != true {
            return (false, "host time invalid", [:])
        }
        guard let play = box["playHostTicks"] as? String, play.isEmpty == false else {
            return (false, "play host time missing", [:])
        }
        guard let list = box["slices"] as? [[String: Any]] else {
            return (false, "slices missing", [:])
        }
        var rows: [Int: SliceMeas] = [:]
        for item in list {
            guard let index = asInt(item["index"]),
                  let rms = asDouble(item["rms"]),
                  let maxAbs = asDouble(item["maxAbs"]),
                  let count = asInt(item["sampleCount"]) else {
                return (false, "slice field unparsed", [:])
            }
            rows[index] = SliceMeas(rms: rms, maxAbs: maxAbs, count: count)
        }
        if rows.isEmpty {
            return (false, "no slices", [:])
        }
        return (true, "ok", rows)
    }

    /// 事先写好的分档：放声开始 1 秒之后，开时每一片 RMS 不高于关时同一切片的 1/5 为 M。
    /// 等于 1/5 算通过。关时 RMS 为 0 时，开时也必须是 0。有超标为 N，抛错为 E。
    /// 配对不上且没有超标时不判 M，记 unparsed，不重跑。
    private static func playerABSliceResult(off: [String: Any], on: [String: Any], gapStart: Date, gapEnd: Date) -> [String: Any] {
        let sliceSec = Double(playerSliceMs) / 1000
        let gradeFrom = 1000 / playerSliceMs
        var out: [String: Any] = [
            "name": "player-ab-slices",
            "order": ["off", "on"],
            "gapMs": playerABGapMs,
            "gapActualMs": gapEnd.timeIntervalSince(gapStart) * 1000,
            "gapStartedAt": iso8601(gapStart),
            "gapEndedAt": iso8601(gapEnd),
            "sliceMs": playerSliceMs,
            "channel": 0,
            "audioSaved": false,
            "gradeWindowStartSec": 1,
            "fifthRule": "M when every slice with start >= 1s has on RMS <= off RMS / 5; N when any such slice is higher, and lastExceedingSliceStartSec is that slice's start; E if either run threw. Equal to 1/5 passes. Off RMS 0 passes only when on RMS is 0.",
            "convergenceReading": "among paired slices with start >= 0, seconds after the play command at which every later paired slice stays <= 1/5. 0 if none of those slices exceed. null if the last paired slice still exceeds. Not a separate grade.",
            "phase1f": "unchanged K by the pre-written maxAbs rule; not a pass; this run does not regrade it",
            "off": off,
            "on": on,
        ]
        func blankReading() {
            out["comparisonTable"] = NSNull()
            out["lastExceedingSliceStartSec"] = NSNull()
            out["exceedingSliceStartSecs"] = NSNull()
            out["convergenceSec"] = NSNull()
            out["stillExceedingAtEnd"] = NSNull()
            out["unpairedGradeIndices"] = NSNull()
        }
        let offThrew = (off["threw"] as? Bool) == true
        let onThrew = (on["threw"] as? Bool) == true
        if offThrew || onThrew {
            let failed = offThrew ? off : on
            out["outcome"] = "E"
            out["threw"] = true
            out["errorDomain"] = failed["errorDomain"] ?? NSNull()
            out["errorCode"] = failed["errorCode"] ?? NSNull()
            out["errorReason"] = failed["reason"] ?? NSNull()
            out["errorDescription"] = failed["errorDescription"] ?? NSNull()
            blankReading()
            return out
        }
        if (off["outcome"] as? String) == "not-called" || (on["outcome"] as? String) == "not-called" {
            out["outcome"] = "not-called"
            out["threw"] = false
            out["errorDomain"] = NSNull()
            out["errorCode"] = NSNull()
            blankReading()
            return out
        }
        let offMap = sliceMap(off)
        let onMap = sliceMap(on)
        guard offMap.ok, onMap.ok else {
            out["outcome"] = "unparsed"
            out["threw"] = false
            out["errorDomain"] = NSNull()
            out["errorCode"] = NSNull()
            out["unparsedReason"] = [offMap.reason, onMap.reason].filter { $0 != "ok" }.joined(separator: "; ")
            blankReading()
            return out
        }
        let indices = Set(offMap.rows.keys).union(onMap.rows.keys).sorted()
        var table: [[String: Any]] = []
        var exceeding: [Int] = []
        var unpaired: [Int] = []
        var lastPairedFromPlay: Int?
        var lastExceedFromPlay: Int?
        for index in indices {
            let offRow = offMap.rows[index]
            let onRow = onMap.rows[index]
            let paired = offRow != nil && onRow != nil
            let start = Double(index) * sliceSec
            var exceeds: Any = NSNull()
            var ratio: Any = NSNull()
            if let offRow, let onRow {
                let over = onRow.rms > offRow.rms / 5
                exceeds = over
                if offRow.rms != 0 {
                    ratio = NSNumber(value: onRow.rms / offRow.rms)
                }
                if index >= 0 {
                    lastPairedFromPlay = index
                    if over { lastExceedFromPlay = index }
                }
                if index >= gradeFrom && over {
                    exceeding.append(index)
                }
            }
            if index >= gradeFrom && !paired {
                unpaired.append(index)
            }
            let offRms: Any = offRow.map { NSNumber(value: $0.rms) } ?? NSNull()
            let offMax: Any = offRow.map { NSNumber(value: $0.maxAbs) } ?? NSNull()
            let offCount: Any = offRow.map { NSNumber(value: $0.count) } ?? NSNull()
            let onRms: Any = onRow.map { NSNumber(value: $0.rms) } ?? NSNull()
            let onMax: Any = onRow.map { NSNumber(value: $0.maxAbs) } ?? NSNull()
            let onCount: Any = onRow.map { NSNumber(value: $0.count) } ?? NSNull()
            table.append([
                "index": index,
                "startSec": NSNumber(value: start),
                "offRms": offRms,
                "offMaxAbs": offMax,
                "offSampleCount": offCount,
                "onRms": onRms,
                "onMaxAbs": onMax,
                "onSampleCount": onCount,
                "rmsRatioOnOverOff": ratio,
                "inGradeWindow": index >= gradeFrom,
                "paired": paired,
                "exceedsFifth": exceeds,
            ])
        }
        out["comparisonTable"] = table
        out["unpairedGradeIndices"] = unpaired
        if lastPairedFromPlay == nil {
            out["convergenceSec"] = NSNull()
            out["stillExceedingAtEnd"] = NSNull()
        } else if let last = lastExceedFromPlay {
            if last == lastPairedFromPlay {
                out["convergenceSec"] = NSNull()
                out["stillExceedingAtEnd"] = true
            } else {
                out["convergenceSec"] = NSNumber(value: Double(last + 1) * sliceSec)
                out["stillExceedingAtEnd"] = false
            }
        } else {
            out["convergenceSec"] = NSNumber(value: 0)
            out["stillExceedingAtEnd"] = false
        }
        let gradeIndices = indices.filter { $0 >= gradeFrom }
        out["threw"] = false
        out["errorDomain"] = NSNull()
        out["errorCode"] = NSNull()
        if gradeIndices.isEmpty {
            out["outcome"] = "unparsed"
            out["unparsedReason"] = "no slice at or after 1s"
            out["lastExceedingSliceStartSec"] = NSNull()
            out["exceedingSliceStartSecs"] = NSNull()
            return out
        }
        if !exceeding.isEmpty {
            let last = exceeding.max() ?? exceeding[0]
            out["outcome"] = "N"
            out["lastExceedingSliceStartSec"] = NSNumber(value: Double(last) * sliceSec)
            out["exceedingSliceStartSecs"] = exceeding.map { NSNumber(value: Double($0) * sliceSec) }
            return out
        }
        out["exceedingSliceStartSecs"] = []
        out["lastExceedingSliceStartSec"] = NSNull()
        if !unpaired.isEmpty {
            out["outcome"] = "unparsed"
            out["unparsedReason"] = "grade window has a slice on only one side"
            return out
        }
        out["outcome"] = "M"
        return out
    }

    private static func iso8601(_ date: Date) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fmt.string(from: date)
    }

    /// 用 connect 之后引擎已经定下的格式填正弦。填不了就停，不改连接格式再试。
    private enum ToneBuild {
        case buffer(AVAudioPCMBuffer)
        case stopped(String)
    }

    private static func makeTone(format: AVAudioFormat) -> ToneBuild {
        let rate = format.sampleRate
        let channels = Int(format.channelCount)
        guard rate > 0, channels > 0 else { return .stopped("player-format-empty") }
        let frames = AVAudioFrameCount(rate * Double(playerToneMs) / 1000)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else {
            return .stopped("tone-buffer-unavailable")
        }
        buffer.frameLength = frames
        let count = Int(frames)
        guard format.isInterleaved == false else { return .stopped("tone-format-interleaved") }
        switch format.commonFormat {
        case .pcmFormatFloat32:
            guard let data = buffer.floatChannelData else { return .stopped("tone-channel-data-unavailable") }
            for c in 0..<channels {
                for i in 0..<count {
                    data[c][i] = playerToneAmplitude * Float(sin(2 * Double.pi * playerToneHz * Double(i) / rate))
                }
            }
        case .pcmFormatInt16:
            guard let data = buffer.int16ChannelData else { return .stopped("tone-channel-data-unavailable") }
            for c in 0..<channels {
                for i in 0..<count {
                    let unit = playerToneAmplitude * Float(sin(2 * Double.pi * playerToneHz * Double(i) / rate))
                    data[c][i] = Int16(max(-1, min(1, unit)) * 32767)
                }
            }
        case .pcmFormatInt32:
            guard let data = buffer.int32ChannelData else { return .stopped("tone-channel-data-unavailable") }
            for c in 0..<channels {
                for i in 0..<count {
                    let unit = playerToneAmplitude * Float(sin(2 * Double.pi * playerToneHz * Double(i) / rate))
                    data[c][i] = Int32(max(-1, min(1, unit)) * 2147483647)
                }
            }
        default:
            return .stopped("tone-format-unsupported")
        }
        return .buffer(buffer)
    }

    /// 正弦第 0 个采样是 0。返回第一格非 0 的下标，供换算输出延迟。扫不到就记 0。
    private static func firstNonZeroSampleIndex(_ buffer: AVAudioPCMBuffer) -> Int {
        let frames = Int(buffer.frameLength)
        guard frames > 0, buffer.format.isInterleaved == false else { return 0 }
        switch buffer.format.commonFormat {
        case .pcmFormatFloat32:
            guard let data = buffer.floatChannelData else { return 0 }
            for i in 0..<frames where data[0][i] != 0 { return i }
        case .pcmFormatInt16:
            guard let data = buffer.int16ChannelData else { return 0 }
            for i in 0..<frames where data[0][i] != 0 { return i }
        case .pcmFormatInt32:
            guard let data = buffer.int32ChannelData else { return 0 }
            for i in 0..<frames where data[0][i] != 0 { return i }
        default:
            return 0
        }
        return 0
    }

    private static func tapBufferChoice(sampleRate: Double) -> (frames: AVAudioFrameCount?, ms: Double, note: String) {
        guard sampleRate > 0 else {
            return (nil, 0, "sample rate is 0; AVAudioNode.h lines 124-125 require [100, 400] ms and no frame count in that range can be derived")
        }
        let example: AVAudioFrameCount = 8192
        let exampleMs = Double(example) / sampleRate * 1000
        if exampleMs >= 100 && exampleMs <= 400 {
            return (example, exampleMs, "AVAudioNode.h example uses 8192 frames; at this rate that is inside [100, 400] ms")
        }
        let mid = AVAudioFrameCount((sampleRate * 0.2).rounded())
        let midMs = Double(mid) / sampleRate * 1000
        return (mid, midMs, "8192 frames is outside [100, 400] ms at this rate; using 200 ms once, the midpoint of the range in AVAudioNode.h line 124")
    }

    private static func describe(_ format: AVAudioFormat) -> [String: Any] {
        var row = snap(format)
        row["isInterleaved"] = format.isInterleaved
        return row
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

private final class InputFrameStats: @unchecked Sendable {
    private let lock = NSLock()
    private let channelCount: Int
    private var buffers = 0
    private var frames: Int64 = 0
    private var nonzeroFrames: Int64 = 0
    private var nonzeroSamples: [Int64]
    private var maxAbs: [Float]
    private var seen: [Bool]
    private var parsed = true
    private var note: String?
    private var listCount: Int?
    private let phaseLock = NSLock()
    private var playStarted = false
    private var playEnded = false
    private var playStartedAt: Date?
    private var playEndedAt: Date?
    private var segmentFrames: [String: Int64] = [:]
    private var segmentNonzero: [String: Int64] = [:]
    private var segmentMax: [String: Float] = [:]
    private var segmentSumSquares: [String: Double] = [:]
    private var segmentSampleCount: [String: Int64] = [:]
    private var segmentChannelMax: [String: [Float]] = [:]

    init(channelCount: Int) {
        let n = max(channelCount, 0)
        self.channelCount = n
        nonzeroSamples = Array(repeating: 0, count: n)
        maxAbs = Array(repeating: 0, count: n)
        seen = Array(repeating: false, count: n)
    }

    func markPlayStart(_ date: Date) {
        phaseLock.lock()
        playStarted = true
        playStartedAt = date
        phaseLock.unlock()
    }

    func markPlayEnd(_ date: Date) {
        phaseLock.lock()
        playEnded = true
        if playEndedAt == nil { playEndedAt = date }
        phaseLock.unlock()
    }

    func add(_ buffer: AVReadOnlyAudioPCMBuffer) {
        add(buffer, trackPhase: false)
    }

    func add(_ buffer: AVReadOnlyAudioPCMBuffer, trackPhase: Bool) {
        let phase: String? = trackPhase ? currentPhase() : nil
        let nFrames = buffer.frameLength
        var localNonzeroFrames = 0
        var localNonzero = [Int64](repeating: 0, count: channelCount)
        var localMax = [Float](repeating: 0, count: channelCount)
        var localSumSquares = [Double](repeating: 0, count: channelCount)
        var localSampleCount = [Int](repeating: 0, count: channelCount)
        var localSeen = [Bool](repeating: false, count: channelCount)
        var localParsed = true
        var localNote: String?
        var localList: Int?
        if nFrames > 0 && channelCount > 0 {
            let interleaved = buffer.format.isInterleaved
            buffer.withUnsafeAudioBufferList { ptr in
                let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: ptr))
                localList = list.count
                switch buffer.format.commonFormat {
                case .pcmFormatFloat32:
                    Self.scan(list, frames: nFrames, channels: channelCount, interleaved: interleaved, bytesPerSample: MemoryLayout<Float>.size, nonzero: &localNonzero, maxAbs: &localMax, sumSquares: &localSumSquares, sampleCount: &localSampleCount, seen: &localSeen, nonzeroFrames: &localNonzeroFrames) { raw, index in
                        abs(raw.assumingMemoryBound(to: Float.self)[index])
                    }
                case .pcmFormatInt16:
                    Self.scan(list, frames: nFrames, channels: channelCount, interleaved: interleaved, bytesPerSample: MemoryLayout<Int16>.size, nonzero: &localNonzero, maxAbs: &localMax, sumSquares: &localSumSquares, sampleCount: &localSampleCount, seen: &localSeen, nonzeroFrames: &localNonzeroFrames) { raw, index in
                        abs(Float(raw.assumingMemoryBound(to: Int16.self)[index])) / 32768
                    }
                case .pcmFormatInt32:
                    Self.scan(list, frames: nFrames, channels: channelCount, interleaved: interleaved, bytesPerSample: MemoryLayout<Int32>.size, nonzero: &localNonzero, maxAbs: &localMax, sumSquares: &localSumSquares, sampleCount: &localSampleCount, seen: &localSeen, nonzeroFrames: &localNonzeroFrames) { raw, index in
                        abs(Float(raw.assumingMemoryBound(to: Int32.self)[index])) / 2147483648
                    }
                default:
                    localParsed = false
                    localNote = "commonFormat \(buffer.format.commonFormat) has no sample layout in the headers used here"
                }
            }
        }
        lock.lock()
        buffers += 1
        frames += Int64(nFrames)
        if localList != nil { listCount = localList }
        if !localParsed {
            parsed = false
            note = localNote
            if let phase {
                segmentFrames[phase, default: 0] += Int64(nFrames)
            }
        } else {
            nonzeroFrames += Int64(localNonzeroFrames)
            for i in 0..<channelCount {
                if localSeen[i] { seen[i] = true }
                nonzeroSamples[i] += localNonzero[i]
                if localMax[i] > maxAbs[i] { maxAbs[i] = localMax[i] }
            }
            if let phase {
                segmentFrames[phase, default: 0] += Int64(nFrames)
                segmentNonzero[phase, default: 0] += localNonzero.reduce(0, +)
                segmentSumSquares[phase, default: 0] += localSumSquares.reduce(0, +)
                segmentSampleCount[phase, default: 0] += Int64(localSampleCount.reduce(0, +))
                let peak = localMax.max() ?? 0
                if peak > (segmentMax[phase] ?? 0) { segmentMax[phase] = peak }
                var peaks = segmentChannelMax[phase] ?? Array(repeating: 0, count: channelCount)
                for i in 0..<channelCount where localMax[i] > peaks[i] {
                    peaks[i] = localMax[i]
                }
                segmentChannelMax[phase] = peaks
            }
        }
        lock.unlock()
    }

    private func currentPhase() -> String {
        phaseLock.lock()
        defer { phaseLock.unlock() }
        if !playStarted { return "before" }
        if !playEnded { return "during" }
        return "after"
    }

    func phaseMarks() -> (started: Date?, ended: Date?) {
        phaseLock.lock()
        defer { phaseLock.unlock() }
        return (playStartedAt, playEndedAt)
    }

    func segmentSnapshot() -> [String: [String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        var rows: [String: [String: Any]] = [:]
        for key in ["before", "during", "after"] {
            let count = segmentSampleCount[key] ?? 0
            let rms = count > 0 ? sqrt((segmentSumSquares[key] ?? 0) / Double(count)) : 0
            let peaks = segmentChannelMax[key] ?? Array(repeating: 0, count: channelCount)
            rows[key] = [
                "frameCount": NSNumber(value: segmentFrames[key] ?? 0),
                "nonzeroSamples": NSNumber(value: segmentNonzero[key] ?? 0),
                "maxAbs": NSNumber(value: segmentMax[key] ?? 0),
                "rms": NSNumber(value: rms),
                "channelMaxAbs": peaks.map { NSNumber(value: $0) },
            ]
        }
        return rows
    }

    private static func scan(
        _ list: UnsafeMutableAudioBufferListPointer,
        frames: Int,
        channels: Int,
        interleaved: Bool,
        bytesPerSample: Int,
        nonzero: inout [Int64],
        maxAbs: inout [Float],
        sumSquares: inout [Double],
        sampleCount: inout [Int],
        seen: inout [Bool],
        nonzeroFrames: inout Int,
        amplitude: (UnsafeMutableRawPointer, Int) -> Float
    ) {
        if !interleaved {
            let nBuf = min(list.count, channels)
            var hit = [Bool](repeating: false, count: frames)
            for b in 0..<nBuf {
                let audio = list[b]
                guard let data = audio.mData else { continue }
                seen[b] = true
                let count = min(frames, Int(audio.mDataByteSize) / bytesPerSample)
                for i in 0..<count {
                    let value = amplitude(data, i)
                    sumSquares[b] += Double(value) * Double(value)
                    sampleCount[b] += 1
                    if value > maxAbs[b] { maxAbs[b] = value }
                    if value != 0 {
                        nonzero[b] += 1
                        hit[i] = true
                    }
                }
            }
            for flag in hit where flag { nonzeroFrames += 1 }
            return
        }
        guard let audio = list.first, let data = audio.mData else { return }
        let available = Int(audio.mDataByteSize) / bytesPerSample
        for i in 0..<frames {
            var frameHit = false
            for c in 0..<channels {
                let index = i * channels + c
                if index >= available { continue }
                seen[c] = true
                let value = amplitude(data, index)
                sumSquares[c] += Double(value) * Double(value)
                sampleCount[c] += 1
                if value > maxAbs[c] { maxAbs[c] = value }
                if value != 0 {
                    nonzero[c] += 1
                    frameHit = true
                }
            }
            if frameHit { nonzeroFrames += 1 }
        }
    }

    func snapshot() -> (buffers: Int, frames: Int64, nonzeroFrames: Int64, maxAbs: Float, parsed: Bool, note: String?, listCount: Int?, channels: [[String: Any]]) {
        lock.lock()
        defer { lock.unlock() }
        var rows: [[String: Any]] = []
        var peak: Float = 0
        for i in 0..<channelCount {
            if maxAbs[i] > peak { peak = maxAbs[i] }
            var row: [String: Any] = [
                "index": i,
                "seen": seen[i],
                "nonzeroSamples": NSNumber(value: nonzeroSamples[i]),
            ]
            if seen[i] {
                row["allZero"] = nonzeroSamples[i] == 0
                row["maxAbs"] = NSNumber(value: maxAbs[i])
            } else {
                row["allZero"] = NSNull()
                row["maxAbs"] = NSNull()
            }
            rows.append(row)
        }
        return (buffers, frames, nonzeroFrames, peak, parsed, note, listCount, rows)
    }
}

/// 只累计第 0 路。100 毫秒一片，片界按相对放声开始的采样点时间取 floor。
/// 缓冲比一片长，所以在缓冲内部逐个采样切，不按整块缓冲记一片。
/// 原始采样只留到放声时刻已知，随后丢掉，不写进结果。
private final class Channel0Slices: @unchecked Sendable {
    private struct Sample {
        var host: UInt64
        var value: Float
    }
    private struct Bin {
        var sumSquares: Double = 0
        var maxAbs: Float = 0
        var count: Int = 0
    }

    private let lock = NSLock()
    private let sampleRate: Double
    private let sliceSec: Double
    private var timebase = mach_timebase_info_data_t(numer: 0, denom: 0)
    private var playHost: UInt64?
    private var pending: [Sample] = []
    private var bins: [Int: Bin] = [:]
    private var parsed = true
    private var hostValid = true
    private var note: String?
    private var prePlayPeak: Float = 0
    private var firstNonZeroHost: UInt64?
    private var firstNonZeroAtOrAfterPlayHost: UInt64?
    private var firstAbovePrePlayPeakHost: UInt64?

    init(sampleRate: Double, sliceMs: Int) {
        self.sampleRate = sampleRate
        self.sliceSec = Double(sliceMs) / 1000
        let rc = mach_timebase_info(&timebase)
        if rc != 0 || timebase.numer == 0 || timebase.denom == 0 || self.sliceSec <= 0 {
            hostValid = false
            parsed = false
            note = "host timebase or slice length is 0"
        }
    }

    func markPlay(host: UInt64) {
        lock.lock()
        playHost = host
        let queued = pending
        pending.removeAll()
        for item in queued {
            ingestLocked(host: item.host, value: item.value)
        }
        lock.unlock()
    }

    func secondsSincePlay(_ host: UInt64) -> Double? {
        lock.lock()
        defer { lock.unlock() }
        guard let play = playHost, timebase.numer != 0, timebase.denom != 0 else { return nil }
        return secondsBetween(from: play, to: host)
    }

    func add(_ buffer: AVReadOnlyAudioPCMBuffer, when: AVAudioTime) {
        guard when.isHostTimeValid else {
            lock.lock()
            hostValid = false
            lock.unlock()
            return
        }
        let rate = buffer.format.sampleRate
        let frames = Int(buffer.frameLength)
        if rate <= 0 {
            lock.lock()
            parsed = false
            note = "sample rate is 0"
            lock.unlock()
            return
        }
        if frames == 0 { return }
        let channels = Int(buffer.format.channelCount)
        let interleaved = buffer.format.isInterleaved
        var values: [Float] = []
        var supported = true
        buffer.withUnsafeAudioBufferList { ptr in
            let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: ptr))
            switch buffer.format.commonFormat {
            case .pcmFormatFloat32:
                values = Self.channel0(list, frames: frames, channels: channels, interleaved: interleaved, bytesPerSample: MemoryLayout<Float>.size) { raw, index in
                    abs(raw.assumingMemoryBound(to: Float.self)[index])
                }
            case .pcmFormatInt16:
                values = Self.channel0(list, frames: frames, channels: channels, interleaved: interleaved, bytesPerSample: MemoryLayout<Int16>.size) { raw, index in
                    abs(Float(raw.assumingMemoryBound(to: Int16.self)[index])) / 32768
                }
            case .pcmFormatInt32:
                values = Self.channel0(list, frames: frames, channels: channels, interleaved: interleaved, bytesPerSample: MemoryLayout<Int32>.size) { raw, index in
                    abs(Float(raw.assumingMemoryBound(to: Int32.self)[index])) / 2147483648
                }
            default:
                supported = false
            }
        }
        lock.lock()
        if !supported {
            parsed = false
            note = "commonFormat has no sample layout"
            lock.unlock()
            return
        }
        if values.isEmpty {
            parsed = false
            note = "channel 0 has no samples"
            lock.unlock()
            return
        }
        let start = when.hostTime
        let count = values.count
        for i in 0..<count {
            let sampleHost = start &+ hostOffset(samples: i, rate: rate)
            let value = values[i]
            if playHost == nil {
                pending.append(Sample(host: sampleHost, value: value))
            } else {
                ingestLocked(host: sampleHost, value: value)
            }
        }
        lock.unlock()
    }

    func snapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let rows: [[String: Any]] = bins.keys.sorted().map { index in
            let bin = bins[index] ?? Bin()
            let rms = bin.count > 0 ? sqrt(bin.sumSquares / Double(bin.count)) : 0
            return [
                "index": index,
                "startSec": Double(index) * sliceSec,
                "rms": NSNumber(value: rms),
                "maxAbs": NSNumber(value: bin.maxAbs),
                "sampleCount": bin.count,
            ]
        }
        func rel(_ host: UInt64?) -> Any {
            guard let host, let play = playHost, timebase.numer != 0, timebase.denom != 0 else { return NSNull() }
            return NSNumber(value: secondsBetween(from: play, to: host))
        }
        return [
            "parsed": parsed,
            "hostTimeValid": hostValid && timebase.numer != 0 && timebase.denom != 0,
            "note": note ?? NSNull(),
            "sampleRate": sampleRate,
            "sliceMs": sliceSec * 1000,
            "channel": 0,
            "audioSaved": false,
            "playHostTicks": playHost.map { String($0) } ?? NSNull(),
            "prePlayPeak": NSNumber(value: prePlayPeak),
            "tapFirstNonZeroRelSec": rel(firstNonZeroHost),
            "tapFirstNonZeroAtOrAfterPlayRelSec": rel(firstNonZeroAtOrAfterPlayHost),
            "tapFirstAbovePrePlayPeakRelSec": rel(firstAbovePrePlayPeakHost),
            "slices": rows,
        ]
    }

    private func ingestLocked(host: UInt64, value: Float) {
        guard let play = playHost, sliceSec > 0, timebase.numer != 0, timebase.denom != 0 else { return }
        let rel = secondsBetween(from: play, to: host)
        let index = Int(floor(rel / sliceSec))
        var bin = bins[index] ?? Bin()
        bin.sumSquares += Double(value) * Double(value)
        bin.count += 1
        if value > bin.maxAbs { bin.maxAbs = value }
        bins[index] = bin
        if value > 0 && firstNonZeroHost == nil {
            firstNonZeroHost = host
        }
        if host < play {
            if value > prePlayPeak { prePlayPeak = value }
        } else {
            if value > 0 && firstNonZeroAtOrAfterPlayHost == nil {
                firstNonZeroAtOrAfterPlayHost = host
            }
            if value > prePlayPeak && firstAbovePrePlayPeakHost == nil {
                firstAbovePrePlayPeakHost = host
            }
        }
    }

    private func hostOffset(samples: Int, rate: Double) -> UInt64 {
        if samples <= 0 || rate <= 0 || timebase.numer == 0 || timebase.denom == 0 { return 0 }
        let nanos = Double(samples) / rate * 1_000_000_000
        let ticks = nanos * Double(timebase.denom) / Double(timebase.numer)
        if ticks <= 0 { return 0 }
        return UInt64(ticks.rounded())
    }

    private func secondsBetween(from earlier: UInt64, to later: UInt64) -> Double {
        let sign: Double
        let delta: UInt64
        if later >= earlier {
            sign = 1
            delta = later - earlier
        } else {
            sign = -1
            delta = earlier - later
        }
        let nanos = Double(delta) * Double(timebase.numer) / Double(timebase.denom)
        return sign * nanos / 1_000_000_000
    }

    private static func channel0(
        _ list: UnsafeMutableAudioBufferListPointer,
        frames: Int,
        channels: Int,
        interleaved: Bool,
        bytesPerSample: Int,
        amplitude: (UnsafeMutableRawPointer, Int) -> Float
    ) -> [Float] {
        var out: [Float] = []
        if !interleaved {
            guard let audio = list.first, let data = audio.mData else { return [] }
            let count = min(frames, Int(audio.mDataByteSize) / bytesPerSample)
            out.reserveCapacity(count)
            for i in 0..<count {
                out.append(amplitude(data, i))
            }
            return out
        }
        guard channels > 0, let audio = list.first, let data = audio.mData else { return [] }
        let available = Int(audio.mDataByteSize) / bytesPerSample
        let count = frames
        out.reserveCapacity(count)
        for i in 0..<count {
            let index = i * channels
            if index >= available { break }
            out.append(amplitude(data, index))
        }
        return out
    }
}
