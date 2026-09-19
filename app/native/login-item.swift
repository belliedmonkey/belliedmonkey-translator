// app/native/login-item.swift — macOS「登录时启动」+ 两个系统设置页的直达（docs/learning-design.md §9.9，M-7）。
//
// 标记块，整份 #if os(macOS)。默认关：开机自启是用户的选择，不是我们的。SMAppService 要 macOS 13；更低的系统上
// status 是 "unsupported"，设置里那一行不出现。状态一律**现读**系统的：用户可以在「系统设置 › 通用 › 登录项」里
// 把它关掉，那时我们存的任何「意图」都是假的。这里没有任何给用户看的文案。
#if os(macOS)
import AppKit
import ServiceManagement

enum MTLoginItem {

    /// "on" | "off" | "approval"（用户要去系统设置里点一下批准）| "unsupported"
    static var status: String {
        guard #available(macOS 13.0, *) else { return "unsupported" }
        switch SMAppService.mainApp.status {
        case .enabled: return "on"
        case .requiresApproval: return "approval"
        default: return "off"
        }
    }

    static func set(_ on: Bool) {
        guard #available(macOS 13.0, *) else { return }
        if on { try? SMAppService.mainApp.register() } else { try? SMAppService.mainApp.unregister() }
    }

    static func openLoginItems() {
        if #available(macOS 13.0, *) { SMAppService.openSystemSettingsLoginItems() }
    }

    /// 给右键「服务」绑快捷键的那一页：系统设置 › 键盘 › 键盘快捷键 › 服务。
    static func openKeyboardShortcuts() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Shortcuts") {
            NSWorkspace.shared.open(url)
        }
    }
}
#endif
