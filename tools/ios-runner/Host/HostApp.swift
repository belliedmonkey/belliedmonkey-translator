import SwiftUI

// 空壳宿主：UI 测试 bundle 需要一个目标 App；真正被驱动的是大肚猴翻译与 Safari。
@main
struct HostApp: App {
    var body: some Scene { WindowGroup { Text("S56 host") } }
}
