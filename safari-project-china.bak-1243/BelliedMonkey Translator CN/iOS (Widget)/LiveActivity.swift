// app/native/widget/LiveActivity.swift — 播客模式的灵动岛（§9.5）。
//
// 这个文件由 `scripts/sync-app-assets.js` 拷进 `iOS (Widget)/`，并由同一个脚本在
// pbxproj 里造出承载它的 target。**两件事都是幂等补丁**，因为 `safari-project*/` 是
// 转换器的一次性产物，重新生成会把它们一起抹掉。
//
// ── 为什么非得有一个独立 target ─────────────────────────────────────────────
// 媒体播放在灵动岛收起态的样子（图标 + 波形）是系统给的，第三方改不了 —— 想在那儿放
// 文字只有 Live Activity 一条路，而 Live Activity 必须住在 WidgetKit 扩展里。
// 这是本仓库第一个「凭空造 target」的补丁，也是所有原生补丁里最脆的一个。
import ActivityKit
import SwiftUI
import WidgetKit

// 会话属性。**零文案**：岛上显示的每个字都由 App 侧传进来（同 audio-bridge.swift 的
// 纪律），所以这里只有字段名。
struct MTPodcastAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String       // 原句
        var subtitle: String    // 译句
        var progress: String    // 第 i / n 张
        var playing: Bool
    }
    var sessionId: String
}

@main
struct MTWidgetBundle: WidgetBundle {
    var body: some Widget { MTPodcastActivity() }
}

struct MTPodcastActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MTPodcastAttributes.self) { context in
            // 锁屏 / 通知中心那一张。
            HStack(spacing: 12) {
                MTMascot(size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                    Text(context.state.subtitle).font(.subheadline)
                        .foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(context.state.progress).font(.caption2).foregroundStyle(.secondary)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.55))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { MTMascot(size: 38) }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.progress).font(.caption2).foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.title).font(.subheadline).bold().lineLimit(2)
                        Text(context.state.subtitle).font(.caption)
                            .foregroundStyle(.secondary).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                MTMascot(size: 20)
            } compactTrailing: {
                // 收起态只有约 24pt 宽 —— 放不下一个句子，所以放**进度**：它短、
                // 且是这个尺寸上唯一还读得出来的信息。
                Text(context.state.progress).font(.caption2).lineLimit(1)
            } minimal: {
                MTMascot(size: 18)
            }
        }
    }
}

// 大肚猴。**画出来而不是引资源**：扩展有自己的 bundle，引 App 的资产目录要么多一份
// 拷贝、要么多一个 App Group —— 而这只猴子只有几个圆和一条曲线。
// 颜色与 extension/icons/icon.svg 逐字一致（那个文件被 build.js 的 palette gate 钉着）。
struct MTMascot: View {
    let size: CGFloat
    private let terra = Color(red: 0.776, green: 0.443, blue: 0.224)   // #c67139
    private let cream = Color(red: 0.961, green: 0.918, blue: 0.847)   // #f5ead8
    private let ink = Color(red: 0.125, green: 0.118, blue: 0.114)     // #201e1d

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22).fill(terra)
            Circle().fill(cream).frame(width: size * 0.52, height: size * 0.52)
                .offset(y: -size * 0.17)
            Circle().fill(cream).frame(width: size * 0.17, height: size * 0.17)
                .offset(x: -size * 0.30, y: -size * 0.22)
            Circle().fill(cream).frame(width: size * 0.17, height: size * 0.17)
                .offset(x: size * 0.30, y: -size * 0.22)
            Circle().fill(cream).frame(width: size * 0.52, height: size * 0.52)
                .offset(y: size * 0.20)
            Circle().fill(ink).frame(width: size * 0.055, height: size * 0.055)
                .offset(x: -size * 0.07, y: -size * 0.20)
            Circle().fill(ink).frame(width: size * 0.055, height: size * 0.055)
                .offset(x: size * 0.07, y: -size * 0.20)
        }
        .frame(width: size, height: size)
    }
}
