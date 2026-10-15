// scripts/vp-probe-main.swift — 第 1 阶段试验入口。
//
// 无参数：开关关，不建引擎，退出 0。
// --format-only：停着的引擎上打开一次 voice processing。不 start。
//   成功或抛错都退出 0。调用之前引擎已经在跑，则退出 1。
// --on：先做「只开 voice processing、不挂播放节点」，引擎确实 start 了才做第二项
// 「挂一个空的 AVAudioPlayerNode」。第二项 start 之后 frameCount 为 0 就退出 2，
// 不再换顺序、不再改格式。其它失败退出 1。
// 不接受缓冲大小、格式、顺序之类的额外参数。

import Foundation

@main
struct VPProbeMain {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--format-only"] {
            let row = MTVPProbe.runFormatOnly()
            emit([row])
            if (row["outcome"] as? String) == "not-called" {
                exit(1)
            }
            exit(0)
        }
        if args.count > 1 || (args.count == 1 && args[0] != "--on") {
            emit([[
                "name": "refused",
                "switch": "off",
                "engineCreated": false,
                "reason": "unknown-arg",
                "args": args,
            ] as [String: Any]])
            fputs("vp-probe: only --on or --format-only is accepted\n", stderr)
            exit(1)
        }
        let turnOn = args.first == "--on"
        if !turnOn {
            emit([MTVPProbe.run(enabled: MTVPProbe.enabledByDefault, attachPlayer: false)])
            exit(0)
        }
        let first = MTVPProbe.run(enabled: true, attachPlayer: false)
        if (first["started"] as? Bool) != true {
            emit([first])
            exit(1)
        }
        let second = MTVPProbe.run(enabled: true, attachPlayer: true)
        emit([first, second])
        if (second["started"] as? Bool) != true {
            exit(1)
        }
        let frames = second["frameCount"] as? Int ?? (second["frameCount"] as? NSNumber)?.intValue ?? -1
        if frames == 0 {
            fputs("vp-probe: player attached and tap frameCount is 0; stopping\n", stderr)
            exit(2)
        }
        exit(0)
    }

    static func emit(_ rows: [[String: Any]]) {
        let data = try! JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
