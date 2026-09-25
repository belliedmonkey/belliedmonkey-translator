import XCTest
import UIKit

// 模拟器上 `XCUIDeviceButton.volumeUp` 在**编译期**就不可用（不是运行时失败），
// 所以岔路要用条件编译，不能用 if。
enum MTVol {
    static func up() {
        #if !targetEnvironment(simulator)
        XCUIDevice.shared.press(.volumeUp)
        #endif
    }
}

// 尖刺 S5 余项 + S6 真机的遥控：启动大肚猴翻译（带 MT_SPIKE_S56=1，它自己开麦克风、起灵动岛、3 s 后跳 Safari）
// → 等 Safari 到前台 → 点页面上的大按钮播放（真触摸，算用户手势）→ 调高音量 → 按节奏截屏。
// 截图名带 epoch 秒，好与 App 日志（spike-s56.log）对齐。顶部 18% 裁出来看灵动岛，每 30 s 一张整屏看 Safari 状态。
final class S56UITests: XCTestCase {
    private func shot(_ name: String, full: Bool = false) {
        let img = XCUIScreen.main.screenshot().image
        var out = img
        if !full, let cg = img.cgImage {
            let h = Int(Double(cg.height) * 0.18)
            if let c = cg.cropping(to: CGRect(x: 0, y: 0, width: cg.width, height: h)) { out = UIImage(cgImage: c) }
        }
        let a = XCTAttachment(image: out)
        a.name = String(format: "%@-%.3f", name, Date().timeIntervalSince1970)
        a.lifetime = .keepAlways
        add(a)
    }

    private func note(_ s: String) {
        let a = XCTAttachment(string: s)
        a.name = String(format: "note-%.3f", Date().timeIntervalSince1970)
        a.lifetime = .keepAlways
        add(a)
        NSLog("S56UI %@", s)
    }

    // 系统权限框（麦克风 / 语音识别 / 本地网络 / 国行「使用无线数据」）一律点允许。
    // 2026-09-17 用户授权：测试机上由测试程序代点。按文字匹配、按优先级点，绝不按位置点（位置点错=永久拒绝）。
    // 框不存在时 timeout 秒后返回；一次最多连点 4 个（首启可能连弹）。
    private func allowSystemAlerts(_ tag: String, timeout: TimeInterval = 3) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = ["无线局域网与蜂窝网络", "WLAN与蜂窝网络", "Wi-Fi & Cellular Data", "WLAN & Cellular", "允许", "Allow", "允许访问",
                     "使用App时允许", "Allow While Using App", "好", "OK"]
        for _ in 0..<4 {
            let alert = springboard.alerts.firstMatch
            guard alert.waitForExistence(timeout: timeout) else { return }
            guard let label = allow.first(where: { alert.buttons[$0].exists }) else {
                note("alert[\(tag)] 无可点的允许键: " + alert.buttons.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
                shot("alert-\(tag)-unknown", full: true)
                return
            }
            note("alert[\(tag)] \(alert.label) → tap \(label)")
            alert.buttons[label].tap()
            sleep(2)
        }
    }

