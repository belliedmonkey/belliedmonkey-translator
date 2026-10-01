// src/app/firstrun.js — App 首屏三段式的唯一判定（2026-10-01，#532）。
//
// 规格：`design/firstrun-3step/firstrun-spec.html` §1（boot）与 §3（就绪判据）；
// 交互规约：`docs/interaction-spec.md`「App 首屏三段式」。
//
// 三条自我约束，门禁 `test/app-firstrun.test.js` 的 R3/R4 就是按它们打的：
//   · **纯函数**：不引 Registry、不读存储、不摸 DOM —— 所以它能被 16 组布尔组合逐一断言；
//   · **不看 flavor**：两版逐条同构，差异只在引擎那一格的来源（R4）；
//   · **不看扩展状态**：就绪判据不含 Safari 扩展（#485 口径，R3）。
//
// 就绪 = 登录 ∧ 引擎可解析 ∧ 识别语言包 ∧ 朗读包。

/** 就绪判据**唯一**读取的四个输入。顺序即界面上的判定顺序。 */
export const READY_INPUTS = ['loggedIn', 'engine', 'asrPack', 'ttsPack'];

export function readyInputs() {
  return READY_INPUTS.slice();
}

export function isReady(s) {
  return READY_INPUTS.every((k) => !!s[k]);
}

// 降级：**唯一**允许绕过屏 2 的情形是「这台设备的识别器不支持这个语种」——
// 那时识别这条路本来就走不通，把朗读包下完、其余功能照用，比卡在门口好。
// 其余原因（离线 / 蜂窝 / 空间不足 / 未知）一律不许绕过，只能重试。
const DEGRADABLE = new Set(['asrUnsupported']);

export function degradeAllowed(reason) {
  return DEGRADABLE.has(reason);
}

/**
 * boot 判定（规格 §1）。顺序即优先级：
 *   未登录                  → 'login'      （屏 1 只有登录）
 *   缺任一设备包            → 'packs'      （**硬门**；降级由屏内处理，不在这里放行）
 *   就绪但没看过引导        → 'onboarding' （软门，可跳过）
 *   否则                    → 'home'
 *
 * 引擎可解析**不参与屏序**（2026-10-01 模拟器实测改的口径）：
 *   原来写的是「未登录 **或** 引擎不可解析 → 'login'，同一屏，不为引擎另造一屏」。实测下来
 *   它不是「同一屏」：带着会话的人落在 'login' 时，屏 1 的登录卡不适用，实际露出来的是**首页**，
 *   于是**屏 2 的硬门被跳过**（两个包一个都没下），而首页上也没有任何东西能用 —— 死角。
 *   引擎仍是 `isReady()` 的输入（「配好了」的判据不放松），但它决定的是**能不能算就绪**，
 *   不是**先看哪一屏**。引擎不通且包已就绪的人落首页，由那里的「设置」出去 —— 比卡在死角诚实。
 */
export function step(s) {
  if (!s.loggedIn) return 'login';
  if (!s.asrPack || !s.ttsPack) return 'packs';
  if (!s.onboardingSeen) return 'onboarding';
  return 'home';
}
