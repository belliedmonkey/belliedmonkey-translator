// src/pages/doc-view-host.js — 扩展文档页的入口壳（PR7c「同名产物覆盖」），learn/doc-view.js
// 产物的唯一来源。不住 src/shared/：§9.4 对账门按目录集合对两宿主，而本壳是**扩展单侧**
// 的组合根（App 的 docs-model 直接 import 纯逻辑层，window.DocView 在 App 没有读者）。
//
// 扩展侧：docs.html:45 的 <script src="doc-view.js"> 标签一个不改，产物改由本文件
// bundle（build/ui-entries.config.js）—— 旧文件尾部的 window.DocView 挂载由这里接手
// （window.DocView.mount 哑视图 ABI），docs-page.js 的裸全局读取照常。App 侧不走这里：
// docs-model.js 直接 import ../shared/doc-view.js（组合根直挂，§10.9）。
import DocView from '../shared/doc-view.js';

try { window.DocView = DocView; } catch (_) {}
