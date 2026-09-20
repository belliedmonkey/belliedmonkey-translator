// app/native/translate-ext/TranslateExt.swift — iOS 的「默认翻译 App」弹层
// （learning-design §9.9 / iOS 线 I-5；扩展点 com.apple.public.translation-ui-provider）。
//
// 系统在任何 App 里选中文字 ›「翻译」时把这个扩展拉起来，给一个半屏弹层。系统自己出
// 标题栏与 ✕，下面这一段 SwiftUI 是我们的。
//
// `context` 给的只有这些（T1 尖刺从 SDK 的 .swiftinterface 与真机上读出来的，
// 文档与网页示例对不上，以这里为准）：
//   var inputText: AttributedString? { get }
//   var allowsReplacement: Bool { get }
//   func finish(translation: AttributedString?)
//   func expandSheet()
// **没有源语言，也没有目标语言** —— 译成什么由我们自己的「译成」设置决定。
//
// 三条纪律：
//   · 原文**立刻**显示，译文用骨架等 —— 弹层出现到译文落地真机上是 1.2–1.4 s
//   · 失败给码、给出口（重试 / 打开 App），不把原始错误画在屏幕上
//   · 「替换原文」只在 `allowsReplacement` 为真时**存在**，不是灰着
import SwiftUI
import TranslationUIProvider
import ExtensionKit

@main
final class MTTranslateExtension: TranslationUIProviderExtension {
    required init() {}
    var body: some TranslationUIProviderExtensionScene {
        TranslationUIProviderSelectedTextScene { context in
            MTTranslateSheet(context: context)
        }
    }
}

struct MTTranslateSheet: View {
    @State private var context: TranslationUIProviderContext
    @State private var translated = ""
    @State private var failCode: String?
    @State private var slow = false
    @State private var started = false
    @Environment(\.openURL) private var openURL

    private let engine = MTExtEngine()
    private let config = MTExtConfig.load()

    init(context c: TranslationUIProviderContext) { _context = State(initialValue: c) }

