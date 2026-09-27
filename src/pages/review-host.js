// src/pages/review-host.js — 扩展复习页的入口壳（PR7c「同名产物覆盖」），learn/review.js
// 产物的唯一来源。不住 src/shared/：§9.4 对账门按目录集合对两宿主，而本壳是**扩展单侧**
// 的组合根 —— App 侧 import 它等于在 quick 模式外又开一条 boot() 的路（门红是对的）。
//
// 扩展侧：review.html:264 的 <script src="review.js"> 标签一个不改，产物改由本文件
// bundle（build/ui-entries.config.js，登记处在 src/pages/ 与 popup.jsx 同族）—— 在原标签位调 boot()，旧 IIFE「加载即执行」
// 的时序不变（app-link.js 必须先于它，那条相对顺序也保留）。App 侧不走这里：
// main.jsx 直接 import ../shared/review.js，在 #quick 分流的 else 分支调 boot() ——
// quick 模式整段不执行（原 MAIN_ONLY 机制的组合根接棒）。
import { boot } from '../shared/review.js';

boot();
