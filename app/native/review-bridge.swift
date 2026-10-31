// app/native/review-bridge.swift — 系统评分弹窗（SKStoreReviewController）。
//
// 由 scripts/sync-app-assets.js 以标记块的形式贴进 ViewController.swift。
// **改这里，然后跑 `npm run app:sync`**；直接改工程里那份会被覆盖。
//
// 页面在收获时刻经 controller 通道发 "request-review"（learn/feedback.js 的 noteValueMoment：
// 做完一组复习 / 听译或实时字幕结束且有句子 / Mac 快速翻译成功 / 系统翻译收件箱进卡；
// 成功 ≥3 次且跨 ≥2 天才请求，本机 90 天冷却 —— telemetry-design §3.12，2026-09-25 裁定）。
// 原来只在「一轮复习刷完且 ≥3 张」之后发，1.16.0 之前一次都没发生过。系统再节流一层：Apple 每 365 天最多弹 3 次，
// 而且弹不弹不告诉我们 —— 所以这里没有回调，也不该有：它不是一个能「确认成功」的动作。
//
// 2026-09-05 的数字：30 天 202 次下载，App Store 两个条目 0 条评论。85% 的量来自
// 商店自然搜索，评分是那条渠道里唯一能动的社会证明。
import StoreKit

enum MTReview {
    static func request() {
        DispatchQueue.main.async {
#if os(iOS)
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }) else { return }
            SKStoreReviewController.requestReview(in: scene)
#elseif os(macOS)
            SKStoreReviewController.requestReview()
#endif
        }
    }
}
