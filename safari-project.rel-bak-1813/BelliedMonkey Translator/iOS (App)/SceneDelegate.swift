//
//  SceneDelegate.swift
//  iOS (App)
//
//  Created by belliedmonkey on 2026/9/11.
//

import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let _ = (scene as? UIWindowScene) else { return }
        // Patched by scripts/sync-app-assets.js — 跨面交接（§8.4.1.1）。
        // 冷启动这一支：App 是被这条 URL 拉起来的。
        if let ctx = connectionOptions.urlContexts.first { MTDeepLink.handle(ctx.url) }
    }

    // 热启动这一支：App 已经在后台开着。
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let ctx = URLContexts.first { MTDeepLink.handle(ctx.url) }
    }

}