    // ── 尖刺 T1（2026-09-19）：设置 › App › 翻译 › 默认翻译 App ───────────────────────────
    private func dump(_ app: XCUIApplication, _ tag: String) {
        let cells = app.cells.allElementsBoundByIndex.prefix(40).map { $0.label }.filter { !$0.isEmpty }
        let texts = app.staticTexts.allElementsBoundByIndex.prefix(60).map { $0.label }.filter { !$0.isEmpty }
        note("dump[\(tag)] cells=\(cells.joined(separator: " | ")) ‖ texts=\(texts.joined(separator: " | "))")
    }
    // iOS 27 的设置页里行不是 cell：按文字找任意可点的后代
    private func find(_ app: XCUIApplication, _ pred: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: pred)).firstMatch }
    private func tapText(_ app: XCUIApplication, _ pred: String, swipes: Int = 0, _ tag: String) -> Bool {
        var el = find(app, pred)
        for _ in 0..<swipes where !(el.exists && el.isHittable) { app.swipeUp(); usleep(600_000); el = find(app, pred) }
        guard el.waitForExistence(timeout: 4) else { note("没找到[\(tag)]: \(pred)"); dump(app, tag); shot("t1-miss-\(tag)", full: true); return false }
        el.tap(); sleep(2); return true
    }
    func testT1Default() throws {
        let st = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        st.terminate(); st.launch(); sleep(2)
        guard tapText(st, "label == 'App'", swipes: 8, "root-App") else { return }
        shot("t1-apps", full: true)
        // 2026-09-25：**不要用搜索框**。往里打「翻译」会拉起中文输入法，候选条（过来/的/成/了…）
        // 压在列表上，点「翻译」点到的是候选词 —— 上一轮就是这么失败的，而且报错指向
        //「没找到默认翻译App」，完全指不到真因。直接滚到那一行。
        shot("t1-apps-list", full: true)
        guard tapText(st, "label == '翻译'", swipes: 16, "apps-翻译") else { return }
        shot("t1-translate-page", full: true); dump(st, "translate-page")
        guard tapText(st, "label CONTAINS '默认翻译'", "默认翻译App") else { return }
        shot("t1-default-list", full: true); dump(st, "default-list")
        let ours = find(st, "label CONTAINS '大肚猴' OR label CONTAINS 'T1' OR label CONTAINS 'BelliedMonkey'")
        note("列表里有我们: \(ours.exists) \(ours.exists ? ours.label : "")")
        if ours.exists { ours.tap(); sleep(2); shot("t1-default-picked", full: true); dump(st, "picked") }
    }

    func testT1Host() throws {
        let host = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator")
        host.terminate()
        if let k = ProcessInfo.processInfo.environment["T1_KEY"], !k.isEmpty { host.launchEnvironment["T1_KEY"] = k; note("T1_KEY 已从测试环境传入（\(k.count) 字符）") }
        host.launch(); sleep(2)
        allowSystemAlerts("t1-host-net", timeout: 6)
        sleep(4); shot("t1-host", full: true)
        let b = find(host, "label == '刷新日志'"); if b.exists { b.tap(); sleep(1) }
        shot("t1-host-log", full: true)
    }

    // 可替换的场景：在宿主 App 自己的可编辑文本框里选字 › 翻译 › 替换原文（不碰用户的备忘录）
    func testT1Replace() throws {
        let host = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator")
        host.terminate()
        if let k = ProcessInfo.processInfo.environment["T1_KEY"], !k.isEmpty { host.launchEnvironment["T1_KEY"] = k }
        host.launch(); sleep(3)
        let tv = host.textViews["t1-editor"].exists ? host.textViews["t1-editor"] : host.textViews.firstMatch
        guard tv.waitForExistence(timeout: 5) else { note("宿主里没有文本框"); return }
        tv.tap(); sleep(1); tv.press(forDuration: 1.2); sleep(1)
        let all = find(host, "label == '全选' OR label == 'Select All'"); if all.waitForExistence(timeout: 3) { all.tap(); sleep(1) }
        shot("t1-replace-selected", full: true)
        var tr = find(host, "label == '翻译' OR label == 'Translate'")
        for _ in 0..<4 where !tr.exists {
            guard let last = host.menuItems.allElementsBoundByIndex.last, last.exists else { break }
            // 翻页的「›」没有可用的标签：点最后一个菜单项右边 34 pt 处
            let y = last.frame.midY / host.frame.height   // 「›」在菜单条最右端：屏宽 87.5% 处、与菜单项同一行
            host.coordinate(withNormalizedOffset: CGVector(dx: 0.875, dy: y)).tap(); sleep(1)
            note("翻页后菜单: " + host.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
            tr = find(host, "label == '翻译' OR label == 'Translate'")
        }
        guard tr.exists else { note("选中菜单里没有「翻译」: " + host.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | ")); shot("t1-replace-nomenu", full: true); return }
        tr.tap(); sleep(3)
        let go = find(host, "label == '继续' OR label == 'Continue'"); if go.exists { note("系统告知页再次出现"); go.tap(); sleep(3) }
        sleep(5); shot("t1-replace-sheet", full: true)
        let rep = find(host, "label == '替换原文'")
        note("替换原文 按钮存在: \(rep.exists)")
        if rep.exists { rep.tap(); sleep(3); shot("t1-replace-after", full: true); note("替换后文本框: " + ((tv.value as? String) ?? "(读不到)")) }
    }
    func testT1Stress() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate(); XCUIDevice.shared.system.open(URL(string: "https://example.org/")!); sleep(7)
        let para = safari.webViews.staticTexts.containing(NSPredicate(format: "label CONTAINS 'documentation' OR label CONTAINS 'domain'")).firstMatch
        guard para.waitForExistence(timeout: 8) else { return }
        para.press(forDuration: 1.3); sleep(2)
        let tr = find(safari, "label == '翻译' OR label == 'Translate'"); guard tr.waitForExistence(timeout: 4) else { return }
        tr.tap(); sleep(6)
        let st = find(safari, "label BEGINSWITH '压内存'"); note("压内存按钮: \(st.exists)")
        if st.exists { st.tap(); sleep(25); shot("t1-after-stress", full: true) }
    }

    func testT1Safari() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate(); safari.launch(); sleep(2)
        // 地址栏：点一下 → 输入 → 回车
        // 2026-09-25：页面改成**本机测试页**（MT_T1_URL）—— example.org 不可控，
        // 而且中国版素材本来也不该出现境外站点。选中的那一句由 MT_T1_PICK 指定。
        let url = ProcessInfo.processInfo.environment["MT_T1_URL"] ?? "https://example.org/"
        let pick = ProcessInfo.processInfo.environment["MT_T1_PICK"] ?? "documentation"
        XCUIDevice.shared.system.open(URL(string: url)!); sleep(7)
        shot("t1-safari-page", full: true)
        let para = safari.webViews.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", pick)).firstMatch
        guard para.waitForExistence(timeout: 8) else { note("网页里没找到那段英文"); dump(safari, "safari"); return }
        // 长按只选**一个词**（实测选出 six，弹层里就翻了个「六」——商店片里要的是一整句）。
        // iOS 上三连点选整段；点不出选择菜单时再退回长按。2026-09-25
        // 长按只选一个词（实测 six），三连点也不扩选 ⇒ **按住从句首拖到句尾**，
        // 这是尖刺当年用过的办法（「选区是按坐标拖两行」）。2026-09-25
        let p0 = para.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.25))
        let p1 = para.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.72))
        p0.press(forDuration: 1.1, thenDragTo: p1); sleep(2)
        if safari.menuItems.count == 0 { note("拖选没出菜单，退回长按"); para.press(forDuration: 1.3); sleep(2) }
        shot("t1-safari-callout", full: true)
        // 选中菜单到底挂在谁身上 —— 两个进程、三种 role 全 dump 一遍（上一轮 menuItems 是空的）
        do {
            let sb0 = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            for (nm, a) in [("safari", safari), ("springboard", sb0)] {
                note("[\(nm)] menuItems=" + a.menuItems.allElementsBoundByIndex.prefix(20).map { $0.label }.joined(separator: "|"))
                note("[\(nm)] buttons=" + a.buttons.allElementsBoundByIndex.prefix(30).map { $0.label }.filter { !$0.isEmpty }.joined(separator: "|"))
            }
        }
        var tr = find(safari, "label == '翻译' OR label == 'Translate'")
        if !tr.exists { let more = find(safari, "label CONTAINS '显示更多' OR label CONTAINS 'more' OR label == '前进' OR identifier CONTAINS 'chevron'"); if more.exists { more.tap(); sleep(1); tr = find(safari, "label == '翻译' OR label == 'Translate'") } }
        guard tr.waitForExistence(timeout: 4) else { note("选中菜单里没有「翻译」"); let ms = safari.menuItems.allElementsBoundByIndex.map { $0.label }; note("menuItems=\(ms)"); return }
        tr.tap(); sleep(3)
        shot("t1-sheet-0s", full: true)
        // 系统自己的一次性告知：「所选内容将发送给 … 进行翻译处理。 继续 / 更改默认翻译 App」
        let go = find(safari, "label == '继续' OR label == 'Continue'")
        if go.exists { note("系统告知页出现：" + safari.staticTexts.allElementsBoundByIndex.map { $0.label }.filter { $0.contains("发送") || $0.contains("sent") }.joined(separator: " | ")); go.tap(); sleep(3); shot("t1-sheet-after-consent", full: true) }
        sleep(7)
        shot("t1-sheet-10s", full: true)
        // 弹层在哪个进程里？三处都找一遍
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for (name, app) in [("safari", safari), ("springboard", sb)] {
            let b = find(app, "label == '展开'"); note("展开 按钮在 \(name): \(b.exists)")
            if b.exists { b.tap(); sleep(2); shot("t1-sheet-expanded", full: true)
                let o = find(app, "label == '打开宿主 App'"); if o.exists { o.tap(); sleep(3); shot("t1-after-openurl", full: true) }
                break }
        }
    }

    // 只截一张整屏（看状态栏专注模式图标等），不启动任何 App。
    func testShot() throws {
        shot("shot", full: true)
    }

    // 尖刺 S7：画中画字幕窗。App 带 MT_SPIKE_S7=1 启动（自己开画中画、6 s 后跳 Safari），这里点播放后每 5 s 拍整屏。
    func testS7() throws {
        continueAfterFailure = true
        let app = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator")
        app.launchEnvironment = ["MT_SPIKE_S7": "1", "MT_SPIKE_S7_SECS": "120"]
        app.launch()
        note("s7 app launched")
        sleep(4)
        shot("s7-00-app", full: true)
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let fg = safari.wait(for: .runningForeground, timeout: 25)
        note("s7 safari foreground=\(fg)")
        sleep(4)
        shot("s7-01-safari", full: true)
        let btn = safari.webViews.buttons.firstMatch
        if btn.waitForExistence(timeout: 12) { btn.tap(); note("s7 tapped button") } else { note("s7 no button") }
        sleep(2)
        let t0 = Date()
        while Date().timeIntervalSince(t0) < 110 {
            shot("s7-full", full: true)
            sleep(5)
        }
        note("s7 done")
    }

    // 尖刺 S8：锁屏与待机显示。App 带 MT_SPIKE_S8=1 启动（自己开麦克风、起锁屏卡、3 s 后跳 Safari），这里点播放后
    // 挂着 6 分钟不截屏，留给用户按锁屏键、横放进待机显示。
    func testS8() throws {
        continueAfterFailure = true
        let app = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator")
        app.launchEnvironment = ["MT_SPIKE_S8": "1", "MT_SPIKE_S8_SECS": "390"]
        app.launch()
        note("s8 app launched")
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let fg = safari.wait(for: .runningForeground, timeout: 25)
        note("s8 safari foreground=\(fg)")
        sleep(4)
        let btn = safari.webViews.buttons.firstMatch
        if btn.waitForExistence(timeout: 12) { btn.tap(); note("s8 tapped button") } else { note("s8 no button") }
        sleep(3)
        shot("s8-playing", full: true)
        sleep(360)
        note("s8 done")
    }

    // 修复验证（PR #256）：设置页「还没有 key？去…申请 ↗」「去开通 ↗」点了要打开 Safari。
    // 目标 App 默认中国版；引导页的「跳过 / 稍后」先点掉。
    func testLinks() throws {
        continueAfterFailure = true
        let bid = ProcessInfo.processInfo.environment["MT_TARGET_BUNDLE"] ?? "com.belliedmonkeytranslator.cn"
        let app = XCUIApplication(bundleIdentifier: bid)
        app.launch()
        sleep(5)
        shot("links-00-home", full: true)
        for skip in ["以后再设置", "跳过", "稍后"] {
            let b = app.webViews.buttons[skip].firstMatch
            if b.exists && b.isHittable { b.tap(); note("tapped \(skip)"); sleep(2) }
        }
        // 首页顶上可能压着「Safari 扩展还没打开」的大卡片，把「设置」挤到屏幕外；web 元素的类型也不一定是 button。
        // web 视图把屏幕外的元素也放进无障碍树：先判存在，再上下滑到它可点。
        func find(_ text: String, exact: Bool) -> XCUIElement? {
            let pred = exact ? NSPredicate(format: "label == %@", text) : NSPredicate(format: "label CONTAINS %@", text)
            let e = app.webViews.descendants(matching: .any).matching(pred).firstMatch
            if !e.waitForExistence(timeout: 4) { return nil }
            for _ in 0..<8 { if e.isHittable { return e }; app.swipeDown(); usleep(600_000) }
            for _ in 0..<14 { if e.isHittable { return e }; app.swipeUp(); usleep(600_000) }
            return e.isHittable ? e : nil
        }
        func dump(_ tag: String) {
            let all = app.webViews.descendants(matching: .any).allElementsBoundByIndex.prefix(120)
            note("dump \(tag): " + all.map { "\($0.elementType.rawValue):\($0.label)" }.filter { !$0.hasSuffix(":") }.joined(separator: " | "))
        }
        // 未登录首页上没有「设置」字样的元素；「对话 · 实时听译」那条提示下面的「去设置里选择 →」同样进设置页。
        if let entry = find("设置", exact: true) ?? find("去设置里选择", exact: false) {
            note("open settings via [\(entry.label)]"); entry.tap()
        } else { note("no settings entry"); dump("home") }
        sleep(3)
        if let quick = find("快速", exact: true) { quick.tap(); note("tapped 快速"); sleep(2) } else { note("no 快速 tab"); dump("settings-top") }
        app.swipeDown(); app.swipeDown()
        shot("links-01-settings", full: true)
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        for label in ["还没有 key", "去开通"] {
            guard let link = find(label, exact: false) else { note("no link: \(label)"); dump("settings"); shot("links-miss", full: true); continue }
            var tries = 0
            while !link.isHittable && tries < 6 { app.swipeUp(); tries += 1; sleep(1) }
            note("link [\(label)] label=\(link.label) hittable=\(link.isHittable)")
            link.tap()
            let fg = safari.wait(for: .runningForeground, timeout: 10)
            note("after tap [\(label)]: safari foreground=\(fg)")
            sleep(3)
            shot("links-safari", full: true)
            app.activate()
            sleep(3)
        }
        note("links done")
    }

    // M31（实时字幕 iPhone 一期真机，2026-09-14）：大肚猴翻译首页「实时字幕」→「开始」→ 打开 Safari 测试页（不全屏）→ 点播放
    // → 每 5 s 截整屏（看画中画小窗是否自动浮出、随句滚动、Safari 视频是否被暂停）。
    // 画中画小窗点 ✕ = 暂停听（#289，1.11.0）。2026-09-17 在 14 Pro 上验正式版。
    //
    // 判据不是「界面变样了」，而是**真的停止采集了** —— 界面说停了而麦克风还开着，
    // 正是这个仓库反复付代价的那一类。所以三条里第一条是系统的橙色麦克风指示。
    //
    // 顺序：App 开始听 → 去 Safari 放视频（App 进后台，画中画自动浮出）→ 点小窗露出控件
    // → 点 ✕ → 截整屏看指示 → 回 App 看主按钮 → 点它看能不能接着出字幕。
    func testPiPClose() throws {
        continueAfterFailure = true
        let env = ProcessInfo.processInfo.environment
        let bid = env["MT_TARGET_BUNDLE"] ?? "com.belliedmonkeytranslator.cn"
        let app = XCUIApplication(bundleIdentifier: bid)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        func find(_ text: String, exact: Bool) -> XCUIElement? {
            let pred = exact ? NSPredicate(format: "label == %@", text) : NSPredicate(format: "label CONTAINS %@", text)
            let e = app.webViews.descendants(matching: .any).matching(pred).firstMatch
            if !e.waitForExistence(timeout: 6) { return nil }
            for _ in 0..<8 { if e.isHittable { return e }; app.swipeDown(); usleep(600_000) }
            for _ in 0..<14 { if e.isHittable { return e }; app.swipeUp(); usleep(600_000) }
            return e.isHittable ? e : nil
        }
        func dump(_ tag: String) {
            let all = app.webViews.descendants(matching: .any).allElementsBoundByIndex.prefix(120)
            note("dump \(tag): " + all.map { "\($0.elementType.rawValue):\($0.label)" }.filter { !$0.hasSuffix(":") }.joined(separator: " | "))
        }
        for _ in 0..<10 { MTVol.up(); usleep(200_000) }

        app.launch(); sleep(6)
        allowSystemAlerts("launch")
        // 新装的包首次打开是引导页（「读你真正在读的东西」+ 开始设置 / 以后再设置）——跳过它
        if let skip = find("以后再设置", exact: true) { note("skip onboarding"); skip.tap(); sleep(3) }
        // 首页顶上那条「Safari 扩展还没打开」的横幅会**一直挂着**（实时字幕页上也在），
        // 进商店预览片里等于告诉人「这东西还没配好」。点掉它再拍（2026-09-25）。
        if let ok = find("我已打开", exact: false) { note("dismiss ext banner"); ok.tap(); sleep(2) }
        shot("pip-00-home", full: true)
        if let e = find("实时字幕", exact: true) ?? find("给正在播放的视频", exact: false) {
            note("tap entry [\(e.label)]"); e.tap()
        } else { note("NO 实时字幕 entry"); dump("home") }
        sleep(3); shot("pip-01-prep", full: true)
        if let s = find("开始", exact: true) { note("tap 开始"); s.tap() } else { note("NO 开始"); dump("prep") }
        sleep(2); allowSystemAlerts("start")
        sleep(6); shot("pip-02-listening", full: true)
        dump("listening")

        // 去 Safari 放视频：App 进后台 ⇒ 画中画应当自动浮出
        XCUIDevice.shared.system.open(URL(string: env["MT_PIP_URL"] ?? "http://192.168.50.231:8781/play.html")!)
        note("safari foreground=\(safari.wait(for: .runningForeground, timeout: 20))")
        sleep(3)
        let play = safari.webViews.buttons.firstMatch
        if play.waitForExistence(timeout: 12) { play.tap(); note("tapped play") } else { note("NO play button") }
        sleep(12)
        shot("pip-03-pip-visible", full: true)   // ← 这一张要能看见画中画小窗 + 橙色麦克风指示
        // MT_NO_CLOSE=1：**只看不关**。这个用例本职是去点小窗、露出控件、再点 ✕ ——
        // 那一串控件（⏸ ⏪⏩ ✕）会盖住字幕，拍商店预览片时要的恰恰是它安静滚字幕的样子。
        // 录片时传这个开关，让它多站一会儿就退出（2026-09-25）。
        if env["MT_NO_CLOSE"] == "1" {
            let hold = UInt32(env["MT_HOLD"] ?? "20") ?? 20
            note("MT_NO_CLOSE：不点小窗，静置 \(hold) s 让它滚字幕")
            sleep(hold)
            shot("pip-03b-quiet", full: true)
            return
        }

        // 点小窗露出控件，再点 ✕。小窗是 SpringBoard 的，不在 app 的层级里。
        // 2026-09-17 第四轮实测：这台 14 Pro 上小窗默认浮在**右下角**（宽 0.42–0.97、高 0.63–0.95），
        // 按「右上角」去点会点到 Safari 的视频上。坐标可用 MT_PIP_CX / MT_PIP_CY 覆盖。
        let cx = Double(env["MT_PIP_CX"] ?? "") ?? 0.70
        let cy = Double(env["MT_PIP_CY"] ?? "") ?? 0.79
        // ⚠️ 两轮教训（2026-09-17）：
        //   第五轮：点开后先截图 + 导出按钮清单（≈2.5 s）再找 ✕ —— 控件约 3 秒自动收起，赶不上。
        //   第六轮：按元素点「关闭画中画」—— 确认存在之后、点击那一刻 XCUITest 要重读 SpringBoard
        //           元素树（本身要一两秒），读的时候控件已收，报 No matches found，用例中止。
        // 所以**完全不按元素找**：两个坐标提前算好，点小窗 → 等控件淡入 → 立刻按坐标点 ✕。
        // ✕ 的坐标 (0.48, 0.66) 来自第五轮实测：系统报「关闭画中画」在 (190, 561)，与之吻合。
        let xx = Double(env["MT_PIP_XX"] ?? "") ?? 0.48
        let xy = Double(env["MT_PIP_XY"] ?? "") ?? 0.66
        let winPt = springboard.coordinate(withNormalizedOffset: CGVector(dx: cx, dy: cy))
        let closePt = springboard.coordinate(withNormalizedOffset: CGVector(dx: xx, dy: xy))
        winPt.tap()
        usleep(700_000)          // 控件淡入
        closePt.tap()
        note("tapped pip window (\(cx), \(cy)) then ✕ at (\(xx), \(xy)) by coordinate")
        sleep(1)
        note("sb buttons after close: " + springboard.buttons.allElementsBoundByIndex.prefix(20).map { $0.label }.joined(separator: " | "))
        sleep(4)
        shot("pip-05-after-close", full: true)   // ← 判据①：橙色麦克风指示应当消失

        // 判据②③：回 App，主按钮应当是「继续」，点它应当接着出字幕
        app.activate(); sleep(4)
        shot("pip-06-back-in-app", full: true)
        if let cont = find("继续", exact: true) {
            note("FOUND 继续 — tapping"); cont.tap(); sleep(10)
            shot("pip-07-resumed", full: true)
            dump("resumed")
        } else {
            note("NO 继续 button"); dump("back-in-app")
        }
        note("pip done")
    }

    // 谁在占用麦克风：读状态栏与控制中心里系统写出来的无障碍文字（2026-09-17）。
    func testMicWho() throws {
        continueAfterFailure = true
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        func dumpSB(_ tag: String) {
            let all = sb.descendants(matching: .any).allElementsBoundByIndex.prefix(400)
            let hits = all.map { "\($0.label)|\($0.value as? String ?? "")" }
                .filter { $0.range(of: "麦克风|麦克|录音|录制|正在使用|Microphone|recording|使用中|音频|听|Live", options: .regularExpression) != nil }
            note("mic[\(tag)]: " + (hits.isEmpty ? "(无匹配)" : hits.joined(separator: " || ")))
        }
        dumpSB("home")
        // 打开控制中心：从右上角往下拉
        let start = sb.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.005))
        let end = sb.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.6))
        start.press(forDuration: 0.1, thenDragTo: end)
        sleep(3)
        shot("mic-cc", full: true)
        dumpSB("control-center")
        // 收起控制中心
        XCUIDevice.shared.press(.home)
        sleep(1)
    }

    // 关掉辅助功能「语音控制」——它一直占着麦克风（控制中心显示「Voice Control」），
    // 会让画中画 ✕ 验证的判据①（橙点消失）永远不成立（2026-09-17）。
    func testVoiceControlOff() throws {
        continueAfterFailure = true
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.terminate()
        settings.launch(); sleep(3)
        let search = settings.searchFields.firstMatch
        if !search.waitForExistence(timeout: 5) { settings.swipeDown(); sleep(1) }
        if search.waitForExistence(timeout: 5) {
            search.tap(); sleep(1); search.typeText("语音控制"); sleep(3)
        } else { note("vc NO search field") }
        shot("vc-01-search", full: true)
        let hit = settings.cells.matching(NSPredicate(format: "label CONTAINS '语音控制' OR label CONTAINS 'Voice Control'")).firstMatch
        if hit.waitForExistence(timeout: 6) { note("vc tap result [\(hit.label)]"); hit.tap(); sleep(3) }
        else {
            let any = settings.staticTexts.matching(NSPredicate(format: "label CONTAINS '语音控制'")).firstMatch
            if any.waitForExistence(timeout: 4) { note("vc tap text [\(any.label)]"); any.tap(); sleep(3) } else { note("vc NO result") }
        }
        shot("vc-02-page", full: true)
        let sw = settings.switches.matching(NSPredicate(format: "label CONTAINS '语音控制' OR label CONTAINS 'Voice Control'")).firstMatch
        if sw.waitForExistence(timeout: 6) {
            let v = (sw.value as? String) ?? ""
            note("vc switch [\(sw.label)] value=\(v)")
            if v == "1" {
                // 点元素中心会落在左侧文字上、拨不动开关 —— 点右侧拨钮的位置
                sw.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap(); sleep(3)
                note("vc after right-tap value=\((sw.value as? String) ?? "")")
                if ((sw.value as? String) ?? "") == "1" {
                    let inner = sw.switches.firstMatch
                    if inner.exists { inner.tap(); sleep(3) }
                    note("vc after inner-tap value=\((sw.value as? String) ?? "")")
                }
            }
        } else {
            note("vc NO switch; switches: " + settings.switches.allElementsBoundByIndex.prefix(10).map { "\($0.label)=\(($0.value as? String) ?? "")" }.joined(separator: " | "))
        }
        shot("vc-03-after", full: true)
        XCUIDevice.shared.press(.home); sleep(2)
    }

    // 新装的正式版没配转写引擎 ⇒ 实时字幕入口是灰的。选「设备内置转写」（免费、离线、无需 key）。


    // ── V 段（2026-09-20）：1.14.0 (110) 的真机验收 ──────────────────────────────
    // A 回执 / B 发现横幅 / C 系统翻译弹层 / D 收件箱进复习库 / E「完成」按钮证伪
    private let BT = "com.belliedmonkeytranslator"

    /// 把当前前台 App 的可读元素抄一遍，配一张整屏。
    private func survey(_ app: XCUIApplication, _ tag: String) {
        func pick(_ q: XCUIElementQuery, _ n: Int) -> [String] {
            var seen = Set<String>(); var out: [String] = []
            for e in q.allElementsBoundByIndex.prefix(n) {
                let l = e.label.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !l.isEmpty, !seen.contains(l) else { continue }
                seen.insert(l); out.append(l)
            }
            return out
        }
        note("survey[\(tag)] statics=" + pick(app.staticTexts, 80).joined(separator: " ‖ "))
        note("survey[\(tag)] buttons=" + pick(app.buttons, 40).joined(separator: " ‖ "))
        shot("v-\(tag)", full: true)
    }

    /// 滚到某个元素上（WKWebView 里屏幕外的元素也在树里，要滚到 hittable 才点得动）
    @discardableResult
    private func scrollTo(_ app: XCUIApplication, _ make: () -> XCUIElement, _ n: Int = 8) -> XCUIElement {
        var e = make()
        for _ in 0..<n where !(e.exists && e.isHittable) { app.swipeUp(); usleep(650_000); e = make() }
        return e
    }


    /// 往一个（可能已经有回显内容的）密钥框里放一把 key。
    ///
    /// **必须先清空。** 一键卡与详细档的 key 框都会**回显已保存的 key**，直接 typeText
    /// 是往后面追加 —— 2026-09-20 实测追到了 347 个字符（应为 35），服务端回 401，
    /// 而界面上那一框圆点看起来和正常的一模一样。判据是**圆点数 == key 长度**。
    @discardableResult
    private func enterKey(_ app: XCUIApplication, _ field: XCUIElement, _ k: String, _ tag: String) -> Bool {
        field.tap(); sleep(1)
        // **必须先清空。** 一键卡与详细档的 key 框都会回显已保存的 key，直接 typeText 是
        // 往后面追加 —— 实测追到 347 个字符（应为 35），服务端回 401，而界面上那一框圆点
        // 看起来和正常的完全一样。判据是**圆点数 == key 长度**（密码框的 value 就是圆点）。
        //
        // 清空用**退格**，不用「全选 → 输入替换」：长按菜单会把焦点拿走，实测全选之后
        // typeText 与粘贴都不落地（347 一个字没变）。光标在末尾，退格一定生效。
        // 清空只能**按住屏幕键盘上的删除键**触发连续删除：
        //  · `typeText(XCUIKeyboardKey.delete)` 送不进 WKWebView 的密码框（实测 347 → 347），
        //    而同一次 typeText 打字符却能进（347 → 382）—— 所以不是焦点问题，是这个键不落地。
        //  · 「全选 → 输入替换」也不行：长按菜单把焦点拿走了，之后输入与粘贴都不落地。
        let before = ((field.value as? String) ?? "").count
        var cleared = before
        if before > 0 {
            let del = app.keys["delete"].exists ? app.keys["delete"]
                : (app.keys["Delete"].exists ? app.keys["Delete"] : app.buttons["delete"])
            if del.exists {
                for _ in 0..<6 {
                    del.press(forDuration: 4.0); usleep(400_000)
                    cleared = ((field.value as? String) ?? "").count
                    if cleared == 0 { break }
                }
            } else {
                note("[\(tag)] 找不到键盘上的删除键: " + app.keys.allElementsBoundByIndex.prefix(12).map { $0.label }.joined(separator: "|"))
            }
        }
        note("[\(tag)] 清空：\(before) → \(cleared)")
        app.typeText(k); sleep(1)
        let n = ((field.value as? String) ?? "").count
        note("[\(tag)] 密钥框 \(n) 个字符（应为 \(k.count)）\(n == k.count ? " ✓" : " ✗")")
        return n == k.count
    }

    // ── V1 · A 段：「配好了」的回执 ─────────────────────────────────────────────
    //
    // 判据不是「最后出现了绿字」，是**形状**：按下那一刻就该先摆出占位行（`测试中…`），
    // 再逐行落成 ✓/✗。所以按下之后立刻截一张 —— 晚一秒就分不清「一开始就有」和
    // 「成功后才冒出来」，而那两种形状对失败的人来说天差地别
    // （quick-setup.js:483 的原注释：「那种形状让失败看起来像什么都没发生」）。
    func testV1Receipt() throws {
        let env = ProcessInfo.processInfo.environment
        let app = XCUIApplication(bundleIdentifier: BT)
        app.terminate(); app.launch(); sleep(4)
        guard tapText(app, "label == '设置'", "设置") else { return }
        sleep(2)

        var useKey = env["MT_KEY_OPENROUTER"] ?? ""
        var which = "openrouter"

        // 平台下拉是**弹出菜单**，不是 pickerWheel（22:44 那轮真机读回：两项）。
        let plat = scrollTo(app, { app.buttons.matching(NSPredicate(format: "value CONTAINS 'openrouter.ai' OR value CONTAINS 'api.openai.com'")).firstMatch })
        if plat.exists && plat.isHittable {
            note("平台当前: \((plat.value as? String) ?? "-")")
            plat.tap(); sleep(2); shot("v1-menu", full: true)
            // 要哪个平台由 MT_PLATFORM 决定（openai / openrouter）。默认 openai。
            let want = env["MT_PLATFORM"] ?? "openai"
            let host = want == "openrouter" ? "openrouter.ai" : "api.openai.com"
            let items = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS %@", host)).allElementsBoundByIndex
            note("菜单里含 \(host) 的元素: " + items.map { "[t\($0.elementType.rawValue)|\($0.label.prefix(32))|hit=\($0.isHittable)]" }.joined(separator: " "))
            let k = (want == "openrouter" ? env["MT_KEY_OPENROUTER"] : env["MT_KEY_OPENAI"]) ?? ""
            if !k.isEmpty, let hit = items.first(where: { $0.isHittable && $0.elementType == .button }) {
                hit.tap(); sleep(2); useKey = k; which = want
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap(); sleep(1)
            }
            let now = app.buttons.matching(NSPredicate(format: "value CONTAINS 'openrouter.ai' OR value CONTAINS 'api.openai.com'")).firstMatch
            note("平台选定: \((now.value as? String) ?? "-")")
        } else { note("没找到平台下拉，沿用当前平台") }

        note("这一轮用的 key: \(which)（\(useKey.count) 字符）")
        guard !useKey.isEmpty else { note("没有可用的 key，停"); return }

        // 填 key：剪贴板 + 长按粘贴（长 key 用 typeText 不稳）
        UIPasteboard.general.string = useKey
        let key = scrollTo(app, { app.secureTextFields.firstMatch })
        guard key.exists && key.isHittable else { note("没滚到密钥框"); shot("v1-nokey", full: true); return }
        enterKey(app, key, useKey, "quick")
        // 收键盘：点一下卡片空白处
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap(); sleep(1)
        shot("v1-filled", full: true)

        // 按下「配好」—— 然后**立刻**截图
        let go = scrollTo(app, { self.find(app, "label BEGINSWITH '配好'") }, 5)
        guard go.exists && go.isHittable else { note("找不到「配好翻译、朗读、转写」"); shot("v1-nogo", full: true); return }
        go.tap()
        usleep(250_000); shot("v1-t0.25s", full: true)     // ← 判据在这张上：占位行在不在
        usleep(750_000); shot("v1-t1s", full: true)
        for t in [3, 6, 10, 16, 24] {
            sleep(UInt32(t == 3 ? 2 : (t == 6 ? 3 : (t == 10 ? 4 : (t == 16 ? 6 : 8)))))
            allowSystemAlerts("v1-\(t)s", timeout: 1)
            shot("v1-t\(t)s", full: true)
        }
        survey(app, "v1-after")
    }


    /// V0e：这台手机到底够不够得着 api.openai.com —— 用 Safari 独立验一次。
    /// App 里报「连不上」时，先分清是网络路由还是我们的代码。/v1/models 不带 key
    /// 会回 401 JSON：**能看到 401 就说明路是通的**。
    func testV0Net() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        XCUIDevice.shared.system.open(URL(string: "https://api.openai.com/v1/models")!)
        sleep(9)
        shot("v0net-openai", full: true)
        let texts = safari.webViews.staticTexts.allElementsBoundByIndex.prefix(10).map { $0.label }
        note("openai 页面文字: " + texts.joined(separator: " ⏎ ").prefix(400))
        XCUIDevice.shared.system.open(URL(string: "https://api.deepseek.com/v1/models")!)
        sleep(9)
        shot("v0net-deepseek", full: true)
        let t2 = safari.webViews.staticTexts.allElementsBoundByIndex.prefix(10).map { $0.label }
        note("deepseek 页面文字: " + t2.joined(separator: " ⏎ ").prefix(400))
    }


    /// V2：把有效翻译引擎设回 DeepSeek。
    ///
    /// App 里**没有主翻译引擎的控件**（index.html 只有 notes-provider / tts-engine /
    /// stt-engine），主引擎只能由一键卡或领免费额度写。而 `LearnNotes.resolveConfig`
    /// 里 notesProvider 优先于 provider，系统翻译镜像（vault-mirror.js）与快速翻译
    /// 都走它 —— 所以「详细 › 句子解析」设成 DeepSeek 就能让下游真的翻得出东西。
    func testV2Restore() throws {
        let env = ProcessInfo.processInfo.environment
        guard let k = env["MT_KEY_DEEPSEEK"], !k.isEmpty else { note("没有 DeepSeek key"); return }
        let app = XCUIApplication(bundleIdentifier: BT)
        app.terminate(); app.launch(); sleep(4)
        allowSystemAlerts("v2-net", timeout: 3)
        // 新装的包先进引导（1.15.0 起），跳过它才看得到首页的「设置」
        if let later = waitAny(app, ["elementType == 9 AND label == '以后再设置'"], 3) { later.tap(); sleep(2) }
        guard tapText(app, "label == '设置'", "设置") else { return }
        sleep(2)
        // 切到「详细」
        let adv = scrollTo(app, { self.find(app, "label == '详细'") }, 4)
        guard adv.exists && adv.isHittable else { note("找不到「详细」"); shot("v2-noadv", full: true); return }
        adv.tap(); sleep(2); shot("v2-adv", full: true)

        // 解析引擎下拉：带值的按钮（值是引擎名）。列表长 ⇒ 菜单要滚。
        let sel = scrollTo(app, { app.buttons.matching(NSPredicate(format: "value != nil AND value != ''")).element(boundBy: 0) }, 6)
        note("解析引擎当前: \((sel.value as? String) ?? "-")")
        sel.tap(); sleep(2); shot("v2-menu", full: true)
        var item = find(app, "label CONTAINS 'DeepSeek' OR label CONTAINS 'deepseek'")
        for _ in 0..<6 where !(item.exists && item.isHittable) { app.swipeUp(); usleep(600_000); item = find(app, "label CONTAINS 'DeepSeek' OR label CONTAINS 'deepseek'") }
        guard item.exists && item.isHittable else {
            note("菜单里没有 DeepSeek: " + app.buttons.allElementsBoundByIndex.prefix(30).map { $0.label }.joined(separator: " | "))
            shot("v2-nodeepseek", full: true); return
        }
        item.tap(); sleep(2)
        let now = app.buttons.matching(NSPredicate(format: "value != nil AND value != ''")).element(boundBy: 0)
        note("解析引擎改为: \((now.value as? String) ?? "-")")
        shot("v2-picked", full: true)

        // key：详细档第一个密码框就是解析那一格
        UIPasteboard.general.string = k
        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        guard key.exists && key.isHittable else { note("没找到解析的密钥框"); shot("v2-nokey", full: true); return }
        enterKey(app, key, k, "notes")
        // 失焦才保存（这一格是 change 触发）
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)).tap(); sleep(2)
        shot("v2-filled", full: true)

        // **判据是「测试连接」真的通了**，不是「我点过保存了」
        let test = scrollTo(app, { self.find(app, "label == '测试连接'") }, 5)
        guard test.exists && test.isHittable else { note("找不到「测试连接」"); shot("v2-notest", full: true); return }
        test.tap()
        for t in [2, 4, 8, 14] { sleep(UInt32(t == 2 ? 2 : 3)); shot("v2-test-\(t)s", full: true) }
        survey(app, "v2-after")
    }


    // ── V3 · C + D：系统翻译弹层，以及翻过的句子有没有进复习库 ──────────────────
    //
    // **要翻三句不同的**（不是同一句翻三遍）：#373 修的是收件箱文件名里的毫秒时间戳被
    // `%d` 按 32 位截成负数，而「删最旧的」与「按顺序读」全靠「文件名有序 = 时间有序」。
    // 只翻一句，错位看不出来。
    func testV3SheetAndInbox() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let app = XCUIApplication(bundleIdentifier: BT)
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        // 先把 App 前台过一次：收件箱是在回前台时收的，先清掉之前可能积的
        app.terminate(); app.launch(); sleep(5)
        survey(app, "v3-before")

        safari.terminate()
        XCUIDevice.shared.system.open(URL(string: "https://example.org/")!); sleep(8)
        shot("v3-page", full: true)

        // example.org 正文只有两段，够翻两句；再加一次标题，凑三次不同的选区
        let targets = ["label CONTAINS 'documentation examples'",
                       "label == 'Learn more'",
                       "label CONTAINS 'Example Domain'"]
        var done = 0
        for (i, pred) in targets.enumerated() {
            let para = safari.webViews.staticTexts.matching(NSPredicate(format: pred)).firstMatch
            guard para.waitForExistence(timeout: 8) else { note("第 \(i+1) 段没找到: \(pred)"); continue }
            para.press(forDuration: 1.3); sleep(2)
            var tr = find(safari, "label == '翻译' OR label == 'Translate'")
            if !tr.exists {
                // 菜单要翻页：点菜单条最右端的「›」
                if let last = safari.menuItems.allElementsBoundByIndex.last, last.exists {
                    let y = last.frame.midY / safari.frame.height
                    safari.coordinate(withNormalizedOffset: CGVector(dx: 0.875, dy: y)).tap(); sleep(1)
                    tr = find(safari, "label == '翻译' OR label == 'Translate'")
                }
            }
            guard tr.waitForExistence(timeout: 4) else {
                note("第 \(i+1) 次：菜单里没有「翻译」: " + safari.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
                shot("v3-nomenu-\(i+1)", full: true); continue
            }
            tr.tap(); sleep(3)
            // 系统那一次性告知页
            let go = find(safari, "label == '继续' OR label == 'Continue'")
            if go.exists { note("系统告知页出现（第 \(i+1) 次）"); go.tap(); sleep(3) }
            sleep(7)
            shot("v3-sheet-\(i+1)", full: true)
            for (who, a) in [("safari", safari), ("springboard", sb)] {
                let texts = a.staticTexts.allElementsBoundByIndex.prefix(24).map { $0.label }.filter { !$0.isEmpty }
                let btns = a.buttons.allElementsBoundByIndex.prefix(16).map { $0.label }.filter { !$0.isEmpty }
                if btns.contains(where: { $0.contains("完成") || $0.contains("复制") }) {
                    note("sheet\(i+1)[\(who)] texts=" + texts.joined(separator: " | "))
                    note("sheet\(i+1)[\(who)] buttons=" + btns.joined(separator: " | "))
                }
            }
            done += 1
            // 关掉弹层：下滑
            safari.swipeDown(); sleep(2)
        }
        note("弹层翻了 \(done) 次")

        // D：回 App（收件箱在回前台时收），看来源与卡
        app.activate(); sleep(8)
        shot("v3-app-back", full: true)
        survey(app, "v3-after")
    }


    // ── V4 · E（+ C×3 + D）：点「完成」到底关不关弹层 ──────────────────────────
    //
    // 用户 2026-09-20 报「点完成没用」。T1 尖刺只验过**带译文替换**那条
    // （READINGS.md:494），`context.finish(translation: nil)` 一次都没测过，
    // 而尖刺那份实现与出货这份不是同一份代码。
    //
    // **判据是弹层还在不在**，不是「点过了」：点完之后查「大肚猴翻译」这个标题
    // 还在不在元素树里。顺带翻三段不同的文字喂收件箱（#373 的顺序要多于一条才看得出来）。
    func testV4Finish() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let app = XCUIApplication(bundleIdentifier: BT)

        // **开头的等待窗口**：测试程序启动时要联网校验开发者证书，而那一步在 VPN 开着时
        // 过不去；翻译却又要 VPN（引擎是 OpenAI）。所以「关 VPN 起测试 → 起来之后再开 VPN」。
        // MT_WARMUP 秒由调用方给，默认 0。
        let warm = UInt32(ProcessInfo.processInfo.environment["MT_WARMUP"] ?? "0") ?? 0
        if warm > 0 { note("等 \(warm) 秒，请在这段时间里把 VPN 打开"); sleep(warm) }

        safari.terminate()
        XCUIDevice.shared.system.open(URL(string: "https://example.org/")!); sleep(8)

        // 正文那一段：在三个不同的横向位置长按，选中三个不同的词
        let para = safari.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS 'documentation examples'")).firstMatch
        guard para.waitForExistence(timeout: 8) else {
            note("没找到正文段: " + safari.webViews.staticTexts.allElementsBoundByIndex.prefix(8).map { $0.label.prefix(40) }.joined(separator: " | "))
            shot("v4-nopara", full: true); return
        }
        let f = para.frame
        let spots: [(String, CGPoint)] = [
            ("左", CGPoint(x: f.minX + f.width * 0.22, y: f.minY + f.height * 0.18)),
            ("中", CGPoint(x: f.minX + f.width * 0.45, y: f.minY + f.height * 0.50)),
            ("右", CGPoint(x: f.minX + f.width * 0.30, y: f.minY + f.height * 0.82)),
        ]
        var opened = 0, closed = 0
        for (i, sp) in spots.enumerated() {
            let n = i + 1
            let c = safari.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: sp.1.x, dy: sp.1.y))
            c.press(forDuration: 1.3); sleep(2)
            var tr = find(safari, "label == '翻译' OR label == 'Translate'")
            if !tr.exists, let last = safari.menuItems.allElementsBoundByIndex.last, last.exists {
                let y = last.frame.midY / safari.frame.height
                safari.coordinate(withNormalizedOffset: CGVector(dx: 0.875, dy: y)).tap(); sleep(1)
                tr = find(safari, "label == '翻译' OR label == 'Translate'")
            }
            guard tr.waitForExistence(timeout: 4) else { note("第 \(n) 次（\(sp.0)）菜单里没有「翻译」"); continue }
            tr.tap(); sleep(3)
            let go = find(safari, "label == '继续' OR label == 'Continue'")
            if go.exists { go.tap(); sleep(3) }
            sleep(7)
            shot("v4-sheet-\(n)", full: true)
            let title = find(safari, "label == '大肚猴翻译'")
            let pair = safari.staticTexts.allElementsBoundByIndex.prefix(24).map { $0.label }.filter { !$0.isEmpty }
            note("第 \(n) 次（\(sp.0)）弹层在: \(title.exists)；文字=" + pair.joined(separator: " | ").prefix(220))
            guard title.exists else { continue }
            opened += 1

            // ★ 点「完成」
            // **先等译文真的出来**，别在「正在翻译…」上点「完成」—— 那是两种状态，
            // 而用户报的是译文已出之后点没用。
            var settled = false
            for _ in 0..<12 {
                let busy = find(safari, "label CONTAINS '正在翻译' OR label CONTAINS '还在翻'")
                if !busy.exists { settled = true; break }
                sleep(3)
            }
            note("第 \(n) 次：译文落定 = \(settled)")
            shot("v4-settled-\(n)", full: true)
            let fin = find(safari, "label == '完成' OR label == 'Done'")
            note("第 \(n) 次「完成」按钮: exists=\(fin.exists) hittable=\(fin.exists && fin.isHittable)")
            if fin.exists && fin.isHittable {
                fin.tap()
                sleep(2); shot("v4-after-finish-\(n)", full: true)
                let still = find(safari, "label == '大肚猴翻译'")
                note("★ 第 \(n) 次点完「完成」2 秒后，弹层还在: \(still.exists)")
                sleep(4)
                let still2 = find(safari, "label == '大肚猴翻译'")
                note("★ 第 \(n) 次点完「完成」6 秒后，弹层还在: \(still2.exists)")
                if !still2.exists { closed += 1 } else {
                    // 没关掉 ⇒ 用 ✕ 关，好继续下一轮
                    let x = find(safari, "label == '关闭' OR label == 'Close'")
                    if x.exists && x.isHittable { x.tap(); sleep(2) } else { safari.swipeDown(); sleep(2) }
                }
            }
        }
        note("★★ 汇总：弹层开了 \(opened) 次，点「完成」真的关掉 \(closed) 次")

        // D：回 App 收收件箱
        app.activate(); sleep(10)
        shot("v4-app-back", full: true)
        survey(app, "v4-after")
    }


    // ── V6 · E 的决定性实验：在**可编辑**的地方点「完成」 ─────────────────────────
    //
    // 09-20 已证：网页里（allowsReplacement == false）点「完成」0/3 关不掉，译文出没出来都一样。
    // 但两个变量纠缠着：`finish(translation: nil)` 本身空操作？还是苹果在不可替换时忽略 finish？
    // T1 尖刺验过的是 `finish(translation: 有值)` 且在可编辑处，那次关掉了。
    //
    // 拆法：在**可编辑**的输入框里走同一条路，点的仍是「完成」（= finish(nil)）。
    //   关掉了 ⇒ finish(nil) 没问题，是「不可替换时被忽略」   ⇒ 不可替换时不画这个按钮
    //   还不关 ⇒ finish(nil) 本身就是空操作                  ⇒ 这个按钮整个删掉
    //
    // 用自己 App 的「屏蔽规则」输入框：不按「添加」就不会存，不碰用户任何数据。
    func testV6FinishEditable() throws {
        let app = XCUIApplication(bundleIdentifier: BT)
        let warm = UInt32(ProcessInfo.processInfo.environment["MT_WARMUP"] ?? "0") ?? 0
        if warm > 0 { note("等 \(warm) 秒，请打开 VPN"); sleep(warm) }

        app.terminate(); app.launch(); sleep(4)
        guard tapText(app, "label == '设置'", "设置") else { return }
        sleep(2)
        // 滚到「屏蔽规则」那个输入框（placeholder 例如 *.example.com）。
        //
        // **按下标拿，不按 value 拿。** XCUIElement 是**惰性查询**不是句柄：按
        // `value CONTAINS 'example.com'` 找到它，一旦打了字 value 就变了，同一个查询
        // 之后什么都匹配不到（报 `Failed to get matching snapshot: No matches found`）。
        var idx = -1
        for _ in 0..<10 {
            let all = app.textFields.allElementsBoundByIndex
            for (i, e) in all.enumerated() where ((e.value as? String) ?? "").contains("example.com") {
                if e.isHittable { idx = i; break }
            }
            if idx >= 0 { break }
            app.swipeUp(); usleep(650_000)
        }
        guard idx >= 0 else {
            note("没滚到屏蔽规则输入框: " + app.textFields.allElementsBoundByIndex.prefix(8).map { ($0.value as? String) ?? "-" }.joined(separator: " | "))
            shot("v6-nobox", full: true); return
        }
        let box = app.textFields.element(boundBy: idx)
        note("屏蔽规则输入框下标 \(idx)")
        box.tap(); sleep(1)
        let sentence = "Good morning everyone"
        app.typeText(sentence); sleep(1)
        note("输入框里: \(((box.value as? String) ?? "").prefix(40))")
        shot("v6-typed", full: true)

        // 选中整句：长按 → 全选
        box.press(forDuration: 1.3); sleep(2)
        var all = find(app, "label == '全选' OR label == 'Select All'")
        if !all.exists && app.menuItems.count == 0 {   // 1.15.0 验收：长按有时不出菜单 —— 双击选词再要菜单
            box.doubleTap(); sleep(2); note("长按无菜单，改双击：" + app.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
            all = find(app, "label == '全选' OR label == 'Select All'")
        }
        if all.waitForExistence(timeout: 3) { all.tap(); sleep(2) }
        shot("v6-selected", full: true)
        note("选中后菜单: " + app.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))

        var tr = find(app, "label == '翻译' OR label == 'Translate'")
        if !tr.exists, let last = app.menuItems.allElementsBoundByIndex.last, last.exists {
            let y = last.frame.midY / app.frame.height
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.875, dy: y)).tap(); sleep(1)
            note("翻页后菜单: " + app.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
            tr = find(app, "label == '翻译' OR label == 'Translate'")
        }
        guard tr.waitForExistence(timeout: 4) else { note("菜单里没有「翻译」"); shot("v6-nomenu", full: true); return }
        tr.tap(); sleep(3)
        let go = find(app, "label == '继续' OR label == 'Continue'")
        if go.exists { go.tap(); sleep(3) }
        sleep(6)
        shot("v6-sheet", full: true)

        // 等译文落定
        var settled = false
        for _ in 0..<12 {
            let busy = find(app, "label CONTAINS '正在翻译' OR label CONTAINS '还在翻'")
            if !busy.exists { settled = true; break }
            sleep(3)
        }
        let rep = find(app, "label CONTAINS '替换'")
        note("★ 可编辑处：译文落定=\(settled)；「替换原文」按钮在=\(rep.exists)（它在 ⇒ allowsReplacement == true）")
        note("弹层文字: " + app.staticTexts.allElementsBoundByIndex.prefix(24).map { $0.label }.filter { !$0.isEmpty }.joined(separator: " | ").prefix(240))
        shot("v6-settled", full: true)

        // ★ 点「完成」（= finish(nil)），判据仍是「大肚猴翻译」还在不在
        let fin = find(app, "label == '完成' OR label == 'Done'")
        note("「完成」: exists=\(fin.exists) hittable=\(fin.exists && fin.isHittable)")
        guard fin.exists && fin.isHittable else { shot("v6-nofinish", full: true); return }
        fin.tap()
        sleep(2); shot("v6-after-2s", full: true)
        let a2 = find(app, "label == '大肚猴翻译'")
        note("★ 点完「完成」2 秒后，弹层还在: \(a2.exists)")
        sleep(4); shot("v6-after-6s", full: true)
        let a6 = find(app, "label == '大肚猴翻译'")
        note("★★ 点完「完成」6 秒后，弹层还在: \(a6.exists) —— 关掉了 ⇒ 是「不可替换时被忽略」；还在 ⇒ finish(nil) 本身空操作")
    }


    /// V7 · E 的决定性实验（备忘录）。
    ///
    /// 上一轮用自己 App 的输入框失败了：WKWebView 里长按**没弹出编辑菜单**（弹的是键盘的
    /// 表单辅助条）。备忘录是原生 UITextView，编辑菜单一定有。
    ///
    /// ⚠️ **两道闸，防止动到用户自己的笔记**（09-21 实测：备忘录打开时停在用户已有的一条
    /// 笔记上，里面是私密内容）：
    ///   1. 必须先点「新备忘录」建一条新的；点不到就整个放弃，**不在当前这条上操作**。
    ///   2. 动手之前断言文本框**是空的**；不空就放弃。清空也只在这两条都成立时才做。
    func testV7FinishInNotes() throws {
        let notes = XCUIApplication(bundleIdentifier: "com.apple.mobilenotes")
        let warm = UInt32(ProcessInfo.processInfo.environment["MT_WARMUP"] ?? "0") ?? 0
        if warm > 0 { note("等 \(warm) 秒，请打开 VPN"); sleep(warm) }

        notes.terminate(); notes.launch(); sleep(4)
        shot("v7-open", full: true)

        // 闸 1：必须建新的。按钮在 iOS 27 上叫「新备忘录」。
        let compose = notes.buttons.matching(NSPredicate(format:
            "label == '新备忘录' OR label CONTAINS 'Compose' OR label CONTAINS 'New Note'")).firstMatch
        guard compose.waitForExistence(timeout: 6), compose.isHittable else {
            note("✗ 找不到「新备忘录」按钮，放弃 —— 绝不在用户已有的笔记上操作: "
                 + notes.buttons.allElementsBoundByIndex.prefix(16).map { $0.label }.joined(separator: " | "))
            shot("v7-nocompose", full: true); notes.terminate(); return
        }
        compose.tap(); sleep(3)
        shot("v7-new", full: true)

        var tv = notes.textViews.firstMatch
        if !tv.waitForExistence(timeout: 6) {
            // 有些版本里正文不是 textView：点一下正文区唤起键盘再找
            notes.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28)).tap(); sleep(2)
            tv = notes.textViews.firstMatch
        }
        guard tv.waitForExistence(timeout: 5) else {
            note("✗ 新笔记里找不到文本框，放弃"); shot("v7-notv", full: true); notes.terminate(); return
        }
        // 闸 2：必须是空的
        let existing = ((tv.value as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard existing.isEmpty else {
            note("✗ 文本框不是空的（\(existing.count) 个字符），放弃 —— 这多半不是我建的那条")
            shot("v7-notempty", full: true); notes.terminate(); return
        }
        note("✓ 新笔记、空文本框，可以动手")

        tv.tap(); sleep(1)
        notes.typeText("Good morning everyone"); sleep(1)
        shot("v7-typed", full: true)

        tv.press(forDuration: 1.3); sleep(2)
        note("长按后菜单: " + notes.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
        let all = find(notes, "label == '全选' OR label == 'Select All'")
        if all.waitForExistence(timeout: 3) { all.tap(); sleep(2) }
        shot("v7-selected", full: true)
        note("选中后菜单: " + notes.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))

        // 翻页的「›」没有可访问标签，只能按坐标点。**按最后一个菜单项的右边算**，
        // 别用写死的 dx —— 09-21 实测写 0.875 点在菜单外面（菜单条到 ~0.83 就结束了），
        // 连点四次菜单一动不动。
        // 菜单翻页的「›」**是个有标签的按钮：「下一页」**（09-21 真机读回 t9|下一页|305,195）。
        // 按标签点，别按坐标 —— 之前按坐标写死 dx=0.875 点在药丸外面，连点四次菜单一动不动。
        var tr = find(notes, "label == '翻译' OR label == 'Translate'")
        for k in 0..<4 where !tr.exists {
            let next = find(notes, "label == '下一页' OR label == 'Next'")
            guard next.exists else { note("第 \(k+1) 轮：没有「下一页」"); break }
            next.tap(); sleep(1)
            note("翻页 \(k+1) 后菜单: " + notes.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
            tr = find(notes, "label == '翻译' OR label == 'Translate'")
        }
        if tr.waitForExistence(timeout: 4) {
            tr.tap(); sleep(3)
            let go = find(notes, "label == '继续' OR label == 'Continue'")
            if go.exists { go.tap(); sleep(3) }
            sleep(6); shot("v7-sheet", full: true)

            var settled = false
            for _ in 0..<20 {
                if !find(notes, "label CONTAINS '正在翻译' OR label CONTAINS '还在翻'").exists { settled = true; break }
                sleep(3)
            }
            let rep = find(notes, "label CONTAINS '替换'")
            note("★ 可编辑处：译文落定=\(settled)；「替换原文」在=\(rep.exists)（在 ⇒ allowsReplacement == true）")
            note("弹层文字: " + notes.staticTexts.allElementsBoundByIndex.prefix(24).map { $0.label }.filter { !$0.isEmpty }.joined(separator: " | ").prefix(240))
            shot("v7-settled", full: true)

            let fin = find(notes, "label == '完成' OR label == 'Done'")
            note("「完成」: exists=\(fin.exists) hittable=\(fin.exists && fin.isHittable)")
            if fin.exists && fin.isHittable {
                fin.tap()
                sleep(2); shot("v7-after-2s", full: true)
                note("★ 点完「完成」2 秒后，弹层还在: \(find(notes, "label == '大肚猴翻译'").exists)")
                sleep(4); shot("v7-after-6s", full: true)
                let still = find(notes, "label == '大肚猴翻译'").exists
                note("★★ 可编辑处点「完成」6 秒后弹层还在: \(still) —— false ⇒ 是「不可替换时被忽略」；true ⇒ finish(nil) 本身空操作")
            }
        } else {
            note("菜单里没有「翻译」"); shot("v7-nomenu", full: true)
        }

        // 清空这条**我自己建的**笔记（空笔记 iOS 会丢掉）
        let x = find(notes, "label == '关闭' OR label == 'Close'")
        if x.exists && x.isHittable { x.tap(); sleep(2) }
        if tv.exists && tv.isHittable {
            tv.tap(); sleep(1); tv.press(forDuration: 1.3); sleep(1)
            let a = find(notes, "label == '全选' OR label == 'Select All'")
            if a.waitForExistence(timeout: 3) { a.tap(); usleep(700_000) }
            notes.typeText(XCUIKeyboardKey.delete.rawValue); sleep(1)
            note("清空后: '" + (((tv.value as? String) ?? "").prefix(40)) + "'")
        }
        shot("v7-cleaned", full: true)
        notes.terminate()
    }


    /// V8 · 拍商店素材：系统翻译弹层的真机实拍（帧 10 的原料）。
    /// 判据不是「截到图了」，是**弹层里已经有译文**（`busy` 的那两句消失）—— 一张停在
    /// 「正在翻译…」的图正是 assets.md 判据①「展示了未完成状态」要挡的东西。
    func testV8Shot() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let warm = UInt32(ProcessInfo.processInfo.environment["MT_WARMUP"] ?? "0") ?? 0
        if warm > 0 { note("等 \(warm) 秒，请打开 VPN"); sleep(warm) }

        safari.terminate()
        XCUIDevice.shared.system.open(URL(string: ProcessInfo.processInfo.environment["MT_URL"] ?? "https://en.wikipedia.org/wiki/Coffee")!)
        sleep(12)
        shot("v8-page", full: true)
        // 找一段够长的正文
        // Wikipedia 手机版把一段正文按链接切成很多短元素 —— 没有「超过 120 字的单个元素」。
        // 所以取**最长的那个可点元素**当锚，再按坐标横跨三行拖选（选区是按屏幕走的，不按元素）。
        var para: XCUIElement? = nil
        var best = 0
        for e in safari.webViews.staticTexts.allElementsBoundByIndex.prefix(60) where e.exists {
            if e.label.count > best && e.isHittable && e.frame.height > 8 { best = e.label.count; para = e }
        }
        note("最长的可点正文元素 \(best) 字")
        guard let para = para, best >= 20 else {
            note("没找到够长的正文: " + safari.webViews.staticTexts.allElementsBoundByIndex.prefix(8).map { String($0.label.prefix(40)) }.joined(separator: " | "))
            shot("v8-nopara", full: true); return
        }
        note("选中的段落前 90 字：" + String(para.label.prefix(90)))
        let f = para.frame
        // 长按 + 拖，选一整句（单纯长按只选一个词）
        let a = safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.minX + 8, dy: f.minY + 10))
        let b = safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.minX + f.width * 0.70, dy: f.minY + 78))
        a.press(forDuration: 1.2, thenDragTo: b); sleep(2)
        shot("v8-selected", full: true)

        var tr = find(safari, "label == 'Translate' OR label == '翻译'")
        for _ in 0..<4 where !tr.exists {
            let next = find(safari, "label == '下一页' OR label == 'Next'")
            guard next.exists else { break }
            next.tap(); sleep(1)
            tr = find(safari, "label == 'Translate' OR label == '翻译'")
        }
        guard tr.waitForExistence(timeout: 4) else {
            note("菜单里没有 Translate: " + safari.menuItems.allElementsBoundByIndex.map { $0.label }.joined(separator: " | "))
            shot("v8-nomenu", full: true); return
        }
        tr.tap(); sleep(3)
        let go = find(safari, "label == 'Continue' OR label == '继续'")
        if go.exists { go.tap(); sleep(3) }

        // 等译文真的出来 —— 判据①
        var settled = false
        for _ in 0..<20 {
            let busy = find(safari, "label CONTAINS 'Translating' OR label CONTAINS '正在翻译' OR label CONTAINS 'Still' OR label CONTAINS '还在翻'")
            if !busy.exists { settled = true; break }
            sleep(3)
        }
        note("★ 译文落定 = \(settled)")
        note("弹层文字: " + safari.staticTexts.allElementsBoundByIndex.prefix(20).map { $0.label }.filter { !$0.isEmpty }.joined(separator: " | ").prefix(300))
        sleep(2)
        shot("v8-systrans", full: true)     // ← 这张就是原料
    }



    /// 开 / 关 VPN —— **测试程序自己做**，不再请人。
    ///
    /// 为什么需要：iOS 每次新装开发签名包都要联网校验证书，而这台手机的 Shadowrocket
    /// 把 `ppq.apple.com` 做了 fake-IP（实测 `dig` 返回 198.18.0.20，真实地址是 17.33.192.136），
    /// 于是校验走进代理、走不通 ⇒ **VPN 开着测试程序起不来**。而翻译又要 VPN（引擎在墙外）。
    /// 死结只在起步那一下：起来之后，测试自己把 VPN 打开就行。
    ///
    /// **走 Shadowrocket 自己的连接开关，不走「设置」根页那个 VPN 开关** —— 后者
    /// 实测拨不动：点元素中心不动，按坐标点右侧也不动（两种都试过），iOS 对它有额外限制。
    /// 判据是**回读开关的值**，不是「点过了」。
    @discardableResult
    private func setVPN(_ on: Bool) -> Bool {
        let sr = XCUIApplication(bundleIdentifier: "com.liguangming.Shadowrocket")
        sr.terminate(); sr.launch(); sleep(4)
        var sw = sr.switches.firstMatch
        guard sw.waitForExistence(timeout: 6) else {
            note("✗ Shadowrocket 里没找到开关: " + sr.switches.allElementsBoundByIndex.prefix(6).map { $0.label }.joined(separator: " | "))
            shot("vpn-noswitch", full: true); return false
        }
        let val = { ((sw.value as? String) ?? "") == "1" }
        note("Shadowrocket 开关当前 \(val() ? "开" : "关")，要 \(on ? "开" : "关")")
        if val() != on {
            sw.tap()
            for _ in 0..<12 { sleep(2); if val() == on { break } }
            if val() != on {
                // 退回按坐标点开关右侧（2026-09-14 关「语音控制」时记过：点中心拨不动）
                note("元素点击没拨动，改按坐标点右侧")
                let f = sw.frame
                sr.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.maxX - 8, dy: f.midY)).tap()
                for _ in 0..<12 { sleep(2); if val() == on { break } }
            }
        }
        allowSystemAlerts("vpn", timeout: 3)
        sw = sr.switches.firstMatch
        let now = ((sw.value as? String) ?? "") == "1"
        note("★ VPN 回读 = \(now ? "开" : "关")\(now == on ? " ✓" : " ✗")")
        shot("vpn-after", full: true)
        return now == on
    }

    /// V9 · 拍帧 10 的原料（正式版）。
    ///
    /// 03:00 那次作废，两个真原因（第三个「扩展名是中文」是我判重了 —— 宿主 App 在所有
    /// 语言的设备上都叫「大肚猴翻译」，已过多轮审核，扩展跟它同名是既有选择）：
    ///   ① 「译成」跟随界面语言 ⇒ 界面改英文之后变成英译英，译文和原文几乎一样
    ///   ② 选区从句子中间开始
    /// 现有 en 素材的语言对是**英文 UI + 英译中**（见 en-phone-card.png），照它来。
    func testV9Shot() throws {
        let app = XCUIApplication(bundleIdentifier: BT)
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        // ★ 自己把 VPN 打开（翻译要它），**跑完再自己关掉** —— 不关的话下一轮测试程序
        // 起不来（证书校验被 fake-IP 挡住）。`defer` 保证异常路径也关。
        defer { setVPN(false) }
        guard setVPN(true) else { note("VPN 没开起来，停"); return }
        sleep(4)

        // ── ① 把「译成」设成简体中文 ────────────────────────────────────────────
        app.terminate(); app.launch(); sleep(4)
        guard tapText(app, "label == 'Settings' OR label == '设置'", "设置") else { return }
        sleep(2)
        let sels = app.buttons.matching(NSPredicate(format: "value != nil AND value != ''")).allElementsBoundByIndex
        note("设置页带值的控件: " + sels.prefix(10).map { "[\($0.label.prefix(16))|\(($0.value as? String ?? "").prefix(28))]" }.joined(separator: " "))
        var target: XCUIElement? = nil
        for e in sels where ((e.value as? String) ?? "").range(of: "Follow interface|跟随界面", options: .regularExpression) != nil { target = e; break }
        if let t = target {
            note("「译成」当前: \((t.value as? String) ?? "-")")
            t.tap(); sleep(2); shot("v9-langmenu", full: true)
            let items = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS 'Chinese, Simplified' OR label CONTAINS 'Simplified Chinese' OR label CONTAINS '简体中文'"))
                .allElementsBoundByIndex
            note("菜单里的中文项: " + items.prefix(4).map { "[t\($0.elementType.rawValue)|\($0.label)|hit=\($0.isHittable)]" }.joined(separator: " "))
            if let hit = items.first(where: { $0.isHittable && $0.elementType == .button }) { hit.tap(); sleep(2) }
            let now = app.buttons.matching(NSPredicate(format: "value != nil AND value != ''")).allElementsBoundByIndex
                .first(where: { ($0.label.contains("ranslate") || $0.label.contains("译成")) })
            note("★「译成」设定后: \((now?.value as? String) ?? "读不到")")
        } else { note("✗ 没找到「译成」控件") ; shot("v9-nosel", full: true) }

        // ── ② 拍弹层 ───────────────────────────────────────────────────────────
        // 先把 App 退掉：不退的话 Safari 顶上会留一条「◀ 大肚猴翻译」的返回条 ——
        // 一张英文商店图上挂着中文返回条，正是 assets.md 判据③那类瑕疵。
        app.terminate(); sleep(2)
        safari.terminate(); sleep(2)
        XCUIDevice.shared.system.open(URL(string: ProcessInfo.processInfo.environment["MT_URL"] ?? "https://en.wikipedia.org/wiki/Coffee")!)
        // **等 Safari 真的起来再查它** —— 上一轮就挂在这：`system.open` 之后直接查
        // webViews，报 `Application com.apple.mobilesafari is not running`。
        if !safari.wait(for: .runningForeground, timeout: 30) {
            note("Safari 没起来，再开一次"); safari.launch(); sleep(3)
            XCUIDevice.shared.system.open(URL(string: ProcessInfo.processInfo.environment["MT_URL"] ?? "https://en.wikipedia.org/wiki/Coffee")!)
            _ = safari.wait(for: .runningForeground, timeout: 30)
        }
        sleep(10)
        // Wikipedia 会弹它自己的 App 推广横幅（顶上一大块，还带一个「Install」按钮）——
        // 商店图里不能有别家 App 的安装按钮。关掉它，然后滚回顶部。
        for _ in 0..<2 {
            let x = safari.webViews.buttons.matching(NSPredicate(format:
                "label == 'Close' OR label == '关闭' OR label CONTAINS 'Dismiss'")).firstMatch
            if x.exists && x.isHittable { note("关掉 Wikipedia 的推广横幅"); x.tap(); sleep(2) } else { break }
        }
        // 横幅关掉后页面会回流，滚到顶重新定位
        safari.swipeDown(); sleep(2)
        // 从首段**句首**开始拖：元素被链接切碎了，取 label 以 "Coffee is a beverage" 开头的那个当锚
        var anchor: XCUIElement? = nil
        for e in safari.webViews.staticTexts.allElementsBoundByIndex.prefix(60) where e.exists {
            if e.label.hasPrefix("Coffee is a beverage") && e.isHittable { anchor = e; break }
        }
        guard let a0 = anchor else {
            note("没找到首段锚: " + safari.webViews.staticTexts.allElementsBoundByIndex.prefix(10).map { String($0.label.prefix(30)) }.joined(separator: " | "))
            shot("v9-noanchor", full: true); return
        }
        let f = a0.frame
        note("首段锚 frame=\(f)")
        let p1 = safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.minX + 3, dy: f.midY))
        // 拖到第二行「ground coffee beans.」的句号之后 —— 0.60 会断在「ground coffee」，
        // 原文看着像被截了一半（锚元素宽 165 点，屏宽 393 点，句号在 ~178 点处）。
        let p2 = safari.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.minX + f.width * 0.99, dy: f.midY + 62))
        p1.press(forDuration: 1.2, thenDragTo: p2); sleep(2)
        shot("v9-selected", full: true)

        var tr = find(safari, "label == 'Translate' OR label == '翻译'")
        for _ in 0..<4 where !tr.exists {
            let next = find(safari, "label == '下一页' OR label == 'Next'")
            guard next.exists else { break }
            next.tap(); sleep(1)
            tr = find(safari, "label == 'Translate' OR label == '翻译'")
        }
        guard tr.waitForExistence(timeout: 4) else { note("菜单里没有 Translate"); shot("v9-nomenu", full: true); return }
        tr.tap(); sleep(3)
        let go = find(safari, "label == 'Continue' OR label == '继续'")
        if go.exists { go.tap(); sleep(3) }
        var settled = false
        for _ in 0..<20 {
            if !find(safari, "label CONTAINS 'Translating' OR label CONTAINS '正在翻译' OR label CONTAINS 'Still' OR label CONTAINS '还在翻'").exists { settled = true; break }
            sleep(3)
        }
        note("★ 译文落定 = \(settled)")
        note("弹层文字: " + safari.staticTexts.allElementsBoundByIndex.prefix(16).map { $0.label }.filter { !$0.isEmpty }.joined(separator: " | ").prefix(300))
        sleep(2)
        shot("v9-systrans", full: true)
    }

    // ── 2026-09-22：中国版 1.14.0 (54) 被拒「首次启动后崩溃」—— 用 TestFlight 装**同一个二进制、同一种签名**复现 ──
    /// C1（2026-09-23）：给**中国版**配翻译引擎，好让系统翻译弹层出译文。
    /// 手机上的中国版是 App Store 的 1.15.0 build 55，新装 ⇒ 一个 key 都没有，
    /// 系统翻译弹层只会说「还没配置翻译引擎」。走「快速」页的一键配置（一个 key
    /// 同时配翻译/朗读/转写），判据是**测试连接真的通**，不是「我点过保存」。
    func testCNQuick() throws {
        let CN = "com.belliedmonkeytranslator.cn"
        let env = ProcessInfo.processInfo.environment
        guard let k = env["MT_KEY_DEEPSEEK"], !k.isEmpty else { note("没有 DeepSeek key"); return }
        let app = XCUIApplication(bundleIdentifier: CN)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("cn-launch", timeout: 4)
        shot("cn-00-launch", full: true)

        // 新装先进引导，跳过它才看得到首页
        if let later = waitAny(app, ["label == '以后再设置'", "label CONTAINS '以后再说'"], 4) { later.tap(); sleep(3) }
        shot("cn-01-home", full: true)

        // 进设置
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); dump(app, "cn-nosettings"); return }
        entry.tap(); sleep(3)

        // 快速页
        let quick = find(app, "label == '快速'")
        if quick.exists && quick.isHittable { quick.tap(); note("tapped 快速"); sleep(2) } else { note("没有「快速」tab"); dump(app, "cn-notab") }
        shot("cn-02-quick", full: true)

        // key 框
        UIPasteboard.general.string = k
        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        guard key.exists && key.isHittable else { note("没找到 key 框"); dump(app, "cn-nokey"); shot("cn-nokey", full: true); return }
        _ = enterKey(app, key, k, "cn-quick")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)).tap(); sleep(2)
        shot("cn-03-filled", full: true)

        // 判据：测试连接 / 一键配置 真的通
        var go = find(app, "label CONTAINS '测试连接' OR label CONTAINS '配好' OR label CONTAINS '一键'")
        go = scrollTo(app, { find(self.j(app), "label CONTAINS '测试连接' OR label CONTAINS '配好' OR label CONTAINS '一键'") }, 5)
        guard go.exists && go.isHittable else { note("没找到测试/配置按钮"); dump(app, "cn-nogo"); shot("cn-nogo", full: true); return }
        note("按钮: " + go.label)
        go.tap()
        for t in [3, 6, 10, 16] { sleep(UInt32(t == 3 ? 3 : 4)); shot("cn-04-test-\(t)s", full: true) }
        survey(app, "cn-after")
    }

    private func j(_ a: XCUIApplication) -> XCUIApplication { a }

    /// 锁屏（2026-09-23）：devicectl 没有 lock 子命令，XCUIDevice 也没有公开的电源键。
    /// 唯一的路是私有选择器 `pressLockButton`。判据不是「调用没报错」，而是
    /// 回读 `devicectl device info lockState` 的 passcodeRequired / unlockedSinceBoot。
    func testLockScreen() throws {
        let sel = NSSelectorFromString("pressLockButton")
        if XCUIDevice.shared.responds(to: sel) {
            XCUIDevice.shared.perform(sel)
            note("pressLockButton 已调用")
        } else {
            note("XCUIDevice 不响应 pressLockButton —— 这条路不通")
        }
        sleep(3)
    }

    /// C1 侦察（2026-09-23）：中国版设置页里**哪一格是翻译引擎的密钥**。
    /// 上一轮 `secureTextFields.firstMatch` 抓错了格子（填进 35 个字符、判据也过了，
    /// 但系统翻译弹层仍说「还没配置翻译引擎」）。这一轮不猜：把每个密码框连同
    /// **它上方最近的那行文字**一起打进附件，看清楚再填。
    func testCNFields() throws {
        let CN = "com.belliedmonkeytranslator.cn"
        let app = XCUIApplication(bundleIdentifier: CN)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("cnf-launch", timeout: 4)
        if let later = waitAny(app, ["label == '以后再设置'"], 4) { later.tap(); sleep(3) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); dump(app, "cnf-nosettings"); return }
        entry.tap(); sleep(3)

        for tab in ["快速", "详细"] {
            let t = find(app, "label == '\(tab)'")
            if t.exists && t.isHittable { t.tap(); sleep(2) } else { note("没有 tab \(tab)"); continue }
            shot("cnf-tab-\(tab)", full: true)
            // 滚到底，把整页的密码框都收进来
            var lines: [String] = ["=== tab \(tab) ==="]
            for pass in 0..<8 {
                let fields = app.secureTextFields.allElementsBoundByIndex
                let texts = app.staticTexts.allElementsBoundByIndex.filter { $0.exists && !$0.label.isEmpty }
                for (i, f) in fields.enumerated() where f.exists {
                    let fr = f.frame
                    // 找它上方最近的一行文字当标签
                    var best: String = "?"; var bestDy = CGFloat.greatestFiniteMagnitude
                    for t2 in texts {
                        let tf = t2.frame
                        let dy = fr.minY - tf.maxY
                        if dy >= 0 && dy < bestDy && abs(tf.minX - fr.minX) < 60 { bestDy = dy; best = t2.label }
                    }
                    lines.append("[\(pass).\(i)] y=\(Int(fr.minY)) 值长度=\(((f.value as? String) ?? "").count) 上方标签=「\(best)」")
                }
                app.swipeUp(); usleep(700_000)
                if pass == 3 { shot("cnf-\(tab)-mid", full: true) }
            }
            note(lines.joined(separator: "\n"))
            app.swipeDown(); app.swipeDown(); app.swipeDown(); app.swipeDown(); sleep(1)
        }
    }

    /// C1 填 key（2026-09-23）：中国版「快速」页的一键配置只有**一个**密钥框，
    /// 它上面写着「可用平台：通义千问 · dashscope.aliyuncs.com」—— 上一轮填 DeepSeek
    /// 的 key 所以没生效。这一轮填千问，而且**走粘贴不走打字**：key 已由
    /// `devicectl device pasteboard copy` 放进手机剪贴板（回读 116 字节一致）。
    /// 判据是密码框回读长度 == key 长度，最终判据是系统翻译弹层真的出译文。
    func testCNFill() throws {
        let CN = "com.belliedmonkeytranslator.cn"
        let want = Int(ProcessInfo.processInfo.environment["MT_KEY_LEN"] ?? "0") ?? 0
        let app = XCUIApplication(bundleIdentifier: CN)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("fill-launch", timeout: 4)
        if let later = waitAny(app, ["label == '以后再设置'"], 4) { later.tap(); sleep(3) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); dump(app, "fill-nosettings"); return }
        entry.tap(); sleep(3)
        let q = find(app, "label == '快速'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }

        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        guard key.exists && key.isHittable else { note("没找到密钥框"); shot("fill-nokey", full: true); return }
        let before = ((key.value as? String) ?? "").count
        note("填之前长度 \(before)（占位符也会被读成值）")
        // 长按不出菜单（WKWebView 的密码框不把 callout 暴露给 XCUITest），改用打字 ——
        // 上一轮已经证明打字能落地（判据「35 个字符（应为 35）✓」），当时错的是引擎不是手法。
        guard let k = ProcessInfo.processInfo.environment["MT_KEY_QWEN"], !k.isEmpty else { note("没有千问 key"); return }
        _ = enterKey(app, key, k, "cn-quick")
        let after = ((key.value as? String) ?? "").count
        note("★ 填完长度 \(after)（应为 \(want)）" + (after == want ? " ✓" : " ✗"))
        shot("fill-pasted", full: true)
        // 失焦保存
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap(); sleep(3)
        shot("fill-blurred", full: true)
        // 一键配置 / 测试
        let go = scrollTo(app, { self.find(app, "label CONTAINS '配好' OR label CONTAINS '一键' OR label CONTAINS '测试'") }, 5)
        if go.exists && go.isHittable {
            note("按钮: " + go.label); go.tap()
            for _ in 0..<4 { sleep(4); shot("fill-after", full: true) }
        } else { note("没找到一键/测试按钮") }
        survey(app, "fill-end")
    }

    /// C1 提交（2026-09-23）：key 已经填进「快速」卡（回读 116 ✓），只差按那个按钮。
    /// **不重新打字** —— 框里已有 116 个字符，而清空在 WKWebView 密码框里不落地，
    /// 再走一遍 enterKey 会追加成 232。所以这个测试只点按钮、只读结果。
    func testCNCommit() throws {
        let CN = "com.belliedmonkeytranslator.cn"
        let app = XCUIApplication(bundleIdentifier: CN)
        app.activate(); sleep(3)
        if let later = waitAny(app, ["label == '以后再设置'"], 3) { later.tap(); sleep(2) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        if entry.exists && entry.isHittable { entry.tap(); sleep(3) }
        let q = find(app, "label == '快速'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }
        // 先确认 key 还在
        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        note("按之前密钥框长度 \(((key.value as? String) ?? "").count)")
        let btn = scrollTo(app, { app.buttons.matching(NSPredicate(format: "label == '配好翻译、朗读、转写'")).firstMatch }, 6)
        guard btn.exists && btn.isHittable else {
            note("没找到按钮: " + app.buttons.allElementsBoundByIndex.prefix(20).map { $0.label }.joined(separator: "|"))
            shot("commit-nobtn", full: true); return
        }
        btn.tap()
        for _ in 0..<5 { sleep(4); shot("commit-after", full: true) }
        survey(app, "commit-end")
    }

    /// C2（2026-09-23）：给**国际版**配翻译引擎。与中国版那次同形，区别是
    /// 国际版的「快速」卡认 DeepSeek 一类的引擎，不是只认千问。
    func testGQuick() throws {
        let env = ProcessInfo.processInfo.environment
        guard let k = env["MT_KEY_DEEPSEEK"], !k.isEmpty else { note("没有 DeepSeek key"); return }
        let want = Int(env["MT_KEY_LEN"] ?? "0") ?? 0
        let app = XCUIApplication(bundleIdentifier: BT)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("g-launch", timeout: 5)
        shot("g-00", full: true)
        if let later = waitAny(app, ["label == '以后再设置'"], 4) { later.tap(); sleep(3) }
        allowSystemAlerts("g-after-onboard", timeout: 3)
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); dump(app, "g-nosettings"); shot("g-nosettings", full: true); return }
        entry.tap(); sleep(3)
        let q = find(app, "label == '快速'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }
        shot("g-quick", full: true)
        // 平台默认是 OpenRouter，而它的默认模型 google/gemini-3.7-flash 在**境内网络**下
        // 被服务端 403「This model is not available in your region」挡掉（Mac 上 curl 能通
        // 是因为 Mac 走代理）。换成 DeepSeek —— 境内直连。
        let plat = scrollTo(app, { app.buttons.matching(NSPredicate(format: "value CONTAINS 'OpenRouter' OR value CONTAINS 'DeepSeek'")).firstMatch }, 6)
        if plat.exists && plat.isHittable {
            note("平台当前: \((plat.value as? String) ?? "-")")
            plat.tap(); sleep(2)
            shot("g-picker", full: true)
            // WKWebView 里的 <select> 点开是**原生 picker**，选项不在普通元素树里 ——
            // 上一轮 `find(label CONTAINS 'DeepSeek')` 一无所获就是这个原因。
            // 先试 pickerWheels（滚轮），再试弹出菜单里的 button，最后把树打出来。
            var done = false
            let wheel = app.pickerWheels.firstMatch
            if wheel.waitForExistence(timeout: 3) {
                note("滚轮当前值: \((wheel.value as? String) ?? "-")")
                for cand in ["DeepSeek · api.deepseek.com", "DeepSeek"] {
                    if done { break }
                    wheel.adjust(toPickerWheelValue: cand)
                    sleep(1)
                    if let v = wheel.value as? String, v.contains("DeepSeek") { note("滚轮拨到: \(v)"); done = true }
                }
                // 滚轮要点「完成」才落地
                let ok = find(app, "label == '完成' OR label == 'Done'")
                if ok.exists && ok.isHittable { ok.tap(); sleep(2) }
            }
            // 选项其实是**按钮列表**（树里看得到「OpenRouter · openrouter.ai」），但列表有 8 页、
            // 元素是懒加载的：不滚到跟前它根本不在树里。所以要边滚边查。
            if !done {
                for i in 0..<12 {
                    let btn = app.buttons.matching(NSPredicate(format: "label CONTAINS 'DeepSeek'")).firstMatch
                    if btn.exists && btn.isHittable { btn.tap(); sleep(2); done = true; note("第 \(i) 屏找到并点了 DeepSeek"); break }
                    app.swipeUp(); usleep(500_000)
                }
            }
            if !done {
                note("picker 里找不到 DeepSeek —— 树: " + app.descendants(matching: .any).allElementsBoundByIndex.prefix(40).map { "\($0.elementType.rawValue):\($0.label)" }.filter { !$0.hasSuffix(":") }.joined(separator: " | ").prefix(500))
                shot("g-noplat", full: true)
            }
            note("平台现在: \((plat.value as? String) ?? "-")")
        } else { note("没找到平台下拉") }
        shot("g-plat", full: true)
        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        guard key.exists && key.isHittable else { note("没找到密钥框"); shot("g-nokey", full: true); return }
        note("填之前长度 \(((key.value as? String) ?? "").count)")
        _ = enterKey(app, key, k, "g-quick")
        let after = ((key.value as? String) ?? "").count
        note("★ 填完长度 \(after)（应为 \(want)）" + (after == want ? " ✓" : " ✗"))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap(); sleep(3)
        let go = scrollTo(app, { app.buttons.matching(NSPredicate(format: "label CONTAINS '配好' AND label CONTAINS '翻译'")).firstMatch }, 6)
        if go.exists && go.isHittable { note("按钮: " + go.label); go.tap(); for _ in 0..<4 { sleep(4); shot("g-after", full: true) } }
        else { note("没找到一键按钮: " + app.buttons.allElementsBoundByIndex.prefix(20).map { $0.label }.joined(separator: "|")) }
        survey(app, "g-end")
    }

    /// C2（2026-09-23）：把系统的「默认翻译 App」从中国版切到国际版。
    /// **两个 App 同名「大肚猴翻译」** —— 靠名字分不开，靠的是**当前选中的那个带勾**：
    /// 选没有勾的那一个。最终判据不在这个测试里，而在弹层底部披露行的引擎名
    /// （中国版是 qwen，国际版配的是 deepseek）。
    func testSwitchDefault() throws {
        let st = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        st.terminate(); st.launch(); sleep(4)
        shot("sw-00", full: true)
        // 用设置自带的搜索框 —— 逐级滑动找「应用」不稳（根页很长，且 cell 的 label 是空的）
        let sf = st.searchFields.firstMatch
        guard sf.waitForExistence(timeout: 5) else { note("没有搜索框"); shot("sw-nosearch", full: true); return }
        sf.tap(); sleep(1)
        sf.typeText("默认")
        sleep(3); shot("sw-01-search", full: true)
        var def = find(st, "label CONTAINS '默认 App' OR label CONTAINS '默认App' OR label CONTAINS 'Default Apps'")
        guard def.waitForExistence(timeout: 5) else {
            note("搜不到默认 App: " + st.staticTexts.allElementsBoundByIndex.prefix(20).map { $0.label }.filter { !$0.isEmpty }.joined(separator: "|"))
            shot("sw-nodefault", full: true); return
        }
        def.tap(); sleep(3); shot("sw-02-default", full: true)
        // → 翻译
        var tr = find(st, "label == '翻译' OR label == 'Translation'")
        for _ in 0..<6 where !(tr.exists && tr.isHittable) { st.swipeUp(); usleep(500_000); tr = find(st, "label == '翻译' OR label == 'Translation'") }
        guard tr.exists && tr.isHittable else { note("找不到「翻译」: " + st.cells.allElementsBoundByIndex.prefix(25).map { $0.label }.joined(separator: "|")); shot("sw-notrans", full: true); return }
        tr.tap(); sleep(2); shot("sw-03-list", full: true)
        // 列表里两个同名条目（截图实证：第一个带蓝勾＝中国版，第二个是刚装的国际版）。
        // 行不是 cell 类型，`st.cells` 匹配到 0 个 —— 用文字元素按序号点第二个。
        let rows = st.staticTexts.matching(NSPredicate(format: "label == '大肚猴翻译'")).allElementsBoundByIndex
        note("同名条目 \(rows.count) 个")
        guard rows.count >= 2 else { note("少于 2 个，切不了"); shot("sw-norow", full: true); return }
        rows[1].tap(); sleep(3)
        shot("sw-04-picked", full: true)
        note("点完 —— 真判据在弹层披露行的引擎名，不在这里")
    }

    /// C2 侦察：国际版「快速」卡长什么样 —— 平台是写死的 OpenRouter，还是能选？
    func testGCard() throws {
        let app = XCUIApplication(bundleIdentifier: BT)
        app.activate(); sleep(3)
        if let later = waitAny(app, ["label == '以后再设置'"], 3) { later.tap(); sleep(2) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        if entry.exists && entry.isHittable { entry.tap(); sleep(3) }
        let q = find(app, "label == '快速'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }
        for i in 0..<5 {
            shot("gc-\(i)", full: true)
            let txt = app.staticTexts.allElementsBoundByIndex.filter { $0.exists && !$0.label.isEmpty }.prefix(14).map { $0.label }
            note("屏 \(i): " + txt.joined(separator: " ‖ "))
            app.swipeUp(); usleep(700_000)
        }
    }

    /// C2 侦察：国际版「详细」页有哪些小节 —— 一键卡只给 OpenRouter / OpenAI，
    /// 两个在境内网络下都不通，所以翻译引擎只能来这里逐个配。
    func testGDetail() throws {
        let app = XCUIApplication(bundleIdentifier: BT)
        app.activate(); sleep(3)
        if let later = waitAny(app, ["label == '以后再设置'"], 3) { later.tap(); sleep(2) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        if entry.exists && entry.isHittable { entry.tap(); sleep(3) }
        let d = find(app, "label == '详细'")
        guard d.waitForExistence(timeout: 5), d.isHittable else { note("没有「详细」tab"); shot("gd-notab", full: true); return }
        d.tap(); sleep(2)
        for i in 0..<6 {
            shot("gd-\(i)", full: true)
            let heads = app.descendants(matching: .any).allElementsBoundByIndex
                .filter { $0.exists && !$0.label.isEmpty && $0.frame.height > 0 }
                .prefix(30).map { $0.label }
            note("屏 \(i): " + heads.joined(separator: " ‖ ").prefix(420))
            app.swipeUp(); usleep(700_000)
        }
    }

    /// C2（2026-09-23）：开 VPN → 用 OpenRouter 的 key 配好翻译 → 让系统翻译弹层出译文。
    /// 为什么要 VPN：一键卡只给 OpenRouter / OpenAI 两个平台（「详细」页没有翻译一节），
    /// 而在**境内直连**下 OpenAI 打不开、OpenRouter 的默认模型被服务端 403
    /// 「This model is not available in your region」挡掉 —— 转写那一项反而通了，
    /// 说明端点可达、只是模型按地区禁。**装包必须在开 VPN 之前做完**（开着 VPN
    /// 开发签名包的证书校验走不通，见 setVPN 的注释）。
    func testGVpnQuick() throws {
        guard let k = ProcessInfo.processInfo.environment["MT_KEY_OPENROUTER"], !k.isEmpty else { note("没有 OpenRouter key"); return }
        let want = Int(ProcessInfo.processInfo.environment["MT_KEY_LEN"] ?? "0") ?? 0
        note("VPN 打开: \(setVPN(true))")
        sleep(4)
        let app = XCUIApplication(bundleIdentifier: BT)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("gv-launch", timeout: 5)
        if let later = waitAny(app, ["label == '以后再设置'"], 4) { later.tap(); sleep(3) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); shot("gv-nosettings", full: true); return }
        entry.tap(); sleep(3)
        let q = find(app, "label == '快速'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }
        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        guard key.exists && key.isHittable else { note("没找到密钥框"); shot("gv-nokey", full: true); return }
        _ = enterKey(app, key, k, "gv")
        let after = ((key.value as? String) ?? "").count
        note("★ 填完长度 \(after)（应为 \(want)）" + (after == want ? " ✓" : " ✗"))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap(); sleep(3)
        let go = scrollTo(app, { app.buttons.matching(NSPredicate(format: "label CONTAINS '配好' AND label CONTAINS '翻译'")).firstMatch }, 6)
        guard go.exists && go.isHittable else { note("没找到一键按钮"); shot("gv-nogo", full: true); return }
        go.tap()
        for _ in 0..<5 { sleep(4); shot("gv-after", full: true) }
    }

    /// C2：把「快速」卡的平台切成 ChatGPT (OpenAI)，看它给不给填**自定义接口地址** ——
    /// 给的话就指向 DashScope 的 OpenAI 兼容端点，用千问的 key，境内直连，不用 VPN。
    func testGPickOpenAI() throws {
        let app = XCUIApplication(bundleIdentifier: BT)
        app.activate(); sleep(3)
        if let later = waitAny(app, ["label == '以后再设置'"], 3) { later.tap(); sleep(2) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        if entry.exists && entry.isHittable { entry.tap(); sleep(3) }
        let q = find(app, "label == '快速'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }
        let plat = scrollTo(app, { app.buttons.matching(NSPredicate(format: "value CONTAINS 'OpenRouter' OR value CONTAINS 'OpenAI'")).firstMatch }, 6)
        guard plat.exists && plat.isHittable else { note("没找到平台下拉"); shot("po-noplat", full: true); return }
        note("平台当前: \((plat.value as? String) ?? "-")")
        plat.tap(); sleep(2)
        let oa = app.buttons.matching(NSPredicate(format: "label CONTAINS 'OpenAI'")).firstMatch
        guard oa.waitForExistence(timeout: 4), oa.isHittable else { note("弹层里没有 OpenAI"); shot("po-nooa", full: true); return }
        oa.tap(); sleep(3)
        note("平台现在: \((plat.value as? String) ?? "-")")
        shot("po-card", full: true)
        let txt = app.staticTexts.allElementsBoundByIndex.filter { $0.exists && !$0.label.isEmpty }.map { $0.label }
        note("卡上文字: " + txt.joined(separator: " ‖ ").prefix(500))
        note("文本框数: 普通 \(app.textFields.count) · 密码 \(app.secureTextFields.count)")
        for (i, f) in app.textFields.allElementsBoundByIndex.enumerated() where f.exists {
            note("普通框 \(i): label=「\(f.label)」 value=「\((f.value as? String) ?? "")」")
        }
    }

    /// 通用「配一把 key」（2026-09-25）：bundle / 平台 / key 全从环境变量来，中国版国际版都能用。
    /// 起因是 iOS 商店预览片录出来每句都「译文失败」—— 手机上那个 App 是全新装的，
    /// 引导被跳过，机器上**根本没配引擎和 key**。转写是设备内置的（不要 key），翻译要调引擎。
    ///
    /// 输入手法照抄 testCNFill 那套踩实过的：**先按住键盘删除键清空、再打字**。
    /// 判据是**圆点数 == key 长度** —— 密码框会回显旧值、typeText 是追加，追到几百字符
    /// 界面上一模一样而服务端回 401（2026-09-23 的 347 字符那次）。
    ///   TEST_RUNNER_MT_TARGET_BUNDLE / MT_KEY / MT_KEY_LEN / MT_PLATFORM
    func testFillKey() throws {
        let env = ProcessInfo.processInfo.environment
        let bid = env["MT_TARGET_BUNDLE"] ?? BT
        let want = Int(env["MT_KEY_LEN"] ?? "0") ?? 0
        let plat = env["MT_PLATFORM"] ?? "DeepSeek"
        guard let k = env["MT_KEY"], !k.isEmpty else { note("没有 MT_KEY，不填"); return }
        note("目标 \(bid) · 平台 \(plat) · key 长度 \(k.count)（期望 \(want)）")
        let app = XCUIApplication(bundleIdentifier: bid)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("fill-launch", timeout: 4)
        if let later = waitAny(app, ["label == '以后再设置'"], 4) { later.tap(); sleep(3) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); dump(app, "fill-nosettings"); return }
        entry.tap(); sleep(3)
        // MT_TAB=详细 ⇒ 走「详细」档的翻译引擎，而不是一键卡。
        // 2026-09-25 实测：一键卡的平台列表里**没有 DeepSeek**（它只收能同时做翻译/朗读/转写的），
        // 而卡上默认的 OpenRouter 在境内对默认模型返回 403 ⇒ 每句「译文失败」。
        // 记忆里那条正好对上：「详细 › 句子解析」设成 DeepSeek 真机可用（无 VPN，647ms）。
        let tab = env["MT_TAB"] ?? "快速"
        let q = find(app, "label == '\(tab)'")
        if q.exists && q.isHittable { q.tap(); sleep(2) }
        note("档位: \(tab)")
        shot("fill-00-card", full: true)

        // 平台下拉：不是想要的那个才去点，省一次弹层
        let sel = scrollTo(app, { app.buttons.matching(NSPredicate(format:
            "value CONTAINS 'DeepSeek' OR value CONTAINS 'OpenRouter' OR value CONTAINS 'OpenAI' OR value CONTAINS 'Google' OR value CONTAINS '智谱' OR value CONTAINS '自定义'")).firstMatch }, 8)
        if sel.exists && sel.isHittable {
            let now = (sel.value as? String) ?? "-"
            note("平台当前: \(now)")
            if !now.contains(plat) {
                sel.tap(); sleep(2)
                let opt = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", plat)).firstMatch
                if opt.waitForExistence(timeout: 5), opt.isHittable { opt.tap(); sleep(3) }
                else { note("弹层里没有 \(plat)"); shot("fill-noplat", full: true) }
            }
            note("平台现在: \((sel.value as? String) ?? "-")")
        } else { note("没找到平台下拉"); shot("fill-nosel", full: true) }

        let key = scrollTo(app, { app.secureTextFields.firstMatch }, 6)
        guard key.exists && key.isHittable else { note("没找到密钥框"); shot("fill-nokey", full: true); return }
        // 键盘没起来的话 typeText 会抛（这一轮就是：清空报「找不到键盘上的删除键」，
        // 而那一步之前框里 11 个字符其实是**占位符**被读成了 value，根本不用清）。
        key.tap(); sleep(1)
        if !app.keyboards.element.waitForExistence(timeout: 8) {
            note("键盘没起来，再点一次"); shot("fill-nokbd", full: true)
            key.tap(); _ = app.keyboards.element.waitForExistence(timeout: 8)
        }
        note("键盘: \(app.keyboards.element.exists ? "在" : "还是没有")")
        _ = enterKey(app, key, k, "fill")
        let after = ((key.value as? String) ?? "").count
        note("★ 填完长度 \(after)（应为 \(want)）" + (after == want ? " ✓" : " ✗"))
        shot("fill-01-typed", full: true)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap(); sleep(3)
        let go = scrollTo(app, { self.find(app, "label CONTAINS '配好' OR label CONTAINS '一键' OR label CONTAINS '测试'") }, 5)
        if go.exists && go.isHittable {
            note("按钮: " + go.label); go.tap()
            for _ in 0..<4 { sleep(4); shot("fill-02-after", full: true) }
        } else { note("没找到一键/测试按钮"); shot("fill-nobtn", full: true) }
        survey(app, "fill-end")
    }

    /// 一次设好三档语言（2026-09-25，给 en 那支预览片用）：
    ///   MT_UI_LANG    界面语言（App 自己的 uiLang，不用去系统设置）
    ///   MT_TARGET     译成
    ///   MT_VIDEO_LANG 实时字幕「视频的语言」
    /// 三个都是 WKWebView 里的 <select>，驱动手法同 testFillKey 的平台下拉：
    /// 按**当前值**找到那个 button，点开，再点选项。找不到就把页面上的所有下拉 dump 出来。
    func testSetLangs() throws {
        let env = ProcessInfo.processInfo.environment
        let app = XCUIApplication(bundleIdentifier: env["MT_TARGET_BUNDLE"] ?? BT)
        app.terminate(); app.launch(); sleep(5)
        allowSystemAlerts("lang-launch", timeout: 4)
        if let later = waitAny(app, ["label == '以后再设置'"], 4) { later.tap(); sleep(3) }
        if let ok = waitAny(app, ["label CONTAINS '我已打开'"], 3) { ok.tap(); sleep(2) }
        var entry = find(app, "label == '设置'")
        if !entry.exists { entry = find(app, "label CONTAINS '去设置'") }
        guard entry.waitForExistence(timeout: 5) else { note("没找到设置入口"); return }
        entry.tap(); sleep(3)
        // 详细档才有这三个（快速卡只管引擎与密钥）
        if let d = waitAny(app, ["label == '详细'"], 3) { d.tap(); sleep(2) }

        // 一次只 dump 当前可见的那几个是不够的：界面语言 / 译成 / 视频的语言在设置页更靠下，
        // 上一轮只看到「引擎 / 转写引擎 / 语音引擎 / 朗读语音」四个就下了结论。
        // 改成**边滚边收**，把整页的下拉都收齐（2026-09-25）。
        func dumpSelects(_ tag: String) {
            var seen = Set<String>()
            for i in 0..<12 {
                for b in app.buttons.allElementsBoundByIndex.prefix(60) {
                    let v = (b.value as? String) ?? ""
                    if !v.isEmpty && !b.label.isEmpty { seen.insert("「\(b.label)」=\(v)") }
                }
                if i < 11 { app.swipeUp(); usleep(500_000) }
            }
            note("[\(tag)] 全页下拉(\(seen.count)): " + seen.sorted().joined(separator: " | "))
            for _ in 0..<12 { app.swipeDown(); usleep(300_000) }   // 滚回顶部，后面 scrollTo 才好找
        }
        dumpSelects("before")

        // 按**标签**找，不按值找：好几个下拉的值都是「中文」或「English」，
        // 按值匹配会抓错那一个（2026-09-25 实测，界面语言/译成/视频的语言/我的语言四者同值）。
        func setSelect(_ want: String, _ label: String, _ tag: String) {
            let sel = scrollTo(app, { app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch }, 10)
            guard sel.exists && sel.isHittable else { note("[\(tag)] 没找到下拉"); dumpSelects(tag); return }
            let now = (sel.value as? String) ?? "-"
            if now.contains(want) { note("[\(tag)] 已经是 \(now)"); return }
            sel.tap(); sleep(2)
            let opt = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", want)).firstMatch
            if opt.waitForExistence(timeout: 5), opt.isHittable { opt.tap(); sleep(3) }
            else { note("[\(tag)] 弹层里没有 \(want)"); shot("lang-\(tag)-miss", full: true) }
            note("[\(tag)] \(now) → \((sel.value as? String) ?? "-")")
        }
        if let v = env["MT_UI_LANG"] { setSelect(v, "界面语言", "uiLang") }
        if let v = env["MT_TARGET"] { setSelect(v, "译成", "target") }
        if let v = env["MT_VIDEO_LANG"] { setSelect(v, "视频的语言", "video") }
        if let v = env["MT_MY_LANG"] { setSelect(v, "我的语言", "mylang") }
        dumpSelects("after")
        shot("lang-done", full: true)
    }

    /// 脚本驱动的通用遥控（2026-09-25）。**加新流程写 JSON，不重建 runner。**
    ///
    /// 为什么要有它：只有**重建 runner** 才会触发 iOS 对开发者证书的联网重校验，
    /// 而那次校验没当场完成就报「Developer App Certificate is not trusted」，
    /// 此时 `devicectl` 帮不上忙 —— 只能人在手机主屏上点一下图标。09-25 一天重建了 8 次，
    /// 其中 6 次只是为了加一个新的点按流程，两次因此卡住等人。判据：以后录一支预览片
    /// 应当**全程不重建**。
    ///
    ///   TEST_RUNNER_MT_SCRIPT         步骤数组（JSON）
    ///   TEST_RUNNER_MT_TARGET_BUNDLE  默认 bundle（步骤里可用 "bundle" 临时切换）
    ///
    /// 步骤只覆盖**今天真用过的动作**，不预造：
    ///   launch / activate / terminate / alerts / open / wait / shot / dump
    ///   tap / menu / drag / select / selects / key
    func testDrive() throws {
        continueAfterFailure = true
        let env = ProcessInfo.processInfo.environment
        guard let raw = env["MT_SCRIPT"], let data = raw.data(using: .utf8),
              let steps = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
            // 没有脚本就**失败**，不要静默通过 —— 「passed 但什么都没做」是这个 runner 的老毛病
            // （§0.2.3 第 1 条：判据看附件，不看 passed）。
            note("MT_SCRIPT 缺失或不是合法的 JSON 数组")
            XCTFail("MT_SCRIPT 缺失或不是合法的 JSON 数组")
            return
        }
        let defBundle = env["MT_TARGET_BUNDLE"] ?? BT
        var app = XCUIApplication(bundleIdentifier: defBundle)
        note("脚本 \(steps.count) 步 · 默认 bundle \(defBundle)")

        func s(_ d: [String: Any], _ k: String) -> String? { d[k] as? String }
        func i(_ d: [String: Any], _ k: String) -> Int? { d[k] as? Int }
        func vec(_ d: [String: Any], _ k: String) -> CGVector? {
            guard let a = d[k] as? [Double], a.count == 2 else { return nil }
            return CGVector(dx: a[0], dy: a[1])
        }

        /// 整页下拉：**边滚边收**。一次只 dump 当前屏那几个会得出「那几档不存在」的错误结论 ——
        /// 09-25 就是这么把「界面语言 / 译成 / 视频的语言」判成不存在的。
        func surveySelects(_ tag: String) {
            var seen = Set<String>()
            for n in 0..<12 {
                for b in app.buttons.allElementsBoundByIndex.prefix(60) {
                    let v = (b.value as? String) ?? ""
                    if !v.isEmpty && !b.label.isEmpty { seen.insert("「\(b.label)」=\(v)") }
                }
                if n < 11 { app.swipeUp(); usleep(500_000) }
            }
            note("[\(tag)] 全页下拉(\(seen.count)): " + seen.sorted().joined(separator: " | "))
            for _ in 0..<12 { app.swipeDown(); usleep(300_000) }
        }

        /// 下拉：**按标签找，不按值找**。界面语言 / 译成 / 视频的语言 / 我的语言四个的值
        /// 都是「中文」或「English」，按值匹配必然抓错其中一个（09-25 实测）。
        func setSelect(_ label: String, _ want: String, _ tag: String) {
            let sel = scrollTo(app, { app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch }, 10)
            guard sel.exists && sel.isHittable else {
                note("[\(tag)] 没找到下拉「\(label)」"); surveySelects(tag); shot("drive-\(tag)-nosel", full: true); return
            }
            let now = (sel.value as? String) ?? "-"
            if now.contains(want) { note("[\(tag)] 「\(label)」已经是 \(now)"); return }
            sel.tap(); sleep(2)
            let opt = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", want)).firstMatch
            if opt.waitForExistence(timeout: 5), opt.isHittable { opt.tap(); sleep(3) }
            else { note("[\(tag)] 弹层里没有「\(want)」"); shot("drive-\(tag)-noopt", full: true) }
            // 判据是**回读那一个下拉的新值**，不是「点过了」
            note("[\(tag)] 「\(label)」 \(now) → \((sel.value as? String) ?? "-")")
        }

        for (idx, step) in steps.enumerated() {
            let op = s(step, "op") ?? ""
            let tag = "\(idx)-\(op)"
            if let b = s(step, "bundle") { app = XCUIApplication(bundleIdentifier: b); note("[\(tag)] 切到 \(b)") }
            switch op {
            case "launch":
                app.terminate(); app.launch(); sleep(UInt32(i(step, "s") ?? 5))
                note("[\(tag)] 起了 \(app.description.prefix(0))\(defBundle)")
            case "activate": app.activate(); sleep(UInt32(i(step, "s") ?? 2)); note("[\(tag)] activate")
            case "terminate": app.terminate(); sleep(1); note("[\(tag)] terminate")
            case "alerts": allowSystemAlerts(tag, timeout: TimeInterval(i(step, "s") ?? 4))
            case "wait": sleep(UInt32(i(step, "s") ?? 2)); note("[\(tag)] 等 \(i(step, "s") ?? 2) s")
            case "shot": shot(s(step, "name") ?? tag, full: true)
            case "dump": dump(app, s(step, "tag") ?? tag)
            case "selects": surveySelects(s(step, "tag") ?? tag)
            case "open":
                guard let u = s(step, "url"), let url = URL(string: u) else { note("[\(tag)] 缺 url"); break }
                XCUIDevice.shared.system.open(url); sleep(UInt32(i(step, "s") ?? 7))
                note("[\(tag)] 打开 \(u)")
            case "tap":
                guard let t = s(step, "text") else { note("[\(tag)] 缺 text"); break }
                let exact = (step["exact"] as? Bool) ?? false
                let pred = exact ? "label == '\(t)'" : "label CONTAINS '\(t)'"
                let ok = tapText(app, pred, swipes: i(step, "swipes") ?? 0, tag)
                note("[\(tag)] tap「\(t)」→ " + (ok ? "点了" : "没找到"))
            case "menu":
                guard let it = s(step, "item") else { note("[\(tag)] 缺 item"); break }
                let m = app.menuItems.matching(NSPredicate(format: "label CONTAINS %@", it)).firstMatch
                if m.waitForExistence(timeout: 5), m.isHittable { m.tap(); note("[\(tag)] 菜单点了「\(it)」") }
                else { note("[\(tag)] 菜单里没有「\(it)」，现有: " + app.menuItems.allElementsBoundByIndex.prefix(12).map { $0.label }.joined(separator: "|")) }
                sleep(UInt32(i(step, "s") ?? 3))
            case "drag":
                // 选整句：长按只选**一个词**，三连点也不扩选（09-25 实测），只能按住从句首拖到句尾。
                guard let t = s(step, "text") else { note("[\(tag)] 缺 text"); break }
                let el = app.webViews.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", t)).firstMatch
                guard el.waitForExistence(timeout: 8) else { note("[\(tag)] 页面里没有「\(t)」"); dump(app, tag); break }
                let a = vec(step, "from") ?? CGVector(dx: 0.03, dy: 0.25)
                let b = vec(step, "to") ?? CGVector(dx: 0.97, dy: 0.72)
                el.coordinate(withNormalizedOffset: a).press(forDuration: 1.1, thenDragTo: el.coordinate(withNormalizedOffset: b))
                sleep(2)
                note("[\(tag)] 拖选「\(t)」→ 菜单项: " + app.menuItems.allElementsBoundByIndex.prefix(8).map { $0.label }.joined(separator: "|"))
            case "select":
                guard let l = s(step, "label"), let v = s(step, "value") else { note("[\(tag)] 缺 label/value"); break }
                setSelect(l, v, tag)
            case "key":
                // 判据是**圆点数 == key 长度**：密码框会回显旧值、typeText 是追加，
                // 追到几百字符界面上一模一样而服务端回 401（09-23 的 347 字符那次）。
                guard let k = s(step, "value"), !k.isEmpty else { note("[\(tag)] 缺 value"); break }
                let want = i(step, "expectLen") ?? k.count
                let field = scrollTo(app, { app.secureTextFields.firstMatch }, 8)
                guard field.exists && field.isHittable else { note("[\(tag)] 没找到密钥框"); shot("drive-\(tag)-nokey", full: true); break }
                field.tap(); sleep(1)
                if !app.keyboards.element.waitForExistence(timeout: 8) { note("[\(tag)] 键盘没起来，再点一次"); field.tap(); _ = app.keyboards.element.waitForExistence(timeout: 8) }
                _ = enterKey(app, field, k, tag)
                let after = ((field.value as? String) ?? "").count
                note("[\(tag)] ★ 填完长度 \(after)（应为 \(want)）" + (after == want ? " ✓" : " ✗"))
            default:
                note("[\(tag)] 不认识的 op「\(op)」—— 步骤表见 testDrive 的注释")
            }
        }
        shot("drive-end", full: true)
    }

    private func waitAny(_ app: XCUIApplication, _ preds: [String], _ t: TimeInterval) -> XCUIElement? {
        let end = Date().addingTimeInterval(t)
        while Date() < end {
            for p in preds { let e = find(app, p); if e.exists { return e } }
            usleep(500_000)
        }
        return nil
    }
    // 1.15.0 验收（2026-09-22）：中国版真机 Apple 登录连境内后端。按文字点，每步整屏截图；Apple 面板是系统进程画的，
    // 所以在 App 与 springboard 两处都找「继续 / 使用 xx 继续」。判据不在这里 —— 在服务器 auth.users 回读。
    func testCNAppleSignIn() throws {
        let cn = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator.cn")
        cn.activate(); sleep(4); shot("siwa-0-open", full: true)
        if let start = waitAny(cn, ["label == '开始设置'"], 4) { start.tap(); sleep(2) }
        shot("siwa-1-signin-screen", full: true); dump(cn, "siwa-1")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if waitAny(cn, ["elementType == 9 AND label == '登录'"], 2) == nil {   // 面板没开着才去点网页里的按钮
            guard let apple = waitAny(cn, ["label CONTAINS '用 Apple 登录'", "label CONTAINS 'Sign in with Apple'"], 8) else { XCTFail("找不到「用 Apple 登录」"); return }
            apple.tap(); sleep(4)
        }
        shot("siwa-2-sheet", full: true)
        // 面板上的主键：已授权过的 Apple 账户是「登录」，首次是「继续」。只认按钮，别点到标题「使用 Apple 账户登录…」。
        let cont = ["elementType == 9 AND label == '登录'", "elementType == 9 AND label == 'Sign In'", "elementType == 9 AND label BEGINSWITH '继续'", "elementType == 9 AND label BEGINSWITH 'Continue'"]
        var tapped = false
        for _ in 0..<3 {
            if let b = waitAny(cn, cont, 3) ?? waitAny(springboard, cont, 3) { note("siwa tap \(b.label)"); b.tap(); tapped = true; sleep(4); shot("siwa-3-after-tap", full: true) } else { break }
        }
        if !tapped { dump(cn, "siwa-sheet-cn"); dump(springboard, "siwa-sheet-sb") }
        sleep(8); shot("siwa-4-done", full: true); dump(cn, "siwa-4")
    }

    // 1.15.0 验收：中国版真机邮箱验证码登录连境内后端（用户 09-22 改为只测邮箱）。两段：发码 / 填码（码经 TEST_RUNNER_MT_CODE 传入）。
    private func cnHome() -> XCUIApplication {
        let cn = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator.cn")
        cn.terminate(); sleep(1); cn.activate(); sleep(4)
        if let later = waitAny(cn, ["elementType == 9 AND label == '以后再设置'"], 3) { later.tap(); sleep(2) }
        return cn
    }
    func testCNEmailSend() throws {
        let cn = cnHome(); allowSystemAlerts("em-home", timeout: 3); shot("em-0-home", full: true)
        guard let link = waitAny(cn, ["label == '或用邮箱登录'"], 6) else { dump(cn, "em-nolink"); XCTFail("找不到「或用邮箱登录」"); return }
        link.tap(); sleep(2)
        note("textFields: " + cn.textFields.allElementsBoundByIndex.map { "[\($0.label)|\($0.placeholderValue ?? "")|\($0.value as? String ?? "")]" }.joined(separator: " "))
        let f = cn.textFields.element(boundBy: 0)
        guard f.waitForExistence(timeout: 4) else { XCTFail("没有输入框"); return }
        f.tap(); sleep(1); f.typeText("belliedmonkey@gmail.com"); sleep(1)
        shot("em-1-typed", full: true)
        guard let send = waitAny(cn, ["elementType == 9 AND label == '发送验证码'"], 4) else { XCTFail("找不到「发送验证码」"); return }
        send.tap(); allowSystemAlerts("em-send", timeout: 3); sleep(4); shot("em-2-sent", full: true); dump(cn, "em-2")
    }
    func testCNEmailVerify() throws {
        let code = ProcessInfo.processInfo.environment["MT_CODE"] ?? ""
        guard code.count == 6 else { XCTFail("MT_CODE 不是 6 位：\(code.count)"); return }
        let cn = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator.cn")
        cn.activate(); sleep(2)
        note("textFields: " + cn.textFields.allElementsBoundByIndex.map { "[\($0.label)|\($0.placeholderValue ?? "")|\($0.value as? String ?? "")]" }.joined(separator: " "))
        let fields = cn.textFields.allElementsBoundByIndex.filter { $0.isHittable }
        guard let f = fields.last else { dump(cn, "ev-nofield"); XCTFail("没有可点的验证码框"); return }
        f.tap(); sleep(1); f.typeText(code); sleep(1); shot("ev-1-typed", full: true)
        guard let v = waitAny(cn, ["elementType == 9 AND label == '登录'"], 4) else { XCTFail("找不到「登录」"); return }
        v.tap(); sleep(15); shot("ev-2-after", full: true); dump(cn, "ev-2")
    }

    // 1.15.0 验收 · 第 9 行第 7 步：翻完之后打开宿主 ⇒ 收件箱被摄入，设置里出现「系统翻译 · <月份>」来源与张数。
    func testV9Inbox() throws {
        let app = XCUIApplication(bundleIdentifier: BT)
        app.terminate(); app.launch(); sleep(5)
        if let later = waitAny(app, ["elementType == 9 AND label == '以后再设置'"], 2) { later.tap(); sleep(2) }
        guard tapText(app, "label == '设置'", "设置") else { return }
        sleep(3)
        let rows = app.staticTexts.allElementsBoundByIndex.map { $0.label }.filter { $0.contains("系统翻译") || $0.contains("张卡") }
        note("inbox rows: " + rows.joined(separator: " ‖ "))
        shot("v9-settings", full: true)
    }

    func testTFInstall() throws {
        // ① App Store 里重新下载 TestFlight（以前装过 ⇒ redownload，不要密码）
        let tf = XCUIApplication(bundleIdentifier: "com.apple.TestFlight")
        if tf.state == .notRunning {
            XCUIDevice.shared.system.open(URL(string: "itms-apps://apps.apple.com/app/id899247664")!)
            let store = XCUIApplication(bundleIdentifier: "com.apple.AppStore")
            _ = store.wait(for: .runningForeground, timeout: 15)
            sleep(3); shot("tf-store", full: true)
            let open = ["label == '打开'", "label == 'Open'", "label == '打開'"]
            if waitAny(store, open, 2) == nil {
                let get = waitAny(store, ["identifier BEGINSWITH 'AppStore.offerButton'", "label == '获取'", "label == 'Get'", "label CONTAINS '下载'", "label CONTAINS 'Download'"], 10)
                guard let g = get else { dump(store, "store"); XCTFail("App Store 上找不到下载键"); return }
                note("store tap: id=\(g.identifier) label=\(g.label)"); g.tap()
                guard waitAny(store, open, 180) != nil else { shot("tf-store-stuck", full: true); dump(store, "store2"); XCTFail("TestFlight 180 s 内没装完"); return }
            }
            note("TestFlight 已装")
        }
        // ② TestFlight 里装大肚猴翻译
        tf.activate(); sleep(4); shot("tf-open", full: true)
        for _ in 0..<4 {   // 首次使用的介绍 / 条款 / 通知
            allowSystemAlerts("tf", timeout: 2)
            if let c = waitAny(tf, ["label == '继续'", "label == 'Continue'", "label == '接受'", "label == 'Accept'", "label == '以后'", "label == 'Not Now'"], 2) { note("tf intro tap \(c.label)"); c.tap(); sleep(2) } else { break }
        }
        dump(tf, "tf-list")
        guard let row = waitAny(tf, ["label CONTAINS '大肚猴翻译'"], 15) else { shot("tf-norow", full: true); XCTFail("TestFlight 里没有大肚猴翻译"); return }
        row.tap(); sleep(3); shot("tf-detail", full: true); dump(tf, "tf-detail")
        if let inst = waitAny(tf, ["label == '安装'", "label == 'Install'", "label == '更新'", "label == 'Update'", "label == '安裝'"], 8) {
            note("tf tap \(inst.label)"); inst.tap(); sleep(2); allowSystemAlerts("tf-install", timeout: 3)
        }
        guard waitAny(tf, ["label == '打开'", "label == 'Open'", "label == '打開'"], 240) != nil else { shot("tf-install-stuck", full: true); dump(tf, "tf-stuck"); XCTFail("大肚猴翻译 240 s 内没装完"); return }
        shot("tf-installed", full: true)
        // ③ 首次启动：与审核时同一个动作
        let cn = XCUIApplication(bundleIdentifier: "com.belliedmonkeytranslator.cn")
        cn.activate()
        let t0 = Date()
        for i in 0..<10 {
            sleep(1)
            if cn.state != .runningForeground { note(String(format: "启动后 %.1f s 状态=%ld（不在前台）", Date().timeIntervalSince(t0), cn.state.rawValue)); shot("cn-gone-\(i)", full: true); return }
        }
        note("启动后 10 s 仍在前台运行"); shot("cn-10s", full: true)
    }
}
