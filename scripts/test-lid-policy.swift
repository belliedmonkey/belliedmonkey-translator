// scripts/test-lid-policy.swift — 语种判定策略的边界值（回归清单 L-01…L-06，全部 P0）。
//
// 为什么不用真音频：这些判据是**阈值与窗档的边界**（1 s 窗的 5.99 / 6.00、换判的 5.9 / 6.0、
// 轻量修正的 4/5/6/6/4）。靠外放「碰巧跑对」证明不了边界 —— 这里直接喂分数。
// 编译：`npm run test:lid`（swiftc app/native/lid-ecapa.swift scripts/test-lid-policy.swift）。
import Foundation

let ZH = "zh", TH = "th"
let LANGS = [ZH, TH]

/// 只喂「每一档窗长的 (llr, top)」，其余照真实调用。
func decide(last: String, fed: Int, llr: [Int: Float], rewrites: [String: Int] = [:],
            rewriteFix: Bool = true, top: String = ZH) -> (String, Float)? {
    let out = MTLidPolicy.decide(MTLidPolicy.Input(
        lastDecided: last, fedAudioSamples: fed, langs: LANGS,
        scores: { cap in llr[cap].map { ($0, top) } },
        rewrites: rewrites, rewriteFix: rewriteFix))
    return out.map { ($0.lang, $0.effThr) }
}

@main
struct LidPolicyTest {
    static var fails = 0, passes = 0
    static func ok(_ cond: Bool, _ what: String) {
        if cond { passes += 1; print("  ✓ \(what)") }
        else { fails += 1; print("  ✗ \(what)") }
    }
    /// 读**有效阈值**：用 4 s 主窗 + |LLR| 7 造一个必然成立的换判，返回它算出来的 effThr。
    /// （不能拿 2 s 档反推：那一档的换判门槛本来就是 6，会把阈值的效果吃掉 —— 见下面那条断言。）
    static func effThr(_ rewrites: [String: Int], _ rewriteFix: Bool = true) -> Float? {
        decide(last: ZH, fed: 64000, llr: [32000: -7.0, 64000: -7.0], rewrites: rewrites, rewriteFix: rewriteFix)?.1
    }

    static func main() {
        print("L-01 · 首判 1 s 窗（阈值 6）")
        ok(decide(last: "", fed: 16000, llr: [16000: 5.99]) == nil, "1 s 窗 |LLR|=5.99 不出判词")
        ok(decide(last: "", fed: 16000, llr: [16000: 6.00]).map { $0.0 } == ZH, "1 s 窗 |LLR|=6.00 判 langs[0]")
        ok(decide(last: "", fed: 16000, llr: [16000: -6.00]).map { $0.0 } == TH, "1 s 窗 |LLR|=-6.00 判 langs[1]")
        ok(decide(last: "", fed: 15999, llr: [16000: -9.0]) == nil, "话音不到 1.0 s：任何 LLR 都不判")

        print("L-02 · 首判之后不再用 1 s 窗")
        ok(decide(last: ZH, fed: 24000, llr: [16000: -9.0, 32000: -9.0]) == nil, "1.5 s：2 s 窗填不满 ⇒ 不判")
        ok(decide(last: ZH, fed: 32000, llr: [32000: 4.0]) == nil, "2 s 窗方向仍是 zh ⇒ 同一门不重复报")

        print("L-03 · 换判门槛（2 s 窗 |LLR| ≥ 6）")
        ok(decide(last: ZH, fed: 32000, llr: [32000: -5.9]) == nil, "2 s 窗 |LLR|=5.9 不换")
        ok(decide(last: ZH, fed: 32000, llr: [32000: -6.0]).map { $0.0 } == TH, "2 s 窗 |LLR|=6.0 换成 th")
        ok(decide(last: ZH, fed: 64000, llr: [32000: -5.0, 64000: -7.0]) == nil,
           "主窗（4 s）过了但 2 s 窗只有 5 ⇒ 不换")

        print("L-05 · 轻量修正（另一门改写次数多 ⇒ 阈值抬高，最多 +2；首判不加）")
        ok(effThr([ZH: 0, TH: 0]) == 4.0, "改写 (0,0) ⇒ 有效阈值 4")
        ok(effThr([ZH: 0, TH: 4]) == 5.0, "改写 (0,4) ⇒ 有效阈值 5")
        ok(effThr([ZH: 0, TH: 8]) == 6.0, "改写 (0,8) ⇒ 有效阈值 6")
        ok(effThr([ZH: 0, TH: 20]) == 6.0, "改写 (0,20) ⇒ 有效阈值封顶 6（最多 +2）")
        ok(effThr([ZH: 5, TH: 1]) == 4.0, "改写 (5,1) ⇒ 本路更活跃，阈值不动（4）")
        ok(effThr([ZH: 0, TH: 20], false) == 4.0, "lidRewriteFix=false ⇒ 修正不生效（L-16 的对比档）")
        ok(decide(last: "", fed: 16000, llr: [16000: -6.0], rewrites: [ZH: 0, TH: 20]).map { $0.0 } == TH,
           "首判（lastDecided 为空）不加轻量修正")
        // **附带结论，也是 L-16 要报的方向问题**：2 s 档上修正最多把 4 抬到 6，而换判本来就要求
        // 2 s 窗 |LLR| ≥ 6 ⇒ 那一档上它**改不动结果**（开关都一样）。方向问题见 L-16 的报告。
        ok(decide(last: ZH, fed: 32000, llr: [32000: -5.0], rewrites: [ZH: 0, TH: 20]) == nil
           && decide(last: ZH, fed: 32000, llr: [32000: -5.0], rewrites: [ZH: 0, TH: 0]) == nil,
           "2 s 档：修正开/关，|LLR|=5 都判不出来 —— 真正的闸是换判门槛 6")

        print("L-06 · 只比两门（top1 是第三门也不冒出第三门）")
        ok(decide(last: ZH, fed: 32000, llr: [32000: -7.0], top: "nn").map { $0.0 } == TH,
           "top 是第三门 ⇒ 仍只可能在 langs[0] / langs[1] 里")

        print("\n" + (fails == 0 ? "✓ L-01…L-06 全过（\(passes) 条）" : "✗ \(fails) 条红 / \(passes) 条绿"))
        exit(fails == 0 ? 0 : 1)
    }
}
