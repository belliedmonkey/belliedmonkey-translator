// app/native/hotkey.swift — macOS 全局快捷键（docs/learning-design.md §9.9，决定 D7）。
//
// 标记块，整份 #if os(macOS)。手写 Carbon RegisterEventHotKey：沙盒里可用、**不需要任何权限**
// （T2 尖刺：别的 App 在前台时照样触发），约四十行，不为它加一个依赖。
// 它只知道「键码 + 修饰键 → 回调」，不知道快速翻译是什么；默认组合与录制控件在别处。
#if os(macOS)
import AppKit
import Carbon.HIToolbox

final class MTHotkey {
    static let shared = MTHotkey()
    private static let signature: OSType = 0x4D_54_51_4B   // 'MTQK'

    private var handlerInstalled = false
    private var refs: [UInt32: EventHotKeyRef] = [:]
    private var actions: [UInt32: () -> Void] = [:]

    /// 注册（同一个 id 再注册 = 先换掉旧的）。返回 false = 系统拒绝了这个组合（多半已被占用）。
    @discardableResult
    func register(id: UInt32, keyCode: UInt32, modifiers: UInt32, action: @escaping () -> Void) -> Bool {
        unregister(id: id)
        installHandlerOnce()
        var ref: EventHotKeyRef?
        let hk = EventHotKeyID(signature: MTHotkey.signature, id: id)
        let st = RegisterEventHotKey(keyCode, modifiers, hk, GetApplicationEventTarget(), 0, &ref)
        guard st == noErr, let r = ref else { return false }
        refs[id] = r
        actions[id] = action
        return true
    }

    func unregister(id: UInt32) {
        if let r = refs.removeValue(forKey: id) { UnregisterEventHotKey(r) }
        actions.removeValue(forKey: id)
    }

    fileprivate func fire(_ id: UInt32) { actions[id]?() }

    private func installHandlerOnce() {
        guard !handlerInstalled else { return }
        handlerInstalled = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        // C 回调不能捕获上下文 ⇒ 经单例转发。
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let id = hk.id
            DispatchQueue.main.async { MTHotkey.shared.fire(id) }
            return noErr
        }, 1, &spec, nil, nil)
    }
}
#endif
