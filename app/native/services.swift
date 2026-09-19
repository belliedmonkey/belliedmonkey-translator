// app/native/services.swift — macOS 右键「服务」的提供方（docs/learning-design.md §9.9，M-4）。
//
// 标记块，整份 #if os(macOS)。零权限取词的另一半：用户在任何 App 里选中文字 → 右键（或应用菜单）›「服务」›
// 我们那一项，系统把选中的文字放在一块**专用的**剪贴板里交过来 —— 不经过通用剪贴板、不需要任何权限。
// Info.plist 的 NSServices 条目与 12 个语种的菜单名由 scripts/sync-app-assets.js 写（PLIST_KEYS / SERVICES_L10N）；
// 那边的 NSMessage 必须等于下面这个方法名的第一段（npm test 钉着）。
//
// 两件要紧的事 ——
//   · 系统在调用服务时会把我们激活到前台（T2 尖刺实测）。面板的规矩是不抢焦点，所以收到文字的同一刻把焦点
//     还给刚才那个 App。「刚才那个」靠监听激活通知记下来：回调发生时最前面的已经是我们自己了。
//   · 服务是用户**明确点的**，所以不看「在菜单栏常驻」那个开关：开关关着、甚至 App 是被这次点击冷启动的，
//     都照样翻。菜单项本身是 Info.plist 里的静态条目，运行时也撤不掉 —— 点了没反应才是坏行为。
#if os(macOS)
import AppKit

final class MTQuickServices: NSObject {

    static let shared = MTQuickServices()

    private var lastOther: NSRunningApplication?
    private var installed = false

    func install() {
        guard !installed else { return }
        installed = true
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification,
                                                          object: nil, queue: .main) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app.bundleIdentifier != Bundle.main.bundleIdentifier else { return }
            self?.lastOther = app
        }
        NSApp.servicesProvider = self
        NSUpdateDynamicServices()
    }

    /// NSMessage = translateSelection。签名是 AppKit 规定的三段式，改不得。
    @objc func translateSelection(_ pboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString>) {
        let text = pboard.string(forType: .string) ?? ""
        lastOther?.activate()
        MTQuickPanel.shared.translateFromService(text)
    }
}
#endif
