#if DEBUG
// ─────────────────────────────────────────────────────────────────────────────
// MTTestBridge — 分层验证矩阵的 DEBUG-only 控制端点（docs/verification-spec.md §0.4，
// 2026-10-05 用户拍板）。
//
// 为什么原生：WKWebView 没有外部 JS 入口，Mac App / iOS 模拟器里的页面只能从里面被驱动。
// 为什么 DEBUG-only：这是一个能对页面执行任意 JS 的洞。整份文件 #if DEBUG 包住，Release /
// TestFlight 包里**编译器直接裁掉** —— 不是「默认不启动」，是符号不存在
// （抽查：strings <Release 可执行文件> | grep MTTestBridge ⇒ 空）。
//
// 端点（只绑 127.0.0.1，8790–8799 扫第一个空口 —— 开发机上固定口会被占，2026-10-05
// 实测本机 8790 躺着一个 Python http.server；消费者 scripts/test-mac.js 与模拟器层 ——
// 模拟器进程就是 Mac 进程，它的 127.0.0.1 就是宿主的，驱动对同一段范围逐个 /ping 找活的）：
//   GET  /ping   → {"ok":true,"bridge":"mt-test"}            驱动脚本等 App 起来
//   POST /eval   → body 是 JS 源码，在 WKWebView 里求值，回执 {"ok":true,"result":…}
//
// evaluateJavaScript 是同步回执（不等 Promise）：异步操作由页面侧 __mtTest.runAsync()
// 落到 __mtTest.last() 里轮询取 —— 端点保持极简，不是一个通用服务器。
// ─────────────────────────────────────────────────────────────────────────────
import Foundation
import Network
import WebKit

final class MTTestBridge {
    static let shared = MTTestBridge()
    // 8790–8799 扫第一个空口：开发机上任何固定口都可能被占（2026-10-05 实测：本机 8790
    // 恰好躺着一个 Python http.server）。驱动侧对同一段范围逐个 /ping 找活的那个。
    static let portLo: UInt16 = 8790
    static let portHi: UInt16 = 8799

    private weak var webView: WKWebView?
    private var listener: NWListener?

    static func attach(_ view: WKWebView) {
        shared.webView = view
        shared.start(from: MTTestBridge.portLo)
    }

    private func start(from port: UInt16) {
        guard listener == nil, port <= MTTestBridge.portHi else {
            if port > MTTestBridge.portHi {
                NSLog("MTTestBridge: 8790–8799 全被占 — 验证驱动会连不上")
            }
            return
        }
        let params = NWParameters.tcp
        // 只绑回环：局域网里任何其它机器都连不进来。这是 DEBUG 包的先决条件，不是加固项。
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port) ?? 8790)
        params.allowLocalEndpointReuse = true
        do {
            let l = try NWListener(using: params)
            // 绑不上（端口被占）是异步报的：换下一个口再试，不占 App 本体的事。
            l.stateUpdateHandler = { [weak self] state in
                if case .failed = state {
                    l.cancel()
                    if self?.listener === l { self?.listener = nil }
                    self?.start(from: port + 1)
                }
            }
            l.newConnectionHandler = { [weak self] conn in self?.serve(conn) }
            l.start(queue: DispatchQueue(label: "mt.test.bridge.listen"))
            listener = l
        } catch {
            start(from: port + 1)
        }
    }

    // ── 连接：收满一个请求就应答并关掉（Connection: close）。───────────────
    private func serve(_ conn: NWConnection) {
        conn.start(queue: DispatchQueue(label: "mt.test.bridge.conn"))
        read(conn, Data())
    }

    private func read(_ conn: NWConnection, _ buf: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, done, err in
            guard let self else { conn.cancel(); return }
            var buf = buf
            if let data { buf.append(data) }
            if let req = Self.parse(buf) {
                self.respond(conn, to: req)
            } else if done || err != nil || buf.count > (4 << 20) {
                conn.cancel()
            } else {
                self.read(conn, buf)
            }
        }
    }

    /// 极简 HTTP/1.1 解析：头 + Content-Length 定 body。头没收全 / body 没收全都返回
    /// nil（等下一包）。只认识 /ping 与 /eval，别的一律 404。
    private static func parse(_ raw: Data) -> (path: String, body: Data)? {
        guard let headEnd = raw.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        guard let head = String(data: raw[..<headEnd.lowerBound], encoding: .utf8) else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        guard let request = lines.first else { return nil }
        let parts = request.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        var length = 0
        for line in lines.dropFirst() {
            let kv = line.split(separator: ":", maxSplits: 1)
            if kv.count == 2, kv[0].lowercased() == "content-length" {
                length = Int(kv[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        let bodyStart = headEnd.upperBound
        guard raw.count - bodyStart >= length else { return nil }
        return (String(parts[1]), raw[bodyStart..<bodyStart + length])
    }

    private func respond(_ conn: NWConnection, to req: (path: String, body: Data)) {
        if req.path == "/ping" {
            send(conn, 200, #"{"ok":true,"bridge":"mt-test"}"#)
        } else if req.path == "/eval" {
            guard let js = String(data: req.body, encoding: .utf8), !js.isEmpty else {
                send(conn, 400, #"{"ok":false,"error":"empty body"}"#)
                return
            }
            guard let web = webView else {
                send(conn, 503, #"{"ok":false,"error":"no webview"}"#)
                return
            }
            // webView 只许在主线程上碰；应答回到 listener 队列发。
            DispatchQueue.main.async {
                web.evaluateJavaScript(js) { [weak self] result, err in
                    guard let self else { return }
                    var obj: [String: Any] = ["ok": err == nil]
                    if let err {
                        obj["error"] = String(describing: err)
                    } else if result != nil {
                        obj["result"] = result
                    }
                    if let data = try? JSONSerialization.data(withJSONObject: obj),
                       let s = String(data: data, encoding: .utf8) {
                        self.send(conn, 200, s)
                    } else {
                        self.send(conn, 200, #"{"ok":true}"#)
                    }
                }
            }
        } else {
            send(conn, 404, #"{"ok":false,"error":"not found"}"#)
        }
    }

    private func send(_ conn: NWConnection, _ status: UInt, _ body: String) {
        let head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "ERR")\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: \(body.utf8.count)\r\n"
            + "Connection: close\r\n\r\n"
        let data = Data(head.utf8) + Data(body.utf8)
        conn.send(content: data, completion: .contentProcessed { _ in conn.cancel() })
    }
}
#endif
