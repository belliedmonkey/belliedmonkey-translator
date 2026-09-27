// src/shared/grant-host.jsx — learn/grant.js 产物的入口壳（PR7b「同名产物覆盖」）。
//
// 扩展侧：popup:30 / options:53 / onboard:65 / review:239 / docs:38 五处
// <script src="grant.js"> 标签一个不改，learn/grant.js 产物改由本文件 bundle
// （build/ui-entries.config.js）—— 旧 IIFE 的 ABI（window.LearnGrant，**纯逻辑**
// 导出）由这里原样挂回：popup 的 popupRow、review 的 enabled()、docs-page 的
// activeIn()、verify-onboard 的 enabled() 照常工作。App 侧：main.jsx import 本
// 文件获得同一实现 —— shell-model / settings-model / docs-model / quick-model 与
// verify-listen / verify-quick 在页面里读全局 LearnGrant，app-ui.js 载入即挂好。
//
// **不挂 render**：卡面渲染在视图半边（./grant-view.jsx 的 named export render），
// 两宿主的设置页 / 引导页直接 import 它；window.LearnGrant 上没有 render。万一哪个
// 没翻到的调用方还在读 LearnGrant.render，它拿到 undefined 会立刻在控制台炸出来，
// 而不是悄悄画空。
//
// 纯逻辑无 i18n / 无存储读取，载入期零副作用（dialog-host 的 uiLang 预读这里不
// 需要 —— 卡面文案的 t 由调用方传）。
import grant from './grant.js';

try { window.LearnGrant = grant; } catch (_) {}