    private var source: String { context.inputText.map { String($0.characters) } ?? "" }
    private var busy: Bool { translated.isEmpty && failCode == nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(source)
                    .font(.body)
                    .textSelection(.enabled)

                if busy {
                    // 骨架 + 一行状态。**不转圈就完了** —— 免费额度慢起来是 20 s 量级，
                    // 一个没有进度也没有出口的转圈是这条路上最贵的失败。
                    VStack(alignment: .leading, spacing: 6) {
                        Text(ExtCopy.key("sys_ui_translating"))
                            .font(.subheadline).foregroundStyle(.secondary)
                        if slow {
                            Text(ExtCopy.key("sys_ui_slow"))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } else if let code = failCode {
                    Text(ExtCopy.fail(code))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Text(translated)
                        .font(.body)
                        .textSelection(.enabled)
                }

                actions

                // 首次披露。系统在这之前已经弹过它自己那一页（「所选内容将发送给…」），
                // 但那句只说「发给这个 App」，没说「发给你配置的引擎」。所以这一行仍要在，
                // 而且**不可点、不拦路**（交互稿修订 3）。
                if !config.provider.isEmpty {
                    // 免费额度那条路要说**经我们中转**，自带 key 那条要说**不经过我们**——
                    // 一句话套两种事实，其中一种必然是假的（Gate J-2 定的两句并列）。
                    Text(config.provider == "grant"
                         ? ExtCopy.key("sys_disclose_grant")
                         : ExtCopy.key("sys_disclose_direct").replacingOccurrences(of: "{name}", with: config.provider))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
        .onAppear { if !started { started = true; run() } }
    }

    @ViewBuilder private var actions: some View {
        HStack(spacing: 12) {
            if let code = failCode {
                if needsApp(code) {
                    Button(ExtCopy.key("sys_ui_open_app")) { openApp() }.buttonStyle(.borderedProminent)
                } else if ExtCopy.retryable.contains(code) {
                    Button(ExtCopy.key("quick_retry")) { retry() }.buttonStyle(.borderedProminent)
                }
            } else if !translated.isEmpty {
                // 可替换时才有这个按钮。网页里 `allowsReplacement` 是 false（T1 实测），
                // 可编辑的文本框里是 true。
                if context.allowsReplacement {
                    Button(ExtCopy.key("sys_ui_replace")) {
                        context.finish(translation: AttributedString(translated))
                    }.buttonStyle(.borderedProminent)
                }
                Button(ExtCopy.key("quick_copy")) { UIPasteboard.general.string = translated }
            }
            Spacer()
            // **这里原来有一个「完成」按钮，调 `context.finish(translation: nil)`。2026-09-21
            // 真机验尸之后删掉了**（画布第 1 页 SheetFinish 板；用户 2026-09-20 报「点完成没用」）。
            //
            // 两种宿主、两种坏法，同一个按钮 —— iPhone 14 Pro / iOS 27：
            //   · Safari 网页（allowsReplacement = false）：hittable = true，译文已落定之后
            //     点了 3 次，2 秒与 6 秒各读一次弹层是否还在 —— 六次读回全是「还在」，关掉 0 次。
            //   · 备忘录（allowsReplacement = true，「替换原文」真的出现了）：看得见，
            //     但 hittable = false，点不到。
            //
            // 布局逐行查过：它就在这个 HStack 里、在 Spacer() 之后，渲染完全正常 —— 坏的是行为。
            // 而 `finish(translation:)` 是 Apple 给扩展的**唯一**关闭入口，带 nil 时不工作，
            // 所以没有「换个实现」这条路。
            //
            // 关闭走弹层右上角**系统自己那个 ✕**（整轮验证每一次都靠它关的）。剩下的
            // 「替换原文」「复制译文」都是真能用的动作。依据是本仓两条既有的规矩：
            // 「灰掉不如不存在」、「不存在的功能不许长死状态条」。
        }
        .font(.subheadline)
    }

    /// 要去 App 里改配置的那几种。给「重试」等于让人再失败一次。
    private func needsApp(_ code: String) -> Bool {
        ["needs_setup", "not_synced", "no_base", "unknown_provider", "auth",
         "credit_exhausted", "grant_invalid", "grant_revoked", "model_not_allowed"].contains(code)
    }

    private func openApp() {
        let scheme = (Bundle.main.object(forInfoDictionaryKey: "MTDeepLinkScheme") as? String) ?? ""
        guard !scheme.isEmpty, let u = URL(string: "\(scheme)://setup?from=system-translate") else { return }
        openURL(u)
    }

    private func retry() {
        translated = ""; failCode = nil; slow = false
        run()
    }

    private func run() {
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { failCode = "empty"; return }
        // 连快照都没有 ⇒ App 还没同步过来，不是「没配引擎」。两句话的出口相同，
        // 但说错了会让一个配好了的人去重配一遍。
        guard config.hasSnapshot else { failCode = "not_synced"; return }
        guard engine.boot(seed: config.seed) else { failCode = "engine_unavailable"; return }

        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { if busy { slow = true } }
        engine.translate(source, lang: "") { out in
            slow = false
            if (out["ok"] as? Bool) == true, let t = out["text"] as? String, !t.isEmpty {
                translated = t
                capture(t, lang: (out["lang"] as? String) ?? "")
            } else {
                failCode = (out["code"] as? String) ?? "unknown"
            }
        }
    }

    /// 抄一份进收件箱，等 App 下次打开时收进复习库（§9.9）。**只在成功之后**，
    /// 而且两把开关都开着才写 —— 关着就整个不写，不留用户看不见的积压。
    private func capture(_ tr: String, lang: String) {
        guard config.learnEnabled, config.handoffCapture else { return }
        MTExtInbox.write(text: source, tr: tr, lang: "", trLang: lang, via: "system")
    }
}
