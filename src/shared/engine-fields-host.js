// src/shared/engine-fields-host.js — learn/engine-fields.js 产物的入口壳（PR7b「同名产物覆盖」）。
//
// 扩展侧：options.html:44 / onboard.html:62 的 <script src="engine-fields.js"> 标签
// 一个不改，learn/engine-fields.js 产物改由本文件 bundle（build/ui-entries.config.js）
// —— 旧 IIFE 的 ABI（window.EngineFields，纯逻辑导出）由这里原样挂回。App 侧：
// main.jsx import 本文件获得同一实现 —— verify-app-bundle 的 evaluate 在页面里读
// EngineFields.SLOTS / .visibility / .isDevice（§8.10 回读判据），app-ui.js 载入即挂好。
//
// 设置页（两宿主）不走这个壳：它们直接 import ./engine-fields.js 与
// ../pages/engine-fields-view.jsx（React 挂载），宿主入口各自引到。
import EngineFields from './engine-fields.js';

try { window.EngineFields = EngineFields; } catch (_) {}
