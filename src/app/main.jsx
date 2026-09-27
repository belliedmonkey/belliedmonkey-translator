// src/app/main.jsx — Script.js 的最后一个模块（PR6a，接替 app/app.js 的位置）。
//
// 从 app/app.js 搬来的只有两件（其余全在 ./shell-model.js，逐字）：
//   · quick 分叉（原 15-17 行）—— 挪到这里是因为它必须发生在 bootShell() **之前**，
//     而它判定的前提是 #target-lang 已经在 DOM 里：app/quick.js:81 会从它克隆
//     #qk-lang 的选项。原页面靠静态 HTML 天然满足；React 的 root.render 默认是
//     **异步**调度，直接跟着跑 bootShell 会在 #target-lang 出现之前判分叉 ——
//     所以用 flushSync 把 mount 钉成同步，再走分叉，时序与静态 HTML 完全对齐。
//   · 遥测尾（原 1779 行）—— 原样顶层语句，自守卫：quick 模式下 no-op。
//
// 执行顺序不变：这里仍是 Script.js 拼接的**最后**一段（build/app-bundle.js），
// 前面 70 个 IIFE 已把 AppQuick / MTTelemetry 等全局挂好。

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AppShell from './AppShell.jsx';
import PageText from '../lib/i18n.js';
import settingsModel from './settings-model.js';
import { bootShell } from './shell-model.js';

// ── 迁移期活约束：App 页里有两份 i18n 状态，必须同进同退 ─────────────────────
// PageI18n（extension/learn/i18n.js，原样共享字节）服务还没翻转的孤岛
// （review/listen/driving/quick/setup-done，PR6c/6d 收）；PageText（src/lib/i18n.js）
// 服务已迁的 React 视图。旧代码画什么都经 PageI18n，所以「谁变了」无所谓；设置页
// 拆到 PageText 之后，「喂了老的没喂新的」就成了一半中文一半英文 —— 2026-09-27
// test:learn 预载三红就是这么来的：夹具裸写 localStorage 的 uiLang 谁也没通知，
// 之后预载里补译文的缓存写入走到总线，review.js 的 reloadSettings 重读存储、
// 调 PageI18n.setUiLang('en')，PageText 没人喂，按钮/账单停在中文而判据读 PageI18n
// （en），三个断言全红。这条改uiLang 的路不止一条（总线、review 的重读、原生桥、
// 未来的直接写），逐条对喂就是逐条漏 —— 所以在组合根耦合一次：
// **喂 PageI18n 的任何地方都自动喂到 PageText**。等最后一个 PageI18n 消费者翻转
// （PR9），这段连同 PageI18n 一起退役。
//
// 覆盖不到的只有 applyStoredUiLang 内部那次闭包直调（extension/learn/i18n.js:69
// 不过导出方法）—— 它只在 boot 跑，boot 时两个状态各自读同一份存储，本来就一致。
// 整段只存在于 App 包：扩展页没有 main.jsx，共享字节零改动（§9.4）。
if (typeof PageI18n !== 'undefined' && typeof PageI18n.setUiLang === 'function') {
  const feedOld = PageI18n.setUiLang.bind(PageI18n);
  PageI18n.setUiLang = (v) => {
    feedOld(v);
    try { PageText.setUiLang(v); } catch (_) {}
  };
}

// AppShell 是常量 vdom（零 props/state，见 AppShell.jsx 头注释），只渲染这一次；
// flushSync 保证返回时 DOM 已在 —— 下面的分叉与 bootShell 都同步摸得到它。
flushSync(() => {
  createRoot(document.getElementById('app')).render(<AppShell />);
});

// 界面语言的存储值在 bootShell 之前预读：设置页（SettingsView）的静态标签由
// useT 驱动，locale 要在第一次整页重画之前就位（AppShell 的 mount 时点 t 不受
// 影响，它的重涂随 boot 照旧 —— 原 applyStoredUiLang 的时序位）。
chrome.storage.local.get(['uiLang'], (r) => PageText.setUiLang((r && r.uiLang) || 'auto'));

// verify 脚本 ABI：verify-listen / verify-app-bundle 经 window.settingsModel 调
// notifySettingsShown（旧 window.AppSettings 全局的后继）。
window.settingsModel = settingsModel;

// 快速翻译的面板页（learning-design §9.9）：同一份页面以 #quick 加载时只启动
// AppQuick —— 不登录、不同步、（原 app.js:15-17 逐字；return 换 if/else）。
if (typeof AppQuick !== 'undefined' && AppQuick.isQuickMode()) {
  AppQuick.boot();
} else {
  bootShell();
}

// 用量事件：App 打开即 flush + 当日心跳。（原 app.js:1779 逐字。）
try { if (typeof MTTelemetry !== 'undefined' && !(typeof AppQuick !== 'undefined' && AppQuick.isQuickMode())) MTTelemetry.init({ flushNow: true }); } catch (_) {}
