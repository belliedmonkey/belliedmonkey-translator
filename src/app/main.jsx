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
import { bootShell } from './shell-model.js';

// AppShell 是常量 vdom（零 props/state，见 AppShell.jsx 头注释），只渲染这一次；
// flushSync 保证返回时 DOM 已在 —— 下面的分叉与 bootShell 都同步摸得到它。
flushSync(() => {
  createRoot(document.getElementById('app')).render(<AppShell />);
});

// 快速翻译的面板页（learning-design §9.9）：同一份页面以 #quick 加载时只启动
// AppQuick —— 不登录、不同步、（原 app.js:15-17 逐字；return 换 if/else）。
if (typeof AppQuick !== 'undefined' && AppQuick.isQuickMode()) {
  AppQuick.boot();
} else {
  bootShell();
}

// 用量事件：App 打开即 flush + 当日心跳。（原 app.js:1779 逐字。）
try { if (typeof MTTelemetry !== 'undefined' && !(typeof AppQuick !== 'undefined' && AppQuick.isQuickMode())) MTTelemetry.init({ flushNow: true }); } catch (_) {}
