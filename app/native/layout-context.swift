// app/native/layout-context.swift — Duo P0 LayoutContext 桥（SPEC-DUO-P0 §1 / T1–T2）。
//
// 由 scripts/sync-app-assets.js 以标记块贴进 Shared (App)/ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 采集：horizontal/vertical size class + safeAreaInsets + scene/window bounds。
// 推导 PresentationMode：compact→singleCompact，regular 宽→dualRegular。
// dualSurfaceTent 枚举可预留给 1.21.1，**运行时永不 attach companion**（P0 硬禁）。
//
// 禁：UIScreen.main / userInterfaceIdiom / UIDevice.orientation 驱动布局（INV-5 / AC-D5）。
// 通知 JS：CustomEvent("LayoutContextChanged") + window.__mtLayoutContext；并写 CSS 变量。
#if os(iOS)
import UIKit
import WebKit

enum MTPresentationMode: String {
    case singleCompact
    case dualRegular
    /// 预留给 1.21.1 帐篷 A；P0 不得选用。
    case dualSurfaceTent
}

final class MTLayoutContext: NSObject {
    static let shared = MTLayoutContext()

    private weak var hostView: UIView?
    private weak var webView: WKWebView?
    private var probe: MTLayoutProbeView?
    private var lastJSON: String = ""
    private var installed = false

    /// 页面 didFinish 后再推一次：install 时常早于 Main.html，首次 evaluate 会丢。
    func republish() {
        lastJSON = ""
        publish()
    }

    /// ViewController.viewDidLoad 之后调用一次（sync 补丁行）。
    func install(hostView: UIView, webView: WKWebView) {
        self.hostView = hostView
        self.webView = webView
        if probe == nil {
            let p = MTLayoutProbeView(frame: .zero)
            p.isUserInteractionEnabled = false
            p.backgroundColor = .clear
            p.translatesAutoresizingMaskIntoConstraints = false
            hostView.insertSubview(p, at: 0)
            NSLayoutConstraint.activate([
                p.leadingAnchor.constraint(equalTo: hostView.leadingAnchor),
                p.trailingAnchor.constraint(equalTo: hostView.trailingAnchor),
                p.topAnchor.constraint(equalTo: hostView.topAnchor),
                p.bottomAnchor.constraint(equalTo: hostView.bottomAnchor),
            ])
            p.onChange = { [weak self] in self?.publish() }
            probe = p
        }
        installed = true
        publish()
    }

    /// Duo P0 T6：WKWebView 始终贴 scene/host bounds（约束优先于 storyboard fixedFrame）。
    static func pinWebViewToHost(_ webView: WKWebView, host: UIView) {
        webView.translatesAutoresizingMaskIntoConstraints = false
        // 若已在其它 superview，先归位
        if webView.superview !== host {
            webView.removeFromSuperview()
            host.addSubview(webView)
        }
        // 清掉旧约束再钉四边（幂等：重复 install 不叠约束名冲突——先 deactivate 同视图约束）
        NSLayoutConstraint.deactivate(host.constraints.filter {
            ($0.firstItem as? UIView) === webView || ($0.secondItem as? UIView) === webView
        })
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            webView.topAnchor.constraint(equalTo: host.topAnchor),
            webView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
        webView.autoresizingMask = []
    }

    private func publish() {
        guard let host = hostView else { return }
        let tc = host.traitCollection
        let h = sizeClassName(tc.horizontalSizeClass)
        let v = sizeClassName(tc.verticalSizeClass)
        let inset = host.safeAreaInsets
        let bounds = host.bounds
        // PresentationMode：只跟 size class，不跟设备。P0 永不 dualSurfaceTent。
        let mode: MTPresentationMode = (tc.horizontalSizeClass == .regular)
            ? .dualRegular : .singleCompact
        var dict: [String: Any] = [
            "horizontalSizeClass": h,
            "verticalSizeClass": v,
            "safeAreaInsets": [
                "top": inset.top, "left": inset.left,
                "bottom": inset.bottom, "right": inset.right,
            ],
            "sceneGeometry": [
                "x": bounds.origin.x, "y": bounds.origin.y,
                "width": bounds.size.width, "height": bounds.size.height,
            ],
            "presentationMode": mode.rawValue,
        ]
        // 占位：竖向系统栏 / ReservedRegion 真几何 need-27.1；字段先在，值恒空数组。
        dict["toolbarVerticalEdge"] = NSNull()
        dict["reservedRegions"] = [] as [Any]

        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        if json == lastJSON { return }
        lastJSON = json

        let js = """
        (function(ctx){
          try {
            window.__mtLayoutContext = ctx;
            var root = document.documentElement;
            if (root && root.style) {
              var s = ctx.safeAreaInsets || {};
              root.style.setProperty('--mt-safe-top', (s.top||0) + 'px');
              root.style.setProperty('--mt-safe-left', (s.left||0) + 'px');
              root.style.setProperty('--mt-safe-bottom', (s.bottom||0) + 'px');
              root.style.setProperty('--mt-safe-right', (s.right||0) + 'px');
              var g = ctx.sceneGeometry || {};
              root.style.setProperty('--mt-scene-width', (g.width||0) + 'px');
              root.style.setProperty('--mt-scene-height', (g.height||0) + 'px');
              root.setAttribute('data-mt-presentation', ctx.presentationMode || '');
              root.setAttribute('data-mt-h-size', ctx.horizontalSizeClass || '');
            }
            window.dispatchEvent(new CustomEvent('LayoutContextChanged', { detail: ctx }));
          } catch (e) {}
        })(\(json))
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func sizeClassName(_ c: UIUserInterfaceSizeClass) -> String {
        switch c {
        case .compact: return "compact"
        case .regular: return "regular"
        default: return "unspecified"
        }
    }
}

/// 透明探针：trait / safeArea / layout 变化时回调（不读 UIScreen / idiom / orientation）。
private final class MTLayoutProbeView: UIView {
    var onChange: (() -> Void)?
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        onChange?()
    }
    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        onChange?()
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        onChange?()
    }
}
#endif
