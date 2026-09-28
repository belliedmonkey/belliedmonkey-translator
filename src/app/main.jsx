// src/app/main.jsx — Script.js 的最后一个模块（PR6a，接替 app/app.js 的位置）。
//
// 从 app/app.js 搬来的只有两件（其余全在 ./shell-model.js，逐字）：
//   · quick 分叉（原 15-17 行）—— 挪到这里是因为它必须发生在 bootShell() **之前**，
//     而它判定的前提是 #target-lang 已经在 DOM 里：quick-model 的 boot() 会从它读
//     #qk-lang 的选项（原 app/quick.js 的克隆）。原页面靠静态 HTML 天然满足；React
//     的 root.render 默认是**异步**调度，直接跟着跑 bootShell 会在 #target-lang 出现
//     之前判分叉 —— 所以用 flushSync 把 mount 钉成同步，再走分叉，时序与静态 HTML
//     完全对齐。
//   · 遥测尾（原 1779 行）—— 原样顶层语句，自守卫：quick 模式下 no-op。
//
// 执行顺序不变：这里仍是 Script.js 拼接的**最后**一段（build/app-bundle.js），
// 前面 70 个 IIFE 已把 AppQuick / MTTelemetry 等全局挂好。

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AppShell from './AppShell.jsx';
import PageText from '../lib/i18n.js';
import settingsModel from './settings-model.js';
import listenModel from './listen-model.js';
import setupDoneModel from './setup-done-model.js';
import docsModel from './docs-model.js';
import quickModel from './quick-model.js';
import QuickView from './quick-view.jsx';
import drivingModel from './driving-model.js';
import DrivingView from './driving-view.jsx';
import { bootShell } from './shell-model.js';
import NativeBridge from '../lib/native-bridge.js';
import '../shared/dialog-host.jsx';   // PR7a 副作用：挂 DialogHost 宿主 div + window.LearnDialog
                                      // ABI —— listen-model / shell-model / docs-model / review.js
                                      // 的裸全局调用靠它；uiLang 预读与下面 main 里那次幂等。
import '../shared/engine-fields-host.js'; // PR7b 副作用：挂 window.EngineFields 纯逻辑 ABI ——
                                          // verify-app-bundle 的 §8.10 回读在页面里取
                                          // SLOTS / visibility / isDevice。
import '../shared/grant-host.jsx';    // PR7b 副作用：挂 window.LearnGrant 纯逻辑 ABI ——
                                      // shell-model / settings-model / docs-model / quick-model
                                      // 与 verify-listen / verify-quick 的裸全局调用靠它。
import { boot as bootReview } from '../shared/review.js'; // PR7c：复习面（boot()，体内与扩展
                                      // 同一份字节）。只在下面 #quick 分流的 else 分支调 ——
                                      // quick 模式整段不执行（原 MAIN_ONLY 的组合根接棒）。
                                      // （其顶部的 PageI18n→PageText 耦合段已随 PR9 退役：
                                      // src/ 的 i18n 消费者全部翻到 PageText，review.js
                                      // 对 PageI18n 只剩扩展侧静态标记的涂装，自带双喂。）

// AppShell 是常量 vdom（零 props/state，见 AppShell.jsx 头注释），只渲染这一次；
// flushSync 保证返回时 DOM 已在 —— 下面的分叉与 bootShell 都同步摸得到它。
flushSync(() => {
  createRoot(document.getElementById('app')).render(<AppShell />);
});

// 界面语言的存储值在 bootShell 之前预读：设置页（SettingsView）的静态标签由
// useT 驱动，locale 要在第一次整页重画之前就位（AppShell 的 mount 时点 t 不受
// 影响，它的重涂随 boot 照旧 —— 原 applyStoredUiLang 的时序位）。
chrome.storage.local.get(['uiLang'], (r) => PageText.setUiLang((r && r.uiLang) || 'auto'));

// PR9：四个 window 级桥名（show / __mtAppleResult / __mtWebAuthResult / __mtDeepLink）
// 由桥统一挂载（此前 shell-model 直挂四个 window 属性 + 手写两处 pending 回放）；
// shell-model 的 bootShell 经 NativeBridge.onNative 接事件。挂在分叉前 —— quick
// 面板不订阅这些事件，但 Swift 若调用也照常入槽不炸；pending 槽与早到调用的
// hold-and-replay 语义见 native-bridge.js 头注释。
NativeBridge.installBridgeGlobals();

// verify 脚本 ABI：verify-listen / verify-app-bundle 经 window.settingsModel 调
// notifySettingsShown（旧 window.AppSettings 全局的后继）。
window.settingsModel = settingsModel;
// PR6c：listen 的旧全局 ABI。shell-model.js 的 bootShell 里 `AppListen.wire()` 等
// 裸全局引用照旧工作；test:listen 的 59 处 `AppListen._debug` 断言也吃这个名字。
window.AppListen = listenModel;
// PR6d：setup-done 的旧全局 ABI（settings-model/settings-view/shell-model 的 call-time
// 裸全局引用 + test:app 的全局存在性检查）。必须在 bootShell() 之前挂好 —— shell 的
// 同步初始化链（populateStatic 等）会摸到它们。
window.AppSetupDone = setupDoneModel;
// PR6d：docs 的旧全局 ABI（shell-model bootShell 里 `AppDocs.wire({ openSettings })`）。
window.AppDocs = docsModel;
// PR6d：quick 的旧全局 ABI。原生中继直接调 window.AppQuick._fromNative；verify-quick
// 读 AppQuick.CHANNEL / PROTOCOL / boot / isQuickMode；下面的分叉也判这个名字。
window.AppQuick = quickModel;
// PR6d：driving 的旧全局 ABI（shell-model 的 start/back 监听与 paintStatic 链摸裸全局
// AppDriving；verify-learn-flow 读 _debug/refreshEntry/start/stop）。必须在 bootShell()
// 之前挂好 —— shell 的同步初始化链会摸到它。
window.AppDriving = drivingModel;

// 快速翻译的面板页（learning-design §9.9）：同一份页面以 #quick 加载时只启动
// AppQuick —— 不登录、不同步、（原 app.js:15-17 逐字；return 换 if/else）。
// MAIN_ONLY 门（test/build-scripts）钉着这个分叉的形状：`isQuickMode()) {` 与
// `AppQuick.boot();` 之间只许空白。所以画布挂载放在分叉**之后**（boot() 先把状态
// 备好 —— 语种选项、quick-ready —— 随后 flushSync 挂 QuickView，第一帧就是完整
// 面板；原生对 quick-ready 的任何回包都排在 JS 当前任务之后，赶不到挂载前面）。
if (typeof AppQuick !== 'undefined' && AppQuick.isQuickMode()) {
  AppQuick.boot();
} else {
  bootReview();   // 先于 bootShell：旧包里 review.js 段也在 APP_ENTRY 之前执行（时序就近保留）
  bootShell();
}
if (typeof AppQuick !== 'undefined' && AppQuick.isQuickMode()) {
  flushSync(() => {
    createRoot(document.getElementById('quick-root')).render(<QuickView />);
  });
}

// 用量事件：App 打开即 flush + 当日心跳。（原 app.js:1779 逐字。）
try { if (typeof MTTelemetry !== 'undefined' && !(typeof AppQuick !== 'undefined' && AppQuick.isQuickMode())) MTTelemetry.init({ flushNow: true }); } catch (_) {}
