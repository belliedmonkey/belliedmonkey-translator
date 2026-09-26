// build/ui-entries.config.js — React UI bundle 的唯一登记处（domain-design §10）。
//
// 每项 { entry, out }：entry 是仓库根相对的 .jsx/.js 入口，out 是 DIST 内的相对
// 路径。esbuild 产物**覆盖** dist 里同名文件 —— HTML 的 <script> 标签、manifest、
// web_accessible_resources 全都不用改；迁移一页 = 加一条 + 删旧 .js（同一个 PR）。
// 清单为空时 build.js 完全跳过 esbuild（连 require 都不发生）：dist 与迁移前
// byte 级相同 —— 这正是工具链 PR 的验收判据。
//
// 规则（§10.7）：flavor 敏感文本（品牌、端点、默认引擎名）不许进 bundle 源码 ——
// 它们属于 *.gen.js / backend.config.js 这些留在 bundle 外的独立文件；bundle 源码
// 一律经 src/lib/registry.js 读 window.MT_*，不直接摸全局、不 import gen 文件。
'use strict';

module.exports = { ENTRIES: [
  // PR3 试点页：extension/popup/popup.js 的后继（同名覆盖，popup.html 的 script
  // 标签不变）。旧 IIFE 已删 —— 迁移一页 = 加一条 + 删旧 .js。
  { entry: 'src/pages/popup.jsx', out: 'popup/popup.js' },
  // PR4：extension/onboard/onboard.js 的后继。三个命令式渲染器（LearnGrant /
  // QuickSetup / EngineFields）按 §10.9 规则 4 以孤岛挂载，仍在独立 <script> 里。
  { entry: 'src/pages/onboard.jsx', out: 'onboard/onboard.js' },
] };
