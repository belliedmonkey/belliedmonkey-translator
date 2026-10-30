// src/shared/utm-host.js — learn/utm.js 产物的入口壳（BEL-155）。
//
// 扩展侧：options / onboard / popup 在 feedback.js **之前**挂
// <script src="../learn/utm.js">；本文件 bundle 覆盖 learn/utm.js，挂回
// window.MTUtm（withUtm / utmSource / utmCampaign）。App 侧：main.jsx 副作用
// import 本文件 —— §9.4 对账门要求两宿主 src/shared 集合一致；shell-model /
// settings-view 等直接 import ./utm.js 的具名导出。
import utm from './utm.js';

try { window.MTUtm = utm; } catch (_) {}
