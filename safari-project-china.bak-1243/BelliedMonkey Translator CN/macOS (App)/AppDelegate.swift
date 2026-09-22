//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by belliedmonkey on 2026/9/8.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    // Patched by scripts/sync-app-assets.js — 跨面交接（§8.4.1.1）。
    func application(_ application: NSApplication, open urls: [URL]) {
        if let u = urls.first { MTDeepLink.handle(u) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Override point for customization after application launch.
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
