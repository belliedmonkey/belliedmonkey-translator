// src/shared/dialog-host.jsx — learn/dialog.js 产物的入口壳（PR7a「同名产物覆盖」）。
//
// 扩展侧：review.html:263 / docs.html:39 的 <script src="dialog.js"> 标签一个不改，
// learn/dialog.js 产物改由本文件 bundle（build/ui-entries.config.js）—— 旧 IIFE 的
// ABI（window.LearnDialog）由这里原样挂回，review.js / docs-page.js 的裸全局调用照常
// 工作。App 侧：main.jsx import 本文件获得同一实现 —— listen-model / shell-model /
// docs-model 运行时才引用全局 LearnDialog，app-ui.js 载入即挂好，时序安全。
//
// 设置页（两宿主）不走这个壳：它们直接 import ./dialog.jsx 的 confirm，宿主 div 由
// 各自入口 import 本文件挂载（options.jsx / main.jsx）。
//
// uiLang 各自就位（幂等，main.jsx 已有的预读与此重复但无害）：扩展页与 App 的
// chrome-shim 提供同一个 chrome.storage 接口。
import PageText from '../lib/i18n.js';
import { confirm, mountDialogHost } from './dialog.jsx';

try { chrome.storage.local.get(['uiLang'], (v) => PageText.setUiLang((v && v.uiLang) || 'auto')); } catch (_) {}
mountDialogHost();
try { window.LearnDialog = { confirm }; } catch (_) {}
